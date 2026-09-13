// Procedural sound engine (Web Audio). No audio files: every effect is synthesised on demand.
(function (MF) {
  'use strict';
  const { clamp, rand } = MF.util;

  const A = {
    ctx: null, master: null, comp: null, dry: null, wet: null, convolver: null,
    noiseBuf: null, volume: 0.7, muted: false, ready: false, listenerX: 0,
    lastPlayed: {},
  };

  function makeNoise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - Math.exp(-i / 200));
      }
    }
    return buf;
  }

  function init() {
    if (A.ready) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    try {
      const ctx = new Ctx();
      A.ctx = ctx;
      A.master = ctx.createGain();
      A.comp = ctx.createDynamicsCompressor();
      A.comp.threshold.value = -14; A.comp.knee.value = 18; A.comp.ratio.value = 6; A.comp.attack.value = 0.003; A.comp.release.value = 0.2;
      A.dry = ctx.createGain(); A.dry.gain.value = 1;
      A.wet = ctx.createGain(); A.wet.gain.value = 0.22;
      A.convolver = ctx.createConvolver();
      A.convolver.buffer = makeImpulse(ctx, 1.6, 3.2);
      A.dry.connect(A.master);
      A.wet.connect(A.convolver); A.convolver.connect(A.master);
      A.master.connect(A.comp); A.comp.connect(ctx.destination);
      A.noiseBuf = makeNoise(ctx, 2);
      A.ready = true;
      applyVolume();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      console.warn('Audio unavailable', e);
      return false;
    }
    return true;
  }

  function resume() { if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume(); }
  function applyVolume() { if (A.master) A.master.gain.value = A.muted ? 0 : A.volume * A.volume; }
  function setVolume(v) { A.volume = clamp(v, 0, 1); applyVolume(); }
  function setMuted(m) { A.muted = !!m; applyVolume(); }

  // --- building blocks ------------------------------------------------------
  function out(node, pan, wetAmt) {
    const ctx = A.ctx;
    let last = node;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan || 0, -1, 1); last.connect(p); last = p;
    }
    last.connect(A.dry);
    if (wetAmt) { const g = ctx.createGain(); g.gain.value = wetAmt; last.connect(g); g.connect(A.wet); }
  }

  function tone(o) {
    // o: {type, f0, f1, t, dur, gain, attack, pan, wet, curve}
    const ctx = A.ctx, t0 = o.t || ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
    const g = ctx.createGain();
    const a = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    let last = g;
    if (o.filter) { const f = ctx.createBiquadFilter(); f.type = o.filter; f.frequency.value = o.ff || 1000; f.Q.value = o.q || 1; last.connect(f); last = f; }
    out(last, o.pan, o.wet);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }

  function noise(o) {
    // o: {t, dur, gain, attack, filter, f0, f1, q, pan, wet}
    const ctx = A.ctx, t0 = o.t || ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.f0 || 1000, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    const g = ctx.createGain();
    const a = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain, t0 + a);
    if (o.hold) g.gain.setValueAtTime(o.gain, t0 + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g);
    out(g, o.pan, o.wet);
    src.start(t0, rand(0, 1.5)); src.stop(t0 + o.dur + 0.05);
  }

  // --- the vocabulary -------------------------------------------------------
  const S = {};
  S.footstep = (p) => {
    noise({ dur: 0.07, gain: 0.07, filter: 'lowpass', f0: 1100, f1: 500, pan: p, attack: 0.002 });
    tone({ type: 'sine', f0: 120, f1: 60, dur: 0.06, gain: 0.08, pan: p });
  };
  S.jump = (p) => {
    tone({ type: 'sine', f0: 240, f1: 560, dur: 0.16, gain: 0.16, pan: p });
    noise({ dur: 0.14, gain: 0.05, filter: 'bandpass', f0: 900, f1: 2400, pan: p });
  };
  S.doublejump = (p) => {
    tone({ type: 'sine', f0: 380, f1: 900, dur: 0.16, gain: 0.15, pan: p, wet: 0.5 });
    tone({ type: 'triangle', f0: 760, f1: 1500, dur: 0.14, gain: 0.05, pan: p, t: A.ctx.currentTime + 0.03 });
    noise({ dur: 0.18, gain: 0.06, filter: 'bandpass', f0: 1800, f1: 4000, pan: p });
  };
  S.land = (p, i) => {
    const k = clamp(i || 0.6, 0.2, 1.2);
    tone({ type: 'sine', f0: 130, f1: 45, dur: 0.11, gain: 0.32 * k, pan: p });
    noise({ dur: 0.08, gain: 0.12 * k, filter: 'lowpass', f0: 600, f1: 200, pan: p });
  };
  S.dash = (p) => {
    noise({ dur: 0.22, gain: 0.28, filter: 'bandpass', f0: 700, f1: 3200, q: 1.2, pan: p, attack: 0.01, wet: 0.4 });
    tone({ type: 'sine', f0: 90, f1: 60, dur: 0.16, gain: 0.18, pan: p });
  };
  S.swing = (p) => {
    noise({ dur: 0.16, gain: 0.24, filter: 'bandpass', f0: 3200, f1: 500, q: 1.5, pan: p, attack: 0.012 });
    tone({ type: 'sine', f0: 700, f1: 220, dur: 0.1, gain: 0.05, pan: p });
  };
  S.hit = (p) => {
    tone({ type: 'square', f0: 1900, f1: 900, dur: 0.03, gain: 0.16, pan: p });
    noise({ dur: 0.1, gain: 0.2, filter: 'highpass', f0: 2600, pan: p, attack: 0.002 });
    tone({ type: 'sine', f0: 2400, dur: 0.18, gain: 0.06, pan: p, wet: 0.6 });
    tone({ type: 'sine', f0: 3600, dur: 0.14, gain: 0.03, pan: p, wet: 0.6 });
    tone({ type: 'sine', f0: 140, f1: 70, dur: 0.09, gain: 0.2, pan: p });
  };
  S.shatter = (p) => {
    const t = A.ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      tone({ type: 'sine', f0: rand(2600, 6200), f1: rand(1800, 5000), dur: rand(0.12, 0.3), gain: 0.045, pan: p + rand(-0.2, 0.2), t: t + i * 0.022, wet: 0.7 });
    }
    noise({ dur: 0.35, gain: 0.22, filter: 'highpass', f0: 3000, pan: p, attack: 0.002, wet: 0.5 });
    tone({ type: 'sine', f0: 160, f1: 50, dur: 0.22, gain: 0.34, pan: p });
    tone({ type: 'triangle', f0: 1200, f1: 300, dur: 0.16, gain: 0.08, pan: p });
  };
  S.bowdraw = (p) => {
    noise({ dur: 0.9, gain: 0.05, filter: 'bandpass', f0: 300, f1: 1400, q: 2, pan: p, attack: 0.05, wet: 0.3 });
    tone({ type: 'triangle', f0: 70, f1: 150, dur: 0.85, gain: 0.05, pan: p, attack: 0.08 });
  };
  S.bowrelease = (p, i) => {
    const k = 0.6 + 0.6 * (i || 0.5);
    tone({ type: 'triangle', f0: 420 * k, f1: 160, dur: 0.09, gain: 0.2, pan: p });
    tone({ type: 'sawtooth', f0: 170, f1: 120, dur: 0.06, gain: 0.08, pan: p, filter: 'lowpass', ff: 1800 });
    noise({ dur: 0.2, gain: 0.16 * k, filter: 'bandpass', f0: 1500, f1: 4500, pan: p, attack: 0.002 });
  };
  S.arrowstone = (p) => {
    tone({ type: 'sine', f0: 420, f1: 160, dur: 0.05, gain: 0.22, pan: p });
    noise({ dur: 0.06, gain: 0.14, filter: 'highpass', f0: 1800, pan: p, attack: 0.002 });
    tone({ type: 'triangle', f0: 1100, f1: 900, dur: 0.12, gain: 0.04, pan: p, wet: 0.5 });
  };
  S.arrowhit = (p) => {
    tone({ type: 'square', f0: 2200, f1: 1200, dur: 0.03, gain: 0.12, pan: p });
    tone({ type: 'sine', f0: 3100, f1: 2600, dur: 0.22, gain: 0.07, pan: p, wet: 0.7 });
    noise({ dur: 0.12, gain: 0.16, filter: 'highpass', f0: 2400, pan: p, attack: 0.002 });
    tone({ type: 'sine', f0: 180, f1: 70, dur: 0.1, gain: 0.18, pan: p });
  };
  S.throw = (p) => {
    noise({ dur: 0.16, gain: 0.14, filter: 'bandpass', f0: 500, f1: 1800, pan: p, attack: 0.01 });
  };
  S.bounce = (p, i) => {
    const k = clamp(i || 0.5, 0.15, 1);
    tone({ type: 'sine', f0: 240, f1: 110, dur: 0.06, gain: 0.22 * k, pan: p });
    noise({ dur: 0.05, gain: 0.08 * k, filter: 'lowpass', f0: 1500, pan: p, attack: 0.002 });
  };
  S.explosion = (p) => {
    const t = A.ctx.currentTime;
    tone({ type: 'sine', f0: 70, f1: 24, dur: 0.75, gain: 0.95, pan: p * 0.4, attack: 0.006 });
    tone({ type: 'triangle', f0: 120, f1: 30, dur: 0.4, gain: 0.35, pan: p * 0.4 });
    noise({ dur: 0.85, gain: 0.7, filter: 'lowpass', f0: 4200, f1: 120, q: 0.6, pan: p * 0.6, attack: 0.004, wet: 0.8 });
    noise({ dur: 0.18, gain: 0.5, filter: 'highpass', f0: 1200, pan: p, attack: 0.001 });
    tone({ type: 'square', f0: 600, f1: 90, dur: 0.05, gain: 0.3, pan: p });
    for (let i = 0; i < 6; i++) noise({ t: t + 0.08 + i * 0.06, dur: 0.05, gain: 0.12, filter: 'bandpass', f0: rand(1500, 5000), pan: p + rand(-0.4, 0.4), attack: 0.002, wet: 0.5 });
  };
  S.hurt = (p) => {
    tone({ type: 'sawtooth', f0: 220, f1: 70, dur: 0.2, gain: 0.22, pan: p, filter: 'lowpass', ff: 2200 });
    noise({ dur: 0.14, gain: 0.18, filter: 'bandpass', f0: 800, f1: 300, pan: p, attack: 0.002 });
    tone({ type: 'sine', f0: 100, f1: 40, dur: 0.18, gain: 0.3, pan: p });
  };
  S.ember = (p) => {
    const t = A.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      tone({ type: 'sine', f0: f, dur: 0.7, gain: 0.14, pan: p, t: t + i * 0.075, attack: 0.01, wet: 0.9 });
      tone({ type: 'triangle', f0: f * 2, dur: 0.4, gain: 0.025, pan: p, t: t + i * 0.075, attack: 0.01, wet: 0.9 });
    });
    tone({ type: 'sine', f0: 261.6, dur: 1.1, gain: 0.1, pan: p, attack: 0.05, wet: 0.9 });
  };
  S.door = (p) => {
    noise({ dur: 0.75, gain: 0.22, filter: 'lowpass', f0: 300, f1: 1600, q: 0.7, pan: 0, attack: 0.15, wet: 0.9 });
    tone({ type: 'sine', f0: 90, f1: 55, dur: 0.7, gain: 0.25, pan: 0, attack: 0.05, wet: 0.6 });
    tone({ type: 'sine', f0: 660, f1: 990, dur: 0.6, gain: 0.03, pan: 0, attack: 0.2, wet: 0.9 });
  };
  S.denied = () => {
    tone({ type: 'triangle', f0: 220, f1: 200, dur: 0.14, gain: 0.12 });
    tone({ type: 'triangle', f0: 170, f1: 150, dur: 0.22, gain: 0.12, t: A.ctx.currentTime + 0.14 });
  };
  S.rekindle = () => {
    tone({ type: 'sine', f0: 200, f1: 400, dur: 0.6, gain: 0.12, attack: 0.05, wet: 0.8 });
    tone({ type: 'sine', f0: 600, f1: 900, dur: 0.6, gain: 0.05, attack: 0.1, wet: 0.8 });
  };
  S.beacon = () => {
    const t = A.ctx.currentTime;
    noise({ dur: 1.4, gain: 0.3, filter: 'lowpass', f0: 200, f1: 2600, q: 0.6, attack: 0.3, wet: 0.9 });
    tone({ type: 'sine', f0: 60, f1: 40, dur: 1.2, gain: 0.4, attack: 0.1 });
    [261.6, 329.6, 392, 523.25, 659.25, 783.99].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 1.2, gain: 0.08, t: t + 0.4 + i * 0.09, attack: 0.02, wet: 0.9 }));
  };
  S.victory = () => {
    const t = A.ctx.currentTime;
    const chords = [[261.6, 329.6, 392], [349.2, 440, 523.25], [392, 493.9, 587.3], [523.25, 659.25, 783.99, 1046.5]];
    chords.forEach((ch, i) => ch.forEach((f) => {
      tone({ type: 'triangle', f0: f, dur: i === 3 ? 2.2 : 0.5, gain: 0.09, t: t + i * 0.38, attack: 0.02, wet: 0.9 });
      tone({ type: 'sine', f0: f / 2, dur: i === 3 ? 2.2 : 0.5, gain: 0.05, t: t + i * 0.38, attack: 0.02, wet: 0.7 });
    }));
    noise({ t: t + 1.14, dur: 2, gain: 0.08, filter: 'highpass', f0: 5000, attack: 0.3, wet: 0.9 });
  };
  S.click = () => { tone({ type: 'square', f0: 1200, f1: 800, dur: 0.03, gain: 0.05 }); };

  function panFor(x) {
    if (x == null) return 0;
    return clamp((x - A.listenerX) / 700, -1, 1) * 0.75;
  }

  // name, {x, intensity}
  function play(name, opts) {
    if (!A.ready || A.muted) return;
    const fn = S[name]; if (!fn) return;
    // rate limit identical sounds
    const now = performance.now();
    const minGap = name === 'footstep' ? 90 : name === 'bounce' ? 60 : 20;
    if (A.lastPlayed[name] && now - A.lastPlayed[name] < minGap) return;
    A.lastPlayed[name] = now;
    try { fn(panFor(opts && opts.x), opts && opts.intensity); } catch (e) { /* never let audio break the game */ }
  }

  MF.audio = { state: A, init, resume, play, setVolume, setMuted, panFor, sounds: S, get ready() { return A.ready; } };
})(window.MF);
