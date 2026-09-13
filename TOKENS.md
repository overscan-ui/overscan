# Token contract (draft, pre-sketch)

The single control surface. Every value in the kit reads from this list, so a
theme is a different set of values for the same names and nothing else changes.

Prefix is `--ov-`. Status: **draft**, written 2026-09-08 as the input to the
Pencil sketch. Nothing here is built yet.

> Every contrast number below is produced by `tools/palette.py`, never typed by
> hand. Run `python3 tools/palette.py` to re-validate; it exits non-zero if any
> token fails its gate. A measurement that names its
> own colours is a claim, not a measurement.

## Axis 1: palette

Semantic slots, not literal colours. Nothing outside this axis names a colour.

| token | role |
|---|---|
| `--ov-field` | the deepest ground, the screen itself |
| `--ov-panel` | a surface above the field |
| `--ov-raised` | a surface above a panel. **The worst case for contrast** |
| `--ov-line` | decorative hairline. Ungated, because it is not information |
| `--ov-line-strong` | a boundary that carries meaning. Gated at 3:1 |
| `--ov-ink` | primary text |
| `--ov-dim` | secondary text |
| `--ov-faint` | tertiary text |
| `--ov-accent` | the lit state, the phosphor |
| `--ov-accent-2` | a second lit hue, never the alarm. Collapses to `accent` in a monochrome theme |
| `--ov-alarm` | **the only colour permitted to read as alarm** |

The alarm slot being separate from accent is the policy, not a convenience. On a
light field saturation itself was measured reading as alarm, so a theme that
lets accent and alarm collapse into one hue has no way to say "this is fine" and
"this is not" in the same glance.

### The gate, and why it is measured against `raised`

Text clears **4.5:1**, meaningful non-text boundaries clear **3:1**, decorative
hairlines are ungated. The gate is measured against the *worst* surface a token
can land on, which is `--ov-raised`, not `--ov-field`.

This is not pedantry. In the first pass every theme's `faint` cleared 4.5:1 on
the field and failed two surfaces up. A palette validated against the darkest
background passes tokens that fail in real use.

`tools/palette.py --fix` solves a failing token by sliding it toward white until
it *just* clears, so the correction is the smallest change that works rather
than an arbitrary lightening. `faint` moved 2 to 4 percent; `line-strong` moved
9 to 14 percent, which says the first guess at a meaningful boundary was much
too quiet in all three themes.

### Values, all passing

**terminal** - default. White phosphor on a dark field, flat, glowing, gritty

| token | value | worst ratio |
|---|---|---|
| field | `#0a0a0b` | |
| panel | `#101013` | |
| raised | `#17171b` | |
| line | `#26262c` | 1.19:1 (ungated) |
| line-strong | `#63636b` | 3.00:1 |
| ink | `#dcdcde` | 13.05:1 |
| dim | `#9a9aa0` | 6.39:1 |
| faint | `#7f7f88` | 4.51:1 |
| accent | `#ffffff` | 17.88:1 |
| accent-2 | `#ffffff` | 17.88:1 |
| alarm | `#ffb84d` | 10.40:1 |

**industrial** - *Alien*. Green phosphor, chunky bezels, amber warnings

| token | value | worst ratio |
|---|---|---|
| field | `#050806` | |
| panel | `#0b110c` | |
| raised | `#111a13` | |
| line | `#1e2c20` | 1.22:1 (ungated) |
| line-strong | `#4e6b54` | 3.01:1 |
| ink | `#8ef09a` | 12.77:1 |
| dim | `#5c9d68` | 5.48:1 |
| faint | `#538d5f` | 4.52:1 |
| accent | `#33ff66` | 13.24:1 |
| accent-2 | `#6fe8d0` | 11.96:1 |
| alarm | `#ffa726` | 9.15:1 |

**cyber** - dense, yellow and cyan, slanted, worn

