// Film links: set CLOCKS[...].film to a YouTube URL to show "Watch the film" for that clock.
// Caustic clocks: the light of the designed plates, traced live on the GPU.
//
// Each frame, N rays leave a 1 mm white LED, pass through the plates at the angles the clock's motors hold at this
// moment, and land on the wall. The model is the paraxial design model of caustix.optics (thin plates, the walk across
// each gap, the aperture), with the bare-LED ray geometry and the dispersion of acrylic of caustix.lamp. Offline it
// matches the exact ray tracer at correlation 0.99 (tools/web_export.py --check in the design repository).
// Frames are averaged (an exponential moving average), as a camera's exposure would, so the light is smooth when the
// plates stand still and flows while they turn. Tone mapping follows the films (contrast 1.45, filmic curve).

"use strict";

const CLOCKS = {
  "netsuke": { title: "Folded Light", sub: "second edition · the twelve double-hours as netsuke",
               film: null, filmTitle: "Folded Light (second edition)" },
  "minute-clock": { title: "The Minute Clock", sub: "a new number every minute · the same eight plates", film: null, filmTitle: "The Minute Clock" },
  "folded-light": { title: "Folded Light", sub: "first edition · the twelve double-hours as woodcuts",
                    film: null, filmTitle: "Folded Light (first edition)" },
  "twelve-keys": { title: "The Twelve Keys", sub: "the Great Work, one key each hour",
                   film: null, filmTitle: "The Twelve Keys" },
};
const ORDER = ["netsuke", "twelve-keys", "minute-clock", "folded-light"];
const ANIMAL = { ox: "the Ox", tiger: "the Tiger", rabbit: "the Rabbit", dragon: "the Dragon", snake: "the Snake",
                 horse: "the Horse", goat: "the Goat", monkey: "the Monkey", rooster: "the Rooster", dog: "the Dog",
                 boar: "the Boar", rat: "the Rat" };
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// ---------------------------------------------------------------------------------------------- time and motion
// The drive (caustix.projector.Drive): each picture stands still for dwell_s from the start of its period, then the
// plates accelerate over blend_s, cruise, and decelerate into the next picture.
function progress(tau, c) {
  const T = (c.period || c.hpp * 3600) - c.dwell_s, e = Math.min(c.blend_s, T / 2);
  tau = Math.min(Math.max(tau, 0), T);
  const v = 1 / (T - e);
  if (tau < e) return 0.5 * v * tau * tau / e;
  if (tau <= T - e) return 0.5 * v * e + v * (tau - e);
  return 1 - 0.5 * v * (T - tau) * (T - tau) / e;
}
function hourFloat(t, c) {          // t: drive seconds; 0 = 01:00, when the first picture begins
  const P = c.period || c.hpp * 3600, h = Math.floor(t / P);
  return h + progress(t - h * P - c.dwell_s, c);
}
function minuteDriveTime(date) {    // the minute clock: number n gathers at the top of minute n (60 at :00)
  const m = date.getMinutes(), s = date.getSeconds() + date.getMilliseconds() / 1000;
  return ((m - 1 + 60) % 60) * 60 + s;
}
function driveTime(date) {          // caustix film: clock(h, m, s) = ((h - 1) % 24) * 3600 + m * 60 + s
  const h = date.getHours(), m = date.getMinutes(), s = date.getSeconds() + date.getMilliseconds() / 1000;
  return ((h - 1 + 24) % 24) * 3600 + m * 60 + s;
}
const smooth = u => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };
const mod = (a, n) => ((a % n) + n) % n;
// free angles (caustix.projector.Choreography): plates leave one after another and arrive in reverse order
function choreoTurns(TH, minTurn) {
  const K = TH.length;
  return TH.map((row, k) => row.map((a, p) => {
    const d = mod(TH[(k + 1) % K][p] - a, 360);
    return d > 1e-6 ? (d < minTurn ? d + 360 : d) : 0;
  }));
}
function plateAngles(hf, c) {
  const K = c.K, k = Math.floor(hf), s = hf - k, a = c.TH[mod(k, K)];
  if (!c.free) {                    // gear train: angles linear in hf (caustix.projector.angles_for)
    return c.TH[0].map((a0, p) => mod(a0 + hf * (c.TH[1][p] - a0), 360));
  }
  const step = c.turns[mod(k, K)];
  const th = a.slice();
  let j = 0;
  for (let p = 0; p < th.length; p++) {
    if (step[p] > 0) {
      const lo = j * c.stagger, hi = 1 - j * c.stagger;
      th[p] = a[p] + smooth((s - lo) / Math.max(hi - lo, 1e-9)) * step[p];
      j++;
    }
  }
  return th.map(x => mod(x, 360));
}

