#!/usr/bin/env node
// CÓMO SE LLAMA CADA EDIFICIO, DÓNDE QUEDA, Y QUÉ NOMBRES SE USAN QUE NO SON NINGUNO
//
//   node revisar-edificios.js
//
// SOLO LEE. No escribe ni corrige nada.
//
// > [!CAUTION]
// > **No hay un id de edificio: el nombre ES la clave**, y está escrito a mano en siete pestañas.
// > Un nombre que se usa en una asignación y no existe en `EDIFICIOS` no da error en ningún lado:
// > simplemente no encuentra nada, en silencio.
//
// EL CASO QUE LO ORIGINÓ. Buscando por qué una asignación de proveedor no cerraba, apareció que
// `consorcio propietario san patricio 159` estaba en CUATRO asignaciones, en el consejo y en la
// lista de edificios del cliente -- y **no existía como edificio**. Al mismo tiempo, el portal del
// vecino usaba una tercera forma (`San Patricio 159`) para lo que parecía el mismo lugar.
//
// Tres nombres para un lugar, ninguno de los tres verificado contra `EDIFICIOS`. Con eso:
//
//   · `buscarPerfilEdificio` no encuentra la ficha → el técnico recibe el nombre interno en vez de
//     la dirección, o directamente la dirección de otro consorcio.
//   · El permiso del cliente apunta a un edificio que no existe: en el panel le falta uno.
//   · La asignación `edificio + rubro` no matchea → Marcos no sabe a quién llamar.
//
// Esta herramienta muestra las dos cosas juntas: qué edificios hay de verdad, y qué nombres se
// están usando por ahí que no son ninguno de ellos.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const norm = (t) => String(t || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase().trim().replace(/\s+/g, ' ');

// Dónde se escribe el nombre de un edificio, fuera de `EDIFICIOS`.
// pestaña/tabla → columnas que lo guardan.
const USOS = {
    proveedor_asignaciones: ['edificio'],
    consejo:                ['edificio'],
    reportes:               ['edificio'],
    eventos:                ['edificio'],
    facturas:               ['edificio'],
    vecinos:                ['edificio'],
    solicitudes:            ['edificio'],
    sugerencias:            ['edificio'],
    expensas:               ['edificio'],
    reservas_amenities:     ['edificio'],
    usuario_unidades:       ['edificio'],
    edificio_amenities:     ['edificio'],
    accesos:                ['edificio'],
};
// La lista separada por comas de la ficha del cliente.
const LISTAS = { clientes: ['edificios'] };

function columnasDe(mapa, tabla) {
    const k = Object.keys(mapa).find(x => norm(x) === norm(tabla));
    return k ? mapa[k] : null;
}

