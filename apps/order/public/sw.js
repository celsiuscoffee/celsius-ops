// Celsius Coffee PWA Service Worker

const CACHE_NAME = "celsius-v1";

// Install — cache shell assets
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate — claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push — show notification when order is ready
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Celsius Coffee", body: event.data.text() };
  }

  const options = {
    body:    data.body   ?? "Your order update",
    icon:    data.icon   ?? "/icons/icon-192.png",
    badge:   data.badge  ?? "/icons/badge-72.png",
    tag:     data.tag    ?? "celsius-order",
    data:    data.data   ?? {},
    actions: data.actions ?? [
      { action: "view", title: "View Order" },
    ],
    requireInteraction: data.requireInteraction ?? true,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(data.title ?? "Celsius Coffee", options)
  );
});

// Notification click — open order page
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const orderId = event.notification.data?.orderId;
  const url     = orderId ? `/order/${orderId}` : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing window if open
        for (const client of clients) {
          if (client.url.includes(url) && "focus" in client) {
            return client.focus();
          }
        }
        // Open new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});
