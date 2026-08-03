const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function transcribirAudio(filePath, mimeType) {
    try {
        console.log(`🎙️ Transcribiendo audio (${mimeType})...`);
        const fileContent = fs.readFileSync(filePath);
        const base64Data = fileContent.toString('base64');

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
        console.error('Error transcribiendo audio con Gemini:', error.message);
        return null;
    }
}

module.exports = { transcribirAudio };
