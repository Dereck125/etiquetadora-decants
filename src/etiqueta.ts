import { binarizar, cargarImagen, urlLogoMarca, urlLogoTienda } from "./marcas";
import type { Ajustes, DatosEtiqueta } from "./tipos";

/** Niimbot D11: 203 DPI ≈ 8 px/mm. Etiqueta 12 × 40 mm → 96 × 320 px (96 = ancho del cabezal). */
export const PX_MM = 8;
export const LARGO = 320;
export const ANCHO = 96;

export const FUENTE = '"Roboto Condensed", "Arial Narrow", Arial, sans-serif';
const INTERLINEA = 1.08;
/** Cuánto se puede estrechar el texto a lo ancho antes de bajar el tamaño (0.85 = hasta 15%). */
const CONDENSADO_MAX = 0.85;

type Caja = { x: number; y: number; w: number; h: number };
type OpcionesTexto = {
  max: number;
  min: number;
  maxLineas: number;
  peso?: 400 | 700;
  espaciado?: number;
  color?: string;
};

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
  for (let t = o.max; t >= o.min; t--) {
    fuente(ctx, o, t);
    const anchoUtil = caja.w / CONDENSADO_MAX;
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
  let lineas = partirLineas(ctx, palabras, caja.w / CONDENSADO_MAX);
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
  ctx.drawImage(img, Math.round(caja.x + (caja.w - w) / 2), Math.round(caja.y + (caja.h - h) / 2), w, h);
}

function rectRedondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Marco doble: línea exterior de 2 px y filete interior de 1 px. */
function marco(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  rectRedondeado(ctx, 3, 3, w - 6, h - 6, 7);
  ctx.stroke();
  ctx.lineWidth = 1;
  rectRedondeado(ctx, 6.5, 6.5, w - 13, h - 13, 4);
  ctx.stroke();
}

/** Separador ornamental: ——◆—— (horizontal) o su versión vertical. */
function separador(ctx: CanvasRenderingContext2D, cx: number, cy: number, largo: number, vertical = false) {
  ctx.fillStyle = "#000";
  const brazo = largo / 2 - 5;
  if (vertical) {
    ctx.fillRect(cx, cy - largo / 2, 1, brazo);
    ctx.fillRect(cx, cy + 5, 1, brazo);
  } else {
    ctx.fillRect(cx - largo / 2, cy, brazo, 1);
    ctx.fillRect(cx + 5, cy, brazo, 1);
  }
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, cy - 2.5);
  ctx.lineTo(cx + 3, cy + 0.5);
  ctx.lineTo(cx + 0.5, cy + 3.5);
  ctx.lineTo(cx - 2, cy + 0.5);
  ctx.closePath();
  ctx.fill();
}

/** Volumen en una píldora negra con letras blancas. */
function pildoraVolumen(ctx: CanvasRenderingContext2D, texto: string, caja: Caja, tamMax: number): void {
  ctx.fillStyle = "#000";
  rectRedondeado(ctx, caja.x, caja.y, caja.w, caja.h, Math.min(caja.h / 2, 10));
  ctx.fill();
  dibujarTexto(ctx, texto, { x: caja.x + 4, y: caja.y, w: caja.w - 8, h: caja.h }, {
    max: tamMax,
    min: 9,
    maxLineas: 1,
    espaciado: 1,
    color: "#fff",
  });
}

/** Alto mínimo (px) de un logo de marca para que se lea: 12 px = 1.5 mm. */
const ALTO_MIN_LOGO = 12;

/** Logo de marca si se lee bien a ese tamaño; si es demasiado alargado, el nombre en texto. */
function dibujarMarca(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, marca: string, caja: Caja) {
  const alto = logo ? Math.min(caja.w / logo.naturalWidth, caja.h / logo.naturalHeight) * logo.naturalHeight : 0;
  if (logo && alto >= ALTO_MIN_LOGO) dibujarImagen(ctx, logo, caja);
  else marcaComoTexto(ctx, marca, caja);
}

function marcaComoTexto(ctx: CanvasRenderingContext2D, marca: string, caja: Caja): void {
  dibujarTexto(ctx, marca.toUpperCase(), caja, { max: 15, min: 8, maxLineas: 2, peso: 700, espaciado: 1 });
}

export function formatoVolumen(v: number | string): string {
  const s = String(v).trim();
  return /^\d+([.,]\d+)?$/.test(s) ? `${s} ML` : s.toUpperCase();
}

/**
 * Dibuja la etiqueta en su orientación de lectura (vertical: 96 × 320, horizontal: 320 × 96),
 * ya convertida a blanco y negro puro.
 */
export async function renderizarEtiqueta(datos: DatosEtiqueta, ajustes: Ajustes): Promise<HTMLCanvasElement> {
  await prepararFuente();
  const [logoTienda, logoMarca] = await Promise.all([
    cargarImagen(urlLogoTienda()),
    cargarImagen(urlLogoMarca(datos.marca)),
  ]);
  const vertical = ajustes.diseno === "vertical";
  const c = document.createElement("canvas");
  c.width = vertical ? ANCHO : LARGO;
  c.height = vertical ? LARGO : ANCHO;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);

  const nombre = ajustes.mayusculas ? datos.nombre.toUpperCase() : datos.nombre;
  const volumen = formatoVolumen(datos.volumen);

  if (vertical) {
    if (logoTienda) dibujarImagen(ctx, logoTienda, { x: 14, y: 14, w: 68, h: 56 });
    separador(ctx, 48, 79, 56);
    dibujarTexto(ctx, nombre, { x: 11, y: 86, w: 74, h: 118 }, { max: 26, min: 11, maxLineas: 6 });
    separador(ctx, 48, 211, 56);
    dibujarMarca(ctx, logoMarca, datos.marca, { x: 11, y: 219, w: 74, h: 48 });
    if (volumen) pildoraVolumen(ctx, volumen, { x: 18, y: 277, w: 60, h: 26 }, 18);
  } else {
    if (logoTienda) dibujarImagen(ctx, logoTienda, { x: 14, y: 14, w: 62, h: 68 });
    separador(ctx, 85, 48, 56, true);
    dibujarTexto(ctx, nombre, { x: 94, y: 11, w: 152, h: 46 }, { max: 24, min: 10, maxLineas: 2 });
    dibujarMarca(ctx, logoMarca, datos.marca, { x: 100, y: 60, w: 140, h: 25 });
    separador(ctx, 254, 48, 56, true);
    if (volumen) pildoraVolumen(ctx, volumen, { x: 261, y: 34, w: 50, h: 28 }, 17);
  }
  if (ajustes.marco) marco(ctx, c.width, c.height);

  binarizar(c);
  return c;
}

/** Lienzo de 320 × 96 que espera la D11 (largo × cabezal), girado según el diseño. */
export function lienzoImpresion(etiqueta: HTMLCanvasElement, ajustes: Ajustes): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = LARGO;
  c.height = ANCHO;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, LARGO, ANCHO);
  if (ajustes.invertir) {
    ctx.translate(LARGO, ANCHO);
    ctx.rotate(Math.PI);
  }
  if (etiqueta.height > etiqueta.width) {
    // Vertical: la parte de arriba de la etiqueta queda a la izquierda del lienzo.
    ctx.translate(0, ANCHO);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(etiqueta, 0, 0);
  return c;
}
