/* <ov-timeline> - one playhead across soloable layers, and the gaps left open.
 *
 * From the braindance screens: a recording separated into layers you can
 * solo, which is a
 * good interface idea almost nothing outside the genre does. The timeline is
 * one thing and the CHANNELS are another, and removing one without moving the
 * playhead is what makes it an instrument rather than a video player.
 *
 *   <ov-timeline layers="VISUAL,AUDIO,THERMAL" duration="40" at="14"
 *                spans="VISUAL=0-12 18-40, AUDIO=0-40, THERMAL=6-9 30-38">
 *   </ov-timeline>
 *   tl.spans = [{ layer: 'THERMAL', from: 6, to: 9, values: [0.2, 0.5, 0.4] }];
 *
 * `fill` is how a span's samples are drawn: `line` (default), `area` (a
 * band down to the baseline, as ov-chart's band), `gradient` (the band
 * fading toward the baseline), or `bars` (one bar per sample, which shows
 * where the readings actually were). Every style is drawn INSIDE its span
 * and nowhere else, so none of them can paint over a gap.
 *
 * ── THE REFUSAL ───────────────────────────────────────────────────────────
 *
 * 🔴 A LAYER IS NEVER SHOWN AS PRESENT AT A TIME IT HAS NO DATA FOR. The
 * lane's resting state is hatched NO DATA, and only real spans are painted
 * over it, so absence is what you see by default and presence has to be
 * earned by a span. The failure being refused is the ordinary one: a
 * timeline that draws a continuous bar and leaves a dropped stretch as blank
 * track, which reads as silence, or as zero, or as nothing happening. None of
 * those is "we do not know". A quiet stretch that WAS recorded is a flat line
 * inside a span, and looks different from a gap on purpose.
 *
 * Four rules follow.
 *
 * 1. THE READOUT DOES NOT BRIDGE A GAP. At the playhead each layer says its
 *    reading or NO DATA. A value is the sample at or before the playhead
 *    INSIDE the span it belongs to, never carried across a gap from the last
 *    span, and never interpolated between two.
 * 2. SOLO NEVER MOVES THE PLAYHEAD, and soloing a layer that has nothing at
 *    the playhead says so ("THERMAL SOLO, NO DATA AT 0:14") rather than
 *    quietly showing the layers it hid.
 * 3. NO DURATION, NO POSITION. As ov-transport: something of unknown length
 *    has no fraction to draw a playhead at, so the axis is refused, not drawn
 *    at zero.
 * 4. A SPAN PAST THE END IS CLIPPED AND COUNTED, never stretched to fit or
 *    silently dropped. A span for a layer the timeline was not given is
 *    counted and said too: a lane appearing would change the instrument.
 */

import { define } from './ov-core.js';
import { REASONS, upgrade } from './ov-refusal.js';

const FILLS = new Set(['line', 'area', 'gradient', 'bars']);
let gradients = 0;

const names = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

/* A fraction of the timeline as a position on a track, inset by half the
 * slider thumb at each end. A native range puts its thumb's CENTRE at
 * thumb/2 + f * (width - thumb), not at f * width, so without the inset the
 * seek thumb sat up to half a thumb away from the playhead it moves: at 0:00
 * and at the end, the two disagreed about where "now" was. */
const at_ = (f) => `calc(var(--ov-timeline-thumb) / 2 + (100% - var(--ov-timeline-thumb)) * ${f})`;
const span_ = (f) => `calc((100% - var(--ov-timeline-thumb)) * ${f})`;

