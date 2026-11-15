// Procedurally animated creatures, drawn top-down on a canvas.
//
// Legged creatures use real locomotion: every foot is planted in world space
// and only moves during its swing phase (alternating tripod gait for the
// cockroach, alternating tetrapod for the spider). Legs are solved with
// two-bone IK every frame, so feet never slide over the photo.
// The earthworm uses follow-the-leader body points plus a peristaltic wave.
//
// Units: each creature has a body length L in CSS pixels. Body shapes are
// authored in "local" units where 1 == L, x points forward, y to the right.

const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const norm = (x, y) => { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; };

// Direction towards the light, in screen space (light from upper-left).
export const LIGHT = norm(-0.5, -0.86);

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// Smooth 1D value noise in [-1, 1].
export function noise1(seed) {
  const r = rng(seed);
  const v = Array.from({ length: 256 }, r);
  return (x) => {
    const i = Math.floor(x), f = x - i;
    return lerp(v[i & 255], v[(i + 1) & 255], smooth(f)) * 2 - 1;
  };
}

export const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// Filled, tapered capsule from (x1,y1) width w1 to (x2,y2) width w2.
function taper(ctx, x1, y1, x2, y2, w1, w2) {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / d, ny = dx / d;
  const an = Math.atan2(ny, nx), am = Math.atan2(-ny, -nx);
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
  ctx.lineTo(x2 + nx * w2 / 2, y2 + ny * w2 / 2);
  ctx.arc(x2, y2, w2 / 2, an, am, true);
  ctx.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
  ctx.arc(x1, y1, w1 / 2, am, an, true);
  ctx.closePath();
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function ellipse(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); }

// ---------------------------------------------------------------------------
// Legged base
// ---------------------------------------------------------------------------

class Legged {
  constructor(L, spec, seed = 7) {
    this.L = L;
    this.spec = spec;
    this.x = 0; this.y = 0; this.h = 0;
    this.speed = 0; this.time = 0;
    this.legs = spec.legs.map((l, i) => ({ ...l, i, foot: [0, 0], from: [0, 0], ideal: [0, 0] }));
    this.groups = [0, 1].map((g) => this.legs.filter((l) => l.g === g));
    this.swinging = -1; this.swingT = 0; this.swingDur = 0.1; this.lastGroup = 1;
    this.onStep = null;
    this.n1 = noise1(seed); this.n2 = noise1(seed + 101); this.n3 = noise1(seed + 202);
    this.reach = spec.reach;
  }

  toWorld(lx, ly) {
    const c = Math.cos(this.h), s = Math.sin(this.h), L = this.L;
    return [this.x + (lx * c - ly * s) * L, this.y + (lx * s + ly * c) * L];
  }

