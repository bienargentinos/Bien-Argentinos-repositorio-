# Qué pasa con los archivos que sube el vecino

> **Alcance.** Cubre cómo el sistema trata los archivos que sube una persona desde el portal: la foto
> de perfil y los comprobantes de pago. No describe el resto del portal.

## 1. ¿Qué problema resuelve?

Un portal donde los vecinos suben archivos recibe, antes o después, un archivo que no es lo que dice
ser. No hace falta mala intención organizada: basta una persona curiosa, o un conocido con ganas de
probar.

El riesgo concreto no es el archivo en sí, es **dónde queda guardado**. Si el sistema acepta
cualquier archivo y después lo sirve desde su propia dirección web, ese archivo pasa a tener la misma
confianza que el sistema. Un archivo que el navegador interpreta como una página —en lugar de
mostrarlo como una foto— puede actuar en nombre de quien lo abre: pedir cosas al sistema con la
sesión de esa persona. Si quien lo abre es el administrador, actúa como el administrador.

## 2. ¿Cómo funciona en la práctica?

El vecino elige una foto desde el celular y la sube. El sistema **no acepta el archivo por su
nombre**: decide por el tipo real que declara el dispositivo, contra una lista cerrada de formatos de
imagen. Si el archivo no es una imagen, **se rechaza antes de guardarse** y el vecino ve un mensaje
que lo dice.

Para los comprobantes de pago la lista es la misma más PDF, porque un comprobante llega de las dos
maneras.

Tres decisiones que vale la pena poder explicar:

- **El nombre del archivo nunca decide nada.** El sistema le pone su propio nombre y su propia
  extensión. Lo que venga escrito en el archivo original se descarta.
- **Las imágenes vectoriales (SVG) no se aceptan**, aunque técnicamente sean imágenes: son el único
  formato de imagen que puede contener instrucciones ejecutables.
- **Las fotos de iPhone sí se aceptan.** Muchos teléfonos no declaran correctamente el tipo de
  archivo; el sistema tiene una salida para ese caso sin abrir la puerta a los demás, porque
  rechazar de más significa que medio edificio no puede subir su foto.

> **Esto es una corrección de algo que estaba mal, y se cuenta así.** Hasta el 2 de octubre de 2026
> el sistema tomaba la extensión del nombre que mandaba el navegador, lo que permitía guardar un
> archivo que el navegador luego interpretaba como página. Se encontró en una revisión interna,
> **antes de que el sistema estuviera en uso por clientes reales**, se verificó reproduciéndolo, se
> corrigió, y quedó una prueba automática que impide que vuelva. Lo contamos porque un administrador
> con experiencia pregunta por esto, y "lo encontramos nosotros y lo cerramos" es una respuesta mejor
> que afirmar que nunca pasó nada.

## 3. Argumentos comerciales

**Lo que sube un vecino no puede convertirse en una página del sistema.** Es la diferencia entre
guardar archivos y aceptar cualquier cosa. En un portal de consorcio, donde la misma dirección web
sirve el acceso del administrador, esa distinción es la que importa.

**Se rechaza antes de guardar, no después.** Un archivo que no corresponde no llega a ocupar espacio
ni a quedar en ninguna carpeta.

**Y cuando se rechaza, el vecino entiende por qué.** No es una pantalla en blanco ni un error
genérico: dice qué pasó.

## 4. Guion base para video / reel / publicidad

> *(0-7s — el vecino elige una foto en el celular y aparece en su perfil)*
> **Voz:** El vecino sube su foto de perfil desde el celular. Simple.
>
> *(8-16s — se intenta subir un archivo que no es imagen y aparece el aviso)*
> **Voz:** Y si lo que se sube no es una imagen, el sistema no lo guarda. Lo rechaza y lo dice.
>
> *(17-26s — texto sobre fondo)*
> **Voz:** Porque en un portal de consorcio, la misma dirección sirve el acceso del administrador. Lo
> que sube un vecino no puede convertirse en una página del sistema.
>
> *(27-32s — logo)*
> **Cierre:** Bien Argentinos. Guardamos archivos, no cualquier cosa.

**Copy corto, para pie de imagen:**

> El vecino sube su foto y listo. Y si el archivo no es una imagen, no se guarda: el sistema decide
> por el tipo real, no por el nombre.

## Lo que todavía no hace

- **Falta aplicar el mismo criterio en tres subidas del panel del administrador** (archivos adjuntos,
  foto de perfil del panel y expensas). Está identificado y pedido; **hasta que esté, no afirmar que
  "todas las subidas del sistema" están cubiertas** — decirlo del portal del vecino, que es donde ya
  es cierto.
- **El sistema no analiza el contenido del archivo**, solo su tipo declarado y el formato permitido.
  No hay antivirus ni inspección del interior de la imagen.
- **No hay límite de cuántas fotos puede subir un vecino**, solo de tamaño por archivo.
- **Las fotos no se recortan ni se reducen** al subirlas, así que una foto de celular moderna ocupa
  lo que ocupa.
