/* <ov-plate> - an image you can zoom into, with detections drawn over it.
 *
 * The esper machine, with the part the film leaves out: it will not enhance.
 * The companion to ov-segment's refusal to invent a digit. Three refusals:
 *
 * 1. IT WILL NOT MAGNIFY PAST THE SOURCE'S OWN PIXELS. The ceiling is one
 *    source pixel per DEVICE pixel, so a 2x screen reaches it at half the CSS
 *    zoom a 1x screen does. A request past it is refused `out-of-range`, and
 *    the readout says what was asked rather than quietly granting less.
 *
 *    🔴 The ceiling is applied to the VALUE, in setView(), and setView() is the
 *    only way the view changes: zoom, fit, pan, keys, pinch and resize all go
 *    through it. OpenSeadragon shows why: it clamps on its zoom
 *    path and not on its fit path, so `fitBounds` grants 20x where zoom stops
 *    at 1.10x, and asking for more after a fit gives you less. A limit written
 *    as a clamp inside one code path is a limit on that path, not on the value.
 *
 * 2. IT MARKS THE SHARE OF THE VIEW THAT NO SENSOR PRODUCED. Letterbox, and
 *    the overhang when the view is panned past an edge, are hatched rather than
 *    filled, and the share is printed. The view can overhang the frame but its
 *    centre cannot leave it.
 *
 * 3. A DETECTION THAT CANNOT BELONG TO THIS FRAME IS REFUSED, NOT DROPPED:
 *    a region that runs outside the frame is `out-of-range`, and one made on an
 *    earlier or later frame is `other-frame`, because its box would sit where
 *    the target was then. Each refusal is listed with its reason. Silently
 *    dropping them would say "nothing detected", which is a different claim.
 *
 * Detections are in SOURCE pixels, not percent: `{ id, label, x, y, w, h,
 * confidence, t }`, with `t` the capture time of the frame they were made on.
 * The plate's own capture time is `frame-time`, and `tolerance` (ms, default 0)
 * is how far apart the two may be and still be the same frame.
 */

import { define, Overscan } from './ov-core.js';
import { REASONS } from './ov-refusal.js';
import './ov-source.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

class OvPlate extends HTMLElement {
  static observedAttributes = ['src', 'frame-time', 'tolerance', 'source'];

  connectedCallback() {
    this.view = this.view || { cx: 0, cy: 0, zoom: 0 };
    this.asked = null;
    this._detections = this._detections || [];
    this.render();
    // A plate that is showing the whole frame stays fitted as its box
    // changes; one someone zoomed or panned keeps their view. Without this a
    // plate that fitted before the page finished laying out kept the zoom it
    // got then, and showed a cropped strip of the picture as if it were whole.
    this.ro = new ResizeObserver(() => (this.fitted ? this.fit() : this.setView(this.view)));
    this.ro.observe(this.stage);
    this.bind();
    this.load();
  }

