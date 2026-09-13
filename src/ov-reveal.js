/* Overscan.Reveal - arriving on scroll, by the same mask the kit already uses.
 *
 * motion.css states three rules and this obeys two of them literally. The
 * third it changes, so the change is written here rather than left for someone
 * to discover:
 *
 * ⚠️ RULE 2 SAID STAGGER ENCODES THE SIGNAL PATH AND NOTHING ELSE, and that a
 * decorative cascade was deliberately impossible. This is that cascade. It
 * was asked for directly (2026-09-10): the whole site should arrive as it comes
 * into view. So rule 2 now has a second, narrower form, written down in
 * motion.css: --ov-stage still encodes the data flow WITHIN a panel group, and
 * scroll arrival encodes something different but equally real, which is
 * reading order. An element arrives when you reach it. That correlates with
 * the reader's position rather than with nothing, which was the actual
 * objection: "variation that correlates with nothing reads as noise".
 *
 * 🔴 RULE 1 IS UNTOUCHED, AND IT IS THE REASON THIS IS A MASK AND NOT A FADE.
 * Contrast is time-dependent: an element fading in fails contrast for every
 * frame it spends part-way, and an audit sampling at a fixed delay reads
 * colours that are in no palette anywhere. A hard-edged mask wipe paints every
 * pixel either fully or not at all, so the delivered contrast is correct in
 * every frame. There is no opacity anywhere in this file and adding one would
 * undo the only rule here with an accessibility argument behind it.
 *
 * Rule 3 is obeyed by not existing: this animates finite arrivals only.
 *
 * ── WHY IT CANNOT HIDE ANYTHING IT MIGHT NOT REVEAL ───────────────────────
 *
 * 🔴 A REVEAL THAT HIDES BY DEFAULT AND NEVER RUNS IS A BLANK PAGE, which is a
 * far worse failure than no animation. motion.css learned that on Safari and
 * says so. Everything here is arranged so that the hidden state is impossible
 * to reach unless the reveal is already known to work:
 *
 *   - The hidden state is applied by SCRIPT, never by a stylesheet. No script,
 *     no observer, no GSAP, file not loaded: the page is simply visible.
 *   - Reduced motion, a theme with zero duration, or absent GSAP all return
 *     before anything is hidden, rather than hiding and then not animating.
 *   - Anything already at or past the fold is revealed by the first sweep,
 *     which runs synchronously before this function returns.
 *   - ⭐ AND A GUARD, which runs for as long as anything is still hidden. Any
 *     element that is ON SCREEN and has not arrived within a few seconds is
 *     shown unconditionally, whether it is still queued or stuck part-way
 *     through an arrival that never finished.
 *
 * 🔴 THE GUARD DELIBERATELY LEAVES OFF-SCREEN ELEMENTS ALONE, and an earlier
 * one-shot version did not. It emptied the whole queue on a four-second timer
 * and tore the scroll listeners down with it, so on any page taller than four
 * seconds of reading the timer WAS the reveal: measured on the home page,
 * twenty-nine of the thirty component wells arrived in a single frame at
 * 4284ms, having never been swept, and scrolling afterwards animated nothing
 * because there was no longer anything listening. Not scrolled to yet is not a
 * failure, and it must not be treated as one.
 */

import { Overscan } from './ov-core.js';

const PENDING = 'ov-reveal--pending';

/* What arrives. Structural blocks only, and deliberately NOT `.ov-panel`:
 * rule 1 says the mask clips to the border box exactly as the corner clip does,
 * and a panel's label rides the top border OUTSIDE that box, so masking the
 * panel itself cuts its label in half. The wrapper is the thing to mask. */
const TARGETS = [
  '[data-ov-reveal]',   // anything a page opts in by hand
  '.cw',                // the home page's component wells
  '.th',                // the home page's theme cards
  '.ov-code',           // a code block is one object and arrives as one
  '.band > *',          // the home page's bands, element by element
  '.grid > *',          // any grid: each cell arrives on its own
  '.cells > *',         // a demo row: the widget and its notes, separately
  'section > *',        // a themed demo section, element by element
  /* The prose pages. gen_about.py and gen_reference.py wrap everything in
   * `<article class="body">`, so without these the prose pages had no target
   * at all and simply never animated: the about page, the reference index and
   * its per-element pages. A heading, a paragraph, a list and a table each
   * arrive on their own, which is what reading order means on a page of text. */
  '.body > *',
  '.toc > *',
  /* The rail and the hero. ⚠️ Both were missing and both are the FIRST thing
   * anyone sees, so the page began with the one region that did not move. The
   * rail is deliberately outside any theme scope, which is exactly why no
   * theme-shaped selector reached it. Listed one level in, so the mark, the
   * nav links and the status arrive in turn rather than the whole bar
   * appearing at once.
   *
   * 🔴 THE PICKER ARRIVES AS ONE SWATCH ROW, NOT AS TEN SWATCHES. Ten themes
   * meant ten arrivals, and with the mark and the nav links that was FIFTEEN
   * of the twenty-six elements on the first screen spent on the topbar, each
   * one a tween and a compositing layer. Reported from an iPad: "Animations are 2
   * fps at best, can't see transition at all." A row of swatches is one
   * control, and it reads as one. */
  '.site-rail > *',
  '.site-rail__nav > *',
  '.hero__stage',
  '.hero__copy > *',
].join(',');

