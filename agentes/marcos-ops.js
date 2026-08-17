const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

if (!global.colasProveedores) global.colasProveedores = new Map();
if (!global.timersEscalacionProveedores) global.timersEscalacionProveedores = new Map();

// ── FILTRO DE LO QUE SALE HACIA AFUERA ───────────────────────────────────────
// Todo lo que se le manda a un técnico o a un encargado pasa por acá antes de salir.
//
// El problema real que resuelve: `resumen_problema` lo redacta una IA a partir de la conversación,
// y cuando el vecino contestaba de mala manera ("otra vez lo mismo", "no vienen nunca", un insulto
// suelto), esa IA copiaba sus palabras y terminaban impresas en la orden de trabajo del técnico.
// El vecino no se entera de lo que le mandamos al proveedor, así que un roce social filtrado
// destruye una relación que él ni sabe que está en juego -- y el administrador de consorcio, con
// razón, lo cobraría como una falla del servicio.
//
// Instruir a la IA no alcanza: los modelos obedecen casi siempre, y "casi siempre" no sirve cuando
// el costo de una sola fuga es perder un cliente. Esto es el segundo cerrojo, determinístico.

const INSULTOS = /\b(pelotud\w*|bolud\w*|forr\w+|hij\w+\s+de\s+put\w+|put\w+|mierd\w*|cag\w+|jod\w+|carajo|choto\w*|pajer\w*|in[úu]til(es)?|verg[üu]enza|estaf\w+|chorr\w+|ladr[oó]n\w*|ladrones|incompetent\w*|desastr\w*|inservible\w*|verg\w+)\b/i;

// Frases con las que alguien se queja del SERVICIO. No describen una falla técnica: describen una
// relación. El técnico no tiene nada que hacer con esto.
const QUEJAS = /\b(otra vez|una vez m[aá]s|siempre lo mismo|de nuevo lo mismo|nunca vien\w+|no vien\w+ nunca|nadie (me |nos )?(soluciona|responde|atiende|contesta|hace nada)|hace\s+\S+\s+(d[ií]as?|semanas?|meses?|horas?)\s+que|ya (te|les|le|lo) (dije|avis[eé]|reclam[eé])|no sirv\w+ para nada|(estoy|estamos|me tienen|nos tienen)\s+(cansad\w+|hart\w+|podrid\w+)|no se puede vivir|es (una|un) (falta de respeto|tomada de pelo))\b/i;

