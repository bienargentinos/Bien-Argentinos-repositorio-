# Portal del vecino y portería — informe para arrancar

**Para el chat que se ocupe de esta parte.** Leé primero `docs/para-cualquier-agente.md` (siete
reglas cortas) y después esto. `CLAUDE.md` es la memoria larga del proyecto; lo de acá es solo lo
de este rincón, para no tener que leerlo entero.

---

## Qué es cada cosa

| Archivo | Qué hace | Tamaño |
|---|---|---|
| `portal-vecino.js` | El portal web del vecino: reservas de amenities, expensas, reclamos, pases QR, integrantes de la unidad, chat. Montado en `/vecino` y `/portal`. | 6784 líneas, 39 rutas |
| `porteria.js` | El timbre y la apertura de puerta. Quién suena en el teléfono de quién, y quién puede abrirle a alguien parado en la vereda. | 1839 |
| `qr-firmado.js` | Firma y verificación de los pases QR. | 192 |
| `clave-app.js` | La clave que manda la app Edifica cuando no hay sesión del panel. | 93 |
| `sesion-demo.js` | La sesión de prueba del portal (propietario / huésped), en un solo lugar. | 88 |

**Edifica** es la app móvil del vecino. Su código **no está en este repo**: acá viven solo los
puntos por donde el servidor le habla (`clave-app.js`, `qr-firmado.js`, las rutas `/api/pases-qr`).

## Esta parte es 100% PostgreSQL

`portal-vecino.js` **no toca Google Sheets ni una vez** — verificado. Usa estas tablas:

```
usuarios · vecinos · edificios · edificio_amenities · reservas_amenities
expensas · facturas · reportes · cuentas_bancarias
```

Eso te ahorra la mitad de los dolores del resto del proyecto, donde el panel lee Sheets y el motor
lee PostgreSQL y hay que emparejarlos. **Acá no: hay una sola base.** No la rompas.

La excepción es `reportes`: una reserva de amenity también deja un evento ahí, para que el
administrador la vea en su panel junto con todo lo demás. Eso pasa por `reserva-evento.js`, que
llama a `guardarReporte` en vez de escribir la fila a mano — y tiene su motivo, explicado en
`CLAUDE.md` (buscar *"Una reserva de amenity también es un evento, pero NO es un caso"*).

## Lo que ya está resuelto, para no volver a romperlo

Cada una tiene su candado. Corrélos antes de subir.

- **El timbre de un edificio no puede sonar en otro.** Había tres agujeros: la falta de dato hacía
  comodín, dos nombres de edificio estaban escritos a mano en el código, y con **un solo** timbre
  sonando en todo el sistema se lo devolvía a cualquiera que preguntara. Con un solo edificio de
  prueba los tres dan el resultado correcto por casualidad — por eso
  `pruebas-porteria-edificio.js` levanta siempre dos.
- **El pase QR le pasa al relé el edificio del PASE**, no el del pedido: el del cuerpo lo escribe
  el tótem y no lo verifica nadie.
- **`/api/pases-qr` estuvo abierto a internet** porque se le sacó el control de acceso para que la
  app funcionara. Con eso se podían crear, leer (con sus tokens) y revocar pases de cualquier
  edificio. Ahora va por `X-Edifica-Key`, y `pruebas-clave-app.js` detecta si vuelve el
  `return next()` directo.

```bash
node pruebas-porteria-edificio.js
node pruebas-porteria-qr.js
node pruebas-qr-firmado.js
node pruebas-clave-app.js
node pruebas-apertura-remota.js
node pruebas-timbre-destino.js
node pruebas-perfil-vecino.js
node pruebas-reserva-evento.js
```

O todo junto, que es lo que exige el CI:

```bash
node verificar-antes-de-subir.js
```

## Lo que falta, de más grande a más chico

### 1. El estado del timbre vive en RAM

