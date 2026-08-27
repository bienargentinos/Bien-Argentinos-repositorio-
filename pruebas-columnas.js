// Verifica que una columna que no entra en la hoja NO se pierda en silencio.
//
//   node pruebas-columnas.js
//
// POR QUÉ. Una hoja de Google nace con 26 columnas (A..Z) y `EVENTOS` necesita más de treinta.
// Al pasarse, `setHeaderRow` tira "Sheet is not large enough to fit N columns" -- y los doce
// lugares que creaban columnas lo atrapaban con `.catch(() => {})`. Desde ahí `addRow` DESCARTA
// EN SILENCIO toda clave que no sea una columna existente.
//
// Eso no se ve por ningún lado: el dato se pasa completo desde index.js, la función devuelve
// bien, el log dice que se guardó, y la celda queda vacía. Así se perdieron `tecnico`,
// `tel_tecnico` y `rubro_tecnico` en los cuatro primeros casos reales. `tel_tecnico` es el
// teléfono de quien está escribiendo: no puede estar vacío, y estaba vacío en los cuatro.
//
// No hay red ni planilla acá: se le pasa una hoja de mentira que se comporta como la de verdad
// (incluido plantarse cuando no hay lugar), y se mira qué hizo `asegurarColumnas` con ella.

process.env.GOOGLE_CREDENTIALS_FILE = process.env.GOOGLE_CREDENTIALS_FILE || 'credenciales-de-mentira.json';
const { asegurarColumnas } = require('./sheets');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

/**
 * Una hoja de mentira que se planta igual que la de verdad: `setHeaderRow` falla si los
 * encabezados no entran en `columnCount`. Sin esa condición la prueba no probaría nada.
 */
function hojaFalsa({ headers = [], columnCount = 26, title = 'EVENTOS', duplicada = '', resizeFalla = false } = {}) {
    const registro = { agrandadaA: null, encabezadoEscrito: null, gritos: [] };
    return {
        title,
        columnCount,
        rowCount: 500,
        headerValues: headers.slice(),
        registro,
        async loadHeaderRow() {
            if (duplicada) {
                throw new Error(`Duplicate header detected: "${duplicada}". Please make sure all non-empty headers are unique`);
            }
        },
        async resize({ columnCount: cuantas }) {
            if (resizeFalla) throw new Error('no se pudo agrandar la hoja');
            registro.agrandadaA = cuantas;
            this.columnCount = cuantas;
        },
        async setHeaderRow(valores) {
            if (valores.length > this.columnCount) {
                throw new Error(`Sheet is not large enough to fit ${valores.length} columns. Resize the sheet first.`);
            }
            registro.encabezadoEscrito = valores.slice();
            this.headerValues = valores.slice();
        },
    };
}

// `asegurarColumnas` avisa por consola cuando algo falla. Que grite es parte de lo que se prueba:
// el error de antes era justamente que no gritaba.
async function conConsolaCallada(hoja, necesarias) {
    const errOriginal = console.error;
    const logOriginal = console.log;
    console.error = (...a) => hoja.registro.gritos.push(a.join(' '));
    console.log = () => {};
    try {
        return await asegurarColumnas(hoja, necesarias, hoja.title);
    } finally {
        console.error = errOriginal;
        console.log = logOriginal;
    }
}

