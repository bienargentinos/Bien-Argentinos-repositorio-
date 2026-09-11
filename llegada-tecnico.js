/**
 * A QUÉ HORA LLEGA, DICHO A LA HORA QUE SE PREGUNTA
 *
 * > [!CAUTION]
 * > **"En 2 horas" no es una hora: es una cuenta desde el momento en que se dijo.** Guardado como
 * > texto y repetido después, envejece. A la hora ya está mal; a las tres, es una mentira grande.
 *
 * El caso que lo motivó, de Daniel:
 *
 *     00:00  Dario:  "en 2 hs llego"
 *     01:00  Vecino: "¿a qué hora viene el técnico?"
 *     01:00  Marcos: "llega en 2 hs"        ← falta UNA, no dos
 *
 * Y a las 03:00 seguiría diciendo "en 2 hs" para algo que ya tendría que haber pasado. El vecino no
 * lo lee como un redondeo: lo lee como que nadie está mirando su caso.
 *
 * El dato para no equivocarse **ya estaba guardado**: `tecnico_eta` tiene lo que dijo y
 * `tecnico_confirmado` **cuándo lo dijo**. Con los dos se reconstruye el momento real, así que esto
 * no agrega ninguna columna.
 *
 * Lo que se le dice al vecino pasa a ser una hora del reloj ("cerca de las 02:00"), que no envejece,
 * más cuánto falta contado en ese instante. Y si la hora ya pasó **se dice que pasó**: prometerle
 * una llegada que venció es peor que admitir la demora.
 */

const { partesAR, desdeAR, horaAR } = require('./fecha');

/**
 * Lee una marca de tiempo argentina (`11/09/2026, 00:05:12`) como un instante real.
 *
 * > No sirve `fechaEnMs` de `caso-reciente.js`: esa interpreta la hora argentina como si fuera UTC.
 * > Para ORDENAR casos da igual --el corrimiento es el mismo para todos-- pero acá se resta contra
 * > el reloj de verdad, y tres horas de diferencia es justo el error que este archivo existe para
 * > evitar.
 */
function instanteAR(texto) {
    const m = String(texto || '').trim()
        .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/);
    if (!m) {
        const n = new Date(texto);
        return isNaN(n.getTime()) ? null : n;
    }
    const [, d, mes, y, hh = '0', mi = '0'] = m;
    return desdeAR({ y: +y, m: +mes - 1, d: +d, h: +hh, min: +mi });
}

/**
 * Cuántos milisegundos dice el texto, o `null` si no dice ninguna duración.
 *
 * > **A propósito no tiene valor por defecto.** `estimarPlazoMs` devuelve tres horas cuando no
 * > entiende nada, y para agendar un control está bien: equivocarse ahí cuesta una pregunta de más.
 * > Acá el resultado se le dice a una persona que está esperando en su casa, así que de un texto
 * > que no promete nada **no se inventa una hora de llegada**.
 */
function duracionEnMs(eta) {
    const t = String(eta || '').toLowerCase();
    if (!t) return null;

    const horas = t.match(/(?:en|dentro de)?\s*(\d+)\s*(?:h\b|hs\b|horas?\b)/);
    if (horas) return parseInt(horas[1], 10) * 60 * 60 * 1000;

    const minutos = t.match(/(?:en|dentro de)?\s*(\d+)\s*(?:min\b|minutos?\b)/);
    if (minutos) return parseInt(minutos[1], 10) * 60 * 1000;

    // "media hora" y "una hora" no traen dígito y se dicen todo el tiempo.
    if (/media hora/.test(t)) return 30 * 60 * 1000;
    if (/\buna hora\b/.test(t)) return 60 * 60 * 1000;
    // "Ya salgo" es una promesa de verdad, y es la más frecuente de todas.
    if (/ahora|ya salgo|en camino|enseguida|ya voy|saliendo/.test(t)) return 45 * 60 * 1000;

    return null;
}

