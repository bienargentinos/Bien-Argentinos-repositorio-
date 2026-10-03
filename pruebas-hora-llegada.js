// "EN 2 HS" ENVEJECE: A LA HORA YA FALTA UNA
//
//   node pruebas-hora-llegada.js
//
// > [!CAUTION]
// > **Una duración guardada como texto y repetida después miente.** "En 2 horas" es una cuenta
// > desde el momento en que se dijo, no una hora del reloj.
//
// EL CASO, planteado por Daniel:
//
//     00:00  Dario:  "en 2 hs llego"
//     01:00  Vecino: "¿a qué hora viene el técnico?"
//     01:00  Marcos: "en 2 hs"          ← falta UNA, no dos
//
// Y a las 03:30 seguiría prometiendo dos horas para algo que venció hace rato. El vecino no lo lee
// como un redondeo: lo lee como que nadie está mirando su caso.
//
// Al escribir esto apareció algo peor, que ya estaba en producción y afectaba también al
// seguimiento: **`momentoPrometido` leía "en 2 hs" como "a las 02:00"**. La última alternativa
// aceptaba un número pegado a "hs" sin mirar la preposición de adelante, y "hs" es como se escribe
// de verdad ("en 2 horas" caía bien, "en 2 hs" no). Dicho a medianoche coincide de casualidad;
// dicho a las 8 de la mañana, el control quedaba agendado para las 02:00 del día siguiente.

const assert = require('assert');
const { momentoPrometido } = require('./seguimiento');
const { momentoDeLlegada, comoDecirLaLlegada, duracionEnMs, instanteAR } = require('./llegada-tecnico');
const { horaAR } = require('./fecha');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

/** Un instante real a partir de una hora argentina del 11/09/2026. */
const ar = (hhmm) => instanteAR(`11/09/2026, ${hhmm}:00`);

console.log('\n── "EN 2 HS" ES UN PLAZO, NO LAS DOS DE LA MAÑANA ──');

prueba('"en 2 hs" no es una hora del reloj', () => {
    assert.strictEqual(momentoPrometido('en 2 hs llego', ar('08:00')), null);
    assert.strictEqual(momentoPrometido('llego en 2 horas', ar('08:00')), null);
    assert.strictEqual(momentoPrometido('dentro de 3 hs paso', ar('08:00')), null);
});

prueba('"a las 2 hs" SÍ lo es', () => {
    // La preposición es lo único que las distingue. Sacar la alternativa entera rompería esto.
    assert.strictEqual(horaAR(momentoPrometido('paso a las 2 hs', ar('08:00'))), '02:00');
    assert.strictEqual(horaAR(momentoPrometido('a las 14 hs', ar('08:00'))), '14:00');
    assert.strictEqual(horaAR(momentoPrometido('18 hs', ar('08:00'))), '18:00');
});

console.log('\n── EL PLAZO SE CUENTA DESDE QUE LO DIJO, NO DESDE AHORA ──');

prueba('dicho a las 00:00, "en 2 hs" son las 02:00', () => {
    const m = momentoDeLlegada({ eta: 'en 2 hs llego', confirmadoEn: '11/09/2026, 00:00:00' });
    assert.strictEqual(horaAR(m), '02:00');
});

prueba('dicho a las 08:00, "en 2 hs" son las 10:00 (no las 02:00)', () => {
    // Este es el que dolía de verdad: 18 horas de diferencia, y el vecino esperando desde las 10.
    const m = momentoDeLlegada({ eta: 'en 2 hs', confirmadoEn: '11/09/2026, 08:00:00' });
    assert.strictEqual(horaAR(m), '10:00');
});

prueba('la hora del reloj no se mueve nunca', () => {
    const m = momentoDeLlegada({ eta: 'paso a las 16', confirmadoEn: '11/09/2026, 08:00:00' });
    assert.strictEqual(horaAR(m), '16:00');
});

