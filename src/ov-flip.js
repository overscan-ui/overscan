/* Overscan.Flip - animating a layout change, and refusing to animate the part
 * of it that would be a lie.
 *
 * A reorder is the one animation in this kit that carries INFORMATION rather
 * than character. When a table sorts, the rows land somewhere new and the eye
 * has no way to follow any particular one. Animating the move answers "where
 * did that row go", which is a question the reorder itself raised and then
 * refused to answer. That is why this exists, and it is the only reason: this
 * module is wired to layout changes and to nothing else.
 *
 * ⚠️ IT MUST NEVER BECOME AN ARRIVAL CASCADE. motion.css rule 2 says stagger
 * encodes the signal path and nothing else, and there is deliberately no way
 * to stagger decoratively. A reorder is not a stagger: every element moves at
 * once, each to the place it actually went. There is no entry point here that
 * animates a set of unrelated cells into view one after another, and adding
 * one would be the decoration rule 2 exists to refuse.
 *
 * ── WHY NOT VIEW TRANSITIONS ──────────────────────────────────────────────
 *
 * The native answer is `document.startViewTransition`, it is supported
 * everywhere this kit cares about, and it costs nothing to ship. It is still
 * the wrong tool HERE, for a reason specific to this kit: 🔴 THE API ANIMATES
 * BY SNAPSHOTTING, AND A SNAPSHOT OF A LIVE WEBGL FIELD IS A STILL. Every
 * theme paints its field from a shader, so a view transition would freeze
 * every field on the page for the duration of every sort. A kit whose whole
 * identity is animated fields cannot stop them in order to animate a table.
 * ⚠️ Second, smaller: the API's default pairing is a cross-fade, which rule 1
 * forbids, so correct behaviour would have to be written as an override of the
 * default rather than being the default.
 *
 * ── WHY GSAP FLIP ─────────────────────────────────────────────────────────
 *
 * This module first shipped on the Web Animations API, on the argument that a
 * dependency could only approximate `--ov-ease`. ⚠️ THAT ARGUMENT WAS WRONG.
 * `CustomEase` reproduces a `cubic-bezier(a, b, c, d)` exactly, because the
 * two spell the same curve: the path `M0,0 C a,b c,d 1,1` IS that bezier. The
 * theme's curve arrives intact, not as a near miss. The real defect was that
 * the choice was never put to the person whose plan named GSAP.
 *
 * ⭐ AND THE MATCHING IS THE REASON TO WANT IT. `ov-table` rebuilds its rows on
 * every repaint, so the nodes after a sort are different DOM elements from the
 * ones measured before it. Matching state across a rebuild is precisely what
 * GSAP's Flip uses `data-flip-id` for, which is why the attribute the
 * components emit is spelled that way. Writing that matching by hand is the
 * part worth not owning.
 *
 * ⚠️ IT IS THE KIT'S FIRST RUNTIME DEPENDENCY, and it is deliberately not
 * bundled: the kit has no build step, so the PAGE loads GSAP and this module
 * reads it off the global. A bundler consumer injects it through `use()`
 * instead. If it is absent, nothing animates, every row is simply already in
 * its new place, and the report says `gsap not loaded` rather than pretending.
 *
 * ── WHAT IT REFUSES ───────────────────────────────────────────────────────
 *
 * 🔴 THIS IS THE POINT OF THE MODULE. `ov-table` is virtualised, so a sort can
 * move a row from inside the rendered window to outside it, and that row has
 * no destination on screen. Tweening it toward a plausible spot is the display
 * inventing a position nobody computed: an invented reading, in motion instead
 * of in a seven-segment readout. Three cases are declined, and the count of
 * each is reported rather than swallowed:
 *
 *   left      rendered before, not rendered after. Went somewhere the
 *             virtualiser never drew. There is no destination to move to.
 *   arrived   rendered after, not before. Came from somewhere never drawn.
 *             There is no origin to move from.
 *   too-far   the move is longer than the container is tall. The eye cannot
 *             follow a slide it never sees the middle of, so this is not a
 *             move that carries information: it is theatre. Declined.
 *
 * 🔴 THE FIRST TWO ONLY COUNT AS REFUSALS IF THE CONTAINER RENDERS A WINDOW
 * ONTO SOMETHING LARGER, so a container has to SAY that it does, with
 * `data-ov-flip="windowed"`. `ov-table` is windowed: a row that vanished went
 * somewhere real that the virtualiser declined to draw, and losing track of it
 * is the thing worth admitting. `ov-tree` is NOT: expanding a node makes eight
 * children appear that were not anywhere before, and calling those eight a
 * refusal would report the ordinary operation of the control as a fault.
 *
 * ⚠️ A gate that fires on the normal case teaches people to ignore it, which
 * costs more than the gate was ever worth. So an unwindowed container counts
 * arrivals and departures, reports them, and declines NOTHING for them.
 *
 * A declined element is simply THERE, in its new place, immediately. That is
 * the same fail-safe every reveal in motion.css takes: the resting state is
 * the FINISHED state, and a missing effect is never the reason something is
 * wrong on screen.
 *
 * ⚠️ AND IT SAYS SO, the way `ov-chart` says "12 of 300 dropped" rather than
 * quietly closing the gap. The count lands on `data-ov-flip-declined`, in a
 * note element this module owns, and on an `ov:flip` event.
 *
 * ── TWO THINGS THAT SILENCE IT ────────────────────────────────────────────
 *
 * - `prefers-reduced-motion: reduce`. Handled here because this is script;
 *   motion.css handles its own and is not re-handled.
 * - ⭐ A THEME WHOSE DURATIONS ARE ZERO. `antiseptic` sets `--ov-dur-slow: 0ms`
 *   because nobody operates a film loop. That is the theme declaring it does
 *   not animate, and a script that animated anyway would be overriding the
 *   theme from underneath it. Zero duration means no animation, not a default.
 */

