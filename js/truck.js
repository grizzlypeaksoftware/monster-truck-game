// Truck simulation. Arcade handling: velocity is split into a forward and a
// lateral component, the lateral part gets damped by grip, and the surface
// under the wheels scales speed and grip.

import { clamp } from "./utils.js";
import { nearestOnTrack } from "./tracks.js";

const GRAVITY = 1250;
const BODY_R = 20;      // collision radius
const BERM = 20;        // forgiving rough strip past the track edge
const NITRO_TIME = 1.5;

export class Truck {
  constructor(opts) {
    this.index = opts.index;
    this.name = opts.name;
    this.colors = opts.colors;
    this.isPlayer = !!opts.isPlayer;
    this.stats = opts.stats;
    this.ai = opts.ai || null;

    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.vx = 0;
    this.vy = 0;
    this.z = 0;
    this.vz = 0;
    this.airborne = false;

    this.wp = 0;
    this.lap = 0;
    this.progress = 0;
    this.finished = false;
    this.finishTime = 0;
    this.place = 0;

    this.raceTime = 0;
    this.lapStart = 0;
    this.bestLap = Infinity;
    this.lastLap = 0;

    this.nitroLeft = this.stats.nitroCount;
    this.nitroTimer = 0;
    this.surface = "track";
    this.offTrack = 0;
    this.wheelSpin = 0;
    this.bodyRoll = 0;
    this.hitTimer = 0;
  }

  placeAt(grid) {
    this.x = grid.x;
    this.y = grid.y;
    this.angle = grid.angle;
    this.wp = grid.wp;
    this.vx = 0;
    this.vy = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  // Signed speed along the truck's own heading.
  get forwardSpeed() {
    return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
  }

  useNitro() {
    if (this.nitroLeft <= 0 || this.nitroTimer > 0 || this.airborne) return false;
    this.nitroLeft--;
    this.nitroTimer = NITRO_TIME;
    return true;
  }

  update(dt, input, track, fx) {
    const st = this.stats;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);

    // --- Where are we relative to the racing surface? -------------------
    const near = nearestOnTrack(track, this.x, this.y, this.wp);
    const edge = track.width * 0.5;
    let speedMul = 1;
    let gripMul = 1;
    this.surface = "track";

    if (near.d > edge) {
      this.surface = "rough";
      this.offTrack = Math.min(1, (near.d - edge) / BERM);
      speedMul = st.offroadSpeed;
      gripMul = st.offroadGrip;
    } else {
      this.offTrack = 0;
    }

    for (const p of track.puddles) {
      const dx = this.x - p.x;
      const dy = this.y - p.y;
      if (dx * dx + dy * dy < p.r * p.r) {
        this.surface = "mud";
        speedMul = Math.min(speedMul, 0.66);
        gripMul = Math.min(gripMul, 0.5);
        break;
      }
    }

    if (this.nitroTimer > 0) this.nitroTimer = Math.max(0, this.nitroTimer - dt);
    const boosting = this.nitroTimer > 0;

    // --- Airborne vs grounded ------------------------------------------
    if (this.airborne) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      // Steering in the air only rotates the body, it doesn't change the arc.
      this.angle += input.steer * st.steer * 0.35 * dt;
      this.vx *= 1 - 0.18 * dt;
      this.vy *= 1 - 0.18 * dt;
      if (this.z <= 0) this.land(fx);
    } else {
      let vf = this.vx * cos + this.vy * sin;
      let vl = -this.vx * sin + this.vy * cos;

      const topSpeed = st.maxSpeed * speedMul * (boosting ? st.nitroPower : 1);
      const accel = st.accel * (boosting ? 1.7 : 1) * (0.45 + 0.55 * speedMul);

      if (input.throttle > 0) {
        if (vf < topSpeed) vf += accel * input.throttle * dt;
      }
      if (input.brake > 0) {
        if (vf > 0) vf -= st.brake * input.brake * dt;
        else vf -= st.accel * 0.45 * input.brake * dt; // reverse
        vf = Math.max(vf, -110);
      }

      // Rolling resistance + aero. Rough ground drags much harder.
      const drag = this.surface === "track" ? 0.55 : 2.4;
      vf -= vf * drag * dt;
      if (vf > topSpeed) vf -= (vf - topSpeed) * 4 * dt;

      // Steering authority builds with speed, so a stopped truck can't spin.
      const speedFactor = clamp(Math.abs(vf) / 85, 0, 1);
      const turn = input.steer * st.steer * speedFactor * (boosting ? 0.88 : 1);
      this.angle += turn * dt * Math.sign(vf >= 0 ? 1 : -1);

      // Cornering throws the tail out; grip pulls it back in.
      vl += turn * vf * 0.42 * dt;
      const gripK = st.grip * gripMul;
      vl *= Math.exp(-gripK * dt);

      this.bodyRoll += (clamp(-turn * 0.5, -1, 1) - this.bodyRoll) * Math.min(1, dt * 7);

      const c = Math.cos(this.angle);
      const s = Math.sin(this.angle);
      this.vx = vf * c - vl * s;
      this.vy = vf * s + vl * c;

      if (this.surface !== "track" && Math.abs(vf) > 60) {
        fx.dust(this.x, this.y, this.surface === "mud" ? "mud" : "dirt", Math.abs(vf));
      }
      if (Math.abs(vl) > 90) {
        fx.dust(this.x, this.y, "dirt", Math.abs(vl) * 0.7);
      }
    }

