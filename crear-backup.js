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
// El código está en GitHub y los datos en Google Sheets: eso no hace falta respaldarlo. Lo único
// que existe en un solo lugar del mundo son las credenciales:
//
//   .env                        el token de Meta es lo único caro de regenerar
//   gen-lang-client-*.json      la llave de la planilla
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

const imprescindibles = ['.env', ...jsonGoogle];

// Todo lo que hay, menos lo que se puede volver a bajar o generar. Se listan los nombres a mano
// --incluidos los que empiezan con punto-- en vez de usar `*`, que es lo que dejaba afuera al .env.
const excluidos = new Set(['node_modules', '.git', 'backups', 'temp', 'almacenamiento']);
const aGuardar = fs.readdirSync(raiz).filter(f => !excluidos.has(f) && !f.endsWith('.log'));

console.log(`\n📦 Armando ${path.basename(archivo)} …`);

try {
    execFileSync('tar', ['-czf', archivo, ...aGuardar], { cwd: raiz, stdio: 'inherit' });
} catch (err) {
    console.error(`\n❌ No se pudo armar el respaldo: ${err.message}\n`);
    process.exit(1);
}

// ── LO QUE FALTABA: COMPROBAR QUE ESTÉ ADENTRO ──────────────────────────────────────────────
// Que el comando no falle no quiere decir que el archivo tenga lo que tiene que tener.
let adentro = [];
try {
    adentro = execFileSync('tar', ['-tzf', archivo], { encoding: 'utf8' }).split('\n');
} catch (err) {
    console.error(`\n❌ El archivo se creó pero no se puede leer: ${err.message}\n`);
    process.exit(1);
}

const faltan = imprescindibles.filter(f => !adentro.some(l => l === f || l.endsWith('/' + f)));
if (faltan.length) {
    console.error(`\n❌ EL RESPALDO NO SIRVE: quedaron afuera ${faltan.join(', ')}`);
    console.error('   Son justamente los archivos que no se pueden recuperar de ningún otro lado.\n');
    fs.unlinkSync(archivo);   // mejor ningún respaldo que uno que parece bueno y está vacío
    process.exit(1);
}

const mb = (fs.statSync(archivo).size / (1024 * 1024)).toFixed(2);
console.log(`\n✅ Listo: ${adentro.filter(Boolean).length} archivos, ${mb} MB`);
console.log(`   Verificado que están adentro: ${imprescindibles.join(', ')}`);

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
