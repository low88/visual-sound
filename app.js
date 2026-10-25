/* Orione — app: sensors, gestures, UI, journey. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const R = Math.random, pick = a => a[R() * a.length | 0];
const TAU = Math.PI * 2, D2R = Math.PI / 180;
const wrap = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ================= worlds ================= */
const WORLDS = {
  luna: { i: 0, name: 'Luna', desc: 'polvere grigia, la Terra sull’orizzonte', root: 9, scale: 'lidio', scales: ['lidio', 'esatonale', 'eolio'], bpm: 68,
    colors: ['#020309', '#1b2436', '#7a7b82', '#9fd3ff', '#e7e3ff'], wp: [.9, .7, .25, 1], els: ['Ab', 'Cr', 'Pv', 'Ec'], prog: [0, 3, 1, 4], wc: '#9fd3ff' },
  marte: { i: 1, name: 'Marte', desc: 'dune rosse, cupole, due lune', root: 2, scale: 'frigio', scales: ['frigio', 'ungherese', 'eolio'], bpm: 84,
    colors: ['#24110d', '#c06a3c', '#8a3b1f', '#ffb36b', '#ff4d2e'], wp: [1.1, .9, .75, .3], els: ['Sb', 'Ne', 'Pv', 'Bt'], prog: [0, 1, 0, 6], wc: '#ff8a4a' },
  orione: { i: 2, name: 'Orione', desc: 'civiltà sepolte sotto la costellazione', root: 4, scale: 'doppio', scales: ['doppio', 'ungherese', 'frigio'], bpm: 66,
    colors: ['#04031a', '#2a2960', '#6b5a3a', '#f2c46b', '#7fe0ff'], wp: [.7, .6, .35, 1.25], els: ['Co', 'Ab', 'Bt', 'Cr'], prog: [0, 1, 4, 1], wc: '#f2c46b' },
  distopia: { i: 3, name: 'Distopia', desc: 'città nella nebbia, synth ’80 stonati', root: 9, scale: 'eolio', scales: ['eolio', 'dorico', 'frigio'], bpm: 100,
    colors: ['#0a0414', '#5a1440', '#140a1c', '#ff2fb3', '#31e7ff'], wp: [.5, .45, .95, .35], els: ['Ne', 'Nb', 'Sb', 'Bt', 'Sg'], prog: [0, 5, 3, 4], wc: '#ff2fb3' },
  abisso: { i: 4, name: 'Abisso', desc: 'profondità buie, malinconia lenta', root: 5, scale: 'locrio', scales: ['locrio', 'eolio', 'frigio'], bpm: 54,
    colors: ['#01060a', '#06242c', '#0c1c1f', '#3fe0c5', '#8a6cff'], wp: [.6, .8, 1, .15], els: ['Ab', 'Nb', 'Ec', 'Co'], prog: [0, 6, 5, 0], wc: '#3fe0c5' },
};
const WKEYS = Object.keys(WORLDS);

/* ================= state ================= */
const st = {
  world: 'orione', seed: R(), campo: .55, quality: .5, viaggio: false, started: false,
  head: 0, elev: 0, roll: 0, manual: 0, calib: 0,
  sensors: 'off', lastOri: 0, flash: 0, fade: 0, worldT0: 0,
};
let saved = null;
try { saved = JSON.parse(localStorage.getItem('orione') || 'null'); } catch (e) {}
function persist() {
  clearTimeout(persist.t);
  persist.t = setTimeout(() => {
    try {
      const G = Sound.G;
      localStorage.setItem('orione', JSON.stringify({
        world: st.world, seed: st.seed, campo: st.campo, quality: st.quality, viaggio: st.viaggio,
        root: G.root, scale: G.scale, bpm: G.bpmTarget, detune: G.detune, space: G.space, vol: G.vol,
        els: Sound.elements.map(e => Object.assign(e.toJSON(), { lx: e.lx, ly: e.ly })),
        bonds: Sound.bonds.map(b => ({ f: b.from.id, t: b.to.id, iv: b.iv, d: b.delay })),
      }));
    } catch (e) {}
  }, 400);
}

/* ================= start screen ================= */
function renderWorldCards(host, cur, onPick) {
  host.innerHTML = '';
  WKEYS.forEach((k, idx) => {
    const w = WORLDS[k], b = document.createElement('button');
    b.className = 'wcard' + (idx === WKEYS.length - 1 ? ' wide' : '');
    b.style.setProperty('--wc', w.wc); b.setAttribute('aria-pressed', k === cur);
    b.innerHTML = `<b>${w.name}</b><small>${w.desc}</small>`;
    b.onclick = () => onPick(k);
    host.appendChild(b);
  });
}
let startPick = saved && saved.world || 'orione';
const pickStart = k => { startPick = k; st.world = k; renderWorldCards($('startWorlds'), k, pickStart); };
pickStart(startPick);
if (saved && saved.els && saved.els.length) $('resumeBtn').hidden = false;

/* ================= visuals boot (runs behind the start screen) ================= */
const cv = $('sky');
let visualOK = false;
try { visualOK = Visual.init(cv); } catch (e) { console.error(e); }
if (!visualOK) toast('Il tuo browser non supporta la grafica WebGL: sentirai solo il suono.', 6000);