/* How long an element may be ON SCREEN and not arrived before the guard stops
 * waiting and simply shows it. The guard looks twice as often as this, because
 * a queued element has to be seen waiting twice before it counts as stranded. */
const WATCHDOG_MS = 4000;

/* 🔴 HOW MANY MAY BE ARRIVING AT THE SAME TIME.
 *
 * This used to cap how LONG the cascade could last (twelve steps of
 * `--ov-cascade`) and shrink the step to fit, which means a busy screenful
 * animates every element at once: measured on the home page at iPad metrics,
 * twenty-six elements in flight together, each promoted to its own compositing
 * layer for the duration. Reported from an iPad: "Animations are 2 fps at best,
 * can't see transition at all."
 *
 * A rolling cascade overlaps by duration/step, so capping the overlap is the
 * same as putting a FLOOR under the step: one arrival starts every
 * `duration / MAX_ARRIVING` at the least, whatever the theme asks for. The
 * cascade then takes as long as it takes, which is the trade asked for:
 * "more procedural delay and less elements animating in at once".
 */
const MAX_ARRIVING = 6;

/* ⭐ A REGION WHOSE LAYOUT IS STILL SETTLING CAN HOLD ITS ARRIVALS. Elements
 * inside `[data-ov-reveal-hold]` stay queued, hidden, until the attribute comes
 * off and the page dispatches `ov:reveal-release`; the sweep then deals them
 * in their FINAL places. Found on the home page (2026-09-11): the wall packs by
 * measured height, and as src-fed components grew over the first second the
 * packing moved cells that were already arriving, one by 346px mid-fade.
 * 🔴 A hold can never strand anything: past HOLD_MAX_MS after start it is
 * ignored, and the guard's next look deals whatever it was keeping. */
const HOLD = '[data-ov-reveal-hold]';
const HOLD_MAX_MS = 2500;

function reduced() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* Duration and curve from the THEME, read off the element itself so a panel
 * carrying its own data-ov-theme arrives at its own rate. Same reading
 * ov-flip.js does, and for the same reason. */
function motionOf(el) {
  const cs = getComputedStyle(el);
  const raw = cs.getPropertyValue('--ov-dur-slow').trim();
  let ms = parseFloat(raw);
  if (!Number.isFinite(ms)) ms = 0;
  if (/[^m]s$/.test(raw)) ms *= 1000;
  const step = parseFloat(cs.getPropertyValue('--ov-cascade')) || 0;
  return { ms, step };
}

function engine() {
  const g = globalThis.gsap;
  return g && g.registerPlugin ? g : null;
}

/* The exact curve the theme declares, transcribed rather than approximated:
 * `cubic-bezier(a,b,c,d)` and the path `M0,0 C a,b c,d 1,1` are one curve. */
const EASES = new Map();
function easeFor(el, g) {
  const raw = getComputedStyle(el).getPropertyValue('--ov-ease').trim();
  const m = raw.match(/^cubic-bezier\(([^)]+)\)$/);
  const n = m ? m[1].split(',').map(Number) : [];
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || !globalThis.CustomEase) {
    return 'power2.out';
  }
  const key = n.join(',');
  if (!EASES.has(key)) {
    EASES.set(key, globalThis.CustomEase.create(
      `ov-reveal-${EASES.size}`, `M0,0 C${n[0]},${n[1]} ${n[2]},${n[3]} 1,1`));
  }
  return EASES.get(key);
}

function show(el) {
  // ⚠️ The class comes off FIRST, so the element is visible even if the
  // clean-up below throws. GSAP leaves inline opacity and transform behind;
  // clearing them puts the element back exactly as the page delivered it.
  el.classList.remove(PENDING);
  try {
    const g = engine();
    if (g) g.set(el, { clearProps: 'opacity,transform,willChange' });
  } catch { /* already arrived; nothing here can un-arrive it */ }
}

