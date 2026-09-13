/* <ov-continuity> - which packets came, counted by their numbers, not the clock.
 *
 * Per source (a CCSDS APID), the 14-bit packet sequence
 * count: packets arrive numbered, the number wraps at 16384, and a missing
 * number is a missing packet whether or not there is any gap in time. The
 * chart's and timeline's gaps are gaps in TIME; packets can be lost with no
 * visible time gap at all, so this counts loss BY SEQUENCE.
 *
 * ⭐ THE REFUSAL: ACROSS A RESET, COMPLETENESS CANNOT BE DETERMINED. When a
 * source's counter is reset, nothing about the numbers says how many packets
 * were lost around it. CCSDS 133.0-B-2 §4.1.3.4.3: "If the Packet Sequence
 * Count is reset because of an unavoidable reinitialization of a process, the
 * completeness of a sequence of Packets cannot be determined." So the strip
 * breaks there, each side is counted on its own, and the source is never
 * called COMPLETE across the break.
 *
 * And A JUMP THAT COULD BE EITHER IS NOT GUESSED. A count that leaps forward
 * by more than `window` (default 4096) is a reset nobody declared, or a very
 * large loss, and the numbers cannot tell which: 9000 then 3 is 7,387 lost
 * across a wrap, or a restart with none. It is drawn as a break and counted
 * as a discontinuity, never silently as either.
 *
 * Within a segment: missing numbers are counted in runs; a packet arriving
 * after a higher number is OUT OF ORDER and fills its gap; the same number
 * twice is a DUPLICATE; 16383 then 0 is a WRAP, and continuous.
 *
 * Input, as the `streams` property or from `src`:
 *   [{ source, packets: [{ seq, reset? }, ...] }]   in ARRIVAL order
 *   reset: true on the first packet after a declared counter reset.
 */

import { define } from './ov-core.js';

const CONT_MOD = 16384;
const contText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const contCount = (n) => n.toLocaleString('en-US');

/* One source, arrival order in; segments out. Pure, so it can be tested. */
function contAnalyse(packets, win) {
  const segs = [];
  let seg = null;
  const open = (why) => {
    seg = { why, base: null, hi: null, seen: new Set(), wraps: 0, ooo: 0, dup: 0, received: 0, bad: 0 };
    segs.push(seg);
  };
  for (const p of packets) {
    const seq = Number(p && p.seq);
    if (!Number.isInteger(seq) || seq < 0 || seq >= CONT_MOD) { if (!seg) open(null); seg.bad += 1; continue; }
    if (!seg || p.reset) open(seg ? 'reset' : null);
    if (seg.base === null) { seg.base = seq; seg.hi = 0; seg.seen.add(0); seg.received += 1; continue; }
    // Position within the segment, unwrapped against the highest seen so far.
    const hiAbs = seg.base + seg.hi;
    const fwd = ((seq - hiAbs) % CONT_MOD + CONT_MOD) % CONT_MOD;
    let rel;
    if (fwd === 0) rel = seg.hi;
    else if (fwd <= win) rel = seg.hi + fwd;
    else if (CONT_MOD - fwd <= win) rel = seg.hi - (CONT_MOD - fwd);   // behind: late or repeated
    else { open('jump'); seg.base = seq; seg.hi = 0; seg.seen.add(0); seg.received += 1; continue; }
    if (rel < 0) {
      // Late, and earlier than the first number this segment saw: it is out
      // of order, not a new stream. The segment's start moves back to it.
      const k = -rel;
      seg.seen = new Set([...seg.seen].map((v) => v + k));
      seg.base = ((seg.base - k) % CONT_MOD + CONT_MOD) % CONT_MOD;
      seg.hi += k;
      rel = 0;
    }
    if (seg.seen.has(rel)) { seg.dup += 1; continue; }
    if (rel < seg.hi) seg.ooo += 1;
    if (rel > seg.hi) {
      seg.wraps += Math.floor((seg.base + rel) / CONT_MOD) - Math.floor((seg.base + seg.hi) / CONT_MOD);
      seg.hi = rel;
    }
    seg.seen.add(rel);
    seg.received += 1;
  }
  for (const s of segs) {
    const runs = [];
    if (s.hi !== null) {
      let start = null;
      for (let i = 0; i <= s.hi; i++) {
        if (!s.seen.has(i)) { if (start === null) start = i; }
        else if (start !== null) { runs.push([start, i - 1]); start = null; }
      }
    }
    s.runs = runs;
    s.missing = runs.reduce((a, [x, y]) => a + (y - x + 1), 0);
    s.span = s.hi === null ? 0 : s.hi + 1;
  }
  return segs;
}

class OvContinuity extends HTMLElement {
  static observedAttributes = ['src', 'window'];

  connectedCallback() {
    this._streams = this._streams || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get streams() { return this._streams; }
  set streams(v) { this._streams = Array.isArray(v) ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._streams = Array.isArray(data.streams) ? data.streams : null;
    } catch {
      if (this.getAttribute('src') === src) this._streams = null;
    }
    this.paint();
  }

