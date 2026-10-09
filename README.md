# Monster Truck Game

A top-down offroad racer in the spirit of the arcade cabinets that used to sit
by the door at Pizza Hut — four trucks, one dirt track on screen at a time,
jumps, nitro, and a garage full of parts you buy with your winnings.

Built to be played on a phone, offline, with your thumbs.

- **30 tracks** across six themed cups — desert, mud, canyon, jungle, snow and
  a floodlit night circuit.
- **Four-truck races** against AI drivers who take their own racing line,
  defend corners, and occasionally make a mess of it.
- **Upgrades** — engine, tires, shocks and nitro, five levels each, paid for
  with prize money.
- **Works offline.** Open it once with a connection and it keeps running with
  no signal, which is the whole point if you're on a plane.
- No build step, no dependencies to install, no tracking, no accounts.

## Playing it

**On a phone.** Open the page, then add it to your home screen
(Share → *Add to Home Screen* on iOS, ⋮ → *Install app* on Android). It then
launches fullscreen like an app and works with the wifi off.

Hold the phone sideways. Arrows on the left steer, **NITRO** on the right is
your boost, **BRAKE** slows you down. The truck accelerates on its own unless
you turn that off in Settings.

**On a computer.** Arrow keys or WASD steer, space or shift fires nitro,
`P` or `Esc` pauses.

## Rules

Finish in the **top three** to unlock the next track. Where you finish decides
the prize money, and the money decides how fast your truck gets. Lose a race
and you keep the smaller prize — you can run it again as many times as you
like.

Once the other three trucks are home you get 40 seconds to cross the line
before the race is called.

## Running it locally

It's a static site and the JavaScript uses ES modules, so it needs to be
served over HTTP rather than opened as a `file://` path:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works for deploying it — GitHub Pages, Netlify, an S3 bucket.
Serve the repository root as-is. A service worker precaches everything on
first load, so it needs HTTPS (or localhost) for the offline behaviour.

## How it's put together

Plain JavaScript modules, a `<canvas>` for the race, and Bootstrap for the
menus. Nothing is compiled and nothing is fetched at runtime — Bootstrap is
vendored in `vendor/` so the game stays self-contained offline.

| File | What it does |
| --- | --- |
| `js/tracks.js` | Track geometry and the level table. Tracks are generated from a seed, so every level rebuilds identically, and shaped to the screen's aspect ratio so they fill a phone held sideways. |
| `js/truck.js` | Vehicle physics — forward/lateral velocity split, grip, surfaces, jumps, walls, collisions. |
| `js/ai.js` | The computer drivers: lookahead down the centreline, a personal racing line, corner braking, and the odd mistake. |
| `js/game.js` | Race state machine, fixed-step loop, camera, standings and lap timing. |
| `js/render.js` | Theme palettes, the baked track image, trucks, particles. |
| `js/upgrades.js` | The parts, their costs, and how they turn into physics numbers. |
| `js/input.js` | Touch buttons, keyboard and tilt steering. |
| `js/main.js` | Screens, menus, garage, results. |
| `js/storage.js` | Progress in `localStorage`. |
| `sw.js` | Offline cache. |

### Tracks

A track is a closed centreline of evenly spaced waypoints plus a width.
Off-track tests, lap progress, the AI racing line and feature placement are
all expressed against that one structure, which keeps the per-frame cost low
enough for a phone. The static scenery is drawn once into an offscreen canvas
at the start of a race and blitted each frame; only trucks, dust and shadows
are redrawn.

Lap counting watches for the waypoint index wrapping forward past the start
line, so cutting across the infield can't skip a lap — and the track edge is a
solid wall past a short rough berm, so you can't try.

### Balance

The AI stat curve is set against the player's own upgrade ladder: a stock
truck is a match for the first cup, and the last cup wants a nearly maxed one.
This was tuned by simulating the whole career headlessly — the physics, AI and
track modules have no DOM dependencies, so a full 30-track career runs in a
few seconds under Node. A career takes roughly 34–41 races, with the
occasional retry and no point where you can't afford to move forward.

## Licence

MIT.
