/* Orione — generative audio engine (Web Audio, no samples).
   Elements are placed around the listener; a shared harmony keeps them in key. */
'use strict';
const Sound = (() => {
const R = Math.random, pick = a => a[R() * a.length | 0];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

const NOTE_IT = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
const SCALES = {
  frigio: { n: 'Frigio', s: [0, 1, 3, 5, 7, 8, 10] },
  eolio: { n: 'Eolio', s: [0, 2, 3, 5, 7, 8, 10] },
  dorico: { n: 'Dorico', s: [0, 2, 3, 5, 7, 9, 10] },
  lidio: { n: 'Lidio', s: [0, 2, 4, 6, 7, 9, 11] },
  ungherese: { n: 'Ungherese min.', s: [0, 2, 3, 6, 7, 8, 11] },
  doppio: { n: 'Doppio armonico', s: [0, 1, 4, 5, 7, 8, 11] },
  esatonale: { n: 'Esatonale', s: [0, 2, 4, 6, 8, 10] },
  penta: { n: 'Pentatonica min.', s: [0, 3, 5, 7, 10] },
  locrio: { n: 'Locrio', s: [0, 1, 3, 5, 6, 8, 10] },
};

const G = { root: 9, scale: 'lidio', bpm: 68, bpmTarget: 68, detune: .35, space: .6, bright: .5, vol: .85,
  chordDeg: 0, prog: [0, 3, 1, 4], style: 'luna', running: false };

let ctx = null, bus, filt, comp, out, analyser, revSend, revRet, delSend, delNode, delFb, delFilt, noiseBuf;
const elements = [];
const bonds = [];   // {from, to, iv, delay}

/* ---------- setup ---------- */
function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  out = ctx.createGain(); out.gain.value = G.vol;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = .01; comp.release.value = .35;
  filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 9000; filt.Q.value = .4;
  bus = ctx.createGain();
  bus.connect(filt); filt.connect(comp); comp.connect(out); out.connect(ctx.destination);
  analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .7; out.connect(analyser);

  const conv = ctx.createConvolver(); conv.buffer = makeIR(5.5);
  revSend = ctx.createGain(); revSend.gain.value = G.space;
  revRet = ctx.createGain(); revRet.gain.value = .9;
  revSend.connect(conv); conv.connect(revRet); revRet.connect(filt);

  delSend = ctx.createGain(); delSend.gain.value = 1;
  delNode = ctx.createDelay(4); delNode.delayTime.value = 60 / G.bpm * .75;
  delFb = ctx.createGain(); delFb.gain.value = .45;
  delFilt = ctx.createBiquadFilter(); delFilt.type = 'lowpass'; delFilt.frequency.value = 2400;
  const delRet = ctx.createGain(); delRet.gain.value = .55;
  delSend.connect(delNode); delNode.connect(delFilt); delFilt.connect(delFb); delFb.connect(delNode);
  delFilt.connect(delRet); delRet.connect(filt); delRet.connect(revSend);
  const wow = ctx.createOscillator(), wowG = ctx.createGain(); wow.frequency.value = .27; wowG.gain.value = .0035;
  wow.connect(wowG); wowG.connect(delNode.delayTime); wow.start();

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1;
  return ctx;
}
function makeIR(sec) {
  const n = ctx.sampleRate * sec | 0, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let y = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n, a = .9 - k * .82;                 // darker as it decays
      y += a * ((R() * 2 - 1) - y);
      d[i] = y * Math.pow(1 - k, 2.2) * (i < 200 ? i / 200 : 1);
    }
  }
  return b;
}
function resume() { if (ctx && ctx.state !== 'running') ctx.resume(); }

/* ---------- music helpers ---------- */
function deg2midi(deg, oct) {
  const s = SCALES[G.scale].s, n = s.length, o = Math.floor(deg / n);
  return 12 * (oct + 1) + G.root + s[((deg % n) + n) % n] + 12 * o;
}
function fit(m, lo, hi) { while (m < lo) m += 12; while (m > hi) m -= 12; return m; }
function snap(m) {   // nearest scale tone
  const s = SCALES[G.scale].s; let best = m, bd = 99;
  for (let d = -2; d <= 2; d++) { const pc = ((m + d - G.root) % 12 + 12) % 12; if (s.includes(pc) && Math.abs(d) < bd) { bd = Math.abs(d); best = m + d; } }
  return best;
}
const stepDur = () => 60 / G.bpm / 4;
const spread = e => 5 + (G.detune + (G.detuneRoll || 0) * .7) * 28 + (e ? e.drift * 22 : 0);

function osc(type, f, det, t) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.setValueAtTime(det || 0, t); return o; }
function gainEnv(t, a, peak, hold, rel) {
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.setTargetAtTime(0, t + a + hold, rel / 4);
  return g;
}
const endOf = (t, a, hold, rel) => t + a + hold + rel + .05;

