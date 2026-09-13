/* <ov-text> - per-character text effects.
 *
 * The motion vocabulary clips whole lines. Splitting.js stamps an index per
 * character, and that is what makes a stagger read as TYPING rather than as a
 * wipe: the difference is whether the units arrive or the mask moves.
 *
 * Two things this has to get right that splitting libraries routinely do not.
 *
 * 🔴 SPLITTING TEXT BREAKS THE ACCESSIBLE NAME. A string in per-character spans
 * is read character by character by some screen readers, so the real string has
 * to be kept somewhere the a11y tree can still see it. Adding
 * `visibility: hidden` to exactly that copy removes the only
 * accessible text while the visible copy stays aria-hidden, so the component
 * announces NOTHING. The offscreen copy here is clipped, never
 * `visibility:hidden` and never `display:none`, because both of those take it
 * out of the tree.
 *
 * 🔴 SPLITTING BY CHARACTER IS NOT SPLITTING BY GLYPH. `[...str]` splits by code
 * point, which tears a combining mark off its base and a ZWJ emoji into pieces.
 * Thai is the script that shows it, and it is the one nobody
 * tests. Intl.Segmenter with grapheme granularity is the correct unit, and the
 * fallback is stated rather than silent.
 */

import { define } from './ov-core.js';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>[]#*+=-';

function graphemes(s) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)]
      .map((g) => g.segment);
  }
  return [...s]; // code points, which will split some clusters. Stated, not hidden.
}

class OvText extends HTMLElement {
  static observedAttributes = ['text', 'effect'];

  /* 🔴 attributeChangedCallback RUNS BEFORE connectedCallback ON UPGRADE, once
   * for every observed attribute. `effect` therefore arrived while `source`
   * was still undefined and build() threw on it - forty times on
   * demo/text.html, from the day this file was written. `isConnected` did not
   * guard it, because during an upgrade the element IS connected.
   *
   * ⚠️ And it was invisible: a later callback built the element correctly, so
   * the text appeared and only the console knew. That is the same shape as the
   * shader layer that never compiled for weeks.
   *
   * The source is captured on FIRST READ instead, which is before build() has
   * replaced this element's own markup - so the textContent spelling still
   * works and no callback order can break it. */
  get source() {
    if (this._source === undefined) {
      this._source = this.getAttribute('text') ?? this.textContent.trim();
    }
    return this._source;
  }

  set source(v) { this._source = v; }

  connectedCallback() {
    this.build();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'text') this.source = this.getAttribute('text') ?? '';
    this.build();
  }

  build() {
    const units = graphemes(this.source);
    const effect = this.getAttribute('effect') || 'cascade';

    // Deterministic per-unit displacement, stamped here rather than computed
    // in CSS: a settle needs each character to start somewhere different, and
    // there is no hash in the cascade. Same seed every load, so a reload
    // replays exactly.
    const jitter = (i, salt) => {
      const x = Math.sin((i + 1) * (salt === 0 ? 12.9898 : 78.233)) * 43758.5453;
      return Math.round(((x - Math.floor(x)) * 2 - 1) * 100) / 10;
    };

    const cells = units.map((g, i) =>
      `<i class="ov-text__c" style="--ov-char:${i};`
      + `--ov-jx:${jitter(i, 0)};--ov-jy:${jitter(i, 1)}"`
      + `>${g === ' ' ? '&nbsp;' : g.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</i>`,
    ).join('');

    this.innerHTML =
      `<span class="ov-text__sr">${this.source.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`
      + `<span class="ov-text__cells" aria-hidden="true" style="--ov-chars:${units.length}">${cells}</span>`;

    this.dataset.ovEffect = effect;
    this.cells = [...this.querySelectorAll('.ov-text__c')];
    if (effect === 'decode') this.decode(units);
  }

  /* Scrambles, then settles left to right. The settled character is always the
   * real one: a decode that lands on a plausible wrong glyph is the readout
   * problem in text form. */
  decode(units) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const step = Number(this.getAttribute('step') || 34);
    const hold = Number(this.getAttribute('hold') || 8);
    let frame = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      frame += 1;
      let settled = 0;
      this.cells.forEach((cell, i) => {
        const due = i * 2 + hold;
        if (frame >= due) {
          if (cell.textContent !== units[i]) cell.textContent = units[i] === ' ' ? ' ' : units[i];
          settled += 1;
          return;
        }
        if (units[i] === ' ') return;
        cell.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      });
      if (settled === this.cells.length) clearInterval(this.timer);
    }, step);
  }

  disconnectedCallback() { clearInterval(this.timer); }
}

define('ov-text', OvText);

export { OvText };