// ---------------------------------------------------------------------------------------------- GPU programs
const RAY_VS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uSlopes;
uniform int uP;
uniform vec2 uCS[8];          // cos, sin of each plate's angle
uniform float uCdf[24], uCsBin[24], uNBin[24];
uniform vec3 uRgb[24];
uniform float uStop, uLedR, uU, uThick, uW, uD, uGap, uRap, uFeather, uExt, uMag, uFrame;
uniform uint uSeed;
out vec3 vCol;
uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float rnd(inout uint s) { s = hash(s); return float(s >> 8) * (1.0 / 16777216.0); }
void main() {
  uint s = hash(uint(gl_VertexID) * 0x9E3779B9u ^ uSeed);
  float u = rnd(s); int b = 23;
  for (int i = 0; i < 24; i++) { if (u <= uCdf[i]) { b = i; break; } }
  float a = 6.2831853 * rnd(s), r = uStop * sqrt(rnd(s));
  vec2 hit = r * vec2(cos(a), sin(a));
  float a2 = 6.2831853 * rnd(s), r2 = uLedR * sqrt(rnd(s));
  vec2 led = r2 * vec2(cos(a2), sin(a2));
  vec2 slope = (hit - led) / uU;
  float cz = uU / sqrt(dot(hit - led, hit - led) + uU * uU);
  float w = cz * cz * cz * cz;
  vec2 x = (hit + uThick * slope / uNBin[b]) / uW;
  vec2 v = slope * uD / uW;
  float cs = uCsBin[b];
  for (int p = 0; p < 8; p++) {
    if (p >= uP) break;
    if (p > 0) {
      x += uGap * v;
      w *= clamp((uRap - length(x)) / uFeather + 0.5, 0.0, 1.0);
    }
    vec2 c = uCS[p];
    vec2 xl = vec2(c.x * x.x + c.y * x.y, -c.y * x.x + c.x * x.y);
    vec2 g = texture(uSlopes, vec3(xl / uExt + 0.5, float(p))).rg;
    v += cs * vec2(c.x * g.x - c.y * g.y, c.y * g.x + c.x * g.y);
  }
  vec2 y = (x + v) / uMag;
  gl_Position = vec4(-y.x / uFrame, y.y / uFrame, 0.0, 1.0);     // front view: the wall seen from the lamp side
  gl_PointSize = 1.0;
  vCol = uRgb[b] * w;
}`;
const RAY_FS = `#version 300 es
precision highp float;
in vec3 vCol; out vec4 o;
void main() { o = vec4(vCol, 1.0); }`;

const QUAD_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// moving average: hist = mix(hist, fresh * norm, alpha)
const AVG_FS = `#version 300 es
precision highp float;
uniform sampler2D uFresh, uHist; uniform float uNorm, uAlpha;
in vec2 vUv; out vec4 o;
void main() { o = mix(texture(uHist, vUv), texture(uFresh, vUv) * uNorm, uAlpha); }`;

// contrast as the films (E -> ref (E / ref)^1.45), then the marks, into a mip-mapped texture for the bloom
const GRADE_FS = `#version 300 es
precision highp float;
uniform sampler2D uHist; uniform float uRef, uContrast, uRpic, uFrame, uMinute, uSecond, uAspect;
in vec2 vUv; out vec4 o;
float seg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return exp(-pow(length(pa - ba * h) / w, 2.0));
}
void main() {
  vec3 E = max(texture(uHist, vUv).rgb, 0.0);
  E = uRef * pow(E / uRef, vec3(uContrast));
  vec2 p = (vUv * 2.0 - 1.0) * uFrame;                 // wall, unit coordinates, y up
  float r = length(p);
  vec3 markCol = vec3(0.78, 0.92, 0.42);
  // seconds dial: sixty faint dots at 1.40 picture radii, the current second bright and white
  float ang = atan(p.x, p.y);                           // clockwise from 12
  float k = floor(mod(ang / 6.2831853 * 60.0 + 0.5, 60.0));
  float ak = k / 60.0 * 6.2831853;
  vec2 dotc = 1.40 * uRpic * vec2(sin(ak), cos(ak));
  float dd = length(p - dotc);
  float isNow = 1.0 - step(0.5, abs(k - mod(uSecond, 60.0)));
  E += uRef * markCol * 0.30 * exp(-pow(dd / (0.0038), 2.0)) * (1.0 - isNow);
  E += uRef * vec3(1.0, 0.98, 0.92) * 1.6 * exp(-pow(dd / 0.0042, 2.0)) * isNow;
  // minute mark: a slim bar at 1.10-1.26 picture radii, forked at its inner end (the "comet")
  float am = uMinute / 60.0 * 6.2831853;
  vec2 er = vec2(sin(am), cos(am)), et = vec2(er.y, -er.x);
  vec2 a0 = 1.26 * uRpic * er, a1 = 1.15 * uRpic * er;
  float m = seg(p, a0, a1, 0.0022);
  m += 0.8 * seg(p, a1, 1.09 * uRpic * er + 0.012 * uRpic * et, 0.0016);
  m += 0.8 * seg(p, a1, 1.09 * uRpic * er - 0.012 * uRpic * et, 0.0016);
  E += uRef * markCol * 1.1 * m;
  o = vec4(E, 1.0);
}`;

// the photograph: bloom, wall, vignette, filmic curve, grain
const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uC; uniform float uRef, uTime, uFade;
uniform vec3 uWhite;
in vec2 vUv; out vec4 o;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 x) { x = clamp(x, 0.0, 1.0); return mix(12.92 * x, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x)); }
void main() {
  vec3 E = textureLod(uC, vUv, 0.0).rgb;
  vec3 b1 = textureLod(uC, vUv, 2.5).rgb, b2 = textureLod(uC, vUv, 5.0).rgb, b3 = textureLod(uC, vUv, 7.0).rgb;
  E = E * (1.0 - 0.035 - 0.012) + 0.035 * b1 + 0.012 * b2;
  E += 0.06 * b3;                                      // reflections between the plates and the room: a faint veil
  float plaster = 1.0 + 0.012 * (vnoise(vUv * 900.0) - 0.5) + 0.016 * (vnoise(vUv * 260.0) - 0.5) + 0.02 * (vnoise(vUv * 40.0) - 0.5);
  E *= plaster;
  vec2 q = vUv - 0.5;
  float vig = 1.0 - 0.22 * dot(q, q) * 2.0;
  vec3 x = aces(E / uRef * 0.8 * uWhite * vig);
  float lum = dot(x, vec3(0.333));
  x += 0.010 * sqrt(lum + 0.02) * (h21(vUv * 1000.0 + uTime) - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.90, 1.0, length(q) * 2.0);   // fade into the page before the canvas edge
  o = vec4(srgb(x) * uFade * edge, 1.0);
}`;

