/* <ov-likelihood> - a finding's certainty in calibrated words, and only the
 * words its evidence has earned.
 *
 * For aegis, antiseptic, terminal and machina. The IPCC's
 * calibrated language (AR5 Guidance Note, Mastrandrea et al. 2010): a
 * finding is judged on EVIDENCE (limited, medium, robust) and AGREEMENT (low,
 * medium, high); from those comes a CONFIDENCE (very low to very high); and
 * only a well-founded finding carries a LIKELIHOOD ("likely", 66-100%).
 *
 *   <ov-likelihood label="FINDING 3.2"></ov-likelihood>
 *   plate.finding = {
 *     statement: 'Dockside tide gauge drift exceeds 2 mm/yr',
 *     evidence: 'robust', agreement: 'high',
 *     confidence: 'high',
 *     likelihood: 'very likely',          // or a range: [0.9, 0.95]; or a number: 0.8
 *     basis: 'Three independent gauges, one survey',   // the traceable account
 *   };
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 NOT ENOUGH EVIDENCE, NO CONFIDENCE AND NO PROBABILITY. With low
 * agreement and limited evidence the plate shows those two terms and nothing
 * else: a confidence or likelihood handed in is withheld and said. STATED,
 * ¶8: "For findings with low agreement and limited evidence, assign summary
 * terms for your evaluation of evidence and agreement"; ¶11A: "Confidence
 * should not be assigned; assign summary terms for evidence and agreement."
 *
 * Five more, each from the same note:
 *
 * 1. A LIKELIHOOD NEEDS HIGH CONFIDENCE. A likelihood is shown only when
 *    confidence is high or very high, or, with no confidence given, when the
 *    evidence is robust and agreement high. Otherwise it is withheld and the
 *    confidence that stopped it is named. ¶11E/F: "Assign a likelihood...
 *    for which confidence should be 'high' or 'very high'."
 * 2. CONFIDENCE IS NOT A NUMBER. It is five ordinal steps, drawn as steps,
 *    never a percentage; a number handed in as a confidence is refused. ¶9:
 *    "Confidence should not be interpreted probabilistically."
 * 3. A TERM IS A RANGE. "Likely" is drawn from 66% to 100%, fuzzy at its
 *    edge, never as a point at 66; a range handed in is drawn as that range
 *    with no term, as ¶10 prefers. A bare number is shown as the number: it
 *    is never turned into a word, because the terms overlap and choosing one
 *    is the author's call. A term and a number that disagree are refused.
 * 4. "ABOUT AS LIKELY AS NOT" IS NOT "WE DON'T KNOW". Withheld for a
 *    finding that has not earned a likelihood, with that reason. ¶10:
 *    "'About as likely as not' should not be used to express a lack of
 *    knowledge."
 * 5. LOW CONFIDENCE CARRIES ITS REASONS. A low or very low confidence with
 *    no `basis` is shown and flagged: ¶9, "the reasons for their
 *    presentation should be carefully explained."
 *
 * No finding at all is the kit's `unknown`: NO FINDING.
 */

import { define } from './ov-core.js';
import { apply } from './ov-refusal.js';

const lkText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LK_EVIDENCE = ['limited', 'medium', 'robust'];
const LK_AGREEMENT = ['low', 'medium', 'high'];
const LK_CONFIDENCE = ['very low', 'low', 'medium', 'high', 'very high'];
/* Table 1, and its footnote's three AR4 terms. [low, high] as fractions. */
const LK_TERMS = {
  'virtually certain': [0.99, 1], 'extremely likely': [0.95, 1], 'very likely': [0.9, 1],
  likely: [0.66, 1], 'more likely than not': [0.5, 1], 'about as likely as not': [0.33, 0.66],
  unlikely: [0, 0.33], 'very unlikely': [0, 0.1], 'extremely unlikely': [0, 0.05],
  'exceptionally unlikely': [0, 0.01],
};
const lkWord = (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : null);
const lkPct = (x) => `${Math.round(x * 100)}%`;
const lkFin = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? null
  : Number.isFinite(Number(v)) ? Number(v) : null);

