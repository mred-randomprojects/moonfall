// Headless reachability test, run inside the game page (paste into the console or via the browser tool).
// For every room: BFS over solids using real physics; every platform, the ember, both doors and the beacon must be reachable.
(function () {
  const G = MF.game, T = MF.entities.T, ROOMS = MF.world.ROOMS;
  const STEP = G.STEP;
  const p = G.player;
  const results = {};
  G.manualDrive = true;
  const savedState = G.state;

  function silent() { return { moveX: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, swordPressed: false, bowHeld: false, grenadePressed: false, aimUp: false, aimDown: false, mouseAim: null, padAimY: 0 }; }

  function place(solid, x) {
    p.reset(x - p.w / 2, solid.y - p.h);
    p.invuln = 99; // ignore enemies for traversal
    G.arrows = []; G.grenades = []; G.particles.clear();
  }
  // a start position must not overlap any solid (collision resolution would teleport the box)
  function clearStart(solid, x) {
    const box = { x: x - p.w / 2, y: solid.y - p.h, w: p.w, h: p.h };
    return !G.solids.some((s) => s !== solid && MF.util.rectsOverlap(box, s));
  }
  function standingOn(solid) {
    return p.grounded && Math.abs(p.feetY - solid.y) < 1 && p.x + p.w > solid.x + 2 && p.x < solid.x + solid.w - 2;
  }
  // strategy: {run: dir, jumpAt: t, jumpHold: s, dbl: t|null, dash: t|null}
  function attempt(from, x, to, strat) {
    place(from, x);
    for (const e of G.enemies) e.dead = true; // no contact during traversal test
    let t = 0;
    while (t < 2.6) {
      const inp = silent();
      inp.moveX = t >= strat.runFrom ? strat.run : 0;
      inp.jumpPressed = Math.abs(t - strat.jumpAt) < STEP / 2;
      inp.jumpHeld = t >= strat.jumpAt - STEP / 2 && t < strat.jumpAt + strat.jumpHold;
      if (strat.dbl != null) { if (Math.abs(t - strat.dbl) < STEP / 2) inp.jumpPressed = true; if (t >= strat.dbl - STEP / 2 && t < strat.dbl + 0.3) inp.jumpHeld = true; }
      if (strat.dash != null && Math.abs(t - strat.dash) < STEP / 2) inp.dashPressed = true;
      G.stepWorld(STEP, inp);
      t += STEP;
      if (t > strat.jumpAt + 0.2 && standingOn(to)) return true;
      if (p.y > G.room.height + 40) return false;
    }
    return false;
  }
  function strategies(dir) {
    const out = [];
    for (const jumpAt of [0.05, 0.25]) {
      out.push({ run: dir, runFrom: 0, jumpAt, jumpHold: 0.4, dbl: null, dash: null });
      for (const dbl of [0.2, 0.38, 0.55, 0.75]) out.push({ run: dir, runFrom: 0, jumpAt, jumpHold: 0.4, dbl: jumpAt + dbl, dash: null });
      out.push({ run: dir, runFrom: 0, jumpAt, jumpHold: 0.4, dbl: jumpAt + 0.4, dash: jumpAt + 0.8 });
    }
    // plain walk-off / short hop
    out.push({ run: dir, runFrom: 0, jumpAt: 99, jumpHold: 0, dbl: null, dash: null });
    out.push({ run: dir, runFrom: 0, jumpAt: 0.05, jumpHold: 0.08, dbl: null, dash: null });
    return out;
  }

  for (const id in ROOMS) {
    G.state = { embers: { ruins: false, aqueduct: false, crypt: false, moonspire: false }, visited: new Set(), defeated: { ruins: new Set(), aqueduct: new Set(), crypt: new Set(), moonspire: new Set() }, beaconLit: false, won: false };
    G.loadRoom(id, ROOMS[id].start.x);
    G.mode = 'playing';
    const room = G.room, solids = room.solids;
    const startIdx = solids.findIndex((s) => s.type === 'ground' && room.start.x >= s.x && room.start.x <= s.x + s.w);
    const reached = new Set([startIdx]);
    const queue = [startIdx];
    const edges = [];
    while (queue.length) {
      const a = queue.shift();
      const A = solids[a];
      for (let b = 0; b < solids.length; b++) {
        if (reached.has(b)) continue;
        const B = solids[b];
        // only try plausible targets
        const dx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w), 0);
        if (dx > 420 || A.y - B.y > 260 || B.y - A.y > 900) continue;
        const dir0 = (B.x + B.w / 2) > (A.x + A.w / 2) ? 1 : -1;
        let ok = false;
        const xs = [];
        for (let x = A.x + 30; x <= A.x + A.w - 30; x += 40) if (clearStart(A, x)) xs.push(x);
        if (xs.length === 0 && clearStart(A, A.x + A.w / 2)) xs.push(A.x + A.w / 2);
        // start from the edge nearest to B first
        xs.sort((u, v) => dir0 > 0 ? v - u : u - v);
        outer: for (const x of xs) { const dir = (B.x + B.w / 2) > x ? 1 : -1; for (const st of strategies(dir)) { if (attempt(A, x, B, st)) { ok = true; edges.push([a, b, Math.round(x), JSON.stringify(st)]); break outer; } } }
        if (ok) { reached.add(b); queue.push(b); }
      }
    }
    const unreachable = solids.map((s, i) => i).filter((i) => !reached.has(i)).map((i) => solids[i]);
    // ember: from the best solid, jump straight up with a double jump
    let emberOk = false;
    const em = room.ember;
    for (let i = 0; i < solids.length && !emberOk; i++) {
      if (!reached.has(i)) continue;
      const S = solids[i];
      if (em.x < S.x - 60 || em.x > S.x + S.w + 60) continue;
      for (const x of [em.x, S.x + 20, S.x + S.w - 20]) {
        if (x < S.x + 22 || x > S.x + S.w - 22) continue;
        for (const dbl of [null, 0.38, 0.6]) {
          place(S, x); G.emberObj.collected = false; G.state.embers[id] = false;
          let t = 0;
          while (t < 2) {
            const inp = silent();
            inp.moveX = Math.abs(em.x - p.cx) > 6 ? Math.sign(em.x - p.cx) : 0;
            inp.jumpPressed = Math.abs(t - 0.05) < STEP / 2 || (dbl != null && Math.abs(t - dbl) < STEP / 2);
            inp.jumpHeld = (t >= 0.05 - STEP / 2 && t < 0.45) || (dbl != null && t >= dbl - STEP / 2 && t < dbl + 0.4);
            G.stepWorld(STEP, inp); t += STEP;
            if (G.emberObj.collected) { emberOk = true; break; }
          }
          if (emberOk) break;
        }
        if (emberOk) break;
      }
    }
    const groundIdx = (x) => solids.findIndex((s) => s.type === 'ground' && x >= s.x && x <= s.x + s.w);
    const doorsOk = room.doors.map((d) => ({ to: d.to, ok: reached.has(groundIdx(d.x + d.w / 2)) }));
    const beaconOk = room.beacon ? reached.has(groundIdx(room.beacon.x)) : null;
    results[id] = { solids: solids.length, reached: reached.size, unreachable, emberOk, doorsOk, beaconOk, edges: edges.length };
  }
  G.state = savedState;
  G.newAdventure();
  return results;
})();
