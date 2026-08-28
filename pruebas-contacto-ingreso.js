// Verifica que Marcos no convierta un favor de una vez en una regla permanente.
//
//   node pruebas-contacto-ingreso.js
//
// EL CASO REAL. En el CASO-1001 no había nadie para abrir y Natalia se ofreció esa vez. Marcos
// guardó su teléfono y desde ahí lo entregó como si fuera EL contacto de ingreso del edificio:
//
//   "para el ingreso por favor comuníquese con Natalia Zeballos, número 5491167350436"
//
// Afirmado, sin matices, y encima en otro edificio.
//
// Daniel: "el teléfono de Natalia se dio en el caso 1001 por esa vez nada más, ya que no estaba
// nadie para abrir. No puede tomar como consideración que siempre abrirá Natalia. Debe usar los
// datos que hay en el edificio de accesos, pero si no hay, que hable con el administrador y que
// sugiera quizás a Natalia -- pero lo dio por hecho".
//
// La diferencia entre "comuníquese con Natalia" y "la última vez abrió Natalia, lo confirmo con la
// Administración" es la diferencia entre un dato y una suposición. El técnico organiza su día con
// eso: si nadie le abre, perdió el viaje.

const { contactoParaElIngreso, mensajeDeIngreso, tieneAccesoPropio } = require('./contacto-ingreso');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

const NATALIA = 'Natalia Zeballos (5491167350436)';

console.log('\n── EL EDIFICIO MANDA, NO LO QUE PASÓ UNA VEZ ──');
{
    const conEncargado = contactoParaElIngreso({
        perfil: { encargado: 'Roberto', telEncargado: '1155551111', encargadoEstado: 'activo' },
        contactoDeCasoAnterior: NATALIA,
        casoAnterior: 'CASO-1001',
        edificio: 'San Patricio 270',
    });
    verificar('con encargado activo, es el encargado', conEncargado.quien, 'Roberto');
    verificar('y es un dato firme', conEncargado.firme, true);
}

{
    // El encargado de licencia no abre. El suplente está en la ficha y sigue siendo un dato firme.
    const deLicencia = contactoParaElIngreso({
        perfil: {
            encargado: 'Roberto', telEncargado: '1155551111', encargadoEstado: 'licencia',
            encargadoSuplente: 'Marta', telSuplente: '1155552222',
        },
        contactoDeCasoAnterior: NATALIA,
        edificio: 'San Patricio 270',
    });
    verificar('con el encargado de licencia, el suplente', deLicencia.quien, 'Marta');
    verificar('sigue siendo firme', deLicencia.firme, true);
}

{
    const soloSeguridad = contactoParaElIngreso({
        perfil: { telSeguridad: '1155553333' },
        contactoDeCasoAnterior: NATALIA,
        edificio: 'San Patricio 270',
    });
    verificar('sin encargado ni suplente, seguridad', soloSeguridad.quien, 'seguridad');
    verificar('firme también', soloSeguridad.firme, true);
}

{
    // Lo aprendido sobre los accesos es DEL EDIFICIO -- quién tiene la llave de qué -- y por eso
    // sí es firme. Es distinto de un favor puntual en un caso.
    const porAccesos = contactoParaElIngreso({
        perfil: {},
        accesos: [{ quien_tiene: 'Portería', telefono: '1155554444', instalacion: 'sala de máquinas' }],
        contactoDeCasoAnterior: NATALIA,
        edificio: 'San Patricio 270',
    });
    verificar('lo registrado en accesos del edificio', porAccesos.quien, 'Portería');
    verificar('firme', porAccesos.firme, true);
}

console.log('\n── LO QUE PASÓ UNA VEZ ES UNA SUGERENCIA ──');
{
    const soloNatalia = contactoParaElIngreso({
        perfil: {},
        accesos: [],
        contactoDeCasoAnterior: NATALIA,
        casoAnterior: 'CASO-1001',
        edificio: 'San Patricio 270',
        edificioDelContacto: 'San Patricio 270',
    });
    verificar('se usa como último recurso', soloNatalia.texto, NATALIA);
    verificar('pero NO como un hecho', soloNatalia.firme, false);
    verificar('y dice de dónde salió', soloNatalia.origen, 'abrió en el CASO-1001, esa vez');

    const msg = mensajeDeIngreso({ contacto: soloNatalia, idEvento: 'CASO-1005', direccion: 'San Patricio 270', nombreTecnico: 'Dario' });
    verificar('el mensaje NO se lo pide como si fuera fijo', /comuni[cq]/i.test(msg), false);
    verificar('aclara que fue por esa vez', /no es algo fijo/i.test(msg), true);
    verificar('y avisa que lo está confirmando', /Administraci[oó]n/i.test(msg), true);
}

