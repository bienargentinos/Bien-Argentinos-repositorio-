// ¿CADA FUNCIÓN QUE UN ARCHIVO PIDE EXISTE DEL OTRO LADO?
//
//   node herramientas-check-exports.js
//
// > [!CAUTION]
// > **`const { x } = require('./y')` con `y` que no exporta `x` NO da error al cargar.**
// > `x` queda `undefined`, y recién revienta cuando alguien lo llama — adentro de un `try`, que se
// > come el error y sigue de largo.
//
// EL CASO QUE LO ORIGINÓ. `datos.js` nunca exportó `buscarCasoPorCodigo`, y CINCO lugares de
// `index.js` se la pedían. Los cinco caían en su `catch` con *"buscarCasoPorCodigo is not a
// function"*. Desde afuera no se veía ningún error: se veía a Marcos preguntando la dirección que
// el técnico acababa de decir, porque el arreglo que evitaba eso nunca llegó a correr.
//
// Estuvo roto días. `node --check` no lo ve (la sintaxis es válida), las pruebas no lo veían (no
// llegan hasta ahí) y el verificador tampoco: su lista de funciones imprescindibles está escrita a
// MANO, así que solo revisa los nombres que alguien se acordó de anotar.
//
// Esto no depende de que nadie se acuerde de nada: lee los `require` de verdad y los compara con
// los `module.exports` de verdad.
//
// ── POR QUÉ NO SE HACE CON `require()` ──────────────────────────────────────────────────────
//
// Cargar los módulos para preguntarles qué exportan haría correr su código: `datos-pg.js` abre una
// conexión a PostgreSQL al cargarse, y los agentes crean el cliente de Gemini. Un verificador que
// necesita la base y las claves prendidas no se puede correr antes de un `git push`.

const fs = require('fs');
const path = require('path');

/** Los archivos propios del proyecto, sin node_modules ni las pruebas. */
function archivosDelProyecto(dir = __dirname, encontrados = []) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) archivosDelProyecto(completo, encontrados);
        else if (entrada.name.endsWith('.js')) encontrados.push(completo);
    }
    return encontrados;
}

/**
 * Qué nombres exporta un archivo, leyendo el texto y no cargándolo.
 *
 * Cubre las tres formas que usa este proyecto:
 *   module.exports = { a, b, c: otra, async d() {} }
 *   module.exports.e = ...
 *   exports.f = ...
 */
function loQueExporta(ruta) {
    const src = fs.readFileSync(ruta, 'utf8');
    const nombres = new Set();

    // `module.exports = { ... }` — se toma desde la llave hasta la que la cierra.
    const ini = src.lastIndexOf('module.exports = {');
    if (ini !== -1) {
        let nivel = 0, fin = -1;
        for (let i = src.indexOf('{', ini); i < src.length; i++) {
            if (src[i] === '{') nivel++;
            else if (src[i] === '}') { nivel--; if (nivel === 0) { fin = i; break; } }
        }
        if (fin !== -1) {
            // Se incluye la llave que cierra: el último nombre de la lista necesita algo detrás
            // para que la mirada hacia adelante lo reconozca. Sin esto, `esReserva` de
            // `module.exports = { a, b, esReserva };` quedaba sin capturar y se reportaba como
            // faltante -- un falso positivo, que en un verificador es peor que no verificar: si
            // grita por cosas que están bien, se lo deja de mirar.
            const cuerpo = src.slice(ini, fin + 1);
            // `a,` · `a: loQueSea` · `async a(...)` · `a(...)`
            for (const m of cuerpo.matchAll(/(?:^|[,{\s])(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?=[,:(}\n])/g)) {
                nombres.add(m[1]);
            }
        }
    }

    // `module.exports = unaFuncion;` — el archivo exporta una sola cosa y no un objeto.
    if (/module\.exports\s*=\s*[A-Za-z_$][\w$]*\s*;/.test(src)) nombres.add('*');

    for (const m of src.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) nombres.add(m[1]);

    return nombres;
}

/** Cada `const { a, b } = require('./x')` de un archivo, con la línea donde está. */
function loQuePide(ruta) {
    const lineas = fs.readFileSync(ruta, 'utf8').split('\n');
    const pedidos = [];

    lineas.forEach((linea, i) => {
        // Los comentarios no piden nada.
        if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;

        const m = linea.match(/const\s*\{([^}]+)\}\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/);
        if (!m) return;

        const nombres = m[1]
            .split(',')
            .map(s => s.split(':')[0].trim())          // `{ a: b }` — lo que se pide es `a`
            .map(s => s.replace(/\s*=.*$/, '').trim()) // `{ a = 1 }` — con valor por defecto
            .filter(Boolean);

        pedidos.push({ nombres, modulo: m[2], linea: i + 1 });
    });

    return pedidos;
}

const archivos = archivosDelProyecto();
const cache = new Map();
let problemas = 0;
let revisados = 0;

for (const archivo of archivos) {
    const rel = path.relative(__dirname, archivo);
    // Las pruebas piden a propósito cosas que no existen para verificar que fallen.
    if (/^pruebas-|^probar-/.test(path.basename(archivo))) continue;

    for (const { nombres, modulo, linea } of loQuePide(archivo)) {
        const destino = path.resolve(path.dirname(archivo), modulo.endsWith('.js') ? modulo : `${modulo}.js`);
        if (!fs.existsSync(destino)) {
            console.log(`  ❌ ${rel}:${linea} — pide '${modulo}', que no existe`);
            problemas++;
            continue;
        }

        if (!cache.has(destino)) cache.set(destino, loQueExporta(destino));
        const exporta = cache.get(destino);
        if (exporta.has('*')) continue;   // exporta una función sola: no se puede comparar por nombre

        revisados++;
        for (const nombre of nombres) {
            if (!exporta.has(nombre)) {
                console.log(`  ❌ ${rel}:${linea} — pide '${nombre}' a ${path.basename(destino)}, que NO lo exporta`);
                console.log(`       Esto NO rompe al cargar: queda undefined y revienta recién al llamarlo,`);
                console.log(`       casi siempre adentro de un try que se come el error.`);
                problemas++;
            }
        }
    }
}

if (problemas === 0) {
    console.log(`  ✅ ${revisados} require(s) con destructuring, todos apuntan a algo que existe`);
    process.exit(0);
}
console.log(`\n  ${problemas} función(es) pedidas que nadie exporta.`);
process.exit(1);
