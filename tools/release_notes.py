#!/usr/bin/env python3
"""Release notes for one version, from the commits since the previous release.

    python3 tools/release_notes.py v0.1.1              notes for a tag that exists
    python3 tools/release_notes.py v0.1.1 --to HEAD    preview before tagging
    python3 tools/release_notes.py --selftest

Runs in the kit repo. Each kit commit made by the export lists, one line each,
the working-repo commits it carries; this collects those lines between the
previous v* tag and this one, leaves out bookkeeping (regeneration, size budget
re-records, the kit's tools learning a new element), names the elements whose
module is new, and compares the size budget at both tags. The publish workflow
writes these notes into a DRAFT GitHub release after staging the version, and
the owner publishes the draft once the staged version is approved.

🔴 THE NOTES ARE SCANNED BEFORE THEY ARE PRINTED. They are public text, so the
same name patterns as the tarball apply, and one hit refuses the notes.

Prove it fails: --selftest plants a session id in a listed line and expects a
refusal, and checks that bookkeeping lines never reach the notes.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import release  # noqa: E402

TAG = re.compile(r'v(\d+)\.(\d+)\.(\d+)')
# The title the export gives a kit commit when none is passed. Built from
# pieces, as in release.py, so this file does not trip the export's own scan.
EXPORT_TITLE = 'Update from the ' + 'lab'
BOOKKEEPING = re.compile(r"^(Regenerate\b|Re-record the size budget\b|The kit's tools learn\b)")
WITHHELD = re.compile(r'^\((\d+) internal commits? not listed\)$')
SIZES = [('kit_js', 'All modules, JS'), ('kit_css', 'overscan.css and its sheets'),
         ('opt_in_js', 'Opt-in JS'), ('opt_in_css', 'Opt-in CSS')]


def git(repo, *args):
    r = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'REFUSED: git {" ".join(args)}: {r.stderr.strip()}')
    return r.stdout


def version(tag):
    m = TAG.fullmatch(tag)
    return tuple(int(x) for x in m.groups()) if m else None


def previous_tag(repo, tag):
    """The newest v* tag with a lower version than `tag`, or None."""
    mine = version(tag)
    older = [t for t in git(repo, 'tag', '-l', 'v*').split() if version(t) and version(t) < mine]
    return max(older, key=version) if older else None


def parse(messages):
    """(items, withheld, unlisted) from [(subject, body)] oldest first.

    A commit whose body lists lines is an export: its lines are the items. An
    export with no list (the ones made before lists existed) is counted as
    unlisted. Any other commit contributes its own subject."""
    items, withheld, unlisted = [], 0, 0
    for subject, body in messages:
        listed = [l[2:].strip() for l in body.splitlines() if l.startswith('- ')]
        for l in body.splitlines():
            m = WITHHELD.match(l.strip())
            if m:
                withheld += int(m.group(1))
        if listed:
            items += listed
        elif subject == EXPORT_TITLE:
            unlisted += 1
        else:
            items.append(subject)
    return [i for i in items if not BOOKKEEPING.match(i)], withheld, unlisted


def element_names(manifest):
    """The element names a custom-elements.json declares (an empty set for None).

    New elements come from here, not from new src/ov-*.js files: a module such
    as ov-plans.js is data for another element and registers nothing."""
    if not manifest:
        return set()
    return {dec['name'] for mod in manifest.get('modules', [])
            for dec in mod.get('declarations', []) if dec.get('name', '').startswith('ov-')}


def removed_api(before, after):
    """Lines naming every element, attribute and event the earlier manifest
    declares and the later one does not. These break a page written against
    the earlier release, so the notes put them first, under their own heading.
    Only names are compared; a changed meaning cannot be seen from here."""
    def decls(man):
        return {d['name']: d for m in (man or {}).get('modules', [])
                for d in m.get('declarations', []) if d.get('name', '').startswith('ov-')}
    old, new = decls(before), decls(after)
    lines = [f'`{n}` (the whole element)' for n in sorted(set(old) - set(new))]
    for n in sorted(set(old) & set(new)):
        for key, word in (('attributes', 'attribute'), ('events', 'event')):
            for gone in sorted(set(old[n].get(key) or []) - set(new[n].get(key) or [])):
                lines.append(f'`{n}`: {word} `{gone}`')
    return lines


def manifest(repo, ref):
    r = subprocess.run(['git', '-C', str(repo), 'show', f'{ref}:custom-elements.json'],
                       capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else None


def kb(n):
    return f'{n / 1000:.1f} kB'


def render(tag, prev, items, withheld, unlisted, elements, before, after, css_note, removed=()):
    ver = tag[1:]
    out = [f'Overscan {ver}', '', '```sh', f'npm i overscan@{ver}', '```', '']
    if removed:
        out += [f'## Removed since {prev} (update pages that use these)', '']
        out += [f'- {r}' for r in removed] + ['']
    if elements:
        out += ['## New elements', ''] + [f'- `{e}`' for e in elements] + ['']
    out += ['## Changes', '']
    out += [f'- {i}' for i in items] if items else ['- No listed changes.']
    if withheld:
        out.append(f'- ({withheld} internal change{"s" if withheld != 1 else ""} not listed)')
    if unlisted:
        out.append(f'- ({unlisted} earlier update{"s" if unlisted != 1 else ""} without a change list)')
    out.append('')
    if before and after:
        out += [f'## Size (gzip, compared with {prev})', '']
        for key, label in SIZES:
            if key in before and key in after:
                a, b = before[key], after[key]
                pct = f' ({(b - a) / a * 100:+.1f}%)' if a else ''
                out.append(f'- {label}: {kb(a)} to {kb(b)}{pct}')
        if css_note:
            out.append('- CSS is measured without comments from this release on, the form the '
                       'package now ships, so the CSS lines compare different measures.')
        out.append('')
    return '\n'.join(out)


def scan(text):
    return [m.group(0) for p in release.NAME_PATTERNS for m in re.finditer(p, text, release.NAME_FLAGS)]


def sizes(repo, ref):
    r = subprocess.run(['git', '-C', str(repo), 'show', f'{ref}:tools/size-budget.json'],
                       capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else None


def has(repo, ref, path):
    return subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', f'{ref}:{path}'],
                          capture_output=True).returncode == 0


def selftest():
    msgs = [
        (EXPORT_TITLE, 'Co-Authored-By: x'),
        ('package.json is publishable here', 'body'),
        (EXPORT_TITLE, "- ov-clock stops when its source does\n- Regenerate for ov-clock: pages\n"
                                "- Re-record the size budget for ov-clock\n- The kit's tools learn ov-clock\n"
                                "(2 internal commits not listed)\n\nLab-Commit: " + '0' * 40),
    ]
    items, withheld, unlisted = parse(msgs)
    assert items == ['package.json is publishable here', 'ov-clock stops when its source does'], items
    assert withheld == 2 and unlisted == 1
    text = render('v0.1.1', 'v0.1.0', items, withheld, unlisted, ['ov-clock'],
                  {'kit_js': 1000, 'kit_css': 2000}, {'kit_js': 1100, 'kit_css': 800}, True)
    assert 'npm i overscan@0.1.1' in text and '- `ov-clock`' in text
    assert 'Regenerate' not in text and 'size budget' not in text and "tools learn" not in text, 'bookkeeping stays out'
    assert '(2 internal changes not listed)' in text and '(1 earlier update without a change list)' in text
    assert 'All modules, JS: 1.0 kB to 1.1 kB (+10.0%)' in text
    assert 'measured without comments' in text
    assert not scan(text), 'clean notes pass the scan'
    assert scan(text + '\n- fixed by ' + 'me' + '-ab'), 'a session id in the notes is caught'
    assert '- No listed changes.' in render('v0.1.1', 'v0.1.0', [], 0, 0, [], None, None, False)
    assert version('v1.2.3') == (1, 2, 3) and version('v1.2') is None
    old = {'modules': [{'path': 'src/ov-a.js', 'declarations': [{'name': 'ov-a'}]}]}
    new = {'modules': old['modules'] + [
        {'path': 'src/ov-b.js', 'declarations': [{'name': 'ov-b'}]},
        {'path': 'src/ov-plans.js', 'declarations': []}]}
    assert sorted(element_names(new) - element_names(old)) == ['ov-b'], 'a data module is not a new element'
    was = {'modules': [
        {'path': 'src/ov-s.js', 'declarations': [{'name': 'ov-s', 'attributes': ['arm-hold', 'guard'], 'events': ['ov:arm', 'ov:gone']}]},
        {'path': 'src/ov-old.js', 'declarations': [{'name': 'ov-old'}]}]}
    now = {'modules': [{'path': 'src/ov-s.js', 'declarations': [{'name': 'ov-s', 'attributes': ['guard', 'new-one'], 'events': ['ov:arm']}]}]}
    gone = removed_api(was, now)
    assert gone == ['`ov-old` (the whole element)', '`ov-s`: attribute `arm-hold`', '`ov-s`: event `ov:gone`'], gone
    assert removed_api(now, now) == [], 'nothing removed, nothing listed'
    grew = {'modules': [
        {'path': 'src/ov-s.js', 'declarations': [{'name': 'ov-s', 'attributes': ['guard', 'new-one', 'more'], 'events': ['ov:arm', 'ov:new']}]},
        {'path': 'src/ov-extra.js', 'declarations': [{'name': 'ov-extra'}]}]}
    assert removed_api(now, grew) == [], 'an added attribute, event or element is not a removal'
    broke = render('v0.2.0', 'v0.1.0', [], 0, 0, [], None, None, False, gone)
    assert '## Removed since v0.1.0' in broke and '- `ov-s`: attribute `arm-hold`' in broke
    assert broke.index('## Removed') < broke.index('## Changes'), 'removals come before changes'
    assert '## Removed' not in render('v0.2.0', 'v0.1.0', [], 0, 0, [], None, None, False), 'no section when nothing is removed'
    assert element_names(None) == set()
    print('release_notes.py selftest ok')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tag', nargs='?')
    ap.add_argument('--to', help='the ref the release is cut from (default: the tag itself)')
    ap.add_argument('--repo', default=str(ROOT))
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    if not args.tag or not version(args.tag):
        sys.exit('REFUSED: give the release tag, vX.Y.Z')
    repo = pathlib.Path(args.repo)
    to = args.to or args.tag
    git(repo, 'rev-parse', '--verify', f'{to}^{{commit}}')
    prev = previous_tag(repo, args.tag)
    span = f'{prev}..{to}' if prev else to
    raw = git(repo, 'log', '--reverse', '--format=%s%x1f%b%x1e', span)
    messages = [tuple(c.strip('\n').split('\x1f', 1)) for c in raw.split('\x1e') if c.strip()]
    items, withheld, unlisted = parse(messages)
    man_before, man_after = (manifest(repo, prev) if prev else None), manifest(repo, to)
    elements = sorted(element_names(man_after) - element_names(man_before)) if prev else []
    removed = removed_api(man_before, man_after) if prev else []
    before, after = (sizes(repo, prev) if prev else None), sizes(repo, to)
    css_note = bool(prev) and not has(repo, prev, 'tools/css_strip.py') and has(repo, to, 'tools/css_strip.py')
    text = render(args.tag, prev, items, withheld, unlisted, elements, before, after, css_note, removed)
    hits = scan(text)
    if hits:
        sys.exit(f'REFUSED: the notes carry {len(hits)} name or session pattern hits: {", ".join(sorted(set(hits)))}')
    print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
