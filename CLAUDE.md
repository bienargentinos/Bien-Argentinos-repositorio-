# Bien Argentinos — Marcos IA

## Accesos VPS (DonWeb)

```
ssh -p5436 root@200.58.102.182
```

- Proyecto en: `/root/marcos/Consorcio-AI-Assistant/`
- Process manager: PM2 → `pm2 list` / `pm2 restart marcos-ia` / `pm2 logs marcos-ia`
- Nginx + SSL en: `marcos.bienargentinos.com`
- Dashboard admin: `https://marcos.bienargentinos.com/admin`
  - Usuario dueño: `admin` / `marcos2024` (o env `DASHBOARD_USER` / `DASHBOARD_PASS`)

## Repositorio GitHub

- Repo: `bienargentinos/bien-argentinos-repositorio-`
- Branch de desarrollo: `claude/ecstatic-hamilton-d1564x`
- Para transferir archivos al VPS (rama de desarrollo, no `main`):
  ```bash
  curl -L -s "https://raw.githubusercontent.com/bienargentinos/Bien-Argentinos-repositorio-/claude/ecstatic-hamilton-d1564x/dashboard.js" \
    -o /root/marcos/Consorcio-AI-Assistant/dashboard.js && \
  node --check /root/marcos/Consorcio-AI-Assistant/dashboard.js && \
  pm2 restart marcos-ai
  ```
  > El repo debe estar público para que curl funcione. Ponerlo privado después.
- Logo de marca: `dashboard.js` sirve `/admin/assets/logo.png` desde `design/assets/logo.png`.
  Ese archivo NO se actualiza con el curl de arriba (curl solo baja `dashboard.js`) — copiarlo
  una sola vez al VPS:
  ```bash
  mkdir -p /root/marcos/Consorcio-AI-Assistant/design/assets && \
  curl -L -s "https://raw.githubusercontent.com/bienargentinos/Bien-Argentinos-repositorio-/claude/ecstatic-hamilton-d1564x/design/assets/logo.png" \
    -o /root/marcos/Consorcio-AI-Assistant/design/assets/logo.png
  ```

## Stack técnico

- **Runtime**: Node.js + Express — `index.js` es el servidor principal
- **IA**: Google Gemini 2.5 Flash (multi-agente: marcos-caso, marcos-cara, marcos-ops, marcos-docs, marcos-admin)
- **WhatsApp**: Meta WhatsApp Cloud API → webhook en `/webhook`
- **Llamadas**: Vapi → endpoints `/vapi` y `/vapi/llamada-finalizada`
- **Voz TTS**: ElevenLabs (solo primeros 2 audios por sesión, luego texto)
- **Base de datos**: Google Sheets via `googleapis` + service account
- **Dashboard**: `dashboard.js` montado en `/admin`

## Google Sheets

