#!/usr/bin/env python3
"""The release gate. Nothing is published until every stage here is green.

    python3 tools/release.py            everything
    python3 tools/release.py --quick    skips the regen fixpoint and the
                                        browser test pages (minutes, not
                                        seconds); use while iterating, never
                                        to decide a release

🔴 THIS SCRIPT DOES NOT PUBLISH. It proves a tarball is fit to publish and
then stops. A pushed version tag makes the kit's publish workflow STAGE the
release on npm, and nothing is public until the owner approves it with 2FA:
no session holds a publish token, and none can approve.

🔴 EVERY STAGE MUST BE ABLE TO FAIL, and the way to prove each one is written
beside it. A gate nobody has watched go red is a gate that proves nothing
(tools/collisions.py sat red on main for days and caught nothing new).
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'tools' / 'release-manifest.txt'

# The rule: nothing published carries a person's name or contact details.
# See tools/release-manifest.txt for what ships at all.
#
# The patterns written here are generic: session ids and email addresses. The
# names of the people behind the kit cannot be listed in a file the kit repo
# publishes, so they live in tools/release_lab.py, which only the private
# working repo keeps and the export never carries. In that repo its absence is
# a failure rather than a quieter scan: see lab_names().
#
# 🔴 MATCHED CASE-INSENSITIVELY, AND THE WORD BOUNDARIES ARE WHAT MAKE THAT
# SAFE. The first version of the name list was case-SENSITIVE, so a name
# written in capitals walked straight past it, and this kit writes half its
# comments in capitals: the most likely spelling of the thing being looked for
# was the one spelling that could not be caught. Proven by selftest() below,
# which is the only reason it was found.
#
# ⚠️ The obvious worry about ignoring case is ordinary English: words this
# repo uses constantly contain short names. They are safe because every pattern
# is anchored with \b on both sides, and selftest() guards such words by name.
NAME_FLAGS = re.IGNORECASE
GENERIC_NAME_PATTERNS = [
    r'\bme-[0-9a-f]{2}\b',          # session ids, which leak our working notes
    # An email address. The top-level domain must be letters, so a version
    # pin like overscan@0.1.0 is not an address.
    r'\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b',
]

try:
    import release_lab
except ImportError:
    release_lab = None
NAME_PATTERNS = GENERIC_NAME_PATTERNS + (release_lab.NAME_PATTERNS if release_lab else [])


def lab_names():
    """None when the name patterns are complete for this checkout, else why not.

    The private working repo is recognised by its memory/ directory, which the
    kit export never carries. A checkout of it without release_lab.py would scan for session ids
    and addresses only and still print PASS, which is the silent green this
    script exists to refuse."""
    if release_lab is None and (ROOT / 'memory').is_dir():
        return 'tools/release_lab.py is missing, so the name scan knows no names'
    return None


# The second rule: nothing published points at private working notes. Those
# patterns name the private notes themselves, so they live in release_lab.py
# beside the personal names, and the export scan applies them to every file it
# carries. A checkout without that file has none, and the notes stage says so.
NOTES_PATTERNS = release_lab.NOTES_PATTERNS if release_lab else []

# Files whose CONTENT is never scanned: binary-ish or generated data where a
# false positive is certain. Kept deliberately short.
SCAN_SKIP = {'.png', '.jpg', '.woff2', '.ttf'}

# 🔴 ONE EXEMPTION, AND IT IS DELIBERATE. A copyright notice has to name the
# holder or MIT does not work, and npm ships LICENSE whatever `files` says.
# Decided 2026-09-12: the LICENSE keeps its copyright holder. Everywhere
# else the rule is absolute, which is why the exemption is a named path here
# rather than a softened pattern.
SCAN_EXEMPT = {'LICENSE'}


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)


class Gate:
    def __init__(self):
        self.failures = []

    def check(self, name, ok, detail=''):
        print(f'{"PASS" if ok else "FAIL"}  {name}')
        if not ok:
            if detail:
                print('      ' + detail.strip().replace('\n', '\n      '))
            self.failures.append(name)
        return ok


def stage_exports(g):
    """Prove it fails: change the export key to "./ov-*" and re-run."""
    r = run(['node', 'tools/check_exports.mjs'])
    g.check('every advertised subpath resolves and ships', r.returncode == 0,
            r.stdout + r.stderr)


def stage_types(g):
    """Prove it fails: give an element attribute the wrong type in the .d.ts."""
    r = run(['node_modules/.bin/tsc', '--noEmit', '--lib', 'es2022,dom',
             '--strict', 'types/overscan.d.ts'])
    g.check('types compile', r.returncode == 0, r.stdout + r.stderr)


def stage_wrappers(g):
    """Prove it fails: delete an export from src/react/index.js."""
    r = run(['node', 'tools/wrapper-test/build.mjs'])
    g.check('react, vue and svelte wrappers compile', r.returncode == 0,
            (r.stdout + r.stderr)[-800:])


KIT_GATES = ['palette.py', 'clearance.py', 'icons.py']
# The site's modules. The kit repo has none of them, and runs with --kit.
SITE_GATES = ['themes.py', 'examples.py', 'bundle.py']


GLOBAL_DEF = re.compile(r'window\.([A-Z][A-Za-z]+)\s*=(?!=)')
BLOCK_COMMENT = re.compile(r'/\*.*?\*/', re.S)
LINE_COMMENT = re.compile(r'^\s*//.*$', re.M)


def unimported_globals(sources):
    """[(module, global, definers)] for each module that reads a window global
    another module defines, without importing any module that defines it.

    🔴 THE BUG THIS EXISTS FOR. ov-table.js called window.OverscanRefusal and
    never imported ov-refusal.js. Every page that loaded another element first
    worked, so it passed everywhere it was looked at, and a consumer importing
    the table on its own got a TypeError on connect. Comments are stripped
    first, because this kit discusses the globals in prose far more often
    than it reads them."""
    defs = {}
    for name, text in sources.items():
        for glob in GLOBAL_DEF.findall(text):
            defs.setdefault(glob, set()).add(name)
    bad = []
    for name, text in sorted(sources.items()):
        code = LINE_COMMENT.sub('', BLOCK_COMMENT.sub('', text))
        for glob, definers in sorted(defs.items()):
            if name in definers or not re.search(r'\bwindow\.' + glob + r'\b', code):
                continue
            imported = any(re.search(r"""\bimport\s+(?:[^'";]*\bfrom\s+)?['"]\./"""
                                     + re.escape(d) + r"""['"]""", code) for d in definers)
            if not imported:
                bad.append((name, glob, sorted(definers)))
    return bad


