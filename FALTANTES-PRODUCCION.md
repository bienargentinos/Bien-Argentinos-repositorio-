# Lo que falta para que esto se pueda mandar a producción

Última actualización: 12/09/2026

> [!NOTE]
> **Este archivo está escrito para que se pueda abrir un chat nuevo, solo sobre estos temas, sin
> perder el contexto del proyecto.** Es autosuficiente a propósito: se puede leer sin haber estado
> en ninguna conversación anterior.
>
> No duplica a `PENDIENTES.md` ni a `TAREAS_PENDIENTES.md`, que son de **funcionalidad** (qué le
> falta hacer a Marcos). Este es de **producción**: seguridad, respaldo, datos personales y la
> deuda de arquitectura. Son las cosas que no se ven fallar en el log hasta el día que se ven.
>
> `CLAUDE.md` sigue siendo la fuente de verdad de cómo funciona el sistema y de cada defecto ya
> resuelto. Leerlo antes de tocar código.

---

## Qué es este proyecto, en un párrafo

Daniel es electricista y trabaja para **once administradores de consorcio**. Marcos IA es un
asistente de WhatsApp que hace lo que hacía el administrador cuando atendía el teléfono: recibe el
reclamo del vecino, elige al técnico por edificio y rubro, le manda la dirección y el contacto de
ingreso, le hace seguimiento, recibe la factura y la imputa al caso. Hay un panel web
(`dashboard.js`, montado en `/admin`) donde el administrador ve todo, y un portal del vecino
(`portal-vecino.js`) con reservas de amenities y un prototipo de timbre con QR. El objetivo final es
que esto sea un producto, **Edifica**, con acceso desde el teléfono.

Tesis de Daniel, que manda sobre todas las decisiones de producto: *"lo importante es que Marcos
trabaje como si fuera yo, con empatía, carácter, calidad, conocimiento y lógica, más que nada con
contexto"*.

**Estado real**: funciona en producción, con usuarios reales, y lleva unos cuarenta defectos
encontrados y corregidos, cada uno con su prueba. Lo que está atrasado no es el código: es lo que lo
rodea.

## Cómo se trabaja acá (obligatorio)

- **GitHub es la única fuente de verdad.** El VPS se actualiza con `git pull` y `pm2 restart
  marcos-ai`. Prohibido editar archivos a mano en el servidor.
- **Antes de cada push**: `node verificar-antes-de-subir.js`. Corre las pruebas, revisa que los 108
  archivos `.js` compilen, y que no falten funciones que otros archivos piden.
- **Cada arreglo lleva su prueba**, y cuando se puede, un **candado**: una prueba que impide que
  vuelva esa *clase* de error, no solo ese caso. Es lo que sostiene el proyecto.
- **Un comando por bloque** cuando se le pasan instrucciones a Daniel para el VPS.
- **Ninguna credencial va en un archivo, en un comando ni en un mensaje.**

---

## Los faltantes, en orden de lo que puede matar el proyecto

### 1. No hay respaldo de nada 🔴

**Qué pasa**: no existe ningún volcado programado de PostgreSQL, y las fotos, audios y comprobantes
viven en `almacenamiento/`, en el disco de un solo VPS de DonWeb. Si falla el disco, si se llena, o
si hay un incidente del proveedor, se pierde todo el historial de once administradores.

**Por qué es el primero**: es lo más barato de toda la lista (se resuelve en una hora) y es el único
que no tiene arreglo posterior. Un sistema perfectamente blindado sin respaldo se pierde igual.

**Qué hace falta**: un volcado diario de `marcos_db` más una copia de `almacenamiento/`, con
retención de varios días, y **fuera del mismo disco**. Una copia que vive en el servidor que puede
fallar no es una copia. Y después verificar que se puede **restaurar**: un respaldo que nunca se
probó no se sabe si sirve.

> Google Sheets funciona hoy como respaldo accidental de la configuración, porque tiene historial de
> versiones. No cubre `mensajes`, ni los audios, ni las fotos.

---

### 2. Las contraseñas de los clientes están en texto plano 🔴

**Qué pasa**: la pestaña `clientes` de Google Sheets guarda usuario, contraseña y mail de cada
administrador de consorcio, **en texto plano**. Está anotado en `CLAUDE.md` como pendiente desde el
principio.

