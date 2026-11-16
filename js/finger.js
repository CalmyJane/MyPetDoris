// The on-screen finger that slides in and scratches the creature's back.
// The performer slides their real finger in under the phone's bottom edge at
// the same moment, so the screen finger reads as a continuation of it.
//
// A finger image always points UP (tip at the top). Sources:
//  - photo (default): a real index finger, palm or nail side, cut from
//    "Human-Hands-Front-Back.jpg" by Evan-Amos (Wikimedia Commons, CC BY-SA 3.0)
//    with tools/cut_finger.py; skin tone is adjusted with a multiply tint
//  - drawn: fallback if the photo can't load
//  - captured: a cut-out of the performer's own index finger, made from a
//    camera frame using the hand-tracking landmarks.

import { clamp, lerp } from './creatures.js';

const LIGHT_SKIN = [241, 200, 170];
const DARK_SKIN = [96, 60, 42];

function skin(tone, k = 1) {
  const c = LIGHT_SKIN.map((v, i) => lerp(v, DARK_SKIN[i], tone) * k);
  return (a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

// {w: finger width px, tip: [x,y], stretch: rows of plain skin the finger can be
// lengthened in} for assets/finger_<side>.webp (printed by tools/cut_finger.py)
const PHOTO = {
  pad: { w: 157.5, tip: [109, 10], stretch: [455, 520] },
  nail: { w: 150, tip: [105, 10], stretch: [310, 425] },
};
const photoCache = {};

/** Real finger photo, tinted toward the chosen skin tone. Resolves null on failure. */
export function photoFinger(side = 'pad', tone = 0.2) {
  const m = PHOTO[side] || PHOTO.pad;
  photoCache[side] ||= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `assets/finger_${side}.webp`;
  });
  return photoCache[side].then((img) => {
    if (!img) return null;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    // the photo is light skin (about tone 0.2); darker tones multiply in a brown
    const k = clamp((tone - 0.2) / 0.8, 0, 1);
    if (k > 0) {
      const c = [255, 255, 255].map((v, i) => lerp(v, [128, 84, 60][i], k));
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(img, 0, 0);
    } else if (tone < 0.2) {
      const a = (0.2 - tone) / 0.2 * 0.25;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,240,230,${a})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    return { canvas: cv, ...m };
  });
}

/** Drawn finger: returns { canvas, w (finger width px), tip:[x,y] }.
 *  side: 'pad' (palm side up, what you see when the finger slides in palm-up)
 *  or 'nail' (back of the finger). */
