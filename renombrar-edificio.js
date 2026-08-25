#!/usr/bin/env node
// Renombra un edificio en TODOS lados: Google Sheets y PostgreSQL.
//
//   node renombrar-edificio.js "san patricio 27'0 casa" "San patricio 270"            ← solo muestra
//   node renombrar-edificio.js "san patricio 27'0 casa" "San patricio 270" --aplicar  ← escribe
//
// Por defecto NO escribe nada: lista lo que cambiaría. Recién con --aplicar toca los datos.
//
// PARA QUÉ SIRVE. No hay un id de edificio: el nombre ES la clave, y está copiado como texto en
// cada vecino, cada evento, cada factura, cada asignación de proveedor, y dentro de la lista
// separada por comas de `clientes.edificios`. Renombrarlo en una pestaña y no en las otras parte
// el edificio en dos: el panel lo muestra "Sin asignar" aunque en la planilla figure al lado de
// su administrador, y el cliente ve un edificio menos del que tiene.
//
// Y son DOS bases: el panel lee Sheets, el motor de Marcos y los permisos del cliente leen
// PostgreSQL. Cambiar solo una deja a Marcos y al panel viendo cosas distintas.
//
// OJO CON REIMPORTAR EN LUGAR DE USAR ESTO: `importar-sheets-a-pg.js` sincroniza `edificios`
// usando la columna `edificio` como clave. Si en Sheets ya está el nombre nuevo y en PostgreSQL
// el viejo, no actualiza la fila: crea una SEGUNDA. Este script cambia la que ya existe.

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const viejo = process.argv[2];
const nuevo = process.argv[3];
const aplicar = process.argv.includes('--aplicar');

if (!viejo || !nuevo) {
    console.error('Uso:\n  node renombrar-edificio.js "nombre viejo" "nombre nuevo" [--aplicar]');
    process.exit(1);
}

