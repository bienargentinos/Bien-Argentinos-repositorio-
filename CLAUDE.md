# Bien Argentinos — Marcos IA

## Accesos VPS (DonWeb)

**Se entra SOLO con clave SSH. El login por contraseña está apagado en el servidor**
(`PasswordAuthentication no`), así que no hay contraseña que pedir, escribir ni perder.

```
ssh -i ~/.ssh/marcos_vps -p5436 root@200.58.102.182
```

Desde Windows la ruta de la clave se escribe según la terminal: `$env:USERPROFILE\.ssh\marcos_vps`
en PowerShell, `%USERPROFILE%\.ssh\marcos_vps` en CMD. Un agente que se conecta por código pasa la
**ruta** del archivo, nunca su contenido:

```js
privateKey: require('fs').readFileSync(process.env.USERPROFILE + '\\.ssh\\marcos_vps')
```

> [!CAUTION]
> **Ninguna credencial va en este archivo, ni en un comando, ni en un mensaje.** El repo se hace
> público cada vez que se usa el `curl` de más abajo, así que todo lo que esté acá es público en
> ese rato. Y un comando con la contraseña adentro queda en el historial de la terminal y en el
> log del agente que lo corrió — así fue como se filtró la de root, después de haberla sacado de
> este archivo. La clave privada (`~/.ssh/marcos_vps`) tampoco se comparte: se comparte la
> **pública** (`.pub`), que es la que va al servidor.
>
> Si alguna credencial se expone, cambiarla es lo único que la invalida: borrarla del archivo no
> la borra del historial de git ni de los logs.

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

### Un reclamo no lo abre solo el vecino

Marcos se mete en una relación que ya existe: el administrador y sus proveedores vienen
trabajando por WhatsApp desde antes. Si el administrador deja de atender el teléfono, **Marcos
tiene que hacer lo que él hacía**.

- **Encargado, limpieza, seguridad y el propio administrador** ya podían abrir un caso: caen al
  camino común de un reclamo.
- **El proveedor** era el único que no podía, porque su rama del webhook corta antes. Ahora, si
  avisa que lo convocaron y que va (`"me llamó el encargado de San Patricio 159, voy a pasar"`),
  se abre el caso y **se le avisa a la Administración en ese momento** — que es la llamada que
  antes recibía el administrador. Sin eso, el trabajo aparecía recién con la factura, días
  después, y nadie sabía que se estaba haciendo.
- Tiene que **nombrar el edificio** y que sea de su cartera. Si avisa sin decir adónde, se le
  pregunta: es un dato que solo él tiene.
- El caso queda como su caso activo, así la foto y la factura que mande después caen ahí.
- Prueba: `node pruebas-aviso-proveedor.js`.

### Toda factura del técnico deja un evento

Antes hacía falta que contara qué hizo (20 caracteres) para que se abriera el caso. Sin eso la
factura quedaba archivada y **no existía el evento**: el administrador veía un gasto suelto, sin
conversación, sin el teléfono del técnico y sin poder preguntarle nada.

Y ese es el caso **normal**, no la excepción: al técnico lo llama el encargado, hace el trabajo y
manda la factura. Nunca hubo reclamo por este canal. El evento es lo único que le da contexto al
gasto — es exactamente lo que el administrador tenía antes en su propio WhatsApp.

El evento guarda la conversación completa (la pregunta de Marcos y lo que contestó el técnico), el
número de factura, el monto y el teléfono del proveedor.

### "El último caso" no es el que PostgreSQL devuelve último

> [!CAUTION]
> **`SELECT * FROM reportes` sin `ORDER BY` no promete ningún orden.** Y en PostgreSQL una fila
> **actualizada se mueve al final del heap**, así que "la última fila" es la que se tocó hace
> menos, no la más nueva.

Caso real: Daniel tenía abiertos el **CASO-1001** (de días atrás, en `san patricio casa`) y el
**CASO-1003** (de esa tarde, en `san patricio 270`). Mandó la foto y la factura del 1003, y Marcos:

1. cerró el **1001** con un "✅ RECLAMO SOLUCIONADO" que hablaba de otra reparación,
2. archivó la factura contra el **1001**,
3. y al corregirlo le contestó con el contacto de ingreso del edificio del 1001.

