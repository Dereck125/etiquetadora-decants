// Convierte el logo de la tienda (tools/logos/originales/tienda-original.*) a PNG 1-bit,
// recortado al contenido, en public/logos/tienda.png.
// Solo toma la tinta oscura: ignora la textura gris del fondo y marcas de agua claras.
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ORIG = path.join(DIR, "originales");
const archivo = (await fs.readdir(ORIG)).find((f) => f.startsWith("tienda-original."));
if (!archivo) throw new Error("Falta tools/logos/originales/tienda-original.(png|jpg|...)");

const { data, info } = await sharp(path.join(ORIG, archivo))
  .flatten({ background: "#ffffff" }).grayscale().raw()
  .toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const UMBRAL = 110;

// Caja del contenido: filas/columnas con al menos 3 píxeles de tinta (descarta motas sueltas).
const filas = new Array(h).fill(0), cols = new Array(w).fill(0);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++)
    if (data[y * w + x] < UMBRAL) { filas[y]++; cols[x]++; }
const primero = (a) => a.findIndex((v) => v >= 3);
const ultimo = (a) => a.length - 1 - [...a].reverse().findIndex((v) => v >= 3);
const top = primero(filas), bottom = ultimo(filas), left = primero(cols), right = ultimo(cols);

const bits = Buffer.alloc(w * h);
for (let i = 0; i < w * h; i++) bits[i] = data[i] < UMBRAL ? 0 : 255;
await sharp(bits, { raw: { width: w, height: h, channels: 1 } })
  .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
  .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
  .threshold(128)
  .png({ palette: true, colours: 2 })
  .toFile(path.join(DIR, "..", "..", "public", "logos", "tienda.png"));
console.log("ok public/logos/tienda.png", { left, top, right, bottom });

// Íconos de la app (PWA): logo en blanco sobre fondo oscuro, con margen para íconos "maskable".
const PUBLIC = path.join(DIR, "..", "..", "public");
const logo = path.join(PUBLIC, "logos", "tienda.png");
for (const lado of [192, 512]) {
  const interior = Math.round(lado * 0.6);
  const blanco = await sharp(logo)
    .resize(interior, interior, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" }).negate({ alpha: false }).png().toBuffer();
  await sharp({ create: { width: lado, height: lado, channels: 3, background: "#16130f" } })
    .composite([{ input: blanco, blend: "lighten" }])
    .png().toFile(path.join(PUBLIC, `icono-${lado}.png`));
}
console.log("ok public/icono-192.png, public/icono-512.png");