- Sheet ID: `1jG6-CuNnk5HH2PmdvKdHwOExmxE6RQ-Cb_BdpLQy0vI`
- Credenciales: `gen-lang-client-0735429936-bba6999e5e60.json`
- Tabs reales (definidas en `sheets.js`, en minúscula):
  - `reportes` (= eventos): fecha, vecino, edificio, problema, urgencia, tecnico, acceso, estado, notas_ia
  - `edificios`: edificio, tipo, direccion, zona, aliases, cuit, unidades, plan, horario_sum, cocheras,
    admin_nombre (=administrador), admin_telefono (=telefonos), tel_seguridad, notas_especiales,
    encargado, telefono_encargado, encargado_estado (activo/licencia/vacaciones), encargado_horario,
    encargado_suplente, tel_suplente. **Las columnas nuevas se crean solas** al guardar desde Mi Edificio.
  - `facturas`: fecha, proveedor, monto, concepto, edificio, url_archivo
  - `memoria`: telefono, nombre, fecha_ultimo_contacto, resumen_historial, notas_trato
  - `llamadas`: fecha, duracion, telefono, vecino, edificio, resumen, transcripcion, urgencia, estado, mensaje_enviado
  - `vecinos`: telefono, nombre, edificio, departamento, encargado, ...
  - `sugerencias`: (la crea el dashboard) fecha, usuario, edificio, texto, estado, respuesta
  - `solicitudes`: (la crea el dashboard) fecha, usuario, edificio, campo, valor_actual, valor_nuevo, estado, motivo_rechazo
  - `clientes`: (la crea el dashboard, sección Clientes) nombre, usuario, contrasena, email, edificios, plan, activo, ultimo_acceso
    — reemplaza de a poco a `CONSORCIO_USERS` del `.env`. **Contraseña en texto plano por ahora**
    (pendiente: hashear con bcrypt cuando hagamos el auth real con activación por token).
  - `expensas`: (la crea el dashboard) fecha, edificio, periodo, formato (pdf/imagen/link), nombre, url, estado.
    El binario del PDF todavía NO se sube — se registra nombre/link para que Marcos lo comparta.
  - `proveedores`: (la crea el dashboard, Mi Edificio) edificio, rubro, nombre, telefono, notas, estado.
    Técnicos de confianza del consorcio (plomero, gasista, electricista, ascensores...). Marcos recurre a
    estos según el rubro del evento. Una fila por proveedor (un edificio puede tener varios del mismo rubro).
- IMPORTANTE: el dashboard apunta a estas tabs por defecto. Overrides en `.env`: `SHEET_TAB_EVENTOS`,
  `SHEET_TAB_EDIFICIOS`, `SHEET_TAB_ARCHIVOS`, `SHEET_TAB_CLIENTES`, `SHEET_TAB_EXPENSAS`, `SHEET_TAB_PROVEEDORES`.

## Mi Edificio (lado cliente) — qué edita sin permiso vs. con aprobación

- **Edita DIRECTO el cliente** (se guarda al instante, botón "Guardar cambios del edificio"): dirección, zona,
  alias/doble dirección, CUIT, unidades funcionales, horario del SUM, cocheras, tel. seguridad de la entrada,
  encargado (nombre/tel), suplente (nombre/tel), **estado del encargado** (activo/licencia/vacaciones) y
  **horario del encargado** (aparece solo si está activo). Endpoint `POST /api/mi-edificio`.
- **Proveedores**: se agregan/quitan directo desde una tarjeta propia (rubro, nombre, teléfono, notas).
  Endpoints `POST /api/proveedor` y `POST /api/proveedor-quitar`.
- **Pasa por aprobación** (botón "Solicitar cambio" → tab `solicitudes` → el dueño aprueba): solo el nombre
  del consorcio y el administrador + su teléfono. Son los datos "de identidad" que no debería cambiar el
  cliente a ciegas.
- El **dueño** edita casi todo directo desde la ficha del edificio en Clientes (modal). Los proveedores
  también los puede cargar el dueño pasando `edificio` en el body.

## Roles del dashboard

- **Dueño** (Daniel): ve todo — Resumen, Eventos, Facturas, **Clientes y edificios** (unificado), Solicitudes
- **Admin consorcio** (cliente): ve solo su edificio — Resumen, Mi Edificio, Eventos, Facturas, Sugerencias
  - Alta de clientes: desde el dashboard, sección **Clientes y edificios** (dueño) → guarda en la tab `clientes` de Sheets.
    Ya no hace falta editar el `.env` ni reiniciar el servidor para cada cliente nuevo.
  - `CONSORCIO_USERS` en `.env` sigue funcionando como fallback/compatibilidad:
    ```
    CONSORCIO_USERS={"usuario1":"contraseña:Nombre Edificio A","usuario2":"contraseña:Edificio B,Edificio C"}
    ```

## Clientes y edificios (jerarquía, según diseño aprobado)

Siguiendo el boceto de diseño (no la primera versión que armé, que era plana):

- **Cliente** (administrador de consorcio) es la entidad estable — nombre, usuario, contraseña, email.
  Rara vez cambia.
