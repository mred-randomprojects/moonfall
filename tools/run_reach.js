#!/usr/bin/env node
// "Every room is still winnable": the deploy runs this before it publishes. Run it yourself after touching the
// tuning in js/entities.js, the rooms in js/world.js or the asset paths.
//
//   node tools/run_reach.js
//
// It loads the game's own scripts, in index.html order, into a Node vm. The browser-only modules (audio, input,
// render, ui) become no-op stand-ins and DOMContentLoaded never fires, so the main loop never starts. Then it runs
// tools/reach_test.js against the real physics and rooms, and checks that every image the game loads is in the repo.
// Exits 1 on an unreachable platform, ember, door or beacon, or a missing image.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const STUBBED = ['js/audio.js', 'js/input.js', 'js/render.js', 'js/ui.js'];

// Every property is a no-op function. Functions are objects, so the game can also store fields on one
// (`audio.state.listenerX = …`).
function stub() {
  const fns = Object.create(null);
  return new Proxy({}, { get: (_, key) => (typeof key === 'symbol' ? undefined : (fns[key] ||= function () {})) });
}

// Exact case: macOS forgives a wrong one, the Linux runner and GitHub Pages do not.
function existsExactCase(rel) {
  let at = ROOT;
  for (const part of rel.split('/')) {
    if (!fs.existsSync(at) || !fs.statSync(at).isDirectory() || !fs.readdirSync(at).includes(part)) return false;
    at = path.join(at, part);
  }
  return fs.statSync(at).isFile();
}

async function main() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  for (const need of [...STUBBED, 'js/game.js']) {
    if (!scripts.includes(need)) throw new Error(`index.html no longer loads ${need}: update tools/run_reach.js`);
  }

  const requested = [];
  // The asset loader's only browser dependency: record what it asks for, and say it loaded.
  class Image {
    set src(value) { requested.push(value); this.onload(); }
  }
  const sandbox = {
    console, Image,
    performance: { now: () => 0 },
    setTimeout: () => 0,
    addEventListener() {}, // DOMContentLoaded never fires: no boot(), no main loop
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const src of scripts) {
    if (STUBBED.includes(src)) {
      sandbox.MF = sandbox.MF || {};
      sandbox.MF[path.basename(src, '.js')] = stub();
      continue;
    }
    vm.runInContext(fs.readFileSync(path.join(ROOT, src), 'utf8'), sandbox, { filename: src });
  }

  const failures = [];

  // ---- reachability, from the start of every room and from every door into it
  const started = Date.now();
  const results = vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/reach_test.js'), 'utf8'), sandbox, { filename: 'tools/reach_test.js' });
  const rooms = Object.keys(sandbox.MF.world.ROOMS);
  if (!results || rooms.length === 0 || rooms.some((id) => !results[id])) throw new Error('reach_test.js did not return a result for every room');
  for (const id of rooms) {
    for (const run of [results[id], ...results[id].fromDoors]) {
      const where = `${id}, from ${run.from}`;
      const doors = run.doorsOk.map((d) => `${d.to} ${d.ok ? 'ok' : 'NO'}`).join(', ');
      const beacon = run.beaconOk === null ? '' : ` · beacon ${run.beaconOk ? 'ok' : 'NO'}`;
      console.log(`${where.padEnd(28)} ${run.reached}/${run.solids} solids · ember ${run.emberOk ? 'ok' : 'NO'} · doors ${doors}${beacon}`);
      for (const s of run.unreachable) failures.push(`${where}: unreachable ${s.type} at x=${s.x} y=${s.y} w=${s.w}`);
      if (run.emberOk === false) failures.push(`${where}: the ember cannot be reached`);
      for (const d of run.doorsOk) if (d.ok === false) failures.push(`${where}: the door to ${d.to} cannot be reached`);
      if (run.beaconOk === false) failures.push(`${where}: the beacon cannot be reached`);
    }
  }
  console.log(`Reachability: ${((Date.now() - started) / 1000).toFixed(1)} s`);

  // ---- every image the game loads (js/sprites.js FILES) and every strip in js/spritedata.js
  await sandbox.MF.sprites.load();
  const spriteFiles = Object.values(sandbox.SPRITE_DATA || {}).map((a) => a.file);
  const paths = [...new Set([...requested, ...spriteFiles])];
  if (requested.length === 0) failures.push('js/sprites.js requested no images: the asset check saw nothing');
  for (const rel of paths) if (!existsExactCase(rel)) failures.push(`missing asset (or wrong letter case): ${rel}`);
  console.log(`Assets: ${paths.length} paths checked`);

  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} problem(s)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nOK: every room is still winnable, from every way in.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
