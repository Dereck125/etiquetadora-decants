export type Genero = "Dama" | "Caballero" | "Unisex";
export const GENEROS: Genero[] = ["Dama", "Caballero", "Unisex"];

export interface Perfume {
  id: string;
  nombre: string;
  marca: string;
  genero: Genero;
  /** Nota interna (p. ej. color del frasco). No se imprime. */
  nota: string;
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
  /** Logo de la tienda subido por el usuario (data URL). null = logo incluido en la app. */
  logoTienda: string | null;
  /** Logos de marca subidos por el usuario, por slug de marca (data URL). */
  logosMarca: Record<string, string>;
}

export interface DatosEtiqueta {
  nombre: string;
  marca: string;
  volumen: string;
}
