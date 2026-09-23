/**
 * EL PANEL Y EL MOTOR TIENEN QUE OFRECER LOS MISMOS RUBROS
 *
 * > [!CAUTION]
 * > **Había dos listas de rubros y nada las obligaba a coincidir.**
 *
 * `dashboard.js` ofrecía esto, y es lo que el administrador podía elegir al cargar un proveedor:
 *
 *     ['Plomero', 'Gasista', 'Electricista', 'Ascensores', 'Cerrajero', 'Pintor', 'Limpieza',
 *      'Seguridad', 'Otro']
 *
 * **Sin CCTV, sin portería y sin control de acceso** — tres rubros que el motor distingue desde
 * hace rato, a propósito, y con el motivo escrito en `rubros.js`:
 *
 * > *"Las de corriente débil van SEPARADAS de electricidad y separadas entre sí. Son trabajos
 * > distintos aunque los haga el mismo electricista: cambiar un portero no es poner una cámara
 * > ni configurar tarjetas de acceso."*
 *
 * Lo que rompía es justo el caso de Daniel: *"soy electricista primero y urgencias, CCTV urgencias
 * y primero también"*. Para un trabajo de cámaras tenía que elegir "Otro" o "Electricista", y con
 * el rubro cargado así se pierde exactamente lo que el rubro existe para dar: separar un reclamo
 * nuevo del abierto, y elegir a quién llamar por `edificio + rubro`.
 *
 * Ahora la lista vive en `rubros.js`, al lado de las familias, y el panel la importa. Este archivo
 * es el candado: **toda familia tiene que tener su entrada en la lista**. Agregar una familia nueva
 * al motor y olvidarse del panel deja esto en rojo.
 *
 *     node pruebas-rubros.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { FAMILIAS, RUBROS_CATALOGO, coincideRubro, atiendeRubro } = require('./rubros');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n🔧 EL PANEL Y EL MOTOR TIENEN QUE OFRECER LOS MISMOS RUBROS\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Toda familia se puede elegir desde el panel');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Esta es la prueba que importa: si el motor sabe distinguir un oficio y el panel no lo
    // ofrece, ese oficio se carga como "Otro" y la distinción no sirve de nada.
    for (const familia of FAMILIAS) {
        const elegibles = RUBROS_CATALOGO.filter(r => coincideRubro(r, familia[0]));
        vale(`la familia "${familia[0]}…" se puede elegir (${elegibles.join(', ') || 'NINGUNA'})`,
            elegibles.length >= 1,
            'El motor distingue este oficio y el administrador no lo puede cargar: va a quedar "Otro".');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Y cada opción cae en una sola familia, no en dos');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Una opción que matchea dos familias haría que dos trabajos distintos se lean como el mismo,
    // que es justo lo que las familias vinieron a separar.
    for (const rubro of RUBROS_CATALOGO) {
        const familias = FAMILIAS.filter(f => coincideRubro(rubro, f[0]));
        vale(`"${rubro}" no es ambiguo`, familias.length <= 1,
            `Cae en ${familias.length} familias: ${familias.map(f => f[0]).join(' / ')}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) El caso de Daniel, que es el que originó esto');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('`CCTV` está en la lista', RUBROS_CATALOGO.includes('CCTV'));
    vale('`Portería` también', RUBROS_CATALOGO.includes('Portería'));
    vale('`Control de acceso` también', RUBROS_CATALOGO.includes('Control de acceso'));

    // Y lo que de verdad hace falta: que una ficha con varios rubros los reconozca sueltos.
    const suFicha = 'Electricista, CCTV, Control de acceso';
    vale('una ficha multi-rubro atiende un trabajo de cámaras', atiendeRubro(suFicha, 'cámara del palier'));
    vale('…y uno de electricidad', atiendeRubro(suFicha, 'se cortó la luz del pasillo'));
    vale('…y uno de tarjetas', atiendeRubro(suFicha, 'no anda el molinete'));

    // Pero NO lo que no hace: si no lo tiene cargado, no se lo llama.
    vale('y NO atiende una pérdida de agua', !atiendeRubro(suFicha, 'pérdida de agua en la cocina'),
        'Llamar al electricista por una canilla es peor que no llamar a nadie.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3b) El portón del edificio no es la cerradura de un departamento');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Daniel, sobre el chip del portal del vecino que decía "Cerrajería":
    //
    //   "saca el texto de cerrajero, confunde: la cerrajería en general es más del propietario
    //    que del consorcio"
    //
    // Y tenía razón por partida doble. El portón de entrada lo abre un motor con control remoto
    // o teclado --control de acceso, del consorcio--; la cerradura de la puerta de un
    // departamento es cerrajería y la paga el propietario. Ofrecerle "Cerrajería" a un vecino
    // para un problema del edificio manda el reclamo al rubro equivocado.
    //
    // Y abajo había algo peor: `portón` no estaba en NINGUNA pista.
    const { rubroDelTexto } = require('./rubros');

    vale('"no abre el portón de entrada" ya no queda sin rubro',
        rubroDelTexto('no abre el portón de entrada') === 'control de acceso',
        `Dio: "${rubroDelTexto('no abre el portón de entrada')}". Un caso sin rubro no se puede ` +
        'separar de otro ni sirve para elegir a quién llamar.');

    vale('…y sin tilde también', rubroDelTexto('el porton no cierra') === 'control de acceso');

    // La exclusión: `herrería` va DESPUÉS en la lista, así que sin cuidado se la lleva puesta.
    vale('pero el portón DE HIERRO sigue siendo del herrero',
        rubroDelTexto('el portón de hierro está oxidado') === 'herrería',
        'Control de acceso va antes en la lista: sin la exclusión se queda con todos los portones.');

    // Y lo que el chip dejó de decir: la cerrajería de verdad no se movió.
    vale('la cerradura de un depto sigue siendo cerrajería',
        rubroDelTexto('se trabó la cerradura de mi depto') === 'cerrajería');
    vale('y las llaves también', rubroDelTexto('perdí las llaves') === 'cerrajería');

    // El portón no es el portero: son dos trabajos distintos aunque los haga el mismo.
    vale('el portero eléctrico sigue siendo portería',
        rubroDelTexto('no anda el portero eléctrico') === 'portería');
    vale('un portón NO es portería', !coincideRubro('portón', 'portería'));
    vale('un portón NO es cerrajería', !coincideRubro('portón', 'cerrajería'));
    vale('un portón SÍ es control de acceso', coincideRubro('portón', 'control de acceso'));

    // Lo que manda el portal del vecino cuando el vecino toca ese chip.
    vale('el chip del portal cae en control de acceso',
        rubroDelTexto('Portón / Control de acceso') === 'control de acceso');

    const portal = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');
    vale('y el portal ya no le ofrece "Cerrajería" al vecino',
        !/seleccionarRubro\(\s*['"]Cerrajer/i.test(portal),
        'Es un rubro del propietario, no del consorcio.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El panel usa ESTA lista, no una propia');
// ─────────────────────────────────────────────────────────────────────────────
{
    const dash = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
    const soloCodigo = dash
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    vale('`RUBROS_PROVEEDOR` sale de `rubros.js`',
        /RUBROS_PROVEEDOR\s*=\s*require\(['"]\.\/rubros['"]\)\.RUBROS_CATALOGO/.test(soloCodigo),
        'Si vuelve a ser una lista escrita a mano, se separan otra vez y nadie se entera.');

    vale('y no quedó una segunda lista escrita a mano',
        !/RUBROS_PROVEEDOR\s*=\s*\[/.test(soloCodigo));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Nada de lo de antes se rompió');
// ─────────────────────────────────────────────────────────────────────────────
{
    // `familias` era una constante local adentro de `coincideRubro` y pasó a vivir afuera.
    // Estas son las equivalencias que ya estaban documentadas y tienen que seguir igual.
    vale('electricidad = electricista = luz',
        coincideRubro('electricidad', 'electricista') && coincideRubro('Electricista', 'se cortó la luz'));
    vale('plomería ≠ electricidad', !coincideRubro('plomería', 'electricidad'));
    vale('portero eléctrico NO es electricidad', !coincideRubro('portería', 'electricidad'));
    vale('CCTV NO es control de acceso', !coincideRubro('CCTV', 'control de acceso'));
    vale('con uno vacío no se afirma nada', !coincideRubro('', 'electricidad'));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Un rubro que el panel no ofrece se carga como "Otro", y ahí se pierde.\n');
    process.exit(1);
}
console.log('\n   🔧 Una sola lista, y el panel la usa.\n');
