require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * MARCOS TTS — ELEVENLABS VERSION (PREMIUM + MEZCLA DE AMBIENTE)
 * Genera un archivo de audio (.ogg) a partir de un texto usando ElevenLabs,
 * y opcionalmente le mezcla el sonido ambiental de oficina si está disponible.
 * 
 * @param {string} texto - Texto a sintetizar.
 * @param {string} fileName - Nombre del archivo de salida.
 * @returns {Promise<string>} - Ruta del archivo generado.
 */
/**
 * Prepara el texto para que una voz sintética lo diga bien.
 *
 * Los números de teléfono largos descalabran a cualquier TTS: los pronuncia a los tropezones, se
 * come dígitos y suena a persona masticando. Y además es información inútil dicha en voz: nadie
 * anota un número de trece cifras escuchando un audio de WhatsApp. Ese número YA viaja escrito en
 * el mensaje de texto y en la plantilla que recibe el técnico, así que decirlo es redundante.
 *
 * Se saca el número y se conserva a quién pertenece, que es lo único que la persona necesita oír:
 * "el contacto de Natalia Zeballos" en vez de "el contacto de Natalia Zeballos cinco cuatro nueve
 * uno uno seis siete tres cinco cero cuatro tres seis".
 *
 * Solo afecta a la voz. El texto escrito sale completo, con el número incluido.
 */
function prepararTextoParaVoz(texto) {
    if (!texto) return '';
    let t = String(texto);

    // Teléfonos, con o sin +54, guiones, puntos, espacios o paréntesis. Se lleva puesta también la
    // preposición que los introduce ("al 11...", "su número 11...") para no dejar la frase coja.
    const TELEFONO = /(?:\b(?:al|a\s+el|su|un|este|el)\s+)?(?:\b(?:tel(?:[ée]fono)?|cel(?:ular)?|whats?app|wsp|n[úu]mero|nro)\b\s*\.?\s*:?\s*)?\+?\s*(?:\d[\d\s().\-]{6,}\d)/gi;

    // Un teléfono entre paréntesis detrás de un nombre -- "Natalia Zeballos (5491167350436)" -- se
    // borra entero, paréntesis incluidos.
    t = t.replace(/\(\s*\+?\s*\d[\d\s().\-]{6,}\d\s*\)/g, '');
    t = t.replace(TELEFONO, ' ');

    // El código del caso se lee horrible con corchetes y guion ("corchete caso guion..."). Si la
    // frase ya venía diciendo "el caso", no se repite la palabra.
    t = t.replace(/(\bcaso\s+)?\[?\s*CASO\s*-\s*(\d+)\s*\]?/gi,
        (_, previo, numero) => (previo ? `${previo}${numero}` : `caso ${numero}`));

    // Marcas de formato de WhatsApp y emojis: la voz los pronuncia o tropieza con ellos.
    t = t.replace(/[*_~`]/g, '');
    t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '');

    // Limpieza de lo que queda: espacios dobles, signos sueltos y frases que quedaron colgando.
    t = t.replace(/\s{2,}/g, ' ')
         .replace(/\s+([.,;:!?])/g, '$1')
         .replace(/([(,:;])\s*([.,;:])/g, '$2')
         .replace(/\(\s*\)/g, '')
         .replace(/\s*,\s*\./g, '.')
         .replace(/\.{2,}/g, '.')
         .replace(/,{2,}/g, ',')
         .trim();

    return t;
}

async function generarAudio(texto, fileName = 'audio_marcos.ogg') {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const filePath = path.join(tempDir, fileName);
    const tempRawPath = path.join(tempDir, `raw_${Date.now()}_${fileName}`);

    // Lo que se dice en voz no es literalmente lo que se escribe: los teléfonos se omiten.
    const textoParaVoz = prepararTextoParaVoz(texto);
    if (textoParaVoz !== texto) {
        console.log('🔇 Se omitieron números de teléfono en la nota de voz (van escritos igual).');
    }

    const options = { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false };
    const formatter = new Intl.DateTimeFormat('es-AR', options);
    const hour = parseInt(formatter.format(new Date()), 10);
    const esTurnoDia = (hour >= 8 && hour < 20);

    const VOICE_ID_MARCOS = 'QK4xDwo9ESPHA4JNUpX3';
    const VOICE_ID_SUSANA = '93IsRN8Mhs3FMPjO05OH';
    
    const VOICE_ID = esTurnoDia ? VOICE_ID_SUSANA : VOICE_ID_MARCOS;
    const MODEL_ID = 'eleven_multilingual_v2';
    const API_KEY = process.env.ELEVENLABS_API_KEY;

    try {
        const response = await axios({
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=opus_48000_128`,
            data: {
                text: textoParaVoz,
                model_id: MODEL_ID,
                voice_settings: {
                    stability: 0.65,
                    similarity_boost: 0.8,
                    style: 0.0,
                    use_speaker_boost: true
                }
            },
            headers: {
                'Accept': 'audio/ogg',
                'xi-api-key': API_KEY,
                'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer'
        });

        const ambientDir = path.join(__dirname, 'sonido ambiente Marcos nota de voz');
        let ambientFilePath = null;

        if (fs.existsSync(ambientDir)) {
            const files = fs.readdirSync(ambientDir);
            const audioFile = files.find(f => f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.ogg'));
            if (audioFile) {
                ambientFilePath = path.join(ambientDir, audioFile);
            }
        }

        if (ambientFilePath) {
            fs.writeFileSync(tempRawPath, response.data);
            
            try {
                const cmd = `ffmpeg -y -i "${tempRawPath}" -stream_loop -1 -i "${ambientFilePath}" -filter_complex "[1:a]volume=0.10[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[out]" -map "[out]" -c:a libopus -b:a 48k "${filePath}"`;
                
                await execPromise(cmd);
                
                if (fs.existsSync(tempRawPath)) fs.unlinkSync(tempRawPath);
                
                console.log('✅ Audio con mezcla de ambiente de oficina generado con éxito.');
                return filePath;
            } catch (ffmpegErr) {
                console.warn('⚠️ FFmpeg no pudo realizar la mezcla (se usará el audio de ElevenLabs sin fondo):', ffmpegErr.message);
                if (fs.existsSync(tempRawPath)) {
                    fs.renameSync(tempRawPath, filePath);
                } else {
                    fs.writeFileSync(filePath, response.data);
                }
                return filePath;
            }
        } else {
            fs.writeFileSync(filePath, response.data);
            return filePath;
        }

    } catch (err) {
        console.error('Error en ElevenLabs TTS:', err.response ? err.response.data.toString() : err.message);
        throw new Error('Fallo en la generación de audio premium');
    }
}

module.exports = { generarAudio, prepararTextoParaVoz };
