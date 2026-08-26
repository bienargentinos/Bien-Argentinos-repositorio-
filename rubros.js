// Equivalencias entre las mil formas de nombrar un oficio.
//
// Vive en su propio archivo porque lo necesitan tres lados: `index.js` (para saber cuál de los
// técnicos que comparten una línea telefónica está escribiendo), `sheets.js` (para saber si un
// reclamo nuevo es la continuación de un caso abierto o es otro caso) y la derivación de casos.
// Tenerlo copiado en cada uno garantizaba que un rubro se leyera distinto según quién preguntara.

/**
 * Si dos formas de nombrar un oficio son el mismo oficio.
 *
 * "electricista", "electricidad" y "luz" son lo mismo. "plomería" y "electricidad" no.
 * Con cualquiera de los dos vacío devuelve false: no se puede afirmar que coincidan.
 */
function coincideRubro(a, b) {
    const x = String(a || '').toLowerCase().trim();
    const y = String(b || '').toLowerCase().trim();
    if (!x || !y) return false;
    if (x.includes(y) || y.includes(x)) return true;

    const familias = [
        ['electr', 'luz', 'tablero', 'iluminacion'],
        ['plom', 'agua', 'cloaca', 'cania', 'caño'],
        ['gas', 'calder', 'termotanque'],
        ['cerraj', 'llav', 'port', 'puerta'],
        ['alban', 'albañ', 'mamposter', 'pared'],
        ['ascensor', 'montacarga'],
        ['refriger', 'aire', 'split'],
    ];
    return familias.some(f => f.some(t => x.includes(t)) && f.some(t => y.includes(t)));
}

module.exports = { coincideRubro };