Los tres salen de `[...abiertos].reverse().find(...)`. El 1001 venía recibiendo líneas de chat todo
el tiempo, y cada `UPDATE` lo empujaba al final del heap hasta quedar "último".

`caso-reciente.js` (`elegirCasoMasReciente`) ordena explícito: **primero el número de caso**
(`CASO-1003 > CASO-1001`, que es una secuencia nuestra) y, sin número, la fecha — leída con el
formato argentino `27/08/2026, 19:38:21`, que `new Date()` interpreta al revés o no lee.

> Ojo: el número se compara **como número**. Como texto, `"CASO-999" > "CASO-1003"`.

Cuando hay más de un caso abierto, el log dice cuál eligió y por qué. Con dos casos abiertos, saber
a cuál se le imputó todo es la diferencia entre encontrar esto en cinco minutos o en una semana.

Prueba: `node pruebas-caso-reciente.js`, con un candado que prohíbe volver a decidir por el orden
físico en cualquier función que lea `reportes`.

### A qué caso se le imputa una factura

> [!CAUTION]
> **Un solo caso reciente no es una respuesta para siempre.** La regla vieja decía "si el técnico
> tiene un único caso reciente, la factura es de ese caso". Para la PRIMERA factura está bien; para
> la segunda es una adivinanza. Visto en el chat real: dos comprobantes distintos, con números
> distintos, los dos *"asociados al CASO-1001"*, y el panel sumando los dos montos en el mismo
> consorcio.

Con un técnico que trabaja para **once administradores** eso está garantizado: manda seis
comprobantes de obras distintas y los seis se pegan al mismo caso.

- La señal es que **el caso ya tenga su factura** (`casoYaTieneFactura`). Si ya la tiene, la que
  llega es de otro trabajo: se pregunta mostrando la lista, en vez de adivinar.
- La factura ahora guarda **`id_evento`**. Antes el caso se le decía al técnico por WhatsApp
  ("la dejé asociada al CASO-1001") y no quedaba escrito en ningún lado.
- **La misma factura mandada dos veces no se duplica.** Se identifica por número de comprobante +
  proveedor, ignorando los ceros de adelante (`0001-284` y `00001-284` son la misma). Sin número
  no se bloquea: perder una factura es peor que tener dos.
- Un caso **cerrado** recibe su factura igual — es el caso normal: el trabajo termina, el caso se
  cierra, y el comprobante llega una semana después.
- Prueba: `node pruebas-factura-a-que-caso.js`.

### "Marcos tiró la factura a la basura" — cómo distinguir qué pasó

Cuando un técnico manda una factura y en el panel no aparece, hay tres cosas distintas que desde
afuera se ven igual:

1. **No la reconoció como factura** → no hay fila en ningún lado. El log lo dice ahora:
   `🧾❔ NO se trató como factura un mensaje de …` con qué condición falló.
2. **La reconoció pero no supo de qué edificio es** → la fila **está**, con estado `Sin imputar`.
   No se perdió: Marcos le preguntó al técnico de qué obra era y espera respuesta.
3. **Se guardó en otra pestaña.** `guardarFactura` buscaba `sheetsByTitle['facturas']`, que
   distingue mayúsculas: con la pestaña escrita distinto no la encontraba y **creaba una segunda**.
   Las facturas iban a la nueva y quien miraba la vieja las daba por perdidas.

```bash
node revisar-facturas.js            # solo lee: últimas facturas y estado de cada una
pm2 logs marcos-ai --lines 300 --nostream | grep "🧾"
```

Las 33 búsquedas de pestaña por índice en `sheets.js` pasaron a `pestaña()`, que la encuentra
escrita como esté. `pruebas-pestanias.js` ahora **prohíbe** el acceso por índice en `sheets.js`
fuera de la propia `pestaña()`, así el problema no puede volver por otra función.

### Una hoja de Google tiene 26 columnas, y `EVENTOS` necesita más de treinta

> [!CAUTION]
> **Cuando no entra una columna más, `addRow` DESCARTA EN SILENCIO todo lo que iba en ella.**
> El dato se pasa completo, la función devuelve bien, el log dice que se guardó, y la celda queda
> vacía.

