/* <ov-waterfall> - a spectrogram, scrolling.
 *
 * Time down, frequency across, intensity as colour. The clearest GL case in
 * the kit: a useful waterfall is a few hundred bins by a few hundred lines,
 * which is a five figure cell count replaced every frame. One texture upload
 * and one quad instead.
 *
 * ── What it refuses to do ────────────────────────────────────────────────
 *
 * 🔴 NO RAINBOW. A waterfall's colour map decides what a reader believes they
 * can see, and a rainbow invents structure: its sharp perceptual edges at
 * yellow and cyan read as boundaries in the DATA when they are boundaries in
 * the PALETTE, and it is not monotonic in lightness, so greyscale and
 * colourblind readers get a different picture. Every map here is monotonic in
 * lightness: brighter always means more.
 *
 * ⭐ IT DECLARES ITS FLOOR. A spectrogram that clips everything below a
 * threshold to black has hidden the difference between "quiet" and "nothing",
 * and those are different readings. The floor is printed on the instrument.
 *
 * ⭐ AND IT DISTINGUISHES UNWRITTEN FROM SILENT. Lines that have not been
 * measured yet are drawn as unwritten, not as zero, because an instrument that
 * paints black where it has no data is claiming a measurement it never made.
 * That is the same failure as a seven-segment display that invents a digit,
 * one dimension up.
 *
 * The source hands over one line at a time: either an array of bin magnitudes
 * 0..100, or a single number, in which case a spectrum is synthesised around
 * it so the element is still useful against the kit's scalar fixtures.
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


const BINS = 128;
const LINES = 128;

class OvWaterfall extends Overscan.GL {
  static observedAttributes = ['source', 'floor', 'map'];

  get shaderName() { return 'waterfall'; }

  connectedCallback() {
    this.lines = [];
    this.seen = 0;
    this.pixels = new Uint8Array(BINS * LINES);
    this.note = document.createElement('span');
    this.note.className = 'ov-waterfall__note';
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

  get floor() {
    const v = parseFloat(this.getAttribute('floor'));
    return Number.isFinite(v) ? Math.max(0, Math.min(0.9, v)) : 0.04;
  }

  ready() { this.tex = Overscan.GL.makeDataTexture(this.gl); }

  bind() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan || !window.Overscan.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (r) => {
      const v = (r && typeof r === 'object' && !Array.isArray(r)) ? r.value : r;
      this.seen += 1;
      if (v === null || v === undefined) return;   // a dropout is not a zero
      this.lines.unshift(this.toLine(v));          // newest first
      while (this.lines.length > LINES) this.lines.pop();
      this.dirty = true;
      this.tick();
    });
  }

  /* One line of bins, 0..255.
   *
   * An array is used as given. A scalar is turned into a spectrum with a peak
   * whose POSITION tracks the value and whose skirt is deterministic, so the
   * element reads meaningfully against the kit's scalar fixtures without
   * pretending to be an FFT. ⚠️ This is a fixture convenience, not a signal
   * model: real callers pass real bins. */
  toLine(v) {
    const row = new Uint8Array(BINS);
    if (Array.isArray(v)) {
      for (let i = 0; i < BINS; i++) {
        const t = (i / (BINS - 1)) * (v.length - 1);
        const a = Math.floor(t), b = Math.min(v.length - 1, a + 1);
        const s = v[a] + (v[b] - v[a]) * (t - a);
        row[i] = Math.max(0, Math.min(255, Math.round((s / 100) * 255)));
      }
      return row;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) return row;
    const peak = Math.max(0, Math.min(1, n / 100)) * (BINS - 1);
    for (let i = 0; i < BINS; i++) {
      const d = Math.abs(i - peak);
      const main = Math.exp(-(d * d) / (2 * 3.2 * 3.2));
      const skirt = Math.exp(-(d * d) / (2 * 26 * 26)) * 0.22;
      // A deterministic ripple, so the picture has texture without the
      // element inventing noise that could be mistaken for signal.
      const ripple = 0.06 * Math.abs(Math.sin(i * 0.7));
      row[i] = Math.round(Math.min(1, main + skirt + ripple) * 255);
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
    const held = this.lines.length;
    if (!held) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'no spectrum: nothing has been measured');
      this.note.textContent = 'no spectrum';
      return;
    }
    this.removeAttribute('data-ov-refusal');
    const pct = Math.round(this.floor * 100);
    this.note.textContent =
      `${held}/${LINES} lines, ${BINS} bins, floor ${pct}%`;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label',
      `spectrogram, ${held} of ${LINES} lines measured, ${BINS} frequency bins,`
      + ` everything below ${pct} percent drawn as the floor`);
  }

  uniforms(s) {
    const gl = this.gl;

    if (this.dirty) {
      this.dirty = false;
      for (let r = 0; r < this.lines.length; r++) {
        this.pixels.set(this.lines[r], r * BINS);
      }
      Overscan.GL.uploadData(this.tex, this.pixels, BINS, LINES, this.gl);
    }


    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    this.set('u_data', gl.uniform1i, 0);
    this.set('u_shape', gl.uniform3f, BINS, LINES, this.lines.length);

    this.set('u_field', gl.uniform3fv, this.rgb(s, '--ov-field'));
    this.set('u_accent', gl.uniform3fv, this.rgb(s, '--ov-accent'));
    const a2 = this.rgb(s, '--ov-accent-2');
    const has2 = a2[0] + a2[1] + a2[2] > 0;
    this.set('u_accent2', gl.uniform3fv, has2 ? a2 : this.rgb(s, '--ov-accent'));
    this.set('u_grid', gl.uniform3fv, this.rgb(s, '--ov-line'));
    this.set('u_floor', gl.uniform1f, this.floor);
    this.set('u_grain', gl.uniform1f, this.num(s, '--ov-grain', 0));

    const named = (this.getAttribute('map') || '').trim();
    const MAPS = { hue: 0, two: 1, hot: 2 };
    this.set('u_map', gl.uniform1f, MAPS[named] ?? 0);
  }
}

define('ov-waterfall', OvWaterfall);
})();