// a small luminance image of the light (no marks), read back for the sound
const PROBE_FS = `#version 300 es
precision highp float;
uniform sampler2D uHist; uniform float uRef;
in vec2 vUv; out vec4 o;
void main() { float l = dot(texture(uHist, vUv).rgb, vec3(0.2126, 0.7152, 0.0722)); o = vec4(vec3(clamp(0.25 * l / uRef, 0.0, 1.0)), 1.0); }`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, "");
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function target(gl, size, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = mip ? Math.floor(Math.log2(size)) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { t, fb, size };
}

// ---------------------------------------------------------------------------------------------- the viewer
class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error("This page needs WebGL 2.");
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float"))
      throw new Error("This page needs floating-point render targets (EXT_color_buffer_float).");
    gl.getExtension("EXT_float_blend");
    this.gl = gl;
    this.ray = compile(gl, RAY_VS, RAY_FS);
    this.avg = compile(gl, QUAD_VS, AVG_FS);
    this.grade = compile(gl, QUAD_VS, GRADE_FS);
    this.show = compile(gl, QUAD_VS, SHOW_FS);
    this.probe = compile(gl, QUAD_VS, PROBE_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    for (const prog of [this.avg, this.grade, this.show, this.probe]) {
      const loc = gl.getAttribLocation(prog.p, "aPos");
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    this.vaoEmpty = gl.createVertexArray();
    this.S = 768;                                          // accumulation resolution
    this.fresh = target(gl, this.S, false);
    this.hist = [target(gl, this.S, false), target(gl, this.S, false)];
    this.graded = target(gl, this.S, true);
    this.PS = 48;                                          // probe resolution
    const pt = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, pt);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.PS, this.PS);
    this.probeFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pt, 0);
    this.probePixels = new Uint8Array(this.PS * this.PS * 4);
    this.lastHist = null;
    this.rays = 400000;
    this.frame = 0;
    this.fade = 0;
    this.clock = null;
  }

  async load(name) {
    const gl = this.gl;
    const c = await (await fetch(`data/${name}/clock.json`)).json();
    const buf = await (await fetch(`data/${name}/slopes.f16`)).arrayBuffer();
    c.turns = choreoTurns(c.TH, c.min_turn);
    c.cdf = []; let acc = 0;
    for (const p of c.lam_p) { acc += p; c.cdf.push(acc); }
    c.cdf[c.cdf.length - 1] = 1.0;
    c.nbin = c.lam.map(l => { const l2 = (l * 1e-3) ** 2; return Math.sqrt(1 + 1.1819 * l2 / (l2 - 0.011313)); });
    if (this.slopes) gl.deleteTexture(this.slopes);
    this.slopes = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.slopes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG16F, c.tex, c.tex, c.P, 0, gl.RG, gl.HALF_FLOAT, new Uint16Array(buf));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.clock = c;
    this.frame = 0;
    for (const h of this.hist) { gl.bindFramebuffer(gl.FRAMEBUFFER, h.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  }

  render(date, wallSeconds) {
    const gl = this.gl, c = this.clock;
    if (!c) return;
    const t = c.minute ? minuteDriveTime(date) : driveTime(date);
    const hf = hourFloat(t, c);
    const th = plateAngles(hf, c);
    // 1. trace this frame's rays
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fresh.fb);
    gl.viewport(0, 0, this.S, this.S);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.ray.p);
    const u = this.ray.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.slopes); gl.uniform1i(u.uSlopes, 0);
    gl.uniform1i(u.uP, c.P);
    const cs = new Float32Array(16);
    th.forEach((a, p) => { const r = a * Math.PI / 180; cs[2 * p] = Math.cos(r); cs[2 * p + 1] = Math.sin(r); });
    gl.uniform2fv(u.uCS, cs);
    gl.uniform1fv(u.uCdf, c.cdf); gl.uniform1fv(u.uCsBin, c.lam_cs); gl.uniform1fv(u.uNBin, c.nbin);
    gl.uniform3fv(u.uRgb, c.lam_rgb.flat());
    gl.uniform1f(u.uStop, c.stop_r); gl.uniform1f(u.uLedR, 0.5 * c.led_d); gl.uniform1f(u.uU, c.u);
    gl.uniform1f(u.uThick, c.thickness); gl.uniform1f(u.uW, c.W); gl.uniform1f(u.uD, c.D);
    gl.uniform1f(u.uGap, c.gap_ratio); gl.uniform1f(u.uRap, c.r_ap); gl.uniform1f(u.uFeather, 1 / c.N);
    gl.uniform1f(u.uExt, c.ext); gl.uniform1f(u.uMag, c.mag); gl.uniform1f(u.uFrame, c.frame);
    gl.uniform1ui(u.uSeed, (this.frame * 2654435761) >>> 0);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.POINTS, 0, this.rays);
    gl.disable(gl.BLEND);
    // 2. fold into the moving average
    const src = this.hist[this.frame % 2], dst = this.hist[(this.frame + 1) % 2];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.useProgram(this.avg.p);
    gl.bindVertexArray(this.vaoQuad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fresh.t); gl.uniform1i(this.avg.u.uFresh, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(this.avg.u.uHist, 1);
    const norm = (this.S / (2 * c.frame)) ** 2 / this.rays;
    const alpha = this.frame < 40 ? 1 / (this.frame + 1) : 0.05;   // settle quickly after loading
    gl.uniform1f(this.avg.u.uNorm, norm); gl.uniform1f(this.avg.u.uAlpha, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.lastHist = dst;
    // 3. grade and add the marks
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.graded.fb);
    gl.useProgram(this.grade.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dst.t); gl.uniform1i(this.grade.u.uHist, 0);
    const g = this.grade.u;
    gl.uniform1f(g.uRef, c.ref); gl.uniform1f(g.uContrast, c.contrast); gl.uniform1f(g.uRpic, 0.47);
    gl.uniform1f(g.uFrame, c.frame);
    gl.uniform1f(g.uMinute, date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000);
    gl.uniform1f(g.uSecond, date.getSeconds());
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, this.graded.t);
    gl.generateMipmap(gl.TEXTURE_2D);
    // 4. the photograph
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.show.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.graded.t); gl.uniform1i(this.show.u.uC, 0);
    gl.uniform1f(this.show.u.uRef, c.ref); gl.uniform1f(this.show.u.uTime, wallSeconds % 100);
    this.fade = Math.min(1, this.fade + 0.02);
    gl.uniform1f(this.show.u.uFade, smooth(this.fade));
    gl.uniform3f(this.show.u.uWhite, 1.0, 0.95, 0.86);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.frame++;
    return hf;
  }
}

