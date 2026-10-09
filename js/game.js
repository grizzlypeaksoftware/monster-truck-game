// The race itself: state machine, fixed-step simulation, camera and drawing.

import { clamp, lerp, formatTime, makeRng } from "./utils.js";
import { buildTrack } from "./tracks.js";
import { Truck, collideTrucks } from "./truck.js";
import { Driver, AI_NAMES } from "./ai.js";
import { aiStats } from "./upgrades.js";
import { bakeTrack, drawTruck, Particles, TRUCK_COLORS, PALETTES } from "./render.js";

const STATE = {
  COUNTDOWN: "countdown",
  RACING: "racing",
  FINISHED: "finished",
  PAUSED: "paused",
};

const PLACE_PAYOUT = [1, 0.6, 0.35, 0.18];
const MAX_STEP = 1 / 30;
const TIME_AFTER_LEADERS = 40; // seconds to finish once the field is home

export class Race {
  constructor(canvas, { sound, input, onHud, onFinish }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sound = sound;
    this.input = input;
    this.onHud = onHud;
    this.onFinish = onFinish;

    this.particles = new Particles();
    this.state = null;
    this.raf = null;
    this.shake = 0;
    this.cameraMode = "fit";
    this.cam = { x: 0, y: 0, scale: 1 };
    this.dpr = 1;

    this.fx = {
      dust: (x, y, kind, power) => this.spawnDust(x, y, kind, power),
      land: (truck, hard) => {
        if (truck.isPlayer) {
          this.shake = Math.min(1, this.shake + (hard ? 0.7 : 0.3));
          this.sound.land(hard);
        }
      },
      thud: (power) => {
        this.shake = Math.min(1, this.shake + power * 0.5);
        this.sound.thud(power);
      },
      flame: () => {},
    };

    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    window.addEventListener("orientationchange", this._resize);
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", this._resize);
    window.removeEventListener("orientationchange", this._resize);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(220, Math.round(rect.height));
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.dpr = dpr;
    this.viewW = w;
    this.viewH = h;
    if (this.track) this.computeFitScale();
  }

  computeFitScale() {
    const b = this.track.bounds;
    this.fitScale = Math.min(this.viewW / b.w, this.viewH / b.h);
  }

  start(level, playerStats, playerColor, settings) {
    this.level = level;
    this.resize();
    this.track = buildTrack(level, this.viewW / this.viewH);
    this.trackCanvas = bakeTrack(this.track);
    this.palette = PALETTES[this.track.theme] || PALETTES.desert;
    this.cameraMode = settings.camera || "fit";
    this.resize();

    const rng = makeRng(level.seed ^ 0x5bf03635);
    const colorIdx = playerColor % TRUCK_COLORS.length;
    this.trucks = [];
    this.drivers = [];

    const player = new Truck({
      index: 0,
      name: "YOU",
      colors: TRUCK_COLORS[colorIdx],
      isPlayer: true,
      stats: playerStats,
    });
    this.trucks.push(player);
    this.player = player;

    const usedNames = new Set();
    for (let i = 1; i < 4; i++) {
      let name;
      do {
        name = AI_NAMES[Math.floor(rng() * AI_NAMES.length)];
      } while (usedNames.has(name));
      usedNames.add(name);
      const variance = (rng() - 0.45) * 0.07;
      const truck = new Truck({
        index: i,
        name,
        colors: TRUCK_COLORS[(colorIdx + i) % TRUCK_COLORS.length],
        stats: aiStats(level.aiSkill, variance),
      });
      this.trucks.push(truck);
      this.drivers.push(new Driver(truck, level.aiSkill, level.seed + i * 977));
    }

    // Grid order is shuffled so the player doesn't always start on pole.
    const grid = this.track.grid.slice();
    const order = [0, 1, 2, 3].sort(() => rng() - 0.5);
    this.trucks.forEach((t, i) => t.placeAt(grid[order[i]]));

    this.time = 0;
    this.countdown = 3.4;
    this.state = STATE.COUNTDOWN;
    this.lastBeep = 4;
    this.timeLeft = null;
    this.wrongWay = false;
    this.shake = 0;
    this.particles.clear();
    this.input.reset();
    this.input.autoGas = settings.autoGas !== false;
    this.sound.startEngine();

    this.lastFrame = performance.now();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.sound.stopEngine();
  }

