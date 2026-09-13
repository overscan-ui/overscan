/* <ov-polygon> - a shape that is normal only when every spoke says so.
 *
 * A configural display: N parameters on spokes, a reference
 * shape for normal, and the polygon for now, so a deviation is seen as a
 * change of SHAPE before any number is read. NUREG-0700 §1.2.10's safety
 * parameter display, and Westworld's attribute matrix.
 *
 * ⭐ THE REFUSAL: IT DOES NOT CLOSE OVER A GAP. A spoke whose data is invalid
 * or missing leaves the polygon OPEN: the two edges that would meet at it are
 * not drawn, and the spoke is marked. Closing through zero, or straight across
 * from its neighbours, would draw a shape that can look normal while a
 * parameter is missing, which is exactly what a shape display exists to
 * prevent. NUREG-0700 §5.2-4 asks for a quality indicator on every parameter;
 * this is that indicator, drawn into the shape itself.
 *
 * Qualifiers, following the protocol:
 *   unvalidated, or older than `max-age` seconds: its edges are DASHED. The
 *   number is shown, and the shape says it is not vouched for.
 *   Outside the spoke's normal band: its point is in the alarm colour.
 *   A `configured` value (what it was set to, as opposed to what it reads) is
 *   drawn as its own tick, never folded into the observed polygon.
 *
 * Input, as the `axes` property or from `src`:
 *   [{ label, value, min = 0, max = 1, normal: [lo, hi], quality, age, configured }]
 *   quality: 'valid' (default) | 'unvalidated' | 'invalid'. value null = no data.
 */

import { define } from './ov-core.js';

const polyText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

class OvPolygon extends HTMLElement {
  static observedAttributes = ['src', 'max-age'];

  connectedCallback() {
    this._axes = this._axes || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get axes() { return this._axes; }
  set axes(v) { this._axes = Array.isArray(v) ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._axes = Array.isArray(data.axes) ? data.axes : null;
    } catch {
      if (this.getAttribute('src') === src) this._axes = null;
    }
    this.paint();
  }

  /* 'solid' | 'dashed' | 'none' for one spoke. */
  standing(a) {
    const v = a.value;
    if (v === null || v === undefined || !Number.isFinite(Number(v)) || a.quality === 'invalid') return 'none';
    const maxAge = Number(this.getAttribute('max-age'));
    const stale = Number.isFinite(maxAge) && maxAge > 0 && Number.isFinite(Number(a.age)) && Number(a.age) > maxAge;
    return a.quality === 'unvalidated' || stale ? 'dashed' : 'solid';
  }

