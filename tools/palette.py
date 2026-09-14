#!/usr/bin/env python3
"""Overscan palette solver and validator.

Every contrast number in the token docs is produced by this script. Nothing is
transcribed by hand: a measurement which names its
own colours is a claim, not a measurement.

Two jobs:
  solve  - given a hue, find the lightest/darkest value that clears a gate
           against the WORST surface the token can land on
  check  - validate a whole theme and exit non-zero if anything fails

The worst surface is `raised`, not `field`. A palette validated against the
darkest background passes tokens that fail two surfaces up.
"""
import sys

def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

def luminance(hex_colour):
    h = hex_colour.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)

def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def _rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]

def _hex(rgb):
    return '#' + ''.join(f'{max(0, min(255, round(c))):02x}' for c in rgb)

def mix(a, b, t):
    ra, rb = _rgb(a), _rgb(b)
    return _hex([ra[i] + (rb[i] - ra[i]) * t for i in range(3)])

GRAIN_MEAN = 0.5  # mean of the feTurbulence field in finish.css


def apply_panel_finish(colour, sc):
    """Composite the finish terms that sit OVER panel content.

    Grain (screen blend) and the scanline, averaged over a glyph rather than
    taken on its worst 1px row: an 11px glyph is crossed by several scanlines
    and is never uniformly on one, so the duty cycle is 1/pitch.

    The vignette is deliberately NOT here. It belongs on the field, behind the
    panels, where nothing has to be legible. Applied over content it darkens ink
    and surface together toward black, and WCAG's +0.05 flare term does not
    scale with them, so the ratio collapses toward 1 with no colour edited.
    """
    c = _rgb(colour)
    g = sc['grain']
    if g:
        c = [v * (1 - g) + (1 - (1 - v) * (1 - GRAIN_MEAN)) * g for v in c]
    s_op, pitch = sc['scan_opacity'], max(sc['scan_pitch'], 1)
    if s_op:
        c = [v * (1 - s_op / pitch) for v in c]
    return _hex(c)


def delivered(theme_name, a, b):
    """Contrast as the finish actually delivers it, not on flat colour."""
    sc = SCALARS[theme_name]
    return ratio(apply_panel_finish(a, sc), apply_panel_finish(b, sc))


def solve(colour, background, gate, theme_name, toward='#ffffff', steps=512):
    """Slide `colour` toward `toward` until it clears `gate` against `background`.

    Returns the first value that clears, so the result is the SMALLEST change
    that works rather than an arbitrary lightening.
    """
    if delivered(theme_name, colour, background) >= gate:
        return colour, 0.0
    for i in range(1, steps + 1):
        t = i / steps
        candidate = mix(colour, toward, t)
        if delivered(theme_name, candidate, background) >= gate:
            return candidate, t
    return None, 1.0

# Gate per token. Text is 4.5:1, non-text boundaries that carry meaning are 3:1,
# decorative hairlines are ungated because they are not information.
# Target DELIVERED contrast per text token. A palette solved so every token
# just clears the floor collapses the hierarchy: dim and faint both land on
# 4.5:1 and become the same colour. The same thing happens on a light
# field, where usable greys fell from about six to two.
#
# So the hierarchy is a specification, and the finish either affords it or it
# does not. Three legible steps need roughly 1.4x between each.
LADDER = {'faint': 4.5, 'dim': 6.4, 'ink': 9.0}

GATES = {
    'ink': 4.5, 'accent': 4.5, 'dim': 4.5, 'faint': 4.5, 'alarm': 4.5,
    'line_strong': 3.0, 'line': None, 'accent_2': 4.5,
}
SURFACES = ('field', 'panel', 'raised')

THEMES = {
    'terminal': dict(
        field='#0a0a0b', panel='#101013', raised='#17171b',
        line='#26262c', line_strong='#86868c',
        ink='#fafafb', accent='#ffffff', dim='#d3d3d5', faint='#adadb2',
        alarm='#ffb84d', accent_2='#ffffff'),
    'industrial': dict(
        field='#050806', panel='#0b110c', raised='#111a13',
        line='#1e2c20', line_strong='#778e7c',
        ink='#fafefb', accent='#33ff66', dim='#c2dac6', faint='#94b89b',
        alarm='#ffa726', accent_2='#6fe8d0'),
    'cyber': dict(
        field='#08080a', panel='#0e0e12', raised='#15151b',
        line='#282833', line_strong='#80808c',
        ink='#f2f2f4', accent='#f2e14c', dim='#cbcbd1', faint='#a6a6b0',
        alarm='#ff7d9e', accent_2='#4cd8e8'),
    'antiseptic': dict(
        field='#000000', panel='#050505', raised='#0a0a0a',
        line='#1a1a1a', line_strong='#5d5d5d',
        ink='#ffffff', accent='#2d6eff', dim='#a0a0a0', faint='#7a7a7a',
        alarm='#ff2b1c', accent_2='#ffd400'),
    'esper': dict(
        field='#07070a', panel='#0d0d11', raised='#14141a',
        line='#24242c', line_strong='#74747e',
        ink='#dfd9d1', accent='#ffb02e', dim='#bab6b0', faint='#999690',
        alarm='#ff6161', accent_2='#4fd6e8'),
    'neo': dict(
        field='#000000', panel='#030804', raised='#06110a',
        line='#0d2413', line_strong='#4f8f60',
        ink='#d6ffe0', accent='#00ff41', dim='#a8e6b8', faint='#7fc492',
        alarm='#ff5147', accent_2='#ccffd9'),
    'machina': dict(
        field='#050202', panel='#0c0505', raised='#150808',
        line='#2a1010', line_strong='#aa827e',
        ink='#ffe8e4', accent='#ff6654', dim='#e0b0a8', faint='#d0ada8',
        alarm='#ffd400', accent_2='#ff9d5c'),
    'holo': dict(
        field='#05060a', panel='#090b11', raised='#0e1119',
        line='#1b2030', line_strong='#6a7488',
        ink='#f2fbff', accent='#dff3ff', dim='#cbd8e4', faint='#a2adbd',
        alarm='#ff7d96', accent_2='#59d6ff'),
    'aegis': dict(
        field='#071019', panel='#0b1826', raised='#102133',
        line='#1c3149', line_strong='#5a83ad',
        ink='#dbeaf9', accent='#50a1ff', dim='#aec6e2', faint='#87a2c2',
        alarm='#ff7272', accent_2='#8affc8'),
    # 🔴 `panel` IS `field` ON PURPOSE, AND IT IS THE THEME'S WHOLE ARGUMENT.
    # Every other theme here is a raster, and a raster can fill a region
    # because it visits every pixel anyway. A beam only goes where it is sent,
    # so an unlit region is not a dark fill, it is the beam never having been
    # there. `raised` is the one surface with any fill at all, and it means
    # the beam is being asked to hold: hover and lit, nothing else.
    'vector': dict(
        field='#000000', panel='#000000', raised='#0d0318',
        line='#2c1140', line_strong='#9a6fb4',
        ink='#f7ecff', accent='#ff4fd8', dim='#d3b8e2', faint='#a98cbd',
        alarm='#ffcc2e', accent_2='#7d5cff'),
}


