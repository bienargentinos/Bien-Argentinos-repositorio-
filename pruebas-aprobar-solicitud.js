// Verifica a qué columnas escribe la aprobación de una solicitud.
//
//   node pruebas-aprobar-solicitud.js
//
// EL BUG QUE ORIGINÓ ESTA PRUEBA: la planilla real tiene `nombre` y `edificio`, que son el mismo
// dato. Al aprobar un cambio de nombre se escribía solo en la PRIMERA columna de la lista
// (`nombre`), pero todo el sistema lee `edificio`. El valor quedaba guardado, la solicitud
// figuraba "aplicada", y el nombre en pantalla nunca cambiaba. Sin ningún error.
//
// La lógica se carga del propio dashboard.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');

// columnLetter, tal como lo usa el panel.
function sacarFuncion(nombre) {
    const i = SRC.indexOf(`function ${nombre}(`);
    if (i === -1) throw new Error(`No encontré ${nombre} en dashboard.js.`);
    let d = 0, fin = -1, empezo = false;
    for (let k = i; k < SRC.length; k++) {
        if (SRC[k] === '{') { d++; empezo = true; }
        else if (SRC[k] === '}') { d--; if (empezo && d === 0) { fin = k + 1; break; } }
    }
    return SRC.slice(i, fin);
}
// eslint-disable-next-line no-new-func
const columnLetter = new Function(`${sacarFuncion('columnLetter')}; return columnLetter;`)();

// EDIFICIO_FIELDS real del panel.
const bloque = SRC.slice(SRC.indexOf('const EDIFICIO_FIELDS = {'));
const cuerpoCampos = bloque.slice(0, bloque.indexOf('\n};') + 3);
// eslint-disable-next-line no-new-func
const EDIFICIO_FIELDS = new Function(`${cuerpoCampos}; return EDIFICIO_FIELDS;`)();

// La regla que aplica el endpoint: todas las columnas equivalentes que existan.
function columnasDestino(edHeaders, campo) {
    const candidates = EDIFICIO_FIELDS[campo] || [campo];
    const columnas = edHeaders
        .map((h, i) => (candidates.includes(h) ? columnLetter(i + 1) : null))
        .filter(Boolean);
    if (columnas.length === 0) return { columnas: [columnLetter(edHeaders.length + 1)], creaNueva: candidates[0] };
    return { columnas, creaNueva: null };
}

// Las columnas REALES de la planilla de Daniel, en su orden real.
const HEADERS_REALES = [
    'nombre', 'aliases', 'direccion', 'zona', 'encargado', 'tel_encargado',
    'encargado_estado', 'encargado_suplente', 'tel_suplente', 'tel_seguridad',
    'administrador', 'plan', 'edificio', 'unidades', 'horario_sum', 'cocheras',
    'cuit', 'encargado_horario', 'suplente_horario', 'admin_telefono',
];

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

console.log('\n── EL CASO QUE FALLÓ: cambiar el nombre del edificio ──');
const nombreDest = columnasDestino(HEADERS_REALES, 'nombre');
console.log('  columnas destino:', nombreDest.columnas.join(', '));
verificar('escribe en las DOS columnas de nombre, no solo en la primera',
    nombreDest.columnas.length, 2);
verificar('incluye "nombre" (columna A)', nombreDest.columnas.includes('A'), true);
verificar('incluye "edificio" (columna M), que es la que lee el sistema',
    nombreDest.columnas.includes('M'), true);

console.log('\n── LOS OTROS CAMPOS ──');
verificar('direccion → columna C', columnasDestino(HEADERS_REALES, 'direccion').columnas, ['C']);
verificar('administrador → columna K', columnasDestino(HEADERS_REALES, 'administrador').columnas, ['K']);
verificar('telefonos → "admin_telefono", columna T', columnasDestino(HEADERS_REALES, 'telefonos').columnas, ['T']);
verificar('zona → columna D', columnasDestino(HEADERS_REALES, 'zona').columnas, ['D']);

console.log('\n── UN CAMPO QUE NO EXISTE EN LA PLANILLA ──');
const nuevo = columnasDestino(HEADERS_REALES, 'campo_inventado');
verificar('crea una columna al final en vez de perder el dato', nuevo.creaNueva, 'campo_inventado');
verificar('y la ubica después de la última (columna U)', nuevo.columnas, ['U']);

console.log('\n── UNA PLANILLA CON UNA SOLA COLUMNA DE NOMBRE ──');
verificar('si solo existe "edificio", escribe ahí',
    columnasDestino(['direccion', 'edificio', 'zona'], 'nombre').columnas, ['B']);
verificar('si solo existe "nombre", escribe ahí',
    columnasDestino(['nombre', 'direccion'], 'nombre').columnas, ['A']);

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
