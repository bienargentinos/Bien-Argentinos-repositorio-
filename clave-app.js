/**
 * LA CLAVE DE LAS APPS QUE NO TIENEN SESIÓN DE NAVEGADOR
 *
 * > [!CAUTION]
 * > **Una app móvil no tiene sesión de navegador, y la forma rápida de que funcione es sacar el
 * > control de acceso.** Eso es lo que pasó con `/api/pases-qr`, y lo que dejó abierta a internet
 * > la creación de pases para abrir la puerta de cualquier edificio.
 *
 * El commit decía `permitir acceso a /api/pases-qr sin sesion web de dashboard para EdificaApp` y
 * eran cuatro líneas dentro de `requireAuth`. Con eso, cualquiera podía:
 *
 * - **Crear** un pase para el edificio que quisiera --el edificio viene en el cuerpo del pedido--
 *   con `tipo_pase: "recurrente"`, que dura seis meses.
 * - **Leer** los últimos 150 pases de TODOS los edificios, con sus tokens: ni hacía falta crear uno,
 *   alcanzaba con usar los que ya funcionaban. De paso salían nombres de visitantes y departamentos.
 * - **Revocar** pases ajenos, o sea dejar afuera a la persona de limpieza.
 *
 * Y con `Access-Control-Allow-Origin: *` sobre esa ruta, todo eso desde cualquier página web.
 *
 * Acá la app manda una clave en una cabecera y el servidor la exige cuando no hay sesión. La app
 * sigue funcionando; internet no.
 */

const crypto = require('crypto');

/**
 * Compara dos claves sin filtrar información por el tiempo que tarda.
 *
 * Un `===` sobre dos textos responde más rápido cuando difieren en el primer carácter que en el
 * último, y con suficientes intentos eso alcanza para adivinar la clave de a un byte.
 */
function claveValida(recibida, esperada) {
    if (!esperada || !recibida) return false;
    const a = Buffer.from(String(esperada), 'utf8');
    const b = Buffer.from(String(recibida), 'utf8');
    // `timingSafeEqual` tira si los largos difieren. Comparar el largo primero filtra el largo de
    // la clave, que no es un dato que sirva para adivinarla.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Middleware: pasa si hay sesión del panel, o si el pedido trae la clave de la app.
 *
 * > [!CAUTION]
 * > **Sin `EDIFICA_API_KEY` configurada se RECHAZA, y acá eso es lo contrario de lo que hace el
 * > webhook de Meta.** No es una inconsistencia: es la misma pregunta con la respuesta al revés.
 * >
 * > En el webhook, fallar cerrado deja a Marcos sordo y el costo de fallar abierto es un mensaje
 * > falso. Acá, fallar abierto es **la puerta de un edificio abierta a internet** y el costo de
 * > fallar cerrado es que una app que todavía está en desarrollo no funcione hasta que se configure
 * > la variable. De los dos errores posibles se elige siempre el que se puede deshacer.
 *
 * @param {object}   opts
 * @param {string}   opts.clave     El valor de `EDIFICA_API_KEY`.
 * @param {function} opts.haySesion Cómo se pregunta si hay sesión del panel.
 * @param {string}   opts.nombre    Para el log.
 */
function exigirSesionOClaveDeApp({ clave, haySesion, nombre = 'endpoint' } = {}) {
    let yaAviso = false;

    return function (req, res, next) {
        if (typeof haySesion === 'function' && haySesion(req)) return next();

        if (!clave) {
            if (!yaAviso) {
                console.error(`🔒 ${nombre}: EDIFICA_API_KEY no está en el .env, así que los pedidos ` +
                    `sin sesión del panel se RECHAZAN. La app de Edifica no va a poder crear pases ` +
                    `hasta que se configure. Se elige a propósito: acá dejar pasar sería dejar abierta ` +
                    `la creación de pases de acceso a internet.`);
                yaAviso = true;
            }
            return res.status(503).json({
                ok: false,
                error: 'app_sin_clave',
                mensaje: 'Falta configurar EDIFICA_API_KEY en el servidor.',
            });
        }

        if (claveValida(req.get('x-edifica-key'), clave)) {
            // Queda marcado que el pedido viene de la app y no de una persona con sesión: los
            // endpoints usan esto para no devolver datos de todos los edificios de una.
            req.esAppExterna = true;
            return next();
        }

        console.error(`⛔ ${nombre}: se rechazó un pedido sin sesión y sin la clave de la app. ` +
            `Origen: ${req.ip || 'desconocido'}.`);
        return res.status(401).json({ ok: false, error: 'no_autorizado' });
    };
}

module.exports = { claveValida, exigirSesionOClaveDeApp };
