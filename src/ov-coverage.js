/* <ov-coverage> - a technique grid that says what was tested, not what has a
 * rule.
 *
 * For cyber, aegis, terminal and antiseptic. Tactics as rows
 * and techniques as cells, the shape of the ATT&CK Navigator's coverage
 * layer. The usual layer paints a cell green when a detection rule exists
 * for it, and the green is read as "we would catch this".
 *
 *   <ov-coverage max-age="90"></ov-coverage>
 *   grid.coverage = {
 *     asOf: '2026-09-01',                        // what "recent" is measured from
 *     tactics: [{ name: 'Initial Access', techniques: ['T1566', 'T1190'] }, ...],
 *     techniques: {
 *       T1566: { name: 'Phishing', rules: 3, tests: [{ date: '2026-08-20', result: 'detected' }] },
 *       T1190: { name: 'Exploit Public-Facing Application', rules: 1 },   // never tested
 *     },
 *   };
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 A RULE IS NOT A DETECTION. A cell is VALIDATED only when a test within
 * `max-age` days (default 90) was detected. A technique with rules and no
 * test is UNKNOWN, hatched, not green; so is one whose last good test is
 * older than `max-age`: validation decays, and the fill in a validated cell
 * drains as its test ages. STATED, by vendors (AttackIQ, 2026): "Coverage
 * that hasn't been tested recently should be treated as unknown, not green";
 * a heatmap "shows techniques that could trigger alerts, not techniques
 * you've actually detected" (Bills Cybersecurity). This rule is stated by
 * vendors, not by a standard.
 *
 * Four more that fall out of it:
 *
 * 1. THE STATE IS DERIVED, NEVER HANDED IN. A `status`, `color`, `covered`
 *    or `score` on a technique is counted in the readout and not used: the
 *    evidence decides the cell, not someone's label for it.
 * 2. A FAILED TEST STAYS FAILED. The last test missing it is FAILED however
 *    old it is: age can turn a pass into UNKNOWN but never a miss into
 *    anything better.
 * 3. A TEST IS DATED OR IT DOES NOT COUNT. An undated test, or one dated
 *    after `asOf`, is UNKNOWN and said; neither is credited.
 * 4. NO COVERAGE SCORE. The only percentage is validated techniques over all
 *    techniques. A technique listed under several tactics is one technique:
 *    it is drawn in each row and counted once.
 *
 * No grid at all is the kit's `unknown`: NO DATA.
 */

import { define } from './ov-core.js';
import { apply } from './ov-refusal.js';

const covText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COV_DAY = 86400000;
const COV_HANDED = ['status', 'color', 'covered', 'score'];
/* Order matters: it is the legend's order and the readout's. */
const COV_STATES = ['validated', 'partial', 'failed', 'unknown', 'none'];
const COV_WORD = { validated: 'VALIDATED', partial: 'PARTIAL', failed: 'FAILED', unknown: 'UNKNOWN', none: 'NONE' };

class OvCoverage extends HTMLElement {
  static observedAttributes = ['src', 'max-age', 'label'];

  connectedCallback() {
    this._cov = this._cov === undefined ? null : this._cov;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get coverage() { return this._cov; }
  set coverage(v) { this._cov = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._cov = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._cov = null;
    }
    this.paint();
  }

  /* ⚠️ Number(null) is 0: an absent attribute is checked for absence first. */
  attrNum(raw) {
    if (raw === null || raw.trim() === '') return NaN;
    return Number(raw);
  }

  /* One technique's evidence -> { state, why, age, fresh }. */
  judge(t, asOf, maxAge) {
    const rules = t && (t.rules === true ? 1 : Number.isFinite(Number(t.rules)) ? Number(t.rules) : 0);
    const tests = t && Array.isArray(t.tests) ? t.tests : t && t.test ? [t.test] : [];
    let undated = 0, future = 0, last = null;
    for (const x of tests) {
      const d = x && typeof x.date === 'string' ? Date.parse(x.date) : NaN;
      if (!Number.isFinite(d)) { undated += 1; continue; }
      if (d > asOf) { future += 1; continue; }
      if (!last || d > last.d) last = { d, result: x.result };
    }
    if (last) {
      const age = (asOf - last.d) / COV_DAY;
      if (last.result === 'missed') return { state: 'failed', why: `missed ${Math.round(age)}d ago`, age, rules };
      if (last.result === 'detected' || last.result === 'partial') {
        if (age > maxAge) return { state: 'unknown', why: `${last.result} ${Math.round(age)}d ago, past ${maxAge}d`, reason: 'stale', age, rules };
        return { state: last.result === 'detected' ? 'validated' : 'partial', why: `${last.result} ${Math.round(age)}d ago`, age, fresh: 1 - age / maxAge, rules };
      }
      return { state: 'unknown', why: `test result "${last.result}" not understood`, reason: 'result', age, rules };
    }
    if (future) return { state: 'unknown', why: 'test dated after as-of', reason: 'future', rules };
    if (undated) return { state: 'unknown', why: 'test has no date', reason: 'undated', rules };
    if (rules > 0) return { state: 'unknown', why: `${rules} rule${rules === 1 ? '' : 's'}, never tested`, reason: 'rule', rules };
    return { state: 'none', why: 'no rule, no test', rules };
  }