function clock(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

class OvTimeline extends HTMLElement {
  static observedAttributes = ['layers', 'duration', 'at', 'spans', 'solo', 'label', 'fill'];

  constructor() {
    super();
    this.spanList = [];
  }

  connectedCallback() {
    upgrade(this, ['spans']);
    if (!this.axis) this.build();
    this.layout();
    if (this._spans === undefined) this.applyAttribute();
    this.paint();
  }

  attributeChangedCallback(name) {
    if (!this.axis) return;
    if (name === 'layers') this.layout();
    if (name === 'spans' && this._spans === undefined) this.applyAttribute();
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label') || 'Timeline');
    this.paint();
  }

  /* ---- READ ----------------------------------------------------------- */

  lengthOf() {
    const d = Number(this.getAttribute('duration'));
    return Number.isFinite(d) && d > 0 ? d : null;
  }

  positionOf() {
    const d = this.lengthOf();
    const a = Number(this.getAttribute('at') || 0);
    if (d === null || !Number.isFinite(a)) return null;
    return Math.min(Math.max(a, 0), d);
  }

  soloOf() {
    const s = (this.getAttribute('solo') || '').trim();
    return this.lanes && this.lanes.has(s) ? s : null;
  }

  /* ---- BUILD ---------------------------------------------------------- */

  build() {
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Timeline');

    this.head = document.createElement('div');
    this.head.className = 'ov-timeline__head';
    this.now = document.createElement('span');
    this.now.className = 'ov-timeline__now';
    this.mode = document.createElement('span');
    this.mode.className = 'ov-timeline__mode';
    this.mode.setAttribute('role', 'status');
    this.head.append(this.now, this.mode);

    this.axis = document.createElement('div');
    this.axis.className = 'ov-timeline__axis';
    this.seek = document.createElement('input');
    this.seek.type = 'range';
    // The kit's slider, so each theme's control furniture applies.
    this.seek.className = 'ov-slider ov-timeline__seek';
    this.seek.step = '0.1';
    this.seek.min = '0';
    this.seek.setAttribute('aria-label', 'seek');
    this.seek.addEventListener('input', () => this.seekTo(Number(this.seek.value)));
    this.axis.append(this.seek);

    this.body = document.createElement('div');
    this.body.className = 'ov-timeline__lanes';
    this.note = document.createElement('p');
    this.note.className = 'ov-timeline__note';
    this.append(this.head, this.axis, this.body, this.note);

    // Dragging on the lanes scrubs, as in the deck. The range input is the
    // accessible way to do the same thing, and keyboard seeking comes free.
    this.body.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ov-timeline__name')) return;
      const track = e.target.closest('.ov-timeline__track');
      if (!track || this.lengthOf() === null) return;
      const move = (ev) => {
        const r = track.getBoundingClientRect();
        if (!r.width) return;
        this.seekTo(((ev.clientX - r.left) / r.width) * this.lengthOf());
      };
      move(e);
      try { track.setPointerCapture(e.pointerId); } catch { /* a nicety */ }
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', () => track.removeEventListener('pointermove', move), { once: true });
    });
  }

  /* One lane per declared layer. The set is the instrument, so it is
   * declared and does not grow from the data. */
  layout() {
    this.lanes = new Map();
    this.body.replaceChildren();
    for (const layer of names(this.getAttribute('layers'))) {
      if (this.lanes.has(layer)) continue;
      const row = document.createElement('div');
      row.className = 'ov-timeline__lane';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ov-btn ov-timeline__name';
      btn.textContent = layer;
      btn.addEventListener('click', () => this.toggleSolo(layer));
      const track = document.createElement('div');
      track.className = 'ov-timeline__track';
      const head = document.createElement('span');
      head.className = 'ov-timeline__playhead';
      const val = document.createElement('span');
      val.className = 'ov-timeline__value';
      track.append(head);
      row.append(btn, track, val);
      this.body.append(row);
      this.lanes.set(layer, { row, btn, track, head, val });
    }
  }

  /* ---- INPUT ---------------------------------------------------------- */

  /* A list of { layer, from, to, values? }. An ARRAY, as every structured
   * property in the kit, so the manifest's `Structured` type is true. `values`
   * are samples spread evenly across the span. Replaces the previous list
   * (a timeline is a recording, not a stream of writes). */
  set spans(list) {
    this._spans = list;
    this.rejected = null;
    if (Array.isArray(list)) this.load(list);
    else if (list !== undefined && list !== null) {
      this.rejected = 'spans ignored: not an array of { layer, from, to }';
      this.load([]);
    } else this.load([]);
    this.paint();
  }

  get spans() {
    return this.spanList.map((s) => ({ layer: s.layer, from: s.from, to: s.to, values: s.values }));
  }

  /* `spans="VISUAL=0-12 18-40, AUDIO=0-40"`: presence only, no values. */
  applyAttribute() {
    const raw = (this.getAttribute('spans') || '').trim();
    const list = [];
    this.malformed = 0;
    for (const part of raw ? raw.split(',') : []) {
      const at = part.indexOf('=');
      if (at < 1) { if (part.trim()) this.malformed += 1; continue; }
      const layer = part.slice(0, at).trim();
      for (const r of part.slice(at + 1).trim().split(/\s+/).filter(Boolean)) {
        const m = r.match(/^(-?[\d.]+)-(-?[\d.]+)$/);
        if (!m) { this.malformed += 1; continue; }
        list.push({ layer, from: Number(m[1]), to: Number(m[2]) });
      }
    }
    this.load(list);
  }

  load(list) {
    this.spanList = [];
    this.clipped = 0;
    this.orphans = new Set();
    this.bad = 0;
    const d = this.lengthOf();
    for (const s of list) {
      if (!s || typeof s !== 'object' || !this.lanes.has(s.layer)) {
        if (s && s.layer) this.orphans.add(String(s.layer)); else this.bad += 1;
        continue;
      }
      let from = Number(s.from), to = Number(s.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) { this.bad += 1; continue; }
      // Clipped, and counted. Never stretched, never dropped quietly.
      if (d !== null && (from < 0 || to > d)) {
        this.clipped += 1;
        from = Math.max(0, from);
        to = Math.min(d, to);
        if (to <= from) continue;
      }
      const values = Array.isArray(s.values) ? s.values.map(Number) : null;
      this.spanList.push({ layer: s.layer, from, to, values, full: { from: Number(s.from), to: Number(s.to) } });
    }
  }

  seekTo(t) {
    const d = this.lengthOf();
    if (d === null) return;
    const at = Math.round(Math.min(Math.max(t, 0), d) * 10) / 10;
    this.setAttribute('at', String(at));
    this.dispatchEvent(new CustomEvent('ov:seek', { detail: { at }, bubbles: true }));
  }

  /* Solo is a view of the recording. It never touches `at`. */
  toggleSolo(layer) {
    const next = this.soloOf() === layer ? null : layer;
    if (next) this.setAttribute('solo', next); else this.removeAttribute('solo');
    this.dispatchEvent(new CustomEvent('ov:solo', { detail: { layer: next }, bubbles: true }));
  }

  /* ---- DERIVED -------------------------------------------------------- */

  /* What a layer has at time t: { present, value }. The span that CONTAINS
   * t, and the sample at or before t inside it. Nothing else. */
  readingAt(layer, t) {
    const span = this.spanList.find((s) => s.layer === layer && t >= s.from && t <= s.to);
    if (!span) return { present: false, value: null };
    if (!span.values || !span.values.length) return { present: true, value: null };
    const full = span.full;
    const n = span.values.length;
    const step = n > 1 ? (full.to - full.from) / (n - 1) : 0;
    const i = step ? Math.min(n - 1, Math.floor((t - full.from) / step + 1e-9)) : 0;
    const v = span.values[i];
    return { present: true, value: Number.isFinite(v) ? v : null };
  }

  /* ---- PAINT ---------------------------------------------------------- */

  paint() {
    if (!this.axis) return;
    const d = this.lengthOf();
    const at = this.positionOf();
    const solo = this.soloOf();
    this.toggleAttribute('data-ov-live', d === null);

    // No length, no position: refused, as ov-transport refuses.
    if (d === null) {
      this.axis.setAttribute('data-ov-refusal', 'no duration');
      this.seek.hidden = true;
      this.now.textContent = 'NO DURATION, NO POSITION';
    } else {
      this.axis.removeAttribute('data-ov-refusal');
      this.seek.hidden = false;
      this.seek.max = String(d);
      if (document.activeElement !== this.seek) this.seek.value = String(at);
      this.now.textContent = `${clock(at)} / ${clock(d)}`;
    }

    let present = 0;
    for (const [layer, lane] of this.lanes) {
      lane.track.querySelectorAll('.ov-timeline__span').forEach((n) => n.remove());
      if (d !== null) {
        for (const s of this.spanList.filter((x) => x.layer === layer)) {
          const el = document.createElement('span');
          el.className = 'ov-timeline__span';
          el.style.insetInlineStart = at_(s.from / d);
          el.style.inlineSize = span_((s.to - s.from) / d);
          if (s.values && s.values.length > 1) el.append(this.trace(s));
          lane.track.insertBefore(el, lane.head);
        }
      }
      lane.head.hidden = d === null;
      if (d !== null) lane.head.style.insetInlineStart = at_(at / d);

      const r = d === null ? { present: false, value: null } : this.readingAt(layer, at);
      if (r.present) present += 1;
      lane.row.setAttribute('data-ov-at', r.present ? 'present' : 'absent');
      lane.row.toggleAttribute('data-ov-solo', solo === layer);
      lane.row.toggleAttribute('data-ov-muted', solo !== null && solo !== layer);
      lane.btn.setAttribute('aria-pressed', solo === layer ? 'true' : 'false');
      lane.val.textContent = d === null ? '' : !r.present ? 'NO DATA'
        : r.value === null ? 'PRESENT' : r.value.toFixed(2);
      lane.btn.setAttribute('aria-label', `${layer}, ${r.present
        ? (r.value === null ? 'present' : `reads ${r.value.toFixed(2)}`) : REASONS.unknown} at the playhead,`
        + ` ${solo === layer ? 'soloed, press to unsolo' : 'press to solo'}`);
    }

    // The mode line. Solo on an empty layer says so rather than showing the
    // layers it hid.
    let mode;
    if (d === null) mode = `${this.lanes.size} LAYERS`;
    else if (solo) {
      const r = this.readingAt(solo, at);
      mode = r.present ? `${solo} SOLO` : `${solo} SOLO, NO DATA AT ${clock(at)}`;
    } else mode = `${present} OF ${this.lanes.size} LAYERS PRESENT AT ${clock(at)}`;
    if (this.mode.textContent !== mode) this.mode.textContent = mode;
    this.setAttribute('data-ov-solo-empty', solo && d !== null && !this.readingAt(solo, at).present ? 'true' : 'false');

    const said = [];
    if (this.clipped) said.push(`${this.clipped} span${this.clipped > 1 ? 's' : ''} past the ends: clipped, not stretched`);
    if (this.orphans && this.orphans.size) said.push(`data for a layer with no lane: ${[...this.orphans].join(', ')}`);
    if (this.bad) said.push(`${this.bad} span${this.bad > 1 ? 's' : ''} with no valid from/to: ignored`);
    if (this.malformed) said.push(`${this.malformed} malformed entr${this.malformed > 1 ? 'ies' : 'y'} in spans: ignored`);
    if (this.rejected) said.push(this.rejected);
    this.note.textContent = said.join(' · ');
    this.note.hidden = !said.length;
  }

  /* A trace of the span's own samples, drawn inside the span and nowhere
   * else. The line ends where the span ends, and so does any fill. */
  trace(s) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 10');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const fill = FILLS.has(this.getAttribute('fill')) ? this.getAttribute('fill') : 'line';
    const n = s.values.length;
    const finite = s.values.filter(Number.isFinite);
    const lo = Math.min(...finite, 0);
    const hi = Math.max(...finite, 1);
    const BASE = 9.5;
    const yOf = (v) => BASE - ((v - lo) / (hi - lo || 1)) * 9;
    // Clipped spans draw only their visible share of the samples.
    const f0 = (s.from - s.full.from) / (s.full.to - s.full.from);
    const f1 = (s.to - s.full.from) / (s.full.to - s.full.from);
    const pts = [];
    s.values.forEach((v, i) => {
      const f = n > 1 ? i / (n - 1) : 0;
      if (f < f0 - 1e-9 || f > f1 + 1e-9 || !Number.isFinite(v)) return;
      pts.push([((f - f0) / (f1 - f0)) * 100, yOf(v), v]);
    });
    const el = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };

    if (fill === 'bars') {
      // One bar per sample, centred on it: the gaps between bars are where
      // no reading was taken, which a line draws over.
      const w = pts.length > 1 ? Math.min(6, (100 / (pts.length - 1)) * 0.6) : 4;
      // A baseline across the span, under the bars. Without it a recorded
      // zero is a row of zero-height bars, which draws NOTHING, and recorded
      // silence looked like an empty span: too close to "no data" for the
      // one element whose point is telling those apart.
      if (pts.length) {
        svg.append(el('path', {
          class: 'ov-timeline__base', d: `M0,${BASE}L100,${BASE}`, 'vector-effect': 'non-scaling-stroke',
        }));
      }
      for (const [x, y] of pts) {
        svg.append(el('rect', {
          class: 'ov-timeline__bar',
          x: (x - w / 2).toFixed(2), y: y.toFixed(2),
          width: w.toFixed(2), height: Math.max(0, BASE - y).toFixed(2),
        }));
      }
      return svg;
    }

    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
    if ((fill === 'area' || fill === 'gradient') && pts.length > 1) {
      const area = `${line}L${pts[pts.length - 1][0].toFixed(2)},${BASE}L${pts[0][0].toFixed(2)},${BASE}Z`;
      let paint = null;
      if (fill === 'gradient') {
        const id = `ovtl-g-${++gradients}`;
        const defs = el('defs', {});
        const g = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
        g.append(el('stop', { offset: '0', class: 'ov-timeline__stop-top' }));
        g.append(el('stop', { offset: '1', class: 'ov-timeline__stop-base' }));
        defs.append(g);
        svg.append(defs);
        paint = `url(#${id})`;
      }
      const a = el('path', { class: `ov-timeline__area ov-timeline__area--${fill}`, d: area });
      if (paint) a.setAttribute('fill', paint);
      svg.append(a);
    }
    svg.append(el('path', { class: 'ov-timeline__line', d: line, 'vector-effect': 'non-scaling-stroke' }));
    return svg;
  }
}

define('ov-timeline', OvTimeline);

export { OvTimeline };
