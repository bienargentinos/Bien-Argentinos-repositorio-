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

  > [!CAUTION]
  > **Los bloques Lun-Vie + Sábado no alcanzan, y no hay que arreglarlos: hay que reemplazarlos.**
  > En producción salió `L-V 08:00-12:00 | L-V 01:00-11:00 · Sáb 12:00-08:00` — un sábado de 12 a 8
  > no existe. Pero el problema no es cómo se muestra: es que la estructura no puede representar lo
  > que pasa de verdad. Daniel: *"hay edificios que solo va uno de limpieza 3 días a la semana en un
  > horario muy raro y no se puede cargar en este estilo de bloques"*.
  >
  > Va a pasar a **calendario o texto libre**, y que Marcos lo interprete —que es justo lo que sabe
  > hacer. Hasta entonces **no maquillar el renderizado**: dejarlo feo es lo que mantiene visible
  > que la estructura está mal. Decisión de Daniel, 28/08.
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

### Pero el caso ya decidió con quién habla, y eso manda sobre el rubro

> [!CAUTION]
> **Cambiar de nombre a mitad de una conversación es peor que haber elegido cualquiera de los dos.**

Visto en producción: el caso se abrió con *"Quién: a dario juju (Electricista)"* —lo abrió el propio
Dario avisando— el trabajo era una **pérdida de agua**, y dos minutos después Marcos le escribió
**"Gracias, Julio"**. La regla del rubro hizo exactamente lo que le pedimos (plomería → el plomero
de esa línea es Julio) y quedó mal igual.

Para el técnico, que le digan Dario en un mensaje y Julio en el siguiente es Marcos mostrándole que
no sabe con quién está hablando. Y no es un caso raro: **un técnico hace trabajos de rubros
distintos**, así que el rubro del caso nunca va a ser una identidad confiable.

El orden queda:

1. **Quién está anotado como técnico del caso** (`stProv.tecnicoDelCaso`) — el caso ya decidió una vez.
2. El rubro, solo si el caso todavía no anotó a nadie.
3. Sin nada, `nombreIncierto`: no se lo llama por su nombre.

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

### Un envío que Meta rechazó quedaba marcado como entregado

> [!CAUTION]
> **Meta contesta 200 al RECIBIR el pedido, no al entregar el mensaje.** El resultado real llega
> minutos después, en un webhook aparte (`statuses`), y puede ser `failed` con el código 131047.

Prueba del vecino, 9/9. Mandó audio + foto + la ficha de contacto de quien iba a recibir al técnico.
Marcos abrió el CASO-1001, mandó la plantilla, y después la foto y el contacto de ingreso:

```
📷 Foto/video del vecino reenviado al técnico Dario (541169241157).
📞 Contacto de acceso (Natalia Zeballos...) enviado al técnico Dario.
```

Las dos **rebotaron** con 131047 --la ventana estaba cerrada-- pero ya estaban marcadas como
entregadas en el caso. Cuando el técnico contestó (el instante exacto en que la ventana se abre),
`entregarPendientesAlTecnico` miró las marcas, leyó "ya entregado" y no reintentó nada. Él terminó
escribiendo: *"puedo ir en 2 hs pero necesito foto y también si es posible un teléfono de quien me
recibe"* — las dos cosas exactas que Marcos creía haberle mandado.

El candado de "solo se marca si el envío salió" **estaba puesto y no alcanzaba**: `salio` significa
"Meta aceptó el pedido", y el rechazo llega después. Faltaba la otra mitad.

- El manejador de `statuses` ya no solo loguea: ante un rechazo por ventana cerrada busca al
  proveedor por su teléfono y **borra las marcas de entrega de sus casos abiertos**
  (`desmarcarEntregasAlTecnico`, en las dos bases).
- Se borran las de **todos** sus casos abiertos, no solo la del mensaje que rebotó: el aviso de Meta
  no dice a qué caso pertenecía, y si la ventana estaba cerrada para uno lo estaba para todos. El
  costo de equivocarse es un envío repetido; el de no hacerlo, un técnico sin la foto.
- Queda dicho en el log: `📎↩️ [CASO-x] lo que se le había mandado NO llegó. Se borran las marcas de
  entrega: cuando conteste, se le manda de nuevo.`

Prueba: `node pruebas-entrega-rechazada.js`.

> **Lo que sigue sin resolver, y es de prompt**: el vecino preguntó *"¿a qué hora viene el técnico?"*
> y Marcos contestó *"le avisaremos en cuanto tengamos la confirmación del horario"* — **tres minutos
> después de que el técnico dijera que iba en 2 horas**, y con el log diciendo `🔧 Dario confirmó la
> visita del [CASO-1001]`. El dato estaba; la respuesta al vecino no lo miró. Es el mismo defecto
> que "no preguntarle la dirección que él acaba de decir", del lado del vecino.

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

### "1001 es el caso" no es "CASO 1001"

> [!CAUTION]
> **Nadie contesta un número de caso de una sola forma.**

Marcos preguntó de qué obra era la factura. Daniel contestó **"1001 es el caso"** — el número
primero — y la condición exigía la palabra `CASO` pegada adelante:

```js
textoFinal.match(/\bCASO[\s-]?0*(\d{2,})\b/i)
```

No matcheó ninguna de las tres vías: ni esta, ni la del edificio (el texto no nombra ninguno), ni
la de la lista (pide **un** dígito, y 1001 tiene cuatro). La factura terminó abriendo el
**CASO-1002** al lado del caso que él acababa de nombrar, en el mismo edificio, con el mismo
técnico y el mismo rubro.

Ahora se acepta en cualquier orden, y también el número pelado de 3 dígitos o más: a esa altura de
la conversación Marcos ya preguntó de qué obra era, así que "1001" a secas no puede ser otra cosa.
Lo que **no** se toma como caso es un monto, un número de factura ni una cantidad.

### Cuando contesta citando, las palabras de Marcos entran como si fueran del técnico

