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

Planilla de presupuestos: `1k50q4RSGOQoBOJnGubLhjApT5dM-A_CuGjDyht_LE_Y`
(**una pestaña por tipo**: hoy existe solo `Electricista`). Ojo que NO es la
misma planilla que la Base Maestra de Marcos ni la de clientes.

El `doPost` original hacía `appendRow` siempre: nunca pisaba una fila, pero
guardar dos veces el mismo N° creaba **filas duplicadas**, y como la app abre
con `.find()` (el primer match), al reabrir el presupuesto cargaba la versión
**más vieja** y la corrección parecía perderse.

`pe/apps-script/Codigo.gs` es el reemplazo completo, manteniendo el diseño de
una pestaña por tipo:

- N° nuevo → `appendRow`; N° que ya existe → actualiza esa fila (sin duplicar).
- Si la pestaña del tipo no existe, la crea con su encabezado (antes tiraba
  error y el presupuesto se perdía sin aviso, porque la app mostraba igual un ✓).
- Acepta `validez`/`validity` y `moneda`/`currency`: el front mandaba unos
  nombres y el script leía los otros, por eso esas dos columnas estaban vacías.
- `LockService` para guardados simultáneos y errores devueltos como JSON.
- Función `probar()` para correr desde el editor: lista pestañas, cantidad de
  registros y N° repetidos.

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

## Variantes por rubro

`pe/generar-variante.py` genera un presupuestador nuevo a partir de
`pe/index.html`, cambiando solo lo que distingue al rubro: título, tipo
(= pestaña en la planilla), prefijo de guardado local, categorías, ítems
precargados y notas por defecto. Todo lo demás —diseño, remito, clientes,
historial con buscador, impresión, red de seguridad al guardar— se hereda.

```bash
python3 pe/generar-variante.py pe/variantes/pintura.json
```

| Variante | Config | Tipo (pestaña) | Prefijo local | Se sube a |
|---|---|---|---|---|
| Electricista | *(el original)* | `Electricista` | `elec-` | `/pe/` |
| Arreglos generales y pintura | `pe/variantes/pintura.json` | `Pintura` | `pint-` | `/pintura/` |

- **Los datos de empresa y la base de clientes se comparten** entre variantes
  (claves `elec-empresa` y `elec-clientes`): el logo y el CUIT se cargan una vez
  y aparecen en todas. Los presupuestos, en cambio, van separados por prefijo,
  así la numeración de un rubro no pisa la del otro.
- **Cada variante necesita su pestaña en la planilla.** El `Codigo.gs` nuevo la
  crea sola la primera vez que se guarda; con el script viejo hay que crearla a
  mano con la fila de encabezado.
- Si se arregla algo en `pe/index.html`, regenerar las variantes para que el
  arreglo se propague.