import { Overscan } from './ov-core.js';

const ATTR = 'data-flip-id';
const NOTE = 'ov-flip__declined';

/* GSAP is resolved, never imported. A bare `import 'gsap'` would need a build
 * step or an import map, and this kit has neither: its whole delivery promise
 * is that a page can load `src/*.js` directly.
 *
 * ⚠️ NOT CACHED WHEN ABSENT, only when found. A page may load this module
 * before the GSAP tags below it have run, and remembering "no" on the first
 * call would make script order decide whether the kit animates. */
let ENGINE = null;

export function use(lib = {}) {
  const g = lib.gsap || globalThis.gsap;
  const F = lib.Flip || globalThis.Flip;
  const C = lib.CustomEase || globalThis.CustomEase;
  if (!g || !F) return null;
  g.registerPlugin(F);
  if (C) g.registerPlugin(C);
  ENGINE = { gsap: g, Flip: F, CustomEase: C || null };
  return ENGINE;
}

function engine() { return ENGINE || use({}); }

/* One CustomEase per distinct curve, because creating one parses a path and
 * every theme in this kit currently declares the same bezier. */
const EASES = new Map();

function easeFor(css, eng, report) {
  const raw = (css || '').trim();
  if (!raw || raw === 'linear') { report.easeExact = true; return 'none'; }
  const m = raw.match(/^cubic-bezier\(([^)]+)\)$/);
  const n = m ? m[1].split(',').map((v) => parseFloat(v)) : [];
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || !eng.CustomEase) {
    /* ⚠️ Reported, not written into the note. A missing CustomEase is missing
     * on every run, so noting it would be the gate that fires on the normal
     * case that the header refuses to build. The fact still lands on the
     * report and the `ov:flip` event, where a test can see it. */
    report.easeExact = false;
    return 'power2.out';
  }
  const key = n.join(',');
  if (!EASES.has(key)) {
    /* A transcription, not an approximation: `cubic-bezier(a,b,c,d)` and
     * `M0,0 C a,b c,d 1,1` are two spellings of one curve. */
    EASES.set(key, eng.CustomEase.create(
      `ov-ease-${EASES.size}`, `M0,0 C${n[0]},${n[1]} ${n[2]},${n[3]} 1,1`));
  }
  report.easeExact = true;
  return EASES.get(key);
}

