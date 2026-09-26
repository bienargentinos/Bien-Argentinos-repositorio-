#!/usr/bin/env node
// Revisa por qué una solicitud aprobada puede no verse reflejada en el edificio.
// Solo lee: no escribe nada.
//
//   node revisar-solicitudes.js
//
// EL PROBLEMA QUE BUSCA: al aprobar, el panel escribe en la PRIMERA columna de `EDIFICIOS` que
// coincida con la lista de nombres alternativos del campo. Pero cuando lee el nombre del
// edificio, usa `edificio` y recién después `nombre`. Si la planilla tiene las dos columnas y
// están en el orden equivocado, la aprobación escribe en una y todo el sistema lee la otra: el
// cambio se guarda, la solicitud figura "aplicada", y el nombre nunca cambia.

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const sheets = require('./sheets');

// Las mismas listas que usa dashboard.js en EDIFICIO_FIELDS.
const CAMPOS = {
    nombre:       ['edificio', 'nombre', 'consorcio'],
    direccion:    ['direccion', 'domicilio'],
    admin_nombre: ['admin_nombre', 'administrador'],
    admin_telefono: ['admin_telefono', 'telefonos', 'telefono_admin'],
};

const norm = t => String(t || '').trim().toLowerCase();

(async () => {
    const doc = await sheets.getSheet();
    const buscarHoja = nombre => {
        const b = nombre.toLowerCase();
        const t = Object.keys(doc.sheetsByTitle || {}).find(x => String(x).toLowerCase().trim() === b);
        return t ? doc.sheetsByTitle[t] : null;
    };

    const hojaEd = buscarHoja('EDIFICIOS');
    if (!hojaEd) { console.error('❌ No existe la pestaña EDIFICIOS.'); process.exit(1); }
    await hojaEd.loadHeaderRow().catch(() => {});
    const headers = hojaEd.headerValues || [];

    console.log('\n📋 COLUMNAS DE "EDIFICIOS", en orden:');
    headers.forEach((h, i) => console.log(`   ${String(i + 1).padStart(2)}. ${h}`));

    console.log('\n🎯 A QUÉ COLUMNA ESCRIBE CADA CAMPO AL APROBAR:');
    let alerta = false;
    for (const [campo, candidatas] of Object.entries(CAMPOS)) {
        const idx = headers.findIndex(h => candidatas.includes(h));
        const escribe = idx >= 0 ? headers[idx] : `(crearía "${candidatas[0]}" al final)`;
        console.log(`   ${campo.padEnd(15)} → escribe en: ${escribe}`);

        // El nombre es el caso delicado: el resto del sistema lee `edificio` y recién `nombre`.
        if (campo === 'nombre') {
            const tieneEdificio = headers.includes('edificio');
            const tieneNombre = headers.includes('nombre');
            const lee = tieneEdificio ? 'edificio' : (tieneNombre ? 'nombre' : '(ninguna)');
            console.log(`   ${''.padEnd(15)}   el resto del sistema LEE de: ${lee}`);
            if (idx >= 0 && headers[idx] !== lee) {
                alerta = true;
                console.log(`   ⚠️  NO COINCIDEN. Se escribe en "${headers[idx]}" y se lee de "${lee}".`);
                console.log(`       Por eso una solicitud aprobada queda guardada pero el nombre no cambia.`);
            }
        }
    }

    const filasEd = await hojaEd.getRows();
    console.log(`\n🏢 EDIFICIOS CARGADOS: ${filasEd.length}`);
    for (const r of filasEd) {
        const partes = ['edificio', 'nombre', 'consorcio']
            .filter(c => headers.includes(c))
            .map(c => `${c}="${r.get(c) || ''}"`);
        console.log(`   • ${partes.join('  |  ') || '(sin columnas de nombre)'}`);
    }

    const hojaSol = buscarHoja('solicitudes');
    if (!hojaSol) {
        console.log('\nℹ️ No existe la pestaña "solicitudes": no hay nada más que revisar.\n');
        process.exit(0);
    }
    const filasSol = await hojaSol.getRows();
    console.log(`\n📨 SOLICITUDES: ${filasSol.length}`);
    for (const s of filasSol) {
        console.log(`   • [${s.get('estado') || 'sin estado'}] campo="${s.get('campo') || ''}"`);
        console.log(`     edificio: "${s.get('edificio') || ''}"`);
        console.log(`     de: "${s.get('valor_actual') || ''}"  →  a: "${s.get('valor_nuevo') || ''}"`);

        // ¿La aprobación encuentra la fila del edificio? Misma comparación que compararEdificios.
        const pedido = norm(s.get('edificio'));
        const coinciden = filasEd.filter(r => {
            const a = norm(r.get('edificio') || r.get('nombre'));
            if (!a || !pedido) return false;
            return a === pedido || (a.length >= 4 && pedido.length >= 4 && (a.includes(pedido) || pedido.includes(a)));
        });
        if (coinciden.length === 0) {
            console.log(`     ⚠️ Ninguna fila de EDIFICIOS coincide con ese nombre: la aprobación no escribe en ningún lado.`);
        } else if (coinciden.length > 1) {
            console.log(`     ⚠️ Coinciden ${coinciden.length} edificios: la aprobación los cambia a TODOS.`);
        } else {
            console.log(`     ✅ Coincide con 1 edificio (fila ${coinciden[0]._rowNumber ?? coinciden[0]._row}).`);
        }
    }

    console.log(alerta
        ? '\n⚠️ Hay una columna de escritura distinta a la de lectura (ver arriba). Ese es el motivo.\n'
        : '\n✅ Las columnas de lectura y escritura coinciden.\n');
    process.exit(0);
})().catch(e => {
    console.error('Error revisando solicitudes:', e.message);
    process.exit(1);
});
