# Cómo retomar el PORTAL DEL VECINO en un chat nuevo

> Este archivo es del **chat del portal** (`portal-vecino.js`, `porteria.js`, `qr-firmado.js`,
> `clave-app.js`, `sesion-demo.js`, `archivo-subido.js`, `autor-del-pase.js`, `qr-imagen.js`).
> El del motor es `retomar-en-chat-nuevo.md` y el de Antigravity `retomar-antigravity.md`.
>
> **Se sobreescribe al terminar una tanda de trabajo. No se le agrega al final.**

Última actualización: **02/10/2026**.

---

## 1. La frase para pegar en el chat nuevo

> Sos el chat del portal del vecino y la portería del proyecto Bien Argentinos. Leé `CLAUDE.md`
> entero, después `docs/retomar-portal.md`, y después **tu buzón, `docs/para-el-portal.md`**, que es
> donde los otros dos agentes te dejan diagnósticos. Trabajá en la rama `claude/portal-vecino` y
> fusioná a `claude/marcos-ia-whatsapp-template-vpg8gw` por PR.

> [!CAUTION]
> **Leé tu buzón ANTES de ponerte a diagnosticar.** El 02/10 revisé todo el repo y me salté
> `docs/para-el-portal.md` — el único archivo dirigido a mí. Adentro estaba la causa de un problema
> que yo había perseguido con dos hipótesis equivocadas, y la respuesta a una pregunta que le hice a
> Daniel al aire ("¿el VPS tiene esto?" — decía "desplegado y verificado").

---

## 2. Lo que no se negocia

Está entero en `CLAUDE.md`; esto es el recordatorio corto.

- **GitHub es la única fuente de verdad.** El VPS se actualiza con `git pull` y `pm2 restart marcos-ai`.
  Nunca editar código en el servidor.
- **Una dependencia npm nueva va en `package.json` y `package-lock.json` en el MISMO commit.**
- **Ninguna credencial en un archivo, un comando o un mensaje.**
- **Los vecinos no saben que Marcos es IA.**
- **No se proponen borrados sueltos de datos**: todo lo cargado es ficticio y la limpieza es el
  borrado total, cuando Daniel lo pida.
- **Cada mejora terminada deja su documento comercial** en `docs/comercial/`, sin humo.
- `POST /porteria/api/puerta/abrir` **no tiene autenticación a propósito** (el laboratorio del timbre
  de Daniel). No cerrarlo sin preguntarle.
- **`git pull` antes de editar, y empujar apenas termina una cosa.** El 02/10 hubo **dos sesiones del
  portal** sobre `claude/portal-vecino` el mismo día. No es un pisotón: la sesión con la que Daniel
  está hablando es la que toca el archivo. Pero el que no pullea pierde trabajo, y **puede haber un PR
  abierto que no es tuyo** — mirá `git log origin/claude/portal-vecino` y la lista de PR antes de
  arrancar.

---

## 3. En qué punto está (02/10)

**91 pruebas verdes** (`node verificar-antes-de-subir.js`).

### Desplegado el 02/10 — confirmado por Daniel

Express en el 3000, PostgreSQL con pgvector y SMTP respondiendo. Lo que entró:

| PR | Qué |
|---|---|
| **#43** | Quien sube un archivo ya no elige su extensión (`archivo-subido.js`). Era **stored XSS en nuestro propio dominio**: un `.html` subido como foto de perfil se servía como página desde `marcos.bienargentinos.com`. |
| **#44** | El script del **login** llegaba roto al navegador (`/^+?549?/`) y estaba entero muerto. Y el candado `pruebas-script-del-cliente.js`, que compila los 48 scripts de las 13 pantallas. |
| **#45** | Documentación: este archivo, y dos caveats que Antigravity ya había resuelto. |

### Fusionado DESPUÉS de ese despliegue — falta desplegar

```bash
cd /root/marcos/Consorcio-AI-Assistant && git pull && npm install && node verificar-antes-de-subir.js && pm2 restart marcos-ai
```

