// Verifica cuándo el aviso de un proveedor abre un caso.
//
//   node pruebas-aviso-proveedor.js
//
// POR QUÉ. "Me llamó el encargado de San Patricio 159, voy a pasar a ver la puerta."
//
// Eso es lo que el técnico le decía al administrador por teléfono ANTES de que existiera Marcos, y
// es justo el momento que Marcos viene a reemplazar. Si el administrador deja de atender el
// teléfono, ese aviso tiene que quedar en algún lado -- sin esto, el trabajo aparece recién con la
// factura, días después, y nadie sabía que se estaba haciendo.
//
// Un reclamo no lo abre solo el vecino: el encargado, la limpieza, la seguridad y el propio
// administrador ya podían (caen al camino común de un reclamo). El proveedor era el único que no,
// porque su rama del webhook corta antes de llegar ahí.
//
// La lógica se carga del propio index.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const ini = SRC.indexOf('const avisaQueVa = ');
if (ini === -1) throw new Error('No encontré la detección del aviso en index.js.');
const marca = "|| /\\b(aviso que|te aviso que|les aviso que)\\b/i.test(txtLow);";
const fin = SRC.indexOf(marca, ini);
if (fin === -1) throw new Error('No encontré el final de la detección en index.js.');
const cuerpo = SRC.slice(ini, fin + marca.length);

// eslint-disable-next-line no-new-func
const avisa = new Function('txtLow', `${cuerpo}; return avisaQueVa;`);

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

const dice = (t) => avisa(t.toLowerCase());

console.log('\n── LO QUE SÍ ES UN AVISO ──');
{
    verificar('lo llamó el encargado', dice('Me llamó el encargado de San Patricio 159, voy a pasar'), true);
    verificar('lo llamaron, en plural', dice('Me llamaron de San Patricio 159 por la puerta'), true);
    verificar('le pidieron que vaya', dice('Me pidieron que pase por el 159 a ver la cerradura'), true);
    verificar('le avisaron', dice('Me avisaron que hay una pérdida en San Patricio 270'), true);
    verificar('avisa que va', dice('Voy a pasar por San Patricio 159 esta tarde'), true);
    verificar('ya está yendo', dice('Estoy yendo a San Patricio 270'), true);
    verificar('sale para allá', dice('Salgo para San Patricio 159'), true);
    verificar('lo anuncia', dice('Aviso que voy a ir al 270 mañana'), true);
    verificar('va más tarde', dice('Paso más tarde por San Patricio 159'), true);
}

console.log('\n── LO QUE NO ES UN AVISO ──');
{
    // Estos ya tienen su propio camino y no deben abrir un caso nuevo.
    verificar('confirmar una visita ya asignada', dice('Ok llegó en 45 min'), false);
    verificar('avisar que ya lo resolvió', dice('Hola ya resolví, quedó funcionando'), false);
    verificar('mandar la factura', dice('Esta es la factura'), false);
    verificar('preguntar por un pago', dice('¿Ya me pagaron la factura 284?'), false);
    verificar('un saludo', dice('Buenas, cómo va'), false);
    verificar('estar en la puerta', dice('Llegué, no me abren'), false);
    verificar('pedir el contacto', dice('Pasame el teléfono del vecino'), false);
}

console.log('\n── LOS CASOS DUDOSOS QUE MÁS IMPORTAN ──');
{
    // "Me llamó" cubre también "me llamó el vecino": está bien, es el mismo caso -- alguien lo
    // convocó por fuera del sistema y va a ir.
    verificar('lo llamó el vecino directamente', dice('Me llamó el vecino del 3B, voy mañana'), true);

    // Una respuesta al seguimiento NO es un aviso nuevo.
    verificar('"sí, ya pasé" no es un aviso', dice('Sí, ya pasé y lo arreglé'), false);
    verificar('"no llegué a ir" tampoco', dice('No llegué a ir, lo reprogramamos'), false);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
