# Bien Argentinos — Marcos IA

## Accesos VPS (DonWeb)

```
ssh -p5436 root@200.58.102.182
```

> [!CAUTION]
> **Ninguna credencial va en este archivo.** El repo se hace público cada vez que se usa el `curl`
> de más abajo para bajar el dashboard, así que todo lo que esté acá es público en ese rato. La
> contraseña de root va en el gestor de contraseñas, no acá.

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

## REGLA DE ORO DE DESPLIEGUE Y DEPENDENCIAS (GITHUB = FUENTE DE VERDAD)

> [!CAUTION]
> **CONTRATO OBLIGATORIO PARA TODOS LOS AGENTES (Claude, Antigravity, Gemini, ChatGPT, etc.)**:
> - **GitHub es la ÚNICA fuente de verdad**: Todo cambio de código debe commitearse y enviarse a GitHub (`bienargentinos/Bien-Argentinos-repositorio-`). El VPS se actualiza **únicamente mediante `git pull`** y `pm2 restart marcos-ai`.
> - **Prohibido modificar archivos a mano en el VPS**: No se deben subir scripts ni parchar archivos de código directamente en el servidor sin pasar por Git.
> - **Inclusión de Dependencias NPM en el Mismo Commit**: Si se utiliza una librería nueva (`npm install`), la adición en `package.json` y `package-lock.json` **DEBE ser commiteada en el mismo commit de Git** que el código que la invoca. Ningún archivo debe hacer `require()` de un paquete no declarado en `package.json`.

## Stack técnico

- **Runtime**: Node.js + Express — `index.js` es el servidor principal (acumulación de **25 segundos** en ráfagas).
- **IA**: Google Gemini 2.5 Flash (multi-agente: marcos-caso, marcos-cara, marcos-ops, marcos-docs, marcos-admin)
- **WhatsApp**: Meta WhatsApp Cloud API → webhook en `/webhook`
- **Llamadas**: Vapi → endpoints `/vapi` y `/vapi/llamada-finalizada`
- **Voz TTS**: ElevenLabs (solo primeros 2 audios por sesión en 24h, luego texto)
- **Base de datos**: SQLite Local (`db.js`) en `marcos_database.sqlite` + Google Sheets (`sheets.js`) como respaldo.
- **Dashboard**: `dashboard.js` montado en `/admin` (Visor de chats mensaje a mensaje y búsqueda global <10ms).

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
  - `proveedores`: (la crea el dashboard) **lista MAESTRA por cliente**: cliente, rubro, nombre, telefono,
    notas, estado. El cliente carga cada técnico UNA sola vez (no por edificio). Ej: el electricista de un
    admin con 27 edificios se carga una vez acá.
  - `proveedor_asignaciones`: (la crea el dashboard) cliente, edificio, proveedor, rubro, telefono,
    prioridad (primera/segunda/urgencias), estado. Vincula un proveedor de la lista maestra a un edificio
    puntual con su prioridad. Marcos lee esta tab: `edificio + rubro` → proveedor ordenado por prioridad
    (denormaliza nombre/telefono/rubro para no tener que hacer join).
- IMPORTANTE: el dashboard apunta a estas tabs por defecto. Overrides en `.env`: `SHEET_TAB_EVENTOS`,
  `SHEET_TAB_EDIFICIOS`, `SHEET_TAB_ARCHIVOS`, `SHEET_TAB_CLIENTES`, `SHEET_TAB_EXPENSAS`,
  `SHEET_TAB_PROVEEDORES`, `SHEET_TAB_ASIGNACIONES`.

## Mi Edificio (lado cliente) — qué edita sin permiso vs. con aprobación

- **Edita DIRECTO el cliente** (se guarda al instante, botón "Guardar cambios del edificio"): dirección, zona,
  alias/doble dirección, CUIT, unidades funcionales, horario del SUM, cocheras, tel. seguridad de la entrada,
  encargado (nombre/tel), suplente (nombre/tel), **estado del encargado** (activo/licencia/vacaciones) y
  **horario del encargado** con selectores de hora (relojito): 2 rangos Lun-Vie + 1 Sábados, se serializa a
  JSON `{lv1:[hh,hh],lv2:[...],sab:[...]}` en la celda `encargado_horario`. Aparece solo si está activo.
  Endpoint `POST /api/mi-edificio`.
