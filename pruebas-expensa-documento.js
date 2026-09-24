/**
 * EL TOTAL DE UNA EXPENSA LO VA A PAGAR UNA PERSONA
 *
 * > [!CAUTION]
 * > **Un número sacado por OCR que el vecino lee como "lo que debo" es plata de alguien real.**
 *
 * No es el mismo riesgo que una factura de un técnico: ahí el número lo mira el administrador
 * antes de pagar. Acá lo lee alguien que va a transferir, y el error tiene dos formas, las dos
 * invisibles: de menos, paga de menos y queda en deuda sin saberlo; de más, paga de más y hay que
 * devolverle.
 *
 * De los dos errores posibles --mostrar un número equivocado, o no mostrar ninguno-- el segundo
 * es el que se puede deshacer. **Sin confianza no se muestra número**: queda el documento, que es
 * la verdad, a un toque de distancia.
 *
 * Esta prueba cubre las tres formas de equivocarse que ya conocemos:
 *   1. leer "85.420,50" como 85 --el separador de miles argentino--,
 *   2. afirmar un total que el propio lector dijo que no se leía bien,
 *   3. mostrarle a un vecino la expensa de otra unidad.
 *
 *     node pruebas-expensa-documento.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { montoANumero, montoConfiable, normalizarUnidad, mismaUnidad,
        tipoRealDelArchivo, motivoDeLaFalla } = require('./expensa-documento');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n💸 EL TOTAL DE UNA EXPENSA LO VA A PAGAR UNA PERSONA\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) El punto de los miles, que es el que arruina la cifra entera');
// ─────────────────────────────────────────────────────────────────────────────
{
    // `parseFloat("85.420,50")` devuelve 85. No es un redondeo: es otra cifra, mil veces menor.
    const casos = [
        ['$85.420,50',      85420.50],
        ['85.420,50',       85420.50],
        ['$ 85.420',        85420],
        ['85420',           85420],
        ['$1.234.567,89',   1234567.89],
        ['ARS 47.300',      47300],
        ['$47.300,00 ARS',  47300],
        // Formato con coma de miles (a veces el sistema del administrador exporta así).
        ['85,420.50',       85420.50],
        ['1,234,567.89',    1234567.89],
        // Un decimal con coma y sin miles.
        ['9500,75',         9500.75],
        // Tres dígitos detrás de la coma son miles, no milésimas: 85,420 es ochenta y cinco mil.
        ['85,420',          85420],
        [47300,             47300],
    ];
    for (const [texto, esperado] of casos) {
        const r = montoANumero(texto);
        vale(`${JSON.stringify(texto)} → ${esperado}`, r === esperado, `Dio: ${r}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Lo que NO es un número se dice que no lo es, y no se inventa un 0');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Un 0 es una afirmación --"no debés nada"-- distinta de "no lo pude leer".
    for (const v of ['', null, undefined, 'no figura', '$', '  ', {}]) {
        vale(`${JSON.stringify(v)} → null`, montoANumero(v) === null, `Dio: ${montoANumero(v)}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Cuándo se le muestra el número a un vecino');
// ─────────────────────────────────────────────────────────────────────────────
{
    const bueno = { es_expensa: true, total: '$85.420,50', total_legible: true };
    const r = montoConfiable(bueno);
    vale('una lectura buena se muestra', r.mostrar === true && r.monto === 85420.50, JSON.stringify(r));

    // Lo central: el lector puede decir que no está seguro, y eso manda.
    const dudoso = { es_expensa: true, total: '$85.420,50', total_legible: false };
    vale('si el lector dice que el total no se lee bien, NO se muestra',
        montoConfiable(dudoso).mostrar === false,
        'Sin esto, la única señal sería que el número "parezca raro" — y uno equivocado casi ' +
        'siempre parece razonable.');

    vale('…y el motivo lo explica',
        /no se lee con claridad/.test(montoConfiable(dudoso).motivo),
        montoConfiable(dudoso).motivo);

    // Un cero casi siempre es una lectura fallida, y es la afirmación más peligrosa de todas.
    vale('un total de 0 no se muestra',
        montoConfiable({ es_expensa: true, total: '$0', total_legible: true }).mostrar === false,
        'Decirle a alguien que no debe nada cuando sí debe es el peor de los errores posibles.');

    // Un número enorme suele ser dos campos pegados o un CUIT leído como importe.
    vale('un total absurdamente alto tampoco',
        montoConfiable({ es_expensa: true, total: '$20300456789', total_legible: true }).mostrar === false);

    vale('sin total no se muestra nada',
        montoConfiable({ es_expensa: true, total: '', total_legible: true }).mostrar === false);

    vale('si no es una expensa, tampoco',
        montoConfiable({ es_expensa: false }).mostrar === false);

    vale('y una lectura que falló entera, menos',
        montoConfiable(null).mostrar === false);

    // Y cuando no se muestra, el monto viene en null: nunca un número "tentativo" que alguien
    // aguas abajo pueda terminar mostrando igual.
    for (const malo of [null, { es_expensa: false }, { es_expensa: true, total: '$0' }]) {
        vale(`${JSON.stringify(malo)} devuelve monto null`, montoConfiable(malo).monto === null);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) La unidad: escrita de seis formas, y es la misma');
// ─────────────────────────────────────────────────────────────────────────────
{
    // El vecino tiene su unidad cargada por una persona; el documento la trae del sistema de
    // expensas del administrador. Si no coinciden, no ve su expensa y no hay ningún error.
    const mismas = [
        ['1° A', '1A'], ['1° A', '1 A'], ['1° A', 'Depto 1 A'], ['1°A', 'dto 1a'],
        ['PB 2', 'pb2'], ['4° C', '4C'], ['1° A', 'Unidad 1A'], ['3º B', '3B'],
    ];
    for (const [a, b] of mismas) {
        vale(`"${a}" = "${b}"`, mismaUnidad(a, b), `normalizadas: "${normalizarUnidad(a)}" vs "${normalizarUnidad(b)}"`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Pero distintas son DISTINTAS, que es lo que evita mostrar la deuda ajena');
// ─────────────────────────────────────────────────────────────────────────────
{
    const distintas = [
        ['1° A', '1° B'], ['1A', '11A'], ['1A', '1'], ['4° C', '14° C'], ['PB 1', 'PB 2'],
    ];
    for (const [a, b] of distintas) {
        vale(`"${a}" ≠ "${b}"`, !mismaUnidad(a, b),
            'Mostrarle a un vecino la expensa de otro es peor que no mostrarle ninguna.');
    }

    // La falta de dato NO es un comodín. Es el mismo agujero que tenía el timbre con `!edNorm`:
    // que falte un dato es la condición normal de un formulario a medias, no una autorización.
    for (const [a, b] of [['', '1A'], ['1A', ''], ['', ''], [null, '1A'], ['1A', undefined]]) {
        vale(`sin dato (${JSON.stringify(a)}, ${JSON.stringify(b)}) NO coincide`, !mismaUnidad(a, b));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) Candados estructurales');
// ─────────────────────────────────────────────────────────────────────────────
{
    const fuente = fs.readFileSync(path.join(__dirname, 'expensa-documento.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    // `leerExpensa` tiene que aplicar la decisión por su cuenta. Si devolviera el monto crudo y
    // dejara la decisión al llamador, alcanzaría con que UNO se olvide de consultarla.
    vale('`leerExpensa` aplica `montoConfiable`, no la deja para el llamador',
        /montoConfiable\(/.test(fuente),
        'Una regla que hay que acordarse de consultar es una regla que alguien se va a saltear.');

    vale('y devuelve `mostrar_monto`, para que nadie tenga que deducirlo',
        /mostrar_monto/.test(fuente));

    // Nunca `parseFloat` sobre un monto: es el bug del separador de miles.
    vale('no se usa parseFloat sobre los importes',
        !/parseFloat/.test(fuente),
        'parseFloat("85.420,50") devuelve 85.');

    // Las columnas tienen que estar en las DOS bases o el dato se pierde de un lado.
    const pg = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');
    for (const col of ['departamento', 'monto', 'vencimiento', 'monto_origen']) {
        vale(`PostgreSQL tiene expensas.${col}`,
            new RegExp(`ALTER TABLE expensas ADD COLUMN IF NOT EXISTS ${col}\\b`).test(pg));
    }

    const necesarias = require('./columnas-necesarias');
    for (const col of ['departamento', 'monto', 'vencimiento', 'monto_origen']) {
        vale(`Sheets espera expensas.${col}`,
            (necesarias.expensas || []).includes(col),
            'Sin la columna, `appendRow` descarta el dato EN SILENCIO — como pasó con tel_tecnico.');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7) Un HTML guardado con extensión .pdf no engaña a nadie');
// ─────────────────────────────────────────────────────────────────────────────
{
    // > [!CAUTION]
    // > **El navegador informa el tipo por la EXTENSIÓN, no por el contenido.**
    //
    // Primera prueba real: las cuatro expensas salieron sin unidad, sin período y con total 0.00.
    // En el log estaba la respuesta exacta de la IA --`The document has no pages`, o sea que el
    // archivo no era un PDF-- pero eso vive en el servidor, y quien carga cuarenta archivos mira
    // la pantalla. En la pantalla decía "no se pudo leer el documento": un motivo que manda a
    // buscar el problema al lugar equivocado.
    //
    // Los primeros bytes no mienten, y mirarlos ahorra además una llamada a la IA por archivo.
    const B = (s) => Buffer.from(s, 'latin1');

    vale('un PDF de verdad es `pdf`', tipoRealDelArchivo(B('%PDF-1.7\n1 0 obj')) === 'pdf');
    vale('una página guardada es `html`', tipoRealDelArchivo(B('<!DOCTYPE html>\n<html>')) === 'html');
    vale('…aunque arranque con espacios o BOM',
        tipoRealDelArchivo(Buffer.from('﻿   <html lang="es">', 'utf8')) === 'html');
    vale('un archivo de 0 bytes es `vacio`', tipoRealDelArchivo(Buffer.alloc(0)) === 'vacio');

    // Las imágenes se aceptan: una foto de la liquidación es una forma legítima de subirla.
    vale('un JPEG es `imagen`', tipoRealDelArchivo(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])) === 'imagen');
    vale('un PNG es `imagen`',
        tipoRealDelArchivo(Buffer.concat([Buffer.from([0x89]), B('PNG\r\n')])) === 'imagen');

    vale('cualquier otra cosa es `desconocido`', tipoRealDelArchivo(B('MZ\x90\x00binario')) === 'desconocido');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8) El motivo del fallo dice qué hacer, no solo que falló');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Un diagnóstico que hay que ir a buscar al log es medio diagnóstico.
    const real = new Error('{"error":{"code":400,"message":"The document has no pages.","status":"INVALID_ARGUMENT"}}');
    vale('"no pages" explica que no es un PDF y cómo arreglarlo',
        /Ctrl\+P|Guardar como PDF/i.test(motivoDeLaFalla(real)), motivoDeLaFalla(real));

    vale('la falta de clave se dice como falta de configuración',
        /clave|configurado/i.test(motivoDeLaFalla(new Error('API key not valid'))));
    vale('el techo de pedidos invita a reintentar',
        /de nuevo|rato/i.test(motivoDeLaFalla(new Error('429 RESOURCE_EXHAUSTED'))));
    vale('un corte de red se distingue',
        /conexi[oó]n|contactar/i.test(motivoDeLaFalla(new Error('ETIMEDOUT'))));

    // Y lo que no se reconoce no se disfraza de diagnóstico.
    vale('lo desconocido se admite como desconocido',
        motivoDeLaFalla(new Error('algo rarísimo')) === 'no se pudo leer el documento');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Un total mal leído hace que alguien pague de menos y quede en deuda sin saberlo.\n');
    process.exit(1);
}
console.log('\n   💸 Si no se puede afirmar el número, queda el documento y nada más.\n');
