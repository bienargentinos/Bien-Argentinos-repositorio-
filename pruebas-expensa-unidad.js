// El monto de la expensa sale del documento, no del código.
//
//   node pruebas-expensa-unidad.js
//
// POR QUÉ. La tarjeta del Inicio mostraba `$120.000,00` **escrito a mano**: el mismo número para
// todos los vecinos de todos los edificios, y un badge verde que decía "Al día" sin que nadie
// supiera si esa persona debía algo.
//
// La tabla `expensas` no tenía ni monto ni departamento --era el PDF del edificio entero-- y no
// existe ninguna tabla de deuda por unidad. O sea que el número no salía de ningún lado.
//
// Pedido de Daniel (23/09): que el administrador suba el documento de cada unidad y que la IA le
// extraiga el total. Así el monto es lo que dice el papel, no lo que dice el código.

const fs = require('fs');
const path = require('path');

const PORTAL = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');
const DEMO = fs.readFileSync(path.join(__dirname, 'sesion-demo.js'), 'utf8');
const DB = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}
const afirmar = (titulo, cond) => verificar(titulo, !!cond, true);

// El código sin comentarios: los que explican qué se sacó nombran lo viejo a propósito.
const sinComentarios = PORTAL.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n── NO QUEDA NINGÚN MONTO ESCRITO A MANO ──');
{
    afirmar('no hay $120.000 en el portal', !sinComentarios.includes('120.000'));
    afirmar('ni en la sesión de prueba', !DEMO.includes('120.000'));
    afirmar('se fue saldoExpensa', !/\bv\.saldoExpensa\b/.test(sinComentarios));
    afirmar('y estadoExpensa', !/\bv\.estadoExpensa\b/.test(sinComentarios));
    // "Al día" afirma que no debe nada. La tabla guarda el documento y su monto, NO si lo pagó.
    afirmar('no se afirma "Al día"', !/Al día/.test(sinComentarios));
}

console.log('\n── SIN EXPENSA CARGADA NO SE MUESTRA $0 ──');
{
    // $0 diría "no debés nada", que es una afirmación. "Todavía no está cargada" es lo que pasa.
    afirmar('la tarjeta contempla que no haya ninguna', PORTAL.includes("t('expensa.sinCargar')"));
    afirmar('el monto solo se muestra si existe', /expensa && expensa\.monto !== null/.test(PORTAL));

    const { textos } = require('./idiomas');
    for (const i of ['es', 'en', 'pt', 'fr']) {
        const txt = textos(i)('expensa.sinCargar');
        afirmar(`en ${i} dice que falta cargarla, no que no debe`, txt.length > 10 && !/\$\s*0/.test(txt));
    }
}

