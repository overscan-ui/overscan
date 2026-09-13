/* <ov-flap> - a split-flap board where the transition duration carries
 * information.
 *
 * This is the one widget in the kit whose MOTION is the data. A real Solari
 * board steps a drum forward one character at a time, so the time a cell takes
 * to settle is proportional to how far its character travelled. Watch a board
 * change and you can see which cells moved a little and which moved almost all
 * the way round, before you can read any of them.
 *
 * That is why the drum only turns FORWARD, and why Z to A is the long way. It
 * is not a limitation being faithfully reproduced; it is the property that
 * makes the duration mean something. Easing the flips or taking the short way
 * would make it look smoother and say nothing.
 */

import { define, hasArrived, whenArrived } from './ov-core.js';
import './ov-source.js';
import './ov-refusal.js';

const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:/';
const STEP_MS = 55;

class OvFlap extends HTMLElement {
  static observedAttributes = ['value', 'digits', 'step', 'deadband', 'frozen-after', 'substituted'];

  bindSource() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (reading) => {
      const o = (reading && typeof reading === 'object') ? reading : { value: reading };
      if (o.value === null || o.value === undefined) this.removeAttribute('value');
      else this.setAttribute('value', typeof o.value === 'number'
        ? o.value.toFixed(Number(this.getAttribute('places') ?? 1)) : String(o.value));
      if (o.age !== undefined) this.setAttribute('age', o.age);
    });
  }

  /* Off the page, a flip would keep turning a drum nobody can see. It stops
   * where it is; connectedCallback's update() carries on from there. */
  disconnectedCallback() {
    if (this.unsub) this.unsub();
    this.stopFlips();
  }

  connectedCallback() {
    this.bindSource();
    if (!this._cells) this.build();
    this.update();
    /* Last, so the element's DOM exists before a reclaimed property
     * triggers a redraw against cells that have not been built. */
    window.OverscanRefusal.upgrade(this, ['value']);
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    /* 🔴 attributeChangedCallback RUNS BEFORE connectedCallback ON UPGRADE,
     * once per observed attribute, and `isConnected` is ALREADY TRUE for an
     * element that was in the markup. So this ran with no drum cells and no
     * timer array, and flipTo() threw on `this._timers[i]` for every flap on
     * the page. It threw four times on demo/motion.html and the display still
     * came out right, because connectedCallback rebuilt afterwards, so nothing
     * ever reported it. The same trap is written up in ov-text.js.
     *
     * Build if the cells are not there yet, whatever changed. */
    if (name === 'digits' || !this._cells) this.build();
    this.update();
  }

  get digits() { return Math.max(1, parseInt(this.getAttribute('digits') || '8', 10)); }
  get step() { return Math.max(8, parseInt(this.getAttribute('step') || STEP_MS, 10)); }

  stopFlips() {
    if (!this._timers) return;
    this._timers.forEach((t, i) => { clearInterval(t); this._timers[i] = null; });
  }

  build() {
    /* 🔴 STOP THE FLIPS BEFORE REPLACING THE CELLS. Markup that says value
     * before digits (the home page does) builds and starts flipping on the
     * value callback, then rebuilds on the digits one. Replacing _timers with
     * nulls here orphaned every running interval: it went on writing into the
     * NEW cells, beside the new flip, and each board turned forever without
     * ever showing its value. On the home page that was 15 intervals and
     * ~270 forced layouts a second, for as long as the page was open. */
    this.stopFlips();
    this.innerHTML = Array.from({ length: this.digits }, () =>
      '<span class="ov-flap__cell"><span class="ov-flap__char"> </span></span>').join('');
    this._cells = [...this.querySelectorAll('.ov-flap__char')];
    this._at = this._cells.map(() => 0);
    this._timers = this._cells.map(() => null);
  }

  resolve() {
    const raw = window.OverscanRefusal.rawOf(this, 'value');
    const text = raw === null ? '' : raw.toUpperCase();
    const pre = window.OverscanRefusal.common(this, raw, text.length);
    if (pre) return pre;
    for (const c of text) {
      if (!DRUM.includes(c)) return { reason: 'unrepresentable' };
    }
    return { text };
  }

  update() {
    /* 🔴 THE BOARD LANDS AFTER THE PAGE DOES, AND IT STILL LANDS. The drums
     * are setInterval timers that force a reflow per cell per tick to restart
     * the flip, and a board spinning up from its markup value while the hero
     * and the topbar are animating in is two animations competing for the same
     * frames (193ms of script in the first five seconds at 4x, second only to
     * the feeds).
     *
     * ⚠️ Deferred, NOT jumped. On this element the duration IS the reading:
     * a cell that travelled far takes longer, and that is the whole widget.
     * Landing it instantly to save the frames would keep the number and throw
     * away what the board is for. Until then it shows what it honestly has,
     * which before its first reading is the refusal dashes. */
    if (!hasArrived()) {
      if (!this._waitingArrival) {
        this._waitingArrival = true;
        whenArrived(() => { this._waitingArrival = false; this.update(); });
      }
      return;
    }
    const r = this.resolve();
    window.OverscanRefusal.apply(this, r, this.getAttribute('unit'));

    // A refusal on a board is a row of dashes, the same as every other readout
    // here. It is never a blank board: blank is a legitimate destination on a
    // departure board and would read as a value.
    const target = r.reason
      ? '-'.repeat(this.digits)
      : r.text.padEnd(this.digits, ' ').slice(0, this.digits);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    [...target].forEach((ch, i) => this.flipTo(i, DRUM.indexOf(ch), reduced));
  }

  flipTo(i, to, reduced) {
    if (this._timers[i]) { clearInterval(this._timers[i]); this._timers[i] = null; }
    if (to < 0) to = 0;

    if (reduced) {
      // Jump. The duration was the information, and if motion is off there is
      // no honest way to deliver it, so the value simply arrives.
      this._at[i] = to;
      this._cells[i].textContent = DRUM[to];
      return;
    }

    if (this._at[i] === to) return;
    // A tick clears its OWN interval. Clearing "whatever is in the slot" is
    // how an orphan used to stop the live flip and then run on alone.
    const id = setInterval(() => {
      if (this._timers[i] !== id) { clearInterval(id); return; }
      // Forward only, and wrapping. The long way round IS the reading.
      this._at[i] = (this._at[i] + 1) % DRUM.length;
      const cell = this._cells[i];
      cell.textContent = DRUM[this._at[i]];
      cell.parentElement.classList.remove('is-flipping');
      void cell.parentElement.offsetWidth;
      cell.parentElement.classList.add('is-flipping');
      if (this._at[i] === to) {
        clearInterval(id);
        this._timers[i] = null;
      }
    }, this.step);
    this._timers[i] = id;
  }

  /* How many steps this board would take to reach a value from where it is.
   * Exposed because the duration is a claim about distance, and a claim you
   * cannot read back is not measurable. */
  stepsTo(value) {
    const text = String(value).toUpperCase().padEnd(this.digits, ' ');
    return this._at.map((from, i) => {
      const to = DRUM.indexOf(text[i]);
      return to < 0 ? null : (to - from + DRUM.length) % DRUM.length;
    });
  }
}

window.OverscanRefusal.prop(OvFlap, 'value');
define('ov-flap', OvFlap);

export { OvFlap };