/* ---------- voices ---------- */
const V = {
  pluck(dest, t, f, dur, vel, o = {}) {
    const det = o.det || 10, cut = o.cut || 1600, q = o.q || 6;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = q;
    fl.frequency.setValueAtTime(Math.min(16000, cut * 5), t); fl.frequency.exponentialRampToValueAtTime(Math.max(80, cut), t + Math.max(.06, dur * .7));
    const g = gainEnv(t, .004, vel * .16, dur * .6, o.rel || .35);
    const a = osc(o.wave || 'sawtooth', f, -det, t), b = osc(o.wave2 || 'square', f, det, t);
    const bg = ctx.createGain(); bg.gain.value = .55;
    a.connect(fl); b.connect(bg); bg.connect(fl); fl.connect(g); g.connect(dest);
    const end = endOf(t, .004, dur * .6, o.rel || .35); a.start(t); b.start(t); a.stop(end); b.stop(end);
  },
  pad(dest, t, f, dur, vel, o = {}) {
    const det = o.det || 14, fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 1.5;
    fl.frequency.setValueAtTime(o.cut * .5 || 500, t); fl.frequency.linearRampToValueAtTime(o.cut || 1400, t + dur * .5);
    fl.frequency.linearRampToValueAtTime(o.cut * .6 || 700, t + dur);
    const g = gainEnv(t, o.att || 1.6, vel * .075, Math.max(0, dur - (o.att || 1.6)), o.rel || 3);
    fl.connect(g); g.connect(dest);
    const end = endOf(t, o.att || 1.6, Math.max(0, dur - (o.att || 1.6)), o.rel || 3);
    [-det, 0, det].forEach((d, i) => { const x = osc(i === 1 ? (o.mid || 'triangle') : 'sawtooth', f, d, t); x.connect(fl); x.start(t); x.stop(end); });
  },
  bell(dest, t, f, dur, vel, o = {}) {
    const ratio = o.ratio || 3.5, idx = o.idx || 2.2;
    const car = osc('sine', f, 0, t), mod = osc('sine', f * ratio, 0, t), mg = ctx.createGain();
    mg.gain.setValueAtTime(f * idx, t); mg.gain.exponentialRampToValueAtTime(f * .05 + 1, t + dur * .8);
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * .14, t + .003);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    car.connect(g); g.connect(dest);
    car.start(t); mod.start(t); car.stop(t + dur + .05); mod.stop(t + dur + .05);
  },
  choir(dest, t, f, dur, vel, o = {}) {
    const FORM = [[800, 1150, 2900], [400, 800, 2600], [350, 600, 2700], [270, 2140, 2950], [450, 800, 2830]];
    const fm = FORM[o.vowel == null ? R() * 5 | 0 : o.vowel], det = o.det || 9;
    const att = o.att || .9, rel = o.rel || 2, hold = Math.max(0, dur - att), end = endOf(t, att, hold, rel);
    const g = gainEnv(t, att, vel * .22, hold, rel); g.connect(dest);
    const src = ctx.createGain(); src.gain.value = .5;
    const vib = osc('sine', 4.6 + R(), 0, t), vg = ctx.createGain(); vg.gain.value = f * .007; vib.connect(vg);
    [-det, det].forEach(d => { const x = osc('sawtooth', f, d, t); vg.connect(x.frequency); x.connect(src); x.start(t); x.stop(end); });
    vib.start(t); vib.stop(end);
    fm.forEach((ff, i) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = 9;
      const bg = ctx.createGain(); bg.gain.value = [1, .55, .25][i]; src.connect(bp); bp.connect(bg); bg.connect(g); });
  },
  bass(dest, t, f, dur, vel, o = {}) {
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 7;
    const cut = o.cut || 400;
    fl.frequency.setValueAtTime(cut * 3, t); fl.frequency.exponentialRampToValueAtTime(cut, t + .18);
    const g = gainEnv(t, .006, vel * .3, dur * .8, .18);
    const a = osc('sawtooth', f, -(o.det || 8), t), b = osc('sawtooth', f, o.det || 8, t), s = osc('sine', f / 2, 0, t), sg = ctx.createGain();
    sg.gain.value = .9; s.connect(sg); sg.connect(g);
    a.connect(fl); b.connect(fl); fl.connect(g); g.connect(dest);
    const end = endOf(t, .006, dur * .8, .18); [a, b, s].forEach(x => { x.start(t); x.stop(end); });
  },
  kick(dest, t, vel, f0 = 120, f1 = 38, dec = .7) {
    const o = osc('sine', f0, 0, t); o.frequency.exponentialRampToValueAtTime(f1, t + .25);
    const g = ctx.createGain(); g.gain.setValueAtTime(vel * .9, t); g.gain.exponentialRampToValueAtTime(.001, t + dec);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dec + .05);
  },
  tom(dest, t, f, vel, dec = .5) {
    const o = osc('sine', f * 1.6, 0, t), o2 = osc('triangle', f * 2.3, 0, t);
    o.frequency.exponentialRampToValueAtTime(f, t + .12); o2.frequency.exponentialRampToValueAtTime(f * 1.5, t + .1);
    const g = ctx.createGain(); g.gain.setValueAtTime(vel * .55, t); g.gain.exponentialRampToValueAtTime(.001, t + dec);
    const g2 = ctx.createGain(); g2.gain.value = .25;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
    [o, o2].forEach(x => { x.start(t); x.stop(t + dec + .05); });
  },
  noise(dest, t, vel, dec, type = 'highpass', f = 7000, q = .8) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vel * .3, t); g.gain.exponentialRampToValueAtTime(.001, t + dec);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, R() * 1.5); s.stop(t + dec + .05);
  },
  blip(dest, t, f, vel, dec = .09, wave = 'triangle') {
    const o = osc(wave, f, 0, t), g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * .2, t + .003); g.gain.exponentialRampToValueAtTime(.001, t + dec);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dec + .05);
  },
};

