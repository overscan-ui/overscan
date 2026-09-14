/* <ov-solid> - a model or a surveyed terrain, drawn solid, at the detail it has.
 *
 *   <ov-solid model="descent.json" yaw="-28" pitch="34" spin="4"></ov-solid>
 *
 * The shaded companion to <ov-wireframe>, which draws the same survey as lines.
 * A shaded surface makes two claims a line drawing does not, and each one gets
 * an effect with a single meaning:
 *
 * ⭐ PIXELATION IS RESOLUTION. A surface shaded smoothly between two samples
 * shows ground nobody measured. So the mesh is drawn into a frame with one
 * texel per sample spacing, as the model sits on screen, and laid over the
 * element in blocks. Zoomed out past its detail the blocks are a pixel and
 * vanish; drawn larger than its detail it goes to blocks rather than
 * inventing smoothness, and the readout prints the ratio: "past detail x6,
 * 1 sample per 5.8 px".
 *
 * ⭐ DITHER IS CONFIDENCE. A face measured outright is solid. A face that was
 * inferred (interpolated across a gap, taken from a coarser source) is drawn
 * with an ordered dither whose density IS its confidence: 0.5 keeps half its
 * cells. A face nobody measured is not drawn at all and stays OPEN, the way
 * ov-wireframe leaves unsurveyed ground open. The readout counts all three.
 *
 * Input, as properties because both are structured, or from `model` (a JSON
 * file holding either):
 *   survey  { cols, rows, heights: [row-major, null = unmeasured],
 *             confidence: [row-major 0..1, optional], spacing = 1, scale = 1 }
 *           A cell is two faces; a face's confidence is the lowest of its
 *           three corners, and a face touching an unmeasured height is open.
 *   mesh    { vertices: [[x, y, z] | null], faces: [[a, b, c]],
 *             confidence: [per face 0..1, optional] }
 *   Confidence 1 is measured, between 0 and 1 inferred, 0 or null open, and
 *   anything else unreadable (and open, and counted). With NO confidence given
 *   at all, every face with its heights is drawn as measured and the readout
 *   says confidence was not supplied, rather than saying nothing.
 * Attributes: yaw, pitch (degrees), fov (degrees, 0 = orthographic), spin
 * (degrees per second), as on ov-wireframe.
 *
 * ⚠️ `model`, NOT `src`: every GL element in the kit reads `src` as the URL of
 * its SHADER.
 *
 * ⚠️ TWO PASSES IN A LENT CONTEXT. ov-gl lends each element a canvas and its
 * context while on screen and draws a full-frame fragment shader over one
 * triangle. A mesh needs its own vertex buffer, program and depth, so this
 * element builds them in ready() (which runs again whenever a context is lent
 * or restored) and takes over draw(). It hands the context back as it found
 * it: the full-frame triangle bound, blending on, depth off, no framebuffer.
 */

import { define } from './ov-core.js';
import { REASONS } from './ov-refusal.js';
import './ov-gl.js';

const PRELUDE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/* The same camera as ov-wireframe: model centred and scaled to a unit sphere,
 * turned by yaw about the vertical and pitch about the horizontal, perspective
 * from a distance set by the field of view. */
const MESH_VS = `
attribute vec3 a_pos;
attribute vec3 a_nrm;
attribute float a_conf;
uniform vec3 u_centre;
uniform float u_rad;
uniform vec2 u_rot;
uniform float u_d;
uniform float u_persp;
uniform vec2 u_s;
varying vec3 v_n;
varying float v_c;
vec3 turn(vec3 v) {
  float cy = cos(u_rot.x), sy = sin(u_rot.x), cp = cos(u_rot.y), sp = sin(u_rot.y);
  float x1 = v.x * cy - v.z * sy;
  float z1 = v.x * sy + v.z * cy;
  return vec3(x1, v.y * cp - z1 * sp, v.y * sp + z1 * cp);
}
void main() {
  vec3 q = turn((a_pos - u_centre) / u_rad);
  float k = u_persp > 0.5 ? (u_d - 1.0) * 1.15 : 1.0;
  float w = u_persp > 0.5 ? u_d + q.z : 1.0;
  gl_Position = vec4(q.x * k * u_s.x, q.y * k * u_s.y, q.z * 0.5, w);
  v_n = turn(a_nrm);
  v_c = a_conf;
}`;

/* Flat shading in the theme's colours, and the dither. The threshold is a 4x4
 * ordered (Bayer) matrix on the frame's own texels, so one dither cell is one
 * block: confidence and resolution share a grid rather than beating. */
