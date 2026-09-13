/* <ov-field> - the field shader, as a backdrop behind a themed surface.
 *
 * The field sits BEHIND the interface. That is not because a shader may never
 * be drawn on top (see ov-gl.js for where that rule was too strong) but
 * because a field is a backdrop: it is the thing the UI sits on.
 *
 * Which shader to run comes from the theme's own --ov-fx-shader, so this is
 * driven by the same control surface as everything else. A theme whose
 * --ov-fx-shader is `none` gets no canvas at all. That is antiseptic: a flat
 * field with no texture is its register, not an omission.
 *
 * All the GL plumbing lives in Overscan.GL. What is left here is the part
 * that is actually about fields: which shader, and which theme properties
 * become which uniforms.
 */

import { define } from './ov-core.js';
import './ov-gl.js';

/* Half-width katakana, which is what the film uses, plus digits. The set is
 * listed here rather than in the shader because a shader cannot read a font:
 * see Overscan.GL.glyphAtlas. */
const KATAKANA = (() => {
  const out = [];
  for (let c = 0xFF66; c <= 0xFF9D; c++) out.push(String.fromCharCode(c));
  for (const d of '0123456789') out.push(d);
  return out;
})();

class OvField extends Overscan.GL {
  connectedCallback() {
    // Read before super(), because a theme that names no shader should never
    // get a canvas or a context.
    //
    // Three ways to choose, most specific first. The attribute is for a panel
    // that wants a field the page does not have, or a different one; the
    // property is for a theme, or for any scope that overrides it, since this
    // reads the COMPUTED value on itself and a panel setting --ov-fx-shader
    // in its own style block is simply a narrower scope.
    const which = (this.getAttribute('shader')
      || getComputedStyle(this).getPropertyValue('--ov-fx-shader') || '').trim();
    if (!which || which === 'none') return;
    this.which = which;
    return super.connectedCallback();
  }

  get shaderName() { return this.which; }

  /* A backdrop, not an instrument: nothing is read off it, so it asks for 30
   * frames a second rather than the base class's 60, the way ov-ornament asks
   * for 24. The home page carries 27 of them. */
  get fps() { return 30; }

  ready() {
    // Only the rain field needs glyphs. The atlas is shared, so nine neo
    // surfaces on one page rasterise one texture between them.
    if (this.which === 'rain') {
      this.atlas = Overscan.GL.glyphAtlas('katakana', KATAKANA, this.gl);
    }
  }

  uniforms(s) {
    const gl = this.gl;
    this.set('u_field', gl.uniform3fv, this.rgb(s, '--ov-field'));
    this.set('u_phosphor', gl.uniform3fv, this.rgb(s, '--ov-accent'));
    // beam.glsl only, and a no-op everywhere else because `set` skips a
    // uniform the program does not declare. A vector display has more than
    // one gun, and the retrace is drawn by the wrong one.
    this.set('u_accent2', gl.uniform3fv, this.rgb(s, '--ov-accent-2'));
    this.set('u_wash', gl.uniform1f, this.num(s, '--ov-fx-wash', 0.1));
    this.set('u_washSpread', gl.uniform1f, this.num(s, '--ov-fx-spread', 3.2));
    this.set('u_scanOpacity', gl.uniform1f, this.num(s, '--ov-scan-opacity', 0));
    this.set('u_scanPitch', gl.uniform1f, this.num(s, '--ov-scan-pitch', 2));
    this.set('u_grain', gl.uniform1f, this.num(s, '--ov-grain', 0));
    this.set('u_vignette', gl.uniform1f, this.num(s, '--ov-vignette', 0));
    this.set('u_haze', gl.uniform1f, this.num(s, '--ov-fx-haze', 0));
    this.set('u_chroma', gl.uniform1f, this.num(s, '--ov-fx-chroma', 0));
    this.set('u_glitch', gl.uniform1f, this.num(s, '--ov-fx-glitch', 0));
    this.set('u_glitchBands', gl.uniform1f, 24);
    this.set('u_glitchRate', gl.uniform1f, 12);
    // filmloop.glsl only. Effective rate is fps/hold, so 30 holds a 60fps
    // context to 2Hz and the loop reads as film rather than as a flicker.
    this.set('u_hold', gl.uniform1f, this.num(s, '--ov-fx-hold', 30));

    // rain.glsl only. Bound every frame because the context is shared and any
    // other element may have left a different texture bound.
    if (this.atlas) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.tex);
      this.set('u_glyphs', gl.uniform1i, 0);
      this.set('u_atlas', gl.uniform3f,
        this.atlas.cols, this.atlas.rows, this.atlas.count);
    }
  }
}

define('ov-field', OvField);

export { OvField };
