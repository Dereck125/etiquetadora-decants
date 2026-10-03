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
import { diagnosticarBle, diagnosticarSerie } from "./diagnostico";
import {
  GUIA_PREVIA_MM,
  areaImprimibleU1,
  calcularCalibracionU1,
  lienzoEtiquetaU1,
  lienzoGuiaU1,
  lienzoPruebaU1,
  lienzoReglaU1,
  u1,
} from "./u1";
import { CANAL, PREFIJO } from "./entorno";
import { esCorta, lienzoImpresion, renderizarEtiqueta, renderizarEtiquetaHorizontal } from "./etiqueta";
import {
  impresora,
  PAUSAS_ENVIO,
  TAREAS_IMPRESION,
  TIPOS_ETIQUETA,
  type InfoImpresora,
  type TiemposImpresion,
} from "./impresora";
import {
  cargarImagen,
  cargarLogosIncluidos,
  procesarLogoSubido,
  slugMarca,
  urlLogoMarca,
  urlLogoTienda,
} from "./marcas";
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
  try { sessionStorage.setItem(`${PREFIJO}vista`, v); } catch { /* sin almacenamiento */ }
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

// ---------- impresora U1 (pruebas) ----------

function seccionU1(): string {
  const o = estado.ajustes.u1;
  const opc = (valores: (string | number)[], actual: string | number, nombre = (v: string | number) => String(v)) =>
    valores
      .map((v) => `<option value="${v}" ${String(v) === String(actual) ? "selected" : ""}>${esc(nombre(v))}</option>`)
      .join("");
  const avances: Record<string, string> = {
    hueco: "Buscar el hueco (sensor)",
    fijo: "Fijo (mm)",
    timini: "Como TiMini (12 mm)",
  };
  return `<section class="tarjeta formulario" id="sec-u1">
      <h2>Impresora U1 <small>(pruebas)</small></h2>
      <p class="ayuda">Imprime una etiqueta de calibración: un marco justo en el borde de la etiqueta y una flecha
        "ARRIBA". Sirve para ajustar el centrado y cómo avanza hasta la siguiente etiqueta.</p>
      <div class="acciones-sec envolver">
        <button type="button" class="btn" id="u1-conectar">${u1.conectada ? `Conectada: ${esc(u1.nombre)}` : "Conectar U1"}</button>
        <button type="button" class="btn primario" id="u1-imprimir">Imprimir prueba</button>
        <button type="button" class="btn" id="u1-regla">Imprimir regla</button>
        <button type="button" class="btn" id="u1-avanzar">Avanzar a la siguiente etiqueta</button>
      </div>
      <p class="progreso" id="u1-progreso"></p>
      <div class="calibrador">
        <h3>Calibrar paso a paso</h3>
        <ol>
          <li>Pon el rollo derecho y con las guías ajustadas. <b>Arranca todo lo que ya esté impreso</b>: deben
            quedar solo etiquetas en blanco (si no, la impresora puede imprimir encima). Conecta la U1.</li>
          <li><button type="button" class="btn" id="cal-guia">Imprimir guía de calibración</button>
            <small>Imprímela <b>una sola vez</b>. Sale una regla horizontal con números (mm) y una vertical
            con marcas 0, +2, +4… (el 0 debería quedar justo en el borde de arriba).</small></li>
          <li>En la etiqueta con la guía, lee qué número queda justo en cada borde. Cada rayita es 1 mm: si el borde
            cae 1 rayita antes del 10, escribe 9. Si el borde queda más allá del último número (48), escribe 49.
            Borde de arriba: si el borde corta la regla vertical, elige la marca que queda en el borde (p. ej. +2).
            Si arriba del 0 queda espacio en blanco, elige cuántos mm de blanco hay en negativo (2 mm → −2).
            <div class="u1-grid">
              <label>Borde izquierdo<input type="number" id="cal-izq" step="0.5" inputmode="decimal" placeholder="p. ej. 8" /></label>
              <label>Borde derecho<input type="number" id="cal-der" step="0.5" inputmode="decimal" placeholder="p. ej. 48" /></label>
              <label>Borde de arriba <small>(regla vertical)</small><select id="cal-arriba">
                ${Array.from({ length: 33 }, (_, i) => (i - 16) / 2)
                  .map((v) => `<option value="${v}" ${v === 0 ? "selected" : ""}>${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("es")}</option>`)
                  .join("")}
              </select></label>
            </div>
            <button type="button" class="btn primario" id="cal-aplicar">Aplicar calibración</button>
            <p class="ayuda" id="cal-resultado"></p></li>
          <li>Imprime la <b>prueba</b> (botón de arriba): el marco debe caer en el borde de la etiqueta.</li>
          <li>Si al terminar hay que jalar un poco la etiqueta para arrancarla, es normal en esta impresora
            (la app original hace lo mismo). Puedes sumar avance extra, pero la siguiente impresión tendrá que
            retroceder más y puede quedar menos precisa.
            <div class="acciones-sec envolver">
              <button type="button" class="btn" id="cal-falta">Avanzar más al terminar (+1 mm)</button>
              <button type="button" class="btn" id="cal-sobra">Avanzar menos (−1 mm)</button>
              <button type="button" class="btn" id="cal-restablecer">Restablecer calibración</button>
            </div></li>
        </ol>
      </div>
      <div class="calibrador">
        <h3>Etiqueta de prueba</h3>
        <div class="u1-grid">
          <label>Perfume<select id="e30-perfume">${opcionesPerfumes()}</select></label>
          <label>Volumen (ml)<input id="e30-vol" value="30" inputmode="numeric" /></label>
        </div>
        <figure class="vista-previa"><canvas id="e30-previa" class="u1-previa"></canvas>
          <figcaption>Así sale en el cabezal (la zona blanca a los lados no es etiqueta)</figcaption></figure>
        <button type="button" class="btn primario" id="e30-imprimir">Imprimir etiqueta</button>
      </div>
      <details class="u1-avanzado">
      <summary>Ajustes manuales</summary>
      <div class="u1-grid">
        <label>Ancho (mm)<input type="number" data-u1="anchoMm" value="${o.anchoMm}" min="15" max="48" /></label>
        <label>Alto (mm)<input type="number" data-u1="altoMm" value="${o.altoMm}" min="10" max="100" /></label>
        <label>Desplazamiento (px, 8 = 1 mm)<select data-u1="desplazamiento">${opc(
          // Pasos de 4 px (½ mm), e incluye siempre el valor actual (la calibración puede dar cualquiera).
          [...new Set([...Array.from({ length: 33 }, (_, i) => (i - 16) * 4), o.desplazamiento])].sort((a, b) => a - b),
          o.desplazamiento,
        )}</select></label>
        <label>Densidad<select data-u1="densidad">${opc([1, 2, 3, 4, 5], o.densidad)}</select></label>
        <label>Energía (calor)<select data-u1="energia">${opc([8000, 10000, 12000, 14000, 16000, 20000], o.energia, (v) =>
          `${v}${Number(v) === 20000 ? " (original)" : Number(v) === 12000 ? " (más rápido)" : ""}`)}</select></label>
        <label>Velocidad <small>(menor = más rápido)</small><select data-u1="velocidad">${opc([5, 6, 8, 10, 15, 20], o.velocidad, (v) =>
          `${v}${Number(v) === 10 ? " (original)" : ""}`)}</select></label>
        <label>Avance al terminar<select data-u1="avance">${opc(Object.keys(avances), o.avance, (v) => avances[String(v)])}</select></label>
        <label>mm de avance<input type="number" data-u1="avanceMm" value="${o.avanceMm}" min="0" max="60" /></label>
        <label>Modo BE<select data-u1="modoBE">${opc([0, 1], o.modoBE, (v) => (Number(v) === 0 ? "0 (imagen)" : "1 (texto/etiqueta)"))}</select></label>
        <label>Bloque BLE<select data-u1="bloque">${opc([20, 100, 180], o.bloque, (v) => `${v} bytes`)}</select></label>
        <label>Avance para arrancar (mm)<input type="number" data-u1="extraMm" value="${o.extraMm}" min="0" max="20" step="0.5" /></label>
        <label>Corrección de inicio (mm)<input type="number" data-u1="inicioMm" value="${o.inicioMm}" min="0" max="15" step="0.5" /></label>
      </div>
      </details>
      <figure class="vista-previa"><canvas id="u1-previa" class="u1-previa"></canvas><figcaption>Vista previa (384 puntos de ancho)</figcaption></figure>
      <pre class="diag-salida" id="u1-avisos">${esc(u1.avisos.join("\n") || "Avisos de la impresora: —")}</pre>
    </section>`;
}

