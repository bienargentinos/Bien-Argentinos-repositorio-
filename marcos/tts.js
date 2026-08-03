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
async function generarAudio(texto, fileName = 'audio_marcos.ogg') {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const filePath = path.join(tempDir, fileName);
    const tempRawPath = path.join(tempDir, `raw_${Date.now()}_${fileName}`);

    // Función para saber si estamos en turno Susana (Día) o Marcos (Noche)
    const options = { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false };
    const formatter = new Intl.DateTimeFormat('es-AR', options);
    const hour = parseInt(formatter.format(new Date()), 10);
    const esTurnoDia = (hour >= 8 && hour < 20);

    // Configuración de ElevenLabs
    const VOICE_ID_MARCOS = 'QK4xDwo9ESPHA4JNUpX3';
    const VOICE_ID_SUSANA = '93IsRN8Mhs3FMPjO05OH'; // ID provisto por el usuario
    
    const VOICE_ID = esTurnoDia ? VOICE_ID_SUSANA : VOICE_ID_MARCOS;
    const MODEL_ID = 'eleven_multilingual_v2';
    const API_KEY = process.env.ELEVENLABS_API_KEY;

    try {
        const response = await axios({
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=opus_48000_128`,
            data: {
                text: texto,
                model_id: MODEL_ID,
                voice_settings: {
                    stability: 0.65,      // Más estabilidad = menos energía "vendedora", más calmado
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

        // Buscar archivo de sonido ambiente
        const ambientDir = path.join(__dirname, 'sonido ambiente Marcos nota de voz');
        let ambientFilePath = null;

        if (fs.existsSync(ambientDir)) {
            const files = fs.readdirSync(ambientDir);
            const audioFile = files.find(f => f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.ogg'));
            if (audioFile) {
                ambientFilePath = path.join(ambientDir, audioFile);
            }
        }

        // Si existe sonido ambiente, guardamos primero el raw y mezclamos con ffmpeg
        if (ambientFilePath) {
            fs.writeFileSync(tempRawPath, response.data);
            
            try {
                // Comando FFmpeg:
                // -i voz: audio de ElevenLabs
                // -stream_loop -1 -i ambiente: bucle infinito del ambiente de oficina
                // volume=0.10: atenuar el ambiente al 10% de volumen para no tapar la voz
                // amix=inputs=2:duration=first: mezclar ambos audios y cortar exactamente cuando termina la voz
                const cmd = `ffmpeg -y -i "${tempRawPath}" -stream_loop -1 -i "${ambientFilePath}" -filter_complex "[1:a]volume=0.10[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[out]" -map "[out]" -c:a libopus -b:a 48k "${filePath}"`;
                
                await execPromise(cmd);
                
                // Limpiar archivo temporal raw
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
            // WhatsApp prefiere OGG OPUS. Guardamos el OGG directo de ElevenLabs.
            fs.writeFileSync(filePath, response.data);
            return filePath;
        }

    } catch (err) {
        console.error('Error en ElevenLabs TTS:', err.response ? err.response.data.toString() : err.message);
        throw new Error('Fallo en la generación de audio premium');
    }
}

module.exports = { generarAudio };