  toLocal(wx, wy) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    const dx = (wx - this.x) / this.L, dy = (wy - this.y) / this.L;
    return [dx * c + dy * s, -dx * s + dy * c];
  }

  localLight() {
    const c = Math.cos(-this.h), s = Math.sin(-this.h);
    return [LIGHT[0] * c - LIGHT[1] * s, LIGHT[0] * s + LIGHT[1] * c];
  }

  place(x, y, h) {
    this.x = x; this.y = y; this.h = h;
    for (const l of this.legs) {
      // Slightly randomised stance so the first frame isn't perfectly symmetric.
      const j = (this.n3(l.i * 3.1) * 0.06);
      l.foot = this.toWorld(l.rest[0] + j, l.rest[1]);
    }
  }

  step(dt) {
    this.time += dt;
    const L = this.L, sp = this.spec;
    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    for (const l of this.legs) l.ideal = this.toWorld(l.rest[0], l.rest[1]);

    const moving = this.speed > 0.15 * L;
    const thr = sp.stepThresh * L * (moving ? 1 : 0.4);
    const lead = moving ? sp.stepThresh * L * 0.7 : 0;

    if (this.swinging >= 0) {
      this.swingT += dt / this.swingDur;
      const e = smooth(Math.min(1, this.swingT));
      for (const l of this.groups[this.swinging]) {
        const tx = l.ideal[0] + fx * lead, ty = l.ideal[1] + fy * lead;
        l.foot = [lerp(l.from[0], tx, e), lerp(l.from[1], ty, e)];
      }
      if (this.swingT >= 1) {
        this.lastGroup = this.swinging;
        this.swinging = -1;
        if (this.onStep) this.onStep();
      }
    }

    if (this.swinging < 0) {
      let best = -1, bestErr = 0;
      for (let g = 0; g < 2; g++) {
        let err = 0;
        for (const l of this.groups[g]) err = Math.max(err, Math.hypot(l.foot[0] - l.ideal[0], l.foot[1] - l.ideal[1]));
        if (g !== this.lastGroup) err *= 1.25; // prefer alternating
        if (err > thr && err > bestErr) { best = g; bestErr = err; }
      }
      if (best >= 0) {
        this.swinging = best; this.swingT = 0;
        const stride = sp.stepThresh * L * 1.7;
        this.swingDur = moving ? clamp(0.42 * stride / this.speed, sp.minSwing, sp.maxSwing) : sp.maxSwing;
        for (const l of this.groups[best]) l.from = [l.foot[0], l.foot[1]];
      }
    }
  }

  // Two-bone IK. Knee chosen on the side away from the body axis.
  joints(l) {
    const L = this.L;
    const hip = this.toWorld(l.hip[0], l.hip[1]);
    let [fx, fy] = l.foot;
    const a = l.a * L, b = l.b * L;
    let dx = fx - hip[0], dy = fy - hip[1];
    let d = Math.hypot(dx, dy) || 1e-6;
    const maxD = (a + b) * 0.995, minD = Math.abs(a - b) + 1e-3;
    if (d > maxD) { fx = hip[0] + dx / d * maxD; fy = hip[1] + dy / d * maxD; d = maxD; }
    if (d < minD) d = minD;
    if (this.spec.arch) {
      // Legs arch upward in 3D (spider): seen from above, the knee sits close to
      // the hip→foot line, pushed outward a bit by however much slack there is.
      const ux = (fx - hip[0]) / d, uy = (fy - hip[1]) / d;
      const slack = Math.sqrt(Math.max(0, (a + b) ** 2 - d * d));
      const f = a / (a + b);
      const side = Math.sign(l.rest[1]);
      let nx = -uy, ny = ux;
      const test = this.toLocal(hip[0] + nx, hip[1] + ny)[1] - this.toLocal(hip[0], hip[1])[1];
      if (test * side < 0) { nx = -nx; ny = -ny; }
      const off = slack * this.spec.arch;
      return { hip, knee: [hip[0] + ux * d * f + nx * off, hip[1] + uy * d * f + ny * off], foot: [fx, fy] };
    }
    const ang = Math.atan2(dy, dx);
    const A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const k1 = [hip[0] + Math.cos(ang + A) * a, hip[1] + Math.sin(ang + A) * a];
    const k2 = [hip[0] + Math.cos(ang - A) * a, hip[1] + Math.sin(ang - A) * a];
    const side = Math.sign(l.rest[1]);
    const knee = this.toLocal(k1[0], k1[1])[1] * side > this.toLocal(k2[0], k2[1])[1] * side ? k1 : k2;
    return { hip, knee, foot: [fx, fy] };
  }

  bbox() {
    const r = this.reach * this.L;
    return [this.x - r, this.y - r, this.x + r, this.y + r];
  }

  velocityFactor() { return 1; }
}

// ---------------------------------------------------------------------------
// Cockroach (American cockroach, Periplaneta americana)
// ---------------------------------------------------------------------------

const ROACH_LEGS = [
  // front pair
  { hip: [0.30, -0.065], rest: [0.56, -0.32], a: 0.20, b: 0.27, g: 0, w: 0.034, t: 0.11 },
  { hip: [0.30, 0.065], rest: [0.56, 0.32], a: 0.20, b: 0.27, g: 1, w: 0.034, t: 0.11 },
  // middle pair
  { hip: [0.17, -0.085], rest: [0.11, -0.47], a: 0.24, b: 0.30, g: 1, w: 0.040, t: 0.13 },
  { hip: [0.17, 0.085], rest: [0.11, 0.47], a: 0.24, b: 0.30, g: 0, w: 0.040, t: 0.13 },
  // hind pair
  { hip: [0.05, -0.08], rest: [-0.47, -0.40], a: 0.30, b: 0.45, g: 0, w: 0.046, t: 0.16 },
  { hip: [0.05, 0.08], rest: [-0.47, 0.40], a: 0.30, b: 0.45, g: 1, w: 0.046, t: 0.16 },
];

export class Cockroach extends Legged {
  constructor(L, seed = 11) {
    super(L, { legs: ROACH_LEGS, stepThresh: 0.16, minSwing: 0.035, maxSwing: 0.11, reach: 1.75 }, seed);
    this.kind = 'cockroach';
    this.margin = 1.7;
  }

  draw(ctx) {
    this.drawLegs(ctx);
    this.drawBody(ctx);
  }

