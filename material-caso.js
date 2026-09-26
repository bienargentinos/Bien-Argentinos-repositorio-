// Lo que el vecino adjuntó en un caso, recuperado del historial y del disco.
//
// Vive en su propio archivo porque lo necesitan los dos lados: `index.js`, para entregárselo al
// técnico, y `agentes/marcos-ops.js`, para saber si vale la pena pedirle al técnico que conteste.
// Tenerlo duplicado en los dos era garantía de que uno de los dos se quedara viejo.

const fs = require('fs');
const path = require('path');

/**
 * La foto o el video que el vecino mandó en un caso, recuperado del historial.
 *
 * POR QUÉ NO ALCANZA CON LA MEMORIA: el adjunto se guardaba en `session.mediaPendiente`, que vive
 * en RAM. Se pierde en cada `pm2 restart` y además se vacía apenas se reenvía una vez. Cuando el
 * técnico pedía material un rato más tarde ahí ya no había nada, y Marcos volvía a pedírselo al
 * vecino -- que contestaba "ya te lo pasé, ¿otra vez querés lo mismo?" y tenía razón: la foto
 * estaba en disco y anotada en el historial del caso desde el primer minuto.
 *
 * Devuelve null si no hay, o si el archivo ya no está en disco.
 */
async function materialDelVecinoEnCaso(idEvento, telVecino) {
    if (!idEvento) return null;
    try {
        const { obtenerHistorialMensajes } = require('./db-pg');
        const historialCaso = (await obtenerHistorialMensajes(idEvento)) || [];
        const telVecinoLimpio = String(telVecino || '').replace(/\D/g, '');

        // Del más nuevo al más viejo: interesa lo último que mandó.
        const conMedia = [...historialCaso].reverse().find(m => {
            const url = String(m.url_media || '');
            if (!url || !/\.(jpe?g|png|webp|heic|mp4|3gp|mov)$/i.test(url)) return false;
            // Solo lo que mandó el VECINO: devolverle al técnico una foto que mandó él mismo
            // sería un ida y vuelta sin sentido.
            const tel = String(m.telefono || '').replace(/\D/g, '');
            return m.remitente !== 'marcos' && (!telVecinoLimpio || tel === telVecinoLimpio);
        });
        if (!conMedia) return null;

        // La url guardada es la web (/archivos/...); el archivo vive en `almacenamiento/` con
        // esa misma ruta relativa.
        const rel = String(conMedia.url_media).replace(/^\/(archivos|audios)\//, '');
        const rutaReal = path.join(__dirname, 'almacenamiento', rel);
        if (!fs.existsSync(rutaReal)) {
            console.warn(`📎 El historial del [${idEvento}] apunta a ${rel} pero el archivo no está en disco.`);
            return null;
        }

        const esVideo = /\.(mp4|3gp|mov)$/i.test(rutaReal);
        console.log(`📎 Material del vecino recuperado del historial del [${idEvento}]: ${rel}`);
        return {
            filePath: rutaReal,
            tipo: esVideo ? 'video' : 'image',
            mimeType: esVideo ? 'video/mp4' : 'image/jpeg',
            recibidoEn: Date.now(), // pertenece al caso: no hace falta la ventana de 30 minutos
        };
    } catch (e) {
        console.error('Error buscando en el historial el material que ya mandó el vecino:', e.message);
        return null;
    }
}

module.exports = { materialDelVecinoEnCaso };
