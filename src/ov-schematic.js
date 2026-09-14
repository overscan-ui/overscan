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
 *             rooms: [{ id, label, x, y, w, h }                a rectangle, or
 *                     { id, label, d, lx, ly, anchor, lead }], a path, labelled
 *                                                              at lx, ly, with an
 *                                                              optional lead line
 *                                                              [x1, y1, x2, y2]
 *             parts: [{ id, label, kind, x, y, source }],   kind: tank | pump |
 *                                                           valve | exchanger | node
 *             pipes: [{ from, to, via: [[x, y], ...] }],
 *             outline: [path, ...],   drawn unlit under everything; not a part
 *             orient: 'which way the drawing faces', printed on it }
 *   states  [{ id, state, note, age }]   age in seconds, as every reading here.
 *           Rooms: ok | caution | alarm | off. Parts: open | closed | running |
 *           stopped | ok | fault. `source` names an Overscan source of states.
 *
 * STOCK PLANS. `stock="body"` (or head, vehicle, ship) draws a plan from
 * ov-plans.js, which the kit does not load for you: set
 * `OvSchematic.plans = plans` once, or name the module on the element with
 * `plans="…/ov-plans.js"`. Asked for and absent is a refusal that says which
 * (PLANS NOT LOADED, LOADING, FAILED TO LOAD, UNREADABLE, NO STOCK PLAN), never
 * an empty frame. A stock name AND a plan of the element's own are two answers
 * to one question, and neither is picked.
 *
 * ⭐ A REPORT FOR A PART THE PLAN DOES NOT HAVE IS COUNTED, NEVER MATCHED. A
 * stock plan's ids are fixed, so `left_arm` sent to a body whose id is `arm_l`
 * would otherwise vanish while the arm it meant sits hatched as XX. The readout
 * names every such id.
 */

import { define, Overscan } from './ov-core.js';
import './ov-source.js';

/* A part passes flow in these states and blocks it in the rest. */
const PASSES = new Set(['open', 'running', 'ok']);
const ROOM_STATES = new Set(['ok', 'caution', 'alarm', 'off']);
const ANCHORS = new Set(['start', 'middle', 'end']);
const schematicText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const finite = (...v) => v.every((n) => Number.isFinite(n));

/* ── stock plans, shared by every schematic on the page ─────────────────── */

const stock = { data: null, listeners: new Set(), byUrl: new Map() };
const tellStock = () => { for (const fn of [...stock.listeners]) fn(); };
const isPlan = (p) => !!p && typeof p === 'object' && (Array.isArray(p.rooms) || Array.isArray(p.parts));
const isPlans = (d) => !!d && typeof d === 'object' && Object.keys(d).length > 0 && Object.values(d).every(isPlan);

function loadPlans(url) {
  const href = new URL(url, document.baseURI).href;
  let e = stock.byUrl.get(href);
  if (e) return e;
  e = { state: 'loading', data: null, url };
  stock.byUrl.set(href, e);
  import(/* @vite-ignore */ href)
    .then((m) => { if (isPlans(m.default)) { e.state = 'ready'; e.data = m.default; } else e.state = 'unreadable'; },
      () => { e.state = 'failed'; })
    .finally(tellStock);
  return e;
}

class OvSchematic extends HTMLElement {
  static observedAttributes = ['src', 'source', 'max-age', 'stock', 'plans'];

  static get plans() { return stock.data; }
  static set plans(d) { stock.data = d ?? null; tellStock(); }

  connectedCallback() {
    this._plan = this._plan || null;
    this._states = this._states || [];
    this.innerHTML = `<svg class="ov-schematic__svg" role="img"></svg>`
      + `<div class="ov-schematic__readout" aria-hidden="true"></div>`;
    this.svg = this.querySelector('svg');
    this.readout = this.querySelector('.ov-schematic__readout');
    this.hatch = `ov-sch-${Math.random().toString(36).slice(2, 8)}`;
    this.onStock = () => this.paint();
    stock.listeners.add(this.onStock);
    this.bind();
    this.fetchSrc();
    this.paint();
  }

  disconnectedCallback() {
    if (this.unsub) this.unsub();
    stock.listeners.delete(this.onStock);
  }

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

