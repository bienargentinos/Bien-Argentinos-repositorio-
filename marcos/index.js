require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');

const {
    buscarVecinoPorTelefono,
    buscarVecinosPorTelefono,
    agregarVecinoNuevo,
    buscarPersonalDeTurno,
    buscarPerfilEdificio,
    listarEdificiosConocidos,
    buscarMemoriaVecino,
    buscarTecnicoAsignado,
    guardarLlamada,
} = require('./sheets');

const { descargarMedia }     = require('./media');
const { evaluarCaso }        = require('./agentes/marcos-caso');
const { responderVecino }    = require('./agentes/marcos-cara');
const { gestionarOperaciones, enviarWhatsApp, subirMediaWhatsApp, enviarAudioWhatsApp } = require('./agentes/marcos-ops');
const { procesarDocumento }  = require('./agentes/marcos-docs');
const { reportarAlAdmin }    = require('./agentes/marcos-admin');

const app = express();

// Parsear JSON pero silenciar errores de formato inválido (pings de Meta/Vapi)
app.use((req, res, next) => {
    bodyParser.json()(req, res, (err) => {
        if (err) {
            console.log(`⚠️ JSON inválido ignorado en ${req.path}`);
            return res.sendStatus(200);
        }
        next();
    });
});

const fs = require('fs');
function logDebug(msg) {
    const t = new Date().toISOString();
    fs.appendFileSync('debug_marcos.log', `[${t}] ${msg}\n`);
}

