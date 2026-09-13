/* <ov-countdown> - a mission clock that refuses dead reckoning.
 *
 * For industrial
 * (Mother's countdown) and antiseptic. `ov-segment` and `ov-flap` can render a
 * time; neither knows what time it is, and neither can tell you when it stopped
 * knowing.
 *
 *   <ov-countdown target="2026-09-11T02:00:00Z" holdover="1"></ov-countdown>
 *   clock.clock = missionTime();      // every heartbeat, a source-time in ms
 *   clock.clock = null;               // the source says it has nothing
 *   clock.toggleAttribute('holding'); // a deliberate hold
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 THE COUNT COMES FROM THE SOURCE, NOT FROM THIS BROWSER. A page clock is
 * one more guess, and a countdown that keeps going on it after its source has
 * gone quiet is a readout showing a number nobody measured: the whole screen
 * says T-00:04:11 and nothing upstream agrees any more. So once the source is
 * lost the count STOPS, the readout turns to dashes, and the element states
 * the loss and the last time the source actually gave it.
 *
 * ⚠️ BETWEEN heartbeats it does advance on the local monotonic clock, for at
 * most `holdover` seconds after the last sync. That is dead reckoning too, and
 * it is allowed only because it is BOUNDED, DECLARED on the element and CAPPED
 * (see HOLDOVER_MAX): a source at 4 Hz would otherwise make the display step
 * four times a second. The sync age is always on screen, so the reader can see
 * how much of the number is interpolation.
 *
 * Two ways to lose the clock, and they are not the same:
 *
 *   null          the source SAID it has nothing. Lost at once, no holdover:
 *                 interpolating past an explicit dropout would contradict it.
 *   silence       nothing arrived for longer than `holdover`. Lost then.
 *
 * ── THREE STOPS, NEVER CONFUSED ───────────────────────────────────────────
 *
 *   state     readout              tag        why it is not moving
 *   holding   frozen, steady       HOLD       someone stopped the count
 *   lost      dashes, alarm        LOST       the source went away
 *   unknown   dashes, alarm        NO CLOCK   nothing has ever arrived
 *
 * A HOLD shows its number because the number is a fact: the count is stopped,
 * so the value at the moment of the hold stays true however long it lasts,
 * even if the clock goes away underneath it. A LOSS does not, because the count
 * would have kept moving and nobody can say where to. Every state carries a
 * text tag as well as colour, because colour is not a channel everyone has.
 *
 * On release, T-0 moves by exactly the hold's length (the remaining time is
 * conserved), measured on the SOURCE's clock, which is how a launch hold works.
 * A release that happens while the clock is lost cannot be timed; it resumes
 * at the next sync and the report says `untimedRelease`, rather than guessing
 * how long the gap was.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 *
 * It draws text, not segments. Composing `ov-segment` groups would give a
 * seven-segment face, but segment has no colon glyph and a clock face is a
 * separate decision. It does not correct drift between syncs: a sync that
 * disagrees with the interpolation is taken as the truth and the size of the
 * step is reported (`lastStep`), never smoothed away.
 */

import { define, watchSeen, isSeen } from './ov-core.js';
import './ov-source.js';
import { apply, prop, reading, upgrade } from './ov-refusal.js';

/* The holdover is the page's declaration, and a declaration can defeat the
 * refusal: holdover="3600" is an hour of dead reckoning wearing the word
 * "live". Ten seconds is 40 missed beats at the kit's default source rate and
 * 10 at the slowest rate any demo runs; a source quieter than that is not a
 * live clock. A clamped request is reported, not silently honoured. */
const HOLDOVER_DEFAULT = 1;
const HOLDOVER_MAX = 10;

// Named STOP_TAG, not TAG: ov-annunciator has a module-level TAG, and
// tools/collisions.py reports kit modules that share a top-level name.
const STOP_TAG = {
  live: '',
  holding: 'HOLD',
  lost: 'LOST',
  unknown: 'NO CLOCK',  // or NO TARGET, when there is nothing to count to
};

/* A clock reading is a source-time in ms: a number, a Date, or the kit's
 * {value, age} reading shape, where `age` says the time was taken that many
 * seconds before it arrived. `undefined` means "not set"; `null`, and anything
 * that is not a time, is an explicit dropout. */
