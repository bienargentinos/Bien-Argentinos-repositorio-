const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

if (!global.colasProveedores) global.colasProveedores = new Map();
if (!global.timersEscalacionProveedores) global.timersEscalacionProveedores = new Map();

async function gestionarOperaciones({
    vecino,
    decisionCaso,
    tecnicoAsignado,
    personalDeTurno,
    phoneNumberId,
    accessToken,
    id_evento
}) {
    const mensajesEnviados = [];
    const idCasoFinal = id_evento || `CASO-${Date.now().toString().slice(-4)}`;

    if (decisionCaso.contactar_encargado && personalDeTurno?.telefono) {
        const mensajeEncargado = await generarMensajeEncargado({ vecino, decisionCaso, personalDeTurno, id_evento: idCasoFinal });
        await enviarWhatsApp(personalDeTurno.telefono, mensajeEncargado, phoneNumberId, accessToken);
        mensajesEnviados.push({ destinatario: personalDeTurno.nombre, rol: 'encargado', mensaje: mensajeEncargado });
        console.log(`👷 Encargado ${personalDeTurno.nombre} notificado de ${idCasoFinal}.`);
    }

    if (decisionCaso.contactar_tecnico && tecnicoAsignado?.telefono) {
        const resQueue = await notificarProveedorConCola({
            vecino,
            decisionCaso,
            tecnicoAsignado,
            personalDeTurno,
            phoneNumberId,
            accessToken,
            id_evento: idCasoFinal
        });

        if (resQueue.encolado) {
            mensajesEnviados.push({ destinatario: tecnicoAsignado.nombre, rol: 'tecnico', mensaje: `Notificación encolada (${idCasoFinal})` });
        } else {
            mensajesEnviados.push({ destinatario: tecnicoAsignado.nombre, rol: 'tecnico', mensaje: `Notificación enviada (${idCasoFinal})` });
            console.log(`🔧 Técnico ${tecnicoAsignado.nombre} notificado del [${idCasoFinal}].`);
        }

        programarEscalacionProveedor({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, paso: 1, id_evento: idCasoFinal });

        if (tecnicoAsignado.acceso &&
            !tecnicoAsignado.acceso.toLowerCase().includes('qr') &&
            !tecnicoAsignado.acceso.toLowerCase().includes('llave') &&
            personalDeTurno?.telefono) {

            const mensajeAcceso = `🔑 *MARCOS — COORDINACIÓN DE ACCESO [${idCasoFinal}]*\n\n` +
                `${personalDeTurno.nombre}, el técnico ${tecnicoAsignado.nombre} necesita acceso al edificio ` +
                `para el [${idCasoFinal}] en depto ${vecino?.departamento || 'a confirmar'}.\n` +
                `¿Podés coordinar la apertura cuando llegue? Avisame si hay inconvenientes.`;

            await enviarWhatsApp(personalDeTurno.telefono, mensajeAcceso, phoneNumberId, accessToken);
            mensajesEnviados.push({ destinatario: personalDeTurno.nombre, rol: 'coordinacion_acceso', mensaje: mensajeAcceso });
        }
    }

    return mensajesEnviados;
}

async function notificarProveedorConCola({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, id_evento }) {
    const telTech = String(tecnicoAsignado.telefono).replace(/\D/g, '');
    if (!global.colasProveedores.has(telTech)) {
        global.colasProveedores.set(telTech, {
            eventoActivoId: null,
            edificioActivo: null,
            colaPendientes: []
        });
    }

    const estadoProv = global.colasProveedores.get(telTech);

    estadoProv.eventoActivoId = id_evento;
    estadoProv.edificioActivo = vecino?.edificio;
    estadoProv.notificado = true;
    estadoProv.ultimoMensajeTimestamp = Date.now();

    await ejecutarEnvioNotificacionTecnico({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, id_evento });
    return { encolado: false };
}

