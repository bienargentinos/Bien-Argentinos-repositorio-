/**
 * reparar-historial-proveedor.js
 * ─────────────────────────────────────────────────────────────
 * Repara retroactivamente los casos VIEJOS en la hoja EVENTOS.
 *
 * Problema que soluciona:
 *   Antes del fix, cuando Marcos le hablaba a un proveedor/técnico,
 *   el mensaje se guardaba como "Marcos: ..." sin indicar destinatario.
 *   Por eso el panel "Solo Proveedor" del dashboard quedaba vacío si
 *   el técnico nunca contestó.
 *
 * Qué hace este script:
 *   Recorre todas las filas de EVENTOS, mira el campo historial_chat
 *   de cada una, y por cada línea "Marcos: ..." intenta inferir a quién
 *   le estaba hablando según la línea anterior de esa misma "conversación":
 *     - Si la última línea que no era de Marcos fue de un Proveedor/Técnico
 *       → la retagea como "Marcos (a Proveedor): ..."
 *     - Si fue de un Encargado/Seguridad/Portero → "Marcos (a Encargado): ..."
 *     - Si fue del Vecino (o no hay nada previo) → la deja como estaba
 *
 * Es una HEURÍSTICA (no hay forma de saber con 100% de certeza a quién
 * iba dirigido cada mensaje viejo, porque esa info nunca se guardó).
 * Por eso el script:
 *   1) Por default corre en modo DRY-RUN: solo te muestra qué cambiaría,
 *      no toca la planilla.
 *   2) Para aplicar los cambios de verdad, corré con --write
 *
 * Uso:
 *   node reparar-historial-proveedor.js              (solo simula, no escribe)
 *   node reparar-historial-proveedor.js --write       (aplica los cambios)
 *   node reparar-historial-proveedor.js --write --caso CASO-0123   (solo esa fila)
 * ─────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_FILE = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_FILE);

const MODO_ESCRITURA = process.argv.includes('--write');
const casoFiltroIdx = process.argv.indexOf('--caso');
const CASO_FILTRO = casoFiltroIdx !== -1 ? process.argv[casoFiltroIdx + 1] : null;

const RE_PROVEEDOR = /^(Proveedor|Técnico|Plomero|Electricista|Gasista|Instalador)/i;
const RE_ENCARGADO = /^(Encargado|Seguridad|Portero|Portería)/i;
const RE_VECINO = /^(Vecino|Usuario|Cliente|Titular|Familiar|Pariente)/i;
const RE_MARCOS_SIN_TAG = /^Marcos:\s*/i; // "Marcos:" pelado, sin (a Proveedor)/(a Encargado)
const RE_MARCOS_YA_TAGEADO = /^Marcos\s*\(a (Proveedor|Encargado)\):/i;

async function getSheet() {
    const creds = require(CREDENTIALS_FILE);
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();
    return doc;
}

// Convierte el valor crudo de la celda historial_chat en un array de líneas (string[])
// y recuerda si el formato original era JSON o texto con saltos de línea, para
// volver a guardarlo de la misma forma.
function parsearHistorial(raw) {
    if (!raw) return { lineas: [], formato: 'json' };
    const s = String(raw).trim();
    if (!s) return { lineas: [], formato: 'json' };

    if (s.startsWith('[')) {
        try {
            const arr = JSON.parse(s);
            // Puede ser array de strings o array de objetos {emisor, texto, hora}
            return { lineas: arr, formato: 'json' };
        } catch (e) {
            return { lineas: [s], formato: 'texto' };
        }
    }
    return { lineas: s.split('\n').filter(Boolean), formato: 'texto' };
}

function serializarHistorial(lineas, formato) {
    if (formato === 'json') return JSON.stringify(lineas);
    return lineas.map(l => (typeof l === 'object' ? `${l.emisor || ''}: ${l.texto || ''}` : String(l))).join('\n');
}

function textoDeLinea(linea) {
    return typeof linea === 'object'
        ? `${linea.emisor ? linea.emisor + ': ' : ''}${linea.texto || linea.mensaje || ''}`
        : String(linea);
}

