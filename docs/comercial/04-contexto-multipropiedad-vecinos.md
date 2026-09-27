# Gestión de Múltiples Propiedades y Reconocimiento de Contexto en Vecinos

---

## 1. ¿Qué problema resuelve?
Muchos propietarios e inquilinos tienen más de una unidad administrada bajo el mismo sistema (por ejemplo: viven en un edificio y tienen una oficina, cochera o local en otro consorcio diferente):
- En chatbots tradicionales, el sistema se confunde: si el usuario reporta *"se rompió el caño del baño"*, el bot le carga el reclamo al primer edificio que encuentra en su lista, enviando al plomero al lugar equivocado.
- Otros sistemas obligan al usuario a recordar códigos mecánicos de 10 dígitos o números de cliente antes de poder hablar, arruinando la experiencia del vecino.
- Además, si el vecino reporta algo refiriéndose a una altura o piso (ej: *"se cortó la luz en el piso 4"*), bots sin comprensión semántica confunden el número "4" con la dirección de otro consorcio.

**Con este módulo:** Marcos IA analiza inteligentemente el contexto del mensaje, la conversación previa y el sentido humano de lo que se escribe. Si el vecino nombra una calle o hace referencia a su departamento de vivienda o a su oficina, Marcos reconoce de qué lugar está hablando sin mezclar consorcios, y si existe alguna duda genuina, consulta educadamente antes de derivar al técnico.

---

## 2. ¿Cómo funciona en la práctica?

1. **Reconocimiento Natural por Nombre de Consorcio o Calle:**
   - Si el vecino escribe: *"Hola Marcos, en la oficina de San Patricio 159 no funciona el portero eléctrico"*, Marcos identifica automáticamente el edificio específico sin preguntarle nada adicional.
2. **Seguimiento del Hilo de Conversación:**
   - Si el vecino viene hablando de un tema puntual en su departamento y luego agrega: *"el técnico puede venir mañana después de las 15"*, Marcos mantiene el reclamo dentro del mismo consorcio en curso sin saltar abruptamente a su otra propiedad.
3. **Descarte Inteligente de Números Engañosos:**
   - Si el vecino dice *"hay olor a gas en el 4° B"*, Marcos entiende que "4" es el piso, no la altura catastral de otro edificio.
4. **Pregunta Clarificadora ante la Duda:**
   - Si el vecino dice únicamente *"no tengo agua caliente"* y tiene propiedades en dos edificios distintos sin contexto previo que permita deducirlo, Marcos le responde con amabilidad: *"Hola Daniel, ¿este reclamo corresponde a tu departamento de San Patricio 159 o al de San Patricio 270?"*.

---

## 3. Argumentos comerciales (Puntos de venta)
- **Experiencia humana y sin fricción:** Los vecinos no tienen que memorizar números de contrato, códigos de barras ni ingresar a menús numéricos tipo "Marque 1 para...".
- **Marcos prefiere preguntar antes que mandar al técnico a la dirección equivocada:** cuando no está seguro de cuál de los dos edificios es, pregunta. Una pregunta de más molesta un segundo; una visita a la puerta equivocada cuesta el viaje y la relación con el proveedor.
- **Cuanto más grande la administración, más aparece el caso:** a medida que suma edificios, crece la cantidad de vecinos con unidades en más de uno. Es un problema que el administrador de un solo consorcio no tiene, y el de veinte tiene todas las semanas.
- **Tranquilidad para el Administrador:** Se terminan los reclamos cruzados entre consorcios distintos.

---

## 4. Guion base para video / reel / publicidad

**[Visual]:** Un propietario que tiene su vivienda en un consorcio y una oficina en otro, mandando un mensaje por WhatsApp mientras viaja en auto.  
**[Locución / Copy]:**  
*"Tus vecinos son humanos: tienen su casa, quizás una cochera o una oficina en otro edificio de tu misma administración.*  
*¿Sabés qué hace un chatbot común cuando le dicen 'hay humedad en la pared'? Le manda el plomero al edificio equivocado.*  
*Marcos IA no es un bot de opciones: entiende contexto, lee la conversación y sabe exactamente a qué propiedad se refiere cada mensaje.*  
*Y si alguna vez tiene una duda real, pregunta como una persona educada antes de enviar al técnico.*  
*Dale a tus consorcios una atención de primer nivel. Incorporá Marcos IA a tu administración."*

---

## 5. Lo que todavía no hace

> Escrito el 27/09 por el chat del motor. Es lo que evita prometer de más en una demo.

- **El vecino tiene que estar cargado en los dos edificios** para que Marcos sepa que son suyos. Si
  figura en uno solo, el reclamo del otro no tiene a dónde ir hasta que el administrador lo cargue.
- **No hay aviso al administrador de que ese vecino escribió desde otro edificio.** El reclamo queda
  bien imputado, pero nadie le señala que la persona pasó de un consorcio al otro.
- **Cuando el vecino nombra una calle donde el administrador tiene dos consorcios y no dice la
  altura, Marcos pregunta.** Es lo correcto, pero conviene aclararlo en una demo: el administrador
  de un solo edificio no ve nunca esa pregunta, y si aparece sin contexto parece que "no entiende".
