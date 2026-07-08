// Celsius Staff — Service Worker
// Precache the app shell for offline, keep the network authoritative for HTML
// (so auth/fresh data always win) and never cache API responses.
const CACHE_NAME = "celsius-staff-v2";
const PRECACHE_URLS = ["/home", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone
  if (url.pathname.startsWith("/api/")) return; // NEVER cache API / auth

  // HTML navigations: network-first so a signed-in shell + fresh data always
  // win; fall back to the precached /home shell only when truly offline. We do
  // not cache each navigation, so an authed page is never served to the wrong
  // session.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/home")));
    return;
  }

  // Static assets (icons, css, js, fonts): stale-while-revalidate.
  if (["image", "style", "script", "font"].includes(req.destination)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
