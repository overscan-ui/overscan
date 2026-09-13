/* <ov-histogram> - counts in bins, and nothing between them.
 *
 * A histogram is the
 * chart most often drawn as something it is not: a smooth curve laid over a
 * few dozen samples, an empty bin bridged by its neighbours, the values past
 * the axis quietly dropped or piled into the end bins, and a bin count nobody
 * chose on purpose deciding the shape.
 *
 * ⭐ THE REFUSALS.
 *   AN EMPTY BIN STAYS EMPTY. It is drawn as a hollow mark on the baseline and
 *   counted. There is no smoothing, no density curve, no mode that has one: a
 *   curve through the bins is a distribution nobody measured.
 *   OUT OF RANGE IS COUNTED, NOT DROPPED AND NOT CLAMPED. Values below `min`
 *   or above `max` get their own bins at each end, set apart and drawn
 *   dashed, with their counts. Folding them into the end bins would make the
 *   edge of the axis look like the edge of the data.
 *   A VALUE THAT IS NOT A NUMBER IS COUNTED TOO, as "no value", not skipped.
 *   TOO FEW FOR A SHAPE. Below `min-count` samples (default 20) the bars are
 *   refused: raw values are drawn as a rug, one tick each, and pre-binned
 *   counts are printed as numbers. A handful of points has no distribution.
 *   UNEQUAL BINS ARE DRAWN AS DENSITY. When bins differ in width, bar height
 *   is count per unit, and the readout says so, because an area is what the
 *   eye reads and a wide bin would otherwise look like more.
 *   THE BINNING IS STATED. The bin width, and who chose it (the author's
 *   `bins`, or Sturges' rule when there is none), is part of the readout.
 *
 * Input, as the `histogram` property or from `src`, one of:
 *   { values: [n, ...] }                          raw samples, binned here
 *   { edges: [e0, ..., ek], counts: [c1, ..., ck], underflow?, overflow?, missing? }
 *                                                 already binned; never rebinned
 * Bins are half-open [a, b), the last closed [a, b]. `min`/`max` set the range
 * for raw values; without them the range is the data's own and nothing can be
 * out of it, which the readout says. `unit` labels the axis.
 */

import { define } from './ov-core.js';

const histText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/* A number short enough for an axis label, without inventing precision. */
const histNum = (x) => {
  if (!Number.isFinite(x)) return '?';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(1);
  return String(Number(x.toPrecision(4)));
};
const histCount = (n) => n.toLocaleString('en-US');

class OvHistogram extends HTMLElement {
  static observedAttributes = ['src', 'min', 'max', 'bins', 'min-count', 'unit'];

  connectedCallback() {
    this._histogram = this._histogram || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get histogram() { return this._histogram; }
  set histogram(v) { this._histogram = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._histogram = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._histogram = null;
    }
    this.paint();
  }

  /* ⚠️ Number(null) is 0, so an absent attribute read as a number would set a
     range of 0 or a bin count of 0. Absence is checked first, every time. */
  attrNum(raw) {
    if (raw === null || raw.trim() === '') return NaN;
    return Number(raw);
  }

