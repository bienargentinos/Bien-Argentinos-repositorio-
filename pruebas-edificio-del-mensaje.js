/**
 * QUÉ EDIFICIO NOMBRA EL MENSAJE — un vecino puede tener vivienda y oficina en lados distintos
 *
 * Planteado por Daniel, 27/09: *"el vecino tiene un número pero puede tener vivienda y oficina en
 * distintos lados y el reclamo de un edificio no es del otro"*.
 *
 * El bug: `buscarEdificioEnTexto` aceptaba **cualquier número del mensaje que apareciera en
 * cualquier campo de cualquier edificio del sistema**. Tercera copia del defecto que ya se arregló
 * en `perfil-edificio.js`.
 *
 *     node pruebas-edificio-del-mensaje.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { edificioNombradoEnMensaje, puntajeEnMensaje } = require('./edificio-del-mensaje');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

// Los dos consorcios de la misma calle que ya costaron caro, más la oficina en otro lado.
const CASA    = { nombre: 'san patricio casa', direccion: 'San Patricio 159', aliases: 'Torre Sur' };
const VECINO  = { nombre: 'San patricio 270',  direccion: 'San Patricio 270', aliases: '' };
const OFICINA = { nombre: 'Rivadavia 4',       direccion: 'Rivadavia 4',      aliases: '' };

const elige = (msg, eds) => edificioNombradoEnMensaje(msg, eds)?.edificio?.nombre || null;

console.log('\n🏢 QUÉ EDIFICIO NOMBRA EL MENSAJE\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Lo que el vecino nombra de verdad');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('la calle con la altura elige bien',
        elige('hola, hay agua en san patricio 159, en el palier', [CASA, VECINO]) === 'san patricio casa');

    vale('y la otra altura elige el otro',
        elige('se cortó la luz en san patricio 270', [CASA, VECINO]) === 'San patricio 270');

    vale('la oficina en otra calle también',
        elige('en la oficina de rivadavia 4 no anda el ascensor', [CASA, VECINO, OFICINA]) === 'Rivadavia 4');

    vale('un alias propio alcanza',
        elige('estoy en torre sur y no hay luz', [CASA, VECINO]) === 'san patricio casa');

    vale('sin acentos y en mayúsculas igual',
        elige('SAN PATRICIO 270 SE INUNDO', [CASA, VECINO]) === 'San patricio 270');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Lo que NO puede elegir, que es el punto');
// ─────────────────────────────────────────────────────────────────────────────
{
    // > [!CAUTION]
    // > **Un número suelto no identifica nada.** Es un piso, una unidad, una cantidad o una hora.
    // > La regla vieja lo tomaba como altura y asignaba el edificio.
    vale('"el piso 4" NO elige el edificio de Rivadavia 4',
        elige('se cortó la luz en el piso 4', [CASA, VECINO, OFICINA]) === null,
        'Con la regla vieja, cualquier número del mensaje en cualquier campo fijaba el edificio.');

    vale('"somos 270 propietarios" tampoco',
        elige('somos 270 propietarios y nadie contesta', [CASA, VECINO]) === null);

    vale('"a las 4 de la tarde" tampoco',
        elige('paso a las 4 de la tarde', [OFICINA]) === null);

    // La calle sin altura con dos consorcios encima: preguntar molesta, elegir mal cuesta plata.
    vale('la calle sin altura con dos edificios no elige ninguno',
        elige('hay un problema en san patricio', [CASA, VECINO]) === null);

    // Pero con UNO solo en esa calle, sí.
    vale('la misma frase con un solo edificio en esa calle, sí elige',
        elige('hay un problema en san patricio', [CASA]) === 'san patricio casa');

    vale('un mensaje sin ningún edificio no inventa', elige('hola, buenas tardes', [CASA, VECINO]) === null);
    vale('sin lista no rompe', edificioNombradoEnMensaje('san patricio 159', []) === null);
    vale('sin mensaje tampoco', edificioNombradoEnMensaje('', [CASA]) === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) La altura que se contradice nunca coincide');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Es la regla que ya está escrita en `perfil-edificio.js`: el 270 y el 159 de San Patricio son
    // dos consorcios distintos, y el número no se mezcla entre campos.
    vale('el mensaje dice 159 y el campo dice 270 → no coincide',
        puntajeEnMensaje('hay agua en san patricio 159', 'San Patricio 270') === 0);

    vale('el mensaje dice 159 y el campo dice 159 → coincide fuerte',
        puntajeEnMensaje('hay agua en san patricio 159', 'San Patricio 159') >= 2);

    vale('otra calle con la misma altura no coincide',
        puntajeEnMensaje('hay agua en rivadavia 270', 'San Patricio 270') === 0,
        'El número solo no identifica un edificio.');

    // Con el 270 nombrado, la fila del 159 no puede ganar por tener la calle.
    vale('nombrando el 270, no se elige el 159',
        elige('perdida de agua en san patricio 270', [CASA, VECINO]) === 'San patricio 270');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) index.js: la regla vieja no puede volver');
// ─────────────────────────────────────────────────────────────────────────────
{
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const soloCod = cod.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    vale('index.js usa el módulo', /edificioNombradoEnMensaje\(/.test(soloCod));

    // El candado central: la regla que aceptaba cualquier número en cualquier campo.
    vale('no vuelve el "cualquier número en cualquier campo"',
        !/nums\.includes\(num\)/.test(soloCod),
        'Esa línea es la que asignaba un edificio por el número de un piso.');

    vale('y el desempate por primera palabra del nombre tampoco',
        !/edificio\.toLowerCase\(\)\.split\(' '\)\[0\]/.test(soloCod),
        '"San Patricio 159" y "San Patricio 270" son los dos "san".');

    // Con dos edificios y ninguno nombrado, NO se agarra el primero de la planilla.
    vale('con varios edificios no se elige el primero de la lista',
        !/vecino = mencionado \|\| vecinosEnSheets\[0\]/.test(soloCod),
        'Elegir por el orden de la planilla es tirar una moneda con el consorcio.');

    vale('ni para decidir en qué edificio cerrar un caso',
        !/vecinosEnSheets\?\.\[0\]\?\.edificio/.test(soloCod));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  El reclamo de un edificio no es el del otro, y en el medio hay dos consorcios.\n');
    process.exit(1);
}
console.log('\n   🏢 Un número suelto no elige edificio, y con dos se pregunta.\n');
