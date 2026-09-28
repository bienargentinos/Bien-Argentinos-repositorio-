// Verifica que la memoria de cada línea encuentre el mismo celular escrito con y sin el 9.
//
//   node pruebas-lineas-telefono.js
//
// POR QUÉ. Prueba de cerrajería, 28/09: la plantilla del CASO-1003 se anotó bajo `541169241157` y
// el "Ok" del técnico llegó desde `5491169241157`. Marcos no encontró la línea, cayó en "el caso más
// reciente" y le mandó al técnico la foto y los datos del CASO-1004. Y una confirmación de hace 16
// días se le contó al vecino como si fuera de hoy.

const fs = require('fs');
const path = require('path');
const { claveDeLinea, mapaDeLineas } = require('./lineas-telefono');
const { confirmacionEsReciente } = require('./llegada-tecnico');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

console.log('\n── EL MISMO CELULAR, ESCRITO COMO VENGA ──');
verificar('con el 9 y sin el 9 son la misma línea', claveDeLinea('5491169241157'), claveDeLinea('541169241157'));
verificar('con + y espacios también', claveDeLinea('+54 9 11 6924-1157'), '1169241157');
verificar('vacío sigue vacío', claveDeLinea(''), '');

console.log('\n── EL CASO DE LA PRUEBA ──');
{
    delete global.colasProveedores;
    const m = mapaDeLineas();
    m.set('541169241157', { eventoActivoId: 'CASO-1003' });      // lo anota marcos-ops al mandar la plantilla
    verificar('el "Ok" que llega con el 9 encuentra el CASO-1003', m.get('5491169241157')?.eventoActivoId, 'CASO-1003');
    verificar('has() también', m.has('5491169241157'), true);
    verificar('es una sola línea, no dos', m.size, 1);
    verificar('llamarla dos veces devuelve el mismo mapa', mapaDeLineas() === m, true);

    global.colasProveedores = new Map([['541169241157', { eventoActivoId: 'CASO-1003' }]]);
    verificar('un Map común que ya existía se convierte sin perder nada',
        mapaDeLineas().get('5491169241157')?.eventoActivoId, 'CASO-1003');
    delete global.colasProveedores;
}

console.log('\n── UNA CONFIRMACIÓN DE HACE DÍAS NO ES DE HOY ──');
{
    const ar = (ms) => { const d = new Date(ms - 3 * 3600e3);
        return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}, ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`; };
    verificar('la de Dario del 12/9 (16 días) no cuenta', confirmacionEsReciente(ar(Date.now() - 16 * 864e5)), false);
    verificar('una de hace 2 horas sí', confirmacionEsReciente(ar(Date.now() - 2 * 3600e3)), true);
    verificar('"voy mañana a la tarde" dicho anoche sí (47 hs)', confirmacionEsReciente(ar(Date.now() - 47 * 3600e3)), true);
    verificar('sin fecha legible no se afirma', confirmacionEsReciente('ayer'), false);
}

console.log('\n── CANDADOS ──');
{
    const codigo = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
        .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const f of ['index.js', 'agentes/marcos-ops.js']) {
        verificar(`${f} no vuelve a crear la memoria como un Map común`, /colasProveedores\s*=\s*new Map\(/.test(codigo(f)), false);
    }
    verificar('datos-pg.js filtra la confirmación por antigüedad', /confirmacionEsReciente\(/.test(codigo('datos-pg.js')), true);
}

console.log(fallos ? `\n❌ ${fallos} fallo(s).` : '\n✅ Todo en orden.');
process.exit(fallos ? 1 : 0);
