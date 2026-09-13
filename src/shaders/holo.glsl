/**
 * Overscan holo: the projected field.
 *
 * ⚠️ The mechanism here is that the image is IN THE AIR rather than on glass,
 * and everything follows from that one claim:
 *
 *   ADDITIVE      light adds where it overlaps. A projection cannot be darker
 *                 than the room, so nothing here subtracts.
 *   BANDING       the projector refreshes in horizontal bands and they drift,
 *                 which is why the banding SLIDES rather than sitting still
 *                 like a scanline does.
 *   FRINGE        the colour channels do not converge, so edges split. Not a
 *                 glitch: a permanent property of the optics.
 *   FALLOFF       brightest at the emitter and thinning with distance, so the
 *                 field is vertically graded rather than evenly lit.
 *
 * 🔴 This theme is the hardest one in the kit for contrast. Additive light on
 * a dark ground raises the BACKGROUND luminance under the text, which eats
 * delivered contrast exactly where the projection is brightest. The gate in
 * tools/palette.py is what keeps that honest, and it is why holo carries a
 * low grain and a high scanline pitch: the budget is spent on the bands.
 *
 * No cellular or Voronoi noise anywhere in this kit.
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Field
 * @color
 * @default #04070d
 */
uniform vec3 u_field;

/**
 * @label Phosphor
 * @color
 * @default #9fd8ff
 */
uniform vec3 u_phosphor;

/**
 * @label Wash
 * @range 0, 1
 * @default 0.22
 */
uniform float u_wash;

/**
 * @label Wash spread
 * @range 0.5, 8
 * @default 3.0
 */
uniform float u_washSpread;

/**
 * @label Grain
 * @range 0, 1
 * @default 0.06
 */
uniform float u_grain;

/**
 * @label Vignette
 * @range 0, 1
 * @default 0.52
 */
uniform float u_vignette;

/**
 * @label Band opacity
 * @range 0, 1
 * @default 0.55
 */
uniform float u_scanOpacity;

/**
 * @label Band pitch
 * @range 1, 12
 * @default 4
 */
uniform float u_scanPitch;

/* Buffer pixels per CSS pixel, Y axis. See ov-gl.js. */
uniform float u_scaleY;

/**
 * @label Haze
 * @range 0, 1
 * @default 0.28
 */
uniform float u_haze;

/**
 * @label Fringe
 * @range 0, 4
 * @default 1.6
 */
uniform float u_chroma;

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

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) { sum += amp * valueNoise(p); p *= 2.02; amp *= 0.5; }
  return sum;
}

/* The volume, sampled per channel so the fringe is real separation rather
 * than a tint laid over one image. */
float volume(vec2 uv, float offset, float t) {
  vec2 p = uv;
  p.x += offset;
  // Brightest low, thinning upward: the emitter is below the frame.
  float falloff = pow(1.0 - clamp(p.y, 0.0, 1.0), 1.6);
  // A soft column of light rather than an even flood.
  float column = exp(-pow((p.x - 0.5) * 1.7, 2.0) * u_washSpread * 0.5);
  // Slow internal movement, so the volume is alive without anything moving
  // across it in a way that could be read as data.
  float drift = fbm(vec2(p.x * 2.2, p.y * 1.4 - t * 0.05));
  return falloff * column * (0.55 + drift * 0.75);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 px = gl_FragCoord.xy;
  float t = u_time;

  vec3 col = u_field;

  // FRINGE. The channels are sampled at slightly different positions, so an
  // edge in the volume splits into warm and cool sides.
  float sep = u_chroma / max(u_resolution.x, 1.0) * 6.0;
  vec3 vol = vec3(volume(uv, -sep, t), volume(uv, 0.0, t), volume(uv, sep, t));

  // ADDITIVE. Light only ever adds.
  col += u_phosphor * vol * u_wash;

  // HAZE. The air the projection is standing in.
  if (u_haze > 0.0) {
    col += u_phosphor * fbm(uv * 2.6 + vec2(0.0, t * 0.02)) * u_haze * 0.16;
  }

  // BANDING. Drifting, not fixed, because the projector's refresh is not
  // locked to the frame. This is the detail that separates holo from every
  // scanlined theme in the kit.
  if (u_scanOpacity > 0.0) {
    // CSS pixels, not buffer pixels. See the note in field.glsl.
    float pitch = max(1.0, u_scanPitch * u_scaleY) * 2.0;
    float band = sin((px.y + t * 26.0) / pitch * 3.14159265);
    // Bands ADD where they are bright rather than darkening where they are
    // not, so the projection never goes below the room.
    col += u_phosphor * max(0.0, band) * u_scanOpacity * 0.045;
  }

  if (u_grain > 0.0) {
    col += (hash(px + fract(t) * 61.0) - 0.5) * u_grain * 0.07;
  }

  // A gentle edge falloff. Not a lens vignette: the volume simply runs out.
  if (u_vignette > 0.0) {
    vec2 v = uv - 0.5;
    col *= 1.0 - u_vignette * 0.40 * dot(v, v) * 2.0;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
