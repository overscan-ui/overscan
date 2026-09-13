/* <ov-locator> - where a source could be, drawn as every place it could be.
 *
 * EVE Online's probe scanning is the model and its refusal is
 * the game mechanic: one probe gives a sphere, two a circle, three a pair of
 * points, four a single point. Outer Wilds' signalscope and radio direction
 * finding are the bearing-only version.
 *
 * ⭐ THE REFUSAL: NO POINT BEFORE THE GEOMETRY ALLOWS ONE. The element draws
 * the FEASIBLE SET, every position that satisfies every fix within its stated
 * uncertainty, and counts its separate regions. It draws a single point, with
 * its ± extent, only when that whole set fits inside `fix` (world units).
 * Until then it says NO FIX and how many candidates there are. A centroid of a
 * ring, or the midpoint between two candidates, is a position nobody measured.
 *
 * Two more, following the protocol:
 *   Fixes that DISAGREE (no position satisfies all of them) are not averaged
 *   into a compromise. It says the fixes disagree and names none of them wrong.
 *   Fixes older than `max-age` seconds are EXCLUDED from the solution, drawn
 *   dim, and counted: an old range narrows the answer with a measurement of a
 *   moment that has passed.
 *
 * 🔴 THE SOLVE IS NOT LIMITED TO THE VIEW. Two range rings cross twice, at the
 * source and at its mirror across the line between the probes, and the first
 * version solved only inside the window: the mirror fell outside it, and two
 * candidates were reported as one. Omitting a candidate is inventing a fix.
 * So the solve domain contains every range ring (the set cannot extend past
 * any one of them); candidates outside the view are counted as such; and a
 * region that runs off the domain (a single bearing is unbounded) is never a
 * fix.
 *
 * Input, as a property or from `src`:
 *   fixes  [{ id, kind: 'range', x, y, r, sigma, age }      a distance, ± sigma
 *          | { id, kind: 'bearing', x, y, deg, spread, age }] a direction, ± spread
 *   World units, y up. `extent` is the half-width of the square of world shown
 *   (default 100). Bearings in degrees clockwise from north.
 */

import { define } from './ov-core.js';

const LOC_GRID = 240;   /* feasibility raster: cells per side of the solve domain */

class OvLocator extends HTMLElement {
  static observedAttributes = ['src', 'fix', 'extent', 'max-age'];

  connectedCallback() {
    this._fixes = this._fixes || [];
    this.innerHTML = `<div class="ov-locator__stage">`
      + `<canvas class="ov-locator__canvas" aria-hidden="true"></canvas>`
      + `<svg class="ov-locator__marks" aria-hidden="true"></svg></div>`
      + `<div class="ov-locator__readout" aria-live="polite"></div>`;
    this.stage = this.querySelector('.ov-locator__stage');
    this.canvas = this.querySelector('canvas');
    this.svg = this.querySelector('svg');
    this.readout = this.querySelector('.ov-locator__readout');
    this.cs = getComputedStyle(this);
    this.ro = new ResizeObserver(() => this.paint());
    this.ro.observe(this.stage);
    this.fetchSrc();
    this.paint();
  }

  disconnectedCallback() { if (this.ro) this.ro.disconnect(); }

  attributeChangedCallback(n) {
    if (!this.stage) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get fixes() { return this._fixes; }
  set fixes(v) { this._fixes = Array.isArray(v) ? v : []; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._fixes = Array.isArray(data.fixes) ? data.fixes : [];
    } catch {
      if (this.getAttribute('src') === src) this._fixes = [];
    }
    this.paint();
  }

