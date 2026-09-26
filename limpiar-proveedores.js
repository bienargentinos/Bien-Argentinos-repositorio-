#!/usr/bin/env node
// Borra de verdad las filas de `proveedores` y `proveedor_asignaciones` que YA ESTÁN MARCADAS
// como eliminadas o inactivas, en Google Sheets y en PostgreSQL.
//
//   node limpiar-proveedores.js            → muestra qué borraría. NO borra nada.
//   node limpiar-proveedores.js --borrar   → borra.
//
// POR QUÉ NO BORRA POR DEFECTO: es un script destructivo sobre datos de configuración, no de
// prueba. Ver la sección de reset en CLAUDE.md: `proveedores` y `proveedor_asignaciones` no se
// vacían nunca por iniciativa propia. Acá solo se sacan las filas que alguien ya dio de baja
// desde el panel, que es una decisión que ya está tomada y escrita en la planilla.
//
// SI QUERÉS SACAR UNA FILA QUE ESTÁ ACTIVA: marcala como `eliminado` en la columna `estado` de
// la planilla y volvé a correr esto. La decisión de qué se borra queda donde la podés ver, no
// escondida en un parámetro del script.

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const sheets = require('./sheets');

const BORRAR_DE_VERDAD = process.argv.includes('--borrar');
const BAJAS = new Set(['eliminado', 'eliminada', 'inactivo', 'inactiva', 'borrado', 'baja']);

const estaDadaDeBaja = fila => BAJAS.has(String(fila.get('estado') || '').toLowerCase().trim());

const descripcionProveedor = f =>
    `${f.get('nombre') || '(sin nombre)'} — ${f.get('telefono') || 'sin teléfono'}` +
    `${f.get('rubro') ? ' — ' + f.get('rubro') : ''}` +
    `${f.get('cliente') ? ' — cliente: ' + f.get('cliente') : ''}`;

const descripcionAsignacion = f =>
    `${f.get('proveedor') || '(sin proveedor)'} → ${f.get('edificio') || '(sin edificio)'}` +
    `${f.get('rubro') ? ' — ' + f.get('rubro') : ''}`;

async function filasDadasDeBaja(doc, nombrePestaña) {
    const buscado = nombrePestaña.toLowerCase();
    const titulo = Object.keys(doc.sheetsByTitle || {})
        .find(t => String(t).toLowerCase().trim() === buscado);
    if (!titulo) {
        console.log(`   (no existe la pestaña "${nombrePestaña}")`);
        return { hoja: null, aBorrar: [], total: 0 };
    }
    const hoja = doc.sheetsByTitle[titulo];
    const filas = await hoja.getRows();
    return { hoja, aBorrar: filas.filter(estaDadaDeBaja), total: filas.length };
}

(async () => {
    const doc = await sheets.getSheet();

    console.log(BORRAR_DE_VERDAD
        ? '\n🗑️  BORRANDO las filas dadas de baja...\n'
        : '\n👀 SIMULACIÓN — no se borra nada. Agregá --borrar para que se ejecute.\n');

    const provs = await filasDadasDeBaja(doc, 'proveedores');
    console.log(`📋 proveedores: ${provs.total} fila(s), ${provs.aBorrar.length} dada(s) de baja`);
    provs.aBorrar.forEach(f => console.log(`   ✖ ${descripcionProveedor(f)}`));

    const asigs = await filasDadasDeBaja(doc, 'proveedor_asignaciones');
    console.log(`\n📋 proveedor_asignaciones: ${asigs.total} fila(s), ${asigs.aBorrar.length} dada(s) de baja`);
    asigs.aBorrar.forEach(f => console.log(`   ✖ ${descripcionAsignacion(f)}`));

    const cuantas = provs.aBorrar.length + asigs.aBorrar.length;

    if (cuantas === 0) {
        console.log('\n✅ No hay nada marcado como eliminado. No se toca nada.');
        console.log('   Si querés sacar una fila que está activa, marcala como "eliminado" en la');
        console.log('   columna `estado` de la planilla y volvé a correr esto.\n');
        process.exit(0);
    }

    if (!BORRAR_DE_VERDAD) {
        console.log(`\n👀 Serían ${cuantas} fila(s). Para borrarlas de verdad:`);
        console.log('   node limpiar-proveedores.js --borrar\n');
        process.exit(0);
    }

    // Las filas se borran de atrás para adelante: borrar una fila corre las de abajo, y hacerlo
    // en orden normal terminaría borrando la fila equivocada.
    const borrarTodas = async (lista, cual) => {
        const ordenadas = [...lista].sort((a, b) => (b._rowNumber ?? b._row ?? 0) - (a._rowNumber ?? a._row ?? 0));
        for (const f of ordenadas) {
            await f.delete();
            console.log(`   🗑️  ${cual}`);
        }
    };

    await borrarTodas(provs.aBorrar, 'proveedor borrado de la planilla');
    await borrarTodas(asigs.aBorrar, 'asignación borrada de la planilla');

    // PostgreSQL es una copia y el importador solo agrega o actualiza -- nunca borra. Sin este
    // paso, las filas seguirían vivas en la base y Marcos las seguiría viendo, que es justo lo
    // que se quiso evitar.
    try {
        const { pool } = require('./db-pg');
        const condicion = `lower(trim(coalesce(estado, ''))) = ANY($1::text[])`;
        const valores = [Array.from(BAJAS)];
        const r1 = await pool.query(`DELETE FROM proveedores WHERE ${condicion}`, valores);
        const r2 = await pool.query(`DELETE FROM proveedor_asignaciones WHERE ${condicion}`, valores);
        console.log(`\n🐘 PostgreSQL: ${r1.rowCount} proveedor(es) y ${r2.rowCount} asignación(es) borradas.`);
    } catch (e) {
        console.error(`\n⚠️ No se pudo limpiar PostgreSQL: ${e.message}`);
        console.error('   La planilla ya quedó limpia. Corré `node importar-sheets-a-pg.js` y volvé a intentar.');
    }

    console.log('\n✅ Listo. Verificá cómo quedó con:  node revisar-cartera.js\n');
    process.exit(0);
})().catch(e => {
    console.error('Error limpiando proveedores:', e.message);
    process.exit(1);
});
