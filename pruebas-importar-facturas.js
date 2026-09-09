// IMPORTAR NO PUEDE DUPLICAR UNA FACTURA
//
//   node pruebas-importar-facturas.js
//
// > [!CAUTION]
// > **`importar-sheets-a-pg.js` identificaba una factura por `fecha + proveedor + monto +
// > edificio`.** Los cuatro cambian, así que la misma factura entraba de nuevo como fila nueva.
//
// EL CASO REAL. Había UNA factura en la planilla y la MISMA en PostgreSQL. Se corrió el import y:
//
//     ✅ "facturas" → facturas: 1 nueva(s), 0 actualizada(s) — total en la tabla: 2
//
// El mismo comprobante dos veces, y el gasto contado dos veces en el consorcio. Alcanza con que
// uno de los cuatro campos difiera:
//
//   · `edificio` está VACÍO al llegar ("Sin imputar") y se completa cuando el técnico contesta de
//     qué obra era. Antes y después son dos claves distintas.
//   · `monto` se guarda formateado de un lado ("$5500,00 ARS") y crudo del otro.
//   · `fecha` es una marca de tiempo al segundo.
//
// Lo que identifica a una factura es lo que ya usa `guardarFactura`: número de comprobante +
// proveedor.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const src = fs.readFileSync(path.join(__dirname, 'importar-sheets-a-pg.js'), 'utf8');

// La definición de `facturas` dentro del archivo, sin cargarlo: `importar-sheets-a-pg.js` abre
// PostgreSQL y Google Sheets al ejecutarse.
const bloque = (() => {
    const i = src.indexOf("pestaña: 'facturas'");
    assert.ok(i !== -1, 'no está la definición de facturas en el importador');
    const j = src.indexOf("pestaña: 'accesos'", i);
    return src.slice(i, j === -1 ? src.length : j);
})();

console.log('\n── CÓMO SE IDENTIFICA UNA FACTURA ──');

prueba('la clave usa número de comprobante + proveedor', () => {
    assert.ok(/\['numero_factura',\s*'proveedor'\]/.test(bloque),
        'la clave preferida tiene que ser numero_factura + proveedor');
});

prueba('NO se identifica por fecha + monto + edificio cuando hay número', () => {
    // El respaldo sigue existiendo para las facturas sin número, pero no puede ser la clave
    // principal: los tres campos cambian solos.
    const claveFija = /clave:\s*\['fecha',\s*'proveedor',\s*'monto',\s*'edificio'\]/.test(bloque);
    assert.ok(!claveFija,
        'la clave de facturas volvió a ser fija por campos volátiles: eso duplica el comprobante');
});

prueba('sin número de comprobante hay respaldo, no se saltea la fila', () => {
    // Perder una factura es peor que tener dos: ante la duda se inserta.
    assert.ok(/\['fecha',\s*'proveedor',\s*'monto',\s*'edificio'\]/.test(bloque),
        'tiene que quedar una clave de respaldo para las facturas sin número');
});

console.log('\n── QUÉ SE IMPORTA ──');

prueba('el número y el caso viajan a PostgreSQL', () => {
    // Sin estas dos columnas, la factura llegaba al lado que lee Marcos sin su número y sin saber
    // a qué trabajo pertenecía.
    for (const col of ['numero_factura', 'id_evento', 'nota_tecnico', 'enviada_por']) {
        assert.ok(new RegExp(`${col}:\\s*'${col}'`).test(bloque), `falta importar ${col}`);
    }
});

console.log('\n── EL MECANISMO ──');

prueba('la clave puede depender de la fila', () => {
    assert.ok(/typeof claveDef === 'function'/.test(src),
        'el importador tiene que aceptar una clave calculada por fila');
});

prueba('la clave se calcula por fila, no una sola vez para toda la pestaña', () => {
    // Si se calculara afuera del bucle, todas las filas usarían la clave de la primera: una
    // factura sin número decidiría por las que sí lo tienen.
    const bucle = src.slice(src.indexOf('for (const row of rows)'));
    assert.ok(/const clave = claveDe\(valores\)/.test(bucle),
        'la clave tiene que calcularse adentro del bucle, con los valores de ESA fila');
});

console.log('\n── EL SIGNO DE PESO ──');

prueba('el monto no lleva dos signos', () => {
    // En la planilla salió: "N° 00001-00000262 por $$5500,00 ARS". El monto a veces ya trae el
    // signo y los cuatro lugares que lo mostraban le pegaban otro adelante.
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    assert.ok(!/ por \$\$\{/.test(idx), 'quedó un lugar poniendo el signo a mano');
    assert.ok(/function montoConSigno\(/.test(idx), 'falta el formateador');

    // Y que haga lo que dice.
    const fn = new Function(`${idx.match(/function montoConSigno\([\s\S]*?\n\}/)[0]}; return montoConSigno;`)();
    assert.strictEqual(fn('5500'), '$5500');
    assert.strictEqual(fn('$5500,00 ARS'), '$5500,00 ARS');
    assert.strictEqual(fn(''), '');
    assert.strictEqual(fn(null), '');
});

console.log('');
if (fallos === 0) {
    console.log('✅ Una factura se identifica por su número, y el import no la duplica.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
