/**
 * Overscan vision: the machina field.
 *
 * ⚠️ Every other field in this kit is a SCREEN being looked at. This one is a
 * CAMERA looking out, and that is the whole distinction the theme rests on.
 * A screen has phosphor, bloom and scanlines; a sensor has interlace, fixed
 * pattern noise, a readout that sweeps, and a gain that drifts. Those are
 * different artefacts and they are what is drawn here.
 *
 * The four terms, and what each one is:
 *
 *   INTERLACE     alternate field lines, one of them a frame stale. Not a
 *                 scanline: a scanline is a gap between rows of phosphor, an
 *                 interlace is half the picture arriving late.
 *   FIXED PATTERN a per-pixel gain that does NOT change frame to frame. Every
 *                 sensor has one; it is the reason a cheap camera has a faint
 *                 permanent texture that moving the camera does not move.
 *   READOUT SWEEP a bright bar crossing slowly, which is the sensor being
 *                 read rather than anything in the scene.
 *   DROPOUT       short horizontal bands losing gain entirely.
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
 * @default #050202
 */
uniform vec3 u_field;

/**
 * @label Phosphor
 * @color
 * @default #ff6654
 */
uniform vec3 u_phosphor;

/**
 * @label Wash
 * @range 0, 1
 * @default 0.14
 */
uniform float u_wash;

/**
 * @label Wash spread
 * @range 0.5, 8
 * @default 3.6
 */
uniform float u_washSpread;

/**
 * @label Grain
 * @range 0, 1
 * @default 0.22
 */
uniform float u_grain;

/**
 * @label Vignette
 * @range 0, 1
 * @default 0.78
 */
uniform float u_vignette;

/**
 * @label Interlace opacity
 * @range 0, 1
 * @default 0.34
 */
uniform float u_scanOpacity;

/**
 * @label Interlace pitch
 * @range 1, 8
 * @default 3
 */
uniform float u_scanPitch;

/* Buffer pixels per CSS pixel, Y axis. See ov-gl.js. */
uniform float u_scaleY;

/**
 * @label Haze
 * @range 0, 1
 * @default 0.06
 */
uniform float u_haze;

/**
 * @label Dropout
 * @range 0, 1
 * @default 0.12
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
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 px = gl_FragCoord.xy;

  vec3 col = u_field;

  // What the sensor is pointed at: a broad warm return, off centre, drifting
  // slowly. There is no scene here, only the fact that something is out there.
  vec2 c = uv - vec2(0.5 + sin(u_time * 0.07) * 0.06, 0.5);
  float ret = exp(-dot(c * vec2(1.0, 1.3), c * vec2(1.0, 1.3)) * u_washSpread);
  col += u_phosphor * ret * u_wash;

  // FIXED PATTERN NOISE. Seeded on pixel position ONLY, with no time term, so
  // it is burned into the sensor rather than sprinkled on the frame. This is
  // the term that makes it read as a camera.
  float fpn = hash(floor(px * 0.5)) - 0.5;
  col *= 1.0 + fpn * 0.16;
  col += u_phosphor * max(0.0, fpn) * 0.05;

  // READOUT SWEEP. Slow, wraps, and is brightest at its leading edge.
  float sweep = fract(u_time * 0.11);
  float sd = uv.y - sweep;
  sd = sd - floor(sd + 0.5);              // wrap to the short way round
  col += u_phosphor * smoothstep(0.10, 0.0, abs(sd)) * 0.10;

  // INTERLACE. Alternate field lines carry slightly less gain, and the phase
  // flips every frame-ish, which is what makes the picture feel unstable
  // rather than merely striped.
  // CSS pixels, not buffer pixels. See the note in field.glsl.
  float fieldLine = mod(floor(px.y / max(1.0, u_scanPitch * u_scaleY))
                        + floor(u_time * 12.0), 2.0);
  col *= 1.0 - u_scanOpacity * 0.30 * fieldLine;

  // DROPOUT. Short bands losing gain, held for a few frames each so they read
  // as a fault rather than as flicker.
  if (u_glitch > 0.0) {
    float band = floor(px.y / 9.0);
    float t = floor(u_time * 7.0);
    float hit = step(1.0 - u_glitch * 0.10, hash(vec2(band, t)));
    col *= 1.0 - hit * 0.75;
  }

  // Atmosphere between the sensor and whatever it is looking at.
  if (u_haze > 0.0) {
    col += u_phosphor * valueNoise(uv * 3.0 + vec2(u_time * 0.03, 0.0))
           * u_haze * 0.35;
  }

  // Per-frame shot noise, on top of the fixed pattern. Both, because a sensor
  // has both and only having one looks synthetic.
  if (u_grain > 0.0) {
    col += (hash(px + fract(u_time) * 83.0) - 0.5) * u_grain * 0.09;
  }

  // A hard optical vignette: this is a lens, not a screen edge.
  if (u_vignette > 0.0) {
    vec2 v = uv - 0.5;
    float r = dot(v, v) * 2.0;
    col *= 1.0 - u_vignette * 0.72 * r * r;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