/* ================= begin ================= */
async function begin(resume) {
  Sound.init(); Sound.resume();
  await enableSensors();
  const G = Sound.G;
  if (resume && saved) {
    st.world = saved.world; st.seed = saved.seed; st.campo = saved.campo ?? .55; st.quality = saved.quality ?? .5; st.viaggio = !!saved.viaggio;
    applyWorld(st.world, true);
    G.root = saved.root; G.scale = saved.scale; G.bpm = G.bpmTarget = saved.bpm;
    Sound.setDetune(saved.detune ?? .35); Sound.setSpace(saved.space ?? .6); Sound.setVol(saved.vol ?? .85);
    const byId = {};
    saved.els.forEach(o => { const e = Sound.add(o.sym, o); e.lx = o.lx; e.ly = o.ly; byId[o.id] = e; });
    (saved.bonds || []).forEach(b => byId[b.f] && byId[b.t] && Sound.bond(byId[b.f], byId[b.t], b.iv, b.d));
  } else {
    st.seed = R(); applyWorld(st.world, true); populate(st.world);
  }
  Visual.setQuality(st.quality);
  Sound.start();
  st.started = true; st.worldT0 = performance.now();
  $('start').hidden = true; $('hud').hidden = false; wake();
  renderInfo(); persist();
  toast(st.sensors === 'on' ? 'Gira su te stesso: ogni direzione ha i suoi elementi.' : 'Trascina la bussola in alto per girarti.', 4500);
}
$('goBtn').onclick = () => begin(false);
$('resumeBtn').onclick = () => begin(true);

function applyWorld(k, keepKey) {
  const w = WORLDS[k], G = Sound.G;
  st.world = k; G.style = k; G.prog = w.prog.slice();
  if (!keepKey || G.scale == null) { G.root = w.root; G.scale = w.scale; }
  G.root = w.root; G.scale = w.scale; G.bpmTarget = w.bpm; if (!st.started) G.bpm = w.bpm;
  renderInfo();
}
function populate(k) {
  const w = WORLDS[k], n = w.els.length;
  w.els.forEach((sym, i) => {
    const ang = wrap(st.head + (i / n) * TAU + (R() - .5) * .4);
    Sound.add(sym, { angle: ang, elev: .12 + R() * .4, dens: .35 + R() * .4, tone: .3 + R() * .5, orbit: R() < .3 ? (R() - .5) * .5 : 0,
      everywhere: sym === 'Ab' && i === 0 });
  });
}

/* ================= sensors ================= */
let rawHead = 0, rawElev = 0, rawRoll = 0, haveOri = false;
async function enableSensors() {
  try {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') throw new Error('denied');
    }
    if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') { try { await DeviceMotionEvent.requestPermission(); } catch (e) {} }
  } catch (e) { st.sensors = 'denied'; renderSensor(); return; }
  if (!enableSensors.bound) {
    enableSensors.bound = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOri);
    else window.addEventListener('deviceorientation', onOri);
    window.addEventListener('devicemotion', onMotion);
  }
  st.sensors = 'wait'; renderSensor();
  await new Promise(r => setTimeout(r, 700));
  st.sensors = haveOri ? 'on' : 'off'; renderSensor();
}
function onOri(e) {
  if (e.alpha == null || e.beta == null) return;
  haveOri = true; st.lastOri = performance.now();
  if (st.sensors !== 'on' && st.started) { st.sensors = 'on'; renderSensor(); }
  const A = e.alpha * D2R, B = e.beta * D2R, Gm = (e.gamma || 0) * D2R;
  const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B), cG = Math.cos(Gm), sG = Math.sin(Gm);
  // back camera direction (-Z of the device) in world frame (x east, y north, z up)
  const vx = -(cG * sA * sB + cA * sG), vy = -(sA * sG - cA * cG * sB), vz = -cB * cG;
  // device top edge (+Y), used when looking straight up or down
  const ux = -cB * sA, uy = cA * cB, uz = sB;
  const h1 = Math.atan2(vx, vy), h2 = Math.atan2(ux, uy) + (vz < 0 ? 0 : Math.PI);
  const w = clamp((Math.abs(vz) - .8) / .15, 0, 1);
  rawHead = h1 + wrap(h2 - h1) * w;
  rawElev = Math.asin(clamp(vz, -1, 1));
  const Xz = cB * 0 + (-cB * sG), Yz = sB;      // screen right/up vectors' vertical parts
  rawRoll = Math.atan2(Xz, Yz) * (1 - w);
}
let lastAcc = null, lastShake = 0;
function onMotion(e) {
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  if (lastAcc) {
    const d = Math.abs(a.x - lastAcc.x) + Math.abs(a.y - lastAcc.y) + Math.abs(a.z - lastAcc.z);
    const now = performance.now();
    if (d > 26 && now - lastShake > 1600 && st.started) { lastShake = now; modulate(); }
  }
  lastAcc = { x: a.x, y: a.y, z: a.z };
}
function renderSensor() {
  const b = $('sensorBtn');
  b.textContent = { on: 'Sensori attivi', wait: 'Sensori…', off: 'Attiva sensori', denied: 'Sensori negati' }[st.sensors];
  b.classList.toggle('on', st.sensors === 'on');
}
$('sensorBtn').onclick = async () => {
  wake();
  if (st.sensors === 'on') { st.calib = wrap(st.calib + st.head); toast('Riallineato: ora davanti a te c’è il centro del mondo.'); return; }
  await enableSensors();
  if (st.sensors !== 'on') toast(st.sensors === 'denied' ? 'Permesso negato. Puoi riattivarlo dalle impostazioni del browser per questo sito.' : 'Questo dispositivo non ha sensori di orientamento: usa la bussola in alto.', 5000);
};

