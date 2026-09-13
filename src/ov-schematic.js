/* <ov-schematic> - compartments and flow paths, each lit by what it reported.
 *
 * The damage-control board (Battlestar Galactica), the ship
 * cutaway (Star Trek's master systems display), FTL's rooms, and the system
 * page every airliner has (Airbus ECAM): a plan whose parts light by state.
 *
 * ⭐ THE REFUSAL: A PART IT HAS NO FRESH REPORT FOR IS NOT SHOWN AS IT LAST WAS.
 * Noessel's critique of the Galactica board is that it has no state for "we
 * do not know". Three tiers, following the protocol:
 *
 *   fresh     drawn as reported.
 *   stale     older than `max-age` seconds: the last state, faded and marked
 *             STALE with its age (REFUSAL.md's `stale` qualifier).
 *   no report never reported, or reported null: hatched and marked XX, the
 *             ECAM convention for a value that is not available.
 *
 * ⭐ AND FLOW IS NEVER DRAWN THROUGH A PART IT CANNOT VOUCH FOR. Flow is
 * propagated from sources along pipes, and it passes a part only if that part
 * is FRESH and open or running. A pipe is FLOWING when flow reaches it that
 * way; DRY when even assuming every doubtful part passes, nothing reaches it
 * (a known closed valve proves it); and UNDETERMINED otherwise. Continuity is
 * never inferred across a part whose state is old or missing, which is what
 * NUREG-0700 asks of a mimic and what ECAM does when a valve reads XX.
 *
 * Input, both structured, as properties or from `src` (a JSON file of both):
 *   plan    { width, height,
 *             rooms: [{ id, label, x, y, w, h }],
 *             parts: [{ id, label, kind, x, y, source }],   kind: tank | pump |
 *                                                           valve | exchanger | node
 *             pipes: [{ from, to, via: [[x, y], ...] }] }
 *   states  [{ id, state, note, age }]   age in seconds, as every reading here.
 *           Rooms: ok | caution | alarm | off. Parts: open | closed | running |
 *           stopped | ok | fault. `source` names an Overscan source of states.
 */

import { define, Overscan } from './ov-core.js';
import './ov-source.js';

/* A part passes flow in these states and blocks it in the rest. */
const PASSES = new Set(['open', 'running', 'ok']);
const ROOM_STATES = new Set(['ok', 'caution', 'alarm', 'off']);
const schematicText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

class OvSchematic extends HTMLElement {
  static observedAttributes = ['src', 'source', 'max-age'];

  connectedCallback() {
    this._plan = this._plan || null;
    this._states = this._states || [];
    this.innerHTML = `<svg class="ov-schematic__svg" role="img"></svg>`
      + `<div class="ov-schematic__readout" aria-hidden="true"></div>`;
    this.svg = this.querySelector('svg');
    this.readout = this.querySelector('.ov-schematic__readout');
    this.hatch = `ov-sch-${Math.random().toString(36).slice(2, 8)}`;
    this.bind();
    this.fetchSrc();
    this.paint();
  }

  disconnectedCallback() { if (this.unsub) this.unsub(); }

  attributeChangedCallback(n) {
    if (!this.svg) return;
    if (n === 'src') this.fetchSrc();
    else if (n === 'source') this.bind();
    else this.paint();
  }

  get plan() { return this._plan; }
  set plan(v) { this._plan = v && typeof v === 'object' ? v : null; this.paint(); }

  get states() { return this._states; }
  set states(v) { this._states = Array.isArray(v) ? v : []; this.paint(); }

