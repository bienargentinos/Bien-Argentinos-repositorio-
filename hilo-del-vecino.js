/**
 * DE CUÁL DE SUS EDIFICIOS ESTÁ HABLANDO EL VECINO
 *
 * > [!CAUTION]
 * > **Un vecino tiene UN teléfono y puede tener la vivienda en un edificio y la oficina en otro.**
 * > El reclamo de uno no es el del otro, y son dos consorcios que pagan cosas distintas.
 *
 * Planteado por Daniel, 27/09, y la frase que define la regla:
 *
 * > *"acá debe analizar contexto, historial de conversación, para comprender qué se está diciendo
 * > en el último mensaje. Somos humanos y no tiramos palabras al azar: solo tratamos de seguir el
 * > hilo de conversación o abrimos otros. Es posible que retomemos un hilo anterior, pero se aclara
 * > en el mismo texto."*
 *
 * ## El bug
 *
 * En el PRIMER mensaje, con dos edificios, Marcos pregunta cuál — eso ya estaba bien. Pero todo ese
 * bloque vive adentro de `if (!session.edificioId)`, así que **una vez elegido queda fijo seis
 * horas** (`TIEMPO_CADUCIDAD_MS`). El reclamo de la oficina caía en el edificio de la casa.
 *
 * La única salida era que nombrara el otro edificio con todas las letras, y eso lo resuelve
 * `edificio-del-mensaje.js`. Pero nadie habla así: se dice *"acá en la oficina se cortó la luz"*.
 * Eso no nombra ningún edificio y sin embargo cualquier persona entiende que cambió de tema.
 *
 * ## Qué hace, y en qué orden
 *
 * Es el mismo orden que `ruteo-proveedor.js` ya impuso del lado del técnico: **primero lo
 * determinista, y el modelo para lo que el texto no puede decidir.**
 *
 *   1. Si el mensaje NOMBRA un edificio → manda eso (`edificio-del-mensaje.js`). No se consulta nada.
 *   2. Si no lo nombra y el vecino tiene dos o más → el modelo lee el hilo y dice de cuál habla.
 *   3. Si el modelo no sabe → se queda el de la sesión, o se pregunta. **Nunca se adivina.**
 *
 * ## El default es SEGUIR el hilo, no cambiarlo
 *
 * Ante la duda no se separa, que es el criterio que ya rige en `guardarReporte`. Cambiar de
 * edificio sin motivo parte un reclamo en dos y le muestra al administrador dos casos donde hay
 * uno; quedarse en el hilo abierto es el error barato --el vecino lo aclara en el mensaje
 * siguiente-- y es además lo que hace una persona.
 *
 * ## Se puede apagar sin tocar código
 *
 *     HILO_IA=off        en el .env  →  se decide solo con lo que el mensaje nombra
 *
 * Igual que `RUTEO_IA` y `LECTURA_PG`.
 *
 * Prueba: `node pruebas-hilo-del-vecino.js`.
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');
const { conTimeout } = require('./ruteo-proveedor');
const { norm } = require('./perfil-edificio');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const ACTIVO = String(process.env.HILO_IA || 'on').toLowerCase() !== 'off';

// La misma espera que el ruteo del proveedor, y por el mismo motivo: la primera llamada de cada
// proceso paga el arranque en frío, y Marcos ya junta los mensajes en ráfagas de 25 segundos.
const TIMEOUT_MS = Number(process.env.HILO_IA_TIMEOUT_MS || 12000);

const SYSTEM = `Sos parte de Marcos, el asistente de una administración de consorcios argentina.

Un vecino escribe por WhatsApp. Ese vecino figura en MÁS DE UN edificio --lo normal es que viva en
uno y tenga la oficina, un local o un familiar en otro-- y usa el mismo teléfono para los dos.

Tu única tarea: decidir DE CUÁL DE SUS EDIFICIOS habla este último mensaje. No contestás el
mensaje, no opinás del problema.

CÓMO PENSARLO, que es como piensa una persona:
- Una conversación sigue un hilo. Si viene hablando de un reclamo, lo que sigue es de ese reclamo:
  una foto, "¿ya viene el técnico?", "gracias", "sigue igual".
- Cuando alguien cambia de tema o de lugar, LO DICE. No siempre con el nombre del edificio: dice
  "acá en la oficina", "en el local", "en casa", "en el depto", "donde trabajo", "el otro edificio".
- Retomar algo anterior también se aclara: "volviendo a lo del lunes", "lo de la oficina sigue mal".

REGLA QUE MANDA SOBRE TODO: **ante la duda, el hilo abierto.** Cambiar de edificio sin que el
mensaje lo justifique parte un reclamo en dos y se lo imputa al consorcio equivocado. Si el mensaje
no da ninguna señal de cambio, devolvé el edificio actual. Si no hay edificio actual y el mensaje no
da ninguna pista, devolvé "" (vacío): que Marcos pregunte es una respuesta correcta y buena.

Contestá SOLO un JSON, sin backticks ni explicación:
{"edificio":"<uno de la lista, EXACTO, o vacío>","esOtroHilo":<true o false>,"confianza":<0 a 1>,"motivo":"<en 10 palabras, por qué>"}

"esOtroHilo" en true solo cuando el mensaje arranca un asunto distinto del que venía. Un mensaje del
mismo reclamo va en false aunque repita el edificio.`;

/**
 * @param {object}   opts
 * @param {string}   opts.texto           el último mensaje del vecino.
 * @param {string[]} opts.edificios       los edificios en los que figura, como están escritos.
 * @param {string[]} opts.historial       las últimas líneas de la conversación ("Vecino: …").
 * @param {string}   opts.edificioActual  el que la sesión viene usando, si hay.
 * @param {function} [opts.pedirAlModelo] inyección para las pruebas: recibe el prompt y devuelve el
 *                                        texto crudo. Sin esto, una prueba de este módulo
 *                                        necesitaría la clave de Gemini y no se podría correr antes
 *                                        de un push.
 *
 * @returns {Promise<{edificio:string, esOtroHilo:boolean, confianza:number, motivo:string}|null>}
 *          `null` cuando está apagado, no hace falta, falla o tarda. Quien llama tiene que tratar
 *          el `null` como "seguí con lo que ya tenías".
 */
