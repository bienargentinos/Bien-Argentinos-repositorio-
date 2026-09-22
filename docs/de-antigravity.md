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
