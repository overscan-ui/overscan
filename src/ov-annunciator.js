/* <ov-annunciator> - a panel of latched warning tiles with a master caution.
 *
 * For industrial
 * (Mother's warning panels), antiseptic (status boards) and aegis.
 *
 *   <ov-annunciator tiles="FUEL LOW,HYD PRESS,CABIN ALT,O2 FLOW"></ov-annunciator>
 *   panel.set('FUEL LOW', true);
 *   panel.conditions = [{ label: 'HYD PRESS', value: false }, { label: 'CABIN ALT', value: null }];
 *   panel.acknowledge();
 *
 *   <ov-annunciator tiles="..." source="caution"></ov-annunciator>
 *
 * A `source` emits the same list `conditions` takes, and each emission is
 * applied as one write. A source that emits `null` has dropped out as a
 * whole, so every tile goes to NO DATA: the panel does not hold the last
 * state of a feed that stopped talking.
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 A FAULT DOES NOT GET TO CLEAR ITSELF. A condition that trips and recovers
 * before anyone looks has still happened, and a panel that goes dark again on
 * its own has let a transient alarm vanish unseen. So the tile stays lit,
 * DISTINGUISHABLY, until someone acknowledges it: LATCHED and LIVE are two
 * states, never one.
 *
 * The latch is EDGE-driven, in the write, not in the paint. A condition set
 * true and false again inside one task is never painted lit at all, and it
 * still latches, because the rising edge was seen. A panel that sampled its
 * inputs on a frame would lose exactly the transients this element exists for.
 *
 * Five states, and every one of them carries a TEXT TAG as well as colour and
 * motion, because flashing is off under reduced motion and colour is not a
 * channel everyone has:
 *
 *   state     live    acknowledged   drawn as
 *   normal    false   -              dark, no tag
 *   alert     true    no             filled, flashing, ALERT
 *   acked     true    yes            filled, steady, ACK
 *   latched   false   no             hatched outline, LATCHED xN
 *   unknown   null    either         dashed, NO DATA (the kit's `unknown`)
 *
 * ── THREE MORE REFUSALS THAT FALL OUT OF THE FIRST ───────────────────────
 *
 * 1. A DROPOUT IS NOT "CLEAR". A tile whose input is null, never arrived, or
 *    is not a plain yes or no draws NO DATA, never the dark normal tile. A
 *    dark tile is a claim that the condition is absent, and nobody measured
 *    that. A dropout also does not erase a latch: the trip still happened.
 * 2. A DROPOUT BREAKS CONTINUITY. A condition seen true before a gap and true
 *    after it is announced again, because the panel cannot know it held
 *    across the gap, and assuming it did would be dead reckoning.
 * 3. POSITION IS MEANING, so the layout is declared and never grows. A
 *    condition the panel was not built with gets no tile (a tile appearing
 *    reads as a new layout, and an operator reads position before text), and
 *    it is COUNTED and SAID rather than dropped. A tile removed from `tiles`
 *    while it holds an unacknowledged trip is kept, marked off-panel, until
 *    someone acknowledges it, for the same reason as the latch.
 *
 * ── SHELVING, AND WHY IT IS NEVER SILENT ─────────────────────────────────
 *
 * An operator can SHELVE a nuisance alarm (EEMUA 191; IEC 60601-1-8 calls
 * it "paused", and distinguishes it from "off", which this panel does not
 * offer at all). Four rules, each the refusal applied to a suppression:
 * 1. A SHELF IS TIMED. shelve() with no duration, or longer than
 *    `max-shelve`, is refused. There is no open-ended shelf.
 * 2. A SHELVED TILE STAYS ON THE PANEL, marked SHELVED with its time left
 *    and its underlying state. Shelving stops the flash, the master caution
 *    and the sound; it does not stop the panel from SAYING what it knows.
 * 3. THE LATCH KEEPS RUNNING UNDERNEATH. A condition that trips while
 *    shelved still latches and counts; master acknowledge skips it, so it
 *    cannot be acknowledged unseen.
 * 4. WHEN THE SHELF EXPIRES IT RE-ARMS, and anything it caught comes back
 *    as unacknowledged, with sound. The panel counts shelved tiles, always.
 * 5. SOME ALARMS CANNOT BE SHELVED AT ALL. EEMUA 191 is explicit that
 *    safety alarms must never be; `unshelvable` names them, and those tiles
 *    get no SHELVE button and shelve() refuses them, saying why.
 * A REASON is optional (a status panel should not own a prompt dialog), but
 * one given is carried on ov:shelve and in the panel note, so the host can
 * keep EEMUA's log of who shelved what and why.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 *
 * One alarm level. Real panels split warning (red) from caution (amber); the
 * token contract has one `--ov-alarm`, and a second level is a token change,
 * not an element change. Sound is optional and never the only channel: if
 * ov-sound.js is loaded, a new trip plays `alarm` from this element, and the
 * tile carries everything the sound says.
 */

