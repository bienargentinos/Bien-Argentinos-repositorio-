// EL NOMBRE DEL PROVEEDOR ESTÁ COPIADO EN VARIOS LADOS Y EN DOS BASES
//
//   node pruebas-renombrar-proveedor.js
//
// Daniel editó "a dario juju" desde el panel --Marcos decía *"a-dario-juju"* en voz alta-- y
// Marcos siguió llamándolo igual. Dos causas del mismo tamaño:
//
//   1. El panel escribe en Sheets; `buscarRolPorTelefono` lee PostgreSQL. La edición era
//      invisible para Marcos, para siempre.
//   2. El nombre está copiado como texto en `proveedor_asignaciones`, `facturas`, `tecnicos` y en
//      el campo `tecnico` de cada caso.
//
// Acá se prueba la decisión --qué se corrige y qué NO-- sin tocar ninguna base.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { norm, DONDE, enviadaPorCorregida } = require('./renombrar-proveedor');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const src = fs.readFileSync(path.join(__dirname, 'renombrar-proveedor.js'), 'utf8');
const claves = Object.keys(DONDE).map(norm);

console.log('\n── DÓNDE ESTÁ COPIADO EL NOMBRE ──');

prueba('están las cinco copias del nombre', () => {
    // Si mañana alguien guarda el nombre en una tabla más y no la agrega acá, la corrección queda
    // a medias -- que es peor que no corregir, porque parece hecha.
    for (const tabla of ['proveedores', 'proveedor_asignaciones', 'facturas', 'tecnicos', 'reportes']) {
        assert.ok(claves.includes(tabla), `falta ${tabla} en DONDE`);
    }
});

prueba('la asignación se corrige por la columna "proveedor", no por "nombre"', () => {
    // En `proveedor_asignaciones` el nombre del técnico vive en `proveedor`. Buscarlo en `nombre`
    // no encontraría nada y la asignación quedaría apuntando al nombre viejo: Marcos seguiría
    // llamando al técnico que ya no se llama así.
    assert.deepStrictEqual(DONDE.proveedor_asignaciones, ['proveedor']);
});

prueba('en EVENTOS y en reportes el nombre del técnico está en "tecnico"', () => {
    // `reportes` es el espejo de `EVENTOS` en PostgreSQL. Si el caso queda con el nombre viejo,
    // `buscarCasosRecientesPorTecnico` no lo encuentra: sus casos dejan de ser suyos y la próxima
    // factura no se le puede imputar.
    assert.deepStrictEqual(DONDE.EVENTOS, ['tecnico']);
    assert.deepStrictEqual(DONDE.reportes, ['tecnico']);
});

console.log('\n── QUÉ NO SE TOCA, A PROPÓSITO ──');

prueba('las conversaciones ya ocurridas no se reescriben', () => {
    // `historial_chat`, `mensajes`, `mensajes_wa` y `chat_proveedor_json` son el registro de lo
    // que se dijo y cuándo. Reescribirlo sería falsear el historial.
    for (const conversacion of ['historial_chat', 'mensajes', 'mensajes_wa', 'chat_proveedor_json']) {
        assert.ok(!claves.some(k => k === norm(conversacion)),
            `${conversacion} NO puede estar en DONDE: es el registro de la conversación`);
    }
});

prueba('"nombre" solo cuenta en las tablas de proveedores', () => {
    // `nombre` es el nombre de una PERSONA en casi todas las pestañas (un vecino, un encargado).
    // Por eso la lista va por TABLA y no por columna suelta: renombrar por columna tocaría
    // vecinos que se llaman igual.
    const conNombre = Object.entries(DONDE).filter(([, cols]) => cols.includes('nombre')).map(([t]) => norm(t));
    assert.deepStrictEqual(conNombre.sort(), ['proveedores', 'tecnicos']);
});

prueba('"dario" no se lleva puesto a "dario gomez"', () => {
    assert.notStrictEqual(norm('dario gomez'), norm('dario'));
    assert.strictEqual(norm('  A Dário Juju '), 'a dario juju');
    assert.strictEqual(norm('A DARIO JUJU'), norm('a dario juju'));
});

console.log('\n── "Nombre (rol)" DE enviada_por ──');

prueba('se cambia solo la parte del nombre y se conserva el rol', () => {
    assert.strictEqual(
        enviadaPorCorregida('a dario juju (proveedor)', norm('a dario juju'), 'Dario'),
        'Dario (proveedor)'
    );
});

prueba('sin rol también anda', () => {
    assert.strictEqual(enviadaPorCorregida('a dario juju', norm('a dario juju'), 'Dario'), 'Dario');
});

prueba('OTRA PERSONA cuyo nombre empieza igual NO se toca', () => {
    // Con "empieza con" en lugar de comparación exacta, corregir "dario" habría reescrito esta
    // fila, que es de otro técnico y probablemente de otro administrador.
    assert.strictEqual(enviadaPorCorregida('dario gomez (proveedor)', norm('dario'), 'Dario Juju'), null);
});

console.log('\n── LOS DOS LADOS ──');

prueba('escribe en Sheets Y en PostgreSQL', () => {
    // Corregir solo en Sheets es exactamente el bug: el panel muestra el nombre nuevo y Marcos
    // sigue diciendo el viejo, porque `buscarRolPorTelefono` lee PostgreSQL.
    assert.ok(/require\('\.\/sheets'\)/.test(src), 'falta el lado de Sheets');
    assert.ok(/require\('\.\/db-pg'\)/.test(src), 'falta el lado de PostgreSQL');
});

prueba('por defecto no escribe nada', () => {
    assert.ok(/aplicar\s*=\s*false/.test(src),
        'sin --aplicar tiene que listar lo que cambiaría y no tocar los datos');
});

prueba('el UPDATE va fila por fila, no masivo', () => {
    // Un UPDATE masivo aborta entero si dos filas quedan iguales por una restricción única
    // (pasó con uq_proveedor_asignaciones) y se lleva puestas las tablas que faltaban.
    assert.ok(/WHERE ctid = \$1/.test(src), 'tiene que actualizar fila por fila con ctid');
    assert.ok(/unique\|duplicad\|duplicate/.test(src),
        'una fila que quedaría duplicada tiene que explicarse, no salir como un error crudo');
});

prueba('un fallo parcial se informa, no se traga', () => {
    // Un renombrado que dice "listo" con la mitad sin hacer es peor que uno que falla entero.
    assert.ok(/fallidos\+\+/.test(src));
    assert.ok(/NO se pudieron corregir/.test(src));
});

prueba('se puede llamar desde el panel sin reimplementarlo', () => {
    // `/api/proveedor-editar` tiene que LLAMAR a esto cuando cambia el nombre. Reimplementarlo
    // adentro del panel es lo que pasó con `buscarPerfilEdificio`, que quedó escrito dos veces y
    // arreglar una copia no cambió nada en producción.
    const { renombrarProveedor } = require('./renombrar-proveedor');
    assert.strictEqual(typeof renombrarProveedor, 'function');
    assert.ok(/require\.main === module/.test(src),
        'el programa y el módulo tienen que convivir sin que cargarlo ejecute nada');
});

console.log('');
if (fallos === 0) {
    console.log('✅ El nombre se corrige en sus copias y en las dos bases; la conversación no se toca.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
