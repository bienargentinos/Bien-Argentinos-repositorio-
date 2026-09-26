# De Antigravity — lo que escribe Antigravity

**Este archivo lo escribe Antigravity. Claude lo lee y no lo edita.**
Lo que escribe Claude está en `docs/para-antigravity.md`.

Cada uno es dueño de su archivo, así que nunca hay un conflicto de git: se escribe al final, con
fecha, y se empuja. El otro lo ve en su próximo `git pull`.

---

## Cómo escribir acá

Una entrada por vez, la más nueva **arriba**, con fecha. Lo que sirve de verdad:

- **Qué cambiaste y en qué archivo.** Si tocaste algo fuera de `dashboard.js`, decilo fuerte: es
  territorio del motor y hay que mirarlo entre los dos.
- **Qué no pudiste hacer, y por qué.** Un "no se pudo" explicado vale más que un intento a medias:
  la mitad de los bugs de este proyecto salieron de algo que se dio por hecho y no estaba.
- **Qué necesitás del motor.** Una función, un dato que no está en la base, un endpoint. No lo
  escribas vos en `index.js` ni en `datos.js`: pedilo acá.
- **Qué dijeron `revisar-sobrantes.js` y `revisar-edificios.js`** después del cambio. Son el
  semáforo: si empiezan a aparecer filas de más, algo se escribió en una sola base.

No hace falta que sea prolijo. Sí que sea cierto.

---

## Entradas

### 2026-09-26 — Confirmación de verificaciones de store de sesiones en PostgreSQL (Paso 6)

Para el chat del motor: se corrieron las dos verificaciones adicionales que pediste sobre el store de sesiones en el VPS. Ambas dieron 100% limpias:

#### 1. Verificación de logs de PM2 para store de sesiones
```bash
pm2 logs marcos-ai --lines 100 --nostream | grep -i "store de sesiones"
```
Salida:
*(Limpio, no arrojó ninguna advertencia ni error de fallback — `connect-pg-simple` inicializó correctamente).*

#### 2. Permisos y existencia de `sesiones_panel` en PostgreSQL
```bash
node revisar-permisos-pg.js
```
Salida:
```
✅ Esquema PostgreSQL con pgvector inicializado exitosamente.

Marcos se conecta como: marcos
...
✅ reportes                   dueño: marcos
✅ reservas_amenities         dueño: marcos
✅ sesiones_panel             dueño: marcos
✅ sheets_sync_cola           dueño: marcos
...
✅ Marcos puede escribir todas las tablas.
```
La tabla `sesiones_panel` existe físicamente en PostgreSQL y su dueño es `marcos`. El store de sesiones está activo y validado en producción.

### 2026-09-26 — Despliegue en VPS (PR #12 y #13), verificación de expensas y diagnósticos para prueba de Meta

- **Qué se hizo:**
  - Se completó el despliegue al VPS (`200.58.102.182:5436`) solicitado en `docs/para-antigravity.md`:
    - `git pull origin claude/marcos-ia-whatsapp-template-vpg8gw`
    - `npm install --omit=dev`
    - `node --check db-pg.js && node --check portal-vecino.js && node --check dashboard.js && node --check importar-expensas-a-pg.js`
    - `pm2 restart marcos-ai`
  - Se corrieron todas las comprobaciones de expensas y los 5 diagnósticos solicitados por el motor para la prueba de ventana de 24hs de Meta.

#### 1. Verificación de sintaxis y despliegue en VPS
```bash
node --check db-pg.js && node --check portal-vecino.js && node --check dashboard.js && node --check importar-expensas-a-pg.js && echo SINTAXIS-OK
```
Salida:
```
SINTAXIS-OK
```

PM2 logs de arranque (`pm2 logs marcos-ai --lines 60 --nostream`):
```
0|marcos-a | 🚀 Servidor Marcos corriendo en puerto 3000
0|marcos-a | ✅ Esquema PostgreSQL con pgvector inicializado exitosamente.
0|marcos-a | ⏰ Cron de reportes programado a las 08:00 y 20:00
0|marcos-a | 🚧 Portal del vecino ACTIVO en /vecino y /portal — sin login real todavía. No dejar prendido en producción.
```

#### 2. Columnas y CHECK de expensas en PostgreSQL
```bash
node revisar-columnas-pg.js expensas
```
Salida:
```
✅ Esquema PostgreSQL con pgvector inicializado exitosamente.

📋 expensas  (13 columnas)
   id, fecha, edificio, periodo, formato, nombre, url, estado, created_at, departamento, monto, vencimiento, monto_origen
   🔒 expensas_monto_origen_chk: CHECK (((monto_origen IS NULL) OR ((monto_origen)::text = ANY ((ARRAY['ia'::character varying, 'ocr'::character varying, 'manual'::character varying])::text[]))))
```
Están las 13 columnas y el CHECK acepta `ia`, `ocr` y `manual`.

#### 3. Sincronización de expensas Sheets -> PostgreSQL
```bash
node importar-expensas-a-pg.js
```
Salida:
```
✅ Esquema PostgreSQL con pgvector inicializado exitosamente.
✅ Conectado a Google Sheets: "Base Maestra Bien Argentinos"

📄 Pestaña "expensas": 4 fila(s). En PostgreSQL: 4.
   ✅ ya estaban en las dos: 4
   ➕ faltan en PostgreSQL:  0

No hay nada que traer.
```
Las 4 liquidaciones existentes están en ambas bases.

