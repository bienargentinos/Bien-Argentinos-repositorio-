#!/usr/bin/env node
// Arma un respaldo con lo que NO está en GitHub, y verifica que de verdad haya quedado adentro.
//
//   node crear-backup.js
//
// > [!CAUTION]
// > **Un backup que vive en el mismo servidor no es un backup.**
// > El 30/08/2026 el nodo del proveedor se cayó y el VPS quedó CUATRO DÍAS inaccesible. Todo lo
// > que estuviera guardado adentro de esa máquina era igual de inalcanzable que el original.
// > Este script arma el archivo, pero **el respaldo recién existe cuando lo bajaste a otro lado**.
// > Por eso al terminar imprime el comando exacto para bajarlo y no da la tarea por hecha.
//
// QUÉ SE RESPALDA Y POR QUÉ.
//
//   .env                        el token de Meta es lo único caro de regenerar
//   gen-lang-client-*.json      la llave de la planilla
//   PostgreSQL (pg_dump)        ← ver abajo
//   almacenamiento/             ← ver abajo
//
// > [!CAUTION]
// > **Este script decía que PostgreSQL y `almacenamiento/` no hacían falta, y era falso.**
// >
// > El razonamiento escrito acá era: *"el código está en GitHub y los datos en Google Sheets, eso
// > no hace falta respaldarlo"*. La primera mitad es cierta. La segunda no, y de la peor forma:
// >
// > **PostgreSQL NO es un espejo de Sheets.** `copiarAPg` es "dispará y seguí", la sincronización
// > solo AGREGA, y hay una docena larga de tablas que existen únicamente del lado de PostgreSQL:
// >
// >     usuarios · usuario_unidades · reservas_amenities · edificio_amenities
// >     timbres · pases_qr · eventos_acceso · accesos
// >     mensajes · mensajes_wa · consejo · personal · suscripciones_planes
// >
// > O sea: el portal del vecino entero, la portería entera, y todo el historial de chat que
// > alimenta el visor del panel. Nada de eso está en ninguna planilla.
// >
// > Y **`almacenamiento/` estaba excluido a mano**: son todas las fotos de reclamos, todos los
// > audios y todas las facturas que llegaron alguna vez. Existen en ese disco y en ningún otro
// > lado --`material-caso.js` las recupera de ahí--.
// >
// > El respaldo anterior devolvía las credenciales y perdía todo lo demás. Lo peor de un backup
// > así no es que falte: es que **parece que está**, y uno deja de preocuparse.
//
// La versión anterior de este script las dejaba afuera sin avisar. El comando era:
//
//     tar -a -c -f salida.zip --exclude=... *
//
// y en Linux el `*` NO incluye los archivos que empiezan con punto. Comprobado: el ZIP salía con
// `index.js` adentro y sin `.env`. Informaba éxito igual, mirando el tamaño del archivo.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = __dirname;
const carpeta = path.join(raiz, 'backups');
fs.mkdirSync(carpeta, { recursive: true });

// `.tar.gz` y no `.zip`: GNU tar no sabe hacer zip, así que con extensión .zip generaba un tar
// disfrazado que después Windows no podía abrir. Con .tar.gz el nombre dice la verdad, y tanto
// Windows 10+ (`tar -xf`) como 7-Zip lo abren sin problema.
const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const archivo = path.join(carpeta, `marcos-backup-${sello}.tar.gz`);

// Lo que NO puede faltar. Si alguna no entra, el respaldo no sirve y hay que decirlo fuerte.
//
// Se exige que EXISTAN antes de empezar, no solo que entren al archivo. La primera versión de esto
// armaba la lista con lo que hubiera --`.env` solo si existía-- así que con el .env borrado hacía
// un respaldo sin él y avisaba "✅ Listo". El mismo defecto que vinimos a arreglar: comprobar solo
// lo que ya se sabe que está.
const jsonGoogle = fs.readdirSync(raiz).filter(f => /^gen-lang-client-.*\.json$/.test(f));
const problemas = [];
if (!fs.existsSync(path.join(raiz, '.env'))) problemas.push('.env');
if (!jsonGoogle.length) problemas.push('las credenciales de Google (gen-lang-client-*.json)');

