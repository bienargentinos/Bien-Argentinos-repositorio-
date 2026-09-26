// Verifica que los horarios flexibles por días y franjas horarias del personal
// (encargados, suplentes, limpieza, seguridad) se interpreten, formateen y separen correctamente.
//
//   node pruebas-horarios-staff.js
//

const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
const ast = acorn.parse(SRC, { ecmaVersion: 2022, locations: true });

function extraerFn(name) {
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id && n.id.name === name);
    if (!node) throw new Error('No encontré ' + name + ' en dashboard.js');
    return SRC.slice(node.start, node.end);
}

const fuente = [
    'const DIAS_KEYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];',
    'const DIAS_NOMBRES = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };',
    extraerFn('padHora'),
    extraerFn('splitStaffItems'),
    extraerFn('parseHorarioFlexible'),
    extraerFn('formatearDias'),
    extraerFn('formatearHorarioTurnos'),
    extraerFn('parseHorarioEnc'),
    extraerFn('horarioTexto'),
    extraerFn('parseStaffList'),
].join('\n');

// eslint-disable-next-line no-new-func
const {
    splitStaffItems,
    parseHorarioFlexible,
    formatearHorarioTurnos,
    parseHorarioEnc,
    horarioTexto,
    parseStaffList,
} = new Function(
    `${fuente}; return { splitStaffItems, parseHorarioFlexible, formatearHorarioTurnos, parseHorarioEnc, horarioTexto, parseStaffList };`
)();

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) {
        console.log(`     esperaba: ${JSON.stringify(esperado)}`);
        console.log(`     dio:      ${JSON.stringify(real)}`);
    }
}

console.log('\n── PARSEO DE HORARIOS FLEXIBLES (DÍAS Y TURNOS) ──');
{
    const h1 = parseHorarioFlexible('Lun, Mié 11:00-17:00 · Vie 16:00-20:00');
    verificar('detecta 2 turnos cruzados', h1.length, 2);
    verificar('turno 1 tiene Lun y Mié', h1[0].dias.sort(), ['lun', 'mie'].sort());
    verificar('turno 1 horas 11:00 a 17:00', `${h1[0].desde}-${h1[0].hasta}`, '11:00-17:00');
    verificar('turno 2 tiene Vie', h1[1].dias, ['vie']);
    verificar('turno 2 horas 16:00 a 20:00', `${h1[1].desde}-${h1[1].hasta}`, '16:00-20:00');

    const h2 = parseHorarioFlexible('L-V 08:00-12:00 / 16:00-20:00 · Sáb 08:00-12:00');
    verificar('parsea horario tradicional con descanso y sábados', h2.length, 3);
    verificar('turno 1 es L-V mañana', h2[0].dias.length, 5);
    verificar('turno 2 es L-V tarde', h2[1].dias.length, 5);
    verificar('turno 3 es Sáb', h2[2].dias, ['sab']);

    const h3 = parseHorarioFlexible('Mar, Jue 09:00-13:00');
    verificar('parsea días no consecutivos', h3[0].dias.sort(), ['jue', 'mar'].sort());

    const h4 = parseHorarioFlexible('Lunes a Viernes de 8 a 17 hs');
    verificar('parsea texto en lenguaje natural', h4[0].dias.length, 5);
    verificar('horas 08:00 a 17:00', `${h4[0].desde}-${h4[0].hasta}`, '08:00-17:00');
}

console.log('\n── FORMATEO DE TURNOS A TEXTO ──');
{
    const turnos1 = [
        { dias: ['lun', 'mie'], desde: '11:00', hasta: '17:00' },
        { dias: ['vie'], desde: '16:00', hasta: '20:00' }
    ];
    verificar('formateo turnos cruzados',
        formatearHorarioTurnos(turnos1),
        'Lun y Mié 11:00–17:00 · Vie 16:00–20:00'
    );

    const turnos2 = [
        { dias: ['lun', 'mar', 'mie', 'jue', 'vie'], desde: '08:00', hasta: '12:00' },
        { dias: ['lun', 'mar', 'mie', 'jue', 'vie'], desde: '16:00', hasta: '20:00' },
        { dias: ['sab'], desde: '08:00', hasta: '12:00' }
    ];
    verificar('formateo 2 turnos Lun-Vie + Sáb',
        formatearHorarioTurnos(turnos2),
        'Lun a Vie 08:00–12:00 · Lun a Vie 16:00–20:00 · Sáb 08:00–12:00'
    );
}

console.log('\n── COMPATIBILIDAD CON ESTRUCTURA LEGACY (parseHorarioEnc) ──');
{
    const legacy = parseHorarioEnc('L-V 08:00-12:00 / 16:00-20:00 · Sáb 08:00-12:00');
    verificar('preserva lv1', legacy.lv1, ['08:00', '12:00']);
    verificar('preserva lv2', legacy.lv2, ['16:00', '20:00']);
    verificar('preserva sab', legacy.sab, ['08:00', '12:00']);
    verificar('incluye turnos normalizados', Array.isArray(legacy.turnos), true);
    verificar('horarioTexto produce texto legible',
        horarioTexto('L-V 08:00-12:00 · Sáb 08:00-12:00'),
        'Lun a Vie 08:00–12:00 · Sáb 08:00–12:00'
    );
}

console.log('\n── DESGLOSE DE STAFF SIN ROMPER POR COMAS EN HORARIOS ──');
{
    const raw = 'Carlos [activo | Lun, Mié 11:00-17:00], Marta [activo | Mar, Jue 09:00-13:00]';
    const items = splitStaffItems(raw);
    verificar('separa en 2 empleados respetando comas dentro de corchetes', items.length, 2);
    verificar('empleado 1 contiene corchetes intactos', items[0], 'Carlos [activo | Lun, Mié 11:00-17:00]');
    verificar('empleado 2 contiene corchetes intactos', items[1], 'Marta [activo | Mar, Jue 09:00-13:00]');

    const staffParsed = parseStaffList(raw);
    verificar('parseStaffList extrae 2 empleados', staffParsed.length, 2);
    verificar('parseStaffList empleado 1 nombre', staffParsed[0].nombre, 'Carlos');
    verificar('parseStaffList empleado 1 horario', staffParsed[0].horario, 'Lun, Mié 11:00-17:00');
    verificar('parseStaffList empleado 2 nombre', staffParsed[1].nombre, 'Marta');
    verificar('parseStaffList empleado 2 horario', staffParsed[1].horario, 'Mar, Jue 09:00-13:00');
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
