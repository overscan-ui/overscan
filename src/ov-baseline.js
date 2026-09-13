/* <ov-baseline> - a reading, how far it is from a declared baseline, and
 * which way it is going.
 *
 * The IntelliVue horizon trend: a clinician sets a baseline
 * (a value or a range), and beside the live numeric sit a deviation bar and a
 * trend arrow over the last 2, 5 or 10 minutes. For antiseptic, holo, vector.
 *
 *   <ov-baseline label="HR" unit="bpm" value="84" scale="20"
 *                baseline="72" baseline-by="RN KOWALSKI" baseline-at="2026-09-11 14:02"
 *                baseline-method="entered" trend-window="300" trend-rate="2"></ov-baseline>
 *   hr.push(86);                 // a new reading, now
 *   hr.capture('DR OSEI');       // take the current reading as the baseline
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 THE ARROW'S ANGLE IS SET BY THE RATE, NEVER BY THE SCALE. The tilt is
 * the rate of change (units per minute, fitted over `trend-window`) as a
 * fraction of a declared `trend-rate`, the rate that means full tilt. The
 * deviation bar's `scale` plays no part in it, so re-scaling the display
 * cannot tip the arrow. The manufacturer's own IFU states the flaw this
 * refuses: "Be aware that changing the horizon trend scale can change the
 * angle of the trend indicator, without the patient's condition having
 * changed." (IntelliVue MX400-800 IFU, ch. 23 Trends, p. 323.)
 *
 * Three more:
 * 1. NO RATE DECLARED, NO ARROW. Without `trend-rate` the only reference an
 *    angle could have is the scale, which is the flaw above; the rate is
 *    still printed as a number.
 * 2. NO TREND FROM TOO LITTLE. The arrow needs readings that actually span
 *    the window (at least 80% of it, and three of them); short of that it
 *    says how much it has, rather than fitting a line to a moment.
 * 3. A BASELINE WITH NO AUTHOR, TIME OR METHOD IS REFUSED. Deviation from a
 *    reference nobody owns is deviation from a number, so the bar and the
 *    deviation are withheld and the missing fields named. `capture()` fills
 *    all three, and will not capture from a value that is stale or
 *    substituted: a baseline has to be a reading. The two methods are the
 *    IFU's own two ways in (ch. 23, p. 322): "Set Horizon" / "Set High
 *    Horizon" typed in (`entered`) and "Auto Horizon", "the currently-
 *    measured value" (`captured`). The IFU records neither who set it nor
 *    when; requiring both is this element's rule, not the product's.
 *
 * Opt-in: `max-baseline-age` (seconds). Past it the baseline is still used,
 * and MARKED, as a stale reading is: EXPIRED, with how long ago it was set.
 * A `baseline-at` that is not a time, or is in the future, gives an age that
 * cannot be known, and that is said too. Without the attribute a baseline
 * never expires: the kit does not invent a shift length.
 */

import { define } from './ov-core.js';
import { REASONS, staleness, upgrade } from './ov-refusal.js';

const BASELINE_NS = 'http://www.w3.org/2000/svg';
const METHODS = new Set(['entered', 'captured']);
const MAX_TILT = 60;

/* A finite number from an attribute's text, or null. */
function baselineNumber(raw) {
  const n = Number(raw);
  return raw !== null && String(raw).trim() !== '' && Number.isFinite(n) ? n : null;
}

class OvBaseline extends HTMLElement {
  static observedAttributes = ['value', 'unit', 'label', 'scale', 'baseline', 'baseline-by', 'baseline-at',
    'baseline-method', 'max-baseline-age', 'trend-window', 'trend-rate', 'age', 'max-age', 'substituted'];

  constructor() {
    super();
    this.history = [];
  }

  connectedCallback() {
    upgrade(this, ['samples']);
    if (!this.num) this.build();
    if (!this.history.length && this._samples === undefined) this.sample(this.getAttribute('value'));
    this.paint();
  }

  disconnectedCallback() { clearTimeout(this.expiry); }

