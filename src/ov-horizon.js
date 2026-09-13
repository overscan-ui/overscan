/* <ov-horizon> - attitude, speed and altitude, the way a flight display fails.
 *
 * The glass-cockpit primary flight display, and the HUDs
 * sci-fi borrows from it (Oblivion's bubbleship, Iron Man): a horizon with a
 * pitch ladder and bank scale, a speed tape on the left, altitude on the right.
 *
 * ⭐ THE REFUSAL: IT DOES NOT FREEZE. A frozen horizon looks EXACTLY like level
 * flight, which is why real displays remove it. When attitude is missing, or
 * older than `max-age` seconds, the whole sphere is blanked behind a red ATT
 * flag; a speed or altitude source that fails withdraws its ENTIRE tape behind
 * SPD or ALT rather than greying it and leaving it moving. (FlyByWire's A32NX
 * documentation of the Airbus flags: "the entire artificial horizon is cleared
 * to display the ATT flag".)
 *
 * Two more, from the same displays:
 *   CHECK ATT when this side's attitude and the cross-side's (`air.cross`)
 *   differ by more than `check` degrees. Neither is averaged into the other;
 *   the protocol's `disputed` qualifier, on an instrument.
 *   The altitude trend arrow is drawn only while vertical speed is valid: a
 *   trend from a dead rate source is a prediction nobody made.
 *
 * Input, as the `air` property or from a named `source`, one object per
 * reading, any field null when its source has failed:
 *   { pitch, roll, speed, altitude, vs, age, cross: { pitch, roll } }
 *   degrees (pitch up, roll right), knots, feet, feet per minute, seconds.
 */

import { define, Overscan } from './ov-core.js';
import './ov-source.js';

const HZ_PITCH_PX = 4;      /* px per degree of pitch at the 200-unit sphere */
const hzFinite = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

class OvHorizon extends HTMLElement {
  static observedAttributes = ['source', 'max-age', 'check'];

