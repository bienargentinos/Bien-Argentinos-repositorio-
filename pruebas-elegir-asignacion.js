/**
 * A QUÉ TÉCNICO SE LE MANDA EL TRABAJO
 *
 * > [!CAUTION]
 * > **La prioridad que el administrador carga en el panel no se usaba en ningún lado.**
 *
 * El panel deja elegir, por rubro, si un proveedor es *1ra opción*, *2da opción* o *urgencias*.
 * Las dos copias de `buscarTecnicoAsignado` --`datos-pg.js` y `sheets.js`-- hacían
 * `filas.find(...)`: la primera fila que devolviera la base. En PostgreSQL eso no promete ningún
 * orden, y una fila actualizada se mueve al final del heap.
 *
 * Con un solo proveedor por rubro --el caso de prueba-- acierta siempre. El bug solo existe con
 * dos, que es exactamente lo que nunca se probó.
 *
 * Y el segundo agujero: `telefonoUsable()` existía y se usaba **solo** para el contacto de
 * ingreso. Acá no se miraba, así que una ficha con `11111111111` se elegía igual, la plantilla
 * rebotaba, y el caso quedaba con un técnico al que nadie puede llamar.
 *
 *     node pruebas-elegir-asignacion.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { elegirAsignacion, ordenDePrioridad } = require('./elegir-asignacion');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

// Filas de mentira con la misma forma que las de las dos bases.
const fila = (o) => ({ ...o, get(c) { return this[c]; } });
const leer = (f, campo) => f.get(campo);
const elegir = (filas, opts) => elegirAsignacion(filas, opts, leer)?.fila?.proveedor || null;

const EDIF = 'san patricio 159';
const base = { rubro: 'cerrajero', edificio: EDIF };

// El log se silencia: varias verificaciones esperan avisos y ensucian la salida.
const warnOriginal = console.warn;
console.warn = () => {};

console.log('\n🔧 A QUÉ TÉCNICO SE LE MANDA EL TRABAJO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) La prioridad que carga el administrador manda');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Cargadas al revés a propósito: con `.find()` ganaba "Segundo" por estar primero en la lista.
    const dos = [
        fila({ ...base, proveedor: 'Segundo', telefono: '541133334444', prioridad: '2da opción' }),
        fila({ ...base, proveedor: 'Primero', telefono: '541155556666', prioridad: '1ra opción' }),
    ];
    vale('con dos asignados gana la 1ra opción, no el orden de la base',
        elegir(dos, { edificio: EDIF, especialidad: 'cerrajeria' }) === 'Primero',
        'Esto es lo que decidía por el orden físico de las filas.');

    // En una urgencia manda quien está marcado para urgencias, aunque sea 2da para un trabajo normal.
    const conUrgencias = [
        ...dos,
        fila({ ...base, proveedor: 'DeGuardia', telefono: '541177778888', prioridad: '2da Opción + Urgencias' }),
    ];
    vale('en una urgencia gana el de urgencias',
        elegir(conUrgencias, { edificio: EDIF, especialidad: 'cerrajeria', esUrgente: true }) === 'DeGuardia');
    vale('y en un trabajo normal NO se lo saltea a la 1ra opción',
        elegir(conUrgencias, { edificio: EDIF, especialidad: 'cerrajeria' }) === 'Primero');

    // El texto lo escribe el panel y no está normalizado.
    vale('"primera", "1ra", "1ra Opción" caen todas en el mismo lugar',
        ordenDePrioridad('primera') === ordenDePrioridad('1ra opción') &&
        ordenDePrioridad('1ra Opción') === ordenDePrioridad('primera'));
    vale('sin prioridad cargada queda último',
        ordenDePrioridad('') > ordenDePrioridad('2da opción'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Un teléfono al que no se puede llamar se saltea');
// ─────────────────────────────────────────────────────────────────────────────
{
    // > [!CAUTION]
    // > **Mandar la plantilla a un número que no existe deja el reclamo "en proceso" y muerto.**
    // > El administrador lo ve asignado y no pasa nunca nada.
    const conRelleno = [
        fila({ ...base, proveedor: 'Relleno', telefono: '11111111111', prioridad: '1ra opción' }),
        fila({ ...base, proveedor: 'Bueno',   telefono: '541155556666', prioridad: '2da opción' }),
    ];
    vale('se baja al siguiente de la lista', elegir(conRelleno, { edificio: EDIF, especialidad: 'cerrajeria' }) === 'Bueno',
        'Rechazar de más llama al segundo; aceptar de más deja el reclamo muerto en silencio.');

    const corto = [
        fila({ ...base, proveedor: 'Corto', telefono: '12345667', prioridad: '1ra opción' }),
        fila({ ...base, proveedor: 'Bueno', telefono: '541155556666', prioridad: '2da opción' }),
    ];
    vale('ocho dígitos tampoco sirven', elegir(corto, { edificio: EDIF, especialidad: 'cerrajeria' }) === 'Bueno');

    const vacio = [fila({ ...base, proveedor: 'SinTel', telefono: '', prioridad: '1ra opción' })];
    vale('sin teléfono y sin nadie más, no se asigna ninguno',
        elegir(vacio, { edificio: EDIF, especialidad: 'cerrajeria' }) === null,
        'Es mejor que el caso quede sin técnico y se vea, a que quede asignado a la nada.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Lo que NO cambió, a propósito');
// ─────────────────────────────────────────────────────────────────────────────
{
    // La comparación de rubros vino copiada tal cual de las dos versiones. Unificarla con
    // `atiendeRubro` cambiaría a quién se le deriva cada caso, y eso es su propio trabajo.
    const cerraj = [fila({ ...base, proveedor: 'Cerrajero', telefono: '541155556666', prioridad: '1ra opción' })];
    vale('cerrajería sigue matcheando con "cerraj"', elegir(cerraj, { edificio: EDIF, especialidad: 'cerrajeria' }) === 'Cerrajero');
    vale('y "portero" también, como antes', elegir(
        [fila({ ...base, rubro: 'porteria', proveedor: 'Portero', telefono: '541155556666', prioridad: '1ra opción' })],
        { edificio: EDIF, especialidad: 'cerrajeria' }) === 'Portero');

    const electr = [fila({ ...base, rubro: 'electricista', proveedor: 'Electricista', telefono: '541155556666' })];
    vale('un rubro que no corresponde no se elige',
        elegir(electr, { edificio: EDIF, especialidad: 'plomeria' }) === null);

    // Estados que lo sacan de la lista.
    const eliminado = [
        fila({ ...base, proveedor: 'Borrado', telefono: '541155556666', prioridad: '1ra opción', estado: 'eliminado' }),
        fila({ ...base, proveedor: 'Vivo',    telefono: '541177778888', prioridad: '2da opción' }),
    ];
    vale('un proveedor eliminado no se elige', elegir(eliminado, { edificio: EDIF, especialidad: 'cerrajeria' }) === 'Vivo');

    // El edificio de otro consorcio no entra.
    const otro = [fila({ ...base, edificio: 'rivadavia 4', proveedor: 'DelOtro', telefono: '541155556666' })];
    vale('un proveedor de otro edificio no se elige',
        elegir(otro, { edificio: EDIF, especialidad: 'cerrajeria' }) === null);

    // Y el comodín del edificio vacío SIGUE valiendo, porque sacarlo a ciegas puede dejar sin
    // técnico a un edificio que hoy lo encuentra por esa vía. Queda avisado en el log.
    const sinEdificio = [fila({ ...base, edificio: '', proveedor: 'ParaTodos', telefono: '541155556666' })];
    vale('una asignación sin edificio sigue valiendo para todos (y lo avisa)',
        elegir(sinEdificio, { edificio: EDIF, especialidad: 'cerrajeria' }) === 'ParaTodos');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El candado contra la tercera copia');
// ─────────────────────────────────────────────────────────────────────────────
{
    const pg = fs.readFileSync(path.join(__dirname, 'datos-pg.js'), 'utf8');
    const sh = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');
    const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    vale('datos-pg.js llama al módulo', /elegirAsignacion\(/.test(sinComentarios(pg)));
    vale('sheets.js también', /elegirAsignacion\(/.test(sinComentarios(sh)));

    // > Estaba escrita DOS VECES, igual. Y como `datos.js` lee PostgreSQL primero, arreglar solo
    // > la de Sheets no habría cambiado nada en producción — lo mismo que con `buscarPerfilEdificio`.
    //
    // El candado mide la PROPIEDAD: que ninguna de las dos vuelva a elegir con `.find()` sobre las
    // asignaciones, que es lo que ignoraba la prioridad.
    for (const [nombre, src] of [['datos-pg.js', pg], ['sheets.js', sh]]) {
        const fn = (sinComentarios(src).match(/async function buscarTecnicoAsignado[\s\S]*?\n\}/) || [''])[0];
        const bloque = fn.slice(0, fn.indexOf('proveedores') > 0 ? fn.indexOf('proveedores') : fn.length);
        vale(`${nombre} ya no elige la asignación con .find()`,
            !/\.find\(/.test(bloque),
            'Con `.find()` decide el orden en que la base devolvió las filas, no la prioridad.');
    }

    vale('el teléfono se valida con la función que ya existía',
        /require\('\.\/contacto-ingreso'\)/.test(fs.readFileSync(path.join(__dirname, 'elegir-asignacion.js'), 'utf8')),
        'Escribir un segundo validador de teléfonos es cómo se desincronizan.');
}

console.warn = warnOriginal;

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  A quién se le manda el trabajo decide quién atiende un reclamo a las once de la noche.\n');
    process.exit(1);
}
console.log('\n   🔧 Manda la prioridad que cargó el administrador, y un teléfono muerto se saltea.\n');
