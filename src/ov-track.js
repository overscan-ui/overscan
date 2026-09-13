/* <ov-track> - a tactical track symbol that refuses to default an identity.
 *
 * For aegis, and for
 * ov-radar, which draws the same symbol through trackSymbol() below.
 *
 *   <ov-track identity="assumed-friend" dimension="air" course="270"
 *             speed="420" label="TN 4012"></ov-track>
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * ⭐ THE FRAME IS THE IDENTITY, AND WHICH HALF IS DRAWN IS THE DIMENSION. The
 * symbol register's own rule ("the frame is the category") applied to tracks,
 * after the shape principle naval track symbology uses. It is that principle,
 * NOT a conformant implementation of any standard:
 *
 *   identity family   frame          dimension     drawn
 *   friend            circle         air           upper half, open below
 *   hostile           diamond        surface       whole frame
 *   neutral           square         subsurface    lower half, open above
 *   unknown           quatrefoil
 *
 * Colour follows (hostile takes --ov-alarm), but no identity rests on it: the
 * shape carries it, and the label carries it again in words.
 *
 * ⚠️ Affiliation is drawn by the element, NOT from the symbol register. The
 * register's ninth family is deliberately unspent, and identity is
 * not a new kind of thing to name: it is the frame, and the register already
 * separates frames from marks.
 *
 * ── THE REFUSALS ──────────────────────────────────────────────────────────
 *
 * 🔴 AN IDENTITY IS NEVER DEFAULTED. A track nobody has classified is PENDING,
 * drawn as a dashed quatrefoil, never as the friend or hostile a display could
 * find convenient. An identity string this element does not know ("friendly",
 * "blue") is pending too, and the report names what it was handed rather than
 * guessing what was meant.
 *
 * 🔴 A HEDGED IDENTITY IS NEVER ROUNDED UP. `assumed-friend` is a dashed circle,
 * never the solid one; `suspect` is a dashed diamond, never hostile. The dash
 * is the whole difference between "we think" and "we know", and a display
 * that drops it has promoted a guess to a fact in the one place it matters.
 *
 *   identity         frame        line      what it claims
 *   pending          quatrefoil   dashed    nobody has classified it
 *   unknown          quatrefoil   solid     classified, and not determinable
 *   assumed-friend   circle       dashed    believed friend, not confirmed
 *   friend           circle       solid
 *   neutral          square       solid
 *   suspect          diamond      dashed    believed hostile, not confirmed
 *   hostile          diamond      solid
 *
 * Two more that fall out of the first:
 *
 * 1. AN UNREPORTED DIMENSION IS NOT SURFACE. The whole frame is what surface
 *    looks like, so drawing it by default would be a claim. The frame is drawn
 *    with a GAP at the waterline instead: both halves, meeting nowhere.
 * 2. AN UNKNOWN COURSE HAS NO LEADER. The velocity leader points along the
 *    course; with no course there is no direction to draw, and a leader
 *    pointing north by default is a heading nobody reported. "Stationary"
 *    (speed 0) and "no speed reported" are different, and read differently.
 */

import { define } from './ov-core.js';

const FAMILY = {
  pending: 'unknown', unknown: 'unknown',
  'assumed-friend': 'friend', friend: 'friend',
  neutral: 'neutral',
  suspect: 'hostile', hostile: 'hostile',
};
const HEDGED = new Set(['pending', 'assumed-friend', 'suspect']);
const DIMENSIONS = new Set(['air', 'surface', 'subsurface']);

const WORDS = {
  pending: 'PENDING', unknown: 'UNKNOWN', 'assumed-friend': 'ASSUMED FRIEND',
  friend: 'FRIEND', neutral: 'NEUTRAL', suspect: 'SUSPECT', hostile: 'HOSTILE',
};

/* Frames centred on 0,0 in a 48-unit box whose outer ring is left for the
 * leader. Each is one closed path so a dash pattern runs continuously round it.
 *
 * ⭐ EQUAL AREA, NOT EQUAL REACH. A circle, square and diamond of the same
 * reach differ in area by up to half, and a bigger frame reads as a more
 * important track. So the circle is r 11 (area ~380), the square 19.5 a side
 * (~380), the diamond is that square turned (reach 13.8), and the quatrefoil
 * matches by measurement, below. Identity is shape, not size. */
const FRAME = {
  friend: 'M -11 0 A 11 11 0 1 1 11 0 A 11 11 0 1 1 -11 0 Z',
  hostile: 'M 0 -13.8 L 13.8 0 L 0 13.8 L -13.8 0 Z',
  neutral: 'M -9.75 -9.75 H 9.75 V 9.75 H -9.75 Z',
  // Four lobes meeting on the diagonals.
  // Corners +-4.16, lobe radius 5.33: measured 380 in the browser (sampled
  // path, shoelace). The first cut matched the circle's REACH instead and
  // measured 277, a quarter smaller, which is the error the rule is about.
  unknown: 'M -4.16 -4.16 A 5.33 5.33 0 1 1 4.16 -4.16 A 5.33 5.33 0 1 1 4.16 4.16 '
         + 'A 5.33 5.33 0 1 1 -4.16 4.16 A 5.33 5.33 0 1 1 -4.16 -4.16 Z',
};

/* Which part of the frame each dimension keeps: a band in y. The gap for an
 * unreported dimension is the waterline band itself, left out of both. */
const KEEP = {
  air: [[-20, 0]],
  subsurface: [[0, 20]],
  surface: [[-20, 20]],
  unreported: [[-20, -2], [2, 20]],
};

/* Read one track: what it was handed, what the element will draw, and why. A
 * pure function so ov-radar reaches the same answer without an element. */