  pause() {
    if (this.state !== STATE.RACING && this.state !== STATE.COUNTDOWN) return false;
    this.prevState = this.state;
    this.state = STATE.PAUSED;
    this.sound.stopEngine();
    return true;
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = this.prevState || STATE.RACING;
    this.sound.startEngine();
    this.lastFrame = performance.now();
  }

  spawnDust(x, y, kind, power) {
    if (Math.random() > 0.45) return;
    const pal = this.palette;
    const color = kind === "mud" ? "#4a3a22" : pal.speck;
    const spread = clamp(power / 260, 0.2, 1.2);
    this.particles.spawn(
      x + (Math.random() - 0.5) * 14,
      y + (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 90 * spread,
      (Math.random() - 0.5) * 90 * spread,
      0.35 + Math.random() * 0.45,
      3 + Math.random() * 4,
      color
    );
  }

  nitro() {
    if (this.state !== STATE.RACING) return;
    if (this.player.useNitro()) this.sound.nitro();
  }

  frame = (now) => {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!isFinite(dt) || dt <= 0) return;
    // Clamp so a backgrounded tab can't teleport trucks through walls.
    dt = Math.min(dt, 0.1);

    if (this.state === STATE.PAUSED) {
      this.draw();
      return;
    }

    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_STEP);
      this.step(step);
      remaining -= step;
    }
    this.draw();
  };

  step(dt) {
    const input = this.input.read(dt);

    if (this.state === STATE.COUNTDOWN) {
      this.countdown -= dt;
      const whole = Math.ceil(this.countdown - 0.4);
      if (whole < this.lastBeep && whole >= 0) {
        this.lastBeep = whole;
        this.sound.beep(whole === 0);
      }
      if (this.countdown <= 0.4) {
        this.state = STATE.RACING;
      } else {
        // Engines idle on the line; nobody moves yet.
        this.sound.updateEngine(0.12 + Math.random() * 0.05, 0, false);
        this.particles.update(dt);
        return;
      }
    }

    this.time += dt;
    const racing = this.state === STATE.RACING;

    for (const t of this.trucks) {
      t.raceTime = this.time;
      if (t.finished) {
        // Coast to a stop after the flag.
        t.update(dt, { steer: 0, throttle: 0, brake: 0.4 }, this.track, this.fx);
        continue;
      }
      if (t.isPlayer) {
        t.update(dt, racing ? input : { steer: 0, throttle: 0, brake: 0 }, this.track, this.fx);
      } else {
        const driver = this.drivers[t.index - 1];
        const ai = driver.update(dt, this.track, this.time);
        t.update(dt, ai, this.track, this.fx);
      }
    }

    collideTrucks(this.trucks);
    if (racing) this.recoverStuck(dt);
    this.particles.update(dt);
    this.updateStandings();
    this.updateTimeLimit(dt);
    this.updateCamera(dt);

    // Engine note follows the player.
    const p = this.player;
    this.sound.updateEngine(
      clamp(Math.abs(p.forwardSpeed) / p.stats.maxSpeed, 0, 1.2),
      input.throttle,
      p.surface !== "track"
    );

    this.shake = Math.max(0, this.shake - dt * 2.4);

    // Wrong-way warning.
    const wp = this.track.points[p.wp];
    const sp = p.speed;
    this.wrongWay =
      sp > 60 && (p.vx * wp.hx + p.vy * wp.hy) / sp < -0.35 && !p.finished;

    this.pushHud();

    if (this.state === STATE.FINISHED) {
      this.finishDelay -= dt;
      if (this.finishDelay <= 0) this.reportResults();
    }
  }

  // Nobody should be able to wedge themselves against a berm and lose the
  // race to geometry. After a few seconds barely moving, put the truck back
  // on the centreline facing the right way.
  recoverStuck(dt) {
    for (const t of this.trucks) {
      if (t.finished) continue;
      if (t.speed > 42 || t.airborne) {
        t.stuckTimer = 0;
        continue;
      }
      t.stuckTimer = (t.stuckTimer || 0) + dt;
      if (t.stuckTimer < 2.6) continue;
      t.stuckTimer = 0;
      const wp = this.track.points[t.wp];
      t.x = wp.x;
      t.y = wp.y;
      t.angle = Math.atan2(wp.hy, wp.hx);
      t.vx = wp.hx * 60;
      t.vy = wp.hy * 60;
      t.z = 0;
      t.vz = 0;
      t.airborne = false;
      this.spawnDust(t.x, t.y, "dirt", 220);
      if (t.isPlayer) this.shake = Math.min(1, this.shake + 0.35);
    }
  }

  updateStandings() {
    for (const t of this.trucks) {
      if (!t.finished && t.lap > this.track.laps) {
        t.finished = true;
        t.finishTime = this.time;
      }
    }
    const sorted = this.trucks.slice().sort((a, b) => {
      if (a.timedOut !== b.timedOut) return a.timedOut ? 1 : -1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((t, i) => (t.place = i + 1));

    if (this.state === STATE.RACING && this.player.finished) {
      this.state = STATE.FINISHED;
      this.finishDelay = 1.6;
      this.sound.fanfare();
    }
  }

  // Arcade rule: once every other truck is home you have a short window to
  // cross the line, otherwise the race is called. Without this a parked
  // player could leave the race running forever.
  updateTimeLimit(dt) {
    if (this.state !== STATE.RACING || this.player.finished) return;
    const othersHome = this.trucks.every((t) => t.isPlayer || t.finished);
    if (!othersHome) {
      this.timeLeft = null;
      return;
    }
    this.timeLeft = (this.timeLeft === null ? TIME_AFTER_LEADERS : this.timeLeft) - dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.player.finished = true;
      this.player.finishTime = this.time;
      this.player.timedOut = true;
      this.state = STATE.FINISHED;
      this.finishDelay = 1.2;
    }
  }

  reportResults() {
    if (this.reported) return;
    this.reported = true;
    const p = this.player;
    const place = p.place;
    const payout = Math.round(this.level.prize * (PLACE_PAYOUT[place - 1] ?? 0.1));
    this.onFinish({
      place,
      time: p.finishTime || this.time,
      bestLap: isFinite(p.bestLap) ? p.bestLap : 0,
      payout,
      qualified: place <= 3,
      standings: this.trucks
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((t) => ({
          name: t.name,
          place: t.place,
          isPlayer: t.isPlayer,
          color: t.colors.body,
          time: t.finished ? t.finishTime : null,
        })),
    });
    this.stop();
  }

  updateCamera(dt) {
    const b = this.track.bounds;
    if (this.cameraMode === "follow") {
      const scale = this.fitScale * 2.1;
      const halfW = this.viewW / scale / 2;
      const halfH = this.viewH / scale / 2;
      let tx = this.player.x + this.player.vx * 0.22;
      let ty = this.player.y + this.player.vy * 0.22;
      // Keep the view inside the baked track image.
      tx = b.w > halfW * 2 ? clamp(tx, b.x + halfW, b.x + b.w - halfW) : b.x + b.w / 2;
      ty = b.h > halfH * 2 ? clamp(ty, b.y + halfH, b.y + b.h - halfH) : b.y + b.h / 2;
      const k = Math.min(1, dt * 6);
      this.cam.x = lerp(this.cam.x, tx, k);
      this.cam.y = lerp(this.cam.y, ty, k);
      this.cam.scale = scale;
    } else {
      this.cam.x = b.x + b.w / 2;
      this.cam.y = b.y + b.h / 2;
      this.cam.scale = this.fitScale;
    }
  }

  pushHud() {
    const p = this.player;
    this.onHud({
      place: p.place,
      total: this.trucks.length,
      lap: clamp(Math.max(1, p.lap), 1, this.track.laps),
      laps: this.track.laps,
      time: formatTime(this.time),
      bestLap: isFinite(p.bestLap) ? formatTime(p.bestLap) : "--:--.--",
      nitro: p.nitroLeft,
      nitroMax: p.stats.nitroCount,
      speed: Math.round(Math.abs(p.forwardSpeed) * 0.42),
      boosting: p.nitroTimer > 0,
      wrongWay: this.wrongWay,
      timeLeft: this.timeLeft !== null ? Math.max(0, Math.ceil(this.timeLeft)) : null,
      countdown:
        this.state === STATE.COUNTDOWN ? Math.max(0, Math.ceil(this.countdown - 0.4)) : null,
      finished: p.finished,
    });
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.palette.sky;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const shakeX = (Math.random() - 0.5) * this.shake * 9;
    const shakeY = (Math.random() - 0.5) * this.shake * 9;
    const s = this.cam.scale;
    ctx.setTransform(
      dpr * s, 0, 0, dpr * s,
      dpr * (this.viewW / 2 - this.cam.x * s + shakeX),
      dpr * (this.viewH / 2 - this.cam.y * s + shakeY)
    );

    const b = this.track.bounds;
    ctx.drawImage(this.trackCanvas, b.x, b.y, b.w, b.h);

    this.particles.draw(ctx);

    // Draw in z order so airborne trucks sit on top.
    const order = this.trucks.slice().sort((a, b2) => a.z - b2.z);
    for (const t of order) drawTruck(ctx, t, { marker: t.isPlayer });

    this.drawOverlay();
  }

  drawOverlay() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.state === STATE.COUNTDOWN) {
      const n = Math.max(0, Math.ceil(this.countdown - 0.4));
      const text = n > 0 ? String(n) : "GO!";
      const frac = (this.countdown - 0.4) % 1;
      const scale = 1 + (1 - frac) * 0.25;
      ctx.save();
      ctx.translate(this.viewW / 2, this.viewH / 2);
      ctx.scale(scale, scale);
      ctx.font = "900 86px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 10;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = n > 0 ? "#ffd34d" : "#6ee87a";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    if (this.wrongWay) {
      ctx.save();
      ctx.font = "800 26px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = Math.floor(this.time * 4) % 2 ? "#ff5252" : "#ffffff";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 6;
      ctx.strokeText("WRONG WAY", this.viewW / 2, 54);
      ctx.fillText("WRONG WAY", this.viewW / 2, 54);
      ctx.restore();
    }

    if (this.timeLeft !== null && this.state === STATE.RACING) {
      const t = Math.max(0, Math.ceil(this.timeLeft));
      ctx.save();
      ctx.font = "800 30px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      const label = `FINISH IN ${t}`;
      ctx.strokeText(label, this.viewW / 2, 92);
      ctx.fillStyle = t <= 10 && Math.floor(this.time * 3) % 2 ? "#ff5252" : "#ffffff";
      ctx.fillText(label, this.viewW / 2, 92);
      ctx.restore();
    }

    if (this.state === STATE.FINISHED) {
      ctx.save();
      ctx.font = "900 54px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 9;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      const banner = this.player.timedOut ? "OUT OF TIME" : "FINISH";
      ctx.strokeText(banner, this.viewW / 2, this.viewH / 2);
      ctx.fillStyle = this.player.timedOut ? "#ff6b6b" : "#ffd34d";
      ctx.fillText(banner, this.viewW / 2, this.viewH / 2);
      ctx.restore();
    }
  }
}

export { STATE };
