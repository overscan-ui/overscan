/* <ov-split> - resizable panes.
 *
 * The gutter is a real control, not a decorative line, so it is reachable and
 * operable from the keyboard. Two things are worth obeying here:
 *
 * - A focusable `role="separator"` MUST carry `aria-valuenow`, or it is an ARIA
 *   violation rather than a nicety.
 * - `setPointerCapture` THROWS on a pointer id it has no entry for, from the
 *   first line of the handler, inside a listener where nothing surfaces it.
 *   Unguarded it aborts the gesture before the gesture is recorded, and the
 *   page looks like it is ignoring the drag. Three of four presses vanished
 *   when this was measured.
 */

import { define } from './ov-core.js';

class OvSplit extends HTMLElement {
  connectedCallback() {
    this.vertical = this.getAttribute('direction') === 'vertical';
    this.split = Number(this.getAttribute('at') || 50);
    this.ensure();

    /* 🔴 THE GUTTER IS A NODE THIS ELEMENT OWNS, SITTING BETWEEN NODES IT DOES
     * NOT. `build()` inserts it with insertBefore between the two panes, and
     * in plain HTML those panes never move again. Under a framework they do:
     * React, Vue and Svelte replace children on re-render, which takes the
     * gutter with them. The element itself never disconnected, so
     * connectedCallback does NOT run again, and the old guard
     * (`if (!this.querySelector(...))`) only ever ran once. The result was a
     * splitter that worked until the first re-render and then silently stopped
     * being draggable, with no error and nothing missing to the eye.
     *
     * ⭐ <ov-tabs> already solved this shape with a MutationObserver and this
     * is the same answer, scoped to one element instead of the document.
     * Re-inserting the gutter does trigger the observer, so `ensure()` returns
     * immediately when it is already there and the loop closes. */
    this._obs = new MutationObserver(() => this.ensure());
    this._obs.observe(this, { childList: true });
  }

  disconnectedCallback() {
    if (this._obs) { this._obs.disconnect(); this._obs = null; }
  }

  ensure() {
    if (this.querySelector(':scope > .ov-split__gutter')) return;
    this.build();
    this.apply();
  }

  build() {
    const panes = [...this.children];
    if (panes.length < 2) return;
    const gutter = document.createElement('div');
    gutter.className = 'ov-split__gutter';
    gutter.tabIndex = 0;
    gutter.setAttribute('role', 'separator');
    gutter.setAttribute('aria-orientation', this.vertical ? 'horizontal' : 'vertical');
    gutter.setAttribute('aria-valuemin', '10');
    gutter.setAttribute('aria-valuemax', '90');
    gutter.setAttribute('aria-label', 'resize panes');
    this.insertBefore(gutter, panes[1]);
    this.gutter = gutter;

    gutter.addEventListener('pointerdown', (e) => {
      // Guarded, always. An unguarded capture throws and takes the gesture
      // with it, silently.
      try { gutter.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this.dragging = true;
      e.preventDefault();
    });
    gutter.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const box = this.getBoundingClientRect();
      const f = this.vertical
        ? ((e.clientY - box.top) / box.height) * 100
        : ((e.clientX - box.left) / box.width) * 100;
      this.split = Math.max(10, Math.min(90, f));
      this.apply();
    });
    const stop = (e) => {
      this.dragging = false;
      try { gutter.releasePointerCapture(e.pointerId); } catch { /* never held */ }
    };
    gutter.addEventListener('pointerup', stop);
    gutter.addEventListener('pointercancel', stop);

    gutter.addEventListener('keydown', (e) => {
      const back = this.vertical ? 'ArrowUp' : 'ArrowLeft';
      const fwd = this.vertical ? 'ArrowDown' : 'ArrowRight';
      const step = e.shiftKey ? 10 : 2;
      if (e.key === back) this.split = Math.max(10, this.split - step);
      else if (e.key === fwd) this.split = Math.min(90, this.split + step);
      else if (e.key === 'Home') this.split = 10;
      else if (e.key === 'End') this.split = 90;
      else return;
      e.preventDefault();
      this.apply();
    });
  }

  apply() {
    const a = `${this.split.toFixed(2)}%`;
    this.style.setProperty('--ov-split-a', a);
    this.style.setProperty('--ov-split-dir', this.vertical ? 'column' : 'row');
    if (this.gutter) this.gutter.setAttribute('aria-valuenow', Math.round(this.split));
  }
}

define('ov-split', OvSplit);

export { OvSplit };
