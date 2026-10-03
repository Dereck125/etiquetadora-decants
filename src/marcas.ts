import { estado } from "./almacen";

/** Normaliza un nombre de marca para compararlo: sin acentos, minúsculas, solo [a-z0-9]. */
export function slugMarca(marca: string): string {
  return marca
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Corrige texto mal codificado (p. ej. "Lanc\uFFFDme").
    .replace(/\uFFFD/g, "o")
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface EntradaIndice {
  marca: string;
  claves: string[];
  archivo: string;
}

const RUTA_MARCAS = "logos/marcas/";
export const LOGO_TIENDA_INCLUIDO = "logos/tienda.png";

let incluidos = new Map<string, string>();

/** Carga el índice de logos incluidos en la app (public/logos/marcas/index.json). */
export async function cargarLogosIncluidos(): Promise<void> {
  try {
    const r = await fetch(RUTA_MARCAS + "index.json");
    const indice = (await r.json()) as EntradaIndice[];
    incluidos = new Map(indice.flatMap((e) => e.claves.map((c) => [c, RUTA_MARCAS + e.archivo] as const)));
  } catch {
    incluidos = new Map();
  }
}

/** URL del logo de una marca: primero el subido por el usuario, luego el incluido. */
export function urlLogoMarca(marca: string): string | null {
  const s = slugMarca(marca);
  if (!s) return null;
  return estado.ajustes.logosMarca[s] ?? incluidos.get(s) ?? null;
}

export function tieneLogoIncluido(marca: string): boolean {
  return incluidos.has(slugMarca(marca));
}

export function urlLogoTienda(): string {
  return estado.ajustes.logoTienda ?? LOGO_TIENDA_INCLUIDO;
}

const cacheImagenes = new Map<string, Promise<HTMLImageElement | null>>();

export function cargarImagen(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = cacheImagenes.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cacheImagenes.set(url, p);
  }
  return p;
}

/**
 * Convierte una imagen subida (cualquier formato que el navegador lea: PNG, JPG, WEBP, SVG...)
 * a PNG 1-bit recortado al contenido. Si el logo es claro sobre transparente, usa la silueta.
 */
export async function procesarLogoSubido(archivo: File, ladoMax = 600): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la imagen"));
      i.src = url;
    });
    const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const h = Math.max(1, Math.round(img.naturalHeight * escala));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const datos = ctx.getImageData(0, 0, w, h).data;

    const porLuz = new Uint8Array(w * h);
    const porAlfa = new Uint8Array(w * h);
    let nLuz = 0;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const a = datos[o + 3] / 255;
      // Mezcla con fondo blanco.
      const lum = (0.299 * datos[o] + 0.587 * datos[o + 1] + 0.114 * datos[o + 2]) * a + 255 * (1 - a);
      porLuz[i] = lum < 128 ? 1 : 0;
      porAlfa[i] = datos[o + 3] >= 128 ? 1 : 0;
      nLuz += porLuz[i];
    }
    const tinta = nLuz > w * h * 0.002 ? porLuz : porAlfa;

    // Caja del contenido: filas/columnas con al menos 2 píxeles de tinta (descarta motas).
    const filas = new Uint32Array(h), cols = new Uint32Array(w);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (tinta[y * w + x]) { filas[y]++; cols[x]++; }
    const y0 = filas.findIndex((v) => v >= 2), x0 = cols.findIndex((v) => v >= 2);
    if (y0 < 0 || x0 < 0) throw new Error("La imagen no tiene contenido visible");
    const y1 = h - 1 - [...filas].reverse().findIndex((v) => v >= 2);
    const x1 = w - 1 - [...cols].reverse().findIndex((v) => v >= 2);

    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const recorte = document.createElement("canvas");
    recorte.width = cw;
    recorte.height = ch;
    const rctx = recorte.getContext("2d")!;
    const px = rctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const v = tinta[(y + y0) * w + (x + x0)] ? 0 : 255;
        const o = (y * cw + x) * 4;
        px.data[o] = px.data[o + 1] = px.data[o + 2] = v;
        px.data[o + 3] = 255;
      }
    rctx.putImageData(px, 0, 0);

    const k = Math.min(1, ladoMax / Math.max(cw, ch));
    const salida = document.createElement("canvas");
    salida.width = Math.max(1, Math.round(cw * k));
    salida.height = Math.max(1, Math.round(ch * k));
    const sctx = salida.getContext("2d")!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(recorte, 0, 0, salida.width, salida.height);
    binarizar(salida);
    return salida.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Deja el canvas en blanco y negro puro (sin transparencia). */
export function binarizar(c: HTMLCanvasElement, umbral = 140): void {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let o = 0; o < d.length; o += 4) {
    const a = d[o + 3] / 255;
    const lum = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) * a + 255 * (1 - a);
    const v = lum < umbral ? 0 : 255;
    d[o] = d[o + 1] = d[o + 2] = v;
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
