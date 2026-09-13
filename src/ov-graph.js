/* <ov-graph> - boxes, sockets and curves. "The layout is the program."
 *
 * 🔴 THIS IS THE ONE SURFACE WHERE THE PROTOCOL RUNS BACKWARDS.
 *
 * Every other instrument in this kit is handed a value and decides whether it
 * can honestly draw it. A node graph is the surface where the USER authors the
 * data, so the same principle points the other way: the graph refuses to make a
 * connection that would not mean anything, rather than refusing to draw a
 * number it was not given.
 *
 * The failure to avoid is the inventing readout's. A socket that accepts
 * anything
 * is a seven-segment display that renders 1.5 as 15: the wiring succeeds, the
 * graph looks correct, and the result is plausible and wrong. So there is no
 * `any` type here, deliberately, and no rule that lets one appear.
 *
 * REFUSAL.md's two kinds map onto connections without changing shape:
 *
 *   a REFUSAL withholds the connection, because making it would be a lie
 *   a QUALIFIER makes it and says something true about it
 *
 * | reason      | kind      | when                                            |
 * |-------------|-----------|-------------------------------------------------|
 * | `type`      | refusal   | no declared rule carries this type to that one   |
 * | `direction` | refusal   | output to output, or input to input              |
 * | `occupied`  | refusal   | the input already has a link                     |
 * | `cycle`     | refusal   | the link closes a loop, so nothing can evaluate  |
 * | `self`      | refusal   | a node's output into its own input               |
 * | `missing`   | refusal   | the markup names a socket that does not exist    |
 * | `converted` | qualifier | a declared widening ran, so the value is real    |
 * |             |           | and is not the type the reader would assume      |
 *
 * ⭐ AND A NODE REFUSES TOO. A node with an unconnected required input has no
 * value to produce, so it says `unknown` rather than defaulting to zero. A
 * default is the graph inventing the number nobody supplied, which is the
 * thing this kit exists to refuse. Everything downstream of it is `blocked`,
 * because a node fed by a node that has no value has no value either.
 *
 * ⚠️ Curves are cheap to get wrong. A bezier whose control points are a fixed
 * horizontal offset crosses itself the moment the target is to the LEFT of the
 * source, which is most of the interesting cases. See `curve()`.
 *
 * Drawn in the DOM and one SVG overlay, never on a canvas: a
 * canvas is invisible to the cascade, so every kit-wide behaviour would be
 * built a second time for the surface this aesthetic is most identified with.
 */

