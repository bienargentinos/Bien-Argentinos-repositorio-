// LOS PASES DE ACCESO NO SE PIDEN SIN CREDENCIAL
//
//   node pruebas-clave-app.js
//
// > [!CAUTION]
// > **Una app móvil no tiene sesión de navegador, y la forma rápida de que funcione es sacar el
// > control de acceso.** Pasó, y lo que quedó abierto a internet fue la creación de pases para
// > abrir la puerta de un edificio.
//
// El commit decía `permitir acceso a /api/pases-qr sin sesion web de dashboard para EdificaApp` y
// eran cuatro líneas dentro de `requireAuth`. Con eso, cualquiera podía **crear** un pase para el
// edificio que quisiera (el edificio viene en el cuerpo del pedido, con `tipo_pase: "recurrente"`
// que dura seis meses), **leer** los últimos 150 pases de TODOS los edificios con sus tokens --ni
// hacía falta crear uno-- y **revocar** pases ajenos. Con `Access-Control-Allow-Origin: *` encima,
// desde cualquier página web.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { claveValida, exigirSesionOClaveDeApp } = require('./clave-app');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const CLAVE = 'clave-de-prueba-no-es-la-real';

const pedido = (headers = {}, session = null) => ({
    session,
    ip: '1.2.3.4',
    get: (h) => headers[h.toLowerCase()],
});
const respuesta = () => {
    const r = { codigo: null, cuerpo: null };
    r.status = (c) => { r.codigo = c; return r; };
    r.json = (b) => { r.cuerpo = b; return r; };
    return r;
};
const haySesion = (req) => Boolean(req.session && req.session.authed);
const sinRuido = (fn) => {
    const antes = console.error; console.error = () => {};
    try { return fn(); } finally { console.error = antes; }
};

console.log('\n── LA COMPARACIÓN DE LA CLAVE ──');

prueba('la clave correcta vale', () => {
    assert.strictEqual(claveValida(CLAVE, CLAVE), true);
});

prueba('otra clave no vale', () => {
    assert.strictEqual(claveValida('otra-cosa', CLAVE), false);
    // Mismo largo, un carácter distinto: es el caso que un `===` resolvería filtrando tiempo.
    assert.strictEqual(claveValida('clave-de-prueba-no-es-la-reaL', CLAVE), false);
});

prueba('vacío o ausente no vale', () => {
    assert.strictEqual(claveValida('', CLAVE), false);
    assert.strictEqual(claveValida(undefined, CLAVE), false);
    assert.strictEqual(claveValida(CLAVE, ''), false);
});

prueba('un largo distinto no hace explotar timingSafeEqual', () => {
    // `timingSafeEqual` TIRA si los buffers miden distinto, y esto corre en la puerta de entrada.
    assert.strictEqual(claveValida('a', CLAVE), false);
    assert.strictEqual(claveValida(CLAVE + 'x', CLAVE), false);
});

console.log('\n── QUIÉN PASA Y QUIÉN NO ──');

prueba('con sesión del panel pasa, sin necesitar clave', () => {
    // El dueño y el administrador siguen entrando como siempre desde el navegador.
    const mw = exigirSesionOClaveDeApp({ clave: CLAVE, haySesion });
    let siguio = false;
    mw(pedido({}, { authed: true }), respuesta(), () => { siguio = true; });
    assert.strictEqual(siguio, true);
});

prueba('la app con su clave pasa', () => {
    const mw = exigirSesionOClaveDeApp({ clave: CLAVE, haySesion });
    let siguio = false;
    const req = pedido({ 'x-edifica-key': CLAVE });
    mw(req, respuesta(), () => { siguio = true; });
    assert.strictEqual(siguio, true);
    assert.strictEqual(req.esAppExterna, true, 'tiene que quedar marcado que vino de la app');
});

prueba('sin sesión y sin clave NO pasa', () => {
    // Esto es el agujero original: cualquiera en internet.
    const mw = exigirSesionOClaveDeApp({ clave: CLAVE, haySesion });
    let siguio = false;
    const res = respuesta();
    sinRuido(() => mw(pedido({}), res, () => { siguio = true; }));
    assert.strictEqual(siguio, false, 'un pedido anónimo llegó al endpoint');
    assert.strictEqual(res.codigo, 401);
});

prueba('con clave equivocada NO pasa', () => {
    const mw = exigirSesionOClaveDeApp({ clave: CLAVE, haySesion });
    let siguio = false;
    const res = respuesta();
    sinRuido(() => mw(pedido({ 'x-edifica-key': 'probando' }), res, () => { siguio = true; }));
    assert.strictEqual(siguio, false);
    assert.strictEqual(res.codigo, 401);
});

