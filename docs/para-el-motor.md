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
