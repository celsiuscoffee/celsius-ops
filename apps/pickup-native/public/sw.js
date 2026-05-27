// Bumped to v3 after the brute-force CSS in #157/#158 broke layouts in
// production. Customers stuck on the broken bundle via the cache need
// the new SW (with a fresh cache name) to install + activate +
// clients.claim() before they'll see the revert. Same drill as the
// v1->v2 bump after #148/#149.
//
// Future rule of thumb: bump this on ANY production-affecting bundle
// regression so customers don't get stuck on a bad build.
const CACHE = "celsius-v23";
const SHELL = ["/", "/index.html", "/manifest.json"];

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

  if (url.pathname.startsWith("/_expo/static/")) {
    e.respondWith(
      caches.match(e.request).then(
        (cached) =>
          cached ||
          fetch(e.request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
            return res;
          }),
      ),
    );
    return;
  }

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
