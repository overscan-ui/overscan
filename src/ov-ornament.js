/* <ov-ornament> - decorative GL, scoped to whatever box it is put in.
 *
 * The kit had exactly one place a shader could go: full-bleed, behind an
 * entire themed surface. That is the wrong granularity for most of what a
 * shader is actually good for here, which is a strip under a heading, a
 * corner block, a backdrop for one panel rather than the page.
 *
 * ⚠️ IT ENCODES NOTHING, and it is a separate element from every instrument
 * for exactly that reason. In a kit whose whole thesis is that a readout
 * refuses to invent, an ornament that LOOKS like a readout is the worst thing
 * on the page: it is a display that reports something it was never given. So
 * this is named as decoration, documented as decoration, and marked
 * aria-hidden, because the one honest thing to say about it is nothing.
 *
 * The corollary, from the rule that decoration needs a rule: the mode is
 * chosen by THEME, not per element. Every ornament in a surface moves the same
 * way, because "which ornament is this" is not a question the ornament should
 * be answering. What varies per element is size and intensity.
 *
 *   <ov-ornament></ov-ornament>                  the theme's mode
 *   <ov-ornament mode="strands"></ov-ornament>     override, for a demo that has
 *                                              to show all four side by side
 *
 * Sizing is the caller's: this fills its box. There is no intrinsic size, so
 * a bare <ov-ornament> in a flex column gets a default block-size from
 * ornament.css rather than collapsing to nothing.
 */

import { define } from './ov-core.js';
import './ov-gl.js';

const MODES = { sweep: 0, strata: 1, strands: 2, smoke: 3 };

class OvOrnament extends Overscan.GL {
  get shaderName() { return 'ornament'; }

  /* Decoration, so it gets a third of the draws and half the pixels a field
   * does. Nothing here is being read, so nothing here needs to be sharp or
   * smooth. */
  get fps() { return 24; }
  get maxDpr() { return 1; }

  connectedCallback() {
    // Decoration is not content. Nothing here is announced, because there is
    // nothing true to announce.
    this.setAttribute('aria-hidden', 'true');
    return super.connectedCallback();
  }

  uniforms(s) {
    const gl = this.gl;
    const named = this.getAttribute('mode');
    const themed = (this.token(s, '--ov-ornament') || '').trim();
    const mode = MODES[named] ?? MODES[themed] ?? 0;

    this.set('u_mode', gl.uniform1f, mode);
    this.set('u_field', gl.uniform3fv, this.rgb(s, '--ov-field'));
    this.set('u_accent', gl.uniform3fv, this.rgb(s, '--ov-accent'));
    // Themes that define no second accent fall back to the first, rather than
    // to black, which would read as a hole rather than as one colour.
    const a2 = this.rgb(s, '--ov-accent-2');
    const has2 = a2[0] + a2[1] + a2[2] > 0;
    this.set('u_accent2', gl.uniform3fv, has2 ? a2 : this.rgb(s, '--ov-accent'));

    this.set('u_intensity', gl.uniform1f,
      this.num(s, '--ov-ornament-intensity', 0.5));
    this.set('u_rate', gl.uniform1f, this.num(s, '--ov-ornament-rate', 1));
    this.set('u_grain', gl.uniform1f, this.num(s, '--ov-grain', 0));
    this.set('u_glitch', gl.uniform1f, this.num(s, '--ov-fx-glitch', 0));
  }
}

define('ov-ornament', OvOrnament);

export { OvOrnament };