export function reveal(el, delay = 0) {
  if (!el.classList.contains(PENDING)) return null;
  const g = engine();
  const { ms } = motionOf(el);
  if (!g || ms <= 0) { show(el); return null; }
  const d = ms / 1000;
  const ease = easeFor(el, g);
  const tl = g.timeline({
    delay,
    // Promoted to its own layer for the arrival only; show() clears it.
    onStart: () => { try { g.set(el, { willChange: 'transform, opacity' }); } catch { /* unpromoted is fine */ } },
    onComplete: () => show(el),
    /* 🔴 If the tween is ever killed mid-flight, the element must not be left
     * faded or shrunk. Interruption resolves to ARRIVED, never to hidden. */
    onInterrupt: () => show(el),
  });
  /* ⚠️ TWO RAMPS, NOT ONE, AND THE OPACITY IS THE FAST ONE. motion.css rule 1
   * is an argument against fading at all: an element part-way through a fade is
   * below its palette contrast for those frames. Fading in over the first 55%
   * of the arrival keeps that window short while the scale carries the rest of
   * the movement, so the element is fully legible well before it stops
   * moving. */
  tl.to(el, { opacity: 1, duration: d * 0.55, ease: 'power1.out' }, 0);
  tl.to(el, { scale: 1, duration: d, ease }, 0);
  return tl;
}

/* Containers that arrive as ONE THING, whatever they happen to contain. A
 * component well is a single exhibit and a code block is a single object, so
 * neither may be broken into parts by the innermost-wins rule below. Without
 * this, one well of the thirty on the home page arrived as three separate rows,
 * because it is the only one whose demo is built from `.cells`. */
const ATOMIC = '.cw, .ov-code';

function collect(root) {
  const all = [...root.querySelectorAll(TARGETS)]
    .filter((el) => el.matches(ATOMIC) || !el.parentElement?.closest(ATOMIC));
  /* ⭐ INNERMOST WINS, so the unit of arrival is an ELEMENT rather than a
   * region. An outermost-wins pass collapsed the whole home page to seven
   * blocks, which reads as seven curtains rather than as content arriving.
   * Keeping only targets that contain no other target gives the leaf of each
   * structure, and the selector list stops at container children so this never
   * descends into a component's own internals and starts masking its parts. */
  return all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
}

/* Reading order: down the page, then across. ⚠️ NOT document order, which is
 * only sometimes the same thing. A grid's DOM order is whatever the generator
 * emitted; what the reader follows is the geometry. Tops are bucketed before
 * comparing, so two cells whose tops differ by a pixel of baseline rounding
 * still count as one row and are ordered left to right within it. */
const ROW_BAND = 40;
function readingOrder(els) {
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    return { el, row: Math.round((r.top + scrollY) / ROW_BAND), x: r.left };
  }).sort((a, b) => (a.row - b.row) || (a.x - b.x)).map((o) => o.el);
}

/* Take the pre-paint rule off. Everything below this point is per element, so
 * leaving the blanket rule on would hide things nothing is going to reveal. */
function disarm() {
  delete document.documentElement.dataset.ovArm;
}

