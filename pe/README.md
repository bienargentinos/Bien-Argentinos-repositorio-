# Presupuestador Electricista (`bienargentinos.com/pe/`)

App de una sola página (HTML + CSS + JS en un archivo) para armar presupuestos,
remitos y llevar la base de clientes. Se sirve como estático en `/pe/index.html`.

## Cómo se despliega

Subir `pe/index.html` a la carpeta `/pe/` del hosting (FTP / cPanel), o desde el
servidor bajarlo del repo:

```bash
curl -L -s "https://raw.githubusercontent.com/bienargentinos/Bien-Argentinos-repositorio-/claude/vibrant-faraday-avx4ud/pe/index.html" -o /ruta/al/sitio/pe/index.html
```

> El repo tiene que estar público para que `curl` funcione. Ponerlo privado después.

## Dónde se guardan los presupuestos

- **Nube**: un Google Apps Script publicado en
  `https://script.google.com/macros/s/AKfycbwsjXY6ahavwhyXafI9P8e4ZjPXWMhNV76MNgRiigRHPzgw4Ld1VybAhhBWkMFGZNk/exec`
  (constante `API_URL`). `GET ?tipo=Electricista` devuelve todas las filas;
  `POST` con el presupuesto en JSON lo guarda.
  Columnas: `Timestamp, Num, Tipo, Fecha, Cliente, Direccion, Contacto, Fiscal,
  Notas, Descuento, Total, Validez, Moneda, Items`.
- **Local**: copia de respaldo en `localStorage` (`elec-index` + `elec-pres:<N°>`).

## Pestañas

| Pestaña | Qué hace |
|---|---|
| Presupuesto | Carga rápida: datos de empresa, cliente, ítems, totales, fotos, imprimir/PDF |
| Remito / Acta | Mismo trabajo sin precios, con firmas |
| Clientes | Importación por CSV y sincronización |
| **Historial** | Todos los presupuestos guardados, con buscador, orden, Abrir (editar) y Duplicar |

El botón **"Mis presupuestos"** de arriba sigue siendo el acceso rápido de siempre.

## Pendiente: el bug del lado del Apps Script

La planilla se queda clavada en la misma cantidad de registros: al guardar uno
nuevo se pierde el anterior. El `index.html` ya avisa cuando eso pasa
(verificación después de guardar) y guarda siempre una copia local, pero **el
arreglo de fondo va en el código del Apps Script** (`doPost`), que vive en la
cuenta de Google, no en este repo. Sospecha principal: escribe en
`data.length` en vez de `data.length + 1`, o no hace `appendRow`, y por eso
pisa la última fila en cada guardado.
