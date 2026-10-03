// Service worker: red primero y caché como respaldo, para que la app abra sin conexión.
const CACHE = "decants-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(request)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(request).then((r) => r ?? caches.match("./"))),
  );
});
