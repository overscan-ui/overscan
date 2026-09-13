/* <ov-tree> - hierarchical navigation.
 *
 * ⭐ THE FINDING THIS EXISTS FOR: "empty" and "not loaded" are different
 * states, and almost every tree conflates them. A collapsed node with no
 * children and a node whose children have never been fetched look identical:
 * both are a row with no twisty. One of those is a fact about the data and the
 * other is a fact about the tree, and showing them the same way is the readout
 * problem in a navigation control.
 *
 * So a node declares children as "none", "unknown", or a list, and `unknown`
 * renders as unknown rather than as empty.
 *
 * Roving tabindex, like the menubar: one tab stop for the whole tree, arrows
 * inside it. A tree where every row is a tab stop is a tree you cannot get past.
 */

import { define } from './ov-core.js';

class OvTree extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.setAttribute('role', 'tree');
    /* Declares that this control reorders, so a motion layer can wire itself
     * up without the tree knowing one exists.
     *
     * ⚠️ DELIBERATELY NOT "windowed". A tree renders every row it has, so a row
     * that appears on expand is a NEW row rather than one that was somewhere
     * off-screen: there is nothing to have lost track of. `ov-table` says
     * "windowed" because it draws a subset and genuinely can. Saying it here
     * would report eight children appearing as eight refusals, which is the
     * ordinary operation of the control reported as a fault. */
    this.setAttribute('data-ov-flip', '');
    this.open = new Set();
    this.at = 0;
    this.addEventListener('keydown', (e) => this.key(e));
  }

  load(nodes) { this.nodes = nodes; this.paint(); }

  flatten(nodes, level = 1, out = [], path = '') {
    for (const [i, n] of nodes.entries()) {
      const id = `${path}${i}`;
      out.push({ ...n, id, level });
      if (Array.isArray(n.children) && this.open.has(id)) {
        this.flatten(n.children, level + 1, out, `${id}.`);
      }
    }
    return out;
  }

  paint() {
    this.rows = this.flatten(this.nodes || []);
    this.innerHTML = this.rows.map((n, i) => {
      const kids = n.children;
      const expandable = Array.isArray(kids);
      const unknown = kids === 'unknown';
      const twisty = expandable ? (this.open.has(n.id) ? '&#9662;' : '&#9656;')
        : unknown ? '?' : '&nbsp;';
      /* ⭐ `n.id` is ALREADY a stable identity and needs no registry: it is the
       * index path, and a sibling's index does not change when another sibling
       * expands. `ov-table` needed a WeakMap because its rows are opaque data
       * objects with no natural key; a tree node's position IS its key.
       * Emitted under its own name rather than reusing `data-id`, because a
       * motion layer keying on a generic attribute would claim every component
       * that happens to use one. */
      return `<div class="ov-tree__row" role="treeitem" data-id="${n.id}"`
        + ` data-flip-id="${n.id}"`
        + ` aria-level="${n.level}" tabindex="${i === this.at ? 0 : -1}"`
        + (expandable ? ` aria-expanded="${this.open.has(n.id)}"` : '')
        + (unknown ? ' data-ov-unknown' : '')
        + `><span class="ov-tree__twisty" aria-hidden="true">${twisty}</span>`
        + `<span class="ov-tree__label" style="--lvl:${n.level}">${n.label}</span>`
        + (unknown ? '<span class="ov-tree__note">children not loaded</span>' : '')
        + (kids === 'none' ? '<span class="ov-tree__note">no children</span>' : '')
        + `</div>`;
    }).join('');

    for (const row of this.querySelectorAll('.ov-tree__row')) {
      row.addEventListener('click', () => {
        this.at = this.rows.findIndex((r) => r.id === row.dataset.id);
        this.toggle(row.dataset.id);
      });
      row.addEventListener('focus', () => {
        this.at = this.rows.findIndex((r) => r.id === row.dataset.id);
      });
    }
  }

  toggle(id) {
    const n = this.rows.find((r) => r.id === id);
    if (!n || !Array.isArray(n.children)) return;
    if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
    /* Announce the reflow around the repaint, exactly as ov-table announces a
     * sort. Nothing here knows what listens, or whether anything does. */
    this.dispatchEvent(new CustomEvent('ov:reorder', { detail: { phase: 'before' } }));
    this.paint();
    this.dispatchEvent(new CustomEvent('ov:reorder', { detail: { phase: 'after' } }));
    this.focusAt();
  }

  focusAt() {
    const rows = [...this.querySelectorAll('.ov-tree__row')];
    rows.forEach((r, i) => { r.tabIndex = i === this.at ? 0 : -1; });
    rows[this.at]?.focus();
  }

  key(e) {
    const n = this.rows[this.at];
    const last = this.rows.length - 1;
    if (e.key === 'ArrowDown') this.at = Math.min(last, this.at + 1);
    else if (e.key === 'ArrowUp') this.at = Math.max(0, this.at - 1);
    else if (e.key === 'Home') this.at = 0;
    else if (e.key === 'End') this.at = last;
    else if (e.key === 'ArrowRight' && Array.isArray(n?.children) && !this.open.has(n.id)) {
      this.toggle(n.id); e.preventDefault(); return;
    } else if (e.key === 'ArrowLeft' && Array.isArray(n?.children) && this.open.has(n.id)) {
      this.toggle(n.id); e.preventDefault(); return;
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (n) this.toggle(n.id); e.preventDefault(); return;
    } else return;
    e.preventDefault();
    this.focusAt();
  }
}

define('ov-tree', OvTree);

export { OvTree };