function reduced() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* Duration and curve come from the THEME, read off the moving element itself
 * rather than from the document, so a panel carrying `data-ov-theme` animates
 * at its own theme's rate and not at the page's. */
function motionOf(el) {
  const cs = getComputedStyle(el);
  const raw = cs.getPropertyValue('--ov-dur-slow').trim();
  const ease = cs.getPropertyValue('--ov-ease').trim() || 'linear';
  let ms = parseFloat(raw);
  if (!Number.isFinite(ms)) ms = 0;
  // "0.42s" and "420ms" both occur in author CSS; only the former needs scaling.
  if (/[^m]s$/.test(raw)) ms *= 1000;
  return { ms, ease };
}

/* Rects are VIEWPORT-relative on purpose, and the container's own scroll is
 * deliberately not corrected for. FLIP animates what the viewer saw: if a row
 * was at screen-y 300 and is now at screen-y 100, that is where it went, and
 * `ov-table.sort()` resetting scrollTop to 0 is part of the move rather than
 * something to subtract out of it. */
export function capture(root) {
  if (!root) return null;
  const els = root.querySelectorAll(`[${ATTR}]`);
  const rects = new Map();
  for (const el of els) rects.set(el.getAttribute(ATTR), el.getBoundingClientRect());
  /* ⭐ TWO RECORDS OF ONE MOMENT, and they are not interchangeable. `rects` is
   * what the REFUSALS are decided from: which ids were on screen, and how far
   * each one travelled. GSAP's state is what the surviving moves are animated
   * from, and it exists separately because Flip matches rebuilt nodes to it by
   * `data-flip-id` internally. Deriving one from the other would mean
   * reimplementing that matching, which is the reason GSAP is here at all.
   *
   * The GSAP half is null when GSAP is absent, and the refusal half still
   * works, so an unanimated page still reports what it could not have shown. */
  const eng = engine();
  return { rects, gsap: eng ? eng.Flip.getState(els) : null };
}

/* Where the refusal is written down. A real element rather than a pseudo:
 * `ov-table` already spends its host `::after` on the ARIA defect it admits
 * to, and a module that reached for a pseudo-element on another component's
 * host would be the CSS form of the `ov-` prefix collision. This one is ours,
 * it is a flex child so it lands after the foot where "what I did not do"
 * belongs, and it is re-created if a rebuild wipes it. */
function note(root, text) {
  let el = root.querySelector(':scope > .' + NOTE);
  if (!text) {
    root.removeAttribute('data-ov-flip-declined');
    el?.remove();
    return;
  }
  root.setAttribute('data-ov-flip-declined', text);
  if (!el) {
    el = document.createElement('p');
    el.className = NOTE;
    root.append(el);
  }
  el.textContent = text;
}

function phrase(r) {
  const parts = [];
  /* An unwindowed container's arrivals and departures are not refusals and are
   * deliberately absent here: see the header. Reporting them would be the gate
   * firing on the normal case. */
  if (r.windowed && r.left) parts.push(`${r.left} left the window`);
  if (r.windowed && r.arrived) parts.push(`${r.arrived} arrived from outside it`);
  if (r.tooFar) parts.push(`${r.tooFar} moved farther than the window is tall`);
  if (!parts.length) return '';
  return `${r.declined} of ${r.total} not animated: ${parts.join(', ')}`;
}

/* Animate from the captured layout to the current one.
 *
 * Returns a report ALWAYS, including when nothing animated, because "it did
 * not run" and "it ran and moved nothing" are different facts and a caller
 * that cannot tell them apart cannot test either. */
