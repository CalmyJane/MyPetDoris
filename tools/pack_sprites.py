# Packs the walk-cycle frames rendered by roach_blender.py into assets/roach.webp
# and prints the ROACH_SHEET values to paste into js/creatures.js.
#   python tools/pack_sprites.py <frames_dir> [stride]
# stride: foot travel per cycle in body lengths (roach_model.py: 0.4255 =
# 10 mm of the model's in-place walk / 23.5 mm body; roach_blender.py: 0.30)
import glob, json, os, sys
from PIL import Image

RES, CAM_SCALE, CAM_CX = 640, 2.6, 0.12  # keep in sync with the render scripts
STRIDE = float(sys.argv[2]) if len(sys.argv) > 2 else 0.4255

frames_dir = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'roach.webp')
fs = [Image.open(f).convert('RGBA') for f in sorted(glob.glob(os.path.join(frames_dir, 'roach_*.png')))]
bb = None
for im in fs:
    b = im.getchannel('A').point(lambda a: 255 if a > 3 else 0).getbbox()
    bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
pad = 4
bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(RES, bb[2] + pad), min(RES, bb[3] + pad))
w, h = bb[2] - bb[0], bb[3] - bb[1]
cols = 4
rows = (len(fs) + cols - 1) // cols
sheet = Image.new('RGBA', (w * cols, h * rows), (0, 0, 0, 0))
for i, im in enumerate(fs):
    sheet.paste(im.crop(bb), ((i % cols) * w, (i // cols) * h))
sheet.save(out, 'WEBP', quality=88, method=6)
ppl = RES / CAM_SCALE
meta = dict(frames=len(fs), cols=cols, fw=w, fh=h,
            ox=round((0 - (CAM_CX - CAM_SCALE / 2)) / CAM_SCALE * RES - bb[0], 2),
            oy=round(RES / 2 - bb[1], 2), ppl=round(ppl, 3), stride=STRIDE)
print(json.dumps(meta), os.path.getsize(out) // 1024, 'KB')
