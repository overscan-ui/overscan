/* <ov-ladder> - the receiver chain, rung by rung, and no data until the last.
 *
 * A deep-space downlink is acquired in order: the antenna
 * points, the receiver locks the carrier, then the subcarrier, the symbols,
 * frame sync, and only then does decoding produce data. Each rung is
 * ACQUIRING or LOCKED, and each depends on every rung above it.
 *
 * ⭐ THE REFUSAL: CARRIER LOCK IS NOT DATA. The headline reads RECEIVING DATA
 * only when every rung through the last is locked; otherwise it says how far
 * the lock goes ("LOCKED THROUGH CARRIER: NOT RECEIVING DATA"). NASA's Basics
 * of Space Flight has a chapter section to "highlight the difference between
 * receiver lock and telemetry lock", and the public misreading of DSN Now
 * ("receiving data from ...") is exactly this failure.
 *
 * And A RUNG IS LOCKED ONLY WHEN THE DETECTOR SAYS SO. A rung reported locked
 * without its lock detector declaring it (`declared: true`) is ACQUIRING, and
 * so is one still inside its first detection period (`since` < `period`
 * seconds): DSN 810-005 §4.2, "phase-lock is not indicated in the first lock
 * detection period." A rung that reports lock below a rung that has none is
 * not believed and not lit: a downstream lock with no upstream is a report,
 * not a state.
 *
 * Input, as the `chain` property or from `src`:
 *   { stages: [{ name, state: 'locked' | 'acquiring' | 'off', declared?, since?, period? }] }
 *   in chain order; a missing state is NO REPORT.
 */

import { define } from './ov-core.js';

const ladText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* Effective status of each rung, in order: locked | acquiring | off | noreport | held. */
function ladDerive(stages) {
  const out = [];
  let chain = true;   // every rung above this one is locked
  for (const s of stages) {
    let status, why = '';
    const st = s && s.state;
    if (st === 'locked') {
      const since = Number(s.since), period = Number(s.period);
      if (s.declared !== true) { status = 'acquiring'; why = 'reported locked, not declared by the lock detector'; }
      else if (Number.isFinite(period) && period > 0 && Number.isFinite(since) && since < period) {
        status = 'acquiring'; why = `inside the first detection period (${since}s of ${period}s)`;
      } else status = 'locked';
    } else if (st === 'acquiring') status = 'acquiring';
    else if (st === 'off') status = 'off';
    else status = 'noreport';
    if (status === 'locked' && !chain) { status = 'held'; why = 'reports lock with a rung above it unlocked: not believed'; }
    if (status !== 'locked') chain = false;
    out.push({ name: (s && s.name) || '?', status, why });
  }
  return out;
}

class OvLadder extends HTMLElement {
  static observedAttributes = ['src'];

  connectedCallback() {
    this._chain = this._chain || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get chain() { return this._chain; }
  set chain(v) { this._chain = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._chain = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._chain = null;
    }
    this.paint();
  }

  paint() {
    const C = this._chain;
    this.removeAttribute('data-ov-refusal');
    const stages = C && Array.isArray(C.stages) ? C.stages : null;
    if (!stages || !stages.length) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.innerHTML = '<div class="ov-ladder__void">NO RECEIVER CHAIN</div>';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'Acquisition ladder, no receiver chain');
      return;
    }
    const D = ladDerive(stages);
    let through = -1;
    while (through + 1 < D.length && D[through + 1].status === 'locked') through += 1;
    const all = through === D.length - 1;
    const head = all ? 'RECEIVING DATA'
      : through < 0 ? 'NOTHING LOCKED: NOT RECEIVING DATA'
        : `LOCKED THROUGH ${ladText(D[through].name).toUpperCase()}: NOT RECEIVING DATA`;
    const word = { locked: 'LOCKED', acquiring: 'ACQUIRING', off: 'OFF', noreport: 'NO REPORT', held: 'NOT BELIEVED' };
    const rungs = D.map((d, i) => `<li class="ov-ladder__rung is-${d.status}${i <= through ? ' is-chain' : ''}" data-stage="${ladText(d.name)}">`
      + '<i class="ov-ladder__mark"></i>'
      + `<span class="ov-ladder__name">${ladText(d.name)}</span>`
      + `<span class="ov-ladder__state">${word[d.status]}</span>`
      + (d.why ? `<span class="ov-ladder__why">${ladText(d.why)}</span>` : '')
      + '</li>').join('');
    this.innerHTML = `<div class="ov-ladder__head${all ? ' is-data' : ''}">${head}</div><ol class="ov-ladder__rungs">${rungs}</ol>`;
    this.setAttribute('data-ov-lock', all ? 'data' : through < 0 ? 'none' : 'partial');
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Acquisition ladder, ${head.toLowerCase()}`);
  }
}

define('ov-ladder', OvLadder);

export { OvLadder, ladDerive };