export function play(root, captured) {
  const report = {
    total: 0, moved: 0, declined: 0, left: 0, arrived: 0, tooFar: 0,
    windowed: false, ran: false, silent: null, easeExact: null,
  };
  if (!root || !captured) { report.silent = 'nothing captured'; return report; }
  const state = captured.rects;

  /* Only a container that renders a SUBSET can lose track of something. See
   * the header: this is what separates ov-table from ov-tree. */
  report.windowed = (root.getAttribute('data-ov-flip') || '').includes('windowed');

  const now = new Map();
  for (const el of root.querySelectorAll(`[${ATTR}]`)) {
    now.set(el.getAttribute(ATTR), el);
  }
  report.total = new Set([...state.keys(), ...now.keys()]).size;

  if (reduced()) report.silent = 'reduced motion';
  const { ms, ease } = motionOf(root);
  if (!report.silent && ms <= 0) report.silent = 'theme declines motion';
  /* Last of the three, so a page with no GSAP still reports the theme's own
   * refusal to animate rather than blaming the missing library for it. */
  const eng = engine();
  if (!report.silent && !eng) report.silent = 'gsap not loaded';

  // Everything that was rendered before and is not now went somewhere the
  // virtualiser never drew.
  for (const id of state.keys()) if (!now.has(id)) report.left++;

  const reach = root.getBoundingClientRect().height || Infinity;
  const moves = [];
  for (const [id, el] of now) {
    const was = state.get(id);
    if (!was) { report.arrived++; continue; }
    const is = el.getBoundingClientRect();
    const dx = was.left - is.left;
    const dy = was.top - is.top;
    // Sub-pixel is not a move; animating it is a frame of jitter.
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    if (Math.hypot(dx, dy) > reach) { report.tooFar++; continue; }
    moves.push([el, dx, dy]);
  }

  report.declined = report.tooFar
    + (report.windowed ? report.left + report.arrived : 0);

  if (!report.silent) {
    /* Only the moves that survived the refusals are handed over. Everything
     * declined is left exactly where the repaint already put it, which is the
     * fail-safe the header describes: the resting state is the finished one. */
    const targets = moves.map(([el]) => el);
    if (targets.length) {
      eng.Flip.from(captured.gsap, {
        targets,
        duration: ms / 1000,
        ease: easeFor(ease, eng, report),
        /* A second sort during the first REPLACES it rather than stacking on
         * top of it. GSAP measured the current rect through the running
         * transform, so the new move already starts from where the row
         * visibly is rather than from where it would have landed. */
        overwrite: true,
        /* 🔴 TRANSFORM ONLY, NEVER OPACITY. motion.css rule 1: an element
         * fading in fails contrast while it fades, so every frame here is
         * fully painted and only its position is in question.
         *
         * ⚠️ `onEnter` and `onLeave` are GSAP's hooks for exactly the elements
         * this module refuses to animate, and they fade by convention. They
         * are deliberately not passed. A row with nowhere to have come from is
         * a refusal to report, not an opportunity to cross-fade. */
      });
      report.moved = targets.length;
    }
    report.ran = report.moved > 0;
  }

  note(root, phrase(report));
  root.dispatchEvent(new CustomEvent('ov:flip', { detail: report, bubbles: true }));
  return report;
}

/* The declarative door. A component announces a reorder around its own repaint
 * and never learns this module exists:
 *
 *     this.dispatchEvent(new CustomEvent('ov:reorder', {detail:{phase:'before'}}))
 *     ...repaint...
 *     this.dispatchEvent(new CustomEvent('ov:reorder', {detail:{phase:'after'}}))
 *
 * ⚠️ Deliberately NOT an is-this-loaded check inside the component. A component
 * that asked whether Flip was present would be a component that knows about
 * Flip. Events cost nothing when nobody is listening. */
export function watch(root) {
  if (!root || root.__ovFlipWatched) return root;
  root.__ovFlipWatched = true;
  let state = null;
  root.addEventListener('ov:reorder', (e) => {
    if (e.detail?.phase === 'before') state = capture(root);
    else if (e.detail?.phase === 'after') { play(root, state); state = null; }
  });
  return root;
}

/* Auto-wire anything that declares it reorders, now and as it arrives. A
 * component opts in with `data-ov-flip` and gets the behaviour with no script
 * on the page at all. */
function scan(within) {
  for (const el of within.querySelectorAll?.('[data-ov-flip]') || []) watch(el);
}

if (typeof document !== 'undefined') {
  const start = () => {
    scan(document);
    new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.hasAttribute('data-ov-flip')) watch(n);
          scan(n);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();
}

Overscan.Flip = { capture, play, watch, use };

export default Overscan.Flip;
