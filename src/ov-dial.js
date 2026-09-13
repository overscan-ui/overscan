/* <ov-dial> - a rotary control with real detents.
 *
 * <ov-gauge> reads; this one turns. webaudio-controls' generated knob
 * filmstrip measured a mean 1.42 degrees of error, found independently from
 * two directions. That error exists
 * because the pointer is drawn from a precomputed sprite; here the pointer is
 * drawn from the value, so a detent lands exactly where the value says.
 *
 * ⚠️ NexusUI never adopted PointerEvent: a dispatched PointerEvent leaves its
 * dial inert while a MouseEvent turns it, and interact.js is the opposite. This
 * uses pointer events and guards capture, which covers both, and it is operable
 * from the keyboard so neither is required.
 *
 * The value SNAPS and the readout shows the snapped value, never the raw drag.
 * A dial that displays where your finger is while reporting where the detent is
 * is a display disagreeing with its own machine.
 */

import { define } from './ov-core.js';

class OvDial extends HTMLElement {
  static observedAttributes = ['value', 'min', 'max', 'detents', 'label'];

  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.tabIndex = 0;
    this.setAttribute('role', 'slider');
    this.build();
    this.wire();
    this.paint();
  }

  attributeChangedCallback() { if (this.isConnected) this.paint(); }

  get lo() { return Number(this.getAttribute('min') ?? 0); }
  get hi() { return Number(this.getAttribute('max') ?? 10); }
  get steps() { return Math.max(2, parseInt(this.getAttribute('detents') || '11', 10)); }
  get value() { return this.snap(Number(this.getAttribute('value') ?? this.lo)); }

  /* The detent. Every value the dial can hold is one of these, so there is no
   * position between two of them to report. */
  snap(v) {
    const n = this.steps - 1;
    const f = (v - this.lo) / ((this.hi - this.lo) || 1);
    return this.lo + Math.round(Math.max(0, Math.min(1, f)) * n) / n * (this.hi - this.lo);
  }

  build() {
    const sweep = 280;
    const ticks = Array.from({ length: this.steps }, (_, i) => {
      const a = (-90 - sweep / 2 + (i / (this.steps - 1)) * sweep) * (Math.PI / 180);
      const [x1, y1] = [50 + Math.cos(a) * 40, 50 + Math.sin(a) * 40];
      const [x2, y2] = [50 + Math.cos(a) * 46, 50 + Math.sin(a) * 46];
      return `<line class="ov-dial__tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}"`
        + ` x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    }).join('');
    this.innerHTML =
      `<svg class="ov-dial__svg" viewBox="0 0 100 100" aria-hidden="true">`
      + ticks
      + `<circle class="ov-dial__body" cx="50" cy="50" r="33"/>`
      + `<line class="ov-dial__pointer" x1="50" y1="50" x2="50" y2="20"/>`
      + `</svg><span class="ov-dial__read"></span>`;
    this.pointer = this.querySelector('.ov-dial__pointer');
    this.read = this.querySelector('.ov-dial__read');
  }

  wire() {
    let from = null;
    this.addEventListener('pointerdown', (e) => {
      try { this.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      from = { y: e.clientY, v: this.value };
      this.focus();
      e.preventDefault();
    });
    this.addEventListener('pointermove', (e) => {
      if (!from) return;
      // Vertical drag, which is how a knob is turned on a screen. 120px is the
      // full range, so the whole sweep is reachable without a re-grip.
      const dv = ((from.y - e.clientY) / 120) * (this.hi - this.lo);
      this.set(from.v + dv);
    });
    const stop = (e) => {
      from = null;
      try { this.releasePointerCapture(e.pointerId); } catch { /* never held */ }
    };
    this.addEventListener('pointerup', stop);
    this.addEventListener('pointercancel', stop);

    this.addEventListener('keydown', (e) => {
      const one = (this.hi - this.lo) / (this.steps - 1);
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (d) { this.set(this.value + d * one * (e.shiftKey ? 3 : 1)); e.preventDefault(); return; }
      if (e.key === 'Home') { this.set(this.lo); e.preventDefault(); }
      if (e.key === 'End') { this.set(this.hi); e.preventDefault(); }
    });
  }

  set(raw) {
    const v = this.snap(Math.max(this.lo, Math.min(this.hi, raw)));
    if (v === this.value) return;
    this.setAttribute('value', String(v));
    this.dispatchEvent(new CustomEvent('ov:change', { detail: { value: v }, bubbles: true }));
  }

  paint() {
    const sweep = 280;
    const f = (this.value - this.lo) / ((this.hi - this.lo) || 1);
    const a = -90 - sweep / 2 + f * sweep;
    if (this.pointer) this.pointer.setAttribute('transform', `rotate(${a + 90} 50 50)`);
    const shown = Number.isInteger(this.value) ? this.value : this.value.toFixed(2);
    if (this.read) this.read.textContent = String(shown);
    this.setAttribute('aria-valuemin', String(this.lo));
    this.setAttribute('aria-valuemax', String(this.hi));
    this.setAttribute('aria-valuenow', String(this.value));
    this.setAttribute('aria-label', this.getAttribute('label') || 'dial');
  }
}

define('ov-dial', OvDial);

export { OvDial };
