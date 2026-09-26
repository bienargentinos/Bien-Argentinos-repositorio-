/**
 * QUIÉN PUEDE ABRIR LA PUERTA DE CALLE DESDE EL CELULAR
 *
 * > [!CAUTION]
 * > **Un portero de pared se aprieta desde adentro del departamento. Un celular se aprieta desde
 * > cualquier parte del mundo.** Es la misma acción con el mismo nombre y no es la misma cosa.
 *
 * Lo que esta prueba cuida, en orden de gravedad:
 *
 * 1. Que **sin sesión no se abra nada**. `getVecinoSession` de `portal-vecino.js` devuelve un
 *    vecino de prueba --propietario del 1°A de San Patricio 159-- cuando no hay sesión. Para el
 *    portal de demostración está bien; acá significaría que cualquiera abre la puerta.
 * 2. Que **un vecino del 159 no abra el 270**, aunque lo pida en el cuerpo del mensaje.
 * 3. Que en modo `con_llamada` **no se abra sin timbre sonando**, que es lo que reemplaza al
 *    "estoy en mi casa" del portero de toda la vida.
 * 4. Que un edificio **sin configurar no caiga en el modo más permisivo**.
 *
 *     node pruebas-apertura-remota.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
    sesionVecinoEstricta, modoDelEdificio, unidadDelVecino, puedeAbrir, MODO_POR_DEFECTO,
} = require('./apertura-remota');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

const VECINO = {
    usuario_id: 7,
    nombre: 'Natalia',
    edificio: 'San Patricio 270',
    departamento: '4B',
    rol: 'propietario',
    unidades: [
        { edificio: 'San Patricio 270', departamento: '4B', rol: 'propietario' },
        { edificio: 'Rivadavia 1200', departamento: '2A', rol: 'inquilino' },
    ],
};

const timbre = (edificio, depto, extra = {}) => ({
    id: 'ring_1', edificio, departamento: depto, estado: 'llamando', ...extra,
});

console.log('\n🚪 QUIÉN PUEDE ABRIR LA PUERTA DE CALLE DESDE EL CELULAR\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Sin sesión no se abre nada');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('sin req, no hay vecino', sesionVecinoEstricta(undefined) === null);
    vale('sin session, no hay vecino', sesionVecinoEstricta({}) === null);
    vale('con session vacía, no hay vecino', sesionVecinoEstricta({ session: {} }) === null);
    vale('con un vecino sin usuario_id, no vale',
        sesionVecinoEstricta({ session: { vecino: { edificio: 'San Patricio 270' } } }) === null,
        'Un objeto a medias no es una identidad.');
    vale('con un vecino sin edificio, no vale',
        sesionVecinoEstricta({ session: { vecino: { usuario_id: 7 } } }) === null);

    vale('con sesión de verdad, sí',
        sesionVecinoEstricta({ session: { vecino: VECINO } }) === VECINO);

    // La consecuencia, que es lo que importa:
    vale('sin vecino, `puedeAbrir` dice que no',
        puedeAbrir({ vecino: null, modo: 'siempre' }).permitido === false,
        'Ni siquiera en el modo más permisivo.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Un vecino abre SU edificio, no el de al lado');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('abre el suyo (modo siempre)',
        puedeAbrir({ vecino: VECINO, modo: 'siempre' }).permitido === true);

    vale('NO abre San Patricio 159 aunque lo pida',
        puedeAbrir({ vecino: VECINO, modo: 'siempre', edificioPedido: 'San Patricio 159' }).permitido === false,
        'Es el error que deja entrar a alguien a otro consorcio.');

    vale('sí abre su OTRA unidad, en otro edificio',
        puedeAbrir({ vecino: VECINO, modo: 'siempre', edificioPedido: 'Rivadavia 1200', unidadPedida: '2A' }).permitido === true,
        'Un vecino puede tener unidades en varios edificios.');

    vale('NO abre una unidad que no es suya en un edificio que sí',
        puedeAbrir({ vecino: VECINO, modo: 'siempre', edificioPedido: 'San Patricio 270', unidadPedida: '9Z' }).permitido === false);

    const r = puedeAbrir({ vecino: VECINO, modo: 'siempre' });
    vale('devuelve el edificio y la unidad que se van a usar',
        r.edificio === 'San Patricio 270' && r.unidad === '4B',
        'El llamador no tiene que volver a decidirlo: ya está resuelto acá.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Modo `con_llamada`: solo mientras suena el timbre');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('con el timbre sonando en su unidad, abre',
        puedeAbrir({ vecino: VECINO, modo: 'con_llamada', llamada: timbre('San Patricio 270', '4B') }).permitido === true);

    vale('SIN timbre sonando, no abre',
        puedeAbrir({ vecino: VECINO, modo: 'con_llamada', llamada: null }).permitido === false,
        'Es lo que reemplaza al "estoy en mi casa" del portero de pared.');

    vale('con un timbre de OTRA unidad, no abre',
        puedeAbrir({ vecino: VECINO, modo: 'con_llamada', llamada: timbre('San Patricio 270', '2C') }).permitido === false);

    vale('con un timbre de OTRO edificio, no abre',
        puedeAbrir({ vecino: VECINO, modo: 'con_llamada', llamada: timbre('San Patricio 159', '4B') }).permitido === false);

    vale('con la llamada ya cortada, no abre',
        puedeAbrir({ vecino: VECINO, modo: 'con_llamada', llamada: timbre('San Patricio 270', '4B', { estado: 'cortado' }) }).permitido === false);

    vale('una sola apertura por llamada',
        puedeAbrir({ vecino: VECINO, modo: 'con_llamada', llamada: timbre('San Patricio 270', '4B', { abrioLaPuerta: true }) }).permitido === false,
        'Si ya abrió, el botón de ese timbre se apaga.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) Modo `siempre`: sin timbre, porque miró la cámara');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('abre sin ningún timbre sonando',
        puedeAbrir({ vecino: VECINO, modo: 'siempre', llamada: null }).permitido === true,
        'El caso de Daniel: "a veces se abre viendo la cámara sin llamar".');

    vale('pero sigue sin poder abrir otro edificio',
        puedeAbrir({ vecino: VECINO, modo: 'siempre', edificioPedido: 'San Patricio 159' }).permitido === false);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) Modo `off`, y qué pasa cuando no hay configuración');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('en off no abre ni con el timbre sonando',
        puedeAbrir({ vecino: VECINO, modo: 'off', llamada: timbre('San Patricio 270', '4B') }).permitido === false);

    vale('sin perfil cargado, el modo es `con_llamada`',
        modoDelEdificio(null) === MODO_POR_DEFECTO && MODO_POR_DEFECTO === 'con_llamada',
        'Un edificio del que no sabemos nada NO autorizó la apertura sin timbre.');

    vale('con una basura en la columna, tampoco cae en `siempre`',
        modoDelEdificio({ apertura_remota: 'cualquier cosa' }) === 'con_llamada');

    vale('lee `siempre`', modoDelEdificio({ apertura_remota: 'siempre' }) === 'siempre');
    vale('lee `off`', modoDelEdificio({ apertura_remota: 'off' }) === 'off');
    vale('tolera cómo lo escribe una persona: "SI"', modoDelEdificio({ apertura_remota: 'SI' }) === 'siempre');
    vale('tolera "no"', modoDelEdificio({ apertura_remota: 'no' }) === 'off');
    vale('tolera "con llamada" con espacio', modoDelEdificio({ apertura_remota: 'con llamada' }) === 'con_llamada');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6) CANDADO: el vecino de prueba no puede entrar por acá');
// ─────────────────────────────────────────────────────────────────────────────
{
    const politica = fs.readFileSync(path.join(__dirname, 'apertura-remota.js'), 'utf8');
    const porteria = fs.readFileSync(path.join(__dirname, 'porteria.js'), 'utf8');

    // Los dos archivos NOMBRAN `getVecinoSession` en sus comentarios, a propósito: explicar por qué
    // no se usa es la mitad del valor de haberlo evitado. El candado mira el CÓDIGO.
    const soloCodigo = (txt) => txt
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    const codigoPolitica = soloCodigo(politica);
    const codigoPorteria = soloCodigo(porteria);

    vale('la política no usa `getVecinoSession`',
        !/getVecinoSession/.test(codigoPolitica),
        'Devuelve un propietario de prueba cuando no hay sesión. Acá eso abre la puerta.');

    vale('el endpoint de apertura tampoco',
        !/getVecinoSession/.test(codigoPorteria));

    vale('`porteria.js` usa la sesión estricta',
        /sesionVecinoEstricta/.test(porteria));

    vale('la decisión no se reescribe adentro del endpoint',
        /puedeAbrir\(/.test(porteria) && !/req\.session\.vecino\s*\|\|/.test(codigoPorteria),
        'Para eso está el módulo. Escrita dos veces, arreglar una copia no cambia producción.');

    // El endpoint viejo sigue abierto a propósito (es el laboratorio del timbre), pero el nuevo
    // no puede volverse otro igual.
    vale('el endpoint del vecino exige sesión antes de hacer nada',
        /abrir-vecino[\s\S]{0,900}?sesionVecinoEstricta\(req\)[\s\S]{0,300}?status\(401\)/.test(porteria),
        'El 401 tiene que estar antes de leer el edificio o registrar nada.');

    vale('la apertura se registra en eventos_acceso',
        /abrir-vecino[\s\S]{0,4000}?registrarEventoAcceso/.test(porteria),
        'Cuando pregunten quién dejó entrar a alguien, la respuesta tiene que existir.');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Esto decide quién puede abrir la puerta de calle de un edificio.\n');
    process.exit(1);
}
console.log('\n   🚪 Abre el vecino, en su edificio, y queda escrito.\n');
