/* <ov-log> - a scrolling output feed.
 *
 * The one widget where the theme's text animation is the point rather than an
 * embellishment: every arriving line runs the register's own arrival, so a
 * terminal types its output, worn phosphor catches it, an Esper scan reads it
 * across, and a film loop simply has it.
 *
 * Two honest properties, both about what a scrollback is NOT:
 *
 * - IT DOES NOT KEEP EVERYTHING. A feed with a cap drops its oldest lines, and
 *   this one says how many rather than presenting a window as a whole history.
 *   A table that draws 100 row elements for 50,000 rows and says nothing lies.
 * - IT DOES NOT INVENT ORDER. Lines are appended in arrival order and never
 *   reordered or coalesced, because "3 identical messages" collapsed into one
 *   is a claim about the source that the display is not entitled to make.
 *
 * ⭐ `first-out`: A SEQUENCE-OF-EVENTS RECORDER, UNDER THE SAME RULE. Arrival
 * order is not event order: a trip that reached the log last may have
 * happened first. With `first-out`, each reading is an EVENT carrying its own
 * time, `{ text, t, uncertainty, source, synced }` (t and uncertainty in ms),
 * and the log orders by t, but only as far as the clocks allow:
 *
 *   Events whose windows (t ± uncertainty) overlap are ONE rank, a TIE. They
 *   are drawn bracketed together and never put in an order the clocks cannot
 *   support. NUREG-0700 4.1.2-6: first-out works for fast electrical signals
 *   and "not necessarily" where measurements lag differently.
 *   An event from an unsynced clock (`synced: false`), or with no time, is
 *   listed apart as UNORDERED rather than placed. NUREG-0700 4.2.5-5 asks for
 *   synchronized clocks for exactly this reason.
 *
 * The header names a first event only when one is first: FIRST OUT, or FIRST
 * OUT: TIE and who, or FIRST OUT CANNOT BE DETERMINED.
 */

import { define } from './ov-core.js';
import './ov-source.js';

/* ⚠️ WRAPPED IN AN IIFE, and every file in this kit should be.
 *
 * These load as CLASSIC scripts, not modules, which means every top-level
 * `const`, `let`, `class` and `function` lands in ONE shared global lexical
 * scope. Two files declaring the same name is a SyntaxError that kills the
 * second file outright: no custom element defined, no error at the element,
 * just a tag that never upgrades and renders as an empty box.
 *
 * That is exactly how this was found. `const LINES` here collided with
 * `const LINES` in demo/fixtures.js, ov-waterfall.js never executed, and the
 * symptom was a transparent panel with the page's field showing through it.
 * Nothing pointed at the real cause until an error listener was added to the
 * page by hand.
 *
 * `customElements.define` works perfectly well from inside a closure, so
 * there is no cost to this. tools/collisions.py checks for it.
 */
(() => {


/* Shared with ov-cli: see the note there. Defined in both so either file can
 * be loaded alone. */
function ovLineInto(host, row, text) {
  const fx = getComputedStyle(host).getPropertyValue('--ov-text-char').trim();
  if (fx && fx !== 'none' && customElements.get('ov-text')) {
    const t = document.createElement('ov-text');
    t.setAttribute('effect', fx);
    t.setAttribute('text', text);
    row.append(t);
    return;
  }
  row.classList.add('ov-out');
  const inner = document.createElement('span');
  inner.textContent = text;
  row.append(inner);
}

class OvLog extends HTMLElement {
  static observedAttributes = ['source', 'lines', 'first-out'];

  connectedCallback() {
    this.dropped = 0;
    this.bindSource();
    this.render();
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); }
  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'source') this.bindSource();
  }

  get cap() { return Math.max(1, parseInt(this.getAttribute('lines') || '8', 10)); }

  bindSource() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (reading) => {
      if (reading === null || reading === undefined) return;
      // An event keeps its own time; a plain reading is text.
      if (this.hasAttribute('first-out') && typeof reading === 'object' && 'text' in reading) this.push(reading);
      else this.push(typeof reading === 'object' ? reading.value : reading);
    });
  }

  render() {
    this.innerHTML = '<div class="ov-log__lines" role="log" aria-live="polite"></div>';
    this.list = this.querySelector('.ov-log__lines');
  }

  push(text) {
    if (!this.list) this.render();
    if (this.hasAttribute('first-out') && text && typeof text === 'object') { this.pushEvent(text); return; }
    const row = document.createElement('div');
    row.className = 'ov-log__line';
    const stamp = document.createElement('span');
    stamp.className = 'ov-log__t';
    stamp.textContent = new Date().toTimeString().slice(0, 8);
    row.append(stamp);
    ovLineInto(this, row, String(text));
    this.list.append(row);

    while (this.list.children.length > this.cap) {
      this.list.firstElementChild.remove();
      this.dropped += 1;
    }
    if (this.dropped) {
      this.setAttribute('data-ov-dropped', `${this.dropped} not kept`);
    }
  }
}

