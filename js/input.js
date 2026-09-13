// Unified input: keyboard, mouse (bow aim), gamepad, touch buttons -> abstract actions.
(function (MF) {
  'use strict';
  const { clamp } = MF.util;

  const KEYMAP = {
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'jump', ArrowUp: 'jump',
    ShiftLeft: 'dash', ShiftRight: 'dash',
    KeyJ: 'sword', KeyX: 'sword',
    KeyK: 'bow',
    KeyW: 'aimUp', KeyS: 'aimDown', ArrowDown: 'aimDown',
    KeyG: 'grenade', KeyL: 'grenade',
    KeyE: 'interact',
    KeyM: 'map',
    Escape: 'pause',
    KeyR: 'restart',
  };
  // Same query as the inline script in index.html that classes <html> before first paint.
  const MOBILE_QUERY = '(pointer: coarse) and (hover: none)';
  const ACTIONS = ['left', 'right', 'jump', 'dash', 'sword', 'bow', 'aimUp', 'aimDown', 'grenade', 'interact', 'map', 'pause', 'restart'];

  const I = {
    down: {}, pressed: {}, released: {},
    keyDown: {}, padDown: {}, touchDown: {}, mouseBow: false,
    mouse: { x: 640, y: 325, inside: false, right: false },
    pad: { connected: false, moveX: 0, aimY: 0, name: '' },
    touchAvailable: false,
    mobile: false,             // coarse pointer and no hover: a phone or tablet, not a touch laptop
    touchAimY: 0,              // bow aim from dragging the BOW button, -1 (up) .. 1 (down)
    resetTouch: null,
    lastDevice: 'keyboard',
    stage: null, scale: 1,
  };
  ACTIONS.forEach((a) => { I.down[a] = false; I.pressed[a] = false; I.released[a] = false; });

  function setAction(a, v, source) {
    const prev = I.down[a];
    I.down[a] = v;
    if (v && !prev) I.pressed[a] = true;
    if (!v && prev) I.released[a] = true;
    if (source) I.lastDevice = source;
  }
  // Combined state from all devices
  function recompute(a) {
    const v = !!(I.keyDown[a] || I.padDown[a] || I.touchDown[a] || (a === 'bow' && I.mouseBow));
    setAction(a, v);
  }

  function onKey(e, isDown) {
    const a = KEYMAP[e.code];
    if (!a) return;
    // don't steal typing from inputs / sliders
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.type !== 'range') return;
    if (t && t.type === 'range' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown')) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (isDown && e.repeat) return;
    I.keyDown[a] = isDown;
    I.lastDevice = 'keyboard';
    if (a === 'aimUp' || a === 'aimDown') I.touchAimY = 0; // keyboard aim wins over a stale touch aim
    recompute(a);
  }

  function toLogical(clientX, clientY) {
    const r = I.stage.getBoundingClientRect();
    // the canvas is object-fit: contain inside the stage in fullscreen; otherwise fills it
    const sx = 1280 / r.width, sy = 650 / r.height;
    const s = Math.max(sx, sy);
    const cw = 1280 / s, ch = 650 / s;
    const ox = (r.width - cw) / 2, oy = (r.height - ch) / 2;
    return { x: (clientX - r.left - ox) * s, y: (clientY - r.top - oy) * s };
  }

  function bindMouse(stage) {
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const p = toLogical(e.clientX, e.clientY);
      I.mouse.x = p.x; I.mouse.y = p.y; I.mouse.inside = true;
    });
    stage.addEventListener('pointerleave', () => { I.mouse.inside = false; });
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 2) { I.mouseBow = true; I.mouse.right = true; I.lastDevice = 'mouse'; recompute('bow'); e.preventDefault(); }
    });
    const up = (e) => {
      if (e.button === 2 && I.mouseBow) { I.mouseBow = false; I.mouse.right = false; recompute('bow'); }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // Touch: a slide-able move pad on the left and action buttons on the right. The container is
  // laid out in real CSS pixels (not the scaled 1280x650 box) so thumbs always get full-size targets.
  function bindTouch(container) {
    const buttons = container.querySelectorAll('[data-act]');
    buttons.forEach((b) => {
      const act = b.dataset.act;
      let startY = 0;
      const press = (e) => {
        e.preventDefault();
        b.classList.add('down'); I.touchDown[act] = true; I.lastDevice = 'touch';
        if (act === 'bow') { startY = e.clientY; I.touchAimY = 0; }
        recompute(act);
        try { b.setPointerCapture(e.pointerId); } catch (_) {}
      };
      // hold BOW and drag up or down to aim; ~70px of travel covers the whole arc
      const move = (e) => { if (act === 'bow' && I.touchDown.bow) I.touchAimY = clamp((e.clientY - startY) / 70, -1, 1); };
      // the aim is kept until the next draw: the arrow is loosed on the frame the button is released
      const release = (e) => { if (e) e.preventDefault(); b.classList.remove('down'); I.touchDown[act] = false; recompute(act); };
      b.addEventListener('pointerdown', press);
      b.addEventListener('pointermove', move);
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', release);
    });

    // Move pad: whichever half the thumb is over drives left/right, and sliding across the pad
    // switches direction without lifting. A few px of hysteresis around the middle stops jitter.
    const pad = container.querySelector('.tpad');
    let active = null, cur = null;
    const halves = pad ? { left: pad.querySelector('[data-dir="left"]'), right: pad.querySelector('[data-dir="right"]') } : null;
    const steer = (dir) => {
      cur = dir;
      for (const d of ['left', 'right']) {
        const on = d === dir;
        if (halves) halves[d].classList.toggle('down', on);
        if (!!I.touchDown[d] !== on) { I.touchDown[d] = on; recompute(d); }
      }
    };
    if (pad) {
      const dirAt = (e) => {
        const r = pad.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        if (Math.abs(dx) < 8 && cur) return cur;
        return dx < 0 ? 'left' : 'right';
      };
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (active !== null) return; // one thumb steers; a second finger on the pad is ignored
        active = e.pointerId; I.lastDevice = 'touch';
        try { pad.setPointerCapture(e.pointerId); } catch (_) {}
        steer(dirAt(e));
      });
      pad.addEventListener('pointermove', (e) => { if (e.pointerId === active) steer(dirAt(e)); });
      const end = (e) => { if (e.pointerId !== active) return; active = null; steer(null); };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('lostpointercapture', end);
    }
    I.resetTouch = () => { active = null; steer(null); I.touchAimY = 0; buttons.forEach((b) => b.classList.remove('down')); };

    // iOS Safari zooms on a double tap (which is exactly what a double jump is) no matter what
    // touch-action says or what pointer events prevent; only cancelling the touch events
    // themselves stops it. The controls run on pointer events, so nothing here needs clicks.
    const swallow = (e) => { if (e.cancelable) e.preventDefault(); };
    for (const t of ['touchstart', 'touchend', 'touchmove']) container.addEventListener(t, swallow, { passive: false });
  }

  // The rest of the stage keeps its clicks (Enter, Resume, HUD buttons): only the second tap of
  // a double tap is cancelled, the one that would zoom. Pinches (iOS gesture events) too.
  function guardZoom(stage) {
    let lastTap = 0;
    stage.addEventListener('touchend', (e) => {
      const now = performance.now();
      if (now - lastTap < 350 && e.cancelable) e.preventDefault();
      lastTap = now;
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('dblclick', (e) => { if (I.mobile) e.preventDefault(); });
  }

  // Standard gamepad mapping
  const PAD = { 0: 'jump', 2: 'sword', 3: 'bow', 1: 'grenade', 4: 'dash', 5: 'dash', 12: 'interact', 8: 'map', 9: 'pause' };
  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    I.pad.connected = !!gp;
    const next = {};
    if (gp) {
      I.pad.name = gp.id;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, ry = gp.axes[3] || 0;
      const dead = 0.25;
      I.pad.moveX = Math.abs(ax) > dead ? ax : 0;
      I.pad.aimY = Math.abs(ry) > dead ? ry : 0;
      const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
      for (const k in PAD) if (btn(+k)) next[PAD[k]] = true;
      if (btn(14) || ax < -dead) next.left = true;
      if (btn(15) || ax > dead) next.right = true;
      if (btn(13) || ay > 0.6) next.aimDown = true;
      if (ry < -0.4) next.aimUp = true;
      if (ry > 0.4) next.aimDown = true;
      let any = false;
      for (const k in next) if (next[k]) any = true;
      if (any) I.lastDevice = 'gamepad';
    }
    for (const a of ACTIONS) {
      const v = !!next[a];
      if (v !== !!I.padDown[a]) { I.padDown[a] = v; recompute(a); }
    }
  }

  function endFrame() {
    for (const a of ACTIONS) { I.pressed[a] = false; I.released[a] = false; }
  }

  // Drop every held control (focus loss, room change, pause) without generating release events.
  function clearAll() {
    for (const a of ACTIONS) {
      I.keyDown[a] = false; I.padDown[a] = false; I.touchDown[a] = false;
      I.down[a] = false; I.pressed[a] = false; I.released[a] = false;
    }
    I.mouseBow = false; I.mouse.right = false;
    if (I.resetTouch) I.resetTouch();
  }

  function init(stage, touchContainer) {
    I.stage = stage;
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    bindMouse(stage);
    guardZoom(stage);
    I.touchAvailable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches);
    I.mobile = matchMedia(MOBILE_QUERY).matches;
    if (touchContainer) bindTouch(touchContainer);
    window.addEventListener('gamepadconnected', () => { I.pad.connected = true; });
  }

  MF.input = I;
  I.init = init; I.pollGamepad = pollGamepad; I.endFrame = endFrame; I.clearAll = clearAll; I.toLogical = toLogical;
})(window.MF);