# Non-colour per-theme values. Kept here so one file is the source of truth for
# everything a theme changes, and so tokens.css can be generated rather than
# hand-written.
#
# antiseptic's finish is all zeros on purpose. Zero depth is the register, and
# it makes antiseptic the only theme whose delivered contrast equals its
# nominal contrast.
SCALARS = {
    'terminal': dict(
        bevel='cut', light=315, bevel_px=2, bevel_lift=0.3, bevel_drop=0.55,
        corner=0, bezel=1, rule=1, pad=12, gap=8, shear=0,
        case='none', track=0.0, accent_mode='invert',
        ornament='sweep', orn_intensity=0.75, orn_rate=1.0,
        fx='field', wash=0.07, spread=6.5, haze=0.0, chroma=0.0, glitch=0.0,
        text_anim='ov-type', text_ease='steps(32)', text_steps=32, text_dur=1600, text_idle='none', char_fx='none', cursor=True,
        mark_w='0.55em', mark_h='1em', mark_drop='0', mark_bg='currentColor', mark_anim='ov-blink', mark_rate='1.06s',
        btn_border='0', btn_bg='field', furniture='brackets', voice='plain', ctl_corner=False,
        grain=0.19, scan_opacity=0.42, scan_pitch=2, vignette=0.74, bloom=0.20,
        boot=900, cascade=60, dur_fast=90, dur_base=180, dur_slow=420),
    'industrial': dict(
        bevel='cut', light=315, bevel_px=2, bevel_lift=0.34, bevel_drop=0.62,
        corner=10, bezel=3, rule=1, pad=16, gap=10, shear=0,
        case='uppercase', track=1.2, accent_mode='colour',
        ornament='strata', orn_intensity=0.6, orn_rate=0.8,
        fx='field', wash=0.16, spread=4.0, haze=0.10, chroma=0.0, glitch=0.0,
        text_anim='ov-flicker-in', text_ease='steps(1)', text_steps=1, text_dur=1100, text_idle='none', char_fx='none', cursor=False,
        mark_w='0.85em', mark_h='0.16em', mark_drop='-0.12em', mark_bg='currentColor', mark_anim='ov-blink', mark_rate='1.7s',
        btn_border='bezel', btn_bg='panel', furniture='none', voice='relay', ctl_corner=True,
        grain=0.30, scan_opacity=0.50, scan_pitch=3, vignette=0.80, bloom=0.26,
        boot=1400, cascade=90, dur_fast=120, dur_base=240, dur_slow=560),
    'cyber': dict(
        bevel='cut', light=270, bevel_px=2, bevel_lift=0.26, bevel_drop=0.5,
        corner=6, bezel=1, rule=1, pad=12, gap=8, shear=9,
        case='none', track=0.4, accent_mode='colour',
        ornament='strands', orn_intensity=0.8, orn_rate=1.4,
        fx='field', wash=0.12, spread=4.5, haze=0.12, chroma=2.5, glitch=0.55,
        text_anim='ov-cut', text_ease='steps(1)', text_steps=1, text_dur=1, text_idle='ov-slice', char_fx='decode', cursor=True,
        mark_w='0.18em', mark_h='1.15em', mark_drop='-0.1em', mark_bg='var(--ov-accent)', mark_anim='ov-blink', mark_rate='0.36s',
        btn_border='rule', btn_bg='panel', furniture='none', voice='digital', ctl_corner=True,
        grain=0.26, scan_opacity=0.30, scan_pitch=2, vignette=0.70, bloom=0.18,
        boot=700, cascade=40, dur_fast=70, dur_base=140, dur_slow=320),
    'antiseptic': dict(
        bevel='none', light=0, bevel_px=0, bevel_lift=0.0, bevel_drop=0.0,
        corner=0, bezel=1, rule=1, pad=14, gap=8, shear=0,
        case='uppercase', track=1.6, accent_mode='colour',
        ornament='sweep', orn_intensity=0.45, orn_rate=0.5,
        fx='none', wash=0.0, spread=1.0, haze=0.0, chroma=0.0, glitch=0.0,
        text_anim='none', text_ease='steps(1)', text_steps=1, text_dur=1, text_idle='none', char_fx='none', cursor=False,
        mark_w='0', mark_h='1em', mark_drop='0', mark_bg='currentColor', mark_anim='none', mark_rate='1s',
        btn_border='0', btn_bg='raised', furniture='none', voice='chime', ctl_corner=False,
        grain=0.0, scan_opacity=0.0, scan_pitch=2, vignette=0.0, bloom=0.0,
        boot=600, cascade=120, dur_fast=0, dur_base=0, dur_slow=0),
    'esper': dict(
        bevel='cut', light=315, bevel_px=2, bevel_lift=0.28, bevel_drop=0.58,
        corner=4, bezel=2, rule=1, pad=14, gap=8, shear=0,
        case='uppercase', track=1.0, accent_mode='colour',
        ornament='smoke', orn_intensity=0.7, orn_rate=0.6,
        fx='field', wash=0.20, spread=3.0, haze=0.55, chroma=1.2, glitch=0.0,
        text_anim='ov-wipe', text_ease='linear', text_steps=1, text_dur=1500, text_idle='none', char_fx='none', cursor=False,
        mark_w='3em', mark_h='1.1em', mark_drop='-0.05em', mark_bg='linear-gradient(to right, transparent, var(--ov-accent))', mark_anim='none', mark_rate='1s',
        btn_border='bezel', btn_bg='panel', furniture='none', voice='tape', ctl_corner=True,
        grain=0.14, scan_opacity=0.35, scan_pitch=3, vignette=0.82, bloom=0.30,
        boot=1100, cascade=70, dur_fast=100, dur_base=200, dur_slow=480),
    'neo': dict(
        bevel='cut', light=315, bevel_px=1, bevel_lift=0.22, bevel_drop=0.45,
        corner=0, bezel=1, rule=1, pad=12, gap=6, shear=0,
        case='none', track=0.6, accent_mode='colour',
        ornament='strands', orn_intensity=0.7, orn_rate=1.6,
        fx='rain', wash=0.05, spread=5.0, haze=0.0, chroma=0.0, glitch=0.0,
        text_anim='ov-type', text_ease='steps(1)', text_steps=1, text_dur=900, text_idle='none', char_fx='decode', cursor=True,
        mark_w='0.6em', mark_h='1.05em', mark_drop='0', mark_bg='var(--ov-accent)', mark_anim='ov-blink', mark_rate='0.8s',
        btn_border='0', btn_bg='field', furniture='edge', voice='dry', ctl_corner=False,
        grain=0.10, scan_opacity=0.22, scan_pitch=2, vignette=0.60, bloom=0.30,
        boot=1200, cascade=50, dur_fast=80, dur_base=160, dur_slow=360),
    'machina': dict(
        bevel='cut', light=0, bevel_px=2, bevel_lift=0.3, bevel_drop=0.55,
        corner=0, bezel=2, rule=1, pad=14, gap=8, shear=0,
        case='uppercase', track=1.6, accent_mode='colour',
        ornament='strata', orn_intensity=0.55, orn_rate=0.7,
        fx='vision', wash=0.14, spread=3.6, haze=0.06, chroma=0.0, glitch=0.12,
        text_anim='ov-flicker-in', text_ease='steps(1)', text_steps=1, text_dur=700, text_idle='none', char_fx='none', cursor=False,
        mark_w='0.9em', mark_h='0.14em', mark_drop='-0.1em', mark_bg='var(--ov-accent)', mark_anim='ov-blink', mark_rate='0.5s',
        btn_border='0', btn_bg='panel', furniture='ticks', voice='menace', ctl_corner=False,
        grain=0.22, scan_opacity=0.34, scan_pitch=3, vignette=0.78, bloom=0.16,
        boot=800, cascade=40, dur_fast=60, dur_base=120, dur_slow=300),
    'holo': dict(
        bevel='lit', light=315, bevel_px=2, bevel_lift=0.26, bevel_drop=0.0,
        corner=8, bezel=1, rule=1, pad=14, gap=10, shear=0,
        case='uppercase', track=1.2, accent_mode='colour',
        ornament='smoke', orn_intensity=0.6, orn_rate=0.5,
        fx='holo', wash=0.22, spread=3.0, haze=0.28, chroma=1.6, glitch=0.0,
        text_anim='ov-wipe', text_ease='linear', text_steps=1, text_dur=1300, text_idle='none', char_fx='none', cursor=False,
        mark_w='0.7em', mark_h='0.1em', mark_drop='-0.06em', mark_bg='var(--ov-accent)', mark_anim='ov-pulse', mark_rate='2.2s',
        btn_border='0', btn_bg='panel', furniture='base', voice='air', ctl_corner=False,
        grain=0.06, scan_opacity=0.55, scan_pitch=4, vignette=0.52, bloom=0.42,
        boot=1600, cascade=110, dur_fast=140, dur_base=280, dur_slow=640),
    'aegis': dict(
        bevel='cut', light=315, bevel_px=1, bevel_lift=0.18, bevel_drop=0.38,
        corner=0, bezel=1, rule=1, pad=10, gap=6, shear=0,
        case='uppercase', track=1.0, accent_mode='colour',
        ornament='sweep', orn_intensity=0.5, orn_rate=0.45,
        fx='field', wash=0.09, spread=5.2, haze=0.04, chroma=0.0, glitch=0.0,
        text_anim='ov-wipe', text_ease='steps(1)', text_steps=1, text_dur=500, text_idle='none', char_fx='none', cursor=False,
        mark_w='0.5em', mark_h='0.12em', mark_drop='-0.08em', mark_bg='var(--ov-accent)', mark_anim='ov-blink', mark_rate='1.4s',
        btn_border='rule', btn_bg='panel', furniture='chamfer', voice='sonar', ctl_corner=False,
        grain=0.12, scan_opacity=0.26, scan_pitch=2, vignette=0.66, bloom=0.14,
        boot=1000, cascade=45, dur_fast=80, dur_base=150, dur_slow=340),
    # ⭐ vector IS THE ONLY DISPLAY IN THE KIT THAT DOES NOT SCAN, and every
    # number below follows from that one fact rather than from taste:
    #
    #   scan_opacity 0  there is no raster, so there are no scanlines. This is
    #                   the only theme in the kit at zero, and finish.css draws
    #                   nothing rather than drawing something faint.
    #   grain        0  phosphor grain is a property of a screen being swept.
    #                   A stroke display has beam JITTER instead, which is a
    #                   property of the stroke and belongs in the shader.
    #   bloom     0.46  the highest in the kit. A beam parked on one spot is
    #                   far brighter per unit area than a swept raster, so the
    #                   halo around a stroke is the theme's loudest signal.
    #   bevel     none  a stroke has no lit side to catch a light from. This
    #                   is antiseptic's reason arriving by a different road.
    'vector': dict(
        bevel='none', light=0, bevel_px=0, bevel_lift=0.0, bevel_drop=0.0,
        corner=0, bezel=1, rule=1, pad=12, gap=8, shear=0,
        case='uppercase', track=1.4, accent_mode='colour',
        ornament='strands', orn_intensity=0.5, orn_rate=0.6,
        fx='beam', wash=0.05, spread=6.0, haze=0.0, chroma=0.0, glitch=0.0,
        text_anim='ov-type', text_ease='steps(1)', text_steps=1, text_dur=700, text_idle='none', char_fx='none', cursor=False,
        mark_w='0.12em', mark_h='1.1em', mark_drop='-0.08em', mark_bg='var(--ov-accent)', mark_anim='ov-pulse', mark_rate='0.9s',
        btn_border='0', btn_bg='none', furniture='overshoot', voice='coil', ctl_corner=False,
        grain=0.0, scan_opacity=0.0, scan_pitch=2, vignette=0.62, bloom=0.46,
        boot=1100, cascade=55, dur_fast=80, dur_base=160, dur_slow=380),
}

