import { binarizar, cargarImagen, urlLogoMarca, urlLogoTienda } from "./marcas";
import type { Ajustes, DatosEtiqueta, Resolucion } from "./tipos";

/** Etiqueta física: 12 × 40 mm. */
export const MM_ANCHO = 12;
export const MM_LARGO = 40;
/** Las etiquetas cortas (p. ej. 3 ml) solo imprimen la parte de arriba: 12 × 20 mm. */
const MM_LARGO_CORTA = 20;

/**
 * El diseño se describe en una cuadrícula base de 8 px/mm (la D11 de 203 DPI): 96 px de ancho
 * y 8 px por cada mm de largo. Luego se escala a la resolución real de la impresora.
 */
const BASE_ANCHO = 96;
const BASE_PX_MM = 8;

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

/** Tamaño en píxeles de la imagen para una resolución y un largo dados (ancho = a lo largo del cabezal). */
export function dimensiones(r: Resolucion, largoMm: number): { ancho: number; largo: number } {
  return {
    ancho: Math.min(r.cabezal, Math.round((MM_ANCHO * r.dpi) / 25.4)),
    largo: Math.round((largoMm * r.dpi) / 25.4),
  };
}

/**
 * Largo que se imprime. Debe quedar un poco por debajo de los 40 mm de la etiqueta: si la imagen
 * llega al borde, la impresión se pasa al hueco y la impresora expulsa otra etiqueta en blanco.
 */
export function largoImpresionMm(volumen: string, ajustes: Ajustes): number {
  if (esCorta(volumen, ajustes)) return MM_LARGO_CORTA;
  return Math.min(MM_LARGO, Math.max(30, ajustes.largoMm));
}

