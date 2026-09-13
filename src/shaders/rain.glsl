/**
 * Overscan rain: the neo field.
 *
 * ⚠️ neo would be a reskin of industrial if it were only a green. Both are
 * green phosphor on near-black and hue alone is not a theme, so the register
 * has to differ in MECHANISM: here the field is made of CHARACTERS, in columns,
 * falling at their own rates, with a bright leading glyph and a trail that
 * fades by age.
 *
 * 🔴 THE GLYPHS ARE REAL. The first version of this shader faked them with a
 * procedural 4x5 dot matrix, on the reasoning that at small sizes a glyph only
 * has to read as a dense mark. That was wrong, and it was called: it reads as
 * blocky noise, not as characters, and "a cheap mockery at best". A fragment
 * shader cannot read a font, so the real fix is a font rasterised into a
 * texture for it. `Overscan.GL.glyphAtlas` does that, and this samples it.
 *
 * The set is half-width katakana plus digits, drawn MIRRORED, because the
 * film's glyphs are flipped and unmirrored katakana reads as ordinary Japanese
 * scrolling past rather than as the thing being quoted.
 *
 * ⚠️ IT IS A BACKDROP AND MUST STAY ONE. The interface is read ON TOP of this,
 * so every brightness here is deliberately low: a field that competes with the
 * panel over it has stopped being a field. An earlier pass was too bright and
 * the whole surface glowed.
 *
 * No cellular or Voronoi noise anywhere in this kit.
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/** The rasterised glyph atlas, mirrored, alpha carrying the glyph. */
uniform sampler2D u_glyphs;

/** Atlas shape: columns, rows, how many glyphs are actually used. */
uniform vec3 u_atlas;

/**
 * @label Field
 * @color
 * @default #000000
 */
uniform vec3 u_field;

/**
 * @label Phosphor
 * @color
 * @default #00ff41
 */
uniform vec3 u_phosphor;

/**
 * @label Wash
 * @range 0, 1
 * @default 0.05
 */
uniform float u_wash;

/**
 * @label Grain
 * @range 0, 1
 * @default 0.1
 */
uniform float u_grain;

/**
 * @label Vignette
 * @range 0, 1
 * @default 0.6
 */
uniform float u_vignette;

/**
 * @label Scanline opacity
 * @range 0, 1
 * @default 0.22
 */
uniform float u_scanOpacity;

/**
 * @label Scanline pitch
 * @range 1, 8
 * @default 2
 */
uniform float u_scanPitch;

/* Buffer pixels per CSS pixel, Y axis. See ov-gl.js. */
uniform float u_scaleY;

/** Device pixels per CSS pixel, so a glyph is the same SIZE on every screen. */
uniform float u_scale;

/* ⚠️ CSS pixels, not device pixels. Sizing a glyph in device pixels makes it
 * half as large on a dpr 2 phone as on a dpr 1 desktop, which is how a field
 * that looks right on one machine looks like noise on another. */
const float CW = 15.0;
const float CH = 19.0;
const float TAIL = 18.0; // how many cells a column's trail runs for

/* 🔴 SINE-FREE, AND THE SINE VERSION WAS A REAL BUG ON REAL HARDWARE.
 *
 * This was `fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123)`, the hash
 * every shader on the web uses. It degrades with the MAGNITUDE of its input,
 * and the grain feeds it `gl_FragCoord.xy`, which on a 2048-tall buffer is the
 * largest input in the kit.
 *
 * A GPU evaluates sin() by reducing the argument modulo 2pi. At a dot product
 * near a million that integer quotient eats most of the mantissa, leaving only
 * a few bits for the fraction that actually selects the phase, so the hash
 * collapses onto a handful of distinct outputs. Grain built on it stops being
 * per-pixel noise and starts being coarse blocks.
 *
 * ⚠️ THAT IS WHY THE FIELD BANDED ON iPad AND NOT ON A MAC. It is not a
 * gradient bug: the wash and vignette have always been a smooth ramp across a
 * near-black field, which lives in about seven 8-bit values and therefore MUST
 * band unless something dithers it. Grain is what dithers it. Where the hash
 * degrades, the dither goes with it and the bands appear. Measured on the
 * device: a 120px row of field held THREE distinct values.
 *
 * Dave Hoskins' hash, which uses no transcendental and is stable across the
 * whole coordinate range. */
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* Sample one glyph out of the atlas.
 *
 * ⚠️ The atlas was uploaded with UNPACK_FLIP_Y_WEBGL, so its first canvas row
 * sits at the TOP of the texture. Row `ay` counted from the canvas top
 * therefore occupies t in [1 - (ay+1)/rows, 1 - ay/rows], which is what the
 * inversion below is doing. Getting this wrong renders the atlas upside down
 * and every glyph unrecognisable, which looks exactly like a bad font. */