const MESH_FS = PRELUDE + `
uniform vec3 u_field;
uniform vec3 u_accent;
varying vec3 v_n;
varying float v_c;
float b2(vec2 p) { p = mod(floor(p), 2.0); return 2.0 * p.x + 3.0 * p.y - 4.0 * p.x * p.y; }
float bayer4(vec2 p) { return 4.0 * b2(p) + b2(floor(p / 2.0)); }
void main() {
  if ((bayer4(gl_FragCoord.xy) + 0.5) / 16.0 > v_c) discard;
  vec3 n = normalize(v_n);
  if (!gl_FrontFacing) n = -n;
  float lit = max(dot(n, normalize(vec3(0.35, 0.75, -0.55))), 0.0);
  gl_FragColor = vec4(mix(u_field, u_accent, 0.16 + 0.74 * lit), 1.0);
}`;

/* ov-gl's buffer limits, which its resize() applies and this element's own
 * resize() must match. */
const MAX_DIM = 3072;
const MAX_AREA = 2048 * 2048;
const STRIDE = 7;   /* position 3, normal 3, confidence 1 */

function link(gl, who) {
  const make = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
    console.error(`${who}: mesh shader failed to compile\n${gl.getShaderInfoLog(sh)}`);
    return null;
  };
  const vs = make(gl.VERTEX_SHADER, MESH_VS);
  const fs = make(gl.FRAGMENT_SHADER, MESH_FS);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p;
  console.error(`${who}: mesh shader failed to link\n${gl.getProgramInfoLog(p)}`);
  return null;
}

const finite3 = (p) => Array.isArray(p) && p.length >= 3 && p.every((n) => Number.isFinite(n));

class OvSolid extends Overscan.GL {
  static observedAttributes = ['model', 'yaw', 'pitch', 'fov', 'spin'];

  get shaderName() { return 'solid'; }
  get fps() { return 30; }

  connectedCallback() {
    this._survey = this._survey ?? null;
    this._mesh = this._mesh ?? null;
    if (!this.stage) {
      this.innerHTML = '<div class="ov-solid__stage"><span class="ov-solid__void" hidden></span></div>'
        + '<div class="ov-solid__readout" aria-hidden="true"></div>';
      this.stage = this.querySelector('.ov-solid__stage');
      this.voidNote = this.querySelector('.ov-solid__void');
      this.readout = this.querySelector('.ov-solid__readout');
    }
    this.build();
    this.fetchModel();
    return super.connectedCallback();
  }

  attributeChangedCallback(n) {
    if (!this.stage) return;
    if (n === 'model') this.fetchModel();
    else this.report();
  }

  get survey() { return this._survey; }
  set survey(v) { this._survey = v && typeof v === 'object' ? v : null; this._mesh = null; this.build(); }

  get mesh() { return this._mesh; }
  set mesh(v) { this._mesh = v && typeof v === 'object' ? v : null; this._survey = null; this.build(); }