  refuse(text) {
    this.setAttribute('data-ov-refusal', 'unknown');
    this.innerHTML = `<div class="ov-histogram__void">${histText(text)}</div>`;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Histogram, ${text.toLowerCase()}`);
  }

  /* Raw values into bins. Returns the same shape as pre-binned input. */
  binValues(values) {
    const finite = [];
    let missing = 0;
    for (const v of values) {
      const x = v === null || v === undefined || v === '' ? NaN : Number(v);
      if (Number.isFinite(x)) finite.push(x); else missing += 1;
    }
    const aMin = this.attrNum(this.getAttribute('min'));
    const aMax = this.attrNum(this.getAttribute('max'));
    const declared = Number.isFinite(aMin) && Number.isFinite(aMax) && aMax > aMin;
    // A loop, not Math.min(...finite): a spread of 200,000 arguments throws.
    let lo = declared ? aMin : Infinity, hi = declared ? aMax : -Infinity;
    if (!declared) for (const x of finite) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (!finite.length) { lo = 0; hi = 1; }
    if (hi === lo) { hi = lo + 1; }
    const aBins = this.attrNum(this.getAttribute('bins'));
    const chosen = Number.isInteger(aBins) && aBins > 0;
    // Sturges when nobody chose: ceil(log2 n) + 1. Stated, never silent.
    const k = chosen ? aBins : Math.max(1, Math.ceil(Math.log2(Math.max(1, finite.length))) + 1);
    const w = (hi - lo) / k;
    const edges = Array.from({ length: k + 1 }, (_, i) => (i === k ? hi : lo + i * w));
    const counts = new Array(k).fill(0);
    let underflow = 0, overflow = 0;
    for (const x of finite) {
      if (x < lo) { underflow += 1; continue; }
      if (x > hi) { overflow += 1; continue; }
      counts[x === hi ? k - 1 : Math.min(k - 1, Math.floor((x - lo) / w))] += 1;
    }
    return {
      edges, counts, missing, finite,
      underflow: declared ? underflow : null, overflow: declared ? overflow : null,
      binning: chosen ? `${k} bins` : `${k} bins by Sturges' rule`,
      range: declared ? 'declared' : 'data',
    };
  }

  paint() {
    const H = this._histogram;
    this.removeAttribute('data-ov-refusal');
    this.removeAttribute('data-ov-shape');
    if (!H) { this.refuse('NO DATA'); return; }

    let B;
    if (Array.isArray(H.values)) {
      B = this.binValues(H.values);
    } else if (Array.isArray(H.edges) && Array.isArray(H.counts)) {
      const edges = H.edges.map(Number), counts = H.counts.map(Number);
      const ok = edges.length === counts.length + 1 && counts.length > 0
        && edges.every(Number.isFinite) && edges.every((e, i) => i === 0 || e > edges[i - 1])
        && counts.every((c) => Number.isInteger(c) && c >= 0);
      if (!ok) { this.refuse('BINS DO NOT MATCH THEIR EDGES: NOT DRAWN'); return; }
      const opt = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && v !== null && v !== undefined ? Number(v) : null);
      B = { edges, counts, missing: opt(H.missing) ?? 0, finite: null,
        underflow: opt(H.underflow), overflow: opt(H.overflow),
        binning: `${counts.length} bins as given`, range: 'given' };
    } else {
      this.refuse('NO DATA'); return;
    }

    const unit = this.getAttribute('unit') || '';
    const u = unit ? ` ${unit}` : '';
    const k = B.counts.length;
    const inRange = B.counts.reduce((a, c) => a + c, 0);
    const n = inRange + (B.underflow || 0) + (B.overflow || 0);
    const widths = B.counts.map((_, i) => B.edges[i + 1] - B.edges[i]);
    const unequal = widths.some((w) => Math.abs(w - widths[0]) > 1e-9 * Math.abs(widths[0] || 1));
    const aMinCount = this.attrNum(this.getAttribute('min-count'));
    const minCount = Number.isFinite(aMinCount) && aMinCount >= 0 ? aMinCount : 20;
    const tooFew = n < minCount;
    const empty = B.counts.filter((c) => c === 0).length;

    const W = 360, top = 16, base = 128, left = 34, right = 10;
    const hasUnder = B.underflow !== null, hasOver = B.overflow !== null;
    const slot = 18, gapS = 8;
    const x0 = left + (hasUnder ? slot + gapS : 0);
    const x1 = W - right - (hasOver ? slot + gapS : 0);
    const lo = B.edges[0], hi = B.edges[k];
    const X = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
    const heights = B.counts.map((c, i) => (unequal ? c / widths[i] : c));
    const peak = Math.max(...heights, unequal ? 0 : Math.max(B.underflow || 0, B.overflow || 0), 1e-12);
    const Y = (h) => base - (h / peak) * (base - top);

    let g = `<line class="ov-histogram__axis" x1="${left}" y1="${base}" x2="${W - right}" y2="${base}"/>`;
    // Edge labels: first, last and a few between, never more than fit.
    const step = Math.max(1, Math.ceil((k + 1) / 6));
    B.edges.forEach((e, i) => {
      if (i % step && i !== k) return;
      if (i !== k && k - i < step && i !== 0) return;
      const x = X(e);
      // Kept inside the frame: the last label ends at its tick, the first starts at it.
      const anchor = x > W - right - 14 ? 'end' : x < left + 10 && !hasUnder ? 'start' : 'middle';
      g += `<line class="ov-histogram__tick" x1="${x.toFixed(1)}" y1="${base}" x2="${x.toFixed(1)}" y2="${base + 3}"/>`
        + `<text class="ov-histogram__text" x="${x.toFixed(1)}" y="${base + 12}" text-anchor="${anchor}">${histNum(e)}</text>`;
    });
    if (!tooFew) {
      g += `<text class="ov-histogram__text" x="${left - 4}" y="${top + 3}" text-anchor="end">${unequal ? histNum(peak) : histCount(Math.round(peak))}</text>`
        + `<text class="ov-histogram__text" x="${left - 4}" y="${base}" text-anchor="end">0</text>`;
    }

    if (tooFew && B.finite) {
      // ⭐ A rug, not bars: every value where it fell, and no shape claimed.
      for (const v of B.finite) {
        if (v < lo || v > hi) continue;
        const x = X(v).toFixed(1);
        g += `<line class="ov-histogram__rug" x1="${x}" y1="${base - 26}" x2="${x}" y2="${base - 2}"/>`;
      }
    } else if (tooFew) {
      // Pre-binned and too few: the counts as numbers, no bars.
      B.counts.forEach((c, i) => {
        const cx = (X(B.edges[i]) + X(B.edges[i + 1])) / 2;
        g += `<text class="ov-histogram__num${c ? '' : ' is-empty'}" x="${cx.toFixed(1)}" y="${base - 8}" text-anchor="middle">${c}</text>`;
      });
    } else {
      B.counts.forEach((c, i) => {
        const xa = X(B.edges[i]), xb = X(B.edges[i + 1]);
        const range = `[${histNum(B.edges[i])}, ${histNum(B.edges[i + 1])}${i === k - 1 ? ']' : ')'}${u}`;
        if (c === 0) {
          // The empty bin stays empty: a hollow mark on the baseline, counted.
          g += `<rect class="ov-histogram__empty" x="${(xa + 1).toFixed(1)}" y="${base - 3}" width="${Math.max(1, xb - xa - 2).toFixed(1)}" height="3"><title>${histText(range)}: 0</title></rect>`;
          return;
        }
        const y = Y(heights[i]);
        g += `<rect class="ov-histogram__bar" x="${(xa + 0.5).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, xb - xa - 1).toFixed(1)}" height="${(base - y).toFixed(1)}"><title>${histText(range)}: ${histCount(c)}</title></rect>`;
      });
    }

    // Out of range: its own bins, set apart and dashed, never folded in.
    const side = (count, x, label, cls) => {
      if (count === null) return '';
      const h = tooFew || unequal ? 0 : count;
      const y = count ? Math.min(base - 3, Y(h)) : base - 3;
      return `<rect class="ov-histogram__out ${cls}${count ? '' : ' is-zero'}" x="${x}" y="${y.toFixed(1)}" width="${slot}" height="${(base - y).toFixed(1)}"><title>${histText(label)}: ${count}</title></rect>`
        + `<text class="ov-histogram__text is-out" x="${x + slot / 2}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${count}</text>`
        + `<text class="ov-histogram__text is-out" x="${x + slot / 2}" y="${base + 12}" text-anchor="middle">${label.startsWith('below') ? '&lt;' : '&gt;'}</text>`;
    };
    g += side(B.underflow, left, `below ${histNum(lo)}${u}`, 'is-under');
    g += side(B.overflow, W - right - slot, `above ${histNum(hi)}${u}`, 'is-over');

    const words = [`n = ${histCount(n)}`];
    // A rug draws no bins, so it states none: a binning nobody sees is not a claim.
    const rug = tooFew && B.finite;
    if (!unequal && !rug) words.push(`bin ${histNum(widths[0])}${u}`);
    if (!rug) words.push(B.binning);
    if (unequal) words.push(`bins unequal: height is count per${unit ? ` ${unit}` : ' unit'}`);
    if (tooFew) words.push(`${histCount(n)} below ${minCount}: ${B.finite ? 'values shown' : 'counts shown'}, not a distribution`);
    else if (empty) words.push(`${empty} empty bin${empty === 1 ? '' : 's'}, not smoothed`);
    if (B.underflow) words.push(`${histCount(B.underflow)} below ${histNum(lo)}${u}`);
    if (B.overflow) words.push(`${histCount(B.overflow)} above ${histNum(hi)}${u}`);
    if (B.range === 'data') words.push('range from the data');
    if (B.missing) words.push(`${histCount(B.missing)} no value`);

    this.innerHTML = `<svg class="ov-histogram__svg" viewBox="0 0 ${W} ${base + 18}" aria-hidden="true">${g}</svg>`
      + `<div class="ov-histogram__readout">${words.map((w) => `<span${/below|above|no value|empty|unequal|not a distribution/.test(w) ? ' class="is-flag"' : ''}>${histText(w)}</span>`).join('')}</div>`;
    if (tooFew) this.setAttribute('data-ov-refusal', 'unknown');
    this.setAttribute('data-ov-shape', tooFew ? 'refused' : unequal ? 'density' : 'count');
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Histogram, ${words.join(', ')}`);
  }
}

define('ov-histogram', OvHistogram);

export { OvHistogram };
