#!/usr/bin/env node
// Revisa, contra los datos REALES de Google Sheets, si la cartera de cada proveedor se puede
// armar bien. Solo lee: no escribe nada en ningún lado.
//
//   node revisar-cartera.js
//
// Sirve para contestar una pregunta concreta: cuando a Marcos le llega una factura de este
// técnico, ¿contra qué edificios la va a poder validar? Si la cartera sale vacía, Marcos no
// rechaza nada -- pero pregunta de qué edificio es cada comprobante en vez de deducirlo.

require('dotenv').config();
const sheets = require('./sheets');

const norm = t => String(t || '').trim().toLowerCase();
const tel8 = t => String(t || '').replace(/\D/g, '').slice(-8);

(async () => {
    const doc = await sheets.getSheet();

    const leerTab = async nombre => {
        const s = doc.sheetsByTitle[nombre];
        if (!s) return null;
        return await s.getRows();
    };

    const provs = await leerTab('proveedores');
    const asigs = await leerTab('proveedor_asignaciones');
    const clis  = await leerTab('clientes');

    if (!provs) { console.error('❌ No existe la pestaña "proveedores".'); process.exit(1); }
    if (!clis)  { console.error('❌ No existe la pestaña "clientes".'); process.exit(1); }

    const usuariosValidos = new Map(); // usuario/nombre normalizado -> {usuario, edificios[]}
    for (const c of clis) {
        const usuario = String(c.get('usuario') || '').trim();
        const nombre  = String(c.get('nombre') || '').trim();
        const edificios = String(c.get('edificios') || '').split(',').map(s => s.trim()).filter(Boolean);
        const ficha = { usuario, nombre, edificios };
        if (usuario) usuariosValidos.set(norm(usuario), ficha);
        if (nombre)  usuariosValidos.set(norm(nombre), ficha);
    }

    console.log(`\n📇 CLIENTES CARGADOS: ${clis.length}`);
    for (const c of clis) {
        const u = String(c.get('usuario') || '(sin usuario)');
        const eds = String(c.get('edificios') || '').split(',').map(s => s.trim()).filter(Boolean);
        console.log(`   • ${u} — ${eds.length} edificio(s)${eds.length ? ': ' + eds.join(', ') : ''}`);
    }

    console.log(`\n🔧 PROVEEDORES: ${provs.length}`);

    let problemas = 0;
    const telefonosPorCliente = new Map(); // tel8 -> Set(cliente)

    for (const p of provs) {
        const nombre = String(p.get('nombre') || '(sin nombre)').trim();
        const tel    = String(p.get('telefono') || '').trim();
        const cliente = String(p.get('cliente') || '').trim();
        const estado = norm(p.get('estado'));
        const baja = estado === 'eliminado' || estado === 'inactivo';

        const cartera = await sheets.edificiosDelProveedor({ nombre, telefono: tel });

        const asignados = (asigs || []).filter(a =>
            tel8(a.get('telefono') || a.get('proveedor_telefono')) &&
            tel8(a.get('telefono') || a.get('proveedor_telefono')) === tel8(tel)
        );

        console.log(`\n   ── ${nombre}${baja ? '  [DADO DE BAJA]' : ''}`);
        console.log(`      teléfono: ${tel || '(vacío)'}`);
        console.log(`      cliente:  ${cliente || '(vacío)'}`);
        console.log(`      asignaciones directas: ${asignados.length}`);
        console.log(`      CARTERA RESULTANTE: ${cartera.length ? cartera.map(c => c.edificio).join(' | ') : '(vacía)'}`);

        if (cliente && !usuariosValidos.has(norm(cliente))) {
            console.log(`      ⚠️ "${cliente}" NO existe como usuario ni nombre en la pestaña "clientes".`);
            console.log(`         Esa columna no está sumando nada. Los usuarios válidos son: ${[...new Set([...usuariosValidos.values()].map(f => f.usuario))].filter(Boolean).join(', ') || '(ninguno)'}`);
            problemas++;
        }

        if (!baja && cartera.length === 0) {
            console.log(`      ⚠️ Sin cartera: Marcos va a preguntar de qué edificio es cada factura de este proveedor.`);
            problemas++;
        }

        if (tel && cliente) {
            const k = tel8(tel);
            if (!telefonosPorCliente.has(k)) telefonosPorCliente.set(k, new Set());
            telefonosPorCliente.get(k).add(norm(cliente));
        }
    }

    // Un mismo teléfono en varios clientes NO es un error: es el técnico que trabaja para varios
    // administradores. Se informa para que se vea que quedó bien cargado.
    const multiples = [...telefonosPorCliente.entries()].filter(([, s]) => s.size > 1);
    if (multiples.length) {
        console.log(`\n👥 TÉCNICOS CON VARIOS ADMINISTRADORES (esto está bien, es el caso previsto):`);
        for (const [t, s] of multiples) {
            console.log(`   • ...${t} → ${[...s].join(', ')}`);
        }
    }

    console.log(problemas === 0
        ? '\n✅ La cartera se puede armar para todos los proveedores activos.\n'
        : `\n⚠️ ${problemas} cosa(s) para revisar (ver arriba). Nada de esto rompe a Marcos: solo hace que pregunte más.\n`);

    process.exit(0);
})().catch(e => {
    console.error('Error revisando la cartera:', e.message);
    process.exit(1);
});
