/**
 * EL TOKEN QUE ABRE LA PUERTA NO SE LE MANDA A UN TERCERO.
 *
 * Las cuatro pantallas que muestran un QR --el modal del pase en el portal, la página del
 * pase y el cartel de la portería, y la respuesta del alta de un pase-- pedían la imagen así:
 *
 *     https://api.qrserver.com/v1/create-qr-code/?...&data=<TOKEN>
 *
 * O sea: el código que abre la puerta de un edificio viajaba, **en la URL**, al servidor de
 * otra empresa. En la URL y no en el cuerpo, así que queda en su log de accesos — y ese es el
 * peor lugar donde puede quedar, porque nadie sabe cuánto lo guardan, quién lo lee, ni a quién
 * se lo venden. Nosotros no nos enteramos nunca.
 *
 * Y tiene una segunda cara, más chica pero visible: si ese servicio está caído o bloqueado, el
 * vecino abre su pase y ve un cuadrado roto. El pase es válido; lo único que falta es dibujarlo.
 *
 * Ahora lo dibuja `qr-imagen.js` en nuestro propio servidor, sin un solo pedido a internet.
 *
 * Dos vías distintas, a propósito:
 *
 *   - **Portal del vecino**: se pide por el **id del pase**, con sesión. El token no aparece en
 *     ninguna URL, ni siquiera en la nuestra (una URL con el token adentro queda en el log de
 *     nginx). El permiso lo da el mismo filtro que alimenta la pantalla: `listarPasesEdificio`
 *     ya devuelve solo los pases del edificio y el departamento de ese vecino.
 *   - **Portería**: ahí el dato sí va en la URL, y está bien que vaya. Esas páginas ya se abren
 *     con el token adentro de la URL (`/porteria/pase/<token>`), así que no expone nada nuevo.
 *
 * La parte que corre contra un PostgreSQL de VERDAD es la del permiso: que un id de otro
 * edificio no dibuje nada. Eso no se puede medir leyendo el código.
 */
const fs = require('fs');

let fallos = 0;
const afirmar = (titulo, cond) => {
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
    if (!cond) fallos++;
};

