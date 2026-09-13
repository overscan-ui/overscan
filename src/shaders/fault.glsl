/**
 * Overscan fault: damage to the GLASS, drawn over the interface.
 *
 * 🔴 This is the only shader in the kit that sits IN FRONT of the UI, and it is
 * allowed to because of what the constraint actually says. A GLSL pass cannot
 * SAMPLE the DOM; it says nothing about drawing over it. Every effect that
 * needs the image beneath (scanlines, vignette, bloom, chroma) must stay CSS
 * because it MULTIPLIES with what is under it. A fault does not: a dead pixel
 * is black over a chart and black over an empty panel, so it composites
 * correctly without ever reading a thing.
 *
 * ⚠️ Everything here is DECLARED, never detected. A page that could measure its
 * own burn-in would already have fixed it. See REFUSAL.md, "The third kind".
 *
 * Three of the four faults are drawn here. The fourth, a dead region of
 * digitiser, is deliberately NOT drawn and is not in this file at all: it lives
 * in ov-fault.js as a region that swallows pointer events and shows nothing,
 * because a fault you can see is not the fault that study is about.
 *
 * Output is straight alpha and mostly transparent. The element is a sheet of
 * damaged glass laid over the page, not a layer that repaints it.
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * Ghost of a layout that is no longer running. Fixed positions, never redraws.
 * @label Burn-in
 * @range 0, 1
 * @default 0.0
 */
uniform float u_burn;

/**
 * @label Burn-in colour
 * @color
 * @default #ffffff
 */
uniform vec3 u_burnColour;

/**
 * A dead or stuck column, crossing every element and belonging to none.
 * @label Column
 * @range 0, 1
 * @default 0.0
 */
uniform float u_column;

/**
 * Where that column sits, as a fraction of the width.
 * @label Column position
 * @range 0, 1
 * @default 0.63
 */
uniform float u_columnAt;

/**
 * Individual stuck subpixels, permanently lit.
 * @label Stuck pixels
 * @range 0, 1
 * @default 0.0
 */
uniform float u_stuck;

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

/* A rectangle in normalised space, with a soft edge, used for the burnt-in
 * ghost. Soft because phosphor and LCD burn-in do not have crisp edges: the
 * damage diffuses over years. */
float box(vec2 uv, vec2 lo, vec2 hi, float soft) {
  vec2 a = smoothstep(lo - soft, lo + soft, uv);
  vec2 b = smoothstep(hi + soft, hi - soft, uv);
  return a.x * a.y * b.x * b.y;
}

/* The retired layout. A header bar, a left rail, three rows and a footer:
 * generic on purpose, because the point is that it is NOT the layout currently
 * running, and any resemblance to the live UI would read as a rendering bug
 * rather than as history. */
