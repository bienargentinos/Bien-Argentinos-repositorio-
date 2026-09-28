// qr-imagen.js -- dibuja el codigo QR en NUESTRO servidor, no en el de un tercero.
//
// Antes el QR de un pase se pedia asi:
//
//     https://api.qrserver.com/v1/create-qr-code/?...&data=<TOKEN>
//
// O sea: el token que ABRE LA PUERTA DE UN EDIFICIO viajaba, en la URL, al servidor
// de otra empresa. En la URL, no en el cuerpo, asi que queda en su log de accesos
// -- y ese es el peor lugar donde puede quedar: nadie sabe cuanto lo guardan, ni
// quien lo lee, ni a quien se lo venden. Y nosotros no nos enteramos nunca.
//
// Ademas, si ese servicio esta caido o bloqueado, el vecino abre el pase y ve un
// cuadrado roto. El pase existe y es valido; lo unico que falta es la imagen, que
// son treinta lineas de codigo nuestras.
//
// El paquete `qrcode` lo dibuja local. No sale un solo pedido a internet.
// (Nada de acentos graves aca adentro.)

const QRCode = require('qrcode');

// Techos, para que un endpoint que dibuja imagenes no se convierta en una forma
// barata de hacerle gastar CPU al servidor.
const TAM_MIN = 120;
const TAM_MAX = 600;
const TAM_DEFECTO = 350;
const LARGO_MAX_DATO = 512;

function tamanioPedido(valor) {
    const n = parseInt(valor, 10);
    if (!Number.isFinite(n)) return TAM_DEFECTO;
    return Math.min(TAM_MAX, Math.max(TAM_MIN, n));
}

// Devuelve el PNG del dato. Tira si el dato esta vacio o es absurdamente largo:
// un QR de 512 caracteres ya no lo lee ningun telefono, asi que mas que eso solo
// puede ser un error o alguien probando.
async function pngDelDato(dato, tam = TAM_DEFECTO) {
    const texto = String(dato == null ? '' : dato);
    if (!texto.trim()) throw new Error('QR sin dato que dibujar.');
    if (texto.length > LARGO_MAX_DATO) throw new Error('QR con un dato demasiado largo.');
    return QRCode.toBuffer(texto, {
        type: 'png',
        width: tamanioPedido(tam),
        margin: 2,
        errorCorrectionLevel: 'M'
    });
}

// `private` y no `public`: un proxy compartido no tiene por que guardarse el QR
// de la puerta de nadie.
function enviarPng(res, buffer) {
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=600');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
}

// Dibuja lo que le pasen por ?d=. Es para la PORTERIA, donde el dato ya viaja en
// la URL de la propia pagina (`/porteria/pase/<token>`), asi que esto no expone
// nada nuevo. En el portal del vecino NO se usa: alla se sirve por id de pase y
// con sesion, y el token no aparece en ninguna URL.
async function manejadorQrPorDato(req, res) {
    try {
        const buffer = await pngDelDato((req.query || {}).d, (req.query || {}).t);
        enviarPng(res, buffer);
    } catch (e) {
        // El motivo NO lleva el dato: seria escribir el token en nuestro propio log.
        console.error('🔳 No se pudo dibujar un QR:', e.message);
        res.status(400).send('No se pudo generar el QR.');
    }
}

function rutaQrPorDato(base, dato, tam) {
    const raiz = String(base || '').replace(/\/+$/, '');
    let url = raiz + '/qr.png?d=' + encodeURIComponent(String(dato == null ? '' : dato));
    if (tam) url += '&t=' + encodeURIComponent(tamanioPedido(tam));
    return url;
}

module.exports = {
    pngDelDato,
    enviarPng,
    manejadorQrPorDato,
    rutaQrPorDato,
    tamanioPedido,
    TAM_MIN,
    TAM_MAX,
    TAM_DEFECTO,
    LARGO_MAX_DATO
};
