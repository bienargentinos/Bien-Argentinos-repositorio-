// Verifica a qué teléfono le llega el aviso cuando alguien toca un timbre.
//
//   node pruebas-timbre-destino.js
//
// > [!CAUTION]
// > **`departamento.includes('1')` matchea 1°A, 1°B, 11°C y 21°D.**
//
// Lo que había era esto, con un número escrito en el código:
//
//     const tel = vecino?.telefono || (departamento.includes('1') ? '+5491150542005' : null);
//
// En una prueba con un solo departamento pasa desapercibido. En un edificio real, TODOS los
// timbres de las unidades que tuvieran un uno --que son un montón-- le habrían llegado al mismo
// teléfono. Y como el número estaba en el código, cambiarlo obligaba a tocar el repo y desplegar.
//
// Ahora sale del .env con la unidad EXACTA:
//
//     TIMBRE_PRUEBA=1A:5491150542005:Daniel Morales,1B:5491112345678
//
// Es un andamio para probar sin cargar el padrón. En cuanto el vecino está en la tabla `vecinos`,
// gana el padrón y esto no se usa más.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'porteria.js'), 'utf8');

// Se extrae la decisión real de porteria.js para que la prueba no valide una copia.
const ini = SRC.indexOf("const deptoNorm = String(departamento || '')");
if (ini === -1) throw new Error('No encontré la elección del teléfono en porteria.js.');
const marca = "                 : (dePrueba ? dePrueba.nombre : ('Vecino del ' + departamento));";
const fin = SRC.indexOf(marca, ini);
if (fin === -1) throw new Error('No encontré el final del bloque en porteria.js.');
const cuerpo = SRC.slice(ini, fin + marca.length);

// eslint-disable-next-line no-new-func
const decidir = new Function('departamento', 'vecino', 'process',
    `${cuerpo}; return { tel, nombre };`);

const conEnv = (valor) => ({ env: { TIMBRE_PRUEBA: valor } });

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

const PRUEBA = '1A:5491150542005:Daniel Morales,1B:5491112345678:Vecina de prueba';

console.log('\n── CADA UNIDAD A SU TELÉFONO ──');
{
    verificar('1°A va al primer número',
        decidir('1° A', null, conEnv(PRUEBA)).tel, '5491150542005');
    verificar('1°B va al SEGUNDO número',
        decidir('1° B', null, conEnv(PRUEBA)).tel, '5491112345678');
    verificar('y cada uno con su nombre',
        decidir('1° B', null, conEnv(PRUEBA)).nombre, 'Vecina de prueba');
}

console.log('\n── LA UNIDAD SE COMPARA ENTERA, NO "SI CONTIENE UN 1" ──');
{
    // Este es el bug. Con `includes('1')`, los cuatro caían en el mismo teléfono.
    verificar('11°C no es 1°A', decidir('11° C', null, conEnv(PRUEBA)).tel, null);
    verificar('21°D tampoco', decidir('21° D', null, conEnv(PRUEBA)).tel, null);
    verificar('1°C tampoco (no está en la lista)', decidir('1° C', null, conEnv(PRUEBA)).tel, null);
    verificar('2°A tampoco', decidir('2° A', null, conEnv(PRUEBA)).tel, null);
}

console.log('\n── DA IGUAL CÓMO SE ESCRIBA LA UNIDAD ──');
{
    // El frente del timbre puede mandar "1A", "1° A", "1º-A"… y el .env estar escrito distinto.
    for (const escrito of ['1A', '1° A', '1º-A', '1 a', '1°a']) {
        verificar(`"${escrito}" resuelve al mismo teléfono`,
            decidir(escrito, null, conEnv(PRUEBA)).tel, '5491150542005');
    }
}

console.log('\n── EL PADRÓN LE GANA AL NÚMERO DE PRUEBA ──');
{
    // En cuanto el vecino está cargado de verdad, el andamio no se usa.
    const delPadron = { telefono: '5491199999999', nombre: 'Marta Gómez' };
    verificar('gana el teléfono del padrón',
        decidir('1° A', delPadron, conEnv(PRUEBA)).tel, '5491199999999');
    verificar('y su nombre',
        decidir('1° A', delPadron, conEnv(PRUEBA)).nombre, 'Marta Gómez');
}

console.log('\n── SIN NADA CONFIGURADO, NO SE LE ESCRIBE A NADIE ──');
{
    // Mejor que no salga el WhatsApp a que salga al teléfono equivocado.
    verificar('sin TIMBRE_PRUEBA, no hay teléfono',
        decidir('1° A', null, { env: {} }).tel, null);
    verificar('y el nombre queda genérico',
        decidir('1° A', null, { env: {} }).nombre, 'Vecino del 1° A');

    // Una entrada mal escrita se saltea en vez de romper todo.
    verificar('una entrada sin teléfono se ignora',
        decidir('1° A', null, conEnv('1A,1B:549111')).tel, null);
    verificar('pero las otras siguen funcionando',
        decidir('1° B', null, conEnv('1A,1B:549111')).tel, '549111');
}

console.log('\n── QUE EL NÚMERO NO VUELVA AL CÓDIGO ──');
{
    // Un teléfono escrito en el código es un teléfono que alguien va a olvidar sacar.
    const sinComentarios = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    verificar('no hay ningún teléfono argentino hardcodeado en porteria.js',
        /['"`]\+?549\d{8,}['"`]/.test(sinComentarios), false);
    verificar('y la unidad ya no se compara con includes',
        /departamento\.includes\(/.test(sinComentarios), false);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
