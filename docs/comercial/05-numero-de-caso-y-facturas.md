# Cada mensaje al técnico lleva el número de trabajo

> Todo lo que Marcos le manda a un proveedor va con el código del trabajo. Es lo único que después
> permite saber de qué obra es cada factura.
>
> **Estado**: en producción desde el 27/09/2026 · **Se ve en**: WhatsApp (lado del técnico) y en la
> sección Facturas del panel

---

## 1. ¿Qué problema resuelve?

Un buen técnico no trabaja para un solo administrador. Hace seis trabajos en la semana, para cuatro
clientes distintos, y el viernes manda todas las facturas juntas. A veces dos semanas después.

Cuando esa factura llega, alguien tiene que decidir **a qué consorcio se le carga**. Y esa decisión
la toma mirando un PDF que dice "reparación de cañería" y un monto.

Si el técnico no tiene cómo decir *"esta es la del trabajo tal"*, el administrador queda adivinando.
Y adivinar acá significa cargarle un gasto a un consorcio que no lo hizo.

Lo que pasaba: había un camino por el que la foto del reclamo le llegaba al técnico **sin el número
de trabajo**. El dato existía —estaba calculado en ese mismo momento— y no llegaba al mensaje. Así
que el técnico recibía el pedido por un lado con número y por otro sin él, sin saber que eran lo
mismo.

## 2. ¿Cómo funciona en la práctica?

**Todo lo que sale hacia un proveedor lleva el código.** La notificación del trabajo, la foto del
problema, el teléfono de quien le abre, la lista de sus trabajos abiertos:

```
📱 MARCOS — FOTO DEL RECLAMO [CASO-1005]

Dario, el vecino en San Patricio 159 adjuntó esto del inconveniente.
```

**Y siempre con la dirección de la calle, nunca con el nombre interno del edificio.** En el sistema
un consorcio puede figurar como "san patricio casa" — eso es un alias del administrador, y al
técnico no le dice nada. Él estuvo en una calle y una altura.

**Cuando llega la factura, Marcos la asocia sola.** Si el técnico tiene un solo trabajo esperando
comprobante en ese edificio, la factura va ahí. Y si tiene dos, **no adivina**: le muestra la lista
por dirección y le pregunta.

```
MARCOS:   "Recibí la factura N° 00001-00000262 por $5.500.
           ¿De cuál de estos trabajos es?
           1️⃣ CASO-1005 — San Patricio 159 (agua en el palier)
           2️⃣ CASO-1003 — San Patricio 159 (puerta de acceso)"

Técnico:  "1005"
```

Y el técnico puede contestar como se le cante: *"1005"*, *"el caso 1005"*, *"1005 es el caso"*.
Marcos lo entiende igual.

**La factura queda guardada con su número de trabajo**, así que en la sección Facturas del panel el
administrador ve el gasto y el reclamo que lo originó, con la conversación completa.

## 3. Argumentos comerciales

**A quién le importa**: al administrador cuando cierra el mes, y al consejo cuando revisa.

- **Ningún gasto queda huérfano.** Una factura sin contexto es una discusión: qué se arregló, quién
  lo pidió, cuándo. Acá el gasto llega con el reclamo, la foto del problema y el chat del técnico.
- **Ningún gasto se carga dos veces al mismo trabajo.** Si un trabajo ya tiene su factura, la
  siguiente que llegue es de otra obra — y Marcos pregunta en vez de sumarla ahí.
- **El técnico no tiene que llevar la cuenta.** No le pedimos que anote nada: el número viaja en
  cada mensaje que ya iba a recibir.
- **Con qué se compara**: hoy el administrador reconstruye esto de memoria, buscando en su WhatsApp
  de qué semana era cada trabajo. Es la tarea que más se posterga y la que más caro sale cuando se
  hace mal.

## 4. Guion base para video / reel / publicidad

> **Llega la factura. ¿De qué trabajo era?**
>
> Tu plomero trabaja para cuatro administradores. El viernes te manda tres facturas juntas, de obras
> de la semana pasada.
>
> ¿Cuál era de qué edificio?
>
> Con Marcos no hace falta acordarse. Cada mensaje que le mandó al técnico llevaba el número del
> trabajo y la dirección de la calle. Cuando llega el comprobante, se asocia solo — y si hay dos
> posibles, pregunta.
>
> El gasto te llega con la foto del problema, el reclamo del vecino y la conversación completa.
>
> **Para cuando el consejo pregunte qué se arregló.**
>
> *Bien Argentinos — Marcos IA.*

## 5. Lo que todavía no hace

> Es lo que evita prometer de más en una demo.

- **El binario del PDF de expensas todavía no se sube** al sistema (eso es de otro módulo), pero las
  facturas de proveedores sí quedan guardadas con su archivo.
- **Si el técnico manda una factura sin número de comprobante**, Marcos la registra igual — perder
  una factura es peor que tener dos— pero no puede detectar que sea la misma si la manda dos veces.
- El número de trabajo **no se le muestra al vecino**. Es deliberado: al vecino no le sirve y lo
  único que hace es parecer un sistema. Él pregunta "¿cuándo viene el técnico?" y Marcos le contesta
  eso.