# ⭐ CONTROL FURNITURE, WHICH IS WHY THE THEMES ARE DIFFERENT OBJECTS.
#
# A theme is a MECHANISM, not a hue, and the four newest themes were failing
# that test: strong backgrounds with the same rule-box button underneath. This
# is the axis that fixes it. Each value names what a control's EDGE does, and
# a theme carries exactly one.
#
#   brackets  the label is wrapped in [ ] and there is no box at all, because
#             a terminal has no buttons - it has text you can select
#   none      the form is already carried by the border, the corner and the
#             shear, and no extra furniture is taken. ⚠️ NOT an omission: it is
#             the same register antiseptic uses when it declines the field
#             shader, the bevel and the bolt
#   ticks     crop marks at the four corners instead of a continuous edge,
#             which is what a targeting overlay draws
#   edge      one bar on the LEADING side only, because in a display organised
#             into columns the boundary that means anything is the one you
#             cross
#   base      an underline and nothing else: a projection is light landing on
#             a surface, and the only hard edge it has is where it lands.
#             🔴 holo therefore declines the corner cut too, because a contact
#             line that is interrupted is not a contact line
#   chamfer   all four corners taken off, which is an armoured plate rather
#             than a panel with a corner treatment
#   overshoot two strokes CROSSING near each corner, each running past the
#             other. A plotter or an X-Y display does not draw a corner, it
#             draws two lines that meet there, and a beam with mass overruns
#             the join every time. ⭐ It is `ticks` plus one number: `over`
#             pushes each mark off its own edge so the pair crosses instead
#             of sitting flush, and at over=0 the geometry IS `ticks`.
#
# Everything below is inert at zero, so chrome.css draws all four treatments
# unconditionally and never names a theme. That is the same move --ov-shear
# already makes at 0deg.
FURNITURE = {
    'brackets':  dict(tick=0, over=0, edge=0, base=0, chamfer=0, wrap=True),
    'none':      dict(tick=0, over=0, edge=0, base=0, chamfer=0, wrap=False),
    'ticks':     dict(tick=7, over=0, edge=0, base=0, chamfer=0, wrap=False),
    'edge':      dict(tick=0, over=0, edge=3, base=0, chamfer=0, wrap=False),
    'base':      dict(tick=0, over=0, edge=0, base=2, chamfer=0, wrap=False),
    'chamfer':   dict(tick=0, over=0, edge=0, base=0, chamfer=5, wrap=False),
    'overshoot': dict(tick=9, over=3, edge=0, base=0, chamfer=0, wrap=False),
}


