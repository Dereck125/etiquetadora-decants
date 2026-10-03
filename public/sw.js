// Service worker: red primero y caché como respaldo, para que la app abra sin conexión.
// La página se revalida siempre (cache: "no-cache") para que una versión nueva se vea al abrir la app;
// los archivos de assets/ llevan un hash en el nombre, así que pueden usar la caché HTTP normal.
const CACHE = "decants-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const deRed = request.mode === "navigate" ? fetch(request, { cache: "no-cache" }) : fetch(request);
  e.respondWith(
    deRed
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
