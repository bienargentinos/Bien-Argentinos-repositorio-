/**
 * UN QR QUE SE PUEDE VERIFICAR SIN INTERNET
 *
 * > [!CAUTION]
 * > **Acá se corta la luz y se cae internet seguido, y una puerta no puede depender de eso.**
 * > Daniel: *"en Argentina suele fallar internet y luz"*. El reconocimiento facial vive en el
 * > tótem y sigue andando sin red; el QR era lo único que se caía, porque había que preguntarle
 * > a PostgreSQL si el código valía.
 *
 * Y lo que había mientras la base no contestaba era peor que no andar:
 *
 * ```js
 * const esMarcosQr = rawQr.startsWith('MARCOS-') || rawQr.startsWith('PASS-') || rawQr.startsWith('EDIFICA-');
 * validacion = { valido: esMarcosQr, ... };
 * ```
 *
 * O sea: **con la base caída, escribir a mano `PASS-loquesea` abría la puerta de calle.** Y los
 * cortes no son el caso raro: son el caso que pasa.
 *
 * ## Cómo se arregla
 *
 * Un pase firmado **lleva sus datos adentro** y una firma que los sella:
 *
 *     BA1.<edificio|unidad|id|vence>.<HMAC-SHA256>
 *
 * El tótem tiene la clave, así que verifica solo que ese código lo emitimos nosotros y que no
 * venció. Cambiale un carácter y la firma no cierra. Es lo mismo que un pase de embarque.
 *
 * > [!CAUTION]
 * > **La firma prueba que es auténtico y que no venció. NO prueba que no lo revocaste.**
 * > Revocar es un hecho posterior a la emisión y vive en la base; ningún dato adentro del QR puede
 * > saberlo. Por eso:
 * >
 * > - **Con base disponible, decide la base** (`validarConsumirPaseQR`, que ya mira revocación,
 * >   horarios y un solo uso). La firma no la puede contradecir: si alguien borró o revocó un
 * >   pase, la firma vieja no lo resucita.
 * > - **Sin base, decide la firma**, y solo eso — y por eso los pases que se usen offline tienen
 * >   que **vencer corto**: mientras no haya red no hay forma de enterarse de una revocación, así
 * >   que cuanto menos dure el pase, menos expone.
 *
 * ## Una clave por edificio, con un solo secreto
 *
 * Que un tótem comprometido no abra los otros veintisiete. Pero manejar 27 claves a mano es una
 * fuente de errores, así que se **derivan** de un único secreto maestro:
 *
 *     claveDe(edificio) = HMAC(QR_PASES_CLAVE, claveEdificio(nombre))
 *
 * Un solo valor en el `.env`, claves distintas por edificio, y nada que sincronizar.
 *
 * > [!CAUTION]
 * > **Sin `QR_PASES_CLAVE` no se valida ninguna firma, y es a propósito.** Es el mismo criterio
 * > que `clave-app.js` y el contrario al del webhook de Meta, por la misma razón escrita en
 * > CLAUDE.md: acá fallar abierto es la puerta de un edificio abierta a internet, y fallar cerrado
 * > cuesta que los pases offline no anden hasta configurar la variable. **De los dos errores se
 * > elige el que se puede deshacer.**
 * >
 * > Y no rompe nada de lo que funciona hoy: con la base arriba manda la base, como siempre.
 *
 * Prueba: `node pruebas-qr-firmado.js`.
 */

'use strict';

const crypto = require('crypto');
const { claveEdificio, mismoEdificio } = require('./edificio-clave');

/** Marca de versión al principio del token. Si mañana cambia el formato, los viejos se distinguen. */
const PREFIJO = 'BA1';

/**
 * La firma se trunca a 16 bytes (128 bits). Alcanza y sobra contra falsificación --nadie prueba
 * 2^128 códigos frente a una puerta-- y mantiene el QR chico, que es lo que lo hace legible con
 * lluvia, de noche y con la cámara sucia. Un QR más denso es un QR que no escanea.
 */
const BYTES_FIRMA = 16;

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** La clave de ESTE edificio, derivada del secreto maestro. `null` si no hay secreto configurado. */
function claveDelEdificio(edificio, maestra = process.env.QR_PASES_CLAVE) {
    const secreto = String(maestra || '').trim();
    const nombre = claveEdificio(edificio);
    if (!secreto || !nombre) return null;
    return crypto.createHmac('sha256', secreto).update(nombre).digest();
}

function firmar(payload, clave) {
    return b64(crypto.createHmac('sha256', clave).update(payload).digest().subarray(0, BYTES_FIRMA));
}

