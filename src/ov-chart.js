/* <ov-chart> - a plot that does not invent.
 *
 * The strongest cross-cutting result behind this kit is that the drawing is a
 * claim about data that is not the data, and the claim changes with the scale.
 * Four separate tests found it: easing invented readings, a range ring on
 * glass measured 851 km for a nominal 800, a waveform discarded 99.27% of its
 * samples before painting, and a table drew 100 row elements for 50,000 rows.
 *
 * So this chart holds four rules:
 *
 * 1. A GAP IS A GAP. Missing samples break the line. Nothing is interpolated
 *    across absent data, because a line drawn through a hole is a reading the
 *    instrument never took.
 * 2. NO SMOOTHING, EVER. Straight segments or steps. A spline through samples
 *    invents shape between them and is the easing mistake in another form.
 * 3. DECIMATION IS REPORTED. More samples than pixels means samples are being
 *    dropped, and the chart says how many and shows the min/max envelope of
 *    what it dropped rather than a naive stride that hides spikes.
 * 4. OUT OF RANGE IS MARKED, NOT CLIPPED. A value past the axis gets a tick at
 *    the boundary, so a clipped peak cannot be mistaken for a flat one.
 * 5. 🔴 A TRACE THAT HAS STOPPED ARRIVING SAYS SO. With `max-age` declared, a
 *    chart whose values have not been set for that long marks itself `stale`
 *    and prints how long it has been. Without it this element had no stale
 *    state at all - `data-ov-stale` was only ever REMOVED, never set - so a
 *    feed that died left its last trace on screen, perfectly drawn, aging
 *    silently. That is the 2003 blackout's flat-lined pens: the operators
 *    were reading a picture nothing was updating.
 *
 *    ⚠️ A SERIES MEASURES ARRIVAL, NOT AGE, and that is the difference from a
 *    scalar readout. A gauge is TOLD its reading's age, because only the
 *    source knows when the sample was taken. A chart is told a whole series
 *    at once and cannot know when any of it was measured - but it does know
 *    when it last heard anything, and a feed that has stopped is exactly what
 *    that catches. An explicit `age` attribute still wins where the author
 *    knows better.
 *
 *    Opt-in, and free when unused: no `max-age`, no judgement and no timer.
 */

import { define, watchSeen, isSeen, whenArrived } from './ov-core.js';
import './ov-source.js';
import './ov-refusal.js';

class OvChart extends HTMLElement {
  static observedAttributes = ['values', 'min', 'max', 'mode', 'source', 'window', 'max-age', 'age'];

  connectedCallback() {
    this.bind();
    // A chart's decimation depends on how many columns it has, so a resize
    // changes what it is allowed to draw. Nothing ships this bus; <ov-window>
    // provides it, and a chart outside one simply never hears it.
    this.addEventListener('ov:resize', () => this.render());
    /* The column count comes from a ResizeObserver, read after layout, rather
     * than from clientWidth inside render(), which forced a layout on every
     * reading: 28 a second from the home page's four charts. Since
     * decimation depends on it, a new width redraws. */
    if (!this.sized) {
      this.sized = new ResizeObserver(() => {
        const w = this.clientWidth;
        if (w !== this.cols) { this.cols = w; this.render(); }
      });
    }
    this.sized.observe(this);
    this.unseen = watchSeen(this, () => {
      if (this._unseenDirty) { this._unseenDirty = false; this.render(); }
    });
    this.render();
    /* Last, so the element's DOM exists before a reclaimed property
     * triggers a redraw against cells that have not been built. */
    window.OverscanRefusal.upgrade(this, ['values']);
    /* ⚠️ MARKUP ARRIVES BEFORE attributeChangedCallback WILL LISTEN. That
     * callback returns early while the element is not connected, so a chart
     * written as `<ov-chart values="...">` had never stamped an arrival and
     * could not go stale at all - the fix would have worked only for charts
     * fed after they were on the page, which is the half that was never
     * broken. The moment it came alive is the honest answer for the other
     * half: it is when this element first had anything to draw. */
    if (this._ovArrivedAt === undefined) window.OverscanRefusal.arrived(this, OvChart.now());
    this.watchAge();
  }

  /* Our clock, in epoch ms. Replaceable so a test can drive time. */
  static now = () => Date.now();

  /* 🔴 NO max-age, NO TIMER. Staleness here is opt-in, so a chart nobody has
   * given an age rule to costs exactly what it cost before: this page has four
   * of them and they were already too expensive.
   * The tick waits for the page to arrive and stops while off screen, like
   * every other live loop in the kit. */
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

