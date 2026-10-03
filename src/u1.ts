/**
 * Yihetangde U1 (app "Tiny Print"): impresora térmica de 384 puntos (48 mm) a ~203 DPI.
 *
 * Protocolo "tiny" (familia de las "cat printers"), según TiMini-Print (Apache-2.0,
 * github.com/Dejniel/TiMini-Print), perfil "u1":
 * - BLE: servicio AE30; se escribe en AE01 (sin respuesta) y la impresora avisa por AE02.
 * - Paquete: 51 78 | comando | 00 | largo (u16 LE) | datos | CRC-8 (poli 0x07) de los datos | FF.
 * - Cada línea: BF + RLE si es corta, si no A2 + 48 bytes (LSB primero, 1 = negro).
 * - Control de flujo: AE con datos 10 = pausa, 00 = seguir.
 * - No hay confirmaciones: un trabajo rechazado no da error, solo no imprime.
 */

const SERVICIO = "0000ae30-0000-1000-8000-00805f9b34fb";
const ESCRITURA = "0000ae01-0000-1000-8000-00805f9b34fb";
const AVISOS = "0000ae02-0000-1000-8000-00805f9b34fb";

/** Ancho del cabezal en puntos. */
export const U1_ANCHO = 384;
/** Puntos por mm (perfil "u1": dev_dpi 200). */
export const U1_PX_MM = 8;

/** Cómo avanzar al terminar cada etiqueta (aún no confirmado en la U1: se elige en la prueba). */
export type AvanceU1 = "hueco" | "fijo" | "timini";

export interface OpcionesU1 {
  /** 1–5 (comando A4). */
  densidad: number;
  avance: AvanceU1;
  /** Para avance "fijo": mm a avanzar tras la imagen. Para "hueco": máximo a buscar. */
  avanceMm: number;
  /** Valor del comando BE: 0 = imagen (TiMini), 1 = texto/etiqueta. */
  modoBE: 0 | 1;
  /** Bytes por escritura BLE. */
  bloque: number;
  /**
   * Avance extra al terminar para poder arrancar la etiqueta (distancia del sensor a la barra de corte).
   * El perfil "u1" de TiMini usa 40 puntos = 5 mm ("back_paper_num").
   */
  extraMm: number;
  /**
   * Cuánto queda adelantada la etiqueta respecto al cabezal después de buscar el hueco. Se retrocede
   * antes de imprimir para empezar en el borde. Medido en la primera prueba: ~4.5 mm.
   */
  inicioMm: number;
}

export const OPCIONES_U1_DEFECTO: OpcionesU1 = {
  densidad: 3,
  avance: "hueco",
  avanceMm: 25,
  modoBE: 0,
  bloque: 100,
  extraMm: 5,
  inicioMm: 4.5,
};

// ---------- paquetes ----------

const TABLA_CRC = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();

export function crc8(datos: Uint8Array): number {
  let c = 0;
  for (const b of datos) c = TABLA_CRC[c ^ b];
  return c;
}

export function paquete(comando: number, datos: ArrayLike<number> = []): Uint8Array {
  const d = Uint8Array.from(datos);
  const p = new Uint8Array(8 + d.length);
  p.set([0x51, 0x78, comando & 0xff, 0x00, d.length & 0xff, (d.length >> 8) & 0xff]);
  p.set(d, 6);
  p[6 + d.length] = crc8(d);
  p[7 + d.length] = 0xff;
  return p;
}

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

/** RLE de una línea de 1 bit, igual que rle_encode_line de TiMini. */
export function rleLinea(linea: Uint8Array): number[] {
  const corrida = (color: number, n: number, out: number[]) => {
    while (n > 127) {
      out.push((color << 7) | 127);
      n -= 127;
    }
    if (n > 0) out.push((color << 7) | n);
  };
  const out: number[] = [];
  let previo = linea[0];
  let n = 1;
  let hayNegro = previo === 1;
  for (let i = 1; i < linea.length; i++) {
    if (linea[i]) hayNegro = true;
    if (linea[i] === previo) n++;
    else {
      corrida(previo, n, out);
      previo = linea[i];
      n = 1;
    }
  }
  if (hayNegro || !out.length) corrida(previo, n, out);
  return out;
}

export function empacarLinea(linea: Uint8Array): number[] {
  const out = new Array<number>(linea.length / 8).fill(0);
  for (let x = 0; x < linea.length; x++) if (linea[x]) out[x >> 3] |= 1 << (x & 7);
  return out;
}

/**
 * Arma el trabajo completo de una etiqueta a partir de un canvas de 384 de ancho.
 * @param retrocesoMm cuánto regresar el papel antes de imprimir (ver {@link retrocesoU1}).
 */
