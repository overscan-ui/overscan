/* <ov-allocator> - a fixed supply split across consumers, commanded vs confirmed.
 *
 * FTL's reactor bars, Elite Dangerous' power pips, Star
 * Citizen's power triangle; setpoint sliders in the TUI kits. For industrial
 * and cyber. An INPUT control, so it sits next to ov-hold and ov-dial.
 *
 *   <ov-allocator capacity="12" damaged="2" timeout="2500"
 *                 consumers="SHIELDS:6, ENGINES:6, WEAPONS:6, O2:3"
 *                 commanded="SHIELDS=4, ENGINES=3" readback="SHIELDS=4, ENGINES=1">
 *   </ov-allocator>
 *   alloc.readback = [{ label: 'ENGINES', value: 3 }];   // the system answering
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 THE REQUEST IS NOT THE STATE. A unit is drawn FILLED only when the
 * system's readback says it is delivered; a unit someone asked for and the
 * system has not confirmed is drawn HOLLOW, and the row says PENDING. It is
 * ov-procedure's claimed vs sensed, applied to a setpoint: every power slider
 * that moves the bar the instant you drag it has drawn your intention as a
 * fact.
 *
 * Three more:
 * 1. NO ALLOCATION IS DRAWN LARGER THAN THE CAPACITY THAT EXISTS. Damaged
 *    units are their own band, subtracted from what is available. What the
 *    system confirms it is delivering is a FACT and is never un-funded; the
 *    capacity it leaves funds pending increases top row first, and any
 *    request it cannot fund is drawn UNFUNDED (hatched), never as allocated.
 *    The rule is stated in the note, not hidden.
 * 2. A READBACK THAT NEVER COMES IS NOT AGREEMENT. Past `timeout` a pending
 *    row reads NO READBACK (no answer) or MISMATCH (an answer that
 *    disagrees). Neither ever settles to the commanded value on its own.
 * 3. THE REFUSAL IS SHOWN BEFORE THE PRESS. With no free capacity the +
 *    button is marked unavailable and the row says why; pressing it anyway
 *    is refused, counted, and fires ov:refuse.
 */

import { define } from './ov-core.js';
import { REASONS, upgrade } from './ov-refusal.js';

const INT = (v) => (Number.isFinite(+v) ? Math.max(0, Math.floor(+v)) : null);

/* "LABEL=3, OTHER=2" -> [{label, value}], values as text for coercion later.
 * An entry with no "=" is counted, not guessed at. */
