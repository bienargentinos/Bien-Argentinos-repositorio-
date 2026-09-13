// "1002 CASO" ES UNA RESPUESTA, Y EL SELECTOR NO LA ENTENDÍA
//
//   node pruebas-numero-de-caso.js
//
// > [!CAUTION]
// > **La lista imprime `[CASO-1001]` y después pide "1 o 2": invita justo a la respuesta que no
// > sabía leer.**
//
// EL CASO REAL (13/09). Marcos le mostró al técnico los casos abiertos para que dijera cuál había
// resuelto. Él contestó **"1002 caso"**. El selector hacía:
//
//     const numSel = parseInt(msgClean.replace(/\D/g, ''), 10);   // -> 1002
//     if (numSel >= 1 && numSel <= casosP.length) { ... }         // 1002 <= 2 es falso
//
// No matcheó, el mensaje cayó a la rama del proveedor, y ahí se contestó *"Confirmado el CASO-1002…
// Le abrirá Agus Fuego"* -- el contacto de ingreso, que no tenía nada que ver. **El caso quedó
// abierto**, y a las diez horas la cadena de seguimiento le preguntó al técnico, después al vecino,
// y terminó mandándole un mail al administrador por un trabajo hecho y facturado.
//
// Es el MISMO defecto que ya está documentado en CLAUDE.md para la imputación de una factura: allá
// la condición pedía `CASO` pegado adelante y la lista pedía UN dígito. Se arregló ahí y quedó sin
// arreglar acá, porque cada rama tenía su propio lector.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { numeroDeCasoEnTexto, casoElegidoDeLista } = require('./numero-de-caso');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

console.log('\n── LAS FORMAS EN QUE UNA PERSONA DICE UN NÚMERO DE CASO ──');

prueba('la forma canónica', () => {
    for (const t of ['CASO 1002', 'caso-1002', 'es del caso: 1002', 'CASO1002', 'el caso 1002']) {
        assert.strictEqual(numeroDeCasoEnTexto(t), '1002', t);
    }
});

prueba('el número ADELANTE, que es la que faltaba', () => {
    assert.strictEqual(numeroDeCasoEnTexto('1002 caso'), '1002');
    assert.strictEqual(numeroDeCasoEnTexto('1001 es el caso'), '1001');
    assert.strictEqual(numeroDeCasoEnTexto('el 1003 es el caso'), '1003');
});

prueba('el número pelado de 3 dígitos o más', () => {
    // A esta altura Marcos ya preguntó de qué caso se trata: "1002" a secas no puede ser otra cosa.
    assert.strictEqual(numeroDeCasoEnTexto('1002'), '1002');
    assert.strictEqual(numeroDeCasoEnTexto('#1002'), '1002');
    assert.strictEqual(numeroDeCasoEnTexto('  1002  '), '1002');
});

prueba('los ceros de adelante no cambian el caso', () => {
    assert.strictEqual(numeroDeCasoEnTexto('CASO-0001002'), '1002');
});

console.log('\n── LO QUE NO ES UN NÚMERO DE CASO ──');

prueba('un número de 1 o 2 dígitos solo NO es un caso', () => {
    // "2" contestado a una lista de dos opciones es la posición, no el CASO-2.
    assert.strictEqual(numeroDeCasoEnTexto('2'), null);
    assert.strictEqual(numeroDeCasoEnTexto('el 1'), null);
});

prueba('un texto sin números no es nada', () => {
    assert.strictEqual(numeroDeCasoEnTexto('el de la bomba de agua'), null);
    assert.strictEqual(numeroDeCasoEnTexto(''), null);
    assert.strictEqual(numeroDeCasoEnTexto(undefined), null);
});

console.log('\n── ELEGIR DE LA LISTA QUE MARCOS OFRECIÓ ──');

const casos = [
    { id_evento: 'CASO-1001', problema: 'puerta de entrada sin energia' },
    { id_evento: 'CASO-1002', problema: 'bomba de agua rota' },
];

