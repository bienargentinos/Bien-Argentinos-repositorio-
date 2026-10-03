// BORRAR LA MARCA DE ENTREGA ES UNA CARRERA, Y SE PUEDE PERDER
//
//   node pruebas-rebote-con-fecha.js
//
// > [!CAUTION]
// > **El aviso de rechazo de Meta llega segundos después del envío, y la marca de entregado se
// > escribe justo después de que Meta ACEPTA el pedido.** Si el aviso llega primero, el borrado no
// > encuentra nada que borrar y la marca se escribe igual: queda diciendo "entregado" para siempre.
//
// EL CASO REAL (13/09). Daniel, después de la prueba con la ventana de 24hs cerrada: *"lo de la
// ventana funcionó a medias, porque mandé foto y contacto y el contacto no llegó ni en la plantilla
// ni en texto después de la apertura de ventana, y menos cuando el proveedor pidió reiteradamente"*.
//
// En el log hubo tres rechazos con 131047 y el borrado de marcas alcanzó al **CASO-1001** y no al
// **1002**, porque cuando llegó el aviso el 1002 todavía no tenía la marca puesta. Después se
// escribió, y a partir de ahí:
//
//     ℹ️ Al técnico ya se le había pasado el contacto de acceso del [CASO-1002], no se reenvía.
//
// El técnico lo pidió tres veces, Marcos le contestó con la foto, y terminó diciendo que prefería no
// ir antes que viajar sin saber si le abrían.
//
// El arreglo no es borrar mejor: es dejar de depender del orden. Se anota el rebote, y **queda
// invalidando hasta que una entrega buena lo limpia**.
//
// Comparar las dos fechas NO alcanza, y esta prueba lo demostró en el primer intento: la marca queda
// unos segundos DESPUÉS del rebote --el aviso de Meta llega entre el envío y la escritura de la
// marca--, así que "la marca es más nueva" daba por entregado justo el caso que hay que atrapar. Y
// separarlos por la diferencia de segundos habría sido un número mágico.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const sh = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');

// `entregaSigueValida` no se exporta (es interna de sheets.js) y cargar sheets.js abre Google, así
// que se extrae la función del código y se evalúa con un `require` de mentira. Lo que se prueba es
// el código real, no una copia escrita para la prueba.
const entregaSigueValida = (() => {
    const ini = sh.indexOf('function entregaSigueValida(');
    assert.ok(ini !== -1, 'no está `entregaSigueValida` en sheets.js');
    const fin = sh.indexOf('\n}', ini) + 2;
    const { fechaEnMs } = require('./caso-reciente');
    // eslint-disable-next-line no-new-func
    return new Function('require', `${sh.slice(ini, fin)}; return entregaSigueValida;`)(
        (m) => (m === './caso-reciente' ? { fechaEnMs } : require(m))
    );
})();

/** Una fila de la planilla, de mentira. */
const fila = (marca, rebote) => ({
    get: (c) => (c === 'entrega_rebotada' ? (rebote || '') : (marca || '')),
});

console.log('\n── LA MARCA VALE O NO SEGÚN CUÁNDO REBOTÓ ──');

prueba('sin marca, no está entregado', () => {
    assert.strictEqual(entregaSigueValida(fila('', ''), 'contacto_acceso_avisado'), false);
});

prueba('con marca y sin ningún rebote, está entregado', () => {
    assert.strictEqual(entregaSigueValida(fila('13/09/2026, 10:00:00', ''), 'contacto_acceso_avisado'), true);
});

prueba('rebote POSTERIOR a la marca: NO está entregado', () => {
    // Este es el caso normal, el que el borrado ya cubría.
    assert.strictEqual(
        entregaSigueValida(fila('13/09/2026, 10:00:00', '13/09/2026, 10:00:20'), 'contacto_acceso_avisado'),
        false);
});