class OvLikelihood extends HTMLElement {
  static observedAttributes = ['src', 'label'];

  connectedCallback() {
    this._finding = this._finding === undefined ? null : this._finding;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get finding() { return this._finding; }
  set finding(v) { this._finding = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._finding = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._finding = null;
    }
    this.paint();
  }

  /* The finding -> what may be shown, and why anything is withheld. */
  resolve() {
    const F = this._finding;
    if (!F) return { reason: 'NO FINDING' };
    const ev = lkWord(F.evidence), ag = lkWord(F.agreement);
    const e = LK_EVIDENCE.indexOf(ev), a = LK_AGREEMENT.indexOf(ag);
    if (e < 0 || a < 0) return { reason: e < 0 && a < 0 ? 'EVIDENCE AND AGREEMENT NOT GIVEN' : e < 0 ? 'EVIDENCE NOT GIVEN' : 'AGREEMENT NOT GIVEN' };
    const out = { e, a, ev, ag, statement: F.statement ? String(F.statement) : '', basis: F.basis ? String(F.basis) : '', flags: [] };
    const floor = e === 0 && a === 0;

    // ---- confidence ---------------------------------------------------------
    const cRaw = F.confidence;
    const cWord = lkWord(cRaw);
    let c = cWord === null ? -1 : LK_CONFIDENCE.indexOf(cWord);
    if (cRaw !== undefined && cRaw !== null && typeof cRaw !== 'string') {
      out.confidence = { withheld: 'CONFIDENCE IS NOT A NUMBER' }; c = -1;
    } else if (cWord !== null && c < 0) {
      out.confidence = { withheld: `"${cWord}" IS NOT A CONFIDENCE LEVEL` };
    } else if (c >= 0 && floor) {
      out.confidence = { withheld: 'NOT ASSIGNED: LIMITED EVIDENCE, LOW AGREEMENT' }; c = -1;
    } else if (c >= 0) {
      out.confidence = { level: c };
      if (c <= 1 && !out.basis) out.flags.push(`${LK_CONFIDENCE[c]} confidence given without its reasons`);
    } else {
      out.confidence = { none: true };
    }

    // ---- likelihood ---------------------------------------------------------
    const L = F.likelihood;
    const given = L !== undefined && L !== null && L !== '';
    if (given) {
      let lk;
      const pair = Array.isArray(L) ? L.map(lkFin) : null;
      const term = lkWord(typeof L === 'string' ? L : null);
      const num = lkFin(typeof L === 'number' ? L : F.probability);
      if (pair) {
        lk = pair.length === 2 && pair.every((x) => x !== null && x >= 0 && x <= 1) && pair[0] <= pair[1]
          ? { lo: pair[0], hi: pair[1], kind: 'range' } : { withheld: 'RANGE NOT UNDERSTOOD' };
      } else if (term !== null) {
        const r = LK_TERMS[term];
        if (!r) lk = { withheld: `"${term}" IS NOT A CALIBRATED TERM` };
        else if (num !== null && (num < r[0] || num > r[1])) lk = { withheld: `${term.toUpperCase()} DOES NOT COVER ${lkPct(num)}` };
        else lk = { lo: r[0], hi: r[1], kind: 'term', term };
      } else if (num !== null && num >= 0 && num <= 1) {
        lk = { lo: num, hi: num, kind: 'number' };
      } else {
        lk = { withheld: 'LIKELIHOOD NOT UNDERSTOOD' };
      }
      // Earned only at high confidence, or with none given, robust and high.
      if (!lk.withheld) {
        const earned = c >= 3 || (c < 0 && !out.confidence.withheld && e === 2 && a === 2);
        if (!earned) {
          const why = floor ? 'LIMITED EVIDENCE, LOW AGREEMENT'
            : c >= 0 ? `CONFIDENCE ${LK_CONFIDENCE[c].toUpperCase()}` : `NO CONFIDENCE, ${ev.toUpperCase()} EVIDENCE, ${ag.toUpperCase()} AGREEMENT`;
          lk = { withheld: lk.term === 'about as likely as not'
            ? `ABOUT AS LIKELY AS NOT IS NOT "UNKNOWN": ${why}` : `WITHHELD: ${why}` };
        }
      }
      out.likelihood = lk;
    } else {
      out.likelihood = { none: true };
    }
    if (!out.basis) out.flags.push('no traceable account given');
    return out;
  }