`_timbresActivos` y `_aperturasPuerta` son `Map` del proceso. Un `pm2 restart` en medio de un
timbre **pierde la llamada**, y el diseño **no puede correr en más de un proceso**.

> [!CAUTION]
> **El arreglo NO es "mover el Map a PostgreSQL".** `/api/timbre-check` lo sondea el celular de
> cada vecino cada pocos segundos, **haya o no haya alguien tocando**. Una consulta a la base por
> cada sondeo, multiplicada por los vecinos de cada edificio, es peor que el problema que resuelve.

Lo que corresponde es dejar de sondear (SSE o WebSocket) o mantener la RAM como caché alimentada
por la base. Es su propio trabajo, no un renglón.

### 2. No hay login real

El portal dice, en el arranque del servidor:

```
🚧 Portal del vecino ACTIVO en /vecino y /portal — sin login real todavía.
   No dejar prendido en producción.
```

Hay `/api/solicitar-pin`, `/api/verificar-pin`, `/api/login-email` y `/api/registro-email`, y desde
el 22/09 el vecino puede cambiar su contraseña desde `/vecino/perfil` (`cambiarPasswordUsuario` en
`db-pg.js`, que verifica la actual contra el hash antes de escribir). Lo que sigue faltando es el
resto del **auth real**: activación por token y recuperación por email. Las contraseñas se guardan
con PBKDF2 (`hashPassword`), no en texto plano, pero el pendiente del proyecto dice bcrypt.

La clave de Edifica **es compartida y viaja adentro de la app**, así que quien la extrae puede
pedir pases de cualquier edificio. Cierra la puerta a internet, no la cierra a alguien decidido. Lo
correcto es que el vecino se autentique y solo pueda pedir pases de **su** unidad. Hasta entonces
es un tapón, no una cerradura.

### 3. `/porteria/api/puerta/abrir` no tiene ninguna autenticación

Abre la puerta con solo el nombre del edificio en el cuerpo. Ni hace falta un QR.

> **Esto es una decisión de Daniel, no un descuido**: es el laboratorio del prototipo del timbre y
> queda abierto a propósito hasta dar de alta el servicio. **No cerrarlo sin preguntarle.** Pero no
> puede quedar prendido cuando el sistema salga a la calle.

### 4. La sesión de prueba entraba a una pantalla vacía (arreglado el 22/09)

Queda anotado porque la forma del error se repite. El botón "Demo Rápido" armaba la sesión a mano
con seis campos; le faltaba `unidades`, y `/vecino` arranca con
`if (!v.unidades || v.unidades.length === 0)`: el que entraba por ahí caía siempre en "Cuenta
Creada — todavía no tenés ningún departamento asignado", con el edificio y el depto escritos dos
centímetros más arriba.

Debajo había algo peor: **el portal no montaba ningún parser de formularios**. `index.js` monta
`bodyParser.json()` y nada más, así que un POST `urlencoded` llegaba con `req.body` vacío y
`const { identificador } = req.body || {}` daba `undefined` sin un solo error en el log. Ahora
`portal-vecino.js` monta los suyos y `pruebas-perfil-vecino.js` levanta el router de verdad y le
pega por HTTP — un chequeo sobre el texto del archivo no habría visto nada, porque el campo estaba:
faltaba quién lo leyera.

## Cómo trabajar

Rama propia y un PR, igual que Antigravity con el panel. Así lo que está a medias no llega nunca al
VPS:

```bash
git pull origin claude/marcos-ia-whatsapp-template-vpg8gw
```

```bash
git checkout -b claude/portal-vecino origin/claude/marcos-ia-whatsapp-template-vpg8gw
```

Antes de cada push, esto tiene que dar verde (corre sin credenciales, no necesita `.env` ni las
bases):

```bash
node verificar-antes-de-subir.js
```

Y el PR va hacia `claude/marcos-ia-whatsapp-template-vpg8gw`.

