/**
 * Overscan scope: a phosphor persistence trace.
 *
 * ⚠️ The kit already has <ov-wave>, which draws a persistence trace in SVG and
 * fades old sweeps by age. So this has to earn GL, and it does it on one point
 * that SVG genuinely cannot express:
 *
 *   🔴 BEAM INTENSITY IS DWELL TIME. On a real scope the spot is a constant
 *   amount of light per unit TIME, not per unit LENGTH. Where the trace moves
 *   slowly it deposits more energy per pixel and burns brighter; where it
 *   moves fast it stretches the same energy over more pixels and dims. That is
 *   why the flat tops of a square wave glow and the transitions almost vanish.
 *   A stroked polyline has one width and one opacity along its whole length,
 *   so it inverts the physics: an SVG trace is EQUALLY bright everywhere and
 *   therefore brightest, in appearance, exactly where a real beam is faintest.
 *
 * The data arrives as a texture: rows are sweeps, oldest at row 0, newest at
 * the last row. See ov-scope.js. A shader cannot read an array any more than
 * it can read the DOM.
 *
 * Persistence is REAL here rather than a redraw with lower opacity: every
 * sweep still in the buffer is evaluated every frame and weighted by its age,
 * so a slow signal leaves a wide ribbon of overlapping traces exactly the way
 * a long-persistence tube does.
 *
 * No cellular or Voronoi noise anywhere in this kit.
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/** Sweep history. x is position along the sweep, y is age: row 0 is oldest. */
uniform sampler2D u_data;

/** Buffer shape: samples per sweep, sweeps held, how many are real. */
uniform vec3 u_shape;

/** Device pixels per CSS pixel, so the beam is one width on every screen. */
uniform float u_scale;

/**
 * @label Field
 * @color
 * @default #0a0a0b
 */
uniform vec3 u_field;

/**
 * @label Phosphor
 * @color
 * @default #33ff66
 */
uniform vec3 u_phosphor;

/**
 * @label Grid
 * @color
 * @default #26262c
 */
uniform vec3 u_grid;

/**
 * @label Persistence
 * @range 0, 1
 * @default 0.6
 */
uniform float u_persist;

/**
 * @label Beam width, CSS pixels
 * @range 0.5, 4
 * @default 1.3
 */
uniform float u_beam;

/**
 * @label Grain
 * @range 0, 1
 * @default 0.0
 */
uniform float u_grain;

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

/* One sample from one sweep. Rows are ages; the +0.5 lands on texel centres,
 * which matters because the texture is NEAREST filtered and half a texel out
 * reads the neighbouring sweep. */
float sample1(float x, float row) {
  return texture2D(u_data, vec2(x, (row + 0.5) / max(u_shape.y, 1.0))).r;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / u_resolution;
  float scale = max(u_scale, 0.25);

  vec3 col = u_field;

  // Graticule. Furniture, so it takes the rule colour and stays under the
  // 3:1 gate rather than competing with the trace.
  vec2 g = abs(fract(uv * vec2(10.0, 8.0)) - 0.5);
  float line = 1.0 - smoothstep(0.0, 1.2 / min(u_resolution.x / 10.0, u_resolution.y / 8.0), min(g.x, g.y));
  col = mix(col, u_grid, line * 0.55);
  // Centre lines, brighter, because a scope's axes are not just another square.
  float cx = 1.0 - smoothstep(0.0, 1.5 * scale / u_resolution.x, abs(uv.x - 0.5));
  float cy = 1.0 - smoothstep(0.0, 1.5 * scale / u_resolution.y, abs(uv.y - 0.5));
  col = mix(col, u_grid, max(cx, cy) * 0.9);

  float held = max(u_shape.z, 1.0);
  float beam = u_beam * scale;
  float energy = 0.0;

  // Every sweep still in the buffer, weighted by age. 24 is the ceiling
  // because the loop bound must be a constant in GLSL ES 1.00; the real count
  // comes from u_shape.z and the rest are skipped.
  for (int i = 0; i < 24; i++) {
    float row = float(i);
    if (row >= held) break;

    // Age 0 is the newest sweep. Rows are stored oldest first, so the newest
    // is at held-1.
    float age = (held - 1.0) - row;
    // Decay. u_persist 0 keeps only the live sweep; 1 holds the whole buffer.
    float w = exp(-age / max(0.6, u_persist * held * 0.9));
    if (w < 0.004) continue;

    // The signal at this column, and one step either side, so the beam's
    // SPEED can be measured rather than guessed.
    float step1 = 1.0 / max(u_shape.x, 2.0);
    float v0 = sample1(uv.x - step1, row);
    float v1 = sample1(uv.x, row);
    float v2 = sample1(uv.x + step1, row);

    // 🔴 The dwell term. dv/dx is how far the beam moved vertically while
    // crossing this column: large slope means it passed through quickly and
    // deposited little light. Clamped so a true vertical edge dims rather
    // than disappearing, which is what a real tube does.
    float slope = abs(v2 - v0) * 0.5 * u_resolution.y * step1;
    float dwell = 1.0 / (1.0 + slope * 2.2);
    dwell = clamp(dwell, 0.10, 1.0);

    // Distance from this pixel to the trace, in device pixels.
    float d = abs(uv.y - v1) * u_resolution.y;
    // Soft core plus a wider, much dimmer halo: phosphor scatters.
    float core = exp(-(d * d) / (2.0 * beam * beam));
    float halo = exp(-(d * d) / (2.0 * beam * beam * 9.0)) * 0.22;

    energy += (core + halo) * w * dwell;
  }

  // Saturating, not additive: a tube's phosphor has a maximum brightness, and
  // without this a slow signal's overlapping sweeps clip to a flat white slab.
  float lit = 1.0 - exp(-energy * 1.35);
  col += u_phosphor * lit;

  if (u_grain > 0.0) {
    col += (hash(px + fract(u_time) * 53.0) - 0.5) * u_grain * 0.06;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
