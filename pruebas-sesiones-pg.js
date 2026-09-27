/**
 * LAS DOS TABLAS DE SESION, CONTRA UN PostgreSQL DE VERDAD.
 *
 * Por que existe aparte del candado de `pruebas-pool-pg.js`: ese lee el CODIGO --que la llamada
 * este antes del store, que `createTableIfMissing` sea false--. Mide la forma. Esta corre el SQL.
 *
 * La diferencia no es teorica. El 27/09 el arreglo del `session_pkey` se escribio, se verifico con
 * 78 pruebas en verde, se desplegó... y el panel siguió roto. Los candados de texto no podian verlo
 * porque el codigo estaba bien; lo unico que lo demuestra es levantar un PostgreSQL y mirar que
 * pasa. Se hizo a mano y recien ahi se supo que el arreglo servia.
 *
 * Necesita una base. Sin ella NO falla --no se puede exigir PostgreSQL antes de cada push-- pero lo
 * dice fuerte: una prueba que se saltea en silencio es una prueba que no existe.
 *
 *   DATABASE_URL_PRUEBAS=postgres://... node pruebas-sesiones-pg.js
 *
 * OJO: usa tablas propias (`pruebas_ses_*`) y las borra. Nunca toca `sesiones_panel` ni
 * `sesiones_portal`, que en el VPS son las sesiones vivas de gente logueada.
 */
const session = require('express-session');

let fallos = 0;
const afirmar = (titulo, cond) => {
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
    if (!cond) fallos++;
};

const url = process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL;
if (!url) {
    console.log('\n⚠️  SALTEADA: esta prueba necesita un PostgreSQL y no hay ninguno configurado.');
    console.log('   Es la UNICA que comprueba de verdad que las dos tablas de sesion no chocan;');
    console.log('   las otras leen el codigo, y el codigo ya estaba bien el dia que fallo.');
    console.log('   Para correrla:  DATABASE_URL_PRUEBAS=postgres://... node pruebas-sesiones-pg.js\n');
    process.exit(0);
}

const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const pool = new Pool({ connectionString: url });

const A = 'pruebas_ses_a';
const B = 'pruebas_ses_b';
const store = (t, crear) => new PgSession({ pool, tableName: t, createTableIfMissing: crear, pruneSessionInterval: false });
const leer = (s) => new Promise(r => s.get('nada', (e) => r(e ? e.message : 'ok')));

// La MISMA forma que `asegurarTablasDeSesion` de db-pg.js. Si aquella cambia, esta prueba deja de
// medirla -- por eso el candado de abajo compara las dos.
async function crearComoNosotros(tabla) {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${tabla} (
        sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabla}_expire ON ${tabla} (expire)`);
}

const limpiar = () => pool.query(`DROP TABLE IF EXISTS ${A}, ${B}`);

async function main() {
    console.log('\n── EL CHOQUE EXISTE: no es una teoria sobre la libreria ──');
    await limpiar();
    {
        // Dos stores, DOS TABLAS DISTINTAS, los dos dejando crear a la libreria.
        await leer(store(A, true));
        const err = await leer(store(B, true));
        afirmar('el segundo store choca con session_pkey', /session_pkey/.test(err));

        // Y lo que mas duele: la tabla del segundo NO queda creada. El CREATE y el ALTER van en una
        // transaccion, asi que el choque revierte la tabla entera.
        const hay = await pool.query('SELECT to_regclass($1) AS t', [B]);
        afirmar('y el segundo se queda SIN TABLA', hay.rows[0].t === null);

        // La libreria cachea su promesa: no se cura sola en el pedido siguiente.
        const s = store(B, true);
        await leer(s);
        afirmar('no se recupera en el pedido siguiente', /session_pkey/.test(await leer(s)));
    }

    console.log('\n── CREANDOLAS NOSOTROS, NO CHOCA NI CON createTableIfMissing:true ──');
    await limpiar();
    {
        await crearComoNosotros(A);
        await crearComoNosotros(B);
        afirmar('el primero anda', (await leer(store(A, false))) === 'ok');
        // Este es el que importa para el PANEL: anda sin tocarle una linea, porque la libreria ve
        // que la tabla existe y no intenta crear nada.
        afirmar('y el segundo anda aunque deje crear a la libreria', (await leer(store(B, true))) === 'ok');
    }

    console.log('\n── Y SOBRE EL ESTADO REAL DE PRODUCCION (uno ya creado por la libreria) ──');
    await limpiar();
    {
        await leer(store(A, true));               // como quedo el VPS: A tiene session_pkey
        let ok = true;
        try { await crearComoNosotros(A); await crearComoNosotros(B); }
        catch (e) { ok = false; console.log('     el CREATE fallo:', e.message); }
        afirmar('el arreglo se puede aplicar sobre lo que ya hay', ok);
        afirmar('y el que estaba roto queda andando', (await leer(store(B, true))) === 'ok');
    }

    console.log('\n── UNA SESION SE GUARDA Y SE LEE ──');
    {
        const s = store(B, false);
        await new Promise(r => s.set('sid-1', { cookie: { maxAge: 60000 }, quien: 'vecino' }, r));
        const v = await new Promise(r => s.get('sid-1', (e, val) => r(e ? null : val)));
        afirmar('vuelve lo que se guardo', !!v && v.quien === 'vecino');
    }

    console.log('\n── CANDADO: la prueba mide LO MISMO que corre en produccion ──');
    {
        // Si `asegurarTablasDeSesion` cambia y esta prueba no, se estaria midiendo otra cosa.
        const fs = require('fs');
        const DB = fs.readFileSync(require('path').join(__dirname, 'db-pg.js'), 'utf8');
        const m = DB.match(/async function asegurarTablasDeSesion[\s\S]*?\n}/);
        const normalizar = (s) => String(s).replace(/\s+/g, ' ').toLowerCase();
        const real = normalizar((m && m[0]) || '');
        afirmar('sigue creando con la clave primaria en linea',
            /sid varchar not null collate "default" primary key/.test(real));
        afirmar('y el indice con nombre propio por tabla', /idx_\$\{tabla\}_expire/.test(m ? m[0] : ''));
    }

    await limpiar();
    await pool.end();
    console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
    console.log(`\n❌ La prueba misma se cayo: ${e && e.message}\n`);
    await pool.end().catch(() => {});
    process.exit(1);
});
