// "FINALICÉ" TIENE QUE CERRAR EL CASO, Y "TERMINO MAÑANA" NO
//
//   node pruebas-cierre-tecnico.js
//
// > [!CAUTION]
// > **La condición que cierra un caso exigía la palabra `ya` PEGADA adelante.** `ya finalic` y
// > `ya termin[eé]` eran las dos únicas formas del verbo que cerraban, así que **"finalicé"** y
// > **"terminé"** a secas --como se escribe de verdad-- no cerraban nada.
//
// Visto en producción, 26/09/2026. Daniel avisó desde el lado del proveedor que había finalizado y
// mandó las facturas. Los CASO-1003 y CASO-1004 siguieron abiertos **cuatro días**: el seguimiento
// corriendo contra alguien que ya había terminado, y al vecino preguntándole por un trabajo hecho.
//
// Es el mismo defecto que `"1001 es el caso"` (pedía `CASO` pegado adelante), que
// `"no cierra la puerta"` (pedía ese orden exacto) y que las listas de rubros escritas a mano:
// **el orden de las palabras decidiendo.**
//
// Y aflojarlo de más es peor, que es justo para lo que estaba el `ya`: forzaba el pasado. Un
// "termino mañana" que cierra el caso deja al vecino sin reclamo abierto justo cuando más lo
// necesita, y el técnico ni se entera. Por eso las dos mitades se prueban juntas.

'use strict';

const fs = require('fs');
const path = require('path');