  disconnectedCallback() {
    if (this.ro) this.ro.disconnect();
    if (this.unsub) this.unsub();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected || !this.stage) return;
    if (n === 'src') this.load();
    else if (n === 'source') this.bind();
    else this.paint();
  }

  /* Capture time of the frame on the plate, ms, from `frame-time`.
     ⚠️ Scalars are ATTRIBUTES only, read through methods, never properties.
     A getter-only property sharing an attribute's name THROWS when React, Vue
     or Svelte assign it (FRAMEWORKS.md), and a plain setter is extracted as
     Structured, which typed these numbers `unknown[]` in the d.ts. */
  frameTimeOf() {
    const raw = this.getAttribute('frame-time');
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? v : null;
  }

  toleranceOf() { return Math.max(0, Number(this.getAttribute('tolerance')) || 0); }

  get detections() { return this._detections; }

  set detections(list) {
    this._detections = Array.isArray(list) ? list : [];
    this.paint();
  }

  /* Detections from a named source, the way ov-reticle takes its tracks. */
  bind() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !Overscan.subscribe) return;
    this.unsub = Overscan.subscribe(name, (list) => { this.detections = list; });
  }

  render() {
    this.innerHTML =
      `<div class="ov-plate__stage" tabindex="0" role="application"`
      + ` aria-roledescription="image plate" aria-keyshortcuts="+ - 0 ArrowLeft ArrowRight ArrowUp ArrowDown">`
      + `<canvas class="ov-plate__canvas" aria-hidden="true"></canvas>`
      + `<svg class="ov-plate__marks" aria-hidden="true"></svg>`
      + `<span class="ov-plate__void" hidden></span>`
      + `</div>`
      + `<div class="ov-plate__readout" aria-live="polite"></div>`
      + `<ul class="ov-plate__refused"></ul>`;
    this.stage = this.querySelector('.ov-plate__stage');
    this.canvas = this.querySelector('.ov-plate__canvas');
    this.marks = this.querySelector('.ov-plate__marks');
    this.voidNote = this.querySelector('.ov-plate__void');
    this.readout = this.querySelector('.ov-plate__readout');
    this.refused = this.querySelector('.ov-plate__refused');

    this.stage.addEventListener('wheel', (e) => {
      if (!this.img) return;
      e.preventDefault();
      const r = this.stage.getBoundingClientRect();
      this.zoomAt(this.toSource(e.clientX - r.left, e.clientY - r.top),
        this.view.zoom * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    // Pointers: one drags, two pinch. Tracked by id so a second finger landing
    // mid-drag turns the gesture into a pinch instead of a jump.
    const down = new Map();
    let drag = null;
    let pinch = null;
    const local = (e) => {
      const r = this.stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.stage.addEventListener('pointerdown', (e) => {
      if (!this.img) return;
      this.stage.setPointerCapture(e.pointerId);
      down.set(e.pointerId, local(e));
      if (down.size === 1) {
        drag = { ...local(e), cx: this.view.cx, cy: this.view.cy };
      } else if (down.size === 2) {
        const [a, b] = [...down.values()];
        drag = null;
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.view.zoom };
      }
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (!down.has(e.pointerId)) return;
      down.set(e.pointerId, local(e));
      if (pinch && down.size === 2) {
        const [a, b] = [...down.values()];
        const mid = this.toSource((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.zoomAt(mid, pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      } else if (drag) {
        const p = local(e);
        const z = this.view.zoom;
        this.setView({ zoom: z, cx: drag.cx - (p.x - drag.x) / z, cy: drag.cy - (p.y - drag.y) / z });
      }
    });
    const up = (e) => {
      down.delete(e.pointerId);
      if (down.size < 2) pinch = null;
      if (down.size === 0) drag = null;
    };
    this.stage.addEventListener('pointerup', up);
    this.stage.addEventListener('pointercancel', up);

    this.stage.addEventListener('keydown', (e) => {
      if (!this.img) return;
      const v = this.view;
      const step = 60 / v.zoom;
      const act = {
        '+': () => this.setView({ ...v, zoom: v.zoom * 1.5 }),
        '=': () => this.setView({ ...v, zoom: v.zoom * 1.5 }),
        '-': () => this.setView({ ...v, zoom: v.zoom / 1.5 }),
        0: () => this.fit(),
        ArrowLeft: () => this.setView({ ...v, cx: v.cx - step }),
        ArrowRight: () => this.setView({ ...v, cx: v.cx + step }),
        ArrowUp: () => this.setView({ ...v, cy: v.cy - step }),
        ArrowDown: () => this.setView({ ...v, cy: v.cy + step }),
      }[e.key];
      if (act) { e.preventDefault(); act(); }
    });
  }

  load() {
    const src = this.getAttribute('src');
    this.img = null;
    if (!src) { this.paint(); return; }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (this.getAttribute('src') !== src) return;
      this.img = img;
      this.W = img.naturalWidth;
      this.H = img.naturalHeight;
      this.fit();
    };
    img.onerror = () => { if (this.getAttribute('src') === src) this.paint(); };
    img.src = src;
    this.paint();
  }

  stageBox() { return { w: this.stage.clientWidth, h: this.stage.clientHeight }; }

  /* Most CSS px one source px may cover: exactly one device px. */
  maxZoom() { return 1 / (window.devicePixelRatio || 1); }

  /* Least zoom: the whole frame in view, or the ceiling if the frame is
     smaller than the stage (a small image is shown at its own size, never
     scaled up to fill). */
  minZoom() {
    const { w, h } = this.stageBox();
    return Math.min(w / this.W, h / this.H, this.maxZoom());
  }

  /* 🔴 THE ONLY WAY THE VIEW CHANGES. Every caller asks and this decides.
     What was asked is kept, so a refused request says so. */
  setView(want) {
    if (!this.img || !this.stageBox().w || !this.stageBox().h) return;
    this.fitted = false;
    const z = Number.isFinite(want.zoom) && want.zoom > 0 ? want.zoom : this.minZoom();
    const zoom = Math.min(Math.max(z, this.minZoom()), this.maxZoom());
    this.asked = z > this.maxZoom() * 1.0001 ? z : null;
    const cx = Math.min(Math.max(Number(want.cx) || 0, 0), this.W);
    const cy = Math.min(Math.max(Number(want.cy) || 0, 0), this.H);
    this.view = { cx, cy, zoom };
    this.paint();
    this.dispatchEvent(new CustomEvent('ov:view', {
      bubbles: true,
      detail: {
        ...this.view,
        devicePx: zoom * (window.devicePixelRatio || 1),
        asked: this.asked,
        blank: this.blank,
      },
    }));
  }

  /* Frame a source-px rectangle. Goes through setView like everything else:
     there is no second, unclamped way to fit. */
  fit(r) {
    if (!this.img) return;
    const f = r || { x: 0, y: 0, w: this.W, h: this.H };
    const { w, h } = this.stageBox();
    this.setView({ cx: f.x + f.w / 2, cy: f.y + f.h / 2, zoom: Math.min(w / f.w, h / f.h) });
    this.fitted = !r;
  }

  /* Zoom keeping source point p under the same screen point. The anchor is
     worked out at the zoom setView will actually grant, or a refused zoom
     would still pan. */
  zoomAt(p, zoom) {
    const { cx, cy, zoom: z0 } = this.view;
    const z = Math.min(Math.max(zoom, this.minZoom()), this.maxZoom());
    this.setView({ zoom, cx: p.x - (p.x - cx) * z0 / z, cy: p.y - (p.y - cy) * z0 / z });
  }

  toSource(sx, sy) {
    const { w, h } = this.stageBox();
    const { cx, cy, zoom } = this.view;
    return { x: cx + (sx - w / 2) / zoom, y: cy + (sy - h / 2) / zoom };
  }

  toScreen(x, y) {
    const { w, h } = this.stageBox();
    const { cx, cy, zoom } = this.view;
    return { x: w / 2 + (x - cx) * zoom, y: h / 2 + (y - cy) * zoom };
  }

  /* Split detections into those this frame can carry and those it refuses. */
  sort() {
    const ok = [];
    const no = [];
    const ft = this.frameTimeOf();
    for (const d of this._detections) {
      const box = [d.x, d.y, d.w, d.h].map(Number);
      if (!box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) {
        no.push({ d, reason: 'unknown', why: 'no region' });
      } else if (box[0] < 0 || box[1] < 0 || box[0] + box[2] > this.W || box[1] + box[3] > this.H) {
        no.push({ d, reason: 'out-of-range', why: 'runs outside the frame' });
      } else if (ft !== null && !Number.isFinite(Number(d.t))) {
        no.push({ d, reason: 'other-frame', why: 'no capture time to match to this frame' });
      } else if (ft !== null && Math.abs(Number(d.t) - ft) > this.toleranceOf()) {
        const dt = Number(d.t) - ft;
        no.push({ d, reason: 'other-frame', why: `made ${Math.abs(Math.round(dt))}ms ${dt < 0 ? 'before' : 'after'} this frame` });
      } else {
        ok.push(d);
      }
    }
    return { ok, no };
  }

  paint() {
    if (!this.stage) return;
    const { w, h } = this.stageBox();
    this.removeAttribute('data-ov-refusal');

    if (!this.img) {
      // No picture, or one that failed to load: a refusal, never a blank
      // panel, because blank reads as powered off.
      const failed = this.hasAttribute('src');
      this.setAttribute('data-ov-refusal', 'unknown');
      this.voidNote.hidden = false;
      this.voidNote.textContent = failed ? 'no image' : 'no image source';
      const g = this.canvas.getContext('2d');
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.marks.innerHTML = '';
      this.readout.innerHTML = '';
      this.refused.innerHTML = '';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', `Image plate, ${REASONS.unknown}`);
      return;
    }
    this.voidNote.hidden = true;
    if (!w || !h) {
      // Loaded, with nowhere to draw yet. Say that, rather than leaving the
      // "no reading" from before the picture arrived on an element that has it.
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', `Image plate ${this.W} by ${this.H}, not laid out`);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const a = this.toScreen(0, 0);
    const b = this.toScreen(this.W, this.H);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.img, a.x, a.y, b.x - a.x, b.y - a.y);

    // The part of the stage the frame covers; everything else no sensor made.
    const ix = Math.max(0, Math.min(w, b.x) - Math.max(0, a.x));
    const iy = Math.max(0, Math.min(h, b.y) - Math.max(0, a.y));
    this.blank = 1 - (ix * iy) / (w * h);

    const { ok, no } = this.sort();
    const id = this.hatchId || (this.hatchId = `ov-plate-${Math.random().toString(36).slice(2, 8)}`);
    let svg = `<defs><pattern id="${id}-h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + `<line x1="0" y1="0" x2="0" y2="6" class="ov-plate__hatch"/></pattern>`
      + `<mask id="${id}-m"><rect width="${w}" height="${h}" fill="white"/>`
      + `<rect x="${a.x}" y="${a.y}" width="${b.x - a.x}" height="${b.y - a.y}" fill="black"/></mask></defs>`
      + `<rect width="${w}" height="${h}" fill="url(#${id}-h)" mask="url(#${id}-m)"/>`
      + `<rect class="ov-plate__edge" x="${a.x}" y="${a.y}" width="${b.x - a.x}" height="${b.y - a.y}"/>`;

    let shown = 0;
    for (const d of ok) {
      const p = this.toScreen(Number(d.x), Number(d.y));
      const q = this.toScreen(Number(d.x) + Number(d.w), Number(d.y) + Number(d.h));
      // In the frame but not in view. Not drawn, so its tag is never pulled
      // on screen without the bracket it labels.
      if (q.x < 0 || q.y < 0 || p.x > w || p.y > h) continue;
      shown += 1;
      const arm = Math.max(4, Math.min(q.x - p.x, q.y - p.y) * 0.3);
      svg += [[p.x, p.y, 1, 1], [q.x, p.y, -1, 1], [p.x, q.y, 1, -1], [q.x, q.y, -1, -1]]
        .map(([x, y, sx, sy]) => `<path class="ov-plate__bracket" d="M${(x + sx * arm).toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${(y + sy * arm).toFixed(1)}"/>`)
        .join('');
      // Confidence is not identity: the score is always printed, and a
      // detection with none says so (the same rule as ov-reticle).
      const score = Number(d.confidence);
      const scored = d.confidence !== undefined && d.confidence !== null && Number.isFinite(score);
      const tx = Math.min(Math.max(p.x, 2), Math.max(2, w - 120));
      const ty = Math.min(q.y + 13, h - 4);
      svg += `<text class="ov-plate__tag${scored ? '' : ' is-unscored'}" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}">`
        + `${esc(d.label ?? d.id)} ${scored ? score.toFixed(2) : 'unscored'}</text>`;
    }
    this.marks.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.marks.innerHTML = svg;

    const devPx = this.view.zoom * dpr;
    const atCeiling = this.view.zoom >= this.maxZoom() * 0.9999;
    const share = Math.round(this.blank * 100);
    this.readout.innerHTML =
      `<span class="ov-plate__mag">${devPx.toFixed(2)} device px per source px</span>`
      + `<span class="ov-plate__ceiling${atCeiling ? ' is-at' : ''}">ceiling 1.00${atCeiling ? ', reached' : ''}</span>`
      + `<span class="ov-plate__blank${share ? ' is-blank' : ''}">${share}% of view has no source</span>`
      + (this.asked
        ? `<span class="ov-plate__asked" data-ov-refusal="out-of-range">asked ${(this.asked * dpr).toFixed(2)}, the source has no more pixels</span>`
        : '')
      + (this.frameTimeOf() === null && ok.length
        ? `<span class="ov-plate__unmatched">no frame time, so detections are not matched to it</span>`
        : '');

    this.refused.innerHTML = no.map(({ d, reason, why }) =>
      `<li data-ov-refusal="${reason}"><b>${esc(d.label ?? d.id ?? '?')}</b> refused: ${esc(why)}</li>`).join('');

    if (this.asked) this.setAttribute('data-ov-refusal', 'out-of-range');
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label',
      `Image plate ${this.W} by ${this.H}, ${devPx.toFixed(2)} device pixels per source pixel`
      + (this.asked ? `, zoom request ${REASONS['out-of-range']}` : '')
      + `, ${share} percent of view has no source`
      + `, ${shown} detections in view, ${no.length} refused`);
  }
}

define('ov-plate', OvPlate);

export { OvPlate };