export function drawnFinger(tone = 0.25, w = 160, side = 'pad') {
  if (side === 'pad') return padFinger(tone, w);
  const len = w * 6;
  const pad = w * 0.12;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w + pad * 2); cv.height = Math.round(len + pad);
  const ctx = cv.getContext('2d');
  const cx = cv.width / 2, top = pad;
  const r = w / 2;

  // outline: rounded tip, very slight widening toward the knuckle
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.93, top + r);
    ctx.arc(cx, top + r, r * 0.93, Math.PI, 0);
    ctx.bezierCurveTo(cx + r * 0.95, top + w * 2, cx + r * 1.02, top + w * 3.5, cx + r * 1.04, top + len);
    ctx.lineTo(cx - r * 1.04, top + len);
    ctx.bezierCurveTo(cx - r * 1.02, top + w * 3.5, cx - r * 0.95, top + w * 2, cx - r * 0.93, top + r);
    ctx.closePath();
  };

  // cylindrical shading across the finger
  const s = skin(tone);
  const sd = skin(tone, 0.62);
  const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  g.addColorStop(0, sd(1));
  g.addColorStop(0.18, s(1));
  g.addColorStop(0.42, skin(tone, 1.07)(1));
  g.addColorStop(0.75, s(1));
  g.addColorStop(1, sd(1));
  outline();
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  outline();
  ctx.clip();
  // the tip is a bit pinker / rounder in light
  const tg = ctx.createRadialGradient(cx - r * 0.2, top + r * 0.8, 1, cx, top + r, w * 1.2);
  tg.addColorStop(0, 'rgba(255,170,150,0.20)');
  tg.addColorStop(1, 'rgba(255,170,150,0)');
  ctx.fillStyle = tg; ctx.fillRect(0, 0, cv.width, w * 2.2);
  // knuckle creases (distal and middle joints)
  ctx.lineCap = 'round';
  for (const [y, n] of [[top + w * 1.75, 3], [top + w * 3.55, 4]]) {
    for (let i = 0; i < n; i++) {
      ctx.strokeStyle = sd(0.35 - i * 0.05);
      ctx.lineWidth = w * 0.022;
      ctx.beginPath();
      const yy = y + (i - n / 2) * w * 0.07;
      ctx.moveTo(cx - r * 0.7, yy + w * 0.03);
      ctx.quadraticCurveTo(cx, yy - w * 0.06, cx + r * 0.7, yy + w * 0.03);
      ctx.stroke();
    }
    // soft bulge highlight above the joint
    const kg = ctx.createRadialGradient(cx - r * 0.15, y - w * 0.25, 1, cx, y - w * 0.25, w * 0.6);
    kg.addColorStop(0, 'rgba(255,255,255,0.07)'); kg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = kg; ctx.fillRect(0, y - w, cv.width, w * 1.2);
  }
  // skin texture
  for (let i = 0; i < w * 8; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,240,230,0.05)' : sd(0.05);
    ctx.fillRect(Math.random() * cv.width, Math.random() * cv.height, 1.5, 1.5);
  }
  ctx.restore();

  // nail: seen from the back of the finger
  const nw = w * 0.62, nl = w * 0.78, ny = top + w * 0.1;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - nw / 2, ny + nl);
  ctx.lineTo(cx - nw / 2, ny + nw * 0.4);
  ctx.quadraticCurveTo(cx - nw / 2, ny, cx, ny);
  ctx.quadraticCurveTo(cx + nw / 2, ny, cx + nw / 2, ny + nw * 0.4);
  ctx.lineTo(cx + nw / 2, ny + nl);
  ctx.quadraticCurveTo(cx, ny + nl + w * 0.12, cx - nw / 2, ny + nl);
  ctx.closePath();
  const ng = ctx.createLinearGradient(cx - nw / 2, 0, cx + nw / 2, 0);
  ng.addColorStop(0, skin(tone * 0.6, 0.9)(1));
  ng.addColorStop(0.4, `rgba(250,215,205,1)`);
  ng.addColorStop(1, skin(tone * 0.6, 0.85)(1));
  ctx.fillStyle = ng;
  ctx.fill();
  ctx.strokeStyle = sd(0.45); ctx.lineWidth = w * 0.02; ctx.stroke();
  ctx.clip();
  // free edge (white tip) and cuticle
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.fillRect(cx - nw, ny - 1, nw * 2, w * 0.1);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(cx - nw * 0.12, ny + nl * 0.45, nw * 0.1, nl * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  return { canvas: cv, w, tip: [cx, top] };
}