export function trabajoU1(lienzo: HTMLCanvasElement, o: OpcionesU1, retrocesoMm = 0): Uint8Array {
  if (lienzo.width !== U1_ANCHO) throw new Error(`El lienzo debe medir ${U1_ANCHO} px de ancho`);
  const { width: w, height: h } = lienzo;
  const px = lienzo.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const VELOCIDAD = 10;
  const extra = Math.round(Math.max(0, o.extraMm) * U1_PX_MM);
  const retroceso = Math.round(Math.max(0, retrocesoMm) * U1_PX_MM);
  const partes: Uint8Array[] = [
    // A0 = retroceder papel (u16 LE en puntos), para empezar justo en el borde de la etiqueta.
    ...(retroceso > 0 ? [paquete(0xa0, u16(retroceso))] : []),
    paquete(0xa4, [0x30 + Math.min(5, Math.max(1, o.densidad))]),
    paquete(0xaf, u16(20000)),
    paquete(0xbe, [o.modoBE]),
    paquete(0xbd, [VELOCIDAD]),
  ];
  const linea = new Uint8Array(w);
  const anchoBytes = w / 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      linea[x] = px[i] < 128 && px[i + 3] > 127 ? 1 : 0;
    }
    const rle = rleLinea(linea);
    partes.push(rle.length <= anchoBytes ? paquete(0xbf, rle) : paquete(0xa2, empacarLinea(linea)));
    if ((y + 1) % 200 === 0) partes.push(paquete(0xbd, [VELOCIDAD]));
  }
  // Final: avanzar hasta la siguiente etiqueta y pedir estado.
  partes.push(paquete(0xbd, [0]));
  const puntos = Math.round(o.avanceMm * U1_PX_MM);
  if (o.avance === "timini") {
    partes.push(paquete(0xa1, u16(48)), paquete(0xa1, u16(48)));
  } else if (o.avance === "hueco") {
    // A1 con el indicador 0x11: avanza buscando el hueco/marca (como "check black" de TiMini).
    partes.push(paquete(0xa1, [...u16(puntos), 0x11]));
    // Ya en el hueco: avanzar un poco más para que la etiqueta pase la barra de corte.
    if (extra > 0) partes.push(paquete(0xa1, u16(extra)));
  } else if (puntos > 0) {
    partes.push(paquete(0xa1, u16(puntos)));
  }
  partes.push(paquete(0xbd, [0]), paquete(0xa3, [0]));

  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

// ---------- conexión ----------

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (d: DataView) =>
  Array.from(new Uint8Array(d.buffer, d.byteOffset, d.byteLength), (b) => b.toString(16).padStart(2, "0")).join(" ");

/**
 * Retroceso antes de imprimir: tras buscar el hueco la etiqueta queda `inicioMm` adelantada, y si la
 * anterior avanzó `extraMm` para arrancarla, también eso. Solo aplica al avance por hueco.
 */
export function retrocesoU1(o: OpcionesU1, anteriorAdelantada: boolean): number {
  if (o.avance !== "hueco") return 0;
  return Math.max(0, o.inicioMm) + (anteriorAdelantada ? Math.max(0, o.extraMm) : 0);
}

