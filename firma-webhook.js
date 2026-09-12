/**
 * LA FIRMA DEL WEBHOOK DE META — que el mensaje sea de Meta y no de cualquiera
 *
 * > [!CAUTION]
 * > **Hasta acá el webhook aceptaba cualquier POST.** No verificaba nada: alcanzaba con conocer la
 * > URL para hacerle creer a Marcos que escribió un técnico o un vecino.
 *
 * Y Marcos no solo contesta: actúa. Un POST inventado con el teléfono de Dario adentro alcanzaba
 * para abrir un caso, mandarle un WhatsApp real a una persona, dejar un cambio de CBU pendiente, o
 * imputarle una factura a un consorcio. Nada de eso queda marcado como sospechoso, porque desde
 * adentro se ve igual que un mensaje legítimo.
 *
 * Meta firma cada entrega con el **App Secret** de la aplicación: manda
 * `X-Hub-Signature-256: sha256=<hex>`, que es el HMAC-SHA256 del cuerpo **crudo**. Quien no tenga
 * el secreto no puede producir esa firma.
 *
 * DOS DETALLES QUE HACEN QUE ESTO FUNCIONE O NO:
 *
 * 1. **Se firma el cuerpo CRUDO, byte por byte.** `JSON.stringify(req.body)` no sirve: reordena
 *    claves, cambia el escapado y los espacios. La firma da distinta y se rechazan mensajes buenos.
 *    Por eso `index.js` guarda el buffer original en `req.rawBody` desde `bodyParser`.
 * 2. **La comparación es de tiempo constante.** Un `===` sobre dos hex responde más rápido cuando
 *    difieren en el primer carácter que en el último, y eso alcanza para adivinar la firma de a un
 *    byte. `timingSafeEqual` tarda siempre lo mismo.
 */

const crypto = require('crypto');

/**
 * Si `firmaRecibida` corresponde al cuerpo `cuerpoCrudo` firmado con `secreto`.
 *
 * Devuelve `false` ante cualquier cosa rara (sin firma, sin cuerpo, formato inesperado) en vez de
 * tirar una excepción: esto corre en la puerta de entrada del servidor y un error acá sería otra
 * forma de caerse.
 */
function firmaValida({ cuerpoCrudo, firmaRecibida, secreto }) {
    if (!secreto || !cuerpoCrudo || !firmaRecibida) return false;

    const recibida = String(firmaRecibida).trim();
    // Meta la manda como "sha256=<hex>". Se exige el prefijo: aceptar el hex pelado sería aceptar
    // también otro algoritmo más débil si mañana alguien manda "sha1=".
    if (!recibida.startsWith('sha256=')) return false;
    const hexRecibido = recibida.slice('sha256='.length);
    if (!/^[0-9a-f]{64}$/i.test(hexRecibido)) return false;

    const cuerpo = Buffer.isBuffer(cuerpoCrudo) ? cuerpoCrudo : Buffer.from(String(cuerpoCrudo), 'utf8');
    const esperado = crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');

    const a = Buffer.from(esperado, 'hex');
    const b = Buffer.from(hexRecibido.toLowerCase(), 'hex');
    // `timingSafeEqual` TIRA si los largos difieren, así que el largo se compara antes. Los dos son
    // de 32 bytes por construcción, pero si no lo fueran esto sería una excepción en la puerta.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * El middleware para poner delante del webhook.
 *
 * > [!CAUTION]
 * > **Sin `META_APP_SECRET` configurado NO se rechaza nada, y es a propósito.**
 *
 * Rechazar sin el secreto dejaría a Marcos sordo en el instante del despliegue, antes de que nadie
 * tenga tiempo de agregar la variable. Eso ya pasó hoy con otra cosa y el precio fue producción
 * caída hasta que una persona lo vio.
 *
 * El riesgo del otro lado es que quede abierto para siempre porque nadie se enteró. Por eso el
 * aviso sale en CADA pedido y también al arrancar: es imposible que pase desapercibido leyendo el
 * log. Con el secreto puesto, la puerta se cierra sola y no hay que tocar código.
 */
function exigirFirmaMeta({ secreto, nombre = 'webhook' } = {}) {
    let yaAviso = false;

    return function (req, res, next) {
        if (!secreto) {
            if (!yaAviso) {
                console.error(`🔓 ${nombre}: META_APP_SECRET no está en el .env, así que NO se ` +
                    `verifica quién manda los mensajes. Cualquiera que sepa la URL puede hacerse ` +
                    `pasar por un técnico o un vecino. Se sigue atendiendo para no dejar a Marcos ` +
                    `sordo, pero esto hay que cerrarlo.`);
                yaAviso = true;
            }
            return next();
        }

        const ok = firmaValida({
            cuerpoCrudo: req.rawBody,
            firmaRecibida: req.get('x-hub-signature-256'),
            secreto,
        });

        if (ok) return next();

        // Qué faltó, sin volcar el cuerpo ni la firma al log: si el pedido fuera legítimo, ahí
        // adentro va el teléfono y el mensaje de una persona.
        const motivo = !req.rawBody ? 'no llegó el cuerpo crudo'
            : !req.get('x-hub-signature-256') ? 'el pedido no trae firma'
            : 'la firma no corresponde al cuerpo';
        console.error(`⛔ ${nombre}: se rechazó un POST porque ${motivo}. ` +
            `Origen: ${req.ip || 'desconocido'}.`);
        return res.sendStatus(403);
    };
}

module.exports = { firmaValida, exigirFirmaMeta };
