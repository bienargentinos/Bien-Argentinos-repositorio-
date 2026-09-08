// EL NOMBRE DEL PROVEEDOR ESTÁ COPIADO EN VARIOS LADOS Y EN DOS BASES
//
//   node pruebas-renombrar-proveedor.js
//
// Daniel editó "a dario juju" desde el panel --Marcos decía *"a-dario-juju"* en voz alta-- y
// Marcos siguió llamándolo igual. Dos causas del mismo tamaño:
//
//   1. El panel escribe en Sheets; `buscarRolPorTelefono` lee PostgreSQL. La edición era
//      invisible para Marcos, para siempre.
//   2. El nombre está copiado como texto en `proveedor_asignaciones`, `facturas` y `reportes`.
//
// Acá se prueba la decisión --qué se renombra y qué NO-- sin tocar ninguna base.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { norm } = require('./renombrar-proveedor');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const src = fs.readFileSync(path.join(__dirname, 'renombrar-proveedor.js'), 'utf8');

console.log('\n── QUÉ SE RENOMBRA ──');

prueba('están las cuatro copias del nombre', () => {
    // Si mañana alguien guarda el nombre en una tabla más y no la agrega acá, el renombrado queda
    // a medias -- que es peor que no renombrar, porque parece hecho.
    for (const tabla of ['proveedores', 'proveedor_asignaciones', 'reportes', 'facturas']) {
        assert.ok(new RegExp(`'${tabla}'\\s*:`).test(src), `falta ${tabla} en la lista DONDE`);
    }
});

prueba('la asignación se renombra por la columna "proveedor", no por "nombre"', () => {
    // En `proveedor_asignaciones` el nombre del técnico vive en `proveedor`. Buscarlo en `nombre`
    // no encontraría nada y la asignación quedaría apuntando al nombre viejo: Marcos seguiría
    // llamando al técnico que ya no se llama así.
    assert.ok(/'proveedor_asignaciones':\s*\['proveedor'\]/.test(src));
});

prueba('en EVENTOS/reportes el nombre del técnico está en "tecnico"', () => {
    assert.ok(/'reportes':\s*\['tecnico'\]/.test(src));
    assert.ok(/'eventos':\s*\['tecnico'\]/.test(src));
});

console.log('\n── QUÉ NO SE RENOMBRA ──');

prueba('NO se renombra por columna suelta: "nombre" es una persona en casi todas las pestañas', () => {
    // Un vecino que se llame igual que el técnico no se toca. Por eso la lista va por TABLA.
    assert.ok(!/^\s*const\s+COL_NOMBRE\s*=\s*new Set/m.test(src),
        'la lista tiene que ir por tabla, no por nombre de columna suelto');
    assert.ok(/'proveedores':\s*\['nombre'\]/.test(src),
        '"nombre" solo cuenta dentro de la pestaña proveedores');
});

prueba('la comparación es exacta: "dario" no se lleva puesto a "dario gomez"', () => {
    assert.notStrictEqual(norm('dario gomez'), norm('dario'));
    assert.ok(!norm('dario gomez').startsWith('|'));
    // La normalización iguala mayúsculas, acentos y espacios de más, y nada más que eso.
    assert.strictEqual(norm('  A Dário   Juju '), 'a dario juju');
    assert.strictEqual(norm('A DARIO JUJU'), norm('a dario juju'));
});

prueba('el texto compuesto solo se toca si el nombre está al principio', () => {
    // `enviada_por` es "a dario juju (proveedor)". En el medio de una frase, el mismo texto puede
    // ser cualquier otra cosa.
    assert.ok(/startsWith\(N_VIEJO\)/.test(src));
});

console.log('\n── LOS DOS LADOS ──');

prueba('escribe en Sheets Y en PostgreSQL', () => {
    // Renombrar solo en Sheets es exactamente el bug: el panel muestra el nombre nuevo y Marcos
    // sigue diciendo el viejo.
    assert.ok(/require\('\.\/sheets'\)/.test(src), 'falta el lado de Sheets');
    assert.ok(/require\('\.\/db-pg'\)/.test(src), 'falta el lado de PostgreSQL');
});

prueba('por defecto no escribe nada', () => {
    assert.ok(/aplicar\s*=\s*false/.test(src),
        'sin --aplicar tiene que listar lo que cambiaría y no tocar los datos');
});

prueba('un fallo parcial se informa, no se traga', () => {
    // Un renombrado que dice "listo" con la mitad sin hacer es peor que uno que falla entero.
    assert.ok(/fallidos\+\+/.test(src));
    assert.ok(/fallidos/.test(src) && /NO se pudieron renombrar/.test(src));
});

prueba('el UPDATE va fila por fila, no masivo', () => {
    // Un UPDATE masivo aborta entero si dos filas quedan iguales por una restricción única, y se
    // lleva puestas las tablas que faltaban.
    assert.ok(/WHERE ctid = \$1/.test(src), 'tiene que actualizar fila por fila con ctid');
});

console.log('');
if (fallos === 0) {
    console.log('✅ El nombre se renombra en sus cuatro copias y en las dos bases.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
