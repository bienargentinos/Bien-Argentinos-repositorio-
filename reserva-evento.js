// UNA RESERVA DE AMENITY TAMBIÉN ES UN EVENTO DEL EDIFICIO
//
// Cuando un vecino reserva el SUM, la parrilla o la pileta, el administrador tiene que verlo en el
// mismo lugar donde ve todo lo demás: la sección Eventos del panel. Si vive solo en la tabla
// `reservas_amenities`, hay que acordarse de ir a mirarla.
//
// ── POR QUÉ NO SE ESCRIBE LA FILA A MANO ────────────────────────────────────────────────────
//
// > [!CAUTION]
// > **Un `INSERT INTO reportes` directo se saltea todo lo que `guardarReporte` resuelve.**
//
// El pedido original venía con un código propio:
//
//     const codigoCaso = 'RES-' + Date.now().toString().slice(-4);
//
// Los últimos cuatro dígitos de un timestamp en milisegundos **se repiten cada 10 segundos**, y
// `codigo_caso` es UNIQUE en PostgreSQL (`db-pg.js:102`). Dos reservas hechas con diez segundos de
// diferencia --una familia reservando la parrilla y el SUM-- y la segunda no entra: el evento se
// pierde en silencio.
//
// `guardarReporte` ya asigna códigos correlativos (`CASO-${maxNum + 1}`), escribe en Sheets Y en
// PostgreSQL, crea las columnas que falten y respeta la posición de las que ya están. Reusarlo es
// gratis; reimplementarlo es volver a pisar cada mina que ya pisamos.
//
// ── Y POR QUÉ QUEDA `resuelto`, NO `pendiente` ──────────────────────────────────────────────
//
// > [!CAUTION]
// > **Un caso ABIERTO sin rubro se traga los reclamos de todo el edificio.**
//
// `sheets.js` engancha cada mensaje nuevo al caso abierto del mismo vecino o del mismo edificio, y
// solo lo separa si los RUBROS no coinciden. Una reserva no tiene rubro, y ahí la regla dice
// textual: *"el caso viejo no tiene rubro: no se puede afirmar"* → **no se separa**.
//
// O sea que con la reserva abierta, el vecino que después avisa "se cortó la luz del pasillo"
// tendría su reclamo pegado adentro de su reserva del SUM. Y por el paso 3 --que busca por
// edificio-- le pasaría lo mismo a cualquier vecino de ese edificio.
//
// Es exactamente el bug que documenta CLAUDE.md en "Cuándo un mensaje es OTRO caso", entrando por
// una puerta lateral.
//
// El estado del pago no se pierde: va en el texto del evento y vive, con su verdad, en
// `reservas_amenities`. `estado` en la tabla de casos significa "hay trabajo pendiente", y una
// reserva impaga no es un trabajo pendiente para un técnico.
//
// Además queda marcada con `tipo: 'reserva'`, y las búsquedas de "caso abierto" la ignoran por esa
// marca. Son dos cerrojos para lo mismo, a propósito: si mañana alguien decide que la reserva
// impaga sí tiene que quedar abierta, el segundo cerrojo la sigue manteniendo afuera del camino de
// los reclamos.

/**
 * El texto que ve el administrador en el panel. Queda así:
 *
 *     🎟️ Reserva de SUM · 10/09/2026 de 14:00 a 18:00 hs · $20.000 pendiente de pago
 */
function textoDeLaReserva({ amenity, fecha, horaDesde, horaHasta, monto = 0, estadoPago = '' }) {
    const partes = [`🎟️ Reserva de ${String(amenity || 'amenity').trim()}`];

    const f = String(fecha || '').trim();
    const desde = String(horaDesde || '').trim();
    const hasta = String(horaHasta || '').trim();
    const horario = desde && hasta ? `de ${desde} a ${hasta} hs` : (desde ? `desde las ${desde} hs` : '');
    const cuando = [f, horario].filter(Boolean).join(' ');
    if (cuando) partes.push(cuando);

    const m = Number(monto) || 0;
    if (m > 0) {
        // El estado del pago se dice en palabras y no como estado del caso: al administrador le
        // importa saber si tiene que ir a buscar la plata, no que le cuente como urgencia abierta.
        const pago = String(estadoPago || '').toLowerCase().trim();
        const comoVa = (pago === 'pagado' || pago === 'aprobado') ? 'pago'
            : (pago === 'comprobante' || pago === 'en_revision') ? 'comprobante enviado, a revisar'
            : 'pendiente de pago';
        partes.push(`$${m.toLocaleString('es-AR')} ${comoVa}`);
    } else {
        partes.push('sin costo');
    }

    return partes.join(' · ');
}

/**
 * Deja la reserva anotada como evento del edificio.
 *
 * No corta el flujo del que la llama: si esto falla, la reserva ya está hecha y guardada en su
 * propia tabla. Perder el evento del panel es molesto; perder la reserva del vecino porque el
 * panel falló, no tiene ninguna justificación.
 *
 * @returns {string} el código del caso creado, o '' si no se pudo.
 */
async function registrarReservaComoEvento(datosReserva = {}) {
    const {
        edificio = '', departamento = '', vecino = '', telefono = '',
        amenity = '', fecha = '', horaDesde = '', horaHasta = '',
        monto = 0, estadoPago = '', notas = '',
    } = datosReserva;

    if (!edificio || !amenity) {
        console.error('🎟️ No se pudo anotar la reserva como evento: falta el edificio o el amenity.');
        return '';
    }

    try {
        const { guardarReporte } = require('./datos');
        const detalle = textoDeLaReserva({ amenity, fecha, horaDesde, horaHasta, monto, estadoPago });

        const res = await guardarReporte({
            edificio,
            vecino: vecino || 'Vecino',
            telefono: String(telefono || ''),
            depto: departamento || '',
            problema: detalle,
            urgencia: 'baja',
            // Ver el comentario largo de arriba: abierta se comería los reclamos del edificio.
            estado: 'resuelto',
            tipo: 'reserva',
            notas_ia: `Reserva registrada desde el portal del vecino. ${detalle}` +
                (String(notas || '').trim() ? ` Nota del vecino: "${String(notas).trim()}"` : ''),
        });

        const codigo = res?.id_evento || '';
        console.log(`🎟️ Reserva de ${amenity} en ${edificio} anotada como evento${codigo ? ` [${codigo}]` : ''}.`);
        return codigo;
    } catch (err) {
        console.error(`🎟️ La reserva se guardó, pero no se pudo anotar como evento: ${err.message}`);
        return '';
    }
}

/** Si una fila de `reportes` es una reserva y no un reclamo. */
function esReserva(fila) {
    const tipo = typeof fila?.get === 'function' ? fila.get('tipo') : fila?.tipo;
    return String(tipo || '').toLowerCase().trim() === 'reserva';
}

module.exports = { registrarReservaComoEvento, textoDeLaReserva, esReserva };
