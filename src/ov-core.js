/* The one thing every module in the kit imports.
 *
 * Two jobs, and they exist for the same reason: a module graph has no load
 * ORDER the way a page full of <script defer> tags does. Anything that used to
 * be guaranteed by "ov-source.js is listed first" has to be guaranteed by an
 * import now, and this is what gets imported.
 *
 * ── THE NAMESPACE ─────────────────────────────────────────────────────────
 *
 * `window.Overscan` stays, and not for backwards compatibility alone. Demo
 * pages call `Overscan.source(...)` from INLINE classic scripts, which run
 * before any module does and cannot import anything. The global is the only
 * surface those pages have. Modules export properly as well, so a bundler sees
 * a real graph and a page sees a real global, and neither is a shim.
 *
 * ── THE GUARD ─────────────────────────────────────────────────────────────
 *
 * 🔴 `customElements.define` THROWS on a name that is already defined, and all
 * 35 elements called it bare. That is fine for a page that loads each file once
 * and fatal the moment a bundler resolves a module twice or Vite hot-reloads a
 * file: NotSupportedError, thrown at import time, which takes down every
 * element defined after it in the same module. A framework user hits this on
 * their first save, and the error names the element rather than the cause.
 *
 * ⚠️ The guard returns the EXISTING class rather than the new one. Two copies
 * of the kit on one page is already a bug; upgrading half the elements to one
 * copy and half to the other would make it an unreadable bug.
 */
window.Overscan = window.Overscan || {};

export const Overscan = window.Overscan;

export function define(name, cls) {
  const existing = customElements.get(name);
  if (existing) return existing;
  customElements.define(name, cls);
  return cls;
}

/* ── THE VISIBILITY GATE ───────────────────────────────────────────────────
 *
 * A redraw loop nobody can see is the main thread's largest cost on a page of
 * these. One IntersectionObserver for every element that asks, with
 * the same generous margin ov-gl uses, so a loop is running again before its
 * element scrolls in. An element keeps ALL its data while unseen; only the
 * drawing waits, and wake() is how it resumes.
 *
 * ⚠️ No `document.hidden` gate, for the reason ov-gl.js gives: rAF already
 * stops in a hidden document, and an embedded view can report hidden while it
 * is on screen. `display:none` needs nothing extra: no box, not intersecting.
 */
const seenState = new WeakMap();
const seenIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const s = seenState.get(e.target);
    if (!s) continue;
    const was = s.on;
    s.on = e.isIntersecting;
    if (s.on && !was) s.wake();
  }
}, { rootMargin: '200px' });

/* Assumed visible until the observer says otherwise, so an element already on
 * screen draws its first frame rather than its second. Returns the unwatch. */
export function watchSeen(el, wake) {
  seenState.set(el, { on: true, wake });
  seenIO.observe(el);
  return () => { seenIO.unobserve(el); seenState.delete(el); };
}

export function isSeen(el) {
  const s = seenState.get(el);
  return !s || s.on;
}

/* ── THE ARRIVAL GATE ──────────────────────────────────────────────────────
 *
 * 🔴 NOTHING LIVE RUNS WHILE THE PAGE IS STILL ARRIVING. The report from
 * the iPad was that the hero and the topbar animations were fighting something,
 * and they were: the moment each element module executed, its elements
 * subscribed to feeds, started shader frames and set flip timers, so the
 * arrival animation ran against a page already busy driving everything on it.
 *
 * The order this gate imposes is the whole point. Elements render while the
 * page is held hidden, the arrival animates against a page that has stopped
 * moving, and only then does anything start ticking.
 *
 * ⚠️ A page can have no reveal at all (a demo that loads one element, a
 * bundled consumer), and it must still come alive: the load fallback covers
 * that, and the cap covers a reveal that never finishes. Both are LATE rather
 * than early, because starting too early is the bug being fixed.
 */
let arrived = false;
const waitingForArrival = new Set();

function land() {
  if (arrived) return;
  arrived = true;
  for (const fn of [...waitingForArrival]) {
    // One loop that throws on its first frame must not keep the rest stopped.
    try { fn(); } catch (e) { console.error('overscan: a loop failed to start', e); }
  }
  waitingForArrival.clear();
}

export function whenArrived(fn) {
  if (arrived) { fn(); return () => {}; }
  waitingForArrival.add(fn);
  return () => waitingForArrival.delete(fn);
}

export function hasArrived() { return arrived; }

if (typeof window !== 'undefined') {
  addEventListener('ov:arrived', land);
  /* No reveal on this page: once loading is done and nothing is waiting to
   * arrive, there is nothing to keep quiet for.
   *
   * 🔴 `readyState` FIRST, because a module can execute AFTER `load` has
   * already fired and the listener would then never run: every board on
   * tools/flap-test/ sat blank until the cap, which is how this was caught.
   *
   * ⚠️ Still armed means the reveal has not started yet, not that there is
   * nothing to wait for. Landing then would start every loop underneath an
   * arrival that is about to begin, which is the whole bug this gate exists
   * to prevent. */
  const settle = () => {
    const t = setInterval(() => {
      if (arrived) { clearInterval(t); return; }
      // Armed: an arrival is coming, so this is not the moment to decide.
      if (document.documentElement.dataset.ovArm) return;
      if (document.querySelector('.ov-reveal--pending')) return;
      clearInterval(t);
      land();
    }, 200);
  };
  if (document.readyState === 'complete') settle();
  else addEventListener('load', settle);
  /* The cap. A reveal that never finishes must not leave a page of frozen
   * instruments: a late start is a delay, a start that never comes is a dead
   * page, and only one of those is recoverable by the reader. */
  setTimeout(land, 6000);
}

Overscan.whenArrived = whenArrived;
Overscan.hasArrived = hasArrived;
