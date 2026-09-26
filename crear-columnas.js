#!/usr/bin/env node
// Crea de una vez las columnas que le faltan a cada pestaña, agrandando la hoja si hace falta.
//
//   node crear-columnas.js              ← muestra qué haría, no toca nada
//   node crear-columnas.js --aplicar    ← lo hace
//
// PARA QUÉ. `asegurarColumnas` ya arregla esto solo, pero recién la próxima vez que Marcos
// escriba en cada pestaña. Correr esto antes de una prueba deja el terreno parejo: si después
// algo sale mal, ya sabemos que no fue por una columna que no existía.
//
// QUÉ TOCA Y QUÉ NO. Solo AGREGA columnas al final. No renombra, no reordena, no borra y no
// escribe en ninguna fila de datos. Eso importa: los datos de las filas viven por POSICIÓN, no
// por nombre, así que mover una columna le cambia el nombre a lo que hay adentro de otra.
//
// Lo que NO hace: rellenar los casos viejos. Un caso que se guardó sin `tel_tecnico` porque la
// columna no existía ya perdió ese dato -- el teléfono está en la conversación del caso, pero no
// en la celda. Esto arregla de acá en adelante.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const NECESARIAS = require('./columnas-necesarias');
const aplicar = process.argv.includes('--aplicar');

(async () => {
    const sheets = require('./sheets');
    const doc = await sheets.getSheet();

    console.log(aplicar
        ? '\n✍️  APLICANDO: se van a agregar las columnas que falten.\n'
        : '\n👀 SOLO MIRANDO. Para hacerlo de verdad: node crear-columnas.js --aplicar\n');

    let creadas = 0;
    let fallaron = 0;

    for (const [nombre, necesarias] of Object.entries(NECESARIAS)) {
        const titulo = Object.keys(doc.sheetsByTitle || {})
            .find(t => String(t).toLowerCase().trim() === nombre.toLowerCase().trim());

        if (!titulo) {
            // > [!CAUTION]
            // > **"Se crea sola" NO es lo mismo que "se crea bien."**
            //
            // El `appendRow` del panel crea la pestaña con `Object.keys(rowData)`: las columnas
            // quedan definidas por la PRIMERA fila que se escriba, y para siempre. Si esa primera
            // fila no trae una columna que después va a hacer falta, el dato se descarta en
            // silencio desde ahí en adelante -- que es exactamente cómo se perdieron `tecnico`,
            // `tel_tecnico` y `rubro_tecnico` en los cuatro primeros casos reales.
            //
            // Con `expensas` esto era una carrera de verdad: si alguien subía una expensa antes de
            // que el panel aprendiera a mandar `departamento` y `monto`, la pestaña nacía con
            // siete columnas y las nuevas no entraban nunca. Crearla acá, completa y vacía, saca
            // el orden de los hechos de la ecuación.
            if (!aplicar) {
                console.log(`⬜ ${nombre}: NO EXISTE. Se crearía con sus ${necesarias.length} columnas.`);
                console.log(`   Si no, nace con las columnas de la primera fila que se escriba, y`);
                console.log(`   lo que falte se descarta en silencio a partir de ahí.\n`);
                continue;
            }
            try {
                await doc.addSheet({ title: nombre, headerValues: necesarias });
                creadas++;
                console.log(`🆕 ${nombre}: pestaña creada con ${necesarias.length} columnas.\n`);
            } catch (err) {
                fallaron++;
                console.log(`🧱 ${nombre}: NO se pudo crear → ${err.message}\n`);
            }
            continue;
        }

        const hoja = doc.sheetsByTitle[titulo];

        let antes = [];
        try {
            await hoja.loadHeaderRow();
            antes = hoja.headerValues || [];
        } catch (err) {
            // Un encabezado repetido rompe la pestaña entera y no se arregla desde el código.
            console.log(`❌ ${titulo}: ${err.message}`);
            console.log(`   Se arregla A MANO en la planilla: borrar la columna repetida.\n`);
            fallaron++;
            continue;
        }

        const puestas = antes.map(h => String(h || '').trim()).filter(Boolean);
        const faltan = necesarias.filter(n => !puestas.includes(n));

        if (!faltan.length) {
            console.log(`✅ ${titulo}: ya tiene todo (${puestas.length} columnas).\n`);
            continue;
        }

        console.log(`🔧 ${titulo}: faltan ${faltan.length} → ${faltan.join(', ')}`);
        if (puestas.length + faltan.length > (hoja.columnCount || 0)) {
            console.log(`   La hoja tiene ${hoja.columnCount} columnas y hacen falta ${puestas.length + faltan.length}: hay que agrandarla.`);
        }

        if (!aplicar) { console.log(''); continue; }

        // `asegurarColumnas` es la misma función que usa Marcos: agranda antes de escribir y
        // avisa si no puede. Se usa esa y no una copia para que no puedan comportarse distinto.
        const quedaron = await sheets.asegurarColumnas(hoja, necesarias, titulo);
        const ahora = quedaron.map(h => String(h || '').trim()).filter(Boolean);
        const siguenFaltando = necesarias.filter(n => !ahora.includes(n));

        if (siguenFaltando.length) {
            console.log(`   ❌ NO se pudieron crear: ${siguenFaltando.join(', ')}\n`);
            fallaron++;
        } else {
            console.log(`   ✅ Listas. La pestaña quedó con ${ahora.length} columnas.\n`);
            creadas += faltan.length;
        }
    }

    if (!aplicar) {
        console.log('Nada se tocó. Para hacerlo:  node crear-columnas.js --aplicar\n');
    } else if (fallaron) {
        console.log(`❌ ${fallaron} pestaña(s) quedaron mal. Mirá arriba: lo que se guarde ahí se va a perder.\n`);
    } else {
        console.log(`✅ ${creadas} columna(s) creadas. Comprobá con:  node revisar-columnas.js\n`);
    }
    process.exit(fallaron ? 1 : 0);
})();