/** Margen superior en mm, limitado para que el diseño no quede demasiado pequeño. */
export function margenSuperiorMm(ajustes: Ajustes): number {
  return Math.min(4, Math.max(0, ajustes.margenSuperiorMm));
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
function separador(ctx: CanvasRenderingContext2D, cy: number, largo: number, cx = BASE_ANCHO / 2) {
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

/** En un "2 en 1", separación entre las dos etiquetas cortas (con la línea de corte en medio). */
const MM_SEPARACION_PAR = 1;

type Logos = { tienda: HTMLImageElement | null; marca: HTMLImageElement | null };

/** Etiqueta corta de L px base de largo: logo, nombre y marca (sin volumen). */
function dibujarCorta(ctx: CanvasRenderingContext2D, nombre: string, marca: string, logos: Logos, L: number, conMarco: boolean) {
  if (logos.tienda) dibujarImagen(ctx, logos.tienda, { x: 9, y: 10, w: 78, h: 34 });
  separador(ctx, 49, 56);
  dibujarTexto(ctx, nombre, { x: 9, y: 54, w: 78, h: L - 102 }, { max: 26, min: 10, maxLineas: 4 });
  separador(ctx, L - 43, 56);
  dibujarMarca(ctx, logos.marca, marca, { x: 9, y: L - 38, w: 78, h: 30 });
  if (conMarco) marco(ctx, BASE_ANCHO, L);
}

/** Etiqueta completa: el nombre absorbe la diferencia de largo; lo demás va anclado arriba o abajo. */
function dibujarCompleta(ctx: CanvasRenderingContext2D, nombre: string, datos: DatosEtiqueta, logos: Logos, L: number, conMarco: boolean) {
  if (logos.tienda) dibujarImagen(ctx, logos.tienda, { x: 9, y: 10, w: 78, h: 66 });
  separador(ctx, 82, 64);
  dibujarTexto(ctx, nombre, { x: 9, y: 88, w: 78, h: L - 196 }, { max: 34, min: 12, maxLineas: 6 });
  separador(ctx, L - 102, 64);
  dibujarMarca(ctx, logos.marca, datos.marca, { x: 9, y: L - 96, w: 78, h: 52 });
  const volumen = formatoVolumen(datos.volumen);
  if (volumen) pildoraVolumen(ctx, volumen, { x: 12, y: L - 38, w: 72, h: 28 }, 22);
  if (conMarco) marco(ctx, BASE_ANCHO, L);
}

/** Línea punteada de corte entre las dos etiquetas de un "2 en 1". */
function lineaCorte(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "#000";
  for (let x = 2; x < BASE_ANCHO - 2; x += 6) ctx.fillRect(x, Math.round(y), 3, 1);
}

async function cargarLogos(marca: string): Promise<Logos> {
  const [tienda, logoMarca] = await Promise.all([cargarImagen(urlLogoTienda()), cargarImagen(urlLogoMarca(marca))]);
  return { tienda, marca: logoMarca };
}

/**
 * Dibuja la etiqueta vertical a la resolución configurada, ya en blanco y negro puro.
 * - Normal: etiqueta completa con volumen (largo de impresión configurado, 38 mm por defecto).
 * - Corta (p. ej. 3 ml): solo los 20 mm de arriba, sin volumen.
 * - Corta con `pareja` ("2 en 1"): dos etiquetas cortas, una debajo de la otra, con línea de corte.
 */
export async function renderizarEtiqueta(
  datos: DatosEtiqueta,
  ajustes: Ajustes,
  pareja?: DatosEtiqueta | null,
): Promise<HTMLCanvasElement> {
  await prepararFuente();
  const corta = esCorta(datos.volumen, ajustes);
  const par = corta && pareja ? pareja : null;
  const largoMm = par ? largoImpresionMm("", ajustes) : largoImpresionMm(datos.volumen, ajustes);
  const { ancho, largo } = dimensiones(ajustes.resolucion, largoMm);
  /** Largo de la imagen en la cuadrícula base: 304 para 38 mm, 160 para la corta. */
  const Limagen = Math.round(largoMm * BASE_PX_MM);
  /**
   * Margen en blanco arriba: la impresora empieza justo en el borde de la etiqueta, así que el diseño
   * se baja para que quede centrado (con 38 mm de impresión, 2 mm arriba y 2 mm abajo). No alarga la imagen.
   */
  const margen = Math.round(margenSuperiorMm(ajustes) * BASE_PX_MM);
  /** Largo del diseño (lo que va dentro del marco). */
  const L = Limagen - margen;
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = largo;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ancho, largo);
  ctx.scale(ancho / BASE_ANCHO, largo / Limagen);
  ctx.translate(0, margen);

  const nombre = (d: DatosEtiqueta) => (ajustes.mayusculas ? d.nombre.toUpperCase() : d.nombre);
  const logos = await cargarLogos(datos.marca);

  if (par) {
    const Lpar = Math.round((L - MM_SEPARACION_PAR * BASE_PX_MM) / 2);
    dibujarCorta(ctx, nombre(datos), datos.marca, logos, Lpar, ajustes.marco);
    lineaCorte(ctx, L / 2);
    const logosPar = await cargarLogos(par.marca);
    ctx.save();
    ctx.translate(0, L - Lpar);
    dibujarCorta(ctx, nombre(par), par.marca, logosPar, Lpar, ajustes.marco);
    ctx.restore();
  } else if (corta) {
    dibujarCorta(ctx, nombre(datos), datos.marca, logos, L, ajustes.marco);
  } else {
    dibujarCompleta(ctx, nombre(datos), datos, logos, L, ajustes.marco);
  }

  binarizar(c);
  return c;
}

/**
 * Etiqueta horizontal para la impresora grande (U1), p. ej. 40 × 20 mm para 30 ml:
 * nombre arriba, separador y abajo la marca (logo o texto) con el volumen en píldora.
 * Se dibuja a `ancho` × `alto` puntos (8 px/mm) y ya en blanco y negro puro.
 */
export async function renderizarEtiquetaHorizontal(
  datos: DatosEtiqueta,
  ajustes: Ajustes,
  ancho: number,
  alto: number,
): Promise<HTMLCanvasElement> {
  await prepararFuente();
  const logoMarca = await cargarImagen(urlLogoMarca(datos.marca));
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ancho, alto);

  const nombre = ajustes.mayusculas ? datos.nombre.toUpperCase() : datos.nombre;
  const m = 12; // margen interior (el marco ocupa ~7 px)
  const altoNombre = Math.round(alto * 0.44);
  dibujarTexto(ctx, nombre, { x: m, y: m, w: ancho - 2 * m, h: altoNombre }, { max: 40, min: 12, maxLineas: 2 });

  const ySep = m + altoNombre + 5;
  separador(ctx, ySep, Math.round(ancho * 0.5), ancho / 2);

  const yFila = ySep + 7;
  const altoFila = alto - m - yFila;
  const volumen = formatoVolumen(datos.volumen);
  const anchoPildora = volumen ? Math.min(96, Math.round(ancho * 0.3)) : 0;
  dibujarMarca(ctx, logoMarca, datos.marca, {
    x: m + 2,
    y: yFila,
    w: ancho - 2 * m - 4 - (anchoPildora ? anchoPildora + 12 : 0),
    h: altoFila,
  });
  if (volumen) {
    const altoPildora = Math.min(30, altoFila);
    pildoraVolumen(
      ctx,
      volumen,
      { x: ancho - m - 2 - anchoPildora, y: yFila + (altoFila - altoPildora) / 2, w: anchoPildora, h: altoPildora },
      22,
    );
  }
  if (ajustes.marco) marco(ctx, ancho, alto);
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
