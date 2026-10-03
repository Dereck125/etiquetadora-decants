import "@fontsource/roboto-condensed/400.css";
import "@fontsource/roboto-condensed/700.css";
import "./style.css";

import {
  AJUSTES_DEFECTO,
  RESOLUCIONES,
  catalogoPorDefecto,
  estado,
  guardarAjustes,
  guardarPerfumes,
  marcasDelCatalogo,
  nuevoId,
  reemplazarPerfumes,
} from "./almacen";
import { descargarTexto, perfumesACsv, perfumesDesdeCsv } from "./csv";
import { esCorta, lienzoImpresion, renderizarEtiqueta } from "./etiqueta";
import {
  impresora,
  PAUSAS_ENVIO,
  TAREAS_IMPRESION,
  TIPOS_ETIQUETA,
  type InfoImpresora,
  type TiemposImpresion,
} from "./impresora";
import { cargarLogosIncluidos, procesarLogoSubido, slugMarca, urlLogoMarca, urlLogoTienda } from "./marcas";
import { GENEROS, type DatosEtiqueta, type Genero, type Perfume } from "./tipos";

// ---------- utilidades ----------

const $ = <T extends HTMLElement = HTMLElement>(sel: string, raiz: ParentNode = document) =>
  raiz.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll<T>(sel)];

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let temporizadorAviso = 0;
function aviso(texto: string, tipo: "ok" | "error" = "ok"): void {
  // Es un popover: vive en la capa superior, así se ve también encima de los diálogos.
  const el = $("#aviso");
  el.textContent = texto;
  el.className = `aviso ${tipo}`;
  if (el.matches(":popover-open")) el.hidePopover();
  el.showPopover();
  clearTimeout(temporizadorAviso);
  temporizadorAviso = window.setTimeout(() => el.hidePopover(), tipo === "error" ? 7000 : 3500);
}

function mensajeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/User cancelled|cancelled the requestDevice/i.test(m)) return "Conexión cancelada.";
  if (/adapter not available|Bluetooth is (off|disabled)/i.test(m)) return "Bluetooth apagado o no disponible en este equipo.";
  if (/user gesture/i.test(m)) return 'Toca "Conectar impresora" arriba y vuelve a intentar.';
  if (/GATT|disconnected/i.test(m)) return "Se perdió la conexión con la impresora. Vuelve a conectarla.";
  if (/timeout/i.test(m)) return "La impresora no respondió a tiempo. ¿Está encendida y con etiquetas?";
  return m;
}

/** "3, 5 ,10" → [3, 5, 10] */
function leerNumeros(texto: string): number[] {
  return texto
    .split(/[,;\s]+/)
    .map(Number)
    .filter((n) => n > 0);
}