// Palm side of the finger: no nail, a lighter, pinker fleshy pad at the tip,
// paired flexion creases at the joints and a faint fingerprint whorl.
function padFinger(tone, w) {
  const len = w * 6;
  const pad = w * 0.12;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w + pad * 2); cv.height = Math.round(len + pad);
  const ctx = cv.getContext('2d');
  const cx = cv.width / 2, top = pad, r = w / 2;
  // palm-side skin is lighter and pinker than the back of the hand
  const base = LIGHT_SKIN.map((v, i) => lerp(v, DARK_SKIN[i], tone * 0.75));
  const pink = [236, 160, 150];
  const col = (k = 1, p = 0, a = 1) => {
    const c = base.map((v, i) => lerp(v, pink[i] * (0.55 + 0.45 * (1 - tone)), p) * k);
    return `rgba(${clamp(c[0], 0, 255) | 0},${clamp(c[1], 0, 255) | 0},${clamp(c[2], 0, 255) | 0},${a})`;
  };

  // outline: fleshy, slightly bulbous pad, narrowing a touch at the distal joint
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.9, top + r * 0.95);
    ctx.bezierCurveTo(cx - r * 0.9, top + r * 0.2, cx - r * 0.45, top, cx, top);
    ctx.bezierCurveTo(cx + r * 0.45, top, cx + r * 0.9, top + r * 0.2, cx + r * 0.9, top + r * 0.95);
    ctx.bezierCurveTo(cx + r * 0.98, top + w * 1.2, cx + r * 0.9, top + w * 1.6, cx + r * 0.92, top + w * 1.85);
    ctx.bezierCurveTo(cx + r * 0.98, top + w * 2.6, cx + r * 0.96, top + w * 3.3, cx + r * 0.97, top + w * 3.6);
    ctx.bezierCurveTo(cx + r * 1.03, top + w * 4.4, cx + r * 1.05, top + w * 5, cx + r * 1.06, top + len);
    ctx.lineTo(cx - r * 1.06, top + len);
    ctx.bezierCurveTo(cx - r * 1.05, top + w * 5, cx - r * 1.03, top + w * 4.4, cx - r * 0.97, top + w * 3.6);
    ctx.bezierCurveTo(cx - r * 0.96, top + w * 3.3, cx - r * 0.98, top + w * 2.6, cx - r * 0.92, top + w * 1.85);
    ctx.bezierCurveTo(cx - r * 0.9, top + w * 1.6, cx - r * 0.98, top + w * 1.2, cx - r * 0.9, top + r * 0.95);
    ctx.closePath();
  };

  const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  g.addColorStop(0, col(0.62, 0.55));
  g.addColorStop(0.16, col(0.92, 0.38));
  g.addColorStop(0.45, col(1.06, 0.26));
  g.addColorStop(0.8, col(0.95, 0.32));
  g.addColorStop(1, col(0.64, 0.55));
  outline();
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  outline();
  ctx.clip();
  // fleshy pads: each phalanx bulges, so it's lighter in its middle
  for (const [y0, y1, a] of [[0, 1.85, 0.16], [1.85, 3.6, 0.1], [3.6, 6, 0.08]]) {
    const yc = top + w * (y0 + y1) / 2;
    const pg = ctx.createRadialGradient(cx - r * 0.12, yc - w * 0.1, 1, cx, yc, w * (y1 - y0) * 0.6);
    pg.addColorStop(0, `rgba(255,236,226,${a})`);
    pg.addColorStop(1, 'rgba(255,236,226,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(0, top + w * y0 - w * 0.2, cv.width, w * (y1 - y0) + w * 0.4);
  }
  // pinker tip
  const tg = ctx.createRadialGradient(cx, top + r * 0.9, 1, cx, top + r * 0.9, w * 0.95);
  tg.addColorStop(0, col(1, 0.6, 0.35));
  tg.addColorStop(1, col(1, 0.6, 0));
  ctx.fillStyle = tg; ctx.fillRect(0, 0, cv.width, w * 2);
  // faint fingerprint whorl
  ctx.lineWidth = Math.max(0.6, w * 0.008);
  for (let i = 1; i < 16; i++) {
    ctx.strokeStyle = col(0.7, 0.3, 0.06);
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.02, top + w * 0.72, w * 0.028 * i, w * 0.036 * i, 0.08, Math.PI * 0.95, Math.PI * 2.05);
    ctx.stroke();
  }
  // flexion creases: paired lines at the distal joint, a double/triple at the middle
  ctx.lineCap = 'round';
  const crease = (y, a, bend) => {
    ctx.strokeStyle = col(0.5, 0.5, a * 0.8);
    ctx.lineWidth = w * (0.014 + Math.random() * 0.012);
    // slightly wavy, broken line: real creases aren't ruled
    const x0 = cx - r * (0.6 + Math.random() * 0.3), x1 = cx + r * (0.6 + Math.random() * 0.3);
    ctx.beginPath();
    for (let k = 0; k <= 12; k++) {
      const u = k / 12, x = lerp(x0, x1, u);
      const yy = y + bend * (1 - 4 * (u - 0.5) ** 2 * -1) * (1 - 2 * Math.abs(u - 0.5)) + (Math.random() - 0.5) * w * 0.015;
      if (k === 0 || Math.random() < 0.08) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    // soft highlight just below each crease (skin folds catch light)
    ctx.strokeStyle = 'rgba(255,240,232,0.12)';
    ctx.lineWidth = w * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.75, y + bend + w * 0.04);
    ctx.quadraticCurveTo(cx, y - bend * 0.6 + w * 0.04, cx + r * 0.75, y + bend + w * 0.04);
    ctx.stroke();
  };
  crease(top + w * 1.8, 0.5, w * 0.03);
  crease(top + w * 1.9, 0.38, w * 0.02);
  crease(top + w * 3.52, 0.5, -w * 0.02);
  crease(top + w * 3.64, 0.42, -w * 0.01);
  crease(top + w * 3.76, 0.25, w * 0.01);
  // fine skin texture
  for (let i = 0; i < w * 10; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,240,232,0.05)' : col(0.6, 0.3, 0.05);
    ctx.fillRect(Math.random() * cv.width, Math.random() * cv.height, 1.4, 1.4);
  }
  // darker rim where the sides curve away
  const eg = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  eg.addColorStop(0, 'rgba(60,25,20,0.28)'); eg.addColorStop(0.1, 'rgba(60,25,20,0)');
  eg.addColorStop(0.9, 'rgba(60,25,20,0)'); eg.addColorStop(1, 'rgba(60,25,20,0.28)');
  ctx.fillStyle = eg; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.restore();

  return { canvas: cv, w, tip: [cx, top] };
}