  drawLegs(ctx) {
    const L = this.L;
    ctx.lineCap = 'round';
    for (const l of this.legs) {
      const { hip, knee, foot } = this.joints(l);
      // tarsus continues past the tibia tip, bent slightly outward
      const [tdx, tdy] = norm(foot[0] - knee[0], foot[1] - knee[1]);
      const side = Math.sign(l.rest[1]);
      const out = this.toWorld(0, side); const outDir = norm(out[0] - this.x, out[1] - this.y);
      const tx = foot[0] + (tdx * 0.8 + outDir[0] * 0.35) * l.t * L;
      const ty = foot[1] + (tdy * 0.8 + outDir[1] * 0.35) * l.t * L;

      // coxa (thick base, mostly under the body)
      ctx.fillStyle = '#3d1d0b';
      const cx = lerp(hip[0], knee[0], 0.22), cy = lerp(hip[1], knee[1], 0.22);
      taper(ctx, hip[0], hip[1], cx, cy, l.w * 1.7 * L, l.w * 1.3 * L);
      // femur
      ctx.fillStyle = '#4b250f';
      taper(ctx, cx, cy, knee[0], knee[1], l.w * 1.25 * L, l.w * 0.85 * L);
      // tibia
      ctx.fillStyle = '#55290f';
      taper(ctx, knee[0], knee[1], foot[0], foot[1], l.w * 0.8 * L, l.w * 0.5 * L);
      // tarsus
      ctx.strokeStyle = '#5c2e12';
      ctx.lineWidth = l.w * 0.42 * L;
      line(ctx, foot[0], foot[1], tx, ty);

      // highlight along femur + tibia (light from upper left)
      const ho = l.w * 0.22 * L;
      ctx.strokeStyle = 'rgba(255, 196, 150, 0.32)';
      ctx.lineWidth = l.w * 0.25 * L;
      line(ctx, cx + LIGHT[0] * ho, cy + LIGHT[1] * ho, knee[0] + LIGHT[0] * ho, knee[1] + LIGHT[1] * ho);
      ctx.strokeStyle = 'rgba(255, 196, 150, 0.22)';
      line(ctx, knee[0] + LIGHT[0] * ho * 0.6, knee[1] + LIGHT[1] * ho * 0.6, foot[0] + LIGHT[0] * ho * 0.5, foot[1] + LIGHT[1] * ho * 0.5);

      // tibial spines – the giveaway "spiky leg" look of a roach
      ctx.strokeStyle = '#2e1406';
      ctx.lineWidth = Math.max(0.6, 0.0055 * L);
      const kdx = foot[0] - knee[0], kdy = foot[1] - knee[1];
      const kl = Math.hypot(kdx, kdy) || 1; const ux = kdx / kl, uy = kdy / kl;
      const sl = 0.035 * L;
      for (let k = 1; k <= 5; k++) {
        const f = k / 6;
        const px = knee[0] + kdx * f, py = knee[1] + kdy * f;
        for (const s of [-1, 1]) {
          const ca = Math.cos(0.55 * s), sa = Math.sin(0.55 * s);
          const vx = ux * ca - uy * sa, vy = ux * sa + uy * ca;
          line(ctx, px, py, px + vx * sl, py + vy * sl);
        }
      }
    }
  }

  drawBody(ctx) {
    const L = this.L, t = this.time;
    const [lx, ly] = this.localLight();
    const run = clamp(this.speed / (2.5 * L), 0, 1);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.h);
    ctx.scale(L, L);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // cerci
    ctx.fillStyle = '#3a1b09';
    for (const s of [-1, 1]) taper(ctx, -0.5, s * 0.04, -0.62, s * 0.085, 0.03, 0.008);

