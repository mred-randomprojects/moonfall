#!/usr/bin/env python3
"""Build clean per-animation sprite strips for The Wanderer from the raw sheets.

Sources:
  assets/wanderer.png     6x5 grid, RGBA (soft halo + stray specks)  -> idle, jump, fall/land
  assets/wanderer-v2.png  6x6 grid, RGB with baked checkerboard       -> run, sword, bow, grenade

Outputs (assets/sprites/): one horizontal strip PNG per animation with a uniform
frame size and a stable foot anchor, plus js/spritedata.js with frame metadata.
"""
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'sprites')
os.makedirs(OUT, exist_ok=True)
FOUR = [[0,1,0],[1,1,1],[0,1,0]]

# ---------------------------------------------------------------- v1 (RGBA)
def load_v1():
    im = Image.open(os.path.join(ROOT, 'assets', 'wanderer.png')).convert('RGBA')
    a = np.array(im).astype(np.float32)
    alpha = a[:,:,3]
    # kill the faint drop-shadow halo, keep the anti-aliased edge, push body to fully opaque
    lo, hi = 48.0, 250.0
    na = np.clip((alpha - lo) / (hi - lo), 0, 1) * 255
    a[:,:,3] = na
    return a

# ---------------------------------------------------------------- v2 (checker)
BLADE_KEEP = {  # polygons (x,y) in sheet coords that must survive arc removal
    (2,5): [(1188,585),(1247,604),(1246,616),(1236,618),(1188,600)],
    (3,0): [(148,741),(206,745),(206,751),(148,756)],
    (3,1): [(370,732),(452,734),(461,740),(452,747),(370,748)],
    (3,2): [(533,788),(602,796),(602,807),(533,805)],
}
ARC_CELLS = list(BLADE_KEEP.keys())

def flood_from_border(m):
    lab, n = ndimage.label(m, structure=FOUR)
    bl = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:,0], lab[:,-1]]))); bl.discard(0)
    return np.isin(lab, list(bl)), lab, n, bl

