/* <ov-wireframe> - a model or a surveyed terrain, drawn as lines.
 *
 * For vector and holo, and for industrial's descent terrain. The kit's vector
 * field (beam.glsl) is a display list whose brightness gradient is DRAW ORDER,
 * and until this element nothing drew a model with it.
 *
 * ⭐ THE REFUSAL: IT WILL NOT CLOSE GEOMETRY IT HAS NO SURVEY FOR. A terrain is
 * a grid of height samples, and a sample that never came back is `null`. Every
 * edge that touches one is left undrawn, and the station is marked, so an
 * unsampled region stays OPEN rather than being interpolated shut. Bridging
 * the gap would draw ground nobody measured, at a height nobody took, and it
 * would look exactly like the ground around it. A figure with a missing vertex
 * breaks at it the same way instead of joining its neighbours. The readout
 * counts what was withheld: "812 of 1024 points surveyed, 212 edges open".
 *
 * ⭐ TWO DISPLAYS, BECAUSE THE THEMES ARE TWO KINDS OF TUBE. Declared per theme
 * in wireframe.css as --ov-wireframe-display, not guessed from the scanlines:
 * antiseptic has none either and is a flat panel, not a stroke display.
 *
 *   list    (vector) An X-Y display draws one figure at a time, so the figure
 *           drawn first has been decaying for a whole refresh while the last
 *           is still hot: brightness is DRAW ORDER. Plus the three terms from
 *           beam.glsl that a stroked polyline cannot express: DWELL (the beam
 *           burns where it slows, at the ends), OVERSHOOT (it runs past the
 *           corner), and RETRACE (imperfect blanking between figures, in the
 *           second colour). Same constants, so the element and the field agree.
 *   raster  (every other theme) A raster lights the whole picture at once, so
 *           every line has the same age and order means nothing. Lines are
 *           DEPTH-CUED instead, near bright and far dim, which is how raster
 *           wireframes said which way a line was facing.
 *
 * Input, both as properties because both are structured:
 *   figures  [{ points: [[x, y, z], ...], closed }]   (or bare point arrays)
 *   survey   { cols, rows, heights: [row-major, null = unsampled],
 *              spacing = 1, scale = 1 }
 * Or from markup: `src` names a JSON file holding `{ figures, survey }`, so a
 * page with no script can still hand it a model. A file that fails to load is
 * the same refusal as no input: `unknown`, never an empty stage.
 * Attributes: yaw, pitch (degrees), fov (degrees, 0 = orthographic), spin
 * (degrees per second), period (seconds per pass of the list, default 1.6).
 */

import { define } from './ov-core.js';
import { REASONS } from './ov-refusal.js';

const CYCLE = 1.6;    /* beam.glsl: seconds for one pass of the display list */
/* ⚠️ NOT beam.glsl's persistence. The field decays at 0.62/s, which leaves the
 * oldest figure at 37% of the newest: legible over its twenty sparse edges at
 * an idle level, and SWAMPED here. Two thousand overlapping edges added into
 * one canvas saturate, and the order gradient, the one thing this display
 * says that no other can, measured flat. A shorter phosphor (e-folds per
 * second) keeps it: the newest line is ~40x the oldest over one pass. */
const DECAY = 2.4;
const LEVELS = 24;    /* brightness buckets: one path per bucket, not per edge */

const finite3 = (p) => Array.isArray(p) && p.length >= 2
  && Number.isFinite(p[0]) && Number.isFinite(p[1]) && (p.length < 3 || Number.isFinite(p[2]));

class OvWireframe extends HTMLElement {
  static observedAttributes = ['src', 'yaw', 'pitch', 'fov', 'spin', 'period'];