    // abdomen (peeks out behind the wings)
    ctx.fillStyle = '#331707';
    ellipse(ctx, -0.14, 0, 0.40, 0.165); ctx.fill();
    // abdominal segment lines at the tip
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.006;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(-0.47 + k * 0.035, 0, 0.03, 0.09 - k * 0.012, 0, -1.2, 1.2); ctx.stroke(); }

    // wings (tegmina): glossy, reddish brown
    let g = ctx.createRadialGradient(-0.02 + lx * 0.14, ly * 0.1, 0.02, -0.1, 0, 0.48);
    g.addColorStop(0, '#a9672f');
    g.addColorStop(0.45, '#7a3c15');
    g.addColorStop(0.85, '#4a210a');
    g.addColorStop(1, '#2c1205');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0.27, -0.13);
    ctx.bezierCurveTo(0.12, -0.21, -0.3, -0.21, -0.52, -0.06);
    ctx.quadraticCurveTo(-0.57, 0.0, -0.52, 0.06);
    ctx.bezierCurveTo(-0.3, 0.21, 0.12, 0.21, 0.27, 0.13);
    ctx.closePath();
    ctx.fill();

    // overlapping wing seam (left wing laps over the right)
    ctx.strokeStyle = 'rgba(25, 9, 2, 0.55)'; ctx.lineWidth = 0.007;
    ctx.beginPath(); ctx.moveTo(0.22, 0.0); ctx.bezierCurveTo(0.05, 0.03, -0.25, 0.04, -0.53, 0.015); ctx.stroke();
    // seam shading on right wing
    ctx.strokeStyle = 'rgba(20, 6, 0, 0.25)'; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.moveTo(0.2, 0.025); ctx.bezierCurveTo(0.05, 0.05, -0.25, 0.06, -0.5, 0.035); ctx.stroke();

    // wing veins
    ctx.strokeStyle = 'rgba(40, 15, 4, 0.12)'; ctx.lineWidth = 0.004;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const y0 = s * (0.05 + k * 0.04);
        ctx.beginPath(); ctx.moveTo(0.2, y0 * 0.8);
        ctx.quadraticCurveTo(-0.1, y0 * 1.5, -0.45, s * (0.03 + k * 0.022));
        ctx.stroke();
      }
    }

    // specular highlight on the wings
    ctx.save();
    ctx.translate(-0.1 + lx * 0.08, ly * 0.085);
    ctx.scale(1, 0.24);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.3);
    g.addColorStop(0, 'rgba(255, 228, 200, 0.38)');
    g.addColorStop(0.5, 'rgba(255, 220, 190, 0.12)');
    g.addColorStop(1, 'rgba(255, 220, 190, 0)');
    ctx.fillStyle = g;
    ellipse(ctx, 0, 0, 0.3, 0.3); ctx.fill();
    ctx.restore();

    // pronotum: pale margin, dark "butterfly" centre
    g = ctx.createRadialGradient(0.33 + lx * 0.04, ly * 0.05, 0.01, 0.33, 0, 0.18);
    g.addColorStop(0, '#d6a663');
    g.addColorStop(0.65, '#b07a3c');
    g.addColorStop(1, '#6b3a14');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0.46, 0);
    ctx.bezierCurveTo(0.46, -0.12, 0.33, -0.19, 0.24, -0.17);
    ctx.quadraticCurveTo(0.19, -0.1, 0.205, 0);
    ctx.quadraticCurveTo(0.19, 0.1, 0.24, 0.17);
    ctx.bezierCurveTo(0.33, 0.19, 0.46, 0.12, 0.46, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(55, 22, 5, 0.55)'; ctx.lineWidth = 0.006; ctx.stroke();
    ctx.fillStyle = 'rgba(48, 20, 5, 0.9)';
    for (const s of [-1, 1]) { ellipse(ctx, 0.335, s * 0.05, 0.075, 0.048, s * 0.25); ctx.fill(); }
    ellipse(ctx, 0.3, 0, 0.055, 0.03); ctx.fill();
    // pronotum gloss
    ctx.fillStyle = 'rgba(255, 238, 210, 0.22)';
    ellipse(ctx, 0.35 + lx * 0.05, ly * 0.07, 0.05, 0.022, 0.4); ctx.fill();

    // head (tucked under the pronotum)
    ctx.fillStyle = '#4a240c';
    ellipse(ctx, 0.475, 0, 0.05, 0.062); ctx.fill();
    ctx.fillStyle = '#140703';
    for (const s of [-1, 1]) { ellipse(ctx, 0.47, s * 0.043, 0.02, 0.03, s * 0.3); ctx.fill(); }
    // palps
    ctx.strokeStyle = '#5a2c10'; ctx.lineWidth = 0.008;
    const palp = Math.sin(t * 9) * 0.01 * (1 - run);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0.515, s * 0.018); ctx.lineTo(0.545, s * (0.035 + palp)); ctx.lineTo(0.56, s * 0.03); ctx.stroke(); }

    // antennae: long, flexible, constantly probing
    for (const s of [-1, 1]) {
      let ax = 0.52, ay = s * 0.028;
      const base = s * (0.32 + 0.22 * run) + this.n1(t * (1.2 + run) + (s > 0 ? 0 : 40)) * 0.35 * (1 - run * 0.6);
      let ang = base;
      const n = 16, seg = 1.15 / n;
      ctx.beginPath(); ctx.moveTo(ax, ay);
      for (let k = 0; k < n; k++) {
        const curv = s * (0.03 + 0.04 * run) + this.n2(t * 1.7 + k * 0.25 + (s > 0 ? 0 : 70)) * 0.06;
        ang += curv;
        ax += Math.cos(ang) * seg; ay += Math.sin(ang) * seg;
        ctx.lineTo(ax, ay);
      }
      ctx.strokeStyle = '#4a230c'; ctx.lineWidth = 0.009; ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Spider (house spider, Tegenaria-like)
// ---------------------------------------------------------------------------

const SPIDER_LEGS = [];
{
  const rests = [[0.80, 0.50], [0.33, 0.80], [-0.17, 0.76], [-0.64, 0.56]];
  const lens = [[0.52, 0.58], [0.46, 0.52], [0.42, 0.48], [0.52, 0.58]];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      SPIDER_LEGS.push({
        hip: [0.17 - i * 0.05, s * 0.07],
        rest: [rests[i][0], s * rests[i][1]],
        a: lens[i][0], b: lens[i][1],
        g: (i + (s > 0 ? 1 : 0)) % 2,
        w: 0.034 - i * 0.001,
        t: 0.13,
      });
    }
  }
}

export class Spider extends Legged {
  constructor(L, seed = 23) {
    super(L, { legs: SPIDER_LEGS, stepThresh: 0.2, minSwing: 0.03, maxSwing: 0.1, reach: 1.25, arch: 0.22 }, seed);
    this.kind = 'spider';
    this.margin = 1.2;
    const r = rng(seed * 7 + 3);
    // Pre-baked hair tufts so they don't flicker
    this.hairs = Array.from({ length: 160 }, () => ({ a: r() * TAU, l: 0.012 + r() * 0.022, o: r() * 0.5 - 0.25, rr: 0.9 + r() * 0.1 }));
    this.legHair = Array.from({ length: 12 }, () => [r(), r() > 0.5 ? 1 : -1, 0.02 + r() * 0.025]);
  }

