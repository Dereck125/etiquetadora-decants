/**
 * Diagnóstico de impresoras desconocidas: muestra cómo se puede hablar con ellas
 * (Bluetooth de bajo consumo o puerto serie por Bluetooth clásico) antes de implementar su protocolo.
 */

/** Servicios BLE habituales en impresoras térmicas chinas (hay que declararlos para poder verlos). */
const SERVICIOS_CONOCIDOS: Record<string, string> = {
  "0000ae30-0000-1000-8000-00805f9b34fb": "AE30 (impresoras tipo \"cat printer\")",
  "0000af30-0000-1000-8000-00805f9b34fb": "AF30",
  "0000ff00-0000-1000-8000-00805f9b34fb": "FF00 (Phomemo y otras)",
  "0000ffe0-0000-1000-8000-00805f9b34fb": "FFE0 (puerto serie BLE)",
  "0000ffe5-0000-1000-8000-00805f9b34fb": "FFE5",
  "0000ffe6-0000-1000-8000-00805f9b34fb": "FFE6",
  "0000fff0-0000-1000-8000-00805f9b34fb": "FFF0",
  "0000fee7-0000-1000-8000-00805f9b34fb": "FEE7",
  "000018f0-0000-1000-8000-00805f9b34fb": "18F0 (impresoras de etiquetas TSPL)",
  "0000abf0-0000-1000-8000-00805f9b34fb": "ABF0",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455": "ISSC / Microchip (puerto serie transparente)",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e": "Nordic UART",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2": "Niimbot",
  "0000180a-0000-1000-8000-00805f9b34fb": "Información del dispositivo",
};

const INFO_DISPOSITIVO: Record<string, string> = {
  "00002a29-0000-1000-8000-00805f9b34fb": "Fabricante",
  "00002a24-0000-1000-8000-00805f9b34fb": "Modelo",
  "00002a26-0000-1000-8000-00805f9b34fb": "Firmware",
  "00002a27-0000-1000-8000-00805f9b34fb": "Hardware",
};

/** UUID del perfil de puerto serie (SPP) de Bluetooth clásico. */
const SPP = "00001101-0000-1000-8000-00805f9b34fb";

function propiedades(p: BluetoothCharacteristicProperties): string {
  const lista: string[] = [];
  if (p.read) lista.push("leer");
  if (p.write) lista.push("escribir");
  if (p.writeWithoutResponse) lista.push("escribir sin respuesta");
  if (p.notify) lista.push("notificar");
  if (p.indicate) lista.push("indicar");
  return lista.join(", ") || "—";
}

/**
 * Abre el selector de Chrome con TODOS los dispositivos BLE cercanos y, del elegido,
 * lista sus servicios y características. Devuelve un reporte en texto.
 */
export async function diagnosticarBle(): Promise<string> {
  if (!("bluetooth" in navigator)) throw new Error("Este navegador no tiene Web Bluetooth.");
  const dispositivo = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: Object.keys(SERVICIOS_CONOCIDOS),
  });
  const lineas = [`BLE · nombre: ${dispositivo.name ?? "(sin nombre)"} · id: ${dispositivo.id}`];
  const gatt = await dispositivo.gatt!.connect();
  try {
    const servicios = await gatt.getPrimaryServices();
    if (!servicios.length) lineas.push("No expone ninguno de los servicios conocidos.");
    for (const s of servicios) {
      lineas.push(`Servicio ${s.uuid} — ${SERVICIOS_CONOCIDOS[s.uuid] ?? "desconocido"}`);
      for (const c of await s.getCharacteristics()) {
        let valor = "";
        if (INFO_DISPOSITIVO[c.uuid] && c.properties.read) {
          try {
            valor = ` = "${new TextDecoder().decode(await c.readValue())}"`;
          } catch {
            /* algunas no se dejan leer */
          }
        }
        lineas.push(`  · ${INFO_DISPOSITIVO[c.uuid] ?? c.uuid} [${propiedades(c.properties)}]${valor}`);
      }
    }
  } finally {
    gatt.disconnect();
  }
  return lineas.join("\n");
}

/** Abre el selector de puertos serie de Chrome (Bluetooth clásico ya vinculado) y reporta el elegido. */
export async function diagnosticarSerie(): Promise<string> {
  if (!("serial" in navigator)) {
    throw new Error("Este navegador no tiene Web Serial (necesitas Chrome actualizado).");
  }
  const puerto = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] });
  const info = puerto.getInfo();
  return [
    "Puerto serie (Bluetooth clásico)",
    `  · servicio: ${info.bluetoothServiceClassId ?? "—"}`,
    `  · USB: ${info.usbVendorId ?? "—"}/${info.usbProductId ?? "—"}`,
  ].join("\n");
}
