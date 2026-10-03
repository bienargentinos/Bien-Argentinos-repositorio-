// POR QUÉ UN CASO GIRA EN EL BARRIDO SIN AVANZAR NUNCA
//
//   node revisar-seguimientos.js
//
// Solo lee. No agenda, no manda, no cancela nada.
//
// ── EL CASO QUE LO ORIGINÓ ──────────────────────────────────────────────────
//
// En producción, cada cinco minutos durante horas:
//
//     ⏱️ 3 caso(s) con seguimiento vencido.
//     🛠️ [CASO-1004] no se pudo agendar el paso 2, así que NO se le pregunta al técnico
//
// Y nada más. Ni una línea diciendo por qué. Los mismos tres casos, para siempre.
//
// > [!CAUTION]
// > **`programarSeguimiento` tiene tres salidas que devuelven `false` SIN ESCRIBIR NADA EN EL
// > LOG**: sin `id_evento`, sin la pestaña, o sin encontrar la fila. Las otras cuatro salidas sí
// > se anuncian. O sea que cuando el seguimiento se traba, el log alcanza para saber QUE se trabó
// > y no alcanza para saber POR QUÉ.
//
// Y hay un motivo estructural para que la tercera --no encontrar la fila-- sea la más probable:
//
// | | Lee de | Busca por |
// |---|---|---|
// | El barrido (`obtenerSeguimientosVencidos`) | **PostgreSQL** primero | `reportes.codigo_caso` |
// | El agendado (`programarSeguimiento`) | **Sheets**, siempre | `EVENTOS.id_evento` |
//
// Son las dos bases de siempre, en un lugar nuevo. Un caso que está en PostgreSQL y no en la
// planilla se levanta en cada barrido y no se puede agendar en ninguno: el barrido lo ve, el
// agendado no. Mientras PostgreSQL estuvo caído esto no se notaba, porque el barrido caía al
// respaldo y entonces los dos miraban el mismo lado.
//
// Este script compara las dos listas y, para cada caso vencido, dice CUÁL de los siete caminos
// de `programarSeguimiento` va a tomar. Sin adivinar.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const CERRADOS = new Set(['resuelto', 'cerrado']);

const norm = (v) => String(v || '').toUpperCase().trim();

function vencido(estado, prox, ahora) {
    if (CERRADOS.has(String(estado || '').toLowerCase().trim())) return false;
    if (!prox) return false;
    const t = new Date(prox).getTime();
    return Number.isFinite(t) && t <= ahora;
}

/**
 * El mismo árbol de decisiones que `sheets.programarSeguimiento`, sin escribir.
 *
 * Se replica a propósito en vez de llamarla: llamarla AGENDARÍA, y una herramienta de
 * diagnóstico que modifica lo que está diagnosticando no sirve para nada. Lo que sí se comparte
 * es de dónde salen los datos.
 */
function queVaAPasar(filaSheets, paso) {
    if (!filaSheets) {
        return { ok: false, mudo: true, por: 'la fila NO está en la pestaña EVENTOS de Sheets' };
    }
    const estado = String(filaSheets.estado || '').toLowerCase().trim();
    if (CERRADOS.has(estado)) {
        return { ok: false, mudo: false, por: `en Sheets figura "${estado}": no se le agenda ningún control` };
    }
    const pasoActual = parseInt(filaSheets.seguimiento_paso || '0', 10) || 0;
    if (paso < pasoActual) {
        return { ok: false, mudo: false, por: `en Sheets va por el paso ${pasoActual}: no se vuelve al ${paso}` };
    }
    const prox = new Date(filaSheets.proximo_seguimiento || 0).getTime();
    if (paso === pasoActual && Number.isFinite(prox) && prox > Date.now()) {
        const faltan = Math.round((prox - Date.now()) / 60000);
        return { ok: false, mudo: false, por: `ya tiene un control agendado en ${faltan} min (paso ${pasoActual})` };
    }
    return { ok: true, mudo: false, por: 'se agenda bien' };
}

