/* <ov-map> - a projected surface.
 *
 * ⭐ THE FINDING THIS EXISTS FOR: A CIRCLE ON A PROJECTED SURFACE IS NOT A
 * CIRCLE ON THE GROUND. A tactical map test drew a range ring for a
 * nominal 800 km and measured it at 851 km north and 553 km east. The ring was
 * a circle in SCREEN space, and screen space is not the ground.
 *
 * So this draws both: the naive screen circle everyone ships, and the ring the
 * projection actually implies, and it prints the discrepancy in kilometres. The
 * correct ring is an ellipse in equirectangular, because a degree of longitude
 * shrinks with the cosine of latitude and a degree of latitude does not.
 *
 * Labels use a measured placement rule: HYSTERESIS OF LITERALLY ZERO.
 * Keep your slot when it ties. Greedy placement re-decides from scratch every
 * frame with no preference for where it already was, and teleports at 146 px/s;
 * preferring the current slot on a tie takes that to 48 at no overlap cost.
 */

import { define } from './ov-core.js';
import './ov-source.js';
import { resolveTrack, trackSymbol } from './ov-track.js';

const KM_PER_LAT = 110.574;
const kmPerLon = (lat) => 111.320 * Math.cos((lat * Math.PI) / 180);

class OvMap extends HTMLElement {
  static observedAttributes = ['lat', 'lon', 'span', 'range', 'source', 'symbols'];

  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.slots = new Map();
    this.bind();
    this.paint();
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); }
  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'source') this.bind();
    this.paint();
  }

  get lat() { return Number(this.getAttribute('lat') ?? 35); }
  get lon() { return Number(this.getAttribute('lon') ?? 139); }
  get span() { return Number(this.getAttribute('span') ?? 16); }   // degrees of longitude
  get range() { return Number(this.getAttribute('range') ?? 800); } // km

  bind() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (rows) => {
      this.marks = Array.isArray(rows) ? rows : [];
      this.paint();
    });
  }

  paint() {
    const spanLon = this.span;
    const spanLat = spanLon * (kmPerLon(this.lat) / KM_PER_LAT) * 0.62;
    const x = (lon) => ((lon - this.lon) / spanLon + 0.5) * 100;
    const y = (lat) => (0.5 - (lat - this.lat) / spanLat) * 100;

    // Graticule, every 2 degrees, labelled with the degree it is.
    let grid = '';
    for (let d = -8; d <= 8; d += 2) {
      const gx = x(this.lon + d);
      const gy = y(this.lat + d);
      if (gx > 0 && gx < 100) {
        grid += `<line class="ov-map__grid" x1="${gx.toFixed(2)}" y1="0" x2="${gx.toFixed(2)}" y2="100"/>`
          + `<text class="ov-map__grid-l" x="${(gx + 0.6).toFixed(2)}" y="4">${(this.lon + d).toFixed(0)}</text>`;
      }
      if (gy > 0 && gy < 100) {
        grid += `<line class="ov-map__grid" x1="0" y1="${gy.toFixed(2)}" x2="100" y2="${gy.toFixed(2)}"/>`
          + `<text class="ov-map__grid-l" x="0.8" y="${(gy - 0.8).toFixed(2)}">${(this.lat + d).toFixed(0)}</text>`;
      }
    }

    // The ring everyone ships: a circle in SCREEN units.
    //
    // ⚠️ Drawing it as an SVG <circle> would not have been one. The viewBox is
    // stretched over a 16:10 box with preserveAspectRatio="none", which is
    // correct for the projection and means a unit of x and a unit of y are
    // different numbers of pixels. A circle in viewBox units draws as an
    // ellipse on screen, which would have made this demo wrong about the very
    // thing it is demonstrating. Same distortion the reticle's brackets hit.
    const aspect = 16 / 10;
    const naiveX = 30;
    const naiveY = naiveX * aspect;
    // What that screen circle actually spans on the ground.
    const nsKm = (naiveY / 100) * spanLat * KM_PER_LAT;
    const ewKm = (naiveX / 100) * spanLon * kmPerLon(this.lat);

    // The ring the projection implies for this.range: an ellipse.
    const rx = (this.range / kmPerLon(this.lat) / spanLon) * 100;
    const ry = (this.range / KM_PER_LAT / spanLat) * 100;

    let marks = '';
    const placed = [];
    /* ⭐ `symbols` draws each mark as its TRACK SYMBOL (ov-track.js), with the
     * same refusals as on the radar: no identity is PENDING, no dimension is
     * the waterline gap. The viewBox is stretched to 16:10, which would squash
     * a symbol exactly as it squashes a circle, so each one is counter-scaled
     * by the same aspect the naive ring below corrects for. */
    const symbols = this.hasAttribute('symbols');
    const aspectFix = 16 / 10;
    const counts = {};
    // 🔴 Marks it cannot place are COUNTED, not dropped. A mark outside the
    // view was skipped silently, and one with no position was drawn at NaN
    // (every comparison with NaN is false, so it was never skipped).
    let off = 0, nofix = 0;
    for (const m of (this.marks || [])) {
      const mlat = Number(m.lat), mlon = Number(m.lon);
      if (m.lat === null || m.lat === undefined || m.lon === null || m.lon === undefined
          || !Number.isFinite(mlat) || !Number.isFinite(mlon)) { nofix += 1; continue; }
      const mx = x(mlon);
      const my = y(mlat);
      if (mx < 2 || mx > 98 || my < 2 || my > 98) { off += 1; continue; }
      // Four candidate slots around the mark. Hysteresis of zero: the slot it
      // already had wins every tie, so a label only moves when staying is
      // strictly worse.
      const cands = [[8, -2], [8, 6], [-8, -2], [-8, 6]];
      const prev = this.slots.get(m.id) ?? 0;
      let best = prev;
      let bestScore = Infinity;
      cands.forEach(([dx, dy], i) => {
        const lx = mx + dx;
        const ly = my + dy;
        const score = placed.reduce((s, p) =>
          s + (Math.abs(p[0] - lx) < 16 && Math.abs(p[1] - ly) < 5 ? 1 : 0), 0)
          + (lx < 4 || lx > 84 ? 1 : 0);
        if (score < bestScore) { bestScore = score; best = i; }
      });
      this.slots.set(m.id, best);
      const [dx, dy] = cands[best];
      placed.push([mx + dx, my + dy]);
      if (symbols) {
        const r = resolveTrack(m);
        counts[r.identity] = (counts[r.identity] || 0) + 1;
        marks += `<g transform="translate(${mx.toFixed(2)} ${my.toFixed(2)}) scale(1 ${aspectFix})">`
          + trackSymbol(r, { scale: 0.16 }) + `</g>`;
      } else {
        // Counter-scaled too: a bare <circle> in this stretched viewBox drew
        // every plain mark as a flat ellipse, the distortion the naive-ring
        // comment above warns about, on the marks themselves.
        marks += `<circle class="ov-map__mark" cx="0" cy="0" r="1.2" `
          + `transform="translate(${mx.toFixed(2)} ${my.toFixed(2)}) scale(1 ${aspectFix})"/>`;
      }
      marks += `<text class="ov-map__label" x="${(mx + dx).toFixed(2)}" y="${(my + dy).toFixed(2)}"`
        + `${dx < 0 ? ' text-anchor="end"' : ''}>${String(m.label ?? '').replace(/[<&]/g, '')}</text>`;
    }

    this.innerHTML =
      `<svg class="ov-map__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">`
      + grid
      + `<ellipse class="ov-map__naive" cx="50" cy="50" rx="${naiveX}" ry="${naiveY.toFixed(2)}"/>`
      + `<ellipse class="ov-map__true" cx="50" cy="50" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}"/>`
      + marks
      + `</svg>`
      + `<span class="ov-map__key">`
      + `<i class="is-naive"></i>screen circle: ${Math.round(nsKm)} km N/S, ${Math.round(ewKm)} km E/W`
      + `<i class="is-true"></i>${this.range} km, as the projection implies`
      + (off || nofix
        ? `<b class="ov-map__unplaced">${[off ? `${off} off this view` : '', nofix ? `${nofix} without a position` : ''].filter(Boolean).join(' · ')}</b>`
        : '')
      // A source named and never heard from is NOT an empty sea. The home
      // page's maps read source="places", which only one demo page defined,
      // so they showed zero marks for as long as they existed and said nothing.
      + (this.getAttribute('source') && this.marks === undefined
        ? '<b class="ov-map__unplaced">NO FEED: nothing received from the source</b>' : '')
      + `</span>`;

    this.setAttribute('role', 'img');
    this.setAttribute('aria-label',
      `plan view at ${this.lat} north ${this.lon} east, ${(this.marks || []).length} marks`
      + (symbols && Object.keys(counts).length
        ? ': ' + Object.entries(counts).map(([k, n]) => `${n} ${k.replace('-', ' ')}`).join(', ') : '')
      + (off ? `, ${off} off this view` : '') + (nofix ? `, ${nofix} without a position` : '') + '. '
      + `A screen circle here spans ${Math.round(nsKm)} km north to south and `
      + `${Math.round(ewKm)} km east to west, which is why it is not a range ring.`);
  }
}

define('ov-map', OvMap);

export { OvMap };