**Por qué importa**: si esa planilla se filtra o se comparte mal, se filtran las contraseñas de once
administradores. Y la mayoría de la gente reusa la contraseña de su correo.

Alrededor de esto hay tres cosas más del mismo tipo:

- **El repositorio se hace público** cada vez que se usa el `curl` de transferencia al VPS.
- **El panel entra con un usuario y contraseña fijos**, escritos en `CLAUDE.md`.
- **Hubo un token de GitHub expuesto** y hay que darlo de baja. Borrarlo de un archivo no lo
  invalida: sigue en el historial de git y en los logs.

**Qué hace falta**: hashear con bcrypt, activación por token y recuperación por mail (ya está en la
lista de `CLAUDE.md` como "Auth real"). Y mientras eso no exista, al menos rotar lo que está
expuesto y dejar de publicar el repo.

---

### 3. Datos personales de terceros que nunca aceptaron nada 🟠

**Qué pasa**: el sistema guarda nombres, teléfonos, número de departamento, **audios** y **fotos del
interior de viviendas** de vecinos, que no son clientes de Daniel. En Argentina eso cae bajo la
**ley 25.326 de protección de datos personales**.

Hoy no hay:

- Política de cuánto tiempo se guarda nada.
- Forma de que un vecino pida que borren sus datos.
- Constancia de qué sabe el vecino sobre el tratamiento de esos datos.

**Por qué no se arregla con código después**: los datos ya recolectados no se pueden "des-recolectar".

**Decisión de Daniel, ya tomada**: los vecinos **no** saben que Marcos es IA, y se va a revelar más
adelante, cuando la interacción esté cómoda. Su razonamiento: no busca engañar, busca dar comodidad,
como las empresas de seguridad que venden sensación de seguridad. **No revertir esto sin
preguntarle.**

Dos observaciones que quedaron dichas y siguen abiertas:

- La regla actual dice que Marcos *"rechaza preguntas sobre si es robot"*. **No anunciar** y
  **negar** no son lo mismo: lo primero es omisión, lo segundo es una afirmación falsa. Se puede
  esquivar sin afirmar (*"soy parte del equipo de la administración"*) y la comodidad se mantiene
  intacta. Cambio de una línea, pendiente de su decisión.
- Lo que más lo protege está del lado del administrador, que sí sabe que es IA: que figure en lo que
  firma, y que él decida qué le cuenta a su consorcio.

---

### 4. El aislamiento entre clientes se apoya en comparar textos 🟠

**Qué pasa**: **no hay id de edificio ni de proveedor: el nombre es la clave**, escrito a mano como
texto en ocho pestañas por dos bases de datos. Que el administrador A no vea los reclamos del
consorcio de B depende de que esas comparaciones de texto salgan bien.

**Por qué es grave**: no es higiene de datos, es la **frontera de permisos**. `CLAUDE.md` ya
documenta que no se debe usar `compararEdificios` para esto, porque acepta coincidencias parciales y
con eso el edificio de una calle queda asignado al cliente de otro. Un error ahí es un administrador
viendo datos de un consorcio ajeno.

**Qué hace falta**: ids de verdad para edificio y proveedor, y que el nombre pase a ser solo una
etiqueta para mostrar. Es la reforma más cara de la lista y la que más cosas arregla de una vez:
también mata los renombres que "vuelven solos" y las asignaciones huérfanas.

**Herramientas que ya existen** y hay que seguir usando hasta entonces:

```bash
node revisar-edificios.js     # nombres que no corresponden a ningún edificio
node revisar-sobrantes.js     # lo que sobra o falta entre Sheets y PostgreSQL
```

---

### 5. Dos fuentes de verdad: Sheets y PostgreSQL 🟠

El panel lee Google Sheets; el motor de Marcos lee PostgreSQL primero. **Es la causa de fondo de
casi todos los defectos documentados en `CLAUDE.md`**: el mismo dato escrito con dos nombres, o en
una sola de las dos bases, sin que nada dé error.

Fue una decisión pragmática correcta en su momento y hoy es el principal centro de costos: cada
arreglo cuesta el doble porque hay dos lados. No es urgente, es caro. Vale planificarlo, no
improvisarlo.

---

### 6. Nada avisa cuando se cae, y los logs crecen sin límite 🟡