float retired(vec2 uv) {
  float g = 0.0;
  g += box(uv, vec2(0.04, 0.88), vec2(0.96, 0.95), 0.006) * 0.9;   // header
  g += box(uv, vec2(0.04, 0.16), vec2(0.20, 0.86), 0.006) * 0.55;  // left rail
  g += box(uv, vec2(0.24, 0.70), vec2(0.94, 0.78), 0.005) * 0.7;   // row
  g += box(uv, vec2(0.24, 0.56), vec2(0.94, 0.64), 0.005) * 0.7;   // row
  g += box(uv, vec2(0.24, 0.42), vec2(0.78, 0.50), 0.005) * 0.7;   // row
  g += box(uv, vec2(0.04, 0.05), vec2(0.96, 0.11), 0.006) * 0.8;   // footer
  // Two buttons that have not existed for years.
  g += box(uv, vec2(0.72, 0.20), vec2(0.86, 0.28), 0.004) * 0.85;
  g += box(uv, vec2(0.56, 0.20), vec2(0.70, 0.28), 0.004) * 0.85;
  return clamp(g, 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 px = gl_FragCoord.xy;

  /* 🔴 Accumulated PREMULTIPLIED, unpremultiplied once at the end.
   *
   * The obvious way to write this is `col += colour * amount` alongside
   * `a = max(a, amount)`, and it is wrong: the compositor then multiplies by
   * alpha a second time, so a fault asked for at 0.30 lands at 0.09 and burn-in
   * is invisible on screen while looking perfectly correct in the source. That
   * is the same double-blend already fixed once in ornament.glsl.
   *
   * Compositing each fault "over" the last in premultiplied space keeps the
   * arithmetic honest and lets faults overlap correctly: a stuck pixel sitting
   * on the dead column reads as the stuck pixel, not as a blend of the two. */
  vec3 pre = vec3(0.0);
  float a = 0.0;

  // ── BURN-IN ──────────────────────────────────────────────────────────────
  // Additive and STATIC. No u_time anywhere in this term: burn-in does not
  // move, does not animate and does not respond to anything, which is exactly
  // what makes it read as damage rather than as a layer of the interface.
  if (u_burn > 0.0) {
    float g = retired(uv);
    // Unevenly worn, so it does not look like a drawn rectangle. Seeded on
    // position only, again with no time term.
    float wear = 0.75 + 0.25 * hash(floor(px / 24.0));
    // ⚠️ Real burn-in at its true strength is a few percent of alpha, which is
    // accurate and completely invisible in a screenshot or on a phone in
    // daylight. This is the one place the kit exaggerates: the fault has to be
    // legible to be worth demonstrating. u_burn 1.0 is "obvious damage", not
    // "a panel measured in a lab".
    float srcA = g * u_burn * 0.55 * wear;
    pre = u_burnColour * srcA + pre * (1.0 - srcA);
    a = srcA + a * (1.0 - srcA);
  }

  // ── DEAD / STUCK COLUMN ──────────────────────────────────────────────────
  // One column of the panel, crossing everything. It belongs to the glass
  // rather than to any element, so it is measured in DEVICE pixels and does
  // not scale with the layout: that is what makes it read as the screen's
  // damage rather than as a rule someone drew.
  if (u_column > 0.0) {
    float x = floor(u_columnAt * u_resolution.x);
    float d = abs(px.x - x);
    // A hard core with a partial edge, which is how a failed column actually
    // looks: the neighbouring subpixels are affected, not just one.
    float core = step(d, 1.5);
    float edge = step(d, 2.5) * 0.35;
    float srcA = max(core, edge) * u_column;
    // Mostly dead (black), with a few runs stuck bright, because a failed
    // column is rarely uniform down its whole length.
    float lit = step(0.93, hash(vec2(floor(px.y / 3.0), 7.0)));
    vec3 srcC = mix(vec3(0.0), vec3(1.0), lit);
    pre = srcC * srcA + pre * (1.0 - srcA);
    a = srcA + a * (1.0 - srcA);
  }

  // ── STUCK SUBPIXELS ──────────────────────────────────────────────────────
  // Individually lit pixels, permanently on, at fixed positions. One channel
  // each, because a stuck subpixel is red or green or blue, never white.
  if (u_stuck > 0.0) {
    vec2 cell = floor(px / 3.0);
    float h = hash(cell);
    // Sparse: enough to notice on a large surface, not enough to read as
    // noise. Scaled by u_stuck so a caller can ask for a worse panel.
    if (h > 1.0 - 0.00035 * (u_stuck * 40.0)) {
      float which = hash(cell + 3.7);
      vec3 chan = which < 0.34 ? vec3(1.0, 0.0, 0.0)
                : which < 0.67 ? vec3(0.0, 1.0, 0.0)
                               : vec3(0.0, 0.4, 1.0);
      pre = chan;
      a = 1.0;
    }
  }

  // Straight alpha out, which is what the context was created for.
  gl_FragColor = vec4(pre / max(a, 0.0001), clamp(a, 0.0, 1.0));
}