  paint() {
    const A = this._axes;
    this.removeAttribute('data-ov-refusal');
    if (!A || A.length < 3) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.innerHTML = `<div class="ov-polygon__void">${A && A.length ? 'FEWER THAN 3 SPOKES: NO SHAPE' : 'NO PARAMETERS'}</div>`;
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'Shape display, no reading');
      return;
    }
    const n = A.length, cx = 120, cy = 120, R = 88;
    const angle = (i) => (i / n) * Math.PI * 2 - Math.PI / 2;
    /* ⭐ NORMAL IS A REGULAR SHAPE, BY CONSTRUCTION. Scaled on raw range, each
       spoke's normal band sat at its own radius and "all normal" drew a lop-
       sided polygon the eye could not compare to anything. Each spoke is
       mapped piecewise instead: min..lo onto 0..0.5, the normal band lo..hi
       onto 0.5..0.7, hi..max onto 0.7..1. All-normal is then a ring between
       0.5 and 0.7, and a deviation is a dent or a spike. (The configural
       display's standard move; a spoke with no band falls back to linear.) */
    const norm = (a, v) => {
      const mn = Number.isFinite(Number(a.min)) ? Number(a.min) : 0;
      const mx = Number.isFinite(Number(a.max)) ? Number(a.max) : 1;
      const x = Number(v);
      const seg = (x0, x1, r0, r1) => r0 + (r1 - r0) * ((x - x0) / ((x1 - x0) || 1));
      let f;
      if (Array.isArray(a.normal) && a.normal.length === 2) {
        const lo = Number(a.normal[0]), hi = Number(a.normal[1]);
        f = x < lo ? seg(mn, lo, 0, 0.5) : x > hi ? seg(hi, mx, 0.7, 1) : seg(lo, hi, 0.5, 0.7);
      } else {
        f = (x - mn) / ((mx - mn) || 1);
      }
      return Math.max(0, Math.min(1.08, f));
    };
    const at = (i, f) => [cx + R * f * Math.cos(angle(i)), cy + R * f * Math.sin(angle(i))];
    const P = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

    let g = '';
    for (let i = 0; i < n; i++) g += `<line class="ov-polygon__spoke" x1="${cx}" y1="${cy}" x2="${P(at(i, 1)).replace(',', '" y2="')}"/>`;
    // The reference shape: the middle of every normal band, which the scaling
    // above puts on one ring. The eye compares shapes, so normal has to BE one.
    const ref = A.map((a, i) => at(i, 0.6));
    g += `<polygon class="ov-polygon__ref" points="${ref.map(P).join(' ')}"/>`;

    const st = A.map((a) => this.standing(a));
    const pts = A.map((a, i) => (st[i] === 'none' ? null : at(i, norm(a, a.value))));
    let open = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!pts[i] || !pts[j]) { open += 1; continue; }            // the gap stays a gap
      const dashed = st[i] === 'dashed' || st[j] === 'dashed';
      g += `<line class="ov-polygon__edge${dashed ? ' is-doubt' : ''}" x1="${pts[i][0].toFixed(1)}" y1="${pts[i][1].toFixed(1)}" x2="${pts[j][0].toFixed(1)}" y2="${pts[j][1].toFixed(1)}"/>`;
    }

    let outside = 0;
    A.forEach((a, i) => {
      const [lx, ly] = at(i, 1.18);
      const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
      g += `<text class="ov-polygon__label" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}">${polyText(a.label ?? `P${i + 1}`)}</text>`;
      if (Number.isFinite(Number(a.configured))) {
        // Configured is not observed: its own mark, off the polygon.
        const [tx, ty] = at(i, norm(a, a.configured));
        g += `<circle class="ov-polygon__configured" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="4.5"/>`;
      }
      if (st[i] === 'none') {
        const [mx, my] = at(i, 0.5);
        g += `<text class="ov-polygon__gap" x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="middle">${a.quality === 'invalid' ? 'INV' : '?'}</text>`;
        return;
      }
      const v = Number(a.value);
      const out = a.normal && (v < Number(a.normal[0]) || v > Number(a.normal[1]));
      if (out) outside += 1;
      g += `<circle class="ov-polygon__point${out ? ' is-out' : ''}${st[i] === 'dashed' ? ' is-doubt' : ''}" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3"/>`;
    });

    const none = st.filter((s) => s === 'none').length;
    const doubt = st.filter((s) => s === 'dashed').length;
    const words = [`${n - none - doubt} of ${n} valid`];
    if (doubt) words.push(`${doubt} not vouched for`);
    // "No data" and "invalid" are different claims about a spoke; both open it.
    const invalid = A.filter((a, i) => st[i] === 'none' && a.quality === 'invalid').length;
    const missing = none - invalid;
    if (none) words.push([missing && `${missing} no data`, invalid && `${invalid} invalid`].filter(Boolean).join(', ') + ', shape OPEN');
    if (outside) words.push(`${outside} outside normal`);
    if (!none && !doubt && !outside) words.push('shape closed, all normal');

    this.innerHTML = `<svg class="ov-polygon__svg" viewBox="-40 -10 320 260" aria-hidden="true">${g}</svg>`
      + `<div class="ov-polygon__readout">${words.map((w) => `<span${/OPEN|outside|vouched/.test(w) ? ' class="is-flag"' : ''}>${w}</span>`).join('')}</div>`;
    this.setAttribute('data-ov-shape', none ? 'open' : 'closed');
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Shape display, ${words.join(', ')}`);
  }
}

define('ov-polygon', OvPolygon);

export { OvPolygon };
