import { defineConfig } from "vite";

export default defineConfig({
  // Rutas relativas: permite publicar en GitHub Pages u otro subdirectorio.
  base: "./",
  server: { host: true },
});