- **Proveedores (flujo de 2 pasos, para no recargar 27 veces)**: (1) el cliente carga su **lista maestra**
  una vez (modal "Mi lista de proveedores") → `POST /api/proveedor`; (2) en cada edificio **asigna** desde un
  desplegable de su lista + prioridad → `POST /api/proveedor-asignar`. Quitar: `/api/proveedor-quitar` (de la
  lista) y `/api/proveedor-desasignar` (del edificio).
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

## Reset de pruebas (`reset-test.js`, vive en el VPS)

Para que Marcos "no te reconozca" y poder repetir un test end-to-end desde cero se vacían
**solo estas tres pestañas** de Sheets:

- `VECINOS`
- `EVENTOS`
- `memoria`

> [!CAUTION]
> **NUNCA vaciar `CLIENTES`** (ni `EDIFICIOS`, `proveedores`, `proveedor_asignaciones`). Eso es
> configuración, no dato de prueba: `clientes` guarda usuario/contraseña/email de cada administrador
> y es de donde Marcos saca el mail para avisar de una urgencia. Borrarla rompe el login del
> dashboard y la notificación al admin.

El lado PostgreSQL se limpia aparte (la BD se llama `marcos_db`, no `marcos_ia`):

`reset-test.js` limpia **los dos lados de una sola vez** — Sheets y PostgreSQL:

```bash
node reset-test.js
```

Del lado PostgreSQL vacía `mensajes`, `mensajes_wa`, `reportes`, `vecinos`, `memoria`, `accesos`,
`audios_tts` y `facturas`, y además borra el contenido de `almacenamiento/` (los audios, fotos y
comprobantes que se subieron durante la prueba). Está adentro del script y no como comandos sueltos justamente para que no pueda quedar
a medias: un reset parcial es peor que ninguno, porque parece limpio y no lo está.

`mensajes` es la que alimenta el **visor de chat del dashboard**, y es la que más confusión genera:
vaciar `EVENTOS` en Sheets borra el caso, pero las burbujas de la conversación siguen en esta tabla
y el panel las vuelve a mostrar mezcladas con el caso nuevo. Si el visor muestra chats de pruebas
viejas, es porque falta este DELETE.

`accesos` guarda lo que Marcos aprendió de las conversaciones sobre instalaciones del edificio
(quién tiene la llave de qué). En un reset de prueba conviene vaciarla porque se llenó con datos de
la conversación borrada.

`audios_tts` guarda cuándo se le mandó cada nota de voz a cada teléfono, para sostener el techo de
2 por 24h a través de los reinicios de PM2. Vaciarla devuelve los 2 audios y hace falta para
repetir un test que incluya la voz — **es lo único de la lista que se borra por comodidad de
prueba y no porque sea rastro de la conversación**. En producción no se toca.

Nota: el proceso de PM2 se llama **`marcos-ai`** (no `marcos-ia`).

**Borrado total** (clientes, proveedores, edificios, asignaciones y multimedia de
`almacenamiento/`): se hace **únicamente cuando Daniel lo pide de forma explícita**. Está previsto
para el momento previo a mandar el sistema a probar afuera, con la base limpia de punta a punta.
Nunca por iniciativa propia ni como parte de un reset de test.

## Regla de oro

**Los vecinos NO deben saber que Marcos es IA.** Marcos se comporta como humano, usa expresiones argentinas, rechaza preguntas sobre si es robot de forma natural.

## Identidad del proveedor: teléfono + rubro, no solo teléfono (IMPLEMENTADO)

Un teléfono **no** identifica a una persona: puede ser la línea de una empresa con varios oficios
detrás. Caso real de esta planilla: el `541169241157` figura como **julio (plomero)** y como
**dario juju (electricista)** — dos técnicos de la misma empresa compartiendo la línea.

`buscarRolPorTelefono` devuelve el primero que encuentra, así que en un caso de electricidad
Marcos saludaba "Gracias, Julio" cuando quien contestaba era Dario. Para el técnico eso es Marcos
hablándole a otra persona, y le da lo mismo que el resto funcione.

