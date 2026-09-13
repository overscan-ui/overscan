#!/usr/bin/env python3
"""The player's icons, one drawing per icon, drawn by each theme's pen.

    python3 tools/gen_player_icons.py    # writes src/player-icons.css

⭐ THE RULE: ONE SKELETON, TEN PENS. Every icon is drawn ONCE, on the symbol
register's 24 grid (ICONS.md): polylines, arcs and polygons, with `solid`
marking the places where being filled IS the meaning (the play triangle, the
pause bars, captions ON). A theme does not get its own artwork; it gets a PEN,
and the pen is read off what TOKENS.md already says the theme's controls are:

  aegis       the register's own construction: stroke 2, butt caps, miter
  industrial  a heavy bezel (3px button border): stroke 3.2, square caps, filled
  cyber       the register leaned by the theme's own 9deg shear
  antiseptic  flat colour blocks at zero depth: fills, and hairline strokes
  esper       an analyser's pen: stroke 1.8, round caps and joins
  neo         a character display is a grid of cells: every icon snapped to
              a 12 x 12 pixel grid, and nothing that is not a pixel
  machina     a targeting overlay draws outlines, never boxes: a solid is an
              outline with an inset echo
  holo        a projection is light: a solid is a translucent volume with a
              bright edge
  vector      an X-Y display cannot fill: a solid is hatched, and a beam with
              mass overruns every corner it meets
  terminal    has no buttons (TOKENS.md), so it has no icons either: bracketed
              text, where [--] is the register's own absence dash

🔴 THE DISTINCTIONS THE PLAYER'S REFUSALS REST ON MUST SURVIVE EVERY PEN, and
this script refuses to write the sheet if one does not: pause is never drawn
for pending, captions on differ from captions off, muted differs from sound.
It also refuses a vector icon with a fill and a neo icon with anything but
axis-aligned pixel runs, because those are the two pens whose whole claim is
what they cannot draw.
"""
import math
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'player-icons.css')


# ---- the skeletons ----------------------------------------------------------

def P(pts, closed=False, solid=False, dash=False, knock=False, smooth=False):
    return dict(pts=[tuple(map(float, p)) for p in pts], closed=closed, solid=solid,
                dash=dash, knock=knock, smooth=smooth)