prueba('contesta con el número de caso', () => {
    // Este es el que falló en producción.
    assert.strictEqual(casoElegidoDeLista('1002 caso', casos)?.id_evento, 'CASO-1002');
    assert.strictEqual(casoElegidoDeLista('CASO-1001', casos)?.id_evento, 'CASO-1001');
    assert.strictEqual(casoElegidoDeLista('1001 es el caso', casos)?.id_evento, 'CASO-1001');
});

prueba('contesta con la posición de la lista', () => {
    // Lo que la pregunta pide literalmente. Tiene que seguir andando.
    assert.strictEqual(casoElegidoDeLista('1', casos)?.id_evento, 'CASO-1001');
    assert.strictEqual(casoElegidoDeLista('el 2', casos)?.id_evento, 'CASO-1002');
});

prueba('el CÓDIGO se mira antes que la posición', () => {
    // Un código es una respuesta inequívoca; una posición depende de cómo se armó la lista.
    const alRevés = [casos[1], casos[0]];   // 1️⃣ es el 1002, 2️⃣ es el 1001
    assert.strictEqual(casoElegidoDeLista('1002', alRevés)?.id_evento, 'CASO-1002');
});

prueba('un caso que NO está en la lista no se elige', () => {
    // Si nombra el 1003 y la lista tiene 1001 y 1002, no hay respuesta: hay que volver a preguntar.
    assert.strictEqual(casoElegidoDeLista('1003 caso', casos), null);
});

prueba('una respuesta que no dice nada devuelve null', () => {
    // Devolver null es lo correcto: ahí corresponde repreguntar, no cerrar uno al azar.
    assert.strictEqual(casoElegidoDeLista('ya está', casos), null);
    assert.strictEqual(casoElegidoDeLista('', casos), null);
    assert.strictEqual(casoElegidoDeLista('5', casos), null, 'la posición 5 no existe en una lista de 2');
});

prueba('con la lista vacía no explota', () => {
    assert.strictEqual(casoElegidoDeLista('1002', []), null);
    assert.strictEqual(casoElegidoDeLista('1002', null), null);
});

console.log('\n── CANDADOS ──');

const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

prueba('el selector usa el lector compartido', () => {
    const i = idx.indexOf('session.esperandoSeleccionCasoResuelto && Array.isArray');
    const bloque = idx.slice(i, i + 1800);
    assert.ok(/casoElegidoDeLista/.test(bloque), 'el selector tiene que usar el lector compartido');
    assert.ok(!/numSel\s*=\s*parseInt/.test(bloque),
        'volvió el parseInt que no entendía "1002 caso"');
});

prueba('no quedaron dos lectores del número de caso', () => {
    // La razón de que esto viva en un archivo: la rama de facturas ya lo tenía bien y el selector
    // mal. Dos copias del mismo criterio es lo que pasó con `buscarPerfilEdificio`, donde arreglar
    // una no cambió nada en producción.
    const copias = (idx.match(/\\b0\*\(\\d\{3,\}\)\\b\(\?=/g) || []).length;
    assert.strictEqual(copias, 0,
        'la expresión del "número adelante" volvió a `index.js`: tiene que estar solo en numero-de-caso.js');
});

prueba('cuando no se entiende, queda dicho en el log', () => {
    // La ventana es holgada a propósito: el bloque lleva bastante comentario explicando el caso
    // real, y una ventana justa hacía fallar esta prueba con el código ya arreglado. Una prueba que
    // grita sin motivo termina ignorada.
    const i = idx.indexOf('session.esperandoSeleccionCasoResuelto && Array.isArray');
    const bloque = idx.slice(i, i + 3000);
    assert.ok(/🔢/.test(bloque) && /en vez de cerrar uno al azar/.test(bloque),
        'sin esta línea, una respuesta no entendida es invisible');
});

console.log('');
if (fallos === 0) {
    console.log('✅ "1002 caso" cierra el CASO-1002, y lo que no se entiende se vuelve a preguntar.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