if (problemas.length) {
    console.error(`\n❌ FALTA ${problemas.join(' y ')} en esta carpeta.`);
    console.error('   Un respaldo sin eso no sirve para levantar Marcos en otro servidor: es');
    console.error('   justamente lo único que no está en GitHub ni en Google Sheets.');
    console.error(`   ¿Estás parado en la carpeta correcta? (${raiz})\n`);
    process.exit(1);
}

// ── EL VOLCADO DE POSTGRESQL ────────────────────────────────────────────────────────────────
//
// Va primero porque es lo que no se puede reconstruir de ningún lado. Si esto falla, el respaldo
// NO se arma: mejor ningún backup que uno al que le falta la base y parece completo.
//
// La URL sale del `.env` como la lee `db-pg.js`, para que no haya dos formas de conectarse.
const relDump = path.join('backups', `postgres-${sello}.sql`);
const absDump = path.join(raiz, relDump);

try { require('dotenv').config(); } catch (_) {}
const urlPg = require('./credenciales').urlPostgres();

console.log('\n🗄️  Volcando PostgreSQL …');
try {
    // `--no-owner` y `--no-acl` para que el volcado se pueda restaurar en un servidor nuevo donde
    // los roles todavía no existen. Sin eso, restaurar en un VPS limpio falla en la primera línea
    // --y restaurar en un VPS limpio es exactamente para lo que existe este archivo--.
    execFileSync('pg_dump', ['--no-owner', '--no-acl', '--clean', '--if-exists', '-d', urlPg, '-f', absDump],
        { stdio: ['ignore', 'inherit', 'inherit'] });
} catch (err) {
    console.error(`\n❌ NO SE PUDO VOLCAR POSTGRESQL: ${err.message}`);
    console.error('   El respaldo NO se arma. Sin la base, restaurar en otro servidor te devuelve');
    console.error('   las credenciales y ningún vecino, ningún pase QR y ningún historial de chat.\n');
    console.error('   Si el problema es que falta pg_dump:');
    console.error('     apt-get install -y postgresql-client\n');
    process.exit(1);
}

const mbDump = (fs.statSync(absDump).size / (1024 * 1024)).toFixed(2);
console.log(`   ✅ ${mbDump} MB de base volcados.`);

// Todo lo que hay, menos lo que se puede volver a bajar o generar. Se listan los nombres a mano
// --incluidos los que empiezan con punto-- en vez de usar `*`, que es lo que dejaba afuera al .env.
//
// `almacenamiento` YA NO SE EXCLUYE: son las fotos, los audios y las facturas, y no están en
// ningún otro lado. Es lo que más pesa y es lo que más duele perder.
const excluidos = new Set(['node_modules', '.git', 'backups', 'temp']);
const aGuardar = fs.readdirSync(raiz).filter(f => !excluidos.has(f) && !f.endsWith('.log'));

// El volcado vive adentro de `backups/`, que está excluido — se nombra aparte para que entre igual.
aGuardar.push(relDump);

const hayMultimedia = fs.existsSync(path.join(raiz, 'almacenamiento'));
if (!hayMultimedia) {
    console.log('\nℹ️  No hay carpeta `almacenamiento/` en este equipo: no hay multimedia que guardar.');
}

// Lo que NO puede faltar adentro del archivo final. El volcado y la multimedia se suman a las
// credenciales: son las tres cosas que no se recuperan de GitHub ni de la planilla.
const imprescindibles = ['.env', ...jsonGoogle, relDump];

console.log(`\n📦 Armando ${path.basename(archivo)} …`);

try {
    execFileSync('tar', ['-czf', archivo, ...aGuardar], { cwd: raiz, stdio: 'inherit' });
} catch (err) {
    console.error(`\n❌ No se pudo armar el respaldo: ${err.message}\n`);
    try { fs.unlinkSync(absDump); } catch (_) {}
    process.exit(1);
}

