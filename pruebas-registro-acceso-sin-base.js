// Verifica qué pasa con un QR en la puerta cuando PostgreSQL NO contesta.
//
//   node pruebas-registro-acceso-sin-base.js
//   DATABASE_URL_PRUEBAS=postgres://... node pruebas-registro-acceso-sin-base.js   (la parte final)
//
// > [!CAUTION]
// > **La rama "sin base" de `/porteria/api/validar-qr` NUNCA corría.** Se decía --en `CLAUDE.md` y
// > en un comentario del propio endpoint-- que con la base caída el pase se validaba por firma. Pero
// > `pool` en `db-pg.js` no es nunca nulo (sin URL arma un pool de mentira), así que con la base
// > inalcanzable la consulta tiraba ECONNREFUSED, el endpoint contestaba 500, ni un pase bien
// > firmado abría y el intento no dejaba NINGÚN registro. Medido apuntando a un puerto muerto.
//
// Esta prueba apunta a un puerto muerto a propósito, así que la parte principal no necesita
// ninguna base: lo que mide es justamente qué hace el servidor cuando no hay.

process.env.DATABASE_URL = 'postgres://prueba@127.0.0.1:1/prueba';   // nada escucha en el 1
process.env.QR_PASES_CLAVE = 'clave-de-prueba-no-es-la-de-produccion';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

let fallos = 0;
function afirmar(titulo, ok, detalle) {
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok && detalle) console.log(`     ${detalle}`);
}
function terminar() {
    console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo bien');
    process.exit(fallos ? 1 : 0);
}
const leer = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sinComentarios = (t) => t.split('\n').filter(l => !/^\s*(\/\/|--|\*)/.test(l)).join('\n');

