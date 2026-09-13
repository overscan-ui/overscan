/* <ov-window> - a draggable, resizable window.
 *
 * Two things about windows that this obeys:
 *
 * 1. TWO LIBRARIES CANNOT BOTH OWN THE WINDOW. Keep the one whose job is
 *    invisible and drop the one whose job is visible. So this brings behaviour
 *    only: the chrome is the kit's own panel, styled by tokens like everything
 *    else, and there is no second opinion about what a window looks like.
 *
 * 2. THEN WIRE THE RESIZE BUS YOURSELF, BECAUSE NOBODY SHIPS IT. A window that
 *    changes size has to tell its contents, and Tabulator throws
 *    if redraw() runs before the table is built. So this dispatches `ov:resize`
 *    on its content, and only after a frame, so a child that is still building
 *    is not asked to redraw into a box it has not measured yet.
 *
 * Keyboard operable throughout: a window you can only move with a pointer is a
 * window half the people cannot move.
 *
 * ── Snapping ─────────────────────────────────────────────────────────────
 *
 * 🔴 SNAPPING PUTS THE WINDOW SOMEWHERE OTHER THAN WHERE YOU DRAGGED IT, so by
 * this kit's own standard it is an invention unless it is visible. Every snap
 * therefore draws the guide it snapped to and stamps `data-ov-snapped` with
 * what it caught. A window that silently moves 6px is a window lying about
 * where you put it, however helpfully.
 *
 * ⭐ And it snaps to things that MEAN something: the container's edges, and
 * the edges of sibling windows. Aligning to another window's edge is a real
 * relationship between two objects. A bare pixel grid is not, which is why
 * `snap="12"` exists but is not the default.
 */

import { define } from './ov-core.js';

let topZ = 10;

