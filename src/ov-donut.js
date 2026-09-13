/* <ov-donut> - parts of a declared whole, and the part nobody accounted for.
 *
 * The UNATTRIBUTED wedge is the point: parts are never rescaled to 100%.
 * A load split, a budget, a
 * crew roster by station.
 *
 *   <ov-donut whole="120" unit="MW"
 *             parts="REACTOR A=42, REACTOR B=31, SOLAR=null, WIND=9"></ov-donut>
 *   donut.parts = [{ label: 'REACTOR A', value: 44 }, ...];
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 IT NEVER RESCALES THE PARTS TO 100%. Every chart library's donut draws
 * each part as a share of the parts' own sum, so a donut of 82 MW of known
 * load out of 120 looks exactly like one that accounts for all of it. Here a
 * part is a fraction of the declared WHOLE, and whatever the parts do not
 * cover is its own wedge, UNATTRIBUTED, hatched, with its value.
 *
 * Four rules follow.
 * 1. NO WHOLE, NO PROPORTIONS. Without `whole` the only circle available is
 *    the parts' own sum, which is the rescaling this element refuses, so it
 *    lists the parts and says why it will not draw them.
 * 2. A PART WITH NO READING IS NAMED, NOT ABSORBED. It is not drawn, and the
 *    unattributed wedge says it includes that part, so a dropout does not
 *    quietly become "unaccounted for" with nobody told which.
 * 3. MORE THAN THE WHOLE IS DRAWN AS MORE. Parts that sum past the whole
 *    carry on round onto an outer ring in the alarm colour, and the centre
 *    reads OVER BY n. Squeezing them back into one lap would be rescaling
 *    again, in the other direction.
 * 4. A NEGATIVE PART IS REFUSED, and said: a share of a whole cannot be
 *    less than none.
 *
 * Parts are told apart by PATTERN, not colour: the tokens state one accent,
 * several themes are near-monochrome, and a pattern survives both that and
 * colour-blindness. Each legend swatch carries the same pattern.
 */

import { define } from './ov-core.js';
import { REASONS, upgrade } from './ov-refusal.js';

const DONUT_NS = 'http://www.w3.org/2000/svg';
const PATTERNS = ['solid', 'light', 'stripe', 'dots', 'cross'];
let uid = 0;