> [!CAUTION]
> **Un mensaje citado llega PEGADO al texto del mensaje.** `index.js` armaba
> `1001 es el caso [Cita el mensaje: "…recibida la factura…"]` y de ahí en adelante todas las
> condiciones leían la palabra `factura` como si la hubiera escrito el técnico.

En la prueba buena --la primera donde la factura llegó al caso correcto-- quedaron **dos filas**
para un solo comprobante: la de 1:24:28 con el monto real (`$5500`, N° `00001-00000262`) y sin
edificio, y una segunda a 1:25:35 con el edificio y sin monto, creada por la **respuesta** *"1001
es el caso"*. El administrador ve dos gastos donde hay uno.

No es una condición en particular: la cita puede traer cualquier palabra que Marcos haya escrito
antes --"foto", "pago", "cerradura", el nombre de otro edificio-- así que **cualquiera** de las 69
condiciones de la rama del proveedor puede dispararse con palabras que no son de quien escribe. Es
el mismo defecto de fondo que los acentos: decidir por coincidencia de texto sobre un texto que no
es el que la persona escribió.

- `cita-mensaje.js` (`separarCita`) parte el mensaje en lo que él escribió y lo que citó.
- **Las decisiones** (`textoFinal`, `txtLow`, `txtLowFactura`) leen solo lo suyo. Los tres `txtLow`
  además pasaron a leer `textoFinal` y no `msgBody`: en un audio `msgBody` es `(Nota de voz)` y la
  transcripción nunca llegaba a esas condiciones.
- **El registro** (`msgBodyParaRegistro`) tampoco la lleva: de ahí salen `problema`, `rubro_tecnico`
  y la nota del panel, donde se leía `Dijo: "1001 es el caso [Cita el mensaje: …]"`.
- **La cita no se tira**: vuelve etiquetada en `messageText`, que es lo que lee el modelo — leer y
  entender es justo lo que sabe hacer. El historial no se toca: el mensaje citado ya está ahí como
  su propia burbuja.

Prueba: `node pruebas-cita-mensaje.js`, con un candado que prohíbe volver a armar un texto de
decisión desde `msgBody`.

### Contestar el edificio no quiere decir que haga falta un caso nuevo

Cuando el técnico contestaba con el edificio, el código **siempre** abría un evento nuevo. Nunca
miraba si ese técnico ya tenía un caso ahí esperando su comprobante.

Abrir el caso sigue siendo lo correcto en el caso **normal** —al técnico lo llamó el encargado,
hizo el trabajo y mandó la factura, nunca hubo reclamo por este canal—, pero si su caso reciente
en ese edificio **todavía no tiene factura**, la que llega es de ese trabajo.

- Con **un solo** caso sin comprobante en ese edificio, la factura va ahí y no se abre nada.
- Con **dos o más**, no se adivina: elegir mal reparte el gasto al azar entre dos consorcios.
- La factura ahora guarda `id_evento` también por esta vía (`imputarFacturaSinEdificio`), en
  Sheets y en PostgreSQL. Antes el caso se le decía al técnico por WhatsApp y no quedaba escrito.

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

### Quién decide de qué habla el técnico: el modelo, no las palabras

> [!CAUTION]
> **Hasta acá el modelo era el ÚLTIMO de la fila.** La rama del proveedor decidía con una cadena
> de condiciones por coincidencia de texto —69 en `index.js`— y la primera que matcheaba cortaba.
> El modelo (línea 3590) solo atendía lo que ninguna condición había reclamado.

El caso que lo agotó, textual del chat:

```
Daniel: "La foto también es del caso"
Marcos: "ya mismo me contacto con el vecino para pedirle la foto…"
Daniel: "No... te acabo de mandar una foto, NO TE ESTOY PIDIENDO FOTOS DE NADA"
Marcos: "ya mismo me contacto con el vecino para pedirle la foto…"
```

La condición buscaba la palabra `foto`. Las dos frases la contienen.

Y no era un caso aislado. **En los cuatro bugs anteriores el modelo no se equivocó ni una vez:
nunca se le preguntó.**

| Se escribió | Se leyó como | Por qué |
|---|---|---|
| "1001 es el caso" | nada | pedía `CASO` pegado adelante |
| "una cámara apagada" | consulta de pago | `/pag/` adentro de "aPAGada" |
| "llamó el encargado" | nada | `\w` no incluye la "ó" |
| "hay que ver la cámara" | pedido de datos | `ver` suelto |

`ruteo-proveedor.js` da vuelta el orden: el modelo lee el mensaje **con el contexto** (qué le acaba
de preguntar Marcos, si hay un caso abierto, si hay una factura esperando obra) y dice de qué se
trata. Recién con eso se elige el ramal.

- **Las condiciones de texto quedan escritas**, renombradas a `*PorTexto`. Son el respaldo: si el
  ruteo está apagado, el modelo falla o tarda más de 6 segundos, se sigue **exactamente** como
  antes. Sus pruebas siguen corriendo — es el piso al que cae Marcos sin IA.
- **Se apaga sin tocar código**: `RUTEO_IA=off` en el `.env` y `pm2 restart marcos-ai`. Igual que
  `LECTURA_PG`. Es la salida de emergencia de un domingo a la noche.
- **Los desacuerdos quedan en el log** con las dos opiniones y la frase que los causó:
  `🧭 "la foto también es del caso" → pide_datos_al_vecino: el texto decía SÍ, la IA dice no…`.
  Sin eso, la única forma de saber si el cambio mejoró algo sería esperar a que un técnico se queje.

**Lo que NO se rutea, y a propósito.** Donde equivocarse cuesta plata o una relación, un `if` no es
pereza: es un cerrojo, y un modelo que obedece "casi siempre" no alcanza.

- El cambio de CBU, que no se aplica solo.
- El filtro de insultos y quejas hacia el técnico.
- La ventana de 24hs de Meta.
- Si el mensaje trae adjunto (`esFacturaODoc`): eso lo dice el tipo de archivo, no el texto.