def stage_globals(g):
    """Prove it fails: delete `import './ov-refusal.js';` from src/ov-table.js."""
    sources = {p.name: p.read_text() for p in sorted((ROOT / 'src').glob('*.js'))}
    bad = unimported_globals(sources)
    g.check('every module imports the globals it reads', not bad,
            '\n'.join(f'{m} reads window.{glob} but imports none of {", ".join(d)}'
                      for m, glob, d in bad))


def stage_generators(g, kit=False):
    """Prove it fails: hand-edit a generated file and do not re-run its tool."""
    # ⚠️ collisions.py IS NOT IN THIS LIST, and not by oversight. It refuses
    # two top-level names shared between files, on the stated reasoning that
    # "classic scripts share one global scope". The kit is ES modules now:
    # checked 2026-09-12, there are ZERO non-module `<script src="src/...">`
    # tags across index.html, demo/ and docs/, and the two files it flags
    # (ov-flip.js, ov-reveal.js) both import and export. Module scope makes
    # their shared `EASES`, `easeFor`, `engine`, `motionOf` and `reduced`
    # harmless, so the gate is red on main and cannot catch anything new.
    # Retiring or teaching it about modules belongs to its owner, not to a
    # release script, so this notes the decision instead of hiding it.
    #
    # 🔴 --kit DROPS THE SITE GATES BY NAME, NEVER BY ABSENCE. Skipping any gate
    # whose file is missing would let a deleted gate pass in lab too, so without
    # --kit a missing site module is a failure that says which flag to use.
    gates = KIT_GATES + ([] if kit else SITE_GATES)
    for tool in gates:
        path = ROOT / 'tools' / tool
        if not path.exists():
            hint = (' (a site module: the kit repo runs release.py --kit)'
                    if tool in SITE_GATES else '')
            g.check(f'{tool} exists', False, 'gate named in release.py is missing' + hint)
            continue
        r = run(['python3', f'tools/{tool}'], env=None)
        g.check(f'{tool}', r.returncode == 0, (r.stdout + r.stderr)[-600:])


