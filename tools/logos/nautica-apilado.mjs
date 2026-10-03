// Arma la versión apilada del logo de Nautica (vela arriba, palabra abajo) a partir del SVG
// horizontal de Wikimedia (tools/logos/originales/nautica.svg). La horizontal es muy alargada y en
// la etiqueta quedaba diminuta. Sobrescribe tools/logos/originales/nautica.png (luego: --local).
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const svg = path.join(DIR, "originales", "nautica.svg");
const { data, info } = await sharp(svg, { density: 1200 })
  .flatten({ background: "#fff" }).grayscale().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const tinta = (x, y) => data[y * w + x] < 128;

// Columnas con tinta → bloques separados por columnas vacías: el primero es la vela.
const cols = Array.from({ length: w }, (_, x) => { for (let y = 0; y < h; y++) if (tinta(x, y)) return true; return false; });
const x0 = cols.indexOf(true);
let finVela = x0;
while (finVela < w && cols[finVela]) finVela++;
let iniTexto = finVela;
while (iniTexto < w && !cols[iniTexto]) iniTexto++;
const x1 = w - 1 - [...cols].reverse().indexOf(true);

const caja = async (left, right) => {
  const recorte = await sharp(svg, { density: 1200 }).flatten({ background: "#fff" })
    .extract({ left, top: 0, width: right - left + 1, height: h }).toBuffer();
  return sharp(recorte).trim({ background: "#ffffff", threshold: 40 }).toBuffer({ resolveWithObject: true });
};
const vela = await caja(x0, finVela - 1);
const texto = await caja(iniTexto, x1);

const anchoTexto = texto.info.width;
const altoVela = Math.round(texto.info.height * 4.2);
const velaGrande = await sharp(vela.data).resize({ height: altoVela }).toBuffer({ resolveWithObject: true });
const sep = Math.round(texto.info.height * 0.6);
const ancho = Math.max(anchoTexto, velaGrande.info.width);
await sharp({ create: { width: ancho, height: altoVela + sep + texto.info.height, channels: 3, background: "#fff" } })
  .composite([
    { input: velaGrande.data, left: Math.round((ancho - velaGrande.info.width) / 2), top: 0 },
    { input: texto.data, left: Math.round((ancho - anchoTexto) / 2), top: altoVela + sep },
  ])
  .png().toFile(path.join(DIR, "originales", "nautica.png"));
console.log("ok nautica.png", { vela: [vela.info.width, vela.info.height], texto: [texto.info.width, texto.info.height] });