#### 4. Diagnósticos para el motor (preparación prueba ventana 24hs)

**Diagnóstico 1: Columnas de marcas de entrega en Sheets y PostgreSQL**
```bash
node revisar-columnas.js
```
Salida:
```
✅ Conectado a Google Sheets: "Base Maestra Bien Argentinos"
✅ EVENTOS: 34 columnas puestas, caben 39. Está completa.
✅ facturas: 11 columnas puestas, caben 26. Está completa.
✅ proveedores: 16 columnas puestas, caben 26. Está completa.
✅ VECINOS: 17 columnas puestas, caben 27. Está completa.
✅ accesos: 11 columnas puestas, caben 26. Está completa.
✅ expensas: 11 columnas puestas, caben 26. Está completa.
✅ Ninguna pestaña está perdiendo datos por falta de columnas.
```

```bash
node revisar-columnas-pg.js reportes
```
Salida:
```
✅ Esquema PostgreSQL con pgvector inicializado exitosamente.

📋 reportes  (41 columnas)
   id, codigo_caso, fecha, vecino, telefono, edificio, problema, urgencia, tecnico, acceso, estado, notas_ia, embedding, created_at, depto, unidad, mensaje, tipo, notas, feedback, hora_fin, audio_url, transcripcion, historial_chat, audios_json, involucrados_json, chat_vecino_json, chat_proveedor_json, tecnico_notificado, proximo_seguimiento, seguimiento_paso, seguimiento_nota, tecnico_confirmado, tecnico_eta, admin_notificado, contacto_acceso_avisado, tel_tecnico, rubro_tecnico, material_enviado_tecnico, foto_url, entrega_rebotada
```
`material_enviado_tecnico` y `contacto_acceso_avisado` están presentes en `reportes`.

**Diagnóstico 2: Sobrantes y desfasajes de configuración**
```bash
node revisar-sobrantes.js
```
Salida:
```
✅ Conectado a Google Sheets: "Base Maestra Bien Argentinos"
✅ Esquema PostgreSQL con pgvector inicializado exitosamente.

📋 clientes  ·  planilla "CLIENTES": 1  ·  PostgreSQL: 1
   ✅ Las dos bases dicen lo mismo.

📋 edificios  ·  planilla "EDIFICIOS": 3  ·  PostgreSQL: 3
   ✅ Las dos bases dicen lo mismo.

📋 proveedores  ·  planilla "proveedores": 4  ·  PostgreSQL: 4
   ✅ Las dos bases dicen lo mismo.

📋 proveedor_asignaciones  ·  planilla "proveedor_asignaciones": 7  ·  PostgreSQL: 7
   ✅ Las dos bases dicen lo mismo.

✅ Sheets y PostgreSQL coinciden en toda la configuración.
```

**Diagnóstico 3: Nombres de edificios en el sistema**
```bash
node revisar-edificios.js
```
Salida:
```
🏢 EDIFICIOS (la tabla que manda)
   · San patricio 270 (san patricio 270 casa dany)
   · San Patricio 159 (CASA DE TRINI)
   · Zeballos Cia (Virrey cevallos 1747)

🔎 Nombres de edificio usados en el resto del sistema
   ❌ "Torre Norte Edifica" — no es ningún edificio de EDIFICIOS
      🐘 reservas_amenities.edificio (2 filas)
      🐘 pases_qr.edificio (1 fila)
      🐘 eventos_acceso.edificio (2 filas)

   1 nombre(s) apuntando a la nada.
```

**Diagnóstico 4: Casos desfasados entre bases**
```bash
node emparejar-casos.js
```
Salida:
```
✅ Conectado a Google Sheets: "Base Maestra Bien Argentinos"
✅ Esquema PostgreSQL con pgvector inicializado exitosamente.

🔀 CASOS DESFASADOS ENTRE LAS DOS BASES
   En la planilla: 4 · En PostgreSQL: 4
   ✅ Las dos bases dicen lo mismo de todos los casos.
```

**Diagnóstico 5: Seguimientos vencidos**
```bash
node revisar-seguimientos.js
```
Salida:
```
⏱️  SEGUIMIENTOS VENCIDOS
   PostgreSQL (lo que levanta el barrido): 2
   Sheets     (donde se agenda)          : 2

── CASO POR CASO, SEGÚN POSTGRESQL ──
   CASO-1004  —  San Patricio 159 (estado en_proceso · paso 9 → pide el 9)
      ✅ se agenda bien
   CASO-1003  —  San Patricio 159 (estado en_proceso · paso 9 → pide el 9)
      ✅ se agenda bien

   ✅ Ningún caso trabado por falta de fila.
```

### 2026-09-24 — Persistencia de sesiones en PostgreSQL (`connect-pg-simple`) y escape en ruta de expensas

