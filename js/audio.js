// Everything is synthesised with WebAudio, so there are no sound files to
// download and the game still has engines when you're offline at 30,000 feet.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.engine = null;
  }

  // Must be called from a user gesture or iOS keeps the context suspended.
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.5 : 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise();
    } catch (err) {
      console.warn("No audio available.", err);
      this.ctx = null;
    }
  }

  makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.8);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  startEngine() {
    if (!this.ctx || this.engine) return;
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    sub.type = "square";
    osc.frequency.value = 60;
    sub.frequency.value = 30;
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.Q.value = 3;
    gain.gain.value = 0.0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    sub.start();
    this.engine = { osc, sub, filter, gain };
  }

  stopEngine() {
    if (!this.engine) return;
    const { osc, sub, gain } = this.engine;
    try {
      gain.gain.cancelScheduledValues(this.ctx.currentTime);
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      osc.stop(this.ctx.currentTime + 0.3);
      sub.stop(this.ctx.currentTime + 0.3);
    } catch (err) {
      /* ignore */
    }
    this.engine = null;
  }

  // rpm 0..1, load 0..1 (how hard the throttle is down)
  updateEngine(rpm, load, rough) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 58 + rpm * 190;
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.06);
    this.engine.sub.frequency.setTargetAtTime(base * 0.5, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(500 + rpm * 1800, t, 0.08);
    const vol = 0.045 + rpm * 0.075 + load * 0.02 + (rough ? 0.03 : 0);
    this.engine.gain.gain.setTargetAtTime(vol, t, 0.08);
  }

  burst(opts) {
    if (!this.ctx || !this.enabled) return;
    const { freq = 200, dur = 0.2, type = "noise", gain = 0.3, sweep = 0 } = opts;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    g.connect(this.master);
    if (type === "noise") {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(freq, now);
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), now + dur);
      src.connect(f);
      f.connect(g);
      src.start(now);
      src.stop(now + dur);
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), now + dur);
      osc.connect(g);
      osc.start(now);
      osc.stop(now + dur);
    }
  }

  thud(power) {
    this.burst({ freq: 180 + power * 120, dur: 0.16 + power * 0.1, gain: 0.18 + power * 0.25, sweep: -140 });
  }

  land(hard) {
    this.burst({ freq: hard ? 260 : 170, dur: hard ? 0.3 : 0.18, gain: hard ? 0.3 : 0.16, sweep: -180 });
  }

  nitro() {
    this.burst({ freq: 900, dur: 0.55, gain: 0.26, sweep: 1600 });
    this.burst({ type: "sawtooth", freq: 160, dur: 0.5, gain: 0.12, sweep: 420 });
  }

  beep(high) {
    this.burst({ type: "square", freq: high ? 880 : 440, dur: high ? 0.45 : 0.16, gain: 0.2 });
  }

  fanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      setTimeout(() => this.burst({ type: "triangle", freq: f, dur: 0.3, gain: 0.2 }), i * 130);
    });
  }

  buy() {
    this.burst({ type: "triangle", freq: 660, dur: 0.12, gain: 0.2 });
    setTimeout(() => this.burst({ type: "triangle", freq: 990, dur: 0.14, gain: 0.18 }), 90);
  }
}