Daniel lo confirmó y está implementado: se identifica por la terna **teléfono + rubro del caso**.

- `proveedoresPorTelefono(telefono)` (en `datos.js`, con las dos implementaciones) lista todos los
  técnicos de esa línea con su rubro.
- `buscarCasoAbiertoPorTecnico` y `buscarCasosRecientesPorTecnico` devuelven el `rubro` del caso.
- `index.js` guarda ese rubro en `stProv.rubroActivo` y, cuando hay más de un técnico en la línea,
  elige por rubro en vez de por el orden de la planilla. Las equivalencias entre formas de nombrar
  un oficio están en `coincideRubroTecnico` ("electricidad" = "electricista" = "luz").
- **Sin caso no hay rubro con qué desempatar.** Ahí se marca `datosEmisor.nombreIncierto` y Marcos
  **no lo llama por su nombre**: elegir uno al azar entre varios es peor que no nombrarlo.

Prueba: `node pruebas-tecnico-por-rubro.js` (15 casos, con Julio y Dario en la misma línea).

## Datos de cobro del proveedor (CBU / alias)

Marcos toma el CBU o el alias cuando el técnico se lo manda por WhatsApp, para que el
administrador tenga a quién pagarle sin salir a buscarlo. Columnas nuevas en `proveedores`
(se crean solas): `cbu`, `alias_cbu`, `titular`, `cuit`, `cbu_actualizado`, `cbu_pendiente`,
`alias_pendiente`, `cbu_pendiente_desde`.

**Llegan por texto, por imagen o por PDF — nunca por audio.** Las tres vías están cubiertas:
escrito en el chat, en una constancia de CBU (foto del homebanking o PDF), y **al pie de la propia
factura**, que es la forma más común de todas. `marcos-docs.js` distingue una constancia bancaria
de una factura: antes ese PDF se archivaba como si fuera un gasto del consorcio.

**Se verifica antes de guardar.** El CBU trae dos dígitos verificadores; `cbu.js` los calcula.
Con OCR de por medio esto importa más que al tipear: un 8 leído como 6 en una foto sacada de
costado no lo ve nadie, y son 22 números seguidos. Si no verifica NO se guarda — se pide el alias,
que es corto y se lee bien. Las pruebas cubren los 126 casos de un dígito cambiado, las 11
transposiciones de dígitos vecinos y las confusiones típicas del OCR (8/6, 1/7, 5/6):
`node pruebas-cbu.js` y `node pruebas-cbu-por-imagen.js`.

El CBU que viene al pie de una factura solo se toma **si la manda el propio técnico**. Reenviada
por un vecino o el encargado no se usa: puede ser vieja, reenviada, o de otro proveedor.

> [!CAUTION]
> **UN CAMBIO DE CBU NO SE APLICA SOLO.**
>
> Cambiar el CBU de un proveedor es el fraude más común que existe: alguien se mete en la
> conversación, dice "cambié de banco, anotá este otro", y el pago del mes siguiente se va a otra
> cuenta. Acá la identidad es apenas un número de teléfono.
>
> La primera carga se aplica. Un cambio posterior NO pisa lo que había: queda en `cbu_pendiente`,
> **el anterior sigue siendo el vigente**, y se le avisa a la Administración para que lo apruebe
> desde el panel (`/api/proveedor-cambio-cobro`). Si el cambio es legítimo, el proveedor cobra unos
> días más tarde; si no lo es, no se pierde la plata. De los dos errores posibles, ese es el que se
> puede deshacer.
>
> Prueba: `node pruebas-cambio-cbu.js`.

**En una línea compartida no se elige al azar.** Si dos técnicos comparten el teléfono (Julio y
Dario) y no se sabe cuál escribe, Marcos **pregunta a nombre de cuál anota los datos** en vez de
escribirlos en una fila cualquiera: los datos de cobro de uno no son los del otro, y equivocarse
manda el pago a otra persona.

## La ventana de 24hs de Meta (por qué al técnico le llegaba SOLO la plantilla)