def stage_fixpoint(g, script='tools/regen.sh'):
    """Prove it fails: edit a generated page by hand; the second run differs.

    ⚠️ UNSTAGED CHANGES ONLY, AND THAT IS THE POINT. The first version compared
    whole-tree `git status` before and after, which turns any OTHER session
    staging or committing during the run into a fixpoint failure: a peer
    renaming a file in tools/ made this go red while regen.sh had changed
    nothing. Regeneration writes to the working tree and never stages, so
    comparing `git diff --name-only` measures this script's own effect and
    ignores everyone else's index. The failure also NAMES the files, because
    "something changed" is not a finding anyone can act on.

    🔴 AND THAT WAS STILL NOT ENOUGH, because several sessions work this repo
    at once. Ignoring the INDEX does not help when a peer COMMITS during the
    run: `git diff` is measured against HEAD, so the moment HEAD moves under
    us the two measurements are against different baselines and files the peer
    regenerated and landed read as our drift. Hit 2026-09-12, second time in
    the same stage: a peer committed a regenerated bundle 90 seconds into the
    run and this reported css-classes.json, demo/standalone.html and
    docs/css-motion.html as a broken fixpoint. Nothing was broken.

    So HEAD is captured either side, and a move makes the result INCONCLUSIVE
    rather than a failure about generators. It still refuses — an unproven
    stage is not a passed one, which is this script's whole rule — but it says
    what actually happened, because sending someone to hunt a nondeterministic
    generator that does not exist is worse than saying "re-run it".

    MEMORY NOTES ARE NOT GENERATED OUTPUT. Sessions write and commit
    `memory/` at any time, without the main handoff, so a note saved during
    the run is left out of the before/after comparison, and a HEAD move made
    only of memory commits leaves the comparison valid. Any other file in a
    commit that lands mid-run still makes the result inconclusive.
    """
    generated = lambda paths: {p for p in paths if not p.startswith('memory/')}
    names = lambda: generated(run(['git', 'diff', '--name-only']).stdout.split())
    head = lambda: run(['git', 'rev-parse', 'HEAD']).stdout.strip()
    head_before, before = head(), names()
    run(['zsh', script])
    head_after, after = head(), names()

    landed = run(['git', 'diff', '--name-only', head_before, head_after]).stdout.split() \
        if head_before != head_after else []
    if generated(landed):
        g.check('regenerating changes nothing (fixpoint)', False,
                f'INCONCLUSIVE, NOT A KIT FAULT: HEAD moved during this stage '
                f'({head_before[:7]} -> {head_after[:7]}), so the before and '
                f'after diffs were measured against different commits. Another '
                f'session landed while the gate was running. Re-run when main '
                f'is quiet; do not go looking for a bad generator.')
        return

    moved = sorted(after - before)
    g.check('regenerating changes nothing (fixpoint)', not moved,
            f'{script} rewrote files that were not already modified, so something '
            'on disk was not generated from its tool, or a generator is not '
            'deterministic:\n  ' + '\n  '.join(moved[:20]))


