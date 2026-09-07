// Verifica que una reserva de amenity aparezca en el panel SIN meterse en el camino de los
// reclamos.
//
//   node pruebas-reserva-evento.js
//
// POR QUÉ. El pedido era simple: que una reserva del SUM se vea en la sección Eventos, junto con
// todo lo demás. Pero la tabla donde se ve eso (`reportes`) es la misma en la que viven los
// reclamos, y ahí adentro una fila de más no es inocente.
//
// > [!CAUTION]
// > **Un caso ABIERTO sin rubro se traga los reclamos de todo el edificio.**
//
// `sheets.js` engancha cada mensaje al caso abierto del mismo vecino o del mismo edificio, y solo
// lo separa si los RUBROS no coinciden. Una reserva no tiene rubro, y la regla dice --con razón--
// *"el caso viejo no tiene rubro: no se puede afirmar"* → no separa.
//
// O sea: con la reserva abierta, el vecino que reservó la parrilla y después avisa "se cortó la
// luz del pasillo" tendría su reclamo pegado adentro de la reserva. Y por el paso 3, que busca por
// EDIFICIO, le pasaría lo mismo a cualquier vecino de ese edificio.
//
// Hay dos cerrojos para eso, a propósito: la reserva se guarda como `resuelto`, Y está marcada con
// `tipo: 'reserva'` para que las búsquedas de "caso abierto" la ignoren aunque alguien mañana
// decida que una reserva impaga quede abierta.

const fs = require('fs');
const path = require('path');
const { textoDeLaReserva, esReserva } = require('./reserva-evento');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

console.log('\n── QUÉ VE EL ADMINISTRADOR ──');
{
    verificar('con arancel, dice cuánto y cómo va',
        textoDeLaReserva({ amenity: 'SUM', fecha: '10/09/2026', horaDesde: '14:00', horaHasta: '18:00', monto: 20000, estadoPago: 'pendiente' }),
        '🎟️ Reserva de SUM · 10/09/2026 de 14:00 a 18:00 hs · $20.000 pendiente de pago');

    verificar('sin arancel lo dice igual',
        textoDeLaReserva({ amenity: 'Parrilla', fecha: '10/09/2026', horaDesde: '20:00', horaHasta: '23:00' }),
        '🎟️ Reserva de Parrilla · 10/09/2026 de 20:00 a 23:00 hs · sin costo');

    verificar('con el comprobante ya enviado',
        textoDeLaReserva({ amenity: 'SUM', fecha: '10/09/2026', horaDesde: '14:00', horaHasta: '18:00', monto: 5000, estadoPago: 'comprobante' }),
        '🎟️ Reserva de SUM · 10/09/2026 de 14:00 a 18:00 hs · $5.000 comprobante enviado, a revisar');

    verificar('ya pago',
        textoDeLaReserva({ amenity: 'Pileta', fecha: '01/12/2026', horaDesde: '10:00', horaHasta: '12:00', monto: 3000, estadoPago: 'pagado' }),
        '🎟️ Reserva de Pileta · 01/12/2026 de 10:00 a 12:00 hs · $3.000 pago');

    // Sin horario cargado no se inventa uno ni queda un " de  a  hs" colgando.
    verificar('sin horario no queda basura',
        textoDeLaReserva({ amenity: 'SUM', fecha: '10/09/2026' }),
        '🎟️ Reserva de SUM · 10/09/2026 · sin costo');
}

console.log('\n── SE RECONOCE UNA RESERVA, VENGA DE DONDE VENGA ──');
{
    // De PostgreSQL y de Sheets las filas llegan distinto: unas con `.get()`, otras como objeto.
    verificar('fila de Sheets', esReserva({ get: (c) => (c === 'tipo' ? 'reserva' : '') }), true);
    verificar('objeto plano', esReserva({ tipo: 'reserva' }), true);
    verificar('con mayúsculas y espacios', esReserva({ tipo: ' Reserva ' }), true);
    verificar('un reclamo de WhatsApp no lo es', esReserva({ tipo: 'whatsapp' }), false);
    verificar('un aviso de proveedor tampoco', esReserva({ tipo: 'aviso_proveedor' }), false);
    verificar('sin tipo, no lo es', esReserva({}), false);
    verificar('null no rompe', esReserva(null), false);
}

