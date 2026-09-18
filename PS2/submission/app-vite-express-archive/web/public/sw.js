// Offline support for the "no signal underground" requirement (PS2_README
// §2.6). Two jobs, deliberately kept separate from the app-level caching in
// App.tsx (localStorage) rather than doing everything here:
//
//   1. Map tiles: cache-first, so a segment of map she's already scrolled
//      through stays visible when the signal drops.
//   2. The app shell (HTML/JS/CSS): network-first with a cache fallback, so
//      a reload while offline still loads *something* instead of a blank
//      browser error page.
//
// /api/* is deliberately NOT cached here — live data has no business being
// served stale from a service worker cache. The "last known status" fallback
// is handled explicitly in App.tsx via localStorage instead, so it's visible
// application logic with a staleness label, not hidden cache behaviour.

const TILE_CACHE = "ps2-tiles-v1";
const SHELL_CACHE = "ps2-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== TILE_CACHE && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) {
    return; // never intercept live data
  }

  const isTile = url.hostname.endsWith("tile.openstreetmap.org");
  if (isTile) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        } catch (err) {
          return cached || Response.error();
        }
      }),
    );
    return;
  }

  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        try {
          const res = await fetch(event.request);
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        } catch (err) {
          const cached = await cache.match(event.request);
          return cached || Response.error();
        }
      }),
    );
  }
});
