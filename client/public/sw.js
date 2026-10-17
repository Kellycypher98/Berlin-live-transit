// Service worker: makes the app installable and shows journey notifications while it's closed.
// It doesn't cache anything — live data must always come from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // network as usual

// Journey updates from the server. Same tag = the previous update is replaced, like one live card.
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data?.text() ?? "Berlin Live Transit" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Berlin Live Transit", {
    body: d.body || "",
    tag: d.tag || "blt",
    renotify: !!d.renotify,          // buzz only for "board now", "get off", changes, cancellations
    silent: !d.renotify,
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    data: { url: d.url || "/" },
  }));
});

// Tapping the notification opens (or focuses) the app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.find(w => w.url.startsWith(self.location.origin));
    if (open) return open.focus();
    return self.clients.openWindow(url);
  })());
});
