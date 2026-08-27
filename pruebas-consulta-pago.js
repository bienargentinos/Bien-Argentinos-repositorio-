// Verifica qué mensaje de un proveedor es una consulta de plata y cuál no.
//
//   node pruebas-consulta-pago.js
//
// POR QUÉ. La rama de consulta de pago corta antes que todo lo demás: si un mensaje cae ahí, no
// abre caso, no registra el reclamo y no llega a ningún otro camino. Marcos contesta la lista de
// facturas y listo.
//
// El caso real: Daniel escribió que había que ver una CÁMARA en San Patricio 270 y Marcos le
// contestó "tenés N facturas pendientes de pago". El detector decía:
//
//     /pag|cobr|abon/i.test(txtLow)
//
// sin límite de palabra. Y una cámara que no anda es, casi siempre, una cámara **aPAGada**. Para
// un electricista "se apagó" es la mitad de lo que dice en un día -- y `cobr` matchea **"cobre"**,
// el metal, que es la otra mitad.
//
// La condición se lee del propio index.js para que la prueba valide el código real y no una copia.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const ini = SRC.indexOf('const esConsultaPago = parecePreguntaSinAdjunto && (');
if (ini === -1) throw new Error('No encontré esConsultaPago en index.js.');
const fin = SRC.indexOf('        );', ini);
if (fin === -1) throw new Error('No encontré el final de esConsultaPago en index.js.');
const cuerpo = SRC.slice(ini, fin + '        );'.length);

// eslint-disable-next-line no-new-func
const evaluar = new Function('parecePreguntaSinAdjunto', 'txtLow', `${cuerpo}; return esConsultaPago;`);

// La otra mitad de la condición: sin `?` ni palabra de pregunta, nada de esto se activa. Se copia
// tal cual de index.js para probar el gesto completo.
const pareceP = (t) => /\?|qui[eé]n|c[oó]mo|cu[aá]ndo|d[oó]nde|puedo|debo|hay que/i.test(t.toLowerCase());
const esConsultaPago = (texto) => evaluar(pareceP(texto), texto.toLowerCase());

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${esperado}, dio ${real}`);
}

console.log('\n── LO QUE SÍ ES UNA PREGUNTA DE PLATA ──');
{
    const si = [
        '¿ya me pagaron la factura 284?',
        'hola, ¿cuándo cobro lo de San Patricio?',
        '¿me abonaron el trabajo del hall?',
        '¿me depositaron ya?',
        '¿cuándo me transfieren?',
        '¿me acreditaron la factura?',
        'quién me tiene que pagar esto?',
        'hay que ver si ya cobré lo del 270',
    ];
    for (const t of si) verificar(`"${t}"`, esConsultaPago(t), true);
}

console.log('\n── EL CASO REAL QUE LO DESTAPÓ ──');
{
    // Todo esto contenía "pag" adentro de "apagada"/"apagó"/"apagón" y caía en la rama de plata.
    const no = [
        'hay que ver una cámara apagada en san patricio 270',
        '¿cómo puede ser que la cámara del hall esté apagada?',
        'hay que revisar por qué se apagó el tablero del 2do',
        '¿cuándo pasó el apagón en el edificio?',
        'hay que ver las luces del pasillo que se apagan solas',
    ];
    for (const t of no) verificar(`"${t}"`, esConsultaPago(t), false);
}

console.log('\n── COBRAR, ESCRITO COMO SE ESCRIBE ──');
{
    // Se había excluido "cobre" (el metal) de la condición. Daniel lo corrigió: "no decimos cable
    // de cobre casi nunca -- cable es cable, no hay otro que no sea de cobre". El falso positivo
    // era imaginario y la exclusión sí costaba caro: en WhatsApp la tilde no se pone.
    verificar('"¿ya cobre lo del 159?" (sin tilde, como se escribe)',
        esConsultaPago('¿ya cobre lo del 159?'), true);
    verificar('"¿ya cobré lo del 159?"', esConsultaPago('¿ya cobré lo del 159?'), true);
    verificar('"¿cuándo cobran los proveedores?"', esConsultaPago('¿cuándo cobran los proveedores?'), true);
    verificar('"¿cuándo cobro?"', esConsultaPago('¿cuándo cobro?'), true);
}

console.log('\n── LA OTRA RAMA QUE SE COMÍA EL MISMO MENSAJE ──');
{
    // `esSolicitudDatos` es para cuando el técnico le pide a Marcos que le saque más información
    // al vecino. Tenía `ver` suelto y `cerradura` suelta: apenas se arreglaba lo del pago, "hay
    // que VER una cámara" se iba por acá, que es igual de equivocado.
    const iniB = SRC.indexOf('const esSolicitudDatos = ');
    if (iniB === -1) throw new Error('No encontré esSolicitudDatos en index.js.');
    const finB = SRC.indexOf(';', iniB);
    const cuerpoB = SRC.slice(iniB, finB + 1);
    // eslint-disable-next-line no-new-func
    const evalB = new Function('txtLow', `${cuerpoB}; return esSolicitudDatos;`);
    const esSolicitudDatos = (t) => evalB(t.toLowerCase());

    verificar('"hay que ver una cámara en san patricio 270" NO es un pedido de datos',
        esSolicitudDatos('hay que ver una cámara en san patricio 270'), false);
    verificar('"a ver si paso mañana" tampoco',
        esSolicitudDatos('a ver si paso mañana'), false);
    verificar('"la verdad que no pude ir" tampoco',
        esSolicitudDatos('la verdad que no pude ir'), false);
    verificar('"cambié la cerradura magnética del acceso" tampoco',
        esSolicitudDatos('cambié la cerradura magnética del acceso'), false);

    // Y lo que SÍ es un pedido sigue siéndolo.
    verificar('"necesito ver la cerradura de cerca"',
        esSolicitudDatos('necesito ver la cerradura de cerca'), true);
    verificar('"pedile una foto al vecino"',
        esSolicitudDatos('pedile una foto al vecino'), true);
    verificar('"mandame más datos del problema"',
        esSolicitudDatos('mandame más datos del problema'), true);
    verificar('"¿puedo ver el video?"', esSolicitudDatos('¿puedo ver el video?'), true);
}

console.log('\n── SIN PREGUNTA NO SE ACTIVA NADA ──');
{
    // La rama exige que parezca una pregunta. Un aviso no es una consulta de plata aunque nombre
    // una factura -- y esto es lo que deja pasar el aviso del proveedor al camino que le toca.
    verificar('"te mando la factura del trabajo de ayer"',
        esConsultaPago('te mando la factura del trabajo de ayer'), false);
    verificar('"me llamó el encargado del 159, voy a pasar"',
        esConsultaPago('me llamó el encargado del 159, voy a pasar'), false);
}

console.log('\n── "DEPÓSITO" ES TAMBIÉN EL CUARTITO ──');
{
    verificar('"¿quién tiene la llave del depósito?"',
        esConsultaPago('¿quién tiene la llave del depósito?'), false);
    verificar('"¿me depositaron?"', esConsultaPago('¿me depositaron?'), true);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
