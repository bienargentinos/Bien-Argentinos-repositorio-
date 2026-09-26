/**
 * "NO NECESITO ESA LLAVE, NECESITO QUE ALGUIEN ESTÉ AHÍ"
 *
 * > [!CAUTION]
 * > **Los dos errores de esta prueba terminan igual: el técnico parado en la puerta.**
 *
 * Prueba de producción del 20/09/2026, CASO-1004. Dos cosas distintas, el mismo final:
 *
 *     16:41  Marcos: "te abre chechuliso (11111111111)"
 *     16:48  Dario:  "no necesito esa llave solo necesito que alguien esté ahí para abrirme"
 *     16:50  Marcos: "Perfecto que tengas acceso, entonces no te gestiono nada para entrar."
 *
 * 1. **Once unos pasaron por teléfono.** El control era `length >= 10`, escrito cuando el relleno
 *    de la ficha era `12345667` --demasiado corto--. Un relleno con la longitud justa entraba sin
 *    despeinarse, y Marcos se lo afirmó con toda seguridad.
 *
 * 2. **"No necesito esa llave" se leyó como "entro solo".** La frase dice dos cosas y la regla
 *    leía la primera mitad. Dos minutos antes él había escrito *"si no hay nadie no voy"*.
 *
 *     node pruebas-quien-le-abre.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { telefonoUsable, tieneAccesoPropio, pideQueLeAbran } = require('./contacto-ingreso');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n🚪 "NO NECESITO ESA LLAVE, NECESITO QUE ALGUIEN ESTÉ AHÍ"\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Un relleno de ficha no es un teléfono, tenga el largo que tenga');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('`11111111111` NO se entrega (el caso real)', !telefonoUsable('11111111111'),
        'Once unos, y pasaba el piso de 10 dígitos.');

    for (const relleno of ['0000000000', '5555555555', '1111111111', '99999999999', '2222222222']) {
        vale(`\`${relleno}\` tampoco`, !telefonoUsable(relleno));
    }

    vale('`1234567890` no (el dedo corrido por el teclado)', !telefonoUsable('1234567890'));
    vale('`0987654321` tampoco, al revés', !telefonoUsable('0987654321'));

    vale('`12345667` sigue afuera (el caso anterior, muy corto)', !telefonoUsable('12345667'));
    vale('vacío o basura, afuera', !telefonoUsable('') && !telefonoUsable('no tiene'));

    vale('nada más largo que E.164 (15 dígitos)', !telefonoUsable('1234567890123456'));

    // Y del otro lado: los números de verdad tienen que seguir pasando, escritos como se escriben.
    const reales = [
        '5491167350436',            // el de Natalia, tal cual está en la planilla
        '541169241157',             // la línea compartida de Julio y Dario
        '1167350436',               // sin prefijo
        '+54 9 11 6735-0436',       // con separadores, como lo pega una persona
        '011 4567-8901',
    ];
    for (const tel of reales) {
        vale(`\`${tel}\` sí se puede discar`, telefonoUsable(tel));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Pedir que alguien lo espere no es entrar solo');
// ─────────────────────────────────────────────────────────────────────────────
{
    // La frase exacta del chat. Es la que importa.
    const exacta = 'no necesito esa llave solo necesito que alguien esté ahí para abrirme';
    vale('la frase del CASO-1004 NO marca acceso propio', !tieneAccesoPropio(exacta),
        'Marcos contestó "perfecto que tengas acceso, entonces no te gestiono nada".');
    vale('y se reconoce como un pedido de que le abran', pideQueLeAbran(exacta));

    const pedidos = [
        'si no hay nadie no voy',
        'necesito que alguien me espere en la puerta',
        'necesito que alguien esté',
        'que me abran por favor',
        'tiene que haber alguien porque no tengo llave',
        'necesito una persona que me reciba',
        'q alguien me abra',
        'mandame a alguien para abrirme',
        'no necesito la llave pero si que me esperen',
    ];
    for (const p of pedidos) {
        vale(`"${p}" → NO entra solo`, !tieneAccesoPropio(p));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Y el que SÍ dijo que entra solo, sigue entrando solo');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Este es el arreglo anterior, y no se puede romper al arreglar este: mandarle el contacto
    // del encargado a alguien que acaba de decir que tiene llave le enseña que no lo leen.
    const solos = [
        'no, tengo llave y acceso al sistema',
        'tengo llave, en 2 horas estaría llegando',
        'tengo el código de la puerta',
        'entro solo, no te preocupes',
        'no hace falta nada, tengo tarjeta',
        'manejo el sistema, no necesito que me abran... ',
    ];
    for (const s of solos.slice(0, 5)) {
        vale(`"${s}" → entra solo`, tieneAccesoPropio(s));
    }

    // Y la negación de siempre: "NO tengo llave" contiene "tengo llave".
    for (const n of ['no tengo llave', 'no tengo el código', 'no cuento con acceso']) {
        vale(`"${n}" → NO entra solo`, !tieneAccesoPropio(n));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El ruteo por IA tampoco puede pisar un pedido explícito');
// ─────────────────────────────────────────────────────────────────────────────
{
    // `entraSolo` del ruteo va aparte de la intención justamente porque un mensaje dice dos
    // cosas. Eso está bien; lo que no puede es ganarle a "necesito que alguien esté ahí".
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const linea = (cod.match(/const entraSolo = [\s\S]{0,200}?;/) || [])[0] || '';

    vale('`entraSolo` en index.js pasa por `pideQueLeAbran`',
        /pideQueLeAbran/.test(linea),
        `Quedó: ${linea.replace(/\s+/g, ' ').slice(0, 140)}`);

    vale('y el veto va ANTES del `||` del ruteo',
        /!pideQueLeAbran\([^)]*\)\s*&&/.test(linea),
        'Si va después, `ruteoIA?.entraSolo === true` vuelve a ganar.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Preguntar quién le abre no borra la hora que dijo');
// ─────────────────────────────────────────────────────────────────────────────
{
    //     16:39  Dario:  "Llegaré en 2 hs para revisar el problema. Quien me abre?"
    //     17:04  Marcos → al vecino: "confirmó la visita, pero aún no precisó la hora exacta"
    //
    // El ruteo devuelve UNA intención. Eligió `pide_contacto_de_ingreso` --que es verdad-- y con
    // eso `confirma_que_va` quedó en false, así que nadie escribió `tecnico_eta`.
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

    // La rama se recorta contando llaves y no con una expresión: un `}` a la altura justa aparece
    // mucho antes del final, y con eso el candado miraba diez líneas y daba por ausente algo que
    // estaba escrito. Una prueba que falla con el código bien es peor que no tenerla.
    const rama = (() => {
        const desde = cod.indexOf('if (pideQuienLeAbre) {');
        if (desde === -1) return '';
        let nivel = 0;
        for (let i = cod.indexOf('{', desde); i < cod.length; i++) {
            if (cod[i] === '{') nivel++;
            else if (cod[i] === '}' && --nivel === 0) return cod.slice(desde, i + 1);
        }
        return '';
    })();

    vale('la rama de "¿quién me abre?" existe', rama.length > 0);

    vale('y anota la hora si el mensaje la trae',
        /guardarConfirmacionTecnico\(\{[\s\S]{0,120}?id_evento: casoIngreso/.test(rama),
        'Sin esto, el vecino escucha "todavía no precisó la hora" con la hora ya dicha.');

    vale('solo si de verdad dijo una (no se inventa)',
        /if \(eta\)/.test(rama),
        'Una hora inventada es peor que no tener ninguna: el vecino la espera.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) Al técnico se le habla por dirección, también en la factura');
// ─────────────────────────────────────────────────────────────────────────────
{
    // > La dejé asociada al CASO-1004 de san patricio casa
    //
    // `san patricio casa` es un alias nuestro. El técnico estuvo en una calle y una altura.
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

    vale('se resuelve la dirección una vez, antes de armar las respuestas',
        /const dirFactura = edificioFactura[\s\S]{0,200}?direccionParaTecnico\(edificioFactura\)/.test(cod));

    vale('"La dejé asociada al CASO-x de …" usa la dirección',
        /La dej[ée] asociada al \*\$\{idCasoFactura\}\* de \$\{dirFactura\}/.test(cod));

    // El candado: ninguna respuesta AL TÉCNICO puede volver a interpolar el nombre interno.
    // Se miran solo las plantillas que se le mandan, no los logs ni los mails a la Administración
    // --ahí el nombre interno es el que usa el panel y está bien--.
    const respuestas = cod.split('\n')
        .filter(l => /respExtra\s*=/.test(l) || /respDup\s*=/.test(l))
        .filter(l => /\$\{edificioFactura\}/.test(l));

    vale('ninguna respuesta al técnico interpola `edificioFactura` crudo',
        respuestas.length === 0,
        respuestas.map(l => '   ' + l.trim().slice(0, 110)).join('\n'));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Los dos errores terminan con el técnico parado en la puerta.\n');
    process.exit(1);
}
console.log('\n   🚪 No se afirma un teléfono que no existe, ni que entra solo quien pidió que le abran.\n');
