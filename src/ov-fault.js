/* <ov-fault> - damage to the screen, laid over the interface.
 *
 * The kit's whole protocol is about the VALUE: a refusal withholds a number, a
 * qualifier annotates one. A worn-screen study named the thing none of that
 * covers, in a ticket machine that has been outdoors for eight years:
 *
 *   "Nothing in that device's model represents its own screen. Self-report is
 *    not telemetry. An instrument can be taught to say STALE, and nothing here
 *    can be taught to say SCRATCHED."
 *
 * Its status bar reads SYSTEM NOMINAL while burn-in from a layout retired in
 * 2018 lies across the live UI. The status bar is not lying. It cannot see it.
 *
 * 🔴 SO A FAULT IS DECLARED, NEVER DETECTED. This element takes its faults as
 * attributes and infers nothing. A page able to detect its own burn-in would
 * have fixed it, and an API pretending otherwise would be inventing in exactly
 * the way this kit exists to refuse.
 *
 *   <ov-fault burn="0.6" column="1" stuck="0.3"></ov-fault>
 *   <ov-fault dead="0.62,0.08,0.3,0.16"></ov-fault>
 *
 * ── The one that is not drawn ────────────────────────────────────────────
 *
 * `dead` is a region of digitiser that does not respond, given as
 * `x,y,w,h` in fractions of the element. ⚠️ It is deliberately INVISIBLE. A
 * fault you can see is not the fault this is about: the cruelty of the real
 * machine is that its advertisement could not be dismissed because the close
 * button sat inside a dead zone, and you only found out by pressing it. A
 * helpful grey rectangle would turn a study of a failure into a diagram of one.
 *
 * It is implemented as a real hole in the page's hit testing rather than as a
 * picture of one, which is why this element manages pointer-events itself
 * instead of being uniformly transparent to them.
 *
 * 🔴 NEVER ship a `dead` region on a page a real person has to operate. It
 * exists so a designer can see what their interface does when part of it
 * silently stops working.
 */

import { define } from './ov-core.js';
import './ov-gl.js';

class OvFault extends Overscan.GL {
  get shaderName() { return 'fault'; }

  /* Damage does not animate. The shader has no time term at all, so one draw
   * would do; a low rate keeps it correct through resizes and theme changes
   * without spending frames on a static image. */
  get fps() { return 4; }

  connectedCallback() {
    // Not content. There is nothing here to announce: a screen fault is not
    // information the interface is conveying, it is damage to the surface the
    // interface is being shown on.
    this.setAttribute('aria-hidden', 'true');
    this.dead = this.parseDead();
    if (this.dead) this.armDeadZone();
    return super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.onDown) {
      for (const t of ['pointerdown', 'pointerup', 'click'])
        window.removeEventListener(t, this.onDown, true);
    }
  }

  /* "x,y,w,h" in fractions of this element. Anything malformed is ignored
   * rather than guessed at, which is the same rule the widgets follow. */
  parseDead() {
    const raw = (this.getAttribute('dead') || '').trim();
    if (!raw) return null;
    const n = raw.split(',').map(Number);
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
    return n;
  }

  /* The dead zone has to eat events before they reach whatever is under it, so
   * it listens in the CAPTURE phase on the window and stops anything landing
   * inside the region. Making the element itself cover the area with
   * pointer-events would not do: it would also block the rest of the page, and
   * a real dead digitiser does not move focus or hover either. */
  armDeadZone() {
    this.onDown = (e) => {
      const r = this.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const [x, y, w, h] = this.dead;
      const x0 = r.left + x * r.width, y0 = r.top + y * r.height;
      if (e.clientX < x0 || e.clientX > x0 + w * r.width) return;
      if (e.clientY < y0 || e.clientY > y0 + h * r.height) return;
      // Nothing happens. No feedback, no cursor change, no console warning:
      // the point is that the interface gives you no reason for it.
      e.stopPropagation();
      e.preventDefault();
    };
    for (const t of ['pointerdown', 'pointerup', 'click'])
      window.addEventListener(t, this.onDown, true);
  }

  uniforms(s) {
    const gl = this.gl;
    const num = (name, fallback) => {
      const v = parseFloat(this.getAttribute(name));
      return Number.isFinite(v) ? v : fallback;
    };
    this.set('u_burn', gl.uniform1f, num('burn', 0));
    this.set('u_column', gl.uniform1f, num('column', 0));
    this.set('u_columnAt', gl.uniform1f, num('column-at', 0.63));
    this.set('u_stuck', gl.uniform1f, num('stuck', 0));
    // The ghost takes the theme's ink, because burn-in is the screen's own
    // light having worn the panel, not an arbitrary colour laid over it.
    this.set('u_burnColour', gl.uniform3fv, this.rgb(s, '--ov-ink'));
  }
}

define('ov-fault', OvFault);

export { OvFault };
