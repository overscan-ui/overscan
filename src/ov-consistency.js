/* <ov-consistency> - a status that may change only when a command says so.
 *
 * For industrial, aegis, machina and terminal. SCOS-2000's
 * status consistency check, "sometimes called 'change on command only'
 * (COCOMO)": discrete parameters, each drawn as its values over time, with
 * the windows that commands to it opened.
 *
 *   <ov-consistency max-age="30"></ov-consistency>
 *   watch.watch = {
 *     now: 1200, delay: 4, jitter: 2,                  // mission seconds
 *     parameters: [{ id: 'HTR2', name: 'Heater 2', samples: [{ t: 0, v: 'OFF' }, { t: 16, v: 'OFF' }, ...] }],
 *     commands: [{ id: 'C40', name: 'HTR-2 ON', t: 300, target: 'HTR2', expects: 'ON', window: 20 }],
 *   };
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 A CHANGE NO COMMAND EXPLAINS IS NOT A NEW VALUE. It is marked
 * UNCOMMANDED, in the alarm colour, and counted. STATED (Armitage and
 * Kalicharan, Terma, on SCOS-2000): the check "treats a change to a parameter
 * as an error unless a specific command has been sent... we can define a time
 * window after the command was transmitted: the parameter is permitted to
 * change within that time window. After the window closes, the value may not
 * change any more unless or until the relevant command is sent again."
 *
 * Four more that fall out of it:
 *
 * 1. A CHANGE HAPPENED BETWEEN TWO SAMPLES, NOT AT ONE. The mark is as wide
 *    as that interval. Wholly inside the time the windows permit that value
 *    (their union: two overlapping windows leave no gap) it is COMMANDED;
 *    wholly outside every window it is UNCOMMANDED; across a window's edge
 *    it is UNDETERMINED, and neither verdict is given. Reading the change as
 *    happening at the later sample would quietly decide it.
 * 2. A WINDOW IS WHERE THE COMMAND CAN ARRIVE. It opens at the send time
 *    plus the one-way `delay` and closes after `window` plus `jitter`; both
 *    are stated. A later command to the same target expecting a different
 *    value closes the earlier window when its own opens, and the earlier
 *    command is SUPERSEDED, the paper's own status.
 * 3. A MODELLED COMMAND IS NOT A SENT ONE. A change inside a window that only
 *    a modelled command opened (one the ground reconstructed, sent by some
 *    other party) is MODELLED, dashed: the paper's two possible errors,
 *    "either the satellite itself, or the model of the satellite."
 * 4. WHAT WAS NOT WATCHED IS NOT QUIET. Past `max-age` with no sample, the
 *    time since the last one is hatched NOT WATCHED: no uncommanded change
 *    is claimed for it, and none is ruled out.
 *
 * A change inside a window to a value the command did not expect is
 * UNEXPECTED VALUE, not commanded. Whether a command SUCCEEDED is
 * ov-verifier's question, not this one's: a window that closes with no
 * change is not judged here.
 *
 * No data at all is the kit's `unknown`: NO DATA.
 */

import { define } from './ov-core.js';
import { apply } from './ov-refusal.js';

const csText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const csNum = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? null
  : Number.isFinite(Number(v)) ? Number(v) : null);
/* Seconds before now, as "−7m 12s"; whole seconds only. */
const csAgo = (s) => {
  const a = Math.round(Math.abs(s));
  const txt = a < 60 ? `${a}s` : a < 3600 ? `${Math.floor(a / 60)}m${a % 60 ? ` ${a % 60}s` : ''}` : `${Math.floor(a / 3600)}h ${String(Math.floor(a / 60) % 60).padStart(2, '0')}m`;
  return s < 0 ? `−${txt}` : txt;
};
const CS_VERDICTS = ['uncommanded', 'undetermined', 'unexpected', 'modelled', 'commanded'];
const CS_WORD = { uncommanded: 'UNCOMMANDED', undetermined: 'UNDETERMINED', unexpected: 'UNEXPECTED VALUE', modelled: 'MODELLED', commanded: 'COMMANDED' };

class OvConsistency extends HTMLElement {
  static observedAttributes = ['src', 'max-age', 'label'];

  connectedCallback() {
    this._watch = this._watch === undefined ? null : this._watch;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get watch() { return this._watch; }
  set watch(v) { this._watch = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._watch = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._watch = null;
    }
    this.paint();
  }

  /* ⚠️ Number(null) is 0: an absent attribute is checked for absence first. */
  attrNum(raw) {
    if (raw === null || raw.trim() === '') return NaN;
    return Number(raw);
  }

