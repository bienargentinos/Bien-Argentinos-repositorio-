// Verifica que Marcos no mande a un técnico a la dirección de otro edificio.
//
//   node pruebas-perfil-edificio.js
//
// EL CASO REAL. Daniel avisó por una cámara en **San Patricio 270**. El panel mostraba 270, y
// Marcos le contestó:
//
//   "la dirección correcta es San Patricio 159, para el ingreso por favor comuníquese con
//    Natalia Zeballos, número 5491167350436"
//
// Dirección equivocada y contacto de ingreso de otro consorcio. La regla vieja juntaba TODOS los
// números de nombre + dirección + alias en una bolsa y le alcanzaba con que uno coincidiera:
//
//     const numsR = (nombre + ' ' + direccion + ' ' + aliases).match(/\d+/g) || [];
//     return numBuscado.some(n => numsR.includes(n));
//
// Nunca miraba el nombre de la calle. Así, un 270 escrito en los alias de una fila avalaba la
// dirección 159 de esa misma fila. Y "Rivadavia 270" habría coincidido con "San Patricio 270".

const { elegirFilaEdificio, puntaje } = require('./perfil-edificio');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// Las filas se leen con `get`, igual que en Sheets y en PostgreSQL.
const fila = (campos) => ({ get: (k) => campos[k] ?? '' });
const leer = (f, campo) => f.get(campo);

// Callar el aviso de ambigüedad: que avise es correcto, pero acá ensucia la salida.
const sinRuido = (fn) => {
    const w = console.warn; console.warn = () => {};
    try { return fn(); } finally { console.warn = w; }
};

const elegir = (filas, buscado) => {
    const r = sinRuido(() => elegirFilaEdificio(filas, buscado, leer));
    return r ? r.fila.get('direccion') || r.fila.get('edificio') : null;
};

// La planilla real de Daniel: dos consorcios en la misma calle y un alias interno.
const PLANILLA = [
    fila({ edificio: 'San patricio 270', nombre: 'San patricio 270', direccion: 'San Patricio 270', encargado: 'Roberto' }),
    fila({ edificio: 'san patricio casa', nombre: 'san patricio casa', direccion: 'San Patricio 159', aliases: 'la casa, san patricio chico', encargado: 'Natalia Zeballos' }),
    fila({ edificio: 'Rivadavia 270', nombre: 'Rivadavia 270', direccion: 'Rivadavia 270', encargado: 'Jorge' }),
];

console.log('\n── EL CASO REAL ──');
{
    verificar('"San patricio 270" da el 270, no el 159',
        elegir(PLANILLA, 'San patricio 270'), 'San Patricio 270');
    verificar('"san patricio casa" da el 159',
        elegir(PLANILLA, 'san patricio casa'), 'San Patricio 159');
    verificar('"San Patricio 159" da el 159',
        elegir(PLANILLA, 'San Patricio 159'), 'San Patricio 159');
}

console.log('\n── EL NÚMERO SOLO NO IDENTIFICA NADA ──');
{
    // Con la regla vieja, cualquier fila que tuviera un 270 en cualquier campo servía.
    verificar('"Rivadavia 270" no es San Patricio',
        elegir(PLANILLA, 'Rivadavia 270'), 'Rivadavia 270');
    verificar('un número suelto no alcanza para elegir', elegir(PLANILLA, '270'), null);
}

console.log('\n── UNA ALTURA QUE SE CONTRADICE NUNCA COINCIDE ──');
{
    // Este es el corazón del arreglo: el 270 y el 159 de la misma calle son dos consorcios.
    verificar('270 contra una dirección que dice 159', puntaje('San Patricio 159', 'San Patricio 270'), 0);
    verificar('159 contra una dirección que dice 270', puntaje('San Patricio 270', 'San Patricio 159'), 0);
    verificar('misma calle y misma altura sí', puntaje('San Patricio 270', 'san patricio 270') > 0, true);
    verificar('sin calle en común, nada', puntaje('Rivadavia 270', 'San Patricio 270'), 0);
}

console.log('\n── UN ALIAS QUE MENCIONA OTRO NÚMERO NO AVALA LA DIRECCIÓN ──');
{
    // Exactamente lo que pasó: el 270 aparecía en los alias de una fila cuya dirección era el 159.
    // Antes los números de los tres campos iban a la misma bolsa; ahora cada campo se juzga solo.
    const conAliasCruzado = [
        fila({ edificio: 'san patricio casa', nombre: 'san patricio casa', direccion: 'San Patricio 159', aliases: 'al lado del 270' }),
        fila({ edificio: 'San patricio 270', nombre: 'San patricio 270', direccion: 'San Patricio 270' }),
    ];
    verificar('el alias no arrastra la dirección de otro',
        elegir(conAliasCruzado, 'San patricio 270'), 'San Patricio 270');
}

console.log('\n── ANTE LA DUDA NO SE INVENTA UNA DIRECCIÓN ──');
{
    // Dos edificios de la misma calle y ninguna altura con que desempatar: elegir uno es tirar una
    // moneda con el lugar al que va a ir un técnico. Sin perfil, quien pregunta se queda con el
    // nombre interno del edificio: vago, pero no falso.
    const ambiguo = [
        fila({ edificio: 'San Patricio A', nombre: 'San Patricio A', direccion: 'San Patricio 100' }),
        fila({ edificio: 'San Patricio B', nombre: 'San Patricio B', direccion: 'San Patricio 900' }),
    ];
    verificar('dos "San Patricio" sin altura: no se elige', elegir(ambiguo, 'san patricio'), null);

    // Pero con la altura dicha, no hay duda ninguna.
    verificar('con la altura sí se elige', elegir(ambiguo, 'san patricio 900'), 'San Patricio 900');
}

console.log('\n── LO QUE YA FUNCIONABA SIGUE FUNCIONANDO ──');
{
    verificar('coincide por alias completo',
        elegir(PLANILLA, 'la casa'), 'San Patricio 159');
    verificar('un edificio que no existe da null',
        elegir(PLANILLA, 'Corrientes 1234'), null);
    verificar('sin nombre buscado, null',
        sinRuido(() => elegirFilaEdificio(PLANILLA, '', leer)), null);
    verificar('sin filas, null',
        sinRuido(() => elegirFilaEdificio([], 'San patricio 270', leer)), null);
}

console.log('\n── LAS DOS COPIAS NO PUEDEN VOLVER A SEPARARSE ──');
{
    // El error estaba escrito dos veces, igual, en sheets.js y en datos-pg.js -- y `datos.js` lee
    // PostgreSQL primero, así que arreglar una sola no habría cambiado nada en producción.
    const fs = require('fs');
    const path = require('path');
    for (const archivo of ['sheets.js', 'datos-pg.js']) {
        const src = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
        verificar(`${archivo} usa el módulo compartido`, src.includes("require('./perfil-edificio')"), true);
        verificar(`${archivo} ya no junta los números en una bolsa`,
            /numsR\s*=\s*\(nombre/.test(src), false);
    }
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