**Los archivos de arriba son de este chat.** El panel (`dashboard.js`) es de Antigravity; el motor
(`index.js`, `datos*.js`, `sheets.js`, `agentes/`) es del chat principal. Si hace falta un cambio
del otro lado, **se pide, no se hace**: dos agentes editando el mismo archivo el mismo día es cómo
se pierde trabajo.

## Una cosa más, que ya mató el proceso una vez

Un `ReferenceError` en `portal-vecino.js` **tiró abajo a Marcos entero** en mitad de una
conversación con un técnico — el portal corre adentro del mismo proceso que el motor. El contador
de reinicios de PM2 iba en 41.

Ya está puesto el manejador que lo loguea, pero la lección queda: **acá adentro un error suelto no
es solo tuyo.** Está contado en `CLAUDE.md`, en *"Un error suelto mataba a Marcos en mitad de una
conversación"*.

---

## 24/09 — las expensas dejaron de servirse solas (hace falta una ruta del portal)

El panel ya publica **expensas por unidad**: una fila de `expensas` puede tener `departamento`
vacío (liquidación general del edificio, la ven todos) o con valor (de esa unidad y de nadie más),
más `monto`, `vencimiento` y `monto_origen`.

Eso convirtió el PDF en el dato privado de una persona, y estaba en `almacenamiento/expensas/`,
que `index.js` servía entero con `express.static` y sin sesión. **Ya lo cerré**: `/archivos/...` y
`/audios/...` devuelven 403 para cualquier archivo de expensas, por las tres puertas que llegaban
a él (las dos estáticas y el buscador por nombre suelto, que recorre subcarpetas).

> El filtrado por unidad en la pantalla no alcanzaba: protege la vista, no el archivo. Y estas URL
> circulan solas — Marcos comparte la expensa por WhatsApp y el vecino la reenvía.

### Lo que necesita el portal

**Hoy el vecino no puede abrir su expensa**: `/vecino/expensas` lista filas cuya `url` apunta a
`/archivos/expensas/...`, y eso ahora da 403. Hacen falta dos cosas:

**1. Filtrar por unidad en la consulta.** Hoy es solo por edificio:

```js
const qExp = `SELECT * FROM expensas WHERE LOWER(edificio) = LOWER($1) AND estado != 'eliminada' ORDER BY id DESC`;
```

Con expensas por unidad, eso le muestra a cada vecino el monto de todos sus vecinos. Tiene que
traer las del edificio **cuyo `departamento` esté vacío o sea el suyo**, y la unidad sale de
`usuario_unidades` —lo que el vecino tiene asignado—, **nunca de algo que venga en el pedido**. Si
saliera del pedido, cualquiera pide la del vecino escribiendo su número de unidad: es el agujero
que tenía `/api/pases-qr`.

**2. Una ruta propia que sirva el archivo**, porque la pública ya no lo hace:

```js
const { puedeVerExpensa, rutaDelArchivo } = require('./expensa-privada');

router.get('/expensa-archivo/:nombre', async (req, res) => {
    const v = getVecinoSession(req);
    // buscá la fila por su `url` / nombre de archivo
    const { puede, motivo } = puedeVerExpensa({
        expensa,
        quien: {
            rol: 'vecino',
            edificio: v.edificio,
            departamento: v.departamento,
            puede_ver_expensas: v.puede_ver_expensas,
        },
    });
    if (!puede) return res.status(403).send(motivo);

    const ruta = rutaDelArchivo(expensa.url);
    if (!ruta || !fs.existsSync(ruta)) return res.status(404).send('No está el archivo');
    res.sendFile(ruta);
});
```

> **Llamá a `puedeVerExpensa`, no reescribas el criterio.** El panel va a llamar a la misma
> función: el día que cambie una regla tiene que cambiar en un solo lugar. Ya cubre el permiso
> `puede_ver_expensas` del huésped, la liquidación general, y que "1A" y "1° A" son la misma
> unidad.

Prueba: `node pruebas-expensa-privada.js` (39 verificaciones, sin credenciales ni bases).
