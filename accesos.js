const { GoogleGenAI } = require('@google/genai');

/**
 * ACCESOS — extracción de datos de instalaciones a partir de texto suelto
 *
 * Lo usan dos lados distintos, y por eso vive acá y no adentro de ninguno de los dos:
 *
 *   - El motor (index.js), que escucha las conversaciones: un vecino que dice "yo le abro, tengo
 *     llave de la sala de electricidad" está aportando un dato que el administrador no tenía.
 *   - El panel, donde el administrador cuenta cómo es el edificio con sus palabras en vez de
 *     llenar una tabla campo por campo. Un administrador con 27 edificios no carga ocho filas por
 *     edificio, pero sí escribe un párrafo — y de ese párrafo salen las filas.
 */

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Solo vale la pena llamar al modelo si el texto menciona algo de instalaciones o accesos. Sin
// este filtro previo, cada "hola buenas tardes" gastaría una llamada.
const PISTAS_ACCESO = /\b(llave|llaves|candado|tablero|medidor(es)?|sala de m[aá]quinas|sala de electricidad|sala el[eé]ctrica|bomba(s)?|tanque|terraza|azotea|s[oó]tano|subsuelo|palanca de gas|llave de gas|acceso|abrir|abro|le abro|qr|llavero|portero|matafuego|ascensor)\b/i;

function mencionaAccesos(texto) {
    return !!texto && PISTAS_ACCESO.test(String(texto));
}

/**
 * Convierte texto libre en filas de instalaciones.
 *
 * @param {string} texto        Lo que escribió la persona.
 * @param {string} quienLoDijo  Para dar contexto al modelo (un vecino no habla como un administrador).
 * @param {boolean} forzar      true cuando el texto viene de un formulario donde la persona
 *                              justamente está describiendo el edificio: ahí no hay que exigir
 *                              palabras clave, porque puede escribir de una forma que no las use.
 * @returns {Promise<Array>}    [{lugar, ubicacion, quien_abre, telefono, tipo_acceso, notas}]
 */
async function extraerAccesosDeTexto({ texto, quienLoDijo = '', forzar = false }) {
    if (!texto) return [];
    if (!forzar && !mencionaAccesos(texto)) return [];

    try {
        const prompt = `Leé este texto de alguien de un consorcio y extraé SOLO datos concretos sobre instalaciones del edificio y sus accesos.

Texto de ${quienLoDijo || 'una persona del edificio'}:
"""
${texto}
"""

Devolvé SOLO un array JSON (sin markdown ni backticks). Cada elemento:
{"lugar":"nombre normalizado del lugar","ubicacion":"dónde está, si lo dice","quien_abre":"quién tiene la llave o puede abrir","telefono":"teléfono de esa persona si lo menciona","tipo_acceso":"llave|candado|qr|llavero magnetico|libre","notas":"detalle útil"}

Usá para "lugar" nombres normalizados y en minúscula: "sala de medidores", "tablero electrico",
"sala de maquinas", "sala de bombas", "llave de gas", "terraza", "tanque de agua", "sotano",
"puerta de entrada", "sala de ascensores", "matafuegos".

REGLAS:
- Solo extraé lo que se AFIRMA como un hecho. Una pregunta no es un dato.
- Si la persona dice que ella misma tiene la llave, poné su nombre en "quien_abre".
- Un mismo texto puede describir varios lugares: devolvé uno por cada uno.
- Campos que no se mencionan van como cadena vacía. No inventes nada.
- Si no hay ningún dato concreto de instalaciones o accesos, devolvé exactamente: []`;

        const resp = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        const crudo = String(resp?.text || '').replace(/```json|```/g, '').trim();
        if (!crudo || crudo === '[]') return [];

        let datos;
        try { datos = JSON.parse(crudo); } catch { return []; }
        if (!Array.isArray(datos)) return [];

        return datos
            .filter(d => d && d.lugar)
            .map(d => ({
                lugar:       String(d.lugar).toLowerCase().trim(),
                ubicacion:   d.ubicacion || '',
                quien_abre:  d.quien_abre || '',
                telefono:    d.telefono || '',
                tipo_acceso: d.tipo_acceso || '',
                notas:       d.notas || '',
            }));
    } catch (err) {
        console.error('Error extrayendo accesos del texto:', err.message);
        return [];
    }
}

module.exports = { extraerAccesosDeTexto, mencionaAccesos };
