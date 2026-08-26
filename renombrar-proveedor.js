#!/usr/bin/env node
// Corrige el nombre de un proveedor en TODOS lados: Google Sheets y PostgreSQL.
//
//   node renombrar-proveedor.js "a dario juju" "Dario Juju"            ← solo muestra
//   node renombrar-proveedor.js "a dario juju" "Dario Juju" --aplicar  ← escribe
//
// Por defecto NO escribe nada: lista lo que cambiaría. Recién con --aplicar toca los datos.
//
// PARA QUÉ SIRVE. Igual que con los edificios, el nombre del proveedor ES la clave: está copiado
// como texto en `proveedores`, en cada fila de `proveedor_asignaciones`, en el campo `tecnico` de
// cada caso y en cada factura. Corregirlo en la lista maestra y en ningún otro lado deja el resto
// apuntando al nombre viejo.
//
// Y son DOS bases: el panel lee Sheets, el motor de Marcos lee PostgreSQL. Si se corrige una
// sola, Marcos le sigue escribiendo "Hola a dario juju" aunque en la planilla ya diga otra cosa.
//
// LO QUE NO TOCA, A PROPÓSITO: las conversaciones ya ocurridas (`historial_chat`, `mensajes`,
// `mensajes_wa`, `chat_proveedor_json`). Eso es el registro de lo que se dijo y cuándo; reescribirlo
// sería falsear el historial. Va a seguir diciendo el nombre viejo, y está bien que así sea.

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const viejo = process.argv[2];
const nuevo = process.argv[3];
const aplicar = process.argv.includes('--aplicar');

if (!viejo || !nuevo) {
    console.error('Uso:\n  node renombrar-proveedor.js "nombre viejo" "nombre nuevo" [--aplicar]');
    process.exit(1);
}

