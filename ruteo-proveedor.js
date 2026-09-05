// RUTEO DE LOS MENSAJES DEL PROVEEDOR — de qué está hablando el técnico
//
// > [!CAUTION]
// > **Hasta acá, quién atendía cada mensaje del técnico lo decidía una cadena de 69 condiciones
// > por coincidencia de texto, y el modelo era el ÚLTIMO de la fila.** La primera condición que
// > matcheaba cortaba y devolvía, así que el mensaje nunca llegaba a que alguien lo entendiera.
//
// El caso que agotó la paciencia, textual del chat de Daniel:
//
//     Daniel: "La foto también es del caso"
//     Marcos: "ya mismo me contacto con el vecino para pedirle la foto…"
//     Daniel: "No... te acabo de mandar una foto, NO TE ESTOY PIDIENDO FOTOS DE NADA"
//     Marcos: "ya mismo me contacto con el vecino para pedirle la foto…"
//
// La condición buscaba la palabra `foto`. Nada más. La frase *"no te estoy pidiendo fotos de
// nada"* contiene "foto", así que se leyó como un pedido de fotos. Dos veces seguidas.
//
// Y no era un caso aislado. Los cuatro bugs anteriores son el mismo defecto:
//
//   | Se escribió            | Se leyó como            | Por qué                          |
//   |------------------------|-------------------------|----------------------------------|
//   | "1001 es el caso"      | nada                    | pedía "CASO" pegado adelante     |
//   | "una cámara apagada"   | consulta de pago        | `/pag/` adentro de "aPAGada"     |
//   | "llamó el encargado"   | nada                    | `\w` no incluye la "ó"           |
//   | "hay que ver la cámara"| pedido de datos         | `ver` suelto                     |
//
// En los cuatro, el modelo NO se equivocó: nunca se le preguntó.
//
// ── QUÉ HACE ESTE MÓDULO ────────────────────────────────────────────────────────────────────
//
// Le da vuelta el orden: el modelo lee el mensaje CON EL CONTEXTO de la conversación (qué le
// acaba de preguntar Marcos, si hay un caso abierto, si hay una factura esperando obra) y dice de
// qué se trata. Recién con eso se elige el ramal.
//
// ── LO QUE ESTE MÓDULO NO TOCA ──────────────────────────────────────────────────────────────
//
// Los cerrojos determinísticos se quedan como están, y a propósito. Donde equivocarse cuesta
// plata o una relación, un `if` no es pereza: es un cerrojo, y un modelo que obedece "casi
// siempre" no alcanza.
//
//   - El cambio de CBU, que no se aplica solo (`cbu.js`).
//   - El filtro de insultos y quejas hacia el técnico (`marcos-ops.js`).
//   - La ventana de 24hs de Meta y el reintento de lo que rebotó.
//   - Si el mensaje trae un adjunto (`esFacturaODoc`): eso lo dice el tipo de archivo, no el texto.
//
// ── SE PUEDE APAGAR SIN TOCAR CÓDIGO ────────────────────────────────────────────────────────
//
//     RUTEO_IA=off        en el .env  →  vuelve la cadena de condiciones de siempre
//
// Igual que `LECTURA_PG`. Si el ruteo nuevo hace algo raro un domingo a la noche, se apaga y
// Marcos sigue andando como antes, sin esperar a nadie.

const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const ACTIVO = String(process.env.RUTEO_IA || 'on').toLowerCase() !== 'off';

// Cuánto se espera al modelo antes de seguir con las condiciones de texto. Un técnico esperando
// una respuesta no puede quedarse colgado porque Gemini tardó: mejor una respuesta por el camino
// viejo que ninguna.
const TIMEOUT_MS = Number(process.env.RUTEO_IA_TIMEOUT_MS || 6000);

/**
 * Las intenciones. Son exactamente los ramales que ya existían: esto reemplaza CÓMO se elige el
 * ramal, no lo que cada ramal hace. Cambiar las dos cosas a la vez haría imposible saber cuál de
 * los dos cambios rompió algo.
 */
