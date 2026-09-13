#!/usr/bin/env python3
"""Split the foreground parallax sheet into sparse pieces that never sit in front of the action.

assets/parallax-front.png is a full-screen frame (pillars on both sides, vines at the top,
rubble along the bottom). Drawn whole, its pillars occlude the hero for seconds at a time,
so we cut it into edge pieces with faded cut lines:
  assets/sprites/front-vines-left.png   top-left arch + hanging vines (bottom edge faded)
  assets/sprites/front-vines-right.png  top-right arch + vines (bottom edge faded)
  assets/sprites/front-rubble.png       bottom rubble strip (top edge faded)
"""
from PIL import Image
import numpy as np, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'sprites')
os.makedirs(OUT, exist_ok=True)
im = Image.open(os.path.join(ROOT, 'assets', 'parallax-front.png')).convert('RGBA')
W, H = im.size
# The sheet's "empty" areas carry a faint dark haze (alpha ~5-25) that renders as a visible
# rectangle over the scene. Kill it and re-stretch the remaining alpha so edges stay smooth.
_a = np.array(im).astype(np.float32)
_a[:, :, 3] = np.clip((_a[:, :, 3] - 60) / (255 - 60), 0, 1) * 255
im = Image.fromarray(_a.astype(np.uint8), 'RGBA')

def fade(arr, axis_start, axis_end, vertical=True, start_alpha=1.0, end_alpha=0.0):
    a = arr.astype(np.float32)
    n = axis_end - axis_start
    ramp = np.linspace(start_alpha, end_alpha, n)
    if vertical:
        a[axis_start:axis_end, :, 3] *= ramp[:, None]
    else:
        a[:, axis_start:axis_end, 3] *= ramp[None, :]
    return np.clip(a, 0, 255).astype(np.uint8)

# top-left: arch + vines. Pillar body continues below; fade it out between y=250..360
tl = np.array(im.crop((0, 0, 360, 360)))
tl = fade(tl, 230, 360, vertical=True)
tl = fade(tl, 280, 360, vertical=False)          # soften the inner crop edge too
Image.fromarray(tl).save(os.path.join(OUT, 'front-vines-left.png'), optimize=True)

tr = np.array(im.crop((W - 380, 0, W, 360)))
tr = fade(tr, 230, 360, vertical=True)
tr = fade(tr, 0, 80, vertical=False, start_alpha=0.0, end_alpha=1.0)
Image.fromarray(tr).save(os.path.join(OUT, 'front-vines-right.png'), optimize=True)

# bottom rubble strip (full width), fade the top so the pillar stumps don't show a cut
rb = np.array(im.crop((0, H - 130, W, H)))
rb = fade(rb, 0, 60, vertical=True, start_alpha=0.0, end_alpha=1.0)
Image.fromarray(rb).save(os.path.join(OUT, 'front-rubble.png'), optimize=True)
print('wrote front pieces', tl.shape, tr.shape, rb.shape)
