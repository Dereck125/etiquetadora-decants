// Service worker: red primero y caché como respaldo, para que la app abra sin conexión.
// La página se pide siempre fresca: GitHub Pages la guarda ~10 min en su CDN, así que se agrega un
// parámetro único para saltarla. Los archivos de assets/ llevan un hash en el nombre y usan la caché normal.
//
// El mismo archivo se publica en la raíz (master) y en /dev/ (develop). El de la raíz no toca /dev/.
const ALCANCE = new URL(self.registration.scope);
const ES_DEV = ALCANCE.pathname.endsWith("/dev/");
const RUTA_DEV = new URL("dev/", ALCANCE).pathname;
const CANAL = ES_DEV ? "dev" : "prod";
const CACHE = `decants-${CANAL}-v4`;

function paginaFresca(request) {
  const url = new URL(request.url);
  url.searchParams.set("_v", Date.now().toString(36));
  return fetch(url, { cache: "no-store", credentials: "same-origin" });
}

/** Cachés viejas de este canal (y las de versiones anteriores sin canal, solo desde la raíz). */
const esCacheVieja = (c) =>
  c !== CACHE && (c.startsWith(`decants-${CANAL}-`) || (!ES_DEV && /^decants-v\d+$/.test(c)));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter(esCacheVieja).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!ES_DEV && url.pathname.startsWith(RUTA_DEV)) return; // /dev/ tiene su propio service worker
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