  draw(ctx) {
    this.drawLegs(ctx);
    this.drawBody(ctx);
  }

  drawLegs(ctx) {
    const L = this.L;
    ctx.lineCap = 'round';
    for (const l of this.legs) {
      const { hip, knee, foot } = this.joints(l);
      const [tdx, tdy] = norm(foot[0] - knee[0], foot[1] - knee[1]);
      // metatarsus joint ~65% down the lower segment, with a slight bend
      const mx = lerp(knee[0], foot[0], 0.6), my = lerp(knee[1], foot[1], 0.6);
      const tx = foot[0] + tdx * l.t * L, ty = foot[1] + tdy * l.t * L;

      ctx.fillStyle = '#2a1b12';
      taper(ctx, hip[0], hip[1], knee[0], knee[1], l.w * 1.25 * L, l.w * 1.0 * L);
      ctx.fillStyle = '#33221a';
      taper(ctx, knee[0], knee[1], mx, my, l.w * 0.95 * L, l.w * 0.75 * L);
      ctx.fillStyle = '#2b1c14';
      taper(ctx, mx, my, foot[0], foot[1], l.w * 0.7 * L, l.w * 0.5 * L);
      ctx.strokeStyle = '#24170f'; ctx.lineWidth = l.w * 0.42 * L;
      line(ctx, foot[0], foot[1], tx, ty);

      // pale banding at joints
      ctx.strokeStyle = 'rgba(150, 118, 84, 0.75)';
      ctx.lineWidth = l.w * 0.5 * L;
      const band = (x1, y1, x2, y2, f, w) => {
        const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
        const px = x1 + dx * f, py = y1 + dy * f, nx = -dy / d * w / 2, ny = dx / d * w / 2;
        line(ctx, px - nx, py - ny, px + nx, py + ny);
      };
      band(hip[0], hip[1], knee[0], knee[1], 0.55, l.w * 1.05 * L);
      band(knee[0], knee[1], mx, my, 0.12, l.w * 0.95 * L);
      band(knee[0], knee[1], mx, my, 0.7, l.w * 0.8 * L);
      band(mx, my, foot[0], foot[1], 0.45, l.w * 0.6 * L);

      // highlight
      ctx.strokeStyle = 'rgba(220, 190, 160, 0.18)'; ctx.lineWidth = l.w * 0.22 * L;
      const ho = l.w * 0.25 * L;
      line(ctx, hip[0] + LIGHT[0] * ho, hip[1] + LIGHT[1] * ho, knee[0] + LIGHT[0] * ho, knee[1] + LIGHT[1] * ho);

      // bristles
      ctx.strokeStyle = 'rgba(25, 15, 10, 0.85)';
      ctx.lineWidth = Math.max(0.5, 0.004 * L);
      const segs = [[hip, knee], [knee, [mx, my]], [[mx, my], foot]];
      let hi = 0;
      for (const [p, q] of segs) {
        const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        for (let k = 0; k < 4; k++) {
          const [f, s, len] = this.legHair[hi++ % this.legHair.length];
          const px = p[0] + dx * (0.1 + f * 0.8), py = p[1] + dy * (0.1 + f * 0.8);
          const ca = Math.cos(0.7 * s), sa = Math.sin(0.7 * s);
          line(ctx, px, py, px + (ux * ca - uy * sa) * len * L, py + (ux * sa + uy * ca) * len * L);
        }
      }
    }
  }

  drawBody(ctx) {
    const L = this.L, t = this.time;
    const [lx, ly] = this.localLight();
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.h);
    ctx.scale(L, L);
    ctx.lineCap = 'round';

    // spinnerets
    ctx.fillStyle = '#2a1a10';
    for (const s of [-1, 1]) taper(ctx, -0.5, s * 0.012, -0.56, s * 0.022, 0.025, 0.012);

    // abdomen hair fringe
    ctx.strokeStyle = 'rgba(60, 42, 28, 0.55)'; ctx.lineWidth = 0.004;
    for (const h of this.hairs) {
      const ex = -0.27 + Math.cos(h.a) * 0.26 * h.rr, ey = Math.sin(h.a) * 0.185 * h.rr;
      const dx = Math.cos(h.a + h.o), dy = Math.sin(h.a + h.o);
      line(ctx, ex, ey, ex + dx * h.l, ey + dy * h.l);
    }