**Una intención que no está en el catálogo no activa nada**, y eso es deliberado: el mensaje cae al
camino libre —donde Marcos lo lee y contesta— en vez de activar un ramal al azar.

```bash
node probar-ruteo.js        # solo lee: le pasa frases reales al modelo y muestra qué entendió
pm2 logs marcos-ai --lines 300 --nostream | grep "🧭"
```

Pruebas: `node pruebas-ruteo-proveedor.js` (el mecanismo, sin llamar a Gemini) y
`node probar-ruteo.js` (la clasificación de verdad, necesita la clave y corre en el VPS).

### Un error suelto mataba a Marcos en mitad de una conversación

> [!CAUTION]
> **Una promesa que se rechaza sin `catch` TERMINA EL PROCESO.** Es el comportamiento de Node desde
> la v15, y no hacía falta que el error fuera del motor: alcanzaba con uno del **portal del vecino**,
> que corre adentro del mismo proceso.

Daniel mandó *"ya resolví"* con una foto y la factura. En el log se ve la ráfaga entrando, la imagen
bajándose… y de golpe las líneas de **arranque** del servidor:

```
🧾 Ráfaga de a dario juju con 2 adjuntos: se procesa uno por uno
✅ Archivo descargado en: …/media_1077415228377407.jpeg
📌 Confirmación del técnico registrada en [CASO-1001]
⏰ Cron de reportes programado a las 08:00 y 20:00      ← esto es un ARRANQUE
🚀 Servidor Marcos corriendo en puerto 3000
```

El proceso se murió a mitad de camino y PM2 lo levantó de nuevo. **La respuesta nunca salió y él no
vio ningún error: vio a Marcos ignorándolo.** El contador de reinicios de PM2 iba en **41**.

El disparador de esa vez fue un `ReferenceError: esc is not defined` en `portal-vecino.js` (ya
corregido). Pero el arreglo de verdad no es ese: es que **ningún error suelto pueda tirar abajo una
conversación en curso**.

- **`unhandledRejection` → se loguea y NO se corta.** Una promesa rechazada suele ser una falla
  aislada (una consulta que no anduvo, un envío que rebotó) y no deja el programa en mal estado.
  Perder la conversación de un técnico por eso no vale la pena.
- **`uncaughtException` → se loguea y SÍ se sale**, a propósito: puede dejar el programa a mitad de
  una operación, y seguir con el estado roto puede mandarle a una persona real un mensaje
  equivocado. Eso es peor que un reinicio. Lo que cambia es que **ahora queda escrito qué pasó** —
  antes el proceso se moría y en el log no quedaba más que el arranque siguiente.

### El esquema real de PostgreSQL no es el que dice `db-pg.js`

En el mismo log, el mismo día:

```
column "id_evento" of relation "facturas" does not exist
column "url" of relation "facturas" does not exist
column "cbu" does not exist                                    (reservas amenities)
new row for relation "facturas" violates check constraint "facturas_estado_chk"
```

Tres columnas que el código escribe y la base no tiene, más una **restricción que no está en
`db-pg.js`** — o sea que alguien la creó **a mano en el servidor**. Eso rompe la regla de oro del
repo y deja el esquema real distinto del que dice el código.

`psql` directo no sirve para revisarlo: el usuario `root` del sistema **no existe como rol de
PostgreSQL**. `revisar-columnas-pg.js` usa la misma conexión que Marcos y muestra las columnas
reales de cada tabla y sus restricciones `CHECK`.

```bash
node revisar-columnas-pg.js              # todas las tablas
node revisar-columnas-pg.js facturas     # una sola
```

### Pedirle a un archivo una función que no exporta NO da error al cargar

> [!CAUTION]
> **`const { x } = require('./y')` con `y` que no exporta `x` deja `x` en `undefined`.**
> Recién revienta cuando alguien lo llama — casi siempre adentro de un `try` que se come el error.

`datos.js` **nunca exportó `buscarCasoPorCodigo`**, y **cinco** lugares de `index.js` se la pedían.
Los cinco caían en su `catch` con *"buscarCasoPorCodigo is not a function"*. Desde afuera no se veía
ningún error: se veía a Marcos preguntando la dirección que el técnico acababa de decir, porque el
arreglo que evitaba eso **nunca llegó a correr ni una vez**.

Nada lo agarraba: `node --check` no lo ve (la sintaxis es válida), las pruebas no llegan hasta ahí,
y la sección "¿falta alguna función?" del verificador **usa una lista escrita a mano** — solo revisa
los nombres que alguien se acordó de anotar.

`herramientas-check-exports.js` lee los `require` de verdad y los compara con los `module.exports`
de verdad. No los carga: `datos-pg.js` abre PostgreSQL al cargarse y los agentes crean el cliente de
Gemini, así que un verificador que necesita la base prendida no se puede correr antes de un push.

**Encontró ocho más apenas se escribió**, todos con el mismo síntoma silencioso:

| Dónde | Qué pasaba |
|---|---|
| `getSheet` pedido a `datos.js` (4 lugares) | vive en `sheets.js`. Se corrigió el `require`. |
| `procesarSiguienteEventoProveedor` (`index.js:4038`) | **no existe en ningún archivo**, y se llamaba adentro de un `setTimeout` **sin `try`** — una excepción ahí **mata el proceso entero**. No explotó porque los mensajes cortan antes con un `return`. |
| `enviarEncuestaServicio` (3 lugares) | **no existe**, y las tres llamadas estaban en un `catch(e) {}` **vacío**: la encuesta de satisfacción al vecino **nunca se envió ni una vez**. |

Las dos que no existen **no se inventaron**: adivinar qué tenían que hacer es peor que no tenerlas.
Quedan dichas en el log, fuerte, para que sean una decisión y no un olvido.

### No preguntarle la dirección que él acaba de decir

