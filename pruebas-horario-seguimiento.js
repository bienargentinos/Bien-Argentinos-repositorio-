// Verifica que Marcos espere hasta la hora que el técnico prometió, y que no pregunte de noche.
//
//   node pruebas-horario-seguimiento.js
//
// POR QUÉ. `estimarPlazoMs` devolvía SIEMPRE una duración contada desde ahora: "mañana" eran 20
// horas, dijera lo que dijera el técnico. Dos consecuencias, las dos malas:
//
//   - Avisa a las 8 de la mañana que va mañana → el control caía a las 4 de la MADRUGADA del día
//     siguiente. Marcos preguntaba "¿pudiste pasar?" a las 4 AM, antes incluso de la hora a la que
//     el técnico había prometido ir.
//   - Avisa a las 19 que va mañana → el control caía a las 15 del otro día, cinco horas tarde.
//
// Daniel: "si el proveedor dice que pasa al otro día a tal hora que comience a contabilizar desde
// ese momento hasta la hora fijada, para que no esté preguntando a las 3 AM".
//
// Las horas se escriben en hora argentina. El servidor puede estar en UTC, así que la prueba
// construye los instantes con el mismo desfase fijo que usa el código (-3, sin horario de verano
// desde 2009).

const { momentoPrometido, calcularPrimerControl, enHorarioRazonable } = require('./seguimiento');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${esperado}, dio ${real}`);
}

// Un instante a partir de una fecha y hora argentina.
const AR = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h + 3, min));
// Cómo se lee un instante en hora argentina, para poder afirmar sobre él.
const leerAR = (fecha) => {
    if (!fecha) return 'null';
    const t = new Date(fecha.getTime() - 3 * 3600 * 1000);
    const dd = String(t.getUTCDate()).padStart(2, '0');
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mi = String(t.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
};

console.log('\n── LA HORA QUE DIJO ES UN MOMENTO, NO UNA DURACIÓN ──');
{
    // Miércoles 27/08/2026, 19:38 -- la hora real del CASO-1003.
    const ahora = AR(2026, 8, 26, 19, 38);

    verificar('"mañana a las 10"', leerAR(momentoPrometido('voy mañana a las 10', ahora)), '27/08 10:00');
    verificar('"mañana a las 10:30"', leerAR(momentoPrometido('paso mañana a las 10:30', ahora)), '27/08 10:30');
    verificar('"mañana a la mañana" no son dos días',
        leerAR(momentoPrometido('voy mañana a la mañana', ahora)), '27/08 09:00');
    verificar('"pasado mañana a las 9"', leerAR(momentoPrometido('pasado mañana a las 9', ahora)), '28/08 09:00');
    verificar('"mañana a la tarde"', leerAR(momentoPrometido('mañana a la tarde', ahora)), '27/08 15:00');
    verificar('"mañana temprano"', leerAR(momentoPrometido('mañana temprano', ahora)), '27/08 08:00');
    verificar('"a las 8 de la mañana"', leerAR(momentoPrometido('paso a las 8 de la mañana', ahora)), '27/08 08:00');
    // Son las 19:38 y dice "a las 8 de la tarde": las 20 de HOY todavía no pasaron.
    verificar('"a las 8 de la tarde" son las 20',
        leerAR(momentoPrometido('paso a las 8 de la tarde', ahora)), '26/08 20:00');
    verificar('"a las 21hs" de hoy todavía no pasó',
        leerAR(momentoPrometido('paso a las 21hs', ahora)), '26/08 21:00');
}

console.log('\n── UNA HORA QUE YA PASÓ ES LA DE MAÑANA ──');
{
    // Son las 14 y dice "a las 10": no habla de esta mañana.
    const ahora = AR(2026, 8, 26, 14, 0);
    verificar('"a las 10" dicho a las 14', leerAR(momentoPrometido('paso a las 10', ahora)), '27/08 10:00');
    verificar('"a las 16" dicho a las 14 es hoy', leerAR(momentoPrometido('paso a las 16', ahora)), '26/08 16:00');
}

console.log('\n── LOS PLAZOS RELATIVOS SIGUEN CONTANDO DESDE AHORA ──');
{
    // "En 30 minutos" no es una hora del reloj: son 30 minutos desde este momento. Si esto se
    // leyera como hora, "en 2 horas" pasaría a ser "a las 2".
    const ahora = AR(2026, 8, 26, 14, 0);
    verificar('"en 30 minutos" no es una hora del reloj', momentoPrometido('salgo en 30 minutos', ahora), null);
    verificar('"en 2 horas" tampoco', momentoPrometido('llego en 2 horas', ahora), null);
    verificar('"ya salgo" tampoco', momentoPrometido('ya salgo para allá', ahora), null);
    verificar('un saludo tampoco', momentoPrometido('hola qué tal', ahora), null);

    // Y el control sale del plazo, con la media hora de gracia.
    verificar('control de "en 30 minutos" → una hora después',
        leerAR(calcularPrimerControl('salgo en 30 minutos', ahora)), '26/08 15:00');
    verificar('control de "en 2 horas" → dos horas y media después',
        leerAR(calcularPrimerControl('llego en 2 horas', ahora)), '26/08 16:30');
}

console.log('\n── NADIE PREGUNTA A LAS 3 DE LA MAÑANA ──');
{
    // El caso que lo destapó: avisa a las 8 AM que va mañana. Con la regla vieja (ahora + 20hs)
    // el control caía a las 4 de la madrugada.
    const ahora = AR(2026, 8, 26, 8, 0);
    // "Voy mañana" sin hora: tiene todo el día. Se le pregunta al final de la jornada, no a
    // primera hora -- y sobre todo, no a las 4 de la madrugada como pasaba antes.
    verificar('avisa a las 8 AM que va mañana → control al final del día siguiente',
        leerAR(calcularPrimerControl('voy mañana', ahora)), '27/08 18:30');
    verificar('"voy hoy" a las 8 AM → control al final de HOY',
        leerAR(calcularPrimerControl('voy hoy', ahora)), '26/08 18:30');

    // Y si aun así algo cae fuera de hora, se corre.
    verificar('un control de las 3 AM se corre a las 8',
        leerAR(enHorarioRazonable(AR(2026, 8, 26, 3, 0))), '26/08 08:00');
    verificar('uno de las 23:30 se corre a las 8 del día siguiente',
        leerAR(enHorarioRazonable(AR(2026, 8, 26, 23, 30))), '27/08 08:00');
    verificar('uno de las 15 no se toca',
        leerAR(enHorarioRazonable(AR(2026, 8, 26, 15, 0))), '26/08 15:00');
    verificar('las 8 en punto ya es horario válido',
        leerAR(enHorarioRazonable(AR(2026, 8, 26, 8, 0))), '26/08 08:00');
}

console.log('\n── EL CONTROL RESPETA LA HORA PROMETIDA, CON GRACIA ──');
{
    const ahora = AR(2026, 8, 26, 19, 38);
    // Prometió las 10 de mañana → se le pregunta a las 10:30, no antes.
    verificar('"mañana a las 10" → control 10:30',
        leerAR(calcularPrimerControl('voy mañana a las 10', ahora)), '27/08 10:30');
    // Prometió a las 21:50 → 22:20 ya es tarde: se corre a la mañana.
    verificar('"a las 21:50" → el control se corre a la mañana siguiente',
        leerAR(calcularPrimerControl('paso a las 21:50', ahora)), '27/08 08:00');
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
