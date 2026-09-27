/**
 * NO SE LE REENVÍA EL TRABAJO A QUIEN ACABA DE DECIR QUE LO TERMINÓ
 *
 * > [!CAUTION]
 * > **`entregarPendientesAlTecnico` corre en CADA mensaje entrante del proveedor**, porque ese es
 * > el instante en que Meta abre la ventana de 24hs. Corre antes de leer lo que dice el mensaje.
 *
 * Producción, 26/09, del WhatsApp del técnico:
 *
 *     23:55  Dario:   "Hola ya termine"
 *     23:56  MARCOS:  📷 FOTO DEL RECLAMO [CASO-1005]
 *     23:56  MARCOS:  ¿QUIÉN LE ABRE AL TÉCNICO EN SAN PATRICIO 159?
 *     23:56  MARCOS:  "Va a ir Dario por el CASO-1005 y no tengo cargado quién le abre…"
 *     23:56  MARCOS:  ✅ Listo Dario, marqué el CASO-1005 como RESUELTO
 *     23:58  Dario:   "Ya finalice"
 *
 * El cierre estuvo bien y salió **último**, detrás de tres mensajes que le mandaban el trabajo de
 * nuevo. Él leyó que Marcos no lo había entendido y lo repitió. Y el segundo "Ya finalice" llegó
 * con el CASO-1005 ya cerrado, así que Marcos le preguntó cuál de los **otros dos** había
 * terminado --empujándolo a cerrar el CASO-1004, que no había tocado--.
 *
 * Dos defectos encadenados, los dos del mismo fondo: **la información estaba, el orden no.**
 *
 *     node pruebas-aviso-terminado.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pareceAvisoDeTerminado, avisaQueTermino, niegaQueTermino } = require('./aviso-terminado');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n📎 NO SE LE REENVÍA EL TRABAJO A QUIEN DIJO QUE TERMINÓ\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Lo que dijo esa noche');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('"Hola ya termine" suprime la entrega', avisaQueTermino('Hola ya termine'));
    vale('"Ya finalice" también', avisaQueTermino('Ya finalice'));
    vale('y "ya lo resolví"', avisaQueTermino('ya lo resolví'));
    vale('"listo, quedó andando"', avisaQueTermino('listo, quedó andando'));

    // Terminó el trabajo aunque la factura venga después: el trabajo es lo que decide la entrega.
    vale('"terminé, mañana te mando la factura" también suprime',
        avisaQueTermino('terminé, mañana te mando la factura'),
        'Lo pendiente es la foto del problema, no la factura.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Y lo que NO puede suprimirla, que es lo que importa');
// ─────────────────────────────────────────────────────────────────────────────
{
    // > [!CAUTION]
    // > **La negación trae LAS MISMAS PALABRAS.** Y es justo el mensaje de alguien que sí necesita
    // > la foto y el contacto de ingreso.
    //
    // Suprimir acá no cuesta una vuelta: `pendientesResueltosDe` no se marca, pero si los mensajes
    // siguientes también lo niegan, no se le entrega NUNCA — que es el problema que la entrega de
    // pendientes vino a resolver.
    vale('"todavía no terminé" NO suprime', !avisaQueTermino('todavia no termine'));
    vale('"aún no lo arreglé" tampoco', !avisaQueTermino('aún no lo arreglé'));
    vale('"no se resolvió" tampoco', !avisaQueTermino('no se resolvió'));
    vale('y la negación se detecta sola', niegaQueTermino('todavia no termine') && !niegaQueTermino('ya termine'));

    // El mensaje textual del técnico en la prueba del 9/9, que es POR QUÉ existe esta entrega.
    vale('pedir la foto no suprime la foto',
        !avisaQueTermino('puedo ir en 2 hs pero necesito foto y también un teléfono de quien me recibe'));
    vale('confirmar la visita tampoco', !avisaQueTermino('Llegaré en 2 hs para revisar el problema. Quien me abre?'));
    vale('ni un "Ok" pelado', !avisaQueTermino('Ok'));
    vale('ni un mensaje vacío', !avisaQueTermino('') && !avisaQueTermino(null));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) El filtro amplio se queda amplio');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Son dos preguntas distintas y hay que no confundirlas. El filtro de arriba decide si vale la
    // pena pagarle una clasificación al modelo: un negado de más ahí no hace daño --el modelo lo
    // lee y dice que no-- y hacerlo estricto devuelve el problema de la lista de palabras
    // decidiendo.
    vale('"todavía no terminé" SÍ pasa el filtro que llama al modelo',
        pareceAvisoDeTerminado('todavia no termine'),
        'Si esto se hace estricto, vuelve a decidir la lista de palabras en vez del modelo.');
    vale('y el amplio y el de supresión no son el mismo',
        pareceAvisoDeTerminado('no se resolvió') && !avisaQueTermino('no se resolvió'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) index.js: la pregunta se hace ANTES del envío');
// ─────────────────────────────────────────────────────────────────────────────
{
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const soloCod = cod.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    // El candado central. Se mide la PROPIEDAD --que la pregunta esté hecha antes de llamar a la
    // entrega-- y no la forma exacta, que va a cambiar.
    const iPregunta = soloCod.indexOf('avisaQueTermino(textoFinal)');
    const iEnvio = soloCod.indexOf('await entregarPendientesAlTecnico(');
    vale('se pregunta si ya terminó, sobre ESTE mensaje', iPregunta !== -1);
    vale('y se pregunta ANTES de entregar', iPregunta !== -1 && iEnvio !== -1 && iPregunta < iEnvio,
        `pregunta en ${iPregunta}, envío en ${iEnvio}. Es el mismo defecto que \`tieneAccesoPropio\`, ` +
        'que se consultaba dos mil líneas después del envío que tenía que evitar.');

    const bloque = soloCod.slice(iPregunta, iEnvio);
    vale('y la respuesta gobierna el envío', /diceQueYaTermino/.test(bloque),
        'Preguntar y no usar la respuesta es peor que no preguntar.');

    // Que quede dicho en el log: una supresión muda es indistinguible de un envío que falló.
    vale('la supresión queda en el log', /📎⏸️/.test(cod));

    // ── LA SEGUNDA GUARDA: un caso cerrado no tiene nada pendiente ────────────────────
    const fn = (soloCod.match(/async function entregarPendientesAlTecnico[\s\S]*?\n\}/) || [''])[0];
    vale('la entrega comprueba que el caso siga abierto', /\.cerrado/.test(fn),
        'Cualquier mensaje suyo posterior al cierre volvía a dispararla.');
    vale('y si no se puede leer el caso, entrega igual',
        /catch[\s\S]{0,200}?se entrega igual/i.test(cod),
        'Perder la foto deja al técnico yendo sin saber qué va a encontrar: ese es el error caro.');

    // ── EL CANDADO CONTRA LA SEGUNDA COPIA ────────────────────────────────────────────
    //
    // La expresión estaba escrita en index.js y la necesitan dos lugares a dos mil líneas de
    // distancia. Dos copias es exactamente lo que pasó con `buscarPerfilEdificio`.
    vale('la lista de palabras vive solo en `aviso-terminado.js`',
        !/termin\|finaliz\|finalic\|resolv/.test(soloCod),
        'En index.js sería la segunda copia, y arreglar una no cambiaría la otra.');
    vale('y la negación tampoco se reescribe',
        !/\\bno\\s\+\(se\\s\+/.test(soloCod) && /niegaQueTermino\(textoFinal\)/.test(soloCod));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Reenviarle el trabajo a quien avisó que terminó lo hace repetirse, y ahí empieza todo.\n');
    process.exit(1);
}
console.log('\n   📎 Avisa que terminó y no se le manda el trabajo de nuevo.\n');
