// LA COLUMNA QUE EL CÓDIGO ESCRIBE TIENE QUE EXISTIR EN PostgreSQL
//
//   node pruebas-columnas-pg.js
//
// > [!CAUTION]
// > **Una columna que falta en PostgreSQL no rompe nada visible.** El `UPDATE` falla, `copiarAPg`
// > lo atrapa, sale una línea en el log y Marcos sigue andando con el dato solo en la planilla.
//
// EL CASO REAL (prueba del vecino con la ventana de 24hs cerrada). La foto y el contacto de ingreso
// rebotaron con 131047, el arreglo los reintentó bien --eso funcionó-- pero en el log, repetido:
//
//     [PG] No se pudo copiar el borrado de las marcas de entrega de CASO-1001:
//          column "material_enviado_tecnico" of relation "reportes" does not exist
//
// `contacto_acceso_avisado` sí estaba en `db-pg.js`; su gemela `material_enviado_tecnico` no,
// aunque las dos se crearon el mismo día y se borran juntas en un solo `UPDATE`. Como el `UPDATE`
// nombra las dos, la que faltaba hacía fallar el statement entero: **las dos marcas quedaban
// puestas del lado que lee Marcos**, que es justo el lado que decide si hay que reintentar.
//
// Ya está documentado en CLAUDE.md que el esquema real de PostgreSQL no es el que dice `db-pg.js`
// (`id_evento`, `url`, `cbu`...). Esto es lo contrario y peor de encontrar: lo que dice el código
// tampoco es lo que dice `db-pg.js`.
//
// Esta prueba no necesita la base prendida: lee el SQL que hay escrito en los archivos y lo compara
// con las columnas que `db-pg.js` crea.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const ESQUEMA = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');

// Además de `db-pg.js` --que corre solo al arrancar Marcos-- hay migraciones sueltas en archivos
// `.sql` que alguien tiene que aplicar A MANO en el servidor. Una columna que vive solo ahí existe
// en el VPS de hoy porque Daniel corrió el archivo, y NO existiría en una instalación nueva.
const MIGRACIONES = fs.readdirSync(__dirname).filter(f => f.endsWith('.sql'));

// Los archivos que escriben SQL a mano. `db-pg.js` queda afuera: es la definición, no un uso.
const ARCHIVOS = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.js'))
    .filter(f => !/^(db-pg|pruebas-|herramientas-)/.test(f));

/** Las columnas que un texto SQL crea para cada tabla: las del CREATE TABLE más los ALTER. */
function columnasDeclaradas(ESQUEMA) {
    const tablas = {};
    const agregar = (t, c) => { (tablas[t] = tablas[t] || new Set()).add(c.toLowerCase()); };

    // CREATE TABLE IF NOT EXISTS x ( ... );
    const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/g;
    let m;
    while ((m = re.exec(ESQUEMA))) {
        const [, tabla, cuerpo] = m;
        for (const linea of cuerpo.split('\n')) {
            const l = linea.trim();
            if (!l || l.startsWith('--')) continue;
            // La primera palabra de la línea es el nombre de la columna, salvo que la línea sea una
            // restricción de tabla (UNIQUE(...), PRIMARY KEY(...), CONSTRAINT ...).
            if (/^(unique|primary|foreign|constraint|check)\b/i.test(l)) continue;
            const nombre = l.match(/^(\w+)/);
            if (nombre) agregar(tabla, nombre[1]);
        }
    }

    const reAlter = /ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)/gi;
    while ((m = reAlter.exec(ESQUEMA))) agregar(m[1], m[2]);

    return tablas;
}

/** ¿La tabla `t` tiene declarada la columna `c` en este mapa? */
const tiene = (mapa, t, c) => !!(mapa[t] && mapa[t].has(String(c).toLowerCase()));

/** Corta un `a = 1, b = f(x, y)` por las comas de AFUERA de los paréntesis. */
function partirPorComasDeAfuera(texto) {
    const partes = [];
    let hondo = 0, actual = '';
    for (const c of texto) {
        if (c === '(') hondo++;
        if (c === ')') hondo--;
        if (c === ',' && hondo === 0) { partes.push(actual); actual = ''; continue; }
        actual += c;
    }
    if (actual.trim()) partes.push(actual);
    return partes;
}

