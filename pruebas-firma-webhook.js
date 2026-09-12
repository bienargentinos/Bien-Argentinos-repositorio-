// EL WEBHOOK NO LE CREE A CUALQUIERA
//
//   node pruebas-firma-webhook.js
//
// > [!CAUTION]
// > **Hasta acá el webhook aceptaba cualquier POST.** No verificaba nada: alcanzaba con conocer la
// > URL para hacerle creer a Marcos que escribió un técnico o un vecino.
//
// Y Marcos no solo contesta, actúa: abre un caso, le manda un WhatsApp real a una persona, deja un
// cambio de CBU pendiente, le imputa una factura a un consorcio. Desde adentro un POST inventado se
// ve idéntico a uno legítimo, así que no hay log que delate nada.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { firmaValida, exigirFirmaMeta } = require('./firma-webhook');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const SECRETO = 'secreto-de-prueba-no-es-el-real';
const cuerpo = Buffer.from(JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: '541169241157', text: { body: 'voy en 2 hs' } }] } }] }],
}), 'utf8');
const firmar = (buf, secreto = SECRETO) =>
    'sha256=' + crypto.createHmac('sha256', secreto).update(buf).digest('hex');

console.log('\n── LA FIRMA ──');

prueba('una firma correcta pasa', () => {
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: firmar(cuerpo), secreto: SECRETO }), true);
});

prueba('firmada con OTRO secreto no pasa', () => {
    // Este es el caso real: alguien que conoce la URL pero no el App Secret.
    const ajena = firmar(cuerpo, 'el-secreto-del-atacante');
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: ajena, secreto: SECRETO }), false);
});

prueba('un cuerpo cambiado invalida la firma', () => {
    // Interceptar el mensaje de un técnico y cambiarle el teléfono o el monto.
    const alterado = Buffer.from(cuerpo.toString().replace('541169241157', '541100000000'), 'utf8');
    assert.strictEqual(firmaValida({ cuerpoCrudo: alterado, firmaRecibida: firmar(cuerpo), secreto: SECRETO }), false);
});

prueba('sin firma no pasa', () => {
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: '', secreto: SECRETO }), false);
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: undefined, secreto: SECRETO }), false);
});

prueba('el hex pelado, sin "sha256=", no pasa', () => {
    // Exigir el prefijo es lo que evita aceptar mañana un "sha1=" más débil.
    const soloHex = firmar(cuerpo).replace('sha256=', '');
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: soloHex, secreto: SECRETO }), false);
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: 'sha1=' + soloHex, secreto: SECRETO }), false);
});

prueba('basura en la firma devuelve false, no una excepción', () => {
    // Esto corre en la puerta de entrada del servidor: una excepción acá sería otra forma de
    // caerse, y con `unhandledRejection` configurado para no cortar, además sería silenciosa.
    for (const basura of ['sha256=', 'sha256=xyz', 'sha256=' + 'f'.repeat(63), {}, [], 0, null]) {
        assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: basura, secreto: SECRETO }), false);
    }
});

prueba('sin secreto no valida nada', () => {
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: firmar(cuerpo), secreto: '' }), false);
});

prueba('el largo distinto no hace explotar timingSafeEqual', () => {
    // `timingSafeEqual` TIRA si los buffers miden distinto. Por eso el largo se compara antes.
    assert.strictEqual(firmaValida({ cuerpoCrudo: cuerpo, firmaRecibida: 'sha256=abcd', secreto: SECRETO }), false);
});

console.log('\n── EL MIDDLEWARE ──');

/** Un `req`/`res` mínimos, para no levantar Express. */
const pedido = (rawBody, firma) => ({
    rawBody,
    ip: '1.2.3.4',
    get: (h) => (h.toLowerCase() === 'x-hub-signature-256' ? firma : undefined),
});
const respuesta = () => {
    const r = { codigo: null };
    r.sendStatus = (c) => { r.codigo = c; return r; };
    return r;
};

prueba('con firma buena llama a next()', () => {
    const mw = exigirFirmaMeta({ secreto: SECRETO });
    let siguio = false;
    const res = respuesta();
    mw(pedido(cuerpo, firmar(cuerpo)), res, () => { siguio = true; });
    assert.strictEqual(siguio, true);
    assert.strictEqual(res.codigo, null, 'no tenía que contestar nada');
});