| PR | Qué |
|---|---|
| **#46** | El rótulo del timbre no llegaba al tótem: `actualizarConfigTimbre` filtraba `vecinos` por una columna `unidad` que no existe, PostgreSQL rechazaba el `UPDATE` entero y el `catch` mudo se lo tragaba. Probado contra PostgreSQL real (`pruebas-rotulo-timbre.js`). |

> **Lo escribió OTRA sesión del portal**, en paralelo a esta, el 02/10 a las 02:46 (sesión
> `01VGVenZ…`, sobre la misma rama `claude/portal-vecino`). Lo revisé, corrí las **91 pruebas** y lo
> fusioné. **No es un pisotón: es la regla funcionando** --Daniel estaba hablando con esa sesión--. Lo
> anoto porque al ver un commit ajeno en la rama propia la pregunta no es "quién se metió" sino "¿con
> quién estaba hablando Daniel?".
>
> Queda abierta **su** decisión pendiente: el rótulo se guarda **por unidad**, así que si el inquilino
> lo cambia, se lo cambia también al propietario.
>
> Y queda sin correr en el VPS lo que esa sesión pidió en `docs/para-antigravity.md`:
> `node revisar-columnas-pg.js vecinos`, para confirmar que la base real tampoco tiene `unidad`. El
> arreglo no depende de eso --funciona igual-- pero sin esa lectura no se sabe si el defecto era el
> que se creía.

### Ya desplegado y andando (de antes)

- QR dibujado por nosotros (`qr-imagen.js`), sin pedirle nada a terceros. También en el panel.
- Autoría de cada ingreso (`autor-del-pase.js`) + columnas en `eventos_acceso`. **Y Antigravity hizo
  la pantalla del panel**: la columna "Autorizado por" en la auditoría, con la etiqueta `[PRUEBA]`.
- Pases QR con vencimiento elegido por el vecino, techo de 365 días.
- Cuenta bancaria del consorcio: la lee el portal y **Antigravity hizo la pantalla de carga** en
  Mi Edificio, validando CBU y alias con `cbu.js`.
- Sesiones en PostgreSQL (`sesiones_panel` / `sesiones_portal`), sin la colisión de `session_pkey`.
- Portal en cuatro idiomas.

---

## 4. Lo que espera una decisión de Daniel

1. **`antigravity/panel-fase-1` NO está fusionada.** Tres commits del 29/09 (cabecera en dos filas,
   avatar que navega a Inicio, traducción de avisos del consorcio). Probada: **88 verdes y se fusiona
   sin conflicto.** Es la rama de Antigravity — **no fusionarla sin que Daniel lo diga**, porque puede
   estar a medias a propósito.

2. **El timeout de 2,5 s que traduce los avisos con Gemini.** Daniel ofreció subirlo a 4,5 s porque la
   API tarda ~3 s desde el VPS. **Lo revisé y la respuesta es no**, con el análisis entero en
   `docs/para-antigravity.md` (02/10). En corto, tres cosas que no se ven en esa línea:
   - Ese código vive **solo en `antigravity/panel-fase-1`**, que no está fusionada: hoy **no corre en
     producción**, así que subirlo no cambia nada.
   - El `await` está **adentro del render de Novedades y es secuencial**, así que el techo se
     multiplica por la cantidad de avisos: con tres y la caché fría son **13,5 s de pantalla en
     blanco**. Subirlo empeora el caso malo para mejorar el caso bueno.
   - La caché es un `Map` del proceso, o sea que **cada `pm2 restart` la vacía**: el caso frío es el
     normal, no la excepción.

   Lo que corresponde es **traducir cuando se GUARDA el aviso** y guardar la traducción: el
   administrador lo escribe una vez y lo leen todos los vecinos muchas veces. Ahí Gemini puede tardar
   diez segundos sin molestar a nadie y **no queda ningún timeout que calibrar**. El guardado es del
   panel, por eso el pedido fue para allá.

---

## 5. Pendientes, en orden