| token | value | worst ratio |
|---|---|---|
| field | `#08080a` | |
| panel | `#0e0e12` | |
| raised | `#15151b` | |
| line | `#282833` | 1.25:1 (ungated) |
| line-strong | `#626271` | 3.03:1 |
| ink | `#d6d6de` | 12.58:1 |
| dim | `#9494a2` | 6.08:1 |
| faint | `#7e7e8d` | 4.55:1 |
| accent | `#f2e14c` | 13.55:1 |
| accent-2 | `#4cd8e8` | 10.65:1 |
| alarm | `#ff2e63` | 5.04:1 |

**antiseptic** - *2001*. Primary on true black, rectilinear, zero depth

| token | value | worst ratio |
|---|---|---|
| field | `#000000` | |
| panel | `#050505` | |
| raised | `#0a0a0a` | |
| line | `#1a1a1a` | 1.14:1 (ungated) |
| line-strong | `#5d5d5d` | 3.01:1 |
| ink | `#ffffff` | 19.80:1 |
| dim | `#a0a0a0` | 7.57:1 |
| faint | `#7a7a7a` | 4.61:1 |
| accent | `#2d6eff` | 4.51:1 |
| accent-2 | `#ffd400` | 13.83:1 |
| alarm | `#ff2b1c` | 5.29:1 |

**esper** - *Blade Runner*. Amber and cyan, smoke, crowded

| token | value | worst ratio |
|---|---|---|
| field | `#07070a` | |
| panel | `#0d0d11` | |
| raised | `#14141a` | |
| line | `#24242c` | 1.19:1 (ungated) |
| line-strong | `#61616c` | 3.00:1 |
| ink | `#ded8d0` | 12.96:1 |
| dim | `#9a948c` | 6.11:1 |
| faint | `#827e77` | 4.54:1 |
| accent | `#ffb02e` | 10.05:1 |
| accent-2 | `#4fd6e8` | 10.58:1 |
| alarm | `#ff4d4d` | 5.61:1 |

`cyber`'s accent is `#f2e14c`, kept from the kit's earliest cyber palette.

⭐ **`--ov-accent-2` was an open question and the themes answered it.** Three of
five need a second lit hue that is not the alarm: cyber is yellow *and* cyan,
antiseptic is *2001*'s blue *and* yellow, esper is amber *and* cyan. Only
`terminal` collapses the slot, setting it equal to `accent`, because a
monochrome phosphor theme has no second hue to give. The slot is therefore real
and `terminal` is the exception that proves it, rather than the slot being
speculative.

⚠️ **antiseptic's accent failed the gate at 4.42:1 and needed lifting to
`#2d6eff`.** *2001*'s primary blue on true black is genuinely at the edge of
legibility for text, which is worth knowing before anyone sets body copy in it.

🔴 **`line-strong` failed in all five themes**, needing lifts of 4 to 14 percent.
Five independently chosen palettes, same error every time: a first guess at "a
boundary that carries meaning" is consistently far too quiet.

🔴 **NO LIGHT THEMES.** Ruled 2026-09-09. All five registers are dark
fields, which is also what keeps the finish coherent: a bench test measured grain on
a light field reading as a dirty screen and glow inverting so the element
recedes. Light themes stay out of scope.

✅ **CORRECTED 2026-09-09. The dependency now runs the right way: the finish is
the input and the palette is derived from it.** Every ratio in the tables above
is **delivered** contrast, measured with grain and scanline already applied, not
contrast on flat colour. `tools/palette.py` gates on delivered and refuses to
emit `src/tokens.css` while anything fails.

Three changes got there, and each was forced by a measurement rather than chosen:

1. 🔴 **The vignette moved off the panels onto the field, behind them.** Over
   content it darkens ink and surface together toward black, and WCAG's `+0.05`
   flare term does not scale with them, so the ratio collapses toward 1 with no
   colour edited anywhere. At vignette 0.74 that took terminal's ink from
   13.87:1 to **1.96:1**. Behind the panels it costs nothing and still does its
   job, because nothing back there has to be legible. Scanlines stay over
   everything: a scanline stopping at a panel edge would read as a printed
   pattern rather than as a display.

2. ⭐ **Text is solved to a LADDER, not to the floor.** Solving every token to
   just clear 4.5:1 collapsed the hierarchy: `dim` and `faint` landed on the
   same colour in three themes. The ladder fixes targets of **4.5 / 6.4 / 9.0**
   for faint / dim / ink, and all five themes reach every rung with a consistent
   **~1.4x** step between them. The same collapse shows from the other
   side on a light field, where usable greys fell from about six to two.

