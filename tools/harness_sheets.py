#!/usr/bin/env python3
"""Refuse a harness that renders an element whose styling it never loaded.

    python3 tools/harness_sheets.py          # 0 if every harness is complete

🔴 THE BUG THIS EXISTS FOR. tools/position-test asserted that `chrome="bare"`
hid a footnote while never loading chrome.css, so it was measuring against a
document in which no such rule existed. It passed. The danger is
ONE-DIRECTIONAL and that is what makes it worth a gate: "this is hidden" fails
loudly when the rule is missing, "this shows" passes for free, forever.

⚠️ AND IT IS NOT DECIDABLE FROM THE CLASS NAMES A HARNESS MENTIONS. The first
detector for this matched the names each harness wrote, and got it wrong in
both directions at once:

  over-reported  `data-ov-state` is an ATTRIBUTE the element writes and the
                 harness reads back with getAttribute. It needs no stylesheet.
                 Substring-matching `ov-state` called nine harnesses suspect
                 and eight of them were reading attributes. Same for
                 `data-ov-sweep` against the `.ov-sweep` class in motion.css.

  under-reported it could not have found the real one. position-test names
                 `.ov-position__rulebox`, which IS in the sheet it loads. The
                 rule that hides it keys on `.ov-aside`, a class the harness
                 never mentions because the ELEMENT puts it in the markup.

So the question is not what the harness says. It is what the harness BUILDS:
every class the element writes into its own markup, and every stylesheet that
has a rule for one of those classes. A page that renders an element with part
of its styling absent is drawing something that exists nowhere else, and any
visual assertion it makes is about that, not about the kit.
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Classes an element writes into its own markup. `class="a b"` in a template,
# plus classList/setAttribute spellings, so a class added in JS still counts.
MARKUP_CLASS = re.compile(r'class="([^"${}]*)"')
CLASSLIST = re.compile(r"""classList\.(?:add|toggle)\(\s*['"]([\w-]+)['"]""")
SETATTR_CLASS = re.compile(r"""setAttribute\(\s*['"]class['"]\s*,\s*['"]([^'"]*)['"]""")
# A class a stylesheet has a rule for. `.ov-aside` yes; `data-ov-state` no,
# because that is an attribute selector and never a class.
#
# 🔴 COMMENTS FIRST, AND IT IS NOT A DETAIL. This kit writes long prose above
# its rules, and `.ov-head` is DISCUSSED in six stylesheets that do not style
# it - balance.css says only that most instruments should not use it. Reading
# the file instead of its rules reported seven sheets for one class, every one
# of them wrong, which is the same failure as the detector this replaces.
COMMENT = re.compile(r'/\*.*?\*/', re.S)
CSS_CLASS = re.compile(r'\.(ov-[a-z0-9_-]+)')
# An element tag used as a selector: `ov-balance .ov-head`, not `.ov-balance`.
CSS_TAG = re.compile(r'(?<![.\w-])(ov-[a-z0-9-]+)(?![\w-])')
LINK = re.compile(r'<link[^>]+href="[^"]*?([\w.-]+\.css)"')
# Every way these harnesses name the module under test: a `?src=` default, and
# plain static imports of `../../src/ov-*.js`.
SRC_DEFAULT = re.compile(r"""get\('src'\)\s*\|\|\s*['"]([^'"]+)['"]""")
IMPORTS = re.compile(r"""from\s*['"]([^'"]*src/ov-[\w-]+\.js)['"]|import\s*['"]([^'"]*src/ov-[\w-]+\.js)['"]""")


def classes_written(js):
    out = set()
    for attr in MARKUP_CLASS.findall(js):
        out.update(c for c in attr.split() if c.startswith('ov-'))
    out.update(CLASSLIST.findall(js))
    for attr in SETATTR_CLASS.findall(js):
        out.update(c for c in attr.split() if c.startswith('ov-'))
    return {c for c in out if c.startswith('ov-')}


def rules(css):
    """(classes, element tags) per selector, comments removed.

    Returns a list of (classes, tags) so a class can be attributed only to the
    element whose subtree the selector could actually reach.
    """
    css = COMMENT.sub(' ', css)
    out = []
    for block in css.split('{'):
        sel = block.rsplit('}', 1)[-1].strip()
        if not sel or sel.startswith('@'):
            continue
        out.append((set(CSS_CLASS.findall(sel)), set(CSS_TAG.findall(sel))))
    return out


def styled_by(sheet_rules, tag, written):
    """Classes in `written` this sheet styles for element `tag`.

    ⭐ A SELECTOR SCOPED TO ANOTHER ELEMENT CANNOT REACH THIS ONE.
    `ov-balance .ov-head` styles ov-balance's head and says nothing about
    ov-quorum's, so a sheet is only required by the element it can reach.
    """
    hit = set()
    for classes, tags in sheet_rules:
        if tags and tag not in tags:
            continue
        hit |= classes & written
    return hit


def modules_of(html, name):
    found = []
    m = SRC_DEFAULT.search(html)
    if m:
        found.append(m.group(1))
    for a, b in IMPORTS.findall(html):
        found.append(a or b)
    return found


def main():
    sheets = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'src', '*.css'))):
        sheets[os.path.basename(path)] = rules(open(path, encoding='utf-8').read())

    bad = []
    checked = 0
    for page in sorted(glob.glob(os.path.join(ROOT, 'tools', '*-test', 'index.html'))):
        name = os.path.basename(os.path.dirname(page))
        html = open(page, encoding='utf-8').read()
        specs = modules_of(html, name)
        if not specs:
            continue                      # not an element harness
        written, tags = set(), set()
        missing = []
        for spec in specs:
            module = os.path.normpath(os.path.join(ROOT, 'tools', name, spec))
            if not os.path.exists(module):
                missing.append(spec)
                continue
            written |= classes_written(open(module, encoding='utf-8').read())
            tags.add(os.path.basename(module)[:-3])
        if missing:
            # 🔴 A harness pointed at a module that is not there is a finding,
            # not a skip: that is how the runner came to run nothing at all.
            bad.append((name, 'module not found', ', '.join(missing)))
        if not written:
            continue
        checked += 1
        loaded = set(LINK.findall(html))
        for sheet, sheet_rules in sheets.items():
            if sheet in loaded or sheet == 'tokens.css':
                continue
            hit = set()
            for tag in tags:
                hit |= styled_by(sheet_rules, tag, written)
            if hit:
                bad.append((name, sheet, ', '.join(sorted(hit)[:4])))

    for name, sheet, why in bad:
        print(f'  RENDERS UNSTYLED  {name:<16} needs {sheet:<14} for {why}')
    print()
    if bad:
        print(f'{len(bad)} harness/stylesheet pair(s) missing, of {checked} element harnesses')
        return 1
    print(f'every one of {checked} element harnesses loads the sheets for the markup it builds')
    return 0


if __name__ == '__main__':
    sys.exit(main())