prueba('con firma mala contesta 403 y NO sigue', () => {
    // Lo importante es el "NO sigue": si siguiera, Marcos ya habría abierto el caso.
    const mw = exigirFirmaMeta({ secreto: SECRETO });
    let siguio = false;
    const res = respuesta();
    const antes = console.error; console.error = () => {};
    try { mw(pedido(cuerpo, firmar(cuerpo, 'otro')), res, () => { siguio = true; }); }
    finally { console.error = antes; }
    assert.strictEqual(siguio, false, 'un POST falso llegó al manejador');
    assert.strictEqual(res.codigo, 403);
});

prueba('sin cuerpo crudo tampoco pasa', () => {
    // Si alguien saca el `verify` del bodyParser, esto lo agarra en vez de rechazar todo en
    // silencio... o peor, de aceptar todo.
    const mw = exigirFirmaMeta({ secreto: SECRETO });
    let siguio = false;
    const res = respuesta();
    const antes = console.error; console.error = () => {};
    try { mw(pedido(undefined, firmar(cuerpo)), res, () => { siguio = true; }); }
    finally { console.error = antes; }
    assert.strictEqual(siguio, false);
    assert.strictEqual(res.codigo, 403);
});

console.log('\n── SIN SECRETO CONFIGURADO: PASA, Y GRITA ──');

prueba('sin META_APP_SECRET se sigue atendiendo', () => {
    // Rechazar acá dejaría a Marcos sordo en el instante del despliegue, antes de que nadie pueda
    // agregar la variable. Eso ya pasó una vez y costó producción caída.
    const mw = exigirFirmaMeta({ secreto: undefined });
    let siguio = false;
    const antes = console.error; console.error = () => {};
    try { mw(pedido(cuerpo, undefined), respuesta(), () => { siguio = true; }); }
    finally { console.error = antes; }
    assert.strictEqual(siguio, true);
});

prueba('y lo dice en el log, la primera vez', () => {
    // El riesgo de dejarlo abierto es que nadie se entere. Sin esta línea, queda así para siempre.
    const mw = exigirFirmaMeta({ secreto: undefined, nombre: 'webhook de prueba' });
    const dicho = [];
    const antes = console.error; console.error = (m) => dicho.push(String(m));
    try { mw(pedido(cuerpo, undefined), respuesta(), () => {}); }
    finally { console.error = antes; }
    assert.ok(dicho.some(l => /META_APP_SECRET/.test(l)), 'no avisó qué falta');
    assert.ok(dicho.some(l => /hacerse\s+pasar/.test(l)), 'no dijo cuál es el riesgo');
});

console.log('\n── CANDADOS ──');

const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

prueba('el bodyParser guarda el cuerpo crudo', () => {
    // Sin esto la firma NUNCA puede verificar, y como sin secreto se deja pasar, quedaría abierto
    // pareciendo cerrado.
    assert.ok(/bodyParser\.json\(\{[\s\S]{0,200}verify:[\s\S]{0,120}rawBody/.test(idx),
        'falta el `verify` que guarda req.rawBody en el bodyParser');
});

prueba('el webhook tiene el control de firma como primer manejador', () => {
    assert.ok(/app\.post\(\s*'\/webhook'\s*,\s*firmaDeMeta\s*,/.test(idx),
        'la ruta /webhook tiene que recibir el middleware ANTES del manejador');
});

prueba('nadie reimplementó la comparación de la firma por fuera', () => {
    // El error clásico es comparar con `===`, que responde más rápido cuando difiere al principio:
    // eso alcanza para adivinar la firma de a un byte. Y es exactamente el tipo de cosa que en este
    // repo ya quedó escrita dos veces (`buscarPerfilEdificio`) y arreglar una copia no sirvió.
    const fuera = fs.readdirSync(__dirname)
        .filter(f => f.endsWith('.js') && !/^(firma-webhook|pruebas-)/.test(f))
        .filter(f => /createHmac\([\s\S]{0,40}sha256/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')))
        .filter(f => /x-hub-signature/i.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    assert.deepStrictEqual(fuera, [],
        `estos archivos verifican la firma por su cuenta en vez de usar firma-webhook.js: ${fuera.join(', ')}`);
});

console.log('');
if (fallos === 0) {
    console.log('✅ Un POST que no venga de Meta no llega a Marcos.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
