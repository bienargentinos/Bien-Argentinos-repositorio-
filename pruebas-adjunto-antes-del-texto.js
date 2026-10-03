// UN COMPROBANTE ADJUNTO MANDA SOBRE EL TEXTO QUE LO ACOMPAÑA
//
//   node pruebas-adjunto-antes-del-texto.js
//
// > [!CAUTION]
// > **La rama de "ya resolví" hace `return`, y la lógica que archiva facturas vive ~350 líneas más
// > abajo.** Un mensaje con texto Y adjunto se resolvía por el texto y el adjunto se perdía entero.
//
// EL CASO REAL (13/09). El técnico mandó *"Ya resolví... Listo quedó funcionando, con materiales y
// todo"* junto con la factura. En el log:
//
//     📨 Mensaje de 5491169241157: Ya resolvi... Listo quedó funcionando .. con materiales y todo
//     📨 Mensaje de 5491169241157: (Documento adjunto: 20273826212_011_00001_00000639.pdf)
//     ✅ Archivo descargado … 📁 Archivo permanente guardado … documentos/media_2274569776676342.pdf
//     ✅ El técnico Dario confirmó la visita.
//     📌 Confirmación del técnico registrada en [CASO-1002]
//
// Y después **ninguna** línea `🧾`. Ni la de "tomado como comprobante" ni la de "NO se trató como
// factura", que sale SIEMPRE que hay adjunto. O sea que el flujo no llegó nunca ahí. El comprobante
// N° 00001-00000639 no está en la planilla: quedó en el disco, en `documentos/`, como un archivo
// cualquiera. `revisar-facturas.js` mostraba una sola factura, la del 11/09.
//
// La MISMA rama causaba el otro síntoma. Palabras de Daniel: *"voy al edificio de al lado, justo
// sale el encargado y me dice podés ver esto, lo resuelvo, mando la factura… y no es del caso
// abierto, porque ese caso necesita material que no consigo. Marcos me puede cerrar un caso que no
// resolví"*.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

/** El bloque donde se decide si el mensaje cierra un caso. */
const bloque = (() => {
    const i = idx.indexOf('const diceQueSeResolvio =');
    assert.ok(i !== -1, 'no está la detección de "ya se resolvió"');
    return idx.slice(i, idx.indexOf('if (esGatilloResolucion)', i) + 40);
})();

console.log('\n── EL ADJUNTO SE ARCHIVA ANTES DE INTERPRETAR EL TEXTO ──');

prueba('el gatillo de cierre mira si viene un comprobante', () => {
    assert.ok(/traeComprobante/.test(bloque),
        'falta la condición del adjunto: sin ella la factura se pierde otra vez');
    assert.ok(/esGatilloResolucion\s*=\s*diceQueSeResolvio\s*&&\s*!loNiega\s*&&\s*!traeComprobante/.test(bloque),
        'el gatillo tiene que exigir que NO haya comprobante adjunto');
});

prueba('solo cuenta como comprobante un adjunto DE UN PROVEEDOR', () => {
    // La foto de una pérdida de agua mandada por un vecino es un RECLAMO, no una factura.
    // Tratarla como comprobante le robaría el reclamo, que es el criterio que ya está escrito en
    // `esFacturaODoc`.
    assert.ok(/rol === 'proveedor'/.test(bloque), 'el adjunto tiene que ser de un proveedor');
    assert.ok(/msgType === 'document' \|\| msgType === 'image'/.test(bloque),
        'un audio no es un comprobante');
});

prueba('queda dicho en el log cuando se suprime el cierre', () => {
    // Sin esta línea, la próxima vez habría que diagnosticar de cero por qué un "ya resolví" no
    // cerró el caso. Y es justo lo contrario de lo que uno espera al leer el código.
    assert.ok(/🧾➡️/.test(bloque), 'falta el aviso en el log');
    assert.ok(/NO se cierra ning[uú]n caso por este mensaje/.test(bloque));
});

console.log('\n── LO QUE NO SE TOCÓ, Y TIENE QUE SEGUIR IGUAL ──');

prueba('sin adjunto, "ya resolví" sigue disparando el cierre', () => {
    // El caso normal no cambia: el técnico avisa por texto que terminó y el caso se cierra como
    // antes. Este arreglo solo se mete cuando además hay un comprobante en juego.
    assert.ok(/diceQueSeResolvio\s*&&\s*!loNiega/.test(bloque),
        'las dos condiciones originales tienen que seguir mandando');
});

prueba('la negación sigue frenando el cierre', () => {
    // "Todavía no se resolvió" trae las mismas palabras que "ya se resolvió". Cerrar un caso que
    // sigue roto deja al vecino sin reclamo justo cuando más lo necesita.
    assert.ok(/loNiega/.test(bloque));
});

console.log('\n── CANDADO ──');

prueba('la lógica de facturas sigue estando DESPUÉS de esta rama', () => {
    // Este es el hecho que hace necesario el arreglo, y conviene que la prueba lo diga: si algún
    // día `esFacturaODoc` se mueve ARRIBA de acá, este candado deja de tener sentido y hay que
    // revisarlo en vez de borrarlo -- mover el archivado arriba sería la solución de fondo.
    const iGatillo = idx.indexOf('const diceQueSeResolvio =');
    const iFactura = idx.indexOf('const esFacturaODoc =');
    assert.ok(iFactura !== -1, 'no está la detección de comprobantes');
    assert.ok(iFactura > iGatillo,
        'el archivado de facturas ya NO está después del gatillo de cierre: revisar este candado, ' +
        'porque probablemente el problema se arregló de raíz y esta prueba sobra');
});

prueba('el diagnóstico que delata una factura no archivada sigue en pie', () => {
    // `🧾❔ NO se trató como factura…` es lo que permitió encontrar esto: su AUSENCIA probó que el
    // flujo nunca llegaba ahí. Si alguien lo borra, el próximo caso se diagnostica a ciegas.
    assert.ok(/🧾❔ NO se trató como factura/.test(idx),
        'sin esa línea, una factura perdida es indistinguible de una factura mal archivada');
});

console.log('');
if (fallos === 0) {
    console.log('✅ Un comprobante no se pierde por venir con un "ya resolví" pegado.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