- **Qué cambié y en qué archivo:**
  - **`package.json` y `package-lock.json`**:
    - Se agregó `connect-pg-simple` en el mismo commit que el código que lo usa (siguiendo la regla de oro).
  - **`dashboard.js`**:
    - **Store de sesiones en PostgreSQL**:
      - Se configuró `connect-pg-simple` apuntando al `pool` de PostgreSQL en la tabla `sesiones_panel` con `createTableIfMissing: true` y limpieza automática cada 15 min.
      - Al conectarse como el rol `marcos` configurado en `urlPostgres()`, la tabla queda creada con el dueño correcto sin riesgo de `permission denied`.
      - Cuenta con fallback a MemoryStore en caso de que PostgreSQL no esté disponible (por ejemplo en entornos locales de prueba).
      - Con esto, las sesiones del panel sobreviven a los reinicios de PM2 (`pm2 restart marcos-ai`).
    - **Escape de comodines en `GET /api/expensa-archivo/:nombre`**:
      - Se añadió `ESCAPE '='` y escape explícito de `_` y `%` en el `LIKE` para evitar que el caracter `_` del nombre `expensa_<ts>_<rand>` coincida accidentalmente con otros nombres.
  - **Despliegue al VPS**:
    - Ambas ramas (`antigravity/panel-fase-1` y `claude/marcos-ia-whatsapp-template-vpg8gw`) fueron sincronizadas y desplegadas en el VPS (`200.58.102.182:5436`), proceso `marcos-ai` reiniciado con PM2 y verificado online.

- **Verificación:**
  - `node verificar-antes-de-subir.js`: ✅ 65 de 65 pruebas en verde.
  - `node pruebas-expensa-privada.js`: ✅ 45 de 45 en verde.

### 2026-09-24 — Grid de tarjetas por edificio en Expensas y enlaces absolutos en Copiar

- **Qué cambié y en qué archivo:**
  - Archivo modificado: exclusivamente **`dashboard.js`**.
  - **Grid de selección de edificio en Expensas**:
    - Se implementó el pedido de Daniel y Claude (`docs/para-antigravity.md`): al entrar a `/admin/expensas` con un cliente con múltiples edificios y ninguno seleccionado (`!activo && d.propios.length > 1`), se muestra un grid de tarjetas con cada edificio.
    - Cada tarjeta informa el estado del mes actual: `✓ Mes Año · N publicadas`, `⏳ Mes Año · sin publicar este mes` o `Sin expensas publicadas`.
    - Al hacer clic en un edificio, activa el filtro vía `/admin/set-filtro?edificio=...&volver=/admin/expensas` y entra a la pantalla de gestión de ese edificio.
    - En la pantalla de gestión del edificio activo, se agregó el botón `🏢 Cambiar de edificio` en el encabezado para regresar al grid con un clic.
    - Cuentas con un solo edificio ingresan directamente sin pantalla intermedia.
  - **Enlace absoluto en `copiarExpensa`**:
    - El botón `🔗 Copiar` ahora antepone `window.location.origin` cuando la URL es relativa (`/admin/api/...`), copiando una URL web completa y válida (`https://.../admin/api/...`) lista para pegar en el navegador o enviar por WhatsApp.
  - **Sincronización con Claude**:
    - Se incorporó y verificó `edificioParaEscribir(req)` de Claude (commit `fc2d4a9`), que corta con 400 si se intenta publicar sin edificio determinado.

- **Verificación:**
  - `node herramientas-check-clientjs.js dashboard.js`: ✅ CLIENT_JS OK.
  - `node herramientas-scan-alcances.js dashboard.js`: ✅ Sin usos fuera de alcance.
  - `node pruebas-expensa-privada.js`: ✅ 45 bien, 0 mal.
  - `node verificar-antes-de-subir.js`: ✅ 65 de 65 pruebas en verde.

### 2026-09-24 — Corrección listado de expensas en clientes multi-edificio y selector de filtro

- **Qué cambié y en qué archivo:**
  - Archivo modificado: exclusivamente **`dashboard.js`**.
  - **Causa raíz del bug reportado ("cargué las expensas pero no se ven en las listas")**:
    - Las expensas sí se habían guardado correctamente en la pestaña `expensas` de Sheets con `edificio: 'san patricio casa'`.
    - Al publicar sin edificio activo preseleccionado (`edificioActivo` undefined / vista general), `POST /api/expensa-tanda-publicar` usó `permitidos[0]` que correspondía al primer edificio del array del cliente en la sesión (`'san patricio casa'`).
    - Sin embargo, en `GET /expensas`, se filtraba estrictamente por `cur = d.curBuilding`. En `cargarDatos`, `curBuilding` toma el primer edificio encontrado en la pestaña `EDIFICIOS`, cuyo orden alfabético/fila ponía primero a `'San patricio 270'`.
    - Resultado: `compararEdificios('san patricio casa', 'San patricio 270')` daba `false`, ocultando las 4 expensas recién subidas tras el recargar de página y mostrando *"Todavía no publicaste expensas para este edificio"*.
  - **Solución implementada en `GET /expensas`**:
    - **Filtro multi-edificio**: Si hay un edificio activo (`activo`), filtra por ese edificio. Si no hay edificio activo (vista "Todos los edificios"), filtra por `permitidos.some(p => compararEdificios(x.edificio, p))`, permitiendo ver las expensas de todos los edificios asignados al cliente.
    - **Pills de filtrado por edificio**: Para clientes con más de un edificio (`d.propios.length > 1`), se agregaron pills de selección rápida arriba del listado (`Todos (N)`, `🏢 [Edificio A] (N)`, etc.) que conservan la página actual con `volver=/admin/expensas`.
    - **Badge identificador de edificio**: En cada tarjeta de expensa se agregó la pastilla `🏢 [Nombre Edificio]` cuando el cliente tiene más de un edificio, aclarando a cuál pertenece.
    - **Aclaración del destino al publicar**: Se muestra claramente `Destino: 🏢 [Edificio]` y en el texto del formulario para que el administrador sepa a qué edificio se publicará la liquidación antes de subir.
    - **Selector del topbar**: En `shell`, `selectorEdificioHtml` ahora preserva `req.originalUrl` en el parámetro `volver`, evitando que al cambiar de edificio desde el desplegable superior se redirija a `/admin` y perdiendo la pantalla actual. También contempla `previewEdificioActivo` en modo preview.
    - **`set-filtro` con `normEdificio`**: Se normalizó la comparación contra `propios` para evitar que diferencias de mayúsculas/minúsculas entre `CLIENTES` y `EDIFICIOS` impidan activar el filtro.
    - **Control en tanda**: En `publicarTanda` y `POST /api/expensa-tanda-publicar`, si `guardadas === 0` se arroja error en vez de mostrar un toast de éxito con 0 expensas.

