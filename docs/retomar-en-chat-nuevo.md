# Cómo retomar el motor de Marcos en un chat nuevo

> **Para qué es este archivo.** Una conversación larga se vuelve caras y lenta: en cada mensaje se
> vuelve a mandar todo lo hablado antes. Abrir un chat nuevo es lo correcto — lo que no se puede
> perder es el estado. Esto es el estado, y se actualiza cuando termina una tanda de trabajo.
>
> **No es un buzón.** Acá no se dejan pedidos: se sobreescribe con lo de hoy. Los pedidos van a
> `docs/para-antigravity.md`, `docs/para-el-motor.md` y `docs/para-el-portal.md`.

---

## 1. La frase para pegar en el chat nuevo

```
Sos el chat del motor de Marcos IA. Leé CLAUDE.md completo y después
docs/retomar-en-chat-nuevo.md, y seguí desde ahí.
```

Nada más. `CLAUDE.md` tiene **el porqué** de cada arreglo y las reglas que no se negocian; este
archivo tiene solo **en qué punto quedamos**. Un resumen pegado a mano siempre sale peor, porque
deja afuera justo lo que no se estaba mirando ese día.

---

## 2. Lo que no se negocia (está entero en `CLAUDE.md`, esto es el recordatorio)

| | |
|---|---|
| **Credenciales** | Ninguna en un archivo, ni en un comando, ni en un mensaje. Así se filtró la de root. La clave SSH privada nunca se comparte: se comparte la `.pub`. |
| **Despliegue** | GitHub es la única fuente de verdad. El VPS se actualiza **solo** con `git pull` + `pm2 restart marcos-ai`. Prohibido editar archivos a mano en el servidor. |
| **Borrado** | Nunca vaciar `CLIENTES`, `EDIFICIOS`, `proveedores` ni `proveedor_asignaciones`. El borrado total, solo si Daniel lo pide explícitamente. |
| **Los vecinos** | No deben saber que Marcos es IA. |
| **Comandos** | Uno por bloque de código, separados, porque Daniel los copia y pega. |
| **`/porteria/api/puerta/abrir`** | Sin autenticación **a propósito** (laboratorio del timbre). No cerrarlo sin preguntarle. |
| **Cada mejora terminada** | Deja su `.md` en `docs/comercial/`, con la sección *"Lo que todavía no hace"*. Es una directiva, no una sugerencia. |

---

## 3. En qué punto está el código (02/10)

**Desplegado en el VPS:** todo lo del motor hasta el 28/09, con 88 pruebas en verde (Daniel pegó la
salida del despliegue). Adentro van los tres pendientes viejos (`caso-del-telefono.js`,
`smtp-config.js`, `cola-pg.js`) y los arreglos de las dos vueltas de la prueba de cerrajería.

**Del 28/09 al 01/10 el motor no tuvo cambios.** Esta sesión se quedó sin límite y Daniel siguió con
Antigravity (decisión suya). Revisado el 02/10: Antigravity tocó **solo panel y portal**
(PWA del panel, cuentas bancarias y autoría de ingresos en el panel, rediseño del inicio del portal,
foto de perfil, rótulo del timbre, i18n) y `db-pg.js` (columnas `avatar_url` y `nombre_timbre`).
Ningún archivo del motor.

Dos defectos encontrados en eso, **los dos del portal y anotados en `docs/para-el-portal.md`
(entrada del 02/10)** — Daniel decidió que los arregle el chat del portal, no este:

1. El rótulo del timbre se copia a `vecinos` con una columna `unidad` que esa tabla no tiene →
   probablemente falla mudo y la portería no lo muestra.
2. La subida de foto de perfil acepta cualquier archivo, sin sesión, en una carpeta pública del
   mismo dominio que `/admin` (XSS almacenado posible).

Además: Antigravity tiene **3 commits del portal en `antigravity/panel-fase-1` sin pasar** a la rama
compartida.

**No se sabe todavía** si Daniel repitió la prueba de cerrajería con lo desplegado, ni cómo salió.
Lo primero en el chat nuevo es preguntarle eso.

**Pendiente #0, pedido por Daniel:** que Marcos PREGUNTE *"¿es lo mismo que el reclamo del 12/9 o
es algo nuevo?"* cuando un reclamo se parece a un caso abierto de otro día, y según la respuesta siga
el caso viejo (con su técnico) o abra uno nuevo. Hoy hay solo el piso seguro: un problema nuevo
nunca entra en un caso de más de un día. Detalle en `CLAUDE.md`, "Un caso viejo sin rubro se
tragaba un reclamo nuevo".

> **No sugerir borrar "lalala" ni ningún otro dato.** Todo lo cargado es ficticio; la limpieza es
> el borrado total, cuando Daniel lo pida.

