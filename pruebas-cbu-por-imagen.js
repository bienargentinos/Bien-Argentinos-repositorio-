// Verifica que los datos de cobro se tomen bien por las tres vías por las que llegan de verdad:
// escritos en el chat, en una constancia (foto o PDF), o al pie de la propia factura.
//
//   node pruebas-cbu-por-imagen.js
//
// Y sobre todo: que un CBU mal leído NO se guarde. Con OCR de por medio eso importa más que al
// tipear -- un 8 leído como 6 en una foto sacada de costado no lo ve nadie, y son 22 números
// seguidos. El dígito verificador es lo único que lo detecta.

const { validarCBU, validarAlias, buscarCBUEnTexto, buscarAliasEnTexto } = require('./cbu');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

function cbuValido(banco, sucursal, cuenta13) {
    const p1 = [7, 1, 3, 9, 7, 1, 3], p2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
    const dv = (d, p) => (10 - (p.reduce((a, w, i) => a + w * Number(d[i]), 0) % 10)) % 10;
    const b1 = banco + sucursal;
    return b1 + dv(b1, p1) + cuenta13 + dv(cuenta13, p2);
}
const CBU = cbuValido('007', '0059', '9300045678901');

console.log('\n── VÍA 1: ESCRITO EN EL CHAT ──');
verificar('mensaje típico del técnico',
    buscarCBUEnTexto(`Buenas, te paso el CBU para el pago: ${CBU}`)?.valido, true);
verificar('copiado del homebanking, con espacios',
    buscarCBUEnTexto(`CBU ${CBU.replace(/(.{4})/g, '$1 ').trim()}`)?.valido, true);
verificar('solo el alias',
    buscarAliasEnTexto('mi alias es dario.electricidad')?.alias, 'dario.electricidad');
verificar('alias con guion',
    buscarAliasEnTexto('Alias: juju-dario.arg')?.valido, true);

console.log('\n── VÍA 2: CONSTANCIA (foto o PDF), leída por el OCR ──');
// Lo que devuelve marcos-docs cuando reconoce una constancia de CBU.
const constanciaOk = { es_factura: false, es_datos_bancarios: true, cbu: CBU, alias: 'dario.electricidad', titular: 'Dario Juju', cuit: '20304050607' };
verificar('el CBU leído verifica', validarCBU(constanciaOk.cbu).valido, true);
verificar('el alias leído verifica', validarAlias(constanciaOk.alias).valido, true);

// Errores típicos del OCR sobre una foto: dígitos que se confunden entre sí.
const confusiones = [['8', '6'], ['1', '7'], ['5', '6'], ['0', '8'], ['3', '9'], ['2', '7']];
let detectadas = 0, probadas = 0;
for (const [a, b] of confusiones) {
    for (let i = 8; i < 22; i++) {
        if (CBU[i] !== a) continue;
        const malLeido = CBU.slice(0, i) + b + CBU.slice(i + 1);
        probadas++;
        if (!validarCBU(malLeido).valido) detectadas++;
    }
}
verificar(`detecta las ${probadas} confusiones de dígitos parecidos (8/6, 1/7, 5/6...)`, detectadas, probadas);

verificar('un CBU al que el OCR le comió un dígito no pasa',
    validarCBU(CBU.slice(0, 12) + CBU.slice(13)).valido, false);
verificar('un CBU al que el OCR le agregó un dígito no pasa',
    validarCBU(CBU.slice(0, 12) + '4' + CBU.slice(12)).valido, false);

console.log('\n── VÍA 3: AL PIE DE LA FACTURA ──');
// La factura sigue siendo factura, pero trae los datos de cobro. Es lo más común de todo.
const facturaConCBU = {
    es_factura: true, proveedor: 'Dario Juju', monto: '$85.000', numero_factura: '0001-00001234',
    cbu: CBU, alias: 'dario.electricidad', titular: 'Dario Juju',
};
verificar('sigue tratándose como factura', facturaConCBU.es_factura, true);
verificar('y el CBU del pie se puede usar', validarCBU(facturaConCBU.cbu).valido, true);

// Se cambia el último dígito por uno DISTINTO al que ya tenía: si se pone el mismo, el CBU
// sigue siendo el válido y la prueba no probaría nada.
const otroDigito = String((Number(CBU[21]) + 1) % 10);
const facturaCBURoto = { ...facturaConCBU, cbu: CBU.slice(0, 21) + otroDigito };
verificar('si el CBU del pie no verifica, no se guarda', validarCBU(facturaCBURoto.cbu).valido, false);

console.log('\n── LO QUE NO TIENE QUE CONFUNDIR ──');
verificar('el número de factura no es un CBU',
    buscarCBUEnTexto('Factura B 0001-00001234 por $85.000')?.valido ?? false, false);
verificar('un CUIT no es un CBU',
    validarCBU('20304050607').valido, false);
verificar('un teléfono no es un CBU',
    validarCBU('5491169241157').valido, false);
verificar('"gracias" no es un alias',
    buscarAliasEnTexto('gracias por avisar'), null);

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