float glyph(vec2 cellUV, float idx) {
  float cols = max(u_atlas.x, 1.0);
  float rows = max(u_atlas.y, 1.0);
  float ax = mod(idx, cols);
  float ay = floor(idx / cols);
  // Inset so bilinear filtering cannot bleed a neighbouring glyph in.
  vec2 g = clamp(cellUV, 0.03, 0.97);
  float tx = (ax + g.x) / cols;
  float ty = 1.0 - (ay + 1.0 - g.y) / rows;
  return texture2D(u_glyphs, vec2(tx, ty)).a;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 cell = vec2(CW, CH) * max(u_scale, 0.25);
  vec2 cellId = floor(px / cell);
  vec2 cellUV = fract(px / cell);

  float rows = max(1.0, floor(u_resolution.y / cell.y));
  // Measured from the TOP, because rain falls down and gl_FragCoord.y is up.
  float rowFromTop = rows - cellId.y;

  // Per column: its own speed, its own phase. Columns must not march in step
  // or the field reads as one sliding block rather than as rain.
  float col = cellId.x;
  float speed = 2.5 + hash(vec2(col, 1.0)) * 7.5;
  float phase = hash(vec2(col, 2.0)) * (rows + TAIL);
  float head = mod(u_time * speed + phase, rows + TAIL);

  // Distance behind the head, in cells.
  float d = head - rowFromTop;
  float lit = 0.0;
  if (d >= 0.0 && d < TAIL) lit = 1.0 - d / TAIL;
  lit *= lit;  // fall off faster than linear, so the trail reads as decay

  // Which character this cell is showing. It holds for a while, and reshuffles
  // faster near the head, so the trail looks like settled text and the head
  // looks like it is still being written.
  float rate = 1.2 + 5.0 * step(d, 1.0);
  float bucket = floor(u_time * rate + hash(cellId) * 20.0);
  float idx = floor(hash(cellId * 1.7 + bucket * 0.37) * max(u_atlas.z, 1.0));
  float on = glyph(cellUV, idx);

  vec3 c = u_field;

  // A very dim wash so the field is not pure black between columns.
  c += u_phosphor * u_wash * 0.22;

  // The trail. Low on purpose: the UI is read over this.
  c += u_phosphor * lit * on * 0.34;

  // The leading glyph is brighter and pushed toward white, which is the one
  // detail that makes this read as rain rather than as a green grid.
  float isHead = smoothstep(1.8, 0.0, d);
  c += mix(u_phosphor, vec3(1.0), 0.65) * isHead * on * 0.42;

  // Scanlines and grain, so the field sits under the same finish as the rest.
  if (u_scanOpacity > 0.0) {
    // CSS pixels, not buffer pixels. See the note in field.glsl.
    float sp = max(1.0, u_scanPitch * u_scaleY) * 2.0;
    float s = step(u_scaleY, mod(px.y, sp));
    c *= 1.0 - u_scanOpacity * 0.35 * s;
  }
  if (u_grain > 0.0) {
    c += (hash(px + fract(u_time) * 71.0) - 0.5) * u_grain * 0.06;
  }
  if (u_vignette > 0.0) {
    vec2 v = px / u_resolution - 0.5;
    c *= 1.0 - u_vignette * 0.62 * dot(v, v) * 2.0;
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
