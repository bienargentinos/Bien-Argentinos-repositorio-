/**
 * NADIE ASIGNA UNA EXPENSA A UN VECINO: LA UNIDAD ESCRITA ES LA LLAVE
 *
 * > [!CAUTION]
 * > **Si la unidad no coincide, falla en silencio.**
 *
 * El portal trae las expensas de su edificio cuyo `departamento` esté vacío o sea el suyo. Si el
 * PDF dice `Depto 1` y el vecino tiene cargado `1A`, no coinciden — y no pasa nada visible: el
 * vecino entra, no ve su expensa y cree que el administrador no la subió; el administrador la ve
 * publicada en su panel. Nadie se entera.
 *
 * Con una por mes se nota. Con cuarenta subidas de golpe se cuelan tres y aparecen como un
 * reclamo dos semanas después. Por eso la subida múltiple necesita esta revisión ANTES de
 * publicar: sin ella no resuelve el trabajo, lo multiplica.
 *
 * Y la distinción que esta prueba cuida por sobre todo: **"no coincide" no es "está mal"**. Una
 * unidad correcta sin vecino registrado todavía se publica igual. Llamarle error sería un falso
 * positivo, y un informe que grita por cosas que están bien es uno que se deja de mirar.
 *
 *     node pruebas-unidades-edificio.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { revisarTanda, resumenTanda } = require('./unidades-edificio');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

// Las unidades del edificio, escritas como las carga una persona.
const CONOCIDAS = ['1° A', '1° B', '4C', 'PB 2'];

console.log('\n📋 LA UNIDAD ESCRITA ES LA LLAVE\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Una tanda como llega de verdad');
// ─────────────────────────────────────────────────────────────────────────────
{
    const filas = revisarTanda([
        { archivo: 'liquidacion.pdf',  unidad: '' },            // la general
        { archivo: 'u1a.pdf',          unidad: '1A' },          // misma unidad, otra forma
        { archivo: 'u1b.pdf',          unidad: 'Depto 1 B' },   // con ruido de formulario
        { archivo: 'u4c.pdf',          unidad: '4° C' },
        { archivo: 'upb.pdf',          unidad: 'PB2' },
        { archivo: 'u9z.pdf',          unidad: '9° Z' },        // no existe todavía
    ], CONOCIDAS);

    const por = (a) => filas.find(f => f.archivo === a);

    vale('la que no trae unidad es la general', por('liquidacion.pdf').estado === 'general');
    vale('"1A" encuentra a "1° A"', por('u1a.pdf').estado === 'ok');
    vale('"Depto 1 B" encuentra a "1° B"', por('u1b.pdf').estado === 'ok',
        'El "Depto" es ruido del formulario, no parte de la unidad.');
    vale('"4° C" encuentra a "4C"', por('u4c.pdf').estado === 'ok');
    vale('"PB2" encuentra a "PB 2"', por('upb.pdf').estado === 'ok');
    vale('"9° Z" queda marcada', por('u9z.pdf').estado === 'sin_vecino');

    const r = resumenTanda(filas);
    vale('el resumen cuenta bien', r.total === 6 && r.ok === 4 && r.general === 1 && r.sin_vecino === 1,
        JSON.stringify(r));
    vale('y dice que hay algo para mirar', r.hayQueMirar === true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) "No coincide" NO es "está mal"');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Es la distinción que decide si el administrador corrige o publica igual.
    const [fila] = revisarTanda([{ archivo: 'x.pdf', unidad: '9° Z' }], CONOCIDAS);

    vale('el estado no se llama "error"', fila.estado === 'sin_vecino', `Dio: ${fila.estado}`);
    vale('el mensaje dice que se puede publicar igual',
        /se puede publicar igual/i.test(fila.mensaje), fila.mensaje);
    vale('…y también advierte por si está mal escrita',
        /mal escrita|nadie la va a ver/i.test(fila.mensaje), fila.mensaje);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) La misma unidad dos veces en la tanda');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Casi siempre es el mismo PDF elegido dos veces, o dos meses mezclados. Publicar los dos
    // deja al vecino con dos expensas del mismo período y sin saber cuál pagar.
    const filas = revisarTanda([
        { archivo: 'primero.pdf', unidad: '1° A' },
        { archivo: 'otra_vez.pdf', unidad: '1A' },
    ], CONOCIDAS);

    vale('la primera pasa', filas[0].estado === 'ok');
    vale('la segunda se marca como repetida', filas[1].estado === 'repetida', `Dio: ${filas[1].estado}`);
    vale('y dice cuál era la otra', /primero\.pdf/.test(filas[1].mensaje), filas[1].mensaje);
    vale('la repetición se detecta aunque esté escrita distinto',
        filas[1].unidad === '1A', 'El cotejo es por la unidad normalizada, no por el texto.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) Sin unidades conocidas no se inventan cuarenta advertencias');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Este es el caso que hay que tratar aparte: si la base no contestó, `unidadesConVecino`
    // devuelve null --"no se pudo verificar"-- y NO una lista vacía. Con lista vacía, una tanda
    // entera saldría marcada y el administrador aprendería a ignorar el aviso en la primera
    // tanda. Acá se verifica que la función de verdad distingue las dos cosas.
    const src = fs.readFileSync(path.join(__dirname, 'unidades-edificio.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

    vale('`unidadesConVecino` devuelve null cuando la base falla',
        /catch[\s\S]{0,400}?return null;/.test(src),
        'Con [] la tanda entera saldría como sin_vecino: cuarenta advertencias falsas.');

    // Y mientras tanto, una tanda contra una lista vacía marca pero no rompe.
    const filas = revisarTanda([{ archivo: 'a.pdf', unidad: '1A' }], []);
    vale('con lista vacía marca sin_vecino, no se cae', filas[0].estado === 'sin_vecino');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Las unidades salen de DOS tablas, no de una');
// ─────────────────────────────────────────────────────────────────────────────
{
    const src = fs.readFileSync(path.join(__dirname, 'unidades-edificio.js'), 'utf8');

    // `usuario_unidades` es quien ya entró al portal; `vecinos` es quien Marcos conoce por
    // WhatsApp aunque nunca haya entrado. Con una sola, media docena de unidades legítimas
    // saldrían como desconocidas.
    vale('mira usuario_unidades', /FROM usuario_unidades/.test(src));
    vale('y también vecinos', /FROM vecinos/.test(src),
        'Un vecino que habla con Marcos por WhatsApp y nunca entró al portal existe igual.');

    // El plegado de acentos del lado de PostgreSQL, como en el resto del proyecto.
    vale('los edificios se comparan plegando acentos', /translate\(lower\(trim/.test(src));

    vale('y no escribe nada', !/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(src),
        'Es una verificación previa: si escribiera algo, cambiaría lo que está por medir.');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Una unidad que no coincide deja al vecino sin su expensa, en silencio.\n');
    process.exit(1);
}
console.log('\n   📋 Cuarenta archivos, una mirada, y lo dudoso marcado antes de publicar.\n');
