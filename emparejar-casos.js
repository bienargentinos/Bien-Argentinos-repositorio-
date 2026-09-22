// CASOS QUE DICEN COSAS DISTINTAS EN CADA BASE
//
//   node emparejar-casos.js                              solo muestra, no toca nada
//   node emparejar-casos.js --aplicar                    cierra en PostgreSQL los que la planilla
//                                                        ya dio por cerrados
//   node emparejar-casos.js --aplicar --tambien-estados  además copia los estados que difieren sin
//                                                        que ninguno esté cerrado
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
// `--aplicar` **nunca reabre un caso**, con ninguna bandera. Ver el porqué en
// `casos-desfasados.js`, donde está `loQueSePuedeAplicar` — el único lugar que decide qué se toca.
//
// `--tambien-estados` sirve justamente para limpiar lo que dejó una caída: copia la planilla a
// PostgreSQL cuando los dos estados difieren y ninguno está cerrado. Esa dirección vale porque en
// una caída es PostgreSQL el que perdió escrituras; **no es una ley general**, y por eso hay que
// pedirla a mano en vez de que pase sola.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { compararCasos, loQueSePuedeAplicar } = require('./casos-desfasados');

const aplicar = process.argv.includes('--aplicar');
const tambienEstados = process.argv.includes('--tambien-estados');

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

    // La única fuente de qué se toca. No se filtra por acción acá adentro: se le pregunta.
    const aAplicar = loQueSePuedeAplicar(diferencias, { tambienEstados });
    const enAplicar = new Set(aAplicar.map(d => d.caso));
    const aMano = diferencias.filter(d => !enAplicar.has(d.caso));

    const contar = (accion) => diferencias.filter(d => d.accion === accion).length;

    if (aAplicar.length) {
        console.log(`\n── SE PUEDEN EMPAREJAR SOLOS (${aAplicar.length}) ──`);
        for (const d of aAplicar) {
            const ed = d.enSheets?.edificio || d.enPg?.edificio || 'sin edificio';
            console.log(`\n   ${d.caso}  —  ${ed}`);
            console.log(`      ${d.motivo}`);
        }
    }

    if (aMano.length) {
        console.log(`\n── LOS DECIDE UNA PERSONA (${aMano.length}) ──`);
        for (const d of aMano) {
            const ed = d.enSheets?.edificio || d.enPg?.edificio || 'sin edificio';
            console.log(`\n   ${d.caso}  —  ${ed}`);
            console.log(`      ${d.motivo}`);
        }
        // Si lo único que falta es la bandera, se dice: un informe que no explica cómo seguir
        // obliga a rehacer el razonamiento cada vez.
        if (!tambienEstados && contar('sincronizar_estado')) {
            console.log(`\n   ${contar('sincronizar_estado')} de esos difieren en un estado donde NINGUNO está cerrado.`);
            console.log(`   Se pueden copiar de la planilla a PostgreSQL con:  --tambien-estados`);
            console.log(`   Esa dirección vale cuando PostgreSQL perdió escrituras (una caída), no siempre.`);
        }
    }

    if (!aplicar) {
        console.log(`\n${'─'.repeat(74)}`);
        if (aAplicar.length) {
            console.log(`   Nada se tocó. Para emparejar esos ${aAplicar.length} en PostgreSQL:`);
            console.log(`      node emparejar-casos.js --aplicar${tambienEstados ? ' --tambien-estados' : ''}`);
        } else {
            console.log(`   Nada que se pueda emparejar solo.`);
        }
        console.log('');
        await pool.end().catch(() => {});
        process.exit(0);
    }

    // ── Aplicar ─────────────────────────────────────────────────────────────
    //
    // Se recorre `aAplicar`, que salió de `loQueSePuedeAplicar`. Ese es el único lugar donde se
    // decide qué se toca, y el que garantiza que un caso que PostgreSQL da por cerrado NUNCA se
    // reabra, con ninguna bandera.
    console.log(`\n── APLICANDO ──`);
    let hechos = 0, fallidos = 0;
    for (const d of aAplicar) {
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
    if (aMano.length) {
        console.log(`   Quedan ${aMano.length} para mirar a mano: no se tocan desde acá a propósito.`);
    }
    console.log(`   Después: pm2 restart marcos-ai\n`);

    await pool.end().catch(() => {});
    process.exit(fallidos ? 1 : 0);
})().catch(e => {
    console.error('\n💥', e.message, '\n');
    process.exit(1);
});