> [!CAUTION]
> **Con la ventana cerrada, Meta deja pasar ÚNICAMENTE plantillas aprobadas.** Texto libre, foto,
> video, ficha de contacto y audio se rechazan con el código **131047**. Y la ventana **no la abre
> la plantilla que mandamos nosotros**: la abre **el técnico cuando responde**.

Marcos mandaba las cuatro cosas seguidas (plantilla → foto del reclamo → ficha de contacto →
contacto de acceso), así que llegaba la plantilla sola y el resto rebotaba un segundo antes de que
la ventana se abriera. En el log:

```
📷 Foto/video del vecino reenviado al técnico a dario juju (541169241157).
📵 META RECHAZÓ LA ENTREGA a 5491169241157 [código 131047]: Re-engagement message
```

En las pruebas nunca se vio porque se hacían todas seguidas desde el mismo número: la ventana
estaba siempre abierta.

**Cómo quedó resuelto**:

- `material-caso.js` — `materialDelVecinoEnCaso(idEvento, telVecino)`: recupera la foto/video del
  historial del caso y del disco, no de RAM. Lo usan `index.js` y `agentes/marcos-ops.js`.
- `index.js` — `entregarPendientesAlTecnico(...)`: se llama en **cada mensaje entrante del
  proveedor**, que es el instante exacto en que Meta abre la ventana, y entrega lo que había
  rebotado. Da igual si el técnico escribe "ok", un punto o aprieta el botón de la plantilla.
- Las marcas de entregado viven en el **caso** (columnas `material_enviado_tecnico` y
  `contacto_acceso_avisado` de `EVENTOS`), no en RAM, porque PM2 reinicia seguido. **Solo se marcan
  si el envío salió de verdad**: marcar un envío fallido impide el reintento para siempre.
- La plantilla avisa que hay material esperando (`Contestame por acá (un OK alcanza) y te paso la
  foto del problema y el contacto para entrar.`), porque es el único canal abierto para decírselo.
  La frase se arma según lo que realmente haya; si no hay nada, no se promete nada.
- Prueba: `node pruebas-ventana-24hs.js`.

**Meta permite tener varias plantillas**, pero una plantilla NO sirve para mandar la foto del
reclamo: la imagen de una plantilla se sube al aprobarla y es fija. La foto de hoy solo sale como
mensaje libre, o sea con la ventana abierta.

### Otros dos arreglos del mismo episodio

- **Marcos le decía al técnico "el vecino no ha provisto detalles adicionales ni material
  gráfico"** cuando el vecino había mandado foto, dos audios y una ficha de contacto.
  `generarRespuestaTecnicoLibre` no recibía ningún dato sobre el reclamo y el modelo llenaba el
  hueco. Ahora recibe el caso, el rubro y si hay material guardado, y tiene prohibido afirmar que
  el vecino no mandó nada.
- **Marcos le pedía el número de departamento a alguien que vive en una casa** (`san patricio
  casa`), así que la ficha no se completaba nunca y volvía a preguntar en cada vuelta.
  `marcos-cara.js` ya no pide departamento cuando el edificio es casa/PH o tiene una sola unidad
  (`tipo` y `unidades` de la tab `edificios`, ahora expuestos en `buscarPerfilEdificio`).

## El nombre del edificio está copiado en todos lados (por qué el apóstrofe "volvía solo")

> [!CAUTION]
> **No hay un id de edificio: el nombre ES la clave.** Está escrito como texto en `EDIFICIOS`, en
> cada fila de `EVENTOS`, `facturas`, `vecinos`, `solicitudes`, `sugerencias`, `expensas`,
> `proveedor_asignaciones`, y dentro de la lista separada por comas de `CLIENTES.edificios`.

Dos cosas hacían que una corrección de nombre se deshiciera sola:

1. **`EDIFICIOS` tiene el nombre en dos columnas** (`edificio` y `nombre`), que son alias del
   mismo dato. El panel las lee en un orden (`edificio` primero, `mapEdificio`) y el motor de
   Marcos en el otro (`nombre` primero, `listarEdificiosConocidos`). Mientras se escribía solo en
   la primera que apareciera, cada edición dejaba la otra con el valor viejo y lo que se veía
   dependía de quién miraba. Resuelto con `columnasDelCampo()` en `dashboard.js`: **se escribe en
   TODAS las columnas que son ese campo**, en `/api/edificio`, en `guardarCamposEdificio()`
   (Mi Edificio) y en `/api/aprobar-solicitud`.
