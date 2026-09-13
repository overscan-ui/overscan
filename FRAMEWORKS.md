# Svelte, Vue and React

Decided 2026-09-09: **npm, single package**, data reaches
widgets as **props carrying readings**, and the four spellings live in a
**`/docs` section** rather than on the demos.

The premise was that this is near-zero marginal cost because custom
elements are framework-agnostic. That is true of the elements and false of the
package around them. What follows is what a measurement of the kit actually
found, then the plan.

## What the kit is, measured

Three layers, and only the middle one is web components.

| layer | what it is | what a framework needs |
|---|---|---|
| CSS | 29 files. Panel, button, badge, progress, select, check, slider are **class names on plain markup**, not elements | an import. Nothing to wrap |
| elements | 35 custom elements, **zero shadow DOM**, light DOM throughout | a module format, and event binding |
| runtime | `Overscan.source`, `.GL`, `.keys`, `.tabs`, the icon register, sound. Global singletons **by design** | not a component. See below |

The CSS layer is the larger half by component count, and it already works in all
three frameworks today. A wrapper package of 35 element shims does not touch it.

The runtime layer is singleton **because it has to be**: `Overscan.GL` shares one
WebGL context because a browser evicts past ~16, silently. That is not a wart to
be modularised away, and no wrapper should try.

## The five things in the way

Ordered by cost, which is not the order they look.

1. 🔴 **No module format, and this is the actual work.** All 30 JS files are
   classic scripts. No `export` anywhere, each self-registers on load, and the
   order is implicit (`ov-source` before `ov-chart` before `ov-gl`). Nothing here
   can be `import`ed by any bundler, so no framework can consume the kit at all
   right now. Every other item on this list is small next to it.

2. 🔴 **`customElements.define` is unguarded in all 35 elements.** A second
   definition throws `NotSupportedError`, which is exactly what Vite HMR and any
   double-import do. A framework user hits this on their first save.

3. ⭐ **The `ov:` prefix is the single reason wrappers have to exist.** Every
   event is namespaced with a colon (`ov:commit`, `ov:change`, `ov:tab`,
   `ov:seek`, `ov:command`, `ov:cancel`, `ov:resize`, `ov:play`, `ov:pause`,
   `ov:sound`). Svelte 5 replaced the `on:` directive with plain properties, so
   `ov:commit` has no declarative spelling; React 19 added custom-event support
   through `on<Event>`, but `onov:commit` is not writable in JSX. Vue is the only
   one of the three that can bind it in a template.
   ⚠️ **Do not "fix" this by renaming the events.** The namespace is what keeps
   `ov:change` from colliding with a host app's own `change`, and a
   wrapper doing one `addEventListener` is genuinely thin. The colon is the
   reason the wrapper earns its place, not a defect.

4. **The source registry is pull-only.** `Overscan.source(name, fn, {hz})`
   samples `fn(t, i)` on a rAF clock and derives the value from the sample
   INDEX. Framework state is push. There is no push path, so app state has no
   way in.

5. ⚠️ **Two elements break under re-render, and only two.**
   - `ov-split` inserts its gutter between children with `insertBefore`, guarded
     by `if (!this.querySelector('.ov-split__gutter'))`. A framework re-render
     that replaces the children removes the gutter, and because the element
     itself never disconnected, `connectedCallback` does not run again. **The
     splitter stops working permanently and nothing reports it.**
   - `ov-menu` caches `this.items` at connect, so menu items added later are
     invisible to the keyboard.
   - `ov-tabs` is already correct: a document-level MutationObserver re-attaches
     rows added after load. It is the pattern the other two should copy.

   The other 20 data elements rewrite their own `innerHTML` and are opaque
   leaves. A framework renders the tag and never owns anything inside it, which
   is the easy case and it is most of the kit.

## Data flow: a prop carries a READING, not a number

A deliberate call, and the registry is not the thing being bypassed by it.

The refusal thesis is about what a widget does with a value it cannot draw. It
does not care where the value came from. So the prop is allowed to be the same
shape a source emits, and the existing refusal path serves both:

    number        the widget draws it
    null          dropout. The widget renders a refusal, never a last value
    {value, age}  the widget draws it and marks itself stale

    <OvChart values={readings} />     values may contain nulls
    <OvGauge value={null} />          renders REFUSED, not 0

