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

// ── POR QUÉ ADEMÁS SE EXPORTA ────────────────────────────────────────────────────────────────
//
// > [!CAUTION]
// > **`/api/edificio` --la edición de la ficha desde el panel-- renombra el edificio en
// > `EDIFICIOS` y en ningún otro lado.** Por eso quedaron cuatro asignaciones de proveedor
// > diciendo `san patricio 27'0 casa` cuando el edificio ya se llamaba `San patricio 270`.
//
// La propagación existe, pero está escrita ADENTRO de `/api/aprobar-solicitud`, cubre menos
// pestañas que esto y no toca PostgreSQL --que es el lado que lee Marcos--. Por eso
// `renombrarEdificio()` se exporta: para que los dos endpoints la LLAMEN, en vez de tener una
// tercera copia de la misma decisión. Copiar esta lógica es exactamente lo que pasó con
// `buscarPerfilEdificio`, que quedó escrita dos veces y arreglar una copia no cambió nada en
// producción.

// La misma normalización que usan el panel y la base: compara sin mayúsculas, sin acentos y sin
// espacios de sobra, pero EXACTA. Nada de coincidencias parciales -- con eso, renombrar el 270 se
// llevaría por delante al 159, que es otro consorcio y probablemente de otro administrador.
const norm = (t) => String(t || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase().trim();

// Columnas que guardan EL NOMBRE de un edificio.
const COL_NOMBRE = new Set(['edificio', 'consorcio']);
// Columnas que guardan una LISTA de edificios separados por comas.
const COL_LISTA = new Set(['edificios']);
// `nombre` es el nombre de una persona en casi todas las pestañas. Solo es el del edificio acá.
const DONDE_NOMBRE_ES_EL_EDIFICIO = new Set(['edificios']);

/**
 * Renombra un edificio en TODAS sus copias y en las dos bases.
 *
 * @param {string}  viejo    nombre actual, tal como está escrito
 * @param {string}  nuevo    nombre nuevo
 * @param {boolean} aplicar  false = solo lista lo que cambiaría, no escribe
 * @param {(linea:string)=>void} log
 * @returns {Promise<{cambios:number, fallidos:number}>}
 */
async function renombrarEdificio({ viejo, nuevo, aplicar = false, log = console.log }) {
    const N_VIEJO = norm(viejo);
    const N_NUEVO = norm(nuevo);

    if (!N_VIEJO) throw new Error('El nombre viejo está vacío.');
    if (!N_NUEVO) throw new Error('El nombre nuevo está vacío.');
    if (N_VIEJO === N_NUEVO) return { cambios: 0, fallidos: 0 };

    let cambios = 0;
    let fallidos = 0;

    // Reemplaza el ítem que corresponde dentro de una lista separada por comas, y deja el resto
    // intacto: pisar la celda entera le borraría al administrador los otros edificios que tiene.
    const reemplazarEnLista = (valor) => {
        const partes = String(valor || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!partes.some(p => norm(p) === N_VIEJO)) return null;
        return partes.map(p => (norm(p) === N_VIEJO ? nuevo : p)).join(', ');
    };

    const anotar = (donde, antes, despues) => {
        cambios++;
        log(`   ${aplicar ? '✏️' : '·'} ${donde}`);
        log(`      "${antes}"  →  "${despues}"`);
    };

    // ── GOOGLE SHEETS ────────────────────────────────────────────────────────────────────────
    log(`\n📄 Google Sheets\n`);
    try {
        const sheets = require('./sheets');
        const doc = await sheets.getSheet();

        for (const titulo of Object.keys(doc.sheetsByTitle || {})) {
            const hoja = doc.sheetsByTitle[titulo];
            try {
                await hoja.loadHeaderRow();
            } catch {
                continue;
            }
            let headers = [];
            try {
                headers = hoja.headerValues || [];
            } catch {
                continue;
            }
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
        log(`   ❌ No se pudo trabajar sobre Google Sheets: ${e.message}`);
    }

    // ── POSTGRESQL ───────────────────────────────────────────────────────────────────────────
    log(`\n🐘 PostgreSQL\n`);
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
            // acá y no en SQL: se traen los valores y se decide en Node, con la misma función que
            // usa el resto del sistema.
            //
            // Fila por fila, con `ctid` (el identificador físico que toda tabla de PostgreSQL
            // tiene, exista o no una clave primaria). Un UPDATE masivo parece más prolijo y es una
            // trampa: si al renombrar dos filas quedan iguales, una restricción única aborta la
            // sentencia entera, se cae el resto de las tablas, y el script termina diciendo
            // "listo" con la base a medias. Un renombrado parcial es peor que ninguno, porque
            // parece hecho y no lo está.
            let res;
            try {
                res = await pool.query(`SELECT ctid, "${col}" AS v FROM "${tabla}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`);
            } catch (e) {
                log(`   ⚠️ ${tabla}.${col}: no se pudo leer (${e.message})`);
                continue;
            }

            for (const fila of res.rows) {
                const v = fila.v;
                const destino = esNombre
                    ? (norm(v) === N_VIEJO ? nuevo : null)
                    : reemplazarEnLista(v);
                if (destino === null) continue;

                if (!aplicar) { anotar(`${tabla}.${col}`, v, destino); continue; }

                try {
                    await pool.query(`UPDATE "${tabla}" SET "${col}" = $2 WHERE ctid = $1`, [fila.ctid, destino]);
                    anotar(`${tabla}.${col}`, v, destino);
                } catch (e) {
                    fallidos++;
                    if (/unique|duplicad|duplicate/i.test(e.message)) {
                        log(`   ⚠️ ${tabla}.${col}: esta fila quedaría repetida con otra que ya dice "${nuevo}".`);
                        log(`      Se dejó como estaba. Hay una fila duplicada en "${tabla}" que conviene borrar a mano.`);
                    } else {
                        log(`   ❌ ${tabla}.${col}: ${e.message}`);
                    }
                }
            }
        }
    } catch (e) {
        log(`   ❌ No se pudo trabajar sobre PostgreSQL: ${e.message}`);
    }

    return { cambios, fallidos };
}

module.exports = { renombrarEdificio, norm };

// ── COMO PROGRAMA ────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const viejo = process.argv[2];
    const nuevo = process.argv[3];
    const aplicar = process.argv.includes('--aplicar');

    if (!viejo || !nuevo) {
        console.error('Uso:\n  node renombrar-edificio.js "nombre viejo" "nombre nuevo" [--aplicar]');
        process.exit(1);
    }

    (async () => {
        let salida = { cambios: 0, fallidos: 0 };
        try {
            salida = await renombrarEdificio({ viejo, nuevo, aplicar });
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
            console.log(`${salida.fallidos ? '🟠' : '✅'} ${salida.cambios} lugar(es) renombrados a "${nuevo}"${salida.fallidos ? `, ${salida.fallidos} sin renombrar` : ''}.`);
            console.log(`   Verificá con:  node buscar-texto.js "${viejo}"`);
            console.log(`   Y reiniciá Marcos para que lo tome:  pm2 restart marcos-ai\n`);
        } else {
            console.log(`📋 ${salida.cambios} lugar(es) cambiarían. NO se escribió nada.`);
            console.log(`   Para aplicarlo de verdad:`);
            console.log(`   node renombrar-edificio.js "${viejo}" "${nuevo}" --aplicar\n`);
        }

        try { await require('./db-pg').pool.end(); } catch {}
        process.exit(0);
    })();
}
