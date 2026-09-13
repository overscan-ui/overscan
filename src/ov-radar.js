/* <ov-radar> - a PPI that shows you when it last looked.
 *
 * A radar display is the clearest case of the rule that the drawing is
 * a claim about data which is not the data. A blip is not where the contact is.
 * It is where the contact WAS when the sweep last passed that bearing, which is
 * up to one full rotation ago. Every PPI ever built has this property and most
 * software imitations quietly throw it away by redrawing every contact on every
 * frame, which turns a known-stale picture into a confident live one.
 *
 * So this one keeps it:
 *
 * - A contact is plotted only when the sweep crosses its bearing. Between
 *   passes its blip does not move, however much the underlying data changes.
 * - Blips decay with age, so how stale a reading is can be read off the
 *   display. Phosphor persistence was never decoration; it was the age.
 * - Range rings are labelled with the range they are, because an unlabelled
 *   ring is a scale the reader has to assume.
 * - A contact with no bearing or no range is not plotted and is counted, so
 *   the display never silently holds fewer contacts than it was given.
 */

import { define, watchSeen, isSeen } from './ov-core.js';
import './ov-source.js';
import { resolveTrack, trackSymbol } from './ov-track.js';

/* Named radarMotion, not motionOf: ov-flip and ov-reveal each have a
 * top-level motionOf, and collisions.py reports the shared name.
 *
 * Is a contact moving? Its reported `speed` says so directly. Failing that,
 * compare with where the last sweep put it: a shift of more than half a
 * percent of the range between sweeps is motion. Seen once with no speed,
 * nobody knows yet, and 'unknown' is the answer rather than 'still'. */
function radarMotion(c, prev, bearing, range, full) {
  const s = Number(c.speed);
  if (c.speed !== undefined && c.speed !== null && c.speed !== '' && Number.isFinite(s)) {
    return s > 0 ? 'moving' : 'still';
  }
  if (!prev) return 'unknown';
  const rad = (d) => (d * Math.PI) / 180;
  const dx = range * Math.sin(rad(bearing)) - prev.range * Math.sin(rad(prev.bearing));
  const dy = range * Math.cos(rad(bearing)) - prev.range * Math.cos(rad(prev.bearing));
  return Math.hypot(dx, dy) > full * 0.005 ? 'moving' : 'still';
}

let glowN = 0;

function elevationOf(c) {
  if (!c || c.elevation === undefined || c.elevation === null || c.elevation === '') return null;
  const n = Number(c.elevation);
  return Number.isFinite(n) ? n : null;
}

/* An attribute set every frame to the value it already has still invalidates. */
const setIfNew = (el, name, value) => {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
};

class OvRadar extends HTMLElement {
  static observedAttributes = ['range', 'rings', 'period', 'source', 'symbols', 'motion-only', 'stalks', 'trail', 'glow'];

  connectedCallback() {
    this.plotted = new Map();
    this.pending = [];
    this.lastAngle = 0;
    this.t0 = performance.now();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.bind();
    this.build();
    this.unseen = watchSeen(this, this.wake);
    this.frame();
  }

