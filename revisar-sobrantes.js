#!/usr/bin/env node
// QUÉ HAY EN POSTGRESQL QUE YA NO ESTÁ EN LA PLANILLA (Y AL REVÉS)
//
//   node revisar-sobrantes.js                      todas las tablas de configuración
//   node revisar-sobrantes.js proveedor_asignaciones
//
// SOLO LEE. No borra ni escribe nada, a propósito: lo que compara es **configuración** --clientes,
// edificios, proveedores, asignaciones-- y ahí un borrado automático es exactamente lo que no
// queremos. Dice qué hay de más y lo deja a la vista para decidir.
//
// > [!CAUTION]
// > **La sincronización entre Sheets y PostgreSQL solo AGREGA.** `importar-sheets-a-pg.js` no
// > tiene ningún `DELETE`, y `copiarAPg` es "dispará y seguí". O sea: una fila que se borra de la
// > planilla **se queda para siempre del lado de PostgreSQL**.
//
// POR QUÉ IMPORTA, con los dos casos reales que lo motivaron:
//
//   · Un cerrajero de prueba llamado "lalala" que se borró de la planilla y **Marcos lo sigue
//     viendo**: es candidato a que se le mande un caso real.
//   · Dario asignado a un cliente al que ya no pertenece. Marcos lee `proveedor_asignaciones`
//     para elegir a quién llamar por `edificio + rubro`: una asignación fantasma manda al técnico
//     equivocado, o le muestra el reclamo de un consorcio ajeno.
//
// Y la dirección contraria también se informa, porque duele distinto: una fila que está en la
// planilla y **no** en PostgreSQL es algo que el panel muestra y el motor de Marcos no ve. El
// administrador lo carga, lo ve cargado, y Marcos actúa como si no existiera.
//
// `reset-test.js` NO limpia nada de esto, y está bien que no lo haga: es configuración, no rastro
// de una prueba.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Qué se compara y con qué se decide que dos filas son la misma.
//
// La clave NO es el `id`: son dos bases distintas y cada una numera por su cuenta. Es el dato que
// identifica a la fila para una persona -- el usuario del cliente, el nombre del edificio, el
// teléfono del proveedor.
const TABLAS = [
    {
        tabla: 'clientes',
        pestaña: 'clientes',
        clave: f => norm(f.usuario),
        mostrar: f => `${f.nombre || '(sin nombre)'} · usuario ${f.usuario || '(vacío)'}`,
        duele: 'un login que existe de un lado y del otro no',
    },
    {
        tabla: 'edificios',
        pestaña: 'edificios',
        // `EDIFICIOS` guarda el nombre en dos columnas que son alias del mismo dato.
        clave: f => norm(f.edificio || f.nombre),
        mostrar: f => `${f.edificio || f.nombre || '(sin nombre)'}${f.direccion ? ` · ${f.direccion}` : ''}`,
        duele: 'Marcos llamando a un edificio por un nombre que el panel ya no usa',
    },
    {
        tabla: 'proveedores',
        pestaña: 'proveedores',
        clave: f => `${norm(f.nombre)}|${telClave(f.telefono)}`,
        mostrar: f => `${f.nombre || '(sin nombre)'} (${f.rubro || 'sin rubro'}) · ${f.telefono || 'sin teléfono'} · cliente ${f.cliente || '—'}`,
        duele: 'un técnico dado de baja al que Marcos le puede mandar un caso real',
    },
    {
        tabla: 'proveedor_asignaciones',
        pestaña: 'proveedor_asignaciones',
        clave: f => `${norm(f.edificio)}|${norm(f.proveedor)}|${norm(f.rubro)}`,
        mostrar: f => `${f.edificio || '(sin edificio)'} → ${f.proveedor || '(sin proveedor)'} (${f.rubro || 'sin rubro'}, ${f.prioridad || 'sin prioridad'}) · cliente ${f.cliente || '—'}`,
        duele: 'el técnico equivocado avisado por un reclamo de otro consorcio',
    },
];

