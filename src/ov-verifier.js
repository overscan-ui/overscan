/* <ov-verifier> - one row per command, one column per stage it has to pass.
 *
 * The Yamcs Studio command history and the SCOS-2000
 * command stack: a command is queued, released, sent, received, accepted,
 * executing and complete, and each of those is a separate claim with its own
 * verifier and its own time window. For terminal, industrial, aegis, machina.
 *
 *   <ov-verifier stages="QUEUED:2, RELEASED:2, SENT:5, RECEIVED:10, ACCEPTED:10, EXECUTING:30, COMPLETE:60"
 *                commands="C41 HTR-2 ON @HTR2; C42 VLV-3 OPEN @VLV3"
 *                reports="C41 QUEUED=pass, C41 RELEASED=pass, C41 SENT=pass"></ov-verifier>
 *   v.issue({ id: 'C43', label: 'HTR-2 OFF', target: 'HTR2' });
 *   v.report('C43', 'SENT', 'pass');            // an acknowledgement for C43
 *   v.report('C43', 'COMPLETE', 'pass', 'tm');  // a parameter reached its value
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 A STAGE IT HAS NOT SEEN IS NEVER SHOWN AS PASSED. The row's verdict
 * names the furthest stage a report actually passed, in that stage's own
 * word: SENT reads SENT, never "executed" or "done", and a stage that passed
 * while an earlier one never reported says the earlier one is NOT SEEN
 * rather than filling it in. Every "Command OK" tick that lights when the
 * uplink went out has drawn a transmission as an execution.
 *
 * Three more:
 * 1. A TIMEOUT IS NEITHER A PASS NOR A FAIL, UNLESS DECLARED. Each stage has
 *    its own window (Yamcs gives every verifier its own timeout and
 *    on_timeout); past it the stage reads T/O and the row NO ANSWER AT that
 *    stage. The next stage's window still opens, because a lost
 *    acknowledgement is not a lost command, and an answer that arrives after
 *    the window is taken and drawn LATE, never retro-fitted as an on-time
 *    PASS. A stage declared `NAME:seconds:fail` (Yamcs on_timeout=FAIL) turns
 *    its timeout into a failure of the COMMAND: the cell still reads T/O
 *    (that is what was seen), the row reads FAILED AT that stage, NO ANSWER
 *    IN ITS WINDOW, and nothing after it opens. The rule is shown before it
 *    bites: the stage's head carries a * and a legend says what it means. A
 *    late answer is still taken and drawn LATE; the command stays failed.
 * 2. A TELEMETRY MATCH IS CREDITED ONLY WHEN THE ELEMENT CAN SEE WHY. A
 *    stage verified by a TM parameter (`evidence` "tm") has "no explicit
 *    reference to the original command. If the TM parameter changes as
 *    expected, can we be completely certain that it changed because of our
 *    command, and for no other reason?" (Armitage, Terma, on SCOS-2000). So
 *    credit is DERIVED, never declared: the report brings { before, value,
 *    expected, age, beforeAge } and the stage is credited (TM OK, drawn
 *    half-filled) only when all four hold:
 *      a. the CHANGE is known to lie inside the stage's window: the last
 *         sample still reading `before` (`beforeAge` seconds ago) and the
 *         first reading `value` (`age`) both fall inside it; straddling an
 *         edge the change time is UNDETERMINED (the interval rule shared
 *         with ov-consistency). The sample is after
 *         the window opened: Armitage's "first parameter sample after the
 *         window opens"; Geo SCADA's "updated in that time period");
 *      b. the value was NOT already the expected one when the window opened
 *         (Geo SCADA documents the failure: a value that already met the
 *         criterion raises nothing; Yamcs's comparison verifier reads the
 *         cache when its window opens);
 *      c. it now IS the expected value: a CHANGE seen inside the window
 *         (XTCE ParameterValueChange, Yamcs ValueChangeVerifier);
 *      d. no other command to the same target was in flight when this one
 *         was issued (Armitage's superseded case, read from the other side).
 *    Short of any one, the stage reads TM ? and the verdict says which
 *    condition failed. Nothing, not even an attribute, can declare a TM pass
 *    credited: that would be the invention this element exists to refuse.
 * 3. A NEWER COMMAND TO THE SAME TARGET SUPERSEDES THE OLDER ONE'S OPEN
 *    STAGES. Armitage again: a command is sent expecting one value, and while
 *    it is still pending another is sent expecting a different value, so the
 *    first one's verification "has been superseded". Its unresolved stages
 *    read SUPD, and after that a TM match on them is refused outright (the
 *    parameter is now answering the newer command); only a report packet,
 *    which names this command, is still taken.
 *
 * The history keeps at most `history` commands, dropping the oldest SETTLED
 * one first and never one still waiting (the CCS5 TC cache: "the oldest
 * commands will be discarded so long as they are completed"). What was
 * dropped is counted in the note.
 */

