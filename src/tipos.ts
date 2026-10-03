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

/** Resolución de la impresora: se detecta al conectar (D11: 203 DPI / 96 px; D11-H: 300 DPI / 142 px). */
export interface Resolucion {
  modelo: string;
  dpi: number;
  /** Ancho del cabezal en puntos. */
  cabezal: number;
}

export interface Ajustes {
  marco: boolean;
  mayusculas: boolean;
  /** Gira la etiqueta 180° si sale al revés. */
  invertir: boolean;
  /** Densidad de impresión (el rango real depende del modelo). */
  densidad: number;
  volumenes: number[];
  /** Volúmenes cuyo frasco solo cubre media etiqueta: se imprime en la mitad superior. */
  volumenesCortos: number[];
  /** Largo impreso en mm (la etiqueta mide 40). Por debajo de 40 para no invadir la etiqueta siguiente. */
  largoMm: number;
  /** Espacio en blanco arriba del diseño, en mm, para centrarlo en la etiqueta. */
  margenSuperiorMm: number;
  resolucion: Resolucion;
  /** Pausa entre paquetes Bluetooth en ms (10 = seguro, 0 = lo más rápido). */
  pausaEnvioMs: number;
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
