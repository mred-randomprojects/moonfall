// Game orchestration: state, rooms, transitions, combat resolution, effects, main loop.
(function (MF) {
  'use strict';
  const { clamp, rand, randInt, dist, pick, rectsOverlap, sign } = MF.util;
  const { ROOMS, GROUND_Y, VIEW_W, VIEW_H } = MF.world;
  const { T, Player, Sentinel, Arrow, Grenade, Particles } = MF.entities;
  const input = MF.input, audio = MF.audio, ui = MF.ui, render = MF.render;

  const STEP = 1 / 120;
  const SETTINGS_KEY = 'moonfall-settings-v1';

  const G = {
    mode: 'loading',          // loading | entry | playing | paused | map | transition | victory | inspector
    resumeMode: null,
    room: ROOMS.ruins, player: new Player(), enemies: [], arrows: [], grenades: [], particles: new Particles(),
    cam: { x: 0, y: 0 }, time: 0, emberObj: null, nearDoor: null, nearBeacon: false, doorLock: 0, restartHold: 0,
    state: null, audio, solids: [], touchUI: false,
    fx: {
      shakeAmp: 0, shakeX: 0, shakeY: 0, hitPauseT: 0, fade: 0, damageFlash: 0,
      settings: { volume: 0.7, muted: false, shake: !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), rumble: true },
      shake(a) { if (this.settings.shake) this.shakeAmp = Math.max(this.shakeAmp, a); },
      hitPause(s) { this.hitPauseT = Math.max(this.hitPauseT, s); },
      rumble(intensity, ms) {
        if (!this.settings.rumble) return;
        try {
          if (navigator.vibrate && input.lastDevice === 'touch') navigator.vibrate(Math.round(ms * clamp(intensity, 0.2, 1)));
          const pads = navigator.getGamepads ? navigator.getGamepads() : [];
          for (const gp of pads) {
            if (!gp) continue;
            const act = gp.vibrationActuator || (gp.hapticActuators && gp.hapticActuators[0]);
            if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(intensity, 0, 1), weakMagnitude: clamp(intensity * 0.6, 0, 1) }).catch(() => {});
            else if (act && act.pulse) act.pulse(clamp(intensity, 0, 1), ms).catch(() => {});
          }
        } catch (_) { /* unsupported hardware must never break play */ }
      },
    },
    transition: null,
  };

  function freshState() {
    return { embers: { ruins: false, aqueduct: false, crypt: false, moonspire: false }, visited: new Set(), defeated: { ruins: new Set(), aqueduct: new Set(), crypt: new Set(), moonspire: new Set() }, beaconLit: false, won: false };
  }

  // ------------------------------------------------------------------ rooms
  function loadRoom(id, spawnX) {
    const room = ROOMS[id];
    G.room = room; G.solids = room.solids;
    G.state.visited.add(id);
    G.enemies = room.enemies.map((d, i) => new Sentinel(d, i)).filter((e) => !G.state.defeated[id].has(e.idx));
    G.arrows = []; G.grenades = []; G.particles.clear();
    G.emberObj = { x: room.ember.x, y: room.ember.y, collected: !!G.state.embers[id] };
    const p = G.player;
    p.reset(spawnX - p.w / 2, GROUND_Y - p.h);
    p.hp = G.keepHp != null ? G.keepHp : 5;
    p.invuln = 1.0;
    p.safe.x = p.x; p.safe.y = p.y;
    G.doorLock = 0.7; G.nearDoor = null; G.nearBeacon = false;
    snapCamera();
    audio.state.listenerX = p.cx;
    render.roomLayer(room);
  }

  function snapCamera() {
    const t = cameraTarget();
    G.cam.x = t.x; G.cam.y = t.y;
  }
  function cameraTarget() {
    const p = G.player;
    const tx = clamp(p.cx - VIEW_W / 2 + p.facing * 50, 0, Math.max(0, G.room.width - VIEW_W));
    const ty = clamp(p.y + p.h / 2 - VIEW_H / 2 + 60, 0, Math.max(0, G.room.height - VIEW_H));
    return { x: tx, y: ty };
  }

  function newAdventure() {
    G.state = freshState();
    G.keepHp = 5;
    G.fx.fade = 0; G.fx.shakeAmp = 0; G.fx.hitPauseT = 0; G.transition = null;
    loadRoom('ruins', ROOMS.ruins.start.x);
    ui.updateHUD(G);
  }

  function startTransition(toId) {
    if (G.mode !== 'playing') return;
    const from = G.room.id;
    G.mode = 'transition';
    G.player.cancelActions(); G.player.cancelBow();
    input.clearAll();
    audio.play('door');
    G.transition = { t: 0, toId, from, switched: false };
  }

  function updateTransition(dt) {
    const tr = G.transition; if (!tr) return;
    tr.t += dt;
    const half = 0.35;
    if (!tr.switched && tr.t >= half) {
      tr.switched = true;
      const dest = ROOMS[tr.toId];
      const back = dest.doors.find((d) => d.to === tr.from);
      G.keepHp = G.player.hp;
      loadRoom(tr.toId, back ? back.x + back.w / 2 : dest.start.x);
      ui.announce(dest);
    }
    G.fx.fade = tr.t < half ? tr.t / half : clamp(1 - (tr.t - half) / half, 0, 1);
    if (tr.t >= half * 2) { G.fx.fade = 0; G.transition = null; G.mode = 'playing'; }
  }

  // ------------------------------------------------------------------ effects / spawns
  const P = G.particles;
  G.spawnSlash = (p) => {
    P.add({ type: 'slash', x: p.cx + p.facing * 22, y: p.y + 52, facing: p.facing, r: 78, life: 0.2 });
  };
  G.spawnGhost = (p) => {
    P.add({ type: 'ghost', x: p.cx, y: p.feetY, facing: p.facing, anim: p.anim.name, frame: p.anim.frame, life: 0.28 });
  };
  G.spawnDashBurst = (p) => {
    for (let i = 0; i < 10; i++) P.add({ type: 'spark', x: p.cx - p.facing * 10, y: p.y + 50 + rand(-30, 40), vx: -p.facing * rand(150, 500), vy: rand(-80, 80), life: rand(0.15, 0.3), size: 2, color: 'rgba(170,210,255,0.9)', drag: 6 });
  };
  G.spawnJumpDust = (p, dbl) => {
    const n = dbl ? 12 : 7;
    for (let i = 0; i < n; i++) P.add({ type: 'dot', x: p.cx + rand(-14, 14), y: dbl ? p.feetY - 10 : p.feetY - 2, vx: rand(-90, 90), vy: dbl ? rand(20, 90) : rand(-30, -5), life: rand(0.25, 0.5), size: rand(2, 3.5), color: dbl ? 'rgba(180,220,255,0.9)' : 'rgba(200,210,230,0.7)', lum: dbl, drag: 4 });
    if (dbl) P.add({ type: 'ring', x: p.cx, y: p.feetY - 8, r0: 6, r1: 46, size: 3, color: 'rgba(170,215,255,0.8)', life: 0.3 });
  };
  G.spawnLandDust = (p, impact) => {
    const n = Math.round(6 + impact * 10);
    for (let i = 0; i < n; i++) P.add({ type: 'dot', x: p.cx + rand(-18, 18), y: p.feetY - 2, vx: rand(-140, 140) * impact, vy: rand(-70, -10) * impact, life: rand(0.3, 0.6), size: rand(2, 4), color: 'rgba(190,200,220,0.6)', grav: 300, drag: 3 });
  };
  G.spawnStepDust = (p) => {
    for (let i = 0; i < 2; i++) P.add({ type: 'dot', x: p.cx - p.facing * 10 + rand(-6, 6), y: p.feetY - 2, vx: -p.facing * rand(20, 60), vy: rand(-40, -10), life: rand(0.25, 0.4), size: rand(1.5, 2.5), color: 'rgba(190,200,220,0.45)', drag: 3 });
  };
  G.spawnBounceDust = (x, y, speed) => {
    for (let i = 0; i < 4; i++) P.add({ type: 'dot', x, y: y + 6, vx: rand(-60, 60), vy: rand(-50, -10), life: 0.3, size: 2, color: 'rgba(190,200,220,0.5)', drag: 3 });
  };
  function sparks(x, y, n, color, speed, life, grav) {
    for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed); P.add({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(life * 0.5, life), size: rand(1.5, 3), color, grav: grav || 500, drag: 2 }); }
  }

  G.fireArrow = (p, charge) => {
    const speed = T.arrowMin + (T.arrowMax - T.arrowMin) * charge;
    const dmg = charge < 0.4 ? 1 : charge < 0.9 ? 2 : 3;
    const ox = p.cx + p.facing * 26, oy = p.y + 38;
    const vx = Math.cos(p.bow.aim) * speed * p.facing, vy = Math.sin(p.bow.aim) * speed;
    G.arrows.push(new Arrow(ox, oy, vx, vy, dmg, charge));
    for (let i = 0; i < 5; i++) P.add({ type: 'spark', x: ox, y: oy, vx: vx * rand(0.05, 0.15) + rand(-40, 40), vy: vy * rand(0.05, 0.15) + rand(-40, 40), life: 0.2, size: 1.5, color: 'rgba(255,230,170,0.9)', drag: 6 });
  };
  G.throwGrenade = (p) => {
    const ox = p.cx + p.facing * 30, oy = p.y + 30;
    const vx = p.facing * 430 + p.vx * 0.5, vy = -430 + Math.min(0, p.vy) * 0.3;
    G.grenades.push(new Grenade(ox, oy, vx, vy));
  };
  G.explode = (x, y) => {
    audio.play('explosion', { x });
    G.fx.shake(22); G.fx.hitPause(0.09); G.fx.rumble(1.0, 320);
    P.add({ type: 'flash', x, y, r0: 20, r1: 260, color: 'rgba(255,250,230,1)', color2: 'rgba(255,150,60,0.6)', mid: 0.3, life: 0.22 });
    P.add({ type: 'ring', x, y, r0: 10, r1: 230, size: 14, color: 'rgba(255,200,140,0.9)', life: 0.38 });
    P.add({ type: 'ring', x, y, r0: 4, r1: 150, size: 8, color: 'rgba(255,255,255,0.7)', life: 0.22 });
    P.add({ type: 'flash', x, y, r0: 40, r1: 180, color: 'rgba(255,140,50,0.8)', color2: 'rgba(255,90,30,0.3)', life: 0.5 });
    sparks(x, y, 34, 'rgba(255,200,90,1)', 620, 0.7, 700);
    sparks(x, y, 14, 'rgba(255,255,220,1)', 900, 0.35, 300);
    for (let i = 0; i < 14; i++) { const a = rand(-Math.PI, 0), s = rand(150, 480); P.add({ type: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.6, 1.1), size: rand(3, 6), color: pick(['#2b3550', '#1b2238', '#4a4238', '#5d6f95']), grav: 1300, spin: rand(-12, 12), rot: rand(0, 6), drag: 0.5 }); }
    for (let i = 0; i < 9; i++) P.add({ type: 'smoke', x: x + rand(-30, 30), y: y + rand(-20, 20), vx: rand(-40, 40), vy: rand(-90, -30), life: rand(0.9, 1.5), size: rand(18, 34), color: 'rgba(40,36,44,0.8)', alpha: 0.55, drag: 1.2, layer: 'front' });
    // damage
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (dist(x, y, e.x, e.y) <= T.blastRadius) e.hit(T.blastDamage, x, G, 'grenade');
    }
  };
  G.onEnemyDefeated = (e, kind) => {
    G.state.defeated[G.room.id].add(e.idx);
    audio.play('shatter', { x: e.x });
    G.fx.shake(kind === 'grenade' ? 0 : 4); G.fx.rumble(0.45, 120); if (kind !== 'grenade') G.fx.hitPause(0.05);
    P.add({ type: 'flash', x: e.x, y: e.y, r0: 10, r1: 120, color: 'rgba(200,255,255,0.95)', color2: 'rgba(80,220,255,0.4)', life: 0.3 });
    P.add({ type: 'ring', x: e.x, y: e.y, r0: 6, r1: 90, size: 5, color: 'rgba(140,240,255,0.9)', life: 0.35 });
    for (let i = 0; i < 16; i++) { const a = rand(0, Math.PI * 2), s = rand(120, 420); P.add({ type: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rand(0.5, 0.9), size: rand(4, 9), color: 'rgba(100,220,255,0.85)', grav: 900, spin: rand(-14, 14), rot: rand(0, 6), drag: 1 }); }
    sparks(e.x, e.y, 14, 'rgba(200,255,255,1)', 380, 0.4, 300);
  };
  G.onSwordHit = (e, p) => {
    audio.play('hit', { x: e.x });
    G.fx.shake(4); G.fx.hitPause(0.05); G.fx.rumble(0.4, 80);
    const hx = e.x - p.facing * 12, hy = e.y;
    sparks(hx, hy, 12, 'rgba(255,240,200,1)', 420, 0.35, 600);
    P.add({ type: 'flash', x: hx, y: hy, r0: 4, r1: 60, color: 'rgba(255,255,255,0.9)', color2: 'rgba(160,220,255,0.4)', life: 0.14 });
  };
  G.onArrowHitEnemy = (x, y, a) => {
    audio.play('arrowhit', { x });
    G.fx.hitPause(0.03); G.fx.shake(2 + a.charge * 3); G.fx.rumble(0.3, 60);
    sparks(x, y, 10, 'rgba(200,255,255,1)', 320, 0.3, 500);
    P.add({ type: 'flash', x, y, r0: 4, r1: 50, color: 'rgba(220,255,255,0.9)', color2: 'rgba(80,220,255,0.4)', life: 0.14 });
  };
  G.onArrowHitStone = (x, y, a) => {
    audio.play('arrowstone', { x });
    for (let i = 0; i < 5; i++) P.add({ type: 'dot', x, y, vx: rand(-90, 90), vy: rand(-120, -20), life: 0.4, size: 2, color: 'rgba(200,210,230,0.7)', grav: 600 });
  };

  // ------------------------------------------------------------------ world update
  function collectInput(first) {
    const p = G.player;
    let moveX = (input.down.right ? 1 : 0) - (input.down.left ? 1 : 0);
    if (input.pad.connected && input.pad.moveX) moveX = clamp(input.pad.moveX, -1, 1);
    let mouseAim = null;
    if (input.mouseBow) mouseAim = { x: G.cam.x + input.mouse.x, y: G.cam.y + input.mouse.y };
    return {
      moveX,
      jumpPressed: first && input.pressed.jump, jumpHeld: input.down.jump,
      dashPressed: first && input.pressed.dash,
      swordPressed: first && input.pressed.sword,
      bowHeld: input.down.bow,
      grenadePressed: first && input.pressed.grenade,
      aimUp: input.down.aimUp, aimDown: input.down.aimDown,
      mouseAim, padAimY: input.pad.connected && input.pad.aimY ? input.pad.aimY : input.touchAimY,
    };
  }

  function stepWorld(dt, inp) {
    const p = G.player;
    G.time += dt;
    G.doorLock = Math.max(0, G.doorLock - dt);
    p.update(dt, inp, G);
    for (const e of G.enemies) e.update(dt);
    for (const a of G.arrows) a.update(dt, G);
    for (const g of G.grenades) g.update(dt, G);
    G.arrows = G.arrows.filter((a) => a.alive);
    G.grenades = G.grenades.filter((g) => g.alive);
    G.particles.update(dt);

    // sword hits (damage only during the visible strike)
    if (p.swordT >= T.swordHitStart && p.swordT < T.swordHitEnd) {
      const hb = { x: p.facing > 0 ? p.cx - 6 : p.cx - 118, y: p.y + 4, w: 124, h: p.h - 8 };
      for (const e of G.enemies) {
        if (e.dead || p.swordHits.has(e)) continue;
        if (rectsOverlap(hb, e.box())) { p.swordHits.add(e); e.hit(T.swordDamage, p.cx, G, 'sword'); G.onSwordHit(e, p); }
      }
    }
    // enemy contact
    if (p.invuln <= 0 && p.dashT <= 0) {
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (rectsOverlap(e.box(), p.box())) {
          if (p.hurt(e.x, G)) { G.fx.damageFlash = 1; if (p.hp <= 0) rekindle(); }
          break;
        }
      }
    }
    // falling out of the room
    if (p.y > G.room.height + 40) {
      p.hp = Math.max(0, p.hp - 1);
      audio.play('hurt', { x: p.cx }); G.fx.damageFlash = 1; G.fx.rumble(0.5, 160);
      if (p.hp <= 0) rekindle();
      else { respawnAtSafe(); ui.message('The dark below takes its toll. Back to safe ground.', 2.2); }
    }
    // ember
    const em = G.emberObj;
    if (!em.collected && dist(p.cx, p.y + 50, em.x, em.y) < 58) collectEmber();
    // doors / beacon proximity
    G.nearDoor = null; G.nearBeacon = false;
    if (p.grounded) {
      for (const d of G.room.doors) if (Math.abs(p.cx - (d.x + d.w / 2)) < 56) { G.nearDoor = d; break; }
      if (G.room.beacon && Math.abs(p.cx - G.room.beacon.x) < 80) G.nearBeacon = true;
    }
    audio.state.listenerX = G.cam.x + VIEW_W / 2;
  }

  function respawnAtSafe() {
    const p = G.player;
    p.x = p.safe.x; p.y = p.safe.y; p.vx = 0; p.vy = 0; p.cancelActions(); p.cancelBow();
    p.invuln = 1.2; p.hurtT = 0; p.grounded = true; p.groundedTime = 0; p.fallT = 0;
    snapCamera();
  }
  function rekindle() {
    const p = G.player;
    p.hp = 5;
    respawnAtSafe();
    p.invuln = T.invuln;
    audio.play('rekindle');
    ui.message('Rekindled at your last safe ground.', 2.6);
    P.add({ type: 'flash', x: p.cx, y: p.y + 50, r0: 10, r1: 160, color: 'rgba(255,220,150,0.9)', color2: 'rgba(255,150,60,0.3)', life: 0.6 });
    sparks(p.cx, p.y + 50, 20, 'rgba(255,210,120,1)', 260, 0.7, -60);
  }

  function collectEmber() {
    const em = G.emberObj; em.collected = true;
    G.state.embers[G.room.id] = true;
    audio.play('ember', { x: em.x });
    G.fx.rumble(0.3, 120);
    P.add({ type: 'flash', x: em.x, y: em.y, r0: 10, r1: 220, color: 'rgba(255,230,170,0.95)', color2: 'rgba(255,160,70,0.35)', life: 0.6 });
    P.add({ type: 'ring', x: em.x, y: em.y, r0: 8, r1: 120, size: 6, color: 'rgba(255,210,130,0.9)', life: 0.5 });
    sparks(em.x, em.y, 26, 'rgba(255,215,120,1)', 300, 0.9, -120);
    for (let i = 0; i < 12; i++) P.add({ type: 'dot', x: em.x + rand(-10, 10), y: em.y + rand(-10, 10), vx: rand(-40, 40), vy: rand(-120, -40), life: rand(0.8, 1.4), size: rand(2, 4), color: 'rgba(255,200,110,0.9)', lum: true, drag: 1 });
    const n = ui.emberCount(G.state);
    if (n >= 4) ui.message('All four embers burn in your hands. Light the beacon in the Moonspire.', 3.6);
    else ui.message(`Ember recovered — ${n} / 4`, 2.2);
  }

  function tryInteract() {
    if (G.nearDoor && G.doorLock <= 0) { startTransition(G.nearDoor.to); return; }
    if (G.nearBeacon && !G.state.beaconLit) {
      const n = ui.emberCount(G.state);
      if (n >= 4) lightBeacon();
      else { audio.play('denied'); ui.message(`The beacon needs all four embers. ${n} / 4 recovered — the map shows what remains.`, 3); }
    }
  }

  function lightBeacon() {
    G.state.beaconLit = true;
    audio.play('beacon');
    const b = G.room.beacon;
    G.fx.shake(6); G.fx.rumble(0.6, 400);
    P.add({ type: 'flash', x: b.x, y: b.y - 120, r0: 20, r1: 420, color: 'rgba(255,230,170,0.95)', color2: 'rgba(255,150,60,0.35)', life: 1.4 });
    P.add({ type: 'ring', x: b.x, y: b.y - 120, r0: 10, r1: 400, size: 10, color: 'rgba(255,200,120,0.9)', life: 1.1 });
    sparks(b.x, b.y - 120, 60, 'rgba(255,210,120,1)', 420, 1.4, -160);
    G.player.cancelActions();
    setTimeout(() => { audio.play('victory'); }, 900);
    setTimeout(() => { if (G.state.beaconLit) { G.state.won = true; G.mode = 'victory'; input.clearAll(); ui.showOverlay('ov-victory'); } }, 2000);
  }

  // ------------------------------------------------------------------ modes
  function enableTouchUI() {
    if (G.touchUI) return;
    G.touchUI = true;
    document.documentElement.classList.add('is-touch');
    if (G.mode !== 'loading' && G.mode !== 'entry') ui.el.touch.hidden = false;
  }

  function setPaused(on, note) {
    if (on) {
      if (G.mode !== 'playing') return;
      G.mode = 'paused'; input.clearAll(); G.player.cancelBow();
      ui.el['pause-note'].textContent = note || '';
      ui.showOverlay('ov-pause');
    } else if (G.mode === 'paused') {
      G.mode = 'playing'; input.clearAll(); ui.showOverlay(null); audio.resume();
    }
  }
  function toggleMap() {
    if (G.mode === 'playing') { G.mode = 'map'; input.clearAll(); G.player.cancelBow(); ui.drawBigMap(G); ui.showOverlay('ov-map'); ui.el['btn-map-close'].focus(); }
    else if (G.mode === 'map') { G.mode = 'playing'; input.clearAll(); ui.showOverlay(null); ui.el.stage.focus(); }
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now(), acc = 0, rafPending = false;
  function schedule() { if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }
  function frame(now, manual) {
    if (!manual) { rafPending = false; schedule(); if (G.manualDrive) { if (G.mode !== 'loading') render.drawFrame(G); return; } }
    let dt = clamp((now - last) / 1000, 0, 0.05); last = now;
    input.pollGamepad();
    handleGlobalKeys();

    if (G.mode === 'playing' || G.mode === 'transition') {
      const fx = G.fx;
      if (G.mode === 'transition') updateTransition(dt);
      if (G.mode === 'playing' || (G.mode === 'transition' && !G.transition)) {
        acc += dt;
        let first = true;
        let steps = 0;
        while (acc >= STEP && steps < 8) {
          if (fx.hitPauseT > 0) { fx.hitPauseT -= STEP; }
          else stepWorld(STEP, collectInput(first));
          first = false; acc -= STEP; steps++;
        }
        if (input.pressed.interact) tryInteract();
        if (input.down.restart) { G.restartHold += dt; if (G.restartHold > 0.7) { G.restartHold = 0; newAdventure(); ui.announce(G.room); ui.message('A new adventure begins.', 2); } }
        else G.restartHold = 0;
      }
      // camera easing
      const t = cameraTarget();
      G.cam.x += (t.x - G.cam.x) * (1 - Math.exp(-6 * dt));
      G.cam.y += (t.y - G.cam.y) * (1 - Math.exp(-4.5 * dt));
      // shake
      fx.shakeAmp *= Math.exp(-7 * dt);
      if (fx.shakeAmp < 0.2) fx.shakeAmp = 0;
      fx.shakeX = fx.shakeAmp ? rand(-1, 1) * fx.shakeAmp : 0; fx.shakeY = fx.shakeAmp ? rand(-1, 1) * fx.shakeAmp : 0;
      fx.damageFlash = Math.max(0, fx.damageFlash - dt * 3);
      ui.updateHUD(G);
    }
    if (G.mode !== 'loading') render.drawFrame(G);
    ui.updateStudy(dt, true);
    input.endFrame();
  }

  function handleGlobalKeys() {
    if (input.pressed.pause) {
      if (G.mode === 'playing') setPaused(true);
      else if (G.mode === 'paused') setPaused(false);
      else if (G.mode === 'map') toggleMap();
    }
    if (input.pressed.map && (G.mode === 'playing' || G.mode === 'map')) toggleMap();
  }

  // ------------------------------------------------------------------ boot
  function loadSettings() {
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s) Object.assign(G.fx.settings, s); } catch (_) {}
    applySettings();
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.fx.settings)); } catch (_) {} }
  function applySettings() {
    const s = G.fx.settings;
    audio.setVolume(s.volume); audio.setMuted(s.muted);
    ui.el.vol.value = Math.round(s.volume * 100); ui.el['set-vol'].value = Math.round(s.volume * 100);
    ui.el['set-sound'].checked = !s.muted; ui.el['set-shake'].checked = s.shake; ui.el['set-rumble'].checked = s.rumble;
    ui.el['btn-mute'].classList.toggle('off', s.muted);
  }

  function bindUI() {
    const el = ui.el;
    const gesture = () => { audio.init(); audio.resume(); };
    window.addEventListener('pointerdown', gesture, { passive: true });
    window.addEventListener('keydown', gesture);
    window.addEventListener('touchstart', gesture, { passive: true });

    el['btn-enter'].addEventListener('click', () => {
      gesture();
      if (G.mode !== 'entry') return;
      if (input.mobile) { G.armFullscreen(); enterFullscreen(); } // the tap is a user gesture, so browsers allow it here
      ui.showOverlay(null); el.hud.hidden = false;
      if (G.touchUI) el.touch.hidden = false;
      G.mode = 'playing'; ui.announce(G.room);
      el.stage.focus();
    });
    // Phones and tablets get the touch layout up front; a touch laptop gets it on its first tap.
    if (input.mobile) enableTouchUI();
    el.stage.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enableTouchUI(); });
    // The stage is a landscape 1280x650 box: portrait phones get a rotate hint, and the game
    // pauses so nobody dies while turning the phone around.
    const portrait = matchMedia('(orientation: portrait)');
    const onOrient = () => { if (portrait.matches && input.mobile) setPaused(true, 'Rotate your phone to landscape to keep playing.'); };
    if (portrait.addEventListener) portrait.addEventListener('change', onOrient); else portrait.addListener(onOrient);
    el['btn-resume'].addEventListener('click', () => setPaused(false));
    el['btn-pause'].addEventListener('click', () => { if (G.mode === 'playing') setPaused(true); else if (G.mode === 'paused') setPaused(false); });
    el['btn-restart'].addEventListener('click', () => { newAdventure(); G.mode = 'playing'; ui.showOverlay(null); ui.announce(G.room); ui.message('A new adventure begins.', 2); });
    el['btn-again'].addEventListener('click', () => { newAdventure(); G.mode = 'playing'; ui.showOverlay(null); ui.announce(G.room); });
    el['btn-map-close'].addEventListener('click', () => toggleMap());
    el.minimap.addEventListener('click', () => { if (G.mode === 'playing') toggleMap(); });
    // Fullscreen: Android and desktop browsers have it (Safari with the webkit prefix on older
    // versions); iPhone Safari has none for elements at all, and an app opened from the home
    // screen is already fullscreen. Hide the button whenever it would be dead, and on iPhone
    // point at the home-screen route instead.
    const st = el.stage;
    const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(st.requestFullscreen || st.webkitRequestFullscreen);
    const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
    const inFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    function enterFullscreen() {
      if (!canFullscreen || inFullscreen()) return;
      try {
        const p = st.requestFullscreen ? st.requestFullscreen({ navigationUI: 'hide' }) : st.webkitRequestFullscreen();
        Promise.resolve(p).then(() => {
          // Android lets a fullscreen page pin its orientation; elsewhere this just rejects.
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }).catch(() => {});
      } catch (_) { /* unsupported: the page layout already fills the viewport */ }
    }
    function exitFullscreen() { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); }
    if (!canFullscreen || standalone) el['btn-full'].hidden = true;
    // iPhone Safari only gained element fullscreen in 17.4, and even there a home-screen app is
    // the cleaner route (no close button, no Safari chrome): show the tip on every iPhone.
    const iphone = /iPhone|iPod/.test(navigator.userAgent);
    if (input.mobile && !standalone && (iphone || !canFullscreen)) el['ov-tip'].hidden = false;
    // Keep trying on later taps while playing: the entry tap can be refused (a browser may not
    // count it, or fullscreen may need a second gesture). Stop once the player backs out of
    // fullscreen on purpose, until they ask again with the button.
    let wantFullscreen = false;
    el['btn-full'].addEventListener('click', () => { if (inFullscreen()) { wantFullscreen = false; exitFullscreen(); } else { wantFullscreen = true; enterFullscreen(); } });
    const onFsChange = () => { ui.updateStageScale(); if (!inFullscreen() && G.mode !== 'entry') wantFullscreen = false; };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    const retryFullscreen = () => { if (wantFullscreen && input.mobile && G.mode === 'playing' && !inFullscreen()) enterFullscreen(); };
    el.stage.addEventListener('touchend', retryFullscreen, { passive: true });
    el.stage.addEventListener('pointerup', retryFullscreen);
    G.armFullscreen = () => { wantFullscreen = true; };
    el['btn-mute'].addEventListener('click', () => { G.fx.settings.muted = !G.fx.settings.muted; applySettings(); saveSettings(); });
    el.vol.addEventListener('input', () => { G.fx.settings.volume = el.vol.value / 100; G.fx.settings.muted = false; applySettings(); saveSettings(); });
    el['set-vol'].addEventListener('input', () => { G.fx.settings.volume = el['set-vol'].value / 100; applySettings(); saveSettings(); });
    el['set-sound'].addEventListener('change', () => { G.fx.settings.muted = !el['set-sound'].checked; applySettings(); saveSettings(); });
    el['set-shake'].addEventListener('change', () => { G.fx.settings.shake = el['set-shake'].checked; saveSettings(); });
    el['set-rumble'].addEventListener('change', () => { G.fx.settings.rumble = el['set-rumble'].checked; saveSettings(); });
    // keep keyboard focus on the stage so gameplay keys work after clicking HUD buttons
    el.stage.tabIndex = -1;
    el.stage.addEventListener('pointerdown', (e) => { if (!e.target.closest('input,button,a')) el.stage.focus({ preventScroll: true }); });
    // focus loss / hidden tab: pause safely and drop held controls
    const lost = () => { if (G.mode === 'playing') setPaused(true, 'Paused — the window lost focus. Held controls were released.'); else input.clearAll(); };
    window.addEventListener('blur', lost);
    document.addEventListener('visibilitychange', () => { if (document.hidden) lost(); });
    // motion study
    ui.initStudy(
      () => { if (G.mode === 'playing') { G.resumeMode = 'playing'; G.mode = 'inspector'; input.clearAll(); G.player.cancelBow(); } else G.resumeMode = null; },
      () => { if (G.mode === 'inspector') { G.mode = 'playing'; input.clearAll(); audio.resume(); } }
    );
  }

  function boot() {
    ui.init();
    render.init(document.getElementById('game'));
    input.init(ui.el.stage, ui.el.touch);
    bindUI();
    loadSettings();
    const status = ui.el['ov-status'];
    MF.sprites.load((done, total) => { status.textContent = `Loading assets… ${done} / ${total}`; })
      .then(() => {
        newAdventure();
        G.mode = 'entry';
        status.textContent = 'Ready. The moon is waiting.';
        ui.el['btn-enter'].disabled = false;
        ui.el['btn-enter'].focus();
        // pre-warm the other room layers so door transitions are instant
        setTimeout(() => { for (const id in ROOMS) render.roomLayer(ROOMS[id]); }, 200);
      })
      .catch((err) => {
        console.error(err);
        status.textContent = 'Asset loading failed: ' + err.message;
        status.classList.add('err');
        ui.el['error-copy'].textContent = `${err.message}. Serve the folder over HTTP (for example: python3 -m http.server) and make sure the assets/ directory is present.`;
        ui.showOverlay('ov-error');
      });
    schedule();
  }

  MF.game = G;
  G.newAdventure = newAdventure; G.startTransition = startTransition; G.setPaused = setPaused; G.frame = (now) => frame(now, true); G.stepWorld = stepWorld; G.STEP = STEP; G.loadRoom = loadRoom; G.toggleMap = toggleMap;
  window.addEventListener('DOMContentLoaded', boot);
})(window.MF);
