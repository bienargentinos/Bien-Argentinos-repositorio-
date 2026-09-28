# Coordinación Inteligente y Cierre de Trabajos con Técnicos por WhatsApp

---

## 1. ¿Qué problema resuelve?
El seguimiento de proveedores y service de mantenimiento es uno de los mayores focos de estrés para la administración:
- El técnico va al edificio, repara el problema, pero nunca avisa a tiempo si terminó o si quedó algo pendiente.
- Si un técnico atiende varios casos en el mismo consorcio (ej: un plomero que tiene que revisar dos departamentos diferentes), los sistemas tradicionales se marean, le mandan la foto equivocada o le mezclan los horarios prometidos a los vecinos.
- Los teléfonos personales de los vecinos terminan circulando entre proveedores sin ningún control ni privacidad.
- Cuando el técnico termina el trabajo y escribe *"ya terminé"*, sistemas torpes le vuelven a mandar la orden de trabajo o las fotos viejas como si el caso siguiera abierto.

**Con este módulo:** Marcos IA dialoga con el técnico por WhatsApp de forma natural. Identifica con precisión a qué trabajo corresponde cada respuesta, le entrega fotos y datos de acceso solo cuando corresponde, comprende inmediatamente frases como *"ya terminé"* o *"finalicé"* para cerrar el reclamo y notificar a la administración, y jamás le promete una hora inventada al vecino.

---

## 2. ¿Cómo funciona en la práctica?

1. **Asignación Automática:** Cuando un vecino reporta un problema (ej: pérdida de agua), Marcos identifica el rubro y contacta automáticamente al plomero designado por el consorcio.
2. **Entrega de Material y Acceso Seguro:**
   - Marcos le envía al técnico las fotos o videos que mandó el vecino.
   - Si el técnico pregunta cómo ingresar, Marcos le brinda la instrucción pactada con la administración (ej: *"tocar timbre en portería"* o el contacto de quien le abre) sin divulgar información innecesaria.
3. **Coordinación Inteligente sin Confusiones:**
   - Si el técnico atiende dos trabajos a la vez, Marcos separa los casos por rubro y por teléfono, evitando mezclar una reparación eléctrica con una de plomería.
   - Marcos nunca inventa horas de llegada: solo informa al vecino el tiempo estimado cuando el técnico lo confirma explícitamente para ese trabajo en particular.
4. **Cierre Inmediato por Lenguaje Natural:**
   - Cuando el técnico finaliza la tarea, escribe por WhatsApp: *"Listo, ya terminé acá"*.
   - Marcos comprende el contexto, cierra el caso en el sistema, frena los reenvíos de fotos y registra la resolución para que el administrador la vea en el panel con fecha y hora exacta.

---

## 3. Argumentos comerciales (Puntos de venta)
- **Trazabilidad en tiempo real sin llamadas:** La administración ya no tiene que llamar al técnico a las 19:00 hs para preguntar *"¿fuiste al edificio de San Patricio?"*. Marcos lo acompaña por chat y registra el estado automáticamente.
- **Protección de la privacidad del vecino:** El proveedor no recibe el número personal del copropietario salvo que la administración lo autorice para el acceso puntual.
- **Cada respuesta va al trabajo correcto:** si el técnico tiene dos trabajos abiertos, Marcos no adivina a cuál se refiere: se lo pregunta mostrándole la lista por dirección y número de caso. Equivocarse ahí reparte el gasto entre dos consorcios.
- **Atención inmediata las 24 horas:** Si una emergencia ocurre un domingo a la noche, Marcos contacta al técnico de guardia en segundos sin que el administrador deba interrumpir su descanso.

---

## 4. Guion base para video / reel / publicidad

**[Visual]:** Administrador cenando tranquilo un viernes a la noche mientras su teléfono recibe una notificación automática de Marcos: *"Caso 1005 resuelto: plomero finalizó reparación en San Patricio"*.  
**[Locución / Copy]:**  
*"Viernes 8 de la noche. Se rompió un caño en un consorcio.*  
*Con la administración tradicional: 10 llamadas perdidas, buscar el teléfono del plomero, pedirle fotos al vecino y perseguir al técnico hasta la medianoche para saber si fue.*  
*Con Marcos IA: el vecino reporta por WhatsApp, Marcos le manda las fotos al plomero de guardia, coordina el ingreso y cuando el técnico dice 'ya terminé', el caso se cierra solo.*  
*El consorcio cuidado las 24 horas, y vos disfrutando de tu fin de semana.*  
*Esto no es el futuro, es Marcos IA. Sumá tu edificio hoy."*

---

## 5. Lo que todavía no hace

> Escrito el 27/09 por el chat del motor. Es lo que evita prometer de más en una demo.

- **En una línea telefónica compartida por dos técnicos** —un plomero y un electricista de la misma
  empresa, con el mismo número— Marcos puede saludar con un nombre en la plantilla y con el otro en
  los mensajes siguientes. Pasó en el chat real del 26/09: la plantilla decía *"Hola julio"* y 48
  minutos después *"Dario"*, la misma persona. **Está identificado y congelado a propósito** por
  decisión de Daniel del 27/09: hoy el único teléfono de prueba tiene los dos técnicos cargados
  encima, así que cualquier regla que se escriba estaría hecha contra el banco de pruebas y no
  contra la realidad. Se retoma cuando haya dos líneas de verdad.
  - **Lo que sí funciona** es la separación por rubro: un trabajo de plomería y uno de electricidad
    no se mezclan en un mismo caso.
- **Si el técnico manda la factura junto con el "ya terminé"**, el trabajo no se cierra con ese
  mensaje. Es deliberado: un comprobante suele ser de **otra** obra, y cerrar el equivocado cuesta
  más que esperar. Se cierra con el mensaje siguiente.
- **Marcos no le muestra al vecino el número de caso.** Al vecino no le sirve y lo único que hace es
  parecer un sistema.
- **Los avisos por mail a la administración dependen de que el servidor de mail esté configurado.**
  *(Agregado el 28/09 por el chat del motor.)* Si el mail no conecta, Marcos lo avisa al arrancar,
  en el registro técnico: al administrador no le llega ningún aviso de que el mail no está saliendo.
  El WhatsApp al administrador, si lo tiene prendido en el panel, no depende del mail y sigue
  saliendo.
