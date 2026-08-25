// Busca identificadores que se usan fuera del bloque donde fueron declarados con let/const.
// Es el error que ya aparecio tres veces en produccion (itemsRafaga, messageText, captionAuto):
// node --check no lo detecta porque es sintacticamente valido, y solo revienta al ejecutarse.
let acorn, walk;
try {
    acorn = require('acorn');
    walk = require('acorn-walk');
} catch {
    console.error('Faltan las dependencias del scanner. Instalalas una sola vez con:');
    console.error('  npm install --no-save acorn acorn-walk');
    process.exit(1);
}
const fs = require('fs');

const archivo = process.argv[2];
// El `#!/usr/bin/env node` de un script ejecutable no es JavaScript válido para acorn (Node lo
// trata aparte). Se reemplaza por una línea vacía en vez de borrarla, para que los números de
// línea que se reporten sigan siendo los del archivo real.
const src = fs.readFileSync(archivo, 'utf8').replace(/^#![^\n]*/, '');
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true });

const GLOBALES = new Set(['require','module','exports','process','console','Buffer','setTimeout','setInterval','clearTimeout','clearInterval','JSON','Math','Date','Promise','Array','Object','String','Number','Boolean','Error','TypeError','RegExp','Map','Set','WeakMap','isNaN','parseInt','parseFloat','global','globalThis','__dirname','__filename','undefined','NaN','Infinity','encodeURIComponent','decodeURIComponent','Intl','URL','URLSearchParams','TextDecoder','TextEncoder','structuredClone','Symbol','arguments','fetch','AbortController']);

// 1) Declaraciones let/const con el rango del bloque que las contiene.
const bloques = [];
walk.full(ast, n => {
    if (n.type === 'BlockStatement' || n.type === 'Program' || n.type === 'ForStatement' || n.type === 'SwitchStatement') {
        bloques.push(n);
    }
});
bloques.sort((a, b) => (a.end - a.start) - (b.end - b.start));

const declarados = new Map(); // nombre -> [{start,end}] del bloque contenedor mas chico
walk.full(ast, n => {
    if (n.type !== 'VariableDeclaration' || n.kind === 'var') return;
    for (const d of n.declarations) {
        if (d.id.type !== 'Identifier') continue;
        const cont = bloques.find(b => b.start <= n.start && b.end >= n.end);
        if (!cont) continue;
        if (!declarados.has(d.id.name)) declarados.set(d.id.name, []);
        declarados.get(d.id.name).push({ start: cont.start, end: cont.end });
    }
});

// 2) Nombres declarados por cualquier otra via (funciones, parametros, var, imports).
const otros = new Set();
walk.full(ast, n => {
    if (n.type === 'FunctionDeclaration' && n.id) otros.add(n.id.name);
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')) {
        for (const p of n.params) juntarNombres(p, otros);
    }
    if (n.type === 'VariableDeclaration' && n.kind === 'var') {
        for (const d of n.declarations) juntarNombres(d.id, otros);
    }
    if (n.type === 'VariableDeclaration' && n.kind !== 'var') {
        for (const d of n.declarations) if (d.id.type !== 'Identifier') juntarNombres(d.id, otros);
    }
    if (n.type === 'CatchClause' && n.param) juntarNombres(n.param, otros);
    if (n.type === 'ClassDeclaration' && n.id) otros.add(n.id.name);
});

function juntarNombres(patron, destino) {
    if (!patron) return;
    if (patron.type === 'Identifier') destino.add(patron.name);
    else if (patron.type === 'ObjectPattern') patron.properties.forEach(p => juntarNombres(p.value || p.argument, destino));
    else if (patron.type === 'ArrayPattern') patron.elements.forEach(e => juntarNombres(e, destino));
    else if (patron.type === 'AssignmentPattern') juntarNombres(patron.left, destino);
    else if (patron.type === 'RestElement') juntarNombres(patron.argument, destino);
}