def read_verdict(text):
    """True, a failure string, or None when the page never said anything.

    🔴 THE HARNESSES DO NOT ALL SPEAK THE SAME WAY, and the first version of
    this gate accepted only `GATE: PASS`. Twenty-two healthy pages report
    `13 of 13 pass` and never print a GATE line, so they were all reported as
    "no verdict" and the gate was red for a reason that had nothing to do with
    the kit. A gate that cries wolf on half its inputs is worse than no gate:
    it is tools/collisions.py again, in this file.

    Three spellings are accepted, and anything else is silence.
    """
    m = re.search(r'GATE:\s*(PASS|FAIL)', text)
    if m:
        return True if m.group(1) == 'PASS' else 'GATE FAIL'
    m = re.search(r'(\d+)\s+of\s+(\d+)\s+pass', text)
    if m:
        got, want = int(m.group(1)), int(m.group(2))
        return True if got == want else f'{got} of {want} pass'
    # A fifth: "8/8 passed, control failed as it must".
    m = re.search(r'(\d+)\s*/\s*(\d+)\s+passed', text)
    if m:
        got, want = int(m.group(1)), int(m.group(2))
        return True if got == want else f'{got}/{want} passed'
    m = re.search(r'(\d+)\s+passed,\s*(\d+)\s+failed', text)
    if m:
        return True if int(m.group(2)) == 0 else f'{m.group(2)} failed'
    # ⚠️ A FOURTH SPELLING: some harnesses dump a JSON object instead of a
    # sentence ({"total": 18, "passed": 18, "failed": [], ...}). Seven pages
    # use it, and they were reported as "no verdict" until a real browser was
    # asked what they actually said. Checking against the running page, rather
    # than believing the runner, is the only reason this was found.
    passed = re.search(r'"passed"\s*:\s*(\d+)', text)
    total = re.search(r'"total"\s*:\s*(\d+)', text)
    failed = re.search(r'"failed"\s*:\s*\[([^\]]*)\]', text)
    if passed and total:
        if failed and failed.group(1).strip():
            return f'failed: {failed.group(1).strip()[:60]}'
        if int(passed.group(1)) != int(total.group(1)):
            return f'{passed.group(1)} of {total.group(1)} passed'
        return True
    return None


def stage_pages(g):
    """Prove it fails: break one refusal; that element's page turns red."""
    chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    pages = sorted((ROOT / 'tools').glob('*-test/index.html'))
    # The server that serves this checkout, as in consumer-test.sh, so a copy
    # of the repo can be tested without touching :8842.
    base = os.environ.get('OVERSCAN_URL', 'http://localhost:8842/')
    bad = []
    for page in pages:
        name = page.parent.name
        r = run([chrome, '--headless=new', '--disable-gpu',
                 '--virtual-time-budget=12000', '--dump-dom',
                 f'{base}tools/{name}/'])
        text = re.sub(r'<script\b.*?</script>', '', r.stdout, flags=re.S)
        verdict = read_verdict(text)
        if verdict is None:
            bad.append(f'{name}: no verdict (page did not finish, or threw)')
        elif verdict is not True:
            bad.append(f'{name}: {verdict}')
    g.check(f'{len(pages)} element harnesses pass', not bad, '\n'.join(bad))


def stage_harness_sheets(g):
    """Prove it fails: delete a <link> from any harness and re-run.

    🔴 A HARNESS THAT RENDERS AN ELEMENT WITHOUT ITS STYLESHEET IS MEASURING A
    DOCUMENT THAT EXISTS NOWHERE ELSE, and the danger runs ONE WAY: "this is
    hidden" fails loudly when the rule is missing, "this shows" passes for
    free, forever. tools/position-test asserted that chrome="bare" hid a
    footnote while never loading chrome.css, and passed. See harness_sheets.py
    for why the honest question is what the harness BUILDS, not what it names.
    """
    r = run([sys.executable, str(ROOT / 'tools' / 'harness_sheets.py')])
    g.check('every element harness loads the sheets for the markup it builds',
            r.returncode == 0, r.stdout + r.stderr)