console.log('\n── UN FAVOR EN UN EDIFICIO NO VALE EN OTRO ──');
{
    // Esto es lo que pasó de verdad: Natalia abrió en el 159 y Marcos la ofreció para el 270.
    const otroEdificio = contactoParaElIngreso({
        perfil: {},
        accesos: [],
        contactoDeCasoAnterior: NATALIA,
        casoAnterior: 'CASO-1001',
        edificioDelContacto: 'San Patricio 159',
        edificio: 'San Patricio 270',
    });
    verificar('no se ofrece el contacto de otro edificio', otroEdificio, null);
}

console.log('\n── SIN NADA, NO SE INVENTA ──');
{
    const nada = contactoParaElIngreso({ perfil: {}, accesos: [], edificio: 'San Patricio 270' });
    verificar('devuelve null', nada, null);

    const msg = mensajeDeIngreso({ contacto: null, idEvento: 'CASO-1005', direccion: 'San Patricio 270', nombreTecnico: 'Dario' });
    verificar('no nombra a nadie', /Natalia/i.test(msg), false);
    verificar('dice que lo está averiguando', /todav[ií]a no tengo confirmado/i.test(msg), true);
}

console.log('\n── EL ORDEN COMPLETO ──');
{
    // Con todo cargado gana el encargado; sacándole uno por uno se ve bajar la escalera.
    const todo = {
        perfil: {
            encargado: 'Roberto', telEncargado: '1111', encargadoEstado: 'activo',
            encargadoSuplente: 'Marta', telSuplente: '2222', telSeguridad: '3333',
        },
        accesos: [{ quien_tiene: 'Portería', telefono: '4444' }],
        contactoDeCasoAnterior: NATALIA,
        edificio: 'San Patricio 270',
    };
    verificar('1º encargado', contactoParaElIngreso(todo).telefono, '1111');
    verificar('2º suplente', contactoParaElIngreso({ ...todo, perfil: { ...todo.perfil, telEncargado: '' } }).telefono, '2222');
    verificar('3º seguridad', contactoParaElIngreso({ ...todo, perfil: { telSeguridad: '3333' } }).telefono, '3333');
    verificar('4º accesos del edificio', contactoParaElIngreso({ ...todo, perfil: {} }).telefono, '4444');
    verificar('5º lo de la otra vez', contactoParaElIngreso({ ...todo, perfil: {}, accesos: [] }).firme, false);
}

console.log('\n── SI DIJO QUE ENTRA SOLO, NO SE LE EXPLICA QUIÉN LE ABRE ──');
{
    // Marcos preguntó "¿necesitás que gestione algo para entrar?", Daniel contestó "no, tengo
    // llave y acceso al sistema" -- y Marcos le mandó igual el contacto del encargado.
    // Preguntar y después no leer la respuesta le enseña al técnico que a Marcos no vale la pena
    // contestarle.
    const entraSolo = [
        'si, voy en 3 horas. no necesito nada para ingresar, tengo llave y acceso al sistema',
        'dale, tengo llave',
        'tengo el codigo de la puerta',
        'tengo acceso al sistema de camaras',
        'no hace falta que gestiones nada para entrar',
        'entro solo, no te preocupes',
        'tengo tarjeta de acceso',
    ];
    for (const t of entraSolo) verificar(`"${t.slice(0, 50)}…"`, tieneAccesoPropio(t), true);

    // Y lo que NO dice eso. Marcar de más es peor: el técnico llega y no le abre nadie porque
    // Marcos dio por hecho que tenía llave.
    const noDice = [
        'si, voy en 3 horas',
        'necesito que alguien me abra',
        // Este es el peligroso: "NO tengo llave" contiene "tengo llave". Marcarlo dejaría al
        // técnico parado en la puerta sin que nadie le abra.
        'no tengo llave, avisá al encargado',
        'todavía no tengo el código, me lo pasás?',
        'no tengo acceso al sistema todavía',
        'no necesito el plano, ya lo tengo',
        'gracias, saludos',
        '',
    ];
    for (const t of noDice) verificar(`"${t || '(vacío)'}" NO da acceso propio por hecho`, tieneAccesoPropio(t), false);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
