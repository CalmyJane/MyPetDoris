import { Show, drawThumb, fingerPath, fingerWidth } from './stage.js';
import { Hud, loadHandLandmarker, palmCenter } from './handtrack.js';
import { WaveDetector } from './wave.js';
import { CREATURES } from './creatures.js';
import { drawnFinger, photoFinger, capturedFinger, cutFinger } from './finger.js';

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// The show is a list of steps. Each one waits for its start signal, then plays;
// when the list is done nothing more happens.
const DEFAULT_STEPS = [
  { what: 'cockroach', on: 'wave', t: 3 },
  { what: 'finger', on: 'time', t: 0.4 },
];
const STEP_WHAT = [['cockroach', 'Cockroach'], ['spider', 'Spider'], ['worm', 'Earthworm'], ['finger', 'Finger']];
const STEP_ON = [['wave', 'Wave'], ['tap', 'Tap'], ['tap2', '2× tap'], ['tap3', '3× tap'], ['time', 'Time']];

const DEFAULTS = {
  steps: DEFAULT_STEPS,
  sensitivity: 0.55,
  delay: 0.4,
  side: 'random',
  size: 1,
  speed: 1,
  haptics: true,
  hud: true,
  guide: true,
  zoom: 1.5,
  fingerScratch: 'off', // off | tap | auto: finger scratches a creature while it's on screen
  fingerEdge: 'r', // l | r | bl | b | br
  fingerCue: 1,
  fingerSlide: 0.9,
  fingerSide: 'pad', // pad | nail (drawn finger)
  fingerTone: 0.25,
  fingerSize: 1,
};

let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('doris.settings') || '{}') }; } catch {}
const validStep = (st) => st && STEP_WHAT.some(([k]) => k === st.what) && STEP_ON.some(([k]) => k === st.on);
settings.steps = (Array.isArray(settings.steps) && settings.steps !== DEFAULT_STEPS ? settings.steps.filter(validStep) : DEFAULT_STEPS)
  .map((st) => ({ t: 3, ...st }));
const hasStep = (s, f) => s.steps.some(f);
const usesCreature = (s) => hasStep(s, (st) => st.what !== 'finger');
const usesFinger = (s) => hasStep(s, (st) => st.what === 'finger') || (s.fingerScratch !== 'off' && usesCreature(s));
const save = () => { try { localStorage.setItem('doris.settings', JSON.stringify(settings)); } catch {} };

