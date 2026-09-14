#!/usr/bin/env python3
"""Strip comments from the kit's CSS for the npm package, and prove nothing else moved.

    python3 tools/css_strip.py --selftest   prove the strip and the check, then stop
    python3 tools/css_strip.py --check      every src/*.css: lossless to strip, or
                                            already stripped from its committed source
    python3 tools/css_strip.py --apply      rewrite src/*.css without comments (the
                                            publish job only; refused in the working repo)

WHY. About 60% of the CSS transfer was comments: the sheets overscan.css loads
gzip to 108 kB as written and 43 kB without them. A page with no build step
pays for every one of them. The source stays commented, so only the package
is stripped.

🔴 NOT IN THE KIT REPO, ONLY IN THE PUBLISH JOB. The site vendors src/ from the
kit commit, and its CSS reference pages are built from these comments by
tools/css_api.py. A stripped kit repo would publish that reference empty.

⚠️ TWO IMPLEMENTATIONS, ON PURPOSE. strip() walks characters. canonical(), which
the check trusts, is a separate regex over strings, url() and comments. If
both agreed only because they shared a bug, a check written from strip() would
pass its own mistakes.

Proven by --selftest: a shipped file that keeps a comment, changes a value or
drops a declaration is refused; comment-looking text inside a string or url()
survives; a comment that separated two tokens leaves a space.
"""

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Unparsed(ValueError):
    """CSS this cannot account for. Refused rather than stripped by a guess."""


def strip(css):
    """The CSS with its comments removed. Strings and url() are copied as is.
    Raises Unparsed on an unterminated string, url() or comment."""
    out, i, n = [], 0, len(css)
    line = lambda k: css.count('\n', 0, k) + 1
    while i < n:
        c = css[i]
        if c in '"\'':
            j = i + 1
            while j < n and css[j] != c and css[j] != '\n':
                j += 2 if css[j] == '\\' else 1
            if j >= n or css[j] != c:
                raise Unparsed(f'unterminated string at line {line(i)}')
            out.append(css[i:j + 1])
            i = j + 1
        elif css.startswith('url(', i) and css[i + 4:i + 5] not in ('"', "'"):
            j = css.find(')', i)
            if j == -1:
                raise Unparsed(f'unterminated url( at line {line(i)}')
            out.append(css[i:j + 1])
            i = j + 1
        elif css.startswith('/*', i):
            j = css.find('*/', i + 2)
            if j == -1:
                raise Unparsed(f'unterminated comment at line {line(i)}')
            j += 2
            before = out[-1][-1:] if out else ''
            after = css[j:j + 1]
            # A comment between two tokens separates them; keep that apart.
            if before and after and not before.isspace() and not after.isspace():
                out.append(' ')
            i = j
        else:
            out.append(c)
            i += 1
    lines = [ln.rstrip() for ln in ''.join(out).split('\n')]
    return '\n'.join(ln for ln in lines if ln) + '\n'


TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|url\([^"\')]*\)|/\*.*?\*/|\s+|.', re.S)


def canonical(css):
    """(tokens with comments dropped and whitespace runs as one space, comment count)."""
    toks, comments = [], 0
    for m in TOKEN.finditer(css):
        t = m.group(0)
        if t.startswith('/*'):
            comments += 1
            t = ' '
        if t.isspace():
            if toks and toks[-1] != ' ':
                toks.append(' ')
            continue
        toks.append(t)
    return ''.join(toks).strip(), comments


def faults(source, shipped, name='css'):
    """Why `shipped` is not `source` minus its comments. Empty when it is."""
    want, _ = canonical(source)
    got, left = canonical(shipped)
    out = []
    if left:
        out.append(f'{name}: {left} comment(s) left in the shipped file')
    if got != want:
        k = next((i for i, (a, b) in enumerate(zip(got, want)) if a != b), min(len(got), len(want)))
        out.append(f'{name}: differs from its source minus comments at character {k}: '
                   f'shipped {got[max(0, k - 30):k + 30]!r}, source {want[max(0, k - 30):k + 30]!r}')
    return out


def committed(rel, root=ROOT):
    r = subprocess.run(['git', '-C', str(root), 'show', f'HEAD:{rel}'], capture_output=True)
    return r.stdout.decode() if r.returncode == 0 else None


def check(root=ROOT):
    """Every src/*.css in the working tree. Unchanged from HEAD: stripping it
    must be lossless. Changed from HEAD: it must be HEAD minus its comments."""
    out, stripped, plain = [], 0, 0
    for p in sorted((root / 'src').glob('*.css')):
        rel = p.relative_to(root).as_posix()
        tree = p.read_text()
        source = committed(rel, root)
        if source is None:
            out.append(f'{rel}: not committed, so there is no source to compare with')
        elif tree == source:
            plain += 1
            try:
                out += faults(source, strip(source), rel)
            except Unparsed as e:
                out.append(f'{rel}: {e}')
        else:
            stripped += 1
            out += faults(source, tree, rel)
    return out, plain, stripped


def apply(root=ROOT):
    if (root / 'tools' / 'release_lab.py').exists():
        sys.exit('REFUSED: this is the working repo. The source keeps its comments; '
                 'only the publish job strips them.')
    # Strip everything in memory first, so a sheet that cannot be parsed
    # refuses the run before any file has been rewritten.
    try:
        done = {p: strip(p.read_text()) for p in sorted((root / 'src').glob('*.css'))}
    except Unparsed as e:
        sys.exit(f'REFUSED: {e}; nothing was rewritten')
    n = 0
    for p, out in done.items():
        if out != p.read_text():
            p.write_text(out)
            n += 1
    return n


def selftest():
    fails = []
    src = ('/* sheet intro */\n@layer overscan {\n  /* the rule */\n'
           '  .a { color: red; /* inline */ margin: 0 }\n'
           '  .b::before { content: "/* not a comment */"; }\n'
           "  .c { mask: url(data:image/svg+xml;utf8,<svg>/*x*/</svg>); }\n"
           '  .d/**/.e { top: 1px }\n}\n')
    got = strip(src)
    if '/* sheet' in got or 'inline' in got or 'the rule' in got:
        fails.append(f'strip left a comment: {got!r}')
    if '"/* not a comment */"' not in got:
        fails.append('strip removed comment-looking text inside a string')
    if '<svg>/*x*/</svg>' not in got:
        fails.append('strip removed comment-looking text inside url()')
    if '.d .e' not in got:
        fails.append(f'a comment between two tokens did not leave a space: {got!r}')
    if faults(src, got):
        fails.append(f'the check refused a correct strip: {faults(src, got)}')
    if strip(got) != got:
        fails.append('strip is not idempotent')

    planted = {
        'kept a comment': got.replace('color: red;', 'color: red; /* back */'),
        'changed a value': got.replace('color: red', 'color: blue'),
        'dropped a declaration': got.replace(' margin: 0', ''),
        'joined two tokens': got.replace('.d .e', '.d.e'),
        'changed text in a string': got.replace('not a comment', 'not a comment!'),
    }
    for why, bad in planted.items():
        if bad == got:
            fails.append(f'selftest plant did not apply: {why}')
        elif not faults(src, bad):
            fails.append(f'the check PASSED a shipped file that {why}')

    # 🔴 A WRONG STRIPPER, not just a wrong file: the one-line regex everyone
    # reaches for eats the comment-looking text inside the string and url().
    # The second method has to disagree with it.
    naive = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    if not faults(src, naive):
        fails.append('the check PASSED a naive regex strip that ate a string and a url()')

    for why, bad in {'string': '.a { content: "open }\n',
                     'url': '.a { mask: url(data:x\n',
                     'comment': '.a { top: 0 } /* never closed\n'}.items():
        try:
            strip(bad)
            fails.append(f'strip guessed at an unterminated {why} instead of refusing')
        except Unparsed:
            pass
    return fails


if __name__ == '__main__':
    f = selftest()
    if f:
        print('css_strip.py SELFTEST FAILED:', *f, sep='\n  ')
        sys.exit(1)
    if '--selftest' in sys.argv:
        print('selftest ok')
        sys.exit(0)
    if '--apply' in sys.argv:
        print(f'stripped comments from {apply()} stylesheet(s)')
        sys.exit(0)
    bad, plain, stripped = check()
    for b in bad:
        print('REFUSED', b)
    print(f'{plain} sheet(s) lossless to strip, {stripped} already stripped from their source, '
          f'{len(bad)} fault(s)')
    sys.exit(1 if bad else 0)
