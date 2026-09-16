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

## El backend: `pe/apps-script/Codigo.gs`

La planilla se quedaba clavada en la misma cantidad de registros: al guardar uno
nuevo se perdía el anterior, porque el `doPost` pisaba la última fila en vez de
agregar una.

`pe/apps-script/Codigo.gs` es el reemplazo completo del `Código.gs` del proyecto
de Apps Script ya publicado. Identifica cada presupuesto por `Num` + `Tipo`:
si el número ya existe actualiza esa fila (editar), y si no existe usa
`appendRow` (nunca pisa una fila anterior). Además toma un `LockService` para
que dos guardados simultáneos no se pisen, y trae una función `probar()` para
correr desde el editor y confirmar que apunta a la hoja correcta antes de
publicar.

### Cómo publicarlo sin cambiar la URL

1. Abrir el proyecto correcto en <https://script.google.com/home> (el que tiene
   la implementación `AKfycbwsjXY6aha...`; se verifica en **Implementar →
   Gestionar implementaciones**).
2. Reemplazar todo el contenido de `Código.gs` por este archivo y guardar.
3. Ejecutar `probar()` y mirar el "Registro de ejecución".
4. **Implementar → Gestionar implementaciones →** lápiz de editar **→ Versión:
   "Nueva versión" → Implementar**. La URL `/exec` se mantiene igual.

> Si se crea una implementación nueva en vez de actualizar la existente, cambia
> la URL y hay que actualizar la constante `API_URL` de `pe/index.html`.

El front (`index.html`) igual verifica cada guardado contra la planilla y guarda
una copia local, así que un fallo del backend se avisa en pantalla en vez de
perderse en silencio.
