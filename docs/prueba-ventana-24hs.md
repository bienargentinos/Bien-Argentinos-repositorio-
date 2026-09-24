# Prueba end-to-end con la ventana de 24hs CERRADA

> [!CAUTION]
> **Con la ventana abierta esta prueba no prueba nada.** Todos los mensajes llegan y el resultado
> es idéntico al de un sistema roto. Así se pasaron por alto los dos bugs que están más abajo.

La ventana de Meta la abre **el técnico cuando escribe**, no la plantilla que mandamos nosotros.
Todas las pruebas anteriores se hicieron desde el mismo teléfono y seguidas, así que la ventana
estaba siempre abierta.

## Lo único que hay que preparar con un día de anticipación

**Desde el número del técnico, no escribirle nada a Marcos durante 24 horas.**

Es la parte cara y es la razón por la que esta prueba nunca se hizo. No hay atajo: la ventana se
mide desde el último mensaje **entrante** de ese número.

Hacen falta dos teléfonos distintos: uno hace de vecino y otro de técnico. El del técnico tiene
que estar cargado como proveedor con un rubro, y asignado al edificio.

## Antes de empezar

```bash
node revisar-columnas.js
```

```bash
node revisar-columnas-pg.js reportes
```

Tienen que existir `material_enviado_tecnico` y `contacto_acceso_avisado` en **las dos** bases. Si
falta en PostgreSQL, el `UPDATE` que borra las marcas falla entero --no a medias-- y el reintento
depende de que conteste Sheets, que es la base que Marcos lee **segunda**. Ese fue exactamente el
bug de la vez anterior.

Para que Marcos no lo reconozca y el caso arranque de cero:

```bash
node reset-test.js
```

> Vacía `VECINOS`, `EVENTOS` y `memoria` de Sheets, las tablas de conversación de PostgreSQL y
> `almacenamiento/`. **No toca** `CLIENTES`, `EDIFICIOS`, `proveedores` ni
> `proveedor_asignaciones`, que son configuración.

## La secuencia

Desde el teléfono del **vecino**, en una ráfaga:

1. un audio contando el problema
2. una foto del problema
3. la ficha de contacto de quien va a recibir al técnico

Marcos abre el caso y le manda la plantilla al técnico.

**Al técnico le tiene que llegar SOLO la plantilla.** La foto y el contacto de ingreso rebotan con
el código `131047`, que es lo correcto y lo esperado: la ventana está cerrada.

Recién entonces, desde el teléfono del **técnico**: `ok`. Un punto alcanza, o el botón de la
plantilla.

En ese instante --que es el único momento en que Meta abre la ventana-- tienen que llegar la foto
y el contacto de ingreso.

## Qué mirar en el log

```bash
pm2 logs marcos-ai --lines 300 --nostream | grep "131047"
```

```bash
pm2 logs marcos-ai --lines 300 --nostream | grep "📎↩️"
```

La segunda línea es la que importa:

```
📎↩️ [CASO-x] lo que se le había mandado NO llegó. Se borran las marcas de entrega:
     cuando conteste, se le manda de nuevo.
```

> [!CAUTION]
> **Si aparece el `131047` y NO aparece el `📎↩️`, la prueba falló** — aunque después le llegue
> todo. Significa que llegó por otro camino y el agujero sigue abierto.
>
> Ese es el bug exacto de la prueba del 9/9: los envíos rebotaron pero quedaron marcados como
> entregados, así que cuando el técnico contestó no se reintentó nada. Él escribió *"puedo ir en 2
> hs pero necesito foto y también un teléfono de quien me recibe"* — las dos cosas que Marcos creía
> haberle mandado.

Y esta no tiene que aparecer nunca:

```bash
pm2 logs marcos-ai --lines 300 --nostream | grep "NO SALIÓ"
```

Si sale, la plantilla fue rechazada por Meta y lo que llegó fue el mensaje libre de respaldo. Con
la ventana cerrada ese respaldo también rebota, así que el técnico no se entera de nada.

## Lo que hay que leer, no grepear

Varias reglas viven en el prompt y **ninguna prueba automática las cubre**. Se verifican leyendo lo
que Marcos contesta de verdad:

- Si el técnico dice la hora y pregunta quién le abre **en el mismo mensaje**, al vecino hay que
  decirle la **hora del reloj**, no *"estamos coordinando"*.
- El contacto de ingreso sale **solo si lo pide**, no porque esté a mano.
- Si dijo que tiene llave, no se le explica quién le abre.
- No se le pregunta la dirección que él acaba de decir.
- Nunca decir que el vecino no mandó material cuando mandó.

## Tres cosas que parecen errores y no lo son

- `enviarEncuestaServicio is not a function` — esa función **no existe**, a propósito. Adivinar qué
  tenía que hacer es peor que no tenerla, así que queda gritando en el log para que sea una
  decisión y no un olvido.
- El caso abierto en estado **`avisado`** en vez de `en_proceso`: es un aviso sin confirmar, y está
  bien.
- Al técnico le llega la **dirección** y no el alias interno del edificio (`san patricio casa`).
  También está bien: él va a una calle y una altura.

## Si algo falla

Las herramientas de diagnóstico solo leen, así que se pueden correr en el momento:

```bash
node revisar-seguimientos.js
```

```bash
node revisar-facturas.js
```

```bash
node emparejar-casos.js
```
