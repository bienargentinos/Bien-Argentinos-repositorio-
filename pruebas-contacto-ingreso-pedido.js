/**
 * "¿QUIÉN ME ABRE?" TIENE QUE TENER UN CAMINO
 *
 * > [!CAUTION]
 * > **Una intención que no está en el catálogo no tiene camino, y el mensaje cae en la rama de al
 * > lado.** El modelo no puede devolver algo que no le ofrecimos: elige lo más parecido de la
 * > lista, y lo más parecido casi nunca es lo correcto.
 *
 * EL CASO REAL. El técnico preguntó quién le abría y Marcos le contestó que iba a pedirle una foto
 * al vecino. Dos veces en la misma prueba. No fue el modelo equivocándose: no existía
 * `pide_contacto_de_ingreso`, así que clasificó `pide_datos_al_vecino` --la más parecida de las
 * diez-- y esa rama manda a pedir una foto.
 *
 * Es el mismo defecto de fondo que ya está documentado tres veces en CLAUDE.md, en otras formas:
 *
 * - `buscarCasoPorCodigo` pedida a un archivo que no la exportaba: `undefined`, adentro de un
 *   `catch`, y el arreglo nunca corrió ni una vez.
 * - `enviarEncuestaServicio`, que no existe en ningún archivo y se llamaba desde tres lugares con
 *   el `catch` vacío: la encuesta al vecino no se mandó nunca.
 * - `llego_y_no_le_abren`, que **estaba en el catálogo desde el principio y nadie la leía** —
 *   declarada y sin consumidor, que desde afuera se ve exactamente igual que no existir.
 *
 * Los cuatro se ven igual desde afuera: Marcos contestando otra cosa, sin una línea de error.
 *
 *     node pruebas-contacto-ingreso-pedido.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { INTENCIONES, seActiva } = require('./ruteo-proveedor');

let ok = 0;
let fallos = 0;

function vale(titulo, condicion, detalle) {
    if (condicion) {
        ok++;
        console.log(`   ✅ ${titulo}`);
    } else {
        fallos++;
        console.log(`   ❌ ${titulo}`);
        if (detalle) console.log(`      ${detalle}`);
    }
}

const ia = (intencion, confianza = 0.9) => ({ intencion, confianza, motivo: 'prueba' });

console.log('\n🔑 "¿QUIÉN ME ABRE?" TIENE QUE TENER UN CAMINO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) La intención existe en el catálogo');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('`pide_contacto_de_ingreso` está en INTENCIONES',
        Object.prototype.hasOwnProperty.call(INTENCIONES, 'pide_contacto_de_ingreso'),
        'Sin esto el modelo no la puede devolver, por bien que entienda el mensaje.');

    vale('su descripción nombra al encargado y el "quién me abre"',
        /qui[eé]n le (va a )?abr|encargado/i.test(INTENCIONES.pide_contacto_de_ingreso || ''));

    vale('`pide_datos_al_vecino` aclara que esto NO es lo suyo',
        /pide_contacto_de_ingreso/.test(INTENCIONES.pide_datos_al_vecino || ''),
        'Es la rama que se lo venía comiendo: hay que desambiguarlas en el propio catálogo.');

    vale('`llego_y_no_le_abren` sigue existiendo y se distingue de la anterior',
        /ya lleg|en la puerta/i.test(INTENCIONES.llego_y_no_le_abren || ''),
        'Preguntar antes de salir y estar parado en la puerta son dos momentos distintos.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) El ruteo activa la rama correcta');
// ─────────────────────────────────────────────────────────────────────────────
{
    // La rama nueva no tiene condición de texto: nace ruteada por el modelo. Por eso el segundo
    // argumento de `seActiva` es siempre false y lo único que decide es lo que dijo la IA.
    vale('con `pide_contacto_de_ingreso`, se activa',
        seActiva('pide_contacto_de_ingreso', false, ia('pide_contacto_de_ingreso'), '¿quién me abre?') === true);

    vale('con `llego_y_no_le_abren`, también',
        seActiva('llego_y_no_le_abren', false, ia('llego_y_no_le_abren'), 'estoy en la puerta y no sale nadie') === true);

    vale('con `pide_datos_al_vecino`, NO se activa la de ingreso',
        seActiva('pide_contacto_de_ingreso', false, ia('pide_datos_al_vecino'), 'pedile una foto') === false);

    vale('y la de datos ya no se activa cuando la IA dice que pide el ingreso',
        seActiva('pide_datos_al_vecino', false, ia('pide_contacto_de_ingreso'), '¿quién me abre?') === false,
        'Este es el bug exacto: antes esa frase caía en la rama de la foto.');

    // El respaldo por texto de la rama de datos NO puede seguir reclamando la frase cuando la IA
    // ya dijo otra cosa. `seActiva` le da la última palabra al modelo, y acá se verifica.
    vale('aunque el texto de la rama de datos dijera SÍ, gana la IA',
        seActiva('pide_datos_al_vecino', true, ia('pide_contacto_de_ingreso'), 'necesito ver quién me abre') === false);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) El envío existe, es UNO solo, y lo usan los dos caminos');
// ─────────────────────────────────────────────────────────────────────────────
{
    const fuente = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

    vale('existe `entregarContactoDeIngreso`',
        /async function entregarContactoDeIngreso\s*\(/.test(fuente));

    vale('acepta `forzar`',
        /entregarContactoDeIngreso\s*\(\{[^)]*forzar\s*=\s*false/s.test(fuente),
        'Sin esto, la marca de "ya se lo mandamos" calla la respuesta a una pregunta de ahora.');

    const llamadas = (fuente.match(/await entregarContactoDeIngreso\(/g) || []).length;
    vale('la llaman los DOS caminos (el automático y el pedido)', llamadas === 2,
        `Se encontraron ${llamadas}. El envío tiene que estar escrito una sola vez: copiarlo es ` +
        'lo que pasó con `buscarPerfilEdificio`, donde arreglar una copia no cambió producción.');

    vale('el camino del pedido pasa `forzar: true`',
        /forzar:\s*true/.test(fuente),
        'Lo está preguntando AHORA: que se lo hayamos mandado hace tres días no contesta nada.');

    vale('cuando no hay contacto y lo pidió, igual se le contesta algo',
        /} else if \(forzar\) \{/.test(fuente),
        'Quedarse callado es lo peor: está por salir o ya está parado en la puerta.');

    vale('sin caso activo se le pregunta el edificio en vez de adivinar',
        /qu[eé] edificio est[aá]s yendo/i.test(fuente),
        'Mandarle el contacto del edificio equivocado lo deja parado en otra puerta.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) CANDADO: ninguna intención del catálogo puede quedar sin camino');
// ─────────────────────────────────────────────────────────────────────────────
{
    const fuente = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

    // Esto es lo que habría agarrado el bug de entrada, y también el de `llego_y_no_le_abren`,
    // que estuvo declarada y muerta desde el primer día.
    //
    // Hay TRES formas legítimas de leer una intención, y el candado tiene que conocer las tres o
    // produce falsos positivos --que son peores que no tener candado, porque enseñan a ignorarlo--:
    //
    //   1. `seActiva('x', porTexto, ruteoIA, texto)`   — con respaldo por texto
    //   2. `ruteoIA.intencion === 'x'`                 — sin respaldo, ruteada y punto
    //   3. `ruteoIA?.entraSolo`                        — `entra_solo` viaja como bandera aparte,
    //      porque "tengo llave y voy en 2 horas" dice dos cosas a la vez (está en el SYSTEM).
    //
    // `otro` queda afuera a propósito: significa "no activar ningún ramal", y su camino es
    // justamente que Marcos lea el mensaje y conteste libre.
    const leida = (n) =>
        new RegExp(`seActiva\\(\\s*['"]${n}['"]`).test(fuente)
        || new RegExp(`intencion\\s*===\\s*['"]${n}['"]`).test(fuente)
        || (n === 'entra_solo' && /ruteoIA\?\.entraSolo/.test(fuente));

    const sinCamino = Object.keys(INTENCIONES).filter(n => n !== 'otro').filter(n => !leida(n));

    // > [!CAUTION]
    // > **`informa_resuelto` no la lee nadie: cerrar un caso lo sigue decidiendo una expresión de
    // > texto** (`diceQueSeResolvio`, `index.js:2081`). Es exactamente el patrón que el ruteo vino
    // > a reemplazar, y en la rama más cara de todas: un cierre equivocado le muestra al
    // > administrador un trabajo terminado que nadie hizo.
    // >
    // > Queda ACÁ, nombrado y visible, y no en una lista de excepciones escrita a mano: esas ya
    // > fallaron dos veces en este proyecto --la del `node --check` del verificador y la de
    // > "¿falta alguna función?"--, porque solo revisan lo que alguien se acordó de anotar.
    // > Cablearlo es un cambio de comportamiento con su propia prueba, no un renglón de este
    // > commit. Decisión pendiente de Daniel.
    const PENDIENTE_CONOCIDO = ['informa_resuelto'];
    const nuevasSinCamino = sinCamino.filter(n => !PENDIENTE_CONOCIDO.includes(n));

    for (const n of sinCamino.filter(n => PENDIENTE_CONOCIDO.includes(n))) {
        console.log(`   ⚠️  ${n} sigue sin camino propio — pendiente conocido, ver el comentario acá arriba.`);
    }

    vale('ninguna intención NUEVA queda declarada y sin quien la lea',
        nuevasSinCamino.length === 0,
        nuevasSinCamino.length
            ? `Declaradas y sin consumidor: ${nuevasSinCamino.join(', ')}. ` +
              'Una intención sin camino no es inocente: el modelo la devuelve, no la lee nadie, ' +
              'y el mensaje termina en la rama de al lado contestando otra cosa.'
            : '');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Un técnico preguntando quién le abre está por salir, o ya está en la puerta.\n');
    process.exit(1);
}
console.log('\n   🔑 La pregunta de quién le abre tiene su propio camino.\n');