1. **Las TRES subidas de `dashboard.js`** (`~39` media, `~58` avatar del panel, `~78` expensas) siguen
   tomando la extensión del nombre que manda el navegador. Dos de las tres se sirven, **así que el
   agujero de #43 sigue abierto por ahí.** Es lo más urgente. Pedido en `docs/para-antigravity.md`
   con el código exacto: **llamar a `archivo-subido.js`, no reimplementarlo.**
2. **Candado gemelo del script del cliente para el panel.** `dashboard.js` genera su HTML igual, así
   que el síntoma sería idéntico e invisible. Ofrecido a Antigravity; si prefiere llamarlo, sacar el
   mecanismo a un módulo compartido en vez de duplicarlo.
3. **Con PostgreSQL caído, un pase QR se valida por firma y no queda registro de nada.** El arreglo es
   encolar el `INSERT` como hace `cola-pg.js` (un registro de auditoría es append-only, no tiene el
   riesgo de orden de ese módulo).
4. **Lo visual que Daniel aprobó y no se hizo**: botones con contorno y reacción al apretar, y el
   resplandor del fondo, en su azul.
5. **Traducir la conversación del chat.** La app está en cuatro idiomas; el chat no.
6. **El timbre vive en RAM** (`_timbresActivos`). **El arreglo NO es mover el Map a PostgreSQL** —
   `/api/timbre-check` lo sondea cada celular cada pocos segundos. Es dejar de sondear (SSE) o usar la
   RAM como caché. Es su propio trabajo.
7. **Auth real del vecino** (contraseña propia, activación por token). Mientras no exista, la clave de
   `EdificaApp` es un tapón y no una cerradura, y la identidad del que emite un pase es la sesión.
8. **El respaldo de la traducción de avisos sale del navegador del vecino hacia
   `translate.googleapis.com`.** Es el mismo patrón que ya se sacó con `api.qrserver.com`: contenido
   nuestro y la IP de cada vecino yendo a otra empresa. Acá es un aviso del consorcio y no el token de
   la puerta, **así que es mucho menos grave** — pero desaparece solo si la traducción se guarda en la
   base. Y es un endpoint **no documentado** (`client=gtx`), que puede cortar cualquier día sin dejar
   una línea de log nuestra. **Está en `antigravity/panel-fase-1`, sin fusionar: no lo toques sin que
   Daniel decida sobre esa rama.**

---

## 6. Errores míos que el chat nuevo no tiene que repetir

> [!CAUTION]
> **Los tres son la misma cosa: deducir en vez de mirar el resultado.**

1. **La pantalla de pases colgada.** Dije que faltaba la tabla `pases_qr`, después que era el servicio
   externo del QR. **Las dos mal.** Era mi JavaScript llegando roto al navegador, y se veía abriendo
   la consola. Lo encontró Antigravity. Hoy lo cubre `pruebas-script-del-cliente.js`.
2. **"lalala".** Afirmé que Marcos lo eligió por ser una fila que quedó en PostgreSQL y no en la
   planilla. **Falso**: `revisar-sobrantes.js` dice que las dos bases coinciden. Tomé una línea vieja
   de `CLAUDE.md` como hecho del presente. **En un repo que se mueve así, un dato de hace días es una
   hipótesis, no una medición.**
3. **Leí a Antigravity editando `portal-vecino.js` como un pisotón.** Era decisión de Daniel porque yo
   no estaba disponible. La regla ya decía que el archivo es de quien está hablando con él.

Y uno de método que sí funcionó y conviene repetir: **las pruebas que corren contra un PostgreSQL de
verdad encontraron tres bugs que los candados de texto decían que no existían.** Hay uno local en
`/tmp/claude-0/pgtest` (puerto 5599); se usa con
`DATABASE_URL_PRUEBAS=postgres://postgres@127.0.0.1:5599/postgres`.

---

## 7. Antes de cada push

```bash
node verificar-antes-de-subir.js
```

Tiene que decir **91 pruebas** (o más) y ninguna roja. Y mirar `git status` antes de empujar: nunca
`git add -A`, nunca `.env*`, `almacenamiento/`, `*.sqlite` ni `cola-pg-pendiente.json`.
