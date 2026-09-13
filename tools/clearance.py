#!/usr/bin/env python3
"""THE KEEP-OUT GATE. How close a symbol's mark comes to its own frame.

⭐ THE RULE THIS MEASURES: A MARK NEVER CROWDS ITS FRAME. The frame is what
carries the category, so the frame has to survive being looked at quickly. A
mark that runs into the frame edge fuses with it, and the first thing lost is
the half of the symbol that was supposed to be readable BEFORE you worked out
what the mark was.

That is not a taste call, it is a measurement, and this is the instrument:
flatten the frame and the mark to point clouds, take the closest approach, and
subtract the stroke each of them actually paints so the number is the VISIBLE
gap rather than a centreline distance.

⚠️ AN INSTRUMENT THAT CANNOT SEE A CASE YOU ALREADY KNOW IS THE RECURRING
FINDING IN THIS PROJECT - the ASCII probe that measured font size instead of
the face, the bevel gate whose comparison was inverted. So `selftest()` runs
first and refuses to report if a mark known to be clear reads as tight, or a
mark deliberately pushed onto the frame reads as clear.

Stroke arithmetic: everything is stroke 2 on a 24 grid, so a stroked centreline
paints 1 unit either side. A filled mark (`fill=currentColor stroke=none`)
paints nothing outside its own outline. The visible gap is therefore

    closest centreline approach  -  1.0 (frame)  -  1.0 if the mark is stroked
"""
import math
import re
import sys

from icons import FRAMES, REGISTER

# ⭐ THE MARGIN IS ONE NINTH OF THE ROOM THE FRAME HAS.
#
# A single absolute margin is the obvious rule and it is WRONG here, because
# the frames are not the same size inside. The state circle holds an inscribed
# disc of 9.00 and the hazard triangle holds 5.40, so one number generous
# enough for the circle shrinks hazard marks back to the size that already
# failed a pass (see the ⚠️ in tools/icons.py). Every frame instead gives up
# the same PROPORTION of its interior, with the roomiest frame - the state
# circle, at 9.00 - setting the constant at 1.00.
#
# ROOM is the radius of the largest disc that fits inside the frame's
# centreline, computed by grid search and pinned here so a frame that is
# redrawn smaller cannot quietly keep an old allowance: check_room() re-measures
# the disc at the stated centre and refuses if it no longer fits.
ROOM = {
    'state':       ((12.0, 12.0), 9.00),
    'hazard':      ((12.0, 14.6), 5.40),
    'system':      ((12.0, 12.0), 8.50),
    # Open frames, so a search has nothing to bound it and the value is
    # derived: the rails are 14 apart, and the arch is an r=8 arc on x=4..20.
    'flow':        ((12.0, 12.0), 7.00),
    'action':      ((12.0, 12.0), 6.36),
    'wayfinding':  ((12.0, 11.0), 8.00),
    'crew':        ((12.0, 11.4), 7.52),
    'maintenance': ((12.0, 12.0), 7.95),
}
REFERENCE = 9.00


def gap_min(cat):
    return round(ROOM[cat][1] / REFERENCE, 2)


_NUM = re.compile(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')


def _nums(s):
    return [float(m.group()) for m in _NUM.finditer(s)]


def _arc(x0, y0, rx, ry, rot, laf, sf, x1, y1, out, steps=24):
    """SVG endpoint arc -> centre parameterisation (W3C F.6.5), sampled."""
    if rx == 0 or ry == 0 or (x0 == x1 and y0 == y1):
        out.append((x1, y1))
        return
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(rot)
    cos, sin = math.cos(phi), math.sin(phi)
    dx2, dy2 = (x0 - x1) / 2.0, (y0 - y1) / 2.0
    x1p = cos * dx2 + sin * dy2
    y1p = -sin * dx2 + cos * dy2
    lam = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2
    if lam > 1:
        rx *= math.sqrt(lam)
        ry *= math.sqrt(lam)
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    co = math.sqrt(max(0.0, num / den)) * (-1 if laf == sf else 1)
    cxp = co * rx * y1p / ry
    cyp = -co * ry * x1p / rx
    cx = cos * cxp - sin * cyp + (x0 + x1) / 2.0
    cy = sin * cxp + cos * cyp + (y0 + y1) / 2.0

    def ang(ux, uy, vx, vy):
        d = (ux * vx + uy * vy) / (math.hypot(ux, uy) * math.hypot(vx, vy))
        a = math.acos(max(-1.0, min(1.0, d)))
        return -a if ux * vy - uy * vx < 0 else a

    th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry,
              (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sf and dth > 0:
        dth -= 2 * math.pi
    elif sf and dth < 0:
        dth += 2 * math.pi
    for i in range(1, steps + 1):
        t = th1 + dth * i / steps
        out.append((cx + rx * math.cos(t) * cos - ry * math.sin(t) * sin,
                    cy + rx * math.cos(t) * sin + ry * math.sin(t) * cos))


def _cubic(p0, p1, p2, p3, out, steps=16):
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0]
                    + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1]
                    + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))