  paint() {
    const S = this._streams;
    this.removeAttribute('data-ov-refusal');
    if (!S || !S.length) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.innerHTML = '<div class="ov-continuity__void">NO PACKETS</div>';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'Packet continuity, no packets');
      return;
    }
    const raw = this.getAttribute('window');
    const wv = raw === null ? NaN : Number(raw);
    const win = Number.isInteger(wv) && wv > 0 && wv < CONT_MOD / 2 ? wv : 4096;
    const W = 420, H = 14;
    let html = '';
    const aria = [];
    for (const stream of S) {
      const segs = contAnalyse(Array.isArray(stream.packets) ? stream.packets : [], win);
      const received = segs.reduce((a, s) => a + s.received, 0);
      const missing = segs.reduce((a, s) => a + s.missing, 0);
      const runs = segs.reduce((a, s) => a + s.runs.length, 0);
      const ooo = segs.reduce((a, s) => a + s.ooo, 0);
      const dup = segs.reduce((a, s) => a + s.dup, 0);
      const wraps = segs.reduce((a, s) => a + s.wraps, 0);
      const bad = segs.reduce((a, s) => a + s.bad, 0);
      const resets = segs.filter((s) => s.why === 'reset').length;
      const jumps = segs.filter((s) => s.why === 'jump').length;
      const breaks = resets + jumps;
      // ⭐ The verdict: never COMPLETE across a break.
      const verdict = breaks ? 'UNDETERMINED' : missing ? 'INCOMPLETE' : received ? 'COMPLETE' : 'NO PACKETS';
      const cls = { UNDETERMINED: 'is-undetermined', INCOMPLETE: 'is-incomplete', COMPLETE: 'is-complete', 'NO PACKETS': 'is-none' }[verdict];

      // The strip: x is SEQUENCE position, segments laid end to end with a
      // break mark between them, each as wide as the numbers it spans.
      const total = segs.reduce((a, s) => a + Math.max(1, s.span), 0);
      const gap = 14;
      const usable = W - gap * (segs.length - 1);
      let x = 0, g = '';
      segs.forEach((s, i) => {
        if (i) {
          g += `<g class="ov-continuity__break is-${s.why}"><line x1="${x - gap / 2 - 2}" y1="0" x2="${x - gap / 2 - 2}" y2="${H}"/>`
            + `<line x1="${x - gap / 2 + 2}" y1="0" x2="${x - gap / 2 + 2}" y2="${H}"/>`
            + `<text x="${x - gap / 2}" y="${H + 9}" text-anchor="middle">?</text><title>${s.why === 'reset' ? 'counter reset: completeness across it cannot be determined' : 'a jump that is a reset or a large loss; the numbers cannot say which'}</title></g>`;
        }
        const w = usable * (Math.max(1, s.span) / total);
        g += `<rect class="ov-continuity__seg" x="${x.toFixed(1)}" y="2" width="${Math.max(1, w).toFixed(1)}" height="${H - 4}"/>`;
        for (const [a, b] of s.runs) {
          const rx = x + (a / Math.max(1, s.span)) * w;
          const rw = Math.max(1.2, ((b - a + 1) / Math.max(1, s.span)) * w);
          g += `<rect class="ov-continuity__miss" x="${rx.toFixed(1)}" y="0" width="${rw.toFixed(1)}" height="${H}"><title>${b - a + 1} missing</title></rect>`;
        }
        x += w + gap;
      });

      const words = [`${contCount(received)} received`];
      if (missing) words.push(`${contCount(missing)} missing in ${runs} run${runs === 1 ? '' : 's'}`);
      if (ooo) words.push(`${ooo} out of order`);
      if (dup) words.push(`${dup} duplicate${dup === 1 ? '' : 's'}`);
      if (wraps) words.push(`${wraps} wrap${wraps === 1 ? '' : 's'}`);
      if (resets) words.push(`completeness across ${resets} reset${resets === 1 ? '' : 's'} cannot be determined`);
      if (jumps) words.push(`${jumps} jump${jumps === 1 ? '' : 's'}: reset or loss, not determined`);
      if (bad) words.push(`${bad} without a valid count`);
      html += `<div class="ov-continuity__row ${cls}" data-source="${contText(stream.source ?? '?')}">`
        + `<span class="ov-continuity__src">${contText(stream.source ?? '?')}</span>`
        + `<span class="ov-continuity__verdict">${verdict}</span>`
        + `<svg class="ov-continuity__strip" viewBox="0 -1 ${W} ${H + 12}" aria-hidden="true">${g}</svg>`
        + `<span class="ov-continuity__words">${words.map((w) => `<span${/missing|cannot|not determined|out of order|duplicate|without/.test(w) ? ' class="is-flag"' : ''}>${contText(w)}</span>`).join('')}</span></div>`;
      aria.push(`${stream.source ?? 'unnamed source'} ${verdict.toLowerCase()}, ${words.join(', ')}`);
    }
    this.innerHTML = `<div class="ov-continuity__rows">${html}</div>`
      + '<div class="ov-continuity__note">counted by sequence number, not by clock</div>';
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Packet continuity: ${aria.join('; ')}`);
  }
}

define('ov-continuity', OvContinuity);

export { OvContinuity, contAnalyse };
