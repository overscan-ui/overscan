/* <ov-reticle> - target brackets over a scene.
 *
 * The most recognisable thing in the canon and the kit had nothing like it.
 * Three properties, all of them things a detection overlay usually throws away:
 *
 * 1. A LOCK IS ALREADY STALE. The bracket is where the target was at the last
 *    fix, not where it is. Same claim the radar makes, and the age is drawn on
 *    the bracket rather than assumed to be zero.
 * 2. CONFIDENCE IS NOT IDENTITY. A box labelled `VEHICLE` at 0.42 is a guess,
 *    and an overlay that prints the class name without the number has turned a
 *    guess into a fact. The score is always shown, and a detection with no
 *    score at all is marked `unscored` rather than treated as certain.
 * 3. A LOST TARGET KEEPS ITS LAST BOX, MARKED. Vanishing says "nothing there",
 *    which is a different claim from "no longer tracking".
 */

import { define, watchSeen, isSeen } from './ov-core.js';
import './ov-source.js';

class OvReticle extends HTMLElement {
  static observedAttributes = ['source', 'hold'];

  connectedCallback() {
    this.tracks = new Map();
    this.bind();
    this.render();
    /* Brackets need the box's aspect ratio. Reading it with
     * getBoundingClientRect() every frame forced a layout per frame per
     * reticle, the costliest script on the home page; the size only
     * changes when the box does, so it is observed instead. Border box, as the
     * old read was. */
    // Once, synchronously, so the first frame is right before the observer
    // has reported (and in a harness that never renders one).
    const box = this.getBoundingClientRect();
    this.aspect = box.width > 0 ? box.height / box.width : 1;
    this.sized = new ResizeObserver(([e]) => {
      const b = e.borderBoxSize?.[0];
      const w = b ? b.inlineSize : e.contentRect.width;
      const h = b ? b.blockSize : e.contentRect.height;
      this.aspect = w > 0 ? h / w : 1;
    });
    this.sized.observe(this);
    this.setAttribute('role', 'img');
    this.unseen = watchSeen(this, this.wake);
    this.frame();
  }

  /* Called by the visibility gate when the element comes back into view. */
  wake = () => { if (!this.raf) this.raf = requestAnimationFrame(this.frame); };

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.unseen) this.unseen();
    if (this.sized) this.sized.disconnect();
    if (this.unsub) this.unsub();
  }

  attributeChangedCallback(n) {
    if (!this.isConnected) return;
    if (n === 'source') this.bind();
  }

  /* How long a bracket is kept after its last fix. */
  get hold() { return Number(this.getAttribute('hold') || 2200); }

  bind() {
    if (this.unsub) this.unsub();
    const name = this.getAttribute('source');
    if (!name || !window.Overscan) return;
    this.unsub = window.Overscan.subscribe(name, (targets) => {
      const now = performance.now();
      for (const t of (Array.isArray(targets) ? targets : [])) {
        if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
        this.tracks.set(t.id, { ...t, at: now });
      }
    });
  }

  render() {
    this.innerHTML =
      `<svg class="ov-reticle__svg" viewBox="0 0 100 100" preserveAspectRatio="none"`
      + ` aria-hidden="true"><g class="ov-reticle__marks"></g></svg>`
      + `<div class="ov-reticle__labels"></div>`;
    this.marks = this.querySelector('.ov-reticle__marks');
    this.labels = this.querySelector('.ov-reticle__labels');
  }

  frame = () => {
    const now = performance.now();
    let svg = '';
    let html = '';
    let live = 0;
    let lost = 0;
    let unscored = 0;

    for (const [id, t] of this.tracks) {
      const age = now - t.at;
      if (age > this.hold) { this.tracks.delete(id); continue; }
      const stale = age > 300;
      if (stale) lost += 1; else live += 1;

      const w = t.w ?? 14;
      const h = t.h ?? 14;
      const x = t.x - w / 2;
      const y = t.y - h / 2;
      // The viewBox is 100x100 stretched over a box that is not square, so a
      // unit of x and a unit of y are different numbers of pixels. An arm of
      // equal length in viewBox units draws unequal on screen, which is
      // the range-ring distortion (see ov-map.js) in another form: a shape
      // drawn on a
      // non-uniform projection is not the shape you specified. Compensate on x.
      const armY = Math.min(w, h) * 0.32;
      const armX = armY * this.aspect;
      const cls = stale ? 'ov-reticle__bracket is-lost' : 'ov-reticle__bracket';

      // Corner brackets, not a closed rectangle: a box says "this region", a
      // bracket says "this thing, as last seen".
      const corners = [
        [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
      ].map(([cx, cy, sx, sy]) =>
        `<path class="${cls}" d="M${(cx + sx * armX).toFixed(2)},${cy.toFixed(2)} `
        + `L${cx.toFixed(2)},${cy.toFixed(2)} `
        + `L${cx.toFixed(2)},${(cy + sy * armY).toFixed(2)}"/>`).join('');
      svg += corners;

      const score = Number(t.confidence);
      const scored = Number.isFinite(score);
      if (!scored) unscored += 1;
      const label = `${t.label ?? id}`;
      const tail = scored ? score.toFixed(2) : 'unscored';
      html += `<span class="ov-reticle__tag${stale ? ' is-lost' : ''}`
        + `${scored ? '' : ' is-unscored'}" `
        + `style="left:${x}%;top:${(y + h)}%">`
        + `<b>${label}</b> ${tail}`
        + `<i>${stale ? 'lost' : `${Math.round(age)}ms`}</i></span>`;
    }

    // Written only when they change: an empty scene redrawn empty sixty
    // times a second is still sixty rewrites, and an attribute set to the
    // value it already has still invalidates.
    if (this.marks && svg !== this.lastSvg) { this.marks.innerHTML = svg; this.lastSvg = svg; }
    if (this.labels && html !== this.lastHtml) { this.labels.innerHTML = html; this.lastHtml = html; }

    const name = `${live} tracked, ${lost} lost and held at last fix`
      + (unscored ? `, ${unscored} without a confidence score` : '');
    if (this.getAttribute('aria-label') !== name) this.setAttribute('aria-label', name);

    // Offscreen, the next frame is not asked for; watchSeen's wake asks again.
    this.raf = isSeen(this) ? requestAnimationFrame(this.frame) : 0;
  };
}

define('ov-reticle', OvReticle);

export { OvReticle };
