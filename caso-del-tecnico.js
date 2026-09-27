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
 * ## Descartar el caso ya cerrado no es lo mismo que olvidarlo
 *
 * > [!CAUTION]
 * > **Que el caso de la conversación esté cerrado ES la respuesta cuando el técnico repite que
 * > terminó.** Descartarlo en silencio le muestra un Marcos que no se acuerda de lo que hizo hace
 * > un minuto.
 *
 * Producción, 26/09 a la noche. Dos mensajes seguidos de Dario, y el log de los dos:
 *
 *     "Hola ya termine" → es el caso activo de la conversación (CASO-1005) → RESUELTO ✅
 *     "Ya finalice"     → tiene 2 casos abiertos y ninguna pista dice cuál: se le pregunta
 *
 * El primero hizo exactamente lo que tenía que hacer. El segundo también --con el 1005 ya cerrado
 * quedaban el 1003 y el 1004, y con dos no se adivina-- y quedó mal igual: le llegó *"¿cuál es el
 * que terminaste?"* con una lista de la que el caso que acababa de cerrar **ya no estaba**.
 *
 * Y lo peor no es el desconcierto: **si elegía el 1️⃣ cerraba el CASO-1004, que no había tocado.**
 * La lista lo empujaba a eso.
 *
 * Por eso ese caso vuelve aparte, en `yaCerrado`, y quien llama lo dice **antes** de preguntar
 * nada. Se exige que esté entre **sus** casos recientes --la ventana de `dias`-- porque
 * `eventoActivoId` vive en RAM y puede ser de hace mucho: nombrar un caso de la semana pasada como
 * si fuera el de ahora es volver al mismo problema por el otro lado.
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
 * Dos códigos de caso son el mismo.
 *
 * Se comparan **los dígitos y sin los ceros de adelante**, no el texto: el mismo caso se escribe
 * `CASO-1005`, `caso 1005` y `1005` según de dónde salga, y `codigo_caso` e `id_evento` son dos
 * columnas para el mismo dato. Los ceros se ignoran por lo mismo que `00001-284` y `0001-284` son
 * la misma factura.
 */
function mismoCodigo(a, b) {
    const soloNum = v => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
    const na = soloNum(a);
    return Boolean(na) && na === soloNum(b);
}

/**
 * @param {object}  opts
 * @param {string}  opts.telefono   el teléfono desde el que escribe.
 * @param {string}  opts.nombre     su nombre, para buscar sus casos.
 * @param {Map}     [opts.colas]    `global.colasProveedores`. Se puede pasar para probar.
 * @param {number}  [opts.dias]     cuántos días atrás mirar (7 por defecto).
 * @param {object}  [opts.datos]    inyección para las pruebas; por defecto `require('./datos')`.
 *
 * @returns {Promise<{caso:object|null, candidatos:object[], yaCerrado:object|null, motivo:string}>}
 *          `caso` es el elegido, o `null` si no se puede decidir.
 *          `candidatos` son sus casos abiertos, para preguntarle cuál.
 *          `yaCerrado` es el caso del que venía hablando **si ya está cerrado**: no sirve para
 *          cerrarlo otra vez, sirve para decírselo antes de preguntarle nada.
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
    let cerradoEnMemoria = null;
    if (idEnMemoria) {
        const c = await buscarCasoPorCodigo(idEnMemoria).catch(() => null);
        if (c && !c.cerrado) {
            return {
                caso: c, candidatos: [c], yaCerrado: null,
                motivo: `es el caso activo de la conversación (${idEnMemoria})`
            };
        }
        // Cerrado no se reusa para cerrar, pero tampoco se tira: es lo que hay que contestarle si
        // está repitiendo que terminó.
        if (c && c.cerrado) cerradoEnMemoria = c;
    }

    let suyos = [];
    try {
        suyos = (await buscarCasosRecientesPorTecnico(nombre, telefono, dias)) || [];
    } catch (e) {
        return { caso: null, candidatos: [], yaCerrado: null, motivo: `no se pudieron leer sus casos: ${e.message}` };
    }

    // Que el caso cerrado esté entre SUS casos recientes es lo que lo hace nombrable: acota a la
    // ventana de `dias` y confirma que es suyo. `eventoActivoId` sale de la RAM del proceso y puede
    // ser de hace una semana.
    const yaCerrado = cerradoEnMemoria && suyos.some(c => mismoCodigo(c.id_evento, cerradoEnMemoria.id_evento))
        ? cerradoEnMemoria
        : null;
    const yaDicho = yaCerrado ? `; el ${yaCerrado.id_evento} ya estaba cerrado` : '';

    const abiertos = suyos.filter(c => !c.cerrado && c.edificio);

    if (!abiertos.length) {
        return {
            caso: null, candidatos: [], yaCerrado,
            motivo: `no tiene ningún caso abierto (memoria: ${idEnMemoria || 'vacía'})${yaDicho}`
        };
    }

    // 2. El que está esperando que confirme.
    const esperando = abiertos.filter(c => ESPERA_CONFIRMACION.test(String(c.estado || '')));
    if (esperando.length === 1) {
        return {
            caso: esperando[0], candidatos: abiertos, yaCerrado,
            motivo: `es el único suyo esperando confirmación`
        };
    }

    // 3. Su único caso abierto.
    if (abiertos.length === 1) {
        return { caso: abiertos[0], candidatos: abiertos, yaCerrado, motivo: `es su único caso abierto` };
    }

    // Con dos o más no se adivina.
    return {
        caso: null, candidatos: abiertos, yaCerrado,
        motivo: `tiene ${abiertos.length} casos abiertos y ninguna pista dice cuál: se le pregunta${yaDicho}`
    };
}

module.exports = { casoActivoDelTecnico, ESPERA_CONFIRMACION, mismoCodigo };