async function ejecutarEnvioNotificacionTecnico({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, id_evento }) {
    const { buscarPerfilEdificio } = require('../sheets');
    const perfilEdif = await buscarPerfilEdificio(vecino?.edificio);
    const direccionExacta = perfilEdif?.direccion || vecino?.direccion || vecino?.edificio || 'Consorcio';

    const rawNombre = (vecino?.nombre && vecino?.nombre !== 'Vecino' && vecino?.nombre !== 'Desconocido') ? vecino.nombre : 'Vecino';
    const rawDepto = vecino?.departamento || vecino?.depto || '';
    const deptoStr = rawDepto ? `(${rawDepto})` : '';
    const vecinoConDepto = `${rawNombre} ${deptoStr}`.trim();

    const textoProblemaConCaso = `[${id_evento}] ${decisionCaso.resumen_problema || 'Requerimiento técnico'}`;

    const accesoFinal = personalDeTurno 
        ? `Encargado ${personalDeTurno.nombre} (${personalDeTurno.horario})` 
        : `Coordinar ingreso directamente con el solicitante ${vecinoConDepto}`;

    const componentesPlantilla = [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: tecnicoAsignado.nombre || 'Técnico' },
                { type: 'text', text: direccionExacta },
                { type: 'text', text: `${vecinoConDepto} — ${textoProblemaConCaso}` },
                { type: 'text', text: (decisionCaso.urgencia || 'media').toUpperCase() },
                { type: 'text', text: tecnicoAsignado.acceso || accesoFinal }
            ]
        }
    ];

    let plantillaEnviada = await enviarPlantillaWhatsApp(
        tecnicoAsignado.telefono,
        'notificacion_servicio_consorcio',
        'es_AR',
        componentesPlantilla,
        phoneNumberId,
        accessToken
    );

    if (!plantillaEnviada) {
        plantillaEnviada = await enviarPlantillaWhatsApp(
            tecnicoAsignado.telefono,
            'notificacion_servicio_consorcio',
            'es',
            componentesPlantilla,
            phoneNumberId,
            accessToken
        );
    }

    if (!plantillaEnviada) {
        const mensajeTecnico = await generarMensajeTecnico({ vecino, decisionCaso, tecnicoAsignado, id_evento });
        await enviarWhatsApp(tecnicoAsignado.telefono, mensajeTecnico, phoneNumberId, accessToken);
    }
}

function cancelarEscalacionProveedor(telefonoProveedor) {
    const telClean = String(telefonoProveedor).replace(/\D/g, '');
    for (const [key, timer] of global.timersEscalacionProveedores.entries()) {
        if (key.includes(telClean)) {
            clearTimeout(timer);
            global.timersEscalacionProveedores.delete(key);
            console.log(`🛑 Escalación cancelada para el técnico (${telClean}) por respuesta activa.`);
        }
    }
}

async function retransmitirMediaAlProveedor({ tecnicoTelefono, filePath, mimeType, id_evento, edificio, caption, phoneNumberId, accessToken }) {
    try {
        if (!tecnicoTelefono || !filePath || !fs.existsSync(filePath)) return false;

        console.log(`📤 Retransmitiendo archivo adjunto al técnico ${tecnicoTelefono} para el [${id_evento}]...`);
        const mediaId = await subirMediaWhatsApp(filePath, mimeType, phoneNumberId, accessToken);
        if (!mediaId) return false;

        const LeyendaMedia = `📷 *ADJUNTO DE VECINO [${id_evento}]*\nEdificio: ${edificio || 'Consorcio'}\n${caption || ''}`;

        if (mimeType.startsWith('image/')) {
            return await enviarImagenWhatsApp(tecnicoTelefono, mediaId, LeyendaMedia, phoneNumberId, accessToken);
        } else if (mimeType.startsWith('video/')) {
            return await enviarVideoWhatsApp(tecnicoTelefono, mediaId, LeyendaMedia, phoneNumberId, accessToken);
        } else if (mimeType.startsWith('application/') || mimeType.startsWith('text/')) {
            return await enviarDocumentoWhatsApp(tecnicoTelefono, mediaId, `adjunto_${id_evento}.pdf`, LeyendaMedia, phoneNumberId, accessToken);
        }
        return false;
    } catch (e) {
        console.error('Error retransmitiendo media al proveedor:', e.message);
        return false;
    }
}

