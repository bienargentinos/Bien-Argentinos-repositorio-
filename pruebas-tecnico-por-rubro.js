// Verifica que Marcos elija BIEN a cuál de los técnicos que comparten una línea le está
// hablando, usando el rubro del caso y no el orden de la planilla.
//
//   node pruebas-tecnico-por-rubro.js
//
// El caso real: el 541169241157 figura como JULIO (plomero) y como DARIO (electricista) --
// dos técnicos de la misma empresa con la misma línea. En un caso de electricidad, Marcos
// saludaba "Gracias, Julio" porque era el primero de la planilla. Para el técnico eso es
// Marcos hablándole a otra persona.

// La comparación de rubros vive en `rubros.js`: la usan index.js (para saber cuál de los técnicos
// de una línea compartida está escribiendo) y sheets.js (para saber si un reclamo nuevo continúa
// un caso abierto o es otro caso).
const { coincideRubro: coincideRubroTecnico } = require('./rubros');

// Lo que hace index.js cuando hay varios técnicos en la misma línea.
function aQuienLeHabla(enEsaLinea, rubroDelCaso, primeroDeLaPlanilla) {
    if (enEsaLinea.length <= 1) return primeroDeLaPlanilla;
    if (!rubroDelCaso) return null;   // sin caso no se lo nombra
    const elCorrecto = enEsaLinea.find(p => coincideRubroTecnico(p.rubro, rubroDelCaso));
    return elCorrecto ? elCorrecto.nombre : primeroDeLaPlanilla;
}

// La línea compartida, en el orden en que está cargada en la planilla.
const LINEA = [
    { nombre: 'julio', rubro: 'plomeria' },
    { nombre: 'dario juju', rubro: 'electricidad' },
];

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

console.log('\n── DOS TÉCNICOS EN LA MISMA LÍNEA ──');
verificar('caso de electricidad → le habla a Dario, no a Julio (que es el primero)',
    aQuienLeHabla(LINEA, 'electricidad', 'julio'), 'dario juju');
verificar('caso de plomería → le habla a Julio',
    aQuienLeHabla(LINEA, 'plomeria', 'julio'), 'julio');
verificar('el rubro escrito de otra forma ("electricista") también resuelve',
    aQuienLeHabla(LINEA, 'electricista', 'julio'), 'dario juju');
verificar('"luz" resuelve al electricista',
    aQuienLeHabla(LINEA, 'luz', 'julio'), 'dario juju');
verificar('"agua" resuelve al plomero',
    aQuienLeHabla(LINEA, 'agua', 'julio'), 'julio');
verificar('sin caso (no hay rubro) NO se lo llama por ningún nombre',
    aQuienLeHabla(LINEA, '', 'julio'), null);
verificar('un rubro que no tiene nadie en esa línea deja el nombre como estaba',
    aQuienLeHabla(LINEA, 'ascensorista', 'julio'), 'julio');

console.log('\n── UN SOLO TÉCNICO EN LA LÍNEA (lo normal) ──');
verificar('no se toca nada',
    aQuienLeHabla([{ nombre: 'Daniel Valdez', rubro: 'electricidad' }], 'plomeria', 'Daniel Valdez'),
    'Daniel Valdez');

console.log('\n── EQUIVALENCIAS DE OFICIOS ──');
const pares = [
    ['electricidad', 'electricista', true],
    ['plomeria', 'plomero', true],
    ['gas', 'gasista', true],
    ['cerrajeria', 'portero electrico', true],
    ['electricidad', 'plomeria', false],
    ['plomeria', 'cerrajeria', false],
    ['gas', 'electricidad', false],
];
for (const [a, b, esp] of pares) {
    verificar(`"${a}" y "${b}" ${esp ? 'son' : 'NO son'} el mismo oficio`, coincideRubroTecnico(a, b), esp);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