(async () => {

console.log('\n── EL CASO REAL: NO ENTRA UNA COLUMNA MÁS ──');
{
    // 26 columnas de hoja, 24 ya usadas, y EVENTOS necesita las de técnico. Con el código viejo
    // esto fallaba y se tragaba el error; `tel_tecnico` no llegaba nunca a la planilla.
    const puestas = Array.from({ length: 24 }, (_, i) => `col${i + 1}`);
    const hoja = hojaFalsa({ headers: puestas, columnCount: 26 });
    const quedaron = await conConsolaCallada(hoja, ['tecnico', 'tel_tecnico', 'rubro_tecnico', 'proximo_seguimiento']);

    verificar('la hoja se agranda antes de escribir', hoja.registro.agrandadaA !== null, true);
    verificar('entra tel_tecnico', quedaron.includes('tel_tecnico'), true);
    verificar('entra rubro_tecnico', quedaron.includes('rubro_tecnico'), true);
    verificar('y el encabezado se escribió de verdad', hoja.registro.encabezadoEscrito !== null, true);
    verificar('no hizo falta gritar nada', hoja.registro.gritos.length, 0);
}

console.log('\n── NO SE TOCA LO QUE YA ESTABA ──');
{
    // Los datos de las filas viven por POSICIÓN, no por nombre. Reescribir el encabezado en otro
    // orden le cambia el nombre a columnas que tienen adentro otra cosa.
    const hoja = hojaFalsa({ headers: ['fecha', 'edificio', 'vecino'], columnCount: 50 });
    const quedaron = await conConsolaCallada(hoja, ['vecino', 'fecha', 'tel_tecnico']);
    verificar('las viejas quedan en su lugar y la nueva va al final',
        quedaron, ['fecha', 'edificio', 'vecino', 'tel_tecnico']);
}

{
    // Este es el que más daño hacía y no se veía: el `new Set([...headers, ...necesarias])` de
    // antes COLAPSABA las columnas sin título en una sola. El encabezado salía más corto que la
    // hoja, y a partir de ahí cada columna quedaba con el nombre de la de al lado.
    const hoja = hojaFalsa({ headers: ['fecha', '', '', 'vecino'], columnCount: 50 });
    const quedaron = await conConsolaCallada(hoja, ['tel_tecnico']);
    verificar('dos columnas sin título NO se colapsan en una',
        quedaron, ['fecha', '', '', 'vecino', 'tel_tecnico']);
}

console.log('\n── CUANDO NO HAY NADA QUE HACER, NO SE TOCA NADA ──');
{
    const hoja = hojaFalsa({ headers: ['fecha', 'vecino', 'tel_tecnico'], columnCount: 26 });
    const quedaron = await conConsolaCallada(hoja, ['fecha', 'tel_tecnico']);
    verificar('no se reescribe el encabezado', hoja.registro.encabezadoEscrito, null);
    verificar('no se agranda la hoja', hoja.registro.agrandadaA, null);
    verificar('devuelve lo que ya estaba', quedaron, ['fecha', 'vecino', 'tel_tecnico']);
}

{
    // Hay lugar de sobra: se agrega la columna pero no se toca el tamaño de la hoja.
    const hoja = hojaFalsa({ headers: ['fecha'], columnCount: 26 });
    await conConsolaCallada(hoja, ['tel_tecnico']);
    verificar('con lugar de sobra no se agranda al pedo', hoja.registro.agrandadaA, null);
    verificar('pero la columna se crea', hoja.headerValues.includes('tel_tecnico'), true);
}

console.log('\n── SI NO SE PUEDE, SE DICE ──');
{
    // Si la hoja no se puede agrandar, lo único inaceptable es seguir como si nada. No se
    // escribe el encabezado (fallaría igual) y queda dicho en el log que lo que se guarde ahí
    // se va a perder.
    const puestas = Array.from({ length: 26 }, (_, i) => `col${i + 1}`);
    const hoja = hojaFalsa({ headers: puestas, columnCount: 26, resizeFalla: true });
    const quedaron = await conConsolaCallada(hoja, ['tel_tecnico']);

    verificar('no se intenta escribir un encabezado que no entra', hoja.registro.encabezadoEscrito, null);
    verificar('devuelve los encabezados viejos, no una lista inventada', quedaron.length, 26);
    verificar('y GRITA que el dato se va a perder',
        hoja.registro.gritos.some(g => /SE VA A PERDER EN SILENCIO/.test(g)), true);
}

{
    // Un encabezado repetido rompe la pestaña entera: la librería se planta y desde ahí no se
    // puede leer ni escribir por nombre. No se arregla desde el código -- hay que borrar la
    // columna a mano en la planilla. Lo único útil acá es decirlo, no tragarlo.
    const hoja = hojaFalsa({ headers: ['fecha', 'tecnico', 'tecnico'], duplicada: 'tecnico', columnCount: 50 });
    const quedaron = await conConsolaCallada(hoja, ['tel_tecnico']);

    verificar('no se escribe nada encima de una pestaña rota', hoja.registro.encabezadoEscrito, null);
    verificar('avisa cuál es la columna repetida',
        hoja.registro.gritos.some(g => /Duplicate header/.test(g) && /tecnico/.test(g)), true);
    verificar('y dice que se arregla a mano',
        hoja.registro.gritos.some(g => /A MANO/.test(g)), true);
    verificar('devuelve lo que había', quedaron, ['fecha', 'tecnico', 'tecnico']);
}

console.log('\n── QUE NO PUEDA VOLVER POR OTRA FUNCIÓN ──');
{
    // El error no estaba en una función: estaba en DOCE, todas con el mismo `.catch(() => {})`.
    // Arreglar las doce no sirve de nada si la próxima que se escriba vuelve a hacerlo, así que
    // se prohíbe el patrón entero fuera de `asegurarColumnas`.
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, 'sheets.js'), 'utf8');

    const tragados = (src.match(/setHeaderRow\([^)]*\)\s*\.catch/g) || []).length;
    verificar('ningún setHeaderRow se traga su error', tragados, 0);

    // Y que nadie la llame directo salteándose el helper: la única llamada legítima es la que
    // está adentro de `asegurarColumnas`.
    const llamadas = (src.match(/\.setHeaderRow\(/g) || []).length;
    verificar('setHeaderRow se llama en un solo lugar', llamadas, 1);

    // El diagnóstico (`revisar-columnas.js`) solo sirve si su lista sabe de todas las pestañas
    // donde el código crea columnas. Si mañana alguien empieza a escribir en una pestaña nueva y
    // no la agrega a `columnas-necesarias.js`, el diagnóstico va a decir que está todo bien
    // mientras el dato se pierde -- que es exactamente el agujero que estamos tapando.
    const NECESARIAS = require('./columnas-necesarias');
    const conocidas = Object.keys(NECESARIAS).map(k => k.toLowerCase());
    const usadas = [...src.matchAll(/asegurarColumnas\([^,]+,[^,]+,\s*'([^']+)'\s*\)/g)]
        .map(m => m[1].toLowerCase());
    const huerfanas = [...new Set(usadas)].filter(p => !conocidas.includes(p));
    verificar('toda pestaña donde se crean columnas está en columnas-necesarias.js', huerfanas, []);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);

})();