    // abdomen
    let g = ctx.createRadialGradient(-0.24 + lx * 0.09, ly * 0.07, 0.01, -0.27, 0, 0.28);
    g.addColorStop(0, '#6e5440');
    g.addColorStop(0.5, '#4a3424');
    g.addColorStop(1, '#22150d');
    ctx.fillStyle = g;
    ellipse(ctx, -0.27, 0, 0.27, 0.19); ctx.fill();
    // cardiac mark + chevrons
    ctx.fillStyle = 'rgba(30, 18, 10, 0.6)';
    ellipse(ctx, -0.13, 0, 0.09, 0.03); ctx.fill();
    ctx.strokeStyle = 'rgba(160, 128, 95, 0.55)'; ctx.lineWidth = 0.014;
    for (let k = 0; k < 5; k++) {
      const x0 = -0.2 - k * 0.055, w = 0.1 - k * 0.012;
      ctx.beginPath(); ctx.moveTo(x0 + 0.03, -w); ctx.lineTo(x0, 0); ctx.lineTo(x0 + 0.03, w); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(160, 128, 95, 0.4)';
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) { ellipse(ctx, -0.18 - k * 0.06, s * (0.1 - k * 0.012), 0.014, 0.01); ctx.fill(); }
    // gloss
    ctx.fillStyle = 'rgba(255, 240, 220, 0.12)';
    ellipse(ctx, -0.26 + lx * 0.1, ly * 0.08, 0.09, 0.05); ctx.fill();

    // pedicel
    ctx.fillStyle = '#22150d';
    ellipse(ctx, -0.02, 0, 0.04, 0.03); ctx.fill();

    // cephalothorax
    g = ctx.createRadialGradient(0.1 + lx * 0.05, ly * 0.05, 0.01, 0.1, 0, 0.16);
    g.addColorStop(0, '#7a5c44');
    g.addColorStop(0.7, '#4c3626');
    g.addColorStop(1, '#2a1a10');
    ctx.fillStyle = g;
    ellipse(ctx, 0.1, 0, 0.155, 0.125); ctx.fill();
    // radial stripes + fovea
    ctx.strokeStyle = 'rgba(25, 15, 8, 0.55)'; ctx.lineWidth = 0.012;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2;
      line(ctx, 0.09 + Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.09 + Math.cos(a) * 0.12, Math.sin(a) * 0.1);
    }
    ctx.fillStyle = 'rgba(20, 12, 6, 0.8)';
    for (const s of [-1, 1]) { ellipse(ctx, 0.12, s * 0.06, 0.08, 0.016, s * 0.15); ctx.fill(); }

    // chelicerae
    ctx.fillStyle = '#2b1a0f';
    for (const s of [-1, 1]) { ellipse(ctx, 0.27, s * 0.034, 0.045, 0.028, s * 0.2); ctx.fill(); }
    // eyes
    ctx.fillStyle = '#0b0705';
    const eyes = [[0.235, -0.025], [0.235, 0.025], [0.225, -0.055], [0.225, 0.055], [0.21, -0.015], [0.21, 0.015], [0.205, -0.045], [0.205, 0.045]];
    for (const [ex, ey] of eyes) { ellipse(ctx, ex, ey, 0.011, 0.011); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const [ex, ey] of eyes.slice(0, 4)) { ellipse(ctx, ex - 0.003, ey - 0.003, 0.003, 0.003); ctx.fill(); }

    // pedipalps (twitch when idle)
    const tw = Math.sin(t * 7) * 0.02 * (this.speed < 0.2 * L ? 1 : 0.2);
    ctx.strokeStyle = '#33221a'; ctx.lineWidth = 0.024;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0.22, s * 0.06); ctx.lineTo(0.31, s * (0.1 + tw * s)); ctx.lineTo(0.38, s * (0.085 + tw)); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Earthworm
// ---------------------------------------------------------------------------

export class Worm {
  constructor(L, seed = 5) {
    this.kind = 'worm';
    this.L = L;
    this.n = 60;
    this.x = 0; this.y = 0; this.h = 0;
    this.speed = 0; this.time = 0; this.phase = 0;
    this.trail = [];
    this.pts = [];
    this.n1 = noise1(seed);
    this.margin = 0.05;
    this.onStep = null;
    this._lastCycle = 0;
  }

  place(x, y, h) {
    this.x = x; this.y = y; this.h = h;
    const step = this.L / 150;
    this.trail = [];
    for (let i = 0; i <= 260; i++) this.trail.push([x - Math.cos(h) * step * i, y - Math.sin(h) * step * i]);
    this.step(0);
  }

