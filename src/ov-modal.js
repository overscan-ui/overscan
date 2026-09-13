/* <ov-modal> - a dialog in the top layer.
 *
 * 🔴 A MODAL INSIDE A THEMED SECTION IS TRAPPED BY THAT SECTION'S STACKING
 * CONTEXT. `.ov-finish` sets `isolation: isolate` so its grain and scanlines
 * composite against their own surface, and that creates a stacking context. A
 * `position: fixed` overlay inside one is still painted within it, so every
 * section later in the document covers the dialog and it reads as cropped to
 * the panel it was declared in. z-index cannot fix that: the whole context is
 * being painted as a unit.
 *
 * The top layer is the only thing that escapes it, so this is a real <dialog>
 * opened with showModal(). That also brings the focus trap, Escape, an inert
 * background and ::backdrop for free, which is a better trap than any hand
 * written cycle, and it still inherits the theme's custom properties from where
 * it sits in the DOM.
 *
 * Return focus is kept explicit rather than left to the browser: it is the half
 * people skip, and it is worth being able to point at the line that does it.
 */

import { define } from './ov-core.js';

class OvModal extends HTMLElement {
  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    if (!this.dialog) return;
    const title = this.querySelector('.ov-modal__title');
    if (title) {
      if (!title.id) title.id = `ov-modal-t-${Math.random().toString(36).slice(2, 8)}`;
      this.dialog.setAttribute('aria-labelledby', title.id);
    }

    for (const el of this.querySelectorAll('[data-ov-close]')) {
      el.addEventListener('click', () => this.close());
    }

    // Clicking the backdrop closes. The backdrop is not a child, so the test is
    // whether the point is outside the dialog's own box.
    this.dialog.addEventListener('pointerdown', (e) => {
      const box = this.dialog.getBoundingClientRect();
      const inside = e.clientX >= box.left && e.clientX <= box.right
        && e.clientY >= box.top && e.clientY <= box.bottom;
      if (!inside) this.close();
    });

    this.dialog.addEventListener('close', () => this.restore());
  }

  open() {
    if (!this.dialog) return;
    this.returnTo = document.activeElement;
    this.dialog.showModal();
  }

  close() { if (this.dialog && this.dialog.open) this.dialog.close(); }

  restore() {
    if (this.returnTo && this.returnTo.focus) this.returnTo.focus();
    this.returnTo = null;
  }
}

define('ov-modal', OvModal);

export { OvModal };