const norm = (t) => String(t || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase().trim();

const N_VIEJO = norm(viejo);
if (!N_VIEJO) { console.error('El nombre viejo está vacío.'); process.exit(1); }
if (N_VIEJO === norm(nuevo)) { console.error('Los dos nombres son el mismo. No hay nada que hacer.'); process.exit(1); }

// Dónde vive el nombre del proveedor como DATO (no como parte de una conversación).
// tabla/pestaña → columnas.
const DONDE = {
    proveedores:            ['nombre'],
    proveedor_asignaciones: ['proveedor'],
    facturas:               ['proveedor'],
    tecnicos:               ['nombre'],
    // El caso guarda a nombre de quién quedó el trabajo.
    EVENTOS:                ['tecnico'],
    reportes:               ['tecnico'],   // el espejo en PostgreSQL
};

let cambios = 0;
let fallidos = 0;
function anotar(donde, antes, despues) {
    cambios++;
    console.log(`   ${aplicar ? '✏️' : '·'} ${donde}`);
    console.log(`      "${antes}"  →  "${despues}"`);
}

(async () => {

    console.log(`\n📄 Google Sheets\n`);
    try {
        const sheets = require('./sheets');
        const doc = await sheets.getSheet();

        for (const titulo of Object.keys(doc.sheetsByTitle || {})) {
            const columnas = DONDE[Object.keys(DONDE).find(k => norm(k) === norm(titulo))];
            if (!columnas) continue;

            const hoja = doc.sheetsByTitle[titulo];
            await hoja.loadHeaderRow().catch(() => {});
            const headers = hoja.headerValues || [];
            let filas = [];
            try { filas = await hoja.getRows(); } catch { continue; }

            for (const fila of filas) {
                let tocada = false;
                for (const col of headers) {
                    if (!columnas.includes(norm(col))) continue;
                    const valor = String(fila.get(col) ?? '');
                    if (norm(valor) !== N_VIEJO) continue;
                    anotar(`${titulo} · fila ${fila._rowNumber} · ${col}`, valor, nuevo);
                    if (aplicar) { fila.set(col, nuevo); tocada = true; }
                }
                if (tocada) await fila.save();
            }
        }

        // `facturas.enviada_por` guarda "Nombre (rol)": se cambia solo la parte del nombre.
        const hojaF = Object.keys(doc.sheetsByTitle).find(t => norm(t) === 'facturas');
        if (hojaF) {
            const hoja = doc.sheetsByTitle[hojaF];
            await hoja.loadHeaderRow().catch(() => {});
            if ((hoja.headerValues || []).includes('enviada_por')) {
                for (const fila of await hoja.getRows()) {
                    const v = String(fila.get('enviada_por') || '');
                    const m = v.match(/^(.*?)\s*(\([^)]*\))?\s*$/);
                    if (!m || norm(m[1]) !== N_VIEJO) continue;
                    const destino = `${nuevo}${m[2] ? ` ${m[2]}` : ''}`;
                    anotar(`${hojaF} · fila ${fila._rowNumber} · enviada_por`, v, destino);
                    if (aplicar) { fila.set('enviada_por', destino); await fila.save(); }
                }
            }
        }
    } catch (e) {
        console.error(`   ❌ No se pudo trabajar sobre Google Sheets: ${e.message}`);
    }

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
            const esperadas = DONDE[Object.keys(DONDE).find(k => norm(k) === norm(tabla))];
            const esColumnaDelNombre = esperadas && esperadas.includes(norm(col));
            const esEnviadaPor = norm(tabla) === 'facturas' && norm(col) === 'enviada_por';
            if (!esColumnaDelNombre && !esEnviadaPor) continue;

            // FILA POR FILA, con `ctid` (el identificador físico que toda tabla de PostgreSQL
            // tiene, exista o no una clave primaria).
            //
            // Un UPDATE masivo parece más prolijo y es una trampa: si al renombrar dos filas
            // quedan iguales, la restricción única aborta la sentencia ENTERA y no se renombra
            // ninguna. Peor todavía, aborta el resto de las tablas, y el script termina diciendo
            // "listo" con la base a medias -- que fue exactamente lo que pasó con
            // uq_proveedor_asignaciones. Un renombrado parcial es peor que ninguno, porque parece
            // hecho y no lo está.
            let res;
            try {
                res = await pool.query(`SELECT ctid, "${col}" AS v FROM "${tabla}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`);
            } catch (e) {
                console.log(`   ⚠️ ${tabla}.${col}: no se pudo leer (${e.message})`);
                continue;
            }

            for (const fila of res.rows) {
                const v = fila.v;
                let destino = null;
                if (esEnviadaPor) {
                    const m = String(v).match(/^(.*?)\s*(\([^)]*\))?\s*$/);
                    if (m && norm(m[1]) === N_VIEJO) destino = `${nuevo}${m[2] ? ` ${m[2]}` : ''}`;
                } else if (norm(v) === N_VIEJO) {
                    destino = nuevo;
                }
                if (!destino) continue;

                if (!aplicar) { anotar(`${tabla}.${col}`, v, destino); continue; }

                try {
                    await pool.query(`UPDATE "${tabla}" SET "${col}" = $2 WHERE ctid = $1`, [fila.ctid, destino]);
                    anotar(`${tabla}.${col}`, v, destino);
                } catch (e) {
                    fallidos++;
                    if (/unique|duplicad|duplicate/i.test(e.message)) {
                        // La fila renombrada chocaría con otra que ya existe: son la misma
                        // asignación cargada dos veces con el nombre escrito distinto. No se
                        // fuerza -- borrar una de las dos es una decisión, no un efecto
                        // secundario de corregir un nombre.
                        console.log(`   ⚠️ ${tabla}.${col}: esta fila quedaría repetida con otra que ya dice "${nuevo}".`);
                        console.log(`      Se dejó como estaba. Hay una asignación duplicada en "${tabla}" que conviene borrar a mano.`);
                    } else {
                        console.log(`   ❌ ${tabla}.${col}: ${e.message}`);
                    }
                }
            }
        }
    } catch (e) {
        console.error(`   ❌ No se pudo trabajar sobre PostgreSQL: ${e.message}`);
    }

    console.log('');
    // Si algo falló hay que decirlo arriba de todo. Un renombrado que dice "listo" con la mitad
    // sin hacer es peor que uno que falla entero: parece hecho y no lo está.
    if (fallidos > 0) {
        console.log(`⚠️ ${fallidos} lugar(es) NO se pudieron corregir (el motivo está más arriba).`);
        console.log(`   Resolvelos y volvé a correr el mismo comando: lo ya corregido no se toca de nuevo.\n`);
    }
    if (cambios === 0 && fallidos === 0) {
        console.log(`✅ No quedó ningún "${viejo}" para corregir.\n`);
    } else if (aplicar) {
        console.log(`${fallidos ? '🟠' : '✅'} ${cambios} lugar(es) corregidos a "${nuevo}"${fallidos ? `, ${fallidos} sin corregir` : ''}.`);
        console.log(`   Las conversaciones ya ocurridas NO se tocaron: son el registro de lo que se dijo.`);
        console.log(`   Verificá con:  node buscar-texto.js "${viejo}"\n`);
    } else {
        console.log(`📋 ${cambios} lugar(es) cambiarían. NO se escribió nada.`);
        console.log(`   Para aplicarlo de verdad:`);
        console.log(`   node renombrar-proveedor.js "${viejo}" "${nuevo}" --aplicar\n`);
    }

    try { if (pool) await pool.end(); } catch {}
    process.exit(0);
})();
