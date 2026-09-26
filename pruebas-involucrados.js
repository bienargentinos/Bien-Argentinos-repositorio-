// Verifica la regla: TODO número que participa de un caso queda registrado en el caso.
//
//   node pruebas-involucrados.js
//
// POR QUÉ: si el administrador tiene una duda sobre un trabajo o un monto, tiene que poder ver
// a quién llamarle sin salir a buscar el número por otro lado. Antes solo se guardaba el
// teléfono del vecino -- el del técnico viajaba en otro campo y no entraba a la lista, así que
// en un caso donde intervinieron tres personas figuraba una sola.
//
// La lógica se carga del propio sheets.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');

// Se extrae `sumarInvolucrado` tal como está en guardarReporte.
const i = SRC.indexOf('const sumarInvolucrado = ');
if (i === -1) throw new Error('No encontré sumarInvolucrado en sheets.js.');
let d = 0, fin = -1, empezo = false;
for (let k = i; k < SRC.length; k++) {
    if (SRC[k] === '{') { d++; empezo = true; }
    else if (SRC[k] === '}') { d--; if (empezo && d === 0) { fin = k + 1; break; } }
}
const cuerpo = SRC.slice(i, fin) + ';';

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

function nuevaLista() {
    const involucradosLista = [];
    // eslint-disable-next-line no-new-func
    const sumar = new Function('involucradosLista', 'fechaHoraAR',
        `${cuerpo}; return sumarInvolucrado;`)(involucradosLista, () => '18/08/2026 21:00');
    return { involucradosLista, sumar };
}

console.log('\n── UN CASO CON VECINO Y TÉCNICO ──');
{
    const { involucradosLista, sumar } = nuevaLista();
    sumar('5491150542005', 'Daniel Valdez', 'vecino', '1A');
    sumar('541169241157', 'dario juju', 'técnico (electricidad)');

    verificar('quedan los DOS números, no uno', involucradosLista.length, 2);
    verificar('el vecino con su departamento', involucradosLista[0].depto, '1A');
    verificar('el técnico con su papel y rubro', involucradosLista[1].rol, 'técnico (electricidad)');
    verificar('el número del técnico está', involucradosLista[1].telefono, '541169241157');
}

console.log('\n── NO SE DUPLICA ──');
{
    const { involucradosLista, sumar } = nuevaLista();
    sumar('5491150542005', 'Daniel', 'vecino');
    sumar('5491150542005', 'Daniel Valdez', 'vecino');
    verificar('el mismo número una sola vez', involucradosLista.length, 1);

    // El mismo número escrito distinto (con y sin el 9, con +54) es la misma persona.
    sumar('+54 9 11 5054-2005', 'Daniel', 'vecino');
    verificar('escrito de otra forma tampoco duplica', involucradosLista.length, 1);
}

console.log('\n── LO QUE NO ES UN TELÉFONO ──');
{
    const { involucradosLista, sumar } = nuevaLista();
    sumar('', 'Nadie', 'vecino');
    sumar(null, 'Nadie', 'vecino');
    sumar('123', 'Corto', 'vecino');
    sumar('   ', 'Vacío', 'vecino');
    verificar('no se anota nada', involucradosLista.length, 0);
}

console.log('\n── UN CASO QUE PASA POR VARIAS MANOS ──');
{
    const { involucradosLista, sumar } = nuevaLista();
    sumar('5491150542005', 'Daniel Valdez', 'vecino', '1A');
    sumar('541169241157', 'dario juju', 'técnico (electricidad)');
    sumar('541155667788', 'Julio', 'técnico (plomería)');
    sumar('541144556677', 'Roberto', 'encargado');

    verificar('quedan los cuatro', involucradosLista.length, 4);
    verificar('con quién es cada uno',
        involucradosLista.map(x => x.rol),
        ['vecino', 'técnico (electricidad)', 'técnico (plomería)', 'encargado']);
    verificar('todos tienen fecha', involucradosLista.every(x => Boolean(x.fecha)), true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