function enlazarU1(): void {
  const o = estado.ajustes.u1;
  const previa = () => {
    void cargarImagen(urlLogoTienda()).then((logo) => {
      const c = lienzoPruebaU1(o.anchoMm, o.altoMm, o.desplazamiento, logo);
      const destino = document.getElementById("u1-previa") as HTMLCanvasElement | null;
      if (!destino) return;
      destino.width = c.width;
      destino.height = c.height;
      destino.getContext("2d")!.drawImage(c, 0, 0);
    });
  };
  previa();
  $$<HTMLInputElement | HTMLSelectElement>("[data-u1]").forEach((el) =>
    el.addEventListener("change", () => {
      const clave = el.dataset.u1!;
      (o as unknown as Record<string, unknown>)[clave] =
        clave === "avance" ? el.value : Number(el.value);
      guardarAjustes();
      previa();
      // Confirmación visible: el valor se guarda al salir del campo (o al elegir en la lista).
      const nombre = el.closest("label")?.firstChild?.textContent?.trim() || clave;
      const valor = el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent : el.value;
      aviso(`Guardado: ${nombre} = ${valor}`);
    }),
  );
  const avisos = document.getElementById("u1-avisos");
  u1.alAviso = () => {
    if (avisos) avisos.textContent = u1.avisos.join("\n");
  };
  $("#u1-conectar").addEventListener("click", async (e) => {
    try {
      await u1.conectar();
      (e.target as HTMLButtonElement).textContent = `Conectada: ${u1.nombre}`;
      aviso("U1 conectada");
    } catch (err) {
      aviso(mensajeError(err), "error");
    }
  });
  const imprimirU1 = async (btn: HTMLButtonElement, lienzo: () => Promise<HTMLCanvasElement>, retrocesoExtra = 0) => {
    const progreso = $("#u1-progreso");
    btn.disabled = true;
    try {
      const inicio = performance.now();
      await u1.imprimir(await lienzo(), 1, o, (t) => (progreso.textContent = t), retrocesoExtra);
      aviso(`Prueba enviada a la U1 en ${((performance.now() - inicio) / 1000).toFixed(1)} s`);
      $("#u1-conectar").textContent = `Conectada: ${u1.nombre}`;
    } catch (err) {
      aviso("No se pudo imprimir en la U1: " + mensajeError(err), "error");
    } finally {
      btn.disabled = false;
      progreso.textContent = "";
    }
  };
  $("#u1-imprimir").addEventListener("click", (e) =>
    imprimirU1(e.currentTarget as HTMLButtonElement, async () =>
      lienzoPruebaU1(o.anchoMm, o.altoMm, o.desplazamiento, await cargarImagen(urlLogoTienda())),
    ),
  );
  $("#u1-regla").addEventListener("click", (e) =>
    imprimirU1(e.currentTarget as HTMLButtonElement, async () => lienzoReglaU1(o.altoMm)),
  );

  $("#u1-avanzar").addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      await u1.avanzarAlHueco(o);
      aviso("Avance enviado: debería detenerse al inicio de la siguiente etiqueta");
    } catch (err) {
      aviso(mensajeError(err), "error");
    } finally {
      btn.disabled = false;
    }
  });

  // ----- etiqueta de prueba (30 ml) -----
  const lienzoEtiqueta30 = async () => {
    const p = estado.perfumes.find((x) => x.id === ($("#e30-perfume") as HTMLSelectElement).value) ?? estado.perfumes[0];
    const volumen = ($("#e30-vol") as HTMLInputElement).value.trim() || "30";
    const area = areaImprimibleU1(o.anchoMm, o.desplazamiento);
    const etiqueta = await renderizarEtiquetaHorizontal(
      { nombre: p?.nombre ?? "Perfume", marca: p?.marca ?? "", volumen },
      estado.ajustes,
      area.ancho,
      Math.round(o.altoMm * 8),
    );
    return lienzoEtiquetaU1(etiqueta, area.x);
  };
  const previa30 = async () => {
    const c = await lienzoEtiqueta30();
    const destino = document.getElementById("e30-previa") as HTMLCanvasElement | null;
    if (!destino) return;
    destino.width = c.width;
    destino.height = c.height;
    destino.getContext("2d")!.drawImage(c, 0, 0);
  };
  void previa30();
  $("#e30-perfume").addEventListener("change", () => void previa30());
  $("#e30-vol").addEventListener("input", () => void previa30());
  $("#e30-imprimir").addEventListener("click", (e) => imprimirU1(e.currentTarget as HTMLButtonElement, lienzoEtiqueta30));

  // ----- calibrador -----
  $("#cal-guia").addEventListener("click", (e) =>
    imprimirU1(e.currentTarget as HTMLButtonElement, async () => lienzoGuiaU1(o.altoMm), GUIA_PREVIA_MM),
  );
  $("#cal-aplicar").addEventListener("click", () => {
    // El borde de arriba es un <select> (el teclado numérico de Android no tiene signo menos).
    const leer = (id: string) => Number(($(`#${id}`) as HTMLInputElement | HTMLSelectElement).value.replace(",", "."));
    const izq = leer("cal-izq"), der = leer("cal-der"), arriba = leer("cal-arriba");
    const crudo = ["cal-izq", "cal-der"].map((id) => ($(`#${id}`) as HTMLInputElement).value.trim());
    if (crudo.some((v) => v === "") || [izq, der, arriba].some((n) => Number.isNaN(n))) {
      return aviso("Escribe los tres números que leíste en la guía", "error");
    }
    if (der <= izq) return aviso("El borde derecho debe ser mayor que el izquierdo", "error");
    const r = calcularCalibracionU1(o, izq, der, arriba);
    o.desplazamiento = r.desplazamiento;
    o.inicioMm = r.inicioMm;
    guardarAjustes();
    const avisoAncho =
      Math.abs(r.anchoMedidoMm - o.anchoMm) > 1.5
        ? ` Ojo: mediste ${r.anchoMedidoMm} mm de ancho y la etiqueta está configurada en ${o.anchoMm} mm.`
        : "";
    $("#cal-resultado").textContent =
      `Guardado: desplazamiento ${r.desplazamiento} px (${(r.desplazamiento / 8).toFixed(1)} mm), ` +
      `corrección de inicio ${r.inicioMm} mm.${avisoAncho} Ahora imprime la prueba.`;
    aviso("Calibración guardada");
    previa();
  });
  const ajustarExtra = (delta: number) => {
    o.extraMm = Math.max(0, Math.round((o.extraMm + delta) * 2) / 2);
    guardarAjustes();
    aviso(`Avance para arrancar: ${o.extraMm} mm`);
    const campo = document.querySelector<HTMLInputElement>('[data-u1="extraMm"]');
    if (campo) campo.value = String(o.extraMm);
  };
  $("#cal-restablecer").addEventListener("click", () => {
    const d = AJUSTES_DEFECTO.u1;
    Object.assign(o, { desplazamiento: d.desplazamiento, inicioMm: d.inicioMm, extraMm: d.extraMm });
    guardarAjustes();
    aviso(`Calibración restablecida: ${d.desplazamiento} px, inicio ${d.inicioMm} mm, avance extra ${d.extraMm} mm`);
    vistaAjustes();
  });
  $("#cal-falta").addEventListener("click", () => ajustarExtra(1));
  $("#cal-sobra").addEventListener("click", () => ajustarExtra(-1));
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

    ${
      CANAL === "dev"
        ? `<section class="tarjeta formulario">
      <h2>Buscar otra impresora <small>(diagnóstico)</small></h2>
      <p class="ayuda">Cierra la app de la impresora (p. ej. Tiny Print) y enciéndela. Luego:</p>
      <div class="acciones-sec envolver">
        <button type="button" class="btn" id="diag-ble">Buscar por Bluetooth (BLE)</button>
        <button type="button" class="btn" id="diag-serie">Buscar por Bluetooth clásico</button>
      </div>
      <p class="ayuda">"BLE" muestra todos los dispositivos cercanos: elige el que aparezca al encender la impresora.
        "Clásico" solo muestra impresoras ya vinculadas en Ajustes → Bluetooth del teléfono.</p>
      <pre class="diag-salida" id="diag-salida" hidden></pre>
      <button type="button" class="btn" id="diag-copiar" hidden>Copiar resultado</button>
    </section>`
        : ""
    }

    ${CANAL === "dev" ? seccionU1() : ""}

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
  if (CANAL === "dev") enlazarU1();
  const salidaDiag = document.getElementById("diag-salida");
  const diagnosticar = async (fn: () => Promise<string>) => {
    if (!salidaDiag) return;
    salidaDiag.hidden = false;
    salidaDiag.textContent = "Buscando…";
    try {
      salidaDiag.textContent = await fn();
      $("#diag-copiar").hidden = false;
    } catch (e) {
      salidaDiag.textContent = "No se pudo: " + mensajeError(e);
    }
  };
  document.getElementById("diag-ble")?.addEventListener("click", () => void diagnosticar(diagnosticarBle));
  document.getElementById("diag-serie")?.addEventListener("click", () => void diagnosticar(diagnosticarSerie));
  document.getElementById("diag-copiar")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(salidaDiag?.textContent ?? "");
      aviso("Resultado copiado: pégalo en el chat");
    } catch {
      aviso("No se pudo copiar; selecciona el texto y cópialo a mano", "error");
    }
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
  if (CANAL === "dev") {
    document.body.classList.add("canal-dev");
    document.title += " (pruebas)";
    $(".barra h1").insertAdjacentHTML("beforeend", ` <span class="insignia-dev">Pruebas</span>`);
  }
  await cargarLogosIncluidos();
  let inicial: Vista = "catalogo";
  try {
    const v = sessionStorage.getItem(`${PREFIJO}vista`) as Vista | null;
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
