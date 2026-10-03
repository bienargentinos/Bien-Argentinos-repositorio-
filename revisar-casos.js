#!/usr/bin/env node
// Muestra los últimos casos con todo lo que hace falta para entender qué decidió Marcos.
// Solo lee: no escribe nada.
//
//   node revisar-casos.js          ← los últimos 8
//   node revisar-casos.js 20       ← los últimos 20
//   node revisar-casos.js CASO-1003   ← uno puntual, con la conversación entera
//
// PARA QUÉ SIRVE. Cuando un vecino escribe dos problemas distintos por el mismo chat de WhatsApp
// (la luz de la cochera, y horas después el jardín), Marcos tiene que abrir DOS casos. Acá se ve
// si lo hizo, con qué rubro quedó cada uno, y --lo que más cuesta ver desde afuera-- si la
// conversación quedó bien repartida o si los dos casos tienen los mismos mensajes adentro.

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const arg = process.argv[2] || '';
const unCaso = /^caso[\s-]?\d+/i.test(arg) ? arg.toUpperCase().replace(/\s/g, '-') : '';
const cuantos = unCaso ? 0 : (Number(arg) || 8);

const lista = (raw) => {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [String(v)]; }
    catch { return String(raw).split('\n').filter(Boolean); }
};

const corto = (t, n = 90) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
};

(async () => {
    const sheets = require('./sheets');
    const doc = await sheets.getSheet();

    const titulo = Object.keys(doc.sheetsByTitle || {})
        .find(t => String(t).toLowerCase().trim() === 'eventos');
    if (!titulo) { console.log('\n❌ No existe la pestaña EVENTOS.\n'); process.exit(0); }

    const filas = await doc.sheetsByTitle[titulo].getRows();
    const elegidas = unCaso
        ? filas.filter(f => String(f.get('id_evento') || '').toUpperCase().trim() === unCaso)
        : filas.slice(-cuantos);

    if (!elegidas.length) {
        console.log(unCaso ? `\n❌ No encontré el ${unCaso}.\n` : '\n(No hay casos todavía.)\n');
        process.exit(0);
    }

    console.log(`\n📋 ${elegidas.length} caso(s) de ${filas.length} en total\n`);

    for (const f of elegidas) {
        const id = f.get('id_evento') || '(sin id)';
        const estado = String(f.get('estado') || '').trim();
        const abierto = !['resuelto', 'cerrado'].includes(estado.toLowerCase());
        const chatV = lista(f.get('chat_vecino_json'));
        const chatP = lista(f.get('chat_proveedor_json'));

        console.log(`${abierto ? '🟢' : '⚪'} ${id}  ·  ${f.get('fecha') || 's/fecha'}`);
        console.log(`   Edificio: ${f.get('edificio') || '—'}   ·   Estado: ${estado || '—'}`);
        // El teléfono del técnico va aparte del del vecino: es el que el administrador necesita
        // para llamarlo si tiene una duda del trabajo o del monto. Sin mostrarlo, un caso abierto
        // por el propio proveedor parecía no tener a nadie detrás.
        const telTec = f.get('tel_tecnico') || '';
        console.log(`   Rubro: ${f.get('rubro_tecnico') || '— SIN RUBRO —'}   ·   Técnico: ${f.get('tecnico') || '—'}${telTec ? ` (${telTec})` : ''}`);
        console.log(`   Vecino: ${f.get('vecino') || '—'}${f.get('depto') ? ` (${f.get('depto')})` : ''}   ·   Tel: ${f.get('telefono') || '—'}`);
        if (!f.get('rubro_tecnico')) {
            console.log(`   ⚠️ Sin rubro: no se puede saber si un reclamo nuevo de este vecino es OTRO caso o la continuación de este.`);
        }
        console.log(`   El pedido: ${corto(f.get('mensaje'), 120) || '—'}`);
        console.log(`   Conversación: ${chatV.length} mensaje(s) con el vecino · ${chatP.length} con el proveedor`);

        // El seguimiento: es lo que decide si Marcos va a volver a preguntar algo.
        const prox = f.get('proximo_seguimiento');
        if (prox) {
            const t = new Date(prox).getTime();
            const min = Math.round((t - Date.now()) / 60000);
            console.log(`   Próximo control: paso ${f.get('seguimiento_paso') || '?'} · ` +
                (min > 0 ? `en ${min} min` : `VENCIDO hace ${-min} min`) +
                (f.get('seguimiento_nota') ? ` · "${f.get('seguimiento_nota')}"` : ''));
        } else {
            console.log(`   Próximo control: ninguno${abierto ? ' (el caso está abierto y nadie va a volver a preguntar)' : ''}`);
        }

        if (unCaso) {
            if (chatV.length) {
                console.log(`\n   ── CON EL VECINO ──`);
                chatV.forEach(m => console.log(`   · ${corto(typeof m === 'object' ? JSON.stringify(m) : m, 160)}`));
            }
            if (chatP.length) {
                console.log(`\n   ── CON EL PROVEEDOR ──`);
                chatP.forEach(m => console.log(`   · ${corto(typeof m === 'object' ? JSON.stringify(m) : m, 160)}`));
            }
        }
        console.log('');
    }

    // Lo que más importa cuando hay varios casos del mismo vecino: que no compartan la
    // conversación. Si los dos tienen exactamente los mismos mensajes, la separación quedó a
    // medias -- son dos casos con un solo chat repetido adentro.
    if (!unCaso && elegidas.length > 1) {
        const firma = f => lista(f.get('chat_vecino_json')).map(String).join('|');
        const vistos = new Map();
        for (const f of elegidas) {
            const s = firma(f);
            if (!s) continue;
            if (vistos.has(s)) {
                console.log(`⚠️ ${f.get('id_evento')} y ${vistos.get(s)} tienen EXACTAMENTE la misma conversación del vecino.`);
                console.log(`   Son dos casos compartiendo un solo chat: la separación quedó a medias.\n`);
            } else {
                vistos.set(s, f.get('id_evento'));
            }
        }
    }

    if (!unCaso) console.log(`Para ver uno entero:  node revisar-casos.js ${elegidas[elegidas.length - 1].get('id_evento') || 'CASO-1003'}\n`);
    process.exit(0);
})();