function svgEl(tag, attrs) {
  const e = document.createElementNS(DONUT_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/* An annular sector from angle a0 to a1 (degrees, 0 = top, clockwise). */
function sector(cx, cy, r0, r1, a0, a1) {
  const pt = (r, a) => {
    const t = (a - 90) * Math.PI / 180;
    return `${(cx + r * Math.cos(t)).toFixed(3)},${(cy + r * Math.sin(t)).toFixed(3)}`;
  };
  const sweep = a1 - a0;
  if (sweep >= 359.999) {
    // A full ring: two halves, since one arc cannot start and end on a point.
    return `M${pt(r1, 0)} A${r1},${r1} 0 1 1 ${pt(r1, 180)} A${r1},${r1} 0 1 1 ${pt(r1, 0)} `
      + `M${pt(r0, 0)} A${r0},${r0} 0 1 0 ${pt(r0, 180)} A${r0},${r0} 0 1 0 ${pt(r0, 0)} Z`;
  }
  const large = sweep > 180 ? 1 : 0;
  return `M${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} L${pt(r0, a1)} `
    + `A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z`;
}

class OvDonut extends HTMLElement {
  static observedAttributes = ['whole', 'unit', 'parts', 'label'];

  constructor() {
    super();
    this.list = [];
  }

  connectedCallback() {
    upgrade(this, ['parts']);
    if (!this.svg) this.build();
    if (this._parts === undefined) this.applyAttribute();
    this.paint();
  }

  attributeChangedCallback(name) {
    if (!this.svg) return;
    if (name === 'parts' && this._parts === undefined) this.applyAttribute();
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label') || 'Parts of a whole');
    this.paint();
  }

  wholeOf() {
    const raw = this.getAttribute('whole');
    const n = Number(raw);
    return raw !== null && raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
  }

  build() {
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Parts of a whole');
    this.key = `ovd${++uid}`;
    this.svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'ov-donut__ring', 'aria-hidden': 'true' });
    const defs = svgEl('defs', {});
    const pat = (name, children) => {
      const p = svgEl('pattern', { id: `${this.key}-${name}`, width: 4, height: 4, patternUnits: 'userSpaceOnUse' });
      p.innerHTML = children;
      defs.append(p);
    };
    // Patterns take their colour from CSS (currentColor on the svg).
    pat('stripe', '<path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="currentColor" stroke-width="1.1"/>');
    pat('dots', '<circle cx="2" cy="2" r="0.9" fill="currentColor"/>');
    pat('cross', '<path d="M0,0 L4,4 M4,0 L0,4" stroke="currentColor" stroke-width="0.7"/>');
    pat('unattr', '<path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="currentColor" stroke-width="0.6" opacity="0.6"/>');
    this.svg.append(defs);
    this.slices = svgEl('g', {});
    this.svg.append(this.slices);
    this.center = document.createElement('div');
    this.center.className = 'ov-donut__centre';
    this.center.setAttribute('role', 'status');
    const fig = document.createElement('div');
    fig.className = 'ov-donut__fig';
    fig.append(this.svg, this.center);
    this.legend = document.createElement('ul');
    this.legend.className = 'ov-donut__legend';
    this.note = document.createElement('p');
    this.note.className = 'ov-donut__note';
    const body = document.createElement('div');
    body.className = 'ov-donut__body';
    body.append(fig, this.legend);
    this.append(body, this.note);
  }

  fillFor(kind) {
    if (kind === 'solid' || kind === 'light') return 'currentColor';
    return `url(#${this.key}-${kind})`;
  }

  /* ---- INPUT ---------------------------------------------------------- */

  /* An ARRAY of { label, value }, the whole set. A map is refused, and said. */
  set parts(list) {
    this._parts = list;
    this.rejected = null;
    if (Array.isArray(list)) this.load(list);
    else if (list !== undefined && list !== null) { this.rejected = 'parts ignored: not an array of { label, value }'; this.load([]); }
    else this.load([]);
    this.paint();
  }

  get parts() { return this.list.map((p) => ({ label: p.label, value: p.value })); }

  applyAttribute() {
    const raw = (this.getAttribute('parts') || '').trim();
    const out = [];
    this.malformed = 0;
    for (const part of raw ? raw.split(',') : []) {
      const t = part.trim();
      if (!t) continue;
      const at = t.lastIndexOf('=');
      if (at < 1) { this.malformed += 1; continue; }
      const v = t.slice(at + 1).trim();
      out.push({ label: t.slice(0, at).trim(), value: v === '' || v === 'null' ? null : v });
    }
    this.load(out);
  }

  load(list) {
    this.list = [];
    for (const p of list) {
      if (!p || typeof p !== 'object' || !p.label) continue;
      let value = p.value === null || p.value === undefined ? null : Number(p.value);
      let state = 'ok';
      if (value === null || !Number.isFinite(value)) { value = null; state = 'none'; }
      else if (value < 0) state = 'negative';
      this.list.push({ label: String(p.label), value, state });
    }
  }

  /* ---- PAINT ---------------------------------------------------------- */

  paint() {
    if (!this.svg) return;
    const whole = this.wholeOf();
    const unit = this.getAttribute('unit') ? ` ${this.getAttribute('unit')}` : '';
    const fmt = (v) => `${+v.toFixed(2)}`;
    this.slices.replaceChildren();
    this.legend.replaceChildren();

    const usable = this.list.filter((p) => p.state === 'ok');
    const known = usable.reduce((t, p) => t + p.value, 0);
    const missing = this.list.filter((p) => p.state === 'none').map((p) => p.label);
    const negative = this.list.filter((p) => p.state === 'negative').map((p) => p.label);
    this.toggleAttribute('data-ov-nowhole', whole === null);

    // The track: the whole circle, faint, so an empty lap still reads as
    // "the whole" rather than as nothing.
    this.slices.append(svgEl('path', { class: 'ov-donut__track', d: sector(50, 50, 28, 42, 0, 360) }));

    // A part's pattern is fixed by its place in the DECLARED list, not among
    // the parts that happen to have readings: numbering the usable ones
    // handed SOLAR's stripes to WIND the moment SOLAR dropped out, so a
    // pattern stopped meaning a part.
    this.list.forEach((p, i) => { p.kind = PATTERNS[i % PATTERNS.length]; });
    let angle = 0, over = 0;
    usable.forEach((p) => {
      const kind = p.kind;
      if (whole === null) return;
      let sweep = (p.value / whole) * 360;
      // First lap up to 360; anything past it is overflow, drawn below.
      const inLap = Math.max(0, Math.min(sweep, 360 - angle));
      if (inLap > 0) {
        const path = svgEl('path', {
          class: `ov-donut__slice ov-donut__slice--${kind}`,
          d: sector(50, 50, 28, 42, angle, angle + inLap),
          fill: this.fillFor(kind),
          'data-ov-label': p.label,
          'data-ov-sweep': inLap.toFixed(3),
        });
        this.slices.append(path);
      }
      angle += inLap;
      over += sweep - inLap;
    });

    // What the parts do not cover: its own wedge, never closed by rescaling.
    const rest = whole === null ? 0 : Math.max(0, whole - known);
    if (whole !== null && rest > 0) {
      this.slices.append(svgEl('path', {
        class: 'ov-donut__slice ov-donut__slice--unattr',
        d: sector(50, 50, 28, 42, angle, 360),
        fill: this.fillFor('unattr'),
        'data-ov-label': 'UNATTRIBUTED',
        'data-ov-sweep': (360 - angle).toFixed(3),
      }));
    }
    // More than the whole: carried onto an outer ring, in alarm.
    if (whole !== null && over > 0) {
      this.slices.append(svgEl('path', {
        class: 'ov-donut__over',
        d: sector(50, 50, 44, 48, 0, Math.min(over, 360)),
        'data-ov-sweep': over.toFixed(3),
      }));
    }
    this.setAttribute('data-ov-over', over > 0 ? 'true' : 'false');

    // Centre and legend.
    if (whole === null) {
      this.center.textContent = 'NO WHOLE DECLARED';
    } else if (known > whole) {
      this.center.innerHTML = '';
      this.center.append(Object.assign(document.createElement('b'), { textContent: `OVER BY ${fmt(known - whole)}${unit}` }),
        Object.assign(document.createElement('span'), { textContent: `${fmt(known)} of ${fmt(whole)}` }));
    } else {
      this.center.innerHTML = '';
      this.center.append(Object.assign(document.createElement('b'), { textContent: `${fmt(known)} / ${fmt(whole)}${unit}` }),
        Object.assign(document.createElement('span'), { textContent: 'ATTRIBUTED' }));
    }

    const row = (kind, label, text, cls) => {
      const li = document.createElement('li');
      li.className = `ov-donut__item${cls ? ` ov-donut__item--${cls}` : ''}`;
      const sw = svgEl('svg', { viewBox: '0 0 10 10', class: 'ov-donut__swatch', 'aria-hidden': 'true' });
      if (kind) sw.append(svgEl('rect', { x: 0.5, y: 0.5, width: 9, height: 9, fill: this.fillFor(kind), class: `ov-donut__slice--${kind}` }));
      const name = document.createElement('span');
      name.className = 'ov-donut__name';
      name.textContent = label;
      const val = document.createElement('span');
      val.className = 'ov-donut__val';
      val.textContent = text;
      li.append(sw, name, val);
      this.legend.append(li);
      return li;
    };
    for (const p of usable) {
      row(p.kind, p.label, whole === null ? `${fmt(p.value)}${unit}` : `${fmt(p.value)}${unit} · ${fmt((p.value / whole) * 100)}%`);
    }
    for (const l of missing) row(null, l, 'NO DATA', 'none');
    for (const l of negative) row(null, l, 'REFUSED: NEGATIVE', 'negative');
    if (whole !== null && rest > 0) {
      row('unattr', 'UNATTRIBUTED', `${fmt(rest)}${unit} · ${fmt((rest / whole) * 100)}%`
        + (missing.length ? ` (includes ${missing.join(', ')}: ${REASONS.unknown})` : ''), 'unattr');
    }

    const said = [];
    if (whole === null) said.push('no whole declared: parts are listed, not drawn, because a circle of their own sum would rescale them to 100%');
    if (missing.length && (whole === null || rest === 0)) said.push(`${missing.length} part${missing.length > 1 ? 's' : ''} with no reading: ${missing.join(', ')}`);
    if (negative.length) said.push(`negative part refused: ${negative.join(', ')}`);
    if (over > 0) said.push(`parts total ${fmt(known)}, more than the whole of ${fmt(whole)}: the excess is drawn on the outer ring`);
    if (this.malformed) said.push(`${this.malformed} malformed entr${this.malformed > 1 ? 'ies' : 'y'} ignored`);
    if (this.rejected) said.push(this.rejected);
    this.note.textContent = said.join(' · ');
    this.note.hidden = !said.length;

    this.setAttribute('aria-label', `${this.getAttribute('label') || 'Parts of a whole'}: `
      + (whole === null ? 'no whole declared' : `${fmt(known)} of ${fmt(whole)}${unit} attributed`)
      + (rest > 0 ? `, ${fmt(rest)} unattributed` : '') + (over > 0 ? `, over by ${fmt(known - whole)}` : ''));
  }
}

define('ov-donut', OvDonut);

export { OvDonut };
