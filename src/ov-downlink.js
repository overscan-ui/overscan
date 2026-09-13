/* <ov-downlink> - a delayed link that never presents the far side as now.
 *
 * For industrial, aegis and cyber. A source, its link state,
 * the messages it sent, and how old each one is. The Expanse's "delayed by"
 * stamps; Starship Troopers' TRANSMISSION TERMINATED; NASA's display standard
 * F.4.3.1, "there must be an indication when data are stale".
 *
 *   <ov-downlink label="ROCINANTE" timeout="30" lines="6"></ov-downlink>
 *   link.receive({ text: 'burn complete', sent: 1757548800000 });
 *   link.receive({ text: 'relay up', age: 200 }); // 200 s in flight, the
 *                                               // kit's reading shape
 *   link.receive({ sent: 1757548801000 });      // a heartbeat, no message
 *   link.terminate();                           // the far side closed it
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 NOTHING FROM THE FAR SIDE IS NOW. Every message carries its one-way AGE,
 * how long ago it was SENT, not when it arrived, because a message fourteen
 * minutes in flight is fourteen minutes old the moment it lands. And the ages
 * keep growing while it sits on screen, so a panel left open does not quietly
 * turn history into the present.
 *
 * Three more that fall out of it:
 *
 * 1. NO SEND TIME, NO CLAIMED AGE. A message with no `sent` stamp shows how
 *    long ago it ARRIVED and says DELAY UNKNOWN. Showing its receipt age as
 *    its age would claim a zero-second flight nobody measured.
 * 2. A SEND TIME AHEAD OF OUR CLOCK IS SKEW, NOT A NEGATIVE AGE. It is
 *    reported as CLOCK SKEW with the size of the gap, never drawn as "0s" or
 *    "-3s", because either would be a number the display made up.
 * 3. TWO WAYS TO LOSE THE LINK, NEVER CONFUSED. Silence past `timeout` is NO
 *    SIGNAL; the source saying so (`terminate()`, or a source emitting null)
 *    is TERMINATED. Both show the time since the last frame, counted on our
 *    own clock, which is a fact about us. The history stays, with its ages
 *    still growing, so it cannot pass for a live feed.
 *
 * Like ov-log it keeps a capped window and says how many it did not keep, and
 * it never reorders or merges: two identical messages are two messages.
 */

import { define } from './ov-core.js';
import './ov-source.js';

const TIMEOUT_DEFAULT = 30;

const LINK_WORD = {
  never: 'NO SIGNAL',
  live: 'LINK',
  silent: 'NO SIGNAL',
  terminated: 'TERMINATED',
};

/* Seconds -> "12s", "14m 02s", "3h 05m", "2d 04h". Coarsens with age, the way
 * a person reads it; the accessible name and the report carry the exact
 * seconds. */
