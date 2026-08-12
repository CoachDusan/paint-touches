// Placeholder service worker for Stage 1.
//
// This does NOT cache anything yet — full offline support (precaching the
// app shell so the app works with zero connectivity) is built in Stage 6.
// Registering it early just avoids a confusing 404 in the console and lets
// us confirm the registration plumbing works before adding real caching.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
