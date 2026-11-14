import { Show, drawThumb } from './stage.js';
import { Hud, loadHandLandmarker, palmCenter } from './handtrack.js';
import { WaveDetector } from './wave.js';
import { CREATURES } from './creatures.js';

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const DEFAULTS = {
  creature: 'cockroach',
  trigger: 'wave',
  sensitivity: 0.55,
  timer: 6,
  delay: 0.4,
  side: 'random',
  size: 1,
  speed: 1,
  appearances: 1,
  haptics: true,
  hud: true,
};

let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('doris.settings') || '{}') }; } catch {}
const save = () => { try { localStorage.setItem('doris.settings', JSON.stringify(settings)); } catch {} };

const pct = (v) => `${Math.round(v * 100)}%`;
const SCHEMA = [
  { key: 'creature', label: 'Creature', type: 'creature' },
  { key: 'trigger', label: 'Trigger', type: 'seg', options: [['wave', 'Wave'], ['tap', 'Tap'], ['timer', 'Timer']],
    note: (s) => ({
      wave: 'Front camera watches for a hand passing over the phone. Arms once the phone has been lying still ~1 s. Double-tap also works as a backup.',
      tap: 'Tap anywhere on the photo.',
      timer: 'Appears automatically after the set time.',
    })[s.trigger] },
  { key: 'sensitivity', label: 'Wave sensitivity', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, show: (s) => s.trigger === 'wave' },
  { key: 'timer', label: 'Timer', type: 'range', min: 2, max: 20, step: 1, fmt: (v) => `${v} s`, show: (s) => s.trigger === 'timer' },
  { key: 'delay', label: 'Delay after trigger', type: 'range', min: 0, max: 2, step: 0.1, fmt: (v) => `${(+v).toFixed(1)} s` },
  { key: 'appearances', label: 'Appearances per photo', type: 'seg', options: [[1, '1'], [2, '2'], [3, '3']] },
  { key: 'side', label: 'Enters from', type: 'seg', options: [['random', 'Any'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']] },
  { key: 'size', label: 'Size', type: 'range', min: 0.5, max: 1.6, step: 0.05, fmt: pct },
  { key: 'speed', label: 'Speed', type: 'range', min: 0.4, max: 2, step: 0.05, fmt: pct },
  { key: 'haptics', label: 'Footstep vibration', type: 'toggle' },
  { key: 'hud', label: 'Hand-tracking overlay', type: 'toggle' },
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

    if (f.type === 'creature') {
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
        b.onclick = () => { settings[f.key] = v; save(); refresh(); };
        seg.appendChild(b);
      }
      row.appendChild(seg);
    } else if (f.type === 'range') {
      const r = document.createElement('input');
      r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.value = settings[f.key];
      val.textContent = f.fmt(settings[f.key]);
      r.oninput = () => { settings[f.key] = +r.value; val.textContent = f.fmt(+r.value); save(); };
      row.appendChild(r);
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
    }
  }
}

function openSettings() { buildSettings(); $('#settings').classList.add('open'); $('#settings').setAttribute('aria-hidden', 'false'); }
function closeSettings() { $('#settings').classList.remove('open'); $('#settings').setAttribute('aria-hidden', 'true'); }

// ---------------------------------------------------------------------------
// Screens / system helpers
// ---------------------------------------------------------------------------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
    if (p && p.then) p.then(() => screen.orientation?.lock?.('portrait').catch(() => {})).catch(() => {});
  } catch {}
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
  stream: null, facing: 'environment', raf: 0, hands: [], lastVideoTime: -1,
  landmarker: null, hud: null,
};