  connectedCallback() {
    this._air = this._air || null;
    this.innerHTML = `<svg class="ov-horizon__svg" viewBox="0 0 360 240" role="img"></svg>`
      + `<div class="ov-horizon__readout" aria-hidden="true"></div>`;
    this.svg = this.querySelector('svg');
    this.readout = this.querySelector('.ov-horizon__readout');
    this.clip = `ov-hz-${Math.random().toString(36).slice(2, 8)}`;
    this.bind();
    this.paint();
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); }

  attributeChangedCallback(n) {
    if (!this.svg) return;
    if (n === 'source') this.bind(); else this.paint();
  }

  get air() { return this._air; }
  set air(v) { this._air = v && typeof v === 'object' ? v : null; this.paint(); }

  bind() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !Overscan.subscribe) return;
    this.unsub = Overscan.subscribe(name, (v) => { this.air = v; });
  }

  /* One tape: a window on a scrolling scale. Withdrawn whole on failure. */
  tape(x, value, step, label, flag, right, trend) {
    const w = 52, top = 30, h = 180, mid = top + h / 2;
    let g = `<g class="ov-horizon__tape">`
      + `<rect class="ov-horizon__tapebg" x="${x}" y="${top}" width="${w}" height="${h}"/>`;
    if (!hzFinite(value)) {
      // The tape is WITHDRAWN: no scale, no window, no last value.
      return g + `<text class="ov-horizon__flag" x="${x + w / 2}" y="${mid + 5}" text-anchor="middle">${flag}</text></g>`;
    }
    const v = Number(value);
    const pxPer = 36 / step;                  /* one major step every 36 px */
    const first = Math.floor((v - (h / 2) / pxPer) / step) * step;
    for (let m = first; m <= v + (h / 2) / pxPer + step; m += step / 2) {
      const y = mid - (m - v) * pxPer;
      if (y < top + 2 || y > top + h - 2) continue;
      const major = Math.abs((m / step) - Math.round(m / step)) < 1e-6;
      const x1 = right ? x : x + w - (major ? 10 : 5);
      const x2 = right ? x + (major ? 10 : 5) : x + w;
      g += `<line class="ov-horizon__tick" x1="${x1}" y1="${y.toFixed(1)}" x2="${x2}" y2="${y.toFixed(1)}"/>`;
      if (major) {
        g += `<text class="ov-horizon__num" x="${right ? x + 14 : x + w - 14}" y="${(y + 3).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${Math.round(m)}</text>`;
      }
    }
    if (trend !== null) {
      // Ten seconds of climb or sink at the current rate, as an arrow.
      const dy = -(trend / 6) * pxPer;
      const tx = right ? x + 4 : x + w - 4;
      g += `<line class="ov-horizon__trend" x1="${tx}" y1="${mid}" x2="${tx}" y2="${(mid + Math.max(-h / 2 + 4, Math.min(h / 2 - 4, dy))).toFixed(1)}"/>`;
    }
    g += `<rect class="ov-horizon__window" x="${x - 2}" y="${mid - 11}" width="${w + 4}" height="22"/>`
      + `<text class="ov-horizon__value" x="${x + w / 2}" y="${mid + 5}" text-anchor="middle">${Math.round(v)}</text>`
      + `<text class="ov-horizon__unit" x="${x + w / 2}" y="${top - 6}" text-anchor="middle">${label}</text></g>`;
    return g;
  }

  paint() {
    if (!this.svg) return;
    const a = this._air || {};
    const maxAge = Number(this.getAttribute('max-age'));
    const stale = Number.isFinite(maxAge) && maxAge > 0 && hzFinite(a.age) && Number(a.age) > maxAge;
    const att = !stale && hzFinite(a.pitch) && hzFinite(a.roll);
    const spd = !stale && hzFinite(a.speed);
    const alt = !stale && hzFinite(a.altitude);
    const vs = alt && hzFinite(a.vs) ? Number(a.vs) : null;
    const lim = Number(this.getAttribute('check')) > 0 ? Number(this.getAttribute('check')) : 5;
    const x = a.cross || {};
    const disputed = att && hzFinite(x.pitch) && hzFinite(x.roll)
      && Math.max(Math.abs(x.pitch - a.pitch), Math.abs(x.roll - a.roll)) > lim;

    const cx = 180, cy = 120, R = 86;
    let g = `<defs><clipPath id="${this.clip}"><rect x="${cx - R}" y="${cy - R}" width="${2 * R}" height="${2 * R}" rx="10"/></clipPath></defs>`;
    g += `<g clip-path="url(#${this.clip})">`;
    if (att) {
      const p = Number(a.pitch), r = Number(a.roll);
      // Rotate by -roll about the aircraft symbol, then shift by pitch: the
      // world moves, the aircraft stays.
      g += `<g transform="rotate(${(-r).toFixed(2)} ${cx} ${cy}) translate(0 ${(p * HZ_PITCH_PX).toFixed(2)})">`
        + `<rect class="ov-horizon__sky" x="${cx - 400}" y="${cy - 800}" width="800" height="800"/>`
        + `<rect class="ov-horizon__ground" x="${cx - 400}" y="${cy}" width="800" height="800"/>`
        + `<line class="ov-horizon__line" x1="${cx - 400}" y1="${cy}" x2="${cx + 400}" y2="${cy}"/>`;
      for (let d = -30; d <= 30; d += 5) {
        if (!d) continue;
        const y = cy - d * HZ_PITCH_PX, half = d % 10 === 0 ? 28 : 12;
        g += `<line class="ov-horizon__rung" x1="${cx - half}" y1="${y}" x2="${cx + half}" y2="${y}"/>`;
        if (d % 10 === 0) g += `<text class="ov-horizon__num" x="${cx + half + 4}" y="${y + 3}">${Math.abs(d)}</text>`;
      }
      g += `</g>`;
    } else {
      // Blank, not frozen: the sphere shows NOTHING but the flag.
      g += `<rect class="ov-horizon__blank" x="${cx - R}" y="${cy - R}" width="${2 * R}" height="${2 * R}"/>`
        + `<rect class="ov-horizon__flagbox" x="${cx - 26}" y="${cy - 13}" width="52" height="26"/>`
        + `<text class="ov-horizon__flag" x="${cx}" y="${cy + 6}" text-anchor="middle">ATT</text>`;
    }
    g += `</g><rect class="ov-horizon__frame" x="${cx - R}" y="${cy - R}" width="${2 * R}" height="${2 * R}" rx="10"/>`;

    if (att) {
      // Bank scale: fixed marks, a pointer that turns with the roll.
      for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const t = (b - 90) * Math.PI / 180, r1 = R - 2, r2 = R - (b % 30 === 0 ? 12 : 7);
        g += `<line class="ov-horizon__tick" x1="${(cx + r1 * Math.cos(t)).toFixed(1)}" y1="${(cy + r1 * Math.sin(t)).toFixed(1)}" x2="${(cx + r2 * Math.cos(t)).toFixed(1)}" y2="${(cy + r2 * Math.sin(t)).toFixed(1)}"/>`;
      }
      g += `<path class="ov-horizon__bank" transform="rotate(${(-Number(a.roll)).toFixed(2)} ${cx} ${cy})" d="M${cx},${cy - R + 14} l-6,10 h12 z"/>`
        + `<path class="ov-horizon__aircraft" d="M${cx - 44},${cy} h26 l8,8 l8,-8 h26"/>`
        + `<rect class="ov-horizon__nose" x="${cx - 2}" y="${cy - 2}" width="4" height="4"/>`;
    }
    if (disputed) {
      // Low in the sphere, on its own box: over the bank scale it was unreadable.
      g += `<rect class="ov-horizon__checkbox" x="${cx - 40}" y="${cy + R - 30}" width="80" height="18"/>`
        + `<text class="ov-horizon__check" x="${cx}" y="${cy + R - 17}" text-anchor="middle">CHECK ATT</text>`;
    }
    g += this.tape(20, spd ? a.speed : null, 20, 'KT', 'SPD', false, null);
    g += this.tape(288, alt ? a.altitude : null, 500, 'FT', 'ALT', true, vs);
    this.svg.innerHTML = g;

    const words = [];
    words.push(att ? `pitch ${Math.round(a.pitch)}, roll ${Math.round(a.roll)}` : 'attitude flagged');
    words.push(spd ? `${Math.round(a.speed)} knots` : 'speed flagged');
    words.push(alt ? `${Math.round(a.altitude)} feet` : 'altitude flagged');
    if (stale) words.push(`data ${Math.round(a.age)} seconds old`);
    if (disputed) words.push('check attitude, sources disagree');
    this.readout.innerHTML = words.map((w) => `<span${/flagged|old|check/.test(w) ? ' class="is-flag"' : ''}>${w}</span>`).join('');
    this.toggleAttribute('data-ov-flagged', !att || !spd || !alt);
    if (disputed) this.setAttribute('data-ov-qualified', 'disputed'); else this.removeAttribute('data-ov-qualified');
    this.svg.setAttribute('aria-label', `Flight display, ${words.join(', ')}`);
  }
}

define('ov-horizon', OvHorizon);

export { OvHorizon };
