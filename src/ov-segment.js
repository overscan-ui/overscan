/* <ov-segment> - a seven-segment readout that refuses to invent.
 *
 * Light DOM on purpose, no shadow root. The kit's whole reachability rule is
 * that one control surface reaches everything: a shadow root would hide these
 * segments from the theme, the contrast switch and the motion switch, and
 * a scrollable region can hide in one where no light-DOM sweep
 * could see it. Encapsulation is not worth that here.
 *
 * See REFUSAL.md for the protocol. The short version: a value this display
 * cannot draw renders as dashes in the alarm colour, never as a different
 * number, and the accessible name states the reason rather than the value.
 */

import { define } from './ov-core.js';
import './ov-source.js';
import './ov-refusal.js';

/* Segment geometry, one viewBox for both modes.
 *
 * Drawn as SVG rather than positioned boxes because fourteen segments need
 * diagonals, and a rotated div is a worse diagonal than a line. One rendering
 * path for both modes: two paths for the same widget is the kind of split that
 * quietly diverges.
 *
 * Bars are polygons with mitred ends, the way a real display etches them.
 * Diagonals are stroked lines, which is what they are.
 */
const BARS = {
  a:  '20,5 80,5 88,12 80,19 20,19 12,12',
  d:  '20,161 80,161 88,168 80,175 20,175 12,168',
  g:  '20,83 80,83 88,90 80,97 20,97 12,90',
  g1: '20,83 46,83 52,90 46,97 20,97 12,90',
  g2: '54,83 80,83 88,90 80,97 54,97 48,90',
  f:  '5,20 12,13 19,20 19,76 12,83 5,76',
  b:  '81,20 88,13 95,20 95,76 88,83 81,76',
  e:  '5,98 12,91 19,98 19,154 12,161 5,154',
  c:  '81,98 88,91 95,98 95,154 88,161 81,154',
  i:  '43,20 50,13 57,20 57,76 50,83 43,76',
  l:  '43,98 50,91 57,98 57,154 50,161 43,154',
};

const DIAGONALS = {
  h: [22, 24, 41, 76],
  j: [78, 24, 59, 76],
  k: [59, 104, 78, 156],
  m: [41, 104, 22, 156],
};

const ORDER = {
  7: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  14: ['a', 'b', 'c', 'd', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'],
};

// Which segments each glyph lights. Anything not in here is unrepresentable,
// which is a refusal rather than something to approximate.
const GLYPHS_7 = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd',
  '-': 'g', ' ': '',
  'A': 'abcefg', 'b': 'fgedc', 'C': 'afed', 'd': 'bgedc', 'E': 'afged',
  'F': 'afeg', 'H': 'fbgec', 'L': 'fed', 'O': 'abcdef', 'P': 'abfge',
  'r': 'eg', 'S': 'afgcd', 't': 'fged', 'U': 'bcdef',
};

/* Fourteen segments can form the Latin alphabet, so a value that is
 * unrepresentable on seven is often drawable here. The refusal is a property
 * of the DISPLAY, not of the value, and the demo shows the same string
 * refusing on one and drawing on the other. */
const GLYPHS_14 = {
  '0': 'abcdef', '1': 'bc', '2': 'abg1g2ed', '3': 'abg1g2cd', '4': 'fg1g2bc',
  '5': 'afg1g2cd', '6': 'afg1g2edc', '7': 'abc', '8': 'abcdefg1g2',
  '9': 'abfg1g2cd', '-': 'g1g2', ' ': '', '.': '',
  'A': 'abcefg1g2', 'B': 'abcdg2il', 'C': 'adef', 'D': 'abcdil',
  'E': 'adefg1g2', 'F': 'aefg1', 'G': 'acdefg2', 'H': 'bcefg1g2',
  'I': 'adil', 'J': 'bcde', 'K': 'efg1jk', 'L': 'def', 'M': 'bcefhj',
  'N': 'bcefhk', 'O': 'abcdef', 'P': 'abefg1g2', 'Q': 'abcdefk',
  'R': 'abefg1g2k', 'S': 'acdfg1g2', 'T': 'ail', 'U': 'bcdef',
  'V': 'efjm', 'W': 'bcefkm', 'X': 'hjkm', 'Y': 'hjl', 'Z': 'adjm',
};

const TABLES = { 7: GLYPHS_7, 14: GLYPHS_14 };

