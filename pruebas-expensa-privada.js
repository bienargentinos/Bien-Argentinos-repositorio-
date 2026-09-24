/**
 * LA EXPENSA DE UN VECINO NO SE SIRVE A CUALQUIERA
 *
 * > [!CAUTION]
 * > **Los PDF de expensas estaban en una carpeta pública, con nombre adivinable.**
 *
 * Mientras hubo una expensa por edificio no importaba: la veían todos igual, por diseño. Desde
 * que hay una por unidad --con el monto que debe cada vecino-- el mismo archivo es el dato
 * privado de una persona, y seguía a un `GET` de distancia de cualquiera.
 *
 * El filtrado por unidad del portal no alcanza: protege la pantalla, no el archivo. Y estas URL
 * circulan solas — Marcos comparte la expensa por WhatsApp y el vecino la reenvía.
 *
 * Lo que esta prueba cuida son las dos mitades del arreglo:
 *
 *   1. **Las TRES puertas**, no una. Bloquear `/archivos/expensas/` habría tapado dos de tres:
 *      `/audios` sirve la misma carpeta, y el buscador por nombre suelto encuentra el archivo
 *      sin la carpeta en el medio. La regla mira el NOMBRE.
 *   2. **El orden**: el guardia va antes de los `express.static`. Después, el archivo ya salió.
 *
 *     node pruebas-expensa-privada.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { esArchivoDeExpensa, puedeVerExpensa, rutaDelArchivo, guardiaExpensas } = require('./expensa-privada');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n🔒 LA EXPENSA DE UN VECINO NO SE SIRVE A CUALQUIERA\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Las tres puertas al mismo archivo');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Como lo pide un navegador por cada uno de los tres caminos.
    const puertas = [
        ['/expensas/expensa_1758658800000.pdf', 'la carpeta, bajo /archivos'],
        ['/expensas/expensa_1758658800000.pdf', 'la carpeta, bajo /audios'],
        ['/expensa_1758658800000.pdf',          'el nombre suelto, sin carpeta'],
        ['/expensas/expensa_1758658800000.jpg', 'una expensa subida como imagen'],
        ['/EXPENSAS/Expensa_123.PDF',           'con mayúsculas'],
        ['/expensas/liquidacion%20agosto.pdf',  'nombre con espacios codificados, en la carpeta'],
    ];
    for (const [ruta, comoLlega] of puertas) {
        vale(`se bloquea ${comoLlega}`, esArchivoDeExpensa(ruta), `Ruta: ${ruta}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Y lo que NO es una expensa sigue pasando');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Si el guardia se llevara puesto el resto, las fotos de los reclamos y los audios de los
    // vecinos dejarían de llegarle al técnico — un arreglo que rompe el producto no es un arreglo.
    const pasan = [
        '/administracion_general/edificio_general/audios/media_3516943371817505.ogg',
        '/media_2287456558705944.jpeg',
        '/facturas/media_1569071187682462.pdf',
        '/administracion_general/edificio_general/documentos/media_4066043230371421.pdf',
        '/imagenes/foto.jpg',
        '/gastos_expensas_informe.pdf',   // nombra "expensas" pero no empieza con expensa_
    ];
    for (const ruta of pasan) {
        vale(`pasa ${path.basename(ruta)}`, !esArchivoDeExpensa(ruta), `Ruta: ${ruta}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) El guardia contesta 403 y no se calla');
// ─────────────────────────────────────────────────────────────────────────────
{
    const correr = (ruta) => {
        let estado = null, cuerpo = null, siguio = false;
        const res = {
            status(c) { estado = c; return this; },
            json(j) { cuerpo = j; return this; },
        };
        const warn = console.warn; console.warn = () => {};
        try { guardiaExpensas({ path: ruta, ip: '1.2.3.4' }, res, () => { siguio = true; }); }
        finally { console.warn = warn; }
        return { estado, cuerpo, siguio };
    };

    const bloqueado = correr('/expensas/expensa_1758658800000.pdf');
    vale('una expensa recibe 403', bloqueado.estado === 403, `Dio: ${bloqueado.estado}`);
    vale('…y no sigue al static', bloqueado.siguio === false,
        'Si siguiera, el archivo se sirve igual y el guardia es decorativo.');
    vale('…y explica por dónde SÍ se entra',
        /portal|panel/i.test(JSON.stringify(bloqueado.cuerpo || {})),
        'Un 403 sin explicación manda a buscar el problema al lugar equivocado.');

    const libre = correr('/media_2287456558705944.jpeg');
    vale('una foto de reclamo sigue de largo', libre.siguio === true && libre.estado === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El orden en index.js, que es TODO el arreglo');
// ─────────────────────────────────────────────────────────────────────────────
{
    const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

    const guardia = src.indexOf("app.use('/archivos', guardiaExpensas)");
    const estatico = src.indexOf("app.use('/archivos', express.static");
    const guardiaAudios = src.indexOf("app.use('/audios', guardiaExpensas)");
    const estaticoAudios = src.indexOf("app.use('/audios', express.static");

    vale('el guardia de /archivos está montado', guardia > -1);
    vale('el guardia de /audios está montado', guardiaAudios > -1,
        '/audios sirve la MISMA carpeta: sin esto queda la segunda puerta abierta.');

    vale('el guardia de /archivos va ANTES del static',
        guardia > -1 && estatico > -1 && guardia < estatico,
        'Después, el archivo ya se sirvió y el guardia no corre nunca.');
    vale('el guardia de /audios va ANTES del static',
        guardiaAudios > -1 && estaticoAudios > -1 && guardiaAudios < estaticoAudios);

    // El buscador por nombre suelto es la tercera puerta, y va todavía más abajo.
    const buscador = src.indexOf('servirOConvertirMedia');
    vale('y antes del buscador por nombre suelto',
        buscador === -1 || guardia < buscador,
        'Ese recorre las subcarpetas de almacenamiento: encuentra la expensa sin la carpeta en el medio.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Quién puede ver cuál');
// ─────────────────────────────────────────────────────────────────────────────
{
    const general = { edificio: 'san patricio casa', departamento: '' };
    const del1A   = { edificio: 'san patricio casa', departamento: '1° A' };

    const dueno     = { rol: 'dueno' };
    const cliente   = { rol: 'consorcio', edificios: ['san patricio casa', 'Zeballos Cia'] };
    const otroCli   = { rol: 'consorcio', edificios: ['San patricio 270'] };
    const vecino1A  = { rol: 'vecino', edificio: 'san patricio casa', departamento: '1A' };
    const vecino4C  = { rol: 'vecino', edificio: 'san patricio casa', departamento: '4° C' };
    const deOtroEd  = { rol: 'vecino', edificio: 'San patricio 270', departamento: '1A' };
    const huesped   = { rol: 'vecino', edificio: 'san patricio casa', departamento: '1A', puede_ver_expensas: false };

    vale('el dueño ve la de cualquier unidad', puedeVerExpensa({ expensa: del1A, quien: dueno }).puede);
    vale('el cliente ve las de su edificio', puedeVerExpensa({ expensa: del1A, quien: cliente }).puede);
    vale('pero NO las de otro cliente', !puedeVerExpensa({ expensa: del1A, quien: otroCli }).puede);

    vale('el vecino ve la liquidación general', puedeVerExpensa({ expensa: general, quien: vecino4C }).puede,
        'Es la que explica en qué se gastó la plata del consorcio: la ven todos.');
    vale('el vecino ve la de SU unidad', puedeVerExpensa({ expensa: del1A, quien: vecino1A }).puede,
        '"1A" y "1° A" son la misma unidad escrita distinto.');

    // Lo que esto existe para impedir.
    vale('NO ve la de la unidad de al lado', !puedeVerExpensa({ expensa: del1A, quien: vecino4C }).puede);
    vale('NO ve la de otro edificio', !puedeVerExpensa({ expensa: del1A, quien: deOtroEd }).puede);
    vale('un huésped sin permiso no ve ninguna', !puedeVerExpensa({ expensa: general, quien: huesped }).puede);
    vale('sin sesión no se ve nada', !puedeVerExpensa({ expensa: general, quien: null }).puede);
    vale('sin expensa tampoco', !puedeVerExpensa({ expensa: null, quien: dueno }).puede);

    // La falta de dato no es un comodín.
    vale('vecino sin unidad cargada NO ve una expensa de unidad',
        !puedeVerExpensa({ expensa: del1A, quien: { rol: 'vecino', edificio: 'san patricio casa', departamento: '' } }).puede,
        'Que falte un dato es una ficha a medias, no una autorización.');
    vale('una expensa sin edificio no se le muestra a nadie',
        !puedeVerExpensa({ expensa: { edificio: '', departamento: '1A' }, quien: dueno }).puede);

    // Y el motivo tiene que decir algo: un 403 mudo manda a buscar al lugar equivocado.
    const r = puedeVerExpensa({ expensa: del1A, quien: vecino4C });
    vale('el rechazo explica por qué', /otra unidad/i.test(r.motivo), r.motivo);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) La ruta del archivo no se puede usar para salir de la carpeta');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('un nombre normal resuelve dentro de expensas/',
        String(rutaDelArchivo('/archivos/expensas/expensa_1.pdf')).includes(path.join('almacenamiento', 'expensas')));
    for (const malo of ['../../.env', '/expensas/../../../etc/passwd', '..', '']) {
        const r = rutaDelArchivo(malo);
        vale(`${JSON.stringify(malo)} no sale de la carpeta`,
            r === null || String(r).includes(path.join('almacenamiento', 'expensas')),
            `Dio: ${r}`);
    }
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Una expensa servida a cualquiera es la deuda de un vecino en una URL que se reenvía.\n');
    process.exit(1);
}
console.log('\n   🔒 Tres puertas, una regla, y el guardia antes de que el archivo salga.\n');
