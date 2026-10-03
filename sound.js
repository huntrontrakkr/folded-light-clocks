// Sound for the caustic clocks (Web Audio). Two modes:
//
// ambient  A generative score in the manner of Eno's Music for Airports, from the films' instruments: a breathing
//          pad on the current picture's chord, four koto-like pluck phrases repeating on cycles of 17, 24, 31 and
//          42 seconds (they drift in and out of phase and never line up the same way twice), and a temple bell as
//          each picture gathers.
// light    The light on the wall as sound. Twenty-four voices each carry an equal share of the light. Several times
//          a second the page reads the light like a spectrogram: brightness by height on the wall (light above the
//          picture's average); voice i takes its pitch from the (i + 1/2)/24 quantile of that spread. That is optimal transport in one dimension: as the light moves, the
//          voices glide by the shortest total path, and the loudness never changes because the light is conserved.
//          When the plates stand still the voices settle onto the scale's notes as a chord; while the light
//          wanders they slide freely.

"use strict";

const SCALES = { in: [0, 1, 5, 7, 8], dorian: [0, 2, 3, 7, 9] };
const D3 = 146.832;

class Sound {
  constructor() {
    this.ctx = null;
    this.mode = "off";
    this.scale = SCALES.in;
    this.k = -1;                       // picture index the pad is on
  }

  freq(degree, octave = 0) {
    const n = this.scale.length;
    const o = Math.floor(degree / n), d = ((degree % n) + n) % n;
    return D3 * 2 ** (octave + o + this.scale[d] / 12);
  }