function leerArchivo(acepta: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = acepta;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Dibuja la etiqueta en un canvas visible (vista previa). Evita carreras entre renders. */
const versionesPrevia = new WeakMap<HTMLCanvasElement, number>();
async function pintarVistaPrevia(
  destino: HTMLCanvasElement,
  datos: DatosEtiqueta,
  pareja?: DatosEtiqueta | null,
): Promise<HTMLCanvasElement> {
  const v = (versionesPrevia.get(destino) ?? 0) + 1;
  versionesPrevia.set(destino, v);
  const etiqueta = await renderizarEtiqueta(datos, estado.ajustes, pareja);
  if (versionesPrevia.get(destino) === v) {
    destino.width = etiqueta.width;
    destino.height = etiqueta.height;
    destino.getContext("2d")!.drawImage(etiqueta, 0, 0);
  }
  return etiqueta;
}

async function descargarPng(datos: DatosEtiqueta, pareja?: DatosEtiqueta | null): Promise<void> {
  const etiqueta = await renderizarEtiqueta(datos, estado.ajustes, pareja);
  const a = document.createElement("a");
  a.href = etiqueta.toDataURL("image/png");
  a.download = `etiqueta-${slugMarca(datos.nombre) || "decant"}-${slugMarca(datos.volumen)}.png`;
  a.click();
}

// ---------- impresora ----------

const btnImpresora = $("#btn-impresora");
impresora.alCambiar((est, detalle) => {
  btnImpresora.dataset.estado = est;
  $("#txt-impresora").textContent =
    est === "conectada" ? detalle || "Conectada"
    : est === "conectando" ? "Conectando…"
    : est === "imprimiendo" ? "Imprimiendo…"
    : "Conectar impresora";
});
/**
 * Usa la resolución que informa la impresora conectada (D11: 203 DPI, D11-H: 300 DPI…),
 * para que la etiqueta ocupe exactamente los 12 × 40 mm.
 */
function sincronizarResolucion(): void {
  const r = impresora.resolucion();
  const actual = estado.ajustes.resolucion;
  if (!r || (r.dpi === actual.dpi && r.cabezal === actual.cabezal)) return;
  estado.ajustes.resolucion = r;
  guardarAjustes();
  aviso(`Impresora ${r.modelo} detectada (${r.dpi} DPI): la etiqueta se ajustó a su resolución.`);
  if (vistaActual === "ajustes") vistaAjustes();
}

btnImpresora.addEventListener("click", async () => {
  try {
    if (impresora.estado === "conectada") {
      if (confirm("¿Desconectar la impresora?")) await impresora.desconectar();
    } else if (impresora.estado === "desconectada") {
      await impresora.conectar();
      aviso("Impresora conectada");
      sincronizarResolucion();
      if (vistaActual === "ajustes") vistaAjustes();
    }
  } catch (e) {
    aviso(mensajeError(e), "error");
  }
});

async function imprimir(
  datos: DatosEtiqueta,
  cantidad: number,
  progreso?: (t: string) => void,
  pareja?: DatosEtiqueta | null,
): Promise<boolean> {
  let tiempos: TiemposImpresion;
  try {
    // Conectar primero: Chrome solo abre el selector Bluetooth justo después de un toque.
    if (impresora.estado === "desconectada") await impresora.conectar();
    sincronizarResolucion();
    const etiqueta = await renderizarEtiqueta(datos, estado.ajustes, pareja);
    progreso?.("Enviando a la impresora…");
    tiempos = await impresora.imprimir(
      lienzoImpresion(etiqueta, estado.ajustes),
      cantidad,
      {
        densidad: estado.ajustes.densidad,
        pausaMs: estado.ajustes.pausaEnvioMs,
        tipoEtiqueta: estado.ajustes.tipoEtiqueta,
        tarea: (TAREAS_IMPRESION as readonly string[]).includes(estado.ajustes.tareaImpresion)
          ? (estado.ajustes.tareaImpresion as (typeof TAREAS_IMPRESION)[number])
          : "auto",
      },
      (p, t) => progreso?.(`Imprimiendo ${Math.min(p + 1, t)} de ${t}…`),
    );
  } catch (e) {
    aviso("No se pudo imprimir: " + mensajeError(e), "error");
    return false;
  }
  const de = pareja ? `${datos.nombre} + ${pareja.nombre} (2 en 1)` : datos.nombre;
  const s = (ms: number) => (ms / 1000).toLocaleString("es", { maximumFractionDigits: 1 });
  aviso(`Listo: ${cantidad} etiqueta${cantidad === 1 ? "" : "s"} de ${de} · ${s(tiempos.total)} s (envío ${s(tiempos.envio)} s)`);
  return true;
}

// ---------- navegación ----------

type Vista = "catalogo" | "rapida" | "ajustes";
let vistaActual: Vista = "catalogo";
const vistas: Record<Vista, () => void> = {
  catalogo: vistaCatalogo,
  rapida: vistaRapida,
  ajustes: vistaAjustes,
};

function irA(v: Vista): void {
  vistaActual = v;
  $$("[data-vista]").forEach((b) => b.classList.toggle("activa", b.dataset.vista === v));
  vistas[v]();
  try { sessionStorage.setItem("etq.vista", v); } catch { /* sin almacenamiento */ }
}
$$("[data-vista]").forEach((b) => b.addEventListener("click", () => irA(b.dataset.vista as Vista)));

// ---------- catálogo ----------

const filtro = { texto: "", marca: "", genero: "" as Genero | "" };

function miniLogo(marca: string): string {
  const url = urlLogoMarca(marca);
  if (url) return `<span class="mini-logo"><img src="${esc(url)}" alt="" loading="lazy" /></span>`;
  const iniciales = marca.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return `<span class="mini-logo vacio">${esc(iniciales || "?")}</span>`;
}

function perfumesFiltrados(): Perfume[] {
  const t = slugMarca(filtro.texto);
  return estado.perfumes
    .filter((p) => !filtro.marca || p.marca === filtro.marca)
    .filter((p) => !filtro.genero || p.genero === filtro.genero)
    .filter((p) => !t || slugMarca(`${p.nombre} ${p.marca} ${p.nota}`).includes(t))
    .sort((a, b) => a.marca.localeCompare(b.marca, "es") || a.nombre.localeCompare(b.nombre, "es"));
}

function vistaCatalogo(): void {
  const marcas = marcasDelCatalogo();
  $("#vista").innerHTML = `
    <section class="filtros">
      <input type="search" id="f-buscar" placeholder="Buscar perfume, marca o nota…" value="${esc(filtro.texto)}" />
      <select id="f-marca">
        <option value="">Todas las marcas</option>
        ${marcas.map((m) => `<option ${m === filtro.marca ? "selected" : ""}>${esc(m)}</option>`).join("")}
      </select>
      <div class="segmentado" id="f-genero">
        ${["", ...GENEROS].map((g) => `<button type="button" data-g="${g}" class="${g === filtro.genero ? "activa" : ""}">${g || "Todos"}</button>`).join("")}
      </div>
    </section>
    <div class="lista-cabecera">
      <span id="conteo"></span>
      <button type="button" class="btn" id="btn-nuevo">+ Nuevo perfume</button>
    </div>
    <ul class="lista" id="lista"></ul>`;

  const pintarLista = () => {
    const lista = perfumesFiltrados();
    $("#conteo").textContent = `${lista.length} perfume${lista.length === 1 ? "" : "s"}`;
    $("#lista").innerHTML = lista.length
      ? lista
          .map(
            (p) => `
        <li><button type="button" class="fila" data-id="${esc(p.id)}">
          ${miniLogo(p.marca)}
          <span class="info">
            <strong>${esc(p.nombre)}</strong>
            <small>${esc(p.marca)} · ${esc(p.genero)}${p.nota ? ` · <em>${esc(p.nota)}</em>` : ""}</small>
          </span>
        </button></li>`,
          )
          .join("")
      : `<li class="vacio-lista">No hay perfumes con esos filtros.</li>`;
  };
  pintarLista();

  $<HTMLInputElement>("#f-buscar").addEventListener("input", (e) => {
    filtro.texto = (e.target as HTMLInputElement).value;
    pintarLista();
  });
  $<HTMLSelectElement>("#f-marca").addEventListener("change", (e) => {
    filtro.marca = (e.target as HTMLSelectElement).value;
    pintarLista();
  });
  $$("#f-genero button").forEach((b) =>
    b.addEventListener("click", () => {
      filtro.genero = b.dataset.g as Genero | "";
      $$("#f-genero button").forEach((x) => x.classList.toggle("activa", x === b));
      pintarLista();
    }),
  );
  $("#btn-nuevo").addEventListener("click", () => abrirEditor(null));
  $("#lista").addEventListener("click", (e) => {
    const fila = (e.target as HTMLElement).closest<HTMLElement>(".fila");
    const p = estado.perfumes.find((x) => x.id === fila?.dataset.id);
    if (p) abrirImpresion(p);
  });
}

// ---------- diálogo de impresión ----------

/** Último volumen elegido: se propone de nuevo al abrir otro perfume. */
let ultimoVolumen = "";
/** Si la última vez se usó "2 en 1" con las etiquetas cortas. */
let ultimoDosEnUno = false;

/** Opciones del selector de segunda etiqueta, agrupadas por marca. */
function opcionesPerfumes(): string {
  const porMarca = new Map<string, Perfume[]>();
  for (const x of [...estado.perfumes].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))) {
    const lista = porMarca.get(x.marca) ?? [];
    lista.push(x);
    porMarca.set(x.marca, lista);
  }
  return [...porMarca.keys()]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map(
      (m) =>
        `<optgroup label="${esc(m || "Sin marca")}">${porMarca
          .get(m)!
          .map((x) => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`)
          .join("")}</optgroup>`,
    )
    .join("");
}

function abrirImpresion(p: Perfume): void {
  const dlg = $<HTMLDialogElement>("#dlg-imprimir");
  const vols = estado.ajustes.volumenes.map(String);
  let volumen = vols.includes(ultimoVolumen) ? ultimoVolumen : (vols[0] ?? "5");

  dlg.innerHTML = `
    <form method="dialog" class="dialogo-contenido">
      <header class="dialogo-cabecera">
        <div><h2>${esc(p.nombre)}</h2><small>${esc(p.marca)} · ${esc(p.genero)}</small></div>
        <button class="cerrar" value="cerrar" aria-label="Cerrar">×</button>
      </header>
      <div class="imprimir-cuerpo">
        <figure class="vista-previa"><div class="papel"><canvas id="i-previa"></canvas></div><figcaption>12 × 40 mm</figcaption></figure>
        <div class="controles">
          <label class="etiqueta-campo">Volumen</label>
          <div class="segmentado volumenes" id="i-vol">
            ${vols.map((v) => `<button type="button" data-v="${v}">${v} ml</button>`).join("")}
          </div>
          <div class="par" id="i-par" hidden>
            <label class="check"><input type="checkbox" id="i-dos" ${ultimoDosEnUno ? "checked" : ""} /> 2 en 1: dos etiquetas cortas en una</label>
            <label class="par-segunda" id="i-segunda-campo">Segunda etiqueta
              <select id="i-segunda">
                <option value="">El mismo perfume</option>
                ${opcionesPerfumes()}
              </select>
            </label>
            <small class="ayuda">Se imprimen una debajo de la otra, con una línea punteada para cortar.</small>
          </div>
          <label class="etiqueta-campo" for="i-cant">Cantidad de etiquetas</label>
          <div class="stepper">
            <button type="button" data-paso="-1" aria-label="Menos">−</button>
            <input id="i-cant" type="number" min="1" max="99" value="1" inputmode="numeric" />
            <button type="button" data-paso="1" aria-label="Más">+</button>
          </div>
          <button type="button" class="btn primario grande" id="i-imprimir">Imprimir</button>
          <p class="progreso" id="i-progreso"></p>
          <div class="acciones-sec">
            <button type="button" class="btn" id="i-editar">Editar perfume</button>
            <button type="button" class="btn" id="i-png">Descargar PNG</button>
          </div>
        </div>
      </div>
    </form>`;

  const datos = (): DatosEtiqueta => ({ nombre: p.nombre, marca: p.marca, volumen });
  const canvas = $<HTMLCanvasElement>("#i-previa", dlg);
  const cant = $<HTMLInputElement>("#i-cant", dlg);
  const dos = $<HTMLInputElement>("#i-dos", dlg);
  const segunda = $<HTMLSelectElement>("#i-segunda", dlg);
  /** Segunda etiqueta del "2 en 1" (null si no aplica). */
  const pareja = (): DatosEtiqueta | null => {
    if (!esCorta(volumen, estado.ajustes) || !dos.checked) return null;
    const otro = estado.perfumes.find((x) => x.id === segunda.value) ?? p;
    return { nombre: otro.nombre, marca: otro.marca, volumen };
  };
  const actualizar = () => {
    $$("#i-vol button", dlg).forEach((b) => b.classList.toggle("activa", b.dataset.v === volumen));
    $("#i-par", dlg).hidden = !esCorta(volumen, estado.ajustes);
    $("#i-segunda-campo", dlg).hidden = !dos.checked;
    void pintarVistaPrevia(canvas, datos(), pareja());
  };
  actualizar();

  $$("#i-vol button", dlg).forEach((b) =>
    b.addEventListener("click", () => {
      volumen = ultimoVolumen = b.dataset.v!;
      actualizar();
    }),
  );
  dos.addEventListener("change", () => {
    ultimoDosEnUno = dos.checked;
    actualizar();
  });
  segunda.addEventListener("change", actualizar);
  $$(".stepper button", dlg).forEach((b) =>
    b.addEventListener("click", () => {
      cant.value = String(Math.min(99, Math.max(1, (parseInt(cant.value, 10) || 1) + Number(b.dataset.paso))));
    }),
  );
  $("#i-editar", dlg).addEventListener("click", () => {
    dlg.close();
    abrirEditor(p);
  });
  $("#i-png", dlg).addEventListener("click", () => void descargarPng(datos(), pareja()));
  $("#i-imprimir", dlg).addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const progreso = $("#i-progreso", dlg);
    btn.disabled = true;
    progreso.textContent = "Enviando a la impresora…";
    const ok = await imprimir(
      datos(),
      Math.max(1, parseInt(cant.value, 10) || 1),
      (t) => (progreso.textContent = t),
      pareja(),
    );
    btn.disabled = false;
    progreso.textContent = "";
    if (ok) dlg.close();
  });
  dlg.showModal();
}

// ---------- editor de perfume ----------

function abrirEditor(p: Perfume | null): void {
  const dlg = $<HTMLDialogElement>("#dlg-perfume");
  dlg.innerHTML = `
    <form class="dialogo-contenido formulario" id="form-perfume">
      <header class="dialogo-cabecera">
        <h2>${p ? "Editar perfume" : "Nuevo perfume"}</h2>
        <button type="button" class="cerrar" id="e-cerrar" aria-label="Cerrar">×</button>
      </header>
      <label>Nombre<input name="nombre" required value="${esc(p?.nombre)}" autocomplete="off" /></label>
      <label>Marca<input name="marca" list="lista-marcas" value="${esc(p?.marca)}" autocomplete="off" /></label>
      <datalist id="lista-marcas">${marcasDelCatalogo().map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
      <label>Género
        <select name="genero">${GENEROS.map((g) => `<option ${g === (p?.genero ?? "Unisex") ? "selected" : ""}>${g}</option>`).join("")}</select>
      </label>
      <label>Nota interna <small>(no se imprime)</small><input name="nota" value="${esc(p?.nota)}" /></label>
      <footer class="dialogo-pie">
        ${p ? `<button type="button" class="btn peligro" id="e-borrar">Eliminar</button>` : "<span></span>"}
        <button type="submit" class="btn primario">Guardar</button>
      </footer>
    </form>`;

  const form = $<HTMLFormElement>("#form-perfume", dlg);
  $("#e-cerrar", dlg).addEventListener("click", () => dlg.close());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const datos = {
      nombre: String(f.get("nombre")).trim(),
      marca: String(f.get("marca")).trim(),
      genero: f.get("genero") as Genero,
      nota: String(f.get("nota")).trim(),
    };
    if (p) Object.assign(p, datos);
    else estado.perfumes.push({ id: nuevoId(), activo: true, ...datos });
    guardarPerfumes();
    dlg.close();
    aviso("Perfume guardado");
    vistas[vistaActual]();
  });
  $("#e-borrar", dlg)?.addEventListener("click", () => {
    if (!p || !confirm(`¿Eliminar "${p.nombre}" del catálogo?`)) return;
    estado.perfumes = estado.perfumes.filter((x) => x.id !== p.id);
    guardarPerfumes();
    dlg.close();
    aviso("Perfume eliminado");
    vistas[vistaActual]();
  });
  dlg.showModal();
}

// ---------- etiqueta rápida ----------

const rapida: DatosEtiqueta & { cantidad: number } = { nombre: "", marca: "", volumen: "5", cantidad: 1 };

function vistaRapida(): void {
  $("#vista").innerHTML = `
    <section class="tarjeta rapida">
      <form class="formulario" id="form-rapida">
        <p class="ayuda">Imprime una etiqueta sin guardarla en el catálogo.</p>
        <label>Nombre del perfume<input name="nombre" value="${esc(rapida.nombre)}" placeholder="Ej. Khamrah" autocomplete="off" /></label>
        <label>Marca<input name="marca" list="lista-marcas-r" value="${esc(rapida.marca)}" placeholder="Ej. Lattafa" autocomplete="off" /></label>
        <datalist id="lista-marcas-r">${marcasDelCatalogo().map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
        <label>Volumen <small>(número en ml o texto libre)</small><input name="volumen" value="${esc(rapida.volumen)}" /></label>
        <label>Cantidad<input name="cantidad" type="number" min="1" max="99" value="${rapida.cantidad}" inputmode="numeric" /></label>
        <button type="submit" class="btn primario grande">Imprimir</button>
        <p class="progreso" id="r-progreso"></p>
        <button type="button" class="btn" id="r-png">Descargar PNG</button>
      </form>
      <figure class="vista-previa"><div class="papel"><canvas id="r-previa"></canvas></div><figcaption>12 × 40 mm</figcaption></figure>
    </section>`;
  const form = $<HTMLFormElement>("#form-rapida");
  const canvas = $<HTMLCanvasElement>("#r-previa");
  const leer = () => {
    const f = new FormData(form);
    rapida.nombre = String(f.get("nombre"));
    rapida.marca = String(f.get("marca"));
    rapida.volumen = String(f.get("volumen"));
    rapida.cantidad = Math.max(1, parseInt(String(f.get("cantidad")), 10) || 1);
  };
  const previa = () => void pintarVistaPrevia(canvas, { ...rapida, nombre: rapida.nombre || "Nombre del perfume" });
  previa();
  form.addEventListener("input", () => {
    leer();
    previa();
  });
  $("#r-png").addEventListener("click", () => void descargarPng(rapida));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    leer();
    if (!rapida.nombre.trim()) return aviso("Escribe el nombre del perfume", "error");
    const btn = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    const progreso = $("#r-progreso");
    btn.disabled = true;
    progreso.textContent = "Enviando a la impresora…";
    await imprimir({ ...rapida }, rapida.cantidad, (t) => (progreso.textContent = t));
    btn.disabled = false;
    progreso.textContent = "";
  });
}

// ---------- ajustes ----------

function nombreTipo(t: number | undefined): string {
  if (!t) return "—";
  return TIPOS_ETIQUETA[t] ?? `Tipo ${t}`;
}

/** Datos de la impresora conectada y del rollo, para diagnosticar. */
function tablaImpresora(i: InfoImpresora | null): string {
  if (!i) return `<p class="ayuda">Conecta la impresora para ver su modelo y los datos del rollo de etiquetas.</p>`;
  const mm = (v?: number) => (v ? `${v.toLocaleString("es")} mm` : "—");
  const usado = impresora.tipoEtiqueta(estado.ajustes.tipoEtiqueta);
  const filas: [string, string][] = [
    ["Modelo", `${i.modelo} · ${i.dpi} DPI · cabezal ${i.cabezal} px`],
    ["Firmware / hardware", `${i.firmware ?? "—"} / ${i.hardware ?? "—"} · protocolo ${i.protocolo ?? "—"}`],
    ["Modo automático", i.tareaAuto],
    ["Rollo (RFID)", i.rollo.rfid ? `${nombreTipo(i.rollo.tipo)}${i.rollo.codigo ? ` · ${i.rollo.codigo}` : ""}` : "No se leyó el RFID"],
    ["Medida del rollo", i.rollo.largoMm ? `${mm(i.rollo.anchoMm)} × ${mm(i.rollo.largoMm)}, hueco ${mm(i.rollo.huecoMm)}` : "—"],
    ["Tipo que se usará", nombreTipo(usado)],
  ];
  return `<dl class="info-impresora">${filas.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}

const NOMBRES_PAUSA: Record<(typeof PAUSAS_ENVIO)[number], string> = {
  10: "Normal (la más segura)",
  5: "Rápida",
  2: "Muy rápida",
  0: "Máxima (experimental)",
};

function vistaAjustes(): void {
  const a = estado.ajustes;
  const marcas = marcasDelCatalogo();
  const base = estado.perfumes[0] ?? { nombre: "Nombre del perfume", marca: "Marca" };
  const volCorto = String(a.volumenesCortos[0] ?? "");
  const volLargo = String(a.volumenes.find((v) => !a.volumenesCortos.includes(v)) ?? 5);
  const ejemplos: DatosEtiqueta[] = [
    { nombre: base.nombre, marca: base.marca, volumen: volLargo },
    ...(volCorto ? [{ nombre: base.nombre, marca: base.marca, volumen: volCorto }] : []),
  ];
  const resIdx = RESOLUCIONES.findIndex((r) => r.dpi === a.resolucion.dpi && r.cabezal === a.resolucion.cabezal);

  $("#vista").innerHTML = `
    <section class="tarjeta ajustes-etiqueta">
      <div class="formulario">
        <h2>Etiqueta</h2>
        <label>Resolución de la impresora <small>(se detecta sola al conectar)</small>
          <select id="a-resolucion">
            ${RESOLUCIONES.map((r, i) => `<option value="${i}" ${i === resIdx ? "selected" : ""}>${esc(r.modelo)} · ${r.dpi} DPI</option>`).join("")}
            ${resIdx < 0 ? `<option selected>${esc(a.resolucion.modelo)} · ${a.resolucion.dpi} DPI (detectada)</option>` : ""}
          </select>
        </label>
        <label>Largo de impresión <small>(la etiqueta mide 40 mm)</small>
          <select id="a-largo">
            ${[36, 37, 38, 39, 40].map((mm) => `<option value="${mm}" ${mm === a.largoMm ? "selected" : ""}>${mm} mm${mm === 38 ? " (recomendado)" : ""}</option>`).join("")}
          </select>
          <small>Si después de cada etiqueta sale otra en blanco, baja este valor.</small>
        </label>
        <label>Margen superior <small>(para centrar el diseño)</small>
          <select id="a-margen">
            ${[0, 0.5, 1, 1.5, 2, 2.5, 3].map((mm) => `<option value="${mm}" ${mm === a.margenSuperiorMm ? "selected" : ""}>${mm.toLocaleString("es")} mm${mm === 2 ? " (centrado)" : ""}</option>`).join("")}
          </select>
          <small>Abajo quedan ${(40 - a.largoMm).toLocaleString("es")} mm sin imprimir. Si sale muy arriba, súbelo; si sale muy abajo, bájalo.</small>
        </label>
        <label>Etiqueta corta (media etiqueta) para <small>(ml, separados por coma)</small>
          <input id="a-cortos" value="${esc(a.volumenesCortos.join(", "))}" placeholder="Ninguno" />
        </label>
        <label class="check"><input type="checkbox" data-a="marco" ${a.marco ? "checked" : ""} /> Marco decorativo</label>
        <label class="check"><input type="checkbox" data-a="mayusculas" ${a.mayusculas ? "checked" : ""} /> Nombre en mayúsculas</label>
        <label class="check"><input type="checkbox" data-a="invertir" ${a.invertir ? "checked" : ""} /> Girar 180° (si sale al revés)</label>
        <label>Velocidad de envío
          <select id="a-pausa">
            ${PAUSAS_ENVIO.map((ms) => `<option value="${ms}" ${ms === a.pausaEnvioMs ? "selected" : ""}>${NOMBRES_PAUSA[ms]}</option>`).join("")}
          </select>
          <small>Si con una velocidad mayor la etiqueta sale cortada, incompleta o no imprime, vuelve a la anterior.</small>
        </label>
        <label>Densidad de impresión
          <select id="a-densidad">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${d === a.densidad ? "selected" : ""}>${d}${d === 1 ? " (claro)" : d === 5 ? " (más oscuro)" : ""}</option>`).join("")}</select>
          <small>La D11 acepta 1–3 y la D11-H 1–5; si eliges más, se usa el máximo de tu modelo.</small>
        </label>
      </div>
      <div class="ejemplos">
        ${ejemplos.map((e, i) => `<figure class="vista-previa"><div class="papel"><canvas data-ejemplo="${i}"></canvas></div><figcaption>${esc(e.volumen)} ml</figcaption></figure>`).join("")}
      </div>
    </section>

    <section class="tarjeta formulario">
      <h2>Impresora</h2>
      ${tablaImpresora(impresora.info())}
      <label>Tipo de etiqueta
        <select id="a-tipo">
          <option value="auto" ${a.tipoEtiqueta === "auto" ? "selected" : ""}>Automático (el que informa el rollo)</option>
          ${Object.entries(TIPOS_ETIQUETA).map(([v, n]) => `<option value="${v}" ${String(a.tipoEtiqueta) === v ? "selected" : ""}>${esc(n)}</option>`).join("")}
        </select>
        <small>Si después de imprimir la impresora avanza de más y deja una etiqueta vacía, prueba otro tipo (p. ej. Transparente).</small>
      </label>
      <label>Modo de impresión <small>(avanzado)</small>
        <select id="a-tarea">
          <option value="auto" ${a.tareaImpresion === "auto" ? "selected" : ""}>Automático</option>
          ${TAREAS_IMPRESION.map((t) => `<option value="${t}" ${a.tareaImpresion === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <small>Cambia la forma en que se le habla a la impresora. Déjalo en Automático salvo para pruebas.</small>
      </label>
    </section>

    <section class="tarjeta">
      <h2>Logo de la tienda</h2>
      <div class="logo-tienda">
        <span class="logo-caja"><img src="${esc(urlLogoTienda())}" alt="Logo de la tienda" /></span>
        <div class="acciones-sec">
          <button type="button" class="btn" id="a-logo-subir">Cambiar logo</button>
          ${a.logoTienda ? `<button type="button" class="btn" id="a-logo-quitar">Usar el logo incluido</button>` : ""}
        </div>
      </div>
      <p class="ayuda">Acepta PNG, JPG, WEBP o SVG. Se recorta al contenido y se convierte a blanco y negro.</p>
    </section>

    <section class="tarjeta">
      <h2>Logos de marcas</h2>
      <p class="ayuda">Las marcas sin logo se imprimen con su nombre en texto.</p>
      <ul class="logos-marca">
        ${marcas
          .map((m) => {
            const url = urlLogoMarca(m);
            const propio = !!a.logosMarca[slugMarca(m)];
            return `<li>
              <span class="logo-caja">${url ? `<img src="${esc(url)}" alt="" loading="lazy" />` : `<span class="sin-logo">Sin logo</span>`}</span>
              <span class="nombre-marca">${esc(m)}</span>
              <span class="acciones-sec">
                <button type="button" class="btn" data-subir="${esc(m)}">${url ? "Cambiar" : "Subir"}</button>
                ${propio ? `<button type="button" class="btn" data-quitar="${esc(m)}">Quitar</button>` : ""}
              </span>
            </li>`;
          })
          .join("")}
      </ul>
    </section>

    <section class="tarjeta formulario">
      <h2>Volúmenes</h2>
      <label>Volúmenes en ml <small>(separados por coma)</small><input id="a-vols" value="${esc(a.volumenes.join(", "))}" /></label>
    </section>

    <section class="tarjeta">
      <h2>Datos</h2>
      <div class="acciones-sec envolver">
        <button type="button" class="btn" id="d-respaldo">Descargar respaldo (JSON)</button>
        <button type="button" class="btn" id="d-restaurar">Restaurar respaldo</button>
        <button type="button" class="btn" id="d-csv-in">Importar CSV</button>
        <button type="button" class="btn" id="d-csv-out">Exportar CSV</button>
        <button type="button" class="btn peligro" id="d-reset">Restaurar catálogo inicial</button>
      </div>
      <p class="ayuda">CSV: columnas <code>nombre, marca, genero, nota</code>. Los perfumes importados se agregan al catálogo.</p>
    </section>`;

  const repintar = () =>
    $$<HTMLCanvasElement>("[data-ejemplo]").forEach((c) => void pintarVistaPrevia(c, ejemplos[Number(c.dataset.ejemplo)]));
  repintar();

  $<HTMLSelectElement>("#a-resolucion").addEventListener("change", (e) => {
    const r = RESOLUCIONES[Number((e.target as HTMLSelectElement).value)];
    if (!r) return;
    a.resolucion = r;
    guardarAjustes();
    repintar();
  });
  $<HTMLSelectElement>("#a-tipo").addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    a.tipoEtiqueta = v === "auto" ? "auto" : Number(v);
    guardarAjustes();
    vistaAjustes();
  });
  $<HTMLSelectElement>("#a-tarea").addEventListener("change", (e) => {
    a.tareaImpresion = (e.target as HTMLSelectElement).value;
    guardarAjustes();
  });
  $<HTMLSelectElement>("#a-pausa").addEventListener("change", (e) => {
    a.pausaEnvioMs = Number((e.target as HTMLSelectElement).value);
    guardarAjustes();
  });
  $<HTMLSelectElement>("#a-largo").addEventListener("change", (e) => {
    a.largoMm = Number((e.target as HTMLSelectElement).value);
    guardarAjustes();
    vistaAjustes();
  });
  $<HTMLSelectElement>("#a-margen").addEventListener("change", (e) => {
    a.margenSuperiorMm = Number((e.target as HTMLSelectElement).value);
    guardarAjustes();
    repintar();
  });
  $<HTMLInputElement>("#a-cortos").addEventListener("change", () => {
    a.volumenesCortos = [...new Set(leerNumeros($<HTMLInputElement>("#a-cortos").value))];
    guardarAjustes();
    vistaAjustes();
  });
  $$<HTMLInputElement>("[data-a]").forEach((inp) =>
    inp.addEventListener("change", () => {
      (a as unknown as Record<string, boolean>)[inp.dataset.a!] = inp.checked;
      guardarAjustes();
      repintar();
    }),
  );
  $<HTMLSelectElement>("#a-densidad").addEventListener("change", (e) => {
    a.densidad = Number((e.target as HTMLSelectElement).value);
    guardarAjustes();
  });
  $<HTMLInputElement>("#a-vols").addEventListener("change", (e) => {
    const vols = leerNumeros((e.target as HTMLInputElement).value);
    a.volumenes = vols.length ? [...new Set(vols)].sort((x, y) => x - y) : AJUSTES_DEFECTO.volumenes;
    guardarAjustes();
    aviso("Volúmenes guardados");
  });

  const subirLogo = async (alGuardar: (dataUrl: string) => void) => {
    const archivo = await leerArchivo("image/*");
    if (!archivo) return;
    try {
      alGuardar(await procesarLogoSubido(archivo));
      guardarAjustes();
      aviso("Logo actualizado");
      vistaAjustes();
    } catch (e) {
      aviso(mensajeError(e), "error");
    }
  };
  $("#a-logo-subir").addEventListener("click", () => subirLogo((d) => (a.logoTienda = d)));
  document.getElementById("a-logo-quitar")?.addEventListener("click", () => {
    a.logoTienda = null;
    guardarAjustes();
    vistaAjustes();
  });
  $$("[data-subir]").forEach((b) =>
    b.addEventListener("click", () => subirLogo((d) => (a.logosMarca[slugMarca(b.dataset.subir!)] = d))),
  );
  $$("[data-quitar]").forEach((b) =>
    b.addEventListener("click", () => {
      delete a.logosMarca[slugMarca(b.dataset.quitar!)];
      guardarAjustes();
      vistaAjustes();
    }),
  );

  $("#d-respaldo").addEventListener("click", () =>
    descargarTexto(
      `respaldo-decants-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ version: 2, ...estado }, null, 2),
      "application/json",
    ),
  );
  $("#d-restaurar").addEventListener("click", async () => {
    const archivo = await leerArchivo(".json,application/json");
    if (!archivo) return;
    try {
      const datos = JSON.parse(await archivo.text());
      if (!Array.isArray(datos.perfumes)) throw new Error("El archivo no es un respaldo válido");
      if (!confirm(`Se reemplazará el catálogo actual por ${datos.perfumes.length} perfumes. ¿Continuar?`)) return;
      reemplazarPerfumes(datos.perfumes);
      estado.ajustes = { ...AJUSTES_DEFECTO, ...(datos.ajustes ?? {}) };
      guardarAjustes();
      aviso("Respaldo restaurado");
      vistaAjustes();
    } catch (e) {
      aviso(mensajeError(e), "error");
    }
  });
  $("#d-csv-in").addEventListener("click", async () => {
    const archivo = await leerArchivo(".csv,text/csv");
    if (!archivo) return;
    try {
      const nuevos = perfumesDesdeCsv(await archivo.text());
      const existe = new Set(estado.perfumes.map((p) => slugMarca(`${p.marca} ${p.nombre}`)));
      const agregar = nuevos.filter((p) => !existe.has(slugMarca(`${p.marca} ${p.nombre}`)));
      estado.perfumes.push(...agregar);
      guardarPerfumes();
      aviso(`${agregar.length} perfumes agregados${nuevos.length - agregar.length ? ` (${nuevos.length - agregar.length} repetidos omitidos)` : ""}`);
      vistaAjustes();
    } catch (e) {
      aviso(mensajeError(e), "error");
    }
  });
  $("#d-csv-out").addEventListener("click", () =>
    descargarTexto("catalogo-decants.csv", perfumesACsv(estado.perfumes), "text/csv"),
  );
  $("#d-reset").addEventListener("click", () => {
    if (!confirm("Se reemplazará el catálogo por el catálogo inicial. ¿Continuar?")) return;
    estado.perfumes = catalogoPorDefecto();
    guardarPerfumes();
    aviso("Catálogo restaurado");
    vistaAjustes();
  });
}

// ---------- arranque ----------

async function iniciar(): Promise<void> {
  await cargarLogosIncluidos();
  let inicial: Vista = "catalogo";
  try {
    const v = sessionStorage.getItem("etq.vista") as Vista | null;
    if (v && v in vistas) inicial = v;
  } catch { /* sin almacenamiento */ }
  irA(inicial);
  if (!impresora.disponible) {
    aviso("Este navegador no puede usar Bluetooth. Abre la app en Chrome (Android) o Chrome/Edge (PC).", "error");
  }
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => undefined);
  }
}

void iniciar();
