/* <ov-rangebar> - a bank of moving analog indicators, banked so normal lines up.
 *
 * ISA-101's "moving analog indicator" (Hollifield, The High
 * Performance HMI): a value against its normal band, alarm limits and trip
 * limits, and several of them side by side so that when everything is normal
 * the pointers sit in one row and an outlier shows in a glance, without
 * reading a single number. For industrial, terminal and aegis.
 *
 *   <ov-rangebar channels="FEED u:m3/h 0..200 n90..110 a70..130 t50..150 =104;
 *                          DRUM u:bar 0..10 n4..6 a3..7 t2..8 =6.8"></ov-rangebar>
 *   bank.channels = [{ label: 'FEED', unit: 'm3/h', min: 0, max: 200,
 *                      normal: [90, 110], alarm: [70, 130], trip: [50, 150],
 *                      value: 104 }];
 *
 * ── THE BANKING ───────────────────────────────────────────────────────────
 *
 * Each column's scale is LINEAR and centred on its own normal band, so the
 * middle of normal sits at the same height in every column and a bank of
 * healthy channels reads as one level row. The window is wide enough to hold
 * the whole instrument range; where the window runs past what the instrument
 * can measure, that part is hatched rather than drawn as scale, because a
 * scale mark where no reading is possible would be a claim the instrument
 * cannot make.
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 IT DOES NOT CLAMP. A value past the instrument's range is pinned at the
 * range end with an explicit OFF-SCALE mark, never drawn at the end as if that
 * were the reading, and the readout says `> 200`, not 200 and not the raw
 * number: past its range a transmitter is saturated, and the number it sends
 * is not a measurement. NASA's display standard (F.4.3.1) and NUREG-0700
 * (14.3-3) both require an off-scale indication; the rule is theirs, the
 * wording here is ours.
 *
 * Three more:
 * 1. BAD QUALITY REMOVES THE POINTER. A pointer is a reading; a bad or
 *    missing value draws no pointer at all and the readout says BAD or NO
 *    DATA. Never the last good position.
 * 2. STALE IS SHOWN AND MARKED, as everywhere in the kit: the pointer goes
 *    hollow and the readout carries its age.
 * 3. LIMITS ARE DECLARED, not inferred. A channel with no normal band cannot
 *    be banked, so it is drawn on its own plain scale and SAYS it is not
 *    banked, rather than being centred on a band nobody gave it.
 */

import { define } from './ov-core.js';
import { REASONS, upgrade } from './ov-refusal.js';
import './ov-source.js';

const FINITE = Number.isFinite;
const pair = (p) => (Array.isArray(p) && p.length === 2 && FINITE(+p[0]) && FINITE(+p[1]) && +p[0] < +p[1]
  ? [+p[0], +p[1]] : null);

/* One channel, from the attribute's text: `=v`, `tA..B`, `aA..B`, `nA..B`,
 * `A..B` (the instrument range) and `u:unit` in any order, and every other
 * word is the label, so a label may contain spaces. The unit is EXPLICIT: a
 * first cut guessed that the last free word was the unit, and "FEED PUMP"
 * became label FEED, unit PUMP. */
function parseChannel(text) {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  const c = { label: '', unit: '', min: null, max: null, normal: null, alarm: null, trip: null, value: undefined };
  const range = (s) => { const m = s.match(/^(-?[\d.]+)\.\.(-?[\d.]+)$/); return m ? [+m[1], +m[2]] : null; };
  const rest = [];
  for (const t of toks) {
    if (t.startsWith('=')) {
      const v = t.slice(1);
      c.value = v === '' || v === 'null' ? null : v === 'bad' ? 'bad' : v;
    } else if (/^[nat]-?[\d.]+\.\./.test(t)) {
      c[{ n: 'normal', a: 'alarm', t: 'trip' }[t[0]]] = range(t.slice(1));
    } else if (range(t)) {
      [c.min, c.max] = range(t);
    } else if (t.startsWith('u:')) {
      c.unit = t.slice(2);
    } else rest.push(t);
  }
  c.label = rest.join(' ');
  return c;
}

class OvRangebar extends HTMLElement {
  static observedAttributes = ['channels', 'source', 'max-age', 'label'];

  constructor() {
    super();
    this.list = [];
  }

