// Offline: every app file is saved on install and served from the phone from then on.
// Bump VERSION whenever a file below changes, so phones pick up the new version.
const VERSION = "v3";
const CACHE = "car-checker-" + VERSION;
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "manifest.json",
  "js/app.js",
  "js/db.js",
  "js/editor.js",
  "js/photos.js",
  "js/store.js",
  "js/util.js",
  "js/viewer.js",
  "fonts/oswald-latin-500-normal.woff2",
  "fonts/oswald-latin-600-normal.woff2",
  "fonts/work-sans-latin-400-normal.woff2",
  "fonts/work-sans-latin-500-normal.woff2",
  "fonts/work-sans-latin-600-normal.woff2",
  "fonts/ibm-plex-mono-latin-400-normal.woff2",
  "fonts/ibm-plex-mono-latin-500-normal.woff2",
  "fonts/ibm-plex-mono-latin-600-normal.woff2",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      if (e.request.mode === "navigate") return caches.match("index.html");
      return fetch(e.request);
    })
  );
});
