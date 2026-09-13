/* <ov-procedure> - an arming sequence where a claim is not a reading.
 *
 * For industrial.
 *
 *   <ov-procedure steps="SEAL HATCH,PRESSURISE,CREW CLEAR,ARM PYROS"
 *                 unsensed="CREW CLEAR" armed="ARMED"></ov-procedure>
 *   proc.sense('SEAL HATCH', true);    // telemetry
 *   proc.claim('SEAL HATCH');          // the operator (also the row's button)
 *
 *   <ov-procedure steps="..." sensed="SEAL HATCH=on, PRESSURISE=off"
 *                 claimed="SEAL HATCH,PRESSURISE"></ov-procedure>
 *
 * The two attributes are the same two inputs as literal text, for markup and
 * for a still with nothing to drive it. `sensed` is applied first, then each
 * `claimed` step is claimed IN ORDER through claim(), so the interlock still
 * decides: a claim the gate refuses in markup is refused here too, and said.
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 A STEP SOMEONE CLAIMED DONE IS NOT A STEP THAT WAS SENSED DONE, and this
 * element never draws them as one tick. It is ov-fault's "self-report is not
 * telemetry" applied to controls: the operator's word and the sensor's reading
 * are two columns, OPERATOR and SENSOR, and a step is VERIFIED only when both
 * agree. Every checklist UI that shows one checkmark has already merged them,
 * and the merge is where the accident lives: the hatch that was "checked" and
 * was not shut.
 *
 * Four rules follow.
 *
 * 1. THE INTERLOCK OPENS ON THE SENSOR, not the claim. A step with a sensor
 *    satisfies its successor only when VERIFIED. A claim the sensor does not
 *    back holds the sequence, and says so.
 * 2. A STEP WITH NO SENSOR IS DECLARED, and can only ever be CLAIMED. It is
 *    never promoted to verified, because nothing verified it. It satisfies the
 *    interlock on the claim (there is nothing else to wait for), and the
 *    procedure carries that forward: it completes as "ON CLAIM", never as
 *    plain ARMED.
 * 3. A SENSOR THAT GOES BACK IS NEWS. A verified step whose reading drops to
 *    false reads SENSE LOST, not "claimed": the history is the information,
 *    exactly as a latched annunciator tile. Everything after it waits again.
 *    A dropout (null) reads NO DATA and does not verify anything.
 * 4. THE REFUSAL IS SHOWN BEFORE THE PRESS. A step that cannot be claimed yet
 *    says what it is waiting on, in the row, before anyone tries. claim()
 *    returns the same reason. (ov-graph's rule: a tool that lets you complete
 *    a gesture and then does nothing has refused without saying so.)
 *
 * A step the sensor reports done before anyone claimed it reads SENSED,
 * UNCLAIMED. It does not open the interlock either: the procedure is the
 * operator's, and a thing that happened by itself is a thing to look at.
 */

import { define } from './ov-core.js';
import { REASONS, upgrade } from './ov-refusal.js';

const WORD = {
  waiting: 'WAITING',
  ready: 'READY',
  claimed: 'CLAIMED, NOT SENSED',
  'claimed-nodata': 'CLAIMED, NO DATA',
  'claim-only': 'CLAIMED, NO SENSOR',
  sensed: 'SENSED, UNCLAIMED',
  verified: 'VERIFIED',
  lost: 'SENSE LOST',
};

function senseValue(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) v = v.value;
  if (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') return true;
  if (v === false || v === 0 || v === '0' || v === 'false' || v === 'off') return false;
  return null;
}

const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

class OvProcedure extends HTMLElement {
  static observedAttributes = ['steps', 'unsensed', 'armed', 'label', 'sensed', 'claimed'];

  constructor() {
    super();
    this.rows = [];
  }

  connectedCallback() {
    upgrade(this, ['sensed']);
    const first = !this.table;
    if (!this.table) this.build();
    this.layout();
    // Once, not on every reconnect: a move through the DOM is not a new claim.
    if (first) { this.applySensed(); this.applyClaimed(); }
    this.paint();
    this.watchWidth();
  }

  disconnectedCallback() { if (this.ro) this.ro.disconnect(); this.ro = null; }

