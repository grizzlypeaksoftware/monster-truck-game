// Screen management, menus, garage, level select and results.

import { formatTime, ordinal, clamp } from "./utils.js";
import { LEVELS, CUP_LIST } from "./tracks.js";
import { UPGRADE_DEFS, MAX_LEVEL, upgradeCost, computeStats } from "./upgrades.js";
import { TRUCK_COLORS } from "./render.js";
import { Input } from "./input.js";
import { Sound } from "./audio.js";
import { Race } from "./game.js";
import * as Store from "./storage.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  save: Store.load(),
  currentLevel: 0,
  lastResult: null,
};

const sound = new Sound();
const input = new Input({
  autoGas: state.save.settings.autoGas,
  onNitro: () => race && race.nitro(),
  onPause: () => togglePause(),
});
let race = null;

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function show(id) {
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${id}`));
  document.body.dataset.screen = id;
}

function persist() {
  Store.save(state.save);
}

// ---------------------------------------------------------------------------
// Level select
// ---------------------------------------------------------------------------

function medal(place) {
  if (!place) return "";
  return ["\u{1F947}", "\u{1F948}", "\u{1F949}"][place - 1] || `${place}th`;
}

function buildLevelList() {
  const host = $("#level-list");
  host.innerHTML = "";

  for (const cup of CUP_LIST) {
    const cupUnlocked = cup.levels.some((id) => id < state.save.unlocked);
    const section = document.createElement("div");
    section.className = "cup-block mb-4";

    const done = cup.levels.filter((id) => state.save.results[id]).length;
    section.innerHTML = `
      <div class="d-flex align-items-center justify-content-between mb-2">
        <h3 class="cup-title mb-0">${cup.name}</h3>
        <span class="badge text-bg-dark">${done}/${cup.levels.length}</span>
      </div>
      <div class="row g-2" data-cup="${cup.index}"></div>`;

    const row = section.querySelector("[data-cup]");
    for (const id of cup.levels) {
      const level = LEVELS[id];
      const unlocked = id < state.save.unlocked;
      const res = state.save.results[id];
      const col = document.createElement("div");
      col.className = "col-6 col-sm-4 col-lg-3";
      col.innerHTML = `
        <button class="level-card ${unlocked ? "" : "locked"} theme-${level.theme}"
                data-level="${id}" ${unlocked ? "" : "disabled"}>
          <span class="level-num">${id + 1}</span>
          <span class="level-name">${unlocked ? level.name : "Locked"}</span>
          <span class="level-meta">
            ${unlocked
              ? `${level.laps} laps${res ? ` &middot; ${medal(res.place)}` : ""}`
              : "Finish top 3 to unlock"}
          </span>
          ${res && res.bestLap
            ? `<span class="level-best">Best lap ${formatTime(res.bestLap)}</span>`
            : ""}
        </button>`;
      row.appendChild(col);
    }
    if (!cupUnlocked) section.classList.add("cup-locked");
    host.appendChild(section);
  }

  host.querySelectorAll("[data-level]").forEach((btn) => {
    btn.addEventListener("click", () => startRace(Number(btn.dataset.level)));
  });
}

// ---------------------------------------------------------------------------
// Garage
// ---------------------------------------------------------------------------

function buildGarage() {
  $("#garage-money").textContent = `$${state.save.money.toLocaleString()}`;
  const host = $("#upgrade-list");
  host.innerHTML = "";

  for (const def of UPGRADE_DEFS) {
    const lvl = state.save.upgrades[def.key] || 0;
    const cost = upgradeCost(def.key, lvl);
    const maxed = lvl >= MAX_LEVEL;
    const afford = cost !== null && state.save.money >= cost;

    const pips = Array.from({ length: MAX_LEVEL }, (_, i) =>
      `<span class="pip ${i < lvl ? "on" : ""}"></span>`
    ).join("");

    const card = document.createElement("div");
    card.className = "col-12 col-md-6";
    card.innerHTML = `
      <div class="upgrade-card">
        <div class="upgrade-head">
          <span class="upgrade-icon">${def.icon}</span>
          <div>
            <h4>${def.name}</h4>
            <p>${def.blurb}</p>
          </div>
        </div>
        <div class="pips">${pips}</div>
        <button class="btn ${maxed ? "btn-secondary" : afford ? "btn-warning" : "btn-outline-secondary"} w-100 fw-bold"
                data-buy="${def.key}" ${maxed || !afford ? "disabled" : ""}>
          ${maxed
            ? "MAXED OUT"
            : afford
              ? `UPGRADE &mdash; $${cost.toLocaleString()}`
              : `NEEDS $${cost.toLocaleString()}`}
        </button>
      </div>`;
    host.appendChild(card);
  }

  host.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => buyUpgrade(btn.dataset.buy));
  });

  const colors = $("#color-picker");
  colors.innerHTML = "";
  TRUCK_COLORS.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = `swatch ${i === state.save.truckColor ? "selected" : ""}`;
    b.style.background = c.body;
    b.title = c.name;
    b.setAttribute("aria-label", `${c.name} truck`);
    b.addEventListener("click", () => {
      state.save.truckColor = i;
      persist();
      buildGarage();
    });
    colors.appendChild(b);
  });
}

function buyUpgrade(key) {
  const lvl = state.save.upgrades[key] || 0;
  const cost = upgradeCost(key, lvl);
  if (cost === null || state.save.money < cost) return;
  state.save.money -= cost;
  state.save.upgrades[key] = lvl + 1;
  persist();
  sound.init();
  sound.buy();
  buildGarage();
}

// ---------------------------------------------------------------------------
// Race
// ---------------------------------------------------------------------------

const hudCache = {};
function setHud(key, el, value) {
  if (hudCache[key] === value) return;
  hudCache[key] = value;
  el.textContent = value;
}

const hudEls = {};

function onHud(h) {
  setHud("place", hudEls.place, ordinal(h.place));
  setHud("lap", hudEls.lap, `${h.lap}/${h.laps}`);
  setHud("time", hudEls.time, h.time);
  setHud("best", hudEls.best, h.bestLap);
  setHud("speed", hudEls.speed, String(h.speed));
  setHud("nitro", hudEls.nitro, `${h.nitro}`);
  hudEls.nitroBtn.classList.toggle("empty", h.nitro <= 0);
  hudEls.nitroBtn.classList.toggle("boosting", h.boosting);
}

function startRace(levelId) {
  state.currentLevel = levelId;
  const level = LEVELS[levelId];
  show("race");
  sound.init();
  sound.setEnabled(state.save.settings.sound);
  input.autoGas = state.save.settings.autoGas;
  $("#race-title").textContent = `${level.name} · ${level.cup}`;
  $("#gas-btn").classList.toggle("d-none", state.save.settings.autoGas);
  $("#pause-overlay").classList.add("d-none");
  Object.keys(hudCache).forEach((k) => delete hudCache[k]);

  if (!race) {
    race = new Race($("#game-canvas"), {
      sound,
      input,
      onHud,
      onFinish: onRaceFinish,
    });
  }
  race.reported = false;
  race.cameraMode = state.save.settings.camera;
  // Let the layout settle before measuring the canvas.
  requestAnimationFrame(() => {
    race.start(level, computeStats(state.save.upgrades), state.save.truckColor, state.save.settings);
  });
}

function onRaceFinish(result) {
  const level = LEVELS[state.currentLevel];
  state.lastResult = result;

  state.save.money += result.payout;
  const prev = state.save.results[state.currentLevel];
  const better = !prev || result.place < prev.place;
  state.save.results[state.currentLevel] = {
    place: better ? result.place : prev.place,
    bestLap:
      prev && prev.bestLap && (!result.bestLap || prev.bestLap < result.bestLap)
        ? prev.bestLap
        : result.bestLap,
    time: prev && prev.time && prev.time < result.time ? prev.time : result.time,
  };
  if (result.qualified && state.currentLevel + 1 >= state.save.unlocked) {
    state.save.unlocked = Math.min(LEVELS.length, state.currentLevel + 2);
  }
  persist();

  $("#result-place").textContent = ordinal(result.place);
  $("#result-place").className = `result-place p${result.place}`;
  $("#result-headline").textContent =
    result.place === 1 ? "WINNER!" : result.qualified ? "QUALIFIED" : "TRY AGAIN";
  $("#result-payout").textContent = `+$${result.payout.toLocaleString()}`;
  $("#result-money").textContent = `$${state.save.money.toLocaleString()}`;
  $("#result-time").textContent = formatTime(result.time);
  $("#result-bestlap").textContent = result.bestLap ? formatTime(result.bestLap) : "--:--.--";
  $("#result-track").textContent = `${level.name} · ${level.cup}`;

  const unlockNote = $("#result-unlock");
  const nextLevel = LEVELS[state.currentLevel + 1];
  unlockNote.classList.remove("d-none", "text-bg-success", "text-bg-warning");
  if (result.qualified && nextLevel) {
    unlockNote.textContent = `Unlocked: ${nextLevel.name}`;
    unlockNote.classList.add("text-bg-success");
  } else if (!result.qualified) {
    unlockNote.textContent = "Finish in the top 3 to unlock the next track.";
    unlockNote.classList.add("text-bg-warning");
  } else {
    unlockNote.classList.add("d-none");
  }

  const tbody = $("#result-standings");
  tbody.innerHTML = result.standings
    .map(
      (s) => `
      <tr class="${s.isPlayer ? "you" : ""}">
        <td class="text-muted">${s.place}</td>
        <td><span class="dot" style="background:${s.color}"></span>${s.name}</td>
        <td class="text-end">${s.time ? formatTime(s.time) : "&mdash;"}</td>
      </tr>`
    )
    .join("");

  const nextBtn = $("#btn-next-race");
  nextBtn.classList.toggle("d-none", !(result.qualified && nextLevel));
  show("results");
}

function togglePause() {
  if (!race || document.body.dataset.screen !== "race") return;
  const overlay = $("#pause-overlay");
  if (overlay.classList.contains("d-none")) {
    if (race.pause()) overlay.classList.remove("d-none");
  } else {
    overlay.classList.add("d-none");
    race.resume();
  }
}

function quitRace() {
  if (race) race.stop();
  $("#pause-overlay").classList.add("d-none");
  buildLevelList();
  show("levels");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function buildSettings() {
  const s = state.save.settings;
  $("#set-sound").checked = s.sound;
  $("#set-autogas").checked = s.autoGas;
  $("#set-tilt").checked = s.tilt;
  $$("[name=camera]").forEach((r) => (r.checked = r.value === s.camera));
  $("#stat-races").textContent = Object.keys(state.save.results).length;
  $("#stat-wins").textContent = Object.values(state.save.results).filter(
    (r) => r.place === 1
  ).length;
  $("#stat-unlocked").textContent = `${state.save.unlocked}/${LEVELS.length}`;
}

function wireSettings() {
  $("#set-sound").addEventListener("change", (e) => {
    state.save.settings.sound = e.target.checked;
    sound.setEnabled(e.target.checked);
    persist();
  });
  $("#set-autogas").addEventListener("change", (e) => {
    state.save.settings.autoGas = e.target.checked;
    input.autoGas = e.target.checked;
    persist();
  });
  $("#set-tilt").addEventListener("change", async (e) => {
    if (e.target.checked) {
      const ok = await input.requestTilt();
      if (!ok) {
        e.target.checked = false;
        $("#tilt-note").textContent = "Your device refused motion access.";
        return;
      }
      $("#tilt-note").textContent = "Tilt your phone to steer.";
    } else {
      input.disableTilt();
      $("#tilt-note").textContent = "";
    }
    state.save.settings.tilt = e.target.checked;
    persist();
  });
  $$("[name=camera]").forEach((r) =>
    r.addEventListener("change", () => {
      if (!r.checked) return;
      state.save.settings.camera = r.value;
      if (race) race.cameraMode = r.value;
      persist();
    })
  );
  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("Erase all progress, money and upgrades?")) return;
    state.save = Store.reset();
    buildSettings();
    buildGarage();
    buildLevelList();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function wireNav() {
  $$("[data-go]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const target = btn.dataset.go;
      sound.init();
      if (target === "levels") buildLevelList();
      if (target === "garage") buildGarage();
      if (target === "settings") buildSettings();
      if (document.body.dataset.screen === "race" && target !== "race") {
        if (race) race.stop();
      }
      show(target);
    })
  );

  $("#btn-pause").addEventListener("click", togglePause);
  $("#btn-resume").addEventListener("click", togglePause);
  $("#btn-quit").addEventListener("click", quitRace);
  $("#btn-restart").addEventListener("click", () => {
    $("#pause-overlay").classList.add("d-none");
    startRace(state.currentLevel);
  });
  $("#btn-retry").addEventListener("click", () => startRace(state.currentLevel));
  $("#btn-next-race").addEventListener("click", () =>
    startRace(Math.min(LEVELS.length - 1, state.currentLevel + 1))
  );
  $("#btn-quick-race").addEventListener("click", () => {
    // Jump straight into the furthest track you've unlocked.
    startRace(clamp(state.save.unlocked - 1, 0, LEVELS.length - 1));
  });
}

function wireHud() {
  hudEls.place = $("#hud-place");
  hudEls.lap = $("#hud-lap");
  hudEls.time = $("#hud-time");
  hudEls.best = $("#hud-best");
  hudEls.speed = $("#hud-speed");
  hudEls.nitro = $("#hud-nitro");
  hudEls.nitroBtn = $("#nitro-btn");

  input.attach();
  input.setupTouchControls({
    left: $("#left-btn"),
    right: $("#right-btn"),
    gas: $("#gas-btn"),
    brake: $("#brake-btn"),
    nitro: $("#nitro-btn"),
  });
}

function wireMisc() {
  // Stop iOS rubber-banding and double-tap zoom while racing.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (document.body.dataset.screen === "race") e.preventDefault();
    },
    { passive: false }
  );
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && race && document.body.dataset.screen === "race") {
      const overlay = $("#pause-overlay");
      if (overlay.classList.contains("d-none") && race.pause()) {
        overlay.classList.remove("d-none");
      }
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        /* offline support is a bonus, not a requirement */
      });
    });
  }
}

function boot() {
  wireNav();
  wireHud();
  wireSettings();
  wireMisc();
  buildLevelList();
  buildGarage();
  buildSettings();
  sound.setEnabled(state.save.settings.sound);
  if (state.save.settings.tilt) input.requestTilt();
  show("menu");
  $("#boot-loader").remove();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
