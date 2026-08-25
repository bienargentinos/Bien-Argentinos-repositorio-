// Verifica de quién es cada edificio en el panel.
//
//   node pruebas-cliente-edificio.js
//
// POR QUÉ. La lista `edificios` del cliente (tab CLIENTES) y el nombre del edificio (tab
// EDIFICIOS) son dos textos escritos a mano en pestañas distintas. `Array.includes` exige que
// sean idénticos carácter por carácter: una mayúscula, un espacio de más o un acento distinto y
// el panel muestra "Sin asignar" un edificio que en la planilla figura al lado del administrador.
//
// Pasó con "san patricio 270": Alejandra lo tenía asignado en CLIENTES, el panel se lo mostraba
// suelto, le contaba 2 edificios en vez de 3, y no había ninguna pantalla para arreglarlo.
//
// La otra mitad de la prueba es igual de importante: la comparación tiene que seguir siendo
// EXACTA después de normalizar. Si se afloja a coincidencias parciales, el 159 queda asignado al
// cliente que tiene el 270 -- o sea, un administrador viendo los reclamos de un consorcio ajeno.
//
// La lógica se carga del propio dashboard.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');

function extraer(firma) {
    const i = SRC.indexOf(firma);
    if (i === -1) throw new Error(`No encontré ${firma} en dashboard.js.`);
    let d = 0, empezo = false;
    for (let k = SRC.indexOf('{', i + firma.length - 1); k < SRC.length; k++) {
        if (SRC[k] === '{') { d++; empezo = true; }
        else if (SRC[k] === '}') { d--; if (empezo && d === 0) return SRC.slice(i, k + 1); }
    }
    throw new Error(`No pude cerrar ${firma}.`);
}

const fuente = [
    extraer('function normEdificio('),
    extraer('function clienteDelEdificio('),
    extraer('function edificiosDeCliente('),
].join('\n');

// eslint-disable-next-line no-new-func
const { clienteDelEdificio, edificiosDeCliente } = new Function(
    `${fuente}; return { clienteDelEdificio, edificiosDeCliente };`
)();

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

const alejandra = {
    nombre: 'Alejandra', usuario: 'alejandra',
    edificios: ['San Patricio 159', 'san patricio 270 casa', 'Los Álamos'],
};
const amato = { nombre: 'Amato', usuario: 'amato', edificios: ['Rivadavia 1200'] };
const clientes = [alejandra, amato];

console.log('\n── LA MAYÚSCULA NO CAMBIA DE QUIÉN ES ──');
{
    verificar('escrito distinto, mismo edificio',
        (clienteDelEdificio(clientes, 'SAN PATRICIO 270 CASA') || {}).nombre, 'Alejandra');
    verificar('con espacios de más',
        (clienteDelEdificio(clientes, '  san patricio 270 casa  ') || {}).nombre, 'Alejandra');
    verificar('con el acento escrito distinto',
        (clienteDelEdificio(clientes, 'los alamos') || {}).nombre, 'Alejandra');
}

console.log('\n── UN EDIFICIO DE OTRO ADMINISTRADOR NO SE MEZCLA ──');
{
    verificar('el de Amato es de Amato',
        (clienteDelEdificio(clientes, 'Rivadavia 1200') || {}).nombre, 'Amato');
    verificar('uno que no es de nadie queda sin asignar',
        clienteDelEdificio(clientes, 'Cabildo 4000'), null);
}

console.log('\n── LA COMPARACIÓN SIGUE SIENDO EXACTA ──');
{
    // Esto es lo que NO puede pasar: que por parecerse, el 159 caiga bajo el que tiene el 270.
    const soloEl270 = [{ nombre: 'Solo270', usuario: 's270', edificios: ['san patricio 270'] }];
    verificar('"san patricio" suelto no le pertenece a nadie',
        clienteDelEdificio(soloEl270, 'san patricio'), null);
    verificar('"san patricio 159" tampoco',
        clienteDelEdificio(soloEl270, 'san patricio 159'), null);
    verificar('"san patricio 270 casa" tampoco (es otro edificio)',
        clienteDelEdificio(soloEl270, 'san patricio 270 casa'), null);
}

console.log('\n── LA FICHA DEL ADMINISTRADOR LOS MUESTRA A TODOS ──');
{
    const todos = [
        { nombre: 'san patricio 159' },
        { nombre: 'SAN PATRICIO 270 CASA' },   // escrito distinto que en CLIENTES
        { nombre: 'Los Alamos' },              // sin el acento
        { nombre: 'Rivadavia 1200' },
        { nombre: 'Cabildo 4000' },
    ];
    const suyos = edificiosDeCliente(todos, alejandra).map(e => e.nombre);
    verificar('le aparecen los 3, no 2', suyos.length, 3);
    verificar('cuáles son', suyos, ['san patricio 159', 'SAN PATRICIO 270 CASA', 'Los Alamos']);

    verificar('los de Amato no se le cuelan', edificiosDeCliente(todos, amato).map(e => e.nombre), ['Rivadavia 1200']);
}

console.log('\n── CASOS VACÍOS ──');
{
    verificar('un cliente sin edificios', edificiosDeCliente([{ nombre: 'x' }], { edificios: [] }), []);
    verificar('sin cliente', edificiosDeCliente([{ nombre: 'x' }], null), []);
    verificar('un nombre vacío no matchea con nadie', clienteDelEdificio(clientes, ''), null);
    verificar('una celda vacía en la lista tampoco', clienteDelEdificio([{ nombre: 'Z', edificios: ['', '  '] }], ''), null);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
