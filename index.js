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
    buscarRolPorTelefono,
} = require('./sheets');

const { descargarMedia, guardarArchivoEstructurado } = require('./media');
const { evaluarCaso }        = require('./agentes/marcos-caso');
const { responderVecino }    = require('./agentes/marcos-cara');
const { gestionarOperaciones, enviarWhatsApp, subirMediaWhatsApp, enviarAudioWhatsApp, procesarSiguienteEventoProveedor } = require('./agentes/marcos-ops');
const { procesarDocumento }  = require('./agentes/marcos-docs');
const { reportarAlAdmin, iniciarCronReportes }    = require('./agentes/marcos-admin');

const app = express();
app.use(bodyParser.json());
const path = require('path');
app.use('/audios', express.static(path.join(__dirname, 'temp')));
app.use('/archivos', express.static(path.join(__dirname, 'almacenamiento')));

const fs = require('fs');
function logDebug(msg) {
    const t = new Date().toISOString();
    fs.appendFileSync('debug_marcos.log', `[${t}] ${msg}\n`);
}

// ── REGISTRO DEL CHAT EN POSTGRES (Visor de Chat en Vivo) ────────────────────
// Hasta ahora la conversación real no se guardaba en ningún lado: la pestaña `reportes` solo
// tiene el resumen final que escribe la IA (`notas_ia`), así que el drawer del dashboard nunca
// podía mostrar el ida y vuelta mensaje por mensaje. Esto persiste cada mensaje —del vecino y de
// Marcos— en la tabla `mensajes` de PostgreSQL.
//
// Regla innegociable: registrar el chat NUNCA puede tumbar la atención de un vecino. Por eso todo
// va envuelto en try/catch y sin `await` bloqueante en el camino crítico de la respuesta.
function registrarMensajeChat({ eventoId, edificio, telefono, remitente, mensaje, tipoCanal, urlMedia }) {
    try {
        const { guardarMensaje } = require('./db-pg');
        guardarMensaje({ eventoId, edificio, telefono, remitente, mensaje, tipoCanal, urlMedia })
            .catch(err => console.error('Error registrando mensaje del chat:', err.message));
    } catch (err) {
        console.error('Error registrando mensaje del chat:', err.message);
    }
}

// Datos de contexto que solo conoce la sesión en RAM (edificio y caso activo), para etiquetar
// cada mensaje sin tener que ir a buscarlos a la base en cada línea del chat.
function contextoChat(telefono) {
    const s = global.marcosSesiones?.get(telefono) || sesiones.get(telefono) || {};
    return { edificio: s.nombreEdificio || '', eventoId: s.idEventoActual || null };
}

// ── Memoria de sesión (RAM) ──────────────────────────────────────────────────
// Historial de la conversación activa (se pierde al reiniciar, pero la memoria
// de largo plazo vive en Google Sheets)
const sesiones = new Map();