import { define } from './ov-core.js';
(() => {
  'use strict';

  /* ---- the type rules -------------------------------------------------- *
   *
   * 🔴 There is no `any`, and adding one would delete the whole point. A
   * widening is DECLARED, one pair at a time, with a name for what it does,
   * so a conversion can be reported on the link that performs it.
   *
   * The absent direction is the interesting one: `vector` does not go into
   * `scalar`. Choosing which component to take is a decision the graph is not
   * entitled to make on the author's behalf, which is `disputed` from
   * REFUSAL.md wearing a different hat. If a graph wants that, it wires an
   * explicit node that names the component, and the name is the point. */
  const WIDEN = {
    'scalar>vector': 'broadcast',
    'scalar>signal': 'held',
    'signal>scalar': null,       // written out so the absence is deliberate
    'vector>scalar': null,
    'colour>vector': 'components',
  };

  const rid = (() => { let n = 0; return () => `ovg${++n}`; })();

  /* ⚠️ A FIXED CONTROL OFFSET CROSSES ITSELF GOING BACKWARDS. With
   * `c = 60` always, a link whose target is to the left of its source leaves
   * the output heading right, and enters the input heading right, so the two
   * halves cross somewhere in the middle and the curve reads as a knot rather
   * than a route. That is not cosmetic: the one thing a link has to say is
   * WHICH socket it joins to which, and a crossing curve is ambiguous exactly
   * where two links are near each other.
   *
   * So the offset scales with the horizontal distance, and going backwards it
   * scales with the vertical distance too, INVERSELY: two sockets at the same
   * height have no room to pass between the nodes, so they need the widest
   * bulge, and sockets far apart vertically need almost none. */
  function curve(x1, y1, x2, y2, w) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let c = Math.max(26, Math.abs(dx) * 0.5);
    if (dx < 60) {
      c = Math.max(70, Math.abs(dx) * 0.75) + 110 / (1 + Math.abs(dy) / 70);
    }
    /* ⚠️ AND THE BULGE HAS TO STAY ON THE SURFACE. The rule above is right
     * about the shape and says nothing about the frame, so a backwards link
     * between two nodes near the left edge threw its control point off the
     * canvas and `overflow: hidden` cut the wire in half. A wire that leaves
     * the picture is worse than one that crosses itself: a crossing is
     * ambiguous, a missing half is simply not there.
     *
     * 🔴 THE FIRST CLAMP WAS ONE NUMBER FOR BOTH ENDS, AND IT FLATTENED
     * EVERY BACKWARDS CURVE INTO A STRAIGHT LINE. Taking the smaller of the
     * two available margins means an input pin near the left edge - where
     * there is no room at all - also collapses the bulge at the OUTPUT end,
     * where there was plenty. The two ends are clamped separately now, so
     * each uses the room it actually has and the curve tightens only at the
     * end that is short of space.
     *
     * ⚠️ And the honest limit, which is geometry rather than a rule: to enter
     * an input from the left the curve must come from further left, so a
     * backwards link into a pin hard against the edge has nowhere to be. It
     * tightens to an S. Nothing can fix that except room. */
    let cOut = c;
    let cIn = c;
    if (w) {
      const lim = 10;
      cOut = Math.max(24, Math.min(c, Math.max(24, w - lim - x1)));
      cIn = Math.max(24, Math.min(c, Math.max(24, x2 - lim)));
    }

    /* 🔴 AND A HORIZONTAL BULGE IS INVISIBLE AT THE ONE ANGLE THAT NEEDS IT
     * MOST. Two sockets at exactly the same height with the target to the
     * left put all four control points on one horizontal line, and a cubic
     * whose points are collinear IS a line: the curve overshoots right, comes
     * back left, and draws every bit of that on top of itself. It reads as a
     * straight rule through both nodes, which is the least informative thing
     * a wire can be.
     *
     * The prose was right and the geometry did not implement it. "The widest
     * bulge where there is least room to pass" has to include a bulge in the
     * direction there is actually room in, so the arch is vertical and its
     * size is inverse to the vertical separation: zero when the sockets are
     * already far apart in y, largest when they are level. */
    let bow = 0;
    if (dx < 0) {
      bow = Math.max(0, 44 - Math.abs(dy) * 0.45);
      // Arch away from the edge that is closer, so the loop stays in frame.
      if (Math.min(y1, y2) > bow + 10) bow = -bow;
    }
    return `M ${x1} ${y1} C ${x1 + cOut} ${y1 + bow}, ${x2 - cIn} ${y2 + bow}, ${x2} ${y2}`;
  }

  /* ---- <ov-socket> ------------------------------------------------------ */

  class OvSocket extends HTMLElement {
    connectedCallback() {
      if (this.dataset.built) return;
      this.dataset.built = '1';
      const dir = this.dir_();
      this.setAttribute('data-dir', dir);
      const name = this.getAttribute('name') || '';
      const type = this.getAttribute('type') || '';
      this.innerHTML =
        `<i class="ov-sock__pin" aria-hidden="true"></i>`
        + `<span class="ov-sock__name">${name}</span>`
        + `<span class="ov-sock__type">${type}</span>`;
      this.tabIndex = 0;
      this.setAttribute('role', 'button');
      this.label();
    }

    dir_() { return this.getAttribute('dir') === 'out' ? 'out' : 'in'; }
    get key() {
      const n = this.closest('ov-node');
      return `${n ? n.id : '?'}.${this.getAttribute('name')}`;
    }

    /* The accessible name says what the socket IS and what it currently
     * carries, because a pin with no name is the same failure as a readout
     * with no reason. */
    label(extra) {
      const req = this.hasAttribute('required') ? ', required' : '';
      const parts = [`${this.getAttribute('name')}, ${this.dir_() === 'out' ? 'output' : 'input'}`,
        this.getAttribute('type') + req];
      if (extra) parts.push(extra);
      this.setAttribute('aria-label', parts.join(', '));
    }
  }

  /* ---- <ov-node> -------------------------------------------------------- */

  class OvNode extends HTMLElement {
    connectedCallback() {
      if (!this.id) this.id = rid();
      if (this.dataset.built) return;
      this.dataset.built = '1';
      const head = document.createElement('header');
      head.className = 'ov-node__head';
      head.innerHTML = `<span class="ov-node__step" aria-hidden="true"></span>`
        + `<span class="ov-node__label">${this.getAttribute('label') || this.id}</span>`
        + `<span class="ov-node__state" aria-hidden="true"></span>`;
      this.prepend(head);
      this.place();
    }

    place() {
      this.style.setProperty('--ov-node-x', `${Number(this.getAttribute('x') || 0)}px`);
      this.style.setProperty('--ov-node-y', `${Number(this.getAttribute('y') || 0)}px`);
    }

    sockets(dir) {
      return [...this.querySelectorAll('ov-socket')]
        .filter((s) => (dir ? s.dir_() === dir : true));
    }
  }

  /* ---- <ov-link> -------------------------------------------------------- *
   * Declared in markup as well as drawn by hand, and validated identically.
   * 🔴 A declared link that is invalid is NOT quietly dropped. It is drawn in
   * the refusal style with its reason on it, because deleting an author's
   * mistake is the same class of help as closing a gap in a chart. */

  class OvLink extends HTMLElement {
    connectedCallback() {
      /* 🔴 NOT `hidden`. A link is drawn as a curve in an SVG that is itself
       * aria-hidden, so `hidden` here took every connection out of the
       * accessibility tree - including the REFUSED ones, whose whole purpose
       * is to say why. The kit's own audit caught it: five refusals on this
       * page carrying a reason that nothing could read. So a link is visually
       * hidden and present, and the graph reads back as a list of its own
       * connections with each verdict on it, which is a thing a node editor
       * almost never offers. */
      this.classList.add('ov-link');
      const g = this.closest('ov-graph');
      /* 🔴 A CHILD CUSTOM ELEMENT CAN UPGRADE BEFORE ITS PARENT, and this file
       * guaranteed it: `customElements.define` upgrades every matching element
       * already in the document the moment it is called, so defining `ov-link`
       * before `ov-graph` meant every link ran this line while its graph was
       * still an unknown element with no methods on it. It threw once per link
       * - thirty-nine times on demo/graph.html - from the day the file was
       * written, and nothing noticed because the first real paint is scheduled
       * later by something else, so the picture came out right anyway.
       * The defines below are now parent-first, and `upgrade()` makes it true
       * even for a graph built detached and inserted afterwards. */
      if (g) {
        customElements.upgrade(g);
        g.schedule();
      }
    }
    disconnectedCallback() {
      const g = this.ownerGraph;
      if (g) g.schedule();
    }
  }

  /* ---- <ov-graph> ------------------------------------------------------- */

  class OvGraph extends HTMLElement {
    connectedCallback() {
      if (!this.svg) {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'ov-graph__wires');
        this.svg.setAttribute('aria-hidden', 'true');
        this.prepend(this.svg);

        /* ⚠️ A SECOND LAYER, AND IT IS NOT DECORATION. The wires sit UNDER
         * the nodes so a curve crossing a box cannot steal a socket's click,
         * which is right - and it also put every wire's label under the node
         * it crossed, so a conversion the graph had gone to the trouble of
         * naming was hidden by the very node it was naming it for. The notes
         * go over the top, knocked out against the field, and take no pointer
         * events so the ordering costs nothing. */
        this.notes = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.notes.setAttribute('class', 'ov-graph__notes');
        this.notes.setAttribute('aria-hidden', 'true');
        this.append(this.notes);

        this.say = document.createElement('p');
        this.say.className = 'ov-graph__say';
        this.say.setAttribute('role', 'status');
        this.say.setAttribute('aria-live', 'polite');
        this.append(this.say);
      }
      this.pending = null;
      this.wire();
      this.schedule();
      this.ro = new ResizeObserver(() => this.schedule());
      this.ro.observe(this);
      this.addEventListener('ov:resize', () => this.schedule());
    }
    disconnectedCallback() { if (this.ro) this.ro.disconnect(); }

    /* ---- model ---------------------------------------------------------- */

    socket(key) {
      const [nodeId, name] = String(key).split('.');
      const node = this.querySelector(`ov-node[id="${nodeId}"]`);
      if (!node) return null;
      return node.querySelector(`ov-socket[name="${name}"]`) || null;
    }

    get links() { return [...this.querySelectorAll('ov-link')]; }

    /* The one place a connection is judged. Everything - markup on load, a
     * pointer drag, a keyboard link - goes through this, so there is no path
     * where a connection is made by a route that checks less. */
    /* `accepted` is the set of connections that already exist, as
     * {from, to} socket pairs. Passing it explicitly rather than reading the
     * DOM is what makes the answer depend on the graph rather than on which
     * link happened to be examined first.
     *
     * 🔴 THE RULE IS DECLARATION ORDER, AND IT HAD TO BE MADE ONE. The first
     * version judged each link against every other link's LAST-PASS verdict,
     * so in a two-link cycle the FIRST link was refused and the second stood:
     * exactly backwards, and an artifact of iteration order rather than
     * anything the graph meant. Links are now judged in document order against
     * the set accepted so far, so the connection that arrives later is the one
     * refused, which is both stable and the answer an author expects. */
    judge(from, to, accepted) {
      const set = accepted || this.accepted();
      if (!from || !to) return { reason: 'missing' };
      if (from.dir_() !== 'out' || to.dir_() !== 'in') return { reason: 'direction' };
      const fn = from.closest('ov-node');
      const tn = to.closest('ov-node');
      if (fn === tn) return { reason: 'self' };

      /* ⭐ ORDER MATTERS, AND IT IS NOT ARBITRARY. A connection can fail two
       * ways at once, and the reason worth reporting is the one that would
       * still apply after you cleared the other. A wrongly typed link into an
       * occupied input reported `occupied` first, which sends the author off
       * to disconnect something that was never the problem. So the type is
       * judged before the traffic. */
      const ft = from.getAttribute('type');
      const tt = to.getAttribute('type');
      let widened = null;
      if (ft !== tt) {
        const how = WIDEN[`${ft}>${tt}`];
        if (!how) return { reason: 'type' };
        // Real connection, real value, and not the type a reader would assume
        // from the socket it arrived at. So it is a qualifier, not a pass.
        widened = how;
      }

      // An input carries one link. A second one REPLACING the first silently
      // is the graph choosing which of two sources the reader meant, which is
      // not its choice to make.
      if (set.some((e) => e.to === to)) return { reason: 'occupied' };

      if (this.wouldCycle(fn, tn, set)) return { reason: 'cycle' };
      return widened ? { qualifier: 'converted', as: widened } : { ok: true };
    }

    /* Every connection that currently stands, as socket pairs. */
    accepted() {
      const out = [];
      for (const l of this.links) {
        if (l.hasAttribute('data-ov-refusal')) continue;
        const a = this.socket(l.getAttribute('from'));
        const b = this.socket(l.getAttribute('to'));
        if (a && b) out.push({ from: a, to: b, el: l });
      }
      return out;
    }

    /* Depth first from the target back to the source over accepted links. */
    wouldCycle(fromNode, toNode, set) {
      const edges = new Map();
      for (const e of set) {
        const an = e.from.closest('ov-node');
        const bn = e.to.closest('ov-node');
        if (!edges.has(an)) edges.set(an, new Set());
        edges.get(an).add(bn);
      }
      const seen = new Set();
      const walk = (n) => {
        if (n === fromNode) return true;
        if (seen.has(n)) return false;
        seen.add(n);
        for (const nx of (edges.get(n) || [])) if (walk(nx)) return true;
        return false;
      };
      return walk(toNode);
    }

    /* ---- evaluation order ------------------------------------------------ *
     * The claim "the layout is the program" is only true if the layout
     * produces one. So the graph computes the order it would evaluate in and
     * numbers every node with its step, and a node that cannot be evaluated
     * says which of the two reasons it is: it has no value of its own, or it
     * is downstream of something that has none. */
    evaluate() {
      const nodes = [...this.querySelectorAll('ov-node')];
      const incoming = new Map(nodes.map((n) => [n, []]));
      const outgoing = new Map(nodes.map((n) => [n, []]));
      const filled = new Set();

      for (const e of this.accepted()) {
        filled.add(e.to);
        const an = e.from.closest('ov-node');
        const bn = e.to.closest('ov-node');
        incoming.get(bn).push(an);
        outgoing.get(an).push(bn);
      }

      // A required input with no link means the node has nothing to produce.
      // 🔴 It does NOT get a default. A default is the graph inventing the
      // number nobody supplied.
      const state = new Map();
      for (const n of nodes) {
        const missing = n.sockets('in')
          .filter((s) => s.hasAttribute('required') && !filled.has(s));
        state.set(n, missing.length ? 'unknown' : 'ok');
        n.dataset.missingCount = missing.length;
      }

      // Kahn, over the nodes that are in a DAG at all.
      const deg = new Map(nodes.map((n) => [n, incoming.get(n).length]));
      const queue = nodes.filter((n) => deg.get(n) === 0);
      const order = [];
      while (queue.length) {
        const n = queue.shift();
        order.push(n);
        for (const m of outgoing.get(n)) {
          deg.set(m, deg.get(m) - 1);
          if (deg.get(m) === 0) queue.push(m);
        }
      }
      const inCycle = new Set(nodes.filter((n) => !order.includes(n)));

      // Blocked propagates forward: a node fed by a node with no value has no
      // value either, and saying so is different from saying it is broken.
      for (const n of order) {
        if (state.get(n) === 'ok'
            && incoming.get(n).some((p) => state.get(p) !== 'ok')) {
          state.set(n, 'blocked');
        }
      }

      let step = 0;
      for (const n of nodes) {
        const st = inCycle.has(n) ? 'cycle' : state.get(n);
        n.setAttribute('data-ov-state', st);
        const head = n.querySelector('.ov-node__head');
        const stepEl = head && head.querySelector('.ov-node__step');
        const stateEl = head && head.querySelector('.ov-node__state');
        const idx = order.indexOf(n);
        if (stepEl) stepEl.textContent = idx < 0 ? '--' : String(idx + 1).padStart(2, '0');
        if (stateEl) {
          stateEl.textContent = st === 'ok' ? '' : st;
        }
        const why = {
          unknown: `no value: ${n.dataset.missingCount} required input`
            + `${n.dataset.missingCount === '1' ? '' : 's'} not connected`,
          blocked: 'no value: upstream has none',
          cycle: 'not evaluable: this node is in a loop',
          ok: `evaluates at step ${idx + 1}`,
        }[st];
        n.setAttribute('aria-label', `${n.getAttribute('label') || n.id}, ${why}`);
        if (st === 'ok') step++;
      }
      return { order, inCycle, evaluable: step, total: nodes.length };
    }

    /* ---- drawing --------------------------------------------------------- */

    schedule() {
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => { this.queued = false; this.draw(); });
    }

    pinAt(sock) {
      const pin = sock.querySelector('.ov-sock__pin') || sock;
      const r = pin.getBoundingClientRect();
      const g = this.getBoundingClientRect();
      return { x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2 };
    }

    draw() {
      const g = this.getBoundingClientRect();
      for (const layer of [this.svg, this.notes]) {
        layer.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
        layer.setAttribute('width', g.width);
        layer.setAttribute('height', g.height);
      }

      // Judged in document order against what has been accepted so far, so
      // the verdict depends on the graph and not on iteration order.
      const accepted = [];
      for (const l of this.links) {
        const from = this.socket(l.getAttribute('from'));
        const to = this.socket(l.getAttribute('to'));
        const v = this.judge(from, to, accepted);
        l.removeAttribute('data-ov-refusal');
        l.removeAttribute('data-ov-qualified');
        if (v.reason) l.setAttribute('data-ov-refusal', v.reason);
        else {
          if (v.qualifier) l.setAttribute('data-ov-qualified', v.as);
          accepted.push({ from, to, el: l });
        }
      }
      const report = this.evaluate();

      let svg = '';
      const pending = [];
      let wireIndex = 0;
      for (const l of this.links) {
        const from = this.socket(l.getAttribute('from'));
        const to = this.socket(l.getAttribute('to'));
        const refusal = l.getAttribute('data-ov-refusal');
        const conv = l.getAttribute('data-ov-qualified');
        const says = `${l.getAttribute('from')} to ${l.getAttribute('to')}`;
        if (!from || !to) {
          // Nothing to draw between, so the reason is printed where the link
          // was declared rather than vanishing with it.
          l.className = 'ov-link ov-link--orphan';
          l.textContent = `link ${says}: ${refusal || 'missing'}`;
          l.setAttribute('aria-label', l.textContent);
          continue;
        }
        l.className = 'ov-link';
        // Readable, whatever the verdict was. A connection that stands says
        // so; one that was refused says why.
        l.textContent = refusal
          ? `link ${says}: refused, ${refusal}`
          : conv ? `link ${says}: connected, converted by ${conv}`
            : `link ${says}: connected`;
        l.setAttribute('aria-label', l.textContent);
        const a = this.pinAt(from);
        const b = this.pinAt(to);
        const cls = ['ov-wire'];
        if (refusal) cls.push('ov-wire--refused');
        if (conv) cls.push('ov-wire--converted');
        svg += `<path class="${cls.join(' ')}" d="${curve(a.x, a.y, b.x, b.y, g.width)}"/>`;
        // ⚠️ Deferred, because the midpoint of the STRAIGHT LINE between two
        // pins is not on the wire. On a bulging backwards curve it lands
        // wherever the chord happens to fall, which put a conversion's name
        // on top of an unrelated node's header, where it read as a label for
        // that node. The real midpoint has to be measured off the path, so
        // the note is placed after the paths exist.
        if (refusal || conv) {
          pending.push({ index: wireIndex, text: refusal || conv, refused: !!refusal });
        }
        wireIndex++;
      }

      if (this.pending && this.pending.at) {
        const a = this.pinAt(this.pending.socket);
        const b = this.pending.at;
        svg += `<path class="ov-wire ov-wire--pending" d="${curve(a.x, a.y, b.x, b.y, g.width)}"/>`;
      }
      this.svg.innerHTML = svg;

      // Now the paths exist, so a note can be put where its wire actually is.
      const paths = this.svg.querySelectorAll('path');
      let notes = '';
      for (const n of pending) {
        const path = paths[n.index];
        if (!path) continue;
        let pt;
        try {
          pt = path.getPointAtLength(path.getTotalLength() / 2);
        } catch (e) {
          continue;   // a degenerate path has no length to take a half of
        }
        notes += `<text class="ov-wire__note${n.refused ? ' ov-wire__note--refused' : ''}" `
          + `x="${pt.x.toFixed(1)}" y="${(pt.y - 6).toFixed(1)}">${n.text}</text>`;
      }
      this.notes.innerHTML = notes;

      this.setAttribute('data-ov-evaluable', `${report.evaluable} of ${report.total}`);
      return report;
    }

    /* ---- interaction ------------------------------------------------------ */

    wire() {
      if (this.wired) return;
      this.wired = true;

      this.addEventListener('pointerdown', (e) => {
        const sock = e.target.closest('ov-socket');
        if (sock) { this.startLink(sock, e); return; }
        const head = e.target.closest('.ov-node__head');
        if (head) this.startDrag(head.closest('ov-node'), e);
      });

      this.addEventListener('keydown', (e) => {
        const sock = e.target.closest && e.target.closest('ov-socket');
        if (e.key === 'Escape' && this.pending) { this.cancel(); e.preventDefault(); return; }
        if (!sock || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        if (!this.pending) { this.arm(sock); return; }
        this.complete(sock);
      });
    }

    /* ⭐ Before the drop, not after. Every socket that would refuse this
     * connection says so while the link is still in the air, which is the
     * difference between an instrument that reports and one that scolds. */
    arm(sock) {
      this.pending = { socket: sock, at: null };
      this.setAttribute('data-ov-linking', '');
      for (const s of this.querySelectorAll('ov-socket')) {
        if (s === sock) continue;
        const v = sock.dir_() === 'out' ? this.judge(sock, s) : this.judge(s, sock);
        s.removeAttribute('data-ov-would');
        if (v.reason) s.setAttribute('data-ov-would', v.reason);
        else if (v.qualifier) s.setAttribute('data-ov-would', v.as);
        else s.setAttribute('data-ov-would', 'ok');
        s.label(v.reason ? `would refuse: ${v.reason}`
          : v.qualifier ? `would connect, converted by ${v.as}` : 'would connect');
      }
      this.announce(`linking from ${sock.key}. `
        + `${this.querySelectorAll('ov-socket[data-ov-would="ok"]').length} sockets accept it.`);
    }

    /* ⚠️ `quiet` is not a convenience. Tearing down the pending link used to
     * announce "link cancelled" unconditionally, which overwrote the message
     * the caller had just posted - including the refusal reason, which is the
     * entire feature. The gesture ending and the reason it ended are two
     * different things to say, and only one of them is worth hearing. */
    cancel(quiet) {
      this.pending = null;
      this.removeAttribute('data-ov-linking');
      for (const s of this.querySelectorAll('ov-socket')) {
        s.removeAttribute('data-ov-would');
        s.label();
      }
      if (!quiet) this.announce('link cancelled');
      this.schedule();
    }

    complete(target) {
      const p = this.pending;
      if (!p) return;
      const from = p.socket.dir_() === 'out' ? p.socket : target;
      const to = p.socket.dir_() === 'out' ? target : p.socket;
      const v = this.judge(from, to);
      if (v.reason) {
        // 🔴 THE REFUSAL IS THE FEATURE. No link is created, and the reason is
        // stated rather than the gesture simply not working, which is how
        // every node editor in this genre fails: the wire falls on the floor
        // and the user is left to guess what was wrong with it.
        this.cancel(true);
        this.setAttribute('data-ov-last-refusal', v.reason);
        this.announce(`refused: ${v.reason} - `
          + `${from ? from.key : '?'} to ${to ? to.key : '?'}`);
        return;
      }
      const l = document.createElement('ov-link');
      l.setAttribute('from', from.key);
      l.setAttribute('to', to.key);
      this.appendChild(l);
      this.removeAttribute('data-ov-last-refusal');
      this.cancel(true);
      this.announce(v.qualifier
        ? `connected ${from.key} to ${to.key}, converted by ${v.as}`
        : `connected ${from.key} to ${to.key}`);
    }

    startLink(sock, e) {
      e.preventDefault();
      this.arm(sock);
      const move = (ev) => {
        const g = this.getBoundingClientRect();
        this.pending.at = { x: ev.clientX - g.left, y: ev.clientY - g.top };
        this.schedule();
      };
      const up = (ev) => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = el && el.closest && el.closest('ov-socket');
        if (target && target !== sock) this.complete(target);
        else this.cancel();
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    }

    startDrag(node, e) {
      e.preventDefault();
      const g = this.getBoundingClientRect();
      const x0 = Number(node.getAttribute('x') || 0);
      const y0 = Number(node.getAttribute('y') || 0);
      const px = e.clientX;
      const py = e.clientY;
      const move = (ev) => {
        node.setAttribute('x', Math.max(0, Math.min(g.width - 60, x0 + ev.clientX - px)));
        node.setAttribute('y', Math.max(0, Math.min(g.height - 30, y0 + ev.clientY - py)));
        node.place();
        this.schedule();
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    }

    announce(text) { if (this.say) this.say.textContent = text; }
  }

  window.OverscanGraph = { WIDEN, curve };

  /* ⚠️ PARENT FIRST. See the note in OvLink.connectedCallback: define order is
   * upgrade order, and a child that upgrades first finds a parent that has no
   * methods yet. */
  define('ov-graph', OvGraph);
  define('ov-node', OvNode);
  define('ov-socket', OvSocket);
  define('ov-link', OvLink);
})();
