/* <ov-fan> - a forecast drawn as the chance of each outcome, with no line
 * through the middle.
 *
 * For industrial, antiseptic, aegis and terminal. A measured
 * history up to NOW, then a projection as bands of equal probability out to
 * 90%, and the space beyond them labelled as the outer 10%. The Bank of
 * England's inflation fan chart, 1996 on.
 *
 *   <ov-fan unit="%" min-draws="50" max-age="86400"></ov-fan>
 *   fan.forecast = {
 *     history: [2.1, 2.3, { value: 2.6, label: '24Q4' }],
 *     horizon: [
 *       { label: '25Q1', quantiles: { 5: 1.9, 15: 2.2, ..., 95: 3.8 } },
 *       { label: '25Q2', draws: [2.4, 3.1, ...] },            // quantiles computed here
 *       { label: '25Q3', mode: 2.8, sigma: [0.4, 0.7] },      // two-piece normal: below, above
 *       null,                                                 // a step with no forecast
 *     ],
 *     age: 3600,                                              // seconds since it was issued
 *   };
 *
 * ── THE REFUSALS ──────────────────────────────────────────────────────────
 *
 * 🔴 NO CENTRAL LINE. The projection is bands and nothing else: no median,
 * mean or mode is drawn through them, and there is no mode that draws one. A
 * step that carries `median`, `mean` or `central` has it counted in the
 * readout and not drawn. STATED: the Bank replaced its line-plus-band chart
 * because it "encouraged the reader to concentrate on [the central
 * projection] ignoring the very wide degree of uncertainty" (Britton, Fisher
 * and Whitley, BoE Quarterly Bulletin 1998). The measured history is a line
 * because it was measured; it stops at NOW.
 *
 * 🔴 THE 90% EDGE IS NOT THE LIMIT. The outermost band has no outline, and the
 * space beyond it is labelled with what it holds ("5% ABOVE", "5% BELOW"),
 * because "there is an implicit ninth and final pair of bands, occupying the
 * white space outside the 90% covered" (same source). The axis leaves that
 * space visible; an author's `min`/`max` that cuts into it or ends on it is
 * marked and said, not quietly obeyed.
 *
 * Four more that fall out of it:
 *
 * 1. EQUAL PROBABILITY, NOT EQUAL WIDTH. Every band holds 10%, so a wide band
 *    is an uncertain stretch, not a big one. Quantiles given with a pair
 *    missing make bands of 20% or more, and the readout says they are unequal.
 * 2. SKEW IS KEPT. The bands above and below are drawn from their own
 *    quantiles and never mirrored, so a risk that leans one way is seen to.
 *    The readout names the lean at the last drawn step.
 * 3. A STEP WITH NO FORECAST IS A GAP. A null step, quantiles that cross, a
 *    spread that is not positive, or fewer than `min-draws` draws (default
 *    50: a 5th percentile needs more than a handful) leaves that step
 *    undrawn and counted. The fan is not bridged across it.
 * 4. A FORECAST HAS AN AGE. Past `max-age` it is STALE, the kit's qualifier.
 *
 * No forecast at all is the kit's `unknown`: NO FORECAST.
 */

import { define } from './ov-core.js';
import { apply } from './ov-refusal.js';

const fanText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fanFinite = (v) => (v === null || v === undefined || v === '' ? null
  : Number.isFinite(Number(v)) ? Number(v) : null);
/* A number short enough for an axis label, without inventing precision. */
const fanNum = (x) => {
  if (!Number.isFinite(x)) return '?';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(1);
  return String(Number(x.toPrecision(3)));
};
const fanAge = (s) => (s < 120 ? `${Math.round(s)}s` : s < 7200 ? `${Math.round(s / 60)}m` : s < 172800 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);

/* The lower quantile of each band pair: 5 pairs with 95, 45 with 55. */
const FAN_LEVELS = [5, 15, 25, 35, 45];
const FAN_CENTRAL = ['median', 'mean', 'central'];

