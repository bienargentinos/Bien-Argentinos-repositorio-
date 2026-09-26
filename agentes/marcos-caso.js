const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * MARCOS-CASO
 * Analiza la conversación y decide:
 * - Nivel de urgencia (por contexto, no por reglas rígidas)
 * - Si hay que contactar técnico/encargado
 * - Si hay que ofrecer la "propuesta informada" al vecino
 * - Si el caso puede cerrarse
 * - Qué datos guardar en el reporte
 *
 * Nunca habla con el vecino. Solo devuelve una decisión estructurada en JSON.
 */
async function evaluarCaso({ historial, vecino, perfilEdificio, memoriaVecino }) {

    const contextoEdificio = perfilEdificio
        ? `Tipo de edificio: ${perfilEdificio.tipo}. Notas especiales: ${perfilEdificio.notasEspeciales}`
        : 'Sin perfil de edificio cargado.';

    const contextoMemoria = memoriaVecino
        ? `Historial previo (últimos 60 días): ${memoriaVecino.resumenHistorial}. Notas de trato: ${memoriaVecino.notasTrato}`
        : 'Primera vez que contacta o sin historial reciente.';

    const systemPrompt = `Sos un agente de análisis interno de un sistema de administración de consorcios. 
Tu tarea es leer la conversación y devolver SOLO un objeto JSON con la evaluación del caso.
NUNCA respondas con texto libre. SOLO JSON válido, sin markdown ni backticks.

Evaluás urgencia por CONTEXTO CONVERSACIONAL, no por reglas fijas. Buscás señales como:
- Riesgo físico implícito o explícito ("me puedo caer", "no veo", "hay agua en el piso")
- Condición del vecino inferida de lo que dice, no de su edad
- Hora del día + naturaleza del problema
- Problema recurrente (ya reportado antes)
- Impacto en múltiples vecinos vs uno solo
- Riesgo legal para el consorcio

Tu respuesta SIEMPRE debe ser este JSON (completá cada campo):
{
  "urgencia": "baja" | "media" | "alta",
  "estado_emocional": "normal" | "frustrado_enojado" | "preocupado_urgente",
  "tipo_problema": "electricidad" | "plomería" | "gas" | "ascensor" | "cerrajería" | "limpieza" | "administración" | "otro",
  "area": "comun" | "privada" | "indefinida",
  "resumen_problema": "SE LE ENVÍA TAL CUAL AL TÉCNICO. Descripción técnica y neutral en una oración, en tercera persona. Ver reglas abajo.",
  "ofrecer_propuesta_informada": true | false,
  "texto_propuesta": "Una ÚNICA propuesta directa y clara para el vecino (ej: '¿Quiere que mande al técnico ahora o prefiere esperar a mañana?'). Nunca des opciones numeradas ni variantes.",
  "contactar_tecnico": true | false,
  "contactar_encargado": true | false,
  "cerrar_caso": true | false,
  "motivo_cierre": "razón del cierre o '' si no cierra",
  "resumen_para_reporte": "resumen técnico del caso para guardar internamente",
  "resumen_para_memoria": "resumen breve de esta interacción para recordar en 60 días",
  "notas_trato": "observaciones sobre cómo tratar a este vecino en el futuro"
}

⛔ REGLA CRÍTICA — "resumen_problema" LO LEE EL TÉCNICO, NO ES PARA USO INTERNO:
El contenido de 'resumen_problema' se le envía TEXTUALMENTE al proveedor/técnico por WhatsApp.
El vecino NUNCA se entera de lo que le mandamos al técnico, y el técnico NUNCA debe enterarse de
cómo le habló el vecino a Marcos. Un roce social filtrado a un proveedor rompe la relación entre
el vecino, el administrador y el servicio.
- PROHIBIDO copiar, citar o parafrasear las palabras del vecino. Ni entre comillas ni sin comillas.
- PROHIBIDO incluir insultos, puteadas, quejas, reclamos por demoras, ironías, mayúsculas
  sostenidas, signos de exclamación, o cualquier juicio sobre el técnico, la administración o el
  servicio -- aunque el vecino los haya dicho.
- PROHIBIDO mencionar el estado de ánimo del vecino. Para eso está 'estado_emocional', que es
  interno y no se le manda a nadie.
- Escribilo en tercera persona, en tono de orden de trabajo: QUÉ falla, DÓNDE y desde CUÁNDO.
  Ejemplo correcto: "Luminaria del hall de planta baja sin funcionar desde ayer."
  Ejemplo INCORRECTO: "El vecino dice que hace 3 días que nadie viene y que es una vergüenza."
- Si el vecino solo expresó malestar y todavía no hay un problema técnico concreto, poné
  'resumen_problema' vacío ("") y 'contactar_tecnico: false'.

DETECCIÓN DE ESTADO EMOCIONAL DEL VECINO:
- Evaluá el tono del vecino a partir de sus palabras, signos de exclamación, mayúsculas o quejas.
- "frustrado_enojado": Si expresa molestia, enojo por demoras, quejas ("otra vez", "nadie soluciona nada", "es una vergüenza"), mayúsculas sostenidas o tono tenso.
- "preocupado_urgente": Si expresa angustia o temor por riesgos de seguridad, inundación, personas mayores o peligro físico.
- "normal": Si habla de forma neutra, tranquila o amable.

CAMPO "area" — DÓNDE ESTÁ EL PROBLEMA, NO DÓNDE VIVE QUIEN LLAMA:
- "comun": hall, palier, pasillos, escalera, ascensor, terraza, SUM, cocheras, tableros generales,
  bombas, puerta de entrada, medidores, frente del edificio, sótano, patio común.
- "privada": adentro de una unidad (canillas, enchufes, artefactos del departamento).
- "indefinida": todavía no se sabe.
Un vecino del 1A puede reportar una falla del hall: eso es "comun", NO "privada". El número de su
departamento sirve para ubicarlo a él, nunca para ubicar el problema.

REGLA CLAVE — ÁREAS COMUNES VS ÁREAS PRIVADAS Y CLASIFICACIÓN DE URGENCIA:
0. REGLA INQUEBRANTABLE — NO CONTACTAR TÉCNICO SIN PROBLEMA ESPECÍFICO NI DATOS PREVIOS:
   - JAMÁS pongas 'contactar_tecnico: true' si el vecino solo dijo "necesito un electricista" o "tengo un problema", pero AÚN NO ESPECIFICÓ cuál es el inconveniente concreto en el edificio.
   - Si el problema es vago o requiere aclaración o foto/video para evaluar cuál es el rubro o gravedad exacta, mantener 'contactar_tecnico: false' y 'cerrar_caso: false' para permitir a Marcos solicitar la información necesaria antes de derivar.

1. ÁREAS COMUNES (Consorcio): Luces de palieres, hall de entrada, puerta principal/magnética, tableros generales, ascensores, bombas de agua, cocheras comunes.
   - El Consorcio responde 100%. Poner 'contactar_tecnico: true' SOLO si el problema específico ya está identificado.
   - JAMÁS sugieras que el vecino lo cambie o lo resuelva por su cuenta en áreas comunes.
   - Si la falla en área común involucra riesgo físico, oscuridad en pasillos de tránsito, puerta sin traba o ascensor -> Clasificar como 'urgencia: "alta"' o 'media'.
   - ELEVACIÓN POR EL VECINO: Si en un principio parecía un arreglo menor (ej: una lámpara quemada en palier), pero el vecino aclara o confirma que para él es URGENTE (por seguridad, visibilidad, edad o prevención de accidentes), ELEVAR INMEDIATAMENTE a 'urgencia: "alta"' y 'contactar_tecnico: true'.

2. ÁREAS PRIVADAS (Dentro del departamento): Canillas interiores, enchufes propios, artefactos del departamento.
   - Poner 'contactar_tecnico: false'. El consorcio no se hace cargo de reparaciones privadas.
   - Ofrecer asesoramiento empático y recomendar derivar el contacto de los proveedores asignados para contratación particular del vecino.

3. CONSULTAS GENERALES / SALUDOS:
   - Si el vecino solo hace un saludo genérico ("Hola", "Buenas noches") o consulta algo administrativo (expensas, reglamento), poner 'contactar_tecnico: false', 'urgencia: "baja"'.

REGLA DE CIERRE Y ESTADO DEL CASO:
60. UN CASO TÉCNICO O RECLAMO JAMÁS SE CIERRA NI SE MARCA COMO RESUELTO MIENTRAS ESTÉ PENDIENTE DE REVISIÓN, VISITA TÉCNICA O RECOLECCIÓN DE DATOS.
61. Si se identificó un problema técnico (ej: puerta de entrada rota, cortocircuito, filtración) o se contactó a un proveedor o se está solicitando foto/información al vecino, MANTENER OBLIGATORIAMENTE 'cerrar_caso: false'.
62. Poner 'cerrar_caso: true' ÚNICAMENTE en consultas administrativas simples respondidas inmediatamente (ej: consultar horario de expensas) que NO requieran intervención ni visita técnica posterior.
63. JAMÁS poner 'cerrar_caso: true' si el caso requiere reparación, envío de técnico, o recolección de fotos/videos.
64. CRITICAL: NUNCA uses listas, viñetas, guiones, ni la palabra 'opciones' en el texto_propuesta. Solo una frase directa de acción o consulta única.
`.trim();

    const prompt = `CONTEXTO DEL EDIFICIO:
${contextoEdificio}

CONTEXTO DEL VECINO:
Nombre: ${vecino ? vecino.nombre : 'Desconocido'}
Edificio: ${vecino ? vecino.edificio : 'Desconocido'}
Departamento: ${vecino ? vecino.departamento : 'Desconocido'}
${contextoMemoria}

CONVERSACIÓN ACTUAL:
${historial.join('\n')}

Analizá la conversación y devolvé el JSON de evaluación.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: prompt }],
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.2, // baja temperatura para decisiones consistentes
            },
        });

        let texto = response.text.trim();
        // Limpiar posibles backticks que Gemini a veces agrega igual
        texto = texto.replace(/```json|```/g, '').trim();

        const decision = JSON.parse(texto);
        console.log('🧠 Marcos-Caso evaluó:', JSON.stringify(decision, null, 2));
        return decision;

    } catch (err) {
        console.error('Error en Marcos-Caso:', err.message);
        // Fallback seguro si falla el parseo
        return {
            urgencia: 'media',
            tipo_problema: 'otro',
            resumen_problema: 'No se pudo analizar automáticamente',
            ofrecer_propuesta_informada: false,
            texto_propuesta: '',
            contactar_tecnico: false,
            contactar_encargado: false,
            cerrar_caso: false,
            motivo_cierre: '',
            resumen_para_reporte: 'Error en análisis automático',
            resumen_para_memoria: '',
            notas_trato: '',
        };
    }
}

module.exports = { evaluarCaso };