prueba('sin promesa NO se inventa una hora', () => {
    // `estimarPlazoMs` devuelve 3 horas cuando no entiende nada, y para agendar un control está
    // bien. Acá el resultado se lo lee una persona que está esperando en su casa.
    assert.strictEqual(momentoDeLlegada({ eta: '', confirmadoEn: '11/09/2026, 08:00:00' }), null);
    assert.strictEqual(momentoDeLlegada({ eta: 'dale gracias', confirmadoEn: '11/09/2026, 08:00:00' }), null);
    assert.strictEqual(duracionEnMs('hola qué tal'), null);
});

console.log('\n── LO QUE ESCUCHA EL VECINO, A LA HORA QUE PREGUNTA ──');

const dicho = { eta: 'en 2 hs llego', confirmadoEn: '11/09/2026, 00:00:00' };

prueba('a las 01:00 dice que falta UNA hora, no dos', () => {
    const r = comoDecirLaLlegada({ ...dicho, ahora: ar('01:00') });
    assert.ok(/a las 02:00/.test(r.frase), `no nombra la hora del reloj: "${r.frase}"`);
    assert.ok(/en una hora/.test(r.frase), `no dice cuánto falta de verdad: "${r.frase}"`);
    assert.ok(!/2 hs|dos horas/.test(r.frase), `repitió la frase original: "${r.frase}"`);
});

prueba('faltando cinco minutos dice que está por llegar', () => {
    const r = comoDecirLaLlegada({ ...dicho, ahora: ar('01:56') });
    assert.ok(/está por llegar/.test(r.frase), r.frase);
});

prueba('pasada la hora, lo reconoce en vez de prometer', () => {
    // Prometerle una llegada que venció es peor que admitir la demora: la próxima vez que Marcos
    // diga una hora, el vecino ya no le va a creer.
    const r = comoDecirLaLlegada({ ...dicho, ahora: ar('03:30') });
    assert.strictEqual(r.vencido, true);
    assert.ok(/todavía no avisó que llegó/.test(r.frase), r.frase);
    assert.ok(/hace una hora y 30 minutos/.test(r.frase), r.frase);
});

prueba('sin horario devuelve lo que dijo, sin traducir', () => {
    const r = comoDecirLaLlegada({ eta: 'voy a ver cuándo puedo', confirmadoEn: '11/09/2026, 00:00:00' });
    assert.strictEqual(r.hay, false);
    assert.strictEqual(r.frase, '');
    assert.strictEqual(r.textual, 'voy a ver cuándo puedo');
});

console.log('\n── CASTELLANO QUE UNA PERSONA DIRÍA ──');

prueba('nunca sale "1 hora"', () => {
    // A Marcos se le nota enseguida cuando arma una frase que nadie diría.
    for (const h of ['01:00', '00:58', '01:02']) {
        const r = comoDecirLaLlegada({ ...dicho, ahora: ar(h) });
        assert.ok(!/\b1 hora\b/.test(r.frase), `dice "1 hora": "${r.frase}"`);
    }
});

console.log('\n── CANDADO ──');

prueba('el prompt del vecino usa la hora calculada y prohíbe repetir la original', () => {
    const fs = require('fs');
    const cara = fs.readFileSync(require('path').join(__dirname, 'agentes', 'marcos-cara.js'), 'utf8');
    assert.ok(/comoDecirLaLlegada/.test(cara),
        'marcos-cara tiene que traducir la promesa, no repetirla');
    assert.ok(/NO repitas la frase original del t[eé]cnico/.test(cara),
        'sin esta línea el modelo copia "en 2 horas" del contexto igual');
    assert.ok(/LA HORA QUE PROMETI[ÓO] YA PAS[ÓO]/.test(cara),
        'falta la instrucción para cuando la hora venció');
});

console.log('');
if (fallos === 0) {
    console.log('✅ Al vecino se le dice la hora del reloj, calculada al momento de preguntar.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
