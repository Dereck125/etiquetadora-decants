import type { Resolucion } from "./tipos";
import {
  ImageEncoder,
  LabelType,
  NiimbotBluetoothClient,
  PageColorType,
  type PrintTaskName,
} from "@mmote/niimbluelib";

export type EstadoImpresora = "desconectada" | "conectando" | "conectada" | "imprimiendo";

type Oyente = (estado: EstadoImpresora, detalle: string) => void;

/** Si el modelo no se reconoce, se asume una Niimbot D11. */
const TAREA_D11: PrintTaskName = "D11_V1";

class Impresora {
  private cliente = new NiimbotBluetoothClient();
  private oyentes = new Set<Oyente>();
  estado: EstadoImpresora = "desconectada";
  detalle = "";

  constructor() {
    this.cliente.on("disconnect", () => this.cambiar("desconectada", ""));
  }

  get disponible(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  alCambiar(fn: Oyente): () => void {
    this.oyentes.add(fn);
    fn(this.estado, this.detalle);
    return () => this.oyentes.delete(fn);
  }

  private cambiar(estado: EstadoImpresora, detalle = this.detalle): void {
    this.estado = estado;
    this.detalle = detalle;
    this.oyentes.forEach((fn) => fn(estado, detalle));
  }

  async conectar(): Promise<void> {
    if (!this.disponible) {
      throw new Error("Este navegador no tiene Web Bluetooth. Usa Chrome en Android o Chrome/Edge en PC.");
    }
    this.cambiar("conectando", "");
    try {
      const info = await this.cliente.connect();
      const r = this.resolucion();
      this.cambiar("conectada", `${info.deviceName ?? "Niimbot"}${r ? ` · ${r.dpi} DPI` : ""}`);
    } catch (e) {
      this.cambiar("desconectada", "");
      throw e;
    }
  }

  /** Resolución que informa la impresora conectada (null si no se reconoce el modelo). */
  resolucion(): Resolucion | null {
    const m = this.cliente.isConnected() ? this.cliente.getModelMetadata() : undefined;
    return m ? { modelo: m.model, dpi: m.dpi, cabezal: m.printheadPixels } : null;
  }

  async desconectar(): Promise<void> {
    await this.cliente.disconnect();
    this.cambiar("desconectada", "");
  }

  /**
   * Imprime `cantidad` copias del lienzo (largo × cabezal).
   * @param progreso recibe (página actual, total) mientras imprime.
   */
  async imprimir(
    lienzo: HTMLCanvasElement,
    cantidad: number,
    densidad: number,
    progreso?: (pagina: number, total: number) => void,
  ): Promise<void> {
    if (!this.cliente.isConnected()) await this.conectar();
    const modelo = this.cliente.getModelMetadata();
    if (modelo && lienzo.height !== modelo.printheadPixels) {
      throw new Error(
        `La etiqueta se generó para un cabezal de ${lienzo.height} px y la impresora usa ${modelo.printheadPixels} px.`,
      );
    }
    const tarea = this.cliente.getPrintTaskType() ?? TAREA_D11;
    const direccion = modelo?.printDirection ?? "left";
    const imagen = ImageEncoder.encodeCanvas(lienzo, PageColorType.SingleColor, direccion);
    const min = modelo?.densityMin ?? 1, max = modelo?.densityMax ?? 3;

    const trabajo = this.cliente.protocol.newPrintTask(tarea, {
      totalPages: cantidad,
      density: Math.min(max, Math.max(min, densidad)),
      labelType: LabelType.WithGaps,
    });
    const alProgreso = (e: { page: number; pagesTotal: number }) => progreso?.(e.page, e.pagesTotal);
    this.cliente.on("printprogress", alProgreso);
    this.cambiar("imprimiendo");
    try {
      await trabajo.printInit();
      await trabajo.printPage(imagen, cantidad);
      await trabajo.waitForPageFinished();
      await trabajo.waitForFinished();
    } finally {
      this.cliente.off("printprogress", alProgreso);
      await trabajo.printEnd().catch(() => undefined);
      this.cambiar(this.cliente.isConnected() ? "conectada" : "desconectada");
    }
  }
}

export const impresora = new Impresora();
