// Verifica a qué caso se le imputa una factura, y cuándo hay que preguntar en vez de adivinar.
//
//   node pruebas-factura-a-que-caso.js
//
// POR QUÉ. Visto en el chat real de Daniel: mandó dos facturas distintas, con números distintos,
// de trabajos distintos, y Marcos contestó las dos veces "la dejé asociada al CASO-1001". En el
// panel los dos montos aparecían sumados en el mismo consorcio.
//
// La regla vieja decía: "si el técnico tiene UN solo caso reciente, la factura es de ese caso".
// Para la primera factura está bien. Para la segunda es una adivinanza, y con un técnico que
// trabaja para once administradores está garantizado que se equivoque: manda seis comprobantes de
// obras distintas y los seis terminan pegados al mismo caso.
//
// Que el caso YA tenga su factura es la señal de que la siguiente es de otro trabajo.

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

/**
 * La decisión tal como la toma index.js con un único caso candidato.
 * Devuelve el caso al que se imputa, o null si hay que preguntar.
 */
async function decidir({ casoReciente, yaTieneFactura }) {
    if (!casoReciente) return null;
    if (yaTieneFactura) return null;      // es de otro trabajo: se pregunta
    return casoReciente.id_evento;
}

(async () => {

console.log('\n── LA PRIMERA FACTURA DE UN CASO ──');
{
    const caso = { id_evento: 'CASO-1001', edificio: 'san patricio casa', cerrado: true };
    verificar('se imputa sola, sin molestar al técnico',
        await decidir({ casoReciente: caso, yaTieneFactura: false }), 'CASO-1001');
}

console.log('\n── LA SEGUNDA FACTURA NO SE PEGA AL MISMO CASO ──');
{
    // Este es el caso del chat: dos comprobantes distintos, los dos al CASO-1001.
    const caso = { id_evento: 'CASO-1001', edificio: 'san patricio casa', cerrado: true };
    verificar('se pregunta en vez de adivinar',
        await decidir({ casoReciente: caso, yaTieneFactura: true }), null);
}

console.log('\n── SIN NINGÚN CASO RECIENTE ──');
{
    verificar('tampoco se inventa nada', await decidir({ casoReciente: null, yaTieneFactura: false }), null);
}

console.log('\n── QUE EL CASO ESTÉ CERRADO NO CAMBIA NADA ──');
{
    // El caso normal es justamente ese: el trabajo termina, el caso se cierra, y la factura llega
    // una semana después. Cerrado no significa "no acepto su factura".
    const caso = { id_evento: 'CASO-1001', edificio: 'san patricio casa', cerrado: true };
    verificar('un caso cerrado sin factura la recibe igual',
        await decidir({ casoReciente: caso, yaTieneFactura: false }), 'CASO-1001');
}

// ── LA MISMA FACTURA DOS VECES ──────────────────────────────────────────────────────────────
//
// Se carga la deduplicación del propio sheets.js para validar el código real.
console.log('\n── LA MISMA FACTURA MANDADA DOS VECES ──');
{
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');

    const ini = SRC.indexOf("const numeroComparable = (n) =>");
    if (ini === -1) throw new Error('No encontré la deduplicación de facturas en sheets.js.');
    const marca = '        }\n';
    const fin = SRC.indexOf('\n        await sheet.addRow({', ini);
    const cuerpo = SRC.slice(ini, fin);

    // Una planilla de mentira con una factura ya cargada.
    const yaCargadas = [
        { numero_factura: '0001-00000284', proveedor: 'Dario Juju', edificio: 'san patricio casa', id_evento: 'CASO-1001', fecha: '26/8' },
    ];
    const hoja = { getRows: async () => yaCargadas.map(f => ({ get: (k) => f[k] ?? '' })) };

    const correr = async (numero_factura, proveedor) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function('numero_factura', 'proveedor', 'sheet', 'console',
            `return (async () => { ${cuerpo}; return null; })();`);
        return fn(numero_factura, proveedor, hoja, { log() {} });
    };

    const mismo = await correr('0001-00000284', 'Dario Juju');
    verificar('la reconoce y no la duplica', mismo?.duplicada, true);
    verificar('y dice dónde quedó cargada', mismo?.edificio, 'san patricio casa');
    verificar('con el caso', mismo?.id_evento, 'CASO-1001');

    // El mismo número escrito distinto es el mismo comprobante.
    const otroFormato = await correr('00001-00000284', 'dario juju');
    verificar('el mismo número escrito distinto también', otroFormato?.duplicada, true);

    // Una factura nueva pasa.
    const nueva = await correr('0001-00000653', 'Dario Juju');
    verificar('una factura distinta sí se registra', nueva, null);

    // Otro proveedor con el mismo número: son dos facturas distintas.
    const otroProv = await correr('0001-00000284', 'Julio');
    verificar('mismo número pero otro proveedor: se registra', otroProv, null);

    // Sin número no se puede afirmar nada: perder una factura es peor que tener dos.
    const sinNumero = await correr('', 'Dario Juju');
    verificar('sin número de comprobante no se bloquea', sinNumero, null);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);

})();
