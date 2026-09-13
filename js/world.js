// Room definitions: geometry, enemies, embers, doors, palettes.
(function (MF) {
  'use strict';

  const GROUND_Y = 640;      // top of ground surfaces
  const ROOM_H = 760;        // room height in world units
  const PLAT_H = 26;
  const VIEW_W = 1280, VIEW_H = 650;

  function ground(segs) {
    return segs.map(([a, b]) => ({ x: a, y: GROUND_Y, w: b - a, h: ROOM_H + 200 - GROUND_Y, type: 'ground' }));
  }
  function plats(list) {
    return list.map(([x, y, w]) => ({ x, y, w, h: PLAT_H, type: 'platform' }));
  }
  function door(x, to, label) {
    return { x, y: GROUND_Y - 128, w: 84, h: 128, to, label };
  }

  const ROOMS = {
    ruins: {
      id: 'ruins', name: 'The Outer Ruins', sub: 'Where the last light lingers.',
      width: 2840, height: ROOM_H, seed: 11,
      palette: {
        sky: null, tintMode: null, tint: null, moon: 1.0,
        stone: '#2b3550', stoneDark: '#1b2238', stoneLight: '#5d6f95', edge: '#b9c9e6', moss: '#3f7f7a',
        mist: 'rgba(150,180,220,0.10)', glow: 'rgba(150,190,255,0.35)', water: null, cracks: null,
      },
      start: { x: 140 },
      solids: [
        ...ground([[0, 900], [1080, 1700], [1920, 2840]]),
        ...plats([
          [330, 548, 150], [540, 462, 140], [740, 376, 130],
          [960, 552, 120],
          [1250, 530, 170], [1480, 445, 140],
          [1790, 548, 140],
          [2150, 520, 160], [2380, 430, 150], [2600, 520, 150],
        ]),
      ],
      enemies: [{ x: 600, y: 578, range: 90 }, { x: 1335, y: 468, range: 70 }, { x: 2250, y: 578, range: 100 }],
      ember: { x: 805, y: 318 },
      doors: [door(1590, 'crypt', 'The Ember Crypt'), door(2740, 'aqueduct', 'The Drowned Aqueduct')],
    },
    aqueduct: {
      id: 'aqueduct', name: 'The Drowned Aqueduct', sub: 'Follow the silver water.',
      width: 3400, height: ROOM_H, seed: 23,
      palette: {
        tintMode: 'multiply', tint: 'rgba(120,200,215,0.55)', moon: 0.85,
        stone: '#23384a', stoneDark: '#15222f', stoneLight: '#4f7f8f', edge: '#a8e2e6', moss: '#3a8f86',
        mist: 'rgba(120,210,220,0.13)', glow: 'rgba(120,230,240,0.4)', water: 'rgba(130,200,230,0.55)', cracks: null,
      },
      start: { x: 130 },
      solids: [
        ...ground([[0, 700], [900, 1500], [1760, 2300], [2540, 3400]]),
        ...plats([
          [760, 560, 110],
          [1000, 550, 140], [1220, 460, 140], [1420, 550, 130],
          [1590, 540, 120],
          [1880, 540, 150], [2080, 450, 140], [2260, 540, 130],
          [2380, 530, 120],
          [2700, 548, 150], [2900, 462, 140], [3080, 376, 130], [3240, 290, 120],
        ]),
      ],
      enemies: [{ x: 480, y: 578, range: 90 }, { x: 1290, y: 398, range: 70 }, { x: 2000, y: 578, range: 100 }, { x: 2820, y: 578, range: 100 }],
      ember: { x: 3300, y: 232 },
      doors: [door(130, 'ruins', 'The Outer Ruins'), door(3290, 'moonspire', 'The Moonspire')],
    },
    crypt: {
      id: 'crypt', name: 'The Ember Crypt', sub: 'A fire beneath the stone.',
      width: 2800, height: ROOM_H, seed: 37,
      palette: {
        tintMode: 'multiply', tint: 'rgba(170,120,90,0.62)', moon: 0.55,
        stone: '#33302f', stoneDark: '#1d1a1a', stoneLight: '#6b5a4a', edge: '#d9b58a', moss: '#6a5a2a',
        mist: 'rgba(230,150,80,0.08)', glow: 'rgba(255,170,90,0.4)', water: null, cracks: 'rgba(255,140,60,0.75)',
      },
      start: { x: 130 },
      solids: [
        ...ground([[0, 600], [800, 1400], [1600, 2100], [2320, 2800]]),
        ...plats([
          [660, 556, 120],
          [950, 548, 150], [1160, 462, 140], [1450, 548, 130],
          [1700, 470, 150], [1900, 385, 140], [2140, 470, 150],
          [2400, 400, 140], [2570, 315, 130], [2700, 230, 100],
        ]),
      ],
      enemies: [{ x: 420, y: 578, range: 90 }, { x: 1230, y: 400, range: 70 }, { x: 1970, y: 323, range: 70 }, { x: 2500, y: 578, range: 100 }],
      ember: { x: 2750, y: 172 },
      doors: [door(130, 'ruins', 'The Outer Ruins'), door(2680, 'moonspire', 'The Moonspire')],
    },
    moonspire: {
      id: 'moonspire', name: 'The Moonspire', sub: 'Bring the four embers home.',
      width: 3200, height: ROOM_H, seed: 51,
      palette: {
        tintMode: 'screen', tint: 'rgba(90,80,150,0.16)', moon: 1.25,
        stone: '#30345a', stoneDark: '#1c1f3a', stoneLight: '#6e74a8', edge: '#dfe4ff', moss: '#4f6f9a',
        mist: 'rgba(190,190,255,0.12)', glow: 'rgba(200,200,255,0.45)', water: null, cracks: null,
      },
      start: { x: 130 },
      solids: [
        ...ground([[0, 800], [1000, 1700], [1900, 2400], [2600, 3200]]),
        ...plats([
          [380, 548, 140], [560, 462, 130], [720, 376, 120],
          [860, 548, 120],
          [1120, 500, 160], [1320, 410, 150], [1520, 320, 140], [1680, 236, 120],
          [1790, 540, 120],
          [2050, 480, 160], [2250, 390, 140],
          [2470, 520, 130],
          [2680, 460, 150], [2840, 370, 140], [2980, 290, 120],
        ]),
      ],
      enemies: [{ x: 520, y: 578, range: 90 }, { x: 1250, y: 578, range: 100 }, { x: 1600, y: 258, range: 60 }, { x: 2120, y: 418, range: 70 }, { x: 2900, y: 578, range: 100 }],
      ember: { x: 3040, y: 232 },
      doors: [door(130, 'aqueduct', 'The Drowned Aqueduct'), door(1450, 'crypt', 'The Ember Crypt')],
      beacon: { x: 3110, y: GROUND_Y },
    },
  };

  // 2x2 map layout
  const MAP_GRID = { ruins: [0, 0], aqueduct: [1, 0], crypt: [0, 1], moonspire: [1, 1] };
  const LINKS = [['ruins', 'aqueduct'], ['ruins', 'crypt'], ['aqueduct', 'moonspire'], ['crypt', 'moonspire']];

  MF.world = { ROOMS, MAP_GRID, LINKS, GROUND_Y, ROOM_H, PLAT_H, VIEW_W, VIEW_H };
})(window.MF);
