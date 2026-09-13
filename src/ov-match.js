/* <ov-match> - a probe against a database, and what the search can honestly say.
 *
 * The screen-graphics trope from Blade Runner 2049's face and
 * DNA searches and Minority Report, and the scan-to-identify of EVE, Prey and
 * Metroid: a probe, a candidate, a verdict. The trope's lie, as Henry
 * Jenkins' blog put it, is that screen recognition is shown as infallible.
 *
 * ⭐ THE REFUSAL: NEVER A BARE MATCH. The verdict always carries the score,
 * the margin over the runner-up and how many records were searched, because
 * a score means nothing without the other two. And it declines to decide:
 *
 *   MATCH             top score >= `threshold` AND ahead of #2 by >= `margin`
 *   AMBIGUOUS         top two both close; it names both and picks neither
 *   NO DETERMINATION  best score below threshold; OR the search size was not
 *                     reported (a score with no denominator); OR there is no
 *                     runner-up, so there is no margin to show
 *
 * The record card appears ONLY on a MATCH: showing the best candidate's file
 * under NO DETERMINATION would identify them anyway. And on a MATCH, a field
 * whose own confidence is below `reveal` reads WITHHELD with that confidence,
 * the way a scan fills a record in only as its strength allows.
 *
 * Input, as the `result` property or from `src` (a JSON file):
 *   { probe: { label, signature: [0..1, ...] },
 *     candidates: [{ id, label, score, signature, fields: [{ name, value, confidence }] }],
 *     searched }
 * `signature` is any fixed-length feature vector: a print, a sequence, a voice.
 */

import { define } from './ov-core.js';

const matchText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const matchNum = (raw, d) => { const v = raw === null ? NaN : Number(raw); return Number.isFinite(v) ? v : d; };

class OvMatch extends HTMLElement {
  static observedAttributes = ['src', 'threshold', 'margin', 'reveal', 'top', 'signature'];

  connectedCallback() {
    this._result = this._result || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get result() { return this._result; }
  set result(v) { this._result = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._result = data;
    } catch {
      if (this.getAttribute('src') === src) this._result = null;
    }
    this.paint();
  }

  /* A feature vector, drawn one of five ways (`signature`): the same data,
     so the choice is the reader's, not the element's. Every mode keeps two
     rules. Where the candidate differs from the probe by more than 0.15 the
     mark is flagged: the disagreement is drawn, not averaged. And a MISSING
     feature (null, or not a number) is left as a GAP and never compared:
     drawing it at zero would show a value nobody measured, and comparing it
     would mark agreement or disagreement with nothing.

       bars   radial lines from an inner ring (the default)
       trace  a line through the tips, broken at every missing feature
       strip  a linear barcode
       ring   a ring of cells whose brightness is the value
       dots   one dot per feature at its radius */
  disc(sig, against, label) {
    const mode = ['bars', 'trace', 'strip', 'ring', 'dots'].includes(this.getAttribute('signature'))
      ? this.getAttribute('signature') : 'bars';
    const n = sig.length, cx = 60, cy = 60, r0 = 18, r1 = 52;
    const val = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Math.max(0, Math.min(1, Number(x))));
    const vals = sig.map(val);
    const ref = against ? against.map(val) : null;
    const off = (i) => !!ref && vals[i] !== null && ref[i] !== null && Math.abs(vals[i] - ref[i]) > 0.15;
    const polar = (i, r) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const f1 = (x) => x.toFixed(1);
    let g = `<svg class="ov-match__disc is-${mode}" viewBox="0 0 120 132" aria-hidden="true">`;
    if (mode !== 'strip') g += `<circle class="ov-match__ring" cx="${cx}" cy="${cy}" r="${r0}"/>`;