async function generarMensajeEncargado({ vecino, decisionCaso, personalDeTurno, id_evento }) {
    const emojiUrgencia = decisionCaso.urgencia === 'alta' ? '🚨' : '📋';
    const nombreVecinoBase = (vecino?.nombre && vecino?.nombre !== 'Vecino' && vecino?.nombre !== 'Desconocido') ? vecino.nombre : 'Vecino';
    const deptoStr = vecino?.departamento ? `(${vecino.departamento})` : '';
    const vecinoConDepto = `${nombreVecinoBase} ${deptoStr}`.trim();

    return `${emojiUrgencia} *MARCOS — AVISO INTERNO [${id_evento}]*\n\n` +
        `Hola ${personalDeTurno.nombre}, te cuento que acabo de recibir un reclamo:\n\n` +
        `📍 *Edificio:* ${vecino?.edificio || 'No especificado'}\n` +
        `👤 *Solicitante:* ${vecinoConDepto}\n` +
        `⚠️ *Problema:* [${id_evento}] ${decisionCaso.resumen_problema}\n` +
        `🚦 *Urgencia:* ${decisionCaso.urgencia.toUpperCase()}\n\n` +
        `¿Podés revisar? Avisame cuando puedas.`;
}

async function generarMensajeTecnico({ vecino, decisionCaso, tecnicoAsignado, id_evento }) {
    const { buscarPerfilEdificio } = require('../sheets');
    const perfilEdif = await buscarPerfilEdificio(vecino?.edificio);
    const direccionExacta = perfilEdif?.direccion || vecino?.direccion || vecino?.edificio || 'Consorcio';
    
    const nombreVecinoBase = (vecino?.nombre && vecino?.nombre !== 'Vecino' && vecino?.nombre !== 'Desconocido') ? vecino.nombre : 'Vecino a confirmar';
    const deptoStr = vecino?.departamento ? `(${vecino.departamento})` : '';
    const vecinoConDepto = `${nombreVecinoBase} ${deptoStr}`.trim();

    const emojiUrgencia = decisionCaso.urgencia === 'alta' ? '🚨' : '🛠️';
    return `${emojiUrgencia} *MARCOS — ORDEN DE TRABAJO [${id_evento}]*\n\n` +
        `Hola ${tecnicoAsignado.nombre}, te mando los detalles de una nueva asistencia:\n\n` +
        `📍 *Dirección:* ${direccionExacta}\n` +
        `👤 *Solicitante:* ${vecinoConDepto}\n` +
        `⚠️ *Sector y Requerimiento:* ${decisionCaso.resumen_problema}\n` +
        `🚦 *Urgencia:* ${decisionCaso.urgencia.toUpperCase()}\n` +
        `🔑 *Acceso:* ${tecnicoAsignado.acceso || 'Consultar con encargado'}\n\n` +
        `Por favor confirmame si podés pasar. ¡Gracias!`;
}

function normalizarTelefonoWhatsApp(telefono) {
    if (!telefono) return '';
    let num = String(telefono).replace(/\D/g, '');
    if (num.startsWith('0')) num = num.substring(1);
    if (num.length === 10) num = '549' + num;
    else if (num.length === 12 && num.startsWith('54') && !num.startsWith('549')) num = '549' + num.substring(2);
    else if (num.length === 11 && num.startsWith('1115')) num = '54911' + num.substring(4);
    // "54" + área (2 dígitos) + "15" (viejo prefijo de móvil) + local (8 dígitos) = 14 dígitos.
    // Ej: 54111550542005 -> 5491150542005. Sin esto, el mismo abonado normaliza
    // distinto según llegue con o sin el "15", y termina con dos sesiones separadas.
    else if (num.length === 14 && num.startsWith('54') && num.substring(4, 6) === '15') {
        num = num.substring(0, 2) + '9' + num.substring(2, 4) + num.substring(6);
    }
    else if (!num.startsWith('54')) num = '549' + num;
    return num;
}

