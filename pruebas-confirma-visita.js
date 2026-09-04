// Verifica que Marcos distinga "me llamaron" de "voy a ir", y que reconozca la respuesta.
//
//   node pruebas-confirma-visita.js
//
// POR QUÉ. Avisar que lo convocaron NO es decir que va.
//
//   "Hola, me llamaron del edificio, hay una cámara que no funciona"
//
// Eso es un aviso a medias: el administrador tiene que enterarse igual, pero nadie sabe todavía
// si el técnico va a ir, ni cuándo, ni si necesita que le abran. Antes se daba por confirmado y se
// agendaba un control contra una promesa que nunca existió.
//
// Daniel: "si no digo que voy, que Marcos pregunte: ok gracias por avisarme, ¿vas a pasar?
// ¿cuándo? ¿necesitás algo que gestione? Así no espera que el tipo le diga -- que indague".
//
// Y la respuesta a esa pregunta casi nunca repite el verbo ni la dirección: "sí, mañana a las 10".
// Si eso no se reconoce, Marcos vuelve a preguntar a qué dirección va -- que es hacerle repetir lo
// que acaba de decir.
//
// Las condiciones se leen del propio index.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

function condicion(nombre) {
    const ini = SRC.indexOf(`const ${nombre} = `);
    if (ini === -1) throw new Error(`No encontré ${nombre} en index.js.`);
    // La condición termina en el primer `;` que cierra la sentencia (las de acá no llevan `;`
    // adentro porque son cadenas de `||` sobre expresiones regulares).
    const fin = SRC.indexOf(';\n', ini);
    const cuerpo = SRC.slice(ini, fin + 1);
    // eslint-disable-next-line no-new-func
    return new Function('txtLow', `${cuerpo}; return ${nombre};`);
}

const avisaQueVa = condicion('avisaQueVa');
const confirmaQueVa = condicion('confirmaQueVa');
const pareceRespuestaDeAgenda = condicion('pareceRespuestaDeAgenda');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${esperado}, dio ${real}`);
}

const low = (t) => t.toLowerCase();

console.log('\n── LO CONVOCARON, PERO NO DIJO QUE VA ──');
{
    // Estos abren caso (el administrador se entera) pero en estado `avisado`, y Marcos pregunta.
    const avisos = [
        // EL CASO REAL que lo destapó: "me ACABAN DE llamar". La condición vieja exigía el "me"
        // pegado al verbo, así que tres palabras en el medio alcanzaron para que la rama del aviso
        // no se activara. El mensaje cayó al camino genérico y Marcos contestó sobre otro caso.
        'hola, ¿qué tal? buenas noches. me acaban de llamar de san patricio 270, el encargado',
        // Y esta, que es la forma más común de todas: `llam\w*` se cortaba antes de la "ó" porque
        // en JavaScript `\w` no incluye vocales acentuadas.
        'llamó el encargado de san patricio 270 por el tablero',
        'recién me llamaron por un problema de agua',
        'acaban de llamarme del consorcio',
        'me están llamando del edificio',
        'llamaron del edificio por una cámara',
        'hola me llamaron del edificio que hay una camara que no funciona',
        'me llamó el encargado de San Patricio 270, hay una cámara apagada en el hall',
        'me avisaron del 159 que se cortó la luz del pasillo',
        'me pidieron que vaya a ver el portero eléctrico',
    ];
    for (const t of avisos) {
        verificar(`abre caso: "${t.slice(0, 45)}…"`, avisaQueVa(low(t)), true);
        verificar(`   …pero NO da la visita por confirmada`, confirmaQueVa(low(t)), false);
    }
}

console.log('\n── DIJO QUE VA ──');
{
    const confirmados = [
        'me llamaron del 159 y voy a pasar mañana',
        'voy mañana a las 10',
        'paso hoy a la tarde',
        'llego en 30 min',
        'ya salgo para allá',
        'estoy yendo',
    ];
    for (const t of confirmados) {
        verificar(`"${t}"`, confirmaQueVa(low(t)), true);
    }
}

console.log('\n── CÓMO SE CONTESTA "¿VAS A PASAR? ¿CUÁNDO?" ──');
{
    // Sin verbo, sin dirección: la acaba de decir. Esto no abre nada por sí solo -- solo sirve
    // para enganchar la respuesta con el caso que quedó esperando.
    const respuestas = [
        'si, mañana a las 10',
        'sí, mañana a la tarde',
        'dale, voy',
        'ok, paso el jueves',
        'a las 9 estoy ahí',
        'listo, en 2 horas salgo',
        'mañana temprano',
    ];
    for (const t of respuestas) {
        verificar(`"${t}"`, pareceRespuestaDeAgenda(low(t)), true);
    }
}

console.log('\n── LO QUE NO ES NI UNA COSA NI LA OTRA ──');
{
    // Ninguna de las tres condiciones puede quedarse con un mensaje que no le corresponde: si se
    // las queda, el mensaje no llega a ninguna otra rama y Marcos contesta cualquier cosa.
    const nada = [
        'te mando la factura del trabajo de la semana pasada',
        'necesito ver la cerradura de cerca',
        'cuánto salió el material?',
        'gracias, saludos',
    ];
    for (const t of nada) {
        verificar(`"${t}" no es un aviso`, avisaQueVa(low(t)), false);
        verificar(`   …ni una confirmación`, confirmaQueVa(low(t)), false);
        verificar(`   …ni una respuesta de agenda`, pareceRespuestaDeAgenda(low(t)), false);
    }
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
