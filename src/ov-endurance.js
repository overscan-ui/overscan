/* <ov-endurance> - how long a consumable lasts, as a range, from what it is using.
 *
 * Remaining oxygen, battery, infusion volume or life-support
 * consumable divided by the rate it is being used. Not ov-countdown, which is
 * a clock that stops when its source is lost: this is an ESTIMATE derived from
 * a rate, and its honesty is in how it treats the rate.
 *
 * ⭐ THE REFUSAL: A RANGE FROM WHAT IS FLOWING, NEVER A COUNTDOWN FROM A
 * SETTING. The time left is drawn as a band, from the fastest recent rate to
 * the slowest, so an unsteady rate widens it; there is no line through the
 * middle to read as "the" answer, and a spread of zero says so ("every sample
 * the same") rather than being padded into a range nobody measured. And a
 * rate that is only SET or COMMANDED (what the dial says, not what is
 * flowing) gives no estimate at all: NOT ESTIMATED, rate is a setting.
 * Hamilton's own caveat on the calculation this replaces: "Note that this
 * calcuation [sic] provides you with an estimate only and the actual
 * consumption may be higher."
 *
 * Also refused, each in its own words: too few measured samples for a range
 * (below `min-samples`, default 3); no remaining amount; a rate at or below
 * zero (NOT DEPLETING, which is not "forever"). A remaining reading older than
 * `max-age` seconds is STALE, and the rate's source is always printed.
 *
 * Input, as the `supply` property or from `src`:
 *   { resource, unit, remaining, capacity?, age?,
 *     rate: { source: 'measured' | 'set' | 'commanded', unit?, samples?: [n, ...],
 *             value?, window? } }
 * rate samples are recent measured rates in `unit` per minute; `window` is a
 * label for the span they cover ("last 10 min").
 */

import { define } from './ov-core.js';

const endText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/* Minutes as a duration, floored: an estimate never rounds itself longer. */
const endDur = (min) => {
  if (!Number.isFinite(min)) return '?';
  if (min < 60) return `${Math.floor(min)}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${String(Math.floor(min % 60)).padStart(2, '0')}m`;
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
};
const endNum = (x) => (Number.isFinite(x) ? String(Number(x.toPrecision(4))) : '?');

class OvEndurance extends HTMLElement {
  static observedAttributes = ['src', 'min-samples', 'max-age'];

  connectedCallback() {
    this._supply = this._supply || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get supply() { return this._supply; }
  set supply(v) { this._supply = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._supply = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._supply = null;
    }
    this.paint();
  }

  /* { lo, hi } in minutes, or { refused: words }. Pure over the supply. */
  estimate(S, minSamples) {
    const rem = S.remaining === null || S.remaining === undefined ? NaN : Number(S.remaining);
    if (!Number.isFinite(rem) || rem < 0) return { refused: 'NO REMAINING AMOUNT' };
    const R = S.rate || {};
    if (R.source !== 'measured') {
      // ⭐ A setting is what someone asked for, not what is flowing.
      const what = R.source === 'set' || R.source === 'commanded' ? R.source.toUpperCase() : 'NOT STATED';
      return { refused: `NOT ESTIMATED: rate is ${what}, not measured` };
    }
    const xs = (Array.isArray(R.samples) ? R.samples : []).map(Number).filter(Number.isFinite);
    if (xs.length < minSamples) return { refused: `NOT ESTIMATED: ${xs.length} rate sample${xs.length === 1 ? '' : 's'}, below ${minSamples}` };
    const fast = Math.max(...xs), slow = Math.min(...xs);
    if (fast <= 0) return { refused: 'NOT DEPLETING: no use measured' };
    return {
      lo: rem / fast,
      // The slowest rate at or below zero means the supply may not run out
      // at all at that rate: the band is open on the right, not "forever".
      hi: slow > 0 ? rem / slow : Infinity,
      n: xs.length, fast, slow,
    };
  }