let bien = 0, mal = 0;
const vale = (nombre, cond, extra) => {
    if (cond) { bien++; console.log(`   ✅ ${nombre}`); }
    else { mal++; console.log(`   ❌ ${nombre}${extra ? `\n      ${extra}` : ''}`); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Se leen las condiciones REALES de `index.js`, no una copia.
//
// Una copia pegada acá se desincroniza en el primer cambio y la prueba pasa a medir un archivo que
// no existe. Es el mismo motivo por el que `pruebas-renombrar-edificio.js` extrae su bloque.
// ─────────────────────────────────────────────────────────────────────────────
const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const ini = SRC.indexOf('const hablaDeOtroDia');
const fin = SRC.indexOf('// "Todavía no se resolvió" trae las mismas palabras', ini);
if (ini < 0 || fin < 0) {
    console.log('\n❌ No encontré el bloque de `diceQueSeResolvio` en index.js.\n' +
                '   Si lo renombraste, actualizá esta prueba: sin el bloque no se está midiendo nada.\n');
    process.exit(1);
}

const bloqueResolucion = SRC.slice(ini, fin);

const iniNiega = SRC.indexOf('const loNiega =', fin);
const finNiega = SRC.indexOf('\n', iniNiega);
const bloqueNiega = SRC.slice(iniNiega, finNiega);

const evaluar = new Function('textoFinal',
    `${bloqueResolucion}\n${bloqueNiega}\n` +
    'return { diceQueSeResolvio, miraAlFuturo, loNiega, cierra: diceQueSeResolvio && !loNiega };');

const cierra = (t) => evaluar(t).cierra;

console.log('\n── LO QUE TIENE QUE CERRAR EL CASO ──');

// La frase exacta de Daniel, y las formas que la rodean.
for (const t of ['finalice', 'finalicé', 'termine', 'terminé', 'terminado', 'finalizado',
                 'completado', 'finalice el trabajo', 'lo termine hoy', 'ya esta terminado']) {
    vale(`"${t}"`, cierra(t), 'El verbo en pasado alcanza solo: no hace falta el "ya" adelante.');
}

// Lo que ya andaba antes y no se puede haber roto.
console.log('\n── LO QUE YA CERRABA, Y NO SE MOVIÓ ──');
for (const t of ['ya lo resolvi', 'trabajo terminado', 'quedó solucionado', 'ya lo arreglaron',
                 'ya funciona', 'el técnico ya vino y lo arregló']) {
    vale(`"${t}"`, cierra(t));
}

console.log('\n── LO QUE NO PUEDE CERRAR: TODAVÍA NO PASÓ ──');
// > [!CAUTION]
// > **Cerrar contra una promesa es peor que no cerrar.** El vecino se queda sin reclamo abierto,
// > el seguimiento se apaga, y nadie se entera hasta que el vecino vuelve a escribir enojado.
for (const t of ['termino mañana', 'voy a terminar hoy', 'cuando termine te aviso',
                 'apenas finalice te mando la factura', 'mañana lo resuelvo',
                 'recien termino el lunes', 'espero terminar hoy', 'paso a terminarlo el viernes']) {
    vale(`"${t}"`, !cierra(t), 'Es una promesa a futuro, no un trabajo hecho.');
}

// > [!CAUTION]
// > **El marcador de tiempo puede ir ADELANTE del verbo.** La primera versión de este arreglo lo
// > buscaba solo atrás: `"termino mañana"` quedaba bien y **`"mañana lo termino"` cerraba el
// > caso**. Tercera vez en el mismo día que el orden de las palabras decide mal.
console.log('\n── …Y EL "MAÑANA" PUEDE IR ANTES DEL VERBO ──');
for (const t of ['mañana lo termino', 'mañana lo termino seguro', 'la semana que viene lo termino',
                 'lo termino el lunes', 'mas tarde lo finalizo', 'pasado mañana lo cierro']) {
    vale(`"${t}"`, !cierra(t), 'El marcador de tiempo se busca en TODO el mensaje, no después del verbo.');
}

// La frase que lo destapó, planteada por Daniel: una factura, un trabajo sin terminar y una
// promesa, todo en el mismo mensaje. Es como escribe un técnico de verdad.
console.log('\n── LA FACTURA DE LA VISITA NO ES EL TRABAJO TERMINADO ──');
vale('"acá está la factura de la visita, todavía no terminé pero si compra la bomba hoy finalizo mañana"',
    !cierra('hola acá está la factura de la visita, todavía no terminé pero si compra la bomba hoy finalizo mañana'),
    'Un técnico cobra la visita y vuelve con el repuesto: el comprobante no dice que el trabajo esté hecho.');
vale('…y sin los acentos, que es como se tipea',
    !cierra('hola aca esta la factura de la visita, todavia no termine pero si compra la bomba hoy finalizo mañana'));

// > **`termino` sin tilde es "yo termino", no "terminó".** Misma palabra escrita, sentidos
// > opuestos: una promesa y un hecho. Se pide la tilde para la tercera persona.
console.log('\n── LA TILDE DISTINGUE LA PROMESA DEL HECHO ──');
vale('"terminó el trabajo" cierra (con tilde, es pasado)', cierra('terminó el trabajo'));
vale('"lo termino" NO cierra (sin tilde, es "yo termino")', !cierra('lo termino'),
    'Cerrar acá deja al vecino sin reclamo abierto contra una promesa. El error caro es ese.');
vale('"finalizo el trabajo" tampoco', !cierra('finalizo el trabajo'));

console.log('\n── LO QUE NO PUEDE CERRAR: LO ESTÁ NEGANDO ──');
for (const t of ['todavia no se resolvio', 'no termine todavia', 'no lo pude finalizar',
                 'no se soluciono nada']) {
    vale(`"${t}"`, !cierra(t), '"No se resolvió" trae las mismas palabras que "se resolvió".');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── CANDADOS ──');

// > [!CAUTION]
// > **La raíz del verbo se escribe de dos formas: `finalicé` con C y `finalizado` con Z.**
// > Poner solo una deja la otra afuera. Pasó al escribir ESTA misma corrección: `miraAlFuturo`
// > tenía solo `finaliz`, así que "apenas finalice te mando la factura" no era reconocido como
// > futuro y cerraba el caso.
vale('el control de futuro reconoce las dos raíces del verbo (finaliC / finaliZ)',
    /final\(\?:iz\|ic\)/.test(bloqueResolucion),
    'Con solo `finaliz`, "apenas finalice…" se lee como trabajo terminado y cierra el caso.');

// El `ya` no puede volver como requisito.
vale('el verbo en pasado ya no exige la palabra "ya" adelante',
    cierra('finalicé') && cierra('terminé'),
    'Volvió a pedir "ya finalicé". Nadie escribe así.');

// Y el control de futuro tiene que seguir existiendo: sin él, aflojar el `ya` es peligroso.
vale('sigue existiendo el control de que no mire al futuro',
    /miraAlFuturo/.test(bloqueResolucion) && /!miraAlFuturo/.test(bloqueResolucion),
    'Sin esto, "termino mañana" cierra el caso.');

console.log('\n──────────────────────────────────────────────────────────────────────');
console.log(`   ${bien} bien, ${mal} mal\n`);
if (mal === 0) {
    console.log('   ✅ El trabajo terminado cierra el caso, y la promesa no.\n');
    process.exit(0);
}
process.exit(1);
