// Verifica que el filtro de permisos de /api/facturas no le muestre a un cliente las facturas
// de un edificio de OTRO administrador.
//
// El riesgo es concreto: los importes de los gastos de un consorcio no pueden verse desde la
// cuenta de otra administración. Y con nombres cargados a mano ("San Patricio" en una ficha,
// "SAN PATRICIO 270" en otra) es fácil que una comparación tolerante los confunda.
//
//   node pruebas-permisos-facturas.js

const fs = require('fs');
const path = require('path');

// La tabla `edificios` de mentira. Dos administradores distintos, con nombres parecidos a
// propósito: es el caso que hace fallar una comparación por "contiene".
const EDIFICIOS = [
    { edificio: 'SAN PATRICIO 159', direccion: 'San Patricio 159', aliases: 'san patricio casa, sanpatricio159' },
    { edificio: 'SAN PATRICIO 270', direccion: 'San Patricio 270', aliases: '' },          // ← de OTRO administrador
    { edificio: 'Av. Rivadavia 2200', direccion: 'Rivadavia 2200', aliases: 'rivadavia' },
    { edificio: 'Torre Belgrano', direccion: 'Belgrano 1450', aliases: '' },
];

// Se carga la función real de dashboard.js, sin levantar el panel entero.
const SRC = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');

function sacarFuncion(nombre) {
    const marca = `async function ${nombre}(`;
    const i = SRC.indexOf(marca) !== -1 ? SRC.indexOf(marca) : SRC.indexOf(`function ${nombre}(`);
    if (i === -1) throw new Error(`No encontré ${nombre} en dashboard.js.`);
    let d = 0, fin = -1, empezo = false;
    for (let k = i; k < SRC.length; k++) {
        if (SRC[k] === '{') { d++; empezo = true; }
        else if (SRC[k] === '}') { d--; if (empezo && d === 0) { fin = k + 1; break; } }
    }
    return SRC.slice(i, fin);
}

const cuerpo = `
${sacarFuncion('normEdificio')}
${sacarFuncion('expandirEdificiosPermitidos')}
return { normEdificio, expandirEdificiosPermitidos };
`;
// eslint-disable-next-line no-new-func
const { expandirEdificiosPermitidos } = new Function('queryPg', 'console', cuerpo)(
    async () => ({ rows: EDIFICIOS }),
    console
);

// Reproduce lo que hace el SQL: marcos_norm(f.edificio) = ANY(marcos_norm(x) for x in formas)
function veLaFactura(formas, edificioDeLaFactura) {
    const norm = t => String(t || '')
        .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
        .toLowerCase().trim();
    const set = new Set(formas.map(norm));
    return set.has(norm(edificioDeLaFactura));
}

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${esperado}, dio ${real}`);
}

(async () => {
    console.log('\n── UN CLIENTE CON EL NOMBRE CORTO ("San Patricio") ──');
    // Este es el caso peligroso: "San Patricio" está contenido en los dos edificios.
    const formasCorto = await expandirEdificiosPermitidos(['San Patricio']);
    console.log('  formas permitidas:', JSON.stringify(formasCorto));

    verificar('NO ve la factura del edificio del otro administrador (SAN PATRICIO 270)',
        veLaFactura(formasCorto, 'SAN PATRICIO 270'), false);
    verificar('tampoco ve la del 159, porque el nombre era ambiguo (se estrecha, no se ensancha)',
        veLaFactura(formasCorto, 'SAN PATRICIO 159'), false);

    console.log('\n── UN CLIENTE CON EL NOMBRE COMPLETO ("SAN PATRICIO 159") ──');
    const formas159 = await expandirEdificiosPermitidos(['SAN PATRICIO 159']);
    console.log('  formas permitidas:', JSON.stringify(formas159));

    verificar('ve su propia factura', veLaFactura(formas159, 'SAN PATRICIO 159'), true);
    verificar('ve la factura cargada con la variante en minúscula', veLaFactura(formas159, 'san patricio 159'), true);
    verificar('ve la factura cargada con un ALIAS ("san patricio casa")',
        veLaFactura(formas159, 'san patricio casa'), true);
    verificar('ve la factura cargada con la dirección', veLaFactura(formas159, 'San Patricio 159'), true);
    verificar('NO ve la del 270 (otro administrador)', veLaFactura(formas159, 'SAN PATRICIO 270'), false);
    verificar('NO ve la de Rivadavia', veLaFactura(formas159, 'Av. Rivadavia 2200'), false);

    console.log('\n── UN CLIENTE CON VARIOS EDIFICIOS ──');
    const formasVarios = await expandirEdificiosPermitidos(['SAN PATRICIO 159', 'Torre Belgrano']);
    verificar('ve las de sus dos edificios (1)', veLaFactura(formasVarios, 'SAN PATRICIO 159'), true);
    verificar('ve las de sus dos edificios (2)', veLaFactura(formasVarios, 'Torre Belgrano'), true);
    verificar('ve la de su segundo edificio por dirección', veLaFactura(formasVarios, 'Belgrano 1450'), true);
    verificar('sigue sin ver la del 270', veLaFactura(formasVarios, 'SAN PATRICIO 270'), false);

    console.log('\n── CASOS BORDE ──');
    verificar('lista vacía no habilita nada', (await expandirEdificiosPermitidos([])).length, 0);
    const conVacios = await expandirEdificiosPermitidos(['', '   ', 'Torre Belgrano']);
    verificar('un nombre vacío no se cuela como comodín', veLaFactura(conVacios, 'SAN PATRICIO 270'), false);
    verificar('y el edificio real sigue funcionando', veLaFactura(conVacios, 'Torre Belgrano'), true);

    console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
    process.exit(fallos === 0 ? 0 : 1);
})();
