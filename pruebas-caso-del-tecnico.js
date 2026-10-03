/**
 * "YA LO RESOLVÍ" TIENE QUE CERRAR **SU** CASO
 *
 * > [!CAUTION]
 * > **El cierre de un caso buscaba el caso por el EDIFICIO DEL VECINO.** Un proveedor no tiene
 * > ninguna de esas tres fuentes, así que el edificio quedaba vacío — y con el edificio vacío,
 * > `obtenerCasosAbiertosEdificio` devuelve TODOS los casos abiertos del sistema.
 *
 * Producción, 21/09/2026. Dario mandó la factura del CASO-1004 con el texto *"Ya resolvi"*. Eso no
 * cerró nada, **y está bien**: hay una regla explícita de que un comprobante adjunto manda sobre el
 * texto que lo acompaña, puesta por un caso real de Daniel --resuelve algo en el edificio de al
 * lado y manda la factura, que no es del caso abierto--.
 *
 * Lo que falló fue el mensaje siguiente, sin adjunto:
 *
 *     Dario:  "Pero ya lo resolví que querés? Ya te dije q resolvi"
 *     Marcos: (la lista de TODOS los reclamos abiertos de TODOS los edificios)
 *
 * El CASO-1004 siguió abierto, el seguimiento siguió corriendo, y al vecino se le preguntó si el
 * técnico había pasado por un trabajo que ya estaba hecho.
 *
 *     node pruebas-caso-del-tecnico.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { casoActivoDelTecnico } = require('./caso-del-tecnico');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

// Una base de casos de mentira, para no necesitar PostgreSQL ni Sheets.
const baseFalsa = (casos) => ({
    buscarCasoPorCodigo: async (cod) => casos.find(c => c.id_evento === cod) || null,
    buscarCasosRecientesPorTecnico: async () => casos,
});

const cola = (id) => new Map([['541169241157', { eventoActivoId: id }]]);
const quien = { telefono: '541169241157', nombre: 'Dario' };

// Todo adentro de una función async: `casoActivoDelTecnico` devuelve una promesa, y `await` en el
// nivel de arriba convierte el archivo en módulo ES — ahí `require` deja de existir.
async function correr() {

console.log('\n🔧 "YA LO RESOLVÍ" TIENE QUE CERRAR SU CASO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Las tres fuentes, en orden');
// ─────────────────────────────────────────────────────────────────────────────
{
    const casos = [
        { id_evento: 'CASO-1001', edificio: 'san patricio casa', estado: 'en_proceso', cerrado: false },
        { id_evento: 'CASO-1004', edificio: 'san patricio casa', estado: 'avisado', cerrado: false },
    ];

    // 1. El caso que la conversación tiene abierto manda sobre todo lo demás.
    const r1 = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-1001'), datos: baseFalsa(casos) });
    vale('gana el caso activo de la conversación', r1.caso?.id_evento === 'CASO-1001',
        `Eligió: ${r1.caso?.id_evento} — ${r1.motivo}`);

    // 2. Sin memoria, el que espera confirmación.
    const r2 = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa(casos) });
    vale('sin memoria, el que espera confirmación', r2.caso?.id_evento === 'CASO-1004',
        `Eligió: ${r2.caso?.id_evento} — ${r2.motivo}`);

    // 3. Con uno solo abierto, ese.
    const r3 = await casoActivoDelTecnico({
        ...quien, colas: new Map(),
        datos: baseFalsa([{ id_evento: 'CASO-1004', edificio: 'san patricio casa', estado: 'en_proceso', cerrado: false }])
    });
    vale('con uno solo abierto, ese', r3.caso?.id_evento === 'CASO-1004');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Lo que NO se elige, y es lo que más importa');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Cerrar el caso equivocado deja un problema sin atender Y al vecino sin reclamo abierto justo
    // cuando más lo necesita. Preguntar molesta; elegir mal cuesta plata y credibilidad.
    const dosIguales = [
        { id_evento: 'CASO-1001', edificio: 'san patricio casa', estado: 'en_proceso', cerrado: false },
        { id_evento: 'CASO-1006', edificio: 'San patricio 270', estado: 'en_proceso', cerrado: false },
    ];
    const r = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa(dosIguales) });
    vale('con DOS abiertos y ninguna pista, no se elige', r.caso === null,
        `Eligió: ${r.caso?.id_evento}`);
    vale('pero devuelve los candidatos para preguntarle', r.candidatos.length === 2);
    vale('y el motivo lo dice en el log', /2 casos abiertos/.test(r.motivo), r.motivo);

    // Dos esperando confirmación tampoco desempata.
    const dosAvisados = dosIguales.map(c => ({ ...c, estado: 'avisado' }));
    const r2 = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa(dosAvisados) });
    vale('dos "avisado" tampoco desempatan', r2.caso === null);

    // Un caso cerrado no se reabre ni cuenta.
    const cerrados = [{ id_evento: 'CASO-1001', edificio: 'san patricio casa', estado: 'cerrado', cerrado: true }];
    const r3 = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa(cerrados) });
    vale('un caso cerrado no cuenta', r3.caso === null && r3.candidatos.length === 0);

    // La memoria dice de qué se habla; la base dice la verdad. Si ya se cerró, no se reusa.
    const r4 = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-1001'), datos: baseFalsa(cerrados) });
    vale('la memoria no resucita un caso cerrado', r4.caso === null,
        'El código sale de RAM pero el caso se relee de la base.');

    // Sin nada, no inventa.
    const r5 = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa([]) });
    vale('sin casos, devuelve null y lo explica', r5.caso === null && /ning[úu]n caso abierto/.test(r5.motivo));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Un caso sin edificio no sirve para cerrar');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Sin edificio no se le puede decir al técnico QUÉ se cerró, ni imputar la factura después.
    const sinEdificio = [{ id_evento: 'CASO-1009', edificio: '', estado: 'en_proceso', cerrado: false }];
    const r = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa(sinEdificio) });
    vale('un caso sin edificio no entra en los candidatos', r.caso === null && r.candidatos.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) Si la base no contesta, no se adivina');
// ─────────────────────────────────────────────────────────────────────────────
{
    const rota = {
        buscarCasoPorCodigo: async () => { throw new Error('PG caído'); },
        buscarCasosRecientesPorTecnico: async () => { throw new Error('PG caído'); },
    };
    const r = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-1004'), datos: rota });
    vale('con la base caída devuelve null y dice por qué',
        r.caso === null && /no se pudieron leer sus casos/.test(r.motivo), r.motivo);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) index.js: el técnico no pasa por el camino del vecino');
// ─────────────────────────────────────────────────────────────────────────────
{
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const soloCodigo = cod
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    vale('existe la función de cierre del técnico',
        /const cerrarCasoQueElTecnicoDiceResuelto = async \(\) =>/.test(soloCodigo));

    vale('y usa `casoActivoDelTecnico`, no el edificio del vecino',
        /cerrarCasoQueElTecnicoDiceResuelto[\s\S]{0,900}?casoActivoDelTecnico\(/.test(soloCodigo));

    // El candado: la rama del proveedor tiene que salir ANTES de que se calcule
    // `edificioParaCierre`, que es la línea que traía todos los casos del sistema.
    //
    // > Se mide la PROPIEDAD --que el proveedor no llegue a esa línea-- y no la forma exacta que
    // > tenía el código. La primera versión exigía `rol === 'proveedor' … cerrarCaso… return;`
    // > pegados, y al mover el cierre del técnico más arriba --para que el MODELO decida antes que
    // > las palabras-- este candado falló con el código ya correcto. Un candado que mide la forma
    // > frena refactors buenos y se termina borrando, que es peor que no tenerlo.
    const bloque = (soloCodigo.match(/if \(esGatilloResolucion\) \{[\s\S]{0,1200}?edificioParaCierre =/) || [''])[0];
    vale('la salida del proveedor va ANTES de `edificioParaCierre`',
        /rol === 'proveedor'[\s\S]{0,240}?return[;\s]/.test(bloque),
        'Si queda después, el técnico vuelve a recibir la lista de todos los edificios.');

    // Y el cierre del técnico tiene que seguir ocurriendo en algún lado: que salga del camino del
    // vecino no sirve de nada si no se atiende antes.
    vale('…y antes de salir, se lo atiende por su propio camino',
        /rol === 'proveedor'[\s\S]{0,600}?cerrarCasoQueElTecnicoDiceResuelto\(\)/.test(soloCodigo),
        'El proveedor sale del camino del vecino pero nadie le cierra el caso.');

    vale('`informa_resuelto` ahora tiene consumidor',
        /seActiva\('informa_resuelto'/.test(soloCodigo),
        'Estaba declarada en el catálogo del ruteo y no la leía nadie.');

    vale('y NO cierra nada si el mensaje trae comprobante',
        /!traeComprobante[\s\S]{0,140}?seActiva\('informa_resuelto'/.test(soloCodigo),
        'Un adjunto manda sobre el texto que lo acompaña: esa regla no se puede saltear por el ruteo.');

    vale('ni si el mensaje lo niega',
        /!loNiega[\s\S]{0,120}?seActiva\('informa_resuelto'/.test(soloCodigo),
        '"todavía no se resolvió" trae las mismas palabras que "ya se resolvió".');

    // ── EL CANDADO CONTRA LA TERCERA COPIA ──────────────────────────────────────────
    //
    // Lo que no se puede duplicar es la REGLA de elegir uno, no el acceso a la tabla. Leer los
    // casos de un técnico sirve para tres preguntas distintas y solo una es esta:
    //
    //   · "¿de qué trabajo habla AHORA?"      → elegir UNO → esta función
    //   · "¿a qué caso imputo esta factura?"  → 30 días, incluye cerrados: un comprobante llega
    //     una semana después de cerrar el caso, y ese es el caso normal
    //   · "¿a cuáles les borro las marcas de entrega?" → TODOS los abiertos, no se elige ninguno
    //
    // Mezclarlas sería peor que tener dos copias. Por eso el candado busca la regla de desempate,
    // que es lo único que define a esta: el estado que espera confirmación y el "si hay uno solo".
    vale('el desempate por estado vive solo en `caso-del-tecnico.js`',
        !/avisad\|sin confirmar/.test(soloCodigo),
        'Esa expresión es la regla de este módulo. En index.js es una segunda copia.');

    vale('y el "si tiene uno solo, es ese" tampoco se rehace',
        !/abiertos\.length === 1 \? abiertos\[0\]/.test(soloCodigo));

    vale('la rama de la confirmación también pasa por el módulo',
        /casoPendiente = elegido\.caso/.test(soloCodigo),
        'Estaba escrita a mano y era la misma regla de tres fuentes.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) El caso real, de punta a punta');
// ─────────────────────────────────────────────────────────────────────────────
{
    // La conversación del 21/09: Dario tiene el CASO-1004 activo y escribe "ya lo resolví".
    const casos = [
        { id_evento: 'CASO-1001', edificio: 'san patricio casa', estado: 'en_proceso', cerrado: false },
        { id_evento: 'CASO-1003', edificio: 'san patricio casa', estado: 'en_proceso', cerrado: false },
        { id_evento: 'CASO-1004', edificio: 'san patricio casa', estado: 'en_proceso', cerrado: false },
    ];
    const r = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-1004'), datos: baseFalsa(casos) });

    vale('cierra el CASO-1004 y no otro', r.caso?.id_evento === 'CASO-1004',
        `Eligió: ${r.caso?.id_evento}`);

    // Y lo que pasaba antes: sin esta función, con tres casos abiertos y el edificio vacío, la
    // consulta del vecino devolvía los tres y le pedía elegir un número.
    const sinMemoria = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa(casos) });
    vale('sin el caso activo en memoria, pregunta en vez de adivinar',
        sinMemoria.caso === null && sinMemoria.candidatos.length === 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// UNA LINEA COMPARTIDA: EL CASO ES SUYO POR TELEFONO, AUNQUE FIGURE OTRO NOMBRE
//
// > [!CAUTION]
// > **El nombre y el telefono se miran JUNTOS.** En `buscarCasoAbiertoPorTecnico` el nombre
// > decidia y el telefono se consultaba solo `if (!row)`, asi que bastaba con que el tecnico
// > tuviera UN caso viejo a su nombre para que el caso nuevo --a nombre de su colega de la misma
// > linea-- no existiera.
//
// Produccion, 26/09. El reclamo era de plomeria, asi que el CASO-1005 se asigno a julio --el
// plomero de la linea-- y la plantilla salio a su nombre. Al contestar, quien escribe fue
// reconocido como Dario, que tenia 1001, 1003 y 1004 abiertos. La via del telefono nunca corrio.
//
// Lo que vio el tecnico en su WhatsApp:
//
//     Plantilla:  "Estimado/a julio ... [CASO-1005]"
//     Despues:    "Dario ... FOTO DEL RECLAMO [CASO-1004]"   <- otro nombre, otro caso, otra foto
//
// Y le pregunto "quien le abre?" cuando el vecino acababa de mandar la ficha de Natalia.
console.log('\n7) La linea compartida: el caso nuevo es suyo aunque diga otro nombre');
{
    const SRC = fs.readFileSync(path.join(__dirname, 'datos-pg.js'), 'utf8');
    const ini = SRC.indexOf('async function buscarCasoAbiertoPorTecnico');
    const cuerpo = SRC.slice(ini, SRC.indexOf('\nasync function', ini + 10));
    const codigo = cuerpo.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    // Ojo: el `if (!row && telTecnico)` del respaldo POR EDIFICIO sigue existiendo y esta bien --
    // ese si es un ultimo recurso. Lo que no puede volver es que la eleccion del caso salga de una
    // lista filtrada SOLO por nombre.
    vale('el telefono entra en la misma busqueda que el nombre, no despues',
        /mismoTel\(r\.get\('tel_tecnico'\), telTecnico\)/.test(codigo),
        'Sin esto, el caso que quedo a nombre del colega de la misma linea no aparece.');

    vale('y la eleccion ya no sale de una lista filtrada solo por nombre',
        !/let row = techBuscado \?/.test(codigo),
        'Con el ternario por nombre, basta un caso viejo suyo para que el nuevo no exista.');

    vale('el mas reciente se elige entre TODOS los suyos',
        /const suyos = abiertos\.filter/.test(codigo) && /elegirCasoMasReciente\(suyos/.test(codigo));

    vale('el log cuenta los casos DE EL, no los del sistema',
        /suyos\.length > 1/.test(codigo) && !/abiertos\.length > 1/.test(codigo),
        'Un contador que cuenta otra cosa manda a buscar un problema que no existe.');
}

// ─────────────────────────────────────────────────────────────────────────────
// DESCARTAR EL CASO YA CERRADO NO ES LO MISMO QUE OLVIDARLO
//
// > [!CAUTION]
// > **Que el caso de la conversación esté cerrado ES la respuesta cuando el técnico repite que
// > terminó.** Descartarlo en silencio le muestra un Marcos que no se acuerda de lo que hizo hace
// > un minuto --y le ofrece cerrar otro.
//
// Producción, 26/09 a la noche. Dos mensajes seguidos de Dario, con el log de los dos:
//
//     "Hola ya termine" → es el caso activo de la conversación (CASO-1005) → RESUELTO ✅
//     "Ya finalice"     → tiene 2 casos abiertos y ninguna pista dice cuál: se le pregunta
//
// Los dos hicieron lo correcto por separado. Lo que vio él fue "¿cuál es el que terminaste?" con
// una lista donde el caso que acababa de cerrar ya no estaba. **Si contestaba 1️⃣ cerraba el
// CASO-1004, que no había tocado.**
console.log('\n8) Repetir "ya terminé" no vuelve a preguntar de cero');
{
    const casos = [
        { id_evento: 'CASO-1005', edificio: 'San patricio 159', estado: 'resuelto',   cerrado: true  },
        { id_evento: 'CASO-1004', edificio: 'San patricio 159', estado: 'en_proceso', cerrado: false },
        { id_evento: 'CASO-1003', edificio: 'San patricio 159', estado: 'en_proceso', cerrado: false },
    ];
    const r = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-1005'), datos: baseFalsa(casos) });

    vale('no cierra nada: el 1005 ya estaba y con dos abiertos no se adivina', r.caso === null);
    vale('pero devuelve el caso ya cerrado para poder decírselo', r.yaCerrado?.id_evento === 'CASO-1005',
        `yaCerrado: ${r.yaCerrado?.id_evento}`);
    vale('y el cerrado NO entra entre los candidatos a cerrar',
        r.candidatos.length === 2 && !r.candidatos.some(c => c.id_evento === 'CASO-1005'),
        'Volver a cerrar un caso cerrado no tiene sentido; nombrarlo sí.');
    vale('el log dice las dos cosas', /2 casos abiertos/.test(r.motivo) && /CASO-1005 ya estaba cerrado/.test(r.motivo),
        r.motivo);

    // Su único caso, ya cerrado: no queda nada abierto y hay que decirle que ese ya está.
    const soloCerrado = [casos[0]];
    const r2 = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-1005'), datos: baseFalsa(soloCerrado) });
    vale('sin nada abierto, igual se nombra el que ya estaba cerrado',
        r2.caso === null && r2.candidatos.length === 0 && r2.yaCerrado?.id_evento === 'CASO-1005');

    // EL LÍMITE, que es lo que evita cambiar un problema por otro: `eventoActivoId` vive en la RAM
    // del proceso y puede ser de hace una semana. Nombrar un caso viejo como si fuera el de ahora
    // es el mismo error por el otro lado.
    const viejoFuera = {
        buscarCasoPorCodigo: async () => ({ id_evento: 'CASO-0007', edificio: 'otro', estado: 'cerrado', cerrado: true }),
        buscarCasosRecientesPorTecnico: async () => [casos[1], casos[2]],
    };
    const r3 = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-0007'), datos: viejoFuera });
    vale('un cerrado que NO está entre sus casos recientes no se nombra', r3.yaCerrado === null,
        `yaCerrado: ${r3.yaCerrado?.id_evento} — la memoria puede ser de hace una semana.`);

    // Y cuando hay algo para cerrar, esto no se mete en el medio.
    const r4 = await casoActivoDelTecnico({ ...quien, colas: cola('CASO-1004'), datos: baseFalsa(casos) });
    vale('con el caso activo abierto, se cierra y no se nombra ningún cerrado',
        r4.caso?.id_evento === 'CASO-1004' && !r4.yaCerrado);

    const r5 = await casoActivoDelTecnico({ ...quien, colas: new Map(), datos: baseFalsa(casos) });
    vale('sin memoria no se inventa un cerrado', r5.yaCerrado === null);

    // El código del caso se escribe de varias formas según de dónde salga, y son dos columnas
    // (`codigo_caso` e `id_evento`) para el mismo dato.
    const { mismoCodigo } = require('./caso-del-tecnico');
    vale('el código se compara por sus dígitos',
        mismoCodigo('CASO-1005', 'caso 1005') && mismoCodigo('1005', 'CASO-01005')
        && !mismoCodigo('CASO-1005', 'CASO-1004') && !mismoCodigo('', 'CASO-1005'));

    // ── EL CANDADO ──────────────────────────────────────────────────────────────────
    //
    // Se mide la PROPIEDAD: la pregunta "¿cuál terminaste?" no puede salir sin decir qué quedó
    // cerrado. No se mide la frase, que va a cambiar.
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const soloCod = cod.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    const cierre = (soloCod.match(/const cerrarCasoQueElTecnicoDiceResuelto[\s\S]*?\n    \};/) || [''])[0];
    vale('el cierre recibe el caso ya cerrado del módulo', /yaCerrado/.test(cierre),
        'Sin eso, index.js no tiene con qué contestarle que ese ya estaba.');

    const ramaLista = (cierre.match(/if \(candidatos\.length > 1\) \{[\s\S]*?return true;/) || [''])[0];
    vale('la lista de candidatos no sale sin nombrar lo ya cerrado', /yaEstaba|yaCerrado/.test(ramaLista),
        'Preguntar "¿cuál terminaste?" a alguien que acaba de decirlo lo empuja a cerrar otro caso.');

    const ramaVacia = cierre.slice(cierre.lastIndexOf('await despacharRespuesta'));
    vale('y tampoco el "no me figura nada abierto"', /yaEstaba|yaCerrado/.test(ramaVacia),
        'Decirle que no hay nada abierto, cuando lo que pasó es que ya se cerró, es lo mismo que negarlo.');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Un caso que no se cierra sigue molestando al técnico y mintiéndole al vecino.\n');
    process.exit(1);
}
console.log('\n   🔧 El técnico cierra su caso, y con dos abiertos se le pregunta.\n');

}

// Un fallo de la prueba tiene que SALIR con error, no quedar en una promesa rechazada que el
// verificador lee como éxito.
correr().catch(err => { console.error(`\n❌ La prueba se rompió: ${err.stack}\n`); process.exit(1); });
