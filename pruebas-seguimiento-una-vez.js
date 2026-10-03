// Verifica que el seguimiento pregunte UNA vez por paso, y no en cada barrido.
//
//   node pruebas-seguimiento-una-vez.js
//
// POR QUÉ. Al técnico le llegaba varias veces la misma pregunta: "¿pudiste pasar por …?".
//
// Eran dos cosas distintas, y las dos son el mismo error de fondo -- hacer algo y no verificar que
// la marca de "ya está hecho" haya quedado:
//
//   1. El barrido mandaba el mensaje y RECIÉN DESPUÉS corría la fecha del próximo control. Si la
//      planilla no se podía actualizar, el control seguía vencido y a los cinco minutos se mandaba
//      de nuevo. Y otra vez. Para siempre.
//
//   2. Cada mensaje del técnico que se leyera como una confirmación volvía a agendar el control
//      EN EL PASO 1. La cadena (preguntar al técnico → al edificio → escalar) arrancaba de cero
//      una y otra vez, así que la misma pregunta salía repetida y el caso no avanzaba nunca.
//
// La lógica se carga de los archivos reales para que la prueba valide el código que corre.

const fs = require('fs');
const path = require('path');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// ── 1. EL BARRIDO: RESERVAR ANTES DE MANDAR ─────────────────────────────────────────────────
const { revisarSeguimientos } = require('./seguimiento');

/**
 * Corre el barrido contra un caso de mentira. `agendaFalla` simula que la planilla no se pudo
 * actualizar, que es la condición que provocaba la repetición.
 */
async function barrer({ paso = 1, agendaFalla = false, conTecnico = true, telVecino = '5491150542005' }) {
    const hecho = { enviados: [], agendados: [], escalado: 0 };
    let vencidoSigue = true;

    await revisarSeguimientos({
        obtenerSeguimientosVencidos: async () => (vencidoSigue ? [{
            id_evento: 'CASO-1001', edificio: 'san patricio casa', vecino: 'Daniel',
            telefono: telVecino, problema: 'Puerta de entrada', urgencia: 'alta',
            tecnico: 'Dario Juju', paso, nota: '',
        }] : []),
        programarSeguimiento: async ({ paso: p }) => {
            if (agendaFalla) return false;
            hecho.agendados.push(p);
            vencidoSigue = false;
            return true;
        },
        buscarTecnicoAsignado: async () => (conTecnico ? { nombre: 'Dario Juju', telefono: '541169241157' } : null),
        buscarTecnicoSuplente: async () => null,
        enviarWhatsApp: async (to, texto) => { hecho.enviados.push({ to, texto }); return true; },
        notificarEscalacionAlAdmin: async () => { hecho.escalado++; },
        phoneNumberId: 'PHONE', accessToken: 'TOKEN',
    });

    return hecho;
}

