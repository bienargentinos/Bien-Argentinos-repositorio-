#!/usr/bin/env node
// LAS FILAS QUE UN RENOMBRE NO PUDO TOCAR PORQUE SU GEMELA YA EXISTE
//
//   node quitar-duplicados.js proveedor_asignaciones edificio "nombre viejo" "nombre bueno"
//   node quitar-duplicados.js proveedor_asignaciones edificio "nombre viejo" "nombre bueno" --aplicar
//
// Por defecto NO borra nada: muestra cada fila al lado de su gemela y dice qué haría.
//
// PARA QUÉ SIRVE. `renombrar-edificio.js` y `renombrar-proveedor.js` renombran fila por fila y, si
// una quedaría repetida con otra que ya existe, **se plantan y avisan** en vez de forzarla:
//
//     ⚠️ proveedor_asignaciones.edificio: esta fila quedaría repetida con otra que ya dice
//        "san patricio casa". Se dejó como estaba.
//
// Eso está bien --borrar una de las dos es una decisión, no un efecto secundario de corregir un
// nombre-- pero deja la fila vieja ahí, apuntando a un edificio que no existe. Esta herramienta
// cierra ese paso.
//
// ── LO QUE NO HACE, A PROPÓSITO ──────────────────────────────────────────────────────────────
//
// > [!CAUTION]
// > **Solo borra una fila si su gemela ya existe Y dice exactamente lo mismo en todo lo demás.**
//
// Si la fila vieja tiene algo que la nueva no tiene --otra prioridad, otro teléfono, otro estado--
// NO se borra: se muestra la diferencia y se deja quieta. Perder ese dato sería peor que tener una
// fila de más, y decidirlo es de quien conoce el edificio, no de un script.
//
// Tampoco borra la última fila de un grupo: si la gemela no está, no hay duplicado que sacar --hay
// un renombre pendiente, y eso lo hace `renombrar-edificio.js`.
//
// Esto es **configuración**, no dato de prueba. `reset-test.js` no la toca y esta herramienta
// tampoco corre sola: hay que pedírselo, y con --aplicar.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const norm = (t) => String(t || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase().trim();

// Columnas que no cuentan para decidir si dos filas dicen lo mismo: las pone la base, no la persona.
const IGNORAR = new Set(['id', 'ctid', 'created_at', 'updated_at']);

const tabla = process.argv[2];
const columna = process.argv[3];
const viejo = process.argv[4];
const nuevo = process.argv[5];
const aplicar = process.argv.includes('--aplicar');

if (!tabla || !columna || !viejo || !nuevo) {
    console.error(
        'Uso:\n' +
        '  node quitar-duplicados.js <tabla> <columna> "valor viejo" "valor bueno" [--aplicar]\n\n' +
        'Ejemplo:\n' +
        '  node quitar-duplicados.js proveedor_asignaciones edificio "consorcio propietario san patricio 159" "san patricio casa"'
    );
    process.exit(1);
}

if (norm(viejo) === norm(nuevo)) {
    console.error('Los dos valores son el mismo. No hay nada que comparar.');
    process.exit(1);
}

