#!/usr/bin/env node
/**
 * LEVANTAR MARCOS EN UN SERVIDOR NUEVO, DESDE UN RESPALDO
 *
 *   node restaurar-backup.js marcos-backup-2026-09-20T....tar.gz            # muestra qué haría
 *   node restaurar-backup.js marcos-backup-2026-09-20T....tar.gz --aplicar  # lo hace
 *
 * > [!CAUTION]
 * > **Un respaldo que nadie restauró nunca no es un respaldo: es un archivo.**
 * > El 30/08/2026 el VPS quedó cuatro días inaccesible. Tener el `.tar.gz` bajado no alcanza si el
 * > día del incendio hay que averiguar, con el edificio sin portero y el administrador llamando,
 * > en qué orden va cada cosa.
 *
 * Este script existe para que **la primera vez que restaures no sea el día que se rompió todo**.
 * Corrélo una vez en un VPS de prueba, cronometrá cuánto tardás, y anotá ese número: eso es lo que
 * de verdad podés prometerle a un cliente cuando pregunte qué pasa si se cae el sistema.
 *
 * QUÉ HACE, EN ORDEN
 *
 *   1. Abre el respaldo y verifica que tenga las tres cosas que no se recuperan de otro lado:
 *      credenciales, volcado de PostgreSQL, y la multimedia.
 *   2. Descomprime el código y las credenciales.
 *   3. Restaura PostgreSQL desde el volcado.
 *   4. Deja dicho qué falta hacer a mano (npm install, pm2, nginx).
 *
 * > [!CAUTION]
 * > **Sin `--aplicar` no toca nada.** Y con `--aplicar` sobre una base que YA tiene datos, el
 * > volcado los reemplaza (se crea con `--clean --if-exists`). Por eso pide confirmación escrita
 * > cuando detecta que la base no está vacía: restaurar encima de un Marcos vivo es la forma más
 * > rápida de convertir un susto en un desastre.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APLICAR = process.argv.includes('--aplicar');
const SI_ENCIMA = process.argv.includes('--si-encima');
const archivo = process.argv.slice(2).find(a => !a.startsWith('--'));

if (!archivo) {
    console.error('\nUso: node restaurar-backup.js <archivo.tar.gz> [--aplicar]\n');
    process.exit(1);
}
if (!fs.existsSync(archivo)) {
    console.error(`\n❌ No encuentro ${archivo}\n`);
    process.exit(1);
}

const destino = process.env.RESTAURAR_EN || __dirname;

console.log(`\n🔄 RESTAURAR MARCOS`);
console.log(`   Respaldo: ${archivo}`);
console.log(`   Destino:  ${destino}`);
console.log(`   Modo:     ${APLICAR ? '⚠️  APLICAR (escribe de verdad)' : 'solo mostrar'}\n`);

// ── 1. ¿QUÉ TIENE ADENTRO? ──────────────────────────────────────────────────────────────────
let contenido;
try {
    // > [!CAUTION]
    // > **En Windows, `tar` termina cada línea con `\r`**, y este script se corre justamente ahí:
    // > el respaldo se baja a la PC y se verifica desde la PC.
    // >
    // > Sin limpiarlo, `l === '.env'` y las expresiones ancladas con `$` fallan todas, mientras
    // > que `startsWith('almacenamiento/')` sigue andando — así que el informe decía que faltaban
    // > las credenciales y la base, y que la multimedia estaba. Los cuatro resultados mal, de
    // > forma verosímil, sobre un respaldo perfecto. Es el peor tipo de error: te hace desconfiar
    // > de algo que está bien.
    //
    // También se normalizan las barras, por si algún `tar` lista con `\\`.
    contenido = execFileSync('tar', ['-tzf', archivo], { encoding: 'utf8' })
        .split('\n')
        .map(l => l.replace(/\r$/, '').replace(/\\/g, '/'))
        .filter(Boolean);
} catch (err) {
    console.error(`❌ No se puede leer el respaldo: ${err.message}\n`);
    process.exit(1);
}

const tiene = (n) => contenido.some(l => l === n || l.endsWith('/' + n));
const dump = contenido.find(l => /(^|\/)postgres-.*\.sql$/.test(l));
const multimedia = contenido.filter(l => l.startsWith('almacenamiento/') && !l.endsWith('/')).length;
const google = contenido.filter(l => /gen-lang-client-.*\.json$/.test(l));

console.log('📋 Contenido:');
console.log(`   ${tiene('.env') ? '✅' : '❌'} .env`);
console.log(`   ${google.length ? '✅' : '❌'} credencial de Google (${google.length})`);
console.log(`   ${dump ? '✅' : '❌'} volcado de PostgreSQL${dump ? ` → ${path.basename(dump)}` : ''}`);
console.log(`   ${multimedia ? '✅' : '⚠️ '} multimedia: ${multimedia} archivos`);
console.log(`   ℹ️  ${contenido.length} archivos en total\n`);

// > [!CAUTION]
// > **Un respaldo sin el volcado de la base NO sirve para levantar Marcos en otro lado.** Te
// > devuelve las credenciales y ningún vecino, ningún pase QR y ningún historial. Los respaldos
// > anteriores al 20/09/2026 son así: `crear-backup.js` no corría `pg_dump`.
if (!dump) {
    console.error('❌ ESTE RESPALDO NO TIENE LA BASE DE DATOS.');
    console.error('   Sirve para recuperar credenciales, no para levantar el sistema.');
    console.error('   Los respaldos hechos antes del 20/09/2026 son así: no se volcaba PostgreSQL.');
    console.error('   Hacé uno nuevo con `node crear-backup.js` apenas puedas.\n');
    if (APLICAR) process.exit(1);
}

if (!APLICAR) {
    console.log('🔍 Sin `--aplicar` no toco nada. Lo que haría:\n');
    console.log(`   1. tar -xzf ${path.basename(archivo)} -C ${destino}`);
    if (dump) console.log(`   2. psql -d $DATABASE_URL -f ${dump}`);
    console.log(`   3. npm install --omit=dev`);
    console.log(`   4. pm2 start index.js --name marcos-ai\n`);
    console.log('   Para hacerlo de verdad: agregá --aplicar\n');
    process.exit(0);
}

// ── 2. DESCOMPRIMIR ─────────────────────────────────────────────────────────────────────────
console.log('📂 Descomprimiendo …');
try {
    fs.mkdirSync(destino, { recursive: true });
    execFileSync('tar', ['-xzf', path.resolve(archivo), '-C', destino], { stdio: 'inherit' });
    console.log('   ✅ Archivos en su lugar.\n');
} catch (err) {
    console.error(`\n❌ No se pudo descomprimir: ${err.message}\n`);
    process.exit(1);
}

// ── 3. POSTGRESQL ───────────────────────────────────────────────────────────────────────────
if (dump) {
    try { require('dotenv').config({ path: path.join(destino, '.env') }); } catch (_) {}
    const urlPg = require('./credenciales').urlPostgres();

    // ¿La base ya tiene algo? Restaurar encima de un Marcos vivo borra lo que hay: el volcado se
    // crea con `--clean --if-exists`, así que las tablas se eliminan y se vuelven a crear.
    let filasVecinos = null;
    try {
        filasVecinos = execFileSync('psql', ['-d', urlPg, '-t', '-A', '-c',
            "SELECT COALESCE((SELECT COUNT(*) FROM vecinos), 0)"], { encoding: 'utf8' }).trim();
    } catch (_) { /* la base puede no existir todavía: eso es lo normal en un servidor nuevo */ }

    if (filasVecinos && Number(filasVecinos) > 0 && !SI_ENCIMA) {
        console.error(`⚠️  LA BASE DE DESTINO YA TIENE DATOS (${filasVecinos} vecinos).`);
        console.error('   Restaurar encima los REEMPLAZA. Si es lo que querés, repetí el comando');
        console.error('   agregando --si-encima. Si no, parate acá: puede ser el Marcos que anda.\n');
        process.exit(1);
    }

    console.log('🗄️  Restaurando PostgreSQL …');
    try {
        execFileSync('psql', ['-d', urlPg, '-v', 'ON_ERROR_STOP=1', '-f', path.join(destino, dump)],
            { stdio: ['ignore', 'inherit', 'inherit'] });
        console.log('   ✅ Base restaurada.\n');
    } catch (err) {
        console.error(`\n❌ FALLÓ LA RESTAURACIÓN DE LA BASE: ${err.message}`);
        console.error('   Los archivos SÍ se descomprimieron. La base NO quedó restaurada.');
        console.error('   No arranques Marcos así: escribiría sobre una base a medias.\n');
        process.exit(1);
    }

    // El volcado tiene la base entera en texto plano. No se queda en disco.
    try { fs.unlinkSync(path.join(destino, dump)); } catch (_) {}
}

// ── 4. LO QUE FALTA, DICHO SIN VUELTAS ──────────────────────────────────────────────────────
console.log('✅ RESTAURADO. Lo que queda es a mano:\n');
console.log('   npm install --omit=dev');
console.log('   node verificar-antes-de-subir.js        # que el código esté sano');
console.log('   node revisar-columnas-pg.js             # que la base tenga todas las columnas');
console.log('   pm2 start index.js --name marcos-ai');
console.log('   pm2 save\n');
console.log('   Y en el proveedor de DNS: apuntar marcos.bienargentinos.com a la IP nueva,');
console.log('   más nginx y el certificado SSL.\n');
console.log('⏱️  Cronometrá cuánto tardaste de punta a punta y anotalo.');
console.log('   Ese número es lo que podés prometerle a un cliente cuando pregunte');
console.log('   qué pasa si se cae el sistema.\n');
