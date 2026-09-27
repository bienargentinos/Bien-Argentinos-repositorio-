/**
 * DE CUÁL DE SUS EDIFICIOS HABLA EL VECINO
 *
 * Planteado por Daniel, 27/09:
 *
 * > *"el vecino tiene un número pero puede tener vivienda y oficina en distintos lados y el
 * > reclamo de un edificio no es del otro. Acá debe analizar contexto, historial de conversación,
 * > para comprender qué se está diciendo en el último mensaje. Somos humanos y no tiramos palabras
 * > al azar: solo tratamos de seguir el hilo de conversación o abrimos otros. Es posible que
 * > retomemos un hilo anterior, pero se aclara en el mismo texto."*
 *
 * El bug: el edificio de la sesión se fijaba en el primer mensaje y quedaba **seis horas**
 * (`TIEMPO_CADUCIDAD_MS`), porque todo el bloque que lo decide vive adentro de
 * `if (!session.edificioId)`. El reclamo de la oficina caía en el edificio de la casa.
 *
 * ## Qué se prueba acá y qué no
 *
 * Esto **NO llama a Gemini**. Una prueba que depende de una API externa no se puede correr antes de
 * cada push: tarda, cuesta, y falla por motivos que no tienen que ver con el código. Se prueba el
 * **mecanismo**, que es lo único que puede romper el sistema entero: que un `null` no cambie nada,
 * que un edificio ajeno no se cuele, y que el orden en `index.js` sea el correcto.
 *
 * Qué tan bien lee el hilo el modelo se mide en producción, con los `🧵` del log.
 *
 *     node pruebas-hilo-del-vecino.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { edificioDelHilo } = require('./hilo-del-vecino');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

const CASA    = 'san patricio casa';
const OFICINA = 'Rivadavia 4';
const LOS_DOS = [CASA, OFICINA];

/** Un modelo de mentira que contesta lo que se le diga. */
const modelo = (obj) => async () => JSON.stringify(obj);

