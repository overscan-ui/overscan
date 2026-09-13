/* <ov-table> - a virtualised data grid that admits what it is.
 *
 * 🔴 THIS SHIPS AN ARIA VIOLATION ON PURPOSE, AND IT IS DOCUMENTED RATHER THAN
 * FAKED. Testing a virtualised table found one irreducible defect:
 *
 *   A virtualised table CANNOT satisfy `aria-required-children`.
 *   `role="grid"` allows row and rowgroup children. A virtual table needs a
 *   scroll wrapper between the grid and its rows, and ARIA has no role for
 *   one. `generic` fails. `role="presentation"` fails. `aria-owns` does not
 *   rescue it.
 *
 * That defect is inherited by every screen that composes the table, which in
 * testing meant four more screens failing the same check. The honest move is
 * to fail the check and say so, which is what `data-ov-aria` does, rather than
 * flatten the DOM into something that passes and lies about its structure.
 *
 * The other rule is a cross-cutting one: 100 row elements for 50,000
 * rows, and the table said nothing. This one says how many of how many.
 */

import { define } from './ov-core.js';

/* A stable identity per ROW OBJECT, so a reorder can be recognised as one.
 *
 * ⭐ Deliberately keyed on the object rather than on a `key` column the caller
 * declares. `Array.prototype.sort` is in place: the same objects come back in
 * a new order, so identity is already there and asking the caller to name a
 * key would be asking for something the reorder does not need. It also cannot
 * be got wrong, where a declared key can be non-unique and nothing would say
 * so.
 *
 * ⚠️ A WeakMap, so a table that is handed new data does not pin the old rows
 * in memory for the life of the page. */
const ROW_ID = new WeakMap();
let ROW_N = 0;

function rowId(r) {
  if (r === null || typeof r !== 'object') return null;
  let id = ROW_ID.get(r);
  if (id === undefined) { ROW_ID.set(r, (id = 'r' + (++ROW_N))); }
  return id;
}

