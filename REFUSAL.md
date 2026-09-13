# The refusal protocol

**A readout refuses to invent.** Hand a widget a value it cannot draw and it
renders a refusal, never a different number.

This is the thesis of the kit, and it exists because of two measured cases at
opposite poles:

- **OpenSeadragon ships a refusal.** `maxZoomPixelRatio: 1.1` declines to show
  detail it does not have, and its own comment calls anything past that "over
  zoom".
- **retro-react's seven-segment display will show anything.** It filters its
  input to `[0-9]` and closes the gap, so `1.5` renders as `15`. Seven of eight
  test values came back wrong, by up to 1.7e+8x, and every one of them looked
  like a plausible reading.

The second failure is the dangerous one, because nothing about it looks wrong.
So every widget here declares one of these outcomes, and there is no path where
a value it cannot represent quietly becomes one it can.

## Two kinds of state about the VALUE, and the split is the useful part

A **refusal** withholds the number, because showing one would be a lie.
A **qualifier** shows the number and says something true about it, because
withholding would also be a lie.

There is a third kind, added later and living further down this file: a
**fault**, which is a claim about the display rather than the value, and which
nothing inside the page is in a position to make.

A study of degraded screens found five states while this protocol had five reasons,
and they were not the same five. The three that were missing are all qualifiers:
the reading is real, and something about its provenance is not what the reader
would otherwise assume.

### Refusals: no number

| reason | when |
|---|---|
| `unrepresentable` | the glyph set cannot express it: a decimal point on a display with no DP, a letter on seven segments |
| `overflow` | more cells than the display has |
| `out-of-range` | outside the instrument's declared range |
| `unknown` | no value has ever arrived, or the value is explicitly null |
| `other-frame` | made on a different frame from the one it would be drawn on: a detection box from an earlier or later frame sits where the target was then (`ov-plate`, added 2026-09-10) |
| `incapable` | there is no sensor for this here at all, so there is nothing to have a reading about: METAR writes it `///` (added 2026-09-11) |

### Qualifiers: the number, plus what is true about it

| qualifier | when | why not just show it |
|---|---|---|
| `stale` | older than its validity window | the display is not claiming the value is current |
| `frozen` | fresh, but has not left its `deadband` for `frozen-after` seconds (opt-in: both attributes, or nothing) | a stuck transmitter sends fresh copies of one number, and steady and stuck look identical without it |
| `substituted` | entered by hand, not measured (`substituted="who or why"`) | an operator's override is a claim, and it must not pass for a reading |
| `uncal` | the instrument is reading but has never been calibrated | the number is what the instrument says, which is not the same as what is true |
| `clamped` | the value was limited **upstream**, before the display saw it | the display is not the one clamping, so it must not present a limit as a measurement |
| `disputed` | two sources disagree, by more than a threshold and for longer than a stated dwell (`for`, in seconds) | the display is not entitled to pick a winner, so it shows that they differ |
| `unchecked` | no check has run against it | "nobody has looked" is not "it is fine", and it is not a refusal either: the number is real and unverified |
| `estimated` | computed by a model rather than measured, and it must say BY WHAT | unlike `stale`, an estimate MOVES, so it looks more alive than a measurement rather than less |
| `voted` | a consolidation of several sources, carrying the rule and the members | a vote is not a reading from anything, and a reader shown only its output cannot see the sources it rejected |
| `defaulted` | a default or look-up value sitting in a slot the reader takes for measured | a number that came from a table is not a number that came from the world |
| `overscale` | drawn finer than the data it came from was compiled for | zooming in makes the picture sharper and the survey no better |

The last five were added 2026-09-11, from a reading of IEC 61850, OPC UA,
NUREG-0700, the IMO position standards and four accident reports. The first
four qualifiers above say something about a reading's CONDITION - old, stuck,
hand-entered, contradicted. These say something about its PROVENANCE: what
kind of number it is at all. A reader who assumes "measured" is wrong in a
different way each time, and the two that matter most are the two that do not
look wrong. `estimated` MOVES, so it reads as more alive than a measurement,
not less: the Royal Majesty's receiver dead reckoned for hours, fresh and
updating, and put the ship aground (NTSB MAR-97/01). `voted` looks like the
steadiest number on the screen precisely because it is several sources
reconciled, which is why BEA's XL888T report notes that "this vote is not
apparent for the pilots".

`disputed` is the one worth dwelling on. Every other state is about one reading.
This one is about the display being handed a decision that is not its to make,
and the honest move is to refuse the decision rather than the data.

### The order of the provenance qualifiers

`substituted`, then `stale`, then `frozen`, and only one is shown. A hand value
was never measured, so its age or stillness says less than that; and a hand
value never moves, so without this order every one of them would read
`frozen` and hide the fact that matters. A stale value is already not current,
so calling it frozen as well would say less, not more. All three live in
`staleness()` in `src/ov-refusal.js`, so the gauge (which cannot use
`common()`) marks them too. `frozen` is opt-in because a kit that marked every
quiet value suspect would be inventing a fault.

## What a refusal looks like

**Dashes across every digit, in `--ov-alarm`.** Dashes are the instrument idiom
for "no reading", and a full row of them cannot be mistaken for a value the way
`0`, a blank display, or a truncated number can.

Three rules hold for every refusal:

1. **A refusal is never a number.** Not zero, not blank, not the last good
   value. Blank reads as powered off, which is a different claim.
2. **The reason is on the element**, as `data-ov-refusal`, so a theme can style
   it and a test can assert it.
3. **The accessible name states the reason and never the value.** The one thing
   worse than an unreadable display is one that announces a number it is
   refusing to show.

## Stale is the exception, deliberately