  // Peristalsis: the head surges forward, then pauses while the wave travels back.
  velocityFactor() {
    return 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.phase));
  }

  step(dt) {
    this.time += dt;
    const L = this.L;
    this.phase += dt * TAU * 0.75;
    const cycle = Math.floor(this.phase / TAU);
    if (cycle !== this._lastCycle) { this._lastCycle = cycle; if (this.onStep) this.onStep(); }

    // grow trail
    const head = this.trail[0];
    if (Math.hypot(this.x - head[0], this.y - head[1]) > L / 300) this.trail.unshift([this.x, this.y]);
    else this.trail[0] = [this.x, this.y];
    // trim trail to ~1.5 L
    let acc = 0;
    for (let i = 1; i < this.trail.length; i++) {
      acc += Math.hypot(this.trail[i][0] - this.trail[i - 1][0], this.trail[i][1] - this.trail[i - 1][1]);
      if (acc > L * 1.5) { this.trail.length = i + 1; break; }
    }

    // body points at arc lengths, with a travelling stretch wave
    const n = this.n, base = L / (n - 1);
    const pts = new Array(n);
    let target = 0, ti = 0, segAcc = 0;
    pts[0] = [this.trail[0][0], this.trail[0][1]];
    for (let i = 1; i < n; i++) {
      target += base * (1 + 0.16 * Math.sin(this.phase - i * 0.3));
      // walk along trail until arc length reaches target
      while (ti < this.trail.length - 1) {
        const a = this.trail[ti], b = this.trail[ti + 1];
        const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segAcc + sl >= target) {
          const f = sl > 0 ? (target - segAcc) / sl : 0;
          pts[i] = [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
          break;
        }
        segAcc += sl; ti++;
      }
      if (!pts[i]) {
        // ran off the trail: extend straight back
        const p = pts[i - 1], q = pts[i - 2] || [p[0] + Math.cos(this.h), p[1] + Math.sin(this.h)];
        const [dx, dy] = norm(p[0] - q[0], p[1] - q[1]);
        pts[i] = [p[0] + dx * base, p[1] + dy * base];
      }
    }
    // head searching sway
    const sway = this.n1(this.time * 0.9) * 0.05 * L;
    const [hx, hy] = norm(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
    for (let i = 0; i < 10; i++) {
      const f = (1 - i / 10) ** 2;
      pts[i][0] += -hy * sway * f; pts[i][1] += hx * sway * f;
    }
    this.pts = pts;
  }

  bbox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of this.pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const m = 0.06 * this.L;
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  }

  draw(ctx) {
    const L = this.L, n = this.n, pts = this.pts;
    if (!pts.length) return;
    const w0 = 0.03 * L;
    const W = new Array(n), N = new Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      let prof = u < 0.06 ? lerp(0.45, 1, smooth(u / 0.06)) : u > 0.7 ? lerp(1, 0.55, (u - 0.7) / 0.3) : 1;
      if (u > 0.22 && u < 0.33) prof *= 1.13;
      prof *= 1 - 0.13 * Math.sin(this.phase - i * 0.3);
      W[i] = w0 * prof;
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
      const [tx, ty] = norm(p[0] - q[0], p[1] - q[1]);
      N[i] = [-ty, tx];
    }

    // outline
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const p = pts[i]; ctx.lineTo(p[0] + N[i][0] * W[i], p[1] + N[i][1] * W[i]); }
    {
      const p = pts[n - 1], a = Math.atan2(N[n - 1][1], N[n - 1][0]);
      ctx.arc(p[0], p[1], W[n - 1], a, a + Math.PI, true);
    }
    for (let i = n - 1; i >= 0; i--) { const p = pts[i]; ctx.lineTo(p[0] - N[i][0] * W[i], p[1] - N[i][1] * W[i]); }
    {
      const p = pts[0], a = Math.atan2(-N[0][1], -N[0][0]);
      ctx.arc(p[0], p[1], W[0], a, a + Math.PI, true);
    }
    ctx.closePath();
    ctx.fillStyle = '#7d3b39';
    ctx.fill();

    ctx.lineCap = 'round';
    // body core (rounder look): lighter stripe shifted towards the light
    for (let i = 0; i < n - 1; i++) {
      const d = N[i][0] * LIGHT[0] + N[i][1] * LIGHT[1];
      const o = d * W[i] * 0.25;
      const p = pts[i], q = pts[i + 1];
      const u = i / (n - 1);
      const clit = u > 0.22 && u < 0.33;
      ctx.strokeStyle = clit ? '#c47a62' : u < 0.12 ? '#a85a55' : '#b06763';
      ctx.lineWidth = W[i] * 1.15;
      line(ctx, p[0] + N[i][0] * o, p[1] + N[i][1] * o, q[0] + N[i + 1][0] * o, q[1] + N[i + 1][1] * o);
    }
    // dorsal blood vessel (darker line down the middle, fades towards tail)
    ctx.strokeStyle = 'rgba(110, 30, 35, 0.35)';
    ctx.lineWidth = w0 * 0.25;
    ctx.beginPath();
    for (let i = 2; i < n * 0.8; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    // annuli (segment rings)
    ctx.strokeStyle = 'rgba(70, 20, 22, 0.28)';
    ctx.lineWidth = Math.max(0.6, 0.0028 * L);
    for (let i = 1; i < n - 1; i++) {
      const p = pts[i];
      line(ctx, p[0] + N[i][0] * W[i] * 0.92, p[1] + N[i][1] * W[i] * 0.92, p[0] - N[i][0] * W[i] * 0.92, p[1] - N[i][1] * W[i] * 0.92);
    }
    // wet specular streak
    ctx.strokeStyle = 'rgba(255, 236, 232, 0.5)';
    for (let i = 1; i < n - 2; i++) {
      const d = N[i][0] * LIGHT[0] + N[i][1] * LIGHT[1];
      const s = d >= 0 ? 1 : -1;
      const o = s * W[i] * 0.48;
      const p = pts[i], q = pts[i + 1];
      ctx.lineWidth = W[i] * 0.18;
      line(ctx, p[0] + N[i][0] * o, p[1] + N[i][1] * o, q[0] + N[i + 1][0] * o, q[1] + N[i + 1][1] * o);
    }
    // edge darkening
    ctx.strokeStyle = 'rgba(60, 15, 18, 0.35)';
    ctx.lineWidth = Math.max(0.6, 0.004 * L);
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(pts[i][0] - N[i][0] * W[i], pts[i][1] - N[i][1] * W[i]);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(pts[i][0] + N[i][0] * W[i], pts[i][1] + N[i][1] * W[i]);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Rendered cockroach: a ray-traced, top-down walk cycle (tools/roach_blender.py)
// played back as a sprite. The cycle advances with distance travelled, so the
// planted feet stay put on the photo instead of sliding.
// ---------------------------------------------------------------------------

export const ROACH_SHEET = {
  // values printed by the packing step in tools/README (frame size, body origin, px per body length)
  frames: 16, cols: 4, fw: 536, fh: 362, ox: 186.46, oy: 180, ppl: 246.154, stride: 0.30,
  img: (() => { const i = new Image(); i.decoding = 'async'; i.src = 'assets/roach.webp'; return i; })(),
};

export class RoachSprite {
  constructor(L, seed = 11) {
    this.L = L; this.kind = 'cockroach';
    this.x = 0; this.y = 0; this.h = 0; this.speed = 0;
    this.phase = rng(seed)(); this.prevPhase = this.phase;
    this.onStep = null;
    const S = ROACH_SHEET;
    const corners = [[-S.ox, -S.oy], [S.fw - S.ox, -S.oy], [-S.ox, S.fh - S.oy], [S.fw - S.ox, S.fh - S.oy]];
    this.reach = Math.max(...corners.map(([a, b]) => Math.hypot(a, b))) / S.ppl;
    this.margin = this.reach;
  }

  place(x, y, h) { this.x = x; this.y = y; this.h = h; }
  velocityFactor() { return 1; }

  step(dt) {
    const S = ROACH_SHEET;
    const before = this.phase;
    this.phase += (this.speed * dt) / (S.stride * this.L);
    // a tripod touches down every half cycle
    if (Math.floor(this.phase * 2) !== Math.floor(before * 2) && this.onStep) this.onStep();
  }

  bbox() {
    const r = this.reach * this.L;
    return [this.x - r, this.y - r, this.x + r, this.y + r];
  }

  _frame(ctx, phase, alpha) {
    const S = ROACH_SHEET;
    const f = ((Math.floor(phase * S.frames) % S.frames) + S.frames) % S.frames;
    ctx.globalAlpha = alpha;
    ctx.drawImage(S.img, (f % S.cols) * S.fw, Math.floor(f / S.cols) * S.fh, S.fw, S.fh, -S.ox, -S.oy, S.fw, S.fh);
  }

  draw(ctx) {
    const S = ROACH_SHEET;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.h);
    const k = this.L / S.ppl;
    ctx.scale(k, k);
    ctx.imageSmoothingQuality = 'high';
    // Motion blur for the legs: when a display frame spans several cycle frames,
    // layer the in-between poses faintly over the current one (the body is
    // identical in every frame, so it stays crisp and opaque).
    const span = (this.phase - this.prevPhase) * S.frames;
    this._frame(ctx, this.phase, 1);
    if (span > 1.2) {
      const n = Math.min(3, Math.floor(span));
      for (let i = 1; i <= n; i++) this._frame(ctx, this.phase - (span * i) / (n + 1) / S.frames, 0.38);
    }
    this.prevPhase = this.phase;
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------

export const CREATURES = {
  cockroach: {
    label: 'Cockroach',
    make: (L, seed) => (ROACH_SHEET.img.complete && ROACH_SHEET.img.naturalWidth ? new RoachSprite(L, seed) : new Cockroach(L, seed)),
    size: 0.36,          // body length as fraction of screen width
    motion: { run: 3.4, turn: 7.5, accel: 35, decel: 45, micro: 0.35, microDur: [0.08, 0.35], wiggle: 0.35, arrive: 0.35 },
    palmPause: [0.7, 0.5, 1.3],   // probability, min, max seconds
  },
  spider: {
    label: 'Spider',
    make: (L, seed) => new Spider(L, seed),
    size: 0.26,
    motion: { run: 4.6, turn: 11, accel: 60, decel: 70, micro: 0.8, microDur: [0.15, 0.7], wiggle: 0.12, arrive: 0.4 },
    palmPause: [0.85, 0.6, 1.8],
  },
  worm: {
    label: 'Earthworm',
    make: (L, seed) => new Worm(L, seed),
    size: 0.8,
    motion: { run: 0.42, turn: 0.9, accel: 2, decel: 2, micro: 0, microDur: [0, 0], wiggle: 0.35, arrive: 0.12 },
    palmPause: [0, 0, 0],
  },
};
