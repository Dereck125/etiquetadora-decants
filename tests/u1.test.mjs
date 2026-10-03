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
