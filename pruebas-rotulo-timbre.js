// Verifica que el rótulo del timbre que el vecino guarda llegue al tótem de la portería.
//
//   node pruebas-rotulo-timbre.js
//   DATABASE_URL_PRUEBAS=postgres://... node pruebas-rotulo-timbre.js   (la parte que importa)
//
// > [!CAUTION]
// > **`actualizarConfigTimbre` copiaba `nombre_timbre` a `vecinos` con `OR LOWER(unidad) = ...`, y
// > `vecinos` NO tiene columna `unidad`.** PostgreSQL rechaza el statement entero, y el `catch (_) {}`
// > se lo tragaba: el vecino veía su rótulo guardado y el tótem seguía mostrando su nombre.
// > Un candado de texto no lo ve --la sintaxis es válida--, así que la parte de comportamiento
// > corre contra una base de verdad.

const fs = require('fs');
const path = require('path');

let fallos = 0;
function afirmar(titulo, ok) {
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
}
function terminar() {
    console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo bien');
    process.exit(fallos ? 1 : 0);
}

// El código sin comentarios: el comentario que explica esto nombra `unidad` y no es la función.
const sinComentarios = (t) => t.split('\n').filter(l => !/^\s*(\/\/|--|\*)/.test(l)).join('\n');
const dbpg = sinComentarios(fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8'));

console.log('\n── LO QUE SE ESCRIBE (candados) ──');
const ini = dbpg.indexOf('async function actualizarConfigTimbre');
const fin = dbpg.indexOf('async function obtenerIntegrantesUnidad', ini);
const funcion = dbpg.slice(ini, fin);
afirmar('se encontró actualizarConfigTimbre', ini !== -1 && fin > ini);
const upd = (funcion.match(/UPDATE vecinos[\s\S]*?\]\s*\)/) || [''])[0];
afirmar('se encontró el UPDATE a vecinos', upd.length > 0);
afirmar('no filtra por una columna `unidad` que vecinos no tiene', !/\bunidad\b/i.test(upd));
afirmar('el error de ese UPDATE ya no se calla', !/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(funcion));

console.log('\n── CONTRA POSTGRESQL DE VERDAD ──');
const url = process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL;
if (!url) {
    console.log('⚠️  La parte que importa NO se comprobó: necesita un PostgreSQL y no hay ninguno.');
    console.log('   Para correrla:  DATABASE_URL_PRUEBAS=postgres://... node pruebas-rotulo-timbre.js');
    return terminar();
}
process.env.DATABASE_URL = url;

(async () => {
    const db = require('./db-pg');
    const { pool } = db;
    const sufijo = Date.now();
    const edificio = 'Prueba Rotulo ' + sufijo;
    const otro = 'Prueba Rotulo Otro ' + sufijo;
    try {
        await new Promise(r => setTimeout(r, 4000)); // el esquema no bloquea el arranque
        const email = `rotulo${sufijo}@prueba.test`;
        const u = (await pool.query(
            `INSERT INTO usuarios (email, nombre, apellido) VALUES ($1,'Rotulo','Prueba') RETURNING id`, [email])).rows[0];
        await pool.query(
            `INSERT INTO usuario_unidades (usuario_id, edificio, departamento, rol, estado) VALUES ($1,$2,'1A','propietario','activo')`,
            [u.id, edificio]);
        await pool.query(`INSERT INTO vecinos (telefono, nombre, edificio, departamento) VALUES ('5491100000001','Nombre Real',$1,'1A')`, [edificio]);
        await pool.query(`INSERT INTO vecinos (telefono, nombre, edificio, departamento) VALUES ('5491100000002','Vecino de al lado',$1,'1B')`, [edificio]);
        await pool.query(`INSERT INTO vecinos (telefono, nombre, edificio, departamento) VALUES ('5491100000003','Otro consorcio',$1,'1A')`, [otro]);

        await db.actualizarConfigTimbre(u.id, edificio.toUpperCase(), '1a', { timbre_activo: true, nombre_timbre: 'Oficina Portas' });

        const rot = async (ed, dto) => (await pool.query(
            `SELECT nombre_timbre FROM vecinos WHERE edificio=$1 AND departamento=$2`, [ed, dto])).rows[0].nombre_timbre;
        afirmar('el rótulo llega a la fila del vecino en vecinos', (await rot(edificio, '1A')) === 'Oficina Portas');
        afirmar('no le cambia el rótulo a otra unidad del mismo edificio', (await rot(edificio, '1B')) === null);
        afirmar('ni a la misma unidad de otro edificio', (await rot(otro, '1A')) === null);

        // El huesped turista esta de paso: su pedido NO le pisa el rotulo a la unidad.
        const t = (await pool.query(
            `INSERT INTO usuarios (email, nombre, apellido) VALUES ($1,'Turista','Prueba') RETURNING id`,
            [`rotulo-t${sufijo}@prueba.test`])).rows[0];
        await pool.query(
            `INSERT INTO usuario_unidades (usuario_id, edificio, departamento, rol, estado) VALUES ($1,$2,'1A','turista','activo')`,
            [t.id, edificio]);
        await db.actualizarConfigTimbre(t.id, edificio, '1A', { timbre_activo: true, nombre_timbre: 'Pisado por turista' });
        afirmar('un huesped turista NO cambia el rotulo de la unidad', (await rot(edificio, '1A')) === 'Oficina Portas');
        const propio = (await pool.query(
            `SELECT nombre_timbre FROM usuario_unidades WHERE usuario_id=$1`, [t.id])).rows[0].nombre_timbre;
        afirmar('ni se lo guarda en su propia asignacion', propio === null);

        // Y el inquilino, que vive ahi, si puede cambiarlo.
        const inq = (await pool.query(
            `INSERT INTO usuarios (email, nombre, apellido) VALUES ($1,'Inquilino','Prueba') RETURNING id`,
            [`rotulo-i${sufijo}@prueba.test`])).rows[0];
        await pool.query(
            `INSERT INTO usuario_unidades (usuario_id, edificio, departamento, rol, estado) VALUES ($1,$2,'1A','inquilino','activo')`,
            [inq.id, edificio]);
        await db.actualizarConfigTimbre(inq.id, edificio, '1A', { timbre_activo: true, nombre_timbre: 'Estudio Gomez' });
        afirmar('un inquilino SI puede cambiar el rotulo', (await rot(edificio, '1A')) === 'Estudio Gomez');
    } catch (e) {
        afirmar('la prueba corrió sin error: ' + e.message, false);
    } finally {
        try {
            await pool.query(`DELETE FROM vecinos WHERE edificio IN ($1,$2)`, [edificio, otro]);
            await pool.query(`DELETE FROM usuario_unidades WHERE edificio = $1`, [edificio]);
            await pool.query(`DELETE FROM usuarios WHERE email LIKE 'rotulo%@prueba.test'`);
        } catch (_) { /* limpieza */ }
    }
    terminar();
})();
