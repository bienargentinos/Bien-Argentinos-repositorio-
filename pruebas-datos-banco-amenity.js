/**
 * LOS DATOS PARA TRANSFERIR NO SE INVENTAN.
 *
 * En el VPS, en cada carga de la pantalla de Amenities:
 *
 *     Carga datos banco: relation "cuentas_bancarias" does not exist
 *
 * La tabla la leía `portal-vecino.js` y **ningún lado la creaba**. Pero el error de log era lo de
 * menos: lo que hacía el código cuando eso fallaba era esto, y ya estaba en producción:
 *
 *     datosBanco = {
 *       banco:   'Banco Oficial del Consorcio',
 *       titular: 'Consorcio ' + v.edificio,
 *       cbu:     'Consultar con Administración',
 *       alias:   v.edificio.toLowerCase().replace(/[^a-z0-9]/g,'') + '.expensas',
 *     };
 *
 * O sea: un banco que no existe, un titular que nadie verificó, y **un alias ARMADO con el nombre
 * del edificio** (`sanpatricio159.expensas`) — mostrado con un botón **"Copiar"** al lado, a un
 * vecino que estaba por transferir la seña del SUM. Toca copiar, pega en el homebanking y manda la
 * plata: o no existe, o es de otra persona. Y la pantalla se veía igual de confiable que con datos
 * reales.
 *
 * Es el mismo criterio que el repo ya aplica en todos lados y que acá faltaba: **sin el dato, se
 * dice que falta.** `describirAutor` no inventa un autor, el contacto de ingreso no inventa un
 * teléfono, y `momentoPrometido` no inventa una hora. Que el vecino tenga que preguntarle a la
 * Administración es molesto; que transfiera a un alias inventado no se puede deshacer.
 */
const fs = require('fs');

let fallos = 0;
const afirmar = (titulo, cond) => {
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
    if (!cond) fallos++;
};

// Sin los comentarios: este archivo y `portal-vecino.js` CITAN el código viejo para explicar por
// qué no va más, y un candado que confunda la cita con el código mide la explicación.
function soloCodigo(archivo) {
    return fs.readFileSync(archivo, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*|>)/.test(l))
        .join('\n');
}

console.log('\n🏦 LOS DATOS PARA TRANSFERIR NO SE INVENTAN\n');

const portal = soloCodigo('portal-vecino.js');
const esquema = soloCodigo('db-pg.js');

console.log('La tabla existe en el esquema:');
afirmar('db-pg.js crea cuentas_bancarias',
    /CREATE TABLE IF NOT EXISTS cuentas_bancarias/.test(esquema));
// Sin esto, el día que la Administración cargue la cuenta desde el panel --que escribe el NOMBRE
// del edificio, como todo el resto del sistema-- la fila no se encontraría nunca.
afirmar('y se puede buscar por el nombre del edificio, no solo por id',
    /cuentas_bancarias[\s\S]{0,400}LOWER\(TRIM\(edificio\)\)/.test(portal));

console.log('\nEl candado de lo inventado:');
// Cada una de las cuatro cosas que se fabricaban. Se miden por separado para que el día que alguien
// vuelva a poner UNA, la prueba diga cuál.
afirmar('no vuelve el banco inventado', !/Banco Oficial del Consorcio/.test(portal));
afirmar('no vuelve el titular armado con el nombre del edificio',
    !/titular:\s*'Consorcio '\s*\+/.test(portal));
