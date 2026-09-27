# Para el chat de la guía/tutorial del panel

> [!CAUTION]
> **Este archivo NO se mantiene al día, y es a propósito. Se lee al final, no durante.**
>
> Decisión de Daniel, 26/09: el tutorial se arma **cuando el sistema esté terminado y salga a
> probar**. Hasta entonces los botones aparecen y desaparecen varias veces por semana --solo
> Expensas cambió tres veces en un día-- y mantener el material sincronizado sería una cinta sin
> fin que no sirve para nada mientras no haya nadie leyéndolo.
>
> Así que acá **no** hay una lista de qué cambió. Esa lista se saca mirando el panel el día que se
> escriba el tutorial, que para entonces va a estar quieto.

---

## Entonces, ¿para qué existe esto?

Para lo único que **no** se puede averiguar mirando el panel ese día: **las decisiones y sus
motivos.** Eso no envejece, y si se pierde, el tutorial va a explicar bien las pantallas y mal el
producto.

Son pocas cosas y no cambian.

### 1. El vecino NO sabe que Marcos es IA. El AC sí.

Es la regla de oro del proyecto. **No puede aparecer en ningún material que pueda llegarle a un
vecino** — ni en una captura, ni en un pie de página, ni en un ejemplo.

Con el AC es al revés: sabe que es IA y conviene que lo sepa, porque es lo que le explica por qué
Marcos atiende a cualquier hora.

### 2. Hay cosas que están feas A PROPÓSITO

> **El horario del encargado** se carga en bloques Lun-Vie + Sábado, y esa estructura **no alcanza**
> para la realidad: hay edificios donde va alguien de limpieza tres días a la semana en horarios
> raros. En producción salió `Sáb 12:00-08:00`, que no existe.
>
> Daniel decidió **no maquillarlo** hasta reemplazarlo por calendario o texto libre. Dejarlo feo es
> lo que mantiene visible que está mal.
>
> **Un tutorial que lo explique como si funcionara bien tapa esa señal.** Si al escribirlo eso sigue
> así, mejor no documentarlo que documentarlo como si estuviera terminado.

### 3. No escribir desde `CLAUDE.md` ni desde `design/`

Los dos documentan **intenciones**, y varias no existen en el panel: la impersonación ("Ver como
cliente"), la campana de notificaciones con contador real, la sección Consumos. Explicarlas manda
al AC a buscar botones que no están.

Se escribe mirando **lo que el panel hace**, y lo que no se entienda se pregunta en
`docs/para-antigravity.md`.

### 4. Marcos completa los datos del edificio con el tiempo

Vale la pena decírselo al AC para que no se asuste con la ficha vacía: **no hace falta cargar todo
el primer día.** Lo que falte lo va completando Marcos hablando con vecinos y encargados.

---

## Cómo contestar

Si hace falta preguntar algo, va al buzón de quien corresponda:

| Si le escribís a… | Escribí en |
|---|---|
| el motor (Marcos) | `docs/para-el-motor.md` |
| el panel (Antigravity) | `docs/para-antigravity.md` |
| el portal (vecino y portería) | `docs/para-el-portal.md` |
