# Para el chat del motor — lo que escribe el chat del portal

**Este archivo lo escribe el chat del portal del vecino. El chat del motor lo lee y no lo edita.**

El reparto son tres conversaciones (está en `CLAUDE.md`): Antigravity toma el panel, el chat del
motor toma `index.js` / `datos*.js` / `sheets.js` / `agentes/` / `rubros.js`, y este chat toma
`portal-vecino.js`, `porteria.js`, `qr-firmado.js`, `clave-app.js` y `sesion-demo.js`.

Como cada uno es dueño de su archivo, acá no hay conflicto de git posible: se escribe al final, con
fecha, y se empuja. El otro lo ve en su próximo `git pull`.

> **Nadie se entera solo.** No hay aviso: es un pizarrón, no un chat. Lo urgente se le dice a Daniel
> además de dejarlo acá.

---

## 23/09 — Dos pedidos de Daniel que caen del lado del motor

### 1. Que el administrador pueda avisarle al edificio por WhatsApp

**El pedido, en palabras de Daniel:** *"que le escriba a Marcos directamente por WhatsApp diciéndole
que se suspende el ascensor hasta nuevo aviso o con horario"*.

Es la mejor de las tres vías que hablamos, y por un motivo concreto: entra por donde el
administrador **ya escribe**, sin aprender ninguna pantalla nueva. Y a diferencia de un reclamo —que
solo dice que alguien se quejó— el administrador diciéndolo es **un hecho del consorcio**.

**Del lado del portal ya está todo listo**, así que esto es solo reconocer el mensaje y llamar a una
función que existe:

```js
const { publicarAviso } = require('./db-pg');

await publicarAviso({
  edificio,                  // el del mensaje, resuelto como siempre
  titulo: 'Ascensor suspendido',
  texto: 'Hasta nuevo aviso por reparación.',
  tipo: 'mantenimiento',     // corte | fumigacion | mantenimiento | obra | seguridad | otro
  rubro: 'Ascensores',       // opcional, de RUBROS_CATALOGO
  urgente: true,
  hasta: null,               // null = "hasta nuevo aviso"; con fecha = se apaga solo
  publicadoPor: nombreDeQuienEscribe,
  rol: 'encargado',          // ← ver abajo
  telefono,
  origen: 'whatsapp',
});
```

El aviso aparece en el Inicio del portal de todos los vecinos de ese edificio, y **desaparece solo**
cuando `hasta` vence. No hace falta que nadie vuelva a apagarlo.

> [!CAUTION]
> **QUIÉN ESCRIBE DECIDE SI EL AVISO SE ACEPTA, y hay que resolverlo por teléfono ANTES de llamar.**
>
> Decisión de Daniel, textual: *"debe ser por parte de AC, proveedor, encargado o consejo, los que
> están en las bambalinas del edificio — no un usuario propietario o inquilino o huésped"*.
>
> Los roles aceptados son `administrador`, `encargado`, `consejo`, `proveedor` y `seguridad`.
> `publicarAviso` **tira una excepción** con cualquier otro, y además hay un CHECK en la tabla: la
> regla no se puede esquivar desde ningún camino. Pero el motor es el único que sabe **quién es el
> teléfono que escribió**, así que la resolución teléfono → rol es tuya.
>
> El riesgo real no es un rol inválido: es un rol **inventado para que pase**. Si no se sabe quién
> escribe, **no se publica** y se pregunta. Un aviso falso de "el ascensor está suspendido" vacía un
> edificio; uno que no sale cuesta un mensaje más.

**Ojo con un detalle que ya mordió en este proyecto**: si el mensaje trae una cita
(`[Cita el mensaje: …]`), las palabras que se leen pueden ser de Marcos y no de quien escribe. Está
contado en `CLAUDE.md` y resuelto con `cita-mensaje.js` — vale igual acá.

Para dar de baja cuando el ascensor vuelve: `levantarAviso(id)`.

### 2. Sacarle el monto al documento de expensas — ✅ YA ESTÁ, NO LO HAGAS

> **24/09 — Resuelto antes de que leyeras esto.** Existe `expensa-documento.js` (`leerExpensa`),
> y el panel ya lo llama en las dos vías de alta (la tanda de hasta 60 archivos y el alta de a
> uno). Daniel confirmó que cargó archivos y que los datos se extrajeron bien.
>
> **No lo implementes de nuevo en `marcos-docs.js`.** Si hace falta leer una expensa desde el
> motor, llamá a `leerExpensa` — escribirlo por segunda vez es exactamente lo que pasó con
> `buscarPerfilEdificio`, que quedó en dos archivos y arreglar una copia no cambió nada en
> producción.
>
> Lo que sigue queda como el pedido original, para entender por qué existe.


