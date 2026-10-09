// Track geometry + the level table.
//
// A track is a closed centreline of evenly spaced waypoints with a constant
// width. Everything else (off-track tests, lap progress, AI racing line,
// feature placement) is expressed in terms of that centreline, which keeps
// collision cheap enough for a phone.

import { TAU, clamp, makeRng, rngRange, pointSegment } from "./utils.js";

// Tracks are sized to roughly constant area, then shaped to the aspect ratio
// of the screen they're about to be raced on, so a wide phone held sideways
// gets a wide track instead of two empty bands either side.
const WORLD_AREA = 1560 * 980;
const SPACING = 16; // world units between waypoints

function worldBox(aspect) {
  const a = clamp(aspect || 1.6, 0.7, 2.7);
  const h = Math.sqrt(WORLD_AREA / a);
  return { w: a * h, h };
}

// Parametric closed shapes. Each returns a unit-ish point for angle th.
const SHAPES = {
  oval: (th) => [Math.cos(th), Math.sin(th) * 0.72],
  wobble: (th, p) => {
    const r =
      1 +
      p.a1 * Math.sin(p.k1 * th + p.ph1) +
      p.a2 * Math.sin(p.k2 * th + p.ph2);
    return [r * Math.cos(th), r * Math.sin(th) * 0.78];
  },
  eight: (th) => [Math.cos(th), Math.sin(2 * th) * 0.6],
  clover: (th, p) => {
    const r = 1 + p.a1 * Math.cos(3 * th + p.ph1);
    return [r * Math.cos(th), r * Math.sin(th) * 0.8];
  },
  peanut: (th, p) => {
    const r = 1 + p.a1 * Math.cos(2 * th + p.ph1);
    return [r * Math.cos(th), r * Math.sin(th) * 0.8];
  },
  kidney: (th, p) => {
    const r = 1 + p.a1 * Math.cos(th) + p.a2 * Math.sin(2 * th + p.ph2);
    return [r * Math.cos(th), r * Math.sin(th) * 0.8];
  },
  spiralLoop: (th, p) => {
    // A long outer lap that tucks into a tight inner hairpin.
    const r = 1 + p.a1 * Math.sin(th + p.ph1) + p.a2 * Math.cos(4 * th);
    return [r * Math.cos(th), r * Math.sin(th) * 0.74];
  },
};

function rawPoints(def, rng) {
  const shape = SHAPES[def.shape] || SHAPES.wobble;
  const p = {
    a1: def.a1 ?? rngRange(rng, 0.14, 0.26),
    a2: def.a2 ?? rngRange(rng, 0.06, 0.16),
    k1: def.k1 ?? 2,
    k2: def.k2 ?? 3,
    ph1: def.ph1 ?? rngRange(rng, 0, TAU),
    ph2: def.ph2 ?? rngRange(rng, 0, TAU),
  };
  const steps = 720;
  const pts = [];
  const rot = def.rot ?? 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * TAU;
    const [ux, uy] = shape(th, p);
    pts.push([ux * cosR - uy * sinR, ux * sinR + uy * cosR]);
  }
  return pts;
}

// Light moving-average pass so resampling can't leave hard kinks that would
// read as walls to the physics.
function smooth(pts, passes) {
  let cur = pts;
  for (let n = 0; n < passes; n++) {
    const out = [];
    const len = cur.length;
    for (let i = 0; i < len; i++) {
      const a = cur[(i - 1 + len) % len];
      const b = cur[i];
      const c = cur[(i + 1) % len];
      out.push([
        (a[0] + 2 * b[0] + c[0]) / 4,
        (a[1] + 2 * b[1] + c[1]) / 4,
      ]);
    }
    cur = out;
  }
  return cur;
}

function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: (maxX - minX) || 1, h: (maxY - minY) || 1 };
}

function fitToWorld(pts, margin, aspect) {
  const world = worldBox(aspect);
  const targetAspect = (world.w - margin * 2) / (world.h - margin * 2);

  // Squash or stretch the shape along Y until it has the screen's proportions.
  // This changes the track's shape, not the simulation, which stays isotropic.
  const raw = bbox(pts);
  const yScale = clamp(raw.w / raw.h / targetAspect, 0.42, 2.4);
  const shaped = pts.map(([x, y]) => [x, y * yScale]);

  const b = bbox(shaped);
  const scale = Math.min((world.w - margin * 2) / b.w, (world.h - margin * 2) / b.h);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return shaped.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]);
}

