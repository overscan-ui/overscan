/**
 * Overscan waterfall: a spectrogram, scrolling.
 *
 * ⚠️ This is the least arguable GL widget in the kit. A waterfall is three
 * dimensions at once (time, frequency, intensity) and a useful one is a few
 * hundred bins by a few hundred lines: forty to a hundred thousand cells, each
 * needing its own colour, replaced every frame. In DOM that is a five figure
 * node count. As a texture it is one upload and one quad.
 *
 * 🔴 THE COLOUR MAP IS THE HONESTY PROBLEM, not the drawing. A waterfall maps
 * a scalar to a colour, and that map decides what a reader believes they can
 * see. Rainbow maps invent structure: they have sharp perceptual edges at
 * yellow and cyan that read as boundaries in the DATA when they are boundaries
 * in the PALETTE, and they are not monotonic in lightness, so a greyscale
 * print or a colourblind reader gets a different picture entirely. That is the
 * same failure this kit exists to refuse, committed by a legend.
 *
 * So the maps here are all MONOTONIC IN LIGHTNESS. Brighter always means more,
 * every one of them survives being read in greyscale, and the theme's own
 * accent is the hue rather than an imported palette.
 *
 * ⭐ And it declares its floor. A spectrogram silently clipping everything
 * below some threshold to black is hiding the difference between "quiet" and
 * "nothing", which are not the same reading. <ov-waterfall> prints the floor
 * it is drawing to.
 *
 * No cellular or Voronoi noise anywhere in this kit.
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/** Bins across, lines down. Row 0 is the NEWEST line. */
uniform sampler2D u_data;

/** Buffer shape: bins, lines held, how many lines are real. */
uniform vec3 u_shape;

/** Device pixels per CSS pixel. */
uniform float u_scale;

/**
 * @label Field
 * @color
 * @default #0a0a0b
 */
uniform vec3 u_field;

/**
 * @label Accent
 * @color
 * @default #33ff66
 */
uniform vec3 u_accent;

/**
 * @label Second accent
 * @color
 * @default #6fe8d0
 */
uniform vec3 u_accent2;

/**
 * 0 single hue, 1 two hue, 2 hot.
 * @label Map
 * @range 0, 2
 * @default 0
 */
uniform float u_map;

/**
 * Everything below this reads as the floor, and the element prints it.
 * @label Floor
 * @range 0, 1
 * @default 0.04
 */
uniform float u_floor;

/**
 * @label Grid
 * @color
 * @default #26262c
 */
uniform vec3 u_grid;

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

/* Every map below is monotonic in lightness: v larger is always lighter, with
 * no local maxima. That is the property a rainbow lacks and the reason a
 * rainbow lies. */
vec3 colourise(float v) {
  int m = int(u_map + 0.5);
  if (m == 0) {
    // Single hue, black through the accent to white. The safest map there is.
    return mix(mix(u_field, u_accent, smoothstep(0.0, 0.72, v)),
               vec3(1.0), smoothstep(0.78, 1.0, v));
  } else if (m == 1) {
    // Two hue: the second accent low, the first high. Still monotonic,
    // because the second accent is only ever used where v is small and the
    // ramp keeps rising through it.
    vec3 low = mix(u_field, u_accent2, smoothstep(0.0, 0.46, v));
    return mix(low, u_accent, smoothstep(0.34, 0.92, v));
  }
  // Hot: black, accent, white, the classic thermal ramp minus its rainbow.
  vec3 c = mix(u_field, u_accent, smoothstep(0.0, 0.55, v));
  return mix(c, vec3(1.0), smoothstep(0.55, 1.0, v));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 px = gl_FragCoord.xy;

  float bins = max(u_shape.x, 1.0);
  float lines = max(u_shape.y, 1.0);
  float held = max(u_shape.z, 0.0);

  // Frequency runs left to right, time runs DOWNWARD: the newest line is at
  // the top and older lines fall away, which is the direction every waterfall
  // in the world scrolls and the opposite of GL's y axis.
  float line = (1.0 - uv.y) * lines;

  vec3 col;
  if (line >= held) {
    // Not yet written. Not black: an unwritten line is not a silent one, and
    // the difference has to be visible or the instrument is claiming to have
    // measured something it has not.
    col = mix(u_field, u_grid, 0.35);
  } else {
    float v = texture2D(u_data, vec2(uv.x, (floor(line) + 0.5) / lines)).r;
    // The floor is applied HERE and reported by the element, rather than
    // being an invisible clamp that quietly turns quiet into nothing.
    v = v <= u_floor ? 0.0 : (v - u_floor) / max(1.0 - u_floor, 0.001);
    col = colourise(clamp(v, 0.0, 1.0));
  }

  // Frequency graticule. Furniture: it sits under the 3:1 rule like every
  // other boundary in the kit and never competes with the data.
  // ⚠️ Not `gl_` anything. GLSL RESERVES every identifier beginning with
  // `gl_`, so a local named `gl_` is a compile error, and a compile error here
  // is a blank canvas with no other symptom.
  float g = abs(fract(uv.x * 8.0) - 0.5);
  float grat = 1.0 - smoothstep(0.0, 1.4 * u_scale / u_resolution.x * 8.0, g);
  col = mix(col, u_grid, grat * 0.30);

  if (u_grain > 0.0) {
    col += (hash(px + fract(u_time) * 37.0) - 0.5) * u_grain * 0.05;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
