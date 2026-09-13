/* <ov-scope> - a phosphor persistence trace, drawn in GL.
 *
 * ⚠️ The kit already has <ov-wave>, which is a persistence trace in SVG. This
 * is not a nicer version of that, and if it were it should not exist. It earns
 * a second implementation on exactly one property, which SVG cannot express:
 *
 *   🔴 BEAM INTENSITY IS DWELL TIME. A real scope deposits a constant amount
 *   of light per unit TIME, not per unit LENGTH, so the trace is bright where
 *   it moves slowly and faint where it moves fast. A stroked polyline has one
 *   opacity along its whole length, which inverts the physics: it is brightest
 *   in appearance exactly where a real beam is faintest.
 *
 * So <ov-wave> is the honest default and stays the default. Reach for this
 * when the SHAPE of the signal is the reading, because that is when the dwell
 * cue carries information rather than atmosphere.
 *
 * ⭐ It keeps <ov-wave>'s discipline about its own sample rate. A waveform was
 * measured discarding 99.27% of its samples before paint and saying nothing.
 * A trace drawn at 60Hz from an 8kHz source is showing a fraction of a percent
 * of what arrived, and the reader is entitled to know which fraction.
 *
 * 🔴 And it refuses. An empty buffer draws no trace and says so, rather than
 * drawing a flat line at zero, which is a reading and not an absence.
 */

import { define } from './ov-core.js';
import './ov-source.js';
import './ov-gl.js';

/* ⚠️ WRAPPED IN AN IIFE, and every file in this kit should be.
 *
 * These load as CLASSIC scripts, not modules, which means every top-level
 * `const`, `let`, `class` and `function` lands in ONE shared global lexical
 * scope. Two files declaring the same name is a SyntaxError that kills the
 * second file outright: no custom element defined, no error at the element,
 * just a tag that never upgrades and renders as an empty box.
 *
 * That is exactly how this was found. `const LINES` here collided with
 * `const LINES` in demo/fixtures.js, ov-waterfall.js never executed, and the
 * symptom was a transparent panel with the page's field showing through it.
 * Nothing pointed at the real cause until an error listener was added to the
 * page by hand.
 *
 * `customElements.define` works perfectly well from inside a closure, so
 * there is no cost to this. tools/collisions.py checks for it.
 */