Del chat real, con tres minutos de diferencia:

```
21:32  Marcos: "…Dirección: san patricio 270 … Quedó abierto como CASO-1001 en el panel."
21:34  Daniel: "Tengo llave, en 2 horas estaría llegando"
21:35  Marcos: "Perfecto, ¿a qué dirección vas?"
21:36  Daniel: "…te acabo de decir que me llamaron de San Patricio 270. ¿Tenés memoria de pajarito?"
```

> [!CAUTION]
> **Preguntar un dato que uno mismo acaba de escribir es lo que más rápido convence al técnico de
> que del otro lado no lo están leyendo.**

**No fue el ruteo**: el modelo clasificó *"Tengo llave, en 2 horas estaría llegando"* como
`confirma_que_va` con confianza 1. El camino bueno —*"lo anoté en el CASO-1001 de San Patricio
270"*— existía. Lo que falló fue **encontrar el caso**:

```js
suyos.find(c => !c.cerrado && /avisad|sin confirmar/i.test(String(c.estado || '')))
```

Exigir que el estado dijera "avisado" alcanzaba para no encontrarlo. Pero la pregunta que importa
no es en qué estado está el caso: **es si ya sabemos de qué trabajo habla.** Y se sabía — el propio
log lo demuestra, la línea `🔑 … del [CASO-1001]` salió de la sesión en memoria.

Ahora hay tres fuentes, de la más precisa a la más general:

1. **El caso que la conversación tiene abierto** (`eventoActivoId` de la cola). El código sale de la
   memoria, pero **el caso se relee de la base**: la memoria dice de qué se está hablando, la base
   dice la verdad. Si ya se cerró, no se reusa.
2. El caso suyo que **espera confirmación**, como antes.
3. Su **único** caso abierto, esté en el estado que esté.

Con **dos o más** abiertos sí se pregunta: adivinar manda al técnico —y la factura— al consorcio
equivocado. Preguntar molesta; elegir mal cuesta plata. Y cuando no se encuentra ninguno queda un
`🔎` en el log diciendo qué había en memoria, para no volver a diagnosticar a ciegas.

Prueba: `node pruebas-no-repreguntar.js`.

### El contacto de ingreso salía antes de leer la respuesta

`entregarPendientesAlTecnico` manda el contacto de quien abre en la **línea 1257**.
`tieneAccesoPropio` —la función que pregunta si el técnico dijo que entra solo— se consultaba en la
**línea 3249**. Dos mil líneas después.

Daniel escribió *"Tengo llave. Y que no necesito nada, voy en 2hs"* y un segundo más tarde le llegó
el contacto del encargado igual. La detección funcionaba perfecto —devuelve `true` con esa frase
exacta— pero corría **después** de que el mensaje ya había salido.

> **Marcos no dejó de entenderlo: nunca se lo preguntó a tiempo.** Es el mismo defecto de fondo que
> el ruteo, en otra forma — la información estaba, el orden no.

Ahora se pregunta sobre **ese** mensaje, antes de mandar, y se marca el ingreso como resuelto para
que tampoco salga en el siguiente.

### Las etiquetas de multimedia son para el panel, no para una persona

Al administrador le llegó por WhatsApp, adentro del aviso de un caso:

```
🗣️ Textual: "[AUDIO:/archivos/administracion_general/edificio_general/audios/
media_4465773590357338.ogg] Hola, ¿qué tal? Buenas noches. Me llamaron de San Patricio 270…"
```

Una ruta de archivo del servidor metida en la frase del técnico. La etiqueta hace falta —es lo que
le permite al panel mostrar el reproductor y lo que deja recuperar la foto de un caso después de un
reinicio— pero **lo que se guarda la lleva y lo que sale hacia una persona, no**.

`etiquetas-media.js` (`soloTexto`) es el único lugar donde se saca, para que no haya dos versiones.

### Una reserva de amenity también es un evento, pero NO es un caso

Cuando un vecino reserva el SUM o la parrilla, el administrador tiene que verlo en la sección
Eventos junto con todo lo demás. Pero esa sección se alimenta de `reportes`, que es la misma tabla
donde viven los reclamos — y ahí adentro una fila de más no es inocente.

> [!CAUTION]
> **Un caso ABIERTO sin rubro se traga los reclamos de todo el edificio.**

`sheets.js` engancha cada mensaje al caso abierto del mismo vecino o del mismo edificio, y solo lo
separa si los **rubros** no coinciden. Una reserva no tiene rubro, y la regla dice —con razón— *"el
caso viejo no tiene rubro: no se puede afirmar"* → **no separa**. Con la reserva abierta, el vecino
que reservó la parrilla y después avisa *"se cortó la luz del pasillo"* tendría su reclamo pegado
adentro de la reserva; y por el paso 3, que busca por **edificio**, le pasaría lo mismo a cualquier
vecino de ese edificio.

Dos cerrojos, a propósito:

1. La reserva se guarda con **`estado: 'resuelto'`**. El estado del pago va en el texto y su verdad
   vive en `reservas_amenities`: `estado` en la tabla de casos significa "hay trabajo pendiente", y
   una reserva impaga no es un trabajo pendiente para un técnico.
2. Va marcada con **`tipo: 'reserva'`**, y las búsquedas de "caso abierto" la ignoran por esa marca
   — por si mañana alguien decide que una reserva impaga sí quede abierta.

> [!CAUTION]
> **`'RES-' + Date.now().toString().slice(-4)` se repite cada 10 SEGUNDOS.**

Los últimos cuatro dígitos de un timestamp en milisegundos cierran el ciclo a los 10.000 ms, y
`codigo_caso` es **UNIQUE** en PostgreSQL. Dos reservas con diez segundos de diferencia —una familia
reservando la parrilla y el SUM— y la segunda no entra: el evento se pierde en silencio.