class OvWindow extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.x = Number(this.getAttribute('x') || 40);
    this.y = Number(this.getAttribute('y') || 40);
    this.w = Number(this.getAttribute('w') || 320);
    this.h = Number(this.getAttribute('h') || 220);
    this.build();
    this.place();
    this.raise();
  }

  build() {
    const body = document.createElement('div');
    body.className = 'ov-window__body';
    while (this.firstChild) body.append(this.firstChild);

    const bar = document.createElement('div');
    bar.className = 'ov-window__bar';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'button');
    bar.setAttribute('aria-label',
      `${this.getAttribute('title') || 'window'}, move with arrow keys, `
      + 'resize with shift and arrow keys');
    bar.textContent = this.getAttribute('title') || 'window';

    const grip = document.createElement('div');
    grip.className = 'ov-window__grip';
    grip.setAttribute('aria-hidden', 'true');

    this.append(bar, body, grip);
    this.bar = bar;
    this.body = body;

    this.drag(bar, (dx, dy) => {
      this.x += dx;
      this.y += dy;
      this.applySnap();
      this.place();
    }, () => this.clearGuides());
    this.drag(grip, (dx, dy) => {
      this.w = Math.max(160, this.w + dx);
      this.h = Math.max(90, this.h + dy);
      this.place(true);
    });

    this.addEventListener('pointerdown', () => this.raise());
    bar.addEventListener('focus', () => this.raise());

    bar.addEventListener('keydown', (e) => {
      // With a grid, the keyboard steps BY that grid, so pointer and keyboard
      // land a window in exactly the same places. Alt is the fine step, and it
      // deliberately ignores the grid: an override has to actually override.
      const step = e.altKey ? 1 : (this.grid || 12);
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      if (e.shiftKey) {
        this.w = Math.max(160, this.w + d[0] * step);
        this.h = Math.max(90, this.h + d[1] * step);
        this.place(true);
      } else {
        this.x += d[0] * step;
        this.y += d[1] * step;
        if (!e.altKey) this.applySnap();
        this.place();
      }
    });

    // A child that mounts later still needs the box. One frame, then tell it.
    requestAnimationFrame(() => this.announce());
  }

  drag(handle, move, done) {
    let last = null;
    handle.addEventListener('pointerdown', (e) => {
      // Guarded: an unguarded capture throws on a pointer id it has no entry
      // for and aborts the gesture before it is recorded.
      try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      last = [e.clientX, e.clientY];
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!last) return;
      move(e.clientX - last[0], e.clientY - last[1]);
      last = [e.clientX, e.clientY];
    });
    const stop = (e) => {
      last = null;
      if (done) done();
      try { handle.releasePointerCapture(e.pointerId); } catch { /* never held */ }
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  /* Grid size in px, or 0 for off. `snap="edges"` means align only. */
  get grid() {
    const raw = (this.getAttribute('snap') || '').trim();
    if (!raw || raw === 'off') return 0;
    if (raw === 'edges') return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 1 ? n : 0;
  }

  get snapping() {
    const raw = (this.getAttribute('snap') || '').trim();
    return !!raw && raw !== 'off';
  }

  /* Candidate lines to align to, in the coordinate space this window is
   * positioned in: the container's own edges, and every sibling window's. */
  targets() {
    const host = this.offsetParent || this.parentElement;
    if (!host) return { x: [], y: [] };
    const hb = host.getBoundingClientRect();
    const x = [0, hb.width];
    const y = [0, hb.height];
    for (const other of host.querySelectorAll('ov-window')) {
      if (other === this || !other.isConnected) continue;
      x.push(other.x, other.x + other.w);
      y.push(other.y, other.y + other.h);
    }
    return { x, y };
  }

  /* Snap one axis. Returns [value, lineOrNull]. The threshold is in px and
   * deliberately small: a snap you did not ask for at 20px away is the
   * window deciding where it would rather be. */
  nearest(value, extent, lines, threshold) {
    let best = null, bestD = threshold + 1;
    for (const line of lines) {
      for (const [edge, offset] of [[value, 0], [value + extent, extent]]) {
        const d = Math.abs(edge - line);
        if (d < bestD) { bestD = d; best = [line - offset, line]; }
      }
    }
    return best || [value, null];
  }

  applySnap() {
    if (!this.snapping) { this.clearGuides(); return; }
    const g = this.grid;
    if (g) {
      this.x = Math.round(this.x / g) * g;
      this.y = Math.round(this.y / g) * g;
    }
    const { x: xs, y: ys } = this.targets();
    const [nx, lx] = this.nearest(this.x, this.w, xs, 7);
    const [ny, ly] = this.nearest(this.y, this.h, ys, 7);
    this.x = nx;
    this.y = ny;
    const caught = [lx !== null && 'x', ly !== null && 'y'].filter(Boolean);
    if (caught.length) this.setAttribute('data-ov-snapped', caught.join(' '));
    else if (g) this.setAttribute('data-ov-snapped', 'grid');
    else this.removeAttribute('data-ov-snapped');
    this.showGuides(lx, ly);
  }

  /* The guide is drawn because the snap moved the window. See the header. */
  showGuides(lx, ly) {
    const host = this.offsetParent || this.parentElement;
    if (!host) return;
    if (!this.guides) {
      this.guides = ['x', 'y'].map((axis) => {
        const el = document.createElement('div');
        el.className = `ov-snapguide ov-snapguide--${axis}`;
        el.setAttribute('aria-hidden', 'true');
        host.appendChild(el);
        return el;
      });
    }
    const [gx, gy] = this.guides;
    gx.style.display = lx === null ? 'none' : 'block';
    if (lx !== null) gx.style.transform = `translateX(${Math.round(lx)}px)`;
    gy.style.display = ly === null ? 'none' : 'block';
    if (ly !== null) gy.style.transform = `translateY(${Math.round(ly)}px)`;
  }

  clearGuides() {
    if (!this.guides) return;
    for (const g of this.guides) g.style.display = 'none';
  }

  place(resized) {
    this.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
    this.style.inlineSize = `${Math.round(this.w)}px`;
    this.style.blockSize = `${Math.round(this.h)}px`;
    if (resized) this.announce();
  }

  /* The bus nobody ships. Bubbles from the content, not the host, so a child
   * listens to its own subtree rather than to the window it happens to be in. */
  announce() {
    if (!this.body) return;
    const box = this.body.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    for (const el of this.body.querySelectorAll('*')) {
      el.dispatchEvent(new CustomEvent('ov:resize', {
        detail: { width: box.width, height: box.height },
      }));
    }
  }

  raise() { this.style.zIndex = String(++topZ); }
}

define('ov-window', OvWindow);

export { OvWindow };
