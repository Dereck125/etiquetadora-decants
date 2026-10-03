/**
 * Canal de la compilación: "prod" (master, en la raíz del sitio) o "dev" (develop, en /dev/).
 * Se fija con VITE_CANAL=dev al compilar. Cada canal guarda sus datos aparte en el navegador.
 */
export const CANAL: "prod" | "dev" = import.meta.env.VITE_CANAL === "dev" ? "dev" : "prod";

/** Prefijo de las claves de localStorage/sessionStorage. */
export const PREFIJO = CANAL === "dev" ? "etq-dev." : "etq.";
