# Relevamiento de Sección "Facturas y Fotos"

## 1. Archivos Relevantes en el Proyecto
- **Controlador Principal y Frontend**: `dashboard.js`
- **Gestión de Hojas de Cálculo (Google Sheets)**: `dashboard.js` (utiliza `readTab(TAB_ARCHIVOS)` y `appendRow(TAB_ARCHIVOS, ...)` con `TAB_ARCHIVOS = 'facturas'`)
- **Base de Datos PostgreSQL (`marcos_db`)**: `db-pg.js` / conexión PostgreSQL en `dashboard.js`
- **Carpeta de Almacenamiento de Archivos**: `/root/marcos/Consorcio-AI-Assistant/almacenamiento/` servidos públicamente bajo `/archivos/...`

## 2. Estructura y Columnas Existentes en la Pestaña `facturas` (Sheets) y Tabla `facturas` (PostgreSQL)
Columnas originales (en su orden actual):
1. `fecha` (texto, `DD/MM/AAAA, HH:MM:SS`)
2. `proveedor` (texto, nombre del proveedor)
3. `numero_factura` (texto, ej. `00001-00000845`)
4. `monto` (texto, ej. `$100.000,00` o `Según comprobante`)
5. `concepto` (texto)
6. `edificio` (texto, nombre del edificio)
7. `estado` (texto, `Pendiente` / `Pagada`)
8. `url_archivo` (texto, ruta web servida bajo `/archivos/...`)

Columnas Nuevas a incorporar en PostgreSQL y Google Sheets (según `01-base-de-datos.sql`):
9. `clase` (`Proveedor` / `Gasto fijo`)
10. `categoria` (catálogo `categorias_gasto`)
11. `tipo` (`Factura PDF` / `Foto` / `Recibo` / `Presupuesto` / `Otro`)
12. `origen` (`Encargado` / `Consejo` / `Administrador`)
13. `origen_nombre` (nombre de la persona)
14. `requiere_revision` (`si` / `no`)
15. `fecha_pago` (`DD/MM/AAAA` o vacío)
16. `codigo_caso` (`CASO-1001` o vacío)
17. `eliminada` (`si` o vacío)

Columnas Auxiliares Exclusivas de PostgreSQL:
- `fecha_iso` (timestamptz)
- `monto_num` (numeric(14,2))
- `factura_key` (texto)
- `sheets_fila` (int)
- `sheets_sync_at` (timestamptz)
- `updated_at` (timestamptz)

## 3. Comando y Script de Migración
- Script SQL: `01-base-de-datos.sql`
- Comando de ejecución en VPS:
  `PGPASSWORD=marcos2024 psql -U marcos -h 127.0.0.1 -d marcos_db -f 01-base-de-datos.sql`

## 4. Flujo Actual de Creación y Escritura de Facturas
- La app escribe primero en PostgreSQL (`marcos_db`) y luego replica de forma asíncrona a la pestaña `facturas` de Google Sheets.