// Saca los comentarios antes de medir. Este archivo y los que revisa NOMBRAN a
// api.qrserver.com para explicar por qué no se usa más, y un candado que confunda el
// comentario con el código mide la explicación en lugar de la función. Ya pasó en este repo
// con `pruebas-clave-app.js` y con el candado del pop-up.
function soloCodigo(archivo) {
    return fs.readFileSync(archivo, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

async function main() {
    console.log('\n🔳 EL QR SE DIBUJA EN NUESTRO SERVIDOR\n');

    // ── 1. El módulo dibuja de verdad ─────────────────────────────────────────────
    console.log('El módulo:');
    const { pngDelDato, rutaQrPorDato, tamanioPedido, TAM_MIN, TAM_MAX } = require('./qr-imagen');

    const png = await pngDelDato('PASE-ABC12345', 350);
    afirmar('devuelve un PNG de verdad (su firma dice PNG)', png.slice(1, 4).toString() === 'PNG');
    afirmar('y no está vacío', png.length > 200);

    let rechazoVacio = false;
    try { await pngDelDato('   '); } catch (_) { rechazoVacio = true; }
    afirmar('un dato vacío se rechaza en vez de dibujar un cuadrado sin nada', rechazoVacio);

    let rechazoLargo = false;
    try { await pngDelDato('x'.repeat(513)); } catch (_) { rechazoLargo = true; }
    afirmar('un dato absurdamente largo se rechaza (ningún teléfono lo leería)', rechazoLargo);

    afirmar('el tamaño pedido tiene techo', tamanioPedido(99999) === TAM_MAX);
    afirmar('y piso', tamanioPedido(1) === TAM_MIN);
    afirmar('un tamaño basura no rompe nada', tamanioPedido('hola') > 0);

    // ── 2. Candado: nadie vuelve a pedirle el QR a un tercero ─────────────────────
    console.log('\nEl candado de los terceros:');
    const mios = ['portal-vecino.js', 'porteria.js', 'qr-imagen.js'];
    const servicios = /qrserver|chart\.googleapis\.com\/chart|goqr\.me|quickchart\.io/i;
    for (const archivo of mios) {
        const codigo = soloCodigo(archivo);
        afirmar(`${archivo} no le pide el QR a ningún servicio externo`, !servicios.test(codigo));
    }

    // ── 3. Candado: el token no viaja en la URL del portal ───────────────────────
    console.log('\nEl candado del portal:');
    const portal = soloCodigo('portal-vecino.js');

    // La imagen del modal se pide por id. Si alguien vuelve a poner el token en el `src`,
    // el token vuelve al log de nginx aunque el servidor ya no sea de un tercero.
    const srcQr = portal.match(/ver-pase-qr-img'\)\.src\s*=\s*([^\n;]+)/);
    afirmar('el <img> del modal existe y se le asigna un src', !!srcQr);
    if (srcQr) {
        afirmar('ese src NO lleva el token', !/\.token/.test(srcQr[1]));
        afirmar('ese src va por el id del pase', /\.id/.test(srcQr[1]));
        afirmar('y apunta a nuestra propia ruta', /\/vecino\/api\/pases-qr\//.test(srcQr[1]));
    }
    afirmar('la ruta que sirve la imagen del pase existe',
        /router\.get\(\s*'\/api\/pases-qr\/:id\/imagen'/.test(portal));

    // ── 4. Candado: la portería tiene su ruta ────────────────────────────────────
    console.log('\nEl candado de la portería:');
    const porteria = soloCodigo('porteria.js');
    afirmar('la ruta que dibuja el QR existe', /router\.get\(\s*'\/qr\.png'/.test(porteria));
    afirmar('las tres pantallas la usan a través de rutaQrPorDato',
        (porteria.match(/rutaQrPorDato\(/g) || []).length >= 3);

    // ── 5. El permiso, contra PostgreSQL de verdad ────────────────────────────────
    const url = process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL;
    if (!url) {
        console.log('\n⚠️  El permiso NO se comprobó: necesita un PostgreSQL y no hay ninguno.');
        console.log('   Es la única parte que verifica que un pase de OTRO edificio no se dibuje.');
        console.log('   Para correrla:  DATABASE_URL_PRUEBAS=postgres://... node pruebas-qr-local.js');
        return terminar();
    }
    process.env.DATABASE_URL = url;

    console.log('\nEl permiso (contra PostgreSQL de verdad):');
    const express = require('express');
    const http = require('http');
    const app = express();
    app.use('/vecino', require('./portal-vecino'));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));
    const puerto = srv.address().port;

    const pedir = (ruta) => new Promise((res) => {
        http.get({ host: '127.0.0.1', port: puerto, path: ruta }, (r) => {
            const trozos = [];
            r.on('data', (d) => trozos.push(d));
            r.on('end', () => res({
                codigo: r.statusCode,
                tipo: r.headers['content-type'] || '',
                cache: r.headers['cache-control'] || '',
                cuerpo: Buffer.concat(trozos)
            }));
        }).on('error', () => res({ codigo: 0, tipo: '', cuerpo: Buffer.alloc(0) }));
    });

    const { crearPaseQR } = require('./db-pg');
    const { sesionDemoVecino } = require('./sesion-demo');

    // Sin login, el portal usa la sesión demo. Su edificio se toma de donde sale de verdad:
    // adivinarlo haría que la prueba se ponga roja el día que cambie, contra código correcto.
    const demo = sesionDemoVecino();

    const basePase = {
        origen: 'edifica',
        creado_por_nombre: 'prueba',
        motivo: 'prueba',
        tipo_pase: 'visita',
        valido_desde: new Date(),
        valido_hasta: new Date(Date.now() + 3600e3),
        usos_permitidos: 1
    };

    const propio = await crearPaseQR(Object.assign({}, basePase, {
        token: 'PRUEBAQR-PROPIO-' + Date.now(),
        edificio: demo.edificio,
        departamento: demo.departamento,
        nombre_invitado: 'Invitado de esta unidad'
    }));

    // El edificio ajeno tiene que EXISTIR: `crearPaseQR` rechaza un pase de un edificio que no
    // está cargado --bien puesto, un pase así no abriría ninguna puerta-- así que un nombre
    // inventado mediría esa validación en lugar del permiso, que es lo que esta prueba busca.
    const { pool } = require('./db-pg');
    const EDIFICIO_AJENO = 'Rivadavia 4000 (prueba QR)';
    await pool.query(
        `INSERT INTO edificios (edificio, nombre) VALUES ($1, $1)
         ON CONFLICT DO NOTHING`,
        [EDIFICIO_AJENO]
    );

    const ajeno = await crearPaseQR(Object.assign({}, basePase, {
        token: 'PRUEBAQR-AJENO-' + Date.now(),
        edificio: EDIFICIO_AJENO,
        departamento: '9Z',
        nombre_invitado: 'Invitado de otro edificio'
    }));

    const rAjeno = await pedir(`/vecino/api/pases-qr/${ajeno.id}/imagen`);
    afirmar('un pase de OTRO edificio no se dibuja', rAjeno.codigo === 404);
    afirmar('y no devuelve una imagen', !/image\/png/.test(rAjeno.tipo));

    const rBasura = await pedir('/vecino/api/pases-qr/no-es-un-numero/imagen');
    afirmar('un id que no es un número se rechaza', rBasura.codigo === 400);

    const rPropio = await pedir(`/vecino/api/pases-qr/${propio.id}/imagen`);
    const esPng = rPropio.codigo === 200 && /image\/png/.test(rPropio.tipo)
        && rPropio.cuerpo.slice(1, 4).toString() === 'PNG';
    afirmar('el pase propio SÍ se dibuja, y es un PNG', esPng);
    // `private`: un proxy compartido no tiene por qué guardarse el QR de la puerta de nadie.
    afirmar('la imagen no se guarda en una caché compartida', /private/.test(rPropio.cache));

    await pool.query('DELETE FROM pases_qr WHERE token LIKE $1', ['PRUEBAQR-%']);
    await pool.query('DELETE FROM edificios WHERE edificio = $1', [EDIFICIO_AJENO]);
    srv.close();
    await pool.end();
    terminar();
}

function terminar() {
    console.log(fallos === 0
        ? '\n✅ TODO EN ORDEN: el QR se dibuja acá y el token no sale del servidor.\n'
        : `\n❌ ${fallos} fallo(s).\n`);
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error('\n❌ La prueba se cayó:', e.message);
    process.exit(1);
});
