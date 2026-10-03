#!/usr/bin/env node
// Borra un caso de prueba de LOS DOS LADOS: la pestaña EVENTOS de Sheets y PostgreSQL.
//
//   node borrar-caso.js CASO-1003 CASO-1004            ← muestra qué borraría, NO borra
//   node borrar-caso.js CASO-1003 CASO-1004 --aplicar   ← lo borra
//
// > [!CAUTION]
// > **Esto borra. No hay papelera.** Por eso, antes de tocar nada, imprime el caso ENTERO --
// > incluidas las conversaciones-- para que quede en la terminal. Un caso raro es evidencia de
// > algo, y borrarlo antes de leerlo destruye la única copia de lo que pasó.
//
// Se borra de los dos lados a propósito. La pestaña EVENTOS alimenta el panel, pero las burbujas
// de la conversación viven en la tabla `mensajes` de PostgreSQL: borrar solo de Sheets deja el
// caso "desaparecido" del panel y el chat viejo reapareciendo mezclado con el caso siguiente.
//
// NO toca clientes, edificios, proveedores ni facturas: solo el caso que se le nombra.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const aplicar = process.argv.includes('--aplicar');
const ids = process.argv.slice(2)
    .filter(a => !a.startsWith('--'))
    .map(a => a.toUpperCase().replace(/\s+/g, '-'));

if (!ids.length) {
    console.log('\nDecime qué caso borrar:  node borrar-caso.js CASO-1003 [CASO-1004] [--aplicar]\n');
    process.exit(1);
}

const lista = (raw) => {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [String(v)]; }
    catch { return String(raw).split('\n').filter(Boolean); }
};

(async () => {
    const sheets = require('./sheets');
    const doc = await sheets.getSheet();

    const hoja = (nombre) => {
        const t = Object.keys(doc.sheetsByTitle || {})
            .find(x => String(x).toLowerCase().trim() === nombre.toLowerCase());
        return t ? doc.sheetsByTitle[t] : null;
    };

    const hojaEventos = hoja('EVENTOS');
    if (!hojaEventos) { console.log('\n❌ No existe la pestaña EVENTOS.\n'); process.exit(1); }

    const filas = await hojaEventos.getRows();
    const filasEdificios = hoja('EDIFICIOS') ? await hoja('EDIFICIOS').getRows() : [];

    console.log(aplicar ? '\n🗑️  BORRANDO de Sheets y de PostgreSQL.\n' : '\n👀 SOLO MIRANDO. Para borrar de verdad agregá --aplicar\n');

    const aBorrar = [];

    for (const id of ids) {
        const fila = filas.find(f => String(f.get('id_evento') || '').toUpperCase().trim() === id);
        if (!fila) { console.log(`⬜ ${id}: no está en EVENTOS.\n`); continue; }

        const edificio = fila.get('edificio') || '';

        console.log(`══════ ${id} ══════`);
        console.log(`  Fecha:    ${fila.get('fecha') || '—'}`);
        console.log(`  Edificio: ${edificio || '—'}   ·   Estado: ${fila.get('estado') || '—'}`);
        console.log(`  Rubro:    ${fila.get('rubro_tecnico') || '—'}`);
        console.log(`  Técnico:  ${fila.get('tecnico') || '—'} ${fila.get('tel_tecnico') ? `(${fila.get('tel_tecnico')})` : ''}`);
        console.log(`  Vecino:   ${fila.get('vecino') || '—'} ${fila.get('telefono') ? `(${fila.get('telefono')})` : ''}`);
        console.log(`  Pedido:   ${String(fila.get('mensaje') || '').replace(/\s+/g, ' ').slice(0, 200)}`);

        // POR QUÉ SE MUESTRA ESTO. Al técnico Marcos le habla siempre con la DIRECCIÓN de la calle
        // (`direccionParaTecnico`), nunca con el nombre interno del edificio. Si Marcos nombró una
        // altura distinta de la que muestra el panel, casi siempre es que la columna `direccion`
        // de ese edificio está mal cargada -- no que se hayan cruzado dos casos. Se imprime acá
        // porque después de borrar el caso ya no hay con qué comprobarlo.
        const filaEdif = filasEdificios.find(f => {
            const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
            return norm(f.get('edificio')) === norm(edificio) || norm(f.get('nombre')) === norm(edificio);
        });
        if (filaEdif) {
            console.log(`  ── el edificio, en EDIFICIOS ──`);
            console.log(`     edificio:  "${filaEdif.get('edificio') || ''}"`);
            console.log(`     nombre:    "${filaEdif.get('nombre') || ''}"`);
            console.log(`     direccion: "${filaEdif.get('direccion') || ''}"   ← esto es lo que Marcos le dice al técnico`);
            console.log(`     aliases:   "${filaEdif.get('aliases') || ''}"`);
        } else {
            console.log(`  ⚠️ "${edificio}" no aparece en EDIFICIOS: por eso Marcos no puede resolver su dirección.`);
        }

        for (const [titulo, campo] of [['CON EL VECINO', 'chat_vecino_json'], ['CON EL PROVEEDOR', 'chat_proveedor_json']]) {
            const msgs = lista(fila.get(campo));
            if (!msgs.length) continue;
            console.log(`  ── ${titulo} ──`);
            msgs.forEach(m => console.log(`     · ${String(typeof m === 'object' ? JSON.stringify(m) : m).replace(/\s+/g, ' ').slice(0, 220)}`));
        }
        console.log('');

        aBorrar.push({ id, fila });
    }

    if (!aBorrar.length) { console.log('Nada que borrar.\n'); process.exit(0); }

    if (!aplicar) {
        console.log(`Se borrarían ${aBorrar.length} caso(s): ${aBorrar.map(x => x.id).join(', ')}`);
        console.log('Nada se tocó. Para borrar:  node borrar-caso.js ' + ids.join(' ') + ' --aplicar\n');
        process.exit(0);
    }

    // 1) Sheets. De atrás para adelante: borrar una fila corre las de abajo, y hacerlo en orden
    // directo haría que la segunda referencia apunte a otra fila.
    for (const { id, fila } of [...aBorrar].reverse()) {
        try {
            await fila.delete();
            console.log(`🗑️  ${id}: borrado de EVENTOS.`);
        } catch (e) {
            console.error(`❌ ${id}: NO se pudo borrar de EVENTOS → ${e.message}`);
        }
    }

    // 2) PostgreSQL: el caso y las burbujas de su conversación.
    try {
        const { pool } = require('./db-pg');
        for (const { id } of aBorrar) {
            const r1 = await pool.query('DELETE FROM reportes WHERE UPPER(codigo_caso) = $1', [id]);
            const r2 = await pool.query('DELETE FROM mensajes WHERE UPPER(evento_id) = $1', [id]);
            console.log(`🗑️  ${id}: PostgreSQL → ${r1.rowCount} reporte(s), ${r2.rowCount} mensaje(s).`);
        }
        await pool.end();
    } catch (e) {
        console.error(`❌ No se pudo borrar de PostgreSQL → ${e.message}`);
        console.error('   Ojo: si esto falla, las burbujas del chat siguen ahí y el panel las va a');
        console.error('   volver a mostrar mezcladas con el caso siguiente.');
        process.exit(1);
    }

    console.log('\n✅ Listo. Comprobá con:  node revisar-casos.js 5\n');
    process.exit(0);
})();
