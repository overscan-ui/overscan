/**
 * Overscan beam: the vector field.
 *
 * 🔴 EVERY OTHER FIELD IN THIS KIT IS SIMULTANEOUS AND THIS ONE IS NOT. A
 * raster visits every pixel every frame in the same fixed order, so the whole
 * picture has one age and the artefacts are all about the SWEEP: scanlines,
 * interlace, phosphor pitch. An X-Y display has no sweep and no pixels. It has
 * a display LIST, and it draws it one figure at a time, so at any instant the
 * figure drawn at the top of the list has been decaying for a whole refresh
 * and the one drawn last is still hot. The brightness gradient across this
 * field is DRAW ORDER. Nothing else here can say that.
 *
 * What follows from that, and none of it is decoration:
 *
 *   NO SCANLINES    there is no raster to have gaps between. `vector` is the
 *                   only theme in the kit at scan_opacity 0, and finish.css
 *                   draws nothing rather than drawing something faint.
 *   NO GRAIN        phosphor grain is a property of a screen being swept. A
 *                   stroke display has beam JITTER instead: the deflection
 *                   yoke is analogue, so the whole figure breathes and each
 *                   figure breathes slightly differently. That is a property
 *                   of the stroke, so it lives here rather than in a token.
 *   DWELL           a beam deposits light per unit TIME, so it burns where it
 *                   decelerates. On a closed figure that means the CORNERS.
 *   OVERSHOOT       and a beam with mass runs past the corner before the
 *                   deflection catches it, which is why every edge here is
 *                   drawn longer than the box it belongs to. The `overshoot`
 *                   control furniture is the same fact on a button.
 *   RETRACE         a real display blanks the beam while it flies from one
 *                   figure to the next. Blanking is never perfect, and the
 *                   faint wrong-coloured lines between the figures are what
 *                   imperfect blanking looks like. They are the display
 *                   admitting the order it chose.
 *
 * ⚠️ THE REFRESH IS DELIBERATELY SLOW, AT ABOUT 0.6Hz RATHER THAN 40. At a
 * real refresh rate the age gradient exists but completes faster than the eye
 * integrates, so the mechanism would be perfectly implemented and completely
 * invisible - which is the same failure as a mechanism that was only gestured
 * at. This runs the real thing at a legible rate. It is the one number in the
 * file chosen for the viewer rather than for the physics, and it is stated
 * here rather than buried.
 *
 * ⚠️ NOT scope.glsl. That draws ONE trace of real data and earns GL on dwell
 * alone. This draws a whole display list and earns it on ORDER: dwell is a
 * term in it rather than the argument.
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
 * @default #000000
 */
uniform vec3 u_field;

/**
 * @label Beam
 * @color
 * @default #ff4fd8
 */
uniform vec3 u_phosphor;

/**
 * @label Retrace
 * @color
 * @default #7d5cff
 */
uniform vec3 u_accent2;

/**
 * @label Wash
 * @range 0, 1
 * @default 0.05
 */
uniform float u_wash;

/**
 * @label Wash spread
 * @range 0.5, 8
 * @default 6.0
 */
uniform float u_washSpread;

/**
 * @label Vignette
 * @range 0, 1
 * @default 0.62
 */
uniform float u_vignette;

/* Five figures of four edges each. The display list is small on purpose: a
 * vector display could only ever draw what it had time to draw before the
 * phosphor gave out, which is why these games have so few things on screen. */
const float CYCLE = 1.6;   /* seconds for one pass of the whole list */
const float SEGS = 20.0;   /* figures * edges, and the phase denominator */

/* ⚠️ A FIELD IS A BACKDROP AND THIS ONE HAD TO BE TOLD SO. At full level the
 * display list is a picture: bright closed figures that read as CONTENT, and
 * the interface ends up sitting on top of something that is competing with it.
 * Every other field in the kit is a texture and never has this problem. The
 * fix is not to draw less of the mechanism - the order gradient, the dwell,
 * the overshoot and the retrace are all still here - it is to run the tube at
 * an idle. This is what the tube is doing BEFORE anything asks it to draw. */
const float LEVEL = 0.26;

/* Sine-free, for the reason spelled out above the vec2 hash: sin() loses the
 * phase bits that select the value once its argument is large. */