2. **Renombrar en `EDIFICIOS` y en ningún otro lado parte el edificio en dos.** Las filas viejas
   seguían diciendo `san patricio 27'0 casa` y el panel las mostraba tal cual. Ahora al aprobar una
   solicitud de cambio de nombre se renombran también todas las referencias en las otras pestañas.
   La comparación es **exacta y normalizada**, no `compararEdificios` (que acepta coincidencias
   parciales y se llevaría por delante al 159 al renombrar el 270).

**Diagnóstico**: `node buscar-texto.js "27'0"` recorre todas las pestañas de Sheets y todas las
tablas de PostgreSQL y dice en qué celda exacta está el texto. Mientras quede una copia sin
corregir, el dato vuelve. Solo lee.

Prueba: `node pruebas-renombrar-edificio.js`.

> Ojo: un apóstrofe **al principio** de una celda de Google Sheets no es parte del texto, es la
> marca de "esto es texto y no un número" y no se ve en la planilla. Uno en el **medio** (`27'0`)
> sí es un carácter real.

## De quién es cada edificio (por qué uno "desaparecía" de su administrador)

La lista `edificios` de la tab `CLIENTES` y el nombre del edificio en `EDIFICIOS` son **dos textos
escritos a mano en pestañas distintas**. El panel los comparaba con `Array.includes`, que exige que
sean idénticos carácter por carácter: una mayúscula distinta y el edificio figuraba **"Sin
asignar"** aunque en la planilla estuviera clarísimo al lado del administrador (y la ficha del
cliente le contaba 2 edificios en vez de 3).

- `clienteDelEdificio(clientes, nombre)` y `edificiosDeCliente(edificios, cliente)` en
  `dashboard.js` comparan **normalizado** (mayúsculas, acentos, espacios) pero **exacto**.
- **No se usa `compararEdificios`**: ese acepta coincidencias parciales, y con eso el 159 quedaría
  asignado al cliente que tiene el 270 — un administrador viendo reclamos de un consorcio ajeno.
- `/api/edificio-nuevo`: si el edificio **ya existe y no lo tiene nadie**, lo *asigna* en vez de
  cortar con "ya existe" (antes no había ninguna pantalla para asignar uno suelto). Si ya lo tiene
  otro administrador, dice quién y no lo mueve solo.

Prueba: `node pruebas-cliente-edificio.js`.

### Las dos bases: qué lee cada uno

| Quién | De dónde lee |
|---|---|
| Panel (`dashboard.js`, `readTab`) | Google Sheets |
| Motor de Marcos (`datos.js`) | PostgreSQL primero, Sheets de respaldo |
| Permisos del cliente (`obtenerEdificiosPermitidosUsuario`, `expandirEdificiosPermitidos`) | **PostgreSQL**, aunque corran dentro del panel |

Por eso **renombrar solo en Sheets no alcanza**: Marcos sigue llamando al edificio por el nombre
viejo y al cliente le queda el permiso apuntando a un edificio que ya no se llama así. La
aprobación de una solicitud de nombre ahora renombra en **los dos lados**.

> [!CAUTION]
> **No arreglar esto reimportando.** `importar-sheets-a-pg.js` sincroniza `edificios` usando la
> columna `edificio` como **clave**. Si en Sheets ya está el nombre nuevo y en PostgreSQL el
> viejo, no actualiza la fila: **crea una segunda**. Para corregir datos ya desfasados está
> `renombrar-edificio.js`, que cambia la fila que existe.

**Herramientas**:

```bash
node buscar-texto.js "27'0"                                    # solo lee: dice en qué celda está
node renombrar-edificio.js "nombre viejo" "nombre nuevo"        # muestra qué cambiaría
node renombrar-edificio.js "nombre viejo" "nombre nuevo" --aplicar
```

## Cuándo Marcos pide el número de unidad

