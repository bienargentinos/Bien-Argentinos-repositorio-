# Guía de estilo y herramientas — Asistente del Panel de Marcos

> **Problema que resuelve este documento:** el asistente responde con bloques de texto largos y densos, sin separar ideas. Aburre, hace perder al usuario y baja la tasa de lectura completa. Esta guía da: (1) el diagnóstico, (2) reglas de formato obligatorias, (3) las "herramientas" (configuración) que hay que activar en la plataforma donde vive el asistente, (4) plantillas listas para usar, y (5) un checklist de control de calidad.

---

## 1. Diagnóstico

Cuando un asistente conversacional devuelve texto "en bloque" (sin saltos de línea, sin listas, sin jerarquía visual), casi siempre es por una de estas tres causas — **no por falta de capacidad del modelo, sino de configuración**:

| Causa | Cómo se detecta | Solución |
|---|---|---|
| El *system prompt* no exige formato | El texto de instrucciones no menciona listas, negritas ni longitud máxima | Reescribir el prompt (sección 4) |
| La plataforma no renderiza Markdown | Las respuestas muestran literalmente `**texto**` o `- item` en vez de negrita/viñetas | Activar renderizado Markdown en el widget/canal (ver sección 3) |
| No hay límite de extensión ni "trigger" para dividir en pasos | El modelo intenta resolver todo en un solo mensaje | Definir reglas de longitud y de corte en pasos (sección 2) |

**Conclusión práctica:** el modelo *sabe* estructurar; hay que decírselo explícitamente y asegurarse de que el canal donde corre pueda mostrar esa estructura. Ambas cosas se corrigen sin tocar código, desde la configuración del asistente.

---

## 2. Reglas de formato obligatorias

Estas son las reglas que debe cumplir **toda** respuesta del asistente, sin excepción:

1. **Nunca un párrafo de más de 3 líneas.** Si una idea necesita más espacio, se corta en varias oraciones cortas o se convierte en lista.
2. **Usar encabezados** (`##`, `###`) cuando la respuesta tiene más de un tema o sección.
3. **Usar listas numeradas** para pasos que se siguen en orden (ej. "cómo pagar las expensas").
4. **Usar viñetas** para enumerar opciones que no tienen un orden obligatorio (ej. "documentos que podés consultar").
5. **Negrita** solo en la palabra o frase clave de cada línea — no en oraciones enteras.
6. **Una idea por línea.** Si hay dos datos (por ejemplo, monto y fecha), van en líneas o columnas separadas, no en la misma oración.
7. **Tablas** cuando hay que comparar 2+ columnas de datos (montos, fechas, estados).
8. **Cierre accionable**: la respuesta termina con una pregunta corta o las próximas opciones ("¿Querés que...?"), nunca con un párrafo de relleno.
9. **Longitud máxima recomendada:** ~120 palabras por mensaje. Si el tema requiere más, se parte en varios mensajes ofreciendo continuar ("¿Seguimos con el paso 2?").
10. **Emojis: máximo 1 por bloque**, solo como marcador visual (📌 aviso, ✅ confirmado, ⚠️ atención) — nunca decorativos ni repetidos.

### Ejemplo — Mal (como responde hoy)

> Para poder abonar tus expensas podés hacerlo de varias maneras, una de ellas es por transferencia bancaria a la cuenta del consorcio que figura en el resumen mensual que se envía por mail, también podés pagarlo en efectivo en la administración de lunes a viernes de 9 a 17hs, y además existe la opción de pago con tarjeta a través del link de pago que se encuentra en la sección de pagos del panel, recordá que el vencimiento es el día 10 de cada mes y que después de esa fecha se aplican intereses por mora según lo establecido en el reglamento del consorcio.

### Ejemplo — Bien (con esta guía aplicada)

> ## Cómo pagar tus expensas
>
> Tenés **3 formas de pago**:
>
> 1. **Transferencia** — a la cuenta del consorcio (está en el resumen mensual por mail).
> 2. **Efectivo** — en administración, lunes a viernes de 9 a 17 h.
> 3. **Tarjeta** — con el link en la sección *Pagos* del panel.
>
> ⚠️ **Vencimiento: día 10.** Después se aplican intereses por mora.
>
> ¿Querés que te muestre el link de pago ahora?

---

## 3. "Herramientas" que necesita tener habilitadas

Esto es lo que probablemente falta activar en la plataforma donde corre el asistente del Panel de Marcos (chatbot builder, panel de administración, WhatsApp, etc.). Sin esto, aunque el texto tenga `**` o `-`, **no se va a ver estructurado**:

- [ ] **Renderizado de Markdown** en el widget de chat (negrita, listas, encabezados). Verificar en la configuración del canal/widget.
- [ ] **Soporte de saltos de línea reales** (que `\n\n` se muestre como párrafo separado y no se aplaste en una sola línea).
- [ ] **Quick replies / botones de opción rápida**, si la plataforma los soporta — para no obligar al usuario a leer todo y elegir escribiendo.
- [ ] **Mensajes multi-turno / partidos**, si la plataforma permite enviar la respuesta en más de un "burbuja" (mejor que un solo mensaje gigante).
- [ ] **Vista previa de tablas**, si se van a mostrar montos/fechas comparados (si el canal no soporta tablas, usar listas con formato `Concepto: valor`).