def arc(cx, cy, r, a0, a1, **kw):
    """Degrees, 0 east, clockwise on screen (y down)."""
    n = max(4, int(abs(a1 - a0) / 20))
    pts = [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
            cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    return P(pts, smooth=True, **kw)


def rect(x0, y0, x1, y1, **kw):
    return P([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], closed=True, **kw)


SPEAKER = P([(3, 9), (7, 9), (12, 4.5), (12, 19.5), (7, 15), (3, 15)], closed=True, solid=True)
CC_ARCS = [arc(8.8, 12, 3, 40, 320), arc(16.2, 12, 3, 40, 320)]
BACK = [arc(12, 13, 7.5, -90, 180), P([(15, 3), (12, 6), (15, 9)])]


def mirror(prims):
    return [dict(p, pts=[(24 - x, y) for x, y in p['pts']]) for p in prims]


SKELETONS = {
    'play': [P([(7, 4), (19.5, 12), (7, 20)], closed=True, solid=True)],
    'pause': [rect(5.5, 4, 10, 20, solid=True), rect(14, 4, 18.5, 20, solid=True)],
    # A play asked for and not moving: a broken ring with a cross, the button's
    # action being to cancel it. Never the pause bars.
    'pending': [arc(12, 12, 8.5, a, a + 30) for a in range(0, 360, 45)]
               + [P([(8.5, 8.5), (15.5, 15.5)]), P([(15.5, 8.5), (8.5, 15.5)])],
    'back': BACK,
    'fwd': mirror(BACK),
    'vol2': [SPEAKER, arc(12, 12, 4.5, -45, 45), arc(12, 12, 8.5, -50, 50)],
    'vol1': [SPEAKER, arc(12, 12, 4.5, -45, 45)],
    'muted': [SPEAKER, P([(15.5, 9), (21.5, 15)]), P([(21.5, 9), (15.5, 15)])],
    'cc': [rect(2, 5, 22, 19)] + CC_ARCS,
    'ccOn': [rect(2, 5, 22, 19, solid=True)] + [dict(a, knock=True) for a in CC_ARCS],
    # No captions: the frame broken, and the register's negation slash across it.
    'nocc': [rect(3, 6, 21, 18, dash=True), P([(3, 21), (21, 3)])],
    'loop': [P([(4, 13), (4, 8), (19, 8)]), P([(16, 5), (19, 8), (16, 11)]),
             P([(20, 11), (20, 16), (5, 16)]), P([(8, 13), (5, 16), (8, 19)])],
    'pip': [rect(2, 4, 22, 20), rect(12, 12, 19.5, 17.5, solid=True)],
    'full': [P([(3, 9), (3, 3), (9, 3)]), P([(15, 3), (21, 3), (21, 9)]),
             P([(21, 15), (21, 21), (15, 21)]), P([(9, 21), (3, 21), (3, 15)])],
    'unfull': [P([(9, 3), (9, 9), (3, 9)]), P([(15, 3), (15, 9), (21, 9)]),
               P([(21, 15), (15, 15), (15, 21)]), P([(3, 15), (9, 15), (9, 21)])],
}

# Terminal: no buttons, so no icons. Bracketed text; [--] is the absence dash,
# [CC] against [cc] is case doing what fill does elsewhere.
GLYPHS = {
    # No brackets here: the kit's own button furniture puts "[ " and " ]" around
    # every terminal button, and the no-captions readout is not a button.
    'play': '>', 'pause': '||', 'pending': 'x?', 'back': '<<', 'fwd': '>>',
    'vol2': '))', 'vol1': ')', 'muted': 'x', 'cc': 'cc', 'ccOn': 'CC', 'nocc': '--',
    'loop': 'lp', 'pip': 'pip', 'full': '^', 'unfull': 'v',
}

PENS = {
    'aegis': dict(kind='svg', w=2.0, cap='butt', join='miter', solid='fill'),
    'industrial': dict(kind='svg', w=3.2, cap='square', join='miter', solid='fill'),
    'cyber': dict(kind='svg', w=2.0, cap='butt', join='miter', solid='fill', skew=-9),
    'antiseptic': dict(kind='svg', w=1.3, cap='butt', join='miter', solid='fill'),
    'esper': dict(kind='svg', w=1.8, cap='round', join='round', solid='fill'),
    # 16 cells in a 16px icon: one cell per CSS pixel, so the grid is crisp
    # rather than resampled (12 cells came out as 1.33px mush).
    'neo': dict(kind='pixel', cells=16),
    'machina': dict(kind='svg', w=1.5, cap='butt', join='miter', solid='echo'),
    'holo': dict(kind='svg', w=1.3, cap='round', join='round', solid='light'),
    'vector': dict(kind='svg', w=1.5, cap='round', join='round', solid='hatch', over=1.4),
}


# ---- drawing ------------------------------------------------------------------

def f(v):
    s = f'{v:.1f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def d_of(pts, closed):
    return 'M' + 'L'.join(f'{f(x)} {f(y)}' for x, y in pts) + ('Z' if closed else '')


def segments(p):
    pts = p['pts']
    segs = list(zip(pts, pts[1:]))
    if p['closed']:
        segs.append((pts[-1], pts[0]))
    return segs


def extend(a, b, by):
    (x0, y0), (x1, y1) = a, b
    L = math.hypot(x1 - x0, y1 - y0) or 1
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    return (x0 - ux * by, y0 - uy * by), (x1 + ux * by, y1 + uy * by)


def overshoot_paths(p, by):
    """A beam overruns the corner: every straight edge extended past both its
    ends. An arc is one continuous sweep, so only its two ends overrun."""
    if p['smooth']:
        pts = list(p['pts'])
        pts[0] = extend(pts[1], pts[0], 0)[1] if False else extend(pts[0], pts[1], by)[0]
        pts[-1] = extend(pts[-2], pts[-1], by)[1]
        return [d_of(pts, False)]
    return [d_of(extend(a, b, by), False) for a, b in segments(p)]


def centroid(pts):
    return sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)


