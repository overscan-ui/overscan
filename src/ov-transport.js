/* <ov-transport> - playback controls.
 *
 * ⭐ A SEEK BAR FOR SOMETHING OF UNKNOWN LENGTH CANNOT SHOW A POSITION, and
 * showing one at zero is a claim. A live stream has no end to be a fraction of,
 * so the bar refuses rather than sitting empty and looking like the start of a
 * recording. Same rule as the indeterminate progress bar: it says "running",
 * never "this far through".
 *
 * The scrubber is a real input type=range when there is a duration, so keyboard
 * seeking comes free, and it is absent rather than inert when there is not.
 */

import { define } from './ov-core.js';

class OvTransport extends HTMLElement {
  static observedAttributes = ['duration', 'at', 'playing'];

  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.build();
  }

  attributeChangedCallback() { if (this.isConnected && this.bar) this.paint(); }

  get duration() {
    const d = Number(this.getAttribute('duration'));
    return Number.isFinite(d) && d > 0 ? d : null;
  }

  get at() { return Number(this.getAttribute('at') || 0); }

  build() {
    this.innerHTML =
      `<button class="ov-btn ov-btn--icon ov-tp__play" aria-label="play"><span>&#9654;</span></button>`
      + `<span class="ov-tp__t ov-tp__now">0:00</span>`
      + `<span class="ov-tp__seek"></span>`
      + `<span class="ov-tp__t ov-tp__end"></span>`;
    this.play = this.querySelector('.ov-tp__play');
    this.bar = this.querySelector('.ov-tp__seek');
    this.now = this.querySelector('.ov-tp__now');
    this.end = this.querySelector('.ov-tp__end');

    this.play.addEventListener('click', () => {
      const on = this.hasAttribute('playing');
      this.toggleAttribute('playing', !on);
      this.play.querySelector('span').innerHTML = on ? '&#9654;' : '&#9646;&#9646;';
      this.play.setAttribute('aria-label', on ? 'play' : 'pause');
      this.dispatchEvent(new CustomEvent(on ? 'ov:pause' : 'ov:play', { bubbles: true }));
    });
    this.paint();
  }

  clock(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  paint() {
    const d = this.duration;
    this.now.textContent = this.clock(this.at);
    this.toggleAttribute('data-ov-live', d === null);

    if (d === null) {
      // No end, so no fraction of it. Refused rather than drawn at zero.
      this.bar.innerHTML = '';
      this.end.textContent = 'live';
      this.bar.setAttribute('data-ov-refusal', 'no duration to seek within');
      // Found by the audit: the refusal was VISIBLE and not announced. A
      // refusal that only exists on screen has been raised for half the people
      // who need it, which is the same rule sound is held to.
      this.bar.setAttribute('role', 'img');
      this.bar.setAttribute('aria-label', 'no duration, so there is nothing to seek within');
      return;
    }
    this.bar.removeAttribute('data-ov-refusal');
    this.bar.removeAttribute('role');
    this.bar.removeAttribute('aria-label');
    this.end.textContent = this.clock(d);
    if (!this.range) {
      this.bar.innerHTML =
        `<input class="ov-slider ov-tp__range" type="range" min="0" max="${d}"`
        + ` step="0.1" value="${this.at}" aria-label="seek">`;
      this.range = this.bar.querySelector('input');
      this.range.addEventListener('input', () => {
        this.setAttribute('at', this.range.value);
        this.dispatchEvent(new CustomEvent('ov:seek', {
          detail: { at: Number(this.range.value) }, bubbles: true,
        }));
      });
    }
    this.range.max = String(d);
    if (document.activeElement !== this.range) this.range.value = String(this.at);
  }
}

define('ov-transport', OvTransport);

export { OvTransport };
