# ⛔ REGLAS INMUTABLES Y OBLIGATORIAS DE MARCOS IA ⛔
> **ATENCIÓN PARA CUALQUIER ASISTENTE O DESARROLLADOR (Claude, Copilot, Gemini, ChatGPT, etc.):**
> **ESTAS REGLAS SON INVIOLABLES. BAJO NINGUNA CIRCUNSTANCIA SE DEBEN MODIFICAR, RELAJAR O ALTERAR LAS SIGUIENTES DIRECTRICES EN EL CÓDIGO.**

---

## 1. 🏢 IDENTIFICACIÓN DE EDIFICIOS (AISLAMIENTO STRICTO 100%)
- **Regla de Oro:** Cada edificio registrado en Google Sheets es un **universo totalmente aislado**.
- **Ajuste de Coincidencia:** Un mensaje se asocia a un edificio **ÚNICAMENTE** si contiene el **Nombre**, la **Dirección exacta** o un **Alias propio** perteneciente al registro de ese edificio en Google Sheets.
- **Prohibición de Solapamiento por Calle:** Si dos o más edificios comparten el mismo nombre de calle (ej. *San Patricio 159* y *San Patricio 270*):
  - La altura `159` pertenece **EXCLUSIVAMENTE** a `san patricio casa` (Dirección: *SAN PATRICIO 159*).
  - La altura `270` pertenece **EXCLUSIVAMENTE** a `san patricio 27'0 casa` (Dirección: *san patricio 270*).
  - **NUNCA** cruzar los datos de un edificio a otro por compartir parte de la calle. Si la persona dice "159", jamas se debe asociar a "270" ni viceversa.

---

## 2. 🎙️ LÍMITE DE AUDIOS (NOTAS DE VOZ) Y COSTOS
- **Límite:** Máximo **2 notas de voz (TTS)** por chat en una ventana de 24 horas.
- **Enforcement:** Si el usuario, proveedor o cliente envía un 3er audio dentro de las 24 horas, Marcos **DEBE RESPONDER OBLIGATORIAMENTE EN TEXTO PLANO** para optimizar los costos de síntesis de voz.

---

## 3. ⏳ TIEMPO DE ESPERA Y ACUMULACIÓN (15 SEGUNDOS)
- **Acumulación:** Marcos debe esperar **15 segundos** (`15000 ms`) acumulando mensajes o audios correlativos del mismo usuario.
- **Respuesta Única:** Prohibido responder a cada mensaje individualmente de forma inmediata. Se debe consolidar todo el contexto en un único mensaje claro y empático.

---

## 4. 🏷️ FORMATO DE CASOS Y PROHIBICIÓN DE CIERRES MASIVOS
- **Identificador de Caso:** Los reclamos usan el formato `[CASO-XXXX]` (ej: `[CASO-1234]`).
- **Cierre Especificado:** Si un técnico o cliente dice *"ya está listo"*, *"terminé"*, *"ya se arregló"*:
  - **PROHIBIDO** cerrar masivamente todos los casos abiertos del edificio.
  - Si hay más de 1 caso abierto, Marcos **DEBE INDAGAR** a cuál `[CASO-XXXX]` específico corresponde la reparación antes de proceder al cierre.

---

## 5. 🤝 TONO Y EMPATÍA
- **Trato:** Formal, educado, respetuoso y de "usted".
- **Límites:** Empático pero **nunca confianzudo**.

---
*Documento guardado y ratificado en el repositorio oficial de Marcos IA.*