Lo decide el **conteo de unidades** de la tab `edificios`, no el nombre. `san patricio casa` se
llama así --es un alias interno-- y **tiene 3 unidades**: ahí hay que preguntar. Adivinar por la
palabra "casa" en el nombre daba exactamente al revés.

- `unidades >= 2` → se pregunta. `unidades <= 1` → no se pregunta (no existe el dato).
- Sin conteo cargado, decide `tipo` (casa/PH/dúplex/chalet → no se pregunta).
- En una casa o PH con varias viviendas la unidad existe pero **no se llama "departamento"**
  (suele ser "casa 2", "fondo", "PB"): Marcos pregunta por el "número de unidad".

Prueba: `node pruebas-unidad-vecino.js`.

## Modificaciones Recientes de Visualización, Multimedia y Chat

### 1. Separación de Chats y Eliminación de Duplicados en Dashboard
- `dashboard.js` (`separarConversacionesEvento`): Ahora procesa de forma estricta y prioritaria `chat_vecino_json` y `chat_proveedor_json` como fuentes independientes. Se eliminó la sobreescritura/concatenación con `historial_chat` que provocaba repetición de mensajes y cadenas concatenadas tipo Frankenstein.
- `procesarLineaMultimediaChat`: Sanitización automática de residuos de etiquetas o rutas (`/archivos/...jpeg]`, corchetes huérfanos).

### 2. Visor Multimedia HD y Soporte PDF / Facturas en Chat
- **Imágenes / Fotos**: Los IDs numéricos de Meta (ej. `1388680856523978`) se reconocen como imágenes según contexto y tipo, evitando el fallback erróneo a notas de voz. Se renderiza tarjeta visual con miniatura, botón **"🔍 Ver HD"** y visor modal.
- **Documentos / PDF**: Detección de etiquetas `[DOCUMENTO:...]` y `.pdf`. Genera tarjeta interactiva 📄 con nombre de archivo real (`filename`), N° de factura y monto reconocidos por OCR, botón **"⬇️ Descargar PDF / Comprobante"** y **"👁️ Ver Documento"**.

### 3. Registro Integral de Envíos de Marcos a Proveedores (`chat_proveedor_json`)
- Al despachar o actualizar un caso al técnico en `marcos-ops.js` e `index.js`, se persisten en el historial del proveedor:
  1. Plantilla oficial de Meta WhatsApp de asignación inicial.
  2. Retransmisión de fotos/videos del reclamo (`[IMAGEN:...] Foto del reclamo reenviada al técnico`).
  3. Mensaje de contacto de ingreso (`📞 Contacto para el ingreso`).
  4. Ficha de contacto compartida (`(Contacto compartido)`).
  5. Confirmaciones de facturas y respuestas a consultas de estado/pago.

### 4. Persistencia Dual Sheets / PostgreSQL
- Sincronización de `tel_tecnico` y `rubro_tecnico` en `datos.js` y `datos-pg.js` al actualizar reportes y eventos.

## Pendientes

- [x] Aplicar últimos cambios del dashboard en VPS (curl + pm2 restart)
- [x] Verificar que los eventos aparecen en el dashboard (fix de columnas)
- [x] Rediseño visual completo (sidebar + paleta de marca + logo real)
- [x] Sección Clientes (alta desde el dashboard, tab `clientes` en Sheets)
- [x] Visor interactivo de chats (Separación Vecino/Proveedor, imágenes HD, PDFs con descarga)
- [x] Datos de cobro del proveedor (CBU/alias) con verificación y aprobación de cambios
- [ ] Expensas: nueva sección para que el cliente suba PDF/imagen/link mensual
- [ ] Auth real: contraseñas hasheadas (bcrypt), activación por token, recuperación por email
- [ ] Consumos / facturación por excedente: derivar uso de los logs de Marcos, definir precios
- [ ] Notificaciones con contador real (hoy la campana es solo visual)
- [ ] Impersonación ("Ver como cliente") para el dueño
- [ ] Twilio + chip Movistar: agregar `VAPI_API_KEY`, `TWILIO_*` al `.env`
- [ ] Test end-to-end WhatsApp + llamadas
