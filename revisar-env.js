#!/usr/bin/env node
// Dice si al .env le falta algo, SIN MOSTRAR NINGÚN VALOR.
//
//   node revisar-env.js
//   node revisar-env.js C:\ruta\a\mi\.env      ← para revisar una copia guardada en otro lado
//
// > [!CAUTION]
// > **Este script no imprime valores. Nunca.** Solo nombres de variables y si están o no.
// > Se puede correr con alguien mirando la pantalla, o pegar su salida en un chat, sin filtrar
// > nada. Esa es toda la gracia: verificar una copia del .env sin exponerla.
//
// PARA QUÉ. El `.env` es lo único del proyecto que no está en GitHub ni en Google Sheets. Si el
// servidor desaparece y no hay copia, hay que regenerar credencial por credencial. Este script
// existe para poder responder "¿la copia que tengo guardada sirve?" sin abrir el archivo.

const fs = require('fs');
const path = require('path');

const ruta = process.argv[2] || path.join(__dirname, '.env');

// Lo que el motor necesita sí o sí para arrancar y funcionar.
const IMPRESCINDIBLES = [
    ['WHATSAPP_ACCESS_TOKEN',    'sin esto Marcos no puede mandar ni un mensaje'],
    ['WHATSAPP_PHONE_NUMBER_ID', 'el número desde el que escribe'],
    ['GEMINI_API_KEY',           'sin esto no entiende nada de lo que le escriben'],
    ['GOOGLE_SHEET_ID',          'la planilla entera: edificios, clientes, casos'],
    ['GOOGLE_CREDENTIALS_FILE',  'el nombre del JSON que da acceso a esa planilla'],
];

// Sin estas anda, pero a medias.
const IMPORTANTES = [
    ['DATABASE_URL',      'sin esto no hay PostgreSQL: el visor de chats del panel queda vacío'],
    ['DASHBOARD_USER',    'usuario del panel'],
    ['DASHBOARD_PASS',    'contraseña del panel'],
    ['ADMIN_EMAIL',       'a dónde le llegan las urgencias a la Administración'],
    ['SMTP_HOST',         'sin esto no sale ningún mail'],
    ['SMTP_USER',         'idem'],
    ['SMTP_PASS',         'idem'],
];

// Se puede vivir sin ellas.
const OPCIONALES = [
    ['ELEVENLABS_API_KEY', 'las notas de voz; sin esto contesta siempre por texto'],
    ['ADMIN_PHONE',        'WhatsApp de la Administración'],
    ['DASHBOARD_SECRET',   'firma de las sesiones del panel'],
    ['PORT',               'por defecto 3000'],
    ['TZ_AR',              'por defecto America/Argentina/Buenos_Aires'],
];

if (!fs.existsSync(ruta)) {
    console.log(`\n❌ No existe el archivo: ${ruta}`);
    console.log(`   Si tu copia está en otro lado:  node revisar-env.js "C:\\ruta\\a\\.env"\n`);
    process.exit(1);
}

// Se lee a mano y no con dotenv para no cargar nada al entorno de este proceso.
const texto = fs.readFileSync(ruta, 'utf8');
const puestas = new Map();
for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i <= 0) continue;
    const clave = l.slice(0, i).trim();
    const valor = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    // SOLO se guarda el LARGO, nunca el contenido. Así no hay forma de que se imprima por error.
    puestas.set(clave, valor.length);
}

console.log(`\n📄 ${ruta}`);
console.log(`   ${puestas.size} variable(s) cargada(s). No se muestra ningún valor.\n`);

let faltanCriticas = 0;
let faltanImportantes = 0;

function revisar(titulo, lista, contar) {
    console.log(`── ${titulo} ──`);
    for (const [clave, paraQue] of lista) {
        const largo = puestas.get(clave);
        if (largo === undefined) {
            console.log(`  ❌ ${clave.padEnd(26)} NO ESTÁ   — ${paraQue}`);
            if (contar) contar();
        } else if (largo === 0) {
            console.log(`  ⚠️  ${clave.padEnd(26)} vacía     — ${paraQue}`);
            if (contar) contar();
        } else {
            // El largo alcanza para notar un valor truncado sin revelar nada de él.
            console.log(`  ✅ ${clave.padEnd(26)} está (${largo} caracteres)`);
        }
    }
    console.log('');
}

revisar('IMPRESCINDIBLES — sin esto Marcos no arranca', IMPRESCINDIBLES, () => faltanCriticas++);
revisar('IMPORTANTES — arranca, pero a medias', IMPORTANTES, () => faltanImportantes++);
revisar('OPCIONALES', OPCIONALES, null);

// Lo que está en el archivo y el código ya no usa: no molesta, pero conviene saberlo.
const conocidas = new Set([...IMPRESCINDIBLES, ...IMPORTANTES, ...OPCIONALES].map(([k]) => k));
const extras = [...puestas.keys()].filter(k => !conocidas.has(k) && !k.startsWith('SHEET_TAB_'));
if (extras.length) {
    console.log('── OTRAS QUE TIENE EL ARCHIVO ──');
    console.log(`  ${extras.join(', ')}\n`);
}

if (faltanCriticas) {
    console.log(`❌ Faltan ${faltanCriticas} variable(s) imprescindible(s): con esta copia Marcos NO levanta.\n`);
    process.exit(1);
}
if (faltanImportantes) {
    console.log(`⚠️  Están todas las imprescindibles, pero faltan ${faltanImportantes} importante(s).`);
    console.log(`   Marcos arranca y contesta, pero algo va a estar mudo (mails, panel o base).\n`);
    process.exit(0);
}
console.log('✅ La copia está completa: con esto se levanta Marcos en un servidor nuevo.\n');
process.exit(0);
