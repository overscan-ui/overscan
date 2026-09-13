/* <ov-orbit> - a trajectory plot that stops where its prediction does.
 *
 * For antiseptic, holo and vector. A body, a predicted path,
 * burn points, the craft and a target. The Expanse, The Martian, 2001; KSP's
 * map view.
 *
 *   <ov-orbit label="MARS" body="3390" extent="12000" max-age="60"></ov-orbit>
 *   plot.prediction = {
 *     path: [{ x, y, t, sigma }, ...],   // units of `extent`; t in seconds
 *     horizon: 'SOI EXIT',               // why the prediction stops
 *     target: { x, y, label: 'DEIMOS' },
 *     age: 12,                           // seconds since it was computed
 *   };
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 IT DOES NOT DRAW PAST ITS PREDICTION. The path is exactly the points it
 * was handed and ends at the last one, with a HORIZON mark saying the
 * prediction stops there and why (the next unmodelled encounter, a conic
 * patch limit). It is never extrapolated past that point, and never closed
 * back to its start into a tidy ellipse: a path that looks like it should
 * close has not been computed to close, and the gap is the honest part.
 *
 * ⚠️ This is the weakest-sourced refusal in the kit: the film
 * screens are aesthetics. The rule stands on KSP's conic patches and on the
 * kit's own thesis, not on the films.
 *
 * Three more that fall out of it:
 *
 * 1. UNCERTAINTY IS DRAWN OR ADMITTED, NEVER INVENTED. Each point may carry
 *    `sigma`; the band widens with it. From the first point without one the
 *    band stops and the path turns dashed, labelled UNCERTAINTY NOT GIVEN,
 *    rather than carrying the last width forward.
 * 2. A PREDICTION HAS AN AGE. Past `max-age` it is STALE: dimmed and
 *    labelled with how old it is, because the craft has moved since.
 * 3. WHAT FALLS OFF THE PLOT IS COUNTED, like ov-chart's dropped points, so
 *    a path that leaves the frame does not quietly look shorter.
 *
 * No prediction at all is the kit's `unknown`: the body is drawn, the path
 * is not, and it says NO PREDICTION.
 *
 * ── THE CONE ──────────────────────────────────────────────────────────────
 *
 *   plot.prediction = {
 *     path: [{ x, y, t, r }, ...],        // r: this time's error-circle radius
 *     cone: { contains: 0.67, basis: '2021-2025 official errors',
 *             whole: 'about 60-70% of the time', solidUntil: 5400, reach: '400 km' },
 *   };
 *
 * The forecast cone is folded into this element rather than made its own.
 * The NHC's cone "is formed by enclosing the area swept out by a set of
 * circles... The size of each circle is set so that two-thirds of historical
 * official forecast errors over a 5-year sample fall within the circle."
 *
 * 🔴 A CONE STATES ITS RATE OR IS NOT DRAWN. `contains` (the share of past
 * errors inside each circle, strictly between 0 and 1) and `basis` (what
 * those errors were) are printed beside it; without either there is no cone,
 * because a shaded region with no rate reads as the edge of the possible.
 *
 * Three more, from the same pages:
 *
 * 1. THE WHOLE PATH IS INSIDE LESS OFTEN THAN ANY ONE CIRCLE. The NHC says
 *    "about 60-70% of the time" for the whole path; `whole` prints the rate
 *    the author has, and without it the plot says only "less often than
 *    that", which is always true and never a number it made up.
 * 2. THE CONE IS NOT THE OBJECT'S SIZE. "A tropical cyclone is not a point.
 *    Their effects can span many hundreds of miles from the center." The
 *    notes say so every time, with `reach` if it is given.
 * 3. LATER TIMES ARE LESS CERTAIN AND LOOK IT. After `solidUntil` the cone is
 *    stippled, as the NHC stipples days 4 and 5.
 *
 * The cone runs while every point has an `r` and stops at the first that has
 * none, like the sigma band; in cone mode the sigma band is not drawn.
 */

import { define } from './ov-core.js';
import './ov-source.js';
import { apply } from './ov-refusal.js';

const num = (v) => (v === null || v === undefined || v === '' ? null
  : Number.isFinite(Number(v)) ? Number(v) : null);

