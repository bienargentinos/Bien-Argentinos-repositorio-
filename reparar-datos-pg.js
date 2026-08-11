require('dotenv').config();
const { pool, initPgSchema } = require('./db-pg');

/**
 * REPARACIÓN DE DATOS EN POSTGRESQL
 *
 * Dos trabajos, en este orden:
 *
 *   1. Borrar filas duplicadas que dejó el import anterior. El script de migración insertaba sin
 *      ninguna protección contra repetidos, así que correrlo dos veces duplicaba todo: la tabla
 *      `proveedores` terminó con 10 filas contra las 5 reales de la planilla.
 *
 *   2. Crear las claves únicas que impiden que vuelva a pasar. A partir de ahí, cualquier import
 *      puede correrse las veces que haga falta sin ensuciar la base.
 *
 * De cada duplicado se conserva la fila de `id` más bajo (la que entró primero) y se descartan las
 * copias posteriores. Antes de borrar nada imprime qué va a borrar, y con `--simular` muestra el
 * informe sin tocar un solo dato.
 */

const SIMULAR = process.argv.includes('--simular');

// Qué combinación de columnas identifica a una fila como "la misma". Se normaliza con
// lower(trim(...)) para que "Julio " y "julio" no cuenten como dos proveedores distintos.
const CLAVES = [
    { tabla: 'proveedores',            columnas: ['nombre', 'telefono', 'rubro', 'edificio'] },
    { tabla: 'proveedor_asignaciones', columnas: ['cliente', 'edificio', 'proveedor', 'rubro'] },
    { tabla: 'vecinos',                columnas: ['telefono', 'edificio'] },
    { tabla: 'edificios',              columnas: ['edificio'] },
    { tabla: 'clientes',               columnas: ['usuario'] },
    { tabla: 'memoria',                columnas: ['telefono'] },
    { tabla: 'tecnicos',               columnas: ['nombre', 'telefono'] },
    { tabla: 'personal',               columnas: ['edificio', 'nombre', 'rol'] },
    { tabla: 'consejo',                columnas: ['edificio', 'nombre'] },
    { tabla: 'suscripciones_planes',   columnas: ['nombre'] },
    { tabla: 'reportes',               columnas: ['codigo_caso'] },
];

// COALESCE porque en SQL dos NULL nunca son iguales entre sí: sin esto, dos filas con el mismo
// nombre y el teléfono vacío se considerarían distintas y el duplicado sobreviviría.
const norm = c => `lower(trim(coalesce(${c}::text, '')))`;

async function contar(tabla) {
    const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tabla}`);
    return r.rows[0].c;
}

async function repararTabla({ tabla, columnas }) {
    const clave = columnas.map(norm).join(", ");

    // Se agrupa SOLO por la clave normalizada, igual que el DELETE de más abajo: si además se
    // agrupara por el valor crudo, "Julio " y "julio" caerían en grupos distintos y el informe
    // diría que no hay duplicados justo cuando sí los hay.
    const dups = await pool.query(`
        SELECT ${columnas.map(c => `min(${c}::text) AS ${c}`).join(', ')}, COUNT(*)::int AS repeticiones
        FROM ${tabla}
        GROUP BY ${clave}
        HAVING COUNT(*) > 1
        ORDER BY repeticiones DESC
    `);

    if (dups.rows.length === 0) {
        console.log(`   ✅ ${tabla}: sin duplicados`);
    } else {
        const sobran = dups.rows.reduce((acc, r) => acc + (r.repeticiones - 1), 0);
        console.log(`   ⚠️  ${tabla}: ${dups.rows.length} grupo(s) repetido(s), ${sobran} fila(s) de más`);
        dups.rows.slice(0, 10).forEach(r => {
            const desc = columnas.map(c => `${c}="${r[c] ?? ''}"`).join(' ');
            console.log(`        ×${r.repeticiones}  ${desc}`);
        });
        if (dups.rows.length > 10) console.log(`        ... y ${dups.rows.length - 10} grupo(s) más`);

        if (!SIMULAR) {
            const res = await pool.query(`
                DELETE FROM ${tabla} a
                USING ${tabla} b
                WHERE a.id > b.id
                  AND ${columnas.map(c => `${norm('a.' + c)} = ${norm('b.' + c)}`).join(' AND ')}
            `);
            console.log(`        🗑️  ${res.rowCount} fila(s) duplicada(s) eliminada(s)`);
        }
    }

    // La clave única va después de limpiar: si quedara un duplicado, el índice no se puede crear.
    if (!SIMULAR) {
        const nombreIdx = `uq_${tabla}`.slice(0, 60);
        try {
            await pool.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS ${nombreIdx}
                ON ${tabla} (${columnas.map(norm).join(', ')})
            `);
            console.log(`        🔒 clave única aplicada sobre (${columnas.join(', ')})`);
        } catch (err) {
            console.log(`        ⚠️  no se pudo crear la clave única: ${err.message.split('\n')[0]}`);
        }
    }
}

async function reparar() {
    console.log(SIMULAR
        ? '🔎 MODO SIMULACIÓN — se informa qué se haría, sin modificar nada\n'
        : '🔧 Reparando datos en PostgreSQL...\n');

    // Se asegura de que existan las tablas y columnas nuevas antes de tocar los datos.
    await initPgSchema();

    console.log('\n── Antes ──');
    const antes = {};
    for (const { tabla } of CLAVES) {
        try { antes[tabla] = await contar(tabla); } catch { antes[tabla] = 'ERROR'; }
    }
    console.table(antes);

    console.log('\n── Duplicados ──');
    for (const def of CLAVES) {
        try {
            await repararTabla(def);
        } catch (err) {
            console.log(`   ❌ ${def.tabla}: ${err.message.split('\n')[0]}`);
        }
    }

    if (!SIMULAR) {
        console.log('\n── Después ──');
        const despues = {};
        for (const { tabla } of CLAVES) {
            try { despues[tabla] = await contar(tabla); } catch { despues[tabla] = 'ERROR'; }
        }
        console.table(despues);
    }

    console.log(SIMULAR
        ? '\n✅ Simulación terminada. Volvé a correrlo sin --simular para aplicar los cambios.'
        : '\n✅ Datos reparados. A partir de ahora el import se puede correr las veces que haga falta sin duplicar.');

    process.exit(0);
}

reparar().catch(err => {
    console.error('❌ Error reparando datos:', err.message);
    process.exit(1);
});