  paint() {
    this.removeAttribute('data-ov-likelihood');
    const r = this.resolve();
    const label = this.getAttribute('label') || '';
    if (r.reason) {
      this.innerHTML = `<div class="ov-likelihood__void">${lkText(r.reason)}</div>`;
      apply(this, { reason: 'unknown' });
      this.setAttribute('aria-label', `${label ? label + ', ' : ''}likelihood, ${r.reason.toLowerCase()}`);
      this.setAttribute('data-ov-likelihood', 'none');
      this._r = r;
      return;
    }

    // ---- evidence x agreement: the note's Figure 1, this finding's cell marked
    let grid = '';
    for (let row = 2; row >= 0; row--) {
      for (let col = 0; col < 3; col++) {
        const on = row === r.a && col === r.e;
        grid += `<i class="ov-likelihood__cell is-s${row + col}${on ? ' is-on' : ''}" title="${LK_AGREEMENT[row]} agreement, ${LK_EVIDENCE[col]} evidence"></i>`;
      }
    }
    const matrix = `<div class="ov-likelihood__matrix"><span class="ov-likelihood__axis is-y">AGREEMENT</span>`
      + `<div class="ov-likelihood__cells">${grid}</div><span class="ov-likelihood__axis is-x">EVIDENCE</span></div>`;
    const terms = `<div class="ov-likelihood__terms"><b>${lkText(r.ev.toUpperCase())}</b> EVIDENCE<br><b>${lkText(r.ag.toUpperCase())}</b> AGREEMENT</div>`;

    // ---- confidence: five steps, words only ----------------------------------
    let conf;
    if (r.confidence.level !== undefined) {
      const pips = LK_CONFIDENCE.map((w, i) => `<i class="ov-likelihood__pip${i <= r.confidence.level ? ' is-on' : ''}" title="${w}"></i>`).join('');
      conf = `<div class="ov-likelihood__conf"><span class="ov-likelihood__k">CONFIDENCE</span><span class="ov-likelihood__pips">${pips}</span>`
        + `<em class="ov-likelihood__word">${lkText(LK_CONFIDENCE[r.confidence.level])}</em></div>`;
    } else if (r.confidence.withheld) {
      conf = `<div class="ov-likelihood__conf is-withheld"><span class="ov-likelihood__k">CONFIDENCE</span><span class="ov-likelihood__held">${lkText(r.confidence.withheld)}</span></div>`;
    } else {
      conf = `<div class="ov-likelihood__conf is-none"><span class="ov-likelihood__k">CONFIDENCE</span><span class="ov-likelihood__held">NOT ASSIGNED</span></div>`;
    }

    // ---- likelihood: a range on 0-100%, never a point unless it was a number --
    let like;
    const L = r.likelihood;
    if (L.withheld) {
      like = `<div class="ov-likelihood__like is-withheld"><span class="ov-likelihood__k">LIKELIHOOD</span><span class="ov-likelihood__held">${lkText(L.withheld)}</span></div>`;
    } else if (L.none) {
      like = `<div class="ov-likelihood__like is-none"><span class="ov-likelihood__k">LIKELIHOOD</span><span class="ov-likelihood__held">NOT QUANTIFIED</span></div>`;
    } else {
      const say = L.kind === 'term' ? `<em>${lkText(L.term)}</em> ${lkPct(L.lo)}–${lkPct(L.hi)}`
        : L.kind === 'range' ? `${lkPct(L.lo)}–${lkPct(L.hi)}` : `${lkPct(L.lo)}`;
      const mark = L.kind === 'number'
        ? `<i class="ov-likelihood__point" style="left:${(L.lo * 100).toFixed(1)}%"></i>`
        : `<i class="ov-likelihood__range${L.kind === 'term' ? ' is-fuzzy' : ''}" style="left:${(L.lo * 100).toFixed(1)}%;width:${((L.hi - L.lo) * 100).toFixed(1)}%"></i>`;
      like = `<div class="ov-likelihood__like"><span class="ov-likelihood__k">LIKELIHOOD</span><span class="ov-likelihood__say">${say}</span>`
        + `<span class="ov-likelihood__track">${mark}<i class="ov-likelihood__tick" style="left:0"></i><i class="ov-likelihood__tick" style="left:50%"></i><i class="ov-likelihood__tick" style="left:100%"></i></span>`
        + `<span class="ov-likelihood__ends"><span>0%</span><span>50%</span><span>100%</span></span></div>`;
    }

    const words = [];
    words.push({ t: `${r.ev} evidence, ${r.ag} agreement` });
    if (r.confidence.level !== undefined) words.push({ t: `${LK_CONFIDENCE[r.confidence.level]} confidence` });
    else if (r.confidence.withheld) words.push({ t: `confidence ${r.confidence.withheld.toLowerCase()}`, flag: true });
    if (L.withheld) words.push({ t: `likelihood ${L.withheld.toLowerCase().replace(/^withheld: /, 'withheld: ')}`, flag: true });
    else if (!L.none) words.push({ t: L.kind === 'term' ? `${L.term}, ${lkPct(L.lo)} to ${lkPct(L.hi)}` : L.kind === 'range' ? `${lkPct(L.lo)} to ${lkPct(L.hi)}, no term` : `${lkPct(L.lo)}, not turned into a term` });
    for (const f of r.flags) words.push({ t: f, flag: true });

    this.innerHTML = (r.statement ? `<div class="ov-likelihood__statement">${lkText(r.statement)}</div>` : '')
      + `<div class="ov-likelihood__plate"><div class="ov-likelihood__basis">${matrix}${terms}</div><div class="ov-likelihood__claims">${conf}${like}</div></div>`
      + (r.basis ? `<div class="ov-likelihood__account">${lkText(r.basis)}</div>` : '')
      + `<div class="ov-likelihood__readout">${words.map((w) => `<span${w.flag ? ' class="is-flag"' : ''}>${lkText(w.t)}</span>`).join('')}</div>`;
    const withheld = !!(L.withheld || r.confidence.withheld);
    this.setAttribute('data-ov-likelihood', withheld ? 'withheld' : L.none ? 'summary' : 'quantified');
    const said = words.map((w) => w.t).join(', ');
    apply(this, { text: said });
    this.setAttribute('aria-label', `${label ? label + ', ' : ''}${r.statement ? r.statement + ', ' : ''}${said}`);
    this._r = r;
  }

  /* What the plate is claiming, for a harness or a host app. */
  report() {
    const r = this._r;
    if (!r || r.reason) return { state: 'none', reason: r ? r.reason : null };
    const L = r.likelihood, C = r.confidence;
    return {
      state: this.getAttribute('data-ov-likelihood'),
      evidence: r.ev, agreement: r.ag,
      confidence: C.level !== undefined ? LK_CONFIDENCE[C.level] : null, confidenceWithheld: C.withheld || null,
      likelihood: L.withheld || L.none ? null : { lo: L.lo, hi: L.hi, kind: L.kind, term: L.term || null },
      likelihoodWithheld: L.withheld || null, flags: r.flags.slice(),
    };
  }
}

define('ov-likelihood', OvLikelihood);

export { OvLikelihood };
