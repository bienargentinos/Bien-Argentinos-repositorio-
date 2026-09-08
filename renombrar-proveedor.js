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
//
// ── POR QUÉ ADEMÁS SE EXPORTA ────────────────────────────────────────────────────────────────
//
// > [!CAUTION]
// > **Editar el nombre desde el panel no llega a Marcos.** `/api/proveedor-editar` hace solo
// > `writeCell` sobre la planilla, y `buscarRolPorTelefono` sale de PostgreSQL --y solo cae a
// > Sheets si PostgreSQL da **error**, no si dice otra cosa.
//
// Daniel editó "a dario juju" en el panel porque Marcos, **al hablar**, decía *"a-dario-juju"* en
// voz alta. El panel mostró el nombre nuevo y Marcos siguió diciendo el viejo. Sus palabras: *"si
// cambian de técnico o lo edita, siempre lo llama por el primer nombre escrito"*.
//
// Por eso `renombrarProveedor()` se exporta: para que ese endpoint la LLAME cuando el nombre
// cambió, en vez de reimplementar la corrección adentro del panel. Eso último fue lo que pasó con
// `buscarPerfilEdificio`, que quedó escrito dos veces --en `sheets.js` y en `datos-pg.js`-- y
// arreglar una copia no cambió nada en producción, porque el motor leía la otra.

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// La misma normalización que `renombrar-edificio.js`: sin mayúsculas, sin acentos, sin espacios
// alrededor, pero **exacta**. Nada de coincidencias parciales: "dario" no puede llevarse puesto a
// "dario gomez", que es otra persona y probablemente de otro administrador.
const norm = (t) => String(t || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase().trim();

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

/** Las columnas del nombre para una tabla/pestaña, escrita como esté. */
function columnasDe(tabla) {
    const clave = Object.keys(DONDE).find(k => norm(k) === norm(tabla));
    return clave ? DONDE[clave] : null;
}

/**
 * `facturas.enviada_por` guarda `"Nombre (rol)"`: se cambia solo la parte del nombre, y solo si
 * ESA parte es exactamente el nombre viejo.
 *
 * Comparar con "empieza con" sería más corto y está mal: renombrar "dario" tocaría también
 * `"dario gomez (proveedor)"`, que es otra persona.
 */
function enviadaPorCorregida(valor, N_VIEJO, nuevo) {
    const m = String(valor || '').match(/^(.*?)\s*(\([^)]*\))?\s*$/);
    if (!m || norm(m[1]) !== N_VIEJO) return null;
    return `${nuevo}${m[2] ? ` ${m[2]}` : ''}`;
}

/**
 * Corrige el nombre del proveedor en las dos bases.
 *
 * @param {string}  viejo    nombre actual, tal como está escrito
 * @param {string}  nuevo    nombre nuevo
 * @param {boolean} aplicar  false = solo lista lo que cambiaría, no escribe
 * @param {(linea:string)=>void} log
 * @returns {Promise<{cambios:number, fallidos:number, lugares:string[]}>}
 */
async function renombrarProveedor({ viejo, nuevo, aplicar = false, log = console.log }) {
    const N_VIEJO = norm(viejo);
    if (!N_VIEJO) throw new Error('El nombre viejo está vacío.');
    if (!norm(nuevo)) throw new Error('El nombre nuevo está vacío.');
    if (N_VIEJO === norm(nuevo)) return { cambios: 0, fallidos: 0, lugares: [] };

    let cambios = 0;
    let fallidos = 0;
    const lugares = [];

    const anotar = (donde, antes, despues) => {
        cambios++;
        lugares.push(donde);
        log(`   ${aplicar ? '✏️' : '·'} ${donde}`);
        log(`      "${antes}"  →  "${despues}"`);
    };

    // ── GOOGLE SHEETS ────────────────────────────────────────────────────────────────────────
    log(`\n📄 Google Sheets\n`);
    try {
        const doc = await require('./sheets').getSheet();

        for (const titulo of Object.keys(doc.sheetsByTitle || {})) {
            const columnas = columnasDe(titulo);
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
                    const destino = enviadaPorCorregida(v, N_VIEJO, nuevo);
                    if (destino === null) continue;
                    anotar(`${hojaF} · fila ${fila._rowNumber} · enviada_por`, v, destino);
                    if (aplicar) { fila.set('enviada_por', destino); await fila.save(); }
                }
            }
        }
    } catch (e) {
        log(`   ❌ No se pudo trabajar sobre Google Sheets: ${e.message}`);
        fallidos++;
    }

    // ── POSTGRESQL ───────────────────────────────────────────────────────────────────────────
    //
    // Este es el lado que lee Marcos. Corregir solo en Sheets, en la práctica, no cambia nada.
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
            const esperadas = columnasDe(tabla);
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
                log(`   ⚠️ ${tabla}.${col}: no se pudo leer (${e.message})`);
                continue;
            }

            for (const fila of res.rows) {
                const v = fila.v;
                const destino = esEnviadaPor
                    ? enviadaPorCorregida(v, N_VIEJO, nuevo)
                    : (norm(v) === N_VIEJO ? nuevo : null);
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
                        log(`   ⚠️ ${tabla}.${col}: esta fila quedaría repetida con otra que ya dice "${nuevo}".`);
                        log(`      Se dejó como estaba. Hay una asignación duplicada en "${tabla}" que conviene borrar a mano.`);
                    } else {
                        log(`   ❌ ${tabla}.${col}: ${e.message}`);
                    }
                }
            }
        }
    } catch (e) {
        log(`   ❌ No se pudo trabajar sobre PostgreSQL: ${e.message}`);
        fallidos++;
    }

    return { cambios, fallidos, lugares };
}

module.exports = { renombrarProveedor, norm, DONDE, enviadaPorCorregida };

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
        // Si algo falló hay que decirlo arriba de todo. Un renombrado que dice "listo" con la
        // mitad sin hacer es peor que uno que falla entero: parece hecho y no lo está.
        if (salida.fallidos > 0) {
            console.log(`⚠️ ${salida.fallidos} lugar(es) NO se pudieron corregir (el motivo está más arriba).`);
            console.log(`   Resolvelos y volvé a correr el mismo comando: lo ya corregido no se toca de nuevo.\n`);
        }
        if (salida.cambios === 0 && salida.fallidos === 0) {
            console.log(`✅ No quedó ningún "${viejo}" para corregir.\n`);
        } else if (aplicar) {
            console.log(`${salida.fallidos ? '🟠' : '✅'} ${salida.cambios} lugar(es) corregidos a "${nuevo}"${salida.fallidos ? `, ${salida.fallidos} sin corregir` : ''}.`);
            console.log(`   Las conversaciones ya ocurridas NO se tocaron: son el registro de lo que se dijo.`);
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
