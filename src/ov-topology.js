/* <ov-topology> - hosts and the path to them, and nothing past a break.
 *
 * A network map where each host's state is DERIVED FROM THE
 * PATH TO IT, not only from its own last report. ov-graph is an editor and
 * ov-schematic is flow through compartments; neither knows that a host behind
 * a failed router cannot be asked anything.
 *
 * ⭐ THE REFUSAL: BEHIND A BREAK IS UNREACHABLE, NOT DOWN. A host every one of
 * whose parents is down or unreachable is UNREACHABLE: its state is
 * undetermined, because no poll can get to it. It is not drawn DOWN (that
 * would blame it for its router) and it is not drawn UP from its last report
 * (that report is from before the path broke; it is shown as history, with
 * its age, and not believed). Nagios Core: hosts "beneath Router1 are all in
 * an UNREACHABLE state because Nagios Core can't reach them. Router1 is DOWN
 * and is blocking the path."
 *
 * And AN UNPOLLED HOST OR LINK IS GREY, NOT GREEN. A link is lit only when a
 * poll through it came back: the child answered, over a parent that is up.
 * A host that has never been polled is UNPOLLED, and a report older than
 * `max-age` seconds is marked STALE.
 *
 * Reachability is from ONE VANTAGE, the monitor (named by `vantage`, default
 * MONITOR). A host with no parents is on the monitor's own segment. Several
 * parents are redundant paths: one up parent is enough.
 *
 * Input, as the `topology` property or from `src`:
 *   { nodes: [{ id, label?, parents?: [id, ...], state?: 'up' | 'down', age? }] }
 *   state absent = never polled; age = seconds since its last poll.
 * A parent that is not defined, or a loop of parents, is refused: the map
 * cannot say what is behind what.
 */

import { define } from './ov-core.js';