  /* Commands -> windows per target, with supersession applied. */
  windows(W, delay, jitter) {
    let bad = 0;
    const byTarget = new Map();
    for (const c of Array.isArray(W.commands) ? W.commands : []) {
      const t = csNum(c && c.t), win = csNum(c && c.window);
      if (!c || t === null || win === null || win < 0 || !c.target) { bad += 1; continue; }
      const w = {
        id: String(c.id ?? '?'), name: c.name ? String(c.name) : '', target: String(c.target),
        expects: c.expects === undefined || c.expects === null ? undefined : String(c.expects),
        modelled: !!c.modelled, sent: t, opensAt: t + delay, closesAt: t + delay + win + jitter, superseded: null,
      };
      if (!byTarget.has(w.target)) byTarget.set(w.target, []);
      byTarget.get(w.target).push(w);
    }
    // "A command is sent which expects one value... while the first command
    // is still pending verification, another command is sent expecting a
    // different value... the first command TC verification has been
    // 'superseded'."
    for (const list of byTarget.values()) {
      list.sort((a, b) => a.opensAt - b.opensAt);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (b.opensAt >= a.closesAt) break;
          if (b.expects !== a.expects) { a.closesAt = b.opensAt; a.superseded = b.id; break; }
        }
      }
    }
    return { byTarget, bad };
  }

  /* One change, known only to lie in (a, b], against the target's windows.
   *
   * The question is whether the parameter was PERMITTED to change at every
   * moment it could have changed, so the interval is tested against the
   * union of the windows that permit this value, not against one window:
   * two overlapping windows for the same value leave no gap between them. */
  judge(a, b, v, wins) {
    const covered = (list) => {
      const spans = list.map((w) => [w.opensAt, w.closesAt]).sort((x, y) => x[0] - y[0]);
      let lo = null, hi = null;
      for (const [o, c] of spans) {
        if (lo === null || o > hi) { if (lo !== null && a >= lo && b <= hi) return true; lo = o; hi = c; } else hi = Math.max(hi, c);
      }
      return lo !== null && a >= lo && b <= hi;
    };
    const touching = wins.filter((w) => b > w.opensAt && a < w.closesAt);
    const latest = (list) => list.reduce((x, y) => (y.opensAt > x.opensAt ? y : x));
    const allows = (w) => w.expects === undefined || String(v) === w.expects;
    const sent = wins.filter((w) => allows(w) && !w.modelled);
    const any = wins.filter(allows);
    if (sent.length && covered(sent)) return { verdict: 'commanded', by: latest(sent.filter((w) => touching.includes(w))) };
    if (any.length && covered(any)) return { verdict: 'modelled', by: latest(any.filter((w) => touching.includes(w))) };
    // A window was open the whole time, but for a different value.
    if (wins.length && covered(wins)) return { verdict: 'unexpected', by: latest(touching) };
    if (touching.length) return { verdict: 'undetermined', by: touching[0] };
    return { verdict: 'uncommanded', by: null };
  }

  resolve() {
    const W = this._watch;
    if (!W || !Array.isArray(W.parameters) || !W.parameters.length) return { reason: 'NO DATA' };
    const now = csNum(W.now);
    if (now === null) return { reason: 'NO TIME GIVEN' };
    const delay = Math.max(0, csNum(W.delay) ?? 0), jitter = Math.max(0, csNum(W.jitter) ?? 0);
    const aMax = this.attrNum(this.getAttribute('max-age'));
    const maxAge = Number.isFinite(aMax) && aMax > 0 ? aMax : null;
    const { byTarget, bad } = this.windows(W, delay, jitter);
    const known = new Set();
    let badSamples = 0;
    const params = W.parameters.map((p) => {
      const id = String((p && p.id) ?? '?');
      known.add(id);
      const samples = (p && Array.isArray(p.samples) ? p.samples : [])
        .map((s) => ({ t: csNum(s && s.t), v: s && s.v !== undefined && s.v !== null ? String(s.v) : null }))
        .filter((s) => { const ok = s.t !== null && s.v !== null && s.t <= now; if (!ok) badSamples += 1; return ok; })
        .sort((x, y) => x.t - y.t);
      const wins = byTarget.get(id) || [];
      const changes = [];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].v === samples[i - 1].v) continue;
        const j = this.judge(samples[i - 1].t, samples[i].t, samples[i].v, wins);
        changes.push({ a: samples[i - 1].t, b: samples[i].t, from: samples[i - 1].v, to: samples[i].v, ...j });
      }
      const last = samples.length ? samples[samples.length - 1] : null;
      const unwatched = !last ? now : maxAge !== null && now - last.t > maxAge ? now - last.t : 0;
      return { id, name: p && p.name ? String(p.name) : '', samples, wins, changes, last, unwatched };
    });
    const orphans = [...byTarget.keys()].filter((k) => !known.has(k)).reduce((n, k) => n + byTarget.get(k).length, 0);
    let t0 = now;
    for (const p of params) { if (p.samples.length) t0 = Math.min(t0, p.samples[0].t); for (const w of p.wins) t0 = Math.min(t0, w.sent); }
    if (t0 >= now) t0 = now - 60;
    return { params, now, t0, delay, jitter, maxAge, bad, badSamples, orphans };
  }

  paint() {
    this.removeAttribute('data-ov-consistency');
    const r = this.resolve();
    const label = this.getAttribute('label') || '';
    if (r.reason) {
      this.innerHTML = `<div class="ov-consistency__void">${csText(r.reason)}</div>`;
      apply(this, { reason: 'unknown' });
      this.setAttribute('aria-label', `${label ? label + ', ' : ''}status consistency, ${r.reason.toLowerCase()}`);
      this.setAttribute('data-ov-consistency', 'none');
      this._r = r;
      return;
    }
    const { params, now, t0 } = r;
    // The strip is 1000 units wide and stretched to the row, at a fixed
    // height: a wider plot gets longer, never taller. Only shapes are in the
    // SVG (with strokes that do not scale); every word is HTML, placed by
    // percentage, so no label is ever stretched with it.
    const W = 1000, H = 40, top = 13, bar = 14;
    const X = (t) => ((t - t0) / (now - t0)) * W;
    const f1 = (n) => n.toFixed(1);
    const pct = (x) => `${(x / W * 100).toFixed(2)}%`;
    const NS = ' vector-effect="non-scaling-stroke"';

    const rows = params.map((p) => {
      let g = '', words = '';
      // Command windows, above the strip. A superseded one ends where the
      // superseding one opens and is struck through, and gives up its label
      // when it would collide with another: the bracket stays, and the title
      // still names it.
      const labelled = p.wins.filter((w) => !w.superseded).map((w) => X(w.opensAt));
      p.wins.forEach((w, k) => {
        const xa = Math.max(0, X(w.opensAt)), xb = Math.min(W, X(w.closesAt));
        if (xb <= 0 || xa >= W) return;
        const quiet = w.superseded && labelled.some((x) => Math.abs(x - xa) < 50);
        const y = 4 + (k % 2) * 4;
        const cls = `${w.modelled ? ' is-modelled' : ''}${w.superseded ? ' is-superseded' : ''}`;
        g += `<g class="ov-consistency__win${cls}">`
          + `<title>${csText(`${w.id}${w.name ? ' ' + w.name : ''}: window ${csAgo(w.opensAt - now)} to ${csAgo(w.closesAt - now)}`
            + `${w.expects !== undefined ? `, expects ${w.expects}` : ''}${w.modelled ? ', MODELLED' : ''}${w.superseded ? `, SUPERSEDED by ${w.superseded}` : ''}`)}</title>`
          + `<rect class="ov-consistency__span" x="${f1(xa)}" y="${top}" width="${f1(Math.max(3, xb - xa))}" height="${bar}"/>`
          + `<path class="ov-consistency__bracket"${NS} d="M${f1(xa)},${y + 3}V${y}H${f1(Math.max(xb, xa + 3))}V${y + 3}"/></g>`;
        if (!quiet) words += `<span class="ov-consistency__cmd${cls}" style="left:${pct(xa)};top:${y - 8}px">${csText(w.id)}</span>`;
      });
      // Values: consecutive samples with the same value are one run; the
      // stretch between two runs belongs to the change mark.
      const runs = [];
      for (const smp of p.samples) {
        const last = runs[runs.length - 1];
        if (last && last.v === smp.v) last.end = smp.t; else runs.push({ v: smp.v, start: smp.t, end: smp.t });
      }
      runs.forEach((run, i) => {
        // The last run holds to NOW unless the parameter went unwatched.
        const end = i < runs.length - 1 || p.unwatched ? run.end : now;
        const xs = X(run.start), xe = X(end);
        g += `<rect class="ov-consistency__value"${NS} x="${f1(xs)}" y="${top + 2}" width="${f1(Math.max(2, xe - xs))}" height="${bar - 4}"/>`;
        if (xe - xs > 90) words += `<span class="ov-consistency__v" style="left:${pct(xs)};top:${top + 2}px">${csText(run.v)}</span>`;
      });
      // Changes, as wide as the interval they could have happened in.
      for (const c of p.changes) {
        const xa = X(c.a), xb = X(c.b);
        const t = `${c.from} → ${c.to} between ${csAgo(c.a - now)} and ${csAgo(c.b - now)}: ${CS_WORD[c.verdict]}${c.by ? ` (${c.by.id})` : ''}`;
        g += `<rect class="ov-consistency__change is-${c.verdict}"${NS} x="${f1(xa)}" y="${top}" width="${f1(Math.max(6, xb - xa))}" height="${bar}"><title>${csText(t)}</title></rect>`;
        if (c.verdict === 'uncommanded') words += `<span class="ov-consistency__bang" style="left:${pct((xa + xb) / 2)};top:${top + bar}px">!</span>`;
      }
      // Not watched: from the last sample to now.
      if (p.unwatched) {
        const xa = X(now - p.unwatched);
        g += `<rect class="ov-consistency__unwatched"${NS} x="${f1(xa)}" y="${top}" width="${f1(Math.max(3, W - xa))}" height="${bar}"><title>not watched for ${csAgo(p.unwatched)}</title></rect>`;
      }
      const cur = p.unwatched ? 'NOT WATCHED' : p.last ? p.last.v : '—';
      const alarm = p.changes.some((c) => c.verdict === 'uncommanded');
      return `<div class="ov-consistency__row${alarm ? ' is-alarm' : ''}"><span class="ov-consistency__id" title="${csText(p.name)}">${csText(p.id)}</span>`
        + `<span class="ov-consistency__now${p.unwatched ? ' is-unwatched' : ''}">${csText(cur)}</span>`
        + `<span class="ov-consistency__plot"><svg class="ov-consistency__strip" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${g}</svg>${words}</span></div>`;
    }).join('');
    const axis = `<div class="ov-consistency__axis"><span>${csText(csAgo(t0 - now))}</span><span>NOW</span></div>`;

    const count = Object.fromEntries(CS_VERDICTS.map((v) => [v, 0]));
    for (const p of params) for (const c of p.changes) count[c.verdict] += 1;
    const total = CS_VERDICTS.reduce((a, v) => a + count[v], 0);
    const superseded = params.reduce((a, p) => a + p.wins.filter((w) => w.superseded).length, 0);
    const unwatched = params.filter((p) => p.unwatched);
    const words = [];
    words.push({ t: `${total} change${total === 1 ? '' : 's'} on ${params.length} parameter${params.length === 1 ? '' : 's'}` });
    if (count.uncommanded) words.push({ t: `${count.uncommanded} UNCOMMANDED`, alarm: true });
    if (count.undetermined) words.push({ t: `${count.undetermined} undetermined: changed between samples across a window edge`, flag: true });
    if (count.unexpected) words.push({ t: `${count.unexpected} to a value the command did not expect`, flag: true });
    if (count.modelled) words.push({ t: `${count.modelled} explained only by a modelled command`, flag: true });
    if (count.commanded) words.push({ t: `${count.commanded} commanded` });
    if (superseded) words.push({ t: `${superseded} window${superseded === 1 ? '' : 's'} superseded` });
    for (const p of unwatched) words.push({ t: `${p.id} not watched for ${csAgo(p.unwatched)}: not judged`, flag: true });
    if (r.orphans) words.push({ t: `${r.orphans} command${r.orphans === 1 ? '' : 's'} to a parameter not shown`, flag: true });
    if (r.bad) words.push({ t: `${r.bad} command${r.bad === 1 ? '' : 's'} without a time, window or target: ignored`, flag: true });
    if (r.badSamples) words.push({ t: `${r.badSamples} sample${r.badSamples === 1 ? '' : 's'} without a time or value, or after now: ignored`, flag: true });
    words.push({ t: `windows open ${r.delay}s after sending, close ${r.jitter}s late` });

    this.innerHTML = `<div class="ov-consistency__rows">${rows}${axis}</div>`
      + `<div class="ov-consistency__readout">${words.map((w) => `<span${w.alarm ? ' class="is-alarm"' : w.flag ? ' class="is-flag"' : ''}>${csText(w.t)}</span>`).join('')}</div>`;
    this.setAttribute('data-ov-consistency', count.uncommanded ? 'uncommanded' : count.undetermined || unwatched.length ? 'undetermined' : 'consistent');
    const said = words.map((w) => w.t).join(', ');
    apply(this, { text: said });
    this.setAttribute('aria-label', `${label ? label + ', ' : ''}status consistency, ${said}`);
    this._r = { ...r, count, superseded };
  }

  /* What the watch is claiming, for a harness or a host app. */
  report() {
    const r = this._r;
    if (!r || r.reason) return { state: 'none' };
    return {
      state: this.getAttribute('data-ov-consistency'), count: { ...r.count }, superseded: r.superseded,
      changes: r.params.flatMap((p) => p.changes.map((c) => ({ id: p.id, a: c.a, b: c.b, to: c.to, verdict: c.verdict, by: c.by ? c.by.id : null }))),
      windows: r.params.flatMap((p) => p.wins.map((w) => ({ id: w.id, target: w.target, opensAt: w.opensAt, closesAt: w.closesAt, superseded: w.superseded, modelled: w.modelled }))),
      unwatched: Object.fromEntries(r.params.map((p) => [p.id, p.unwatched])),
    };
  }
}

define('ov-consistency', OvConsistency);

export { OvConsistency };