// ── LO QUE FALTABA: COMPROBAR QUE ESTÉ ADENTRO ──────────────────────────────────────────────
// Que el comando no falle no quiere decir que el archivo tenga lo que tiene que tener.
let adentro = [];
try {
    // Se limpia el `\r` de Windows y se normalizan las barras, igual que en
    // `restaurar-backup.js`: ahí ese detalle hacía que un respaldo bueno se informara como roto.
    adentro = execFileSync('tar', ['-tzf', archivo], { encoding: 'utf8' })
        .split('\n')
        .map(l => l.replace(/\r$/, '').replace(/\\/g, '/'));
} catch (err) {
    console.error(`\n❌ El archivo se creó pero no se puede leer: ${err.message}\n`);
    process.exit(1);
}

const faltan = imprescindibles.filter(f => !adentro.some(l => l === f || l.endsWith('/' + f)));

// LA MULTIMEDIA SE VERIFICA APARTE, contando archivos y no buscando un nombre: `almacenamiento/`
// es un árbol, no un archivo, y que aparezca la carpeta vacía no querría decir nada.
const archivosMultimedia = adentro.filter(l => l.startsWith('almacenamiento/') && !l.endsWith('/')).length;
if (hayMultimedia && archivosMultimedia === 0) {
    faltan.push('almacenamiento/ (la carpeta existe y no entró ni un archivo)');
}

if (faltan.length) {
    console.error(`\n❌ EL RESPALDO NO SIRVE: quedaron afuera ${faltan.join(', ')}`);
    console.error('   Son justamente los archivos que no se pueden recuperar de ningún otro lado.\n');
    fs.unlinkSync(archivo);   // mejor ningún respaldo que uno que parece bueno y está vacío
    try { fs.unlinkSync(absDump); } catch (_) {}
    process.exit(1);
}

// EL VOLCADO SE BORRA ACÁ, ya verificado que entró al archivo. Queda en disco el menor tiempo
// posible: es la base entera en texto plano, con teléfonos, nombres y conversaciones adentro.
try { fs.unlinkSync(absDump); } catch (_) {}

const mb = (fs.statSync(archivo).size / (1024 * 1024)).toFixed(2);
console.log(`\n✅ Listo: ${adentro.filter(Boolean).length} archivos, ${mb} MB`);
console.log(`   Verificado que están adentro:`);
console.log(`     • credenciales: ${['.env', ...jsonGoogle].join(', ')}`);
console.log(`     • PostgreSQL:   ${path.basename(relDump)} (${mbDump} MB)`);
console.log(`     • multimedia:   ${archivosMultimedia} archivos de almacenamiento/`);

console.log(`\n⚠️  ESTE ARCHIVO TIENE TUS CREDENCIALES ADENTRO.`);
console.log(`   No lo subas a GitHub, ni a un Drive compartido, ni lo mandes por chat.`);

console.log(`\n📥 TODAVÍA NO ESTÁ RESPALDADO. Está en el mismo servidor que querés respaldar.`);
console.log(`   Bajalo a tu PC, desde una terminal TUYA (no desde el VPS):\n`);
console.log(`   scp -i %USERPROFILE%\\.ssh\\marcos_vps -P 5436 root@200.58.102.182:${archivo} .\n`);
console.log(`   Recién cuando lo tengas en tu PC el respaldo existe de verdad.\n`);

// Los viejos se acumulan y llenan el disco, que es otra forma conocida de matar un servidor.
const previos = fs.readdirSync(carpeta).filter(f => f.startsWith('marcos-backup-')).sort();
if (previos.length > 5) {
    for (const viejo of previos.slice(0, previos.length - 5)) {
        fs.unlinkSync(path.join(carpeta, viejo));
        console.log(`🧹 Borrado un respaldo viejo: ${viejo}`);
    }
}
process.exit(0);