import { define } from './ov-core.js';
import { REASONS, upgrade } from './ov-refusal.js';
import './ov-source.js';

const TAG = {
  normal: '',
  alert: 'ALERT',
  acked: 'ACK',
  latched: 'LATCHED',
  unknown: 'NO DATA',
};

/* Every flashing tile flashes IN PHASE, off one clock. CSS animations started
 * at different moments run out of phase, and a panel whose tiles blink in a
 * ripple reads as a sequence, which is a stagger, which motion.css rule 2
 * reserves for the signal path. Each alert tile's animation is offset by the
 * wall clock so they share one phase however late each one tripped. */
const PERIOD_MS = 800;

/* What a condition is allowed to be. Anything that is not a plain yes or no
 * is no reading, rather than a guess at one: "maybe" is not false. */
function condition(v) {
  let age = null;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    age = Number.isFinite(Number(v.age)) && v.age !== null ? Number(v.age) : null;
    v = v.value;
  }
  if (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') return { live: true, age };
  if (v === false || v === 0 || v === '0' || v === 'false' || v === 'off') return { live: false, age };
  return { live: null, age };
}

function blankTile(label) {
  // `live` starts undefined, not false: nothing has arrived, so the tile
  // opens on NO DATA rather than claiming the condition is absent.
  return { label, live: undefined, age: null, unacked: false, trips: 0, retired: false, shelvedUntil: null };
}

function stateOf(t) {
  if (t.live === null || t.live === undefined) return 'unknown';
  if (t.live) return t.unacked ? 'alert' : 'acked';
  return t.unacked ? 'latched' : 'normal';
}

class OvAnnunciator extends HTMLElement {
  static observedAttributes = ['tiles', 'max-age', 'master', 'label', 'source', 'conditions',
    'shelvable', 'shelve-for', 'max-shelve', 'unshelvable'];

  constructor() {
    super();
    this.tiles = new Map();
    this.undeclared = new Set();
    this.duplicates = [];
    this.pending = false;
  }