// Resample to constant arc-length spacing and attach tangents/normals.
function resample(pts) {
  const len = pts.length;
  let total = 0;
  const segLen = [];
  for (let i = 0; i < len; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % len];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLen.push(d);
    total += d;
  }
  const count = Math.max(48, Math.round(total / SPACING));
  const step = total / count;
  const out = [];
  let seg = 0;
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (acc + segLen[seg] < target && seg < len - 1) {
      acc += segLen[seg];
      seg++;
    }
    const t = segLen[seg] > 0 ? (target - acc) / segLen[seg] : 0;
    const a = pts[seg];
    const b = pts[(seg + 1) % len];
    out.push({
      x: a[0] + (b[0] - a[0]) * t,
      y: a[1] + (b[1] - a[1]) * t,
      s: target,
    });
  }
  // Tangents, normals and local curvature.
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i - 1 + out.length) % out.length];
    const next = out[(i + 1) % out.length];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const m = Math.hypot(tx, ty) || 1;
    out[i].hx = tx / m;
    out[i].hy = ty / m;
    out[i].nx = -out[i].hy;
    out[i].ny = out[i].hx;
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 2 + out.length) % out.length];
    const b = out[(i + 2) % out.length];
    const cross = a.hx * b.hy - a.hy * b.hx;
    const dot = clamp(a.hx * b.hx + a.hy * b.hy, -1, 1);
    out[i].curve = Math.abs(Math.atan2(cross, dot)); // 0 = straight
  }
  out.total = total;
  return out;
}

// Distance from a point to the entire centreline. Needed when placing
// scenery: on a figure-eight, a spot that is safely off one lobe can sit in
// the middle of another.
function clearanceToTrack(track, x, y) {
  const pts = track.points;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const r = pointSegment(x, y, a.x, a.y, b.x, b.y);
    if (r.d < best) best = r.d;
  }
  return best;
}

function placeFeatures(track, def, rng) {
  const n = track.points.length;
  const jumps = [];
  const puddles = [];
  const rocks = [];

  // A waypoint is "crossed" when a distant part of the same track runs close
  // by — the middle of a figure-eight. Ramps there look wrong and play worse,
  // so they're excluded.
  const crossed = (i) => {
    const a = track.points[i];
    for (let j = 0; j < n; j++) {
      let gap = Math.abs(i - j);
      if (gap > n / 2) gap = n - gap;
      if (gap < 26) continue;
      const b = track.points[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < track.width * track.width * 1.6) return true;
    }
    return false;
  };

  // Jumps go on the straightest stretches so they launch cleanly.
  const jumpCount = def.jumps ?? 2;
  const candidates = [];
  for (let i = 0; i < n; i++) {
    // Keep clear of the start/finish line.
    if (i < 12 || i > n - 24) continue;
    if (crossed(i)) continue;
    let flat = 0;
    for (let k = -3; k <= 3; k++) flat += track.points[(i + k + n) % n].curve;
    candidates.push({ i, flat });
  }
  candidates.sort((a, b) => a.flat - b.flat);
  const used = [];
  for (const c of candidates) {
    if (jumps.length >= jumpCount) break;
    if (used.some((u) => Math.abs(u - c.i) < n * 0.12)) continue;
    if (crossed(c.i - 3) || crossed(c.i + 3)) continue;
    used.push(c.i);
    jumps.push({
      i0: c.i - 2,
      i1: c.i + 2,
      power: def.jumpPower ?? rngRange(rng, 0.9, 1.25),
    });
  }

  // Mud/water patches partly blocking the racing line.
  const puddleCount = def.puddles ?? 0;
  for (let p = 0; p < puddleCount; p++) {
    const i = Math.floor(rngRange(rng, 14, n - 14));
    if (jumps.some((j) => Math.abs(j.i0 - i) < 10)) continue;
    const wp = track.points[i];
    const off = rngRange(rng, -0.42, 0.42) * track.width;
    puddles.push({
      x: wp.x + wp.nx * off,
      y: wp.y + wp.ny * off,
      r: rngRange(rng, 34, 56),
    });
  }

  // Boulders hug the edges — hitting one stops you dead, so they must never
  // end up on the dirt itself.
  const rockCount = def.rocks ?? 0;
  const edge = track.width * 0.5;
  let attempts = 0;
  while (rocks.length < rockCount && attempts < rockCount * 25) {
    attempts++;
    const i = Math.floor(rngRange(rng, 14, n - 14));
    const wp = track.points[i];
    const side = rng() < 0.5 ? -1 : 1;
    const off = side * rngRange(rng, 0.52, 0.72) * track.width;
    const r = rngRange(rng, 15, 25);
    const x = wp.x + wp.nx * off;
    const y = wp.y + wp.ny * off;
    const clear = clearanceToTrack(track, x, y);
    // Outside the racing surface, but close enough to still be in play.
    if (clear < edge + r + 4 || clear > edge + 70) continue;
    rocks.push({ x, y, r });
  }

  track.jumps = jumps;
  track.puddles = puddles;
  track.rocks = rocks;
}

// Four trucks line up two-by-two behind the start/finish line.
function startGrid(track, count) {
  const n = track.points.length;
  const grid = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2);
    const col = i % 2 === 0 ? -1 : 1;
    const idx = (n - 6 - row * 5 + n) % n;
    const wp = track.points[idx];
    grid.push({
      x: wp.x + wp.nx * col * track.width * 0.24,
      y: wp.y + wp.ny * col * track.width * 0.24,
      angle: Math.atan2(wp.hy, wp.hx),
      wp: idx,
    });
  }
  return grid;
}