async function correr() {

console.log('\n🧵 DE CUÁL DE SUS EDIFICIOS HABLA EL VECINO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) El caso de Daniel: la casa y la oficina');
// ─────────────────────────────────────────────────────────────────────────────
{
    const r = await edificioDelHilo({
        texto: 'acá en la oficina se cortó la luz',
        edificios: LOS_DOS,
        historial: ['Vecino: hay agua en el palier', 'Marcos: ya aviso al plomero'],
        edificioActual: CASA,
        pedirAlModelo: modelo({ edificio: OFICINA, esOtroHilo: true, confianza: 0.9, motivo: 'dijo oficina' }),
    });

    vale('puede cambiar de edificio sin que el mensaje lo nombre', r?.edificio === OFICINA,
        `Devolvió: ${r?.edificio}. "acá en la oficina" no nombra ningún edificio y una persona lo entiende.`);
    vale('y avisa que abre otro asunto', r?.esOtroHilo === true);

    // Lo normal: el mensaje sigue el hilo abierto.
    const sigue = await edificioDelHilo({
        texto: '¿ya viene el técnico?',
        edificios: LOS_DOS,
        edificioActual: CASA,
        pedirAlModelo: modelo({ edificio: CASA, esOtroHilo: false, confianza: 0.95, motivo: 'sigue el reclamo' }),
    });
    vale('seguir el hilo no lo marca como otro asunto', sigue?.edificio === CASA && sigue.esOtroHilo === false);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Lo que NO puede pasar');
// ─────────────────────────────────────────────────────────────────────────────
{
    // > [!CAUTION]
    // > **Un edificio que no es de este vecino mandaría el reclamo a un consorcio donde no figura.**
    const ajeno = await edificioDelHilo({
        texto: 'se rompió el portero',
        edificios: LOS_DOS,
        edificioActual: CASA,
        pedirAlModelo: modelo({ edificio: 'San Patricio 270', esOtroHilo: true, confianza: 1, motivo: 'inventado' }),
    });
    vale('un edificio que no es suyo se ignora entero', ajeno === null,
        `Devolvió: ${JSON.stringify(ajeno)}`);

    // Sin pista, vacío: que Marcos pregunte es una respuesta correcta.
    const sinIdea = await edificioDelHilo({
        texto: 'hola',
        edificios: LOS_DOS,
        pedirAlModelo: modelo({ edificio: '', esOtroHilo: false, confianza: 0.2, motivo: 'no dice nada' }),
    });
    vale('sin pista devuelve vacío y no inventa', sinIdea?.edificio === '');

    // El modelo caído, el timeout y una respuesta ilegible son lo mismo: seguí con lo que tenías.
    const roto = await edificioDelHilo({
        texto: 'se cortó la luz', edificios: LOS_DOS, edificioActual: CASA,
        pedirAlModelo: async () => { throw new Error('Gemini caído'); },
    });
    vale('con el modelo caído devuelve null, no un edificio', roto === null);

    const basura = await edificioDelHilo({
        texto: 'se cortó la luz', edificios: LOS_DOS, edificioActual: CASA,
        pedirAlModelo: async () => 'perdón, no entendí',
    });
    vale('una respuesta que no es JSON tampoco rompe', basura === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Cuándo NO se le pregunta al modelo');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Pagar una llamada por cada vecino para resolver el caso de unos pocos es latencia para todos.
    let llamadas = 0;
    const contando = async () => { llamadas++; return JSON.stringify({ edificio: CASA }); };

    await edificioDelHilo({ texto: 'se cortó la luz', edificios: [CASA], pedirAlModelo: contando });
    vale('con UN solo edificio no se consulta nada', llamadas === 0);

    await edificioDelHilo({ texto: '', edificios: LOS_DOS, pedirAlModelo: contando });
    vale('con el mensaje vacío tampoco', llamadas === 0);

    await edificioDelHilo({ texto: 'hola', edificios: [], pedirAlModelo: contando });
    vale('sin edificios tampoco', llamadas === 0);

    // El interruptor del .env, igual que RUTEO_IA y LECTURA_PG.
    const src = fs.readFileSync(path.join(__dirname, 'hilo-del-vecino.js'), 'utf8');
    vale('se puede apagar desde el .env con HILO_IA=off', /process\.env\.HILO_IA/.test(src));
    vale('y usa la MISMA espera que el ruteo del proveedor',
        /require\('\.\/ruteo-proveedor'\)/.test(src) && /conTimeout/.test(src),
        'Dos criterios distintos de cuánto esperar al modelo es una decisión duplicada.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) index.js: el orden, que es lo que importa');
// ─────────────────────────────────────────────────────────────────────────────
{
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const soloCod = cod.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    vale('index.js consulta el hilo', /edificioDelHilo\(/.test(soloCod));

    // Lo determinista manda: si el mensaje NOMBRA el edificio, no se le pregunta al modelo. Es el
    // mismo orden que ya impuso `ruteo-proveedor.js` del otro lado.
    vale('solo se pregunta si el mensaje NO nombra un edificio',
        /!edificioMencionadoEnMensaje[\s\S]{0,200}?edificioDelHilo\(/.test(soloCod),
        'Con el edificio nombrado no hay nada que interpretar.');

    vale('y solo si el vecino figura en más de un edificio',
        /vecinosEnSheets\.length > 1[\s\S]{0,400}?edificioDelHilo\(/.test(soloCod),
        'Con uno solo no hay nada que decidir y sería latencia para todos.');

    // El candado central: la decisión NO puede seguir encerrada en "solo si todavía no hay
    // edificio", que es exactamente lo que la congelaba seis horas.
    const iHilo = soloCod.indexOf('edificioDelHilo(');
    const iFallback = soloCod.indexOf("if (!session.edificioId && datosEmisor.rol === 'vecino')");
    vale('la relectura del hilo corre ANTES del bloque `if (!session.edificioId)`',
        iHilo !== -1 && iFallback !== -1 && iHilo < iFallback,
        `hilo en ${iHilo}, fallback en ${iFallback}. Adentro de ese if, el edificio queda fijo 6 horas.`);

    vale('y puede cambiar el edificio de la sesión, no solo ponerlo la primera vez',
        /hilo\?\.edificio && hilo\.edificio !== session\.edificioId/.test(soloCod));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  El reclamo de la oficina no es el de la casa, y son dos consorcios distintos.\n');
    process.exit(1);
}
console.log('\n   🧵 El hilo se relee en cada mensaje, y ante la duda no se cambia de edificio.\n');

}

correr().catch(err => { console.error(`\n❌ La prueba se rompió: ${err.stack}\n`); process.exit(1); });