`setHeaderRow` se planta con *"Sheet is not large enough to fit N columns. Resize the sheet
first."* — y los **doce** lugares de `sheets.js` que creaban columnas lo atrapaban con
`.catch(() => {})`. Es el mismo error de siempre: **hacer algo y no verificar que haya quedado
hecho.**

Así se perdieron `tecnico`, `tel_tecnico` y `rubro_tecnico` en los cuatro primeros casos reales.
`tel_tecnico` es el teléfono de quien está escribiendo: **no puede estar vacío**, y en la planilla
estaba vacío en los cuatro. Lo que eso rompía:

- El administrador veía casos **abiertos sin nadie a quien llamar**.
- Con el rubro vacío quedaba muerto **todo lo que depende de él**, sin que nada avisara: la
  separación de un reclamo nuevo (`coincideRubro`), cuál de los técnicos de una línea compartida
  escribió, y a qué caso se le imputa una factura.

Ahora todo pasa por `asegurarColumnas(sheet, necesarias, quien)`, que **agranda la hoja antes de
escribir** y grita si no puede. Dos detalles que importan:

- **Las columnas que ya están no se reordenan ni se tocan**: los datos de las filas viven por
  POSICIÓN, no por nombre. El `new Set([...headers, ...necesarias])` de antes además **colapsaba
  las columnas sin título en una sola**, y a partir de ahí cada columna quedaba con el nombre de
  la de al lado. Se agrega solo al final.
- **Un encabezado repetido rompe la pestaña entera** (`Duplicate header detected`): la librería se
  planta y desde ahí no se puede leer ni escribir por nombre. Eso se arregla **a mano** en la
  planilla — el código solo puede decirlo fuerte.

```bash
node revisar-columnas.js            # solo lee: si a alguna pestaña le falta lugar, lo dice
node crear-columnas.js              # muestra qué columnas crearía, no toca nada
node crear-columnas.js --aplicar    # las crea (solo agrega al final; no renombra ni reordena)
```

`asegurarColumnas` ya lo arregla solo, pero recién la próxima vez que Marcos escriba en esa
pestaña. `crear-columnas.js` lo hace ahora, para dejar el terreno parejo antes de una prueba.
**No rellena los casos viejos**: un caso guardado sin `tel_tecnico` porque la columna no existía
ya perdió ese dato.

La lista de qué necesita cada pestaña vive en `columnas-necesarias.js`, en un solo lugar, y una
prueba verifica que ninguna pestaña donde el código crea columnas quede afuera de esa lista.

Pruebas: `node pruebas-columnas.js`. Incluye un candado estructural: **ningún `setHeaderRow` puede
volver a tragarse su error**, y solo se lo puede llamar desde `asegurarColumnas`.

### Avisar que lo llamaron no es decir que va

> *"Hola, me llamaron del edificio, hay una cámara que no funciona."*

Eso es un aviso a medias: el administrador tiene que enterarse igual, pero nadie sabe todavía si
el técnico va a ir, ni cuándo, ni si necesita que le abran. Antes se daba por confirmado y se
agendaba un control contra una promesa que nunca existió.

Daniel: *"si no digo que voy, que Marcos pregunte: ok gracias por avisarme, ¿vas a pasar? ¿cuándo?
¿necesitás algo que gestione? Así no espera que el tipo le diga — que indague"*.

- **`confirmaQueVa` se separó de `avisaQueVa`.** Convocado sin confirmar → el caso se abre igual,
  con estado **`avisado`**, y Marcos pregunta las tres cosas. Confirmado → `en_proceso` como antes.
- **El caso se abre en los dos casos**, y a propósito: si se esperara la confirmación para abrirlo,
  un técnico que avisa y después no contesta nunca deja al administrador sin enterarse de nada —
  que es justo el agujero que Marcos viene a tapar. **Daniel lo confirmó**: su pedido original era
  no abrirlo hasta que el técnico dijera que iba, y al ver el costo de esperar decidió que se abra
  igual. No revertir esto sin preguntarle.
- **El paso 1 del seguimiento pregunta distinto según el estado**: a un caso `avisado` le pregunta
  *"¿vas a poder pasar?"*, no *"¿pudiste pasar?"*. Reclamarle a alguien por un incumplimiento que
  nunca prometió es peor que no preguntar nada.
