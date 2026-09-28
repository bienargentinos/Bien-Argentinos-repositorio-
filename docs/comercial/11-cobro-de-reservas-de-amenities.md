# A qué cuenta transfiere el vecino cuando reserva un espacio

> **Alcance de este documento.** Cubre **solo la parte de cobro** de las reservas de espacios
> comunes: qué datos de transferencia ve el vecino y de dónde salen. El resto del módulo de
> reservas (calendario, reglamentos, cupos) no está documentado todavía y **no debe describirse a
> partir de acá**.

## 1. ¿Qué problema resuelve?

Cuando un vecino reserva el SUM o la cochera de visitas y ese espacio tiene seña o arancel, tiene
que transferir. Y ahí aparece la pregunta que parece trivial y no lo es: **¿a qué cuenta?**

Hoy, en la mayoría de los consorcios, el vecino pregunta por WhatsApp, alguien le contesta un alias
de memoria, y el que administra reza que se lo hayan dado bien. El riesgo real es conocido: un alias
mal copiado, o peor, uno que alguien pasó por un grupo y nadie verificó.

El sistema muestra los datos de transferencia del consorcio en la misma pantalla donde se reserva, y
—esto es lo importante— **cuando no los tiene cargados, lo dice, en lugar de mostrar algo que se
parezca a una cuenta.**

## 2. ¿Cómo funciona en la práctica?

El vecino elige el espacio y la fecha. Si tiene costo, la pantalla le muestra el importe y, debajo,
los datos para transferir del consorcio: titular, alias y CBU, cada uno con un botón para copiar,
así no los tipea a mano (que es donde se equivoca cualquiera con 22 dígitos).

Después adjunta el comprobante y la reserva queda registrada para que la Administración la vea.

### Cuando los datos no están cargados

La pantalla muestra un aviso: que la Administración todavía no cargó los datos para transferir, y
**que no transfiera a ningún alias que no le haya dado ella**. No aparece ningún titular, ningún
banco, ningún alias ni ningún CBU.

Esto es deliberado y vale la pena explicarlo en una demostración, porque es contraintuitivo: **un
sistema que “completa” un dato de pago que no tiene es peor que uno que admite no tenerlo.** Un dato
de transferencia aproximado tiene dos finales: el dinero no llega, o llega a otra persona. El
segundo no se puede deshacer.

> **Esto es una corrección de algo que estaba mal, y se cuenta así.** Hasta el 28/09/2026 el sistema,
> cuando no encontraba los datos del consorcio, componía un alias a partir del nombre del edificio y
> lo mostraba con botón de copiar. Se encontró revisando registros del servidor, se corrigió, y
> quedó una prueba automática que impide que vuelva. Lo contamos porque es exactamente el tipo de
> detalle que un administrador con experiencia pregunta, y porque la respuesta —“lo encontramos
> nosotros y lo cerramos”— dice más que afirmar que nunca pasó nada.

## 3. Argumentos comerciales

**El dato de pago se muestra o no se muestra: no se aproxima.** Es una decisión de diseño, no una
limitación. En un edificio, el único error de cobro que importa es el que manda la plata a otra
cuenta, y ese no se arregla con una disculpa.

**Menos idas y vueltas por WhatsApp.** El vecino que reserva tiene los datos en la misma pantalla, y
el botón de copiar evita el error de tipeo en un CBU de 22 dígitos.

**Queda el comprobante junto a la reserva.** La Administración no tiene que cruzar una captura
suelta de un chat con una reserva de hace tres días.

## 4. Guion base para video / reel / publicidad

> *(0-6s — pantalla del celular, reserva del SUM)*
> **Voz:** Reservás el SUM desde el celular. Tiene seña, y los datos para transferir están ahí
> mismo: titular, alias y CBU, con un toque para copiar.
>
> *(7-14s — se toca "Copiar" y se ve el alias copiado)*
> **Voz:** Sin preguntar por WhatsApp, sin dictar veintidós números.
>
> *(15-24s — la pantalla mostrando el aviso ámbar, sin ninguna cuenta)*
> **Voz:** Y si la Administración todavía no los cargó, el sistema te lo dice. No te inventa una
> cuenta. Porque una transferencia a la cuenta equivocada no se deshace.
>
> *(25-30s — logo)*
> **Cierre:** Bien Argentinos. Los datos de pago se muestran o no se muestran. No se aproximan.

**Copy corto, para pie de imagen:**

> Reservás el espacio y los datos para transferir están en la misma pantalla, con botón de copiar.
> Y si el consorcio todavía no los cargó, te lo dice — en lugar de mostrarte una cuenta inventada.

## Lo que todavía no hace

- **No hay pantalla en el panel para que la Administración cargue esos datos.** El sistema ya sabe
  leerlos y mostrarlos, pero la pantalla de carga está pendiente, así que **hoy todos los edificios
  ven el aviso de "no cargados"**. Es el estado correcto y no un fallo, pero **no se puede demostrar
  la pantalla con datos reales todavía**: mostrarla en una demo requiere cargar la cuenta a mano en
  la base.
- **El CBU que se cargue ahí no se valida matemáticamente**, como sí se hace con el del proveedor.
  Está identificado y pendiente. **No afirmar que "el sistema valida el CBU del consorcio".**
- **El sistema no verifica la transferencia.** El vecino adjunta el comprobante y la Administración
  lo mira; no hay conciliación automática con el banco.
- **No emite factura ni recibo** por la seña o el arancel.