Por eso `reserva-evento.js` **no escribe la fila a mano**: llama a `guardarReporte`, que ya asigna
códigos correlativos (`CASO-${maxNum + 1}`), escribe en Sheets **y** en PostgreSQL, y crea las
columnas que falten. Y la llamada va **después** del `INSERT` de la reserva y sin cortar el
endpoint: si el historial falla se pierde una fila del panel —molesto—; si por eso se le devolviera
un error al vecino, se perdería la reserva.

Prueba: `node pruebas-reserva-evento.js`.

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

### Un audio escribe los acentos, y ahí se cae medio código de decisión

> [!CAUTION]
> **Todo esto se escribió y se probó contra texto TIPEADO, que casi nunca lleva acentos.**
> Con un audio, la transcripción escribe español correcto. Son dos agujeros distintos, los dos
> invisibles al leer el código:
>
> 1. **`\w` en JavaScript no incluye las vocales acentuadas.** `llam\w*` se corta antes de la "ó"
>    de "llamó", `estaf\w*` no llega a la de "estafó".
> 2. **`\b` al final tampoco sirve.** Una palabra que TERMINA en vocal acentuada no tiene borde
>    después: en "estafó", `estaf[…]+` se come la "ó" y detrás hay un espacio — dos caracteres
>    no-palabra seguidos, o sea ningún borde — y la expresión **entera** falla.

El segundo explica algo que si no se ve parece magia negra: **"jodió" sí se filtraba y "estafó"
no.** En "jodió" el `+` puede retroceder a "jodi", y entre la "i" y la "ó" sí hay borde. Un acento
de más o de menos decidía si el insulto llegaba al técnico.

Dónde pegó, hasta ahora:

| Dónde | Qué rompía |
|---|---|
| `avisaQueVa` en `index.js` | *"llamó el encargado de San Patricio 270"* —la forma más común de todas— no abría caso. El mensaje caía al camino genérico y Marcos contestaba sobre otra cosa. |
| `INSULTOS` / `QUEJAS` / `CITA` en `agentes/marcos-ops.js` | "me estafó", "nos cagó", "ya te avisé dos veces" **pasaban el filtro y le llegaban al técnico**. El vecino nunca se entera de lo que le mandamos al proveedor: un roce social filtrado rompe una relación que él ni sabe que está en juego. |

Los bordes de palabra pasaron a mirar los acentos: `(?<![a-záéíóúüñ])` adelante y
`(?![a-záéíóúüñ])` atrás. `pruebas-filtro-terceros.js` prueba cada insulto y cada queja **en las
dos formas**, con acento y sin él, y tiene un candado que **prohíbe que `\w` o `\b` vuelvan** a
esas expresiones.

Prueba: `node pruebas-filtro-terceros.js` y `node pruebas-confirma-visita.js`.

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

### El nombre del encargado no es la fila entera de la planilla

> [!CAUTION]
> **La columna `encargado` guarda `nombre [estado | horario]`.** Lo escribe así el panel y lo
> vuelve a desarmar para mostrarlo (`dashboard.js:5174`). `contacto-ingreso.js` no lo desarmaba.

Lo que le llegó al técnico, tal cual, a la 1:20 de la madrugada:

```
te abre pachu [activo | L-V 08:02-12:00 · L-V 01:00-12:00 · Sáb 12:00-08:00] (12345667)
Si al llegar no te abren, avisame y lo resuelvo.
```

Tres cosas mal en un solo mensaje, y las tres se arreglaron:

1. **Eso no es un mensaje, es una fila de una planilla.** `datosDelEncargado()` separa el nombre
   del estado y del horario; al técnico va el nombre y nada más.
2. **`(12345667)` son ocho dígitos** — relleno que quedó en la ficha, entregado como el contacto
   de ingreso. `telefonoUsable()` exige los 10 dígitos que tiene todo número argentino (área +
   local). Con menos se baja al siguiente escalón, y si no hay ninguno se dice que se está
   averiguando: mandar a alguien a discar un número que no existe lo deja parado en la puerta.
3. **A las 2 de la mañana el encargado no está**, y el mensaje se contradecía solo: el propio
   horario que Marcos acababa de mandar ya decía que no había nadie. Daniel: *"esos horarios no
   sirven en este horario nocturno, así que es un mensaje que no va a funcionar; ya en el mensaje
   de horario está lo imposible que alguien le abra"*.

Sobre lo tercero, un detalle deliberado: **no se mira el horario cargado.** Con la estructura de
bloques actual la ficha de ese edificio dice literalmente `L-V 01:00-12:00`, así que cualquier
chequeo contra ella concluiría que el encargado **sí** está a la 1 de la mañana. Hasta que los
bloques se reemplacen por calendario o texto libre, **el reloj es más confiable que el dato**.

- El encargado y el suplente no se afirman de madrugada (22 a 8): se dice a qué hora llega, que a
  esa hora no hay nadie, y que se está confirmando con la Administración.
- **Seguridad sí se afirma de noche**: es, por definición, la opción de la noche.
- La hora sale de lo que el técnico prometió (`tecnico_eta` → `momentoPrometido`); sin promesa, la
  de ahora.
- El reloj argentino (huso fijo −3, franja 8–22) vive en `fecha.js` y lo usan `seguimiento.js` y
  `contacto-ingreso.js`. Estaba escrito dos veces.

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

### El contacto de ingreso se da si lo piden, no porque esté a mano

El técnico escribió *"perdón, es del caso 1003, no del 1001"* y Marcos contestó *"para el CASO-1001
en San Patricio 159, quien le abrirá es Natalia Zeballos"*. Ni siquiera con el caso bien elegido eso
tendría sentido: **le ofreció el contacto de ingreso a alguien que no preguntó nada de eso**.

El mecanismo está en el prompt de `generarRespuestaTecnicoLibre`: los datos de acceso van en **cada**
llamada, y hay una regla en mayúsculas con 🚨 que ordena entregarlos. Ante un mensaje que el modelo
no sabe clasificar, se agarra de lo más enfatizado que tiene.