const INTENCIONES = {
    consulta_pago:
        'Pregunta si le pagaron, si le depositaron, o por el estado de cobro de una factura suya. ' +
        'OJO: "se apagó la cámara" o "está apagada" NO es esto, es una falla eléctrica.',
    responde_de_que_obra:
        'Está contestando a qué edificio o a qué caso pertenece una factura que mandó antes. ' +
        'Suele ser corto: "San Patricio 270", "1001 es el caso", "el caso 1001", "1001", "el 2".',
    avisa_que_lo_convocaron:
        'Avisa que lo llamaron del edificio (el encargado, un vecino, la administración) por un ' +
        'problema. Todavía no necesariamente dice que va a ir.',
    confirma_que_va:
        'Dice que va a ir, o cuándo va a ir: "voy mañana a las 10", "paso en 2 horas", "estoy yendo".',
    entra_solo:
        'Dice que no necesita que le abran: tiene llave, código, tarjeta o acceso propio. ' +
        'OJO: "NO tengo llave" es lo contrario y NO es esto.',
    pide_datos_al_vecino:
        'Le PIDE A MARCOS que consiga algo del vecino: una foto, un video, más detalles, una ' +
        'aclaración. Tiene que ser un pedido de él hacia Marcos. ' +
        'OJO: "te mando una foto", "la foto es del caso 1001" o "no te estoy pidiendo fotos" NO ' +
        'son esto — ahí no está pidiendo nada, está aportando o corrigiendo.',
    llego_y_no_le_abren:
        'Está en la puerta del edificio y nadie le abre.',
    informa_resuelto:
        'Avisa que terminó el trabajo o que el problema quedó resuelto.',
    corrige_a_marcos:
        'Le está diciendo a Marcos que se equivocó: de caso, de edificio, de dato, o que entendió ' +
        'cualquier cosa. Suele empezar con "no", "te equivocaste", "te estás confundiendo".',
    otro:
        'Cualquier otra cosa: un saludo, un agradecimiento, una charla, o algo que no encaja claro ' +
        'en ninguna de las anteriores.',
};

const NOMBRES = Object.keys(INTENCIONES);

const SYSTEM = `Sos el ruteador de mensajes de Marcos, el asistente de una administración de consorcios argentina.

Te llega un mensaje de un TÉCNICO (electricista, plomero, cerrajero) por WhatsApp y tenés que
decidir DE QUÉ ESTÁ HABLANDO. No contestás el mensaje: solo lo clasificás.

Cómo escribe un técnico argentino de verdad:
- Sin acentos, o con los acentos que le puso la transcripción de un audio. Las dos formas valen.
- Con faltas de ortografía, abreviado, todo en minúscula o todo en mayúscula.
- El número de caso lo dice como se le canta: "CASO-1001", "caso 1001", "1001 es el caso", "1001".

LO MÁS IMPORTANTE: leé lo que la persona QUIERE, no las palabras que usó. Que aparezca la palabra
"foto" no quiere decir que esté pidiendo una foto — puede estar mandándola, o diciendo que ya la
mandó, o quejándose de que se la pediste al pedo.

Contestá SOLO un JSON, sin backticks ni explicación:
{"intencion":"<una de la lista>","confianza":<0 a 1>,"motivo":"<en 10 palabras, por qué>"}

Si dudás entre dos, elegí la que mejor describa lo que la persona quiere que pase, y bajá la
confianza. Si no encaja en ninguna con claridad, usá "otro" — es una respuesta válida y buena:
"otro" manda el mensaje a que Marcos lo lea y conteste libremente, que casi siempre es lo correcto.`;

/**
 * Clasifica un mensaje entrante del proveedor.
 *
 * @returns {{intencion:string, confianza:number, motivo:string}|null}
 *          `null` cuando el ruteo está apagado, falla o tarda demasiado. El llamador tiene que
 *          tratar el `null` como "seguí con las condiciones de texto de siempre".
 */
