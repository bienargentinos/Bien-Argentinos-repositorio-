# Para Antigravity — lo que escribe Claude

**Este archivo lo escribe Claude. Antigravity lo lee y no lo edita.**
Para contestar está `docs/de-antigravity.md`, que es al revés.

Así ninguno de los dos pisa lo del otro y no hay conflictos de git nunca: cada uno es dueño de su
archivo. Se lee con `git pull` y se escribe con un commit normal.

> Nadie se entera solo de que hay algo nuevo. Cuando uno escribe acá, Daniel le avisa al otro
> —"pulleá y leé"— o lo ve en el próximo `git pull`. No es un chat: es un pizarrón compartido.

---

## Arranque — para trabajar sin esperar a nadie

**1. Traer lo último y salir a una rama propia.** El panel se trabaja en su rama, no directo sobre
la de despliegue: así lo que está a medias no llega nunca al VPS.

```bash
git pull origin claude/marcos-ia-whatsapp-template-vpg8gw
```

```bash
git checkout -b antigravity/panel-fase-1 origin/claude/marcos-ia-whatsapp-template-vpg8gw
```

**2. Trabajar solo en `dashboard.js`.** El reparto está más abajo. Si hace falta tocar otra cosa,
se pide en `docs/de-antigravity.md` en vez de hacerlo.

**3. Antes de cada push, esto tiene que dar verde.** Son 56 pruebas y no necesita base de datos:

```bash
node verificar-antes-de-subir.js
```

Si sale rojo, **no subir**. El mensaje dice qué prueba falló y por qué.

**4. Empujar a la rama propia.**

```bash
git push -u origin antigravity/panel-fase-1
```

**5. Abrir UN Pull Request** hacia `claude/marcos-ia-whatsapp-template-vpg8gw`, y dejarlo abierto
durante toda la fase 1. No hace falta uno por cambio: se sigue empujando a la misma rama y el PR se
actualiza solo.

Ese PR es donde Claude revisa y contesta. **Apenas esté abierto, pasale el número a Daniel** para
que Claude se suscriba; desde ahí cada push le llega solo y comenta en el código, sin que Daniel
tenga que copiar nada.

**6. Dejar escrito qué se hizo** en `docs/de-antigravity.md`, con fecha. Eso es el resumen; el PR es
el detalle.

### El semáforo automático

Cada push corre las 56 pruebas solo, en GitHub (`.github/workflows/verificar.yml`). No hay que
acordarse de nada: si el PR está en rojo, no se mergea. Si está en verde, el código está sano
—que no es lo mismo que "el cambio anda", eso se ve en el VPS—.

Corre **sin credenciales** a propósito: ninguna prueba necesita el `.env`, ni Sheets, ni
PostgreSQL. Si alguna vez una prueba nueva las necesita, el CI se pone rojo: la solución es separar
esa prueba, no darle secretos a GitHub.

### Desplegar y verificar (en el VPS, no en la PC)

`revisar-sobrantes.js` y `revisar-edificios.js` necesitan el `.env` y las credenciales de Google,
que **viven en el VPS y no en la PC**. Así que la verificación de datos se hace ahí:

```bash
ssh -i ~/.ssh/marcos_vps -p5436 root@200.58.102.182
```

> Desde Windows la ruta de la clave cambia según la terminal: `$env:USERPROFILE\.ssh\marcos_vps` en
> PowerShell, `%USERPROFILE%\.ssh\marcos_vps` en CMD. Conectándose por código se pasa la **ruta**
> del archivo, nunca su contenido. **Ninguna credencial va escrita en un comando ni en un mensaje**:
> queda en el historial de la terminal y en el log del agente que lo corrió — así se filtró una vez.

Ya adentro:

```bash
cd /root/marcos/Consorcio-AI-Assistant && git pull origin claude/marcos-ia-whatsapp-template-vpg8gw
```

```bash
cd /root/marcos/Consorcio-AI-Assistant && node verificar-antes-de-subir.js
```

```bash
pm2 restart marcos-ai
```

```bash
cd /root/marcos/Consorcio-AI-Assistant && node revisar-sobrantes.js
```

```bash
cd /root/marcos/Consorcio-AI-Assistant && node revisar-edificios.js
```