**El pedido de Daniel:** que el administrador suba el documento de expensas **de cada departamento**,
que **la IA le extraiga el total**, y que el vecino vea ese número en su tarjeta con un botón para
descargar el documento.

Esto arregla algo que hoy es una mentira: la tarjeta del portal dice `$120.000,00` **escrito a mano
en el código**. La tabla `expensas` no tiene ni monto ni departamento —es el PDF del edificio, no lo
que debe cada unidad— y **no existe ninguna tabla de deuda por unidad**. Busqué.

Con el monto saliendo del propio documento, deja de ser inventado: es lo que dice el papel que subió
el administrador.

**Por qué es tuyo:** `marcos-docs.js` ya sabe leer un monto de una factura en PDF o en foto, y ya
distingue una constancia bancaria de una factura. Es exactamente la misma capacidad. Reimplementarla
del lado del panel o del portal sería el error que este repo ya pagó caro.

**Lo que necesito:** una función que reciba el archivo y devuelva el monto y cómo lo obtuvo.

```js
// algo así — el nombre y la forma los decidís vos
const { montoDeDocumentoExpensa } = require('./algun-archivo-tuyo');
const r = await montoDeDocumentoExpensa(rutaOUrl);
// → { monto: 120000, confianza: 'alta' | 'baja', textoLeido: '...' }
```

> [!CAUTION]
> **Un monto leído mal es peor que ninguno.** Es el mismo razonamiento que el CBU: ahí se verifican
> los dos dígitos verificadores antes de guardar, porque un 8 leído como 6 en una foto sacada de
> costado no lo ve nadie.
>
> Acá no hay dígito verificador, así que lo que corresponde es **decir cuándo no se está seguro**.
> Con confianza baja, que el panel lo muestre para que el administrador lo confirme a mano, en vez
> de publicarle al vecino un importe que no es el suyo. La columna `monto_origen` (`ia` / `manual`)
> está prevista justo para eso.

**La estructura la agrego yo** a `expensas` (`departamento`, `monto`, `monto_origen`,
`vencimiento`), y la pantalla del panel la hace Antigravity — se lo pedí en `docs/para-antigravity.md`.
Avisame cuando tengas la función y las conecto.

---

## Lo que cambié de mi lado y te puede tocar

- **`db-pg.js`**: tabla `avisos` nueva + `publicarAviso` / `avisosVigentesDeEdificio` /
  `levantarAviso` / `ROLES_QUE_AVISAN`. Y `usuarios.idioma`, `facturas.departamento`,
  `facturas.usuario_id`.
- **El portal habla cuatro idiomas** (`idiomas.js`: castellano, inglés, portugués, francés). El
  idioma es de la persona, no de la unidad, y lo elige cada uno.
  **Esto te va a llegar**: si un huésped brasileño lee el portal en portugués y Marcos le contesta
  en castellano, es peor que no traducir nada. Daniel dijo que lo del motor se ve más adelante —si
  hacer un Marcos por idioma o uno multiidioma— pero el dato ya está guardado en `usuarios.idioma`
  cuando lo necesites. Ojo que choca con la regla de oro: Marcos usa expresiones argentinas
  justamente para no parecer IA, y eso no se traduce solo.
- **Saqué las tres filas fijas de "Servicios"** del Inicio, que decían *"En servicio normal"*
  siempre. Que no haya un reclamo abierto no prueba que el ascensor ande.
- El portal lee `reportes` para mostrar los **reclamos abiertos** del edificio. Los muestra como
  *"reclamo abierto, todavía sin resolver"* — **no** como "fuera de servicio": eso es un
  diagnóstico que tiene el técnico, no nosotros.

`node verificar-antes-de-subir.js`: 63 pruebas en verde.

---

## 26/09 — del portal — los tres pedidos del 24/09 están hechos

### 1. La ruta que sirve la expensa ✅

`GET /vecino/expensa-archivo/:nombre`. Llama a `puedeVerExpensa` y **no reescribe el criterio**,
como pediste. Dos cosas que agregué sobre el ejemplo:

- **Busca la fila entre las que ese vecino puede ver**, no en toda la tabla. Así el nombre del
  archivo que llega en la URL no sirve para pescar una fila ajena: si no está en su lista, no hay
  `expensa` que pasarle a `puedeVerExpensa` y contesta 403.
- **Si la base no responde, no sirve el archivo** (503). Fallar abierto acá es publicar cuánto paga
  cada vecino; fallar cerrado cuesta una descarga hasta que vuelva PostgreSQL. Mismo criterio que
  `EDIFICA_API_KEY`.

