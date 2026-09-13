/* <ov-dose> - a programmed dose against the drug library's limits, and whether it was checked at all.
 *
 * The running screen of a smart infusion pump: the dose or
 * rate as entered, the drug library's soft and hard limits for it, and which
 * library and care area did the checking. Not ov-rangebar, which puts a
 * process value against bands: this is an ENTRY, and its provenance is the
 * point. A number on a pump screen looks the same whether a library checked
 * it or nobody did.
 *
 * ⭐ THE REFUSAL: A DOSE NOBODY CHECKED NEVER LOOKS IN RANGE. Programmed with
 * no drug library ("basic mode"), the dose is shown as entered and marked
 * UNCHECKED, and no scale is drawn, because a scale with the dose inside it is
 * a claim that someone compared the two. STATED, ISMP 2020 1.3: pumps should
 * "make it obvious when operating outside DERS"; ISMP Canada 2023: "when the
 * drug library and DERS are bypassed, the smart pump is unable to identify
 * any pump programming errors." ISMP 2020: "Healthcare clinicians should not
 * view the dose-checking feature of smart pumps as an option that can be
 * turned on or off." ISMP Canada's case is a fatal overdose in basic mode,
 * "programmed in terms of "mg/min" (milligrams per minute) instead of "mg/h"".
 *
 * And, each in its own words:
 * - A dose in one unit is never compared with limits in another. There is no
 *   conversion here: NOT COMPARED, and both units are printed.
 * - A per-kg dose with no weight is NOT CHECKED: the limit applies to a dose
 *   the weight has not given.
 * - Past a SOFT limit the dose waits for an acknowledgement (STATED: soft
 *   limits "allow users to start the infusion as programmed once the alert
 *   has been acknowledged"). Once overridden it stays marked on the running
 *   screen for as long as it runs, with who and why, or REASON NOT RECORDED:
 *   ISMP requires no reason and notes most pumps "cannot record the reason".
 *   The marking itself is INFERRED; the sources count overrides afterwards.
 * - Past a HARD limit it is BLOCKED and says REPROGRAM. STATED: hard limits
 *   "cannot be overridden"; ISMP Canada, they "require reprogramming". An
 *   acknowledgement handed in for one is not honoured, and says so.
 * - The library version and care area are always printed, since "the correct
 *   care area/profile ... must be manually selected" and the pump "cannot
 *   prevent ... incorrect DERS library selections"; a library that is not the
 *   `current` one says so (INFERRED from ISMP's version-currency measure).
 * - Limits handed in without a library, and any `status` or `inRange`, are
 *   counted and not used: the verdict is derived here or not at all.
 *
 * Not yet: bolus and loading doses, which ISMP says need "separate hard
 * limits"; concentration and rate limits beside the dose's.
 *
 * Input, as the `order` property or from `src`:
 *   { drug, concentration?, dose: { value, unit }, rate?: { value, unit },
 *     weight?: { value, unit?, source? },
 *     library?: { version, area, current? },      // absent or null = basic mode
 *     limits?: { unit, hardLow?, softLow?, softHigh?, hardHigh? },
 *     acknowledged?: { by?, reason?, at? } }
 * Units compare as written, ignoring case and spaces, and nothing else.
 */

import { define } from './ov-core.js';

const doseText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const doseNum = (x) => (Number.isFinite(x) ? String(Number(x.toPrecision(4))) : '?');
const doseUnit = (u) => String(u ?? '').replace(/\s+/g, '').toLowerCase();
const doseVal = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));

class OvDose extends HTMLElement {
  static observedAttributes = ['src'];

  connectedCallback() {
    this._order = this._order || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.fetchSrc();
  }

