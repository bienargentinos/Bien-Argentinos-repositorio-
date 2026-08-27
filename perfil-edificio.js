// Cuál fila de EDIFICIOS es el edificio que se está buscando.
//
// > [!CAUTION]
// > **Esto decide a qué dirección se manda un técnico, y a quién se le dice que le abra.**
// > Equivocarse acá no es un dato feo en el panel: es una persona yendo a la puerta de otro
// > consorcio, y el teléfono de un encargado que no lo espera.
//
// EL BUG QUE LO ORIGINÓ. La regla vieja juntaba TODOS los números de nombre + dirección + alias
// en una sola bolsa y le alcanzaba con que uno cualquiera coincidiera:
//
//     const numsR = (nombre + ' ' + direccion + ' ' + aliases).match(/\d+/g) || [];
//     return numBuscado.some(n => numsR.includes(n));
//
// Nunca miraba el nombre de la calle. Con eso, buscando "San Patricio 270" devolvía una fila cuyo
// alias mencionaba el 270 pero cuya dirección era **San Patricio 159**, y Marcos le pasó al técnico
// la dirección 159 y el contacto de ingreso de ese otro edificio. En el panel el caso decía 270.
//
// Y además "Rivadavia 270" habría coincidido con "San Patricio 270": el número solo no identifica
// nada.
//
// LAS REGLAS, en orden de confianza:
//
//   3 — exacto: el texto buscado ES el nombre, la dirección o un alias completo.
//   2 — misma calle Y misma altura, leídas del MISMO campo (no de tres campos mezclados).
//   1 — misma calle, el buscado trae altura y el campo no tiene ninguna (un alias tipo
//       "san patricio casa"). Es una pista, no una certeza.
//   ✗ — la altura se contradice: "270" contra un campo que dice 159. Nunca coincide.
//
// Y si el mejor puntaje es 1 y hay MÁS DE UN candidato, no se elige: se devuelve `null` y se avisa.
// Sin perfil, quien pregunta se queda con el nombre interno del edificio -- vago, pero no falso.
// Una dirección equivocada manda a alguien a otro lado; un alias sin resolver, no.

const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const numeros = (s) => norm(s).match(/\d+/g) || [];

// Palabras que sirven para identificar una calle. Se descartan los números y las muy cortas
// ("de", "la", "el"), que aparecen en todos lados y no distinguen nada.
const palabras = (s) => norm(s).split(' ').filter(p => p.length >= 4 && !/^\d+$/.test(p));

/**
 * Cuánta confianza hay en que ese texto sea el edificio buscado. 0 = ninguna.
 */
function puntaje(texto, buscado) {
    const t = norm(texto);
    const b = norm(buscado);
    if (!t || !b) return 0;
    if (t === b) return 3;

    const numsT = numeros(t);
    const numsB = numeros(b);

    // La altura se contradice: son direcciones distintas de la misma calle. Este es el caso que
    // rompía todo -- el 270 y el 159 de San Patricio son dos consorcios diferentes.
    if (numsB.length && numsT.length && !numsB.some(n => numsT.includes(n))) return 0;

    const palT = palabras(t);
    const palB = palabras(b);
    const compartenCalle = palB.some(p => palT.includes(p));

    // Sin nombre de calle en común no hay nada: el número solo no identifica un edificio.
    if (!compartenCalle) return 0;

    if (numsB.length && numsT.length) return 2;   // misma calle y misma altura
    return 1;                                      // misma calle, altura sin confirmar
}

/**
 * Elige la fila de EDIFICIOS que corresponde al edificio buscado.
 *
 * `leer(fila, campo)` se pasa desde afuera porque las dos implementaciones guardan las filas
 * distinto (Sheets y PostgreSQL). La lógica de decisión, en cambio, es una sola: tenerla copiada
 * era lo que hacía que el panel y el motor de Marcos vieran edificios distintos.
 *
 * Devuelve `{ fila, puntaje, porQue }` o `null`.
 */
function elegirFilaEdificio(filas, nombreBuscado, leer) {
    if (!Array.isArray(filas) || !filas.length || !nombreBuscado) return null;

    const candidatos = [];

    for (const fila of filas) {
        const nombre    = leer(fila, 'nombre') || leer(fila, 'edificio') || leer(fila, 'consorcio') || '';
        const edificio  = leer(fila, 'edificio') || '';
        const direccion = leer(fila, 'direccion') || '';
        const aliasCrudo = leer(fila, 'aliases') || '';
        const alias = String(aliasCrudo).split(',').map(a => a.trim()).filter(Boolean);

        // Cada campo se evalúa POR SEPARADO. Mezclarlos es lo que dejaba que el número de un alias
        // avalara la dirección de otro edificio.
        let mejor = 0;
        let porQue = '';
        for (const [campo, valor] of [['nombre', nombre], ['edificio', edificio], ['direccion', direccion], ...alias.map(a => ['alias', a])]) {
            const p = puntaje(valor, nombreBuscado);
            if (p > mejor) { mejor = p; porQue = `${campo} "${valor}"`; }
        }

        if (mejor > 0) candidatos.push({ fila, puntaje: mejor, porQue });
    }

    if (!candidatos.length) return null;

    const mejorPuntaje = Math.max(...candidatos.map(c => c.puntaje));
    const finalistas = candidatos.filter(c => c.puntaje === mejorPuntaje);

    // Con la mejor evidencia disponible siendo apenas "comparten el nombre de la calle", dos
    // candidatos son dos edificios de la misma calle: elegir uno es tirar una moneda con la
    // dirección a la que va a ir un técnico.
    if (mejorPuntaje === 1 && finalistas.length > 1) {
        console.warn(`🏢 "${nombreBuscado}" podría ser ${finalistas.length} edificios distintos ` +
                     `(${finalistas.map(f => f.porQue).join(' / ')}). No se elige ninguno: ` +
                     `una dirección equivocada manda a alguien a otro lado.`);
        return null;
    }

    return finalistas[0];
}

module.exports = { elegirFilaEdificio, puntaje, norm, numeros, palabras };
