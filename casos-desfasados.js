// QUÉ CASOS DICEN COSAS DISTINTAS EN CADA BASE
//
// La decisión vive acá, separada de la herramienta, para que se pueda probar sin tener ninguna de
// las dos bases prendidas. `emparejar-casos.js` es la cáscara que lee y escribe.
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
//
// > [!CAUTION]
// > **`copiarAPg` dispara y sigue: una escritura que falla se pierde PARA SIEMPRE.**
//
// Es a propósito --un PostgreSQL caído no puede romper el camino de Sheets, que es el que le
// contesta a la persona-- pero tiene un costo que no estaba escrito en ningún lado: mientras
// PostgreSQL estuvo rechazando la contraseña, **todo lo que se escribió en ese rato quedó solo de
// un lado**. Nadie reintenta y nada avisa.
//
// Caso real: el CASO-1001 se cerró durante esa caída. En Sheets figura `resuelto`; en PostgreSQL
// quedó `nuevo`. Y como el motor lee PostgreSQL primero, para Marcos ese caso **sigue abierto**:
// lo puede elegir como el caso activo del técnico, imputarle una factura, o contarlo entre los
// reclamos del edificio.
//
// ── POR QUÉ SOLO SE CIERRA, NUNCA SE ABRE ───────────────────────────────────
//
// Cerrar un caso es siempre una acción explícita: alguien lo marcó resuelto en el panel, o el
// técnico dijo que terminó. Que una base diga `resuelto` y la otra no significa que esa acción no
// llegó del todo — no que haya que deshacerla.
//
// Al revés no vale. Si PostgreSQL dice `resuelto` y Sheets dice `nuevo`, **no se reabre nada**: un
// caso reabierto por una herramienta automática le mete a la Administración un reclamo que ya está
// resuelto, y reinicia el seguimiento contra un técnico que ya pasó. Se informa y lo decide una
// persona.
//
// De los dos errores posibles se elige el que se puede deshacer, que es la regla de siempre acá.

'use strict';

const CERRADOS = new Set(['resuelto', 'cerrado']);

const norm = (v) => String(v || '').toLowerCase().trim();
const clave = (v) => String(v || '').toUpperCase().trim();

/**
 * Qué hacer con un caso, mirando cómo figura de cada lado.
 *
 * Devuelve `{ accion, motivo }` donde `accion` es:
 *   - `'cerrar_en_pg'`  — Sheets lo da por terminado y PostgreSQL no. Se puede arreglar solo.
 *   - `'revisar'`       — PostgreSQL lo da por terminado y Sheets no. Lo decide una persona.
 *   - `'falta_en_pg'` / `'falta_en_sheets'` — está de un lado nada más.
 *   - `null`            — los dos dicen lo mismo.
 */
function decidirCaso({ enSheets, enPg }) {
    if (enSheets && !enPg) {
        return { accion: 'falta_en_sheets', motivo: 'está en la planilla y no en PostgreSQL: el panel lo muestra y Marcos no lo ve' };
    }
    if (!enSheets && enPg) {
        return { accion: 'falta_en_pg', motivo: 'está en PostgreSQL y no en la planilla: Marcos lo ve y el panel no' };
    }
    if (!enSheets && !enPg) return { accion: null, motivo: '' };

    const sh = norm(enSheets.estado);
    const pg = norm(enPg.estado);
    if (sh === pg) return { accion: null, motivo: '' };

    const shCerrado = CERRADOS.has(sh);
    const pgCerrado = CERRADOS.has(pg);

    if (shCerrado && !pgCerrado) {
        return {
            accion: 'cerrar_en_pg',
            motivo: `la planilla dice "${sh}" y PostgreSQL "${pg || '(vacío)'}". Marcos lee PostgreSQL, ` +
                    `así que para él sigue abierto: se lo puede elegir como caso activo del técnico ` +
                    `o imputarle una factura.`,
        };
    }

    if (pgCerrado && !shCerrado) {
        return {
            accion: 'revisar',
            motivo: `PostgreSQL dice "${pg}" y la planilla "${sh || '(vacío)'}". NO se reabre solo: ` +
                    `reabrir le mete a la Administración un reclamo ya resuelto y reinicia el ` +
                    `seguimiento contra un técnico que ya pasó.`,
        };
    }

    // Dos estados distintos pero ninguno cerrado (`nuevo` vs `en_proceso`, por ejemplo). No hace
    // daño y no hay forma de saber cuál es el bueno sin mirar el caso.
    return {
        accion: 'revisar',
        motivo: `la planilla dice "${sh || '(vacío)'}" y PostgreSQL "${pg || '(vacío)'}". ` +
                `Ninguno está cerrado, así que no urge, pero alguien escribió en una sola base.`,
    };
}

/** Cruza las dos listas y devuelve una decisión por caso, ordenadas por código. */
function compararCasos(filasSheets, filasPg) {
    const porSheets = new Map();
    for (const f of filasSheets) {
        const k = clave(f.id_evento);
        if (k) porSheets.set(k, f);
    }
    const porPg = new Map();
    for (const f of filasPg) {
        const k = clave(f.codigo_caso);
        if (k) porPg.set(k, f);
    }

    const todos = [...new Set([...porSheets.keys(), ...porPg.keys()])].sort();

    return todos
        .map(k => ({
            caso: k,
            enSheets: porSheets.get(k) || null,
            enPg: porPg.get(k) || null,
            ...decidirCaso({ enSheets: porSheets.get(k) || null, enPg: porPg.get(k) || null }),
        }))
        .filter(r => r.accion);
}

module.exports = { decidirCaso, compararCasos, CERRADOS };