/**
 * Cut the index finger out of a screen-space frame using hand landmarks
 * (screen px). Returns a data URL of an upright finger, or null.
 */
export function cutFinger(frame, pts) {
  if (!pts || pts.length < 21) return null;
  const P = (i) => pts[i];
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mcp = P(5), pip = P(6), dip = P(7), tip = P(8);
  const len = d(mcp, pip) + d(pip, dip) + d(dip, tip);
  const w = clamp(0.62 * (d(pip, dip) + d(dip, tip)), len * 0.18, len * 0.4);
  // axis from knuckle to tip, with the tip pushed out past the landmark
  const ax = (tip[0] - mcp[0]) / d(mcp, tip), ay = (tip[1] - mcp[1]) / d(mcp, tip);
  const ext = w * 0.28;
  const T = [tip[0] + ax * ext, tip[1] + ay * ext];
  const total = d(mcp, T);
  const out = document.createElement('canvas');
  const scale = clamp(180 / w, 0.3, 2);
  const OW = Math.round(w * 1.2 * scale), OH = Math.round((total + w * 0.1) * scale);
  out.width = OW; out.height = OH;
  const o = out.getContext('2d');
  // rotate the frame so the finger points up, tip at the top-centre
  o.save();
  o.translate(OW / 2, w * 0.05 * scale);
  o.scale(scale, scale);
  o.rotate(-Math.atan2(ay, ax) - Math.PI / 2);
  o.translate(-T[0], -T[1]);
  o.drawImage(frame, 0, 0);
  o.restore();
  // soft-edged capsule mask
  const m = document.createElement('canvas'); m.width = OW; m.height = OH;
  const mc = m.getContext('2d');
  const cx = OW / 2, r = (w / 2) * scale, top = w * 0.05 * scale;
  for (let k = 0; k < 5; k++) {
    const rr = r * (1 - k * 0.04);
    mc.fillStyle = 'rgba(0,0,0,0.2)';
    mc.beginPath();
    mc.arc(cx, top + r, rr * 0.92, Math.PI, 0);
    mc.lineTo(cx + rr, OH);
    mc.lineTo(cx - rr, OH);
    mc.closePath();
    mc.fill();
  }
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(m, 0, 0);
  skinKey(o, OW, OH, cx, top + r * 2, r);
  return out.toDataURL('image/png');
}

