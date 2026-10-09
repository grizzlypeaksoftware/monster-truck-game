// Progress persistence. One JSON blob in localStorage; every read is
// defensive so a corrupted or half-written save can't brick the game.

const KEY = "monster-truck-game.save.v1";

const DEFAULTS = {
  money: 0,
  truckColor: 0,
  upgrades: { engine: 0, tires: 0, shocks: 0, nitro: 0 },
  unlocked: 1,
  results: {},   // levelId -> { place, bestLap, time }
  settings: { sound: true, autoGas: true, tilt: false, camera: "fit" },
};

// structuredClone is missing on older mobile browsers.
const clone = (o) =>
  typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o));

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULTS);
    const data = JSON.parse(raw);
    return {
      ...clone(DEFAULTS),
      ...data,
      upgrades: { ...DEFAULTS.upgrades, ...(data.upgrades || {}) },
      settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
      results: data.results || {},
    };
  } catch (err) {
    console.warn("Could not read save, starting fresh.", err);
    return clone(DEFAULTS);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Private browsing or a full quota — the game still plays, it just
    // won't remember anything.
    console.warn("Could not write save.", err);
  }
}

export function reset() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    /* ignore */
  }
  return clone(DEFAULTS);
}
