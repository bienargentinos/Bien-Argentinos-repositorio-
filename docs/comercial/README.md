# Documentación Comercial, Soporte y Capacitación

> **Directiva del Proyecto (27/09/2026):**
> Cada vez que se finalice una mejora, módulo o corrección en el sistema (Marcos IA, Edifica o Panel Dash), además de registrar el cambio técnico en la documentación habitual del proyecto (`docs/para-el-motor.md`, `docs/para-antigravity.md`, `docs/de-antigravity.md`), se debe generar y commitear un archivo `.md` en esta carpeta (`docs/comercial/`).
>
> **Regla de oro:** Siempre sincronizado vía Git / GitHub (nunca ediciones directas en el VPS).

---

## 🎯 Objetivo
Construir una base documental comercial, operativa y real para:
1. Salir a comercializar el servicio masivamente a Administraciones de Consorcios y Edificios.
2. Armar tutoriales interactivos, videos instructivos y guías de onboarding sin inventar datos ni funciones inexistentes ("cero humo").
3. Diseñar piezas publicitarias (reels, copies, anuncios) basadas estrictamente en dolores operativos reales ya resueltos en producción.

---

## 📋 Estructura Obligatoria de cada `.md`

Cada archivo nuevo en esta carpeta debe adoptar el nombre de la funcionalidad (ejemplo: `01-avisos-al-edificio.md`) y respetar rigurosamente los 4 bloques:

### 1. ¿Qué problema resuelve?
- Explicado en lenguaje simple, directo y comercial.
- Sin jerga técnica de código ni nombres de funciones.
- Enfocado desde el dolor del **Administrador del Consorcio** o del **Vecino / Propietario**.

### 2. ¿Cómo funciona en la práctica?
- El paso a paso visual en el Panel de Gestión o la interacción en el chat de WhatsApp.
- Qué hace el usuario, qué responde Marcos y qué ve la comunidad.

### 3. Argumentos comerciales (Puntos de venta)
- Dolores operativos concretos que soluciona:
  - Ahorro de horas hombre en llamadas y mensajes repetitivos.
  - Trazabilidad y control transparente de técnicos y proveedores.
  - Cero filtraciones de números privados y tranquilidad 24/7.
  - Reducción de la morosidad y reclamos desatendidos.

### 4. Guion base para video / reel / publicidad
- Síntesis directa para usar como locución o copy en Instagram / LinkedIn / Ads.
- Gancho (Hook) -> Problema -> Solución Marcos -> Llamado a la acción (CTA).
- 100% verídico sobre lo que el sistema realmente hace hoy.

### 5. Lo que todavía no hace

**Obligatoria cuando aplica.** No es una debilidad del documento: es lo que lo hace usable, porque
**quien vende necesita saber dónde no pisar**. Un vendedor que promete de más en una demo no pierde
una función: pierde el cliente y la credibilidad de todo lo demás.

---

## 🚫 Cómo se cumple lo de "cero humo" (los tres cerrojos)

El objetivo dice "sin inventar datos ni funciones inexistentes". Eso es una intención; esto es cómo
se verifica. **Son tres, y no son negociables:**

### 1. Todo lo que se afirma tiene que estar andando HOY en producción

Antes de escribir una línea de venta hay que poder señalar **dónde está andando**: la prueba que la
cubre (`node pruebas-*.js`), la línea del log, o la conversación real donde se vio. Si está a
medias, va en *"Lo que todavía no hace"*.

> **El caso que obligó a escribir esta regla.** El documento 03 decía *"Sistema blindado contra
> errores en cuadrillas o técnicos que comparten líneas telefónicas"*. En `CLAUDE.md` ese tema está
> **CONGELADO** por decisión de Daniel del 27/09, y en el chat real de esa misma semana la plantilla
> saludó *"Hola julio"* y los mensajes siguientes decían *"Dario"* — la misma persona, dos nombres,
> con 48 minutos de diferencia. Vender eso como blindado se descubre en la primera demo.

### 2. Los ejemplos salen de conversaciones reales

Y cuando hay que armar uno para explicar, **se dice que es armado**. Un chat inventado presentado
como real es exactamente el humo que esto viene a evitar.

### 3. Ningún número ni absoluto sin respaldo

- **Nada de números sin medición**: *"ahorra 5 horas por semana"*, *"reduce un 40% los reclamos"*.
  Se puede decir qué trabajo deja de hacer una persona; no se le puede poner un número que nadie
  contó.
- **Cuidado con los absolutos**: *"cero"*, *"100%"*, *"nunca más"*, *"jamás"*, *"blindado"*,
  *"sin fisuras"*. Casi siempre son más fuertes que lo que el sistema puede sostener, y son los
  primeros que un administrador desconfiado va a poner a prueba. Se reemplazan por lo que sí se
  puede defender: en vez de *"cero órdenes fallidas"*, **"Marcos prefiere preguntar antes que
  mandar al técnico a la dirección equivocada"** — que es lo que de verdad hace.

---

## 📎 Cómo se relaciona con el resto de la documentación