const topoText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// The monitor's own key: a Symbol, so no host id can ever collide with it.
const TOPO_VANTAGE = Symbol('vantage');
/* An age, never rounded up past what it is: 95 s is 1m35s, not "2m". */
const topoAge = (s) => {
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 600) return `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  return s < 5400 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

class OvTopology extends HTMLElement {
  static observedAttributes = ['src', 'max-age', 'vantage'];

  connectedCallback() {
    this._topology = this._topology || null;
    this.fetchSrc();
    this.paint();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'src') this.fetchSrc(); else this.paint();
  }

  get topology() { return this._topology; }
  set topology(v) { this._topology = v && typeof v === 'object' ? v : null; this.paint(); }

  async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('src') === src) this._topology = data && typeof data === 'object' ? data : null;
    } catch {
      if (this.getAttribute('src') === src) this._topology = null;
    }
    this.paint();
  }

  refuse(text) {
    this.setAttribute('data-ov-refusal', 'unknown');
    this.innerHTML = `<div class="ov-topology__void">${topoText(text)}</div>`;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Topology, ${text.toLowerCase()}`);
  }

  /* id -> { status, reason, blockers } from the vantage outward.
     status: up | down | unreachable | unpolled. */
  derive(nodes, byId) {
    const raw = this.getAttribute('max-age');
    const maxAge = raw === null ? NaN : Number(raw);
    const out = new Map();
    const visit = (n, stack) => {
      if (out.has(n.id)) return out.get(n.id);
      if (stack.has(n.id)) throw new Error(`PARENT LOOP THROUGH ${n.label || n.id}: NOT DRAWN`);
      stack.add(n.id);
      const parents = (n.parents || []).map((p) => byId.get(p));
      const ps = parents.map((p) => visit(p, stack));
      stack.delete(n.id);
      // One parent the monitor can reach, and that answered, is a path.
      const path = !parents.length || ps.some((s) => s.status === 'up');
      const stale = Number.isFinite(maxAge) && maxAge > 0 && Number.isFinite(Number(n.age)) && Number(n.age) > maxAge;
      let r;
      if (!path) {
        // ⭐ Behind a break: undetermined. The last report is history, not a state.
        const blockers = new Set();
        parents.forEach((p, i) => {
          if (ps[i].status === 'down') blockers.add(p.id);
          else for (const b of ps[i].blockers || []) blockers.add(b);
        });
        r = { status: 'unreachable', blockers: [...blockers], last: n.state || null };
      } else if (n.state === 'up' || n.state === 'down') {
        r = { status: n.state, stale };
      } else {
        r = { status: 'unpolled' };
      }
      out.set(n.id, r);
      return r;
    };
    for (const n of nodes) visit(n, new Set());
    return out;
  }

  paint() {
    const T = this._topology;
    this.removeAttribute('data-ov-refusal');
    const nodes = T && Array.isArray(T.nodes) ? T.nodes.filter((n) => n && n.id !== undefined && n.id !== null) : null;
    if (!nodes || !nodes.length) { this.refuse('NO HOSTS'); return; }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    if (byId.size !== nodes.length) { this.refuse('TWO HOSTS SHARE AN ID: NOT DRAWN'); return; }
    for (const n of nodes) {
      for (const p of n.parents || []) {
        if (!byId.has(p)) { this.refuse(`PARENT ${p} OF ${n.label || n.id} IS NOT DEFINED: NOT DRAWN`); return; }
      }
    }
    let S;
    try { S = this.derive(nodes, byId); } catch (e) { this.refuse(e.message); return; }

    // Layers: depth from the vantage, the longest parent chain.
    const depth = new Map();
    const d = (n) => {
      if (depth.has(n.id)) return depth.get(n.id);
      const v = (n.parents || []).length ? 1 + Math.max(...n.parents.map((p) => d(byId.get(p)))) : 1;
      depth.set(n.id, v);
      return v;
    };
    nodes.forEach(d);
    const cols = [];
    for (const n of nodes) (cols[depth.get(n.id)] ||= []).push(n);
    const vantage = this.getAttribute('vantage') || 'MONITOR';
    const BW = 132, BH = 44, GX = 44, GY = 10, PAD = 10;
    /* ⭐ EACH HOST SITS BESIDE ITS PARENTS. Spaced evenly per column, a host
       landed wherever its index put it, and a camera's child sat three rows
       from the camera. Each column after the first is placed at the mean
       height of its parents, sorted by that, then pushed apart where two
       would overlap; the frame grows to fit rather than squeezing. */
    const pos = new Map();
    const x = (col) => PAD + col * (BW + GX);
    const first = cols[1] || [];
    pos.set(TOPO_VANTAGE, [x(0), PAD + ((first.length - 1) * (BH + GY)) / 2]);
    first.forEach((n, i) => pos.set(n.id, [x(1), PAD + i * (BH + GY)]));
    for (let col = 2; col < cols.length; col++) {
      const c = (cols[col] || []).map((n) => ({ n, want: n.parents.reduce((a, p) => a + pos.get(p)[1], 0) / n.parents.length }));
      c.sort((a, b) => a.want - b.want);
      let floor = PAD;
      for (const e of c) { const y = Math.max(e.want, floor); pos.set(e.n.id, [x(col), y]); floor = y + BH + GY; }
    }
    const H = Math.max(...[...pos.values()].map(([, y]) => y)) + BH + PAD;
    const W = PAD * 2 + cols.length * BW + (cols.length - 1) * GX;

    let g = '';
    // Links first, under the boxes. Lit only when a poll came back through it.
    const link = (from, to, lit, cls) => {
      const [ax, ay] = pos.get(from), [bx, by] = pos.get(to);
      const x1 = ax + BW, y1 = ay + BH / 2, x2 = bx, y2 = by + BH / 2, mx = (x1 + x2) / 2;
      return `<path class="ov-topology__link ${cls}${lit ? ' is-lit' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
    };
    for (const n of nodes) {
      const s = S.get(n.id);
      const parents = n.parents && n.parents.length ? n.parents : [TOPO_VANTAGE];
      for (const p of parents) {
        const ps = p === TOPO_VANTAGE ? { status: 'up' } : S.get(p);
        // A DOWN host did not answer, so the last hop to it is not lit either.
        const lit = ps.status === 'up' && s.status === 'up';
        const cls = ps.status === 'unreachable' || s.status === 'unreachable' ? 'is-unreachable'
          : ps.status === 'down' || s.status === 'down' ? 'is-broken' : s.status === 'unpolled' ? 'is-unpolled' : '';
        g += link(p, n.id, lit, cls);
      }
    }
    const box = (id, label, status, sub) => {
      const [x, y] = pos.get(id);
      const word = { up: 'UP', down: 'DOWN', unreachable: 'UNREACHABLE', unpolled: 'UNPOLLED', vantage: 'VANTAGE' }[status];
      return `<g class="ov-topology__host is-${status}" data-id="${topoText(id === TOPO_VANTAGE ? 'vantage' : id)}">`
        + `<rect x="${x}" y="${y}" width="${BW}" height="${BH}"/>`
        + `<text class="ov-topology__label" x="${x + 7}" y="${y + 13}">${topoText(label)}</text>`
        + `<text class="ov-topology__state" x="${x + 7}" y="${y + 25}">${word}</text>`
        + (sub ? `<text class="ov-topology__sub" x="${x + 7}" y="${y + 36}">${topoText(sub)}</text>` : '') + '</g>';
    };
    g += box(TOPO_VANTAGE, vantage, 'vantage', '');
    for (const n of nodes) {
      const s = S.get(n.id);
      let sub = '';
      if (s.status === 'unreachable' && s.last) sub = `last ${s.last}${Number.isFinite(Number(n.age)) ? ` ${topoAge(Number(n.age))} ago` : ''}`;
      else if (s.stale) sub = `STALE ${topoAge(Number(n.age))}`;
      g += box(n.id, n.label || n.id, s.status, sub);
    }

    const count = (k) => nodes.filter((n) => S.get(n.id).status === k).length;
    const up = count('up'), down = count('down'), unr = count('unreachable'), unp = count('unpolled');
    const stale = nodes.filter((n) => S.get(n.id).stale).length;
    const words = [`${nodes.length} hosts from ${vantage}`, `${up} up`];
    if (down) words.push(`${down} down`);
    if (unr) {
      // Name who is blocking the path, and how many are behind each.
      const behind = new Map();
      for (const n of nodes) for (const b of S.get(n.id).blockers || []) behind.set(b, (behind.get(b) || 0) + 1);
      const who = [...behind].map(([b, k]) => `${byId.get(b).label || b} blocking ${k}`).join(', ');
      words.push(`${unr} unreachable, state undetermined${who ? ` (${who})` : ''}`);
    }
    if (unp) words.push(`${unp} unpolled`);
    if (stale) words.push(`${stale} stale`);

    this.innerHTML = `<svg class="ov-topology__svg" viewBox="0 0 ${W} ${H}" style="max-inline-size:${W * 1.25}px" aria-hidden="true">${g}</svg>`
      + `<div class="ov-topology__readout">${words.map((w) => `<span${/down|unreachable|unpolled|stale/.test(w) ? ' class="is-flag"' : ''}>${topoText(w)}</span>`).join('')}</div>`;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Topology, ${words.join(', ')}`);
  }
}

define('ov-topology', OvTopology);

export { OvTopology };
