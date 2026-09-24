// QUÉ UNIDADES EXISTEN DE VERDAD EN UN EDIFICIO
//
// Sirve para revisar una tanda de expensas ANTES de publicarla: el administrador elige cuarenta
// archivos, el lector saca la unidad de cada uno, y acá se dice cuáles van a llegarle a alguien.
//
// ── POR QUÉ HACE FALTA ──────────────────────────────────────────────────────
//
// > [!CAUTION]
// > **Nadie asigna una expensa a un vecino: la unidad escrita ES la llave.**
//
// El portal trae las expensas de su edificio cuyo `departamento` esté vacío o sea el suyo. Si el
// PDF dice `Depto 1` y el vecino tiene cargado `1A`, no coinciden — y no pasa nada visible: el
// vecino entra, no ve su expensa y cree que el administrador no la subió; el administrador la ve
// publicada en su panel. **Nadie se entera de que hay un problema.**
//
// Con una expensa por mes eso se nota. Con cuarenta subidas de golpe, se pueden colar tres mal y
// aparecer como un reclamo dos semanas después. La subida múltiple sin esta verificación no
// resuelve el trabajo: lo multiplica.
//
// ── LA DISTINCIÓN QUE IMPORTA ───────────────────────────────────────────────
//
// "No coincide" NO quiere decir "está mal". Son dos cosas distintas y el administrador hace algo
// distinto en cada una:
//
//   · **La unidad está mal escrita** → la corrige y listo.
//   · **La unidad está bien pero todavía no hay ningún vecino registrado ahí** → publica igual.
//     La expensa queda guardada y aparece sola el día que esa persona entre al portal.
//
// Decirle "error" a lo segundo sería un falso positivo, y un informe que grita por cosas que
// están bien es uno que se deja de mirar. Por eso el veredicto se llama `sin_vecino` y el mensaje
// dice qué pasa, no que esté roto.

'use strict';

const { normalizarUnidad, mismaUnidad } = require('./expensa-documento');

const normEd = (t) => String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Revisa una tanda contra las unidades conocidas. **Pura**: no toca ninguna base, así que se
 * prueba con casos reales y sin credenciales.
 *
 * `lecturas`  — lo que devolvió el lector por cada archivo: `{ archivo, unidad, monto, ... }`.
 * `conocidas` — las unidades que hoy tienen a alguien: `['1° A', '4C', 'PB 2']`.
 *
 * Devuelve una fila por archivo con `estado`:
 *   · `general`     — sin unidad: es la liquidación del edificio, la ven todos.
 *   · `ok`          — la unidad coincide con una que tiene vecino.
 *   · `sin_vecino`  — la unidad no coincide con ninguna. Se publica igual, pero hoy no la ve nadie.
 *   · `repetida`    — dos archivos de la misma unidad en la misma tanda.
 */
function revisarTanda(lecturas, conocidas = []) {
    const vistas = new Map();   // unidad normalizada → primer archivo que la trajo

    return (lecturas || []).map((l) => {
        const archivo = l?.archivo || '(sin nombre)';
        const unidad = String(l?.unidad || '').trim();

        if (!unidad) {
            return {
                archivo, unidad: '', estado: 'general',
                mensaje: 'Liquidación general del edificio: la van a ver todos los vecinos.',
            };
        }

        // Dos archivos para la misma unidad en una tanda es casi siempre el mismo PDF elegido dos
        // veces, o dos meses mezclados. Publicar los dos deja al vecino con dos expensas del
        // mismo período y sin saber cuál pagar.
        const clave = normalizarUnidad(unidad);
        if (vistas.has(clave)) {
            return {
                archivo, unidad, estado: 'repetida',
                mensaje: `Ya hay otro archivo para la unidad ${unidad} en esta tanda ` +
                         `(${vistas.get(clave)}). Revisá cuál corresponde antes de publicar.`,
            };
        }
        vistas.set(clave, archivo);

        const match = (conocidas || []).find(u => mismaUnidad(u, unidad));
        if (match) {
            return {
                archivo, unidad, estado: 'ok', unidadDelVecino: match,
                mensaje: `Coincide con la unidad ${match}.`,
            };
        }

        return {
            archivo, unidad, estado: 'sin_vecino',
            mensaje: `Todavía no hay ningún vecino registrado en la unidad ${unidad}. ` +
                     `Se puede publicar igual --va a aparecer sola cuando se registre-- pero ` +
                     `si la unidad está mal escrita, nadie la va a ver nunca.`,
        };
    });
}

/** Un resumen en una línea, para mostrar arriba de la tabla. */
function resumenTanda(filas) {
    const cuenta = (e) => (filas || []).filter(f => f.estado === e).length;
    return {
        total: (filas || []).length,
        ok: cuenta('ok'),
        general: cuenta('general'),
        sin_vecino: cuenta('sin_vecino'),
        repetida: cuenta('repetida'),
        hayQueMirar: cuenta('sin_vecino') + cuenta('repetida') > 0,
    };
}

/**
 * Las unidades de un edificio que hoy tienen a alguien detrás.
 *
 * Sale de DOS lados a propósito:
 *   · `usuario_unidades` — quien ya entró al portal.
 *   · `vecinos`          — quien Marcos conoce por WhatsApp aunque nunca haya entrado.
 *
 * Con una sola de las dos, media docena de unidades legítimas se reportarían como desconocidas.
 * Un informe con falsos positivos es uno que se deja de mirar.
 */
async function unidadesConVecino(edificio) {
    const ed = normEd(edificio);
    if (!ed) return [];

    const encontradas = new Map();   // normalizada → cómo está escrita
    const sumar = (u) => {
        const v = String(u || '').trim();
        if (!v) return;
        const k = normalizarUnidad(v);
        if (k && !encontradas.has(k)) encontradas.set(k, v);
    };

    try {
        const { pool } = require('./db-pg');
        // El plegado de acentos se hace del lado de PostgreSQL para que "San Patrício" y "san
        // patricio" sean el mismo edificio, igual que en el resto del proyecto.
        const plegar = `translate(lower(trim(%s)), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')`;

        const uu = await pool.query(
            `SELECT departamento FROM usuario_unidades
              WHERE ${plegar.replace('%s', 'edificio')} = $1
                AND COALESCE(estado, 'activo') = 'activo'`, [ed]
        ).catch(() => ({ rows: [] }));
        for (const r of uu.rows) sumar(r.departamento);

        const ve = await pool.query(
            `SELECT departamento FROM vecinos WHERE ${plegar.replace('%s', 'edificio')} = $1`, [ed]
        ).catch(() => ({ rows: [] }));
        for (const r of ve.rows) sumar(r.departamento);
    } catch (e) {
        // Sin base no se puede afirmar nada. Devolver una lista vacía haría que TODA la tanda
        // saliera como `sin_vecino` — cuarenta advertencias falsas. Se avisa y se devuelve null,
        // que el llamador tiene que leer como "no se pudo verificar", no como "no hay ninguna".
        console.warn(`📄💸 No se pudieron leer las unidades de "${edificio}": ${e.message}`);
        return null;
    }

    return [...encontradas.values()];
}

module.exports = { revisarTanda, resumenTanda, unidadesConVecino };
