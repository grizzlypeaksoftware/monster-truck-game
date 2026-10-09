// All drawing. The static part of a track (ground, dirt ribbon, ramps, rocks,
// scenery) is baked into an offscreen canvas once per race and blitted each
// frame; only trucks, particles and shadows are drawn live.

import { TAU, clamp, makeRng, pointSegment } from "./utils.js";

// Palette per theme.
export const PALETTES = {
  desert: {
    ground: "#cfa868", groundAlt: "#c19a57", dirt: "#b5844c", dirtWorn: "#c59760",
    shoulder: "#9c6f3f", speck: "#e0bd84", scenery: "cactus", accent: "#f0a83c",
    sky: "#e8c88d", night: false,
  },
  mud: {
    ground: "#5c6b3f", groundAlt: "#4e5c36", dirt: "#5d4a30", dirtWorn: "#6b5639",
    shoulder: "#43351f", speck: "#6f8049", scenery: "reed", accent: "#8fbf4a",
    sky: "#6d7d4a", night: false,
  },
  canyon: {
    ground: "#b05c3a", groundAlt: "#9d4f30", dirt: "#8e4a2e", dirtWorn: "#a65b39",
    shoulder: "#6d3620", speck: "#c87a52", scenery: "boulder", accent: "#ff8a3c",
    sky: "#c06a42", night: false,
  },
  jungle: {
    ground: "#2f6b3c", groundAlt: "#275c33", dirt: "#6b5434", dirtWorn: "#7c6240",
    shoulder: "#1d4826", speck: "#3f8a4c", scenery: "tree", accent: "#58d672",
    sky: "#2a5f36", night: false,
  },
  snow: {
    ground: "#e2ebf4", groundAlt: "#d2dde9", dirt: "#9fb0c2", dirtWorn: "#b2c2d2",
    shoulder: "#8697aa", speck: "#f4f9ff", scenery: "pine", accent: "#5fc8ff",
    sky: "#cfdcea", night: false,
  },
  night: {
    ground: "#232a38", groundAlt: "#1c2230", dirt: "#3d4453", dirtWorn: "#4a5263",
    shoulder: "#161b26", speck: "#2e3747", scenery: "lamp", accent: "#ffd34d",
    sky: "#141924", night: true,
  },
};

export const TRUCK_COLORS = [
  { body: "#ef4444", trim: "#fca5a5", name: "Red" },
  { body: "#3b82f6", trim: "#93c5fd", name: "Blue" },
  { body: "#22c55e", trim: "#86efac", name: "Green" },
  { body: "#eab308", trim: "#fde047", name: "Yellow" },
  { body: "#a855f7", trim: "#d8b4fe", name: "Purple" },
  { body: "#f97316", trim: "#fdba74", name: "Orange" },
];

const BERM = 20;

function distToCenterline(track, x, y) {
  let best = Infinity;
  const pts = track.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const r = pointSegment(x, y, a.x, a.y, b.x, b.y);
    if (r.d < best) best = r.d;
  }
  return best;
}