// Marcas de que la oración está reproduciendo lo que dijo alguien, en vez de describir la falla.
const CITA = /["“”«»]|\b(vecin\w+|propietari\w+|inquilin\w+|se[ñn]or\w*|se[ñn]ora|encargad\w+)\s+(dice|dijo|coment[oó]|manifiesta|manifest[oó]|expresa|expres[oó]|se queja|reclama|insiste|aclara|remarca)\b|\btextual(es|mente)?\b/i;

/**
 * Deja el texto en condiciones de ser leído por un tercero.
 *
 * Trabaja por ORACIONES COMPLETAS, no palabra por palabra: si una oración tiene un insulto, una
 * queja sobre el servicio o está citando a alguien, se descarta entera. Recortar palabras sueltas
 * dejaba restos como "el plomero es un." -- peor que no filtrar, porque el técnico completa el
 * insulto solo y encima queda escrito por nosotros.
 *
 * Devuelve '' si no sobrevive nada utilizable, para que el llamador use un genérico.
 */
function limpiarParaTerceros(texto) {
    if (!texto) return '';

    const oraciones = String(texto)
        .replace(/\s+/g, ' ')
        .split(/(?<=[.;!?])\s+|\n+/)
        .map(o => o.trim())
        .filter(Boolean);

    const limpias = [];
    for (let o of oraciones) {
        if (INSULTOS.test(o) || QUEJAS.test(o) || CITA.test(o)) continue;

        // Gritos: una orden de trabajo no lleva mayúsculas sostenidas ni signos repetidos.
        const letras = o.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '');
        const mayus = o.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
        if (letras.length > 0 && mayus.length / letras.length > 0.6) {
            o = o.charAt(0) + o.slice(1).toLowerCase();
        }
        o = o.replace(/[!¡]+/g, '.').replace(/\?{2,}/g, '?').replace(/\.{2,}/g, '.');

        if (o.replace(/[^a-záéíóúñ]/gi, '').length < 8) continue;
        limpias.push(o.trim());
    }

    let t = limpias.join(' ').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
    if (t.replace(/[^a-záéíóúñ]/gi, '').length < 12) return '';
    if (t.length > 300) t = t.slice(0, 297).replace(/\s+\S*$/, '') + '...';
    if (!/[.?]$/.test(t)) t += '.';

    return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Descripción del requerimiento lista para mandar afuera, con un genérico por rubro cuando lo que
 * venía no era utilizable.
 */
function requerimientoParaTerceros(decisionCaso) {
    const limpio = limpiarParaTerceros(decisionCaso?.resumen_problema);
    if (limpio) return limpio;

    const rubro = decisionCaso?.tipo_problema;
    const generico = (rubro && rubro !== 'otro')
        ? `Requerimiento de ${rubro} en el edificio — a verificar en el lugar`
        : 'Requerimiento técnico a verificar en el lugar';
    console.log(`🧹 El resumen del caso no era apto para enviar afuera. Se usa el genérico: "${generico}"`);
    return generico;
}

/**
 * Reescribe en neutro lo que dijo el vecino, para poder reenviárselo al técnico.
 *
 * No alcanza con filtrar y listo: cuando el vecino contesta molesto suele decir igual cosas
 * operativamente importantes ("es el hall, no mi departamento", "ya me fui, recibe otra persona").
 * Borrar la oración entera por el tono le saca al técnico un dato que necesita; dejarla como está
 * le manda el enojo. Así que se reescribe el contenido y se descarta la forma.
 *
 * El resultado igual pasa por el filtro determinístico: el modelo es quien entiende el sentido,
 * pero no es quien decide si algo es publicable.
 */
async function redactarNovedadParaTecnico({ textoVecino, nombreVecino, direccion }) {
    const limpioDirecto = limpiarParaTerceros(textoVecino);

    try {
        const prompt = `Sos el asistente de una administración de consorcios. Un vecino le escribió a la administración y hay que pasarle al técnico SOLO la información útil para su visita.

Mensaje del vecino (${nombreVecino || 'vecino'} — ${direccion || 'edificio'}):
"""
${textoVecino}
"""

Devolvé SOLO el texto a reenviar al técnico, sin comillas ni encabezados, siguiendo estas reglas:
- Reescribilo en tercera persona y en tono neutro de parte administrativa.
- Conservá TODO dato operativo: ubicación exacta del problema, si el vecino va a estar o no, quién recibe, qué ya envió, horarios, accesos.
- ELIMINÁ por completo el enojo, los reproches, las ironías, los insultos y las quejas sobre el servicio o sobre el técnico. El técnico NUNCA debe percibir que el vecino estaba molesto.
- No cites ni parafrasees sus palabras textuales. No menciones su estado de ánimo.
- Máximo 2 oraciones. Si no hay ningún dato útil para la visita, devolvé exactamente: SIN_DATOS`;

        const resp = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const texto = String(resp?.text || '').trim();
        if (texto && !/SIN_DATOS/i.test(texto)) {
            const seguro = limpiarParaTerceros(texto);
            if (seguro) return seguro;
        }
        if (/SIN_DATOS/i.test(texto)) {
            console.log('🧹 La novedad del vecino no tenía datos útiles para el técnico: no se reenvía.');
            return '';
        }
    } catch (err) {
        console.error('Error redactando la novedad para el técnico:', err.message);
    }

    // Si el modelo falló, el filtro determinístico es el piso: peor es no avisarle nada al técnico,
    // pero mucho peor es mandarle el texto crudo.
    return limpioDirecto;
}

/**
 * Qué dijo realmente el técnico: ¿confirmó la visita? ¿dio un horario?
 *
 * Sin esto, Marcos recibía "Ok, confirmo, llego en 2 horas" y no le quedaba registro de nada: le
 * seguía mandando recordatorios pidiéndole la confirmación que ya había dado, y cuando el vecino
 * preguntaba a qué hora venía el técnico contestaba "estoy consultando" -- teniendo la respuesta
 * hacía rato. Para el vecino eso es una mentira, y para el técnico es que no le prestan atención.
 *
 * Primero se resuelven por texto las respuestas de los botones de la plantilla, que son fijas y no
 * merecen una llamada al modelo. Solo el texto libre pasa por la IA.
 */
const BOTON_CONFIRMA = /^\s*(recibido\s*\/?\s*en camino|en camino|recibido|voy en camino)\s*$/i;
const BOTON_RECHAZA  = /^\s*(no puedo|no disponible|rechazar|no voy)\s*$/i;

async function interpretarRespuestaTecnico({ mensaje }) {
    const texto = String(mensaje || '').trim();
    if (!texto) return { confirma: false, rechaza: false, eta: '' };

    if (BOTON_CONFIRMA.test(texto)) return { confirma: true, rechaza: false, eta: '' };
    if (BOTON_RECHAZA.test(texto))  return { confirma: false, rechaza: true, eta: '' };

    try {
        const prompt = `Un técnico de mantenimiento le respondió a la administración de un consorcio sobre una visita.

Mensaje del técnico:
"""
${texto}
"""

Devolvé SOLO un objeto JSON (sin markdown ni backticks):
{"confirma": true|false, "rechaza": true|false, "eta": "el horario o plazo que dio, tal como lo dijo, o cadena vacía"}

- "confirma": true si acepta ir, dice que va, que está en camino o que ya llegó.
- "rechaza": true si dice que no puede ir, que no está disponible o que lo derive a otro.
- "eta": el plazo u horario que menciona ("en 2 horas", "hoy a la tarde", "mañana temprano"). Vacío si no dijo ninguno.
- Si solo hace una pregunta y no se compromete, los dos van en false.`;

        const resp = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        const crudo = String(resp?.text || '').replace(/```json|```/g, '').trim();
        const d = JSON.parse(crudo);
        return {
            confirma: !!d.confirma && !d.rechaza,
            rechaza:  !!d.rechaza,
            eta:      String(d.eta || '').trim(),
        };
    } catch (err) {
        console.error('Error interpretando la respuesta del técnico:', err.message);
        return { confirma: false, rechaza: false, eta: '' };
    }
}

/**
 * Cómo se le describe al técnico DÓNDE tiene que ir.
 *
 * El departamento del vecino ubica a la persona, no al problema. Un vecino del 1A que reporta la
 * puerta del hall no tiene nada roto en su casa: mandarle al técnico "Depto 1A" lo hace tocar el
 * timbre equivocado, y al vecino le llega una orden de trabajo que no reconoce como suya ("no sé
 * para qué ponés departamento uno"). En áreas comunes se nombra el sector, no la unidad.
 */
function ubicacionParaTecnico({ vecino, decisionCaso }) {
    const depto = vecino?.departamento || vecino?.depto || '';
    if (decisionCaso?.area === 'comun') return 'Área común del edificio';
    return depto ? `Depto ${depto}` : '';
}

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

        if (resQueue.yaNotificado) {
            // Mismo caso ya notificado antes -- no repetimos plantilla, no reprogramamos
            // escalación de nuevo, ni volvemos a pedirle al encargado que coordine el acceso.
            mensajesEnviados.push({ destinatario: tecnicoAsignado.nombre, rol: 'tecnico', mensaje: `Ya notificado previamente (${idCasoFinal}), sin reenvío` });
        } else {
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

    // Si ya notificamos al técnico este MISMO caso, no le reenviamos la plantilla formal de
    // Meta de nuevo. Cada mensaje del vecino que reafirma el mismo reclamo (ej. "sí, estoy yo"
    // confirmando que va a estar para recibirlo) hace que Marcos-Caso vuelva a marcar
    // contactar_tecnico=true, y sin este chequeo el técnico recibía la plantilla completa
    // duplicada por cada mensaje nuevo del vecino en el mismo caso.
    if (estadoProv.notificado && estadoProv.eventoActivoId === id_evento) {
        console.log(`ℹ️ Técnico ya notificado del [${id_evento}], se omite el reenvío duplicado de la plantilla.`);
        return { encolado: false, yaNotificado: true };
    }

    // Respaldo por si el proceso se reinició (pm2 restart) entre el primer aviso y este mensaje:
    // la bandera en RAM (estadoProv) se pierde en cada reinicio, así que además chequeamos en
    // Sheets si este mismo caso ya tiene la plantilla marcada como enviada.
    const { fueTecnicoNotificado, marcarTecnicoNotificado } = require('../datos');
    if (await fueTecnicoNotificado(id_evento)) {
        console.log(`ℹ️ [Sheets] Técnico ya notificado del [${id_evento}] (detectado tras reinicio), se omite el reenvío duplicado.`);
        estadoProv.eventoActivoId = id_evento;
        estadoProv.notificado = true;
        return { encolado: false, yaNotificado: true };
    }

    estadoProv.eventoActivoId = id_evento;
    estadoProv.edificioActivo = vecino?.edificio;
    estadoProv.notificado = true;
    estadoProv.ultimoMensajeTimestamp = Date.now();

    await ejecutarEnvioNotificacionTecnico({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, id_evento });
    await marcarTecnicoNotificado(id_evento);
    return { encolado: false };
}

async function ejecutarEnvioNotificacionTecnico({ vecino, decisionCaso, tecnicoAsignado, personalDeTurno, phoneNumberId, accessToken, id_evento }) {
    const { buscarPerfilEdificio } = require('../datos');
    const perfilEdif = await buscarPerfilEdificio(vecino?.edificio);
    const direccionExacta = perfilEdif?.direccion || vecino?.direccion || vecino?.edificio || 'Consorcio';

    const rawNombre = (vecino?.nombre && vecino?.nombre !== 'Vecino' && vecino?.nombre !== 'Desconocido') ? vecino.nombre : 'Vecino';
    const rawDepto = vecino?.departamento || vecino?.depto || '';
    const ubicacionStr = ubicacionParaTecnico({ vecino, decisionCaso });
    const deptoStr = ubicacionStr ? `(${ubicacionStr})` : '';
    const vecinoConDepto = `${rawNombre} ${deptoStr}`.trim();

    const textoProblemaConCaso = `[${id_evento}] ${requerimientoParaTerceros(decisionCaso)}`;

    // Nota: esto va como parámetro dinámico dentro de la plantilla de Meta "notificacion_servicio_consorcio".
    // Nunca debe leerse como una tarea que el técnico tiene que gestionar por su cuenta -- el acceso lo
    // coordina Marcos (en representación de la Administración/edificio) directamente con el vecino, no el técnico.
    const accesoFinal = personalDeTurno
        ? `Encargado ${personalDeTurno.nombre} (${personalDeTurno.horario})`
        : `Ya coordinado por Marcos con ${vecinoConDepto} — lo va a estar esperando`;

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

    const resumenNotifProveedor = `Marcos (a Proveedor): [Plantilla WhatsApp] Hola ${tecnicoAsignado.nombre || 'Técnico'}, tenés una nueva solicitud de servicio en ${direccionExacta} para ${vecinoConDepto} — ${textoProblemaConCaso}. Urgencia: ${(decisionCaso.urgencia || 'media').toUpperCase()}. Acceso: ${tecnicoAsignado.acceso || accesoFinal}.`;

    try {
        const { guardarReporte } = require('../sheets');
        await guardarReporte({
            id_evento,
            edificio: vecino?.edificio || direccionExacta,
            tecnico: tecnicoAsignado.nombre || '',
            tel_tecnico: tecnicoAsignado.telefono || '',
            rubro_tecnico: tecnicoAsignado.especialidad || decisionCaso.tipo_problema || '',
            historial_chat: JSON.stringify([resumenNotifProveedor])
        });
    } catch (e) {
        console.error('Error registrando mensaje inicial a técnico en Sheets:', e.message);
    }

    try {
        const { guardarMensaje } = require('../db-pg');
        await guardarMensaje({
            eventoId: id_evento,
            edificio: vecino?.edificio || direccionExacta,
            telefono: tecnicoAsignado.telefono,
            remitente: 'marcos',
            mensaje: resumenNotifProveedor,
            tipoCanal: 'whatsapp'
        });
    } catch (e) {
        console.error('Error registrando mensaje inicial a técnico en PostgreSQL:', e.message);
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
        `⚠️ *Problema:* [${id_evento}] ${requerimientoParaTerceros(decisionCaso)}\n` +
        `🚦 *Urgencia:* ${decisionCaso.urgencia.toUpperCase()}\n\n` +
        `¿Podés revisar? Avisame cuando puedas.`;
}

async function generarMensajeTecnico({ vecino, decisionCaso, tecnicoAsignado, id_evento }) {
    const { buscarPerfilEdificio } = require('../datos');
    const perfilEdif = await buscarPerfilEdificio(vecino?.edificio);
    const direccionExacta = perfilEdif?.direccion || vecino?.direccion || vecino?.edificio || 'Consorcio';
    
    const nombreVecinoBase = (vecino?.nombre && vecino?.nombre !== 'Vecino' && vecino?.nombre !== 'Desconocido') ? vecino.nombre : 'Vecino a confirmar';
    const ubicacionStr = ubicacionParaTecnico({ vecino, decisionCaso });
    const deptoStr = ubicacionStr ? `(${ubicacionStr})` : '';
    const vecinoConDepto = `${nombreVecinoBase} ${deptoStr}`.trim();

    const emojiUrgencia = decisionCaso.urgencia === 'alta' ? '🚨' : '🛠️';
    return `${emojiUrgencia} *MARCOS — ORDEN DE TRABAJO [${id_evento}]*\n\n` +
        `Hola ${tecnicoAsignado.nombre}, te mando los detalles de una nueva asistencia:\n\n` +
        `📍 *Dirección:* ${direccionExacta}\n` +
        `👤 *Solicitante:* ${vecinoConDepto}\n` +
        `⚠️ *Sector y Requerimiento:* ${requerimientoParaTerceros(decisionCaso)}\n` +
        `🚦 *Urgencia:* ${decisionCaso.urgencia.toUpperCase()}\n` +
        `🔑 *Acceso:* ${tecnicoAsignado.acceso || `Ya coordinado por Marcos con ${vecinoConDepto} — lo va a estar esperando`}\n\n` +
        `Por favor confirmame si podés pasar. ¡Gracias!`;
}

/**
 * Reenvía una ficha de contacto tal como la mandó el vecino, como tarjeta de WhatsApp.
 *
 * Desglosar el contacto en texto obliga a elegir UN número, y una ficha puede tener dos (el
 * celular y el fijo, el personal y el del trabajo). Al elegir uno se pierde el otro y el técnico
 * recibe un dato incompleto sin saberlo. Reenviando la tarjeta pasa lo mismo que cuando una
 * persona reenvía un contacto: llegan todos los números, con su nombre, y se puede guardar de un
 * toque.
 *
 * @param {Array} contactos Las fichas crudas tal como llegaron en el webhook de Meta.
 */
/**
 * Meta NO acepta para enviar el mismo objeto que manda al recibir: la ficha entrante trae campos
 * que el envío rechaza, y exige `formatted_name`. Reenviar el crudo hacía que la API devolviera un
 * error y la tarjeta no llegara nunca -- el técnico veía solo el texto.
 * Por eso se arma una ficha nueva y mínima con lo único que hace falta.
 */
function fichaParaEnviar(c) {
    const nombre = c?.name?.formatted_name
        || [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ')
        || 'Contacto';

    const telefonos = (c?.phones || [])
        .map(p => {
            const numero = String(p?.phone || p?.wa_id || '').trim();
            if (!numero) return null;
            const t = { phone: numero, type: p?.type || 'CELL' };
            // wa_id hace que WhatsApp muestre el botón de "Enviar mensaje" en la tarjeta.
            if (p?.wa_id) t.wa_id = String(p.wa_id).replace(/\D/g, '');
            return t;
        })
        .filter(Boolean);

    if (telefonos.length === 0) return null;

    return {
        name: {
            formatted_name: nombre,           // obligatorio para Meta
            first_name: c?.name?.first_name || nombre,
            ...(c?.name?.last_name ? { last_name: c.name.last_name } : {}),
        },
        phones: telefonos,
    };
}

async function enviarContactoWhatsApp(to, contactos, phoneNumberId, accessToken) {
    if (!Array.isArray(contactos) || contactos.length === 0) return false;

    const limpias = contactos.map(fichaParaEnviar).filter(Boolean);
    if (limpias.length === 0) {
        console.log('👤 La ficha de contacto no tenía ningún teléfono utilizable: no se reenvía.');
        return false;
    }

    try {
        await axios.post(
            `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: normalizarTelefonoWhatsApp(to),
                type: 'contacts',
                contacts: limpias,
            },
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );
        console.log(`👤 Ficha de contacto reenviada a ${to}.`);
        return true;
    } catch (err) {
        // Si Meta rechaza la tarjeta, el llamador todavía puede mandar el texto: perder el dato
        // por completo sería peor que mandarlo desglosado.
        // Se registra la respuesta completa de Meta: si rechaza la tarjeta, el motivo exacto es lo
        // único que permite corregir el formato sin adivinar.
        const detalle = err.response?.data?.error;
        console.error('Error reenviando la ficha de contacto:',
            detalle ? `${detalle.message} (código ${detalle.code}${detalle.error_data?.details ? ' — ' + detalle.error_data.details : ''})` : err.message);
        return false;
    }
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

        // Meta devuelve el id del mensaje que acabamos de mandar, y se descartaba. Ese id es el que
        // llega cuando el otro CITA este mensaje: sin guardarlo, una respuesta citando algo que dijo
        // Marcos llegaba sin texto ("Sin texto guardado") y no se sabía de qué hablaba. Es
        // exactamente lo que hace el proveedor cuando busca la factura que mandó, la cita y escribe
        // "¿esto me pagaron?".
        const idEnviado = res?.data?.messages?.[0]?.id;
        if (idEnviado) {
            require('../db-pg').guardarTextoMensajeWa(idEnviado, textoLimpio);
        }
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

        const { buscarTecnicoSuplente } = require('../datos');
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
    enviarContactoWhatsApp,
    ubicacionParaTecnico,
    interpretarRespuestaTecnico,
    redactarNovedadParaTecnico,
    requerimientoParaTerceros,
    programarEscalacionProveedor,
    cancelarEscalacionProveedor,
    retransmitirMediaAlProveedor
};
