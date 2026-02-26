/* ============================================
   Emergency Hub – Service Worker
   Caches app shell for offline use
   (Map is fully canvas-based – no tiles needed)
   ============================================ */

const CACHE_NAME = "emergency-hub-v4";

// App shell files to pre-cache on install
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./whisper-worker.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
];

// ─── Install: pre-cache app shell ───
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ───
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: cache-first for app shell, network-first for everything else ───
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Pass PMTiles range requests straight through — file is on disk, never cache it
  if (url.pathname.endsWith(".pmtiles") || e.request.headers.get("range")) {
    return; // let browser handle it natively
  }

  // Let transformers.js handle its own model caching (IndexedDB) — don't intercept
  if (url.hostname === "huggingface.co" || url.hostname.endsWith(".huggingface.co")) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        if (response.ok && (url.origin === self.location.origin || url.hostname === "unpkg.com")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return response;
      }).catch(() =>
        e.request.mode === "navigate"
          ? caches.match("./index.html")
          : new Response("Offline", { status: 503 })
      );
    })
  );
});