def load_v2():
    im = Image.open(os.path.join(ROOT, 'assets', 'wanderer-v2.png')).convert('RGB')
    a = np.array(im).astype(np.int32)
    R,G,B = a[:,:,0],a[:,:,1],a[:,:,2]
    H,W,_ = a.shape
    mx = a.max(axis=2); mn = a.min(axis=2); sat = mx-mn
    cw = ch = W/6

    # 1. checkerboard reachable from the border
    keyish = (sat <= 8) & (mn >= 200)
    bg, lab, n, bl = flood_from_border(keyish)
    # enclosed checker pockets: bounded by dark outline, or two-tone checker texture
    pocket_ids = [i for i in range(1,n+1) if i not in bl]
    sizes = ndimage.sum(keyish, lab, pocket_ids)
    dark = mn < 110
    for pid, sz in zip(pocket_ids, sizes):
        if sz < 12: continue
        comp = lab == pid
        ring = ndimage.binary_dilation(comp, iterations=1) & ~comp
        dark_frac = dark[ring].mean() if ring.any() else 0
        vals = mn[comp]
        two_tone = (vals >= 245).mean() > 0.15 and (vals <= 236).mean() > 0.15
        if dark_frac >= 0.45 or (two_tone and sz >= 60 and dark_frac >= 0.25):
            bg |= comp

    # 2. painted slash arcs (translucent white/blue over checker) in four sword frames
    arc_region = np.zeros((H,W), bool)
    keep = np.zeros((H,W), bool)
    for (r,c), poly in BLADE_KEEP.items():
        arc_region[int(r*ch):int((r+1)*ch), int(c*cw):int((c+1)*cw)] = True
        pm = Image.new('L', (W,H), 0); ImageDraw.Draw(pm).polygon(poly, fill=255)
        keep |= np.array(pm) > 0
    neutral_light = (sat <= 9) & (mn >= 175)
    strong_blue = ((B - R) >= 30) & (B >= 150) & (mn >= 90)
    arcish = ((neutral_light | strong_blue) & arc_region & ~keep) | bg
    arc_bg, _, _, _ = flood_from_border(arcish)
    bg2 = bg | (arc_bg & arc_region & ~keep)
    lab3, n3 = ndimage.label(arcish & ~bg2 & arc_region, structure=FOUR)
    if n3:
        sz3 = ndimage.sum(np.ones_like(lab3), lab3, range(1,n3+1))
        near = ndimage.binary_dilation(bg2, iterations=2)
        for i in range(1,n3+1):
            comp = lab3 == i
            if sz3[i-1] >= 25 and (comp & near).any():
                bg2 |= comp & ~keep
    # thin light fringe left by the arcs
    fg = ~bg2
    opened = ndimage.binary_opening(fg, structure=np.ones((3,3),bool))
    thin = fg & ~opened & arc_region & (mn >= 110) & ~keep
    bg3 = bg2 | thin
    lightfringe = (mn >= 140) & (sat <= 50) & (B >= R) & arc_region & ~keep
    near_bg = ndimage.binary_dilation(bg3, iterations=2)
    cand = lightfringe & near_bg & ~bg3
    opened2 = ndimage.binary_opening((~bg3) & ~cand, structure=np.ones((3,3),bool))
    bg4 = bg3 | (cand & ~ndimage.binary_dilation(opened2, iterations=1))

    # 3. stray specks
    lab5, n5 = ndimage.label(~bg4)
    sz5 = ndimage.sum(np.ones_like(lab5), lab5, range(1,n5+1))
    for i in range(1,n5+1):
        if sz5[i-1] < 30: bg4 |= (lab5 == i)

    # 4. edge matting: pixels near the background are blends with the light checker.
    #    alpha = projection of (p-B) onto (F-B); colour = unmixed foreground.
    out = np.zeros((H,W,4), np.float32)
    out[:,:,:3] = a
    fgmask = ~bg4
    interior = ndimage.binary_erosion(fgmask, iterations=3)
    dist_bg, idx_bg = ndimage.distance_transform_edt(fgmask, return_indices=True)
    dist_in, idx_in = ndimage.distance_transform_edt(~interior, return_indices=True)
    band = fgmask & (dist_bg <= 3) & ~interior
    ys, xs = np.where(band)
    p = a[ys, xs].astype(np.float32)
    Bc = a[idx_bg[0][ys,xs], idx_bg[1][ys,xs]].astype(np.float32)
    Fc = a[idx_in[0][ys,xs], idx_in[1][ys,xs]].astype(np.float32)
    d = Fc - Bc
    denom = (d*d).sum(axis=1)
    alpha = np.where(denom > 1e-3, ((p - Bc) * d).sum(axis=1) / np.maximum(denom, 1e-3), 1.0)
    alpha = np.clip(alpha, 0, 1)
    # fade with distance so the outermost ring is soft, inner ring solid
    alpha = np.maximum(alpha, np.clip((3.5 - dist_bg[ys,xs]) / 3.5, 0, 1) * 0.0)
    a_safe = np.maximum(alpha, 0.2)[:,None]
    unmixed = (p - (1 - a_safe) * Bc) / a_safe
    col = np.where(alpha[:,None] >= 0.35, np.clip(unmixed, 0, 255), Fc)
    out[ys, xs, :3] = col
    out[:,:,3] = np.where(fgmask, 255, 0)
    out[ys, xs, 3] = alpha * 255
    return out

