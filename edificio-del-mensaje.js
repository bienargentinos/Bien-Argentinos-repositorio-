/**
 * ¿QUÉ EDIFICIO NOMBRA ESTE MENSAJE?
 *
 * > [!CAUTION]
 * > **Un vecino tiene UN teléfono y puede tener la vivienda en un edificio y la oficina en otro.**
 * > El reclamo de uno no es el del otro, y en el medio hay dos consorcios que pagan cosas distintas.
 *
 * Planteado por Daniel, 27/09: *"el vecino tiene un número pero puede tener vivienda y oficina en
 * distintos lados y el reclamo de un edificio no es del otro"*.
 *
 * ## El bug que lo originó, tercera copia del mismo
 *
 * `buscarEdificioEnTexto` en `index.js` decidía así:
 *
 *     const nums = campo.match(/\d+/g) || [];
 *     return nums.includes(num);          // ← cualquier número, en cualquier campo
 *
 * O sea: **cualquier número del mensaje que apareciera en cualquier campo de cualquier edificio del
 * sistema** fijaba el edificio de ese vecino. *"se cortó la luz en el piso 4"* podía asignarlo a un
 * edificio cuya altura es 4. Y un `270` escrito en los alias de la fila del 159 avalaba al 159.
 *
 * Es exactamente lo que ya se arregló en `perfil-edificio.js`, que lo dice con todas las letras:
 * *"el número solo no identifica nada"*. Esta es la tercera copia de ese defecto en el repo.
 *
 * ## La regla, y por qué es al revés que `elegirFilaEdificio`
 *
 * `perfil-edificio.js` responde *"¿cuál fila es el edificio que busco?"* — compara dos textos que
 * los dos quieren ser un edificio. Acá la pregunta es otra: *"¿este MENSAJE, que habla de cualquier
 * cosa, nombra este edificio?"*. El mensaje trae números de piso, de unidad, de cantidad y de hora,
 * así que la comparación no puede ser simétrica.
 *
 * Por cada edificio, **cada campo por separado** (nombre, dirección, cada alias):
 *
 *   3 — el mensaje contiene el campo entero: *"…en san patricio 159 hay agua"*.
 *   2 — el mensaje nombra la calle Y la altura del campo.
 *   1 — el mensaje nombra la calle y no dice ninguna altura. Es una pista, no una certeza.
 *   ✗ — el mensaje trae alturas y NINGUNA es la del campo: son dos direcciones distintas.
 *   ✗ — el mensaje no nombra la calle. **Un número suelto no alcanza nunca.**
 *
 * Y si lo mejor que hay es un 1 con más de un candidato, **no se elige**: dos edificios de la misma
 * calle son dos consorcios. Se devuelve `null` y quien llama pregunta, que es lo que ya hace.
 *
 * Las funciones de normalización se importan de `perfil-edificio.js` a propósito: un cuarto
 * normalizador de direcciones en este repo sería el próximo lugar donde esto se desincroniza.
 *
 * Prueba: `node pruebas-edificio-del-mensaje.js`.
 */

'use strict';

const { norm, numeros, palabras } = require('./perfil-edificio');

/**
 * Cuánta confianza hay en que ESE MENSAJE nombre ESE CAMPO de un edificio.
 *
 * @param {string} mensaje  lo que escribió la persona, entero.
 * @param {string} campo    el nombre, la dirección o un alias del edificio.
 */
function puntajeEnMensaje(mensaje, campo) {
    const m = norm(mensaje);
    const c = norm(campo);
    if (!m || !c || c.length < 3) return 0;

    if (m.includes(c)) return 3;

    // La calle es lo único que identifica. Sin una palabra suya en el mensaje no hay nada que
    // discutir: un número solo puede ser un piso, una unidad, una cantidad o una hora.
    const palC = palabras(c);
    if (!palC.length) return 0;

    const palM = palabras(m);
    if (!palC.some(p => palM.includes(p))) return 0;

    const numsC = numeros(c);
    const numsM = numeros(m);

    if (numsC.length) {
        // El campo tiene altura. Si el mensaje trae números y ninguno es esa altura, son dos
        // direcciones distintas de la misma calle: el 270 y el 159 no son el mismo consorcio.
        if (numsM.length && !numsC.some(n => numsM.includes(n))) return 0;
        if (numsM.length) return 2;   // misma calle y misma altura
    }

    return 1;                          // nombró la calle, no dijo altura
}

/**
 * Qué edificio de la lista nombra este mensaje.
 *
 * @param {string} mensaje
 * @param {object[]} edificios  cada uno con `nombre` / `edificio`, `direccion`, `aliases`.
 *
 * @returns {{edificio:object, puntaje:number, porQue:string}|null}
 *          `null` cuando no nombra ninguno **o cuando podrían ser varios**. Las dos cosas
 *          significan lo mismo para quien llama: preguntale.
 */
function edificioNombradoEnMensaje(mensaje, edificios) {
    if (!mensaje || !Array.isArray(edificios) || !edificios.length) return null;

    const candidatos = [];

    for (const e of edificios) {
        const aliasCrudo = e.aliases;
        const alias = Array.isArray(aliasCrudo)
            ? aliasCrudo
            : String(aliasCrudo || '').split(',');

        const campos = [
            ['nombre',    e.nombre],
            ['edificio',  e.edificio],
            ['direccion', e.direccion],
            ...alias.map(a => ['alias', String(a || '').trim()]),
        ].filter(([, v]) => v);

        let mejor = 0;
        let porQue = '';
        for (const [campo, valor] of campos) {
            const p = puntajeEnMensaje(mensaje, valor);
            if (p > mejor) { mejor = p; porQue = `${campo} "${valor}"`; }
        }

        if (mejor > 0) candidatos.push({ edificio: e, puntaje: mejor, porQue });
    }

    if (!candidatos.length) return null;

    const mejorPuntaje = Math.max(...candidatos.map(c => c.puntaje));
    const finalistas = candidatos.filter(c => c.puntaje === mejorPuntaje);

    // Nombró una calle donde hay dos consorcios y no dijo la altura. Elegir uno es tirar una
    // moneda con a qué edificio se le imputa el reclamo.
    if (mejorPuntaje === 1 && finalistas.length > 1) {
        console.warn(`🏢 El mensaje podría hablar de ${finalistas.length} edificios distintos ` +
                     `(${finalistas.map(f => f.porQue).join(' / ')}). No se elige ninguno: se pregunta.`);
        return null;
    }

    // Con el mejor puntaje empatado entre dos filas distintas tampoco se adivina.
    const distintos = new Set(finalistas.map(f => norm(f.edificio.nombre || f.edificio.edificio || '')));
    if (distintos.size > 1) {
        console.warn(`🏢 Dos edificios empatan en ${mejorPuntaje} ` +
                     `(${finalistas.map(f => f.porQue).join(' / ')}). No se elige ninguno: se pregunta.`);
        return null;
    }

    return finalistas[0];
}

module.exports = { edificioNombradoEnMensaje, puntajeEnMensaje };
