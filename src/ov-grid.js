/* <ov-grid> - a character cell grid that measures instead of assuming.
 *
 * A kit whose default theme is called `terminal` had no character grid at all,
 * which was the largest hole in it. This is that grid, and the reason it is a
 * widget rather than a `<pre>` is mixed script:
 *
 *   A <pre> HAS NO COLUMNS, ONLY A FONT ADVANCE.
 *
 * Pad a box-drawn table by String length and it drifts 12 columns. Pad it by
 * wcwidth and a real terminal emulator gets it exactly right, while the same
 * table in a <pre> still drifts 39.7px, because Han renders at 1.695x Latin
 * where wcwidth says 2. The character is two cells wide in the model and not
 * two cells wide on the screen.
 *
 * So this grid does three things no <pre> does:
 *
 * 1. It MEASURES the advance of the actual rendered face rather than trusting
 *    `ch`, which is the advance of digit zero and therefore a Latin unit.
 * 2. It places every glyph in a cell of its own, so nothing accumulates drift:
 *    an error in one glyph cannot push the rest of the row.
 * 3. It REPORTS the glyphs whose natural advance did not match the cell they
 *    were given, because that mismatch is the finding and hiding it would make
 *    this the same lie as a <pre> that looks aligned until it is not.
 */

import { define } from './ov-core.js';

const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
];

/* Combining marks occupy no cell at all. Thai is the script that breaks a naive
 * grid, because a cell holding one glyph has no way to express a base plus its
 * marks, and it is the script nobody tests. */
const ZERO = [[0x0300, 0x036f], [0x0483, 0x0489], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x200b, 0x200f], [0xfe00, 0xfe0f]];

const inRanges = (cp, ranges) => ranges.some(([a, b]) => cp >= a && cp <= b);
const cellsFor = (ch) => {
  const cp = ch.codePointAt(0);
  if (inRanges(cp, ZERO)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
};

class OvGrid extends HTMLElement {
  /* ⚠️ `cols` WAS HERE AND DID NOTHING. render() lays out the lines it is
   * given and never read it, so `cols="4"` and `cols="200"` produced
   * byte-identical output. Nothing in the repo set it either. Since the
   * manifest is generated from this list, declaring it published a column
   * count the element does not have. Removed rather than invented: what a
   * column limit should DO here, wrap or truncate, is a design decision and
   * not something to guess at from a dead declaration. */
  static observedAttributes = ['text'];

  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }

  /* Measured, not assumed. One glyph rendered in the element's own resolved
   * font, read back from the box it actually occupies. */
  measure() {
    const probe = document.createElement('span');
    probe.textContent = '0';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    this.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w || 8;
  }

  render() {
    const text = this.getAttribute('text') ?? this.textContent ?? '';
    const unit = this.measure();
    const lines = String(text).split('\n');

    let fitted = 0;
    let total = 0;
    let marks = 0;

    /* 🔴 ONE PROBE PER DISTINCT GLYPH, WRITTEN ALL AT ONCE, READ ALL AT ONCE.
     * This used to set `probe.textContent` and read the box back once PER
     * CHARACTER, and a read after a write is a forced layout: the home page's
     * grids spent 367 layouts in a single 105ms task while the hero was
     * animating in, which is the same interleave the masonry wall had. Writing
     * every probe before reading any costs ONE layout for the whole element,
     * and identical characters resolve to identical boxes, so measuring each
     * distinct one is not an approximation. */
    /* Spread, not split(''): this file counts CODE POINTS (cellsFor works on
     * them), and splitting UTF-16 units would measure half a surrogate pair. */
    const distinct = [...new Set(
      [...lines.join('')].filter((ch) => cellsFor(ch) !== 0),
    )];
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    const spans = new Map();
    for (const ch of distinct) {
      const s = document.createElement('span');
      s.textContent = ch;
      probe.appendChild(s);
      spans.set(ch, s);
    }
    this.appendChild(probe);
    const widths = new Map();
    for (const [ch, s] of spans) widths.set(ch, s.getBoundingClientRect().width);

    const rows = lines.map((line) => {
      let out = '';
      for (const ch of line) {
        const cells = cellsFor(ch);
        if (cells === 0) {
          // A combining mark has no cell, because a cell holds one glyph and
          // this model has no way to express a base plus its marks. Thai is
          // where that shows: it is the script nobody tests, and
          // it broke both a grid and a "vertical writing is an Asian property"
          // claim. Skipping the mark is the honest failure; skipping it
          // silently is not, so it is counted.
          marks += 1;
          continue;
        }
        total += 1;
        const natural = widths.get(ch) ?? 0;
        const allotted = unit * cells;
        // A glyph wider or narrower than its cells is squeezed to fit, and
        // counted. wcwidth says a Han character is two columns; the face
        // disagrees, and the face is what the reader sees.
        const scale = natural > 0 ? allotted / natural : 1;
        const off = Math.abs(scale - 1) > 0.02;
        if (off) fitted += 1;
        // Box drawing and block elements are FURNITURE, not text: a frame read
        // aloud is noise, and a boundary is gated at 3:1 rather than 4.5:1.
        const cp = ch.codePointAt(0);
        const furniture = (cp >= 0x2500 && cp <= 0x259f);
        out += `<i class="ov-grid__c${furniture ? ' is-frame' : ''}"`
          + `${furniture ? ' aria-hidden="true"' : ''} style="--c:${cells}`
          + (off ? `;--s:${scale.toFixed(4)}` : '') + `">${
            ch.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
          }</i>`;
      }
      return `<div class="ov-grid__row">${out}</div>`;
    });
    probe.remove();

    this.innerHTML = rows.join('');
    this.style.setProperty('--ov-grid-unit', `${unit}px`);
    const notes = [];
    if (fitted) notes.push(`${fitted} of ${total} glyphs scaled to their cell`);
    if (marks) notes.push(`${marks} combining marks have no cell of their own`);
    this.toggleAttribute('data-ov-fitted', notes.length > 0);
    if (notes.length) this.setAttribute('data-ov-fitted-n', notes.join(' \u00b7 '));
  }
}

define('ov-grid', OvGrid);

/* cellsFor is exported for ov-term, so the two elements agree on how wide a
   glyph is: one table, not a copy that can drift. */
export { OvGrid, cellsFor };