function pairs(raw, bad) {
  const out = [];
  for (const part of (raw || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const at = t.lastIndexOf('=');
    if (at < 1) { bad.n += 1; continue; }
    const v = t.slice(at + 1).trim();
    out.push({ label: t.slice(0, at).trim(), value: v === '' || v === 'null' ? null : v });
  }
  return out;
}

class OvAllocator extends HTMLElement {
  static observedAttributes = ['capacity', 'damaged', 'consumers', 'commanded', 'readback', 'timeout', 'label'];

  constructor() {
    super();
    this.rows = [];
    this.refused = 0;
  }

  connectedCallback() {
    upgrade(this, ['readback']);
    const first = !this.body;
    if (first) this.build();
    this.layout();
    if (first) { this.applyCommanded(); this.applyReadback(); }
    this.paint();
  }

  disconnectedCallback() { clearTimeout(this.timer); }

  attributeChangedCallback(name) {
    if (!this.body) return;
    if (name === 'consumers') this.layout();
    if (name === 'commanded') this.applyCommanded();
    if (name === 'readback') this.applyReadback();
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label') || 'Power allocation');
    this.paint();
  }

  /* ---- READ ----------------------------------------------------------- */

  capacityOf() { return INT(this.getAttribute('capacity')) ?? 0; }
  damagedOf() { return Math.min(this.capacityOf(), INT(this.getAttribute('damaged')) ?? 0); }
  availableOf() { return this.capacityOf() - this.damagedOf(); }
  timeoutOf() { const t = Number(this.getAttribute('timeout')); return Number.isFinite(t) && t > 0 ? t : 2500; }

  /* ---- BUILD ---------------------------------------------------------- */

  build() {
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Power allocation');
    this.supply = document.createElement('div');
    this.supply.className = 'ov-allocator__supply';
    this.pool = document.createElement('div');
    this.pool.className = 'ov-allocator__pool';
    this.pool.setAttribute('aria-hidden', 'true');
    this.sum = document.createElement('span');
    this.sum.className = 'ov-allocator__sum';
    this.sum.setAttribute('role', 'status');
    this.supply.append(this.pool, this.sum);
    this.body = document.createElement('div');
    this.body.className = 'ov-allocator__rows';
    this.note = document.createElement('p');
    this.note.className = 'ov-allocator__note';
    this.append(this.supply, this.body, this.note);
  }

  /* One row per declared consumer, `LABEL:max`. State survives a
   * re-declaration by label. */
  layout() {
    const old = new Map(this.rows.map((r) => [r.label, r]));
    this.rows = [];
    this.body.replaceChildren();
    for (const part of (this.getAttribute('consumers') || '').split(',')) {
      const t = part.trim();
      if (!t) continue;
      const at = t.lastIndexOf(':');
      const label = (at > 0 ? t.slice(0, at) : t).trim();
      if (!label || this.rows.some((r) => r.label === label)) continue;
      const max = at > 0 ? INT(t.slice(at + 1)) : null;
      const r = old.get(label) || { label, commanded: 0, readback: undefined, since: null, age: null };
      r.max = max ?? this.capacityOf();
      this.rows.push(r);

      const row = document.createElement('div');
      row.className = 'ov-allocator__row';
      const name = document.createElement('span');
      name.className = 'ov-allocator__label';
      name.textContent = label;
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'ov-btn ov-allocator__minus';
      minus.textContent = '−';
      minus.setAttribute('aria-label', `release one unit from ${label}`);
      minus.addEventListener('click', () => this.command(label, r.commanded - 1));
      const pips = document.createElement('span');
      pips.className = 'ov-allocator__pips';
      pips.setAttribute('aria-hidden', 'true');
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'ov-btn ov-allocator__plus';
      plus.textContent = '+';
      plus.setAttribute('aria-label', `request one more unit for ${label}`);
      plus.addEventListener('click', () => this.command(label, r.commanded + 1));
      const state = document.createElement('span');
      state.className = 'ov-allocator__state';
      const why = document.createElement('span');
      why.className = 'ov-allocator__why';
      row.append(name, minus, pips, plus, state, why);
      this.body.append(row);
      r.el = { row, minus, plus, pips, state, why };
    }
  }

  /* ---- INPUT ---------------------------------------------------------- */

  /* The operator's request. Returns { ok, reason }. */
  command(label, n) {
    const r = this.rows.find((x) => x.label === label);
    if (!r) return { ok: false, reason: 'no such consumer' };
    const want = Math.max(0, Math.floor(n));
    if (want === r.commanded) return { ok: false, reason: 'no change' };
    if (want > r.max) return this.refuse(r, `${label} takes at most ${r.max}`);
    const others = this.rows.reduce((s, x) => s + (x === r ? 0 : x.commanded), 0);
    // An increase that the available capacity cannot fund is refused here,
    // before it is ever drawn. A DECREASE is always allowed: releasing load
    // is how an operator gets back under a capacity that damage has cut.
    if (want > r.commanded && others + want > this.availableOf()) {
      return this.refuse(r, `no free capacity: ${this.availableOf()} available`
        + (this.damagedOf() ? ` (${this.damagedOf()} damaged)` : ''));
    }
    r.commanded = want;
    r.since = performance.now();
    this.dispatchEvent(new CustomEvent('ov:allocate', { detail: { label, commanded: want }, bubbles: true }));
    this.paint();
    return { ok: true };
  }

  refuse(r, reason) {
    this.refused += 1;
    this.dispatchEvent(new CustomEvent('ov:refuse', { detail: { consumer: r.label, reason }, bubbles: true }));
    r.el.row.removeAttribute('data-ov-refused');
    void r.el.row.offsetWidth;
    r.el.row.setAttribute('data-ov-refused', '');
    setTimeout(() => r.el.row.removeAttribute('data-ov-refused'), 700);
    this.paint();
    return { ok: false, reason };
  }

  /* The system's answer: a list of { label, value, age? }. `undefined`
   * leaves a row alone, `null` is a dropout. An ARRAY, as every structured
   * property in the kit. */
  set readback(list) {
    this._readback = list;
    this.rejected = null;
    if (Array.isArray(list)) {
      for (const x of list) {
        const r = x && this.rows.find((y) => y.label === x.label);
        if (!r || x.value === undefined) continue;
        r.readback = x.value === null ? null : INT(x.value);
        r.age = Number.isFinite(+x.age) && x.age !== null ? +x.age : null;
      }
    } else if (list !== undefined && list !== null) {
      this.rejected = 'readback ignored: not an array of { label, value }';
    }
    this.paint();
  }

  get readback() {
    return this.rows.map((r) => ({ label: r.label, value: r.readback === undefined ? null : r.readback }));
  }

  applyCommanded() {
    const bad = { n: 0 };
    for (const { label, value } of pairs(this.getAttribute('commanded'), bad)) {
      const r = this.rows.find((x) => x.label === label);
      if (r && value !== null) { r.commanded = Math.min(r.max, INT(value) ?? 0); r.since = performance.now(); }
    }
    this.malformed = (this.malformed || 0) + bad.n;
  }

  applyReadback() {
    const bad = { n: 0 };
    const list = pairs(this.getAttribute('readback'), bad);
    this.malformed = (this.malformed || 0) + bad.n;
    if (list.length) this.readback = list;
  }

  /* ---- DERIVED -------------------------------------------------------- */

  /* What the capacity can fund. CONFIRMED DELIVERY IS A FACT and is never
   * called unfunded: the capacity it leaves funds the PENDING increases
   * (commanded beyond confirmed), top row first, and only those can go
   * unfunded.
   * ⚠️ The first cut funded COMMANDS top-down, and a consumer the system was
   * confirmably delivering to read "2/2 CONFIRMED, 2 UNFUNDED": the display
   * contradicting the readback it exists to respect. */
  funding() {
    const rb = (r) => (r.readback === null || r.readback === undefined ? 0 : r.readback);
    let left = this.availableOf() - this.rows.reduce((t, r) => t + rb(r), 0);
    const out = new Map();
    for (const r of this.rows) {
      const base = Math.min(rb(r), r.commanded);
      const pending = r.commanded - base;
      const funded = Math.min(pending, Math.max(0, left));
      left -= funded;
      out.set(r, { base, funded, unfunded: pending - funded });
    }
    return out;
  }

  stateOf(r, now) {
    const late = r.since !== null && now - r.since >= this.timeoutOf();
    if (r.readback === null || r.readback === undefined) {
      if (r.commanded === 0 && r.since === null) return 'idle';
      return late || r.since === null ? 'no-readback' : 'pending';
    }
    if (r.readback === r.commanded) return 'agreed';
    return late || r.since === null ? 'mismatch' : 'pending';
  }

  /* ---- PAINT ---------------------------------------------------------- */

  paint() {
    if (!this.body) return;
    const now = performance.now();
    this.style.setProperty('--ov-allocator-maxpips', String(Math.max(1, ...this.rows.map((r) => r.max))));
    const cap = this.capacityOf(), dmg = this.damagedOf(), avail = this.availableOf();
    const funded = this.funding();
    let commanded = 0, confirmed = 0, unfunded = 0, pendingFunded = 0, nextDue = Infinity;

    for (const r of this.rows) {
      const st = this.stateOf(r, now);
      const fund = funded.get(r);
      const rb = r.readback === null || r.readback === undefined ? null : r.readback;
      commanded += r.commanded;
      unfunded += fund.unfunded;
      pendingFunded += fund.funded;
      if (rb !== null) confirmed += rb;
      if (st === 'pending') nextDue = Math.min(nextDue, r.since + this.timeoutOf());

      // Pips: FILLED = confirmed by readback; HOLLOW = commanded, not yet
      // confirmed; UNFUNDED = commanded past what the capacity can fund;
      // RELEASING = still delivered after the command came down.
      const { row, minus, plus, pips, state, why } = r.el;
      pips.replaceChildren();
      const conf = rb === null ? 0 : Math.min(rb, r.max);
      for (let i = 0; i < r.max; i++) {
        const p = document.createElement('i');
        let kind = 'empty';
        if (i < fund.base) kind = 'confirmed';
        else if (i < fund.base + fund.funded) kind = 'commanded';
        else if (i < r.commanded) kind = 'unfunded';
        else if (i < conf) kind = 'releasing';
        p.className = `ov-allocator__pip ov-allocator__pip--${kind}`;
        pips.append(p);
      }
      row.setAttribute('data-ov-state', st);
      row.toggleAttribute('data-ov-unfunded', fund.unfunded > 0);
      const words = {
        idle: '', agreed: 'CONFIRMED', pending: 'PENDING',
        mismatch: `MISMATCH, READS ${rb}`, 'no-readback': 'NO READBACK',
      }[st];
      state.textContent = `${r.commanded}/${rb === null ? '–' : rb}${words ? ' ' + words : ''}`
        + (fund.unfunded ? ` · ${fund.unfunded} UNFUNDED` : '');
      row.setAttribute('aria-label', `${r.label}: commanded ${r.commanded}, `
        + (rb === null ? `readback ${REASONS.unknown}` : `confirmed ${rb}`)
        + (st === 'pending' ? ', waiting for the system' : st === 'mismatch' ? ', the system disagrees'
          : st === 'no-readback' ? ', the system has not answered' : '')
        + (fund.unfunded ? `, ${fund.unfunded} units unfunded` : ''));
      minus.setAttribute('aria-disabled', r.commanded === 0 ? 'true' : 'false');
    }

    // Free capacity, and the + buttons that cannot be funded say so first.
    const free = Math.max(0, avail - commanded);
    for (const r of this.rows) {
      const blocked = free === 0 || r.commanded >= r.max;
      r.el.plus.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      r.el.why.textContent = r.commanded >= r.max ? '' : free === 0
        ? `no free capacity${dmg ? `, ${dmg} damaged` : ''}` : '';
    }

    // The pool: every unit of capacity, once.
    this.pool.replaceChildren();
    const used = Math.min(confirmed, avail);
    for (let i = 0; i < cap; i++) {
      const p = document.createElement('i');
      let kind = 'free';
      if (i >= avail) kind = 'damaged';
      else if (i < used) kind = 'confirmed';
      else if (i < used + pendingFunded) kind = 'commanded';
      p.className = `ov-allocator__pip ov-allocator__pip--${kind}`;
      this.pool.append(p);
    }
    this.sum.textContent = `${avail} OF ${cap} AVAILABLE`
      + (dmg ? ` · ${dmg} DAMAGED` : '')
      + ` · ${commanded} COMMANDED · ${confirmed} CONFIRMED · ${free} FREE`
      + (unfunded ? ` · ${unfunded} UNFUNDED` : '');
    this.setAttribute('data-ov-unfunded', unfunded ? 'true' : 'false');

    const said = [];
    if (unfunded) said.push(`${unfunded} requested unit${unfunded > 1 ? 's' : ''} the remaining capacity cannot fund (confirmed delivery first, then top row down)`);
    if (confirmed > avail) said.push(`readback totals ${confirmed}, more than the ${avail} available: the system and the display disagree about capacity`);
    if (this.refused) said.push(`${this.refused} request${this.refused > 1 ? 's' : ''} refused`);
    if (this.malformed) said.push(`${this.malformed} malformed entr${this.malformed > 1 ? 'ies' : 'y'} ignored`);
    if (this.rejected) said.push(this.rejected);
    this.note.textContent = said.join(' · ');
    this.note.hidden = !said.length;

    // Pending rows turn into NO READBACK / MISMATCH on their own clock.
    clearTimeout(this.timer);
    if (nextDue !== Infinity) this.timer = setTimeout(() => this.paint(), Math.max(0, nextDue - now) + 5);
  }
}

define('ov-allocator', OvAllocator);

export { OvAllocator };
