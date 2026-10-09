// Input: on-screen touch controls, keyboard, and optional tilt steering.
// Everything funnels into one { steer, throttle, brake } object per frame.

import { clamp } from "./utils.js";

export class Input {
  constructor(opts = {}) {
    this.state = { steer: 0, throttle: 0, brake: 0 };
    this.keys = new Set();
    this.touchLeft = false;
    this.touchRight = false;
    this.touchGas = false;
    this.touchBrake = false;
    this.tiltEnabled = false;
    this.tilt = 0;
    this.autoGas = opts.autoGas !== false;
    this.onNitro = opts.onNitro || (() => {});
    this.onPause = opts.onPause || (() => {});
    this._bound = [];
    this._smoothSteer = 0;
  }

  attach() {
    const kd = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space" || e.code === "ShiftLeft") this.onNitro();
      if (e.code === "Escape" || e.code === "KeyP") this.onPause();
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    };
    const ku = (e) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener("keydown", kd, { passive: false });
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    this._bound.push(["keydown", kd], ["keyup", ku], ["blur", blur]);

    this._orient = (e) => {
      if (!this.tiltEnabled) return;
      // Landscape: gamma is the left/right tilt axis.
      const raw = typeof e.gamma === "number" ? e.gamma : 0;
      this.tilt = clamp(raw / 26, -1, 1);
    };
    window.addEventListener("deviceorientation", this._orient);
  }

  // Wire a DOM element as a hold-to-press button.
  bindButton(el, onDown, onUp) {
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      el.classList.add("pressed");
      onDown();
    };
    const up = (e) => {
      if (e) e.preventDefault();
      el.classList.remove("pressed");
      if (onUp) onUp();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    // Stop the browser treating a long press as a text selection / zoom.
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setupTouchControls(els) {
    this.bindButton(els.left, () => (this.touchLeft = true), () => (this.touchLeft = false));
    this.bindButton(els.right, () => (this.touchRight = true), () => (this.touchRight = false));
    this.bindButton(els.gas, () => (this.touchGas = true), () => (this.touchGas = false));
    this.bindButton(els.brake, () => (this.touchBrake = true), () => (this.touchBrake = false));
    this.bindButton(els.nitro, () => this.onNitro());
  }

  async requestTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") return false;
      } catch (err) {
        return false;
      }
    }
    this.tiltEnabled = true;
    return true;
  }

  disableTilt() {
    this.tiltEnabled = false;
    this.tilt = 0;
  }

  read(dt) {
    let steer = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) steer -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) steer += 1;
    if (this.touchLeft) steer -= 1;
    if (this.touchRight) steer += 1;
    if (steer === 0 && this.tiltEnabled) steer = this.tilt;

    // Ease the steering so taps don't snap the wheel to full lock.
    const rate = Math.min(1, dt * 13);
    this._smoothSteer += (clamp(steer, -1, 1) - this._smoothSteer) * rate;

    let throttle = this.autoGas ? 1 : 0;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW") || this.touchGas) throttle = 1;
    let brake = 0;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS") || this.touchBrake) {
      brake = 1;
      throttle = 0;
    }

    this.state.steer = this._smoothSteer;
    this.state.throttle = throttle;
    this.state.brake = brake;
    return this.state;
  }

  reset() {
    this.keys.clear();
    this.touchLeft = this.touchRight = this.touchGas = this.touchBrake = false;
    this._smoothSteer = 0;
  }
}
