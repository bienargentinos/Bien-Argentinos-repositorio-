// LA EXPENSA DE UN VECINO NO SE SIRVE A CUALQUIERA
//
// > [!CAUTION]
// > **Los PDF de expensas estaban en una carpeta pública, con nombre adivinable.**
//
// `index.js` sirve `almacenamiento/` entero con `express.static` bajo `/archivos` y `/audios`, y
// el panel guardaba las expensas en `almacenamiento/expensas/expensa_<Date.now()>.pdf`.
//
// Mientras hubo **una expensa por edificio** eso no importaba: la veían todos los vecinos igual,
// por diseño. Desde que hay **una por unidad, con el monto que debe cada uno**, el mismo archivo
// pasó a ser el dato privado de una persona — y seguía estando a un `GET` de distancia de
// cualquiera.
//
// El filtrado por unidad del portal no alcanza: protege la pantalla, no el archivo. Y estas URL
// circulan solas — Marcos comparte la expensa por WhatsApp, el vecino la reenvía, y el enlace
// sigue funcionando para siempre, para cualquiera que lo tenga.
//
// Es la misma lección de `/api/pases-qr`, donde sacar el control de acceso para que una app
// funcionara dejó la puerta de calle de un edificio abierta a internet.
//
// ── HAY TRES PUERTAS AL MISMO ARCHIVO, NO UNA ───────────────────────────────
//
// Bloquear `/archivos/expensas/` habría parecido suficiente y no lo era:
//
//   1. `app.use('/archivos', express.static(almacenamiento))`  → /archivos/expensas/expensa_x.pdf
//   2. `app.use('/audios',   express.static(almacenamiento))`  → /audios/expensas/expensa_x.pdf
//   3. `servirOConvertirMedia` busca **por nombre suelto y recursivo** dentro de `almacenamiento`
//      → /archivos/expensa_x.pdf lo encuentra igual, sin la carpeta en el medio.
//
// Por eso la regla mira el **nombre del archivo** y no la ruta: una regla por ruta deja abierta
// la tercera puerta y el arreglo parece hecho.
//
// ── POR QUÉ SE BLOQUEA A TODOS, INCLUSO A QUIEN TIENE DERECHO ───────────────
//
// El panel y el portal montan cada uno su propia sesión de Express, con su propio almacén en
// memoria. Un middleware puesto acá arriba --antes de los dos routers-- **no puede leer ninguna
// de las dos**: una tercera instancia de `session()` arrancaría con un almacén vacío y no vería
// nada. Cualquier intento de decidir el permiso desde este punto sería teatro.
//
// Así que acá se cierra y punto. Quien tenga derecho a ver una expensa la recibe por la ruta de
// SU router, que sí conoce a quien pregunta, leyendo el archivo del disco con `rutaDelArchivo()`
// y decidiendo con `puedeVerExpensa()` --las dos exportadas acá abajo, para que no haya dos
// criterios distintos de quién puede ver qué--.
//
// Fallar cerrado cuesta que la sección no funcione hasta que esas rutas existan. Fallar abierto
// cuesta la deuda de un vecino en una dirección que se puede reenviar. De los dos errores se
// elige el que se puede deshacer, que es la regla de siempre en este proyecto.

'use strict';

const path = require('path');

/**
 * ¿Este pedido es por un archivo de expensas?
 *
 * Mira el nombre, no la carpeta, porque hay tres caminos que llegan al mismo archivo y uno de
 * ellos no pasa por la carpeta.
 */
