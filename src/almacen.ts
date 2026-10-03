import catalogoInicial from "./datos/catalogo-inicial.json";
import type { Ajustes, Perfume, Resolucion } from "./tipos";

const CLAVES = {
  perfumes: "etq.perfumes",
  ajustes: "etq.ajustes",
};

/** Resoluciones que se pueden elegir a mano (al conectar se usa la que informa la impresora). */
export const RESOLUCIONES: Resolucion[] = [
  { modelo: "D11", dpi: 203, cabezal: 96 },
  { modelo: "D11-H / D11 Pro", dpi: 300, cabezal: 142 },
];

export const AJUSTES_DEFECTO: Ajustes = {
  marco: true,
  mayusculas: true,
  invertir: false,
  densidad: 2,
  volumenes: [3, 5, 10, 30],
  volumenesCortos: [3],
  largoMm: 38,
  resolucion: RESOLUCIONES[0],
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
delete ajustesGuardados.diseno;

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