import { define } from './ov-core.js';
import { REASONS, upgrade } from './ov-refusal.js';

/* Yamcs's own verifier stages, in its order (pymdb Command: transferred to
 * range, sent from range, received, accepted, queued, execution, complete). */
const DEFAULT_STAGES = 'TO-RANGE, FROM-RANGE, RECEIVED, ACCEPTED, QUEUED, EXECUTION, COMPLETE';
const PASSED = new Set(['pass', 'late']);
const OPENS_NEXT = new Set(['pass', 'late', 'timeout']);
const FROM_ATTR = {
  pass: ['pass', 'report'], tm: ['pass', 'tm'], late: ['late', 'report'],
  fail: ['fail', null], timeout: ['timeout', null], superseded: ['superseded', null], pending: ['pending', null],
};

class OvVerifier extends HTMLElement {
  static observedAttributes = ['stages', 'commands', 'reports', 'timeout', 'history', 'label'];

  constructor() {
    super();
    this.stageList = [];
    this.cmds = [];
    this.refusedReports = 0;
    this.dropped = 0;
    this.lastRefusal = null;
  }

  connectedCallback() {
    upgrade(this, ['commands']);
    const first = !this.table;
    if (first) this.build();
    this.readStages();
    if (first && this._commands === undefined) this.applyAttributes();
    this.paint();
    this.watchWidth();
  }

  disconnectedCallback() {
    clearTimeout(this.timer);
    if (this.ro) this.ro.disconnect();
    this.ro = null;
  }

  attributeChangedCallback(name) {
    if (!this.table) return;
    if (name === 'stages') { this.readStages(); if (this._commands === undefined) this.applyAttributes(); }
    if ((name === 'commands' || name === 'reports') && this._commands === undefined) this.applyAttributes();
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label') || 'Command verification');
    this.paint();
  }

  /* ---- READ ----------------------------------------------------------- */

  timeoutOf() { const t = Number(this.getAttribute('timeout')); return Number.isFinite(t) && t > 0 ? t : 10; }
  historyOf() { const h = Math.floor(Number(this.getAttribute('history'))); return Number.isFinite(h) && h > 0 ? h : 20; }

  /* "NAME:seconds:fail, NAME:seconds, NAME" -> [{ name, timeout, fatal }].
   * Duplicates dropped; an on-timeout word other than "fail" is ignored and
   * said. */
  readStages() {
    const out = [];
    this.stageNotes = [];
    for (const part of (this.getAttribute('stages') || DEFAULT_STAGES).split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [rawName, rawSecs, rawAct] = t.split(':').map((x) => x.trim());
      const name = rawName || '';
      const secs = rawSecs === undefined ? NaN : Number(rawSecs);
      if (!name || /\s/.test(name) || out.some((s) => s.name === name)) continue;
      if (rawAct !== undefined && rawAct.toLowerCase() !== 'fail') this.stageNotes.push(`${name}: on-timeout "${rawAct}" ignored (only "fail")`);
      out.push({ name, timeout: Number.isFinite(secs) && secs > 0 ? secs : this.timeoutOf(),
        fatal: rawAct !== undefined && rawAct.toLowerCase() === 'fail' });
    }
    this.stageList = out;
  }

  /* ---- BUILD ---------------------------------------------------------- */