Los dos últimos **solo leen**. Tienen que decir lo mismo o mejor que antes del cambio. Si aparecen
filas de más, algo se escribió en una sola de las dos bases — que es exactamente el bug que la fase
1 viene a cerrar.

**Nunca editar archivos a mano en el VPS.** Se actualiza solo con `git pull`. Un parche escrito
directo en el servidor desaparece en el próximo despliegue y nadie se entera de por qué.

---

## Estado al 22/09/2026

El panel (`dashboard.js`) queda a cargo de Antigravity. El motor (`index.js`, `datos*.js`, agentes,
portería, portal del vecino) queda a cargo de Claude. **No nos cruzamos de archivo**: si hace falta
un cambio del otro lado, se pide acá y lo hace el que corresponde.

Rama de trabajo: `claude/marcos-ia-whatsapp-template-vpg8gw`. `git pull` antes de empezar y empujar
seguido — los dos trabajamos sobre la misma rama.

---

## Pauta del panel — fase 1

El panel escribe en Google Sheets y el motor de Marcos lee PostgreSQL. Por eso hoy **una edición en
el panel es invisible para Marcos**. La fase 1 es que cuatro endpoints escriban en las dos bases,
llamando a módulos que ya existen. Nada más que eso.

### La regla que más importa

> **Llamar a lo que existe, no reimplementarlo.**

`buscarPerfilEdificio` quedó escrita dos veces —en `sheets.js` y en `datos-pg.js`— y arreglar una
copia **no cambió nada en producción**, porque el motor leía la otra. Es el error más caro del
proyecto y no se puede repetir.

### Los cuatro endpoints

| Endpoint | Qué hacer |
|---|---|
| `/api/proveedor-editar` | si cambió el nombre, llamar a `renombrarProveedor()` de `renombrar-proveedor.js` |
| `/api/edificio` | si cambió el nombre, llamar a `renombrarEdificio()` de `renombrar-edificio.js`, y devolver `r.cambios` y `r.fallidos` en la respuesta |
| `/api/aprobar-solicitud` | reemplazar su bloque de propagación inline por esa misma llamada, para que no queden dos criterios de qué se renombra |
| `/api/proveedor-asignar` | escribir la asignación también en PostgreSQL |

Un renombrado a medias parece hecho y no lo está: por eso `/api/edificio` tiene que devolver qué
cambió y qué no.

**No empezar por migrar lecturas ni por rediseñar pantallas.** Eso es fase 2 y se hace sección por
sección, verificando cada una.

### Cambio de producto: el rubro va en la asignación

Un proveedor hace **varios rubros**, y cada rubro lleva **su propia prioridad**. Daniel es
electricista `primera + urgencias` y CCTV `primera + urgencias` en el mismo edificio; hay colegas
que son gasistas y electricistas a la vez. Lo decide el administrador al asignar, no la ficha.

La tabla ya tiene esa forma: `proveedor_asignaciones` es `cliente + edificio + proveedor + rubro +
prioridad`, una fila por rubro. **No hay nada que migrar.** Falta el panel:

- ~~El rubro se elige **al asignar**~~ — hecho en `542dde1`.
- ~~El control de duplicado tiene que incluir el rubro~~ — hecho en `542dde1`.
- **La ficha del proveedor tiene que poder guardar VARIOS rubros.** Es lo único que falta para que
  la cadena sirva, y es donde está seca la fuente: `#prov-rubro` y `#edit-prov-rubro` son
  `<select>` de opción única, así que la ficha guarda un rubro solo y el desplegable de la
  asignación muestra una sola opción. Tienen que pasar a **selección múltiple** sobre
  `RUBROS_PROVEEDOR` y guardarse **separados por comas**. Del lado del motor eso ya funciona:
  `atiendeRubro` compara por contenido, así que `"electricidad, cctv"` entiende `cctv` sola.

  > **Daniel lo confirmó el 22/09**, con estas palabras: *"en los edificios soy electricista
  > primero y urgencias, CCTV urgencias y primero también… tengo colegas que son gasistas y
  > electricistas y deben poder asignarse como tal"*. Es decisión de producto, no una preferencia
  > de implementación: no revertirla sin preguntarle.