// Filtro anti-duplicación de mensajes de Meta
const mensajesProcesados = new Set();
// Limpiar IDs viejos cada 10 minutos para evitar crecimiento infinito
setInterval(() => mensajesProcesados.clear(), 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
const { META_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;

// ── Health check & Direct Portal Entry ─────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'));

// ── Verificación del webhook de Meta ─────────────────────────────────────────
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

// ── Entrada de mensajes WhatsApp ──────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
    // Meta requiere 200 OK inmediato
    res.sendStatus(200);

    try {
        const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
        if (!entry?.messages?.[0]) return;

        const message  = entry.messages[0];
        const msgId    = message.id;
        const { normalizarTelefonoWhatsApp } = require('./agentes/marcos-ops');
        const fromRaw  = message.from;
        const from     = normalizarTelefonoWhatsApp(fromRaw);
        const msgType  = message.type;
        const pushName = entry?.contacts?.[0]?.profile?.name || '';

        // Anti-duplicación
        if (mensajesProcesados.has(msgId)) {
            console.log(`🔁 Mensaje duplicado bloqueado: ${msgId}`);
            return;
        }
        mensajesProcesados.add(msgId);

        // Extraer contenido según tipo
        let msgBody = '';
        let mediaId = null;
        let contactosCompartidos = null;

        if (msgType === 'text') {
            msgBody = message.text.body;
        } else if (msgType === 'image') {
            mediaId = message.image.id;
            msgBody = message.image.caption || '(Imagen adjunta)';
        } else if (msgType === 'video') {
            mediaId = message.video.id;
            msgBody = message.video.caption || '(Video adjunto)';
        } else if (msgType === 'audio') {
            mediaId = message.audio.id;
            msgBody = '(Nota de voz)';
        } else if (msgType === 'document') {
            mediaId = message.document.id;
            msgBody = message.document.caption || '(Documento adjunto)';
        } else if (msgType === 'button') {
            // Respuesta a botón de plantilla (Quick Reply de template)
            msgBody = message.button?.text || '(Botón presionado)';
        } else if (msgType === 'interactive') {
            // Respuesta a mensaje interactivo (list_reply o button_reply)
            if (message.interactive?.type === 'button_reply') {
                msgBody = message.interactive.button_reply?.title || '(Botón presionado)';
            } else if (message.interactive?.type === 'list_reply') {
                msgBody = message.interactive.list_reply?.title || '(Opción seleccionada)';
            } else {
                msgBody = '(Respuesta interactiva)';
            }
        } else if (msgType === 'contacts') {
            // Ficha de contacto compartida desde WhatsApp (el vecino comparte "el contacto de mi
            // señora" para que le abran al técnico, el admin comparte el contacto de un proveedor,
            // etc.). Antes caía en el `else { return }` de abajo y se descartaba en silencio.
            const contactosRecibidos = (message.contacts || []).map(c => {
                const nombreCto = c?.name?.formatted_name || [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ') || 'Contacto';
                const telCto = (c?.phones || []).map(p => String(p?.wa_id || p?.phone || '').replace(/\D/g, '')).filter(Boolean)[0] || '';
                return { nombre: nombreCto, telefono: telCto };
            }).filter(c => c.telefono);

            if (contactosRecibidos.length === 0) return;
            contactosCompartidos = contactosRecibidos;
            msgBody = `(Contacto compartido) ${contactosRecibidos.map(c => `${c.nombre}: ${c.telefono}`).join(', ')}`;
            console.log(`👤 Ficha(s) de contacto recibida(s) de ${from}: ${msgBody}`);
        } else if (msgType === 'unsupported' || msgType === 'system') {
            console.log(`📞 Intento de llamada o evento de sistema detectado de ${from}`);
            await enviarWhatsApp(
                from, 
                "Disculpe, por el momento la atención por WhatsApp es únicamente mediante *mensajes de texto* o *notas de voz* 🎤.\n\nPor favor, escríbame o envíeme un audio con su consulta y lo atenderé de inmediato.", 
                WHATSAPP_PHONE_NUMBER_ID, 
                WHATSAPP_ACCESS_TOKEN
            );
            return;
        } else {
            return;
        }

        if (!global.mensajesIdMap) global.mensajesIdMap = new Map();
        if (msgId && msgBody) global.mensajesIdMap.set(msgId, msgBody);

        // Extraer contexto de mensaje citado si existe (Quote / Reply)
        if (message.context && (message.context.id || message.context.from)) {
            const idCitado = message.context.id;
            const textoCitado = global.mensajesIdMap.get(idCitado);
            console.log(`📌 Mensaje cita contexto previo ID: ${idCitado} -> "${textoCitado || 'Sin texto guardado'}"`);
            if (textoCitado) {
                msgBody = `${msgBody} [Cita el mensaje: "${textoCitado}"]`;
            } else {
                msgBody = `${msgBody} [En respuesta al mensaje/notificación anterior]`;
            }
        }

        // Telefono normalizado para sesión y envío
        let recipient = from;

        console.log(`📨 Mensaje de ${recipient} (${pushName || 'Sin PushName'}): ${msgBody}`);

        // ── SISTEMA DE ACUMULACIÓN (Humanización - 25 Segundos de Espera) ──
        // Si el usuario manda varios mensajes seguidos, esperamos 25 segundos para reunirlos todos en un solo contexto.
        // (Antes eran 15s: en la práctica, grabar+enviar 2 notas de voz y una foto casi siempre
        // supera ese tiempo real -- si el hueco entre dos mensajes pasaba los 15s, la ráfaga se
        // cortaba en dos y Marcos respondía pidiendo datos que ya venían en camino.)
        if (!global.colasMensajes) global.colasMensajes = new Map();

        if (!global.colasMensajes.has(recipient)) {
            global.colasMensajes.set(recipient, { items: [], pushName, timeout: null });
        }

        const cola = global.colasMensajes.get(recipient);
        // Guardamos cada mensaje de la ráfaga en orden (tipo + texto + mediaId) para no perder
        // ninguno al armar el contexto combinado.
        cola.items.push({ tipo: msgType, texto: msgBody, mediaId, contactos: contactosCompartidos });
        if (pushName && !cola.pushName) cola.pushName = pushName;

        // Reiniciamos el tiempo de espera (25 segundos)
        if (cola.timeout) clearTimeout(cola.timeout);

        cola.timeout = setTimeout(async () => {
            const items = cola.items;
            const pushNameFinal = cola.pushName;

            // Limpiamos la cola antes de procesar
            global.colasMensajes.delete(recipient);

            // Transcribimos TODOS los audios de la ráfaga (no solo el último), en orden, para no
            // perder datos cuando el vecino/técnico manda varias notas de voz seguidas.
            for (const item of items) {
                if (item.tipo === 'audio' && item.mediaId) {
                    try {
                        const mediaAudio = await descargarMedia(item.mediaId);
                        if (mediaAudio) {
                            const { transcribirAudio } = require('./stt');
                            const transcripcion = await transcribirAudio(mediaAudio.filePath, mediaAudio.mimeType);
                            if (transcripcion) item.texto = transcripcion;
                        }
                    } catch (e) {
                        console.error(`Error transcribiendo audio de la ráfaga (${item.mediaId}):`, e.message);
                    }
                }
            }

            // Registramos cada mensaje de la ráfaga por separado y en orden, no el texto pegado:
            // el visor del dashboard tiene que mostrar las mismas burbujas que vio el vecino
            // (su audio ya transcripto, su texto, su foto), no un bloque único.
            const ctxEntrada = contextoChat(recipient);
            for (const item of items) {
                registrarMensajeChat({
                    eventoId:  ctxEntrada.eventoId,
                    edificio:  ctxEntrada.edificio,
                    telefono:  recipient,
                    remitente: 'vecino',
                    mensaje:   item.texto || '',
                    tipoCanal: item.tipo === 'audio' ? 'whatsapp-audio' : 'whatsapp',
                    urlMedia:  item.mediaId ? `media:${item.mediaId}` : ''
                });
            }

            const msgBodyCompleto = items.map(i => i.texto).filter(Boolean).join(' ');
            // Último media NO-audio de la ráfaga (imagen/video/documento) — los audios ya se
            // transcribieron arriba, no hace falta volver a descargarlos en procesarMensaje.
            const ultimoMediaNoAudio = [...items].reverse().find(i => i.mediaId && i.tipo !== 'audio');
            const mediaIdFinal = ultimoMediaNoAudio ? ultimoMediaNoAudio.mediaId : null;
            const huboAudio = items.some(i => i.tipo === 'audio');
            // msgTypeFinal describe QUÉ ADJUNTO viaja (mediaIdFinal), y tiene que ser coherente
            // con él: aguas abajo se decide "es imagen -> reenviar la foto al técnico, guardarla
            // en /imagenes" mirando msgType. Antes, si la ráfaga traía audios Y una foto (el caso
            // más normal: el vecino cuenta el problema por audio y adjunta la foto), el tipo
            // quedaba en 'audio' y la foto se volvía invisible -- se archivaba en la carpeta de
            // audios y nunca se le reenviaba al técnico.
            const msgTypeFinal = ultimoMediaNoAudio
                ? ultimoMediaNoAudio.tipo
                : (huboAudio ? 'audio' : items[items.length - 1].tipo);
            // Que hubiera audio en la ráfaga define el MODO DE RESPUESTA (nota de voz), que es
            // una decisión independiente de qué adjunto viaja.
            const preferirAudioRespuesta = huboAudio;

            logDebug(`[${recipient}] Procesando ráfaga acumulada (25s): "${msgBodyCompleto}"`);

            // Llamada al orquestador con el texto acumulado
            // Fichas de contacto compartidas en la ráfaga (se acumulan todas, en orden)
            const contactosFinal = items.flatMap(i => i.contactos || []);

            await procesarMensaje({ from, recipient, msgBody: msgBodyCompleto, mediaId: mediaIdFinal, msgType: msgTypeFinal, pushName: pushNameFinal, preferirAudioRespuesta, contactosCompartidos: contactosFinal }).catch(err => {
                console.error('Error procesando mensaje:', err.message);
                const respuestasHumanas = [
                    'Aguárdeme un instante por favor, estoy actualizando el sistema y ya le respondo.',
                    'Disculpe la demora, estoy registrando los datos y le respondo en breve.',
                    'Aguarde un segundo por favor, ya retomo su consulta.'
                ];
                const msgFb = respuestasHumanas[Math.floor(Math.random() * respuestasHumanas.length)];
                enviarWhatsApp(
                    recipient,
                    msgFb,
                    WHATSAPP_PHONE_NUMBER_ID,
                    WHATSAPP_ACCESS_TOKEN
                );
            });
        }, 25000); // 25 segundos de espera para reunir ráfagas de mensajes del vecino (audio + texto) sin demorar la respuesta

    } catch (err) {
        console.error('Error en webhook:', err.message);
    }
});

// ── DESPACHADOR DE RESPUESTAS (Modo Espejo / TTS) ─────────────────────────────
async function despacharRespuesta(recipient, texto, msgType) {
    if (!texto) return;

    // Registramos la respuesta de Marcos en el chat. Guardamos siempre el TEXTO, aunque salga
    // como nota de voz: el visor necesita leer qué dijo, no reproducir el ogg.
    const ctxSalida = contextoChat(recipient);
    registrarMensajeChat({
        eventoId:  ctxSalida.eventoId,
        edificio:  ctxSalida.edificio,
        telefono:  recipient,
        remitente: 'marcos',
        mensaje:   texto,
        tipoCanal: msgType === 'audio' ? 'whatsapp-audio' : 'whatsapp'
    });

    // Simular tiempo de escritura humano (60ms por caracter, máx 10 segundos)
    const demora = Math.min(texto.length * 60, 10000);
    await new Promise(resolve => setTimeout(resolve, demora));

    if (msgType === 'audio') {
        if (!global.marcosSesiones) global.marcosSesiones = new Map();
        const session = global.marcosSesiones.get(recipient) || {};
        
        // Limpiar historial de audios generados en las últimas 24 horas
        const ahora = Date.now();
        const HORA_24_MS = 24 * 60 * 60 * 1000;
        const audios24h = (session.audiosGeneradosTimestamps || []).filter(t => (ahora - t) < HORA_24_MS);
        session.audiosGeneradosTimestamps = audios24h;

        // Regla fundamental: Máximo 2 notas de voz en 24 horas por vecino/remitente
        if (audios24h.length < 2) {
            try {
                console.log(`🎙️ Generando nota de voz #${audios24h.length + 1} (máx 2 por 24h) para ${recipient}...`);
                const { generarAudio } = require('./tts');
                const { subirMediaWhatsApp, enviarAudioWhatsApp } = require('./agentes/marcos-ops');
                
                const fileName = await generarAudio(texto, `audio_${Date.now()}.ogg`);
                const mediaIdTTS = await subirMediaWhatsApp(fileName, 'audio/ogg', process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
                
                if (mediaIdTTS) {
                    await enviarAudioWhatsApp(recipient, mediaIdTTS, process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
                    audios24h.push(ahora);
                    session.audiosGeneradosTimestamps = audios24h;
                    const fs = require('fs');
                    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                    return;
                }
            } catch (error) {
                console.error('Error en despacharRespuesta (TTS):', error.message);
            }
        } else {
            console.log(`⚠️ Límite de 2 notas de voz en 24h alcanzado para ${recipient}. Respondiendo por TEXTO para optimizar consumo.`);
        }
    }

    const { enviarWhatsApp } = require('./agentes/marcos-ops');
    await enviarWhatsApp(recipient, texto, process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
}

// ── BÚSQUEDA ROBUSTA DE VECINO ACTIVO PARA PROVEEDORES (3 NIVELES) ───────────────
async function obtenerVecinoActivoDeProveedor({ telTech, edificioNombre, datosEmisor, session }) {
    const telClean = String(telTech || '').replace(/\D/g, '');
    
    // 1. Nivel RAM: global.colasProveedores
    const stProv = global.colasProveedores?.get(telClean);
    if (stProv?.vecinoActivo?.telefono) {
        console.log(`📌 [RAM] Vecino activo para técnico ${datosEmisor?.nombre}: ${stProv.vecinoActivo.nombre} (${stProv.vecinoActivo.telefono})`);
        return stProv.vecinoActivo;
    }

    // 2. Nivel Sesión
    if (session?.datosVecino?.telefono) {
        const vObj = {
            nombre: (session.datosVecino.nombre && session.datosVecino.nombre !== 'Vecino' && session.datosVecino.nombre !== 'Desconocido') ? session.datosVecino.nombre : '',
            telefono: session.datosVecino.telefono,
            departamento: session.datosVecino.departamento || '',
            edificio: session.nombreEdificio || edificioNombre || ''
        };
        console.log(`📌 [Sesión] Vecino activo para técnico ${datosEmisor?.nombre}: ${vObj.nombre} (${vObj.telefono})`);
        if (stProv) stProv.vecinoActivo = vObj;
        return vObj;
    }

    // 3. Nivel Sheets EVENTOS (Último caso abierto)
    try {
        const { getSheet } = require('./sheets');
        const doc = await getSheet();
        const sheet = doc.sheetsByTitle['EVENTOS'];
        if (sheet) {
            const rows = await sheet.getRows();
            const edifBuscado = String(edificioNombre || '').toLowerCase().trim();
            const nomTechBuscado = String(datosEmisor?.nombre || '').toLowerCase().trim();

            const row = [...rows].reverse().find(r => {
                const rEst = String(r.get('estado') || '').toLowerCase().trim();
                if (rEst === 'resuelto' || rEst === 'cerrado') return false;

                const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
                const rTech = String(r.get('tecnico') || '').toLowerCase().trim();
                const rTel = String(r.get('telefono') || '').replace(/\D/g, '');

                const matchEdif = edifBuscado && (rEdif.includes(edifBuscado) || edifBuscado.includes(rEdif));
                const matchTech = nomTechBuscado && rTech.includes(nomTechBuscado);

                return rTel.length >= 6 && (matchEdif || matchTech);
            });

            if (row) {
                const vObj = {
                    nombre: (row.get('vecino') && row.get('vecino') !== 'Desconocido' && row.get('vecino') !== 'Vecino') ? row.get('vecino') : '',
                    telefono: row.get('telefono'),
                    departamento: row.get('depto') || '',
                    edificio: row.get('edificio') || edificioNombre || ''
                };
                console.log(`📌 [Sheets EVENTOS] Vecino activo recuperado para técnico ${datosEmisor?.nombre}: ${vObj.nombre} (${vObj.telefono})`);
                if (!global.colasProveedores) global.colasProveedores = new Map();
                if (!global.colasProveedores.has(telClean)) global.colasProveedores.set(telClean, { vecinoActivo: vObj });
                else global.colasProveedores.get(telClean).vecinoActivo = vObj;
                return vObj;
            }
        }
    } catch (e) {
        console.error('Error buscando vecino activo en Sheets EVENTOS:', e.message);
    }

    // 4. Nivel Sheets VECINOS (Último vecino del edificio)
    try {
        const { getSheet } = require('./sheets');
        const doc = await getSheet();
        const sheetVec = doc.sheetsByTitle['VECINOS'] || doc.sheetsByIndex[0];
        if (sheetVec && edificioNombre) {
            const rowsVec = await sheetVec.getRows();
            const edifBuscado = String(edificioNombre).toLowerCase().trim();
            const rowVec = [...rowsVec].reverse().find(r => {
                const edif = String(r.get('edificio') || '').toLowerCase().trim();
                const tel = String(r.get('telefono') || '').replace(/\D/g, '');
                return tel.length >= 6 && (edif.includes(edifBuscado) || edifBuscado.includes(edif));
            });

            if (rowVec) {
                const vObj = {
                    nombre: rowVec.get('nombre') || '',
                    telefono: rowVec.get('telefono'),
                    departamento: rowVec.get('departamento') || '',
                    edificio: rowVec.get('edificio') || edificioNombre
                };
                console.log(`📌 [Sheets VECINOS] Vecino recuperado para edificio ${edificioNombre}: ${vObj.nombre} (${vObj.telefono})`);
                if (!global.colasProveedores) global.colasProveedores = new Map();
                if (!global.colasProveedores.has(telClean)) global.colasProveedores.set(telClean, { vecinoActivo: vObj });
                else global.colasProveedores.get(telClean).vecinoActivo = vObj;
                return vObj;
            }
        }
    } catch (e) {
        console.error('Error buscando vecino en Sheets VECINOS:', e.message);
    }

    return null;
}

// ── ORQUESTADOR PRINCIPAL ─────────────────────────────────────────────────────
async function procesarMensaje({ from, recipient, msgBody, mediaId, msgType, pushName, preferirAudioRespuesta = false, contactosCompartidos = [] }) {
    // Modo en que le contestamos al usuario (nota de voz vs texto). Es independiente del tipo de
    // adjunto que trajo el mensaje: una ráfaga puede traer una foto (msgType 'image', para
    // reenviarla al técnico) y aun así merecer una respuesta hablada porque el vecino usó audios.
    const msgTypeRespuesta = (preferirAudioRespuesta || msgType === 'audio') ? 'audio' : msgType;

    // ── FASE 0: DESCARGA Y TRANSCRIPCIÓN (si es audio) ───────────────────────
    let media = null;
    if (mediaId) {
        media = await descargarMedia(mediaId);
    }

    let textoFinal = msgBody;
    let transcripcionFinal = '';
    // Nota: el sistema de acumulación de ráfagas (webhook) ya transcribe todos los audios de
    // antemano y solo pasa mediaId aquí si es una imagen/video/documento. Se valida el mimeType
    // real (no solo msgType) para no intentar transcribir un archivo que no es audio si una
    // ráfaga trajo audio + foto juntos (msgType queda en 'audio' pero mediaId es de la foto).
    if (msgType === 'audio' && media && String(media.mimeType || '').startsWith('audio')) {
        const { transcribirAudio } = require('./stt');
        const transcripcion = await transcribirAudio(media.filePath, media.mimeType);
        if (transcripcion) {
            transcripcionFinal = transcripcion;
            const textoAdicional = String(msgBody || '').replace(/\(Nota de voz\)/gi, '').trim();
            if (textoAdicional) {
                textoFinal = `${transcripcion} ${textoAdicional}`.trim();
            } else {
                textoFinal = transcripcion;
            }
            console.log(`🎙️ Marcos escuchó y combinó audio + texto: "${textoFinal}"`);
        }
    }

    // ── FASE 1: CONTEXTO ─────────────────────────────────────────────────────
    const msgClean = textoFinal.toLowerCase().trim().replace(/\s+/g, ' ');

function validarYSanitizarNombre(nombre) {
    if (!nombre || typeof nombre !== 'string') return '';
    const clean = nombre.trim();
    if (clean.length < 2 || clean.length > 25) return '';

    const frasesSospechosas = [
        'lindo', 'linda', 'mundo', 'eres', 'amor', 'dios', 'rey', 'reina', 'bebe',
        'frases', 'status', 'oficial', 'tienda', 'shop', 'hola', 'bienvenido',
        'sin nombre', 'desconocido', 'usuario', 'whatsapp', 'admin', 'soporte', 'contact',
        'tu', 'yo', 'vida', 'jesus', 'familia', 'xx', 'vip', 'el mas', 'la mas', 'modo'
    ];
    const norm = clean.toLowerCase();
    if (frasesSospechosas.some(f => norm.includes(f))) return '';

    const palabras = clean.split(/\s+/);
    if (palabras.length > 3) return '';

    const letras = clean.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
    if (letras.length < 2) return '';

    return clean;
}

    // 1a. Obtener o crear sesión (Caducidad automática tras 6 horas de inactividad)
    if (!global.marcosSesiones) global.marcosSesiones = new Map();
    const TIEMPO_CADUCIDAD_MS = 6 * 60 * 60 * 1000; // 6 horas

    if (global.marcosSesiones.has(recipient)) {
        const s = global.marcosSesiones.get(recipient);
        const inactivo = Date.now() - (s.ultimoMensajeTimestamp || 0);
        if (inactivo > TIEMPO_CADUCIDAD_MS) {
            console.log(`⏳ Sesión de ${recipient} caducó por inactividad (${Math.round(inactivo / 60000)} min). Nueva sesión creada.`);
            global.marcosSesiones.delete(recipient);
        }
    }

    const pushNameValido = validarYSanitizarNombre(pushName);

    if (!global.marcosSesiones.has(recipient)) {
        global.marcosSesiones.set(recipient, { 
            historial: [],
            fechaInicio: new Date().toLocaleString('es-AR'),
            pushName: pushNameValido,
            ultimoMensajeTimestamp: Date.now()
        });
    }
    const session = global.marcosSesiones.get(recipient);
    session.ultimoMensajeTimestamp = Date.now();
    if (pushNameValido && !session.pushName) session.pushName = pushNameValido;

    // Declarar variables de contexto con alcance amplio para evitar ReferenceError
    let perfilEdificio = null;
    let memoriaVecino = null;
    let personalDeTurno = null;

    // Guardar el último audio recibido en almacenamiento permanente por Administrador / Edificio / Audios
    if (msgType === 'audio' && media) {
        const resEst = guardarArchivoEstructurado({
            filePath: media.filePath,
            adminNombre: session.datosVecino?.adminNombre,
            edificioNombre: session.nombreEdificio,
            tipo: 'audios'
        });
        session.audio_url = resEst?.relativeUrl || `/audios/${path.basename(media.filePath)}`;
    }
    // La transcripción se guarda aparte del archivo: en una ráfaga con audios + foto, el adjunto
    // que viaja es la imagen (msgType 'image'), pero los audios igual fueron transcritos antes y
    // esa transcripción no se debe perder.
    if (transcripcionFinal) {
        session.transcripcion = transcripcionFinal;
    }

    // Guardar la última imagen o video recibido en almacenamiento permanente
    let imgUrl = '';
    let videoUrl = '';
    if (msgType === 'image' && media) {
        const resEst = guardarArchivoEstructurado({
            filePath: media.filePath,
            adminNombre: session.datosVecino?.adminNombre,
            edificioNombre: session.nombreEdificio,
            tipo: 'imagenes'
        });
        imgUrl = resEst?.relativeUrl || `/archivos/${path.basename(media.filePath)}`;
    } else if (msgType === 'video' && media) {
        const resEst = guardarArchivoEstructurado({
            filePath: media.filePath,
            adminNombre: session.datosVecino?.adminNombre,
            edificioNombre: session.nombreEdificio,
            tipo: 'imagenes'
        });
        videoUrl = resEst?.relativeUrl || `/archivos/${path.basename(media.filePath)}`;
    }

    // 1b. Cargar edificios y detección de Rol por Teléfono (Proveedor, Encargado, Admin, Vecino)
    const edificiosConocidos = await listarEdificiosConocidos();
    const datosEmisor = await buscarRolPorTelefono(from);
    console.log(`👤 Rol detectado para ${from}: ${datosEmisor.rol} (${datosEmisor.nombre || 'Sin nombre'})`);

    // 1c. Buscar en Sheets por teléfono
    const vecinosEnSheets = await buscarVecinosPorTelefono(from);

    // Si quien escribe es Proveedor, Encargado o Admin, detectar edificio activo real del evento o asignación
    if (datosEmisor.rol === 'proveedor') {
        const telTech = String(from).replace(/\D/g, '');
        if (!global.colasProveedores) global.colasProveedores = new Map();
        if (!global.colasProveedores.has(telTech)) {
            global.colasProveedores.set(telTech, { eventoActivoId: null, edificioActivo: null, colaPendientes: [] });
        }
        const stProv = global.colasProveedores.get(telTech);
        stProv.chatActivo = true;
        stProv.ultimoMensajeTimestamp = Date.now();

        // Buscar edificio del evento activo del proveedor (en RAM o Sheets EVENTOS)
        let edifDetectado = stProv.edificioActivo || stProv.vecinoActivo?.edificio;
        if (!edifDetectado) {
            try {
                const { getSheet } = require('./sheets');
                const doc = await getSheet();
                const sheet = doc.sheetsByTitle['EVENTOS'];
                if (sheet) {
                    const rows = await sheet.getRows();
                    const nomTechBuscado = String(datosEmisor.nombre || '').toLowerCase().trim();
                    const rowTech = [...rows].reverse().find(r => {
                        const rEst = String(r.get('estado') || '').toLowerCase().trim();
                        const rTech = String(r.get('tecnico') || '').toLowerCase().trim();
                        return (rEst !== 'resuelto' && rEst !== 'cerrado') && nomTechBuscado && (rTech.includes(nomTechBuscado) || nomTechBuscado.includes(rTech));
                    });
                    if (rowTech) {
                        edifDetectado = rowTech.get('edificio');
                    }
                }
            } catch (e) {
                console.error('Error buscando edificio del proveedor en EVENTOS:', e.message);
            }
        }

        if (edifDetectado) {
            session.edificioId = edifDetectado;
            session.nombreEdificio = edifDetectado;
            stProv.edificioActivo = edifDetectado;
        } else if (!session.edificioId) {
            session.edificioId = datosEmisor.edificio || (edificiosConocidos[0] ? edificiosConocidos[0].nombre : 'Consorcio');
            session.nombreEdificio = session.edificioId;
        }
    } else if (datosEmisor.rol !== 'vecino') {
        session.edificioId = session.edificioId || datosEmisor.edificio || (edificiosConocidos[0] ? edificiosConocidos[0].nombre : 'Consorcio');
        session.nombreEdificio = session.nombreEdificio || session.edificioId;
    }

    // Comando de REINICIO manual
    if (msgClean === 'reiniciar' || msgClean === 'limpiar' || msgClean === 'chau') {
        global.marcosSesiones.delete(recipient);
        await despacharRespuesta(recipient, "✅ Memoria de sesión reiniciada. ¿En qué puedo ayudarte?", msgTypeRespuesta);
        return;
    }

    const historial = session.historial;
    let messageText = textoFinal;
    if (msgType === 'image' && imgUrl) {
        messageText = `[IMAGEN:${imgUrl}]` + (textoFinal && textoFinal !== '(Imagen adjunta)' ? ' ' + textoFinal : '');
    } else if (msgType === 'video' && videoUrl) {
        messageText = `[VIDEO:${videoUrl}]` + (textoFinal && textoFinal !== '(Video adjunto)' ? ' ' + textoFinal : '');
    } else if (msgType === 'audio' && session.audio_url) {
        messageText = `[AUDIO:${session.audio_url}]` + (textoFinal && textoFinal !== '(Nota de voz)' ? ' ' + textoFinal : '');
    }
    historial.push(`${datosEmisor.rol === 'proveedor' ? 'Proveedor (' + datosEmisor.nombre + ')' : (datosEmisor.rol === 'encargado' ? 'Encargado' : 'Vecino')}: ${messageText}`);
    if (historial.length > 30) historial.shift();

    // ──────── DISCRIMINADOR DE RESOLUCIÓN DE CASOS ────────
    if (session.esperandoSeleccionCasoResuelto && Array.isArray(session.esperandoSeleccionCasoResuelto)) {
        const casosP = session.esperandoSeleccionCasoResuelto;
        let casoElegido = null;

        const numSel = parseInt(msgClean.replace(/\D/g, ''), 10);
        if (!isNaN(numSel) && numSel >= 1 && numSel <= casosP.length) {
            casoElegido = casosP[numSel - 1];
        } else {
            casoElegido = casosP.find(c => {
                const probNorm = (c.problema || '').toLowerCase();
                return msgClean.split(' ').some(w => w.length >= 4 && probNorm.includes(w));
            });
        }

        if (casoElegido) {
            const { marcarCasoResueltoPorId } = require('./sheets');
            const resData = await marcarCasoResueltoPorId(casoElegido.id_evento);
            session.esperandoSeleccionCasoResuelto = null;
            const confirmMsg = `✅ *RECLAMO SOLUCIONADO*\n\nExcelente, he marcado el caso *[${casoElegido.id_evento}]* (${casoElegido.problema}) como *RESUELTO* en *${session.nombreEdificio}*.\n\n¡Muchas gracias por confirmarnos!`;
            await despacharRespuesta(recipient, confirmMsg, msgTypeRespuesta);

            if (resData && resData.telefono && resData.telefono !== from) {
                try {
                    const { enviarEncuestaServicio } = require('./agentes/marcos-ops');
                    await enviarEncuestaServicio({ vecino: { telefono: resData.telefono, nombre: resData.vecino }, id_evento: resData.id_evento, edificio: resData.edificio });
                } catch(e) {}
            }
            return;
        }
    }

    const esGatilloResolucion = /solucionad|resuelt|trabajo.*terminad|trabajo.*realizad|listo.*trabajo|ya qued. arreglad|ya qued. listo|ya arreglaron|ya funciona|ya lo repar/i.test(textoFinal);
    
    if (esGatilloResolucion) {
        const { obtenerCasosAbiertosEdificio, marcarCasoResueltoPorId } = require('./sheets');
        const casosAbiertos = await obtenerCasosAbiertosEdificio(session.nombreEdificio);

        if (casosAbiertos.length === 0) {
            await despacharRespuesta(recipient, `Muchas gracias por avisar. En *${session.nombreEdificio || 'el consorcio'}* no tenemos reclamos pendientes abiertos en este momento.`, msgTypeRespuesta);
            return;
        } else if (casosAbiertos.length === 1) {
            const cUnico = casosAbiertos[0];
            const resData = await marcarCasoResueltoPorId(cUnico.id_evento);
            const confirmMsg = `✅ *RECLAMO SOLUCIONADO*\n\nExcelente, he marcado el caso *[${cUnico.id_evento}]* (${cUnico.problema}) como *RESUELTO* en *${session.nombreEdificio}*.\n\n¡Muchas gracias por tu confirmación!`;
            await despacharRespuesta(recipient, confirmMsg, msgTypeRespuesta);

            if (resData && resData.telefono && resData.telefono !== from) {
                try {
                    const { enviarEncuestaServicio } = require('./agentes/marcos-ops');
                    await enviarEncuestaServicio({ vecino: { telefono: resData.telefono, nombre: resData.vecino }, id_evento: resData.id_evento, edificio: resData.edificio });
                } catch(e) {}
            }
            return;
        } else {
            const coincidenciaDirecta = casosAbiertos.find(c => {
                const probNorm = (c.problema || '').toLowerCase();
                return msgClean.split(' ').some(w => w.length >= 4 && probNorm.includes(w));
            });

            if (coincidenciaDirecta) {
                const resData = await marcarCasoResueltoPorId(coincidenciaDirecta.id_evento);
                const confirmMsg = `✅ *RECLAMO SOLUCIONADO*\n\nExcelente, asocié tu mensaje al caso *[${coincidenciaDirecta.id_evento}]* (${coincidenciaDirecta.problema}) y lo he marcado como *RESUELTO* en *${session.nombreEdificio}*.\n\nLos demás reclamos del edificio continúan en curso.`;
                await despacharRespuesta(recipient, confirmMsg, msgTypeRespuesta);

                if (resData && resData.telefono && resData.telefono !== from) {
                    try {
                        const { enviarEncuestaServicio } = require('./agentes/marcos-ops');
                        await enviarEncuestaServicio({ vecino: { telefono: resData.telefono, nombre: resData.vecino }, id_evento: resData.id_evento, edificio: resData.edificio });
                    } catch(e) {}
                }
                return;
            } else {
                session.esperandoSeleccionCasoResuelto = casosAbiertos;
                let listaOpciones = `📋 *MARCOS — SELECCIÓN DE RECLAMO SOLUCIONADO*\n\nExcelente. En *${session.nombreEdificio}* tenemos los siguientes reclamos abiertos en curso:\n\n`;
                casosAbiertos.forEach((c, idx) => {
                    listaOpciones += `${idx + 1}️⃣ *[${c.id_evento}]*: ${c.problema} (Depto: ${c.depto || '—'})\n`;
                });
                listaOpciones += `\n¿Cuál de estos inconvenientes es el que quedó solucionado? Podés responder con el número (ej: 1 o 2).`;

                await despacharRespuesta(recipient, listaOpciones, msgTypeRespuesta);
                return;
            }
        }
    }

    // Helper para normalizar y matchear edificios de forma inteligente (soporta variaciones como San Patricio 159)
    function normalizarTextoEdificio(str) {
        return String(str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function buscarEdificioEnTexto(texto, listaEdificios) {
        if (!texto || !listaEdificios || listaEdificios.length === 0) return null;
        const txtNorm = normalizarTextoEdificio(texto);
        if (!txtNorm) return null;

        const numerosEnMensaje = txtNorm.match(/\d+/g) || [];

        // 1. REGLA POR NÚMERO DE CALLE EXACTO DE ESE EDIFICIO
        if (numerosEnMensaje.length > 0) {
            for (const num of numerosEnMensaje) {
                const edificioConNum = listaEdificios.find(e => {
                    const todosLosCamposDeEsteEdificio = [
                        e.nombre,
                        e.direccion,
                        ...(Array.isArray(e.aliases) ? e.aliases : String(e.aliases || '').split(','))
                    ].map(normalizarTextoEdificio).filter(Boolean);

                    return todosLosCamposDeEsteEdificio.some(campo => {
                        const nums = campo.match(/\d+/g) || [];
                        return nums.includes(num);
                    });
                });

                if (edificioConNum) {
                    console.log(`🎯 Coincidencia exacta por número de altura ${num} -> Edificio: "${edificioConNum.nombre}"`);
                    return edificioConNum;
                }
            }
        }

        // 2. REGLA POR COINCIDENCIA DE ALIAS / DIRECCIÓN / NOMBRE PROPIO DE ESE EDIFICIO
        for (const e of listaEdificios) {
            const variacionesPropias = [
                e.nombre,
                e.direccion,
                ...(Array.isArray(e.aliases) ? e.aliases : String(e.aliases || '').split(','))
            ].map(normalizarTextoEdificio).filter(Boolean);

            for (const v of variacionesPropias) {
                if (v.length < 3) continue;
                // El mensaje del usuario debe contener la variación/alias propio de este edificio
                if (txtNorm.includes(v)) {
                    console.log(`🎯 Coincidencia por alias/dirección exacta "${v}" -> Edificio: "${e.nombre}"`);
                    return e;
                }
            }
        }

        return null;
    }

    // Si en el mensaje se menciona explícitamente un edificio conocido, asignarlo directamente a la sesión
    const edificioMencionadoEnMensaje = buscarEdificioEnTexto(msgClean, edificiosConocidos);
    if (edificioMencionadoEnMensaje) {
        session.edificioId = edificioMencionadoEnMensaje.nombre;
        session.nombreEdificio = edificioMencionadoEnMensaje.nombre;
        const vMatch = vecinosEnSheets.find(v => v.edificio === session.edificioId);
        if (vMatch) session.datosVecino = vMatch;
        else delete session.datosVecino;
    }

    // ── Lógica de Identificación Natural (Fallback) ───────────────────────
    if (!session.edificioId && datosEmisor.rol === 'vecino') {
        // Caso A: Confirmación de edificio pendiente
        if (session.edificioPendiente && (msgClean.includes('si') || msgClean.includes('correcto') || msgClean.includes('es esa'))) {
            session.edificioId = session.edificioPendiente;
            session.nombreEdificio = session.edificioPendiente;
            const v = vecinosEnSheets.find(v => v.edificio === session.edificioId);
            if (v) session.datosVecino = v;
            delete session.edificioPendiente;
        } 
        // Caso B: El vecino ya está en Sheets para un edificio
        else if (vecinosEnSheets.length === 1) {
            session.edificioId = vecinosEnSheets[0].edificio;
            session.nombreEdificio = vecinosEnSheets[0].edificio;
            session.datosVecino = vecinosEnSheets[0];
        }
        else if (vecinosEnSheets.length > 1) {
            const mencionado = vecinosEnSheets.find(v => msgClean.includes(v.edificio.toLowerCase()));
            if (mencionado) {
                session.edificioId = mencionado.edificio;
                session.nombreEdificio = mencionado.edificio;
                session.datosVecino = mencionado;
            } else {
                session.opcionesEdificio = vecinosEnSheets.map(v => v.edificio);
            }
        }
    }

    // Si aún no tenemos edificioId (y es vecino), dejamos que Marcos-Cara lo pida naturalmente
    if (!session.edificioId && datosEmisor.rol === 'vecino') {
        const resCara = await responderVecino({
            historial,
            vecino: session.datosVecino || (session.pushName ? { nombre: session.pushName } : null),
            opcionesEdificio: session.opcionesEdificio,
            edificioPendiente: session.edificioPendiente,
            edificiosConocidos: edificiosConocidos,
            datosEmisor
        });
        delete session.opcionesEdificio;
        const respuestaCaraStr = (typeof resCara === 'object' && resCara !== null && resCara.texto)
            ? String(resCara.texto)
            : String(resCara || '');
        await despacharRespuesta(recipient, respuestaCaraStr, msgTypeRespuesta);
        return;
    }

    // Si llegamos acá, ya tenemos edificioId. Cargamos datos extras.
    [memoriaVecino, perfilEdificio, personalDeTurno] = await Promise.all([
        buscarMemoriaVecino(from),
        buscarPerfilEdificio(session.nombreEdificio),
        buscarPersonalDeTurno({ edificio: session.nombreEdificio }),
    ]);

    // Construir objeto vecino con el edificio de la sesión activa (NUNCA usar pushName de WhatsApp como nombre agendado)
    const nombreVecinoFinal = (session.datosVecino && session.datosVecino.nombre && session.datosVecino.nombre !== 'Vecino' && session.datosVecino.nombre !== 'Desconocido') 
        ? session.datosVecino.nombre 
        : "Vecino";

    const vecino = {
        nombre: nombreVecinoFinal,
        telefono: from,
        edificio: session.nombreEdificio,
        departamento: (session.datosVecino && session.datosVecino.edificio === session.nombreEdificio) ? (session.datosVecino.departamento || "") : ""
    };

    // Si el vecino todavía no está identificado (nombre y/o depto), intentamos extraerlo del
    // propio mensaje/ráfaga ACTUAL antes de generar la respuesta. Sin esto, si un vecino nuevo
    // dice su nombre y depto en el mismo audio donde cuenta el problema, Marcos igual se lo
    // vuelve a pedir en esa misma respuesta -- porque el registro formal en Sheets (FASE 5) recién
    // corre DESPUÉS de contestarle, y hasta ese momento "vecino.nombre" sigue en "Vecino".
    if (vecino.nombre === 'Vecino' || !vecino.departamento) {
        try {
            const extraidoTemprano = await extraerDatosVecinoNuevo(historial);
            if (extraidoTemprano?.nombre && vecino.nombre === 'Vecino') vecino.nombre = extraidoTemprano.nombre;
            if (extraidoTemprano?.departamento && !vecino.departamento) vecino.departamento = extraidoTemprano.departamento;
        } catch (e) {
            console.error('Error en extracción temprana de nombre/depto del vecino:', e.message);
        }
    }

    // ── FASE 2: ANÁLISIS EN PARALELO ────────────────────────────────────────

    // Marcos-Caso y Marcos-Docs corren en paralelo para no sumar latencia
    const [decisionCaso, datosFactura] = await Promise.all([
        evaluarCaso({ historial, vecino, perfilEdificio, memoriaVecino }),
        (media && (msgType === 'image' || msgType === 'document'))
            ? procesarDocumento({ filePath: media.filePath, mimeType: media.mimeType, edificio: vecino?.edificio })
            : Promise.resolve(null),
    ]);

    // DESACTIVAR BUCLE DE PLANTILLAS Y MANEJAR MODO PROVEEDOR DIRECTO
    if (datosEmisor.rol === 'proveedor') {
        decisionCaso.contactar_tecnico = false;
        decisionCaso.contactar_encargado = false;

        const txtLow = (msgBody || '').toLowerCase();

        // A. MANEJO DE FACTURAS Y COMPROBANTES DE COBRO DEL PROVEEDOR
        // Ojo: "factura"/"pago" aparecen tanto en una factura REAL entregada como en una PREGUNTA
        // sobre el proceso (ej. "¿A quién le mando la factura?"). Sin distinguirlas, una pregunta
        // sin ningún archivo adjunto se confirmaba como "ya recibí la factura" -- falso positivo.
        // Si no hay media adjunta y el mensaje tiene forma de pregunta, NO se trata como entrega
        // real (cae al ramal libre de abajo, que sí puede responder la pregunta con contexto real).
        const parecePreguntaSinAdjunto = !media && /\?|qui[eé]n|c[oó]mo|cu[aá]ndo|d[oó]nde|puedo|debo|hay que/i.test(txtLow);
        const esFacturaODoc = !parecePreguntaSinAdjunto && (
            (datosFactura?.es_factura) ||
            /factura|comprobante|recibo|pago|cobro|remito|cbu|transferencia/i.test(txtLow) ||
            (media && (msgType === 'document' || msgType === 'image') && !/foto|video|cerradura|especifi|aclarar|ver/.test(txtLow))
        );

        if (esFacturaODoc) {
            // TRABAJO RESUELTO POR FUERA DEL CIRCUITO: el encargado/administrador llamó al técnico
            // directo, se resolvió, y la factura llega a Marcos sin que exista ningún evento previo
            // (nunca hubo un reclamo de vecino por WhatsApp). Antes la factura se guardaba con
            // edificio "Consorcio" genérico y sin evento asociado -> un gasto huérfano en el
            // dashboard que nadie podía rastrear. Ahora intentamos identificar el edificio por lo
            // que escribió el técnico (o por lo que dice el propio comprobante) y damos de alta el
            // evento retroactivamente, ya cerrado.
            const edifDetectadoTexto = buscarEdificioEnTexto(msgClean, edificiosConocidos);
            const edificioFactura = session.nombreEdificio
                || edifDetectadoTexto?.nombre
                || datosFactura?.edificio
                || '';

            if (media?.filePath) {
                const resEstFactura = guardarArchivoEstructurado({
                    filePath: media.filePath,
                    adminNombre: perfilEdificio?.adminNombre,
                    edificioNombre: edificioFactura || 'Consorcio',
                    tipo: 'facturas'
                });
                if (resEstFactura && datosFactura) {
                    datosFactura.url_archivo = resEstFactura.relativeUrl;
                }
            }

            const { guardarFactura } = require('./sheets');
            await guardarFactura({
                proveedor: datosEmisor.nombre || datosFactura?.proveedor || 'Proveedor',
                monto: datosFactura?.monto || 'Según comprobante',
                concepto: datosFactura?.concepto || 'Servicio técnico realizado',
                edificio: edificioFactura || 'Consorcio',
                url_archivo: datosFactura?.url_archivo || '',
                numero_factura: datosFactura?.numero_factura || ''
            });

            // Si no había un caso abierto de este técnico y sí pudimos identificar el edificio,
            // registramos el trabajo como evento nuevo YA RESUELTO, para que quede la trazabilidad
            // completa (qué se hizo, dónde, quién, con qué comprobante) aunque el reclamo nunca
            // haya pasado por Marcos.
            let respExtra = '';
            const huboEventoPrevio = !!session.nombreEdificio;
            if (!huboEventoPrevio && edificioFactura) {
                try {
                    const { guardarReporte } = require('./sheets');
                    await guardarReporte({
                        edificio: edificioFactura,
                        vecino: 'Trabajo coordinado fuera del sistema',
                        problema: datosFactura?.concepto || 'Trabajo técnico resuelto y facturado',
                        urgencia: 'baja',
                        estado: 'resuelto',
                        tecnico: datosEmisor.nombre || '',
                        tipo: 'trabajo_externo',
                        telefono: from,
                        notas_ia: `Trabajo informado directamente por el técnico ${datosEmisor.nombre} al enviar la factura. No hubo reclamo previo de un vecino por este canal (lo coordinaron el encargado/administración con el técnico de forma directa).`,
                        historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBody}`])
                    });
                    console.log(`🧾 Evento retroactivo creado (trabajo externo ya resuelto) para ${edificioFactura} a partir de la factura de ${datosEmisor.nombre}.`);
                    respExtra = ` También dejé registrado el trabajo en ${edifDetectadoTexto?.direccion || edificioFactura} como resuelto, así queda el antecedente completo.`;
                } catch (e) {
                    console.error('Error creando evento retroactivo desde factura:', e.message);
                }
            } else if (!huboEventoPrevio && !edificioFactura) {
                // Sin edificio no podemos imputar el gasto a nadie: se lo pedimos al técnico.
                respExtra = ` Para poder imputarla al consorcio correcto, ¿me confirmás la dirección donde hiciste el trabajo?`;
            }

            const confirmacionesFactura = [
                `Muchas gracias ${datosEmisor.nombre}, ya recibí y archivé la documentación/factura. Queda registrada para la Administración.`,
                `Perfecto ${datosEmisor.nombre}, recibida la factura/comprobante. Ya la adjuntamos al expediente del consorcio para la Administración. ¡Gracias!`,
                `Excelente ${datosEmisor.nombre}, comprobante registrado correctamente. Que tengas un buen día.`
            ];
            const respFactura = confirmacionesFactura[Math.floor(Math.random() * confirmacionesFactura.length)] + respExtra;

            await despacharRespuesta(recipient, respFactura, msgTypeRespuesta);
            historial.push(`Marcos: ${respFactura}`);

            try {
                const { guardarReporte } = require('./sheets');
                await guardarReporte({
                    edificio: session.nombreEdificio || datosFactura?.edificio || 'Consorcio',
                    historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBody}`, `Marcos: ${respFactura}`])
                });
            } catch (e) { console.error('Error guardando chat de proveedor:', e.message); }

            return; // DETENER Y RESPONDER NATURALMENTE
        }

        // A2. CONSULTA DE ESTADO DE PAGO ("¿ya me pagaron la factura X?", "¿cuándo cobro?", etc.)
        // Es una pregunta sobre un comprobante YA ENVIADO antes -- no se confunde con "esFacturaODoc"
        // porque parecePreguntaSinAdjunto ya la excluyó de ahí arriba. Se responde con el estado
        // REAL guardado en Sheets (que el dueño/administración marca manualmente como Pagada desde
        // el dashboard), nunca inventando si se pagó o no.
        const esConsultaPago = parecePreguntaSinAdjunto && /pag|cobr|abon/i.test(txtLow);

        if (esConsultaPago) {
            const numeroMencionado = (txtLow.match(/\b\d{3,}\b/) || [])[0] || '';
            const { buscarFacturasProveedor } = require('./sheets');
            const facturasEncontradas = await buscarFacturasProveedor({
                proveedor: datosEmisor.nombre,
                edificio: session.nombreEdificio,
                numeroFactura: numeroMencionado
            });

            let respPago;
            if (facturasEncontradas.length === 0) {
                respPago = numeroMencionado
                    ? `No encuentro registrada ninguna factura N° ${numeroMencionado} a tu nombre todavía, ${datosEmisor.nombre}. Si ya la mandaste y no figura, avisame y lo reviso con la Administración.`
                    : `No tengo facturas tuyas registradas todavía para confirmarte el estado, ${datosEmisor.nombre}. Si me la mandás (foto o PDF) la registro para que la Administración la procese.`;
            } else if (facturasEncontradas.length === 1) {
                const f = facturasEncontradas[0];
                const pagada = /pagad/i.test(f.estado);
                respPago = pagada
                    ? `Sí ${datosEmisor.nombre}, la factura${f.numero_factura ? ' N° ' + f.numero_factura : ''} (${f.concepto || 'sin concepto'}, ${f.monto || 'monto s/d'}) figura *pagada* en el sistema.`
                    : `Todavía figura *pendiente de pago* la factura${f.numero_factura ? ' N° ' + f.numero_factura : ''} (${f.concepto || 'sin concepto'}, ${f.monto || 'monto s/d'}), ${datosEmisor.nombre}. En cuanto la Administración confirme el pago te aviso.`;
            } else {
                const pendientes = facturasEncontradas.filter(f => !/pagad/i.test(f.estado));
                respPago = pendientes.length > 0
                    ? `Tenés ${facturasEncontradas.length} facturas registradas, ${pendientes.length} todavía *pendientes de pago*${numeroMencionado ? '' : ' -- decime el número de comprobante puntual y te confirmo ese'}.`
                    : `Tenés ${facturasEncontradas.length} facturas registradas y todas figuran *pagadas*, ${datosEmisor.nombre}.`;
            }

            await despacharRespuesta(recipient, respPago, msgTypeRespuesta);
            historial.push(`Marcos: ${respPago}`);

            try {
                const { guardarReporte } = require('./sheets');
                await guardarReporte({
                    edificio: session.nombreEdificio,
                    historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBody}`, `Marcos: ${respPago}`])
                });
            } catch (e) { console.error('Error guardando chat de proveedor:', e.message); }

            return;
        }

        // B. MANEJO DE SOLICITUD DE DATOS/FOTOS/VIDEOS AL VECINO
        const esSolicitudDatos = /solicitar|m.s datos|mas datos|detalles|pedir|foto|imagen|video|cerradura|especifi|aclarar|ver/.test(txtLow);

        if (esSolicitudDatos) {
            const vecinoActivo = await obtenerVecinoActivoDeProveedor({
                telTech: from,
                edificioNombre: session.nombreEdificio,
                datosEmisor,
                session
            });

            const telVecino = vecinoActivo?.telefono;
            const nomVecino = (vecinoActivo?.nombre && vecinoActivo.nombre !== 'Vecino' && vecinoActivo.nombre !== 'Desconocido') ? vecinoActivo.nombre : '';
            const deptoVecino = vecinoActivo?.departamento || '';
            const edifNom = vecinoActivo?.edificio || session.nombreEdificio || 'Consorcio';

            const perfilEdifProv = await buscarPerfilEdificio(edifNom);
            const dirExacta = perfilEdifProv?.direccion || edifNom;

            const identVecinoMsg = nomVecino 
                ? `${nomVecino}${deptoVecino ? ' (Depto ' + deptoVecino + ')' : ''}` 
                : (deptoVecino ? `del Depto ${deptoVecino}` : 'del consorcio');

            const respTecnico = `Perfecto ${datosEmisor.nombre}, ya mismo me contacto con el vecino (${identVecinoMsg}) en ${dirExacta} para solicitarle la foto, video o detalles indicados y te los reenvío apenas me responda.`;

            await despacharRespuesta(recipient, respTecnico, msgTypeRespuesta);
            historial.push(`Marcos: ${respTecnico}`);

            try {
                const { guardarReporte } = require('./sheets');
                await guardarReporte({
                    edificio: edifNom,
                    historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBody}`, `Marcos: ${respTecnico}`])
                });
            } catch (e) { console.error('Error guardando chat de proveedor:', e.message); }

            if (telVecino && String(telVecino).replace(/\D/g, '') !== String(from).replace(/\D/g, '')) {
                const saludoNombre = nomVecino || 'estimado/a vecino/a';
                const msgParaVecino = `📋 *MARCOS — ATENCIÓN TÉCNICA*\n\n` +
                    `Hola ${saludoNombre}, el técnico asignado (*${datosEmisor.nombre}*) nos consulta si podrías enviarnos una foto, video o más detalles del inconveniente en ${dirExacta}${deptoVecino ? ' (Depto ' + deptoVecino + ')' : ''} para ir preparado con las herramientas correspondientes.`;
                
                await enviarWhatsApp(telVecino, msgParaVecino, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);

                if (!global.marcosSesiones) global.marcosSesiones = new Map();
                let sesVecino = global.marcosSesiones.get(telVecino);
                if (!sesVecino) {
                    sesVecino = { historial: [], fechaInicio: new Date().toLocaleString('es-AR'), ultimoMensajeTimestamp: Date.now() };
                    global.marcosSesiones.set(telVecino, sesVecino);
                }
                sesVecino.esperandoDatosVecinoParaProveedor = { telTech: from, nomTech: datosEmisor.nombre };
                console.log(`📩 Solicitud de foto/video enviada al vecino ${telVecino} (${identVecinoMsg}) a pedido del técnico ${datosEmisor.nombre}`);

                // Programar temporizador de 10 minutos si el vecino no responde
                if (!global.timersFotoVecino) global.timersFotoVecino = new Map();
                if (global.timersFotoVecino.has(telVecino)) {
                    clearTimeout(global.timersFotoVecino.get(telVecino));
                }

                const telTecnico = from;
                const nomTecnico = datosEmisor.nombre;

                const timerId = setTimeout(async () => {
                    const sesCheck = global.marcosSesiones.get(telVecino);
                    if (sesCheck && sesCheck.esperandoDatosVecinoParaProveedor) {
                        sesCheck.esperandoDatosVecinoParaProveedor = null;
                        const msgSinFoto = `⚠️ *MARCOS — ACTUALIZACIÓN DE SERVICIO*\n\n` +
                            `Hola ${nomTecnico}, transcurrieron 10 minutos y el vecino no envió fotos, videos ni más datos adicionales para ${dirExacta}.\n` +
                            `Como el inconveniente base ya fue identificado, te solicitamos por favor coordinar la visita directamente para verificar la instalación en el lugar. Agradecemos tu confirmación.`;
                        await enviarWhatsApp(telTecnico, msgSinFoto, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                        console.log(`⏰ TIMEOUT 10 MIN: Vecino ${telVecino} no envió foto/video. Avisado al técnico ${nomTecnico} para coordinar la visita.`);
                    }
                }, 10 * 60 * 1000);

                global.timersFotoVecino.set(telVecino, timerId);
            } else {
                console.warn(`⚠️ No se pudo obtener el teléfono del vecino activo para el técnico ${datosEmisor.nombre} (edificio: ${dirExacta})`);
            }
            return; // DETENER PROCESAMIENTO AQUÍ PARA NO RE-ENVIAR PLANTILLA
        }

        // C. CUALQUIER OTRO MENSAJE DEL TÉCNICO (confirmaciones tipo "Recibido/En camino",
        // quejas, preguntas puntuales, etc.) — NUNCA debe caer al flujo genérico de vecinos,
        // que le pediría nombre/departamento sin sentido a un proveedor.
        const vecinoActivoCatchAll = await obtenerVecinoActivoDeProveedor({
            telTech: from,
            edificioNombre: session.nombreEdificio,
            datosEmisor,
            session
        });
        const edifNomCatchAll = vecinoActivoCatchAll?.edificio || session.nombreEdificio || 'Consorcio';
        const perfilEdifCatchAll = await buscarPerfilEdificio(edifNomCatchAll);

        // Respuesta generada con el contexto real del caso (quién es el vecino, depto, acceso) en
        // vez de una frase enlatada fija -- así, si el técnico pregunta algo puntual ("¿Quién me
        // recibe en el edificio?", "¿a qué hora puedo pasar?", etc.), Marcos le contesta de verdad
        // en lugar de repetir siempre "Recibido, cualquier novedad avisame".
        // Si el vecino dejó un contacto alternativo para el ingreso (ej. "llamá a mi señora al
        // 11..." porque él se tiene que ir), se lo pasamos al técnico cuando pregunta cómo entrar.
        const sesVecinoAcceso = vecinoActivoCatchAll?.telefono
            ? global.marcosSesiones?.get(String(vecinoActivoCatchAll.telefono))
            : null;
        // Además de la sesión en RAM (caso actual), miramos la autorización PERSISTIDA en Sheets:
        // si este vecino ya autorizó antes a compartir su contacto, esa confianza sigue vigente
        // en los eventos siguientes y no hay que volver a pedirle permiso.
        let contactoAccesoExtra = sesVecinoAcceso?.contactoAccesoExtra || '';
        if (!contactoAccesoExtra && vecinoActivoCatchAll?.telefono) {
            try {
                const vecinosGuardados = await buscarVecinosPorTelefono(vecinoActivoCatchAll.telefono);
                const conAutorizacion = (vecinosGuardados || []).find(v => v.autorizaContacto || v.contactoAcceso);
                if (conAutorizacion?.contactoAcceso) contactoAccesoExtra = conAutorizacion.contactoAcceso;
            } catch (e) { console.error('Error leyendo autorización de contacto guardada:', e.message); }
        }

        const respGenericaProveedor = await generarRespuestaTecnicoLibre({
            mensajeTecnico: msgBody,
            nombreTecnico: datosEmisor.nombre,
            vecino: vecinoActivoCatchAll,
            edificio: edifNomCatchAll,
            perfilEdificio: perfilEdifCatchAll,
            contactoAccesoExtra
        });
        await despacharRespuesta(recipient, respGenericaProveedor, msgTypeRespuesta);
        historial.push(`Marcos: ${respGenericaProveedor}`);

        // Sentido inverso: el técnico pide que le pasen SU teléfono al vecino ("pasale mi número
        // así coordinamos directo"). Es el mismo criterio de siempre -- dato mínimo, con una
        // necesidad operativa concreta -- solo que en la otra dirección.
        const tecnicoOfreceSuTelefono = /pasal[ea]?\s*(le)?\s*mi|dale mi|mand[aá]le mi|d[aá]le mi|que me llame|puede llamarme|mi (tel|n[uú]mero|celular)/i.test(txtLow);
        if (tecnicoOfreceSuTelefono && vecinoActivoCatchAll?.telefono) {
            try {
                const telTecnicoLimpio = String(from).replace(/\D/g, '');
                const dirAvisoTel = perfilEdifCatchAll?.direccion || edifNomCatchAll;
                const avisoTelTecnico = `📞 *MARCOS — CONTACTO DEL TÉCNICO*\n\n` +
                    `${(vecinoActivoCatchAll.nombre && vecinoActivoCatchAll.nombre !== 'Vecino') ? vecinoActivoCatchAll.nombre : 'Hola'}, el técnico *${datosEmisor.nombre}* que va a atender el reclamo de ${dirAvisoTel} le deja su número para que puedan coordinar y despejar dudas directamente: *${telTecnicoLimpio}*.\n` +
                    `Cualquier cosa, yo sigo acompañando el caso por acá.`;
                await enviarWhatsApp(vecinoActivoCatchAll.telefono, avisoTelTecnico, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                console.log(`📞 Teléfono del técnico ${datosEmisor.nombre} compartido con el vecino ${vecinoActivoCatchAll.telefono} a pedido del propio técnico.`);
            } catch (e) {
                console.error('Error pasando el teléfono del técnico al vecino:', e.message);
            }
        }

        // Si el técnico avisa que ya llegó / que no le abren, no alcanza con contestarle a él:
        // hay que golpearle la puerta al vecino, que es quien tiene que bajar a abrir. Sin esto,
        // el técnico quedaba en la calle esperando mientras el vecino nunca se enteraba.
        const tecnicoEnPuerta = /llegu|llegue|estoy (aca|acá|afuera|en la puerta|abajo)|no hay nadie|no me abre|nadie (me )?abre|no sale nadie|toqu[eé] timbre/i.test(txtLow);
        if (tecnicoEnPuerta && vecinoActivoCatchAll?.telefono) {
            try {
                const dirAvisoPuerta = perfilEdifCatchAll?.direccion || edifNomCatchAll;
                const avisoPuerta = `🔔 *MARCOS — EL TÉCNICO ESTÁ EN LA PUERTA*\n\n` +
                    `${(vecinoActivoCatchAll.nombre && vecinoActivoCatchAll.nombre !== 'Vecino') ? vecinoActivoCatchAll.nombre : 'Hola'}, el técnico *${datosEmisor.nombre}* ya llegó a ${dirAvisoPuerta} y avisa que no puede ingresar.\n` +
                    `¿Podés bajar a abrirle o indicarme a quién puede llamar para que le abran? Gracias.`;
                await enviarWhatsApp(vecinoActivoCatchAll.telefono, avisoPuerta, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                console.log(`🔔 Técnico ${datosEmisor.nombre} en la puerta sin acceso: avisado el vecino ${vecinoActivoCatchAll.telefono}.`);
            } catch (e) {
                console.error('Error avisando al vecino que el técnico está en la puerta:', e.message);
            }
        }

        try {
            const { guardarReporte } = require('./sheets');
            await guardarReporte({
                edificio: edifNomCatchAll,
                historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBody}`, `Marcos: ${respGenericaProveedor}`])
            });
        } catch (e) { console.error('Error guardando chat de proveedor:', e.message); }

        return; // DETENER — un proveedor jamás debe seguir al flujo de vecinos
    }

    // Si se detectó una factura o comprobante, guardarla en el árbol permanente por Administrador / Edificio / Facturas.
    // El guardado en la pestaña "facturas" de Sheets para este camino (vecino/encargado/admin, no
    // proveedor) lo hace reportarAlAdmin() más abajo (FASE 4, marcos-admin.js) -- NO se duplica acá.
    // Solo enriquecemos datosFactura antes de que le llegue, para el caso típico de un vecino que
    // contrató SU propio electricista/plomero por fuera de la cartera de Marcos y reenvía esa
    // factura externa: si el documento no trae un emisor claro, dejamos rastro de que la trajo el
    // vecino en vez de guardarla como "Desconocido".
    if (datosFactura?.es_factura && media?.filePath) {
        const resEstFactura = guardarArchivoEstructurado({
            filePath: media.filePath,
            adminNombre: perfilEdificio?.adminNombre,
            edificioNombre: session.nombreEdificio || datosFactura.edificio,
            tipo: 'facturas'
        });
        if (resEstFactura) {
            datosFactura.url_archivo = resEstFactura.relativeUrl;
        }
        if (!datosFactura.proveedor) {
            const nomVecinoFactura = (vecino?.nombre && vecino.nombre !== 'Vecino' && vecino.nombre !== 'Desconocido') ? vecino.nombre : '';
            datosFactura.proveedor = nomVecinoFactura ? `Proveedor externo (enviado por ${nomVecinoFactura})` : 'Proveedor externo del vecino';
        }
    }

    console.log(`🧠 DECISIÓN IA: Urgencia=${decisionCaso.urgencia}, Cerrar=${decisionCaso.cerrar_caso}, Problema=${decisionCaso.tipo_problema}`);

    // Buscar técnico si el caso lo requiere (ANTES de llamar a responderVecino para informar disponibilidad real)
    let tecnicoAsignado = null;
    const edificioFinalBusqueda = session.nombreEdificio || vecino?.edificio;
    if (decisionCaso.contactar_tecnico && edificioFinalBusqueda && decisionCaso.tipo_problema) {
        tecnicoAsignado = await buscarTecnicoAsignado({
            edificio:     edificioFinalBusqueda,
            especialidad: decisionCaso.tipo_problema,
            esUrgente:    decisionCaso.urgencia === 'alta',
        });
        if (tecnicoAsignado) {
            console.log(`🔧 Técnico encontrado previamente: ${tecnicoAsignado.nombre} (${tecnicoAsignado.telefono})`);
        } else {
            console.warn(`⚠️ No se encontró técnico disponible en Sheets para especialidad '${decisionCaso.tipo_problema}' en '${edificioFinalBusqueda}'`);
        }
    }

    // Si el vecino deja otro teléfono para que le abran al técnico ("pasale el de mi señora,
    // 11...", "llamá al 11... que te abre"), lo guardamos en la sesión para poder dárselo al
    // técnico cuando pregunte cómo entrar. Antes Marcos decía "se lo paso al técnico" y no lo
    // pasaba a ningún lado -- el dato se perdía y el técnico quedaba sin forma de contactar.
    // Una ficha de contacto compartida por el vecino es la señal más explícita de todas:
    // literalmente está diciendo "hablá con esta persona". Se guarda como contacto de acceso.
    if (datosEmisor.rol !== 'proveedor' && Array.isArray(contactosCompartidos) && contactosCompartidos.length > 0) {
        const ctoAcceso = contactosCompartidos[0];
        session.contactoAccesoExtra = `${ctoAcceso.nombre} (${ctoAcceso.telefono})`;
        console.log(`📞 Contacto de acceso guardado desde ficha compartida: ${session.contactoAccesoExtra}`);
        try {
            const { guardarAutorizacionContacto } = require('./sheets');
            await guardarAutorizacionContacto({ telefono: from, autoriza: true, contactoAcceso: session.contactoAccesoExtra });
        } catch (e) { console.error('Error persistiendo autorización de contacto:', e.message); }
    }

    if (datosEmisor.rol !== 'proveedor' && /pasal|pásal|pasale|llam[aá]|tel[eé]fono|celular|n[uú]mero/i.test(textoFinal || '')) {
        const telsMencionados = String(textoFinal || '').match(/\b\d{8,}\b/g) || [];
        const telPropio = String(from || '').replace(/\D/g, '');
        const telOtro = telsMencionados
            .map(t => t.replace(/\D/g, ''))
            .find(t => t.length >= 8 && !telPropio.endsWith(t) && !t.endsWith(telPropio.slice(-8)));
        if (telOtro) {
            session.contactoAccesoExtra = telOtro;
            console.log(`📞 Contacto alternativo de acceso guardado para el caso: ${telOtro}`);
            try {
                const { guardarAutorizacionContacto } = require('./sheets');
                await guardarAutorizacionContacto({ telefono: from, autoriza: true, contactoAcceso: telOtro });
            } catch (e) { console.error('Error persistiendo autorización de contacto:', e.message); }
        }
    }

    // ── FASE 3: RESPUESTA (Marcos-Cara) ───────────────────────────────────────────

    const resCara = await responderVecino({
        historial,
        vecino,
        memoriaVecino,
        personalDeTurno,
        decisionCaso,
        tecnicoAsignado,
        perfilEdificio,
        media,
        opcionesEdificio: null,
        edificioPendiente: null,
        edificiosConocidos: edificiosConocidos,
        session,
        datosEmisor
    });

    let respuesta = (typeof resCara === 'object' && resCara !== null && resCara.texto)
        ? String(resCara.texto)
        : String(resCara || '');

    // Filtro de seguridad: eliminar rastro de "opciones" si la IA se desvía
    respuesta = respuesta.replace(/Opción \d:?/gi, '')
                         .replace(/Aquí tienes algunas opciones:?/gi, '')
                         .replace(/Podemos hacer lo siguiente:?/gi, '')
                         .replace(/\n+/g, ' ')
                         .trim();

    await despacharRespuesta(recipient, respuesta, msgTypeRespuesta);

    // Guardar respuesta en historial de sesión
    historial.push(`Marcos: ${respuesta}`);

    // ── FASE MODO ADMINISTRADOR (AC) — COMANDOS EJECUTIVOS ───────────────────
    if (datosEmisor.rol === 'admin') {
        const txtLow = (msgBody || '').toLowerCase();

        // 1. REITERAR LLAMADO A TÉCNICO / INSISTIR
        if (/reitera|re-notifica|volve a llamar|volvé a llamar|insist|avisa.*t.cnico|recordar.*t.cnico/.test(txtLow)) {
            const edificioBuscado = session.nombreEdificio || 'san patricio casa';
            const tecnico = await buscarTecnicoAsignado({ edificio: edificioBuscado, especialidad: 'electricidad' });
            if (tecnico) {
                console.log(`🔁 Re-notificando a técnico ${tecnico.nombre} por orden del Administrador ${datosEmisor.nombre}...`);
                await ejecutarEnvioNotificacionTecnico({
                    vecino: { edificio: edificioBuscado },
                    decisionCaso: { resumen_problema: 'Reiteración de atención técnica solicitada por Administración', urgencia: 'alta' },
                    tecnicoAsignado: tecnico,
                    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                    accessToken: WHATSAPP_ACCESS_TOKEN
                });
                await enviarWhatsApp(recipient, `✅ Entendido ${datosEmisor.nombre}. Se ha re-notificado con urgencia al técnico asignado (${tecnico.nombre}) para ${edificioBuscado}.`, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            }
        }

        // 2. CERRAR / RESOLVER CASO
        if (/cerr. |marc.*resuelto|resuelv|finaliz/.test(txtLow)) {
            const resCierre = await marcarCasoResueltoPorAdmin(txtLow);
            if (resCierre) {
                await enviarWhatsApp(recipient, `✅ A su orden ${datosEmisor.nombre}. El caso de ${resCierre} fue marcado como RESUELTO en Sheets y Dashboard.`, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            }
        }

        // 3. CONSULTAR EVENTOS PENDIENTES / RESUMEN
        if (/casos.*abierto|eventos.*pendiente|resumen|pendientes/.test(txtLow)) {
            const pendientes = await obtenerEventosPendientesAdmin();
            if (pendientes.length === 0) {
                await enviarWhatsApp(recipient, `📋 *MARCOS IA — ADMINISTRACIÓN*\n\nExcelente noticia ${datosEmisor.nombre}: No hay eventos pendientes ni reclamos abiertos en el sistema en este momento.`, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            } else {
                let msgList = `📋 *MARCOS IA — RESUMEN DE EVENTOS ABIERTOS*\n\n`;
                pendientes.forEach((p, idx) => {
                    msgList += `${idx + 1}. *${p.edificio}* (Depto ${p.depto || '—'})\n   • Reclamo: ${p.problema}\n   • Urgencia: ${(p.urgencia || 'media').toUpperCase()}\n\n`;
                });
                await enviarWhatsApp(recipient, msgList, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            }
        }

        // 4. REENVIAR DOCUMENTO / EXPENSA A UN VECINO
        if (mediaId && (msgType === 'document' || msgType === 'image')) {
            const { buscarVecinosPorTelefono } = require('./sheets');
            const vecinosCoincidentes = await buscarVecinosPorTelefono('');
            if (vecinosCoincidentes && vecinosCoincidentes.length > 0) {
                const primerVecino = vecinosCoincidentes[0];
                const msgVecino = `📄 *MARCOS — DOCUMENTO DE LA ADMINISTRACIÓN*\n\n` +
                    `Hola ${primerVecino.nombre}, le adjuntamos el documento/expensa correspondiente a ${primerVecino.edificio} enviado por la Administración.`;
                
                const uploadMediaId = await subirMediaWhatsApp(media.filePath, media.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                if (uploadMediaId) {
                    await enviarDocumentoWhatsApp(primerVecino.telefono, uploadMediaId, path.basename(media.filePath), msgVecino, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                    await enviarWhatsApp(recipient, `✅ Documento (${path.basename(media.filePath)}) re-enviado con éxito por WhatsApp al vecino ${primerVecino.nombre} (${primerVecino.edificio}).`, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                }
            }
        }
    }

    // Si el emisor es proveedor y confirma horario/asistencia, procesar siguiente en cola si aplica
    if (datosEmisor.rol === 'proveedor') {
        const txtLow = (msgBody || '').toLowerCase();
        if (/paso|lleg|voy|confirm|listo|no puedo|horario|mañana|tarde|hs|hs\.|hora/.test(txtLow)) {
            console.log(`✅ Coordinación de evento finalizada por proveedor ${datosEmisor.nombre}. Verificando eventos pendientes en cola...`);
            setTimeout(() => {
                procesarSiguienteEventoProveedor(from, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            }, 4000);
        }
    }

    // Si el emisor no es proveedor y teníamos una solicitud de datos del proveedor pendiente, reenviar la respuesta al técnico
    if (datosEmisor.rol !== 'proveedor' && session.esperandoDatosVecinoParaProveedor) {
        const infoEspera = typeof session.esperandoDatosVecinoParaProveedor === 'object' 
            ? session.esperandoDatosVecinoParaProveedor 
            : { telTech: session.esperandoDatosVecinoParaProveedor, nomTech: 'el técnico' };
        
        const telTech = infoEspera.telTech;
        const nomTech = infoEspera.nomTech || 'el técnico';

        const nomVecinoDisp = (vecino.nombre && vecino.nombre !== 'Vecino' && vecino.nombre !== 'Desconocido') ? vecino.nombre : 'El vecino';
        const deptoDisp = vecino.departamento ? ` (Depto ${vecino.departamento})` : '';
        const edifDisp = session.nombreEdificio || 'el edificio';

        // Reenviar Imagen si el vecino mandó foto
        if (msgType === 'image' && media) {
            const uploadMediaId = await subirMediaWhatsApp(media.filePath, media.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            if (uploadMediaId) {
                const { enviarImagenWhatsApp } = require('./agentes/marcos-ops');
                const captionProv = `📱 *MARCOS — FOTO ENVIADA POR EL VECINO*\n\nHola ${nomTech}, ${nomVecinoDisp}${deptoDisp} en ${edifDisp} envió esta foto para la visita.` + (textoFinal && textoFinal !== '(Imagen adjunta)' ? `\n\nComentario del vecino: "${textoFinal}"` : '');
                await enviarImagenWhatsApp(telTech, uploadMediaId, captionProv, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                console.log(`🖼️ Foto del vecino reenviada exitosamente al técnico ${telTech}`);
            }
        } 
        // Reenviar Video si el vecino mandó video
        else if (msgType === 'video' && media) {
            const uploadMediaId = await subirMediaWhatsApp(media.filePath, media.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            if (uploadMediaId) {
                const { enviarVideoWhatsApp } = require('./agentes/marcos-ops');
                const captionProv = `📱 *MARCOS — VIDEO ENVIADO POR EL VECINO*\n\nHola ${nomTech}, ${nomVecinoDisp}${deptoDisp} en ${edifDisp} envió este video para la visita.` + (textoFinal && textoFinal !== '(Video adjunto)' ? `\n\nComentario del vecino: "${textoFinal}"` : '');
                await enviarVideoWhatsApp(telTech, uploadMediaId, captionProv, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                console.log(`🎥 Video del vecino reenviado exitosamente al técnico ${telTech}`);
            }
        } 
        // Reenviar Texto / Audio transcrito
        else {
            const infoReenvio = `📱 *MARCOS — NOVEDAD DEL VECINO*\n\n` +
                `Hola ${nomTech}, ${nomVecinoDisp}${deptoDisp} en ${edifDisp} envió la siguiente información para tu visita:\n\n${messageText}`;
            await enviarWhatsApp(telTech, infoReenvio, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            console.log(`➡️ Novedad/texto del vecino reenviada al técnico ${telTech}`);
        }

        // Solo dejamos de esperar más datos una vez que efectivamente llegó la foto/video
        // pedido. Si el vecino responde primero con texto (ej. "ya te mandé, no la ves?"),
        // seguimos esperando por si la foto llega en un mensaje/ráfaga aparte -- antes se
        // borraba la bandera con la primera respuesta fuera cual fuera, y una foto que
        // llegaba después ya no se reenviaba por este camino (se perdía para el técnico).
        const llegoLoPedido = (msgType === 'image' || msgType === 'video') && media;

        if (llegoLoPedido) {
            // Cancelar temporizador de 10 min si existía
            if (global.timersFotoVecino && global.timersFotoVecino.has(from)) {
                clearTimeout(global.timersFotoVecino.get(from));
                global.timersFotoVecino.delete(from);
            }
            delete session.esperandoDatosVecinoParaProveedor;

            const respAgr = `Muchas gracias ${nomVecinoDisp}, ya le reenvié esa información/multimedia al técnico ${nomTech} para que lo evalúe y pueda coordinar la asistencia.`;
            await despacharRespuesta(recipient, respAgr, msgTypeRespuesta);
            historial.push(`Marcos: ${respAgr}`);
        } else {
            const respAgr = `Gracias ${nomVecinoDisp}, ya le pasé eso al técnico ${nomTech}. Si podés mandarme también la foto/video que te pidió, se la reenvío enseguida.`;
            await despacharRespuesta(recipient, respAgr, msgTypeRespuesta);
            historial.push(`Marcos: ${respAgr}`);
        }
        return; // Finalizar ciclo de respuesta al vecino
    }

    // ── FASE 4: OPERACIONES INTERNAS (en paralelo, no bloquean al vecino) ───

    // Si no tenemos depto registrado para el vecino, intentar extraerlo ahora del historial
    if (session.nombreEdificio && (!session.datosVecino || !session.datosVecino.departamento)) {
        const extraido = await extraerDatosVecinoNuevo(historial);
        if (extraido.departamento || extraido.nombre) {
            const nuevoVecino = {
                telefono:     from,
                nombre:       extraido.nombre || session.datosVecino?.nombre || session.pushName || 'Vecino',
                edificio:     session.nombreEdificio,
                departamento: extraido.departamento || session.datosVecino?.departamento || '',
            };
            session.datosVecino = nuevoVecino;
            vecino.departamento = nuevoVecino.departamento;
            if (extraido.nombre) vecino.nombre = extraido.nombre;
            await agregarVecinoNuevo(nuevoVecino);
        }
    }

    // 1. Marcos-Admin: reporta y guarda en Sheets primero para obtener el id_evento (CASO-XXXX)
    let resAdmin = null;
    if (
        session.nombreEdificio ||
        decisionCaso.cerrar_caso || 
        decisionCaso.urgencia === 'alta' || 
        decisionCaso.contactar_tecnico || 
        decisionCaso.resumen_problema ||
        datosFactura?.es_factura
    ) {
        console.log('📝 Ejecutando reportarAlAdmin...');
        try {
            resAdmin = await reportarAlAdmin({
                vecino: { ...vecino, telefono: from, depto: session.datosVecino?.departamento || vecino?.departamento || '' },
                decisionCaso,
                tecnicoAsignado,
                datosFactura,
                phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                accessToken:   WHATSAPP_ACCESS_TOKEN,
                fechaInicio:   session.fechaInicio,
                audio_url:     session.audio_url || '',
                transcripcion: session.transcripcion || '',
                historial_chat: session.historial || []
            });
        } catch (errAdmin) {
            // No dejamos que un error guardando el reporte (Sheets/email) tumbe el resto del flujo:
            // el técnico tiene que ser notificado igual aunque falle el registro administrativo.
            console.error('⚠️ Error en reportarAlAdmin (no bloquea notificación a técnico/encargado):', errAdmin.message);
        }
    }

    const idEventoAsignado = resAdmin?.id_evento || null;

    // El [CASO-XXXX] recién existe ahora, pero los mensajes que lo originaron ya se registraron
    // sin código (cuando el vecino escribió, el caso todavía no estaba creado). Los enganchamos
    // hacia atrás para que el visor muestre la conversación desde el primer mensaje, y dejamos el
    // código en la sesión para que el resto del chat quede etiquetado de una.
    if (idEventoAsignado) {
        session.idEventoActual = idEventoAsignado;
        try {
            const { asignarEventoAMensajes } = require('./db-pg');
            asignarEventoAMensajes({ telefono: from, eventoId: idEventoAsignado })
                .then(n => { if (n) console.log(`🗂️ ${n} mensaje(s) del chat asociados a ${idEventoAsignado}`); })
                .catch(err => console.error('Error asociando mensajes al caso:', err.message));
        } catch (err) {
            console.error('Error asociando mensajes al caso:', err.message);
        }
    }

    // 2. Marcos-Ops: contacta técnico y encargado incluyendo el id_evento (CASO-XXXX)
    if (decisionCaso.contactar_tecnico || decisionCaso.contactar_encargado) {
        try {
            await gestionarOperaciones({
                vecino,
                decisionCaso,
                tecnicoAsignado,
                personalDeTurno,
                phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                accessToken:   WHATSAPP_ACCESS_TOKEN,
                id_evento:     idEventoAsignado
            });
        } catch (errOps) {
            console.error('⚠️ Error en gestionarOperaciones (notificación a técnico/encargado):', errOps.message);
        }
    }

    // 2b. Reenvío automático de foto/video al técnico asignado del caso, aunque NO la haya
    // pedido explícitamente ni este mensaje puntual haya disparado un nuevo contacto con él.
    // Sin esto, una foto que el vecino manda espontáneamente (junto al reclamo inicial, o en
    // cualquier mensaje posterior de un caso ya abierto) queda guardada en el servidor pero el
    // técnico nunca la ve por WhatsApp -- solo se enteraba si él mismo la pedía primero
    // (branch de esperandoDatosVecinoParaProveedor, más arriba en el flujo).
    if ((msgType === 'image' || msgType === 'video') && media?.filePath) {
        try {
            let tecnicoParaFoto = tecnicoAsignado;
            const edifParaFoto = session.nombreEdificio || vecino?.edificio;
            if (!tecnicoParaFoto?.telefono && edifParaFoto && decisionCaso.tipo_problema) {
                tecnicoParaFoto = await buscarTecnicoAsignado({
                    edificio: edifParaFoto,
                    especialidad: decisionCaso.tipo_problema,
                    esUrgente: decisionCaso.urgencia === 'alta',
                });
            }

            if (tecnicoParaFoto?.telefono) {
                const nomVecinoAuto = (vecino?.nombre && vecino.nombre !== 'Vecino' && vecino.nombre !== 'Desconocido') ? vecino.nombre : 'El vecino';
                const deptoAuto = vecino?.departamento ? ` (Depto ${vecino.departamento})` : '';
                const edifAuto = edifParaFoto || 'el edificio';
                const uploadMediaIdAuto = await subirMediaWhatsApp(media.filePath, media.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                if (uploadMediaIdAuto) {
                    const comentarioAuto = (textoFinal && !/^\(Imagen adjunta\)$|^\(Video adjunto\)$/i.test(textoFinal.trim())) ? `\n\nComentario del vecino: "${textoFinal}"` : '';
                    if (msgType === 'image') {
                        const { enviarImagenWhatsApp } = require('./agentes/marcos-ops');
                        const captionAuto = `📱 *MARCOS — FOTO DEL RECLAMO*\n\nHola ${tecnicoParaFoto.nombre}, ${nomVecinoAuto}${deptoAuto} en ${edifAuto} adjuntó esta foto del inconveniente.${comentarioAuto}`;
                        await enviarImagenWhatsApp(tecnicoParaFoto.telefono, uploadMediaIdAuto, captionAuto, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                    } else {
                        const { enviarVideoWhatsApp } = require('./agentes/marcos-ops');
                        const captionAuto = `📱 *MARCOS — VIDEO DEL RECLAMO*\n\nHola ${tecnicoParaFoto.nombre}, ${nomVecinoAuto}${deptoAuto} en ${edifAuto} adjuntó este video del inconveniente.${comentarioAuto}`;
                        await enviarVideoWhatsApp(tecnicoParaFoto.telefono, uploadMediaIdAuto, captionAuto, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                    }
                    console.log(`📷 Foto/video del vecino reenviado automáticamente al técnico ${tecnicoParaFoto.nombre} (sin que lo pidiera explícitamente).`);
                }
            }
        } catch (errFotoAuto) {
            console.error('⚠️ Error reenviando foto/video automáticamente al técnico:', errFotoAuto.message);
        }
    }

    // 2c. Si el vecino dejó un contacto de acceso (ficha compartida o teléfono dictado), el técnico
    // asignado tiene que RECIBIRLO de una, junto con la notificación del caso -- no solo si se le
    // ocurre preguntar. Es el dato que evita que llegue y se quede sin poder entrar.
    if (session.contactoAccesoExtra && !session.contactoAccesoAvisadoATecnico) {
        try {
            let tecnicoParaContacto = tecnicoAsignado;
            const edifParaContacto = session.nombreEdificio || vecino?.edificio;
            if (!tecnicoParaContacto?.telefono && edifParaContacto && decisionCaso.tipo_problema) {
                tecnicoParaContacto = await buscarTecnicoAsignado({
                    edificio: edifParaContacto,
                    especialidad: decisionCaso.tipo_problema,
                    esUrgente: decisionCaso.urgencia === 'alta',
                });
            }

            if (tecnicoParaContacto?.telefono) {
                const dirContacto = perfilEdificio?.direccion || edifParaContacto || 'el edificio';
                const msgContactoAcceso = `📞 *MARCOS — CONTACTO PARA EL INGRESO*\n\n` +
                    `Hola ${tecnicoParaContacto.nombre}, para la visita en ${dirContacto} el vecino dejó este contacto para que le abran: *${session.contactoAccesoExtra}*.\n` +
                    `Si al llegar no te abren, comunicate directamente con esa persona y avisame cualquier inconveniente.`;
                await enviarWhatsApp(tecnicoParaContacto.telefono, msgContactoAcceso, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                session.contactoAccesoAvisadoATecnico = true;
                console.log(`📞 Contacto de acceso (${session.contactoAccesoExtra}) enviado proactivamente al técnico ${tecnicoParaContacto.nombre}.`);
            }
        } catch (errCtoAcceso) {
            console.error('⚠️ Error enviando el contacto de acceso al técnico:', errCtoAcceso.message);
        }
    }

    // ── FASE 5: REGISTRAR VECINO NUEVO ──────────────────────────────────────
    if (!session.datosVecino && session.nombreEdificio) {
        console.log(`👤 Registrando vecino nuevo automáticamente...`);
        const extraido = await extraerDatosVecinoNuevo(historial);
        const nombreParaRegistrar = extraido.nombre || session.pushName || 'Vecino';
        const nuevoVecino = {
            telefono:    from,
            nombre:      nombreParaRegistrar,
            edificio:    session.nombreEdificio,
            departamento: extraido.departamento || '',
        };
        session.datosVecino = nuevoVecino; // Guardar en RAM para el resto de la sesión
        await agregarVecinoNuevo(nuevoVecino);
    }

    console.log(`✅ Mensaje procesado para ${recipient} | Urgencia: ${decisionCaso.urgencia} | Cierre: ${decisionCaso.cerrar_caso}`);
}

// ── Utilidad: Respuesta libre a un técnico/proveedor, con contexto real del caso ────────────
// Se usa para cualquier mensaje del técnico que no sea "pide foto/datos" ni "manda factura"
// (confirmaciones, preguntas puntuales como "¿quién me recibe?", quejas, etc.), para que Marcos
// conteste lo que realmente le preguntaron en vez de una frase enlatada fija.
async function generarRespuestaTecnicoLibre({ mensajeTecnico, nombreTecnico, vecino, edificio, perfilEdificio, contactoAccesoExtra = '' }) {
    try {
        const nomVecino = (vecino?.nombre && vecino.nombre !== 'Vecino' && vecino.nombre !== 'Desconocido') ? vecino.nombre : '';
        const identVecino = nomVecino
            ? `${nomVecino}${vecino?.departamento ? ' (Depto ' + vecino.departamento + ')' : ''}`
            : (vecino?.departamento ? `el vecino del Depto ${vecino.departamento}` : 'el vecino que hizo el reclamo (todavía sin datos de contacto claros)');
        const direccion = perfilEdificio?.direccion || edificio || 'el edificio';
        // Teléfonos que el técnico SÍ puede usar para entrar: el del vecino que hizo el reclamo, y
        // cualquier contacto adicional que el propio vecino haya autorizado (ej. "llamá a mi señora
        // al 11...", cuando avisa que él no va a estar).
        const telVecinoAcceso = vecino?.telefono ? String(vecino.telefono).replace(/\D/g, '') : '';
        const telefonosAcceso = [
            telVecinoAcceso ? `${identVecino}: ${telVecinoAcceso}` : '',
            contactoAccesoExtra ? `Contacto adicional autorizado por el vecino: ${contactoAccesoExtra}` : '',
            perfilEdificio?.tel_seguridad ? `Portería/seguridad de la entrada: ${perfilEdificio.tel_seguridad}` : ''
        ].filter(Boolean).join(' | ') || 'Sin teléfono de contacto cargado todavía.';
        const accesoInfo = perfilEdificio?.tel_seguridad
            ? `Hay portería/seguridad en la entrada (tel: ${perfilEdificio.tel_seguridad}).`
            : `El acceso ya fue coordinado por Marcos con ${identVecino}, que lo está esperando.`;

        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `Sos Marcos, representante de la Administración de consorcios, escribiendo por WhatsApp a un TÉCNICO/PROVEEDOR (no a un vecino) que está atendiendo un reclamo.

El técnico ${nombreTecnico} te escribió: "${mensajeTecnico}"

Datos reales del caso que tenés disponibles:
- Vecino/solicitante: ${identVecino}
- Dirección: ${direccion}
- Acceso: ${accesoInfo}
- Teléfonos de contacto para el ingreso: ${telefonosAcceso}

Instrucciones:
- Respondé de forma breve (1-2 oraciones), profesional, en "usted".
- Si te pregunta algo puntual (quién lo recibe, dirección, acceso, horario, etc.), contestale con el dato real de arriba. No inventes datos que no tenés: si no sabés algo puntual que pide, decile que lo estás confirmando y le respondés en breve.
- 🚨 SI EL TÉCNICO YA ESTÁ EN LA PUERTA, DICE QUE LLEGÓ, QUE NO HAY NADIE, QUE NO LE ABREN, O TE PIDE EL TELÉFONO DEL VECINO: DALE EL NÚMERO DE CONTACTO DE ARRIBA INMEDIATAMENTE, en ese mismo mensaje. Es una urgencia operativa: tiene que poder entrar. TENÉS TERMINANTEMENTE PROHIBIDO responderle "no es necesario que lo llame", "ya está coordinado" o cualquier variante que le niegue el teléfono -- eso lo deja parado en la calle sin poder trabajar. Si no tenés ningún teléfono cargado, decíselo con honestidad y avisale que estás contactando al vecino ahora mismo.
- NUNCA repitas la misma respuesta que ya diste antes. Si el técnico insiste con un pedido, es porque tu respuesta anterior no le sirvió: cambiá de enfoque y resolvé el problema concreto que tiene.
- Si te pregunta CÓMO o A QUIÉN entregar una factura/comprobante de pago (sin adjuntarla todavía, solo preguntando el procedimiento): decile que te la puede mandar directo por acá (foto o PDF) y vos la registrás para que la Administración la procese. NO le digas "ya recibí la factura" -- todavía no mandó nada, solo está preguntando.
- NUNCA le pidas nombre/departamento al técnico -- eso es del vecino, no de él.
- No saludes ni te vuelvas a presentar (ya es una conversación en curso).
- Devolvé ÚNICAMENTE el texto de la respuesta, sin comillas ni formato adicional.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: prompt }],
            config: { temperature: 0.3 },
        });

        const texto = (response.text || '').trim();
        return texto || `Recibido, ${nombreTecnico}. Cualquier novedad o si necesitás algo más para la visita, escribime por acá.`;
    } catch (e) {
        console.error('Error generando respuesta libre a técnico:', e.message);
        return `Recibido, ${nombreTecnico}. Cualquier novedad o si necesitás algo más para la visita, escribime por acá.`;
    }
}

// ── Utilidad: Extrae nombre y depto del historial usando IA ─────────────────
async function extraerDatosVecinoNuevo(historial) {
    try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `Analizá el siguiente historial de chat de un vecino reportando un problema en su edificio.
Tu objetivo es extraer el nombre del vecino y su número de departamento si los mencionó.

Historial:
${historial.join('\n')}

Devolvé ÚNICAMENTE un JSON válido con este formato exacto:
{"nombre": "nombre o vacío", "departamento": "depto o vacío"}
No incluyas markdown ni texto adicional.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: prompt }],
            config: { temperature: 0 },
        });

        const texto = response.text.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(texto);
    } catch (e) {
        console.error('Error extrayendo datos del vecino:', e.message);
        return { nombre: '', departamento: '' };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT DE VAPI — Llamadas telefónicas
// Vapi llama a este endpoint en cada turno de la conversación.
// Devuelve la respuesta de Marcos en texto plano para que Vapi lo convierta
// a voz con ElevenLabs.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/vapi', async (req, res) => {
    try {
        const body = req.body;

        // Vapi envía el historial completo en cada turno
        const mensajes = body?.message?.artifact?.messages || body?.messages || [];
        // Extraer número o Call ID
        const callId   = body?.message?.call?.id || body?.call?.id || 'unknown';
        let from       = body?.message?.call?.customer?.number || body?.call?.customer?.number || callId;

        // Si "from" es un UUID (llamada de prueba web), forzamos tu número de test
        // para que Marcos te reconozca en la planilla y puedas probar bien.
        if (from.length > 20 || from.includes('-')) {
            from = '54111550542005'; // Tu número de test de WhatsApp
            console.log(`📞 [Test Web Vapi] Número simulado a: ${from}`);
        }

        console.log(`📞 Llamada Vapi de ${from} | Call ID: ${callId}`);

        // Extraer el último mensaje del vecino
        const ultimoMensajeUsuario = [...mensajes]
            .reverse()
            .find(m => m.role === 'user');

        if (!ultimoMensajeUsuario) {
            return res.json({ response: 'Bien Argentinos, buenas.' });
        }

        const textoVecino = ultimoMensajeUsuario.content || '';

        // ── Sesión de la llamada (por callId para no mezclar con WhatsApp) ──
        const sessionKey = `vapi_${callId}`;
        if (!sesiones.has(sessionKey)) sesiones.set(sessionKey, { historial: [] });
        const session  = sesiones.get(sessionKey);
        const historial = session.historial;

        // Reconstruir historial desde los mensajes de Vapi
        // (Vapi manda el historial completo en cada turno)
        session.historial = mensajes
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => m.role === 'user' ? `Vecino: ${m.content}` : `Marcos: ${m.content}`);

        session.historial.push(`Vecino: ${textoVecino}`);

        // ── Identificación del vecino por número de teléfono ──
        const [vecinosEnSheets, memoriaVecino, edificiosConocidos] = await Promise.all([
            buscarVecinosPorTelefono(from),
            buscarMemoriaVecino(from),
            listarEdificiosConocidos(),
        ]);

        let vecino = null;
        if (vecinosEnSheets.length === 1) {
            vecino = vecinosEnSheets[0];
            session.nombreEdificio = vecino.edificio;
        } else if (vecinosEnSheets.length > 1) {
            const msgLower = textoVecino.toLowerCase();
            const mencionado = vecinosEnSheets.find(v =>
                msgLower.includes(v.edificio.toLowerCase().split(' ')[0])
            );
            vecino = mencionado || vecinosEnSheets[0];
            session.nombreEdificio = vecino.edificio;
        }

        // ── Datos del edificio ──
        let perfilEdificio  = null;
        let personalDeTurno = null;
        if (session.nombreEdificio) {
            [perfilEdificio, personalDeTurno] = await Promise.all([
                buscarPerfilEdificio(session.nombreEdificio),
                buscarPersonalDeTurno({ edificio: session.nombreEdificio }),
            ]);
        }

        // ── Evaluación del caso ──
        const decisionCaso = await evaluarCaso({
            historial: session.historial,
            vecino,
            perfilEdificio,
            memoriaVecino,
        });

        // ── Respuesta de Marcos-Cara ──
        let respuesta = await responderVecino({
            historial: session.historial,
            vecino,
            memoriaVecino,
            personalDeTurno,
            decisionCaso,
            perfilEdificio,
            media: null,
            opcionesEdificio: vecinosEnSheets.length > 1
                ? vecinosEnSheets.map(v => v.edificio)
                : null,
            edificioPendiente: null,
            edificiosConocidos: edificiosConocidos
        });

        // Filtro anti-listas (igual que en WhatsApp)
        respuesta = respuesta
            .replace(/Opción \d:?/gi, '')
            .replace(/Aquí tienes algunas opciones:?/gi, '')
            .replace(/Podemos hacer lo siguiente:?/gi, '')
            .replace(/\n+/g, ' ')
            .trim();

        console.log(`📞 Marcos responde llamada: "${respuesta}"`);

        // ── Operaciones internas en paralelo (no bloquean la respuesta) ──
        let tecnicoAsignado = null;
        if (decisionCaso.contactar_tecnico && session.nombreEdificio && decisionCaso.tipo_problema) {
            tecnicoAsignado = await buscarTecnicoAsignado({
                edificio:     session.nombreEdificio,
                especialidad: decisionCaso.tipo_problema,
                esUrgente:    decisionCaso.urgencia === 'alta',
            });
        }

        // Estrategia de ahorro: Si el caso requiere acción, mandamos un WhatsApp de seguimiento 
        // para transicionar al vecino del teléfono (costoso) al chat (gratis).
        let promesaWhatsapp = Promise.resolve();
        if ((decisionCaso.cerrar_caso || decisionCaso.contactar_tecnico || decisionCaso.contactar_encargado) && !session.whatsapp_seguimiento_enviado) {
            session.whatsapp_seguimiento_enviado = true;
            
            const msjSeguimiento = `¡Hola! Hablamos recién por teléfono 📞.\nYa me estoy encargando de gestionar lo que me comentaste.\n\nCualquier novedad con el técnico te la voy a avisar por acá, así te queda registrado. Acordate que podés seguir escribiéndome o mandándome audios por este chat para cualquier consulta en el futuro, así no tenés que gastar en llamados. ¡Saludos! - *Marcos*`;
            
            const { enviarWhatsApp } = require('./agentes/marcos-ops');
            promesaWhatsapp = enviarWhatsApp(
                from === '54111550542005' ? from : body?.message?.call?.customer?.number || from, // Asegurar que manda al real si no es test web
                msjSeguimiento, 
                process.env.WHATSAPP_PHONE_NUMBER_ID, 
                process.env.WHATSAPP_ACCESS_TOKEN
            );
        }

        // Ejecutar operaciones sin esperar (no agregan latencia a la llamada)
        Promise.all([
            (decisionCaso.contactar_tecnico || decisionCaso.contactar_encargado)
                ? gestionarOperaciones({
                    vecino,
                    decisionCaso,
                    tecnicoAsignado,
                    personalDeTurno,
                    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                    accessToken:   WHATSAPP_ACCESS_TOKEN,
                })
                : Promise.resolve(),

            (decisionCaso.cerrar_caso || decisionCaso.urgencia === 'alta' || decisionCaso.contactar_tecnico)
                ? reportarAlAdmin({
                    vecino: { ...(vecino || {}), telefono: from, edificio: session.nombreEdificio },
                    decisionCaso,
                    tecnicoAsignado,
                    datosFactura: null,
                    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                    accessToken:   WHATSAPP_ACCESS_TOKEN,
                })
                : Promise.resolve(),
                
            promesaWhatsapp
        ]).catch(err => console.error('Error en operaciones Vapi:', err.message));

        // Vapi espera la respuesta en formato OpenAI-compatible para Custom LLM
        res.json({
            choices: [
                {
                    message: {
                        role: "assistant",
                        content: respuesta
                    }
                }
            ]
        });

    } catch (err) {
        console.error('Error en endpoint Vapi:', err.message);
        res.json({
            choices: [
                {
                    message: {
                        role: "assistant",
                        content: 'Perdón, se escuchó cortado. ¿Me repite eso último, por favor?'
                    }
                }
            ]
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT VAPI — Fin de llamada
// Vapi llama a este endpoint cuando la llamada termina.
// Guarda la transcripción, genera el mensaje post-llamada y lo envía por WA.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/vapi/llamada-finalizada', async (req, res) => {
    res.sendStatus(200); // Responder rápido a Vapi

    try {
        const body     = req.body;
        const tipo     = body?.message?.type || body?.type || '';

        // Vapi manda varios eventos — solo nos interesa "end-of-call-report"
        if (tipo !== 'end-of-call-report') return;

        const call         = body?.message?.call        || body?.call        || {};
        const artifact     = body?.message?.artifact    || body?.artifact    || {};
        const analysis     = body?.message?.analysis    || body?.analysis    || {};

        const callId       = call?.id             || 'unknown';
        const from         = call?.customer?.number || '';
        const duracionSeg  = Math.round((call?.endedAt
            ? (new Date(call.endedAt) - new Date(call.startedAt)) / 1000
            : 0));
        const duracion     = duracionSeg > 0
            ? `${Math.floor(duracionSeg / 60)}m ${duracionSeg % 60}s`
            : 'N/D';

        // Transcripción completa del diálogo
        const mensajes     = artifact?.messages || [];
        const transcripcion = mensajes
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => `${m.role === 'user' ? '👤 Vecino' : '🤖 Marcos'}: ${m.content}`)
            .join('\n');

        // Resumen generado por Vapi (si está disponible) o lo generamos nosotros
        let resumen = analysis?.summary || '';

        console.log(`📞 Llamada finalizada | ID: ${callId} | De: ${from} | Duración: ${duracion}`);

        // ── Buscar datos del vecino ──
        const vecinos = from ? await buscarVecinosPorTelefono(from) : [];
        const vecino  = vecinos[0] || null;
        const sessionKey = `vapi_${callId}`;
        const session = sesiones.get(sessionKey) || {};

        const nombreVecino  = vecino?.nombre   || session.nombreVecino  || 'Vecino';
        const edificio      = vecino?.edificio || session.nombreEdificio || 'No especificado';
        const urgencia      = session.ultimaUrgencia || 'baja';

        // ── Generar resumen con Gemini si Vapi no lo proveyó ──
        if (!resumen && transcripcion) {
            const { GoogleGenAI } = require('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            try {
                const r = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{ text: `Resumí en 2 oraciones esta llamada de atención de consorcio para el registro del administrador:\n\n${transcripcion}` }],
                    config: { temperature: 0.2 },
                });
                resumen = r.text.trim();
            } catch (e) {
                resumen = 'Llamada finalizada — ver transcripción completa.';
            }
        }

        // ── Generar mensaje post-llamada para el vecino ──
        let mensajeWhatsApp = '';
        if (from && transcripcion) {
            const { GoogleGenAI } = require('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            try {
                const r = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{ text: `Sos MARCOS, representante de atención de Bien Argentinos.
Acabás de hablar por teléfono con ${nombreVecino} sobre un problema en ${edificio}.
Esta fue la conversación:

${transcripcion}

Escribí un mensaje de WhatsApp CORTO (máximo 3 oraciones) que:
1. Haga referencia breve a lo que hablaron (sin repetir todo)
2. Le confirme que el tema quedó registrado y en gestión
3. Lo invite naturalmente a escribir por WhatsApp para cualquier consulta o novedad
Tono: cálido, argentino, de "usted". SIN presentarte de nuevo. SIN emojis de corazón.` }],
                    config: { temperature: 0.7 },
                });
                mensajeWhatsApp = r.text.trim();
            } catch (e) {
                mensajeWhatsApp = `Hola ${nombreVecino}, le escribo para confirmar que su consulta quedó registrada. Ante cualquier novedad, escríbame por acá y lo atiendo de inmediato.`;
            }
        }

        // ── Enviar mensaje por WhatsApp al vecino ──
        let mensajeEnviado = 'No';
        if (from && mensajeWhatsApp) {
            // Pequeña demora para que el vecino ya haya colgado
            await new Promise(resolve => setTimeout(resolve, 5000));
            await enviarWhatsApp(from, mensajeWhatsApp, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            mensajeEnviado = mensajeWhatsApp;
            console.log(`💬 Mensaje post-llamada enviado a ${from}`);
        }

        // ── Guardar todo en Sheets ──
        await guardarLlamada({
            telefono:      from,
            vecino:        nombreVecino,
            edificio:      edificio,
            duracion:      duracion,
            resumen:       resumen,
            transcripcion: transcripcion,
            urgencia:      urgencia,
            estado:        'Finalizada',
            mensajeEnviado: mensajeEnviado !== 'No' ? 'Sí' : 'No',
        });

        // ── Notificar al administrador ──
        if (process.env.ADMIN_PHONE) {
            const msgAdmin = `📞 *MARCOS — LLAMADA FINALIZADA*\n\n` +
                `👤 *Vecino:* ${nombreVecino}\n` +
                `📍 *Edificio:* ${edificio}\n` +
                `⏱️ *Duración:* ${duracion}\n` +
                `🚦 *Urgencia:* ${urgencia.toUpperCase()}\n\n` +
                `📋 *Resumen:* ${resumen}\n\n` +
                `💬 _Transcripción completa disponible en Google Sheets → pestaña "llamadas"_`;
            await enviarWhatsApp(process.env.ADMIN_PHONE, msgAdmin, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
        }

        // Limpiar sesión de la llamada
        sesiones.delete(sessionKey);
        console.log(`✅ Llamada ${callId} procesada y archivada.`);

    } catch (err) {
        console.error('Error procesando fin de llamada:', err.message);
    }
});

// ── Endpoint API para Asistente IA del Dashboard AC ─────────────────────────
app.post('/api/asistente-consultar', async (req, res) => {
    try {
        const { pregunta, seccion } = req.body || {};
        if (!pregunta) {
            return res.status(400).json({ error: 'Falta la pregunta' });
        }

        const rutaDoc = path.join(__dirname, 'documentacion', 'conocimiento_dashboard.md');
        let conocimiento = '';
        if (fs.existsSync(rutaDoc)) {
            conocimiento = fs.readFileSync(rutaDoc, 'utf-8');
        }

        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const systemInstruction = `
Sos el Asistente Virtual de ayuda interactiva del Dashboard AC (Atención a Consorcios).
Tu función es guiar amablemente a los clientes, responder sus dudas sobre el panel y explicarles qué hace cada sección o botón.

REGLAS DE RESPUESTA:
1. Responde de forma concisa, clara y profesional (máximo 2 o 3 párrafos cortos).
2. Usa viñetas y formato legible cuando ayude a la claridad.
3. Si el usuario pregunta sobre un área que en la base de conocimiento figura como "En Mantenimiento", explícale con cortesía que se están aplicando mejoras de rendimiento y que estará disponible a la brevedad.
4. El usuario te está escribiendo desde el apartado: "${seccion || 'Inicio / General'}".

BASE DE CONOCIMIENTO OFICIAL DEL DASHBOARD:
${conocimiento}
`.trim();

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ text: pregunta }],
            config: {
                systemInstruction,
                temperature: 0.4,
            },
        });

        const respuesta = response.text ? response.text.trim() : 'No pude procesar la respuesta.';
        return res.json({ respuesta });

    } catch (err) {
        console.error('Error en /api/asistente-consultar:', err.message);
        return res.status(500).json({ error: 'No se pudo procesar la consulta en este momento.' });
    }
});

iniciarCronReportes();
const dashboard = require('./dashboard');
app.use('/admin', dashboard);

app.listen(PORT, () => console.log(`🚀 Servidor Marcos corriendo en puerto ${PORT}`));