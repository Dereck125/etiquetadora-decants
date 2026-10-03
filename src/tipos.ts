import type { OpcionesU1 } from "./u1";

export type Genero = "Dama" | "Caballero" | "Unisex";

/** Configuración de la segunda impresora (Yihetangde U1), en pruebas. */
export interface ConfigU1 extends OpcionesU1 {
  anchoMm: number;
  altoMm: number;
  /** Desplazamiento horizontal de la etiqueta respecto al centro del cabezal, en puntos. */
  desplazamiento: number;
  /**
   * Filas en blanco (mm) al inicio de la imagen: bajan el diseño dentro de la etiqueta. Hace falta porque
   * la U1 se alinea sola con el sensor y no hace caso al retroceso (con inicio 0 o −2 salía igual).
   */
  margenArribaMm: number;
  /** Versión de la calibración por defecto con la que se guardó (ver CALIBRACION_U1_VERSION). */
  version?: number;
}
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
  /** Tipo de etiqueta (LabelType de niimbluelib) o "auto" para usar el que informa el rollo. */
  tipoEtiqueta: number | "auto";
  /** Tarea de impresión de niimbluelib (p. ej. "B1") o "auto" para la que corresponde al modelo. */
  tareaImpresion: string;
  /** Pausa entre paquetes Bluetooth en ms (10 = seguro, 0 = lo más rápido). */
  pausaEnvioMs: number;
  /** Logo de la tienda subido por el usuario (data URL). null = logo incluido en la app. */
  logoTienda: string | null;
  /** Logos de marca subidos por el usuario, por slug de marca (data URL). */
  logosMarca: Record<string, string>;
  u1: ConfigU1;
}

export interface DatosEtiqueta {
  nombre: string;
  marca: string;
  volumen: string;
}