  /* The judgement and the words are ov-refusal.js's, not this element's: two
   * readouts inventing their own idea of what "old" means is the drift that
   * file exists to end. When to LOOK is ours; what it means is the protocol's. */
  staleFor() { return window.OverscanRefusal.seriesStale(this, OvChart.now()); }
  disconnectedCallback() {
    if (this.unsub) this.unsub();
    if (this.sized) this.sized.disconnect();
    if (this.unseen) this.unseen();
    this.stopAge();
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'source' || name === 'window') this.bind();
    // 🔴 ARRIVAL IS RECORDED WHERE VALUES ARRIVE, not in render(). render()
    // runs on a resize, on a redraw and on the age tick itself, so stamping it
    // there would reset the clock every second and the chart could never go
    // stale - a staleness check that keeps its own subject alive.
    if (name === 'values') window.OverscanRefusal.arrived(this, OvChart.now());
    if (name === 'max-age' || name === 'age') this.watchAge();
    this.render();
  }

  /* A live chart scrolls, and scrolling is the only animation it gets. Nothing
   * is eased between samples: the window advances by whole readings, because a
   * value sliding smoothly toward its next reading is showing numbers the
   * instrument never took. */
  bind() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    const cap = Math.max(8, parseInt(this.getAttribute('window') || '96', 10));
    this.buffer = this.buffer || [];
    this.unsub = window.Overscan.subscribe(name, (reading) => {
      const v = (reading && typeof reading === 'object') ? reading.value : reading;
      this.buffer.push(v === null || v === undefined || !Number.isFinite(Number(v))
        ? null : Number(v));
      while (this.buffer.length > cap) this.buffer.shift();
      // Unseen, the buffer still fills, so no sample is lost and the x axis
      // stays honest; only the drawing waits until the chart can be seen.
      if (isSeen(this)) this.render(); else this._unseenDirty = true;
    });
  }

  parse() {
    /* Property first, then source, then the attribute. An explicit `null` is a
     * dropout and returns nothing to draw, which renders a refusal; `undefined`
     * means this widget is not being driven by props at all. */
    if (this._prop_values !== undefined) {
      const v = this._prop_values;
      if (v === null) return [];
      return (Array.isArray(v) ? v : [v]).map((r) => {
        const n = window.OverscanRefusal.reading(r);
        return n === null ? null : n.value;
      });
    }
    if (this.getAttribute('source')) return this.buffer ? this.buffer.slice() : [];
    const raw = (this.getAttribute('values') || '').trim();
    if (!raw) return [];
    return raw.split(',').map((s) => {
      const t = s.trim();
      if (t === '' || t === 'null' || t === 'NaN') return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    });
  }

  render() {
    const vals = this.parse();
    const present = vals.filter((v) => v !== null);

    if (!present.length) {
      window.OverscanRefusal.apply(this, { reason: 'unknown' });
      this.innerHTML = '';
      return;
    }

    const lo = this.hasAttribute('min') ? Number(this.getAttribute('min')) : Math.min(...present);
    const hi = this.hasAttribute('max') ? Number(this.getAttribute('max')) : Math.max(...present);
    const span = (hi - lo) || 1;
    const mode = this.getAttribute('mode') || 'line';

    // Rule 3. One bucket per available column; the envelope keeps the extremes
    // a stride would silently drop.
    const cols = Math.max(40, Math.min(600, Math.round(this.cols || this.clientWidth || 240)));
    const decimated = vals.length > cols;
    const buckets = decimated ? this.envelope(vals, cols) : null;

    const x = (i, n) => (n <= 1 ? 0 : (i / (n - 1)) * 100);
    const y = (v) => 100 - ((v - lo) / span) * 100;
    const clamp = (v) => Math.max(0, Math.min(100, v));

    let paths = '';
    let overs = '';

    const runs = [];
    let cur = [];
    const series = decimated ? buckets.map((b) => b && b.avg) : vals;
    series.forEach((v, i) => {
      if (v === null || v === undefined) { if (cur.length) runs.push(cur); cur = []; }
      else cur.push([x(i, series.length), y(v), v]);
    });
    if (cur.length) runs.push(cur);

    for (const run of runs) {
      const pts = run.map(([px, py]) => `${px.toFixed(2)},${clamp(py).toFixed(2)}`);
      if (mode === 'step' && run.length > 1) {
        const d = [];
        run.forEach(([px, py], i) => {
          const cy = clamp(py).toFixed(2);
          if (i === 0) d.push(`M${px.toFixed(2)},${cy}`);
          else { d.push(`H${px.toFixed(2)}`); d.push(`V${cy}`); }
        });
        paths += `<path class="ov-chart__line" d="${d.join(' ')}" vector-effect="non-scaling-stroke"/>`;
      } else if (run.length === 1) {
        paths += `<circle class="ov-chart__point" cx="${run[0][0].toFixed(2)}" cy="${clamp(run[0][1]).toFixed(2)}" r="1.4"/>`;
      } else {
        paths += `<polyline class="ov-chart__line" points="${pts.join(' ')}" vector-effect="non-scaling-stroke"/>`;
      }
      // Rule 4.
      for (const [px, py] of run) {
        if (py < 0 || py > 100) {
          overs += `<rect class="ov-chart__over" x="${(px - 0.6).toFixed(2)}" `
            + `y="${py < 0 ? 0 : 97}" width="1.2" height="3"/>`;
        }
      }
    }

    let band = '';
    if (decimated) {
      const top = [];
      const bot = [];
      buckets.forEach((b, i) => {
        if (!b) return;
        top.push(`${x(i, buckets.length).toFixed(2)},${clamp(y(b.max)).toFixed(2)}`);
        bot.unshift(`${x(i, buckets.length).toFixed(2)},${clamp(y(b.min)).toFixed(2)}`);
      });
      if (top.length) {
        band = `<polygon class="ov-chart__band" points="${top.join(' ')} ${bot.join(' ')}"/>`;
      }
    }

    this.innerHTML =
      `<svg class="ov-chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">`
      + band + paths + overs + '</svg>'
      + `<span class="ov-chart__lo">${lo}</span><span class="ov-chart__hi">${hi}</span>`;

    const gaps = vals.length - present.length;
    this.toggleAttribute('data-ov-gaps', gaps > 0);
    if (decimated) {
      this.setAttribute('data-ov-decimated', `${vals.length - cols} of ${vals.length} dropped`);
    } else {
      this.removeAttribute('data-ov-decimated');
    }

    // The name says what the picture is a claim about, including what is
    // missing from it. A chart that announces only its range is announcing the
    // axis, not the data.
    // Clearing the refusal is as much a part of the protocol as setting it.
    // Only the refusal branch called apply(), so once a chart had ever been
    // empty it kept its data-ov-refusal forever and printed UNKNOWN over live
    // data. A state you can enter and not leave is not a state.
    this.removeAttribute('data-ov-refusal');

    /* Rule 5. The trace is still drawn - withholding a chart because its feed
     * stopped would lose the shape a reader needs - but it is QUALIFIED, in
     * the attribute the protocol actually uses and in the name, with how long
     * it has been since anything arrived. */
    const say = window.OverscanRefusal.markSeriesStale(this, this.staleFor());
    const parts = [`${present.length} samples, ${lo} to ${hi}`];
    if (gaps) parts.push(`${gaps} missing`);
    if (decimated) parts.push(`${vals.length - cols} not drawn, envelope shown`);
    if (say) parts.push(say);
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', parts.join(', '));
  }

  /* min/max per bucket. A stride would drop the spikes, which is the failure
   * this exists to avoid: the quiet version of inventing data is discarding it. */
  envelope(vals, cols) {
    const per = vals.length / cols;
    const out = [];
    for (let c = 0; c < cols; c++) {
      const slice = vals.slice(Math.floor(c * per), Math.max(Math.floor((c + 1) * per), Math.floor(c * per) + 1));
      const present = slice.filter((v) => v !== null);
      out.push(present.length
        ? { min: Math.min(...present), max: Math.max(...present), avg: present.reduce((a, b) => a + b, 0) / present.length }
        : null);
    }
    return out;
  }
}

/* `values` as a PROPERTY is the other door, and a live feed always comes
 * through it rather than through the attribute. Stamping arrival in only one
 * of the two would make a chart driven by a feed permanently stale and one
 * driven by markup permanently fresh. */
window.OverscanRefusal.series(OvChart, 'values');
{
  const d = Object.getOwnPropertyDescriptor(OvChart.prototype, 'values');
  if (d && d.set) {
    Object.defineProperty(OvChart.prototype, 'values', {
      ...d,
      set(v) { window.OverscanRefusal.arrived(this, OvChart.now()); d.set.call(this, v); },
    });
  }
}
define('ov-chart', OvChart);

export { OvChart };