/* t seconds -> "T+42m", "T+3h 05m". */
function tplus(t) {
  const s = Math.round(t);
  if (s < 60) return `T+${s}s`;
  if (s < 3600) return `T+${Math.floor(s / 60)}m`;
  return `T+${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
}

/* The offset polygon of a band: each vertex pushed out +/- sigma along the
 * path's normal there (the average of the neighbouring segments). */
function bandPolygon(pts) {
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx, s = pts[i].sigma;
    left.push(`${(pts[i].x + nx * s).toFixed(1)},${(-(pts[i].y + ny * s)).toFixed(1)}`);
    right.push(`${(pts[i].x - nx * s).toFixed(1)},${(-(pts[i].y - ny * s)).toFixed(1)}`);
  }
  return left.concat(right.reverse()).join(' ');
}

class OvOrbit extends HTMLElement {
  static observedAttributes = ['label', 'body', 'extent', 'max-age', 'source'];

  connectedCallback() {
    this.bindSource();
    this.render();
  }

  disconnectedCallback() {
    if (this.unsub) this.unsub();
    this.unsub = null;
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'source') this.bindSource();
    this.render();
  }

  bindSource() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !window.Overscan?.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (r) => { this.prediction = r ?? null; });
  }

  /* Structured data, not a reading: a path is many points with their own
   * fields, so it is a plain accessor (api.py types it Structured). null is
   * NO PREDICTION, the same answer the protocol gives a dropout. */
  get prediction() { return this._prediction; }

  set prediction(v) {
    this._prediction = v;
    if (this.isConnected) this.render();
  }

  extentN() { const n = num(this.getAttribute('extent')); return n && n > 0 ? n : 10000; }

  bodyN() { const n = num(this.getAttribute('body')); return n && n > 0 ? n : 0; }

  /* What the plot can honestly draw from what it was handed. */
  resolve() {
    const p = this._prediction;
    const E = this.extentN();
    if (!p || !Array.isArray(p.path)) return { reason: 'unknown' };
    const pts = [];
    let bad = 0;
    for (const q of p.path) {
      const x = num(q?.x), y = num(q?.y);
      if (x === null || y === null) { bad += 1; continue; }
      const s = num(q.sigma);
      const rr = num(q.r);
      pts.push({ x, y, t: num(q.t), sigma: s !== null && s >= 0 ? s : null, r: rr !== null && rr > 0 ? rr : null, burn: q.burn ?? null });
    }
    if (pts.length < 2) return { reason: 'unknown', bad };
    // The band runs while every point has a sigma, and stops at the first
    // that does not: widths are never carried forward.
    let known = pts.length;
    for (let i = 0; i < pts.length; i++) if (pts[i].sigma === null) { known = i; break; }
    const off = pts.filter((q) => Math.abs(q.x) > E || Math.abs(q.y) > E).length;
    const age = num(p.age);
    const maxAge = num(this.getAttribute('max-age'));
    const stale = age !== null && maxAge !== null && age > maxAge;
    const tgt = p.target && num(p.target.x) !== null && num(p.target.y) !== null
      ? { x: num(p.target.x), y: num(p.target.y), label: p.target.label ?? 'TARGET' } : null;
    let cone = null;
    if (p.cone && typeof p.cone === 'object') {
      const contains = num(p.cone.contains);
      const basis = p.cone.basis ? String(p.cone.basis) : '';
      let coned = pts.length;
      for (let i = 0; i < pts.length; i++) if (pts[i].r === null) { coned = i; break; }
      const refused = !(contains !== null && contains > 0 && contains < 1) ? 'NO CONTAINMENT RATE'
        : !basis ? 'NO BASIS FOR ITS RATE' : coned < 1 ? 'NO CIRCLE RADII' : null;
      cone = {
        refused, contains, basis, coned,
        whole: p.cone.whole ? String(p.cone.whole) : null,
        solidUntil: num(p.cone.solidUntil), reach: p.cone.reach ? String(p.cone.reach) : null,
      };
    }
    return { pts, known, off, bad, stale, age, horizon: p.horizon ?? null, target: tgt, cone };
  }

  render() {
    const r = this.resolve();
    const E = this.extentN();
    const R = this.bodyN();
    const label = this.getAttribute('label') || '';
    const k = E / 100;   // one percent of the plot, for marks and type

    let svg = `<svg class="ov-orbit__svg" viewBox="${-E} ${-E} ${2 * E} ${2 * E}" aria-hidden="true">`;
    if (R) {
      svg += `<circle class="ov-orbit__body" cx="0" cy="0" r="${R}"/>`;
    }
    const notes = [];
    if (r.reason) {
      notes.push('NO PREDICTION');
    } else {
      const { pts } = r;
      let { known } = r;
      const cone = r.cone;
      if (cone) {
        // In cone mode the dashed/undashed split follows the radii.
        known = cone.refused ? 0 : cone.coned;
        if (!cone.refused) svg += this.coneSvg(pts.slice(0, cone.coned), cone.solidUntil, k);
      } else if (known >= 2) {
        svg += `<polygon class="ov-orbit__band" points="${bandPolygon(pts.slice(0, known))}"/>`;
      }
      const line = (from, to) => pts.slice(from, to).map((q) => `${q.x.toFixed(1)},${(-q.y).toFixed(1)}`).join(' ');
      // Exactly the points given, as open polylines: never a closing segment.
      const cut = Math.max(1, known);
      svg += `<polyline class="ov-orbit__path" points="${line(0, cut)}"/>`;
      if (cut < pts.length) {
        svg += `<polyline class="ov-orbit__path ov-orbit__path--unbanded" points="${line(cut - 1, pts.length)}"/>`;
        if (!cone) notes.push(`UNCERTAINTY NOT GIVEN AFTER POINT ${cut}`);
        else if (!cone.refused) notes.push(`CONE NOT GIVEN AFTER POINT ${cut}`);
      }
      // Burns, the craft, the target.
      for (const q of pts) {
        if (q.burn) {
          svg += `<circle class="ov-orbit__burn" cx="${q.x.toFixed(1)}" cy="${(-q.y).toFixed(1)}" r="${(1.6 * k).toFixed(1)}"/>`
            + `<text class="ov-orbit__tag" x="${(q.x + 3 * k).toFixed(1)}" y="${(-q.y - 2.5 * k).toFixed(1)}" font-size="${(6 * k).toFixed(1)}">${String(q.burn).replace(/[<&]/g, '')}</text>`;
        }
      }
      const c = pts[0];
      svg += `<polygon class="ov-orbit__craft" points="${c.x},${-c.y - 2.4 * k} ${c.x + 2 * k},${-c.y + 1.6 * k} ${c.x - 2 * k},${-c.y + 1.6 * k}"/>`;
      if (r.target) {
        const t = r.target;
        svg += `<rect class="ov-orbit__target" x="${t.x - 1.8 * k}" y="${-t.y - 1.8 * k}" width="${3.6 * k}" height="${3.6 * k}"/>`
          + `<text class="ov-orbit__tag" x="${(t.x + 3.5 * k).toFixed(1)}" y="${(-t.y + 2 * k).toFixed(1)}" font-size="${(6 * k).toFixed(1)}">${String(t.label).replace(/[<&]/g, '')}</text>`;
      }
      // The horizon: a bar across the path's end, perpendicular to it.
      const z = pts[pts.length - 1], y0 = pts[pts.length - 2];
      let dx = z.x - y0.x, dy = z.y - y0.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const hx = -dy * 3.5 * k, hy = dx * 3.5 * k;
      svg += `<line class="ov-orbit__horizon" x1="${(z.x + hx).toFixed(1)}" y1="${(-(z.y + hy)).toFixed(1)}" `
        + `x2="${(z.x - hx).toFixed(1)}" y2="${(-(z.y - hy)).toFixed(1)}"/>`;
      notes.unshift(`HORIZON ${z.t !== null ? tplus(z.t) + ' · ' : ''}${r.horizon ? String(r.horizon).toUpperCase() : 'REASON NOT GIVEN'}`);
      if (cone && cone.refused) notes.push(`CONE NOT DRAWN: ${cone.refused}`);
      else if (cone) {
        notes.push(`CENTRE INSIDE EACH CIRCLE ${Math.round(cone.contains * 100)}% OF THE TIME · ${cone.basis.toUpperCase()}`);
        notes.push(`WHOLE PATH INSIDE ${cone.whole ? cone.whole.toUpperCase() : 'LESS OFTEN THAN THAT'}`);
        if (cone.solidUntil !== null && pts.slice(0, cone.coned).some((q) => q.t !== null && q.t > cone.solidUntil)) {
          notes.push(`STIPPLED AFTER ${tplus(cone.solidUntil)}: LESS CERTAIN`);
        }
      }
      if (cone) notes.push(`THE CONE IS WHERE THE CENTRE MAY GO, NOT ITS SIZE: EFFECTS ${cone.reach ? `REACH ${cone.reach.toUpperCase()}` : 'CAN REACH'} BEYOND IT`);
      if (r.off) notes.push(`${r.off} OF ${pts.length} POINTS OFF PLOT`);
      if (r.bad) notes.push(`${r.bad} POINTS WITHOUT A POSITION`);
      if (r.stale) notes.push(`PREDICTION ${Math.round(r.age)}s OLD`);
    }
    svg += '</svg>';

    this.innerHTML = `<div class="ov-orbit__head"><span class="ov-orbit__label"></span></div>${svg}`
      + `<div class="ov-orbit__notes"></div>`;
    this.querySelector('.ov-orbit__label').textContent = label;
    this.querySelector('.ov-orbit__notes').textContent = notes.join(' · ');

    // Refusal and qualifier through the shared protocol, so NO PREDICTION is
    // the kit's `unknown` and a stale prediction is the kit's `stale`.
    if (r.reason) apply(this, { reason: 'unknown' });
    else if (r.stale) apply(this, { text: notes[0].toLowerCase(), qualifier: 'stale', age: Math.round(r.age) });
    else apply(this, { text: notes[0].toLowerCase() });
    this.setAttribute('aria-label', [label || 'orbit plot', ...notes].join(', ').toLowerCase());
    this._r = r;
  }

  /* The area swept by the circles: each circle, and between consecutive
   * circles the quadrilateral of their outer tangents. Shapes of one kind
   * are filled opaque inside a translucent group, so where they overlap the
   * union stays one even tone. Circles and joins after `solidUntil` go in a
   * stippled group instead. */
  coneSvg(pts, solidUntil, k) {
    const late = (q) => solidUntil !== null && q.t !== null && q.t > solidUntil;
    const P = (q) => ({ x: q.x, y: -q.y, r: q.r });
    let solid = '', dots = '';
    const put = (shape, isLate) => { if (isLate) dots += shape; else solid += shape; };
    pts.forEach((q, i) => {
      const c = P(q);
      put(`<circle class="ov-orbit__circle" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r.toFixed(1)}"/>`, late(q));
      if (i === 0) return;
      const a = P(pts[i - 1]), b = c;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= Math.abs(a.r - b.r)) return;          // one circle holds the other
      const th = Math.atan2(b.y - a.y, b.x - a.x), ph = Math.acos((a.r - b.r) / d);
      const at = (o, s) => `${(o.x + o.r * Math.cos(th + s * ph)).toFixed(1)},${(o.y + o.r * Math.sin(th + s * ph)).toFixed(1)}`;
      put(`<polygon class="ov-orbit__join" points="${at(a, 1)} ${at(b, 1)} ${at(b, -1)} ${at(a, -1)}"/>`, late(q));
    });
    OvOrbit.seq = (OvOrbit.seq || 0) + 1;
    const id = `ov-orbit-stipple-${OvOrbit.seq}`;
    const step = (2.4 * k).toFixed(1), dot = (0.45 * k).toFixed(2);
    return (dots ? `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${step}" height="${step}">`
      + `<circle class="ov-orbit__stipple-dot" cx="${(step / 2).toFixed(1)}" cy="${(step / 2).toFixed(1)}" r="${dot}"/></pattern></defs>` : '')
      + (solid ? `<g class="ov-orbit__cone">${solid}</g>` : '')
      + (dots ? `<g class="ov-orbit__cone ov-orbit__cone--late" style="fill:url(#${id})">${dots}</g>` : '');
  }

  get report() {
    const r = this._r || this.resolve();
    if (r.reason) return { state: 'none', bad: r.bad ?? 0 };
    return {
      state: r.stale ? 'stale' : 'current',
      points: r.pts.length, banded: r.known, off: r.off, bad: r.bad,
      horizon: r.horizon, horizonT: r.pts[r.pts.length - 1].t, age: r.age,
      cone: r.cone ? { drawn: !r.cone.refused, refused: r.cone.refused, contains: r.cone.contains, coned: r.cone.coned } : null,
    };
  }
}

define('ov-orbit', OvOrbit);

export { OvOrbit };