/** Cada columna nombrada en un UPDATE o un INSERT escrito a mano, con dónde está. */
function columnasUsadas() {
    const usos = [];
    for (const archivo of ARCHIVOS) {
        const src = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
        const lineaDe = (i) => src.slice(0, i).split('\n').length;

        // UPDATE tabla SET col = ..., col = ... [WHERE|RETURNING|fin del template]
        const reUpd = /UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|`|'|")/gi;
        let m;
        while ((m = reUpd.exec(src))) {
            const [, tabla, sets] = m;
            for (const parte of partirPorComasDeAfuera(sets)) {
                const col = parte.trim().match(/^(\w+)\s*=/);
                if (col) usos.push({ archivo, linea: lineaDe(m.index), tabla, columna: col[1] });
            }
        }

        // INSERT INTO tabla (col, col, col)
        const reIns = /INSERT INTO\s+(\w+)\s*\(([^)]*)\)/gi;
        while ((m = reIns.exec(src))) {
            const [, tabla, cols] = m;
            // Un INSERT con la lista de columnas armada en JavaScript (`${...}`) no se puede leer
            // desde acá. No se inventa nada: se saltea.
            if (/\$\{/.test(cols)) continue;
            for (const c of cols.split(',')) {
                const col = c.trim().match(/^(\w+)$/);
                if (col) usos.push({ archivo, linea: lineaDe(m.index), tabla, columna: col[1] });
            }
        }
    }
    return usos;
}

console.log('\n── LO QUE EL CÓDIGO ESCRIBE, ¿EXISTE EN LA BASE? ──');

const declaradas = columnasDeclaradas(ESQUEMA);
const aMano = {};
for (const f of MIGRACIONES) {
    const m = columnasDeclaradas(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    for (const [t, cols] of Object.entries(m)) {
        aMano[t] = aMano[t] || new Set();
        for (const c of cols) aMano[t].add(c);
    }
}

prueba('db-pg.js se pudo leer entero', () => {
    // Si el parser deja de encontrar tablas, esta prueba pasaría en verde sin revisar nada.
    assert.ok(Object.keys(declaradas).length >= 20,
        `solo se leyeron ${Object.keys(declaradas).length} tablas de db-pg.js`);
    assert.ok(tiene(declaradas, 'reportes', 'codigo_caso'),
        'no se leyeron las columnas de reportes');
});

prueba('ninguna columna escrita falta en la base', () => {
    const faltan = [];
    for (const u of columnasUsadas()) {
        // Una tabla que no crea ni db-pg.js ni una migración la crea otro lado (o es de otra
        // base): no se opina.
        if (!declaradas[u.tabla] && !aMano[u.tabla]) continue;
        if (tiene(declaradas, u.tabla, u.columna) || tiene(aMano, u.tabla, u.columna)) continue;
        faltan.push(u);
    }
    assert.strictEqual(faltan.length, 0,
        `Estas columnas se escriben y la base no las tiene. El statement falla ENTERO --también ` +
        `para las columnas que SÍ existen-- y el dato queda solo en la planilla:\n` +
        faltan.map(f => `       · ${f.tabla}.${f.columna}  (${f.archivo}:${f.linea})`).join('\n'));
});

console.log('\n── LO QUE SOLO EXISTE SI ALGUIEN CORRIÓ UN .sql A MANO ──');

prueba('está dicho cuáles son (no falla: es un aviso)', () => {
    // > [!CAUTION]
    // > **Una columna que vive solo en un `.sql` existe en el VPS de hoy y no existiría en una
    // > instalación nueva.** `db-pg.js` corre solo al arrancar Marcos; el `.sql` lo aplica una
    // > persona. De ahí salió la restricción `facturas_estado_chk`, que CLAUDE.md anota como
    // > "alguien la creó a mano en el servidor" y que rompe la regla de oro del repo.
    const soloSql = [];
    for (const u of columnasUsadas()) {
        if (tiene(declaradas, u.tabla, u.columna)) continue;
        if (tiene(aMano, u.tabla, u.columna)) soloSql.push(`${u.tabla}.${u.columna}`);
    }
    const unicas = [...new Set(soloSql)].sort();
    if (unicas.length) {
        console.log(`       ${unicas.length} columna(s) vienen de ${MIGRACIONES.join(', ')}:`);
        console.log(`       ${unicas.join(', ')}`);
        console.log(`       Si el servidor se reinstala sin correr ese archivo, no existen.`);
    }
});

console.log('\n── LAS DOS MARCAS DE ENTREGA AL TÉCNICO ──');

prueba('material_enviado_tecnico y contacto_acceso_avisado están las dos', () => {
    // Se borran juntas en un mismo UPDATE: si falta una, el reintento de lo que Meta rechazó no
    // ocurre nunca del lado que lee Marcos.
    for (const c of ['material_enviado_tecnico', 'contacto_acceso_avisado']) {
        assert.ok(tiene(declaradas, 'reportes', c), `falta reportes.${c} en db-pg.js`);
    }
});

console.log('');
if (fallos === 0) {
    console.log('✅ Todo lo que el código escribe existe en PostgreSQL.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
