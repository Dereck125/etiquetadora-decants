import { binarizar, cargarImagen, urlLogoMarca, urlLogoTienda } from "./marcas";
import type { Ajustes, DatosEtiqueta, Resolucion } from "./tipos";

/** Etiqueta física: 12 × 40 mm. */
export const MM_ANCHO = 12;
export const MM_LARGO = 40;

/**
 * El diseño se describe en una cuadrícula base de 96 × 320 (8 px/mm, la D11 de 203 DPI)
 * y se escala a la resolución real de la impresora.
 */
const BASE_ANCHO = 96;
const BASE_LARGO = 320;
/** Las etiquetas cortas (p. ej. 3 ml) usan solo la mitad superior: 12 × 20 mm. */
const BASE_LARGO_CORTA = 160;

export const FUENTE = '"Roboto Condensed", "Arial Narrow", Arial, sans-serif';
const INTERLINEA = 1.08;
/** Cuánto se puede estrechar el texto a lo ancho antes de bajar el tamaño (0.85 = hasta 15%). */
const CONDENSADO_MAX = 0.85;
/** Alto mínimo (en px base) de un logo de marca para que se lea: 12 px = 1.5 mm. */
const ALTO_MIN_LOGO = 12;

type Caja = { x: number; y: number; w: number; h: number };
type OpcionesTexto = {
  max: number;
  min: number;
  maxLineas: number;
  peso?: 400 | 700;
  espaciado?: number;
  color?: string;
};

/** Tamaño en píxeles de la etiqueta para una resolución dada (ancho = a lo largo del cabezal). */
export function dimensiones(r: Resolucion): { ancho: number; largo: number } {
  return {
    ancho: Math.min(r.cabezal, Math.round((MM_ANCHO * r.dpi) / 25.4)),
    largo: Math.round((MM_LARGO * r.dpi) / 25.4),
  };
}

export function esCorta(volumen: string, ajustes: Ajustes): boolean {
  return ajustes.volumenesCortos.map(String).includes(volumen.trim());
}

export async function prepararFuente(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`700 20px "Roboto Condensed"`),
      document.fonts.load(`400 20px "Roboto Condensed"`),
    ]);
  } catch {
    /* Si falla, se usa la fuente de respaldo. */
  }
}

function fuente(ctx: CanvasRenderingContext2D, o: OpcionesTexto, tam: number): void {
  ctx.font = `${o.peso ?? 700} ${tam}px ${FUENTE}`;
  ctx.letterSpacing = `${o.espaciado ?? 0}px`;
}

function partirLineas(ctx: CanvasRenderingContext2D, palabras: string[], ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (!actual || ctx.measureText(prueba).width <= ancho) actual = prueba;
    else {
      lineas.push(actual);
      actual = p;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** Busca el tamaño de letra más grande con el que el texto cabe en la caja. */
function ajustarTexto(ctx: CanvasRenderingContext2D, texto: string, caja: Caja, o: OpcionesTexto) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const anchoUtil = caja.w / CONDENSADO_MAX;
  for (let t = o.max; t >= o.min; t--) {
    fuente(ctx, o, t);
    const lineas = partirLineas(ctx, palabras, anchoUtil);
    if (
      lineas.length <= o.maxLineas &&
      lineas.length * t * INTERLINEA <= caja.h &&
      lineas.every((l) => ctx.measureText(l).width <= anchoUtil)
    )
      return { tam: t, lineas };
  }
  // No cabe ni al mínimo: junta el sobrante en la última línea; fillText la comprime a lo ancho.
  fuente(ctx, o, o.min);
  let lineas = partirLineas(ctx, palabras, anchoUtil);
  const maxL = Math.max(1, Math.min(o.maxLineas, Math.floor(caja.h / (o.min * INTERLINEA))));
  if (lineas.length > maxL) lineas = [...lineas.slice(0, maxL - 1), lineas.slice(maxL - 1).join(" ")];
  return { tam: o.min, lineas };
}

function dibujarTexto(ctx: CanvasRenderingContext2D, texto: string, caja: Caja, o: OpcionesTexto): void {
  if (!texto.trim()) return;
  const { tam, lineas } = ajustarTexto(ctx, texto, caja, o);
  fuente(ctx, o, tam);
  ctx.fillStyle = o.color ?? "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const alto = tam * INTERLINEA;
  const y0 = caja.y + (caja.h - lineas.length * alto) / 2;
  lineas.forEach((l, i) => {
    // El espaciado entre letras deja un hueco al final de la línea: se compensa.
    const x = caja.x + caja.w / 2 + (o.espaciado ?? 0) / 2;
    ctx.fillText(l, x, y0 + i * alto + alto / 2 + 1, caja.w);
  });
}

function dibujarImagen(ctx: CanvasRenderingContext2D, img: HTMLImageElement, caja: Caja): void {
  const k = Math.min(caja.w / img.naturalWidth, caja.h / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, caja.x + (caja.w - w) / 2, caja.y + (caja.h - h) / 2, w, h);
}

/** Marco doble: línea exterior de 2 px y filete interior de 1 px. */
function marco(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 7);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(6.5, 6.5, w - 13, h - 13, 4);
  ctx.stroke();
}