  get order() { return this._order; }
  set order(v) { this._order = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._order = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._order = null;
    }
    this.paint();
  }

  /* The verdict, derived from the order alone. Pure. */
  check(O) {
    const ignored = ['status', 'inRange', 'checked'].filter((k) => k in O);
    const value = doseVal(O.dose && O.dose.value);
    const unit = O.dose && O.dose.unit ? String(O.dose.unit) : '';
    if (!Number.isFinite(value) || value < 0) return { state: 'none', words: 'NO DOSE ENTERED', ignored };
    const L = O.limits && typeof O.limits === 'object' ? O.limits : null;
    const lib = O.library && typeof O.library === 'object' && O.library.version ? O.library : null;
    if (!lib) {
      if (L) ignored.push('limits');
      return { state: 'unchecked', words: 'UNCHECKED: NO DRUG LIBRARY (BASIC MODE)', value, unit, ignored };
    }
    const lim = {};
    for (const k of ['hardLow', 'softLow', 'softHigh', 'hardHigh']) {
      const x = doseVal(L && L[k]);
      if (Number.isFinite(x)) lim[k] = x;
    }
    if (!L || !Object.keys(lim).length) return { state: 'unchecked', words: 'UNCHECKED: NO LIMITS FOR THIS DRUG IN THE LIBRARY', value, unit, lib, ignored };
    if (doseUnit(L.unit) !== doseUnit(unit)) {
      return { state: 'uncompared', words: `NOT COMPARED: LIMITS IN ${L.unit ? String(L.unit) : 'NO UNIT'}, DOSE IN ${unit || 'NO UNIT'}`, value, unit, lib, ignored };
    }
    if (/\/kg\b/i.test(unit) && !(doseVal(O.weight && O.weight.value) > 0)) {
      return { state: 'uncompared', words: 'NOT CHECKED: A PER-KG DOSE WITH NO WEIGHT', value, unit, lib, ignored };
    }
    const ack = O.acknowledged && typeof O.acknowledged === 'object' ? O.acknowledged : null;
    const base = { value, unit, lib, lim, ignored };
    if (lim.hardHigh !== undefined && value > lim.hardHigh) return { ...base, state: 'blocked', side: 'high', words: 'BLOCKED: ABOVE THE HARD LIMIT, REPROGRAM', ackRefused: !!ack };
    if (lim.hardLow !== undefined && value < lim.hardLow) return { ...base, state: 'blocked', side: 'low', words: 'BLOCKED: BELOW THE HARD LIMIT, REPROGRAM', ackRefused: !!ack };
    const soft = lim.softHigh !== undefined && value > lim.softHigh ? 'high' : lim.softLow !== undefined && value < lim.softLow ? 'low' : null;
    if (soft) {
      const where = soft === 'high' ? 'ABOVE' : 'BELOW';
      if (!ack) return { ...base, state: 'hold', side: soft, words: `HOLD: ${where} THE SOFT LIMIT, NOT ACKNOWLEDGED` };
      return { ...base, state: 'overridden', side: soft, words: `SOFT LIMIT OVERRIDDEN: ${where}`, ack };
    }
    return { ...base, state: 'within', words: 'WITHIN LIMITS' };
  }

  /* The limit scale: zones from zero to past the furthest mark, and the dose. */
  scale(C) {
    const { lim, value } = C;
    const marks = [...Object.values(lim), value];
    const end = Math.max(...marks) * 1.15 || 1;
    const P = (x) => `${Math.max(0, Math.min(100, (x / end) * 100)).toFixed(2)}%`;
    const zones = [
      ['hard', 0, lim.hardLow],
      ['soft', lim.hardLow ?? 0, lim.softLow],
      ['ok', lim.softLow ?? lim.hardLow ?? 0, lim.softHigh ?? lim.hardHigh ?? end],
      ['soft', lim.softHigh, lim.hardHigh ?? end],
      ['hard', lim.hardHigh, end],
    ].filter(([, a, b]) => a !== undefined && b !== undefined && b > a);
    const ticks = Object.entries(lim).map(([k, x]) => `<i class="ov-dose__tick is-${k.startsWith('hard') ? 'hard' : 'soft'}" style="inset-inline-start:${P(x)}"></i>`).join('');
    const say = (a, b, what) => (a !== undefined || b !== undefined
      ? `${what} ${a !== undefined ? doseNum(a) : 'none'} to ${b !== undefined ? doseNum(b) : 'none'}`
      : `no ${what} limits`);
    return `<div class="ov-dose__scale" aria-hidden="true">${zones.map(([z, a, b]) => `<i class="ov-dose__zone is-${z}" style="inset-inline-start:${P(a)};inline-size:calc(${P(b)} - ${P(a)})"></i>`).join('')}`
      + `${ticks}<i class="ov-dose__mark" style="inset-inline-start:${P(value)}"></i></div>`
      + `<div class="ov-dose__limits">${say(lim.softLow, lim.softHigh, 'soft')} · ${say(lim.hardLow, lim.hardHigh, 'hard')} ${doseText(C.unit)}</div>`;
  }

  paint() {
    const O = this._order;
    this.removeAttribute('data-ov-refusal');
    this.setAttribute('role', 'img');
    if (!O) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.setAttribute('data-ov-dose', 'none');
      this.innerHTML = '<div class="ov-dose__void">NO ORDER</div>';
      this.setAttribute('aria-label', 'Dose, no order');
      this._c = { state: 'none' };
      return;
    }
    const C = this.check(O);
    this._c = C;
    this.setAttribute('data-ov-dose', C.state);
    // The check is the reading here: a check that could not be made is the
    // kit's unknown, though the entered dose is still shown as entered.
    if (C.state === 'unchecked' || C.state === 'uncompared' || C.state === 'none') this.setAttribute('data-ov-refusal', 'unknown');
    const drug = doseText(O.drug || 'DRUG NOT NAMED');
    const rate = O.rate && Number.isFinite(doseVal(O.rate.value)) ? ` <span class="ov-dose__rate">at ${doseNum(doseVal(O.rate.value))} ${doseText(O.rate.unit || '')}</span>` : '';
    const value = C.state === 'none' ? '' : `<div class="ov-dose__value"><b>${doseNum(C.value)}</b> ${doseText(C.unit || 'NO UNIT')}${rate}</div>`;
    const compared = ['within', 'hold', 'overridden', 'blocked'].includes(C.state);
    let extra = '';
    if (C.state === 'overridden') {
      const a = C.ack;
      extra += `<div class="ov-dose__override">OVERRIDDEN${a.by ? ` BY ${doseText(String(a.by).toUpperCase())}` : ', BY WHOM NOT GIVEN'}${a.at ? ` AT ${doseText(a.at)}` : ''} · ${a.reason ? doseText(String(a.reason).toUpperCase()) : 'REASON NOT RECORDED'}</div>`;
    }
    if (C.ackRefused) extra += '<div class="ov-dose__override is-refused">AN ACKNOWLEDGEMENT CANNOT BYPASS A HARD LIMIT: NOT HONOURED</div>';
    const lib = C.lib
      ? `library ${doseText(C.lib.version)}${C.lib.current && String(C.lib.current) !== String(C.lib.version) ? ` <b class="ov-dose__old">NOT THE CURRENT LIBRARY (${doseText(C.lib.current)})</b>` : ''} · care area ${C.lib.area ? doseText(C.lib.area) : '<b class="ov-dose__old">NOT STATED</b>'}`
      : 'no drug library';
    const W = O.weight && doseVal(O.weight.value) > 0
      ? ` · weight ${doseNum(doseVal(O.weight.value))} ${doseText(O.weight.unit || 'kg')}${O.weight.source ? `, ${doseText(O.weight.source)}` : ', source not stated'}` : '';
    const ign = C.ignored && C.ignored.length ? `<div class="ov-dose__note">handed in and not used: ${C.ignored.map(doseText).join(', ')}</div>` : '';
    this.innerHTML = `<div class="ov-dose__head"><span class="ov-dose__drug">${drug}</span>${O.concentration ? `<span class="ov-dose__conc">${doseText(O.concentration)}</span>` : ''}</div>`
      + value
      + `<div class="ov-dose__verdict">${doseText(C.words)}</div>`
      + (compared ? this.scale(C) : '')
      + extra
      + `<div class="ov-dose__src">${lib}${W}</div>`
      + ign;
    this.setAttribute('aria-label', `${O.drug || 'Drug'}: ${C.state === 'none' ? 'no dose entered' : `${doseNum(C.value)} ${C.unit}`}, ${C.words.toLowerCase()}`);
  }

  get report() { return this._c || null; }
}

define('ov-dose', OvDose);

export { OvDose };
