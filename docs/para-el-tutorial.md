# Para el chat de la guía/tutorial del panel — su buzón

**Este es el buzón del chat que arma los tutoriales** con los que el asistente del panel le explica
las cosas al administrador de consorcio (AC). Lo lee y **no lo edita**.

Acá le dejan avisos las otras conversaciones: el motor (Marcos), el panel (Antigravity) y el portal
del vecino. Para contestar, escribe en el buzón de quien corresponda:

| Si le escribís a… | Escribí en |
|---|---|
| el motor (Marcos) | `docs/para-el-motor.md` |
| el panel (Antigravity) | `docs/para-antigravity.md` |
| el portal (vecino y portería) | `docs/para-el-portal.md` |

> **Cada entrada va firmada y fechada** (`## 26/09 — del motor — título`), y si es para una sola
> conversación el título lo dice.

---

## Por qué este buzón existe, y para qué sirve de verdad

> [!CAUTION]
> **Un tutorial que enseña el comportamiento viejo es peor que no tener tutorial.** El AC lo sigue,
> no le funciona, y concluye que **el sistema está roto** — no que el tutorial está viejo.

Este chat es el único que no escribe código: escribe lo que una persona va a leer y hacer. Por eso
es el más fácil de romper sin que nadie se entere, y el daño lo paga alguien que no puede
diagnosticarlo.

**La obligación es del resto de nosotros**: cuando un cambio modifica lo que el AC ve o hace en el
panel, quien lo hizo deja una línea acá. No hace falta explicar el código — alcanza con **qué
cambió en la pantalla** y **qué hay que decirle ahora**.

### Y una regla para escribir el tutorial

> [!CAUTION]
> **No se escribe desde `CLAUDE.md` ni desde la carpeta `design/`.** Los dos documentan
> *intenciones*, y varias todavía no existen en el panel: la impersonación ("Ver como cliente"), la
> campana de notificaciones con contador real, la sección Consumos. Un tutorial que las explique
> manda al AC a buscar botones que no están.
>
> Se escribe mirando **lo que el panel hace hoy**. Si hay una duda, se pregunta en el buzón del
> panel en vez de deducirla del documento.

---

## 26/09 — del motor — Lo que cambió ESTA SEMANA y toca lo que ve el AC

Arranco con lo que ya está desactualizado, porque si el tutorial se escribió antes de hoy, estas
cuatro cosas están mal.

### Expensas cambió tres veces en un día

Es la sección que más se movió y la que el AC más va a necesitar.

1. **Subida en tanda**: se pueden subir hasta 60 archivos de una y aparece una tabla de revisión
   **antes** de publicar, con un semáforo por fila — 🟢 coincide con un vecino, 🔵 liquidación
   general del edificio, 🟡 la unidad existe pero todavía no hay vecino registrado (se publica
   igual, no es un error), 🔴 unidad repetida en la tanda.
2. **El monto se extrae solo del PDF**, y se puede corregir a mano en esa tabla. Si no se pudo leer
   con confianza, queda en blanco a propósito en vez de mostrar un número inventado.
3. **Con varios edificios hay que elegir uno primero.** Antes se publicaba y el archivo caía en el
   primero de la lista sin avisar. Ahora corta y lo pide.
4. **La liquidación general va sin unidad** y se muestra distinto: dice *"Gastos del edificio"*, no
   *"Total a pagar"*, para que el vecino no crea que le toca pagar eso. **Nunca es obligatoria** —
   decisión de Daniel.

> El detalle de cada una está en `docs/para-antigravity.md`, pero para el tutorial alcanza con lo
> de arriba.

### La sesión del panel ya no se cae en cada actualización

Antes, cada vez que se reiniciaba el servidor todos los usuarios quedaban deslogueados. Ya no. Si
igual llega a pasar, el mensaje ahora dice *"Se venció la sesión del panel. Volvé a entrar y probá
de nuevo."* — antes salía un error incomprensible con la palabra `JSON`.

**Vale la pena que el tutorial lo mencione**: si el AC ve ese mensaje, no es un error, vuelve a
entrar y sigue.

### Los proveedores tienen VARIOS rubros, no uno

La ficha guarda varios (electricista + CCTV + control de acceso, por ejemplo) y se eligen tocando
botones, no con un desplegable. Después, en cada edificio, se **asigna** ese proveedor a un rubro
con su prioridad (primera / segunda / urgencias).

Es un flujo de **dos pasos** y conviene explicarlo así, porque es lo que evita cargar al mismo
plomero 27 veces:

1. Una vez: cargar la lista de proveedores del cliente.
2. En cada edificio: elegir de esa lista y darle prioridad.

### Cómo se le habla al AC sobre Marcos

Dos cosas del producto que no son detalles de pantalla:

- **El AC sabe que Marcos es IA.** El vecino **no**, y eso no se dice nunca en ningún material que
  pueda llegarle a un vecino.
- Marcos **completa datos del edificio con el tiempo**, hablando con vecinos y encargados. El
  tutorial puede decirle al AC que no hace falta que cargue todo el primer día: lo que falte se va
  llenando solo.

---

## Lo que NO conviene meter en el tutorial todavía

Está en los documentos de diseño y **no existe en el panel**:

- "Ver como cliente" (impersonación) para el dueño.
- La campana de notificaciones con contador real — hoy es solo visual.
- La sección Consumos y el excedente facturable.

Y uno que sí existe pero está feo a propósito: **el horario del encargado** se carga en bloques
Lun-Vie + Sábado que no alcanzan para la realidad (hay edificios donde va alguien de limpieza tres
días en horarios raros). Daniel decidió **no maquillarlo** hasta reemplazarlo, justamente para que
se siga viendo que está mal. Si el tutorial lo explica como si funcionara bien, tapa esa señal.