const pct = (v) => `${Math.round(v * 100)}%`;
const SCHEMA = [
  { key: 'steps', label: 'Sequence', type: 'steps',
    note: () => 'Each step waits for its start signal, then plays. After the last step nothing more happens. Wave also accepts a double-tap as backup. Tap the photo 5× quickly to get back to the menu.' },
  { key: 'sensitivity', label: 'Wave sensitivity', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, show: (s) => hasStep(s, (st) => st.on === 'wave') },
  { key: 'delay', label: 'Delay after wave / tap', type: 'range', min: 0, max: 2, step: 0.1, fmt: (v) => `${(+v).toFixed(1)} s` },
  { key: 'side', label: 'Creature enters from', type: 'seg', options: [['random', 'Any'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']], show: usesCreature },
  { key: 'size', label: 'Creature size', type: 'range', min: 0.5, max: 1.6, step: 0.05, fmt: pct, show: usesCreature },
  { key: 'speed', label: 'Creature speed', type: 'range', min: 0.4, max: 2, step: 0.05, fmt: pct, show: usesCreature },
  { key: 'fingerScratch', label: 'Finger scratches creature', type: 'seg', options: [['off', 'Off'], ['tap', 'On tap'], ['auto', 'Auto']], show: usesCreature,
    note: (s) => ({
      off: '',
      tap: 'Tap while it is on screen: a finger slides in and scratches its back. Slide your real finger in under the phone at the same time.',
      auto: 'When it stops on the palm a finger slides in and scratches its back. Slide your real finger in under the phone at the same time.',
    })[s.fingerScratch] },
  { key: 'fingerEdge', label: 'Finger enters at', type: 'seg', options: [['l', 'Left'], ['r', 'Right'], ['bl', 'Bottom-L'], ['b', 'Bottom'], ['br', 'Bottom-R']], show: usesFinger },
  { key: 'fingerCue', label: 'Fingertip cue', type: 'range', min: 0.3, max: 2.5, step: 0.1, fmt: (v) => `${(+v).toFixed(1)} s`, show: (s) => hasStep(s, (st) => st.what === 'finger') },
  { key: 'fingerSlide', label: 'Finger slide time', type: 'range', min: 0.4, max: 2, step: 0.1, fmt: (v) => `${(+v).toFixed(1)} s`, show: (s) => hasStep(s, (st) => st.what === 'finger') },
  { key: 'fingerImg', label: 'Finger look', type: 'finger', show: usesFinger,
    note: () => myFinger ? 'Using your own finger photo.' : 'A real finger photo. Or use your own: hold your index finger straight inside the outline, palm side to the camera, against a plain background that is not skin coloured.' },
  { key: 'fingerSide', label: 'Finger shows', type: 'seg', options: [['pad', 'Pad (palm side)'], ['nail', 'Nail (back)']], show: (s) => usesFinger(s) && !myFinger,
    onChange: () => updatePhotoFinger() },
  { key: 'fingerTone', label: 'Skin tone', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, show: (s) => usesFinger(s) && !myFinger },
  { key: 'fingerSize', label: 'Finger size', type: 'range', min: 0.6, max: 1.6, step: 0.05, fmt: pct, show: usesFinger },
  { key: 'haptics', label: 'Footstep vibration', type: 'toggle' },
  { key: 'hud', label: 'Hand-tracking overlay', type: 'toggle' },
  { key: 'guide', label: 'Framing guide on camera', type: 'toggle',
    note: () => 'Dashed outline of where the palm (and the screen finger) should sit, so the photo lines up with the real hand when the phone is laid on it.' },
];

function buildSettings() {
  const body = $('#settings-body');
  body.innerHTML = '';
  for (const f of SCHEMA) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.key = f.key;
    const head = document.createElement('div');
    head.className = 'row-head';
    head.innerHTML = `<span>${f.label}</span><span class="val"></span>`;
    row.appendChild(head);
    const val = head.querySelector('.val');

    if (f.type === 'steps') {
      const list = document.createElement('div');
      list.className = 'steps';
      row.appendChild(list);
      row._steps = list;
      const tools = document.createElement('div');
      tools.className = 'step-foot';
      const bAdd = document.createElement('button'); bAdd.className = 'text-btn'; bAdd.textContent = '+ Add step';
      const bDef = document.createElement('button'); bDef.className = 'text-btn dim'; bDef.textContent = 'Reset to default';
      bAdd.onclick = () => { settings.steps.push({ what: 'cockroach', on: 'wave', t: 3 }); save(); refresh(); };
      bDef.onclick = () => { settings.steps = DEFAULT_STEPS.map((st) => ({ ...st })); save(); refresh(); };
      tools.append(bAdd, bDef);
      row.appendChild(tools);
    } else if (f.type === 'creature') {
      const grid = document.createElement('div');
      grid.className = 'creatures';
      for (const [k, def] of Object.entries(CREATURES)) {
        const b = document.createElement('button');
        b.innerHTML = `<canvas></canvas>${def.label}`;
        b.classList.toggle('on', settings.creature === k);
        b.onclick = () => { settings.creature = k; save(); grid.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
        grid.appendChild(b);
        requestAnimationFrame(() => drawThumb(b.querySelector('canvas'), k));
      }
      row.appendChild(grid);
    } else if (f.type === 'seg') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const [v, l] of f.options) {
        const b = document.createElement('button');
        b.textContent = l;
        b.classList.toggle('on', settings[f.key] === v);
        b.onclick = () => { settings[f.key] = v; save(); refresh(); Promise.resolve(f.onChange?.()).then(refresh); };
        seg.appendChild(b);
      }
      row.appendChild(seg);
    } else if (f.type === 'range') {
      const r = document.createElement('input');
      r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.value = settings[f.key];
      val.textContent = f.fmt(settings[f.key]);
      r.oninput = () => { settings[f.key] = +r.value; val.textContent = f.fmt(+r.value); save(); if (f.key === 'fingerTone') { clearTimeout(toneT); toneT = setTimeout(() => updatePhotoFinger().then(refresh), 120); } };
      row.appendChild(r);
    } else if (f.type === 'finger') {
      const box = document.createElement('div');
      box.className = 'finger-row';
      const cv = document.createElement('canvas');
      const bCap = document.createElement('button'); bCap.className = 'text-btn'; bCap.textContent = 'Use my finger';
      const bReset = document.createElement('button'); bReset.className = 'text-btn'; bReset.textContent = 'Use stock photo';
      bCap.onclick = () => { closeSettings(); openCamera({ mode: 'finger' }); };
      bReset.onclick = () => { myFinger = null; try { localStorage.removeItem('doris.finger'); } catch {} buildSettings(); };
      box.append(cv, bCap);
      if (myFinger) box.append(bReset);
      row.appendChild(box);
      val.textContent = myFinger ? 'yours' : 'photo';
      row._thumb = cv;
    } else if (f.type === 'toggle') {
      row.classList.add('inline');
      const t = document.createElement('button');
      t.className = 'toggle';
      t.classList.toggle('on', !!settings[f.key]);
      t.onclick = () => { settings[f.key] = !settings[f.key]; t.classList.toggle('on', settings[f.key]); save(); };
      row.appendChild(t);
    }
    if (f.note) {
      const p = document.createElement('p');
      p.className = 'note';
      row.appendChild(p);
    }
    body.appendChild(row);
  }
  refresh();

  function refresh() {
    for (const f of SCHEMA) {
      const row = body.querySelector(`[data-key="${f.key}"]`);
      row.classList.toggle('hidden', !!f.show && !f.show(settings));
      if (f.type === 'seg') {
        row.querySelectorAll('.seg button').forEach((b, i) => b.classList.toggle('on', f.options[i][0] === settings[f.key]));
      }
      if (f.note) row.querySelector('.note').textContent = f.note(settings);
      if (row._thumb) fingerThumb(row._thumb);
      if (row._steps) renderSteps(row._steps);
    }
  }

  function renderSteps(list) {
    list.innerHTML = '';
    const steps = settings.steps;
    if (!steps.length) {
      const p = document.createElement('p'); p.className = 'note'; p.textContent = 'No steps: nothing will happen.';
      list.appendChild(p);
    }
    const change = (fn) => { fn(); save(); refresh(); };
    steps.forEach((st, i) => {
      const card = document.createElement('div');
      card.className = 'step';
      const head = document.createElement('div');
      head.className = 'step-head';
      head.innerHTML = `<span class="step-n">${i + 1}</span><span class="step-title"></span><span class="step-tools"></span>`;
      head.querySelector('.step-title').textContent = STEP_WHAT.find(([k]) => k === st.what)[1];
      const tb = head.querySelector('.step-tools');
      const tool = (label, aria, fn, off) => {
        const b = document.createElement('button'); b.textContent = label; b.setAttribute('aria-label', aria);
        b.disabled = !!off; b.onclick = () => change(fn); tb.appendChild(b);
      };
      tool('↑', 'Move up', () => steps.splice(i - 1, 0, steps.splice(i, 1)[0]), i === 0);
      tool('↓', 'Move down', () => steps.splice(i + 1, 0, steps.splice(i, 1)[0]), i === steps.length - 1);
      tool('✕', 'Remove step', () => steps.splice(i, 1));
      card.appendChild(head);
      const seg = (opts, key) => {
        const el = document.createElement('div'); el.className = 'seg';
        for (const [v, l] of opts) {
          const b = document.createElement('button'); b.textContent = l;
          b.classList.toggle('on', st[key] === v);
          b.onclick = () => change(() => { st[key] = v; });
          el.appendChild(b);
        }
        return el;
      };
      card.appendChild(seg(STEP_WHAT, 'what'));
      const sub = document.createElement('div'); sub.className = 'step-sub'; sub.textContent = 'Starts on';
      card.append(sub, seg(STEP_ON, 'on'));
      if (st.on === 'time') {
        const tr = document.createElement('div'); tr.className = 'step-time';
        const lab = document.createElement('span');
        const r = document.createElement('input');
        r.type = 'range'; r.min = 0; r.max = 20; r.step = 0.1; r.value = st.t;
        const txt = () => { lab.textContent = `${(+st.t).toFixed(1)} s after ${i === 0 ? 'the photo' : 'step ' + i + ' ends'}`; };
        r.oninput = () => { st.t = +r.value; txt(); save(); };
        txt();
        tr.append(lab, r);
        card.appendChild(tr);
      }
      list.appendChild(card);
    });
  }
}

function openSettings() { buildSettings(); $('#settings').classList.add('open'); $('#settings').setAttribute('aria-hidden', 'false'); }
function closeSettings() { $('#settings').classList.remove('open'); $('#settings').setAttribute('aria-hidden', 'true'); }

// ---------------------------------------------------------------------------
// Finger
// ---------------------------------------------------------------------------

let myFinger = null; // captured finger image ({canvas,w,tip}) or null
try {
  const url = localStorage.getItem('doris.finger');
  if (url) capturedFinger(url).then((f) => { myFinger = f; });
} catch {}

let toneT = 0;
let stockFinger = null; // tinted stock photo finger for the current side/tone
function updatePhotoFinger() {
  const side = settings.fingerSide, tone = settings.fingerTone;
  return photoFinger(side, tone).then((f) => {
    if (side === settings.fingerSide && tone === settings.fingerTone) stockFinger = f;
  });
}
updatePhotoFinger();

let drawnCache = { key: '', img: null };
function fingerImage() {
  if (myFinger) return myFinger;
  if (stockFinger) return stockFinger;
  const key = settings.fingerTone + settings.fingerSide;
  if (drawnCache.key !== key) drawnCache = { key, img: drawnFinger(settings.fingerTone, 170, settings.fingerSide) };
  return drawnCache.img;
}

function fingerThumb(cv) {
  const f = fingerImage();
  const dpr = Math.min(devicePixelRatio || 1, 2), W = 120, H = 54;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  // lying sideways, tip to the right
  const s = (H * 0.62) / f.w;
  ctx.save();
  ctx.translate(W - 6, H / 2);
  ctx.rotate(Math.PI / 2);
  ctx.scale(s, s);
  ctx.translate(-f.tip[0], -f.tip[1]);
  ctx.drawImage(f.canvas, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Screens / system helpers
// ---------------------------------------------------------------------------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

// Already chrome-free when launched from the home screen (manifest display: fullscreen /
// standalone). Calling requestFullscreen there anyway makes Android show its
// "swipe to exit full screen" toast, so we never do.
const isInstalled = () => ['fullscreen', 'standalone'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement) || isInstalled();
const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

function goFullscreen() {
  const el = document.documentElement;
  if (isFullscreen() || !canFullscreen()) return;
  try {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
    if (p && p.then) p.then(() => screen.orientation?.lock?.('portrait').catch(() => {})).catch(() => {});
  } catch {}
}

function updateFsButton() {
  $('#btn-fs').hidden = isFullscreen();
  if (isFullscreen()) $('#fs-hint').hidden = true;
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

// ---------------------------------------------------------------------------
// Menu background: slow drifting point field, quietly "techy"
// ---------------------------------------------------------------------------

function menuBackground() {
  const cv = $('#menu-bg'), ctx = cv.getContext('2d');
  const dots = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.01, vy: (Math.random() - 0.5) * 0.01 }));
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (!$('#menu').classList.contains('active')) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      d.x = (d.x + d.vx * dt + 1) % 1; d.y = (d.y + d.vy * dt + 1) % 1;
    }
    ctx.lineWidth = 0.6;
    for (let i = 0; i < dots.length; i++) {
      const a = dots[i];
      for (let j = i + 1; j < dots.length; j++) {
        const b = dots[j];
        const dx = (a.x - b.x) * W, dy = (a.y - b.y) * H, d = Math.hypot(dx, dy);
        if (d < 110) { ctx.strokeStyle = `rgba(94,232,255,${0.18 * (1 - d / 110)})`; ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke(); }
      }
      ctx.fillStyle = 'rgba(94,232,255,0.5)';
      ctx.fillRect(a.x * W - 1, a.y * H - 1, 2, 2);
    }
  };
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Camera + hand tracking
// ---------------------------------------------------------------------------

