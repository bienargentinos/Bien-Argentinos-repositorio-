/**
 * SEGUIMIENTO DE CASOS — que un caso no se quede colgado en silencio
 *
 * Hasta ahora la escalación vivía en `setTimeout`, o sea en memoria RAM: cada `pm2 restart` los
 * borraba todos sin dejar rastro, y el proceso lleva más de 150 reinicios. Muchas escalaciones
 * simplemente nunca ocurrieron -- ni el suplente, ni el aviso al administrador -- y nadie se
 * enteró. Acá la fecha del próximo control vive en el caso y un barrido periódico levanta los
 * vencidos, así que un reinicio ya no pierde nada: como mucho lo atrasa unos minutos.
 *
 * Además cubre lo que antes no existía: qué pasa DESPUÉS de que el técnico confirma. El
 * temporizador viejo se cancelaba con la confirmación y a partir de ahí nadie volvía a preguntar
 * nada. Si el técnico se olvidaba o no llegaba, el caso quedaba abierto para siempre.
 *
 * La cadena, empezando siempre por el proveedor:
 *
 *   paso 1 → al vencer el plazo que dio: "¿pudiste pasar?"
 *   paso 2 → si no contesta o dice que no fue: se le pregunta a quien recibe en el edificio
 *   paso 3 → si tampoco hay respuesta: se busca suplente y se alerta al administrador
 */

const GRACIA_MS = 30 * 60 * 1000;      // margen sobre el plazo que dio el técnico
const ESPERA_RESPUESTA_MS = 30 * 60 * 1000; // cuánto se espera cada respuesta antes de subir un paso
const SIN_ETA_MS = 3 * 60 * 60 * 1000; // si confirmó sin dar horario

/**
 * Convierte a milisegundos el plazo que dijo el técnico ("en 2 horas", "hoy a la tarde").
 * Deliberadamente simple: ante la duda usa el plazo largo. Preguntar de más molesta al técnico;
 * preguntar de menos deja al vecino sin nadie.
 */
function estimarPlazoMs(eta) {
    const t = String(eta || '').toLowerCase();
    if (!t) return SIN_ETA_MS;

    const horas = t.match(/(\d+)\s*(h|hs|hora)/);
    if (horas) return parseInt(horas[1], 10) * 60 * 60 * 1000;

    const minutos = t.match(/(\d+)\s*(min|minuto)/);
    if (minutos) return parseInt(minutos[1], 10) * 60 * 1000;

    if (/ahora|ya salgo|en camino|enseguida/.test(t)) return 45 * 60 * 1000;
    if (/mañana/.test(t)) return 20 * 60 * 60 * 1000;
    if (/tarde/.test(t)) return 5 * 60 * 60 * 1000;
    if (/hoy/.test(t)) return 4 * 60 * 60 * 1000;

    return SIN_ETA_MS;
}

/** Cuándo hay que volver a mirar este caso después de que el técnico confirmó. */
function calcularPrimerControl(eta) {
    return new Date(Date.now() + estimarPlazoMs(eta) + GRACIA_MS);
}

