// DOM HUD, minimap / full map, overlays, and the motion study inspector.
(function (MF) {
  'use strict';
  const { clamp } = MF.util;
  const { ROOMS, MAP_GRID, LINKS } = MF.world;
  const $ = (id) => document.getElementById(id);

  const UI = { el: {}, last: {}, study: null };

  function init() {
    const ids = ['stage', 'hud', 'hud-hearts', 'hud-room', 'hud-objective', 'hud-state', 'hud-embers', 'hud-bow', 'hud-bow-fill', 'hud-bow-val', 'hud-grenade', 'hud-grenade-fill', 'hud-grenade-val',
      'minimap', 'btn-mute', 'vol', 'btn-pause', 'btn-full', 'announce', 'announce-title', 'announce-sub', 'message', 'prompt', 'touch',
      'ov-entry', 'ov-status', 'btn-enter', 'ov-tip', 'ov-pause', 'set-vol', 'set-sound', 'set-shake', 'set-rumble', 'btn-resume', 'btn-restart', 'pause-note',
      'ov-map', 'map-stats', 'btn-map-close', 'bigmap', 'ov-victory', 'btn-again', 'ov-error', 'error-copy',
      'cards', 'inspector', 'insp-canvas', 'insp-name', 'insp-frame', 'insp-play', 'insp-scrub', 'insp-speeds', 'insp-download', 'insp-back', 'insp-note'];
    for (const id of ids) UI.el[id] = $(id);
    // hearts
    const hearts = UI.el['hud-hearts'];
    for (let i = 0; i < 5; i++) { const h = document.createElement('span'); h.className = 'heart'; hearts.appendChild(h); }
    updateStageScale();
    window.addEventListener('resize', updateStageScale);
    document.addEventListener('fullscreenchange', updateStageScale);
    if (window.ResizeObserver) new ResizeObserver(updateStageScale).observe(UI.el.stage);
  }

  function updateStageScale() {
    const st = UI.el.stage; if (!st) return;
    const r = st.getBoundingClientRect();
    const s = Math.min(r.width / 1280, r.height / 650) || 1;
    const ox = (r.width - 1280 * s) / 2, oy = (r.height - 650 * s) / 2;
    st.style.setProperty('--t', `translate(${ox}px, ${oy}px) scale(${s})`);
  }

  function set(id, text) {
    if (UI.last[id] === text) return;
    UI.last[id] = text; UI.el[id].textContent = text;
  }

  function updateHUD(G) {
    const p = G.player, s = G.state;
    const hearts = UI.el['hud-hearts'].children;
    for (let i = 0; i < 5; i++) hearts[i].classList.toggle('off', i >= p.hp);
    set('hud-room', G.room.name);
    const n = emberCount(s);
    set('hud-objective', n >= 4 ? 'Light the beacon in the Moonspire.' : 'Recover the four embers');
    set('hud-state', p.stateText);
    set('hud-embers', `${n} / 4 EMBERS`);
    // bow charge
    const bowVisible = p.bow.drawing;
    if (UI.last.bowVisible !== bowVisible) { UI.el['hud-bow'].hidden = !bowVisible; UI.last.bowVisible = bowVisible; }
    if (bowVisible) { UI.el['hud-bow-fill'].style.width = Math.round(p.bow.charge * 100) + '%'; set('hud-bow-val', Math.round(p.bow.charge * 100) + '%'); }
    // grenade cooldown
    const gVisible = p.grenade.cd > 0;
    if (UI.last.gVisible !== gVisible) { UI.el['hud-grenade'].hidden = !gVisible; UI.last.gVisible = gVisible; }
    if (gVisible) { UI.el['hud-grenade-fill'].style.width = Math.round((1 - p.grenade.cd / MF.entities.T.grenadeCd) * 100) + '%'; set('hud-grenade-val', p.grenade.cd.toFixed(1) + 's'); }
    // prompt
    let prompt = '';
    const dev = MF.input.lastDevice;
    const key = dev === 'touch' ? 'USE' : dev === 'gamepad' ? 'D-pad ↑' : 'E';
    if (G.nearDoor) prompt = `<span><b>${key}</b> Enter ${G.nearDoor.label}</span>`;
    else if (G.nearBeacon && !s.beaconLit) prompt = `<span><b>${key}</b> Light the beacon</span>`;
    if (UI.last.prompt !== prompt) { UI.last.prompt = prompt; UI.el.prompt.innerHTML = prompt; UI.el.prompt.hidden = !prompt; }
    drawMinimap(G);
  }

  function emberCount(s) { let n = 0; for (const k in s.embers) if (s.embers[k]) n++; return n; }

  let msgTimer = 0;
  function message(text, seconds) {
    const el = UI.el.message;
    el.innerHTML = `<span>${text}</span>`; el.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.hidden = true; }, (seconds || 2.4) * 1000);
  }

  function announce(room) {
    const el = UI.el.announce;
    UI.el['announce-title'].textContent = room.name.toUpperCase();
    UI.el['announce-sub'].textContent = room.sub;
    el.hidden = true; void el.offsetWidth; el.hidden = false; // restart the CSS animation
    clearTimeout(announce.t);
    announce.t = setTimeout(() => { el.hidden = true; }, 3300);
  }

  // ------------------------------------------------------------------ maps
  function roomBox(id, W, H, pad, gap) {
    const [gx, gy] = MAP_GRID[id];
    const bw = (W - pad * 2 - gap) / 2, bh = (H - pad * 2 - gap) / 2;
    return { x: pad + gx * (bw + gap), y: pad + gy * (bh + gap), w: bw, h: bh };
  }

  function drawMapInto(ctx, W, H, G, big) {
    const s = G.state, pad = big ? 30 : 8, gap = big ? 70 : 20;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    // links
    ctx.strokeStyle = 'rgba(190,205,235,0.35)'; ctx.lineWidth = big ? 3 : 2;
    for (const [a, b] of LINKS) {
      const A = roomBox(a, W, H, pad, gap), B = roomBox(b, W, H, pad, gap);
      const bothVisited = s.visited.has(a) && s.visited.has(b);
      ctx.setLineDash(bothVisited ? [] : [4, 4]);
      ctx.beginPath(); ctx.moveTo(A.x + A.w / 2, A.y + A.h / 2); ctx.lineTo(B.x + B.w / 2, B.y + B.h / 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const id in ROOMS) {
      const room = ROOMS[id], b = roomBox(id, W, H, pad, gap);
      const visited = s.visited.has(id), current = G.room.id === id;
      ctx.fillStyle = visited ? 'rgba(40,52,84,0.9)' : 'rgba(12,16,28,0.9)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      if (visited && big) {
        // simplified platform layout
        const sx = b.w / room.width, sy = b.h / room.height;
        ctx.fillStyle = 'rgba(190,205,235,0.55)';
        for (const p of room.solids) ctx.fillRect(b.x + p.x * sx, b.y + p.y * sy, Math.max(2, p.w * sx), Math.max(2, Math.min(p.h, 120) * sy));
        ctx.fillStyle = 'rgba(120,230,240,0.8)';
        for (const d of room.doors) ctx.fillRect(b.x + d.x * sx, b.y + d.y * sy, Math.max(3, d.w * sx), d.h * sy);
        if (room.beacon) { ctx.fillStyle = s.beaconLit ? '#ffb347' : '#8fb0ff'; ctx.beginPath(); ctx.arc(b.x + room.beacon.x * sx, b.y + (room.beacon.y - 60) * sy, 5, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.strokeStyle = current ? '#d9b45a' : visited ? 'rgba(190,205,235,0.6)' : 'rgba(120,130,160,0.5)';
      ctx.lineWidth = current ? (big ? 3 : 2) : 1;
      ctx.setLineDash(visited ? [] : [5, 4]);
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      ctx.setLineDash([]);
      // label
      if (big) {
        ctx.font = '600 15px "Cinzel", Georgia, serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = visited ? '#f2e9d6' : 'rgba(242,233,214,0.5)';
        ctx.fillText(visited ? room.name.toUpperCase() : 'UNEXPLORED', b.x + 10, b.y + 8);
        if (visited) { ctx.font = 'italic 12px Georgia, serif'; ctx.fillStyle = 'rgba(242,233,214,0.6)'; ctx.fillText(room.sub, b.x + 10, b.y + 28); }
      }
      // ember status
      if (visited) {
        const ex = big ? b.x + b.w - 22 : b.x + b.w - 10, ey = big ? b.y + 20 : b.y + 9;
        ctx.beginPath(); ctx.arc(ex, ey, big ? 7 : 4, 0, Math.PI * 2);
        if (s.embers[id]) { ctx.fillStyle = '#ffb347'; ctx.fill(); ctx.strokeStyle = '#ffe9b0'; ctx.lineWidth = 1; ctx.stroke(); }
        else { ctx.strokeStyle = '#d9b45a'; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (big) { ctx.font = '11px Georgia, serif'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(242,233,214,0.7)'; ctx.fillText(s.embers[id] ? 'ember recovered' : 'ember missing', ex - 12, ey - 6); }
      }
      // player
      if (current) {
        const px = b.x + clamp(G.player.cx / room.width, 0, 1) * b.w, py = b.y + clamp(G.player.feetY / room.height, 0, 1) * b.h;
        ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(px, py, big ? 6 : 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();
  }

  let minimapTick = 0;
  function drawMinimap(G) {
    if ((minimapTick++ % 3) !== 0) return;
    const c = UI.el.minimap; drawMapInto(c.getContext('2d'), c.width, c.height, G, false);
  }
  function drawBigMap(G) {
    const c = UI.el.bigmap; drawMapInto(c.getContext('2d'), c.width, c.height, G, true);
    const s = G.state;
    UI.el['map-stats'].textContent = `Regions explored ${s.visited.size} / 4 · Embers recovered ${emberCount(s)} / 4`;
  }

  function showOverlay(id) {
    for (const k of ['ov-entry', 'ov-pause', 'ov-map', 'ov-victory', 'ov-error']) UI.el[k].hidden = k !== id;
  }

  // ------------------------------------------------------------------ motion study
  function initStudy(onSelect, onBack) {
    const S = { cards: [], sel: null, playing: true, speed: 1, t: 0, frame: 0, onSelect, onBack };
    UI.study = S;
    const order = MF.sprites.ANIM_ORDER;
    for (const name of order) {
      const a = MF.sprites.anim(name); if (!a) continue;
      const card = document.createElement('div'); card.className = 'card'; card.dataset.anim = name;
      const cv = document.createElement('canvas'); cv.width = 180; cv.height = 180;
      card.appendChild(cv);
      const nm = document.createElement('div'); nm.className = 'card-name'; nm.textContent = MF.sprites.ANIM_LABEL[name]; card.appendChild(nm);
      const fr = document.createElement('div'); fr.className = 'card-frames'; fr.textContent = `${a.frames} frames · ${a.fps} fps`; card.appendChild(fr);
      card.addEventListener('click', () => select(name));
      UI.el.cards.appendChild(card);
      S.cards.push({ name, canvas: cv, ctx: cv.getContext('2d'), t: Math.random() * 3, el: card });
    }
    UI.el['insp-play'].addEventListener('click', () => { S.playing = !S.playing; UI.el['insp-play'].textContent = S.playing ? 'Pause' : 'Play'; });
    UI.el['insp-scrub'].addEventListener('input', () => { S.playing = false; UI.el['insp-play'].textContent = 'Play'; S.frame = +UI.el['insp-scrub'].value; S.t = S.frame / MF.sprites.anim(S.sel).fps; });
    UI.el['insp-speeds'].querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      S.speed = +b.dataset.speed; UI.el['insp-speeds'].querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    UI.el['insp-back'].addEventListener('click', () => { closeInspector(); if (S.onBack) S.onBack(); });

    function select(name) {
      S.sel = name; S.t = 0; S.frame = 0; S.playing = true; UI.el['insp-play'].textContent = 'Pause';
      const a = MF.sprites.anim(name);
      UI.el['insp-name'].textContent = MF.sprites.ANIM_LABEL[name];
      UI.el['insp-scrub'].max = a.frames - 1; UI.el['insp-scrub'].value = 0;
      UI.el['insp-download'].href = a.file; UI.el['insp-download'].download = a.file.split('/').pop();
      UI.el['insp-note'].textContent = `${MF.sprites.ANIM_DESC[name]}. ${a.frames} frames at ${a.fps} fps (${(a.frames / a.fps).toFixed(2)}s per cycle). Frames are anchored at the feet so the character keeps a stable footing across the strip.`;
      S.cards.forEach((c) => c.el.classList.toggle('on', c.name === name));
      UI.el.inspector.hidden = false;
      UI.el.inspector.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (S.onSelect) S.onSelect(name);
    }
    function closeInspector() {
      S.sel = null; UI.el.inspector.hidden = true;
      S.cards.forEach((c) => c.el.classList.remove('on'));
      UI.el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    S.select = select; S.close = closeInspector;
  }

  function drawStudyPreview(ctx, W, H, name, frame, scale) {
    ctx.clearRect(0, 0, W, H);
    // faint ground line
    ctx.strokeStyle = 'rgba(190,205,235,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W * 0.1, H * 0.82); ctx.lineTo(W * 0.9, H * 0.82); ctx.stroke();
    MF.sprites.drawFrame(ctx, name, frame, W / 2, H * 0.82, 1, { scale });
  }

  function updateStudy(dt, visible) {
    const S = UI.study; if (!S) return;
    // cards animate whenever on screen
    if (visible) for (const c of S.cards) {
      const a = MF.sprites.anim(c.name);
      c.t += dt;
      const f = Math.floor(c.t * a.fps) % a.frames;
      if (c.lastF !== f) { c.lastF = f; drawStudyPreview(c.ctx, c.canvas.width, c.canvas.height, c.name, f, 0.66); }
    }
    if (S.sel) {
      const a = MF.sprites.anim(S.sel);
      if (S.playing) { S.t += dt * S.speed; S.frame = Math.floor(S.t * a.fps) % a.frames; UI.el['insp-scrub'].value = S.frame; }
      const cv = UI.el['insp-canvas'];
      drawStudyPreview(cv.getContext('2d'), cv.width, cv.height, S.sel, S.frame, 1.55);
      set('insp-frame', `Frame ${S.frame + 1} / ${a.frames}`);
    }
  }

  MF.ui = UI;
  UI.init = init; UI.updateHUD = updateHUD; UI.message = message; UI.announce = announce; UI.showOverlay = showOverlay;
  UI.drawBigMap = drawBigMap; UI.initStudy = initStudy; UI.updateStudy = updateStudy; UI.emberCount = emberCount; UI.updateStageScale = updateStageScale;
})(window.MF);
