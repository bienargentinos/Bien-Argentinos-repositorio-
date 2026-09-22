# Portal del vecino y portería — informe para arrancar

**Para el chat que se ocupe de esta parte.** Leé primero `docs/para-cualquier-agente.md` (siete
reglas cortas) y después esto. `CLAUDE.md` es la memoria larga del proyecto; lo de acá es solo lo
de este rincón, para no tener que leerlo entero.

---

## Qué es cada cosa

| Archivo | Qué hace | Tamaño |
|---|---|---|
| `portal-vecino.js` | El portal web del vecino: reservas de amenities, expensas, reclamos, pases QR, integrantes de la unidad, chat. Montado en `/vecino` y `/portal`. | 6441 líneas, 36 rutas |
| `porteria.js` | El timbre y la apertura de puerta. Quién suena en el teléfono de quién, y quién puede abrirle a alguien parado en la vereda. | 1839 |
| `qr-firmado.js` | Firma y verificación de los pases QR. | 192 |
| `clave-app.js` | La clave que manda la app Edifica cuando no hay sesión del panel. | 93 |

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

Hay `/api/solicitar-pin`, `/api/verificar-pin`, `/api/login-email` y `/api/registro-email`, pero el
pendiente de **auth real** —contraseñas hasheadas con bcrypt, activación por token, recuperación
por email— está sin hacer en todo el proyecto.

La clave de Edifica **es compartida y viaja adentro de la app**, así que quien la extrae puede
pedir pases de cualquier edificio. Cierra la puerta a internet, no la cierra a alguien decidido. Lo
correcto es que el vecino se autentique y solo pueda pedir pases de **su** unidad. Hasta entonces
es un tapón, no una cerradura.

### 3. `/porteria/api/puerta/abrir` no tiene ninguna autenticación

Abre la puerta con solo el nombre del edificio en el cuerpo. Ni hace falta un QR.

> **Esto es una decisión de Daniel, no un descuido**: es el laboratorio del prototipo del timbre y
> queda abierto a propósito hasta dar de alta el servicio. **No cerrarlo sin preguntarle.** Pero no
> puede quedar prendido cuando el sistema salga a la calle.

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
