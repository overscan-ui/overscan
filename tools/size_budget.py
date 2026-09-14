#!/usr/bin/env python3
"""Refuse a kit that got heavier than its recorded budget.

    python3 tools/size_budget.py             0 if every measure is in budget
    python3 tools/size_budget.py --write     record today's sizes as the budget
    python3 tools/size_budget.py --selftest  prove the judgement, then stop

🔴 WHY THIS EXISTS. Nothing else in the release gate can go red because the
kit grew. The manifest notices a NEW file, never a file that doubled. A size
that only ever gets reported is a size that only ever goes up.

WHAT IS MEASURED, all gzip -9 over the files concatenated (a close stand-in
for transfer size, and stable, which is what a budget needs):

  kit_js           every src/*.js: what `import 'overscan'` loads
  kit_css          every src/*.css: what overscan.css loads
  radar_closure    ov-radar.js plus everything it statically imports: the
                   cost of using ONE typical instrument
  largest_closure  the heaviest element-plus-imports in the kit, named: one
                   element bloating shows here even when the totals hide it

⚠️ THE TOTALS GROW WITH EVERY NEW ELEMENT, BY DESIGN, the same way the manifest
goes red for every new file. Re-record with --write at release, alongside the
manifest, and read the diff: a new element should move kit_js by roughly its
own size, not by more. The two closure measures should not move at all unless
the element they name changed.

⚠️ STATIC IMPORTS ONLY. A dynamic import() is loaded when needed, not when the
element is, so it is not part of what using the element costs up front.

Prove it fails: set any budget in tools/size-budget.json below today's size,
or run --selftest, which plants an over-budget measure and a two-file import
chain and refuses if either is misjudged.
"""

import argparse
import gzip
import json
import pathlib
import re
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUDGET_FILE = 'tools/size-budget.json'

# Headroom before a measure counts as over. Small on purpose: gzip of the same
# bytes is deterministic, so the only thing that moves these numbers is code.
MARGIN = 0.03

STATIC_IMPORT = re.compile(
    r"""(?:^|[;\s])(?:import|export)\b[^'"();]*?(?:from\s*)?['"](\.{1,2}/[^'"]+)['"]""",
    re.M)


def gz(paths):
    return len(gzip.compress(b''.join(p.read_bytes() for p in paths), 9, mtime=0))


def closure(entry):
    seen, todo = [], [entry.resolve()]
    while todo:
        f = todo.pop()
        if f in seen or not f.exists():
            continue
        seen.append(f)
        for spec in STATIC_IMPORT.findall(f.read_text(errors='ignore')):
            if spec.endswith('.js'):
                todo.append((f.parent / spec).resolve())
    return seen


def opt_in():
    """The modules tools/gen_entry.py keeps OUT of `import 'overscan'` (data a
    page imports by name). Read from gen_entry.py so the two cannot disagree."""
    m = re.search(r"^JS_OPT_IN = \[([^\]]*)\]", (ROOT / 'tools' / 'gen_entry.py').read_text(), re.M)
    return set(re.findall(r"'([\w-]+)'", m.group(1))) if m else set()


def opt_in_css():
    """The stylesheets tools/gen_entry.py keeps OUT of overscan.css."""
    m = re.search(r"^CSS_OPT_IN = \[([^\]]*)\]", (ROOT / 'tools' / 'gen_entry.py').read_text(), re.M)
    return set(re.findall(r"'([\w-]+)'", m.group(1))) if m else set()


def measure(root):
    src = root / 'src'
    skip = opt_in()
    css_skip = opt_in_css()
    # 🔴 kit_js is what `import 'overscan'` loads, so opt-in data is not in it;
    # it is budgeted on its own line instead, where it cannot hide an element.
    js = sorted(p for p in src.glob('*.js') if p.stem not in skip)
    data = sorted(p for p in src.glob('*.js') if p.stem in skip)
    closures = {p.stem: gz(closure(p)) for p in sorted(src.glob('ov-*.js')) if p.stem not in skip}
    heaviest = max(closures, key=closures.get)
    return {
        'kit_js': gz(js),
        **({'opt_in_js': gz(data)} if data else {}),
        # The same split for CSS: kit_css is what overscan.css pulls in.
        'kit_css': gz(sorted(p for p in src.glob('*.css') if p.stem not in css_skip)),
        **({'opt_in_css': gz(sorted(p for p in src.glob('*.css') if p.stem in css_skip))}
           if css_skip else {}),
        'radar_closure': closures.get('ov-radar', 0),
        'largest_closure': closures[heaviest],
    }, heaviest


def judge(measured, budgets, margin=MARGIN):
    """Returns (over, missing): measures past budget, and measures with none."""
    over, missing = [], []
    for key, got in measured.items():
        if key not in budgets:
            missing.append(key)
        elif got > budgets[key] * (1 + margin):
            over.append((key, got, budgets[key]))
    return over, missing


def selftest():
    fails = []

    over, _ = judge({'kit_js': 1100}, {'kit_js': 1000})
    if not over:
        fails.append('judge PASSED a measure 10% over budget')
    over, _ = judge({'kit_js': 1020}, {'kit_js': 1000})
    if over:
        fails.append('judge FAILED a measure inside the margin')
    _, missing = judge({'kit_js': 1, 'kit_css': 1}, {'kit_js': 1})
    if missing != ['kit_css']:
        fails.append(f'judge did not report a measure with no budget: {missing}')

    # An import chain the closure must follow, and one it must not.
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        (d / 'a.js').write_text("import { x } from './b.js';\nimport './c.js';\n"
                                "const later = () => import('./lazy.js');\n")
        (d / 'b.js').write_text("export { y as x } from './sub/d.js';\n")
        (d / 'c.js').write_text('/* side effect */\n')
        (d / 'sub').mkdir()
        (d / 'sub' / 'd.js').write_text("export const y = 1;\n")
        (d / 'lazy.js').write_text("export const z = 2;\n")
        got = sorted(p.name for p in closure(d / 'a.js'))
        if got != ['a.js', 'b.js', 'c.js', 'd.js']:
            fails.append(f'closure followed the wrong files: {got}')

    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--root', type=pathlib.Path, default=ROOT)
    args = ap.parse_args()

    fails = selftest()
    if fails or args.selftest:
        print('\n'.join(f'FAIL  {f}' for f in fails) or 'PASS  size budget selftest')
        return 1 if fails else 0

    measured, heaviest = measure(args.root)
    path = args.root / BUDGET_FILE
    if args.write:
        path.write_text(json.dumps({'largest_closure_is': heaviest, **measured}, indent=2) + '\n')
        print(f'wrote {BUDGET_FILE}')
        for k, v in measured.items():
            print(f'  {k:16} {v:8} bytes gzip')
        return 0

    if not path.exists():
        print(f'FAIL  no budget recorded: python3 tools/size_budget.py --write')
        return 1
    budgets = json.loads(path.read_text())
    over, missing = judge(measured, budgets)
    for k, v in measured.items():
        b = budgets.get(k)
        note = f'budget {b}' if b else 'NO BUDGET'
        print(f'{"FAIL" if any(o[0] == k for o in over) or k in missing else "PASS"}  '
              f'{k:16} {v:8} bytes gzip  ({note})')
    print(f'NOTE  heaviest element: {heaviest} (budget recorded against '
          f'{budgets.get("largest_closure_is", "?")})')
    return 1 if over or missing else 0


if __name__ == '__main__':
    sys.exit(main())
