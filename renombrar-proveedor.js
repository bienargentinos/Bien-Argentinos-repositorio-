#!/usr/bin/env node
// Renombra a un proveedor en TODOS lados: Google Sheets y PostgreSQL.
//
//   node renombrar-proveedor.js "a dario juju" "dario"             ← solo muestra, no toca nada
//   node renombrar-proveedor.js "a dario juju" "dario" --aplicar   ← escribe
//
// > [!CAUTION]
// > **Editar el nombre desde el panel NO alcanzaba, y encima no se notaba.**
//
// EL CASO QUE LO ORIGINÓ. Daniel editó "a dario juju" en el panel porque Marcos, al hablar, decía
// *"a-dario-juju"* en voz alta. Guardó, el panel mostró el nombre nuevo… y Marcos siguió diciendo
// el viejo. Dos motivos, los dos del mismo tamaño:
//
//   1. **El panel escribe en Sheets y el motor de Marcos lee PostgreSQL.**
//      `/api/proveedor-editar` hacía solo `writeCell` sobre la planilla, y
//      `buscarRolPorTelefono` sale de PostgreSQL (y solo cae a Sheets si PostgreSQL da ERROR, no
//      si dice otra cosa). O sea: la edición era invisible para Marcos, para siempre.
//
//   2. **El nombre está copiado como texto en media docena de lugares**, igual que el del
//      edificio. No hay un id de proveedor: el nombre ES la clave.
//
// Dónde está copiado, y qué rompe cada copia si queda con el nombre viejo:
//
// | Dónde | Qué se rompe |
// |---|---|
// | `proveedores.nombre` | cómo lo saluda y cómo lo nombra en voz |
// | `proveedor_asignaciones.proveedor` | **a quién se llama** por `edificio + rubro` |
// | `facturas.proveedor` | `buscarFacturasSinImputar` no encuentra sus facturas: cuando conteste "de qué obra es", no hay ninguna esperando |
// | `reportes.tecnico` / `EVENTOS.tecnico` | sus casos dejan de ser suyos: no se los encuentra al imputar una factura ni al buscar su caso abierto |
//
// La de `facturas` es la que muerde primero y en silencio: la factura queda "Sin imputar" y la
// respuesta del técnico no la encuentra nunca.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// La misma normalización que el resto del sistema: sin mayúsculas, sin acentos, sin espacios de
// sobra, pero **exacta**. Nada de coincidencias parciales: "dario" no puede llevarse puesto a
// "dario gomez", que es otra persona y probablemente de otro administrador.
const norm = (t) => String(t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');

// Columnas que guardan EL NOMBRE de un proveedor, por tabla/pestaña.
//
// Va por tabla y no por nombre de columna suelto, a propósito: `nombre` es el nombre de una
// PERSONA en casi todas las pestañas (un vecino, un encargado). Renombrar por columna suelta
// tocaría vecinos que se llaman igual.
const DONDE = {
    'proveedores':            ['nombre'],
    'proveedor_asignaciones': ['proveedor'],
    'reportes':               ['tecnico'],
    'eventos':                ['tecnico'],
    'facturas':               ['proveedor'],
};

// Columnas que guardan el nombre ADENTRO de un texto más largo: `enviada_por` es
// `"a dario juju (proveedor)"`. Solo se reemplaza si el nombre está al principio: en el medio de
// una frase puede ser cualquier otra cosa.
const COMPUESTAS = {
    'facturas': ['enviada_por'],
};

function columnasDe(tabla) {
    return DONDE[norm(tabla)] || [];
}
function compuestasDe(tabla) {
    return COMPUESTAS[norm(tabla)] || [];
}

/**
 * Renombra al proveedor en las dos bases.
 *
 * @param {string}  viejo    nombre actual, tal como está escrito
 * @param {string}  nuevo    nombre nuevo
 * @param {boolean} aplicar  false = solo lista lo que cambiaría
 * @param {(linea:string)=>void} log
 * @returns {Promise<{cambios:number, fallidos:number, lugares:string[]}>}
 */
async function renombrarProveedor({ viejo, nuevo, aplicar = false, log = console.log }) {
    const N_VIEJO = norm(viejo);
    const N_NUEVO = norm(nuevo);

    if (!N_VIEJO) throw new Error('El nombre viejo está vacío.');
    if (!N_NUEVO) throw new Error('El nombre nuevo está vacío.');
    if (N_VIEJO === N_NUEVO) return { cambios: 0, fallidos: 0, lugares: [] };

    let cambios = 0;
    let fallidos = 0;
    const lugares = [];

    const anotar = (donde, antes, despues) => {
        cambios++;
        lugares.push(donde);
        log(`   ${aplicar ? '✏️' : '·'} ${donde}`);
        log(`      "${antes}"  →  "${despues}"`);
    };

    // El nombre adentro de un texto compuesto: solo al principio.
    const enCompuesta = (valor) => {
        const v = String(valor || '');
        if (norm(v).startsWith(N_VIEJO)) return nuevo + v.slice(viejo.length);
        return null;
    };

    // ── GOOGLE SHEETS ────────────────────────────────────────────────────────────────────────
    log(`\n📄 Google Sheets\n`);
    try {
        const doc = await require('./sheets').getSheet();

        for (const titulo of Object.keys(doc.sheetsByTitle || {})) {
            const cols = columnasDe(titulo);
            const comp = compuestasDe(titulo);
            if (!cols.length && !comp.length) continue;

            const hoja = doc.sheetsByTitle[titulo];
            await hoja.loadHeaderRow().catch(() => {});
            const headers = hoja.headerValues || [];
            if (!headers.length) continue;

            let filas = [];
            try { filas = await hoja.getRows(); } catch { continue; }

            for (const fila of filas) {
                let tocada = false;

                for (const col of headers) {
                    const c = norm(col);
                    const valor = String(fila.get(col) ?? '');
                    if (!valor) continue;

                    if (cols.includes(c)) {
                        if (norm(valor) !== N_VIEJO) continue;
                        anotar(`${titulo} · fila ${fila._rowNumber} · ${col}`, valor, nuevo);
                        if (aplicar) { fila.set(col, nuevo); tocada = true; }
                        continue;
                    }

                    if (comp.includes(c)) {
                        const destino = enCompuesta(valor);
                        if (destino === null) continue;
                        anotar(`${titulo} · fila ${fila._rowNumber} · ${col}`, valor, destino);
                        if (aplicar) { fila.set(col, destino); tocada = true; }
                    }
                }

                if (tocada) await fila.save();
            }
        }
    } catch (e) {
        log(`   ❌ No se pudo trabajar sobre Google Sheets: ${e.message}`);
        fallidos++;
    }

    // ── POSTGRESQL ───────────────────────────────────────────────────────────────────────────
    //
    // Este es el lado que lee Marcos. Si se renombra solo en Sheets, en la práctica no cambió nada.
    log(`\n🐘 PostgreSQL\n`);
    try {
        const { pool } = require('./db-pg');

        const { rows: columnas } = await pool.query(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type IN ('text','character varying','character')
            ORDER BY table_name, ordinal_position
        `);

        for (const { table_name: tabla, column_name: col } of columnas) {
            const c = norm(col);
            const esNombre = columnasDe(tabla).includes(c);
            const esCompuesta = compuestasDe(tabla).includes(c);
            if (!esNombre && !esCompuesta) continue;

            // Fila por fila con `ctid` --el identificador físico que toda tabla de PostgreSQL
            // tiene, haya o no clave primaria-- y no con un UPDATE masivo: si al renombrar dos
            // filas quedaran iguales, una restricción única abortaría la sentencia ENTERA y el
            // script terminaría diciendo "listo" con la base a medias. Un renombrado parcial es
            // peor que ninguno, porque parece hecho y no lo está.
            let res;
            try {
                res = await pool.query(`SELECT ctid, "${col}" AS v FROM "${tabla}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`);
            } catch (e) {
                log(`   ⚠️ ${tabla}.${col}: no se pudo leer (${e.message})`);
                continue;
            }

            for (const fila of res.rows) {
                const destino = esNombre
                    ? (norm(fila.v) === N_VIEJO ? nuevo : null)
                    : enCompuesta(fila.v);
                if (destino === null) continue;

                if (!aplicar) { anotar(`${tabla}.${col}`, fila.v, destino); continue; }

                try {
                    await pool.query(`UPDATE "${tabla}" SET "${col}" = $2 WHERE ctid = $1`, [fila.ctid, destino]);
                    anotar(`${tabla}.${col}`, fila.v, destino);
                } catch (e) {
                    fallidos++;
                    log(`   ❌ ${tabla}.${col}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        log(`   ❌ No se pudo trabajar sobre PostgreSQL: ${e.message}`);
        fallidos++;
    }

    return { cambios, fallidos, lugares };
}

module.exports = { renombrarProveedor, norm };

// ── COMO PROGRAMA ────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const viejo = process.argv[2];
    const nuevo = process.argv[3];
    const aplicar = process.argv.includes('--aplicar');

    if (!viejo || !nuevo) {
        console.error('Uso:\n  node renombrar-proveedor.js "nombre viejo" "nombre nuevo" [--aplicar]');
        process.exit(1);
    }

    (async () => {
        let salida = { cambios: 0, fallidos: 0 };
        try {
            salida = await renombrarProveedor({ viejo, nuevo, aplicar });
        } catch (e) {
            console.error(`\n❌ ${e.message}\n`);
            process.exit(1);
        }

        console.log('');
        // Si algo falló hay que decirlo arriba de todo: un renombrado que dice "listo" con la
        // mitad sin hacer es peor que uno que falla entero, porque parece hecho y no lo está.
        if (salida.fallidos > 0) {
            console.log(`⚠️ ${salida.fallidos} lugar(es) NO se pudieron renombrar (el motivo está más arriba).`);
            console.log(`   Resolvelos y volvé a correr el mismo comando: lo ya renombrado no se toca de nuevo.\n`);
        }
        if (salida.cambios === 0 && salida.fallidos === 0) {
            console.log(`✅ No quedó ningún "${viejo}" para renombrar.\n`);
        } else if (aplicar) {
            console.log(`${salida.fallidos ? '🟠' : '✅'} ${salida.cambios} lugar(es) renombrados a "${nuevo}".`);
            console.log(`   Verificá con:  node buscar-texto.js "${viejo}"`);
            console.log(`   Y reiniciá Marcos para que lo tome:  pm2 restart marcos-ai\n`);
        } else {
            console.log(`📋 ${salida.cambios} lugar(es) cambiarían. NO se escribió nada.`);
            console.log(`   Para aplicarlo de verdad:`);
            console.log(`   node renombrar-proveedor.js "${viejo}" "${nuevo}" --aplicar\n`);
        }

        try { await require('./db-pg').pool.end(); } catch {}
        process.exit(0);
    })();
}
