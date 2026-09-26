const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Gemini devuelve 503 cuando está saturado, y es una falla pasajera: el mismo audio suele
// transcribirse bien un segundo después. Sin reintento, ese 503 perdía la nota de voz para
// siempre -- el vecino había dictado su nombre y su dirección y a Marcos le llegaba relleno.
const REINTENTOS = 3;
const ESPERA_BASE_MS = 800;

/** Vale la pena reintentar lo que es del otro lado y pasajero, no un pedido mal formado. */
function esFallaPasajera(error) {
    const codigo = error?.status || error?.code || 0;
    const texto = String(error?.message || '');
    return codigo === 503 || codigo === 429 || codigo === 500 ||
        /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|ECONNRESET|ETIMEDOUT/i.test(texto);
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function transcribirAudio(filePath, mimeType) {
    let fileContent;
    try {
        fileContent = fs.readFileSync(filePath);
    } catch (error) {
        console.error('Error leyendo el archivo de audio a transcribir:', error.message);
        return null;
    }
    const base64Data = fileContent.toString('base64');

    for (let intento = 1; intento <= REINTENTOS; intento++) {
        try {
            console.log(`🎙️ Transcribiendo audio (${mimeType})${intento > 1 ? ` — intento ${intento}/${REINTENTOS}` : ''}...`);

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    parts: [
                        {
                            inlineData: {
                                data: base64Data,
                                mimeType: mimeType
                            }
                        },
                        {
                            text: "Por favor, transcribe exactamente este mensaje de voz. No agregues comentarios, solo devuelve el texto hablado. Si está vacío o ininteligible, devuelve '(Audio ininteligible)'."
                        }
                    ]
                }]
            });

            return response.text.trim();
        } catch (error) {
            const reintentable = esFallaPasajera(error) && intento < REINTENTOS;
            console.error(`Error transcribiendo audio con Gemini${reintentable ? ` (intento ${intento}/${REINTENTOS}, se reintenta)` : ''}:`, error.message);
            if (!reintentable) return null;
            // Espera creciente: si el modelo está saturado, volver enseguida solo suma carga.
            await esperar(ESPERA_BASE_MS * Math.pow(2, intento - 1));
        }
    }
    return null;
}

module.exports = { transcribirAudio };