def packed_files():
    """npm 10 and 11 print a list of packs; npm 12 prints an object keyed by
    package name. Anything other than exactly one pack is refused."""
    r = run(['npm', 'pack', '--dry-run', '--json'])
    if r.returncode != 0:
        return None, r.stderr
    out = json.loads(r.stdout)
    packs = out if isinstance(out, list) else list(out.values())
    if len(packs) != 1 or not isinstance(packs[0], dict) or 'files' not in packs[0]:
        return None, f'npm pack --json printed an unexpected shape: {r.stdout[:200]}'
    return packs[0], ''


def stage_manifest(g, pack):
    """Prove it fails: add a stray file under src/ and re-run."""
    if pack is None:
        return
    got = sorted(f['path'] for f in pack['files'])
    if not MANIFEST.exists():
        g.check('release manifest exists', False,
                f'write it: node tools/... > {MANIFEST.relative_to(ROOT)}')
        return
    want = [l for l in MANIFEST.read_text().splitlines() if l.strip()]
    added = [p for p in got if p not in want]
    gone = [p for p in want if p not in got]
    detail = ''
    if added:
        detail += 'would ship, not in the manifest:\n  ' + '\n  '.join(added[:20]) + '\n'
    if gone:
        detail += 'in the manifest, no longer shipping:\n  ' + '\n  '.join(gone[:20])
    g.check(f'tarball matches the manifest ({len(want)} files)',
            not added and not gone, detail)


def stage_names(g, pack):
    """Prove it fails: put FRAMEWORKS.md back in package.json `files`."""
    if pack is None:
        return
    why = lab_names()
    if why:
        g.check('the name scan knows the names it is looking for', False, why)
    hits = []
    for entry in pack['files']:
        path = ROOT / entry['path']
        if (path.suffix in SCAN_SKIP or entry['path'] in SCAN_EXEMPT
                or not path.exists()):
            continue
        try:
            text = path.read_text(errors='ignore')
        except OSError:
            continue
        for pattern in NAME_PATTERNS:
            for m in re.finditer(pattern, text, NAME_FLAGS):
                line = text[:m.start()].count('\n') + 1
                hits.append(f'{entry["path"]}:{line}  {m.group(0)}')
    g.check('nothing shipped carries a name, handle or session id', not hits,
            '\n'.join(hits[:25]) + (f'\n  ... {len(hits) - 25} more' if len(hits) > 25 else ''))

    # Prove it fails: write one of release_lab.NOTES_CATCH into any comment in
    # src/. With no patterns in this checkout the stage says so instead.
    if not NOTES_PATTERNS:
        print('NOTE  no notes patterns in this checkout; the export scan applies them')
        return
    notes = []
    for entry in pack['files']:
        path = ROOT / entry['path']
        if (path.suffix in SCAN_SKIP or entry['path'] in SCAN_EXEMPT
                or not path.exists()):
            continue
        try:
            text = path.read_text(errors='ignore')
        except OSError:
            continue
        for pattern, flags in NOTES_PATTERNS:
            for m in re.finditer(pattern, text, flags):
                line = text[:m.start()].count('\n') + 1
                notes.append(f'{entry["path"]}:{line}  {m.group(0)}')
    g.check('nothing shipped points at private working notes', not notes,
            '\n'.join(notes[:25]) + (f'\n  ... {len(notes) - 25} more' if len(notes) > 25 else ''))