  bind() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    const name = this.getAttribute('source');
    if (!name || !Overscan.subscribe) return;
    this.unsub = Overscan.subscribe(name, (list) => { this.states = list; });
  }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') !== src) return;
      this._plan = data.plan || null;
      if (Array.isArray(data.states) && !this._states.length) this._states = data.states;
    } catch {
      if (this.getAttribute('src') === src) this._plan = null;
    }
    this.paint();
  }

  /* fresh | stale | none, and the reading behind it. */
  tier(id) {
    const r = this.byId.get(id);
    if (!r || r.state === null || r.state === undefined) return { tier: 'none' };
    const maxAge = Number(this.getAttribute('max-age'));
    const age = Number(r.age);
    const stale = Number.isFinite(maxAge) && maxAge > 0 && Number.isFinite(age) && age > maxAge;
    return { tier: stale ? 'stale' : 'fresh', r };
  }

  /* Pipes reachable from the sources, passing parts that satisfy `ok`. */
  reach(pipes, ok) {
    const out = new Map();
    for (const p of pipes) (out.get(p.from) || out.set(p.from, []).get(p.from)).push(p);
    const seen = new Set();
    const lit = new Set();
    const queue = this._plan.parts.filter((p) => p.source && ok(p.id)).map((p) => p.id);
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const pipe of out.get(id) || []) {
        lit.add(pipe);
        if (ok(pipe.to)) queue.push(pipe.to);
      }
    }
    return lit;
  }

  paint() {
    if (!this.svg) return;
    const P = this._plan;
    this.removeAttribute('data-ov-refusal');
    if (!P || !Array.isArray(P.parts) && !Array.isArray(P.rooms)) {
      // No plan: a refusal, never an empty frame.
      this.setAttribute('data-ov-refusal', 'unknown');
      this.svg.setAttribute('viewBox', '0 0 200 60');
      this.svg.innerHTML = '<text class="ov-schematic__void" x="100" y="34" text-anchor="middle">NO PLAN</text>';
      this.svg.setAttribute('aria-label', 'Schematic, no reading');
      this.readout.textContent = '';
      return;
    }
    const rooms = P.rooms || [];
    const parts = P.parts || [];
    const pipes = P.pipes || [];
    this.byId = new Map(this._states.filter((s) => s && s.id).map((s) => [s.id, s]));

    const W = P.width || 400;
    const H = P.height || 240;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let g = `<defs><pattern id="${this.hatch}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + `<line x1="0" y1="0" x2="0" y2="6" class="ov-schematic__hatch"/></pattern>`
      + `<marker id="${this.hatch}-a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">`
      + `<path d="M0,0 L6,3 L0,6 z" class="ov-schematic__arrow"/></marker></defs>`;

    const count = { fresh: 0, stale: 0, none: 0 };
    const tag = (t) => (t.tier === 'none' ? 'XX' : t.tier === 'stale' ? `STALE ${Math.round(t.r.age)}s` : '');

    for (const room of rooms) {
      const t = this.tier(room.id);
      count[t.tier] += 1;
      const state = t.tier === 'none' ? 'none' : (ROOM_STATES.has(t.r.state) ? t.r.state : 'caution');
      const note = t.r && t.r.note ? t.r.note : '';
      g += `<g class="ov-schematic__room is-${state} is-${t.tier}">`
        // ⚠️ An inline STYLE, not a fill attribute: a CSS rule beats an SVG
        // presentation attribute, and `.ov-schematic__room rect` sets a fill,
        // so the hatch as an attribute was never painted. The first test only
        // checked the attribute existed and passed on an invisible hatch.
        + `<rect x="${room.x}" y="${room.y}" width="${room.w}" height="${room.h}"${t.tier === 'none' ? ` style="fill:url(#${this.hatch})"` : ''}/>`
        + `<text x="${room.x + 6}" y="${room.y + 14}" class="ov-schematic__label">${schematicText(room.label || room.id)}</text>`
        + ((note || tag(t)) ? `<text x="${room.x + 6}" y="${room.y + 28}" class="ov-schematic__note">${schematicText([note, tag(t)].filter(Boolean).join(' · '))}</text>` : '')
        + `</g>`;
    }

    // Flow. Known: fresh and passing. Possible: anything not known to block.
    const partTier = new Map(parts.map((p) => [p.id, this.tier(p.id)]));
    const known = (id) => { const t = partTier.get(id); return !!t && t.tier === 'fresh' && PASSES.has(t.r.state); };
    const possible = (id) => { const t = partTier.get(id); return !t || t.tier !== 'fresh' || PASSES.has(t.r.state); };
    const flowing = this.reach(pipes, known);
    const maybe = this.reach(pipes, possible);
    const at = new Map(parts.map((p) => [p.id, p]));
    let nFlow = 0, nDry = 0, nOpen = 0;
    for (const pipe of pipes) {
      const a = at.get(pipe.from), b = at.get(pipe.to);
      if (!a || !b) continue;
      const pts = [[a.x, a.y], ...(pipe.via || []), [b.x, b.y]].map(([x, y]) => `${x},${y}`).join(' ');
      const cls = flowing.has(pipe) ? 'is-flowing' : maybe.has(pipe) ? 'is-undetermined' : 'is-dry';
      if (cls === 'is-flowing') nFlow += 1; else if (cls === 'is-dry') nDry += 1; else nOpen += 1;
      g += `<polyline class="ov-schematic__pipe ${cls}" points="${pts}"`
        + (cls === 'is-flowing' ? ` marker-mid="url(#${this.hatch}-a)"` : '') + '/>';
    }

    for (const part of parts) {
      const t = partTier.get(part.id);
      count[t.tier] += 1;
      const s = t.tier === 'none' ? 'none' : (PASSES.has(t.r.state) ? 'pass' : t.r.state === 'fault' ? 'fault' : 'block');
      const { x, y } = part;
      let shape;
      if (t.tier === 'none') {
        // ECAM: the symbol is REPLACED, not decorated. A drawn valve with a
        // question mark still says "valve, in some position".
        shape = `<text x="${x}" y="${y + 4}" text-anchor="middle" class="ov-schematic__xx">XX</text>`;
      } else if (part.kind === 'tank') {
        shape = `<rect x="${x - 14}" y="${y - 10}" width="28" height="20"/>`;
      } else if (part.kind === 'pump') {
        shape = `<circle cx="${x}" cy="${y}" r="9"/><path d="M${x - 4},${y - 5} L${x + 6},${y} L${x - 4},${y + 5} z" class="ov-schematic__glyph"/>`;
      } else if (part.kind === 'valve') {
        // Open: the bowtie's waist is clear. Closed: a bar across it.
        shape = `<path d="M${x - 9},${y - 6} L${x + 9},${y + 6} L${x + 9},${y - 6} L${x - 9},${y + 6} z"/>`
          + (s === 'block' ? `<line x1="${x}" y1="${y - 9}" x2="${x}" y2="${y + 9}" class="ov-schematic__bar"/>` : '');
      } else if (part.kind === 'exchanger') {
        shape = `<rect x="${x - 12}" y="${y - 8}" width="24" height="16"/><path d="M${x - 9},${y} l3,-5 l3,10 l3,-10 l3,10 l3,-5" class="ov-schematic__glyph"/>`;
      } else {
        shape = `<circle cx="${x}" cy="${y}" r="3"/>`;
      }
      g += `<g class="ov-schematic__part is-${s} is-${t.tier}">${shape}`
        + `<text x="${x}" y="${y + 22}" text-anchor="middle" class="ov-schematic__plabel">${schematicText(part.label || part.id)}`
        + (t.tier === 'stale' ? ` ${Math.round(t.r.age)}s` : '') + `</text></g>`;
    }
    this.svg.innerHTML = g;

    const total = rooms.length + parts.length;
    const words = [`${count.fresh} of ${total} reporting`];
    if (count.stale) words.push(`${count.stale} stale`);
    if (count.none) words.push(`${count.none} no report`);
    const flowWords = pipes.length
      ? `flow determined on ${nFlow + nDry} of ${pipes.length} pipes` + (nOpen ? `, ${nOpen} undetermined` : '')
      : '';
    this.readout.innerHTML = `<span${count.none || count.stale ? ' class="is-doubt"' : ''}>${words.join(', ')}</span>`
      + (flowWords ? `<span${nOpen ? ' class="is-doubt"' : ''}>${flowWords}</span>` : '');
    this.svg.setAttribute('aria-label', `Schematic, ${words.join(', ')}${flowWords ? `; ${flowWords}` : ''}`);
  }
}

define('ov-schematic', OvSchematic);

export { OvSchematic };