  build() {
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Command verification');
    this.sum = document.createElement('div');
    this.sum.className = 'ov-verifier__sum';
    this.sum.setAttribute('role', 'status');
    this.table = document.createElement('div');
    this.table.className = 'ov-verifier__table';
    this.head = document.createElement('div');
    this.head.className = 'ov-verifier__head';
    this.head.setAttribute('aria-hidden', 'true');
    this.body = document.createElement('div');
    this.body.className = 'ov-verifier__rows';
    this.table.append(this.head, this.body);
    this.legend = document.createElement('div');
    this.legend.className = 'ov-verifier__legend';
    this.note = document.createElement('p');
    this.note.className = 'ov-verifier__note';
    this.append(this.sum, this.table, this.legend, this.note);
  }

  /* 🔴 NARROW IS A LAYOUT, NOT A CROP, as in ov-procedure: below its natural
   * width a row stacks (id and command, then the stage marks, then the
   * verdict), and the head row stays laid out at full width as the ruler. */
  watchWidth() {
    this.fit();
    if (this.ro || typeof ResizeObserver !== 'function') return;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this);
  }

  fit() {
    const need = this.head ? this.head.scrollWidth : 0;
    this.toggleAttribute('data-ov-narrow', need > 0 && this.clientWidth + 1 < need);
  }

  /* ---- MODEL ---------------------------------------------------------- */

  newCommand(id, label, target) {
    return {
      id: String(id), label: String(label || ''), target: target ? String(target) : null, supersededBy: null,
      stages: this.stageList.map((s) => ({
        name: s.name, timeout: s.timeout, fatal: s.fatal, timedOutFatal: false, state: 'idle', evidence: null, dueAt: null,
      })),
    };
  }

  settled(c) { return !c.stages.some((s) => s.state === 'idle' || s.state === 'pending'); }

  arm(s, now) { s.state = 'pending'; s.armedAt = now; s.dueAt = now + s.timeout * 1000; s.closesAt = s.dueAt; }

  /* Open the windows that are due to open. A stage's window opens when the
   * stage before it has passed or timed out (a lost acknowledgement is not a
   * lost command); nothing after a FAIL or a supersession opens again, and
   * whatever was still waiting there is marked as never reached. */
  advance(c, now) {
    let blocked = false;
    c.stages.forEach((s, i) => {
      if (blocked) {
        if (s.state === 'idle' || s.state === 'pending') { s.state = 'unreached'; s.dueAt = null; }
        return;
      }
      if (s.state === 'fail' || s.state === 'superseded' || s.timedOutFatal) { blocked = true; return; }
      if (s.state === 'idle' && (i === 0 || OPENS_NEXT.has(c.stages[i - 1].state))) this.arm(s, now);
    });
  }

  /* Armitage's rule: a newer command to the same target, sent while an older
   * one is still being verified, supersedes the older one's open stages. */
  supersede(fresh) {
    const hit = [];
    fresh.contenders = [];
    if (!fresh.target) return hit;
    // Recorded BEFORE supersession resolves them: a same-target command still
    // in flight when this one went out is a rival cause for any change.
    fresh.contenders = this.cmds.filter((c) => c !== fresh && c.target === fresh.target && !this.settled(c)).map((c) => c.id);
    for (const c of this.cmds) {
      if (c === fresh || c.target !== fresh.target || this.settled(c)) continue;
      if (c.stages.some((s) => s.state === 'fail')) continue;
      for (const s of c.stages) {
        if (s.state !== 'idle' && s.state !== 'pending') continue;
        s.state = 'superseded';
        s.dueAt = null;
        this.emit(c, s);
      }
      c.supersededBy = fresh.id;
      hit.push(c.id);
    }
    return hit;
  }

  /* Keep `history` commands; drop the oldest SETTLED ones, never one waiting. */
  trim() {
    const max = this.historyOf();
    while (this.cmds.length > max) {
      const i = this.cmds.findIndex((c) => this.settled(c));
      if (i < 0) break;
      this.cmds.splice(i, 1);
      this.dropped += 1;
    }
  }

  emit(c, s) {
    // When it resolved, for the one-shot cue in paint().
    s.changedAt = performance.now();
    this.dispatchEvent(new CustomEvent('ov:verify', {
      detail: {
        id: c.id, stage: s.name, state: s.state, evidence: s.evidence, fails: s.state === 'fail' || s.timedOutFatal,
        credited: s.evidence === 'tm' ? !!(s.credit && s.credit.ok) : null,
      }, bubbles: true,
    }));
  }

  /* Timers: every pending window that has closed becomes T/O. */
  tick() {
    const now = performance.now();
    for (const c of this.cmds) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const s of c.stages) {
          if (s.state === 'pending' && s.dueAt <= now) {
            s.state = 'timeout';
            s.timedOutFatal = s.fatal;
            s.dueAt = null;
            this.emit(c, s);
            moved = true;
          }
        }
        if (moved) this.advance(c, now);
      }
    }
  }

  /* ---- INPUT ---------------------------------------------------------- */

  /* A new command. { id, label?, target? }. Returns { ok, reason?, superseded }. */
  issue(cmd) {
    if (!cmd || typeof cmd !== 'object' || cmd.id === undefined || cmd.id === null || String(cmd.id).trim() === '') {
      return this.refuseReport('issue ignored: a command needs an id');
    }
    const id = String(cmd.id).trim();
    if (this.cmds.some((c) => c.id === id)) return this.refuseReport(`issue ignored: ${id} is already in the stack`);
    const c = this.newCommand(id, cmd.label, cmd.target);
    this.cmds.push(c);
    const superseded = this.supersede(c);
    this.advance(c, performance.now());
    this.trim();
    this.paint();
    return { ok: true, superseded };
  }

  /* The system answering for one stage. `result` is "pass" or "fail";
   * `evidence` is "report" (a verification packet naming this command, the
   * default) or "tm" (a telemetry parameter reached its expected value).
   * Returns { ok, reason? }. */
  report(id, stage, result, evidence = 'report', detail = null) {
    const c = this.cmds.find((x) => x.id === String(id));
    if (!c) return this.refuseReport(`report ignored: no command ${id}`);
    const s = c.stages.find((x) => x.name === stage);
    if (!s) return this.refuseReport(`report ignored: ${id} has no stage ${stage}`);
    if (result !== 'pass' && result !== 'fail') return this.refuseReport(`report ignored: ${id} ${stage} result must be pass or fail`);
    if (evidence !== 'report' && evidence !== 'tm') return this.refuseReport(`report ignored: ${id} ${stage} evidence must be report or tm`);
    if (PASSED.has(s.state) || s.state === 'fail') {
      return this.refuseReport(`${id} ${stage} already ${s.state === 'fail' ? 'FAILED' : 'PASSED'}: a second answer is not taken`);
    }
    if (s.state === 'superseded' && evidence === 'tm') {
      return this.refuseReport(`${id} ${stage} TM not credited: superseded by ${c.supersededBy || 'a newer command'}`);
    }
    const late = s.state === 'timeout';
    const now = performance.now();
    s.credit = result === 'pass' && evidence === 'tm' ? this.tmCredit(c, s, detail, now) : null;
    s.state = result === 'fail' ? 'fail' : late ? 'late' : 'pass';
    s.evidence = result === 'fail' ? null : evidence;
    s.dueAt = null;
    this.emit(c, s);
    this.advance(c, performance.now());
    this.trim();
    this.paint();
    return { ok: true };
  }

  /* Whether a TM pass may be credited to this command: { ok, why }. The
   * conditions are checked in the order a reader would ask them. */
  tmCredit(c, s, d, now) {
    if (!d || typeof d !== 'object' || !('before' in d) || !('value' in d) || !('expected' in d)) {
      return { ok: false, why: 'NO CHANGE SHOWN' };
    }
    if (s.armedAt === undefined || s.armedAt === null) return { ok: false, why: 'ITS WINDOW WAS NOT OPEN' };
    // 🔴 A change is only known to lie between the last sample that still
    // read `before` and the first that read `value`: (tBefore, tValue]. It is
    // credited only if that whole interval sits inside the stage's window;
    // straddling an edge it is UNDETERMINED. The same interval rule as
    // ov-consistency, so the two agree even at the window edges.
    const age = Number(d.age), beforeAge = Number(d.beforeAge);
    if (!Number.isFinite(age) || age < 0 || !Number.isFinite(beforeAge) || beforeAge < age) {
      return { ok: false, why: 'CHANGE TIME NOT GIVEN' };
    }
    const tValue = now - age * 1000, tBefore = now - beforeAge * 1000;
    if (tValue < s.armedAt) return { ok: false, why: 'SAMPLE PREDATES ITS WINDOW' };
    // Wholly after the window, or straddling its close (UNDETERMINED, as
    // ov-consistency says of any interval a window only partly covers).
    if (tBefore >= s.closesAt) return { ok: false, why: 'CHANGE AFTER ITS WINDOW' };
    if (tValue > s.closesAt) return { ok: false, why: 'CHANGE TIME UNDETERMINED: FIRST NEW SAMPLE IS AFTER ITS WINDOW' };
    if (tBefore < s.armedAt) return { ok: false, why: 'CHANGE TIME UNDETERMINED: LAST OLD SAMPLE PREDATES ITS WINDOW' };
    const same = (x, y) => String(x) === String(y);
    if (same(d.before, d.expected)) return { ok: false, why: `WAS ALREADY ${d.expected}` };
    if (!same(d.value, d.expected)) return { ok: false, why: `READS ${d.value}, EXPECTS ${d.expected}` };
    if (c.contenders && c.contenders.length) return { ok: false, why: `${c.target} ALSO IN FLIGHT: ${c.contenders.join(', ')}` };
    return { ok: true, why: `CHANGED ${d.before} TO ${d.expected}` };
  }

  refuseReport(reason) {
    this.refusedReports += 1;
    this.lastRefusal = reason;
    this.paint();
    return { ok: false, reason };
  }

  /* The whole stack, as an ARRAY of { id, label, target, stages: [{ stage,
   * state, evidence }] }. Setting it replaces the stack; stages it names are
   * taken as given, the rest open by the usual rules. A map is refused. */
  set commands(list) {
    this._commands = list;
    this.rejected = null;
    this.cmds = [];
    if (Array.isArray(list)) {
      for (const x of list) {
        if (!x || typeof x !== 'object' || x.id === undefined || x.id === null) continue;
        const c = this.newCommand(x.id, x.label, x.target);
        this.cmds.push(c);
        this.supersede(c);
        for (const g of Array.isArray(x.stages) ? x.stages : []) {
          const s = g && c.stages.find((y) => y.name === g.stage);
          const map = g && FROM_ATTR[g.state === 'pass' && g.evidence === 'tm' ? 'tm' : g.state];
          if (!s || !map) continue;
          this.setStage(s, map);
        }
      }
    } else if (list !== undefined && list !== null) {
      this.rejected = 'commands ignored: not an array of { id, label, target, stages }';
    }
    const now = performance.now();
    for (const c of this.cmds) this.advance(c, now);
    this.trim();
    if (this.table) this.paint();
  }

  get commands() {
    return this.cmds.map((c) => ({
      id: c.id, label: c.label, target: c.target, supersededBy: c.supersededBy,
      stages: c.stages.map((s) => ({ stage: s.name, state: s.state, evidence: s.evidence, credited: !!(s.credit && s.credit.ok) })),
    }));
  }

  setStage(s, [state, evidence]) {
    if (state === 'pending') { this.arm(s, performance.now()); return; }
    s.timedOutFatal = s.fatal && (state === 'timeout' || state === 'late');
    s.state = state;
    s.evidence = evidence;
    s.dueAt = null;
  }

  /* commands="ID label words @TARGET; ..."  reports="ID STAGE=state, ..."
   * The attributes are a snapshot: rebuilt whole whenever either changes. */
  applyAttributes() {
    this.cmds = [];
    this.malformed = 0;
    const reports = [];
    for (const part of (this.getAttribute('reports') || '').split(',')) {
      const t = part.trim();
      if (!t) continue;
      const at = t.lastIndexOf('=');
      const head = at > 0 ? t.slice(0, at).trim().split(/\s+/) : [];
      const map = FROM_ATTR[t.slice(at + 1).trim().toLowerCase()];
      if (head.length !== 2 || !map) { this.malformed += 1; continue; }
      reports.push({ id: head[0], stage: head[1], map });
    }
    for (const part of (this.getAttribute('commands') || '').split(';')) {
      const words = part.trim().split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      const id = words.shift();
      if (this.cmds.some((c) => c.id === id)) { this.malformed += 1; continue; }
      const tgt = words.length && words[words.length - 1].startsWith('@') ? words.pop().slice(1) : null;
      const c = this.newCommand(id, words.join(' '), tgt);
      this.cmds.push(c);
      this.supersede(c);
      for (const r of reports.filter((x) => x.id === id)) {
        const s = c.stages.find((y) => y.name === r.stage);
        if (s) this.setStage(s, r.map); else this.malformed += 1;
      }
    }
    this.malformed += reports.filter((r) => !this.cmds.some((c) => c.id === r.id)).length;
    const now = performance.now();
    for (const c of this.cmds) this.advance(c, now);
    this.trim();
  }

  /* ---- DERIVED -------------------------------------------------------- */

  /* What the row may say. It names the furthest stage that PASSED, in that
   * stage's word; it never promotes past it. */
  verdict(c, now) {
    const st = c.stages;
    const fail = st.find((s) => s.state === 'fail' || s.timedOutFatal);
    let far = -1;
    st.forEach((s, i) => { if (PASSED.has(s.state)) far = i; });
    const seen = far >= 0 ? st[far] : null;
    // NOT SEEN: behind the furthest pass and never passed, or timed out
    // anywhere. ⚠️ The first cut only looked behind the furthest pass, so a
    // command whose first stage timed out read "ISSUED · B PENDING" and the
    // timeout vanished from the row.
    const unseen = st.filter((s, i) => (i < far && !PASSED.has(s.state)) || s.state === 'timeout').map((s) => s.name);
    const gap = unseen.length ? ` · ${unseen.join(', ')} NOT SEEN` : '';
    const credited = (x) => x.evidence !== 'tm' || (x.credit && x.credit.ok);
    const tm = !seen || seen.evidence !== 'tm' ? ''
      : credited(seen) ? ' BY TM CHANGE' : ` BY TM, NOT CREDITED: ${seen.credit ? seen.credit.why : 'NO CHANGE SHOWN'}`;
    const last = seen ? `LAST SEEN ${seen.name}${tm}` : 'NOTHING SEEN';
    if (fail) {
      const why = fail.state === 'fail' ? '' : `: NO ANSWER IN ITS WINDOW${fail.state === 'late' ? ', ANSWERED LATE' : ''}`;
      return { state: 'failed', text: `FAILED AT ${fail.name}${why}`, gap: !!unseen.length };
    }
    if (c.supersededBy && st.some((s) => s.state === 'superseded')) {
      return { state: 'superseded', text: `SUPERSEDED BY ${c.supersededBy} · ${last}`, gap: !!unseen.length };
    }
    const pending = st.find((s) => s.state === 'pending');
    if (pending) {
      // A stage still inside its window is PENDING, not NOT SEEN: only the
      // ones that are closed and never passed go in the gap list here.
      const left = Math.max(0, Math.ceil((pending.dueAt - now) / 1000));
      const closed = unseen.filter((name) => st.find((s) => s.name === name).state !== 'pending');
      return {
        state: 'pending', gap: !!closed.length,
        text: `${seen ? seen.name + tm : 'ISSUED'} · ${pending.name} PENDING ${left}s${closed.length ? ` · ${closed.join(', ')} NOT SEEN` : ''}`,
      };
    }
    if (far === st.length - 1 && far >= 0) {
      const st8 = seen.evidence !== 'tm' ? 'complete' : credited(seen) ? 'tmcredited' : 'uncredited';
      return { state: st8, text: `${seen.name}${tm}${gap}`, gap: !!unseen.length };
    }
    const timeout = st.find((s) => s.state === 'timeout');
    if (timeout) return { state: 'timeout', text: `NO ANSWER AT ${timeout.name} · ${last}`, gap: !!unseen.length };
    return { state: 'issued', text: seen ? `${seen.name}${tm}${gap}` : 'ISSUED', gap: !!unseen.length };
  }

  word(s, now) {
    switch (s.state) {
      case 'pass': return s.evidence !== 'tm' ? 'PASS' : s.credit && s.credit.ok ? 'TM OK' : 'TM ?';
      case 'late': return 'LATE';
      case 'fail': return 'FAIL';
      case 'timeout': return 'T/O';
      case 'superseded': return 'SUPD';
      case 'pending': return `${Math.max(0, Math.ceil((s.dueAt - now) / 1000))}s`;
      case 'unreached': return '—';
      default: return '·';
    }
  }

  longWord(s) {
    return {
      pass: s.evidence !== 'tm' ? 'passed by report'
        : s.credit && s.credit.ok ? `telemetry ${s.credit.why.toLowerCase()} inside its window, credited`
          : `telemetry matches, not credited: ${(s.credit ? s.credit.why : 'no change shown').toLowerCase()}`,
      late: s.timedOutFatal ? 'answered after its window closed; the timeout had already failed the command' : 'passed after its window closed',
      fail: 'failed',
      timeout: s.timedOutFatal ? 'timed out, and a timeout here fails the command' : 'timed out, neither passed nor failed',
      superseded: 'superseded by a newer command', pending: 'waiting', unreached: 'not reached', idle: 'not yet open',
    }[s.state];
  }

  /* ---- PAINT ---------------------------------------------------------- */

  paint() {
    if (!this.table) return;
    this.tick();
    const now = performance.now();
    const n = this.stageList.length;
    this.style.setProperty('--ov-verifier-n', String(Math.max(1, n)));

    // The head: the ruler for the narrow check, and the column names.
    this.head.replaceChildren();
    const hcell = (cls, text) => {
      const e = document.createElement('span');
      e.className = cls;
      e.textContent = text;
      this.head.append(e);
    };
    hcell('ov-verifier__id', 'ID');
    hcell('ov-verifier__label', 'COMMAND');
    const names = document.createElement('span');
    names.className = 'ov-verifier__marks';
    for (const s of this.stageList) {
      const e = document.createElement('span');
      e.className = 'ov-verifier__stage';
      e.textContent = s.fatal ? `${s.name}*` : s.name;
      if (s.fatal) e.setAttribute('data-ov-fatal', '');
      names.append(e);
    }
    this.head.append(names);
    hcell('ov-verifier__verdict', 'VERIFIED TO');

    this.body.replaceChildren();
    const tally = { pending: 0, complete: 0, tmcredited: 0, uncredited: 0, failed: 0, timeout: 0, superseded: 0, issued: 0 };
    let nextDue = Infinity;
    for (const c of this.cmds) {
      const v = this.verdict(c, now);
      tally[v.state] += 1;
      const row = document.createElement('div');
      row.className = 'ov-verifier__row';
      row.setAttribute('data-ov-state', v.state);
      row.toggleAttribute('data-ov-gap', v.gap);
      row.setAttribute('role', 'group');
      const id = document.createElement('span');
      id.className = 'ov-verifier__id';
      id.textContent = c.id;
      const label = document.createElement('span');
      label.className = 'ov-verifier__label';
      label.textContent = c.label;
      if (c.target) {
        // The space is its own text node, outside the target: the target is
        // an inline-block so it wraps as one unit, and a leading space inside
        // an inline-block collapses ("HTR-2 ON@HTR2").
        const tgt = document.createElement('span');
        tgt.className = 'ov-verifier__target';
        tgt.textContent = `@${c.target}`;
        label.append(' ', tgt);
      }
      const marks = document.createElement('span');
      marks.className = 'ov-verifier__marks';
      marks.setAttribute('aria-hidden', 'true');
      for (const s of c.stages) {
        const cell = document.createElement('span');
        cell.className = 'ov-verifier__cell';
        cell.setAttribute('data-ov-stage', s.name);
        cell.setAttribute('data-ov-state', s.state);
        cell.toggleAttribute('data-ov-fatal', s.timedOutFatal);
        if (s.evidence) cell.setAttribute('data-ov-evidence', s.evidence);
        cell.toggleAttribute('data-ov-credited', !!(s.evidence === 'tm' && s.credit && s.credit.ok));
        cell.title = `${s.name}: ${this.longWord(s)}`;
        if (s.state === 'pending') {
          nextDue = Math.min(nextDue, s.dueAt);
          const left = Math.max(0, Math.min(1, (s.dueAt - now) / (s.timeout * 1000)));
          cell.style.setProperty('--ov-verifier-left', left.toFixed(3));
          // ⭐ MOTION IS TIME HERE, NOT DECORATION. The drain runs over the
          // stage's real window, and because every paint rebuilds the cell,
          // it starts each time with a NEGATIVE delay of the time already
          // spent, so it continues rather than restarting. The static
          // --ov-verifier-left above is what reduced motion (or no
          // animation) shows: the same fill, stepped once a second.
          cell.style.setProperty('--ov-verifier-window', `${s.timeout}s`);
          cell.style.setProperty('--ov-verifier-elapsed', `${-Math.round(now - s.armedAt)}ms`);
        }
        // The one-shot cue on a stage that has just resolved. Same negative
        // delay trick, so a repaint mid-cue does not replay it; after 2 s the
        // attribute is simply not set again.
        if (s.changedAt !== undefined && now - s.changedAt < 2000 && s.state !== 'pending' && s.state !== 'idle') {
          cell.setAttribute('data-ov-cue', '');
          cell.style.setProperty('--ov-verifier-cue', `${-Math.round(now - s.changedAt)}ms`);
        }
        const mark = document.createElement('i');
        mark.className = 'ov-verifier__mark';
        const w = document.createElement('span');
        w.className = 'ov-verifier__word';
        w.textContent = this.word(s, now);
        cell.append(mark, w);
        marks.append(cell);
      }
      const verdict = document.createElement('span');
      verdict.className = 'ov-verifier__verdict';
      verdict.textContent = v.text;
      row.append(id, label, marks, verdict);
      row.setAttribute('aria-label', `${c.id} ${c.label}: ${v.text}. `
        + c.stages.map((s) => `${s.name} ${this.longWord(s)}`).join(', '));
      this.body.append(row);
    }

    // The summary counts verdicts, not stages, and never adds a NO ANSWER
    // to either side of the pass/fail ledger.
    const parts = [`${this.cmds.length} COMMAND${this.cmds.length === 1 ? '' : 'S'}`];
    const say = (k, w) => { if (tally[k]) parts.push(`${tally[k]} ${w}`); };
    say('pending', 'PENDING'); say('complete', 'VERIFIED'); say('tmcredited', 'VERIFIED BY TM CHANGE'); say('uncredited', 'TM ONLY');
    say('failed', 'FAILED'); say('timeout', 'NO ANSWER'); say('superseded', 'SUPERSEDED');
    this.sum.textContent = parts.join(' · ');
    this.setAttribute('data-ov-verifier', tally.failed ? 'failed' : tally.timeout ? 'timeout' : tally.pending ? 'pending' : 'quiet');

    // The on_timeout=FAIL rule, said before it bites.
    const fatal = this.stageList.filter((s) => s.fatal).map((s) => s.name);
    this.legend.textContent = fatal.length ? `* A TIMEOUT AT ${fatal.join(', ')} FAILS THE COMMAND` : '';
    this.legend.hidden = !fatal.length;

    const said = [...(this.stageNotes || [])];
    if (!n) said.push('no stages declared: nothing can be verified');
    if (!this.cmds.length) said.push(`no commands: ${REASONS.unknown}`);
    if (this.dropped) said.push(`${this.dropped} settled command${this.dropped > 1 ? 's' : ''} dropped from the history`);
    if (this.refusedReports) said.push(`${this.refusedReports} report${this.refusedReports > 1 ? 's' : ''} refused, last: ${this.lastRefusal}`);
    if (this.malformed) said.push(`${this.malformed} malformed entr${this.malformed > 1 ? 'ies' : 'y'} ignored`);
    if (this.rejected) said.push(this.rejected);
    this.note.textContent = said.join(' · ');
    this.note.hidden = !said.length;

    // One timer: the next window to close, or the next whole second for the
    // countdowns, whichever is sooner.
    clearTimeout(this.timer);
    if (nextDue !== Infinity && this.isConnected) {
      this.timer = setTimeout(() => this.paint(), Math.max(0, Math.min(nextDue - now, 1000)) + 5);
    }
    if (this.isConnected) this.fit();
  }
}

define('ov-verifier', OvVerifier);

export { OvVerifier };