afirmar('no vuelve el CBU de relleno', !/cbu:\s*'Consultar con/.test(portal));
// Este es el peor: un alias plausible, con botón de copiar al lado.
afirmar('no vuelve el ALIAS armado con el nombre del edificio',
    !/alias:\s*\(?v\.edificio[\s\S]{0,80}\.expensas/.test(portal));

console.log('\nQué se muestra cuando no hay datos cargados:');
afirmar('la pantalla decide con hayDatosBancoAmenities',
    /hayDatosBancoAmenities/.test(portal));
afirmar('y sin datos muestra el aviso en vez de una cuenta',
    /!hayDatosBancoAmenities[\s\S]{0,300}amen\.bancoNoCargado/.test(portal));

// El botón "Copiar" solo puede existir adentro de una rama que ya verificó que el dato está.
const bloqueAlias = (portal.match(/datosBanco\.alias \? `[\s\S]{0,600}?`/) || [''])[0];
afirmar('el botón de copiar el alias vive dentro de la rama que comprueba el alias',
    bloqueAlias.includes('copiarTexto') && bloqueAlias.includes('datosBanco.alias'));

// El navegador no arma datos de pago: el servidor le pasa el alias ya resuelto, y vacío significa
// "no hay". Si el cliente volviera a componerlo, volvería el problema por otra puerta.
afirmar('el alias del recuadro de arancel lo resuelve el servidor (ALIAS_COBRO)',
    /const ALIAS_COBRO = \$\{JSON\.stringify/.test(portal));
afirmar('y sin alias el recuadro dice que falta, no nombra ninguno',
    /ALIAS_COBRO[\s\S]{0,300}TA\.bancoNoCargado/.test(portal));

console.log('\nEl mensaje está en los cuatro idiomas:');
const { textos } = require('./idiomas');
for (const idioma of ['es', 'en', 'pt', 'fr']) {
    const txt = textos(idioma)('amen.bancoNoCargado');
    afirmar(`${idioma}: existe y no es la clave sin traducir`,
        typeof txt === 'string' && txt.length > 20 && !txt.includes('amen.'));
}

// ── La pantalla de verdad, contra PostgreSQL ──────────────────────────────────────────
//
// Los candados de arriba leen el código. Esto RENDERIZA la página, que es lo único que puede
// decir dos cosas: que no se cae con `datosBanco` en null --el fallback inventado además de
// falsear tapaba eso-- y que con la cuenta cargada los datos reales SÍ se muestran. Un arreglo
// que esconda los datos buenos sería tan malo como el que los inventaba.
async function contraLaBase() {
    const url = process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL;
    if (!url) {
        console.log('\n⚠️  La pantalla NO se renderizó: necesita un PostgreSQL y no hay ninguno.');
        console.log('   Es la única parte que comprueba que la página no se cae y que los datos');
        console.log('   cargados sí se muestran.');
        console.log('   Para correrla:  DATABASE_URL_PRUEBAS=postgres://... node pruebas-datos-banco-amenity.js');
        return;
    }
    process.env.DATABASE_URL = url;

    const express = require('express');
    const http = require('http');
    const app = express();
    app.use('/vecino', require('./portal-vecino'));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));

    const pedir = () => new Promise((res) => {
        http.get({ host: '127.0.0.1', port: srv.address().port, path: '/vecino/amenities' }, (r) => {
            const t = [];
            r.on('data', (d) => t.push(d));
            r.on('end', () => res({ codigo: r.statusCode, html: Buffer.concat(t).toString() }));
        }).on('error', () => res({ codigo: 0, html: '' }));
    });

    const { pool } = require('./db-pg');
    const { sesionDemoVecino } = require('./sesion-demo');

    // El esquema se aplica al cargar db-pg.js y no bloquea a nadie, así que la tabla puede no
    // existir todavía. Es la misma carrera del arranque anotada en CLAUDE.md.
    for (let i = 0; i < 40; i++) {
        const r = await pool.query(`SELECT to_regclass('cuentas_bancarias') AS t`);
        if (r.rows[0].t) break;
        await new Promise((res) => setTimeout(res, 250));
    }

    const demo = sesionDemoVecino();
    await pool.query(`DELETE FROM cuentas_bancarias WHERE alias = 'prueba.cuenta.real'`);

    console.log('\nSIN la cuenta cargada (el caso que antes inventaba):');
    const sin = await pedir();
    afirmar('la página sale y no se cae con datosBanco en null', sin.codigo === 200 && sin.html.length > 5000);
    afirmar('no aparece el banco inventado', !/Banco Oficial del Consorcio/.test(sin.html));
    afirmar('no aparece un alias armado con el nombre del edificio', !/\.expensas/.test(sin.html));
    afirmar('sí se dibuja el aviso de que falta cargarlo', /FEF3C7[\s\S]{0,200}todavía no cargó/.test(sin.html));
    afirmar('y el alias que llega al navegador viaja VACÍO', /const ALIAS_COBRO = ""/.test(sin.html));

    console.log('\nCON la cuenta cargada:');
    await pool.query(
        `INSERT INTO cuentas_bancarias (edificio, banco, titular, cbu, alias)
         VALUES ($1, 'Banco de prueba', 'Consorcio Prueba 159', '0110599520000001234567', 'prueba.cuenta.real')`,
        [demo.edificio]
    );
    const con = await pedir();
    afirmar('el titular cargado SÍ se muestra', /Consorcio Prueba 159/.test(con.html));
    afirmar('el alias cargado SÍ se muestra', /prueba\.cuenta\.real/.test(con.html));
    afirmar('el CBU cargado SÍ se muestra', /0110599520000001234567/.test(con.html));
    afirmar('el alias real llega al navegador', /const ALIAS_COBRO = "prueba\.cuenta\.real"/.test(con.html));
    afirmar('y el recuadro del aviso ya no se dibuja', !/FEF3C7[\s\S]{0,200}todavía no cargó/.test(con.html));

    await pool.query(`DELETE FROM cuentas_bancarias WHERE alias = 'prueba.cuenta.real'`);
    srv.close();
    await pool.end();
}

contraLaBase()
    .catch((e) => { console.error('\n❌ La prueba se cayó:', e.message); fallos++; })
    .then(() => {
        console.log(fallos === 0
            ? '\n✅ TODO EN ORDEN: sin datos cargados no se nombra ninguna cuenta, y con datos se muestran.\n'
            : `\n❌ ${fallos} fallo(s).\n`);
        process.exit(fallos === 0 ? 0 : 1);
    });
