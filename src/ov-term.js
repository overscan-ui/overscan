/* <ov-term> - a cursor-addressed terminal screen.
 *
 * For terminal and neo. <ov-ansi> styles a stream that only APPENDS; <ov-grid>
 * shows a painted screen and nothing could drive one. A program that paints a
 * screen moves the cursor, erases, inserts and scrolls, and that is what this
 * implements: a fixed `cols` x `rows` buffer driven by a VT100 core plus the
 * common xterm additions.
 *
 * ⭐ THE REFUSAL: AN ESCAPE SEQUENCE IT DOES NOT IMPLEMENT IS REFUSED VISIBLY.
 * Printing it puts `[?1049h` on the screen, which no program ever meant to
 * show. Dropping it is worse: the program asked for a state change (an
 * alternate screen, a mode, a title) and every character after it is drawn as
 * if that change never happened, so the screen goes quietly wrong. Here the
 * cell where it arrived is outlined in the alarm colour, and the status line
 * names each refused sequence with a count, so the reader knows from which
 * point the picture stopped being the one the program painted.
 *
 * Colour follows <ov-ansi>: the eight basic colours use its classes, declared
 * in aux.css, so the theme mapping is ONE declaration for both elements.
 * 256-colour, truecolor and background colours name a colour this theme does
 * not have; the text keeps the nearest token and the element counts them.
 *
 * Input: write(data) appends a stream; `src` fetches a recorded session and
 * plays it at `baud` characters per second (0 = all at once); `source` takes
 * strings from a named Overscan source. `cols` and `rows` default to 80 x 24.
 */

import { define, Overscan } from './ov-core.js';
import { cellsFor } from './ov-grid.js';
import './ov-source.js';

const ESCAPE = '\x1b';
const SGR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
/* DEC special graphics, selected by ESC ( 0: the box drawing most curses
   programs actually emit, as letters. */