function tracePath(ctx, pts, offset, track) {
  ctx.beginPath();
  for (let i = 0; i <= pts.length; i++) {
    const p = pts[i % pts.length];
    const x = p.x + (offset ? p.nx * offset : 0);
    const y = p.y + (offset ? p.ny * offset : 0);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function bakeTrack(track) {
  const pal = PALETTES[track.theme] || PALETTES.desert;
  const b = track.bounds;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(b.w);
  canvas.height = Math.ceil(b.h);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(track.id * 104729 + 17);

  ctx.translate(-b.x, -b.y);

  // --- Ground ---------------------------------------------------------
  const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  g.addColorStop(0, pal.ground);
  g.addColorStop(1, pal.groundAlt);
  ctx.fillStyle = g;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  ctx.fillStyle = pal.speck;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 2600; i++) {
    const x = b.x + rng() * b.w;
    const y = b.y + rng() * b.h;
    ctx.fillRect(x, y, 2 + rng() * 2, 2);
  }
  ctx.globalAlpha = 1;

  // --- Scenery (outside the track only) --------------------------------
  const keepOut = track.width * 0.5 + BERM + 26;
  let tries = 0;
  let placed = 0;
  // Scale with the canvas so density stays constant whatever shape the track
  // was built for.
  const areaRatio = (b.w * b.h) / (1560 * 980);
  const wantScenery = Math.round((pal.scenery === "lamp" ? 26 : 70) * areaRatio);
  while (placed < wantScenery && tries < 1600) {
    tries++;
    const x = b.x + rng() * b.w;
    const y = b.y + rng() * b.h;
    if (distToCenterline(track, x, y) < keepOut) continue;
    drawScenery(ctx, pal, x, y, rng);
    placed++;
  }

  // --- Dirt ribbon -----------------------------------------------------
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = pal.shoulder;
  ctx.lineWidth = track.width + BERM * 2;
  tracePath(ctx, track.points);
  ctx.stroke();

  ctx.strokeStyle = pal.dirt;
  ctx.lineWidth = track.width;
  tracePath(ctx, track.points);
  ctx.stroke();

  // Worn-in racing line and tyre ruts.
  ctx.strokeStyle = pal.dirtWorn;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = track.width * 0.42;
  tracePath(ctx, track.points);
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 4;
  for (const off of [-track.width * 0.16, track.width * 0.16]) {
    ctx.strokeStyle = pal.shoulder;
    tracePath(ctx, track.points, off);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // --- Ramps ------------------------------------------------------------
  for (const j of track.jumps) drawRamp(ctx, track, j, pal);

  // --- Puddles ----------------------------------------------------------
  for (const p of track.puddles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, 0.72);
    const pg = ctx.createRadialGradient(0, 0, p.r * 0.2, 0, 0, p.r);
    pg.addColorStop(0, pal.night ? "#0b2230" : "#2d2a18");
    pg.addColorStop(1, pal.night ? "#15323f" : "#453d22");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // --- Boulders ---------------------------------------------------------
  for (const r of track.rocks) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(3, r.r * 0.45, r.r, r.r * 0.5, 0, 0, TAU);
    ctx.fill();
    const rg = ctx.createRadialGradient(-r.r * 0.3, -r.r * 0.4, r.r * 0.2, 0, 0, r.r);
    rg.addColorStop(0, "#9aa0a6");
    rg.addColorStop(1, "#54595f");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, r.r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // --- Start / finish ---------------------------------------------------
  drawStartLine(ctx, track);

  if (pal.night) {
    // Darken everything away from the lamps for a floodlit look.
    ctx.globalCompositeOperation = "multiply";
    const vg = ctx.createRadialGradient(0, 0, Math.min(b.w, b.h) * 0.2, 0, 0, Math.max(b.w, b.h) * 0.62);
    vg.addColorStop(0, "#ffffff");
    vg.addColorStop(1, "#6f7488");
    ctx.fillStyle = vg;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.globalCompositeOperation = "source-over";
  }

  return canvas;
}

function drawScenery(ctx, pal, x, y, rng) {
  ctx.save();
  ctx.translate(x, y);
  const s = 0.75 + rng() * 0.7;
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(4, 8, 16, 7, 0, 0, TAU);
  ctx.fill();
  switch (pal.scenery) {
    case "cactus":
      ctx.fillStyle = "#3f7d45";
      ctx.fillRect(-5, -26, 10, 36);
      ctx.fillRect(-16, -14, 11, 7);
      ctx.fillRect(5, -20, 11, 7);
      ctx.fillStyle = "#55a05c";
      ctx.fillRect(-5, -26, 4, 36);
      break;
    case "pine":
      ctx.fillStyle = "#4a3726";
      ctx.fillRect(-3, -2, 6, 12);
      ctx.fillStyle = "#1f5c37";
      ctx.beginPath();
      ctx.moveTo(0, -34); ctx.lineTo(16, 2); ctx.lineTo(-16, 2); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e9f3fb";
      ctx.beginPath();
      ctx.moveTo(0, -34); ctx.lineTo(7, -16); ctx.lineTo(-7, -16); ctx.closePath();
      ctx.fill();
      break;
    case "tree":
      ctx.fillStyle = "#53402a";
      ctx.fillRect(-4, -4, 8, 14);
      ctx.fillStyle = "#1e5c31";
      ctx.beginPath(); ctx.arc(0, -14, 19, 0, TAU); ctx.fill();
      ctx.fillStyle = "#2a7a40";
      ctx.beginPath(); ctx.arc(-6, -19, 11, 0, TAU); ctx.fill();
      break;
    case "reed":
      ctx.strokeStyle = "#7d8a4a";
      ctx.lineWidth = 3;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 5, 8);
        ctx.quadraticCurveTo(i * 7, -8, i * 11, -22);
        ctx.stroke();
      }
      break;
    case "boulder": {
      const rg = ctx.createRadialGradient(-8, -10, 4, 0, 0, 26);
      rg.addColorStop(0, "#b9765a");
      rg.addColorStop(1, "#7a4029");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.fill();
      break;
    }
    case "lamp":
      ctx.fillStyle = "#2c3240";
      ctx.fillRect(-3, -40, 6, 48);
      ctx.fillStyle = "#ffd34d";
      ctx.beginPath(); ctx.arc(0, -44, 8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(0, -40, 66, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      break;
  }
  ctx.restore();
}

function drawRamp(ctx, track, jump, pal) {
  const n = track.points.length;
  const span = jump.i1 - jump.i0;
  for (let k = 0; k <= span; k++) {
    const p = track.points[(jump.i0 + k + n) % n];
    const f = k / span;
    const lift = Math.sin(f * Math.PI);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.hy, p.hx));
    ctx.fillStyle = `rgba(255,255,255,${0.07 + lift * 0.1})`;
    ctx.fillRect(-9, -track.width * 0.5, 18, track.width);
    ctx.fillStyle = pal.accent;
    ctx.globalAlpha = 0.25 + lift * 0.5;
    ctx.fillRect(-4, -track.width * 0.5, 8, track.width);
    ctx.restore();
  }
  // Chevrons pointing up the ramp.
  const mid = track.points[(jump.i0 + Math.floor(span / 2) + n) % n];
  ctx.save();
  ctx.translate(mid.x, mid.y);
  ctx.rotate(Math.atan2(mid.hy, mid.hx));
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#1b1b1b";
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(14, i * 26 - 9);
    ctx.lineTo(26, i * 26);
    ctx.lineTo(14, i * 26 + 9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawStartLine(ctx, track) {
  const p = track.points[0];
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(p.hy, p.hx));
  const w = track.width;
  const cell = 13;
  const rows = 2;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i * cell < w; i++) {
      ctx.fillStyle = (i + r) % 2 === 0 ? "#f8f8f8" : "#1a1a1a";
      ctx.fillRect(r * cell - cell, -w / 2 + i * cell, cell, cell);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Live drawing
// ---------------------------------------------------------------------------

export function drawTruck(ctx, truck, opts = {}) {
  const L = 60;
  const W = 36;
  const z = truck.z;

  // Shadow stays on the ground and shrinks as the truck climbs.
  ctx.save();
  ctx.globalAlpha = clamp(0.42 - z * 0.0016, 0.08, 0.42);
  ctx.translate(truck.x + z * 0.1, truck.y + z * 0.16);
  ctx.rotate(truck.angle);
  ctx.fillStyle = "#000";
  const ss = 1 + z * 0.0016;
  ctx.beginPath();
  ctx.ellipse(0, 0, (L / 2) * ss, (W / 2) * ss, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  // Lift the sprite to fake height.
  ctx.translate(truck.x - z * 0.14, truck.y - z * 0.3);
  ctx.rotate(truck.angle);
  const air = 1 + clamp(z, 0, 260) * 0.0011;
  ctx.scale(air, air);

  const c = truck.colors;

  // Wheels
  const wheelY = W * 0.5;
  const wheelX = L * 0.3;
  for (const [wx, wy] of [
    [wheelX, -wheelY], [wheelX, wheelY], [-wheelX, -wheelY], [-wheelX, wheelY],
  ]) {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.fillStyle = "#17181c";
    roundRect(ctx, -11, -7.5, 22, 15, 5);
    ctx.fill();
    ctx.strokeStyle = "#3b3f46";
    ctx.lineWidth = 2;
    const spin = (truck.wheelSpin % 1) * TAU;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * TAU) / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 7, -5);
      ctx.lineTo(Math.cos(a) * 7, 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Chassis + body
  const roll = truck.bodyRoll * 3;
  ctx.save();
  ctx.translate(0, roll);
  ctx.fillStyle = "#2a2d33";
  roundRect(ctx, -L * 0.46, -W * 0.34, L * 0.92, W * 0.68, 5);
  ctx.fill();

  ctx.fillStyle = truck.hitTimer > 0 ? "#ffffff" : c.body;
  roundRect(ctx, -L * 0.4, -W * 0.42, L * 0.8, W * 0.84, 7);
  ctx.fill();

  ctx.fillStyle = c.trim;
  roundRect(ctx, -L * 0.1, -W * 0.3, L * 0.3, W * 0.6, 4);
  ctx.fill();

  // Windscreen
  ctx.fillStyle = "rgba(20,30,45,0.85)";
  roundRect(ctx, L * 0.08, -W * 0.26, L * 0.12, W * 0.52, 3);
  ctx.fill();

  // Roll bar + lights
  ctx.strokeStyle = "#d8dbe0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-L * 0.18, -W * 0.36);
  ctx.lineTo(-L * 0.18, W * 0.36);
  ctx.stroke();
  ctx.fillStyle = "#fff6c8";
  ctx.beginPath(); ctx.arc(L * 0.34, -W * 0.22, 3.2, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(L * 0.34, W * 0.22, 3.2, 0, TAU); ctx.fill();
  ctx.restore();

  // Nitro flame
  if (truck.nitroTimer > 0) {
    const f = 0.6 + Math.random() * 0.6;
    const fg = ctx.createLinearGradient(-L * 0.45, 0, -L * 0.45 - 40 * f, 0);
    fg.addColorStop(0, "rgba(255,255,255,0.95)");
    fg.addColorStop(0.4, "rgba(120,200,255,0.8)");
    fg.addColorStop(1, "rgba(60,120,255,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-L * 0.45, -8);
    ctx.lineTo(-L * 0.45 - 42 * f, 0);
    ctx.lineTo(-L * 0.45, 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Player marker so you never lose yourself in a four-truck pile-up.
  if (opts.marker) {
    ctx.save();
    ctx.translate(truck.x, truck.y - 42 - z * 0.3);
    const bob = Math.sin(performance.now() / 260) * 2.5;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10 + bob);
    ctx.lineTo(-8, -3 + bob);
    ctx.lineTo(8, -3 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// --- Particles -------------------------------------------------------------

export class Particles {
  constructor(max = 260) {
    this.pool = [];
    for (let i = 0; i < max; i++) {
      this.pool.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, r: 4, color: "#fff" });
    }
    this.cursor = 0;
  }

  spawn(x, y, vx, vy, life, r, color) {
    // Round-robin over the pool: oldest particle is recycled when full.
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    p.alive = true;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.max = life; p.r = r; p.color = color;
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 2.2 * dt;
    }
  }

  draw(ctx) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const f = p.life / p.max;
      ctx.globalAlpha = f * 0.75;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.6 - f * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    for (const p of this.pool) p.alive = false;
  }
}
