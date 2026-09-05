// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta:
// `node /ruta/larga/script.js` desde otra carpeta no encontraba ninguna variable y el script
// reventaba con un error que no decía nada ('path must be a string, received undefined').
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express    = require('express');
const { fechaHoraAR, fechaAR } = require('./fecha');
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
} = require('./datos');

const { descargarMedia, guardarArchivoEstructurado } = require('./media');
const { evaluarCaso }        = require('./agentes/marcos-caso');
const { responderVecino }    = require('./agentes/marcos-cara');
const { gestionarOperaciones, enviarWhatsApp, subirMediaWhatsApp, enviarAudioWhatsApp, procesarSiguienteEventoProveedor, redactarNovedadParaTecnico } = require('./agentes/marcos-ops');
const { procesarDocumento }  = require('./agentes/marcos-docs');
const { reportarAlAdmin, iniciarCronReportes }    = require('./agentes/marcos-admin');

const app = express();
app.use(bodyParser.json());
const path = require('path');
app.use('/audios', express.static(path.join(__dirname, 'temp')));
app.use('/audios', express.static(path.join(__dirname, 'almacenamiento')));
app.use('/archivos', express.static(path.join(__dirname, 'almacenamiento')));
app.use('/archivos', express.static(path.join(__dirname, 'temp')));
app.use('/temp', express.static(path.join(__dirname, 'temp')));

const fs = require('fs');
function logDebug(msg) {
    const t = new Date().toISOString();
    fs.appendFileSync('debug_marcos.log', `[${t}] ${msg}\n`);
}

// La lista de etiquetas vive en `etiquetas-media.js` y en ningún otro lado: llegó a estar escrita
// tres veces el mismo día, y con tres copias agregar una etiqueta nueva es acordarse de tres
// lugares.
function limpiarTextoProblema(p) {
    return require('./etiquetas-media').soloTexto(p);
}

/**
 * La confirmación del técnico puede haber llegado antes de que existiera la sesión de este vecino,
 * o después de un reinicio de PM2. En ese caso vive en el estado del proveedor: se la busca ahí por
 * el vecino al que está atendiendo, para no contestarle "estoy consultando" a alguien cuya visita
 * ya está confirmada.
 */
/**
 * Marcos no avisa por su cuenta cuando el técnico confirma: el técnico ya tiene el teléfono del
 * vecino y muchas veces lo llama directo, así que un aviso automático sería ruido. Pero si alguien
 * del edificio pregunta, la respuesta tiene que estar.
 *
 * @param {string} telefonoVecino Quién está preguntando.
 * @param {object} [contexto] `edificio` y `datosEmisor`, para poder responderle también a quien no
 *   abrió el caso pero tiene por qué saber.
 */
async function confirmacionDelCaso(telefonoVecino, contexto = {}) {
    // Primero la memoria, que es instantánea; si no está -- típico después de un reinicio --, se
    // busca en el caso, que es donde quedó guardada de verdad.
    const enRam = confirmacionDesdeProveedor(telefonoVecino);
    if (enRam) return enRam;
    try {
        const { buscarConfirmacionTecnicoDeVecino, buscarConfirmacionTecnicoDeEdificio } = require('./datos-pg');
        const propia = await buscarConfirmacionTecnicoDeVecino(telefonoVecino);
        if (propia) return propia;

        // El encargado, el suplente, la guardia o el administrador preguntan por visitas que no
        // abrieron ellos: buscar solo por su teléfono no encuentra nada. A un vecino cualquiera no
        // se le contesta por acá, porque el caso puede ser dentro de otra unidad.
        if (puedeVerVisitasDelEdificio(contexto.datosEmisor) && contexto.edificio) {
            return await buscarConfirmacionTecnicoDeEdificio(contexto.edificio);
        }
        return null;
    } catch (err) {
        console.error('Error recuperando la confirmación del técnico:', err.message);
        return null;
    }
}

// ── RECONOCER DE QUÉ FACTURA HABLA EL PROVEEDOR ─────────────────────────────────
// El técnico pregunta con las palabras de su trabajo: "¿me pagaron Ortiz?", "¿y San Patricio?".
// No conoce el nombre completo con el que el edificio está cargado, ni tiene por qué saber si hay
// cuatro Ortiz en el sistema. Así que en vez de interpretar el texto, se compara el texto contra
// SUS facturas: alcanza con que nombre una palabra propia de alguna para saber cuál es.

const PALABRAS_GENERICAS = new Set([
    'casa', 'calle', 'torre', 'edificio', 'consorcio', 'avenida', 'depto', 'piso',
    'trabajo', 'arreglo', 'factura', 'comprobante', 'servicio', 'general',
]);

