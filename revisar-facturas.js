#!/usr/bin/env node
// Muestra las últimas facturas registradas y dónde quedó cada una. Solo lee: no escribe nada.
//
//   node revisar-facturas.js          ← las últimas 15
//   node revisar-facturas.js 40       ← las últimas 40
//
// PARA QUÉ SIRVE. Cuando un técnico manda una factura y en el panel no aparece, hay tres cosas
// distintas que se ven igual desde afuera:
//
//   1. Marcos no la reconoció como factura  → no hay fila en ningún lado.
//   2. La reconoció pero no supo de qué edificio es → la fila está, con estado "Sin imputar".
//      NO se perdió: está esperando que el técnico conteste de qué obra era.
//   3. Se guardó en una pestaña distinta (mayúsculas) → la fila está, pero en otro lado.
//
// Este script las distingue. Si la factura no aparece acá, el motivo está en el log del bot:
//   pm2 logs marcos-ai --lines 300 --nostream | grep "🧾"

// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const cuantas = Number(process.argv[2]) || 15;

(async () => {
    const sheets = require('./sheets');
    const doc = await sheets.getSheet();

    // Todas las pestañas que se llamen "facturas", sin importar cómo estén escritas. Si hay más
    // de una, eso solo ya es el problema.
    const titulos = Object.keys(doc.sheetsByTitle || {})
        .filter(t => String(t).toLowerCase().trim() === 'facturas');

    if (titulos.length === 0) {
        console.log('\n❌ No existe ninguna pestaña de facturas en la planilla.\n');
        process.exit(0);
    }
    if (titulos.length > 1) {
        console.log(`\n⚠️ Hay ${titulos.length} pestañas de facturas: ${titulos.map(t => `"${t}"`).join(', ')}.`);
        console.log('   Las facturas están repartidas entre ellas. Hay que unificarlas a mano en la planilla.\n');
    }

    for (const titulo of titulos) {
        const hoja = doc.sheetsByTitle[titulo];
        const filas = await hoja.getRows();
        const ultimas = filas.slice(-cuantas);

        console.log(`\n📄 Pestaña "${titulo}" — ${filas.length} factura(s) en total. Últimas ${ultimas.length}:\n`);

        for (const f of ultimas) {
            const estado = String(f.get('estado') || '').trim();
            const edificio = String(f.get('edificio') || '').trim();
            const sinImputar = !edificio || edificio === 'No especificado' || /sin imputar/i.test(estado);

            console.log(`   ${sinImputar ? '🟠' : '🟢'} ${f.get('fecha') || 's/fecha'}  ·  ${f.get('proveedor') || 'sin proveedor'}`);
            console.log(`      Edificio: ${edificio || '— SIN IMPUTAR —'}${estado ? `  ·  Estado: ${estado}` : ''}`);
            if (f.get('monto'))          console.log(`      Monto: ${f.get('monto')}${f.get('numero_factura') ? `  ·  N° ${f.get('numero_factura')}` : ''}`);
            if (f.get('enviada_por'))    console.log(`      La mandó: ${f.get('enviada_por')}`);
            if (f.get('nota_tecnico'))   console.log(`      Dijo: "${String(f.get('nota_tecnico')).slice(0, 140)}"`);
            if (f.get('url_archivo'))    console.log(`      Archivo: ${f.get('url_archivo')}`);
            console.log('');
        }

        const sinImputar = filas.filter(f => {
            const e = String(f.get('edificio') || '').trim();
            return !e || e === 'No especificado' || /sin imputar/i.test(String(f.get('estado') || ''));
        });
        if (sinImputar.length) {
            console.log(`   🟠 ${sinImputar.length} factura(s) sin imputar a ningún consorcio.`);
            console.log(`      No están perdidas: Marcos le preguntó al técnico de qué obra eran y espera respuesta.\n`);
        }
    }

    process.exit(0);
})();
