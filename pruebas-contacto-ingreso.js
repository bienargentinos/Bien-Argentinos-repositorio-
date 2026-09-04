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

const {
    contactoParaElIngreso, mensajeDeIngreso, tieneAccesoPropio,
    datosDelEncargado, telefonoUsable,
} = require('./contacto-ingreso');

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
    //
    // Los teléfonos son de 10 dígitos y no `1111` como estaban antes: un número de relleno ya no
    // se acepta como contacto (ver la sección siguiente), y usar uno acá hacía que la prueba
    // midiera otra cosa.
    const todo = {
        perfil: {
            encargado: 'Roberto', telEncargado: '1111111111', encargadoEstado: 'activo',
            encargadoSuplente: 'Marta', telSuplente: '2222222222', telSeguridad: '3333333333',
        },
        accesos: [{ quien_tiene: 'Portería', telefono: '4444444444' }],
        contactoDeCasoAnterior: NATALIA,
        edificio: 'San Patricio 270',
        momentoVisita: new Date('2026-09-04T13:00:00Z'),   // 10 AM en Argentina
    };
    verificar('1º encargado', contactoParaElIngreso(todo).telefono, '1111111111');
    verificar('2º suplente', contactoParaElIngreso({ ...todo, perfil: { ...todo.perfil, telEncargado: '' } }).telefono, '2222222222');
    verificar('3º seguridad', contactoParaElIngreso({ ...todo, perfil: { telSeguridad: '3333333333' } }).telefono, '3333333333');
    verificar('4º accesos del edificio', contactoParaElIngreso({ ...todo, perfil: {} }).telefono, '4444444444');
    verificar('5º lo de la otra vez', contactoParaElIngreso({ ...todo, perfil: {}, accesos: [] }).firme, false);
}

console.log('\n── EL NOMBRE DEL ENCARGADO NO ES LA FILA ENTERA DE LA PLANILLA ──');
{
    // > [!CAUTION]
    // > **La columna `encargado` guarda `nombre [estado | horario]`.**
    //
    // Lo escribe así el panel y lo vuelve a desarmar para mostrarlo. `contacto-ingreso.js` no lo
    // desarmaba, así que al técnico le llegó, tal cual, a la 1:20 de la madrugada:
    //
    //     te abre pachu [activo | L-V 08:02-12:00 · L-V 01:00-12:00 · Sáb 12:00-08:00] (12345667)
    //
    // Eso no es un mensaje: es una fila de una planilla. El técnico necesita a quién llamar, no la
    // semana entera del encargado.
    const crudo = 'pachu [activo | L-V 08:02-12:00 · L-V 01:00-12:00 · Sáb 12:00-08:00]';
    verificar('sale solo el nombre', datosDelEncargado(crudo).nombre, 'pachu');
    verificar('el estado se lee aparte', datosDelEncargado(crudo).estado, 'activo');
    verificar('y el horario también', datosDelEncargado(crudo).horario, 'L-V 08:02-12:00 · L-V 01:00-12:00 · Sáb 12:00-08:00');
    verificar('un nombre sin corchetes queda igual', datosDelEncargado('Roberto').nombre, 'Roberto');
    verificar('y sin metadata inventada', datosDelEncargado('Roberto').estado, '');

    const c = contactoParaElIngreso({
        perfil: { encargado: crudo, telEncargado: '1167350436', encargadoEstado: 'activo' },
        edificio: 'San Patricio 270',
        momentoVisita: new Date('2026-09-04T13:00:00Z'),   // 10 AM
    });
    verificar('el contacto usa el nombre limpio', c.texto, 'pachu (1167350436)');
    // Ojo: el `[` del encabezado `[CASO-1001]` es legítimo, así que se busca el horario en sí.
    verificar('y el horario no se le manda al técnico',
        /L-V|S[aá]b|\d{2}:\d{2}/.test(mensajeDeIngreso({ contacto: c, idEvento: 'CASO-1001', direccion: 'San Patricio 270' })), false);

    // El estado del corchete también vale cuando no hay columna aparte.
    const dLicencia = contactoParaElIngreso({
        perfil: {
            encargado: 'pachu [licencia | L-V 08:00-12:00]', telEncargado: '1167350436',
            encargadoSuplente: 'Marta', telSuplente: '1155551122',
        },
        momentoVisita: new Date('2026-09-04T13:00:00Z'),
    });
    verificar('con el encargado de licencia pasa al suplente', dLicencia.telefono, '1155551122');
}

