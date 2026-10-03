// Descarga los logos listados en fuentes.json y los convierte a PNG 1-bit (negro sobre blanco)
// en public/logos/marcas/, junto con un index.json que la app usa para encontrarlos.
//
// Uso:  node tools/logos/generar-logos.mjs            (reutiliza descargas previas)
//       node tools/logos/generar-logos.mjs --forzar   (vuelve a descargar todo)
//       node tools/logos/generar-logos.mjs --local    (no descarga: solo procesa lo que ya está en originales/)
//
// Para agregar un logo a mano: guarda el archivo como tools/logos/originales/<slug>.(png|jpg|svg|webp)
// (p. ej. "yves-saint-laurent.svg"), verifica que la marca exista en fuentes.json y corre con --local.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ORIGINALES = path.join(DIR, "originales");
const SALIDA = path.join(DIR, "..", "..", "public", "logos", "marcas");
const FORZAR = process.argv.includes("--forzar");
const LOCAL = process.argv.includes("--local");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 etiquetadora-decants/0.1";
const ANCHO_MAX = 600;

// Debe coincidir con slugMarca() de src/marcas.ts.
const slug = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\uFFFD/g, "o").toLowerCase()
    .replace(/&/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function descargar(url, destinoBase) {
  const existentes = (await fs.readdir(ORIGINALES)).filter((f) => f.startsWith(destinoBase + "."));
  if (existentes.length && !FORZAR) return path.join(ORIGINALES, existentes[0]);
  if (LOCAL || !url) throw new Error("pendiente: no hay archivo en originales/");
  for (let intento = 1; intento <= 4; intento++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status === 429) { await esperar(15000 * intento); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const tipo = r.headers.get("content-type") ?? "";
    const ext = tipo.includes("svg") ? "svg" : tipo.includes("png") ? "png" : tipo.includes("webp") ? "webp" : "jpg";
    const destino = path.join(ORIGINALES, `${destinoBase}.${ext}`);
    await fs.writeFile(destino, Buffer.from(await r.arrayBuffer()));
    if (url.includes("wikimedia.org")) await esperar(6000); // respeta el límite de Wikimedia
    return destino;
  }
  throw new Error("demasiadas peticiones (429)");
}

/** Umbral de Otsu sobre un histograma de 256 niveles. */
function otsu(hist, total) {
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
    const varianza = pesoB * pesoF * (mB - mF) ** 2;
    if (varianza > mejor) { mejor = varianza; umbral = t; }
  }
  return umbral;
}

/**
 * Decide qué píxeles son "tinta":
 * - Con transparencia: los píxeles opacos. Si el logo opaco tiene dos tonos claros/oscuros
 *   marcados (p. ej. letras blancas dentro de un sello negro) se queda con el tono oscuro.
 * - Sin transparencia: lo que se aleja del color del fondo (tomado de las esquinas).
 */
async function aMonocromo(archivo) {
  const esSvg = archivo.endsWith(".svg");
  const { data, info } = await sharp(archivo, esSvg ? { density: 600 } : {})
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: !esSvg })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const lum = new Uint8Array(n), alfa = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    alfa[i] = data[o + 3];
  }
  let transparentes = 0;
  for (let i = 0; i < n; i++) if (alfa[i] < 128) transparentes++;

  const tinta = new Uint8Array(n);
  if (transparentes / n > 0.05) {
    const hist = new Array(256).fill(0);
    let opacos = 0;
    for (let i = 0; i < n; i++) if (alfa[i] >= 128) { hist[lum[i]]++; opacos++; }
    const t = otsu(hist, opacos);
    let oscuros = 0, claros = 0;
    for (let v = 0; v < 256; v++) (v <= t ? (oscuros += hist[v]) : (claros += hist[v]));
    // Dos tonos con buen contraste y ambos con presencia → la tinta es el tono oscuro.
    let mediaO = 0, mediaC = 0;
    for (let v = 0; v < 256; v++) (v <= t ? (mediaO += v * hist[v]) : (mediaC += v * hist[v]));
    mediaO /= oscuros || 1; mediaC /= claros || 1;
    const dosTonos = mediaC - mediaO > 90 && oscuros / opacos > 0.15 && claros / opacos > 0.15;
    for (let i = 0; i < n; i++) tinta[i] = alfa[i] >= 128 && (!dosTonos || lum[i] <= t) ? 1 : 0;
  } else {
    const esquinas = [0, w - 1, (h - 1) * w, n - 1].map((i) => lum[i]);
    const fondo = esquinas.sort((a, b) => a - b)[1]; // mediana baja, tolera una esquina con tinta
    for (let i = 0; i < n; i++) tinta[i] = Math.abs(lum[i] - fondo) > 70 ? 1 : 0;
  }

  const salida = Buffer.alloc(n);
  for (let i = 0; i < n; i++) salida[i] = tinta[i] ? 0 : 255;
  return sharp(salida, { raw: { width: w, height: h, channels: 1 } })
    .trim({ background: "#ffffff", threshold: 10 })
    .resize({ width: ANCHO_MAX, height: 300, fit: "inside", withoutEnlargement: true })
    .threshold(128)
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: "#ffffff" })
    .png({ palette: true, colours: 2 });
}

const fuentes = JSON.parse(await fs.readFile(path.join(DIR, "fuentes.json"), "utf8"));
await fs.mkdir(ORIGINALES, { recursive: true });
await fs.mkdir(SALIDA, { recursive: true });

const indice = [];
for (const f of fuentes) {
  const s = slug(f.marca);
  try {
    const original = await descargar(f.url, s);
    const archivo = `${s}.png`;
    await (await aMonocromo(original)).toFile(path.join(SALIDA, archivo));
    indice.push({ marca: f.marca, claves: [...new Set([f.marca, ...f.alias].map(slug))], archivo });
    console.log("ok  ", f.marca);
  } catch (e) {
    // Si ya existía un PNG de una corrida anterior, se conserva en el índice.
    const previo = path.join(SALIDA, `${s}.png`);
    const existe = await fs.access(previo).then(() => true, () => false);
    if (existe) indice.push({ marca: f.marca, claves: [...new Set([f.marca, ...f.alias].map(slug))], archivo: `${s}.png` });
    console.log(existe ? "previo" : "FALLO", f.marca, "-", e.message);
  }
}
await fs.writeFile(path.join(SALIDA, "index.json"), JSON.stringify(indice, null, 2) + "\n");
console.log(`\n${indice.length}/${fuentes.length} logos en ${path.relative(process.cwd(), SALIDA)}`);
