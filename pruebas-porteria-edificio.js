/**
 * EL TIMBRE DE UN EDIFICIO NO SUENA EN OTRO
 *
 * > [!CAUTION]
 * > **Es la prueba de la puerta de calle.** Lo que se verifica acá es en el teléfono de quién suena
 * > un timbre y, por lo tanto, quién puede abrirle a alguien que está parado en la vereda. Un match
 * > de más no se ve en ningún log: se ve cuando entra alguien que no tenía que entrar.
 *
 * Lo que había, en `porteria.js`, de la época en que corría un solo edificio de prueba:
 *
 *     const edMatch = !edNorm || vEd === edNorm || vEd.includes(edNorm) || edNorm.includes(vEd)
 *         || edNorm.includes('demo') || vEd.includes('demo')
 *         || edNorm.includes('patricio') || vEd.includes('patricio');
 *     ...
 *     if (_timbresActivos.size === 1) return _timbresActivos.values().next().value;
 *
 * Con un solo edificio andando, las tres cosas dan el resultado correcto por casualidad y no hay
 * forma de notarlo. Por eso la prueba levanta SIEMPRE dos edificios: es la única condición en la
 * que el bug existe.
 *
 *     node pruebas-porteria-edificio.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const porteria = require('./porteria');
const { encontrarLlamadaActiva, registrarAperturaPuerta, _timbresActivos, _aperturasPuerta } = porteria._paraPruebas;
const { mismoEdificio, claveEdificio, claveUnidad } = require('./edificio-clave');

let ok = 0;
let fallos = 0;

function vale(titulo, condicion, detalle) {
    if (condicion) {
        ok++;
        console.log(`   ✅ ${titulo}`);
    } else {
        fallos++;
        console.log(`   ❌ ${titulo}`);
        if (detalle) console.log(`      ${detalle}`);
    }
}

/** Deja sonando el timbre del `depto` del `edificio`, como lo dejaría `/api/tocar-timbre`. */
function sonar(edificio, depto) {
    const llamada = {
        id: 'ring_' + Math.random().toString(36).slice(2),
        edificio,
        departamento: depto,
        timestamp: Date.now(),
        estado: 'llamando',
        respuesta: '',
        signals: []
    };
    _timbresActivos.set(claveEdificio(edificio) + ':' + claveUnidad(depto), llamada);
    return llamada;
}

function limpiar() {
    _timbresActivos.clear();
    _aperturasPuerta.clear();
}

