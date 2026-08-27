const { guardarReporte, guardarFactura, guardarMemoriaVecino, buscarPerfilEdificio, buscarCliente } = require('../datos');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

// Inicializar el transporte SMTP.
// Se incluye el parámetro tls.rejectUnauthorized: false para solucionar el error habitual
// de cadena de certificación no confiable / autofirmada de Ferozo en puerto 465.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.bienargentinos.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        rejectUnauthorized: false
    }
});

/**
 * Envía un correo electrónico de forma robusta con manejo explícito de errores y logs.
 * @param {string} to Dirección del destinatario
 * @param {string} subject Asunto del correo
 * @param {string} text Cuerpo en texto plano
 */
async function enviarEmail(to, subject, text) {
    try {
        console.log(`[SMTP] 📧 Intentando enviar email a ${to}...`);
        
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            throw new Error('Faltan configurar SMTP_USER o SMTP_PASS en las variables de entorno.');
        }

        const info = await transporter.sendMail({
            from: `"Marcos IA" <${process.env.SMTP_USER}>`,
            to,
            subject,
            text,
        });

        console.log(`[SMTP] 📧 Email enviado con éxito a ${to}. MessageId: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('[SMTP] ❌ Error enviando email. Detalle completo del error:', error);
        return false;
    }
}

/**
 * Le avisa al administrador de un edificio, por el canal que él eligió en el panel.
 *
 * Existe como función suelta porque el aviso a la Administración estaba enterrado adentro del
 * flujo del vecino (`reportarAlAdmin`), atado a un `decisionCaso` y a una ficha de vecino. Así no
 * había forma de avisarle por algo que no viniera de un reclamo -- por ejemplo que un técnico
 * avisó, al mandar la factura, que el trabajo quedó por la mitad y hace falta otro gremio.
 *
 * No manda nada dos veces por el mismo caso y motivo: la marca vive en el evento, no en memoria,
 * así que un reinicio de PM2 no vuelve a habilitar el mismo correo.
 *
 * @returns {boolean} si llegó por algún canal.
 */
async function avisarAlAdministrador({ edificio, idEvento = '', motivo, titulo, cuerpo, phoneNumberId, accessToken }) {
    if (!edificio) {
        console.warn('[Aviso] No se puede avisar a la Administración sin saber de qué edificio se trata.');
        return false;
    }

    try {
        if (idEvento) {
            const { fueAdminNotificado } = require('../datos');
            if (await fueAdminNotificado(idEvento)) {
                console.log(`[Aviso] ${idEvento} ya se había avisado a la Administración. No se repite.`);
                return false;
            }
        }

        const perfil = await buscarPerfilEdificio(edificio);
        if (!perfil?.adminNombre) {
            console.warn(`[Aviso] ⚠️ El edificio "${edificio}" no tiene administrador cargado en la pestaña EDIFICIOS.`);
            return false;
        }

        const cliente = await buscarCliente(perfil.adminNombre);
        if (!cliente) {
            console.warn(`[Aviso] ⚠️ No se encontró al administrador "${perfil.adminNombre}" en la pestaña CLIENTES.`);
            return false;
        }

        // El canal lo elige el administrador desde el panel.
        const quiereEmail = cliente.notifEmail !== false && Boolean(cliente.email);
        const quiereWsp   = cliente.notifWsp === true && Boolean(cliente.wsp);
        console.log(`[Aviso] "${cliente.nombre}" — email: ${quiereEmail ? cliente.email : 'no'} | WhatsApp: ${quiereWsp ? cliente.wsp : 'no'}`);

        let llegoPorAlgunLado = false;

        if (quiereEmail && await enviarEmail(cliente.email, titulo, cuerpo)) {
            llegoPorAlgunLado = true;
        }

        if (quiereWsp) {
            try {
                const { enviarWhatsApp } = require('./marcos-ops');
                // El administrador SÍ sabe que Marcos es una IA: acá no hace falta el tono de
                // persona que se usa con el vecino.
                await enviarWhatsApp(cliente.wsp, `*${titulo}*\n\n${cuerpo}`, phoneNumberId, accessToken);
                llegoPorAlgunLado = true;
            } catch (e) {
                console.error(`[Aviso] ⚠️ No se pudo avisar por WhatsApp a "${cliente.nombre}" (${cliente.wsp}):`, e.message);
            }
        }

        if (!quiereEmail && !quiereWsp) {
            console.warn(`[Aviso] ⚠️ "${cliente.nombre}" no tiene ningún canal: sin email ni WhatsApp cargado, o con las dos notificaciones apagadas.`);
        }

        // Se marca recién si llegó por algún canal: si fallaron todos, el aviso sigue pendiente y
        // el próximo mensaje puede reintentarlo.
        if (llegoPorAlgunLado && idEvento) {
            try {
                const { marcarAdminNotificado } = require('../datos');
                await marcarAdminNotificado(idEvento, motivo);
            } catch (e) {
                console.error('[Aviso] Error marcando el caso como avisado:', e.message);
            }
        }

        return llegoPorAlgunLado;
    } catch (err) {
        console.error('[Aviso] Error avisando a la Administración:', err.message);
        return false;
    }
}

/**
 * MARCOS-ADMIN
 * Genera reportes para el administrador humano.
 * Guarda todo en Google Sheets.
 * Actualiza la memoria del vecino para los próximos 60 días.
 */
async function reportarAlAdmin({
    vecino,
    decisionCaso,
    tecnicoAsignado,
    datosFactura,
    phoneNumberId,
    accessToken,
    fechaInicio,
    audio_url,
    transcripcion,
    historial_chat
}) {
    const tareasList = [];

    // ── 1. GUARDAR REPORTE DEL CASO ──
    const resumenReporte = decisionCaso.resumen_para_reporte || decisionCaso.resumen_problema || 'Consulta o reporte en curso';
    const resReporte = await guardarReporte({
        fechaInicio:   fechaInicio,
        telefono:      vecino?.telefono || '',
        audio_url:     audio_url || '',
        transcripcion: transcripcion || '',
        historial_chat: historial_chat || '',
        vecino:    vecino?.nombre    || 'Desconocido',
        edificio:  vecino?.edificio  || 'No especificado',
        depto:     vecino?.depto || vecino?.departamento || '',
        problema:  decisionCaso.resumen_problema || resumenReporte,
        urgencia:  decisionCaso.urgencia || 'baja',
        tecnico:   tecnicoAsignado?.nombre || '',
        tel_tecnico: tecnicoAsignado?.telefono || '',
        // Y si ninguno de los dos está cargado, se deduce de lo que contó el vecino. En la
        // planilla real los casos quedaban TODOS "sin rubro", y sin rubro no se puede saber
        // después si un reclamo nuevo es otro caso o la continuación de este.
        rubro_tecnico: tecnicoAsignado?.especialidad || decisionCaso.tipo_problema
                       || require('../rubros').rubroDelTexto(decisionCaso.resumen_problema || resumenReporte) || '',
        acceso:    tecnicoAsignado?.acceso || '',
        // Un caso se cierra cuando la IA decide que está resuelto y no queda nada que derivar.
        //
        // Antes se exigía además que NO hubiera técnico asignado, y eso hacía el cierre imposible en
        // el caso normal: un reclamo que se resolvió es justamente uno al que se le mandó un técnico.
        // El vecino avisaba "ya vino y lo arregló", Marcos le contestaba que quedaba registrado, y
        // el caso seguía en_proceso para siempre en la planilla y en el panel.
        estado: (decisionCaso.cerrar_caso && !decisionCaso.contactar_tecnico) ? 'cerrado' : 'en_proceso',
        notas_ia:  resumenReporte,
        tipo:      'whatsapp'
    });
    tareasList.push('reporte guardado en Sheets');

    // ── 2. GUARDAR FACTURA si Marcos-Docs encontró una ──
    if (datosFactura?.es_factura) {
        await guardarFactura({
            proveedor:      datosFactura.proveedor || (vecino?.nombre && vecino.nombre !== 'Vecino' ? `Vecino ${vecino.nombre}` : 'Comprobante Particular'),
            monto:          datosFactura.monto || 'Según comprobante',
            concepto:       datosFactura.concepto || 'Reembolso / Trabajo en consorcio',
            edificio:       datosFactura.edificio || vecino?.edificio || 'No especificado',
            url_archivo:    datosFactura.url_archivo || '',
            numero_factura: datosFactura.numero_factura || '',
            estado:         'Pendiente'
        });
        tareasList.push('factura registrada');
    }

    // ── 3. ACTUALIZAR MEMORIA DEL VECINO ──
    if (vecino && decisionCaso.resumen_para_memoria) {
        await guardarMemoriaVecino({
            telefono:         vecino.telefono || '',
            nombre:           vecino.nombre,
            resumenHistorial: decisionCaso.resumen_para_memoria,
            notasTrato:       decisionCaso.notas_trato,
        });
        tareasList.push('memoria actualizada');
    }

    // ── 4. ESCALAR AL ADMINISTRADOR HUMANO ──
    //
    // El mail al administrador NO es un aviso de cada evento: es para que TOME LAS RIENDAS cuando
    // Marcos no puede resolverlo solo. Antes salía con la sola urgencia alta, así que una misma
    // puerta rota generaba un correo por cada mensaje del vecino -- tres en una conversación --, y
    // el administrador terminaba ignorándolos justo cuando alguno importaba de verdad.
    //
    // Los motivos de escalación son: que no haya técnico para ese problema (acá), que el técnico no
    // conteste (lo maneja notificarEscalacionAlAdmin), y que la visita falle o quede a medias (lo
    // maneja el seguimiento del caso).
    const estadoCasoNorm = String(decisionCaso.estado || '').toLowerCase();
    const esCasoResuelto = estadoCasoNorm === 'resuelto' || estadoCasoNorm === 'cerrado' || decisionCaso.cerrar_caso === true;

    // El caso necesita un técnico y no hay ninguno cargado para ese rubro: Marcos no tiene a quién
    // mandar, y solo el administrador puede conseguir uno.
    const sinTecnicoParaElProblema = decisionCaso.contactar_tecnico === true && !tecnicoAsignado;
    const motivoEscalacion = sinTecnicoParaElProblema ? 'sin técnico asignado para el problema' : '';

    // Una sola vez por caso. La marca vive en el evento, no en memoria, así que un reinicio de PM2
    // no vuelve a habilitar el mismo correo.
    let yaEscalado = false;
    if (motivoEscalacion && resReporte?.id_evento) {
        try {
            const { fueAdminNotificado } = require('../datos');
            yaEscalado = await fueAdminNotificado(resReporte.id_evento);
        } catch (e) {
            console.error('[Email] Error chequeando si el caso ya se había escalado:', e.message);
        }
    }

    if (motivoEscalacion && !esCasoResuelto && !yaEscalado) {
        console.log(`[Email] 🚨 Escalando [${resReporte?.id_evento || 'caso'}] a la Administración: ${motivoEscalacion}.`);

        if (vecino?.edificio) {
            const perfil = await buscarPerfilEdificio(vecino.edificio);
            
            if (perfil) {
                console.log(`[Email] Edificio encontrado en Sheets: "${vecino.edificio}". Administrador asignado: "${perfil.adminNombre || 'Ninguno'}"`);
                
                if (perfil.adminNombre) {
                    const cliente = await buscarCliente(perfil.adminNombre);
                    
                    if (cliente) {
                        // El canal lo elige el administrador desde el panel. Hasta ahora esa
                        // preferencia se guardaba y se ignoraba: Marcos mandaba mail siempre, y el
                        // tilde de WhatsApp no hacía nada.
                        const quiereEmail = cliente.notifEmail !== false && Boolean(cliente.email);
                        const quiereWsp   = cliente.notifWsp === true && Boolean(cliente.wsp);

                        console.log(`[Escalación] Administrador "${cliente.nombre}" — email: ${quiereEmail ? cliente.email : 'no'} | WhatsApp: ${quiereWsp ? cliente.wsp : 'no'}`);

                        const titulo = `🚨 MARCOS: REQUIERE SU INTERVENCIÓN - ${vecino.edificio}`;
                        let mensaje = `Hay un caso que no se puede resolver sin usted.\n\n` +
                            `❗ Motivo: ${motivoEscalacion}\n\n` +
                            `📍 Edificio: ${vecino.edificio}\n` +
                            `🏠 Depto: ${vecino.departamento || 'Por confirmar'}\n` +
                            `👤 Vecino: ${vecino.nombre || 'Desconocido'}\n` +
                            `⚠️ Problema: ${decisionCaso.resumen_problema}\n` +
                            `🚦 Urgencia: ${(decisionCaso.urgencia || 'media').toUpperCase()}\n`;

                        if (sinTecnicoParaElProblema) {
                            mensaje += `\nNo figura ningún proveedor de ${decisionCaso.tipo_problema || 'ese rubro'} asignado a este edificio, ` +
                                `así que no hay a quién derivarlo. Hace falta que usted coordine el envío de un profesional ` +
                                `o cargue uno en el panel.\n`;
                        }

                        mensaje += `\n🤖 Este evento ya fue registrado en la pestaña EVENTOS del panel web.`;

                        let llegoPorAlgunLado = false;

                        if (quiereEmail) {
                            if (await enviarEmail(cliente.email, titulo, mensaje)) {
                                tareasList.push('administrador notificado por email');
                                llegoPorAlgunLado = true;
                            } else {
                                console.warn(`[Escalación] ⚠️ No se pudo enviar el correo al administrador (${cliente.email}).`);
                            }
                        }

                        if (quiereWsp) {
                            try {
                                const { enviarWhatsApp } = require('./marcos-ops');
                                // El administrador SÍ sabe que Marcos es una IA, así que acá no
                                // hace falta el tono de persona que se usa con el vecino.
                                await enviarWhatsApp(cliente.wsp, `*${titulo}*\n\n${mensaje}`, phoneNumberId, accessToken);
                                tareasList.push('administrador notificado por WhatsApp');
                                llegoPorAlgunLado = true;
                            } catch (e) {
                                console.error(`[Escalación] ⚠️ No se pudo avisar por WhatsApp al administrador (${cliente.wsp}):`, e.message);
                            }
                        }

                        if (!quiereEmail && !quiereWsp) {
                            console.warn(`[Escalación] ⚠️ El administrador "${cliente.nombre}" no tiene ningún canal disponible: sin email ni WhatsApp cargado, o con las dos notificaciones apagadas.`);
                        }

                        // Se marca recién si llegó por algún canal: si fallaron todos, el caso sigue
                        // sin escalar y el próximo mensaje puede reintentarlo.
                        if (llegoPorAlgunLado) {
                            try {
                                const { marcarAdminNotificado } = require('../datos');
                                await marcarAdminNotificado(resReporte?.id_evento, motivoEscalacion);
                            } catch (e) {
                                console.error('[Escalación] Error marcando el caso como escalado:', e.message);
                            }
                        }
                    } else {
                        console.warn(`[Email] ⚠️ Advertencia: No se encontró al administrador "${perfil.adminNombre}" en la pestaña CLIENTES del Sheets.`);
                    }
                } else {
                    console.warn(`[Email] ⚠️ Advertencia: El edificio "${vecino.edificio}" no tiene cargado un nombre de administrador en la pestaña EDIFICIOS.`);
                }
            } else {
                console.warn(`[Email] ⚠️ Advertencia: No se encontró un perfil para el edificio "${vecino.edificio}" en la pestaña EDIFICIOS.`);
            }
        } else {
            console.warn(`[Email] ⚠️ Advertencia: El caso tiene urgencia alta pero no se especificó un edificio válido en los datos del vecino.`);
        }
    }

    console.log(`✅ Marcos-Admin completó: ${tareasList.join(', ')}`);
    return { tareas: tareasList, id_evento: resReporte?.id_evento };
}

function iniciarCronReportes() {
    // Tarea programada cada 12 horas (8 AM y 8 PM)
    cron.schedule('0 8,20 * * *', async () => {
        console.log('⏳ Ejecutando Cron de Reportes cada 12 hs...');
        try {
            const { getSheet } = require('../datos'); // Requerimos local para evitar ciclos
            const sheetMod = require('../datos'); 
            const doc = await sheetMod.buscarPerfilEdificio(''); // dummy call just to init
            console.log('✅ Cron de reportes ejecutado.');
        } catch (err) {
            console.error('Error en cron de reportes:', err);
        }
    });
    console.log('⏰ Cron de reportes programado a las 08:00 y 20:00');
}

async function notificarEscalacionAlAdmin({ vecino, decisionCaso, tecnicoAsignado, intentosRealizados }) {
    try {
        const perfilEdificio = await buscarPerfilEdificio(vecino?.edificio);
        // El email del administrador NO vive en el perfil del edificio (ahí solo está su nombre):
        // hay que buscarlo en la pestaña "clientes", igual que hace reportarAlAdmin más arriba.
        // Antes se leía perfilEdificio.adminEmail -- un campo que no existe -- así que SIEMPRE
        // caía al fallback hardcodeado 'administracion@bienargentinos.com', una casilla que no
        // existe en el servidor de correo: cada alerta de escalación moría con "550 No Such User
        // Here" y la Administración nunca se enteraba de un caso urgente sin confirmar.
        let emailAdmin = '';
        if (perfilEdificio?.adminNombre) {
            const clienteEsc = await buscarCliente(perfilEdificio.adminNombre);
            if (clienteEsc?.email) emailAdmin = clienteEsc.email;
        }
        emailAdmin = emailAdmin || perfilEdificio?.adminEmail || process.env.ADMIN_EMAIL || '';

        if (!emailAdmin) {
            console.warn(`[Email] ⚠️ Escalación de ${vecino?.edificio || 'consorcio'} sin destinatario: el administrador no tiene email cargado en la pestaña CLIENTES ni hay ADMIN_EMAIL configurado.`);
            return;
        }

        const asunto = `🚨 ALERTA SIN CONFIRMACIÓN — ${vecino?.edificio || 'Consorcio'} [Urgencia: ${(decisionCaso?.urgencia || 'alta').toUpperCase()}]`;
        const cuerpo = `Estimada Administración,\n\n` +
            `El sistema de Marcos IA ha detectado que una solicitud de asistencia técnica no ha recibido confirmación de los proveedores asignados.\n\n` +
            `📌 DETALLES DEL EVENTO:\n` +
            `- Edificio: ${vecino?.edificio || '—'}\n` +
            `- Dirección: ${perfilEdificio?.direccion || '—'}\n` +
            `- Vecino / Depto: ${vecino?.nombre || 'Vecino'} (Depto ${vecino?.departamento || '—'})\n` +
            `- Problema: ${decisionCaso?.resumen_problema || 'Requerimiento técnico urgente'}\n` +
            `- Urgencia: ${(decisionCaso?.urgencia || 'alta').toUpperCase()}\n` +
            `- Intentos realizados: ${intentosRealizados || 1} proveedor(es) notificados sin confirmación.\n\n` +
            `Por favor, ingresar al Dashboard de Administración para supervisar el caso o comunicarse directamente con el consorcio.\n\n` +
            `Atentamente,\nMarcos IA — Servicio Técnico de Consorcios`;

        console.log(`🚨 Enviando alerta de escalación por email a la Administración (${emailAdmin})...`);
        await enviarEmail(emailAdmin, asunto, cuerpo);
    } catch (err) {
        console.error('Error enviando alerta de escalación al Admin:', err.message);
    }
}

module.exports = {
    reportarAlAdmin,
    notificarEscalacionAlAdmin,
    avisarAlAdministrador,
    iniciarCronReportes
};
