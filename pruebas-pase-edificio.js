// Un pase QR de un edificio que no existe no abre ninguna puerta.
//
//   node pruebas-pase-edificio.js
//
// POR QUÉ. `revisar-edificios.js` encontró "Torre Norte Edifica" en `pases_qr`, y no es ningún
// edificio de `EDIFICIOS`. El relé compara con `mismoEdificio` --normalizado pero exacto, porque el
// 270 y el 159 de la misma calle son dos consorcios distintos-- así que ese nombre no matchea con
// nada. El pase se emite, el QR se genera, y la persona lo escanea en la puerta y no pasa nada.
//
// Nadie se entera: no hay error en ningún log. Desde afuera se ve como que "el QR no anda", que es
// lo peor que puede pasarle a un control de acceso — se deja de confiar en él.
//
// Los pases se crean desde TRES lados (el portal, la portería y el panel, por donde entra la
// EdificaApp), así que la validación va adentro de `crearPaseQR` y no en cada endpoint.

const fs = require('fs');
const path = require('path');

const DB = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}
const afirmar = (titulo, cond) => verificar(titulo, !!cond, true);

console.log('\n── SE VALIDA ANTES DE ESCRIBIR LA FILA ──');
{
    const ini = DB.indexOf('async function crearPaseQR(');
    afirmar('existe crearPaseQR', ini !== -1);
    const cuerpo = DB.slice(ini, DB.indexOf('async function listarPasesEdificio', ini));

    afirmar('pregunta si el edificio existe', cuerpo.includes('edificioExiste('));
    afirmar('y corta con un error si no', /throw new Error\(/.test(cuerpo));

    // El orden importa: validar después del INSERT deja la fila escrita igual.
    const posValidacion = cuerpo.indexOf('edificioExiste(');
    const posInsert = cuerpo.indexOf('INSERT INTO pases_qr');
    afirmar('la validación va ANTES del INSERT', posValidacion !== -1 && posValidacion < posInsert);

    // Un edificio vacío tampoco: quedaría un pase que no es de ningún edificio, y una apertura sin
    // edificio ya se la llevaba cualquier relé que sondeara también sin edificio.
    afirmar('un edificio vacío se rechaza', /!edificio \|\| !String\(edificio\)\.trim\(\)/.test(cuerpo));
}

console.log('\n── SE COMPARA COMO LO COMPARA EL RELÉ ──');
{
    const ini = DB.indexOf('async function edificioExiste(');
    afirmar('existe edificioExiste', ini !== -1);
    const cuerpo = DB.slice(ini, DB.indexOf('async function crearPaseQR(', ini));

    afirmar('usa mismoEdificio de edificio-clave', cuerpo.includes("require('./edificio-clave')")
                                               && cuerpo.includes('mismoEdificio('));
    // `compararEdificios` acepta coincidencias parciales a propósito, para leer un WhatsApp. Acá
    // eso avalaría un pase del 159 para el 270.
    afirmar('NO usa compararEdificios, que acepta parciales', !cuerpo.includes('compararEdificios'));
    // Las dos columnas del nombre son alias del mismo dato, y el panel lee una y el motor la otra.
    afirmar('mira las DOS columnas del nombre', /r\.edificio/.test(cuerpo) && /r\.nombre/.test(cuerpo));
    // Que no haya ningún edificio cargado no es una autorización: es una base vacía.
    afirmar('una lista vacía no deja pasar cualquier nombre', /\.some\(/.test(cuerpo));

    // Lo que tiene que seguir diciendo la comparación, con datos y no leyendo el código.
    const { mismoEdificio } = require('./edificio-clave');
    verificar('tolera la forma', mismoEdificio('San Patrício 270', 'san patricio 270'), true);
    verificar('el 270 no es el 159', mismoEdificio('San Patricio 270', 'San Patricio 159'), false);
    verificar('un nombre inventado no es ninguno', mismoEdificio('Torre Norte Edifica', 'San Patricio 270'), false);
    verificar('sin dato no se afirma nada', mismoEdificio('', 'San Patricio 270'), false);
}

console.log('\n── NADIE ESCRIBE UN PASE SIN PASAR POR AHÍ ──');
{
    // CANDADO. La validación adentro de `crearPaseQR` solo sirve mientras sea el único camino.
    // Un `INSERT INTO pases_qr` escrito en otro archivo la esquiva entera, y el síntoma vuelve a
    // ser un QR que no abre y ningún error.
    const archivos = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !f.startsWith('pruebas-'));
    const culpables = [];
    for (const f of archivos) {
        if (f === 'db-pg.js') continue;
        const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
        if (/INSERT\s+INTO\s+pases_qr/i.test(src)) culpables.push(f);
    }
    verificar('ningún archivo fuera de db-pg.js inserta en pases_qr', culpables, []);

    // Y adentro de db-pg.js, el único INSERT es el de `crearPaseQR`.
    const inserts = (DB.match(/INSERT\s+INTO\s+pases_qr/gi) || []).length;
    verificar('en db-pg.js hay un solo INSERT a pases_qr', inserts, 1);
}

console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