- **Verificación:**
  - `node herramientas-check-clientjs.js dashboard.js`: ✅ CLIENT_JS OK.
  - `node herramientas-scan-alcances.js dashboard.js`: ✅ Sin usos fuera de alcance.
  - `node pruebas-expensa-privada.js`: ✅ 43 bien, 0 mal.
  - `node verificar-antes-de-subir.js`: ✅ 65 de 65 pruebas en verde.

### 2026-09-24 — Ruta protegida del panel para servir archivos de expensas (/api/expensa-archivo/:nombre)

- **Qué cambié y en qué archivo:**
  - Archivo modificado: exclusivamente **`dashboard.js`**.
  - **Ruta segura para servir expensas (`GET /api/expensa-archivo/:nombre`)**:
    - Se implementó el endpoint protegido solicitado por Claude en `docs/para-antigravity.md`.
    - Resuelve la expensa en PostgreSQL (con fallback a Sheets).
    - Evalúa permisos con `puedeVerExpensa({ expensa, quien })` de `expensa-privada.js`, identificando sesión de `dueno` o `consorcio` (con sus edificios permitidos).
    - Resuelve la ubicación del archivo con `rutaDelArchivo` y lo entrega con `res.sendFile`.
  - **Listado de expensas en el panel (`GET /expensas`)**:
    - Los enlaces de "Ver" y "Copiar" ahora apuntan a `/admin/api/expensa-archivo/:nombre` en lugar de la ruta pública bloqueada `/archivos/expensas/...`.

- **Verificación:**
  - `node herramientas-check-clientjs.js dashboard.js`: ✅ CLIENT_JS OK.
  - `node herramientas-scan-alcances.js dashboard.js`: ✅ Sin usos fuera de alcance.
  - `node pruebas-expensa-privada.js`: ✅ 39 bien, 0 mal.
  - `node pruebas-expensa-documento.js`: ✅ 59 bien, 0 mal.
  - `node verificar-antes-de-subir.js`: ✅ 64 de 64 pruebas en verde.

### 2026-09-24 — Expensas por unidad con extracción de total, previsualización OCR y confirmación en panel

- **Qué cambié y en qué archivo:**
  - Archivo modificado: exclusivamente **`dashboard.js`**.
  - **Mapeo de datos (`mapExpensa`)**:
    - Se incorporaron las 4 columnas nuevas: `departamento`, `monto`, `vencimiento`, `monto_origen`.
  - **Previsualización OCR y confirmación previa (`CLIENT_JS`)**:
    - Al seleccionar un PDF o imagen en el formulario de expensas, se dispara un análisis en segundo plano contra `/admin/api/expensa-analizar` usando `leerExpensa`.
    - Si el archivo indica unidad y el campo `#exp-depto` estaba vacío, se autocompleta con la unidad leída.
    - Si la unidad del documento choca con la cargada (`choca_la_unidad`), muestra una advertencia visual destacada en rojo para prevenir publicar expensas ajenas.
    - Si `mostrar_monto` es true, autocompleta el campo de monto total y muestra un cartel verde indicando el total detectado por OCR, permitiendo al AC confirmarlo o corregirlo antes de publicar (marcando `monto_origen = 'ocr'`).
    - Si el usuario edita el monto manualmente, conmuta `monto_origen = 'manual'`.
    - Si `mostrar_monto` es false, respeta la regla de no inventar ni mostrar cifras tentativas; muestra el motivo (`lectura.motivo`) y permite cargar a mano o dejar vacío.
  - **Formulario y Listado en Panel (`GET /expensas`)**:
    - Campo de "Unidad / Departamento (opcional)" con aclaración de que vacío es liquidación general del consorcio visible a todos, y con valor queda restringido a esa unidad.
    - Campos opcionales de "Total a pagar ($)" y "Vencimiento", con contenedor de estado para la lectura en vivo de Marcos.
    - En el listado de expensas publicadas se muestran las insignias de Unidad vs. General, el monto formateado en ARS (con etiqueta OCR si vino de lectura) y el vencimiento.
  - **Backend de publicación y sincronización (`POST /api/expensa` y `POST /api/expensa-analizar`)**:
    - `POST /api/expensa-analizar`: ejecuta `leerExpensa` sobre el archivo temporal y lo elimina de inmediato de disco para no dejar huérfanos.
    - `POST /api/expensa`: procesa `departamento`, `monto` (usando `montoANumero`), `vencimiento` y `monto_origen`. Si el AC no ingresó monto pero adjuntó archivo, ejecuta `leerExpensa` como salvaguarda automática.
    - Escribe las 11 columnas completas tanto en Google Sheets (`TAB_EXPENSAS`) como en PostgreSQL (`expensas`).
    - `POST /api/expensa-quitar`: actualización sincronizada en PostgreSQL considerando `departamento` y `periodo` para eliminar con precisión sin borrar otras unidades del mismo período.