prueba('rebote ANTERIOR a la marca: NO está entregado', () => {
    // ESTE es el que se perdía, y el que hace que comparar fechas no sirva. El aviso de Meta llegó a
    // las 10:00:05, el borrado no encontró nada porque la marca se escribió a las 10:00:10, y desde
    // ahí el caso decía "entregado" para siempre.
    assert.strictEqual(
        entregaSigueValida(fila('13/09/2026, 10:00:10', '13/09/2026, 10:00:05'), 'contacto_acceso_avisado'),
        false,
        'un rebote de hace 5 segundos tiene que invalidar la marca igual');
});

prueba('no decide por fechas: cualquier rebote sin limpiar invalida', () => {
    // Aunque el rebote sea de ayer y la marca de hoy. Lo que lo limpia es una entrega que salió, no
    // que pase el tiempo.
    assert.strictEqual(
        entregaSigueValida(fila('13/09/2026, 10:00:00', '12/09/2026, 23:50:00'), 'contacto_acceso_avisado'),
        false);
});

prueba('la fecha del rebote es para diagnosticar, no para decidir', () => {
    // Cualquier contenido en la celda invalida, legible o no: así una fecha rara no se interpreta
    // como "entregado".
    assert.strictEqual(entregaSigueValida(fila('13/09/2026, 10:00:00', 'cualquier cosa'), 'x'), false);
});

console.log('\n── LAS DOS MARCAS PASAN POR ESTO ──');

prueba('material y contacto de acceso usan la misma comprobación', () => {
    // Rebotan juntas: la foto y el contacto salen uno atrás del otro.
    for (const f of ['fueMaterialEnviadoATecnico', 'fueContactoAccesoAvisado']) {
        const i = sh.indexOf(`async function ${f}(`);
        const cuerpo = sh.slice(i, sh.indexOf('\n}', i));
        assert.ok(/entregaSigueValida/.test(cuerpo), `${f} no mira el rebote`);
        assert.ok(!/return !!\(row && row\.get\(/.test(cuerpo),
            `${f} volvió a mirar solo si la marca existe`);
    }
});

console.log('\n── EL REBOTE SE ANOTA, NO SOLO SE BORRA ──');

prueba('una entrega completa limpia el rebote', () => {
    // Sin esto el rebote invalidaría para siempre y el técnico recibiría la foto en cada mensaje.
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const i = idx.indexOf('async function entregarPendientesAlTecnico');
    const fn = idx.slice(i, idx.indexOf('\n    return quedaPendiente;', i) + 40);
    assert.ok(/marcarEntregaRebotada\(idEvento, false\)/.test(fn),
        'falta limpiar la marca de rebote cuando todo salió');
    assert.ok(/if \(!quedaPendiente\)/.test(fn),
        'la limpieza tiene que ser SOLO cuando no quedó nada pendiente');
});

prueba('el manejador de statuses anota la fecha además de borrar', () => {
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const i = idx.indexOf('desmarcarEntregasAlTecnico');
    const bloque = idx.slice(i - 400, i + 2200);
    assert.ok(/marcarEntregaRebotada\(c\.id_evento\)/.test(bloque),
        'sin anotar la fecha, la carrera vuelve');
    // El borrado NO se saca: sirve cuando el aviso llega después de la marca, que es el caso normal.
    assert.ok(/desmarcarEntregasAlTecnico\(c\.id_evento\)/.test(bloque),
        'el borrado tiene que seguir: los dos cubren órdenes distintos');
});

prueba('la columna está declarada en los dos lados', () => {
    // Una columna que el código escribe y la base no tiene hace fallar el statement ENTERO, y la
    // marca queda sin escribirse del lado que Marcos lee primero.
    const nec = fs.readFileSync(path.join(__dirname, 'columnas-necesarias.js'), 'utf8');
    assert.ok(/'entrega_rebotada'/.test(nec), 'falta en columnas-necesarias.js (Sheets)');
    const pg = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');
    assert.ok(/ADD COLUMN IF NOT EXISTS entrega_rebotada/.test(pg), 'falta en db-pg.js (PostgreSQL)');
});

console.log('');
if (fallos === 0) {
    console.log('✅ Un envío que rebotó no queda marcado como entregado, llegue el aviso cuando llegue.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
