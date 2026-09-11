// QUIÉN ES DUEÑO DE CADA TABLA, Y SI MARCOS PUEDE ESCRIBIRLA
//
//   node revisar-permisos-pg.js
//
// Solo lee. No crea, no borra y no cambia ningún permiso.
//
// POR QUÉ. En el log de producción, durante la prueba del timbre:
//
//     ⚠️ No se pudo persistir toque en tabla timbres: permission denied for table timbres
//
// La tabla EXISTE --por eso no dice "does not exist"-- pero la creó otro rol. `CREATE TABLE IF NOT
// EXISTS` de `db-pg.js` no da error en ese caso: ve que ya está y sigue de largo. Marcos arranca
// normal, el esquema "se aplica", y recién al INSERT aparece el problema.
//
// > [!CAUTION]
// > **Esto NO se puede arreglar desde el código.** Cambiar el dueño de una tabla exige ser su
// > dueño o superusuario, y Marcos se conecta como `marcos`. El `ALTER TABLE ... OWNER TO` lo
// > tiene que correr una persona, una sola vez, como `postgres`.
//
// Ya se intentó a mano y no quedó (el error siguió apareciendo después). Este script dice si quedó
// o no, en vez de suponerlo.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { pool, initPgSchema } = require('./db-pg');

(async () => {
    try {
        // Mismo motivo que en `revisar-columnas-pg.js`: `require` dispara el esquema y hay que
        // esperarlo, o se lee la base a mitad de la aplicación.
        if (typeof initPgSchema === 'function') await initPgSchema();

        const yo = (await pool.query('SELECT current_user AS u')).rows[0].u;
        console.log(`\nMarcos se conecta como: ${yo}\n`);

        // `has_table_privilege` contesta lo que realmente importa: no "quién es el dueño" sino
        // "¿puedo escribir?". Un GRANT alcanza aunque el dueño sea otro.
        const r = await pool.query(`
            SELECT c.relname AS tabla,
                   pg_get_userbyid(c.relowner) AS dueno,
                   has_table_privilege(current_user, c.oid, 'INSERT') AS puede_insertar,
                   has_table_privilege(current_user, c.oid, 'UPDATE') AS puede_actualizar,
                   has_table_privilege(current_user, c.oid, 'SELECT') AS puede_leer
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            ORDER BY c.relname
        `);

        const rotas = [];
        for (const t of r.rows) {
            const ok = t.puede_insertar && t.puede_actualizar && t.puede_leer;
            if (!ok) rotas.push(t);
            const falta = [
                !t.puede_leer && 'leer',
                !t.puede_insertar && 'insertar',
                !t.puede_actualizar && 'actualizar',
            ].filter(Boolean).join(', ');
            console.log(`${ok ? '✅' : '❌'} ${t.tabla.padEnd(26)} dueño: ${t.dueno}` +
                        (ok ? '' : `   — NO puede ${falta}`));
        }

        if (rotas.length === 0) {
            console.log(`\n✅ Marcos puede escribir todas las tablas.\n`);
            process.exit(0);
        }

        console.log(`\n❌ ${rotas.length} tabla(s) que Marcos NO puede escribir.`);
        console.log(`   El INSERT falla, queda una línea en el log y el dato se pierde en silencio.`);
        console.log(`   Se arregla una sola vez, en el servidor, como el usuario postgres:\n`);
        console.log(`   sudo -u postgres psql -d marcos_db -c "${
            rotas.map(t => `ALTER TABLE ${t.tabla} OWNER TO ${yo};`).join(' ')}"`);
        console.log(`\n   Después, volver a correr este script para confirmar que quedó.\n`);
        process.exit(1);
    } catch (err) {
        console.error(`\n❌ No se pudieron leer los permisos: ${err.message}\n`);
        process.exit(1);
    }
})();
