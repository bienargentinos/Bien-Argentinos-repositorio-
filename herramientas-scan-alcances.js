// Busca identificadores que se usan fuera del bloque donde fueron declarados con let/const.
// Es el error que ya aparecio tres veces en produccion (itemsRafaga, messageText, captionAuto):
// node --check no lo detecta porque es sintacticamente valido, y solo revienta al ejecutarse.
const acorn = require('/tmp/node_modules/acorn');
const walk = require('/tmp/node_modules/acorn-walk');
const fs = require('fs');

const archivo = process.argv[2];
const src = fs.readFileSync(archivo, 'utf8');
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

if (sospechosos.size === 0) {
    console.log(`✅ ${archivo}: sin usos fuera de alcance.`);
} else {
    console.log(`⚠️ ${archivo}:`);
    for (const [n, lineas] of sospechosos) {
        console.log(`   ${n} — usado en linea(s) ${lineas.join(', ')} fuera del bloque donde se declara`);
    }
}