/* ---------- element types ---------- */
// lo/hi = register range in MIDI at reg 0
const TYPES = {
  Ab: { num: 3, name: 'Abisso', kind: 'drone profondo', color: '#8b7dff', lo: 28, hi: 47, rev: .55, del: 0, cont: true,
    setup(e) {
      const n = e.n = {};
      n.f = ctx.createBiquadFilter(); n.f.type = 'lowpass'; n.f.Q.value = 3;
      n.g = ctx.createGain(); n.g.gain.value = 0; n.g.gain.setTargetAtTime(.22, ctx.currentTime, 1.5);
      n.o = [osc('sawtooth', 55, 0, 0), osc('sawtooth', 55, 0, 0), osc('sine', 27.5, 0, 0), osc('triangle', 82.5, 0, 0)];
      n.o.forEach((x, i) => { const gg = ctx.createGain(); gg.gain.value = [.5, .5, .9, .15][i]; x.connect(gg); gg.connect(n.f); x.start(); });
      n.lfo = osc('sine', .05 + R() * .05, 0, 0); n.lg = ctx.createGain(); n.lfo.connect(n.lg); n.lg.connect(n.f.frequency); n.lfo.start();
      n.f.connect(n.g); n.g.connect(e.pre);
      this.note(e, ctx.currentTime, deg2midi(G.chordDeg, 1 + e.reg), 4, 1, false, .01);
    },
    params(e) { const n = e.n, c = 90 + e.tone * e.tone * 1400; n.f.frequency.setTargetAtTime(c, ctx.currentTime, .3); n.lg.gain.setTargetAtTime(c * .6, ctx.currentTime, .3);
      const s = spread(e); n.o[0].detune.setTargetAtTime(-s, ctx.currentTime, .5); n.o[1].detune.setTargetAtTime(s, ctx.currentTime, .5); },
    step(e, i, t) { if (i % 64 === 0 || (i % 32 === 0 && R() < e.dens * .5)) this.note(e, t, deg2midi(G.chordDeg + pick([0, 0, 0, 4, -3, 2]), 1 + e.reg), 4, 1, true); },
    note(e, t, m, dur, vel, own, glide) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg); const f = mtof(m), gl = glide == null ? (own ? 1.6 : .4) : glide; if (own) e.emit(t, m, dur, vel);
      e.n.o[0].frequency.setTargetAtTime(f, t, gl); e.n.o[1].frequency.setTargetAtTime(f, t, gl);
      e.n.o[2].frequency.setTargetAtTime(f / 2, t, gl); e.n.o[3].frequency.setTargetAtTime(f * 1.5, t, gl); e.flash(t, .8); },
    dispose(e) { e.n.o.forEach(x => x.stop()); e.n.lfo.stop(); },
  },
  Nb: { num: 10, name: 'Nebula', kind: 'pad anni ’80', color: '#ff7ad9', lo: 48, hi: 72, rev: .7, del: .1,
    step(e, i, t) {
      if (i % 32 !== 0 || R() > .35 + e.dens * .65) return;
      const dur = stepDur() * 32 * 1.05, d0 = G.chordDeg, oct = 3 + e.reg;
      const degs = [0, 2, 4, R() < .5 ? 6 : 7].slice(0, 3 + (e.dens > .5 ? 1 : 0));
      degs.forEach((d, k) => this.voice(e, t + k * .04, deg2midi(d0 + d, oct), dur, .9));
      e.emit(t, deg2midi(d0, oct + 1), dur, .9);
    },
    voice(e, t, m, dur, vel) { V.pad(e.pre, t, mtof(m), dur, vel, { det: spread(e), cut: 500 + e.tone * 3000, att: 1 + (1 - e.dens) * 1.5, rel: 3 }); e.flash(t, .6); },
    note(e, t, m, dur, vel) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg); this.voice(e, t, m, Math.max(dur, 2), vel); e.emit(t, m, dur, vel); },
  },
  Ne: { num: 18, name: 'Neon', kind: 'arpeggio sintetico', color: '#3ef0ff', lo: 60, hi: 86, rev: .3, del: .55,
    regen(e) {
      const k = 3 + Math.round(e.dens * 9), p = new Array(16).fill(null); let walk = 0;
      for (let j = 0; j < 16; j++) if (Math.floor((j * k) / 16) !== Math.floor(((j - 1) * k) / 16)) { walk += pick([1, 2, -1, 2, 3, -2, 4]); p[(j + e.rot) % 16] = ((walk % 9) + 9) % 9; }
      e.pat = p; e.oct = 4 + (R() < .3 ? 1 : 0);
    },
    step(e, i, t) {
      if (!e.pat || (i % 128 === 0 && i > 0)) { e.rot = R() * 4 | 0; this.regen(e); }
      else if (i % 32 === 0 && R() < .4) { const j = R() * 16 | 0; e.pat[j] = e.pat[j] == null ? R() * 7 | 0 : null; }
      const d = e.pat[i % 16]; if (d == null) return;
      const m = deg2midi(G.chordDeg + d, e.oct + e.reg), acc = i % 4 === 0 ? 1 : .7;
      this.note(e, t, m, stepDur() * (R() < .2 ? 2 : 1), acc, true);
    },
    note(e, t, m, dur, vel, own) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg);
      V.pluck(e.pre, t, mtof(m), dur, vel, { det: spread(e) * .7, cut: 500 + e.tone * 4200, q: 7, wave2: 'square', rel: .25 });
      e.flash(t, vel); if (own) e.emit(t, m, dur, vel); },
  },
  Sb: { num: 51, name: 'Sub', kind: 'basso pulsante', color: '#ff5a4a', lo: 28, hi: 45, rev: .12, del: .05,
    regen(e) { const p = new Array(16).fill(null); p[0] = 0;
      const extra = Math.round(e.dens * 6); for (let j = 0; j < extra; j++) p[pick([3, 6, 7, 10, 11, 12, 14])] = pick([0, 0, 4, 7, -3]); e.pat = p; },
    step(e, i, t) {
      if (!e.pat || i % 64 === 0) this.regen(e);
      const d = e.pat[i % 16]; if (d == null) return;
      const m = deg2midi(G.chordDeg + d, 1 + e.reg); this.note(e, t, m, stepDur() * (i % 16 === 0 ? 3 : 1.5), i % 16 === 0 ? 1 : .75, true);
    },
    note(e, t, m, dur, vel, own) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg);
      V.bass(e.pre, t, mtof(m), dur, vel, { cut: 180 + e.tone * 900, det: spread(e) * .5 }); e.flash(t, vel); if (own) e.emit(t, m, dur, vel); },
  },
  Cr: { num: 24, name: 'Cristallo', kind: 'campane FM', color: '#c9f6ff', lo: 72, hi: 98, rev: .8, del: .4,
    step(e, i, t) { if (R() > e.dens * .14 + (i % 16 === 0 ? .08 : 0)) return;
      const m = deg2midi(G.chordDeg + pick([0, 2, 4, 6, 7, 9, 11]), 5 + e.reg); this.note(e, t, m, 2.5 + R() * 2, .5 + R() * .5, true); },
    note(e, t, m, dur, vel, own) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg);
      V.bell(e.pre, t, mtof(m), Math.max(1.2, dur), vel, { ratio: pick([3.5, 1.41, 2.76, 5.19]), idx: 1 + e.tone * 4 }); e.flash(t, vel); if (own) e.emit(t, m, dur, vel); },
  },
  Co: { num: 27, name: 'Coro', kind: 'voci antiche', color: '#ffd27a', lo: 50, hi: 72, rev: .85, del: .15,
    step(e, i, t) { if (i % 16 !== 0 || R() > .25 + e.dens * .5) return;
      const m = deg2midi(G.chordDeg + pick([0, 2, 4, 4, 7]), 3 + e.reg), dur = stepDur() * pick([16, 24, 32]);
      this.note(e, t, m, dur, .8, true); if (e.dens > .6 && R() < .5) this.note(e, t + .2, deg2midi(G.chordDeg + 2, 3 + e.reg), dur, .5); },
    note(e, t, m, dur, vel, own) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg);
      V.choir(e.pre, t, mtof(m), Math.max(1, dur), vel, { det: spread(e) * .6, att: .6 + (1 - e.tone) * 1.2 }); e.flash(t, vel); if (own) e.emit(t, m, dur, vel); },
  },
  Bt: { num: 56, name: 'Battito', kind: 'percussioni rituali', color: '#ff9a3c', lo: 36, hi: 60, rev: .35, del: .12,
    regen(e) {
      const k = new Array(32).fill(0), tm = new Array(32).fill(0), h = new Array(32).fill(0);
      k[0] = 1; if (R() < .6) k[pick([12, 20, 22])] = .8; if (e.dens > .5) k[pick([6, 10, 26])] = .6;
      for (let j = 0; j < 2 + e.dens * 6; j++) tm[pick([4, 8, 14, 16, 18, 24, 28, 30, 31])] = .5 + R() * .5;
      const hd = e.dens * .7; for (let j = 0; j < 32; j++) if (j % 2 === 0 && R() < hd) h[j] = .3 + R() * .5;
      e.pat = { k, tm, h, tomBase: pick([0, 2, 4]) };
    },
    step(e, i, t) {
      if (!e.pat || i % 128 === 0) this.regen(e);
      const j = i % 32, p = e.pat;
      if (p.k[j]) { V.kick(e.pre, t, p.k[j], 100 + e.tone * 60, 34 + e.tone * 10, .8); e.flash(t, p.k[j]); e.emit(t, deg2midi(G.chordDeg, 2), .2, p.k[j]); }
      if (p.tm[j]) { const m = deg2midi(G.chordDeg + p.tomBase + pick([0, 2, 4]), 2 + e.reg); V.tom(e.pre, t, mtof(m), p.tm[j]); e.flash(t, p.tm[j] * .8); }
      if (p.h[j]) V.noise(e.pre, t, p.h[j] * (.5 + e.tone), R() < .1 ? .35 : .05, 'highpass', 6000 + e.tone * 4000);
    },
    note(e, t, m, dur, vel) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg); V.tom(e.pre, t, mtof(m), vel, .6); e.flash(t, vel); },
  },
  Pv: { num: 73, name: 'Polvere', kind: 'vento e sabbia', color: '#e8b98a', lo: 48, hi: 84, rev: .6, del: 0, cont: true,
    setup(e) {
      const n = e.n = {};
      n.src = ctx.createBufferSource(); n.src.buffer = noiseBuf; n.src.loop = true;
      n.bp = ctx.createBiquadFilter(); n.bp.type = 'bandpass'; n.bp.frequency.value = 600; n.bp.Q.value = 3;
      n.bp2 = ctx.createBiquadFilter(); n.bp2.type = 'bandpass'; n.bp2.frequency.value = 1800; n.bp2.Q.value = 6;
      n.g = ctx.createGain(); n.g.gain.value = 0; n.g.gain.setTargetAtTime(.5, ctx.currentTime, 2);
      const g2 = ctx.createGain(); g2.gain.value = .4;
      n.src.connect(n.bp); n.src.connect(n.bp2); n.bp.connect(n.g); n.bp2.connect(g2); g2.connect(n.g); n.g.connect(e.pre); n.src.start();
    },
    params(e) { e.n.bp.Q.value = 1.5 + e.tone * 8; },
    step(e, i, t) {
      if (i % 4 !== 0) return;
      const f = 200 + Math.pow(R(), 2) * (900 + e.tone * 3000);
      e.n.bp.frequency.setTargetAtTime(f, t, .6 + (1 - e.dens) * 1.5); e.n.bp2.frequency.setTargetAtTime(f * (2.2 + R()), t, 1.2);
      const gst = .25 + R() * (.3 + e.dens * .5); e.n.g.gain.setTargetAtTime(gst, t, .8); e.flash(t, gst * .6);
    },
    note(e, t, m, dur, vel) { const f = mtof(fit(m, this.lo, this.hi)); e.n.bp.frequency.setTargetAtTime(f, t, .1); e.n.bp2.frequency.setTargetAtTime(f * 2, t, .1);
      e.n.bp.Q.setTargetAtTime(14, t, .05); e.n.bp.Q.setTargetAtTime(1.5 + e.tone * 8, t + dur, .5);
      e.n.g.gain.setTargetAtTime(.9 * vel, t, .05); e.n.g.gain.setTargetAtTime(.3, t + dur, .6); e.flash(t, vel); },
    dispose(e) { e.n.src.stop(); },
  },
  Sg: { num: 88, name: 'Segnale', kind: 'melodia sci‑fi', color: '#9dff6a', lo: 62, hi: 88, rev: .55, del: .5, cont: true,
    setup(e) {
      const n = e.n = {};
      n.o = osc('triangle', 440, 0, 0); n.o2 = osc('sine', 880, 0, 0);
      n.vib = osc('sine', 5.5, 0, 0); n.vg = ctx.createGain(); n.vg.gain.value = 6; n.vib.connect(n.vg); n.vg.connect(n.o.frequency); n.vg.connect(n.o2.frequency);
      n.f = ctx.createBiquadFilter(); n.f.type = 'lowpass'; n.f.frequency.value = 2400; n.f.Q.value = 2;
      n.g = ctx.createGain(); n.g.gain.value = 0;
      const g2 = ctx.createGain(); g2.gain.value = .3;
      n.o.connect(n.f); n.o2.connect(g2); g2.connect(n.f); n.f.connect(n.g); n.g.connect(e.pre);
      [n.o, n.o2, n.vib].forEach(x => x.start());
    },
    params(e) { e.n.f.frequency.setTargetAtTime(600 + e.tone * 5000, ctx.currentTime, .2); e.n.o2.detune.setTargetAtTime(spread(e), ctx.currentTime, .3); },
    step(e, i, t) {
      if (i % 32 === 0) {   // new phrase every 2 bars
        e.phrase = []; if (R() < .3 + e.dens * .6) { let d = pick([0, 2, 4, 7]); const n = 2 + (R() * (2 + e.dens * 5) | 0);
          for (let j = 0; j < n; j++) { e.phrase.push({ s: j === 0 ? 0 : e.phrase[j - 1].s + pick([2, 3, 4, 6]), d }); d += pick([-1, 1, 2, -2, 3, -4]); } }
      }
      const j = i % 32, ph = (e.phrase || []).find(x => x.s === j);
      if (ph) this.note(e, t, deg2midi(G.chordDeg + ph.d, 4 + e.reg), stepDur() * pick([2, 3, 4, 6]), .8, true);
    },
    note(e, t, m, dur, vel, own) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg); const f = mtof(m), n = e.n;
      n.o.frequency.setTargetAtTime(f, t, .05 + (1 - e.dens) * .08); n.o2.frequency.setTargetAtTime(f * 2, t, .06);
      n.g.gain.setTargetAtTime(.2 * vel, t, .03); n.g.gain.setTargetAtTime(0, t + dur, .12);
      e.flash(t, vel); if (own) e.emit(t, m, dur, vel); },
    dispose(e) { [e.n.o, e.n.o2, e.n.vib].forEach(x => x.stop()); },
  },
  Ec: { num: 99, name: 'Eco', kind: 'granuli e risonanze', color: '#7dffc8', lo: 72, hi: 102, rev: .7, del: .9,
    step(e, i, t) { if (R() > e.dens * .35) return;
      const m = deg2midi(G.chordDeg + pick([0, 2, 4, 7, 9, 11, 14]), 5 + e.reg + (R() < .3 ? 1 : 0));
      this.note(e, t + R() * .02, m, .08, .4 + R() * .6, true); },
    note(e, t, m, dur, vel, own) { m = fit(m, this.lo + 12 * e.reg, this.hi + 12 * e.reg);
      V.blip(e.pre, t, mtof(m), vel, .05 + e.tone * .25, e.tone > .6 ? 'square' : 'triangle'); e.flash(t, vel * .8); if (own) e.emit(t, m, dur, vel); },
  },
};

