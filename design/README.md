# Handoff: Panel de administración — Marcos IA (consorcios)

## Overview
"Marcos IA" es un asistente que atiende WhatsApp y llamados de consorcios 24/7 haciéndose pasar por una persona. Este panel es **la ventana humana** sobre ese trabajo. Tiene **dos roles sobre un mismo login**:

- **Admin de sistema / dueño (Daniel)** — ve todos los edificios, aprueba pedidos, responde sugerencias, edita fichas, ve consumos y factura excedentes.
- **Admin de edificio / cliente** (ej. "Amato Propiedades") — ve solo su(s) edificio(s), pide cambios, sugiere, sube expensas.

La misma ruta renderiza contenido distinto según la sesión (rol + edificios asignados). El dueño puede además **impersonar** ("Ver como cliente") para revisar exactamente lo que ve un administrador.

## About the Design Files
Los archivos de este bundle son **referencias de diseño hechas en HTML** (un prototipo que muestra look & feel y comportamiento), **no** código de producción para copiar tal cual. El archivo principal es un "Design Component" (`.dc.html`) que corre sobre un pequeño runtime propio (`support.js`) — ese runtime **no** va a producción.

La tarea es **recrear estos diseños en el entorno del código real**: un backend **Node sobre Ubuntu** (en el VPS) que ya usa **Google Sheets como base de datos** vía un módulo `sheets.js`. El front puede implementarse con el stack que ya tenga el proyecto (o React si arrancás de cero). Toda la lógica de datos, autenticación real y despliegue es trabajo de programación a implementar sobre lo existente.

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografía, espaciados e interacciones son finales y deben respetarse. La paleta sale de la marca del cliente (bienargentinos.com).

## Roles y ruteo
- Login compartido; el backend resuelve `role` (`dueno` | `cliente`) y, para clientes, la lista de edificios (`owner`).
- Cliente: solo ve/opera sobre edificios donde `building.owner === session.owner`.
- Dueño: ve todo; puede filtrar por edificio; puede impersonar un cliente (modo solo-lectura de la sesión real, con banner "Vista previa").

## Screens / Views

### AUTH (pantalla de ingreso, panel dividido: brand a la izquierda, formulario a la derecha, 380px máx)
1. **Login** — usuario + contraseña, "Recordar sesión", "¿Olvidaste tu contraseña?", link "Activá tu cuenta". Valida credenciales; error en banner rojo si fallan. El rol lo define la cuenta.
2. **Recuperar contraseña** — input email → envía link de reseteo.
3. **Revisá tu email** — confirmación.
4. **Activá tu cuenta (onboarding/primer acceso)** — usuario + nueva contraseña + repetir. Validaciones: campos completos, mínimo 6 caracteres, coincidencia. (Reemplaza el alta manual por variable de entorno del MVP.)
5. **Cuenta activada** — éxito → volver a ingresar.

### VISTA CLIENTE (admin de edificio)
Shell: topbar (logo, selector de SUS edificios, avatar) + sidebar (o bottom-nav en mobile).
- **Resumen** — banner "novedades desde tu última conexión", 4 tarjetas (novedades, urgencias abiertas, en curso, resueltos), feed de novedades (clic → detalle), estado del edificio por tipo, totales de costos en divisa (USD/EUR).
- **Mi Edificio** — ficha del consorcio (campos de solo consulta). Cada campo editable tiene **"Solicitar cambio"** → modal (valor actual, nuevo valor, motivo) → queda **pendiente** (no se escribe hasta que el dueño aprueba). Lista de cambios pendientes arriba.
- **Eventos** — feed cronológico de casos con urgencia (alta/media/baja), estado (nuevo/en curso/resuelto), canal (WhatsApp/Llamado), unidad, hora. Filtros (Todos/Nuevos/Urgentes/Sin resolver). Clic → **drawer de detalle** con: pedido, operador que atendió + turno, "qué hizo Marcos", y la **Conversación registrada** (chat de WhatsApp en burbujas o transcripción de llamada con grabación) + botón Descargar (comprobante).
- **Facturas/Fotos** — grilla de comprobantes (PDF/foto) con moneda (ARS/USD/EUR) y estado.
- **Expensas** — el admin sube las expensas del mes (formato **PDF / imagen / link web**) → quedan publicadas con sello "Marcos puede compartirla". Acciones: copiar enlace, quitar.
- **Sugerencias** — formulario libre + historial con respuestas del administrador.