    if (boosting) fx.flame(this);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.wheelSpin += this.speed * dt * 0.06;
    if (this.hitTimer > 0) this.hitTimer -= dt;

    // --- Jump ramps ------------------------------------------------------
    if (!this.airborne) {
      const n = track.points.length;
      for (const j of track.jumps) {
        let rel = near.idx - ((j.i0 + n) % n);
        if (rel < -n / 2) rel += n;
        if (rel >= 0 && rel <= j.i1 - j.i0 && near.d < edge) {
          const vf = this.forwardSpeed;
          if (vf > 130) {
            this.airborne = true;
            this.vz = 190 * j.power * (0.55 + vf / st.maxSpeed);
            this.z = 1;
            fx.dust(this.x, this.y, "dirt", 200);
          }
          break;
        }
      }
    }

    this.resolveTrackEdge(track, near, edge, fx);
    this.resolveRocks(track, fx);
    this.updateProgress(track, near);
  }

  land(fx) {
    const hard = this.vz < -230;
    this.z = 0;
    this.airborne = false;
    this.vz = 0;
    if (hard) {
      const keep = this.stats.landing;
      this.vx *= keep;
      this.vy *= keep;
    }
    fx.dust(this.x, this.y, "dirt", hard ? 260 : 150);
    fx.land(this, hard);
  }

  // Soft berm then a solid wall, so nobody can shortcut across the infield.
  resolveTrackEdge(track, near, edge, fx) {
    const limit = edge + BERM;
    if (near.d <= limit) return;
    const pts = track.points;
    const a = pts[near.idx];
    const b = pts[(near.idx + 1) % pts.length];
    const cx = a.x + (b.x - a.x) * near.t;
    const cy = a.y + (b.y - a.y) * near.t;
    let nx = this.x - cx;
    let ny = this.y - cy;
    const m = Math.hypot(nx, ny) || 1;
    nx /= m;
    ny /= m;
    this.x = cx + nx * limit;
    this.y = cy + ny * limit;
    // Remove the outward part of the velocity and scrub some speed.
    const vn = this.vx * nx + this.vy * ny;
    if (vn > 0) {
      this.vx -= nx * vn * 1.25;
      this.vy -= ny * vn * 1.25;
      this.vx *= 0.9;
      this.vy *= 0.9;
      if (vn > 120) {
        fx.dust(this.x, this.y, "dirt", vn);
        fx.thud(Math.min(1, vn / 320));
      }
    }
  }

  resolveRocks(track, fx) {
    for (const r of track.rocks) {
      const dx = this.x - r.x;
      const dy = this.y - r.y;
      const min = r.r + BODY_R * 0.8;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      this.x = r.x + nx * min;
      this.y = r.y + ny * min;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        this.vx -= nx * vn * 1.4;
        this.vy -= ny * vn * 1.4;
        this.vx *= 0.55;
        this.vy *= 0.55;
        this.hitTimer = 0.25;
        fx.dust(this.x, this.y, "dirt", 220);
        fx.thud(0.9);
      }
    }
  }

  updateProgress(track, near) {
    const n = track.points.length;
    const prev = this.wp;
    this.wp = near.idx;
    let delta = this.wp - prev;
    if (delta < -n / 2) {
      // Crossed the start/finish line going forwards.
      this.lap++;
      if (this.lap > 1) {
        this.lastLap = this.raceTime - this.lapStart;
        if (this.lastLap < this.bestLap) this.bestLap = this.lastLap;
      }
      this.lapStart = this.raceTime;
    } else if (delta > n / 2) {
      this.lap--; // reversed back over the line
    }
    this.progress = this.lap * n + this.wp + near.t;
  }
}

export function collideTrucks(trucks) {
  for (let i = 0; i < trucks.length; i++) {
    for (let j = i + 1; j < trucks.length; j++) {
      const a = trucks[i];
      const b = trucks[j];
      // Trucks in the air pass over each other.
      if (Math.abs(a.z - b.z) > 26) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = BODY_R * 1.8;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const push = (min - d) * 0.5;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      // Exchange a slice of momentum along the contact normal.
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const imp = rel * 0.65;
        a.vx += nx * imp;
        a.vy += ny * imp;
        b.vx -= nx * imp;
        b.vy -= ny * imp;
        a.hitTimer = 0.18;
        b.hitTimer = 0.18;
      }
    }
  }
}

