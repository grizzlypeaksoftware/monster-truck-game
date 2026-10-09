// Offline cache. Everything the game needs is precached on install, so once
// you have opened it with a connection it keeps working in the air.

const CACHE = "monster-truck-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./vendor/bootstrap.min.css",
  "./js/main.js",
  "./js/game.js",
  "./js/truck.js",
  "./js/ai.js",
  "./js/tracks.js",
  "./js/render.js",
  "./js/input.js",
  "./js/audio.js",
  "./js/storage.js",
  "./js/upgrades.js",
  "./js/utils.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing, so add individually and tolerate a miss.
      .then((cache) => Promise.all(ASSETS.map((a) => cache.add(a).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cache first: the game is static and we want it instant and offline.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          // A navigation that misses the cache still gets the shell.
          req.mode === "navigate" ? caches.match("./index.html") : Response.error()
        );
    })
  );
});