console.log('\n── UN TELÉFONO QUE NO SE PUEDE DISCAR NO ES UN CONTACTO ──');
{
    // En la prueba real salió `pachu (12345667)` -- ocho dígitos, relleno que quedó en la ficha --
    // y Marcos se lo entregó al técnico como el contacto de ingreso a las 2 de la mañana.
    verificar('8 dígitos no alcanza', telefonoUsable('12345667'), false);
    verificar('10 sí', telefonoUsable('1167350436'), true);
    verificar('con +54 y espacios también', telefonoUsable('+54 9 11 6735-0436'), true);
    verificar('vacío no', telefonoUsable(''), false);

    // Con un número inservible se baja al siguiente escalón en vez de entregarlo.
    const c = contactoParaElIngreso({
        perfil: { encargado: 'pachu', telEncargado: '12345667', telSeguridad: '1155559999' },
        momentoVisita: new Date('2026-09-04T13:00:00Z'),
    });
    verificar('se saltea al encargado con teléfono trucho', c.telefono, '1155559999');

    // Y si no hay nada más, prefiere decir que está averiguando antes que mandar un número falso.
    const nada = contactoParaElIngreso({
        perfil: { encargado: 'pachu', telEncargado: '12345667' },
        momentoVisita: new Date('2026-09-04T13:00:00Z'),
    });
    verificar('sin otro escalón, no inventa un contacto', nada, null);
}

console.log('\n── DE MADRUGADA NO SE AFIRMA QUE EL ENCARGADO ABRE ──');
{
    // El mensaje real, a la 1:20 AM: "te abre pachu [... L-V 08:02-12:00 ...]. Si al llegar no te
    // abren, avisame y lo resuelvo." Se contradice solo: el horario que Marcos acababa de mandar
    // ya decía que a esa hora no había nadie.
    //
    // Daniel: "esos horarios no sirven en este horario nocturno, así que es un mensaje que no va a
    // funcionar; ya en el mensaje de horario está lo imposible que alguien le abra".
    const deNoche = new Date('2026-09-04T05:20:00Z');    // 02:20 en Argentina
    const deDia   = new Date('2026-09-04T13:00:00Z');    // 10:00 en Argentina

    const perfil = { encargado: 'pachu', telEncargado: '1167350436', encargadoEstado: 'activo' };

    const noche = contactoParaElIngreso({ perfil, momentoVisita: deNoche });
    verificar('sigue siendo el encargado', noche.quien, 'pachu');
    verificar('pero NO se afirma', noche.firme, false);
    verificar('y dice por qué', /a esa hora/.test(noche.reserva), true);

    const msg = mensajeDeIngreso({ contacto: noche, idEvento: 'CASO-1001', direccion: 'San Patricio 270' });
    verificar('el mensaje no promete que le abren', /te abre \*/.test(msg), false);
    verificar('no cierra con "si no te abren, avisame"', /no te abren, avisame/.test(msg), false);
    verificar('dice que lo está confirmando', /confirmo|Administraci[oó]n/.test(msg), true);

    // De día, lo de siempre.
    const dia = contactoParaElIngreso({ perfil, momentoVisita: deDia });
    verificar('de día sí se afirma', dia.firme, true);
    verificar('y el mensaje lo dice derecho',
        /te abre \*/.test(mensajeDeIngreso({ contacto: dia, idEvento: 'CASO-1001', direccion: 'San Patricio 270' })), true);

    // Seguridad es, por definición, la opción de la noche: a esa NO se le pone reserva.
    const seg = contactoParaElIngreso({ perfil: { telSeguridad: '1155559999' }, momentoVisita: deNoche });
    verificar('seguridad se afirma aunque sea de madrugada', seg.firme, true);

    // Sin saber cuándo va, no se inventa una reserva.
    verificar('sin hora de visita, se comporta como antes',
        contactoParaElIngreso({ perfil }).firme, true);
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
