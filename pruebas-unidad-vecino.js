// Verifica a quién le corresponde que Marcos le pida el número de unidad, y cómo lo llama.
//
//   node pruebas-unidad-vecino.js
//
// POR QUÉ. Donde hay una sola vivienda no existe el número de departamento: pedírselo al vecino es
// pedirle un dato que no puede dar, la ficha no se completa nunca y Marcos vuelve a preguntar lo
// mismo en cada vuelta.
//
// Pero adivinarlo por el NOMBRE del edificio da al revés. "san patricio casa" se llama así --es un
// alias interno nuestro-- y tiene 3 unidades: ahí sí hay que preguntar. El que decide es el conteo
// de unidades de la tab `edificios`, no cómo lo bautizamos.
//
// La lógica se carga del propio marcos-cara.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'agentes', 'marcos-cara.js'), 'utf8');

const ini = SRC.indexOf('const tipoEdif = ');
if (ini === -1) throw new Error('No encontré el bloque de la unidad en marcos-cara.js.');
const marcaFin = 'vecino.departamento === \'—\');';
const fin = SRC.indexOf(marcaFin, ini);
if (fin === -1) throw new Error('No encontré el final del bloque (faltaDepto) en marcos-cara.js.');
const cuerpo = SRC.slice(ini, fin + marcaFin.length);

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

function evaluar(perfilEdificio, vecino) {
    // eslint-disable-next-line no-new-func
    return new Function('perfilEdificio', 'vecino',
        `${cuerpo}; return { faltaDepto, esUnidadUnica, comoSeLlamaLaUnidad };`
    )(perfilEdificio, vecino);
}

const sinDepto = { departamento: '' };

console.log('\n── UNA CASA CON VARIAS UNIDADES: SÍ SE PREGUNTA ──');
{
    // El caso que falló: el alias dice "casa" y tiene 3 unidades.
    const r = evaluar({ tipo: 'casa', unidades: '3' }, { ...sinDepto, edificio: 'san patricio casa' });
    verificar('se le pregunta la unidad', r.faltaDepto, true);
    verificar('no se la trata como vivienda única', r.esUnidadUnica, false);
    verificar('pero no se le dice "departamento"', r.comoSeLlamaLaUnidad, 'número de unidad');
}

console.log('\n── UNA CASA DE UNA SOLA UNIDAD: NO SE PREGUNTA ──');
{
    const r = evaluar({ tipo: 'casa', unidades: '1' }, { ...sinDepto, edificio: 'los alamos casa' });
    verificar('no se le pregunta nada', r.faltaDepto, false);
    verificar('es vivienda única', r.esUnidadUnica, true);
}

console.log('\n── EL NOMBRE NO DECIDE ──');
{
    // Un edificio de 40 unidades que en la planilla se llama "casa blanca": el nombre no cambia
    // que ahí adentro haya 40 departamentos.
    const r = evaluar({ tipo: 'edificio', unidades: '40' }, { ...sinDepto, edificio: 'casa blanca' });
    verificar('se le pregunta el departamento', r.faltaDepto, true);
    verificar('y se lo llama departamento', r.comoSeLlamaLaUnidad, 'número de departamento');
}

console.log('\n── UN EDIFICIO NORMAL ──');
{
    const r = evaluar({ tipo: 'edificio', unidades: '27' }, sinDepto);
    verificar('se le pregunta', r.faltaDepto, true);
    verificar('se lo llama departamento', r.comoSeLlamaLaUnidad, 'número de departamento');
}

console.log('\n── SIN CONTEO DE UNIDADES CARGADO ──');
{
    // La columna `unidades` está vacía en muchos edificios todavía. Ahí lo único que hay es el
    // tipo, y se usa ese.
    const casa = evaluar({ tipo: 'PH', unidades: '' }, sinDepto);
    verificar('un PH sin conteo: no se pregunta', casa.faltaDepto, false);

    const edif = evaluar({ tipo: 'edificio', unidades: '' }, sinDepto);
    verificar('un edificio sin conteo: sí se pregunta', edif.faltaDepto, true);

    const nada = evaluar(null, sinDepto);
    verificar('sin ficha del edificio: se pregunta igual', nada.faltaDepto, true);
}

console.log('\n── EL QUE YA TIENE UNIDAD CARGADA ──');
{
    const r = evaluar({ tipo: 'edificio', unidades: '27' }, { departamento: '4B' });
    verificar('no se le vuelve a preguntar', r.faltaDepto, false);

    // Un guion en la celda es "no tiene", no un dato.
    const guion = evaluar({ tipo: 'edificio', unidades: '27' }, { departamento: '—' });
    verificar('un guion no cuenta como unidad cargada', guion.faltaDepto, true);
}

console.log('\n── UN CONTEO ESCRITO A MANO ──');
{
    // En la planilla lo cargan como les sale: "3 unidades", "27 deptos".
    verificar('"3 unidades" son 3', evaluar({ tipo: 'casa', unidades: '3 unidades' }, sinDepto).faltaDepto, true);
    verificar('"1 unidad" es 1', evaluar({ tipo: 'casa', unidades: '1 unidad' }, sinDepto).faltaDepto, false);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