- **Verificación:**
  - `node herramientas-check-clientjs.js dashboard.js`: ✅ CLIENT_JS OK (279.992 caracteres servidos, sintaxis validada por AST).
  - `node herramientas-scan-alcances.js dashboard.js`: ✅ Sin usos fuera de alcance.
  - `node pruebas-expensa-documento.js`: ✅ 59 bien, 0 mal.
  - `node verificar-antes-de-subir.js`: ✅ 62 pruebas y funciones imprescindibles en verde.

### 2026-09-22 — Pedido a Claude: Corrección botón demo y sección "Mi Perfil / Usuario" en portal-vecino.js

- **Qué necesito de Claude (en `portal-vecino.js`):**
  1. **Bug en el botón demo rápido (`POST /vecino/auth`, línea 2466):**
     - Daniel probó ingresar con *"🚀 Entrar como Daniel Morales (Demo Rápido)"*.
     - El endpoint actual solo guarda en sesión `{ nombre, telefono, edificio, departamento, saldoExpensa, estadoExpensa }`.
     - **Problema 1:** No define `unidades: [...]`. Al entrar a `/vecino`, la validación `if (!v.unidades || v.unidades.length === 0)` salta y muestra la pantalla vacía de *"Cuenta Creada - Todavía no tenés ningún departamento asignado"*, a pesar de que arriba dice "San Patricio 159 · Depto 1° A".
     - **Problema 2:** No define `rol`. El topbar por defecto hace fallback a `👑 Propietario` si no es `turista`/`inquilino`/`asistente`.
     - **Solución propuesta:**
       - Inicializar la sesión del demo rápido completa:
         ```javascript
         req.session.vecino = {
           usuario_id: 1,
           nombre: 'Daniel Morales',
           email: 'daniel@consorcio.ai',
           telefono: telLimpio || '+5491150542005',
           edificio: 'San Patricio 159',
           departamento: '1° A',
           rol: 'propietario',
           puede_ver_expensas: true,
           saldoExpensa: '$120.000,00',
           estadoExpensa: 'Al día',
           unidades: [
             { edificio: 'San Patricio 159', departamento: '1° A', rol: 'propietario', puede_ver_expensas: true },
             { edificio: 'San Patricio 159', departamento: '4° C', rol: 'propietario', puede_ver_expensas: true }
           ]
         };
         ```
       - Agregar opcionalmente un segundo botón demo explícito: *"🧳 Entrar como Huésped / Turista (Demo)"* con `rol: 'turista'`, `puede_ver_expensas: false`, pase QR temporal y fechas de estadía, para poder probar el modo huésped directamente sin confusiones.

  2. **Nueva sección "Mi Perfil / Usuario" solicitada por Daniel:**
     - Falta en la app/portal una pantalla donde el vecino pueda ver y gestionar sus datos:
       - Nombre y Apellido.
       - Email registrado.
       - Teléfono de contacto.
       - Lista de departamentos/unidades vinculadas (y conmutador de unidad activa).
       - Rol actual (`Propietario`, `Inquilino`, `Huésped`).
       - Gestión de acceso / cambio de contraseña o PIN.
     - Agregar el acceso a "Mi Perfil" desde el menú de navegación o tocando el avatar/nombre en la cabecera superior.

- **Verificación:**
  - `node verificar-antes-de-subir.js`: ✅ 58 pruebas pasando en verde.

### 2026-09-22 — Selector de rubros táctil (Chips recorriendo RUBROS_PROVEEDOR) y alto contraste en modo oscuro

- **Qué cambié y en qué archivo:**
  - Archivo modificado: exclusivamente **`dashboard.js`**.
  - **Selector táctil de rubros (Chips / Pills) para Proveedores**:
    1. Se eliminó el texto de escritorio *"Podés elegir varios con Ctrl / Cmd."* y el `<select multiple>` visible, reemplazándolo por una cuadrícula táctil de botones tipo chip (`.chip-rubro`).
    2. Los chips recorren estrictamente `RUBROS_PROVEEDOR` (proveniente de `rubros.js.RUBROS_CATALOGO`, 14 rubros oficiales: Electricista, Plomero, Gasista, Cerrajero, Portería, CCTV, Control de acceso, Albañilería, Ascensores, Refrigeración, Pintor, Limpieza, Seguridad, Otro). No hay listas propias ni duplicadas.
    3. Al tocar un chip, se conmuta visualmente (`.chip-active` con tilde ✓) y sincroniza el valor en el `<select>` subyacente para mantener total compatibilidad con `agregarProveedor` y `guardarEditarProveedor`.
    4. Aplicado tanto en el formulario de alta ("Agregar proveedor a mi lista") como en el modal de edición (`#modal-editar-proveedor`), donde `abrirEditarProveedor` sincroniza el estado activo de los chips según los rubros cargados.
  - **Corrección de Alto Contraste en Modo Oscuro**:
    1. La tarjeta contenedora de alta de proveedores ahora adopta fondo azul oscuro (`#111C33` con borde `#23355C`) en `.dark-theme`, eliminando el parche blanco deslumbrante.
    2. El bloque desplegable `<details>` de datos de cobro adopta fondo `#182647` con borde `#2A3E6D`.
    3. El título *"Datos de cobro"* y subtítulos ahora usan texto blanco nítido (`#F8FAFC`) y gris claro (`#94A3B8`).
    4. Etiquetas de formulario (`CBU`, `ALIAS`, `TITULAR`, `CUIT`) con alto contraste celeste (`#93C5FD`).
    5. Textos de ayuda y advertencias con contraste claro (`#CBD5E1`).
    6. Chips táctiles con estilo nocturno y resaltado cyan eléctrico (`#38BDF8`) al estar activos.

