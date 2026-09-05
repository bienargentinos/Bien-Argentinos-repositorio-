// Verifica que el ruteo por IA reemplace a las condiciones de texto sin poder dejar a nadie
// sin respuesta.
//
//   node pruebas-ruteo-proveedor.js
//
// POR QUÉ. Hasta acá, quién atendía cada mensaje del técnico lo decidía una cadena de condiciones
// por coincidencia de texto, y el modelo era el ÚLTIMO de la fila. La primera que matcheaba
// cortaba, así que el mensaje nunca llegaba a que alguien lo entendiera.
//
// El caso que agotó la paciencia, textual del chat:
//
//     Daniel: "La foto también es del caso"
//     Marcos: "ya mismo me contacto con el vecino para pedirle la foto…"
//     Daniel: "No... te acabo de mandar una foto, NO TE ESTOY PIDIENDO FOTOS DE NADA"
//     Marcos: "ya mismo me contacto con el vecino para pedirle la foto…"
//
// La condición buscaba la palabra `foto`. Las dos frases la contienen.
//
// ── QUÉ SE PRUEBA ACÁ Y QUÉ NO ──────────────────────────────────────────────────────────────
//
// Esto NO llama a Gemini. Una prueba que dependa de una API externa no se puede correr antes de
// cada `git push`: tarda, cuesta, y falla por motivos que no tienen nada que ver con el código.
//
// Lo que sí se prueba es lo único que puede romper el sistema entero: **el mecanismo**. Que un
// `null` --ruteo apagado, modelo caído, timeout-- devuelva exactamente lo que decía el texto, que
// una intención desconocida no se cuele, y que cuando los dos opinan distinto gane la IA y quede
// escrito en el log.
//
// Qué tan bien clasifica el modelo se mide en producción, con los `🧭` del log.

const { seActiva, INTENCIONES } = require('./ruteo-proveedor');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// El log se silencia para que la salida de la prueba se lea; algunas verificaciones lo revisan.
const logOriginal = console.log;
function capturando(fn) {
    const lineas = [];
    console.log = (...a) => lineas.push(a.join(' '));
    try { fn(); } finally { console.log = logOriginal; }
    return lineas.join('\n');
}

const ia = (intencion, confianza = 0.9) => ({ intencion, confianza, motivo: 'prueba' });

console.log('\n── SIN RUTEO, TODO QUEDA COMO ESTABA ──');
{
    // Este es el contrato más importante del módulo. `RUTEO_IA=off` en el .env, Gemini caído, la
    // clave vencida, un timeout: en todos esos casos llega `null`, y Marcos tiene que comportarse
    // EXACTAMENTE como antes. Si esto falla, apagar el ruteo deja de ser una salida de emergencia.
    verificar('null + texto SÍ → SÍ', seActiva('consulta_pago', true, null), true);
    verificar('null + texto no → no', seActiva('consulta_pago', false, null), false);
}

console.log('\n── CON RUTEO, DECIDE LA IA ──');
{
    verificar('la IA dice que es esta intención', seActiva('consulta_pago', false, ia('consulta_pago')), true);
    verificar('la IA dice que es otra', seActiva('consulta_pago', true, ia('otro')), false);
    verificar('coinciden en que sí', seActiva('consulta_pago', true, ia('consulta_pago')), true);
    verificar('coinciden en que no', seActiva('consulta_pago', false, ia('otro')), false);
}

console.log('\n── EL BUCLE DE LAS FOTOS ──');
{
    // Las dos frases reales. El texto decía "es un pedido de fotos" en las dos; la IA lee que en
    // una está aportando y en la otra corrigiendo. Ninguna es un pedido.
    verificar('"la foto también es del caso" ya no pide fotos',
        seActiva('pide_datos_al_vecino', true, ia('otro'), 'la foto también es del caso'), false);
    verificar('"no te estoy pidiendo fotos de nada" tampoco',
        seActiva('pide_datos_al_vecino', true, ia('corrige_a_marcos'), 'no te estoy pidiendo fotos de nada'), false);

    // Y un pedido de verdad sigue entrando aunque el texto no lo hubiera visto.
    verificar('un pedido de verdad sí entra',
        seActiva('pide_datos_al_vecino', false, ia('pide_datos_al_vecino'), 'preguntale qué marca es'), true);
}

