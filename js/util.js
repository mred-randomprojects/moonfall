// Shared helpers. Everything hangs off the global MF namespace so the game runs from file:// too.
window.MF = window.MF || {};
(function (MF) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // frame-rate independent exponential approach
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // Deterministic tiny PRNG (for stable decorative layouts per room)
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Segment (x0,y0)->(x1,y1) vs AABB. Returns t in [0,1] of first entry, or null.
  function segmentVsRect(x0, y0, x1, y1, r) {
    const dx = x1 - x0, dy = y1 - y0;
    let tmin = 0, tmax = 1;
    for (let axis = 0; axis < 2; axis++) {
      const p = axis === 0 ? x0 : y0;
      const d = axis === 0 ? dx : dy;
      const lo = axis === 0 ? r.x : r.y;
      const hi = axis === 0 ? r.x + r.w : r.y + r.h;
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) return null;
      } else {
        let t1 = (lo - p) / d, t2 = (hi - p) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  function formatPct(v) { return Math.round(clamp(v, 0, 1) * 100) + '%'; }

  MF.util = { clamp, lerp, damp, rand, randInt, pick, dist, sign, easeOutCubic, easeInOutQuad, seeded, rectsOverlap, segmentVsRect, formatPct };
})(window.MF);
