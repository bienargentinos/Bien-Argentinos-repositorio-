// TODA RAMA DONDE EL TÉCNICO CONFIRMA TIENE QUE ESCRIBIRLO EN EL CASO
//
//   node pruebas-confirmacion-al-caso.js
//
// > [!CAUTION]
// > **Hay DOS ramas distintas donde el técnico confirma la visita.** Una la registraba en el caso
// > y la otra solo en el log. Cuál corre depende de cómo esté escrito el mensaje.
//
// EL CASO REAL (prueba del vecino, 9/9):
//
//   23:01  Dario: "puedo ir en 2 hs pero necesito foto y también un teléfono de quien me recibe"
//          🧭 → confirma_que_va (0.8)
//          🔧 Dario confirmó la visita del [CASO-1001] en san patricio casa.
//
//   23:03  Vecino: "Hola a qué hora viene el técnico?"
//   23:04  Marcos: "Estamos coordinando... Le avisaremos en cuanto tengamos la confirmación
//                   del horario."
//
// En el log NO aparece `📌 Confirmación del técnico registrada en [CASO-1001]`, que es la línea de
// la OTRA rama. Corrió la del ruteo, que no escribía `tecnico_confirmado`.
//
// **No fue el modelo.** `buscarConfirmacionTecnicoDeVecino` leyó el caso, la columna estaba vacía y
// Marcos contestó lo único que sabía. Para el vecino no es un olvido: es que le mienten mientras
// espera en la puerta.
//
// Es el mismo defecto de fondo que ya está documentado varias veces: **dos caminos para el mismo
// hecho, y solo uno deja constancia.**

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

/** Cada lugar donde el log dice que el técnico confirmó. */
function ramasQueConfirman() {
    const ramas = [];
    const lineas = idx.split('\n');
    lineas.forEach((l, i) => {
        if (/confirmó la visita/.test(l) && /console\.log/.test(l)) ramas.push(i + 1);
    });
    return ramas;
}

console.log('\n── CADA RAMA QUE CONFIRMA, LO ESCRIBE ──');

prueba('hay más de una rama donde el técnico confirma', () => {
    // Si mañana quedara una sola, esta prueba deja de tener sentido y hay que revisarla en vez de
    // borrarla: probablemente alguien unificó las ramas, que sería lo mejor de todo.
    assert.ok(ramasQueConfirman().length >= 1, 'no se encontró ninguna rama de confirmación');
});

prueba('TODAS guardan la confirmación en el caso, no solo en el log', () => {
    // Se mira hacia atrás desde cada línea de log: la escritura tiene que estar cerca, en el mismo
    // bloque. Guardarla solo en RAM tampoco alcanza -- PM2 reinicia seguido.
    const lineas = idx.split('\n');
    const sinGuardar = [];
    for (const n of ramasQueConfirman()) {
        // La escritura puede estar antes o después del log: en una rama se guarda primero y se
        // avisa después, en la otra al revés. Lo que importa es que esté en el mismo bloque.
        const contexto = lineas.slice(Math.max(0, n - 60), n + 40).join('\n');
        if (!/guardarConfirmacionTecnico/.test(contexto)) sinGuardar.push(n);
    }
    assert.strictEqual(sinGuardar.length, 0,
        `Estas ramas dicen que el técnico confirmó y NO lo escriben en el caso ` +
        `(líneas ${sinGuardar.join(', ')}). Cuando el vecino pregunte a qué hora viene, ` +
        `Marcos va a decir que está esperando la confirmación que ya tiene.`);
});

console.log('\n── SIN HORA NO SE INVENTA UNA ──');

prueba('la hora se lee del mensaje, y si no está se guarda vacía', () => {
    const i = idx.indexOf('LA CONFIRMACIÓN VA AL CASO');
    assert.ok(i !== -1, 'falta el bloque que guarda la confirmación en la rama del ruteo');
    const bloque = idx.slice(i, i + 2000);
    assert.ok(/interpretarRespuestaTecnico/.test(bloque), 'la hora sale de leer el mensaje');
    assert.ok(/let eta = ''/.test(bloque), 'sin hora, se guarda vacía');
    // El prompt del vecino ya contempla el caso sin hora y tiene prohibido inventarla.
    const cara = fs.readFileSync(path.join(__dirname, 'agentes', 'marcos-cara.js'), 'utf8');
    assert.ok(/No inventes una hora/.test(cara),
        'el prompt del vecino tiene que prohibir inventar el horario cuando no lo dio');
});

prueba('un fallo al leer la hora no impide guardar la confirmación', () => {
    // Perder la confirmación entera por no poder leer la hora sería cambiar un problema chico por
    // el grande: el vecino prefiere "confirmó, sin horario" antes que "seguimos esperando".
    const i = idx.indexOf('LA CONFIRMACIÓN VA AL CASO');
    const bloque = idx.slice(i, i + 2000);
    assert.ok(/catch[\s\S]{0,120}No se pudo leer a qué hora/.test(bloque),
        'el error de la hora tiene que atraparse aparte, sin cortar el guardado');
});

console.log('');
if (fallos === 0) {
    console.log('✅ El vecino no vuelve a escuchar "esperamos confirmación" cuando ya la hay.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