    if (mode === 'strip') {
      const x0 = 6, w = 108 / Math.max(1, n), base = 96;
      vals.forEach((v, i) => {
        const x = x0 + (i + 0.5) * w;
        g += v === null
          ? `<line class="ov-match__gap" x1="${f1(x)}" y1="${base}" x2="${f1(x)}" y2="${base - 4}"/>`
          : `<line class="ov-match__bar${off(i) ? ' is-off' : ''}" x1="${f1(x)}" y1="${base}" x2="${f1(x)}" y2="${f1(base - 8 - 72 * v)}"/>`;
      });
      g += `<line class="ov-match__ring" x1="6" y1="${base + 1}" x2="114" y2="${base + 1}"/>`;
    } else if (mode === 'ring') {
      vals.forEach((v, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 0.86) / n) * Math.PI * 2 - Math.PI / 2;
        const pt = (a, r) => `${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`;
        const d = `M${pt(a0, r0 + 6)} L${pt(a0, r1)} A${r1},${r1} 0 0 1 ${pt(a1, r1)} L${pt(a1, r0 + 6)} A${r0 + 6},${r0 + 6} 0 0 0 ${pt(a0, r0 + 6)} z`;
        g += v === null
          ? `<path class="ov-match__cell is-gap" d="${d}"/>`
          : `<path class="ov-match__cell${off(i) ? ' is-off' : ''}" d="${d}" style="fill-opacity:${(0.12 + 0.88 * v).toFixed(2)}"/>`;
      });
    } else if (mode === 'trace') {
      // Runs of present features only: the line breaks at every gap.
      let run = [];
      const flush = () => { if (run.length > 1) g += `<polyline class="ov-match__trace" points="${run.join(' ')}"/>`; run = []; };
      vals.forEach((v, i) => {
        if (v === null) { flush(); const [x, y] = polar(i, r0 + 4); g += `<circle class="ov-match__gapdot" cx="${f1(x)}" cy="${f1(y)}" r="1.4"/>`; return; }
        const [x, y] = polar(i, r0 + (r1 - r0) * v);
        run.push(`${f1(x)},${f1(y)}`);
        if (off(i)) g += `<circle class="ov-match__dot is-off" cx="${f1(x)}" cy="${f1(y)}" r="2"/>`;
      });
      flush();
    } else {
      vals.forEach((v, i) => {
        if (v === null) { const [x, y] = polar(i, r0 + 4); g += `<circle class="ov-match__gapdot" cx="${f1(x)}" cy="${f1(y)}" r="1.4"/>`; return; }
        const [x2, y2] = polar(i, r0 + (r1 - r0) * v);
        if (mode === 'dots') {
          g += `<circle class="ov-match__dot${off(i) ? ' is-off' : ''}" cx="${f1(x2)}" cy="${f1(y2)}" r="1.9"/>`;
        } else {
          const [x1, y1] = polar(i, r0);
          g += `<line class="ov-match__bar${off(i) ? ' is-off' : ''}" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;
        }
      });
    }
    const missing = vals.filter((v) => v === null).length;
    g += `<text class="ov-match__disclabel" x="${cx}" y="128" text-anchor="middle">${matchText(label)}`
      + `${missing ? ` · ${missing} MISSING` : ''}</text></svg>`;
    return g;
  }

  verdict(R) {
    const T = matchNum(this.getAttribute('threshold'), 0.8);
    const M = matchNum(this.getAttribute('margin'), 0.1);
    const list = (R.candidates || []).filter((c) => Number.isFinite(Number(c.score)))
      .slice().sort((a, b) => b.score - a.score);
    const searched = Number(R.searched);
    const [a, b] = list;
    if (!a) return { cls: 'none', text: 'NO DETERMINATION: no candidates returned', list };
    const facts = `best ${a.score.toFixed(2)}`
      + (b ? `, margin ${(a.score - b.score).toFixed(2)} over #2` : '')
      + (Number.isFinite(searched) && searched > 0 ? `, ${searched.toLocaleString('en-US')} records searched` : '');
    if (!(Number.isFinite(searched) && searched > 0)) {
      return { cls: 'none', text: `NO DETERMINATION: search size not reported (${facts})`, list };
    }
    if (a.score < T) return { cls: 'none', text: `NO DETERMINATION: ${facts}, threshold ${T.toFixed(2)}`, list };
    if (!b) return { cls: 'none', text: `NO DETERMINATION: no runner-up, so no margin (${facts})`, list };
    if (a.score - b.score < M) {
      return { cls: 'ambiguous', text: `AMBIGUOUS: ${a.label} ${a.score.toFixed(2)} and ${b.label} ${b.score.toFixed(2)}, margin under ${M.toFixed(2)}`, list, pair: [a, b] };
    }
    return { cls: 'match', text: `MATCH ${a.label}: ${facts}`, list, top: a };
  }

  paint() {
    const R = this._result;
    this.removeAttribute('data-ov-refusal');
    if (!R || !R.probe) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.innerHTML = '<div class="ov-match__void">NO PROBE</div>';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'Identification match, no reading');
      return;
    }
    const v = this.verdict(R);
    const TOP = Math.max(1, Math.round(matchNum(this.getAttribute('top'), 5)));
    const T = matchNum(this.getAttribute('threshold'), 0.8);
    const REVEAL = matchNum(this.getAttribute('reveal'), 0.75);
    const probeSig = R.probe.signature || [];
    // Beside the probe: the match; BOTH of an ambiguous pair, side by side,
    // because showing only the first would pick it after all; and nothing at
    // all when there is no determination.
    const shown = v.top ? [v.top] : v.pair ? v.pair : [];

    let h = `<div class="ov-match__verdict is-${v.cls}">${matchText(v.text)}</div>`
      + `<div class="ov-match__pair" style="--n:${1 + Math.max(1, shown.length)}">${this.disc(probeSig, null, R.probe.label || 'PROBE')}`
      + (shown.length ? shown.map((c) => this.disc(c.signature || [], probeSig, c.label)).join('')
        : `<div class="ov-match__nocand">NO CANDIDATE SHOWN</div>`)
      + `</div>`;

    h += `<ol class="ov-match__list">`;
    for (const c of v.list.slice(0, TOP)) {
      const pct = Math.max(0, Math.min(1, c.score)) * 100;
      h += `<li><span class="ov-match__name">${matchText(c.label)}</span>`
        + `<span class="ov-match__bar-track"><span class="ov-match__fill" style="inline-size:${pct.toFixed(1)}%"></span>`
        + `<span class="ov-match__threshold" style="inset-inline-start:${(T * 100).toFixed(1)}%"></span></span>`
        + `<span class="ov-match__score">${c.score.toFixed(2)}</span></li>`;
    }
    h += `</ol>`;
    if (v.list.length > TOP) h += `<div class="ov-match__more">+${v.list.length - TOP} more below</div>`;

    if (v.top) {
      h += `<dl class="ov-match__card">`;
      for (const f of v.top.fields || []) {
        const conf = Number(f.confidence);
        const open = Number.isFinite(conf) && conf >= REVEAL;
        h += `<dt>${matchText(f.name)}</dt><dd${open ? '' : ' class="is-withheld"'}>`
          + (open ? matchText(f.value) : `WITHHELD (${Number.isFinite(conf) ? conf.toFixed(2) : 'no confidence'})`) + `</dd>`;
      }
      h += `</dl>`;
    } else {
      h += `<div class="ov-match__nocard">NO RECORD SHOWN: no determination</div>`;
    }
    this.innerHTML = h;
    this.setAttribute('data-ov-verdict', v.cls);
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', `Identification match, ${v.text.toLowerCase()}`);
  }
}

define('ov-match', OvMatch);

export { OvMatch };
