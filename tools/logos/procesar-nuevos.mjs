// Procesa las imágenes que el usuario sube a la carpeta logos-nuevos/ (desde la web de GitHub):
// el nombre del archivo es la marca ("Lattafa Perfumes.png"). Copia cada imagen como original,
// la registra en fuentes.json y la borra de logos-nuevos/. Después hay que correr
// `node tools/logos/generar-logos.mjs --local` para convertirlas a PNG 1-bit.
//
// Escribe en $GITHUB_OUTPUT `marcas=Marca A, Marca B` (vacío si no había imágenes).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(DIR, "..", "..");
const NUEVOS = path.join(RAIZ, "logos-nuevos");
const ORIGINALES = path.join(DIR, "originales");
const FUENTES = path.join(DIR, "fuentes.json");
const EXTENSIONES = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

// Debe coincidir con slugMarca() de src/marcas.ts.
const slug = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\uFFFD/g, "o").toLowerCase()
    .replace(/&/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

await fs.mkdir(ORIGINALES, { recursive: true });
const fuentes = JSON.parse(await fs.readFile(FUENTES, "utf8"));
const archivos = await fs.readdir(NUEVOS).catch(() => []);
const marcas = [];

for (const archivo of archivos) {
  const ext = path.extname(archivo).toLowerCase();
  if (!EXTENSIONES.has(ext)) continue;
  const marca = path.basename(archivo, path.extname(archivo)).trim();
  const s = slug(marca);
  if (!s) continue;

  // Reemplaza cualquier original anterior de esa marca.
  for (const previo of await fs.readdir(ORIGINALES)) {
    if (previo.startsWith(`${s}.`)) await fs.rm(path.join(ORIGINALES, previo));
  }
  await fs.copyFile(path.join(NUEVOS, archivo), path.join(ORIGINALES, `${s}${ext === ".jpeg" ? ".jpg" : ext}`));

  // Si la marca (o un alias) ya existe se reutiliza su entrada; si no, se agrega.
  const existente = fuentes.find((f) => [f.marca, ...f.alias].some((n) => slug(n) === s));
  if (existente) existente.url = null;
  else fuentes.push({ marca, alias: [], url: null });

  await fs.rm(path.join(NUEVOS, archivo));
  marcas.push(existente?.marca ?? marca);
}

fuentes.sort((a, b) => a.marca.localeCompare(b.marca, "es"));
await fs.writeFile(FUENTES, "[\n" + fuentes.map((f) => "  " + JSON.stringify(f)).join(",\n") + "\n]\n");

console.log(marcas.length ? `Logos nuevos: ${marcas.join(", ")}` : "No hay logos nuevos en logos-nuevos/");
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `marcas=${marcas.join(", ")}\n`);
