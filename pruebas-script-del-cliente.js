/**
 * EL JAVASCRIPT QUE LLEGA AL NAVEGADOR TIENE QUE PARSEAR.
 *
 * > [!CAUTION]
 * > **Un error de sintaxis en el script del cliente no rompe una función: rompe TODAS.** El navegador
 * > descarta el `<script>` entero, así que ninguna función se registra y la pantalla queda colgada
 * > sin un solo error del lado del servidor.
 *
 * Pasó, y me costó caro: la pantalla `/vecino/pases` quedaba en *"⏳ Cargando pases…"* y no
 * respondía a ningún botón. **Lo encontró Antigravity el 28/09**, en el navegador, después de que yo
 * persiguiera dos hipótesis equivocadas --que faltaba la tabla `pases_qr`, y que era el servicio
 * externo del QR--. Ninguna era. El error estaba en mi propio código:
 *
 *   1. `'<button onclick="verPaseModal(\'' + p.token + '\')">'` dentro de un template literal. Node
 *      convierte `\'` en `'` al evaluarlo, así que al navegador llegaba
 *      `onclick="verPaseModal('' + p.token + '')"` y el motor cerraba la cadena en el segundo
 *      apóstrofe: `Unexpected string`.
 *   2. Un `\n` dentro del template literal se volvía un salto de línea **literal** adentro de una
 *      cadena entre comillas simples, que en JavaScript es sintaxis inválida.
 *
 * Las dos son de la misma familia que el acento grave que rompió `db-pg.js`: **el código se escribe
 * adentro de un template literal, y lo que el servidor evalúa no es lo que uno leyó.** Tres veces ya.
 *
 * Lo que faltaba no era revisar mejor: era **mirar el resultado**. Esta prueba pide cada pantalla,
 * saca cada `<script>` y lo COMPILA. No lo ejecuta --`new Function` compila el cuerpo y no lo
 * corre-- así que no hace falta un navegador ni un DOM: alcanza para que un error de sintaxis
 * aparezca acá en vez de en el celular de un vecino.
 */
const express = require('express');
const http = require('http');

let fallos = 0;
const afirmar = (titulo, cond, detalle) => {
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
    if (!cond) {
        if (detalle) console.log(`       ↳ ${detalle}`);
        fallos++;
    }
};

// Saca el contenido de cada <script> inline. Los que traen `src` no tienen cuerpo, y los que
// declaran un tipo que no es JavaScript (por ejemplo `application/json`) no se compilan.
function scriptsDe(html) {
    const encontrados = [];
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const atributos = m[1] || '';
        const cuerpo = m[2] || '';
        if (/\ssrc\s*=/i.test(atributos)) continue;
        const tipo = (atributos.match(/type\s*=\s*["']([^"']+)["']/i) || [])[1];
        if (tipo && !/javascript|module/i.test(tipo)) continue;
        if (!cuerpo.trim()) continue;
        encontrados.push(cuerpo);
    }
    return encontrados;
}

// Las pantallas del portal y de la portería. Se piden sin sesión: cae la sesión demo, que es
// justamente la que usa Daniel para probar.
const PANTALLAS = [
    ['/vecino/login', 'login del vecino'],
    ['/vecino/', 'inicio'],
    ['/vecino/perfil', 'mi perfil'],
    ['/vecino/pases', 'pases QR'],        // la que estuvo colgada
    ['/vecino/expensas', 'expensas'],
    ['/vecino/novedades', 'novedades'],
    ['/vecino/reclamos', 'reclamos'],
    ['/vecino/amenities', 'amenities'],
    ['/vecino/integrantes', 'integrantes'],
    ['/vecino/chat', 'chat'],
    ['/porteria/San%20Patricio%20159', 'portería del edificio'],
    ['/porteria/San%20Patricio%20159/totem', 'tótem'],
    ['/porteria/San%20Patricio%20159/qr', 'cartel QR'],
    ['/porteria/cartel/San%20Patricio%20159', 'cartel']
];