const cam = {
  stream: null, facing: 'environment', raf: 0, hands: [], lastVideoTime: -1, dz: 1, torch: false, torchWanted: false,
  landmarker: null, hud: null,
};

async function openCamera({ mode = 'scan' } = {}) {
  cam.mode = mode;
  showScreen('camera');
  goFullscreen(); // usually already full screen from the menu tap; no-op then
  keepAwake(true);
  const status = $('#cam-status');
  status.textContent = 'INITIALIZING';
  status.classList.remove('locked');
  if (!cam.hud) cam.hud = new Hud($('#hud'));
  cam.hud.resize();
  drawGuide();

  // model loads in parallel with the camera
  loadHandLandmarker().then((lm) => { cam.landmarker = lm; }).catch((e) => console.warn('hand tracking unavailable', e));

  try {
    // Get any front-camera permission prompt out of the way now, while a prompt
    // looks natural, instead of on the photo screen when wave detection starts.
    if (mode === 'scan' && settings.steps.some((st) => st.on === 'wave')) await warmFrontCamera();
    await startStream();
  } catch (e) {
    console.warn(e);
    status.textContent = 'NO CAMERA';
  }
  cancelAnimationFrame(cam.raf);
  let last = performance.now();
  const loop = (now) => {
    cam.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const v = $('#cam-video');
    let hands = cam.hands;
    if (cam.landmarker && v.readyState >= 2 && v.currentTime !== cam.lastVideoTime) {
      cam.lastVideoTime = v.currentTime;
      try {
        const res = cam.landmarker.detectForVideo(v, now);
        hands = mapHands(res, v);
      } catch (e) { /* skip frame */ }
    }
    cam.hands = hands;
    cam.hud.update(hands, dt);
    cam.hud.draw(now / 1000, settings.hud);
    if (cam.stream) {
      const locked = cam.hud.seen > 0.7;
      status.textContent = cam.note && now < cam.noteUntil ? cam.note
        : !cam.landmarker ? 'LOADING MODEL'
        : cam.mode === 'finger' ? (locked ? 'FINGER LOCKED' : hands.length ? 'TRACKING' : 'FINGER IN OUTLINE')
        : locked ? 'PALM LOCKED' : hands.length ? 'TRACKING' : 'SCANNING';
      status.classList.toggle('locked', locked);
      $('#btn-shutter').classList.toggle('locked', locked);
    }
  };
  cam.raf = requestAnimationFrame(loop);
}

