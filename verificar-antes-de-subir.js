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

console.log('\n── ¿EL CÓDIGO ES VÁLIDO? ──');
for (const archivo of ['index.js', 'dashboard.js', 'sheets.js', 'datos.js', 'datos-pg.js',
                       'agentes/marcos-ops.js', 'agentes/marcos-cara.js', 'seguimiento.js']) {
    if (fs.existsSync(path.join(__dirname, archivo))) {
        correr(archivo, process.execPath, ['--check', archivo]);
    }
}

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