/* ================= musical moves ================= */
function modulate() {
  const G = Sound.G, w = WORLDS[st.world];
  G.root = ((G.root + pick([5, 7, 7, 2, -2, 3, -3])) % 12 + 12) % 12;
  if (R() < .35) G.scale = pick(w.scales);
  st.flash = 1; renderInfo(); persist();
  ripple(.5, .5, 1); ripple(.5, .5, .3);
  toast('Modulazione → ' + Sound.NOTE_IT[G.root] + ' ' + Sound.SCALES[G.scale].n.toLowerCase());
}
function mutate() {
  Sound.regenAll(); st.seed = (st.seed + .137 + R() * .2) % 1; st.flash = 1;
  Sound.elements.forEach(e => { if (!e.orbit && R() < .3) e.orbit = (R() - .5) * .4; });
  toast('Mutazione: nuove melodie, nuovo paesaggio'); persist();
}
$('mutBtn').onclick = () => { wake(); mutate(); };

/* ================= journey ================= */
let travel = null;
function travelTo(k, keepEls) {
  if (travel) return;
  travel = { t0: performance.now(), to: k, swapped: false, keepEls };
}
function stepTravel(now) {
  if (!travel) { st.fade *= .9; return; }
  const p = (now - travel.t0) / 3600;
  st.fade = Math.sin(Math.min(1, p) * Math.PI) * .92;
  if (!travel.swapped && p > .5) {
    travel.swapped = true; st.seed = R();
    applyWorld(travel.to); st.worldT0 = now;
    if (!travel.keepEls) {
      const have = new Set(Sound.elements.map(e => e.sym));
      const add = WORLDS[travel.to].els.filter(s => !have.has(s));
      if (add.length) Sound.add(pick(add), { angle: wrap(st.head + (R() - .5) * 1.5), elev: .15 + R() * .35 });
      while (Sound.elements.length > 8) Sound.remove(Sound.elements.find(e => !Sound.bonds.some(b => b.from === e || b.to === e)) || Sound.elements[0]);
    }
    toast('Sei arrivato: ' + WORLDS[travel.to].name); persist();
  }
  if (p >= 1) travel = null;
}

/* ================= gestures on the sky ================= */
const touches = new Map(), ripples = [];
let tapTimes = [];
function ripple(x, y, hue) { ripples.unshift({ x, y, t: performance.now() / 1000, hue: hue == null ? R() : hue }); ripples.length = Math.min(ripples.length, 8); }
function norm(ev) { return { x: ev.clientX / innerWidth, y: 1 - ev.clientY / innerHeight }; }

cv.addEventListener('pointerdown', ev => {
  if (!st.started) return;
  ev.preventDefault(); cv.setPointerCapture(ev.pointerId); wake(); Sound.resume();
  const p = norm(ev), now = performance.now();
  const others = [...touches.values()].filter(t => now - t.t0 < 260 && !t.voice);
  const tc = { id: ev.pointerId, x: p.x, y: p.y, x0: p.x, y0: p.y, t0: now, voice: false, multi: others.length > 0, hue: R(), long: false };
  others.forEach(o => o.multi = true);
  touches.set(ev.pointerId, tc);
  tc.timer = setTimeout(() => { if (touches.has(tc.id) && !tc.voice && !tc.multi) startVoice(tc); }, 170);
  tc.lp = setTimeout(() => { if (touches.has(tc.id) && dist(tc) < .03) { tc.long = true; mutate(); ripple(tc.x, tc.y, .1); } }, 950);
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch0 = { d: Math.hypot(a.x - b.x, (a.y - b.y) * innerHeight / innerWidth), space: Sound.G.space, ang: Math.atan2(b.y - a.y, b.x - a.x), man: st.manual }; }
});
const dist = t => Math.hypot(t.x - t.x0, (t.y - t.y0) * innerHeight / innerWidth);
let pinch0 = null;
cv.addEventListener('pointermove', ev => {
  const tc = touches.get(ev.pointerId); if (!tc) return;
  const p = norm(ev); tc.x = p.x; tc.y = p.y;
  if (!tc.voice && !tc.multi && dist(tc) > .025) startVoice(tc);
  if (tc.voice) Sound.touchMove(tc.id, tc.x, tc.y);
  if (touches.size === 2 && pinch0) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, (a.y - b.y) * innerHeight / innerWidth);
    Sound.setSpace(clamp(pinch0.space + (d - pinch0.d) * 1.2, 0, 1));
    if (st.sensors !== 'on') st.manual = pinch0.man - wrap(Math.atan2(b.y - a.y, b.x - a.x) - pinch0.ang);
  }
});
function startVoice(tc) { tc.voice = true; Sound.touchStart(tc.id, tc.x, tc.y); }
function endTouch(ev) {
  const tc = touches.get(ev.pointerId); if (!tc) return;
  touches.delete(ev.pointerId); clearTimeout(tc.timer); clearTimeout(tc.lp);
  const now = performance.now(), short = now - tc.t0 < 260 && dist(tc) < .03;
  if (tc.voice) { Sound.touchEnd(tc.id); ripple(tc.x, tc.y, tc.hue); }
  else if (tc.multi && short) {
    if (!touches.size) tapTempo(now);
  } else if (short && !tc.long) { Sound.tap(tc.x, tc.y); ripple(tc.x, tc.y, tc.hue); }
  if (touches.size < 2) { if (pinch0) persist(); pinch0 = null; }
}
cv.addEventListener('pointerup', endTouch); cv.addEventListener('pointercancel', endTouch);
function tapTempo(now) {
  tapTimes = tapTimes.filter(t => now - t < 3000); tapTimes.push(now);
  if (tapTimes.length >= 3) {
    const iv = []; for (let i = 1; i < tapTimes.length; i++) iv.push(tapTimes[i] - tapTimes[i - 1]);
    const bpm = clamp(Math.round(60000 / (iv.reduce((a, b) => a + b) / iv.length)), 40, 160);
    Sound.G.bpmTarget = bpm; renderInfo(); persist(); toast('Tempo ' + bpm + ' bpm');
  } else toast('Tocca con due dita a ritmo per dare il tempo (' + tapTimes.length + '/3)', 1500);
}

