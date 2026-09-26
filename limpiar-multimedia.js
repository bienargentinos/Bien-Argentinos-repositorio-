// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta:
// `node /ruta/larga/script.js` desde otra carpeta no encontraba ninguna variable y el script
// reventaba con un error que no decía nada ('path must be a string, received undefined').
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');

/**
 * LIMPIEZA DE MULTIMEDIA — dejar el servidor en cero antes de las pruebas reales
 *
 * Borra los audios, videos, imágenes y documentos acumulados durante el desarrollo. Después de
 * meses de pruebas, esos archivos son basura que ocupa disco y ensucia cualquier revisión: no hay
 * forma de saber si una foto pertenece a un caso real o a la vez que probamos la ráfaga.
 *
 * Borra de dos lugares:
 *   temp/            — lo que se descarga de WhatsApp y las notas de voz generadas
 *   almacenamiento/  — los archivos que se guardan de forma permanente por edificio
 *
 * NO toca la base de datos ni la planilla. Eso es a propósito: borrar archivos y borrar registros
 * son dos decisiones distintas y conviene tomarlas por separado.
 *
 *   node limpiar-multimedia.js              → informa qué borraría, sin borrar
 *   node limpiar-multimedia.js --confirmar  → borra
 *   node limpiar-multimedia.js --temp       → solo la carpeta temporal
 *   node limpiar-multimedia.js --dias 30    → solo lo anterior a 30 días
 */

const args = process.argv.slice(2);
const CONFIRMAR = args.includes('--confirmar');
const SOLO_TEMP = args.includes('--temp');
const SOLO_ALMACEN = args.includes('--almacenamiento');

const idxDias = args.indexOf('--dias');
const DIAS = idxDias >= 0 ? parseInt(args[idxDias + 1], 10) : null;
const LIMITE_FECHA = Number.isFinite(DIAS) ? Date.now() - DIAS * 24 * 60 * 60 * 1000 : null;

const EXTENSIONES = new Set(['.ogg', '.oga', '.mp3', '.m4a', '.wav', '.opus',
                             '.jpg', '.jpeg', '.png', '.webp', '.gif',
                             '.mp4', '.3gp', '.mov', '.pdf']);

function formatearTamaño(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Recorre una carpeta y sus subcarpetas juntando los archivos multimedia. */
function recolectar(dir, encontrados = []) {
    if (!fs.existsSync(dir)) return encontrados;
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
            recolectar(completo, encontrados);
            continue;
        }
        if (!EXTENSIONES.has(path.extname(entrada.name).toLowerCase())) continue;

        const stat = fs.statSync(completo);
        // Con --dias se respeta lo reciente: sirve para limpiar sin perder el caso que está en
        // curso ahora mismo.
        if (LIMITE_FECHA && stat.mtimeMs > LIMITE_FECHA) continue;

        encontrados.push({ ruta: completo, bytes: stat.size, fecha: stat.mtime });
    }
    return encontrados;
}

function procesarCarpeta(nombre, dir) {
    const archivos = recolectar(dir);
    const bytes = archivos.reduce((a, f) => a + f.bytes, 0);

    console.log(`\n── ${nombre} ──`);
    console.log(`   ${dir}`);

    if (archivos.length === 0) {
        console.log('   ✅ No hay archivos multimedia para borrar.');
        return { archivos: 0, bytes: 0, borrados: 0 };
    }

    // Desglose por tipo, para que se vea qué se está por borrar y no sea un número a ciegas.
    const porTipo = {};
    for (const f of archivos) {
        const ext = path.extname(f.ruta).toLowerCase();
        porTipo[ext] = porTipo[ext] || { cantidad: 0, bytes: 0 };
        porTipo[ext].cantidad++;
        porTipo[ext].bytes += f.bytes;
    }
    for (const [ext, d] of Object.entries(porTipo).sort((a, b) => b[1].bytes - a[1].bytes)) {
        console.log(`   ${ext.padEnd(6)} ${String(d.cantidad).padStart(5)} archivo(s)  ${formatearTamaño(d.bytes)}`);
    }

    const masViejo = archivos.reduce((a, f) => (f.fecha < a.fecha ? f : a));
    const masNuevo = archivos.reduce((a, f) => (f.fecha > a.fecha ? f : a));
    console.log(`   Total: ${archivos.length} archivo(s), ${formatearTamaño(bytes)}`);
    console.log(`   Desde ${masViejo.fecha.toLocaleString('es-AR')} hasta ${masNuevo.fecha.toLocaleString('es-AR')}`);

    if (!CONFIRMAR) return { archivos: archivos.length, bytes, borrados: 0 };

    let borrados = 0, fallidos = 0;
    for (const f of archivos) {
        try { fs.unlinkSync(f.ruta); borrados++; } catch (err) {
            fallidos++;
            console.log(`   ⚠️ No se pudo borrar ${path.basename(f.ruta)}: ${err.message}`);
        }
    }
    console.log(`   🗑️  ${borrados} archivo(s) borrado(s)${fallidos ? `, ${fallidos} con error` : ''}`);
    return { archivos: archivos.length, bytes, borrados };
}

function main() {
    console.log(CONFIRMAR
        ? '🧹 Borrando multimedia acumulado...'
        : '🔍 VISTA PREVIA — no se borra nada (agregá --confirmar para borrar)');

    if (LIMITE_FECHA) {
        console.log(`   Solo archivos anteriores a ${DIAS} día(s).`);
    }

    const hacerTemp = !SOLO_ALMACEN;
    const hacerAlmacen = !SOLO_TEMP;

    let total = { archivos: 0, bytes: 0, borrados: 0 };
    const sumar = r => { total.archivos += r.archivos; total.bytes += r.bytes; total.borrados += r.borrados; };

    if (hacerTemp) sumar(procesarCarpeta('Temporales (descargas y notas de voz)', path.join(__dirname, 'temp')));
    if (hacerAlmacen) sumar(procesarCarpeta('Almacenamiento permanente por edificio', path.join(__dirname, 'almacenamiento')));

    console.log('\n' + '─'.repeat(60));
    if (CONFIRMAR) {
        console.log(`✅ ${total.borrados} archivo(s) borrado(s). Se liberaron ${formatearTamaño(total.bytes)}.`);
        console.log('\n⚠️  Los casos YA guardados que apuntaban a estos archivos quedan con el');
        console.log('   reproductor roto en el panel: el registro sigue ahí, el archivo no.');
        console.log('   Si la idea es empezar de cero del todo, corré también:');
        console.log('     node reset-conversacion.js --todo --confirmar');
    } else {
        console.log(`Se borrarían ${total.archivos} archivo(s) y se liberarían ${formatearTamaño(total.bytes)}.`);
        console.log('\nVolvé a correrlo con --confirmar para borrar de verdad.');
    }

    process.exit(0);
}

main();