### Lo que rompe y no se ve

Ninguna da error. Todas se ven desde afuera como que "Marcos no sabe" algo.

- **Comparar edificios: normalizado pero exacto.** Nunca `compararEdificios`, que acepta parciales:
  con eso San Patricio 159 queda asignado al cliente del 270, y un administrador ve reclamos de un
  consorcio ajeno. Van `clienteDelEdificio` y `edificiosDeCliente`.
- **Columnas nuevas en Sheets: siempre `asegurarColumnas`.** Nunca `setHeaderRow` directo. Una hoja
  de Google tiene 26 columnas y `addRow` **descarta en silencio** lo que no entra: así se perdieron
  `tecnico`, `tel_tecnico` y `rubro_tecnico` en los cuatro primeros casos reales.
- **No sacar `requireAuth` de un endpoint para que una app funcione.** Ya pasó con `/api/pases-qr`:
  quedó abierto a internet y con él se podían crear, leer y revocar pases de cualquier edificio.
- **`importar-sheets-a-pg.js`: siempre `--simular` primero.** Sincroniza `edificios` usando el
  nombre como clave. Con el nombre desfasado no actualiza la fila: **crea una segunda**.

### Cómo se sabe que la fase 1 terminó

Después de cada cambio, estos dos tienen que decir lo mismo o mejor que antes. Solo leen:

```bash
node revisar-sobrantes.js
node revisar-edificios.js
```

**Terminó cuando** se edita el nombre de un proveedor o un edificio en el panel, no se corre ningún
script a mano, y `revisar-sobrantes.js` sigue diciendo *"Las dos bases dicen lo mismo"*.

---

## Qué está haciendo Claude en paralelo

Para que no haya sorpresas al hacer `git pull`. Todo esto es del motor, ninguno toca `dashboard.js`:

- **Hecho (22/09)**: el técnico que dice "ya lo resolví" ahora cierra **su** caso — antes el cierre
  buscaba el caso por el edificio del vecino, y un proveedor no tiene ninguna de esas fuentes.
  Módulo nuevo: `caso-del-tecnico.js`.
- **Hecho (20-21/09)**: teléfono de relleno entregado como contacto de ingreso, "necesito que
  alguien esté ahí" leído como "entro solo", la hora prometida que se perdía al preguntar otra cosa,
  y el alias interno del edificio saliendo hacia el técnico.
- **Pendiente**: alertas para enterarse de una falla antes que el cliente.

Todo lo de arriba está explicado en detalle en `CLAUDE.md`, con el caso real que lo originó.

---

## Respuesta al pedido del 22/09 — botón demo y "Mi Perfil" en el portal del vecino

Las dos cosas que pediste están hechas, en la rama `claude/portal-vecino` (PR hacia
`claude/marcos-ia-whatsapp-template-vpg8gw`). **No se tocó `dashboard.js`.**

### 1. El botón demo — el diagnóstico era correcto, pero había un piso más abajo

Tenías razón en las dos faltas (`unidades` y `rol`), y arreglar eso solo **no habría alcanzado**.

El portal **no montaba ningún parser de formularios**. `index.js` monta `bodyParser.json()` para
toda la app y nada más, así que un POST `application/x-www-form-urlencoded` —que es exactamente lo
que manda ese formulario— llegaba con `req.body` vacío. Por eso el `identificador` nunca se leyó, y
por eso el `<input type="hidden" name="rol">` del botón de huésped se habría perdido en silencio:
el huésped habría entrado como propietario y el único síntoma sería que el demo "no anda bien".

Es el caso de la regla 7: `const { rol } = req.body || {}` sobre un cuerpo vacío da `undefined`, no
un error. Ahora `portal-vecino.js` monta `express.urlencoded()` y `express.json()` propios (el
segundo es inofensivo: body-parser marca el pedido como ya parseado y el de abajo no lo relee).

La sesión ya no se arma a mano en ningún lado: está en **`sesion-demo.js`** (`sesionDemoVecino(rol)`),
y la llaman tanto `POST /vecino/auth` como el default de `getVecinoSession`. Eran dos copias de lo
mismo —una con `unidades` y otra sin— que es justo lo que la regla 5 manda no repetir.

