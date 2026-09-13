/* <ov-menu> - a menubar with a roving tabindex.
 *
 * One tab stop for the whole bar, arrows to move within it. That is what a
 * menubar is supposed to be. A row of buttons each taking its own tab stop is
 * the
 * common mistake: it makes a five-item menu five tab presses deep on the way to
 * anything else on the page.
 */

import { define } from './ov-core.js';

class OvMenu extends HTMLElement {
  /* ⚠️ NOTHING HERE IS CACHED, AND THAT IS THE POINT.
   *
   * This used to read the bar and snapshot `this.items` once in
   * connectedCallback, then attach a click and a focus listener to each item
   * with its index `i` BAKED INTO THE CLOSURE. Three things broke under a
   * framework, all silently:
   *
   *   - menu items rendered after mount were never in the snapshot, so the
   *     keyboard could not reach them
   *   - re-rendered items were new nodes, so their listeners were gone while
   *     the old nodes kept theirs
   *   - a reordered list left every closure pointing at the wrong index, so
   *     the menu opened the wrong panel, which is worse than not opening
   *
   * ⭐ And `if (!this.bar) return` made a menu whose markup arrived late dead
   * forever, with no error.
   *
   * So: `items` is read live at the moment it is needed, and every listener is
   * DELEGATED to the host, which is the one node that does not get replaced.
   * Index is computed at event time from the node that was actually hit. */
  connectedCallback() {
    this.at = 0;
    this.rove();

    this.addEventListener('keydown', (e) => {
      const bar = this.bar;
      if (!bar || !bar.contains(e.target)) return;
      const items = this.items;
      const n = items.length;
      if (!n) return;
      let next = null;
      if (e.key === 'ArrowRight') next = (this.at + 1) % n;
      else if (e.key === 'ArrowLeft') next = (this.at - 1 + n) % n;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = n - 1;
      else if (e.key === 'Escape') { this.close(); return; }
      else if (e.key === 'ArrowDown') { this.open(this.at); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      this.at = next;
      this.rove();
      items[this.at].focus();
    });

    this.addEventListener('click', (e) => {
      const item = e.target.closest && e.target.closest('.ov-menu__item');
      if (!item || !this.contains(item)) return;
      const i = this.items.indexOf(item);
      if (i < 0) return;
      this.at = i;
      this.rove();
      this.open(i, true);
    });

    /* focusin, not focus: focus does not bubble, so it cannot be delegated. */
    this.addEventListener('focusin', (e) => {
      const item = e.target.closest && e.target.closest('.ov-menu__item');
      if (!item || !this.contains(item)) return;
      const i = this.items.indexOf(item);
      if (i < 0) return;
      this.at = i;
      this.rove();
    });

    this._away = (e) => { if (!this.contains(e.target)) this.close(); };
    document.addEventListener('pointerdown', this._away);
  }

  disconnectedCallback() {
    /* This listener is on `document`, so without this a removed menu keeps
     * closing itself forever and keeps the element alive. */
    if (this._away) document.removeEventListener('pointerdown', this._away);
  }

  get bar() { return this.querySelector('.ov-menu__bar'); }

  get items() {
    const bar = this.bar;
    return bar ? [...bar.querySelectorAll('.ov-menu__item')] : [];
  }

  /* Exactly one item is tabbable at a time. */
  rove() {
    this.items.forEach((item, i) => {
      item.tabIndex = i === this.at ? 0 : -1;
    });
  }

  open(i, toggle) {
    const item = this.items[i];
    const list = item.nextElementSibling;
    const wasOpen = item.getAttribute('aria-expanded') === 'true';
    this.close();
    if (toggle && wasOpen) return;
    if (!list) return;
    item.setAttribute('aria-expanded', 'true');
    list.hidden = false;
    const first = list.querySelector('[role="menuitem"]:not([aria-disabled="true"])');
    if (first) first.focus();
  }

  close() {
    for (const item of this.items) {
      item.setAttribute('aria-expanded', 'false');
      const list = item.nextElementSibling;
      if (list && list.classList.contains('ov-menu__list')) list.hidden = true;
    }
  }
}

define('ov-menu', OvMenu);

export { OvMenu };