3. ⭐ **A monochrome theme cannot say "lit" with more brightness.** Once the
   ladder put terminal's ink at `#fafafb`, its white accent was **1.03:1** away
   and the lit state was invisible. terminal now uses `accent-mode: invert`, so
   lit means swapping fore and back, which is what a real terminal does for a
   selection. Emitted as `--ov-lit-bg` / `--ov-lit-fg` so `chrome.css` never
   names a theme.

⚠️ `tools/finish.py` reports two scopes now, because the finish no longer applies
uniformly: **on panel** (grain and scanline, position-independent) and **on
field** (all three, still position-dependent, still failing in the corners,
which is why text does not belong there).

⚠️ It remains a **model of the CSS, not a sample of a render**, and the two
drifted the moment the CSS changed: the model kept applying the vignette to
panels for one commit. They have to be changed together.

## Axis 2: finish

| token | unit | what it does |
|---|---|---|
| `--ov-grain` | opacity | film grain, screen blend |
| `--ov-scan-opacity` | opacity | scanline darkness |
| `--ov-scan-pitch` | px | scanline period |
| `--ov-scan-weight` | px | scanline thickness |
| `--ov-vignette` | 0-1 | corner falloff strength |
| `--ov-bloom` | px | phosphor halo radius |
| `--ov-bloom-strength` | 0-1 | halo opacity |
| `--ov-flicker` | 0-1 | brightness wobble amplitude |

CSS only, never GL. A GLSL pass cannot sample the DOM, so a shader can never sit
over the interface.

### The field, which is the half a shader can do

The *finish* is CSS and sits over the interface. The *field* sits behind it and
is a real WebGL shader. Two files, and the split between them is a rule rather
than a preference:

- **`design/shaders/field.glsl`** serves terminal, industrial, cyber and esper.
  They differ in how much of each term they use, not in mechanism, so a shader
  per theme would be variation that encodes nothing. Uniforms: field and
  phosphor colour, wash, scanline opacity and pitch, grain, vignette, haze,
  chroma split, wash spread, and glitch. Each theme is one distinguishing
  setting: terminal is the dimmest and tightest wash (0.07 at spread 6.5),
  industrial has the heaviest grain at 0.30, esper is carried by haze at 0.55,
  and cyber is the only one that glitches (0.55).

  **Glitch is band displacement, not noise**, and it is bursty rather than
  constant. Four things carry that:

  - **Bursts.** Glitches cluster. About 38% of windows fire at all, each with
    its own amplitude, and `exp(-phase * 3)` makes a burst hit hard and settle.
    A glitch at a constant rate reads as a texture rather than as a fault.
  - **Two band scales.** A per-band coin picks a thick block or a single line,
    so tears are not all the same height. Uniform band height is the tell that
    an effect was generated.
  - **Correlated displacement.** Neighbouring bands share a bias, so a block
    tears together instead of every band going its own way.
  - **A rare whole-frame roll**, the way losing sync actually looks.

  Time stays quantised so the tearing snaps between held states rather than
  sliding. Sliding reads as analogue wobble; snapping reads as digital, which
  is the register cyber is in.
- **`design/shaders/filmloop.glsl`** is **not a field shader**, and an earlier
  version of this document was wrong to present it as one. *2001*'s readouts
  were film loops back-projected onto set monitors: they are the *content of a
  screen*, not the surface behind an interface. It runs **inside a readout
  component**, never as a panel or page background.

  🔴 **antiseptic therefore has no field shader at all.** Its field is flat true
  black. That is the register rather than an omission: zero depth, nothing
  behind. It is the one theme where the absence is the design.

Both are WebGL 1.0 and load directly as Pen shader fills, so the same files are
the mockup and the Phase 4 implementation.

🔴 **Two hard reasons the film loop cannot be a background**, neither aesthetic:

1. **Flash safety.** Cells step on a held frame boundary, so the effective rate
   is `u_fps / u_hold`, defaulting to 6 / 3 = **2 Hz**. WCAG 2.3.1 allows at
   most three general flashes per second over a large area. An earlier version
   re-rolled each cell every raw frame, which flashed at **6 Hz full bleed**.
   Raising the rate is only safe inside a small instrument, and every caller
   still cancels it under `prefers-reduced-motion`.
2. **Contrast.** Every ratio in this document is measured against a *flat*
   field. A background of flashing primary blocks makes all of them
   meaningless and turns contrast into a function of position *and time*.

⭐ **This was caught by the kit's own rule.** The architecture says shaders paint
fields and instrument interiors, and putting an instrument texture in the field
slot is exactly the category error that rule exists to prevent.

⚠️ Scanlines are applied **before** the vignette in `field.glsl`, so a scan line
in a corner compounds with the falloff. That is deliberate: it is the position
dependence a real tube has, reproduced rather than avoided.

### Instruments follow the same split as fields

Every panel carries one instrument in the same slot, showing the same reading,
in its own register's vocabulary. Four of the five are **cell bars built from
chrome, no shader needed**, differing only in count, gap and colour rule:

| theme | cells | colour rule |
|---|---:|---|
| terminal | 20 | monochrome. Brightness is the only channel it has |
| industrial | 12 | chunky segments, the over-range cell in `alarm` |
| cyber | 40 | hairlines, every 8th filled cell on `accent-2` |
| esper | 24 | the reading position marked in `accent-2` |

**antiseptic is the exception, and for the same reason its field is:** its
vocabulary is a stepping loop of flat blocks, which chrome cannot express, so
it is the one instrument that needs a shader.

⭐ **It is also the only instrument that does not encode the value.** A *2001*
readout is a film loop; nobody operates it. Every other theme's bar moves with
`flux`, and antiseptic's does not, which is the register stated in the one place
it can actually be shown rather than described.

⚠️ Most instruments do not need a shader. That is the expected result of
"shaders paint fields and instrument interiors, CSS paints chrome", not a
shortcut around it.

## Axis 3: geometry

| token | unit | what it does |
|---|---|---|
| `--ov-corner` | px | size of the corner cut |
| `--ov-bezel` | px | enclosure border weight |
| `--ov-rule` | px | hairline weight |
| `--ov-shear` | deg | slab lean. `0` everywhere except cyber |
| `--ov-pad` | px | interior padding step |
| `--ov-gap` | px | gap step |

### Form is a token, not just measurements

⭐ **A theme changes what a control IS, not only what colour it is.** The first
pass wired geometry into the panel only and left every control identical across
all five themes, which read as one kit recoloured five ways. `--ov-shear` was
defined and used nowhere at all.

| token | what it changes |
|---|---|
| `--ov-btn-border` | `0` for terminal and antiseptic, `--ov-bezel` for industrial and esper, `--ov-rule` for cyber |
| `--ov-btn-bg` | the field, the panel, the raised surface, or `transparent` |
| `--ov-ctl-corner` | the corner cut on controls, `0` where the register is rectilinear |
| `--ov-bracket-o` / `-c` | `"[ "` and `" ]"` in terminal, empty everywhere else |
| `--ov-shear` | `9deg` in cyber, `0` everywhere else |

So **a terminal has no buttons.** It has bracketed text you can select, with no
box and no fill, and its lit state is reverse video. **2001 has a flat colour
block** with no border at all, because the register is zero depth. **Industrial**
is a heavy bezel with a cut corner. **Cyber leans.**

### Control furniture (2026-09-09)

The four themes added on 2026-09-09 passed the colour test and failed this one:
strong backgrounds with the same rule-box button underneath all four. **A theme
is a mechanism, not a hue**, so each of them now names what its control's EDGE
does, and gives up its box in exchange.

| token | unit | what it draws |
|---|---|---|
| `--ov-ctl-tick` | px | crop marks at the four corners instead of a continuous edge |
| `--ov-ctl-over` | px | pushes each mark off its own edge, so the pair **crosses** and each stroke runs past the join |
| `--ov-ctl-edge` | px | one bar on the leading side only |
| `--ov-ctl-base` | px | an underline, and nothing else |
| `--ov-ctl-chamfer` | px | all four corners taken off |
| `--ov-ctl-clip` | polygon | the finished silhouette, carrying the cut corner and the chamfer at once |
| `--ov-furn` | colour | what the furniture is drawn in, and therefore its state |

