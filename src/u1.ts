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
}

export const OPCIONES_U1_DEFECTO: OpcionesU1 = {
  densidad: 3,
  avance: "hueco",
  avanceMm: 25,
  modoBE: 0,
  bloque: 100,
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

/** Arma el trabajo completo de una etiqueta a partir de un canvas de 384 de ancho. */
export function trabajoU1(lienzo: HTMLCanvasElement, o: OpcionesU1): Uint8Array {
  if (lienzo.width !== U1_ANCHO) throw new Error(`El lienzo debe medir ${U1_ANCHO} px de ancho`);
  const { width: w, height: h } = lienzo;
  const px = lienzo.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const VELOCIDAD = 10;
  const partes: Uint8Array[] = [
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

  async imprimir(lienzo: HTMLCanvasElement, copias: number, o: OpcionesU1, progreso?: (t: string) => void) {
    if (!this.conectada) await this.conectar();
    const trabajo = trabajoU1(lienzo, o);
    for (let c = 1; c <= copias; c++) {
      await this.enviar(trabajo, o.bloque, (n, t) =>
        progreso?.(`Enviando ${copias > 1 ? `copia ${c} de ${copias}, ` : ""}${Math.round((n / t) * 100)}%`),
      );
    }
  }
}

export const u1 = new ImpresoraU1();

// ---------- etiqueta de calibración ----------

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
