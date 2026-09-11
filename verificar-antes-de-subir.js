#!/usr/bin/env node
// Revisa que el código esté sano ANTES de subirlo a GitHub. Solo lee: no cambia nada.
//
//   node verificar-antes-de-subir.js
//
// Sale con código 0 si está todo bien y 1 si hay algo roto, así se puede enganchar como hook de
// git (ver abajo).
//
// POR QUÉ EXISTE. Pasó cuatro veces: un agente trabaja sobre una copia vieja de `dashboard.js` o
// `sheets.js` y la sube encima de la actual. El push dice "Fast-forward" igual, el diff se ve como
// un cambio normal, y recién se descubre cuando algo deja de andar en el VPS -- con `index.js`
// llamando funciones que ya no existen.
//
// Un borrado así tiene una firma clarísima: desaparecen funciones enteras. Eso es lo que se revisa
// acá, además de que el código sea válido y de que pasen las pruebas.
//
// PARA INSTALARLO COMO HOOK (una sola vez, en la máquina de cada uno):
//
//   printf '#!/bin/sh\nnode verificar-antes-de-subir.js || exit 1\n' > .git/hooks/pre-push
//   chmod +x .git/hooks/pre-push
//
// Desde ahí, `git push` se frena solo si algo falta.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Las funciones que NO pueden desaparecer, con el archivo donde viven. La lista no pretende ser
// exhaustiva: son las que ya se perdieron alguna vez, y alcanza con una para delatar el problema.
const IMPRESCINDIBLES = {
    'sheets.js': [
        'function pestaña(',
        'async function guardarFactura(',
        'async function casoYaTieneFactura(',
        'async function guardarDatosBancariosProveedor(',
        'async function resolverCambioBancario(',
        'async function proveedoresPorTelefono(',
        'async function buscarCasosRecientesPorTecnico(',
        'async function imputarFacturaSinEdificio(',
        'async function fueMaterialEnviadoATecnico(',
        'async function buscarAccesosEdificio(',
        'async function programarSeguimiento(',
    ],
    'dashboard.js': [
        'function clienteDelEdificio(',
        'function edificiosDeCliente(',
        'function columnasDelCampo(',
        'function normEdificio(',
        'async function expandirEdificiosPermitidos(',
        'function abrirDatosCobro(',
        "router.post('/api/proveedor-datos-cobro'",
        "router.post('/api/proveedor-cambio-cobro'",
        "router.post('/api/edificio-eliminar'",
    ],
    'agentes/marcos-ops.js': [
        'function limpiarParametroPlantilla(',
        'async function direccionParaTecnico(',
        'async function notificarProveedorConCola(',
    ],
    'index.js': [
        'async function entregarPendientesAlTecnico(',
        'async function generarRespuestaTecnicoLibre(',
    ],
    // Estas dos las pisó entera una sesión que escribió el archivo de cero sin leer el que
    // estaba: se perdieron la tabla `tecnicos`, el manejo de la fila duplicada y la comparación
    // exacta de `enviada_por` (que pasó a "empieza con", y así "dario" se llevaba puesto a
    // "dario gomez"). Es EXACTAMENTE el problema que este verificador existe para agarrar, y no
    // lo agarró porque el archivo no estaba en esta lista.
    'renombrar-proveedor.js': [
        'async function renombrarProveedor(',
        'function enviadaPorCorregida(',
        'tecnicos:',
        'module.exports = {',
    ],
    'renombrar-edificio.js': [
        'async function renombrarEdificio(',
        'reemplazarEnLista',
        'module.exports = {',
    ],
    'eliminar-edificio.js': [
        'async function eliminarEdificio(',
        'quitarDeLista',
        'module.exports = {',
    ],
    'material-caso.js': ['async function materialDelVecinoEnCaso('],
    'rubros.js':        ['function coincideRubro('],
    'cbu.js':           ['function validarCBU('],
};

let problemas = 0;
const decir = (ok, txt) => { if (!ok) problemas++; console.log(`  ${ok ? '✅' : '❌'} ${txt}`); };

function correr(descripcion, comando, args) {
    try {
        execFileSync(comando, args, { cwd: __dirname, stdio: 'pipe' });
        decir(true, descripcion);
        return true;
    } catch (e) {
        decir(false, `${descripcion}`);
        const salida = `${e.stdout || ''}${e.stderr || ''}`.trim();
        if (salida) console.log(salida.split('\n').map(l => `       ${l}`).join('\n'));
        return false;
    }
}

