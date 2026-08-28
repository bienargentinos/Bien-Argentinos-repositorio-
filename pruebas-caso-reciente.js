// Verifica que "el caso más nuevo del técnico" sea el más nuevo de verdad.
//
//   node pruebas-caso-reciente.js
//
// EL CASO REAL. Daniel tenía abiertos el CASO-1001 (de días atrás, en "san patricio casa") y el
// CASO-1003 (de esa tarde, en "san patricio 270"). Mandó la foto y la factura del 1003 y Marcos:
//
//   1. cerró el CASO-1001 ("RECLAMO SOLUCIONADO… puerta de entrada y luces del hall"),
//   2. archivó la factura contra el CASO-1001,
//   3. y después le contestó con el contacto de ingreso del edificio del 1001.
//
// Los tres salen del mismo lugar:
//
//     const res = await pool.query(`SELECT * FROM reportes`);   // sin ORDER BY
//     [...abiertos].reverse().find(...)                          // "el último" = el último FÍSICO
//
// `SELECT *` sin `ORDER BY` no promete ningún orden, y en PostgreSQL una fila ACTUALIZADA se mueve
// al final del heap. El CASO-1001 recibía líneas de chat todo el tiempo, así que cada UPDATE lo
// empujaba al final: terminó siendo "la última fila" siendo el caso más viejo.

const { elegirCasoMasReciente, numeroDeCaso, fechaEnMs } = require('./caso-reciente');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

const fila = (campos) => ({ get: (k) => campos[k] ?? '' });
const leer = (f, campo) => f.get(campo);
const cual = (filas) => {
    const r = elegirCasoMasReciente(filas, leer);
    return r ? r.get('codigo_caso') : null;
};

console.log('\n── EL CASO REAL ──');
{
    // Tal como llegaron de PostgreSQL: el 1001 AL FINAL, porque se venía actualizando.
    const comoVinieron = [
        fila({ codigo_caso: 'CASO-1002', edificio: 'san patricio casa', fecha: '26/08/2026, 03:36:23' }),
        fila({ codigo_caso: 'CASO-1003', edificio: 'san patricio 270',  fecha: '27/08/2026, 14:54:00' }),
        fila({ codigo_caso: 'CASO-1001', edificio: 'san patricio casa', fecha: '25/08/2026, 10:00:00' }),
    ];
    verificar('la foto y la factura van al CASO-1003, no al 1001', cual(comoVinieron), 'CASO-1003');
}

console.log('\n── EL NÚMERO DE CASO MANDA ──');
{
    // Es una secuencia que generamos nosotros: siempre crece, y no depende de ningún formato.
    verificar('1003 gana a 1001', cual([
        fila({ codigo_caso: 'CASO-1003' }),
        fila({ codigo_caso: 'CASO-1001' }),
    ]), 'CASO-1003');

    verificar('no importa en qué orden vengan', cual([
        fila({ codigo_caso: 'CASO-1001' }),
        fila({ codigo_caso: 'CASO-1003' }),
        fila({ codigo_caso: 'CASO-1002' }),
    ]), 'CASO-1003');

    // Ojo con comparar como texto: "CASO-999" > "CASO-1003" alfabéticamente, y sería al revés.
    verificar('999 y 1003 se comparan como números, no como texto', cual([
        fila({ codigo_caso: 'CASO-999' }),
        fila({ codigo_caso: 'CASO-1003' }),
    ]), 'CASO-1003');

    verificar('numeroDeCaso lee el número', numeroDeCaso('CASO-1003'), 1003);
    verificar('sin número, null', numeroDeCaso('sin codigo'), null);
}

console.log('\n── SIN NÚMERO, DECIDE LA FECHA ──');
{
    // La fecha se guarda en formato argentino, que `new Date()` lee al revés (mes/día) o no lee.
    verificar('27/08 gana a 25/08', cual([
        fila({ codigo_caso: '', fecha: '25/08/2026, 10:00:00' }),
        fila({ codigo_caso: '', fecha: '27/08/2026, 14:54:00' }),
    ]), '');

    verificar('el formato argentino se lee bien',
        fechaEnMs('27/08/2026, 14:54:00'), Date.UTC(2026, 7, 27, 14, 54, 0));
    verificar('13/08 es 13 de agosto, no el mes 13',
        fechaEnMs('13/08/2026, 09:00:00'), Date.UTC(2026, 7, 13, 9, 0, 0));
    verificar('sin fecha, null', fechaEnMs(''), null);

    // Con un caso numerado y otro sin numerar, gana el numerado: el número es dato nuestro y la
    // fecha puede venir de cualquier lado.
    const mezcla = [
        fila({ codigo_caso: '', fecha: '28/08/2026, 23:00:00' }),
        fila({ codigo_caso: 'CASO-1003', fecha: '27/08/2026, 14:54:00' }),
    ];
    verificar('el que tiene número gana al que no', cual(mezcla), 'CASO-1003');
}

console.log('\n── BORDES ──');
{
    verificar('lista vacía, null', elegirCasoMasReciente([], leer), null);
    verificar('no es una lista, null', elegirCasoMasReciente(null, leer), null);
    verificar('uno solo, ese', cual([fila({ codigo_caso: 'CASO-1001' })]), 'CASO-1001');
    // Sin número ni fecha en ninguno, se elige el último que vino: no es confiable --de eso se
    // trata todo esto-- pero hay que devolver alguno y no romper.
    verificar('sin nada con qué comparar, no revienta', cual([
        fila({ codigo_caso: '' }), fila({ codigo_caso: '' }),
    ]), '');
}

console.log('\n── EL ORDEN FÍSICO NO PUEDE VOLVER A DECIDIR ──');
{
    // El error estaba en cuatro lugares de datos-pg.js, todos con la misma forma.
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, 'datos-pg.js'), 'utf8');

    // Se miran SOLO las funciones que leen `reportes`: ahí el orden decide a qué caso se le imputa
    // una factura y a qué vecino se le escribe. `vecinos` no tiene ninguna secuencia ni fecha con
    // qué ordenar, y queda documentado en el código como último recurso.
    const funciones = src.split(/\n(?=(?:async )?function )/);
    const deCasos = funciones.filter(f => f.includes("filas('reportes')"));
    verificar('hay funciones que leen reportes', deCasos.length > 0, true);

    // Sin los comentarios: esta misma prueba nombra el patrón prohibido para explicarlo, y el
    // comentario que lo explica no es una violación.
    const sinComentarios = (f) => f.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    const culpables = deCasos
        .filter(f => /\.reverse\(\)\.find|\[\.\.\.abiertos\]\.reverse/.test(sinComentarios(f)))
        .map(f => (f.match(/function\s+(\w+)/) || [, '?'])[1]);
    verificar('ninguna búsqueda sobre reportes usa el orden físico', culpables, []);
    verificar('las búsquedas de caso pasan por caso-reciente.js',
        src.includes("require('./caso-reciente')"), true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
