/* <ov-wave> - a continuous trace with persistence.
 *
 * Different instrument from <ov-chart>. A chart plots samples; a scope draws a
 * sweep and lets the last few fade, and that decay is how you see a signal that
 * is not quite repeating.
 *
 * ⭐ IT REPORTS ITS OWN SAMPLE RATE AGAINST ITS DISPLAY RATE. A waveform was
 * measured discarding 99.27% of its samples before paint and saying nothing.
 * A trace drawn at 60 Hz from a source running at 8 kHz is showing you a
 * fraction of a percent of what arrived, and the reader is entitled to know
 * which fraction.
 */

import { define, watchSeen, isSeen } from './ov-core.js';
import './ov-source.js';

class OvWave extends HTMLElement {
  static observedAttributes = ['source', 'traces', 'window'];

  connectedCallback() {
    if (!this.dataset.ready) this.setup();
    this.unseen = watchSeen(this, this.wake);
    this.frame();
  }

  setup() {
    this.dataset.ready = '1';
    this.buf = [];
    this.history = [];
    this.seen = 0;
    this.drawn = 0;
    this.innerHTML = `<svg class="ov-wave__svg" viewBox="0 0 100 100"`
      + ` preserveAspectRatio="none" aria-hidden="true"></svg>`
      + `<span class="ov-wave__note"></span>`;
    this.svg = this.querySelector('svg');
    this.note = this.querySelector('.ov-wave__note');
    this.bind();
  }

  /* Called by the visibility gate when the element comes back into view. */
  wake = () => { if (!this.raf) this.raf = requestAnimationFrame(this.frame); };

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.unseen) this.unseen();
    if (this.unsub) this.unsub();
  }

  attributeChangedCallback(n) { if (this.isConnected && n === 'source') this.bind(); }

  get cap() { return Math.max(16, parseInt(this.getAttribute('window') || '120', 10)); }
  get traces() { return Math.max(1, parseInt(this.getAttribute('traces') || '5', 10)); }

  bind() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (r) => {
      const v = (r && typeof r === 'object') ? r.value : r;
      this.seen += 1;
      if (v === null || v === undefined) return;
      this.buf.push(Number(v));
      while (this.buf.length > this.cap) this.buf.shift();
    });
  }

  frame = () => {
    if (this.seen !== this.ptsAt && this.buf.length > 2) {
      this.ptsAt = this.seen;
      this.pts = this.buf.map((v, i) =>
        `${((i / (this.buf.length - 1)) * 100).toFixed(2)},`
        + `${(100 - Math.max(0, Math.min(100, v))).toFixed(2)}`).join(' ');
    }
    const pts = this.pts;
    /* Still, once every trace held is this sweep: pushing it again would draw
     * the same picture. Persistence still counts in frames, as before, so the
     * fade looks the same; it only stops redrawing when nothing is new. */
    const still = this.history.length >= this.traces && this.history.every((p) => p === pts);
    if (this.buf.length > 2 && !still) {
      this.history.unshift(pts);
      while (this.history.length > this.traces) this.history.pop();
      this.drawn += 1;

      // Persistence: older sweeps fade. The decay IS the age, same as the
      // radar's blips.
      this.svg.innerHTML = this.history.map((p, i) =>
        `<polyline class="ov-wave__trace" points="${p}"`
        + ` style="opacity:${(1 - i / this.traces).toFixed(3)}"`
        + ` vector-effect="non-scaling-stroke"/>`).reverse().join('');

      const kept = this.seen ? (this.buf.length / this.seen) * 100 : 100;
      const note = `${this.seen} samples in, ${this.buf.length} held`
        + ` (${kept < 1 ? kept.toFixed(2) : kept.toFixed(0)}%)`;
      if (this.note.textContent !== note) this.note.textContent = note;
      if (this.getAttribute('role') !== 'img') this.setAttribute('role', 'img');
      const name = `trace of the last ${this.buf.length} of ${this.seen} samples received`;
      if (this.getAttribute('aria-label') !== name) this.setAttribute('aria-label', name);
    }
    // Offscreen, the next frame is not asked for; watchSeen's wake asks again.
    this.raf = isSeen(this) ? requestAnimationFrame(this.frame) : 0;
  };
}

define('ov-wave', OvWave);

export { OvWave };