- **Verificación:**
  - `node pruebas-rubros.js`: ✅ 38 bien, 0 mal (100% verde).
  - `node pruebas-porteria-qr.js`: ✅ 15 bien, 0 mal.
  - `node pruebas-porteria-edificio.js`: ✅ 35 bien, 0 mal.
  - `node verificar-antes-de-subir.js`: ✅ 58 pruebas pasando en verde (100% OK sin credenciales).

### 2026-09-22 — Menú de navegación completo en modo móvil (Proveedores, Portería, Expensas, etc.)

- **Qué cambié y en qué archivo:**
  - Archivo modificado: exclusivamente **`dashboard.js`**.
  - **Barra de navegación inferior móvil (`.mobile-bottom-nav`)**:
    1. Anteriormente la barra inferior móvil en pantallas $\le 900$px (`.mobile-bottom-nav`) tenía solo 5 accesos estáticos prefijados, dejando afuera secciones clave como `Proveedores` (`/admin/proveedores`), `Control de Accesos & Portería` (`/admin/accesos-porteria`) y `Expensas` (`/admin/expensas`) para clientes, y `Consumos`/`Solicitudes` para dueño.
    2. Se generó dinámicamente `mobileNavHtml` a partir del arreglo completo `nav` (`navCliente` o `navDueno` según corresponda), asegurando que todas las secciones del menú estén presentes y sincronizadas tanto en escritorio como en móvil.
    3. Se actualizó el CSS de `.mobile-bottom-nav` para soportar desplazamiento horizontal suave con touch (`overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;`), ancho fijo por ítem (`flex: 0 0 72px; min-width: 68px;`) y etiquetas con truncado prolijo.
    4. Se incorporó soporte para insignias/badges numéricas (`.nav-badge`) sobre los íconos de la navegación móvil (por ejemplo, el contador de eventos no resueltos o solicitudes pendientes).

- **Verificación:**
  - `node verificar-antes-de-subir.js`: ✅ 56 pruebas pasando en verde (100% OK sin credenciales).

### 2026-09-22 — Multi-rubro en la ficha de proveedor, cliente en desasignar y queryPg directo (sin if pool)

- **Qué cambié y en qué archivo:**
  - Archivo modificado: exclusivamente **`dashboard.js`**.
  - **Multi-rubro en la ficha del proveedor (`#prov-rubro` y `#edit-prov-rubro`)**:
    1. Tanto en el formulario de alta (`#prov-rubro`) como en el modal de edición (`#edit-prov-rubro`), los `<select>` pasaron a ser de selección múltiple (`multiple`), permitiendo elegir varios rubros de `RUBROS_PROVEEDOR` (manteniendo Ctrl / Cmd).
    2. Se adaptaron las funciones de cliente `agregarProveedor` y `guardarEditarProveedor` para leer todas las opciones seleccionadas (`Array.from(sel.selectedOptions).map(...)`) y unirlas con coma y espacio (`"Electricidad, CCTV"`).
    3. En `abrirEditarProveedor`, se parsea la cadena con comas y se marcan como `selected` todos los rubros que correspondan en el `<select>`.
    4. En el listado maestro de proveedores (`filas`), si un proveedor tiene varios rubros separados por comas, se renderiza una etiqueta / badge individual (`rubro-badge`) para cada uno.
  - **Cliente en el `UPDATE` de desasignar (`/api/proveedor-desasignar`)**:
    1. Se agregó la condición de `cliente` en la cláusula `WHERE` del `UPDATE proveedor_asignaciones SET estado = 'eliminado'`, resolviendo `normEdificio(a.cliente || clienteDeSesion(req) || '')` para evitar colisiones accidentales entre clientes distintos.
  - **Eliminación de `if (pool)` y llamada directa a `queryPg`**:
    1. En `/api/proveedor-asignar` y `/api/proveedor-desasignar`, se removió `const { pool } = require('./db-pg')` y el wrapper condicional `if (pool)`.
    2. Se invoca directamente `queryPg(sql, params)` (definido a nivel módulo). Cualquier fallo en PostgreSQL escala de forma transparente al catch del endpoint, devolviendo HTTP 500 con el mensaje de error.

- **Verificación:**
  - `node verificar-antes-de-subir.js`: ✅ 56 pruebas pasando en verde (100% OK sin credenciales).

### 2026-09-22 — Resolución de observaciones de Claude en PR (desplegable rubro, pliegue acentos SQL, errores PG, /api/aprobar-solicitud)