console.log('\n── SIN CLAVE CONFIGURADA SE RECHAZA (al revés que el webhook) ──');

prueba('sin EDIFICA_API_KEY no pasa nadie sin sesión', () => {
    // > No es una inconsistencia con el webhook de Meta: es la misma pregunta con la respuesta al
    // > revés. Allá fallar cerrado deja a Marcos sordo y fallar abierto cuesta un mensaje falso.
    // > Acá fallar abierto es la puerta de un edificio abierta a internet, y fallar cerrado cuesta
    // > que una app en desarrollo no funcione hasta configurar la variable.
    const mw = exigirSesionOClaveDeApp({ clave: undefined, haySesion });
    let siguio = false;
    const res = respuesta();
    sinRuido(() => mw(pedido({ 'x-edifica-key': 'cualquiera' }), res, () => { siguio = true; }));
    assert.strictEqual(siguio, false);
    assert.strictEqual(res.codigo, 503);
});

prueba('pero la sesión del panel sigue entrando', () => {
    // Sin esto, no configurar la variable dejaría al dueño afuera de su propio panel.
    const mw = exigirSesionOClaveDeApp({ clave: undefined, haySesion });
    let siguio = false;
    mw(pedido({}, { authed: true }), respuesta(), () => { siguio = true; });
    assert.strictEqual(siguio, true);
});

prueba('y lo dice en el log', () => {
    const mw = exigirSesionOClaveDeApp({ clave: undefined, haySesion, nombre: 'pases QR' });
    const dicho = [];
    const antes = console.error; console.error = (m) => dicho.push(String(m));
    try { mw(pedido({}), respuesta(), () => {}); } finally { console.error = antes; }
    assert.ok(dicho.some(l => /EDIFICA_API_KEY/.test(l)), 'no dijo qué variable falta');
});

console.log('\n── CANDADOS EN EL PANEL ──');

const dash = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');

prueba('requireAuth ya no deja pasar los pases sin control', () => {
    // El bypass original era: `if (req.path === '/api/pases-qr' ...) return next();`
    const i = dash.indexOf('function requireAuth(');
    const cuerpo = dash.slice(i, i + 900);
    assert.ok(/pases-qr/.test(cuerpo), 'no está el tratamiento de /api/pases-qr');

    // Se mira SOLO lo que hay adentro del `if` de los pases, hasta su llave de cierre. El
    // `return next()` de la sesión está tres líneas más abajo y es legítimo: tomarlo por el bypass
    // hacía fallar esta prueba con el código ya arreglado, y una prueba que grita sin motivo
    // termina ignorada.
    const desdeElIf = cuerpo.slice(cuerpo.indexOf("req.path === '/api/pases-qr'"));
    const bloqueDeLosPases = desdeElIf.slice(0, desdeElIf.indexOf('}') + 1);

    assert.ok(!/return next\(\)/.test(bloqueDeLosPases),
        'volvió el `return next()` directo: eso abre la creación de pases a internet');
    assert.ok(/claveDeEdifica\(req, res, next\)/.test(bloqueDeLosPases),
        'los pases tienen que pasar por el control de clave');
});

prueba('el listado completo no se le da a la app', () => {
    // Sin `edificio`, la consulta devuelve los últimos 150 pases de TODOS los edificios con sus
    // tokens. Eso queda solo para una sesión del panel: la clave de la app es compartida y no
    // identifica a ningún cliente.
    const i = dash.indexOf("router.get('/api/pases-qr'");
    const bloque = dash.slice(i, i + 1600);
    assert.ok(/req\.esAppExterna/.test(bloque), 'falta distinguir a la app de una sesión');
    assert.ok(/falta_edificio/.test(bloque), 'falta rechazar el pedido sin edificio');
});

prueba('el CORS permite la cabecera de la clave', () => {
    // Si falta, el navegador corta el pedido en el preflight y desde la app se ve como un error de
    // red sin explicación: tres horas de diagnóstico por una palabra.
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const i = idx.indexOf("app.use('/api/pases-qr'");
    const bloque = idx.slice(i, i + 700);
    assert.ok(/Access-Control-Allow-Headers[\s\S]{0,80}X-Edifica-Key/i.test(bloque),
        'X-Edifica-Key tiene que estar entre los encabezados permitidos');
});

console.log('');
if (fallos === 0) {
    console.log('✅ Un pase de acceso no se crea sin sesión del panel o sin la clave de la app.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
