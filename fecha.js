/**
 * FECHA — sello de fecha y hora del sistema, sin ambigüedad
 *
 * `new Date().toLocaleString('es-AR')` no sirve en este servidor. El Node del VPS está compilado con
 * ICU reducido (`Intl.DateTimeFormat().resolvedOptions().locale` devuelve `en-US`), así que el
 * pedido de español cae al formato inglés: reloj de 12 horas. Y en esa caída se pierde el indicador
 * de AM/PM.
 *
 * El resultado medido en el VPS:
 *
 *     new Date('2026-08-14T21:00:00').toLocaleString('es-AR')  ->  "14/8/2026, 09:00:00"
 *
 * Las nueve de la noche quedan escritas como las nueve, iguales a las nueve de la mañana. Eso se
 * guarda así en la planilla, en la base y en lo que muestra el panel: un caso de la madrugada y uno
 * del mediodía se vuelven indistinguibles, y no hay forma de recuperar cuál era cuál después.
 *
 * Por eso el formato se pide completo y explícito en vez de confiar en el que trae el sistema.
 */

const ZONA = process.env.TZ_AR || 'America/Argentina/Buenos_Aires';

const OPCIONES_FECHA_HORA = {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZone: ZONA,
};

const OPCIONES_FECHA = {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: ZONA,
};

/** Fecha y hora en 24 horas: "15/08/2026, 21:00:00". */
function fechaHoraAR(fecha = new Date()) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(d.getTime())) return '';
    // Se fuerza 'es-AR' igual: donde el ICU sí lo tenga, el separador y el orden salen en criollo;
    // donde no, las opciones explícitas ya garantizan el 24 horas, que es lo que importa.
    return d.toLocaleString('es-AR', OPCIONES_FECHA_HORA);
}

/** Solo la fecha: "15/08/2026". */
function fechaAR(fecha = new Date()) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-AR', OPCIONES_FECHA);
}

// ── EL RELOJ ARGENTINO, A MANO ──────────────────────────────────────────────
//
// Por el mismo ICU reducido de arriba, la hora del día no se puede sacar con `toLocaleString`:
// hay que hacer la cuenta. Argentina no cambia de hora desde 2009, así que el desfase es fijo.
//
// Vive acá y no en cada archivo que lo necesita porque ya son dos los que deciden cosas con la
// hora --el seguimiento y el contacto de ingreso-- y una cuenta de husos escrita dos veces es una
// cuenta que en algún momento va a decir dos cosas distintas.

const OFFSET_AR_MIN = -180;

// La franja en que se le puede escribir a una persona. Un "¿pudiste pasar?" a las 3 AM no lo
// contesta nadie, despierta a alguien y quema la confianza que Marcos necesita para existir.
const HORA_DESDE = 8;
const HORA_HASTA = 22;

/** Descompone un instante en fecha y hora ARGENTINA. */
function partesAR(fecha = new Date()) {
    const t = new Date(fecha.getTime() + OFFSET_AR_MIN * 60000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes() };
}

/** Vuelve a armar un instante a partir de una fecha y hora argentina. */
function desdeAR({ y, m, d, h, min = 0 }) {
    return new Date(Date.UTC(y, m, d, h, min) - OFFSET_AR_MIN * 60000);
}

/** Si ese instante cae de noche o de madrugada, hora argentina. */
function esHorarioNocturno(fecha = new Date()) {
    const h = partesAR(fecha).h;
    return h < HORA_DESDE || h >= HORA_HASTA;
}

/** La hora sola, "02:20", para poder nombrarla en un mensaje. */
function horaAR(fecha = new Date()) {
    const p = partesAR(fecha);
    return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

module.exports = {
    fechaHoraAR, fechaAR, ZONA,
    partesAR, desdeAR, esHorarioNocturno, horaAR,
    OFFSET_AR_MIN, HORA_DESDE, HORA_HASTA,
};