// Framing guide: a dashed palm outline filling the screen roughly as the real
// palm will under a phone laid on it (finger bases near the top, heel near the
// bottom), plus where the screen finger will end up. In finger-capture mode, an
// upright finger outline instead.
function drawGuide() {
  const cv = $('#cam-guide'), ctx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!settings.guide) return;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 6]);
  ctx.lineJoin = ctx.lineCap = 'round';
  const glow = (color) => { ctx.strokeStyle = color; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; };
  const label = (t, x, y, align = 'center') => {
    ctx.save(); ctx.setLineDash([]); ctx.shadowBlur = 4; ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.font = '600 10px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(94,232,255,0.85)';
    ctx.textAlign = align; ctx.fillText(t, x, y); ctx.restore();
  };
  // a finger: capsule with its tip at T, pointing along unit d, width w, reaching back `len`
  const finger = (T, d, w, len) => {
    const n = [-d[1], d[0]], r = w / 2, a = Math.atan2(d[1], d[0]);
    const B = [T[0] - d[0] * len, T[1] - d[1] * len], C = [T[0] - d[0] * r, T[1] - d[1] * r];
    ctx.beginPath();
    ctx.moveTo(B[0] + n[0] * r, B[1] + n[1] * r);
    ctx.lineTo(C[0] + n[0] * r, C[1] + n[1] * r);
    ctx.arc(C[0], C[1], r, a + Math.PI / 2, a - Math.PI / 2, true);
    ctx.lineTo(B[0] - n[0] * r, B[1] - n[1] * r);
    ctx.stroke();
  };

  if (cam.mode === 'finger') {
    const w = W * 0.2;
    glow('rgba(94,232,255,0.75)');
    finger([W / 2, H * 0.24], [0, -1], w, H);
    label('INDEX FINGER · PALM SIDE', W / 2, H * 0.24 - 16);
    return;
  }

  // palm: wider than the screen at the sides, finger bases ~22% down, heel ~86%
  const m = Math.min(W, H);
  const top = H * 0.22, heel = H * 0.86;
  const L = W * 0.03, R = W * 0.97;
  glow('rgba(94,232,255,0.7)');
  ctx.beginPath();
  ctx.moveTo(L + W * 0.03, H + 4);                                      // wrist, left
  ctx.bezierCurveTo(L + W * 0.03, heel + H * 0.04, L - W * 0.01, heel, L, heel - H * 0.08);
  ctx.bezierCurveTo(L - W * 0.02, H * 0.6, L, H * 0.4, L + W * 0.04, top + H * 0.03);
  ctx.moveTo(R - W * 0.04, top + H * 0.03);
  ctx.bezierCurveTo(R, H * 0.4, R + W * 0.02, H * 0.6, R, heel - H * 0.08);
  ctx.bezierCurveTo(R + W * 0.01, heel, R - W * 0.03, heel + H * 0.04, R - W * 0.03, H + 4);
  ctx.stroke();
  // four fingers running off the top, joined by U-shaped webs
  const span = (R - L) - W * 0.08, fw = span / 4, x0 = L + W * 0.04;
  const base = [0.035, 0, 0.012, 0.06].map((v) => top + v * H);
  ctx.beginPath();
  ctx.moveTo(x0, top + H * 0.03);
  ctx.lineTo(x0 + fw * 0.04, -4);
  for (let i = 0; i < 3; i++) {
    const xr = x0 + fw * (i + 0.94), xl = x0 + fw * (i + 1.06);
    const wy = Math.max(base[i], base[i + 1]) + H * 0.012;
    ctx.moveTo(xr, -4);
    ctx.lineTo(xr, wy - fw * 0.1);
    ctx.quadraticCurveTo((xr + xl) / 2, wy + fw * 0.08, xl, wy - fw * 0.1);
    ctx.lineTo(xl, -4);
  }
  ctx.moveTo(x0 + fw * 3.96, -4);
  ctx.lineTo(R - W * 0.04, top + H * 0.03);
  ctx.stroke();
  // heel crease line hint
  ctx.beginPath();
  ctx.moveTo(L + W * 0.12, heel - H * 0.02);
  ctx.quadraticCurveTo(W / 2, heel + H * 0.02, R - W * 0.12, heel - H * 0.02);
  ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
  label('FINGERS', W / 2, top - 8);
  label('PALM', W / 2, H * 0.55);
  label('WRIST', W / 2, heel + H * 0.06);

  // where the screen finger will come in and stop
  if (usesFinger(settings)) {
    const p = fingerPath(W, H, settings.fingerEdge);
    const T = [p.E[0] + p.d[0] * p.far, p.E[1] + p.d[1] * p.far];
    glow('rgba(255,210,120,0.75)');
    ctx.setLineDash([4, 6]);
    finger(T, p.d, fingerWidth(W, H, settings.fingerSize), p.far + m);
    ctx.save(); ctx.setLineDash([]); ctx.shadowBlur = 4; ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.font = '600 10px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(255,210,120,0.9)';
    ctx.textAlign = 'center'; ctx.fillText('FINGER', T[0] + p.d[0] * -60, T[1] + p.d[1] * -60 - 4);
    ctx.restore();
  }
}