- El contacto de ingreso **solo si lo pide** o si dice que llegó y no le abren.
- Una **corrección** se contesta reconociéndola y arreglando lo que señaló — sin agregar nada más.
- Si ya dijo que tiene llave, no se le explica quién le abre.
- Y el default de `accesoInfo` dejó de afirmar *"el acceso ya fue coordinado con X, que lo está
  esperando"*: eso puede ser falso, y el técnico organiza su viaje con esa frase.

> Esto son reglas de prompt, no código: **ninguna prueba automática las cubre**. Se verifican
> leyendo lo que Marcos contesta de verdad.

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

### Cuando un renombre no puede tocar una fila porque su gemela ya existe

`renombrar-edificio.js` y `renombrar-proveedor.js` renombran fila por fila y, si una quedaría
repetida con otra que ya existe, **se plantan y avisan** en vez de forzarla:

```
⚠️ proveedor_asignaciones.edificio: esta fila quedaría repetida con otra que ya dice
   "san patricio casa". Se dejó como estaba.
```

Eso es lo correcto --borrar una de las dos es una decisión, no un efecto secundario de corregir un
nombre-- pero deja la fila vieja apuntando a un edificio que no existe. `quitar-duplicados.js`
cierra ese paso:

```bash
node quitar-duplicados.js proveedor_asignaciones edificio "nombre viejo" "nombre bueno"
node quitar-duplicados.js proveedor_asignaciones edificio "nombre viejo" "nombre bueno" --aplicar
```

> [!CAUTION]
> **Solo borra una fila si su gemela ya existe Y dice exactamente lo mismo en todo lo demás.**
> Si la vieja trae algo propio --otra prioridad, otro teléfono, otro estado-- NO se borra: se
> muestra la diferencia y se deja quieta. Perder ese dato es peor que tener una fila de más, y
> decidirlo es de quien conoce el edificio.

Tampoco borra una fila sin gemela: eso no es un duplicado sino un renombre pendiente, y lo dice.

## Un nombre de edificio que no es ningún edificio

> [!CAUTION]
> **Un nombre que se usa en una asignación y no existe en `EDIFICIOS` no da error en ningún lado.**
> Simplemente no encuentra nada, en silencio, y desde afuera se ve como que Marcos "no sabe" la
> dirección o a quién llamar.

Caso real: `consorcio propietario san patricio 159` estaba en **cuatro** asignaciones de proveedor,
en el consejo y en la lista de edificios del cliente --y no existía como edificio--. Al mismo
tiempo, el portal del vecino (`reservas_amenities`, `usuario_unidades`) usaba una tercera forma,
`San Patricio 159`. Tres nombres, ninguno verificado contra `EDIFICIOS`.

Lo que rompe cada uno:

- `buscarPerfilEdificio` no encuentra la ficha → al técnico le llega el nombre interno en vez de la
  dirección, o la dirección de otro consorcio.
- El permiso del cliente apunta a un edificio que no existe: en el panel le falta uno.
- La asignación `edificio + rubro` no matchea → Marcos no sabe a quién llamar.

```bash
node revisar-edificios.js        # solo lee: los edificios que hay, y los nombres que no son ninguno
```

Muestra cada edificio con su dirección (y avisa si las **dos** columnas del nombre --`edificio` y
`nombre`, que son alias del mismo dato-- no coinciden entre sí), y después lista todo nombre usado
en las otras pestañas y tablas que no corresponde a ninguno, con en cuántas filas está.

Se corrigen con `renombrar-edificio.js`. **Antes de elegir el nombre bueno hay que mirar la
dirección**: dos edificios de la misma calle con distinta altura son dos consorcios distintos, y
unificarlos mandaría al técnico a la puerta equivocada.

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

### Lo que sobra en PostgreSQL cuando se borra de la planilla

> [!CAUTION]
> **La sincronización solo AGREGA.** `importar-sheets-a-pg.js` no tiene ningún `DELETE` y
> `copiarAPg` es "dispará y seguí": una fila borrada de la planilla **se queda para siempre del
> lado de PostgreSQL**, que es justo el lado que lee Marcos.

Dos casos vistos: un cerrajero de prueba llamado **"lalala"** que se borró de la planilla y Marcos
sigue viendo, y **Dario asignado a un cliente al que ya no pertenece**. Marcos lee
`proveedor_asignaciones` para elegir a quién llamar por `edificio + rubro`, así que una asignación
fantasma manda al técnico equivocado o le muestra el reclamo de un consorcio ajeno.

La dirección contraria duele distinto: una fila que está en la planilla y **no** en PostgreSQL es
algo que el panel muestra y el motor no ve — el administrador lo carga, lo ve cargado, y Marcos
actúa como si no existiera.

```bash
node revisar-sobrantes.js                        # solo lee: las 4 tablas de configuración
node revisar-sobrantes.js proveedor_asignaciones # una sola
```

Compara `clientes`, `edificios`, `proveedores` y `proveedor_asignaciones` por el dato que
identifica a la fila para una persona (usuario, nombre del edificio, nombre + teléfono), no por el
`id` --cada base numera por su cuenta-- y los teléfonos por sus últimos 10 dígitos, porque el mismo
número está escrito de cuatro formas entre las dos bases.

**No borra nada, y es a propósito**: esto es configuración, no rastro de una prueba. `reset-test.js`
tampoco la toca. Qué fila sobra se decide mirándola.

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

### Importar duplicó una factura (y por qué la clave importa tanto)

> [!CAUTION]
> **`importar-sheets-a-pg.js` identificaba una factura por `fecha + proveedor + monto + edificio`.**
> Los cuatro cambian. Había una factura en la planilla y la misma en PostgreSQL; el import dijo
> *"1 nueva(s), 0 actualizada(s) — total en la tabla: 2"*. El mismo comprobante dos veces, y el
> gasto contado dos veces en el consorcio.

