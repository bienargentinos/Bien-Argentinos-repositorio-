// CASOS QUE DICEN COSAS DISTINTAS EN CADA BASE
//
//   node emparejar-casos.js              solo muestra, no toca nada
//   node emparejar-casos.js --aplicar    cierra en PostgreSQL los que la planilla ya dio por cerrados
//
// La decisión de qué hacer con cada caso vive en `casos-desfasados.js`, aparte, para que se pueda
// probar sin ninguna base prendida. Acá está solo el leer y el escribir.
//
// ── POR QUÉ ────────────────────────────────────────────────────────────────
//
// `copiarAPg` dispara y sigue: si PostgreSQL no contesta, la escritura se pierde y nadie
// reintenta. Es a propósito --un PostgreSQL caído no puede romper el camino que le contesta a la
// persona-- pero significa que **una caída deja las dos bases distintas para siempre**.
//
// El CASO-1001 se cerró durante el rato en que PostgreSQL rechazaba la contraseña. En la planilla
// figura `resuelto`; en PostgreSQL quedó `nuevo`. Y el motor lee PostgreSQL primero, así que para
// Marcos ese caso sigue abierto.
//
// `--aplicar` **solo cierra**, nunca reabre. Ver el porqué en `casos-desfasados.js`.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { compararCasos } = require('./casos-desfasados');

const aplicar = process.argv.includes('--aplicar');

(async () => {
    // ── La planilla ─────────────────────────────────────────────────────────
    let filasSheets = [];
    try {
        const { getSheet, pestaña } = require('./sheets');
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) throw new Error('no se encontró la pestaña EVENTOS');
        const rows = await sheet.getRows();
        filasSheets = rows.map(r => ({
            id_evento: r.get('id_evento') || '',
            estado: r.get('estado') || '',
            edificio: r.get('edificio') || '',
            tecnico: r.get('tecnico') || '',
        })).filter(f => f.id_evento);
    } catch (e) {
        console.error(`\n⚠️  No se pudo leer Google Sheets: ${e.message}\n`);
        process.exit(1);
    }

    // ── PostgreSQL ──────────────────────────────────────────────────────────
    let filasPg = [];
    let pool;
    try {
        const pg = require('./db-pg');
        pool = pg.pool;
        if (typeof pg.initPgSchema === 'function') await pg.initPgSchema().catch(() => {});
        const { rows } = await pool.query(
            `SELECT codigo_caso, estado, edificio, tecnico FROM reportes WHERE codigo_caso IS NOT NULL`
        );
        filasPg = rows;
    } catch (e) {
        console.error(`\n⚠️  No se pudo leer PostgreSQL: ${e.message}`);
        console.error('   Si dice "password authentication failed", acordate de que el pool lee la');
        console.error('   contraseña UNA sola vez al arrancar: cambiar el .env no sirve sin reiniciar.\n');
        process.exit(1);
    }

    const diferencias = compararCasos(filasSheets, filasPg);

    console.log(`\n🔀 CASOS DESFASADOS ENTRE LAS DOS BASES`);
    console.log('─'.repeat(74));
    console.log(`   En la planilla: ${filasSheets.length} · En PostgreSQL: ${filasPg.length}`);

    if (!diferencias.length) {
        console.log('\n   ✅ Las dos bases dicen lo mismo de todos los casos.\n');
        await pool.end().catch(() => {});
        process.exit(0);
    }

    const aCerrar = diferencias.filter(d => d.accion === 'cerrar_en_pg');
    const aRevisar = diferencias.filter(d => d.accion !== 'cerrar_en_pg');

    if (aCerrar.length) {
        console.log(`\n── SE PUEDEN EMPAREJAR SOLOS (${aCerrar.length}) ──`);
        for (const d of aCerrar) {
            const ed = d.enSheets?.edificio || d.enPg?.edificio || 'sin edificio';
            console.log(`\n   ${d.caso}  —  ${ed}`);
            console.log(`      ${d.motivo}`);
        }
    }

    if (aRevisar.length) {
        console.log(`\n── LOS DECIDE UNA PERSONA (${aRevisar.length}) ──`);
        for (const d of aRevisar) {
            const ed = d.enSheets?.edificio || d.enPg?.edificio || 'sin edificio';
            console.log(`\n   ${d.caso}  —  ${ed}`);
            console.log(`      ${d.motivo}`);
        }
    }

    if (!aplicar) {
        console.log(`\n${'─'.repeat(74)}`);
        if (aCerrar.length) {
            console.log(`   Nada se tocó. Para cerrar en PostgreSQL esos ${aCerrar.length}:`);
            console.log(`      node emparejar-casos.js --aplicar`);
        } else {
            console.log(`   Nada que se pueda emparejar solo.`);
        }
        console.log('');
        await pool.end().catch(() => {});
        process.exit(0);
    }

    // ── Aplicar: SOLO cerrar ────────────────────────────────────────────────
    console.log(`\n── APLICANDO ──`);
    let hechos = 0, fallidos = 0;
    for (const d of aCerrar) {
        try {
            // El estado que se copia es el de la planilla, no un `'resuelto'` fijo: si allá dice
            // `cerrado`, acá tiene que decir `cerrado`. Escribir otra palabra sería crear una
            // tercera versión de la verdad.
            const estado = String(d.enSheets.estado || '').trim();
            const r = await pool.query(
                `UPDATE reportes SET estado = $2 WHERE codigo_caso = $1`,
                [d.caso, estado]
            );
            if (r.rowCount > 0) { hechos++; console.log(`   ✅ ${d.caso} → "${estado}" en PostgreSQL`); }
            else { fallidos++; console.log(`   ⚠️  ${d.caso}: no se actualizó ninguna fila`); }
        } catch (e) {
            fallidos++;
            console.log(`   ❌ ${d.caso}: ${e.message}`);
        }
    }

    console.log(`\n${'─'.repeat(74)}`);
    console.log(`   ${hechos} emparejado(s), ${fallidos} con problema.`);
    if (aRevisar.length) {
        console.log(`   Quedan ${aRevisar.length} para mirar a mano: no se tocan desde acá a propósito.`);
    }
    console.log(`   Después: pm2 restart marcos-ai\n`);

    await pool.end().catch(() => {});
    process.exit(fallidos ? 1 : 0);
})().catch(e => {
    console.error('\n💥', e.message, '\n');
    process.exit(1);
});