async function enviarWhatsApp(to, text, phoneNumberId, accessToken) {
    try {
        const telefonoDestino = normalizarTelefonoWhatsApp(to);
        const textoLimpio = (typeof text === 'object' && text !== null) 
            ? (text.body || text.texto || text.respuesta || JSON.stringify(text)) 
            : String(text || '');
        const res = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            data: {
                messaging_product: 'whatsapp',
                to: telefonoDestino,
                text: { body: textoLimpio },
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return true;
    } catch (error) {
        console.error('Error enviando WhatsApp:', error.response?.data || error.message);
        return false;
    }
}

async function enviarPlantillaWhatsApp(to, templateName, languageCode, components, phoneNumberId, accessToken) {
    try {
        const telefonoDestino = normalizarTelefonoWhatsApp(to);
        console.log(`📤 Enviando Plantilla Meta '${templateName}' (${languageCode}) a ${telefonoDestino}...`);
        const res = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            data: {
                messaging_product: 'whatsapp',
                to: telefonoDestino,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: languageCode },
                    components: components
                }
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        console.log(`✅ Plantilla '${templateName}' enviada con éxito a ${telefonoDestino}. Message ID:`, res.data?.messages?.[0]?.id);
        return true;
    } catch (error) {
        console.error(`⚠️ Error enviando plantilla '${templateName}' (${languageCode}):`, error.response?.data || error.message);
        return false;
    }
}