---

## 5. Pendientes, en orden

1. ~~**`guardarReporte`, el `|| !eBuscado`.**~~ **Hecho y desplegado.** Sin edificio, ahora solo engancha si todos los casos abiertos de ese
   teléfono son de un mismo edificio; si hay dos, no elige y lo dice con `🧨` en el log
   (`caso-del-telefono.js`, `pruebas-caso-del-telefono.js`).
2. **`SMTP_HOST` y la baja del hosting de mail: la parte del código está hecha (28/09), falta la del
   `.env`.** `smtp-config.js` arma la conexión (el puerto decide TLS directo o STARTTLS, la
   verificación del certificado queda apagada solo para el host viejo, `SMTP_FROM` opcional), Marcos
   prueba el mail al arrancar (`📧✅` / `🚨📧` en el log) y `node revisar-smtp.js` lo prueba a pedido.
   **Falta que Daniel elija el proveedor nuevo** y que se cambie `SMTP_*` en el `.env` del VPS el
   mismo día de la baja, corriendo `node revisar-smtp.js --enviar <su mail>` después. De paso: el
   mail primario sale de la columna `email` de `CLIENTES` --hay que mirar que esté cargada--.
3. ~~**Que una copia a PostgreSQL que falla no se pierda.**~~ **Hecho y desplegado** (`cola-pg.js`). Las
   copias son datos y no funciones; la que falla por conexión se reintenta sola, en orden, y
   sobrevive a un reinicio en `cola-pg-pendiente.json`. Probado contra un PostgreSQL de verdad.
4. **Unificar la comparación de rubros con `atiendeRubro`** (lo que quedó afuera de `9585cc6`). **En espera: Daniel dijo "espero".**
5. **El comodín del edificio vacío** en `proveedor_asignaciones`: decidir si se saca, mirando antes
   qué edificios dependen hoy de esa vía.
6. **Documentos comerciales que faltan**: CBU con verificación, reservas de amenities, la ventana de
   24hs, el seguimiento automático, y el de `9585cc6` (a qué técnico se le manda el trabajo).
7. **Un proveedor que se saca de la planilla PODRÍA seguir siendo elegible para Marcos**: la
   sincronización no tiene `DELETE` y Marcos lee PostgreSQL primero. **Es un riesgo latente, no un
   problema abierto**: se corrió `node revisar-sobrantes.js` y las dos bases coinciden en toda la
   configuración (4 proveedores y 4). **"lalala" está en las dos** — la línea anterior decía que
   Marcos lo eligió "por eso" y eso era un error mío del 28/09, corregido en `CLAUDE.md`. No se borra
   nada; se revisa con la herramienta antes de salir a probar con datos reales.

---

## 6. Congelado — no rediseñar por iniciativa propia

**Los nombres en una línea telefónica compartida.** Decisión de Daniel del 27/09: *"lo de los
nombres dejalo para más adelante, que quizás no lo apliquemos, porque hoy es una ensalada de nombres
por que no tengo más número para probar"*.

La ensalada es del banco de pruebas, no del producto: hay un solo teléfono, así que julio y dario
están cargados sobre la misma línea. Con números separados, todo el desempate ni siquiera corre.
Diseñar la regla definitiva contra un síntoma que solo existe en el banco es diseñar contra el banco.

Lo que **sí** sigue vigente es el refresco de `datos-del-caso.js`, y no por los nombres: el mismo
estado guarda `vecinoActivo`, que es **a qué vecino se le avisa**.

---

## 7. Las cinco conversaciones

| Quién | Qué toca |
|---|---|
| **Antigravity — panel** | `dashboard.js`. El único con acceso al VPS |
| **Antigravity — sitio web** | `bienargentinos.com` |
| **Chat del portal** (Claude) | `portal-vecino.js`, `porteria.js`, `qr-firmado.js`, `clave-app.js` |
| **Chat de Marcos IA** (Claude) | el motor: `index.js`, `datos*.js`, `sheets.js`, `db-pg.js`, `agentes/` |
| **Chat del tutorial** | arranca al final. No escribe código |

Si una necesita un cambio del lado de otra, **lo pide en vez de hacerlo**. Dos agentes editando el
mismo archivo el mismo día es cómo se pierde trabajo — ya pasó tres veces.

---

## 8. Antes de cada push

```bash
node verificar-antes-de-subir.js
```

Hoy son **88 pruebas**. Si alguna falla, no se empuja: cada una está atada a algo que pasó de verdad
en producción.

Y **antes de empujar hay que traer lo de los demás** (`git pull --rebase`): el portal y el panel
empujan a la misma rama el mismo día, así que un push directo se rechaza o pisa trabajo ajeno.