- **neo** takes `edge`: in a display organised into columns, the boundary
  that means anything is the one you cross.
- **machina** takes `ticks`: a targeting overlay draws crop marks, not boxes.
- **holo** takes `base`: a projection is light landing on a surface, and the
  only hard edge it has is where it lands. 🔴 It declines the corner cut too,
  because a contact line that is interrupted is not a contact line.
- **aegis** takes `chamfer`: an armoured plate, not a panel with a corner
  treatment.
- **vector** takes `overshoot`: an X-Y display has no corner primitive, only
  two lines that meet there, and a beam with mass overruns the meeting. ⭐ It
  is `ticks` plus one number - `--ov-ctl-over` at 0 **is** `ticks`, so the
  seventh treatment cost one token and no new painting mechanism.
- **industrial, cyber, esper, antiseptic** take `none`. ⚠️ Not an omission:
  their form is already carried by the border, the corner and the shear, and
  `none` is the same register antiseptic uses when it declines the field
  shader, the bevel and the bolt.

⭐ **The furniture carries the state, because the furniture is the edge.** A
theme that traded its box for ticks has nowhere to put `border-color: accent`,
so hover, pressed and refused move onto `--ov-furn` and every treatment
inherits the behaviour without knowing about the others.

🔴 **A composite token freezes the variables it references.** `var()` inside a
custom property is substituted **where the property is declared**, not where it
is used, so `:root { --ov-ctl-clip: polygon(var(--ov-ctl-chamfer) …) }` bakes in
whatever `:root` holds and every other theme silently inherits a rectangle. It
was written that way first and the clip flattened in all nine themes at once,
which is the same tell the bevel gate gave: **a thing that fails everywhere is
measuring itself.** `--ov-ctl-clip` and `--ov-furn` are therefore emitted per
theme and fully resolved, and the tick gradient is written out in `chrome.css`
so its `var(--ov-furn)` resolves on the button that knows its own state.

⚠️ **The box leans, the label does not.** The shear is applied to the control and
counter-applied to its content, so the slab reads as sheared while the reading
cost stays at zero. That is why button labels are wrapped in a `<span>`.

🔴 **There is no per-component corner token, deliberately.** Corner treatment
says *where* a panel sits, never *which* panel it is: body panels cut one
diagonal, edge bars cut the edge they hold, the viewport cuts all four, one size
token throughout. A kit that offers every permutation will let you skip this and
the result reads as wild rather than as detailed.

### 🔴 A cut is not a hole (2026-09-09)

`clip-path` **removes; it never draws.** Every cut corner in the kit was
therefore an outline that simply *stopped*: the border ran along the four
straight sides and nothing at all ran along the diagonal, so the corner read as
broken rather than as cut &mdash; on panels, buttons, inputs, selects, modals
and the viewport alike.

⚠️ **It was filed as an iOS rendering bug and parked waiting on a device**,
which is why it survived being reported several times. It reproduces in every
browser. `demo/corner.html` compares five ways to perform the same cut and not
one of them strokes the diagonal, so no answer that page could have returned
would have fixed anything.

| token | what it does |
|---|---|
| `--ov-cut-w` | stroke weight: whatever border this component is continuing |
| `--ov-cut-tl` / `-tr` / `-bl` / `-br` | the size of the cut at each corner, independently |
| `--ov-cut-img` / `-size` / `-pos` | the four diagonals, ready to drop into a `background-*` list |

⚠️ **The stroke is half-outside on purpose, and that is what mitres it.** Each
layer fills everything on the *outer* side of its own diagonal and lets
`clip-path` trim the overhang. Painted the tidy way &mdash; a band of exactly
the right width, inside a box exactly the size of the cut &mdash; the stroke
stops short of the straight borders it should meet, because the mitre point
lies outside that box by `w × (√2 − 1)`. That leaves a notch at each end of
every diagonal: about 1px at a 3px bezel, and two device pixels on a 2× screen.
The box is nudged inward by `w / √2` instead.