async function main() {
    console.log('\n🖥️  EL SCRIPT QUE LLEGA AL NAVEGADOR PARSEA\n');

    const app = express();
    app.use(express.json());
    app.use('/vecino', require('./portal-vecino'));
    app.use('/porteria', require('./porteria'));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));
    const puerto = srv.address().port;

    const pedir = (ruta) => new Promise((res) => {
        http.get({ host: '127.0.0.1', port: puerto, path: ruta }, (r) => {
            const t = [];
            r.on('data', (d) => t.push(d));
            r.on('end', () => res({ codigo: r.statusCode, html: Buffer.concat(t).toString() }));
        }).on('error', (e) => res({ codigo: 0, html: '', error: e.message }));
    });

    let totalScripts = 0;

    for (const [ruta, nombre] of PANTALLAS) {
        const r = await pedir(ruta);

        // Una pantalla que redirige o que no existe no tiene script que revisar, y eso NO es un
        // fallo de esta prueba: lo que se mide es que lo que SÍ se sirve parsee.
        if (r.codigo === 302 || r.codigo === 301) {
            console.log(`  ↪️  ${nombre} redirige (${r.codigo}): no hay script que revisar`);
            continue;
        }
        if (r.codigo !== 200) {
            afirmar(`${nombre} responde`, false, `código ${r.codigo}${r.error ? ' — ' + r.error : ''}`);
            continue;
        }

        const scripts = scriptsDe(r.html);
        if (!scripts.length) {
            console.log(`  ·  ${nombre}: sin script inline`);
            continue;
        }

        let roto = null;
        scripts.forEach((cuerpo, i) => {
            if (roto) return;
            try {
                // Compila y NO ejecuta: un SyntaxError salta acá; nada del cuerpo corre.
                new Function(cuerpo);
            } catch (e) {
                // La línea del error, para no tener que buscarla a mano.
                const lineas = cuerpo.split('\n');
                const nLinea = Number((String(e.stack || '').match(/<anonymous>:(\d+)/) || [])[1]);
                const alrededor = Number.isFinite(nLinea) && lineas[nLinea - 2]
                    ? ` cerca de: ${String(lineas[nLinea - 2]).trim().slice(0, 90)}`
                    : '';
                roto = `script #${i + 1} de ${scripts.length}: ${e.message}.${alrededor}`;
            }
        });

        totalScripts += scripts.length;
        afirmar(`${nombre} — ${scripts.length} script(s) compilan`, !roto, roto);
    }

    afirmar(`se revisó al menos un script (fueron ${totalScripts})`, totalScripts > 0);

    // ── El candado del candado ────────────────────────────────────────────────────
    //
    // Una prueba que no puede fallar no protege nada. Esto comprueba que el mecanismo detecta de
    // verdad los DOS errores que se vieron en producción, con las formas exactas que tenían.
    console.log('\nQue la prueba sí detecta los errores que ya pasaron:');

    const comoLlegoAlNavegador = `var b = '<button onclick="verPaseModal('' + p.token + '')">';`;
    let detectaApostrofe = false;
    try { new Function(comoLlegoAlNavegador); } catch (_) { detectaApostrofe = true; }
    afirmar('detecta el apóstrofe que cerró la cadena de más', detectaApostrofe);

    const conSaltoLiteral = "var t = 'primera\nsegunda';";
    let detectaSalto = false;
    try { new Function(conSaltoLiteral); } catch (_) { detectaSalto = true; }
    afirmar('detecta el salto de línea literal dentro de una cadena', detectaSalto);

    srv.close();
}

main()
    .catch((e) => { console.error('\n❌ La prueba se cayó:', e.message); fallos++; })
    .then(() => {
        console.log(fallos === 0
            ? '\n✅ TODO EN ORDEN: ninguna pantalla sirve JavaScript roto.\n'
            : `\n❌ ${fallos} fallo(s).\n`);
        process.exit(fallos === 0 ? 0 : 1);
    });
