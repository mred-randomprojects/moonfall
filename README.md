# Moonfall — The Four Embers

A moonlit 2D platformer in plain HTML, CSS and JavaScript. Four regions, three
weapons, four embers to carry back to the beacon.

**Play it:** https://mred-randomprojects.github.io/moonfall/

Works with keyboard, gamepad, or touch. On a phone, turn it to landscape — the
whole screen becomes the game, with a slide-able move pad on the left and the
action buttons on the right. Add it to your home screen for a fullscreen app.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Move | A / D · ← → | slide on the ◀ ▶ pad | stick / d-pad |
| Jump · double-jump | Space · ↑ (release early for a short hop) | JUMP (tap = hop, hold = full) | A |
| Dash | Shift | DASH | LB / RB |
| Sword | J · X | SWD | X |
| Bow | hold K, release to fire · W / S aim · or hold right mouse to aim | hold BOW, drag up/down to aim, release | hold Y · right stick aims |
| Grenade | G · L | GRN | B |
| Enter door · light beacon | E | USE | d-pad ↑ |
| Map | M | tap the minimap | View |
| Pause | Esc | ❚❚ in the HUD | Menu |
| Restart adventure | hold R | pause menu | — |

## Running locally

Any static server will do — the assets must be served over HTTP:

```bash
python3 -m http.server 8765
```

then open http://localhost:8765/.

## Layout

- `index.html`, `css/style.css` — page, HUD, overlays, touch layout
- `js/` — `input.js` (keyboard / mouse / gamepad / touch → actions), `entities.js`
  (player, sentinels, projectiles), `world.js` (rooms), `render.js`, `ui.js`,
  `audio.js`, `game.js` (state machine and main loop)
- `assets/` — parallax layers and the sprite sheets cut from the source art
- `tools/` — sprite / scenery / icon builders (Python + Pillow), the reachability
  bot (`reach_test.js`: in the page, or headless through `run_reach.js`) and the
  in-page playthrough bot
- `specs.txt` — the original design brief

## Checking

```bash
node tools/run_reach.js
```

Runs the reachability bot headlessly on the real physics (Node 22, see `.nvmrc`;
no install): every platform, ember, door and the beacon must be reachable from
the start of every room and from every door into it, and every image the game
loads must exist. It takes a few seconds and exits 1 on any failure. Run it after
changing the tuning in `js/entities.js`, the rooms in `js/world.js` or an asset
path.

## Deploying

Push to `main`; `.github/workflows/deploy.yml` runs `node tools/run_reach.js`
and, only if every room is still winnable, publishes the repo (minus tooling) to
GitHub Pages.
