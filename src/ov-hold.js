/* <ov-hold> - a control with a price.
 *
 * The quickhack screen is the model: a control that has a
 * COST. Most buttons are free: you press, something happens, and nothing about
 * the button says what it spent. This one states the price before you commit
 * and requires the commit to be deliberate.
 *
 * Two rules:
 *
 * 1. THE PRICE IS ON THE CONTROL, not in a tooltip and not in a confirmation
 *    that appears after you have already decided.
 * 2. LETTING GO EARLY CANCELS, and says so. A hold that applies a fraction of
 *    the action on release is the worst of both: you did not commit and
 *    something happened anyway.
 */

import { define } from './ov-core.js';

class OvHold extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.ms = Number(this.getAttribute('hold') || 900);

    this.btn = document.createElement('button');
    this.btn.className = 'ov-btn ov-hold__btn';
    this.btn.innerHTML =
      `<span class="ov-hold__fill"></span>`
      + `<span class="ov-hold__label">${this.getAttribute('label') || 'hold'}</span>`
      + `<span class="ov-hold__price">${this.getAttribute('price') || ''}</span>`;
    this.btn.setAttribute('aria-label',
      `${this.getAttribute('label') || 'hold'}, costs ${this.getAttribute('price') || 'nothing'}, `
      + `hold for ${(this.ms / 1000).toFixed(1)} seconds to commit`);
    this.append(this.btn);
    this.fill = this.querySelector('.ov-hold__fill');

    const start = (e) => {
      if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
      if (e.repeat) return;
      e.preventDefault();
      this.begin();
    };
    const end = () => this.release();

    this.btn.addEventListener('pointerdown', start);
    this.btn.addEventListener('pointerup', end);
    this.btn.addEventListener('pointerleave', end);
    this.btn.addEventListener('pointercancel', end);
    this.btn.addEventListener('keydown', start);
    this.btn.addEventListener('keyup', end);
    this.btn.addEventListener('blur', end);
  }

  begin() {
    if (this.timer) return;
    this.setAttribute('data-ov-holding', '');
    this.fill.style.transition = `inline-size ${this.ms}ms linear`;
    this.fill.style.inlineSize = '100%';
    this.timer = setTimeout(() => {
      this.timer = null;
      this.removeAttribute('data-ov-holding');
      this.setAttribute('data-ov-committed', '');
      this.dispatchEvent(new CustomEvent('ov:commit', {
        detail: { price: this.getAttribute('price') }, bubbles: true,
      }));
      setTimeout(() => this.removeAttribute('data-ov-committed'), 900);
      this.reset();
    }, this.ms);
  }

  release() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.removeAttribute('data-ov-holding');
    // Nothing happened. Said out loud, because a silent cancel is
    // indistinguishable from a control that does not work.
    this.setAttribute('data-ov-cancelled', '');
    setTimeout(() => this.removeAttribute('data-ov-cancelled'), 900);
    this.dispatchEvent(new CustomEvent('ov:cancel', { bubbles: true }));
    this.reset();
  }

  reset() {
    this.fill.style.transition = 'none';
    this.fill.style.inlineSize = '0%';
  }
}

define('ov-hold', OvHold);

export { OvHold };