/** Separador ornamental horizontal: ——◆——. */
function separador(ctx: CanvasRenderingContext2D, cy: number, largo: number) {
  const cx = BASE_ANCHO / 2;
  const brazo = largo / 2 - 5;
  ctx.fillStyle = "#000";
  ctx.fillRect(cx - largo / 2, cy, brazo, 1);
  ctx.fillRect(cx + 5, cy, brazo, 1);
  ctx.beginPath();
  ctx.moveTo(cx, cy - 2.5);
  ctx.lineTo(cx + 3, cy + 0.5);
  ctx.lineTo(cx, cy + 3.5);
  ctx.lineTo(cx - 3, cy + 0.5);
  ctx.closePath();
  ctx.fill();
}

/** Volumen en una píldora negra con letras blancas. */
function pildoraVolumen(ctx: CanvasRenderingContext2D, texto: string, caja: Caja, tamMax: number): void {
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(caja.x, caja.y, caja.w, caja.h, caja.h / 2);
  ctx.fill();
  dibujarTexto(ctx, texto, { x: caja.x + 5, y: caja.y, w: caja.w - 10, h: caja.h }, {
    max: tamMax,
    min: 9,
    maxLineas: 1,
    espaciado: 1,
    color: "#fff",
  });
}

/** Logo de marca si se lee bien a ese tamaño; si es demasiado alargado, el nombre en texto. */
function dibujarMarca(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, marca: string, caja: Caja) {
  const alto = logo ? Math.min(caja.w / logo.naturalWidth, caja.h / logo.naturalHeight) * logo.naturalHeight : 0;
  if (logo && alto >= ALTO_MIN_LOGO) dibujarImagen(ctx, logo, caja);
  else
    dibujarTexto(ctx, marca.toUpperCase(), caja, {
      max: Math.min(16, Math.floor(caja.h / 1.2)),
      min: 8,
      maxLineas: 2,
      peso: 700,
      espaciado: 1,
    });
}

export function formatoVolumen(v: number | string): string {
  const s = String(v).trim();
  return /^\d+([.,]\d+)?$/.test(s) ? `${s} ML` : s.toUpperCase();
}

/**
 * Dibuja la etiqueta vertical (ancho × largo de la resolución configurada), ya en blanco y negro puro.
 * Las etiquetas cortas ocupan solo la mitad superior y no llevan el volumen.
 */
export async function renderizarEtiqueta(datos: DatosEtiqueta, ajustes: Ajustes): Promise<HTMLCanvasElement> {
  await prepararFuente();
  const [logoTienda, logoMarca] = await Promise.all([
    cargarImagen(urlLogoTienda()),
    cargarImagen(urlLogoMarca(datos.marca)),
  ]);
  const { ancho, largo } = dimensiones(ajustes.resolucion);
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = largo;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ancho, largo);
  ctx.scale(ancho / BASE_ANCHO, largo / BASE_LARGO);

  const nombre = ajustes.mayusculas ? datos.nombre.toUpperCase() : datos.nombre;

  if (esCorta(datos.volumen, ajustes)) {
    // 12 × 20 mm: logo, nombre y marca.
    if (logoTienda) dibujarImagen(ctx, logoTienda, { x: 9, y: 10, w: 78, h: 34 });
    separador(ctx, 49, 56);
    dibujarTexto(ctx, nombre, { x: 9, y: 54, w: 78, h: 58 }, { max: 26, min: 10, maxLineas: 4 });
    separador(ctx, 117, 56);
    dibujarMarca(ctx, logoMarca, datos.marca, { x: 9, y: 122, w: 78, h: 30 });
    if (ajustes.marco) marco(ctx, BASE_ANCHO, BASE_LARGO_CORTA);
  } else {
    // 12 × 40 mm completa.
    if (logoTienda) dibujarImagen(ctx, logoTienda, { x: 9, y: 10, w: 78, h: 66 });
    separador(ctx, 82, 64);
    dibujarTexto(ctx, nombre, { x: 9, y: 88, w: 78, h: 124 }, { max: 34, min: 12, maxLineas: 6 });
    separador(ctx, 218, 64);
    dibujarMarca(ctx, logoMarca, datos.marca, { x: 9, y: 224, w: 78, h: 52 });
    const volumen = formatoVolumen(datos.volumen);
    if (volumen) pildoraVolumen(ctx, volumen, { x: 12, y: 282, w: 72, h: 28 }, 22);
    if (ajustes.marco) marco(ctx, BASE_ANCHO, BASE_LARGO);
  }

  binarizar(c);
  return c;
}

/**
 * Lienzo que espera la impresora: largo × cabezal. La parte de arriba de la etiqueta queda
 * a la izquierda y, si el cabezal es más ancho que la etiqueta, se centra.
 */
export function lienzoImpresion(etiqueta: HTMLCanvasElement, ajustes: Ajustes): HTMLCanvasElement {
  const { cabezal } = ajustes.resolucion;
  const c = document.createElement("canvas");
  c.width = etiqueta.height;
  c.height = cabezal;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  if (ajustes.invertir) {
    ctx.translate(c.width, c.height);
    ctx.rotate(Math.PI);
  }
  ctx.translate(0, cabezal);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(etiqueta, Math.round((cabezal - etiqueta.width) / 2), 0);
  return c;
}
