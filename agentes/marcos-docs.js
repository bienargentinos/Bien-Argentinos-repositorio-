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

    // Además de facturas, este lector tiene que reconocer una CONSTANCIA DE CBU: la captura del
    // homebanking o el PDF que manda el técnico para decir a qué cuenta le paguen. Es la forma en
    // que llegan de verdad los datos bancarios -- por texto, por imagen o por PDF, nunca por audio.
    // Sin distinguirla, ese documento se archivaba como si fuera una factura del consorcio.
    const systemPrompt = `Sos un agente de contabilidad de un sistema de administración de consorcios.
Analizá el documento adjunto y devolvé SOLO JSON válido, sin markdown ni backticks.

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

Si el documento es una CONSTANCIA DE CBU, una captura del homebanking, o cualquier documento
cuyo contenido principal sean DATOS BANCARIOS para recibir un pago (CBU, alias, titular de la
cuenta, CUIT), devolvé:
{
  "es_factura": false,
  "es_datos_bancarios": true,
  "cbu": "los 22 dígitos del CBU, solo números, sin espacios ni guiones. Vacío si no figura.",
  "alias": "el alias de la cuenta tal cual figura. Vacío si no figura.",
  "titular": "nombre del titular de la cuenta. Vacío si no figura.",
  "cuit": "CUIT o CUIL del titular, solo números. Vacío si no figura.",
  "banco": "nombre del banco si figura"
}

IMPORTANTE sobre el CBU: transcribí los 22 dígitos EXACTAMENTE como están. No completes, no
corrijas ni adivines ningún dígito que no se lea con claridad. Si alguno no se distingue bien,
devolvé "cbu": "" y dejá el alias. Un dígito inventado manda un pago a la cuenta equivocada.

Ojo: una factura también puede traer el CBU al pie para que le paguen. En ese caso sigue siendo
una FACTURA ("es_factura": true) y los datos bancarios van igual en los mismos campos cbu,
alias, titular y cuit.

Si el documento no es ninguna de las dos cosas (foto de un problema, un mensaje, etc.):
{
  "es_factura": false,
  "es_datos_bancarios": false
}`;

    const prompt = `Edificio de referencia (usalo si no figura en el documento): ${edificio || 'No especificado'}

Analizá el documento adjunto: puede ser una factura, una constancia de datos bancarios (CBU o
alias para cobrar), o ninguna de las dos.`;

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