- **Edificio** es la entidad que rota — puede sumarse o sacarse de un cliente con el tiempo. El **Plan
  (Base/Plus) y las Unidades viven en el edificio**, no en el cliente (antes estaban mal puestos en cliente).
- La sección `/admin/clientes` tiene 3 vistas:
  1. **Por cliente** (`/admin/clientes`) — grid de tarjetas, una por cliente, con conteo de edificios/unidades
     y tags de plan agregados. Click → detalle.
  2. **Detalle de un cliente** (`/admin/clientes?cliente=usuario`) — banner con el cliente + lista de sus
     edificios + botón "+ Agregar edificio" (crea el edificio y lo asigna a ese cliente de una).
  3. **Todos los edificios** (`/admin/clientes?vista=todos`) — tabla plana de todos los edificios con su
     cliente asignado (o "Sin asignar").
- `/admin/edificios` sigue viva (no está en el menú) como la pantalla de edición fila-por-fila de datos de
  un edificio — los botones "Editar" de las vistas de arriba apuntan ahí.
- **"Agregar cliente" ya NO pide edificios** — el orden siempre es cliente primero, edificio después (se
  agrega desde la ficha del cliente, nunca al darlo de alta).
- **"+ Agregar edificio" está disponible en dos lugares**: en la ficha de un cliente (dueño) y en "Mi
  Edificio" (el propio administrador de consorcio) — porque es el cliente quien tiene los datos reales del
  edificio, no Daniel. Mismo formulario compartido (`formNuevoEdificioHtml()` en dashboard.js), el backend
  determina el dueño del edificio nuevo por sesión si es rol `consorcio`, o por el parámetro si es el dueño.
- Campos de edificio ampliados: `zona`, `encargado_estado` (activo/vacaciones/licencia/suspendido),
  `encargado_suplente` (personal de limpieza u otro que cubre al encargado), `tel_seguridad`. Todos
  opcionales — la nota en la UI aclara que Marcos los va completando con el tiempo, a medida que se
  contacta con propietarios y vecinos.
- **Selector de edificio del dueño** (header, al lado del logo): dropdown "Filtrar por edificio" con
  "Todos los edificios" + lista de cada uno con su cliente asignado. Al elegir uno, filtra Resumen y Eventos
  a ese edificio hasta que vuelva a "Todos". Se guarda en `req.session.filtroEdificioDueno` (ruta
  `GET /admin/set-filtro?edificio=Nombre`), la lista se carga por AJAX desde `GET /admin/api/topbar-edificios`.
- **Selector de edificio del cliente** (mismo dropdown, aparece solo si el cliente tiene más de un edificio
  asignado): elige cuál de sus edificios está viendo, se guarda en `req.session.edificioActivo` y estrecha
  `edificiosPermitidos()` a ese único edificio — afecta Eventos, Facturas y Mi Edificio automáticamente.
  Misma ruta `GET /admin/set-filtro` (detecta el rol y decide qué variable de sesión tocar).
- **Resumen del dueño** rediseñado: 5 tarjetas (edificios activos, novedades hoy, urgencias abiertas,
  solicitudes pendientes, excedente facturable — este último en $0 fijo hasta que exista Consumos) +
  grid "Estado por edificio" (una tarjeta por edificio con su cliente, unidades, novedades/urgencias de
  hoy; click filtra el Resumen a ese edificio). El banner rojo de "excede el plan" del boceto **no** se
  implementó todavía — necesita datos reales de consumo que no existen.