/* ---------- Element ---------- */
let nextId = 1;
class Element {
  constructor(sym, o = {}) {
    this.id = o.id || nextId++; nextId = Math.max(nextId, this.id + 1);
    this.sym = sym; this.T = TYPES[sym];
    this.angle = o.angle || 0; this.elev = o.elev == null ? .3 : o.elev;
    this.vol = o.vol == null ? .75 : o.vol; this.reg = o.reg || 0; this.dens = o.dens == null ? .5 : o.dens;
    this.tone = o.tone == null ? .5 : o.tone; this.drift = o.drift == null ? .3 : o.drift; this.orbit = o.orbit || 0;
    this.everywhere = !!o.everywhere; this.muted = !!o.muted;
    this.level = 0; this.pulse = 0; this.focus = 0; this.rot = 0;
    this.pre = ctx.createGain(); this.pre.gain.value = this.vol;
    this.an = ctx.createAnalyser(); this.an.fftSize = 256; this.buf = new Float32Array(256);
    this.foc = ctx.createGain(); this.foc.gain.value = 0;
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.rs = ctx.createGain(); this.rs.gain.value = this.T.rev;
    this.ds = ctx.createGain(); this.ds.gain.value = this.T.del;
    this.pre.connect(this.an); this.pre.connect(this.foc);
    if (this.pan) { this.foc.connect(this.pan); this.pan.connect(bus); } else this.foc.connect(bus);
    this.foc.connect(this.rs); this.rs.connect(revSend); this.foc.connect(this.ds); this.ds.connect(delSend);
    if (this.T.setup) this.T.setup(this);
    this.applyParams();
  }
  applyParams() {
    const t = ctx.currentTime;
    this.pre.gain.setTargetAtTime(this.muted ? 0 : this.vol, t, .1);
    if (this.T.params) this.T.params(this);
  }
  get receiving() { return bonds.some(b => b.to === this); }
  step(i, t) { if (!this.receiving || this.T.cont && this.sym === 'Pv') this.T.step(this, i, t); }
  receive(t, m, dur, vel) { this.T.note(this, t, m, dur, vel, true); }
  emit(t, m, dur, vel) {
    for (const b of bonds) if (b.from === this) b.to.receive(t + b.delay * stepDur(), snap(m + b.iv), dur, vel * .9);
  }
  flash(t, v) { const d = Math.max(0, (t - ctx.currentTime) * 1000); setTimeout(() => { this.pulse = Math.max(this.pulse, v); }, d); }
  setFocus(f, pan) {
    const t = ctx.currentTime; this.focus = f;
    this.foc.gain.setTargetAtTime(f, t, .12);
    if (this.pan) this.pan.pan.setTargetAtTime(pan, t, .12);
  }
  meter() {
    this.an.getFloatTimeDomainData(this.buf); let s = 0;
    for (let i = 0; i < this.buf.length; i += 2) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / (this.buf.length / 2));
    this.level += (Math.min(1, rms * 6) - this.level) * .3; this.pulse *= .92;
    return this.level;
  }
  regen() { this.pat = null; this.phrase = null; this.rot = R() * 4 | 0; }
  dispose() {
    for (let k = bonds.length - 1; k >= 0; k--) if (bonds[k].from === this || bonds[k].to === this) bonds.splice(k, 1);
    const t = ctx.currentTime; this.foc.gain.setTargetAtTime(0, t, .3);
    setTimeout(() => { try { if (this.T.dispose) this.T.dispose(this); this.foc.disconnect(); this.pre.disconnect(); } catch (e) {} }, 1500);
  }
  toJSON() { const { id, sym, angle, elev, vol, reg, dens, tone, drift, orbit, everywhere, muted } = this; return { id, sym, angle, elev, vol, reg, dens, tone, drift, orbit, everywhere, muted }; }
}

