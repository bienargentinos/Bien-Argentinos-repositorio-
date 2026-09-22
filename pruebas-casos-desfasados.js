/**
 * UN CASO CERRADO DE UN SOLO LADO
 *
 * > [!CAUTION]
 * > **`copiarAPg` dispara y sigue: la escritura que falla se pierde para siempre.**
 *
 * Es a propósito --un PostgreSQL caído no puede romper el camino de Sheets, que es el que le
 * contesta a la persona-- pero el costo no estaba escrito: mientras PostgreSQL rechazó la
 * contraseña, **todo lo que se escribió en ese rato quedó de un solo lado**, y nada avisa.
 *
 * El CASO-1001 se cerró justo ahí. En la planilla figura `resuelto`; en PostgreSQL quedó `nuevo`.
 * Y el motor lee PostgreSQL primero, así que para Marcos ese caso sigue abierto: se lo puede
 * elegir como el caso activo del técnico, imputarle una factura, o contarlo entre los reclamos
 * del edificio.
 *
 * Lo que esta prueba cuida es la regla de la reparación, que no es simétrica:
 *
 *   - Sheets cerrado + PostgreSQL abierto → **se cierra solo**. Cerrar es siempre una acción
 *     explícita de alguien; que falte de un lado significa que no llegó del todo.
 *   - PostgreSQL cerrado + Sheets abierto → **NO se reabre**. Un caso reabierto por una
 *     herramienta le mete a la Administración un reclamo ya resuelto y reinicia el seguimiento
 *     contra un técnico que ya pasó.
 *
 * De los dos errores se elige el que se puede deshacer.
 *
 *     node pruebas-casos-desfasados.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { decidirCaso, compararCasos } = require('./casos-desfasados');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

const sh = (estado) => ({ id_evento: 'CASO-1001', estado, edificio: 'san patricio casa' });
const pg = (estado) => ({ codigo_caso: 'CASO-1001', estado, edificio: 'san patricio casa' });

console.log('\n🔀 UN CASO CERRADO DE UN SOLO LADO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) El caso real que originó esto');
// ─────────────────────────────────────────────────────────────────────────────
{
    const d = decidirCaso({ enSheets: sh('resuelto'), enPg: pg('nuevo') });
    vale('planilla "resuelto" + PostgreSQL "nuevo" → se cierra en PostgreSQL',
        d.accion === 'cerrar_en_pg', `Dio: ${d.accion}`);
    vale('…y el motivo explica que Marcos lo ve abierto',
        /Marcos lee PostgreSQL/.test(d.motivo), d.motivo);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Pero al revés NO se reabre, que es lo que importa');
// ─────────────────────────────────────────────────────────────────────────────
{
    for (const [enPgEstado, enShEstado] of [['resuelto', 'nuevo'], ['cerrado', 'en_proceso'], ['resuelto', '']]) {
        const d = decidirCaso({ enSheets: sh(enShEstado), enPg: pg(enPgEstado) });
        vale(`PostgreSQL "${enPgEstado}" + planilla "${enShEstado || '(vacío)'}" → lo decide una persona`,
            d.accion === 'revisar',
            `Dio: ${d.accion}. Reabrir solo le mete a la Administración un reclamo ya resuelto.`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) `cerrado` y `resuelto` son las dos formas de estar terminado');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('planilla "cerrado" + PostgreSQL "en_proceso" → se cierra',
        decidirCaso({ enSheets: sh('cerrado'), enPg: pg('en_proceso') }).accion === 'cerrar_en_pg');
    vale('planilla "Resuelto" con mayúscula también',
        decidirCaso({ enSheets: sh('Resuelto'), enPg: pg('nuevo') }).accion === 'cerrar_en_pg',
        'La comparación tiene que normalizar: en la planilla lo escribe una persona.');
    vale('y con espacios alrededor',
        decidirCaso({ enSheets: sh('  resuelto '), enPg: pg('nuevo') }).accion === 'cerrar_en_pg');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) Lo que dice lo mismo no se toca');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('los dos "nuevo" → nada', decidirCaso({ enSheets: sh('nuevo'), enPg: pg('nuevo') }).accion === null);
    vale('los dos "resuelto" → nada', decidirCaso({ enSheets: sh('resuelto'), enPg: pg('resuelto') }).accion === null);
    vale('"Resuelto" y "resuelto" son lo mismo',
        decidirCaso({ enSheets: sh('Resuelto'), enPg: pg('resuelto') }).accion === null,
        'Si no, la herramienta reportaría diferencias que no existen y se la dejaría de mirar.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Dos estados distintos y ninguno cerrado: se informa, no se elige');
// ─────────────────────────────────────────────────────────────────────────────
{
    const d = decidirCaso({ enSheets: sh('nuevo'), enPg: pg('en_proceso') });
    vale('no urge, pero no se adivina cuál gana', d.accion === 'revisar', `Dio: ${d.accion}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) Un caso que está de un lado nada más');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('solo en la planilla → el panel lo muestra y Marcos no lo ve',
        decidirCaso({ enSheets: sh('nuevo'), enPg: null }).accion === 'falta_en_sheets');
    vale('solo en PostgreSQL → Marcos lo ve y el panel no',
        decidirCaso({ enSheets: null, enPg: pg('nuevo') }).accion === 'falta_en_pg');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7) El cruce completo, como lo hace la herramienta');
// ─────────────────────────────────────────────────────────────────────────────
{
    const enSheets = [
        { id_evento: 'CASO-1001', estado: 'resuelto', edificio: 'a' },
        { id_evento: 'CASO-1003', estado: 'nuevo', edificio: 'a' },
        { id_evento: 'CASO-1004', estado: 'nuevo', edificio: 'a' },
        { id_evento: 'CASO-1009', estado: 'nuevo', edificio: 'a' },
    ];
    const enPg = [
        { codigo_caso: 'CASO-1001', estado: 'nuevo', edificio: 'a' },
        { codigo_caso: 'caso-1003', estado: 'nuevo', edificio: 'a' },   // misma clave, otra caja
        { codigo_caso: 'CASO-1004', estado: 'nuevo', edificio: 'a' },
        { codigo_caso: 'CASO-1010', estado: 'nuevo', edificio: 'a' },
    ];

    const r = compararCasos(enSheets, enPg);
    const por = (c) => r.find(x => x.caso === c);

    vale('solo aparecen los que difieren', r.length === 3,
        `Aparecieron ${r.length}: ${r.map(x => x.caso).join(', ')}`);
    vale('CASO-1001 se cierra', por('CASO-1001')?.accion === 'cerrar_en_pg');
    vale('CASO-1003 no aparece: `caso-1003` es el mismo caso',
        !por('CASO-1003'),
        'El código se compara normalizado; si no, cada diferencia de mayúsculas sería un falso desfase.');
    vale('CASO-1004 no aparece: los dos dicen lo mismo', !por('CASO-1004'));
    vale('CASO-1009 falta en PostgreSQL', por('CASO-1009')?.accion === 'falta_en_sheets');
    vale('CASO-1010 falta en la planilla', por('CASO-1010')?.accion === 'falta_en_pg');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8) La herramienta nunca reabre un caso');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Candado estructural: el único UPDATE de `emparejar-casos.js` tiene que salir de la lista de
    // `cerrar_en_pg`. Si mañana alguien lo hace correr sobre `aRevisar`, esto se pone en rojo.
    const tool = fs.readFileSync(path.join(__dirname, 'emparejar-casos.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

    const updates = tool.match(/UPDATE\s+\w+/gi) || [];
    vale('hay un solo UPDATE en toda la herramienta', updates.length === 1,
        `Hay ${updates.length}: ${updates.join(', ')}`);

    vale('y recorre `aCerrar`, no las diferencias completas',
        /for\s*\(const d of aCerrar\)/.test(tool),
        'Aplicarlo sobre todas las diferencias reabriría casos ya resueltos.');

    vale('el estado se copia de la planilla, no es una palabra fija',
        /d\.enSheets\.estado/.test(tool),
        'Escribir `resuelto` cuando la planilla dice `cerrado` crea una tercera versión de la verdad.');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Un caso cerrado de un solo lado deja a Marcos creyendo que sigue abierto.\n');
    process.exit(1);
}
console.log('\n   🔀 Se cierra lo que quedó a medias, y no se reabre nada.\n');