float hash(float n) {
  float p = fract(n * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

/* Distance from p to segment ab, and how far along ab the nearest point is.
 * Both, because dwell needs the parameter and the profile needs the distance,
 * and computing the projection twice for one segment is the kind of waste
 * that adds up over twenty-five of them per pixel. */
vec2 seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}

vec2 corner(float f, float e, vec2 res, float S) {
  vec2 c = vec2(0.17 + hash(f * 3.0 + 0.5) * 0.66,
                0.17 + hash(f * 7.0 + 1.5) * 0.66) * res;
  vec2 h = vec2(0.055 + hash(f * 11.0 + 2.5) * 0.095,
                0.045 + hash(f * 13.0 + 3.5) * 0.085) * S;
  /* 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left. */
  float sx = (e == 0.0 || e == 3.0) ? -1.0 : 1.0;
  float sy = (e < 2.0) ? 1.0 : -1.0;
  /* Each figure drifts on its own, because one yoke driving every figure the
     same way would read as the whole image sliding rather than as analogue
     deflection. */
  vec2 drift = vec2(sin(u_time * 0.53 + f * 2.1), cos(u_time * 0.41 + f * 1.7))
               * S * 0.004;
  return c + vec2(sx * h.x, sy * h.y) + drift;
}

/* How bright a segment drawn `phase` of the way through the list is right now.
 * x is the settled level, which is the age gradient; y is the hot spot, which
 * is the beam itself and lasts a fraction of one pass. */
vec2 ageLevel(float phase) {
  float age = fract(u_time / CYCLE - phase) * CYCLE;
  return vec2(exp(-age * 0.62), exp(-age * 22.0));
}

void main() {
  vec2 res = u_resolution;
  vec2 uv = gl_FragCoord.xy / res;
  float S = min(res.x, res.y);

  /* Yoke jitter: one slow term for the supply and one fast one for the ring,
     applied to the SAMPLE POINT so it costs nothing per segment. */
  vec2 P = gl_FragCoord.xy - vec2(
    sin(u_time * 1.7) * 0.55 + sin(u_time * 11.3) * 0.22,
    cos(u_time * 1.3) * 0.45 + sin(u_time * 9.1) * 0.20);

  float ovr = S * 0.010;           /* how far a stroke runs past its corner */
  float cw = max(0.8, S * 0.0011);  /* core half-width, in pixels */
  float hw = max(2.0, S * 0.0011 * u_washSpread);

  float lum = 0.0;      /* the beam */
  float re = 0.0;       /* the retrace, kept separate: it is a different gun */

  for (int f = 0; f < 5; f++) {
    float ff = float(f);
    for (int e = 0; e < 4; e++) {
      float ee = float(e);
      vec2 a = corner(ff, ee, res, S);
      vec2 b = corner(ff, mod(ee + 1.0, 4.0), res, S);
      /* OVERSHOOT: the drawn stroke is longer than the edge, at both ends. */
      vec2 d = normalize(b - a);
      vec2 s = seg(P, a - d * ovr, b + d * ovr);

      vec2 lv = ageLevel((ff * 4.0 + ee) / SEGS);
      /* DWELL: the beam decelerates into the corner and accelerates out, so
         the ends of every stroke carry more energy per pixel than the middle
         does. This is the term a stroked polyline cannot express. */
      float ends = max(smoothstep(0.22, 0.0, s.y), smoothstep(0.78, 1.0, s.y));
      float dwell = 1.0 + 1.15 * ends;

      float core = exp(-(s.x * s.x) / (cw * cw));
      float halo = exp(-s.x / hw);
      lum += (core + halo * 0.30) * dwell * (lv.x + lv.y * 1.5);
    }

    /* RETRACE, from where this figure closed to where the next one opens. */
    vec2 ra = corner(ff, 0.0, res, S);
    vec2 rb = corner(mod(ff + 1.0, 5.0), 0.0, res, S);
    vec2 rs = seg(P, ra, rb);
    vec2 rlv = ageLevel((ff * 4.0 + 3.6) / SEGS);
    re += exp(-(rs.x * rs.x) / (cw * cw * 2.2)) * rlv.x * 0.085;
  }

  vec3 col = u_field;
  col += u_phosphor * lum * LEVEL;
  col += u_accent2 * re * LEVEL;

  /* Light scattered inside the glass by everything above. Broad, and centred,
     because the scatter is a property of the tube and not of the picture. */
  vec2 c = uv - 0.5;
  col += u_phosphor * exp(-dot(c, c) * u_washSpread) * u_wash;

  /* A deep glass vignette. A vector tube is usually behind a heavy filter,
     which is how you get a black that black with the beam that bright. */
  if (u_vignette > 0.0) {
    float r = dot(c, c) * 2.0;
    col *= 1.0 - u_vignette * 0.70 * r * r;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