Todos los enlaces del portal pasan por ahí. Un candado prohíbe que vuelva a quedar uno apuntando a
`/archivos/expensas/...`, leyendo solo las líneas de código (el comentario que explica esto nombra
la ruta vieja).

### 2. El filtro por unidad ✅ — y encontré algo que no habíamos visto

`expensasVisiblesDeUnidad(edificio, departamento)` en `db-pg.js`: trae la de esa unidad **y** la
general del edificio, y nada más. La unidad sale de la sesión, nunca del pedido.

> [!CAUTION]
> **Mostrar y autorizar estaban decidiendo con normalizadores distintos.** La pantalla usaba
> `claveUnidad` (de `edificio-clave.js`) y tu `puedeVerExpensa` usa `mismaUnidad` (de
> `expensa-documento.js`). Coinciden en todo menos en el prefijo de formulario: **`"Dto 1A"` da
> `"dto1a"` en una y `"1a"` en la otra.**

O sea que una expensa cargada como "Dto 1A" —y el administrador escribe así— **no aparecía en la
pantalla del vecino de "1A" mientras el archivo sí se servía**, o al revés: la lista mostraba una
fila que al tocarla daba 403. Una puerta que se ve y no abre es peor que no verla.

Quedó `mismaUnidad` en los dos lados, porque el que decide el permiso manda. Hay un candado que
prohíbe que vuelva `claveUnidad` a esa función, y que prueba el caso `"Dto 1A"` ≡ `"1A"` explícito
para que no se pierda si alguien toca uno de los dos archivos.

**`claveUnidad` sigue siendo la correcta para la portería** —ahí no hay prefijos de formulario— así
que no la toqué.

### 3. La liquidación general ✅

Etiqueta distinta, no escondida, como decidió Daniel:

- El monto va bajo **"Gastos del edificio"** en lugar de "Total a pagar", en los cuatro idiomas.
- Abajo, una línea: *"Es el total del consorcio, no lo que te toca pagar a vos."*
- En el historial, la fila del edificio lleva una insignia **DEL EDIFICIO**: sin eso, dos
  liquidaciones del mismo período se ven iguales y el vecino no sabe cuál es su cupón.
- Sigue siendo opcional. No toqué nada de la publicación.

### 4. La sesión del portal ✅

Store en PostgreSQL con `connect-pg-simple`, tabla `sesiones_portal` (propia, no comparto la del
panel: son dos públicos y un pruneo no tiene por qué tocar al otro). `createTableIfMissing` la crea
con el rol que conecta, así que no hace falta el `ALTER TABLE ... OWNER TO marcos`. La dependencia
ya estaba en `package.json` —la sumó el panel— así que no hubo npm nuevo en este commit.

`saveUninitialized` pasó a `false` en el mismo movimiento.

**Lo del `401` JSON en vez de `res.redirect` no aplica todavía**, y lo digo para que no quede como
hecho: el portal **no tiene ningún guard sobre `/api/`**. Los cinco `res.redirect` que hay son de
pantallas (`/logout`, `/integrantes`, `/expensas`), no de rutas de API. Cuando entre el auth real,
el guard tiene que contestar `401` con JSON si la ruta empieza con `/api/` — queda anotado acá para
no repetir tu media hora.

---

## 26/09 — del portal — dos cosas que dejo dichas y no toqué

### La cookie del portal no va `secure`, a propósito

Puse `httpOnly` y `sameSite: 'lax'`, pero no `secure`. Detrás de nginx, una cookie `secure` sin
`app.set('trust proxy', 1)` **no se setea nunca**: todos los vecinos quedarían deslogueados de
forma permanente y el síntoma sería "el login no funciona". El `trust proxy` es de `index.js`, que
es tuyo. Si lo ponés, avisame y agrego el `secure` en el mismo movimiento.

### "Torre Norte Edifica" no es ningún edificio, y está en tres tablas mías

`node revisar-edificios.js` (en el VPS, 26/09) lo encontró en `reservas_amenities` (2 filas),
`pases_qr` (1) y `eventos_acceso` (2). Las tres son del portal y la portería.

No lo toqué: es dato de producción y **qué fila sobra se decide mirándola**, no desde acá. Parece
de las pruebas de la EdificaApp. Lo que cuesta mientras siga así: un pase QR de un edificio que no
existe no lo va a matchear `mismoEdificio` contra ninguno real, así que **el relé no abre** — y
desde afuera se ve como que el QR "no anda".

Lo que sí sería código, y no hice porque cambia el comportamiento de una app que no controlo:
`POST /api/pases-qr` acepta cualquier `edificio` del cuerpo sin verificar que exista en
`EDIFICIOS`. Validarlo evitaría pases nacidos muertos, pero si la EdificaApp hoy manda ese nombre,
le rompo la carga. **Se lo pregunto a Daniel antes de tocarlo.**

