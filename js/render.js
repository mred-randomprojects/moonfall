// Rendering: parallax scenery, moonlight, rooms, entities, particles.
(function (MF) {
  'use strict';
  const { clamp, lerp, rand, seeded } = MF.util;
  const { VIEW_W, VIEW_H, GROUND_Y } = MF.world;
  const TAU = Math.PI * 2;

  const R = {
    canvas: null, ctx: null, dpr: 1,
    roomLayers: {},            // id -> offscreen canvas
    motes: [], mist: [],
    reduceMotion: false,
  };

  function init(canvas) {
    R.canvas = canvas; R.ctx = canvas.getContext('2d', { alpha: false });
    resize();
    window.addEventListener('resize', resize);
    // ambient particles (screen space)
    for (let i = 0; i < 46; i++) R.motes.push({ x: rand(0, VIEW_W), y: rand(0, VIEW_H), s: rand(0.8, 2.2), p: rand(0, TAU), v: rand(4, 14), a: rand(0.25, 0.7) });
    for (let i = 0; i < 4; i++) R.mist.push({ x: rand(0, VIEW_W), y: rand(380, 620), w: rand(500, 900), h: rand(90, 160), v: rand(6, 14) * (i % 2 ? 1 : -1), p: rand(0, TAU) });
    R.reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function resize() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    R.dpr = dpr;
    R.canvas.width = Math.round(VIEW_W * dpr); R.canvas.height = Math.round(VIEW_H * dpr);
  }

  // ------------------------------------------------------------------ static room layer
  function stoneBlock(ctx, x, y, w, h, pal, rng, opts) {
    const top = opts && opts.top !== false;
    // body
    const g = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 220));
    g.addColorStop(0, pal.stone); g.addColorStop(1, pal.stoneDark);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // bricks
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const rowH = 26, bw = 64;
    for (let ry = y + (top ? 8 : 0), row = 0; ry < y + h; ry += rowH, row++) {
      const off = (row % 2) * bw / 2 + Math.floor(rng() * 8);
      for (let bx = x - bw + off; bx < x + w; bx += bw) {
        const shade = rng();
        if (shade < 0.16) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(bx + 1, ry + 1, bw - 2, rowH - 2); }
        else if (shade > 0.86) { ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fillRect(bx + 1, ry + 1, bw - 2, rowH - 2); }
        if (opts && opts.cracks && rng() < 0.08) {
          ctx.strokeStyle = opts.cracks; ctx.lineWidth = 1.5; ctx.beginPath();
          const cx = bx + rng() * bw, cy = ry + rng() * rowH;
          ctx.moveTo(cx, cy); ctx.lineTo(cx + rng() * 14 - 7, cy + rng() * 16); ctx.lineTo(cx + rng() * 18 - 9, cy + rng() * 22); ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, ry + rowH - 0.5); ctx.lineTo(x + w, ry + rowH - 0.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      for (let bx = x - bw + off; bx < x + w; bx += bw) { ctx.beginPath(); ctx.moveTo(bx + 0.5, ry); ctx.lineTo(bx + 0.5, ry + rowH); ctx.stroke(); }
    }
    ctx.restore();
    // side highlights and shading
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + w - 3, y, 3, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, y, 2, h);
    if (top) {
      // moonlit top edge: the readable "you can stand here" cue
      ctx.fillStyle = pal.edge; ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y + 3, w, 2);
      ctx.fillStyle = pal.stoneLight; ctx.globalAlpha = 0.55; ctx.fillRect(x, y + 5, w, 4); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, y + 9, w, 2);
      // moss tufts
      const n = Math.floor(w / 46);
      for (let i = 0; i < n; i++) {
        if (rng() < 0.45) continue;
        const mx = x + 8 + rng() * (w - 16), mw = 8 + rng() * 22;
        ctx.fillStyle = pal.moss; ctx.globalAlpha = 0.55 + rng() * 0.3;
        ctx.beginPath(); ctx.ellipse(mx, y + 2, mw / 2, 3 + rng() * 3, 0, Math.PI, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // bottom shadow for floating platforms
    if (opts && opts.floating) {
      const sg = ctx.createLinearGradient(0, y + h, 0, y + h + 26);
      sg.addColorStop(0, 'rgba(0,0,0,0.35)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.fillRect(x + 4, y + h, w - 8, 26);
      // little corbels
      ctx.fillStyle = pal.stoneDark;
      for (const bx of [x + 14, x + w - 24]) { ctx.beginPath(); ctx.moveTo(bx, y + h); ctx.lineTo(bx + 10, y + h); ctx.lineTo(bx + 5, y + h + 12); ctx.closePath(); ctx.fill(); }
    }
  }

  function drawColumn(ctx, x, baseY, h, pal, rng, broken) {
    const w = 24;
    ctx.save();
    // shaft: dark with a faint moonlit rim so it recedes behind the lit platforms
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.35, pal.stoneDark); g.addColorStop(0.7, pal.stoneDark); g.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = pal.stoneDark; ctx.fillRect(x - w / 2, baseY - h, w, h);
    ctx.fillStyle = g; ctx.fillRect(x - w / 2, baseY - h, w, h);
    // drum joints
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let yy = baseY - 30; yy > baseY - h + 10; yy -= 30 + Math.floor(rng() * 12)) ctx.fillRect(x - w / 2, yy, w, 2);
    // fluting
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let i = 1; i < 4; i++) ctx.fillRect(x - w / 2 + i * (w / 4), baseY - h + 6, 1, h - 12);
    ctx.fillStyle = pal.stoneLight; ctx.globalAlpha = 0.28; ctx.fillRect(x - w / 2 + 2, baseY - h + 4, 2, h - 8); ctx.globalAlpha = 1;
    // base plinth
    ctx.fillStyle = pal.stoneDark; ctx.fillRect(x - w / 2 - 7, baseY - 12, w + 14, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - w / 2 - 7, baseY - 12, w + 14, 2);
    if (broken) {
      // jagged snapped top
      ctx.fillStyle = pal.stoneDark; ctx.beginPath();
      ctx.moveTo(x - w / 2, baseY - h + 1);
      let px = x - w / 2;
      while (px < x + w / 2) { const nx = Math.min(x + w / 2, px + 4 + rng() * 6); ctx.lineTo(nx, baseY - h - rng() * 14); px = nx; }
      ctx.lineTo(x + w / 2, baseY - h + 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - w / 2, baseY - h + 1, w, 3);
    } else {
      // capital
      ctx.fillStyle = pal.stoneDark; ctx.fillRect(x - w / 2 - 7, baseY - h - 10, w + 14, 10);
      ctx.fillStyle = pal.stoneLight; ctx.globalAlpha = 0.35; ctx.fillRect(x - w / 2 - 7, baseY - h - 10, w + 14, 2); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - w / 2 - 4, baseY - h - 4, w + 8, 4);
    }
    ctx.restore();
  }

  function drawArch(ctx, x, baseY, w, h, pal) {
    ctx.strokeStyle = pal.stone; ctx.lineWidth = 14; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x - w / 2, baseY); ctx.lineTo(x - w / 2, baseY - h + w / 2);
    ctx.quadraticCurveTo(x - w / 2, baseY - h - 10, x, baseY - h - 10);
    ctx.quadraticCurveTo(x + w / 2, baseY - h - 10, x + w / 2, baseY - h + w / 2);
    ctx.lineTo(x + w / 2, baseY); ctx.stroke();
    ctx.strokeStyle = pal.stoneLight; ctx.lineWidth = 2; ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 6, baseY); ctx.lineTo(x - w / 2 - 6, baseY - h + w / 2);
    ctx.quadraticCurveTo(x - w / 2 - 6, baseY - h - 17, x, baseY - h - 17);
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  function drawWindow(ctx, x, y, w, h, color) {
    ctx.save();
    ctx.fillStyle = color; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(x - w / 2, y + h); ctx.lineTo(x - w / 2, y + w / 2); ctx.quadraticCurveTo(x - w / 2, y, x, y); ctx.quadraticCurveTo(x + w / 2, y, x + w / 2, y + w / 2); ctx.lineTo(x + w / 2, y + h); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35;
    const g = ctx.createRadialGradient(x, y + h / 2, 2, x, y + h / 2, w * 1.6); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - w * 2, y - w, w * 4, h + w * 2);
    ctx.restore();
  }

  function drawVine(ctx, x, y, len, rng, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(x, y);
    let cx = x, cy = y;
    for (let i = 0; i < len / 14; i++) { cx += rng() * 6 - 3; cy += 14; ctx.lineTo(cx, cy); }
    ctx.stroke();
    ctx.fillStyle = color;
    for (let i = 0; i < len / 14; i++) { const lx = x + rng() * 8 - 4, ly = y + i * 14 + rng() * 8; ctx.beginPath(); ctx.ellipse(lx, ly, 3.5, 2, rng() * TAU, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  function buildRoomLayer(room) {
    const c = document.createElement('canvas');
    c.width = room.width; c.height = room.height + 60;
    const ctx = c.getContext('2d');
    const pal = room.palette, rng = seeded(room.seed * 7919);
    const grounds = room.solids.filter((s) => s.type === 'ground');
    const plats = room.solids.filter((s) => s.type === 'platform');

    // --- decor behind everything: columns, arches, windows, rubble
    for (const g of grounds) {
      let x = g.x + 60 + rng() * 120;
      while (x < g.x + g.w - 60) {
        const kind = rng();
        if (kind < 0.42) drawColumn(ctx, x, g.y, 110 + rng() * 170, pal, rng, rng() < 0.6);
        else if (kind < 0.62) { const w = 90 + rng() * 60; if (x + w < g.x + g.w - 40) { drawArch(ctx, x + w / 2, g.y, w, 150 + rng() * 90, pal); x += w; } }
        else if (kind < 0.8) {
          // wall fragment with a glowing window
          const w = 70 + rng() * 60, h = 120 + rng() * 120;
          ctx.fillStyle = pal.stoneDark; ctx.fillRect(x, g.y - h, w, h);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          for (let yy = g.y - h + 18; yy < g.y; yy += 22) { ctx.fillRect(x, yy, w, 1); for (let bx = x + ((yy / 22 | 0) % 2) * 16; bx < x + w; bx += 34) ctx.fillRect(bx, yy - 22, 1, 22); }
          ctx.fillStyle = pal.stoneLight; ctx.globalAlpha = 0.18; ctx.fillRect(x, g.y - h, w, 2); ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x + w - 2, g.y - h, 2, h);
          if (rng() < 0.7) drawWindow(ctx, x + w / 2, g.y - h + 20, 18, 42, room.id === 'crypt' ? 'rgba(255,150,60,0.9)' : room.id === 'aqueduct' ? 'rgba(120,220,230,0.8)' : 'rgba(255,190,110,0.85)');
          x += w;
        } else {
          // rubble
          ctx.fillStyle = pal.stoneDark;
          for (let i = 0; i < 4; i++) { const rw = 10 + rng() * 22, rh = 6 + rng() * 10; ctx.fillRect(x + i * 12 + rng() * 8, g.y - rh, rw, rh); }
        }
        x += 120 + rng() * 220;
      }
    }
    // --- ground and platforms
    for (const g of grounds) stoneBlock(ctx, g.x, g.y, g.w, g.h, pal, rng, { top: true, cracks: pal.cracks });
    for (const p of plats) {
      stoneBlock(ctx, p.x, p.y, p.w, p.h, pal, rng, { top: true, floating: true, cracks: pal.cracks });
      if (rng() < 0.5) drawVine(ctx, p.x + 10 + rng() * (p.w - 20), p.y + p.h, 40 + rng() * 60, rng, pal.moss);
    }
    // --- gap edges: emphasise drop-offs
    for (const g of grounds) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      const eg = ctx.createLinearGradient(g.x + g.w, 0, g.x + g.w + 60, 0); eg.addColorStop(0, 'rgba(0,0,0,0.45)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eg; ctx.fillRect(g.x + g.w, g.y, 60, g.h);
      const eg2 = ctx.createLinearGradient(g.x, 0, g.x - 60, 0); eg2.addColorStop(0, 'rgba(0,0,0,0.45)'); eg2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eg2; ctx.fillRect(g.x - 60, g.y, 60, g.h);
    }
    return c;
  }

  function roomLayer(room) {
    if (!R.roomLayers[room.id]) R.roomLayers[room.id] = buildRoomLayer(room);
    return R.roomLayers[room.id];
  }

  // ------------------------------------------------------------------ background
  function drawSky(ctx, cam, room, time) {
    const pal = room.palette;
    const sky = MF.sprites.images.sky;
    ctx.fillStyle = '#0b1226'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const s = 0.9, w = sky.width * s, h = sky.height * s;
    const sx = -60 - cam.x * 0.06, sy = 20 - cam.y * 0.03;
    ctx.drawImage(sky, sx, sy, w, h);
    // room tint
    if (pal.tintMode) {
      ctx.save(); ctx.globalCompositeOperation = pal.tintMode; ctx.fillStyle = pal.tint; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.restore();
    }
    // moon over the painted one
    const mx = sx + 1420 * s, my = sy + 90 * s;
    drawMoon(ctx, mx, my, pal.moon, time);
    return { mx, my };
  }

  function drawMoon(ctx, mx, my, strength, time) {
    const flick = 1 + Math.sin(time * 0.7) * 0.05 + Math.sin(time * 2.3) * 0.02;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // wide halo
    let g = ctx.createRadialGradient(mx, my, 40, mx, my, 420);
    g.addColorStop(0, `rgba(190,205,255,${0.28 * strength * flick})`); g.addColorStop(0.35, `rgba(150,170,230,${0.10 * strength})`); g.addColorStop(1, 'rgba(120,140,200,0)');
    ctx.fillStyle = g; ctx.fillRect(mx - 420, my - 420, 840, 840);
    // bloom
    g = ctx.createRadialGradient(mx, my, 30, mx, my, 130);
    g.addColorStop(0, `rgba(230,238,255,${0.55 * strength})`); g.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = g; ctx.fillRect(mx - 130, my - 130, 260, 260);
    ctx.restore();
    // disc with limb shading and faint maria
    ctx.save();
    g = ctx.createRadialGradient(mx - 16, my - 16, 6, mx, my, 58);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#eef2fb'); g.addColorStop(0.85, '#cfd9ee'); g.addColorStop(1, '#aab7d4');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, 56, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(150,165,200,0.16)';
    for (const [dx, dy, r] of [[-18, 10, 13], [14, -18, 8], [20, 18, 14], [-8, -24, 6], [2, 26, 6], [-30, -6, 7], [26, -2, 5]]) { ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(130,145,190,0.12)';
    for (const [dx, dy, r] of [[-20, 12, 6], [22, 16, 7], [12, -20, 4]]) { ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, TAU); ctx.fill(); }
    // dim the disc in rooms with weaker moonlight
    if (strength < 1) { ctx.fillStyle = `rgba(30,40,80,${(1 - strength) * 0.55})`; ctx.beginPath(); ctx.arc(mx, my, 56, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // Broad translucent rays are pre-rendered once (soft-edged via nested wedges) and then
  // drawn rotated/pulsing each frame, which is far cheaper than per-frame gradients.
  const RAYS = { canvas: null, ox: 1500, oy: 100 };
  function buildRays() {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(RAYS.ox, RAYS.oy);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = 0.60 * Math.PI + (i / (n - 1)) * 0.52 * Math.PI;
      const width = 0.035 + ((i * 7) % 3) * 0.014;
      const alpha = 0.16 + ((i * 5) % 3) * 0.05;
      const steps = 7;
      for (let k = 1; k <= steps; k++) {
        const w = width * (k / steps);
        const g = ctx.createLinearGradient(0, 0, Math.cos(a) * 1500, Math.sin(a) * 1500);
        const al = alpha / steps;
        g.addColorStop(0, `rgba(200,215,255,${al})`); g.addColorStop(0.55, `rgba(200,215,255,${al * 0.55})`); g.addColorStop(1, 'rgba(200,215,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a - w) * 1600, Math.sin(a - w) * 1600);
        ctx.lineTo(Math.cos(a + w) * 1600, Math.sin(a + w) * 1600);
        ctx.closePath(); ctx.fill();
      }
    }
    RAYS.canvas = c;
  }
  function drawMoonRays(ctx, mx, my, strength, time) {
    if (strength <= 0.3) return;
    if (!RAYS.canvas) buildRays();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp((0.55 + 0.12 * Math.sin(time * 0.45) + 0.05 * Math.sin(time * 1.7)) * strength, 0, 1);
    ctx.translate(mx, my); ctx.rotate(Math.sin(time * 0.08) * 0.03);
    ctx.drawImage(RAYS.canvas, -RAYS.ox, -RAYS.oy);
    ctx.restore();
  }

  function drawMid(ctx, cam, room, time) {
    const im = MF.sprites.images.mid;
    const s = 0.62, w = im.width * s, h = im.height * s;
    const y = (GROUND_Y - cam.y * 0.55) - h + 46;
    const off = ((-cam.x * 0.35) % w + w) % w;
    ctx.save(); ctx.globalAlpha = 0.92;
    for (let i = -1; i < 3; i++) {
      const x = off + i * w;
      if (x > VIEW_W || x + w < 0) continue;
      const idx = Math.floor((x - off) / w + 1000);
      if (idx % 2) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, w, h); ctx.restore(); }
      else ctx.drawImage(im, x, y, w, h);
    }
    ctx.restore();
  }

  function drawMist(ctx, cam, room, time) {
    ctx.save();
    for (const m of R.mist) {
      const x = ((m.x + time * m.v - cam.x * 0.5) % (VIEW_W + m.w) + VIEW_W + m.w) % (VIEW_W + m.w) - m.w / 2;
      const y = m.y - cam.y * 0.6 + Math.sin(time * 0.3 + m.p) * 12;
      const g = ctx.createRadialGradient(x, y, 0, x, y, m.w / 2);
      g.addColorStop(0, room.palette.mist); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(x, y); ctx.scale(1, m.h / m.w); ctx.beginPath(); ctx.arc(0, 0, m.w / 2, 0, TAU); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  }

  function drawMotes(ctx, cam, time) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const m of R.motes) {
      const x = ((m.x + Math.sin(time * 0.4 + m.p) * 30 - cam.x * 0.45) % VIEW_W + VIEW_W) % VIEW_W;
      const y = ((m.y - time * m.v - cam.y * 0.45) % VIEW_H + VIEW_H) % VIEW_H;
      const a = m.a * (0.6 + 0.4 * Math.sin(time * 1.7 + m.p));
      ctx.fillStyle = `rgba(210,225,255,${a})`;
      ctx.beginPath(); ctx.arc(x, y, m.s, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Nearest layer: sparse arch fragments with hanging vines along the top edge and a low rubble
  // strip along the bottom edge. Both move faster than the camera and stay out of the action.
  function drawFront(ctx, cam, room) {
    const L = MF.sprites.images.frontL, Rr = MF.sprites.images.frontR, rub = MF.sprites.images.frontRubble;
    const f = 1.35, s = 0.9;
    ctx.save();
    // top vines
    const period = 2300;
    const off = ((-cam.x * f) % period + period) % period;
    const ty = -14 - cam.y * 0.25;
    ctx.globalAlpha = 0.9;
    for (let i = -1; i < 2; i++) {
      const x = off + i * period;
      if (x + L.width * s > -20 && x < VIEW_W + 20) ctx.drawImage(L, x, ty, L.width * s, L.height * s);
      const xr = x + 1180;
      if (xr + Rr.width * s > -20 && xr < VIEW_W + 20) ctx.drawImage(Rr, xr, ty - 6, Rr.width * s, Rr.height * s);
    }
    // bottom rubble
    const rs = 0.85, rw = rub.width * rs, rh = rub.height * rs, rp = rw + 700;
    const roff = ((-cam.x * f - 900) % rp + rp) % rp;
    const ry = VIEW_H - rh + 22 + (Math.max(0, room.height - VIEW_H) - cam.y) * 0.4;
    ctx.globalAlpha = 0.85;
    for (let i = -1; i < 2; i++) {
      const x = roff + i * rp;
      if (x + rw > 0 && x < VIEW_W) ctx.drawImage(rub, x, ry, rw, rh);
    }
    ctx.restore();
  }

  function drawVignette(ctx) {
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.45, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // ------------------------------------------------------------------ world objects
  function drawWater(ctx, room, time) {
    const pal = room.palette; if (!pal.water) return;
    const grounds = room.solids.filter((s) => s.type === 'ground').sort((a, b) => a.x - b.x);
    ctx.save();
    for (let i = 0; i < grounds.length - 1; i++) {
      const a = grounds[i], b = grounds[i + 1];
      const x0 = a.x + a.w, x1 = b.x, y = 705;
      const g = ctx.createLinearGradient(0, y, 0, room.height + 60);
      g.addColorStop(0, pal.water); g.addColorStop(1, 'rgba(20,40,60,0.9)');
      ctx.fillStyle = g; ctx.fillRect(x0, y, x1 - x0, room.height + 60 - y);
      ctx.strokeStyle = 'rgba(220,245,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath();
      for (let x = x0; x <= x1; x += 6) { const yy = y + Math.sin(x * 0.05 + time * 2.2) * 2 + Math.sin(x * 0.13 - time * 1.4) * 1.2; if (x === x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDoor(ctx, d, room, time, near) {
    const cx = d.x + d.w / 2, top = d.y, bottom = d.y + d.h, w = d.w;
    ctx.save();
    // stone frame
    ctx.fillStyle = room.palette.stoneDark;
    ctx.beginPath(); ctx.moveTo(cx - w / 2 - 12, bottom); ctx.lineTo(cx - w / 2 - 12, top + 30); ctx.quadraticCurveTo(cx - w / 2 - 12, top - 22, cx, top - 26); ctx.quadraticCurveTo(cx + w / 2 + 12, top - 22, cx + w / 2 + 12, top + 30); ctx.lineTo(cx + w / 2 + 12, bottom); ctx.closePath(); ctx.fill();
    // opening: dark with a glow
    const pulse = 0.75 + 0.25 * Math.sin(time * 2.2 + d.x);
    const inner = ctx.createLinearGradient(0, top, 0, bottom);
    inner.addColorStop(0, '#05070f'); inner.addColorStop(1, '#0a1020');
    ctx.fillStyle = inner;
    ctx.beginPath(); ctx.moveTo(cx - w / 2, bottom); ctx.lineTo(cx - w / 2, top + 34); ctx.quadraticCurveTo(cx - w / 2, top - 6, cx, top - 8); ctx.quadraticCurveTo(cx + w / 2, top - 6, cx + w / 2, top + 34); ctx.lineTo(cx + w / 2, bottom); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, bottom - 30, 4, cx, bottom - 30, w * 0.9);
    const glow = room.palette.glow;
    g.addColorStop(0, glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (near ? 1.0 : 0.6) * pulse; ctx.fillStyle = g; ctx.fillRect(cx - w, top - 20, w * 2, d.h + 40);
    // vertical light shafts
    ctx.globalAlpha = 0.18 * pulse;
    for (let i = 0; i < 3; i++) { const lx = cx - 22 + i * 22 + Math.sin(time + i) * 3; ctx.fillStyle = glow; ctx.fillRect(lx, top, 6, d.h); }
    ctx.restore();
    // rim highlight
    ctx.strokeStyle = room.palette.edge; ctx.globalAlpha = near ? 0.9 : 0.45; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - w / 2, bottom); ctx.lineTo(cx - w / 2, top + 34); ctx.quadraticCurveTo(cx - w / 2, top - 6, cx, top - 8); ctx.quadraticCurveTo(cx + w / 2, top - 6, cx + w / 2, top + 34); ctx.lineTo(cx + w / 2, bottom); ctx.stroke();
    // keystone
    ctx.globalAlpha = 1; ctx.fillStyle = room.palette.stoneLight; ctx.fillRect(cx - 7, top - 30, 14, 14);
    ctx.restore();
  }

  function drawEmber(ctx, e, time) {
    if (e.collected) return;
    const bob = Math.sin(time * 2.4 + e.x) * 6;
    const x = e.x, y = e.y + bob;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.85 + 0.15 * Math.sin(time * 5);
    let g = ctx.createRadialGradient(x, y, 2, x, y, 70);
    g.addColorStop(0, `rgba(255,190,90,${0.55 * pulse})`); g.addColorStop(0.4, 'rgba(255,140,50,0.18)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 70, y - 70, 140, 140);
    // flame body
    for (let i = 0; i < 3; i++) {
      const fl = Math.sin(time * 9 + i * 2) * 2;
      g = ctx.createRadialGradient(x, y + 2, 1, x, y, 16 - i * 4);
      g.addColorStop(0, i === 2 ? '#fff8e0' : i === 1 ? '#ffd27a' : '#ff9a3c'); g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x - 12 + i * 3, y + 8); ctx.quadraticCurveTo(x - 10 + i * 2, y - 8 + fl, x + fl * 0.5, y - 24 + i * 5 + fl); ctx.quadraticCurveTo(x + 10 - i * 2, y - 8 - fl, x + 12 - i * 3, y + 8); ctx.closePath(); ctx.fill();
    }
    // orbiting sparkles
    ctx.fillStyle = '#ffe9b0';
    for (let i = 0; i < 3; i++) { const a = time * 2 + i * TAU / 3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 24, y + Math.sin(a) * 10 - 4, 2, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function drawBeacon(ctx, b, lit, time, near) {
    const x = b.x, y = b.y;
    ctx.save();
    // pedestal
    ctx.fillStyle = '#1c2236'; ctx.fillRect(x - 30, y - 30, 60, 30);
    ctx.fillStyle = '#2b3450'; ctx.fillRect(x - 24, y - 76, 48, 46);
    ctx.fillStyle = '#3d4a6b'; ctx.fillRect(x - 36, y - 84, 72, 10);
    ctx.fillStyle = '#c9d4ee'; ctx.globalAlpha = 0.6; ctx.fillRect(x - 36, y - 84, 72, 2); ctx.globalAlpha = 1;
    // bowl
    ctx.fillStyle = '#242b44'; ctx.beginPath(); ctx.moveTo(x - 40, y - 90); ctx.lineTo(x + 40, y - 90); ctx.lineTo(x + 26, y - 116); ctx.lineTo(x - 26, y - 116); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d9b45a'; ctx.lineWidth = 2; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    if (lit) {
      const f = 1 + Math.sin(time * 11) * 0.08 + Math.sin(time * 23) * 0.04;
      let g = ctx.createRadialGradient(x, y - 130, 10, x, y - 130, 260 * f);
      g.addColorStop(0, 'rgba(255,200,110,0.55)'); g.addColorStop(0.4, 'rgba(255,140,60,0.18)'); g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 260, y - 400, 520, 520);
      for (let i = 0; i < 4; i++) {
        const fl = Math.sin(time * 8 + i * 1.7) * 6;
        g = ctx.createRadialGradient(x, y - 118, 2, x, y - 130, 60 - i * 12);
        g.addColorStop(0, ['#ff9a3c', '#ffd27a', '#fff2c0', '#ffffff'][i]); g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g; ctx.beginPath();
        ctx.moveTo(x - 30 + i * 6, y - 112); ctx.quadraticCurveTo(x - 24 + i * 4 + fl, y - 150, x + fl, y - 200 + i * 18 + fl);
        ctx.quadraticCurveTo(x + 24 - i * 4 - fl, y - 150, x + 30 - i * 6, y - 112); ctx.closePath(); ctx.fill();
      }
    } else {
      const p = 0.5 + 0.5 * Math.sin(time * 2);
      const g = ctx.createRadialGradient(x, y - 116, 2, x, y - 116, 70);
      g.addColorStop(0, `rgba(140,180,255,${(near ? 0.5 : 0.28) * (0.6 + 0.4 * p)})`); g.addColorStop(1, 'rgba(100,140,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 70, y - 190, 140, 140);
      ctx.fillStyle = 'rgba(160,200,255,0.5)';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x - 16 + i * 8, y - 114 + Math.sin(time * 3 + i) * 2, 2, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }

  function drawSentinel(ctx, e, time) {
    if (e.dead) return;
    const x = e.x, y = e.y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let g = ctx.createRadialGradient(x, y, 4, x, y, 70);
    g.addColorStop(0, 'rgba(90,230,255,0.35)'); g.addColorStop(1, 'rgba(60,180,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 70, y - 70, 140, 140);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    // outer rotating shell (two counter-rotating diamonds)
    for (let k = 0; k < 2; k++) {
      ctx.save(); ctx.rotate((k ? -1 : 1) * e.rot * 0.8 + k * 0.6);
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(18, 0); ctx.lineTo(0, 30); ctx.lineTo(-18, 0); ctx.closePath();
      ctx.fillStyle = e.flash > 0 ? 'rgba(255,255,255,0.9)' : k ? 'rgba(90,200,240,0.28)' : 'rgba(60,150,220,0.4)';
      ctx.fill();
      ctx.strokeStyle = e.flash > 0 ? '#ffffff' : '#9df3ff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    // core
    const pulse = 0.8 + 0.2 * Math.sin(time * 6 + e.phase);
    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createRadialGradient(0, 0, 1, 0, 0, 14);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, `rgba(160,255,255,${pulse})`); g.addColorStop(1, 'rgba(60,220,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
    ctx.restore();
    // health bar
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 18, y - 46, 36, 5);
    ctx.fillStyle = e.hp >= 3 ? '#8ff5ff' : e.hp === 2 ? '#ffd36b' : '#ff7a5c';
    ctx.fillRect(x - 17, y - 45, 34 * clamp(e.hp / e.maxHp, 0, 1), 3);
    ctx.restore();
  }

  function drawArrow(ctx, a) {
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(a.angle);
    if (a.stuck) ctx.globalAlpha = clamp(a.stuckT / 0.6, 0, 1);
    ctx.strokeStyle = '#d8c29a'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-a.len / 2, 0); ctx.lineTo(a.len / 2 - 6, 0); ctx.stroke();
    ctx.fillStyle = '#e8eef8'; ctx.beginPath(); ctx.moveTo(a.len / 2, 0); ctx.lineTo(a.len / 2 - 9, -3.5); ctx.lineTo(a.len / 2 - 9, 3.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8433a'; ctx.beginPath(); ctx.moveTo(-a.len / 2, 0); ctx.lineTo(-a.len / 2 + 8, -4); ctx.lineTo(-a.len / 2 + 11, 0); ctx.lineTo(-a.len / 2 + 8, 4); ctx.closePath(); ctx.fill();
    if (!a.stuck && a.charge > 0.5) {
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,220,150,${(a.charge - 0.5) * 0.9})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-a.len / 2 - 26, 0); ctx.lineTo(-a.len / 2, 0); ctx.stroke();
    }
    ctx.restore();
  }

  function drawGrenade(ctx, g, time) {
    ctx.save();
    ctx.translate(g.x, g.y); ctx.rotate(g.rot);
    ctx.fillStyle = '#2a2f3a'; ctx.beginPath(); ctx.arc(0, 0, g.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#7c8699'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#4b5366'; ctx.fillRect(-3, -g.r - 4, 6, 5);
    ctx.restore();
    // fuse light: faster and hotter as it nears detonation
    const urgency = 1 - clamp(g.fuse / 1.4, 0, 1);
    const rate = 4 + urgency * 26;
    const on = Math.sin(time * rate) > (0.6 - urgency * 0.9);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const rad = 10 + urgency * 22;
    const gr = ctx.createRadialGradient(g.x, g.y, 1, g.x, g.y, rad);
    const a = on ? 0.9 : 0.25 + urgency * 0.3;
    gr.addColorStop(0, `rgba(255,${Math.round(200 - urgency * 120)},80,${a})`); gr.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = gr; ctx.fillRect(g.x - rad, g.y - rad, rad * 2, rad * 2);
    ctx.restore();
  }

  function drawPlayer(ctx, p, time, G) {
    const blink = p.invuln > 0 && Math.floor(time * 14) % 2 === 0 && p.hurtT <= 0;
    let alpha = blink ? 0.3 : 1;
    const opts = { alpha };
    if (p.bow.drawing || p.bow.releaseT >= 0) { opts.rot = p.bow.aim * 0.55; opts.pivotY = 62; }
    MF.sprites.drawFrame(ctx, p.anim.name, p.anim.frame, p.cx, p.feetY, p.facing, opts);
    // bow: aiming guide and charge readout
    if (p.bow.drawing) {
      const c = p.bow.charge;
      const sp = MF.entities.T.arrowMin + (MF.entities.T.arrowMax - MF.entities.T.arrowMin) * c;
      const ox = p.cx + p.facing * 26, oy = p.y + 38;
      let vx = Math.cos(p.bow.aim) * sp * p.facing, vy = Math.sin(p.bow.aim) * sp;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      let x = ox, y = oy;
      const step = 0.035;
      for (let i = 0; i < 14; i++) {
        x += vx * step; vy += 320 * step; y += vy * step;
        ctx.fillStyle = `rgba(255,225,160,${0.5 * (1 - i / 14)})`;
        ctx.beginPath(); ctx.arc(x, y, 2 + c * 1.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.font = '600 12px "Cinzel", Georgia, serif'; ctx.textAlign = 'center';
      ctx.fillStyle = c >= 0.98 ? '#ffe9a8' : '#e9e2d0'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
      ctx.fillText(Math.round(c * 100) + '%', p.cx, p.y - 14);
      ctx.restore();
    }
  }

  function drawParticles(ctx, list, layer) {
    for (const p of list) {
      if ((p.layer || 'front') !== layer) continue;
      const k = 1 - p.age / p.life;
      ctx.save();
      switch (p.type) {
        case 'dot': {
          ctx.globalCompositeOperation = p.lum ? 'lighter' : 'source-over';
          ctx.globalAlpha = k * (p.alpha || 1); ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.grow ? 1 + p.age / p.life * p.grow : 1), 0, TAU); ctx.fill(); break;
        }
        case 'spark': {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = k; ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke(); break;
        }
        case 'shard': {
          ctx.globalAlpha = k; ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.6, 0); ctx.lineTo(0, p.size); ctx.lineTo(-p.size * 0.6, 0); ctx.closePath(); ctx.fill();
          ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#bfffff'; ctx.lineWidth = 1; ctx.stroke(); break;
        }
        case 'debris': {
          ctx.globalAlpha = k; ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
          ctx.fillStyle = p.color; ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2); break;
        }
        case 'ring': {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = k * (p.alpha || 1);
          const t = p.age / p.life, r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - t, 2.2));
          ctx.strokeStyle = p.color; ctx.lineWidth = lerp(p.size, 1, t);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke(); break;
        }
        case 'flash': {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = k * (p.alpha || 1);
          const t = p.age / p.life, r = p.r0 + (p.r1 - p.r0) * Math.min(1, t * 2.5);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, p.color); g.addColorStop(p.mid || 0.4, p.color2 || p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); break;
        }
        case 'smoke': {
          ctx.globalAlpha = k * (p.alpha || 0.5);
          const r = p.size * (1 + p.age / p.life * 1.6);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); break;
        }
        case 'ghost': {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.34 * k;
          MF.sprites.drawFrame(ctx, p.anim, p.frame, p.x, p.y, p.facing, { alpha: 1 });
          break;
        }
        case 'slash': {
          ctx.globalCompositeOperation = 'lighter';
          const t = p.age / p.life;
          const sweep = Math.min(1, t / 0.45);
          const a0 = -1.35, a1 = a0 + 2.2 * sweep;
          ctx.translate(p.x, p.y); ctx.scale(p.facing, 1);
          ctx.globalAlpha = (1 - t) * 0.95;
          for (let i = 0; i < 3; i++) {
            ctx.strokeStyle = ['rgba(255,255,255,0.9)', 'rgba(190,225,255,0.7)', 'rgba(120,180,255,0.45)'][i];
            ctx.lineWidth = [5, 12, 22][i] * (1 - t * 0.5); ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(0, 0, p.r - i * 4, a0 + 0.1 * i, a1, false); ctx.stroke();
          }
          break;
        }
        case 'text': {
          ctx.globalAlpha = k; ctx.font = '600 16px "Cinzel", Georgia, serif'; ctx.textAlign = 'center';
          ctx.fillStyle = p.color; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6; ctx.fillText(p.text, p.x, p.y); break;
        }
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ frame
  function drawFrame(G) {
    const ctx = R.ctx, cam = G.cam, room = G.room, time = G.time;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

    const shakeX = G.fx.shakeX, shakeY = G.fx.shakeY;
    const camx = cam.x + shakeX, camy = cam.y + shakeY;
    const cs = { x: camx, y: camy };

    // 1. sky + moon (very slow parallax)
    const dbg = R.debug || {};
    const moon = drawSky(ctx, cs, room, time);
    // 2. distant ruins layer
    if (!dbg.noMid) drawMid(ctx, cs, room, time);
    if (!dbg.noRays) drawMoonRays(ctx, moon.mx, moon.my, room.palette.moon, time);
    if (!dbg.noMist) drawMist(ctx, cs, room, time);

    // 3. world space
    ctx.save();
    ctx.translate(-camx, -camy);
    drawWater(ctx, room, time);
    // static stone layer
    const layer = roomLayer(room);
    ctx.drawImage(layer, 0, 0);
    // doors
    for (const d of room.doors) drawDoor(ctx, d, room, time, G.nearDoor === d);
    if (room.beacon) drawBeacon(ctx, room.beacon, G.state.beaconLit, time, G.nearBeacon);
    drawParticles(ctx, G.particles.list, 'back');
    // ember
    drawEmber(ctx, G.emberObj, time);
    // enemies
    for (const e of G.enemies) drawSentinel(ctx, e, time);
    // projectiles
    for (const a of G.arrows) drawArrow(ctx, a);
    for (const g of G.grenades) drawGrenade(ctx, g, time);
    // player
    drawPlayer(ctx, G.player, time, G);
    drawParticles(ctx, G.particles.list, 'front');
    ctx.restore();

    // 4. foreground and framing
    if (!dbg.noMotes) drawMotes(ctx, cs, time);
    if (!dbg.noFront) drawFront(ctx, cs, room);
    if (!dbg.noVignette) drawVignette(ctx);

    // damage flash
    if (G.fx.damageFlash > 0) { ctx.fillStyle = `rgba(200,40,40,${G.fx.damageFlash * 0.35})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    // transition fade
    if (G.fx.fade > 0) { ctx.fillStyle = `rgba(2,3,8,${clamp(G.fx.fade, 0, 1)})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  }

  MF.render = R;
  R.init = init; R.drawFrame = drawFrame; R.roomLayer = roomLayer; R.drawSentinel = drawSentinel;
})(window.MF);
