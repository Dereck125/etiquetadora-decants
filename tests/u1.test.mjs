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

import { OPCIONES_U1_DEFECTO, calcularCalibracionU1, retrocesoU1, trabajoU1 } from "../src/u1.ts";

test("Calibración: centro de la etiqueta y corrección de inicio desde la guía", () => {
  // Etiqueta medida de 8 a 48 mm: centro 28 mm = 224 px → 32 px a la derecha del centro (192).
  const r = calcularCalibracionU1({ ...OPCIONES_U1_DEFECTO, inicioMm: 4.5 }, 8, 48, 2);
  // (la guía empieza en la marca 0 con el mismo retroceso de una etiqueta normal)
  assert.equal(r.desplazamiento, 32);
  assert.equal(r.anchoMedidoMm, 40);
  // El borde de arriba cayó en la marca +2: se retrocedía 2 mm de más → retroceder 2 mm menos.
  assert.equal(r.inicioMm, 2.5);
  assert.equal(calcularCalibracionU1({ ...OPCIONES_U1_DEFECTO, inicioMm: 4.5 }, 4, 44, -1.5).inicioMm, 6);
});

/** Canvas falso: 384 × alto, con la primera línea negra y el resto blanco. */
function lienzoFalso(alto) {
  const data = new Uint8ClampedArray(384 * alto * 4).fill(255);
  for (let x = 0; x < 384; x++) data[x * 4] = data[x * 4 + 1] = data[x * 4 + 2] = 0;
  return { width: 384, height: alto, getContext: () => ({ getImageData: () => ({ data }) }) };
}

test("Trabajo completo: encabezado, líneas y avance hasta el hueco", () => {
  const t = Buffer.from(trabajoU1(lienzoFalso(2), { ...OPCIONES_U1_DEFECTO, densidad: 3, avance: "hueco", avanceMm: 25 }));
  const inicio = [
    paquete(0xbd, [10]),
    paquete(0xa4, [0x33]),
    paquete(0xaf, [0x20, 0x4e]),
    paquete(0xbe, [0]),
    paquete(0xbd, [10]),
  ];
  assert.ok(t.subarray(0, Buffer.concat(inicio).length).equals(Buffer.concat(inicio)), "encabezado BD 10 · A4 33 · AF 20000 · BE 0 · BD 10");
  // Línea negra completa: 384 = 3 × 127 + 3, cada corrida con el bit 7 (negro).
  assert.ok(t.includes(Buffer.from(paquete(0xbf, [0xff, 0xff, 0xff, 0x83]))), "línea negra en RLE");
  assert.ok(t.includes(Buffer.from(paquete(0xbf, [127, 127, 127, 3]))), "línea blanca en RLE");
  const fin = Buffer.concat([paquete(0xbd, [10]), paquete(0xa1, [200, 0, 0x11]), paquete(0xbd, [10]), paquete(0xa3, [0])]);
  assert.ok(t.subarray(t.length - fin.length).equals(fin), "fin: BD 10 · A1 200+0x11 (hueco) · BD 10 · A3");
  assert.ok(!t.includes(Buffer.from(paquete(0xbd, [0]))), "nunca BD 0: la impresora no movería el papel");
});

test("Retroceso: 5 mm fijos (back_paper_num 40); el avance extra solo suma si se usó", () => {
  assert.equal(retrocesoU1(OPCIONES_U1_DEFECTO, false), 5);
  assert.equal(retrocesoU1(OPCIONES_U1_DEFECTO, true), 5, "sin avance extra por defecto");
  assert.equal(retrocesoU1({ ...OPCIONES_U1_DEFECTO, extraMm: 3 }, true), 8);
  assert.equal(retrocesoU1({ ...OPCIONES_U1_DEFECTO, avance: "fijo" }, true), 0);
  const t = Buffer.from(trabajoU1(lienzoFalso(1), OPCIONES_U1_DEFECTO, 5));
  const bd = Buffer.from(paquete(0xbd, [10]));
  assert.ok(t.subarray(0, bd.length).equals(bd), "primero la velocidad (para que el papel pueda moverse)");
  assert.ok(t.subarray(bd.length, bd.length + 10).equals(Buffer.from(paquete(0xa0, [40, 0]))), "luego A0 40 puntos");
  const sin = Buffer.from(trabajoU1(lienzoFalso(1), OPCIONES_U1_DEFECTO, 0));
  assert.equal(sin[bd.length + 2], 0xa4, "sin retroceso, después de BD sigue A4");
});

import { areaImprimibleU1 } from "../src/u1.ts";

test("Área imprimible: si la etiqueta se sale del cabezal se encoge con el mismo margen a los lados", () => {
  assert.deepEqual(areaImprimibleU1(40, 0), { x: 32, ancho: 320 });
  // Calibrada: x0 = 32 + 44 = 76 → termina en 396, 12 px fuera de los 384 → 12 px menos por lado.
  assert.deepEqual(areaImprimibleU1(40, 44), { x: 88, ancho: 296 });
  // Corrida a la izquierda: empieza en -8 → se recorta 8 por lado → de 0 a 304.
  assert.deepEqual(areaImprimibleU1(40, -40), { x: 0, ancho: 304 });
});
