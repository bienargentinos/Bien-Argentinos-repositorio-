/**
 * QUIÉN AUTORIZÓ EL INGRESO
 *
 * Pedido de Daniel, 28/09: *"el pase qr creado por un vecino debe tener una firma del vecino que lo
 * creó o algo que nos ayude a saber quién dio acceso, así si hay eventos perjudiciales se sepa quién
 * fue y el AC pueda tomar acciones legales"*.
 *
 * El dato ya se guardaba en `pases_qr`. Lo que faltaba era todo lo que lo hace útil:
 *
 *   1. **Nadie lo mostraba.** Ni la página del pase ni el portal. Para verlo había que entrar con
 *      `psql`, y un administrador que quiere tomar acciones no va a hacer eso.
 *   2. **La columna legible del registro de accesos nombraba al invitado y no a quien lo dejó
 *      entrar**, que es la primera pregunta cuando pasa algo. El autor estaba enterrado adentro de
 *      un JSON, donde no se puede filtrar ni ordenar.
 *   3. **Un pase emitido desde la sesión de demostración quedaba firmado con un nombre que parece
 *      de una persona real** (hoy "Camila"). Para un rastro legal eso es peor que no tener ninguno,
 *      porque parece una respuesta.
 *
 * La parte contra un PostgreSQL de VERDAD es la que importa: que al consumir el QR quede una fila
 * en `eventos_acceso` con el autor en su propia columna. Eso no se puede medir leyendo el código.
 */
const fs = require('fs');

let fallos = 0;
const afirmar = (titulo, cond) => {
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
    if (!cond) fallos++;
};