/* ================= compass strip ================= */
const cmp = $('compass'), cctx = cmp.getContext('2d');
let cmpDrag = null;
cmp.addEventListener('pointerdown', ev => { wake(); cmp.setPointerCapture(ev.pointerId); cmpDrag = { x: ev.clientX, m: st.manual }; });
cmp.addEventListener('pointermove', ev => { if (!cmpDrag) return; st.manual = cmpDrag.m - (ev.clientX - cmpDrag.x) / cmp.clientWidth * 2.2; });
cmp.addEventListener('pointerup', () => { cmpDrag = null; });
cmp.addEventListener('pointercancel', () => { cmpDrag = null; });
function drawCompass() {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cmp.clientWidth, h = cmp.clientHeight;
  if (cmp.width !== w * dpr) { cmp.width = w * dpr; cmp.height = h * dpr; }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0); cctx.clearRect(0, 0, w, h);
  const span = 2.2, px = a => w / 2 + wrap(a - st.head) / span * w;
  cctx.font = '600 10px ui-monospace,Menlo,monospace'; cctx.textAlign = 'center';
  const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
  for (let d = 0; d < 360; d += 15) {
    const x = px(d * D2R); if (x < -10 || x > w + 10) continue;
    const major = d % 45 === 0;
    cctx.strokeStyle = major ? 'rgba(239,234,255,.8)' : 'rgba(239,234,255,.3)';
    cctx.beginPath(); cctx.moveTo(x, h - 4); cctx.lineTo(x, h - (major ? 12 : 8)); cctx.stroke();
    if (major) { cctx.fillStyle = 'rgba(239,234,255,.75)'; cctx.fillText(lab[d], x, h - 16); }
  }
  Sound.elements.forEach(e => {
    const x = px(e.angle); if (x < -6 || x > w + 6) return;
    cctx.fillStyle = e.T.color; cctx.globalAlpha = .5 + e.level * .5;
    cctx.beginPath(); cctx.arc(x, 7, 3 + e.level * 3, 0, TAU); cctx.fill(); cctx.globalAlpha = 1;
  });
  cctx.fillStyle = '#f2c46b'; cctx.beginPath(); cctx.moveTo(w / 2 - 5, h); cctx.lineTo(w / 2 + 5, h); cctx.lineTo(w / 2, h - 7); cctx.fill();
}

/* ================= element labels ================= */
const labelsEl = $('labels'), labelNodes = new Map();
function syncLabels() {
  const ids = new Set(Sound.elements.map(e => e.id));
  for (const [id, n] of labelNodes) if (!ids.has(id)) { n.remove(); labelNodes.delete(id); }
  Sound.elements.forEach(e => {
    let n = labelNodes.get(e.id);
    if (!n) {
      n = document.createElement('button'); n.className = 'atom'; n.style.setProperty('--c', e.T.color);
      n.onclick = () => { wake(); openElement(e); };
      labelsEl.appendChild(n); labelNodes.set(e.id, n);
    }
    n.innerHTML = `${e.sym}<sup>${e.T.num}</sup>`; n.classList.toggle('bg', e.everywhere);
    n.setAttribute('aria-label', e.T.name);
  });
}
function placeLabels(fov) {
  const asp = innerWidth / innerHeight, cr = Math.cos(-st.roll), sr = Math.sin(-st.roll);
  Sound.elements.forEach(e => {
    const n = labelNodes.get(e.id); if (!n) return;
    let x = wrap(e.angle - st.head) / fov, y = (e.elev - st.elev) / fov;
    const rx = cr * x - sr * y, ry = sr * x + cr * y;
    const sx = (rx / asp + .5) * innerWidth, sy = (.5 - ry) * innerHeight;
    const vis = Math.abs(wrap(e.angle - st.head)) < fov * asp * .75 + .2;
    n.style.opacity = vis ? (.45 + e.focus * .55) * (e.muted ? .4 : 1) : 0;
    n.style.pointerEvents = vis ? 'auto' : 'none';
    n.style.transform = `translate(${sx + 14}px,${sy - 30}px) scale(${.9 + e.level * .5})`;
  });
}