/* ---- first-out: the sequence-of-events recorder ------------------------- */

const SOE_PAD = (n, w) => String(n).padStart(w, '0');
/* Event time as the reader needs it: to the millisecond, since first-out is
   decided in milliseconds. */
function soeStamp(t) {
  const d = new Date(t);
  return `${SOE_PAD(d.getUTCHours(), 2)}:${SOE_PAD(d.getUTCMinutes(), 2)}:${SOE_PAD(d.getUTCSeconds(), 2)}.${SOE_PAD(d.getUTCMilliseconds(), 3)}`;
}

Object.assign(OvLog.prototype, {
  pushEvent(ev) {
    this.events = this.events || [];
    this.events.push({ text: String(ev.text ?? ''), t: Number(ev.t), u: Math.max(0, Number(ev.uncertainty) || 0),
      source: ev.source ?? '', synced: ev.synced !== false });
    while (this.events.length > this.cap) { this.events.shift(); this.dropped += 1; }
    this.renderEvents();
  },

  /* Ranks by overlapping windows. Sorted by window start, an event joins the
     current rank if its window opens before the rank's latest close: overlap
     is transitive here on purpose, because if A ties B and B ties C, the
     clocks cannot say A came before C either. */
  ranks() {
    const timed = this.events.filter((e) => e.synced && Number.isFinite(e.t));
    const unordered = this.events.filter((e) => !(e.synced && Number.isFinite(e.t)));
    const sorted = timed.slice().sort((a, b) => (a.t - a.u) - (b.t - b.u));
    const ranks = [];
    let close = -Infinity;
    for (const e of sorted) {
      if (ranks.length && e.t - e.u <= close) { ranks[ranks.length - 1].push(e); close = Math.max(close, e.t + e.u); }
      else { ranks.push([e]); close = e.t + e.u; }
    }
    return { ranks, unordered };
  },

  /* The windows, drawn. Each event is its interval t ± uncertainty on one
     millisecond axis, in rank order, so a TIE is visibly two bars that
     overlap and a clear first is a bar standing alone. That is the argument
     for the ranking, not decoration: the list says who is first, the strip
     shows why the clocks allow it. Unordered events have no place on the axis
     and are drawn off it, in their own column, as "no time". */
  strip(ranks, unordered) {
    const timed = ranks.flat();
    if (!timed.length && !unordered.length) return '';
    const W = 420, rowH = 13, L = 8, LABEL = 58;
    const R = (unordered.length ? W - 96 : W - 8) - LABEL;
    const esc = (x) => String(x).replace(/[&<>]/g, '');
    const H = 18 + Math.max(timed.length, unordered.length, 1) * rowH + 4;
    let g = `<svg class="ov-log__strip" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
    if (timed.length) {
      const lo = Math.min(...timed.map((e) => e.t - e.u));
      const hi = Math.max(...timed.map((e) => e.t + e.u));
      const span = Math.max(1, hi - lo), pad = span * 0.05;
      const X = (t) => L + ((t - (lo - pad)) / (span + 2 * pad)) * (R - L);
      // Axis: milliseconds from the earliest window, so the scale is the claim.
      const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s0) => span / s0 <= 6) || 1000;
      for (let m = 0; m <= span + pad; m += step) {
        const x = X(lo + m);
        if (x > R) break;
        g += `<line class="ov-log__stripaxis" x1="${x.toFixed(1)}" y1="12" x2="${x.toFixed(1)}" y2="${H - 2}"/>`
          + `<text class="ov-log__striptext" x="${x.toFixed(1)}" y="9" text-anchor="middle">+${m}ms</text>`;
      }
      let y = 18;
      ranks.forEach((r, ri) => {
        const tie = r.length > 1;
        if (tie) {
          // The shared window of a tie: the span no clock here can divide.
          const a = Math.min(...r.map((e) => e.t - e.u)), b = Math.max(...r.map((e) => e.t + e.u));
          g += `<rect class="ov-log__tieband" x="${X(a).toFixed(1)}" y="${y - 2}" width="${(X(b) - X(a)).toFixed(1)}" height="${r.length * rowH}"/>`;
        }
        for (const e of r) {
          const cls = ri === 0 ? (tie ? 'is-tie is-first' : 'is-first') : tie ? 'is-tie' : '';
          // True width, never padded: a wider bar would claim a vaguer clock.
          const x0 = X(e.t - e.u), w = Math.max(1, X(e.t + e.u) - x0);
          g += `<rect class="ov-log__win ${cls}" x="${x0.toFixed(1)}" y="${y + 1}" width="${w.toFixed(1)}" height="${rowH - 5}"/>`
            + `<line class="ov-log__at ${cls}" x1="${X(e.t).toFixed(1)}" y1="${y - 1}" x2="${X(e.t).toFixed(1)}" y2="${y + rowH - 3}"/>`
            + `<text class="ov-log__striplabel ${cls}" x="${R + 6}" y="${y + rowH - 4}">${esc(e.source || e.text)}</text>`;
          y += rowH;
        }
      });
    }
    if (unordered.length) {
      const ux = W - 90;
      g += `<text class="ov-log__striptext is-unordered" x="${ux}" y="9">NO TIME</text>`;
      unordered.forEach((e, i) => {
        g += `<rect class="ov-log__win is-unordered" x="${ux}" y="${19 + i * rowH}" width="18" height="${rowH - 5}"/>`
          + `<text class="ov-log__striplabel is-unordered" x="${ux + 22}" y="${18 + i * rowH + rowH - 4}">${esc(e.source || e.text)}</text>`;
      });
    }
    return g + '</svg>';
  },

  renderEvents() {
    const { ranks, unordered } = this.ranks();
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const line = (e, cls = '') => `<div class="ov-log__line ov-log__event${cls}">`
      + `<span class="ov-log__t">${Number.isFinite(e.t) ? soeStamp(e.t) : '--:--:--.---'}${e.u ? ` ±${e.u}` : ''}</span>`
      + `<span class="ov-log__src">${esc(e.source)}</span><span>${esc(e.text)}</span></div>`;

    let head;
    if (!ranks.length) head = { cls: 'is-none', text: 'FIRST OUT CANNOT BE DETERMINED: no event on a synchronized clock' };
    else if (ranks[0].length === 1) head = { cls: 'is-first', text: `FIRST OUT: ${ranks[0][0].text}${ranks[0][0].source ? ` (${ranks[0][0].source})` : ''}` };
    else head = { cls: 'is-tie', text: `FIRST OUT: TIE between ${ranks[0].map((e) => e.source || e.text).join(', ')}, within their clock uncertainty` };
    // An event that cannot be placed may have come before all of them, so a
    // first out is only first AMONG THE SYNCHRONIZED while any are unordered.
    if (ranks.length && unordered.length) {
      head.cls += ' is-qualified';
      head.text += `, among synchronized events only; ${unordered.length} unordered could precede it`;
    }

    let h = `<div class="ov-log__first ${head.cls}">${esc(head.text)}</div>` + this.strip(ranks, unordered);
    ranks.forEach((r, i) => {
      if (r.length === 1) h += line(r[0], i === 0 ? ' is-first' : '');
      else h += `<div class="ov-log__tie${i === 0 ? ' is-first' : ''}"><span class="ov-log__tiemark">TIE</span>${r.map((e) => line(e)).join('')}</div>`;
    });
    if (unordered.length) {
      h += `<div class="ov-log__unordered"><span class="ov-log__tiemark">UNORDERED: no synchronized time</span>`
        + unordered.map((e) => line(e, ' is-unordered')).join('') + `</div>`;
    }
    this.list.innerHTML = h;
    if (this.dropped) this.setAttribute('data-ov-dropped', `${this.dropped} not kept`);
    this.setAttribute('aria-label', `Sequence of events, ${head.text.toLowerCase()}`
      + (unordered.length ? `, ${unordered.length} unordered` : ''));
  },
});

define('ov-log', OvLog);
})();