🔴 **A wrapper must never coerce `null` to `0` or drop it from an array.** That
is the inventing-readout failure committed one layer up, and it is the
one thing in this document that is not negotiable.

The registry stays exactly as it is, for fixtures, demos and live feeds. Props
are the framework path. Both end at the same render.

⚠️ **This needs real property accessors.** `values`, `rows`, `text` and friends
are string attributes today (`static observedAttributes = ['values', ...]`), so
an array prop would round-trip through a string. Each data element needs a
property setter that takes a reading directly, with the attribute path kept for
plain HTML.

## One manifest, three wrappers, one docs section

⭐ **The wrappers and the docs generate from the same manifest, so they cannot
drift from the code or from each other.** This is the repo's existing habit (40
generators, everything derived) pointed at the problem that was the worry.

    tools/api.py  ->  custom-elements.json  -+->  src/react/*, src/vue/*, src/svelte/*
                                             +->  docs/*.html (four spellings each)
                                             +->  editor autocomplete, free

`tools/api.py` reads `src/*.js` and extracts what is already declaratively
there: registration names, `static observedAttributes`, the reading properties,
and every `new CustomEvent(...)`. Output is **Custom Elements Manifest** format,
which is the interchange standard, so VS Code and JetBrains give `<ov-chart>`
completion and attribute hints with no extra work.

🔴 **Four extraction traps, all found by measurement rather than by reading the
code, and each produces a manifest that is wrong without being empty.**

1. ⚠️ **Do not grep for `customElements.define`.** The ESM conversion moved
   every registration behind the guarded `define()` in `ov-core.js`, so that
   string now appears in exactly ONE real call site and, confusingly, in five
   element files as PROSE inside comments. An extractor must strip comments
   before it matches anything.
2. 🔴 **Do not grep for a bare `define(` either, because it OVER-matches.**
   `ov-sound.js` has its own effect registry with the same verb, so
   `Overscan.sound.define('alarm', ...)` yields six phantom elements: `press`,
   `key`, `commit`, `refuse`, `alarm`, `vent`. A manifest carrying those
   generates six wrapper components for elements that do not exist. Anchor on a
   `define(` preceded by neither a dot nor a word character:
   `(?<![.\w])define\(\s*['"]([a-z][\w-]*)['"]\s*,`
   That yields **35 elements across 31 files**, which is the number to assert.
3. 🔴 **`ov-transport.js` is the one element that must be special-cased or
   REFUSED**, and it fails in the dangerous direction. Its event name is not a
   literal: `new CustomEvent(on ? 'ov:pause' : 'ov:play')`. `ov:play` and
   `ov:pause` appear as literals nowhere else in the kit, so a literal-only
   extractor does not error, it silently ships a manifest missing two events.
   That is this project's own seven-segment failure committed inside its own
   tooling.
4. ⚠️ **File-to-element is not 1:1** (`ov-graph.js` defines four: `ov-graph`,
   `ov-node`, `ov-socket`, `ov-link`), and **thirteen elements have no
   `observedAttributes` at all**. The manifest must distinguish *this element
   has no attributes* from *I could not read its attributes*. Same value,
   different claim.

🔴 **It refuses rather than guesses, and it carries a `selftest()`**, matching
`clearance.py`. An element whose events it cannot extract is
NAMED and the build fails. A wrapper generated from a partial manifest would be
a silently wrong API, which is the failure this kit exists to refuse. ⚠️ And the
selftest matters more here than usual: nine times in this project the instrument
was the finding.

Python, like the other 40 tools. Node enters the repo only for packaging.

### Why `/docs` first, and then everywhere

🔴 **THIS SECTION ARGUED THE OPPOSITE AND WAS OVERRULED. It is kept because the
reasoning is still half right and the half that was wrong is worth naming.**

The argument was: the site has never shown source - zero `<pre>` blocks across
30 demo pages - so the worry about one spelling is about the demos'
own live markup, not about sample text; a tab strip would not add spellings to
something that shows one, it would introduce source display to 26 pages that
deliberately have none, and a code block is a still frame of the one thing this
kit insists cannot be shown as a still frame.

What was right: hand-maintained spellings drift, and a still frame is not an
instrument. What was wrong: it treated "show no source" as the rule when the
real rule is "show nothing that can disagree with itself". Every block is
EXTRACTED from the page's own markup and the four spellings are generated from
one manifest field, so the block and the instrument above it are the same bytes
and cannot drift apart. The correction stands: same tab format as `/docs`,
inline, more than once per page. The demos are still the argument; the source
under each one is now the caption.

`/docs` keeps the demos as instruments and puts the reference where a reference
belongs: one page per element, attributes, properties, events, and the four
spellings side by side, all generated. The demos stay the argument. The docs
become the manual.

## Package

Single `overscan` package. npm `overscan` was free when first checked
2026-09-08 and **confirmed still available 2026-09-12**.

⚠️ Recheck it at publish time anyway. Not because this is doubted, but because
name availability is a fact with a shelf life: it is true until someone else
publishes, and nobody gets a warning. The gap between this line and the
`npm publish` is however long the remaining polish takes.

⚠️ **BUILT 2026-09-12, AND IT IS NOT QUITE THE SKETCH THIS SECTION HELD.** What
the exports map actually advertises, all of it proved by
`node tools/check_exports.mjs`:

    overscan                    the whole kit, ESM
    overscan/radar              ONE element. No ov- prefix, no .js
    overscan/radar.js           the same file
    overscan/ov-radar.js        the same file again
    overscan/overscan.css       all ten themes
    overscan/react              generated
    overscan/vue                generated
    overscan/svelte             generated
    overscan/custom-elements.json

The three element spellings exist because a package subpath and a DOM tag name
are different things: an element must keep `ov-` (a custom element name needs a
hyphen), a subpath inside a package called `overscan` gains nothing from it,
and people type what they see in a file listing. 🔴 The short one is for
bundlers and Node only. A browser import map cannot reach it: a key ending in
`/` must map to an address ending in `/`, so a prefix can supply neither the
`ov-` nor the `.js`. No-build pages use `overscan/ov-radar.js` with
`{"overscan/": ".../src/"}`, and `tools/consumer/index.html` runs exactly that
so the claim is tested rather than asserted.

⚠️ **This document no longer ships.** `files` is `src/`, `types/` and
`custom-elements.json`, so a consumer reading only the package never sees this
page; the four spellings are on the docs site, and README.md carries what a
stranger needs.

⚠️ **SSR renders an empty tag.** A light-DOM custom element emits `<ov-chart>`
with nothing inside until it upgrades on the client, so Astro, Next, Nuxt and
SvelteKit all get a layout shift where the instrument appears. This is not
solvable with declarative shadow DOM here, because the kit deliberately has no
shadow roots. It needs a reserved-size rule in CSS and a documented note, and it
should be measured before it is described.

🔴 **The repo is PRIVATE and publishing is a separate yes.** Nothing in this plan
publishes anything. See the private-to-public rule.

## Order

1. ESM conversion, guarded `define`, keep the 30 demo pages working. **Fix the
   generators, not the generated pages.**
2. Property accessors that take readings.
3. `ov-split` and `ov-menu` re-render fixes, copying `ov-tabs`.
4. `tools/api.py` and the manifest, with its selftest.
5. ~~The three wrappers, generated.~~ **DONE.**
6. `/docs`, generated. ⚠️ Coordinate: the site session owns the site.
7. Packaging. Publishing stays unasked.

Items 1 to 3 are decided and touch nothing the site session owns.

## Item 5 is done: the three wrappers

Generated by `tools/gen_wrappers.py` from the manifest, 35 components each.

**A wrapper moves values and events. It does not re-implement the protocol**,
validate, coerce or default. One that turned `null` into `0`, or dropped it
from an array, would be the seven-segment failure one layer up.

🔴 **THE BUG THAT JUSTIFIES THE WHOLE FILE, and it could not be seen from the
source.** All three frameworks apply the same rule to a custom element: if the
prop NAME EXISTS ON THE ELEMENT, set it as a property, else set an attribute.
This kit has **43 getter-only properties across 20 elements** (an earlier count
of 47 was per FILE and included modules that register no element). ⭐ The number
that matters is smaller and sharper: **11 elements have a getter-only name that
is also a real attribute**, and those 18 names are the ones a reader would
naturally pass in markup: `at`, `digits`, `duration`, `floor`, `hold`, `lat`,
`lon`, `period`, `range`, `rings`, `span`, `step`, `sweep`, `sweeps`, `traces`,
`value`. All of it is derived per element and carried in the manifest, so the
reference tells a reader which names on *that* element are affected. So `<OvSegment digits="4" />` made React find `digits`, try to assign
it, and throw *"Cannot set property digits of #<OvSegment> which has only a
getter"*. ⚠️ It did not degrade: it **took down the entire React tree**.

So the wrappers hand the framework **nothing but a ref** and apply every
attribute themselves. A list of which names are safe was the other option and
it would rot against `src/` silently.

The second reason they exist is the one this document already argued: an
attribute is a string, so `values` and a `null` cannot travel through one.
Readings are set as properties, always.

Event spellings, all generated from the manifest:

| | |
|---|---|
| React | `onCommit`, `onPlay`, `onSeek` |
| Vue | `@commit`, `@play`, `@seek` |
| Svelte | `oncommit`, `onplay`, `onseek` |

⭐ **Verified by rendering in each framework for real**, not by reading the
code, which is the only reason the getter bug was found: `tools/wrapper-test/`
builds a real React, Vue and Svelte app against the real wrappers. All three
return identical results, including that a `values` **attribute is never set**,
the array arrives as an array, `[10, null, 30]` still reports `1 missing`,
`value={null}` still renders a refusal, `'01.50'` is still not normalised, and
the getter-only `digits` lands as an attribute. All 35 Svelte components are
compile-checked, not just the four the test app uses.

## Status, 2026-09-09

**Items 1, 2 and 3 are done and verified in a browser.** Nothing is committed.

- **1.** All 38 `src/` files are ES modules behind `src/ov-core.js`, which
  exports a guarded `define()`. All 31 generators emit `<script type="module">`.
  `tools/bundle.py` (with a `selftest()`) inlines a module graph, which
  `demo/standalone.html` needs because **a module cannot load over `file://`**
  and the switch would otherwise have silently killed the one page whose
  promise is that it needs no server. Verified against a baseline worktree at
  HEAD: `chart.html` identical on every count, `standalone.html` screenshots
  pixel-identical, all 27 demo pages have a definition for every `ov-*` tag.
- **2.** Reading properties on `ov-chart.values`, `ov-spark.values`,
  `ov-gauge.value`, `ov-flap.value`, `ov-segment.value`, `ov-cellbar.value`,
  plus `ov-table.cols` / `.rows` for structured data. `OverscanRefusal` gained
  `reading()`, `prop()`, `rawOf()` and `upgrade()`, so the protocol is defined
  once rather than per widget. Verified: `null` renders a refusal,
  `{value, age}` marks stale through the `age` attribute `common()` already
  read, and `'01.50'` is preserved rather than normalised to `1.5`.
- **3.** `ov-split` keeps its gutter across re-renders (a scoped
  MutationObserver, the shape `ov-tabs` already used) and `ov-menu` caches
  nothing at all, delegating every listener to the host. Verified that a
  replaced item resolves to the right index and an item added later is
  reachable.

### Two gaps found on the way, neither introduced here

- ⚠️ **`ov-gauge` has no staleness path.** It calls `apply()` but never
  `common()`, so `{value, age}` draws the number without marking it stale, and
  its `age` attribute never did anything either. Every other readout goes
  through `common()`. This predates the framework work and is a real
  divergence from the protocol, but fixing it changes what existing pages
  render, so it is a deliberate decision rather than a silent edit.
- ⚠️ **`demo/motion.html` uses `<ov-field>` and its generator never loads
  `ov-field.js`**, so that field has never rendered.

### One pre-existing bug fixed

`demo/input.html` threw `ReferenceError: Overscan is not defined` on every
load, in the baseline too. 🔴 **`defer` is ignored on an INLINE script**, so it
ran before the kit. The keyboard-scope demo had never once worked and said
nothing about it. It now registers 7 bindings.