⭐ **One size per corner, not one for the whole shape.** A member in the middle
of a segmented group or a split button has no outside on two of its sides. That
is what lets those assemblies be **one shape with several controls**: the seam
is a single rule, and only the outer edges carry the corner treatment. The tick
sizes split the same way (`--ov-tick-tl` and friends).

⭐ **A split button and a segmented group are not the same object, and the
furniture is where they differ.** A split button is **one action** with a menu
attached, so its ticks and its leading bar mark the ends of the whole thing.
A segmented group is **several exclusive choices**, so its furniture stays on
each member, where it separates them &mdash; and in a theme with no border that
bar is the only thing that does.

⚠️ A clip is a cut. `clip-path` clips descendants, so any clipped component
reserves interior padding equal to `--ov-corner` or it eats its own content.

⚠️ Anything clipped needs `outline-offset: -2px` on focus. An outline paints
outside the border box and a corner cut is strictly inside it, so the default
ring is **absent**, not faint.

## Axis 4: type

| token | what it does |
|---|---|
| `--ov-font-ui` / `--ov-font-mono` / `--ov-font-display` | families |
| `--ov-size-1` … `--ov-size-7` | scale, **in px** |
| `--ov-track` | letter-spacing |
| `--ov-case` | `none` or `uppercase` |

🔴 **px, never vw.** One `clamp()` on `vw` pinned thirteen test screens to a
7px floor on a phone, measured minimum 5.2px. The four specimens that survived
were exactly the ones setting type in px.

🔴 `ch` is the advance width of digit zero, so it is a Latin unit and it does not
turn with the writing mode. Do not size a rail in `ch` and expect it to hold a
non-Latin string.

## Axis 5: motion

| token | unit | what it does |
|---|---|---|
| `--ov-boot` | ms | power-on sequence duration |
| `--ov-cascade` | ms | per-panel arrival delay |
| `--ov-dur-fast` / `-base` / `-slow` | ms | transition steps |
| `--ov-ease` | easing | the house curve |
| `--ov-flicker-rate` | Hz | idle wobble frequency |

🔴 **Perpetual motion cancels first** under `prefers-reduced-motion`. It was
measured that a naive reduced-motion pass leaves exactly the wrong half running:
the status dot, the blinking cursor, the indeterminate progress bar.

⚠️ Contrast is time-dependent. A panel fading in fails contrast *while it fades*.
Every audit must re-measure after each finite animation ends, and exclude the
infinite ones or the wait never returns.

## Axis 6: sound

Not CSS. A `data-ov-sound` attribute plus a small JS config, defaulting off, one
control, remembered. Same pattern as the contrast and motion switches.

### Voice (2026-09-09)

`src/ov-sound.js` shipped one house vocabulary of six sounds for nine themes,
while its own header claimed a theme could retune its vocabulary. This is that,
and it is the sound half of the same complaint the control furniture answers.

⭐ **The contour is the meaning and the timbre is the theme** — the icon
register's rule in another medium. `refuse` falls and `commit` rises in every
theme, because that is what they MEAN. A theme cannot invent a sound, mute one
or swap two over; it changes only the voice they are all spoken in.

| token | unit | what it changes |
|---|---|---|
| `--ov-snd-pitch` | × | frequency, applied to **both** ends of the sweep so the contour survives transposition |
| `--ov-snd-decay` | × | length |
| `--ov-snd-gain` | × | level. 🔴 not a mute |
| `--ov-snd-wave` | keyword | the timbre every tonal sound is spoken in |
| `--ov-snd-grit` | 0–1 | noise mixed in **beside** the tone |

Ten voices: `plain` `relay` `digital` `chime` `tape` `dry` `menace` `air`
`sonar` `coil`. An electromechanical panel does not click cleanly; a projection
does. `coil` is the deflection yoke, which on a stroke display is genuinely
audible and rings on after the beam has moved.

⭐ **The voice is read off the element the sound was played FROM**, not off the
document, because a demo page shows nine themes at once and a document-level
lookup would give all nine the same voice and hide the entire axis. That is the
same reason every other axis is a token rather than a global.

