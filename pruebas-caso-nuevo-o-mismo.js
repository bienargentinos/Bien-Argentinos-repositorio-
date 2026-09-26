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

console.log('\n── EL RUBRO DEDUCIDO DE LO QUE CONTARON ──');
{
    // En la planilla real los primeros cuatro casos quedaron TODOS "sin rubro": la ficha del
    // proveedor venía vacía y nadie avisaba. Sin rubro, toda la separación de arriba está muerta.
    // Lo que sí está siempre es lo que la persona dijo.
    const { rubroDelTexto } = require('./rubros');

    verificar('un problema eléctrico en las luminarias',
        rubroDelTexto('Me llamó el encargado por un problema eléctrico en las luminarias de la cochera'), 'electricidad');
    verificar('las luces del hall',
        rubroDelTexto('Puerta de entrada magnética sin traba y luces del hall sin funcionar'), 'electricidad');
    verificar('el jardín',
        rubroDelTexto('Hay un problema en el jardín, el césped está muy alto'), 'jardinería');
    verificar('una canilla que pierde',
        rubroDelTexto('Pierde agua la canilla del baño'), 'plomería');
    verificar('el ascensor', rubroDelTexto('No anda el ascensor'), 'ascensores');
    verificar('una pérdida de gas', rubroDelTexto('Se siente olor a gas en el pasillo'), 'gas');

    // Ante la duda, vacío. Un rubro inventado separa casos que son el mismo, o manda el aviso al
    // gremio equivocado.
    verificar('un saludo no dice nada', rubroDelTexto('Hola, cómo va'), '');
    verificar('vacío', rubroDelTexto(''), '');
    verificar('null', rubroDelTexto(null), '');

    // Y con esto la separación vuelve a funcionar aunque la ficha del proveedor esté vacía.
    verificar('la luz de la cochera y el jardín no son el mismo rubro',
        rubroDelTexto('luminarias de la cochera') === rubroDelTexto('problema en el jardín'), false);
}

console.log('\n── EL OFICIO DE LA PERSONA NO ES EL RUBRO DEL TRABAJO ──');
{
    // El caso real: Dario está cargado como "Electricista" y avisó por una PÉRDIDA DE AGUA. Con el
    // oficio de la ficha, ese aviso quedaba marcado "Electricista" -- el mismo rubro que su caso
    // eléctrico abierto en ese edificio -- y se metía adentro en vez de abrir uno nuevo.
    const { rubroDelCaso, atiendeRubro, coincideRubro } = require('./rubros');

    verificar('lo que contó le gana a la ficha',
        rubroDelCaso('me llamaron por una pérdida de agua en el sótano', 'Electricista'), 'plomería');
    verificar('la ficha queda de respaldo cuando el texto no dice nada',
        rubroDelCaso('hola, buenas', 'Electricista'), 'Electricista');
    verificar('"Proveedor" no es un rubro: es un rol',
        rubroDelCaso('hola, buenas', 'Proveedor'), '');
    verificar('y el aviso de plomería SÍ se separa del caso eléctrico',
        decidir({ problema: 'pérdida de agua en el sótano', rubro_tecnico: 'plomería', casoAbierto: casoDeLuz }), true);
}

console.log('\n── UN ELECTRICISTA DE EDIFICIOS HACE CUATRO COSAS ──');
{
    // Daniel: "yo en los edificios a veces hago electricidad, portería, control de acceso y CCTV".
    // Son trabajos distintos aunque los haga la misma persona, y hay que poder distinguirlos.
    const { rubroDelTexto, rubroDelCaso, atiendeRubro, coincideRubro } = require('./rubros');

    verificar('el portero eléctrico NO es electricidad',
        rubroDelTexto('no anda el portero eléctrico del 3ro B'), 'portería');
    verificar('una cámara es CCTV', rubroDelTexto('la cámara del hall no graba'), 'cctv');
    verificar('el DVR también', rubroDelTexto('hay que cambiar el DVR'), 'cctv');
    verificar('las tarjetas son control de acceso',
        rubroDelTexto('las tarjetas de acceso no abren el molinete'), 'control de acceso');
    verificar('la cerradura electromagnética también',
        rubroDelTexto('la cerradura electromagnética quedó sin traba'), 'control de acceso');
    verificar('y el disyuntor sigue siendo electricidad',
        rubroDelTexto('saltó el disyuntor de las luces de la cochera'), 'electricidad');

    // SEPARAR CASOS: estricto. Si se mezclan, dos trabajos distintos terminan adentro de un solo
    // caso, con un solo técnico y una sola factura.
    verificar('un reclamo de cámaras no continúa el caso de la luz',
        decidir({ problema: 'la cámara del hall no graba', rubro_tecnico: 'cctv', casoAbierto: casoDeLuz }), true);
    verificar('ni uno del portero eléctrico',
        decidir({ problema: 'no anda el portero eléctrico', rubro_tecnico: 'portería', casoAbierto: casoDeLuz }), true);
    verificar('cctv y electricidad no son el mismo trabajo', coincideRubro('cctv', 'electricidad'), false);

    // ELEGIR TÉCNICO: amplio. Es la pregunta opuesta y por eso es otra función: la ficha dice
    // "Electricista" y el caso es de CCTV, y es él igual.
    verificar('un electricista atiende un caso de CCTV', atiendeRubro('Electricista', 'cctv'), true);
    verificar('y uno de portería', atiendeRubro('Electricista', 'portería'), true);
    verificar('y uno de control de acceso', atiendeRubro('Electricista', 'control de acceso'), true);
    verificar('pero NO uno de plomería', atiendeRubro('Electricista', 'plomería'), false);
    verificar('una ficha con varios rubros funciona sola',
        atiendeRubro('electricidad, portería, control de acceso, cctv', 'cctv'), true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
