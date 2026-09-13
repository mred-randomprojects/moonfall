#!/usr/bin/env python3
"""Draw the app icons (favicon, apple-touch-icon, PWA manifest icons) from scratch: a big moon
over the citadel's night sky with a single ember, so nothing depends on the sprite sheets.
Writes icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png, icons/apple-touch-icon.png."""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)


def draw(size, pad):
    """pad: fraction of the canvas kept clear around the art (maskable icons need ~0.1)."""
    S = size * 4  # supersample, then downscale for smooth edges
    im = Image.new('RGBA', (S, S), (7, 10, 20, 255))
    d = ImageDraw.Draw(im)
    # sky glow
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([S * 0.05, S * -0.15, S * 0.95, S * 0.75], fill=(23, 32, 64, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.12))
    im.alpha_composite(glow)
    # moon
    inner = 1 - 2 * pad
    r = S * 0.30 * inner
    cx, cy = S * 0.5, S * (0.40 + pad * 0.5)
    halo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse([cx - r * 1.35, cy - r * 1.35, cx + r * 1.35, cy + r * 1.35], fill=(242, 233, 214, 90))
    halo = halo.filter(ImageFilter.GaussianBlur(S * 0.05))
    im.alpha_composite(halo)
    d = ImageDraw.Draw(im)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(242, 233, 214, 255))
    # a few craters
    for fx, fy, fr in [(-0.35, -0.2, 0.16), (0.25, 0.1, 0.11), (-0.05, 0.45, 0.08), (0.42, -0.42, 0.07)]:
        d.ellipse([cx + fx * r - fr * r, cy + fy * r - fr * r, cx + fx * r + fr * r, cy + fy * r + fr * r], fill=(214, 202, 180, 255))
    # ground silhouette (ruined skyline)
    gy = S * (0.74 - pad * 0.4)
    d.rectangle([0, gy, S, S], fill=(10, 14, 28, 255))
    cols = [(0.12, 0.10, 0.06), (0.30, 0.16, 0.05), (0.62, 0.13, 0.07), (0.84, 0.08, 0.05)]
    for x, h, w in cols:
        x0, x1 = S * (x - w / 2), S * (x + w / 2)
        d.rectangle([x0, gy - S * h, x1, gy], fill=(10, 14, 28, 255))
    # ember
    ex, ey = S * 0.5, gy - S * 0.045
    er = S * 0.05
    eg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ed = ImageDraw.Draw(eg)
    ed.ellipse([ex - er * 2.4, ey - er * 2.4, ex + er * 2.4, ey + er * 2.4], fill=(255, 150, 60, 150))
    eg = eg.filter(ImageFilter.GaussianBlur(S * 0.03))
    im.alpha_composite(eg)
    d = ImageDraw.Draw(im)
    d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=(255, 190, 90, 255))
    d.ellipse([ex - er * 0.5, ey - er * 0.5, ex + er * 0.5, ey + er * 0.5], fill=(255, 240, 200, 255))
    return im.resize((size, size), Image.LANCZOS)


draw(192, 0.04).save(os.path.join(OUT, 'icon-192.png'))
draw(512, 0.04).save(os.path.join(OUT, 'icon-512.png'))
draw(512, 0.12).save(os.path.join(OUT, 'icon-maskable-512.png'))
draw(180, 0.04).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('icons written to', OUT)