def flatten_d(d):
    """A path `d` string to a dense point cloud. Only the commands this
    register actually uses; an unknown one is an error, not a shrug."""
    pts = []
    toks = re.findall(r'[MmLlHhVvCcAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)'
                      r'(?:[eE][-+]?\d+)?', d)
    i, cmd = 0, None
    x = y = sx = sy = 0.0
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in 'Zz':
                # Sample the closing segment too; a frame closed by Z has a
                # real edge there and the triangle's base is exactly that.
                _line(x, y, sx, sy, pts)
                x, y = sx, sy
                continue
        elif cmd in 'Mm':
            # An implicit repeat of M is a LINETO, which is how the triangle
            # and diamond frames are written.
            cmd = 'L' if cmd == 'M' else 'l'
        n = lambda k: float(toks[i + k])
        if cmd in 'Mm':
            nx, ny = n(0), n(1)
            if cmd == 'm':
                nx, ny = x + nx, y + ny
            x, y = sx, sy = nx, ny
            pts.append((x, y))
            i += 2
        elif cmd in 'Ll':
            nx, ny = n(0), n(1)
            if cmd == 'l':
                nx, ny = x + nx, y + ny
            _line(x, y, nx, ny, pts)
            x, y = nx, ny
            i += 2
        elif cmd in 'Hh':
            nx = n(0) + (x if cmd == 'h' else 0)
            _line(x, y, nx, y, pts)
            x = nx
            i += 1
        elif cmd in 'Vv':
            ny = n(0) + (y if cmd == 'v' else 0)
            _line(x, y, x, ny, pts)
            y = ny
            i += 1
        elif cmd in 'Cc':
            c = [n(k) for k in range(6)]
            if cmd == 'c':
                c = [c[0] + x, c[1] + y, c[2] + x, c[3] + y, c[4] + x, c[5] + y]
            _cubic((x, y), (c[0], c[1]), (c[2], c[3]), (c[4], c[5]), pts)
            x, y = c[4], c[5]
            i += 6
        elif cmd in 'Aa':
            rx, ry, rot, laf, sf, ex, ey = [n(k) for k in range(7)]
            if cmd == 'a':
                ex, ey = x + ex, y + ey
            _arc(x, y, rx, ry, rot, int(laf), int(sf), ex, ey, pts)
            x, y = ex, ey
            i += 7
        else:
            raise ValueError(f'unsupported path command {cmd!r} in {d!r}')
    return pts


def _line(x0, y0, x1, y1, out, per=0.4):
    steps = max(2, int(math.hypot(x1 - x0, y1 - y0) / per))
    for i in range(steps + 1):
        t = i / steps
        out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))