function add(sym, o) { init(); const e = new Element(sym, o); elements.push(e); return e; }
function remove(e) { const i = elements.indexOf(e); if (i >= 0) elements.splice(i, 1); e.dispose(); }
function clear() { [...elements].forEach(remove); bonds.length = 0; }

function reaches(a, b) {  // is b reachable from a through bonds?
  const seen = new Set([a]), st = [a];
  while (st.length) { const x = st.pop(); if (x === b) return true; for (const bd of bonds) if (bd.from === x && !seen.has(bd.to)) { seen.add(bd.to); st.push(bd.to); } }
  return false;
}
function bond(a, b, iv = 7, delay = 2) {
  if (a === b || reaches(b, a) || bonds.some(x => x.from === a && x.to === b)) return null;
  const bd = { from: a, to: b, iv, delay }; bonds.push(bd); return bd;
}
function unbond(bd) { const i = bonds.indexOf(bd); if (i >= 0) bonds.splice(i, 1); }

/* ---------- clock ---------- */
let nextT = 0, stepI = 0, timer = null;
function start() {
  init(); resume();
  if (G.running) return; G.running = true;
  nextT = ctx.currentTime + .1; stepI = 0;
  timer = setInterval(tick, 25);
}
function tick() {
  if (ctx.state !== 'running') return;
  if (nextT < ctx.currentTime - .3) nextT = ctx.currentTime + .05;  // after a pause, don't burst
  while (nextT < ctx.currentTime + .14) {
    G.bpm += (G.bpmTarget - G.bpm) * .04;
    if (stepI % 64 === 0) harmony();
    for (const e of elements) { try { e.step(stepI, nextT); } catch (err) { console.warn(err); } }
    stepI++; nextT += stepDur();
  }
  delNode.delayTime.setTargetAtTime(Math.min(3.5, 60 / G.bpm * .75), ctx.currentTime, .5);
}
function harmony() {
  const bar = stepI / 16 | 0, idx = (bar / 4 | 0) % G.prog.length;
  if (R() < .18) G.prog[R() * G.prog.length | 0] = pick([0, 1, 2, 3, 4, 5, 6, -1, -2]);
  G.chordDeg = G.prog[idx];
}