# ⭐ VOICE. A THEME DOES NOT REDEFINE THE VOCABULARY, IT RETUNES IT.
#
# src/ov-sound.js has shipped one house vocabulary of six sounds since it was
# written, and its own header claimed "a theme can retune its own vocabulary
# without shipping a file" while nothing did. This is that, and it is the
# sound half of the same complaint the furniture axis answers: nine themes
# that looked different and sounded identical.
#
# ⭐ THE CONTOUR IS THE MEANING AND THE TIMBRE IS THE THEME, which is the
# icon register's rule in another medium. `refuse` falls and `commit` rises,
# in every theme, because that is what they MEAN; whether they fall as a
# square wave through a relay or as a sine through air is what the theme gets
# to say. A theme therefore cannot invent a sound, mute one, or swap two over
# - it can only change the voice they are all spoken in.
#
#   pitch  frequency multiplier, applied to both ends of the sweep so the
#          contour survives transposition
#   decay  length multiplier
#   gain   level multiplier. 🔴 NOT a mute: rule 1 of ov-sound.js is that
#          sound is off until asked for, and rule 3 that it is never the only
#          channel, so a quiet theme is still a theme and not an omission
#   wave   the timbre every tonal sound is spoken in
#   grit   noise mixed in beside the tone, 0 to 1. an electromechanical panel
#          does not click cleanly
VOICE = {
    'plain':   dict(pitch=1.00, decay=1.00, gain=1.00, wave='square',   grit=0.00),
    'relay':   dict(pitch=0.55, decay=1.50, gain=1.10, wave='square',   grit=0.35),
    'digital': dict(pitch=1.50, decay=0.60, gain=0.95, wave='sawtooth', grit=0.00),
    'chime':   dict(pitch=0.90, decay=1.30, gain=0.70, wave='sine',     grit=0.00),
    'tape':    dict(pitch=0.80, decay=1.20, gain=0.90, wave='triangle', grit=0.08),
    'dry':     dict(pitch=1.30, decay=0.50, gain=0.85, wave='square',   grit=0.10),
    'menace':  dict(pitch=0.50, decay=1.25, gain=1.05, wave='sawtooth', grit=0.25),
    'air':     dict(pitch=1.25, decay=1.90, gain=0.60, wave='sine',     grit=0.00),
    'sonar':   dict(pitch=0.70, decay=1.60, gain=0.90, wave='triangle', grit=0.05),
    # `coil` is the deflection yoke, which on a stroke display is genuinely
    # audible and genuinely varies with what is being drawn. High and thin,
    # because a yoke rings rather than thuds, and it rings for a while after
    # the beam has moved on - hence the long decay against the short one a
    # `dry` click has. Quiet, because it is a side effect of the picture and
    # not a sound anybody chose to make.
    'coil':    dict(pitch=1.90, decay=1.40, gain=0.65, wave='triangle', grit=0.02),
}


"""BEVELS.

🔴 A BEVEL ENCODES A LIGHT DIRECTION, WHICH MEANS IT CANNOT BE INVERTED, ONLY
RE-LIT. `filter: invert(1)` on a bevelled control swaps
the light pair for the dark pair while leaving both on the same SIDES, and
that swap is the definition of sunken: every button comes out looking pressed.

So nothing here is ever inverted. Each theme DECLARES where its light comes
from, and the highlight and shadow are derived from that declaration and from
the theme's own surfaces. Sunken is the same two colours on the opposite
sides, which is what a well actually looks like under a fixed light: the wall
facing the light is lit whether it faces out of the surface or into it.

⭐ THE HIGHLIGHT IS MIXED TOWARD THE THEME'S OWN INK, NOT TOWARD WHITE. On
these registers the light in the room IS the phosphor, so industrial's lit
edge is green and terminal's is white because that is what is lighting them.
Mixing toward white would put a colour on screen that the theme's palette does
not contain, which is the one thing the token contract exists to prevent.

🔴 AND TWO THEMES CANNOT HAVE ONE, WHICH THE GATE FOUND RATHER THAN TASTE.
A bevel needs room on BOTH sides of the face it is drawn on.

  - `antiseptic` is 2001: primary on true black, and its declared register is
    zero depth. Its surfaces sit so close to black that a shadow ring has
    nowhere to go - measured, the darkened ring came back at 1.03:1 against
    the face, which is not a ring, it is a rounding error. antiseptic declares
    `none`, exactly the way it declares no field shader: that is its register,
    not an omission.
  - `holo` is additive, because a projection cannot be darker than the room.
    A shadow is not available to it at all. It declares `lit`: two highlight
    rings and no shadow, so its depth is read from brightness falloff rather
    than from a dark side. That is a MECHANISM difference rather than a hue
    difference, which is the test every theme in this kit has to pass.

The rings must be strictly monotonic or raised stops reading as raised, so
`check_bevels()` measures every ring against the face and against its
neighbour and exits non-zero if any theme's ladder is flat.
"""

# The minimum contrast between adjacent rings for the step to be a step
# rather than a rounding error. Below this the bevel is not shallow, it is
# absent, and a control claiming an affordance it cannot draw is the failure
# this whole family exists to avoid.
RING_MIN = 1.10


def bevel_face(name):
    """The surface a bevel is drawn on.

    ⚠️ NOT `--ov-btn-bg`. Four themes put their buttons on `field`, the
    deepest ground, which has no room beneath it for a shadow ring at all. A
    bevel needs room on both sides, so the bevelled variant lifts its own face
    to `raised` and the gate measures there. That is a real constraint of the
    treatment rather than a styling preference, and it is why `.ov-bevel` sets
    its own background.
    """
    return THEMES[name]['raised']


def bevel_rings(name, face=None):
    """(hi2, hi, face, lo, lo2) for a theme, darkest last. None where the
    theme's mode does not have that ring."""
    sc = SCALARS[name]
    face = face or bevel_face(name)
    if sc['bevel'] == 'none':
        return None
    ink = THEMES[name]['ink']
    hi = mix(face, ink, sc['bevel_lift'])
    # ⚠️ 1.9 put hi2 close enough to white that the deep bevel's outer ring
    # read as a drawn white stroke around the plate rather than as a lit
    # chamfer, and the bolt heads blew out to flat light discs. A second rung
    # has to be a rung: brighter than hi, not a different material.
    hi2 = mix(face, ink, min(0.95, sc['bevel_lift'] * 1.45))
    if sc['bevel'] == 'lit':
        return dict(hi2=hi2, hi=hi, face=face, lo=None, lo2=None)
    lo = mix(face, '#000000', sc['bevel_drop'])
    lo2 = mix(face, '#000000', min(0.95, sc['bevel_drop'] * 1.5))
    return dict(hi2=hi2, hi=hi, face=face, lo=lo, lo2=lo2)


def bevel_offsets(name):
    """Where the lit band sits, from the declared light direction.

    `light` is the direction the light comes FROM, clockwise from straight
    above. An inset shadow offset by (dx, dy) paints its band on the opposite
    edge, so the offset is the negation of the vector pointing at the light:
    dx = -sin(theta), dy = +cos(theta).

    🔴 AND IT IS SNAPPED TO WHOLE PIXELS, WHICH QUANTISES THE DIRECTION.
    A 315 degree light at one pixel came out as an offset of (0.71, 0.71),
    and a 0.71px inset band is not a band: the browser antialiases it to a
    grey suggestion, and raised and pressed became indistinguishable at a
    glance. A control whose two states look the same is not stating an
    affordance, which is the entire justification for this family existing.

    So the offset is rounded to whole pixels, and the consequence is stated
    rather than hidden: a bevel of N pixels can only express EIGHT
    directions, the same way the character ladder can only express eight
    levels. A theme declaring 300 degrees and a theme declaring 315 get the
    same bevel, so `check_bevels()` prints the direction actually DRAWN next
    to the one declared, and they had better agree.
    """
    import math
    sc = SCALARS[name]
    th = math.radians(sc['light'])
    px = sc['bevel_px']
    fx, fy = -math.sin(th), math.cos(th)
    # Snap to the eight-way grid a whole-pixel offset can actually draw.
    q = lambda v: 0 if abs(v) < 0.383 else (1 if v > 0 else -1)
    dx, dy = q(fx) * px, q(fy) * px
    if px and not dx and not dy:            # a direction that rounded to nothing
        dy = px
    return (dx, dy)


def drawn_angle(name):
    """The direction the snapped offset actually draws, in declared terms."""
    import math
    dx, dy = bevel_offsets(name)
    if not dx and not dy:
        return None
    # invert the mapping in bevel_offsets
    return round(math.degrees(math.atan2(-dx, dy)) % 360)


def bevel_face_panel(name):
    """The other surface a bevel is drawn on.

    ⭐ A RACK HAS TWO LEVELS, WHICH IS WHY THERE ARE TWO RING SETS. The
    faceplate is raised out of the field; the controls are raised out of the
    faceplate. Deriving both from one face would light a knob exactly like the
    panel it is screwed to, and the whole point of the treatment is that a
    mounted thing reads as mounted.

    So the faceplate's rings come from `panel` and the controls' from
    `raised`, and because both are mixed toward the same ink by the same
    declared light, the rack still reads as one object under one lamp.
    """
    return THEMES[name]['panel']


