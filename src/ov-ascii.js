/* Character-cell instruments: <ov-spark> and <ov-cellbar>.
 *
 * ASCII instruments are the cheapest instrument class there is,
 * and that matters here: the CSS-only panel measured about
 * a hundred times cheaper than any custom element, and the cost of a screen is
 * entirely in its instruments. A readout repeated fifty times down a table is
 * the case where <ov-chart> is the wrong answer and this is the right one.
 *
 * Cheap is not the same as loose. These obey the same protocol as the drawn
 * instruments, and one rule is specific to them:
 *
 * 🔴 THE GLYPH LADDER IS ITSELF AN INSTRUMENT, SO IT IS MEASURED.
 *   A block sparkline encodes its value in WHICH glyph it draws. If the
 *   resolved face has no U+2581..U+2588, the browser substitutes from a
 *   fallback face or draws tofu, and every substituted glyph reads as a level
 *   it is not. That is the inventing-readout failure exactly: a plausible wrong
 *   reading with nothing about it looking wrong. So the ladder is probed for
 *   presence AND for monotonic ink before a single sample is drawn, and a
 *   ladder that is not monotonic cannot express levels, so the instrument
 *   refuses instead of drawing one.
 *
 * ⚠️ AND THE PROBE IS ALSO AN INSTRUMENT. Six times in this project the
 *   measurement turned out to be the finding rather than the thing measured.
 *   So the probe runs a null test first, on two characters whose answer is
 *   already known: a space must read as no ink and a capital M must read as
 *   some. A probe that cannot tell those apart cannot tell blocks apart
 *   either, and it says so and stands down rather than condemning a face that
 *   is probably fine.
 */