def stage_size(g):
    """Prove it fails: set any budget in tools/size-budget.json below today's
    size. The judgement itself is proven by size_budget.selftest(), which runs
    in selftest() below."""
    import size_budget
    path = ROOT / size_budget.BUDGET_FILE
    if not path.exists():
        g.check('size budget recorded', False,
                'record it: python3 tools/size_budget.py --write')
        return
    measured, heaviest = size_budget.measure(ROOT)
    budgets = json.loads(path.read_text())
    over, missing = size_budget.judge(measured, budgets)
    detail = '\n'.join(f'{k}: {got} B gzip, budget {b}' for k, got, b in over)
    if missing:
        detail += '\nno budget for: ' + ', '.join(missing)
    print(f'NOTE  gzip: ' + ', '.join(f'{k} {v}' for k, v in measured.items())
          + f'; heaviest element {heaviest}')
    g.check('the kit is within its size budget', not over and not missing, detail)


def stage_private(g):
    """The interlock: publishing is a separate, explicit decision by the owner."""
    pkg = json.loads((ROOT / 'package.json').read_text())
    private = pkg.get('private') is True
    print(f'{"NOTE" if private else "WARN"}  package.json private = {pkg.get("private")}')
    if not private:
        print('      publishing is now possible: this must be the owner\'s deliberate act')
    return private