// the light read as a spectrum: brightness by height on the wall (60 bins, bottom to top) inside the picture,
// counting only light above the picture's average so that the figure, not the haze, shapes the chord
Viewer.prototype.profile = function () {
  const gl = this.gl, c = this.clock;
  if (!c || !this.lastHist) return null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFb);
  gl.viewport(0, 0, this.PS, this.PS);
  gl.useProgram(this.probe.p);
  gl.bindVertexArray(this.vaoQuad);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.lastHist.t); gl.uniform1i(this.probe.u.uHist, 0);
  gl.uniform1f(this.probe.u.uRef, c.ref);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.readPixels(0, 0, this.PS, this.PS, gl.RGBA, gl.UNSIGNED_BYTE, this.probePixels);
  const n = this.PS, rmax = 0.47 * 1.02 / c.frame, B = 60;
  let mean = 0, cnt = 0;
  const inside = (i, j) => { const x = (i + 0.5) / n * 2 - 1, y = (j + 0.5) / n * 2 - 1; return x * x + y * y <= rmax * rmax; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (inside(i, j)) { mean += this.probePixels[4 * (j * n + i)]; cnt++; }
  mean /= Math.max(cnt, 1);
  const prof = new Float32Array(B);
  for (let j = 0; j < n; j++) {
    const yb = ((j + 0.5) / n * 2 - 1) / rmax;                       // -1 bottom of the picture .. 1 top
    if (Math.abs(yb) >= 1) continue;
    const b = Math.min(B - 1, Math.floor((yb + 1) / 2 * B));
    for (let i = 0; i < n; i++) if (inside(i, j)) prof[b] += Math.max(0, this.probePixels[4 * (j * n + i)] - mean) ** 1.5;
  }
  let tot = 0; for (const v of prof) tot += v;
  if (tot > 0) for (let i = 0; i < B; i++) prof[i] /= tot;
  else prof.fill(1 / B);
  return prof;
};