let frontWarmed = false;
async function warmFrontCamera() {
  try {
    const st = await navigator.permissions.query({ name: 'camera' });
    if (st.state === 'granted') return; // no prompt will appear later
  } catch {
    if (frontWarmed) return; // no Permissions API: do it once per launch
  }
  frontWarmed = true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    s.getTracks().forEach((t) => t.stop());
  } catch (e) { console.warn('front camera not granted; wave falls back to double-tap', e); }
}

async function startStream() {
  stopStream();
  const v = $('#cam-video');
  cam.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: cam.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  v.srcObject = cam.stream;
  cam.torch = false;
  await v.play().catch(() => {});
  await applyZoom();
  setupTorch();
}

// Zoom: use the camera's optical/hardware zoom where the browser exposes it,
// make up the rest with a centered digital crop (applied identically to the
// live view, the hand-tracking overlay and the captured photo).
async function applyZoom() {
  const want = cam.facing === 'user' ? 1 : settings.zoom;
  const track = cam.stream?.getVideoTracks()[0];
  let hw = 1;
  try {
    const caps = track?.getCapabilities?.() || {};
    if (caps.zoom) {
      hw = Math.max(caps.zoom.min, Math.min(caps.zoom.max, want));
      await track.applyConstraints({ advanced: [{ zoom: hw }] });
      hw = track.getSettings().zoom || hw;
    }
  } catch { hw = 1; }
  cam.dz = Math.max(1, want / hw);
  const v = $('#cam-video');
  v.style.transform = `scale(${cam.facing === 'user' ? -cam.dz : cam.dz}, ${cam.dz})`;
  $('#btn-zoom').textContent = `${(+settings.zoom).toFixed(1).replace('.0', '')}×`;
  $('#btn-zoom').hidden = cam.facing === 'user';
}

