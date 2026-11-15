// The on-screen finger that slides in and scratches the creature's back.
// The performer slides their real finger in under the phone's bottom edge at
// the same moment, so the screen finger reads as a continuation of it.
//
// A finger image always points UP (tip at the top). Two sources:
//  - drawn: a shaded, nail-and-crease finger with adjustable skin tone
//  - captured: a cut-out of the performer's own index finger, made from a
//    camera frame using the hand-tracking landmarks.

import { clamp, lerp } from './creatures.js';

const LIGHT_SKIN = [241, 200, 170];
const DARK_SKIN = [96, 60, 42];

function skin(tone, k = 1) {
  const c = LIGHT_SKIN.map((v, i) => lerp(v, DARK_SKIN[i], tone) * k);
  return (a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

/** Drawn finger: returns { canvas, w (finger width px), tip:[x,y] }. */
export function drawnFinger(tone = 0.25, w = 160) {
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
  return out.toDataURL('image/png');
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
  } else {
    const keep = Math.round(H * 0.6);
    ctx.drawImage(f.canvas, 0, 0, W, keep, 0, 0, W, keep);
    const rest = (reach / s + f.tip[1]) - keep;
    ctx.drawImage(f.canvas, 0, keep, W, H - keep, 0, keep - 0.5, W, rest + 0.5);
  }
  ctx.restore();
}
