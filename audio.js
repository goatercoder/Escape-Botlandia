/* audio.js — tiny WebAudio synth for ESCAPE BOTLANDIA: one-shot SFX and chiptune loops (global `BotAudio`).
 * No asset files: every sound is built from oscillators and a noise buffer at play time.
 * Browser only, but safe to require() in Node: nothing touches AudioContext until init() is called,
 * and every public function swallows errors (it never throws, before init() or without WebAudio). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants and persistent settings (settings survive before init() and are applied on init)
  // ---------------------------------------------------------------------------
  const MAX_VOICES = 8;          // simultaneous one-shot SFX
  const MAX_CLICK_VOICES = 4;    // clicks/ticks never take more than half of the voice pool
  const LOOKAHEAD = 0.1;         // seconds of music scheduled ahead
  const TICK_MS = 25;            // music scheduler interval
  const XFADE = 0.5;             // music crossfade when switching modes (s)
  const SFX_LEVEL = 0.9;         // sfx bus
  const MUSIC_LEVEL = 0.7;       // music bus = musicVolume × this
  const LP_OPEN = 20000;         // master low-pass, open
  const LP_CLOSED = 320;         // master low-pass, death scene
  const SILENT = 0.0001;         // exponential ramps can't reach 0
  const MODES = ['none', 'city', 'lowtime', 'sunrise'];
  const FORMS = ['sign', 'clock', 'register', 'vault', 'core', 'lever'];

  const settings = {
    muted: false,
    volume: 0.8,
    musicVolume: 0.5,
    musicEnabled: true,
    mode: 'none',
    lowpass: false
  };

  let live = null;   // engine bound to the realtime AudioContext (created by init())
  let timer = null;  // music scheduler interval id
  let resumeAt = -1; // Date.now() of the last resume() request (plays are allowed briefly while it settles)

  function noop() {}
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }
  function clamp(x, a, b) { x = +x; if (x !== x) x = a; return x < a ? a : x > b ? b : x; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function audioCtor() {
    try { return root.AudioContext || root.webkitAudioContext || null; } catch (e) { return null; }
  }
  function offlineCtor() {
    try { return root.OfflineAudioContext || root.webkitOfflineAudioContext || null; } catch (e) { return null; }
  }

  // Freeze an AudioParam at its current value at time t so new ramps start from there (no jumps).
  function holdParam(p, t) {
    if (typeof p.cancelAndHoldAtTime === 'function') {
      p.cancelAndHoldAtTime(t);
    } else {
      const v = p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
    }
  }
  // Smoothly glide a param towards a target (used for user-facing volume changes).
  function glide(p, target, t, tau) {
    p.cancelScheduledValues(t);
    p.setTargetAtTime(target, t, tau || 0.015);
  }

  function masterLevel() { return settings.muted ? 0 : settings.volume; }
  function musicLevel() { return settings.musicVolume * MUSIC_LEVEL; }
  function lpOpen(ctx) { return Math.min(LP_OPEN, ctx.sampleRate * 0.45); }

  // ---------------------------------------------------------------------------
  // Engine: the node graph for one context (the realtime one, or an OfflineAudioContext for tests)
  //   sfx bus ─┐
  //            ├─> master gain ─> low-pass ─> compressor (limiter) ─> safety soft-clip ─> destination
  //   music ───┘
  // ---------------------------------------------------------------------------
  function guardCurve() {
    // Identity below 0.9, then a tanh knee that tops out at ~0.972 (inputs beyond ±1 clamp to the ends).
    // The compressor does the real limiting; this only guarantees the output never reaches full scale.
    const n = 4097, c = new Float32Array(n), k = 0.9, r = 0.09;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
      const y = a <= k ? a : k + r * Math.tanh((a - k) / r);
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }

  function makeNoise(ctx) {
    const len = Math.floor(ctx.sampleRate * 1.0), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Slightly "stepped" white noise (sample-and-hold every 2 samples) for a crunchier 8-bit feel.
    for (let i = 0; i < len; i += 2) { const v = Math.random() * 2 - 1; d[i] = v; if (i + 1 < len) d[i + 1] = v; }
    return buf;
  }

  function createEngine(ctx, offline) {
    const e = { ctx: ctx, offline: !!offline, voices: [], last: {}, music: null, waves: {} };
    e.master = ctx.createGain();
    e.master.gain.value = masterLevel();
    e.lp = ctx.createBiquadFilter();
    e.lp.type = 'lowpass';
    e.lp.Q.value = 0.707;
    e.lp.frequency.value = settings.lowpass ? LP_CLOSED : lpOpen(ctx);
    e.comp = ctx.createDynamicsCompressor();
    e.comp.threshold.value = -8;
    e.comp.knee.value = 4;
    e.comp.ratio.value = 16;
    e.comp.attack.value = 0.002;
    e.comp.release.value = 0.18;
    e.guard = ctx.createWaveShaper();
    e.guard.curve = guardCurve();
    e.sfx = ctx.createGain();
    e.sfx.gain.value = SFX_LEVEL;
    e.mus = ctx.createGain();
    e.mus.gain.value = musicLevel();
    e.sfx.connect(e.master);
    e.mus.connect(e.master);
    e.master.connect(e.lp);
    e.lp.connect(e.comp);
    e.comp.connect(e.guard);
    e.guard.connect(ctx.destination);
    e.noise = makeNoise(ctx);
    return e;
  }

  // Pulse waves (12.5% / 25% duty) for the NES-ish lead; 0.5 is the plain square.
  function pulse(e, duty) {
    const key = 'p' + duty;
    if (!e.waves[key]) {
      const n = 48, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        re[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
        im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
      }
      e.waves[key] = e.ctx.createPeriodicWave(re, im);
    }
    return e.waves[key];
  }

  // ---------------------------------------------------------------------------
  // Voices (one-shot SFX): each play() gets a gain node; the pool is capped, the oldest is stopped
  // ---------------------------------------------------------------------------
  function prune(e, t) {
    const keep = [];
    for (let i = 0; i < e.voices.length; i++) { const v = e.voices[i]; if (!v.dead && v.end > t) keep.push(v); }
    e.voices = keep;
  }

  function release(v) {
    if (v.released) return;
    v.released = true;
    v.dead = true;
    try { v.out.disconnect(); } catch (err) { /* already gone */ }
  }

  function kill(e, v, t) {
    v.dead = true;
    try {
      holdParam(v.out.gain, t);
      v.out.gain.linearRampToValueAtTime(0, t + 0.012);
    } catch (err) { /* ignore */ }
    const stopAt = t + 0.02;
    for (let i = 0; i < v.srcs.length; i++) {
      const s = v.srcs[i];
      if (s._stopAt > stopAt) { try { s.stop(stopAt); s._stopAt = stopAt; } catch (err) { /* ignore */ } }
    }
    const idx = e.voices.indexOf(v);
    if (idx >= 0) e.voices.splice(idx, 1);
  }

  function voiceStart(e, t, level, prio) {
    prune(e, t);
    if (prio === 0) {
      // clicks: cap their own share of the pool first so they can't starve stingers
      const clicks = e.voices.filter(function (v) { return v.prio === 0; });
      if (clicks.length >= MAX_CLICK_VOICES) kill(e, clicks[0], t);
    }
    while (e.voices.length >= MAX_VOICES) {
      // stop the oldest voice, preferring ones that are not more important than the new sound
      let victim = null;
      for (let i = 0; i < e.voices.length; i++) { if (e.voices[i].prio <= prio) { victim = e.voices[i]; break; } }
      kill(e, victim || e.voices[0], t);
    }
    const out = e.ctx.createGain();
    out.gain.value = level;
    out.connect(e.sfx);
    const v = { out: out, srcs: [], end: t, prio: prio, live: 0, dead: false, released: false };
    e.voices.push(v);
    return v;
  }

  // Start a source, schedule its stop, and disconnect its private nodes when it ends.
  function launch(v, src, t, stopAt, nodes, offset) {
    if (offset != null) src.start(t, offset); else src.start(t);
    src.stop(stopAt);
    src._stopAt = stopAt;
    if (v) { v.srcs.push(src); v.live++; if (stopAt > v.end) v.end = stopAt; }
    src.onended = function () {
      for (let i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (err) { /* ignore */ } }
      if (v && --v.live <= 0) release(v);
    };
  }

  // Percussive envelope: 0 → peak in `a`, optional hold, exponential decay to silence at t+dur.
  function envGain(e, t, a, dur, peak, hold) {
    const g = e.ctx.createGain(), p = g.gain;
    peak = Math.max(peak, SILENT * 2);
    a = Math.max(0.001, Math.min(a, dur * 0.9));
    hold = Math.max(0, Math.min(hold || 0, dur - a - 0.005));
    p.setValueAtTime(SILENT, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) p.setValueAtTime(peak, t + a + hold);
    p.exponentialRampToValueAtTime(SILENT, t + dur);
    return g;
  }

  // One oscillator blip. o: { t, type | wave(duty), f, f2, glide, dur, a, hold, peak, detune, lp, lpTo, lpGlide, q, dest }
  function tone(e, v, o) {
    const ctx = e.ctx, t = o.t, dur = o.dur;
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(pulse(e, o.wave)); else osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const g = envGain(e, t, o.a || 0.003, dur, o.peak, o.hold);
    const nodes = [osc, g];
    osc.connect(g);
    let head = g;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = o.q || 0.8;
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + (o.lpGlide || dur));
      g.connect(f);
      head = f;
      nodes.push(f);
    }
    head.connect(o.dest || v.out);
    launch(v, osc, t, t + dur + 0.02, nodes);
  }

  // Filtered noise burst. o: { t, dur, a, hold, peak, type, f, f2, glide, q, dest }
  function noise(e, v, o) {
    const ctx = e.ctx, t = o.t, dur = o.dur;
    const src = ctx.createBufferSource();
    src.buffer = e.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q != null ? o.q : 1;
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || dur));
    const g = envGain(e, t, o.a || 0.002, dur, o.peak, o.hold);
    src.connect(f);
    f.connect(g);
    g.connect(o.dest || v.out);
    launch(v, src, t, t + dur + 0.02, [src, f, g], Math.random() * 0.8);
  }

  // ---------------------------------------------------------------------------
  // SFX recipes: fn(e, voice, t, pitchMul, opts). Peaks are per-layer linear gains; clicks stay
  // around 0.1 total, stingers 0.15–0.3. Everything is short except the story stingers.
  // ---------------------------------------------------------------------------
  function chunk(e, v, t, pm, peak) {
    tone(e, v, { t: t, type: 'square', f: 180 * pm, f2: 105 * pm, dur: 0.04, a: 0.002, peak: peak || 0.09, lp: 2200 });
    noise(e, v, { t: t, dur: 0.02, a: 0.001, peak: 0.05, type: 'bandpass', f: 2600 * pm, q: 0.9 });
  }

  function bell(e, v, t, f, dur, peak) {
    tone(e, v, { t: t, type: 'sine', f: f, dur: dur, a: 0.003, peak: peak });
    tone(e, v, { t: t, type: 'sine', f: f * 2.76, dur: dur * 0.4, a: 0.002, peak: peak * 0.25 });
    tone(e, v, { t: t, type: 'triangle', f: f * 2, dur: dur * 0.5, a: 0.002, peak: peak * 0.2 });
  }

  function coinBlip(e, v, t, pm, peak, long) {
    tone(e, v, { t: t, type: 'square', f: mtof(83) * pm, dur: 0.055, a: 0.001, peak: peak, lp: 5000 });
    tone(e, v, { t: t + 0.05, type: 'square', f: mtof(88) * pm, dur: long || 0.18, a: 0.001, peak: peak, lp: 5000 });
  }

  function thump(e, v, t, peak) {
    tone(e, v, { t: t, type: 'triangle', f: 78, f2: 40, glide: 0.1, dur: 0.14, a: 0.005, peak: peak });
    tone(e, v, { t: t, type: 'sine', f: 60, f2: 38, dur: 0.16, a: 0.005, peak: peak * 0.6 });
    noise(e, v, { t: t, dur: 0.04, peak: peak * 0.25, type: 'lowpass', f: 220, q: 0.7 });
  }

  const CLICK = {
    // soft paper flap: two quick filtered-noise flaps and a tiny cardboard thud
    sign: function (e, v, t, pm) {
      noise(e, v, { t: t, dur: 0.06, a: 0.006, peak: 0.1, type: 'bandpass', f: 1100 * pm, f2: 450 * pm, q: 0.7 });
      noise(e, v, { t: t + 0.03, dur: 0.045, a: 0.005, peak: 0.05, type: 'bandpass', f: 800 * pm, f2: 380 * pm, q: 0.7 });
      tone(e, v, { t: t, type: 'sine', f: 150 * pm, f2: 90 * pm, dur: 0.04, peak: 0.05 });
    },
    // punch clock: the plain chunk
    clock: function (e, v, t, pm) { chunk(e, v, t, pm); },
    // register: chunk + 1200 Hz triangle ding
    register: function (e, v, t, pm) {
      chunk(e, v, t, pm, 0.07);
      tone(e, v, { t: t + 0.012, type: 'triangle', f: 1200 * pm, dur: 0.1, a: 0.002, peak: 0.055 });
    },
    // vault: low sine thump + short inharmonic metallic ring
    vault: function (e, v, t, pm) {
      tone(e, v, { t: t, type: 'sine', f: 95 * pm, f2: 48 * pm, dur: 0.09, a: 0.003, peak: 0.18 });
      tone(e, v, { t: t + 0.004, type: 'square', f: 1480 * pm, dur: 0.09, peak: 0.01, lp: 5000 });
      tone(e, v, { t: t + 0.004, type: 'sine', f: 2330 * pm, dur: 0.11, peak: 0.02 });
      noise(e, v, { t: t, dur: 0.015, peak: 0.035, type: 'highpass', f: 3000 });
    },
    // core: soft bell chime
    core: function (e, v, t, pm) { bell(e, v, t, 880 * pm, 0.14, 0.06); },
    // lever: heavy clunk and a latch click
    lever: function (e, v, t, pm) {
      tone(e, v, { t: t, type: 'square', f: 120 * pm, f2: 55 * pm, dur: 0.075, a: 0.002, peak: 0.08, lp: 900 });
      tone(e, v, { t: t, type: 'sine', f: 70 * pm, f2: 40 * pm, dur: 0.08, peak: 0.13 });
      noise(e, v, { t: t, dur: 0.035, peak: 0.06, type: 'lowpass', f: 1400 });
      noise(e, v, { t: t + 0.03, dur: 0.012, peak: 0.03, type: 'highpass', f: 3500 });
    }
  };

  // prio 0 = click-like (may be dropped/stolen first), 1 = stinger. gap = min seconds between repeats.
  const SFX = {
    click: { prio: 0, gap: 0.018, fn: function (e, v, t, pm, o) { CLICK[o.form](e, v, t, pm); } },

    tick: { prio: 0, gap: 0.025, fn: function (e, v, t, pm) {
      noise(e, v, { t: t, dur: 0.012, a: 0.0005, peak: 0.025, type: 'highpass', f: 5000 });
      tone(e, v, { t: t, type: 'square', f: 1800 * pm, dur: 0.008, a: 0.0005, peak: 0.008 });
    } },

    coin: { prio: 0, gap: 0.03, fn: function (e, v, t, pm) {
      tone(e, v, { t: t, type: 'square', f: mtof(88) * pm, dur: 0.035, a: 0.001, peak: 0.045, lp: 6000 });
      tone(e, v, { t: t + 0.03, type: 'square', f: mtof(95) * pm, dur: 0.09, a: 0.001, peak: 0.045, lp: 6000 });
    } },

    crit: { prio: 1, gap: 0.05, fn: function (e, v, t, pm) {
      const seq = [72, 76, 79, 84];
      for (let i = 0; i < seq.length; i++) {
        tone(e, v, { t: t + i * 0.045, wave: 0.25, f: mtof(seq[i]) * pm, dur: i === 3 ? 0.24 : 0.07, a: 0.002, peak: 0.075, lp: 6000 });
      }
      noise(e, v, { t: t + 0.135, dur: 0.2, a: 0.004, peak: 0.03, type: 'highpass', f: 6500 });
    } },

    buy: { prio: 1, gap: 0.05, fn: function (e, v, t, pm) {
      tone(e, v, { t: t, type: 'square', f: mtof(79) * pm, dur: 0.07, a: 0.002, peak: 0.07, lp: 4000 });
      tone(e, v, { t: t + 0.075, type: 'square', f: mtof(84) * pm, dur: 0.15, a: 0.002, peak: 0.07, lp: 4000 });
    } },

    chaching: { prio: 1, gap: 0.05, fn: function (e, v, t, pm) {
      noise(e, v, { t: t, dur: 0.05, a: 0.002, peak: 0.1, type: 'bandpass', f: 3200, q: 0.8 });      // "cha": drawer
      tone(e, v, { t: t, type: 'square', f: 140, f2: 80, dur: 0.05, peak: 0.06, lp: 1500 });          // drawer thunk
      tone(e, v, { t: t + 0.07, type: 'triangle', f: 1200 * pm, dur: 0.45, a: 0.002, peak: 0.11 });   // bell ding
      tone(e, v, { t: t + 0.07, type: 'sine', f: 2407 * pm, dur: 0.3, a: 0.002, peak: 0.035 });
      coinBlip(e, v, t + 0.09, pm, 0.05);
    } },

    chapter: { prio: 1, gap: 0.3, fn: function (e, v, t, pm) {
      const seq = [67, 72, 76, 79], s = 0.12;
      for (let i = 0; i < 4; i++) {
        const last = i === 3, d = last ? 0.75 : 0.11;
        tone(e, v, { t: t + i * s, wave: 0.25, f: mtof(seq[i]) * pm, dur: d, a: 0.004, hold: last ? 0.3 : 0.04, peak: 0.08, lp: 4000 });
        tone(e, v, { t: t + i * s, type: 'triangle', f: mtof(seq[i] - 5) * pm, dur: d, a: 0.004, hold: last ? 0.3 : 0.04, peak: 0.05 });
      }
      tone(e, v, { t: t + 3 * s, type: 'triangle', f: mtof(48) * pm, dur: 0.8, a: 0.005, hold: 0.3, peak: 0.13 });
      noise(e, v, { t: t + 3 * s, dur: 0.7, a: 0.003, peak: 0.035, type: 'highpass', f: 5000 });
    } },

    achievement: { prio: 1, gap: 0.2, fn: function (e, v, t, pm) {
      const seq = [72, 76, 74, 77, 76, 79, 77, 81, 79, 84];
      for (let i = 0; i < seq.length; i++) {
        const last = i === seq.length - 1;
        tone(e, v, { t: t + i * 0.04, wave: 0.125, f: mtof(seq[i]) * pm, dur: last ? 0.35 : 0.06, a: 0.002, peak: 0.055, lp: 6000 });
      }
      tone(e, v, { t: t + 0.4, type: 'triangle', f: mtof(96) * pm, dur: 0.3, a: 0.002, peak: 0.03 });
    } },

    lesson: { prio: 1, gap: 0.1, fn: function (e, v, t, pm) {
      tone(e, v, { t: t, type: 'sine', f: 320 * pm, f2: 900 * pm, glide: 0.05, dur: 0.09, a: 0.002, peak: 0.13 }); // pop
      noise(e, v, { t: t, dur: 0.03, a: 0.001, peak: 0.05, type: 'bandpass', f: 1800, q: 1.2 });                // paper
      tone(e, v, { t: t + 0.08, type: 'triangle', f: mtof(88) * pm, dur: 0.14, a: 0.002, peak: 0.05 });           // chime
    } },

    burnout: { prio: 1, gap: 0.3, fn: function (e, v, t) {
      tone(e, v, { t: t, type: 'sawtooth', f: 440, f2: 70, glide: 0.8, dur: 0.85, a: 0.01, hold: 0.2, peak: 0.09, lp: 1600 });
      tone(e, v, { t: t, type: 'square', f: 447, f2: 72, glide: 0.8, dur: 0.85, a: 0.01, hold: 0.2, peak: 0.035, lp: 1200 });
      noise(e, v, { t: t + 0.05, dur: 1.0, a: 0.08, hold: 0.2, peak: 0.05, type: 'highpass', f: 4000 });    // steam hiss
    } },

    error: { prio: 1, gap: 0.12, fn: function (e, v, t) {
      tone(e, v, { t: t, type: 'square', f: 110, dur: 0.16, a: 0.003, hold: 0.08, peak: 0.065, lp: 1000 });
      tone(e, v, { t: t, type: 'square', f: 116.5, dur: 0.16, a: 0.003, hold: 0.08, peak: 0.045, lp: 1000 });
    } },

    glitch: { prio: 1, gap: 0.1, fn: function (e, v, t) {
      const scale = [0, 2, 4, 7, 9];
      for (let i = 0; i < 12; i++) {
        const m = 79 + pick(scale) + (Math.random() < 0.4 ? 12 : 0);
        tone(e, v, { t: t + i * 0.03 + rnd(0, 0.008), wave: pick([0.125, 0.25]), f: mtof(m) * rnd(0.99, 1.01), dur: 0.05, a: 0.001, peak: rnd(0.03, 0.05), lp: 7000 });
      }
      noise(e, v, { t: t + 0.1, dur: 0.05, a: 0.001, peak: 0.03, type: 'bandpass', f: 5000, q: 4 });
      noise(e, v, { t: t + 0.25, dur: 0.03, a: 0.001, peak: 0.025, type: 'bandpass', f: 7000, q: 4 });
    } },

    crash: { prio: 1, gap: 0.5, fn: function (e, v, t) {
      noise(e, v, { t: t, dur: 1.8, a: 0.04, hold: 0.2, peak: 0.26, type: 'lowpass', f: 420, f2: 70, q: 0.9 });
      tone(e, v, { t: t, type: 'sine', f: 62, f2: 34, dur: 1.5, a: 0.03, hold: 0.2, peak: 0.15 });
      tone(e, v, { t: t, type: 'square', f: 220, f2: 55, glide: 1.0, dur: 1.1, a: 0.01, peak: 0.03, lp: 600 }); // falling chart
    } },

    thunder: { prio: 1, gap: 0.5, fn: function (e, v, t) {
      noise(e, v, { t: t, dur: 0.25, a: 0.003, peak: 0.22, type: 'lowpass', f: 3000, f2: 800, q: 0.5 });       // crack
      noise(e, v, { t: t + 0.03, dur: 2.8, a: 0.05, peak: 0.28, type: 'lowpass', f: 900, f2: 120, q: 0.7 });   // roll
      noise(e, v, { t: t + 0.5, dur: 1.4, a: 0.2, peak: 0.1, type: 'lowpass', f: 300, f2: 90, q: 0.7 });        // second rumble
    } },

    heartbeat: { prio: 1, gap: 0.3, fn: function (e, v, t) { thump(e, v, t, 0.24); thump(e, v, t + 0.2, 0.17); } },

    death: { prio: 1, gap: 1, fn: function (e, v, t) {
      const phrase = [[69, 0.55], [65, 0.55], [64, 0.55], [62, 1.5]]; // A4 F4 E4 D4 — slow, D minor
      let at = t;
      for (let i = 0; i < phrase.length; i++) {
        const m = phrase[i][0], d = phrase[i][1];
        tone(e, v, { t: at, type: 'triangle', f: mtof(m), dur: d + 0.3, a: 0.02, hold: d * 0.5, peak: 0.13 });
        tone(e, v, { t: at, wave: 0.25, f: mtof(m - 12), dur: d + 0.25, a: 0.02, hold: d * 0.4, peak: 0.03, lp: 900 });
        at += d;
      }
      tone(e, v, { t: t + 1.65, type: 'sine', f: mtof(38), dur: 1.7, a: 0.15, hold: 0.3, peak: 0.1 });
    } },

    escape: { prio: 1, gap: 1, fn: function (e, v, t) {
      const chord = [48, 55, 60, 64, 67, 72]; // C major, open voicing, swelling in
      for (let i = 0; i < chord.length; i++) {
        tone(e, v, { t: t, type: 'sawtooth', f: mtof(chord[i]), dur: 3.4, a: 1.1, hold: 0.9, peak: 0.026, detune: i % 2 ? 7 : -7, lp: 500, lpTo: 3200, lpGlide: 1.4 });
      }
      const arp = [72, 76, 79, 84, 88, 91, 96];
      for (let i = 0; i < arp.length; i++) {
        tone(e, v, { t: t + 0.9 + i * 0.09, wave: 0.25, f: mtof(arp[i]), dur: i === arp.length - 1 ? 0.8 : 0.3, a: 0.003, peak: 0.04, lp: 6000 });
      }
      noise(e, v, { t: t + 1.5, dur: 1.4, a: 0.01, peak: 0.03, type: 'highpass', f: 6000 });
    } },

    milestone: { prio: 1, gap: 0.15, fn: function (e, v, t, pm) {
      tone(e, v, { t: t, type: 'sine', f: 160, f2: 48, glide: 0.12, dur: 0.18, a: 0.002, peak: 0.26 });   // kick
      noise(e, v, { t: t, dur: 0.12, a: 0.001, peak: 0.09, type: 'bandpass', f: 1800, q: 0.7 });            // snare
      const chord = [72, 76, 79];
      for (let i = 0; i < chord.length; i++) {
        tone(e, v, { t: t + 0.03, wave: 0.25, f: mtof(chord[i]) * pm, dur: 0.45, a: 0.004, hold: 0.12, peak: 0.035, lp: 5000 });
      }
      tone(e, v, { t: t + 0.03, type: 'triangle', f: mtof(48) * pm, dur: 0.45, a: 0.004, hold: 0.1, peak: 0.1 });
    } },

    whoosh: { prio: 1, gap: 0.08, fn: function (e, v, t) {
      noise(e, v, { t: t, dur: 0.42, a: 0.16, peak: 0.11, type: 'bandpass', f: 300, f2: 3800, glide: 0.3, q: 1.8 });
    } },

    promotion: { prio: 1, gap: 0.3, fn: function (e, v, t) {
      // "ding-dong-ding" corporate chime: G4 E5 C5
      bell(e, v, t, mtof(67), 0.5, 0.1);
      bell(e, v, t + 0.2, mtof(76), 0.5, 0.09);
      bell(e, v, t + 0.4, mtof(72), 0.9, 0.1);
    } },

    debt: { prio: 1, gap: 0.3, fn: function (e, v, t) {
      tone(e, v, { t: t, type: 'sawtooth', f: mtof(63), dur: 0.3, a: 0.01, hold: 0.15, peak: 0.075, lp: 1400 });
      tone(e, v, { t: t + 0.3, type: 'sawtooth', f: mtof(58), f2: mtof(56.5), dur: 0.65, a: 0.01, hold: 0.3, peak: 0.075, lp: 1100 });
    } }
  };
  const NAMES = Object.keys(SFX);

  function playOn(e, name, opts, t) {
    if (!has(SFX, name)) return false;   // unknown names are ignored
    const def = SFX[name];
    const form = has(CLICK, opts.form) ? opts.form : 'clock';
    const last = e.last[name];
    if (last != null && t >= last && t - last < def.gap) return false;   // repeat too fast: drop
    e.last[name] = t;
    const pm = Math.pow(2, clamp(opts.pitch || 0, -24, 24) / 12);
    const level = opts.volume != null ? clamp(opts.volume, 0, 1.5) : 1;
    if (level <= 0) return false;
    const v = voiceStart(e, t, level, def.prio);
    def.fn(e, v, t, pm, { form: form, pitch: opts.pitch });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Music: pattern data (pure, parsed at load) + a lookahead step scheduler
  // ---------------------------------------------------------------------------
  // One token per step: a MIDI note starts a note, '-' holds the previous note, '.' is a rest, '|' is ignored.
  function parse(str) {
    const tok = str.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
    const out = new Array(tok.length);
    for (let i = 0; i < tok.length; i++) {
      out[i] = null;
      if (tok[i] === '-' || tok[i] === '.') continue;
      let n = 1;
      while (i + n < tok.length && tok[i + n] === '-') n++;
      out[i] = { m: +tok[i], n: n };
    }
    return out;
  }
  function bassLine(roots, pat) {
    return roots.map(function (r) {
      return pat.split(' ').map(function (x) { return x === '-' || x === '.' ? x : String(r + (+x)); }).join(' ');
    }).join(' | ');
  }

  // city — A minor, 100 BPM, 8 bars: Am F C G | Am F G E (8th-note grid)
  const CITY_ROOTS = [45, 41, 48, 43, 45, 41, 43, 40];
  const CITY = {
    lead: parse(
      '76 . 72 . 69 - 71 72 | 69 - - . 65 . 69 72 | 67 . 72 . 76 - 79 - | 74 - - - 71 . 67 . |' +
      '69 . 72 . 76 - 81 - | 79 - 77 . 76 . 72 . | 74 - 71 . 74 . 79 - | 76 - - - 68 . 71 .'),
    bass: parse(bassLine(CITY_ROOTS, '0 - 12 . 7 - 12 .'))
  };

  // sunrise — C major, 96 BPM, 8 bars: C G Am F | C G F C
  const SUN_ROOTS = [48, 43, 45, 41, 48, 43, 41, 48];
  const SUN_MINOR = [false, false, true, false, false, false, false, false];
  const SUN = {
    lead: parse(
      '72 - 76 - 79 - 76 - | 74 - 79 - 83 - 81 79 | 76 - 72 - 81 - - - | 77 - 76 74 72 - 69 - |' +
      '72 - 76 - 79 - 84 - | 83 - 81 79 74 - 79 - | 81 - 79 77 76 - 74 - | 72 - - - - - . .'),
    bass: parse(bassLine(SUN_ROOTS, '0 - 7 - 12 - 7 -'))
  };

  // lowtime — D minor pad, 70 BPM, 4 bars: Dm Bb Gm A, heartbeat on every beat, a music-box drip per bar
  const LOW_CHORDS = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
  const LOW_DRIP = { 8: 81, 24: 77, 40: 74, 56: 73 };

  // Sustained note for music (no voice cap). o: { t, type | wave, f, dur, a, sus, rel, peak, detune, lp }
  function mnote(e, dest, o) {
    const ctx = e.ctx, t = o.t, d = Math.max(0.03, o.dur);
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(pulse(e, o.wave)); else osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const g = ctx.createGain(), p = g.gain;
    const pk = o.peak, sus = pk * (o.sus != null ? o.sus : 0.6);
    const a = Math.min(o.a || 0.005, d * 0.3), dec = Math.min(0.1, d * 0.3), rel = Math.min(o.rel || 0.04, d * 0.3);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(pk, t + a);
    p.linearRampToValueAtTime(sus, t + a + dec);
    p.setValueAtTime(sus, t + d - rel);
    p.linearRampToValueAtTime(0, t + d);
    osc.connect(g);
    const nodes = [osc, g];
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      f.Q.value = 0.7;
      g.connect(f);
      f.connect(dest);
      nodes.push(f);
    } else {
      g.connect(dest);
    }
    launch(null, osc, t, t + d + 0.01, nodes);
  }

  function mhat(e, dest, t, peak) {
    noise(e, null, { t: t, dur: 0.03, a: 0.001, peak: peak, type: 'highpass', f: 7000, q: 0.7, dest: dest });
  }
  function mkick(e, dest, t, peak) {
    tone(e, null, { t: t, type: 'sine', f: 130, f2: 45, glide: 0.1, dur: 0.14, a: 0.002, peak: peak, dest: dest });
  }
  function mthump(e, dest, t, peak) {
    tone(e, null, { t: t, type: 'triangle', f: 72, f2: 40, glide: 0.1, dur: 0.13, a: 0.006, peak: peak, dest: dest });
    tone(e, null, { t: t, type: 'sine', f: 58, f2: 38, glide: 0.12, dur: 0.15, a: 0.006, peak: peak * 0.7, dest: dest });
  }

  // Each song: bpm, steps (16th notes per loop), step(e, s, t, sd, dest) schedules everything on step s at time t.
  const SONGS = {
    city: {
      bpm: 100, steps: 128,
      step: function (e, s, t, sd, dest) {
        const i = s & 15;
        if ((s & 1) === 0) {
          const k = s >> 1, n = CITY.lead[k], b = CITY.bass[k];
          if (n) mnote(e, dest, { t: t, type: 'square', f: mtof(n.m), dur: n.n * sd * 2 * 0.92, a: 0.006, sus: 0.55, peak: 0.075, lp: 2400 });
          if (b) mnote(e, dest, { t: t, type: 'triangle', f: mtof(b.m), dur: b.n * sd * 2 * 0.9, a: 0.004, sus: 0.8, peak: 0.2 });
          mhat(e, dest, t, i % 4 === 2 ? 0.05 : 0.022);
        }
        if (i === 0 || i === 8) mkick(e, dest, t, 0.16);
      }
    },
    lowtime: {
      bpm: 70, steps: 64,
      step: function (e, s, t, sd, dest) {
        const i = s & 15;
        if (i === 0) {
          const ch = LOW_CHORDS[s >> 4];
          for (let j = 0; j < ch.length; j++) {
            mnote(e, dest, { t: t, type: 'triangle', f: mtof(ch[j]), dur: 16 * sd + 0.25, a: 0.9, sus: 0.85, rel: 0.6, peak: 0.07, detune: j % 2 ? 5 : -5 });
            mnote(e, dest, { t: t, type: 'sine', f: mtof(ch[j] + 12), dur: 16 * sd + 0.25, a: 1.2, sus: 0.8, rel: 0.6, peak: 0.025 });
          }
        }
        if (i % 4 === 0) { mthump(e, dest, t, 0.2); mthump(e, dest, t + sd, 0.13); }   // lub-dub every beat
        const drip = LOW_DRIP[s];
        if (drip) mnote(e, dest, { t: t, type: 'triangle', f: mtof(drip), dur: 1.4, a: 0.004, sus: 0.25, rel: 0.6, peak: 0.05 });
      }
    },
    sunrise: {
      bpm: 96, steps: 128,
      step: function (e, s, t, sd, dest) {
        const i = s & 15, bar = s >> 4;
        if ((s & 1) === 0) {
          const k = s >> 1, n = SUN.lead[k], b = SUN.bass[k];
          if (n) mnote(e, dest, { t: t, wave: 0.25, f: mtof(n.m), dur: n.n * sd * 2 * 0.92, a: 0.006, sus: 0.6, peak: 0.07, lp: 3400 });
          if (b) mnote(e, dest, { t: t, type: 'triangle', f: mtof(b.m), dur: b.n * sd * 2 * 0.9, a: 0.004, sus: 0.8, peak: 0.19 });
          if (i % 4 === 2) mhat(e, dest, t, 0.03);
        }
        // shimmering 16th arpeggio of the chord, two octaves up
        const r = SUN_ROOTS[bar] + 24, iv = [0, SUN_MINOR[bar] ? 3 : 4, 7, 12];
        mnote(e, dest, { t: t, wave: 0.125, f: mtof(r + iv[i & 3]), dur: sd * 0.8, a: 0.003, sus: 0.4, peak: 0.022, lp: 5000 });
        if (i === 0) mkick(e, dest, t, 0.12);
      }
    }
  };

  function musicStart(e, mode, t) {
    const old = e.music;
    const fade = old ? XFADE : 0.05;
    e.music = null;
    if (old) {
      const g = old.gain;
      try {
        holdParam(g.gain, t);
        g.gain.linearRampToValueAtTime(0, t + fade);
      } catch (err) { /* ignore */ }
      if (!e.offline && typeof setTimeout === 'function') {
        setTimeout(function () { try { g.disconnect(); } catch (err) { /* ignore */ } }, (fade + LOOKAHEAD + 0.3) * 1000);
      }
    }
    if (!has(SONGS, mode)) return;
    const song = SONGS[mode];
    const g = e.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    g.connect(e.mus);
    e.music = { mode: mode, song: song, gain: g, step: 0, next: t + 0.03, sd: 60 / song.bpm / 4 };
  }

  function musicPump(e, until) {
    const m = e.music;
    if (!m) return;
    const now = e.ctx.currentTime;
    if (m.next < now - 0.2) m.next = now + 0.02;   // fell behind (throttled tab / hiccup): skip, don't burst
    const silent = settings.muted && !e.offline;
    while (m.next < until) {
      if (!silent) { try { m.song.step(e, m.step, m.next, m.sd, m.gain); } catch (err) { /* skip the step, keep time */ } }
      m.next += m.sd;
      m.step = (m.step + 1) % m.song.steps;
    }
  }

  function tick() {
    try {
      if (!live || !live.music) { stopTimer(); return; }
      musicPump(live, live.ctx.currentTime + LOOKAHEAD);
    } catch (err) { /* keep ticking */ }
  }
  function startTimer() {
    if (timer == null && typeof setInterval === 'function') timer = setInterval(tick, TICK_MS);
  }
  function stopTimer() {
    if (timer != null) { try { clearInterval(timer); } catch (err) { /* ignore */ } timer = null; }
  }

  function syncMusic() {
    if (!live) return;
    const want = settings.musicEnabled ? settings.mode : 'none';
    const have = live.music ? live.music.mode : 'none';
    if (want === have) return;
    musicStart(live, want, live.ctx.currentTime);
    if (live.music) { startTimer(); tick(); } else stopTimer();
  }

  // ---------------------------------------------------------------------------
  // Public API — every entry point is wrapped so it never throws
  // ---------------------------------------------------------------------------
  function init() {
    try {
      if (live && live.ctx.state === 'closed') { stopTimer(); live = null; }
      if (!live) {
        const AC = audioCtor();
        if (!AC) return false;
        let ctx;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (err) { ctx = new AC(); }
        live = createEngine(ctx, false);
        // iOS/Safari unlock: play one silent sample inside the gesture
        try {
          const b = ctx.createBufferSource();
          b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          b.connect(ctx.destination);
          b.start(0);
        } catch (err) { /* ignore */ }
      }
      if (live.ctx.state !== 'running' && typeof live.ctx.resume === 'function') {
        resumeAt = Date.now();
        const p = live.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(noop);
      }
      syncMusic();
      return true;
    } catch (err) {
      return false;
    }
  }

  function play(name, opts) {
    try {
      if (!live || settings.muted) return false;
      // Never queue sounds into a suspended context (they would all fire on resume), except in the
      // moment right after init() asked it to resume, so the very first click is still heard.
      if (live.ctx.state !== 'running' && !(live.ctx.state === 'suspended' && Date.now() - resumeAt < 300)) return false;
      return playOn(live, String(name), opts || {}, live.ctx.currentTime);
    } catch (err) {
      return false;
    }
  }

  function music(mode) {
    try {
      mode = mode == null ? 'none' : String(mode);
      if (MODES.indexOf(mode) < 0) return false;
      if (mode === settings.mode) return true;   // no-op
      settings.mode = mode;
      syncMusic();
      return true;
    } catch (err) {
      return false;
    }
  }

  function applyMaster() {
    if (live) glide(live.master.gain, masterLevel(), live.ctx.currentTime, 0.015);
  }

  function setMuted(b) {
    try { settings.muted = !!b; applyMaster(); } catch (err) { /* ignore */ }
    return settings.muted;
  }
  function isMuted() { return settings.muted; }

  function setVolume(v) {
    try { settings.volume = clamp(v, 0, 1); applyMaster(); } catch (err) { /* ignore */ }
    return settings.volume;
  }
  function getVolume() { return settings.volume; }

  function setMusicVolume(v) {
    try {
      settings.musicVolume = clamp(v, 0, 1);
      if (live) glide(live.mus.gain, musicLevel(), live.ctx.currentTime, 0.03);
    } catch (err) { /* ignore */ }
    return settings.musicVolume;
  }
  function getMusicVolume() { return settings.musicVolume; }

  function setMusicEnabled(b) {
    try { settings.musicEnabled = !!b; syncMusic(); } catch (err) { /* ignore */ }
    return settings.musicEnabled;
  }
  function isMusicEnabled() { return settings.musicEnabled; }

  // Sweep the master low-pass down (death scene) or back open. `seconds` defaults to 1.5 down / 0.8 up.
  function lowpass(on, seconds) {
    try {
      settings.lowpass = !!on;
      if (!live) return settings.lowpass;
      const f = live.lp.frequency, t = live.ctx.currentTime;
      const dur = seconds != null ? clamp(seconds, 0.01, 10) : (on ? 1.5 : 0.8);
      holdParam(f, t);
      f.exponentialRampToValueAtTime(on ? LP_CLOSED : lpOpen(live.ctx), t + dur);
    } catch (err) { /* ignore */ }
    return settings.lowpass;
  }

  function getMode() { return settings.mode; }

  // Debug/test introspection.
  function stateInfo() {
    try {
      const t = live ? live.ctx.currentTime : 0;
      if (live) prune(live, t);
      return {
        ready: !!live,
        context: live ? live.ctx.state : 'none',
        voices: live ? live.voices.length : 0,
        mode: settings.mode,
        playing: live && live.music ? live.music.mode : 'none',
        muted: settings.muted,
        volume: settings.volume,
        musicVolume: settings.musicVolume,
        musicEnabled: settings.musicEnabled,
        lowpass: settings.lowpass
      };
    } catch (err) {
      return { ready: false };
    }
  }

  // Render `seconds` of a music mode (and optional SFX) through the same graph into an OfflineAudioContext.
  // opts: { clicks: n, clickRate: per second (20), clickStart: s (0.5), form, sfx: [name | {name, at, opts}], sampleRate }
  // Resolves to an AudioBuffer (or null when OfflineAudioContext is unavailable). Used by tests.
  function renderOffline(mode, seconds, opts) {
    try {
      const OAC = offlineCtor();
      if (!OAC) return Promise.resolve(null);
      opts = opts || {};
      seconds = clamp(seconds == null ? 4 : seconds, 0.1, 120);
      const sr = opts.sampleRate || 44100;
      const ctx = new OAC(2, Math.ceil(sr * seconds), sr);
      const e = createEngine(ctx, true);
      e.master.gain.value = settings.volume;   // offline renders ignore mute
      if (has(SONGS, mode)) { musicStart(e, mode, 0); musicPump(e, seconds); }
      const clicks = opts.clicks | 0, rate = opts.clickRate || 20, t0 = opts.clickStart != null ? opts.clickStart : 0.5;
      for (let i = 0; i < clicks; i++) playOn(e, 'click', { pitch: i % 13, form: opts.form }, t0 + i / rate);
      const sfx = opts.sfx || [];
      for (let i = 0; i < sfx.length; i++) {
        const s = sfx[i], name = typeof s === 'string' ? s : s.name;
        const at = typeof s === 'object' && s.at != null ? s.at : (opts.sfxStart || 0);
        playOn(e, name, (typeof s === 'object' && s.opts) || {}, at);
      }
      return new Promise(function (resolve) {
        ctx.oncomplete = function (ev) { resolve(ev.renderedBuffer); };
        const p = ctx.startRendering();
        if (p && typeof p.then === 'function') p.then(resolve, function () { resolve(null); });
      });
    } catch (err) {
      if (root.__AUDIO_DEBUG) root.__AUDIO_DEBUG(err);
      return Promise.resolve(null);
    }
  }

  const API = {
    init: init,
    play: play,
    music: music,
    setMuted: setMuted,
    isMuted: isMuted,
    setVolume: setVolume,
    getVolume: getVolume,
    setMusicVolume: setMusicVolume,
    getMusicVolume: getMusicVolume,
    setMusicEnabled: setMusicEnabled,
    isMusicEnabled: isMusicEnabled,
    lowpass: lowpass,
    getMode: getMode,
    NAMES: NAMES.slice(),
    MODES: MODES.slice(),
    FORMS: FORMS.slice(),
    MAX_VOICES: MAX_VOICES,
    _state: stateInfo,
    _renderOffline: renderOffline,
    _internals: { createEngine: createEngine, playOn: playOn }
  };

  root.BotAudio = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