⚠️ An unrecognised waveform is refused and falls back, never passed to the
oscillator — which would throw and take the sound with it.

## Open questions for the sketch

1. **`terminal`'s accent is pure `#ffffff` and its ink is `#dcdcde`.** In a
   monochrome phosphor theme the lit state is *brightness*, not hue, so the
   accent-to-ink distance is only 1.37:1. That may be too subtle to read as a
   state change, and the honest alternative is inverse video (the way a real
   terminal marks selection) rather than a brighter white. Worth seeing side by
   side before deciding.
2. **`industrial`'s alarm is amber on green.** Correct to the canon, but amber
   and green are the two channels a red-green colour vision deficiency compresses
   hardest. Needs a second signal that is not hue.
3. **Does `cyber` get a second accent?** The register is yellow *and* cyan, and
   right now the contract has one accent slot. Either add `--ov-accent-2` for
   every theme or accept that cyber's cyan is a one-theme special case.

## The four added themes (2026-09-09)

The kit was declared closed at five themes and reopened the same day. These
four were solved against the same ladder and the same worst surface
(`--ov-raised`), and every ratio below is DELIVERED, measured after the finish
is applied, not the flat pair.

⚠️ Read the two columns together. The gap between them IS the finish: neo
loses about 28% of its flat contrast to a light finish, machina about 34% to
a heavy one. A theme that looks bolder on paper can deliver less.

🔴 **machina is the hardest palette in the kit, and it is worth recording
why.** The iconic hot red `#ff2d16` delivers **2.74:1** against its own raised
surface. It is not a text colour and no amount of darkening the ground fixes
it: the ground was tried at `#150808` down to `#030101` and the ratio moved
from 3.03 to 3.16, because WCAG's `+0.05` flare term does not scale and
collapses toward 1 as both sides approach black. This is the same trap recorded
above for the ladder, hit from the other direction.

Only two levers actually move it: the red, and the finish. Machina spends
some of each. The red lifts to `#ff6654` and the finish comes down from grain
0.34 / scan 0.62 to grain 0.22 / scan 0.34. It remains the second grittiest
theme in the kit, and it clears 4.5.

⭐ The general lesson, which applies to any theme proposed from here: **a
saturated hue and a heavy finish are the same budget spent twice.** Pick one.

⚠️ **holo and aegis were the same theme twice, and had to be separated
2026-09-09.** Review note: *"Halo and Aegis look exact the same color wise."* Measured,
they were 4.8 degrees of hue apart, both fully saturated, with grounds within
0.2% lightness of each other. Two blues is not two themes.

They are now separated on three axes at once, because hue alone was never going
to be enough: **holo is defined by LUMINANCE** (accent at 93.7% lightness, a
near-white glow, on a neutral dark ground, because a projection is light in the
air), while **aegis is defined by HUE** (a saturated instrument blue at 65.1%
lightness on a ground that is visibly navy, because it is a screen with a colour
of its own). Put side by side, one reads as white and one reads as blue.

⭐ The general rule this earns: **two themes that differ only in hue are one
theme.** The same test that rejected a green neo.

### neo

`--ov-fx-shader: rain` &middot; grain 0.1 &middot; scan 0.22 at pitch 2 &middot; vignette 0.6

| token | hex | flat vs raised | delivered vs raised |
|---|---|---|---|
| `ink` | `#d6ffe0` | 17.61:1 | **12.60:1** |
| `accent` | `#00ff41` | 14.08:1 | **10.14:1** |
| `dim` | `#a8e6b8` | 13.44:1 | **9.73:1** |
| `faint` | `#7fc492` | 9.35:1 | **6.87:1** |
| `alarm` | `#ff5147` | 5.97:1 | **4.51:1** |
| `accent_2` | `#ccffd9` | 17.28:1 | **12.39:1** |
| `line_strong` | `#4f8f60` | 4.97:1 | **3.81:1** |

### machina

`--ov-fx-shader: vision` &middot; grain 0.22 &middot; scan 0.34 at pitch 3 &middot; vignette 0.78