const ZOOM_STEPS = [1, 1.5, 2, 3];
function setZoom(z) {
  settings.zoom = Math.round(Math.max(1, Math.min(4, z)) * 10) / 10;
  save();
  applyZoom();
}

function setupTorch() {
  const track = cam.stream?.getVideoTracks()[0];
  let ok = false;
  try { ok = !!track?.getCapabilities?.().torch; } catch {}
  $('#btn-torch').hidden = !ok;
  $('#torch-spacer').hidden = ok;
  $('#btn-torch').classList.remove('on');
  if (ok && cam.torchWanted) setTorch(true);
}

async function setTorch(on) {
  const track = cam.stream?.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    cam.torch = on;
  } catch (e) { console.warn('torch', e); }
  $('#btn-torch').classList.toggle('on', cam.torch);
}

function stopStream() {
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null;
}

function closeCamera() {
  cancelAnimationFrame(cam.raf);
  stopStream();
  cam.hands = [];
}

// Map normalized landmarks (video space) into screen CSS px, honoring object-fit: cover.
function coverMap(v) {
  const W = innerWidth, H = innerHeight, vw = v.videoWidth || W, vh = v.videoHeight || H;
  const s = Math.max(W / vw, H / vh) * (cam.dz || 1);
  return { s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2, vw, vh, W, H };
}

function mapHands(res, v) {
  if (!res || !res.landmarks) return [];
  const m = coverMap(v);
  const mirror = cam.facing === 'user';
  return res.landmarks.map((lms, i) => {
    const pts = lms.map((p) => {
      let x = p.x * m.vw * m.s + m.ox;
      if (mirror) x = m.W - x;
      return [x, p.y * m.vh * m.s + m.oy, p.z];
    });
    const hd = res.handedness?.[i]?.[0] || res.handednesses?.[i]?.[0];
    return { pts, label: hd?.categoryName, score: hd?.score };
  });
}

let hasPhoto = false;