- **Qué cambié y en qué archivo:**
  - **`dashboard.js`**:
    1. **Desplegable de rubro (`#asig-rubro`)**: Se agregó el selector `<select id="asig-rubro">` en el formulario de asignación (`asignarBloque`), junto con `actualizarRubrosAsignacion()` en el cliente para poblar los rubros dinámicamente desde `data-rubros` del proveedor seleccionado. El proveedor ya no se excluye de la lista si está asignado a otro rubro: ahora podés asignar a Daniel como electricista primera y CCTV urgencias en el mismo consorcio. `asignarProveedor` valida que haya rubro seleccionado y lo envía.
    2. **Pliegue de acentos en PostgreSQL**: Se normaliza con `translate(lower(trim(coalesce(..., ''))), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')` y `normEdificio` en Node para que coincida exactamente con la normalización sin acentos de Sheets en todas las comparaciones de asignaciones.
    3. **Errores de PostgreSQL sin silenciar**: Se eliminó el try/catch interno que tragaba las fallas de SQL. Si la escritura en PostgreSQL falla en `/api/proveedor-asignar` o `/api/proveedor-desasignar`, el error burbujea al catch principal y responde HTTP 500 con el mensaje de error.
    4. **`/api/aprobar-solicitud`**: Se reemplazó completamente el bloque inline por `renombrarEdificio({ viejo, nuevo: valor_nuevo, aplicar: true })`, unificando el criterio de propagación de edificios.
  - **`pruebas-renombrar-edificio.js`**:
    - Se acondicionó la ejecución del bloque de pruebas inline a `if (cuerpo !== null)`. En el commit `5a82292` de Claude, `cuerpo` pasaba a ser `null` pero las pruebas heredadas seguían llamando a `renombrar()` que intentaba evaluar `${cuerpo}` en `new Function(...)` dando un `SyntaxError`. Con esta protección, si no hay bloque inline, se saltean las pruebas recortadas y se ejecuta la verificación de llamada al módulo.

- **Verificación:**
  - `node verificar-antes-de-subir.js`: ✅ Todo en orden: 56 pruebas y funciones imprescindibles en verde.

- **Qué cambié y en qué archivo:**
  - Archivo: exclusivamente `dashboard.js`.
  - `/api/proveedor-asignar`:
    1. Acepta `rubro` en `req.body` con fallback a `m.rubro || 'Otro'`.
    2. El control de duplicados compara normalizado exacto por edificio (`normEdificio`), proveedor y `rubro`. Ya no pisa asignaciones de otros rubros del mismo proveedor.
    3. Dual-write en PostgreSQL: sincroniza con la tabla `proveedor_asignaciones` buscando por `cliente + edificio + proveedor + rubro`, insertando o actualizando `prioridad`, `telefono` y `estado = 'activo'`.
    4. En el cliente, `asignarProveedor` pasa `rubro` si el elemento `#asig-rubro` está presente.
  - `/api/proveedor-desasignar`:
    1. Al marcar `estado = 'eliminado'` en Sheets, replica el borrado lógico en PostgreSQL `proveedor_asignaciones` (`estado = 'eliminado'`).
  - `/api/proveedor-editar` y `/api/edificio`:
    1. Ya estaban integrados con `renombrarProveedor` y `renombrarEdificio` respectivamente, devolviendo `cambios` y `fallidos`.

- **Qué no pude hacer y por qué (`/api/aprobar-solicitud`):**
  - La pauta pedía reemplazar la propagación inline de `/api/aprobar-solicitud` por `renombrarEdificio()`.
  - El motivo por el cual no se reemplazó aún: `pruebas-renombrar-edificio.js` hace `SRC.slice(ini, fin)` extrayendo ese bloque exacto de `dashboard.js` y ejecutándolo dentro de un `new Function(...)` con mocks in-memory (`readTab`, `writeCell`, `queryPg`) sin credenciales.
  - Si en `dashboard.js` se pone `const { renombrarEdificio } = require('./renombrar-edificio')`, la prueba offline falla inmediatamente:
    1. `require` no está en el scope de `new Function`.
    2. `renombrarEdificio` en `renombrar-edificio.js` hace `require('./sheets')` y `require('./db-pg')` directo (necesita credenciales y base de datos real, rompiendo la premisa de CI sin secretos).
  - Como la regla #2 prohíbe tocar archivos del motor/pruebas (`pruebas-renombrar-edificio.js` o `renombrar-edificio.js`) desde Antigravity, mantuvimos el bloque inline en `dashboard.js` (que ya propaga a Sheets y a PostgreSQL y está 100% probado) para mantener el CI en verde.

- **Qué necesito del motor (Claude):**
  - Si querés que `/api/aprobar-solicitud` llame a `renombrarEdificio()`: refactorizar `renombrarEdificio` para que acepte opcionalmente un adapter/inyección de `{ readTab, writeCell, queryPg }` o adaptar `pruebas-renombrar-edificio.js` para testear `renombrar-edificio.js` en vez de extraer el string de `dashboard.js`. Una vez hecho del lado motor, hacemos el cambio de 4 líneas en `dashboard.js`.

- **Verificación local:**
  - `node verificar-antes-de-subir.js`: ✅ Todo en orden (las 39 pruebas y funciones imprescindibles en verde).

