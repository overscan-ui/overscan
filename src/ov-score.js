/* <ov-score> - an aggregate score that says when it is incomplete.
 *
 * For antiseptic, industrial and terminal. Several
 * parameters, each contributing points to one total, where the total is the
 * thing that gets acted on and the parameters are the thing that gets missed.
 *
 * ⚠️ NAMED `ov-score`, NOT `ov-news`. It was first called ov-news for NEWS2,
 * the score it is modelled on, but in a kit of ov-chart and ov-gauge that name
 * reads as a news feed. The kit names elements for what they ARE; NEWS2 is the
 * instance this one was built from and its rules are quoted throughout.
 *
 *   <ov-score label="NEWS2" thresholds="0,5,7" single-red="3"></ov-score>
 *   s.reading = {
 *     scale: 2, scaleBy: 'Dr Ahmed, 14:02',
 *     oxygen: { on: true, rate: '2 L/min', device: 'nasal cannula' },
 *     parameters: [
 *       { name: 'respiration', value: 22, unit: '/min', score: 2 },
 *       { name: 'SpO2', value: 91, unit: '%', score: 3 },
 *       { name: 'blood pressure', missing: 'no-equipment' },
 *       { name: 'temperature', missing: 'not-obtainable' },
 *     ],
 *   };
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 A PARAMETER NOBODY MEASURED IS NEVER SCORED ZERO. It contributes nothing,
 * the total is still shown, and the total is marked INCOMPLETE and names what
 * is missing. Scoring an absent parameter 0 is the quiet version of the error
 * this whole kit is about: zero is the BEST score a NEWS2 parameter can have,
 * so a missing observation silently improves the patient.
 *
 * RCP, NEWS2 Additional implementation guidance (March 2020), "Incomplete
 * NEWS2 parameters": "If one of the physiological measures cannot be obtained
 * because of no equipment, the score should still be calculated and documented
 * as incomplete. A patient may trigger on a single measure, or on an aggregate
 * score even if incomplete. Clinical judgement is particularly important here
 * and might trigger a response at a lower threshold as the score is
 * incomplete."
 *
 * ⚠️ SO THE TOTAL IS SHOWN, NOT WITHHELD, and that is a correction to what
 * this element was first sketched as. The guidance is explicit that the score
 * "should still be calculated"; withholding it would lose a trigger the
 * guidance says may still fire. The refusal is against the total passing as
 * COMPLETE, not against the total existing.
 *
 * And four that follow from it:
 *
 * 1. TWO ABSENCES ARE NOT ONE ABSENCE. Missing for want of equipment is
 *    incomplete and computed. NOT OBTAINABLE despite the equipment being used
 *    is itself an emergency: "If one of the physiological measures is not
 *    obtainable despite the equipment being used, this should trigger an
 *    immediate response." It is never drawn as a quiet gap.
 * 2. A SINGLE RED 3 CANNOT HIDE UNDER A LOW TOTAL. Rec. 11-12: "A single red
 *    score (3 in a single parameter) is unusual, but should prompt an urgent
 *    review by a clinician", and the escalation criteria were amended "so that
 *    a single red score of 3 is not given the same weighting as an aggregate
 *    NEW score of 5 or more". So it is surfaced on its own, beside the total
 *    and not inside it.
 * 3. THE SECOND SCALE NEEDS A NAMED DECISION MAKER. Rec. 26: "The decision to
 *    use SpO2 scale 2 should be made by a competent clinical decision maker and
 *    should be recorded in the patient's clinical notes." The 2020 guidance
 *    records that this "is commonly not documented. This is not in line with
 *    NEWS2 guidance." So scale 2 with nobody recorded is refused as a scale
 *    and says why. Rec. 28 adds that the scale NOT in use "should be clearly
 *    crossed out", so the element draws the unused one struck through rather
 *    than simply omitting it.
 * 4. OXYGEN IS A CLAIM THAT CARRIES ITS OWN PAPERWORK. Rec. 24: "when
 *    supplemental oxygen is being used to maintain the desired oxygen
 *    saturation, the rate of oxygen delivery (L/min) and the delivery
 *    system/device should be documented". Oxygen with neither recorded is
 *    marked, because the weighting of 2 has been applied on the strength of a
 *    fact nobody wrote down.
 *
 * No `role="img"` on the host: its children would become presentational and
 * the parameter rows would never be read. Only the bar
 * is aria-hidden, and every score it draws is a row of text.
 *
 * Drawn on each update. Nothing is timed and nothing runs every frame.
 */