async function procesarUnCaso(caso, deps) {
    const { enviarWhatsApp, buscarTecnicoAsignado, buscarTecnicoSuplente, programarSeguimiento,
            notificarEscalacionAlAdmin, phoneNumberId, accessToken } = deps;

    const id = caso.id_evento;
    const tecnicoNombre = caso.tecnico || 'el técnico';

    // Con quién hablar: el técnico asignado al caso.
    let tecnico = null;
    try {
        tecnico = await buscarTecnicoAsignado({ edificio: caso.edificio, especialidad: '', esUrgente: false });
    } catch (_) { /* sin técnico ubicable se sigue igual, un paso más arriba */ }

    if (caso.paso <= 1 && tecnico?.telefono) {
        // Paso 1 — se le pregunta primero al proveedor, que es quien sabe si estuvo.
        await enviarWhatsApp(
            tecnico.telefono,
            `🛠️ *MARCOS — SEGUIMIENTO [${id}]*\n\n` +
            `Hola ${tecnico.nombre || tecnicoNombre}, ¿pudiste pasar por ${caso.edificio}?\n` +
            `Si ya está resuelto avisame y cierro el caso. Si no llegaste a ir, decime y lo reprogramamos.`,
            phoneNumberId, accessToken
        );
        await programarSeguimiento({
            id_evento: id,
            cuando: new Date(Date.now() + ESPERA_RESPUESTA_MS),
            paso: 2,
            nota: 'Se le preguntó al proveedor si pasó'
        });
        console.log(`🛠️ Seguimiento [${id}] paso 1: se le preguntó al técnico si pudo pasar.`);
        return;
    }

    if (caso.paso === 2 && caso.telefono) {
        // Paso 2 — el técnico no contestó: se pregunta en el edificio, que es el testigo real.
        await enviarWhatsApp(
            caso.telefono,
            `📋 *MARCOS — SEGUIMIENTO*\n\n` +
            `Hola, ¿pasó el técnico por ${caso.edificio}? Quería confirmar si el inconveniente quedó resuelto.`,
            phoneNumberId, accessToken
        );
        await programarSeguimiento({
            id_evento: id,
            cuando: new Date(Date.now() + ESPERA_RESPUESTA_MS),
            paso: 3,
            nota: 'Se le preguntó al edificio si el técnico pasó'
        });
        console.log(`📋 Seguimiento [${id}] paso 2: se le preguntó al vecino si el técnico pasó.`);
        return;
    }

    // Paso 3 — nadie confirmó que la visita ocurrió: suplente y alerta al administrador.
    console.log(`🚨 Seguimiento [${id}] paso 3: sin confirmación de visita. Escalando.`);

    let suplente = null;
    try {
        suplente = await buscarTecnicoSuplente({
            edificio: caso.edificio,
            especialidad: '',
            telefonoTitular: tecnico?.telefono || ''
        });
    } catch (_) { /* puede no haber suplente cargado */ }

    if (suplente?.telefono) {
        await enviarWhatsApp(
            suplente.telefono,
            `🛠️ *MARCOS — SERVICIO PENDIENTE [${id}]*\n\n` +
            `Hola ${suplente.nombre}, tenemos un requerimiento sin resolver en ${caso.edificio}` +
            `${caso.problema ? `: ${caso.problema}` : ''}.\n¿Podés tomarlo? Avisame y coordino el acceso.`,
            phoneNumberId, accessToken
        );
        console.log(`🔁 Seguimiento [${id}]: derivado al suplente ${suplente.nombre}.`);
    }

    await notificarEscalacionAlAdmin({
        vecino: { edificio: caso.edificio, nombre: caso.vecino, departamento: caso.depto },
        decisionCaso: { resumen_problema: caso.problema, urgencia: caso.urgencia || 'alta' },
        tecnicoAsignado: tecnico || { nombre: tecnicoNombre },
        intentosRealizados: 3
    });

    // No se reprograma: a partir de acá el caso es del administrador. Seguir insistiendo solo
    // agregaría ruido sobre algo que ya está en manos de una persona.
    await programarSeguimiento({ id_evento: id, cuando: new Date(Date.now() + 24 * 60 * 60 * 1000), paso: 9, nota: 'Escalado al administrador' });
}

/**
 * Revisa los casos vencidos y actúa. Se llama periódicamente; cada corrida es independiente, así
 * que un reinicio en el medio no pierde nada.
 */
async function revisarSeguimientos(deps) {
    try {
        const { obtenerSeguimientosVencidos } = deps;
        const vencidos = await obtenerSeguimientosVencidos();
        if (!vencidos.length) return;

        console.log(`⏱️ ${vencidos.length} caso(s) con seguimiento vencido.`);
        for (const caso of vencidos) {
            // Un caso que falla no puede frenar a los demás.
            try {
                if (caso.paso >= 9) continue; // ya está en manos del administrador
                await procesarUnCaso(caso, deps);
            } catch (err) {
                console.error(`Error en el seguimiento de [${caso.id_evento}]:`, err.message);
            }
        }
    } catch (err) {
        console.error('Error revisando seguimientos:', err.message);
    }
}

module.exports = { revisarSeguimientos, calcularPrimerControl, estimarPlazoMs };
