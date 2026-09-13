/* <ov-timestack> - one event in every time it has, and how each was got.
 *
 * A spacecraft event has several times at once: the
 * spacecraft clock count (SCLK), when it happened (spacecraft event time,
 * SCET), how long the signal took to arrive (one-way light time, OWLT), and
 * when a station received it (earth-received time, ERT). ov-downlink shows a
 * message's age and ov-countdown one clock; neither says how a timestamp was
 * derived.
 *
 * ⭐ THE REFUSAL: RECEIPT TIME IS NOT EVENT TIME. The event slot holds SCET
 * only. With no SCET given, it is computed as ERT − OWLT (the stated relation)
 * and labelled as computed; with no light time either, it reads NOT
 * DETERMINED, and the receipt time stays in its own row as a receipt. Showing
 * ERT as when it happened moves every deep-space event by the light time,
 * which at Mars is up to twenty minutes.
 *
 * And A CONVERSION PAST ITS KERNEL IS PROVISIONAL. A time converted with a
 * clock correlation or leapseconds kernel is only as good as the kernel's
 * coverage. A converted time later than the kernel's `validThrough`, or more
 * than six months past the last leapsecond entry (NAIF: conversions "more than
 * six months ahead of the last leapsecond listed may result in an error"), is
 * marked PROVISIONAL with the kernel named. A time with no stated derivation
 * says so.
 *
 * When SCET, ERT and OWLT are all given and SCET differs from ERT − OWLT by
 * more than `tolerance` milliseconds (default 1000), the event time is
 * DISPUTED, with the difference: two sources are shown, not averaged.
 *
 * Input, as the `stamp` property or from `src`:
 *   { event, sclk?: { value, derived? },
 *     scet?: { value: ISO, derived?, kernel?, validThrough?: ISO },
 *     owlt?: { seconds, derived?, kernel? },
 *     ert?:  { value: ISO, derived?, station? },
 *     leapseconds?: { kernel, lastEntry: ISO } }
 */

import { define } from './ov-core.js';