(() => {


const SAMPLES = 256;   // texture width: samples across one sweep
const SWEEPS = 24;     // texture height, and the shader's loop ceiling

class OvScope extends Overscan.GL {
  static observedAttributes = ['source', 'sweeps', 'window'];

  get shaderName() { return 'scope'; }

  connectedCallback() {
    this.buf = [];
    this.history = [];
    this.seen = 0;
    this.pixels = new Uint8Array(SAMPLES * SWEEPS);
    this.note = document.createElement('span');
    this.note.className = 'ov-scope__note';
    this.bind();
    const r = super.connectedCallback();
    this.appendChild(this.note);
    this.report();
    return r;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.unsub) this.unsub();
  }

  attributeChangedCallback(n) {
    if (this.isConnected && n === 'source') this.bind();
  }

  get cap() {
    return Math.max(16, parseInt(this.getAttribute('window') || '160', 10));
  }

  get sweeps() {
    const n = parseInt(this.getAttribute('sweeps') || '16', 10);
    return Math.max(1, Math.min(SWEEPS, n));
  }

  ready() { this.tex = Overscan.GL.makeDataTexture(this.gl); }

  bind() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan || !window.Overscan.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (r) => {
      const v = (r && typeof r === 'object') ? r.value : r;
      this.seen += 1;
      // A null is an absence, not a zero. Dropping it is right; substituting
      // 0 would be the invention this kit exists to refuse.
      if (v === null || v === undefined || !Number.isFinite(Number(v))) return;
      this.buf.push(Number(v));
      while (this.buf.length > this.cap) this.buf.shift();
      this.tick();
    });
  }

  /* One sweep, resampled to the texture width. Values arrive 0..100 like the
   * rest of the kit's fixtures and are stored 0..255 with 0 at the BOTTOM,
   * because the shader compares against uv.y and GL's y points up. */
  sweep() {
    const n = this.buf.length;
    const row = new Uint8Array(SAMPLES);
    if (n < 2) return row;
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / (SAMPLES - 1)) * (n - 1);
      const a = Math.floor(t), b = Math.min(n - 1, a + 1);
      const v = this.buf[a] + (this.buf[b] - this.buf[a]) * (t - a);
      row[i] = Math.max(0, Math.min(255, Math.round((v / 100) * 255)));
    }
    return row;
  }

  /* 🔴 The readout is driven by ARRIVING DATA, not by the draw loop.
   *
   * An instrument that is scrolled offscreen stops drawing, which is correct
   * and is most of why a page with forty shaders is affordable. Its readout
   * must not stop with it: the note says how much data arrived and how much
   * is held, and both keep happening while nothing is being painted. Driving
   * it from uniforms() left culled instruments showing a stale refusal over a
   * canvas that was visibly full of signal, which is the instrument
   * contradicting itself. */
  tick() {
    const now = performance.now();
    if (now - (this.lastNote || 0) < 400) return;
    this.lastNote = now;
    this.report();
  }

  report() {
    const held = this.history.length;
    if (this.buf.length < 2) {
      // 🔴 No signal is not a signal of zero.
      this.setAttribute('data-ov-refusal', 'unknown');
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'no signal: the scope is not drawing a trace');
      this.note.textContent = 'no signal';
      return;
    }
    this.removeAttribute('data-ov-refusal');
    const kept = this.seen ? (this.buf.length / this.seen) * 100 : 100;
    const pct = kept < 1 ? kept.toFixed(2) : kept.toFixed(0);
    const s1 = held === 1 ? '' : 's';
    this.note.textContent =
      `${this.seen} in, ${this.buf.length} held (${pct}%), ${held} sweep${s1} lit`;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label',
      `trace of ${this.buf.length} of ${this.seen} samples, ${pct} percent,`
      + ` with ${held} sweep${s1} of persistence`);
  }

  uniforms(s) {
    const gl = this.gl;

    // A new sweep per frame, oldest first, because that is the order the
    // shader walks and the order age is measured in.
    if (this.buf.length > 1) {
      this.history.push(this.sweep());
      while (this.history.length > this.sweeps) this.history.shift();
      for (let r = 0; r < this.history.length; r++) {
        this.pixels.set(this.history[r], r * SAMPLES);
      }
      Overscan.GL.uploadData(this.tex, this.pixels, SAMPLES, SWEEPS, this.gl);
    }

    // 🔴 Wall clock, NOT the animation clock. `t` is frozen to 0 under
    // prefers-reduced-motion, which is correct for the trace and wrong for
    // this: the note reports how much data arrived, which keeps happening
    // whether or not anything is allowed to move. Driving it off `t` would
    // freeze the readout for exactly the people who most need it to be text.

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    this.set('u_data', gl.uniform1i, 0);
    this.set('u_shape', gl.uniform3f, SAMPLES, SWEEPS, this.history.length);

    this.set('u_field', gl.uniform3fv, this.rgb(s, '--ov-field'));
    this.set('u_phosphor', gl.uniform3fv, this.rgb(s, '--ov-accent'));
    this.set('u_grid', gl.uniform3fv, this.rgb(s, '--ov-line'));
    this.set('u_persist', gl.uniform1f, this.num(s, '--ov-scope-persist', 0.6));
    this.set('u_beam', gl.uniform1f, this.num(s, '--ov-scope-beam', 1.3));
    this.set('u_grain', gl.uniform1f, this.num(s, '--ov-grain', 0));
  }
}

define('ov-scope', OvScope);
})();