console.log('\n── UNA RESERVA NUNCA SE LLEVA PUESTO UN RECLAMO ──');
{
    // Se lee la condición real de sheets.js: si alguien la toca y saca el chequeo, esto se cae.
    const SRC = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');
    const ini = SRC.indexOf('const esOtroCaso = (r) => {');
    if (ini === -1) throw new Error('No encontré `esOtroCaso` en sheets.js.');
    const fin = SRC.indexOf('\n        };', ini);
    const cuerpo = SRC.slice(ini, fin + '\n        };'.length);

    // eslint-disable-next-line no-new-func
    const armar = new Function('require', 'rubro_tecnico', 'problema',
        `const rubroEntrante = String(rubro_tecnico || '').trim();
         const traeProblemaPropio = Boolean(String(problema || '').trim());
         const { coincideRubro } = require('./rubros');
         const { esReserva } = require('./reserva-evento');
         ${cuerpo}
         return esOtroCaso;`);

    const fila = (tipo, rubro) => ({ get: (c) => (c === 'tipo' ? tipo : c === 'rubro_tecnico' ? rubro : '') });

    // El caso que importa: el vecino reservó la parrilla y después avisa de un problema eléctrico.
    const conReclamo = armar(require, 'electricidad', 'se cortó la luz del pasillo');
    verificar('un reclamo NO se engancha a una reserva',
        conReclamo(fila('reserva', '')), true);

    // Y esto es lo que pasaba sin el chequeo: la reserva no tiene rubro, así que la regla vieja
    // decía "no se puede afirmar" y lo enganchaba igual.
    verificar('un caso viejo SIN rubro sí lo sigue recibiendo (regla de siempre)',
        conReclamo(fila('whatsapp', '')), false);

    verificar('y un caso de otro rubro se separa, como antes',
        conReclamo(fila('whatsapp', 'plomería')), true);
    verificar('mismo rubro, se engancha',
        conReclamo(fila('whatsapp', 'electricidad')), false);

    // Un mensaje de puro registro (sin problema propio) nunca separa -- salvo de una reserva.
    const sinReclamo = armar(require, '', '');
    verificar('un mensaje sin problema propio tampoco se pega a una reserva',
        sinReclamo(fila('reserva', '')), true);
    verificar('pero sí sigue al caso normal',
        sinReclamo(fila('whatsapp', 'electricidad')), false);
}

console.log('\n── NO SE INVENTA UN CÓDIGO DE CASO PROPIO ──');
{
    // > [!CAUTION]
    // > `'RES-' + Date.now().toString().slice(-4)` se repite cada 10 SEGUNDOS.
    //
    // Y `codigo_caso` es UNIQUE en PostgreSQL (`db-pg.js`). Dos reservas con diez segundos de
    // diferencia --una familia reservando la parrilla y el SUM-- y la segunda no entra: el evento
    // se pierde en silencio.
    //
    // Se demuestra en vez de explicarse: dos timestamps a 10 segundos dan el mismo código.
    const t = 1789000000000;
    const codigo = (ms) => 'RES-' + String(ms).slice(-4);
    verificar('el código propuesto colisiona a los 10 segundos',
        codigo(t) === codigo(t + 10000), true);

    // Por eso la reserva usa `guardarReporte`, que ya asigna códigos correlativos y escribe en
    // los dos lados. El candado: que nadie vuelva a generar un código a mano acá.
    const SRC = fs.readFileSync(path.join(__dirname, 'reserva-evento.js'), 'utf8');
    const sinComentarios = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    verificar('reserva-evento.js no arma códigos de caso',
        /Date\.now\(\)[^\n]*slice|codigo_caso\s*:/.test(sinComentarios), false);
    verificar('y no escribe en la base por su cuenta',
        /INSERT INTO|pool\.query/.test(sinComentarios), false);
    verificar('usa guardarReporte, que escribe en Sheets y en PostgreSQL',
        /guardarReporte/.test(sinComentarios), true);
}

console.log('\n── LA RESERVA NO SE PIERDE SI FALLA EL PANEL ──');
{
    // El vecino ya reservó. Que el historial del administrador falle no puede devolverle un error
    // ni tirar la reserva: se registra el problema en el log y se sigue.
    const SRC = fs.readFileSync(path.join(__dirname, 'reserva-evento.js'), 'utf8');
    verificar('registrarReservaComoEvento atrapa sus errores', /catch \(err\)/.test(SRC), true);

    const PORTAL = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');
    const ini = PORTAL.indexOf("require('./reserva-evento').registrarReservaComoEvento(");
    verificar('el portal la llama después de guardar la reserva', ini > -1, true);
    // El orden importa y se mide por posición: la reserva se guarda PRIMERO. Al revés, un fallo
    // del historial abortaría el endpoint antes de que el vecino tenga su reserva.
    const iniInsert = PORTAL.indexOf('INSERT INTO reservas_amenities');
    verificar('la llamada va después del INSERT de la reserva',
        iniInsert > -1 && ini > iniInsert, true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