console.log('\n🔔 EL TIMBRE DE UN EDIFICIO NO SUENA EN OTRO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Dos edificios a la vez — la condición donde el bug existe');
// ─────────────────────────────────────────────────────────────────────────────
{
    limpiar();
    const enElCiento59 = sonar('San Patricio 159', '4B');
    const enElDoscientos70 = sonar('San Patricio 270', '4B');

    vale('el vecino del 159 recibe la llamada del 159',
        encontrarLlamadaActiva(null, 'San Patricio 159', '4B') === enElCiento59);

    vale('el vecino del 270 recibe la llamada del 270',
        encontrarLlamadaActiva(null, 'San Patricio 270', '4B') === enElDoscientos70);

    // El caso exacto del `|| edNorm.includes('patricio')`: los dos nombres tienen "patricio" y el
    // mismo departamento. Antes eran indistinguibles.
    vale('el 159 NO recibe la del 270',
        encontrarLlamadaActiva(null, 'San Patricio 159', '4B') !== enElDoscientos70,
        'Dos consorcios distintos de la misma calle. El vecino del 159 le abriría a quien toca en el 270.');

    vale('un edificio que no tiene timbre sonando no recibe ninguno',
        encontrarLlamadaActiva(null, 'Rivadavia 1200', '4B') === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) El `size === 1`: una sola llamada en todo el sistema');
// ─────────────────────────────────────────────────────────────────────────────
{
    limpiar();
    const unica = sonar('San Patricio 270', '4B');

    vale('su propio edificio la recibe',
        encontrarLlamadaActiva(null, 'San Patricio 270', '4B') === unica);

    vale('OTRO edificio no la recibe aunque sea la única del sistema',
        encontrarLlamadaActiva(null, 'Rivadavia 1200', '4B') === null,
        'Era el caso más peligroso: con un solo timbre sonando, cualquiera que consultaba lo recibía.');

    vale('otro DEPARTAMENTO del mismo edificio no la recibe',
        encontrarLlamadaActiva(null, 'San Patricio 270', '2A') === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) El `!edNorm`: preguntar sin decir de qué edificio');
// ─────────────────────────────────────────────────────────────────────────────
{
    limpiar();
    sonar('San Patricio 270', '4B');

    vale('sin edificio no se devuelve ninguna llamada',
        encontrarLlamadaActiva(null, '', '4B') === null,
        'La falta de un dato no es un comodín: es "no sé".');

    vale('sin edificio ni departamento tampoco',
        encontrarLlamadaActiva(null, '', '') === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) La forma del nombre sí se tolera (lo que NO hay que romper de más)');
// ─────────────────────────────────────────────────────────────────────────────
{
    limpiar();
    const llamada = sonar('San Patrício 270', '4°B');

    vale('mayúsculas distintas',
        encontrarLlamadaActiva(null, 'san patricio 270', '4°B') === llamada);

    vale('acento de más o de menos',
        encontrarLlamadaActiva(null, 'San Patricio 270', '4°B') === llamada);

    vale('el departamento escrito de otra forma: 4°B = 4 B = 4b',
        encontrarLlamadaActiva(null, 'San Patricio 270', '4 b') === llamada);

    vale('sin departamento, el edificio alcanza',
        encontrarLlamadaActiva(null, 'San Patricio 270', '') === llamada,
        'El tótem a veces consulta por edificio nomás. Eso sigue andando.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) El departamento se compara exacto: el 1 no es el 1A');
// ─────────────────────────────────────────────────────────────────────────────
{
    limpiar();
    const uno = sonar('San Patricio 270', '1');
    const unoA = sonar('San Patricio 270', '1A');

    vale('el 1 recibe la del 1', encontrarLlamadaActiva(null, 'San Patricio 270', '1') === uno);
    vale('el 1A recibe la del 1A', encontrarLlamadaActiva(null, 'San Patricio 270', '1A') === unoA);
    vale('el 11 no recibe la del 1',
        encontrarLlamadaActiva(null, 'San Patricio 270', '11') === null,
        'El `includes` viejo hacía que pedir el 1 matcheara con 1A, 1B y 11.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) El callId, que es el camino preciso');
// ─────────────────────────────────────────────────────────────────────────────
{
    limpiar();
    const llamada = sonar('San Patricio 270', '4B');

    vale('con el callId solo, se encuentra',
        encontrarLlamadaActiva(llamada.id, '', '') === llamada);

    vale('con el callId y SU edificio, se encuentra',
        encontrarLlamadaActiva(llamada.id, 'San Patricio 270', '') === llamada);

    vale('con el callId y OTRO edificio, no',
        encontrarLlamadaActiva(llamada.id, 'Rivadavia 1200', '') === null,
        'Un callId es `ring_<timestamp>`, o sea adivinable. Si dicen el edificio, se verifica.');

    vale('un callId que no existe no cae al match por edificio',
        encontrarLlamadaActiva('ring_inventado', 'San Patricio 270', '4B') === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7) La apertura de puerta es de un edificio, no de todos');
// ─────────────────────────────────────────────────────────────────────────────
{
    limpiar();
    vale('una apertura sin edificio no se registra',
        registrarAperturaPuerta('', 'Apertura manual', '') === null,
        'Quedaba bajo la clave "" y se la llevaba cualquier relé que sondeara sin edificio.');

    vale('con edificio sí se registra',
        registrarAperturaPuerta('San Patricio 270', 'Pase QR', '4B') !== null);

    vale('quedó guardada bajo la clave de SU edificio',
        _aperturasPuerta.has(claveEdificio('San Patricio 270')) && _aperturasPuerta.size === 1);

    vale('el edificio de al lado no tiene ninguna apertura esperando',
        !_aperturasPuerta.has(claveEdificio('San Patricio 159')));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8) `mismoEdificio` — tolerante con la forma, intolerante con el contenido');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('mismo edificio escrito distinto', mismoEdificio('San Patrício 270', 'san patricio 270'));
    vale('270 y 159 NO son el mismo', !mismoEdificio('San Patricio 270', 'San Patricio 159'));
    vale('la misma altura en otra calle NO es el mismo', !mismoEdificio('San Patricio 270', 'Rivadavia 270'));
    vale('un nombre contenido en otro NO alcanza', !mismoEdificio('San Patricio', 'San Patricio 270'),
        'Es la diferencia con `compararEdificios`, que acepta parciales a propósito para leer WhatsApp.');
    vale('dos vacíos NO son el mismo edificio', !mismoEdificio('', ''));
    vale('un vacío contra un nombre tampoco', !mismoEdificio('', 'San Patricio 270'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n9) CANDADO: que esto no pueda volver por otro lado');
// ─────────────────────────────────────────────────────────────────────────────
{
    const fuente = fs.readFileSync(path.join(__dirname, 'porteria.js'), 'utf8');

    // Los comentarios citan el código viejo a propósito, para que se entienda qué se arregló. El
    // candado tiene que mirar el CÓDIGO, así que se sacan los comentarios antes de buscar.
    const codigo = fuente
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(l => !l.trim().startsWith('//'))
        .join('\n');

    vale('ningún nombre de edificio escrito a mano en el código',
        !/includes\(\s*['"](?:patricio|demo|san\s)/i.test(codigo),
        'Un edificio de prueba hardcodeado hace que dos consorcios distintos sean el mismo.');

    vale('no vuelve el "si hay una sola llamada, es esta"',
        !/_timbresActivos\.size\s*===?\s*1/.test(codigo),
        'Devolver la única llamada activa a quien sea es el bug más peligroso de los tres.');

    vale('la comparación de edificio no se reescribe a mano acá',
        !/\.toLowerCase\(\)\.trim\(\)\s*===/.test(codigo),
        'Para eso está `mismoEdificio`. Escrita dos veces, arreglar una copia no cambia producción.');

    vale('`porteria.js` usa el comparador compartido',
        /require\(['"]\.\/edificio-clave['"]\)/.test(fuente));

    // La tolerancia por `includes` entre nombres de edificio es justamente lo que hacía que el 159
    // y el 270 fueran el mismo. Que no vuelva disfrazada.
    vale('no hay includes entre nombres de edificio',
        !/\bvEd\.includes\(|edNorm\.includes\(/.test(codigo));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Esto decide a quién le suena un timbre y quién puede abrir una puerta.');
    console.log('       No subir con esto en rojo.\n');
    process.exit(1);
}
console.log('\n   🔔 El timbre de cada edificio suena donde tiene que sonar.\n');