def bevel_shadows(name, face=None):
    """The four box-shadow token values for a theme."""
    r = bevel_rings(name, face)
    if not r:
        return dict(raise_='none', sink='none', raise_deep='none', sink_deep='none')
    dx, dy = bevel_offsets(name)
    n = lambda v: f'{v}px'
    out = n(dx), n(dy), n(-dx), n(-dy)
    x, y, nx, ny = out
    lo = r['lo'] or r['face']       # `lit` has no shadow; it repeats the face
    lo2 = r['lo2'] or r['face']
    return dict(
        raise_=f'inset {x} {y} 0 {r["hi"]}, inset {nx} {ny} 0 {lo}',
        sink=f'inset {x} {y} 0 {lo}, inset {nx} {ny} 0 {r["hi"]}',
        # A second ring, drawn further in, so the edge has a real profile.
        # Monotonic outward: lo2 < lo < face < hi < hi2.
        raise_deep=(f'inset {x} {y} 0 {r["hi2"]}, inset {nx} {ny} 0 {lo2}, '
                    f'inset {n(dx * 2)} {n(dy * 2)} 0 {r["hi"]}, '
                    f'inset {n(-dx * 2)} {n(-dy * 2)} 0 {lo}'),
        sink_deep=(f'inset {x} {y} 0 {lo2}, inset {nx} {ny} 0 {r["hi2"]}, '
                   f'inset {n(dx * 2)} {n(dy * 2)} 0 {lo}, '
                   f'inset {n(-dx * 2)} {n(-dy * 2)} 0 {r["hi"]}'),
    )


def bolt_image(name):
    """One countersunk bolt, lit from the theme's own declared direction.

    Drawn as a radial gradient whose focus is pushed TOWARD the light, so the
    dome catches on the same side every raised control does. Getting this from
    the same declaration as the bevels is the point: a face whose bolts are lit
    from one direction and whose knobs are lit from another is two objects.
    """
    import math
    sc = SCALARS[name]
    r = bevel_rings(name)
    if not r:
        return 'none'
    th = math.radians(sc['light'])
    lx, ly = math.sin(th), -math.cos(th)      # unit vector at the light
    fx = round(50 + lx * 26)
    fy = round(50 + ly * 26)
    lo = r['lo'] or r['face']
    # A countersunk head, which is a DOME IN A RECESS and needs both halves.
    # ⚠️ Two earlier versions failed for opposite reasons: at 11px with wide
    # dark stops the head read as a small square, and with the light stops
    # widened it read as a flat disc with a slot through it. What was missing
    # was the recess - a bolt is not a bright dot, it is a dark hole with a lit
    # dome sitting down inside it, and the dark ring is what makes it read as
    # sunk into the plate rather than stuck onto it.
    lo2 = r['lo2'] or r['face']
    return (f'radial-gradient(circle at {fx}% {fy}%, '
            f'{r["hi2"]} 0 13%, {r["hi"]} 13% 32%, {r["face"]} 32% 48%, '
            f'{lo} 48% 63%, {lo2} 63% 78%, transparent 80%)')


def face_wash(name):
    """A faceplate is brighter nearer its light. One gradient, same source.

    ⭐ This is the difference between depth and decoration. A vertical sheen on
    a panel is the oldest skeuomorphic reflex there is and it usually encodes
    nothing - but a plate lit from the top-left really is brighter at the
    top-left, and this gradient runs along the SAME `--ov-light` the bevel
    rings and the bolt heads are derived from. Nothing here is a free
    parameter: change the theme's light and the chamfer, the bolts and the
    sheen all turn together, which is what stops the face reading as several
    objects photographed under different lamps.

    Kept deliberately shallow. It is the falloff across a flat plate, not a
    curved surface, and a strong version would be exactly the reflex above.
    """
    import math
    sc = SCALARS[name]
    if sc['bevel'] == 'none':
        return 'none'
    face = bevel_face_panel(name)
    ink = THEMES[name]['ink']
    near = mix(face, ink, 0.055)
    far = mix(face, '#000000', 0.30)
    # A CSS gradient angle points in the direction the gradient RUNS, and it is
    # measured clockwise from "to top". The light comes FROM `light`, so the
    # bright end is at that side and the gradient runs away from it.
    ang = (sc['light'] + 180) % 360
    return f'linear-gradient({ang}deg, {near}, {far})'


def check_bevels():
    """Every ring strictly ordered against the face and its neighbour."""
    failures = 0
    print('\n== bevel rings ==  (a bevel is a light DIRECTION, never an inversion)')
    print('   ~ marks a shadow rung: ordered, but ungated, because a dark '
          'field has no room below it')
    for name in THEMES:
        sc = SCALARS[name]
        r = bevel_rings(name)
        if not r:
            print(f'  {name:11} mode none    - declared: {"zero depth is the register"}')
            continue
        dx, dy = bevel_offsets(name)
        ladder = [('hi2', r['hi2']), ('hi', r['hi']), ('face', r['face'])]
        if r['lo']:
            ladder += [('lo', r['lo']), ('lo2', r['lo2'])]
        bits = []
        bad = []
        # The ladder is ordered lightest first, so each rung must be strictly
        # lighter than the next. ⚠️ This comparison was written the wrong way
        # round first time and reported all nine themes as failing every step,
        # which is the tell: a gate that fails everything is measuring itself.
        #
        # 🔴 AND THE TWO SIDES ARE NOT GATED ALIKE, WHICH THE MEASUREMENT
        # DECIDED RATHER THAN TASTE. Every theme here is dark, so there is
        # 1.66:1 to 3.09:1 of room ABOVE the face and only 1.02:1 to 1.14:1
        # below it: a surface already near black has almost nowhere to darken
        # to. A two-sided bevel therefore spends half its budget on a side
        # that cannot carry information.
        #
        # That is the same split the palette already makes between
        # `line-strong` and `line`. The HIGHLIGHT rings carry the affordance
        # and are gated at RING_MIN. The SHADOW rings are decorative furniture
        # in exactly the sense `--ov-line` is, and are ungated - but they are
        # still required to be strictly ORDERED, because a shadow lighter than
        # its face is a lie about which way the light is coming from, and the
        # light direction is the one thing the whole treatment encodes.
        for i in range(1, len(ladder)):
            a, b = ladder[i - 1], ladder[i]
            lit_side = b[0] == 'face' or a[0] in ('hi', 'hi2')
            if luminance(a[1]) > luminance(b[1]):
                step = ratio(a[1], b[1])
                bits.append(f'{a[0]}>{b[0]} {step:.2f}'
                            + ('' if lit_side else '~'))
                if lit_side and step < RING_MIN:
                    bad.append(f'{a[0]}/{b[0]} only {step:.2f}:1')
            else:
                bad.append(f'{a[0]} is not lighter than {b[0]}')
        mode = sc['bevel']
        drawn = drawn_angle(name)
        agree = '' if drawn == sc['light'] else f' -> DRAWS {drawn}deg'
        if agree:
            bad.append(f'declared {sc["light"]}deg but a {sc["bevel_px"]}px '
                       f'bevel can only draw {drawn}deg')
        print(f'  {name:11} mode {mode:4} light {sc["light"]:3}deg{agree} '
              f'offset ({dx:+g},{dy:+g})  ' + '  '.join(bits)
              + ('   FAIL: ' + '; '.join(bad) if bad else '   pass'))
        failures += len(bad)
    return failures