  /* 🔴 NARROW IS A LAYOUT, NOT A CROP. Five fixed columns need about 71ch,
   * and the reference wall gives a cell a quarter of that; the first cut
   * simply ran off the edge, cutting the CLAIMED badges and the status line
   * mid-word. Below its natural width the row stacks instead (step, then
   * OPERATOR beside SENSOR, then the state words), and every cell already
   * names itself, so the two columns stay two.
   *
   * ⚠️ The head row is the ruler. It keeps the wide column template in both
   * layouts (it is only hidden, never re-flowed), so its scrollWidth is the
   * natural width either way and toggling cannot oscillate. */
  watchWidth() {
    // Once now, synchronously, so the first frame is already the right
    // layout rather than a wide one cropped for a frame and then fixed. The
    // observer covers every resize after that.
    this.fit();
    if (this.ro || typeof ResizeObserver !== 'function') return;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this);
  }

  fit() {
    const need = this.head ? this.head.scrollWidth : 0;
    this.toggleAttribute('data-ov-narrow', need > 0 && this.clientWidth + 1 < need);
  }

  attributeChangedCallback(name) {
    if (!this.table) return;
    if (name === 'steps' || name === 'unsensed') this.layout();
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label') || 'Procedure');
    if (name === 'sensed') this.applySensed();
    if (name === 'claimed') this.applyClaimed();
    this.paint();
  }

  build() {
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Procedure');

    this.status = document.createElement('div');
    this.status.className = 'ov-procedure__status';
    this.status.setAttribute('role', 'status');

    this.table = document.createElement('ol');
    this.table.className = 'ov-procedure__steps';

    const head = document.createElement('div');
    head.className = 'ov-procedure__head';
    this.head = head;
    head.setAttribute('aria-hidden', 'true');
    for (const t of ['#', 'STEP', 'OPERATOR', 'SENSOR', 'STATE']) {
      const s = document.createElement('span');
      s.textContent = t;
      head.append(s);
    }
    this.note = document.createElement('p');
    this.note.className = 'ov-procedure__note';
    this.append(this.status, head, this.table, this.note);
  }

  /* Steps keep their state across a re-declaration by label; the order is
   * whatever `steps` now says, because the order IS the interlock. */
  layout() {
    const unsensed = new Set(list(this.getAttribute('unsensed')));
    const old = new Map(this.rows.map((r) => [r.label, r]));
    const seen = new Set();
    this.rows = [];
    for (const label of list(this.getAttribute('steps'))) {
      if (seen.has(label)) continue;
      seen.add(label);
      const r = old.get(label)
        || { label, claimed: false, sense: undefined, verifiedOnce: false };
      r.unsensed = unsensed.has(label);
      this.rows.push(r);
    }

    this.table.replaceChildren();
    this.rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'ov-procedure__step';
      const n = document.createElement('span');
      n.className = 'ov-procedure__n';
      n.textContent = String(i + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'ov-procedure__label';
      name.textContent = r.label;

      const op = document.createElement('span');
      op.className = 'ov-procedure__op';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ov-procedure__claim';
      btn.addEventListener('click', () => this.claim(r.label));
      op.append(btn);

      const sen = document.createElement('span');
      sen.className = 'ov-procedure__sensor';
      const state = document.createElement('span');
      state.className = 'ov-procedure__state';
      const why = document.createElement('span');
      why.className = 'ov-procedure__why';
      why.id = `ovp-${Math.random().toString(36).slice(2, 9)}`;
      btn.setAttribute('aria-describedby', why.id);

      li.append(n, name, op, sen, state, why);
      this.table.append(li);
      r.el = { li, btn, sen, state, why };
    });
  }

  /* ---- THE TWO INPUTS ------------------------------------------------- */

  /* Telemetry for one step. */
  sense(label, value) {
    const r = this.rows.find((x) => x.label === label);
    if (!r || r.unsensed) return false;
    const v = senseValue(value);
    r.sense = v;
    // Remembered, so a later false reads SENSE LOST rather than a fresh
    // "claimed, not sensed". A null does not use it: a dropout is NO DATA.
    if (r.claimed && v === true) r.verifiedOnce = true;
    this.paint();
    return true;
  }

  /* A list of { label, value } readings, applied in order. An ARRAY, not a
   * map, for the reason ov-annunciator gives: it is what the manifest's
   * `Structured` type says a structured property is, so the .d.ts tells the
   * truth. A step the list does not mention keeps its reading (`undefined` is
   * "not driven by this write"); `value: null` is a DROPOUT. Anything that is
   * not an array is refused, and said. */
  set sensed(list) {
    this._sensed = list;
    this.rejected = null;
    if (Array.isArray(list)) {
      for (const c of list) {
        if (c && typeof c === 'object' && typeof c.label === 'string' && c.value !== undefined) {
          this.sense(c.label, c.value);
        }
      }
    } else if (list !== undefined && list !== null) {
      this.rejected = 'sensed ignored: not an array of { label, value }';
      this.paint();
    }
  }

  get sensed() {
    return this.rows.filter((r) => !r.unsensed)
      .map((r) => ({ label: r.label, value: r.sense === undefined ? null : r.sense }));
  }

  /* `sensed="SEAL HATCH=on, PRESSURISE=off, ARM PYROS=null"`. An entry with
   * no `=` is counted and said, not guessed at. */
  applySensed() {
    const raw = (this.getAttribute('sensed') || '').trim();
    this.malformed = 0;
    if (!raw) return;
    const list = [];
    for (const part of raw.split(',')) {
      const at = part.indexOf('=');
      if (at < 1) { if (part.trim()) this.malformed += 1; continue; }
      const v = part.slice(at + 1).trim();
      list.push({ label: part.slice(0, at).trim(), value: v === 'null' || v === '' ? null : v });
    }
    this.sensed = list;
  }

  /* `claimed="SEAL HATCH,PRESSURISE"`, claimed in order through claim(), so
   * the interlock applies to markup exactly as to a press. */
  applyClaimed() {
    const raw = (this.getAttribute('claimed') || '').trim();
    this.refusedInMarkup = [];
    for (const label of list(raw)) {
      const r = this.claim(label);
      if (!r.ok && r.reason !== 'already claimed') this.refusedInMarkup.push(`${label} (${r.reason})`);
    }
    this.paint();
  }

  /* The operator's word. Returns { ok, reason, waitingOn }. */
  claim(label) {
    const i = this.rows.findIndex((x) => x.label === label);
    if (i < 0) return { ok: false, reason: 'no such step' };
    const r = this.rows[i];
    if (r.claimed) return { ok: false, reason: 'already claimed' };
    const block = this.blocker(i);
    if (block) {
      const refusal = { ok: false, reason: 'waiting', waitingOn: block.label };
      this.dispatchEvent(new CustomEvent('ov:refuse', { detail: { step: label, ...refusal }, bubbles: true }));
      this.flash(r);
      return refusal;
    }
    r.claimed = true;
    if (r.sense === true) r.verifiedOnce = true;
    this.dispatchEvent(new CustomEvent('ov:claim', { detail: { step: label }, bubbles: true }));
    this.paint();
    return { ok: true };
  }

  reset() {
    for (const r of this.rows) { r.claimed = false; r.verifiedOnce = false; }
    this.paint();
  }

  /* ---- DERIVED -------------------------------------------------------- */

  stateOf(r, i) {
    if (!r.claimed) {
      if (!r.unsensed && r.sense === true) return 'sensed';
      return this.blocker(i) ? 'waiting' : 'ready';
    }
    if (r.unsensed) return 'claim-only';
    if (r.sense === true) return 'verified';
    if (r.sense === null || r.sense === undefined) return 'claimed-nodata';
    return r.verifiedOnce ? 'lost' : 'claimed';
  }

  /* A step satisfies its successor when verified, or when it has no sensor
   * and has been claimed. Nothing else opens the gate. */
  satisfied(r) {
    return r.claimed && (r.unsensed || r.sense === true);
  }

  blocker(i) {
    for (let j = 0; j < i; j++) if (!this.satisfied(this.rows[j])) return this.rows[j];
    return null;
  }

  /* ---- PAINT ---------------------------------------------------------- */

  paint() {
    if (!this.table) return;
    let verified = 0, onClaim = 0, held = 0;
    this.rows.forEach((r, i) => {
      const s = this.stateOf(r, i);
      const { li, btn, sen, state, why } = r.el;
      li.setAttribute('data-ov-state', s);
      li.toggleAttribute('data-ov-unsensed', r.unsensed);
      if (s === 'verified') verified += 1;
      if (s === 'claim-only') onClaim += 1;
      if (s === 'claimed' || s === 'claimed-nodata' || s === 'lost') held += 1;

      // OPERATOR column: the claim, and nothing about the sensor.
      btn.textContent = r.claimed ? 'CLAIMED' : 'CONFIRM';
      btn.setAttribute('aria-pressed', r.claimed ? 'true' : 'false');
      const blocked = !r.claimed && s !== 'sensed' && this.blocker(i);
      const blockedSensed = s === 'sensed' && this.blocker(i);
      btn.setAttribute('aria-disabled', r.claimed || blocked || blockedSensed ? 'true' : 'false');

      // SENSOR column: the reading, and nothing about the claim.
      sen.textContent = r.unsensed ? 'NO SENSOR'
        : r.sense === true ? 'SENSED'
        : r.sense === false ? 'NOT SENSED'
        : 'NO DATA';
      sen.setAttribute('data-ov-sense', r.unsensed ? 'none'
        : r.sense === true ? 'yes' : r.sense === false ? 'no' : 'unknown');

      state.textContent = WORD[s];

      // The refusal, shown before the press.
      const b = this.blocker(i);
      why.textContent = (!r.claimed && b) ? `waits on ${b.label}: ${this.reasonFor(b)}` : '';

      li.setAttribute('aria-label', `step ${i + 1}, ${r.label}: ${WORD[s].toLowerCase()}`
        + (r.unsensed ? '' : `, sensor ${sen.textContent.toLowerCase()}`)
        + (why.textContent ? `, ${why.textContent}` : ''));
    });

    const total = this.rows.length;
    const done = total > 0 && this.rows.every((r) => this.satisfied(r));
    let text, mode;
    if (done && onClaim === 0) {
      text = this.getAttribute('armed') || 'COMPLETE';
      mode = 'complete';
    } else if (done) {
      text = `${this.getAttribute('armed') || 'COMPLETE'} ON CLAIM, ${onClaim} STEP${onClaim > 1 ? 'S' : ''} UNSENSED`;
      mode = 'on-claim';
    } else {
      text = `${verified} OF ${total} VERIFIED`
        + (onClaim ? ` · ${onClaim} ON CLAIM` : '')
        + (held ? ` · ${held} CLAIMED, NOT SENSED` : '');
      mode = held ? 'held' : 'running';
    }
    if (this.status.textContent !== text) this.status.textContent = text;
    // Counted and said, never silently dropped.
    const said = [];
    if (this.rejected) said.push(this.rejected);
    if (this.malformed) said.push(`${this.malformed} reading${this.malformed > 1 ? 's' : ''} in the attribute with no "=": ignored`);
    if (this.refusedInMarkup && this.refusedInMarkup.length) said.push(`claimed in markup and refused: ${this.refusedInMarkup.join(', ')}`);
    this.note.textContent = said.join(' \u00b7 ');
    this.note.hidden = !said.length;
    this.setAttribute('data-ov-procedure', mode);
    if (done && !this._announced) {
      this._announced = true;
      this.dispatchEvent(new CustomEvent('ov:complete', {
        detail: { verified, onClaim }, bubbles: true,
      }));
    }
    if (!done) this._announced = false;
  }

  reasonFor(r) {
    if (!r.claimed) return r.sense === true ? 'sensed, not claimed' : 'not claimed';
    if (r.sense === null || r.sense === undefined) return `claimed, ${REASONS.unknown}`;
    if (r.verifiedOnce) return 'sense lost';
    return 'claimed, not sensed';
  }

  flash(r) {
    r.el.li.removeAttribute('data-ov-refused');
    void r.el.li.offsetWidth;
    r.el.li.setAttribute('data-ov-refused', '');
    setTimeout(() => r.el.li.removeAttribute('data-ov-refused'), 700);
  }
}

define('ov-procedure', OvProcedure);

export { OvProcedure };
