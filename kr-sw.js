/* =========================================================
   KatgoRoutine — Service Worker (kr-sw.js)
   Cel: stabilne aktualizacje na GitHub Pages (bez „starej wersji” po deployu).

   Strategy:
   - HTML / navigation (w tym /index.html): NETWORK FIRST + fetch cache bypass
   - Assets (CSS/JS/images/fonts): CACHE FIRST
   - Nie przechwytujemy cross-origin (np. Supabase) ani nie-GET.

   WAŻNE:
   - GitHub Pages + przeglądarki potrafią serwować HTML z HTTP cache.
     Dlatego dla HTML używamy fetch z { cache: 'no-store' }.
   ========================================================= */

const CACHE_NAME = "kr-shell-v1";
const SHELL_URL = "./index.html";

const ASSETS = [
  "./",
  "./index.html",
  "./robots.txt"
];

// Helper: prefetch z ominięciem HTTP cache (ważne dla index.html na Pages)
async function fetchBypassCache(url) {
  return fetch(url, { cache: "no-store" });
}

// INSTALL
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Precache (bypass HTTP cache)
    for (const url of ASSETS) {
      const res = await fetchBypassCache(url);
      if (!res || !res.ok) {
        // Nie przerywamy instalacji przez pojedynczy asset,
        // ale to będzie widoczne w konsoli.
        console.error("[SW] precache failed:", url, res && res.status);
        continue;
      }
      await cache.put(url, res.clone());
    }
  })());
});

// ACTIVATE
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()))
        )
      )
      .then(() => self.clients.claim())
  );
});

// FETCH
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Guard: tylko GET i tylko ten sam origin
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isHTMLNav = (req.mode === "navigate") || (url.pathname.endsWith("/index.html"));

  // HTML / navigation → NETWORK FIRST (bypass HTTP cache)
  if (isHTMLNav) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-store" });
        // Cache latest shell for offline fallback
        const cache = await caches.open(CACHE_NAME);
        await cache.put(SHELL_URL, res.clone());
        // Dodatkowo cache konkretny URL nawigacji (np. / lub /index.html)
        await cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        const shell = await caches.match(SHELL_URL);
        return shell || caches.match("./");
      }
    })());
    return;
  }

  // ASSETS → CACHE FIRST (bez ryzyka „starego HTML”)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req));
    })
  );
});