function normalizarParaBuscar(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // sin tildes: "patricío" y "patricio"
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Si el mensaje nombra el edificio o el concepto de esta factura.
 *
 * Se exigen palabras de 5 letras o más y se descartan las genéricas: sin eso, "casa" o "edificio"
 * -- que aparecen en medio consorcio y en casi cualquier pregunta -- harían que cualquier mensaje
 * coincidiera con todas las facturas a la vez.
 */
function textoMencionaFactura(textoNormalizado, factura) {
    const candidatas = [factura?.edificio, factura?.concepto]
        .map(normalizarParaBuscar)
        .filter(Boolean);

    for (const campo of candidatas) {
        if (campo.length >= 5 && textoNormalizado.includes(campo)) return true;
        for (const palabra of campo.split(' ')) {
            if (palabra.length >= 5 && !PALABRAS_GENERICAS.has(palabra) && textoNormalizado.includes(palabra)) {
                return true;
            }
        }
    }
    return false;
}

/** Quién tiene por qué enterarse de una visita del edificio sin haberla pedido él. */
function puedeVerVisitasDelEdificio(datosEmisor) {
    const rol = String(datosEmisor?.rol || '').toLowerCase();
    if (rol === 'encargado' || rol === 'seguridad' || rol === 'admin') return true;
    // Los del consejo figuran como vecinos: lo que los distingue es la marca en su ficha.
    return Boolean(String(datosEmisor?.consejo || '').trim());
}

function confirmacionDesdeProveedor(telefonoVecino) {
    try {
        const tel = String(telefonoVecino || '').replace(/\D/g, '');
        if (!tel || !global.colasProveedores) return null;
        for (const st of global.colasProveedores.values()) {
            if (!st?.confirmacion?.confirmado) continue;
            const telAtendido = String(st.vecinoActivo?.telefono || '').replace(/\D/g, '');
            if (telAtendido && telAtendido.endsWith(tel.slice(-8))) return st.confirmacion;
        }
    } catch (_) { /* si falla, simplemente no hay confirmación conocida */ }
    return null;
}

// ── APRENDIZAJE DE ACCESOS DEL EDIFICIO ──────────────────────────────────────
// El administrador rara vez tiene cargado todo: dónde está la sala de medidores, quién tiene la
// llave del tablero, si la sala de máquinas está con candado. Esos datos aparecen solos en la
// conversación -- "mandá al técnico que sale humo de la sala de electricidad, yo le abro que tengo
// llave" -- y hasta ahora se perdían apenas terminaba el chat. En los edificios sin encargado, que
// son los que más lo necesitan, ese vecino ES el acceso.
//
// Marcos los anota a medida que aparecen, con constancia de quién los aportó. No pregunta por
// ellos: solo escucha.

async function aprenderAccesosDeConversacion({ texto, edificio, quienLoDijo, telefono }) {
    if (!texto || !edificio) return;
    try {
        const { extraerAccesosDeTexto } = require('./accesos');
        const datos = await extraerAccesosDeTexto({ texto, quienLoDijo });
        if (!datos.length) return;

        const { guardarAccesoEdificio } = require('./datos');
        const origen = `${quienLoDijo || 'vecino'}${telefono ? ` (${String(telefono).replace(/\D/g, '')})` : ''}`;

        for (const d of datos) {
            await guardarAccesoEdificio({
                edificio,
                lugar:      d.lugar,
                ubicacion:  d.ubicacion,
                quienAbre:  d.quien_abre,
                telefono:   d.telefono,
                tipoAcceso: d.tipo_acceso,
                notas:      d.notas,
                origen:     `Aportado por ${origen}`
            });
        }
    } catch (err) {
        console.error('Error aprendiendo accesos de la conversación:', err.message);
    }
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

// De quién es este mensaje y a qué caso pertenece, para etiquetarlo bien en el visor de chat.
//
// Antes esto miraba únicamente la sesión del vecino y daba por sentado que quien escribía era un
// vecino. Resultado: los mensajes del técnico quedaban guardados como `remitente = 'vecino'` y sin
// caso asociado, así que en el visor aparecían del lado equivocado de la conversación y sueltos,
// sin pertenecer a ningún [CASO-XXXX].
async function contextoChat(telefono) {
    const tel = String(telefono || '').replace(/\D/g, '');

    // 1. ¿Es un proveedor con un caso en curso? Su estado sabe a qué caso está atendiendo.
    const stProv = global.colasProveedores?.get(tel);
    if (stProv && (stProv.eventoActivoId || stProv.chatActivo)) {
        return {
            edificio:  stProv.edificioActivo || stProv.vecinoActivo?.edificio || '',
            eventoId:  stProv.eventoActivoId || null,
            remitente: 'tecnico',
        };
    }

    // 2. Sesión de vecino en curso.
    const s = global.marcosSesiones?.get(telefono) || sesiones.get(telefono) || {};
    if (s.nombreEdificio || s.idEventoActual) {
        return { edificio: s.nombreEdificio || '', eventoId: s.idEventoActual || null, remitente: 'vecino' };
    }

    // 3. Primer contacto: se resuelve el rol contra la base. Desde que las lecturas salen de
    // PostgreSQL esto cuesta menos de un milisegundo, así que ya no hay motivo para adivinarlo.
    try {
        const { buscarRolPorTelefono } = require('./datos');
        const rol = await buscarRolPorTelefono(telefono);
        const comoRemitente = { proveedor: 'tecnico', encargado: 'encargado', seguridad: 'encargado', admin: 'admin' };
        return { edificio: rol?.edificio || '', eventoId: null, remitente: comoRemitente[rol?.rol] || 'vecino' };
    } catch (err) {
        console.error('Error resolviendo el rol para el registro del chat:', err.message);
        return { edificio: '', eventoId: null, remitente: 'vecino' };
    }
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

        // ── AVISOS DE ENTREGA DE META ────────────────────────────────────────────────────
        //
        // Cuando Marcos manda un mensaje, Meta contesta 200 al instante: eso significa "lo
        // recibí", NO "lo entregué". El resultado real llega después, en un webhook aparte con
        // `statuses` -- sent, delivered, read o failed.
        //
        // Esos avisos se descartaban con el `return` de abajo, así que un `failed` era
        // completamente invisible: el log decía "foto reenviada al técnico", Meta la rechazaba
        // media hora más tarde, y nadie se enteraba nunca. Es exactamente lo que hacía que un
        // sistema roto pareciera un sistema funcionando.
        if (Array.isArray(entry?.statuses) && entry.statuses.length) {
            const { motivoMeta } = require('./agentes/marcos-ops');
            for (const st of entry.statuses) {
                if (st.status !== 'failed') continue;
                for (const err of (st.errors || [{}])) {
                    const codigo = err.code;
                    const detalle = err.title || err.message || err.error_data?.details || 'sin detalle';
                    const porQue = motivoMeta(codigo, `${detalle} ${err.error_data?.details || ''}`);
                    console.error(
                        `📵 META RECHAZÓ LA ENTREGA a ${st.recipient_id}${codigo ? ` [código ${codigo}]` : ''}: ` +
                        `${detalle}${porQue ? ' → ' + porQue : ''}`
                    );
                }
            }
        }

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
            const docFilename = message.document.filename || '';
            msgBody = message.document.caption 
                ? `${message.document.caption} (Documento: ${docFilename || 'archivo.pdf'})`
                : (docFilename ? `(Documento adjunto: ${docFilename})` : '(Documento adjunto)');
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
                // Una ficha de WhatsApp puede tener VARIOS números (el fijo y el celular, el
                // personal y el del trabajo). Quedarse con el primero y descartar el resto hacía
                // que el informe llevara uno y el aviso de acceso otro: el técnico recibía dos
                // números distintos para la misma persona y no sabía a cuál llamar.
                const telefonosCto = [...new Set(
                    (c?.phones || []).map(p => String(p?.wa_id || p?.phone || '').replace(/\D/g, '')).filter(Boolean)
                )];
                return { nombre: nombreCto, telefono: telefonosCto[0] || '', telefonos: telefonosCto, ficha: c };
            }).filter(c => c.telefono);

            if (contactosRecibidos.length === 0) return;
            contactosCompartidos = contactosRecibidos;
            msgBody = `(Contacto compartido) ${contactosRecibidos.map(c => `${c.nombre}: ${c.telefonos.join(' / ')}`).join(', ')}`;
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

        // El texto de cada mensaje se guarda para poder resolver las citas. El Map en memoria queda
        // como vía rápida, pero el que manda es el de la base: sin él, después de cada reinicio la
        // cita llegaba vacía y Marcos no sabía de qué le hablaban.
        if (!global.mensajesIdMap) global.mensajesIdMap = new Map();
        if (msgId && msgBody) {
            global.mensajesIdMap.set(msgId, msgBody);
            require('./db-pg').guardarTextoMensajeWa(msgId, msgBody);
        }

        // Extraer contexto de mensaje citado si existe (Quote / Reply)
        if (message.context && (message.context.id || message.context.from)) {
            const idCitado = message.context.id;
            let textoCitado = global.mensajesIdMap.get(idCitado);
            if (!textoCitado && idCitado) {
                textoCitado = await require('./db-pg').buscarTextoMensajeWa(idCitado);
                if (textoCitado) console.log(`📌 Texto del mensaje citado recuperado de la base (no estaba en memoria).`);
            }
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
        cola.items.push({ tipo: msgType, texto: msgBody, mediaId, contactos: contactosCompartidos, docFilename: message.document?.filename || '' });
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
            let audiosEnRafaga = 0;
            let audiosTranscriptos = 0;
            for (const item of items) {
                if (item.tipo === 'audio' && item.mediaId) {
                    audiosEnRafaga++;
                    try {
                        const mediaAudio = await descargarMedia(item.mediaId);
                        if (mediaAudio) {
                            const { transcribirAudio } = require('./stt');
                            const transcripcion = await transcribirAudio(mediaAudio.filePath, mediaAudio.mimeType);
                            if (transcripcion) {
                                item.texto = transcripcion;
                                audiosTranscriptos++;
                            } else {
                                console.error(`⚠️ La nota de voz ${item.mediaId} no devolvió transcripción.`);
                            }
                            // El audio se copia al almacenamiento permanente y esa es la ruta que
                            // se guarda. Antes se guardaba la de `temp/`, que es una carpeta de
                            // paso: cuando se limpia, el reproductor del panel queda apuntando a
                            // un archivo que ya no existe y muestra una nota de voz de "0:01".
                            const sesAudio = global.marcosSesiones?.get(recipient);
                            const permanente = guardarArchivoEstructurado({
                                filePath: mediaAudio.filePath,
                                adminNombre: sesAudio?.datosVecino?.adminNombre,
                                edificioNombre: sesAudio?.nombreEdificio,
                                tipo: 'audios'
                            });
                            item.urlWeb = permanente?.relativeUrl
                                || `/audios/${require('path').basename(mediaAudio.filePath)}`;
                        } else {
                            // Este camino no dejaba ningún rastro: sin el archivo no se transcribe,
                            // y el audio seguía viaje con el texto de relleno como si nada.
                            console.error(`⚠️ No se pudo descargar la nota de voz ${item.mediaId}: queda sin transcribir.`);
                        }
                    } catch (e) {
                        console.error(`Error transcribiendo audio de la ráfaga (${item.mediaId}):`, e.message);
                    }

                    // Un audio que no se pudo leer NO puede viajar como '(Nota de voz)': ese texto
                    // no está vacío, así que pasaba todos los filtros y llegaba a la IA ocupando el
                    // lugar de lo que la persona había dicho. Con dos audios fallados de tres, a
                    // Marcos le llegaba "(Nota de voz) (Nota de voz) me voy y dejo el teléfono" y
                    // volvía a pedir el nombre y la dirección que el vecino ya había dado.
                    // Diciéndolo con todas las letras, Marcos puede pedir que le repitan ESA nota
                    // en vez de arrancar la conversación de cero.
                    if (!item.texto || item.texto === '(Nota de voz)') {
                        item.texto = '(no se pudo escuchar esta nota de voz)';
                    }
                }
            }
            if (audiosEnRafaga) {
                console.log(`🎙️ Ráfaga con ${audiosEnRafaga} nota(s) de voz: ${audiosTranscriptos} transcripta(s), ${audiosEnRafaga - audiosTranscriptos} sin transcribir.`);
            }

            // Registramos cada mensaje de la ráfaga por separado y en orden, no el texto pegado:
            // el visor del dashboard tiene que mostrar las mismas burbujas que vio el vecino
            // (su audio ya transcripto, su texto, su foto), no un bloque único.
            const ctxEntrada = await contextoChat(recipient);
            for (const item of items) {
                registrarMensajeChat({
                    eventoId:  ctxEntrada.eventoId,
                    edificio:  ctxEntrada.edificio,
                    telefono:  recipient,
                    remitente: ctxEntrada.remitente,
                    mensaje:   item.texto || '',
                    tipoCanal: item.tipo === 'audio' ? 'whatsapp-audio' : 'whatsapp',
                    // Una ruta que el panel pueda reproducir o abrir. Antes se guardaba
                    // `media:<id>`, que no es una ruta ni un archivo: el visor mostraba la burbuja
                    // del audio pero no tenía con qué reproducirlo. Si todavía no se descargó el
                    // adjunto, va el identificador de Meta pelado, que al menos es resoluble.
                    urlMedia:  item.urlWeb || item.mediaId || ''
                });
            }

            const msgBodyCompleto = items.map(i => i.texto).filter(Boolean).join(' ');

            // La misma ráfaga, pero con la etiqueta de cada audio pegada a SU transcripción. Así el
            // panel dibuja el reproductor justo debajo de la frase que corresponde, en vez de
            // amontonar todos los reproductores al principio del mensaje. Va aparte del texto que
            // recibe la IA: al prompt no le sirven las rutas de archivo.
            const msgBodyRegistro = items
                .map(i => (i.tipo === 'audio' && i.urlWeb) ? `[AUDIO:${i.urlWeb}] ${i.texto || ''}`.trim() : (i.texto || ''))
                .filter(Boolean)
                .join(' ');
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
            // Rutas reproducibles de todos los audios de la ráfaga. Hacen falta más adelante para
            // etiquetarlos en el historial del caso: `session.audio_url` solo se llenaba cuando el
            // mensaje era PURO audio, así que en la ráfaga más común -- varias notas de voz y una
            // foto -- el adjunto que viajaba era la imagen y los audios quedaban sin etiqueta.
            const audiosRafaga = items.filter(i => i.tipo === 'audio' && i.urlWeb).map(i => i.urlWeb);

            // ── VARIOS COMPROBANTES EN LA MISMA TANDA ────────────────────────────────────────
            //
            // `mediaIdFinal` se queda con UN solo adjunto, el último. Para el vecino que manda tres
            // fotos del mismo desperfecto eso está bien: es un problema, un caso. Para el técnico
            // que factura NO: manda seis comprobantes seguidos -- tres de un administrador, dos de
            // otro y uno de un tercero -- y se procesaba solo el sexto. Los otros cinco se perdían
            // sin dejar rastro, y encima Marcos contestaba "recibí y archivé la documentación",
            // confirmando algo que no había pasado.
            //
            // Cuando quien escribe es un proveedor y la tanda trae más de un adjunto, cada uno se
            // atiende por separado: son seis comprobantes distintos, de seis trabajos distintos,
            // que pueden ir a seis consorcios de administradores distintos.
            const mediasNoAudio = items.filter(i => i.mediaId && i.tipo !== 'audio');
            let rolDeLaRafaga = null;
            if (mediasNoAudio.length > 1) {
                try {
                    rolDeLaRafaga = await buscarRolPorTelefono(from);
                } catch (e) {
                    console.error('No se pudo detectar el rol para separar la ráfaga:', e.message);
                }
            }

            if (mediasNoAudio.length > 1 && rolDeLaRafaga?.rol === 'proveedor') {
                console.log(`🧾 Ráfaga de ${rolDeLaRafaga.nombre || 'proveedor'} con ${mediasNoAudio.length} adjuntos: se procesa uno por uno para no perder ninguno.`);

                // El texto suelto (el que no venía pegado a ningún adjunto) acompaña al primero:
                // es donde el técnico suele decir de qué edificio son.
                const textoSuelto = items
                    .filter(i => !i.mediaId && i.texto)
                    .map(i => i.texto)
                    .join(' ')
                    .trim();

                for (let i = 0; i < mediasNoAudio.length; i++) {
                    const doc = mediasNoAudio[i];
                    const esPrimero = i === 0;
                    const textoDeEste = [esPrimero ? textoSuelto : '', doc.texto || '']
                        .filter(Boolean).join(' ').trim() || '(Comprobante adjunto)';

                    await procesarMensaje({
                        from,
                        recipient,
                        msgBody: textoDeEste,
                        mediaId: doc.mediaId,
                        msgType: doc.tipo,
                        pushName: pushNameFinal,
                        // La respuesta hablada se decide una sola vez, en el primero: seis notas de
                        // voz seguidas por seis facturas sería insoportable, y además gasta crédito.
                        preferirAudioRespuesta: esPrimero && preferirAudioRespuesta,
                        contactosCompartidos: esPrimero ? contactosFinal : [],
                        audiosRafaga: esPrimero ? audiosRafaga : [],
                        msgBodyRegistro: textoDeEste,
                        itemsRafaga: [doc]
                    }).catch(err => {
                        console.error(`Error procesando el comprobante ${i + 1} de ${mediasNoAudio.length}:`, err.message);
                    });
                }
                return;
            }

            await procesarMensaje({ from, recipient, msgBody: msgBodyCompleto, mediaId: mediaIdFinal, msgType: msgTypeFinal, pushName: pushNameFinal, preferirAudioRespuesta, contactosCompartidos: contactosFinal, audiosRafaga, msgBodyRegistro, itemsRafaga: items }).catch(err => {
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

// Si dos formas de nombrar un oficio son el mismo oficio ("electricidad" = "electricista" = "luz").
// Vive en `rubros.js` porque lo usa también sheets.js, para decidir si un reclamo nuevo continúa
// un caso abierto o es otro caso.
// `atiendeRubro` y no `coincideRubro`: acá la pregunta es "¿este técnico hace este trabajo?", que
// es más amplia que "¿es el mismo trabajo?". La ficha de Dario dice "Electricista" y el caso es de
// CCTV: es él igual. Con el criterio estricto no lo encontraba y le hablaba al plomero.
const { atiendeRubro, rubroDelCaso } = require('./rubros');

// La foto/video que el vecino adjuntó al caso. Vive en `material-caso.js` porque también la
// necesita marcos-ops para decidir si le pide al técnico que conteste.
const { materialDelVecinoEnCaso } = require('./material-caso');

/**
 * Le entrega al técnico lo que Meta rechazó cuando le mandamos el caso.
 *
 * POR QUÉ EXISTE ESTO. La plantilla de Meta es lo único que sale con la ventana de 24hs cerrada.
 * Todo lo demás -- la foto del reclamo, la ficha de contacto, el teléfono de quien le abre -- es
 * mensaje libre, y Meta lo rechaza con el código 131047 mientras la ventana no esté abierta. Y la
 * ventana NO la abre la plantilla que mandamos nosotros: la abre el técnico cuando responde.
 *
 * Como Marcos manda las cuatro cosas seguidas, en la práctica llegaba solo la plantilla y el resto
 * rebotaba un segundo antes de tiempo. En el chat del técnico se veía la plantilla sola, y encima
 * Marcos después le decía "el vecino no adjuntó material" -- que era falso: el material existía y
 * se había perdido en el camino.
 *
 * Esta función se llama cuando el técnico ESCRIBE, que es exactamente el instante en que la
 * ventana se abre, y entrega lo que quedó pendiente. Las marcas de entregado viven en el caso
 * (no en RAM) porque PM2 reinicia seguido y un reintento perdido acá deja al técnico yendo a un
 * domicilio sin saber qué va a encontrar ni a quién tocarle el timbre.
 */
async function entregarPendientesAlTecnico({ telTecnico, nombreTecnico, idEvento, edificio, telVecino, nombreVecino }) {
    if (!telTecnico || !idEvento) return false;

    // Se pone en true solo si algo QUEDÓ sin entregar. El llamador usa esto para dejar de releer
    // la planilla en cada mensaje del técnico una vez que ya no hay nada pendiente.
    let quedaPendiente = false;

    const {
        fueMaterialEnviadoATecnico, marcarMaterialEnviadoATecnico,
        fueContactoAccesoAvisado, marcarContactoAccesoAvisado,
        guardarReporte,
    } = require('./datos');

    // Al técnico se le habla con la dirección de la calle, nunca con el nombre interno del
    // edificio: son dos textos distintos y mandarle los dos lo deja sin saber a cuál ir.
    const { direccionParaTecnico } = require('./agentes/marcos-ops');
    const direccion = await direccionParaTecnico(edificio);

    // 1) La foto o el video del reclamo.
    try {
        if (!(await fueMaterialEnviadoATecnico(idEvento))) {
            const material = await materialDelVecinoEnCaso(idEvento, telVecino);
            if (material?.filePath) {
                const mediaId = await subirMediaWhatsApp(material.filePath, material.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                if (mediaId) {
                    const quien = (nombreVecino && nombreVecino !== 'Vecino' && nombreVecino !== 'Desconocido') ? nombreVecino : 'El vecino';
                    const esVideo = material.tipo === 'video';
                    const pie = `📱 *MARCOS — ${esVideo ? 'VIDEO' : 'FOTO'} DEL RECLAMO [${idEvento}]*\n\n` +
                        `${nombreTecnico || 'Hola'}, ${quien} en ${direccion} adjuntó esto del inconveniente.`;

                    const { enviarImagenWhatsApp, enviarVideoWhatsApp } = require('./agentes/marcos-ops');
                    const salio = esVideo
                        ? await enviarVideoWhatsApp(telTecnico, mediaId, pie, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN)
                        : await enviarImagenWhatsApp(telTecnico, mediaId, pie, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);

                    if (salio) {
                        await marcarMaterialEnviadoATecnico(idEvento);
                        const tag = (esVideo ? '[VIDEO:' : '[IMAGEN:') + `/archivos/${path.basename(material.filePath)}]`;
                        await guardarReporte({
                            id_evento: idEvento,
                            edificio: edificio || '',
                            tecnico: nombreTecnico || '',
                            tel_tecnico: telTecnico,
                            historial_chat: JSON.stringify([`Marcos (a Proveedor): ${tag} ${pie}`]),
                        }).catch(e => console.error('Error registrando el material entregado al técnico:', e.message));
                        console.log(`📎✅ El material del [${idEvento}] que había rebotado le llegó ahora a ${nombreTecnico || telTecnico}.`);
                    } else {
                        quedaPendiente = true;
                        console.error(`📎❌ El material del [${idEvento}] volvió a rebotar hacia ${nombreTecnico || telTecnico}. No se marca como entregado.`);
                    }
                }
            }
        }
    } catch (e) {
        quedaPendiente = true;
        console.error('Error entregando el material pendiente al técnico:', e.message);
    }

    // 2) El contacto de quien le abre la puerta. Se lee del legajo del vecino y no de la sesión:
    //    la sesión se borra en cada reinicio y este dato es justamente el que evita que el técnico
    //    llegue y se quede parado en la vereda.
    try {
        if (!(await fueContactoAccesoAvisado(idEvento))) {
            // QUE ALGUIEN HAYA ABIERTO UNA VEZ NO QUIERE DECIR QUE ABRA SIEMPRE.
            //
            // Antes esto leía derecho el `contactoAcceso` del legajo del vecino y lo entregaba como
            // un hecho: "el vecino dejó este contacto para que le abran". Ese dato se había guardado
            // en el CASO-1001 porque esa vez no había nadie y Natalia se ofreció -- y quedó como el
            // contacto de ingreso del edificio para siempre.
            //
            // El orden correcto es el del edificio primero (encargado, suplente, seguridad, lo
            // aprendido sobre sus accesos) y recién al final, como SUGERENCIA, lo que pasó una vez.
            const { contactoParaElIngreso, mensajeDeIngreso } = require('./contacto-ingreso');
            const vecinoFicha = telVecino ? await buscarVecinoPorTelefono(telVecino) : null;

            let perfilIngreso = null;
            let accesosIngreso = [];
            try {
                const { buscarPerfilEdificio, buscarAccesosEdificio } = require('./datos');
                perfilIngreso = edificio ? await buscarPerfilEdificio(edificio) : null;
                accesosIngreso = edificio ? ((await buscarAccesosEdificio(edificio)) || []) : [];
            } catch (e) { console.error('No se pudo leer quién abre en el edificio:', e.message); }

            // A QUÉ HORA VA A LLEGAR. El encargado trabaja por horario: si el técnico llega de
            // madrugada, no está, y afirmarle que le abre es mandarlo a la puerta a descubrirlo
            // solo. Se usa la hora que el técnico prometió; sin promesa, la de ahora, que es lo
            // más parecido a "está por salir".
            let momentoVisita = new Date();
            try {
                const { buscarCasoPorCodigo } = require('./datos');
                const { momentoPrometido } = require('./seguimiento');
                const casoIngreso = idEvento ? await buscarCasoPorCodigo(idEvento) : null;
                const eta = String(casoIngreso?.eta || '').trim();
                if (eta) momentoVisita = momentoPrometido(eta) || momentoVisita;
            } catch (e) { console.error('No se pudo leer a qué hora dijo que iba:', e.message); }

            const contacto = contactoParaElIngreso({
                perfil: perfilIngreso,
                accesos: accesosIngreso,
                contactoDeCasoAnterior: String(vecinoFicha?.contactoAcceso || '').trim(),
                edificioDelContacto: vecinoFicha?.edificio || '',
                edificio: edificio || '',
                momentoVisita,
            });

            // Sin nada firme, la Administración es la que sabe: se le pregunta en vez de reciclar
            // el arreglo de otra visita.
            //
            // Solo cuando HAY algo flojo que decir. Esta función corre en cada mensaje entrante del
            // proveedor: preguntar en todas sería spam, y además la falta total de un contacto de
            // ingreso no es un pendiente de entrega -- es un dato que falta en el edificio, y se
            // resuelve en la ficha, no acá.
            if (contacto && !contacto.firme) {
                try {
                    const { avisarAlAdministrador } = require('./agentes/marcos-admin');
                    await avisarAlAdministrador({
                        edificio: edificio || '',
                        idEvento,
                        motivo: 'no hay un contacto de ingreso confirmado para el edificio',
                        titulo: `🔑 MARCOS: ¿QUIÉN LE ABRE AL TÉCNICO EN ${direccion}?`,
                        cuerpo:
                            `Va a ir ${nombreTecnico || 'un técnico'} (${telTecnico}) por el ${idEvento} y no tengo cargado quién le abre.\n\n` +
                            (contacto ? `Lo único que tengo es que ${contacto.texto} ${contacto.origen} — pero fue por esa vez, no es un contacto fijo.\n\n` : '') +
                            `¿A quién le aviso para que lo dejen entrar? Con eso lo cargo en el edificio y no vuelvo a preguntar.`,
                        phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                        accessToken: WHATSAPP_ACCESS_TOKEN
                    });
                } catch (e) { console.error('No se pudo preguntarle a la Administración quién abre:', e.message); }
            }

            if (contacto) {
                const msg = mensajeDeIngreso({ contacto, idEvento, direccion, nombreTecnico });

                const salio = await enviarWhatsApp(telTecnico, msg, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                if (salio) {
                    await marcarContactoAccesoAvisado(idEvento);
                    await guardarReporte({
                        id_evento: idEvento,
                        edificio: edificio || '',
                        tecnico: nombreTecnico || '',
                        tel_tecnico: telTecnico,
                        historial_chat: JSON.stringify([`Marcos (a Proveedor): ${msg}`]),
                    }).catch(e => console.error('Error registrando el contacto de acceso entregado:', e.message));
                    console.log(`📞✅ El contacto de acceso del [${idEvento}] que había rebotado le llegó ahora a ${nombreTecnico || telTecnico}.`);
                } else {
                    quedaPendiente = true;
                    console.error(`📞❌ El contacto de acceso del [${idEvento}] volvió a rebotar. No se marca como avisado.`);
                }
            }
        }
    } catch (e) {
        quedaPendiente = true;
        console.error('Error entregando el contacto de acceso pendiente al técnico:', e.message);
    }

    return quedaPendiente;
}

// ── DESPACHADOR DE RESPUESTAS (Modo Espejo / TTS) ─────────────────────────────
async function despacharRespuesta(recipient, texto, msgType) {
    if (!texto) return;

    // Registramos la respuesta de Marcos en el chat. Guardamos siempre el TEXTO, aunque salga
    // como nota de voz: el visor necesita leer qué dijo, no reproducir el ogg.
    const ctxSalida = await contextoChat(recipient);
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
        // El techo de notas de voz se consulta en la base y no en la sesión: cada audio cuesta
        // créditos de ElevenLabs, y con el contador en memoria alcanzaba un reinicio de PM2 para
        // que el mismo vecino volviera a tener derecho a dos audios más. Con PM2 reiniciando
        // decenas de veces por día, el límite no limitaba nada.
        const HORA_24_MS = 24 * 60 * 60 * 1000;
        const MAX_AUDIOS_24H = Number(process.env.TTS_MAX_AUDIOS_24H ?? 2);

        let audios24h = null;
        try {
            const { leerAudiosTTS } = require('./db-pg');
            audios24h = await leerAudiosTTS(recipient, HORA_24_MS);
        } catch (error) {
            // Sin poder leer el contador no se sabe cuántos audios se mandaron ya. Se responde por
            // texto, que no cuesta: ante la duda conviene fallar hacia lo gratis.
            console.error(`⚠️ No se pudo leer el contador de notas de voz para ${recipient}, se responde por TEXTO:`, error.message);
        }

        if (audios24h && audios24h.length < MAX_AUDIOS_24H) {
            try {
                console.log(`🎙️ Generando nota de voz #${audios24h.length + 1} (máx ${MAX_AUDIOS_24H} por 24h) para ${recipient}...`);
                const { generarAudio } = require('./tts');
                const { subirMediaWhatsApp, enviarAudioWhatsApp } = require('./agentes/marcos-ops');

                const fileName = await generarAudio(texto, `audio_${Date.now()}.ogg`);
                const mediaIdTTS = await subirMediaWhatsApp(fileName, 'audio/ogg', process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);

                if (mediaIdTTS) {
                    await enviarAudioWhatsApp(recipient, mediaIdTTS, process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN);
                    // El crédito ya se gastó: se anota aunque después falle algo, para que un error
                    // posterior no habilite otra generación.
                    const { registrarAudioTTS } = require('./db-pg');
                    await registrarAudioTTS(recipient, HORA_24_MS);
                    const fs = require('fs');
                    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                    return;
                }
            } catch (error) {
                console.error('Error en despacharRespuesta (TTS):', error.message);
            }
        } else if (audios24h) {
            console.log(`⚠️ Límite de ${MAX_AUDIOS_24H} notas de voz en 24h alcanzado para ${recipient}. Respondiendo por TEXTO para optimizar consumo.`);
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

    // 3. Nivel base de datos: el vecino del último caso abierto.
    try {
        const { buscarVecinoDeCasoAbierto } = require('./datos-pg');
        const vPg = await buscarVecinoDeCasoAbierto({ edificio: edificioNombre, nombreTecnico: datosEmisor?.nombre });
        if (vPg?.telefono) {
            console.log(`📌 [PostgreSQL] Vecino activo recuperado para técnico ${datosEmisor?.nombre}: ${vPg.nombre} (${vPg.telefono})`);
            if (!global.colasProveedores) global.colasProveedores = new Map();
            if (!global.colasProveedores.has(telClean)) global.colasProveedores.set(telClean, { vecinoActivo: vPg });
            else global.colasProveedores.get(telClean).vecinoActivo = vPg;
            return vPg;
        }
    } catch (e) {
        console.error('Error buscando vecino activo en PostgreSQL:', e.message);
    }

    // 3b. Respaldo: la misma búsqueda contra la planilla, por si el caso todavía no llegó a la base.
    try {
        const { getSheet } = require('./datos');
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

    // 4. Nivel base de datos: el último vecino conocido del edificio.
    try {
        const { buscarUltimoVecinoDeEdificio } = require('./datos-pg');
        const vPg = await buscarUltimoVecinoDeEdificio(edificioNombre);
        if (vPg?.telefono) {
            console.log(`📌 [PostgreSQL] Vecino recuperado para edificio ${edificioNombre}: ${vPg.nombre} (${vPg.telefono})`);
            if (!global.colasProveedores) global.colasProveedores = new Map();
            if (!global.colasProveedores.has(telClean)) global.colasProveedores.set(telClean, { vecinoActivo: vPg });
            else global.colasProveedores.get(telClean).vecinoActivo = vPg;
            return vPg;
        }
    } catch (e) {
        console.error('Error buscando el último vecino del edificio en PostgreSQL:', e.message);
    }

    // 4b. Respaldo contra la planilla.
    try {
        const { getSheet } = require('./datos');
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
// `itemsRafaga` son los mensajes sueltos que el vecino mandó en la misma tanda, en orden y con su
// tipo. Se usa para registrar cada burbuja por separado en el historial del caso, en vez de un
// bloque pegado. Se pasa explícitamente: antes se leía sin estar declarada en ningún lado, y eso
// tiraba un ReferenceError que rompía la atención del mensaje entero -- Marcos dejaba de responder.
async function procesarMensaje({ from, recipient, msgBody, mediaId, msgType, pushName, preferirAudioRespuesta = false, contactosCompartidos = [], audiosRafaga = [], msgBodyRegistro = '', itemsRafaga = [] }) {
    // Modo en que le contestamos al usuario (nota de voz vs texto). Es independiente del tipo de
    // adjunto que trajo el mensaje: una ráfaga puede traer una foto (msgType 'image', para
    // reenviarla al técnico) y aun así merecer una respuesta hablada porque el vecino usó audios.
    const msgTypeRespuesta = (preferirAudioRespuesta || msgType === 'audio') ? 'audio' : msgType;

    // Lo que se GUARDA en el historial del caso lleva la etiqueta del audio; lo que se le manda a
    // la IA no. Sin esto, el audio de un técnico quedaba en el historial como texto pelado y el
    // panel mostraba la transcripción sin el reproductor: se podía leer lo que dijo, pero no
    // escucharlo. (El camino del vecino ya se etiqueta más abajo, al armar `messageText`.)
    const msgBodyParaRegistro = msgBodyRegistro || msgBody;

    // ── FASE 0: DESCARGA Y TRANSCRIPCIÓN (si es audio) ───────────────────────
    let media = null;
    if (mediaId) {
        media = await descargarMedia(mediaId);
    }

    // El adjunto se retiene desde que llega hasta que efectivamente sale hacia el tecnico.
    // Marcos corta la vuelta cada vez que le falta un dato -- que edificio es, el apellido, el
    // departamento para armar la ficha de un vecino nuevo -- y en cada uno de esos cortes se
    // perdia la foto que el vecino ya habia mandado. Despues el tecnico se la pedia de nuevo, y
    // con razon el vecino se molestaba. Retenerla en la sesion cubre todos los cortes, no solo el
    // de identificar el edificio.
    if ((msgType === 'image' || msgType === 'video') && media?.filePath) {
        const ses = global.marcosSesiones?.get(recipient);
        if (ses) {
            ses.mediaPendiente = {
                tipo: msgType,
                filePath: media.filePath,
                mimeType: media.mimeType,
                texto: msgBody,
                recibidoEn: Date.now()
            };
            console.log(`📎 Adjunto retenido hasta poder enviarlo al tecnico (${msgType}).`);
        }
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
            fechaInicio: fechaHoraAR(),
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

    // Guardar la última imagen, video o documento recibido en almacenamiento permanente
    let imgUrl = '';
    let videoUrl = '';
    let docUrl = '';
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
    } else if (msgType === 'document' && media) {
        const resEst = guardarArchivoEstructurado({
            filePath: media.filePath,
            adminNombre: session.datosVecino?.adminNombre,
            edificioNombre: session.nombreEdificio,
            tipo: 'documentos'
        });
        docUrl = resEst?.relativeUrl || `/archivos/${path.basename(media.filePath)}`;
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

        // Qué caso está atendiendo este técnico. Se completa al mandarle la plantilla, pero vive en
        // memoria: si PM2 reinició entre ese aviso y esta respuesta, acá llega en null y todo lo que
        // depende del caso queda sin hacerse en silencio -- la confirmación no se guardaba (se
        // pedía el id del caso y no había) y el vecino no se enteraba (se pedía su teléfono y
        // tampoco había). Se recupera del caso abierto antes de usarlo.
        if (!stProv.eventoActivoId || !stProv.vecinoActivo?.telefono || !stProv.rubroActivo) {
            try {
                const { buscarCasoAbiertoPorTecnico } = require('./datos-pg');
                const casoAbierto = await buscarCasoAbiertoPorTecnico(datosEmisor.nombre, from);
                if (casoAbierto?.id_evento) {
                    if (!stProv.eventoActivoId) stProv.eventoActivoId = casoAbierto.id_evento;
                    if (!stProv.edificioActivo) stProv.edificioActivo = casoAbierto.edificio;
                    // El rubro del caso es lo que después permite saber cuál de los técnicos que
                    // comparten esta línea está escribiendo.
                    if (!stProv.rubroActivo && casoAbierto.rubro) stProv.rubroActivo = casoAbierto.rubro;
                    // Quién quedó anotado como el técnico del caso: es con quien Marcos ya viene
                    // hablando, y manda sobre cualquier deducción por rubro.
                    if (!stProv.tecnicoDelCaso && casoAbierto.tecnico) stProv.tecnicoDelCaso = casoAbierto.tecnico;
                    if (!stProv.vecinoActivo?.telefono && casoAbierto.telefono) {
                        stProv.vecinoActivo = {
                            telefono:  casoAbierto.telefono,
                            nombre:    casoAbierto.vecino || 'Vecino',
                            edificio:  casoAbierto.edificio || ''
                        };
                    }
                    console.log(`♻️ Caso del técnico ${datosEmisor.nombre} recuperado tras reinicio: [${casoAbierto.id_evento}] (${casoAbierto.edificio})`);
                }
            } catch (e) {
                console.error('Error recuperando el caso abierto del técnico:', e.message);
            }
        }

        // ── LO QUE META NOS RECHAZÓ, AHORA SÍ ────────────────────────────────────────────────
        //
        // Este mensaje que acaba de entrar es lo que abre la ventana de 24hs de Meta. Todo lo que
        // le mandamos al técnico junto con la plantilla y que rebotó con el código 131047 --la
        // foto del reclamo, el contacto de quien le abre-- recién ahora puede salir.
        //
        // Va antes de contestarle: si el técnico escribió "¿qué pasó?", tiene que ver la foto y no
        // una explicación de por qué no la tiene.
        if (stProv.eventoActivoId && stProv.pendientesResueltosDe !== stProv.eventoActivoId) {
            // > [!CAUTION]
            // > **La pregunta de si el técnico entra solo se hacía DOS MIL LÍNEAS más abajo que
            // > el envío.** `tieneAccesoPropio` vive en la línea ~3300; este envío está acá.
            //
            // Visto en producción: Daniel escribió *"Tengo llave. Y que no necesito nada, voy en
            // 2hs"* y un segundo después le llegó el contacto de ingreso igual. La detección
            // funcionaba perfecto --devuelve `true` con esa frase exacta-- pero corría después de
            // que el mensaje ya había salido. Marcos no dejó de entenderlo: nunca se lo preguntó
            // a tiempo.
            //
            // Se pregunta acá, sobre ESTE mensaje, que es el que lo dice.
            let entraSoloAhora = false;
            try {
                const { tieneAccesoPropio } = require('./contacto-ingreso');
                entraSoloAhora = tieneAccesoPropio(textoFinal);
                if (entraSoloAhora) {
                    console.log(`🔑 ${datosEmisor.nombre || telTech} dijo que entra solo: no se le manda el contacto de ingreso del [${stProv.eventoActivoId}].`);
                    // Se marca como resuelto para que tampoco vuelva a salir en el próximo
                    // mensaje: preguntar y después no escuchar la respuesta le enseña al técnico
                    // que a Marcos no vale la pena contestarle.
                    const { marcarContactoAccesoAvisado } = require('./datos');
                    await marcarContactoAccesoAvisado(stProv.eventoActivoId).catch(() => {});
                }
            } catch (e) { console.error('No se pudo evaluar si el técnico entra solo:', e.message); }

            const quedaPendiente = await entregarPendientesAlTecnico({
                telTecnico:    telTech,
                nombreTecnico: datosEmisor.nombre,
                idEvento:      stProv.eventoActivoId,
                edificio:      stProv.edificioActivo || stProv.vecinoActivo?.edificio || '',
                telVecino:     stProv.vecinoActivo?.telefono || '',
                nombreVecino:  stProv.vecinoActivo?.nombre || '',
            });
            // Si no quedó nada colgado, no se vuelve a consultar la planilla en cada mensaje de
            // este técnico para este mismo caso. Si algo falló, en el próximo mensaje se reintenta.
            if (!quedaPendiente) stProv.pendientesResueltosDe = stProv.eventoActivoId;
        }

        // ── ¿CUÁL DE LOS TÉCNICOS DE ESTA LÍNEA ESTÁ ESCRIBIENDO? ────────────────────────────
        //
        // Un teléfono no identifica a una persona: puede ser la línea de una empresa con varios
        // oficios detrás. En esta planilla el mismo número figura como JULIO (plomero) y como
        // DARIO (electricista), que son dos técnicos de la misma empresa.
        //
        // `buscarRolPorTelefono` devuelve el primero que encuentra, así que Marcos saludaba
        // "Gracias, Julio" a un caso de electricidad que estaba atendiendo Dario. Para el técnico
        // eso es Marcos hablándole a otra persona, y le da lo mismo que el resto funcione.
        //
        // El dato que desempata ya lo tenemos: el RUBRO del caso que está atendiendo. Con eso se
        // elige por la terna teléfono + rubro en vez de por el orden de la planilla.
        try {
            const { proveedoresPorTelefono } = require('./datos');
            const enEsaLinea = (await proveedoresPorTelefono(from)) || [];

            if (enEsaLinea.length > 1) {
                // Se llama `rubroActivoDelCaso` y no `rubroDelCaso` para no tapar a la función
                // `rubroDelCaso` que se importa arriba: son cosas distintas y el nombre repetido
                // hacía que adentro de este bloque la función no existiera.
                const rubroActivoDelCaso = String(stProv.rubroActivo || '').trim();
                const nombres = enEsaLinea.map(p => `${p.nombre} (${p.rubro || 'sin rubro'})`).join(', ');

                // EL CASO YA DECIDIÓ CON QUIÉN ESTÁ HABLANDO. Eso manda sobre el rubro.
                //
                // Pasó en producción: el caso se abrió con "a dario juju (Electricista)", el
                // trabajo era una pérdida de agua, y dos minutos después Marcos le escribió
                // "Gracias, Julio" -- porque el rubro del caso era plomería y en esa línea el
                // plomero es Julio. La regla del rubro hizo lo que le pedimos y quedó mal igual.
                //
                // Cambiar de nombre a mitad de una conversación es Marcos mostrándole al técnico
                // que no sabe con quién habla, y eso es PEOR que haberse quedado con cualquiera de
                // los dos nombres. La consistencia vale más que la deducción: el rubro solo
                // desempata cuando el caso todavía no anotó a nadie.
                const yaAnotado = String(stProv.tecnicoDelCaso || '').trim();
                const enLaLinea = yaAnotado
                    ? enEsaLinea.find(p => {
                        const a = String(p.nombre || '').toLowerCase().trim();
                        const b = yaAnotado.toLowerCase();
                        return a && (a.includes(b) || b.includes(a));
                    })
                    : null;

                if (enLaLinea) {
                    if (enLaLinea.nombre !== datosEmisor.nombre) {
                        console.log(`🎯 En ${from} hay ${enEsaLinea.length} técnicos [${nombres}]. El caso ya está a nombre de ${enLaLinea.nombre}: se le sigue hablando a él.`);
                    }
                    datosEmisor.nombre = enLaLinea.nombre;
                    datosEmisor.especialidad = enLaLinea.rubro || datosEmisor.especialidad;
                } else if (rubroActivoDelCaso) {
                    const elCorrecto = enEsaLinea.find(p => atiendeRubro(p.rubro, rubroActivoDelCaso));
                    if (elCorrecto && elCorrecto.nombre !== datosEmisor.nombre) {
                        console.log(`🎯 En ${from} hay ${enEsaLinea.length} técnicos [${nombres}]. El caso es de "${rubroActivoDelCaso}", así que quien escribe es ${elCorrecto.nombre}, no ${datosEmisor.nombre}.`);
                        datosEmisor.nombre = elCorrecto.nombre;
                        datosEmisor.especialidad = elCorrecto.rubro || datosEmisor.especialidad;
                    } else if (!elCorrecto) {
                        console.log(`🤔 En ${from} hay ${enEsaLinea.length} técnicos [${nombres}] y ninguno es de "${rubroActivoDelCaso}". Se deja "${datosEmisor.nombre}".`);
                    }
                } else {
                    // Sin caso no hay rubro con qué desempatar. Llamarlo por un nombre elegido al
                    // azar entre varios es peor que no nombrarlo: se marca para que el saludo no
                    // use el nombre.
                    datosEmisor.nombreIncierto = true;
                    console.log(`⚠️ En ${from} hay ${enEsaLinea.length} técnicos [${nombres}] y todavía no hay caso que diga cuál es. No se lo va a llamar por su nombre.`);
                }
            }
        } catch (e) {
            console.error('Error resolviendo cuál de los técnicos de esa línea escribe:', e.message);
        }

        // ¿El técnico está confirmando la visita? Si confirma, hay que dejar constancia y frenar
        // los recordatorios. Antes no se registraba en ningún lado: el técnico confirmaba, le
        // seguían llegando avisos pidiéndole la confirmación que ya había dado, y cuando el vecino
        // preguntaba a qué hora venía, Marcos contestaba "estoy consultando con el técnico"
        // teniendo la respuesta hacía rato. Para el vecino eso es una mentira lisa y llana.
        try {
            const { interpretarRespuestaTecnico, cancelarEscalacionProveedor } = require('./agentes/marcos-ops');
            const lectura = await interpretarRespuestaTecnico({ mensaje: msgBody });

            if (lectura.confirma) {
                stProv.confirmacion = {
                    confirmado: true,
                    eta: lectura.eta || '',
                    cuando: fechaHoraAR(),
                    tecnico: datosEmisor.nombre || ''
                };
                // Se informa lo que realmente pasó: antes decía "Recordatorios cancelados" siempre,
                // aunque no hubiera cancelado ninguno, y por eso el aviso de "el técnico no
                // contestó" seguía saliendo sin que el log lo delatara.
                const frenados = cancelarEscalacionProveedor(from);
                console.log(`✅ El técnico ${datosEmisor.nombre} confirmó la visita${lectura.eta ? ` (${lectura.eta})` : ''}. ` +
                    (frenados > 0 ? `Recordatorios cancelados (${frenados}).` : `No había recordatorios pendientes que frenar.`));

                // Confirmar no es haber ido. Se agenda un control para después del plazo que dio:
                // antes, con la confirmación se cancelaba el temporizador y nadie volvía a
                // preguntar nunca -- si el técnico se olvidaba, el caso quedaba abierto para
                // siempre sin que nadie se enterara. Queda guardado en el caso, no en memoria, así
                // que un reinicio no lo pierde.
                const idCasoConf = stProv.eventoActivoId;
                if (idCasoConf) {
                    // La confirmación va al CASO, no solo a la memoria del proceso. Guardarla solo
                    // en RAM hacía que un `pm2 restart` la borrara y Marcos volviera a decirle al
                    // vecino "estoy consultando con el técnico" teniendo la respuesta hacía rato.
                    try {
                        const { guardarConfirmacionTecnico } = require('./datos');
                        await guardarConfirmacionTecnico({
                            id_evento: idCasoConf,
                            eta: lectura.eta || '',
                            tecnico: datosEmisor.nombre || ''
                        });
                    } catch (e) { console.error('Error guardando la confirmación del técnico:', e.message); }

                    try {
                        const { programarSeguimiento } = require('./datos');
                        const { calcularPrimerControl } = require('./seguimiento');
                        await programarSeguimiento({
                            id_evento: idCasoConf,
                            cuando: calcularPrimerControl(lectura.eta),
                            paso: 1,
                            nota: lectura.eta ? `El técnico dijo: ${lectura.eta}` : 'Confirmó sin dar horario'
                        });
                    } catch (e) { console.error('Error programando el seguimiento de la visita:', e.message); }
                }

                // El vecino tiene que poder enterarse cuando pregunte, aunque no le mandemos un
                // aviso en ese momento.
                const telVecinoConf = stProv.vecinoActivo?.telefono;
                if (telVecinoConf) {
                    if (!global.marcosSesiones) global.marcosSesiones = new Map();
                    const sesV = global.marcosSesiones.get(String(telVecinoConf).replace(/\D/g, ''))
                        || global.marcosSesiones.get(String(telVecinoConf));
                    if (sesV) sesV.confirmacionTecnico = { ...stProv.confirmacion };
                }
            } else if (lectura.rechaza) {
                stProv.confirmacion = { confirmado: false, rechazado: true, cuando: fechaHoraAR() };
                console.log(`🚫 El técnico ${datosEmisor.nombre} no puede tomar el caso.`);
            }
        } catch (errConf) {
            console.error('Error interpretando la confirmación del técnico:', errConf.message);
        }

        // Buscar edificio del evento activo del proveedor (en RAM o Sheets EVENTOS)
        let edifDetectado = stProv.edificioActivo || stProv.vecinoActivo?.edificio;
        if (!edifDetectado) {
            try {
                const { buscarEdificioDeCasoAbiertoPorTecnico } = require('./datos-pg');
                edifDetectado = await buscarEdificioDeCasoAbiertoPorTecnico(datosEmisor.nombre);
            } catch (e) {
                console.error('Error buscando el edificio del proveedor en PostgreSQL:', e.message);
            }
        }
        // Respaldo contra la planilla, por si el caso todavía no llegó a la base.
        if (!edifDetectado) {
            try {
                const { getSheet } = require('./datos');
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
    const prefixEmisor = `${datosEmisor.rol === 'proveedor' ? 'Proveedor (' + datosEmisor.nombre + ')' : (datosEmisor.rol === 'encargado' ? 'Encargado' : 'Vecino')}: `;

    // `messageText` es lo que dijo el vecino en esta vuelta, con las etiquetas de sus adjuntos.
    // Se declara acá afuera porque más abajo se usa para redactarle la novedad al técnico: estaba
    // declarada adentro del `else`, así que cuando la ráfaga traía varios mensajes -- justo el caso
    // normal -- ese uso posterior tiraba "messageText is not defined" y cortaba la atención entera.
    let messageText = textoFinal;

    if (itemsRafaga && Array.isArray(itemsRafaga) && itemsRafaga.length > 1) {
        // Con varios mensajes en la tanda, lo que representa "lo que dijo" es el texto completo de
        // la ráfaga, no el del último mensaje suelto.
        messageText = msgBodyParaRegistro || textoFinal;
        for (const it of itemsRafaga) {
            let itText = it.texto || '';
            if (it.tipo === 'image' && imgUrl) {
                itText = `[IMAGEN:${imgUrl}]` + (itText && itText !== '(Imagen adjunta)' ? ' ' + itText : '');
            } else if (it.tipo === 'video' && videoUrl) {
                itText = `[VIDEO:${videoUrl}]` + (itText && itText !== '(Video adjunto)' ? ' ' + itText : '');
            } else if (it.tipo === 'audio' && (it.urlWeb || session.audio_url)) {
                const aUrl = it.urlWeb || session.audio_url;
                itText = `[AUDIO:${aUrl}]` + (itText && itText !== '(Nota de voz)' ? ' ' + itText : '');
            } else if (it.tipo === 'document' && (docUrl || media?.filePath)) {
                const fUrl = docUrl || `/archivos/${path.basename(media.filePath)}`;
                itText = `[DOCUMENTO:${fUrl}]` + (itText && !itText.includes('(Documento') ? ' ' + itText : (it.docFilename ? ` (Documento: ${it.docFilename})` : ''));
            }
            historial.push(`${prefixEmisor}${itText}`);
        }
    } else {
        if (msgType === 'image' && imgUrl) {
            messageText = `[IMAGEN:${imgUrl}]` + (textoFinal && textoFinal !== '(Imagen adjunta)' ? ' ' + textoFinal : '');
        } else if (msgType === 'video' && videoUrl) {
            messageText = `[VIDEO:${videoUrl}]` + (textoFinal && textoFinal !== '(Video adjunto)' ? ' ' + textoFinal : '');
        } else if (msgType === 'audio' && session.audio_url) {
            messageText = `[AUDIO:${session.audio_url}]` + (textoFinal && textoFinal !== '(Nota de voz)' ? ' ' + textoFinal : '');
        } else if (msgType === 'document' && (docUrl || media?.filePath)) {
            const fUrl = docUrl || `/archivos/${path.basename(media.filePath)}`;
            messageText = `[DOCUMENTO:${fUrl}]` + (textoFinal && !textoFinal.includes('(Documento') ? ' ' + textoFinal : ` (Documento adjunto)`);
        }

        // Los audios que vinieron en la misma ráfaga que una foto
        if (Array.isArray(audiosRafaga) && audiosRafaga.length > 0) {
            const yaEtiquetado = audiosRafaga.every(u => msgBodyParaRegistro.includes(u));
            if (yaEtiquetado && !audiosRafaga.every(u => messageText.includes(u))) {
                const adjuntoPrevio = messageText.match(/^\[(IMAGEN|VIDEO):[^\]]+\]/);
                messageText = (adjuntoPrevio ? adjuntoPrevio[0] + ' ' : '') + msgBodyParaRegistro;
            }
            if (!session.audio_url) session.audio_url = audiosRafaga[audiosRafaga.length - 1];
        }
        historial.push(`${prefixEmisor}${messageText}`);
    }
    while (historial.length > 30) historial.shift();

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
            const { marcarCasoResueltoPorId } = require('./datos');
            const resData = await marcarCasoResueltoPorId(casoElegido.id_evento);
            session.esperandoSeleccionCasoResuelto = null;
            const probLimpio = limpiarTextoProblema(casoElegido.problema);
            const probStr = probLimpio ? ` (${probLimpio})` : '';
            const confirmMsg = `✅ *RECLAMO SOLUCIONADO*\n\nExcelente, he marcado el caso *[${casoElegido.id_evento}]*${probStr} como *RESUELTO* en *${casoElegido.edificio || session.nombreEdificio || 'el edificio'}*.\n\n¡Muchas gracias por confirmarnos!`;
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

    // ── CONSULTA DE ESTADO POR NÚMERO DE CASO ────────────────────────────────────
    // "¿Cómo va el CASO-1001?". Se dispara solo con el código escrito de forma explícita: cualquier
    // detección más amplia se comería preguntas que ya tienen su propio camino, como la del horario
    // del técnico.
    //
    // La respuesta NO lleva importes. Lo que costó el arreglo es tema del administrador, que lo ve
    // en el panel; el encargado, la guardia o el personal de limpieza no tienen por qué enterarse
    // de los números del consorcio por WhatsApp.
    const codigoConsultado = (textoFinal.match(/\bCASO[\s-]?0*(\d{2,})\b/i) || [])[1];
    if (codigoConsultado && /\?|c[oó]mo|qu[eé] pas|estado|novedad|se resolvi|se soluciona|sigue|qued[oó]/i.test(textoFinal)) {
        try {
            const { buscarCasoPorCodigo } = require('./datos-pg');
            const caso = await buscarCasoPorCodigo(codigoConsultado);

            if (!caso) {
                await despacharRespuesta(recipient, `No encuentro ningún caso con ese número. ¿Me lo repetís tal como te llegó? Va con el formato *CASO-1001*.`, msgTypeRespuesta);
                return;
            }

            // Quién puede saber de este caso. El vecino, solo el suyo: el reclamo puede ser adentro
            // de otra unidad y no es asunto de un tercero. El personal del edificio y quien lo
            // administra, cualquiera de su edificio, que es justamente su trabajo.
            const mismoTelefono = String(caso.telefono || '').replace(/\D/g, '').endsWith(String(from).replace(/\D/g, '').slice(-8));
            const edificioPropio = String(session.nombreEdificio || datosEmisor.edificio || '').toLowerCase().trim();
            const mismoEdificio = edificioPropio && String(caso.edificio || '').toLowerCase().trim().includes(edificioPropio);
            const esDelEdificio = puedeVerVisitasDelEdificio(datosEmisor) && mismoEdificio;
            const esElTecnico = datosEmisor.rol === 'proveedor' && mismoEdificio;

            if (!mismoTelefono && !esDelEdificio && !esElTecnico) {
                await despacharRespuesta(recipient, `Ese caso no figura a tu nombre ni corresponde a tu edificio, así que no puedo darte el detalle. Si necesitás saber de un reclamo puntual, hablalo con la Administración.`, msgTypeRespuesta);
                console.log(`🔒 Consulta del [${caso.id_evento}] rechazada para ${from} (rol ${datosEmisor.rol}): no es su caso ni su edificio.`);
                return;
            }

            const detalleCaso = limpiarTextoProblema(caso.problema) || 'Sin detalle registrado';
            let resp = `*${caso.id_evento}* — ${caso.edificio || 'consorcio'}\n\n` +
                `📋 ${detalleCaso}\n`;

            if (caso.cerrado) {
                resp += `\n✅ Estado: *RESUELTO*.`;
            } else {
                resp += `\n🔄 Estado: *en curso*.`;
                if (caso.tecnico) resp += `\n🔧 Técnico asignado: ${caso.tecnico}.`;
                if (caso.confirmado) {
                    resp += caso.eta
                        ? `\n🕒 Confirmó que llega: ${caso.eta}.`
                        : `\n🕒 El técnico confirmó la visita.`;
                } else if (caso.tecnico) {
                    resp += `\n🕒 Todavía no confirmó horario de llegada.`;
                }
            }

            console.log(`📄 Consulta de estado del [${caso.id_evento}] respondida a ${from} (rol ${datosEmisor.rol}).`);
            await despacharRespuesta(recipient, resp, msgTypeRespuesta);
            return;
        } catch (e) {
            console.error('Error respondiendo la consulta de estado del caso:', e.message);
        }
    }

    // "El técnico ya vino y resolvió" no entraba: el patrón pedía "resuelto" y la gente conjuga el
    // verbo, con acento. Lo mismo con "lo solucionó", "ya lo arreglaron" o "ya finalicé".
    const diceQueSeResolvio = /solucionad|solucion[oó]|resuelt|resolv[ií]|trabajo.*terminad|trabajo.*realizad|listo.*trabajo|ya qued. arreglad|ya qued. listo|ya arreglaron|ya lo arregl|ya vino y (lo )?(arregl|solucion|repar|resolv)|ya funciona|ya lo repar|ya finalic|ya termin[eé]/i.test(textoFinal);
    // "Todavía no se resolvió" trae las mismas palabras que "ya se resolvió" y significa lo
    // contrario. Cerrar un caso que sigue roto es peor que no cerrarlo: el vecino se queda sin
    // reclamo abierto justo cuando más lo necesita.
    const loNiega = /\bno\s+(se\s+|me\s+|lo\s+|la\s+)*(qued|resolv|solucion|arregl|funciona|anda|termin|finaliz|vino|pas[oó])/i.test(textoFinal);
    const esGatilloResolucion = diceQueSeResolvio && !loNiega;

    if (esGatilloResolucion) {
        // `session.nombreEdificio` para el vecino recién se completa más abajo en esta misma
        // función (línea ~1358). Si esta es la primera respuesta de una sesión nueva -- lo típico
        // es que el seguimiento automático haya despertado al vecino horas después, con un
        // `pm2 restart` de por medio que vació `global.marcosSesiones` -- acá todavía está vacío.
        //
        // Eso no es solo un "undefined" cosmético: `obtenerCasosAbiertosEdificio('')` no filtra por
        // edificio y trae TODOS los casos abiertos del sistema. Con un solo caso abierto en toda la
        // base -- común en pruebas -- el de otro edificio se cerraría por error.
        //
        // `vecinosEnSheets` ya se resolvió más arriba (línea ~925) y es un dato durable, no de
        // sesión: se usa como respaldo antes de tocar la base de casos.
        const edificioParaCierre = session.nombreEdificio || vecinosEnSheets?.[0]?.edificio || datosEmisor?.edificio || '';

        const { obtenerCasosAbiertosEdificio, marcarCasoResueltoPorId } = require('./datos');
        const casosAbiertos = await obtenerCasosAbiertosEdificio(edificioParaCierre);

        if (casosAbiertos.length === 0) {
            await despacharRespuesta(recipient, `Muchas gracias por avisar. En *${edificioParaCierre || 'el consorcio'}* no tenemos reclamos pendientes abiertos en este momento.`, msgTypeRespuesta);
            return;
        } else if (casosAbiertos.length === 1) {
            const cUnico = casosAbiertos[0];
            const resData = await marcarCasoResueltoPorId(cUnico.id_evento);
            // El nombre del edificio sale del CASO, no de la sesión: es el dato que efectivamente
            // se resolvió, y sobrevive aunque la sesión llegara vacía.
            const probLimpio = limpiarTextoProblema(cUnico.problema);
            const probStr = probLimpio ? ` (${probLimpio})` : '';
            const confirmMsg = `✅ *RECLAMO SOLUCIONADO*\n\nExcelente, he marcado el caso *[${cUnico.id_evento}]*${probStr} como *RESUELTO* en *${cUnico.edificio || edificioParaCierre || 'el edificio'}*.\n\n¡Muchas gracias por tu confirmación!`;
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
                const probLimpio = limpiarTextoProblema(coincidenciaDirecta.problema);
                const probStr = probLimpio ? ` (${probLimpio})` : '';
                const confirmMsg = `✅ *RECLAMO SOLUCIONADO*\n\nExcelente, asocié tu mensaje al caso *[${coincidenciaDirecta.id_evento}]*${probStr} y lo he marcado como *RESUELTO* en *${coincidenciaDirecta.edificio || session.nombreEdificio || 'el edificio'}*.\n\nLos demás reclamos del edificio continúan en curso.`;
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
                    const pLimpio = limpiarTextoProblema(c.problema);
                    listaOpciones += `${idx + 1}️⃣ *[${c.id_evento}]*: ${pLimpio} (Depto: ${c.depto || '—'})\n`;
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
        // El adjunto ya quedó retenido en FASE 0, así que este corte no lo pierde.
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
    // ── ¿ES UNA CONSTANCIA DE DATOS BANCARIOS? ───────────────────────────────────────────
    //
    // Los datos de cobro llegan por texto, por foto o por PDF -- la captura del homebanking o la
    // constancia de CBU. Nunca por audio. Se atiende ANTES que las facturas porque para el
    // detector de facturas un PDF mandado por un técnico es un comprobante, y una constancia de
    // CBU terminaba archivada como si fuera un gasto del consorcio.
    //
    // Con OCR de por medio la verificación de los dígitos importa todavía más que al tipear: un 8
    // leído como 6 en una foto sacada de costado no lo ve nadie, y son 22 números seguidos.
    if (datosEmisor.rol === 'proveedor' && datosFactura?.es_datos_bancarios && !datosFactura?.es_factura) {
        try {
            const { validarCBU, validarAlias, ultimos4 } = require('./cbu');
            const { guardarDatosBancariosProveedor } = require('./datos');

            const cbuLeido = datosFactura.cbu ? validarCBU(datosFactura.cbu) : null;
            const aliasLeido = datosFactura.alias ? validarAlias(datosFactura.alias) : null;

            // Si el CBU no verifica, casi seguro es el OCR y no el papel. No se guarda a medias:
            // se pide el alias, que es corto y se lee bien.
            if (cbuLeido && !cbuLeido.valido && !aliasLeido?.valido) {
                const resp = `Recibí la constancia pero el CBU no me quedó claro (${cbuLeido.motivo}). ` +
                    `¿Me lo escribís acá en un mensaje, o me pasás el *alias*? Prefiero preguntarte antes que anotar un número mal.`;
                await despacharRespuesta(recipient, resp, msgTypeRespuesta);
                historial.push(`Marcos: ${resp}`);
                return;
            }

            const guardado = await guardarDatosBancariosProveedor({
                nombre: datosEmisor.nombreIncierto ? '' : datosEmisor.nombre,
                telefono: from,
                cbu: cbuLeido?.valido ? cbuLeido.cbu : '',
                alias: aliasLeido?.valido ? aliasLeido.alias : '',
                titular: datosFactura.titular || '',
                cuit: datosFactura.cuit || '',
            });

            if (guardado.ambiguo) {
                const cuales = (guardado.candidatos || []).map(c => `*${c.nombre}*${c.rubro ? ` (${c.rubro})` : ''}`).join(' o ');
                const resp = `Con este número tengo cargado a ${cuales}. ¿A nombre de cuál de los dos anoto estos datos para el cobro?`;
                await despacharRespuesta(recipient, resp, msgTypeRespuesta);
                historial.push(`Marcos: ${resp}`);
                return;
            }

            let resp;
            if (!guardado.ok) {
                resp = `Recibí la constancia pero no pude guardarla ahora. Se la paso igual a la Administración.`;
            } else if (guardado.pendiente) {
                resp = `Recibí la constancia. Como ya tenía otros datos de cobro tuyos, este cambio lo tiene que confirmar la Administración antes de quedar activo — es el resguardo para que a nadie le desvíen un pago haciéndose pasar por vos. Ya les avisé.`;
                try {
                    const { avisarAlAdministrador } = require('./agentes/marcos-admin');
                    const colaTec = global.colasProveedores?.get(String(from).replace(/\D/g, ''));
                    const edificioAviso = colaTec?.edificioActivo || session.nombreEdificio || '';
                    if (edificioAviso) {
                        await avisarAlAdministrador({
                            edificio: edificioAviso,
                            motivo: 'un proveedor mandó una constancia con datos de cobro distintos',
                            titulo: `🔐 MARCOS: PEDIDO DE CAMBIO DE CBU - ${guardado.nombre}`,
                            cuerpo:
                                `El proveedor *${guardado.nombre}* mandó una constancia con datos de cobro distintos a los que tenía.\n\n` +
                                `📱 Desde el teléfono: ${from}\n` +
                                `🏦 Tenía: ${guardado.anterior.cbu ? 'CBU ...' + ultimos4(guardado.anterior.cbu) : ''}${guardado.anterior.alias ? ` / alias ${guardado.anterior.alias}` : ''}\n` +
                                `🆕 Pide:  ${guardado.nuevo.cbu ? 'CBU ...' + ultimos4(guardado.nuevo.cbu) : ''}${guardado.nuevo.alias ? ` / alias ${guardado.nuevo.alias}` : ''}\n` +
                                (datosFactura.titular ? `👤 Titular en la constancia: ${datosFactura.titular}\n` : '') +
                                `\n⚠️ NO se aplicó. La cuenta anterior sigue vigente hasta que usted lo apruebe desde el panel.\n\n` +
                                `Antes de aprobarlo, confírmelo con el proveedor por un canal que ya conocía — llamándolo al número de siempre, no respondiendo a este mensaje.`,
                            phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                            accessToken: WHATSAPP_ACCESS_TOKEN,
                        });
                    }
                } catch (e) {
                    console.error('Error avisando el cambio de CBU a la Administración:', e.message);
                }
            } else {
                // Se repite lo leído para que un error del OCR salte acá y no en el pago.
                const partes = [];
                if (cbuLeido?.valido) partes.push(`CBU terminado en *${ultimos4(cbuLeido.cbu)}*`);
                if (aliasLeido?.valido) partes.push(`alias *${aliasLeido.alias}*`);
                if (datosFactura.titular) partes.push(`a nombre de *${datosFactura.titular}*`);
                resp = partes.length
                    ? `Recibí la constancia y anoté: ${partes.join(', ')}. Si algo de eso no coincide, avisame y lo corrijo.`
                    : `Recibí la constancia, pero no pude leer ni el CBU ni el alias. ¿Me los escribís acá en un mensaje?`;
            }

            await despacharRespuesta(recipient, resp, msgTypeRespuesta);
            historial.push(`Marcos: ${resp}`);
            return;
        } catch (e) {
            console.error('Error procesando la constancia de datos bancarios:', e.message);
        }
    }

    // ── ¿ESTO ES UNA FACTURA? ────────────────────────────────────────────────────────────
    //
    // Se decide ANTES de separar por rol, porque una factura no la manda solo el técnico. El
    // vecino o el encargado llaman a un electricista por su cuenta, el trabajo se hace, y el
    // comprobante se lo mandan a Marcos para que la Administración lo tenga. Ese técnico puede
    // no figurar en ninguna lista: es nuevo para el edificio, y no por eso el gasto deja de
    // existir. Cuando esto vivía adentro de la rama de proveedor, esa factura no se registraba
    // en ningún lado -- Marcos la leía como un reclamo más.
    const txtLowFactura = (msgBody || '').toLowerCase();
    const loMandaElTecnico = datosEmisor.rol === 'proveedor';
    const parecePreguntaSinAdjunto = !media && /\?|qui[eé]n|c[oó]mo|cu[aá]ndo|d[oó]nde|puedo|debo|hay que/i.test(txtLowFactura);

    // El listón es distinto según quién manda, y tiene que serlo: para un técnico casi cualquier
    // adjunto es un comprobante, pero para un vecino la foto de una pérdida de agua es un
    // RECLAMO. Tratarla como factura le robaría el reclamo. Por eso, cuando no lo manda el
    // técnico, hace falta un adjunto Y que el lector de documentos diga que es una factura (o
    // que la palabra esté escrita).
    const esFacturaODoc = !parecePreguntaSinAdjunto && (loMandaElTecnico
        ? (
            Boolean(datosFactura?.es_factura) ||
            /factura|comprobante|recibo|pago|cobro|remito|cbu|transferencia/i.test(txtLowFactura) ||
            (media && (msgType === 'document' || msgType === 'image') && !/foto|video|cerradura|especifi|aclarar|ver/.test(txtLowFactura))
          )
        : (
            Boolean(media) && (msgType === 'document' || msgType === 'image') &&
            (Boolean(datosFactura?.es_factura) || /factura|comprobante|recibo|remito/i.test(txtLowFactura))
          )
    );

    // Que un comprobante no se haya tomado como tal tiene que verse. Cuando pasa, la factura no
    // se archiva y no queda en el chat del proveedor: desde afuera es indistinguible de "Marcos la
    // tiró a la basura", y sin esta línea no hay forma de saber cuál de las condiciones falló.
    if (!esFacturaODoc && (media || loMandaElTecnico)) {
        console.log(
            `🧾❔ NO se trató como factura un mensaje de ${datosEmisor.nombre || from} (${datosEmisor.rol}). ` +
            `adjunto=${media ? msgType : 'no'} · el lector dice factura=${Boolean(datosFactura?.es_factura)} · ` +
            `parece pregunta suelta=${parecePreguntaSinAdjunto} · texto="${String(msgBody || '').slice(0, 80)}"`
        );
    }

    if (esFacturaODoc) {
        console.log(`🧾 Mensaje de ${datosEmisor.nombre || from} (${datosEmisor.rol}) tomado como comprobante. Buscando a qué edificio imputarlo...`);
        // ── A QUÉ EDIFICIO PERTENECE ESTA FACTURA ────────────────────────────────────────
        //
        // REGLA DE ORO: el edificio NUNCA sale de la dirección impresa en el comprobante.
        //
        // El papel lleva la dirección de FACTURACIÓN -- el estudio del administrador, o el
        // domicilio fiscal del propio técnico -- y no la del trabajo. Antes esa dirección era
        // el último recurso, y como el técnico factura días después (cuando la conversación ya
        // no existe y su caso ya está cerrado), en los hechos era la que ganaba SIEMPRE. Visto
        // en producción: una factura por un trabajo en "SAN PATRICIO 159" abrió un evento
        // fantasma en "san patricio 270", que es lo que decía el encabezado del PDF.
        //
        // El orden ahora va de lo más explícito a lo más deducido, y CUALQUIERA de los
        // resultados se valida contra la cartera del técnico. Si no se llega a nada, se
        // pregunta: adivinar mal le imputa el gasto al consorcio equivocado, que es peor que
        // preguntar.
        // Y NUNCA sale del administrador de la factura ANTERIOR. Un técnico no le pertenece a
        // un administrador: el mismo electricista atiende 11 administradores desde un solo
        // número, y en una tanda manda 3 facturas de uno, 2 de otro y 1 de un tercero. Por eso
        // acá no se arrastra nada del mensaje previo -- cada comprobante se resuelve solo, y
        // ante la menor duda se pregunta en lugar de deducir.
        const { edificiosDelProveedor, buscarCasosRecientesPorTecnico, buscarCasoPorCodigo } = require('./datos');

        // Quién hizo el trabajo. Si el comprobante lo manda el propio técnico, es él. Si lo manda
        // el vecino o el encargado, el técnico es el que figura en el papel -- y puede no estar en
        // ninguna lista, porque lo llamaron por su cuenta y es nuevo para el edificio. Que no
        // figure NO es motivo para descartar la factura: el gasto existe igual y la Administración
        // lo tiene que ver.
        const nombreTecnicoFactura = loMandaElTecnico
            ? (datosEmisor.nombre || 'Proveedor')
            : String(datosFactura?.proveedor || '').trim();
        const tecnicoEsConocido = loMandaElTecnico || Boolean(nombreTecnicoFactura);

        // La cartera del técnico, con el administrador de cada edificio. OJO: vacía significa
        // "no pude averiguarla" (la copia en PostgreSQL puede estar incompleta, o la planilla
        // no respondió), NO "no atiende ningún edificio". Con la cartera vacía no se rechaza
        // nada -- se sigue de largo y, como mucho, se termina preguntando.
        //
        // Solo tiene sentido cuando escribe el técnico. Si la manda un vecino, el edificio no hay
        // que deducirlo de ninguna cartera: es el suyo, el que Marcos ya identificó para atenderlo.
        let cartera = [];
        if (loMandaElTecnico) {
            try {
                cartera = await edificiosDelProveedor({ nombre: datosEmisor.nombre, telefono: from }) || [];
            } catch (e) {
                console.error('No se pudo leer la cartera de edificios del proveedor:', e.message);
            }
        }
        const puedeValidar = cartera.length > 0;
        const enCartera = nombre => {
            if (!puedeValidar) return true;
            const n = normalizarTextoEdificio(nombre);
            if (!n) return false;
            return cartera.some(c => {
                const cn = normalizarTextoEdificio(c.edificio);
                return cn === n || cn.includes(n) || n.includes(cn);
            });
        };
        const clienteDe = nombre => {
            const n = normalizarTextoEdificio(nombre);
            const fila = cartera.find(c => normalizarTextoEdificio(c.edificio) === n);
            return fila?.cliente || '';
        };

        let edificioFactura = '';
        let idCasoFactura = '';
        let comoSeSupo = '';
        let candidatos = [];

        // 1. EXPLÍCITO: el técnico citó el caso ("mando la factura del CASO-1001"). Es lo más
        //    confiable que puede pasar, y por eso vale la pena pedírselo aunque no siempre lo
        //    vaya a hacer.
        const codigoEnFactura = (textoFinal.match(/\bCASO[\s-]?0*(\d{2,})\b/i) || [])[1];
        if (codigoEnFactura) {
            try {
                const caso = await buscarCasoPorCodigo(codigoEnFactura);
                if (caso?.edificio && enCartera(caso.edificio)) {
                    edificioFactura = caso.edificio;
                    idCasoFactura = caso.id_evento || '';
                    comoSeSupo = `el técnico citó el ${caso.id_evento}`;
                } else if (caso?.edificio) {
                    console.log(`🔒 El ${caso.id_evento} es de "${caso.edificio}", que no está en la cartera de ${datosEmisor.nombre}. No se usa.`);
                }
            } catch (e) {
                console.error('Error buscando el caso citado en la factura:', e.message);
            }
        }

        // 2. EXPLÍCITO: el edificio que quien escribe nombró EN SU MENSAJE (no en el papel).
        const edifDetectadoTexto = buscarEdificioEnTexto(msgClean, edificiosConocidos);
        if (!edificioFactura && edifDetectadoTexto?.nombre && enCartera(edifDetectadoTexto.nombre)) {
            edificioFactura = edifDetectadoTexto.nombre;
            comoSeSupo = 'lo nombró en el mensaje';
        }

        // 2-bis. NO LO MANDA EL TÉCNICO: el edificio es el de quien escribe, y punto.
        //
        // Acá no hay nada que deducir ni contra qué validar. Un vecino manda la factura del
        // electricista que llamó por su cuenta: el trabajo fue en SU edificio, que es el que
        // Marcos ya identificó para poder atenderlo. Lo mismo el encargado o la guardia.
        if (!edificioFactura && !loMandaElTecnico) {
            const suEdificio = session.nombreEdificio || datosEmisor.edificio || '';
            if (suEdificio) {
                edificioFactura = suEdificio;
                comoSeSupo = `es el edificio de quien la manda (${datosEmisor.rol})`;
            }
        }

        // 3. DEDUCIDO, y solo si no hay ambigüedad: sus casos de los últimos 30 días, abiertos
        //    o ya cerrados. La ventana de 30 días es lo que resuelve el caso normal -- el
        //    trabajo se hizo, el caso se cerró, y la factura llega una semana después.
        //
        //    Con UN solo candidato se usa. Con varios NO se elige el más reciente: para un
        //    técnico de varios administradores, "el último caso" y "el de esta factura" son
        //    cosas distintas, y acertar sería casualidad. Se le pregunta mostrándole la lista.
        if (!edificioFactura && loMandaElTecnico) {
            try {
                const recientes = (await buscarCasosRecientesPorTecnico(datosEmisor.nombre, from, 30)) || [];
                candidatos = recientes.filter(c => c.edificio && enCartera(c.edificio));

                // El caso que Marcos le despachó y sigue vivo en esta conversación desguaza el
                // empate: es un caso concreto, no "el edificio del que venimos hablando".
                const telTechFactura = String(from).replace(/\D/g, '');
                const casoEnCurso = global.colasProveedores?.get(telTechFactura)?.eventoActivoId || '';
                const elEnCurso = casoEnCurso && candidatos.find(c => c.id_evento === casoEnCurso);

                if (elEnCurso) {
                    edificioFactura = elEnCurso.edificio;
                    idCasoFactura = elEnCurso.id_evento;
                    comoSeSupo = `el caso que está atendiendo en esta conversación (${elEnCurso.id_evento})`;
                } else if (candidatos.length === 1) {
                    // ── UN SOLO CASO NO ES UNA RESPUESTA PARA SIEMPRE ────────────────────────
                    //
                    // Que el técnico tenga un único caso reciente hace razonable imputarle AHÍ su
                    // primera factura. Pero si ese caso YA tiene su comprobante, la que llega
                    // ahora es de otro trabajo -- uno que Marcos no vio, porque lo coordinó el
                    // encargado o el propio vecino.
                    //
                    // Sin este chequeo pasaba lo que se ve en el chat: dos facturas distintas,
                    // con números distintos, las dos "asociadas al CASO-1001", y el panel
                    // mostrando los dos montos sumados en el mismo consorcio. Con un técnico que
                    // trabaja para once administradores eso está garantizado: manda seis
                    // comprobantes y los seis se pegan al mismo caso.
                    const { casoYaTieneFactura } = require('./datos');
                    const yaTiene = await casoYaTieneFactura(candidatos[0].id_evento);

                    if (yaTiene) {
                        console.log(`🧾 ${datosEmisor.nombre} tiene un solo caso reciente (${candidatos[0].id_evento}) pero ESE CASO YA TIENE SU FACTURA. Esta es de otro trabajo: se le pregunta en vez de pegarla ahí.`);
                    } else {
                        edificioFactura = candidatos[0].edificio;
                        idCasoFactura = candidatos[0].id_evento || '';
                        comoSeSupo = `su único caso reciente (${candidatos[0].id_evento}${candidatos[0].cerrado ? ', ya cerrado' : ''})`;
                    }
                } else if (candidatos.length > 1) {
                    console.log(`🤔 ${datosEmisor.nombre} tiene ${candidatos.length} casos recientes en edificios distintos. No se adivina de cuál es la factura: se le pregunta.`);
                }
            } catch (e) {
                console.error('Error buscando los casos recientes del técnico:', e.message);
            }
        }

        // 4. Si la única pista que quedaba era la dirección del comprobante, se deja constancia
        //    de por qué NO se usó. Es el dato que causaba los eventos fantasma.
        const edificioDelPapel = datosFactura?.edificio || '';
        if (!edificioFactura && edificioDelPapel) {
            console.log(`🧾 La dirección del comprobante ("${edificioDelPapel}") no se usa como edificio del trabajo: es la de facturación. Se le pregunta al técnico.`);
        }

        if (edificioFactura) {
            const cli = clienteDe(edificioFactura);
            console.log(`🧾 Factura de ${nombreTecnicoFactura || 'técnico sin identificar'} imputada a "${edificioFactura}"${cli ? ` (administrador: ${cli})` : ''} — se supo por ${comoSeSupo}.`);
        }

        // Se declara afuera del if porque más abajo se usa para armar el link del comprobante
        // en el chat del proveedor. Declarado adentro, ese uso posterior rompía la respuesta
        // entera justo cuando el técnico mandaba la factura.
        let resEstFactura = null;
        if (media?.filePath) {
            resEstFactura = guardarArchivoEstructurado({
                filePath: media.filePath,
                adminNombre: perfilEdificio?.adminNombre,
                edificioNombre: edificioFactura || 'Sin imputar',
                tipo: 'facturas'
            });
            if (resEstFactura && datosFactura) {
                datosFactura.url_archivo = resEstFactura.relativeUrl;
            }
        }

        // ── EL CBU AL PIE DE LA PROPIA FACTURA ───────────────────────────────────────────
        //
        // Es la forma más común de todas: la factura trae abajo "CBU / Alias para el pago". Se
        // aprovecha, con la misma verificación y el mismo resguardo que cuando lo mandan aparte
        // -- si ya había otro cargado, esto NO lo pisa, queda pendiente de aprobación.
        //
        // Solo cuando la manda el propio técnico. Si la reenvía el vecino o el encargado, el CBU
        // del papel no se toma: por ahí es una factura vieja, reenviada, o de otro proveedor.
        if (loMandaElTecnico && (datosFactura?.cbu || datosFactura?.alias)) {
            try {
                const { validarCBU, validarAlias } = require('./cbu');
                const cbuPapel = datosFactura.cbu ? validarCBU(datosFactura.cbu) : null;
                const aliasPapel = datosFactura.alias ? validarAlias(datosFactura.alias) : null;

                if (cbuPapel?.valido || aliasPapel?.valido) {
                    const { guardarDatosBancariosProveedor } = require('./datos');
                    const guardadoBanco = await guardarDatosBancariosProveedor({
                        nombre: datosEmisor.nombreIncierto ? '' : datosEmisor.nombre,
                        telefono: from,
                        cbu: cbuPapel?.valido ? cbuPapel.cbu : '',
                        alias: aliasPapel?.valido ? aliasPapel.alias : '',
                        titular: datosFactura.titular || '',
                        cuit: datosFactura.cuit || '',
                    });
                    if (guardadoBanco.pendiente) {
                        console.log(`🔐 La factura de ${datosEmisor.nombre} trae datos de cobro distintos a los cargados. Quedan PENDIENTES de aprobación.`);
                    } else if (guardadoBanco.ok) {
                        console.log(`🏦 Datos de cobro tomados del pie de la factura de ${datosEmisor.nombre}.`);
                    }
                } else if (cbuPapel && !cbuPapel.valido) {
                    // No se guarda un CBU que no verifica, pero tampoco se frena la factura por
                    // eso: el comprobante vale igual. Queda en el log para poder pedirlo bien.
                    console.log(`⚠️ El CBU que trae la factura no verifica (${cbuPapel.motivo}). No se guarda.`);
                }
            } catch (e) {
                console.error('Error tomando los datos de cobro del pie de la factura:', e.message);
            }
        }


        // ── LO QUE ESCRIBIÓ QUIEN MANDA LA FACTURA ───────────────────────────────────────
        //
        // Se calcula ANTES de guardar nada, porque este texto es lo más valioso del mensaje y no
        // se puede perder en ningún camino. Es donde viene la indicación que después hace falta:
        // "hasta acá llegué, hay que llamar al plomero para que siga". Si eso no queda escrito en
        // ningún lado, dentro de dos meses el problema se repite, el técnico dice que ya había
        // avisado, y la Administración no tiene con qué saber si es cierto.
        //
        // Ojo con los rellenos: un documento sin epígrafe viaja como
        // "(Documento adjunto: factura_1234.pdf)". Ese texto no lo escribió nadie, pero pasa
        // los 20 caracteres de sobra -- sin sacarlo, cada PDF suelto contaría como
        // "explicación" y abriría un evento titulado con el nombre del archivo.
        // La versión LEGIBLE, que es la que se guarda y la que va a leer el administrador: se le
        // sacan los rellenos automáticos pero se respeta lo que la persona escribió, con su
        // puntuación. Es la prueba de lo que se avisó y cuándo.
        const notaDeQuienEnvia = String(textoFinal || '')
            .replace(/\((?:imagen|documento|comprobante|video|nota de voz)[^)]*\)/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // La versión NORMALIZADA, que solo se usa para medir si hay contenido real. Acá sí se
        // arrasa con todo (puntuación, nombres de archivo, cortesías) porque no se guarda: lo
        // único que interesa es si queda algo que valga la pena registrar.
        const textoPropio = notaDeQuienEnvia
            .replace(/\bCASO[\s-]?0*\d{2,}\b/ig, ' ')
            .replace(/\b\S+\.(pdf|jpe?g|png|docx?|xlsx?|webp|heic)\b/ig, ' ')
            .replace(/factura|comprobante|recibo|remito|adjunto|hola|buenas|gracias/ig, ' ')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const explicaElTrabajo = textoPropio.length >= 20;

        // ── ¿EL TRABAJO QUEDÓ POR LA MITAD? ──────────────────────────────────────────────
        //
        // "Hasta acá llegué, hay que llamar al plomero para que siga con lo que falta." Eso NO es
        // el cierre de un caso: es un pase a otro gremio, y el caso tiene que quedar ABIERTO y
        // llegarle a la Administración. Si se archiva como resuelto, dentro de dos meses el
        // problema vuelve, el técnico dice "yo ya había avisado" y nadie puede confirmarlo.
        //
        // Esto encaja con la regla de cuándo se avisa al administrador: no en cada evento, sino
        // cuando el técnico NO terminó de resolver el problema por completo.
        //
        // Ojo con los `\b` al final de una palabra acentuada: en JavaScript el borde de palabra es
        // ASCII, así que "llegué." no tiene borde entre la "é" y el punto y el patrón no engancha.
        // Por eso acá los remates acentuados van SIN `\b` -- "hasta acá llegué" es exactamente la
        // forma en que un técnico avisa que su parte terminó, y perderla era perder el aviso.
        const quedoPorLaMitad = /\b(hay que|habr[ií]a que|tienen que|tendr[ií]an que|deber[ií]an)\s+(llamar|mandar|convocar|contratar|coordinar|buscar|conseguir)\b/i.test(notaDeQuienEnvia)
            || /\b(falta|faltar[ií]a|queda pendiente|no termin|sin terminar|a medias|parcial|provisorio|provisional|de urgencia)\b/i.test(notaDeQuienEnvia)
            || /\bhasta (ac[aá]|aqu[ií]) (llegu[eé]|puedo|pude|llego)/i.test(notaDeQuienEnvia)
            || /\bno me corresponde|\bno es (lo )?m[ií]o|\bes trabajo de|\bcontin[uú]e otro|\bque siga (el|otro)/i.test(notaDeQuienEnvia)
            || /\b(lo dem[aá]s|el resto)\b[^.]{0,20}\bes (de|del)\b/i.test(notaDeQuienEnvia)
            || /\b(otro|un)\s+(gremio|rubro|especialista)\b/i.test(notaDeQuienEnvia);

        // Qué oficio hay que llamar, si lo dijo. Sirve para que el aviso a la Administración sea
        // accionable ("hace falta un plomero") en vez de un genérico "quedó algo pendiente".
        const gremioQueFalta = (notaDeQuienEnvia.match(/\b(plomer[oa]|gasista|electricista|cerrajer[oa]|albañil|albanil|pintor|herrer[oa]|techista|vidrier[oa]|carpinter[oa]|refrigeraci[oó]n|ascensorista)\b/i) || [])[1] || '';

        if (quedoPorLaMitad) {
            console.log(`⚠️ El trabajo quedó incompleto según ${nombreTecnicoFactura || datosEmisor.rol}${gremioQueFalta ? ` — hace falta un ${gremioQueFalta}` : ''}: "${notaDeQuienEnvia.slice(0, 120)}"`);
        }

        // ── UN TÉCNICO QUE NO ESTÁ EN NINGUNA LISTA ──────────────────────────────────────
        //
        // Pasa seguido: el encargado llama a un plomero por su cuenta, el trabajo se hace, y el
        // plomero le escribe a Marcos para pasar la factura. Ese número no está cargado, así que
        // llega como "vecino" y ninguno de los caminos de cobro lo atiende.
        //
        // El trabajo y la factura se registran igual -- son un antecedente y no mueven plata.
        // Los datos de cobro NO se activan: acá la identidad es un teléfono desconocido, y
        // aceptar un CBU así es exactamente cómo funciona el fraude ("soy el plomero que arregló
        // lo del 3°B, pagame acá"). Quedan pendientes y la Administración decide.
        //
        // Se distingue del vecino que reenvía la factura de su plomero: ese SÍ está en `vecinos`.
        const esNumeroDesconocido = !loMandaElTecnico
            && datosEmisor.rol === 'vecino'
            && (vecinosEnSheets || []).length === 0
            && !session.datosVecino;

        if (esNumeroDesconocido && (datosFactura?.cbu || datosFactura?.alias)) {
            try {
                const { validarCBU, validarAlias, ultimos4 } = require('./cbu');
                const cbuNuevo = datosFactura.cbu ? validarCBU(datosFactura.cbu) : null;
                const aliasNuevo = datosFactura.alias ? validarAlias(datosFactura.alias) : null;

                if (cbuNuevo?.valido || aliasNuevo?.valido) {
                    const { registrarProveedorNoVerificado } = require('./datos');
                    const alta = await registrarProveedorNoVerificado({
                        nombre: nombreTecnicoFactura || '',
                        telefono: from,
                        rubro: datosFactura?.concepto || '',
                        cliente: clienteDe(edificioFactura) || '',
                        cbu: cbuNuevo?.valido ? cbuNuevo.cbu : '',
                        alias: aliasNuevo?.valido ? aliasNuevo.alias : '',
                        titular: datosFactura.titular || '',
                        cuit: datosFactura.cuit || '',
                    });

                    if (alta.ok && edificioFactura) {
                        const { avisarAlAdministrador } = require('./agentes/marcos-admin');
                        await avisarAlAdministrador({
                            edificio: edificioFactura,
                            motivo: 'un técnico que no está en la lista mandó una factura con datos de cobro',
                            titulo: `🆕 MARCOS: TÉCNICO DESCONOCIDO CON FACTURA - ${edificioFactura}`,
                            cuerpo:
                                `Un número que no figura en su lista de proveedores mandó una factura por un trabajo ` +
                                `en ${edificioFactura}, con datos para cobrar.\n\n` +
                                `📱 Teléfono: ${from}\n` +
                                `🔧 Dice ser: ${nombreTecnicoFactura || 'no lo aclaró'}\n` +
                                (datosFactura?.monto ? `💲 Monto: $${datosFactura.monto}${datosFactura?.numero_factura ? ` (N° ${datosFactura.numero_factura})` : ''}\n` : '') +
                                (cbuNuevo?.valido ? `🏦 CBU terminado en ...${ultimos4(cbuNuevo.cbu)}\n` : '') +
                                (aliasNuevo?.valido ? `🏦 Alias: ${aliasNuevo.alias}\n` : '') +
                                (datosFactura?.titular ? `👤 Titular: ${datosFactura.titular}\n` : '') +
                                (notaDeQuienEnvia ? `\n🗣️ Lo que contó:\n"${notaDeQuienEnvia}"\n` : '') +
                                `\n⚠️ Los datos de cobro quedaron GUARDADOS PERO SIN ACTIVAR, y el técnico figura como ` +
                                `"sin verificar". No se le puede pagar hasta que usted lo apruebe desde el panel.\n\n` +
                                `Antes de aprobarlo, confirme con el encargado o con quien lo llamó que el trabajo ` +
                                `existió y que esta persona lo hizo. Un desconocido pidiendo cobrar un arreglo que ` +
                                `nadie puede confirmar es el fraude más simple que hay.`,
                            phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                            accessToken: WHATSAPP_ACCESS_TOKEN,
                        });
                    }
                    console.log(`🆕 Técnico desconocido (${from}) mandó factura con datos de cobro. Registrado sin verificar.`);
                }
            } catch (e) {
                console.error('Error registrando al técnico desconocido:', e.message);
            }
        }

        // La factura se guarda SIEMPRE -- perderla sería peor -- pero cuando no sabemos de qué
        // edificio es queda marcada como "Sin imputar" en vez de cargada a un consorcio
        // adivinado. El administrador la ve pendiente en el panel y la corrige él.
        //
        // La nota viaja PEGADA A LA FACTURA, no solo al evento. Así la indicación sobrevive
        // aunque todavía no sepamos el edificio y no haya ningún evento donde ponerla: cuando el
        // técnico conteste de qué obra era, el evento se crea con este texto.
        const { guardarFactura } = require('./datos');
        const resGuardado = await guardarFactura({
            proveedor: nombreTecnicoFactura || 'Proveedor',
            monto: datosFactura?.monto || 'Según comprobante',
            concepto: datosFactura?.concepto || 'Servicio técnico realizado',
            edificio: edificioFactura || '',
            url_archivo: datosFactura?.url_archivo || '',
            numero_factura: datosFactura?.numero_factura || '',
            estado: edificioFactura ? 'Pendiente' : 'Sin imputar',
            nota_tecnico: notaDeQuienEnvia,
            enviada_por: `${datosEmisor.nombre || 'Desconocido'} (${datosEmisor.rol})`,
            // A qué caso quedó imputada. Se le decía al técnico por WhatsApp y no se guardaba en
            // ningún lado, así que no había cómo saber si un caso ya tenía su comprobante.
            id_evento: idCasoFactura || ''
        });

        // El mismo comprobante mandado dos veces no se registra dos veces: el administrador
        // vería el gasto duplicado en el total. Se le dice al técnico que ya la tenemos, con el
        // dato que le sirve -- a qué edificio quedó cargada.
        if (resGuardado?.duplicada) {
            const dondeQuedo = resGuardado.edificio
                ? ` Ya la tengo cargada a *${await require('./agentes/marcos-ops').direccionParaTecnico(resGuardado.edificio)}*${resGuardado.id_evento ? ` (${resGuardado.id_evento})` : ''}.`
                : '';
            const respDup = `Gracias ${datosEmisor.nombre}, pero esa factura ya me la habías mandado.${dondeQuedo} No la dupliqué. Si es de otro trabajo, decime de qué dirección y la registro aparte.`;
            await despacharRespuesta(recipient, respDup, msgTypeRespuesta);
            historial.push(`Marcos: ${respDup}`);
            return;
        }

        // ── ¿CORRESPONDE ABRIR UN EVENTO? ────────────────────────────────────────────────
        //
        // Una factura sola NO es un evento: crear uno por cada comprobante llenaba el panel de
        // eventos vacíos ("Evento", vecino "Desconocido", urgencia "Baja").
        //
        // Pero una factura CON una indicación adentro sí lo es. Es el trabajo que se coordinó por
        // fuera del circuito -- lo llamó el encargado, o el propio vecino -- y de lo que la
        // Administración no tiene ningún otro registro. Ahí el evento es la ayuda memoria: qué se
        // hizo, quién lo hizo, qué quedó pendiente y quién lo avisó, con la conversación a la vista.
        let respExtra = '';
        if (!edificioFactura) {
            // Sin edificio no podemos imputar el gasto a nadie: se lo pedimos al técnico, y de
            // paso le enseñamos el atajo del número de caso.
            //
            // Si tiene casos recientes en varios edificios se los listamos. Es lo que más lo
            // ayuda y lo que menos le cuesta: en vez de escribir la dirección, contesta "el
            // segundo". Y del lado de Marcos, elegir de una lista es un dato duro -- sabe el
            // caso, el edificio y qué administrador lo recibe.
            // Con UN candidato también se lista: se llega acá cuando ese caso ya tiene su
            // factura, así que hay que darle la opción de decir "es de ese mismo" (dos trabajos
            // en la misma obra) o nombrar otra dirección.
            if (candidatos.length >= 1) {
                // Se listan por DIRECCIÓN: el nombre interno del edificio ("san patricio casa")
                // no le dice nada al técnico, que estuvo en una calle y una altura.
                const { direccionParaTecnico } = require('./agentes/marcos-ops');
                const aMostrar = candidatos.slice(0, 5);
                const direcciones = await Promise.all(aMostrar.map(c => direccionParaTecnico(c.edificio)));
                const lista = aMostrar
                    .map((c, i) => `${i + 1}️⃣ *${c.id_evento}* — ${direcciones[i]}${c.problema ? `: ${String(c.problema).slice(0, 60)}` : ''}`)
                    .join('\n');
                respExtra = aMostrar.length === 1
                    ? `\n\nEse trabajo ya tiene su factura cargada, así que esta debe ser de otro. ` +
                      `¿De qué dirección es? Si es del mismo trabajo, decime *${aMostrar[0].id_evento}* y la sumo ahí.\n\n${lista}\n\n` +
                      `Ojo que la dirección del comprobante no me sirve, porque es la de facturación y no la del trabajo.`
                    : `\n\nPara imputarla al consorcio correcto, ¿de cuál de estos trabajos es?\n\n${lista}\n\n` +
                      `Contestame con el número, con el código del caso o con la dirección. ` +
                      `Ojo que la dirección del comprobante no me sirve, porque es la de facturación y no la del trabajo.`;
            } else {
                respExtra = ` Ahora, para imputarla al consorcio correcto necesito que me digas *de qué edificio es* — la dirección del comprobante no me sirve porque es la de facturación. Si tenés a mano el número de caso (por ejemplo *CASO-1001*), con eso solo alcanza.`;
            }
        } else if (idCasoFactura && !quedoPorLaMitad) {
            // Se engancha al caso que documenta. No se abre nada nuevo.
            respExtra = ` La dejé asociada al *${idCasoFactura}* de ${edificioFactura}.`;
        } else if (explicaElTrabajo || quedoPorLaMitad || loMandaElTecnico) {
            // Trabajo coordinado por fuera, con explicación: acá sí vale registrar el evento.
            //
            // El estado depende de lo que dijo. Si avisó que quedó algo pendiente, el caso NO se
            // cierra: se deja abierto y con la indicación adentro, que es exactamente lo que
            // después hace falta poder demostrar.
            try {
                const { guardarReporte } = require('./datos');
                const quienInforma = loMandaElTecnico
                    ? `el técnico ${nombreTecnicoFactura}`
                    : `${datosEmisor.nombre || 'quien escribió'} (${datosEmisor.rol})${nombreTecnicoFactura ? `, sobre un trabajo de ${nombreTecnicoFactura}` : ''}`;

                const detalleFactura = (datosFactura?.numero_factura ? ` Factura N° ${datosFactura.numero_factura}` : '') +
                                       (datosFactura?.monto ? ` por $${datosFactura.monto}` : '') +
                                       ((datosFactura?.numero_factura || datosFactura?.monto) ? '.' : '');
                const notas = quedoPorLaMitad
                    ? `⚠️ TRABAJO INCOMPLETO. Informado por ${quienInforma} al enviar la factura, sin reclamo previo por este canal. ` +
                      (gremioQueFalta ? `Hace falta un ${gremioQueFalta} para continuar. ` : 'Hace falta otro gremio para continuar. ') +
                      `Textual: "${notaDeQuienEnvia}"`
                    : `Trabajo informado por ${quienInforma} al enviar la factura, sin reclamo previo por este canal (lo coordinaron directamente).${detalleFactura}` +
                      (notaDeQuienEnvia ? ` Textual: "${notaDeQuienEnvia}"` : ' No contó qué se hizo; el detalle está en el comprobante.');

                const res = await guardarReporte({
                    // Si ya había un caso al que pertenece, se actualiza ESE en vez de abrir otro.
                    id_evento: idCasoFactura || undefined,
                    edificio: edificioFactura,
                    vecino: (loMandaElTecnico || esNumeroDesconocido)
                        ? 'Trabajo coordinado fuera del sistema'
                        : (vecino?.nombre || datosEmisor.nombre || ''),
                    // El teléfono del vecino solo cuando quien escribe ES el vecino. Si es el
                    // técnico -- conocido o no -- su número va en `tel_tecnico`, que es donde el
                    // administrador lo va a buscar para llamarlo si tiene una duda del trabajo o
                    // del monto. Poner el número del técnico en el campo del vecino lo escondía.
                    telefono: (loMandaElTecnico || esNumeroDesconocido) ? '' : from,
                    problema: notaDeQuienEnvia || datosFactura?.concepto || 'Trabajo facturado, coordinado fuera del sistema',
                    urgencia: quedoPorLaMitad ? 'media' : 'baja',
                    estado: quedoPorLaMitad ? 'en_proceso' : 'resuelto',
                    tecnico: nombreTecnicoFactura || '',
                    tel_tecnico: (loMandaElTecnico || esNumeroDesconocido) ? (from || '') : '',
                    rubro_tecnico: loMandaElTecnico ? (datosEmisor.especialidad || '') : (datosFactura?.concepto || ''),
                    tipo: 'trabajo_externo',
                    notas_ia: notas,
                    // Las dos puntas de la conversación, para que en el panel se lea el
                    // intercambio completo y no una sola línea suelta.
                    historial_chat: JSON.stringify([
                        `${loMandaElTecnico ? 'Proveedor' : datosEmisor.rol} (${datosEmisor.nombre || 'sin nombre'}): ${msgBodyParaRegistro}`
                    ])
                });
                if (res?.id_evento) idCasoFactura = res.id_evento;
                console.log(`🧾 Evento ${idCasoFactura || '(nuevo)'} registrado en "${edificioFactura}" desde la factura — estado ${quedoPorLaMitad ? 'ABIERTO (quedó pendiente)' : 'resuelto'}.`);

                respExtra = quedoPorLaMitad
                    ? ` Y te tomo la indicación: la dejé anotada en el *${idCasoFactura || 'caso'}* de ${edificioFactura}, que queda ABIERTO${gremioQueFalta ? ` a la espera del ${gremioQueFalta}` : ' porque falta terminar'}. Ya le avisé a la Administración con tus palabras, así queda constancia de que lo dijiste vos y cuándo.`
                    : explicaElTrabajo
                        ? ` Y como me contaste qué se hizo, lo dejé anotado en ${edifDetectadoTexto?.direccion || edificioFactura} como trabajo ya resuelto, así la Administración tiene el antecedente.`
                        : ` La dejé anotada en el *${idCasoFactura || 'caso'}* así la Administración tiene el antecedente del gasto. Si me contás en una línea qué se hizo, se lo agrego.`;
            } catch (e) {
                console.error('Error registrando el evento desde la factura:', e.message);
            }
        } else {
            // Llega acá una factura que reenvió el vecino o el encargado sin contar nada. El
            // evento lo abre igual el camino de arriba cuando la manda el técnico; acá no, porque
            // quien la reenvía no es quien hizo el trabajo y no puede describirlo.
            respExtra = ` Quedó cargada a ${edificioFactura}. Si me contás en una línea qué se hizo, se lo dejo anotado a la Administración como antecedente.`;
        }

        // ── AVISO A LA ADMINISTRACIÓN ────────────────────────────────────────────────────
        //
        // No se avisa por cada factura. Se avisa cuando el trabajo quedó por la mitad, que es uno
        // de los motivos que corresponden: el técnico no terminó de resolver el problema. Es el
        // aviso que después sostiene la palabra del técnico si el problema se repite.
        if (quedoPorLaMitad && edificioFactura) {
            try {
                const { avisarAlAdministrador } = require('./agentes/marcos-admin');
                await avisarAlAdministrador({
                    edificio: edificioFactura,
                    idEvento: idCasoFactura,
                    motivo: gremioQueFalta
                        ? `el trabajo quedó incompleto: hace falta un ${gremioQueFalta} para continuar`
                        : 'el trabajo quedó incompleto y hace falta otro gremio para continuar',
                    titulo: `⚠️ MARCOS: TRABAJO INCOMPLETO - ${edificioFactura}`,
                    cuerpo:
                        `Un trabajo quedó sin terminar y hace falta que usted lo coordine.\n\n` +
                        `📍 Edificio: ${edificioFactura}\n` +
                        `🔧 Lo hizo: ${nombreTecnicoFactura || 'técnico no identificado'}\n` +
                        `📨 Lo informó: ${datosEmisor.nombre || 'sin nombre'} (${datosEmisor.rol})\n` +
                        (gremioQueFalta ? `⛔ Falta: ${gremioQueFalta}\n` : `⛔ Falta: otro gremio para continuar\n`) +
                        (datosFactura?.monto ? `💲 Factura: $${datosFactura.monto}${datosFactura?.numero_factura ? ` (N° ${datosFactura.numero_factura})` : ''}\n` : '') +
                        `\n🗣️ Textual de quien lo informó:\n"${notaDeQuienEnvia}"\n` +
                        (idCasoFactura ? `\n🤖 Quedó registrado como ${idCasoFactura} en la pestaña EVENTOS del panel, con la conversación completa.` : `\n🤖 Quedó registrado en la pestaña EVENTOS del panel.`),
                    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                    accessToken: WHATSAPP_ACCESS_TOKEN
                });
            } catch (e) {
                console.error('Error avisando a la Administración del trabajo incompleto:', e.message);
            }
        }

        // Si en esa línea hay varios técnicos y todavía no sabemos cuál escribe, no se lo llama
        // por su nombre: decirle "Gracias, Julio" al electricista Dario es hablarle a otra
        // persona, y eso invalida todo lo demás por más que el resto salga bien.
        const nombreQuienEscribe = (datosEmisor.nombre && datosEmisor.nombre !== 'Desconocido' && !datosEmisor.nombreIncierto)
            ? datosEmisor.nombre
            : '';
        const confirmacionesFactura = [
            `Muchas gracias${nombreQuienEscribe ? ' ' + nombreQuienEscribe : ''}, ya recibí y archivé la factura.`,
            `Perfecto${nombreQuienEscribe ? ' ' + nombreQuienEscribe : ''}, recibida la factura.`,
            `Listo${nombreQuienEscribe ? ' ' + nombreQuienEscribe : ''}, comprobante registrado.`
        ];
        const respFactura = confirmacionesFactura[Math.floor(Math.random() * confirmacionesFactura.length)] + respExtra;

        await despacharRespuesta(recipient, respFactura, msgTypeRespuesta);
        historial.push(`Marcos: ${respFactura}`);

        // El intercambio se pega al caso que la factura documenta. Antes esta llamada iba sin
        // id_evento y sin teléfono, así que cuando el nombre del edificio no coincidía letra
        // por letra con ninguna fila abierta, guardarReporte no encontraba dónde pegarlo y
        // ABRÍA UNA FILA NUEVA -- sin vecino, sin problema y con urgencia por defecto. Ese era
        // el evento fantasma. Si no hay caso al que engancharse, no se guarda nada: la
        // conversación ya quedó en el chat del proveedor y la factura en su propia pestaña.
        if (idCasoFactura) {
            try {
                const { guardarReporte } = require('./datos');
                const urlParaChat = resEstFactura?.relativeUrl || datosFactura?.url_archivo || docUrl || (media?.filePath ? `/archivos/${path.basename(media.filePath)}` : '');
                const numFacturaStr = datosFactura?.numero_factura ? ` N° ${datosFactura.numero_factura}` : '';
                const montoStr = datosFactura?.monto ? ` ($${datosFactura.monto})` : '';
                const tagDoc = urlParaChat ? `[DOCUMENTO:${urlParaChat}]` : '';
                const detalleDoc = `(Factura / Comprobante adjunto${numFacturaStr}${montoStr})`;
                const msgProveedorParaChat = `Proveedor (${datosEmisor.nombre}): ${tagDoc} ${detalleDoc} ${msgBody}`.trim();

                await guardarReporte({
                    id_evento: idCasoFactura,
                    edificio: edificioFactura,
                    tecnico: datosEmisor.nombre || '',
                    tel_tecnico: from || '',
                    rubro_tecnico: rubroDelCaso(msgBodyParaRegistro, datosEmisor.especialidad),
                    historial_chat: JSON.stringify([msgProveedorParaChat, `Marcos (a Proveedor): ${respFactura}`])
                });
            } catch (e) { console.error('Error guardando chat de proveedor:', e.message); }
        }

        return; // DETENER Y RESPONDER NATURALMENTE
    }

    if (datosEmisor.rol === 'proveedor') {
        decisionCaso.contactar_tecnico = false;
        decisionCaso.contactar_encargado = false;

        const txtLow = (msgBody || '').toLowerCase();

        // ── DE QUÉ ESTÁ HABLANDO EL TÉCNICO ─────────────────────────────────────────────────
        //
        // > [!CAUTION]
        // > **Acá abajo empieza la cadena de condiciones por texto, y la primera que matchea
        // > CORTA.** Un mensaje que cae en el ramal equivocado no llega a ningún otro: Marcos
        // > contesta otra cosa y listo.
        //
        // Antes eso lo decidían solo las expresiones regulares, y el modelo era el último de la
        // fila. La frase *"no te estoy pidiendo fotos de nada"* contiene "foto", así que se leyó
        // como un pedido de fotos — dos veces seguidas, mientras Daniel escribía en mayúsculas
        // que no estaba pidiendo nada.
        //
        // Ahora se le pregunta al modelo PRIMERO, con el contexto de la conversación. Cada
        // condición de abajo queda escrita igual, como respaldo: si el ruteo está apagado, falla
        // o tarda, se sigue exactamente como antes. Y cuando los dos no coinciden queda un `🧭`
        // en el log con las dos opiniones, que es la única forma de saber si esto mejoró algo
        // sin esperar a que un técnico se queje.
        let ruteoIA = null;
        try {
            const { clasificarMensajeProveedor } = require('./ruteo-proveedor');
            const stRuteo = global.colasProveedores?.get(from) || {};
            ruteoIA = await clasificarMensajeProveedor({
                texto: textoFinal,
                contexto: {
                    ultimaPreguntaDeMarcos: [...historial].reverse().find(l => l.startsWith('Marcos'))?.slice(0, 200) || '',
                    casoAbierto: stRuteo.eventoActivoId || '',
                    edificioDelCaso: session.nombreEdificio || '',
                    rubroDelCaso: stRuteo.rubroActivo || '',
                    facturaEsperandoObra: !!session.esperandoEdificioDeFactura,
                    mandoAdjunto: !!media,
                },
            });
            if (ruteoIA) {
                console.log(`🧭 ${datosEmisor.nombre || from}: "${String(textoFinal).replace(/\s+/g, ' ').slice(0, 60)}" → ${ruteoIA.intencion} (${ruteoIA.confianza}) — ${ruteoIA.motivo}`);
            }
        } catch (e) {
            console.error('🧭 No se pudo rutear el mensaje del proveedor:', e.message);
        }
        const { seActiva } = require('./ruteo-proveedor');


        // A2. CONSULTA DE ESTADO DE PAGO ("¿ya me pagaron la factura X?", "¿cuándo cobro?", etc.)
        // Es una pregunta sobre un comprobante YA ENVIADO antes -- no se confunde con "esFacturaODoc"
        // porque parecePreguntaSinAdjunto ya la excluyó de ahí arriba. Se responde con el estado
        // REAL guardado en Sheets (que el dueño/administración marca manualmente como Pagada desde
        // el dashboard), nunca inventando si se pagó o no.
        // "Pagar" no es la única forma de decirlo: el proveedor pregunta si le DEPOSITARON, si le
        // TRANSFIRIERON o si le ACREDITARON la factura, y con solo pag/cobr/abon esas preguntas no
        // se reconocían y caían al ramal libre, donde Marcos improvisaba en vez de mirar la planilla.
        // Los verbos van conjugados a propósito: "depósito" a secas es el cuartito del edificio, y
        // "¿quién tiene la llave del depósito?" no es una consulta de plata.
        // > [!CAUTION]
        // > **`/pag/` sin `\b` adelante matchea "aPAGada", "se aPAGó" y "aPAGón".**
        //
        // Pasó de verdad: Daniel escribió que había que ver una cámara en San Patricio 270 y
        // Marcos le contestó la lista de facturas pendientes de pago. Una cámara que no anda es,
        // casi siempre, una cámara apagada -- y para un electricista "se apagó" es la mitad de lo
        // que dice en un día. El `\b` de adelante lo resuelve entero: en "apagada" el "pag" no
        // arranca en límite de palabra.
        //
        // Se pensó excluir "cobre" (el metal) de `/cobr/`, pero Daniel lo corrigió: *"no decimos
        // cable de cobre casi nunca -- cable es cable, no hay otro que no sea de cobre"*. O sea que
        // el falso positivo era imaginario, y excluirlo sí costaba caro: **"¿ya cobre?" sin tilde**
        // es como se escribe de verdad en WhatsApp, y quedaba afuera. Se deja `\bcobr` a secas.
        const esConsultaPagoPorTexto = parecePreguntaSinAdjunto && (
            /\bpag/i.test(txtLow) ||
            /\bcobr/i.test(txtLow) ||
            /\babon/i.test(txtLow) ||
            // Solo formas conjugadas: "depósito" a secas es el cuartito del edificio, y sin el
            // acento queda igual que la primera persona del verbo.
            /deposit(aron|aste|ó|aban|ada|ado|an)\b/i.test(txtLow) ||
            /transfi(r|er)|transferenc|acredit|liquid(ar|aron)|cheque|giro banc/i.test(txtLow)
        );
        const esConsultaPago = seActiva('consulta_pago', esConsultaPagoPorTexto, ruteoIA, textoFinal);

        if (esConsultaPago) {
            const numeroMencionado = (txtLow.match(/\b\d{3,}\b/) || [])[0] || '';
            const { buscarFacturasProveedor } = require('./datos');

            // Se piden TODAS las facturas del proveedor, sin atarlas al edificio activo de la
            // sesión. El técnico pregunta desde su lado del mostrador: "¿me pagaron Ortiz?" o
            // "¿y San Patricio?". No tiene por qué saber si hay cuatro Ortiz en el sistema, ni
            // cuál de ellos es el suyo -- eso lo resolvemos nosotros contra sus propias facturas.
            const mias = await buscarFacturasProveedor({ proveedor: datosEmisor.nombre });

            // Qué facturas nombra el mensaje. Se compara contra los datos que YA tenemos en vez de
            // interpretar el texto: si una de sus facturas es de "san patricio casa" y el mensaje
            // dice "san patricio", esa palabra alcanza para saber de cuál habla.
            const textoBusqueda = normalizarParaBuscar(txtLow);
            const mencionadas = mias.filter(f => textoMencionaFactura(textoBusqueda, f));

            let facturasEncontradas = mias;
            let comoSeAcoto = '';
            if (numeroMencionado) {
                const porNumero = mias.filter(f => String(f.numero_factura || '').replace(/\D/g, '') === numeroMencionado);
                if (porNumero.length) { facturasEncontradas = porNumero; comoSeAcoto = `N° ${numeroMencionado}`; }
                else if (mencionadas.length) { facturasEncontradas = mencionadas; comoSeAcoto = 'por el nombre mencionado'; }
            } else if (mencionadas.length) {
                facturasEncontradas = mencionadas;
                comoSeAcoto = 'por el nombre mencionado';
            }
            if (comoSeAcoto) console.log(`🧾 Consulta de pago de ${datosEmisor.nombre}: ${facturasEncontradas.length} factura(s) acotadas ${comoSeAcoto}.`);

            const detalleFactura = f =>
                `• ${f.numero_factura ? 'N° ' + f.numero_factura : 'sin número'} — ${f.edificio || 'edificio s/d'}` +
                `${f.concepto ? ' (' + f.concepto + ')' : ''}${f.monto ? ' — ' + f.monto : ''}` +
                ` — *${/pagad/i.test(f.estado) ? 'pagada' : 'pendiente'}*${f.fecha ? ' — ' + f.fecha : ''}`;

            let respPago;
            if (facturasEncontradas.length === 0) {
                respPago = numeroMencionado
                    ? `No encuentro registrada ninguna factura N° ${numeroMencionado} a tu nombre todavía, ${datosEmisor.nombre}. Si ya la mandaste y no figura, avisame y lo reviso con la Administración.`
                    : `No tengo facturas tuyas registradas todavía para confirmarte el estado, ${datosEmisor.nombre}. Si me la mandás (foto o PDF) la registro para que la Administración la procese.`;
            } else if (facturasEncontradas.length === 1) {
                const f = facturasEncontradas[0];
                const pagada = /pagad/i.test(f.estado);
                const quePlata = `la factura${f.numero_factura ? ' N° ' + f.numero_factura : ''} de ${f.edificio || 'ese trabajo'}` +
                    `${f.concepto ? ' (' + f.concepto + ')' : ''}${f.monto ? ', ' + f.monto : ''}`;
                respPago = pagada
                    ? `Sí ${datosEmisor.nombre}, ${quePlata} figura *pagada* en el sistema.`
                    : `Todavía figura *pendiente de pago* ${quePlata}, ${datosEmisor.nombre}. En cuanto la Administración confirme el pago te aviso.`;
            } else {
                // Con varias en juego se listan en vez de pedirle el número: si pregunta es
                // justamente porque no lo tiene a mano, y mandarlo a buscarlo es hacerle hacer a él
                // el trabajo que podemos hacer nosotros.
                const pendientes = facturasEncontradas.filter(f => !/pagad/i.test(f.estado));
                if (pendientes.length === 0) {
                    respPago = `Te figuran todas pagadas, ${datosEmisor.nombre}:\n\n${facturasEncontradas.slice(0, 8).map(detalleFactura).join('\n')}`;
                } else {
                    respPago = `Tenés ${pendientes.length} ${pendientes.length === 1 ? 'factura pendiente' : 'facturas pendientes'} de pago, ${datosEmisor.nombre}:\n\n` +
                        `${pendientes.slice(0, 8).map(detalleFactura).join('\n')}` +
                        `${pendientes.length > 8 ? `\n\n(y ${pendientes.length - 8} más)` : ''}` +
                        `\n\nSi es por alguna en particular, decime el edificio o el número y te confirmo esa.`;
                }
            }

            await despacharRespuesta(recipient, respPago, msgTypeRespuesta);
            historial.push(`Marcos: ${respPago}`);

            try {
                const { guardarReporte } = require('./datos');
                await guardarReporte({
                    edificio: session.nombreEdificio,
                    tecnico: datosEmisor.nombre || '',
                    tel_tecnico: from || '',
                    rubro_tecnico: rubroDelCaso(msgBodyParaRegistro, datosEmisor.especialidad),
                    historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBodyParaRegistro}`, `Marcos (a Proveedor): ${respPago}`])
                });
            } catch (e) { console.error('Error guardando chat de proveedor:', e.message); }

            return;
        }

        // A2-bis. EL TÉCNICO MANDA SU CBU O SU ALIAS PARA COBRAR
        //
        // Se guarda para que el administrador tenga a quién pagarle sin salir a buscarlo, y se
        // verifica antes de guardarlo: 22 dígitos dictados por audio o copiados a mano no se
        // revisan de un vistazo, y un dígito cambiado es un pago rechazado o, peor, un pago a
        // otra cuenta. El CBU trae verificadores justamente para eso.
        try {
            const { buscarCBUEnTexto, buscarAliasEnTexto, ultimos4 } = require('./cbu');
            const cbuEnMensaje = buscarCBUEnTexto(textoFinal);
            const aliasEnMensaje = buscarAliasEnTexto(textoFinal);
            const nombraCobro = /\bcbu\b|\balias\b|\bcuenta\b|\btransferi|\bdepositar|\bpara (el )?(pago|cobro)\b/i.test(textoFinal);

            if ((cbuEnMensaje || aliasEnMensaje) && nombraCobro) {
                // Un CBU escrito mal no se guarda: se le dice qué pasó para que lo repita.
                if (cbuEnMensaje && !cbuEnMensaje.valido) {
                    const resp = `Che ${datosEmisor.nombreIncierto ? '' : (datosEmisor.nombre + ', ')}` +
                        `revisá ese CBU que me pasaste: ${cbuEnMensaje.motivo}. ` +
                        `¿Me lo reenviás? Si preferís, mandame el *alias* que es más corto y se equivoca menos.`;
                    await despacharRespuesta(recipient, resp, msgTypeRespuesta);
                    historial.push(`Marcos: ${resp}`);
                    return;
                }
                if (aliasEnMensaje && !aliasEnMensaje.valido && !cbuEnMensaje?.valido) {
                    const resp = `Ese alias no me cierra: ${aliasEnMensaje.motivo}. ¿Me lo repetís?`;
                    await despacharRespuesta(recipient, resp, msgTypeRespuesta);
                    historial.push(`Marcos: ${resp}`);
                    return;
                }

                const { guardarDatosBancariosProveedor } = require('./datos');
                // El titular puede no ser el técnico: factura la empresa y cobra otro. Se toma si
                // lo dice, porque el administrador lo necesita ver antes de transferir.
                const titularDicho = (textoFinal.match(/\b(?:a nombre de|titular(?:\s*:)?)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]{3,40})/i) || [])[1];

                const guardado = await guardarDatosBancariosProveedor({
                    nombre: datosEmisor.nombreIncierto ? '' : datosEmisor.nombre,
                    telefono: from,
                    cbu: cbuEnMensaje?.valido ? cbuEnMensaje.cbu : '',
                    alias: aliasEnMensaje?.valido ? aliasEnMensaje.alias : '',
                    titular: (titularDicho || '').trim(),
                });

                // En una línea compartida por varios técnicos no se puede elegir uno al azar: los
                // datos de cobro de Julio no son los de Dario, y escribirlos en la fila equivocada
                // manda el pago a otra persona.
                if (guardado.ambiguo) {
                    const cuales = (guardado.candidatos || []).map(c => `*${c.nombre}*${c.rubro ? ` (${c.rubro})` : ''}`).join(' o ');
                    const resp = `Con este número tengo cargado a ${cuales}. ¿A nombre de cuál de los dos anoto estos datos para el cobro?`;
                    await despacharRespuesta(recipient, resp, msgTypeRespuesta);
                    historial.push(`Marcos: ${resp}`);
                    return;
                }

                if (!guardado.ok) {
                    const resp = `No pude guardar esos datos ahora. Se los paso igual a la Administración y lo revisan.`;
                    await despacharRespuesta(recipient, resp, msgTypeRespuesta);
                    historial.push(`Marcos: ${resp}`);
                    return;
                }

                let resp;
                if (guardado.pendiente) {
                    // Un cambio no se aplica solo. Ver el comentario en guardarDatosBancariosProveedor.
                    resp = `Anotado. Como ya tenía otros datos de cobro tuyos, este cambio lo tiene que confirmar la Administración antes de que quede activo — es el resguardo para que a nadie le desvíen un pago haciéndose pasar por vos. Ya les avisé.`;

                    try {
                        const { avisarAlAdministrador } = require('./agentes/marcos-admin');
                        // Se relee de la cola en vez de usar el `stProv` de más arriba: aquel vive
                        // en otro bloque y acá no está en alcance. Es el mismo error que ya rompió
                        // producción tres veces (itemsRafaga, messageText, captionAuto) y que
                        // `node --check` no ve, porque es válido hasta que se ejecuta.
                        const colaTecnico = global.colasProveedores?.get(String(from).replace(/\D/g, ''));
                        const edificioAviso = colaTecnico?.edificioActivo || session.nombreEdificio || '';
                        if (edificioAviso) {
                            await avisarAlAdministrador({
                                edificio: edificioAviso,
                                motivo: 'un proveedor pidió cambiar sus datos de cobro',
                                titulo: `🔐 MARCOS: PEDIDO DE CAMBIO DE CBU - ${guardado.nombre}`,
                                cuerpo:
                                    `El proveedor *${guardado.nombre}* pidió cambiar la cuenta donde cobra.\n\n` +
                                    `📱 Desde el teléfono: ${from}\n` +
                                    `🏦 Tenía: ${guardado.anterior.cbu ? 'CBU ...' + ultimos4(guardado.anterior.cbu) : ''}${guardado.anterior.alias ? ` / alias ${guardado.anterior.alias}` : ''}\n` +
                                    `🆕 Pide:  ${guardado.nuevo.cbu ? 'CBU ...' + ultimos4(guardado.nuevo.cbu) : ''}${guardado.nuevo.alias ? ` / alias ${guardado.nuevo.alias}` : ''}\n\n` +
                                    `⚠️ NO se aplicó. La cuenta anterior sigue siendo la vigente hasta que usted lo apruebe desde el panel.\n\n` +
                                    `Cambiar el CBU de un proveedor es el fraude más común que existe: alguien se mete en la conversación y desvía el pago del mes. Antes de aprobarlo, confírmelo con el proveedor por un canal que ya conocía — llamándolo al número de siempre, no respondiendo a este mensaje.`,
                                phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                                accessToken: WHATSAPP_ACCESS_TOKEN,
                            });
                        } else {
                            console.warn('[CBU] Cambio pendiente sin edificio de referencia: no se pudo avisar a la Administración.');
                        }
                    } catch (e) {
                        console.error('Error avisando el cambio de CBU a la Administración:', e.message);
                    }
                } else {
                    // Se repite lo guardado para que un error de dictado salte acá y no en el pago.
                    const partes = [];
                    if (cbuEnMensaje?.valido) partes.push(`CBU terminado en *${ultimos4(cbuEnMensaje.cbu)}*`);
                    if (aliasEnMensaje?.valido) partes.push(`alias *${aliasEnMensaje.alias}*`);
                    if (titularDicho) partes.push(`a nombre de *${titularDicho.trim()}*`);
                    resp = `Listo, lo anoté para que la Administración te pague: ${partes.join(', ')}. Si algo de eso no es así, avisame y lo corrijo.`;
                }

                await despacharRespuesta(recipient, resp, msgTypeRespuesta);
                historial.push(`Marcos: ${resp}`);
                return;
            }
        } catch (e) {
            console.error('Error procesando los datos de cobro del proveedor:', e.message);
        }

        // A3. LA RESPUESTA A "¿DE QUÉ EDIFICIO ES ESA FACTURA?"
        //
        // Sin esto, preguntar no servía de nada: el técnico contestaba "el 2" o "San Patricio", el
        // mensaje caía al ramal libre y la factura se quedaba "Sin imputar" para siempre. Una
        // pregunta que no puede recibir respuesta es peor que no preguntar.
        //
        // El pendiente NO vive en memoria: se busca en la planilla, entre las facturas de este
        // técnico que quedaron sin edificio. Así la respuesta sigue funcionando aunque PM2 haya
        // reiniciado entre la pregunta y la contestación, que es lo que pasa todo el tiempo.
        //
        // Solo se lee como respuesta un mensaje CORTO y sin otra intención adentro. "San Patricio
        // 159" es una respuesta; "estoy yendo a san patricio 159" es un aviso de que está en
        // camino, y tomarlo como respuesta le imputaría una factura por error. Los ramales que
        // vienen más abajo (pedir fotos al vecino, avisar que llegó a la puerta) tienen que poder
        // atender esos mensajes.
        const pareceRespuestaDeEdificioPorTexto = !esFacturaODoc
            && String(textoFinal || '').trim().length <= 60
            && !/solicitar|m.s datos|mas datos|detalles|pedir|foto|imagen|video|cerradura|especifi|aclarar/i.test(txtLow)
            && !/llegu|llegue|estoy (aca|acá|afuera|en la puerta|abajo)|no hay nadie|no me abre|nadie (me )?abre|no sale nadie|toqu[eé] timbre|voy en camino|estoy yendo|salgo para/i.test(txtLow);

        // El adjunto lo decide el tipo de archivo, no el texto: eso NO se rutea. Una factura es
        // una factura aunque el modelo lea otra cosa en lo que vino escrito al lado.
        const pareceRespuestaDeEdificio = !esFacturaODoc
            && seActiva('responde_de_que_obra', pareceRespuestaDeEdificioPorTexto, ruteoIA, textoFinal);

        if (pareceRespuestaDeEdificio) {
            try {
                const { buscarFacturasSinImputar, imputarFacturaSinEdificio, edificiosDelProveedor, buscarCasosRecientesPorTecnico, buscarCasoPorCodigo } = require('./datos');
                const sinImputar = await buscarFacturasSinImputar({ proveedor: datosEmisor.nombre }) || [];

                if (sinImputar.length) {
                    const cartera = (await edificiosDelProveedor({ nombre: datosEmisor.nombre, telefono: from })) || [];
                    const enCarteraResp = nombre => {
                        if (!cartera.length) return true;
                        const n = normalizarTextoEdificio(nombre);
                        if (!n) return false;
                        return cartera.some(c => {
                            const cn = normalizarTextoEdificio(c.edificio);
                            return cn === n || cn.includes(n) || n.includes(cn);
                        });
                    };

                    let edificioElegido = '';
                    let casoElegido = null;

                    // a) Contestó con el código del caso.
                    //
                    // > [!CAUTION]
                    // > **La palabra "caso" no siempre va adelante del número.**
                    //
                    // Esto exigía `CASO 1001`. Daniel contestó **"1001 es el caso"** --el número
                    // primero-- y no matcheó nada: ni esta, ni la del edificio (no nombra
                    // ninguno), ni la de la lista (pide UN dígito). La factura terminó abriendo un
                    // caso nuevo al lado del que él acababa de nombrar.
                    //
                    // Nadie contesta un número de caso de una sola forma. Se acepta en las dos, y
                    // también el número pelado cuando es de 3 dígitos o más: a esa altura de la
                    // conversación Marcos ya preguntó de qué obra era, así que "1001" a secas no
                    // puede ser otra cosa.
                    const codRespuesta =
                        (textoFinal.match(/\bCASO[\s:\-]*0*(\d{2,})\b/i) || [])[1]
                        || (textoFinal.match(/\b0*(\d{3,})\b(?=[^]{0,20}\bcaso\b)/i) || [])[1]
                        || (String(textoFinal || '').trim().match(/^#?0*(\d{3,})$/) || [])[1];
                    if (codRespuesta) {
                        const c = await buscarCasoPorCodigo(codRespuesta);
                        if (c?.edificio && enCarteraResp(c.edificio)) {
                            edificioElegido = c.edificio;
                            casoElegido = c;
                        }
                    }

                    // b) Contestó nombrando el edificio.
                    if (!edificioElegido) {
                        const edifResp = buscarEdificioEnTexto(msgClean, edificiosConocidos);
                        if (edifResp?.nombre && enCarteraResp(edifResp.nombre)) edificioElegido = edifResp.nombre;
                    }

                    // c) Contestó con el número de la lista que le mostramos ("el 2"). La lista se
                    //    vuelve a armar igual que cuando se le preguntó -- misma consulta, mismo
                    //    orden -- así que el número sigue apuntando al mismo caso.
                    const soloNumero = (String(textoFinal || '').match(/^\D{0,12}([1-5])\D{0,12}$/) || [])[1];
                    if (!edificioElegido && soloNumero) {
                        const recientes = (await buscarCasosRecientesPorTecnico(datosEmisor.nombre, from, 30)) || [];
                        const lista = recientes.filter(c => c.edificio && enCarteraResp(c.edificio)).slice(0, 5);
                        const elegido = lista[Number(soloNumero) - 1];
                        if (elegido?.edificio) edificioElegido = elegido.edificio;
                    }

                    if (edificioElegido) {
                        // ── ¿HAY YA UN CASO ESPERANDO ESTA FACTURA? ──────────────────────────
                        //
                        // > [!CAUTION]
                        // > **Contestar el edificio no quiere decir que haga falta un caso nuevo.**
                        //
                        // Visto en la prueba: a la 1:19 se abrió el CASO-1001 en San Patricio 270
                        // con este mismo técnico y este mismo rubro; a la 1:27 llegó su factura y
                        // Marcos abrió el CASO-1002, en el mismo edificio, con el mismo técnico y
                        // el mismo rubro. Dos casos donde había un trabajo, y el administrador
                        // viendo un gasto separado de la conversación que lo explica.
                        //
                        // El caso nuevo sigue siendo lo correcto cuando de verdad no hubo reclamo
                        // por este canal --al técnico lo llamó el encargado y mandó la factura--,
                        // que es el caso normal. Pero si su caso reciente en ese edificio todavía
                        // no tiene comprobante, esa factura es de ESE trabajo.
                        if (!casoElegido) {
                            try {
                                const { casoYaTieneFactura } = require('./datos');
                                const recientes = (await buscarCasosRecientesPorTecnico(datosEmisor.nombre, from, 30)) || [];
                                const mismoEdif = recientes.filter(c =>
                                    c.id_evento && normalizarTextoEdificio(c.edificio) === normalizarTextoEdificio(edificioElegido));

                                // Con más de uno no se adivina: se toma el más reciente SOLO si es
                                // el único sin factura. Dos candidatos sin comprobante son dos
                                // trabajos distintos y elegir mal reparte el gasto al azar.
                                const libres = [];
                                for (const c of mismoEdif) {
                                    if (!(await casoYaTieneFactura(c.id_evento))) libres.push(c);
                                }
                                if (libres.length === 1) {
                                    casoElegido = libres[0];
                                    console.log(`🧾 La factura de ${datosEmisor.nombre} va al ${casoElegido.id_evento}: es su único caso en "${edificioElegido}" sin comprobante. No se abre uno nuevo.`);
                                } else if (libres.length > 1) {
                                    console.log(`🤔 ${datosEmisor.nombre} tiene ${libres.length} casos sin factura en "${edificioElegido}". No se adivina: se abre el evento del trabajo facturado.`);
                                }
                            } catch (e) {
                                console.error('Error buscando si ya había un caso esperando esta factura:', e.message);
                            }
                        }

                        // La factura que se está por imputar es la última sin edificio: la misma
                        // que va a tocar `imputarFacturaSinEdificio`. De ahí sale la indicación
                        // que el técnico había escrito cuando la mandó.
                        const laQueSeImputa = sinImputar[0] || null;

                        const cuantas = await imputarFacturaSinEdificio({
                            proveedor: datosEmisor.nombre,
                            edificio: edificioElegido,
                            idEvento: casoElegido?.id_evento || ''
                        });
                        const quedan = sinImputar.length - cuantas;

                        // ── RECIÉN ACÁ SE PUEDE REGISTRAR LA INDICACIÓN ──────────────────────
                        //
                        // Cuando llegó la factura no sabíamos el edificio, así que no había dónde
                        // anotar lo que el técnico avisó ("hasta acá llegué, hay que llamar al
                        // plomero"). El texto quedó guardado con la factura justamente para este
                        // momento: ahora que sabemos la obra, se abre el evento con sus palabras.
                        let avisoEvento = '';
                        const nota = String(laQueSeImputa?.nota_tecnico || '').trim();

                        // SIEMPRE se abre el evento, cuente o no qué hizo.
                        //
                        // Antes hacía falta una explicación de 20 caracteres. Sin ella la factura
                        // quedaba archivada y no existía el caso: el administrador veía un gasto
                        // suelto, sin conversación, sin el teléfono del técnico y sin poder
                        // preguntarle nada.
                        //
                        // Y ese es el caso NORMAL, no la excepción: al técnico lo llama el
                        // encargado, hace el trabajo y manda la factura. Nunca hubo reclamo por
                        // este canal. El evento es lo único que le da contexto al gasto -- es
                        // exactamente lo que el administrador tenía antes en su propio WhatsApp,
                        // y lo que Marcos tiene que reemplazar.
                        //
                        // PERO si el caso ya existe (lo nombró el técnico, o es su único caso sin
                        // comprobante en ese edificio), la factura va AHÍ. Abrir uno nuevo al lado
                        // parte un trabajo en dos y le muestra al administrador dos gastos donde
                        // hay uno.
                        if (cuantas > 0 && casoElegido) {
                            const idEv = casoElegido.id_evento;
                            try {
                                const { guardarReporte } = require('./datos');
                                await guardarReporte({
                                    id_evento: idEv,
                                    edificio: edificioElegido,
                                    tecnico: datosEmisor.nombre || '',
                                    tel_tecnico: from || '',
                                    notas_ia: `Factura recibida del técnico ${datosEmisor.nombre}` +
                                        (laQueSeImputa?.numero_factura ? `. N° ${laQueSeImputa.numero_factura}` : '') +
                                        (laQueSeImputa?.monto ? ` por $${laQueSeImputa.monto}` : '') +
                                        (nota ? `. Textual: "${nota}"` : ''),
                                    historial_chat: JSON.stringify([
                                        ...(nota ? [`Proveedor (${datosEmisor.nombre}): ${nota}`] : []),
                                        `Marcos (a Proveedor): ¿De qué edificio es esta factura?`,
                                        `Proveedor (${datosEmisor.nombre}): ${msgBodyParaRegistro}`,
                                    ])
                                });
                            } catch (e) {
                                console.error('Error anotando la factura en el caso que ya existía:', e.message);
                            }
                            avisoEvento = ` La dejé asociada al *${idEv}*, que es el trabajo que ya teníamos abierto ahí.`;
                        } else if (cuantas > 0) {
                            // Mismo criterio que cuando llegó la factura (ver `quedoPorLaMitad`),
                            // incluido el detalle del `\b` después de una vocal acentuada.
                            const faltaOtroGremio = /\b(hay que|habr[ií]a que|tienen que|tendr[ií]an que|deber[ií]an)\s+(llamar|mandar|convocar|contratar|coordinar|buscar|conseguir)\b/i.test(nota)
                                || /\b(falta|faltar[ií]a|queda pendiente|no termin|sin terminar|a medias|parcial|provisorio|provisional)\b/i.test(nota)
                                || /\bhasta (ac[aá]|aqu[ií]) (llegu[eé]|puedo|pude|llego)/i.test(nota)
                                || /\bno me corresponde|\bno es (lo )?m[ií]o|\bes trabajo de|\bque siga (el|otro)/i.test(nota)
                                || /\b(lo dem[aá]s|el resto)\b[^.]{0,20}\bes (de|del)\b/i.test(nota)
                                || /\b(otro|un)\s+(gremio|rubro|especialista)\b/i.test(nota);
                            const gremio = (nota.match(/\b(plomer[oa]|gasista|electricista|cerrajer[oa]|alba[ñn]il|pintor|herrer[oa]|techista|vidrier[oa]|carpinter[oa]|refrigeraci[oó]n|ascensorista)\b/i) || [])[1] || '';
                            try {
                                const { guardarReporte } = require('./datos');
                                const resEv = await guardarReporte({
                                    edificio: edificioElegido,
                                    vecino: 'Trabajo coordinado fuera del sistema',
                                    // Sin explicación, el concepto de la factura es lo único que
                                    // hay. Es poco, pero es mejor que un caso sin título.
                                    problema: nota || laQueSeImputa?.concepto || 'Trabajo facturado, coordinado fuera del sistema',
                                    urgencia: faltaOtroGremio ? 'media' : 'baja',
                                    estado: faltaOtroGremio ? 'en_proceso' : 'resuelto',
                                    tecnico: datosEmisor.nombre || '',
                                    tel_tecnico: from || '',
                                    rubro_tecnico: rubroDelCaso(nota || laQueSeImputa?.concepto || '', datosEmisor.especialidad),
                                    tipo: 'trabajo_externo',
                                    notas_ia: (faltaOtroGremio ? '⚠️ TRABAJO INCOMPLETO. ' : '') +
                                        `Informado por el técnico ${datosEmisor.nombre} al enviar la factura` +
                                        (gremio ? `. Hace falta un ${gremio} para continuar` : '') +
                                        (laQueSeImputa?.numero_factura ? `. Factura N° ${laQueSeImputa.numero_factura}` : '') +
                                        (laQueSeImputa?.monto ? ` por $${laQueSeImputa.monto}` : '') +
                                        (nota ? `. Textual: "${nota}"` : '. No contó qué se hizo; el detalle está en el comprobante.'),
                                    // La conversación entera, no una línea suelta: la pregunta de
                                    // Marcos y lo que contestó el técnico. Es lo que el
                                    // administrador necesita leer para entender el gasto.
                                    historial_chat: JSON.stringify([
                                        ...(nota ? [`Proveedor (${datosEmisor.nombre}): ${nota}`] : []),
                                        `Marcos (a Proveedor): ¿De qué edificio es esta factura?`,
                                        `Proveedor (${datosEmisor.nombre}): ${msgBodyParaRegistro}`,
                                    ])
                                });
                                const idEv = resEv?.id_evento || '';
                                avisoEvento = faltaOtroGremio
                                    ? ` Dejé anotada tu indicación en el *${idEv || 'caso'}*, que queda ABIERTO${gremio ? ` esperando al ${gremio}` : ''}, y ya le avisé a la Administración.`
                                    : nota
                                        ? ` Y dejé anotado el trabajo en el *${idEv || 'caso'}* como antecedente para la Administración.`
                                        : ` La dejé anotada en el *${idEv || 'caso'}* para que la Administración tenga el antecedente. Si querés contarme en una línea qué se hizo, se lo agrego.`;

                                if (faltaOtroGremio) {
                                    const { avisarAlAdministrador } = require('./agentes/marcos-admin');
                                    await avisarAlAdministrador({
                                        edificio: edificioElegido,
                                        idEvento: idEv,
                                        motivo: gremio ? `el trabajo quedó incompleto: hace falta un ${gremio}` : 'el trabajo quedó incompleto',
                                        titulo: `⚠️ MARCOS: TRABAJO INCOMPLETO - ${edificioElegido}`,
                                        cuerpo:
                                            `Un trabajo quedó sin terminar y hace falta que usted lo coordine.\n\n` +
                                            `📍 Edificio: ${edificioElegido}\n` +
                                            `🔧 Lo hizo: ${datosEmisor.nombre}\n` +
                                            (gremio ? `⛔ Falta: ${gremio}\n` : `⛔ Falta: otro gremio para continuar\n`) +
                                            (laQueSeImputa?.monto ? `💲 Factura: $${laQueSeImputa.monto}${laQueSeImputa.numero_factura ? ` (N° ${laQueSeImputa.numero_factura})` : ''}\n` : '') +
                                            `\n🗣️ Textual del técnico:\n"${nota}"\n` +
                                            (idEv ? `\n🤖 Quedó registrado como ${idEv} en la pestaña EVENTOS del panel.` : ''),
                                        phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                                        accessToken: WHATSAPP_ACCESS_TOKEN
                                    });
                                }
                            } catch (e) {
                                console.error('Error registrando el evento con la indicación guardada:', e.message);
                            }
                        }

                        const respImput = cuantas > 0
                            ? `Listo ${datosEmisor.nombre}, la cargué a *${edificioElegido}*.` + avisoEvento +
                              (quedan > 0 ? ` Todavía me queda${quedan > 1 ? 'n' : ''} ${quedan} comprobante${quedan > 1 ? 's' : ''} tuyo${quedan > 1 ? 's' : ''} sin edificio: ¿de cuál${quedan > 1 ? 'es' : ''} son?` : '')
                            : `Anotado ${datosEmisor.nombre}, pero no encontré la factura pendiente para actualizarla. Si me la reenviás la registro de nuevo.`;

                        await despacharRespuesta(recipient, respImput, msgTypeRespuesta);
                        historial.push(`Marcos: ${respImput}`);
                        return;
                    }
                }
            } catch (e) {
                console.error('Error interpretando la respuesta sobre el edificio de la factura:', e.message);
            }
        }

        // ── A3. EL PROVEEDOR AVISA QUE LO LLAMARON Y QUE VA ─────────────────────────────
        //
        // "Me llamó el encargado de San Patricio 159, voy a pasar a ver la puerta."
        //
        // POR QUÉ ABRE UN CASO. Esto es lo que el técnico le decía al administrador por teléfono
        // ANTES de que existiera Marcos, y es justo el momento que Marcos viene a reemplazar: si
        // el administrador deja de atender el teléfono, ese aviso tiene que quedar en algún lado.
        // Sin esto, el trabajo aparece recién con la factura, días después, sin que nadie supiera
        // que se estaba haciendo.
        //
        // Un reclamo no lo abre solo el vecino: el encargado, la limpieza, la seguridad y el
        // propio administrador ya pueden (caen al camino común). El proveedor era el único que no
        // podía, porque su rama corta antes.
        {
            // > [!CAUTION]
            // > **"me llamó" y "me ACABAN DE llamar" no son la misma expresión regular.**
            //
            // La condición anterior era `/\bme (llam|avis|convoc|...)/`, que exige el "me" PEGADO al
            // verbo. En producción Daniel escribió "me acaban de llamar de San Patricio 270" y no
            // matcheó: tres palabras en el medio alcanzaron para que la rama del aviso no se
            // activara. Sin caso abierto, el mensaje se fue al camino genérico, ahí se buscó "el
            // caso abierto del técnico" y Marcos contestó sobre un caso de otro edificio.
            //
            // Nadie habla con la plantilla que uno imaginó. Se admiten hasta tres palabras entre
            // el pronombre y el verbo, y las formas que faltaban: "acaban de llamarme", "recién
            // llamó el encargado", "llamaron del edificio".
            //
            // Ojo con `\w`: en JavaScript NO incluye las vocales acentuadas, así que `llam\w*` se
            // corta antes de la "ó" de "llamó" y la frase más común de todas --"llamó el
            // encargado"-- no matcheaba. Por eso las clases se escriben a mano con los acentos.
            const avisaQueVaPorTexto = /\b(me|nos)\s+(?:[a-z0-9áéíóúüñ]+\s+){0,3}(llam|avis|convoc|pidi|mand|contact|solicit)/i.test(txtLow)
                || /\b(acab[a-záéíóúüñ]*|termin[a-záéíóúüñ]*)\s+de\s+(llamar|llamarme|avisar|avisarme|contactar|escribir)/i.test(txtLow)
                || /\b(llam|avis|convoc|contact)[a-záéíóúüñ]*\s+(el|la|los|las|un|una)?\s*(encargad|administrad|porter|seguridad|vecin|consorcio|edificio)/i.test(txtLow)
                || /\b(llamaron|avisaron|convocaron|contactaron|me escribieron)\b/i.test(txtLow)
                || /\b(voy a (pasar|ir|estar|acercarme)|estoy yendo|voy para|paso (hoy|ma[nñ]ana|luego|m[aá]s tarde)|me acerco|salgo para)\b/i.test(txtLow)
                || /\b(aviso que|te aviso que|les aviso que)\b/i.test(txtLow);

            // Confirmar que va es TAMBIÉN un aviso: si el técnico arranca por "voy mañana a las
            // 10" sin contar que lo llamaron, el caso tiene que abrirse igual. Por eso las dos
            // intenciones cuentan para esta condición.
            const avisaQueVa = ruteoIA
                ? (ruteoIA.intencion === 'avisa_que_lo_convocaron' || ruteoIA.intencion === 'confirma_que_va')
                : avisaQueVaPorTexto;
            if (ruteoIA && avisaQueVa !== avisaQueVaPorTexto) {
                console.log(`🧭 "${String(textoFinal).replace(/\s+/g, ' ').slice(0, 60)}" → avisaQueVa: el texto decía ${avisaQueVaPorTexto ? 'SÍ' : 'no'}, la IA dice ${avisaQueVa ? 'SÍ' : 'no'} (leyó "${ruteoIA.intencion}"). Gana la IA.`);
            }

            // AVISAR QUE LO LLAMARON NO ES DECIR QUE VA.
            //
            // "Hola, me llamaron del edificio, hay una cámara que no funciona" es un aviso a medias:
            // el administrador tiene que enterarse igual, pero nadie sabe todavía si el técnico va
            // a ir, ni cuándo, ni si necesita que le abran. Antes eso se daba por confirmado y se
            // agendaba un control contra una promesa que nunca existió.
            //
            // Daniel: "si no digo que voy, que Marcos pregunte: ok gracias por avisarme, ¿vas a
            // pasar? ¿cuándo? ¿necesitás algo que gestione? Así no espera que el tipo le diga --
            // que indague".
            const confirmaQueVaPorTexto = /\b(voy a (pasar|ir|estar|acercarme)|estoy yendo|voy para|voy ma[nñ]ana|voy hoy|paso (hoy|ma[nñ]ana|luego|m[aá]s tarde|por la)|me acerco|salgo para|ya salgo|estoy en camino|en camino)\b/i.test(txtLow)
                || /\b(voy|paso|llego|estar[eé]|ir[eé])\b[^.]{0,30}\b(hoy|ma[nñ]ana|a las?\s*\d|en \d+\s*(min|hs?|hora))/i.test(txtLow);
            const confirmaQueVa = seActiva('confirma_que_va', confirmaQueVaPorTexto, ruteoIA, textoFinal);

            // Y cómo se contesta de verdad "¿vas a pasar? ¿cuándo?": "sí, mañana a las 10",
            // "dale, voy", "a las 9". Sin verbo y sin repetir la dirección, porque la acaba de
            // decir. Esto NO abre nada por sí solo: solo sirve para reconocer la respuesta cuando
            // hay un caso esperando confirmación, y si no lo hay el mensaje sigue su camino.
            const pareceRespuestaDeAgendaPorTexto = /^\s*(s[ií]|dale|ok|oka|okey|listo|perfecto|claro|obvio|de una|joya|b[aá]rbaro)\b/i.test(txtLow)
                || /\ba\s+las?\s*\d{1,2}\b/i.test(txtLow)
                || /\b(hoy|ma[nñ]ana|pasado ma[nñ]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(txtLow)
                || /\ben\s+\d+\s*(min|minutos?|hs?|horas?)\b/i.test(txtLow);

            // ESTA es la única que SUMA en vez de reemplazar, y es a propósito: no corta ningún
            // camino ni abre nada por sí sola -- solo permite enganchar la respuesta con un caso
            // que ya está esperando confirmación. El costo de que sobre es cero; el de que falte
            // es volver a preguntarle al técnico algo que acaba de contestar.
            const pareceRespuestaDeAgenda = pareceRespuestaDeAgendaPorTexto
                || ruteoIA?.intencion === 'confirma_que_va';

            // Tiene que nombrar el edificio: sin eso no se sabe a qué consorcio imputarle nada, y
            // abrir el caso en el edificio equivocado es peor que no abrirlo.
            const edifAviso = buscarEdificioEnTexto(msgClean, edificiosConocidos);
            const nombreEdifAviso = edifAviso?.nombre || '';

            // Y tiene que ser un edificio suyo. Con la cartera vacía (no se pudo averiguar) no se
            // rechaza: se sigue como antes.
            let esSuyo = true;
            if (nombreEdifAviso) {
                try {
                    const { edificiosDelProveedor } = require('./datos');
                    const carteraAviso = (await edificiosDelProveedor({ nombre: datosEmisor.nombre, telefono: from })) || [];
                    if (carteraAviso.length) {
                        esSuyo = carteraAviso.some(c => normalizarTextoEdificio(c.edificio) === normalizarTextoEdificio(nombreEdifAviso));
                    }
                } catch (e) { console.error('No se pudo validar la cartera para el aviso del técnico:', e.message); }
            }

            if (avisaQueVa && nombreEdifAviso && esSuyo) {
                const { direccionParaTecnico } = require('./agentes/marcos-ops');
                const dirAviso = await direccionParaTecnico(nombreEdifAviso);

                // El rubro sale de la ficha del proveedor, y en la planilla real eso viene vacío
                // seguido. Sin rubro no se puede saber después si un reclamo nuevo es otro caso, ni
                // cuál de los técnicos de una línea compartida escribió. Lo que la persona contó
                // ("un problema eléctrico en las luminarias") alcanza para deducirlo.
                // Manda lo que contó, no lo que dice su ficha: a Dario lo tenemos cargado como
                // "Electricista" y avisó por una pérdida de agua. Con el oficio de la ficha, ese
                // aviso quedaba con el mismo rubro que su caso eléctrico abierto en ese edificio
                // y se metía adentro en vez de abrir uno nuevo.
                const rubroAviso = rubroDelCaso(msgBodyParaRegistro, datosEmisor.especialidad);

                // AHORA SÍ SE SABE DE QUÉ ES EL TRABAJO: hay que volver a preguntarse quién escribe.
                //
                // El desempate entre los técnicos que comparten la línea corre ARRIBA, al entrar el
                // mensaje, cuando todavía no hay caso y por lo tanto no hay rubro con qué elegir.
                // En ese momento se queda con el primero de la planilla y marca `nombreIncierto`.
                //
                // Visto en producción: Dario avisó por un caño roto y el caso quedó abierto a
                // nombre de JULIO, que es el primero de esa línea. El rubro que lo habría resuelto
                // --plomería, deducido del texto-- se calcula acá, una línea más arriba, o sea
                // DESPUÉS de haber elegido el nombre. El dato correcto llegaba tarde.
                //
                // Con el rubro en la mano se vuelve a elegir, antes de escribir el caso: lo que
                // quede anotado acá es con quien Marcos va a hablar de ahora en más.
                if (rubroAviso && datosEmisor.nombreIncierto) {
                    try {
                        const { proveedoresPorTelefono } = require('./datos');
                        const enLaLinea = (await proveedoresPorTelefono(from)) || [];
                        const elCorrecto = enLaLinea.find(p => atiendeRubro(p.rubro, rubroAviso));
                        if (elCorrecto) {
                            console.log(`🎯 El aviso es de "${rubroAviso}": quien escribe desde ${from} es ${elCorrecto.nombre}, no ${datosEmisor.nombre}.`);
                            datosEmisor.nombre = elCorrecto.nombre;
                            datosEmisor.especialidad = elCorrecto.rubro || datosEmisor.especialidad;
                            datosEmisor.nombreIncierto = false;
                        }
                    } catch (e) { console.error('No se pudo reelegir el técnico con el rubro del aviso:', e.message); }
                }

                try {
                    const { guardarReporte } = require('./datos');
                    const resAviso = await guardarReporte({
                        edificio: nombreEdifAviso,
                        vecino: 'Avisado por el proveedor',
                        problema: msgBodyParaRegistro,
                        urgencia: /urgen|se inund|no anda|sin luz|sin agua|peligro|riesgo/i.test(txtLow) ? 'alta' : 'media',
                        // `avisado` = lo convocaron pero TODAVÍA no dijo que va. El caso se abre
                        // igual --el administrador tiene que enterarse-- pero no se da por hecha
                        // una visita que nadie prometió.
                        estado: confirmaQueVa ? 'en_proceso' : 'avisado',
                        // Si la línea la comparten varios técnicos y todavía no se sabe cuál
                        // escribe, se anota el teléfono igual: el administrador necesita a quién
                        // llamarle, y el nombre se completa cuando se resuelva.
                        tecnico: datosEmisor.nombre || '',
                        tel_tecnico: from || '',
                        rubro_tecnico: rubroAviso,
                        tipo: 'aviso_proveedor',
                        notas_ia: (confirmaQueVa
                                    ? `El técnico ${datosEmisor.nombre} avisó que lo convocaron directamente y que va a ir. `
                                    : `El técnico ${datosEmisor.nombre} avisó que lo convocaron. TODAVÍA NO CONFIRMÓ si va ni cuándo: se le preguntó. `) +
                                  `No hubo reclamo previo por este canal. Textual: "${require('./etiquetas-media').soloTexto(msgBodyParaRegistro)}"`,
                        historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBodyParaRegistro}`]),
                    });
                    const idAviso = resAviso?.id_evento || '';

                    // El administrador se entera AHORA, no cuando llegue la factura. Es la llamada
                    // que antes recibía él.
                    try {
                        const { avisarAlAdministrador } = require('./agentes/marcos-admin');
                        await avisarAlAdministrador({
                            edificio: nombreEdifAviso,
                            idEvento: idAviso,
                            motivo: confirmaQueVa
                                ? 'un proveedor avisó que lo convocaron y que va a ir'
                                : 'un proveedor avisó que lo convocaron, sin confirmar todavía si va',
                            titulo: confirmaQueVa
                                ? `🔧 MARCOS: UN PROVEEDOR VA A ${dirAviso}`
                                : `🔧 MARCOS: CONVOCARON A UN PROVEEDOR EN ${dirAviso}`,
                            cuerpo:
                                (confirmaQueVa
                                    ? `Un proveedor avisa que lo llamaron directamente y que va a ir.\n\n`
                                    : `Un proveedor avisa que lo llamaron directamente. Todavía NO confirmó si va ni cuándo -- ya se lo pregunté.\n\n`) +
                                `📍 Dirección: ${dirAviso}\n` +
                                `🔧 Quién: ${datosEmisor.nombre}${datosEmisor.especialidad ? ` (${datosEmisor.especialidad})` : ''}\n` +
                                `📱 Teléfono: ${from}\n` +
                                `\n🗣️ Textual:\n"${require('./etiquetas-media').soloTexto(msgBodyParaRegistro)}"\n` +
                                (idAviso ? `\n🤖 Quedó abierto como ${idAviso} en el panel.` : '') +
                                `\n\nSi este trabajo no corresponde, comuníquese con él antes de que vaya.`,
                            phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
                            accessToken: WHATSAPP_ACCESS_TOKEN
                        });
                    } catch (e) { console.error('No se pudo avisar a la Administración del aviso del proveedor:', e.message); }

                    // Queda como el caso activo de este técnico, así lo que mande después --una
                    // foto, la factura-- cae acá y no en un caso viejo. Se lee de la cola global
                    // y no de `stProv`: esa variable vive en otra rama del webhook y acá no existe.
                    const colaAviso = global.colasProveedores?.get(String(from).replace(/\D/g, ''));
                    if (colaAviso && idAviso) {
                        colaAviso.eventoActivoId = idAviso;
                        colaAviso.edificioActivo = nombreEdifAviso;
                        colaAviso.rubroActivo = rubroAviso || colaAviso.rubroActivo;
                        // A nombre de quién quedó el caso: desde acá en adelante se le habla a él
                        // y no se vuelve a deducir por rubro.
                        colaAviso.tecnicoDelCaso = datosEmisor.nombre || colaAviso.tecnicoDelCaso;
                    }

                    // Lo mismo si lo dijo de una: "me llamaron, voy en 3hs, tengo llave".
                    if (idAviso) {
                        try {
                            const { tieneAccesoPropio } = require('./contacto-ingreso');
                            if (tieneAccesoPropio(msgBodyParaRegistro)) {
                                const { marcarContactoAccesoAvisado } = require('./datos');
                                await marcarContactoAccesoAvisado(idAviso);
                                console.log(`🔑 ${datosEmisor.nombre} tiene acceso propio a ${nombreEdifAviso}: no se le manda el contacto de ingreso del [${idAviso}].`);
                            }
                        } catch (e) { console.error('No se pudo marcar que el técnico entra solo:', e.message); }
                    }

                    // Y se agenda el control. Sin esto el caso queda ABIERTO y nadie vuelve a
                    // preguntar nunca: se queda colgado en silencio, que es justo lo que el
                    // seguimiento existe para evitar.
                    //
                    // Si confirmó, el plazo sale de la HORA que él mismo dijo ("mañana a las 10")
                    // y no de una duración contada desde ahora, que es lo que hacía que Marcos
                    // preguntara "¿pudiste pasar?" a las 4 de la madrugada.
                    //
                    // Si NO confirmó, lo que se espera es su respuesta, no su visita: se vuelve a
                    // preguntar en un par de horas, y el paso 1 sabe --por el estado `avisado`--
                    // que tiene que preguntar "¿vas a poder pasar?" y no "¿pudiste pasar?".
                    if (idAviso) {
                        try {
                            const { programarSeguimiento } = require('./datos');
                            const { calcularPrimerControl, enHorarioRazonable } = require('./seguimiento');
                            await programarSeguimiento({
                                id_evento: idAviso,
                                cuando: confirmaQueVa
                                    ? calcularPrimerControl(msgBodyParaRegistro)
                                    : enHorarioRazonable(new Date(Date.now() + 2 * 60 * 60 * 1000)),
                                paso: 1,
                                nota: confirmaQueVa
                                    ? 'El proveedor avisó que lo convocaron y que va a ir'
                                    : 'El proveedor avisó que lo convocaron; falta que confirme si va'
                            });
                        } catch (e) { console.error('Error agendando el control del aviso del proveedor:', e.message); }
                    }

                    // Si no dijo que va, se le pregunta ACÁ MISMO en vez de esperar a que lo diga
                    // solo. Son las tres cosas que la Administración necesita saber y que solo él
                    // puede contestar: si va, cuándo, y si le hace falta que le gestionen algo.
                    const respAviso = confirmaQueVa
                        ? `Gracias por avisar, ${datosEmisor.nombre}. Lo registré como *${idAviso || 'caso nuevo'}* en ${dirAviso} y ya le avisé a la Administración de que vas.` +
                          ` Cuando termines, contame qué hiciste y mandame la factura por acá y la dejo asociada a este mismo caso.`
                        : `Gracias por avisarme, ${datosEmisor.nombre}. Lo dejé anotado como *${idAviso || 'caso nuevo'}* en ${dirAviso} y ya le avisé a la Administración.\n\n` +
                          `¿Vas a pasar? ¿Qué día y a qué hora te queda cómodo?\n` +
                          `¿Necesitás que gestione algo para entrar --que te esperen, el contacto del encargado, alguna llave?`;
                    await despacharRespuesta(recipient, respAviso, msgTypeRespuesta);
                    historial.push(`Marcos: ${respAviso}`);

                    console.log(`🔧 ${datosEmisor.nombre} avisó que va a ${nombreEdifAviso}: se abrió ${idAviso} y se notificó a la Administración.`);
                    return;
                } catch (e) {
                    console.error('Error registrando el aviso del proveedor:', e.message);
                }
            } else if (!nombreEdifAviso && (avisaQueVa || pareceRespuestaDeAgenda)) {
                // LA RESPUESTA A LA PREGUNTA DE RECIÉN.
                //
                // Marcos le preguntó "¿vas a pasar? ¿cuándo?" y él contesta "sí, mañana a las 10"
                // -- sin repetir la dirección, porque acaba de decirla. Pedírsela de nuevo es
                // hacerle repetir lo que ya dijo, que es exactamente lo que un humano no haría.
                //
                // El caso pendiente se busca en la PLANILLA y no en memoria: PM2 reinicia seguido
                // y una conversación a medias no puede depender de que el proceso siga vivo.
                let casoPendiente = null;
                if (confirmaQueVa || pareceRespuestaDeAgenda) {
                    try {
                        const { buscarCasosRecientesPorTecnico } = require('./datos');
                        const suyos = (await buscarCasosRecientesPorTecnico(datosEmisor.nombre, from, 7)) || [];
                        casoPendiente = suyos.find(c => !c.cerrado && /avisad|sin confirmar/i.test(String(c.estado || '')));
                    } catch (e) { console.error('No se pudo buscar el caso pendiente de confirmar:', e.message); }
                }

                if (casoPendiente) {
                    const { direccionParaTecnico } = require('./agentes/marcos-ops');
                    const dirPend = await direccionParaTecnico(casoPendiente.edificio);
                    try {
                        const { guardarReporte, programarSeguimiento } = require('./datos');
                        await guardarReporte({
                            id_evento: casoPendiente.id_evento,
                            edificio: casoPendiente.edificio,
                            estado: 'en_proceso',
                            tecnico: datosEmisor.nombre || '',
                            tel_tecnico: from || '',
                            historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBodyParaRegistro}`]),
                        });

                        // El control se ancla a la hora que acaba de prometer, no a un plazo
                        // contado desde ahora. `forzar` porque el caso ya tenía un control
                        // agendado --el de "todavía no contestó"-- y este lo reemplaza: ahora hay
                        // una promesa concreta contra la cual controlar.
                        const { calcularPrimerControl } = require('./seguimiento');
                        await programarSeguimiento({
                            id_evento: casoPendiente.id_evento,
                            cuando: calcularPrimerControl(msgBodyParaRegistro),
                            paso: 1,
                            nota: `Confirmó que va: "${String(msgBodyParaRegistro).slice(0, 60)}"`,
                            forzar: true
                        });
                    } catch (e) { console.error('Error confirmando el caso pendiente del proveedor:', e.message); }

                    const colaConf = global.colasProveedores?.get(String(from).replace(/\D/g, ''));
                    if (colaConf) {
                        colaConf.eventoActivoId = casoPendiente.id_evento;
                        colaConf.edificioActivo = casoPendiente.edificio;
                    }

                    // SI DIJO QUE ENTRA SOLO, NO SE LE EXPLICA QUIÉN LE ABRE.
                    //
                    // Marcos preguntó "¿necesitás que gestione algo para entrar?" y Daniel contestó
                    // "no, tengo llave y acceso al sistema" -- y Marcos le mandó igual el contacto
                    // del encargado. Preguntar y después no escuchar la respuesta es peor que no
                    // preguntar: le enseña al técnico que a Marcos se le puede contestar cualquier
                    // cosa porque no lo lee, y a partir de ahí deja de contestarle.
                    const { tieneAccesoPropio } = require('./contacto-ingreso');
                    const entraSolo = tieneAccesoPropio(msgBodyParaRegistro);
                    if (entraSolo) {
                        try {
                            const { marcarContactoAccesoAvisado } = require('./datos');
                            await marcarContactoAccesoAvisado(casoPendiente.id_evento);
                            console.log(`🔑 ${datosEmisor.nombre} tiene acceso propio a ${casoPendiente.edificio}: no se le manda el contacto de ingreso del [${casoPendiente.id_evento}].`);
                        } catch (e) { console.error('No se pudo marcar que el técnico entra solo:', e.message); }
                    }

                    const respConf = `Listo ${datosEmisor.nombre}, lo anoté en el *${casoPendiente.id_evento}* de ${dirPend} y le aviso a la Administración.` +
                        (entraSolo
                            ? ` Perfecto que tengas acceso, entonces no te gestiono nada para entrar.`
                            : ` Si necesitás que te esperen o que te consiga alguna llave, decime y lo gestiono.`) +
                        ` Cuando termines, contame qué hiciste y mandame la factura por acá.`;
                    await despacharRespuesta(recipient, respConf, msgTypeRespuesta);
                    historial.push(`Marcos: ${respConf}`);
                    console.log(`🔧 ${datosEmisor.nombre} confirmó la visita del [${casoPendiente.id_evento}] en ${casoPendiente.edificio}.`);
                    return;
                }

                // Sin caso pendiente, solo se pregunta la dirección si de verdad avisó que va.
                // Un "dale" suelto que no confirma nada no puede quedarse con el mensaje: sigue
                // su camino por el resto de la rama, como cualquier otro.
                if (avisaQueVa) {
                    const respDonde = `Perfecto ${datosEmisor.nombre}, ¿a qué dirección vas? Con eso le aviso a la Administración y te dejo el caso abierto, así después la factura se asocia sola.`;
                    await despacharRespuesta(recipient, respDonde, msgTypeRespuesta);
                    historial.push(`Marcos: ${respDonde}`);
                    return;
                }
            }
        }

        // B. MANEJO DE SOLICITUD DE DATOS/FOTOS/VIDEOS AL VECINO
        //
        // Esta rama es para cuando el TÉCNICO le pide a Marcos que le saque más información al
        // vecino ("necesito ver la cerradura de cerca", "pedile una foto"). Dos palabras de la
        // lista vieja no dicen eso ni de casualidad:
        //
        // - **`ver` suelto**, que matchea "hay que VER una cámara en San Patricio 270" -- que es
        //   un trabajo, no un pedido de datos. Y también "a ver", "verdad", "volver", "verificar".
        //   Lo que distingue un pedido es la PRIMERA PERSONA: "necesito ver" es un pedido, "hay
        //   que ver" es una descripción de trabajo.
        // - **`cerradura` suelta**, que es vocabulario diario de quien hace control de acceso.
        //   Nombrar una cerradura no es pedir nada; "necesito ver la cerradura" ya entra por
        //   "necesito ver".
        // > [!CAUTION]
        // > **Esta es la condición que produjo el bucle de las fotos.** Busca la palabra `foto` y
        // > nada más, así que *"la foto también es del caso"* y *"NO TE ESTOY PIDIENDO FOTOS DE
        // > NADA"* entraron las dos acá, y Marcos le contestó dos veces seguidas que iba a
        // > pedirle una foto al vecino.
        // >
        // > Es el ejemplo más claro de por qué el ruteo lo decide el modelo: para saber si esto
        // > es un PEDIDO hay que entender la oración, no encontrar una palabra adentro.
        const esSolicitudDatosPorTexto = /\bsolicitar|m[aá]s datos|mas datos|\bdetalles\b|\bpedirle?\b|\bped[ií]le\b|\bfoto|\bimagen|\bvideo|especifi|aclarar|\b(necesito|quiero|dejame|d[eé]jame|podr[ií]a|puedo|pod[eé]s|me deja) ver\b|\bver (bien|de cerca|mejor)\b/.test(txtLow);
        const esSolicitudDatos = seActiva('pide_datos_al_vecino', esSolicitudDatosPorTexto, ruteoIA, textoFinal);

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

            // ¿Ya tenemos lo que el técnico está pidiendo?
            //
            // El vecino manda la foto en el primer mensaje, junto con el problema. Cuando después el
            // técnico pregunta "¿tenés fotos?", pedírsela otra vez al vecino es hacerle repetir algo
            // que ya hizo: en la prueba terminó contestando "ya te la mandé, ¿no te acordás?" -- y
            // tenía razón, la foto estaba guardada de la primera vuelta.
            let fotoYaEnviada = false;
            const sesionVecino = telVecino
                ? (global.marcosSesiones?.get(telVecino) || global.marcosSesiones?.get(String(telVecino).replace(/\D/g, '')))
                : null;
            let guardada = sesionVecino?.mediaPendiente;

            // El caso es el que está atendiendo ESTE técnico. Antes acá decía `idEventoAsignado`,
            // que es la variable del camino del vecino y se declara cientos de líneas más abajo:
            // en esta rama todavía no existe, así que la línea reventaba con ReferenceError y el
            // técnico se quedaba sin respuesta justo cuando pedía datos.
            const idCasoDelTecnico = global.colasProveedores?.get(String(from).replace(/\D/g, ''))?.eventoActivoId || '';
            if (!guardada?.filePath && idCasoDelTecnico) {
                guardada = await materialDelVecinoEnCaso(idCasoDelTecnico, telVecino);
            }

            if (guardada?.filePath && (guardada.tipo === 'image' || guardada.tipo === 'video')) {
                const antiguedad = Date.now() - (guardada.recibidoEn || 0);
                if (antiguedad < 30 * 60 * 1000 && fs.existsSync(guardada.filePath)) {
                    try {
                        const idSubido = await subirMediaWhatsApp(guardada.filePath, guardada.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                        if (idSubido) {
                            const pie = `📱 *MARCOS — ${guardada.tipo === 'image' ? 'FOTO' : 'VIDEO'} DEL RECLAMO*\n\n` +
                                `Hola ${datosEmisor.nombre}, acá va ${guardada.tipo === 'image' ? 'la foto' : 'el video'} que ${nomVecino || 'el vecino'} ya había mandado del inconveniente en ${dirExacta}.`;
                            const { enviarImagenWhatsApp, enviarVideoWhatsApp } = require('./agentes/marcos-ops');
                            if (guardada.tipo === 'image') {
                                await enviarImagenWhatsApp(from, idSubido, pie, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                            } else {
                                await enviarVideoWhatsApp(from, idSubido, pie, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                            }
                            fotoYaEnviada = true;
                            console.log(`📷 El técnico pidió material y el vecino ya lo había mandado: se le reenvió de una, sin volver a molestarlo.`);
                        }
                    } catch (e) {
                        console.error('Error reenviando al técnico el material que ya teníamos:', e.message);
                    }
                }
            }

            const respTecnico = fotoYaEnviada
                ? `Ahí te mandé lo que ${nomVecino || 'el vecino'} ya había enviado sobre ${dirExacta}, ${datosEmisor.nombre}. Si necesitás algo más puntual, decime qué y se lo pido.`
                : `Perfecto ${datosEmisor.nombre}, ya mismo me contacto con el vecino (${identVecinoMsg}) en ${dirExacta} para solicitarle la foto, video o detalles indicados y te los reenvío apenas me responda.`;

            await despacharRespuesta(recipient, respTecnico, msgTypeRespuesta);
            historial.push(`Marcos: ${respTecnico}`);

            try {
                const { guardarReporte } = require('./datos');
                await guardarReporte({
                    edificio: edifNom,
                    tecnico: datosEmisor.nombre || '',
                    tel_tecnico: from || '',
                    rubro_tecnico: rubroDelCaso(msgBodyParaRegistro, datosEmisor.especialidad),
                    historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBodyParaRegistro}`, `Marcos (a Proveedor): ${respTecnico}`])
                });
            } catch (e) { console.error('Error guardando chat de proveedor:', e.message); }

            if (!fotoYaEnviada && telVecino && String(telVecino).replace(/\D/g, '') !== String(from).replace(/\D/g, '')) {
                const saludoNombre = nomVecino || 'estimado/a vecino/a';
                const msgParaVecino = `📋 *MARCOS — ATENCIÓN TÉCNICA*\n\n` +
                    `Hola ${saludoNombre}, el técnico asignado (*${datosEmisor.nombre}*) nos consulta si podrías enviarnos una foto, video o más detalles del inconveniente en ${dirExacta}${deptoVecino ? ' (Depto ' + deptoVecino + ')' : ''} para ir preparado con las herramientas correspondientes.`;
                
                await enviarWhatsApp(telVecino, msgParaVecino, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);

                if (!global.marcosSesiones) global.marcosSesiones = new Map();
                let sesVecino = global.marcosSesiones.get(telVecino);
                if (!sesVecino) {
                    sesVecino = { historial: [], fechaInicio: fechaHoraAR(), ultimoMensajeTimestamp: Date.now() };
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

        let accesosDelEdificio = [];
        try {
            const { buscarAccesosEdificio } = require('./datos');
            accesosDelEdificio = await buscarAccesosEdificio(edifNomCatchAll);
        } catch (e) { console.error('Error cargando accesos del edificio:', e.message); }

        // Qué mandó el vecino y si dejó foto o video. Sin estos dos datos el modelo no tenía nada
        // que decir sobre el reclamo y lo llenaba solo: en la prueba le escribió al técnico "el
        // vecino no ha provisto detalles adicionales ni material gráfico" cuando el vecino había
        // mandado una foto, dos audios y una ficha de contacto. Una afirmación así hace que el
        // técnico salga sin mirar nada y llegue sin saber a qué va.
        const colaCatchAll = global.colasProveedores?.get(String(from).replace(/\D/g, ''));
        const idCasoCatchAll = colaCatchAll?.eventoActivoId || '';
        let hayMaterialDelVecino = false;
        try {
            if (idCasoCatchAll) {
                const mat = await materialDelVecinoEnCaso(idCasoCatchAll, vecinoActivoCatchAll?.telefono);
                hayMaterialDelVecino = Boolean(mat?.filePath);
            }
        } catch (e) { console.error('Error mirando si el vecino dejó material en el caso:', e.message); }

        const respGenericaProveedor = await generarRespuestaTecnicoLibre({
            mensajeTecnico: msgBody,
            nombreTecnico: datosEmisor.nombre,
            vecino: vecinoActivoCatchAll,
            edificio: edifNomCatchAll,
            perfilEdificio: perfilEdifCatchAll,
            contactoAccesoExtra,
            accesosEdificio: accesosDelEdificio,
            idEvento: idCasoCatchAll,
            rubroDelCaso: colaCatchAll?.rubroActivo || '',
            hayMaterialDelVecino
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
            const { guardarReporte } = require('./datos');
            await guardarReporte({
                edificio: edifNomCatchAll,
                tecnico: datosEmisor.nombre || '',
                tel_tecnico: from || '',
                rubro_tecnico: rubroDelCaso(msgBodyParaRegistro, datosEmisor.especialidad),
                historial_chat: JSON.stringify([`Proveedor (${datosEmisor.nombre}): ${msgBodyParaRegistro}`, `Marcos (a Proveedor): ${respGenericaProveedor}`])
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
        const telsCto = ctoAcceso.telefonos?.length ? ctoAcceso.telefonos : [ctoAcceso.telefono];
        session.contactoAccesoExtra = `${ctoAcceso.nombre} (${telsCto.join(' / ')})`;
        // La ficha original se guarda tal cual para poder REENVIARLA como tarjeta, en vez de
        // desglosarla en texto. Con dos números, cualquier desglose obliga a elegir uno y el
        // técnico se queda sin saber si el otro también sirve.
        session.contactoAccesoFicha = contactosCompartidos.map(c => c.ficha).filter(Boolean);
        session.contactoAccesoNombre = ctoAcceso.nombre;
        console.log(`📞 Contacto de acceso guardado desde ficha compartida: ${session.contactoAccesoExtra}`);
        try {
            const { guardarAutorizacionContacto } = require('./datos');
            await guardarAutorizacionContacto({ telefono: from, autoriza: true, contactoAcceso: session.contactoAccesoExtra });
        } catch (e) { console.error('Error persistiendo autorización de contacto:', e.message); }
    }

    // Un número dictado de palabra NO pisa una ficha de contacto ya compartida: la ficha es el dato
    // explícito y completo, el número suelto puede ser cualquier cosa que el vecino mencionó al
    // pasar. Antes el orden era al revés y por eso el informe salía con el nombre y un número, y
    // el aviso de acceso con otro distinto.
    if (datosEmisor.rol !== 'proveedor' && !session.contactoAccesoFicha &&
        /pasal|pásal|pasale|llam[aá]|tel[eé]fono|celular|n[uú]mero/i.test(textoFinal || '')) {
        const telsMencionados = String(textoFinal || '').match(/\b\d{8,}\b/g) || [];
        const telPropio = String(from || '').replace(/\D/g, '');
        const telOtro = telsMencionados
            .map(t => t.replace(/\D/g, ''))
            .find(t => t.length >= 8 && !telPropio.endsWith(t) && !t.endsWith(telPropio.slice(-8)));
        if (telOtro) {
            session.contactoAccesoExtra = telOtro;
            console.log(`📞 Contacto alternativo de acceso guardado para el caso: ${telOtro}`);
            try {
                const { guardarAutorizacionContacto } = require('./datos');
                await guardarAutorizacionContacto({ telefono: from, autoriza: true, contactoAcceso: telOtro });
            } catch (e) { console.error('Error persistiendo autorización de contacto:', e.message); }
        }
    }

    // Escuchar datos de accesos que la persona menciona al pasar. No se espera: si tarda o falla,
    // la conversación sigue igual -- es información que se gana de yapa, nunca a costa de la
    // atención.
    if (session.nombreEdificio && textoFinal) {
        aprenderAccesosDeConversacion({
            texto: textoFinal,
            edificio: session.nombreEdificio,
            quienLoDijo: datosEmisor.rol === 'proveedor'
                ? `el técnico ${datosEmisor.nombre || ''}`.trim()
                : (vecino?.nombre && vecino.nombre !== 'Vecino' ? vecino.nombre : 'un vecino'),
            telefono: from
        }).catch(() => {});
    }

    // Si la sesión no tiene el contacto de acceso pero el vecino ya lo había autorizado antes, lo
    // recuperamos de la planilla. La sesión vive en RAM: un `pm2 restart` la borra entera, y ahí
    // Marcos volvía a dar por sentado que quien recibe al técnico es quien escribe -- justo el
    // error que hay que evitar cuando el vecino avisó que se iba y dejaba a otra persona.
    if (!session.contactoAccesoExtra && datosEmisor.rol !== 'proveedor') {
        try {
            const { buscarVecinosPorTelefono } = require('./datos');
            const vecinosGuardados = await buscarVecinosPorTelefono(from);
            const conAutorizacion = (vecinosGuardados || []).find(v => v.contactoAcceso);
            if (conAutorizacion?.contactoAcceso) {
                session.contactoAccesoExtra = conAutorizacion.contactoAcceso;
                console.log(`📞 Contacto de acceso recuperado de la planilla para ${from}: ${session.contactoAccesoExtra}`);
            }
        } catch (e) {
            console.error('Error recuperando contacto de acceso:', e.message);
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
        datosEmisor,
        // Quién va a recibir al técnico cuando NO es el vecino que escribe. Marcos-Cara recibía
        // `session` pero nunca leía nada de ella, así que este dato -- que sí le llegaba al
        // técnico -- no existía para el agente que le habla al vecino: al preguntarle quién
        // esperaba, contestaba el que había escrito, que era justamente el que se iba.
        contactoAccesoExtra: session.contactoAccesoExtra || '',
        // Lo que el técnico ya respondió sobre esta visita, para no volver a decir que se está
        // consultando algo que ya está contestado.
        confirmacionTecnico: session.confirmacionTecnico || await confirmacionDelCaso(from, {
            edificio: session.edificioId || session.nombreEdificio || datosEmisor.edificio || '',
            datosEmisor
        })
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
            const { buscarVecinosPorTelefono } = require('./datos');
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
        // La DIRECCIÓN, no el nombre interno. Estos cuatro mensajes van al técnico, y mezclarle
        // el alias con la calle en el mismo mensaje --"sobre la visita a san patricio casa … en
        // SAN PATRICIO 159"-- lo deja sin saber a cuál de las dos ir.
        const { direccionParaTecnico } = require('./agentes/marcos-ops');
        const edifDisp = await direccionParaTecnico(session.nombreEdificio) || 'el edificio';

        // Reenviar Imagen si el vecino mandó foto
        if (msgType === 'image' && media) {
            const uploadMediaId = await subirMediaWhatsApp(media.filePath, media.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            if (uploadMediaId) {
                const { enviarImagenWhatsApp } = require('./agentes/marcos-ops');
                const comentarioFoto = (textoFinal && textoFinal !== '(Imagen adjunta)')
                    ? await redactarNovedadParaTecnico({ textoVecino: textoFinal, nombreVecino: nomVecinoDisp, direccion: edifDisp })
                    : '';
                const captionProv = `📱 *MARCOS — FOTO ENVIADA POR EL VECINO*\n\nHola ${nomTech}, ${nomVecinoDisp}${deptoDisp} en ${edifDisp} envió esta foto para la visita.` + (comentarioFoto ? `\n\n${comentarioFoto}` : '');
                await enviarImagenWhatsApp(telTech, uploadMediaId, captionProv, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                console.log(`🖼️ Foto del vecino reenviada exitosamente al técnico ${telTech}`);
            }
        } 
        // Reenviar Video si el vecino mandó video
        else if (msgType === 'video' && media) {
            const uploadMediaId = await subirMediaWhatsApp(media.filePath, media.mimeType, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
            if (uploadMediaId) {
                const { enviarVideoWhatsApp } = require('./agentes/marcos-ops');
                const comentarioVideo = (textoFinal && textoFinal !== '(Video adjunto)')
                    ? await redactarNovedadParaTecnico({ textoVecino: textoFinal, nombreVecino: nomVecinoDisp, direccion: edifDisp })
                    : '';
                const captionProv = `📱 *MARCOS — VIDEO ENVIADO POR EL VECINO*\n\nHola ${nomTech}, ${nomVecinoDisp}${deptoDisp} en ${edifDisp} envió este video para la visita.` + (comentarioVideo ? `\n\n${comentarioVideo}` : '');
                await enviarVideoWhatsApp(telTech, uploadMediaId, captionProv, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                console.log(`🎥 Video del vecino reenviado exitosamente al técnico ${telTech}`);
            }
        } 
        // Reenviar Texto / Audio transcrito
        else {
            // El texto del vecino NO se reenvia crudo: se reescribe en neutro conservando los
            // datos operativos. Aca es donde se filtraba el enojo al tecnico -- llego a leer
            // textual "cuanto mas queres? Yo ya me fui del edificio".
            const novedadNeutra = await redactarNovedadParaTecnico({
                textoVecino: messageText,
                nombreVecino: nomVecinoDisp,
                direccion: edifDisp
            });
            if (novedadNeutra) {
                const infoReenvio = `📱 *MARCOS — NOVEDAD DEL VECINO*\n\n` +
                    `Hola ${nomTech}, sobre la visita a ${edifDisp}:\n\n${novedadNeutra}`;
                await enviarWhatsApp(telTech, infoReenvio, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                console.log(`➡️ Novedad del vecino reenviada al técnico ${telTech} (reescrita en neutro)`);
            } else {
                console.log(`🧹 La respuesta del vecino no aportaba datos para el técnico: no se reenvía.`);
            }
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
    // Ademas del adjunto de este mensaje, puede haber uno guardado de la rafaga anterior: el que
    // llego antes de que supieramos el edificio. Se toma el actual si existe, y si no el pendiente.
    let mediaParaTecnico = (media?.filePath && (msgType === 'image' || msgType === 'video'))
        ? { tipo: msgType, filePath: media.filePath, mimeType: media.mimeType, texto: textoFinal }
        : null;

    if (!mediaParaTecnico && session.mediaPendiente?.filePath) {
        const antiguedad = Date.now() - (session.mediaPendiente.recibidoEn || 0);
        // Media hora: pasado ese tiempo ya no es parte de esta conversacion.
        if (antiguedad < 30 * 60 * 1000 && fs.existsSync(session.mediaPendiente.filePath)) {
            mediaParaTecnico = session.mediaPendiente;
            console.log(`📎 Se recupera el adjunto que el vecino habia mandado en una vuelta anterior.`);
        } else {
            // Vencido o ya no esta en disco: recien ahi se descarta.
            delete session.mediaPendiente;
        }
    }

    if (mediaParaTecnico?.filePath) {
        const msgTypeMedia = mediaParaTecnico.tipo;
        const media = { filePath: mediaParaTecnico.filePath, mimeType: mediaParaTecnico.mimeType };
        const textoFinal = mediaParaTecnico.texto;
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
                    // Igual que en el reenvio a pedido: el comentario del vecino se reescribe en
                    // neutro antes de que lo lea el tecnico, nunca va entre comillas tal cual.
                    const comentarioLimpio = (textoFinal && !/^\(Imagen adjunta\)$|^\(Video adjunto\)$/i.test(textoFinal.trim()))
                        ? await redactarNovedadParaTecnico({ textoVecino: textoFinal, nombreVecino: nomVecinoAuto, direccion: edifAuto })
                        : '';
                    const comentarioAuto = comentarioLimpio ? `\n\n${comentarioLimpio}` : '';
                    // El pie se declara acá afuera porque unas líneas más abajo se usa para dejar el
                    // envío registrado en el chat del proveedor. Estaba declarado con `const` dentro
                    // de cada rama del if, así que al salir ya no existía: la foto le llegaba al
                    // técnico y justo después reventaba con "captionAuto is not defined", con lo cual
                    // el envío no quedaba anotado en el historial del caso.
                    let captionAuto;
                    // Se mira el resultado del envío. Antes se descartaba y el log escribía
                    // "foto reenviada al técnico" pasara lo que pasara: con Meta rechazando todo,
                    // el log decía que salió bien y al técnico no le llegaba nada. Un mensaje que
                    // no llega tiene que verse como lo que es.
                    let seEnvio = false;
                    // Al técnico se le habla con la DIRECCIÓN, no con el nombre interno del
                    // edificio: mandarle los dos ("san patricio casa" y después la calle y la
                    // altura) lo deja sin saber si son dos direcciones o una.
                    const { direccionParaTecnico } = require('./agentes/marcos-ops');
                    const dirFoto = await direccionParaTecnico(edifParaFoto);
                    // Y el número de caso va SIEMPRE. Es lo único con que el técnico puede decir
                    // después "esta factura es del CASO-1001": junta seis trabajos de la semana y
                    // los manda todos juntos.
                    const casoFoto = session.eventoActivoId || decisionCaso.id_evento || '';
                    const marcaCasoFoto = casoFoto ? ` [${casoFoto}]` : '';

                    if (msgTypeMedia === 'image') {
                        const { enviarImagenWhatsApp } = require('./agentes/marcos-ops');
                        captionAuto = `📱 *MARCOS — FOTO DEL RECLAMO${marcaCasoFoto}*\n\nHola ${tecnicoParaFoto.nombre}, ${nomVecinoAuto}${deptoAuto} en ${dirFoto} adjuntó esta foto del inconveniente.${comentarioAuto}`;
                        seEnvio = await enviarImagenWhatsApp(tecnicoParaFoto.telefono, uploadMediaIdAuto, captionAuto, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                    } else {
                        const { enviarVideoWhatsApp } = require('./agentes/marcos-ops');
                        captionAuto = `📱 *MARCOS — VIDEO DEL RECLAMO${marcaCasoFoto}*\n\nHola ${tecnicoParaFoto.nombre}, ${nomVecinoAuto}${deptoAuto} en ${dirFoto} adjuntó este video del inconveniente.${comentarioAuto}`;
                        seEnvio = await enviarVideoWhatsApp(tecnicoParaFoto.telefono, uploadMediaIdAuto, captionAuto, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
                    }
                    if (seEnvio) {
                        console.log(`📷 Foto/video del vecino reenviado al técnico ${tecnicoParaFoto.nombre} (${tecnicoParaFoto.telefono}).`);
                    } else {
                        console.error(`📷❌ La foto/video NO le llegó al técnico ${tecnicoParaFoto.nombre} (${tecnicoParaFoto.telefono}). El motivo está en la línea de arriba.`);
                    }
                    const tagMediaForward = (msgTypeMedia === 'image' ? '[IMAGEN:' : '[VIDEO:') + (imgUrl || videoUrl || `/archivos/${require('path').basename(media.filePath)}`) + ']';
                    const msgFotoParaChat = `Marcos (a Proveedor): ${tagMediaForward} ${captionAuto}`.trim();
                    try {
                        const { guardarReporte } = require('./datos');
                        await guardarReporte({
                            id_evento: session.eventoActivoId || decisionCaso.id_evento,
                            edificio: session.nombreEdificio || edifParaFoto,
                            tecnico: tecnicoParaFoto.nombre || '',
                            tel_tecnico: tecnicoParaFoto.telefono || '',
                            rubro_tecnico: tecnicoParaFoto.especialidad || '',
                            historial_chat: JSON.stringify([msgFotoParaChat])
                        });
                    } catch (e) { console.error('Error guardando registro de foto a técnico:', e.message); }

                    // Recien ahora se descarta: si el envio fallaba, el adjunto tenia que seguir
                    // disponible para el proximo intento en vez de perderse en silencio.
                    delete session.mediaPendiente;
                }
            }
        } catch (errFotoAuto) {
            console.error('⚠️ Error reenviando foto/video automáticamente al técnico:', errFotoAuto.message);
        }
    }

    // 2c. Si el vecino dejó un contacto de acceso (ficha compartida o teléfono dictado), el técnico
    // asignado tiene que RECIBIRLO de una, junto con la notificación del caso -- no solo si se le
    // ocurre preguntar. Es el dato que evita que llegue y se quede sin poder entrar.
    // La marca de "ya se lo pasé" vivía solo en la sesión, así que cada reinicio de PM2 la borraba y
    // el técnico volvía a recibir el mismo "CONTACTO PARA EL INGRESO" -- uno por cada mensaje del
    // vecino. Se le pregunta al caso, que sobrevive al reinicio.
    if (session.contactoAccesoExtra && !session.contactoAccesoAvisadoATecnico && idEventoAsignado) {
        try {
            const { fueContactoAccesoAvisado } = require('./datos');
            if (await fueContactoAccesoAvisado(idEventoAsignado)) {
                session.contactoAccesoAvisadoATecnico = true;
                console.log(`ℹ️ Al técnico ya se le había pasado el contacto de acceso del [${idEventoAsignado}], no se reenvía.`);
            }
        } catch (e) {
            console.error('Error chequeando si el contacto de acceso ya se había enviado:', e.message);
        }
    }

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
                const marcaCasoAcceso = idEventoAsignado ? ` [${idEventoAsignado}]` : '';
                const msgContactoAcceso = `📞 *MARCOS — CONTACTO PARA EL INGRESO${marcaCasoAcceso}*\n\n` +
                    `Hola ${tecnicoParaContacto.nombre}, para la visita en ${dirContacto} el vecino dejó este contacto para que le abran: *${session.contactoAccesoExtra}*.\n` +
                    (/\s\/\s/.test(session.contactoAccesoExtra)
                        ? `Tiene más de un número registrado: te paso la ficha completa acá abajo, probá con cualquiera.\n`
                        : '') +
                    `Si al llegar no te abren, comunicate directamente con esa persona y avisame cualquier inconveniente.`;
                // Se guarda si llegó: más abajo se marca el caso como "contacto avisado", y
                // marcarlo cuando el mensaje NO salió deja al técnico sin el dato para siempre,
                // porque esa marca justamente impide reintentarlo.
                const llegoContactoAcceso = await enviarWhatsApp(tecnicoParaContacto.telefono, msgContactoAcceso, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);

                // Y además la ficha tal como la mandó el vecino. Es lo que haría cualquier persona:
                // reenviar el contacto en vez de dictarlo. Con una ficha de dos números, cualquier
                // texto obliga a elegir uno y el técnico se queda sin saber si el otro también
                // sirve; la tarjeta llega completa y se guarda de un toque.
                if (Array.isArray(session.contactoAccesoFicha) && session.contactoAccesoFicha.length > 0) {
                    const { enviarContactoWhatsApp } = require('./agentes/marcos-ops');
                    await enviarContactoWhatsApp(
                        tecnicoParaContacto.telefono,
                        session.contactoAccesoFicha,
                        WHATSAPP_PHONE_NUMBER_ID,
                        WHATSAPP_ACCESS_TOKEN
                    );
                }

                const chatContactoAProv = [
                    `Marcos (a Proveedor): ${msgContactoAcceso}`
                ];
                if (session.contactoAccesoExtra) {
                    chatContactoAProv.push(`Marcos (a Proveedor): (Contacto compartido) ${session.contactoAccesoExtra}`);
                }
                try {
                    const { guardarReporte } = require('./datos');
                    await guardarReporte({
                        id_evento: session.eventoActivoId || decisionCaso.id_evento,
                        edificio: session.nombreEdificio || edifParaContacto,
                        tecnico: tecnicoParaContacto.nombre || '',
                        tel_tecnico: tecnicoParaContacto.telefono || '',
                        rubro_tecnico: tecnicoParaContacto.especialidad || '',
                        historial_chat: JSON.stringify(chatContactoAProv)
                    });
                } catch(e) { console.error('Error registrando contacto enviado a proveedor:', e.message); }

                // La marca de "ya avisado" solo se pone si el mensaje LLEGÓ. Ponerla igual haría
                // que no se reintente nunca más, y el técnico se queda sin saber a quién llamar
                // para que le abran -- que es justo el dato que lo deja parado en la puerta.
                if (llegoContactoAcceso) {
                    session.contactoAccesoAvisadoATecnico = true;
                    if (idEventoAsignado) {
                        const { marcarContactoAccesoAvisado } = require('./datos');
                        await marcarContactoAccesoAvisado(idEventoAsignado);
                    }
                    console.log(`📞 Contacto de acceso (${session.contactoAccesoExtra}) enviado al técnico ${tecnicoParaContacto.nombre} (${tecnicoParaContacto.telefono}).`);
                } else {
                    console.error(`📞❌ El contacto de acceso NO le llegó al técnico ${tecnicoParaContacto.nombre} (${tecnicoParaContacto.telefono}). No se marca como avisado, para poder reintentarlo.`);
                }
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
async function generarRespuestaTecnicoLibre({ mensajeTecnico, nombreTecnico, vecino, edificio, perfilEdificio, contactoAccesoExtra = '', accesosEdificio = [], idEvento = '', rubroDelCaso = '', hayMaterialDelVecino = false }) {
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
        // Cuando el vecino dejó un contacto de acceso es porque él NO va a estar. Su propio
        // teléfono deja de ser "el que le abre" y pasa a ser secundario: ofrecerlo primero hacía
        // que Marcos le dijera al técnico "llamá a Daniel, él te espera" justo después de que
        // Daniel avisara que se iba, y el técnico terminaba preguntando a cuál de los dos números
        // tenía que llamar.
        const telefonosAcceso = [
            contactoAccesoExtra ? `PARA ENTRAR, llamar a: ${contactoAccesoExtra}` : '',
            telVecinoAcceso
                ? (contactoAccesoExtra
                    ? `${identVecino} (hizo el reclamo, NO está en el edificio): ${telVecinoAcceso}`
                    : `${identVecino}: ${telVecinoAcceso}`)
                : '',
            perfilEdificio?.tel_seguridad ? `Portería/seguridad de la entrada: ${perfilEdificio.tel_seguridad}` : ''
        ].filter(Boolean).join(' | ') || 'Sin teléfono de contacto cargado todavía.';
        // Dónde está cada instalación y quién tiene la llave. Es lo que el técnico pregunta cuando
        // ya está en el lugar ("¿dónde está la sala de medidores?", "está con candado, ¿quién abre?")
        // y sin lo cual el trabajo se cae con el técnico parado en la puerta.
        const infoInstalaciones = (accesosEdificio || []).length
            ? (accesosEdificio || []).map(a => {
                const partes = [a.lugar];
                if (a.ubicacion) partes.push(`está en ${a.ubicacion}`);
                if (a.tipoAcceso) partes.push(`acceso: ${a.tipoAcceso}`);
                if (a.quienAbre) partes.push(`abre ${a.quienAbre}${a.telefono ? ` (${a.telefono})` : ''}`);
                if (a.notas) partes.push(a.notas);
                return `  · ${partes.join(' — ')}`;
            }).join('\n')
            : '  (todavía no hay datos cargados de instalaciones ni de llaves en este edificio)';

        const accesoInfo = contactoAccesoExtra
            ? `Quien le abre es ${contactoAccesoExtra}. ${identVecino} hizo el reclamo pero NO va a estar en el edificio: no lo mandes a llamarlo para entrar.`
            : (perfilEdificio?.tel_seguridad
                ? `Hay portería/seguridad en la entrada (tel: ${perfilEdificio.tel_seguridad}).`
                // NO se afirma que el acceso "ya está coordinado": puede no estarlo, y el técnico
                // organiza su viaje con eso. Es la misma familia de error que dar por hecho que
                // siempre abre la misma persona porque abrió una vez.
                : `No hay un contacto de ingreso confirmado para este edificio. Si pregunta, decile con franqueza que lo estás averiguando con la Administración.`);

        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `Sos Marcos, representante de la Administración de consorcios, escribiendo por WhatsApp a un TÉCNICO/PROVEEDOR (no a un vecino) que está atendiendo un reclamo.

El técnico ${nombreTecnico} te escribió: "${mensajeTecnico}"

Datos reales del caso que tenés disponibles:
${idEvento ? `- Caso: ${idEvento}\n` : ''}${rubroDelCaso ? `- Rubro del trabajo: ${rubroDelCaso}\n` : ''}- Vecino/solicitante: ${identVecino}
- Dirección: ${direccion}
- Material que dejó el vecino: ${hayMaterialDelVecino ? 'SÍ, hay foto o video del inconveniente guardado en el caso.' : 'no consta ninguno guardado (puede haberlo mandado igual: no lo afirmes).'}
- Acceso: ${accesoInfo}
- Teléfonos de contacto para el ingreso: ${telefonosAcceso}
- Instalaciones del edificio y quién tiene la llave de cada una:
${infoInstalaciones}

Si el técnico pregunta dónde está una instalación (sala de medidores, tablero, sala de máquinas,
bombas, llave de gas, terraza, tanque) o quién le abre, contestale con estos datos. Si el lugar que
pregunta NO figura arriba, decile con franqueza que no lo tenés cargado y que lo averiguás, y no lo
inventes: mandarlo al lugar equivocado le hace perder el viaje.

Instrucciones:
- Respondé de forma breve (1-2 oraciones), profesional, en "usted".
- Si te pregunta algo puntual (quién lo recibe, dirección, acceso, horario, etc.), contestale con el dato real de arriba. No inventes datos que no tenés: si no sabés algo puntual que pide, decile que lo estás confirmando y le respondés en breve.
- 🚨 SI EL TÉCNICO YA ESTÁ EN LA PUERTA, DICE QUE LLEGÓ, QUE NO HAY NADIE, QUE NO LE ABREN, O TE PIDE EL TELÉFONO DEL VECINO: DALE EL NÚMERO DE CONTACTO DE ARRIBA INMEDIATAMENTE, en ese mismo mensaje. Es una urgencia operativa: tiene que poder entrar. TENÉS TERMINANTEMENTE PROHIBIDO responderle "no es necesario que lo llame", "ya está coordinado" o cualquier variante que le niegue el teléfono -- eso lo deja parado en la calle sin poder trabajar. Si no tenés ningún teléfono cargado, decíselo con honestidad y avisale que estás contactando al vecino ahora mismo.
- NUNCA repitas la misma respuesta que ya diste antes. Si el técnico insiste con un pedido, es porque tu respuesta anterior no le sirvió: cambiá de enfoque y resolvé el problema concreto que tiene.
- Si te pregunta CÓMO o A QUIÉN entregar una factura/comprobante de pago (sin adjuntarla todavía, solo preguntando el procedimiento): decile que te la puede mandar directo por acá (foto o PDF) y vos la registrás para que la Administración la procese. NO le digas "ya recibí la factura" -- todavía no mandó nada, solo está preguntando.
- NUNCA le pidas nombre/departamento al técnico -- eso es del vecino, no de él.
- 🚨 EL CONTACTO DE INGRESO SE DA SOLO SI LO PIDE, o si dice que llegó y no le abren. Si te escribió
  por otra cosa --una corrección, un dato de la factura, un "gracias"-- NO se lo ofrezcas: contestá
  lo que te dijo y nada más. Pasó de verdad: el técnico escribió "perdón, es del caso 1003, no del
  1001" y la respuesta fue "para el CASO-1001 en San Patricio 159, quien le abrirá es Natalia
  Zeballos". Ese mensaje no venía a cuento de nada y encima nombraba otro edificio.
- Si el técnico te CORRIGE algo (dice que te equivocaste de caso, de edificio, de monto, o que algo
  que dijiste está mal): reconocé la corrección en una oración, decile qué vas a hacer con eso, y
  NO agregues datos que no pidió. Un "perdón, es del 1003" se contesta arreglando el 1003, no
  cambiando de tema.
- Si el técnico ya te dijo que tiene llave, código o acceso al sistema, NO le expliques quién le
  abre: ya te contestó eso. Preguntarle y después no leer la respuesta le enseña que no vale la
  pena contestarte.
- 🚨 TENÉS PROHIBIDO DECIRLE QUE EL VECINO NO MANDÓ NADA. Nunca escribas "el vecino no ha provisto detalles adicionales", "no adjuntó material gráfico", "no hay más información" ni ninguna variante. Vos NO ves el chat del vecino: lo único que sabés sobre eso es la línea "Material que dejó el vecino" de arriba, y ni siquiera esa cubre los audios ni lo que contó por escrito. Afirmar que no mandó nada cuando sí lo hizo hace que el técnico salga sin mirar nada y llegue sin saber a qué va, y al vecino le llega después que Marcos dijo que él no había informado. Si el técnico pide más datos y arriba dice que SÍ hay foto o video, decile que se lo estás mandando; si dice que no consta, decile simplemente que se lo pedís al vecino y se lo pasás.
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
        const { pregunta, seccion, historial } = req.body || {};
        if (!pregunta || !String(pregunta).trim()) {
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
Sos el Asistente Virtual Inteligente de ayuda interactiva del Dashboard AC (Atención a Consorcios).
Tu función es guiar amablemente a los clientes, responder sus dudas sobre el panel y explicarles qué hace cada sección o botón.

REGLAS DE ORO OBLIGATORIAS DE RESPUESTA:
1. NUNCA DIGAS QUE UNA FUNCIÓN NO EXISTE SI ESTÁ EN EL PANEL. Todo lo relativo a consorcios, encargados titulares, ayudantes de encargado, suplentes, personal de limpieza, vigiladores, accesos, proveedores, expensas y reclamos SÍ SE HACE DESDE ESTE PANEL. NUNCA mandes al usuario a escribir por WhatsApp si la tarea se resuelve dentro del panel.
2. PASOS ESCALONADOS Y SEPARADOS (FORMATO VISUAL): Cada paso DEBE ir obligatoriamente en su propia línea, separado de los demás por un salto de línea doble (\n\n). NUNCA pegues dos pasos en el mismo renglón o párrafo continuo. La gente que usa este panel apenas maneja el celular y necesita ver los pasos 1, 2 y 3 separados por renglones limpios.
3. NAVEGACIÓN VISUAL EXACTA: Indicá la ruta exacta en pantalla usando emojis y corchetes: ej. Menú Lateral ➡️ [ Mi Edificio ] ➡️ Bloque [ Personal, Limpieza y Seguridad ] ➡️ Botón [ + Añadir ].
4. NO REPETIR "HOLA" SI LA CHARLA YA EMPEZÓ: Si en el historial ya hay mensajes previos o el usuario responde a una pregunta tuya (ej: "sí", "dale", "bueno", "ya lo hice", "ok", "sí por favor"), NO VUELVAS A SALUDAR CON "HOLA" NI TE PRESENTES DE NUEVO. Avanzá directo al siguiente paso o respuesta de forma fluida y natural como una charla continua.
5. CIERRE INTERACTIVO: Terminá ofreciendo ayuda en el siguiente paso ("¿Querés que te guíe en algún otro dato?").
6. El usuario te está escribiendo actualmente desde la sección: "${seccion || 'Inicio / General'}".

BASE DE CONOCIMIENTO OFICIAL DEL DASHBOARD:
${conocimiento}
`.trim();

        const contents = [];
        if (Array.isArray(historial) && historial.length > 0) {
            for (const item of historial) {
                if (item && item.role && item.text) {
                    contents.push({
                        role: item.role === 'user' ? 'user' : 'model',
                        parts: [{ text: String(item.text) }]
                    });
                }
            }
        }
        if (contents.length === 0 || contents[contents.length - 1].role !== 'user' || contents[contents.length - 1].parts[0].text !== String(pregunta).trim()) {
            contents.push({ role: 'user', parts: [{ text: String(pregunta).trim() }] });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents,
            config: {
                systemInstruction,
                temperature: 0.3,
            },
        });

        const respuesta = response.text ? response.text.trim() : 'No pude procesar la respuesta.';
        return res.json({ respuesta });

    } catch (err) {
        console.error('Error en /api/asistente-consultar:', err.message);
        return res.status(500).json({ error: 'No se pudo procesar la consulta en este momento.' });
    }
});

// Barrido de seguimientos vencidos. Cada 5 minutos, y no con temporizadores en memoria: así un
// `pm2 restart` -- que este proceso tuvo más de 150 veces -- ya no borra escalaciones pendientes.
setInterval(() => {
    try {
        const { revisarSeguimientos } = require('./seguimiento');
        const datos = require('./datos');
        const ops = require('./agentes/marcos-ops');
        const { notificarEscalacionAlAdmin } = require('./agentes/marcos-admin');
        revisarSeguimientos({
            obtenerSeguimientosVencidos: datos.obtenerSeguimientosVencidos,
            programarSeguimiento: datos.programarSeguimiento,
            buscarTecnicoAsignado: datos.buscarTecnicoAsignado,
            buscarTecnicoSuplente: datos.buscarTecnicoSuplente,
            enviarWhatsApp: ops.enviarWhatsApp,
            notificarEscalacionAlAdmin,
            phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
            accessToken: WHATSAPP_ACCESS_TOKEN,
        }).catch(err => console.error('Error en el barrido de seguimientos:', err.message));
    } catch (err) {
        console.error('Error iniciando el barrido de seguimientos:', err.message);
    }
}, 5 * 60 * 1000);

iniciarCronReportes();

const dashboard = require('./dashboard');
app.use('/admin', dashboard);
app.use('/assets', express.static(path.join(__dirname, 'design', 'assets'), { maxAge: '7d' }));

// ── PWA MANIFEST & SERVICE WORKER EN RAÍZ ─────────────────────────────────
app.get(['/manifest.webmanifest', '/manifest.json'], (req, res) => {
    res.type('application/manifest+json');
    res.send(JSON.stringify({
        id: '/vecino',
        name: 'Marcos IA · Mi Consorcio',
        short_name: 'Mi Consorcio',
        description: 'Portal de Vecinos, Portería Virtual, Amenities y Reclamos de tu Consorcio',
        start_url: '/vecino',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'window-controls-overlay', 'minimal-ui'],
        background_color: '#F8FAFD',
        theme_color: '#0F326A',
        orientation: 'any',
        icons: [
            {
                src: '/admin/assets/logo.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/admin/assets/logo.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable'
            },
            {
                src: '/admin/assets/logo.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/admin/assets/logo.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
            }
        ],
        shortcuts: [
            {
                name: 'Portería & Timbre',
                short_name: 'Portería',
                url: '/vecino',
                icons: [{ src: '/admin/assets/logo.png', sizes: '192x192' }]
            },
            {
                name: 'Reservar Amenities',
                short_name: 'Amenities',
                url: '/vecino/amenities',
                icons: [{ src: '/admin/assets/logo.png', sizes: '192x192' }]
            }
        ]
    }));
});

app.get('/sw.js', (req, res) => {
    res.type('application/javascript');
    res.send(`
        const CACHE_NAME = 'marcos-pwa-v4';
        self.addEventListener('install', (e) => {
            self.skipWaiting();
        });

        self.addEventListener('activate', (e) => {
            e.waitUntil(
                caches.keys().then((keys) => {
                    return Promise.all(
                        keys.map((k) => caches.delete(k))
                    );
                }).then(() => self.clients.claim())
            );
        });

        self.addEventListener('fetch', (e) => {
            if (e.request.method !== 'GET') return;
            e.respondWith(
                fetch(e.request).catch(() => caches.match(e.request))
            );
        });
    `);
});

// ── PORTAL DEL VECINO — APAGADO POR DEFECTO ─────────────────────────────────────────────
//
// El portal está como prototipo: `POST /vecino/auth` no valida la contraseña (entra cualquiera
// que escriba algo), y `getVecinoSession` devuelve datos de ejemplo cuando no hay sesión, así
// que ni siquiera hace falta pasar por el login. Los datos que muestra son ficticios, de modo
// que hoy no se filtra información de nadie.
//
// Lo que sí cuesta es `POST /vecino/api/chat`: llama a Marcos de verdad, sin autenticación ni
// tope de uso. Cualquiera que encuentre la URL puede hacerlo responder y consumir la cuota de
// Gemini, que se paga.
//
// Por eso se sirve solo con PORTAL_VECINO=on en el .env. Se prende para desarrollar y se apaga
// para producción, hasta que el login sea real (contraseña hasheada, alta por el administrador)
// y las rutas exijan sesión. Cuando eso esté, se saca este interruptor.
//
// Se aceptan las formas obvias de decir que sí --`on`, `1`, `true`, `si`-- y no solo `on`. La
// versión anterior exigía la palabra exacta, y las DOS plantillas del .env (la de este repo y la
// que sumó otro agente) decían `PORTAL_VECINO=1`: con eso el portal quedaba apagado y la URL daba
// 404, sin ninguna pista de por qué. Un interruptor que solo entiende una forma de encenderse es
// un interruptor que alguien va a dejar apagado creyendo que lo prendió.
if (['on', '1', 'true', 'si', 'sí', 'yes'].includes(String(process.env.PORTAL_VECINO || '').toLowerCase().trim())) {
    const portalVecino = require('./portal-vecino');
    app.use('/vecino', portalVecino);
    app.use('/portal', portalVecino);
    console.log('🚧 Portal del vecino ACTIVO en /vecino y /portal — sin login real todavía. No dejar prendido en producción.');
} else {
    console.log(`🔒 Portal del vecino APAGADO. PORTAL_VECINO vale "${process.env.PORTAL_VECINO ?? '(sin definir)'}" ` +
                `y para prenderlo tiene que valer on / 1 / true. Mientras esté apagado, /vecino da 404.`);
}

// Portería Virtual & Timbre Inteligente Web
try {
    const porteriaRouter = require('./porteria');
    app.use('/porteria', porteriaRouter);
} catch (errPort) {
    console.warn('No se pudo cargar porteria router:', errPort.message);
}

app.listen(PORT, () => console.log(`🚀 Servidor Marcos corriendo en puerto ${PORT}`));