export function span(s) {
  const n = Math.floor(s);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${String(Math.floor(n / 60) % 60).padStart(2, '0')}m`;
  return `${Math.floor(n / 86400)}d ${String(Math.floor(n / 3600) % 24).padStart(2, '0')}h`;
}

/* A time: a number of ms, a Date, or an ISO string. Anything else is none. */
// A message's row, and a row's message: the log is keyed by message, never by
// slot (see render()). Weak, so a dropped message takes its node with it.
const LI_FOR = new WeakMap();
const LINE_OF = new WeakMap();

function timeOf(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const d = Date.parse(v);
  return Number.isFinite(d) ? d : null;
}

class OvDownlink extends HTMLElement {
  static observedAttributes = ['label', 'timeout', 'lines', 'source'];

  /* Our clock, in epoch ms, because `sent` stamps are epoch ms. Replaceable
   * so a test can drive time. */
  static now = () => Date.now();

  constructor() {
    super();
    this._items = [];          // { text, sent, received }
    this._lastFrame = null;    // local ms of the last thing received
    this._terminated = false;
    this._dropped = 0;
    this._state = null;
    this._timer = 0;
    this._lastKey = null;
  }

  connectedCallback() {
    if (!this._built) this.build();
    this.bindSource();
    this.render();
    // Ages are the content, and they change every second whether or not
    // anything arrives, so the panel ticks once a second while connected.
    if (!this._timer) this._timer = setInterval(() => this.render(), 1000);
  }

  disconnectedCallback() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    clearInterval(this._timer);
    this._timer = 0;
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'source') this.bindSource();
    if (name === 'label' && this.$) this.$.label.textContent = this.getAttribute('label') || '';
    this.render();
  }

  build() {
    this._built = true;
    this.innerHTML = '<div class="ov-downlink__head">'
      + '<span class="ov-downlink__label"></span>'
      + '<span class="ov-downlink__state"></span></div>'
      + '<div class="ov-downlink__delay"></div>'
      + '<ol class="ov-downlink__lines" role="log" aria-live="polite" aria-relevant="additions"></ol>'
      + '<div class="ov-downlink__foot"></div>'
      + '<span class="ov-downlink__say" aria-live="assertive"></span>';
    this.$ = {
      label: this.querySelector('.ov-downlink__label'),
      state: this.querySelector('.ov-downlink__state'),
      delay: this.querySelector('.ov-downlink__delay'),
      lines: this.querySelector('.ov-downlink__lines'),
      foot: this.querySelector('.ov-downlink__foot'),
      say: this.querySelector('.ov-downlink__say'),
    };
    this.$.label.textContent = this.getAttribute('label') || '';
  }

  bindSource() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !window.Overscan?.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (r) => {
      if (r === null) { this.terminate(); return; }
      if (r === undefined) return;
      // A source repeats its reading every tick. The same message again
      // (same id, or same text and send time) is a heartbeat, not a second
      // message: sources re-emit, operators do not re-send.
      const o = typeof r === 'object' ? r : { text: String(r) };
      const key = o.id ?? `${o.text}|${o.sent}`;
      if (key === this._lastKey) { this.receive({ sent: o.sent }); return; }
      this._lastKey = key;
      this.receive(o);
    });
  }

  timeoutS() {
    const n = Number(this.getAttribute('timeout'));
    return this.hasAttribute('timeout') && Number.isFinite(n) && n > 0 ? n : TIMEOUT_DEFAULT;
  }

  capN() { return Math.max(1, parseInt(this.getAttribute('lines') || '6', 10)); }

  /* ---- the door ------------------------------------------------------- */

  /* One arrival: a message, or with no `text` a heartbeat. Either proves the
   * link is up at the moment it lands; only a message adds a line.
   * @param {{ text?: string, sent?: number | string | Date, age?: number } | string} [m] */
  receive(m = {}) {
    const now = OvDownlink.now();
    const o = typeof m === 'string' ? { text: m } : (m || {});
    this._lastFrame = now;
    this._terminated = false;
    if (o.text !== undefined && o.text !== null && o.text !== '') {
      // `sent` is a stamp; `age` is the kit's reading shape, seconds in flight
      // when it arrived, for a feed that knows its latency but not its clock.
      // Neither means DELAY UNKNOWN, never zero.
      let sent = timeOf(o.sent);
      const age = Number(o.age);
      if (sent === null && o.age !== undefined && o.age !== null && Number.isFinite(age) && age >= 0) {
        sent = now - age * 1000;
      }
      this._items.push({ text: String(o.text), sent, received: now });
      while (this._items.length > this.capN()) { this._items.shift(); this._dropped += 1; }
    }
    if (this.isConnected) this.render();
  }

  /* The far side said the link is closed. Different from going quiet. */
  terminate() {
    this._terminated = true;
    if (this.isConnected) this.render();
  }

  /* ---- what is true right now ----------------------------------------- */

  state(now) {
    if (this._lastFrame === null) return this._terminated ? 'terminated' : 'never';
    if (this._terminated) return 'terminated';
    return now - this._lastFrame > this.timeoutS() * 1000 ? 'silent' : 'live';
  }

  /* One item's age, or the reason it has none. */
  ageOf(it, now) {
    if (it.sent === null) {
      return { kind: 'unknown', received: (now - it.received) / 1000 };
    }
    // Skew is judged at ARRIVAL, not now: a stamp that was ahead of our clock
    // when it landed stays wrong by that much, and once our clock passed it
    // the first cut showed "-18s" as if it were an honest age. It is not.
    if (it.sent > it.received) return { kind: 'skew', ahead: (it.sent - it.received) / 1000 };
    return { kind: 'age', age: (now - it.sent) / 1000, delay: Math.max(0, (it.received - it.sent) / 1000) };
  }

  render(t) {
    if (!this._built) return;
    const now = t ?? OvDownlink.now();
    const st = this.state(now);
    const since = this._lastFrame === null ? null : (now - this._lastFrame) / 1000;

    this.$.state.textContent = LINK_WORD[st];
    this.setAttribute('data-ov-link', st);

    // The newest message's flight time, the Expanse's "delayed by". Only a
    // stamped message has one; an unstamped newest message says so.
    const newest = this._items[this._items.length - 1];
    let delay = '';
    if (newest) {
      const a = this.ageOf(newest, now);
      delay = a.kind === 'age' ? `DELAYED BY ${span(a.delay)}`
        : a.kind === 'skew' ? `CLOCK SKEW ${span(a.ahead)}` : 'DELAY UNKNOWN';
    }
    this.$.delay.textContent = delay;

    // Lines: rebuilt each tick, because every age on them changed.
    const rows = this._items.map((it) => {
      const a = this.ageOf(it, now);
      const age = a.kind === 'age' ? `−${span(a.age)}`
        : a.kind === 'skew' ? `AHEAD ${span(a.ahead)}` : `RCVD −${span(a.received)}`;
      return { age, kind: a.kind, text: it.text, it };
    });
    /* One <li> per MESSAGE, not per slot. The list is role=log, which speaks
     * what is added. Filling slots by index rewrote every line's text each
     * time the window slid, so a screen reader heard the window again; now a
     * kept message keeps its node, a dropped one loses it, and only an
     * arrival adds one. Ages still change every tick, and
     * aria-relevant="additions" keeps those rewrites out of speech. */
    const lines = this.$.lines;
    const keep = new Set(rows.map((r) => r.it));
    for (const li of [...lines.children]) if (!keep.has(LINE_OF.get(li))) li.remove();
    for (const r of rows) {
      let li = LI_FOR.get(r.it);
      if (!li) {
        li = document.createElement('li');
        li.className = 'ov-downlink__line';
        li.innerHTML = '<span class="ov-downlink__age"></span><span class="ov-downlink__text"></span>';
        li.children[1].textContent = r.text;
        LI_FOR.set(r.it, li);
        LINE_OF.set(li, r.it);
      }
      li.setAttribute('data-ov-age', r.kind);
      if (li.children[0].textContent !== r.age) li.children[0].textContent = r.age;
      // Aged before it is added, so it is announced with its age. Appending a
      // node already in place moves nothing: order is arrival order.
      if (li.parentNode !== lines) lines.append(li);
    }

    // Foot: what the link is doing, and what the window did not keep.
    const foot = [];
    if (st === 'silent' || st === 'terminated') foot.push(`LAST FRAME −${span(since)}`);
    if (st === 'never') foot.push('NOTHING RECEIVED');
    if (this._dropped) foot.push(`${this._dropped} NOT KEPT`);
    this.$.foot.textContent = foot.join(' · ');

    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', [
      this.getAttribute('label') || 'downlink',
      st === 'live' ? 'link up' : st === 'terminated' ? 'transmission terminated'
        : st === 'silent' ? 'no signal' : 'no signal, nothing received',
      since !== null && st !== 'live' ? `last frame ${Math.floor(since)} seconds ago` : null,
    ].filter(Boolean).join(', '));

    if (this._state !== st) {
      const previous = this._state;
      this._state = st;
      if (previous !== null) {
        this.$.say.textContent = this.getAttribute('aria-label');
        this.dispatchEvent(new CustomEvent('ov:signal', {
          bubbles: true, detail: { state: st, previous, report: this.report },
        }));
      }
    }
  }

  get report() {
    const now = OvDownlink.now();
    return {
      state: this.state(now),
      sinceLastFrame: this._lastFrame === null ? null : (now - this._lastFrame) / 1000,
      timeout: this.timeoutS(),
      kept: this._items.length,
      dropped: this._dropped,
      items: this._items.map((it) => ({ text: it.text, ...this.ageOf(it, now) })),
    };
  }
}

define('ov-downlink', OvDownlink);

export { OvDownlink };
