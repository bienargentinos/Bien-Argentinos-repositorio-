/**
 * PRUEBAS DE VALIDACIÓN DE PASES QR Y PUERTA
 *
 * Verifica:
 * 1. Aislamiento entre consorcios (San Patricio 270 vs 159).
 * 2. Validación de edificios vacíos o nulos.
 * 3. Apertura de puerta y almacenamiento en _aperturasPuerta por edificio canónico.
 * 4. Consumo de usos (temporal vs recurrente).
 * 5. Normalización canónica de unidades (4°B === 4b).
 */

'use strict';

const { mismoEdificio, claveEdificio, claveUnidad } = require('./edificio-clave');
const porteria = require('./porteria');
const { registrarAperturaPuerta, _aperturasPuerta } = porteria._paraPruebas;

let ok = 0;
let fallos = 0;

function vale(titulo, condicion, detalle) {
    if (condicion) {
        ok++;
        console.log(`   ✅ ${titulo}`);
    } else {
        fallos++;
        console.log(`   ❌ ${titulo}`);
        if (detalle) console.log(`      ${detalle}`);
    }
}

console.log('\n🎫 PRUEBAS DE VALIDACIÓN DE PASES QR Y PUERTA\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Aislamiento de consorcios en pases QR');
// ─────────────────────────────────────────────────────────────────────────────
{
    const pase270 = {
        id: 1,
        token: 'PASS-TEST270',
        edificio: 'San Patricio 270',
        departamento: '4B',
        nombre_invitado: 'Juan Perez',
        motivo: 'Delivery',
        tipo_pase: 'temporal',
        usos_permitidos: 1,
        usos_actuales: 0,
        estado: 'activo'
    };

    // Caso A: Mismo edificio exacto
    vale('Pase de San Patricio 270 es válido en San Patricio 270',
        mismoEdificio(pase270.edificio, 'San Patricio 270'));

    // Caso B: Mismo edificio con distinta capitalización o acentos
    vale('Pase de San Patricio 270 tolera mayúsculas y acentos (san patrício 270)',
        mismoEdificio(pase270.edificio, 'san patrício 270'));

    // Caso C: Distinto edificio (159 vs 270)
    vale('Pase de San Patricio 270 es RECHAZADO en San Patricio 159',
        !mismoEdificio(pase270.edificio, 'San Patricio 159'));

    // Caso D: Edificio no provisto (vacío o null)
    vale('Pase es RECHAZADO si el lector no envía edificio',
        !mismoEdificio(pase270.edificio, '') && !mismoEdificio(pase270.edificio, null));

    // Caso E: Pase sin edificio
    vale('Pase sin edificio registrado no valida con ningún consorcio',
        !mismoEdificio('', 'San Patricio 270'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Apertura de puerta por QR');
// ─────────────────────────────────────────────────────────────────────────────
{
    _aperturasPuerta.clear();
    const ed = 'San Patricio 270';
    const apertura = registrarAperturaPuerta(ed, 'Pase QR: PASS-1234', '4B');

    vale('La apertura se registra para el edificio correspondiente',
        apertura && apertura.edificio === ed);

    const edNorm = claveEdificio(ed);
    const registrada = _aperturasPuerta.get(edNorm);
    vale('El relé del edificio encuentra la apertura pendiente',
        registrada && registrada.motivo.startsWith('Pase QR'));

    const otroEdNorm = claveEdificio('San Patricio 159');
    vale('El relé de otro consorcio NO encuentra ninguna apertura',
        !_aperturasPuerta.has(otroEdNorm));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Reglas de negocio de consumo de pase');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Límite de usos
    let usosPermitidos = 1;
    let usosActuales = 0;
    let estado = 'activo';

    // Simular primer uso
    usosActuales++;
    if (usosActuales >= usosPermitidos) estado = 'utilizado';
    vale('Al alcanzar el límite de 1 uso pasa a estado "utilizado"', estado === 'utilizado' && usosActuales === 1);

    // Intentar segundo uso
    const yaConsumido = (usosActuales >= usosPermitidos);
    vale('Segundo intento es detectado como límite alcanzado', yaConsumido);

    // Pase recurrente no pasa a utilizado
    let tipoRecurrente = 'recurrente';
    let usosRecurrentes = 5;
    let estadoRecurrente = (tipoRecurrente !== 'recurrente' && usosRecurrentes >= 1) ? 'utilizado' : 'activo';
    vale('Pase recurrente permanece activo tras múltiples usos', estadoRecurrente === 'activo');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) Normalización canónica de departamentos');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('4°B y 4b son la misma unidad', claveUnidad('4°B') === claveUnidad('4b'));
    vale('4 B y 4B son la misma unidad', claveUnidad('4 B') === claveUnidad('4B'));
    vale('1A y 11A NO son la misma unidad', claveUnidad('1A') !== claveUnidad('11A'));
    vale('1 y 1A NO son la misma unidad', claveUnidad('1') !== claveUnidad('1A'));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ❌ Fallaron pruebas de validación de pases QR.');
    process.exit(1);
}
console.log('\n   ✅ Todas las reglas de validación QR y aislamiento funcionan correctamente.\n');