/** Recuerda (aunque se cierre la app) si la última etiqueta quedó adelantada para arrancarla. */
const CLAVE_ADELANTADA = "u1-adelantada";
function leerAdelantada(): boolean {
  try {
    return localStorage.getItem(CLAVE_ADELANTADA) === "1";
  } catch {
    return false;
  }
}
function guardarAdelantada(v: boolean): void {
  try {
    localStorage.setItem(CLAVE_ADELANTADA, v ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
}

class ImpresoraU1 {
  private dispositivo?: BluetoothDevice;
  private escritura?: BluetoothRemoteGATTCharacteristic;
  private pausada = false;
  /** Últimos avisos recibidos (hex), para diagnóstico. */
  avisos: string[] = [];
  alAviso?: (texto: string) => void;

  get conectada(): boolean {
    return !!this.dispositivo?.gatt?.connected && !!this.escritura;
  }

  get nombre(): string {
    return this.dispositivo?.name ?? "U1";
  }

  async conectar(): Promise<void> {
    if (!("bluetooth" in navigator)) throw new Error("Este navegador no tiene Web Bluetooth.");
    this.dispositivo = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "U1" }, { services: [SERVICIO] }],
      optionalServices: [SERVICIO],
    });
    this.dispositivo.addEventListener("gattserverdisconnected", () => (this.escritura = undefined));
    const gatt = await this.dispositivo.gatt!.connect();
    const servicio = await gatt.getPrimaryService(SERVICIO);
    this.escritura = await servicio.getCharacteristic(ESCRITURA);
    const avisos = await servicio.getCharacteristic(AVISOS);
    avisos.addEventListener("characteristicvaluechanged", (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      // 51 78 AE 01 01 00 10 70 FF = pausa; ... 00 00 FF = seguir.
      if (b[0] === 0x51 && b[1] === 0x78 && b[2] === 0xae && b.length >= 8) this.pausada = b[6] === 0x10;
      const texto = hex(v);
      this.avisos = [texto, ...this.avisos].slice(0, 20);
      this.alAviso?.(texto);
    });
    await avisos.startNotifications();
  }

  async desconectar(): Promise<void> {
    this.dispositivo?.gatt?.disconnect();
    this.escritura = undefined;
  }

  /** Envía los bytes en bloques, respetando las pausas que pide la impresora. */
  async enviar(datos: Uint8Array, bloque: number, progreso?: (enviado: number, total: number) => void) {
    if (!this.escritura) throw new Error("La U1 no está conectada.");
    for (let i = 0; i < datos.length; i += bloque) {
      const inicio = performance.now();
      while (this.pausada) {
        if (performance.now() - inicio > 15000) throw new Error("La impresora no reanudó (¿sin papel o tapa abierta?).");
        await esperar(20);
      }
      await this.escritura.writeValueWithoutResponse(datos.slice(i, i + bloque));
      progreso?.(Math.min(i + bloque, datos.length), datos.length);
      await esperar(4);
    }
  }

  /**
   * @param retrocesoAdicionalMm retroceso extra solo para esta impresión (la guía de calibración
   *   empieza unos mm antes del borde esperado).
   */
  async imprimir(
    lienzo: HTMLCanvasElement,
    copias: number,
    o: OpcionesU1,
    progreso?: (t: string) => void,
    retrocesoAdicionalMm = 0,
  ) {
    if (!this.conectada) await this.conectar();
    const adelanta = o.avance === "hueco" && o.extraMm > 0;
    for (let c = 1; c <= copias; c++) {
      const retroceso = retrocesoU1(o, c > 1 ? adelanta : leerAdelantada()) + retrocesoAdicionalMm;
      const trabajo = trabajoU1(lienzo, o, retroceso);
      await this.enviar(trabajo, o.bloque, (n, t) =>
        progreso?.(`Enviando ${copias > 1 ? `copia ${c} de ${copias}, ` : ""}${Math.round((n / t) * 100)}%`),
      );
      guardarAdelantada(adelanta);
    }
  }
}

export const u1 = new ImpresoraU1();

// ---------- etiqueta de calibración ----------

/** mm que la guía de calibración empieza antes del borde esperado de la etiqueta. */
export const GUIA_PREVIA_MM = 5;

/**
 * Guía de calibración: regla horizontal de lado a lado del cabezal (en mm, 0 a 48) a media altura
 * y regla vertical que empieza GUIA_PREVIA_MM antes del borde esperado (marca "0" = borde esperado).
 * Con los números que se ven en los bordes de la etiqueta se calcula el centrado y el inicio.
 */
export function lienzoGuiaU1(altoMm: number): HTMLCanvasElement {
  const pre = GUIA_PREVIA_MM;
  const h = Math.round((pre + altoMm) * U1_PX_MM);
  const c = document.createElement("canvas");
  c.width = U1_ANCHO;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, U1_ANCHO, h);
  ctx.fillStyle = "#000";

  // Regla horizontal a media altura de la etiqueta.
  const yh = Math.round((pre + altoMm / 2) * U1_PX_MM);
  ctx.fillRect(0, yh, U1_ANCHO, 2);
  ctx.font = '700 14px "Roboto Condensed", Arial, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (let mm = 0; mm <= 48; mm++) {
    const x = Math.min(U1_ANCHO - 2, mm * U1_PX_MM);
    const largo = mm % 5 === 0 ? 14 : 7;
    ctx.fillRect(x, yh - largo, 2, largo * 2 + 2);
    if (mm % 5 === 0) ctx.fillText(String(mm), Math.min(U1_ANCHO - 8, Math.max(8, x + 1)), yh - 16);
  }

  // Regla vertical (marcas cada mm, números cada 2 mm) a la derecha del centro.
  const xv = 232;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '700 12px "Roboto Condensed", Arial, sans-serif';
  for (let v = -pre; v <= altoMm; v++) {
    const y = Math.round((pre + v) * U1_PX_MM);
    const par = v % 2 === 0;
    ctx.fillRect(xv - (par ? 14 : 7), y, par ? 28 : 14, 2);
    if (par && Math.abs(y - yh) > 22) ctx.fillText(v > 0 ? `+${v}` : String(v), xv + 18, y + 1);
  }
  return c;
}

