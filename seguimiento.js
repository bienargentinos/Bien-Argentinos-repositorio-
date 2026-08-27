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

// A NADIE SE LE PREGUNTA NADA DE MADRUGADA.
//
// Un "¿pudiste pasar?" a las 3 de la mañana no lo contesta nadie, despierta a una persona y quema
// exactamente la confianza que Marcos necesita para existir. Y no cuesta nada evitarlo: el control
// que cae fuera de este rango se corre a la mañana siguiente. Perder ocho horas en un seguimiento
// no le hace daño a nadie; un mensaje a las 3 AM sí.
const HORA_DESDE = 8;
const HORA_HASTA = 22;

// Argentina no cambia de hora desde 2009, así que el desfase es fijo. Se hace la cuenta a mano y
// no con `toLocaleString` porque el Node de este VPS está compilado con ICU reducido y el formato
// en español se cae al inglés -- el mismo motivo por el que existe `fecha.js`.
const OFFSET_AR_MIN = -180;

/** Descompone un instante en fecha y hora ARGENTINA. */
function partesAR(fecha) {
    const t = new Date(fecha.getTime() + OFFSET_AR_MIN * 60000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes() };
}

/** Vuelve a armar un instante a partir de una fecha y hora argentina. */
function desdeAR({ y, m, d, h, min = 0 }) {
    return new Date(Date.UTC(y, m, d, h, min) - OFFSET_AR_MIN * 60000);
}