async function subirMediaWhatsApp(filePath, mimeType, phoneNumberId, accessToken) {
    try {
        const data = new FormData();
        data.append('messaging_product', 'whatsapp');
        data.append('file', fs.createReadStream(filePath), { contentType: mimeType });
        data.append('type', mimeType);

        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${phoneNumberId}/media`,
            data: data,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...data.getHeaders()
            }
        });
        return response.data.id;
    } catch (error) {
        console.error('Error subiendo media a Meta:', error.response?.data || error.message);
        return null;
    }
}

async function enviarAudioWhatsApp(to, mediaId, phoneNumberId, accessToken) {
    try {
        const telefonoDestino = normalizarTelefonoWhatsApp(to);
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            data: {
                messaging_product: 'whatsapp',
                to: telefonoDestino,
                type: 'audio',
                audio: { id: mediaId },
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return true;
    } catch (error) {
        console.error('Error enviando Nota de Voz WhatsApp:', error.response?.data || error.message);
        return false;
    }
}

async function enviarDocumentoWhatsApp(to, mediaId, filename, caption, phoneNumberId, accessToken) {
    try {
        const telefonoDestino = normalizarTelefonoWhatsApp(to);
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            data: {
                messaging_product: 'whatsapp',
                to: telefonoDestino,
                type: 'document',
                document: {
                    id: mediaId,
                    filename: filename || 'documento_consorcio.pdf',
                    caption: caption || ''
                },
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return true;
    } catch (error) {
        console.error('Error enviando Documento:', error.response?.data || error.message);
        return false;
    }
}

async function enviarImagenWhatsApp(to, mediaId, caption, phoneNumberId, accessToken) {
    try {
        const telefonoDestino = normalizarTelefonoWhatsApp(to);
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            data: {
                messaging_product: 'whatsapp',
                to: telefonoDestino,
                type: 'image',
                image: {
                    id: mediaId,
                    caption: caption || ''
                },
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return true;
    } catch (error) {
        console.error('Error enviando Imagen:', error.response?.data || error.message);
        return false;
    }
}

async function enviarVideoWhatsApp(to, mediaId, caption, phoneNumberId, accessToken) {
    try {
        const telefonoDestino = normalizarTelefonoWhatsApp(to);
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            data: {
                messaging_product: 'whatsapp',
                to: telefonoDestino,
                type: 'video',
                video: {
                    id: mediaId,
                    caption: caption || ''
                },
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return true;
    } catch (error) {
        console.error('Error enviando Video:', error.response?.data || error.message);
        return false;
    }
}

function programarEscalacionProveedor({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, paso = 1, id_evento }) {
    const key = `${vecino?.edificio || 'edif'}_${tecnicoAsignado?.telefono || 'tech'}`;
    
    if (global.timersEscalacionProveedores.has(key)) {
        clearTimeout(global.timersEscalacionProveedores.get(key));
    }

    const timeoutMs = 20 * 60 * 1000;

    const timer = setTimeout(async () => {
        global.timersEscalacionProveedores.delete(key);
        const telTech = String(tecnicoAsignado.telefono).replace(/\D/g, '');
        const stProv = global.colasProveedores?.get(telTech);

        const yaRespondio = stProv && (Date.now() - (stProv.ultimoMensajeTimestamp || 0) < 20 * 60 * 1000);
        if (yaRespondio) {
            console.log(`✅ Técnico ${tecnicoAsignado.nombre} respondió. Cancelando escalación.`);
            return;
        }

        console.log(`⚠️ TIMEOUT 20 MIN: Técnico ${tecnicoAsignado.nombre} no confirmó [${id_evento}]. Escalando...`);

        const { buscarTecnicoSuplente } = require('../sheets');
        const { notificarEscalacionAlAdmin } = require('./marcos-admin');

        if (paso === 1) {
            const suplente = await buscarTecnicoSuplente({
                edificio: vecino?.edificio,
                especialidad: decisionCaso?.tipo_problema || 'electricidad',
                telefonoTitular: tecnicoAsignado.telefono
            });

            if (suplente) {
                await ejecutarEnvioNotificacionTecnico({ vecino, decisionCaso, tecnicoAsignado: suplente, personalDeTurno, phoneNumberId, accessToken, id_evento });
                programarEscalacionProveedor({ vecino, decisionCaso, tecnicoAsignado: suplente, personalDeTurno, phoneNumberId, accessToken, paso: 2, id_evento });
                return;
            }
        }

        if (paso <= 2) {
            const msgInsistencia = `⚠️ *MARCOS — RECORDATORIO URGENTE DE SERVICIO [${id_evento}]*\n\n` +
                `Hola ${tecnicoAsignado.nombre}, aguardamos tu confirmación para el [${id_evento}] en ${vecino?.edificio || 'el consorcio'} (Depto ${vecino?.departamento || '1A'}).\n` +
                `¿Podrás asistir hoy o derivamos a otro servicio? Agradecemos tu respuesta.`;

            await enviarWhatsApp(tecnicoAsignado.telefono, msgInsistencia, phoneNumberId, accessToken);
            programarEscalacionProveedor({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, paso: 3, id_evento });
            return;
        }

        await notificarEscalacionAlAdmin({ vecino, decisionCaso, tecnicoAsignado, intentosRealizados: paso });
    }, timeoutMs);

    global.timersEscalacionProveedores.set(key, timer);
}

module.exports = {
    gestionarOperaciones,
    enviarWhatsApp,
    enviarPlantillaWhatsApp,
    subirMediaWhatsApp,
    enviarAudioWhatsApp,
    enviarDocumentoWhatsApp,
    enviarImagenWhatsApp,
    enviarVideoWhatsApp,
    normalizarTelefonoWhatsApp,
    programarEscalacionProveedor,
    cancelarEscalacionProveedor,
    retransmitirMediaAlProveedor
};