async function openCamera() {
  showScreen('camera');
  goFullscreen();
  keepAwake(true);
  const status = $('#cam-status');
  status.textContent = 'INITIALIZING';
  status.classList.remove('locked');
  if (!cam.hud) cam.hud = new Hud($('#hud'));
  cam.hud.resize();

  // model loads in parallel with the camera
  loadHandLandmarker().then((lm) => { cam.landmarker = lm; }).catch((e) => console.warn('hand tracking unavailable', e));

  try {
    // Get any front-camera permission prompt out of the way now, while a prompt
    // looks natural, instead of on the photo screen when wave detection starts.
    if (settings.trigger === 'wave') await warmFrontCamera();
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
      status.textContent = !cam.landmarker ? 'LOADING MODEL' : locked ? 'PALM LOCKED' : hands.length ? 'TRACKING' : 'SCANNING';
      status.classList.toggle('locked', locked);
      $('#btn-shutter').classList.toggle('locked', locked);
    }
  };
  cam.raf = requestAnimationFrame(loop);
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
  const mirror = cam.facing === 'user';
  v.classList.toggle('mirror', mirror);
  $('#hud').classList.remove('mirror');
  await v.play().catch(() => {});
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
  const s = Math.max(W / vw, H / vh);
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
function drawCover(src, sw, sh, mirror = false) {
  hasPhoto = true;
  const photo = $('#photo');
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  photo.width = Math.round(W * dpr); photo.height = Math.round(H * dpr);
  const ctx = photo.getContext('2d');
  const s = Math.max(W / sw, H / sh);
  const cw = W / s, ch = H / s;
  ctx.save();
  if (mirror) { ctx.translate(photo.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, photo.width, photo.height);
  ctx.restore();
}

function capture() {
  const v = $('#cam-video');
  if (!cam.stream || v.readyState < 2) return;
  drawCover(v, v.videoWidth, v.videoHeight, cam.facing === 'user');
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
const wave = new WaveDetector(() => fire());
const stage = { runs: 0, busy: false, palm: null, timer: 0, preview: false, active: false };

async function enterStage({ palm, preview = false }) {
  showScreen('stage');
  goFullscreen();
  keepAwake(true);
  if (!show) show = new Show($('#fx'));
  show.resize();
  show.setPhoto($('#photo'));
  Object.assign(stage, { runs: 0, busy: false, palm, preview, active: true, token: (stage.token || 0) + 1 });
  clearTimeout(stage.timer);

  if (preview) {
    stage.timer = setTimeout(fire, 500);
    return;
  }
  if (settings.trigger === 'timer') {
    stage.timer = setTimeout(fire, settings.timer * 1000);
  } else if (settings.trigger === 'wave') {
    try { await wave.start(settings.sensitivity); }
    catch (e) { console.warn('front camera unavailable, tap to trigger', e); }
  }
}

function fire() {
  if (!stage.active || stage.busy || stage.runs >= settings.appearances) return;
  stage.busy = true;
  stage.runs++;
  const token = stage.token;
  stage.timer = setTimeout(async () => {
    await show.play({
      type: settings.creature,
      size: settings.size,
      speed: settings.speed,
      side: settings.side,
      palm: stage.palm,
      haptics: settings.haptics,
    });
    if (token !== stage.token || !stage.active) return; // superseded or exited
    stage.busy = false;
    if (stage.preview) { exitStage(true); return; }
    if (stage.runs >= settings.appearances) wave.stop(); // the creature "won't come back"
    else if (settings.trigger === 'timer') stage.timer = setTimeout(fire, settings.timer * 1000);
  }, stage.preview ? 0 : settings.delay * 1000);
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

// Stage gestures: long-press = exit, tap = trigger (tap mode), double-tap = backup trigger.
function stageGestures() {
  const el = $('#stage');
  let pressT = 0, downAt = 0, lastTap = 0, moved = false, sx = 0, sy = 0;
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
    if (settings.trigger === 'tap') fire();
    else if (now - lastTap < 350) fire();
    lastTap = now;
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

window.addEventListener('resize', () => { cam.hud?.resize(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Warm up the hand model in the background so the scan screen feels instant.
setTimeout(() => loadHandLandmarker().catch(() => {}), 1500);