  // continuous version: x in scale steps (0 = D3), linear in semitones between degrees
  freqAt(x) {
    const n = this.scale.length, f = Math.floor(x), t = x - f;
    const semi = i => { const o = Math.floor(i / n), d = ((i % n) + n) % n; return 12 * o + this.scale[d]; };
    return D3 * 2 ** ((semi(f) * (1 - t) + semi(f + 1) * t) / 12);
  }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0;
    // a gentle limiter, then out
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.4;
    this.master.connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.gain.value = 0.65; this.dry.connect(this.master);
    this.verb = ctx.createConvolver(); this.verb.buffer = this.reverbIR(4.2);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.9; this.verb.connect(this.wet).connect(this.master);
    this.plucks = new Map();
  }

  reverbIR(seconds) {
    const ctx = this.ctx, n = Math.floor(seconds * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        lp += 0.45 * ((Math.random() * 2 - 1) - lp);                 // a soft, dark room
        d[i] = lp * Math.exp(-t / (seconds / 6.9)) * Math.min(1, i / (0.012 * ctx.sampleRate));
      }
    }
    return b;
  }

  // an output with dry and reverb sends, panned
  out(pan, wet = 0.5) {
    const ctx = this.ctx, p = ctx.createStereoPanner(); p.pan.value = pan;
    const d = ctx.createGain(); d.gain.value = 1 - wet;
    const w = ctx.createGain(); w.gain.value = wet;
    p.connect(d).connect(this.dry); p.connect(w).connect(this.verb);
    return p;
  }

  // ------------------------------------------------------------------ instruments (as caustix.music)
  pluckBuffer(f) {
    const key = Math.round(f * 10);
    if (this.plucks.has(key)) return this.plucks.get(key);
    const sr = this.ctx.sampleRate, N = Math.max(2, Math.round(sr / f)), n = Math.floor(5.5 * sr);
    const y = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev += 0.55 * (r - prev); y[i] = prev; }   // a soft pick
    const decay = 0.9965;
    for (let i = N; i < n; i++) y[i] += decay * 0.5 * (y[i - N] + (i - N - 1 >= 0 ? y[i - N - 1] : 0));
    const off = Math.floor(N / 5);                                     // plucked a fifth along the string
    let peak = 1e-9;
    for (let i = n - 1; i >= off; i--) { y[i] -= 0.35 * y[i - off]; peak = Math.max(peak, Math.abs(y[i])); }
    for (let i = 0; i < n; i++) y[i] /= peak;
    const b = this.ctx.createBuffer(1, n, sr); b.copyToChannel(y, 0);
    this.plucks.set(key, b);
    return b;
  }

  pluck(f, when, gain, pan) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.pluckBuffer(f);
    const body = ctx.createBiquadFilter(); body.type = "peaking"; body.frequency.value = 420; body.Q.value = 0.9; body.gain.value = 4;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(body).connect(g).connect(this.out(pan, 0.45));
    s.start(when);
  }

  bell(f, when, gain) {
    const ctx = this.ctx, o = this.out(0, 0.6);
    for (const [ratio, amp, tau] of [[0.5, 0.5, 4.5], [1, 1, 3.2], [1.183, 0.45, 2.4], [1.506, 0.3, 1.8], [2, 0.35, 1.6],
                                     [2.74, 0.22, 1.1], [3.76, 0.12, 0.8], [5.4, 0.08, 0.5]]) {
      const s = ctx.createOscillator(); s.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(gain * amp * 0.12, when + 0.004);
      g.gain.exponentialRampToValueAtTime(1e-4, when + 5 * tau);
      s.connect(g).connect(o);
      s.start(when); s.stop(when + 5 * tau + 0.1);
    }
  }

  padChord(freqs) {
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.pad) {                                                     // the old chord fades over 12 s
      const old = this.pad;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 12);
      setTimeout(() => old.oscs.forEach(o => o.stop()), 13000);
    }
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 0.3;
    const gain = ctx.createGain(); gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.05, now + 10);
    const breath = ctx.createOscillator(); breath.frequency.value = 1 / 7.3;
    const bg = ctx.createGain(); bg.gain.value = 0.012; breath.connect(bg).connect(gain.gain);
    const oscs = [breath];
    for (const f of freqs) for (const det of [-0.004, 0, 0.0045]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f * (1 + det);
      o.connect(lp); oscs.push(o);
    }
    lp.connect(gain).connect(this.out(0, 0.55));
    oscs.forEach(o => o.start());
    this.pad = { gain, oscs };
  }

  // ------------------------------------------------------------------ ambient
  startAmbient() {
    const loops = [
      { period: 17.3, notes: [[2, 1], [4, 1]], pan: -0.5 },
      { period: 23.9, notes: [[0, 1]], pan: 0.45 },
      { period: 31.1, notes: [[3, 0], [1, 1], [2, 1]], pan: -0.2 },
      { period: 41.7, notes: [[4, 0]], pan: 0.25 },
    ];
    const t0 = this.ctx.currentTime + 1;
    this.loops = loops.map((l, i) => ({ ...l, next: t0 + i * 3.7 }));
    this.ambientTimer = setInterval(() => this.scheduleAmbient(), 250);
  }

  scheduleAmbient() {
    const now = this.ctx.currentTime, shift = this.k >= 0 ? this.k % this.scale.length : 0;
    for (const l of this.loops) {
      while (l.next < now + 1.0) {
        l.notes.forEach(([deg, oct], j) => this.pluck(this.freq(deg + shift, oct), l.next + j * 1.15, 0.22, l.pan));
        l.next += l.period;
      }
    }
  }

  // called by the page with the clock's state
  update(state) {
    if (!this.ctx || this.mode === "off") return;
    this.scale = SCALES[state.scale] || SCALES.in;
    if (state.k !== this.k) {
      const first = this.k < 0;
      this.k = state.k;
      const r = this.k % this.scale.length;
      this.padChord([this.freq(r, -1), this.freq(r + 2, -1), this.freq(r + 3, -1)]);
      if (!first && state.atPicture) this.bell(this.freq(r, 0), this.ctx.currentTime + 0.05, 1.0);
    }
    if (this.mode === "light" && state.profile) this.updateLight(state);
  }

  // ------------------------------------------------------------------ the light as sound
  startLight() {
    const ctx = this.ctx, V = 24;
    this.voices = [];
    const bus = ctx.createGain(); bus.gain.value = 0; bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 6);
    this.lightBus = bus;
    for (let i = 0; i < V; i++) {
      const o = ctx.createOscillator(); o.type = "sine";
      const o2 = ctx.createOscillator(); o2.type = "sine";              // a soft octave partial
      const g2 = ctx.createGain(); g2.gain.value = 0.18;
      const trem = ctx.createOscillator(); trem.frequency.value = 0.07 + 0.05 * Math.random();
      const tg = ctx.createGain(); tg.gain.value = 0.004;
      const g = ctx.createGain(); g.gain.value = 0.016;
      trem.connect(tg).connect(g.gain);
      o.connect(g); o2.connect(g2).connect(g);
      g.connect(bus);
      const f = this.freqAt(5 + i * 10 / V);
      o.frequency.value = f; o2.frequency.value = 2 * f;
      [o, o2, trem].forEach(x => x.start());
      this.voices.push({ o, o2, trem, x: 5 + i * 10 / V });
    }
    bus.connect(this.out(0, 0.6));
    this.prevProfile = null;
  }

  updateLight(state) {
    const prof = state.profile, B = prof.length, V = this.voices.length;
    // settle onto the scale while the plates stand still (the clock knows), glide freely while they turn
    this.still = (this.still || 0) + ((state.atPicture ? 1 : 0) - (this.still || 0)) * 0.12;
    // a little smoothing of the reading over time (ray noise)
    this.smooth = this.smooth ? this.smooth.map((v, i) => 0.6 * v + 0.4 * prof[i]) : Array.from(prof);
    const cdf = new Float32Array(B + 1);
    for (let i = 0; i < B; i++) cdf[i + 1] = cdf[i] + this.smooth[i];
    const total = cdf[B] || 1, now = this.ctx.currentTime;
    let j = 0;
    for (let i = 0; i < V; i++) {
      // voice i carries the (i + 1/2)/V share of the light: its height is that quantile (1-D optimal transport)
      const q = (i + 0.5) / V * total;
      while (j < B - 1 && cdf[j + 1] < q) j++;
      const frac = (q - cdf[j]) / Math.max(cdf[j + 1] - cdf[j], 1e-9);
      const x = (j + frac) / B * 12 + 2;                               // 12 scale steps up from F3: low light low, high light high
      const xt = x + (Math.round(x) - x) * this.still;
      const v = this.voices[i];
      v.x = xt;
      const f = this.freqAt(xt);
      v.o.frequency.setTargetAtTime(f, now, 0.8);
      v.o2.frequency.setTargetAtTime(2 * f, now, 0.8);
    }
  }

  // ------------------------------------------------------------------ modes
  setMode(mode) {
    this.start();
    this.ctx.resume();
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    if (this.ambientTimer) { clearInterval(this.ambientTimer); this.ambientTimer = null; }
    if (this.voices) {
      const bus = this.lightBus, voices = this.voices;
      bus.gain.setTargetAtTime(0, now, 1.0);
      setTimeout(() => voices.forEach(v => { v.o.stop(); v.o2.stop(); v.trem.stop(); }), 5000);
      this.voices = null;
    }
    this.mode = mode;
    if (mode === "off") { this.master.gain.linearRampToValueAtTime(0, now + 2); return; }
    this.master.gain.linearRampToValueAtTime(0.9, now + 3);
    this.k = -1;                                                        // re-strike the pad on the next update
    if (mode === "ambient") this.startAmbient();
    if (mode === "light") { this.startLight(); this.startAmbient(); this.loops = this.loops.slice(1, 2); }
  }
}

window.Sound = Sound;