> Si alguna de estas casillas no se puede activar (por limitación del canal, ej. WhatsApp no soporta tablas ni encabezados), hay que **adaptar la plantilla de esa causa** usando solo lo que el canal sí soporta (negrita y viñetas simples suelen funcionar en casi todos).

---

## 4. Instrucciones de sistema (system prompt) — listas para copiar

Pegar esto en la configuración de instrucciones/personalidad del asistente del Panel de Marcos (reemplaza o complementa el prompt actual):

```
Sos el asistente del Panel de Marcos para consultas del consorcio.

REGLAS DE FORMATO (obligatorias en todas las respuestas):
- Nunca escribas párrafos de más de 3 líneas.
- Si la respuesta tiene más de una idea, usá encabezados y listas (numeradas para pasos, viñetas para opciones).
- Resaltá en negrita solo la palabra clave de cada línea, no oraciones completas.
- Si hay datos comparables (montos, fechas, estados), usá una tabla o formato "Concepto: valor" por línea.
- Terminá siempre con una pregunta corta o las próximas opciones, nunca con relleno.
- Extensión máxima recomendada: 120 palabras. Si el tema es más largo, dividilo en pasos y preguntá si el usuario quiere continuar.
- Máximo 1 emoji por respuesta, solo como marcador (📌 ⚠️ ✅), nunca decorativo.

TONO: claro, directo, cordial. Nada de rodeos ni frases de relleno ("como podrás notar", "es importante destacar que", etc.).

Si no tenés la información exacta, decilo en una línea y ofrecé derivar a administración — no inventes ni des rodeos para disimularlo.
```

---

## 5. Plantillas por tipo de consulta frecuente

Usar estas estructuras como base para las respuestas más comunes de un consorcio:

**Consulta de expensas / pagos**
```
## [Título corto]
1. [Paso 1]
2. [Paso 2]
⚠️ [Dato crítico: vencimiento, monto, etc.]
¿[Pregunta de cierre]?
```

**Reclamo / incidencia (ascensor, luz, ruidos, etc.)**
```
## Reclamo recibido: [tema]
✅ Registrado con el número **#[N]**.
- Se deriva a: [área/persona]
- Tiempo estimado de respuesta: [X]
¿Querés agregar una foto o más detalle?
```

**Consulta sobre reglamento / normas**
```
## [Tema del reglamento]
- [Punto clave 1]
- [Punto clave 2]
📌 Fuente: Reglamento interno, art. [N].
¿Necesitás el texto completo del artículo?
```

**Reserva de amenities (SUM, parrilla, etc.)**
```
## Reservar [amenity]
Disponible: **[fecha/horario]**
1. Confirmá el día.
2. Te mando el link/código de reserva.
¿Confirmás la fecha?
```

---

## 6. Checklist de control de calidad

Antes de dar por resuelto el cambio, probar el asistente con 5 preguntas típicas de vecinos y verificar que **cada respuesta** cumpla:

- [ ] Ningún párrafo supera 3 líneas.
- [ ] Hay al menos una lista o encabezado si el tema tiene más de un punto.
- [ ] No hay negrita en frases completas, solo en palabras clave.
- [ ] Termina con pregunta o próximos pasos, no con relleno.
- [ ] Se ve correctamente renderizado en el canal real (no aparecen `**` o `-` sueltos como texto plano).
- [ ] La respuesta completa se lee en menos de 15 segundos.

---

## 7. Anexo — Tutorial interactivo del panel (pendiente)

**Estado:** no pude corregirlo en esta sesión porque **el código del Panel de Marcos y su tutorial interactivo no están en este repositorio** (`Bien-Argentinos-repositorio-`). El repo actualmente solo contiene un `README.md` y un archivo vacío — no hay frontend, backend, ni configuración de ningún asistente o tutorial.

Para poder arreglarlo necesito uno de estos datos:

1. **El nombre del repositorio real** donde vive el panel (si es otro repo de GitHub, lo conecto a la sesión).
2. Si es una **plataforma externa** (Voiceflow, Chatbase, GPT personalizado, herramienta de onboarding tipo Intro.js/Shepherd.js embebida en una web, etc.), decime cuál para revisar su configuración.
3. Si podés, contame **qué pasa exactamente** cuando falla el tutorial: ¿no arranca, se traba en un paso, no avanza al hacer clic, no aparece el botón de "Siguiente", da error en consola?

Con cualquiera de esos tres datos puedo diagnosticar y corregir el tutorial en la próxima iteración.

**Causas más comunes de que un tutorial interactivo "no funcione"** (para descartar rápido si tenés acceso al código o a la plataforma):
- El flag que marca "tutorial visto" quedó guardado (localStorage/base de datos) y no se vuelve a mostrar.
- El selector de un elemento del paso (botón, campo) cambió de nombre/posición y el tutorial no lo encuentra.
- El overlay/paso no es visible por un problema de capas (z-index) o de responsive/mobile.
- El tutorial depende de un evento (ej. login, carga de datos) que dispara antes de que el tutorial esté listo para escucharlo.