export function resolveTrack(t = {}) {
  const raw = t.identity ?? null;
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  const identity = key && key in FAMILY ? key : 'pending';
  const unrecognised = raw !== null && raw !== '' && identity === 'pending' && key !== 'pending'
    ? String(raw) : null;

  const dRaw = typeof t.dimension === 'string' ? t.dimension.trim().toLowerCase() : null;
  const dimension = dRaw && DIMENSIONS.has(dRaw) ? dRaw : null;

  const num = (v) => (v === null || v === undefined || v === '' ? null
    : Number.isFinite(Number(v)) ? Number(v) : null);
  const course = num(t.course);
  const speed = num(t.speed);
  let vector;
  if (speed === 0) vector = 'stationary';
  else if (course === null && speed === null) vector = 'none';
  else if (course === null) vector = 'no-course';
  else if (speed === null || speed < 0) vector = 'no-speed';
  else vector = 'leader';

  return {
    identity,
    family: FAMILY[identity],
    hedged: HEDGED.has(identity),
    unrecognised,
    dimension,
    course: course === null ? null : ((course % 360) + 360) % 360,
    speed,
    vector,
    label: t.label ?? null,
  };
}

let clipN = 0;

/* SVG for one symbol, centred on 0,0, in symbol units. `scale` multiplies the
 * whole thing; `speedMax` is the speed that draws the longest leader. */
export function trackSymbol(r, { scale = 1, speedMax = 600, x = 0, y = 0, extra = '' } = {}) {
  const band = KEEP[r.dimension ?? 'unreported'];
  const id = `ov-track-clip-${++clipN}`;
  const rects = band.map(([y0, y1]) => `<rect x="-20" y="${y0}" width="40" height="${y1 - y0}"/>`).join('');
  let leader = '';
  if (r.vector === 'leader') {
    // Length is speed, capped: past speedMax the leader stops at full length
    // and carries a crossbar, so a capped vector cannot pass for a measured one.
    const over = r.speed > speedMax;
    // 15 is just clear of the widest frame (the diamond, 13.8), so even a
    // slow track's leader shows outside it; 23 stays inside the 48 box.
    const len = 15 + 8 * Math.min(1, r.speed / speedMax);
    const a = ((r.course - 90) * Math.PI) / 180;
    const x2 = Math.cos(a) * len;
    const y2 = Math.sin(a) * len;
    leader = `<line class="ov-track__leader" x1="0" y1="0" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    if (over) {
      const px = -Math.sin(a) * 3;
      const py = Math.cos(a) * 3;
      leader += `<line class="ov-track__leader ov-track__over" x1="${(x2 - px).toFixed(2)}" y1="${(y2 - py).toFixed(2)}" `
        + `x2="${(x2 + px).toFixed(2)}" y2="${(y2 + py).toFixed(2)}"/>`;
    }
  }
  return `<g class="ov-track__sym" data-ov-identity="${r.identity}" data-ov-family="${r.family}"`
    + `${r.hedged ? ' data-ov-hedged' : ''}${r.dimension ? '' : ' data-ov-dim-unreported'}`
    + ` transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale})"${extra}>`
    + `<clipPath id="${id}">${rects}</clipPath>`
    + leader
    + `<path class="ov-track__frame" d="${FRAME[r.family]}" clip-path="url(#${id})"/>`
    + `</g>`;
}

/* The words for a track: identity always, then whatever the symbol could not
 * say or refused to. Used for the visible tag and the accessible name. */
export function trackWords(r) {
  const out = [WORDS[r.identity]];
  if (r.unrecognised) out.push(`"${r.unrecognised}" NOT AN IDENTITY`);
  out.push(r.dimension ? r.dimension.toUpperCase() : 'DIMENSION NOT REPORTED');
  if (r.vector === 'leader') out.push(`${Math.round(r.course)}° ${r.speed}`);
  if (r.vector === 'stationary') out.push('STATIONARY');
  if (r.vector === 'no-course') out.push('NO COURSE');
  if (r.vector === 'no-speed') out.push('NO SPEED');
  if (r.vector === 'none') out.push('NO VECTOR');
  return out;
}

class OvTrack extends HTMLElement {
  static observedAttributes = ['identity', 'dimension', 'course', 'speed', 'label', 'speed-max'];

  connectedCallback() { this.render(); }

  attributeChangedCallback() { if (this.isConnected) this.render(); }

  render() {
    const r = resolveTrack({
      identity: this.getAttribute('identity'),
      dimension: this.getAttribute('dimension'),
      course: this.getAttribute('course'),
      speed: this.getAttribute('speed'),
      label: this.getAttribute('label'),
    });
    const max = Number(this.getAttribute('speed-max'));
    const words = trackWords(r);
    this.innerHTML = `<svg class="ov-track__svg" viewBox="-24 -24 48 48" aria-hidden="true">`
      + trackSymbol(r, { speedMax: Number.isFinite(max) && max > 0 ? max : 600 }) + `</svg>`
      + `<span class="ov-track__text">`
      + (r.label ? `<span class="ov-track__label"></span>` : '')
      + `<span class="ov-track__tag"></span></span>`;
    if (r.label) this.querySelector('.ov-track__label').textContent = r.label;
    this.querySelector('.ov-track__tag').textContent = words.join(' · ');
    this.setAttribute('data-ov-identity', r.identity);
    this.toggleAttribute('data-ov-hedged', r.hedged);
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', [r.label, ...words].filter(Boolean).join(', ').toLowerCase());
    this._r = r;
  }

  get report() { return this._r ? { ...this._r } : null; }
}

define('ov-track', OvTrack);

export { OvTrack };
