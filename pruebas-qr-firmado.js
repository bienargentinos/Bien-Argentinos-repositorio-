/**
 * UN QR QUE ABRE SIN INTERNET, PERO SOLO EL QUE TIENE QUE ABRIR
 *
 * > [!CAUTION]
 * > **Lo que había cuando PostgreSQL no contestaba abría la puerta con cualquier cosa:**
 * >
 * >     const esMarcosQr = rawQr.startsWith('MARCOS-') || rawQr.startsWith('PASS-') || rawQr.startsWith('EDIFICA-');
 * >
 * > Escribir `PASS-` y cualquier cosa atrás alcanzaba. Y en Argentina la base no contesta cada vez
 * > que se corta la luz o internet, que no es el caso raro: es el caso que pasa.
 *
 *     node pruebas-qr-firmado.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { emitirPaseFirmado, verificarPaseFirmado, pareceFirmado, claveDelEdificio } = require('./qr-firmado');

const CLAVE = 'clave-de-prueba-no-es-la-de-produccion';
const EN_UNA_HORA = () => Date.now() + 60 * 60 * 1000;

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

const emitir = (o) => emitirPaseFirmado({ maestra: CLAVE, ...o });
const verificar = (token, edificio, ahora = Date.now()) => verificarPaseFirmado(token, edificio, ahora, CLAVE);

console.log('\n🎟️  UN QR QUE ABRE SIN INTERNET, PERO SOLO EL QUE TIENE QUE ABRIR\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) El pase bueno abre');
// ─────────────────────────────────────────────────────────────────────────────
{
    const token = emitir({ edificio: 'San Patricio 270', unidad: '4B', id: 'p1', vence: EN_UNA_HORA() });

    vale('se emite un token', typeof token === 'string' && token.startsWith('BA1.'));
    vale('y se reconoce como firmado', pareceFirmado(token));

    const r = verificar(token, 'San Patricio 270');
    vale('verifica sin consultar ninguna base', r.valido === true, r.mensaje);
    vale('devuelve la unidad que iba adentro', r.datos?.unidad === '4B');

    // La forma del nombre se tolera --es el mismo criterio de `mismoEdificio`-- pero el contenido no.
    vale('el mismo edificio escrito distinto sigue abriendo',
        verificar(token, 'san patricio 270').valido === true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Lo que NO puede abrir');
// ─────────────────────────────────────────────────────────────────────────────
{
    const token = emitir({ edificio: 'San Patricio 270', unidad: '4B', vence: EN_UNA_HORA() });

    vale('un `PASS-` escrito a mano NO abre',
        verificar('PASS-loquesea', 'San Patricio 270').valido === false,
        'Esto es exactamente lo que abría la puerta con la base caída.');

    vale('`MARCOS-` tampoco', verificar('MARCOS-abc123', 'San Patricio 270').valido === false);
    vale('`EDIFICA-` tampoco', verificar('EDIFICA-abc123', 'San Patricio 270').valido === false);
    vale('un token vacío tampoco', verificar('', 'San Patricio 270').valido === false);

    vale('el pase del 270 NO abre en el 159',
        verificar(token, 'San Patricio 159').valido === false,
        'Dos consorcios distintos de la misma calle. Es el error que deja entrar a un desconocido.');

    vale('sin decir de qué edificio se pregunta, no abre',
        verificar(token, '').valido === false,
        'La falta de un dato no es un comodín.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) La firma: cambiar UN carácter lo invalida');
// ─────────────────────────────────────────────────────────────────────────────
{
    const token = emitir({ edificio: 'San Patricio 270', unidad: '4B', vence: EN_UNA_HORA() });
    const [pre, payload, firma] = token.split('.');

    // Se recorre TODA la firma cambiando un carácter por vez. Es el equivalente a lo que hacen
    // `pruebas-cbu.js` con los 126 casos de un dígito cambiado: los errores de a uno son los que
    // pasan de verdad, y son los que una comprobación floja deja pasar.
    let colados = 0;
    for (let i = 0; i < firma.length; i++) {
        const otro = firma[i] === 'A' ? 'B' : 'A';
        const roto = `${pre}.${payload}.${firma.slice(0, i)}${otro}${firma.slice(i + 1)}`;
        if (verificar(roto, 'San Patricio 270').valido) colados++;
    }
    vale(`ninguna de las ${firma.length} firmas con un carácter cambiado pasa`, colados === 0,
        `Se colaron ${colados}.`);

    let coladosPayload = 0;
    for (let i = 0; i < payload.length; i++) {
        const otro = payload[i] === 'A' ? 'B' : 'A';
        const roto = `${pre}.${payload.slice(0, i)}${otro}${payload.slice(i + 1)}.${firma}`;
        if (verificar(roto, 'San Patricio 270').valido) coladosPayload++;
    }
    vale(`tocar los datos tampoco: ${payload.length} variantes, ninguna pasa`, coladosPayload === 0,
        `Se colaron ${coladosPayload}. Si pasa una, se puede estirar el vencimiento o cambiar de edificio.`);

    vale('un pase firmado con OTRA clave no abre',
        verificarPaseFirmado(
            emitirPaseFirmado({ edificio: 'San Patricio 270', vence: EN_UNA_HORA(), maestra: 'otra-clave' }),
            'San Patricio 270', Date.now(), CLAVE
        ).valido === false,
        'Quien no tenga el secreto no puede emitir pases.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El vencimiento');
// ─────────────────────────────────────────────────────────────────────────────
{
    const vence = Date.now() + 60 * 60 * 1000;
    const token = emitir({ edificio: 'San Patricio 270', vence });

    vale('antes de vencer, abre', verificar(token, 'San Patricio 270', vence - 60000).valido === true);
    vale('después de vencer, NO abre', verificar(token, 'San Patricio 270', vence + 120000).valido === false);
    vale('y lo dice como vencido, no como inválido',
        verificar(token, 'San Patricio 270', vence + 120000).resultado === 'rechazado_vencido',
        'Al vecino se le explica distinto un pase vencido que uno falso.');

    vale('un pase sin vencimiento no se emite', emitir({ edificio: 'San Patricio 270' }) === null,
        'Un pase sin vencimiento es un pase para siempre. Que lo decida quien lo emite.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Una clave por edificio, de un solo secreto');
// ─────────────────────────────────────────────────────────────────────────────
{
    const a = claveDelEdificio('San Patricio 270', CLAVE);
    const b = claveDelEdificio('San Patricio 159', CLAVE);

    vale('cada edificio tiene una clave distinta', a && b && !a.equals(b),
        'Un tótem comprometido no puede abrir los otros veintisiete.');

    vale('el mismo edificio escrito distinto da la MISMA clave',
        claveDelEdificio('san patricio 270', CLAVE).equals(a),
        'Si no, el pase emitido por el panel no lo valida el tótem.');

    vale('sin secreto maestro no hay clave', claveDelEdificio('San Patricio 270', '') === null);

    vale('sin secreto maestro NO se valida nada (falla cerrado)',
        verificarPaseFirmado(emitir({ edificio: 'San Patricio 270', vence: EN_UNA_HORA() }), 'San Patricio 270', Date.now(), '').valido === false,
        'Al revés que el webhook de Meta, y a propósito: acá fallar abierto es la puerta de calle.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) CANDADO: el fallback abierto no puede volver');
// ─────────────────────────────────────────────────────────────────────────────
{
    const fuente = fs.readFileSync(path.join(__dirname, 'porteria.js'), 'utf8');
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

    vale('nadie decide que un QR es válido por cómo empieza',
        !/startsWith\(\s*['"](?:PASS|MARCOS|EDIFICA)-/.test(codigo),
        'Ese prefijo lo escribe cualquiera. Era la puerta abierta cuando se caía la base.');

    vale('el camino sin base usa el pase firmado',
        /verificarPaseFirmado/.test(fuente));

    vale('con base, sigue decidiendo `validarConsumirPaseQR`',
        /validacion = await validarConsumirPaseQR\(/.test(codigo),
        'La firma no puede contradecir a la base: revocar tiene que seguir sirviendo.');

    // Que nadie vuelva a escribir la comparación por su cuenta: es lo que pasó con
    // `buscarPerfilEdificio`, donde arreglar una de las dos copias no cambió nada en producción.
    const otros = fs.readdirSync(__dirname)
        .filter(f => f.endsWith('.js') && !['qr-firmado.js', 'firma-webhook.js', 'clave-app.js'].includes(f) && !f.startsWith('pruebas-'))
        .filter(f => /createHmac\([^)]*\)[\s\S]{0,400}?(?:token|qr|pase)/i.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));

    vale('la verificación del pase está escrita en un solo lugar', otros.length === 0,
        otros.length ? `También parece calcularse en: ${otros.join(', ')}` : '');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Esto decide quién entra a un edificio cuando no hay internet.\n');
    process.exit(1);
}
console.log('\n   🎟️  Sin internet abre el pase bueno, y solo el pase bueno.\n');