  /* The plan to draw, or the words for why there is none. */
  resolve() {
    const name = this.getAttribute('stock');
    if (name === null) return this._plan ? { plan: this._plan } : { refusal: 'NO PLAN' };
    if (this._plan) return { refusal: 'TWO PLANS GIVEN: A STOCK PLAN AND ONE OF ITS OWN' };
    const url = this.getAttribute('plans');
    const e = url ? loadPlans(url)
      : stock.data === null ? { state: 'missing' }
        : isPlans(stock.data) ? { state: 'ready', data: stock.data } : { state: 'unreadable' };
    switch (e.state) {
      case 'missing': return { refusal: 'STOCK PLANS NOT LOADED' };
      case 'loading': return { refusal: 'STOCK PLANS LOADING' };
      case 'failed': return { refusal: `STOCK PLANS FAILED TO LOAD: ${url}` };
      case 'unreadable': return { refusal: 'STOCK PLANS UNREADABLE: not plan data' };
      default: break;
    }
    if (!Object.hasOwn(e.data, name)) {
      return { refusal: `NO STOCK PLAN "${name}": ${Object.keys(e.data).join(', ')}`.toUpperCase() };
    }
    return { plan: e.data[name] };
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
  reach(parts, pipes, ok) {
    const out = new Map();
    for (const p of pipes) (out.get(p.from) || out.set(p.from, []).get(p.from)).push(p);
    const seen = new Set();
    const lit = new Set();
    const queue = parts.filter((p) => p.source && ok(p.id)).map((p) => p.id);
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

  refuse(words) {
    // A refusal, never an empty frame. The box grows to hold the words.
    this.setAttribute('data-ov-refusal', 'unknown');
    const w = Math.max(200, Math.ceil(words.length * 7.6) + 24);
    this.svg.setAttribute('viewBox', `0 0 ${w} 60`);
    this.svg.innerHTML = `<text class="ov-schematic__void" x="${w / 2}" y="34" text-anchor="middle">${schematicText(words)}</text>`;
    this.svg.setAttribute('aria-label', `Schematic, no reading: ${words.toLowerCase()}`);
    this.readout.textContent = '';
  }

  paint() {
    if (!this.svg) return;
    this.removeAttribute('data-ov-refusal');
    const { plan: P, refusal } = this.resolve();
    if (refusal || !isPlan(P)) {
      this.refuse(refusal || 'NO PLAN');
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

    // The outline claims nothing: no state, no hatch, not counted.
    for (const d of Array.isArray(P.outline) ? P.outline : []) {
      g += `<path class="ov-schematic__hull" d="${schematicText(d)}"/>`;
    }

    const count = { fresh: 0, stale: 0, none: 0 };
    const tag = (t) => (t.tier === 'none' ? 'XX' : t.tier === 'stale' ? `STALE ${Math.round(t.r.age)}s` : '');

    for (const room of rooms) {
      const t = this.tier(room.id);
      count[t.tier] += 1;
      const state = t.tier === 'none' ? 'none' : (ROOM_STATES.has(t.r.state) ? t.r.state : 'caution');
      const note = t.r && t.r.note ? t.r.note : '';
      // ⚠️ An inline STYLE, not a fill attribute: a CSS rule beats an SVG
      // presentation attribute, and `.ov-schematic__room rect` sets a fill,
      // so the hatch as an attribute was never painted. The first test only
      // checked the attribute existed and passed on an invisible hatch.
      const hatch = t.tier === 'none' ? ` style="fill:url(#${this.hatch})"` : '';
      let lx = room.x + 6, ly = room.y + 14, anchor = 'start';
      let shape = `<rect x="${room.x}" y="${room.y}" width="${room.w}" height="${room.h}"${hatch}/>`;
      if (typeof room.d === 'string') {
        shape = `<path d="${schematicText(room.d)}"${hatch}/>`;
        const first = /(\d*\.?\d+)[\s,]+(\d*\.?\d+)/.exec(room.d);
        lx = first ? Number(first[1]) + 6 : 6;
        ly = first ? Number(first[2]) + 14 : 14;
      }
      if (finite(room.lx, room.ly)) { lx = room.lx; ly = room.ly; }
      if (ANCHORS.has(room.anchor)) anchor = room.anchor;
      const lead = Array.isArray(room.lead) && room.lead.length === 4 && finite(...room.lead)
        ? `<line class="ov-schematic__lead" x1="${room.lead[0]}" y1="${room.lead[1]}" x2="${room.lead[2]}" y2="${room.lead[3]}"/>` : '';
      g += `<g class="ov-schematic__room is-${state} is-${t.tier}">`
        + shape + lead
        + `<text x="${lx}" y="${ly}" text-anchor="${anchor}" class="ov-schematic__label">${schematicText(room.label || room.id)}</text>`
        + ((note || tag(t)) ? `<text x="${lx}" y="${ly + 14}" text-anchor="${anchor}" class="ov-schematic__note">${schematicText([note, tag(t)].filter(Boolean).join(' · '))}</text>` : '')
        + `</g>`;
    }

    // Flow. Known: fresh and passing. Possible: anything not known to block.
    const partTier = new Map(parts.map((p) => [p.id, this.tier(p.id)]));
    const known = (id) => { const t = partTier.get(id); return !!t && t.tier === 'fresh' && PASSES.has(t.r.state); };
    const possible = (id) => { const t = partTier.get(id); return !t || t.tier !== 'fresh' || PASSES.has(t.r.state); };
    const flowing = this.reach(parts, pipes, known);
    const maybe = this.reach(parts, pipes, possible);
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

    if (typeof P.orient === 'string' && P.orient) {
      g += `<text x="6" y="${H - 5}" class="ov-schematic__orient">${schematicText(P.orient)}</text>`;
    }
    this.svg.innerHTML = g;

    const ids = new Set([...rooms, ...parts].map((x) => x.id));
    const stray = [...this.byId.keys()].filter((id) => !ids.has(id));
    const total = rooms.length + parts.length;
    const words = [`${count.fresh} of ${total} reporting`];
    if (count.stale) words.push(`${count.stale} stale`);
    if (count.none) words.push(`${count.none} no report`);
    const flowWords = pipes.length
      ? `flow determined on ${nFlow + nDry} of ${pipes.length} pipes` + (nOpen ? `, ${nOpen} undetermined` : '')
      : '';
    const strayWords = stray.length
      ? `${stray.length} ${stray.length === 1 ? 'report names' : 'reports name'} no part of this plan: ${stray.join(', ')}`
      : '';
    this.readout.innerHTML = `<span${count.none || count.stale ? ' class="is-doubt"' : ''}>${words.join(', ')}</span>`
      + (flowWords ? `<span${nOpen ? ' class="is-doubt"' : ''}>${flowWords}</span>` : '')
      + (strayWords ? `<span class="is-doubt ov-schematic__stray">${schematicText(strayWords)}</span>` : '');
    this.svg.setAttribute('aria-label', `Schematic, ${words.join(', ')}${flowWords ? `; ${flowWords}` : ''}${strayWords ? `; ${strayWords}` : ''}`);
  }
}

define('ov-schematic', OvSchematic);

export { OvSchematic };