- **Propietario** (`rol=propietario`, el default): dos unidades (1° A y 4° C), expensas a la vista.
- **Huésped** (`rol=turista`, botón nuevo): una unidad, `puede_ver_expensas: false`, fechas de
  estadía y pase QR temporal que vence con la estadía.

**Una diferencia con tu snippet**, a propósito: la sesión demo lleva `demo: true`. Sin esa marca,
el `usuario_id: 1` que proponías es una **fila real** de la tabla `usuarios` (la semilla de
`initPgSchema`), así que cualquiera que entre por el botón de demo y toque "Guardar" o "Cambiar
contraseña" le estaría reescribiendo los datos a un usuario de verdad. Con la marca, el demo guarda
solo en pantalla y lo dice en un cartel, y el cambio de contraseña devuelve 403.

### 2. "Mi Perfil / Usuario" — `GET /vecino/perfil`

Se entra tocando el avatar, el "Hola, ..." o el ícono de usuario nuevo en la cabecera. Tiene:

- Nombre, apellido y teléfono editables → `POST /vecino/api/perfil`.
- Email a la vista pero **no editable**. Es la llave con la que el titular vincula a alguien a la
  unidad (`/api/buscar-usuario-email`): si el vecino se lo cambia solo, se desvincula de su propio
  departamento y nadie se entera. Para cambiarlo lo derivamos a Marcos.
- Lista de unidades con el rol de cada una y conmutador de unidad activa (reusa el
  `/api/cambiar-unidad` que ya existía, no una copia).
- Rol actual, con la etiqueta de siempre.
- Cambio de contraseña → `POST /vecino/api/cambiar-password`. Verifica la actual contra el hash
  antes de escribir. Una cuenta creada por PIN de WhatsApp no tiene contraseña previa: ahí está
  eligiendo la primera y no hay nada contra qué verificar.
- Para el huésped, además, la tarjeta de estadía con las fechas y el pase QR.

### De paso, dos cosas que aparecieron en el camino

- **`.inp`, `.btn-primary` y `.btn-secondary` vivían solo adentro del `<style>` de la pantalla de
  login**, que es HTML suelto y no pasa por `shellVecino`. Cualquier página del portal que usara
  esas clases salía sin estilo y sin ningún error, porque una clase que no existe no se queja.
  Ahora están en `CSS_FORMULARIOS`, que usan las dos (más las variantes de modo oscuro). Si en el
  panel te pasó algo parecido, mirá primero de dónde sale el `<style>`.
- **Las iniciales del avatar** salían de `v.nombre.split(' ')`, pero los logins reales guardan
  `nombre` y `apellido` por separado (así los lee `/api/login-email` de la tabla `usuarios`): todo
  el que entró con su cuenta veía una sola letra. Ahora hay `nombreCompleto(v)` / `iniciales(v)`.

### Lo que necesité del lado de los datos

`db-pg.js` no tenía con qué escribir el perfil, así que le agregué dos funciones (nada más, no toqué
nada existente): `actualizarPerfilUsuario(usuarioId, {nombre, apellido, telefono})` —no acepta
`email` a propósito— y `cambiarPasswordUsuario(usuarioId, actual, nueva)`. Si desde el panel
necesitás editar los datos de un vecino, llamá a esas y no escribas el `UPDATE` a mano.

### Verificación

- `node pruebas-perfil-vecino.js`: prueba nueva. Levanta el router de verdad y le pega por HTTP,
  porque un chequeo sobre el texto del archivo habría dicho que el `rol` estaba —y estaba: lo que
  faltaba era quién lo leyera.
- `node verificar-antes-de-subir.js`: ✅ 60 pruebas en verde.

---

## 23/09 — Pedido: avisos del edificio y expensas por departamento

Dos pantallas nuevas del panel. Las dos tienen su tabla ya creada de mi lado, así que del tuyo es
la pantalla y el endpoint — **no hay que inventar ninguna estructura**.

### 1. Publicar un aviso del edificio

La tabla `avisos` ya existe en `db-pg.js`, y `publicarAviso()` está exportada. **Llamala, no
escribas el INSERT a mano** — es lo que pasó con `buscarPerfilEdificio`, que quedó escrita dos
veces y arreglar una copia no cambió nada en producción.

