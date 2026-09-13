// Asset loading and sprite-strip drawing.
(function (MF) {
  'use strict';

  const ANIM_ORDER = ['idle', 'run', 'sword', 'bow', 'grenade', 'jump', 'land'];
  const ANIM_LABEL = { idle: 'Idle', run: 'Run', sword: 'Sword', bow: 'Bow', grenade: 'Grenade throw', jump: 'Jump', land: 'Fall and landing' };
  const ANIM_DESC = {
    idle: 'Subtle breathing and scarf movement',
    run: 'Clear stride cycle and weight transfer',
    sword: 'Anticipation, strike, and recovery',
    bow: 'Draw, aim, and release',
    grenade: 'Wind-up, release, and follow-through',
    jump: 'Takeoff and ascent poses',
    land: 'Descent and grounded recovery',
  };

  const SPR = {
    data: window.SPRITE_DATA || {},
    images: {},
    scale: 100 / 172, // 172px standing sprite -> 100 world units tall
    ready: false,
    ANIM_ORDER, ANIM_LABEL, ANIM_DESC,
  };

  const FILES = {
    sky: 'assets/ruins.png',
    mid: 'assets/parallax-mid.png',
    frontL: 'assets/sprites/front-vines-left.png',
    frontR: 'assets/sprites/front-vines-right.png',
    frontRubble: 'assets/sprites/front-rubble.png',
  };
  for (const k of ANIM_ORDER) FILES['anim_' + k] = SPR.data[k] ? SPR.data[k].file : null;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Failed to load ' + src));
      im.src = src;
    });
  }

  function load(onProgress) {
    const keys = Object.keys(FILES).filter((k) => FILES[k]);
    let done = 0;
    return Promise.all(keys.map((k) => loadImage(FILES[k]).then((im) => {
      SPR.images[k] = im; done++;
      if (onProgress) onProgress(done, keys.length, k);
    }))).then(() => { SPR.ready = true; return SPR; });
  }

  function anim(name) { return SPR.data[name]; }
  function image(name) { return SPR.images['anim_' + name]; }

  // Draw frame `f` of animation `name` with the foot anchor at world (x, y).
  // facing: 1 right, -1 left. opts: {alpha, scale, rot (radians, around pivot), pivotY (world units above feet)}
  function drawFrame(ctx, name, f, x, y, facing, opts) {
    const a = anim(name), im = image(name);
    if (!a || !im) return;
    const n = a.frames;
    f = ((Math.floor(f) % n) + n) % n;
    const s = (opts && opts.scale) || SPR.scale;
    ctx.save();
    if (opts && opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    ctx.translate(x, y);
    if (opts && opts.rot) {
      const py = -(opts.pivotY || 0);
      ctx.translate(0, py); ctx.rotate(opts.rot * (facing || 1)); ctx.translate(0, -py);
    }
    ctx.scale((facing || 1) * s, s);
    ctx.drawImage(im, f * a.fw, 0, a.fw, a.fh, -a.ax, -a.ay, a.fw, a.fh);
    ctx.restore();
  }

  MF.sprites = SPR;
  SPR.load = load; SPR.drawFrame = drawFrame; SPR.anim = anim; SPR.image = image;
})(window.MF);
