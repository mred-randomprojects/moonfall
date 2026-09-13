// Player, enemies, projectiles and particles.
(function (MF) {
  'use strict';
  const { clamp, rand, randInt, dist, sign, segmentVsRect, rectsOverlap, lerp } = MF.util;

  // Reference tuning (world units / seconds)
  const T = {
    runSpeed: 290, swordMove: 190, bowMove: 105, throwMove: 190,
    jumpImpulse: 570, gravity: 1500, maxFall: 850,
    coyote: 0.11, jumpBuffer: 0.12,
    dashSpeed: 750, dashDur: 0.16, dashCd: 0.65,
    swordDur: 0.48, swordFrames: 12, swordHitStart: 0.20, swordHitEnd: 0.36, swordDamage: 2,
    bowFull: 0.9, arrowCd: 0.25, arrowMin: 590, arrowMax: 1160,
    throwDur: 0.48, throwRelease: 0.24, grenadeFuse: 1.4, grenadeCd: 1.8, blastRadius: 170, blastDamage: 4,
    invuln: 1.4, hurtLock: 0.28,
    accelGround: 2600, accelAir: 1500, decelGround: 3000, decelAir: 900,
  };

  // ------------------------------------------------------------------ Player
  class Player {
    constructor() {
      this.w = 44; this.h = 100;
      this.reset(100, 540);
    }
    reset(x, y) {
      this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.facing = 1;
      this.grounded = true; this.wasGrounded = true; this.groundedTime = 0; this.lastVy = 0;
      this.coyote = 0; this.jumpBuffer = 0; this.airJumps = 1; this.jumpHeld = false; this.jumpT = 99; this.lastJumpDouble = false;
      this.dashT = 0; this.dashCd = 0; this.dashDir = 1; this.dashTrailT = 0;
      this.swordT = -1; this.swordHits = new Set(); this.swordSlashed = false;
      this.bow = { drawing: false, charge: 0, cd: 0, aim: 0, releaseT: -1, releaseCharge: 0 };
      this.grenade = { throwT: -1, released: false, cd: 0 };
      this.hp = 5; this.invuln = 0; this.hurtT = 0;
      this.landT = 0; this.landHeavy = false; this.fallT = 0;
      this.anim = { name: 'idle', t: 0, frame: 0 };
      this.safe = { x, y };
      this.stateText = 'Idle';
      this.footPhase = 0;
      this.moveX = 0;
    }
    get cx() { return this.x + this.w / 2; }
    get feetY() { return this.y + this.h; }
    box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
    get busy() { return this.swordT >= 0 || this.grenade.throwT >= 0 || this.bow.drawing || this.dashT > 0 || this.hurtT > 0; }

    cancelActions() {
      this.swordT = -1; this.swordHits.clear();
      this.bow.drawing = false; this.bow.charge = 0; this.bow.releaseT = -1;
      if (this.grenade.throwT >= 0 && !this.grenade.released) this.grenade.cd = Math.min(this.grenade.cd, 0.4);
      this.grenade.throwT = -1;
      this.dashT = 0;
    }
    cancelBow() { this.bow.drawing = false; this.bow.charge = 0; }

    // in: {moveX, jumpPressed, jumpHeld, jumpReleased, dashPressed, swordPressed, bowHeld, grenadePressed, aimUp, aimDown, mouseAim, padAimY}
    update(dt, inp, G) {
      const audio = G.audio;
      // timers
      this.dashCd = Math.max(0, this.dashCd - dt);
      this.bow.cd = Math.max(0, this.bow.cd - dt);
      this.grenade.cd = Math.max(0, this.grenade.cd - dt);
      this.invuln = Math.max(0, this.invuln - dt);
      this.hurtT = Math.max(0, this.hurtT - dt);
      this.landT = Math.max(0, this.landT - dt);
      this.coyote = Math.max(0, this.coyote - dt);
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      this.jumpT += dt;
      if (this.bow.releaseT >= 0) { this.bow.releaseT += dt; if (this.bow.releaseT > 0.25) this.bow.releaseT = -1; }

      const control = this.hurtT <= 0;
      let moveX = control ? inp.moveX : 0;
      this.moveX = moveX;

      // --- facing / aiming
      if (control && this.dashT <= 0) {
        if (this.bow.drawing && inp.mouseAim) {
          const dx = inp.mouseAim.x - this.cx;
          if (Math.abs(dx) > 8) this.facing = sign(dx);
        } else if (moveX !== 0 && this.swordT < 0) this.facing = sign(moveX);
      }
      if (this.bow.drawing) {
        let aim = 0;
        if (inp.mouseAim) {
          const dx = inp.mouseAim.x - this.cx, dy = inp.mouseAim.y - (this.y + 40);
          aim = clamp(Math.atan2(dy, Math.abs(dx)), -1.15, 1.15);
        } else if (inp.padAimY) {
          aim = clamp(inp.padAimY, -1, 1) * 1.0;
        } else if (inp.aimUp && !inp.aimDown) aim = -0.62;
        else if (inp.aimDown && !inp.aimUp) aim = 0.62;
        this.bow.aim = lerp(this.bow.aim, aim, 1 - Math.exp(-18 * dt));
      }

      // --- jump buffering
      if (inp.jumpPressed && control) this.jumpBuffer = T.jumpBuffer;
      this.jumpHeld = inp.jumpHeld;

      // --- dash
      if (inp.dashPressed && control && this.dashCd <= 0 && this.dashT <= 0 && this.swordT < 0 && this.grenade.throwT < 0) {
        this.dashT = T.dashDur; this.dashCd = T.dashCd;
        this.dashDir = moveX !== 0 ? sign(moveX) : this.facing;
        this.facing = this.dashDir;
        this.vy = 0; this.vx = this.dashDir * T.dashSpeed;
        this.cancelBow();
        audio.play('dash', { x: this.cx });
        G.fx.rumble(0.25, 90);
        G.spawnDashBurst(this);
      }

      // --- sword
      if (inp.swordPressed && control && this.swordT < 0 && this.dashT <= 0 && this.grenade.throwT < 0) {
        this.cancelBow();
        this.swordT = 0; this.swordHits.clear(); this.swordSlashed = false;
        audio.play('swing', { x: this.cx });
      }
      if (this.swordT >= 0) {
        this.swordT += dt;
        if (!this.swordSlashed && this.swordT >= T.swordHitStart) { this.swordSlashed = true; G.spawnSlash(this); }
        if (this.swordT >= T.swordDur) { this.swordT = -1; this.swordHits.clear(); }
      }

      // --- grenade
      if (inp.grenadePressed && control && this.grenade.cd <= 0 && this.grenade.throwT < 0 && this.swordT < 0 && this.dashT <= 0) {
        this.cancelBow();
        this.grenade.throwT = 0; this.grenade.released = false; this.grenade.cd = T.grenadeCd;
      }
      if (this.grenade.throwT >= 0) {
        this.grenade.throwT += dt;
        if (!this.grenade.released && this.grenade.throwT >= T.throwRelease) {
          this.grenade.released = true;
          G.throwGrenade(this);
          audio.play('throw', { x: this.cx });
        }
        if (this.grenade.throwT >= T.throwDur) this.grenade.throwT = -1;
      }

      // --- bow
      const canDraw = control && this.swordT < 0 && this.grenade.throwT < 0 && this.dashT <= 0;
      if (inp.bowHeld && canDraw && !this.bow.drawing && this.bow.cd <= 0 && this.bow.releaseT < 0) {
        this.bow.drawing = true; this.bow.charge = 0;
        audio.play('bowdraw', { x: this.cx });
      }
      if (this.bow.drawing) {
        if (!inp.bowHeld || !canDraw) {
          if (control && canDraw) {
            // release -> fire
            const c = clamp(this.bow.charge, 0, 1);
            G.fireArrow(this, c);
            this.bow.releaseT = 0; this.bow.releaseCharge = c; this.bow.cd = T.arrowCd;
            audio.play('bowrelease', { x: this.cx, intensity: c });
            G.fx.rumble(0.15 + 0.3 * c, 60);
          }
          this.bow.drawing = false; this.bow.charge = 0;
        } else {
          this.bow.charge = Math.min(1, this.bow.charge + dt / T.bowFull);
        }
      }

      // --- horizontal motion
      let target, accel, decel;
      const onGround = this.grounded;
      if (this.dashT > 0) {
        target = this.dashDir * T.dashSpeed; accel = 1e9; decel = 1e9;
      } else {
        const speed = this.swordT >= 0 ? T.swordMove : this.bow.drawing ? T.bowMove : this.grenade.throwT >= 0 ? T.throwMove : T.runSpeed;
        target = moveX * speed;
        accel = onGround ? T.accelGround : T.accelAir;
        decel = onGround ? T.decelGround : T.decelAir;
      }
      if (this.hurtT > 0) { target = this.vx; accel = 0; decel = onGround ? 900 : 200; if (onGround) target = 0; }
      if (this.dashT > 0) this.vx = target;
      else if (Math.abs(target) > Math.abs(this.vx) || sign(target) !== sign(this.vx)) {
        const d = target - this.vx; const step = accel * dt;
        this.vx += Math.abs(d) <= step ? d : sign(d) * step;
      } else {
        const d = target - this.vx; const step = decel * dt;
        this.vx += Math.abs(d) <= step ? d : sign(d) * step;
      }

      // --- vertical motion
      if (this.dashT > 0) {
        this.dashT -= dt; this.vy = 0;
        this.dashTrailT -= dt;
        if (this.dashTrailT <= 0) { this.dashTrailT = 0.022; G.spawnGhost(this); }
        if (this.dashT <= 0) { this.vx = this.dashDir * T.runSpeed * 0.9; }
      } else {
        this.vy = Math.min(T.maxFall, this.vy + T.gravity * dt);
        // jump
        if (this.jumpBuffer > 0 && control) {
          if (this.grounded || this.coyote > 0) {
            this.vy = -T.jumpImpulse; this.jumpBuffer = 0; this.coyote = 0; this.grounded = false; this.jumpT = 0; this.lastJumpDouble = false;
            audio.play('jump', { x: this.cx }); G.fx.rumble(0.1, 40); G.spawnJumpDust(this, false);
          } else if (this.airJumps > 0) {
            this.airJumps--; this.vy = -T.jumpImpulse; this.jumpBuffer = 0; this.jumpT = 0; this.lastJumpDouble = true;
            audio.play('doublejump', { x: this.cx }); G.fx.rumble(0.12, 50); G.spawnJumpDust(this, true);
          }
        }
        // variable height: releasing early cuts the ascent
        if (!this.jumpHeld && this.vy < -220 && this.jumpT < 0.35) this.vy = -220;
      }

      // --- integrate with collisions
      this.wasGrounded = this.grounded;
      this.moveAndCollide(dt, G.solids, G.room);

      // --- ground bookkeeping
      if (this.grounded) {
        this.coyote = T.coyote; this.airJumps = 1; this.groundedTime += dt; this.fallT = 0;
        if (!this.wasGrounded) {
          const impact = clamp(this.lastVy / T.maxFall, 0, 1);
          this.landT = impact > 0.45 ? 0.24 : 0.14; this.landHeavy = impact > 0.45;
          audio.play('land', { x: this.cx, intensity: 0.4 + impact });
          if (impact > 0.35) { G.fx.rumble(0.2 * impact, 60); G.spawnLandDust(this, impact); }
        }
        // safe ground: fully supported for a moment
        if (this.groundedTime > 0.25 && this.isFullySupported(G.solids)) { this.safe.x = this.x; this.safe.y = this.y; }
      } else {
        if (this.wasGrounded && this.coyote <= 0) this.coyote = T.coyote;
        this.groundedTime = 0;
        if (this.vy > 0) this.fallT += dt;
      }
      this.lastVy = this.vy;

      // footsteps
      if (this.grounded && Math.abs(this.vx) > 60 && this.dashT <= 0 && this.swordT < 0) {
        const prev = this.footPhase;
        this.footPhase = (this.footPhase + dt * 24) % 12;
        if ((prev < 1 && this.footPhase >= 1) || (prev < 7 && this.footPhase >= 7)) { audio.play('footstep', { x: this.cx }); G.spawnStepDust(this); }
      } else this.footPhase = 0.5;

      this.updateAnim(dt);
    }

    isFullySupported(solids) {
      const fy = this.feetY;
      for (const s of solids) {
        if (Math.abs(s.y - fy) < 2 && this.x >= s.x + 4 && this.x + this.w <= s.x + s.w - 4) return true;
      }
      return false;
    }

    moveAndCollide(dt, solids, room) {
      // X
      this.x += this.vx * dt;
      if (this.x < 0) { this.x = 0; if (this.vx < 0) this.vx = 0; }
      if (this.x + this.w > room.width) { this.x = room.width - this.w; if (this.vx > 0) this.vx = 0; }
      for (const s of solids) {
        if (!rectsOverlap(this.box(), s)) continue;
        if (this.vx > 0) this.x = s.x - this.w; else if (this.vx < 0) this.x = s.x + s.w;
        else { // stuck without motion: push the shorter way
          const l = (this.x + this.w) - s.x, r = (s.x + s.w) - this.x;
          this.x += l < r ? -l : r;
        }
        this.vx = 0;
      }
      // Y
      this.y += this.vy * dt;
      this.grounded = false;
      for (const s of solids) {
        if (!rectsOverlap(this.box(), s)) continue;
        if (this.vy > 0) { this.y = s.y - this.h; this.grounded = true; this.vy = 0; }
        else if (this.vy < 0) { this.y = s.y + s.h; this.vy = 0; }
      }
      if (!this.grounded) {
        // resting exactly on a surface with vy == 0
        const fy = this.feetY;
        for (const s of solids) {
          if (Math.abs(s.y - fy) < 0.5 && this.x + this.w > s.x + 1 && this.x < s.x + s.w - 1 && this.vy >= 0) { this.grounded = true; this.vy = 0; break; }
        }
      }
    }

    // choose animation + frame from physical state
    updateAnim(dt) {
      let name, frame = null, fps = 12, loop = true, text;
      const b = this.bow, g = this.grenade;
      if (this.hurtT > 0) { name = 'land'; frame = 3; text = 'Hurt'; }
      else if (this.dashT > 0) { name = 'run'; frame = 3; text = 'Dashing'; }
      else if (this.swordT >= 0) { name = 'sword'; frame = Math.min(11, Math.floor(this.swordT / T.swordDur * T.swordFrames)); text = 'Sword strike'; }
      else if (g.throwT >= 0) { name = 'grenade'; frame = Math.min(5, Math.floor(g.throwT / T.throwDur * 6)); text = 'Throwing grenade'; }
      else if (b.drawing) {
        const c = b.charge; name = 'bow'; frame = c < 0.2 ? 0 : c < 0.5 ? 1 : c < 0.88 ? 2 : 3;
        text = 'Drawing bow ' + Math.round(c * 100) + '%';
      }
      else if (b.releaseT >= 0) { name = 'bow'; frame = b.releaseT < 0.1 ? 4 : 5; text = 'Arrow loosed'; }
      else if (!this.grounded) {
        if (this.vy < -90) {
          name = 'jump';
          const t = this.jumpT;
          frame = t < 0.05 ? 1 : t < 0.14 ? 2 : t < 0.26 ? 3 : 4;
          text = this.lastJumpDouble ? 'Double jump' : 'Jumping';
        } else if (this.vy <= 90) { name = 'jump'; frame = 5; text = 'Apex'; }
        else { name = 'land'; frame = this.fallT < 0.12 ? 0 : this.fallT < 0.3 ? 1 : 2; text = 'Falling'; }
      }
      else if (this.landT > 0) {
        name = 'land';
        if (this.landHeavy) frame = this.landT > 0.16 ? 3 : this.landT > 0.08 ? 4 : 5;
        else frame = this.landT > 0.07 ? 4 : 5;
        text = 'Landing';
      }
      else if (Math.abs(this.vx) > 25 && this.moveX !== 0) { name = 'run'; fps = 24; text = 'Running'; }
      else if (Math.abs(this.vx) > 25) { name = 'run'; fps = 24; text = 'Sliding'; }
      else { name = 'idle'; fps = 8; text = 'Idle'; }

      if (this.anim.name !== name) { this.anim.name = name; this.anim.t = 0; }
      this.anim.t += dt;
      if (frame != null) this.anim.frame = frame;
      else {
        const n = MF.sprites.anim(name) ? MF.sprites.anim(name).frames : 6;
        if (name === 'run') this.anim.frame = Math.floor(this.footPhase) % 12;
        else this.anim.frame = Math.floor(this.anim.t * fps) % n;
      }
      this.stateText = text;
    }

    hurt(fromX, G) {
      if (this.invuln > 0 || this.dashT > 0) return false;
      this.hp = Math.max(0, this.hp - 1);
      this.invuln = T.invuln; this.hurtT = T.hurtLock;
      const dir = this.cx < fromX ? -1 : 1;
      this.vx = dir * 260; this.vy = -300; this.grounded = false;
      this.cancelActions();
      G.audio.play('hurt', { x: this.cx });
      G.fx.shake(6); G.fx.rumble(0.5, 140); G.fx.hitPause(0.04);
      return true;
    }
  }

  // ------------------------------------------------------------------ Sentinel
  class Sentinel {
    constructor(def, idx) {
      this.idx = idx; this.x0 = def.x; this.y0 = def.y; this.x = def.x; this.y = def.y;
      this.range = def.range || 80; this.dir = idx % 2 ? -1 : 1; this.speed = 55 + (idx * 13) % 30;
      this.phase = idx * 1.7; this.rot = idx; this.hp = 3; this.maxHp = 3; this.flash = 0; this.dead = false; this.kvx = 0; this.t = 0;
      this.r = 26;
    }
    box() { return { x: this.x - 22, y: this.y - 22, w: 44, h: 44 }; }
    update(dt) {
      this.t += dt;
      this.x += this.dir * this.speed * dt + this.kvx * dt;
      this.kvx *= Math.exp(-6 * dt);
      if (this.x > this.x0 + this.range) { this.x = this.x0 + this.range; this.dir = -1; }
      if (this.x < this.x0 - this.range) { this.x = this.x0 - this.range; this.dir = 1; }
      this.y = this.y0 + Math.sin(this.t * 2.1 + this.phase) * 8;
      this.rot += dt * (0.9 + (this.flash > 0 ? 6 : 0));
      this.flash = Math.max(0, this.flash - dt);
    }
    hit(dmg, fromX, G, kind) {
      if (this.dead) return false;
      this.hp -= dmg; this.flash = 0.14;
      this.kvx = (this.x < fromX ? -1 : 1) * 160;
      if (this.hp <= 0) { this.dead = true; G.onEnemyDefeated(this, kind); }
      return true;
    }
  }

  // ------------------------------------------------------------------ Arrow
  class Arrow {
    constructor(x, y, vx, vy, dmg, charge) {
      this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.dmg = dmg; this.charge = charge;
      this.alive = true; this.stuck = false; this.stuckT = 0; this.angle = Math.atan2(vy, vx); this.len = 36; this.age = 0;
    }
    update(dt, G) {
      if (!this.alive) return;
      this.age += dt;
      if (this.stuck) { this.stuckT -= dt; if (this.stuckT <= 0) this.alive = false; return; }
      this.vy += 320 * dt;
      const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
      // tip leads the shaft
      const tx0 = this.x + Math.cos(this.angle) * this.len * 0.5, ty0 = this.y + Math.sin(this.angle) * this.len * 0.5;
      const na = Math.atan2(this.vy, this.vx);
      const tx1 = nx + Math.cos(na) * this.len * 0.5, ty1 = ny + Math.sin(na) * this.len * 0.5;
      let bestT = 2, hitSolid = null, hitEnemy = null;
      for (const s of G.solids) { const t = segmentVsRect(tx0, ty0, tx1, ty1, s); if (t != null && t < bestT) { bestT = t; hitSolid = s; hitEnemy = null; } }
      for (const e of G.enemies) {
        if (e.dead) continue;
        const b = e.box(); b.x -= 4; b.y -= 4; b.w += 8; b.h += 8;
        const t = segmentVsRect(tx0, ty0, tx1, ty1, b); if (t != null && t < bestT) { bestT = t; hitEnemy = e; hitSolid = null; }
      }
      if (hitEnemy) {
        const hx = tx0 + (tx1 - tx0) * bestT, hy = ty0 + (ty1 - ty0) * bestT;
        hitEnemy.hit(this.dmg, this.x, G, 'arrow');
        G.onArrowHitEnemy(hx, hy, this);
        this.alive = false; return;
      }
      if (hitSolid) {
        const hx = tx0 + (tx1 - tx0) * bestT, hy = ty0 + (ty1 - ty0) * bestT;
        this.angle = na;
        // embed: put the tip slightly into the surface
        this.x = hx - Math.cos(na) * this.len * 0.42; this.y = hy - Math.sin(na) * this.len * 0.42;
        this.stuck = true; this.stuckT = 2.4; this.vx = this.vy = 0;
        G.onArrowHitStone(hx, hy, this);
        return;
      }
      this.x = nx; this.y = ny; this.angle = na;
      if (this.x < -80 || this.x > G.room.width + 80 || this.y > G.room.height + 200 || this.y < -600) this.alive = false;
    }
  }

  // ------------------------------------------------------------------ Grenade
  class Grenade {
    constructor(x, y, vx, vy) {
      this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.r = 9; this.fuse = T.grenadeFuse; this.alive = true; this.rot = 0; this.rest = 0; this.age = 0;
    }
    box() { return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
    update(dt, G) {
      if (!this.alive) return;
      this.age += dt;
      this.fuse -= dt;
      if (this.fuse <= 0) { this.alive = false; G.explode(this.x, this.y); return; }
      this.vy += T.gravity * dt;
      this.rot += this.vx * dt * 0.02;
      // X
      this.x += this.vx * dt;
      if (this.x - this.r < 0) { this.x = this.r; this.vx = Math.abs(this.vx) * 0.55; }
      if (this.x + this.r > G.room.width) { this.x = G.room.width - this.r; this.vx = -Math.abs(this.vx) * 0.55; }
      for (const s of G.solids) {
        if (!rectsOverlap(this.box(), s)) continue;
        if (this.vx > 0) this.x = s.x - this.r; else this.x = s.x + s.w + this.r;
        this.bounce('x', G);
      }
      // Y
      this.y += this.vy * dt;
      let onSurface = false;
      for (const s of G.solids) {
        if (!rectsOverlap(this.box(), s)) continue;
        if (this.vy > 0) { this.y = s.y - this.r; onSurface = true; } else this.y = s.y + s.h + this.r;
        this.bounce('y', G);
      }
      if (onSurface) { this.vx *= Math.exp(-3.5 * dt); if (Math.abs(this.vy) < 40) this.vy = 0; }
      if (this.y > G.room.height + 300) { this.alive = false; G.explode(this.x, Math.min(this.y, G.room.height + 80)); }
    }
    bounce(axis, G) {
      const v = axis === 'x' ? this.vx : this.vy;
      const speed = Math.abs(v);
      if (axis === 'x') this.vx = -v * 0.55; else this.vy = -v * 0.5;
      if (speed > 70) { G.audio.play('bounce', { x: this.x, intensity: clamp(speed / 700, 0.15, 1) }); G.spawnBounceDust(this.x, this.y, speed); }
      else if (axis === 'y') this.vy = 0;
    }
  }

  // ------------------------------------------------------------------ Particles
  class Particles {
    constructor() { this.list = []; }
    add(p) { p.age = 0; if (p.life == null) p.life = 0.5; this.list.push(p); return p; }
    update(dt) {
      const l = this.list;
      for (let i = l.length - 1; i >= 0; i--) {
        const p = l[i];
        p.age += dt;
        if (p.age >= p.life) { l[i] = l[l.length - 1]; l.pop(); continue; }
        if (p.vx != null) {
          if (p.grav) p.vy += p.grav * dt;
          if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
        if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
      }
    }
    clear() { this.list.length = 0; }
  }

  MF.entities = { T, Player, Sentinel, Arrow, Grenade, Particles };
})(window.MF);
