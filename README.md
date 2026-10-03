# Etiquetadora de Decants

App web (PWA) solo para imprimir etiquetas de decants a partir del catálogo de perfumes
en una **Niimbot D11** (203 DPI, etiqueta 12 × 40 mm) vía Web Bluetooth.

Funciona en **Chrome para Android** y **Chrome/Edge en PC**. Safari/iPhone no soporta Web Bluetooth.

## Funciones

- **Catálogo**: búsqueda, filtro por marca y por género (Dama / Caballero / Unisex).
- **Impresión**: elige volumen y cantidad, vista previa exacta (1 px = 1 punto de la impresora).
- **Etiqueta rápida**: imprime sin guardar en el catálogo.
- **Ajustes**: diseño vertical u horizontal, marco decorativo, girar 180°, densidad, logo de la tienda,
  logos de marca, respaldo JSON e importación/exportación CSV.

El stock y las ventas se llevan fuera de esta app. El catálogo y los ajustes se guardan en el navegador
del dispositivo (localStorage); descarga un respaldo JSON de vez en cuando.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```

Web Bluetooth solo funciona en `localhost` o con HTTPS. Para usarla desde el celular, publícala con HTTPS
(p. ej. GitHub Pages: `vite.config.ts` ya usa rutas relativas).

## Etiqueta

- Lienzo de impresión: **320 × 96 px** (40 × 12 mm a 8 px/mm). El diseño vertical se dibuja a 96 × 320 y se gira.
- Si la etiqueta sale al revés, activa **Girar 180°** en Ajustes.
- Logos de marca demasiado alargados (menos de 1.5 mm de alto en la etiqueta) se reemplazan por el nombre en texto.

## Logos

- `public/logos/tienda.png`: logo de la tienda (1-bit). Se regenera con `node tools/logos/logo-tienda.mjs`
  a partir de `tools/logos/originales/tienda-original.*`; también genera los íconos de la app.
- `public/logos/marcas/`: logos de marca en PNG 1-bit + `index.json` (marca → archivo, con alias).
  Fuentes en `tools/logos/fuentes.json`; se generan con `node tools/logos/generar-logos.mjs`.
- **Agregar un logo a mano**: guarda el archivo como `tools/logos/originales/<slug>.(png|jpg|svg|webp)`
  (p. ej. `versace.svg`), asegúrate de que la marca esté en `fuentes.json` y corre
  `node tools/logos/generar-logos.mjs --local`. También se puede subir desde **Ajustes → Logos de marcas**
  (queda solo en ese dispositivo).
- Pendientes: Lancôme, Nautica, Valentino, Versace, Yves Saint Laurent.

## Catálogo inicial

`src/datos/catalogo-inicial.json` se genera desde la base de `label-maker`:

```bash
python tools/importar-label-maker.py "D:\label-maker\labels.db"
```

Lo que está entre paréntesis en el nombre (p. ej. "(azul)") pasa al campo `nota` y no se imprime.

## Flujo de ramas

- `master`: versiones estables / producción.
- `develop`: integración.
- `feature/*`: cada cambio nace de `develop` y vuelve a `develop` por merge.

## Créditos

Comunicación con la impresora: [niimbluelib](https://github.com/MultiMote/niimbluelib) (MIT).
Los logos de marca son marcas registradas de sus dueños; se usan solo para identificar el producto.
