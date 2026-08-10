# 🗄️ Guía de Arquitectura de Base de Datos Local & Instrucciones para Agentes (Claude, Marcos System, Dash Chat)

Este documento sirve como referencia oficial para todos los asistentes y agentes de IA (**Claude**, **Marcos System** y **Dash Chat**) que interactúan con el sistema **Marcos IA**.

---

## 1. ⚠️ Directiva Inviolable de Despliegue y Git

> [!CAUTION]
> **REGLA DE ORO DE DESPLIEGUE EN EL VPS (`200.58.102.182`)**:
> - **GitHub es la única fuente de verdad**.
> - **Queda PROHIBIDO pisar o subir manualmente los archivos `index.js`, `sheets.js` o `agentes/*.js` al VPS mediante copias locales directas.**
> - El despliegue de los archivos del motor en el VPS (`/root/marcos/Consorcio-AI-Assistant`) se realiza **exclusivamente mediante `git pull`** desde la rama oficial en GitHub (`bienargentinos/Bien-Argentinos-repositorio-`).
> - Si un agente necesita actualizar únicamente el panel de administración sin tocar el motor, solo modificará `dashboard.js`.

---

## 2. 📊 Arquitectura de Base de Datos Local SQLite (`db.js`)

Se ha reemplazado la dependencia directa de la API de Google Sheets por un motor relacional local **SQLite** (`marcos_database.sqlite`) administrado por `db.js`.

### Ventajas Operativas:
- **Latencia ultra-baja**: Consultas en <2ms.
- **Sin cuotas de API**: Eliminado el error `429 Too Many Requests`.
- **Historial completo de conversaciones**: Se registran los chats mensaje por mensaje (`mensajes`).

---

## 3. 🗂️ Esquema de Tablas

1. **`vecinos`**:
   - `id`, `telefono`, `nombre`, `edificio`, `departamento`, `encargado`, `tel_encargado`, `horario_encargado`, `tablero`, `llaves`, `seguridad`, `consejo`, `notas`, `autoriza_contacto`, `contacto_acceso`.
2. **`edificios`**:
   - `id`, `edificio`, `tipo`, `direccion`, `zona`, `aliases`, `cuit`, `unidades`, `plan`, `horario_sum`, `cocheras`, `admin_nombre`, `admin_telefono`, `tel_seguridad`, `notas_especiales`, `encargado`, `telefono_encargado`, `encargado_estado`, `encargado_horario`, `encargado_suplente`, `tel_suplente`.
3. **`reportes`** (Casos):
   - `id`, `codigo_caso`, `fecha`, `vecino`, `telefono`, `edificio`, `problema`, `urgencia`, `tecnico`, `acceso`, `estado`, `notas_ia`.
4. **`mensajes`** (**NUEVO - Visor de Chat en Vivo**):
   - `id`, `evento_id`, `edificio`, `telefono`, `remitente` (`vecino` | `marcos` | `admin` | `tecnico`), `mensaje`, `tipo_canal` (`whatsapp` | `llamada`), `url_media`, `timestamp`.
5. **`clientes`**:
   - `id`, `nombre`, `usuario`, `contrasena`, `email`, `edificios`, `plan`, `activo`, `ultimo_acceso`.
6. **`proveedores` & `proveedor_asignaciones`**:
   - Lista maestra de proveedores por cliente y asignación a consorcios por especialidad/prioridad.
7. **`llamadas`**, **`memoria`**, **`facturas`**, **`expensas`**, **`sugerencias`**, **`solicitudes`**.

---

## 4. 🛠️ Guía de Integración por Agente

### 🤖 Claude / Antigravity Agent:
- Sincronizar siempre con `git pull --rebase origin <rama>` antes de realizar modificaciones.
- Todo commit debe subirse con `git push` antes de realizar cualquier actualización en el VPS.
- No alterar las reglas inmutables de Marcos (25 segundos de acumulación, aislamiento de edificios por alias/dirección, 2 audios TTS por 24h, prefijo `[CASO-XXXX]`).

### 📱 Marcos System (Motor de IA):
- Utilizar `db.js` para búsquedas inmediatas de vecinos, perfiles de edificios y asignaciones de técnicos.
- Cada mensaje de texto o nota de voz procesado se registra en `db.guardarMensaje({ eventoId, edificio, telefono, remitente, mensaje, tipoCanal })`.

### 🖥️ Dash Chat (Dashboard Admin):
- Endpoints de API disponibles:
  - `GET /admin/api/mensajes?eventoId=CASO-XXXX`: Devuelve la lista completa de mensajes mensaje a mensaje para el Visor de Chat en Vivo.
  - `GET /admin/api/busqueda-global?q=busqueda`: Realiza búsquedas instantáneas (<10ms) entre reclamos, vecinos y edificios.

---

## 🔄 Script de Migración Automática:
Para migrar todas las hojas de Google Sheets a la base de datos local SQLite:
```bash
node migrate-sheets-to-sql.js
```
