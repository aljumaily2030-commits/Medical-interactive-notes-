const CACHE_NAME = "mednotes-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/images/android-chrome-192x192.png",
  "./assets/images/android-chrome-512x512.png",
  "./assets/style.css",
  "./scripts/script.js",
  "./scripts/editor.js",
  "./scripts/storage.js",
  "./scripts/constants.js",
  "./scripts/medical-source-lock.js",
  "./scripts/preview/mermaid-renderer.js",
  "./scripts/vendor/codemirror-bundle.js",
  "./scripts/vendor/pdfjs/pdf.mjs",
  "./scripts/vendor/pdfjs/pdf.worker.mjs"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (event.request.method === "GET") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