// Aplica la heurística de re-etiquetado sobre el array de líneas de UN caso.
// Devuelve { lineasNuevas, cambios } donde cambios es la lista de diffs para loguear.
function repararLineas(lineas) {
    let ultimoRolNoMarcos = null; // 'proveedor' | 'encargado' | 'vecino' | null
    const cambios = [];

    const lineasNuevas = lineas.map((linea, idx) => {
        const texto = textoDeLinea(linea);

        if (RE_PROVEEDOR.test(texto)) { ultimoRolNoMarcos = 'proveedor'; return linea; }
        if (RE_ENCARGADO.test(texto)) { ultimoRolNoMarcos = 'encargado'; return linea; }
        if (RE_VECINO.test(texto)) { ultimoRolNoMarcos = 'vecino'; return linea; }

        // Ya tiene tag nuevo -> no tocar, pero actualiza el "rol activo"
        if (RE_MARCOS_YA_TAGEADO.test(texto)) {
            const m = texto.match(RE_MARCOS_YA_TAGEADO);
            ultimoRolNoMarcos = m[1].toLowerCase() === 'proveedor' ? 'proveedor' : 'encargado';
            return linea;
        }

        // Es un "Marcos: ..." sin tag -> decidir según el rol activo
        if (RE_MARCOS_SIN_TAG.test(texto)) {
            if (ultimoRolNoMarcos === 'proveedor' || ultimoRolNoMarcos === 'encargado') {
                const nuevoPrefijo = ultimoRolNoMarcos === 'proveedor' ? 'Marcos (a Proveedor):' : 'Marcos (a Encargado):';
                const nuevoTexto = texto.replace(RE_MARCOS_SIN_TAG, nuevoPrefijo + ' ');
                cambios.push({ idx, antes: texto, despues: nuevoTexto });

                if (typeof linea === 'object') {
                    return { ...linea, emisor: nuevoPrefijo.replace(':', ''), texto: (linea.texto || linea.mensaje || '') };
                }
                return nuevoTexto;
            }
            return linea; // dirigido al vecino, se deja como está (comportamiento previo, sigue siendo correcto)
        }

        return linea;
    });

    return { lineasNuevas, cambios };
}

async function main() {
    console.log(MODO_ESCRITURA ? '⚠️  MODO ESCRITURA — se van a guardar los cambios en Sheets' : '🔎 MODO SIMULACIÓN (dry-run) — no se guarda nada. Corré con --write para aplicar.');
    if (CASO_FILTRO) console.log(`   Filtrando solo el caso: ${CASO_FILTRO}`);
    console.log('');

    const doc = await getSheet();
    const sheet = doc.sheetsByTitle['EVENTOS'];
    if (!sheet) {
        console.error('❌ No se encontró la pestaña EVENTOS en el Sheet.');
        process.exit(1);
    }

    const rows = await sheet.getRows();
    console.log(`📄 ${rows.length} filas encontradas en EVENTOS.\n`);

    let filasConCambios = 0;
    let totalLineasCambiadas = 0;

    for (const row of rows) {
        const idCaso = row.get('id_evento') || row.get('caso') || `fila_${row.rowNumber}`;
        if (CASO_FILTRO && idCaso !== CASO_FILTRO) continue;

        const raw = row.get('historial_chat');
        if (!raw) continue;

        const { lineas, formato } = parsearHistorial(raw);
        if (!lineas.length) continue;

        const { lineasNuevas, cambios } = repararLineas(lineas);
        if (!cambios.length) continue;

        filasConCambios++;
        totalLineasCambiadas += cambios.length;

        console.log(`── Caso ${idCaso} (fila ${row.rowNumber}) — ${cambios.length} línea(s) a retaguear:`);
        cambios.forEach(c => {
            console.log(`   [${c.idx}] "${c.antes}"`);
            console.log(`        → "${c.despues}"`);
        });
        console.log('');

        if (MODO_ESCRITURA) {
            row.set('historial_chat', serializarHistorial(lineasNuevas, formato));
            await row.save();
        }
    }

    console.log('─────────────────────────────────────────');
    console.log(`Filas con cambios: ${filasConCambios}`);
    console.log(`Líneas retagueadas en total: ${totalLineasCambiadas}`);
    console.log(MODO_ESCRITURA ? '✅ Cambios guardados en Sheets.' : 'ℹ️  Nada se guardó (dry-run). Corré con --write para aplicar estos cambios.');
}

main().catch(err => {
    console.error('❌ Error ejecutando el script:', err);
    process.exit(1);
});
