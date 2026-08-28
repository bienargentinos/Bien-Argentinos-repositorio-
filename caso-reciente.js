// Cuál de los casos abiertos de un técnico es "el de ahora".
//
// > [!CAUTION]
// > **`SELECT * FROM reportes` no devuelve las filas en ningún orden garantizado.**
// > Y en PostgreSQL, cuando una fila se ACTUALIZA se mueve al final del heap. Así que "la última
// > fila" no es el caso más nuevo: es el que se tocó más recientemente, que es otra cosa.
//
// EL CASO REAL. Daniel tenía abiertos el CASO-1001 (de hace días) y el CASO-1003 (de esa tarde).
// Mandó la foto y la factura del 1003 y Marcos cerró el 1001, le imputó la factura al 1001, y
// después le contestó con el contacto de ingreso del edificio del 1001. Los tres errores salen del
// mismo lugar: `[...abiertos].reverse().find(...)` sobre filas sin ordenar.
//
// El 1001 venía recibiendo líneas de chat todo el tiempo, así que cada UPDATE lo empujaba al final
// del heap. Terminó siendo "la última fila" aunque fuera el caso más viejo.
//
// El orden correcto es explícito: primero el número de caso (CASO-1003 > CASO-1001, que es una
// secuencia que nosotros mismos generamos), y si no hay número, la fecha.
//
// POR QUÉ EL NÚMERO Y NO LA FECHA. La fecha se guarda como texto en formato argentino
// ("27/08/2026, 19:38:21") y `new Date()` la lee mal o no la lee. El número de caso es un entero
// que crece, no depende de ningún formato, y es justamente lo que identifica al caso.

/** El número de un código de caso: "CASO-1003" → 1003. Sin número, `null`. */
function numeroDeCaso(codigo) {
    const m = String(codigo || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Convierte a milisegundos una fecha guardada como texto, incluido el formato argentino
 * "27/08/2026, 19:38:21" que `new Date()` interpreta al revés (mes/día) o directamente no lee.
 */
function fechaEnMs(texto) {
    const t = String(texto || '').trim();
    if (!t) return null;

    const ar = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (ar) {
        const [, d, m, y, hh = '0', mi = '0', ss = '0'] = ar;
        return Date.UTC(+y, +m - 1, +d, +hh, +mi, +ss);
    }

    const n = new Date(t).getTime();
    return Number.isFinite(n) ? n : null;
}

/**
 * De un conjunto de filas de casos, la que corresponde al trabajo más reciente.
 *
 * `leer(fila, campo)` se pasa desde afuera porque las filas vienen distinto de PostgreSQL y de
 * Sheets. Devuelve `null` con la lista vacía.
 */
function elegirCasoMasReciente(filas, leer) {
    if (!Array.isArray(filas) || !filas.length) return null;

    const conPeso = filas.map((fila, posicion) => {
        const codigo = leer(fila, 'codigo_caso') || leer(fila, 'id_evento') || '';
        return {
            fila,
            numero: numeroDeCaso(codigo),
            fecha: fechaEnMs(leer(fila, 'fecha')),
            // Último desempate: la posición en la que vino. No es confiable --de eso se trata todo
            // esto-- pero con dos casos sin número y sin fecha hay que elegir alguno.
            posicion,
        };
    });

    conPeso.sort((a, b) => {
        if (a.numero !== null && b.numero !== null && a.numero !== b.numero) return b.numero - a.numero;
        if (a.numero !== null && b.numero === null) return -1;
        if (a.numero === null && b.numero !== null) return 1;
        if (a.fecha !== null && b.fecha !== null && a.fecha !== b.fecha) return b.fecha - a.fecha;
        if (a.fecha !== null && b.fecha === null) return -1;
        if (a.fecha === null && b.fecha !== null) return 1;
        return b.posicion - a.posicion;
    });

    return conPeso[0].fila;
}

module.exports = { elegirCasoMasReciente, numeroDeCaso, fechaEnMs };