/* ================= HUD ================= */
function renderInfo() {
  const G = Sound.G, w = WORLDS[st.world];
  $('worldName').textContent = w.name;
  $('keyInfo').textContent = `${Sound.NOTE_IT[G.root]} ${Sound.SCALES[G.scale].n.toLowerCase()} · ${Math.round(G.bpmTarget)} bpm`;
}
let idleT = 0;
function wake() { $('hud').classList.remove('dim'); clearTimeout(idleT); idleT = setTimeout(() => $('hud').classList.add('dim'), 6000); }
document.addEventListener('pointerdown', ev => { if (ev.target.closest('.hud,.sheet,.lab')) wake(); }, true);
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }

/* ================= sheets ================= */
function openSheet(title, build) {
  $('sheetTitle').textContent = title; const body = $('sheetBody'); body.innerHTML = ''; build(body); $('sheet').hidden = false;
}
function closeSheet() { $('sheet').hidden = true; }
$('sheetClose').onclick = closeSheet;
$('sheet').addEventListener('pointerdown', ev => { if (ev.target === $('sheet')) closeSheet(); });

function slider(host, label, val, min, max, step, fmt, on) {
  const id = 's' + Math.random().toString(36).slice(2, 8), row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output for="${id}"></output>`;
  const inp = row.querySelector('input'), o = row.querySelector('output');
  const show = () => o.textContent = fmt(+inp.value); show();
  inp.oninput = () => { show(); on(+inp.value); };
  inp.onchange = persist;
  host.appendChild(row); return inp;
}
const P = v => Math.round(v * 100);
function sec(host, txt) { const s = document.createElement('div'); s.className = 'sec'; s.textContent = txt; host.appendChild(s); }
function btn(host, txt, on, pressed, cls) { const b = document.createElement('button'); b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = txt;
  if (pressed != null) b.setAttribute('aria-pressed', pressed); b.onclick = () => on(b); host.appendChild(b); return b; }

$('addBtn').onclick = () => openSheet('Elementi', body => {
  const p = document.createElement('p'); p.className = 'note';
  p.textContent = 'Scegli un elemento: apparirà nel cielo davanti a te. Girati per allontanarlo, avvicinati per sentirlo.';
  body.appendChild(p);
  const tab = document.createElement('div'); tab.className = 'ptable'; body.appendChild(tab);
  Object.entries(Sound.TYPES).forEach(([sym, T]) => {
    const n = Sound.elements.filter(e => e.sym === sym).length;
    const b = document.createElement('button'); b.className = 'tile'; b.style.setProperty('--c', T.color);
    b.innerHTML = `<span class="n">${T.num}</span><div class="s">${sym}</div><b>${T.name}</b><small>${T.kind}</small>${n ? `<span class="cnt">×${n}</span>` : ''}`;
    b.onclick = () => {
      if (Sound.elements.length >= 10) { toast('Massimo 10 elementi: rimuovine uno prima.'); return; }
      const e = Sound.add(sym, { angle: wrap(st.head + (R() - .5) * .3), elev: clamp(st.elev + .15 + R() * .2, .08, 1.1), dens: .5, tone: .5 });
      syncLabels(); persist(); closeSheet(); st.flash = .6;
      toast(`${T.name} aggiunto davanti a te (${Math.round(((e.angle / D2R) % 360 + 360) % 360)}°)`);
    };
    tab.appendChild(b);
  });
});

function openElement(e) {
  openSheet(e.T.name, body => {
    const h = document.createElement('div'); h.className = 'ehead'; h.style.setProperty('--c', e.T.color);
    h.innerHTML = `<div class="big">${e.sym}</div><div><b>${e.T.name}</b><small>${e.T.kind} · n. ${e.T.num}</small><small>${Math.round(((e.angle / D2R) % 360 + 360) % 360)}° · ${e.receiving ? 'riceve note dalla catena' : 'suona da solo'}</small></div>`;
    body.appendChild(h);
    const set = (k, v) => { e[k] = v; e.applyParams(); };
    slider(body, 'Volume', e.vol, 0, 1, .01, P, v => set('vol', v));
    slider(body, 'Registro', e.reg, -2, 2, 1, v => (v > 0 ? '+' : '') + v, v => set('reg', v));
    slider(body, 'Densità', e.dens, 0, 1, .01, P, v => set('dens', v));
    slider(body, 'Timbro', e.tone, 0, 1, .01, P, v => set('tone', v));
    slider(body, 'Deriva', e.drift, 0, 1, .01, P, v => set('drift', v));
    slider(body, 'Orbita', e.orbit, -1, 1, .01, v => v === 0 ? 'ferma' : (v > 0 ? '↻ ' : '↺ ') + P(Math.abs(v)), v => { e.orbit = Math.abs(v) < .03 ? 0 : v; });
    slider(body, 'Altezza', e.elev, .02, 1.2, .01, v => Math.round(v / D2R) + '°', v => { e.elev = v; });
    const pos = slider(body, 'Posizione', Math.round(((e.angle / D2R) % 360 + 360) % 360), 0, 359, 1, v => v + '°', v => { e.angle = wrap(v * D2R); });
    const b = document.createElement('div'); b.className = 'btns'; body.appendChild(b);
    btn(b, 'Portalo qui', () => { e.angle = wrap(st.head); pos.value = Math.round(((e.angle / D2R) % 360 + 360) % 360); pos.oninput(); persist(); });
    btn(b, 'Ovunque', x => { e.everywhere = !e.everywhere; x.setAttribute('aria-pressed', e.everywhere); syncLabels(); persist(); }, e.everywhere);
    btn(b, 'Muto', x => { e.muted = !e.muted; e.applyParams(); x.setAttribute('aria-pressed', e.muted); persist(); }, e.muted);
    btn(b, 'Rigenera', () => { e.regen(); toast('Nuovo motivo per ' + e.T.name); });
    btn(b, 'Rimuovi', () => { Sound.remove(e); syncLabels(); persist(); closeSheet(); }, null, 'warn');
    const n = document.createElement('p'); n.className = 'note';
    n.textContent = '“Ovunque” lo fa suonare in ogni direzione, come uno sfondo. L’orbita lo fa girare lentamente intorno a te.';
    body.appendChild(n);
  });
}

$('worldBtn').onclick = () => openSheet('Mondo', body => {
  const G = Sound.G;
  sec(body, 'Destinazione');
  const wc = document.createElement('div'); wc.className = 'worlds'; body.appendChild(wc);
  renderWorldCards(wc, st.world, k => { if (k !== st.world) { travelTo(k); closeSheet(); } });
  const vb = document.createElement('div'); vb.className = 'btns'; body.appendChild(vb);
  btn(vb, 'Viaggio automatico', x => { st.viaggio = !st.viaggio; x.setAttribute('aria-pressed', st.viaggio); st.worldT0 = performance.now(); persist();
    toast(st.viaggio ? 'Ogni pochi minuti partirai per un nuovo mondo.' : 'Resti qui.'); }, st.viaggio);
  btn(vb, 'Nuovo viaggio', () => { Sound.clear(); st.seed = R(); applyWorld(st.world); populate(st.world); syncLabels(); persist(); closeSheet(); toast('Mondo rigenerato'); });
  btn(vb, 'Svuota', () => { Sound.clear(); syncLabels(); persist(); toast('Silenzio. Aggiungi elementi con ＋'); }, null, 'warn');

  sec(body, 'Armonia e tempo');
  const two = document.createElement('div'); two.className = 'two'; body.appendChild(two);
  const kSel = document.createElement('select'); kSel.setAttribute('aria-label', 'Tonalità');
  kSel.innerHTML = Sound.NOTE_IT.map((n, i) => `<option value="${i}" ${i === G.root ? 'selected' : ''}>${n}</option>`).join('');
  kSel.onchange = () => { G.root = +kSel.value; renderInfo(); persist(); };
  const sSel = document.createElement('select'); sSel.setAttribute('aria-label', 'Scala');
  sSel.innerHTML = Object.entries(Sound.SCALES).map(([k, s]) => `<option value="${k}" ${k === G.scale ? 'selected' : ''}>${s.n}</option>`).join('');
  sSel.onchange = () => { G.scale = sSel.value; renderInfo(); persist(); };
  two.append(kSel, sSel);
  slider(body, 'Tempo', Math.round(G.bpmTarget), 40, 160, 1, v => v + '', v => { G.bpmTarget = v; renderInfo(); });

  sec(body, 'Spazio');
  slider(body, 'Campo', st.campo, 0, 1, .01, v => v < .05 ? 'tutto' : P(v), v => { st.campo = v; });
  slider(body, 'Vastità', G.space, 0, 1, .01, P, v => Sound.setSpace(v));
  slider(body, 'Detune ’80', G.detune, 0, 1, .01, P, v => Sound.setDetune(v));
  slider(body, 'Volume', G.vol, 0, 1, .01, P, v => Sound.setVol(v));

  sec(body, 'Immagine');
  const qb = document.createElement('div'); qb.className = 'btns'; body.appendChild(qb);
  const qs = [['Leggera', .35], ['Media', .5], ['Alta', .75]];
  const qbtns = qs.map(([n, q]) => btn(qb, n, () => { st.quality = q; Visual.setQuality(q); qbtns.forEach((b, i) => b.setAttribute('aria-pressed', qs[i][1] === q)); persist(); }, st.quality === q));

  const n = document.createElement('p'); n.className = 'note';
  n.innerHTML = 'Gesti: tocca per una nota, tieni premuto e trascina per suonare, tieni fermo a lungo per mutare, due dita a ritmo per il tempo, allarga due dita per la vastità, scuoti per cambiare tonalità. Guarda in alto per suoni più luminosi, in basso per suoni più profondi.';
  body.appendChild(n);
});

/* ================= chain lab ================= */
const lab = $('lab'), lcv = $('labCv'), lctx = lcv.getContext('2d'), atomsEl = $('labAtoms');
let labOpen = false, dragA = null, selBond = null;
$('labBtn').onclick = () => { wake(); openLab(); };
$('labClose').onclick = () => { lab.hidden = true; labOpen = false; $('bondMenu').hidden = true; };
function openLab() {
  lab.hidden = false; labOpen = true; atomsEl.innerHTML = ''; $('bondMenu').hidden = true;
  const els = Sound.elements, n = els.length;
  if (!n) toast('Aggiungi prima qualche elemento con ＋');
  els.forEach((e, i) => {
    if (e.lx == null) { const a = i / n * TAU - Math.PI / 2; e.lx = .5 + Math.cos(a) * .32; e.ly = .55 + Math.sin(a) * .26; }
    const d = document.createElement('button'); d.className = 'labatom'; d.style.setProperty('--c', e.T.color);
    d.innerHTML = `<div>${e.sym}<small>${e.T.name}</small></div>`; d.dataset.id = e.id; e.dom = d;
    d.addEventListener('pointerdown', ev => { ev.preventDefault(); d.setPointerCapture(ev.pointerId); dragA = { e, x0: ev.clientX, y0: ev.clientY, moved: false }; d.classList.add('drag'); $('bondMenu').hidden = true; });
    d.addEventListener('pointermove', ev => {
      if (!dragA || dragA.e !== e) return;
      if (Math.hypot(ev.clientX - dragA.x0, ev.clientY - dragA.y0) > 6) dragA.moved = true;
      e.lx = clamp(ev.clientX / innerWidth, .08, .92); e.ly = clamp(ev.clientY / innerHeight, .2, .9);
      const tgt = hitAtom(ev.clientX, ev.clientY, e); els.forEach(o => o.dom && o.dom.classList.toggle('target', o === tgt));
    });
    const up = ev => {
      if (!dragA || dragA.e !== e) return; d.classList.remove('drag');
      const tgt = hitAtom(ev.clientX, ev.clientY, e);
      els.forEach(o => o.dom && o.dom.classList.remove('target'));
      if (tgt) {
        const b = Sound.bond(e, tgt, pick([7, 12, 5, 4, 3]), pick([2, 4]));
        if (b) { e.lx = clamp(e.lx + (e.lx < tgt.lx ? -.12 : .12), .08, .92); toast(`${e.T.name} → ${tgt.T.name}: legati`); }
        else toast('Questo legame creerebbe un cerchio chiuso o esiste già.');
      } else if (!dragA.moved) { lab.hidden = true; labOpen = false; openElement(e); }
      dragA = null; persist();
    };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    atomsEl.appendChild(d);
  });
}
function hitAtom(x, y, self) {
  return Sound.elements.find(o => o !== self && o.lx != null && Math.hypot(o.lx * innerWidth - x, o.ly * innerHeight - y) < 40);
}
lcv.addEventListener('pointerdown', ev => {
  const x = ev.clientX, y = ev.clientY;
  const b = Sound.bonds.find(b => { const mx = (b.from.lx + b.to.lx) / 2 * innerWidth, my = (b.from.ly + b.to.ly) / 2 * innerHeight; return Math.hypot(mx - x, my - y) < 34; });
  if (b) openBondMenu(b, x, y); else $('bondMenu').hidden = true;
});
const IVN = { '-12': '−8ª', 0: 'unisono', 3: '+3ª min', 4: '+3ª', 5: '+4ª', 7: '+5ª', 12: '+8ª' };
function openBondMenu(b, x, y) {
  const m = $('bondMenu'); m.innerHTML = ''; selBond = b;
  const h = document.createElement('div'); h.className = 'sec'; h.textContent = `${b.from.T.name} → ${b.to.T.name}`; m.appendChild(h);
  const iv = document.createElement('div'); iv.className = 'btns'; m.appendChild(iv);
  const ivs = [-12, 0, 3, 4, 5, 7, 12], ib = ivs.map(v => btn(iv, IVN[v], () => { b.iv = v; ib.forEach((x, i) => x.setAttribute('aria-pressed', ivs[i] === v)); persist(); }, b.iv === v));
  const dl = document.createElement('div'); dl.className = 'btns'; m.appendChild(dl);
  const ds = [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, '1 battuta']];
  const db = ds.map(([v, n]) => btn(dl, 'ritardo ' + n, () => { b.delay = v; db.forEach((x, i) => x.setAttribute('aria-pressed', ds[i][0] === v)); persist(); }, b.delay === v));
  const ex = document.createElement('div'); ex.className = 'btns'; m.appendChild(ex);
  btn(ex, 'Rompi legame', () => { Sound.unbond(b); m.hidden = true; persist(); }, null, 'warn');
  m.hidden = false;
  const mw = 250, mh = m.offsetHeight;
  m.style.left = clamp(x - mw / 2, 10, innerWidth - mw - 10) + 'px';
  m.style.top = clamp(y + 20, 80, innerHeight - mh - 20) + 'px';
}
function drawLab(t) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  if (lcv.width !== w * dpr) { lcv.width = w * dpr; lcv.height = h * dpr; }
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, w, h);
  Sound.bonds.forEach(b => {
    const x1 = b.from.lx * w, y1 = b.from.ly * h, x2 = b.to.lx * w, y2 = b.to.ly * h;
    const g = lctx.createLinearGradient(x1, y1, x2, y2); g.addColorStop(0, b.from.T.color); g.addColorStop(1, b.to.T.color);
    lctx.strokeStyle = g; lctx.lineWidth = 2 + b.from.level * 4; lctx.globalAlpha = .85;
    lctx.beginPath(); lctx.moveTo(x1, y1); lctx.lineTo(x2, y2); lctx.stroke();
    const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    for (let k = 0; k < 3; k++) { const f = ((t * .35 + k / 3) % 1), px = x1 + (x2 - x1) * f, py = y1 + (y2 - y1) * f;
      lctx.fillStyle = '#fff'; lctx.globalAlpha = .4 + b.from.pulse * .6; lctx.beginPath(); lctx.arc(px, py, 2.5 + b.from.pulse * 3, 0, TAU); lctx.fill(); }
    const ax = x2 - ux * 40, ay = y2 - uy * 40; lctx.globalAlpha = 1; lctx.fillStyle = b.to.T.color;
    lctx.beginPath(); lctx.moveTo(ax + ux * 10, ay + uy * 10); lctx.lineTo(ax - uy * 6, ay + ux * 6); lctx.lineTo(ax + uy * 6, ay - ux * 6); lctx.fill();
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    lctx.fillStyle = 'rgba(10,9,22,.85)'; lctx.strokeStyle = 'rgba(239,234,255,.35)'; lctx.lineWidth = 1;
    lctx.beginPath(); lctx.roundRect ? lctx.roundRect(mx - 30, my - 12, 60, 24, 12) : lctx.rect(mx - 30, my - 12, 60, 24); lctx.fill(); lctx.stroke();
    lctx.fillStyle = '#efeaff'; lctx.font = '600 11px ui-monospace,Menlo,monospace'; lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
    lctx.fillText(IVN[b.iv] || b.iv, mx, my + 1);
  });
  lctx.globalAlpha = 1;
  Sound.elements.forEach(e => { if (!e.dom) return; e.dom.style.left = e.lx * w + 'px'; e.dom.style.top = e.ly * h + 'px'; e.dom.style.setProperty('--lv', Math.max(e.level, e.pulse)); });
}

/* ================= main loop ================= */
let last = performance.now(), focusTick = 0, lastBright = -1, lastDet = -1, idleHead = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  const t = now / 1000;

  // view direction: sensors (smoothed) + manual offset; gentle drift when nothing moves it
  const sensorLive = st.sensors === 'on' && now - st.lastOri < 1500;
  let target = st.manual - st.calib, tElev = .08, tRoll = 0;
  if (sensorLive) { target += rawHead; tElev = rawElev; tRoll = rawRoll; }
  else { if (st.started && !cmpDrag && !touches.size) idleHead += dt * .02; target += idleHead; }
  st.head = wrap(st.head + wrap(target - st.head) * Math.min(1, dt * 8));
  st.elev += (clamp(tElev, -1.2, 1.4) - st.elev) * Math.min(1, dt * 8);
  st.roll += (tRoll - st.roll) * Math.min(1, dt * 8);

  stepTravel(now);
  st.flash *= .93;

  if (st.started) {
    if (st.viaggio && !travel && now - st.worldT0 > 150000 + st.seed * 60000) travelTo(pick(WKEYS.filter(k => k !== st.world)));
    // orbits
    Sound.elements.forEach(e => { if (e.orbit) e.angle = wrap(e.angle + e.orbit * dt * .08); });
    // spatial focus (every other frame)
    if (++focusTick % 2 === 0) {
      const half = (.15 + (1 - st.campo) * .85) * Math.PI;   // half-width of hearing cone
      Sound.elements.forEach(e => {
        const d = wrap(e.angle - st.head);
        let f = e.everywhere ? 1 : clamp((Math.cos(d) - Math.cos(half)) / (1 - Math.cos(half) + 1e-3), 0, 1);
        if (st.campo < .05) f = 1;
        f = .05 + .95 * Math.pow(f, .8);
        e.setFocus(f, e.everywhere ? 0 : Math.sin(d) * .85);
      });
    }
    const bright = clamp(.5 + st.elev / 1.1, 0, 1);
    if (Math.abs(bright - lastBright) > .015) { Sound.setBright(bright); lastBright = bright; }
    const det = clamp(Math.abs(st.roll) / 1.2, 0, 1);
    if (Math.abs(det - lastDet) > .04) { lastDet = det; Sound.G.detuneRoll = det; }
  }

  // meters
  let lv = { all: 0, bass: 0 };
  if (st.started) { lv = Sound.levels(); Sound.elements.forEach(e => e.meter()); }

  const fov = 1.05;
  if (visualOK) {
    const w = WORLDS[st.world];
    Visual.draw({
      time: t % 3600, head: st.head, elev: st.elev, roll: st.roll, fov, seed: st.seed, world: w.i,
      level: lv.all * 2.2, bass: lv.bass, flash: st.flash, fade: st.fade, colors: w.colors, wp: w.wp,
      els: Sound.elements.map(e => ({ angle: e.angle, elev: e.elev, level: Math.max(e.level, e.pulse * .8), focus: e.focus, color: e.T.color })),
      touches: [...touches.values()].filter(x => x.voice).map(x => ({ x: x.x, y: x.y, hue: x.hue })),
      ripples: ripples.map(r => ({ x: r.x, y: r.y, t: r.t % 3600, hue: r.hue })),
    });
  }
  if (st.started) { placeLabels(fov); drawCompass(); }
  if (labOpen) drawLab(t);
}
requestAnimationFrame(loop);

// keep things in sync
setInterval(() => { if (st.started) syncLabels(); }, 500);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sound.resume(); });
window.addEventListener('resize', () => Visual.resize());
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
wake();
})();
