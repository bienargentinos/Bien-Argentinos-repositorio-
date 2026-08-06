const { GoogleGenAI } = require('@google/genai');
const { guardarReporte, guardarMemoriaVecino } = require('../sheets');
const { enviarWhatsApp } = require('./marcos-ops');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function reportarAlAdmin({
    vecino,
    decisionCaso,
    tecnicoAsignado,
    datosFactura,
    phoneNumberId,
    accessToken,
    fechaInicio,
    audio_url,
    transcripcion
}) {
    try {
        console.log(`📝 Marcos-Admin procesando caso de ${vecino?.nombre} (${vecino?.edificio})...`);

        let idEvento = `CASO-${Date.now().toString().slice(-4)}`;

        // 1. Guardar reporte en la planilla Google Sheets
        if (typeof guardarReporte === 'function') {
            await guardarReporte({
                id_evento: idEvento,
                fecha: new Date().toLocaleDateString('es-AR'),
                hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                edificio: vecino?.edificio || 'No especificado',
                departamento: vecino?.departamento || vecino?.depto || '',
                vecino_nombre: vecino?.nombre || 'Desconocido',
                vecino_telefono: vecino?.telefono || '',
                tipo_problema: decisionCaso?.tipo_problema || 'otro',
                resumen_problema: decisionCaso?.resumen_problema || 'Sin descripción',
                urgencia: decisionCaso?.urgencia || 'baja',
                estado_emocional: decisionCaso?.estado_emocional || 'normal',
                tecnico_asignado: tecnicoAsignado?.nombre || 'No requerido',
                tecnico_telefono: tecnicoAsignado?.telefono || '',
                estado: decisionCaso?.cerrar_caso ? 'Cerrado' : 'Abierto',
                motivo_cierre: decisionCaso?.motivo_cierre || '',
                factura_proveedor: datosFactura?.proveedor || '',
                factura_monto: datosFactura?.monto || '',
                factura_url: datosFactura?.url_archivo || '',
                audio_url: audio_url || '',
                transcripcion: transcripcion || ''
            });
        }

        // 2. Actualizar memoria de 60 días del vecino si hay datos nuevos
        if (vecino?.telefono && decisionCaso?.resumen_para_memoria && typeof guardarMemoriaVecino === 'function') {
            await guardarMemoriaVecino({
                telefono: vecino.telefono,
                nuevoResumen: decisionCaso.resumen_para_memoria,
                nuevasNotasTrato: decisionCaso.notas_trato || ''
            });
        }

        // 3. Notificar al Admin en WhatsApp si es urgencia alta o requiere atención inmediata
        if (process.env.ADMIN_PHONE && (decisionCaso?.urgencia === 'alta' || decisionCaso?.estado_emocional === 'frustrado_enojado')) {
            const mensajeAdmin = `🚨 *MARCOS — REPORTE DE URGENCIA ALTA [${idEvento}]*\n\n` +
                `📍 *Edificio:* ${vecino?.edificio || 'Desconocido'}\n` +
                `🏠 *Depto:* ${vecino?.departamento || 'Por confirmar'}\n` +
                `👤 *Vecino:* ${vecino?.nombre || 'Desconocido'} (${vecino?.telefono || ''})\n` +
                `⚠️ *Problema:* ${decisionCaso?.resumen_problema}\n` +
                `😤 *Estado Emocional:* ${decisionCaso?.estado_emocional?.toUpperCase()}\n` +
                `🔧 *Técnico:* ${tecnicoAsignado ? tecnicoAsignado.nombre : 'Sin asignar'}\n\n` +
                `_Caso registrado en Google Sheets_`;

            await enviarWhatsApp(process.env.ADMIN_PHONE, mensajeAdmin, phoneNumberId, accessToken);
        }

        return idEvento;

    } catch (err) {
        console.error('Error en Marcos-Admin:', err.message);
        return null;
    }
}

function iniciarCronReportes() {
    console.log('⏰ Cron de reportes diarios inicializado.');
}

async function notificarEscalacionAlAdmin({ vecino, decisionCaso, tecnicoAsignado, intentosRealizados }) {
    if (!process.env.ADMIN_PHONE) return;
    const msgEscalacion = `🚨 *MARCOS — ESCALACIÓN POR FALTA DE RESPUESTA DE PROVEEDOR*\n\n` +
        `El técnico *${tecnicoAsignado?.nombre || 'Asignado'}* no respondió a los ${intentosRealizados || 2} intentos de notificación.\n` +
        `📍 *Edificio:* ${vecino?.edificio || 'A confirmar'}\n` +
        `⚠️ *Problema:* ${decisionCaso?.resumen_problema || 'Urgencia técnica'}\n\n` +
        `Por favor, contactar manualmente a otro proveedor o coordinar desde Administración.`;

    const { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN } = process.env;
    await enviarWhatsApp(process.env.ADMIN_PHONE, msgEscalacion, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN);
}

module.exports = { reportarAlAdmin, iniciarCronReportes, notificarEscalacionAlAdmin };
