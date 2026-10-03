/**
 * EL VECINO ABRE LA PUERTA DESDE EL CELULAR
 *
 * Apretar el botón para que entre el delivery es lo que más se usa de un portero eléctrico. Es EL
 * gesto. Pero un portero de pared se aprieta **desde adentro del departamento**, y un celular se
 * aprieta desde cualquier parte del mundo — así que la misma acción, con el mismo nombre, pasó a
 * ser otra cosa.
 *
 * Por eso esto es un archivo de política y no cuatro líneas adentro del endpoint: lo que decide
 * quién puede abrir una puerta de calle merece estar en un lugar, con sus pruebas.
 *
 * ## Los tres modos, y por qué son tres y no dos
 *
 * | Modo | Cuándo abre | Para quién |
 * |---|---|---|
 * | `off` | nunca | consorcios que no lo quieren |
 * | `con_llamada` | solo mientras suena un timbre de SU unidad | **el default** |
 * | `siempre` | en cualquier momento | quien mira la cámara y abre sin que toquen |
 *
 * `con_llamada` es el default a propósito: es lo más parecido al portero de pared. El timbre
 * sonando es lo que reemplaza al "estoy en mi casa" — se corta la llamada, se corta el botón.
 *
 * `siempre` existe porque Daniel lo pidió con un caso real: *"a veces se abre viendo la cámara sin
 * llamar"*. Es legítimo y es cómodo. También es más riesgoso, y **la decisión es del consorcio, no
 * nuestra**: por eso es una opción del edificio y no una constante del código.
 *
 * > [!CAUTION]
 * > **`sesionVecinoEstricta` existe porque `getVecinoSession` de `portal-vecino.js` devuelve un
 * > vecino de prueba cuando no hay sesión** — propietario del 1°A de San Patricio 159, con nombre y
 * > todo. Para un portal de demostración está bien. Acá significaría que **cualquiera que llame al
 * > endpoint sin sesión abre la puerta**.
 * >
 * > Es el mismo defecto que ya apareció tres veces en este proyecto, siempre disfrazado de
 * > comodidad: el `!edNorm` que hacía comodín a la falta de edificio, el `size === 1` que le daba
 * > la única llamada a quien preguntara, y el `PASS-` que abría con la base caída. **Un default de
 * > prueba convertido en autorización.**
 *
 * Prueba: `node pruebas-apertura-remota.js`.
 */

'use strict';

const { mismoEdificio, claveUnidad } = require('./edificio-clave');

/** Los modos válidos. Cualquier otra cosa se trata como el default. */
const MODOS = ['off', 'con_llamada', 'siempre'];
const MODO_POR_DEFECTO = 'con_llamada';

/**
 * El vecino de la sesión, o `null`.
 *
 * > [!CAUTION]
 * > **Nunca devuelve un vecino de prueba.** Si no hay sesión, no hay vecino. Esa es toda la
 * > función, y es la razón por la que existe.
 */
function sesionVecinoEstricta(req) {
    const v = req && req.session && req.session.vecino;
    if (!v || typeof v !== 'object') return null;
    if (!v.usuario_id) return null;
    if (!String(v.edificio || '').trim()) return null;
    return v;
}

/**
 * En qué modo está el edificio.
 *
 * Sin configuración cargada vale `con_llamada`, que es el más parecido al portero de toda la vida.
 * **No se cae a `siempre` ante la duda**: un edificio al que nadie le configuró nada no autorizó
 * la apertura sin timbre.
 */
function modoDelEdificio(perfil) {
    const crudo = String(
        (perfil && (perfil.apertura_remota || perfil.aperturaRemota)) || ''
    ).toLowerCase().trim().replace(/[\s-]+/g, '_');

    if (crudo === 'no' || crudo === 'deshabilitado' || crudo === 'desactivado') return 'off';
    if (crudo === 'si' || crudo === 'sí' || crudo === 'habilitado') return 'siempre';
    return MODOS.includes(crudo) ? crudo : MODO_POR_DEFECTO;
}

/**
 * De las unidades del vecino, la que corresponde al edificio y depto pedidos.
 *
 * > [!CAUTION]
 * > **El edificio y la unidad NO se toman del pedido a secas.** Si vinieran del cuerpo sin
 * > verificar, un vecino del 159 podría pedir que se abra el 270. Lo que llega se compara contra
 * > SUS unidades; si no viene nada, se usa la unidad activa de su sesión.
 */
function unidadDelVecino(vecino, edificioPedido, unidadPedida) {
    if (!vecino) return null;

    const suyas = Array.isArray(vecino.unidades) && vecino.unidades.length
        ? vecino.unidades
        : [{ edificio: vecino.edificio, departamento: vecino.departamento, rol: vecino.rol }];

    // Sin pedido explícito: la unidad activa de la sesión.
    if (!String(edificioPedido || '').trim()) {
        return suyas.find(u => mismoEdificio(u.edificio, vecino.edificio)) || suyas[0] || null;
    }

    const dep = claveUnidad(unidadPedida);
    return suyas.find(u =>
        mismoEdificio(u.edificio, edificioPedido)
        && (!dep || claveUnidad(u.departamento) === dep)
    ) || null;
}

/**
 * ¿Puede abrir?
 *
 * Devuelve `{ permitido, motivo, edificio, unidad }`. El `motivo` se escribe en el log y en el
 * registro de accesos: cuando alguien pregunte por qué no le abrió, la respuesta tiene que estar
 * escrita y no deducirse.
 *
 * @param vecino   lo que devolvió `sesionVecinoEstricta`. `null` es un no.
 * @param modo     `off` | `con_llamada` | `siempre`.
 * @param llamada  la llamada de timbre activa de esa unidad, si la hay.
 */
function puedeAbrir({ vecino, modo, edificioPedido = '', unidadPedida = '', llamada = null } = {}) {
    const no = (motivo) => ({ permitido: false, motivo, edificio: '', unidad: '' });

    if (!vecino) return no('no hay sesión de vecino');

    const unidad = unidadDelVecino(vecino, edificioPedido, unidadPedida);
    if (!unidad) return no('el vecino no tiene esa unidad');

    const edificio = String(unidad.edificio || '').trim();
    if (!edificio) return no('la unidad no dice de qué edificio es');

    const m = MODOS.includes(modo) ? modo : MODO_POR_DEFECTO;
    if (m === 'off') return no('el edificio tiene la apertura remota deshabilitada');

    if (m === 'con_llamada') {
        if (!llamada) return no('no hay ningún timbre sonando en esa unidad');
        // Que la llamada sea de SU edificio y SU unidad. `encontrarLlamadaActiva` ya lo verifica,
        // pero esto no depende de que el llamador la haya buscado bien: si mañana alguien pasa la
        // llamada equivocada, acá se corta igual.
        if (!mismoEdificio(llamada.edificio, edificio)) return no('la llamada es de otro edificio');
        const dep = claveUnidad(unidad.departamento);
        if (dep && claveUnidad(llamada.departamento) !== dep) return no('la llamada es de otra unidad');
        if (llamada.estado === 'cortado') return no('la llamada ya se cortó');
        if (llamada.abrioLaPuerta) return no('ya se abrió la puerta para esta llamada');
    }

    return {
        permitido: true,
        motivo: m === 'siempre' ? 'apertura remota del vecino' : 'apertura remota durante el timbre',
        edificio,
        unidad: String(unidad.departamento || '').trim(),
    };
}

module.exports = { sesionVecinoEstricta, modoDelEdificio, unidadDelVecino, puedeAbrir, MODOS, MODO_POR_DEFECTO };