# ---------------------------------------------------------------- framing
def cell_components(arr, rows, cols, keep_secondary_min=2000):
    """Split a sheet into per-cell figures using connected components of the alpha mask."""
    alpha = arr[:,:,3]
    H,W = alpha.shape
    cw, ch = W/cols, H/rows
    mask = alpha > 8
    dil = ndimage.binary_dilation(mask, iterations=2)
    lab, n = ndimage.label(dil)
    sizes = ndimage.sum(mask, lab, range(1,n+1))
    objs = ndimage.find_objects(lab)
    cells = {}
    for i in range(n):
        o = objs[i]; cy=(o[0].start+o[0].stop)/2; cx=(o[1].start+o[1].stop)/2
        r, c = int(cy // ch), int(cx // cw)
        cells.setdefault((r,c), []).append((int(sizes[i]), i+1))
    frames = {}
    for (r,c), comps in cells.items():
        comps.sort(reverse=True)
        chosen = [comps[0][1]] + [i for s,i in comps[1:] if s >= keep_secondary_min]
        m = np.isin(lab, chosen) & mask
        ys, xs = np.where(m)
        y0,y1,x0,x1 = ys.min(), ys.max()+1, xs.min(), xs.max()+1
        sub = arr[y0:y1, x0:x1].copy()
        sub[:,:,3] *= m[y0:y1, x0:x1]
        frames[(r,c)] = sub
    return frames

def foot_anchor(frame, airborne=False, body=False):
    """(x, y) anchor in frame coords: bottom of the figure, x = centre of the lowest 18% of mass.

    body=True anchors x on the upper body (head to hips) instead: in a run cycle the feet swing
    forty-odd px either way, so pinning them made the body lurch sideways every few frames."""
    alpha = frame[:,:,3]
    m = alpha > 60
    ys, xs = np.where(m)
    bottom = ys.max() + 1
    top = ys.min()
    h = bottom - top
    if body:
        cx = xs[ys < top + h * 0.6].mean()
    elif airborne:
        # airborne poses tuck the feet; use the torso column (mass centre) and bbox bottom
        cx = xs.mean()
    else:
        band = ys >= bottom - max(6, int(h * 0.18))
        cx = xs[band].mean()
    return float(cx), float(bottom)

ANIMS = [
    # name, source, row, cols, airborne, fps[, anchor mode]
    ('idle',    'v1', [0], 6, False, 8),
    ('run',     'v2', [0,1], 6, False, 24, 'body'),
    ('sword',   'v2', [2,3], 6, False, 25),
    ('bow',     'v2', [4], 6, False, 12),
    ('grenade', 'v2', [5], 6, False, 12.5),
    ('jump',    'v1', [3], 6, True, 12),
    ('land',    'v1', [4], 6, False, 12),
]
FW, FH = 288, 260         # output frame size
AX, AY = 144, 236         # anchor (foot centre) inside the frame

def main():
    v1 = load_v1(); v2 = load_v2()
    f1 = cell_components(v1, 5, 6)
    f2 = cell_components(v2, 6, 6)
    meta = {}
    for name, src, rows, cols, airborne, fps, *mode in ANIMS:
        body = mode == ['body']
        frames = f1 if src == 'v1' else f2
        strip = np.zeros((FH, FW * cols * len(rows), 4), np.float32)
        info = []
        i = 0
        for r in rows:
            for c in range(cols):
                fr = frames[(r,c)]
                ax, ay = foot_anchor(fr, airborne=airborne and True, body=body)
                h, w = fr.shape[:2]
                ox = int(round(AX - ax)) + i * FW
                oy = int(round(AY - ay))
                # paste with clipping
                sx0, sy0 = max(0, -(ox - i*FW)), max(0, -oy)
                dx0, dy0 = ox + sx0, oy + sy0
                sx1 = min(w, FW - (ox - i*FW)); sy1 = min(h, FH - oy)
                if sx1 > sx0 and sy1 > sy0:
                    strip[dy0:dy0+(sy1-sy0), dx0:dx0+(sx1-sx0)] = fr[sy0:sy1, sx0:sx1]
                ys, xs = np.where(fr[:,:,3] > 60)
                info.append({'w': int(w), 'h': int(h), 'top': int(AY - ay + ys.min()), 'bottom': int(AY - ay + ys.max()+1)})
                i += 1
        img = Image.fromarray(np.clip(strip, 0, 255).astype(np.uint8), 'RGBA')
        img.save(os.path.join(OUT, f'wanderer-{name}.png'), optimize=True)
        meta[name] = {'file': f'assets/sprites/wanderer-{name}.png', 'frames': i, 'fw': FW, 'fh': FH,
                      'ax': AX, 'ay': AY, 'fps': fps, 'info': info}
        print(name, i, 'frames', [ (d['top'], d['bottom']) for d in info ])
    with open(os.path.join(ROOT, 'js', 'spritedata.js'), 'w') as f:
        f.write('// Generated by tools/build_sprites.py — do not edit by hand.\n')
        f.write('window.SPRITE_DATA = ' + json.dumps(meta, indent=1) + ';\n')

if __name__ == '__main__':
    main()
