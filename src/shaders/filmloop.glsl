/**
 * Overscan film loop. An INSTRUMENT shader, not a field shader.
 *
 * 2001's readouts were animated film loops back-projected onto set monitors.
 * They are the content of a screen, not the surface behind an interface, and
 * that distinction decides where this file is allowed to run:
 *
 *   USE inside a readout component, where nothing is laid over it.
 *   DO NOT use as a panel or page background.
 *
 * Two reasons, both hard rather than aesthetic:
 *
 * 1. Flash safety. Each cell is re-rolled on a held frame boundary, so the
 *    effective rate is u_fps / u_hold. WCAG 2.3.1 allows at most three general
 *    flashes per second over a large area, so the defaults here are 6 / 3 = 2 Hz.
 *    Raising the rate is only safe inside a small instrument, never full bleed,
 *    and every caller must still cancel it under prefers-reduced-motion.
 * 2. Contrast. Every ratio in TOKENS.md is measured against a flat field. A
 *    background of flashing primary blocks makes those numbers meaningless and
 *    turns contrast into a function of position AND time.
 *
 * antiseptic therefore has NO field shader. Its field is flat true black, which
 * is the register: the future as antiseptic, zero depth, nothing behind.
 *
 * No grain, no glow, no gradient, no vignette, no antialiasing on block edges.
 * Nothing here is continuous.
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Ground
 * @color
 * @default #000000
 */
uniform vec3 u_ground;

/**
 * @label Primary
 * @color
 * @default #2d6eff
 */
uniform vec3 u_primary;

/**
 * @label Secondary
 * @color
 * @default #ffd400
 */
uniform vec3 u_secondary;

/**
 * @label Alarm
 * @color
 * @default #ff2b1c
 */
uniform vec3 u_alarm;

/**
 * @label Columns
 * @range 2, 24
 * @default 9
 */
uniform float u_cols;

/**
 * @label Rows
 * @range 2, 16
 * @default 6
 */
uniform float u_rows;

/**
 * @label Frames per second
 * @range 1, 24
 * @default 6
 */
uniform float u_fps;

/**
 * @label Hold frames
 * @range 1, 8
 * @default 3
 */
uniform float u_hold;

/**
 * @label Fill density
 * @range 0, 1
 * @default 0.45
 */
uniform float u_density;

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

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Everything steps on the HELD frame, on/off included. Re-rolling the on/off
  // every raw frame is what made an earlier version flash at u_fps.
  float frame = floor(u_time * u_fps);
  float held = floor(frame / max(u_hold, 1.0));
  vec2 cell = floor(vec2(uv.x * u_cols, uv.y * u_rows));

  float lit = hash(cell + held * 3.77);
  if (lit > u_density) {
    gl_FragColor = vec4(u_ground, 1.0);
    return;
  }

  // A block is either primary or secondary, never blended.
  float pick = hash(cell * 1.31 + held * 7.13);
  vec3 col = u_primary;
  if (pick > 0.72) col = u_secondary;
  if (pick > 0.94) col = u_alarm;

  // Blocks occupy a whole cell minus a hard gutter. step(), never smoothstep().
  vec2 f = fract(vec2(uv.x * u_cols, uv.y * u_rows));
  float gut = 0.08;
  float inside = step(gut, f.x) * step(f.x, 1.0 - gut)
               * step(gut, f.y) * step(f.y, 1.0 - gut);

  gl_FragColor = vec4(mix(u_ground, col, inside), 1.0);
}
