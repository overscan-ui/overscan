/* Named data sources.
 *
 * Widgets never hold their own data. They name a source and render whatever it
 * emits, so swapping a fixture for a real feed is one call and touches no
 * markup and no widget code:
 *
 *   Overscan.source('flux', realFeed)    // replaces the fixture, same name
 *
 * A source emits a reading, and a reading is allowed to be nothing. That is
 * the whole reason this layer exists rather than widgets polling a number: a
 * feed that drops out has to be able to SAY so, and `null` is a value the
 * refusal protocol understands. A source that quietly repeats its last reading
 * when the sensor stops is the invention this kit exists to refuse.
 */
import { whenArrived } from './ov-core.js';

(() => {
  const sources = new Map();
  const subs = new Map();
  let started = false;

  /* fn(t, i) returns a number, or null for a dropout, or
   * {value, age} to mark a reading as old. */
  function source(name, fn, opts = {}) {
    sources.set(name, { fn, hz: opts.hz || 4, i: 0, t0: performance.now() });
    if (!subs.has(name)) subs.set(name, new Set());
    start();
    return name;
  }

  function subscribe(name, cb) {
    if (!subs.has(name)) subs.set(name, new Set());
    subs.get(name).add(cb);
    return () => subs.get(name).delete(cb);
  }

  function start() {
    if (started) return;
    started = true;
    const tick = () => {
      const now = performance.now();
      for (const [name, s] of sources) {
        const listeners = subs.get(name);
        // Catch up in whole samples, and derive the value from the sample
        // INDEX rather than from the wall clock.
        //
        // Emitting one sample per frame and computing it from performance.now()
        // meant that whenever the loop fell behind, readings were taken at
        // irregular real times while the chart plotted them as evenly spaced.
        // That is exactly the dishonesty this kit exists to refuse, committed
        // in the layer that feeds it: the x axis was claiming a uniform sample
        // rate the source was not delivering.
        let budget = 64;
        while (s.i / s.hz * 1000 <= now - s.t0 && budget-- > 0) {
          const reading = s.fn(s.i / s.hz, s.i);
          s.i += 1;
          if (listeners) for (const cb of listeners) cb(reading);
        }
        // If the tab was hidden for a minute, do not replay a minute of
        // history: skip forward and take the gap as a gap.
        if (budget <= 0) s.i = Math.ceil((now - s.t0) / 1000 * s.hz);
      }
      requestAnimationFrame(tick);
    };
    /* 🔴 THE FEEDS WAIT FOR THE PAGE TO ARRIVE. Sampling at 60Hz and pushing
     * to every subscriber was the largest single piece of script during load
     * (342ms of the first five seconds at 4x), and none of it can be read
     * while the page is still animating itself in. The readings that would
     * have been taken are not buffered: a feed states its own start, and a
     * gap before the page was ready is a gap. */
    whenArrived(() => requestAnimationFrame(tick));
  }

  Object.assign(window.Overscan, { source, subscribe, sources });
})();

export const { source, subscribe, sources } = window.Overscan;