function segmentSvg(lit, mode) {
  const parts = ORDER[mode].map((id) => {
    const on = lit.includes(id) ? ' data-on' : '';
    if (id in DIAGONALS) {
      const [x1, y1, x2, y2] = DIAGONALS[id];
      return `<line class="ov-seg__s" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${on}/>`;
    }
    return `<polygon class="ov-seg__s" points="${BARS[id]}"${on}/>`;
  }).join('');
  return `<svg class="ov-seg__svg" viewBox="0 0 100 180" aria-hidden="true">${parts}</svg>`;
}

/* Segment ids are multi-character in fourteen-segment mode, so membership has
 * to be tested against a list rather than with substring matching. `g` is a
 * prefix of `g1`, and `includes` on a string would light both. */
function litList(spec, mode) {
  if (mode === 7) return spec.split('');
  const out = [];
  let i = 0;
  while (i < spec.length) {
    const two = spec.slice(i, i + 2);
    if (two === 'g1' || two === 'g2') { out.push(two); i += 2; }
    else { out.push(spec[i]); i += 1; }
  }
  return out;
}

class OvSegment extends HTMLElement {
  static observedAttributes = ['value', 'digits', 'unit', 'max-age', 'min', 'max',
    'deadband', 'frozen-after', 'substituted'];

  bindSource() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (reading) => {
      const o = (reading && typeof reading === 'object') ? reading : { value: reading };
      if (o.value === null || o.value === undefined) this.removeAttribute('value');
      else this.setAttribute('value', typeof o.value === 'number'
        ? o.value.toFixed(Number(this.getAttribute('places') ?? 1)) : String(o.value));
      if (o.age !== undefined) this.setAttribute('age', o.age);
    });
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); }

  connectedCallback() {
    /* upgrade() last, so the cells exist before a reclaimed property
     * redraws against them. It used to sit after resolve()'s final return,
     * where it never ran, and a framework-set `value` shadowed the accessor. */
    this.bindSource(); this.render(); window.OverscanRefusal.upgrade(this, ['value']); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }

  get digits() { return Math.max(1, parseInt(this.getAttribute('digits') || '4', 10)); }

  get mode() { return this.getAttribute('segments') === '14' ? 14 : 7; }

  get glyphs() { return TABLES[this.mode]; }

  /* Decide what this display can honestly do with the value it was handed.
   * Every branch returns a reason or a string of glyphs; there is deliberately
   * no branch that trims, rounds or filters the input to make it fit. */
  resolve() {
    const raw = window.OverscanRefusal.rawOf(this, 'value');
    if (raw === null || raw === '' || raw === 'null') return { reason: 'unknown' };

    const pre = window.OverscanRefusal.common(this, raw, [...raw].filter((c) => c !== '.').length);
    if (pre) return pre;

    // The decimal point rides on the preceding digit, so it costs no cell.
    const cells = [...raw].filter((c) => c !== '.').length;
    if (cells > this.digits) return { reason: 'overflow' };

    const table = this.glyphs;
    for (const c of raw) {
      if (c !== '.' && !(c in table)) return { reason: 'unrepresentable' };
    }
    return { text: raw };
  }

  render() {
    const r = this.resolve();
    const n = this.digits;
    let cells;

    if (r.reason) {
      cells = Array.from({ length: n }, () => ({ g: '-', dp: false }));
    } else {
      cells = [];
      for (const c of r.text) {
        if (c === '.') {
          if (cells.length) cells[cells.length - 1].dp = true;
          else cells.push({ g: '0', dp: true });
        } else {
          cells.push({ g: c, dp: false });
        }
      }
      while (cells.length < n) cells.unshift({ g: ' ', dp: false });
    }

    const mode = this.mode;
    const table = this.glyphs;
    this.innerHTML = cells.map((cell) => {
      const lit = litList(table[cell.g] ?? '', mode);
      return `<span class="ov-seg"${cell.dp ? ' data-dp' : ''}>`
        + segmentSvg(lit, mode) + '</span>';
    }).join('');

    // Marking and naming are the shared protocol's job, not this widget's.
    // A readout drawn as divs with no text has an empty accessible name, and
    // hiding it from assistive tech only removes information.
    window.OverscanRefusal.apply(this, r, this.getAttribute('unit'));
  }
}

window.OverscanRefusal.prop(OvSegment, 'value');
define('ov-segment', OvSegment);

export { OvSegment };