// La misma normalización que usan el panel y la base: compara sin mayúsculas, sin acentos y sin
// espacios de sobra, pero EXACTA. Nada de coincidencias parciales -- con eso, renombrar el 270 se
// llevaría por delante al 159, que es otro consorcio y probablemente de otro administrador.
const norm = (t) => String(t || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase().trim();

const N_VIEJO = norm(viejo);
const N_NUEVO = norm(nuevo);

if (!N_VIEJO) { console.error('El nombre viejo está vacío.'); process.exit(1); }
if (N_VIEJO === N_NUEVO) { console.error('Los dos nombres son el mismo. No hay nada que hacer.'); process.exit(1); }

// Columnas que guardan EL NOMBRE de un edificio.
const COL_NOMBRE = new Set(['edificio', 'consorcio']);
// Columnas que guardan una LISTA de edificios separados por comas.
const COL_LISTA = new Set(['edificios']);
// `nombre` es el nombre de una persona en casi todas las pestañas. Solo es el del edificio acá.
const DONDE_NOMBRE_ES_EL_EDIFICIO = new Set(['edificios']);

let cambios = 0;

// Reemplaza el ítem que corresponde dentro de una lista separada por comas, y deja el resto
// intacto: pisar la celda entera le borraría al administrador los otros edificios que tiene.
function reemplazarEnLista(valor) {
    const partes = String(valor || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!partes.some(p => norm(p) === N_VIEJO)) return null;
    return partes.map(p => (norm(p) === N_VIEJO ? nuevo : p)).join(', ');
}

function anotar(donde, antes, despues) {
    cambios++;
    console.log(`   ${aplicar ? '✏️' : '·'} ${donde}`);
    console.log(`      "${antes}"  →  "${despues}"`);
}

(async () => {

    // ── GOOGLE SHEETS ────────────────────────────────────────────────────────────────────────
    console.log(`\n📄 Google Sheets\n`);
    try {
        const sheets = require('./sheets');
        const doc = await sheets.getSheet();

        for (const titulo of Object.keys(doc.sheetsByTitle || {})) {
            const hoja = doc.sheetsByTitle[titulo];
            await hoja.loadHeaderRow().catch(() => {});
            const headers = hoja.headerValues || [];
            if (!headers.length) continue;

            const esTabEdificios = DONDE_NOMBRE_ES_EL_EDIFICIO.has(norm(titulo));
            let filas = [];
            try { filas = await hoja.getRows(); } catch { continue; }

            for (const fila of filas) {
                let tocada = false;

                for (const col of headers) {
                    const c = norm(col);
                    const valor = String(fila.get(col) ?? '');
                    if (!valor) continue;

                    const esNombre = COL_NOMBRE.has(c) || (esTabEdificios && c === 'nombre');
                    if (esNombre) {
                        if (norm(valor) !== N_VIEJO) continue;
                        anotar(`${titulo} · fila ${fila._rowNumber} · ${col}`, valor, nuevo);
                        if (aplicar) { fila.set(col, nuevo); tocada = true; }
                        continue;
                    }

                    if (COL_LISTA.has(c)) {
                        const nuevaLista = reemplazarEnLista(valor);
                        if (nuevaLista === null) continue;
                        anotar(`${titulo} · fila ${fila._rowNumber} · ${col}`, valor, nuevaLista);
                        if (aplicar) { fila.set(col, nuevaLista); tocada = true; }
                    }
                }

                if (tocada) await fila.save();
            }
        }
    } catch (e) {
        console.error(`   ❌ No se pudo trabajar sobre Google Sheets: ${e.message}`);
    }

    // ── POSTGRESQL ───────────────────────────────────────────────────────────────────────────
    console.log(`\n🐘 PostgreSQL\n`);
    let pool = null;
    try {
        ({ pool } = require('./db-pg'));

        const { rows: columnas } = await pool.query(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type IN ('text','character varying','character')
            ORDER BY table_name, ordinal_position
        `);

        for (const { table_name: tabla, column_name: col } of columnas) {
            const c = norm(col);
            const esTablaEdificios = DONDE_NOMBRE_ES_EL_EDIFICIO.has(norm(tabla));
            const esNombre = COL_NOMBRE.has(c) || (esTablaEdificios && c === 'nombre');
            const esLista = COL_LISTA.has(c);
            if (!esNombre && !esLista) continue;

            // marcos_norm() no está en todas las instalaciones, así que la comparación se hace
            // acá y no en SQL: se traen los valores distintos y se decide en Node, con la misma
            // función que usa el resto del sistema.
            let res;
            try {
                res = await pool.query(`SELECT DISTINCT "${col}" AS v FROM "${tabla}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`);
            } catch (e) {
                console.log(`   ⚠️ ${tabla}.${col}: no se pudo leer (${e.message})`);
                continue;
            }

            for (const { v } of res.rows) {
                const destino = esNombre
                    ? (norm(v) === N_VIEJO ? nuevo : null)
                    : reemplazarEnLista(v);
                if (destino === null) continue;

                anotar(`${tabla}.${col}`, v, destino);
                if (aplicar) {
                    await pool.query(`UPDATE "${tabla}" SET "${col}" = $2 WHERE "${col}" = $1`, [v, destino]);
                }
            }
        }
    } catch (e) {
        console.error(`   ❌ No se pudo trabajar sobre PostgreSQL: ${e.message}`);
    }

    console.log('');
    if (cambios === 0) {
        console.log(`✅ No quedó ningún "${viejo}" para renombrar.\n`);
    } else if (aplicar) {
        console.log(`✅ ${cambios} lugar(es) renombrados a "${nuevo}".`);
        console.log(`   Verificá con:  node buscar-texto.js "${viejo}"\n`);
    } else {
        console.log(`📋 ${cambios} lugar(es) cambiarían. NO se escribió nada.`);
        console.log(`   Para aplicarlo de verdad:`);
        console.log(`   node renombrar-edificio.js "${viejo}" "${nuevo}" --aplicar\n`);
    }

    try { if (pool) await pool.end(); } catch {}
    process.exit(0);
})();
