const CACHE = 'people-dates-20260816000000';
const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/sw.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          APP_SHELL.map((url) =>
            fetch(url, { cache: "reload" }).then((res) => c.put(url, res)),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Cache-first: the whole app is the shell, and the roster lives in
// localStorage rather than in any cached file, so this works fully offline.
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached ?? fetch(e.request)),
  );
});