def flatten(svg):
    """Every drawable element in a fragment to one point cloud, plus whether
    any part of it is STROKED (a filled mark paints nothing outside itself)."""
    pts, stroked = [], False
    for tag in re.findall(r'<(circle|rect|path)\b[^>]*>', svg):
        pass
    for m in re.finditer(r'<(circle|rect|path)\b([^>]*)>', svg):
        kind, attrs = m.group(1), m.group(2)
        if 'stroke="none"' not in attrs:
            stroked = True
        if kind == 'circle':
            cx = float(re.search(r'cx="([^"]+)"', attrs).group(1))
            cy = float(re.search(r'cy="([^"]+)"', attrs).group(1))
            r = float(re.search(r'\br="([^"]+)"', attrs).group(1))
            for i in range(96):
                a = 2 * math.pi * i / 96
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        elif kind == 'rect':
            g = lambda k: float(re.search(k + r'="([^"]+)"', attrs).group(1))
            x, y, w, h = g('x'), g('y'), g('width'), g('height')
            for a, b, c, d in ((x, y, x + w, y), (x + w, y, x + w, y + h),
                               (x + w, y + h, x, y + h), (x, y + h, x, y)):
                _line(a, b, c, d, pts)
        else:
            pts += flatten_d(re.search(r'\bd="([^"]+)"', attrs).group(1))
    return pts, stroked


def gap(frame_svg, mark_svg):
    """Visible gap in grid units between a mark and its frame. Negative means
    they overlap."""
    fp, _ = flatten(frame_svg)
    mp, mark_stroked = flatten(mark_svg)
    best = min(math.dist(a, b) for a in fp for b in mp)
    return best - 1.0 - (1.0 if mark_stroked else 0.0)


def selftest():
    """⚠️ The instrument, before its readings. A gate that cannot see a case
    you already know is worse than no gate, and this project has now shipped
    two of those."""
    box = '<rect x="3.5" y="3.5" width="17" height="17"/>'
    clear = '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'
    tight = '<path d="M4 12h16"/>'
    fails = []
    g_clear, g_tight = gap(box, clear), gap(box, tight)
    if not g_clear > 1.0:
        fails.append(f'a dot at the centre of a box reads as tight '
                     f'({g_clear:+.2f}) - the instrument is wrong, not the set')
    if not g_tight < 0:
        fails.append(f'a stroke drawn onto the box edge reads as clear '
                     f'({g_tight:+.2f}) - the instrument is wrong, not the set')
    # A filled mark paints nothing outside its outline, so it is allowed
    # closer than a stroked one. If that is not true the arithmetic is upside
    # down, which is exactly the bevel-gate mistake.
    ring = '<circle cx="12" cy="12" r="6"/>'
    disc = '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>'
    if not gap(box, disc) > gap(box, ring):
        fails.append('a filled mark does not measure clearer than the same '
                     'mark stroked - the stroke arithmetic is inverted')
    return fails


def check_room():
    """🔴 The stated room, re-measured. A frame redrawn smaller would otherwise
    keep an allowance it no longer earns, and every mark inside it would pass a
    gate that had stopped meaning anything."""
    fails = []
    for cat, ((cx, cy), r) in ROOM.items():
        pts, _ = flatten(FRAMES[cat])
        actual = min(math.dist((cx, cy), p) for p in pts)
        if actual < r - 0.05:
            fails.append(f'{cat}: claims {r:.2f} of room, measures '
                         f'{actual:.2f} from {(cx, cy)}')
    return fails


def report():
    rows = []
    for num, name, cat, _means, mark in REGISTER:
        if cat is None:
            continue
        g = gap(FRAMES[cat], mark)
        rows.append((round(g - gap_min(cat), 2), g, num, name, cat))
    return sorted(rows)


def main():
    fails = selftest()
    if fails:
        print('🔴 the keep-out gate does not trust itself:')
        for f in fails:
            print('  ', f)
        return 2
    room = check_room()
    if room:
        print('🔴 a frame no longer holds the room it claims:')
        for r in room:
            print('  ', r)
        return 2
    rows = report()
    bad = [r for r in rows if r[0] < 0]
    for slack, g, num, name, cat in rows:
        flag = '🔴' if slack < 0 else '  '
        print(f'{flag} {num:02d} {name:<20} {cat:<12} gap {g:+.2f} '
              f'/ needs {gap_min(cat):.2f}')
    print()
    for cat in FRAMES:
        print(f'   {cat:<12} room {ROOM[cat][1]:.2f}  margin '
              f'{gap_min(cat):.2f}')
    print(f'\n{len(rows)} symbols, {len(bad)} crowding their own frame')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