/* ---------- live performance: touch ---------- */
const touchVoices = new Map();
const STYLE = {
  luna:     { base: 57, wave: 'sine', wave2: 'triangle', det: 4, cut: [600, 5000], q: 1, tap: 'bell' },
  marte:    { base: 45, wave: 'sawtooth', wave2: 'sawtooth', det: 18, cut: [300, 3500], q: 8, tap: 'pluck' },
  orione:   { base: 50, wave: 'sawtooth', wave2: 'triangle', det: 8, cut: [400, 2800], q: 4, tap: 'bell', formant: true },
  distopia: { base: 48, wave: 'square', wave2: 'sawtooth', det: 22, cut: [400, 6000], q: 10, tap: 'pluck' },
  abisso:   { base: 33, wave: 'sine', wave2: 'sawtooth', det: 12, cut: [120, 1400], q: 3, tap: 'boom' },
};
function xToMidi(x, base) { const span = 14, d = Math.max(0, Math.min(span, Math.floor(x * (span + 1)))); return deg2midi(G.chordDeg + d, Math.floor(base / 12) - 1); }
function touchStart(id, x, y) {
  if (!ctx) return; resume();
  const st = STYLE[G.style] || STYLE.luna, t = ctx.currentTime;
  const m = xToMidi(x, st.base), f = mtof(m);
  const v = { st };
  v.a = osc(st.wave, f, -st.det - G.detune * 15, t); v.b = osc(st.wave2, f, st.det + G.detune * 15, t); v.s = osc('sine', f / 2, 0, t);
  v.vib = osc('sine', 5, 0, t); v.vg = ctx.createGain(); v.vg.gain.value = 0; v.vib.connect(v.vg); v.vg.connect(v.a.frequency); v.vg.connect(v.b.frequency);
  v.f = ctx.createBiquadFilter(); v.f.type = 'lowpass'; v.f.Q.value = st.q;
  v.g = ctx.createGain(); v.g.gain.setValueAtTime(0, t); v.g.gain.linearRampToValueAtTime(.16, t + .08);
  const sg = ctx.createGain(); sg.gain.value = G.style === 'abisso' ? .8 : .25;
  v.a.connect(v.f); v.b.connect(v.f); v.s.connect(sg); sg.connect(v.f);
  let tail = v.f;
  if (st.formant) { const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 900; bp.gain.value = 14; bp.Q.value = 3; v.f.connect(bp); tail = bp; v.bp = bp; }
  tail.connect(v.g); v.g.connect(bus);
  v.rs = ctx.createGain(); v.rs.gain.value = .7; v.g.connect(v.rs); v.rs.connect(revSend);
  v.ds = ctx.createGain(); v.ds.gain.value = .35; v.g.connect(v.ds); v.ds.connect(delSend);
  [v.a, v.b, v.s, v.vib].forEach(o => o.start(t));
  touchVoices.set(id, v); touchMove(id, x, y);
  return m;
}
function touchMove(id, x, y) {
  const v = touchVoices.get(id); if (!v) return; const t = ctx.currentTime, st = v.st;
  const m = xToMidi(x, st.base), f = mtof(m);
  v.a.frequency.setTargetAtTime(f, t, .04); v.b.frequency.setTargetAtTime(f, t, .04); v.s.frequency.setTargetAtTime(f / 2, t, .04);
  const c = st.cut[0] * Math.pow(st.cut[1] / st.cut[0], y);
  v.f.frequency.setTargetAtTime(c, t, .05); v.vg.gain.setTargetAtTime(f * .012 * y, t, .1);
  if (v.bp) v.bp.frequency.setTargetAtTime(300 + y * 2200, t, .08);
  return m;
}
function touchEnd(id) {
  const v = touchVoices.get(id); if (!v) return; touchVoices.delete(id);
  const t = ctx.currentTime, rel = G.style === 'abisso' ? 2.5 : 1.2;
  v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.setTargetAtTime(0, t, rel / 4);
  [v.a, v.b, v.s, v.vib].forEach(o => o.stop(t + rel + .1));
}
function tap(x, y) {
  if (!ctx) return; resume();
  const st = STYLE[G.style] || STYLE.luna, t = ctx.currentTime;
  const m = xToMidi(x, st.base + 12 + Math.round(y * 2) * 12 - 12);
  const dest = ctx.createGain(); dest.gain.value = 1; dest.connect(bus);
  const rs = ctx.createGain(); rs.gain.value = .8; dest.connect(rs); rs.connect(revSend);
  const ds = ctx.createGain(); ds.gain.value = .45; dest.connect(ds); ds.connect(delSend);
  if (st.tap === 'bell') V.bell(dest, t, mtof(m + 12), 3, .8, { ratio: pick([3.5, 1.41]), idx: 2.5 });
  else if (st.tap === 'pluck') V.pluck(dest, t, mtof(m), .25, .9, { det: 14 + G.detune * 20, cut: 900 + y * 3000, q: 8 });
  else { V.kick(dest, t, .8, 70, 28, 2); V.bell(dest, t, mtof(m), 4, .4, { ratio: 1.41, idx: 1.2 }); }
  setTimeout(() => dest.disconnect(), 6000);
  return m;
}

