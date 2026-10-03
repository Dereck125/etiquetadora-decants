// Service worker: red primero y caché como respaldo, para que la app abra sin conexión.
// La página se pide siempre fresca: GitHub Pages la guarda ~10 min en su CDN, así que se agrega un
// parámetro único para saltarla. Los archivos de assets/ llevan un hash en el nombre y usan la caché normal.
const CACHE = "decants-v3";

function paginaFresca(request) {
  const url = new URL(request.url);
  url.searchParams.set("_v", Date.now().toString(36));
  return fetch(url, { cache: "no-store", credentials: "same-origin" });
}

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
  const deRed = request.mode === "navigate" ? paginaFresca(request) : fetch(request);
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
