// AgriVision Service Worker
// Static assets are fetched from the network first so deployments
// immediately receive updated HTML, CSS and JavaScript files.

const CACHE = "agrivision-v5";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/firebase-config.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Never interfere with non-GET requests.
  if (event.request.method !== "GET") {
    return;
  }

  // Network first: always try to get the newest deployed files.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});