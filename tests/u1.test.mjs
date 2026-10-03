// Pruebas del protocolo de la U1 contra los vectores "golden" de TiMini-Print (Apache-2.0).
// Ejecutar: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { crc8, paquete } from "../src/u1.ts";

const hex = (partes) => partes.map((p) => Buffer.from(p).toString("hex")).join("");

test("CRC-8 (poli 0x07, inicio 0)", () => {
  assert.equal(crc8(Uint8Array.from([0x00])), 0x00);
  assert.equal(crc8(Uint8Array.from([0x33])), 0x99);
  assert.equal(crc8(Uint8Array.from([0x30, 0x00])), 0xf9);
});

test("golden image_old: A4, AF, BE, BD, línea A2 (LSB primero), avance y estado", () => {
  const trabajo = [
    paquete(0xa4, [0x33]),
    paquete(0xaf, [5000 & 0xff, 5000 >> 8]),
    paquete(0xbe, [0]),
    paquete(0xbd, [10]),
    paquete(0xa2, [0x55]), // píxeles 1,0,1,0,1,0,1,0 con LSB primero
    paquete(0xbd, [12]),
    paquete(0xa1, [0x30, 0x00]),
    paquete(0xa1, [0x30, 0x00]),
    paquete(0xbd, [12]),
    paquete(0xa3, [0]),
  ];
  assert.equal(
    hex(trabajo),
    "5178a40001003399ff5178af000200881367ff5178be0001000000ff5178bd0001000a36ff5178a200010055acff5178bd0001000c24ff5178a10002003000f9ff5178a10002003000f9ff5178bd0001000c24ff5178a30001000000ff",
  );
});

import { empacarLinea, rleLinea } from "../src/u1.ts";

test("RLE: línea en blanco de 384 puntos = corridas de 127 + resto", () => {
  assert.deepEqual(rleLinea(new Uint8Array(384)), [127, 127, 127, 3]);
});

test("RLE: corridas negras llevan el bit 7 (color << 7 | largo)", () => {
  const linea = new Uint8Array(384);
  linea.fill(1, 10, 20); // 10 blancos, 10 negros, 364 blancos
  assert.deepEqual(rleLinea(linea), [10, 0x80 | 10, 127, 127, 110]);
});

test("Empaquetado LSB primero: 1,0,1,0,1,0,1,0 = 0x55", () => {
  assert.deepEqual(empacarLinea(Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 0])), [0x55]);
});

import { OPCIONES_U1_DEFECTO, retrocesoU1, trabajoU1 } from "../src/u1.ts";

/** Canvas falso: 384 × alto, con la primera línea negra y el resto blanco. */
function lienzoFalso(alto) {
  const data = new Uint8ClampedArray(384 * alto * 4).fill(255);
  for (let x = 0; x < 384; x++) data[x * 4] = data[x * 4 + 1] = data[x * 4 + 2] = 0;
  return { width: 384, height: alto, getContext: () => ({ getImageData: () => ({ data }) }) };
}

test("Trabajo completo: encabezado, líneas y avance hasta el hueco", () => {
  const t = Buffer.from(trabajoU1(lienzoFalso(2), { ...OPCIONES_U1_DEFECTO, densidad: 3, avance: "hueco", avanceMm: 25 }));
  const inicio = [paquete(0xa4, [0x33]), paquete(0xaf, [0x20, 0x4e]), paquete(0xbe, [0]), paquete(0xbd, [10])];
  assert.ok(t.subarray(0, Buffer.concat(inicio).length).equals(Buffer.concat(inicio)), "encabezado A4 33 · AF 20000 · BE 0 · BD 10");
  // Línea negra completa: 384 = 3 × 127 + 3, cada corrida con el bit 7 (negro).
  assert.ok(t.includes(Buffer.from(paquete(0xbf, [0xff, 0xff, 0xff, 0x83]))), "línea negra en RLE");
  assert.ok(t.includes(Buffer.from(paquete(0xbf, [127, 127, 127, 3]))), "línea blanca en RLE");
  const fin = Buffer.concat([
    paquete(0xbd, [0]),
    paquete(0xa1, [200, 0, 0x11]),
    paquete(0xa1, [40, 0]),
    paquete(0xbd, [0]),
    paquete(0xa3, [0]),
  ]);
  assert.ok(t.subarray(t.length - fin.length).equals(fin), "fin: BD 0 · A1 200+0x11 (hueco) · A1 40 (arrancar) · BD 0 · A3");
});

test("Retroceso: inicio (4.5 mm) + avance extra de la etiqueta anterior (5 mm)", () => {
  assert.equal(retrocesoU1(OPCIONES_U1_DEFECTO, false), 4.5);
  assert.equal(retrocesoU1(OPCIONES_U1_DEFECTO, true), 9.5);
  assert.equal(retrocesoU1({ ...OPCIONES_U1_DEFECTO, avance: "fijo" }, true), 0);
  const t = Buffer.from(trabajoU1(lienzoFalso(1), OPCIONES_U1_DEFECTO, 9.5));
  assert.ok(t.subarray(0, 10).equals(Buffer.from(paquete(0xa0, [76, 0]))), "A0 76 puntos");
  const sin = Buffer.from(trabajoU1(lienzoFalso(1), OPCIONES_U1_DEFECTO, 0));
  assert.equal(sin[2], 0xa4, "sin retroceso empieza con A4");
});