  connectedCallback() {
    upgrade(this, ['channels']);
    if (!this.bank) this.build();
    if (this._channels === undefined) this.applyAttribute();
    this.bindSource();
    this.paint();
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); this.unsub = null; }

  attributeChangedCallback(name) {
    if (!this.bank) return;
    if (name === 'channels' && this._channels === undefined) this.applyAttribute();
    if (name === 'source') this.bindSource();
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label') || 'Range bank');
    this.paint();
  }

  build() {
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Range bank');
    this.bank = document.createElement('div');
    this.bank.className = 'ov-rangebar__bank';
    this.note = document.createElement('p');
    this.note.className = 'ov-rangebar__note';
    this.append(this.bank, this.note);
  }

  /* ---- INPUT ---------------------------------------------------------- */

  /* An ARRAY of channel objects, the whole bank, as every structured
   * property in the kit. A non-array is refused, and said. */
  set channels(list) {
    this._channels = list;
    this.rejected = null;
    if (Array.isArray(list)) this.load(list);
    else if (list !== undefined && list !== null) {
      this.rejected = 'channels ignored: not an array';
      this.load([]);
    } else this.load([]);
    this.paint();
  }

  get channels() {
    return this.list.map((c) => ({ ...c.decl, value: c.value, quality: c.quality, age: c.age }));
  }

  applyAttribute() {
    const raw = (this.getAttribute('channels') || '').trim();
    this.load(raw ? raw.split(';').map(parseChannel).filter((c) => c.label) : []);
  }

  load(list) {
    this.list = [];
    this.invalid = [];
    for (const d of list) {
      if (!d || typeof d !== 'object' || !d.label) continue;
      const min = +d.min, max = +d.max;
      if (!FINITE(min) || !FINITE(max) || max <= min) { this.invalid.push(String(d.label)); continue; }
      const c = {
        decl: { label: String(d.label), unit: d.unit || '', min, max,
          normal: pair(d.normal), alarm: pair(d.alarm), trip: pair(d.trip) },
        value: undefined, quality: 'good', age: null,
      };
      this.write(c, d.value, d.quality, d.age);
      this.list.push(c);
    }
  }

  /* One reading into a channel. `undefined` leaves it alone; `null` is a
   * dropout; 'bad' (or quality: 'bad') is bad quality. */
  write(c, value, quality, age) {
    if (value === undefined && quality === undefined) return;
    if (quality === 'bad' || value === 'bad') { c.value = null; c.quality = 'bad'; }
    else if (value === null) { c.value = null; c.quality = 'none'; }
    else if (value !== undefined) {
      const n = Number(value);
      if (FINITE(n)) { c.value = n; c.quality = 'good'; } else { c.value = null; c.quality = 'none'; }
    }
    c.age = FINITE(Number(age)) && age !== null && age !== undefined ? Number(age) : null;
  }

  /* Update values by label, e.g. from a source: [{ label, value, quality?, age? }].
   * A label with no channel is counted and said, never appended. */
  update(readings) {
    if (!Array.isArray(readings)) return;
    this.orphans = this.orphans || new Set();
    for (const r of readings) {
      const c = r && this.list.find((x) => x.decl.label === r.label);
      if (!c) { if (r && r.label) this.orphans.add(String(r.label)); continue; }
      this.write(c, r.value, r.quality, r.age);
    }
    this.paint();
  }

  bindSource() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !window.Overscan || !window.Overscan.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (reading) => {
      // A whole feed dropping out drops every channel out.
      if (reading === null || reading === undefined) {
        this.update(this.list.map((c) => ({ label: c.decl.label, value: null })));
      } else this.update(reading);
    });
  }

  /* ---- GEOMETRY ------------------------------------------------------- */

  /* The column's window: linear, centred on the middle of normal, wide
   * enough for the whole instrument range. Returns y(v) in 0..1, 0 at the
   * BOTTOM, and whether the channel is banked. */
  scale(c) {
    const { min, max, normal } = c.decl;
    if (!normal) {
      return { banked: false, lo: min, hi: max, y: (v) => (v - min) / (max - min) };
    }
    const mid = (normal[0] + normal[1]) / 2;
    const half = Math.max(mid - min, max - mid);
    const lo = mid - half, hi = mid + half;
    return { banked: true, lo, hi, y: (v) => (v - lo) / (hi - lo) };
  }

  /* What the reading means against the declared limits. */
  classify(c) {
    const { min, max, normal, alarm, trip } = c.decl;
    if (c.quality === 'bad') return 'bad';
    if (c.value === null || c.value === undefined) return 'none';
    const v = c.value;
    if (v > max) return 'off-hi';
    if (v < min) return 'off-lo';
    if (trip && (v <= trip[0] || v >= trip[1])) return 'trip';
    if (alarm && (v <= alarm[0] || v >= alarm[1])) return 'alarm';
    if (normal && (v < normal[0] || v > normal[1])) return 'off-normal';
    return 'normal';
  }

  /* ---- PAINT ---------------------------------------------------------- */

  paint() {
    if (!this.bank) return;
    this.bank.replaceChildren();
    // The column count, so the CSS can give the bank a DEFINITE preferred
    // width (one row). Without it a shrink-wrapping stage laid the bank out
    // at its narrowest, wrapped it, and the demo index scaled it to a sliver.
    this.style.setProperty('--ov-rangebar-n', String(Math.max(1, this.list.length)));
    const maxAge = Number(this.getAttribute('max-age'));
    let unbanked = 0;
    for (const c of this.list) {
      const s = this.scale(c);
      if (!s.banked) unbanked += 1;
      const state = this.classify(c);
      const stale = FINITE(maxAge) && maxAge > 0 && c.age !== null && c.age > maxAge
        && (state !== 'none' && state !== 'bad');

      const col = document.createElement('div');
      col.className = 'ov-rangebar__col';
      col.setAttribute('data-ov-state', state);
      col.toggleAttribute('data-ov-unbanked', !s.banked);
      if (stale) col.setAttribute('data-ov-qualified', 'stale');

      const name = document.createElement('span');
      name.className = 'ov-rangebar__label';
      name.textContent = c.decl.label;

      const track = document.createElement('div');
      track.className = 'ov-rangebar__track';
      const band = (cls, a, b) => {
        const e = document.createElement('span');
        e.className = `ov-rangebar__band ov-rangebar__band--${cls}`;
        const y0 = Math.max(0, Math.min(1, s.y(a))), y1 = Math.max(0, Math.min(1, s.y(b)));
        e.style.insetBlockEnd = `${(y0 * 100).toFixed(3)}%`;
        e.style.blockSize = `${((y1 - y0) * 100).toFixed(3)}%`;
        track.append(e);
      };
      // Beyond what the instrument can measure: hatched, not scale.
      if (s.y(c.decl.min) > 0) band('norange', s.lo, c.decl.min);
      if (s.y(c.decl.max) < 1) band('norange', c.decl.max, s.hi);
      const { trip, alarm, normal } = c.decl;
      if (trip) { band('trip', c.decl.min, trip[0]); band('trip', trip[1], c.decl.max); }
      if (alarm) {
        band('alarm', trip ? trip[0] : c.decl.min, alarm[0]);
        band('alarm', alarm[1], trip ? trip[1] : c.decl.max);
      }
      if (normal) band('normal', normal[0], normal[1]);

      // The pointer: none at all without a good reading.
      if (state !== 'none' && state !== 'bad') {
        const off = state === 'off-hi' || state === 'off-lo';
        const at = off ? (state === 'off-hi' ? c.decl.max : c.decl.min) : c.value;
        const p = document.createElement('span');
        p.className = 'ov-rangebar__pointer';
        p.style.insetBlockEnd = `${(s.y(at) * 100).toFixed(3)}%`;
        track.append(p);
        if (off) {
          const m = document.createElement('span');
          m.className = `ov-rangebar__off ov-rangebar__off--${state === 'off-hi' ? 'hi' : 'lo'}`;
          m.textContent = state === 'off-hi' ? '▲' : '▼';
          m.style.insetBlockEnd = `${(s.y(at) * 100).toFixed(3)}%`;
          track.append(m);
        }
      }

      const read = document.createElement('span');
      read.className = 'ov-rangebar__read';
      read.textContent = this.readout(c, state, stale);
      const unit = document.createElement('span');
      unit.className = 'ov-rangebar__unit';
      unit.textContent = c.decl.unit || '\u00a0';
      col.setAttribute('aria-label', this.describe(c, state, stale, s.banked));
      col.setAttribute('role', 'img');
      col.append(name, track, read, unit);
      this.bank.append(col);
    }

    const said = [];
    if (unbanked) said.push(`${unbanked} channel${unbanked > 1 ? 's' : ''} with no normal band: not banked`);
    if (this.invalid && this.invalid.length) said.push(`no valid instrument range: ${this.invalid.join(', ')}`);
    if (this.orphans && this.orphans.size) said.push(`readings for no channel: ${[...this.orphans].join(', ')}`);
    if (this.rejected) said.push(this.rejected);
    this.note.textContent = said.join(' · ');
    this.note.hidden = !said.length;
  }

  /* The number, at a precision the channel's range can carry: a 0-200
   * flow read to two decimals is noise dressed as accuracy. The unit goes on
   * its own line (see paint), so a column stays one pointer wide. */
  readout(c, state, stale) {
    if (state === 'bad') return 'BAD';
    if (state === 'none') return 'NO DATA';
    if (state === 'off-hi') return `> ${c.decl.max}`;
    if (state === 'off-lo') return `< ${c.decl.min}`;
    const span = c.decl.max - c.decl.min;
    const dp = span >= 100 ? 0 : span >= 10 ? 1 : 2;
    const txt = c.value.toFixed(dp);
    return stale ? `${txt} ${c.age}s` : txt;
  }

  describe(c, state, stale, banked) {
    const bits = [c.decl.label];
    if (state === 'bad') bits.push('bad quality, no reading');
    else if (state === 'none') bits.push(REASONS.unknown);
    else if (state === 'off-hi') bits.push(`off scale, above the instrument range of ${c.decl.min} to ${c.decl.max}`);
    else if (state === 'off-lo') bits.push(`off scale, below the instrument range of ${c.decl.min} to ${c.decl.max}`);
    else {
      bits.push(`${+c.value.toFixed(2)}${c.decl.unit ? ' ' + c.decl.unit : ''}`);
      bits.push({ normal: 'normal', 'off-normal': 'outside normal', alarm: 'in alarm', trip: 'at trip' }[state]);
    }
    if (stale) bits.push(`stale, ${c.age} seconds old`);
    if (!banked) bits.push('no normal band declared, not banked');
    return bits.join(', ');
  }
}

define('ov-rangebar', OvRangebar);

export { OvRangebar };
