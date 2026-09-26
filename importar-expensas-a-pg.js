// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

/**
 * LAS EXPENSAS QUE ESTÁN EN LA PLANILLA Y NO EN POSTGRESQL
 *
 * > [!CAUTION]
 * > **El panel escribe en los dos lados, pero el `INSERT` de PostgreSQL vive adentro de un
 * > `try { } catch { console.warn(...) }`.** Cuando ese INSERT falla, la expensa queda en la
 * > planilla, el administrador la ve publicada, y al vecino no le aparece nunca — porque el
 * > portal lee PostgreSQL.
 *
 * Ya falló por dos motivos distintos, los dos invisibles desde el panel:
 *
 *   1. Las columnas `departamento`, `monto`, `monto_origen` y `vencimiento` todavía no existían.
 *      El INSERT las nombra a las once, y PostgreSQL rechaza el statement ENTERO: no escribe
 *      ninguna. Es el mismo error que ya está anotado en CLAUDE.md con `material_enviado_tecnico`.
 *   2. El CHECK de `monto_origen` aceptaba 'ia' y 'manual', y el panel escribe 'ocr'. O sea que
 *      se rechazaban justo las expensas cuyo monto había leído la IA — las que más importan.
 *
 * Los dos están arreglados en `db-pg.js`, pero un arreglo no vuelve atrás: las filas rechazadas
 * no están. Esto las trae, sin tocar las que ya llegaron.
 *
 *   node importar-expensas-a-pg.js             → solo mira y dice qué falta
 *   node importar-expensas-a-pg.js --aplicar   → las escribe
 *
 * Es idempotente: cada fila se busca antes de escribir, así que se puede correr las veces que
 * haga falta. Y escribe de a una: una fila que falle no se lleva puestas a las demás.
 */

const { getSheet, pestaña } = require('./sheets');
const { pool, initPgSchema } = require('./db-pg');
const { claveUnidad, mismoEdificio } = require('./edificio-clave');

const APLICAR = process.argv.includes('--aplicar');
const TAB = process.env.SHEET_TAB_EXPENSAS || 'expensas';

function v(fila, col) {
    const x = fila.get ? fila.get(col) : fila[col];
    return x === undefined || x === null ? '' : String(x).trim();
}

// Dos filas son la misma expensa si son del mismo edificio, la misma unidad y el mismo período.
// El edificio y la unidad se comparan con las reglas que ya existen (normalizado pero exacto):
// "1° A" y "1º A" son la misma unidad, y el 270 no es el 159.
function mismaExpensa(a, b) {
    return mismoEdificio(a.edificio, b.edificio)
        && claveUnidad(a.departamento) === claveUnidad(b.departamento)
        && String(a.periodo || '').toLowerCase().trim() === String(b.periodo || '').toLowerCase().trim();
}

function aNumero(txt) {
    const limpio = String(txt).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const n = Number(limpio);
    return isFinite(n) && limpio !== '' ? n : null;
}

// Una fecha que no se entiende NO se inventa: va en null. `vencimiento` es DATE, y un texto que
// PostgreSQL no puede leer rechaza el INSERT entero, que es justamente lo que vinimos a arreglar.
function aFecha(txt) {
    const s = String(txt).trim();
    if (!s) return null;
    const dmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return null;
}

async function main() {
    await initPgSchema();

    const doc = await getSheet();
    const hoja = pestaña(doc, TAB);
    if (!hoja) {
        console.error(`✖ No existe la pestaña "${TAB}" en la planilla. Nada que importar.`);
        process.exit(1);
    }
    const filas = await hoja.getRows();

    const { rows: enPg } = await pool.query(
        `SELECT id, edificio, departamento, periodo FROM expensas`
    );

    const faltan = [];
    const yaEstan = [];
    const sinEdificio = [];

    for (const f of filas) {
        const estado = v(f, 'estado').toLowerCase();
        if (estado === 'eliminada') continue;

        const fila = {
            fecha: v(f, 'fecha'),
            edificio: v(f, 'edificio'),
            periodo: v(f, 'periodo'),
            formato: v(f, 'formato'),
            nombre: v(f, 'nombre'),
            url: v(f, 'url'),
            estado: estado || 'publicada',
            departamento: v(f, 'departamento'),
            monto: aNumero(v(f, 'monto')),
            vencimiento: aFecha(v(f, 'vencimiento')),
            monto_origen: v(f, 'monto_origen').toLowerCase(),
        };

        // Sin edificio no se puede saber de quién es, y el portal busca por edificio: escribirla
        // sería una fila que nadie va a ver nunca.
        if (!fila.edificio) { sinEdificio.push(fila); continue; }

        if (enPg.some(p => mismaExpensa(p, fila))) yaEstan.push(fila);
        else faltan.push(fila);
    }

    console.log(`\n📄 Pestaña "${TAB}": ${filas.length} fila(s). En PostgreSQL: ${enPg.length}.`);
    console.log(`   ✅ ya estaban en las dos: ${yaEstan.length}`);
    console.log(`   ➕ faltan en PostgreSQL:  ${faltan.length}`);
    if (sinEdificio.length) {
        console.log(`   ⚠️  sin edificio (no se importan): ${sinEdificio.length}`);
    }

    if (!faltan.length) {
        console.log('\nNo hay nada que traer. Si el vecino igual no ve su expensa, el problema no es este:');
        console.log('revisá que el departamento de la fila sea el mismo que el de la unidad del vecino.\n');
        return;
    }

    console.log('');
    for (const f of faltan) {
        const monto = f.monto === null ? 'sin monto' : `$${f.monto}`;
        const depto = f.departamento || '(edificio entero)';
        console.log(`   ${f.edificio} · ${depto} · ${f.periodo || 'sin período'} · ${monto}`);
    }

    if (!APLICAR) {
        console.log(`\n👀 No se escribió nada. Para escribirlas: node importar-expensas-a-pg.js --aplicar\n`);
        return;
    }

    let ok = 0;
    const fallaron = [];
    for (const f of faltan) {
        try {
            await pool.query(
                `INSERT INTO expensas (fecha, edificio, periodo, formato, nombre, url, estado,
                                       departamento, monto, vencimiento, monto_origen)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [f.fecha, f.edificio, f.periodo, f.formato, f.nombre, f.url, f.estado,
                 f.departamento || null, f.monto, f.vencimiento, f.monto_origen || null]
            );
            ok++;
        } catch (e) {
            fallaron.push({ f, error: e.message });
        }
    }

    console.log(`\n✅ Escritas: ${ok}`);
    if (fallaron.length) {
        // Se dice fila por fila y fuerte. Una importación a medias que parece completa es peor
        // que una que falla entera: nadie vuelve a mirar.
        console.log(`\n✖ NO se pudieron escribir ${fallaron.length}:`);
        for (const x of fallaron) {
            console.log(`   ${x.f.edificio} · ${x.f.departamento || '(edificio entero)'} · ${x.f.periodo}`);
            console.log(`      ${x.error}`);
        }
    }
    console.log('');
}

main()
    .then(() => pool.end())
    .catch(e => { console.error('✖', e.message); pool.end(); process.exit(1); });