const sesiones = new Map();
const mensajesProcesados = new Set();
setInterval(() => mensajesProcesados.clear(), 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
const { META_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;

app.get('/', (req, res) => res.send('Marcos AI — Servidor activo ✅'));

app.get('/webhook', (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
        console.log('✅ Webhook verificado por Meta.');
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
        const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
        if (!entry?.messages?.[0]) return;
        const message = entry.messages[0];
        const msgId   = message.id;
        const from    = message.from;
        const msgType = message.type;
        if (mensajesProcesados.has(msgId)) { console.log(`🔁 Duplicado bloqueado: ${msgId}`); return; }
        mensajesProcesados.add(msgId);
        let msgBody = ''; let mediaId = null;
        if (msgType === 'text') { msgBody = message.text.body; }
        else if (msgType === 'image') { mediaId = message.image.id; msgBody = message.image.caption || '(Imagen adjunta)'; }
        else if (msgType === 'audio') { mediaId = message.audio.id; msgBody = '(Nota de voz)'; }
        else if (msgType === 'document') { mediaId = message.document.id; msgBody = message.document.caption || '(Documento adjunto)'; }
        else if (msgType === 'unsupported' || msgType === 'system') {
            await enviarWhatsApp(from, "Disculpe, la atención es únicamente mediante *mensajes de texto* o *notas de voz* 🎤.", WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            return;
        } else { return; }
        let recipient = from;
        if (recipient === '5491150542005') recipient = '54111550542005';
        console.log(`📨 Mensaje de ${recipient}: ${msgBody}`);
        if (!global.colasMensajes) global.colasMensajes = new Map();
        if (!global.colasMensajes.has(recipient)) global.colasMensajes.set(recipient, { mensajes: [], mediaIds: [], tipos: [], timeout: null });
        const cola = global.colasMensajes.get(recipient);
        cola.mensajes.push(msgBody); cola.tipos.push(msgType);
        if (mediaId) cola.mediaIds.push({ id: mediaId, tipo: msgType });
        if (cola.timeout) clearTimeout(cola.timeout);
        cola.timeout = setTimeout(async () => {
            const msgBodyCompleto = cola.mensajes.join(" ");
            const ultimoAudio = cola.mediaIds.filter(m => m.tipo === 'audio').pop();
            const ultimoMedia = cola.mediaIds.length > 0 ? cola.mediaIds[cola.mediaIds.length - 1] : null;
            const mediaIdFinal = ultimoAudio ? ultimoAudio.id : (ultimoMedia ? ultimoMedia.id : null);
            const msgTypeFinal = cola.tipos.includes('audio') ? 'audio' : cola.tipos[cola.tipos.length - 1];
            logDebug(`[${recipient}] Ráfaga: "${msgBodyCompleto}"`);
            global.colasMensajes.delete(recipient);
            await procesarMensaje({ from, recipient, msgBody: msgBodyCompleto, mediaId: mediaIdFinal, msgType: msgTypeFinal }).catch(err => {
                console.error('Error procesando mensaje:', err.message);
                enviarWhatsApp(recipient, 'Disculpe, tuve un inconveniente técnico. Escríbame en un momento.', WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            });
        }, 3000);
    } catch (err) { console.error('Error en webhook:', err.message); }
});

async function despacharRespuesta(recipient, texto, msgType) {
    if (!texto) return;
    const demora = Math.min(texto.length * 60, 10000);
    await new Promise(resolve => setTimeout(resolve, demora));
    if (msgType === 'audio') {
        try {
            console.log(`🎙️ Generando nota de voz para ${recipient}...`);
            const { generarAudio } = require('./tts');
            const { subirMediaWhatsApp, enviarAudioWhatsApp } = require('./agentes/marcos-ops');
            const fileName = await generarAudio(texto, `audio_${Date.now()}.ogg`);
            const mediaIdTTS = await subirMediaWhatsApp(fileName, 'audio/ogg', process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
            if (mediaIdTTS) {
                await enviarAudioWhatsApp(recipient, mediaIdTTS, process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
                const fs = require('fs'); if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                return;
            }
        } catch (error) { console.error('Error TTS:', error.message); }
    }
    const { enviarWhatsApp } = require('./agentes/marcos-ops');
    await enviarWhatsApp(recipient, texto, process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
}

async function procesarMensaje({ from, recipient, msgBody, mediaId, msgType }) {
    let media = null;
    if (mediaId) media = await descargarMedia(mediaId);
    let textoFinal = msgBody;
    if (msgType === 'audio' && media) {
        const { transcribirAudio } = require('./stt');
        const transcripcion = await transcribirAudio(media.filePath, media.mimeType);
        if (transcripcion) { textoFinal = transcripcion; console.log(`🎙️ Marcos escuchó: "${textoFinal}"`); }
    }
    const msgClean = textoFinal.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!global.marcosSesiones) global.marcosSesiones = new Map();
    if (!global.marcosSesiones.has(recipient)) global.marcosSesiones.set(recipient, { historial: [] });
    const session = global.marcosSesiones.get(recipient);
    const vecinosEnSheets = await buscarVecinosPorTelefono(from);
    if (msgClean === 'reiniciar' || msgClean === 'limpiar' || msgClean === 'chau') {
        global.marcosSesiones.delete(recipient);
        await despacharRespuesta(recipient, "✅ Memoria reiniciada. ¿En qué puedo ayudarte?", msgType);
        return;
    }
    const historial = session.historial;
    historial.push(`Vecino: ${textoFinal}`);
    if (historial.length > 30) historial.shift();
    const edificiosConocidos = await listarEdificiosConocidos();
    if (!session.edificioId) {
        if (session.edificioPendiente && (msgClean.includes('si') || msgClean.includes('correcto') || msgClean.includes('es esa'))) {
            session.edificioId = session.edificioPendiente; session.nombreEdificio = session.edificioPendiente;
            const v = vecinosEnSheets.find(v => v.edificio === session.edificioId);
            if (v) session.datosVecino = v; delete session.edificioPendiente;
        } else if (vecinosEnSheets.length === 1) {
            session.edificioId = vecinosEnSheets[0].edificio; session.nombreEdificio = vecinosEnSheets[0].edificio; session.datosVecino = vecinosEnSheets[0];
        } else if (vecinosEnSheets.length > 1) {
            const mencionado = vecinosEnSheets.find(v => msgClean.includes(v.edificio.toLowerCase()));
            if (mencionado) { session.edificioId = mencionado.edificio; session.nombreEdificio = mencionado.edificio; session.datosVecino = mencionado; }
            else { session.opcionesEdificio = vecinosEnSheets.map(v => v.edificio); }
        } else {
            const detectado = edificiosConocidos.find(e => {
                const oficial = e.nombre.toLowerCase().trim(); const msg = msgClean.toLowerCase().trim();
                if (msg.length < 4) return false;
                if (msg.includes(oficial) || (oficial.includes(msg) && msg.length > 7)) return true;
                return e.aliases.some(alias => { const a = alias.toLowerCase().trim(); return msg.includes(a) || (a.includes(msg) && msg.length > 7); });
            });
            if (detectado) session.edificioPendiente = detectado.nombre;
        }
    }
    if (!session.edificioId) {
        const respuestaCara = await responderVecino({ historial, vecino: null, opcionesEdificio: session.opcionesEdificio, edificioPendiente: session.edificioPendiente });
        delete session.opcionesEdificio;
        await despacharRespuesta(recipient, respuestaCara, msgType);
        return;
    }
    const [memoriaVecino, perfilEdificio, personalDeTurno] = await Promise.all([
        buscarMemoriaVecino(from), buscarPerfilEdificio(session.nombreEdificio), buscarPersonalDeTurno({ edificio: session.nombreEdificio }),
    ]);
    const vecino = session.datosVecino || { nombre: "Vecino", edificio: session.nombreEdificio, departamento: "" };
    const [decisionCaso, datosFactura] = await Promise.all([
        evaluarCaso({ historial, vecino, perfilEdificio, memoriaVecino }),
        (media && (msgType === 'image' || msgType === 'document')) ? procesarDocumento({ filePath: media.filePath, mimeType: media.mimeType, edificio: vecino?.edificio }) : Promise.resolve(null),
    ]);
    let respuesta = await responderVecino({ historial, vecino, memoriaVecino, personalDeTurno, decisionCaso, media, opcionesEdificio: null, edificioPendiente: null });
    respuesta = respuesta.replace(/Opción \d:?/gi, '').replace(/Aquí tienes algunas opciones:?/gi, '').replace(/Podemos hacer lo siguiente:?/gi, '').replace(/\n+/g, ' ').trim();
    await despacharRespuesta(recipient, respuesta, msgType);
    historial.push(`Marcos: ${respuesta}`);
    let tecnicoAsignado = null;
    if (decisionCaso.contactar_tecnico && vecino?.edificio && decisionCaso.tipo_problema) {
        tecnicoAsignado = await buscarTecnicoAsignado({ edificio: vecino.edificio, especialidad: decisionCaso.tipo_problema, esUrgente: decisionCaso.urgencia === 'alta' });
    }
    await Promise.all([
        (decisionCaso.contactar_tecnico || decisionCaso.contactar_encargado) ? gestionarOperaciones({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, accessToken: WHATSAPP_ACCESS_TOKEN }) : Promise.resolve(),
        ((decisionCaso.cerrar_caso && decisionCaso.tipo_problema !== 'otro') || decisionCaso.urgencia === 'alta' || decisionCaso.contactar_tecnico || datosFactura?.es_factura) ? reportarAlAdmin({ vecino: { ...vecino, telefono: from }, decisionCaso, tecnicoAsignado, datosFactura, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, accessToken: WHATSAPP_ACCESS_TOKEN }) : Promise.resolve(),
    ]);
    console.log(`✅ Procesado ${recipient} | Urgencia: ${decisionCaso.urgencia} | Cierre: ${decisionCaso.cerrar_caso}`);
}

function extraerDatoHistorial(historial, tipo) { return null; }

app.post('/vapi', async (req, res) => {
    try {
        const body = req.body;
        const mensajes = body?.message?.artifact?.messages || body?.messages || [];
        const callId   = body?.message?.call?.id || body?.call?.id || 'unknown';
        let from       = body?.message?.call?.customer?.number || body?.call?.customer?.number || callId;
        if (from.length > 20 || from.includes('-')) { from = '54111550542005'; console.log(`📞 [Test Web Vapi] Simulado a: ${from}`); }
        console.log(`📞 Llamada Vapi de ${from} | Call ID: ${callId}`);
        const ultimoMensajeUsuario = [...mensajes].reverse().find(m => m.role === 'user');
        if (!ultimoMensajeUsuario) return res.json({ response: 'Bien Argentinos, buenas.' });
        const textoVecino = ultimoMensajeUsuario.content || '';
        const sessionKey = `vapi_${callId}`;
        if (!sesiones.has(sessionKey)) sesiones.set(sessionKey, { historial: [] });
        const session = sesiones.get(sessionKey);
        session.historial = mensajes.filter(m => m.role === 'user' || m.role === 'assistant').map(m => m.role === 'user' ? `Vecino: ${m.content}` : `Marcos: ${m.content}`);
        session.historial.push(`Vecino: ${textoVecino}`);
        const [vecinosEnSheets, memoriaVecino, edificiosConocidos] = await Promise.all([buscarVecinosPorTelefono(from), buscarMemoriaVecino(from), listarEdificiosConocidos()]);
        let vecino = null;
        if (vecinosEnSheets.length === 1) { vecino = vecinosEnSheets[0]; session.nombreEdificio = vecino.edificio; }
        else if (vecinosEnSheets.length > 1) { const msgLower = textoVecino.toLowerCase(); const mencionado = vecinosEnSheets.find(v => msgLower.includes(v.edificio.toLowerCase().split(' ')[0])); vecino = mencionado || vecinosEnSheets[0]; session.nombreEdificio = vecino.edificio; }
        let perfilEdificio = null; let personalDeTurno = null;
        if (session.nombreEdificio) { [perfilEdificio, personalDeTurno] = await Promise.all([buscarPerfilEdificio(session.nombreEdificio), buscarPersonalDeTurno({ edificio: session.nombreEdificio })]); }
        const decisionCaso = await evaluarCaso({ historial: session.historial, vecino, perfilEdificio, memoriaVecino });
        let respuesta = await responderVecino({ historial: session.historial, vecino, memoriaVecino, personalDeTurno, decisionCaso, media: null, opcionesEdificio: vecinosEnSheets.length > 1 ? vecinosEnSheets.map(v => v.edificio) : null, edificioPendiente: null });
        respuesta = respuesta.replace(/Opción \d:?/gi, '').replace(/Aquí tienes algunas opciones:?/gi, '').replace(/Podemos hacer lo siguiente:?/gi, '').replace(/\n+/g, ' ').trim();
        console.log(`📞 Marcos responde: "${respuesta}"`);
        let tecnicoAsignado = null;
        if (decisionCaso.contactar_tecnico && session.nombreEdificio && decisionCaso.tipo_problema) { tecnicoAsignado = await buscarTecnicoAsignado({ edificio: session.nombreEdificio, especialidad: decisionCaso.tipo_problema, esUrgente: decisionCaso.urgencia === 'alta' }); }
        let promesaWhatsapp = Promise.resolve();
        if ((decisionCaso.cerrar_caso || decisionCaso.contactar_tecnico || decisionCaso.contactar_encargado) && !session.whatsapp_seguimiento_enviado) {
            session.whatsapp_seguimiento_enviado = true;
            const msjSeguimiento = `¡Hola! Hablamos recién por teléfono 📞.\nYa me estoy encargando de gestionar lo que me comentaste.\n\nCualquier novedad te la aviso por acá. Podés seguir escribiéndome o mandándome audios para cualquier consulta. ¡Saludos! - *Marcos*`;
            promesaWhatsapp = enviarWhatsApp(from, msjSeguimiento, process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
        }
        Promise.all([
            (decisionCaso.contactar_tecnico || decisionCaso.contactar_encargado) ? gestionarOperaciones({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, accessToken: WHATSAPP_ACCESS_TOKEN }) : Promise.resolve(),
            (decisionCaso.cerrar_caso || decisionCaso.urgencia === 'alta' || decisionCaso.contactar_tecnico) ? reportarAlAdmin({ vecino: { ...(vecino || {}), telefono: from, edificio: session.nombreEdificio }, decisionCaso, tecnicoAsignado, datosFactura: null, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, accessToken: WHATSAPP_ACCESS_TOKEN }) : Promise.resolve(),
            promesaWhatsapp
        ]).catch(err => console.error('Error operaciones Vapi:', err.message));
        res.json({ choices: [{ message: { role: "assistant", content: respuesta } }] });
    } catch (err) {
        console.error('Error en /vapi:', err.message);
        res.json({ choices: [{ message: { role: "assistant", content: 'Disculpe, tuve un problema técnico. ¿Puede repetirme su consulta?' } }] });
    }
});

app.post('/vapi/llamada-finalizada', async (req, res) => {
    res.sendStatus(200);
    try {
        const body = req.body;
        const tipo = body?.message?.type || body?.type || '';
        if (tipo !== 'end-of-call-report') return;
        const call = body?.message?.call || body?.call || {};
        const artifact = body?.message?.artifact || body?.artifact || {};
        const analysis = body?.message?.analysis || body?.analysis || {};
        const callId = call?.id || 'unknown';
        const from = call?.customer?.number || '';
        const duracionSeg = Math.round((call?.endedAt ? (new Date(call.endedAt) - new Date(call.startedAt)) / 1000 : 0));
        const duracion = duracionSeg > 0 ? `${Math.floor(duracionSeg / 60)}m ${duracionSeg % 60}s` : 'N/D';
        const mensajes = artifact?.messages || [];
        const transcripcion = mensajes.filter(m => m.role === 'user' || m.role === 'assistant').map(m => `${m.role === 'user' ? '👤 Vecino' : '🤖 Marcos'}: ${m.content}`).join('\n');
        let resumen = analysis?.summary || '';
        console.log(`📞 Llamada finalizada | ID: ${callId} | De: ${from} | Duración: ${duracion}`);
        const vecinos = from ? await buscarVecinosPorTelefono(from) : [];
        const vecino = vecinos[0] || null;
        const session = sesiones.get(`vapi_${callId}`) || {};
        const nombreVecino = vecino?.nombre || session.nombreVecino || 'Vecino';
        const edificio = vecino?.edificio || session.nombreEdificio || 'No especificado';
        const urgencia = session.ultimaUrgencia || 'baja';
        if (!resumen && transcripcion) {
            const { GoogleGenAI } = require('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            try { const r = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: [{ text: `Resumí en 2 oraciones esta llamada:\n\n${transcripcion}` }], config: { temperature: 0.2 } }); resumen = r.text.trim(); }
            catch (e) { resumen = 'Llamada finalizada — ver transcripción completa.'; }
        }
        let mensajeWhatsApp = '';
        if (from && transcripcion) {
            const { GoogleGenAI } = require('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            try {
                const r = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: [{ text: `Sos MARCOS de Bien Argentinos. Hablaste con ${nombreVecino} de ${edificio}.\n\n${transcripcion}\n\nEscribí un WhatsApp CORTO (máx 3 oraciones): referencia breve, confirma gestión, invita a escribir. Tono cálido argentino, de usted. Sin presentarte. Sin emojis de corazón.` }], config: { temperature: 0.7 } });
                mensajeWhatsApp = r.text.trim();
            } catch (e) { mensajeWhatsApp = `Hola ${nombreVecino}, su consulta quedó registrada. Ante cualquier novedad, escríbame por acá.`; }
        }
        if (from && mensajeWhatsApp) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            await enviarWhatsApp(from, mensajeWhatsApp, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            console.log(`💬 Mensaje post-llamada enviado a ${from}`);
        }
        await guardarLlamada({ telefono: from, vecino: nombreVecino, edificio, duracion, resumen, transcripcion, urgencia, estado: 'Finalizada', mensajeEnviado: mensajeWhatsApp ? 'Sí' : 'No' });
        if (process.env.ADMIN_PHONE) {
            const msgAdmin = `📞 *MARCOS — LLAMADA FINALIZADA*\n\n👤 *Vecino:* ${nombreVecino}\n📍 *Edificio:* ${edificio}\n⏱️ *Duración:* ${duracion}\n🚦 *Urgencia:* ${urgencia.toUpperCase()}\n\n📋 *Resumen:* ${resumen}\n\n💬 _Transcripción en Google Sheets → pestaña "llamadas"_`;
            await enviarWhatsApp(process.env.ADMIN_PHONE, msgAdmin, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
        }
        sesiones.delete(`vapi_${callId}`);
        console.log(`✅ Llamada ${callId} archivada.`);
    } catch (err) { console.error('Error fin de llamada:', err.message); }
});

app.listen(PORT, () => console.log(`🚀 Servidor Marcos corriendo en puerto ${PORT}`));