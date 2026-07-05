# PORTING.md — Reglas para reproducir el panel EXACTO

> Leé esto ANTES de escribir código. El objetivo es reproducir el panel **idéntico**
> al diseño, sin reinterpretar. El diseño ya está decidido y aprobado.

## Regla de oro
`Panel Consorcio.dc.html` es la **fuente de verdad EXACTA**. No es una sugerencia ni un
punto de partida: es la especificación final. Copiá el markup y los estilos **tal cual**.

Para verlo idéntico: abrí **`Panel Consorcio (standalone).html`** en el navegador (es el
mismo diseño, autónomo, sin dependencias). Usá las **DevTools del navegador** (clic derecho →
Inspeccionar) sobre cualquier elemento para leer su HTML y sus estilos inline exactos
(colores hex, tamaños, paddings, radios). Copialos literal.

## Qué SÍ podés cambiar
1. Reemplazar los valores `{{ dato }}` por datos reales (del Google Sheets / API).
2. Traducir la sintaxis del prototipo a tu framework:
   - `<sc-for list as="x">…</sc-for>`  → tu `.map(...)`
   - `<sc-if value>…</sc-if>`          → tu render condicional
   - `onClick="{{ fn }}"`              → tu handler
   - `style="..."`                     → **se copia idéntico** (son estilos inline)

## Qué está PROHIBIDO (esto es lo que se venía haciendo mal)
- ❌ NO muevas posiciones ni cambies el orden de los elementos.
- ❌ NO agregues contadores, badges, KPIs ni "stats" en secciones que no los tienen.
- ❌ NO agregues formularios, campos ni inputs que no existan en el archivo.
- ❌ NO reemplaces los emojis/íconos por otros ni por una librería de íconos.
- ❌ NO cambies colores, tipografía, radios ni sombras "para mejorar".
- ❌ NO agregues secciones nuevas ni "empty states" que no estén en el diseño.
- Si algo parece faltar, es a propósito. Ante la duda: **dejalo como está en el archivo**.

## Leyenda de íconos (emojis — usar EXACTAMENTE estos)
El diseño usa **emojis nativos**, no una librería. Respetalos:

| Emoji | Dónde | Significado |
|---|---|---|
| 🟢 | canal de un evento | WhatsApp (verde) |
| 📞 | canal / topbar | Llamado telefónico |
| 🏢 | selector, tarjetas, nav | Edificio / consorcio |
| 📹 | evento tipo seguridad | Cámara / seguridad |
| 🔧 | evento tipo reclamo | Reclamo / arreglo |
| 📅 | evento tipo reserva | Reserva de espacio |
| 💬 | evento tipo aviso | Mensaje / aviso |
| 🧰 | evento mantenimiento | Mantenimiento |
| 🌙 | banner resumen | "mientras no estabas" |
| 🚨 | KPI urgencias | Urgencia |
| ⏳ | KPI / pendientes | En curso / pendiente |
| ✅ | KPI resueltos | Resuelto |
| 🧾 | nav / facturas | Facturas / comprobantes |
| 📑 | nav cliente | Expensas |
| 💡 | nav / solicitudes | Sugerencias |
| 📊 | nav | Resumen |
| 🔔 | nav / topbar dueño | Eventos / notificaciones |
| 📈 | nav dueño | Consumos |
| 📥 | nav dueño | Solicitudes (bandeja) |
| 👥 | nav dueño | Clientes |
| 📄 🖼️ 🔗 | expensas | PDF / imagen / link |
| 👁 | preview dueño | "Ver como cliente" |
| 👤 🔒 ✉️ 🔑 | login | usuario / contraseña / email / recuperar |

## Leyenda de colores (tokens — copiar hex exactos)
- **Marca azul (gradiente):** `#0F326A → #17408B → #2E6FC0` · primario botón `#1E5FB4`/`#2E6FC0`
- **WhatsApp / OK / resuelto / USD:** verde `#16A34A` / `#1B7A43`, fondo `#E7F4EC`
- **Urgencia / excede / rojo:** `#E5484D` / `#C0392B`, fondo `#FDECEC`, texto `#B4232A`
- **Media / pendiente / preview:** ámbar `#D99B1F` / `#8A6410`, fondo `#FBF3DE`
- **Acento dorado:** `#D99B1F`
- **Fondo app:** `#EEF1F6` · **card:** `#FFFFFF` · **borde:** `#E7ECF3` / `#E4E9F1`
- **Texto:** `#16233B` · **secundario:** `#64748B` / `#8595AD`
- **Moneda:** USD `#1B7A43`/`#E7F4EC` · EUR `#2C55A8`/`#E9EEFB` · ARS `#5A6B85`/`#EEF2F8`
- **Tipografía:** Hanken Grotesk (400–800). **Radios:** cards 14–16px, botones/inputs 10–12px, pills 999px.
- **Sombras:** cards `0 1px 2px rgba(16,35,59,.04)` · dropdowns/modales `0 16px 40px -12px rgba(16,35,59,.28)`

## Inventario de secciones (esto y NADA MÁS)
**Auth:** login · recuperar contraseña · "revisá tu email" · activar cuenta · cuenta activada.
**Cliente:** Resumen · Mi Edificio · Eventos (+ drawer detalle con conversación) · Facturas/Fotos · Expensas · Sugerencias.
**Dueño:** Resumen · Eventos · Consumos · Clientes (Por cliente / Todos) · Solicitudes · Facturas/Fotos · campana de Notificaciones · "Ver como cliente" (impersonación).

Cada sección tiene exactamente los elementos que están en el archivo. Si tu versión tiene
un contador, un formulario o una tarjeta que el archivo NO tiene → sobra, quitalo.

## Flujo de trabajo sugerido
1. Abrí `Panel Consorcio (standalone).html` y recorré todas las pantallas
   (login: `daniel / sistema2025` = dueño, `amato_admin / demo1234` = cliente).
2. Tomá UNA sección. Inspeccioná su markup en DevTools.
3. Reproducila con tu framework copiando estructura + estilos inline **idénticos**.
4. Reemplazá solo los `{{ }}` por datos reales.
5. Compará lado a lado con el standalone. Debe verse igual, pixel a pixel.
6. Recién ahí pasá a la siguiente sección.