  async fetchModel() {
    const url = this.getAttribute('model');
    if (!url) return;
    this.modelFail = null;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (this.getAttribute('model') !== url) return;
      this._survey = data.survey && typeof data.survey === 'object' ? data.survey : null;
      this._mesh = !this._survey && data.mesh && typeof data.mesh === 'object' ? data.mesh : null;
    } catch {
      if (this.getAttribute('model') !== url) return;
      this._survey = null;
      this._mesh = null;
      this.modelFail = url;
    }
    this.build();
  }

  /* The input as flat-shaded triangles, and the count of what was withheld. */
  build() {
    const tris = [];
    const L = { faces: 0, measured: 0, inferred: 0, open: 0, unreadable: 0, given: false, spacing: 0, count: 0 };
    const judge = (c) => {
      if (c === null || c === undefined) return null;
      const n = Number(c);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : NaN;
    };
    const face = (a, b, c, conf) => {
      L.faces += 1;
      if (!a || !b || !c) { L.open += 1; return; }
      if (Number.isNaN(conf)) { L.unreadable += 1; L.open += 1; return; }
      if (conf === null || conf <= 0) { L.open += 1; return; }
      if (conf >= 1) L.measured += 1; else L.inferred += 1;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      for (const p of [a, b, c]) tris.push(p[0], p[1], p[2], n[0] / len, n[1] / len, n[2] / len, conf);
    };

    const s = this._survey;
    const m = this._mesh;
    if (s && Number.isInteger(s.cols) && Number.isInteger(s.rows) && Array.isArray(s.heights)) {
      const { cols, rows } = s;
      const sp = Number.isFinite(s.spacing) && s.spacing > 0 ? s.spacing : 1;
      const k = Number.isFinite(s.scale) ? s.scale : 1;
      L.given = Array.isArray(s.confidence);
      L.spacing = sp;
      const at = (c, r) => {
        const h = s.heights[r * cols + c];
        return h === null || h === undefined || !Number.isFinite(Number(h))
          ? null : [(c - (cols - 1) / 2) * sp, Number(h) * k, (r - (rows - 1) / 2) * sp];
      };
      const cf = (c, r) => (L.given ? judge(s.confidence[r * cols + c]) : 1);
      const low = (...cs) => (cs.some((c) => Number.isNaN(c)) ? NaN : cs.some((c) => c === null) ? null : Math.min(...cs));
      for (let r = 0; r + 1 < rows; r++) {
        for (let c = 0; c + 1 < cols; c++) {
          face(at(c, r), at(c + 1, r), at(c, r + 1), low(cf(c, r), cf(c + 1, r), cf(c, r + 1)));
          face(at(c + 1, r), at(c + 1, r + 1), at(c, r + 1), low(cf(c + 1, r), cf(c + 1, r + 1), cf(c, r + 1)));
        }
      }
    } else if (m && Array.isArray(m.vertices) && Array.isArray(m.faces)) {
      L.given = Array.isArray(m.confidence);
      const vert = (i) => (Number.isInteger(i) && finite3(m.vertices[i]) ? m.vertices[i] : null);
      const edges = [];
      m.faces.forEach((f, i) => {
        const [a, b, c] = Array.isArray(f) ? f.map(vert) : [null, null, null];
        if (a && b && c) edges.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
        face(a, b, c, L.given ? judge(m.confidence[i]) : 1);
      });
      edges.sort((x, y) => x - y);
      L.spacing = edges.length ? edges[edges.length >> 1] : 0;
    }

    // Fit: the drawn faces only, so open ground does not size the model.
    let cx = 0, cy = 0, cz = 0;
    const nv = tris.length / STRIDE;
    for (let i = 0; i < tris.length; i += STRIDE) { cx += tris[i]; cy += tris[i + 1]; cz += tris[i + 2]; }
    L.centre = nv ? [cx / nv, cy / nv, cz / nv] : [0, 0, 0];
    let rad = 0;
    for (let i = 0; i < tris.length; i += STRIDE) {
      rad = Math.max(rad, Math.hypot(tris[i] - L.centre[0], tris[i + 1] - L.centre[1], tris[i + 2] - L.centre[2]));
    }
    L.rad = rad || 1;
    L.count = nv;
    L.data = new Float32Array(tris);
    L.hasInput = !!(s || m);
    this.list = L;
    this.upload();
    this.report();
  }

  num(raw, dflt) {
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? v : dflt;
  }

  /* How far the model reaches on screen, as its largest half-width and
   * half-height in projected units, over a whole turn if it spins. The same
   * fit as ov-wireframe: fitting the bounding sphere instead left a wide flat
   * survey a small patch in the middle of its stage, and fitting each frame
   * would breathe as it turns. One vertex per face is enough to find it. */
  reach(pitch, d, persp) {
    const L = this.list;
    const spins = this.num(this.getAttribute('spin'), 0) !== 0 && !this.still();
    const yaw0 = this.num(this.getAttribute('yaw'), 30) * Math.PI / 180;
    const key = [spins, yaw0, pitch, d, persp, L && L.count].join();
    if (this.extent && this.extent.key === key) return this.extent;
    let mx = 1e-6, my = 1e-6;
    const turns = spins ? 16 : 1;
    const data = L ? L.data : [];
    const k = persp ? (d - 1) * 1.15 : 1;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (let n = 0; n < turns; n++) {
      const yaw = spins ? (2 * Math.PI * n) / turns : yaw0;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let i = 0; i < data.length; i += STRIDE * 3) {
        const x = (data[i] - L.centre[0]) / L.rad, y = (data[i + 1] - L.centre[1]) / L.rad, z = (data[i + 2] - L.centre[2]) / L.rad;
        const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const wv = persp ? d + z2 : 1;
        mx = Math.max(mx, Math.abs((x1 * k) / wv));
        my = Math.max(my, Math.abs((y2 * k) / wv));
      }
    }
    this.extent = { key, mx, my };
    return this.extent;
  }

  still() {
    return this.reduced ? this.reduced.matches : matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* The camera, and how many pixels one sample spacing covers at the model's
   * centre, for a stage `w` by `h` in whatever unit the caller wants back. */
  view(t, w, h) {
    const L = this.list;
    const yaw = (this.num(this.getAttribute('yaw'), 30) + (this.still() ? 0 : this.num(this.getAttribute('spin'), 0) * t)) * Math.PI / 180;
    const pitch = this.num(this.getAttribute('pitch'), 24) * Math.PI / 180;
    const fov = this.num(this.getAttribute('fov'), 40);
    const persp = fov > 0;
    const d = persp ? 1 / Math.tan((fov * Math.PI / 180) / 2) + 1 : 1;
    const { mx, my } = this.reach(pitch, d, persp);
    // Pixels per projected unit, so the model's reach fills 88% of the stage.
    const S = Math.min((w / 2) / mx, (h / 2) / my) * 0.88;
    const centreScale = persp ? ((d - 1) * 1.15) / d : 1;
    return {
      yaw, pitch, d, persp, sx: S / (w / 2), sy: S / (h / 2),
      samplePx: L && L.spacing ? (L.spacing / L.rad) * S * centreScale : 0,
    };
  }

  /* ov-gl sizes the buffer from the element's box, which here includes the
   * readout. The picture belongs to the stage, so measure that instead, with
   * ov-gl's own limits. */
  resize() {
    if (!this.stage) return;
    const cw = this.stage.clientWidth, ch = this.stage.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
    let w = Math.max(1, Math.round(cw * dpr));
    let h = Math.max(1, Math.round(ch * dpr));
    w = Math.min(w, MAX_DIM);
    h = Math.min(h, MAX_DIM);
    if (w * h > MAX_AREA) {
      const k = Math.sqrt(MAX_AREA / (w * h));
      w = Math.max(1, Math.floor(w * k));
      h = Math.max(1, Math.floor(h * k));
    }
    this.scale = w / Math.max(1, cw);
    this.scaleY = h / Math.max(1, ch);
    this.report();
    if (!this.canvas || (w === this.canvas.width && h === this.canvas.height)) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.prog && this.gl) { try { this.draw(this.gl); } catch { /* reported by the loop */ } }
  }

  /* Runs whenever a context is lent or restored: everything below belongs to
   * that context, and nothing from a previous one may be reused. */
  ready() {
    const gl = this.gl;
    this.meshProg = null;
    this.fbo = null;
    this.fboW = 0;
    this.fboH = 0;
    if (!gl) return;
    this.meshProg = link(gl, this.localName);
    if (!this.meshProg) { this.setAttribute('data-ov-shader', 'failed'); return; }
    const p = this.meshProg;
    this.at = {
      pos: gl.getAttribLocation(p, 'a_pos'), nrm: gl.getAttribLocation(p, 'a_nrm'), conf: gl.getAttribLocation(p, 'a_conf'),
      centre: gl.getUniformLocation(p, 'u_centre'), rad: gl.getUniformLocation(p, 'u_rad'),
      rot: gl.getUniformLocation(p, 'u_rot'), d: gl.getUniformLocation(p, 'u_d'),
      persp: gl.getUniformLocation(p, 'u_persp'), s: gl.getUniformLocation(p, 'u_s'),
      field: gl.getUniformLocation(p, 'u_field'), accent: gl.getUniformLocation(p, 'u_accent'),
    };
    this.meshBuf = gl.createBuffer();
    // The same full-frame triangle ov-gl binds, so whatever draws in this
    // context next finds exactly what it expects bound.
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.upload();
  }

  upload() {
    const gl = this.gl;
    if (!gl || !this.meshBuf || !this.list) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.list.data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
  }

  target(gl, fw, fh) {
    if (this.fbo && this.fboW === fw && this.fboH === fh) return this.fboOk;
    if (!this.fbo) {
      this.fbo = gl.createFramebuffer();
      this.frameTex = gl.createTexture();
      this.depth = gl.createRenderbuffer();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, fw, fh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    this.fboOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fboW = fw;
    this.fboH = fh;
    return this.fboOk;
  }

  draw(gl) {
    if (!this.prog || !this.canvas) return;
    const w = this.canvas.width, h = this.canvas.height;
    if (!w || !h) return;
    const L = this.list;
    gl.clearColor(0, 0, 0, 0);
    if (!this.meshProg || !L || !L.count) { gl.clear(gl.COLOR_BUFFER_BIT); return; }

    const style = this.computed();
    const t = (performance.now() - this.t0) / 1000;
    const v = this.view(t, w, h);
    const block = Math.max(1, Math.round(v.samplePx));
    const fw = Math.max(1, Math.ceil(w / block));
    const fh = Math.max(1, Math.ceil(h / block));
    if (!this.target(gl, fw, fh)) {
      if (this.getAttribute('data-ov-shader') !== 'failed') this.setAttribute('data-ov-shader', 'failed');
      return;
    }

    // Pass 1: the mesh, into a frame one texel per block.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, fw, fh);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.meshProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
    const A = this.at;
    const f = Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(A.pos);
    gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, STRIDE * f, 0);
    gl.enableVertexAttribArray(A.nrm);
    gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, STRIDE * f, 3 * f);
    gl.enableVertexAttribArray(A.conf);
    gl.vertexAttribPointer(A.conf, 1, gl.FLOAT, false, STRIDE * f, 6 * f);
    gl.uniform3f(A.centre, L.centre[0], L.centre[1], L.centre[2]);
    gl.uniform1f(A.rad, L.rad);
    gl.uniform2f(A.rot, v.yaw, v.pitch);
    gl.uniform1f(A.d, v.d);
    gl.uniform1f(A.persp, v.persp ? 1 : 0);
    gl.uniform2f(A.s, v.sx, v.sy);
    gl.uniform3fv(A.field, this.rgb(style, '--ov-field'));
    gl.uniform3fv(A.accent, this.rgb(style, '--ov-accent'));
    gl.drawArrays(gl.TRIANGLES, 0, L.count);
    gl.disableVertexAttribArray(A.nrm);
    gl.disableVertexAttribArray(A.conf);
    gl.disableVertexAttribArray(A.pos);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Pass 2: the frame over the element, in blocks.
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(this.prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    this.set('u_frame', gl.uniform1i, 0);
    this.set('u_frameSize', gl.uniform2f, fw, fh);
    this.set('u_block', gl.uniform1f, block);
    this.set('u_resolution', gl.uniform2f, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.drawn = { block, fw, fh };
    const now = performance.now();
    if (now - (this.lastReport || 0) > 400) { this.lastReport = now; this.report(); }
  }

  /* Driven by the data and the stage size, not by drawing: an instrument
   * scrolled off screen stops drawing and must not stop saying what it holds. */
  report() {
    const L = this.list;
    if (!this.readout || !L) return;
    const cw = this.stage.clientWidth, ch = this.stage.clientHeight;
    const refuse = (words) => {
      this.setAttribute('data-ov-refusal', 'unknown');
      this.voidNote.hidden = false;
      this.voidNote.textContent = words;
      this.readout.textContent = '';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', `Solid model, ${REASONS.unknown}: ${words}`);
    };
    if (this.modelFail) return refuse(`model failed to load: ${this.modelFail}`);
    if (!L.hasInput || !L.faces) return refuse('no mesh');
    if (!L.count) return refuse(`no face measured: ${L.open} of ${L.faces} open`);
    this.removeAttribute('data-ov-refusal');
    this.voidNote.hidden = true;

    const parts = [[`${L.faces} faces`, '']];
    parts.push([`${L.measured} measured`, '']);
    if (L.inferred) parts.push([`${L.inferred} inferred, dithered by confidence`, 'is-doubt']);
    if (L.open) parts.push([`${L.open} open`, 'is-open']);
    if (L.unreadable) parts.push([`${L.unreadable} with unreadable confidence, left open`, 'is-open']);
    if (!L.given) parts.push(['confidence not supplied: faces with heights drawn as measured', 'is-doubt']);
    if (cw && ch) {
      const px = this.view(0, cw, ch).samplePx;          // CSS px per sample
      const block = Math.max(1, Math.round(px * (this.scale || 1)));
      const per = px >= 10 ? px.toFixed(0) : px.toFixed(1);
      parts.push(block > 1
        ? [`past detail x${block}: 1 sample per ${per} px, drawn in blocks`, 'is-doubt']
        : [`within detail: 1 sample per ${per} px`, '']);
    }
    const shader = this.getAttribute('data-ov-shader');
    if (shader && shader !== 'ok') parts.push([`not drawn: shader ${shader}`, 'is-open']);

    const key = parts.map((p) => p[0]).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.readout.innerHTML = parts.map(([words, cls]) => `<span${cls ? ` class="${cls}"` : ''}>${words}</span>`).join('');
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `Solid model, ${parts.map((p) => p[0]).join(', ')}`);
  }
}

define('ov-solid', OvSolid);

export { OvSolid };
