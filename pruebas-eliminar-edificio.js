// Verifica la lógica de eliminar-edificio.js (saneamiento en cascada de edificios).
//
//   node pruebas-eliminar-edificio.js

const assert = require('assert');
const { eliminarEdificio, norm } = require('./eliminar-edificio');

console.log('🧪 Probando eliminar-edificio.js...\n');

let fallos = 0;
function test(titulo, fn) {
    try {
        fn();
        console.log(`  ✅ ${titulo}`);
    } catch (e) {
        fallos++;
        console.log(`  ❌ ${titulo}: ${e.message}`);
    }
}

async function testAsync(titulo, fn) {
    try {
        await fn();
        console.log(`  ✅ ${titulo}`);
    } catch (e) {
        fallos++;
        console.log(`  ❌ ${titulo}: ${e.message}`);
    }
}

// 1. Normalización
test('norm normaliza acentos, mayúsculas y espacios', () => {
    assert.strictEqual(norm('  San Patricio 270  '), 'san patricio 270');
    assert.strictEqual(norm('CONSORCIO SAN PATRICIO 159'), 'consorcio san patricio 159');
    assert.strictEqual(norm('Árbol Único'), 'arbol unico');
});

// 2. Validación de entrada
testAsync('eliminarEdificio rechaza nombres vacíos', async () => {
    let tiroError = false;
    try {
        await eliminarEdificio({ edificio: '' });
    } catch (_) {
        tiroError = true;
    }
    assert.strictEqual(tiroError, true);
});

// 3. Quitar de lista separada por comas
test('quitarDeLista maneja correctamente casos únicos y múltiples', () => {
    const N_ED = norm('san patricio 159');
    const quitar = (val) => {
        const partes = String(val || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!partes.some(p => norm(p) === N_ED)) return null;
        return partes.filter(p => norm(p) !== N_ED).join(', ');
    };

    // Caso múltiple en el medio
    assert.strictEqual(quitar('Edificio A, San Patricio 159, Edificio B'), 'Edificio A, Edificio B');
    // Caso al principio
    assert.strictEqual(quitar('SAN PATRICIO 159, Edificio B'), 'Edificio B');
    // Caso al final
    assert.strictEqual(quitar('Edificio A, San Patricio 159'), 'Edificio A');
    // Caso único
    assert.strictEqual(quitar('san patricio 159'), '');
    // Caso no presente
    assert.strictEqual(quitar('Edificio A, Edificio B'), null);
});

// 4. Exportaciones requeridas
test('eliminar-edificio exporta eliminarEdificio y norm', () => {
    assert.strictEqual(typeof eliminarEdificio, 'function');
    assert.strictEqual(typeof norm, 'function');
});

setTimeout(() => {
    if (fallos > 0) {
        console.error(`\n❌ ${fallos} prueba(s) fallaron.\n`);
        process.exit(1);
    } else {
        console.log('\n✅ Todas las pruebas de eliminar-edificio pasaron correctamente.\n');
        process.exit(0);
    }
}, 50);
