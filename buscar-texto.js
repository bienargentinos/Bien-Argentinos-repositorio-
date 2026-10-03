#!/usr/bin/env node
// Busca un texto en TODAS las pestañas de Google Sheets y en TODAS las tablas de PostgreSQL, y
// dice exactamente en qué celda está. Solo lee: no escribe nada.
//
//   node buscar-texto.js "27'0"
//   node buscar-texto.js "san patricio"
//
// PARA QUÉ SIRVE. Un dato mal escrito se corrige en un lugar y vuelve a aparecer. Eso pasa cuando
// el mismo valor está copiado en varias columnas o en varias tablas: se arregla la que se ve, y
// la próxima vez que algo sincroniza o vuelve a leer, gana la copia vieja.
//
// Caso real: el nombre "san patricio 27'0 casa" se corrigió desde el panel, la solicitud quedó
// como aplicada, y el apóstrofe volvió solo. Sin saber en cuántos lados estaba escrito, cada
// corrección es a ciegas.
//
// Ojo con el apóstrofe de Google Sheets: un apóstrofe AL PRINCIPIO de una celda no es parte del
// texto, es la marca de "esto es texto, no un número" y no se ve en la planilla. Uno en el MEDIO
// (27'0) sí es un carácter real y es un error de tipeo.

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const buscado = process.argv[2];
if (!buscado) {
    console.error('Falta el texto a buscar. Ejemplo:\n  node buscar-texto.js "27\'0"');
    process.exit(1);
}
const aguja = buscado.toLowerCase();

// Una columna se nombra por letra igual que en la planilla, para poder ir a la celda a mano.
function letraColumna(n) {
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

(async () => {
    let encontrados = 0;

    // ── GOOGLE SHEETS ────────────────────────────────────────────────────────────────────────
    console.log(`\n🔎 Buscando "${buscado}" en Google Sheets…\n`);
    try {
        const sheets = require('./sheets');
        const doc = await sheets.getSheet();

        for (const titulo of Object.keys(doc.sheetsByTitle || {})) {
            const hoja = doc.sheetsByTitle[titulo];
            await hoja.loadHeaderRow().catch(() => {});
            const headers = hoja.headerValues || [];
            let filas = [];
            try { filas = await hoja.getRows(); } catch (e) {
                console.log(`   ⚠️ ${titulo}: no se pudo leer (${e.message})`);
                continue;
            }

            for (const fila of filas) {
                for (let i = 0; i < headers.length; i++) {
                    const col = headers[i];
                    const valor = String(fila.get(col) ?? '');
                    if (!valor || !valor.toLowerCase().includes(aguja)) continue;
                    encontrados++;
                    // `_rowNumber` es la fila real de la planilla (la 1 es el encabezado).
                    const nFila = fila._rowNumber || fila.rowNumber || '?';
                    console.log(`   📄 ${titulo}  ·  celda ${letraColumna(i + 1)}${nFila}  ·  columna "${col}"`);
                    console.log(`      ${valor.length > 200 ? valor.slice(0, 200) + '…' : valor}`);
                }
            }
        }
    } catch (e) {
        console.error(`   ❌ No se pudo leer Google Sheets: ${e.message}`);
    }

    // ── POSTGRESQL ───────────────────────────────────────────────────────────────────────────
    console.log(`\n🔎 Buscando "${buscado}" en PostgreSQL…\n`);
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

        // Se agrupan por tabla para hacer una consulta por tabla y no una por columna.
        const porTabla = new Map();
        for (const c of columnas) {
            if (!porTabla.has(c.table_name)) porTabla.set(c.table_name, []);
            porTabla.get(c.table_name).push(c.column_name);
        }

        for (const [tabla, cols] of porTabla) {
            const condicion = cols.map(c => `"${c}" ILIKE $1`).join(' OR ');
            let res;
            try {
                res = await pool.query(`SELECT * FROM "${tabla}" WHERE ${condicion} LIMIT 50`, [`%${buscado}%`]);
            } catch (e) {
                console.log(`   ⚠️ ${tabla}: no se pudo consultar (${e.message})`);
                continue;
            }
            for (const fila of res.rows) {
                for (const c of cols) {
                    const valor = String(fila[c] ?? '');
                    if (!valor || !valor.toLowerCase().includes(aguja)) continue;
                    encontrados++;
                    const id = fila.id ?? fila.codigo_caso ?? fila.telefono ?? '';
                    console.log(`   🐘 ${tabla}.${c}${id ? `  ·  fila ${id}` : ''}`);
                    console.log(`      ${valor.length > 200 ? valor.slice(0, 200) + '…' : valor}`);
                }
            }
        }
    } catch (e) {
        console.error(`   ❌ No se pudo leer PostgreSQL: ${e.message}`);
    }

    console.log(
        encontrados === 0
            ? `\n✅ No aparece "${buscado}" en ningún lado.\n`
            : `\n📌 ${encontrados} lugar(es) con "${buscado}". Mientras quede uno sin corregir, el dato vuelve.\n`
    );

    try { if (pool) await pool.end(); } catch {}
    process.exit(0);
})();
