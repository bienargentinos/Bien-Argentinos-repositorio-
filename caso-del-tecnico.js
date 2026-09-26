/**
 * DE QUÉ CASO ESTÁ HABLANDO EL TÉCNICO
 *
 * > [!CAUTION]
 * > **Esta búsqueda estaba escrita dos veces y estaba por escribirse una tercera.** Es el mismo
 * > defecto que costó caro con `buscarPerfilEdificio` --dos copias, en `sheets.js` y en
 * > `datos-pg.js`, y arreglar una no cambió nada en producción porque el motor leía la otra--.
 *
 * Tres fuentes, de la más precisa a la más general. El orden no es estético: cada escalón es más
 * barato de acertar y más caro de errar que el anterior.
 *
 *   1. **El caso que la conversación tiene abierto** (`eventoActivoId` de la cola en RAM).
 *      El código sale de la memoria, pero **el caso se relee de la base**: la memoria dice de qué
 *      se está hablando, la base dice la verdad. Si ya se cerró, no se reusa.
 *   2. El caso suyo que **espera confirmación** (estado `avisado` o `sin confirmar`).
 *   3. Su **único** caso abierto, esté en el estado que esté.
 *
 * Con **dos o más** abiertos y ninguna de las dos primeras pistas, **no se elige**: se devuelven
 * los candidatos para que quien llama pregunte. Adivinar manda al técnico --y la factura, y el
 * cierre-- al consorcio equivocado. Preguntar molesta; elegir mal cuesta plata.
 *
 * ## Por qué NO sirve el camino del vecino
 *
 * El cierre de un caso en `index.js` arrancaba así, y sigue así para el vecino:
 *
 *     const edificioParaCierre = session.nombreEdificio || vecinosEnSheets?.[0]?.edificio || …;
 *     const casosAbiertos = await obtenerCasosAbiertosEdificio(edificioParaCierre);
 *
 * Las tres fuentes son del VECINO. Un proveedor no tiene ninguna: no tiene sesión de edificio y no
 * está en `vecinos`. Queda `''`, y con el edificio vacío esa consulta devuelve **todos los casos
 * abiertos del sistema**. Visto el 21/09/2026: Dario escribió *"Pero ya lo resolví que querés? Ya
 * te dije q resolvi"* y en vez de cerrar su caso le llegó la lista de todos los reclamos abiertos
 * de todos los edificios, pidiéndole que eligiera un número.
 *
 * El técnico sí tiene un caso conocido. Es este.
 *
 * Prueba: `node pruebas-caso-del-tecnico.js`.
 */

'use strict';

/** Lo que dice que un caso todavía espera que el técnico confirme si va. */
const ESPERA_CONFIRMACION = /avisad|sin confirmar/i;

/**
 * @param {object}  opts
 * @param {string}  opts.telefono   el teléfono desde el que escribe.
 * @param {string}  opts.nombre     su nombre, para buscar sus casos.
 * @param {Map}     [opts.colas]    `global.colasProveedores`. Se puede pasar para probar.
 * @param {number}  [opts.dias]     cuántos días atrás mirar (7 por defecto).
 * @param {object}  [opts.datos]    inyección para las pruebas; por defecto `require('./datos')`.
 *
 * @returns {Promise<{caso:object|null, candidatos:object[], motivo:string}>}
 *          `caso` es el elegido, o `null` si no se puede decidir.
 *          `candidatos` son sus casos abiertos, para preguntarle cuál.
 *          `motivo` dice POR QUÉ se eligió ese, y va al log: con dos casos abiertos, saber a cuál
 *          se le imputó todo es la diferencia entre encontrar un problema en cinco minutos o en
 *          una semana.
 */
async function casoActivoDelTecnico({ telefono, nombre, colas, dias = 7, datos } = {}) {
    const d = datos || require('./datos');
    const { buscarCasoPorCodigo, buscarCasosRecientesPorTecnico } = d;

    const mapa = colas || (typeof global !== 'undefined' ? global.colasProveedores : null);
    const cola = mapa?.get?.(String(telefono || '').replace(/\D/g, ''));
    const idEnMemoria = cola?.eventoActivoId || '';

    // 1. El caso que la conversación ya tiene abierto.
    if (idEnMemoria) {
        const c = await buscarCasoPorCodigo(idEnMemoria).catch(() => null);
        if (c && !c.cerrado) {
            return { caso: c, candidatos: [c], motivo: `es el caso activo de la conversación (${idEnMemoria})` };
        }
    }

    let suyos = [];
    try {
        suyos = (await buscarCasosRecientesPorTecnico(nombre, telefono, dias)) || [];
    } catch (e) {
        return { caso: null, candidatos: [], motivo: `no se pudieron leer sus casos: ${e.message}` };
    }

    const abiertos = suyos.filter(c => !c.cerrado && c.edificio);

    if (!abiertos.length) {
        return {
            caso: null, candidatos: [],
            motivo: `no tiene ningún caso abierto (memoria: ${idEnMemoria || 'vacía'})`
        };
    }

    // 2. El que está esperando que confirme.
    const esperando = abiertos.filter(c => ESPERA_CONFIRMACION.test(String(c.estado || '')));
    if (esperando.length === 1) {
        return { caso: esperando[0], candidatos: abiertos, motivo: `es el único suyo esperando confirmación` };
    }

    // 3. Su único caso abierto.
    if (abiertos.length === 1) {
        return { caso: abiertos[0], candidatos: abiertos, motivo: `es su único caso abierto` };
    }

    // Con dos o más no se adivina.
    return {
        caso: null, candidatos: abiertos,
        motivo: `tiene ${abiertos.length} casos abiertos y ninguna pista dice cuál: se le pregunta`
    };
}

module.exports = { casoActivoDelTecnico, ESPERA_CONFIRMACION };