- **La respuesta se reconoce sin repetir nada.** "Sí, mañana a las 10" no trae verbo ni dirección
  —la acaba de decir— y ahí `pareceRespuestaDeAgenda` la engancha con el caso pendiente, que se
  busca **en la planilla** y no en RAM: PM2 reinicia seguido y una conversación a medias no puede
  depender de que el proceso siga vivo.

Prueba: `node pruebas-confirma-visita.js`.

### "Mañana a las 10" es un momento, no una duración

> [!CAUTION]
> **`estimarPlazoMs` devolvía siempre un plazo contado desde ahora.** "Mañana" eran 20 horas,
> dijera lo que dijera el técnico. Nunca miraba la hora que había prometido.

- Avisa a las **8 de la mañana** que va mañana → el control caía a las **4 de la madrugada**, antes
  incluso de la hora a la que había prometido ir.
- Avisa a las **19** que va mañana → caía a las **15** del otro día, cinco horas tarde.

`momentoPrometido(texto, ahora)` lee la hora del reloj cuando está dicha ("mañana a las 10", "a las
18", "a la tarde") y la ancla a ese momento real. Los plazos relativos ("en 30 minutos", "en 2
horas") siguen contándose desde ahora, que es lo correcto para ellos. `"voy mañana"` sin hora se
controla **al final de la jornada**: tuvo todo el día, preguntarle a las 8 AM es preguntar antes de
que empiece.

Y hay un piso: **a nadie se le pregunta nada entre las 22 y las 8**. Un "¿pudiste pasar?" a las 3
AM no lo contesta nadie, despierta a una persona y quema la confianza que Marcos necesita para
existir. `enHorarioRazonable()` corre a la mañana siguiente cualquier control que caiga afuera, y
se aplica también a los pasos 2 y 3 de la cadena.

> La cuenta de horas se hace a mano con desfase fijo `-3` (Argentina no cambia de hora desde 2009)
> y no con `toLocaleString`, por el mismo ICU reducido del VPS que obligó a escribir `fecha.js`.

Prueba: `node pruebas-horario-seguimiento.js`.

### Por qué Marcos preguntaba varias veces "¿pudiste pasar?"

El seguimiento avanza en cadena: **paso 1** se le pregunta al técnico, **paso 2** al edificio,
**paso 3** se busca suplente y se avisa a la Administración. Un barrido cada 5 minutos levanta los
casos con `proximo_seguimiento` vencido.

Al técnico le llegaba la misma pregunta repetida. Eran dos causas, y las dos son el mismo error de
fondo: **hacer algo y no verificar que la marca de "ya está hecho" haya quedado**.

1. **El barrido mandaba primero y agendaba después.** Si la planilla no se podía actualizar, el
   control seguía vencido y a los cinco minutos se mandaba de nuevo. Para siempre. Ahora se
   **reserva el próximo paso antes de mandar**: si no se puede agendar, no se manda. Un fallo
   cuesta una vuelta perdida en lugar de una repetición sin fin.
2. **Cada confirmación del técnico volvía a agendar el paso 1.** El técnico sigue escribiendo
   después de resolver —manda la factura, saluda— y cualquiera de esos mensajes leído como
   confirmación reiniciaba la cadena desde cero. `programarSeguimiento` ahora **no deja retroceder
   el paso**, respeta un control ya agendado a futuro para el mismo paso, y **no agenda nada en un
   caso resuelto o cerrado**.

Prueba: `node pruebas-seguimiento-una-vez.js`.

### Cuándo un mensaje es OTRO caso (y no la continuación del abierto)

`guardarReporte` engancha cada mensaje al caso abierto del mismo vecino o del mismo edificio. Está
bien mientras la conversación siga siendo sobre lo mismo (una foto, "¿ya viene?", un gracias).
Pero **un reclamo nuevo no es la continuación de nada**, y con la regla vieja todo lo que dijera
ese vecino caía adentro del caso abierto:

```
ℹ️ Técnico ya notificado del [CASO-1001], se omite el reenvío duplicado de la plantilla.
📊 Evento [CASO-1001] unificado/actualizado en Sheets
```

Parece una decisión correcta y era el bug: el reclamo nuevo quedaba pegado al viejo, con un solo
técnico asignado, y al técnico del caso nuevo no le llegaba la plantilla nunca. En las pruebas se
notaba porque CASO-1001 no se cerraba y **cada prueba del mismo día caía adentro**.

- Lo que distingue un reclamo nuevo es el **rubro**: una lámpara quemada no es una canilla que
  pierde. `rubros.js` (`coincideRubro`) tiene las equivalencias, compartidas con `index.js`.
- **Ante la duda no se separa**: si el mensaje no trae un problema propio, o si alguno de los dos
  lados no tiene rubro cargado, se sigue enganchando como antes. Separar de más parte un caso en
  dos y le muestra al administrador dos reclamos donde hay uno.
- Prueba: `node pruebas-caso-nuevo-o-mismo.js`.

### Una palabra suelta adentro de una expresión se come mensajes enteros

> [!CAUTION]
> **La rama del proveedor decide por coincidencia de texto, y la primera que matchea CORTA.**
> Si un mensaje cae en la rama equivocada no abre caso, no registra el reclamo y no llega a
> ningún otro camino: Marcos contesta otra cosa y listo.

Caso real: Daniel escribió que había que ver **una cámara** en San Patricio 270 y Marcos le
contestó **la lista de facturas pendientes de pago**. Dos condiciones distintas, el mismo defecto:

| Estaba | Se come | Por qué duele acá |
|---|---|---|
| `/pag\|cobr\|abon/` | a**pag**ada, se a**pag**ó, a**pag**ón | una cámara que no anda es una cámara apagada, y "se apagó" es la mitad de lo que dice un electricista en un día |
| `...\|cerradura\|ver/` | "hay que **ver**", "a **ver**", "**ver**dad", "vol**ver**" | *"hay que ver una cámara"* es un trabajo, no un pedido de datos |

- `\b` adelante arregla el primero entero: en "apagada" el `pag` no arranca en límite de palabra.
- Para el segundo lo que distingue un pedido es la **primera persona**: "necesito ver" es un
  pedido, "hay que ver" es una descripción de trabajo. `cerradura` suelta también se fue: nombrar
  una cerradura no es pedir nada, y es vocabulario diario de quien hace control de acceso.

> Se pensó excluir además "cobre" (el metal) de `/cobr/`. Daniel lo corrigió: *"no decimos cable
> de cobre casi nunca — cable es cable, no hay otro que no sea de cobre"*. El falso positivo era
> imaginario y la exclusión costaba caro: **"¿ya cobre?" sin tilde** es como se escribe de verdad.

Prueba: `node pruebas-consulta-pago.js`.

### El oficio de la persona no es el rubro del trabajo

> [!CAUTION]
> **`especialidad` es el oficio de la PERSONA. El rubro es de qué se trata ESTE trabajo.**
> Se mezclaban, y eso rompía justo lo que el rubro existe para resolver.

Caso real: Dario está cargado como **Electricista**, avisó por una **pérdida de agua**, y el caso
quedó marcado "Electricista" — el mismo rubro que su caso eléctrico abierto en ese edificio. Como
los rubros coincidían, el aviso de plomería se metió **adentro** del caso de la luz.

Y pasa siempre. Palabras de Daniel: *"yo en los edificios a veces hago electricidad, portería,
control de acceso y CCTV"*. Un mismo técnico hace trabajos de rubros distintos; su ficha no dice
cuál es el de hoy.

- `rubroDelCaso(texto, especialidad)` — **manda lo que la persona contó**; la ficha es el respaldo
  para cuando el texto no alcanza. Y `"Proveedor"` deja de escribirse como rubro: es un rol, no un
  oficio, y `coincideRubro` lo comparaba contra oficios de verdad.
- **Los mensajes de puro registro ya no reclasifican el caso.** La mayoría de los `guardarReporte`
  de un proveedor son para dejar la conversación guardada (no traen problema propio), y sin embargo
  mandaban su `rubro_tecnico` y le pisaban el rubro al caso: cualquier mensaje del electricista
  marcaba "Electricista" un caso de plomería. Ahora el rubro **se completa si está vacío y no se
  reescribe** — corregirlo es una decisión, no un efecto secundario.

### Separar casos y elegir técnico son preguntas opuestas

Las dos usaban `coincideRubro` y había que elegir cuál romper:

| Pregunta | Función | Criterio | Por qué |
|---|---|---|---|
| ¿Es el mismo trabajo? (separar un reclamo nuevo) | `coincideRubro` | **estricto** | Cambiar el portero no es poner una cámara. Si se mezclan, dos trabajos distintos quedan en un solo caso con una sola factura. |
| ¿Este técnico hace esto? (elegir a quién hablarle) | `atiendeRubro` | **amplio** | La ficha dice "Electricista" y el caso es de CCTV: es él igual. |

`rubroDelTexto` distingue ahora **portería**, **control de acceso** y **CCTV** como rubros
propios, y van **antes** que electricidad en la lista: "portero **eléctrico**" y "cerradura
**electro**magnética" contienen la palabra que dispara electricidad, así que con el orden al revés
se las llevaba todas puestas.

> Esto es el respaldo, no la respuesta buena. Lo correcto es que la ficha del proveedor liste sus
> rubros de verdad (`electricidad, portería, control de acceso, cctv`) — y eso ya funciona, porque
> la comparación mira si un texto contiene al otro.

### Cuándo se manda la plantilla, y por qué a veces "no se mandó"

La plantilla se manda **una vez por caso**, no una vez por técnico: un caso nuevo en el mismo
edificio y con el mismo técnico **sí** dispara plantilla nueva. La marca es `notificado` +
`eventoActivoId` en RAM, y `fueTecnicoNotificado(id_evento)` en la planilla para sobrevivir a los
reinicios de PM2.

> [!CAUTION]
> **Si la plantilla falla, sale un mensaje libre y parece que todo anduvo.** Meta rechaza la
> plantilla **entera** si un parámetro trae un salto de línea, un tabulador, más de cuatro espacios
> seguidos, o viene vacío. Y varios de esos parámetros los escribe el modelo a partir de lo que
> contó el vecino (`resumen_problema`): un salto de línea ahí adentro es cuestión de tiempo.
>
> Cuando pasa, sale el mensaje libre de respaldo — que **con la ventana de 24hs abierta llega**, o
> sea que en una prueba no se nota. Con la ventana cerrada, que es el caso real, también rebota y
> el técnico no se entera de nada.

- `limpiarParametroPlantilla()` normaliza **todos** los parámetros dentro de
  `enviarPlantillaWhatsApp`, no en cada llamador: cualquier plantilla nueva queda cubierta sola.
- Cuando la plantilla falla y el mensaje libre sí sale, el log lo grita: *"LA PLANTILLA DEL
  [CASO-x] NO SALIÓ … llegó SOLO porque la ventana está abierta"*. No es un éxito, es una bomba
  de tiempo.
- Prueba: `node pruebas-plantilla-meta.js`.

### El 270 y el 159 de la misma calle son dos consorcios

> [!CAUTION]
> **`buscarPerfilEdificio` decide a qué dirección se manda un técnico y a quién se le pide que le
> abra.** Equivocarse ahí no es un dato feo en el panel: es una persona parada en la puerta de
> otro consorcio, con el teléfono de un encargado que no la espera.

Caso real: Daniel avisó por una cámara en **San Patricio 270**, el panel mostraba 270, y Marcos le
contestó *"la dirección correcta es San Patricio 159, para el ingreso comuníquese con Natalia
Zeballos…"* — dirección y contacto de otro edificio.

La regla vieja juntaba **todos los números** de nombre + dirección + alias en una sola bolsa y le
alcanzaba con que **uno cualquiera** coincidiera:

```js
const numsR = (nombre + ' ' + direccion + ' ' + aliases).match(/\d+/g) || [];
return numBuscado.some(n => numsR.includes(n));
```

Nunca miraba el nombre de la calle. Un `270` escrito en los alias de una fila avalaba la dirección
`159` de esa misma fila. Y "Rivadavia 270" habría coincidido con "San Patricio 270".

`perfil-edificio.js` (`elegirFilaEdificio`) juzga **cada campo por separado** y en orden de
confianza: exacto → misma calle y misma altura → misma calle sin altura. **Una altura que se
contradice nunca coincide**, y si lo mejor que hay son dos edificios de la misma calle sin altura
con qué desempatar, **no se elige ninguno**: sin perfil, quien pregunta se queda con el nombre
interno del edificio — vago, pero no falso.

> Estaba escrito **dos veces, igual**, en `sheets.js` y en `datos-pg.js`. Y como `datos.js` lee
> PostgreSQL primero, arreglar solo el de Sheets no habría cambiado nada en producción. Ahora la
> decisión vive en un archivo y una prueba verifica que ninguna de las dos copias vuelva.

Prueba: `node pruebas-perfil-edificio.js`.

### Que alguien haya abierto una vez no quiere decir que abra siempre

> [!CAUTION]
> **Un favor puntual no es una regla del edificio.**

En el CASO-1001 no había nadie para abrir y Natalia se ofreció **esa vez**. Marcos guardó su
teléfono y desde ahí lo entregó como si fuera el contacto de ingreso del edificio: *"para el
ingreso por favor comuníquese con Natalia Zeballos"*. Afirmado, sin matices, y encima en otro
edificio.

Daniel: *"se dio por esa vez nada más… no puede tomar como consideración que siempre abrirá
Natalia. Debe usar los datos que hay en el edificio de accesos, pero si no hay, que hable con el
administrador y que sugiera quizás a Natalia — pero lo dio por hecho"*.

`contacto-ingreso.js` ordena de más firme a más flojo:

| | De dónde | ¿Se afirma? |
|---|---|---|
| 1 | Encargado del edificio, si está activo | sí |
| 2 | Suplente, si el encargado no está | sí |
| 3 | Seguridad de la entrada | sí |
| 4 | Lo aprendido sobre los accesos **de ese edificio** | sí |
| 5 | Un contacto puntual de un caso anterior | **no — se sugiere** |

- Lo del punto 5 **solo vale para el mismo edificio**: que alguien haya abierto en San Patricio 159
  no dice nada sobre el 270.
- Cuando lo mejor que hay es el punto 5, el mensaje al técnico dice que **fue por esa vez y que no
  cuente con eso**, y se le pregunta a la Administración quién abre.
- Sin nada, no se inventa: *"todavía no tengo confirmado quién te abre, ya lo estoy averiguando"*.

**Y si el técnico ya dijo que entra solo, no se le explica quién le abre.** Marcos preguntó
*"¿necesitás que gestione algo para entrar?"*, Daniel contestó *"no, tengo llave y acceso al
sistema"* — y Marcos le mandó igual el contacto del encargado. Preguntar y después no leer la
respuesta le enseña al técnico que a Marcos no vale la pena contestarle, y a partir de ahí deja de
hacerlo. `tieneAccesoPropio()` lo detecta y marca el ingreso como resuelto en el caso.

> Ojo con la negación: **"NO tengo llave" contiene "tengo llave"**. Ese error es el caro — deja al
> técnico parado en la puerta sin que nadie le abra — así que ante cualquier negación de tener
> algo se sale por lo seguro y se manda el contacto igual. Un mensaje de más no le hace daño a
> nadie.

Prueba: `node pruebas-contacto-ingreso.js`.

### Cómo se le habla al técnico: dirección y número de caso, siempre

- **Dirección, nunca el nombre interno del edificio.** En la planilla los edificios tienen un alias
  nuestro (`san patricio casa`) y aparte la dirección real. Al técnico le llegaban los dos, uno
  atrás del otro, y no tiene forma de saber si son dos direcciones o una. `direccionParaTecnico()`
  en `marcos-ops.js` resuelve la calle y la altura; el alias solo se usa si no hay dirección
  cargada.
- **El número de caso va en TODO mensaje al proveedor** (plantilla, foto/video del reclamo,
  contacto de ingreso, lista de trabajos). Es lo único con que el técnico puede decir después
  "esta factura es del CASO-1001": junta los trabajos de varios días —a veces de administradores
  distintos— y los manda todos juntos.
- Cuando llega una factura y no se sabe de qué trabajo es, la lista de casos recientes se muestra
  **por dirección**, no por alias.

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
