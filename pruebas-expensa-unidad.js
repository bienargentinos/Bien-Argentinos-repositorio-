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
        afirmar('busca primero la del departamento', m[0].includes('(departamento IS NULL) ASC'));
        afirmar('descarta las eliminadas', m[0].includes("<> 'eliminada'"));
        afirmar('devuelve null si no hay', m[0].includes('if (!fila) return null;'));
    }
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
    // De dónde salió el número: 'ia' o 'manual'. Un monto leído mal es peor que ninguno, y acá no
    // hay dígito verificador como en el CBU, así que hay que poder distinguirlos.
    afirmar('monto_origen solo acepta ia o manual', /monto_origen IN \('ia', 'manual'\)/.test(DB));
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

console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