| token | hex | flat vs raised | delivered vs raised |
|---|---|---|---|
| `ink` | `#ffe8e4` | 16.74:1 | **10.37:1** |
| `accent` | `#ff6654` | 6.80:1 | **4.50:1** |
| `dim` | `#e0b0a8` | 10.23:1 | **6.56:1** |
| `faint` | `#d0ada8` | 9.55:1 | **6.17:1** |
| `alarm` | `#ffd400` | 13.71:1 | **8.56:1** |
| `accent_2` | `#ff9d5c` | 9.56:1 | **6.14:1** |
| `line_strong` | `#aa827e` | 5.80:1 | **3.93:1** |

### holo

`--ov-fx-shader: holo` &middot; grain 0.06 &middot; scan 0.55 at pitch 4 &middot; vignette 0.52

| token | hex | flat vs raised | delivered vs raised |
|---|---|---|---|
| `ink` | `#f2fbff` | 17.99:1 | **12.57:1** |
| `accent` | `#dff3ff` | 16.54:1 | **11.58:1** |
| `dim` | `#cbd8e4` | 13.01:1 | **9.25:1** |
| `faint` | `#a2adbd` | 8.31:1 | **6.05:1** |
| `alarm` | `#ff7d96` | 7.75:1 | **5.65:1** |
| `accent_2` | `#59d6ff` | 11.22:1 | **7.99:1** |
| `line_strong` | `#6a7488` | 4.01:1 | **3.10:1** |

### aegis

`--ov-fx-shader: field` &middot; grain 0.12 &middot; scan 0.26 at pitch 2 &middot; vignette 0.66

| token | hex | flat vs raised | delivered vs raised |
|---|---|---|---|
| `ink` | `#dbeaf9` | 13.32:1 | **9.31:1** |
| `accent` | `#50a1ff` | 6.12:1 | **4.51:1** |
| `dim` | `#aec6e2` | 9.30:1 | **6.64:1** |
| `faint` | `#87a2c2` | 6.20:1 | **4.57:1** |
| `alarm` | `#ff7272` | 6.14:1 | **4.50:1** |
| `accent_2` | `#8affc8` | 13.38:1 | **9.41:1** |
| `line_strong` | `#5a83ad` | 4.10:1 | **3.13:1** |


## Axis 3b: the bevel, and why it is a token rather than a stylesheet

A bevel encodes a **light direction**, so it cannot be inverted, only re-lit.
Every value below is derived by `tools/palette.py` from one
declaration per theme and gated there; none of it is written by hand.

| token | role |
|---|---|
| `--ov-light` | the direction the light comes from, clockwise from straight above |
| `--ov-light-x` / `--ov-light-y` | the same as a unit vector, precomputed |
| `--ov-bevel-raise` / `--ov-bevel-sink` | a control's rings. **Same colours, opposite sides** |
| `--ov-bevel-raise-deep` / `--ov-bevel-sink-deep` | two rings, for a thicker profile |
| `--ov-bevel-face-raise` / `--ov-bevel-face-sink` / `--ov-bevel-face-raise-deep` | a faceplate's rings, one surface down |
| `--ov-bevel-hi` / `--ov-bevel-lo` | the ring colours alone |
| `--ov-bevel-bolt` | one countersunk head, lit from `--ov-light` |
| `--ov-bevel-face-wash` | the falloff across a plate, along `--ov-light` |
| `--ov-bevel-mode` | `cut`, `lit`, or `none` |

🔴 **`none` and `lit` are measured results, not styling choices.** A bevel needs
room on both sides of its face, and a dark register has 1.66:1 to 3.09:1 above
a surface and 1.02:1 to 1.14:1 below it. `antiseptic`'s shadow ring came back at
**1.03:1**; it declares `none`. `holo` is additive and cannot have a shadow at
all; it declares `lit`.

⭐ **Only the lit side is gated.** The highlight rings carry the affordance and
clear `RING_MIN`; the shadow rings are ungated furniture in the same sense
`--ov-line` is. Both sides must still be strictly **ordered**, because a shadow
lighter than its face is a lie about which way the light comes from.

🔴 **A whole-pixel bevel can only express eight directions**, the same way the
character ladder expresses eight levels. `check_bevels()` prints the direction
drawn next to the one declared and fails if they disagree.
