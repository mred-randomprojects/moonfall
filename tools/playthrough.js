// End-to-end playthrough bot. Runs inside the game page with the __sim harness (keyboard events + manual frames).
// Route: Ruins (ember) -> Aqueduct (ember) -> Moonspire (ember) -> Crypt (ember) -> Moonspire beacon -> victory.
(async function () {
  const G = MF.game, T = MF.entities.T, ROOMS = MF.world.ROOMS, S = window.__sim;
  const STEP = G.STEP, p = G.player;
  const report = { rooms: {}, ok: true, notes: [] };

  const silent = () => ({ moveX: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, swordPressed: false, bowHeld: false, grenadePressed: false, aimUp: false, aimDown: false, mouseAim: null, padAimY: 0 });
  const standingOn = (s) => p.grounded && Math.abs(p.feetY - s.y) < 1 && p.x + p.w > s.x + 2 && p.x < s.x + s.w - 2;
  const solidUnder = () => G.solids.findIndex((s) => standingOn(s));
  const clearStart = (solid, x) => { const box = { x: x - p.w / 2, y: solid.y - p.h, w: p.w, h: p.h }; return !G.solids.some((s) => s !== solid && MF.util.rectsOverlap(box, s)); };

  // ---- planning with headless physics (same as reach_test) ----
  function strategies(dir) {
    const out = [];
    for (const jumpAt of [0.05, 0.25]) {
      out.push({ run: dir, jumpAt, jumpHold: 0.4, dbl: null, dash: null });
      for (const dbl of [0.2, 0.38, 0.55, 0.75]) out.push({ run: dir, jumpAt, jumpHold: 0.4, dbl: jumpAt + dbl, dash: null });
      out.push({ run: dir, jumpAt, jumpHold: 0.4, dbl: jumpAt + 0.4, dash: jumpAt + 0.8 });
    }
    out.push({ run: dir, jumpAt: 99, jumpHold: 0, dbl: null, dash: null });
    out.push({ run: dir, jumpAt: 0.05, jumpHold: 0.08, dbl: null, dash: null });
    return out;
  }
  function simAttempt(from, x, to, st) {
    const save = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
    p.reset(x - p.w / 2, from.y - p.h); p.invuln = 99;
    const deadSave = G.enemies.map((e) => e.dead); G.enemies.forEach((e) => (e.dead = true));
    const emberSave = G.emberObj.collected; G.emberObj.collected = true;
    let t = 0, ok = false;
    while (t < 2.6) {
      const inp = silent(); inp.moveX = st.run;
      inp.jumpPressed = Math.abs(t - st.jumpAt) < STEP / 2; inp.jumpHeld = t >= st.jumpAt - STEP / 2 && t < st.jumpAt + st.jumpHold;
      if (st.dbl != null) { if (Math.abs(t - st.dbl) < STEP / 2) inp.jumpPressed = true; if (t >= st.dbl - STEP / 2 && t < st.dbl + 0.3) inp.jumpHeld = true; }
      if (st.dash != null && Math.abs(t - st.dash) < STEP / 2) inp.dashPressed = true;
      G.stepWorld(STEP, inp); t += STEP;
      if (t > st.jumpAt + 0.2 && standingOn(to)) { ok = true; break; }
      if (p.y > G.room.height + 40) break;
    }
    G.enemies.forEach((e, i) => (e.dead = deadSave[i])); G.emberObj.collected = emberSave;
    p.reset(save.x, save.y); p.vx = save.vx; p.vy = save.vy; p.invuln = 99;
    return ok;
  }
  function plan(fromIdx, goalTest) {
    // BFS with edge discovery; returns list of {from, to, x, st}
    const solids = G.solids;
    const prev = new Map([[fromIdx, null]]);
    const queue = [fromIdx];
    while (queue.length) {
      const a = queue.shift();
      if (goalTest(a)) {
        const path = []; let cur = a;
        while (prev.get(cur)) { path.unshift(prev.get(cur)); cur = prev.get(cur).from; }
        return path;
      }
      const A = solids[a];
      for (let b = 0; b < solids.length; b++) {
        if (prev.has(b)) continue;
        const B = solids[b];
        const dx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w), 0);
        if (dx > 420 || A.y - B.y > 260 || B.y - A.y > 900) continue;
        const dir0 = (B.x + B.w / 2) > (A.x + A.w / 2) ? 1 : -1;
        const xs = []; for (let x = A.x + 30; x <= A.x + A.w - 30; x += 40) if (clearStart(A, x)) xs.push(x); if (!xs.length && clearStart(A, A.x + A.w / 2)) xs.push(A.x + A.w / 2);
        xs.sort((u, v) => (dir0 > 0 ? v - u : u - v));
        let found = null;
        outer: for (const x of xs) { const dir = (B.x + B.w / 2) > x ? 1 : -1; for (const st of strategies(dir)) if (simAttempt(A, x, B, st)) { found = { from: a, to: b, x, st: JSON.parse(JSON.stringify(st)) }; break outer; } }
        if (found) { prev.set(b, found); queue.push(b); }
      }
    }
    return null;
  }

  // ---- execution with real key events through the frame loop ----
  const KEY = { 1: 'KeyD', '-1': 'KeyA' };
  function runFrames(n) { S.run(n * 16.667); p.invuln = 99; }
  function settle() { let g = 0; while ((!p.grounded || Math.abs(p.vx) > 4 || solidUnder() < 0) && g++ < 240) runFrames(1); return solidUnder(); }
  async function walkTo(x) {
    let guard = 0;
    while (Math.abs(p.cx - x) > 6 && guard++ < 400) {
      const dir = Math.sign(x - p.cx); S.kd(KEY[dir]); runFrames(1); S.ku(KEY[dir]);
      if (!p.grounded && p.vy > 0 && p.fallT > 0.3) return false;
    }
    let g2 = 0; while (Math.abs(p.vx) > 4 && g2++ < 60) runFrames(1);
    return Math.abs(p.cx - x) <= 12;
  }
  async function execEdge(edge) {
    const B = G.solids[edge.to], st = edge.st;
    if (!(await walkTo(edge.x))) return false;
    const dirKey = KEY[st.run];
    S.kd(dirKey);
    let t = 0, ok = false, jumped = false, jumpDown = false, dblDown = false, dblDone = false, dashed = false;
    while (t < 2.6) {
      if (!jumped && st.jumpAt < 90 && t >= st.jumpAt) { S.kd('Space'); jumpDown = true; jumped = true; }
      if (jumpDown && t >= st.jumpAt + st.jumpHold && !dblDown && (st.dbl == null || t < st.dbl)) { S.ku('Space'); jumpDown = false; }
      if (st.dbl != null && !dblDown && !dblDone && t >= st.dbl) { if (jumpDown) { S.ku('Space'); runFrames(1); t += 1 / 60; } S.kd('Space'); dblDown = true; }
      if (dblDown && t >= st.dbl + 0.3) { S.ku('Space'); dblDown = false; dblDone = true; }
      if (st.dash != null && !dashed && t >= st.dash) { S.kd('ShiftLeft'); runFrames(1); S.ku('ShiftLeft'); dashed = true; t += 1 / 60; }
      runFrames(1); t += 1 / 60;
      if (t > (st.jumpAt < 90 ? st.jumpAt : 0) + 0.2 && standingOn(B)) { ok = true; break; }
      if (p.y > G.room.height + 40) break;
    }
    S.ku(dirKey); S.ku('Space');
    let g = 0; while (Math.abs(p.vx) > 4 && g++ < 60) runFrames(1);
    return ok;
  }
  async function followPath(path, label) {
    for (let i = 0; i < path.length; i++) {
      const e = path[i];
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        // make sure we are on the source solid
        if (settle() !== e.from) {
          const back = plan(settle(), (i2) => i2 === e.from);
          if (!back) break;
          for (const be of back) if (!(await execEdge(be))) break;
        }
        ok = await execEdge(e);
      }
      if (!ok) { report.ok = false; report.notes.push(`${label}: failed edge ${e.from}->${e.to} at x=${e.x}`); return false; }
    }
    return true;
  }
  async function collectEmberFrom() {
    const em = G.room.ember;
    for (let tries = 0; tries < 4 && !G.emberObj.collected; tries++) {
      const dir = Math.sign(em.x - p.cx) || 1;
      await walkTo(em.x);
      S.kd('Space'); runFrames(3); let t = 0;
      while (t < 1.6 && !G.emberObj.collected) {
        if (t > 0.42 && t < 0.45) S.ku('Space');
        if (t > 0.5 && t < 0.52) S.kd('Space');
        const d = Math.sign(em.x - p.cx); if (Math.abs(em.x - p.cx) > 8) { S.kd(KEY[d]); runFrames(1); S.ku(KEY[d]); } else runFrames(1);
        t += 1 / 60;
      }
      S.ku('Space'); runFrames(40);
    }
    return G.emberObj.collected;
  }
  async function useDoor(to) {
    const d = G.room.doors.find((x) => x.to === to);
    const gi = G.solids.findIndex((s) => s.type === 'ground' && d.x + d.w / 2 >= s.x && d.x + d.w / 2 <= s.x + s.w);
    const path = plan(settle(), (i) => i === gi);
    if (path === null) { report.notes.push('no path to door ' + to); report.ok = false; return false; }
    if (!(await followPath(path, 'door ' + to))) return false;
    await walkTo(d.x + d.w / 2);
    runFrames(5);
    if (!G.nearDoor) { report.notes.push('not near door ' + to + ' cx=' + p.cx); report.ok = false; return false; }
    S.kd('KeyE'); runFrames(1); S.ku('KeyE');
    let g = 0; while (G.mode !== 'playing' && g++ < 120) runFrames(1);
    return G.room.id === to;
  }
  async function doRoom(id) {
    const rr = { start: Math.round(p.cx) };
    const em = G.room.ember;
    // goal: a reached solid under the ember
    const path = plan(settle(), (i) => { const s = G.solids[i]; return em.x >= s.x - 40 && em.x <= s.x + s.w + 40 && s.y - em.y > 40 && s.y - em.y < 240; });
    if (!path) { report.notes.push(id + ': no path to ember'); report.ok = false; return rr; }
    rr.edges = path.length;
    if (!(await followPath(path, id))) return rr;
    rr.ember = await collectEmberFrom();
    if (!rr.ember) { report.ok = false; report.notes.push(id + ': ember not collected'); }
    rr.hp = p.hp;
    report.rooms[id] = rr;
    return rr;
  }

  // ---- go ----
  G.newAdventure(); S.ready(); runFrames(30);
  await doRoom('ruins');
  if (!(await useDoor('aqueduct'))) return report;
  await doRoom('aqueduct');
  if (!(await useDoor('moonspire'))) return report;
  await doRoom('moonspire');
  if (!(await useDoor('crypt'))) return report;
  await doRoom('crypt');
  if (!(await useDoor('moonspire'))) return report;
  // beacon
  const b = G.room.beacon;
  const gi = G.solids.findIndex((s) => s.type === 'ground' && b.x >= s.x && b.x <= s.x + s.w);
  const path = plan(settle(), (i) => i === gi);
  if (path && (await followPath(path, 'beacon'))) {
    await walkTo(b.x); runFrames(5);
    report.nearBeacon = G.nearBeacon;
    S.kd('KeyE'); runFrames(1); S.ku('KeyE'); runFrames(10);
    report.beaconLit = G.state.beaconLit;
    await new Promise((r) => setTimeout(r, 2300)); runFrames(5);
    report.mode = G.mode; report.won = G.state.won;
  } else { report.ok = false; report.notes.push('no path to beacon'); }
  report.embers = { ...G.state.embers }; report.visited = [...G.state.visited]; report.hp = p.hp; report.time = G.time.toFixed(1);
  return report;
})();