console.log('\n── EL MONTO SALE DE LA BASE ──');
{
    afirmar('el portal llama a expensaDeUnidad', PORTAL.includes('expensaDeUnidad(v.edificio, v.departamento)'));
    afirmar('existe en db-pg', /async function expensaDeUnidad/.test(DB));
    const m = DB.match(/async function expensaDeUnidad[\s\S]*?\n}/);
    if (m) {
        afirmar('busca primero la del departamento', m[0].includes('|| delEdificio.find(r => !claveUnidad'));
        afirmar('descarta las eliminadas', m[0].includes("<> 'eliminada'"));
        afirmar('devuelve null si no hay', m[0].includes('if (!fila) return null;'));
        // El departamento lo tipea el administrador en el panel y el de la sesión viene de cómo se
        // cargó la unidad: dos textos escritos por personas distintas. Compararlos carácter por
        // carácter es el error que este repo ya pagó tres veces.
        afirmar('NO compara el departamento con igualdad exacta en SQL',
            !/LOWER\(TRIM\(COALESCE\(departamento/.test(m[0]));
        afirmar('usa claveUnidad, que ya existe', m[0].includes("require('./edificio-clave')"));
    }
}

console.log('\n── "1° A", "1º A" Y "1A" SON EL MISMO DEPARTAMENTO ──');
{
    // El símbolo de grado (°) y el ordinal masculino (º) se ven iguales en pantalla y son dos
    // caracteres distintos. Si el administrador tipea uno y la unidad se cargó con el otro, la
    // expensa no aparece nunca y no hay ningún error que lo delate.
    const { claveUnidad } = require('./edificio-clave');
    const mismaUnidad = (a, b) => claveUnidad(a) === claveUnidad(b);

    afirmar('grado vs ordinal masculino', mismaUnidad('1° A', '1º A'));
    afirmar('con y sin espacio', mismaUnidad('1° A', '1A'));
    afirmar('con guión', mismaUnidad('1-A', '1 a'));
    afirmar('mayúsculas', mismaUnidad('4°B', '4b'));

    // Y lo que NO puede pasar: que se lleve por delante a otra unidad.
    afirmar('el 1A no es el 11A', !mismaUnidad('1A', '11A'));
    afirmar('el 1A no es el 1B', !mismaUnidad('1° A', '1° B'));
    afirmar('un vacío no matchea con nada', !mismaUnidad('', '1A'));
    // Si cae al documento del edificio, la pantalla tiene que decirlo: no es la cuenta de la unidad.
    afirmar('avisa cuando es la del edificio', PORTAL.includes("t('expensa.delEdificio')"));
}

console.log('\n── LAS COLUMNAS EXISTEN ──');
{
    // Una columna que el código lee y la base no tiene hace fallar la consulta entera.
    for (const col of ['departamento', 'monto', 'monto_origen', 'vencimiento']) {
        afirmar(`expensas.${col} se crea`,
            new RegExp(`ALTER TABLE expensas ADD COLUMN IF NOT EXISTS ${col}\\b`).test(DB));
    }
    // De dónde salió el número: lo leyó la IA, o lo escribió una persona. Un monto leído mal es
    // peor que ninguno, y acá no hay dígito verificador como en el CBU, así que hay que poder
    // distinguirlos. QUÉ valores acepta se verifica más abajo contra lo que el panel escribe de
    // verdad: esta prueba pedía 'ia' y 'manual' a secas, y por eso no vio que el panel escribe
    // 'ocr' --o sea que medía el bug en vez de agarrarlo--.
    afirmar('monto_origen tiene su CHECK', /monto_origen IS NULL OR monto_origen IN \(/.test(DB));
    afirmar('distingue el monto leído del escrito a mano', /'manual'/.test(DB));
}

console.log('\n── EL IMPORTE SE ESCRIBE COMO EN ARGENTINA ──');
{
    // A mano y no con toLocaleString: el ICU reducido del VPS devuelve el formato de Estados
    // Unidos, y "$120,000.00" en un importe cambia lo que el vecino entiende.
    const m = PORTAL.match(/function montoEnPesos[\s\S]*?\n}/);
    afirmar('existe montoEnPesos', !!m);
    const montoEnPesos = new Function(m[0] + '; return montoEnPesos;')();
    verificar('120000', montoEnPesos(120000), '$120.000,00');
    verificar('1234.5', montoEnPesos(1234.5), '$1.234,50');
    verificar('999', montoEnPesos(999), '$999,00');
    verificar('un millón', montoEnPesos(1000000.99), '$1.000.000,99');
    verificar('cero', montoEnPesos(0), '$0,00');
    verificar('lo que no es número no rompe', montoEnPesos('x'), '');
    afirmar('no usa toLocaleString', !m[0].includes('toLocaleString'));
}

console.log('\n── EL CHECK NO PUEDE RECHAZAR LO QUE EL PANEL ESCRIBE ──');
{
    // CANDADO. Este es el bug que dejó a Daniel sin ver sus expensas, y no dio ni un error a la
    // vista: el CHECK de `monto_origen` aceptaba 'ia' y 'manual', el panel escribe 'ocr', y el
    // INSERT --que nombra las once columnas-- se rechazaba ENTERO. La fila quedaba en la planilla,
    // el panel la mostraba publicada, y PostgreSQL --que es de donde lee el portal-- no la tenía.
    // El error moría en un `console.warn` del panel.
    //
    // Por eso no alcanza con probar que el CHECK existe: hay que leer qué valores escribe el que
    // escribe, y exigir que el CHECK los acepte a todos. Un CHECK más estricto que quien inserta
    // no protege un dato: lo tira.
    const PANEL = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');

    const mCheck = DB.match(/monto_origen IS NULL OR monto_origen IN \(([^)]*)\)/);
    afirmar('el CHECK de monto_origen está escrito', !!mCheck);
    const aceptados = (mCheck ? mCheck[1] : '').match(/'([^']+)'/g) || [];
    const acepta = aceptados.map(x => x.replace(/'/g, ''));

    // Lo que el panel asigna a monto_origen, en cualquiera de sus formas.
    const escritos = new Set();
    const re = /monto_origen[^\n]*?=[^\n]*?'([a-z_]+)'|monto_origen:\s*[^\n]*?'([a-z_]+)'/g;
    let m;
    while ((m = re.exec(PANEL)) !== null) {
        const val = m[1] || m[2];
        if (val && val !== 'monto_origen' && val !== 'origen_monto') escritos.add(val);
    }
    // El ternario `x === 'ocr' ? 'ocr' : 'manual'` y sus variantes ya quedan cubiertos arriba.
    afirmar('se encontró al menos un valor que el panel escribe', escritos.size > 0);

    for (const val of escritos) {
        afirmar(`el CHECK acepta '${val}', que es lo que escribe el panel`, acepta.includes(val));
    }
}

console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