import { define } from './ov-core.js';
import './ov-source.js';
import './ov-refusal.js';

/* The two ways a parameter can be absent, which the guidance keeps apart and
 * which a single "—" would collapse into one. */
const ABSENT = {
  'no-equipment': { word: 'NO EQUIPMENT', urgent: false },
  'not-obtainable': { word: 'NOT OBTAINABLE', urgent: true },
};

const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const setAttr = (el, k, v) => {
  if (!el) return;
  if (v === null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v);
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (raw) => (raw === null || raw.trim() === '' ? null : Number(raw));
const finite = (v) => v !== null && Number.isFinite(v);

let serial = 0;

export class OvScore extends HTMLElement {
  static observedAttributes = ['src', 'label', 'thresholds', 'single-red', 'source'];

  constructor() {
    super();
    this._reading = null;
    this._malformed = 0;
    this._uid = `ov-score-${++serial}`;
  }

  connectedCallback() {
    if (!this._built) this.build();
    this.fetchSrc();
    this.bindSource();
    this.evaluate();
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); this.unsub = null; }

  attributeChangedCallback(name) {
    if (!this._built) return;
    if (name === 'src') { this.fetchSrc(); return; }
    if (name === 'source') this.bindSource();
    this.evaluate();
  }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    let data = null;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      data = await r.json();
    } catch { data = null; }
    if (this.getAttribute('src') !== src) return;
    this.reading = data;
  }

  bindSource() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !window.Overscan?.subscribe) return;
    this.unsub = window.Overscan.subscribe(name, (x) => { this.reading = x; });
  }

  set reading(r) {
    this._malformed = 0;
    if (!r || typeof r !== 'object') { this._reading = null; this.evaluate(); return; }
    const params = (Array.isArray(r.parameters) ? r.parameters : []).map((p) => {
      if (!p || typeof p !== 'object' || !p.name) { this._malformed++; return null; }
      const missing = p.missing && Object.hasOwn(ABSENT, p.missing) ? p.missing : null;
      if (p.missing && !missing) this._malformed++;
      const score = Number(p.score);
      return {
        name: String(p.name),
        value: p.value === undefined || p.value === null ? null : String(p.value),
        unit: p.unit ? String(p.unit) : '',
        // 🔴 An absent parameter has NO score. Not zero: none.
        score: missing ? null : (Number.isFinite(score) ? score : null),
        missing,
      };
    }).filter(Boolean);
    this._reading = {
      parameters: params,
      scale: Number(r.scale) === 2 ? 2 : 1,
      scaleBy: r.scaleBy ? String(r.scaleBy) : null,
      oxygen: r.oxygen && typeof r.oxygen === 'object' ? {
        on: !!r.oxygen.on,
        rate: r.oxygen.rate ? String(r.oxygen.rate) : null,
        device: r.oxygen.device ? String(r.oxygen.device) : null,
      } : { on: false, rate: null, device: null },
    };
    this.evaluate();
  }

  get reading() { return this._reading; }

  label() { return this.getAttribute('label') || 'SCORE'; }

  evaluate() {
    if (!this._built) return this._report;
    const rd = this._reading;
    const redAt = num(this.getAttribute('single-red'));
    const red = finite(redAt) ? redAt : 3;
    const bands = (this.getAttribute('thresholds') || '')
      .split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);

    const r = {
      state: 'empty', total: 0, counted: 0, of: 0, incomplete: [], urgent: [],
      singleRed: [], scaleRefused: false, oxygenUndocumented: false, band: null, why: '',
    };
    const done = () => { this._report = r; this.paint(r, red, bands); return r; };
    if (!rd || !rd.parameters.length) { r.why = 'NO OBSERVATION'; return done(); }

    r.of = rd.parameters.length;
    for (const p of rd.parameters) {
      if (p.missing) {
        r.incomplete.push(p.name);
        if (ABSENT[p.missing].urgent) r.urgent.push(p.name);
        continue;
      }
      if (p.score === null) { r.incomplete.push(p.name); continue; }
      r.counted++;
      r.total += p.score;
      // Refusal 2: surfaced beside the total, never folded into it.
      if (p.score >= red) r.singleRed.push(p.name);
    }

    // Refusal 3: a scale nobody signed for is not a scale.
    r.scaleRefused = rd.scale === 2 && !rd.scaleBy;
    // Refusal 4: the weighting rests on paperwork that has to exist.
    r.oxygenUndocumented = rd.oxygen.on && !(rd.oxygen.rate && rd.oxygen.device);

    r.state = r.incomplete.length ? 'incomplete' : 'complete';
    for (const b of bands) if (r.total >= b) r.band = b;

    const bits = [];
    if (r.incomplete.length) bits.push(`INCOMPLETE · ${r.counted} OF ${r.of} PARAMETERS · MISSING ${r.incomplete.join(', ').toUpperCase()}`);
    if (r.urgent.length) bits.push(`NOT OBTAINABLE DESPITE EQUIPMENT: ${r.urgent.join(', ').toUpperCase()} · IMMEDIATE RESPONSE`);
    if (r.singleRed.length) bits.push(`SINGLE RED ${red} IN ${r.singleRed.join(', ').toUpperCase()} · URGENT REVIEW REGARDLESS OF THE TOTAL`);
    if (r.scaleRefused) bits.push('SCALE 2 WITH NO DECISION MAKER RECORDED');
    if (r.oxygenUndocumented) bits.push('OXYGEN WITH NO RATE OR DEVICE RECORDED');
    r.why = bits.join(' · ');
    return done();
  }

  get report() { return this._report; }

  /* ---- drawing ---------------------------------------------------------- */

  build() {
    this._built = true;
    this.innerHTML = `
      <div class="ov-head">
        <span class="ov-aside ov-head__name ov-score__label"></span>
        <span class="ov-aside ov-head__note ov-score__rulebox"></span>
      </div>
      <div class="ov-state ov-state--bare ov-score__out ov-state--reading">
        <span class="ov-score__total"></span>
        <span class="ov-score__of"></span>
        <span class="ov-aside ov-score__why"></span>
      </div>
      <ol class="ov-score__params"></ol>
      <div class="ov-score__scales"></div>
      <div class="ov-score__oxygen"></div>
      <div class="ov-score__foot"></div>`;
    this.setAttribute('role', 'group');
  }

  paint(r, red, bands) {
    const q = (s) => this.querySelector(s);
    const rd = this._reading;
    setText(q('.ov-score__label'), this.label());
    setText(q('.ov-score__rulebox'),
      `${bands.length ? bands.join(' / ') : 'NO THRESHOLDS'} · RED AT ${red}`);

    setAttr(this, 'data-ov-state', r.state);
    setAttr(q('.ov-score__out'), 'data-ov-tone',
      r.singleRed.length || r.urgent.length || r.state === 'empty' ? 'bad'
        : r.state === 'incomplete' || r.scaleRefused || r.oxygenUndocumented ? 'note' : 'ok');
    setAttr(this, 'data-ov-band', r.band === null ? null : String(r.band));
    setAttr(this, 'data-ov-red', r.singleRed.length ? '' : null);
    setAttr(this, 'data-ov-urgent', r.urgent.length ? '' : null);
    /* 🔴 A PAPERWORK REFUSAL MUST NOT BE DRAWN IN THE 'ALL WELL' COLOUR. A
     * scale nobody signed for and oxygen nobody documented leave the TOTAL
     * intact, so the block stayed in the accent and said the problem in the
     * same green as a clean observation. Marked, so the form can differ. */
    setAttr(this, 'data-ov-paperwork', r.scaleRefused || r.oxygenUndocumented ? '' : null);
    /* 🔴 INCOMPLETE IS A QUALIFIER, NOT A REFUSAL. The guidance says the score
     * "should still be calculated"; withholding it would lose a trigger it
     * says may still fire. What is refused is the total passing as complete. */
    setAttr(this, 'data-ov-qualified', r.state === 'incomplete' ? 'unchecked' : null);
    setAttr(this, 'data-ov-refusal', r.state === 'empty' ? 'unknown' : null);

    setText(q('.ov-score__total'), r.state === 'empty' ? 'NO OBSERVATION' : String(r.total));
    setText(q('.ov-score__of'), r.state === 'empty' ? ''
      : r.incomplete.length ? `FROM ${r.counted} OF ${r.of}` : `FROM ALL ${r.of}`);
    setText(q('.ov-score__why'), r.why);

    this.paintParams(r, red);

    // Rec. 28: the scale not in use is crossed out, not simply absent.
    const scales = q('.ov-score__scales');
    if (!rd) { scales.innerHTML = ''; } else {
      const html = [1, 2].map((n) => {
        const on = rd.scale === n;
        const bad = on && n === 2 && r.scaleRefused;
        return `<span class="ov-score__scale"${on ? ' data-ov-on' : ''}${bad ? ' data-ov-unsigned' : ''}>`
          + `SpO2 SCALE ${n}${on && n === 2 ? (rd.scaleBy ? ` · ${esc(rd.scaleBy)}` : ' · NOBODY RECORDED') : ''}</span>`;
      }).join('');
      if (scales.innerHTML !== html) scales.innerHTML = html;
    }

    const ox = q('.ov-score__oxygen');
    setText(ox, !rd ? '' : !rd.oxygen.on ? 'AIR'
      : `OXYGEN · ${rd.oxygen.rate || 'RATE NOT RECORDED'} · ${rd.oxygen.device || 'DEVICE NOT RECORDED'}`);
    setAttr(ox, 'data-ov-undocumented', r.oxygenUndocumented ? '' : null);

    this.setAttribute('aria-label', r.state === 'empty'
      ? `${this.label()}: no observation`
      : `${this.label()}: ${r.total}${r.incomplete.length ? `, incomplete, from ${r.counted} of ${r.of} parameters` : `, from all ${r.of}`}`
        + (r.why ? `. ${r.why.toLowerCase()}` : ''));

    setText(q('.ov-score__foot'), this._malformed
      ? `${this._malformed} parameter${this._malformed > 1 ? 's' : ''} this element could not read` : '');
  }

  paintParams(r, red) {
    const list = this.querySelector('.ov-score__params');
    const rd = this._reading;
    const params = rd ? rd.parameters : [];
    const key = params.map((p) => p.name).join('|');
    if (this._key !== key) {
      this._key = key;
      list.innerHTML = params.map((p) => `
        <li class="ov-score__param" data-ov-param="${esc(p.name)}">
          <span class="ov-score__pname">${esc(p.name)}</span>
          <span class="ov-score__pvalue"></span>
          <span class="ov-score__pscore"></span>
          <span class="ov-score__pnote"></span>
        </li>`).join('');
    }
    params.forEach((p, i) => {
      const li = list.children[i];
      if (!li) return;
      const absent = p.missing ? ABSENT[p.missing] : null;
      setAttr(li, 'data-ov-absent', p.missing || null);
      setAttr(li, 'data-ov-urgent', absent && absent.urgent ? '' : null);
      setAttr(li, 'data-ov-score', p.score === null ? null : String(p.score));
      setAttr(li, 'data-ov-red', p.score !== null && p.score >= red ? '' : null);
      setText(li.querySelector('.ov-score__pvalue'), p.value === null ? '—' : `${p.value}${p.unit ? ' ' + p.unit : ''}`);
      // 🔴 The score column of an absent parameter is a DASH, never a 0.
      setText(li.querySelector('.ov-score__pscore'), p.score === null ? '—' : String(p.score));
      setText(li.querySelector('.ov-score__pnote'), absent
        ? absent.word + (absent.urgent ? ' · IMMEDIATE RESPONSE' : ' · NOT SCORED')
        : p.score !== null && p.score >= red ? 'SINGLE RED' : '');
    });
    setAttr(list, 'hidden', params.length ? null : '');
  }
}

define('ov-score', OvScore);
