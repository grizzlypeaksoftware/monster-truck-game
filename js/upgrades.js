// Garage upgrades. Four parts, five levels each, bought with race winnings.

export const UPGRADE_DEFS = [
  {
    key: "engine",
    name: "Engine",
    blurb: "More top speed and punch out of the corners.",
    icon: "⚙",
    costs: [700, 1300, 2200, 3400, 5200],
  },
  {
    key: "tires",
    name: "Tires",
    blurb: "Grip. Turn harder without washing out.",
    icon: "◎",
    costs: [600, 1150, 1950, 3100, 4800],
  },
  {
    key: "shocks",
    name: "Shocks",
    blurb: "Soak up landings and keep speed over rough ground.",
    icon: "⌵",
    costs: [550, 1050, 1800, 2900, 4500],
  },
  {
    key: "nitro",
    name: "Nitro",
    blurb: "An extra bottle per race, and a harder kick.",
    icon: "✦",
    costs: [800, 1400, 2300, 3600, 5500],
  },
];

export const MAX_LEVEL = 5;

export function upgradeCost(key, currentLevel) {
  const def = UPGRADE_DEFS.find((u) => u.key === key);
  if (!def || currentLevel >= MAX_LEVEL) return null;
  return def.costs[currentLevel];
}

// Turn upgrade levels into the numbers the physics actually reads.
export function computeStats(up) {
  const e = up.engine || 0;
  const t = up.tires || 0;
  const s = up.shocks || 0;
  const n = up.nitro || 0;
  return {
    maxSpeed: 316 + e * 27,
    accel: 236 + e * 23,
    brake: 430,
    steer: 2.45 + t * 0.1,
    grip: 7.4 + t * 0.95,          // lateral slip damping (higher = stickier)
    offroadSpeed: 0.56 + s * 0.035,
    offroadGrip: 0.46 + t * 0.055,
    landing: 0.70 + s * 0.052,     // fraction of speed kept on a hard landing
    nitroCount: 2 + n,
    nitroPower: 1.26 + n * 0.055,
  };
}

// AI trucks don't shop; their kit is derived from the level's skill rating.
// The curve is set against the player's own upgrade ladder: a stock truck is
// a match for the first cup, and the last cup wants a nearly maxed one.
export function aiStats(skill, variance) {
  const k = skill + variance;
  return {
    maxSpeed: 26 + k * 408,     // ~303 in cup 1, ~430 in cup 6
    accel: 150 + k * 175,
    brake: 420,
    steer: 1.95 + k * 1.02,
    grip: -1.2 + k * 12.9,      // ~7.6 in cup 1, ~11.6 in cup 6
    offroadSpeed: 0.58,
    offroadGrip: 0.52,
    landing: 0.8,
    nitroCount: Math.max(1, Math.round(k * 3)),
    nitroPower: 1.3,
  };
}