// ---------------------------------------------------------------------------------------------- the page
function caption(name, c, hf, date) {
  const K = c.K, k = Math.floor(hf), s = hf - k;
  const label = i => {
    const l = c.labels[mod(i, K)];
    return name === "twelve-keys" ? `Key ${ROMAN[mod(i, K)]}` : ANIMAL[l] || l;
  };
  if (c.minute) return s < 1e-6 ? label(k) : `between ${label(k)} and ${label(k + 1)}`;
  const hourOf = i => name === "twelve-keys" ? `${mod(i, K) + 1} o'clock` : `${String((1 + 2 * mod(i, K)) % 24).padStart(2, "0")}:00`;
  if (s < 1e-6) return `${label(k)[0].toUpperCase() + label(k).slice(1)} · ${hourOf(k)}`;
  return `between ${label(k)} and ${label(k + 1)}`;
}

async function main() {
  const canvas = document.getElementById("wall");
  const status = document.getElementById("status");
  let viewer;
  try { viewer = new Viewer(canvas); } catch (e) { status.textContent = e.message; return; }
  const params = new URLSearchParams(location.search);
  let name = params.get("clock") in CLOCKS ? params.get("clock") : ORDER[0];
  // the displayed time: live, unless ?at= fixes a start; "an hour a minute" runs fast from the moment it is switched on
  let speed = Number(params.get("speed")) || 1;              // ?speed=60: an hour a minute
  const fixed = params.get("at") ? new Date(params.get("at")) : null;
  let anchorShown = fixed ? fixed.getTime() : Date.now(), anchorReal = Date.now();
  const now = () => new Date(anchorShown + (Date.now() - anchorReal) * speed);
  const setSpeed = v => {
    const shown = now().getTime();
    speed = v;
    anchorReal = Date.now();
    anchorShown = (v === 1 && !fixed) ? anchorReal : shown;   // back to live time when fast mode ends
  };

  const nav = document.getElementById("clocks");
  for (const key of ORDER) {
    const b = document.createElement("button");
    b.textContent = CLOCKS[key].title + (key === "folded-light" ? " (first edition)" : "");
    b.dataset.key = key;
    b.onclick = () => select(key);
    nav.appendChild(b);
  }
  const sound = new Sound();
  window._sound = sound;
  const soundBtn = document.getElementById("sound");
  const MODES = ["off", "ambient", "light"], LABEL = { off: "sound: off", ambient: "sound: ambient", light: "sound: the light" };
  soundBtn.onclick = () => {
    const m = MODES[(MODES.indexOf(sound.mode) + 1) % MODES.length];
    sound.setMode(m);
    soundBtn.textContent = LABEL[m];
    soundBtn.classList.toggle("on", m !== "off");
    soundBtn.blur();
  };
  const fast = document.getElementById("fast");
  fast.onclick = () => { setSpeed(speed === 1 ? 60 : 1); fast.classList.toggle("on", speed !== 1); fast.blur(); };
  if (speed !== 1) fast.classList.add("on");

  // full screen: nothing but the clock face. Tap the face or "full screen"; tap again or Escape to leave.
  const bare = on => {
    document.body.classList.toggle("bare", on);
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    resize();
  };
  document.getElementById("full").onclick = () => bare(true);
  canvas.addEventListener("click", () => bare(!document.body.classList.contains("bare")));
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && document.body.classList.contains("bare")) bare(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") bare(false); if (e.key === "f") bare(!document.body.classList.contains("bare")); });

  async function select(key) {
    name = key;
    for (const b of nav.children) b.classList.toggle("on", b.dataset.key === key);
    document.getElementById("title").textContent = CLOCKS[key].title;
    document.getElementById("sub").textContent = CLOCKS[key].sub;
    const film = document.getElementById("film");
    film.hidden = !CLOCKS[key].film;                     // film links (YouTube) are added in CLOCKS when ready
    if (CLOCKS[key].film) { film.href = CLOCKS[key].film; film.textContent = `Watch the film: ${CLOCKS[key].filmTitle}`; }
    viewer.fade = 0;
    status.textContent = "";
    await viewer.load(key);
    history.replaceState(null, "", `?clock=${key}`);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const full = document.body.classList.contains("bare");
    const size = Math.floor(full ? Math.min(window.innerWidth, window.innerHeight) : Math.min(window.innerWidth, window.innerHeight * 0.86));
    canvas.style.width = canvas.style.height = `${size}px`;
    canvas.width = canvas.height = Math.floor(size * dpr);
  }
  window.addEventListener("resize", resize);
  resize();
  await select(name);

  let last = performance.now(), slow = 0, quick = 0;
  const cap = document.getElementById("now");
  const clockText = document.getElementById("time");
  function loop(ts) {
    const dt = ts - last; last = ts;
    // keep the frame rate smooth: more rays when there is headroom, fewer when frames run long
    if (dt > 24) { slow++; quick = 0; } else if (dt < 18) { quick++; slow = 0; }
    if (slow > 20) { viewer.rays = Math.max(100000, Math.floor(viewer.rays * 0.8)); slow = 0; }
    if (quick > 60) { viewer.rays = Math.min(3000000, Math.floor(viewer.rays * 1.15)); quick = 0; }
    const d = now();
    const hf = viewer.render(d, ts / 1000);
    if (hf !== undefined && sound.mode !== "off" && viewer.frame % 20 === 0) {
      const k = Math.floor(hf), still = hf - k < 1e-6;
      sound.update({ k, atPicture: still, scale: name === "twelve-keys" ? "dorian" : "in",
                     profile: sound.mode === "light" ? viewer.profile() : null });
    }
    if (hf !== undefined && viewer.frame % 15 === 0) {
      cap.textContent = caption(name, viewer.clock, hf, d);
      clockText.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + (speed !== 1 ? "  · an hour a minute" : "");
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main();