def selftest():
    """Prove the two judgements this script makes before it makes them.

    🔴 BOTH OF THESE WERE ONCE "PROVEN" IN A SESSION AND NOT IN THE FILE, and
    both were wrong at some point anyway: the verdict parser knew one of five
    spellings and called twenty-two healthy pages silent, and the name scan
    was case-sensitive against a kit that SHOUTS IN COMMENTS. A proof that
    lives in a transcript protects nothing on the next run, so it lives here
    and the release refuses if it fails.

    Returns a list of failures, empty when everything holds.
    """
    fails = []

    # The name scan. Each case must be caught in EVERY spelling of its case,
    # and ordinary English must not be.
    def caught(text):
        return any(re.search(p, text, NAME_FLAGS) for p in NAME_PATTERNS)

    # Built from pieces, so this file does not trip its own scan when the
    # export checks every file it carries.
    at, sid = '@', 'me' + '-'
    must_catch = [
        sid + '30 measured it', sid.upper() + 'AB landed it',
        f'write to someone{at}mailhost.org', f'CONTACT A.B{at}MAIL.CO.UK',
    ]
    must_miss = [
        'frame-me-thing', 'the theme-01 token',
        'npm i overscan@0.1.0', 'svelte@5.57.0', 'import "@scope/pkg"',
    ]
    if release_lab:
        must_catch += release_lab.MUST_CATCH
        must_miss += release_lab.MUST_MISS
    why = lab_names()
    if why:
        fails.append(why)
    for text in must_catch:
        if not caught(text):
            fails.append(f'name scan MISSES a real name: {text!r}')
    for text in must_miss:
        if caught(text):
            fails.append(f'name scan false-positives on ordinary text: {text!r}')

    # The notes scan, when this checkout has its patterns. Same shape: every
    # pointer spelling caught, and the kit's own words left alone.
    def noted(text):
        return any(re.search(p, text, f) for p, f in NOTES_PATTERNS)

    if release_lab:
        for text in release_lab.NOTES_CATCH:
            if not noted(text):
                fails.append(f'notes scan MISSES a pointer: {text!r}')
        for text in release_lab.NOTES_MISS:
            if noted(text):
                fails.append(f'notes scan false-positives on ordinary text: {text!r}')

    # The globals check: a module that reads a global it does not import is
    # caught, and an import, a second definer or a comment are not.
    refusal = {'ov-refusal.js': 'window.OverscanRefusal = (() => ({}))();'}
    cases = [
        ({**refusal, 'ov-table.js': "import { define } from './ov-core.js';\n"
          "window.OverscanRefusal.upgrade(this);"}, 1),
        ({**refusal, 'ov-table.js': "import './ov-refusal.js';\n"
          "window.OverscanRefusal.upgrade(this);"}, 0),
        ({**refusal, 'ov-note.js': '/* window.OverscanRefusal is shared */\n'
          '// window.OverscanRefusal again\nexport const x = 1;'}, 0),
        ({'ov-core.js': 'window.Overscan = {};', 'ov-gl.js': 'window.Overscan = window.Overscan || {};',
          'ov-a.js': "import './ov-gl.js';\nwindow.Overscan.x();"}, 0),
        ({**refusal, 'ov-core.js': 'window.Overscan = {};',
          'ov-b.js': "import './ov-core.js';\nwindow.Overscan.y(); window.OverscanRefusal.z();"}, 1),
    ]
    for i, (sources, want) in enumerate(cases):
        got = len(unimported_globals(sources))
        if got != want:
            fails.append(f'globals check case {i}: {got} findings, expected {want}')

    # The verdict parser. A harness speaks in one of five ways, and silence
    # must read as silence rather than as success.
    verdicts = [
        ('GATE: PASS', True), ('GATE: FAIL', False),
        ('13 of 13 pass', True), ('11 of 13 pass', False),
        ('8/8 passed', True), ('6/8 passed', False),
        ('34 passed, 0 failed', True), ('34 passed, 2 failed', False),
        ('{"total": 18, "passed": 18, "failed": []}', True),
        ('{"total": 18, "passed": 17, "failed": ["a"]}', False),
        ('running...', None), ('', None),
    ]
    for text, want in verdicts:
        got = read_verdict(text)
        if want is None and got is not None:
            fails.append(f'verdict parser invented a result for {text!r}: {got!r}')
        elif want is True and got is not True:
            fails.append(f'verdict parser failed a passing page {text!r}: {got!r}')
        elif want is False and got in (True, None):
            fails.append(f'verdict parser passed a FAILING page {text!r}: {got!r}')

    # The size budget: an over-budget measure must fail, one inside the margin
    # must not, and the import closure must follow static imports only.
    import size_budget
    fails += size_budget.selftest()

    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true',
                    help='skip the regen fixpoint and the browser harnesses')
    ap.add_argument('--kit', action='store_true',
                    help='the kit repo: kit generator gates and tools/regen-kit.sh only')
    args = ap.parse_args()

    g = Gate()
    # 🔴 FIRST, BEFORE ANYTHING IS JUDGED. A runner that cannot tell a name
    # from a word, or silence from success, will report whatever it likes
    # about everything below.
    print('=== the gate itself ===')
    g.check('the name scan and the verdict parser are sound',
            not selftest(), '\n'.join(selftest()))

    print('\n=== package ===')
    stage_exports(g)
    stage_types(g)
    stage_wrappers(g)
    stage_globals(g)

    print('\n=== generated tree ===')
    stage_generators(g, kit=args.kit)
    if not args.quick:
        stage_fixpoint(g, 'tools/regen-kit.sh' if args.kit else 'tools/regen.sh')

    if not args.quick:
        print('\n=== element harnesses (needs tools/static_server.py or serve.py '
              'on :8842, or OVERSCAN_URL) ===')
        stage_pages(g)
    stage_harness_sheets(g)

    print('\n=== tarball ===')
    pack, err = packed_files()
    if pack is None:
        g.check('npm pack', False, err)
    else:
        print(f'NOTE  {pack["entryCount"]} files, '
              f'{pack["size"] / 1024:.0f} kB packed, '
              f'{pack["unpackedSize"] / 1048576:.2f} MB unpacked')
        stage_manifest(g, pack)
        stage_names(g, pack)
        stage_size(g)

    print()
    private = stage_private(g)

    print()
    if g.failures:
        print(f'REFUSED: {len(g.failures)} stage(s) red -> ' + ', '.join(g.failures))
        return 1
    if private:
        print('READY, and not published. This package.json is private on purpose: '
              'the kit export writes the publishable copy, and publishing runs '
              'from overscan-ui/overscan.')
    else:
        print('READY to publish.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