// Trim background left inside the capsule: pixels far in colour from the finger's
// own skin (sampled down its centre line) fade out. Skipped if it would eat into
// the finger itself (e.g. the background is skin coloured).
function skinKey(o, W, H, cx, y0, r) {
  let img;
  try { img = o.getImageData(0, 0, W, H); } catch { return; }
  const d = img.data;
  const samples = [];
  for (let y = Math.round(y0); y < H * 0.9; y += 3) {
    for (let x = Math.round(cx - r * 0.3); x <= cx + r * 0.3; x += 3) {
      const i = (y * W + x) * 4;
      if (d[i + 3] > 200) samples.push([d[i], d[i + 1], d[i + 2]]);
    }
  }
  if (samples.length < 20) return;
  const med = [0, 1, 2].map((k) => samples.map((p) => p[k]).sort((a, b) => a - b)[samples.length >> 1]);
  const spread = Math.max(18, Math.sqrt(samples.reduce((s, p) => s + (p[0] - med[0]) ** 2 + (p[1] - med[1]) ** 2 + (p[2] - med[2]) ** 2, 0) / samples.length));
  const lm = med[0] * 0.3 + med[1] * 0.59 + med[2] * 0.11;
  // chroma distance (ignores shading) plus a looser brightness term
  const dist = (r0, g0, b0) => {
    const l = r0 * 0.3 + g0 * 0.59 + b0 * 0.11;
    const s = l > 1 ? lm / l : 1;
    return Math.hypot(r0 * s - med[0], g0 * s - med[1], b0 * s - med[2]) + Math.abs(l - lm) * 0.25;
  };
  const a0 = spread * 1.6, a1 = spread * 3.2;
  const alpha = new Float32Array(W * H);
  let lostCore = 0, core = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, j = i * 4;
      if (!d[j + 3]) continue;
      const k = clamp(1 - (dist(d[j], d[j + 1], d[j + 2]) - a0) / (a1 - a0), 0, 1);
      alpha[i] = k;
      if (Math.abs(x - cx) < r * 0.5 && y > y0) { core++; if (k < 0.5) lostCore++; }
    }
  }
  if (!core || lostCore / core > 0.12) return; // keying would damage the finger: keep the capsule
  // soften: 3x3 box blur of the key so edges aren't jagged
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, j = i * 4;
      if (!d[j + 3]) continue;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += alpha[i + dy * W + dx];
      d[j + 3] = d[j + 3] * (s / 9);
    }
  }
  o.putImageData(img, 0, 0);
}

/** Load a captured finger data URL into the same {canvas,w,tip} shape. */
export function capturedFinger(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ canvas: img, w: img.width / 1.2, tip: [img.width / 2, img.width / 1.2 * 0.05] });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Draw a finger whose tip is at (x, y), pointing along angle `ang` (radians,
 * direction from base to tip), `width` px wide on screen and long enough to
 * reach `reach` px back from the tip. The lower part of the image is
 * stretched if it is too short.
 */
export function drawFinger(ctx, f, x, y, ang, width, reach) {
  const s = width / f.w;
  const H = f.canvas.height, W = f.canvas.width;
  const native = (H - f.tip[1]) * s;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2);
  ctx.scale(s, s);
  ctx.translate(-f.tip[0], -f.tip[1]);
  if (native >= reach) {
    ctx.drawImage(f.canvas, 0, 0);
  } else if (f.stretch) {
    // lengthen the finger inside a band of plain skin, keep the rest as is
    const [a, b] = f.stretch;
    const extra = reach / s - (H - f.tip[1]);
    ctx.drawImage(f.canvas, 0, 0, W, a, 0, 0, W, a);
    ctx.drawImage(f.canvas, 0, a, W, b - a, 0, a - 0.5, W, b - a + extra + 1);
    ctx.drawImage(f.canvas, 0, b, W, H - b, 0, b + extra, W, H - b);
  } else {
    const keep = Math.round(H * 0.6);
    ctx.drawImage(f.canvas, 0, 0, W, keep, 0, 0, W, keep);
    const rest = (reach / s + f.tip[1]) - keep;
    ctx.drawImage(f.canvas, 0, keep, W, H - keep, 0, keep - 0.5, W, rest + 0.5);
  }
  ctx.restore();
}