/* ---------- global controls ---------- */
function setBright(v) {   // 0 = ground/dark, 1 = sky/bright
  G.bright = v; if (!ctx) return; const t = ctx.currentTime;
  filt.frequency.setTargetAtTime(350 * Math.pow(16000 / 350, v), t, .15);
  revRet.gain.setTargetAtTime(.55 + v * .6, t, .3);
}
function setSpace(v) { G.space = v; if (ctx) revSend.gain.setTargetAtTime(v * 1.3, ctx.currentTime, .3); }
function setVol(v) { G.vol = v; if (ctx) out.gain.setTargetAtTime(v, ctx.currentTime, .1); }
function setDetune(v) { G.detune = v; elements.forEach(e => e.applyParams()); }
function levels() {
  if (!analyser) return { all: 0, bass: 0 };
  const a = levels.buf || (levels.buf = new Uint8Array(analyser.frequencyBinCount)); analyser.getByteFrequencyData(a);
  let s = 0, b = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i < 8) b += a[i]; }
  return { all: s / a.length / 255, bass: b / 8 / 255 };
}

return { G, SCALES, NOTE_IT, TYPES, STYLE, elements, bonds, init, start, resume, add, remove, clear, bond, unbond,
  touchStart, touchMove, touchEnd, tap, setBright, setSpace, setVol, setDetune, levels, deg2midi,
  regenAll() { elements.forEach(e => e.regen()); G.prog = G.prog.map(() => pick([0, 1, 2, 3, 4, 5, 6, -2])); },
  get ctx() { return ctx; } };
})();
