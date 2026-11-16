# Cuts the two index fingers out of "Human-Hands-Front-Back.jpg" by Evan-Amos
# (Wikimedia Commons, CC BY-SA 3.0,
# https://commons.wikimedia.org/wiki/File:Human-Hands-Front-Back.jpg)
# into upright, transparent finger images for the app:
#   assets/finger_pad.webp  - palm side (left hand in the photo)
#   assets/finger_nail.webp - back / nail side (right hand)
#   python tools/cut_finger.py <path to Human-Hands-Front-Back.jpg>
# Prints the {w, tip, stretch} values used in js/finger.js.
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

SCALE = 2.5  # upscale: the source fingers are only ~62 px wide

# per finger: x window to look in, rows (tip search start, bottom), and a band
# of crease-free skin rows the app may stretch to make the finger longer
FINGERS = {
    'pad': dict(x=(340, 430), y=(70, 292), stretch=(260, 286)),
    'nail': dict(x=(970, 1050), y=(80, 262), stretch=(212, 258)),
}
BG = np.array([244, 244, 244], np.float32)

src = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)
lum = src.mean(2)
sat = src.max(2) - src.min(2)
# soft "how much this is skin, not white backdrop"
skin = np.clip(np.maximum((sat - 10) / 18, (226 - lum) / 22), 0, 1)
out_dir = os.path.join(os.path.dirname(__file__), '..', 'assets')
meta = {}

for name, f in FINGERS.items():
    x0, x1 = f['x']
    ya, yb = f['y']
    # per row: the skin run nearest the window centre
    rows = []
    cx = (x0 + x1) / 2
    for y in range(ya, yb):
        on = skin[y, x0:x1] > 0.5
        runs, s = [], None
        for i, v in enumerate(on):
            if v and s is None: s = i
            if not v and s is not None: runs.append((s, i - 1)); s = None
        if s is not None: runs.append((s, len(on) - 1))
        runs = [(a + x0, b + x0) for a, b in runs if b - a > 6]
        if not runs:
            continue
        a, b = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - cx))
        rows.append((y, a, b))
        cx = (a + b) / 2
    tip_y = rows[0][0]
    ys = np.array([r[0] for r in rows], np.float32)
    cs = np.array([(r[1] + r[2]) / 2 for r in rows], np.float32)
    ws = np.array([r[2] - r[1] for r in rows], np.float32)
    # axis through the finger (ignore the rounded tip)
    sel = ys > tip_y + 30
    k, c0 = np.polyfit(ys[sel], cs[sel], 1)
    ang = np.degrees(np.arctan(k))
    width = float(np.median(ws[sel]))

    # mask: inside this finger's own edges (neighbouring fingers excluded), soft key
    mask = np.zeros_like(skin)
    for y, a, b in rows:
        mask[y, max(0, a - 3):b + 4] = 1
    # tighten the edge a little (the key's soft fringe is mostly backdrop)
    alpha = np.clip((skin * mask - 0.25) / 0.75, 0, 1)
    # un-mix the white backdrop from semi-transparent edge pixels
    a3 = np.maximum(alpha, 0.35)[..., None]
    rgb = np.clip((src - (1 - a3) * BG) / a3, 0, 255)
    rgb = np.where(alpha[..., None] >= 0.999, src, rgb)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    # rotate about the tip so the axis is vertical
    tip_x = c0 + k * tip_y
    im = im.rotate(-ang, resample=Image.BICUBIC, center=(tip_x, tip_y))
    pad = int(width * 0.2)
    box = (int(tip_x - width / 2 - pad), tip_y - 4, int(tip_x + width / 2 + pad), yb)
    im = im.crop(box)
    # fill the transparent area with nearby skin colour, so resampling and
    # sharpening can't pull backdrop white into the edge; shave 1 px off the edge
    arr = np.asarray(im).astype(np.float32)
    al = arr[..., 3:] / 255
    fill = arr[..., :3].copy()
    for r in (2, 5, 12):
        num = np.asarray(Image.fromarray((arr[..., :3] * al).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32)
        den = np.asarray(Image.fromarray((al[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32)[..., None] / 255
        est = num / np.maximum(den, 1e-3)
        fill = np.where((al < 0.98) & (den > 0.02), est if r == 2 else np.where(fill.sum(2, keepdims=True) > 0, fill, est), fill)
    fill = np.where(al >= 0.98, arr[..., :3], fill)
    ero = np.asarray(Image.fromarray(arr[..., 3].astype(np.uint8)).filter(ImageFilter.MinFilter(3))).astype(np.float32)
    im = Image.fromarray(np.dstack([np.clip(fill, 0, 255), ero]).astype(np.uint8), 'RGBA')
    im = im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)
    # gentle unsharp to offset the upscale, and a hair of edge feather
    rgb = im.convert('RGB').filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    a = im.getchannel('A').filter(ImageFilter.GaussianBlur(1.0))
    im = Image.merge('RGBA', (*rgb.split(), a))
    im.save(os.path.join(out_dir, f'finger_{name}.webp'), 'WEBP', quality=90, method=6)
    meta[name] = dict(w=round(width * SCALE, 1), tip=[round(im.width / 2, 1), round(4 * SCALE, 1)],
                      stretch=[round((v - box[1]) * SCALE) for v in f['stretch']])
    print(name, 'angle', round(float(ang), 2), 'size', im.size)
print(json.dumps(meta))
