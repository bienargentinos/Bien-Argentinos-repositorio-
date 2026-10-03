// Verifica que la marca de "técnico avisado" sea por técnico y no por caso.
//
//   node pruebas-tecnico-avisado.js
//
// POR QUÉ. Prueba de cerrajería, 28/09: el reclamo se pegó al CASO-1003, que era de Dario y ya
// tenía la marca puesta. El caso pasó a ser de lalala y Marcos no le mandó la plantilla:
//
//   ℹ️ [Sheets] Técnico ya notificado del [CASO-1003] (detectado tras reinicio), se omite el reenvío duplicado.
//
// Y lalala comparte el teléfono con Dario, así que la memoria del proceso --que es por teléfono--
// tampoco lo distinguía.

const fs = require('fs');
const path = require('path');
const { marcaDeAviso, avisadoA, yaAvisado } = require('./tecnico-avisado');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

console.log('\n── LA MARCA DICE A QUIÉN ──');
{
    const m = marcaDeAviso('28/09/2026, 22:08:30', 'lalala');
    verificar('se escribe fecha y nombre', m, '28/09/2026, 22:08:30 → lalala');
    verificar('y se lee el nombre', avisadoA(m), 'lalala');
    verificar('entra en la columna de PostgreSQL (VARCHAR 100) aunque el nombre sea larguísimo',
        marcaDeAviso('28/09/2026, 22:08:30', 'x'.repeat(300)).length <= 100, true);
}

console.log('\n── EL CASO DE LA PRUEBA DE CERRAJERÍA ──');
{
    const deDario = marcaDeAviso('12/9/2026, 22:10:00', 'dario juju');
    verificar('avisado a Dario NO es avisado a lalala', yaAvisado(deDario, 'lalala'), false);
    verificar('a Dario sí', yaAvisado(deDario, 'Dario Juju'), true);
    // La marca que tenía el CASO-1003 era vieja: solo la fecha. No se sabe a quién se le avisó.
    verificar('una marca vieja sin nombre no cuenta para lalala: se le manda', yaAvisado('12/9/2026, 22:10:00', 'lalala'), false);
    verificar('sin marca no hay aviso', yaAvisado('', 'lalala'), false);
    verificar('quien no dice a quién pregunta recibe la respuesta de siempre', yaAvisado('12/9/2026, 22:10:00', ''), true);
    verificar('mayúsculas y acentos no cambian a la persona', yaAvisado(marcaDeAviso('x', 'Darío'), 'dario'), true);
}

console.log('\n── CANDADOS: EL NOMBRE LLEGA HASTA LA BASE ──');
{
    const codigo = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
        .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    const ops = codigo('agentes/marcos-ops.js');
    verificar('marcos-ops.js pregunta con el nombre del técnico', /fueTecnicoNotificado\(id_evento,\s*nombreTec\)/.test(ops), true);
    verificar('y marca con el nombre', /marcarTecnicoNotificado\(id_evento,\s*nombreTec\)/.test(ops), true);
    verificar('la memoria por teléfono compara también a quién se le avisó', /mismoTecnico\(estadoProv\.notificadoA/.test(ops), true);
    for (const f of ['sheets.js', 'datos-pg.js', 'datos.js']) {
        verificar(`${f} lee la marca con yaAvisado o la pasa`, /yaAvisado\(|fueTecnicoNotificado\(id_evento, nombreTecnico\)/.test(codigo(f)), true);
    }
    verificar('sheets.js escribe la marca con marcaDeAviso', /marcaDeAviso\(fechaHoraAR\(\), nombreTecnico\)/.test(codigo('sheets.js')), true);
    verificar('y la copia a PostgreSQL también', /marcaDeAviso\(fechaHoraAR\(\), nombreTecnico\)/.test(codigo('datos.js')), true);
}

console.log(fallos ? `\n❌ ${fallos} fallo(s).` : '\n✅ Todo en orden.');
process.exit(fallos ? 1 : 0);