export function buildTrack(def, aspect = 1.6) {
  const rng = makeRng(def.seed);
  const width = def.width ?? 128;
  let pts = rawPoints(def, rng);
  pts = smooth(pts, 2);
  pts = fitToWorld(pts, width * 0.75 + 26, aspect);
  const points = resample(pts);

  const track = {
    id: def.id,
    name: def.name,
    theme: def.theme,
    laps: def.laps,
    width,
    points,
    length: points.total,
  };
  placeFeatures(track, def, rng);
  track.grid = startGrid(track, 4);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = width * 0.6 + 30;
  const bounds = {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };

  // The shape was fitted to the screen's proportions, but padding the same
  // amount on every side pulls the bounding box back towards square. Grow
  // whichever axis is short so the baked image matches the screen and the
  // track isn't drawn inside letterbox bands.
  const want = clamp(aspect, 0.7, 2.7);
  if (bounds.w / bounds.h < want) {
    const w = bounds.h * want;
    bounds.x -= (w - bounds.w) / 2;
    bounds.w = w;
  } else {
    const h = bounds.w / want;
    bounds.y -= (h - bounds.h) / 2;
    bounds.h = h;
  }
  track.bounds = bounds;
  return track;
}

// Nearest point on the centreline, searched in a window around the last known
// waypoint. Falls back to a full scan if a truck has wandered a long way off.
export function nearestOnTrack(track, x, y, hintIdx) {
  const pts = track.points;
  const n = pts.length;
  let bestD = Infinity;
  let bestIdx = hintIdx;
  let bestT = 0;

  const scan = (from, to) => {
    for (let k = from; k <= to; k++) {
      const i = (k + n * 2) % n;
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const r = pointSegment(x, y, a.x, a.y, b.x, b.y);
      if (r.d < bestD) {
        bestD = r.d;
        bestIdx = i;
        bestT = r.t;
      }
    }
  };

  scan(hintIdx - 8, hintIdx + 14);
  if (bestD > track.width * 2.5) {
    bestD = Infinity;
    scan(0, n - 1);
  }
  return { d: bestD, idx: bestIdx, t: bestT };
}

// ---------------------------------------------------------------------------
// Levels. Six themed cups of five races each; difficulty, lap count, track
// complexity and prize money all climb as you go.
// ---------------------------------------------------------------------------

const CUPS = [
  { theme: "desert", name: "Dust Bowl" },
  { theme: "mud", name: "Mud Pit" },
  { theme: "canyon", name: "Canyon Run" },
  { theme: "jungle", name: "Jungle Trail" },
  { theme: "snow", name: "Frozen Ridge" },
  { theme: "night", name: "Midnight Mayhem" },
];

const TRACK_NAMES = [
  ["Sunbaked Oval", "Cactus Flats", "Rattler Ridge", "Dune Crossing", "Mesa Mayhem"],
  ["Slop Alley", "Bog Hollow", "Quagmire Loop", "Mudslinger", "The Swamp Thing"],
  ["Red Rock Rush", "Narrow Pass", "Devil's Elbow", "Sandstone Spiral", "Canyon Crusher"],
  ["Green Hell", "Vine Tangle", "River Bend", "Snake Pit", "Canopy Climb"],
  ["First Frost", "Glacier Gap", "Icebreaker", "Powder Keg", "Summit Showdown"],
  ["Floodlight Fury", "Blackout Bend", "Neon Nitro", "Graveyard Shift", "Moonshot"],
];

const SHAPE_CYCLE = [
  "oval", "peanut", "wobble", "eight", "clover",
  "kidney", "wobble", "spiralLoop", "eight", "peanut",
];

export const LEVELS = [];
let levelId = 0;
for (let c = 0; c < CUPS.length; c++) {
  for (let r = 0; r < 5; r++) {
    const tier = c; // 0..5
    const idx = levelId;
    LEVELS.push({
      id: idx,
      name: TRACK_NAMES[c][r],
      cup: CUPS[c].name,
      theme: CUPS[c].theme,
      shape: SHAPE_CYCLE[(c * 5 + r) % SHAPE_CYCLE.length],
      seed: 1337 + idx * 7919,
      laps: 2 + Math.min(2, Math.floor((tier + (r >= 3 ? 1 : 0)) / 2)),
      width: Math.round(142 - tier * 4 - (r > 2 ? 4 : 0)),
      jumps: 1 + Math.floor((idx % 5) / 2) + (tier > 2 ? 1 : 0),
      puddles: CUPS[c].theme === "mud" ? 4 + r : Math.max(0, r - 1 + tier - 2),
      rocks: Math.min(8, Math.floor(tier * 1.2) + r),
      aiSkill: 0.68 + tier * 0.052 + r * 0.013,
      prize: 400 + tier * 320 + r * 110,
      rot: (idx * 0.41) % TAU,
    });
    levelId++;
  }
}

export const CUP_LIST = CUPS.map((c, i) => ({
  ...c,
  levels: LEVELS.filter((l) => l.cup === c.name).map((l) => l.id),
  index: i,
}));