class OvTable extends HTMLElement {
  /* ⚠️ `rows` IS DELIBERATELY NOT HERE, though it used to be. An array of row
   * objects has no attribute spelling, nothing ever read one, and the manifest
   * is generated from this list, so declaring it published an attribute that
   * did nothing. The property and `load()` are the doors. */
  static observedAttributes = ['row-height', 'sort'];

  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.data = this.data || [];
    this.cols = this.cols || [];
    this.build();
    if (this.cols.length) this.paint();
    /* Last, so the element's DOM exists before a reclaimed property
     * triggers a redraw against cells that have not been built. */
    window.OverscanRefusal.upgrade(this, ['cols', 'rows']);
  }

  /* ---- cols / rows as PROPERTIES -----------------------------------------
   *
   * A table takes structured data, not readings, so these are plain accessors
   * rather than the reading protocol: an array of column descriptors and an
   * array of row objects. `load(cols, rows)` remains the imperative door and
   * these are the declarative one, so a framework can write
   * `<OvTable cols={...} rows={...} />` and never call a method.
   *
   * ⚠️ Order is not guaranteed. A framework may set `rows` before `cols` or
   * the reverse, so neither setter may assume the other has arrived: both
   * store, and painting waits until there are columns to paint into.
   */
  /* 🔴 THE CALLBACK `observedAttributes` PROMISES. It was missing, so both
   * attributes were inert: the browser watched them and told nobody. Every
   * other element in the kit pairs the two, and `api.py` now gates it. */
  attributeChangedCallback(name) {
    if (!this.isConnected || !this.dataset.ready) return;
    if (name === 'row-height') {
      // Both halves, or they drift apart again: CSS draws the row and the
      // window maths key off the same number.
      this.style.setProperty('--ov-table-row-h', `${this.rowH}px`);
      this._rev = (this._rev || 0) + 1;
      this.paint();
    } else if (name === 'sort') {
      this.applySort();
    }
  }

  /* `sort="flux"` names a COLUMN KEY, not an index, because an index is a fact
   * about the current column order and the key is a fact about the data. */
  applySort() {
    const key = this.getAttribute('sort');
    if (!key) return;
    const i = this.cols.findIndex((c) => c.key === key);
    if (i >= 0) this.sort(i);
  }

  get cols() { return this._cols || []; }

  set cols(v) {
    this._cols = Array.isArray(v) ? v : [];
    this.sortBy = null;
    this._dir = 1;
    if (this.isConnected && this.dataset.ready) { this.build(); this.paint(); }
  }

  get rows() { return this.data; }

  set rows(v) {
    this.data = Array.isArray(v) ? v : [];
    this._rev = (this._rev || 0) + 1;
    this.sortBy = null;
    this._dir = 1;
    if (this.isConnected && this.dataset.ready && this.cols.length) this.paint();
  }

  /* columns: [{key, label, align}], rows: array of objects */
  load(cols, rows) {
    this._cols = Array.isArray(cols) ? cols : [];
    this.data = Array.isArray(rows) ? rows : [];
    this._rev = (this._rev || 0) + 1;
    this.sortBy = null;
    this._dir = 1;
    this.build();
    this.paint();
  }

  get rowH() { return Number(this.getAttribute('row-height') || 22); }

  build() {
    this.innerHTML =
      `<div class="ov-table__head" role="row">`
      + this.cols.map((c, i) =>
        `<button class="ov-table__h" role="columnheader" data-col="${i}"`
        + ` aria-sort="none">${c.label}</button>`).join('')
      + `</div>`
      + `<div class="ov-table__scroll"><div class="ov-table__pad">`
      + `<div class="ov-table__rows" role="rowgroup"></div></div></div>`
      + `<div class="ov-table__foot"></div>`;

    /* 🔴 The repaint guard below remembers what it last drew. `build()` has
     * just thrown that DOM away, so the memory has to go with it, or the next
     * paint() sees a matching signature and skips, leaving the rows container
     * EMPTY. Reset here rather than in each caller, because the thing that
     * invalidates the memory is the rebuild itself: `set cols` rebuilds without
     * touching the data, and that is the ordinary framework re-render path. */
    this._painted = null;

    this.scroll = this.querySelector('.ov-table__scroll');
    this.pad = this.querySelector('.ov-table__pad');
    this.rowsEl = this.querySelector('.ov-table__rows');
    this.foot = this.querySelector('.ov-table__foot');
    this.style.setProperty('--ov-table-cols', String(this.cols.length));
    /* 🔴 THE HALF THAT WAS MISSING. `table.css` sizes a row from
     * `var(--ov-table-row-h, 22px)` and nothing ever set that variable, while
     * every number in paint() came from the `row-height` attribute. They agreed
     * only because both defaults were 22. At `row-height="34"` the script laid
     * out a 34px grid over 22px rows: too few rows drawn for the viewport, the
     * window translated to the wrong offset, and a scroll range a third too
     * long. One assignment is the whole fix. */
    this.style.setProperty('--ov-table-row-h', `${this.rowH}px`);

    this.setAttribute('role', 'grid');
    /* Declares both that this control reorders AND that it renders a WINDOW
     * onto something larger. The second half is what entitles a motion layer to
     * treat a vanished row as something it lost track of rather than as a row
     * that simply is not there any more. See ov-tree, which says the first half
     * and not the second. */
    this.setAttribute('data-ov-flip', 'windowed');
    // Said out loud on the element, so a test can assert it and a reader can
    // see it. See the note at the top of this file.
    this.setAttribute('data-ov-aria',
      'fails aria-required-children: a virtual grid needs a scroll wrapper '
      + 'between grid and rows, and ARIA has no role for one');

    this.scroll?.addEventListener('scroll', () => this.paint());
    for (const h of this.querySelectorAll('.ov-table__h')) {
      h.addEventListener('click', () => this.sort(Number(h.dataset.col)));
    }
  }

  /* Sorting reorders the DATA and then repaints the window. A virtualised view
   * that sorted only what is on screen would be sorting a sample and calling it
   * a table. */
  sort(i) {
    const key = this.cols[i].key;
    /* 🔴 `_dir`, NEVER `dir`. `dir` is a native HTMLElement property, reflecting
     * the global text-direction attribute, and it accepts only "ltr", "rtl" and
     * "auto". `this.dir = 1` therefore wrote dir="1" onto the host and read
     * back "", so `-this.dir` was 0, the comparator was multiplied by 0, and
     * Array.sort being stable meant THIS TABLE NEVER SORTED. `aria-sort` had
     * the same hole: `this.dir === 1` could never be true, so a sorted column
     * always announced itself as descending. Both were silent. */
    this._dir = this.sortBy === key ? -this._dir : 1;
    this.sortBy = key;
    this.data.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * this._dir);
    for (const h of this.querySelectorAll('.ov-table__h')) {
      h.setAttribute('aria-sort', Number(h.dataset.col) === i
        ? (this._dir === 1 ? 'ascending' : 'descending') : 'none');
    }
    /* Announce the reorder around the repaint. This element does not know what
     * listens, or whether anything does: a component that asked whether a
     * motion layer was loaded would be a component that knows about the motion
     * layer. Events cost nothing when nobody is listening. */
    this.dispatchEvent(new CustomEvent('ov:reorder', { detail: { phase: 'before' } }));
    this.scroll.scrollTop = 0;
    this._rev = (this._rev || 0) + 1;
    this.paint();
    this.dispatchEvent(new CustomEvent('ov:reorder', { detail: { phase: 'after' } }));
  }

  paint() {
    if (!this.rowsEl) return;
    const h = this.rowH;
    const total = this.data.length;
    this.pad.style.blockSize = `${total * h}px`;

    const view = this.scroll.clientHeight || 200;
    const first = Math.max(0, Math.floor(this.scroll.scrollTop / h) - 2);
    const count = Math.ceil(view / h) + 4;
    const slice = this.data.slice(first, first + count);

    /* 🔴 SKIP THE IDENTICAL REPAINT. Scroll fires far more often than the
     * window changes: at 22px rows, 21 of every 22 pixels of scroll produce
     * the same slice. Worth skipping on its own, and REQUIRED once anything
     * animates the rows, because rebuilding innerHTML replaces every row node
     * and a replaced node drops its running animation with no error anywhere.
     * `_rev` is what makes a re-sort of the same window still repaint. */
    const sig = `${first}:${slice.length}:${this._rev || 0}`;
    if (sig === this._painted) return;
    this._painted = sig;

    this.rowsEl.style.transform = `translateY(${first * h}px)`;
    this.rowsEl.innerHTML = slice.map((r, n) =>
      `<div class="ov-table__row" role="row" aria-rowindex="${first + n + 1}"`
      + `${rowId(r) ? ` data-flip-id="${rowId(r)}"` : ''}>`
      + this.cols.map((c) =>
        `<span class="ov-table__cell" role="gridcell"`
        + `${c.align === 'right' ? ' data-num' : ''}>${
          String(r[c.key] ?? '')}</span>`).join('')
      + `</div>`).join('');

    this.setAttribute('aria-rowcount', String(total));
    // 100 row elements for 50,000 rows, and a table that says nothing lies.
    this.foot.textContent = `${slice.length} of ${total} rows drawn`;
  }
}

define('ov-table', OvTable);

export { OvTable };