(async () => {
    let pool = null;

    // ── LOS EDIFICIOS QUE EXISTEN ────────────────────────────────────────────────────────────
    const existentes = new Map();   // nombre normalizado → cómo está escrito

    console.log('\n🏢 EDIFICIOS (la tabla que manda)\n');
    try {
        const doc = await require('./sheets').getSheet();
        const titulo = Object.keys(doc.sheetsByTitle || {}).find(t => norm(t) === 'edificios');
        if (!titulo) {
            console.log('   ⚠️ No existe la pestaña "edificios".');
        } else {
            const hoja = doc.sheetsByTitle[titulo];
            await hoja.loadHeaderRow().catch(() => {});
            const filas = await hoja.getRows();

            for (const f of filas) {
                // `EDIFICIOS` guarda el nombre en DOS columnas que son alias del mismo dato, y el
                // panel y el motor las leen en orden distinto. Las dos cuentan como el nombre.
                const nombres = [f.get('edificio'), f.get('nombre')].filter(Boolean);
                if (!nombres.length) continue;

                const dir = f.get('direccion') || '';
                const alias = f.get('aliases') || '';
                const tipo = f.get('tipo') || '';
                const unidades = f.get('unidades') || '';

                console.log(`   · ${nombres[0]}`);
                if (nombres[1] && norm(nombres[1]) !== norm(nombres[0])) {
                    console.log(`      ⚠️ la otra columna del nombre dice "${nombres[1]}" — son alias del mismo dato y no coinciden`);
                }
                console.log(`      📍 ${dir || '(sin dirección cargada)'}${tipo ? ` · ${tipo}` : ''}${unidades ? ` · ${unidades} unidad(es)` : ''}`);
                if (alias) console.log(`      alias: ${alias}`);

                for (const n of nombres) existentes.set(norm(n), n);
                // Un alias también es una forma legítima de nombrarlo.
                for (const a of String(alias).split(',').map(s => s.trim()).filter(Boolean)) {
                    if (!existentes.has(norm(a))) existentes.set(norm(a), `${a} (alias de ${nombres[0]})`);
                }
            }
        }
    } catch (e) {
        console.error(`   ❌ No se pudo leer Google Sheets: ${e.message}`);
        process.exit(1);
    }

    if (!existentes.size) {
        console.log('\n⚠️ No se pudo leer ningún edificio. Sin eso no tiene sentido revisar el resto.\n');
        process.exit(1);
    }

    // ── NOMBRES QUE SE USAN Y NO SON NINGUNO ─────────────────────────────────────────────────
    const huerfanos = new Map();   // nombre normalizado → { texto, lugares: [] }

    const anotar = (valor, lugar) => {
        const v = String(valor || '').trim();
        if (!v) return;
        if (existentes.has(norm(v))) return;
        if (!huerfanos.has(norm(v))) huerfanos.set(norm(v), { texto: v, lugares: [] });
        huerfanos.get(norm(v)).lugares.push(lugar);
    };

    console.log('\n🔎 Nombres de edificio usados en el resto del sistema\n');

    try {
        const doc = await require('./sheets').getSheet();
        for (const titulo of Object.keys(doc.sheetsByTitle || {})) {
            const cols = columnasDe(USOS, titulo);
            const listas = columnasDe(LISTAS, titulo);
            if (!cols && !listas) continue;

            const hoja = doc.sheetsByTitle[titulo];
            await hoja.loadHeaderRow().catch(() => {});
            let filas = [];
            try { filas = await hoja.getRows(); } catch { continue; }

            for (const f of filas) {
                for (const c of (cols || [])) anotar(f.get(c), `📄 ${titulo}.${c}`);
                for (const c of (listas || [])) {
                    for (const parte of String(f.get(c) || '').split(',')) anotar(parte, `📄 ${titulo}.${c}`);
                }
            }
        }
    } catch (e) {
        console.error(`   ⚠️ No se pudo recorrer las pestañas: ${e.message}`);
    }

    try {
        ({ pool } = require('./db-pg'));
        const { rows: columnas } = await pool.query(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type IN ('text','character varying','character')
        `);
        for (const { table_name: tabla, column_name: col } of columnas) {
            const esUso = (columnasDe(USOS, tabla) || []).includes(norm(col));
            const esLista = (columnasDe(LISTAS, tabla) || []).includes(norm(col));
            if (!esUso && !esLista) continue;

            let res;
            try {
                res = await pool.query(`SELECT "${col}" AS v FROM "${tabla}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`);
            } catch { continue; }

            for (const fila of res.rows) {
                if (esLista) for (const parte of String(fila.v).split(',')) anotar(parte, `🐘 ${tabla}.${col}`);
                else anotar(fila.v, `🐘 ${tabla}.${col}`);
            }
        }
    } catch (e) {
        console.error(`   ⚠️ No se pudo revisar PostgreSQL: ${e.message}`);
    }

    if (!huerfanos.size) {
        console.log('   ✅ Todos los nombres usados corresponden a un edificio que existe.\n');
    } else {
        for (const { texto, lugares } of huerfanos.values()) {
            const cuenta = lugares.reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
            console.log(`   ❌ "${texto}" — no es ningún edificio de EDIFICIOS`);
            for (const [lugar, n] of Object.entries(cuenta)) {
                console.log(`      ${lugar}${n > 1 ? ` (${n} filas)` : ''}`);
            }
        }
        console.log('');
        console.log(`   ${huerfanos.size} nombre(s) apuntando a la nada. Nada de esto da error: simplemente`);
        console.log('   no encuentra la ficha del edificio, y desde afuera se ve como que Marcos');
        console.log('   "no sabe" la dirección o a quién llamar.');
        console.log('');
        console.log('   Se corrigen con (primero sin --aplicar, que solo muestra):');
        console.log('     node renombrar-edificio.js "<el nombre huérfano>" "<el nombre de EDIFICIOS>"');
        console.log('');
        console.log('   Antes de elegir, mirá la dirección de cada uno acá arriba: dos edificios de');
        console.log('   la misma calle con distinta altura son DOS consorcios distintos.\n');
    }

    try { if (pool) await pool.end(); } catch {}
    process.exit(0);
})();