  connectedCallback() {
    this._figures = this._figures || null;
    this._survey = this._survey || null;
    this.render();
    this.cs = getComputedStyle(this);
    this.still = matchMedia('(prefers-reduced-motion: reduce)');
    this.t0 = performance.now();
    this.visible = true;
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible) this.loop();
    });
    this.io.observe(this);
    this.build();
    this.fetchSrc();
    this.loop();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.io) this.io.disconnect();
  }

  attributeChangedCallback(n) {
    this.extent = null;
    if (n === 'src' && this.isConnected) this.fetchSrc();
    else if (this.list) this.paint();
  }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') !== src) return;
      this._figures = Array.isArray(data.figures) ? data.figures : null;
      this._survey = data.survey && typeof data.survey === 'object' ? data.survey : null;
    } catch {
      if (this.getAttribute('src') !== src) return;
      this._figures = null;
      this._survey = null;
    }
    this.build();
  }

  get figures() { return this._figures; }
  set figures(v) { this._figures = Array.isArray(v) ? v : null; this.build(); }

  get survey() { return this._survey; }
  set survey(v) { this._survey = v && typeof v === 'object' ? v : null; this.build(); }

  /* Scalars are attributes, never properties: a getter-only property sharing
     an attribute's name throws when a framework assigns it. Every read is a
     LITERAL this.getAttribute('name') at the call site, because that is what
     tools/api.py extracts; a helper taking the name hid all five of them. */
  num(raw, dflt) {
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? v : dflt;
  }

  render() {
    this.innerHTML =
      `<div class="ov-wireframe__stage"><canvas class="ov-wireframe__canvas" aria-hidden="true"></canvas>`
      + `<span class="ov-wireframe__void" hidden></span></div>`
      + `<div class="ov-wireframe__readout" aria-hidden="true"></div>`;
    this.stage = this.querySelector('.ov-wireframe__stage');
    this.canvas = this.querySelector('.ov-wireframe__canvas');
    this.voidNote = this.querySelector('.ov-wireframe__void');
    this.readout = this.querySelector('.ov-wireframe__readout');
  }

  /* Turn the input into a display list: an ordered array of RUNS, each an
     unbroken polyline. A missing sample or vertex ends a run; nothing ever
     joins across one. */
  build() {
    const runs = [];
    const stations = [];     /* unsampled survey points, for the marks */
    let edges = 0;
    let open = 0;
    let points = 0;
    let surveyed = 0;

    const s = this._survey;
    if (s && Number.isInteger(s.cols) && Number.isInteger(s.rows) && Array.isArray(s.heights)) {
      const { cols, rows } = s;
      const sp = Number.isFinite(s.spacing) ? s.spacing : 1;
      const k = Number.isFinite(s.scale) ? s.scale : 1;
      const at = (c, r) => {
        const h = s.heights[r * cols + c];
        return h === null || h === undefined || !Number.isFinite(Number(h))
          ? null
          : [(c - (cols - 1) / 2) * sp, Number(h) * k, (r - (rows - 1) / 2) * sp];
      };
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          points += 1;
          if (at(c, r)) surveyed += 1;
          else stations.push([(c - (cols - 1) / 2) * sp, 0, (r - (rows - 1) / 2) * sp]);
        }
      }
      // Rows, then columns, in order: that order IS the display list.
      const walk = (n, m, get) => {
        for (let i = 0; i < n; i++) {
          let run = [];
          for (let j = 0; j < m; j++) {
            const p = get(i, j);
            if (j > 0) { edges += 1; if (!p || !run.length) open += 1; }
            if (p) run.push(p);
            else { if (run.length > 1) runs.push(run); run = []; }
          }
          if (run.length > 1) runs.push(run);
        }
      };
      walk(rows, cols, (r, c) => at(c, r));
      walk(cols, rows, (c, r) => at(c, r));
    }

    for (const f of this._figures || []) {
      const pts = Array.isArray(f) ? f : (f && Array.isArray(f.points) ? f.points : []);
      const closed = !Array.isArray(f) && !!(f && f.closed);
      const seq = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
      let run = [];
      seq.forEach((p, j) => {
        const ok = finite3(p);
        if (j > 0) { edges += 1; if (!ok || !run.length) open += 1; }
        if (ok) run.push([p[0], p[1], p[2] ?? 0]);
        else { if (run.length > 1) runs.push(run); run = []; }
      });
      if (run.length > 1) runs.push(run);
    }

    // Fit: the bounding radius of everything drawn, so a model of any units
    // fills the stage the same way.
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const run of runs) for (const p of run) { cx += p[0]; cy += p[1]; cz += p[2]; n += 1; }
    const centre = n ? [cx / n, cy / n, cz / n] : [0, 0, 0];
    let rad = 0;
    for (const run of runs) for (const p of run) {
      rad = Math.max(rad, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]));
    }

    const segs = runs.reduce((a, r) => a + r.length - 1, 0);
    this.list = { runs, stations, edges, open, points, surveyed, segs, centre, rad: rad || 1,
      hasSurvey: points > 0, hasInput: !!(this._figures || this._survey) };
    this.extent = null;
    if (this.isConnected) this.paint();
  }

  loop = () => {
    if (!this.isConnected || !this.visible) { this.raf = null; return; }
    this.paint();
    // Reduced motion: the order gradient is still drawn, frozen, and repaints
    // slowly only so a theme change still reaches it.
    if (this.still.matches) {
      this.raf = null;
      clearTimeout(this.slow);
      this.slow = setTimeout(this.loop, 500);
    } else {
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  /* How far the model reaches on screen, as the largest half-width and
     half-height over a whole turn of yaw. Fitting the 3D bounding sphere
     instead left a wide flat survey a small patch in the middle of its stage,
     and fitting each frame's own extent would breathe as the model spins. */
  reach() {
    if (this.extent) return this.extent;
    let mx = 1e-6, my = 1e-6;
    const spins = this.num(this.getAttribute('spin'), 0) !== 0 && !this.still.matches;
    const turns = spins ? 16 : 1;
    const yaw0 = this.num(this.getAttribute('yaw'), 30);
    for (let k = 0; k < turns; k++) {
      const yaw = spins ? (360 * k) / turns : yaw0;
      for (const run of this.list.runs) for (const p of run) {
        const q = this.project(p, 0, yaw);
        mx = Math.max(mx, Math.abs(q[0]));
        my = Math.max(my, Math.abs(q[1]));
      }
    }
    this.extent = { mx, my };
    return this.extent;
  }

  project(p, t, yawOverride) {
    const L = this.list;
    const yaw = (yawOverride ?? (this.num(this.getAttribute('yaw'), 30) + (this.still.matches ? 0 : this.num(this.getAttribute('spin'), 0) * t))) * Math.PI / 180;
    const pitch = this.num(this.getAttribute('pitch'), 24) * Math.PI / 180;
    const x = p[0] - L.centre[0], y = p[1] - L.centre[1], z = p[2] - L.centre[2];
    const x1 = x * Math.cos(yaw) - z * Math.sin(yaw);
    const z1 = x * Math.sin(yaw) + z * Math.cos(yaw);
    const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    const fov = this.num(this.getAttribute('fov'), 40);
    const u = x1 / L.rad, v = y2 / L.rad, w = z2 / L.rad;   /* unit sphere */
    if (fov <= 0) return [u, v, w];
    const d = 1 / Math.tan((fov * Math.PI / 180) / 2) + 1;
    const f = (d - 1) / (d + w);
    return [u * f * 1.15, v * f * 1.15, w];
  }

  paint() {
    const L = this.list;
    if (!L || !this.stage) return;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.removeAttribute('data-ov-refusal');

    const nothing = !L.hasInput || (!L.runs.length && !L.stations.length);
    const unsurveyed = L.hasSurvey && L.surveyed === 0 && !(this._figures || []).length;
    if (nothing || unsurveyed) {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.voidNote.hidden = false;
      this.voidNote.textContent = unsurveyed ? 'no survey returned' : 'no display list';
      const g0 = this.canvas.getContext('2d');
      g0.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.readout.textContent = '';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', `Wireframe, ${REASONS.unknown}`);
      return;
    }
    this.voidNote.hidden = true;
    if (!w || !h) {
      // Has a model, with nowhere to draw yet: say that, not the "no reading"
      // left from before the model arrived.
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', `Wireframe, ${L.segs} segments, not laid out`);
      this.lastKey = null;
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';

    const t = this.still.matches ? CYCLE * 0.37 : (performance.now() - this.t0) / 1000;
    const period = Math.max(0.2, this.num(this.getAttribute('period'), CYCLE));
    const list = this.cs.getPropertyValue('--ov-wireframe-display').trim() === 'list';
    const beam = this.cs.getPropertyValue('--ov-accent').trim() || '#fff';
    const retrace = this.cs.getPropertyValue('--ov-accent-2').trim() || beam;
    const alarm = this.cs.getPropertyValue('--ov-alarm').trim() || beam;
    const { mx, my } = this.reach();
    const S = Math.min((w / 2) / mx, (h / 2) / my) * 0.88;
    const toXY = (q) => [w / 2 + q[0] * S, h / 2 - q[1] * S];

    // Bucket every segment by brightness, so a thousand edges cost LEVELS paths.
    const core = Array.from({ length: LEVELS }, () => []);
    const ends = Array.from({ length: LEVELS }, () => []);
    const bucket = (v) => Math.max(0, Math.min(LEVELS - 1, Math.round(v * (LEVELS - 1))));
    const ovr = list ? Math.min(w, h) * 0.01 : 0;   /* beam.glsl overshoot, scaled to the stage */
    const retraces = [];
    let i = 0;
    let prevEnd = null;

    for (const run of L.runs) {
      const pts = run.map((p) => this.project(p, t));
      if (list && prevEnd) {
        const age = ((t / period - (i / L.segs)) % 1 + 1) % 1 * period;
        retraces.push([prevEnd, toXY(pts[0]), Math.exp(-age * DECAY) * 0.35]);
      }
      for (let j = 1; j < pts.length; j++, i++) {
        let a = toXY(pts[j - 1]);
        let b = toXY(pts[j]);
        let lv;
        if (list) {
          // Draw order: how long ago the beam passed this segment.
          const age = ((t / period - (i / L.segs)) % 1 + 1) % 1 * period;
          lv = Math.min(1, Math.exp(-age * DECAY) * 0.85 + Math.exp(-age * 22) * 1.2);
          const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
          const ux = dx / len * ovr, uy = dy / len * ovr;
          a = [a[0] - ux, a[1] - uy];
          b = [b[0] + ux, b[1] + uy];
          // Dwell: the first and last fifth of the stroke again, brighter.
          ends[bucket(lv)].push([a, [a[0] + dx * 0.2, a[1] + dy * 0.2]],
            [[b[0] - dx * 0.2, b[1] - dy * 0.2], b]);
        } else {
          // Depth cue: w runs -1 (near) to 1 (far) on the unit sphere.
          const depth = (pts[j - 1][2] + pts[j][2]) / 2;
          lv = 0.95 - 0.6 * Math.min(1, Math.max(0, (depth + 1) / 2));
        }
        core[bucket(lv)].push([a, b]);
      }
      prevEnd = toXY(pts[pts.length - 1]);
    }

    const stroke = (sets, color, width, gain) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      sets.forEach((segs, k) => {
        if (!segs.length) return;
        g.globalAlpha = Math.min(1, (k / (LEVELS - 1)) * gain);
        g.beginPath();
        for (const [a, b] of segs) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
        g.stroke();
      });
    };
    stroke(core, beam, 4, list ? 0.08 : 0.14);   /* halo */
    stroke(core, beam, 1.2, list ? 0.9 : 1);     /* core */
    if (list) stroke(ends, beam, 1.6, 0.55);

    if (retraces.length) {
      g.strokeStyle = retrace;
      g.lineWidth = 1;
      for (const [a, b, lv] of retraces) {
        g.globalAlpha = lv * 0.25;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
    }

    // Stations that never reported: marked where they would be, at zero
    // height, because the element does not know their height and says so.
    if (L.stations.length) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 0.45;
      g.fillStyle = alarm;
      for (const p of L.stations) {
        const [x, y] = toXY(this.project(p, t));
        g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    const parts = [list ? 'display list, drawn in order' : 'raster, depth-cued'];
    if (L.hasSurvey) parts.push(`${L.surveyed} of ${L.points} points surveyed`);
    if (L.open) parts.push(`${L.open} of ${L.edges} edges left open`);
    const key = parts.join(' · ');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.readout.innerHTML = parts
        .map((p, k) => `<span${k && p.includes('open') ? ' class="is-open"' : ''}>${p}</span>`).join('');
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', `Wireframe, ${parts.join(', ')}`);
    }
  }
}

define('ov-wireframe', OvWireframe);

export { OvWireframe };
