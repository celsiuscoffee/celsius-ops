// Service worker for order.celsiuscoffee.com (the Next.js customer webapp).
//
// This file is now the SINGLE source of truth — the old build-pwa step that
// overwrote it with apps/pickup-native's copy is gone, along with the Expo
// web bundle it cached. v46 bumps over v45 specifically to purge the cached
// Expo SPA shell (/index.html + /_expo/* assets) from every installed PWA,
// so stale installs stop booting the retired pickup UI offline.
//
// Push handlers stay: existing web-push subscribers (loyalty pushes) are
// registered against this SW and must keep receiving notifications.
const CACHE = "celsius-v46";
const SHELL = ["/", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  // Network-first with cache fallback — pages keep working offline-ish,
  // but a deploy is picked up on the next online load.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((c) => c || caches.match("/"))),
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "Celsius Coffee", body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "Celsius Coffee";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: data.data || {},
    tag: data.tag,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.endsWith(target) && "focus" in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
