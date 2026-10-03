/**
 * "LA MÁS PARECIDA" TIENE QUE SER LA MÁS PARECIDA DE VERDAD
 *
 * > [!CAUTION]
 * > **Esta herramienta no borra: le muestra a una persona lo que tiene que decidir.** Si le
 * > muestra la comparación equivocada, la persona decide mal — y con más confianza, porque el
 * > script se lo dijo.
 *
 * Caso real del 22/09/2026. En `proveedor_asignaciones` quedó una fila huérfana con el nombre
 * viejo de un proveedor (`dario juju`), y había dos filas con el nombre nuevo (`Dario`): una en
 * el MISMO edificio y otra en otro. El informe salió así:
 *
 *     ⚠️  edificio=san patricio casa · rubro=Electricista · telefono=1169241157 · prioridad=primera
 *         NO se borra: la más parecida con "Dario" difiere en edificio, telefono, prioridad.
 *           edificio:  "san patricio casa"   vs   "San patricio 270"
 *           telefono:  "1169241157"   vs   "541169241157"
 *
 * Dos errores en cuatro renglones:
 *
 * 1. **Eligió la gemela del otro edificio.** Era `gemelas.rows.find(g => comparables.some(...))`:
 *    `some` dentro de `find` es "la PRIMERA que coincida en ALGO", y el orden lo decide
 *    PostgreSQL. La del 270 coincidía en `rubro` y estaba antes en el montón.
 * 2. **`1169241157` y `541169241157` son el mismo teléfono.** Con y sin código de país.
 *
 * Quien lee eso concluye lo contrario de lo correcto: *"la otra es de otro consorcio, entonces
 * esta fila es única y hay que conservarla"*. La gemela verdadera estaba en el mismo edificio y
 * difería en UNA sola cosa.
 *
 *     node pruebas-quitar-duplicados.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

const archivo = path.join(__dirname, 'quitar-duplicados.js');
const fuente = fs.readFileSync(archivo, 'utf8');

// El archivo CITA la forma vieja en sus comentarios, a propósito: explicar el bug es la mitad del
// arreglo. Pero un candado que mira la documentación se dispara con la explicación, y entonces
// contar qué pasó sale prohibido. Ya pasó dos veces en este proyecto. Se mira solo el código.
const soloCodigo = (txt) => txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const codigo = soloCodigo(fuente);

// El archivo se conecta a PostgreSQL al correr, así que no se carga: se le extraen las dos
// funciones puras y se las evalúa sueltas. Es el mismo recurso que usa `pruebas-ventana-24hs.js`.
const recortar = (nombre) => {
    const desde = fuente.indexOf(`function ${nombre}(`);
    if (desde === -1) throw new Error(`No está la función ${nombre} en quitar-duplicados.js`);
    let nivel = 0;
    for (let i = fuente.indexOf('{', desde); i < fuente.length; i++) {
        if (fuente[i] === '{') nivel++;
        else if (fuente[i] === '}' && --nivel === 0) return fuente.slice(desde, i + 1);
    }
    throw new Error(`No se pudo recortar ${nombre}`);
};

const preambulo = (fuente.match(/const norm = [\s\S]*?\.toLowerCase\(\)\.trim\(\);/) || [''])[0]
    + '\n' + (fuente.match(/const esColumnaTelefono = .*;/) || [''])[0]
    + '\n' + (fuente.match(/const soloDigitos = .*;/) || [''])[0];

// eslint-disable-next-line no-eval
const mismoValor = eval(`(() => { ${preambulo}\n${recortar('mismoValor')}\nreturn mismoValor; })()`);

console.log('\n🧹 "LA MÁS PARECIDA" TIENE QUE SER LA MÁS PARECIDA DE VERDAD\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) El mismo teléfono escrito de dos formas no es una diferencia');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('`1169241157` y `541169241157` son el mismo (el caso real)',
        mismoValor('telefono', '1169241157', '541169241157'));

    vale('y al revés también', mismoValor('telefono', '541169241157', '1169241157'));

    vale('con el +54 9 y separadores, también',
        mismoValor('telefono', '+54 9 11 6924-1157', '1169241157'));

    vale('`tel`, `tel_tecnico` y `telefono_encargado` cuentan como teléfono',
        mismoValor('tel', '541169241157', '1169241157')
        && mismoValor('tel_tecnico', '541169241157', '1169241157')
        && mismoValor('telefono_encargado', '541169241157', '1169241157'));

    // Y lo que NO puede pasar: dos números distintos dados por iguales. Un proveedor con el
    // teléfono de otro es un llamado a la persona equivocada.
    vale('dos números distintos siguen siendo distintos',
        !mismoValor('telefono', '1169241157', '1167350436'));

    vale('los últimos 10 mandan, no los primeros',
        !mismoValor('telefono', '5491169241157', '5491169241158'));

    // Un campo vacío contra uno lleno no se puede comparar por dígitos: se cae al texto.
    vale('vacío contra lleno NO es lo mismo', !mismoValor('telefono', '', '1169241157'));
    vale('vacío contra vacío sí', mismoValor('telefono', '', ''));

    // Y una columna que no es de teléfono se sigue comparando como texto, con acentos plegados.
    vale('`edificio` NO se compara por dígitos',
        !mismoValor('edificio', 'san patricio 159', 'san patricio 270'),
        'Si se comparara por dígitos, dos consorcios de la misma calle serían el mismo.');

    vale('y sí tolera acentos y mayúsculas',
        mismoValor('edificio', 'San Patrício Casa', 'san patricio casa'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Se elige la gemela que coincide en MÁS campos, no la primera');
// ─────────────────────────────────────────────────────────────────────────────
{
    // El candado es sobre el código: la forma vieja (`find` con `some` adentro) es la que produjo
    // el informe equivocado, y no puede volver por descuido.
    const bloque = (codigo.match(/let parecida = null[\s\S]{0,700}?\n            \}/) || [''])[0];

    vale('existe la elección por cantidad de coincidencias',
        /mejorCoincidencias/.test(bloque) && /coinciden > mejorCoincidencias/.test(bloque),
        'Sin esto gana la primera fila que coincida en cualquier cosa.');

    vale('ya no se elige con `find` + `some`',
        !/gemelas\.rows\.find\(g =>\s*comparables\.some/.test(codigo),
        'Esa es exactamente la forma que eligió el edificio equivocado.');

    vale('la comparación pasa por `mismoValor`, no por `norm` directo',
        /comparables\.filter\(c => !mismoValor\(c, parecida\[c\], vieja\[c\]\)\)/.test(codigo),
        'Con `norm` a secas, el teléfono con y sin 54 vuelve a contar como diferencia.');

    vale('la gemela exacta también usa `mismoValor`',
        /comparables\.every\(c => mismoValor\(c, g\[c\], vieja\[c\]\)\)/.test(codigo));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) La salida de emergencia existe, y dice qué se pierde');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('hay un `--aunque-difiera`', /includes\('--aunque-difiera'\)/.test(codigo),
        'Sin una forma de levantar la negativa, el trabajo se termina a mano en psql. Eso es peor.');

    vale('se escribe entero: no hay abreviatura que se acierte sin querer',
        !/'-a'|'-f'|'--forzar'/.test(codigo));

    vale('al borrar, imprime exactamente qué dato se descarta',
        /Se perdió: \$\{sePierde\}/.test(codigo),
        'Un borrado silencioso de un dato que alguien decidió perder es lo que esta herramienta vino a evitar.');

    vale('sin `--aplicar` tampoco borra, aunque esté `--aunque-difiera`',
        /if \(aplicar\) \{[\s\S]{0,200}?DELETE FROM[\s\S]{0,200}?\} else \{[\s\S]{0,200}?se borraría igual/.test(codigo));

    vale('y sin la bandera se sigue negando y lo explica',
        /Si ya lo miraste y sobra, agregá --aunque-difiera/.test(codigo));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El caso real, reconstruido');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Las tres filas tal cual salieron de la base, y la pregunta que el script tiene que contestar:
    // ¿cuál de las dos "Dario" es la gemela de la huérfana?
    const vieja = { cliente: 'alfa_01', edificio: 'san patricio casa', rubro: 'Electricista', telefono: '1169241157', prioridad: 'primera', estado: 'activo' };
    const candidatas = [
        { cliente: 'alfa_01', edificio: 'San patricio 270', rubro: 'Electricista', telefono: '541169241157', prioridad: 'primera_urgencia', estado: 'activo' },
        { cliente: 'alfa_01', edificio: 'san patricio casa', rubro: 'Electricista', telefono: '541169241157', prioridad: 'primera_urgencia', estado: 'activo' },
    ];
    const comparables = ['cliente', 'edificio', 'proveedor', 'rubro', 'telefono', 'prioridad', 'estado'];

    let elegida = null, mejor = 0;
    for (const g of candidatas) {
        const n = comparables.filter(c => String(vieja[c] ?? '').trim() && mismoValor(c, g[c], vieja[c])).length;
        if (n > mejor) { mejor = n; elegida = g; }
    }

    vale('elige la del MISMO edificio', elegida?.edificio === 'san patricio casa',
        `Eligió: ${elegida?.edificio}`);

    const difieren = comparables.filter(c => !mismoValor(c, elegida[c], vieja[c]));

    vale('y la única diferencia real es la prioridad',
        difieren.length === 1 && difieren[0] === 'prioridad',
        `Difieren: ${difieren.join(', ') || '(ninguna)'}`);

    // Con la forma vieja habría ganado la primera que coincidiera en algo: la del 270.
    const comoAntes = candidatas.find(g => comparables.some(c => String(vieja[c] ?? '').trim() && String(g[c] ?? '').toLowerCase() === String(vieja[c] ?? '').toLowerCase()));
    vale('la forma vieja habría elegido el otro edificio (por eso este candado existe)',
        comoAntes?.edificio === 'San patricio 270');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Una comparación equivocada hace que la persona decida mal, y con confianza.\n');
    process.exit(1);
}
console.log('\n   🧹 Se compara contra la gemela verdadera, y el teléfono no inventa diferencias.\n');
