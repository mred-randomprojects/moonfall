// Headless reachability test, run inside the game page (paste into the console or via the browser tool), or from
// Node with `node tools/run_reach.js` (the deploy runs that before it publishes).
// For every room, from every way into it (its start and each door that leads there): BFS over solids using real
// physics; every platform, the ember, both doors and the beacon must be reachable. It ends on a new adventure.
(function () {
  const G = MF.game, T = MF.entities.T, ROOMS = MF.world.ROOMS;
  const STEP = G.STEP;
  const p = G.player;
  const results = {};
  // manualDrive stops the page's own loop from stepping the world while the bot drives it. Both it and the mode
  // go back to what they were at the end, or the page would stay frozen (or "playing" behind the entry screen).
  const savedState = G.state, savedManualDrive = G.manualDrive, savedMode = G.mode;
  G.manualDrive = true;

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

  // Every way into a room: its start, and each door that leads here. game.js updateTransition drops the player at
  // this room's door back to where they came from (or at the start, if there is none).
  function entrances(id) {
    const room = ROOMS[id], out = [{ from: 'start', x: room.start.x }];
    for (const from in ROOMS) {
      if (!ROOMS[from].doors.some((d) => d.to === id)) continue;
      const back = room.doors.find((d) => d.to === from);
      out.push({ from, x: back ? back.x + back.w / 2 : room.start.x });
    }
    return out;
  }
  const groundIdx = (solids, x) => solids.findIndex((s) => s.type === 'ground' && x >= s.x && x <= s.x + s.w);

  // Everything reachable in room `id` for a player who appears at `spawnX` on the ground.
  function explore(id, spawnX) {
    G.state = { embers: { ruins: false, aqueduct: false, crypt: false, moonspire: false }, visited: new Set(), defeated: { ruins: new Set(), aqueduct: new Set(), crypt: new Set(), moonspire: new Set() }, beaconLit: false, won: false };
    G.loadRoom(id, spawnX);
    G.mode = 'playing';
    const room = G.room, solids = room.solids;
    const startIdx = groundIdx(solids, spawnX);
    if (startIdx < 0) throw new Error(`${id}: no ground under the spawn point x=${spawnX}`);
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
    const doorsOk = room.doors.map((d) => ({ to: d.to, ok: reached.has(groundIdx(solids, d.x + d.w / 2)) }));
    const beaconOk = room.beacon ? reached.has(groundIdx(solids, room.beacon.x)) : null;
    return { solids: solids.length, reached: reached.size, unreachable, emberOk, doorsOk, beaconOk, edges: edges.length };
  }

  try {
    for (const id in ROOMS) {
      // The BFS only depends on the solid it starts from: entrances on the same ground share one run.
      const byStart = new Map();
      const runs = entrances(id).map(({ from, x }) => {
        const idx = groundIdx(ROOMS[id].solids, x);
        if (!byStart.has(idx)) byStart.set(idx, explore(id, x));
        return Object.assign({ from, x }, byStart.get(idx));
      });
      // The start's run, as before, plus one per door that leads here.
      results[id] = Object.assign({}, runs[0], { fromDoors: runs.slice(1) });
    }
  } finally {
    G.state = savedState;
    G.newAdventure();
    G.manualDrive = savedManualDrive;
    G.mode = savedMode;
  }
  return results;
})();