### VISTA DUEÑO (admin de sistema)
Shell: topbar (logo, filtro "Todos los edificios"/por edificio, **campana de notificaciones** con contador, avatar). Menú de usuario incluye **"Ver como cliente"** (abre selector de administrador → impersona).
- **Resumen general** — 5 KPIs (edificios activos, novedades hoy, urgencias abiertas, solicitudes pendientes, excedente facturable), alerta si hay edificios que exceden el plan, tarjetas de estado por edificio.
- **Eventos** — feed de todos los edificios (chip de edificio), filtrable. Mismo drawer de detalle.
- **Consumos** — por edificio: uso vs plan (mensajes WhatsApp, minutos de llamada, eventos), barras que se ponen rojas al exceder. Si excede el plan Base: **excedente facturable** (monto) + botones "Facturar excedente" y "Proponer Plan Plus". Banner con total facturable del mes.
- **Clientes** — dos modos: **Por cliente** (grilla de administradores → clic → sus edificios, con "+ Agregar edificio") y **Todos los edificios** (tabla plana). "+ Agregar cliente". Edición **directa** de ficha (sin aprobación) vía modal (nombre, encargado, plan Base/Plus).
- **Solicitudes** — bandeja de **pedidos de cambio** (Aprobar → escribe en Sheets / Rechazar → notifica) + **sugerencias** para responder.
- **Notificaciones** — centro de avisos: pedidos de cambio, sugerencias sin responder, urgencias abiertas. Cada uno navega a su sección.

## Interactions & Behavior
- Navegación por secciones vía estado (`section`), sin recargar.
- Drawer de evento: overlay + panel derecho (animación slide-in 0.28s). Modales: overlay + pop (0.22s). Toast: bottom-center, 2.6s.
- Selector de edificio / filtro: dropdown con animación pop.
- **Flujo de aprobación** (core): cliente "Solicitar cambio" → registro `pendiente` en `solicitudes` → aparece en bandeja del dueño → Aprobar escribe el valor en `edificios` al instante; Rechazar pide/registra motivo y notifica.
- **Impersonación** (dueño): setea rol cliente + `owner` objetivo, muestra banner ámbar "Vista previa", botón para volver.
- Voces rotativas: en las conversaciones el operador ("Marcos", "Susana", "Lucía"…) rota según turno/hora — el vecino no debe percibir que es IA. El admin de edificio **sí sabe** que es IA. Los vecinos/propietarios/inquilinos **no**.
- Responsive: <900px sidebar → bottom-nav; grids con `auto-fit`/`minmax`.

## State Management
Sesión: `{ user, role: 'dueno'|'cliente', owner, buildings[] }`.
UI: `section`, `building`/`duenoFilter`, `selectedEvent` (drawer), modales (`requestField`, `editBldg`, `addClient`, `addBldg`, `clientPicker`), `notifOpen`, `previewFromDueno`+`previewOwner` (impersonación), formularios de expensas/sugerencias/altas, `authView` (login/forgot/sent/activate/activated).
Datos: leer/escribir sobre las pestañas del Sheets (abajo).

## Design Tokens
- **Marca azul** (gradiente): `#0F326A → #17408B → #2E6FC0`; primario `#1E5FB4` / `#2E6FC0`.
- **Dorado** (acento): `#D99B1F`.
- **Rojo** (urgencia/excede): `#E5484D` / `#C0392B`; fondo `#FDECEC`, texto `#B4232A`.
- **Verde** (ok/resuelto/USD): `#16A34A` / `#1B7A43`; fondo `#E7F4EC`.
- **Ámbar** (media/pendiente/preview): `#D99B1F` / `#8A6410`; fondo `#FBF3DE` / `#FBF1DD`.
- **Neutros**: fondo app `#EEF1F6`; card `#FFFFFF`; borde `#E7ECF3` / `#E4E9F1`; texto `#16233B`; secundario `#64748B` / `#8595AD`.
- **Moneda**: USD verde `#1B7A43`/`#E7F4EC`, EUR azul `#2C55A8`/`#E9EEFB`, ARS neutro `#5A6B85`/`#EEF2F8`.
- **Tipografía**: Hanken Grotesk (Google Fonts), pesos 400–800.
- **Radius**: cards 14–16px, botones/inputs 10–12px, pills 999px. **Sombras**: `0 1px 2px rgba(16,35,59,.04)` (cards), `0 16px 40px -12px rgba(16,35,59,.28)` (dropdowns/modales).
- **Íconos**: emoji (la marca los usa). No introducir librerías de íconos salvo que el codebase ya tenga una.

