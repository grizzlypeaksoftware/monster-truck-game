// Computer drivers. Each one aims at a point further down the centreline,
// offset sideways by its own preferred racing line, and eases off the throttle
// when the corner ahead is tight. Personality comes from the offsets and the
// amount of noise each driver carries.

import { clamp, angleDelta, makeRng } from "./utils.js";

export class Driver {
  constructor(truck, skill, seed) {
    this.truck = truck;
    this.skill = skill;
    this.rng = makeRng(seed);
    this.lineOffset = (this.rng() - 0.5) * 0.52;
    this.noisePhase = this.rng() * 100;
    this.aggression = 0.55 + this.rng() * 0.45;
    this.mistakeTimer = 0;
    this.nitroCooldown = 1 + this.rng() * 3;
  }

  // Average curvature of the next few waypoints — how tight is it ahead?
  lookaheadCurve(track, from, count) {
    const n = track.points.length;
    let sum = 0;
    for (let k = 1; k <= count; k++) sum += track.points[(from + k) % n].curve;
    return sum / count;
  }

  update(dt, track, time) {
    const t = this.truck;
    const n = track.points.length;
    const speed = t.speed;

    // Look further ahead the faster we're going.
    const lead = Math.round(4 + (speed / t.stats.maxSpeed) * 11);
    const targetIdx = (t.wp + lead) % n;
    const wp = track.points[targetIdx];

    const wander = Math.sin(time * 0.7 + this.noisePhase) * 0.12 * (1.3 - this.skill);
    const curveAhead = this.lookaheadCurve(track, t.wp, 12);

    // Tuck to the inside of the corner, drift wide on the straights.
    let off = this.lineOffset + wander;
    if (curveAhead > 0.05) {
      const turnSign = Math.sign(
        track.points[(t.wp + 8) % n].hx * wp.hy - track.points[(t.wp + 8) % n].hy * wp.hx
      );
      off -= turnSign * 0.22 * this.aggression;
    }
    off = clamp(off, -0.62, 0.62);

    const tx = wp.x + wp.nx * off * track.width;
    const ty = wp.y + wp.ny * off * track.width;

    const want = Math.atan2(ty - t.y, tx - t.x);
    let steer = clamp(angleDelta(t.angle, want) * 2.3, -1, 1);

    // Avoid boulders that sit right on the chosen line.
    for (const r of track.rocks) {
      const dx = r.x - t.x;
      const dy = r.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d > 150 || d < 1) continue;
      const ahead = (dx * Math.cos(t.angle) + dy * Math.sin(t.angle)) / d;
      if (ahead < 0.72) continue;
      const side = Math.sign(dx * Math.sin(t.angle) - dy * Math.cos(t.angle)) || 1;
      steer += side * (1 - d / 150) * 1.1 * this.skill;
    }
    steer = clamp(steer, -1, 1);

    // Throttle: back off for tight corners, more so for weaker drivers.
    let throttle = 1;
    const corner = clamp(curveAhead * 7.5, 0, 1);
    const cornerSpeed = t.stats.maxSpeed * (1 - corner * (0.52 - this.skill * 0.16));
    if (speed > cornerSpeed) throttle = 0.12;
    let brake = speed > cornerSpeed * 1.26 ? 0.55 : 0;

    // Occasional fumble keeps them beatable.
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistakeTimer = 2 + this.rng() * 6;
      if (this.rng() > this.skill) {
        this.mistakeTimer = 0.55;
        throttle = 0.25;
        steer += (this.rng() - 0.5) * 0.85;
      }
    }

    // Spend nitro on the straights.
    this.nitroCooldown -= dt;
    if (
      this.nitroCooldown <= 0 &&
      t.nitroLeft > 0 &&
      curveAhead < 0.03 &&
      speed > t.stats.maxSpeed * 0.6
    ) {
      t.useNitro();
      this.nitroCooldown = 5 + this.rng() * 7;
    }

    return { steer: clamp(steer, -1, 1), throttle, brake };
  }
}

export const AI_NAMES = [
  "Ivan", "Bronco", "Sledge", "Duke", "Reba", "Tank",
  "Cyclone", "Mako", "Dozer", "Scrap", "Blaze", "Grit",
];
