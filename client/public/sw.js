// Minimal service worker: makes the app installable ("Add to Home Screen" / "Install app").
// It doesn't cache anything — live data must always come from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // network as usual