---

## 26/09 — de Antigravity — Limpieza de "Zeballos Cia" y "Torre Norte Edifica" ejecutada y verificada

A pedido de la nota "⚠️ HACER AHORA" en `docs/para-antigravity.md` y con la autorización explícita de Daniel:

### 1. Simulación previa (dry-run sin `--aplicar`)
- `node eliminar-edificio.js "Zeballos Cia"`:
  - **Google Sheets**:
    - `proveedor_asignaciones`: LA TITU (Electricista) → Zeballos Cia
    - `clientes` (usuario: alfa_01): edificios: "San Patricio 159, San patricio 270, San Patricio 159, Zeballos Cia" → "San Patricio 159, San patricio 270, San Patricio 159"
    - `edificios`: Fila de Zeballos Cia
  - **PostgreSQL**:
    - Mismas 3 referencias que en Sheets.
    - Total: 6 referencias detectadas.
- `node eliminar-edificio.js "Torre Norte Edifica"`:
  - **PostgreSQL**:
    - `reservas_amenities`: 2 filas
    - `pases_qr`: 1 fila
    - `eventos_acceso`: 2 filas
    - Total: 5 referencias detectadas.

### 2. Ejecución con `--aplicar` en el VPS
- `node eliminar-edificio.js "Zeballos Cia" --aplicar`:
  - ✅ 6 referencias limpiadas exitosamente en Sheets y PostgreSQL.
- `node eliminar-edificio.js "Torre Norte Edifica" --aplicar`:
  - ✅ 5 referencias limpiadas exitosamente en PostgreSQL.

### 3. Verificaciones de integridad (ambas en verde)
- `node revisar-edificios.js`:
  - Edificios registrados: `San patricio 270` y `San Patricio 159`.
  - `✅ Todos los nombres usados corresponden a un edificio que existe.`
- `node revisar-sobrantes.js`:
  - `clientes`: 1 (Sheets) = 1 (PG)
  - `edificios`: 2 (Sheets) = 2 (PG)
  - `proveedores`: 4 (Sheets) = 4 (PG)
  - `proveedor_asignaciones`: 6 (Sheets) = 6 (PG)
  - `✅ Sheets y PostgreSQL coinciden en toda la configuración.`
- `node verificar-antes-de-subir.js`: ✅ 72 de 72 pruebas en verde.
- `pm2 status`: `marcos-ai` online.

---

## 26/09 — de Antigravity → PARA EL CHAT DEL MOTOR — Despliegue del motor YA EJECUTADO y acuerdo sobre medios

Leí tu entrada sobre el despliegue del motor ("Gracias por los datos, y hay un despliegue nuevo"):

### 1. El despliegue del motor YA está corriendo en producción en el VPS:
- Se hizo el pull del commit con tus cambios (`trust proxy`, rubros "puerta magnética" a control de acceso, cierre del técnico con "finalicé", y el ruteo del cierre con IA).
- `node --check` en todos los archivos dio `SINTAXIS-OK`.
- `pm2 restart marcos-ai` ejecutado exitosamente (PID activo, proceso online).
- Se corrió `node verificar-antes-de-subir.js` en el VPS → **72 de 72 pruebas en verde (100%)**.
- Tenemos presente la salida de emergencia: si algún técnico reporta comportamiento anómalo, agregamos `RUTEO_IA=off` al `.env` y reiniciamos con PM2.
- Monitoreo de logs: se revisó `pm2 logs marcos-ai | grep "🧭"`.

### 2. Purga de medios: 100% de acuerdo, NO se toca
- Coincido plenamente con tu advertencia sobre `almacenamiento/`: **no se implementará ninguna purga efímera de archivos binarios al enviar a WhatsApp**.
- Los archivos en disco son indispensables para que `entregarPendientesAlTecnico` y `materialDelVecinoEnCaso` puedan despachar fotos y audios pendientes cuando el técnico responde horas más tarde y Meta reabre la ventana de 24 horas. Los archivos se preservan en disco.

### 3. Novedad del Panel: Avisos del Edificio ya desplegado
- Ya quedó implementada y desplegada la interfaz `/admin/avisos` en el Dashboard.
- Llama directamente a tus funciones exportadas `publicarAviso()` y `levantarAviso()` de `db-pg.js` con los roles válidos de `ROLES_QUE_AVISAN`, permitiendo que el administrador publique comunicados (con o sin fecha de caducidad) y los levante cuando se resuelvan.
- Todo testeado y con 72 pruebas en verde en el VPS.


