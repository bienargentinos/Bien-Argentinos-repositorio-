// UN ENVÍO QUE META RECHAZÓ NO PUEDE QUEDAR MARCADO COMO ENTREGADO
//
//   node pruebas-entrega-rechazada.js
//
// > [!CAUTION]
// > **Meta contesta 200 al RECIBIR el pedido, no al entregar el mensaje.** El resultado real llega
// > minutos después, en un webhook aparte, y puede ser `failed` con el código 131047.
//
// EL CASO REAL (prueba del vecino, 9/9). El vecino mandó audio + foto + la ficha de contacto de
// quien iba a recibir al técnico. Marcos abrió el CASO-1001, mandó la plantilla, y después la foto
// y el contacto de ingreso. El log dijo:
//
//     📷 Foto/video del vecino reenviado al técnico Dario (541169241157).
//     📞 Contacto de acceso (Natalia Zeballos...) enviado al técnico Dario.
//
// Las dos rebotaron con 131047 --la ventana de 24hs estaba cerrada-- pero ya estaban marcadas como
// entregadas en el caso. Cuando el técnico contestó (que es el instante exacto en que la ventana se
// abre), `entregarPendientesAlTecnico` miró las marcas, vio "ya entregado" y no reintentó nada.
//
// Él terminó escribiendo: *"Hola .. puedo ir en 2 hs pero necesito foto y también si es posible un
// teléfono de quien me recibe"*. Las dos cosas exactas que Marcos creía haberle mandado.
//
// Es el mismo error de fondo que ya está documentado tres veces en CLAUDE.md: **hacer algo y no
// verificar que haya quedado hecho.** Acá con un agravante: la marca miente en la dirección cara.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log(`  ✅ ${nombre}`); }
    catch (e) { fallos++; console.log(`  ❌ ${nombre}\n       ${e.message}`); }
};

const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const sh = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');
const dt = fs.readFileSync(path.join(__dirname, 'datos.js'), 'utf8');

// El bloque que atiende los avisos de entrega de Meta.
const bloque = (() => {
    const i = idx.indexOf("if (Array.isArray(entry?.statuses)");
    assert.ok(i !== -1, 'no está el manejador de statuses de Meta');
    return idx.slice(i, idx.indexOf('if (!entry?.messages?.[0]) return;', i));
})();

console.log('\n── UN RECHAZO NO SE QUEDA EN EL LOG ──');

prueba('el rechazo por ventana cerrada se detecta', () => {
    assert.ok(/131047/.test(bloque), 'falta reconocer el código 131047');
    // Ojo: acá se busca el TEXTO del código fuente, así que el `?` del patrón va escapado.
    assert.ok(/re-\\?\?engagement/i.test(bloque) || /engagement/i.test(bloque),
        'también llega descrito como re-engagement, sin código');
});

prueba('deshace las marcas de entrega, no solo loguea', () => {
    // Antes este bloque hacía `console.error` y nada más. La marca quedaba puesta y el reintento
    // no ocurría nunca.
    assert.ok(/desmarcarEntregasAlTecnico/.test(bloque),
        'el rechazo tiene que borrar las marcas para que el reintento sea posible');
});

prueba('solo toca los casos de un PROVEEDOR', () => {
    // Un rechazo hacia un vecino no tiene marcas de entrega que deshacer, y borrarle algo por las
    // dudas sería tocar un caso ajeno.
    assert.ok(/rol === 'proveedor'/.test(bloque));
});

prueba('no toca casos cerrados', () => {
    assert.ok(/!c\.cerrado/.test(bloque),
        'un caso cerrado no necesita que se le reenvíe la foto');
});

console.log('\n── LA FUNCIÓN QUE BORRA LA MARCA ──');

prueba('borra las DOS marcas', () => {
    // La foto y el contacto de ingreso salen juntos y rebotan juntos.
    const f = sh.slice(sh.indexOf('async function desmarcarEntregasAlTecnico'));
    assert.ok(/material_enviado_tecnico/.test(f) && /contacto_acceso_avisado/.test(f));
});

prueba('escribe en las DOS bases', () => {
    // El motor de Marcos lee PostgreSQL. Borrar solo en Sheets no cambiaría nada en producción,
    // que es exactamente lo que pasó con `buscarPerfilEdificio`.
    const f = dt.slice(dt.indexOf('async function desmarcarEntregasAlTecnico'), dt.indexOf('async function fueMaterialEnviadoATecnico'));
    assert.ok(/sheets\.desmarcarEntregasAlTecnico/.test(f), 'falta el lado de Sheets');
    assert.ok(/UPDATE reportes SET material_enviado_tecnico = NULL/.test(f), 'falta el lado de PostgreSQL');
});

prueba('dice en el log que va a reintentar', () => {
    // Sin esta línea, la próxima vez habría que diagnosticar de cero por qué el técnico recibió la
    // foto dos veces (o ninguna).
    assert.ok(/NO llegó/.test(bloque) && /se le manda de nuevo/.test(bloque));
});

console.log('\n── CANDADO ──');

prueba('la marca de entrega sigue poniéndose SOLO si el envío salió', () => {
    // Este era el candado original y tiene que seguir en pie: marcar un envío fallido impide el
    // reintento para siempre.
    const entrega = idx.slice(idx.indexOf('async function entregarPendientesAlTecnico'));
    const i = entrega.indexOf('marcarMaterialEnviadoATecnico(idEvento)');
    assert.ok(i !== -1, 'no está la marca del material');
    // Lo que la precede tiene que ser una comprobación de que el envío salió.
    assert.ok(/if \(salio\) \{[\s\S]{0,120}marcarMaterialEnviadoATecnico/.test(entrega),
        'la marca tiene que estar adentro de un `if (salio)`');
});

console.log('');
if (fallos === 0) {
    console.log('✅ Un envío rechazado se reintenta cuando el técnico abre la ventana.\n');
    process.exit(0);
}
console.log(`❌ ${fallos} prueba(s) fallando.\n`);
process.exit(1);