console.log('\n── LOS DESACUERDOS QUEDAN ESCRITOS ──');
{
    // Sin esto, la única forma de saber si el ruteo nuevo es mejor que el viejo sería esperar a
    // que un técnico se queje. El log de desacuerdos es la evidencia.
    const salida = capturando(() =>
        seActiva('pide_datos_al_vecino', true, ia('corrige_a_marcos'), 'no te estoy pidiendo fotos de nada'));

    verificar('el desacuerdo se loguea', /🧭/.test(salida), true);
    verificar('dice la frase que lo causó', /no te estoy pidiendo fotos/.test(salida), true);
    verificar('dice qué decía el texto', /el texto decía SÍ/.test(salida), true);
    verificar('y qué leyó la IA', /corrige_a_marcos/.test(salida), true);

    // Cuando coinciden no se escribe nada: un log que grita en cada mensaje no lo lee nadie.
    const silencio = capturando(() => seActiva('consulta_pago', true, ia('consulta_pago'), 'me pagaron?'));
    verificar('cuando coinciden, no ensucia el log', silencio.trim(), '');
}

console.log('\n── UNA INTENCIÓN QUE NO EXISTE NO PUEDE ACTIVAR NADA ──');
{
    // Si el modelo devuelve cualquier cosa, ningún ramal la reconoce. Lo importante es que eso
    // apague todos los ramales y el mensaje caiga al camino libre --donde Marcos lo lee y
    // contesta-- en vez de activar uno al azar.
    for (const rama of ['consulta_pago', 'pide_datos_al_vecino', 'confirma_que_va']) {
        verificar(`"${rama}" no se activa con una intención inventada`,
            seActiva(rama, true, ia('cualquier_cosa_inventada')), false);
    }
}

console.log('\n── EL CATÁLOGO DE INTENCIONES ──');
{
    // Cada ramal de index.js pregunta por un nombre exacto. Si alguien renombra una intención acá
    // y no allá, ese ramal deja de activarse PARA SIEMPRE y en silencio: no hay error, no hay log,
    // simplemente nunca es true. Esta prueba es el candado.
    const usadas = [
        'consulta_pago', 'responde_de_que_obra', 'avisa_que_lo_convocaron',
        'confirma_que_va', 'entra_solo', 'pide_datos_al_vecino', 'otro',
    ];
    for (const n of usadas) {
        verificar(`"${n}" existe en el catálogo`, Object.keys(INTENCIONES).includes(n), true);
    }

    // Y que index.js no pida ninguna que no exista.
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const pedidas = new Set();
    for (const m of SRC.matchAll(/seActiva\(\s*'([a-z_]+)'/g)) pedidas.add(m[1]);
    for (const m of SRC.matchAll(/ruteoIA\??\.intencion\s*===\s*'([a-z_]+)'/g)) pedidas.add(m[1]);

    verificar('index.js pide al menos una intención', pedidas.size > 0, true);
    for (const p of pedidas) {
        verificar(`index.js pide "${p}", que existe`, Object.keys(INTENCIONES).includes(p), true);
    }
}

console.log('\n── SE PUEDE APAGAR SIN TOCAR CÓDIGO ──');
{
    // La salida de emergencia tiene que estar documentada donde alguien la va a buscar a las 3 AM.
    const fs = require('fs');
    const path = require('path');
    const ejemplo = fs.readFileSync(path.join(__dirname, '.env.ejemplo'), 'utf8');
    verificar('RUTEO_IA está en .env.ejemplo', /RUTEO_IA/.test(ejemplo), true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
