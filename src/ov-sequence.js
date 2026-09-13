/* <ov-sequence> - a read against its reference, and the positions nobody read.
 *
 * The genetics screens of Jurassic Park, Prometheus, Gattaca
 * and Blade Runner 2049's archive: rows of symbols aligned against a
 * reference, mismatches marked. Nothing here is specific to DNA; any alphabet
 * aligned position by position works (a protein, a code, a signal's symbols).
 *
 * ⭐ THE REFUSAL: A GAP IS NEVER FILLED FROM THE REFERENCE. An unread position
 * (N, a gap `-`, or a base whose quality is below `min-quality`) is shown as
 * N or a gap, and the reference symbol above it is NOT copied down. Filling a
 * sequence's holes from what it was expected to be is exactly Jurassic Park's
 * frog DNA, and the film's interface never even shows the fill (Noessel). The
 * strip counts what it could not read instead.
 *
 * And it will not align for you: a read whose length differs from its
 * reference is refused, because choosing where the insertions go is an
 * alignment, and an alignment the display invented is a reading nobody took.
 *
 * Input, as the `sequence` property or from `src`:
 *   { reference: 'ACGT...', read: 'ACGN-T...', quality: [0..60, ...] }
 * Already aligned, the same length. `quality` is per position (phred-style)
 * and optional; `min-quality` (default 20) is the threshold for calling a base.
 */

import { define } from './ov-core.js';

const SEQ_GAP = new Set(['-', '.', ' ']);

class OvSequence extends HTMLElement {
  static observedAttributes = ['src', 'min-quality', 'width'];

  connectedCallback() {
    this._sequence = this._sequence || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get sequence() { return this._sequence; }
  set sequence(v) { this._sequence = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._sequence = data;
    } catch {
      if (this.getAttribute('src') === src) this._sequence = null;
    }
    this.paint();
  }

  refuse(text) {
    this.setAttribute('data-ov-refusal', 'unknown');
    this.innerHTML = `<div class="ov-sequence__void">${text}</div>`;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Sequence, ${text.toLowerCase()}`);
  }

  paint() {
    const S = this._sequence;
    this.removeAttribute('data-ov-refusal');
    if (!S || typeof S.reference !== 'string' || typeof S.read !== 'string') {
      this.refuse('NO SEQUENCE');
      return;
    }
    const ref = S.reference.toUpperCase();
    const read = S.read.toUpperCase();
    if (ref.length !== read.length) {
      // Not aligned. Aligning here would be inventing where the gaps go.
      this.refuse(`NOT ALIGNED: read ${read.length}, reference ${ref.length}; the strip does not align`);
      return;
    }
    const q = Array.isArray(S.quality) ? S.quality : null;
    // ⚠️ Number(null) is 0, not NaN: an absent attribute read that way set the
    // threshold to 0 and no base was ever called N. Check for absence first.
    const minQ = (() => { const raw = this.getAttribute('min-quality'); const v = raw === null ? NaN : Number(raw); return Number.isFinite(v) ? v : 20; })();
    const W = (() => { const v = Number(this.getAttribute('width')); return Number.isInteger(v) && v > 4 ? v : 40; })();

    let gaps = 0, uncalled = 0, lowq = 0, mismatches = 0, called = 0;
    const cells = [];
    for (let i = 0; i < ref.length; i++) {
      const r = ref[i];
      let b = read[i];
      let kind;
      if (SEQ_GAP.has(b)) { kind = 'gap'; gaps += 1; b = '-'; }
      else if (b === 'N' || b === '?') { kind = 'n'; uncalled += 1; b = 'N'; }
      else if (q && Number.isFinite(Number(q[i])) && Number(q[i]) < minQ) {
        // Below the threshold: CALLED N, the way a sequencer does. The base it
        // guessed is not shown as if it had been read.
        kind = 'lowq'; lowq += 1; b = 'N';
      } else if (b !== r) { kind = 'mismatch'; mismatches += 1; called += 1; }
      else { kind = 'match'; called += 1; }
      cells.push({ r, b, kind, q: q ? q[i] : null });
    }

    let h = '<div class="ov-sequence__rows">';
    for (let start = 0; start < cells.length; start += W) {
      const row = cells.slice(start, start + W);
      h += `<div class="ov-sequence__row"><span class="ov-sequence__pos">${start + 1}</span>`
        + `<span class="ov-sequence__line is-ref">${row.map((c) => `<i>${c.r}</i>`).join('')}</span>`
        + `<span class="ov-sequence__pos"></span>`
        + `<span class="ov-sequence__line is-read">${row.map((c) => `<i class="is-${c.kind}"${c.kind === 'lowq' ? ` title="quality ${c.q}, below ${minQ}"` : ''}>${c.b}</i>`).join('')}</span></div>`;
    }
    h += '</div>';

    const unread = gaps + uncalled + lowq;
    const parts = [`${called} of ${cells.length} positions read`];
    if (mismatches) parts.push(`${mismatches} mismatch${mismatches === 1 ? '' : 'es'}`);
    if (unread) {
      parts.push(`${unread} unread, NOT filled from the reference`
        + ` (${[gaps && `${gaps} gap`, uncalled && `${uncalled} N`, lowq && `${lowq} below quality ${minQ}`].filter(Boolean).join(', ')})`);
    }
    h += `<div class="ov-sequence__readout">${parts.map((p) => `<span${/unread|mismatch/.test(p) ? ' class="is-flag"' : ''}>${p}</span>`).join('')}</div>`;
    this.innerHTML = h;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Sequence, ${parts.join(', ')}`);
  }
}

define('ov-sequence', OvSequence);

export { OvSequence };