/** Compara como una persona: sin mayúsculas, sin acentos, sin espacios de más. */
function norm(v) {
    return String(v ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Un teléfono se compara por sus últimos 10 dígitos.
 *
 * El mismo número está escrito de cuatro formas distintas entre las dos bases: `11 6924-1157`,
 * `541169241157`, `5491169241157`. Comparar el texto crudo daría "sobra" y "falta" la misma fila.
 */
function telClave(v) {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.slice(-10);
}

const soloEsta = norm(process.argv[2] || '');

(async () => {
    let pool = null;
    let sobrantes = 0;
    let faltantes = 0;

    let doc;
    try {
        doc = await require('./sheets').getSheet();
    } catch (e) {
        console.error(`\n❌ No se pudo abrir Google Sheets: ${e.message}\n`);
        process.exit(1);
    }

    try {
        ({ pool } = require('./db-pg'));
    } catch (e) {
        console.error(`\n❌ No se pudo abrir PostgreSQL: ${e.message}\n`);
        process.exit(1);
    }

    for (const def of TABLAS) {
        if (soloEsta && norm(def.tabla) !== soloEsta) continue;

        // La pestaña se busca sin distinguir mayúsculas: en esta planilla conviven `facturas` y
        // `EVENTOS`, y buscarla exacta fue lo que hizo que `guardarFactura` creara una segunda.
        const titulo = Object.keys(doc.sheetsByTitle || {})
            .find(t => norm(t) === norm(def.pestaña));

        if (!titulo) {
            console.log(`\n📋 ${def.tabla}\n   ⚠️ No existe la pestaña "${def.pestaña}" en la planilla. No se puede comparar.`);
            continue;
        }

        const hoja = doc.sheetsByTitle[titulo];
        await hoja.loadHeaderRow().catch(() => {});
        const headers = hoja.headerValues || [];
        let filasSheets = [];
        try { filasSheets = await hoja.getRows(); } catch (e) {
            console.log(`\n📋 ${def.tabla}\n   ⚠️ No se pudo leer la pestaña "${titulo}": ${e.message}`);
            continue;
        }

        const comoObjeto = fila => {
            const o = {};
            for (const h of headers) o[h] = fila.get(h);
            return o;
        };

        const enSheets = new Map();
        for (const fila of filasSheets) {
            const o = comoObjeto(fila);
            const k = def.clave(o);
            if (!k || /^\|*$/.test(k)) continue;   // fila vacía o sin nada con qué identificarla
            enSheets.set(k, o);
        }

        let filasPg = [];
        try {
            filasPg = (await pool.query(`SELECT * FROM "${def.tabla}"`)).rows;
        } catch (e) {
            console.log(`\n📋 ${def.tabla}\n   ⚠️ No se pudo consultar en PostgreSQL: ${e.message}`);
            continue;
        }

        const enPg = new Map();
        for (const o of filasPg) {
            const k = def.clave(o);
            if (!k || /^\|*$/.test(k)) continue;
            enPg.set(k, o);
        }

        const soloEnPg = [...enPg.entries()].filter(([k]) => !enSheets.has(k));
        const soloEnSheets = [...enSheets.entries()].filter(([k]) => !enPg.has(k));

        console.log(`\n📋 ${def.tabla}  ·  planilla "${titulo}": ${enSheets.size}  ·  PostgreSQL: ${enPg.size}`);

        if (!soloEnPg.length && !soloEnSheets.length) {
            console.log('   ✅ Las dos bases dicen lo mismo.');
            continue;
        }

        if (soloEnPg.length) {
            sobrantes += soloEnPg.length;
            console.log(`   🐘 ${soloEnPg.length} fila(s) SOLO en PostgreSQL — Marcos las ve, el panel no:`);
            for (const [, o] of soloEnPg) console.log(`      · ${def.mostrar(o)}`);
            console.log(`      Riesgo: ${def.duele}.`);
        }

        if (soloEnSheets.length) {
            faltantes += soloEnSheets.length;
            console.log(`   📄 ${soloEnSheets.length} fila(s) SOLO en la planilla — el panel las muestra, Marcos no las ve:`);
            for (const [, o] of soloEnSheets) console.log(`      · ${def.mostrar(o)}`);
        }
    }

    console.log('');
    if (sobrantes === 0 && faltantes === 0) {
        console.log('✅ Sheets y PostgreSQL coinciden en toda la configuración.\n');
    } else {
        if (sobrantes) {
            console.log(`🐘 ${sobrantes} fila(s) de más en PostgreSQL. Se borraron de la planilla y quedaron acá:`);
            console.log(`   la sincronización solo agrega, nunca borra.`);
        }
        if (faltantes) {
            console.log(`📄 ${faltantes} fila(s) que el motor de Marcos no ve. Se arregla con:`);
            console.log(`   node importar-sheets-a-pg.js`);
        }
        console.log('');
        console.log('Esto NO se corrige solo, y es a propósito: es configuración, no dato de prueba.');
        console.log('Borrar una fila de más se decide mirándola. Para ver dónde más está escrito un');
        console.log('nombre antes de tocar nada: node buscar-texto.js "<el nombre>"');
        console.log('');
    }

    try { if (pool) await pool.end(); } catch {}
    process.exit(0);
})();