- **Sin monitoreo**: si Marcos se muere a las 3 de la mañana, nadie se entera hasta que alguien
  mira. El contador de reinicios de PM2 va por arriba de 169. Se resuelve con UptimeRobot, que es
  gratis, y está anotado como pendiente desde hace tiempo.
- **Sin rotación de logs**: `pm2 install pm2-logrotate`. Un disco lleno rompe cosas que no parecen
  tener nada que ver, y el diagnóstico se va por cualquier lado.
- **Los defectos se encuentran leyendo `pm2 logs` a mano.** Funciona con un edificio. No escala a
  once administradores.

---

### 7. No hay ambiente de prueba 🟡

Cada prueba es en producción, contra WhatsApp real, con personas reales del otro lado. El **12/09**
se pagó el precio: un acento grave dentro de un comentario SQL rompió `db-pg.js` entero, el
verificador no lo agarró porque su lista de archivos estaba escrita a mano, y Marcos quedó caído en
un bucle de reinicios hasta que una persona lo vio. (El verificador ya revisa todos los `.js`, así
que **esa** forma del error no vuelve.)

---

### 8. No hay rate limit en ninguna ruta 🟡

Verificado: ni `index.js`, ni `dashboard.js`, ni `portal-vecino.js` tienen límite de pedidos.
Cualquiera puede probar contraseñas contra el panel a la velocidad que aguante el servidor, o
saturar el webhook. Lo exige el propio `MOBILE_SECURITY_STANDARDS.md` en su sección 5, así que el
estándar ya nace incumplido.

---

### 9. No se sabe cuánto cuesta cada conversación 🟡

Gemini, ElevenLabs y Meta cobran por uso y no hay medición. La sección "Consumos" del diseño está
pendiente justamente por esto. Sin ese número no se puede poner precio a los planes ni saber si un
edificio grande da pérdida.

---

## Lo que ya está hecho (para que un chat nuevo no lo rehaga)

- ✅ **Firma del webhook de Meta** (`firma-webhook.js`, 12/09). Antes, cualquiera que conociera la
  URL podía hacerse pasar por un técnico o un vecino y Marcos actuaba: abría casos, mandaba WhatsApp
  a personas reales, dejaba cambios de CBU pendientes, imputaba facturas. Ahora se verifica
  `X-Hub-Signature-256` con HMAC-SHA256 sobre el cuerpo **crudo** y comparación de tiempo constante.
  Prueba: `node pruebas-firma-webhook.js`.

  > [!CAUTION]
  > **Falta poner `META_APP_SECRET` en el `.env` del VPS.** Sin esa variable el webhook **sigue
  > aceptando todo**, a propósito: rechazar sin el secreto dejaría a Marcos sordo en el instante del
  > despliegue. Mientras falte, cada pedido deja un `🔓` en el log. Se cierra sola al agregarla,
  > sin tocar código. El valor sale del panel de la app de Meta y **no va escrito en ningún archivo
  > del repo**.

- ✅ El esquema de PostgreSQL coincide con lo que el código escribe, con candado
  (`pruebas-columnas-pg.js`).
- ✅ Los permisos de tablas de PostgreSQL están bien (`revisar-permisos-pg.js` los verifica).
- ✅ El verificador revisa **todos** los `.js`, no una lista escrita a mano.

## Decisiones ya tomadas

- **PWA antes que app nativa.** Android nativo más iOS nativo son dos bases de código, dos
  pipelines, cuenta de desarrollador de Apple anual y revisión de tienda. Una PWA se instala con
  ícono en Android y en iPhone, `portal-vecino.js` ya es web, y además la mitad de MASVS deja de
  aplicar porque no hay binario que descompilar ni manifiesto que endurecer. Lo que queda es
  seguridad de backend, que es donde está el riesgo real. La app nativa se hace después, sobre una
  API ya endurecida.
- **`MOBILE_SECURITY_STANDARDS.md` queda como está** y es correcto, pero hay que leerlo sabiendo que
  describe una app que todavía no existe: menciona Supabase, Firebase, Stripe y flujos de OTP que
  este proyecto no usa. Le falta la mitad del backend, que es lo que está expuesto hoy. Y **no es
  una skill**: es un documento. No hay `.claude/skills` en el repo y nada verifica que se cumpla.

## Cómo se verifica que no se rompió nada

```bash
node verificar-antes-de-subir.js
```

```bash
node revisar-sobrantes.js
```

```bash
node revisar-edificios.js
```
