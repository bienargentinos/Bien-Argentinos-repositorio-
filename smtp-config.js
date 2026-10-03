/**
 * CÓMO SE CONECTA MARCOS AL SERVIDOR DE MAIL
 *
 * > [!CAUTION]
 * > **El hosting de `mail.bienargentinos.com` se está dando de baja.** Si el `.env` no se cambia en
 * > el mismo movimiento, los mails de escalamiento a la Administración dejan de salir **en
 * > silencio**: `enviarEmail` loguea el error y devuelve `false`, y nadie mira ese log.
 *
 * Tres cosas del código hacían que esa mudanza fallara sin que nadie se enterara:
 *
 * 1. **El host tenía un valor por defecto: el mismo que se da de baja.** Sin `SMTP_HOST` en el
 *    `.env`, Marcos seguía apuntando a `mail.bienargentinos.com` sin decirlo. Se mantiene --sacarlo
 *    a ciegas podría cortar el mail HOY, si el `.env` del VPS no lo tiene escrito-- pero ahora se
 *    avisa fuerte al arrancar que se está usando ese valor.
 * 2. **`secure: true` estaba fijo.** Es lo correcto para el puerto 465 (TLS directo), pero casi
 *    todos los proveedores a los que uno se muda (Gmail, Brevo, Office 365) atienden en el 587, que
 *    arranca en claro y sube a TLS (STARTTLS). Con `secure: true` contra el 587 la conexión no
 *    arranca nunca. Ahora sale del puerto, y `SMTP_SECURE` lo fuerza si hace falta.
 * 3. **`rejectUnauthorized: false` para todos.** Estaba puesto por el certificado de Ferozo, el
 *    hosting viejo. Apagar la verificación del certificado deja la contraseña del mail expuesta a
 *    quien se meta en el medio. Ahora queda apagada **solo** para el host viejo (para no romper lo
 *    que hoy anda) o si se pide con `SMTP_TLS_INSEGURO=1`. Contra un proveedor nuevo se verifica.
 *
 * Y una cuarta, del mismo movimiento: **el remitente era siempre `SMTP_USER`**. En varios
 * proveedores el usuario de conexión no es una dirección de mail (Brevo da un login propio), y ahí
 * el correo sale rechazado. `SMTP_FROM` lo separa; sin él, sigue siendo `SMTP_USER`.
 *
 * Función pura: recibe el entorno y devuelve la configuración y la lista de problemas. No abre
 * ninguna conexión, así que se prueba sin red (`node pruebas-smtp-config.js`).
 */

const HOST_VIEJO = 'mail.bienargentinos.com';

// El hosting que se da de baja: el propio dominio o los servidores de Ferozo que lo atienden.
const esHostViejo = (host) => /(^|\.)bienargentinos\.com$|ferozo/i.test(String(host || '').trim());

const siONo = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (['1', 'true', 'si', 'sí', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'no', 'off'].includes(s)) return false;
    return null;
};

function configSmtp(env = process.env) {
    const problemas = [];

    const hostEscrito = String(env.SMTP_HOST || '').trim();
    const host = hostEscrito || HOST_VIEJO;
    if (!hostEscrito) {
        problemas.push(`SMTP_HOST no está en el .env: se usa "${HOST_VIEJO}" por defecto, que es el hosting que se da de baja.`);
    } else if (esHostViejo(host)) {
        problemas.push(`SMTP_HOST apunta a "${host}", el hosting que se da de baja: hay que cambiarlo en el mismo movimiento que la baja.`);
    }

    const portNum = parseInt(env.SMTP_PORT, 10);
    const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 465;

    const secureForzado = siONo(env.SMTP_SECURE);
    const secure = secureForzado !== null ? secureForzado : port === 465;
    if (secureForzado === true && port === 587) {
        problemas.push('SMTP_SECURE=true con el puerto 587: ese puerto usa STARTTLS y la conexión no va a arrancar. Sacá SMTP_SECURE o usá el 465.');
    }

    const inseguroPedido = siONo(env.SMTP_TLS_INSEGURO) === true;
    const verificarCertificado = !(inseguroPedido || esHostViejo(host));

    const user = String(env.SMTP_USER || '').trim();
    const pass = String(env.SMTP_PASS || '');
    if (!user || !pass) problemas.push('Faltan SMTP_USER o SMTP_PASS: no sale ningún mail.');

    const from = String(env.SMTP_FROM || '').trim() || user;
    if (from && !from.includes('@')) {
        problemas.push(`El remitente ("${from}") no es una dirección de mail. Si el usuario del proveedor no es un mail, poné SMTP_FROM.`);
    }

    return {
        transporte: {
            host,
            port,
            secure,
            auth: { user, pass },
            tls: { rejectUnauthorized: verificarCertificado },
        },
        from,
        hostPorDefecto: !hostEscrito,
        verificarCertificado,
        problemas,
    };
}

module.exports = { configSmtp, esHostViejo, HOST_VIEJO };