  /* Called by the visibility gate when the element comes back into view. */
  wake = () => { if (!this.raf) this.raf = requestAnimationFrame(this.frame); };

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.unseen) this.unseen();
    if (this.unsub) this.unsub();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'source') this.bind();
    this.build();
  }

  get range() { return Number(this.getAttribute('range') || 800); }
  get rings() { return Math.max(1, parseInt(this.getAttribute('rings') || '3', 10)); }
  get period() { return Number(this.getAttribute('period') || 4); }

  bind() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (contacts) => {
      this.pending = Array.isArray(contacts) ? contacts : [];
    });
  }

  build() {
    const r = this.range;
    const rings = [];
    for (let i = 1; i <= this.rings; i++) {
      const f = i / this.rings;
      rings.push(`<circle class="ov-radar__ring" cx="50" cy="50" r="${(f * 48).toFixed(2)}"/>`);
      // Labelled, because an unlabelled ring is a scale the reader has to
      // assume, and assuming is where 800 became 851.
      rings.push(`<text class="ov-radar__ringlabel" x="50.8" y="${(50 - f * 48 + 3.2).toFixed(2)}">`
        + `${Math.round(r * f)}</text>`);
    }
    const spokes = [0, 45, 90, 135].map((a) => {
      const rad = (a * Math.PI) / 180;
      return `<line class="ov-radar__spoke" x1="${(50 - Math.cos(rad) * 48).toFixed(2)}" `
        + `y1="${(50 - Math.sin(rad) * 48).toFixed(2)}" `
        + `x2="${(50 + Math.cos(rad) * 48).toFixed(2)}" `
        + `y2="${(50 + Math.sin(rad) * 48).toFixed(2)}"/>`;
    }).join('');
    /* ⭐ `glow` is the THEME's phosphor bloom (--ov-bloom: 0 in antiseptic,
     * 0.3 in esper and neo), not a number chosen here, and it goes on what the
     * BEAM paints (the sweep and the contacts), never the graticule: a glow
     * on the whole scope blurred the range labels. An SVG filter, not a CSS
     * one, because Safari will not CSS-filter shapes inside an SVG. */
    const glow = this.hasAttribute('glow');
    const gid = `ov-radar-glow-${++glowN}`;
    const glowDefs = glow
      // 🔴 userSpaceOnUse, over the whole scope: the default filter region is
      // the shape's bounding box, and the sweep line at 0 degrees has a box
      // of ZERO width, so the glowing arm simply was not drawn.
      ? `<defs><filter id="${gid}" filterUnits="userSpaceOnUse" x="-5" y="-5" width="110" height="110">`
        + `<feGaussianBlur class="ov-radar__bloom" stdDeviation="0" result="b"/>`
        + `<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>`
        + `</filter></defs>` : '';
    const glowRef = glow ? ` filter="url(#${gid})"` : '';
    this.innerHTML =
      /* ⭐ `trail` is PHOSPHOR PERSISTENCE, not a flourish. Its brightness at
       * any bearing is how recently the beam swept it, on the SAME linear
       * decay the blips use (1 at the arm, down to the floor one period
       * later), so the wedge behind the arm is the age of the data under it.
       * A shorter, prettier trail would be decoration; this one is a reading.
       * It sits UNDER the scope so it tints the field, not the rings. */
      (this.hasAttribute('trail') ? '<div class="ov-radar__trail" aria-hidden="true"></div>' : '')
      + `<svg class="ov-radar__svg" viewBox="0 0 100 100" aria-hidden="true">`
      + rings.join('') + spokes
      + glowDefs
      + `<line class="ov-radar__sweep" x1="50" y1="50" x2="50" y2="2"${glowRef}/>`
      + `<g class="ov-radar__blips"${glowRef}></g></svg>`
      // The mode note is a real line UNDER the scope, not an overlay: on a
      // 220px scope a two-line overlay covered the rings and their labels.
      + `<div class="ov-radar__note" hidden></div>`;
    this.sweep = this.querySelector('.ov-radar__sweep');
    this.blips = this.querySelector('.ov-radar__blips');
    this.trail = /** @type {HTMLElement | null} */ (this.querySelector('.ov-radar__trail'));
    this.bloom = this.querySelector('.ov-radar__bloom');
    this.bloomAt = -1;
    this.noteEl = /** @type {HTMLElement | null} */ (this.querySelector('.ov-radar__note'));
  }

  frame = () => {
    const now = performance.now();
    const elapsed = (now - this.t0) / 1000;
    const angle = this.reduced.matches ? 0 : (elapsed / this.period) * 360 % 360;

    // Refresh only the contacts the beam has crossed since the last frame.
    const crossed = (b) => {
      const a0 = this.lastAngle;
      const a1 = angle;
      return a1 >= a0 ? (b > a0 && b <= a1) : (b > a0 || b <= a1);
    };

    let dropped = 0;
    for (const c of this.pending) {
      const bearing = Number(c.bearing);
      const rng = Number(c.range);
      if (!Number.isFinite(bearing) || !Number.isFinite(rng)) { dropped += 1; continue; }
      if (this.reduced.matches || crossed(((bearing % 360) + 360) % 360)) {
        const id = c.id ?? `${bearing}`;
        this.plotted.set(id, { bearing, range: rng, at: now, track: c, motion: radarMotion(c, this.plotted.get(id), bearing, rng, this.range) });
      }
    }
    this.lastAngle = angle;
    if (this.sweep) this.sweep.setAttribute('transform', `rotate(${angle} 50 50)`);
    if (this.trail) this.trail.style.setProperty('--ov-radar-angle', `${angle}deg`);
    // Re-read the theme's bloom about once a second: a theme switch changes
    // it, and getComputedStyle every frame would be waste.
    if (this.bloom && now - this.bloomAt > 1000) {
      this.bloomAt = now;
      const b = parseFloat(getComputedStyle(this).getPropertyValue('--ov-bloom')) || 0;
      this.bloom.setAttribute('stdDeviation', (b * 4).toFixed(2));
    }

    const persistence = this.period * 1000;
    /* ⭐ `symbols` draws each contact as its TRACK SYMBOL (ov-track.js), with the
     * same refusals as the element: a contact with no identity is PENDING,
     * never friend or hostile, and one with no dimension leaves the waterline
     * gap. Off by default, so every existing radar draws exactly as before.
     * The symbol is what the contact WAS at the last sweep, like the blip: the
     * track object is captured when the beam crosses it, not re-read later. */
    const symbols = this.hasAttribute('symbols');
    /* ⭐ `motion-only` is a motion tracker (Halo's, Alien: Isolation's): it
     * draws what is MOVING and nothing else. A stationary return is left off,
     * and so is one whose motion is not yet known (seen once, no speed), rather
     * than being painted as anything. The scope says MOTION ONLY and counts
     * what it left off, so an empty tracker never reads as an empty room. */
    const motionOnly = this.hasAttribute('motion-only');
    /* ⭐ `stalks` hangs each contact's ELEVATION off it, up for above the
     * plane and down for below (Elite Dangerous). A contact with no elevation
     * gets NO stalk, never a zero-length one that would claim it is level; an
     * elevation of 0 is drawn as a flat tick, ON the plane, which is a claim. */
    const stalks = this.hasAttribute('stalks');
    const counts = {};
    let still = 0, unmoved = 0, noElev = 0;
    let out = '';
    for (const [id, p] of this.plotted) {
      const age = now - p.at;
      if (age > persistence * 1.25) { this.plotted.delete(id); continue; }
      const f = Math.min(1, p.range / this.range);
      const rad = ((p.bearing - 90) * Math.PI) / 180;
      const x = 50 + Math.cos(rad) * f * 48;
      const y = 50 + Math.sin(rad) * f * 48;
      // Decay is the age, readable off the screen.
      // In 1/32 steps, a change nobody can see, so the blips are rebuilt when
      // a fade step or a contact changes rather than on every frame.
      const o = Math.max(0.08, Math.round((1 - age / persistence) * 32) / 32);
      if (motionOnly && p.motion !== 'moving') {
        if (p.motion === 'still') still += 1; else unmoved += 1;
        continue;
      }
      if (stalks) {
        const el = elevationOf(p.track);
        if (el === null) noElev += 1;
        else if (el === 0) {
          out += `<line class="ov-radar__stalk ov-radar__stalk--level" x1="${(x - 1.4).toFixed(2)}" y1="${y.toFixed(2)}" `
            + `x2="${(x + 1.4).toFixed(2)}" y2="${y.toFixed(2)}" style="opacity:${o.toFixed(3)}"/>`;
        } else {
          // Same scale as range: an elevation of `range` would reach the rim.
          const h = Math.max(-48, Math.min(48, (el / this.range) * 48));
          out += `<line class="ov-radar__stalk" x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" `
            + `x2="${x.toFixed(2)}" y2="${(y - h).toFixed(2)}" style="opacity:${o.toFixed(3)}"/>`
            + `<circle class="ov-radar__stalktip" cx="${x.toFixed(2)}" cy="${(y - h).toFixed(2)}" r="0.7" style="opacity:${o.toFixed(3)}"/>`;
        }
      }
      if (symbols) {
        const r = resolveTrack(p.track);
        counts[r.identity] = (counts[r.identity] || 0) + 1;
        // 0.2 puts a frame about 4.5 units across in a 100-unit scope: three
        // blips wide, readable at a 320px scope, and still clear of the rings.
        out += trackSymbol(r, { scale: 0.2, x, y,
          extra: ` style="opacity:${o.toFixed(3)}"` });
      } else {
        out += `<circle class="ov-radar__blip" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" `
          + `r="1.5" style="opacity:${o.toFixed(3)}"/>`;
      }
    }
    if (this.blips && out !== this.lastOut) { this.blips.innerHTML = out; this.lastOut = out; }

    const note = [];
    if (motionOnly) note.push(`MOTION ONLY${still ? ` · ${still} STILL NOT SHOWN` : ''}${unmoved ? ` · ${unmoved} MOTION UNKNOWN` : ''}`);
    if (stalks && noElev) note.push(`${noElev} WITHOUT ELEVATION`);
    this.toggleAttribute('data-ov-note', note.length > 0);
    if (note.length) setIfNew(this, 'data-ov-note-text', note.join(' · '));
    if (this.noteEl) {
      const text = note.join(' · ');
      this.noteEl.hidden = !text;
      if (this.noteEl.textContent !== text) this.noteEl.textContent = text;
    }
    this.toggleAttribute('data-ov-dropped', dropped > 0);
    if (dropped) setIfNew(this, 'data-ov-dropped-n', `${dropped} not plotted`);

    setIfNew(this, 'role', 'img');
    setIfNew(this, 'aria-label',
      `${this.plotted.size} contacts, last swept positions, range ${this.range}`
      // With symbols, the name says the identities too, counted: a symbol a
      // screen reader cannot see is not allowed to carry the only copy.
      + (symbols && this.plotted.size
        ? ': ' + Object.entries(counts).map(([k, n]) => `${n} ${k.replace('-', ' ')}`).join(', ')
        : '')
      + (note.length ? `, ${note.join(', ').toLowerCase()}` : '')
      + (dropped ? `, ${dropped} contacts without a fix and not plotted` : ''));

    // Offscreen, the next frame is not asked for; watchSeen's wake asks again.
    this.raf = isSeen(this) ? requestAnimationFrame(this.frame) : 0;
  };
}

define('ov-radar', OvRadar);

export { OvRadar };