(async () => {
    let pool = null;
    let borradas = 0, conservadas = 0, sinGemela = 0;

    try {
        ({ pool } = require('./db-pg'));

        const { rows: cols } = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
        `, [tabla]);

        if (!cols.length) {
            console.error(`\n❌ No existe ninguna tabla llamada "${tabla}".\n`);
            process.exit(1);
        }

        const nombres = cols.map(c => c.column_name);
        if (!nombres.includes(columna)) {
            console.error(`\n❌ "${tabla}" no tiene una columna "${columna}".`);
            console.error(`   Tiene: ${nombres.join(', ')}\n`);
            process.exit(1);
        }

        // Las que se comparan para decidir si dos filas dicen lo mismo: todas menos la que se
        // renombra (que por definición difiere) y las que pone la base.
        const comparables = nombres.filter(c => c !== columna && !IGNORAR.has(c));

        const lista = c => c.map(x => `"${x}"`).join(', ');
        const viejas = await pool.query(
            `SELECT ctid, ${lista(nombres)} FROM "${tabla}"
             WHERE lower(trim(coalesce("${columna}"::text,''))) = lower(trim($1))`,
            [viejo]
        );
        const gemelas = await pool.query(
            `SELECT ctid, ${lista(nombres)} FROM "${tabla}"
             WHERE lower(trim(coalesce("${columna}"::text,''))) = lower(trim($1))`,
            [nuevo]
        );

        console.log(`\n📋 "${tabla}" · ${viejas.rowCount} fila(s) con "${viejo}" · ${gemelas.rowCount} con "${nuevo}"\n`);

        if (!viejas.rowCount) {
            console.log(`✅ No quedó ninguna fila con "${viejo}". No hay nada que hacer.\n`);
            try { await pool.end(); } catch {}
            process.exit(0);
        }

        const resumen = (fila) => comparables
            .map(c => `${c}=${fila[c] ?? ''}`)
            .filter(t => !t.endsWith('='))
            .join(' · ');

        for (const vieja of viejas.rows) {
            // Su gemela: la que dice lo mismo en TODO lo demás.
            const gemela = gemelas.rows.find(g =>
                comparables.every(c => norm(g[c]) === norm(vieja[c])));

            if (gemela) {
                console.log(`   🗑️  ${resumen(vieja)}`);
                console.log(`       su gemela con "${nuevo}" ya existe y dice exactamente lo mismo.`);
                if (aplicar) {
                    await pool.query(`DELETE FROM "${tabla}" WHERE ctid = $1`, [vieja.ctid]);
                    console.log(`       ✏️ borrada.`);
                }
                borradas++;
                continue;
            }

            // Hay filas con el nombre bueno, pero ninguna dice lo mismo: esta trae algo propio.
            const parecida = gemelas.rows.find(g =>
                comparables.some(c => norm(g[c]) === norm(vieja[c]) && String(vieja[c] ?? '').trim()));

            if (parecida) {
                const difieren = comparables.filter(c => norm(parecida[c]) !== norm(vieja[c]));
                console.log(`   ⚠️  ${resumen(vieja)}`);
                console.log(`       NO se borra: la más parecida con "${nuevo}" difiere en ${difieren.join(', ')}.`);
                for (const c of difieren) {
                    console.log(`         ${c}:  "${vieja[c] ?? ''}"   vs   "${parecida[c] ?? ''}"`);
                }
                console.log(`       Decidilo mirándolo: si el dato de esta fila importa, hay que pasarlo a la otra.`);
                conservadas++;
                continue;
            }

            console.log(`   ↔️  ${resumen(vieja)}`);
            console.log(`       No tiene gemela con "${nuevo}". No es un duplicado: es un renombre pendiente.`);
            console.log(`       node renombrar-edificio.js "${viejo}" "${nuevo}" --aplicar`);
            sinGemela++;
        }
    } catch (e) {
        console.error(`\n❌ No se pudo trabajar sobre PostgreSQL: ${e.message}\n`);
        process.exit(1);
    }

    console.log('');
    if (aplicar) {
        console.log(`${conservadas || sinGemela ? '🟠' : '✅'} ${borradas} fila(s) borradas por duplicadas.`);
    } else {
        console.log(`📋 ${borradas} fila(s) se borrarían. NO se borró nada.`);
        if (borradas) {
            console.log(`   Para hacerlo de verdad:`);
            console.log(`   node quitar-duplicados.js ${tabla} ${columna} "${viejo}" "${nuevo}" --aplicar`);
        }
    }
    if (conservadas) console.log(`⚠️ ${conservadas} fila(s) se conservan: traen datos que la otra no tiene.`);
    if (sinGemela) console.log(`↔️ ${sinGemela} fila(s) no son duplicados, son renombres pendientes.`);
    console.log(`\n   Verificá con:  node revisar-edificios.js\n`);

    try { if (pool) await pool.end(); } catch {}
    process.exit(0);
})();