## Mapeo a Google Sheets (base de datos actual, `sheets.js`)
| Sección del panel | Pestaña | ¿Se crea sola? | Notas |
|---|---|---|---|
| Eventos / Resumen | `reportes` | No | casos con urgencia, estado, canal, unidad, nota de Marcos |
| Mi Edificio / Edificios | `edificios` | No | ficha por consorcio; el dueño escribe directo, el cliente vía aprobación |
| Facturas/Fotos | `facturas` | No | comprobantes y archivos |
| Sugerencias | `sugerencias` | Sí (1er envío) | libre + respuesta del dueño |
| Solicitudes | `solicitudes` | Sí (1er pedido) | pedidos de cambio: pendiente/aprobada/rechazada |
| **Expensas** (nuevo) | `expensas` | Sí | período, formato (pdf/imagen/link), url/archivo, edificio, publicada |
| **Consumos** (nuevo) | `consumos` o derivado | — | uso por edificio (mensajes, minutos, eventos) vs plan; probablemente derivar de los logs de Marcos |
| **Clientes/Admins** (nuevo) | `clientes` | Sí | owner, nombre, usuario, email, plan (Base/Plus); hoy el 1er cliente es una env var |
| Conversaciones/transcripciones | (motor de Marcos) | — | chat WhatsApp + transcripción de llamadas, con operador y hora; alimenta el drawer |

## Backend / infra (VPS: Ubuntu + Node)
- Auth real: usuarios con `role` y `owner`, contraseña hasheada (bcrypt), sesión/JWT. Activación por token (onboarding) y recuperación por email (link con token). El MVP creaba el 1er usuario por variable de entorno — reemplazar por la pantalla de activación + pestaña `clientes`.
- Autorización: middleware que filtra por `owner` para clientes; dueño sin filtro. Impersonación solo para dueño, auditada.
- Datos: seguir usando `googleapis` sobre el mismo Sheet (nombres de pestaña en minúscula, como `sheets.js`). Crear las pestañas nuevas si no existen.
- Facturación: el cálculo de excedente (precio por mensaje/minuto extra sobre el plan) es de ejemplo en el prototipo — definir precios reales; decidir si el plan se setea desde el panel o desde el sistema de facturación (el panel puede quedar de solo lectura para el plan).
- Notificaciones: hoy dependen de que el dueño entre. A futuro: push/email al llegar una solicitud o sugerencia.

## Assets
- **Logo**: el prototipo usa un placeholder arrastrable (`<image-slot>`). En producción, servir el logo real de "Bien Argentinos" desde el front. El wordmark "Marcos IA" es texto.
- **Fuente**: Hanken Grotesk (Google Fonts).
- Sin imágenes propietarias más allá del logo del cliente.

## Files
- `Panel Consorcio.dc.html` — el diseño completo (template + lógica del prototipo). Abrilo en el navegador para explorarlo.
- `support.js` — runtime del Design Component (solo para que el prototipo corra; NO va a producción).
- `image-slot.js` — componente del placeholder de logo (solo prototipo).
- `screenshots/` — capturas de referencia de las pantallas (vista cliente: `01–07-panel`; vista dueño: `01–07-dueno`).

## Cómo explorar el prototipo
Abrí `Panel Consorcio.dc.html` en un navegador. En el login, cuentas de prueba: `daniel / sistema2025` (dueño), `amato_admin / demo1234` (cliente). O usá los botones de acceso rápido.
