// Detects a hand waving over the phone using the front (selfie) camera.
// Works on a tiny 32x24 frame: a wave shows up as a sudden brightness drop
// (hand shadows the lens) and/or a burst of frame-to-frame motion.
//
// It only arms after the phone has been lying still for a moment, so placing
// the phone on the spectator's hand doesn't trigger it.

const lerp = (a, b, t) => a + (b - a) * t;

export class WaveDetector {
  constructor(onWave) {
    this.onWave = onWave;
    this.stream = null;
    this.timer = 0;
    this.armed = false;
    this.onArm = null;
  }

  async start(sensitivity = 0.5) {
    this.stop();
    this.sens = sensitivity;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    const v = document.createElement('video');
    v.playsInline = true; v.muted = true; v.setAttribute('playsinline', '');
    v.srcObject = this.stream;
    await v.play().catch(() => {});
    this.video = v;
    this.cv = document.createElement('canvas');
    this.cv.width = 32; this.cv.height = 24;
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.prev = null; this.base = 0; this.stable = 0; this.armed = false; this.cool = 0.8;
    this.last = performance.now();
    this.timer = setInterval(() => this._tick(), 50);
  }

  _tick() {
    const now = performance.now(), dt = (now - this.last) / 1000;
    this.last = now;
    const v = this.video;
    if (!v || v.readyState < 2) return;
    this.ctx.drawImage(v, 0, 0, 32, 24);
    const d = this.ctx.getImageData(0, 0, 32, 24).data;
    const n = 32 * 24;
    const g = new Float32Array(n);
    let lum = 0;
    for (let i = 0, j = 0; j < n; i += 4, j++) { g[j] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; lum += g[j]; }
    lum /= n;
    if (!this.prev) { this.prev = g; this.base = lum; return; }
    let motion = 0;
    for (let j = 0; j < n; j++) motion += Math.abs(g[j] - this.prev[j]);
    motion /= n;
    this.prev = g;

    const s = this.sens;
    const thrM = lerp(30, 7, s);
    const thrD = lerp(0.45, 0.14, s);
    const drop = this.base > 6 ? (this.base - lum) / this.base : 0;
    if (this.cool > 0) this.cool -= dt;

    if (!this.armed) {
      if (motion < thrM * 0.45) this.stable += dt; else this.stable = 0;
      this.base = lerp(this.base, lum, 0.15);
      if (this.stable > 0.9 && this.cool <= 0) {
        this.armed = true;
        if (this.onArm) this.onArm(true);
      }
    } else if (motion > thrM || drop > thrD) {
      this.armed = false; this.stable = 0; this.cool = 1.2;
      if (this.onArm) this.onArm(false);
      this.onWave();
    } else {
      this.base = lerp(this.base, lum, 0.04);
    }
  }

  stop() {
    clearInterval(this.timer); this.timer = 0;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null; this.video = null; this.armed = false;
  }
}