/* Inverse standard normal (Acklam), good to about 1e-9: plenty for a band edge. */
function fanInvNorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -fanInvNorm(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* The Bank's two-piece normal: a normal of spread s1 below the mode and s2
 * above it, joined at the mode. Mass below the mode is s1 / (s1 + s2). */
function fanTwoPiece(mode, s1, s2, p) {
  const below = s1 / (s1 + s2);
  if (p <= below) return mode + s1 * fanInvNorm(p * (s1 + s2) / (2 * s1));
  return mode + s2 * fanInvNorm(0.5 + (p - below) * (s1 + s2) / (2 * s2));
}

/* Linear interpolation between order statistics (R's type 7). */
function fanQuantile(sorted, p) {
  const h = (sorted.length - 1) * p, i = Math.floor(h);
  return i + 1 < sorted.length ? sorted[i] + (h - i) * (sorted[i + 1] - sorted[i]) : sorted[i];
}

const fanAll = () => [...FAN_LEVELS, ...FAN_LEVELS.map((p) => 100 - p).reverse()];

class OvFan extends HTMLElement {
  static observedAttributes = ['src', 'min', 'max', 'unit', 'min-draws', 'max-age', 'label'];

  connectedCallback() {
    this._fan = this._fan === undefined ? null : this._fan;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get forecast() { return this._fan; }
  set forecast(v) { this._fan = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._fan = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._fan = null;
    }
    this.paint();
  }

  /* ⚠️ Number(null) is 0: an absent attribute is checked for absence first. */
  attrNum(raw) {
    if (raw === null || raw.trim() === '') return NaN;
    return Number(raw);
  }

  /* One projection step -> { q: {level: value}, kind, central } or { gap }. */
  step(s) {
    if (!s || typeof s !== 'object') return { gap: 'no forecast' };
    const central = FAN_CENTRAL.some((k) => fanFinite(s[k]) !== null);
    const label = s.label ?? null;
    if (Array.isArray(s.draws)) {
      const xs = s.draws.map(fanFinite).filter((x) => x !== null).sort((a, b) => a - b);
      const aMin = this.attrNum(this.getAttribute('min-draws'));
      const minDraws = Number.isFinite(aMin) && aMin >= 1 ? aMin : 50;
      if (xs.length < minDraws) return { gap: `${xs.length} draws, fewer than ${minDraws}`, label };
      const q = {};
      for (const p of fanAll()) q[p] = fanQuantile(xs, p / 100);
      return { q, kind: 'draws', n: xs.length, central, label };
    }
    if (s.quantiles && typeof s.quantiles === 'object') {
      const q = {};
      for (const p of fanAll()) { const v = fanFinite(s.quantiles[p]); if (v !== null) q[p] = v; }
      return { q, kind: 'given', central, label };
    }
    if (fanFinite(s.mode) !== null && s.sigma !== undefined) {
      const sg = Array.isArray(s.sigma) ? s.sigma.map(fanFinite) : [fanFinite(s.sigma), fanFinite(s.sigma)];
      if (!(sg[0] > 0 && sg[1] > 0)) return { gap: 'spread not positive', label };
      const q = {};
      for (const p of fanAll()) q[p] = fanTwoPiece(Number(s.mode), sg[0], sg[1], p / 100);
      // The mode here is a parameter of the construction, not a line to draw.
      return { q, kind: 'two-piece normal', central, label };
    }
    return { gap: 'no distribution given', label };
  }

  resolve() {
    const F = this._fan;
    if (!F || !Array.isArray(F.horizon) || !F.horizon.length) return { reason: 'NO FORECAST' };
    const history = (Array.isArray(F.history) ? F.history : []).map((h) => (h && typeof h === 'object'
      ? { v: fanFinite(h.value), label: h.label ?? null } : { v: fanFinite(h), label: null }));
    const steps = F.horizon.map((s) => this.step(s));

    // The band pairs every usable step can draw. A pair one step lacks is not
    // invented for it from its neighbours; it is dropped from the whole fan.
    let levels = FAN_LEVELS.slice();
    for (const s of steps) if (s.q) levels = levels.filter((p) => s.q[p] !== undefined && s.q[100 - p] !== undefined);
    const edges = [...levels, ...levels.map((p) => 100 - p).reverse()];
    for (const s of steps) {
      if (!s.q) continue;
      if (!levels.length) { s.gap = 'no band pair given'; delete s.q; continue; }
      const vs = edges.map((p) => s.q[p]);
      if (vs.some((v, i) => i && v < vs[i - 1])) { s.gap = 'quantiles cross'; delete s.q; }
    }
    const drawn = steps.filter((s) => s.q);
    if (!drawn.length) return { reason: 'NO USABLE FORECAST', steps };

    const age = fanFinite(F.age);
    const maxAge = this.attrNum(this.getAttribute('max-age'));
    const stale = age !== null && Number.isFinite(maxAge) && age > maxAge;
    return { history, steps, levels, edges, drawn, age, stale };
  }

  paint() {
    this.removeAttribute('data-ov-fan');
    const r = this.resolve();
    const label = this.getAttribute('label') || '';
    if (r.reason) {
      this.innerHTML = `<div class="ov-fan__void">${fanText(r.reason)}</div>`;
      apply(this, { reason: 'unknown' });
      this.setAttribute('aria-label', `${label ? label + ', ' : ''}fan chart, ${r.reason.toLowerCase()}`);
      this.setAttribute('data-ov-fan', 'none');
      this._r = r;
      return;
    }

    const unit = this.getAttribute('unit') || '';
    const u = unit ? ` ${unit}` : '';
    const { history, steps, levels, edges, drawn } = r;
    const lowP = levels[0], highP = 100 - levels[0];
    const coverage = highP - lowP;

    // ---- the vertical range ------------------------------------------------
    let dLo = Infinity, dHi = -Infinity;
    for (const h of history) if (h.v !== null) { dLo = Math.min(dLo, h.v); dHi = Math.max(dHi, h.v); }
    for (const s of drawn) { dLo = Math.min(dLo, s.q[lowP]); dHi = Math.max(dHi, s.q[highP]); }
    const aMin = this.attrNum(this.getAttribute('min')), aMax = this.attrNum(this.getAttribute('max'));
    const declared = Number.isFinite(aMin) && Number.isFinite(aMax) && aMax > aMin;
    let lo, hi, tick;
    if (declared) { lo = aMin; hi = aMax; } else {
      // Room past the 90% on both sides, so the outer 10% has somewhere to be,
      // then out to round numbers: an axis ending at 5.74 reads as measured.
      const pad = Math.max((dHi - dLo) * 0.15, Math.abs(dHi) * 0.03, 1e-9);
      const raw = (dHi - dLo + 2 * pad) / 4;
      const e = 10 ** Math.floor(Math.log10(raw)), f = raw / e;
      tick = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
      lo = Math.floor((dLo - pad) / tick) * tick; hi = Math.ceil((dHi + pad) / tick) * tick;
    }
    const room = (hi - lo) * 0.04;
    const fanTop = Math.max(...drawn.map((s) => s.q[highP]));
    const fanBot = Math.min(...drawn.map((s) => s.q[lowP]));
    const cutAbove = fanTop > hi, cutBelow = fanBot < lo;
    const tightAbove = !cutAbove && fanTop > hi - room, tightBelow = !cutBelow && fanBot < lo + room;

    // ---- geometry ------------------------------------------------------------
    const W = 360, top = 14, base = 138, left = 34, right = 60;
    const cols = history.length + steps.length;
    const x1 = W - right;
    const X = (i) => (cols <= 1 ? (left + x1) / 2 : left + (i / (cols - 1)) * (x1 - left));
    const Yraw = (v) => base - ((v - lo) / (hi - lo)) * (base - top);
    const Y = (v) => Math.max(top, Math.min(base, Yraw(v)));
    const f1 = (n) => n.toFixed(1);

    let g = `<rect class="ov-fan__plot" x="${left}" y="${top}" width="${x1 - left}" height="${base - top}"/>`;
    // Faint rules at the round steps (automatic axis) or the two ends (declared).
    const marks = tick ? Array.from({ length: Math.round((hi - lo) / tick) + 1 }, (_, i) => lo + i * tick) : [lo, hi];
    for (const m of marks) {
      const y = f1(Yraw(m));
      if (m !== lo && m !== hi) g += `<line class="ov-fan__grid" x1="${left}" y1="${y}" x2="${x1}" y2="${y}"/>`;
      g += `<text class="ov-fan__text" x="${left - 4}" y="${f1(Math.min(base, Math.max(top + 3, Yraw(m) + 3)))}" text-anchor="end">${fanNum(m)}</text>`;
    }

    // ---- the bands -------------------------------------------------------------
    // Runs of consecutive drawn steps; a gap step ends a run and is not bridged.
    const h0 = history.length;
    const runs = [];
    let cur = [];
    steps.forEach((s, i) => { if (s.q) cur.push([h0 + i, s]); else { if (cur.length) runs.push(cur); cur = []; } });
    if (cur.length) runs.push(cur);
    // Bands from the outside in, so the central one sits on top. `k` is the
    // band's distance from the centre: 0 is the central 10%.
    const bands = [];
    for (let j = 0; j < levels.length - 1; j++) {
      const k = levels.length - 1 - j;
      bands.push({ k, a: levels[j], b: levels[j + 1] });
      bands.push({ k, a: 100 - levels[j + 1], b: 100 - levels[j] });
    }
    bands.push({ k: 0, a: levels[levels.length - 1], b: 100 - levels[levels.length - 1] });
    const half = (x1 - left) / Math.max(1, cols - 1) / 2;
    for (const run of runs) {
      for (const bd of bands) {
        const title = `${bd.a}th to ${bd.b}th percentile: ${bd.b - bd.a}% of outcomes`;
        let pts;
        if (run.length === 1) {
          // One step alone: a short column, as wide as half a step either side.
          const [i, s] = run[0];
          const xa = f1(X(i) - Math.min(4, half)), xb = f1(X(i) + Math.min(4, half));
          pts = `${xa},${f1(Y(s.q[bd.b]))} ${xb},${f1(Y(s.q[bd.b]))} ${xb},${f1(Y(s.q[bd.a]))} ${xa},${f1(Y(s.q[bd.a]))}`;
        } else {
          const upper = run.map(([i, s]) => `${f1(X(i))},${f1(Y(s.q[bd.b]))}`);
          const lower = run.map(([i, s]) => `${f1(X(i))},${f1(Y(s.q[bd.a]))}`).reverse();
          pts = `${upper.join(' ')} ${lower.join(' ')}`;
        }
        g += `<polygon class="ov-fan__band is-k${bd.k}" data-band="${bd.a}-${bd.b}" points="${pts}"><title>${title}</title></polygon>`;
      }
    }

    // Steps with no forecast: a dashed mark where the step would be, counted.
    const gaps = [];
    steps.forEach((s, i) => {
      if (s.q) return;
      gaps.push(s.gap);
      const x = f1(X(h0 + i));
      g += `<line class="ov-fan__gap" x1="${x}" y1="${top}" x2="${x}" y2="${base}"><title>${fanText(s.label ? s.label + ': ' : '')}${fanText(s.gap)}</title></line>`;
    });

    // Cut marks: the fan runs past the axis, so the axis edge is not its edge.
    for (const [i, s] of drawn.map((s) => [h0 + steps.indexOf(s), s])) {
      if (s.q[highP] > hi) g += `<rect class="ov-fan__cut" x="${f1(X(i) - 1.5)}" y="${top}" width="3" height="3"/>`;
      if (s.q[lowP] < lo) g += `<rect class="ov-fan__cut" x="${f1(X(i) - 1.5)}" y="${base - 3}" width="3" height="3"/>`;
    }

    // ---- the outer region, labelled ----------------------------------------------
    // At the last drawn step, in the margin past the plot: what lies outside.
    const tail = (100 - coverage) / 2;
    const last = drawn[drawn.length - 1];
    const lastX = X(h0 + steps.indexOf(last));
    const yAbove = Math.max(top + 7, Math.min(base - 14, Yraw(last.q[highP]) - 5));
    const yBelow = Math.min(base - 1, Math.max(top + 20, Yraw(last.q[lowP]) + 11));
    g += `<line class="ov-fan__lead" x1="${f1(lastX)}" y1="${f1(Y(last.q[highP]))}" x2="${x1 + 3}" y2="${f1(yAbove - 3)}"/>`
      + `<line class="ov-fan__lead" x1="${f1(lastX)}" y1="${f1(Y(last.q[lowP]))}" x2="${x1 + 3}" y2="${f1(yBelow - 3)}"/>`
      + `<text class="ov-fan__outer" x="${x1 + 5}" y="${f1(yAbove)}">${fanNum(tail)}% ABOVE</text>`
      + `<text class="ov-fan__outer" x="${x1 + 5}" y="${f1(yBelow)}">${fanNum(tail)}% BELOW</text>`;

    // ---- the history, up to NOW ---------------------------------------------------
    if (history.length) {
      let seg = [];
      const lines = [];
      history.forEach((h, i) => { if (h.v === null) { if (seg.length) lines.push(seg); seg = []; } else seg.push(`${f1(X(i))},${f1(Y(h.v))}`); });
      if (seg.length) lines.push(seg);
      for (const l of lines) {
        g += l.length > 1 ? `<polyline class="ov-fan__history" points="${l.join(' ')}"/>`
          : `<circle class="ov-fan__point" cx="${l[0].split(',')[0]}" cy="${l[0].split(',')[1]}" r="1.6"/>`;
      }
      const nx = f1(X(h0 - 1));
      g += `<line class="ov-fan__now" x1="${nx}" y1="${top}" x2="${nx}" y2="${base}"/>`
        + `<text class="ov-fan__text is-now" x="${nx}" y="${top - 4}" text-anchor="middle">NOW</text>`;
    }

    // ---- step labels along the bottom ------------------------------------------------
    const all = [...history.map((h) => h.label), ...steps.map((s) => s.label ?? null)];
    const every = Math.max(1, Math.ceil(cols / 6));
    all.forEach((l, i) => {
      if (l === null || l === undefined || (i % every && i !== cols - 1)) return;
      if (i !== cols - 1 && cols - 1 - i < every && i % every) return;
      const x = X(i);
      const anchor = x > x1 - 12 ? 'end' : x < left + 10 ? 'start' : 'middle';
      g += `<text class="ov-fan__text" x="${f1(x)}" y="${base + 12}" text-anchor="${anchor}">${fanText(l)}</text>`;
    });

    // ---- the readout ---------------------------------------------------------------------
    const words = [];
    words.push({ t: `${coverage}% inside the shading, ${100 - coverage}% outside it` });
    const probs = [];
    for (let j = 0; j < levels.length - 1; j++) probs.push(levels[j + 1] - levels[j]);
    probs.push(100 - 2 * levels[levels.length - 1]);
    const equal = probs.every((p) => p === 10);
    words.push(equal ? { t: `${bands.length} bands of 10%` } : { t: `bands unequal: ${[...new Set(probs)].sort((a, b) => a - b).join('/')}%`, flag: true });
    const kinds = [...new Set(drawn.map((s) => (s.kind === 'draws' ? 'draws' : s.kind)))];
    const minN = Math.min(...drawn.filter((s) => s.n).map((s) => s.n));
    words.push({ t: kinds.map((k) => (k === 'draws' ? `from ${minN.toLocaleString('en-US')}+ draws` : k === 'given' ? 'quantiles as given' : k)).join(' + ') });
    // The lean at the last drawn step: outer reach above the central band vs below it.
    const mid = (last.q[levels[levels.length - 1]] + last.q[100 - levels[levels.length - 1]]) / 2;
    const up = last.q[highP] - mid, down = mid - last.q[lowP];
    const lean = up > down * 1.15 ? 'risk leans up' : down > up * 1.15 ? 'risk leans down' : 'balanced';
    words.push({ t: `${lean}${last.label ? ` at ${last.label}` : ''}` });
    const central = steps.filter((s) => s.central).length;
    if (central) words.push({ t: `central value given for ${central} step${central === 1 ? '' : 's'}: not drawn`, flag: true });
    if (gaps.length) {
      const why = [...new Set(gaps)];
      words.push({ t: `${gaps.length} step${gaps.length === 1 ? '' : 's'} not drawn: ${why.join('; ')}`, flag: true });
    }
    if (cutAbove || cutBelow) words.push({ t: `axis cuts the fan ${cutAbove && cutBelow ? 'at both ends' : cutAbove ? 'above' : 'below'}`, flag: true });
    else if (tightAbove || tightBelow) words.push({ t: `axis ends at the ${coverage}% edge: no room shown beyond it`, flag: true });
    if (!history.length) words.push({ t: 'no history: NOW not marked', flag: true });
    if (r.age !== null) words.push({ t: `issued ${fanAge(r.age)} ago${r.stale ? ': STALE' : ''}`, flag: r.stale });
    if (unit) words.push({ t: `in ${unit}` });

    this.innerHTML = `<svg class="ov-fan__svg" viewBox="0 0 ${W} ${base + 18}" aria-hidden="true">${g}</svg>`
      + `<div class="ov-fan__readout">${words.map((w) => `<span${w.flag ? ' class="is-flag"' : ''}>${fanText(w.t)}</span>`).join('')}</div>`;
    this.toggleAttribute('data-ov-stale-forecast', r.stale);
    this.setAttribute('data-ov-fan', gaps.length ? 'broken' : 'drawn');
    const said = words.map((w) => w.t).join(', ');
    if (r.stale) apply(this, { text: said, qualifier: 'stale', age: Math.round(r.age) });
    else apply(this, { text: said });
    this.setAttribute('aria-label', `${label ? label + ', ' : ''}fan chart, ${said}`);
    this._r = { ...r, coverage, lean, central, gaps: gaps.length, cut: cutAbove || cutBelow, tight: tightAbove || tightBelow, equal };
  }

  /* What the fan is claiming, for a harness or a host app. */
  report() {
    const r = this._r;
    if (!r || r.reason) return { state: 'none' };
    return {
      state: r.stale ? 'stale' : 'current', steps: r.steps.length, drawn: r.drawn.length, gaps: r.gaps,
      coverage: r.coverage, levels: r.levels.slice(), lean: r.lean, central: r.central,
      cut: r.cut, tight: r.tight, equal: r.equal, age: r.age,
    };
  }
}

define('ov-fan', OvFan);

export { OvFan };