  resolve() {
    const C = this._cov;
    if (!C || !Array.isArray(C.tactics) || !C.tactics.length) return { reason: 'NO DATA' };
    const T = C.techniques && typeof C.techniques === 'object' ? C.techniques : {};
    const aMax = this.attrNum(this.getAttribute('max-age'));
    const maxAge = Number.isFinite(aMax) && aMax > 0 ? aMax : 90;
    const given = typeof C.asOf === 'string' ? Date.parse(C.asOf) : NaN;
    const asOf = Number.isFinite(given) ? given : Date.now();
    const judged = new Map();
    const rows = C.tactics.map((ta) => {
      const ids = Array.isArray(ta && ta.techniques) ? ta.techniques.map(String) : [];
      return {
        name: String((ta && (ta.short || ta.name)) || '?'),
        full: String((ta && ta.name) || '?'),
        cells: ids.map((id) => {
          if (!judged.has(id)) {
            const t = T[id];
            const j = t ? this.judge(t, asOf, maxAge) : { state: 'unknown', why: 'listed, no record', reason: 'missing' };
            j.id = id; j.name = t && t.name ? String(t.name) : '';
            j.handed = !!t && COV_HANDED.some((k) => t[k] !== undefined);
            judged.set(id, j);
          }
          return judged.get(id);
        }),
      };
    });
    if (!judged.size) return { reason: 'NO TECHNIQUES' };
    return { rows, judged: [...judged.values()], maxAge, asOf, asOfGiven: Number.isFinite(given) };
  }

  paint() {
    this.removeAttribute('data-ov-coverage');
    const r = this.resolve();
    const label = this.getAttribute('label') || '';
    if (r.reason) {
      this.innerHTML = `<div class="ov-coverage__void">${covText(r.reason)}</div>`;
      apply(this, { reason: 'unknown' });
      this.setAttribute('aria-label', `${label ? label + ', ' : ''}technique coverage, ${r.reason.toLowerCase()}`);
      this.setAttribute('data-ov-coverage', 'none');
      this._r = r;
      return;
    }
    const { rows, judged, maxAge } = r;
    const count = Object.fromEntries(COV_STATES.map((s) => [s, 0]));
    const why = {};
    for (const j of judged) { count[j.state] += 1; if (j.reason) why[j.reason] = (why[j.reason] || 0) + 1; }
    const handed = judged.filter((j) => j.handed).length;
    const total = judged.length;

    const cell = (j) => {
      const title = `${j.id}${j.name ? ' ' + j.name : ''}: ${COV_WORD[j.state]}, ${j.why}`;
      const fresh = j.fresh !== undefined ? ` style="--ov-coverage-fresh:${Math.max(0.08, j.fresh).toFixed(2)}"` : '';
      return `<i class="ov-coverage__cell is-${j.state}${j.reason ? ' is-' + j.reason : ''}" data-id="${covText(j.id)}"${fresh} title="${covText(title)}"></i>`;
    };
    const body = rows.map((row) => {
      const ok = row.cells.filter((j) => j.state === 'validated').length;
      return `<div class="ov-coverage__row"><span class="ov-coverage__tactic" title="${covText(row.full)}">${covText(row.name)}</span>`
        + `<span class="ov-coverage__cells">${row.cells.map(cell).join('')}</span>`
        + `<span class="ov-coverage__n">${ok}/${row.cells.length}</span></div>`;
    }).join('');
    const legend = COV_STATES.map((s) => `<span class="ov-coverage__key"><i class="ov-coverage__cell is-${s}"></i>${COV_WORD[s]} ${count[s]}</span>`).join('');

    const words = [];
    const pct = Math.round((100 * count.validated) / total);
    words.push({ t: `${count.validated} of ${total} techniques validated in the last ${maxAge}d (${pct}%)` });
    if (why.rule) words.push({ t: `${why.rule} with rules never tested: unknown`, flag: true });
    if (why.stale) words.push({ t: `${why.stale} last validated over ${maxAge}d ago: unknown`, flag: true });
    if (count.failed) words.push({ t: `${count.failed} failed their last test`, flag: true });
    if (count.partial) words.push({ t: `${count.partial} partly detected` });
    if (why.undated) words.push({ t: `${why.undated} test${why.undated === 1 ? '' : 's'} undated: not credited`, flag: true });
    if (why.future) words.push({ t: `${why.future} dated after as-of: not credited`, flag: true });
    if (why.missing) words.push({ t: `${why.missing} listed with no record`, flag: true });
    if (why.result) words.push({ t: `${why.result} with a result not understood`, flag: true });
    if (handed) words.push({ t: `status given for ${handed}: not used`, flag: true });
    const cells = rows.reduce((a, row) => a + row.cells.length, 0);
    if (cells !== total) words.push({ t: `${cells} cells, ${total} techniques: each counted once` });
    words.push({ t: r.asOfGiven ? `as of ${new Date(r.asOf).toISOString().slice(0, 10)}` : 'as of now' });

    this.innerHTML = `<div class="ov-coverage__grid">${body}</div>`
      + `<div class="ov-coverage__legend">${legend}</div>`
      + `<div class="ov-coverage__readout">${words.map((w) => `<span${w.flag ? ' class="is-flag"' : ''}>${covText(w.t)}</span>`).join('')}</div>`;
    this.setAttribute('data-ov-coverage', 'drawn');
    const said = words.map((w) => w.t).join(', ');
    apply(this, { text: said });
    this.setAttribute('aria-label', `${label ? label + ', ' : ''}technique coverage, ${said}`);
    this._r = { ...r, count, why, handed, total, cells };
  }

  /* What the grid is claiming, for a harness or a host app. */
  report() {
    const r = this._r;
    if (!r || r.reason) return { state: 'none' };
    const byId = Object.fromEntries(r.judged.map((j) => [j.id, j.state]));
    return { state: 'drawn', total: r.total, cells: r.cells, count: { ...r.count }, why: { ...r.why }, handed: r.handed, maxAge: r.maxAge, byId };
  }
}

define('ov-coverage', OvCoverage);

export { OvCoverage };