def svg_icon(name, pen):
    w = pen['w']
    stroke = f'fill="none" stroke="#fff" stroke-width="{f(w)}" stroke-linecap="{pen["cap"]}" stroke-linejoin="{pen["join"]}"'
    defs, body = [], []
    prims = SKELETONS[name]
    solids = [p for p in prims if p['solid']]
    knocks = [p for p in prims if p['knock']]
    mode = pen['solid']
    over = pen.get('over', 0)

    # Every stroke of one kind goes into ONE path: the attributes repeated per
    # stroke were most of the sheet's weight (the pending ring alone was 13 kB).
    def ds(p):
        return overshoot_paths(p, over) if over and not p['dash'] else [d_of(p['pts'], p['closed'])]

    def lines(ps):
        plain = ''.join(d for p in ps if not p['dash'] for d in ds(p))
        dashed = ''.join(d for p in ps if p['dash'] for d in ds(p))
        out = f'<path d="{plain}" {stroke}/>' if plain else ''
        if dashed:
            out += f'<path d="{dashed}" {stroke} stroke-dasharray="{f(w * 1.4)} {f(w * 1.2)}"/>'
        return out

    body.append(lines([p for p in prims if not p['solid'] and not p['knock']]))

    if solids:
        solid_d = ''.join(d_of(p['pts'], True) for p in solids)
        knock = ''
        if knocks:
            defs.append('<mask id="k"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/>'
                        + f'<path d="{"".join(d_of(p["pts"], False) for p in knocks)}" fill="none" stroke="#000" '
                          f'stroke-width="{f(max(w, 1.6) + 2.2)}" stroke-linecap="round"/>'
                        + '</mask>')
            knock = ' mask="url(#k)"'
        if mode == 'fill':
            # Filled, with the pen's own edge so a heavy pen reads heavy.
            body.append(f'<g{knock}><path d="{solid_d}" fill="#fff"/>' + lines(solids) + '</g>')
        elif mode == 'light':
            body.append(f'<g{knock}><path d="{solid_d}" fill="#fff" fill-opacity=".42"/>' + lines(solids) + '</g>')
            body.append(lines(knocks))
        elif mode == 'echo':
            echo = []
            for p in solids:
                cx, cy = centroid(p['pts'])
                echo.append(P([(cx + (x - cx) * .45, cy + (y - cy) * .45) for x, y in p['pts']], closed=True))
            body.append(f'<g{knock}>' + lines(solids + echo) + '</g>')
            body.append(lines(knocks))
        elif mode == 'hatch':
            defs.append(f'<clipPath id="c"><path d="{solid_d}"/></clipPath>')
            hatch = ''.join(f'M{f(x)} 26L{f(x + 28)} -2' for x in range(-28, 26, 3))
            body.append(f'<g{knock}><path clip-path="url(#c)" d="{hatch}" fill="none" stroke="#fff" stroke-width="1.1"/>'
                        + lines(solids) + '</g>')
            body.append(lines(knocks))

    g = ''.join(body)
    if pen.get('skew'):
        g = f'<g transform="translate(12 12) skewX({pen["skew"]}) translate(-12 -12)">{g}</g>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
            + (f'<defs>{"".join(defs)}</defs>' if defs else '') + g + '</svg>')


def dist_seg(px, py, a, b):
    (x0, y0), (x1, y1) = a, b
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - x0) * dx + (py - y0) * dy) / L2))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)), t


def inside(px, py, pts):
    c = False
    n = len(pts)
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        if (y0 > py) != (y1 > py) and px < (x1 - x0) * (py - y0) / (y1 - y0) + x0:
            c = not c
    return c


def pixel_icon(name, pen):
    cells = pen['cells']
    size = 24 / cells
    prims = SKELETONS[name]
    on = [[False] * cells for _ in range(cells)]
    for j in range(cells):
        for i in range(cells):
            cx, cy = (i + .5) * size, (j + .5) * size
            hit = False
            for p in prims:
                if p['knock']:
                    continue
                if p['solid'] and inside(cx, cy, p['pts']):
                    hit = True
                run = 0.0
                for a, b in segments(p):
                    dd, t = dist_seg(cx, cy, a, b)
                    seglen = math.hypot(b[0] - a[0], b[1] - a[1])
                    if dd <= size * .62:
                        if not p['dash'] or ((run + t * seglen) % 6) < 3.2:
                            hit = True
                    run += seglen
            for p in prims:
                if p['knock'] and any(dist_seg(cx, cy, a, b)[0] <= size * .75 for a, b in segments(p)):
                    hit = False
            on[j][i] = hit
    d = ''
    for j, row in enumerate(on):
        i = 0
        while i < cells:
            if row[i]:
                k = i
                while k < cells and row[k]:
                    k += 1
                d += f'M{f(i * size)} {f(j * size)}h{f((k - i) * size)}v{f(size)}h{f(-(k - i) * size)}z'
                i = k
            else:
                i += 1
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="{d}" fill="#fff"/></svg>'


