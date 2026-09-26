// CUANDO ALGUIEN CONTESTA CITANDO, LAS PALABRAS DE MARCOS VIAJAN ADENTRO DEL MENSAJE
//
//   node pruebas-cita-mensaje.js
//
// EL CASO REAL. Marcos preguntó de qué obra era una factura. El técnico contestó "1001 es el caso"
// CITANDO ese mensaje. Lo que llegó a las condiciones fue:
//
//     1001 es el caso [Cita el mensaje: "Perfecto a dario juju, recibida la factura…"]
//
// `esFacturaODoc` busca la palabra `factura` en el texto. Estaba — la había escrito Marcos. La
// respuesta se registró como una SEGUNDA factura, sin número y con monto "Según comprobante", al
// lado de la que había llegado un minuto antes. En el panel, dos gastos donde hay uno.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { separarCita, conCita } = require('./cita-mensaje');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

console.log('\n── LO QUE ESCRIBIÓ ÉL, SEPARADO DE LO QUE CITÓ ──');

prueba('el caso real: "1001 es el caso" citando un mensaje con la palabra "factura"', () => {
    const entrante = `1001 es el caso [Cita el mensaje: "Perfecto a dario juju, recibida la factura. ¿De qué edificio es?"]`;
    const { texto, cita } = separarCita(entrante);
    assert.strictEqual(texto, '1001 es el caso');
    assert.ok(/recibida la factura/.test(cita), 'la cita tiene que conservarse, no tirarse');

    // La condición que decidía que esto era un comprobante nuevo.
    const esFactura = t => /factura|comprobante|recibo|pago|cobro|remito|cbu|transferencia/i.test(t.toLowerCase());
    assert.ok(esFactura(entrante), 'con la cita pegada, la condición SÍ se dispara — así se registró la factura de más');
    assert.ok(!esFactura(texto), 'con lo que él escribió, no se dispara');
});

prueba('el número de caso sobrevive a la separación', () => {
    const { texto } = separarCita(`1001 es el caso [Cita el mensaje: "…recibida la factura…"]`);
    const cod = (texto.match(/\b0*(\d{3,})\b(?=[^]{0,20}\bcaso\b)/i) || [])[1];
    assert.strictEqual(cod, '1001');
});

prueba('sin cita, el texto vuelve igual', () => {
    const { texto, cita } = separarCita('me llamaron de San Patricio 270, voy a pasar');
    assert.strictEqual(texto, 'me llamaron de San Patricio 270, voy a pasar');
    assert.strictEqual(cita, '');
});

prueba('la marca sin texto ("en respuesta al mensaje anterior") también se saca', () => {
    const { texto, cita } = separarCita('dale [En respuesta al mensaje/notificación anterior]');
    assert.strictEqual(texto, 'dale');
    assert.strictEqual(cita, '');
});

prueba('varias citas en una ráfaga se juntan y ninguna queda en el texto', () => {
    const { texto, cita } = separarCita(
        `si [Cita el mensaje: "¿pudiste pasar?"] ya está [Cita el mensaje: "avisame cuando termines"]`
    );
    assert.strictEqual(texto, 'si ya está');
    assert.ok(cita.includes('pudiste pasar') && cita.includes('avisame cuando termines'));
});

prueba('si contestó SOLO citando, el texto no queda vacío', () => {
    // Un mensaje sin texto se descarta aguas abajo: perder la vuelta entera es peor que decidir
    // sobre un texto imperfecto.
    const entrante = `[Cita el mensaje: "¿pudiste pasar?"]`;
    const { texto } = separarCita(entrante);
    assert.ok(texto.length > 0, 'no puede devolver cadena vacía');
});

prueba('la cita vuelve etiquetada para el modelo, no mezclada', () => {
    const junto = conCita('1001 es el caso', 'recibida la factura');
    assert.ok(junto.startsWith('1001 es el caso'));
    assert.ok(/respondiendo a un mensaje anterior/i.test(junto),
        'el modelo tiene que poder distinguir quién dijo cada parte');
});

prueba('nada rompe con vacío, null o undefined', () => {
    for (const v of [null, undefined, '', '   ']) {
        const r = separarCita(v);
        assert.strictEqual(typeof r.texto, 'string');
        assert.strictEqual(r.cita, '');
    }
    assert.strictEqual(conCita('hola', ''), 'hola');
});

// ── CANDADO ─────────────────────────────────────────────────────────────────────────────────
//
// Las condiciones de la rama del proveedor deciden sobre `textoFinal`, que es el texto YA separado
// de la cita (y, en un audio, la transcripción). `msgBody` es el mensaje crudo: si alguna vuelve a
// leer de ahí, la cita vuelve a entrar en las decisiones y esto se repite.
console.log('\n── CANDADO: NINGUNA DECISIÓN VUELVE A LEER EL MENSAJE CRUDO ──');

prueba('index.js no arma texto de decisión desde msgBody', () => {
    const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const malas = [];
    src.split('\n').forEach((linea, i) => {
        if (/^\s*(\/\/|\*)/.test(linea)) return;
        if (/const\s+txtLow[A-Za-z]*\s*=\s*\(?\s*msgBody/.test(linea)) malas.push(`${i + 1}: ${linea.trim()}`);
    });
    assert.strictEqual(malas.length, 0,
        `Estas líneas deciden sobre el mensaje crudo (con la cita adentro):\n       ${malas.join('\n       ')}`);
});

prueba('la separación se hace antes de cualquier condición', () => {
    const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const sep = src.indexOf("require('./cita-mensaje')");
    const primeraCondicion = src.indexOf('const esFacturaODoc');
    assert.ok(sep !== -1, 'index.js tiene que separar la cita');
    assert.ok(sep < primeraCondicion,
        'la cita se separa DESPUÉS de la primera condición: para esa condición no cambió nada');
});

console.log('');
if (fallos === 0) {
    console.log('✅ La cita es contexto para el modelo, no texto para las condiciones.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
