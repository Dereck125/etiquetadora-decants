import { nuevoId } from "./almacen";
import { GENEROS, type Genero, type Perfume } from "./tipos";

/** Lee CSV con comillas; detecta "," o ";" (Excel en español usa ";"). */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.replace(/^\uFEFF/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((c) => c.trim())) filas.push(fila);
      fila = [];
    } else campo += ch;
  }
  fila.push(campo);
  if (fila.some((c) => c.trim())) filas.push(fila);
  return filas;
}

function normalizarGenero(v: string): Genero {
  const s = v.trim().toLowerCase();
  if (["dama", "mujer", "f", "femenino", "woman"].includes(s)) return "Dama";
  if (["caballero", "hombre", "m", "masculino", "man", "men"].includes(s)) return "Caballero";
  const exacto = GENEROS.find((g) => g.toLowerCase() === s);
  return exacto ?? "Unisex";
}

/**
 * Columnas reconocidas (encabezado obligatorio, en cualquier orden):
 * nombre, marca, genero, nota, y stock por volumen como "stock_5" o "5ml".
 */
export function perfumesDesdeCsv(texto: string): Perfume[] {
  const [encabezado, ...filas] = parsearCsv(texto);
  if (!encabezado) return [];
  const cols = encabezado.map((c) => c.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const idx = (nombre: string) => cols.indexOf(nombre);
  const iNombre = idx("nombre"), iMarca = idx("marca"), iGenero = idx("genero"), iNota = idx("nota");
  if (iNombre < 0) throw new Error('El CSV necesita una columna "nombre"');
  const volumenes = cols
    .map((c, i) => ({ i, m: c.match(/^(?:stock[_ ]?)?(\d+(?:[.,]\d+)?)\s*(?:ml)?$/) }))
    .filter((x) => x.m)
    .map((x) => ({ i: x.i, vol: x.m![1].replace(",", ".") }));

  return filas
    .filter((f) => f[iNombre]?.trim())
    .map((f) => {
      const inventario: Record<string, number> = {};
      for (const v of volumenes) {
        const n = parseInt(f[v.i] ?? "", 10);
        if (!isNaN(n)) inventario[v.vol] = n;
      }
      return {
        id: nuevoId(),
        nombre: f[iNombre].trim(),
        marca: iMarca >= 0 ? (f[iMarca] ?? "").trim() : "",
        genero: iGenero >= 0 ? normalizarGenero(f[iGenero] ?? "") : "Unisex",
        nota: iNota >= 0 ? (f[iNota] ?? "").trim() : "",
        inventario,
        activo: true,
      };
    });
}

function celda(v: string | number): string {
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function perfumesACsv(perfumes: Perfume[], volumenes: number[]): string {
  const encabezado = ["nombre", "marca", "genero", "nota", ...volumenes.map((v) => `stock_${v}`)];
  const filas = perfumes.map((p) => [
    p.nombre, p.marca, p.genero, p.nota,
    ...volumenes.map((v) => p.inventario[String(v)] ?? 0),
  ]);
  return "\uFEFF" + [encabezado, ...filas].map((f) => f.map(celda).join(",")).join("\r\n") + "\r\n";
}

export function descargarTexto(nombreArchivo: string, contenido: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
