// Verifica el reconocimiento y la validación de CBU y alias.
//
//   node pruebas-cbu.js
//
// Lo importante no es que acepte un CBU bueno: es que RECHACE uno con un dígito cambiado o dos
// dígitos dados vuelta. Ese es el error real -- el técnico lo dicta por audio o lo copia a mano,
// y 22 números seguidos no se revisan de un vistazo. Un CBU mal guardado termina en un pago
// rechazado, o peor, en un pago a otra cuenta.

const { validarCBU, validarAlias, buscarCBUEnTexto, buscarAliasEnTexto, ultimos4 } = require('./cbu');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// ── Un CBU válido, armado con el mismo cálculo del BCRA ─────────────────────────────────────
// Se construye en vez de copiar uno real: así la prueba no lleva datos bancarios de nadie.
function armarCBUValido(banco, sucursal, cuenta13) {
    const p1 = [7, 1, 3, 9, 7, 1, 3];
    const p2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
    const dv = (d, p) => (10 - (p.reduce((a, w, i) => a + w * Number(d[i]), 0) % 10)) % 10;
    const b1 = banco + sucursal;
    const bloque1 = b1 + dv(b1, p1);
    const bloque2 = cuenta13 + dv(cuenta13, p2);
    return bloque1 + bloque2;
}

const CBU_OK = armarCBUValido('007', '0059', '9300045678901');

console.log('\n── CBU BIEN ESCRITO ──');
verificar(`acepta un CBU válido (${CBU_OK})`, validarCBU(CBU_OK).valido, true);
verificar('lo acepta con espacios cada 4 dígitos',
    validarCBU(CBU_OK.replace(/(.{4})/g, '$1 ').trim()).valido, true);
verificar('lo acepta con guiones', validarCBU(CBU_OK.replace(/(.{4})/g, '$1-')).valido, true);
verificar('reconoce el banco', validarCBU(CBU_OK).banco, '007');

console.log('\n── LO QUE TIENE QUE RECHAZAR (para esto existe) ──');
// Un dígito cambiado en cada posición del bloque de cuenta.
let detectados = 0, probados = 0;
for (let pos = 8; pos < 22; pos++) {
    for (let d = 0; d <= 9; d++) {
        if (String(d) === CBU_OK[pos]) continue;
        const roto = CBU_OK.slice(0, pos) + d + CBU_OK.slice(pos + 1);
        probados++;
        if (!validarCBU(roto).valido) detectados++;
    }
}
verificar(`detecta los ${probados} casos de un dígito cambiado`, detectados, probados);

// Dos dígitos dados vuelta: el error clásico al copiar a mano.
let transp = 0, transpDetectadas = 0;
for (let i = 8; i < 21; i++) {
    if (CBU_OK[i] === CBU_OK[i + 1]) continue;
    const dadoVuelta = CBU_OK.slice(0, i) + CBU_OK[i + 1] + CBU_OK[i] + CBU_OK.slice(i + 2);
    transp++;
    if (!validarCBU(dadoVuelta).valido) transpDetectadas++;
}
verificar(`detecta las ${transp} transposiciones de dígitos vecinos`, transpDetectadas, transp);

verificar('rechaza uno con 21 dígitos', validarCBU(CBU_OK.slice(0, 21)).valido, false);
verificar('rechaza uno con 23 dígitos', validarCBU(CBU_OK + '5').valido, false);
verificar('rechaza texto sin números', validarCBU('mi cbu es el del banco').valido, false);
verificar('explica por qué falla la longitud',
    validarCBU('123').motivo.includes('22'), true);

console.log('\n── ENCONTRARLO EN UN MENSAJE DE VERDAD ──');
verificar('lo encuentra escrito de corrido',
    buscarCBUEnTexto(`Hola, te paso mi CBU ${CBU_OK} para el pago`)?.cbu, CBU_OK);
verificar('lo encuentra con espacios',
    buscarCBUEnTexto(`CBU: ${CBU_OK.replace(/(.{4})/g, '$1 ')}`)?.cbu, CBU_OK);
verificar('no inventa uno donde no hay',
    buscarCBUEnTexto('mañana paso por el edificio a las 3'), null);
verificar('no confunde un número de factura largo',
    buscarCBUEnTexto('factura 0001-00012345')?.valido ?? false, false);
verificar('cuando el número está mal, lo devuelve igual para poder explicarlo',
    buscarCBUEnTexto(`mi cbu es ${CBU_OK.slice(0, 21)}9`)?.valido, false);

console.log('\n── ALIAS ──');
verificar('acepta un alias normal', validarAlias('juan.perez.ok').valido, true);
verificar('lo guarda en minúscula', validarAlias('JUAN.PEREZ.OK').alias, 'juan.perez.ok');
verificar('rechaza uno muy corto', validarAlias('ju.pe').valido, false);
verificar('rechaza uno muy largo', validarAlias('a'.repeat(21)).valido, false);
verificar('rechaza uno con espacios', validarAlias('juan perez').valido, false);
verificar('rechaza uno con acentos', validarAlias('martín.gómez').valido, false);
verificar('lo encuentra cuando lo nombran',
    buscarAliasEnTexto('te paso el alias juan.perez.ok')?.alias, 'juan.perez.ok');
verificar('lo encuentra con dos puntos',
    buscarAliasEnTexto('Alias: electricidad.dario')?.alias, 'electricidad.dario');
verificar('NO busca alias si nadie lo nombró',
    buscarAliasEnTexto('gracias por avisarme, mañana paso'), null);

console.log('\n── CONFIRMACIÓN ──');
verificar('devuelve los últimos 4 para confirmar sin repetir los 22',
    ultimos4(CBU_OK), CBU_OK.slice(-4));

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