// Sin los comentarios: este archivo y los que revisa explican el problema nombrando las mismas
// cosas que el candado busca, y medir el comentario en lugar del código ya salió mal dos veces acá.
function soloCodigo(archivo) {
    return fs.readFileSync(archivo, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

async function main() {
    console.log('\n✍️  QUIÉN AUTORIZÓ EL INGRESO\n');

    const { nombreDelAutor, describirAutor, datosDeAutoria, esAutorDePrueba, MARCA_PRUEBA } = require('./autor-del-pase');

    // ── 1. La firma ───────────────────────────────────────────────────────────────
    console.log('Con qué nombre se firma un pase:');
    afirmar('un vecino real se firma con su nombre y apellido',
        nombreDelAutor({ nombre: 'Daniel', apellido: 'Valdés' }) === 'Daniel Valdés');
    afirmar('la sesión de demostración queda MARCADA',
        esAutorDePrueba(nombreDelAutor({ nombre: 'Camila', demo: true })));
    afirmar('y un pase real NO queda marcado',
        !esAutorDePrueba(nombreDelAutor({ nombre: 'Daniel', apellido: 'Valdés' })));
    afirmar('sin nombre cargado se dice, no se deja vacío',
        nombreDelAutor({}).length > 0 && !esAutorDePrueba(nombreDelAutor({})));

    // ── 2. Cómo se le cuenta a una persona ────────────────────────────────────────
    console.log('\nLa frase que lee el portero o el administrador:');
    const real = describirAutor({ creado_por_nombre: 'Daniel Valdés', departamento: '1° A', created_at: '2026-09-28T17:03:00Z' });
    afirmar('nombra a quien autorizó', real.includes('Daniel Valdés'));
    afirmar('y su unidad', real.includes('1° A'));

    // Sin autor NO se inventa uno: un pase viejo o emitido por una vía que no lo anotaba no tiene a
    // quién señalar, y el administrador necesita saber que de ESE ingreso no hay a quién reclamarle.
    const sinAutor = describirAutor({});
    afirmar('sin autor lo dice en vez de inventar uno', /no consta/i.test(sinAutor));
    afirmar('y no nombra a nadie', !/autorizado por \w/i.test(sinAutor));

    const dePrueba = describirAutor({ creado_por_nombre: MARCA_PRUEBA + ' Camila' });
    afirmar('un pase de prueba se aclara como que NO es una autorización real',
        /prueba/i.test(dePrueba) && /no es una autorizaci/i.test(dePrueba));

    // ── 3. Lo que se copia al registro ────────────────────────────────────────────
    console.log('\nLo que se copia al registro de accesos:');
    const copia = datosDeAutoria({ id: 7, creado_por_nombre: 'Daniel Valdés', creado_por_usuario_id: 3, departamento: '4C', created_at: '2026-09-28T10:00:00Z' });
    afirmar('el nombre', copia.autorizado_por_nombre === 'Daniel Valdés');
    afirmar('el id del usuario', copia.autorizado_por_usuario_id === 3);
    afirmar('la unidad', copia.autorizado_por_unidad === '4C');
    afirmar('el id del pase', copia.pase_id === 7);
    afirmar('y cuándo se emitió', !!copia.pase_emitido_en);
    // Sin pase no se rellena con nada: un rechazo de un código inventado no tiene autor.
    const vacia = datosDeAutoria(null);
    afirmar('sin pase, todo queda en null y no se inventa nada',
        Object.values(vacia).every((v) => v === null));

    // ── 4. Candados ───────────────────────────────────────────────────────────────
    console.log('\nLos candados:');
    const portal = soloCodigo('portal-vecino.js');
    // Si alguien vuelve a firmar con el nombre crudo, la marca de la sesión de prueba desaparece y
    // un pase de demostración vuelve a parecer una autorización real.
    const firma = portal.match(/creado_por_nombre:\s*([^\n,]+)/);
    afirmar('el portal firma el pase con algo', !!firma);
    if (firma) {
        afirmar('y lo hace a través de nombreDelAutor (no con el nombre crudo)',
            /nombreDelAutor/.test(firma[1]));
    }
    afirmar('la lista de pases viaja con la frase de autoría ya armada por el servidor',
        /describirAutor/.test(portal) && /autoria/.test(portal));

    const porteria = soloCodigo('porteria.js');
    afirmar('el registro de accesos del QR lleva los datos de autoría',
        /registrarEventoAcceso\(Object\.assign\(/.test(porteria) && /datosDeAutoria\(/.test(porteria));
    afirmar('la página del pase muestra quién autorizó', /describirAutor\(pase\)/.test(porteria));

    const esquema = soloCodigo('db-pg.js');
    // El INSERT del registro de accesos, aislado: `esquema.includes(col)` daría verdadero por el
    // propio ALTER que la crea, así que mediría que la columna existe y no que se escriba.
    const insertAcceso = (esquema.match(/INSERT INTO eventos_acceso[\s\S]*?RETURNING \*/) || [''])[0];
    afirmar('se encontró el INSERT del registro de accesos', insertAcceso.length > 0);
    for (const col of ['autorizado_por_nombre', 'autorizado_por_usuario_id', 'pase_id', 'pase_emitido_en']) {
        afirmar(`eventos_acceso tiene la columna ${col}`,
            new RegExp('eventos_acceso ADD COLUMN IF NOT EXISTS ' + col).test(esquema));
        afirmar(`y el INSERT la escribe`, insertAcceso.includes(col));
    }

    // ── 5. Contra PostgreSQL de verdad ────────────────────────────────────────────
    const url = process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL;
    if (!url) {
        console.log('\n⚠️  La parte que importa NO se comprobó: necesita un PostgreSQL y no hay ninguno.');
        console.log('   Es la única que verifica que al consumir el QR quede la fila con el autor.');
        console.log('   Para correrla:  DATABASE_URL_PRUEBAS=postgres://... node pruebas-autor-del-pase.js');
        return terminar();
    }
    process.env.DATABASE_URL = url;

    console.log('\nAl consumir el QR (contra PostgreSQL de verdad):');
    const express = require('express');
    const http = require('http');
    const app = express();
    app.use(express.json());
    app.use('/porteria', require('./porteria'));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));
    const puerto = srv.address().port;

    const postear = (ruta, cuerpo) => new Promise((res) => {
        const datos = JSON.stringify(cuerpo);
        const r = http.request({
            host: '127.0.0.1', port: puerto, path: ruta, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) }
        }, (resp) => {
            const t = [];
            resp.on('data', (d) => t.push(d));
            resp.on('end', () => { try { res(JSON.parse(Buffer.concat(t).toString())); } catch (_) { res({}); } });
        });
        r.on('error', () => res({}));
        r.write(datos); r.end();
    });

    const { crearPaseQR, pool } = require('./db-pg');
    const EDIFICIO = 'San Patricio 159';
    const base = {
        origen: 'edifica', edificio: EDIFICIO, departamento: '1° A',
        motivo: 'prueba', tipo_pase: 'visita',
        valido_desde: new Date(Date.now() - 60e3),
        valido_hasta: new Date(Date.now() + 3600e3),
        usos_permitidos: 1
    };

    const tokenReal = 'PRUEBAAUT-REAL-' + Date.now();
    await crearPaseQR(Object.assign({}, base, {
        token: tokenReal,
        creado_por_usuario_id: 41,
        creado_por_nombre: 'Daniel Valdés',
        nombre_invitado: 'Plomero de prueba'
    }));

    await postear('/porteria/api/validar-qr', { token: tokenReal, edificio: EDIFICIO });

    const fila = (await pool.query(
        `SELECT * FROM eventos_acceso WHERE qr_id = $1 ORDER BY id DESC LIMIT 1`, [tokenReal]
    )).rows[0];

    afirmar('queda la fila del ingreso en el registro de accesos', !!fila);
    if (fila) {
        afirmar('con el nombre de quien lo autorizó, en su propia columna',
            fila.autorizado_por_nombre === 'Daniel Valdés');
        afirmar('con el id del vecino que lo emitió', Number(fila.autorizado_por_usuario_id) === 41);
        afirmar('con el id del pase, para poder volver a él', !!fila.pase_id);
        afirmar('con cuándo se emitió el pase', !!fila.pase_emitido_en);
        // La columna que una persona lee tiene que nombrarlo: antes decía solo el invitado.
        afirmar('y la columna legible también lo nombra', /Daniel Valdés/.test(String(fila.detalle || '')));
    }

    // Un intento RECHAZADO también tiene que quedar con su autor: un pase revocado que alguien
    // sigue intentando usar es justo el evento que el administrador quiere ver.
    const tokenRevocado = 'PRUEBAAUT-REV-' + Date.now();
    const paseRev = await crearPaseQR(Object.assign({}, base, {
        token: tokenRevocado,
        creado_por_usuario_id: 42,
        creado_por_nombre: 'Vecina que revocó',
        nombre_invitado: 'Alguien que ya no entra'
    }));
    await pool.query(`UPDATE pases_qr SET estado = 'revocado' WHERE id = $1`, [paseRev.id]);
    const rRev = await postear('/porteria/api/validar-qr', { token: tokenRevocado, edificio: EDIFICIO });
    afirmar('un pase revocado NO abre', rRev && rRev.valido === false);

    const filaRev = (await pool.query(
        `SELECT * FROM eventos_acceso WHERE qr_id = $1 ORDER BY id DESC LIMIT 1`, [tokenRevocado]
    )).rows[0];
    afirmar('el intento rechazado también queda registrado', !!filaRev);
    if (filaRev) {
        afirmar('y con quién lo había autorizado', filaRev.autorizado_por_nombre === 'Vecina que revocó');
    }

    await pool.query(`DELETE FROM eventos_acceso WHERE qr_id LIKE $1`, ['PRUEBAAUT-%']);
    await pool.query(`DELETE FROM pases_qr WHERE token LIKE $1`, ['PRUEBAAUT-%']);
    srv.close();
    await pool.end();
    terminar();
}

function terminar() {
    console.log(fallos === 0
        ? '\n✅ TODO EN ORDEN: de cada ingreso queda escrito quién lo autorizó.\n'
        : `\n❌ ${fallos} fallo(s).\n`);
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error('\n❌ La prueba se cayó:', e.message);
    process.exit(1);
});