import { define, isSeen, whenArrived } from './ov-core.js';
import './ov-source.js';
import './ov-refusal.js';
(() => {
  'use strict';

  // U+2581..U+2588. Eight levels, bottom-up. Deliberately no space at the
  // bottom of the ladder: a blank cell reads as powered off, which is the
  // claim reserved for having no reading at all.
  const LADDER = ['▁', '▂', '▃', '▄',
    '▅', '▆', '▇', '█'];

  // U+258F..U+2588, left-to-right eighths, for the horizontal bar.
  const EIGHTHS = ['▏', '▎', '▍', '▌',
    '▋', '▊', '▉', '█'];

  /* A gap is drawn TALL and BROKEN, never short. A dot or a dash sits at one
   * height in the cell, and any mark at a height is a mark at a level: the one
   * thing a missing sample must not look like is a low reading. A broken
   * vertical rule fills the cell and cannot be read as a value. */
  const GAP = '┆';
  const GAP_FALLBACK = ':';

  const OVER = '▲';
  const UNDER = '▼';

  const cache = new Map();

  /* Ink coverage of one character, as a fraction of the cell it is given.
   *
   * ⚠️ THE FIRST VERSION OF THIS MEASURED THE FONT SIZE, NOT THE FACE. It drew
   * the element's own 12px text into a fixed 32x40 canvas, so a solid capital
   * M covered 3.9% of the box and the null test failed on a face that was
   * perfectly fine. The probe stood down, which was the right behaviour and
   * hid the real defect for exactly as long as it took to read the numbers it
   * printed. A ratio is only meaningful against a stated denominator, so the
   * canvas is now the glyph's own cell: one advance wide, one line tall.
   *
   * It also means the answer is a property of the FACE and not of the element,
   * which is why the cache is keyed on family and weight and not on the whole
   * resolved font string. */
  const PROBE_PX = 40;

  function makeProbe(family, weight) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const font = `${weight} ${PROBE_PX}px ${family}`;
    // Sized to the cell the glyph is actually given, so the denominator is the
    // cell rather than an arbitrary rectangle.
    ctx.font = font;
    const adv = Math.max(4, Math.ceil(ctx.measureText('█').width));
    c.width = adv;
    c.height = Math.ceil(PROBE_PX * 1.3);
    // Setting width/height resets the context, so the font is set again.
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    return { ctx, w: c.width, h: c.height };
  }

  function inkWith(p, ch) {
    p.ctx.clearRect(0, 0, p.w, p.h);
    p.ctx.fillText(ch, 0, p.h / 2);
    const d = p.ctx.getImageData(0, 0, p.w, p.h).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++;
    return n / (p.w * p.h);
  }

  /* Returns what the face can actually be trusted to draw, plus every number
   * it reached that conclusion from, so a demo can print the measurement
   * rather than restating the claim. */
  function probe(el) {
    const cs = getComputedStyle(el);
    const key = `${cs.fontWeight} ${cs.fontFamily}`;
    if (cache.has(key)) return cache.get(key);

    const stand = (why) => {
      // Fail OPEN. An instrument that refuses because its own probe was
      // unavailable has turned a missing measurement into a claim about the
      // caller's data, which is the inversion this kit exists to refuse.
      const out = { ok: true, blind: true, why, gap: GAP, key };
      cache.set(key, out);
      return out;
    };

    const p = makeProbe(cs.fontFamily, cs.fontWeight);
    if (!p) return stand('no 2d context to probe with');

    // The null test, run first, on two answers already known. A probe that
    // cannot tell a space from a capital M cannot tell blocks apart either.
    const blank = inkWith(p, ' ');
    const solid = inkWith(p, 'M');
    const nullOk = blank < 0.02 && solid > 0.08;
    if (!nullOk) {
      return stand(`probe failed its own null test `
        + `(space ${blank.toFixed(3)}, M ${solid.toFixed(3)})`);
    }

    const inks = LADDER.map((ch) => inkWith(p, ch));
    const full = inks[inks.length - 1];
    const present = full > 0.5;
    // Strictly increasing, with a real step between rungs. A ladder that is
    // flat anywhere cannot express the level it is standing on, and a face
    // that substitutes will usually draw the same fallback glyph for several
    // rungs at once, which is exactly what that looks like.
    let monotonic = true;
    for (let i = 1; i < inks.length; i++) {
      if (inks[i] - inks[i - 1] < 0.02) monotonic = false;
    }

    const gapInk = inkWith(p, GAP);
    const out = {
      ok: present && monotonic,
      blind: false,
      key,
      blank,
      solid,
      nullOk,
      inks,
      present,
      monotonic,
      why: present
        ? (monotonic ? '' : 'block ladder is not monotonic in this face')
        : 'this face has no block elements',
      // A substituted gap glyph is only cosmetic, so it falls back quietly.
      gap: gapInk > 0.01 && gapInk < 0.5 ? GAP : GAP_FALLBACK,
    };
    cache.set(key, out);
    return out;
  }

  /* One cell advance in the element's own resolved font. `ch` is the advance
   * of digit zero and therefore a Latin unit; these instruments are drawn in
   * box characters, so the advance is measured on what is actually drawn. */
  function advance(el, sample) {
    const probeEl = document.createElement('span');
    probeEl.textContent = sample.repeat(8);
    probeEl.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    el.appendChild(probeEl);
    const wide = probeEl.getBoundingClientRect().width / 8;
    probeEl.remove();
    return wide || 8;
  }

  /* 🔴 EVERY GLYPH RUN THESE EMIT IS MARKED aria-hidden, and it is not a
   * silencer. Both elements carry `role="img"` with an aria-label that states
   * the entire reading, so the characters are the DRAWING: reading a row of
   * block elements aloud is noise, and the unlit half of a cell gauge is the
   * same furniture as a segment readout's dark segments. The kit's own audit
   * already draws this line for box-drawing frames, and the reason is the
   * same one: a boundary that happens to be made of characters is not text.
   * Without it the audit measured the unlit track at 1.14:1 and called it 68
   * contrast failures, which is a classification error rather than a finding.
   */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /* Shared: parse a comma list or a live source into an array with holes. */
  function readSeries(el) {
    /* Property, then source, then attribute. `null` is a deliberate dropout
     * and draws nothing; `undefined` means props are not driving this one. */
    if (el._prop_values !== undefined) {
      const v = el._prop_values;
      if (v === null) return [];
      return (Array.isArray(v) ? v : [v]).map((r) => {
        const n = window.OverscanRefusal.reading(r);
        return n === null ? null : n.value;
      });
    }
    if (el.getAttribute('source')) return el.buffer ? el.buffer.slice() : [];
    const raw = (el.getAttribute('values') || '').trim();
    if (!raw) return [];
    return raw.split(',').map((s) => {
      const t = s.trim();
      if (t === '' || t === 'null' || t === 'NaN') return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    });
  }

  function bindSource(el, render) {
    if (el.unsub) el.unsub();
    const name = el.getAttribute('source');
    if (!name || !window.Overscan) return;
    const cap = Math.max(8, parseInt(el.getAttribute('window') || '96', 10));
    el.buffer = el.buffer || [];
    el.unsub = window.Overscan.subscribe(name, (reading) => {
      const v = (reading && typeof reading === 'object') ? reading.value : reading;
      el.buffer.push(v === null || v === undefined || !Number.isFinite(Number(v))
        ? null : Number(v));
      while (el.buffer.length > cap) el.buffer.shift();
      render();
    });
  }

  /* ---- <ov-spark> ------------------------------------------------------ */

  class OvSpark extends HTMLElement {
    static observedAttributes = ['values', 'min', 'max', 'cells', 'source', 'window', 'max-age', 'age'];

    /* Our clock, in epoch ms. Replaceable so a test can drive time. */
    static now = () => Date.now();

    connectedCallback() {
      this.bind();
      this.addEventListener('ov:resize', () => this.render());
      this.render();
      /* Last, so the element's DOM exists before a reclaimed property
       * triggers a redraw against cells that have not been built. */
      window.OverscanRefusal.upgrade(this, ['values']);
      /* ⚠️ Markup arrives before attributeChangedCallback will listen: it
       * returns early while disconnected, so a strip written as
       * `<ov-spark values="...">` would never stamp an arrival and could not
       * go stale at all. Coming alive is the honest answer for that half. */
      if (this._ovArrivedAt === undefined) window.OverscanRefusal.arrived(this, OvSpark.now());
      this.watchAge();
    }
    disconnectedCallback() { if (this.unsub) this.unsub(); this.stopAge(); }
    attributeChangedCallback(name) {
      if (!this.isConnected) return;
      if (name === 'source' || name === 'window') this.bind();
      // Stamped where values ARRIVE, not in render(): render also runs on a
      // resize and on the age tick, so stamping there would reset the clock
      // every second and the strip could never go stale.
      if (name === 'values') window.OverscanRefusal.arrived(this, OvSpark.now());
      if (name === 'max-age' || name === 'age') this.watchAge();
      this.render();
    }

    /* 🔴 No max-age, no timer: staleness is opt-in and free when unused. */
    watchAge() {
      const want = this.hasAttribute('max-age') && !this.hasAttribute('age');
      if (!want) { this.stopAge(); return; }
      if (this._ageUnarrive || this._ageTimer) return;
      this._ageUnarrive = whenArrived(() => {
        this._ageUnarrive = null;
        if (!this.isConnected || this._ageTimer) return;
        this._ageTimer = setInterval(() => { if (isSeen(this)) this.render(); }, 1000);
      });
    }

    stopAge() {
      clearInterval(this._ageTimer);
      this._ageTimer = 0;
      if (this._ageUnarrive) this._ageUnarrive();
      this._ageUnarrive = null;
    }

    bind() { bindSource(this, () => this.render()); }

    /* Cells to draw into: declared, or as many as fit. */
    width() {
      const declared = parseInt(this.getAttribute('cells') || '0', 10);
      if (declared) return declared;
      return Math.max(4, Math.floor((this.clientWidth || 120) / advance(this, LADDER[7])));
    }

    render() {
      const face = probe(this);
      const vals = readSeries(this);
      const present = vals.filter((v) => v !== null);
      // A refusal crosses the whole display, the way the segment readout's
      // dashes cross every digit. A short run of dashes in a wide instrument
      // reads as a value that happens to be flat.
      const cells = this.width();
      const dashes = `<span class="ov-spark__refuse" aria-hidden="true">`
        + `${'─'.repeat(cells)}</span>`;

      // The ladder cannot express levels, so nothing this draws would mean
      // anything. This is `unrepresentable` in its purest form: the caller's
      // data is fine and the display cannot form it.
      if (!face.ok) {
        this.innerHTML = dashes;
        window.OverscanRefusal.apply(this, { reason: 'unrepresentable' });
        this.setAttribute('data-ov-why', face.why);
        return;
      }
      this.removeAttribute('data-ov-why');
      this.toggleAttribute('data-ov-unprobed', !!face.blind);
      if (face.blind) this.setAttribute('data-ov-why', face.why);

      if (!present.length) {
        this.innerHTML = dashes;
        window.OverscanRefusal.apply(this, { reason: 'unknown' });
        return;
      }

      const declaredLo = this.hasAttribute('min') ? Number(this.getAttribute('min')) : null;
      const declaredHi = this.hasAttribute('max') ? Number(this.getAttribute('max')) : null;
      const lo = declaredLo !== null ? declaredLo : Math.min(...present);
      const hi = declaredHi !== null ? declaredHi : Math.max(...present);
      const span = (hi - lo) || 1;

      const decimated = vals.length > cells;
      const series = decimated ? this.buckets(vals, cells) : vals;

      let html = '';
      let run = '';
      const flush = (cls) => {
        if (!run) return;
        html += cls ? `<span class="${cls}" aria-hidden="true">${esc(run)}</span>`
          : esc(run);
        run = '';
      };
      let mode = 'level';
      const emit = (ch, next) => {
        if (next !== mode) { flush(mode === 'level' ? '' : `ov-spark__${mode}`); mode = next; }
        run += ch;
      };

      let over = 0;
      for (const v of series) {
        if (v === null || v === undefined) { emit(face.gap, 'gap'); continue; }
        // Marked, not clipped. A value past the axis drawn as a full block is
        // indistinguishable from one sitting exactly at the top, which is the
        // clipped-peak lie in a character cell.
        if (declaredHi !== null && v > hi) { emit(OVER, 'over'); over++; continue; }
        if (declaredLo !== null && v < lo) { emit(UNDER, 'over'); over++; continue; }
        const t = (v - lo) / span;
        emit(LADDER[Math.max(0, Math.min(7, Math.round(t * 7)))], 'level');
      }
      flush(mode === 'level' ? '' : `ov-spark__${mode}`);
      this.innerHTML = html;

      const gaps = vals.length - present.length;
      this.toggleAttribute('data-ov-gaps', gaps > 0);
      if (decimated) {
        this.setAttribute('data-ov-decimated', `${vals.length - cells} of ${vals.length} not drawn`);
      } else {
        this.removeAttribute('data-ov-decimated');
      }
      // ⭐ The disclosure that is specific to this instrument class. Eight
      // levels is a resolution of one eighth of the range, which is coarse
      // enough that a reader is entitled to know it rather than infer it from
      // the fact that the thing is made of characters.
      const step = (span / 7);
      this.setAttribute('data-ov-quantised',
        `8 levels, ${step.toPrecision(2)} per level`);

      this.removeAttribute('data-ov-refusal');
      const parts = [`${present.length} samples, ${lo} to ${hi}`,
        `8 levels of ${step.toPrecision(2)}`];
      if (gaps) parts.push(`${gaps} missing`);
      if (over) parts.push(`${over} past the axis, marked`);
      if (decimated) parts.push(`${vals.length - cells} not drawn, extremes kept`);
      if (face.blind) parts.push('glyph ladder unverified');
      /* A strip whose feed has stopped keeps its shape and says so, in the
       * protocol's words rather than its own. */
      const say = window.OverscanRefusal.markSeriesStale(
        this, window.OverscanRefusal.seriesStale(this, OvSpark.now()));
      if (say) parts.push(say);
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', parts.join(', '));
    }

    /* One row of cells cannot draw the min/max envelope <ov-chart> draws, so
     * the choice is which single sample survives a bucket. A stride drops
     * spikes and a mean flattens them, and a spike is usually the reason
     * anyone is looking. So the survivor is the sample FURTHEST from the
     * bucket's own median, and the count that was dropped is reported rather
     * than hidden. A bucket with no reading at all stays a gap. */
    buckets(vals, cells) {
      const per = vals.length / cells;
      const out = [];
      for (let c = 0; c < cells; c++) {
        const a = Math.floor(c * per);
        const b = Math.max(Math.floor((c + 1) * per), a + 1);
        const slice = vals.slice(a, b).filter((v) => v !== null);
        if (!slice.length) { out.push(null); continue; }
        const sorted = slice.slice().sort((x, y) => x - y);
        const med = sorted[sorted.length >> 1];
        let best = slice[0];
        for (const v of slice) if (Math.abs(v - med) > Math.abs(best - med)) best = v;
        out.push(best);
      }
      return out;
    }
  }

  /* ---- <ov-cellbar> ---------------------------------------------------- */

  class OvCellbar extends HTMLElement {
    static observedAttributes = ['value', 'min', 'max', 'cells', 'source', 'unit'];

    connectedCallback() {
      this.bind();
      this.render();
      /* Last, so the element's DOM exists before a reclaimed property
       * triggers a redraw against cells that have not been built. */
      window.OverscanRefusal.upgrade(this, ['value']);
    }
    disconnectedCallback() { if (this.unsub) this.unsub(); }
    attributeChangedCallback(name) {
      if (!this.isConnected) return;
      if (name === 'source') this.bind();
      this.render();
    }

    bind() {
      if (this.unsub) this.unsub();
      const name = this.getAttribute('source');
      if (!name || !window.Overscan) return;
      this.unsub = window.Overscan.subscribe(name, (reading) => {
        const v = (reading && typeof reading === 'object') ? reading.value : reading;
        this.latest = v;
        this.render();
      });
    }

    render() {
      const face = probe(this);
      const cells = Math.max(2, parseInt(this.getAttribute('cells') || '10', 10));
      const unit = this.getAttribute('unit') || '';

      const refuse = (reason, why) => {
        this.innerHTML = `<span class="ov-cellbar__refuse" aria-hidden="true">`
          + `${'─'.repeat(cells)}</span>`;
        window.OverscanRefusal.apply(this, { reason });
        if (why) this.setAttribute('data-ov-why', why);
      };

      if (!face.ok) return refuse('unrepresentable', face.why);
      this.removeAttribute('data-ov-why');
      this.toggleAttribute('data-ov-unprobed', !!face.blind);
      if (face.blind) this.setAttribute('data-ov-why', face.why);

      const raw = (this._prop_value === undefined && this.getAttribute('source'))
        ? this.latest
        : window.OverscanRefusal.rawOf(this, 'value');
      if (raw === null || raw === undefined || raw === '' || raw === 'null') {
        return refuse('unknown');
      }
      const v = Number(raw);
      if (!Number.isFinite(v)) return refuse('unrepresentable');

      /* 🔴 For a segment readout `min`/`max` declare a VALIDITY RANGE and a
       * value outside it is a refusal. For a bar they declare the AXIS, and a
       * value past the axis is the chart's case, not the readout's: it gets
       * marked at the boundary, because a bar clamped to full is
       * indistinguishable from one that is exactly full. Same attribute
       * names, different claim, and the difference is worth stating rather
       * than discovering. */
      const lo = Number(this.getAttribute('min') ?? 0);
      const hi = Number(this.getAttribute('max') ?? 100);
      const span = (hi - lo) || 1;
      const t = (v - lo) / span;
      const clampedT = Math.max(0, Math.min(1, t));

      const eighths = Math.round(clampedT * cells * 8);
      const full = Math.floor(eighths / 8);
      const rem = eighths % 8;

      let html = '';
      if (full) html += `<span class="ov-cellbar__on" aria-hidden="true">${EIGHTHS[7].repeat(full)}</span>`;
      if (rem) html += `<span class="ov-cellbar__on" aria-hidden="true">${EIGHTHS[rem - 1]}</span>`;
      // The unlit cells are DRAWN, for the reason the segment readout draws its
      // dark segments: a real instrument has an unlit half, and hiding it
      // makes a partly filled bar look like a whole short one.
      const restCells = cells - full - (rem ? 1 : 0);
      if (restCells > 0) {
        html += `<span class="ov-cellbar__off" aria-hidden="true">${EIGHTHS[7].repeat(restCells)}</span>`;
      }
      if (t > 1) html += `<span class="ov-cellbar__over" aria-hidden="true">»</span>`;
      if (t < 0) html += `<span class="ov-cellbar__over" aria-hidden="true">«</span>`;
      this.innerHTML = html;

      this.toggleAttribute('data-ov-over', t > 1 || t < 0);
      this.removeAttribute('data-ov-refusal');
      const res = span / (cells * 8);
      this.setAttribute('data-ov-quantised', `${cells * 8} steps of ${res.toPrecision(2)}`);
      const say = [`${v}${unit ? ' ' + unit : ''} of ${lo} to ${hi}`];
      if (t > 1) say.push('past the top of the scale, marked');
      if (t < 0) say.push('below the bottom of the scale, marked');
      say.push(`resolution ${res.toPrecision(2)}`);
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', say.join(', '));
    }
  }

  /* Exported so a demo can print what the probe actually measured. A demo
   * that reimplements the check is a second instrument to be wrong in a
   * second way, and this project has spent six findings on that already. */
  window.OverscanAscii = { probe, LADDER, EIGHTHS, GAP };

  window.OverscanRefusal.series(OvSpark, 'values');
  /* The property is the other door, and a live feed always uses it. Stamping
   * only one of the two would make a fed strip permanently stale and a markup
   * one permanently fresh. */
  {
    const d = Object.getOwnPropertyDescriptor(OvSpark.prototype, 'values');
    if (d && d.set) {
      Object.defineProperty(OvSpark.prototype, 'values', {
        ...d,
        set(v) { window.OverscanRefusal.arrived(this, OvSpark.now()); d.set.call(this, v); },
      });
    }
  }
  window.OverscanRefusal.prop(OvCellbar, 'value');
  define('ov-spark', OvSpark);
  define('ov-cellbar', OvCellbar);
})();
