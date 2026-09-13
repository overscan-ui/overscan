/**
 * Overscan field texture.
 *
 * One parameterised shader serves terminal, industrial, cyber and esper. The
 * registers differ in how much of each term they use, not in mechanism, so a
 * shader per theme would be variation that encodes nothing.
 *
 * antiseptic is the deliberate exception and uses filmloop.glsl: its field has
 * no texture at all and its motion is a film loop, which is a different
 * mechanism rather than a different parameter setting.
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
 * @default #0a0a0b
 */
uniform vec3 u_field;

/**
 * @label Phosphor
 * @color
 * @default #ffffff
 */
uniform vec3 u_phosphor;

/**
 * @label Phosphor wash
 * @range 0, 1
 * @default 0.18
 */
uniform float u_wash;

/**
 * @label Wash spread
 * @range 1, 14
 * @default 3.2
 */
uniform float u_washSpread;

/**
 * @label Glitch
 * @range 0, 1
 * @default 0.0
 */
uniform float u_glitch;

/**
 * @label Glitch bands
 * @range 4, 64
 * @default 24
 */
uniform float u_glitchBands;

/**
 * @label Glitch rate
 * @range 1, 30
 * @default 12
 */
uniform float u_glitchRate;

/**
 * @label Scanline opacity
 * @range 0, 1
 * @default 0.42
 */
uniform float u_scanOpacity;

/**
 * @label Scanline pitch
 * @range 1, 12
 * @default 2
 */
uniform float u_scanPitch;

/* Buffer pixels per CSS pixel on the Y axis. See ov-gl.js: NOT u_scale, which
 * is the X ratio and differs from this one whenever the buffer is clamped. */
uniform float u_scaleY;

/**
 * @label Grain
 * @range 0, 0.6
 * @default 0.19
 */
uniform float u_grain;

/**
 * @label Vignette
 * @range 0, 1
 * @default 0.74
 */
uniform float u_vignette;

/**
 * @label Haze
 * @range 0, 1
 * @default 0.0
 */
uniform float u_haze;

/**
 * @label Chroma split
 * @range 0, 4
 * @default 0.0
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

// Broad glow toward the centre, sampled per channel so chroma split is real
// separation rather than a tint.
float wash(vec2 uv, float offset, float spread) {
  vec2 p = uv - 0.5;
  p.x += offset;
  float r = length(p * vec2(1.0, 1.25));
  return exp(-r * r * spread);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 col = u_field;

  // Glitch displaces whole horizontal bands and widens the channel split while
  // a band is active. Time is quantised to glitch frames so the tearing snaps
  // between held states instead of sliding, which is what reads as digital.
  vec2 guv = uv;
  float tear = 0.0;
  float slip = 0.0;
  if (u_glitch > 0.0) {
    float gf = floor(u_time * u_glitchRate);

    // Bursts, not a constant rate. Signal corruption arrives in clusters with
    // quiet between, and each burst hits hard then settles. A glitch that fires
    // every frame at the same strength reads as a texture, not as a fault.
    float burstId = floor(gf / 7.0);
    float fires = step(0.62, hash(vec2(burstId, 11.0)));
    float phase = (gf - burstId * 7.0) / 7.0;
    float energy = u_glitch * fires
                 * (0.35 + 0.65 * hash(vec2(burstId, 23.0)))
                 * exp(-phase * 3.0);

    // Two band scales, chosen per coarse band, so some tears are thick blocks
    // and some are a single line. A uniform band height is the tell that the
    // effect is generated.
    float coarse = floor(uv.y * u_glitchBands * 0.25);
    float fine = floor(uv.y * u_glitchBands);
    float thick = step(0.5, hash(vec2(coarse, gf)));
    float band = mix(coarse, fine, thick);

    /* ⚠️ NOT `active`, WHICH IS A RESERVED WORD IN GLSL ES 1.00. Browsers are
     * lenient enough to compile it and a strict compiler is not, so this read
     * fine for as long as nobody built it anywhere but a browser. Do not
     * rename it back. */
    float fired = step(1.0 - energy * 0.75, hash(vec2(band, gf)));

    // Neighbouring bands share a displacement bias so a block tears together
    // rather than every band going its own way.
    float bias = hash(vec2(coarse, gf + 5.0)) - 0.5;
    float amt = (hash(vec2(band, gf + 17.0)) - 0.5);
    guv.x += fired * mix(amt, bias, 0.6) * energy * 0.18;

    // A rare whole-frame vertical roll, the way a losing sync looks.
    float roll = step(0.96, hash(vec2(gf, 91.0))) * energy;
    guv.y = fract(guv.y + roll * hash(vec2(gf, 7.0)) * 0.4);

    slip = fired * energy;
    tear = fired * step(0.88, hash(vec2(band, gf + 3.0))) * energy;
  }

  float o = (u_chroma + slip * 6.0) / max(u_resolution.x, 1.0);
  vec3 w = vec3(wash(guv, o, u_washSpread), wash(guv, 0.0, u_washSpread), wash(guv, -o, u_washSpread));
  col += u_phosphor * w * u_wash;

  if (u_haze > 0.0) {
    float drift = fbm(guv * vec2(2.4, 3.6) + vec2(u_time * 0.035, u_time * -0.018));
    float shaft = fbm(guv * vec2(0.7, 5.0) + vec2(u_time * 0.02, 0.0));
    col += u_phosphor * (drift * 0.6 + shaft * 0.4) * u_haze * 0.35;
  }

  col += u_phosphor * tear * 0.22;

  // Scanlines darken one line of every pitch. Applied before the vignette so a
  // corner scan line compounds with the falloff, which is the position
  // dependence the contrast tooling has to account for.
  /* 🔴 THE PITCH IS A CSS LENGTH AND gl_FragCoord IS IN BUFFER PIXELS, and for
   * as long as those were treated as the same unit the scanlines were drawn at
   * HALF their intended size on any retina display.
   *
   * That is not merely too fine. At dpr 2 a 2px pitch became one buffer pixel
   * on and one off, which lands exactly at the sampling limit of the screen it
   * is composited onto, and a pattern at that frequency does not render as a
   * fine line: it beats against the pixel grid and collapses into broad bands.
   * ⚠️ That is what iPad was showing. The canvas was correct; what reached the
   * glass was not. Converting to buffer pixels puts the period back to four
   * device pixels, which resamples cleanly.
   *
   * The dark line keeps its 1 CSS pixel thickness at every density, so the
   * duty cycle of a 3px-pitch theme is what it always was. At dpr 1 u_scaleY
   * is 1 and this is byte-for-byte the old expression. */
  float pitch = max(1.0, u_scanPitch * u_scaleY);
  float line = step(u_scaleY, mod(gl_FragCoord.y, pitch));
  col *= 1.0 - (1.0 - line) * u_scanOpacity;

  float g = hash(gl_FragCoord.xy + fract(u_time) * 137.0) - 0.5;
  col += g * u_grain * 0.5;

  vec2 v = uv - 0.5;
  float vig = 1.0 - dot(v, v) * 2.0 * u_vignette;
  col *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
