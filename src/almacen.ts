import catalogoInicial from "./datos/catalogo-inicial.json";
import type { Ajustes, Impresion, Perfume } from "./tipos";

const CLAVES = {
  perfumes: "etq.perfumes",
  ajustes: "etq.ajustes",
  historial: "etq.historial",
};
const HISTORIAL_MAX = 300;

export const AJUSTES_DEFECTO: Ajustes = {
  diseno: "vertical",
  marco: true,
  mayusculas: true,
  invertir: false,
  densidad: 2,
  volumenes: [3, 5, 10, 30],
  stockBajo: 2,
  logoTienda: null,
  logosMarca: {},
};

function leer<T>(clave: string): T | null {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? (JSON.parse(crudo) as T) : null;
  } catch {
    return null;
  }
}

function escribir(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) {
    alert("No se pudo guardar en el navegador (¿almacenamiento lleno?).\n" + e);
  }
}

export function catalogoPorDefecto(): Perfume[] {
  return structuredClone(catalogoInicial as Perfume[]);
}

export const estado = {
  perfumes: leer<Perfume[]>(CLAVES.perfumes) ?? catalogoPorDefecto(),
  ajustes: { ...AJUSTES_DEFECTO, ...(leer<Partial<Ajustes>>(CLAVES.ajustes) ?? {}) } as Ajustes,
  historial: leer<Impresion[]>(CLAVES.historial) ?? [],
};

export function guardarPerfumes(): void {
  escribir(CLAVES.perfumes, estado.perfumes);
}

export function guardarAjustes(): void {
  escribir(CLAVES.ajustes, estado.ajustes);
}

export function guardarHistorial(): void {
  estado.historial = estado.historial.slice(0, HISTORIAL_MAX);
  escribir(CLAVES.historial, estado.historial);
}

export function nuevoId(prefijo = "p"): string {
  return `${prefijo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function stock(p: Perfume, volumen: number | string): number {
  return p.inventario[String(volumen)] ?? 0;
}

export function marcasDelCatalogo(): string[] {
  return [...new Set(estado.perfumes.map((p) => p.marca).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}
