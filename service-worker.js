// Makes the app work with zero connectivity. On install, every file the
// app needs is downloaded once and stored in a versioned cache; after
// that, every request is served straight from that cache, so the app
// opens instantly with no network at all — exactly what's needed for a
// gym with no signal.
//
// Game data itself never touches this file — that all lives in
// IndexedDB (see db.js), which the browser keeps regardless of what this
// service worker does. Updating the app shell here can never lose a game.

// Bump this on every deploy that changes an app file. The fetch handler is
// cache-first, so an unchanged version number means iPads keep serving the
// old code forever, no matter what's on the server.
const CACHE_VERSION = "v15";
const CACHE_NAME = `paint-touches-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/app.js",
  "./js/db.js",
  "./js/models.js",
  "./js/possession.js",
  "./js/stats.js",
  "./js/sort.js",
  "./js/utils.js",
  "./js/views/entity-list.js",
  "./js/views/game.js",
  "./js/views/history.js",
  "./js/views/live-tracking.js",
  "./js/views/playbook.js",
  "./js/views/roster.js",
  "./js/views/stats-panel.js",
  "./js/views/defense-stats-panel.js",
  "./js/views/game-stats.js",
  "./js/views/season.js",
  "./js/views/export-actions.js",
  "./js/views/backup-card.js",
  "./js/export.js",
  "./js/share.js",
  "./vendor/idb.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Cache-first: every asset the app needs was already precached above, so
// this should almost always be an instant local hit. If something's
// missing from the cache (e.g. mid-upgrade), fall back to the network
// and quietly store whatever comes back for next time.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
