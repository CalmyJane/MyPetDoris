// Hand tracking (MediaPipe Hand Landmarker) + a techy skeleton HUD.
// Purely cosmetic during the scan step, plus it tells us where the palm is,
// so the creature can walk right across it.

const VISION_VER = '0.10.14';
const VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VER}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let loading = null;

export function loadHandLandmarker() {
  if (!loading) {
    loading = (async () => {
      const vision = await import(/* @vite-ignore */ `${VISION_URL}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
      const make = (delegate) => vision.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try { return await make('GPU'); } catch { return await make('CPU'); }
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];
const PALM = [0, 1, 5, 9, 13, 17];

export function palmCenter(pts) {
  let x = 0, y = 0;
  for (const i of [0, 5, 9, 13, 17]) { x += pts[i][0]; y += pts[i][1]; }
  return { x: x / 5, y: y / 5 };
}

export class Hud {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.smooth = [];
    this.seen = 0;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
  }

  /** hands: [{ pts: [[x,y,z]...21] in CSS px, label, score }] */
  update(hands, dt) {
    // temporal smoothing so the skeleton glides instead of jittering
    const out = [];
    hands.forEach((h, k) => {
      const prev = this.smooth[k];
      const a = prev ? 0.55 : 1;
      const pts = h.pts.map((p, i) => prev ? [prev.pts[i][0] + (p[0] - prev.pts[i][0]) * a, prev.pts[i][1] + (p[1] - prev.pts[i][1]) * a, p[2]] : p);
      out.push({ ...h, pts });
    });
    this.smooth = out;
    this.seen = hands.length ? this.seen + dt : 0;
    return out;
  }

  draw(t, enabled = true) {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!enabled) return;

    // frame corners
    ctx.strokeStyle = 'rgba(94,232,255,0.55)';
    ctx.lineWidth = 2;
    const m = 18, s = 26;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + dy * s); ctx.lineTo(x, y); ctx.lineTo(x + dx * s, y); ctx.stroke();
    }

    if (!this.smooth.length) {
      // idle reticle
      const cx = W / 2, cy = H * 0.48, r = Math.min(W, H) * 0.28;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.4);
      ctx.strokeStyle = 'rgba(94,232,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 14]);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(-t * 0.9);
      ctx.strokeStyle = 'rgba(94,232,255,0.6)';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, 0.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, Math.PI, Math.PI + 0.6); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = `rgba(94,232,255,${0.45 + 0.35 * Math.sin(t * 4)})`;
      ctx.font = '500 11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ALIGN PALM', cx, cy + r + 28);
      ctx.textAlign = 'left';
      return;
    }

    for (const h of this.smooth) this._drawHand(ctx, h, t);
  }

  _drawHand(ctx, h, t) {
    const p = h.pts;
    const lock = this.seen > 0.7;
    const col = lock ? '141,255,181' : '94,232,255';

    // bounding box
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = 22; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const bw = x1 - x0, bh = y1 - y0, cl = Math.min(bw, bh) * 0.12;

    // palm fill
    ctx.fillStyle = `rgba(${col},0.07)`;
    ctx.beginPath();
    PALM.forEach((i, k) => (k ? ctx.lineTo(p[i][0], p[i][1]) : ctx.moveTo(p[i][0], p[i][1])));
    ctx.closePath(); ctx.fill();

    // scan sweep
    const sy = y0 + ((t * 0.6) % 1) * bh;
    const g = ctx.createLinearGradient(0, sy - 30, 0, sy);
    g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.22)`);
    ctx.fillStyle = g; ctx.fillRect(x0, sy - 30, bw, 30);
    ctx.fillStyle = `rgba(${col},0.7)`; ctx.fillRect(x0, sy, bw, 1);

    // bones with glow
    ctx.save();
    ctx.shadowColor = `rgba(${col},0.9)`;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(${col},0.9)`;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) { ctx.moveTo(p[a][0], p[a][1]); ctx.lineTo(p[b][0], p[b][1]); }
    ctx.stroke();
    ctx.restore();

    // joints
    for (let i = 0; i < 21; i++) {
      const [x, y, z] = p[i];
      const r = 3.2 - clampN(z * 20, -1.2, 1.2);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
    }
    // fingertip rings
    for (const i of TIPS) {
      const [x, y] = p[i];
      const pr = 9 + 3 * Math.sin(t * 5 + i);
      ctx.strokeStyle = `rgba(${col},0.55)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, pr, t * 2 + i, t * 2 + i + 4.2); ctx.stroke();
    }

    // corner brackets
    ctx.strokeStyle = `rgba(${col},0.85)`; ctx.lineWidth = 2;
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + dy * cl); ctx.lineTo(x, y); ctx.lineTo(x + dx * cl, y); ctx.stroke();
    }

    // readouts
    ctx.font = '500 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = `rgba(${col},0.95)`;
    const side = (h.label || '').toUpperCase().startsWith('L') ? 'L' : 'R';
    ctx.fillText(`HAND ${side}  ${(h.score || 0.97).toFixed(2)}`, x0, y0 - 18);
    ctx.fillStyle = `rgba(${col},0.6)`;
    ctx.fillText(`LMK 21 · ${lock ? 'LOCKED' : 'TRACKING'}`, x0, y0 - 6);
    const wx = p[0][0], wy = p[0][1];
    ctx.fillText(`${wx.toFixed(0).padStart(4, '0')},${wy.toFixed(0).padStart(4, '0')}`, x1 - 64, y1 + 14);
  }
}

function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