`stale` still shows its number, because withholding a slightly old reading is
usually worse than showing it. But it is marked: the digits drop to
`--ov-faint`, the element carries `data-ov-stale`, and the accessible name says
how old it is.

That is the honest position. The display is not claiming the value is current,
and it is not pretending to have nothing.

## The refusal belongs to the display, not the value

`NOMINAL` is `unrepresentable` on seven segments and draws cleanly on fourteen.
Nothing about the value changed. That is the honest way round, and it is why the
reason is `unrepresentable` rather than anything implying the input was wrong:
the caller passed a perfectly good string to a display that cannot form it.

It also means **widening the display is a real fix**, and the protocol makes
that visible rather than hiding it behind a silently mangled reading.

## The third kind: faults, which belong to the GLASS

Everything above is a claim about the **value**. A refusal withholds a number, a
qualifier annotates one, and both are things the instrument knows because the
instrument was handed the data.

A ticket machine that has been outdoors for eight
years names the thing this protocol had no word for:

> Nothing in that device's model represents its own screen. **Self-report is not
> telemetry.** §8 drew six ways an instrument lies about its *data*; an
> instrument can be taught to say STALE, and nothing here can be taught to say
> SCRATCHED.

That machine's status bar reads SYSTEM NOMINAL while burn-in from a layout
retired in 2018 sits across the live UI, a dead pixel column crosses every
element and belongs to none, and an advertisement cannot be dismissed because
its close button sits inside a dead patch of digitiser. The status bar is not
lying. It genuinely cannot see any of that.

So a **fault** is a third kind, and it is different from the other two in a way
that decides the whole design:

| kind | claim about | who can assert it |
|---|---|---|
| refusal | the value | the widget, from the data it was handed |
| qualifier | the value | the widget, from the data and the clock |
| **fault** | **the display** | **nobody inside the page** |

🔴 **A fault cannot be detected, only declared.** `<ov-fault>` therefore takes
its faults as configuration and never infers them. A page that could detect its
own burn-in would already have fixed it, and any API that pretended otherwise
would be inventing exactly the way this kit exists to refuse.

That is also why a fault is drawn by a shader sitting OVER the interface, which
every other rule here forbids. The constraint was always that a GLSL pass cannot
*sample* the DOM; a fault never needs to. A dead pixel is black over a chart and
black over an empty panel, so it composites correctly without reading anything.
See `src/ov-gl.js`.

### The four faults, and why one of them is invisible

| fault | drawn | what it is |
|---|---|---|
| `burn` | yes | a ghost of a layout that is no longer running, at fixed positions, which never redraws while the live UI does |
| `column` | yes | a dead or stuck column, crossing every element and belonging to none |
| `stuck` | yes | individual stuck subpixels, permanently lit |
| `dead` | **NO** | a region of digitiser that does not respond |

⚠️ **`dead` is deliberately not drawn**, and that is the honest part. A fault you
can see is not the fault this is about: the whole cruelty of the ticket machine
is that the dead zone is invisible and you only discover it by pressing a button
that does nothing. Drawing a helpful grey rectangle over it would turn a study
of a real failure into a diagram of one. `<ov-fault>` swallows pointer events in
that region and shows nothing.

🔴 **It is therefore a demonstration tool, not a decoration.** Never ship a
`dead` region on a page a real person has to operate. The kit provides it so a
designer can see what their interface does when part of it silently stops
working, which is a thing every interface eventually does and almost nothing is
tested against.

## What this costs


A widget that refuses is more work to use than one that doesn't. You have to
decide what your instrument's range is, how long a reading stays valid, and what
happens when it isn't. That is the point: those are decisions the display cannot
make for you, and a library that makes them silently is the failure mode above.


## The fourth case: the protocol running backwards

Everything above is about a display being handed a value. `<ov-graph>` is the
one surface in the kit where the **user authors the data**, and the same
principle points the other way: the graph refuses to make a *connection* that
would not mean anything.

The failure being avoided is identical. A socket that accepts anything is a
seven-segment display that renders `1.5` as `15`: the wiring succeeds, the
graph looks correct, and the result is plausible and wrong. So there is **no
`any` type**, deliberately, and no rule that lets one appear.

The two kinds map across without changing shape.

| reason | kind | when |
|---|---|---|
| `type` | refusal | no declared rule carries this type to that one |
| `direction` | refusal | output to output, or input to input |
| `occupied` | refusal | the input already has a link |
| `cycle` | refusal | the link closes a loop, so nothing can be evaluated |
| `self` | refusal | a node's output into its own input |
| `missing` | refusal | the markup names a socket that does not exist |
| `converted` | **qualifier** | a declared widening ran, so the value is real and is not the type the socket it arrived at would suggest |

Three rules follow, and each one was a defect before it was a rule.

**The reason reported is the one that survives clearing the others.** A
wrongly typed link into an occupied input reported `occupied`, which sends the
author off to disconnect something that was never the problem. Type is judged
before traffic.

**Declaration order decides, so the link that arrives later is the one
refused.** Judging each link against every other link's previous verdict made a
two-link cycle refuse the *first* one, which is backwards and was an artifact
of iteration order rather than anything the graph meant.

**The refusal is shown before the drop.** While a link is in the air, every
socket says what it would do with it. A node editor that lets you complete a
gesture and then does nothing has refused without saying so, and the user is
left to guess whether the tool is broken or the connection was wrong.

⭐ **And a node refuses.** A required input with no link means the node has no
value to produce, so it says `unknown` rather than taking a default &mdash; a
default is the graph inventing the number nobody supplied. Everything
downstream is `blocked`, which is a different claim from broken and is drawn
differently.