| Archivo | Para quién | Qué guarda |
|---|---|---|
| `CLAUDE.md` | los agentes que escriben código | **el porqué técnico**: qué se rompió, cómo, y qué candado lo evita |
| `docs/comercial/` (esto) | ventas, soporte, tutoriales | **el porqué comercial**: qué problema del edificio resuelve |
| `docs/para-el-tutorial.md` | el chat de la guía del panel | solo decisiones y motivos, y **no se mantiene al día a propósito** |

**El del tutorial sigue sin mantenerse al día** --decisión de Daniel, 26/09, porque el panel todavía
cambia varias veces por semana-- pero **esta carpeta sí**. La diferencia es que acá se escribe en el
momento en que la mejora se termina, que es cuando el motivo está fresco y el chat real está a mano;
el tutorial se arma al final, y cuando llegue ese día **va a leer esta carpeta** en vez de
reconstruir todo de memoria.

---

## 📚 Índice

| Documento | De qué se trata |
|---|---|
| [`01-avisos-al-edificio.md`](01-avisos-al-edificio.md) | Comunicados oficiales al edificio, con vencimiento automático |
| [`02-subida-tanda-expensas.md`](02-subida-tanda-expensas.md) | Subida masiva de expensas con lectura automática y auditoría |
| [`03-coordinacion-y-cierre-tecnicos.md`](03-coordinacion-y-cierre-tecnicos.md) | Coordinación y cierre de trabajos con el técnico por WhatsApp |
| [`04-contexto-multipropiedad-vecinos.md`](04-contexto-multipropiedad-vecinos.md) | El vecino con casa y oficina en edificios distintos, con un solo teléfono |
| [`05-numero-de-caso-y-facturas.md`](05-numero-de-caso-y-facturas.md) | De qué obra es cada factura: el número de trabajo en cada mensaje |
| [`06-expensas-en-el-celular-del-vecino.md`](06-expensas-en-el-celular-del-vecino.md) | Lo que el vecino ve de su expensa, y lo que no ve de la del vecino |
| [`07-portal-en-cuatro-idiomas.md`](07-portal-en-cuatro-idiomas.md) | El portal en castellano, inglés, portugués y francés |
| [`08-pases-qr-visitas-y-proveedores.md`](08-pases-qr-visitas-y-proveedores.md) | El vecino le hace un pase a su visita desde el celular |
| [`09-avisos-en-el-portal-y-popup.md`](09-avisos-en-el-portal-y-popup.md) | El aviso del edificio del lado del vecino, y el recordatorio de inicio |
| [`10-proteccion-antifraude-cbu-proveedores.md`](10-proteccion-antifraude-cbu-proveedores.md) | Datos de cobro del proveedor: validación matemática de CBU y cerrojo antifraude en cambios de cuenta |
| [`11-cobro-de-reservas-de-amenities.md`](11-cobro-de-reservas-de-amenities.md) | A qué cuenta transfiere el vecino al reservar un espacio, y por qué no se inventa cuando falta |
| [`DOSSIER_GENERAL_MARCOS_IA_Y_PORTAL.md`](DOSSIER_GENERAL_MARCOS_IA_Y_PORTAL.md) | Resumen general de los productos |

---

## 🧾 Lo que falta escribir (deuda anotada, para no perderla)

La directiva rige **de acá en adelante**, así que varias cosas ya terminadas no tienen su documento:
los datos de cobro del proveedor con verificación de CBU, las reservas de amenities, la ventana de
24 horas de WhatsApp y el seguimiento automático de los reclamos.

> **Del 06 al 09 se saldó una parte** (27/09, del chat del portal): el portal del vecino y la
> portería con QR ya tienen los suyos. Se escribieron desde la conversación que hizo esos
> módulos, que es la única que sabe qué hacen de verdad.

**No se escriben todos de una**: un lote grande escrito de memoria es justo donde se cuela el humo.
Se van haciendo de a uno, cuando se toque cada módulo o cuando Daniel lo pida.

---

## Tres reglas más, agregadas el 27/09 desde el chat del portal

- **Cada conversación escribe los documentos de SUS módulos.** Quien hizo el módulo es el único que
  sabe qué hace de verdad y qué no. Documentar el módulo de otro es exactamente cómo se escribe humo
  sin querer, y es lo que ya pasó una vez acá: el primer lote afirmaba que un tema estaba resuelto
  cuando en `CLAUDE.md` figura como congelado.
- **Una corrección chica no lleva archivo nuevo**: se agrega al documento del módulo que corrige.
  Si no, la carpeta termina con cuarenta archivos y el índice deja de servir.
- **Las siglas internas no se escriben acá.** Entre nosotros **AC** es el administrador cliente y
  **AY** es Antigravity; el cliente no conoce ninguna de las dos. En estos documentos se dice
  "el administrador".

### Cuando dos documentos tocan el mismo tema, se cruzan en vez de competir

Ya pasó con dos pares, y va a volver a pasar porque el panel y el portal son **los dos lados del
mismo módulo**:

| Un lado | El otro |
|---|---|
| `01` — el administrador publica el aviso | `09` — lo que el vecino ve, y cómo lo apaga |
| `02` — el administrador sube la tanda de expensas | `06` — lo que el vecino ve de la suya |

**El que se escribe segundo enlaza al primero y no le repite el contenido.** Dos documentos
contando lo mismo con palabras distintas es como se termina vendiendo dos versiones de la misma
función.