function esArchivoDeExpensa(rutaPedida) {
    let crudo = String(rutaPedida || '');
    try { crudo = decodeURIComponent(crudo); } catch (_) { /* se usa tal cual */ }

    const nombre = path.basename(crudo).toLowerCase();

    // Como lo nombra el panel al guardarlo: `expensa_1758658800000.pdf`.
    if (/^expensa[_-]/.test(nombre)) return true;

    // Y por las dudas, cualquier cosa servida desde la carpeta de expensas: si mañana el panel
    // cambia cómo nombra el archivo, esto lo sigue tapando.
    if (/(^|\/)expensas\//i.test(crudo.replace(/\\/g, '/'))) return true;

    return false;
}

/**
 * Middleware: corta el acceso público a las expensas.
 *
 * Va montado ANTES de los `express.static` y del buscador por nombre suelto. Si va después, los
 * archivos ya se sirvieron y esto no se ejecuta nunca.
 */
function guardiaExpensas(req, res, next) {
    if (!esArchivoDeExpensa(req.path)) return next();

    console.warn(`🔒 Expensa pedida por la vía pública y RECHAZADA: ${req.path}` +
                 ` (desde ${req.ip || 'origen desconocido'}). Las expensas se sirven por la ruta` +
                 ` del panel o del portal, que saben quién pregunta.`);

    return res.status(403).json({
        error: 'Las expensas no se sirven por esta vía.',
        detalle: 'Entrá desde el portal del vecino o desde el panel: una expensa es de una unidad, ' +
                 'no de cualquiera que tenga el enlace.',
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// QUIÉN PUEDE VER CUÁL
// ─────────────────────────────────────────────────────────────────────────────

const norm = (t) => String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * ¿Esta persona puede ver esta expensa?
 *
 * `expensa`  — la fila: `{ edificio, departamento }`. `departamento` vacío = liquidación general.
 * `quien`    — `{ rol, edificios, edificio, departamento, puede_ver_expensas }`.
 *
 * Devuelve `{ puede, motivo }`. El motivo se escribe para que quede en el log del que lo rechazó:
 * un 403 sin explicación manda a buscar el problema al lugar equivocado.
 *
 * > [!CAUTION]
 * > **La unidad del vecino sale de lo que tiene asignado, NUNCA de lo que viene en el pedido.**
 * > Si se tomara del pedido, cualquiera pediría la expensa de su vecino escribiendo su número de
 * > unidad. Es exactamente el agujero que tenía `/api/pases-qr`.
 */
function puedeVerExpensa({ expensa, quien } = {}) {
    const no = (motivo) => ({ puede: false, motivo });
    if (!expensa) return no('no se encontró la expensa');
    if (!quien || !quien.rol) return no('no hay sesión: no se sabe quién pregunta');

    const edExpensa = norm(expensa.edificio);
    if (!edExpensa) return no('la expensa no tiene edificio: no se puede saber de quién es');

    // El dueño ve todo: es quien administra el sistema.
    if (quien.rol === 'dueno') return { puede: true, motivo: '' };

    // El administrador del consorcio ve las de SUS edificios, todas las unidades incluidas: es
    // quien las emitió.
    if (quien.rol === 'consorcio') {
        const suyos = (quien.edificios || []).map(norm).filter(Boolean);
        if (!suyos.length) return no('el cliente no tiene ningún edificio asignado');
        return suyos.includes(edExpensa)
            ? { puede: true, motivo: '' }
            : no(`la expensa es de "${expensa.edificio}", que no es de este cliente`);
    }

    // El vecino.
    if (quien.rol === 'vecino') {
        if (quien.puede_ver_expensas === false) {
            return no('esta unidad no tiene habilitado ver expensas');
        }
        if (norm(quien.edificio) !== edExpensa) {
            return no('la expensa es de otro edificio');
        }

        const deptoExpensa = norm(expensa.departamento);

        // Sin departamento es la liquidación general: la ven todos los del edificio, y tiene que
        // ser así --es la que explica en qué se gastó la plata del consorcio--.
        if (!deptoExpensa) return { puede: true, motivo: '' };

        // Con departamento, solo esa unidad. La comparación usa la misma normalización que el
        // resto del proyecto: tolerante con la forma, intolerante con el contenido.
        const { normalizarUnidad } = require('./expensa-documento');
        const suya = normalizarUnidad(quien.departamento);
        const deLaExpensa = normalizarUnidad(expensa.departamento);

        // Que falte el dato NO es un comodín: es la condición normal de una ficha a medias, no una
        // autorización. Mismo criterio que el timbre con `!edNorm`.
        if (!suya || !deLaExpensa) return no('falta la unidad de un lado: no se puede afirmar');

        return suya === deLaExpensa
            ? { puede: true, motivo: '' }
            : no('la expensa es de otra unidad');
    }

    return no(`rol desconocido: "${quien.rol}"`);
}

/** Dónde vive de verdad el archivo de una expensa, para que lo sirva quien sí sabe quién pregunta. */
function rutaDelArchivo(url) {
    const nombre = path.basename(String(url || ''));
    if (!nombre || nombre.includes('..')) return null;
    return path.join(__dirname, 'almacenamiento', 'expensas', nombre);
}

module.exports = { esArchivoDeExpensa, guardiaExpensas, puedeVerExpensa, rutaDelArchivo };
