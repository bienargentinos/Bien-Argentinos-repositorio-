// Verifica a qué caso abierto se engancha un mensaje cuando se busca por teléfono.
//
//   node pruebas-caso-del-telefono.js
//
// POR QUÉ. El paso 2 de `guardarReporte` decía `(rEdif === eBuscado || !eBuscado)`: con el edificio
// vacío enganchaba con cualquier caso abierto de ese teléfono, en cualquier consorcio. Un vecino con
// casa y oficina en dos edificios, o un técnico con trabajos abiertos en tres, terminaba con el
// mensaje pegado al caso de otro consorcio. Está en CLAUDE.md como "una bomba con el seguro puesto".
//
// Se prueba con datos, no leyendo el código: un candado que mira texto se esquiva sin querer en
// cualquier refactor. Y además un candado chico para que el comodín no vuelva a sheets.js.

const fs = require('fs');
const path = require('path');
const { casoAbiertoDelTelefono } = require('./caso-del-telefono');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

const fila = (campos) => ({ get: (k) => campos[k] ?? '' });
const TEL = '5491169241157';
const idDe = (r) => r.fila ? r.fila.get('id_evento') : null;

// En el orden de la planilla: lo más nuevo, al final.
const casa    = fila({ id_evento: 'CASO-1001', telefono: TEL, edificio: 'San Patricio 159', estado: 'en_proceso' });
const oficina = fila({ id_evento: 'CASO-1003', telefono: TEL, edificio: 'Rivadavia 4',      estado: 'nuevo' });
const casa2   = fila({ id_evento: 'CASO-1004', telefono: TEL, edificio: 'san patricio 159', estado: 'avisado' });
const cerrado = fila({ id_evento: 'CASO-1005', telefono: TEL, edificio: 'Rivadavia 4',      estado: 'resuelto' });
const ajeno   = fila({ id_evento: 'CASO-1006', telefono: '5491100000000', edificio: 'Rivadavia 4', estado: 'nuevo' });

console.log('\n── CON EDIFICIO: COMO SIEMPRE ──');
{
    const r = casoAbiertoDelTelefono([casa, oficina, casa2], { telBuscado: TEL, edificio: 'San Patricio 159' });
    verificar('elige el más reciente de ese edificio', idDe(r), 'CASO-1004');
    verificar('no es ambiguo', r.ambiguo, false);
    verificar('la oficina con el edificio de la oficina',
        idDe(casoAbiertoDelTelefono([casa, oficina, casa2], { telBuscado: TEL, edificio: 'Rivadavia 4' })), 'CASO-1003');
    verificar('un edificio sin casos abiertos no engancha con otro',
        idDe(casoAbiertoDelTelefono([casa, oficina], { telBuscado: TEL, edificio: 'Otro 1' })), null);
}

console.log('\n── SIN EDIFICIO Y UN SOLO EDIFICIO: SE ENGANCHA ──');
{
    // Es el caso normal: no hay nada que adivinar. Cambiarlo partiría conversaciones en dos.
    const r = casoAbiertoDelTelefono([casa, cerrado, casa2], { telBuscado: TEL, edificio: '' });
    verificar('engancha al más reciente', idDe(r), 'CASO-1004');
    verificar('mayúsculas distintas son el mismo edificio', r.ambiguo, false);
    verificar('un caso CERRADO de otro edificio no vuelve ambiguo al abierto', r.edificios, ['san patricio 159']);
}

console.log('\n── SIN EDIFICIO Y DOS EDIFICIOS: NO SE ADIVINA ──');
{
    const r = casoAbiertoDelTelefono([casa, oficina, casa2], { telBuscado: TEL, edificio: '' });
    verificar('no elige ninguno', idDe(r), null);
    verificar('lo dice', r.ambiguo, true);
    verificar('con los dos edificios, para el log', r.edificios.sort(), ['rivadavia 4', 'san patricio 159']);

    const sinEdif = fila({ id_evento: 'CASO-1007', telefono: TEL, edificio: '', estado: 'nuevo' });
    verificar('un caso abierto SIN edificio al lado de otro también es ambiguo',
        casoAbiertoDelTelefono([casa, sinEdif], { telBuscado: TEL }).ambiguo, true);
    verificar('undefined como edificio es lo mismo que vacío',
        idDe(casoAbiertoDelTelefono([casa, oficina], { telBuscado: TEL, edificio: undefined })), null);
}

console.log('\n── LA SEPARACIÓN POR RUBRO VA PRIMERO ──');
{
    // Si la oficina igual no se podría elegir (otro rubro, o es una reserva), no puede volver
    // ambiguo al caso de la casa que sí.
    const esOtroCaso = (r) => r.get('id_evento') === 'CASO-1003';
    const r = casoAbiertoDelTelefono([casa, oficina], { telBuscado: TEL, esOtroCaso });
    verificar('queda un solo edificio → engancha', idDe(r), 'CASO-1001');
    verificar('y no es ambiguo', r.ambiguo, false);
}

console.log('\n── LO QUE NO ES DE ESE TELÉFONO NO CUENTA ──');
{
    verificar('otro teléfono en otro edificio no vuelve ambiguo nada',
        idDe(casoAbiertoDelTelefono([casa, ajeno], { telBuscado: TEL })), 'CASO-1001');
    verificar('teléfono corto no busca',
        idDe(casoAbiertoDelTelefono([casa], { telBuscado: '12345' })), null);
    verificar('sin filas no hay caso', idDe(casoAbiertoDelTelefono([], { telBuscado: TEL })), null);
}

console.log('\n── CANDADO: EL COMODÍN NO VUELVE A sheets.js ──');
{
    const lineas = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8')
        .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l));
    const conComodin = lineas.filter(l => /\|\|\s*!eBuscado\b/.test(l));
    verificar('ninguna línea de código de sheets.js usa `|| !eBuscado`', conComodin, []);
    const usa = lineas.some(l => /casoAbiertoDelTelefono\(/.test(l));
    verificar('guardarReporte llama a casoAbiertoDelTelefono', usa, true);
}

console.log(fallos ? `\n❌ ${fallos} fallo(s).` : '\n✅ Todo en orden.');
process.exit(fallos ? 1 : 0);