SIZES = [10, 11, 12, 14, 16, 20, 28]


# Code roles per theme: name, kw, str, punct. A code block is its own surface,
# so it does NOT take the theme's text palette (in terminal that put t-name on
# t-kw at ΔE 1.8). The rule that produced them: the theme's --ov-accent plus
# rotations of 150 and 60 degrees, lightened until each clears 4.5 on
# --ov-raised; --ov-alarm anchors a theme whose accent has no hue; punct is
# --ov-faint with the chroma stripped. The values are RECORDED, not re-derived,
# because they were solved once by hand and a re-derivation that rounds
# differently would move every block on the site. tools/highlight.py gates
# them for contrast and separation; check_code_roles() below gates that
# tokens.css carries them at all.
CODE_ROLES = {
    'terminal': ('#fff5aa', '#5dc6ec', '#94c178', '#adadb2'),
    'industrial': ('#90f19a', '#c1a2ff', '#00cbe0', '#a8b0a9'),
    'cyber': ('#f0e15f', '#6cbbff', '#37ce95', '#a6a6af'),
    'antiseptic': ('#72a2ff', '#ff9a53', '#de8ee8', '#7a7a7a'),
    'esper': ('#fbb240', '#00cbfe', '#89c55d', '#999690'),
    'neo': ('#92ed94', '#bea3ff', '#00cbdd', '#acb4ae'),
    'machina': ('#f47c6c', '#00d6ba', '#d7ab1b', '#beb4b2'),
    'holo': ('#ffd1df', '#74cd9f', '#dea45f', '#a7acb4'),
    'aegis': ('#5ca7ff', '#ff9563', '#d392f3', '#9aa0a7'),
    'vector': ('#e07dc5', '#9bc959', '#ff8c68', '#9c979f'),
}
CODE_ROLE_NAMES = ('name', 'kw', 'str', 'punct')


def code_role_faults(css):
    """Every theme block in `css` must declare its four code roles, each equal
    to CODE_ROLES. Returns the faults, empty when the file is whole."""
    import re
    faults = []
    blocks = dict(re.findall(r'\[data-ov-theme="(\w+)"\] \{(.*?)\n\}', css, re.S))
    for name in THEMES:
        if name not in blocks:
            faults.append(f'{name}: no theme block in tokens.css')
            continue
        for role, want in zip(CODE_ROLE_NAMES, CODE_ROLES[name]):
            m = re.search(rf'--ov-code-{role}:\s*(#[0-9a-fA-F]{{6}})\s*;', blocks[name])
            if not m:
                faults.append(f'{name}: --ov-code-{role} is missing')
            elif m.group(1).lower() != want:
                faults.append(f'{name}: --ov-code-{role} is {m.group(1)}, CODE_ROLES says {want}')
    return faults


def check_code_roles(path='src/tokens.css'):
    """🔴 THE CODE ROLES ONCE LIVED ONLY IN THE COMMITTED FILE. This script
    emitted tokens.css without them, so regenerating deleted all forty values
    and nothing here noticed; highlight.py, which did check them, is not in the
    release gate. Now this reads the file on disk.

    ⚠️ AND IT PROVES IT CAN FAIL, every run: the same file with one theme's
    code roles deleted must produce faults, or this check is counted failed."""
    import re
    try:
        css = open(path).read()
    except FileNotFoundError:
        print(f'\n  code roles   FAIL: {path} missing')
        return 1
    bad = 0
    print('\n== code roles ==')
    for fault in code_role_faults(css):
        bad += 1
        print(f'  FAIL: {fault}')
    planted = re.sub(r'--ov-code-kw:[^;]*;', '', css, count=1)
    if planted == css or not code_role_faults(planted):
        bad += 1
        print('  FAIL: a tokens.css missing a code role was not refused')
    if not bad:
        print(f'  {len(THEMES)} themes carry all {len(CODE_ROLE_NAMES)} roles; '
              'a planted deletion was refused   pass')
    return bad