function coerce(v) {
  if (v === undefined) return undefined;
  // The attribute door: a string is a number of ms or an ISO time, and empty
  // or "null" is a dropout. Not reading(), which would take "" as zero.
  if (typeof v === 'string') {
    if (v.trim() === '' || v.trim() === 'null') return null;
    const t = parseTarget(v);
    return t === null ? null : { value: t, age: null };
  }
  if (v instanceof Date) {
    const n = v.getTime();
    return Number.isFinite(n) ? { value: n, age: null } : null;
  }
  return reading(v);
}

function parseTarget(raw) {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const d = Date.parse(raw);
  return Number.isFinite(d) ? d : null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/* Remaining ms -> sign and digits.
 *
 * Counting down rounds UP, so T-00:00:00 is reached at zero and not a second
 * early: during the final second the clock reads T-00:00:01, as a launch clock
 * does. Past zero it counts up from T+00:00:00 and rounds DOWN, for the same
 * reason. Hours widen past 99 rather than wrapping. */
function format(ms, places) {
  const unit = places ? 100 : 1000;
  const down = ms > 0;
  const n = down ? Math.ceil(ms / unit) : Math.floor(-ms / unit);
  const tenths = places ? n % 10 : null;
  const s = places ? Math.floor(n / 10) : n;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const time = `${pad(hh)}:${pad(mm)}:${pad(ss)}${places ? '.' + tenths : ''}`;
  return { sign: down ? 'T-' : 'T+', time, past: !down };
}

function spoken({ sign, time }) {
  return `T ${sign === 'T-' ? 'minus' : 'plus'} ${time}`;
}

class OvCountdown extends HTMLElement {
  static observedAttributes = ['clock', 'target', 'holdover', 'places', 'source', 'holding'];

  /* The LOCAL clock the holdover is measured on. Monotonic on purpose: a wall
   * clock can be stepped by the OS under a running countdown. Replaceable so a
   * test can drive time without waiting for it. */
  static monotonic = () => performance.now();

  constructor() {
    super();
    this._sync = null;       // { time: source ms, at: local ms } - last good
    this._dropped = false;   // the source sent an explicit null
    this._shift = 0;         // ms T-0 has moved through completed holds
    this._frozen = null;     // remaining ms held, or null
    this._pending = null;    // a release seen while the clock was lost
    this._untimedHold = false;
    this._untimedRelease = false;
    this._lastStep = null;
    this._state = null;
    this._raf = 0;
  }

  connectedCallback() {
    if (!this._built) this.build();
    this.bindSource();
    if (this.hasAttribute('holding')) this.enterHold();
    upgrade(this, ['clock']);
    this.unseen = watchSeen(this, () => this.render());
    this.render();
  }

  disconnectedCallback() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.unseen) this.unseen();
  }

  attributeChangedCallback(name, was, now) {
    if (!this.isConnected) return;
    if (name === 'source') this.bindSource();
    if (name === 'target') {
      // A new target is authoritative: earlier holds were against the old one.
      this._shift = 0;
      if (this.hasAttribute('holding')) { this._frozen = null; this.enterHold(); }
    }
    if (name === 'holding') {
      if (now !== null && was === null) this.enterHold();
      if (now === null && was !== null) this.release();
    }
    this.render();
  }

  build() {
    this._built = true;
    this.innerHTML = '<span class="ov-countdown__read">'
      + '<span class="ov-countdown__sign"></span>'
      + '<span class="ov-countdown__time"></span></span>'
      + '<span class="ov-countdown__tag"></span>'
      + '<span class="ov-countdown__note"></span>'
      + '<span class="ov-countdown__say" aria-live="polite"></span>';
    this.$ = {
      sign: this.querySelector('.ov-countdown__sign'),
      time: this.querySelector('.ov-countdown__time'),
      tag: this.querySelector('.ov-countdown__tag'),
      note: this.querySelector('.ov-countdown__note'),
      say: this.querySelector('.ov-countdown__say'),
    };
  }

  bindSource() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !window.Overscan?.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (r) => { this.clock = r; });
  }

  /* ---- the clock -------------------------------------------------------- */

  /* `clock` is installed by prop() below, so it is a READING in the manifest
   * and null means a dropout, as everywhere else in the kit. prop()'s setter
   * only stores and redraws, so the heartbeat is taken here, once per new
   * value: render runs every frame and must not re-take an old one.
   *
   * ⭐ A REPEATED TIME IS NOT A HEARTBEAT. A source whose clock has stopped
   * and keeps sending the same time is a stuck clock, and refreshing the sync
   * on it would let a frozen source look live forever. It is ignored, so the
   * holdover runs out and the element says LOST. */
  ingest(t) {
    // Three doors, one reading, as for every readout in the kit: the property
    // (which a source also writes) wins, else the attribute. An attribute
    // written twice with the same time is still one heartbeat, not two.
    const v = this._prop_clock !== undefined ? this._prop_clock : (this.getAttribute('clock') ?? undefined);
    if (v === this._seen) return;
    this._seen = v;
    const r = coerce(v);
    if (r === undefined) return;
    if (r === null) { this._dropped = true; return; }
    if (this._sync && !this._dropped && r.value === this._sync.time) return;
    const at = t - (r.age ? r.age * 1000 : 0);
    const predicted = this.sourceNow(t);
    this._lastStep = predicted === null ? null : r.value - predicted;
    this._sync = { time: r.value, at };
    this._dropped = false;
    const target = this.targetMs();
    if (this._pending !== null && target !== null) {
      this._shift = this._pending - (target - r.value);
      this._pending = null;
    }
    if (this.hasAttribute('holding') && this._frozen === null) this.enterHold(t);
  }

  /* Plain methods, NOT getters: `target`, `holdover` and `places` are
   * attributes, and a getter-only property with an attribute's name throws
   * when a framework assigns it (see api.py getters_only). */
  holdoverS() {
    const n = Number(this.getAttribute('holdover'));
    if (!this.hasAttribute('holdover') || !Number.isFinite(n) || n < 0) return HOLDOVER_DEFAULT;
    return Math.min(n, HOLDOVER_MAX);
  }

  targetMs() { return parseTarget(this.getAttribute('target')); }

  placesN() { return this.getAttribute('places') === '1' ? 1 : 0; }

  /* Source time now, or null when the element is not entitled to one. This is
   * the ONE place interpolation happens, so the holdover bound cannot be
   * skipped by a second path. */
  sourceNow(t) {
    if (!this._sync || this._dropped) return null;
    const age = t - this._sync.at;
    if (age > this.holdoverS() * 1000) return null;
    return this._sync.time + Math.max(0, age);
  }

  liveRemaining(t) {
    const target = this.targetMs();
    const now = this.sourceNow(t);
    if (target === null || now === null) return null;
    return target + this._shift - now;
  }

  enterHold(t = OvCountdown.monotonic()) {
    const r = this.liveRemaining(t);
    this._frozen = r;
    this._untimedHold = r === null;
  }

  release() {
    const frozen = this._frozen;
    this._frozen = null;
    if (frozen === null) return;
    const now = this.sourceNow(OvCountdown.monotonic());
    const target = this.targetMs();
    if (now === null || target === null) {
      this._pending = frozen;
      this._untimedRelease = true;
      return;
    }
    this._untimedRelease = false;
    this._shift = frozen - (target - now);
  }

  /* ---- what is true right now ------------------------------------------- */

  resolve(t = OvCountdown.monotonic()) {
    const target = this.targetMs();
    const clock = !this._sync ? 'none' : this.sourceNow(t) === null ? 'lost' : 'live';
    const syncAge = this._sync ? Math.max(0, t - this._sync.at) / 1000 : null;
    const lastGood = (this._sync && target !== null)
      ? target + this._shift - this._sync.time : null;
    // Every branch carries every field, so a reader never has to ask which
    // shape it got: `reason` is null when there is a number, and vice versa.
    const base = { reason: null, remaining: null, clock, syncAge, lastGood, targetInvalid: this.hasAttribute('target') && target === null };

    if (target === null) return { ...base, state: 'unknown', reason: 'unknown' };
    if (this.hasAttribute('holding') && this._frozen !== null) {
      return { ...base, state: 'holding', remaining: this._frozen };
    }
    if (clock === 'none') return { ...base, state: 'unknown', reason: 'unknown' };
    if (clock === 'lost' || this._pending !== null) {
      // `unknown` is the protocol's word for an explicit null too, so a loss
      // needs no new reason; LOST vs NO CLOCK is carried by the state and tag.
      return { ...base, state: 'lost', reason: 'unknown' };
    }
    return { ...base, state: 'live', remaining: this.liveRemaining(t) };
  }

  render(t) {
    if (!this._built) return;
    const now = t ?? OvCountdown.monotonic();
    this.ingest(now);
    const r = this.resolve(now);
    const places = this.placesN();
    const noTarget = this.targetMs() === null;
    let label, sign, time, past = false;

    if (r.reason) {
      sign = 'T ';
      time = places ? '--:--:--.-' : '--:--:--';
      label = noTarget ? 'no target' : r.state === 'lost' ? 'clock source lost' : 'no clock';
    } else {
      const f = format(r.remaining, places);
      ({ sign, time, past } = f);
      label = spoken(f) + (r.state === 'holding' ? ', holding' : '');
    }

    // Every state says what it is in words. The note says how much of the
    // number is the source's: the sync age while live, the last synced value
    // once lost. That last value is labelled as such and kept OUT of the
    // readout, which stays dashes: a refusal is never the last good value.
    const tag = noTarget ? 'NO TARGET' : STOP_TAG[r.state];
    let note = '';
    if (r.state === 'lost' && r.lastGood !== null) {
      const g = format(r.lastGood, places);
      note = `LAST SYNC ${g.sign}${g.time}`;
      label += `, last sync ${spoken(g)}`;
      // A hold asked for while lost cannot freeze a value nobody has; it
      // takes the first value the next sync gives (report.untimedHold). Say
      // it was asked for, or the button looks broken.
      if (this.hasAttribute('holding')) { note += ' · HOLD REQUESTED'; label += ', hold requested'; }
    } else if (r.state === 'holding' && r.clock !== 'live') {
      note = r.clock === 'lost' ? 'CLOCK LOST' : 'NO CLOCK';
      label += r.clock === 'lost' ? ', clock source lost' : ', no clock';
    } else if (r.state === 'live' || r.state === 'holding') {
      note = `SYNC ${r.syncAge.toFixed(1)}s`;
    }
    // The loop runs every frame and the output changes at most ten times a
    // second, so the DOM is written only when what it shows has changed.
    const key = [r.state, r.clock, sign, time, tag, note, label].join('|');
    if (key === this._key) { this.loop(); return; }
    this._key = key;

    this.$.sign.textContent = sign;
    this.$.time.textContent = time;
    this.$.tag.textContent = tag;
    this.$.note.textContent = note;
    this.toggleAttribute('data-ov-past', past);
    apply(this, r.reason ? { reason: r.reason } : { text: label });
    this.setAttribute('data-ov-state', r.state);
    this.setAttribute('data-ov-clock', r.clock);
    // A countdown is a timer, not a picture. Its name follows every tick
    // without being announced; transitions are announced once, below.
    this.setAttribute('role', 'timer');
    this.setAttribute('aria-label', label);

    if (this._state !== r.state) {
      const previous = this._state;
      this._state = r.state;
      if (previous !== null) {
        this.$.say.textContent = label;
        this.dispatchEvent(new CustomEvent('ov:clock', {
          bubbles: true,
          detail: { state: r.state, previous, report: this.report },
        }));
      }
    }
    this.loop();
  }

  /* Tick only while time passing alone can change what is true: a live clock
   * (the count moves, or the holdover runs out). A lost clock does not tick,
   * and nothing schedules it again until a heartbeat arrives. That is the
   * refusal stated as a scheduling decision.
   *
   * render() calls this, so every door a heartbeat can come in by (the
   * `clock` property, a source, an attribute) restarts the loop the same way. */
  loop() {
    // A frame queued while the clock was live is withdrawn the moment it is
    // not, rather than left to fire once more. The harness caught that one.
    if (this.sourceNow(OvCountdown.monotonic()) === null || !this.isConnected) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      return;
    }
    if (this._raf) return;
    // Offscreen, no frame is asked for; the visibility gate's wake renders,
    // which comes back here.
    if (!isSeen(this)) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (this.isConnected) this.render();
    });
  }

  get report() {
    const t = OvCountdown.monotonic();
    const r = this.resolve(t);
    const asked = Number(this.getAttribute('holdover'));
    return {
      state: r.state,
      clock: r.clock,
      remaining: r.remaining ?? null,
      display: this.$ ? this.$.sign.textContent + this.$.time.textContent : null,
      lastGood: r.lastGood,
      syncAge: r.syncAge,
      holdover: this.holdoverS(),
      holdoverClamped: this.hasAttribute('holdover') && Number.isFinite(asked) && asked > HOLDOVER_MAX,
      shift: this._shift,
      untimedHold: this.hasAttribute('holding') && this._untimedHold,
      untimedRelease: this._untimedRelease,
      lastStep: this._lastStep,
      targetInvalid: r.targetInvalid,
    };
  }
}

prop(OvCountdown, 'clock');
define('ov-countdown', OvCountdown);

export { OvCountdown };
