# 📊 REPORTE DE ARQUITECTURA, DIAGNÓSTICO Y FLUJO DE COMUNICACIÓN — MARCOS IA

> **Propósito de este documento:** Presentar un diagnóstico profundo, transparente y estructurado sobre la arquitectura actual de **Marcos IA** (Asistente Virtual para Administraciones de Consorcios), sus flujos de conversación tripartita (**Vecino ⇄ Marcos ⇄ Proveedor / Encargado ⇄ Administración**), sus puntos de dolor de comunicación humana y los protocolos ejecutivos desplegados.

---

## 1. 🎯 VISIÓN DEL PRODUCTO: ¿QUÉ ES Y CÓMO DEBE FUNCIONAR MARCOS IA?

Marcos IA no es un chatbot rígido de opciones numéricas. Es un **agente operativo conversacional y pensado para la vida real de un consorcio de edificios**.

### El Flujo Multicanal Fundamental:
1. **Vecino (Cliente final):** Contacta por WhatsApp para reportar un problema.
   - *Comportamiento:* Identificación cálida (Nombre + Depto + Edificio), escucha activa (texto o nota de voz), atención empática con la fórmula de 3 pasos y consulta preventiva en arreglos menores para cuidar las expensas sin arriesgar la seguridad.
   - *Límite de Voz de Marcos:* Máximo **2 respuestas en nota de voz por ventana móvil de 24 horas**. Si el vecino envía más audios dentro de ese periodo, Marcos responde automáticamente por texto para optimizar costos de ElevenLabs.
2. **Proveedor / Técnico Asignado (Solucionador):** Recibe la notificación del caso.
   - *Comportamiento:* Notificación con datos concretos (Edificio, Dirección exacta de calle, Depto, Falla reportada). Diálogo profesional, entrega inmediata de dirección si la pregunta, solicitud activa de fotos al vecino y exigencia de confirmación de horario (ETA).
3. **Administración de Consorcios (Modo AC - Autoridad Ejecutiva):**
   - *Comportamiento:* Reconocimiento automático de la línea en la pestaña `CLIENTES`. Marcos le otorga **privilegios ejecutivos directos por WhatsApp** (reiterar llamados a técnicos, cerrar casos, enviar lista de eventos pendientes o reenviar documentos/expensas en PDF directamente a los vecinos).

---

## 2. 🏛️ ARQUITECTURA TÉCNICA ACTUAL

El sistema corre en un servidor VPS Ubuntu con Node.js, PM2 y la API de Meta WhatsApp Cloud API.

```
                    ┌─────────────────────────┐
                    │ WhatsApp Cloud API Meta │
                    └────────────┬────────────┘
                                 │ Webhook (POST)
                                 ▼
                    ┌─────────────────────────┐
                    │    index.js (Express)   │
                    │   Orquestador Central   │
                    └────────────┬────────────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
┌──────────────┐        ┌─────────────────┐        ┌─────────────────┐
│ marcos-caso  │        │   marcos-cara   │        │   marcos-ops    │
│  (Evaluador  │        │ (Conversacional │        │  (Plantillas &  │
│  JSON IA)    │        │  Gemini 2.5)    │        │    WhatsApp)    │
└──────────────┘        └─────────────────┘        └─────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │     marcos-admin      │
                     │  (Sheets & Memoria)   │
                     └───────────────────────┘
```

---

## 3. 🎙️ POLÍTICA DE AUDIOS ELEVENLABS (MÁXIMO 2 AUDIOS EN 24 HORAS)

- **Control en `despacharRespuesta` (`index.js`):** Cada vez que se procesa un mensaje de audio entrante de un vecino/remitente, el sistema evalúa el historial de notas de voz generadas por Marcos para esa línea en las últimas 24 horas (`audiosGeneradosTimestamps`).
- **Comportamiento:**
  - Audios 1 y 2 en 24h ➔ Generación y envío de nota de voz procesada con ElevenLabs y efecto de ambiente.
  - Audio 3 en adelante ➔ Conmutación automática a respuesta de **texto por WhatsApp** para eliminar consumos innecesarios.
  - Al transcurrir 24 horas desde el primer audio, la cuota se renueva de forma automática.

---

## 4. ⏰ PROTOCOLO DE ESCALADO Y SEGUIMIENTO DE PROVEEDORES

Si un técnico no confirma asistencia en **20 minutos**:
1. **Paso 1 (Técnico Titular):** Notificación inicial + temporizador de 20 min.
2. **Paso 2 (Técnico Suplente):** Búsqueda automática del Técnico 2 en Sheets y notificación.
3. **Paso 3 (Insistencia WhatsApp):** Mensaje de recordatorio urgente por WhatsApp.
4. **Paso 4 (Alerta Email Admin):** Notificación por correo electrónico a la Administración para intervención humana.
5. **Temporizador de 10 min para Fotos de Vecinos:** Si el técnico solicita una foto y el vecino no la envía en 10 minutos, Marcos notifica al técnico para proceder con la visita directa.

---

> **Ubicación del archivo:** `diagnostico_y_arquitectura_marcos_ia.md`  
> **Última actualización:** 31 de Julio de 2026.