// Draw the visible (cover-cropped) part of a source into the stage photo canvas.
function drawCover(src, sw, sh, mirror = false, zoom = 1) {
  hasPhoto = true;
  const photo = $('#photo');
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  photo.width = Math.round(W * dpr); photo.height = Math.round(H * dpr);
  const ctx = photo.getContext('2d');
  const s = Math.max(W / sw, H / sh) * zoom;
  const cw = W / s, ch = H / s;
  ctx.save();
  if (mirror) { ctx.translate(photo.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, photo.width, photo.height);
  ctx.restore();
}

// The current camera view exactly as on screen (cover crop, zoom, mirror), at device resolution.
function screenFrame(v) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  const s = Math.max(W / v.videoWidth, H / v.videoHeight) * (cam.dz || 1);
  const cw = W / s, ch = H / s;
  if (cam.facing === 'user') { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(v, (v.videoWidth - cw) / 2, (v.videoHeight - ch) / 2, cw, ch, 0, 0, cv.width, cv.height);
  return { cv, dpr };
}

function captureFinger(v) {
  const hand = cam.hud?.smooth?.[0];
  if (!hand) { cam.note = 'NO HAND FOUND'; cam.noteUntil = performance.now() + 1500; return; }
  const { cv, dpr } = screenFrame(v);
  const url = cutFinger(cv, hand.pts.map((p) => [p[0] * dpr, p[1] * dpr]));
  if (!url) return;
  try { localStorage.setItem('doris.finger', url); } catch {}
  closeCamera(); keepAwake(false); showScreen('menu');
  capturedFinger(url).then((f) => { myFinger = f; openSettings(); });
}

function capture() {
  const v = $('#cam-video');
  if (!cam.stream || v.readyState < 2) return;
  if (cam.mode === 'finger') { captureFinger(v); return; }
  drawCover(v, v.videoWidth, v.videoHeight, cam.facing === 'user', cam.dz || 1);
  const hand = cam.hud?.smooth?.[0];
  const palm = hand ? palmCenter(hand.pts) : null;
  const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  setTimeout(() => { closeCamera(); enterStage({ palm }); }, 180);
}

function loadFile(file) {
  const img = new Image();
  img.onload = () => {
    drawCover(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(img.src);
    closeCamera();
    enterStage({ palm: null });
  };
  img.src = URL.createObjectURL(file);
}

// ---------------------------------------------------------------------------
// Stage: the trick itself
// ---------------------------------------------------------------------------

let show = null;
const wave = new WaveDetector(() => trigger('wave'));
// idx: the step waiting to start next
const stage = { idx: 0, busy: false, palm: null, timer: 0, preview: false, active: false };

function fingerOpts(mode) {
  return {
    image: fingerImage(), size: settings.fingerSize, mode,
    from: settings.fingerEdge, cue: settings.fingerCue, slide: settings.fingerSlide,
  };
}

async function enterStage({ palm, preview = false }) {
  showScreen('stage');
  keepAwake(true);
  if (!show) show = new Show($('#fx'));
  show.resize();
  show.setPhoto($('#photo'));
  clearTimeout(stage.timer);
  Object.assign(stage, { idx: 0, busy: false, palm, preview, active: true, token: (stage.token || 0) + 1 });
  armStep();
}

// Wait for the next step's start signal.
async function armStep() {
  clearTimeout(stage.timer);
  const st = settings.steps[stage.idx];
  if (!st) { wave.stop(); if (stage.preview) stage.timer = setTimeout(() => exitStage(true), 600); return; }
  if (stage.preview || st.on === 'time') {
    stage.timer = setTimeout(() => runStep(0), (stage.preview ? 0.5 : st.t) * 1000);
    wave.stop();
  } else if (st.on === 'wave') {
    const token = stage.token;
    try { await wave.start(settings.sensitivity); }
    catch (e) { console.warn('front camera unavailable, double-tap to trigger', e); }
    if (token !== stage.token || !stage.active || stage.busy) wave.stop();
  } else wave.stop();
}

/** A user signal: 'wave' | 'tap1' | 'tap2' | 'tap3'. */
function trigger(kind) {
  if (!stage.active || stage.busy || stage.preview) return;
  const st = settings.steps[stage.idx];
  if (!st) return;
  const ok = st.on === 'wave' ? kind === 'wave' || kind === 'tap2'
    : st.on === 'tap' ? kind === 'tap1'
    : st.on === 'tap2' ? kind === 'tap2'
    : st.on === 'tap3' ? kind === 'tap3' : false;
  if (ok) runStep(settings.delay);
}

function runStep(delay) {
  const st = settings.steps[stage.idx];
  if (!stage.active || stage.busy || !st) return;
  stage.busy = true;
  wave.stop();
  const token = stage.token;
  stage.timer = setTimeout(async () => {
    if (st.what === 'finger') await show.playFinger(fingerOpts('after'));
    else {
      await show.play({
        type: st.what,
        size: settings.size,
        speed: settings.speed,
        side: settings.side,
        palm: stage.palm,
        haptics: settings.haptics,
        finger: settings.fingerScratch === 'off' ? null : fingerOpts(settings.fingerScratch),
      });
    }
    if (token !== stage.token || !stage.active) return; // superseded or exited
    stage.busy = false;
    stage.idx++;
    armStep();
  }, delay * 1000);
}

function exitStage(toSettings = false) {
  stage.active = false;
  stage.token = (stage.token || 0) + 1;
  clearTimeout(stage.timer);
  wave.stop();
  show?.stop();
  keepAwake(false);
  showScreen('menu');
  if (toSettings) openSettings();
}

// Stage gestures: 5 quick taps or a long-press = exit; 1/2/3 quick taps are step
// signals (2 taps also back up a wave).
function stageGestures() {
  const el = $('#stage');
  let pressT = 0, downAt = 0, lastTap = 0, taps = 0, moved = false, sx = 0, sy = 0;
  el.addEventListener('pointerdown', (e) => {
    downAt = performance.now(); moved = false; sx = e.clientX; sy = e.clientY;
    clearTimeout(pressT);
    pressT = setTimeout(() => { pressT = 0; exitStage(stage.preview); }, 900);
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 20) { moved = true; clearTimeout(pressT); }
  });
  const up = () => {
    if (!pressT) return; // long-press already handled
    clearTimeout(pressT); pressT = 0;
    if (moved || performance.now() - downAt > 400) return;
    const now = performance.now();
    taps = now - lastTap < 400 ? taps + 1 : 1;
    lastTap = now;
    if (taps >= 5) { taps = 0; exitStage(stage.preview); return; }
    if (settings.fingerScratch === 'tap' && show?.scratch()) return;
    if (show?.scratching) return;
    if (taps <= 3) trigger('tap' + taps);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => { clearTimeout(pressT); pressT = 0; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Preview from settings: last photo if there is one, else a generated skin backdrop.
function preview() {
  closeSettings();
  if (!hasPhoto) demoBackdrop();
  enterStage({ palm: null, preview: true });
}

function demoBackdrop() {
  const photo = $('#photo');
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  photo.width = Math.round(W * dpr); photo.height = Math.round(H * dpr);
  const ctx = photo.getContext('2d');
  ctx.scale(dpr, dpr);
  const g = ctx.createRadialGradient(W * 0.5, H * 0.5, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
  g.addColorStop(0, '#e2bba0'); g.addColorStop(0.6, '#cfa184'); g.addColorStop(1, '#9a6e55');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // palm creases
  ctx.strokeStyle = 'rgba(120, 70, 50, 0.35)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  const crease = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0] * W, pts[1] * H); ctx.bezierCurveTo(pts[2] * W, pts[3] * H, pts[4] * W, pts[5] * H, pts[6] * W, pts[7] * H); ctx.stroke(); };
  crease([0.05, 0.42, 0.3, 0.38, 0.6, 0.36, 0.95, 0.3]);
  crease([0.05, 0.5, 0.3, 0.5, 0.5, 0.56, 0.75, 0.62]);
  crease([0.2, 0.42, 0.25, 0.6, 0.3, 0.75, 0.45, 0.95]);
  // skin texture
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,235,220' : '120,70,50'},${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------

$('#btn-scan').addEventListener('click', openCamera);
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-settings-close').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
$('#btn-preview').addEventListener('click', preview);
$('#btn-cam-back').addEventListener('click', () => { closeCamera(); keepAwake(false); showScreen('menu'); });
$('#btn-shutter').addEventListener('click', capture);
$('#btn-torch').addEventListener('click', () => { cam.torchWanted = !cam.torch; setTorch(cam.torchWanted); });
$('#btn-zoom').addEventListener('click', () => {
  const i = ZOOM_STEPS.findIndex((z) => z > settings.zoom + 0.05);
  setZoom(ZOOM_STEPS[i < 0 ? 0 : i]);
});
cameraPinch();

// Pinch on the live view to zoom (remembered for next time).
function cameraPinch() {
  const el = $('#hud'), pts = new Map();
  let d0 = 0, z0 = 1;
  el.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); z0 = settings.zoom; } });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e);
    if (pts.size === 2 && d0 > 0) { const [a, b] = [...pts.values()]; setZoom(z0 * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / d0); }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// Full screen: any tap on the menu goes full screen (needs a user gesture), the
// corner button is the explicit way. iPhone Safari can't do it at all outside an
// installed home-screen app, so there the button explains that instead.
$('#menu').addEventListener('pointerup', (e) => { if (!e.target.closest('#btn-fs')) goFullscreen(); });
$('#btn-fs').addEventListener('click', () => {
  if (canFullscreen()) goFullscreen();
  else $('#fs-hint').hidden = !$('#fs-hint').hidden;
});
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, updateFsButton));
updateFsButton();
$('#btn-flip').addEventListener('click', async () => {
  cam.facing = cam.facing === 'environment' ? 'user' : 'environment';
  try { await startStream(); } catch (e) { console.warn(e); }
});
$('#file-input').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; });
stageGestures();
menuBackground();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if ($('#camera').classList.contains('active')) stopStream();
  } else {
    if ($('#camera').classList.contains('active') && !cam.stream) startStream().catch(() => {});
    if (stage.active || $('#camera').classList.contains('active')) keepAwake(true);
  }
});

window.addEventListener('resize', () => { cam.hud?.resize(); if ($('#camera').classList.contains('active')) drawGuide(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Warm up the hand model in the background so the scan screen feels instant.
setTimeout(() => loadHandLandmarker().catch(() => {}), 1500);
