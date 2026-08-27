#!/usr/bin/env node
// Dice si a alguna pestaña de Sheets le falta lugar para las columnas que el código escribe.
// Solo lee: no escribe nada, no crea nada, no agranda nada.
//
//   node revisar-columnas.js
//
// POR QUÉ EXISTE.
//
// Una hoja de Google nace con 26 columnas (A..Z). `EVENTOS` necesita más de treinta. Cuando se
// pasa de ese techo, la librería se planta con "Sheet is not large enough to fit N columns" --y
// hasta hoy los doce lugares que creaban columnas tenían `.catch(() => {})`, así que el error se
// tragaba entero.
//
// Lo que pasa después es lo peor: `addRow` DESCARTA EN SILENCIO toda clave que no sea una columna
// existente. El dato se pasa completo desde index.js, la función devuelve bien, el log dice que
// se guardó, y la celda queda vacía. Así se perdieron `tecnico`, `tel_tecnico` y `rubro_tecnico`
// en los cuatro primeros casos reales: `tel_tecnico` es el teléfono de quien escribe --no puede
// estar vacío-- y en la planilla estaba vacío en los cuatro.
//
// Con el rubro vacío queda muerto todo lo que depende de él y nada avisa: la separación de un
// reclamo nuevo, cuál de los técnicos de una línea compartida escribió, y a qué caso se le imputa
// una factura.
//
// Este script mira las tres cosas que rompen una pestaña por nombre de columna:
//   1. que no haya lugar para las columnas que faltan,
//   2. que no haya un encabezado REPETIDO (la librería se planta y deja de leer por nombre),
//   3. que no falte ninguna columna de las que el código escribe.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// La lista vive en un archivo aparte para que este script y `crear-columnas.js` no puedan
// separarse con el tiempo.
const NECESARIAS = require('./columnas-necesarias');

(async () => {
    const sheets = require('./sheets');
    const doc = await sheets.getSheet();

    let problemas = 0;

    console.log('');
    for (const [nombre, necesarias] of Object.entries(NECESARIAS)) {
        // La pestaña se busca sin que importen las mayúsculas: en esta planilla los nombres están
        // mezclados (EVENTOS en mayúscula, facturas en minúscula).
        const titulo = Object.keys(doc.sheetsByTitle || {})
            .find(t => String(t).toLowerCase().trim() === nombre.toLowerCase().trim());

        if (!titulo) {
            console.log(`⬜ ${nombre}: no existe todavía (se crea sola la primera vez que se escriba).\n`);
            continue;
        }

        const hoja = doc.sheetsByTitle[titulo];

        let headers = [];
        let duplicada = '';
        try {
            await hoja.loadHeaderRow();
            headers = hoja.headerValues || [];
        } catch (err) {
            const m = /Duplicate header detected: "([^"]+)"/.exec(err.message || '');
            if (m) duplicada = m[1];
            else { console.log(`⬜ ${titulo}: ${err.message}\n`); continue; }
        }

        const cabe = hoja.columnCount || 0;
        const puestas = headers.map(h => String(h || '').trim()).filter(Boolean);
        const faltan = necesarias.filter(n => !puestas.includes(n));
        const vacias = headers.length - puestas.length;

        // 2. UN ENCABEZADO REPETIDO ROMPE LA PESTAÑA ENTERA
        if (duplicada) {
            problemas++;
            console.log(`❌ ${titulo}: hay DOS columnas llamadas "${duplicada}".`);
            console.log(`   Mientras estén las dos no se puede leer ni escribir por nombre en esta pestaña.`);
            console.log(`   Se arregla A MANO en la planilla: borrar la que esté de más (mirá antes cuál tiene datos).\n`);
            continue;
        }

        const necesarioTotal = puestas.length + faltan.length;
        const sinLugar = necesarioTotal > cabe;

        if (!faltan.length && !sinLugar) {
            console.log(`✅ ${titulo}: ${puestas.length} columnas puestas, caben ${cabe}. Está completa.`);
            if (vacias > 0) console.log(`   (${vacias} columna(s) sin título — no molestan, pero tampoco sirven.)`);
            console.log('');
            continue;
        }

        problemas++;
        console.log(`❌ ${titulo}: ${puestas.length} columnas puestas, caben ${cabe}.`);
        if (faltan.length) {
            console.log(`   Faltan ${faltan.length}: ${faltan.join(', ')}`);
        }
        // 1. NO HAY LUGAR: este es el que hace que el dato se pierda en silencio.
        if (sinLugar) {
            console.log(`   ⚠️ NO HAY LUGAR para las que faltan: harían falta ${necesarioTotal} columnas y la hoja tiene ${cabe}.`);
            console.log(`   Todo lo que el código guarde en esas columnas SE PIERDE SIN AVISAR.`);
            console.log(`   Se agranda solo la próxima vez que Marcos escriba acá (ahora sí, y lo dice en el log con 📐).`);
            console.log(`   O a mano en la planilla: click derecho en la última columna → "Insertar 10 columnas a la derecha".`);
        } else {
            console.log(`   Hay lugar: se van a crear solas la próxima vez que Marcos escriba acá.`);
        }
        console.log('');
    }

    console.log(problemas === 0
        ? '✅ Ninguna pestaña está perdiendo datos por falta de columnas.\n'
        : `❌ ${problemas} pestaña(s) con problemas. Mirá arriba qué hacer con cada una.\n`);
    process.exit(0);
})();