def emit_css(path='src/tokens.css'):
    """Generate tokens.css. Never hand-edit that file; re-run this."""
    colour_keys = ['field', 'panel', 'raised', 'line', 'line_strong',
                   'ink', 'dim', 'faint', 'accent', 'accent_2', 'alarm']
    out = ["/* GENERATED by tools/palette.py. Do not edit; re-run the script. */",
           "/* Every colour here has passed the contrast gate in that script. */",
           ""]
    out.append(":root {")
    for i, px in enumerate(SIZES, 1):
        out.append(f"  --ov-size-{i}: {px}px;")
    out.append("  --ov-font-mono: 'IBM Plex Mono', ui-monospace, monospace;")
    out.append("  --ov-ease: cubic-bezier(.2, .7, .3, 1);")
    # How far the panel label rides above its border box. Read by the panel's
    # clip-path AND by the arrival mask's wrapper, so both agree.
    out.append("  --ov-label-overhang: 14px;")

    out.append("}")
    out.append("")
    for name in THEMES:
        t = THEMES[name]
        sc = SCALARS[name]
        sel = ':root, [data-ov-theme="terminal"]' if name == 'terminal'             else f'[data-ov-theme="{name}"]'
        out.append(f"{sel} {{")
        for k in colour_keys:
            out.append(f"  --ov-{k.replace('_', '-')}: {t[k]};")
        out.append("")
        if name == 'terminal':
            out += [
                "  /* Code roles. A code block is its own surface, so it does NOT inherit this",
                "     theme's text palette: in a monochrome theme that collapsed t-name onto",
                "     t-kw at ΔE 1.8 and every block on the site read as one flat colour.",
                "     ⭐ THE RULE, so this is not forty hand-picked values: the palette is this",
                "     theme's own --ov-accent plus two fixed rotations of it, 150° and 60°, at a",
                "     lightness raised until each clears 4.5 on --ov-raised, which is the ground",
                "     a block actually sits on. Where the accent has no hue to rotate, --ov-alarm",
                "     supplies the anchor, being the only other hue such a theme states.",
                "     ⚠️ Punctuation is the exception and carries NO hue: it is structure, not",
                "     meaning, so it is --ov-faint with the chroma stripped out. That is also",
                "     what stops it colliding with a rotation, which it did in aegis and vector.",
                "     Recorded in tools/palette.py and checked by tools/highlight.py. */",
            ]
        else:
            out.append("  /* Code roles, by the rule stated in the terminal block above. */")
        for role, value in zip(CODE_ROLE_NAMES, CODE_ROLES[name]):
            out.append(f"  --ov-code-{role}: {value};")
        for k in ('corner', 'bezel', 'rule', 'pad', 'gap'):
            out.append(f"  --ov-{k}: {sc[k]}px;")
        out.append(f"  --ov-shear: {sc['shear']}deg;")

        # Control FORM, so a theme differs structurally and not only in colour.
        # A terminal has no buttons at all: it has text you can select, and the
        # brackets are how it says "this is a control". 2001 has flat colour
        # blocks with no border. Those are different objects, not one object
        # recoloured, and the difference belongs in tokens so chrome.css never
        # names a theme.
        bw = {'0': '0px', 'rule': f"{sc['rule']}px",
              'bezel': f"{sc['bezel']}px"}[sc['btn_border']]
        out.append(f"  --ov-btn-border: {bw};")
        # ⚠️ `none` is not one of the surfaces, and it is not `field` spelled
        # differently. vector's field is a shader drawing a live picture, and
        # a button painted the field's own colour is an opaque black slab
        # punched through it: the same hex, and it still occludes. A theme
        # whose whole claim is that unlit means the beam was never there has
        # to let the beam through, so it takes no background at all.
        out.append("  --ov-btn-bg: transparent;" if sc['btn_bg'] == 'none'
                   else f"  --ov-btn-bg: {t[sc['btn_bg']]};")
        out.append(f"  --ov-ctl-corner: {sc['corner'] if sc['ctl_corner'] else 0}px;")

        # Bevels. The light DIRECTION is declared and the rings are derived
        # from it, never inverted. See the bevel block above.
        out.append(f"  --ov-light: {sc['light']}deg;")
        # The unit vector pointing AT the light, precomputed. CSS has sin()
        # and cos() now, but an unsupported calc() invalidates the whole
        # declaration silently, and the derivation belongs beside the gate
        # rather than in a stylesheet in any case.
        import math as _m
        _th = _m.radians(sc['light'])
        out.append(f"  --ov-light-x: {_m.sin(_th):.3f};")
        out.append(f"  --ov-light-y: {-_m.cos(_th):.3f};")
        out.append(f"  --ov-bevel-mode: {sc['bevel']};")
        bv = bevel_shadows(name)
        out.append(f"  --ov-bevel-raise: {bv['raise_']};")
        out.append(f"  --ov-bevel-sink: {bv['sink']};")
        out.append(f"  --ov-bevel-raise-deep: {bv['raise_deep']};")
        out.append(f"  --ov-bevel-sink-deep: {bv['sink_deep']};")
        # The faceplate set. Same light, one surface down. See bevel_face_panel.
        bf = bevel_shadows(name, bevel_face_panel(name))
        out.append(f"  --ov-bevel-face-raise: {bf['raise_']};")
        out.append(f"  --ov-bevel-face-sink: {bf['sink']};")
        out.append(f"  --ov-bevel-face-raise-deep: {bf['raise_deep']};")

        # The ring colours on their own, for anything that has to draw its own
        # lit and unlit sides rather than take a ready-made shadow.
        _r = bevel_rings(name)
        out.append(f"  --ov-bevel-hi: {_r['hi'] if _r else t['line_strong']};")
        out.append(f"  --ov-bevel-lo: {(_r['lo'] or _r['face']) if _r else t['field']};")

        # A BOLT, as one finished background-image value.
        #
        # ⭐ It is not decoration, because decoration here has to encode
        # something: a bolt says THIS FACE IS FIXED. A rack panel is screwed
        # down and carries them; anything you can drag does not, because it is
        # not bolted to anything. That is the same rule the corner treatment
        # already follows - corners say WHERE a panel sits, never which panel
        # it is.
        #
        # 🔴 antiseptic emits `none`, and that is the third thing it declines
        # after the field shader and the bevel. A 2001 panel has no visible
        # fixings at all; drawing them would be the era strand arriving through
        # the back door.
        out.append(f"  --ov-bevel-bolt: {bolt_image(name)};")
        out.append(f"  --ov-bevel-face-wash: {face_wash(name)};")
        # Control furniture. See FURNITURE for what each value means and why
        # `none` is a register rather than an omission.
        #
        # 🔴 THESE ARE EMITTED PER THEME AND FULLY RESOLVED, WHICH IS NOT A
        # STYLE CHOICE. A custom property whose value contains var() has that
        # var() SUBSTITUTED WHERE THE PROPERTY IS DECLARED, not where it is
        # used, and the computed string is what inherits. Declaring
        #
        #     :root { --ov-ctl-clip: polygon(var(--ov-ctl-chamfer) 0, ...) }
        #
        # therefore bakes in whatever :root happens to hold - which here is
        # terminal's zeros - and every other theme silently inherits a
        # rectangle. It was written that way first and the clip vanished in
        # all nine themes at once, which is the same tell the bevel gate gave:
        # a thing that fails or flattens EVERYWHERE is measuring itself.
        # --ov-bevel-bolt was already per theme for the same reason.
        fu = FURNITURE[sc['furniture']]
        # The furniture colour, as a literal. chrome.css overrides it per
        # state on the element, where a var() does resolve against the
        # element's own theme.
        out.append(f"  --ov-furn: {t['line_strong']};")
        # The control silhouette, resolved. It carries BOTH corner mechanisms
        # at once - the single cut corner that says where a control sits, and
        # the four-corner chamfer that makes a control an armoured plate. No
        # theme sets both, and adding them at the bottom right is what lets one
        # polygon serve either. At zero for both it is exactly the rectangle.
        _c = sc['corner'] if sc['ctl_corner'] else 0
        _ch = fu['chamfer']
        out.append(
            f"  --ov-ctl-clip: polygon({_ch}px 0, calc(100% - {_ch}px) 0, "
            f"100% {_ch}px, 100% calc(100% - {_c + _ch}px), "
            f"calc(100% - {_c + _ch}px) 100%, {_ch}px 100%, "
            f"0 calc(100% - {_ch}px), 0 {_ch}px);")
        out.append(f'  --ov-bracket-o: "{"[ " if fu["wrap"] else ""}";')
        out.append(f'  --ov-bracket-c: "{" ]" if fu["wrap"] else ""}";')
        for k in ('tick', 'over', 'edge', 'base', 'chamfer'):
            out.append(f"  --ov-ctl-{k}: {fu[k]}px;")

        # The voice. Carried as tokens for the same reason the shader
        # uniforms are: a theme's contract is the token surface, and sound
        # would otherwise be the one axis in TOKENS.md that a theme could not
        # reach. src/ov-sound.js reads these off the element the sound was
        # played FROM, so a button inside a theme sounds like that theme.
        vo = VOICE[sc['voice']]
        for k in ('pitch', 'decay', 'gain', 'grit'):
            out.append(f"  --ov-snd-{k}: {vo[k]};")
        out.append(f"  --ov-snd-wave: {vo['wave']};")

        # Field shader uniforms, carried as tokens so the SHADER is driven by
        # the same control surface as everything else. A canvas is invisible to
        # the cascade, so the theme contract has to be implemented a second
        # time for it; this is that second time, made explicit rather than
        # discovered later. antiseptic declares `none`: no field shader at all
        # is its register, not an omission.
        out.append(f"  --ov-fx-shader: {sc['fx']};")
        out.append(f"  --ov-fx-wash: {sc['wash']};")
        out.append(f"  --ov-fx-spread: {sc['spread']};")
        out.append(f"  --ov-fx-haze: {sc['haze']};")
        out.append(f"  --ov-fx-chroma: {sc['chroma']};")
        out.append(f"  --ov-fx-glitch: {sc['glitch']};")

        # How text ARRIVES on this register. A terminal types, worn phosphor
        # catches and drops out, a film loop cuts, an Esper scan reads across,
        # and cyber arrives damaged. animation-name takes a custom property, so
        # naming the keyframes is the whole wiring, and any element can
        # override the token inline to mix.
        out.append(f"  --ov-text-anim: {sc['text_anim']};")
        out.append(f"  --ov-text-ease: {sc['text_ease']};")
        out.append(f"  --ov-text-steps: {sc['text_steps']};")
        out.append(f"  --ov-text-dur: {sc['text_dur']}ms;")
        out.append(f"  --ov-text-idle: {sc['text_idle']};")
        # A per-CHARACTER effect, for registers where the line moving is not
        # enough. cyber tears its whole line and then its letters settle.
        out.append(f"  --ov-text-char: {sc['char_fx']};")
        # What rides the leading edge of the reveal. This, not the easing, is
        # what makes typing look like typing and a scan look like a scan.
        out.append(f"  --ov-text-mark-w: {sc['mark_w']};")
        out.append(f"  --ov-text-mark-h: {sc['mark_h']};")
        out.append(f"  --ov-text-mark-drop: {sc['mark_drop']};")
        out.append(f"  --ov-text-mark-rate: {sc['mark_rate']};")
        out.append(f"  --ov-text-mark-bg: {sc['mark_bg']};")
        out.append(f"  --ov-text-mark-anim: {sc['mark_anim']};")
        out.append(f"  --ov-case: {sc['case']};")
        out.append(f"  --ov-accent-mode: {sc['accent_mode']};")
        # Decorative GL (ov-ornament). The MODE is per theme so every ornament
        # in a surface moves the same way: "which ornament is this" is not a
        # question an ornament that encodes nothing should be answering.
        out.append(f"  --ov-ornament: {sc['ornament']};")
        out.append(f"  --ov-ornament-intensity: {sc['orn_intensity']};")
        out.append(f"  --ov-ornament-rate: {sc['orn_rate']};")
        # A monochrome theme cannot say "lit" with more brightness: its ink is
        # already at the top of the ladder. It says it by swapping fore and
        # back, which is what a real terminal does for a selection.
        if sc['accent_mode'] == 'invert':
            out.append(f"  --ov-lit-bg: {t['accent']};")
            out.append(f"  --ov-lit-fg: {t['field']};")
        else:
            out.append(f"  --ov-lit-bg: {t['panel']};")
            out.append(f"  --ov-lit-fg: {t['accent']};")
        out.append(f"  --ov-track: {sc['track']}px;")
        for k in ('grain', 'vignette', 'bloom'):
            out.append(f"  --ov-{k}: {sc[k]};")
        out.append(f"  --ov-scan-opacity: {sc['scan_opacity']};")
        out.append(f"  --ov-scan-pitch: {sc['scan_pitch']}px;")
        for k in ('boot', 'cascade', 'dur_fast', 'dur_base', 'dur_slow'):
            out.append(f"  --ov-{k.replace('_', '-')}: {sc[k]}ms;")
        out.append("}")
        out.append("")
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Everything the kit ships lives in one `overscan` cascade layer so a
    # consumer's plain CSS beats it with no specificity fight. The first two
    # lines are the GENERATED banner and stay outside, so the file still says
    # what it is before it says anything else.
    banner, body = out[:2], out[2:]
    text = "\n".join(banner) + "\n\n@layer overscan {\n" \
        + "\n".join(body).strip("\n") + "\n}\n"
    with open(path, 'w') as f:
        f.write(text)
    return path