(async () => {
    const express = require('express');
    const { emitirPaseFirmado } = require('./qr-firmado');
    const { cola } = require('./cola-registro-acceso');
    const db = require('./db-pg');

    const EDIFICIO = 'San Patricio 270';
    const app = express();
    app.use(express.json());
    app.use('/porteria', require('./porteria'));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));
    const puerto = srv.address().port;

    const validar = (token, edificio = EDIFICIO) => new Promise((resolve) => {
        const cuerpo = JSON.stringify({ token, edificio });
        const t0 = Date.now();
        const r = http.request({
            host: '127.0.0.1', port: puerto, path: '/porteria/api/validar-qr', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) }
        }, (resp) => {
            let b = '';
            resp.on('data', (c) => b += c);
            resp.on('end', () => {
                let json = null; try { json = JSON.parse(b); } catch (_) {}
                resolve({ status: resp.statusCode, json, ms: Date.now() - t0 });
            });
        });
        r.end(cuerpo);
    });

    console.log('\n── CON LA BASE INALCANZABLE ──');
    const vence = Date.now() + 60 * 60 * 1000;
    const bueno = emitirPaseFirmado({ edificio: EDIFICIO, unidad: '4B', id: 'p1', vence });
    const ajeno = emitirPaseFirmado({ edificio: 'Rivadavia 4', unidad: '1A', id: 'p2', vence });
    const vencido = emitirPaseFirmado({ edificio: EDIFICIO, unidad: '4B', id: 'p3', vence: Date.now() - 1000 });

    const rBueno = await validar(bueno);
    afirmar('un pase bien firmado ABRE (antes: 500)', rBueno.status === 200 && rBueno.json && rBueno.json.valido === true,
        `status ${rBueno.status} ${JSON.stringify(rBueno.json)}`);
    afirmar('y no espera otro timeout de conexión para abrir', rBueno.ms < 2500, rBueno.ms + ' ms');

    const rInventado = await validar('PASS-loquesea');
    afirmar('un `PASS-` escrito a mano NO abre', rInventado.status === 403 && rInventado.json && rInventado.json.valido === false);
    const rAjeno = await validar(ajeno);
    afirmar('un pase firmado de OTRO edificio NO abre', rAjeno.status === 403);
    const rVencido = await validar(vencido);
    afirmar('un pase firmado y vencido NO abre', rVencido.status === 403);
    const rModificado = await validar(bueno.slice(0, -2) + (bueno.endsWith('AA') ? 'BB' : 'AA'));
    afirmar('un pase con la firma alterada NO abre', rModificado.status === 403);

    // Lo que importa del registro: que los cinco intentos QUEDEN, abrieran o no.
    await new Promise(r => setTimeout(r, 200));
    const cola5 = cola.pendientes();
    afirmar('los 5 intentos quedaron en la cola, abrieran o no', cola5.length === 5, 'hay ' + cola5.length);
    const sinBase = cola5.filter(i => { try { return JSON.parse(i.params[9]).validado_sin_base === true; } catch (_) { return false; } });
    afirmar('y cada uno dice que se validó sin base', sinBase.length === 5);
    afirmar('el rechazado queda como rechazado y el bueno como exitoso',
        cola5.some(i => i.params[3] === 'exitoso') && cola5.filter(i => /^rechazado/.test(i.params[3])).length === 4);

    console.log('\n── EL REGISTRO DIRECTO NO SE PIERDE NI TIRA ──');
    let tiro = null, r2 = null;
    try { r2 = await db.registrarEventoAcceso({ edificio: EDIFICIO, tipo_acceso: 'Timbre Atendido', detalle: 'prueba' }); }
    catch (e) { tiro = e; }
    afirmar('con la base caída encola en vez de tirar', !tiro && r2 && r2.encolado === true, tiro && tiro.message);
    afirmar('quedaron 6 en la cola', cola.pendientes().length === 6);

    console.log('\n── LO QUE NO SE TOCA (candados) ──');
    const porteria = sinComentarios(leer('porteria.js'));
    const trozo = porteria.slice(porteria.indexOf("router.post('/api/validar-qr'"), porteria.indexOf('EL VECINO ABRE LA PUERTA'));
    afirmar('solo se cae a la firma si el error es DE CONEXIÓN (cualquier otro error sigue siendo error)',
        /esFallaDeConexion\(errBase\)\)\s*throw errBase/.test(trozo));
    afirmar('el registro del QR avisa que la base está caída para no esperar otro timeout', /diferido:\s*baseCaida/.test(trozo));
    afirmar('index.js retoma la cola de accesos al arrancar', /cola-registro-acceso'\)\.cola\.iniciar\(\)/.test(leer('index.js')));
    afirmar('el archivo de la cola está en .gitignore (trae IP y fotos)', leer('.gitignore').split('\n').includes('cola-accesos-pendiente.json'));
    afirmar('reset-test.js lo borra', /cola-registro-acceso/.test(leer('reset-test.js')));

    // ── Lo encolado, ¿entra de verdad en una base real? ───────────────────────────
    const url = process.env.DATABASE_URL_PRUEBAS;
    if (!url) {
        console.log('\n⚠️  La parte que importa NO se comprobó: necesita un PostgreSQL y no hay ninguno.');
        console.log('   Es la que verifica que lo encolado ENTRE en la tabla cuando la base vuelve.');
        console.log('   Para correrla:  DATABASE_URL_PRUEBAS=postgres://... node pruebas-registro-acceso-sin-base.js');
        return terminar();
    }

    console.log('\n── CUANDO LA BASE VUELVE, LO ENCOLADO ENTRA (contra PostgreSQL de verdad) ──');
    const item = cola5.find(i => i.params[3] === 'exitoso');
    const hijo = spawnSync(process.execPath, ['-e', `
        const item = JSON.parse(process.argv[1]);
        const db = require('./db-pg');
        (async () => {
          await new Promise(r => setTimeout(r, 4000));
          await db.pool.query(item.sql, item.params);
          const f = (await db.pool.query("SELECT resultado, qr_id, metadata FROM eventos_acceso WHERE qr_id = $1", [item.params[6]])).rows;
          console.log(JSON.stringify(f));
          await db.pool.query("DELETE FROM eventos_acceso WHERE qr_id = $1", [item.params[6]]);
          process.exit(0);
        })().catch(e => { console.log('ERROR ' + e.message); process.exit(1); });
    `, JSON.stringify(item)], {
        cwd: __dirname, encoding: 'utf8', timeout: 30000,
        env: Object.assign({}, process.env, { DATABASE_URL: url }),
    });
    const ultima = (hijo.stdout || '').trim().split('\n').pop();
    let filas = []; try { filas = JSON.parse(ultima); } catch (_) {}
    afirmar('el INSERT encolado, ejecutado después, escribe la fila', filas.length === 1 && filas[0].resultado === 'exitoso', ultima);
    afirmar('con la marca de que se validó sin base', filas[0] && filas[0].metadata && filas[0].metadata.validado_sin_base === true);

    terminar();
})().catch((e) => { console.log('❌ la prueba reventó: ' + e.stack); process.exit(1); });