(async () => {

console.log('\n── EL CAMINO NORMAL ──');
{
    const h = await barrer({ paso: 1 });
    verificar('le pregunta al técnico una sola vez', h.enviados.length, 1);
    verificar('y deja agendado el paso 2', h.agendados, [2]);
    verificar('el mensaje va al técnico', h.enviados[0].to, '541169241157');
}

console.log('\n── SI NO SE PUEDE AGENDAR, NO SE MANDA ──');
{
    // Este es el bug: antes mandaba igual, la fecha quedaba vencida, y el barrido de los cinco
    // minutos siguientes volvía a mandar lo mismo. Sin fin.
    const h = await barrer({ paso: 1, agendaFalla: true });
    verificar('no le manda nada al técnico', h.enviados, []);
    verificar('y no se inventa que quedó agendado', h.agendados, []);
}

console.log('\n── PASO 2: MISMO CRITERIO, PERO LO SUFRE EL VECINO ──');
{
    const h = await barrer({ paso: 2 });
    verificar('le pregunta al vecino una vez', h.enviados.length, 1);
    verificar('al teléfono del vecino', h.enviados[0].to, '5491150542005');
    verificar('deja agendado el paso 3', h.agendados, [3]);

    const falla = await barrer({ paso: 2, agendaFalla: true });
    verificar('si no se puede agendar, no se le escribe', falla.enviados, []);
}

console.log('\n── PASO 3: LA ESCALACIÓN TAMPOCO SE REPITE ──');
{
    const h = await barrer({ paso: 3 });
    verificar('se escala una vez', h.escalado, 1);
    verificar('y queda marcado como escalado', h.agendados, [9]);

    // Sin la marca, al administrador le llegaría el mismo mail cada cinco minutos.
    const falla = await barrer({ paso: 3, agendaFalla: true });
    verificar('si no se puede marcar, no se escala', falla.escalado, 0);
}

console.log('\n── UN CASO YA ESCALADO NO SE VUELVE A TOCAR ──');
{
    const h = await barrer({ paso: 9 });
    verificar('no se manda nada', h.enviados, []);
    verificar('no se vuelve a escalar', h.escalado, 0);
}

// ── 2. EL PASO NO RETROCEDE ─────────────────────────────────────────────────────────────────
console.log('\n── UNA CONFIRMACIÓN DEL TÉCNICO NO REINICIA LA CADENA ──');
{
    // Se carga `programarSeguimiento` del propio sheets.js.
    const SRC = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');
    const ini = SRC.indexOf("        // Un caso cerrado no se vuelve a controlar.");
    if (ini === -1) throw new Error('No encontré las guardas de programarSeguimiento en sheets.js.');
    const fin = SRC.indexOf("        fila.set('proximo_seguimiento'", ini);
    const cuerpo = SRC.slice(ini, fin);

    const decidir = (estado, pasoActual, proximo, pasoNuevo, forzar = false) => {
        const fila = { get: (k) => ({ estado, seguimiento_paso: String(pasoActual), proximo_seguimiento: proximo }[k] || '') };
        // eslint-disable-next-line no-new-func
        const fn = new Function('fila', 'id_evento', 'paso', 'forzar', 'console',
            `${cuerpo}; return true;`);
        return fn(fila, 'CASO-1001', pasoNuevo, forzar, { log() {} });
    };

    const enUnaHora = new Date(Date.now() + 3600e3).toISOString();
    const haceUnaHora = new Date(Date.now() - 3600e3).toISOString();

    verificar('el caso va por el paso 2 y llega un paso 1: se rechaza',
        decidir('en_proceso', 2, enUnaHora, 1), false);
    verificar('avanzar de 2 a 3 sí se acepta',
        decidir('en_proceso', 2, haceUnaHora, 3), true);
    verificar('el mismo paso, con un control ya agendado a futuro: se respeta el que está',
        decidir('en_proceso', 2, enUnaHora, 2), false);
    verificar('el mismo paso pero ya vencido: se reagenda',
        decidir('en_proceso', 2, haceUnaHora, 2), true);
}

console.log('\n── UN CASO CERRADO NO SE VUELVE A CONTROLAR ──');
{
    const SRC = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');
    const ini = SRC.indexOf("        // Un caso cerrado no se vuelve a controlar.");
    const fin = SRC.indexOf("        fila.set('proximo_seguimiento'", ini);
    const cuerpo = SRC.slice(ini, fin);
    const decidir = (estado) => {
        const fila = { get: (k) => ({ estado, seguimiento_paso: '1', proximo_seguimiento: '' }[k] || '') };
        // eslint-disable-next-line no-new-func
        return new Function('fila', 'id_evento', 'paso', 'forzar', 'console',
            `${cuerpo}; return true;`)(fila, 'CASO-1001', 1, false, { log() {} });
    };

    // El técnico sigue escribiendo después de resolver: manda la factura, saluda. Cualquiera de
    // esos mensajes leído como confirmación volvía a agendar el control, y después Marcos le
    // preguntaba "¿pudiste pasar?" por un trabajo que ya había facturado.
    verificar('resuelto', decidir('resuelto'), false);
    verificar('cerrado', decidir('cerrado'), false);
    verificar('en proceso sí se agenda', decidir('en_proceso'), true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);

})();