const tstkText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TSTK_HALF_YEAR = 183 * 86400e3;
const tstkMs = (iso) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : NaN; };
/* UTC to the millisecond, the way the stack prints every instant. */
const tstkIso = (ms) => new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC');
const tstkDur = (s) => {
  const a = Math.abs(s);
  if (a < 60) return `${a.toFixed(3)} s`;
  const m = Math.floor(a / 60), r = a - m * 60;
  return m < 60 ? `${m}m ${r.toFixed(1)}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

class OvTimestack extends HTMLElement {
  static observedAttributes = ['src', 'tolerance'];

  connectedCallback() {
    this._stamp = this._stamp || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get stamp() { return this._stamp; }
  set stamp(v) { this._stamp = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._stamp = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._stamp = null;
    }
    this.paint();
  }

  /* Why a converted time is provisional, or null. */
  provisional(ms, entry, leap) {
    const why = [];
    const valid = tstkMs(entry && entry.validThrough);
    if (Number.isFinite(valid) && ms > valid) {
      why.push(`extrapolated past ${entry.kernel || 'its kernel'}, valid through ${tstkIso(valid).slice(0, 10)}`);
    }
    const last = tstkMs(leap && leap.lastEntry);
    if (Number.isFinite(last) && ms > last + TSTK_HALF_YEAR) {
      why.push(`more than six months past the last leapsecond in ${leap.kernel || 'the leapseconds kernel'}`);
    }
    return why.length ? why.join('; ') : null;
  }

  paint() {
    const S = this._stamp;
    this.removeAttribute('data-ov-refusal');
    if (!S || !(S.sclk || S.scet || S.ert)) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.innerHTML = '<div class="ov-timestack__void">NO TIMES</div>';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'Event times, none');
      return;
    }
    const rawTol = this.getAttribute('tolerance');
    const tv = rawTol === null ? NaN : Number(rawTol);
    const tol = Number.isFinite(tv) && tv >= 0 ? tv : 1000;
    const leap = S.leapseconds || null;
    const scetMs = tstkMs(S.scet && S.scet.value);
    const ertMs = tstkMs(S.ert && S.ert.value);
    const owlt = S.owlt && Number.isFinite(Number(S.owlt.seconds)) ? Number(S.owlt.seconds) : NaN;
    const computed = Number.isFinite(ertMs) && Number.isFinite(owlt) ? ertMs - owlt * 1000 : NaN;

    // The event time, and what stands behind it.
    let event;
    if (Number.isFinite(scetMs)) {
      const diff = Number.isFinite(computed) ? scetMs - computed : NaN;
      event = { ms: scetMs, how: S.scet.derived || null, kernel: S.scet.kernel || null,
        prov: this.provisional(scetMs, S.scet, leap),
        disputed: Number.isFinite(diff) && Math.abs(diff) > tol ? diff : null };
    } else if (Number.isFinite(computed)) {
      event = { ms: computed, how: 'computed: ERT − OWLT', kernel: S.owlt.kernel || null,
        prov: this.provisional(computed, S.owlt, leap), computed: true };
    } else {
      event = null;   // ⭐ receipt is not event: NOT DETERMINED
    }

    const row = (sys, value, how, dep, cls = '', note = '') => `<div class="ov-timestack__row ${cls}" data-system="${sys}">`
      + `<span class="ov-timestack__sys">${sys}</span>`
      + `<span class="ov-timestack__value">${value}</span>`
      + `<span class="ov-timestack__how">${how ? tstkText(how) : '<i class="is-flag">derivation not stated</i>'}</span>`
      + `<span class="ov-timestack__dep">${dep ? tstkText(dep) : ''}</span>`
      + (note ? `<span class="ov-timestack__note">${note}</span>` : '') + '</div>';

    let rows = '';
    if (S.sclk) rows += row('SCLK', tstkText(S.sclk.value ?? '?'), S.sclk.derived || 'spacecraft clock count', null);
    if (event) {
      const marks = [];
      if (event.prov) marks.push(`<b class="ov-timestack__mark is-provisional">PROVISIONAL</b> ${tstkText(event.prov)}`);
      if (event.disputed !== null && event.disputed !== undefined) {
        marks.push(`<b class="ov-timestack__mark is-disputed">DISPUTED</b> SCET and ERT − OWLT differ by ${tstkText(tstkDur(event.disputed / 1000))}; both shown, neither averaged`);
      }
      rows += row('SCET', tstkText(tstkIso(event.ms)), event.how, event.kernel,
        `is-event${event.prov ? ' is-provisional' : ''}${event.disputed !== null && event.disputed !== undefined ? ' is-disputed' : ''}${event.computed ? ' is-computed' : ''}`, marks.join('<br>'));
      if (event.disputed !== null && event.disputed !== undefined) {
        rows += row('ERT−OWLT', tstkText(tstkIso(computed)), 'computed: ERT − OWLT', S.owlt.kernel || null, 'is-alt');
      }
    } else {
      rows += row('SCET', '<b class="ov-timestack__mark is-none">NOT DETERMINED</b>', 'receipt time is not event time, and there is no light time to subtract', null, 'is-event is-none');
    }
    if (Number.isFinite(owlt)) rows += row('OWLT', tstkText(tstkDur(owlt)), S.owlt.derived || null, S.owlt.kernel || null);
    if (Number.isFinite(ertMs)) {
      rows += row('ERT', tstkText(tstkIso(ertMs)), S.ert.derived || null, S.ert.station || null, 'is-receipt', 'received, not when it happened');
    }

    const label = S.event ? tstkText(S.event) : 'EVENT';
    const head = event
      ? `${label} <span class="ov-timestack__at">at SCET ${tstkText(tstkIso(event.ms))}</span>${event.prov ? ' <b class="ov-timestack__mark is-provisional">PROVISIONAL</b>' : ''}${event.disputed !== null && event.disputed !== undefined ? ' <b class="ov-timestack__mark is-disputed">DISPUTED</b>' : ''}`
      : `${label} <span class="ov-timestack__at">event time NOT DETERMINED</span>`;
    this.innerHTML = `<div class="ov-timestack__head">${head}</div><div class="ov-timestack__rows">${rows}</div>`;
    this.setAttribute('data-ov-event', !event ? 'undetermined' : event.disputed !== null && event.disputed !== undefined ? 'disputed' : event.prov ? 'provisional' : event.computed ? 'computed' : 'stated');
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `${S.event || 'Event'}: ${event ? `event time ${tstkIso(event.ms)}` : 'event time not determined'}`);
  }
}

define('ov-timestack', OvTimestack);

export { OvTimestack };