  paint() {
    const S = this._supply;
    this.removeAttribute('data-ov-refusal');
    if (!S) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.innerHTML = '<div class="ov-endurance__void">NO SUPPLY</div>';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'Endurance, no supply');
      return;
    }
    const rawMin = this.getAttribute('min-samples');
    const mv = rawMin === null ? NaN : Number(rawMin);
    const minSamples = Number.isInteger(mv) && mv >= 2 ? mv : 3;
    const rawAge = this.getAttribute('max-age');
    const av = rawAge === null ? NaN : Number(rawAge);
    const stale = Number.isFinite(av) && av > 0 && Number.isFinite(Number(S.age)) && Number(S.age) > av;
    const unit = S.unit || '';
    const rateUnit = (S.rate && S.rate.unit) || (unit ? `${unit}/min` : '/min');
    const E = this.estimate(S, minSamples);
    const name = endText(S.resource || 'SUPPLY');

    // Remaining against capacity, when there is one.
    const rem = Number(S.remaining), cap = Number(S.capacity);
    const fill = Number.isFinite(rem) && Number.isFinite(cap) && cap > 0 ? Math.max(0, Math.min(1, rem / cap)) : null;
    const tank = `<div class="ov-endurance__tank${fill === null ? ' is-nocap' : ''}"><i style="inline-size:${fill === null ? 0 : (fill * 100).toFixed(1)}%"></i></div>`;
    const remWords = Number.isFinite(rem)
      ? `${endNum(rem)} ${endText(unit)}${Number.isFinite(cap) ? ` of ${endNum(cap)}` : ''}${stale ? ` <b class="ov-endurance__stale">STALE ${Math.round(Number(S.age))}s</b>` : ''}`
      : '<b class="ov-endurance__stale">remaining unknown</b>';

    let band = '', head;
    const R = S.rate || {};
    const src = R.source === 'measured'
      ? `rate MEASURED${R.window ? `, ${endText(R.window)}` : ''}${E.n ? `, ${E.n} samples, ${E.slow === E.fast ? endNum(E.fast) : `${endNum(E.slow)} to ${endNum(E.fast)}`} ${endText(rateUnit)}` : ''}`
      : `rate ${R.source ? endText(String(R.source).toUpperCase()) : 'SOURCE NOT STATED'}${Number.isFinite(Number(R.value)) ? ` at ${endNum(Number(R.value))} ${endText(rateUnit)}` : ''}`;
    if (E.refused) {
      head = `<span class="ov-endurance__refused">${endText(E.refused)}</span>`;
      this.setAttribute('data-ov-refusal', 'unknown');
    } else {
      // A range as wide as the measured spread. When every sample is the
      // same the spread is zero, and it says that rather than padding it.
      const same = Number.isFinite(E.hi) && endDur(E.lo) === endDur(E.hi);
      head = same
        ? `<span class="ov-endurance__range">${endDur(E.lo)} <i>${E.fast === E.slow ? 'every sample the same' : 'spread under a minute'}</i></span>`
        : `<span class="ov-endurance__range">${endDur(E.lo)} <i>to</i> ${Number.isFinite(E.hi) ? endDur(E.hi) : 'not before the rate changes'}</span>`;
      // The band on a time axis from now: no midpoint, no line, just the spread.
      const W = 360, H = 30;
      const end = (Number.isFinite(E.hi) ? E.hi : E.lo * 3) * 1.15;
      const X = (m) => 8 + (m / end) * (W - 16);
      const ticks = [];
      const step = [5, 10, 15, 30, 60, 120, 240, 480, 720, 1440, 2880].find((s) => end / s <= 6) || 5760;
      for (let m = 0; m <= end; m += step) ticks.push(m);
      band = `<svg class="ov-endurance__band" viewBox="0 -8 ${W} ${H + 24}" aria-hidden="true">`
        + `<line class="ov-endurance__axis" x1="8" y1="${H}" x2="${W - 8}" y2="${H}"/>`
        + ticks.map((m) => `<line class="ov-endurance__tick" x1="${X(m).toFixed(1)}" y1="${H}" x2="${X(m).toFixed(1)}" y2="${H + 3}"/><text class="ov-endurance__text" x="${X(m).toFixed(1)}" y="${H + 11}" text-anchor="${m === 0 ? 'start' : 'middle'}">${m === 0 ? 'now' : `+${endDur(m)}`}</text>`).join('')
        + `<rect class="ov-endurance__spread${Number.isFinite(E.hi) ? '' : ' is-open'}" x="${X(E.lo).toFixed(1)}" y="6" width="${Math.max(2, (Number.isFinite(E.hi) ? X(E.hi) : W - 8) - X(E.lo)).toFixed(1)}" height="${H - 10}"/>`
        + `<line class="ov-endurance__edge" x1="${X(E.lo).toFixed(1)}" y1="4" x2="${X(E.lo).toFixed(1)}" y2="${H}"/>`
        + `<text class="ov-endurance__text is-edge" x="${X(E.lo).toFixed(1)}" y="3" text-anchor="middle">at fastest</text>`
        + '</svg>';
    }
    this.innerHTML = `<div class="ov-endurance__head"><span class="ov-endurance__name">${name}</span>${head}</div>`
      + `<div class="ov-endurance__rem">${tank}<span>${remWords}</span></div>`
      + band
      + `<div class="ov-endurance__src">${src}</div>`
      + (E.refused ? '' : '<div class="ov-endurance__note">an estimate: actual use may be higher</div>');
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `${S.resource || 'Supply'}: ${E.refused ? E.refused.toLowerCase() : `${endDur(E.lo)} to ${Number.isFinite(E.hi) ? endDur(E.hi) : 'open'}`}`);
  }
}

define('ov-endurance', OvEndurance);

export { OvEndurance };
