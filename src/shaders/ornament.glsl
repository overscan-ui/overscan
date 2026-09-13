/**
 * Overscan ornament.
 *
 * Decorative GL, for the small ornamental surfaces a panel carries: a strip
 * under a heading, a corner block, a spacer between two instrument groups, a
 * card's backdrop. Not an instrument. It encodes NOTHING, and that is the
 * point of keeping it separate from every other shader here: an ornament that
 * looks like it is reporting something is worse than no ornament.
 *
 * ⚠️ Because it means nothing, it must never be given the geometry of a
 * readout. No bars of varying height, no needle, no trace against an axis. It
 * moves and it fills; it does not indicate.
 *
 * One shader, four modes, chosen per theme. Same reasoning as field.glsl: the
 * registers differ in which terms they use rather than in mechanism, and a
 * shader per theme would be variation that encodes nothing. (Which, here,
 * would be doubly true.)
 *
 *   0 SWEEP    a soft bar travelling along the long axis, phosphor on field.
 *              terminal's register: one channel, brightness.
 *   1 STRATA   stacked horizontal bands at fixed pitch, sliding at different
 *              rates. industrial: everything is a machined layer.
 *   2 STRANDS  open vertical filaments, drifting, occasionally displaced by
 *              the same glitch term the cyber field uses.
 *   3 SMOKE    slow fbm haze with a warm core. esper: the room behind the
 *              photograph.
 *
 * No cellular or Voronoi noise anywhere in this kit.
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Mode
 * @range 0, 3
 * @default 0
 */
uniform float u_mode;

/**
 * @label Field
 * @color
 * @default #0a0a0b
 */
uniform vec3 u_field;

/**
 * @label Accent
 * @color
 * @default #ffffff
 */
uniform vec3 u_accent;

/**
 * @label Second accent
 * @color
 * @default #ffffff
 */
uniform vec3 u_accent2;

/**
 * @label Intensity
 * @range 0, 1
 * @default 0.5
 */
uniform float u_intensity;

/**
 * @label Rate
 * @range 0, 4
 * @default 1.0
 */
uniform float u_rate;

/**
 * @label Grain
 * @range 0, 1
 * @default 0.0
 */
uniform float u_grain;

/**
 * @label Glitch
 * @range 0, 1
 * @default 0.0
 */
uniform float u_glitch;

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
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

// A bar that travels and wraps, soft at both edges. Distance is computed on
// the wrapped axis so the bar does not pop when it re-enters.
float sweep(float x, float t, float width) {
  float head = fract(t);
  float d = abs(x - head);
  d = min(d, 1.0 - d);          // wrap: the short way round
  return smoothstep(width, 0.0, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_rate;
  int mode = int(u_mode + 0.5);

  vec3 col = u_field;
  float lum = 0.0;
  vec3 tint = u_accent;

  if (mode == 0) {
    // SWEEP. Along whichever axis is longer, so one element serves a wide
    // strip under a heading and a tall block beside a column.
    float along = u_resolution.x >= u_resolution.y ? uv.x : uv.y;
    float across = u_resolution.x >= u_resolution.y ? uv.y : uv.x;
    lum = sweep(along, t * 0.22, 0.16);
    // Fade at the ends of the short axis so the bar reads as light rather
    // than as a filled rectangle with hard edges.
    lum *= smoothstep(0.0, 0.35, across) * smoothstep(1.0, 0.65, across);
    lum *= 0.9;
    // A second, dimmer pass at a different rate, so the ornament never
    // settles into an obvious loop.
    lum += sweep(along, t * 0.13 + 0.5, 0.09) * 0.35;

  } else if (mode == 1) {
    // STRATA. Bands at fixed pitch, each sliding at a rate set by its own
    // index, so the stack shears rather than translating as one block.
    float bands = 7.0;
    float row = floor(uv.y * bands);
    float rate = 0.05 + hash(vec2(row, 3.0)) * 0.16;
    float dir = mod(row, 2.0) < 1.0 ? 1.0 : -1.0;
    float x = fract(uv.x + t * rate * dir);
    float w = 0.18 + hash(vec2(row, 9.0)) * 0.3;
    lum = step(x, w) * (0.35 + hash(vec2(row, 5.0)) * 0.65);
    // Hairline between bands: this is furniture, gated at 3:1 like every
    // other rule in the kit, so it stays faint.
    float edge = abs(fract(uv.y * bands) - 0.5);
    lum = mix(lum, lum * 0.35, smoothstep(0.44, 0.5, edge));
    if (hash(vec2(row, 17.0)) > 0.72) tint = u_accent2;

  } else if (mode == 2) {
    // STRANDS. Open vertical filaments. Open, not closed cells: no Voronoi.
    vec2 p = uv;
    // Correlated displacement, the same term the cyber field glitches with,
    // so an accent and the field behind it tear together rather than
    // independently, which would read as two faults instead of one.
    float band = floor(p.y * 14.0);
    float burst = step(0.82, hash(vec2(band, floor(t * 6.0))));
    p.x += burst * (hash(vec2(band, floor(t * 6.0) + 1.0)) - 0.5) * 0.25 * u_glitch;

    float n = fbm(vec2(p.x * 7.0, p.y * 1.6 - t * 0.25));
    // Ridge: two thresholds around the noise make a filament rather than a
    // blob, and it stays open at both ends of the element.
    float strand = smoothstep(0.46, 0.5, n) - smoothstep(0.53, 0.58, n);
    lum = clamp(strand, 0.0, 1.0);
    lum *= 0.5 + 0.5 * fbm(vec2(p.x * 2.0, t * 0.4));
    if (fract(p.x * 7.0 + 0.5) > 0.62) tint = u_accent2;

  } else {
    // SMOKE. Slow haze, warm core, no structure to read.
    vec2 p = uv * vec2(2.2, 1.4);
    float n = fbm(p + vec2(t * 0.05, t * -0.03));
    n = fbm(p + n * 0.7 + vec2(0.0, t * 0.02));
    lum = smoothstep(0.35, 0.85, n) * 0.8;
    float core = exp(-length((uv - 0.5) * vec2(1.0, 1.6)) * 2.4);
    lum = lum * (0.35 + core);
    tint = mix(u_accent2, u_accent, clamp(core * 1.6, 0.0, 1.0));
  }

  // Straight alpha, not premultiplied, and the COLOUR is the tint at full
  // strength while the ALPHA carries the intensity. Blending toward the field
  // colour here as well would composite the ornament against the field twice:
  // once in the shader and again over whatever the panel's real background is,
  // which washes the accent out on any surface that is not exactly u_field.
  // The element is genuinely transparent where the ornament is not.
  col = tint;
  float a = clamp(lum * u_intensity, 0.0, 1.0);

  if (u_grain > 0.0) {
    float g = hash(gl_FragCoord.xy + fract(u_time) * 91.0) - 0.5;
    col += g * u_grain * 0.09;
    a += g * u_grain * 0.05;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(a, 0.0, 1.0));
}
