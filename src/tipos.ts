export type Genero = "Dama" | "Caballero" | "Unisex";
export const GENEROS: Genero[] = ["Dama", "Caballero", "Unisex"];

export interface Perfume {
  id: string;
  nombre: string;
  marca: string;
  genero: Genero;
  /** Nota interna (p. ej. color del frasco). No se imprime. */
  nota: string;
  /** Stock por volumen en ml: { "5": 10 }. */
  inventario: Record<string, number>;
  activo: boolean;
}

export type Diseno = "vertical" | "horizontal";

export interface Ajustes {
  diseno: Diseno;
  marco: boolean;
  mayusculas: boolean;
  /** Gira la etiqueta 180° si sale al revés. */
  invertir: boolean;
  /** Densidad de impresión de la D11 (1–3). */
  densidad: number;
  volumenes: number[];
  stockBajo: number;
  /** Logo de la tienda subido por el usuario (data URL). null = logo incluido en la app. */
  logoTienda: string | null;
  /** Logos de marca subidos por el usuario, por slug de marca (data URL). */
  logosMarca: Record<string, string>;
}

export interface Impresion {
  id: string;
  fecha: string;
  perfumeId: string | null;
  nombre: string;
  marca: string;
  volumen: string;
  cantidad: number;
  /** Unidades descontadas del inventario (para poder deshacer). */
  descontado: number;
}

export interface DatosEtiqueta {
  nombre: string;
  marca: string;
  volumen: string;
}