  connectedCallback() {
    upgrade(this, ['conditions']);
    const first = !this.grid;
    if (!this.grid) this.build();
    this.layout();
    // Once, not on every reconnect: re-applying the same list on a move
    // through the DOM would count every trip in it a second time.
    if (first) this.applyAttribute();
    this.bindSource();
    this.paint();
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); this.unsub = null; clearTimeout(this.shelfTimer); }

  bindSource() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !window.Overscan || !window.Overscan.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (reading) => {
      if (reading === null || reading === undefined) {
        for (const t of this.tiles.values()) if (!t.retired) this.write(t.label, null);
        this.schedule();
        return;
      }
      this.conditions = reading;
    });
  }

  attributeChangedCallback(name) {
    if (!this.grid) return;
    if (name === 'tiles') this.layout();
    if (name === 'source') this.bindSource();
    if (name === 'conditions') this.applyAttribute();
    if (name === 'master') this.masterLabel.textContent = this.getAttribute('master') || 'MASTER CAUTION';
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label') || 'Annunciator panel');
    this.paint();
  }

  build() {
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Annunciator panel');

    this.master = document.createElement('button');
    this.master.type = 'button';
    this.master.className = 'ov-annunciator__master';
    this.masterLabel = document.createElement('span');
    this.masterLabel.textContent = this.getAttribute('master') || 'MASTER CAUTION';
    this.masterCount = document.createElement('span');
    this.masterCount.className = 'ov-annunciator__count';
    this.master.append(this.masterLabel, this.masterCount);
    this.master.addEventListener('click', () => this.acknowledge());

    this.grid = document.createElement('ul');
    this.grid.className = 'ov-annunciator__grid';
    this.grid.setAttribute('role', 'list');

    this.note = document.createElement('p');
    this.note.className = 'ov-annunciator__note';

    // Two live regions: a new trip interrupts, everything else waits its turn.
    this.urgent = document.createElement('span');
    this.urgent.className = 'ov-annunciator__say';
    this.urgent.setAttribute('aria-live', 'assertive');
    this.polite = document.createElement('span');
    this.polite.className = 'ov-annunciator__say';
    this.polite.setAttribute('aria-live', 'polite');

    this.append(this.master, this.grid, this.note, this.urgent, this.polite);
  }

  /* The declared layout. State survives for labels that stay; a label that
   * leaves while holding an unacknowledged trip is RETIRED rather than
   * removed, and goes only when acknowledged. */
  layout() {
    const seen = new Set();
    this.duplicates = [];
    const declared = [];
    for (const raw of (this.getAttribute('tiles') || '').split(',')) {
      const label = raw.trim();
      if (!label) continue;
      if (seen.has(label)) { this.duplicates.push(label); continue; }
      seen.add(label);
      declared.push(label);
    }
    const next = new Map();
    for (const label of declared) {
      const t = this.tiles.get(label) || blankTile(label);
      t.retired = false;
      next.set(label, t);
      this.undeclared.delete(label);
    }
    for (const [label, t] of this.tiles) {
      if (!next.has(label) && t.unacked) { t.retired = true; next.set(label, t); }
    }
    this.tiles = next;

    this.grid.replaceChildren();
    this.cells = new Map();
    for (const t of this.tiles.values()) {
      const li = document.createElement('li');
      li.className = 'ov-annunciator__tile';
      const name = document.createElement('span');
      name.className = 'ov-annunciator__label';
      name.textContent = t.label;
      const tag = document.createElement('span');
      tag.className = 'ov-annunciator__tag';
      li.append(name, tag);
      // Present only on a panel declared `shelvable`: shelving is an
      // operator action, and a status board that cannot take one should
      // not grow buttons.
      let shelf = null;
      if (this.hasAttribute('shelvable') && !this.neverShelve().has(t.label)) {
        shelf = document.createElement('button');
        shelf.type = 'button';
        shelf.className = 'ov-annunciator__shelve';
        shelf.addEventListener('click', () => {
          if (this.isShelved(t)) this.unshelve(t.label);
          else this.shelve(t.label, Number(this.getAttribute('shelve-for')) || 300);
        });
        li.append(shelf);
      }
      this.grid.append(li);
      this.cells.set(t.label, { li, tag, shelf });
    }
  }

  /* ---- INPUT ---------------------------------------------------------- */

  /* One condition. Returns false when the panel has no tile for it. */
  set(label, value) {
    const ok = this.write(label, value);
    this.schedule();
    return ok;
  }

  /* A list of { label, value, age? } writes, applied in order.
   *
   * An ARRAY rather than a label -> value map, deliberately: it is what the
   * manifest's `Structured` (unknown[]) type says a structured property is,
   * so the .d.ts tells a TypeScript user the truth without a new type, and
   * order is explicit, which matters for a latch (true then false in one list
   * is a transient, and it latches).
   *
   * 🔴 `undefined` and `null` are not the same answer, exactly as in
   * ov-refusal.js: a tile the list does not mention is not being driven by
   * this write and keeps its state; `{ label, value: null }` has DROPPED OUT
   * and draws NO DATA. Anything that is not an array is refused, and said. */
  set conditions(list) {
    this._conditions = list;
    this.rejected = null;
    if (Array.isArray(list)) {
      for (const c of list) {
        if (c && typeof c === 'object' && typeof c.label === 'string' && c.value !== undefined) {
          this.write(c.label, c.age === undefined ? c.value : { value: c.value, age: c.age });
        }
      }
    } else if (list !== undefined && list !== null) {
      this.rejected = 'conditions ignored: not an array of { label, value }';
    }
    this.schedule();
  }

  /* The same writes as literal text, for markup and for a still with no
   * fixtures to run: `conditions="HYD PRESS=on, CABIN ALT=on, CABIN ALT=off,
   * COOLANT=null"`, applied in order, so the pair on CABIN ALT is a transient
   * and latches. ov-chart's `values` is the precedent for an attribute and a
   * property of one name. A value that is not on/off (or true/false, 1/0) is
   * no reading, as everywhere else here; an entry with no `=` is refused and
   * counted rather than guessed at. */
  applyAttribute() {
    const raw = (this.getAttribute('conditions') || '').trim();
    this.malformed = 0;
    if (!raw) return;
    const list = [];
    for (const part of raw.split(',')) {
      const at = part.indexOf('=');
      if (at < 1) { if (part.trim()) this.malformed += 1; continue; }
      list.push({ label: part.slice(0, at).trim(), value: part.slice(at + 1).trim() });
    }
    this.conditions = list;
  }

  get conditions() {
    return [...this.tiles.values()].map((t) => ({
      label: t.label, value: t.live === undefined ? null : t.live,
    }));
  }

  write(label, value) {
    // From the attribute a value arrives as text; "null" is the dropout word.
    if (value === 'null' || value === '') value = null;
    const t = this.tiles.get(label);
    if (!t || t.retired) {
      this.undeclared.add(label);
      return false;
    }
    const { live, age } = condition(value);
    const was = t.live;
    // The rising edge is the whole mechanism. Anything that is not already
    // KNOWN true becoming true is a new trip, including null -> true: the
    // panel will not assume the condition held through a gap it could not see.
    if (live === true && was !== true) {
      t.unacked = true;
      t.trips += 1;
      const shelved = this.isShelved(t);
      // Shelved: the latch runs, the ANNUNCIATION does not. Still said,
      // politely, so a screen reader is not the one channel it vanishes from.
      if (shelved) this.say(this.polite, `${label} tripped while shelved`);
      else this.say(this.urgent, `${label} alert`);
      this.dispatchEvent(new CustomEvent('ov:annunciate', {
        detail: { label, trips: t.trips, shelved }, bubbles: true,
      }));
      if (!shelved) this.sound = true;
    } else if (live === false && was === true && t.unacked) {
      this.say(this.polite, `${label} cleared, held until acknowledged`);
    } else if (live === null && was !== null && was !== undefined) {
      this.say(this.polite, `${label} ${REASONS.unknown}`);
    }
    t.live = live;
    t.age = age;
    return true;
  }

  /* ---- ACKNOWLEDGE ---------------------------------------------------- */

  /* Acknowledges every unacknowledged tile and says what that did. A tile
   * still live becomes ACK and stays lit; a latched one goes dark; a retired
   * one leaves the panel. Nothing is acknowledged that was not showing. */
  acknowledge() {
    const report = { acknowledged: 0, held: [], cleared: [], blind: [], removed: [] };
    for (const t of [...this.tiles.values()]) {
      if (!t.unacked) continue;
      // A shelved tile is not acknowledged by the master: it is not being
      // shown as an alarm, so acknowledging it would be acknowledging unseen.
      if (this.isShelved(t)) { report.shelved = (report.shelved || 0) + 1; continue; }
      report.acknowledged += 1;
      t.unacked = false;
      t.trips = 0;
      if (t.retired) { this.tiles.delete(t.label); report.removed.push(t.label); continue; }
      if (t.live === true) report.held.push(t.label);
      else if (t.live === false) report.cleared.push(t.label);
      // Acknowledged while there was no reading: the operator saw the trip,
      // and still nobody knows whether the condition is present.
      else report.blind.push(t.label);
    }
    if (report.removed.length) this.layout();
    if (report.acknowledged) {
      this.say(this.polite, `${report.acknowledged} acknowledged`);
      this.dispatchEvent(new CustomEvent('ov:acknowledge', { detail: report, bubbles: true }));
    }
    this.paint();
    return report;
  }

  /* ---- SHELVING ------------------------------------------------------- */

  neverShelve() {
    return new Set((this.getAttribute('unshelvable') || '').split(',').map((x) => x.trim()).filter(Boolean));
  }

  isShelved(t, now = performance.now()) {
    return t.shelvedUntil !== null && now < t.shelvedUntil;
  }

  /* Timed, always. Returns { ok, reason }. */
  shelve(label, seconds, reason) {
    const t = this.tiles.get(label);
    const max = Number(this.getAttribute('max-shelve')) || 3600;
    const why = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
    let refusal = null;
    if (!t || t.retired) refusal = 'no such tile';
    else if (this.neverShelve().has(label)) refusal = 'this alarm cannot be shelved';
    else if (!Number.isFinite(+seconds) || +seconds <= 0) refusal = 'a shelf needs a duration';
    else if (+seconds > max) refusal = `longer than the ${this.clock(max)} maximum`;
    if (refusal) {
      this.shelfRefused = `shelve refused for ${label}: ${refusal}`;
      this.paint();
      return { ok: false, reason: refusal };
    }
    this.shelfRefused = null;
    t.shelvedUntil = performance.now() + (+seconds) * 1000;
    t.shelveReason = why;
    this.say(this.polite, `${label} shelved for ${this.clock(+seconds)}${why ? `: ${why}` : ''}`);
    this.dispatchEvent(new CustomEvent('ov:shelve', {
      detail: { label, shelved: true, seconds: +seconds, reason: why }, bubbles: true,
    }));
    this.paint();
    return { ok: true };
  }

  unshelve(label) {
    const t = this.tiles.get(label);
    if (!t || t.shelvedUntil === null) return { ok: false, reason: 'not shelved' };
    t.shelvedUntil = null;
    if (t.unacked) { this.sound = true; this.say(this.urgent, `${label} unshelved, alert`); }
    this.dispatchEvent(new CustomEvent('ov:shelve', { detail: { label, shelved: false }, bubbles: true }));
    this.paint();
    return { ok: true };
  }

  clock(sec) {
    const s2 = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`;
  }

  /* ---- PAINT ---------------------------------------------------------- */

  /* Writes are batched into one paint per task. The latch does not depend on
   * this: it was decided in write(), which is the point. */
  schedule() {
    if (this.pending || !this.grid) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.paint(); });
  }

  paint() {
    if (!this.grid) return;
    const maxAge = Number(this.getAttribute('max-age'));
    const now = performance.now();
    let unacked = 0, shelvedCount = 0;
    for (const t of this.tiles.values()) {
      // An expired shelf re-arms here, and what it caught comes back loud.
      if (t.shelvedUntil !== null && now >= t.shelvedUntil) {
        t.shelvedUntil = null;
        this.dispatchEvent(new CustomEvent('ov:shelve', {
          detail: { label: t.label, shelved: false, expired: true }, bubbles: true,
        }));
        if (t.unacked) { this.sound = true; this.say(this.urgent, `${t.label} shelf expired, alert`); }
      }
    }
    for (const t of this.tiles.values()) {
      const cell = this.cells.get(t.label);
      if (!cell) continue;
      const state = stateOf(t);
      const shelved = this.isShelved(t, now);
      if (shelved) shelvedCount += 1;
      const stale = Number.isFinite(maxAge) && maxAge > 0 && t.age !== null && t.age > maxAge
        && state !== 'unknown';
      if (t.unacked && !shelved) unacked += 1;

      const { li, tag, shelf } = cell;
      li.toggleAttribute('data-ov-shelved', shelved);
      if (shelf) {
        shelf.textContent = shelved ? 'UNSHELVE' : 'SHELVE';
        shelf.setAttribute('aria-label', shelved ? `unshelve ${t.label}` : `shelve ${t.label} for ${this.clock(Number(this.getAttribute('shelve-for')) || 300)}`);
      }
      li.setAttribute('data-ov-state', state);
      li.toggleAttribute('data-ov-latched', t.unacked && t.live !== true);
      li.toggleAttribute('data-ov-retired', t.retired);
      if (stale) li.setAttribute('data-ov-qualified', 'stale');
      else li.removeAttribute('data-ov-qualified');
      li.style.animationDelay = state === 'alert' && !shelved ? `-${now % PERIOD_MS}ms` : '';

      // The tag is the channel that survives reduced motion and missing colour.
      const parts = [];
      if (shelved) parts.push(`SHELVED ${this.clock((t.shelvedUntil - now) / 1000)}`);
      if (TAG[state]) parts.push(TAG[state]);
      if (state === 'unknown' && t.unacked && t.live !== true) parts.push('LATCHED');
      if ((state === 'latched' || state === 'alert') && t.trips > 1) parts.push(`×${t.trips}`);
      if (stale) parts.push(`STALE ${t.age}s`);
      if (t.retired) parts.push('OFF PANEL');
      tag.textContent = parts.join(' ');

      li.setAttribute('aria-label', this.describe(t, state, stale)
        + (shelved ? `, shelved for ${this.clock((t.shelvedUntil - now) / 1000)} more` : ''));
    }

    this.setAttribute('data-ov-master', unacked ? 'lit' : 'dark');
    this.master.setAttribute('aria-disabled', unacked ? 'false' : 'true');
    this.masterCount.textContent = unacked ? String(unacked) : '';
    this.master.setAttribute('aria-label', unacked
      ? `${this.masterLabel.textContent}, ${unacked} not acknowledged, press to acknowledge`
      : `${this.masterLabel.textContent}, nothing to acknowledge`);
    this.master.style.animationDelay = unacked ? `-${now % PERIOD_MS}ms` : '';

    // Counted and said, never silently dropped.
    const said = [];
    if (this.undeclared.size) {
      said.push(`${this.undeclared.size} condition${this.undeclared.size > 1 ? 's' : ''}`
        + ` with no tile: ${[...this.undeclared].join(', ')}`);
    }
    if (this.duplicates.length) said.push(`duplicate tile declared: ${this.duplicates.join(', ')}`);
    if (this.rejected) said.push(this.rejected);
    if (shelvedCount) {
      said.push(`${shelvedCount} shelved: ${[...this.tiles.values()].filter((t) => this.isShelved(t, now))
        .map((t) => (t.shelveReason ? `${t.label} (${t.shelveReason})` : t.label)).join(', ')}`);
    }
    if (this.shelfRefused) said.push(this.shelfRefused);
    if (this.malformed) said.push(`${this.malformed} condition${this.malformed > 1 ? 's' : ''} in the attribute with no "=": ignored`);
    this.note.textContent = said.join(' · ');
    this.note.hidden = !said.length;

    // Countdown: repaint once a second while anything is shelved.
    clearTimeout(this.shelfTimer);
    if (shelvedCount) this.shelfTimer = setTimeout(() => this.paint(), 1000 - (now % 1000) + 5);

    if (this.sound) {
      this.sound = false;
      const s = window.Overscan && window.Overscan.sound;
      if (s && typeof s.play === 'function') s.play('alarm', this);
    }
  }

  describe(t, state, stale) {
    const bits = [t.label];
    if (state === 'normal') bits.push('clear');
    if (state === 'alert') bits.push('alert, not acknowledged');
    if (state === 'acked') bits.push('acknowledged, still present');
    if (state === 'latched') bits.push(`cleared, tripped ${t.trips} time${t.trips > 1 ? 's' : ''}, not acknowledged`);
    if (state === 'unknown') {
      bits.push(REASONS.unknown);
      if (t.unacked) bits.push('tripped earlier, not acknowledged');
    }
    if (stale) bits.push(`stale, ${t.age} seconds old`);
    if (t.retired) bits.push('no longer on this panel, kept until acknowledged');
    return bits.join(', ');
  }

  /* Everything said to one region in the same task is JOINED and written
   * once. Written one at a time, a batch of trips kept only the last: each
   * write replaced the one before it before a screen reader could read it,
   * so three alerts in one update were heard as one. */
  say(region, text) {
    (region._ovSay ||= []).push(text);
    if (region._ovSay.length > 1) return;
    queueMicrotask(() => {
      const all = region._ovSay;
      region._ovSay = [];
      // Re-setting identical text is not announced, so clear first.
      region.textContent = '';
      region.textContent = all.join('. ');
    });
  }

  /* What the panel currently shows, for tests and for anyone asserting on it.
   * ⚠️ A METHOD, not a getter: a getter-only property is one a framework will
   * try to assign on the bare tag, and that assignment throws. */
  snapshot() {
    return {
      tiles: [...this.tiles.values()].map((t) => ({
        label: t.label, state: stateOf(t), trips: t.trips, unacked: t.unacked, retired: t.retired,
      })),
      unacked: [...this.tiles.values()].filter((t) => t.unacked).length,
      undeclared: [...this.undeclared],
      duplicates: [...this.duplicates],
    };
  }
}

define('ov-annunciator', OvAnnunciator);

export { OvAnnunciator, PERIOD_MS };