def draw(name, pen):
    return pixel_icon(name, pen) if pen['kind'] == 'pixel' else svg_icon(name, pen)


# ---- the checks, which refuse rather than warn ------------------------------

def check(sheet):
    bad = []
    names = set(SKELETONS)
    if set(GLYPHS) != names:
        bad.append(f'terminal glyphs and skeletons disagree: {sorted(names ^ set(GLYPHS))}')
    pairs = [('pause', 'pending'), ('play', 'pending'), ('cc', 'ccOn'), ('cc', 'nocc'), ('vol2', 'muted'), ('vol1', 'muted'), ('full', 'unfull')]
    for theme, icons in sheet.items():
        if set(icons) != names:
            bad.append(f'{theme}: missing {sorted(names - set(icons))}')
        for a, b in pairs:
            if icons.get(a) == icons.get(b):
                bad.append(f'{theme}: {a} and {b} are drawn the same')
    for a, b in pairs:
        if GLYPHS[a] == GLYPHS[b]:
            bad.append(f'terminal: {a} and {b} are the same text')
    for name, s in sheet.get('vector', {}).items():
        if 'fill="#fff"' in s.replace('<rect x="-4" y="-4" width="32" height="32" fill="#fff"/>', ''):
            bad.append(f'vector {name}: a fill, and an X-Y display cannot fill')
    for name, s in sheet.get('neo', {}).items():
        body = s.split(' d="', 1)[1].split('"', 1)[0]
        if any(c in body for c in 'LACQSTlacqst'):
            bad.append(f'neo {name}: something that is not a pixel run')
    return bad


def main():
    sheet = {theme: {name: draw(name, pen) for name in SKELETONS} for theme, pen in PENS.items()}
    bad = check(sheet)
    if bad:
        print('gen_icons: REFUSED\n  ' + '\n  '.join(bad))
        sys.exit(1)
    # Only what a data URI in a CSS string needs escaped: single quotes inside,
    # and %, #, < and >. Percent-encoding everything tripled the sheet.
    def url(s):
        s = s.replace('"', "'").replace('%', '%25').replace('#', '%23').replace('<', '%3C').replace('>', '%3E')
        return f'url("data:image/svg+xml,{s}")'
    css = ['/* GENERATED by tools/gen_player_icons.py. Do not edit; re-run the script.',
           ' * One skeleton per icon, drawn by each theme\'s pen. See the script for the rule. */',
           '@layer overscan {']
    # Terminal is also :root, as in tokens.css.
    css.append(':root, [data-ov-theme="terminal"] {')
    css.append('  --ov-pl-ink: transparent;')
    css.append('  --ov-pl-size: auto;')
    for name in SKELETONS:
        css.append(f'  --ov-pl-i-{name}: none;')
        css.append(f'  --ov-pl-g-{name}: "{GLYPHS[name]}";')
    css.append('}')
    for theme, icons in sheet.items():
        css.append(f'[data-ov-theme="{theme}"] {{')
        css.append('  --ov-pl-ink: currentColor;')
        css.append('  --ov-pl-size: 16px;')
        for name, s in icons.items():
            css.append(f'  --ov-pl-i-{name}: {url(s)};')
            css.append(f'  --ov-pl-g-{name}: none;')
        css.append('}')
    # Declared on the icon itself, so each var() resolves in the theme that
    # contains THIS icon (a composite declared on :root would freeze terminal's).
    for name in SKELETONS:
        css.append(f'.ov-player__icon[data-ov-icon="{name}"] {{ --ov-pl-mask: var(--ov-pl-i-{name}); --ov-pl-glyph: var(--ov-pl-g-{name}); }}')
    css.append('}')
    open(OUT, 'w').write('\n'.join(css) + '\n')
    total = os.path.getsize(OUT)
    print(f'wrote src/player-icons.css: {len(PENS)} pens x {len(SKELETONS)} icons + terminal text, {total} bytes')


if __name__ == '__main__':
    main()