export function start(root = document) {
  /* ⚠️ EVERY REASON TO DO NOTHING IS CHECKED BEFORE ANYTHING IS HIDDEN, and
   * every one of them disarms on the way out rather than waiting for the
   * inline script's timer. */
  /* ⭐ A PAGE THAT WILL NOT ANIMATE HAS ALREADY ARRIVED. ov-core holds every
   * live loop until this is said, so each way of declining has to say it, or
   * reduced motion would mean a page of instruments that never start. */
  const nothingToWaitFor = () => {
    disarm();
    dispatchEvent(new CustomEvent('ov:arrived'));
  };
  if (reduced()) { nothingToWaitFor(); return { revealed: 0, silent: 'reduced motion' }; }
  if (!engine()) { nothingToWaitFor(); return { revealed: 0, silent: 'gsap not loaded' }; }
  const els = collect(root);
  if (!els.length) { nothingToWaitFor(); return { revealed: 0, silent: 'nothing to reveal' }; }

  const { step } = motionOf(document.documentElement);
  const pending = new Set();

  /* 🔴 NEVER TAKE BACK WHAT THE READER HAS ALREADY SEEN. The arm hands the
   * page back after 1500ms so that slow or missing modules cannot leave it
   * blank, and when that happened this then hid the visible content again to
   * animate it in: the hero and the topbar arrived TWICE, which is what was
   * seen on the iPad. If the watchdog has already fired, anything in the
   * viewport has been on screen and stays put; everything below the fold is
   * still unseen and arrives normally.
   *
   * ⚠️ Every rect is read BEFORE any class is added. Reading one element's box
   * after hiding the previous one is a forced layout per element, which is the
   * interleave this repo has now fixed twice elsewhere. */
  const expired = document.documentElement.dataset.ovArmExpired === '1';
  const movable = els.filter((el) => motionOf(el).ms > 0);
  const seen = new Set();
  if (expired) {
    const fold = innerHeight;
    const tops = movable.map((el) => el.getBoundingClientRect().top);
    movable.forEach((el, i) => { if (tops[i] < fold) seen.add(el); });
  }

  for (const el of els) {
    if (motionOf(el).ms <= 0) continue;   // this theme declines motion
    if (seen.has(el)) continue;           // already shown; it does not re-arrive
    /* 🔴 HIDE ONLY AFTER THE HIDING HAS ACTUALLY WORKED, and never the other
     * way round. This loop used to add the class first, and an element whose
     * `style` was shadowed by a custom element method threw on setProperty
     * between the two lines: the class stayed, the throw escaped `start()`
     * before it could attach a listener or arm the watchdog, and a code block
     * on demo/data.html was masked permanently. Setting the property first
     * means an element this cannot drive is simply never hidden. */
    /* ⭐ THE CLASS IS THE WHOLE HIDDEN STATE, and adding it cannot throw. An
     * earlier version added the class and then set an inline property, and an
     * element whose `style` was shadowed threw between the two: class on,
     * nothing to take it off. There is no longer a gap to fall into. */
    el.classList.add(PENDING);
    pending.add(el);
  }

  /* 🔴 A SWEEP, NOT AN IntersectionObserver, AND THIS WAS MEASURED. The
   * observer only reports elements whose intersection actually CHANGED between
   * frames. Jump to the bottom of a long page, or follow an anchor, and every
   * block in between goes from below the viewport to above it without ever
   * being observed inside it: five of seven blocks on the home page stayed
   * masked until the watchdog fired. A sweep asks the only question that
   * matters, "is this at or past the fold", so an element scrolled clean past
   * is revealed rather than skipped. At one arrival per object there are seven
   * rects to read on this page, once per animation frame at most. */
  let guardTimer = 0;
  const done = () => {
    removeEventListener('scroll', tick);
    removeEventListener('resize', tick);
    removeEventListener('ov:reveal-release', sweep);
    clearInterval(guardTimer);
  };

  /* Handed to reveal() and mid-arrival: out of `pending`, so without this note
   * nothing would ever look at it again. The guard uses the start time to tell
   * an arrival still in progress from one that stopped. */
  const inflight = new Map();

  const began = performance.now();
  const held = (el) => performance.now() - began < HOLD_MAX_MS && !!el.closest(HOLD);

  /* Announced ONCE, when the elements of the first sweep have all stopped
   * moving. ov-core holds every live loop on this: see its arrival gate.
   * ⚠️ Polled rather than hooked into show(): show() is shared by every
   * arrival on the page, and this cares only about the first screenful. The
   * poll stops as soon as it has fired, and gives up with the guard's own
   * patience if a tween is stranded. */
  let firstBatch = null;
  let landed = false;
  let landTimer = 0;
  const announce = () => {
    if (landed) return;
    landed = true;
    clearInterval(landTimer);
    dispatchEvent(new CustomEvent('ov:arrived'));
  };
  const landWatch = () => {
    const began = performance.now();
    landTimer = setInterval(() => {
      if (![...firstBatch].some((el) => inflight.has(el))) announce();
      else if (performance.now() - began > WATCHDOG_MS * 2) announce();
    }, 100);
  };

  let ticking = false;
  const sweep = () => {
    ticking = false;
    const fold = innerHeight * 0.92;
    const hit = readingOrder(
      [...pending].filter((el) => !held(el) && el.getBoundingClientRect().top < fold));
    /* A procedural delay per element, accumulating in reading order so that a
     * screenful fills in the order it is read.
     *
     * 🔴 THE STEP IS COUNTED OVER WHAT THE READER CAN SEE, NOT OVER THE BATCH,
     * and this is the whole difference between a cascade and a flash. A sweep
     * takes everything past the fold, which after a jump or an anchor means
     * every block SCROLLED CLEAN PAST as well: measured on the home page, a
     * jump to the component wells swept forty-three elements at once, of which
     * thirty-one were already above the viewport. Counting those spent all
     * twelve steps of the cascade on content nobody is looking at, and the
     * whole screenful then arrived together on the capped delay. Anything
     * already scrolled past arrives at once, and the count starts at the top of
     * the viewport. */
    const onscreen = new Set(
      hit.filter((el) => el.getBoundingClientRect().bottom > 0));
    /* ⭐ AND THE CASCADE HAS A FIXED LENGTH RATHER THAN A FIXED STEP. Capping
     * the INDEX instead gave a staircase and then a wall: on a docs page only
     * 1616px tall against a 1297px viewport, forty-five elements are all
     * genuinely on screen, twelve arrived 60ms apart and the remaining
     * thirty-three landed together on the capped delay at 863ms. Holding the
     * LENGTH and shrinking the step keeps every element's own moment and still
     * deals the whole screenful inside the same window: those forty-five now
     * come 16ms apart. A step never grows beyond the theme's own, so an
     * ordinary handful still arrives at exactly `--ov-cascade`. */
    /* The floor under the step: never start them faster than MAX_ARRIVING can
     * be in flight at once. `dur` is read from the root rather than per
     * element, because the spacing is a property of the cascade, not of
     * whichever element happens to be next. */
    const { ms: dur } = motionOf(document.documentElement);
    const gap = Math.max(step, dur / MAX_ARRIVING);
    let seen = 0;
    hit.forEach((el) => {
      const i = onscreen.has(el) ? seen++ : 0;
      pending.delete(el);
      /* One element that cannot be animated must not stop the rest arriving,
       * and must not stay hidden either. */
      try {
        inflight.set(el, performance.now());
        reveal(el, (gap * i) / 1000);
      } catch {
        show(el);
      }
    });
    /* ⭐ THE FIRST SCREENFUL IS WHAT "ARRIVED" MEANS. `done()` waits for the
     * whole page, which on a long one is not until the reader has scrolled it
     * all, and everything live would stay stopped until then. The first sweep
     * is the arrival the reader actually watches. */
    if (!firstBatch && hit.length) { firstBatch = new Set(hit); landWatch(); }
    if (!pending.size && !inflight.size) done();
  };
  const tick = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(sweep);
  };

  /* The last resort, on a repeat rather than once. Two things can strand an
   * element, and each is caught here in the only way it can be:
   *
   *   - An arrival that started and never finished. GSAP's timeline killed,
   *     paused, or never rendered leaves the element at opacity 0 with the
   *     class still on. `show()` takes both off.
   *   - An element that is past the fold and still queued. The sweep should
   *     have taken it, so if it is still here on a SECOND look the sweep is not
   *     running at all. Two looks rather than one, because the sweep is a frame
   *     away and the guard must not race it.
   *
   * Anything short of the fold is left where it is. That is the whole
   * difference between a guard and the old timer. */
  let stale = new Set();
  const guard = () => {
    const now = performance.now();
    for (const [el, at] of inflight) {
      if (!el.classList.contains(PENDING)) inflight.delete(el);
      else if (now - at > WATCHDOG_MS) { inflight.delete(el); show(el); }
    }
    const fold = innerHeight * 0.92;
    const next = new Set();
    for (const el of pending) {
      if (held(el) || el.getBoundingClientRect().top >= fold) continue;
      if (stale.has(el)) { pending.delete(el); show(el); } else next.add(el);
    }
    stale = next;
    /* And a sweep every time, in case a scroll event was never delivered or
     * something loading late moved the page under a queue that had settled. */
    if (pending.size) tick();
    else if (!inflight.size) done();
  };

  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', tick, { passive: true });
  /* A release SWEEPS AT ONCE rather than waiting for a frame: it is one event,
   * not a stream to batch, and the layout it announces is already final.
   * ⚠️ Found by tools/reveal-test under headless virtual time, where frames
   * never run: released elements sat queued until the guard came round. */
  addEventListener('ov:reveal-release', sweep);
  const total = pending.size;
  /* Armed BEFORE the first sweep, so that a throw anywhere below still leaves
   * something running that can un-hide the page. */
  guardTimer = setInterval(guard, WATCHDOG_MS / 2);
  /* Every element is now carrying its own class, so the blanket rule has done
   * its job and must come off before the first sweep reveals anything. */
  disarm();
  sweep();                       // whatever is already in view arrives now

  return { revealed: total, silent: null };
}

if (typeof document !== 'undefined') {
  const go = () => start(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go, { once: true });
  } else go();
}

Overscan.Reveal = { start, reveal, TARGETS };

export default Overscan.Reveal;