// 3) Usos fuera de todo bloque donde el nombre fue declarado.
const sospechosos = new Map();
walk.ancestor(ast, {
    Identifier(node, _st, ancestors) {
        const padre = ancestors[ancestors.length - 2];
        if (!padre) return;
        if (padre.type === 'MemberExpression' && padre.property === node && !padre.computed) return;
        if (padre.type === 'Property' && padre.key === node && !padre.computed) return;
        if (padre.type === 'VariableDeclarator' && padre.id === node) return;
        if (/Function/.test(padre.type) && padre.params && padre.params.includes(node)) return;

        const n = node.name;
        if (GLOBALES.has(n) || otros.has(n) || !declarados.has(n)) return;

        const rangos = declarados.get(n);
        const dentro = rangos.some(r => node.start >= r.start && node.end <= r.end);
        if (!dentro) {
            const linea = node.loc.start.line;
            if (!sospechosos.has(n)) sospechosos.set(n, []);
            sospechosos.get(n).push(linea);
        }
    }
});

// 4) Usos ANTES de la declaracion, dentro del mismo bloque.
//
// Un `let`/`const` no existe hasta la linea donde se declara: usarlo mas arriba es un
// ReferenceError en ejecucion, aunque este en el mismo bloque y `node --check` lo acepte. La
// revision de arriba solo mira DONDE, no CUANDO, asi que este caso se le escapaba -- y paso:
// una funcion nueva leia `notaDeQuienEnvia` sesenta lineas antes de que se declarara.
const antesDeTiempo = new Map();

// La funcion que envuelve a un nodo, o null si esta en el cuerpo del modulo. Es lo que decide
// si el orden importa: dos cosas en la MISMA funcion se ejecutan uno detras del otro, asi que
// usar algo declarado mas abajo revienta. Si el uso esta adentro de OTRA funcion, esa funcion
// puede llamarse mucho despues y el orden en el archivo no dice nada.
const envolvente = (ancestors) => {
    for (let i = ancestors.length - 1; i >= 0; i--) {
        if (/Function/.test(ancestors[i].type)) return ancestors[i].start;
    }
    return null;
};

const declaracionEn = new Map(); // nombre -> {start, linea, fn}
walk.ancestor(ast, {
    VariableDeclaration(n, _st, ancestors) {
        if (n.kind === 'var') return;
        for (const d of n.declarations) {
            if (d.id.type !== 'Identifier') continue;
            if (!declaracionEn.has(d.id.name)) {
                declaracionEn.set(d.id.name, { start: n.start, linea: n.loc.start.line, fn: envolvente(ancestors) });
            }
        }
    },
});

walk.ancestor(ast, {
    Identifier(node, _st, ancestors) {
        const padre = ancestors[ancestors.length - 2];
        if (!padre) return;
        if (padre.type === 'MemberExpression' && padre.property === node && !padre.computed) return;
        if (padre.type === 'Property' && padre.key === node && !padre.computed) return;
        if (padre.type === 'VariableDeclarator' && padre.id === node) return;
        if (/Function/.test(padre.type) && padre.params && padre.params.includes(node)) return;

        const decl = declaracionEn.get(node.name);
        if (!decl || node.start >= decl.start) return;
        if (otros.has(node.name)) return; // tambien existe como funcion o var: no se puede afirmar

        // Solo importa si los dos estan en la misma funcion (o los dos en el cuerpo del modulo).
        if (envolvente(ancestors) !== decl.fn) return;

        if (!antesDeTiempo.has(node.name)) antesDeTiempo.set(node.name, { usos: [], declarada: decl.linea });
        antesDeTiempo.get(node.name).usos.push(node.loc.start.line);
    }
});

if (sospechosos.size === 0 && antesDeTiempo.size === 0) {
    console.log(`✅ ${archivo}: sin usos fuera de alcance.`);
} else {
    console.log(`⚠️ ${archivo}:`);
    for (const [n, lineas] of sospechosos) {
        console.log(`   ${n} — usado en linea(s) ${lineas.join(', ')} fuera del bloque donde se declara`);
    }
    for (const [n, info] of antesDeTiempo) {
        console.log(`   ${n} — usado en linea(s) ${info.usos.join(', ')} ANTES de declararse (linea ${info.declarada}): ReferenceError al ejecutar`);
    }
    process.exit(1);
}