/** Corre a horario laboral un control que cayó de madrugada o de noche. */
function enHorarioRazonable(fecha) {
    const p = partesAR(fecha);
    if (p.h >= HORA_DESDE && p.h < HORA_HASTA) return fecha;
    const aLaManiana = desdeAR({ ...p, h: HORA_DESDE, min: 0 });
    // Antes de las 8 se corre a las 8 del MISMO día; después de las 22, a las 8 del siguiente.
    return p.h < HORA_DESDE ? aLaManiana : new Date(aLaManiana.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * A qué hora dijo que iba, en serio.
 *
 * > **"Mañana a las 10" es un MOMENTO, no una duración.**
 *
 * `estimarPlazoMs` devuelve siempre un plazo contado desde ahora: "mañana" eran 20 horas. Si el
 * técnico avisaba a las 8 de la mañana, el control caía a las 4 de la madrugada del otro día --
 * antes incluso de la hora a la que había prometido ir. Y si avisaba a las 19, caía a las 15 del
 * día siguiente, cinco horas tarde.
 *
 * Acá se lee la hora del reloj cuando está dicha ("mañana a las 10", "a las 18", "el lunes a la
 * tarde") y se ancla a ese momento real. Los plazos relativos ("en 30 minutos", "en 2 horas")
 * siguen contándose desde ahora, que es lo correcto para ellos.
 *
 * Devuelve `null` cuando el texto no dice ninguna hora: ahí decide `estimarPlazoMs` como siempre.
 */
function momentoPrometido(eta, ahora = new Date()) {
    const t = String(eta || '').toLowerCase().trim();
    if (!t) return null;

    // "Mañana" es dos palabras distintas: el día de mañana y la parte del día. Se saca primero la
    // parte del día para que "mañana a la mañana" no cuente como dos días.
    const sinParteDelDia = t.replace(/(a|de|por|en) la ma[nñ]ana/g, ' ');

    let diasAdelante = 0;
    let nombraUnDia = /\bhoy\b/.test(t);
    if (/pasado ma[nñ]ana/.test(t)) { diasAdelante = 2; nombraUnDia = true; }
    else if (/\bma[nñ]ana\b/.test(sinParteDelDia)) { diasAdelante = 1; nombraUnDia = true; }

    // La hora del reloj tiene que estar dicha como hora: "a las 10", "10:30", "9 am", "18 hs".
    // Un número suelto NO alcanza -- "en 2 horas" es una duración y se cuenta desde ahora.
    let hora = null;
    let minuto = 0;

    const reloj = t.match(/\ba\s+las?\s+(\d{1,2})(?:[:.](\d{2}))?/)
        || t.match(/\b(\d{1,2})(?:[:.](\d{2}))\s*(?:hs?\b|horas?\b)?/)
        || t.match(/\b(\d{1,2})\s*(?:am|pm)\b/)
        || t.match(/\b(\d{1,2})\s*hs\b/);

    if (reloj) {
        hora = parseInt(reloj[1], 10);
        minuto = parseInt(reloj[2] || '0', 10);
        // "8 de la tarde" son las 20. "8 de la mañana" son las 8. Sin aclaración se toma como
        // está: en Argentina se escribe "a las 18" tanto como "a las 6 de la tarde".
        if (/de la tarde|de la noche|\bpm\b/.test(t) && hora < 12) hora += 12;
        if (/de la ma[nñ]ana|\bam\b/.test(t) && hora === 12) hora = 0;
        if (hora > 23 || minuto > 59) hora = null;
    } else {
        // Sin hora exacta, la parte del día alcanza para no preguntar a cualquier hora.
        if (/mediod[ií]a/.test(t)) hora = 12;
        else if (/(a|de|por|en) la tarde|\bla tarde\b/.test(t)) hora = 15;
        else if (/(a|de|por|en) la noche|\bla noche\b/.test(t)) hora = 19;
        else if (/(a|de|por|en) la ma[nñ]ana/.test(t)) hora = 9;
        else if (/primera hora|temprano/.test(t)) hora = 8;
        // "Voy mañana", sin hora: tiene TODO el día. Preguntarle a las 8 de la mañana si ya pasó
        // es preguntar antes de que empiece. Se espera al final de la jornada, que es cuando la
        // promesa se puede dar por incumplida.
        else if (nombraUnDia) hora = 18;
    }

    if (hora === null) return null;

    const p = partesAR(ahora);
    let cuando = desdeAR({ y: p.y, m: p.m, d: p.d + diasAdelante, h: hora, min: minuto });

    // Si la hora que dijo ya pasó y no aclaró el día, se entiende que habla del día siguiente:
    // a las 14 nadie promete ir "a las 10" de esta mañana.
    if (cuando.getTime() <= ahora.getTime() && diasAdelante === 0) {
        cuando = new Date(cuando.getTime() + 24 * 60 * 60 * 1000);
    }
    return cuando;
}

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

/**
 * Cuándo hay que volver a mirar este caso después de que el técnico confirmó.
 *
 * Primero se intenta anclar a la hora que prometió; si no dijo ninguna, se usa el plazo estimado
 * contado desde ahora. En los dos casos se le suma la gracia y se corre fuera de la madrugada.
 */
function calcularPrimerControl(eta, ahora = new Date()) {
    const prometido = momentoPrometido(eta, ahora);
    const base = prometido ? prometido.getTime() : ahora.getTime() + estimarPlazoMs(eta);
    return enHorarioRazonable(new Date(base + GRACIA_MS));
}

async function procesarUnCaso(caso, deps) {
    const { enviarWhatsApp, buscarTecnicoAsignado, buscarTecnicoSuplente, programarSeguimiento,
            notificarEscalacionAlAdmin, phoneNumberId, accessToken } = deps;

    const id = caso.id_evento;
    // Con la DIRECCIÓN de la calle, nunca con el nombre interno del edificio: "san patricio
    // casa" es un alias nuestro y no le dice nada ni al técnico ni al vecino.
    const { direccionParaTecnico } = require('./agentes/marcos-ops');

    const tecnicoNombre = caso.tecnico || 'el técnico';

    // Con quién hablar: el técnico asignado al caso.
    let tecnico = null;
    try {
        tecnico = await buscarTecnicoAsignado({ edificio: caso.edificio, especialidad: '', esUrgente: false });
    } catch (_) { /* sin técnico ubicable se sigue igual, un paso más arriba */ }

    if (caso.paso <= 1 && tecnico?.telefono) {
        // Paso 1 — se le pregunta primero al proveedor, que es quien sabe si estuvo.
        //
        // PRIMERO SE CORRE LA FECHA, DESPUÉS SE MANDA.
        //
        // Al revés --que es como estaba-- si el mensaje sale pero la planilla no se puede
        // actualizar, el control sigue vencido y el barrido lo vuelve a mandar a los cinco
        // minutos. Y otra vez. Y otra. Al técnico le llega la misma pregunta para siempre.
        //
        // Reservando primero, un fallo cuesta una vuelta perdida en lugar de una repetición sin
        // fin. Y no se pierde nada importante: la cadena sigue en el paso 2, que le pregunta al
        // edificio.
        const reservado = await programarSeguimiento({
            id_evento: id,
            cuando: enHorarioRazonable(new Date(Date.now() + ESPERA_RESPUESTA_MS)),
            paso: 2,
            nota: 'Se le preguntó al proveedor si pasó'
        });
        if (!reservado) {
            console.warn(`🛠️ [${id}] no se pudo agendar el paso 2, así que NO se le pregunta al técnico: ` +
                         `mandar sin reservar es lo que hacía que la misma pregunta saliera una y otra vez.`);
            return;
        }

        const dirSeguimiento = await direccionParaTecnico(caso.edificio);

        // A un caso `avisado` NO se le pregunta si pudo pasar: el técnico nunca dijo que iba.
        // Avisó que lo convocaron y quedó pendiente de confirmar. Preguntarle "¿pudiste pasar?"
        // por algo que no se comprometió a hacer suena a reclamo por un incumplimiento inventado.
        const sinConfirmar = /avisad|sin confirmar/i.test(String(caso.estado || ''));

        await enviarWhatsApp(
            tecnico.telefono,
            `🛠️ *MARCOS — SEGUIMIENTO [${id}]*\n\n` +
            (sinConfirmar
                ? `Hola ${tecnico.nombre || tecnicoNombre}, quedó pendiente lo de ${dirSeguimiento}. ` +
                  `¿Vas a poder pasar? Si me decís qué día y a qué hora, aviso en el edificio para que te esperen.\n` +
                  `Y si no vas a poder ir, decímelo también y le busco una vuelta con la Administración.`
                : `Hola ${tecnico.nombre || tecnicoNombre}, ¿pudiste pasar por ${dirSeguimiento}?\n` +
                  `Si ya está resuelto avisame y cierro el caso. Si no llegaste a ir, decime y lo reprogramamos.`),
            phoneNumberId, accessToken
        );
        console.log(`🛠️ Seguimiento [${id}] paso 1: se le preguntó al técnico ${sinConfirmar ? 'si va a poder ir' : 'si pudo pasar'}.`);
        return;
    }

    if (caso.paso === 2 && caso.telefono) {
        // Paso 2 — el técnico no contestó: se pregunta en el edificio, que es el testigo real.
        // Igual que en el paso 1: primero se reserva el próximo control, después se manda. Y acá
        // importa todavía más, porque al que le llegaría la pregunta repetida es al vecino.
        const reservado = await programarSeguimiento({
            id_evento: id,
            cuando: enHorarioRazonable(new Date(Date.now() + ESPERA_RESPUESTA_MS)),
            paso: 3,
            nota: 'Se le preguntó al edificio si el técnico pasó'
        });
        if (!reservado) {
            console.warn(`📋 [${id}] no se pudo agendar el paso 3, así que NO se le pregunta al vecino.`);
            return;
        }

        await enviarWhatsApp(
            caso.telefono,
            // Al vecino tampoco se le habla con el alias interno: él vive ahí, pero el nombre que
            // usamos en la planilla ("san patricio casa") no es el que él usa.
            `📋 *MARCOS — SEGUIMIENTO*\n\n` +
            `Hola, ¿pasó el técnico por ${await direccionParaTecnico(caso.edificio)}? Quería confirmar si el inconveniente quedó resuelto.`,
            phoneNumberId, accessToken
        );
        console.log(`📋 Seguimiento [${id}] paso 2: se le preguntó al vecino si el técnico pasó.`);
        return;
    }

    // Paso 3 — nadie confirmó que la visita ocurrió: suplente y alerta al administrador.
    //
    // Se marca ANTES de escalar, por lo mismo: si el aviso sale y la marca no se guarda, el
    // administrador recibe el mismo mail de escalación cada cinco minutos.
    const marcado = await programarSeguimiento({
        id_evento: id, cuando: new Date(Date.now() + 24 * 60 * 60 * 1000),
        paso: 9, nota: 'Escalado al administrador'
    });
    if (!marcado) {
        console.warn(`🚨 [${id}] no se pudo marcar como escalado, así que NO se escala: ` +
                     `sin la marca el aviso saldría en cada barrido.`);
        return;
    }

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
            `Hola ${suplente.nombre}, tenemos un requerimiento sin resolver en ${await direccionParaTecnico(caso.edificio)}` +
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

    // No se reprograma: a partir de acá el caso es del administrador (ya quedó en paso 9 más
    // arriba). Seguir insistiendo solo agregaría ruido sobre algo que ya está en manos de una
    // persona.
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

                // Se relee el caso justo antes de actuar. La lista de vencidos puede venir de una
                // copia desactualizada, y un control que llega tarde a un caso ya resuelto no es
                // inofensivo: le pregunta al técnico si pudo pasar cuando ya pasó y facturó, después
                // le pregunta al vecino, y termina avisándole a la Administración que nadie
                // confirmó la visita. Tres molestias por un trabajo que salió bien.
                try {
                    const { buscarCasoPorCodigo } = require('./datos-pg');
                    const alDia = await buscarCasoPorCodigo(caso.id_evento);
                    if (alDia?.cerrado) {
                        console.log(`✅ [${caso.id_evento}] ya está resuelto: se descarta el seguimiento pendiente.`);
                        continue;
                    }
                } catch (_) { /* si no se puede verificar, se sigue: un control de más no rompe nada */ }

                await procesarUnCaso(caso, deps);
            } catch (err) {
                console.error(`Error en el seguimiento de [${caso.id_evento}]:`, err.message);
            }
        }
    } catch (err) {
        console.error('Error revisando seguimientos:', err.message);
    }
}

module.exports = { revisarSeguimientos, calcularPrimerControl, estimarPlazoMs, momentoPrometido, enHorarioRazonable };