  num(raw, dflt) {
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) && v > 0 ? v : dflt;
  }

  /* Does world point (x, y) satisfy fix f? */
  static satisfies(f, x, y) {
    if (f.kind === 'bearing') {
      const dx = x - f.x, dy = y - f.y;
      if (dx === 0 && dy === 0) return false;
      const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      const diff = Math.abs(((deg - f.deg) % 360 + 540) % 360 - 180);
      return diff <= (f.spread || 2);
    }
    const d = Math.hypot(x - f.x, y - f.y);
    return Math.abs(d - f.r) <= (f.sigma || 1);
  }

  /* The feasible set on a grid, its regions, and each region's extent. */
  solve(used, E) {
    const N = LOC_GRID;
    // Half-size of a square domain that holds the view and every range ring.
    // Bearings alone are unbounded, so they get three views' worth, and any
    // region touching that edge is marked unbounded.
    const ranges = used.filter((f) => f.kind !== 'bearing');
    let D = ranges.length ? E : 3 * E;
    for (const f of ranges) D = Math.max(D, Math.abs(f.x) + f.r + (f.sigma || 1), Math.abs(f.y) + f.r + (f.sigma || 1));
    // A margin, or a ring that just reaches the domain would touch its edge.
    E = D * 1.04;
    // Only bearings can run off the domain: with any range fix the set is
    // bounded by construction, and touching the margin means nothing.
    const canRunOff = ranges.length === 0;
    const cell = (2 * E) / N;
    const ok = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) {
      const y = E - (j + 0.5) * cell;
      for (let i = 0; i < N; i++) {
        const x = -E + (i + 0.5) * cell;
        let all = used.length > 0;
        for (const f of used) { if (!OvLocator.satisfies(f, x, y)) { all = false; break; } }
        if (all) ok[j * N + i] = 1;
      }
    }
    // Regions: 8-connected flood fill, so a thin ring does not shatter.
    const label = new Int32Array(N * N);
    const regions = [];
    for (let k = 0; k < N * N; k++) {
      if (!ok[k] || label[k]) continue;
      const id = regions.length + 1;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0, sx = 0, sy = 0, edge = false;
      const stack = [k];
      label[k] = id;
      while (stack.length) {
        const c = stack.pop();
        const i = c % N, j = (c - i) / N;
        if (canRunOff && (i === 0 || j === 0 || i === N - 1 || j === N - 1)) edge = true;
        const x = -E + (i + 0.5) * cell, y = E - (j + 0.5) * cell;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        n += 1; sx += x; sy += y;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const q = jj * N + ii;
          if (ok[q] && !label[q]) { label[q] = id; stack.push(q); }
        }
      }
      // Extent is the region's half-diagonal plus half a cell: the raster
      // cannot claim to know the edge more finely than one cell.
      regions.push({ n, cx: sx / n, cy: sy / n, unbounded: edge,
        extent: Math.hypot(maxX - minX, maxY - minY) / 2 + cell / 2 });
    }
    return { ok, regions, cell, N, D: E };
  }

  paint() {
    if (!this.stage) return;
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const E = this.num(this.getAttribute('extent'), 100);
    const FIX = this.num(this.getAttribute('fix'), 3);
    const maxAge = Number(this.getAttribute('max-age'));
    const fixes = this._fixes.filter((f) => f && Number.isFinite(f.x) && Number.isFinite(f.y)
      && (f.kind === 'bearing' ? Number.isFinite(f.deg) : Number.isFinite(f.r)));
    const isStale = (f) => Number.isFinite(maxAge) && maxAge > 0 && Number.isFinite(f.age) && f.age > maxAge;
    const used = fixes.filter((f) => !isStale(f));
    const stale = fixes.length - used.length;

    this.removeAttribute('data-ov-refusal');
    const sol = this.solve(used, E);
    const R = sol.regions;
    const outside = R.filter((r) => Math.abs(r.cx) > E || Math.abs(r.cy) > E).length;
    const where = outside ? ` (${outside} outside the view)` : '';
    let verdict;
    let point = null;
    if (!used.length) {
      verdict = { cls: 'is-none', text: fixes.length ? 'NO CURRENT FIX: every fix is stale' : 'NO FIXES' };
      this.setAttribute('data-ov-refusal', 'unknown');
    } else if (!R.length) {
      // Contradictory fixes. No compromise point, and no fix is blamed.
      verdict = { cls: 'is-disagree', text: `FIXES DISAGREE: no position satisfies all ${used.length}` };
    } else if (R.length === 1 && R[0].extent <= FIX && !R[0].unbounded) {
      point = R[0];
      verdict = { cls: 'is-fix', text: `FIX ±${R[0].extent.toFixed(1)} at ${R[0].cx.toFixed(1)}, ${R[0].cy.toFixed(1)}` };
    } else if (R.length === 1) {
      verdict = { cls: 'is-region', text: R[0].unbounded
        ? 'NO FIX: unbounded, one bearing cannot close'
        : `NO FIX: one region, ±${R[0].extent.toFixed(1)} wide, needs ±${FIX}${where}` };
    } else {
      verdict = { cls: 'is-candidates', text: `NO FIX: ${R.length} candidates${where}` };
    }

    if (w && h) {
      const dpr = window.devicePixelRatio || 1;
      const c = this.canvas;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const S = Math.min(w, h) / (2 * E);
      const ox = w / 2, oy = h / 2;
      // The feasible set, cell by cell, in the accent at low alpha.
      g.fillStyle = this.cs.getPropertyValue('--ov-accent').trim() || '#fff';
      g.globalAlpha = 0.55;
      const px = sol.cell * S;
      for (let j = 0; j < sol.N; j++) for (let i = 0; i < sol.N; i++) {
        if (!sol.ok[j * sol.N + i]) continue;
        g.fillRect(ox + (-sol.D + i * sol.cell) * S, oy - (sol.D - j * sol.cell) * S, px + 0.5, px + 0.5);
      }
      g.globalAlpha = 1;

      const X = (x) => (ox + x * S).toFixed(1), Y = (y) => (oy - y * S).toFixed(1);
      let s = `<line class="ov-locator__axis" x1="${X(-E)}" y1="${Y(0)}" x2="${X(E)}" y2="${Y(0)}"/>`
        + `<line class="ov-locator__axis" x1="${X(0)}" y1="${Y(-E)}" x2="${X(0)}" y2="${Y(E)}"/>`;
      for (const f of fixes) {
        const cls = isStale(f) ? 'ov-locator__fix is-stale' : 'ov-locator__fix';
        if (f.kind === 'bearing') {
          const a = f.deg * Math.PI / 180;
          s += `<line class="${cls}" x1="${X(f.x)}" y1="${Y(f.y)}" x2="${X(f.x + Math.sin(a) * E * 3)}" y2="${Y(f.y + Math.cos(a) * E * 3)}"/>`;
        } else {
          s += `<circle class="${cls}" cx="${X(f.x)}" cy="${Y(f.y)}" r="${(f.r * S).toFixed(1)}"/>`;
        }
        s += `<rect class="ov-locator__probe${isStale(f) ? ' is-stale' : ''}" x="${Number(X(f.x)) - 3}" y="${Number(Y(f.y)) - 3}" width="6" height="6"/>`
          + `<text class="ov-locator__tag" x="${Number(X(f.x)) + 6}" y="${Number(Y(f.y)) - 6}">${String(f.id ?? '').replace(/[&<>]/g, '')}${isStale(f) ? ` ${Math.round(f.age)}s` : ''}</text>`;
      }
      if (point) {
        // Only now, and with its uncertainty drawn: the ring is the claim.
        s += `<circle class="ov-locator__point" cx="${X(point.cx)}" cy="${Y(point.cy)}" r="3"/>`
          + `<circle class="ov-locator__halo" cx="${X(point.cx)}" cy="${Y(point.cy)}" r="${Math.max(4, point.extent * S).toFixed(1)}"/>`;
      }
      this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      this.svg.innerHTML = s;
    }

    const parts = [`${used.length} fix${used.length === 1 ? '' : 'es'}`];
    if (stale) parts.push(`${stale} excluded as stale`);
    this.readout.innerHTML = `<span class="ov-locator__verdict ${verdict.cls}">${verdict.text}</span><span>${parts.join(', ')}</span>`;
    this.setAttribute('data-ov-solution', verdict.cls.slice(3));
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Locator, ${verdict.text.toLowerCase()}, ${parts.join(', ')}`);
  }
}

define('ov-locator', OvLocator);

export { OvLocator };