Alcanza con que uno de los cuatro difiera:

- **`edificio` está VACÍO al llegar** (`Sin imputar`) y se completa cuando el técnico contesta de
  qué obra era. Antes y después son dos claves distintas.
- **`monto`** se guarda formateado de un lado (`$5500,00 ARS`) y crudo del otro.
- **`fecha`** es una marca de tiempo al segundo.

Lo que identifica a una factura es lo mismo que ya usa `guardarFactura` para no registrar dos veces
el mismo comprobante: **número de comprobante + proveedor**. Sin número se cae a la clave vieja —
peor, pero el criterio del proyecto es firme: **perder una factura es peor que tener dos**.

Y faltaba algo más: el import **no traía `numero_factura`, `id_evento`, `nota_tecnico` ni
`enviada_por`**, así que la factura llegaba al lado que lee Marcos sin su número y sin saber a qué
trabajo pertenecía.

> El `clave` de una pestaña ahora puede ser una **función de la fila**, no solo una lista fija, y se
> calcula adentro del bucle. Calculada afuera, una factura sin número decidiría por todas las demás.

Prueba: `node pruebas-importar-facturas.js`.

### El signo de peso puesto dos veces

En la planilla salió `Factura recibida del técnico dario. N° 00001-00000262 por **$$**5500,00 ARS`.
El monto a veces viene con el signo adentro y a veces sin él, según de dónde lo haya leído el lector
de documentos, y los cuatro lugares que lo mostraban le pegaban un `$` adelante sin mirar.
`montoConSigno()` en `index.js` lo pone solo si falta. Es cosmético, pero lo lee el administrador en
el aviso de un gasto — un importe escrito raro es justo donde uno mira dos veces.

## El nombre del proveedor tampoco tiene id (y editarlo en el panel no llegaba a Marcos)

> [!CAUTION]
> **El panel escribe en Sheets y el motor de Marcos lee PostgreSQL.** `/api/proveedor-editar`
> hacía solo `writeCell` sobre la planilla, y `buscarRolPorTelefono` sale de PostgreSQL --y solo
> cae a Sheets si PostgreSQL da **error**, no si dice otra cosa. La edición era invisible para
> Marcos, para siempre.

Daniel editó "a dario juju" desde el panel porque Marcos, **al hablar**, decía *"a-dario-juju"* en
voz alta. Guardó, el panel mostró el nombre nuevo, y Marcos siguió diciendo el viejo. Sus palabras:
*"si cambian de técnico o lo edita, siempre lo llama por el primer nombre escrito"*. Es exactamente
así, y por dos motivos del mismo tamaño:

1. Los dos lados (arriba).
2. **No hay un id de proveedor: el nombre ES la clave**, igual que con el edificio, y está copiado
   como texto en cuatro lugares × dos bases.

| Dónde | Qué se rompe si queda el nombre viejo |
|---|---|
| `proveedores.nombre` y `tecnicos.nombre` | cómo lo saluda y cómo lo nombra en voz |
| `proveedor_asignaciones.proveedor` | **a quién se llama** por `edificio + rubro` |
| `facturas.proveedor` | `buscarFacturasSinImputar` no encuentra sus facturas: cuando conteste "de qué obra es", no hay ninguna esperando |
| `reportes.tecnico` / `EVENTOS.tecnico` | sus casos dejan de ser suyos al imputar una factura o al buscar su caso abierto |

La de `facturas` es la que muerde primero y en silencio: la factura queda "Sin imputar" y la
respuesta del técnico no la encuentra nunca.

**Lo que NO se toca, a propósito**: las conversaciones ya ocurridas (`historial_chat`, `mensajes`,
`mensajes_wa`, `chat_proveedor_json`). Eso es el registro de lo que se dijo y cuándo; reescribirlo
sería falsear el historial. Va a seguir diciendo el nombre viejo, y está bien que así sea.

```bash
node renombrar-proveedor.js "a dario juju" "dario"             # solo muestra, no toca nada
node renombrar-proveedor.js "a dario juju" "dario" --aplicar   # escribe, y después: pm2 restart marcos-ai
```

- La comparación es **exacta y normalizada**: "dario" no se lleva puesto a "dario gomez", que es
  otra persona y probablemente de otro administrador.
- La lista de columnas va **por tabla**, no por nombre de columna suelto: `nombre` es el nombre de
  una PERSONA en casi todas las pestañas, y renombrar por columna tocaría vecinos que se llaman
  igual.
- `enviada_por` (`"a dario juju (proveedor)"`) se compara **entero** contra la parte del nombre, no
  con "empieza con": corregir "dario" con esa regla tocaría también `"dario gomez (proveedor)"`.
- Una fila que al renombrarse quedaría **repetida** (la misma asignación cargada dos veces con el
  nombre escrito distinto) no se fuerza: se avisa y se deja como estaba. Borrar una de las dos es
  una decisión, no un efecto secundario de corregir un nombre.

> [!CAUTION]
> **`/api/proveedor-editar` en `dashboard.js` sigue escribiendo SOLO en Sheets.** Mientras siga
> así, cada edición de nombre desde el panel vuelve a desfasar las dos bases y hay que correr el
> comando a mano. El arreglo es que ese endpoint llame a `renombrarProveedor()` de
> `renombrar-proveedor.js` cuando el nombre cambió --**no** reimplementarlo: eso es lo que pasó con
> `buscarPerfilEdificio`, que quedó escrito dos veces y arreglar una copia no cambió nada en
> producción.

Prueba: `node pruebas-renombrar-proveedor.js`.

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

## Pendientes del PANEL (dashboard.js) — para quien trabaje ahí

Son tres, y las tres tienen la misma forma: **el panel y el motor de Marcos escriben o leen el
mismo dato con nombres distintos, o en una sola de las dos bases.** Ninguna da error; todas se ven
desde afuera como que "Marcos no sabe" algo.

