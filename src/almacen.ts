import catalogoInicial from "./datos/catalogo-inicial.json";
import type { Ajustes, Perfume } from "./tipos";

const CLAVES = {
  perfumes: "etq.perfumes",
  ajustes: "etq.ajustes",
};

export const AJUSTES_DEFECTO: Ajustes = {
  diseno: "vertical",
  marco: true,
  mayusculas: true,
  invertir: false,
  densidad: 2,
  volumenes: [3, 5, 10, 30],
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

/** Quita campos que ya no se usan (p. ej. el stock de versiones anteriores). */
function limpiarPerfume({ id, nombre, marca, genero, nota, activo }: Perfume): Perfume {
  return { id, nombre, marca, genero, nota: nota ?? "", activo: activo ?? true };
}

export function catalogoPorDefecto(): Perfume[] {
  return (catalogoInicial as Perfume[]).map(limpiarPerfume);
}

// Versiones anteriores guardaban inventario e historial de impresiones.
try {
  localStorage.removeItem("etq.historial");
} catch {
  /* sin almacenamiento */
}

const ajustesGuardados = leer<Partial<Ajustes> & Record<string, unknown>>(CLAVES.ajustes) ?? {};
delete ajustesGuardados.stockBajo;

export const estado = {
  perfumes: (leer<Perfume[]>(CLAVES.perfumes) ?? catalogoPorDefecto()).map(limpiarPerfume),
  ajustes: { ...AJUSTES_DEFECTO, ...ajustesGuardados } as Ajustes,
};

export function guardarPerfumes(): void {
  escribir(CLAVES.perfumes, estado.perfumes);
}

export function guardarAjustes(): void {
  escribir(CLAVES.ajustes, estado.ajustes);
}

export function reemplazarPerfumes(perfumes: Perfume[]): void {
  estado.perfumes = perfumes.map(limpiarPerfume);
  guardarPerfumes();
}

export function nuevoId(prefijo = "p"): string {
  return `${prefijo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function marcasDelCatalogo(): string[] {
  return [...new Set(estado.perfumes.map((p) => p.marca).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}
