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
  "resumen_problema": "descripción breve en una oración",
  "ofrecer_propuesta_informada": true | false,
  "texto_propuesta": "Una ÚNICA propuesta directa y clara para el vecino. Nunca des opciones numeradas ni variantes.",
  "contactar_tecnico": true | false,
  "contactar_encargado": true | false,
  "cerrar_caso": true | false,
  "motivo_cierre": "razón del cierre o '' si no cierra",
  "resumen_para_reporte": "resumen técnico del caso para guardar internamente",
  "resumen_para_memoria": "resumen breve de esta interacción para recordar en 60 días",
  "notas_trato": "observaciones sobre cómo tratar a este vecino en el futuro"
}

DETECCIÓN DE ESTADO EMOCIONAL DEL VECINO:
- Evaluá el tono del vecino a partir de sus palabras, signos de exclamación, mayúsculas o quejas.
- "frustrado_enojado": Si expresa molestia, enojo por demoras, quejas ("otra vez", "nadie soluciona nada", "es una vergüenza"), mayúsculas sostenidas o tono tenso.
- "preocupado_urgente": Si expresa angustia o temor por riesgos de seguridad, inundación, personas mayores o peligro físico.
- "normal": Si habla de forma neutra, tranquila o amable.

REGLA CLAVE — ÁREAS COMUNES VS ÁREAS PRIVADAS Y CLASIFICACIÓN DE URGENCIA:
0. REGLA INQUEBRANTABLE — NO CONTACTAR TÉCNICO SIN PROBLEMA ESPECÍFICO NI DATOS PREVIOS:
   - JAMÁS pongas 'contactar_tecnico: true' si el vecino solo dijo "necesito un electricista" o "tengo un problema", pero AÚN NO ESPECIFICÓ cuál es el inconveniente concreto en el edificio.
   - Si el problema es vago o requiere aclaración o foto/video para evaluar cuál es el rubro o gravedad exacta, mantener 'contactar_tecnico: false' y 'cerrar_caso: false' para permitir a Marcos solicitar la información necesaria antes de derivar.

1. ÁREAS COMUNES (Consorcio): Luces de palieres, hall de entrada, puerta principal/magnética, tableros generales, ascensores, bombas de agua, cocheras comunes.
   - El Consorcio responde 100%. Poner 'contactar_tecnico: true' SOLO si el problema específico ya está identificado.
   - JAMÁS sugieras que el vecino lo cambie o lo resuelva por su cuenta en áreas comunes.
   - Si la falla en área común involucra riesgo físico, oscuridad en pasillos de tránsito, puerta sin traba o ascensor -> Clasificar como 'urgencia: "alta"' o 'media'.
   - ELEVACIÓN POR EL VECINO: Si el vecino aclara o confirma que para él es URGENTE (por seguridad, visibilidad o prevención de accidentes), ELEVAR a 'urgencia: "alta"' y 'contactar_tecnico: true'.

2. ÁREAS PRIVADAS (Dentro del departamento): Canillas interiores, enchufes propios, artefactos del departamento.
   - Poner 'contactar_tecnico: false'. El consorcio no se hace cargo de reparaciones privadas.

3. CONSULTAS GENERALES / SALUDOS:
   - Si el vecino solo hace un saludo genérico ("Hola", "Buenas noches") o consulta algo administrativo (expensas, reglamento), poner 'contactar_tecnico: false', 'urgencia: "baja"'.

REGLA DE CIERRE Y ESTADO DEL CASO [CASO-XXXX]:
60. UN CASO TÉCNICO O RECLAMO JAMÁS SE CIERRA NI SE MARCA COMO RESUELTO MIENTRAS ESTÉ PENDIENTE DE REVISIÓN, VISITA TÉCNICA O RECOLECCIÓN DE DATOS.
61. Si el cliente o técnico dice "ya está listo", "terminé" o "se arregló", NO CERRAR TODOS LOS CASOS DEL EDIFICIO. Verificar a cuál [CASO-XXXX] específico corresponde. Si hay dudas o múltiples casos activos en el edificio, mantener 'cerrar_caso: false' para que Marcos indague cuál es el caso finalizado.
62. Poner 'cerrar_caso: true' ÚNICAMENTE si se confirmó de forma explícita el código de caso [CASO-XXXX] o si es el único caso abierto y el trabajo está concluido.
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
                temperature: 0.2,
            },
        });

        let texto = response.text.trim().replace(/```json|```/g, '').trim();
        const decision = JSON.parse(texto);
        console.log('🧠 Marcos-Caso evaluó:', JSON.stringify(decision, null, 2));
        return decision;

    } catch (err) {
        console.error('Error en Marcos-Caso:', err.message);
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