def worst_surface(theme, token, name):
    return min(SURFACES, key=lambda s: delivered(name, theme[token], theme[s]))

def solve_to(colour, background, target, theme_name, steps=1024):
    """Slide toward white until delivered contrast reaches `target`.

    Returns (colour, reached, hit_ceiling). hit_ceiling means even pure white
    does not reach the target under this finish, which is the finish being too
    heavy for the ladder rather than the colour being wrong.
    """
    best = colour
    for i in range(0, steps + 1):
        cand = mix(colour, '#ffffff', i / steps)
        r = delivered(theme_name, cand, background)
        if r >= target:
            return cand, r, False
        best = cand
    return best, delivered(theme_name, best, background), True


def ladder_report(fix=False):
    """Solve the three-step text hierarchy against delivered contrast."""
    problems = 0
    for name, theme in THEMES.items():
        sc = SCALARS[name]
        fin = ('no finish' if not (sc['grain'] or sc['scan_opacity'])
               else f"grain {sc['grain']} / scan {sc['scan_opacity']}")
        print(f'\n== {name} ==  ({fin})')
        surface = 'raised'
        prev = None
        for tok in ('faint', 'dim', 'ink'):
            target = LADDER[tok]
            fixed, got, ceiling = solve_to(theme[tok], theme[surface], target, name)
            sep = '' if prev is None else f'  step {got / prev:.2f}x'
            if ceiling:
                problems += 1
                print(f'  {tok:6} target {target:4.1f}  UNREACHABLE, white gives '
                      f'{got:.2f}:1{sep}')
            else:
                print(f'  {tok:6} target {target:4.1f}  {fixed}  {got:5.2f}:1{sep}')
                if fix:
                    theme[tok] = fixed
            prev = got
    return problems


def check_transparent_controls():
    """A transparent control has to be sitting on the surface we measured.

    ⚠️ EVERY CONTRAST NUMBER ABOVE IS AGAINST A NAMED SURFACE. A button that
    paints its own background is on that background whatever is behind it, so
    the measurement holds. `btn_bg='none'` gives that up: the control's label
    is now on whatever the PANEL is showing, and if a theme's panel differs
    from its field then the number printed for that theme was measured against
    the wrong thing.

    vector can take it because its panel IS its field - a beam cannot fill a
    region, so there is nothing for a panel to be. Nothing else here can, and
    the next theme that reaches for `transparent` because it looked good will
    be told why not rather than finding out from a contrast report that was
    quietly measuring the wrong surface.
    """
    bad = 0
    for name, sc in SCALARS.items():
        if sc['btn_bg'] != 'none':
            continue
        t = THEMES[name]
        if t['field'] == t['panel']:
            print(f"\n  {name:12} btn_bg none  - panel is field, so the "
                  f"measured surface is the one it sits on   pass")
        else:
            bad += 1
            print(f"\n  {name:12} btn_bg none  FAIL: panel {t['panel']} is "
                  f"not field {t['field']}, so a transparent control is on an "
                  f"unmeasured surface")
    return bad


def check(fix=False):
    failures = 0
    for name, theme in THEMES.items():
        sc = SCALARS[name]
        fin = ('no finish' if not (sc['grain'] or sc['scan_opacity'])
               else f"grain {sc['grain']} / scan {sc['scan_opacity']} at pitch {sc['scan_pitch']}")
        print(f'\n== {name} ==  ({fin}; ratios are DELIVERED, not flat)')
        for token, gate in GATES.items():
            if gate is None:
                r = delivered(name, theme[token], theme['raised'])
                print(f'  {token:12} {r:5.2f}:1 on raised   (ungated, decorative)')
                continue
            surface = worst_surface(theme, token, name)
            r = delivered(name, theme[token], theme[surface])
            ok = r >= gate
            note = f'{r:5.2f}:1 vs {surface:6} (gate {gate})'
            if ok:
                print(f'  {token:12} {note}  pass')
            else:
                failures += 1
                fixed, t = solve(theme[token], theme[surface], gate, name)
                flat = ratio(theme[token], theme[surface])
                print(f'  {token:12} {note}  FAIL -> {fixed} '
                      f'({delivered(name, fixed, theme[surface]):.2f}:1 delivered, '
                      f'was {flat:.2f}:1 flat, moved {t * 100:.1f}% to white)')
                if fix:
                    theme[token] = fixed
    failures += check_bevels()
    failures += check_transparent_controls()
    failures += check_code_roles()
    return failures

if __name__ == '__main__':
    if '--ladder' in sys.argv:
        n = ladder_report(fix=True)
        print(f"\n{n} rung(s) unreachable.")
        if '--emit' in sys.argv and not n:
            print('wrote', emit_css())
        sys.exit(0)
    if '--css' in sys.argv:
        n = check()
        if n:
            print('\nrefusing to emit CSS while the gate fails')
            sys.exit(1)
        print('\nwrote', emit_css())
        sys.exit(0)
    fix = '--fix' in sys.argv
    n = check(fix=fix)
    if fix and n:
        print('\n== solved values ==')
        for name, theme in THEMES.items():
            print(f'\n{name}:')
            for k in ('field', 'panel', 'raised', 'line', 'line_strong',
                      'ink', 'accent', 'accent_2', 'dim', 'faint', 'alarm'):
                print(f"    {k:12} {theme[k]}")
    sys.exit(0 if fix else min(n, 1))
