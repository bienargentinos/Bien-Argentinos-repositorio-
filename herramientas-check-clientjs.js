#!/usr/bin/env node
// Valida la sintaxis del bloque CLIENT_JS de dashboard.js.
//
// POR QUE EXISTE: CLIENT_JS es un template literal gigante (~3400 lineas) con todo el
// JavaScript del navegador. Para `node --check` eso es UN STRING: puede tener cualquier
// basura adentro y el archivo igual "pasa". Cuando ese string tiene un error de sintaxis,
// el navegador no ejecuta NADA del panel — no abre el drawer de eventos, no andan los
// modales, no anda ningun boton — y en el servidor no se ve un solo error.
//
// Correr SIEMPRE despues de tocar dashboard.js, antes de commitear:
//   node herramientas-check-clientjs.js
//
// Requiere acorn (una sola vez):  npm install --no-save acorn

let acorn;
try {
    acorn = require('acorn');
} catch {
    console.error('Falta acorn. Instalalo una sola vez con:');
    console.error('  npm install --no-save acorn');
    process.exit(1);
}
const fs = require('fs');
const path = require('path');

const archivo = process.argv[2] || path.join(__dirname, 'dashboard.js');
const lineas = fs.readFileSync(archivo, 'utf8').split('\n');

const inicio = lineas.findIndex(l => /^const CLIENT_JS\s*=\s*`/.test(l));
if (inicio === -1) {
    console.error(`No encontre "const CLIENT_JS = \`" en ${archivo}.`);
    process.exit(1);
}
const fin = lineas.findIndex((l, i) => i > inicio && /^`;\s*$/.test(l));
if (fin === -1) {
    console.error('No encontre el cierre del template literal de CLIENT_JS.');
    process.exit(1);
}

// El cuerpo va entre la linea de apertura y la de cierre (ambas excluidas).
const cuerpo = lineas.slice(inicio + 1, fin).join('\n');
const offset = inicio + 1; // para mapear linea-de-CLIENT_JS -> linea real del archivo

// Las interpolaciones ${...} no son JS valido fuera del template: si hay alguna,
// no podemos parsear el bloque tal cual y hay que avisarlo en vez de dar un falso OK.
if (/\$\{/.test(cuerpo)) {
    console.error('⚠️ CLIENT_JS tiene interpolaciones ${...}: este chequeo no puede validarlo tal cual.');
    console.error('   Sacalas del bloque (pasá los valores por window.__VAR__ desde el HTML) o ampliá esta herramienta.');
    process.exit(2);
}

// LO QUE RECIBE EL NAVEGADOR NO ES ESTE TEXTO. CLIENT_JS es un template literal, así que Node
// procesa los escapes antes de mandarlo: un `\n` escrito adentro se convierte en un SALTO DE
// LINEA REAL. Si ese `\n` estaba dentro de una cadena entre comillas, el navegador recibe una
// cadena partida en dos lineas -- error de sintaxis -- y NADA del panel se define.
//
// Paso de verdad y este chequeo lo dejo pasar, porque parseaba el texto crudo. Hay que parsear
// el texto YA PROCESADO, que es exactamente lo que se sirve. Como arriba ya se verifico que no
// haya interpolaciones, evaluarlo como template literal reproduce lo que hace Node al cargar el
// archivo, sin ejecutar nada del contenido.
let servido;
try {
    servido = new Function('return `' + cuerpo + '`;')();
} catch (e) {
    console.error('❌ El bloque CLIENT_JS ni siquiera arma un template literal valido:');
    console.error(`   ${e.message}`);
    process.exit(1);
}

try {
    acorn.parse(servido, { ecmaVersion: 2022, sourceType: 'script', locations: true });
    console.log(`✅ CLIENT_JS OK — ${servido.length} caracteres servidos, lineas ${offset + 1} a ${fin} de ${path.basename(archivo)}.`);
} catch (e) {
    const linea = e.loc ? e.loc.line : null;
    console.error('❌ ERROR DE SINTAXIS EN CLIENT_JS — el panel va a quedar SIN JavaScript en el navegador.');
    console.error(`   ${e.message}`);
    if (linea) {
        const real = linea + offset;
        console.error(`   Linea real en ${path.basename(archivo)}: ${real}`);
        for (let i = Math.max(0, real - 4); i < Math.min(lineas.length, real + 3); i++) {
            console.error(`   ${i + 1 === real ? '>>' : '  '} ${i + 1}: ${lineas[i]}`);
        }
    }
    process.exit(1);
}
