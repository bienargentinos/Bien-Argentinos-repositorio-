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

## 3. En qué punto está el código (28/09)

**Desplegado y andando en el VPS:** `9b78d7d`, puesto por Antigravity el 27/09 con 79 pruebas en
verde y `marcos-ai` online. **Adentro va `9585cc6`**, el arreglo de a qué técnico se le manda el
trabajo — o sea que ya está corriendo, aunque se había pedido esperar a que terminara la prueba de
cerrajería.

> [!CAUTION]
> **Cuatro conversaciones empujan a la misma rama y Antigravity despliega lo que encuentra.** El
> merge del portal se llevó puesto ese pedido de esperar, sin que nadie hiciera nada mal: nadie
> mira si lo que está en la rama es de otro. Antes de decirle a Daniel "esto no se despliega
> todavía" hay que verificar que siga siendo cierto:
>
> ```bash
> git merge-base --is-ancestor <commit> origin/claude/marcos-ia-whatsapp-template-vpg8gw
> ```
>
> Y un pedido de **no** desplegar algo va en `docs/para-antigravity.md`, no solo dicho en el chat:
> el chat no lo lee quien despliega.

En este caso no arruinó la prueba: con **un solo** cerrajero asignado, el orden por prioridad no
cambia nada, y el control del teléfono no lo saltea porque "lalala" tiene un número real cargado.
Fue suerte, no diseño.

### Qué trae `9585cc6`

1. **La columna `prioridad` que el administrador carga en el panel no se usaba en ningún lado.**
   Las dos copias de `buscarTecnicoAsignado` elegían con `filas.find(...)` — la primera fila que
   devuelve la base. Con un solo proveedor por rubro acierta siempre, así que el bug solo existía
   con dos: justo lo que nunca se probó.
2. **Un teléfono al que no se puede llamar se elegía igual** (`11111111111`, ocho dígitos). La
   plantilla de Meta salía, rebotaba, y el caso quedaba "en proceso" con un técnico inalcanzable.
   Ahora se baja al siguiente; si ninguno sirve, no se asigna nadie y se dice fuerte en el log.
3. Estaba **escrita dos veces**, en `datos-pg.js` y `sheets.js`. Ahora las dos llaman a
   `elegir-asignacion.js`, con un candado que prohíbe volver a decidir con `.find()`.

**Dos cosas que NO cambiaron a propósito**, y están dichas en el código, en la prueba y en
`CLAUDE.md`: la comparación de rubros (unificarla con `atiendeRubro` cambiaría a quién se le deriva
cada caso — es su propio trabajo) y el comodín del edificio vacío en una asignación (sacarlo a
ciegas puede dejar sin técnico a un edificio que hoy lo encuentra por esa vía; ahora **avisa en el
log** cada vez que actúa).

---

## 4. La prueba que Daniel está corriendo

End-to-end en **cerrajería**: primero desde el número del cliente, después desde el del proveedor.

Dos cosas que van a aparecer y **no son bugs**:

- **Marcos lo va a llamar "lalala"** toda la conversación: es el cerrajero asignado en ese rubro
  (un proveedor de prueba con su propio número). El nombre ahora sale del caso — eso es el arreglo
  del 27/09 funcionando. **Lo que sí hay que reportar es si la plantilla y los mensajes libres lo
  llaman distinto**: eso es el desfasaje de `datos-del-caso.js` volviendo.
- En el log puede salir `🔧⚠️ La asignación de "lalala" no tiene edificio cargado, así que vale para
  TODOS.` Significa que esa fila está asignada a todos los edificios, no solo al 159.

> **No sugerir borrar "lalala" ni ningún otro dato.** Daniel, 28/09: **todo lo que hay cargado es
> ficticio** --nombres, oficios, edificios, administradores, inquilinos--. Seguimos en fase de
> prueba. La limpieza es el **borrado total** de `CLAUDE.md`, una sola vez y cuando él lo pida,
> antes de salir a probar afuera. Hasta entonces no se proponen borrados sueltos.

---

## 5. Pendientes, en orden

1. ~~**`guardarReporte`, el `|| !eBuscado`.**~~ **Hecho el 28/09 y subido a la rama compartida,
   pero pedido que NO se despliegue hasta que Daniel termine la prueba de cerrajería** (nota en
   `docs/para-antigravity.md`). Sin edificio, ahora solo engancha si todos los casos abiertos de ese
   teléfono son de un mismo edificio; si hay dos, no elige y lo dice con `🧨` en el log
   (`caso-del-telefono.js`, `pruebas-caso-del-telefono.js`).
2. **`SMTP_HOST` y la baja del hosting de mail: la parte del código está hecha (28/09), falta la del
   `.env`.** `smtp-config.js` arma la conexión (el puerto decide TLS directo o STARTTLS, la
   verificación del certificado queda apagada solo para el host viejo, `SMTP_FROM` opcional), Marcos
   prueba el mail al arrancar (`📧✅` / `🚨📧` en el log) y `node revisar-smtp.js` lo prueba a pedido.
   **Falta que Daniel elija el proveedor nuevo** y que se cambie `SMTP_*` en el `.env` del VPS el
   mismo día de la baja, corriendo `node revisar-smtp.js --enviar <su mail>` después. De paso: el
   mail primario sale de la columna `email` de `CLIENTES` --hay que mirar que esté cargada--.
3. ~~**Que una copia a PostgreSQL que falla no se pierda.**~~ **Hecho el 28/09** (`cola-pg.js`),
   subido y pedido para desplegar con los otros dos cuando termine la prueba de cerrajería. Las
   copias son datos y no funciones; la que falla por conexión se reintenta sola, en orden, y
   sobrevive a un reinicio en `cola-pg-pendiente.json`. Probado contra un PostgreSQL de verdad.
4. **Unificar la comparación de rubros con `atiendeRubro`** (lo que quedó afuera de `9585cc6`).
5. **El comodín del edificio vacío** en `proveedor_asignaciones`: decidir si se saca, mirando antes
   qué edificios dependen hoy de esa vía.
6. **Documentos comerciales que faltan**: CBU con verificación, reservas de amenities, la ventana de
   24hs, el seguimiento automático, y el de `9585cc6` (a qué técnico se le manda el trabajo).

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

Hoy son **82 pruebas** (79 en lo desplegado). Si alguna falla, no se empuja: cada una está atada a algo que pasó de verdad
en producción.

Y **antes de empujar hay que traer lo de los demás** (`git pull --rebase`): el portal y el panel
empujan a la misma rama el mismo día, así que un push directo se rechaza o pisa trabajo ajeno.
