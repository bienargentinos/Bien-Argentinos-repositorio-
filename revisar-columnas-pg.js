// QUÉ COLUMNAS TIENE DE VERDAD CADA TABLA DE PostgreSQL
//
//   node revisar-columnas-pg.js              todas las tablas
//   node revisar-columnas-pg.js facturas     una sola
//
// Solo lee. No crea ni borra nada.
//
// POR QUÉ. En el log de producción aparecieron, el mismo día:
//
//     [PG] No se pudo copiar la factura: column "id_evento" of relation "facturas" does not exist
//     Registro comprobante PG: column "url" of relation "facturas" does not exist
//     Carga reservas amenities: column "cbu" does not exist
//     [PG] ... violates check constraint "facturas_estado_chk"
//
// Tres columnas que el código escribe y la base no tiene, más una restricción que **no está en
// `db-pg.js`** — o sea que alguien la creó a mano en el servidor. Eso rompe la regla de oro del
// repo (GitHub es la única fuente de verdad) y deja el esquema real distinto del que dice el
// código.
//
// `psql` directo no sirve acá: el usuario `root` del sistema no existe como rol de PostgreSQL.
// Este script usa la MISMA conexión que Marcos (`DATABASE_URL` del `.env`), así que ve exactamente
// lo que ve él.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { pool, initPgSchema } = require('./db-pg');

const soloEsta = (process.argv[2] || '').trim().toLowerCase();

(async () => {
    try {
        // > [!CAUTION]
        // > **Hay que ESPERAR a que el esquema termine de aplicarse antes de leerlo.**
        //
        // `require('./db-pg')` dispara `initPgSchema()` al cargarse, y esa función redefine las
        // restricciones con `DROP` + `ADD`. Sin este `await`, la consulta llegaba en el medio: las
        // constraints aparecían con la definición en `null` --el instante exacto en que estaban
        // borradas y todavía no recreadas-- y el informe decía que faltaban cuando estaban bien.
        //
        // Un verificador que informa mal es peor que no tener verificador: manda a arreglar algo
        // que no está roto.
        if (typeof initPgSchema === 'function') await initPgSchema();
        const tablas = await pool.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        for (const { table_name } of tablas.rows) {
            if (soloEsta && table_name.toLowerCase() !== soloEsta) continue;

            const cols = await pool.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position
            `, [table_name]);

            console.log(`\n📋 ${table_name}  (${cols.rowCount} columnas)`);
            console.log('   ' + cols.rows.map(c => c.column_name).join(', '));

            // Las restricciones CHECK son las que rechazan una fila entera sin decir cuál es el
            // valor permitido. Si una no está en `db-pg.js`, la creó alguien a mano.
            const checks = await pool.query(`
                SELECT con.conname, pg_get_constraintdef(con.oid) AS definicion
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                WHERE ns.nspname = 'public' AND rel.relname = $1 AND con.contype = 'c'
                ORDER BY con.conname
            `, [table_name]);

            for (const c of checks.rows) {
                console.log(`   🔒 ${c.conname}: ${c.definicion}`);
            }
        }

        if (soloEsta && !tablas.rows.some(t => t.table_name.toLowerCase() === soloEsta)) {
            console.log(`\n❌ No existe ninguna tabla llamada "${soloEsta}".`);
        }

        console.log('\nSi una columna que el código escribe no está en esta lista, el `ALTER TABLE`');
        console.log('de `db-pg.js` no llegó a aplicarse. Y una 🔒 que no esté en `db-pg.js` la creó');
        console.log('alguien a mano en el servidor: hay que llevarla al repo o sacarla.\n');
        process.exit(0);
    } catch (err) {
        console.error(`\n❌ No se pudo leer el esquema: ${err.message}\n`);
        process.exit(1);
    }
})();
