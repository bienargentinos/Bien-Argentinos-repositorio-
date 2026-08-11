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
        acceso:    tecnicoAsignado?.acceso || '',
        estado: (decisionCaso.cerrar_caso && !decisionCaso.contactar_tecnico && !tecnicoAsignado) ? 'cerrado' : 'en_proceso',
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

    // ── 4. NOTIFICAR AL ADMINISTRADOR HUMANO (Solo email para URGENCIA ALTA Abierta y Sin Resolver) ──
    const estadoCasoNorm = String(decisionCaso.estado || '').toLowerCase();
    const esCasoResuelto = estadoCasoNorm === 'resuelto' || estadoCasoNorm === 'cerrado' || decisionCaso.cerrar_caso === true;

    if (decisionCaso.urgencia === 'alta' && !esCasoResuelto) {
        console.log(`[Email] 🚨 Caso de urgencia ALTA ABIERTA detectado. Iniciando notificación por email a la Administración...`);
        
        if (vecino?.edificio) {
            const perfil = await buscarPerfilEdificio(vecino.edificio);
            
            if (perfil) {
                console.log(`[Email] Edificio encontrado en Sheets: "${vecino.edificio}". Administrador asignado: "${perfil.adminNombre || 'Ninguno'}"`);
                
                if (perfil.adminNombre) {
                    const cliente = await buscarCliente(perfil.adminNombre);
                    
                    if (cliente) {
                        console.log(`[Email] Cliente/Admin encontrado: "${cliente.nombre}". Email: "${cliente.email || 'Ninguno'}"`);
                        
                        if (cliente.email) {
                            const titulo = `🚨 MARCOS: AVISO DE EMERGENCIA - ${vecino.edificio}`;
                            let mensaje = `Se ha reportado una EMERGENCIA.\n\n` +
                                `📍 Edificio: ${vecino.edificio}\n` +
                                `🏠 Depto: ${vecino.departamento || 'Por confirmar'}\n` +
                                `👤 Vecino: ${vecino.nombre || 'Desconocido'}\n` +
                                `⚠️ Problema: ${decisionCaso.resumen_problema}\n`;

                            if (tecnicoAsignado) {
                                mensaje += `🔧 Técnico asignado: ${tecnicoAsignado.nombre}\n`;
                            }
                            
                            mensaje += `\n🤖 Este evento ya fue registrado en la pestaña EVENTOS del panel web.`;
                            
                            const enviado = await enviarEmail(cliente.email, titulo, mensaje);
                            if (enviado) {
                                tareasList.push('administrador notificado por email');
                            } else {
                                console.warn(`[Email] ⚠️ No se pudo enviar el correo de emergencia al administrador (${cliente.email}).`);
                            }
                        } else {
                            console.warn(`[Email] ⚠️ Advertencia: El administrador "${perfil.adminNombre}" no tiene email configurado en la pestaña CLIENTES.`);
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
    iniciarCronReportes 
};
