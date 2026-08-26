// Verifica cuándo un mensaje continúa un caso abierto y cuándo abre uno nuevo.
//
//   node pruebas-caso-nuevo-o-mismo.js
//
// POR QUÉ. `guardarReporte` engancha un mensaje al caso abierto del mismo vecino o del mismo
// edificio. Eso es lo correcto mientras la conversación siga siendo SOBRE LO MISMO: el vecino
// manda una foto, pregunta si viene el técnico, agradece.
//
// Pero un reclamo NUEVO no es la continuación de nada. Con la regla vieja, mientras CASO-1001
// siguiera abierto todo lo que dijera ese vecino caía adentro. En el log de producción se veía:
//
//   ℹ️ Técnico ya notificado del [CASO-1001], se omite el reenvío duplicado de la plantilla.
//   📊 Evento [CASO-1001] unificado/actualizado en Sheets
//
// que parece una decisión correcta y era el bug: el reclamo nuevo quedaba pegado al viejo, con un
// solo técnico asignado, y al técnico del caso nuevo no le llegaba nunca la plantilla.
//
// Lo que distingue un reclamo nuevo es el RUBRO: una lámpara quemada no es una canilla que pierde.
//
// La lógica se carga del propio sheets.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');

const ini = SRC.indexOf('const { coincideRubro } = require(\'./rubros\');');
if (ini === -1) throw new Error('No encontré el bloque de "¿es el mismo caso?" en sheets.js.');
const marca = '        };';
const fin = SRC.indexOf(marca, SRC.indexOf('const esOtroCaso = (r) =>', ini));
if (fin === -1) throw new Error('No encontré el final de esOtroCaso en sheets.js.');
const cuerpo = SRC.slice(ini, fin + marca.length);

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// `esOtroCaso` recibe una fila de la planilla: solo se le pide `get`.
const filaCon = (campos) => ({ get: (k) => campos[k] ?? '' });

function decidir({ problema, rubro_tecnico, casoAbierto }) {
    // eslint-disable-next-line no-new-func
    const esOtroCaso = new Function('require', 'problema', 'rubro_tecnico',
        `${cuerpo}; return esOtroCaso;`
    )(require, problema, rubro_tecnico);
    return esOtroCaso(filaCon(casoAbierto));
}

const casoDeLuz = { id_evento: 'CASO-1001', rubro_tecnico: 'electricidad' };

console.log('\n── OTRO RUBRO ES OTRO CASO ──');
{
    verificar('una pérdida de agua no continúa el caso de la luz',
        decidir({ problema: 'Pierde agua la canilla del baño', rubro_tecnico: 'plomería', casoAbierto: casoDeLuz }), true);
    verificar('una cerradura rota tampoco',
        decidir({ problema: 'No cierra la puerta de entrada', rubro_tecnico: 'cerrajería', casoAbierto: casoDeLuz }), true);
}

console.log('\n── EL MISMO RUBRO CONTINÚA EL CASO ──');
{
    verificar('otro problema de electricidad sigue en el mismo caso',
        decidir({ problema: 'Ahora tampoco anda el pasillo', rubro_tecnico: 'electricidad', casoAbierto: casoDeLuz }), false);
    // "electricista", "electricidad" y "luz" son el mismo oficio escrito distinto.
    verificar('"electricista" es lo mismo que "electricidad"',
        decidir({ problema: 'Sigue sin luz', rubro_tecnico: 'electricista', casoAbierto: casoDeLuz }), false);
    verificar('"luz" también',
        decidir({ problema: 'No hay luz en el 2ºB', rubro_tecnico: 'luz', casoAbierto: casoDeLuz }), false);
}

console.log('\n── LA COLA DE UNA CONVERSACIÓN NO ABRE NADA ──');
{
    // Un "gracias", una foto, un "¿ya viene?": no traen problema propio. Son parte del caso que ya
    // está abierto y tienen que seguir cayendo ahí, como antes.
    verificar('un mensaje sin problema propio no separa',
        decidir({ problema: '', rubro_tecnico: 'plomería', casoAbierto: casoDeLuz }), false);
    verificar('ni aunque el rubro sea distinto',
        decidir({ problema: '   ', rubro_tecnico: 'gas', casoAbierto: casoDeLuz }), false);
}

console.log('\n── ANTE LA DUDA, NO SE SEPARA ──');
{
    // Separar de más parte un caso en dos y deja al administrador viendo dos reclamos donde hay
    // uno. Sin dato con qué comparar, se sigue enganchando: es el comportamiento de siempre.
    verificar('el mensaje nuevo no trae rubro',
        decidir({ problema: 'Hay un problema', rubro_tecnico: '', casoAbierto: casoDeLuz }), false);
    verificar('el caso abierto no tiene rubro cargado',
        decidir({ problema: 'Pierde agua', rubro_tecnico: 'plomería', casoAbierto: { id_evento: 'CASO-1001', rubro_tecnico: '' } }), false);
    verificar('ninguno de los dos tiene rubro',
        decidir({ problema: 'Algo pasa', rubro_tecnico: '', casoAbierto: { id_evento: 'CASO-1001' } }), false);
}

console.log('\n── EL CASO REAL QUE LO DESTAPÓ ──');
{
    // En las pruebas de Daniel, CASO-1001 nunca se cerraba, así que cada prueba nueva del mismo
    // día caía adentro y la plantilla no se volvía a mandar. Con rubros distintos, ahora se separa.
    verificar('segunda prueba, otro rubro: caso nuevo',
        decidir({ problema: 'Se traba el portero eléctrico', rubro_tecnico: 'portero', casoAbierto: casoDeLuz }), true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
