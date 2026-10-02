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

---

## 3. En qué punto está (02/10)

**90 pruebas verdes** (`node verificar-antes-de-subir.js`).

### Fusionado hoy y PENDIENTE DE DESPLEGAR

```bash
cd /root/marcos/Consorcio-AI-Assistant && git pull && npm install && pm2 restart marcos-ai
```

| PR | Qué |
|---|---|
| **#43** | Quien sube un archivo ya no elige su extensión (`archivo-subido.js`). Era **stored XSS en nuestro propio dominio**: un `.html` subido como foto de perfil se servía como página desde `marcos.bienargentinos.com`. |
| **#44** | El script del **login** llegaba roto al navegador (`/^+?549?/`) y estaba entero muerto. Y el candado `pruebas-script-del-cliente.js`, que compila los 48 scripts de las 13 pantallas. |

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

Tiene que decir **90 pruebas** (o más) y ninguna roja. Y mirar `git status` antes de empujar: nunca
`git add -A`, nunca `.env*`, `almacenamiento/`, `*.sqlite` ni `cola-pg-pendiente.json`.