console.log('\n── ¿FALTA ALGUNA FUNCIÓN QUE OTRO ARCHIVO NECESITA? ──');
for (const [archivo, funciones] of Object.entries(IMPRESCINDIBLES)) {
    const ruta = path.join(__dirname, archivo);
    if (!fs.existsSync(ruta)) { decir(false, `${archivo} no existe`); continue; }
    const src = fs.readFileSync(ruta, 'utf8');
    const faltan = funciones.filter(f => !src.includes(f));
    if (faltan.length === 0) {
        decir(true, `${archivo} — están las ${funciones.length}`);
    } else {
        decir(false, `${archivo} — faltan ${faltan.length} de ${funciones.length}`);
        faltan.forEach(f => console.log(`       · ${f}`));
        console.log(`       Esto es lo que pasa cuando se sube una copia vieja del archivo.`);
        console.log(`       ANTES de subir: git pull, y volver a aplicar el cambio sobre lo que hay.`);
    }
}

// > [!CAUTION]
// > **La lista de arriba está escrita a MANO**, así que solo revisa los nombres que alguien se
// > acordó de anotar. `datos.js` nunca exportó `buscarCasoPorCodigo`, cinco lugares de `index.js`
// > se la pedían, y esta sección dijo "✅ están las 2" durante días.
//
// Lo de abajo no depende de que nadie se acuerde de nada: lee los `require` de verdad y los
// compara con los `module.exports` de verdad.
console.log('\n── ¿LO QUE UN ARCHIVO PIDE, EL OTRO LO EXPORTA? ──');
if (fs.existsSync(path.join(__dirname, 'herramientas-check-exports.js'))) {
    correr('require vs. module.exports', process.execPath, ['herramientas-check-exports.js']);
}

console.log('\n── ¿EL CÓDIGO ES VÁLIDO? ──');
// > [!CAUTION]
// > **Esta lista estaba escrita a mano y `db-pg.js` no estaba adentro.** Un acento grave dentro de
// > un comentario SQL --que viaja en un template literal de JavaScript-- cerró la cadena y rompió
// > el archivo entero. El verificador dijo "todo en orden", el push salió, y el error apareció
// > recién en el VPS: `SyntaxError: missing ) after argument list`, con Marcos ya reiniciado.
//
// Ahora se revisan TODOS los .js del proyecto. Es rápido y no depende de que nadie se acuerde de
// agregar el archivo nuevo a una lista.
const saltear = /^(node_modules|\.git)/;
const archivosJs = [
    ...fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !saltear.test(f)),
    ...(fs.existsSync(path.join(__dirname, 'agentes'))
        ? fs.readdirSync(path.join(__dirname, 'agentes'))
            .filter(f => f.endsWith('.js')).map(f => `agentes/${f}`)
        : []),
].sort();
let rotos = 0;
for (const archivo of archivosJs) {
    try {
        execFileSync(process.execPath, ['--check', archivo], { cwd: __dirname, stdio: 'pipe' });
    } catch (e) {
        rotos++;
        decir(false, archivo);
        console.log(`${e.stdout || ''}${e.stderr || ''}`.trim()
            .split('\n').map(l => `       ${l}`).join('\n'));
    }
}
if (rotos === 0) decir(true, `los ${archivosJs.length} archivos .js compilan`);

console.log('\n── EL JAVASCRIPT QUE VA AL NAVEGADOR ──');
// `node --check` no lo mira: dentro de dashboard.js viaja como un texto, así que un error ahí
// solo revienta en el navegador del usuario.
if (fs.existsSync(path.join(__dirname, 'herramientas-check-clientjs.js'))) {
    correr('dashboard.js — CLIENT_JS', process.execPath, ['herramientas-check-clientjs.js', 'dashboard.js']);
}

console.log('\n── VARIABLES USADAS FUERA DE SU ALCANCE ──');
// Es válido para `node --check` y revienta al ejecutarse. Ya pasó cuatro veces en producción.
if (fs.existsSync(path.join(__dirname, 'herramientas-scan-alcances.js'))) {
    for (const archivo of ['index.js', 'dashboard.js', 'sheets.js', 'agentes/marcos-ops.js']) {
        correr(archivo, process.execPath, ['herramientas-scan-alcances.js', archivo]);
    }
}

console.log('\n── LAS PRUEBAS ──');
const pruebas = fs.readdirSync(__dirname).filter(f => /^pruebas-.*\.js$/.test(f)).sort();
for (const p of pruebas) correr(p.replace(/^pruebas-|\.js$/g, ''), process.execPath, [p]);

console.log('');
if (problemas === 0) {
    console.log(`✅ Todo en orden: ${pruebas.length} pruebas y las funciones imprescindibles.\n`);
} else {
    console.log(`❌ ${problemas} problema(s). NO subir así.`);
    console.log(`   Si faltan funciones, casi seguro se trabajó sobre una copia vieja:`);
    console.log(`   git pull origin <rama> y volver a aplicar el cambio sobre lo que hay.\n`);
}
process.exit(problemas === 0 ? 0 : 1);
