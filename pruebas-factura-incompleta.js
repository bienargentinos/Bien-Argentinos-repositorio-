// Verifica los tres detectores que decide qué hacer Marcos con una factura, leyéndolos DEL
// CÓDIGO REAL de index.js en vez de copiarlos acá. Si alguien cambia un patrón en index.js y
// rompe un caso, esta prueba lo marca; si los copiáramos, la prueba seguiría en verde sobre una
// copia vieja y no serviría para nada.
//
//   node pruebas-factura-incompleta.js

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

/** Saca del fuente la expresión que se le asigna a una constante, y la evalúa como función. */
function detectorDeIndexJs(nombreConst, nombreVariable) {
    const i = SRC.indexOf(`const ${nombreConst} = `);
    if (i === -1) throw new Error(`No encontré "const ${nombreConst}" en index.js.`);
    const desde = i + `const ${nombreConst} = `.length;
    const fin = SRC.indexOf(';\n', desde);
    if (fin === -1) throw new Error(`No encontré el final de "${nombreConst}".`);
    const expr = SRC.slice(desde, fin);
    // eslint-disable-next-line no-new-func
    return new Function(nombreVariable, `return (${expr});`);
}

const quedoPorLaMitad = detectorDeIndexJs('quedoPorLaMitad', 'notaDeQuienEnvia');

// El gremio que falta se saca del mismo patrón que usa index.js.
const reGremio = new RegExp(
    (SRC.match(/const gremioQueFalta = \(notaDeQuienEnvia\.match\((\/.+?\/i)\)/) || [])[1]
        ?.replace(/^\//, '').replace(/\/i$/, '') || '(?!)',
    'i'
);
const gremioQueFalta = n => (n.match(reGremio) || [])[1] || '—';

let fallos = 0;
function verificar(titulo, real, esperado, extra = '') {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}${extra}`);
    if (!ok) console.log(`     esperaba ${esperado}, dio ${real}`);
}

console.log('\n── ¿EL TRABAJO QUEDÓ POR LA MITAD? ──');

const casos = [
    // [texto, quedaIncompleto, gremioEsperado]
    ['hay que llamar al plomero para que continue con lo que falta .. coordinen con el yo hasta aca llegue...', true, 'plomero'],
    ['Reparé la pérdida pero falta que venga el albañil a cerrar la pared', true, 'albañil'],
    ['Hice un arreglo provisorio, hay que mandar un gasista', true, 'gasista'],
    ['Lo dejé andando, no me corresponde la parte de agua', true, '—'],
    ['Quedó a medias, tienen que coordinar con un techista', true, 'techista'],
    ['Reemplacé la cerradura. Hasta acá llegué, lo demás es del herrero', true, 'herrero'],
    ['Destapé el caño principal pero habría que conseguir un plomero matriculado para el resto', true, 'plomero'],

    // Trabajos que SÍ quedaron terminados: no deben abrir nada ni molestar al administrador.
    ['Cambié el portero eléctrico del hall, quedó funcionando perfecto', false, '—'],
    ['Cambié las térmicas del tablero y revisé todo el circuito', false, '—'],
    ['Listo el trabajo, todo funcionando', false, '—'],
    ['Reparé la bomba de agua y la dejé andando sin ruido', false, '—'],
];

for (const [texto, esperado, gremioEsp] of casos) {
    const r = Boolean(quedoPorLaMitad(texto));
    verificar(
        `${r ? 'INCOMPLETO' : 'terminado  '} — ${JSON.stringify(texto.slice(0, 58))}`,
        r, esperado
    );
    if (r && esperado) {
        verificar(`   └ gremio detectado: ${gremioQueFalta(texto)}`, gremioQueFalta(texto), gremioEsp);
    }
}

console.log('\n── LA NOTA QUE SE GUARDA ──');

// La nota legible conserva lo que la persona escribió; solo se le sacan los rellenos que agrega
// WhatsApp cuando el adjunto viene sin epígrafe.
const notaLegible = t => String(t || '')
    .replace(/\((?:imagen|documento|comprobante|video|nota de voz)[^)]*\)/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

verificar(
    'saca el relleno del adjunto y deja el texto de la persona',
    notaLegible('(Documento adjunto: fac_88.pdf) hay que llamar al plomero, yo hasta acá llegué'),
    'hay que llamar al plomero, yo hasta acá llegué'
);
verificar(
    'un adjunto sin nada escrito no deja nota',
    notaLegible('(Documento adjunto: factura_1234.pdf)'),
    ''
);
verificar(
    'respeta la puntuación (es la constancia textual)',
    notaLegible('Cambié la bomba. Falta el electricista para el tablero.'),
    'Cambié la bomba. Falta el electricista para el tablero.'
);

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