- **Drawer de detalle de evento** (`/admin/eventos`, click en un evento): panel lateral con canal, edificio,
  cuándo, teléfono, técnico, "El pedido" y "Qué hizo Marcos". **Importante**: hoy NO muestra la conversación
  real de WhatsApp/llamada mensaje por mensaje (como en el boceto) porque **esa transcripción no se guarda
  en ningún lado todavía** — la tab `reportes` solo tiene el resumen final que escribe la IA (`notas_ia`), no
  el historial de mensajes. Para tener eso hay que tocar el **motor de Marcos** (`index.js`/`sheets.js`, que
  viven en el VPS, no en este repo) para que loguee la conversación completa a medida que atiende, y agregar
  una tab/columna nueva donde guardarla. Es un cambio de arquitectura del bot, no del dashboard — Daniel
  decidió más control/transparencia sobre lo que hace Marcos (no todo queda "en manos de Marcos" a ciegas),
  así que este es un candidato fuerte para la próxima etapa grande.
- **Pendiente** (visto en el boceto de diseño, todavía no implementado):
  - Modales de verdad (ventana superpuesta) para "Agregar cliente" y "Agregar edificio" — hoy son formularios
    inline dentro de la página, no un overlay flotante como el boceto.
  - "Ver como cliente" (impersonación) desde el menú del dueño.
  - Resumen del cliente con desglose "Estado del edificio" (Reclamo/Reserva/Seguridad/Aviso) y "Costos en
    divisa" (USD/EUR).

## Diseño hifi (handoff pendiente de implementar)

- Carpeta: `design/` — prototipo de alta fidelidad hecho con Claude Design.
  - `README.md` — especificación completa: roles, pantallas, tokens, mapeo a Sheets. **Leer primero.**
  - `Panel Consorcio.dc.html` — el diseño explorable (abrir en navegador). Corre sobre `support.js`
    (runtime del prototipo, NO va a producción). Solo sirve de referencia visual/de interacción.
  - `image-slot.js` — componente de placeholder de logo, solo del prototipo.
- Diferencias grandes vs. el dashboard actual (`dashboard.js`):
  - Paleta de marca definida (azul `#1E5FB4`/`#2E6FC0`, dorado `#D99B1F`, tipografía Hanken Grotesk) —
    el dashboard actual es un tema oscuro genérico, hay que rehacer el look.
  - Nuevas secciones: **Expensas** (el cliente sube PDF/imagen/link), **Consumos** (uso vs plan,
    excedente facturable), **Clientes** (alta/gestión de administradores, hoy es 1 env var),
    **Notificaciones** (campana con contador).
  - **Impersonación**: el dueño puede "Ver como cliente" para revisar exactamente lo que ve un admin.
  - Auth real con activación por token + recuperación de contraseña (reemplaza `CONSORCIO_USERS` en `.env`).
  - Drawer de detalle de evento con conversación completa (WhatsApp en burbujas / transcripción de llamada).
  - Multi-operador: "Marcos", "Susana", "Lucía" rotan según turno — el vecino nunca debe notar que es IA;
    el admin de edificio sí sabe que es IA.
- Cuentas de prueba del prototipo: `daniel / sistema2025` (dueño), `amato_admin / demo1234` (cliente).

## Regla de oro

**Los vecinos NO deben saber que Marcos es IA.** Marcos se comporta como humano, usa expresiones argentinas, rechaza preguntas sobre si es robot de forma natural.

## Pendientes

- [x] Aplicar últimos cambios del dashboard en VPS (curl + pm2 restart)
- [x] Verificar que los eventos aparecen en el dashboard (fix de columnas)
- [x] Rediseño visual completo (sidebar + paleta de marca + logo real)
- [x] Sección Clientes (alta desde el dashboard, tab `clientes` en Sheets)
- [ ] Expensas: nueva sección para que el cliente suba PDF/imagen/link mensual
- [ ] Auth real: contraseñas hasheadas (bcrypt), activación por token, recuperación por email
- [ ] Consumos / facturación por excedente: derivar uso de los logs de Marcos, definir precios
- [ ] Notificaciones con contador real (hoy la campana es solo visual)
- [ ] Impersonación ("Ver como cliente") para el dueño
- [ ] Twilio + chip Movistar: agregar `VAPI_API_KEY`, `TWILIO_*` al `.env`
- [ ] Test end-to-end WhatsApp + llamadas
