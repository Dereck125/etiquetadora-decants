/** Normaliza un nombre de marca para compararlo: sin acentos, minúsculas, solo [a-z0-9]. */
export function slugMarca(marca: string): string {
  return marca
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Corrige texto mal codificado (p. ej. "Lanc\uFFFDme").
    .replace(/\uFFFD/g, "o")
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