  attributeChangedCallback(name, _was, now) {
    if (!this.num) return;
    // Every write to `value` is a reading, even the same number again: a
    // steady value is data for the trend, not a non-event.
    if (name === 'value') this.sample(now);
    this.paint();
  }

  /* ---- READ ----------------------------------------------------------- */

  windowOf() { const w = baselineNumber(this.getAttribute('trend-window')); return w !== null && w > 0 ? w : 300; }
  rateOf() { const r = baselineNumber(this.getAttribute('trend-rate')); return r !== null && r > 0 ? r : null; }
  scaleOf() { const s = baselineNumber(this.getAttribute('scale')); return s !== null && s > 0 ? s : null; }
  maxBaselineAgeOf() { const m = baselineNumber(this.getAttribute('max-baseline-age')); return m !== null && m > 0 ? m : null; }

  /* `baseline-at` as epoch ms: "YYYY-MM-DD HH:MM[:SS]" is LOCAL time (how a
   * person writes it on a ward), anything else goes to Date.parse. */
  baselineTime(at) {
    const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/.exec(at);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    const t = Date.parse(at);
    return Number.isFinite(t) ? t : null;
  }

  /* "72" or "68..76" -> { lo, hi }, or null. */
  baselineOf() {
    const raw = (this.getAttribute('baseline') || '').trim();
    if (!raw) return null;
    const m = raw.split('..');
    const lo = Number(m[0]), hi = Number(m.length > 1 ? m[1] : m[0]);
    if (m.length > 2 || m[0].trim() === '' || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return { bad: raw };
    return { lo, hi };
  }

  /* Who, when, how. Returns { by, at, method, missing: [...] }. */
  provenance() {
    const by = (this.getAttribute('baseline-by') || '').trim();
    const at = (this.getAttribute('baseline-at') || '').trim();
    const method = (this.getAttribute('baseline-method') || '').trim().toLowerCase();
    const missing = [];
    if (!by) missing.push('author');
    if (!at) missing.push('time');
    if (!METHODS.has(method)) missing.push('method');
    return { by, at, method, missing };
  }

  /* ---- BUILD ---------------------------------------------------------- */

  build() {
    this.setAttribute('role', 'group');
    const div = (cls, tag = 'div') => { const e = document.createElement(tag); e.className = `ov-baseline__${cls}`; return e; };
    this.head = div('head');
    this.nameEl = div('name', 'span');
    this.unitEl = div('unit', 'span');
    this.head.append(this.nameEl, this.unitEl);
    this.main = div('main');
    this.num = div('num', 'span');
    this.qual = div('qual', 'span');
    this.arrow = document.createElementNS(BASELINE_NS, 'svg');
    this.arrow.setAttribute('viewBox', '-12 -12 24 24');
    this.arrow.setAttribute('class', 'ov-baseline__arrow');
    this.arrow.setAttribute('aria-hidden', 'true');
    this.arrowG = document.createElementNS(BASELINE_NS, 'g');
    const shaft = document.createElementNS(BASELINE_NS, 'path');
    shaft.setAttribute('d', 'M-9,0 L6,0 M1,-5 L7,0 L1,5');
    this.arrowG.append(shaft);
    const ring = document.createElementNS(BASELINE_NS, 'circle');
    ring.setAttribute('r', '11');
    ring.setAttribute('class', 'ov-baseline__ring');
    this.arrow.append(ring, this.arrowG);
    this.dev = div('dev', 'span');
    this.main.append(this.num, this.qual, this.arrow, this.dev);
    this.bar = div('bar');
    this.bar.setAttribute('aria-hidden', 'true');
    this.fill = div('fill', 'i');
    this.zero = div('zero', 'i');
    this.lo = div('end', 'span');
    this.hi = div('end', 'span');
    this.lo.classList.add('ov-baseline__end--lo');
    this.hi.classList.add('ov-baseline__end--hi');
    this.bar.append(this.fill, this.zero, this.lo, this.hi);
    // Divs, not <p>: the kit's CSS is layered, so a page's own paragraph
    // rule outranks it, and on the reference page these set as body copy.
    this.base = div('base');
    this.trend = div('trend');
    this.note = div('note', 'p');
    this.append(this.head, this.main, this.bar, this.base, this.trend, this.note);
  }

  /* ---- INPUT ---------------------------------------------------------- */

  sample(raw, at) {
    const n = Number(raw);
    if (raw === null || raw === undefined || String(raw).trim() === '' || !Number.isFinite(n)) return;
    this.history.push({ t: at ?? performance.now(), v: n });
    // Keep what the longest window could want, and no more.
    const keep = performance.now() - this.windowOf() * 1000 * 1.5;
    while (this.history.length > 2 && this.history[0].t < keep) this.history.shift();
  }

  /* A new reading, now. Sets `value`, so the attribute stays the truth. */
  push(value) {
    this.setAttribute('value', String(value));
  }

  /* History as an ARRAY of { age, value }: `age` seconds ago. Replaces. */
  set samples(list) {
    this._samples = list;
    this.rejected = null;
    this.history = [];
    if (Array.isArray(list)) {
      const now = performance.now();
      const rows = list.filter((s) => s && Number.isFinite(+s.age) && Number.isFinite(+s.value))
        .map((s) => ({ t: now - Number(s.age) * 1000, v: Number(s.value) }))
        .sort((a, b) => a.t - b.t);
      this.history = rows;
    } else if (list !== undefined && list !== null) {
      this.rejected = 'samples ignored: not an array of { age, value }';
    }
    if (this.num) this.paint();
  }

  get samples() {
    const now = performance.now();
    return this.history.map((s) => ({ age: +((now - s.t) / 1000).toFixed(3), value: s.v }));
  }

  /* Take the current reading as the baseline. Returns { ok, reason? }. */
  capture(by) {
    const who = (by === undefined || by === null ? '' : String(by)).trim();
    const raw = this.getAttribute('value');
    let reason = null;
    if (!who) reason = 'a baseline needs an author';
    else if (raw === null || !Number.isFinite(Number(raw)) || String(raw).trim() === '') reason = `nothing to capture: ${REASONS.unknown}`;
    else {
      const q = staleness(this, raw);
      if (q && (q.qualifier === 'substituted' || q.qualifier === 'stale')) {
        reason = `cannot capture a ${q.qualifier} value: a baseline has to be a reading`;
      }
    }
    if (reason) {
      this.refusedCapture = reason;
      this.dispatchEvent(new CustomEvent('ov:refuse', { detail: { reason }, bubbles: true }));
      this.paint();
      return { ok: false, reason };
    }
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const at = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    this.refusedCapture = null;
    this.setAttribute('baseline', String(Number(raw)));
    this.setAttribute('baseline-by', who);
    this.setAttribute('baseline-at', at);
    this.setAttribute('baseline-method', 'captured');
    this.dispatchEvent(new CustomEvent('ov:baseline', {
      detail: { value: Number(raw), by: who, at, method: 'captured' }, bubbles: true,
    }));
    return { ok: true };
  }

  /* ---- DERIVED -------------------------------------------------------- */

  /* Least-squares rate over the window, units per MINUTE. Refuses short
   * coverage: returns { rate } or { refused, have }. */
  rate() {
    const w = this.windowOf();
    const now = performance.now();
    const pts = this.history.filter((s) => now - s.t <= w * 1000 + 1);
    const span = pts.length ? (now - pts[0].t) / 1000 : 0;
    if (pts.length < 3 || span < w * 0.8) return { refused: true, have: span, n: pts.length };
    const xs = pts.map((s) => (s.t - now) / 60000), ys = pts.map((s) => s.v);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    return { rate: sxx > 0 ? sxy / sxx : 0 };
  }

  /* 🔴 The only inputs are the rate and the declared full-tilt rate. */
  angleFor(rate, full) {
    return Math.max(-1, Math.min(1, rate / full)) * MAX_TILT;
  }

  /* ---- PAINT ---------------------------------------------------------- */

  paint() {
    if (!this.num) return;
    const fmt = (v) => `${+v.toFixed(2)}`;
    const sgn = (v) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '0');
    const mins = (s) => (s % 60 === 0 ? `${s / 60} min` : s >= 60 ? `${fmt(s / 60)} min` : `${fmt(s)} s`);
    const unit = this.getAttribute('unit') || '';
    const u = unit ? ` ${unit}` : '';
    const said = [];

    this.nameEl.textContent = this.getAttribute('label') || '';
    this.unitEl.textContent = unit;

    // The reading.
    const raw = this.getAttribute('value');
    const v = raw === null || String(raw).trim() === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
    const q = v === null ? null : staleness(this, raw);
    this.num.textContent = v === null ? '---' : fmt(v);
    this.qual.textContent = !q ? '' : q.qualifier === 'stale' ? `STALE ${q.age}s`
      : q.qualifier === 'frozen' ? `FROZEN ${q.held}s` : q.qualifier === 'substituted' ? 'SUBST' : '';
    this.qual.hidden = !this.qual.textContent;
    this.setAttribute('data-ov-qualifier', q ? q.qualifier : 'none');
    if (v === null) said.push(`value: ${REASONS.unknown}`);

    // The baseline, and whether it may be used at all.
    const b = this.baselineOf();
    const pv = this.provenance();
    let dev = null, baseState;
    if (!b) baseState = 'none';
    else if (b.bad) baseState = 'bad';
    else if (pv.missing.length) baseState = 'refused';
    else baseState = 'ok';
    // Expiry, opt-in. The baseline stays in use; only its age is judged.
    const maxAge = this.maxBaselineAgeOf();
    let aged = null;
    clearTimeout(this.expiry);
    if (baseState === 'ok' && maxAge !== null) {
      const t = this.baselineTime(pv.at);
      const nowMs = Date.now();
      if (t === null) aged = { unknown: 'baseline-at is not a time' };
      else if (t > nowMs + 60000) aged = { unknown: 'baseline-at is in the future' };
      else {
        const age = Math.max(0, (nowMs - t) / 1000);
        if (age > maxAge) { aged = { age }; baseState = 'expired'; }
        else if (this.isConnected) this.expiry = setTimeout(() => this.paint(), (maxAge - age) * 1000 + 50);
      }
    }
    this.setAttribute('data-ov-baseline', baseState);
    const bText = b && !b.bad ? (b.lo === b.hi ? fmt(b.lo) : `${fmt(b.lo)}–${fmt(b.hi)}`) : '';
    if (baseState === 'none') this.base.textContent = 'NO BASELINE SET';
    else if (baseState === 'bad') this.base.textContent = `BASELINE UNREADABLE: "${b.bad}"`;
    else if (baseState === 'refused') {
      this.base.textContent = `BASELINE ${bText}${u} REFUSED: NO ${pv.missing.map((m) => m.toUpperCase()).join(', NO ')}`;
      said.push(`a baseline with no ${pv.missing.join(', no ')} is not used: deviation from a reference nobody owns is deviation from a number`);
    } else {
      const ago = (sec) => (sec >= 5400 ? `${+(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 60)} min`);
      this.base.textContent = `BASELINE ${bText}${u} · ${pv.method.toUpperCase()} BY ${pv.by} · ${pv.at}`
        + (baseState === 'expired' ? ` · EXPIRED, SET ${ago(aged.age)} AGO (MAX ${ago(maxAge)})` : '')
        + (aged && aged.unknown ? ' · AGE UNKNOWN' : '');
      if (baseState === 'expired') said.push(`the baseline is older than its ${ago(maxAge)} limit: deviation is shown against it, marked`);
      if (aged && aged.unknown) said.push(`baseline age cannot be judged: ${aged.unknown}`);
    }
    this.toggleAttribute('data-ov-baseline-age-unknown', !!(aged && aged.unknown));
    if ((baseState === 'ok' || baseState === 'expired') && v !== null) dev = v < b.lo ? v - b.lo : v > b.hi ? v - b.hi : 0;

    // Deviation: a number, and a bar only against a declared scale.
    const scale = this.scaleOf();
    if (dev === null) {
      this.dev.textContent = baseState === 'ok' || baseState === 'expired' ? '' : 'NO DEVIATION';
    } else if (b.lo !== b.hi && dev === 0) {
      this.dev.textContent = baseState === 'expired' ? 'IN EXPIRED BASELINE RANGE' : 'IN BASELINE RANGE';
    } else {
      this.dev.textContent = `${sgn(dev)}${u} VS ${baseState === 'expired' ? 'EXPIRED ' : ''}BASELINE`;
    }
    const barOn = dev !== null && scale !== null;
    this.bar.hidden = !barOn;
    if (barOn) {
      const f = Math.max(-1, Math.min(1, dev / scale));
      this.fill.style.setProperty('--ov-baseline-from', `${50 + Math.min(0, f) * 50}%`);
      this.fill.style.setProperty('--ov-baseline-to', `${50 + Math.max(0, f) * 50}%`);
      this.lo.textContent = `−${fmt(scale)}`;
      this.hi.textContent = `+${fmt(scale)}`;
      this.bar.toggleAttribute('data-ov-over', Math.abs(dev) > scale);
      this.bar.setAttribute('data-ov-fraction', f.toFixed(4));
    }
    if (dev !== null && scale === null) said.push('no scale declared: deviation is given as a number only');
    if (barOn && Math.abs(dev) > scale) said.push(`deviation ${sgn(dev)} is past the bar's ±${fmt(scale)}`);

    // The trend.
    const w = this.windowOf();
    const full = this.rateOf();
    const r = this.rate();
    let trendState;
    if (r.refused) {
      trendState = 'short';
      this.trend.textContent = `TREND ${mins(w)}: NOT ENOUGH READINGS (${mins(Math.floor(r.have))} OF ${mins(w)}, ${r.n} READING${r.n === 1 ? '' : 'S'})`;
    } else {
      const rateText = `${sgn(r.rate)}${u}/min over ${mins(w)}`.toUpperCase();
      if (full === null) {
        trendState = 'norate';
        this.trend.textContent = `TREND ${rateText} · NO ARROW: NO TREND RATE DECLARED`;
        said.push('no trend-rate declared: an arrow angle would have only the display scale to go by, so none is drawn');
      } else {
        trendState = 'ok';
        this.trend.textContent = `TREND ${rateText} · FULL TILT AT ±${fmt(full)}${u}/min`;
      }
    }
    this.setAttribute('data-ov-trend', trendState);
    if (trendState === 'ok') {
      const angle = this.angleFor(r.rate, full);
      // SVG y runs down: rotating by −angle tips the arrow UP for a rise.
      this.arrowG.setAttribute('transform', `rotate(${(-angle).toFixed(2)})`);
      this.arrow.setAttribute('data-ov-angle', angle.toFixed(2));
      this.arrow.toggleAttribute('data-ov-full', Math.abs(r.rate) >= full);
      this.arrow.removeAttribute('hidden');
    } else {
      this.arrow.removeAttribute('data-ov-angle');
      // ⚠️ An ATTRIBUTE, not `.hidden = true`: `hidden` is an HTML property,
      // and on an SVG element that line only made an expando. The arrow
      // stayed drawn while the tests, reading the same expando, passed.
      this.arrow.setAttribute('hidden', '');
    }

    if (this.refusedCapture) said.push(`capture refused: ${this.refusedCapture}`);
    if (this.rejected) said.push(this.rejected);
    this.note.textContent = said.join(' · ');
    this.note.hidden = !said.length;

    const label = this.getAttribute('label') || 'Reading';
    this.setAttribute('aria-label', `${label}: ${v === null ? REASONS.unknown : `${fmt(v)}${u}`}`
      + (this.qual.textContent ? `, ${this.qual.textContent.toLowerCase()}` : '')
      + (dev !== null ? `, ${this.dev.textContent.toLowerCase()}` : baseState === 'refused' ? ', baseline refused' : '')
      + `, ${this.trend.textContent.toLowerCase()}`);
  }
}

define('ov-baseline', OvBaseline);

export { OvBaseline };
