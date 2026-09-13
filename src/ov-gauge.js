/* <ov-gauge> - an analog dial, drawn in the DOM.
 *
 * A canvas gauge library can take ZERO CSS rules and 43 constructor
 * arguments: the library that already looks right is the one that hurts,
 * because a canvas widget is invisible to the cascade and therefore to the
 * theme, the contrast switch and the motion switch. On a composite surface
 * every kit-wide behaviour then has to be built twice, and covers half the
 * screen.
 *
 * This is the same instrument in SVG. It takes no constructor arguments and no
 * theme object, because everything it looks like already lives in the tokens.
 *
 * The needle obeys the refusal protocol. A value past the scale does not park
 * quietly at the limit, which would read as a legitimate maximum: the needle
 * pins and the dial is marked over-range. A dial with no reading shows no
 * needle at all, because a needle at zero is a reading.
 */

import { define } from './ov-core.js';
import './ov-source.js';
import './ov-refusal.js';

const TAU = Math.PI / 180;

class OvGauge extends HTMLElement {
  static observedAttributes = ['value', 'min', 'max', 'unit', 'ticks', 'source', 'sweep',
    'deadband', 'frozen-after', 'substituted'];

  connectedCallback() {
    this.bindSource(); this.render(); window.OverscanRefusal.upgrade(this, ['value']); }
  disconnectedCallback() { if (this.unsub) this.unsub(); }
  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'source') this.bindSource();
    this.render();
  }

  bindSource() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (reading) => {
      const v = (reading && typeof reading === 'object') ? reading.value : reading;
      if (v === null || v === undefined) this.removeAttribute('value');
      else this.setAttribute('value', Number(v).toFixed(1));
    });
  }

  get lo() { return Number(this.getAttribute('min') ?? 0); }
  get hi() { return Number(this.getAttribute('max') ?? 100); }
  get sweep() { return Number(this.getAttribute('sweep') || 240); }

  point(frac, r) {
    const a = (-90 - this.sweep / 2 + frac * this.sweep) * TAU;
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
  }

  arc(r) {
    const [x0, y0] = this.point(0, r);
    const [x1, y1] = this.point(1, r);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 `
      + `${this.sweep > 180 ? 1 : 0},1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }

  render() {
    const raw = window.OverscanRefusal.rawOf(this, 'value');
    const n = Number(raw);
    const has = raw !== null && raw !== '' && Number.isFinite(n);
    const over = has && (n > this.hi || n < this.lo);
    const frac = has ? Math.max(0, Math.min(1, (n - this.lo) / ((this.hi - this.lo) || 1))) : 0;

    const count = Math.max(2, parseInt(this.getAttribute('ticks') || '5', 10));
    let ticks = '';
    for (let i = 0; i < count; i++) {
      const f = i / (count - 1);
      const [ax, ay] = this.point(f, 38);
      const [bx, by] = this.point(f, 44);
      ticks += `<line class="ov-gauge__tick" x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" `
        + `x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}"/>`;
      // Every tick names a value the dial actually reaches.
      const [tx, ty] = this.point(f, 31);
      const label = Math.round(this.lo + f * (this.hi - this.lo));
      ticks += `<text class="ov-gauge__ticklabel" x="${tx.toFixed(2)}" `
        + `y="${(ty + 1.6).toFixed(2)}">${label}</text>`;
    }

    let needle = '';
    if (has) {
      const [nx, ny] = this.point(frac, 34);
      needle = `<line class="ov-gauge__needle" x1="50" y1="50" `
        + `x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}"/>`
        + `<circle class="ov-gauge__hub" cx="50" cy="50" r="2.4"/>`;
    }

    this.innerHTML =
      `<svg class="ov-gauge__svg" viewBox="0 0 100 100" aria-hidden="true">`
      + `<path class="ov-gauge__arc" d="${this.arc(44)}"/>`
      + ticks + needle + '</svg>'
      + `<span class="ov-gauge__read">${has ? raw : ''}</span>`
      + `<span class="ov-gauge__unit">${this.getAttribute('unit') || ''}</span>`;

    this.toggleAttribute('data-ov-over', over);
    /* A gauge marks staleness like every other readout. It cannot go through
     * common(), which would refuse an over-range value instead of showing it
     * over-range, so it asks for the staleness rule directly. */
    const stale = has ? window.OverscanRefusal.staleness(this, raw) : null;
    window.OverscanRefusal.apply(this,
      has ? (stale || { text: raw }) : { reason: 'unknown' },
      this.getAttribute('unit'));
    if (over) {
      this.setAttribute('aria-label',
        `${raw}${this.getAttribute('unit') ? ' ' + this.getAttribute('unit') : ''}, `
        + `past the scale of ${this.lo} to ${this.hi}`
        // The qualifier's own words, as apply() just wrote them: `stale` is
        // only one of the three states staleness() can return, and naming a
        // substituted or frozen value "stale" was a false claim in the name.
        + (stale ? `, ${this.getAttribute('data-ov-qualifier-text')}` : ''));
    }
  }
}

window.OverscanRefusal.prop(OvGauge, 'value');
define('ov-gauge', OvGauge);

export { OvGauge };