/**
 * Calcula la calibración a partir de lo que se lee en la guía impresa.
 * @param izq número de la regla horizontal en el borde izquierdo de la etiqueta (mm)
 * @param der número en el borde derecho (mm)
 * @param arriba número de la regla vertical en el borde de arriba (mm; 0 = ya estaba bien)
 */
export function calcularCalibracionU1(o: OpcionesU1, izq: number, der: number, arriba: number) {
  const centroMm = (izq + der) / 2;
  return {
    desplazamiento: Math.round(centroMm * U1_PX_MM - U1_ANCHO / 2),
    inicioMm: Math.max(0, Math.round((o.inicioMm - arriba) * 2) / 2),
    anchoMedidoMm: Math.round((der - izq) * 10) / 10,
  };
}

/**
 * Regla de lado a lado del cabezal (384 puntos = 48 mm): una raya por mm, larga cada 5 mm y
 * números en mm. Los números que quedan en los bordes de la etiqueta dicen cuánto descentrarla.
 */
export function lienzoReglaU1(altoMm: number): HTMLCanvasElement {
  const h = Math.round(altoMm * U1_PX_MM);
  const c = document.createElement("canvas");
  c.width = U1_ANCHO;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, U1_ANCHO, h);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = '700 15px "Roboto Condensed", Arial, sans-serif';
  for (let mm = 0; mm <= 48; mm++) {
    const x = Math.min(U1_ANCHO - 2, mm * U1_PX_MM);
    const largo = mm % 5 === 0 ? 34 : 14;
    ctx.fillRect(x, 0, 2, largo);
    ctx.fillRect(x, h - largo, 2, largo);
    if (mm % 5 === 0) {
      ctx.fillText(String(mm), Math.min(U1_ANCHO - 9, Math.max(9, x + 1)), 38);
      ctx.fillText(String(mm), Math.min(U1_ANCHO - 9, Math.max(9, x + 1)), h - 54);
    }
  }
  // Línea central del cabezal (24 mm).
  ctx.fillRect(U1_ANCHO / 2 - 1, 60, 2, Math.max(0, h - 120));
  return c;
}

/**
 * Etiqueta de prueba de ancho × alto mm, centrada en los 384 puntos (+ desplazamiento):
 * marco en el borde exacto de la etiqueta, flecha "ARRIBA" y medidas.
 */
export function lienzoPruebaU1(anchoMm: number, altoMm: number, desplazamiento: number, logo?: HTMLImageElement | null) {
  const w = Math.round(anchoMm * U1_PX_MM);
  const h = Math.round(altoMm * U1_PX_MM);
  const c = document.createElement("canvas");
  c.width = U1_ANCHO;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, h);
  const x0 = Math.round((U1_ANCHO - w) / 2) + desplazamiento;
  ctx.fillStyle = "#000";
  // Marco de 2 px justo en el borde de la etiqueta.
  ctx.fillRect(x0, 0, w, 2);
  ctx.fillRect(x0, h - 2, w, 2);
  ctx.fillRect(x0, 0, 2, h);
  ctx.fillRect(x0 + w - 2, 0, 2, h);
  // Flecha hacia el borde que sale primero.
  ctx.beginPath();
  ctx.moveTo(x0 + 20, 8);
  ctx.lineTo(x0 + 30, 22);
  ctx.lineTo(x0 + 10, 22);
  ctx.fill();
  ctx.fillRect(x0 + 18, 22, 4, 16);
  ctx.font = '700 16px "Roboto Condensed", Arial, sans-serif';
  ctx.textBaseline = "top";
  ctx.fillText("ARRIBA", x0 + 36, 10);
  ctx.font = '700 22px "Roboto Condensed", Arial, sans-serif';
  ctx.fillText(`PRUEBA U1 ${anchoMm}×${altoMm}`, x0 + 10, h / 2 - 8);
  ctx.font = '400 14px "Roboto Condensed", Arial, sans-serif';
  ctx.fillText(`desplazamiento ${desplazamiento} px`, x0 + 10, h - 24);
  if (logo) {
    const lado = Math.min(h - 20, 70);
    const k = Math.min(lado / logo.naturalWidth, lado / logo.naturalHeight);
    ctx.drawImage(logo, x0 + w - 10 - logo.naturalWidth * k, 10, logo.naturalWidth * k, logo.naturalHeight * k);
  }
  // Blanco y negro puro.
  const img = ctx.getImageData(0, 0, c.width, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i] < 140 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
