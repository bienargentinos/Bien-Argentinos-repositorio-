/**
 * A QUÉ CASO ABIERTO SE ENGANCHA UN MENSAJE, BUSCANDO POR TELÉFONO
 *
 * Es el paso 2 de `guardarReporte` (en `sheets.js`): sin `id_evento`, el mensaje se engancha al
 * caso abierto más reciente del mismo teléfono **en el mismo edificio**.
 *
 * > [!CAUTION]
 * > **Con el edificio VACÍO, la condición vieja enganchaba con cualquier caso abierto de ese
 * > teléfono, en cualquier edificio.**
 *
 *     (rEdif === eBuscado || !eBuscado)
 *
 * El `|| !eBuscado` hacía de la falta de dato un comodín. Es la misma forma que en `porteria.js`
 * resultó ser un agujero: **que falte un dato no es una autorización.** Un vecino con la casa en un
 * edificio y la oficina en otro, o un técnico con trabajos abiertos en tres consorcios, mandaba un
 * mensaje sin edificio resuelto y caía en el caso abierto más reciente --de cualquier consorcio--.
 * Ahí se le pegaba el reclamo, la foto o la conversación a un caso ajeno, y el administrador de ese
 * otro edificio veía algo que no era suyo.
 *
 * Hasta el 28/09 no mordía porque cuando no se sabe el edificio del vecino se pregunta y se corta
 * antes de guardar. Pero eso lo protege quien llama, no esta función: cualquier llamada nueva sin
 * edificio y sin `id_evento` la destapaba.
 *
 * ## Qué hace ahora
 *
 * - **Con edificio**: igual que antes. El caso abierto más reciente de ese teléfono en ese edificio.
 * - **Sin edificio y todos sus casos abiertos en UN solo edificio**: se engancha al más reciente,
 *   como antes. No hay nada que adivinar: es el único consorcio donde ese teléfono tiene algo
 *   abierto. Es además el caso normal, y cambiarlo partiría conversaciones en dos.
 * - **Sin edificio y casos abiertos en DOS O MÁS edificios**: **no se elige.** Devuelve `ambiguo`
 *   con los edificios, para que quede dicho en el log, y el mensaje no se engancha por esta vía.
 *
 * Mismo criterio que `caso-del-tecnico.js`: con dos o más no se adivina. Un mensaje que abre su
 * propio caso sin edificio se ve en el panel y se corrige; uno pegado en el consorcio equivocado no
 * lo ve nadie, y arrastra la factura y el cierre.
 *
 * `esOtroCaso` (la separación por rubro y por reserva) se aplica **antes** de contar edificios: un
 * caso que igual no se podría elegir no puede volver ambiguo a otro que sí.
 */

const normalizar = (s) => String(s || '').toLowerCase().trim();

const telefonoCoincide = (fila, telBuscado) => {
    const rTel = String(fila.get('telefono') || '').replace(/\D/g, '');
    return Boolean(rTel) && (rTel === telBuscado || rTel.includes(telBuscado));
};

const estaAbierto = (fila) => {
    const est = normalizar(fila.get('estado'));
    return est !== 'resuelto' && est !== 'cerrado';
};

/**
 * @param {Array<{get:(k:string)=>any}>} filas  las filas de EVENTOS, en el orden de la planilla
 *        (las más nuevas al final: Sheets agrega al final y no reordena).
 * @param {object} o
 * @param {string} o.telBuscado  solo dígitos, ya limpio.
 * @param {string} [o.edificio]
 * @param {(fila)=>boolean} [o.esOtroCaso]  true si esa fila NO puede recibir este mensaje.
 * @returns {{ fila: object|null, ambiguo: boolean, edificios: string[] }}
 */
function casoAbiertoDelTelefono(filas, { telBuscado, edificio = '', esOtroCaso = () => false } = {}) {
    const nada = { fila: null, ambiguo: false, edificios: [] };
    if (!telBuscado || telBuscado.length < 6) return nada;

    const eBuscado = normalizar(edificio);
    const candidatas = [...filas].reverse().filter(r =>
        telefonoCoincide(r, telBuscado)
        && estaAbierto(r)
        && (!eBuscado || normalizar(r.get('edificio')) === eBuscado)
        && !esOtroCaso(r)
    );
    if (!candidatas.length) return nada;

    if (eBuscado) return { fila: candidatas[0], ambiguo: false, edificios: [eBuscado] };

    // Sin edificio: se cuentan los edificios DISTINTOS, con el vacío como uno más. Un caso abierto
    // sin edificio al lado de uno de San Patricio 270 tampoco dice cuál de los dos es este.
    const edificios = [...new Set(candidatas.map(r => normalizar(r.get('edificio'))))];
    if (edificios.length > 1) return { fila: null, ambiguo: true, edificios };
    return { fila: candidatas[0], ambiguo: false, edificios };
}

module.exports = { casoAbiertoDelTelefono };
