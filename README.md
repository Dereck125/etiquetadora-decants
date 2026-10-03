# Etiquetadora de Decants

App web (PWA) solo para imprimir etiquetas de decants a partir del catálogo de perfumes
en una **Niimbot D11** (203 DPI, etiqueta 12 × 40 mm) vía Web Bluetooth.

Funciona en **Chrome para Android** y **Chrome/Edge en PC**. Safari/iPhone no soporta Web Bluetooth.

## Funciones

- **Dos impresoras**: en el catálogo se elige **Etiquetas chicas** (3, 5 y 10 ml → Niimbot D11, etiqueta vertical
  12 × 40) o **Etiquetas grandes** (30 ml → Yihetangde U1, etiqueta horizontal 40 × 20 con logo de la tienda,
  nombre, marca y volumen). La barra muestra el estado de ambas (Chica / Grande). La U1 se calibra en
  Ajustes → Impresora grande (centrado, margen arriba, avance para arrancar).

- **Catálogo**: búsqueda, filtro por marca y por género (Dama / Caballero / Unisex).
- **Impresión**: elige volumen y cantidad, vista previa exacta (1 px = 1 punto de la impresora).
- **Etiqueta rápida**: imprime sin guardar en el catálogo.
- **Ajustes**: resolución, etiqueta corta, marco decorativo, girar 180°, densidad, logo de la tienda,
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

- Siempre vertical, 12 × 40 mm: logo de la tienda, nombre, logo de la marca y volumen, con marco doble.
- **Resolución automática**: al conectar, la app lee el modelo y ajusta la imagen a su cabezal
  (D11: 203 DPI → 96 × 320 px; D11-H / D11 Pro: 300 DPI → 142 × 472 px). También se puede elegir en Ajustes.
- **Etiqueta corta** (por defecto 3 ml): el frasco solo cubre media etiqueta, así que el diseño ocupa la mitad
  superior (solo se envían 12 × 20 mm) sin el volumen.
- **2 en 1** (solo etiquetas cortas): en el panel de impresión, con 3 ml, se puede elegir una segunda etiqueta
  (otro perfume, de cualquier marca, o el mismo). Se imprimen las dos en una etiqueta de 40 mm, una debajo de la
  otra, con una línea punteada para cortar; en total ocupan el largo de impresión configurado (38 mm). Los volúmenes se configuran en Ajustes.
- **Largo de impresión** (por defecto 38 mm): la imagen debe quedar un poco más corta que la etiqueta de 40 mm.
  Si llega al borde, la impresión se pasa al hueco y la impresora expulsa otra etiqueta en blanco. Si aun así
  sale una en blanco, bájalo en Ajustes.
- **Margen superior** (por defecto 2 mm): la impresora empieza en el borde de la etiqueta, así que el diseño se
  baja para quedar centrado (2 mm arriba, 2 mm abajo con 38 mm de impresión). No alarga la imagen.
- **Tipo de etiqueta** (Ajustes → Impresora): por defecto se usa el que informa el rollo por RFID. Si la impresora
  avanza de más y deja una etiqueta vacía entre impresiones, el sensor no está viendo el hueco: prueba otro tipo
  (p. ej. Transparente). En esa sección se ven el modelo, el firmware y los datos del rollo.
- **Modo de impresión** (avanzado): fuerza la tarea de niimbluelib (p. ej. B1, que se reporta estable en la D11-H).
- **Velocidad de envío** (Ajustes): pausa entre paquetes Bluetooth. Una etiqueta de 5 ml son ~290 paquetes, así que
  la pausa de 10 ms (la segura de niimbluelib) suma ~3 s. Rápida/Muy rápida/Máxima usan 5/2/0 ms; si la etiqueta
  sale incompleta, vuelve a la anterior. Al terminar, el aviso muestra cuánto tardó (envío y total).
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
- Logos entregados por el usuario (sin URL en `fuentes.json`): Giorgio Armani (águila GA), Lancôme, Valentino,
  Versace, Yves Saint Laurent. Pendiente: Nautica.

## Catálogo inicial

`src/datos/catalogo-inicial.json` se genera desde la base de `label-maker`:

```bash
python tools/importar-label-maker.py "D:\label-maker\labels.db"
```

Lo que está entre paréntesis en el nombre (p. ej. "(azul)") pasa al campo `nota` y no se imprime.

## Publicación

GitHub Pages publica las dos ramas en cada push a `master` o `develop` (`.github/workflows/pages.yml`):

| Dirección | Rama | Uso |
|---|---|---|
| https://dereck125.github.io/etiquetadora-decants/ | `master` | Estable: el link que se comparte |
| https://dereck125.github.io/etiquetadora-decants/dev/ | `develop` | Pruebas (muestra la insignia "Pruebas") |

Cada versión guarda su catálogo y ajustes por separado en el navegador (prefijo `etq.` / `etq-dev.`) y tiene
su propio service worker, así que probar en `/dev/` no afecta a quien imprime con la estable.
Para compilar localmente la versión de pruebas: `VITE_CANAL=dev npm run build`.

## Flujo de ramas

- `master`: versiones estables / producción (entra por Pull Request desde `develop`).
- `develop`: integración.
- `feature/*`: cada cambio nace de `develop` y vuelve a `develop` por merge.

## Créditos

Comunicación con la impresora: [niimbluelib](https://github.com/MultiMote/niimbluelib) (MIT).
Los logos de marca son marcas registradas de sus dueños; se usan solo para identificar el producto.
