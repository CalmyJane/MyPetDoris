// Runs one creature appearance over the photo: path planning, steering,
// compositing with soft shadows, light matching and haptic footsteps.

import { CREATURES, clamp, lerp, noise1, wrapAngle } from './creatures.js';
import { drawFinger } from './finger.js';

const rand = (a, b) => a + Math.random() * (b - a);

class Mover {
  constructor(c, wps, prof, speedMul) {
    this.c = c; this.wps = wps; this.p = prof; this.mul = speedMul;
    this.i = 0; this.pause = 0; this.v = 0; this.t = 0;
    this.n = noise1((Math.random() * 1e6) | 0);
    this.n2 = noise1((Math.random() * 1e6) | 0);
  }

  update(dt) {
    const c = this.c, L = c.L, p = this.p;
    this.t += dt;
    let target = 0;
    if (this.pause > 0) {
      this.pause -= dt;
    } else if (this.i < this.wps.length) {
      const wp = this.wps[this.i];
      const dx = wp.x - c.x, dy = wp.y - c.y;
      if (Math.hypot(dx, dy) < p.arrive * L) {
        if (wp.pause) this.pause = wp.pause;
        this.i++;
        if (wp.palm && this.onPalm) this.onPalm();
      }
      const desired = Math.atan2(dy, dx) + this.n(this.t * 1.3) * p.wiggle;
      const diff = wrapAngle(desired - c.h);
      c.h += clamp(diff, -p.turn * dt, p.turn * dt);
      target = p.run * L * this.mul * (0.85 + 0.3 * this.n2(this.t * 0.8)) * clamp(1 - Math.abs(diff) / 2.2, 0.3, 1);
      if (p.micro && Math.random() < p.micro * dt) this.pause = rand(p.microDur[0], p.microDur[1]);
    } else {
      // past the last waypoint: keep going straight until fully off screen
      target = p.run * L * this.mul;
    }
    const rate = (target > this.v ? p.accel : p.decel) * L * Math.max(0.5, this.mul);
    this.v = target > this.v ? Math.min(target, this.v + rate * dt) : Math.max(target, this.v - rate * dt);
    const vf = c.velocityFactor();
    const sp = this.v * vf;
    c.x += Math.cos(c.h) * sp * dt;
    c.y += Math.sin(c.h) * sp * dt;
    c.speed = sp;
    c.step(dt);
  }
}

function planPath(W, H, L, margin, side, palm, pauseCfg, extraCfg) {
  if (side === 'random') {
    const r = Math.random();
    side = r < 0.36 ? 'left' : r < 0.72 ? 'right' : r < 0.86 ? 'top' : 'bottom';
  }
  const opp = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  const edge = (s, t) =>
    s === 'left' ? [-margin, H * t] :
    s === 'right' ? [W + margin, H * t] :
    s === 'top' ? [W * t, -margin] : [W * t, H + margin];

  let exitSide = opp[side];
  if (Math.random() < 0.25) {
    const adj = (side === 'left' || side === 'right') ? ['top', 'bottom'] : ['left', 'right'];
    exitSide = adj[Math.random() < 0.5 ? 0 : 1];
  }
  const start = edge(side, rand(0.3, 0.7));
  const exit = edge(exitSide, rand(0.25, 0.75));
  const m = Math.min(W, H);
  const P = palm ? [palm.x + rand(-0.05, 0.05) * m, palm.y + rand(-0.05, 0.05) * m]
                 : [W * rand(0.42, 0.58), H * rand(0.45, 0.6)];

  const via = (a, b, f, off) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
    const o = rand(-off, off) * m;
    return { x: a[0] + dx * f - dy / d * o, y: a[1] + dy * f + dx / d * o };
  };
  const [pp, pmin, pmax] = pauseCfg;
  const wps = [
    via(start, P, 0.5, 0.12),
    { x: P[0], y: P[1], pause: Math.random() < pp ? rand(pmin, pmax) : 0, palm: true },
    via(P, exit, 0.5, 0.12),
    { x: exit[0], y: exit[1] },
  ];
  // optional second freeze at one of the on-screen bends (before or after the palm)
  if (extraCfg && Math.random() < extraCfg[0]) {
    const k = Math.random() < 0.5 ? 0 : 2;
    const w = wps[k];
    if (w.x > L * 0.4 && w.x < W - L * 0.4 && w.y > L * 0.4 && w.y < H - L * 0.4) w.pause = rand(extraCfg[1], extraCfg[2]);
  }
  const h = Math.atan2(wps[0].y - start[1], wps[0].x - start[0]);
  return { start, h, wps };
}

