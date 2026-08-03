const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * MARCOS-DOCS
 * Lee facturas, tickets, imágenes y documentos.
 * Extrae datos estructurados para contabilidad.
 * Devuelve JSON con los datos extraídos.
 */
async function procesarDocumento({ filePath, mimeType, edificio }) {

    if (!filePath || !fs.existsSync(filePath)) {
        console.warn('⚠️ Marcos-Docs: archivo no encontrado.');
        return null;
    }

    const base64Data = fs.readFileSync(filePath).toString('base64');

    const systemPrompt = `Sos un agente de contabilidad de un sistema de administración de consorcios.
Tu única tarea es analizar el documento adjunto y extraer datos de facturación.
Respondé SOLO con JSON válido, sin markdown ni backticks.

Si el documento ES una factura o comprobante de pago, devolvé:
{
  "es_factura": true,
  "proveedor": "nombre del proveedor o emisor",
  "monto": "monto total con moneda (ej: $15.000 ARS)",
  "fecha": "fecha de la factura",
  "concepto": "descripción del servicio o producto",
  "numero_factura": "número de comprobante si figura",
  "edificio": "nombre del edificio si figura, sino usa el valor proporcionado"
}

Si el documento NO es una factura ni comprobante (foto de un problema, mensaje, etc.), devolvé:
{
  "es_factura": false
}`;

    const prompt = `Edificio de referencia (usalo si no figura en el documento): ${edificio || 'No especificado'}

Analizá el documento adjunto y extraé los datos si es una factura.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    parts: [
                        { text: prompt },
                        { inlineData: { data: base64Data, mimeType } },
                    ],
                },
            ],
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.1,
            },
        });

        let texto = response.text.trim().replace(/```json|```/g, '').trim();
        const resultado = JSON.parse(texto);
        console.log('📄 Marcos-Docs procesó:', JSON.stringify(resultado));
        return resultado;

    } catch (err) {
        console.error('Error en Marcos-Docs:', err.message);
        return null;
    }
}

module.exports = { procesarDocumento };