async function edificioDelHilo({ texto, edificios = [], historial = [], edificioActual = '', pedirAlModelo } = {}) {
    if (!ACTIVO) return null;

    const t = String(texto || '').trim();
    if (!t) return null;

    // Con un solo edificio no hay nada que decidir, y pagar una llamada al modelo para confirmar lo
    // obvio le suma latencia a TODOS los vecinos para resolver el caso de unos pocos.
    const lista = (edificios || []).map(e => String(e || '').trim()).filter(Boolean);
    if (lista.length < 2) return null;

    // Las últimas vueltas alcanzan: lo que define el hilo es lo reciente, y un historial entero
    // hace más lenta y más cara cada consulta.
    const ultimas = (historial || []).slice(-8).join('\n');

    const prompt = `EDIFICIOS DE ESTE VECINO (elegí uno de estos, escrito EXACTAMENTE así):
${lista.map(e => `- ${e}`).join('\n')}

EDIFICIO DEL QUE SE VENÍA HABLANDO: ${edificioActual || '(ninguno todavía)'}

ÚLTIMAS LÍNEAS DE LA CONVERSACIÓN:
"""
${ultimas || '(no hay conversación previa)'}
"""

ÚLTIMO MENSAJE DEL VECINO:
"""
${t}
"""

Devolvé el JSON.`;

    try {
        const pedir = pedirAlModelo || (async (p) => {
            const respuesta = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ text: p }],
                config: { systemInstruction: SYSTEM, temperature: 0.1 },
            });
            return String(respuesta?.text || '');
        });

        const crudo = String(await conTimeout(pedir(prompt), TIMEOUT_MS))
            .replace(/```json|```/g, '').trim();
        const datos = JSON.parse(crudo);

        const dicho = String(datos?.edificio || '').trim();

        // Un edificio que no está en SU lista es lo mismo que no haber contestado. Si se dejara
        // pasar, el reclamo iría a un consorcio donde esta persona no figura.
        let elegido = '';
        if (dicho) {
            elegido = lista.find(e => norm(e) === norm(dicho)) || '';
            if (!elegido) {
                console.error(`🧵 El modelo devolvió un edificio que no es de este vecino ("${dicho}"). Se ignora.`);
                return null;
            }
        }

        return {
            edificio:   elegido,
            esOtroHilo: datos?.esOtroHilo === true,
            confianza:  Number(datos?.confianza) || 0,
            motivo:     String(datos?.motivo || '').slice(0, 120),
        };
    } catch (err) {
        // Que esto falle NO puede dejar al vecino sin respuesta. Se sigue con lo que ya había.
        console.error(`🧵 No se pudo leer el hilo del vecino (${err.message}). Se sigue con el edificio de la sesión.`);
        return null;
    }
}

module.exports = { edificioDelHilo, ACTIVO };