const DEC = { j: '┘', k: '┐', l: '┌', m: '└', n: '┼', q: '─', t: '├', u: '┤',
  v: '┴', w: '┬', x: '│', a: '▒', '`': '◆', f: '°', g: '±', '~': '·', o: '⎺', s: '⎽' };
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/* A sequence as a person would write it, for the status line. */
const spell = (s) => s.replace(/\x1b/g, 'ESC ').replace(/\x07/g, ' BEL')
  .replace(/[\x00-\x1f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`);

class OvTerm extends HTMLElement {
  static observedAttributes = ['cols', 'rows', 'src', 'baud', 'source'];

  connectedCallback() {
    this.render();
    this.reset();
    this.bind();
    this.fetchSrc();
  }

  disconnectedCallback() {
    clearTimeout(this.playTimer);
    cancelAnimationFrame(this.raf);
    if (this.unsub) this.unsub();
  }

  attributeChangedCallback(n) {
    if (!this.screen) return;
    if (n === 'cols' || n === 'rows') { this.reset(); this.schedule(); }
    else if (n === 'src') this.fetchSrc();
    else if (n === 'source') this.bind();
  }

  size() {
    const c = Number(this.getAttribute('cols'));
    const r = Number(this.getAttribute('rows'));
    return {
      cols: Number.isInteger(c) && c > 0 ? Math.min(c, 400) : 80,
      rows: Number.isInteger(r) && r > 0 ? Math.min(r, 200) : 24,
    };
  }

  render() {
    this.innerHTML = `<div class="ov-term__screen" role="img" aria-roledescription="terminal screen"></div>`
      + `<div class="ov-term__status" aria-live="polite"></div>`;
    this.screen = this.querySelector('.ov-term__screen');
    this.status = this.querySelector('.ov-term__status');
  }

  blank() { return { ch: ' ', w: 1, cls: '' }; }

  reset() {
    const { cols, rows } = this.size();
    this.cols = cols;
    this.rows = rows;
    this.buf = Array.from({ length: rows }, () => Array.from({ length: cols }, () => this.blank()));
    this.cur = { r: 0, c: 0 };
    this.saved = { r: 0, c: 0, cls: [] };
    this.sgr = [];
    this.top = 0;
    this.bottom = rows - 1;
    this.wrapPending = false;
    this.autowrap = true;
    this.cursorOn = true;
    this.g0 = 'B';
    this.pending = '';
    this.refused = new Map();
    this.marks = new Set();
    this.approx = 0;
    this.bells = 0;
  }

  bind() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (name && Overscan.subscribe) this.unsub = Overscan.subscribe(name, (s) => { if (typeof s === 'string') this.write(s); });
  }

  async fetchSrc() {
    const src = this.getAttribute('src');
    clearTimeout(this.playTimer);
    if (!src) return;
    let data;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      data = await r.text();
    } catch {
      if (this.getAttribute('src') !== src) return;
      this.missing = true;
      this.schedule();
      return;
    }
    if (this.getAttribute('src') !== src) return;
    this.missing = false;
    this.reset();
    this.play(data);
  }

  /* Replay at a baud rate, the way the screen would have filled on the wire.
     Reduced motion gets the finished screen at once. */
  play(data) {
    const baud = Math.max(0, Number(this.getAttribute('baud')) || 0);
    if (!baud || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.write(data); return; }
    const per = Math.max(1, Math.round(baud / 30));   /* characters per 1/30 s */
    let i = 0;
    const step = () => {
      this.write(data.slice(i, i + per));
      i += per;
      if (i < data.length && this.isConnected) this.playTimer = setTimeout(step, 1000 / 30);
    };
    step();
  }

  /* ---- the parser ------------------------------------------------------ */

  write(data) {
    let s = this.pending + String(data);
    this.pending = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ESCAPE) {
        const n = this.escape(s, i);
        if (n === 0) { this.pending = s.slice(i); break; }   /* sequence split across writes */
        i += n;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) { this.control(ch); i += 1; continue; }
      const cp = s.codePointAt(i);
      const g = String.fromCodePoint(cp);
      this.print(this.g0 === '0' && DEC[g] ? DEC[g] : g);
      i += g.length;
    }
    this.schedule();
  }

  refuse(seq, what) {
    const key = what ? `${spell(seq)} (${what})` : spell(seq);
    this.refused.set(key, (this.refused.get(key) || 0) + 1);
    this.marks.add(`${this.cur.r},${Math.min(this.cur.c, this.cols - 1)}`);
  }

  control(ch) {
    switch (ch) {
      case '\r': this.cur.c = 0; this.wrapPending = false; break;
      case '\n': case '\v': case '\f': this.lineFeed(); break;
      case '\b': if (this.cur.c > 0) this.cur.c -= 1; this.wrapPending = false; break;
      case '\t': this.cur.c = Math.min(this.cols - 1, (Math.floor(this.cur.c / 8) + 1) * 8); break;
      case '\x07': this.bells += 1; this.flash(); break;
      case '\x0e': case '\x0f': this.refuse(ch, 'charset shift'); break;
      default: this.refuse(ch, 'control character');
    }
  }

  /* Returns how many characters the sequence at s[i] used, or 0 if it is not
     complete yet. */
  escape(s, i) {
    const next = s[i + 1];
    if (next === undefined) return 0;
    if (next === '[') {
      const m = /^\x1b\[([?>=!]?)([0-9;:]*)([ -\/]*)([@-~])/.exec(s.slice(i, i + 64));
      if (!m) return s.length - i > 63 ? (this.refuse(s.slice(i, i + 3), 'malformed'), 2) : 0;
      this.csi(m[0], m[1], m[2], m[3], m[4]);
      return m[0].length;
    }
    if (next === ']' || next === 'P' || next === '_' || next === '^') {
      // OSC and the string sequences run to BEL or ST. Title setting is the
      // common one; none are implemented.
      const rest = s.slice(i + 2);
      const bel = rest.indexOf('\x07');
      const st = rest.indexOf('\x1b\\');
      const end = [bel >= 0 ? bel + 1 : -1, st >= 0 ? st + 2 : -1].filter((x) => x >= 0);
      if (!end.length) return rest.length > 512 ? (this.refuse(s.slice(i, i + 2), 'unterminated string'), 2) : 0;
      const len = 2 + Math.min(...end);
      const body = s.slice(i, i + len);
      const osc = next === ']' ? /^\x1b\](\d+)/.exec(body) : null;
      this.refuse(osc ? `\x1b]${osc[1]}` : s.slice(i, i + 2),
        osc ? (osc[1] === '0' || osc[1] === '2' ? 'window title' : 'operating system command') : 'device control string');
      return len;
    }
    if (next === '(' || next === ')') {
      const d = s[i + 2];
      if (d === undefined) return 0;
      if (next === '(' && (d === 'B' || d === '0')) this.g0 = d;
      else this.refuse(s.slice(i, i + 3), 'character set');
      return 3;
    }
    switch (next) {
      case '7': this.saved = { r: this.cur.r, c: this.cur.c, cls: [...this.sgr] }; return 2;
      case '8': this.cur = { r: this.saved.r, c: this.saved.c }; this.sgr = [...this.saved.cls]; this.wrapPending = false; return 2;
      case 'D': this.lineFeed(); return 2;
      case 'E': this.cur.c = 0; this.lineFeed(); return 2;
      case 'M': this.reverseIndex(); return 2;
      case 'c': this.reset(); return 2;
      default: this.refuse(s.slice(i, i + 2)); return 2;
    }
  }

  csi(seq, priv, params, inter, fin) {
    const p = params.split(';').map((x) => (x === '' ? NaN : Number(x)));
    const n = (k, d = 1) => (Number.isFinite(p[k]) && p[k] > 0 ? p[k] : d);
    const { cols, rows } = this;
    const clampR = (r) => Math.max(0, Math.min(rows - 1, r));
    const clampC = (c) => Math.max(0, Math.min(cols - 1, c));
    this.wrapPending = fin === 'm' ? this.wrapPending : false;

    if (priv === '?') {
      if (fin === 'h' || fin === 'l') {
        const on = fin === 'h';
        for (const mode of p) {
          if (mode === 25) this.cursorOn = on;
          else if (mode === 7) this.autowrap = on;
          else this.refuse(`\x1b[?${mode}${fin}`, {
            1049: 'alternate screen', 47: 'alternate screen', 1047: 'alternate screen',
            1: 'cursor keys mode', 2004: 'bracketed paste', 1000: 'mouse reporting',
            1002: 'mouse reporting', 1006: 'mouse reporting', 12: 'cursor blink',
          }[mode] || 'private mode');
        }
        return;
      }
      this.refuse(seq);
      return;
    }
    if (priv || inter) { this.refuse(seq); return; }

    switch (fin) {
      case 'A': this.cur.r = Math.max(this.cur.r >= this.top ? this.top : 0, this.cur.r - n(0)); break;
      case 'B': this.cur.r = Math.min(this.cur.r <= this.bottom ? this.bottom : rows - 1, this.cur.r + n(0)); break;
      case 'C': this.cur.c = clampC(this.cur.c + n(0)); break;
      case 'D': this.cur.c = clampC(this.cur.c - n(0)); break;
      case 'E': this.cur.r = clampR(this.cur.r + n(0)); this.cur.c = 0; break;
      case 'F': this.cur.r = clampR(this.cur.r - n(0)); this.cur.c = 0; break;
      case 'G': this.cur.c = clampC(n(0) - 1); break;
      case 'd': this.cur.r = clampR(n(0) - 1); break;
      case 'H': case 'f': this.cur.r = clampR(n(0) - 1); this.cur.c = clampC(n(1) - 1); break;
      case 'J': this.erase(Number.isFinite(p[0]) ? p[0] : 0, true); break;
      case 'K': this.erase(Number.isFinite(p[0]) ? p[0] : 0, false); break;
      case '@': this.shiftRow(this.cur.r, this.cur.c, n(0)); break;
      case 'P': this.shiftRow(this.cur.r, this.cur.c, -n(0)); break;
      case 'X': for (let k = 0; k < n(0) && this.cur.c + k < cols; k++) this.buf[this.cur.r][this.cur.c + k] = this.blank(); break;
      case 'L': if (this.cur.r >= this.top && this.cur.r <= this.bottom) this.scroll(-n(0), this.cur.r); break;
      case 'M': if (this.cur.r >= this.top && this.cur.r <= this.bottom) this.scroll(n(0), this.cur.r); break;
      case 'S': this.scroll(n(0)); break;
      case 'T': this.scroll(-n(0)); break;
      case 'r': {
        const t = n(0, 1) - 1;
        const b = n(1, rows) - 1;
        if (t < b && b < rows) { this.top = t; this.bottom = b; this.cur = { r: 0, c: 0 }; }
        else this.refuse(seq, 'scroll region out of range');
        break;
      }
      case 's': this.saved = { r: this.cur.r, c: this.cur.c, cls: [...this.sgr] }; break;
      case 'u': this.cur = { r: this.saved.r, c: this.saved.c }; break;
      case 'm': this.setSgr(params === '' ? [0] : p.map((x) => (Number.isFinite(x) ? x : 0)), seq); break;
      default: this.refuse(seq);
    }
  }

  setSgr(codes, seq) {
    for (let k = 0; k < codes.length; k++) {
      const c = codes[k];
      if (c === 0) this.sgr = [];
      else if (c === 1) this.sgr.push('ov-ansi--bold');
      else if (c === 2) this.sgr.push('ov-ansi--dim');
      else if (c === 7) this.sgr.push('ov-ansi--rev');
      else if (c === 22) this.sgr = this.sgr.filter((x) => x !== 'ov-ansi--bold' && x !== 'ov-ansi--dim');
      else if (c === 27) this.sgr = this.sgr.filter((x) => x !== 'ov-ansi--rev');
      else if (c === 39) this.sgr = this.sgr.filter((x) => !/--(black|red|green|yellow|blue|magenta|cyan|white|bright|approx)$/.test(x));
      else if (c >= 30 && c <= 37) this.sgr.push(`ov-ansi--${SGR_NAMES[c - 30]}`);
      else if (c >= 90 && c <= 97) this.sgr.push(`ov-ansi--${SGR_NAMES[c - 90]}`, 'ov-ansi--bright');
      else if (c === 38 || c === 48) {
        this.approx += 1;
        this.sgr.push('ov-ansi--approx');
        k += codes[k + 1] === 5 ? 2 : codes[k + 1] === 2 ? 4 : 0;
      } else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107) || c === 49) {
        // A background this theme never chose. Counted, like 256-colour, and
        // not silently dropped the way <ov-ansi> drops it.
        if (c !== 49) { this.approx += 1; this.sgr.push('ov-ansi--approx'); }
      } else if (c === 4 || c === 24 || c === 5 || c === 25 || c === 3 || c === 23) {
        // Underline, blink and italic: styles a phosphor theme has no glyph
        // for. Counted as colours are, never invented.
        if (c === 4 || c === 5 || c === 3) this.approx += 1;
      } else {
        this.refuse(seq, `SGR ${c}`);
      }
    }
  }

  /* ---- the screen ------------------------------------------------------ */

  print(g) {
    const w = cellsFor(g);
    if (w === 0) {
      // A combining mark joins the cell before it, as in ov-grid.
      const c = Math.max(0, this.cur.c - 1);
      this.buf[this.cur.r][c].ch += g;
      return;
    }
    if (this.wrapPending && this.autowrap) { this.cur.c = 0; this.lineFeed(); }
    this.wrapPending = false;
    if (w === 2 && this.cur.c === this.cols - 1) {
      if (this.autowrap) { this.buf[this.cur.r][this.cur.c] = this.blank(); this.cur.c = 0; this.lineFeed(); }
      else return;
    }
    const cls = this.sgr.join(' ');
    const row = this.buf[this.cur.r];
    this.unsplit(row, this.cur.c);
    row[this.cur.c] = { ch: g, w, cls };
    if (w === 2) { this.unsplit(row, this.cur.c + 1); row[this.cur.c + 1] = { ch: '', w: 0, cls }; }
    if (this.cur.c + w >= this.cols) { this.cur.c = this.cols - 1; this.wrapPending = true; }
    else this.cur.c += w;
  }

  /* Overwriting half of a wide character leaves the other half as a blank,
     never as half a glyph. */
  unsplit(row, c) {
    const cell = row[c];
    if (!cell) return;
    if (cell.w === 2 && row[c + 1]) row[c + 1] = this.blank();
    if (cell.w === 0 && row[c - 1]) row[c - 1] = this.blank();
  }

  lineFeed() {
    if (this.cur.r === this.bottom) this.scroll(1);
    else if (this.cur.r < this.rows - 1) this.cur.r += 1;
  }

  reverseIndex() {
    if (this.cur.r === this.top) this.scroll(-1);
    else if (this.cur.r > 0) this.cur.r -= 1;
  }

  /* Scroll the region (or from `from` to its bottom) up by n; negative is down. */
  scroll(n, from = this.top) {
    const top = from;
    const bottom = this.bottom;
    const rowsIn = bottom - top + 1;
    const k = Math.min(Math.abs(n), rowsIn);
    const fresh = () => Array.from({ length: this.cols }, () => this.blank());
    const region = this.buf.slice(top, bottom + 1);
    const moved = n > 0
      ? [...region.slice(k), ...Array.from({ length: k }, fresh)]
      : [...Array.from({ length: k }, fresh), ...region.slice(0, rowsIn - k)];
    this.buf.splice(top, rowsIn, ...moved);
    // Refusal marks move with the text they sit on, or drop off the edge.
    const marks = new Set();
    for (const m of this.marks) {
      const [r, c] = m.split(',').map(Number);
      if (r < top || r > bottom) { marks.add(m); continue; }
      const r2 = r - (n > 0 ? k : -k);
      if (r2 >= top && r2 <= bottom) marks.add(`${r2},${c}`);
    }
    this.marks = marks;
  }

  shiftRow(r, c, n) {
    const row = this.buf[r];
    if (n > 0) {
      row.splice(c, 0, ...Array.from({ length: n }, () => this.blank()));
      row.length = this.cols;
    } else {
      row.splice(c, -n);
      while (row.length < this.cols) row.push(this.blank());
    }
  }

  erase(mode, screen) {
    const { r, c } = this.cur;
    const clear = (rr, a, b) => { for (let k = a; k < b; k++) this.buf[rr][k] = this.blank(); };
    if (mode === 3 && screen) mode = 2;   /* scrollback: there is none to clear */
    if (mode === 0) { clear(r, c, this.cols); if (screen) for (let k = r + 1; k < this.rows; k++) clear(k, 0, this.cols); }
    else if (mode === 1) { clear(r, 0, c + 1); if (screen) for (let k = 0; k < r; k++) clear(k, 0, this.cols); }
    else if (mode === 2) { if (screen) for (let k = 0; k < this.rows; k++) clear(k, 0, this.cols); else clear(r, 0, this.cols); }
    if (screen && mode === 2) this.marks.clear();
  }

  flash() {
    this.classList.remove('is-bell');
    void this.offsetWidth;
    this.classList.add('is-bell');
  }

  /* ---- drawing --------------------------------------------------------- */

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.draw(); });
    // A background tab never runs the frame; draw anyway so the DOM is true.
    clearTimeout(this.fallback);
    this.fallback = setTimeout(() => { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; this.draw(); } }, 250);
  }

  measure() {
    const probe = document.createElement('span');
    probe.textContent = '0';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    this.screen.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w || 8;
  }

  draw() {
    if (!this.screen) return;
    if (this.missing) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.screen.innerHTML = '<div class="ov-term__void">no session</div>';
      this.screen.setAttribute('aria-label', 'Terminal, no reading');
      this.status.textContent = '';
      return;
    }
    this.removeAttribute('data-ov-refusal');
    this.style.setProperty('--ov-term-unit', `${this.measure()}px`);
    this.style.setProperty('--ov-term-cols', this.cols);
    let html = '';
    for (let r = 0; r < this.rows; r++) {
      let line = '';
      const row = this.buf[r];
      for (let c = 0; c < this.cols; c++) {
        const cell = row[c];
        if (cell.w === 0 && !cell.ch) continue;          /* the right half of a wide glyph */
        const cursor = this.cursorOn && r === this.cur.r && c === this.cur.c;
        const mark = this.marks.has(`${r},${c}`);
        const cp = cell.ch.codePointAt(0);
        const frame = cp >= 0x2500 && cp <= 0x259f;
        const cls = ['ov-term__c', cell.cls, cursor ? 'is-cursor' : '', mark ? 'is-refused' : '', frame ? 'is-frame' : '']
          .filter(Boolean).join(' ');
        line += `<i class="${cls}"${cell.w === 2 ? ' style="--c:2"' : ''}${frame ? ' aria-hidden="true"' : ''}>${escapeHtml(cell.ch)}</i>`;
      }
      html += `<div class="ov-term__row">${line}</div>`;
    }
    this.screen.innerHTML = html;

    const refusedTotal = [...this.refused.values()].reduce((a, b) => a + b, 0);
    const parts = [];
    if (refusedTotal) {
      parts.push(`<span class="is-refused">refused ${refusedTotal}: `
        + [...this.refused].map(([k, v]) => `${escapeHtml(k)}${v > 1 ? ` ×${v}` : ''}`).join(', ') + '</span>');
    }
    if (this.approx) parts.push(`<span>${this.approx} style${this.approx === 1 ? '' : 's'} outside this theme, approximated</span>`);
    this.status.innerHTML = parts.join('');
    this.toggleAttribute('data-ov-refused', refusedTotal > 0);
    this.screen.setAttribute('aria-label',
      `Terminal ${this.cols} by ${this.rows}`
      + (refusedTotal ? `, ${refusedTotal} escape sequence${refusedTotal === 1 ? '' : 's'} refused`
        + (this.marks.size ? `, marked on ${this.marks.size} cell${this.marks.size === 1 ? '' : 's'} where the screen may differ from what the program painted` : '') : ''));
  }
}

define('ov-term', OvTerm);

export { OvTerm };