> [!CAUTION]
> **Las tres se resuelven LLAMANDO a algo que ya existe, no reimplementándolo.** Copiar la lógica
> adentro del panel es exactamente lo que pasó con `buscarPerfilEdificio`, que quedó escrita dos
> veces --en `sheets.js` y en `datos-pg.js`-- y arreglar una copia no cambió nada en producción
> porque el motor leía la otra.

### 1. La sección Facturas nunca muestra el caso

`mapFactura` (dashboard.js ~539) **no devuelve el campo del caso**, ninguno. Por eso `item.codigo_caso`
de la línea ~4791 viene siempre vacío y la insignia cae siempre en "Sin caso asignado", haya dato o
no. Verificado: el dato **está** en las dos bases (`facturas.id_evento`).

Y el mismo dato tiene dos nombres: el motor escribe `id_evento`, el alta manual del panel escribe
`codigo_caso`. Hay que leer **los dos**, o la mitad de las facturas siguen sin caso.

```js
// en el objeto que devuelve mapFactura
codigo_caso: pick(r, ['codigo_caso', 'id_evento', 'caso', 'id_caso']),
```

Nada más: la insignia ya está escrita y funciona apenas el campo llegue.

### 2. Editar el nombre de un edificio no renombra sus referencias

`/api/edificio` (dashboard.js ~12996) escribe el nombre nuevo en `EDIFICIOS` --en todas las columnas
que son ese campo, eso está bien-- **y en ningún otro lado**. De ahí salieron cuatro asignaciones de
proveedor diciendo `san patricio 27'0 casa` con el edificio ya renombrado a `San patricio 270`, más
el consejo y la lista de edificios del cliente.

La propagación existe pero está **adentro** de `/api/aprobar-solicitud` (~13756), cubre menos
pestañas y **no toca PostgreSQL**, que es el lado que lee Marcos.

`renombrar-edificio.js` ya hace las dos bases, todas las pestañas, la lista separada por comas del
cliente, comparación exacta y aviso de fila duplicada sin forzarla. **Se exporta para esto**:

```js
const { renombrarEdificio } = require('./renombrar-edificio');
// cuando cambió el nombre, después de escribir EDIFICIOS:
const r = await renombrarEdificio({ viejo: nombreAnterior, nuevo: nombreNuevo, aplicar: true });
// devolver r.cambios y r.fallidos en la respuesta: un renombrado a medias parece hecho y no lo está
```

Y el bloque inline de `/api/aprobar-solicitud` tendría que pasar a llamar a lo mismo, para que no
queden dos criterios distintos de qué se renombra.

### 3. Editar el nombre de un proveedor no llega a Marcos

`/api/proveedor-editar` (dashboard.js ~14061) hace solo `writeCell` sobre la planilla, y
`buscarRolPorTelefono` sale de PostgreSQL. La edición es invisible para Marcos, para siempre. Mismo
patrón:

```js
const { renombrarProveedor } = require('./renombrar-proveedor');
```

### 4. Eliminar o desvincular un edificio limpia sus asignaciones y consejo en cascada

Cuando se da de baja un edificio o se desvincula de un cliente, sus asignaciones en
`proveedor_asignaciones`, miembros en `consejo` y la referencia en `clientes.edificios` deben
limpiarse en las DOS bases (Sheets y PostgreSQL) para que Marcos no quede con asignaciones
huérfanas que lo confunden al llamar proveedores.

`eliminar-edificio.js` y el endpoint `POST /api/edificio-eliminar` resuelven este saneamiento en
cascada:

```bash
node eliminar-edificio.js "san patricio 270"            # solo muestra
node eliminar-edificio.js "san patricio 270" --aplicar  # ejecuta limpieza en Sheets y PG
```

### Cómo se verifica que quedó bien

```bash
node revisar-sobrantes.js     # lo que sobra o falta entre las dos bases
node revisar-edificios.js     # nombres de edificio que no son ningún edificio
```

Después de cualquiera de los tres arreglos, esos dos tienen que seguir diciendo lo mismo o mejor.

## Pendientes

- [x] Aplicar últimos cambios del dashboard en VPS (curl + pm2 restart)
- [x] Verificar que los eventos aparecen en el dashboard (fix de columnas)
- [x] Rediseño visual completo (sidebar + paleta de marca + logo real)
- [x] Sección Clientes (alta desde el dashboard, tab `clientes` en Sheets)
- [x] Visor interactivo de chats (Separación Vecino/Proveedor, imágenes HD, PDFs con descarga)
- [x] Datos de cobro del proveedor (CBU/alias) con verificación y aprobación de cambios
- [x] Expensas: nueva sección para que el cliente suba PDF/imagen/link mensual
- [ ] Auth real: contraseñas hasheadas (bcrypt), activación por token, recuperación por email
- [ ] Consumos / facturación por excedente: derivar uso de los logs de Marcos, definir precios
- [ ] Notificaciones con contador real (hoy la campana es solo visual)
- [ ] Impersonación ("Ver como cliente") para el dueño
- [ ] Horario del encargado: reemplazar los bloques Lun-Vie + Sábado por calendario o texto libre
      que interprete Marcos (hay edificios con limpieza 3 días a la semana en horarios raros)
- [x] **Panel**: `mapFactura` no devuelve el caso (ver "Pendientes del PANEL", punto 1)
- [x] **Panel**: renombrar un edificio desde la ficha no renombra sus referencias (punto 2)
- [x] **Panel**: renombrar un proveedor no llega a PostgreSQL, o sea a Marcos (punto 3)
- [x] Sacar un edificio de un cliente deja huérfanas sus asignaciones, su consejo y el permiso —
      resuelto con `eliminar-edificio.js` y endpoint `/api/edificio-eliminar` con saneamiento en cascada
- [ ] Twilio + chip Movistar: agregar `VAPI_API_KEY`, `TWILIO_*` al `.env`
- [ ] Test end-to-end WhatsApp + llamadas