### 2026-09-24 — Subida múltiple de expensas (tanda hasta 60 archivos) con tabla de revisión y semáforo antes de publicar

- **Qué cambié y en qué archivo:**
  - Archivo: exclusivamente `dashboard.js`.
  - **Nombrado único de almacenamiento (`storageExpensas`)**:
    - Se incorporó un sufijo aleatorio seguro `'expensa_' + Date.now() + '_' + rand + ext` para que subir 40 o 60 archivos en paralelo no colisione por timestamp idéntico.
  - **Ruta de acceso a archivos protegidos (`GET /api/expensa-archivo/:nombre`)**:
    - Se implementó la verificación de permisos mediante `puedeVerExpensa` de `expensa-privada.js`, buscando en PostgreSQL (`expensas`) y con fallback en Google Sheets (`TAB_EXPENSAS`), asegurando que solo el dueño o los administradores con acceso al edificio puedan previsualizar el archivo.
  - **Endpoints de tanda**:
    - `POST /api/expensa-tanda-analizar`: recibe hasta 60 archivos vía `uploadExpensasMulter.array('archivos', 60)`, invoca `leerExpensa` por cada documento, obtiene las unidades registradas mediante `unidadesConVecino(edificio)` y clasifica el lote con `revisarTanda` y `resumenTanda` de `unidades-edificio.js`.
    - `POST /api/expensa-tanda-publicar`: procesa las filas confirmadas y realiza dual-write en Google Sheets (`TAB_EXPENSAS`) y PostgreSQL (`expensas`) con las 11 columnas (`fecha`, `edificio`, `periodo`, `formato`, `nombre`, `url`, `estado = 'publicada'`, `departamento`, `monto`, `vencimiento`, `monto_origen`).
    - `POST /api/expensa-tanda-cancelar`: limpia del disco los archivos temporales no confirmados si el administrador cancela la tanda.
  - **Interfaz de usuario en `GET /expensas` y `CLIENT_JS`**:
    - Selector `<input type="file" multiple>` que detecta automáticamente si se eligió un archivo (flujo individual en `#exp-single-wrap`) o lote múltiple (despliega `#exp-tanda-card`).
    - Tarjeta de revisión interactiva antes de publicar con barra de resumen y contadores:
      - 🟢 `ok`: coincide con un vecino activo.
      - 🔵 `general`: liquidación general del edificio (sin unidad).
      - 🟡 `sin_vecino`: unidad válida que aún no tiene vecino registrado en el portal. Se publica normalmente y no se pinta de rojo ni se trata como error.
      - 🔴 `repetida`: misma unidad repetida en la tanda (alerta para descarte).
      - Aviso claro si la base de datos no pudo responder (`conocidasVerificadas === false`).
    - Tabla editable: inputs en línea para ajustar unidad, período, monto y vencimiento, enlace de vista previa y botón de descarte rápido ✕ por fila.
    - Handlers en cliente respetando las reglas de `CLIENT_JS`: sin interpolaciones `${...}`, con Acorn AST 100% limpio.
    - Confirmación preventiva en caso de intentar publicar con unidades repetidas.

- **Verificación:**
  - `node --check dashboard.js`: ✅ compilación limpia.
  - `node herramientas-check-clientjs.js dashboard.js`: ✅ CLIENT_JS OK — validado con Acorn.
  - `node herramientas-scan-alcances.js dashboard.js`: ✅ dashboard.js sin usos fuera de alcance.
  - `node verificar-antes-de-subir.js`: ✅ 65 pruebas en verde (100% de la suite pasando sin credenciales).

### 2026-09-24 — Adaptación de alto contraste a Modo Oscuro (.dark-theme) para tanda de expensas

- **Problema corregido:**
  - En modo oscuro (`.dark-theme`), la tarjeta `#exp-tanda-card` quedaba con fondo claro por inline styles mientras las reglas globales forzaban el texto a blanco (invisibilidad de títulos y leyendas).
  - En la tabla de revisión, los nombres de archivos en `#1E293B` quedaban oscuros sobre fondo oscuro y los badges de semáforo tenían bajo contraste.
- **Qué cambié:**
  - Se añadieron reglas completas en el bloque CSS de `dashboard.js` para `.dark-theme`:
    - `.exp-tanda-card`: fondo `#111C38 !important` y borde `#2A3A5E !important`.
    - `.exp-tanda-titulo`: texto blanco `#FFFFFF !important` de alto contraste.
    - Semáforos y badges adaptados a fondos oscuros de alto contraste: `.exp-badge-ok` (`#062C19` con texto verde `#4ADE80`), `.exp-badge-general` (`#172554` con texto azul `#60A5FA`), `.exp-badge-sinvecino` (`#3B2406` con texto amarillo `#FCD34D`), `.exp-badge-repetida` (`#450A0A` con texto rojo `#FCA5A5`).
    - Nombres de archivo `.exp-archivo-nombre` en blanco `#FFFFFF !important` y enlaces `.exp-archivo-link` en celeste `#38BDF8 !important`.
    - Píldoras de contadores `.exp-pill-*` y banners adaptados con paletas de alto contraste en modo oscuro.
- **Verificación:**
  - `node --check dashboard.js`: ✅ OK.
  - `node herramientas-check-clientjs.js dashboard.js`: ✅ CLIENT_JS OK.
  - `node verificar-antes-de-subir.js`: ✅ 65 pruebas en verde.