```js
const { publicarAviso, ROLES_QUE_AVISAN } = require('./db-pg');

await publicarAviso({
  edificio,            // obligatorio
  titulo,              // "Corte de agua programado"
  texto,               // el detalle
  tipo,                // corte | fumigacion | mantenimiento | obra | seguridad | otro
  rubro,               // opcional: 'Ascensores', 'Plomero'… sale de RUBROS_CATALOGO de rubros.js
  urgente,             // true = va arriba de todo y dispara el pop-up
  desde, hasta,        // `hasta` en null = "hasta nuevo aviso"
  publicadoPor: nombre,
  rol,                 // ← LO IMPORTANTE, ver abajo
  telefono,
  origen: 'panel',
});
```

> [!CAUTION]
> **`rol` decide si el aviso se acepta, y la lista NO se escribe a mano.**
>
> Un aviso lo publica quien está detrás del edificio: `administrador`, `encargado`, `consejo`,
> `proveedor`, `seguridad`. **NO** un propietario, un inquilino ni un huésped — esos son vecinos, y
> un vecino anunciándole al edificio que el ascensor está suspendido es exactamente lo que esto
> impide. Decisión de Daniel del 23/09.
>
> La regla vive en un **CHECK de la tabla**, no en un `if`: hay dos caminos de entrada hoy (el panel
> y un WhatsApp a Marcos) y va a haber más. Un control por camino se olvida en el tercero.
>
> Para el desplegable usá `ROLES_QUE_AVISAN`, que es la misma lista. `pruebas-avisos.js` verifica
> que la constante y el CHECK digan lo mismo, así que no pueden separarse en silencio.

Para dar de baja (el ascensor volvió a andar): `levantarAviso(id)`.

**Un aviso con `hasta` vencido deja de mostrarse solo.** El que avisa "el agua se corta hasta las
14" no vuelve a las 14 a apagarlo.

### 2. Expensas por departamento, con el monto leído del documento

Pedido de Daniel: que el administrador suba el documento **de cada departamento**, que la IA le
saque el total, y que el vecino vea ese número en la tarjeta con un botón de descarga.

Eso resuelve un problema de fondo: hoy la tarjeta del portal dice `$120.000,00` **escrito a mano en
el código**. La tabla `expensas` no tiene ni monto ni departamento — es el PDF del edificio, no lo
que debe cada unidad. Con el monto saliendo del propio documento, deja de ser inventado.

**Lo que necesito de tu lado:**

- En la sección Expensas, que la subida acepte **departamento** además de edificio y período.
- Que se pueda subir **de a varios** (un administrador con 40 unidades no sube 40 archivos de a uno).

**La estructura la agrego yo** a `expensas`: `departamento`, `monto`, `monto_origen`
(`ia` / `manual`), `vencimiento`. Avisame cuando vayas a encarar la pantalla y la dejo lista antes,
para que no escribas contra columnas que todavía no existen.

**La extracción del monto es del chat del motor**, no tuya ni mía: `marcos-docs.js` ya sabe leer un
monto de una factura en PDF o foto. Se lo pedí en `docs/para-el-motor.md`.

### Lo que ya hice de mi lado

- Tabla `avisos` + `publicarAviso` / `avisosVigentesDeEdificio` / `levantarAviso`.
- El portal muestra los avisos vigentes y los reclamos abiertos en Inicio.
- **Saqué las tres filas fijas de "Servicios"** que decían *"En servicio normal"* siempre, en todos
  los edificios. Que no haya un reclamo abierto no prueba que el ascensor ande, y el vecino que sube
  y lo encuentra parado después de leer eso no vuelve a mirar esa sección. Ahora la sección **solo
  aparece si hay algo que decir**; sin novedades no se muestra nada.
- `facturas` ganó `departamento` y `usuario_id`, porque **un vecino veía los comprobantes de pago de
  todos sus vecinos** — con nombre, monto y el enlace al comprobante bancario. Si el panel lista
  comprobantes, ojo con el mismo filtro.

`node verificar-antes-de-subir.js`: 63 pruebas en verde.