/**
 * El momento real en que dijo que llegaba.
 *
 * Dos formas de decirlo, y las dos se anclan al instante en que habló:
 *
 * - **Hora del reloj** ("mañana a las 10", "a las 18") → la resuelve `momentoPrometido`, que ya
 *   existe para el seguimiento. No envejece: las 10 son las 10.
 * - **Duración** ("en 2 hs", "media hora") → se suma al momento en que lo dijo, NO a ahora. Sumarla
 *   a ahora es exactamente el error: cada vez que alguien pregunta, la llegada se corre dos horas
 *   más adelante y nunca llega.
 *
 * Devuelve `null` cuando el texto no promete ningún momento. Sin promesa no se fabrica una.
 */
function momentoDeLlegada({ eta, confirmadoEn } = {}) {
    const texto = String(eta || '').trim();
    if (!texto) return null;

    const dicho = instanteAR(confirmadoEn) || new Date();

    const { momentoPrometido } = require('./seguimiento');
    const delReloj = momentoPrometido(texto, dicho);
    if (delReloj) return delReloj;

    const dura = duracionEnMs(texto);
    return dura === null ? null : new Date(dicho.getTime() + dura);
}

/**
 * "una hora y 20 minutos", "40 minutos". Para contarle a una persona cuánto falta.
 *
 * En castellano "1 hora" se dice "una hora" -- "en unos 1 hora" no lo escribe nadie, y a Marcos se
 * le nota enseguida cuando arma una frase que una persona no diría.
 */
function enPalabras(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) return 'menos de un minuto';
    if (min === 1) return 'un minuto';
    if (min < 60) return `${min} minutos`;
    const h = Math.floor(min / 60);
    const resto = min % 60;
    const horas = h === 1 ? 'una hora' : `${h} horas`;
    return resto ? `${horas} y ${resto} minuto${resto === 1 ? '' : 's'}` : horas;
}

/**
 * Cómo nombrarle la llegada a quien está esperando, en este momento y no en el de la promesa.
 *
 * Siempre lleva la **hora del reloj**, que es lo único que no envejece entre que Marcos lo escribe
 * y el vecino lo lee. Lo que falta va al lado, como referencia.
 *
 * Cuando la hora ya pasó **se dice**. Un "llega en 2 horas" para algo prometido hace tres es lo que
 * convence al vecino de que del otro lado nadie está mirando su caso.
 */
function comoDecirLaLlegada({ eta, confirmadoEn, ahora = new Date() } = {}) {
    const momento = momentoDeLlegada({ eta, confirmadoEn });
    // Sin momento no se traduce nada: se devuelve lo que dijo, tal cual, y quien arme el mensaje
    // decide. Inventar una hora es peor que repetir una frase vaga.
    if (!momento) return { hay: false, textual: String(eta || '').trim(), frase: '', vencido: false };

    const falta = momento.getTime() - ahora.getTime();
    const hora = horaAR(momento);
    const mismoDia = (() => {
        const a = partesAR(ahora), b = partesAR(momento);
        return a.y === b.y && a.m === b.m && a.d === b.d;
    })();
    const cuando = mismoDia ? `a las ${hora}` : `mañana a las ${hora}`;

    if (falta <= 0) {
        return {
            hay: true, vencido: true, momento, textual: String(eta || '').trim(),
            frase: `dijo que llegaba ${cuando} y todavía no avisó que llegó ` +
                   `(hace ${enPalabras(-falta)} de eso)`,
        };
    }
    // Faltando muy poco, "a las 02:00" solo suena a lejos. Se dice que está por llegar.
    if (falta <= 10 * 60 * 1000) {
        return { hay: true, vencido: false, momento, textual: String(eta || '').trim(),
                 frase: `está por llegar, calculá ${cuando}` };
    }
    return { hay: true, vencido: false, momento, textual: String(eta || '').trim(),
             frase: `llega ${cuando}, o sea en ${enPalabras(falta)}` };
}

module.exports = { momentoDeLlegada, comoDecirLaLlegada, duracionEnMs, instanteAR, enPalabras };