(async () => {
    const ahora = Date.now();

    // ── Lo que ve el barrido: PostgreSQL ────────────────────────────────────
    let enPg = [];
    let pgAnduvo = false;
    try {
        const { pool, initPgSchema } = require('./db-pg');
        if (typeof initPgSchema === 'function') await initPgSchema().catch(() => {});
        const { rows } = await pool.query(
            `SELECT codigo_caso, estado, seguimiento_paso, proximo_seguimiento,
                    edificio, tecnico, telefono
               FROM reportes`
        );
        pgAnduvo = true;
        enPg = rows.filter(r => vencido(r.estado, r.proximo_seguimiento, ahora));
    } catch (e) {
        console.log(`\n⚠️  PostgreSQL no contestó: ${e.message}`);
        console.log('   Sin ese lado no se puede comparar nada. Si dice "password authentication failed",');
        console.log('   acordate de que el pool lee la contraseña UNA sola vez, al arrancar: cambiar el');
        console.log('   .env no sirve hasta el `pm2 restart marcos-ai`.\n');
    }

    // ── Lo que ve el agendado: Google Sheets ────────────────────────────────
    const porId = new Map();
    let enSheets = [];
    try {
        const { getSheet, pestaña } = require('./sheets');
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) {
            console.log('\n🧱 No se encontró la pestaña EVENTOS en la planilla.');
            console.log('   Ese es exactamente el segundo camino mudo: el agendado devuelve false sin decir nada.\n');
        } else {
            const rows = await sheet.getRows();
            for (const r of rows) {
                const id = norm(r.get('id_evento'));
                if (!id) continue;
                const fila = {
                    id_evento: r.get('id_evento') || '',
                    estado: r.get('estado') || '',
                    seguimiento_paso: r.get('seguimiento_paso') || '',
                    proximo_seguimiento: r.get('proximo_seguimiento') || '',
                    edificio: r.get('edificio') || '',
                };
                porId.set(id, fila);
                if (vencido(fila.estado, fila.proximo_seguimiento, ahora)) enSheets.push(fila);
            }
        }
    } catch (e) {
        console.log(`\n⚠️  Google Sheets no contestó: ${e.message}\n`);
    }

    // ── El informe ──────────────────────────────────────────────────────────
    console.log(`\n⏱️  SEGUIMIENTOS VENCIDOS`);
    console.log(`${'─'.repeat(74)}`);
    console.log(`   PostgreSQL (lo que levanta el barrido): ${pgAnduvo ? enPg.length : '—'}`);
    console.log(`   Sheets     (donde se agenda)          : ${enSheets.length}`);

    if (pgAnduvo && !enPg.length && !enSheets.length) {
        console.log('\n   ✅ No hay ningún caso vencido. El barrido no tiene nada que hacer.\n');
        process.exit(0);
    }

    let trabados = 0;

    if (enPg.length) {
        console.log(`\n── CASO POR CASO, SEGÚN POSTGRESQL ──`);
        for (const c of enPg) {
            const id = norm(c.codigo_caso);
            const fila = porId.get(id);
            const paso = parseInt(c.seguimiento_paso || '1', 10) || 1;
            // El barrido pide el paso SIGUIENTE, no el actual.
            const pide = paso <= 1 ? 2 : (paso === 2 ? 3 : 9);
            const r = queVaAPasar(fila, pide);

            const desde = new Date(c.proximo_seguimiento).getTime();
            const hace = Number.isFinite(desde) ? Math.round((ahora - desde) / 60000) : null;

            console.log(`\n   ${c.codigo_caso || '(sin código)'}  —  ${c.edificio || 'sin edificio'}`);
            console.log(`      estado ${c.estado || '(vacío)'} · paso ${paso} → pide el ${pide}` +
                        (hace !== null ? ` · vencido hace ${hace} min` : ''));
            if (r.ok) {
                console.log(`      ✅ ${r.por}`);
            } else if (r.mudo) {
                trabados++;
                console.log(`      ❌ ${r.por}`);
                console.log(`         Esto es el estancamiento: se levanta en cada barrido y no se puede`);
                console.log(`         agendar nunca. Y no deja NINGUNA línea en el log.`);
            } else {
                console.log(`      ⏭️  ${r.por} (y eso sí queda escrito en el log)`);
            }
        }
    }

    // Lo de la planilla que PostgreSQL no tiene duele al revés: el panel lo muestra y el motor
    // no lo ve.
    const soloSheets = enSheets.filter(f => !enPg.some(c => norm(c.codigo_caso) === norm(f.id_evento)));
    if (pgAnduvo && soloSheets.length) {
        console.log(`\n── VENCIDOS EN LA PLANILLA QUE POSTGRESQL NO TIENE ──`);
        console.log(`   El barrido lee PostgreSQL primero, así que a estos NO los mira nadie:`);
        for (const f of soloSheets) {
            console.log(`   · ${f.id_evento} (${f.edificio || 'sin edificio'}) — estado ${f.estado || '(vacío)'}`);
        }
    }

    console.log(`\n${'─'.repeat(74)}`);
    if (trabados) {
        console.log(`   🔁 ${trabados} caso(s) trabados: están en PostgreSQL y no en la planilla.`);
        console.log(`      Se arregla del lado de los datos, no del código. Para ver dónde está cada`);
        console.log(`      nombre: node buscar-texto.js "CASO-XXXX"\n`);
        process.exit(1);
    }
    console.log(`   ✅ Ningún caso trabado por falta de fila.\n`);
    process.exit(0);
})().catch(e => {
    console.error('\n💥', e.message, '\n');
    process.exit(1);
});
