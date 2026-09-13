// UNA CORRECCIÓN SE APLICA, NO SE AGRADECE
//
//   node pruebas-correccion-de-caso.js
//
// > [!CAUTION]
// > **`corrige_a_marcos` existía SOLO en el catálogo del ruteo, sin una línea de código que la
// > atendiera.** El modelo se disculpaba y el estado no cambiaba, que es peor que no entender:
// > desde afuera parece que sí.
//
// EL CASO REAL (13/09). El técnico cerró el CASO-1002, mandó la factura, y Marcos la asoció al
// CASO-1003 --un caso espurio que se había abierto por confusión, "como el hijo del 1002"--. Él
// corrigió tres veces:
//
//     Daniel: "1002 es el caso"
//     Marcos: "gracias por la aclaración, el caso que estamos gestionando es el 1003"
//     Daniel: (corrige otra vez)
//     Marcos: (sigue con el 1003)
//
// Por qué importa, en palabras de Daniel: *"puede haber enviado dos facturas al mismo caso, una del
// proveedor por materiales y la otra por el arreglo generada por mí"*. El gasto de un consorcio
// queda mal atribuido y no se nota hasta comparar con los papeles.
//
// Y `imputarFacturaSinEdificio` no servía para arreglarlo: solo toca facturas con estado "sin
// imputar". Una factura ya pegada al caso equivocado se quedaba ahí para siempre.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const sh = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');
const dt = fs.readFileSync(path.join(__dirname, 'datos.js'), 'utf8');

const rama = (() => {
    const i = idx.indexOf("ruteoIA?.intencion === 'corrige_a_marcos'");
    assert.ok(i !== -1, 'no existe la rama que atiende la corrección');
    return idx.slice(i - 2200, i + 3500);
})();

console.log('\n── LA CORRECCIÓN TIENE UNA RAMA DE CÓDIGO ──');

prueba('la intención ya no está solo en el catálogo del ruteo', () => {
    // Este era el defecto entero: una intención que se reconoce y no tiene consecuencia.
    const ruteo = fs.readFileSync(path.join(__dirname, 'ruteo-proveedor.js'), 'utf8');
    assert.ok(/corrige_a_marcos/.test(ruteo), 'la intención tiene que seguir en el catálogo');
    assert.ok(/corrige_a_marcos/.test(idx), 'y ahora también tiene que estar atendida en index.js');
});

prueba('el caso activo de la conversación se cambia', () => {
    assert.ok(/stCorr\.eventoActivoId = casoDicho\.id_evento/.test(rama),
        'sin esto la próxima vuelta vuelve a leer el caso viejo');
});

prueba('la factura se MUEVE al caso corregido', () => {
    assert.ok(/reimputarUltimaFacturaAlCaso/.test(rama),
        'cambiar solo el caso activo deja la factura donde estaba, o sea la plata mal atribuida');
});

prueba('la respuesta dice qué cambió, no "gracias por la aclaración"', () => {
    assert.ok(/movida\.desde/.test(rama) && /movida\.hacia/.test(rama),
        'el técnico tiene que poder verificar que se aplicó');
});

console.log('\n── LO QUE NO SE TOCA, PORQUE MUEVE PLATA ──');

prueba('una corrección SIN número de caso no cambia nada', () => {
    // "No, te equivocaste" no alcanza para elegir otro caso, y elegirlo a ciegas mueve un gasto de
    // un consorcio a otro.
    assert.ok(/numeroDeCasoEnTexto/.test(rama), 'tiene que exigir que nombre un caso');
    assert.ok(/no nombró ningún caso/.test(rama), 'y decirlo en el log');
});

prueba('un caso que NO es del técnico no se toca', () => {
    // Mover una factura a un caso de otro técnico es mandarle el gasto a otro consorcio.
    assert.ok(/esSuyo/.test(rama), 'falta comprobar que el caso sea suyo');
    assert.ok(/no figura como suyo/.test(rama), 'y decirlo en el log');
});

prueba('un caso que no existe tampoco', () => {
    assert.ok(/que no existe/.test(rama));
});

prueba('la comprobación de "es suyo" puede usar el teléfono', () => {
    // El nombre de un proveedor se edita desde el panel, así que comparar nombres es comparar dos
    // textos que pueden haber quedado distintos. `buscarCasoPorCodigo` ahora devuelve el teléfono.
    const pg = fs.readFileSync(path.join(__dirname, 'datos-pg.js'), 'utf8');
    const i = pg.indexOf('async function buscarCasoPorCodigo');
    const fn = pg.slice(i, pg.indexOf('\n}', i));
    assert.ok(/tel_tecnico:/.test(fn), 'el caso tiene que exponer el teléfono del técnico');
    assert.ok(/tel_tecnico/.test(rama), 'y la rama tiene que usarlo');
});

console.log('\n── MOVER LA FACTURA ──');

prueba('solo mueve UNA, la última de ese proveedor', () => {
    const i = sh.indexOf('async function reimputarUltimaFacturaAlCaso');
    const fn = sh.slice(i, sh.indexOf('\n}\n\nasync function imputarFacturaSinEdificio', i));
    assert.ok(/suyas\[suyas\.length - 1\]/.test(fn),
        'mover más de una por una corrección sería adivinar');
});

prueba('si ya estaba en el caso bueno, no escribe', () => {
    const i = sh.indexOf('async function reimputarUltimaFacturaAlCaso');
    const fn = sh.slice(i, sh.indexOf('\n}\n\nasync function imputarFacturaSinEdificio', i));
    assert.ok(/ya estaba bien/.test(fn), 'un viaje a Google de más en cada mensaje');
});

prueba('deja dicho en el log de dónde a dónde', () => {
    const i = sh.indexOf('async function reimputarUltimaFacturaAlCaso');
    const fn = sh.slice(i, sh.indexOf('\n}\n\nasync function imputarFacturaSinEdificio', i));
    assert.ok(/🧾↔️/.test(fn) && /movida\.desde/.test(fn),
        'sin esto, un gasto que cambió de consorcio es invisible');
});

prueba('escribe en las DOS bases, y los DOS nombres del campo', () => {
    // El motor escribe `id_evento` y el alta manual del panel `codigo_caso`. Escribir uno solo deja
    // la corrección invisible de un lado.
    const i = dt.indexOf('async function reimputarUltimaFacturaAlCaso');
    const fn = dt.slice(i, dt.indexOf('\n}', dt.indexOf('copiarAPg', i)));
    assert.ok(/sheets\.reimputarUltimaFacturaAlCaso/.test(fn), 'falta el lado de Sheets');
    assert.ok(/UPDATE facturas SET id_evento = \$1, codigo_caso = \$1/.test(fn),
        'falta PostgreSQL, o falta uno de los dos nombres del campo');
});

prueba('identifica la factura por número + proveedor', () => {
    // Es lo único estable de una factura entre las dos bases, y es la misma clave que usa la
    // deduplicación. La fecha, el monto y el edificio cambian.
    const i = dt.indexOf('async function reimputarUltimaFacturaAlCaso');
    const fn = dt.slice(i, dt.indexOf('\n}', dt.indexOf('copiarAPg', i)));
    assert.ok(/numero_factura = \$3/.test(fn) && /proveedor/.test(fn));
});

console.log('');
if (fallos === 0) {
    console.log('✅ Cuando el técnico corrige el caso, la factura se mueve y se le dice qué cambió.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