/**
 * Emite un pase firmado.
 *
 * `vence` es cuándo deja de valer. **No tiene default a propósito**: un pase sin vencimiento es un
 * pase para siempre, y el que lo emite tiene que decidirlo mirando para qué es (una visita de esta
 * tarde no es la persona de limpieza de todos los martes).
 *
 * @returns {string|null} el token, o `null` si falta el secreto o algún dato.
 */
function emitirPaseFirmado({ edificio, unidad = '', id = '', vence, maestra } = {}) {
    const clave = claveDelEdificio(edificio, maestra);
    if (!clave) return null;

    const t = vence instanceof Date ? vence.getTime() : Number(vence);
    if (!t || !isFinite(t)) return null;

    // El vencimiento va en minutos desde la época: doce dígitos menos que en milisegundos, y al
    // segundo no le sirve a nadie para abrir una puerta.
    const datos = [
        claveEdificio(edificio),
        String(unidad || '').replace(/[|]/g, ' ').trim(),
        String(id || '').replace(/[|]/g, ' ').trim(),
        String(Math.floor(t / 60000)),
    ].join('|');

    const payload = b64(datos);
    return `${PREFIJO}.${payload}.${firmar(payload, clave)}`;
}

/** ¿Tiene forma de pase firmado? Sirve para decidir por qué camino va, sin validar nada. */
function pareceFirmado(token) {
    return /^BA1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(token || '').trim());
}

/**
 * Verifica un pase firmado **sin consultar ninguna base**.
 *
 * @param token     el código escaneado.
 * @param edificio  de qué puerta se está preguntando. **Obligatorio**: un pase del 159 no abre en
 *                  el 270, y sin edificio no se puede afirmar que sea de este.
 * @returns {{valido:boolean, resultado:string, mensaje:string, datos:object|null}}
 */
function verificarPaseFirmado(token, edificio, ahora = Date.now(), maestra = process.env.QR_PASES_CLAVE) {
    const t = String(token || '').trim();
    const no = (resultado, mensaje) => ({ valido: false, resultado, mensaje, datos: null });

    if (!pareceFirmado(t)) return no('rechazado_invalido', 'El código no es un pase firmado');
    if (!claveEdificio(edificio)) return no('rechazado_invalido', 'No se sabe de qué edificio es la consulta');

    const clave = claveDelEdificio(edificio, maestra);
    if (!clave) {
        // Se dice fuerte y en cada intento: una instalación donde esto falta se comporta igual que
        // una sin pases offline, y sin el aviso nadie se entera nunca de por qué.
        console.warn('🔒 QR firmado: falta QR_PASES_CLAVE en el .env, así que no se puede validar ningún pase sin base. Con PostgreSQL arriba todo sigue funcionando igual.');
        return no('rechazado_invalido', 'El sistema de pases offline no está configurado');
    }

    const [, payload, firmaRecibida] = t.split('.');
    const esperada = firmar(payload, clave);

    // > [!CAUTION]
    // > **Comparación de tiempo constante.** Un `===` sobre dos cadenas responde más rápido cuando
    // > difieren en el primer carácter que en el último, y eso alcanza para adivinar la firma de a
    // > un byte. Es el mismo criterio de `firma-webhook.js`, escrito igual a propósito.
    const a = Buffer.from(firmaRecibida || '', 'utf8');
    const b = Buffer.from(esperada, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return no('rechazado_invalido', 'La firma del pase no es válida');
    }

    let partes;
    try { partes = Buffer.from(payload, 'base64url').toString('utf8').split('|'); }
    catch (e) { return no('rechazado_invalido', 'El pase está mal formado'); }
    if (partes.length < 4) return no('rechazado_invalido', 'El pase está mal formado');

    const [edificioDelPase, unidad, id, venceMin] = partes;

    // La firma ya probó que el edificio de adentro no fue alterado. Esto compara ese edificio con
    // el de la puerta donde se escaneó: un pase auténtico del 159 sigue sin abrir en el 270.
    if (!mismoEdificio(edificioDelPase, edificio)) {
        return no('rechazado_invalido', `Pase no autorizado para este edificio (emitido para: ${edificioDelPase || 'desconocido'})`);
    }

    const vence = Number(venceMin) * 60000;
    if (!isFinite(vence) || vence <= 0) return no('rechazado_invalido', 'El pase está mal formado');
    if (vence < ahora) return no('rechazado_vencido', 'Pase QR vencido');

    return {
        valido: true,
        resultado: 'exitoso',
        mensaje: 'Pase QR válido (verificado sin conexión)',
        datos: { edificio: edificioDelPase, unidad, id, vence: new Date(vence) },
    };
}

module.exports = {
    emitirPaseFirmado,
    verificarPaseFirmado,
    pareceFirmado,
    claveDelEdificio,
    PREFIJO,
};