async function clasificarMensajeProveedor({ texto, contexto = {} } = {}) {
    if (!ACTIVO) return null;

    const t = String(texto || '').trim();
    if (!t) return null;

    const lista = NOMBRES.map(n => `- ${n}: ${INTENCIONES[n]}`).join('\n');

    // El contexto es la mitad del trabajo. "1001" a secas no significa nada; "1001" justo después
    // de que Marcos preguntó de qué obra era la factura, significa todo.
    const situacion = [
        contexto.ultimaPreguntaDeMarcos
            ? `Lo último que Marcos le preguntó: "${contexto.ultimaPreguntaDeMarcos}"`
            : 'Marcos no le preguntó nada recién.',
        contexto.casoAbierto
            ? `Tiene el ${contexto.casoAbierto} abierto${contexto.edificioDelCaso ? ` en ${contexto.edificioDelCaso}` : ''}${contexto.rubroDelCaso ? ` (${contexto.rubroDelCaso})` : ''}.`
            : 'No tiene ningún caso abierto.',
        contexto.facturaEsperandoObra
            ? 'Mandó una factura y Marcos todavía no sabe de qué obra es.'
            : '',
        contexto.mandoAdjunto
            ? 'En este mismo mensaje mandó un archivo adjunto (foto, video o documento).'
            : '',
    ].filter(Boolean).join('\n');

    const prompt = `INTENCIONES POSIBLES:
${lista}

SITUACIÓN:
${situacion}

MENSAJE DEL TÉCNICO:
"""
${t}
"""

Devolvé el JSON.`;

    try {
        const respuesta = await conTimeout(ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: prompt }],
            config: { systemInstruction: SYSTEM, temperature: 0.1 },
        }), TIMEOUT_MS);

        const crudo = String(respuesta?.text || '').replace(/```json|```/g, '').trim();
        const datos = JSON.parse(crudo);

        // Una intención que no está en la lista es lo mismo que no haber contestado: si se dejara
        // pasar, ningún ramal la reconocería y el mensaje se perdería en silencio.
        if (!NOMBRES.includes(datos?.intencion)) {
            console.error(`🧭 El ruteo devolvió una intención desconocida ("${datos?.intencion}"). Se sigue por texto.`);
            return null;
        }

        return {
            intencion: datos.intencion,
            confianza: Number(datos.confianza) || 0,
            motivo: String(datos.motivo || '').slice(0, 120),
        };
    } catch (err) {
        // Que el ruteo falle NO puede dejar sin respuesta al técnico. Se vuelve al camino viejo.
        console.error(`🧭 El ruteo por IA falló (${err.message}). Se sigue con las condiciones de texto.`);
        return null;
    }
}

/** Le pone techo a la espera: un técnico no puede quedarse colgado porque el modelo tardó. */
function conTimeout(promesa, ms) {
    return Promise.race([
        promesa,
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error(`tardó más de ${ms}ms`)), ms)),
    ]);
}

/**
 * Decide si un ramal se activa, y DEJA CONSTANCIA CUANDO EL MODELO Y EL TEXTO NO COINCIDEN.
 *
 * El log de los desacuerdos es lo más valioso que deja este cambio. Sin él, la única forma de
 * saber si el ruteo nuevo es mejor que el viejo sería que un técnico se queje. Con él, cada
 * diferencia queda escrita con las dos opiniones y la frase que la causó:
 *
 *     🧭 "la foto también es del caso" → texto: pide_datos_al_vecino | IA: otro (está aportando,
 *        no pidiendo). Gana la IA.
 *
 * @param {string} intencion       El ramal que se está evaluando.
 * @param {boolean} porTexto       Lo que decía la condición de siempre.
 * @param {object|null} ruteo      Lo que devolvió `clasificarMensajeProveedor`.
 * @param {string} texto           El mensaje, solo para el log.
 */
function seActiva(intencion, porTexto, ruteo, texto = '') {
    if (!ruteo) return porTexto;

    const porIA = ruteo.intencion === intencion;
    if (porIA !== porTexto) {
        const recorte = String(texto || '').replace(/\s+/g, ' ').slice(0, 60);
        console.log(
            `🧭 "${recorte}" → ${intencion}: el texto decía ${porTexto ? 'SÍ' : 'no'}, ` +
            `la IA dice ${porIA ? 'SÍ' : 'no'} (leyó "${ruteo.intencion}": ${ruteo.motivo}). Gana la IA.`
        );
    }
    return porIA;
}

module.exports = { clasificarMensajeProveedor, seActiva, INTENCIONES, ACTIVO };