export class Show {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d');
    this.raf = 0;
    this.dark = 0;
    this.tint = 'rgba(0,0,0,0)';
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
  }

  // Match the creature to the photo's exposure / colour cast.
  setPhoto(photoCanvas) {
    try {
      const s = document.createElement('canvas'); s.width = 16; s.height = 16;
      const c = s.getContext('2d', { willReadFrequently: true });
      c.drawImage(photoCanvas, 0, 0, 16, 16);
      const d = c.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4; r /= n; g /= n; b /= n;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      this.dark = clamp((0.5 - lum) * 1.1, 0, 0.5);
      this.tint = `rgba(${r | 0},${g | 0},${b | 0},0.12)`;
    } catch { this.dark = 0; }
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.fingerAnim = null;
    this.cur = null;
    if (this._resolve) { const r = this._resolve; this._resolve = null; r(); }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
  }

  /** opts: { type, size, speed, side, palm:{x,y}|null, haptics, onFrame? } */
  play(opts) {
    this.stop();
    this.resize();
    const def = CREATURES[opts.type] || CREATURES.cockroach;
    const W = this.W, H = this.H;
    const L = def.size * Math.min(W, H) * (opts.size || 1);
    const c = def.make(L, (Math.random() * 1e6) | 0);
    const margin = c.margin * L + 4;
    const path = planPath(W, H, L, margin, opts.side || 'random', opts.palm, def.palmPause, def.extraPause);
    c.place(path.start[0], path.start[1], path.h);
    const mover = new Mover(c, path.wps, def.motion, opts.speed || 1);
    this.cur = { c, mover, opts };
    this.fingerAnim = null;
    if (opts.finger && opts.finger.auto) mover.onPalm = () => this.scratch();

    let lastBuzz = 0;
    if (opts.haptics && navigator.vibrate) {
      c.onStep = () => {
        const now = performance.now();
        if (now - lastBuzz < 45 || !this._onScreen(c)) return;
        lastBuzz = now;
        try { navigator.vibrate(c.kind === 'worm' ? 14 : c.kind === 'spider' ? 5 : 7); } catch {}
      };
    }

    return new Promise((resolve) => {
      this._resolve = resolve;
      let last = performance.now();
      let entered = false;
      const started = last;
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        // sub-step for stable gait at low frame rates
        const sub = Math.ceil(dt / 0.012);
        for (let k = 0; k < sub; k++) mover.update(dt / sub);
        this._updateFinger(dt);
        this._render(c);
        const on = this._onScreen(c);
        if (on) entered = true;
        const timeout = now - started > 60000;
        if ((entered && !on && mover.i >= mover.wps.length) || timeout) {
          this.stop();
          return;
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  /** Finger slides in from the bottom edge and scratches the creature's back. */
  scratch() {
    const cur = this.cur, fo = cur?.opts.finger;
    if (!cur || !fo?.image || this.fingerAnim || cur.scratched) return false;
    if (!this._onScreen(cur.c)) return false;
    cur.scratched = true;
    cur.mover.pause = 1e9; // hold still under the finger
    this.fingerAnim = { t: 0, ang: 0, tip: null };
    return true;
  }

  get scratching() { return !!this.fingerAnim; }

  _updateFinger(dt) {
    const fa = this.fingerAnim;
    if (!fa) return;
    const { c, mover } = this.cur;
    const W = this.W, H = this.H, L = c.L;
    const IN = 0.55, SCR = 1.6, OUT = 0.5;
    fa.t += dt;
    // base sits just past the bottom edge, centred: where the real finger enters
    const base = [W * 0.5, H + 0.04 * H];
    const tx = clamp(c.x, W * 0.12, W * 0.88), ty = clamp(c.y, H * 0.12, H * 0.92);
    const ang = Math.atan2(ty - base[1], tx - base[0]);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const dist = Math.hypot(tx - base[0], ty - base[1]);
    const ease = (u) => 1 - (1 - u) ** 3;
    let along; // distance of the tip from the base
    let jig = 0;
    if (fa.t < IN) along = dist * ease(fa.t / IN);
    else if (fa.t < IN + SCR) {
      const u = (fa.t - IN) / SCR;
      along = dist - 0.16 * L * (0.5 - 0.5 * Math.cos(u * Math.PI * 2 * 3)) * Math.sin(u * Math.PI);
      jig = Math.sin(u * 40) * 0.03 * Math.sin(u * Math.PI);
    } else if (fa.t < IN + SCR + OUT) {
      const u = (fa.t - IN - SCR) / OUT;
      along = dist * (1 - u * u);
      if (mover.pause > 1e8) { mover.pause = 0.12; mover.mul *= 1.5; } // spooked
    } else { this.fingerAnim = null; return; }
    c.h += jig * 0.5;
    fa.ang = ang;
    fa.tip = [base[0] + dx * along, base[1] + dy * along];
    fa.reach = along + 0.08 * H;
  }

  _drawFinger() {
    const fa = this.fingerAnim, fo = this.cur?.opts.finger;
    if (!fa?.tip || !fo?.image) return;
    const ctx = this.ctx, dpr = this.dpr;
    const width = 0.21 * Math.min(this.W, this.H) * (fo.size || 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = width * 0.35 * dpr;
    ctx.shadowOffsetX = width * 0.18 * dpr;
    ctx.shadowOffsetY = width * 0.3 * dpr;
    if (this.dark > 0 && 'filter' in ctx) ctx.filter = `brightness(${1 - this.dark * 0.8})`;
    drawFinger(ctx, fo.image, fa.tip[0], fa.tip[1], fa.ang, width, fa.reach);
    ctx.restore();
  }

  _onScreen(c) {
    const [x0, y0, x1, y1] = c.bbox();
    return x1 > 0 && y1 > 0 && x0 < this.W && y0 < this.H;
  }

  _render(c) {
    const ctx = this.ctx, dpr = this.dpr, L = c.L;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);

    let [x0, y0, x1, y1] = c.bbox();
    x0 = Math.max(x0, -L * 0.2); y0 = Math.max(y0, -L * 0.2);
    x1 = Math.min(x1, this.W + L * 0.2); y1 = Math.min(y1, this.H + L * 0.2);
    if (x1 <= x0 || y1 <= y0) return;
    const bw = Math.ceil((x1 - x0) * dpr), bh = Math.ceil((y1 - y0) * dpr);
    if (this.buf.width < bw || this.buf.height < bh) {
      this.buf.width = Math.max(this.buf.width, bw);
      this.buf.height = Math.max(this.buf.height, bh);
    }
    const b = this.bctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, bw, bh);
    b.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    c.draw(b);

    // light matching: darken in dim photos, pick up a bit of the ambient cast
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-atop';
    if (this.dark > 0) { b.fillStyle = `rgba(0,0,0,${this.dark})`; b.fillRect(0, 0, bw, bh); }
    b.fillStyle = this.tint; b.fillRect(0, 0, bw, bh);
    b.globalCompositeOperation = 'source-over';

    const dx = Math.round(x0 * dpr), dy = Math.round(y0 * dpr);
    // 1) soft, offset cast shadow – drawn far off-canvas so only the shadow lands
    const far = 20000;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = 0.07 * L * dpr;
    ctx.shadowOffsetX = far + 0.035 * L * dpr;
    ctx.shadowOffsetY = 0.06 * L * dpr;
    ctx.drawImage(this.buf, 0, 0, bw, bh, dx - far, dy, bw, bh);
    // 2) tight contact shadow + the creature itself
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 0.015 * L * dpr + 1;
    ctx.shadowOffsetX = 0.008 * L * dpr;
    ctx.shadowOffsetY = 0.014 * L * dpr;
    ctx.drawImage(this.buf, 0, 0, bw, bh, dx, dy, bw, bh);
    ctx.restore();
    this._drawFinger();
  }
}

// Static thumbnail of a creature (settings screen).
export function drawThumb(canvas, type) {
  const def = CREATURES[type];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = canvas.clientWidth || 90;
  canvas.width = size * dpr; canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = type === 'worm' ? size * 0.75 : type === 'spider' ? size * 0.38 : size * 0.48;
  const c = def.make(L, 3);
  if (type === 'worm') {
    c.place(size * 0.5 + L * 0.42, size * 0.5, 0);
    // curl it a little
    for (let i = 0; i < 160; i++) { c.h += 0.012; c.x += Math.cos(c.h) * L / 150; c.y += Math.sin(c.h) * L / 150; c.step(1 / 160); }
    c.x = c.pts[0][0]; c.y = c.pts[0][1];
    const [bx0, by0, bx1, by1] = c.bbox();
    ctx.translate(size / 2 - (bx0 + bx1) / 2, size / 2 - (by0 + by1) / 2);
  } else {
    c.place(size * 0.5 + L * 0.05, size * 0.52, -Math.PI / 2 + 0.35);
    c.step(0);
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4 * dpr; ctx.shadowOffsetX = 1.5 * dpr; ctx.shadowOffsetY = 2.5 * dpr;
  c.draw(ctx);
  ctx.restore();
}

export { lerp };
