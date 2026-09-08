// Verifica que Marcos no le pregunte al técnico algo que acaba de decir.
//
//   node pruebas-no-repreguntar.js
//
// POR QUÉ. Del chat real, con tres minutos de diferencia:
//
//     21:32  Marcos: "…Dirección: san patricio 270 … Quedó abierto como CASO-1001 en el panel."
//     21:34  Daniel: "Tengo llave, en 2 horas estaría llegando"
//     21:35  Marcos: "Perfecto, ¿a qué dirección vas?"
//     21:36  Daniel: "Y a qué dirección voy a ir si te acabo de decir que me llamaron de San
//                     Patricio 270… ¿Tenés memoria de pajarito o qué?"
//
// > [!CAUTION]
// > **Preguntar un dato que uno mismo acaba de escribir es lo que más rápido convence al técnico
// > de que del otro lado no lo están leyendo.**
//
// Y no fue el ruteo: el modelo clasificó "Tengo llave, en 2 horas estaría llegando" como
// `confirma_que_va` con confianza 1. El camino bueno --"lo anoté en el CASO-1001 de San Patricio
// 270"-- existía; lo que falló fue encontrar el caso.
//
// La condición vieja pedía que el estado dijera "avisado" o "sin confirmar":
//
//     suyos.find(c => !c.cerrado && /avisad|sin confirmar/i.test(String(c.estado || '')))
//
// Con eso alcanzaba para no encontrarlo. Pero la pregunta que importa no es en qué estado está el
// caso: es si YA SABEMOS de qué trabajo habla. Y en ese momento se sabía --el propio log lo
// demuestra, la línea `🔑 … del [CASO-1001]` salió de la sesión en memoria.
//
// Ahora hay tres fuentes, de la más precisa a la más general, y la dirección se pregunta solo
// cuando ninguna sabe nada.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// Se extrae la búsqueda real de index.js: la prueba tiene que validar el código que corre.
const ini = SRC.indexOf('let casoPendiente = null;');
if (ini === -1) throw new Error('No encontré la búsqueda del caso pendiente en index.js.');
const marcaFin = '\n                }';
const iniCatch = SRC.indexOf("} catch (e) { console.error('No se pudo buscar el caso pendiente de confirmar:", ini);
if (iniCatch === -1) throw new Error('No encontré el cierre de la búsqueda en index.js.');
// Se incluye la llave que cierra el `if`, o el bloque extraído no compila.
const cuerpo = SRC.slice(ini, SRC.indexOf(marcaFin, iniCatch) + marcaFin.length);

/**
 * Corre la búsqueda real contra datos de mentira.
 * @param enMemoria   el código que la sesión tiene abierto, o '' si PM2 reinició
 * @param enLaBase    los casos que devuelve la planilla
 * @param elCaso      lo que devuelve `buscarCasoPorCodigo` para el de memoria
 */
async function buscar({ enMemoria = '', enLaBase = [], elCaso = null, confirma = true }) {
    const falso = {
        buscarCasosRecientesPorTecnico: async () => enLaBase,
        buscarCasoPorCodigo: async (cod) => (elCaso && elCaso.id_evento === cod ? elCaso : null),
    };
    const globalFalso = {
        colasProveedores: new Map(enMemoria ? [['5491169241157', { eventoActivoId: enMemoria }]] : []),
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'global', 'console', 'confirmaQueVa', 'pareceRespuestaDeAgenda',
        'datosEmisor', 'from',
        `return (async () => {\n${cuerpo}\nreturn casoPendiente;\n})();`);

    return fn(
        (m) => (m === './datos' ? falso : require(m)),
        globalFalso,
        { log: () => {}, error: () => {} },
        confirma, false,
        { nombre: 'a dario juju' },
        '5491169241157'
    );
}

const abierto = (id, edificio, estado) => ({ id_evento: id, edificio, estado, cerrado: false });
const cerrado = (id, edificio) => ({ id_evento: id, edificio, estado: 'resuelto', cerrado: true });

(async () => {

console.log('\n── EL CASO QUE LA CONVERSACIÓN YA TIENE ABIERTO ──');
{
    // Lo que pasó de verdad: la sesión tenía CASO-1001 (el log `🔑` lo demuestra) y la búsqueda
    // por estado no lo encontró.
    const r = await buscar({
        enMemoria: 'CASO-1001',
        elCaso: abierto('CASO-1001', 'San patricio 270', 'avisado'),
        enLaBase: [],   // la planilla no lo devuelve: exactamente el caso que falló
    });
    verificar('se usa el de la sesión aunque la planilla no lo traiga', r?.id_evento, 'CASO-1001');
    verificar('y con su edificio, para no preguntarlo', r?.edificio, 'San patricio 270');
}

console.log('\n── EL DE MEMORIA SE RELEE DE LA BASE, NO SE CREE ──');
{
    // La memoria dice DE QUÉ se está hablando; la base dice la verdad. Si el caso ya se cerró
    // mientras tanto, no se usa el dato viejo.
    const r = await buscar({
        enMemoria: 'CASO-1001',
        elCaso: cerrado('CASO-1001', 'San patricio 270'),
        enLaBase: [],
    });
    verificar('un caso ya cerrado no se reusa', r, null);

    // Y si la memoria apunta a un caso que no existe (PM2 reinició con basura), tampoco.
    const r2 = await buscar({ enMemoria: 'CASO-9999', elCaso: null, enLaBase: [] });
    verificar('un código que no existe no inventa nada', r2, null);
}

console.log('\n── SIN MEMORIA, EL CASO ABIERTO DE LA PLANILLA ──');
{
    // Después de un reinicio de PM2 la sesión está vacía y sigue funcionando por la planilla.
    const r = await buscar({
        enMemoria: '',
        enLaBase: [abierto('CASO-1001', 'San patricio 270', 'avisado')],
    });
    verificar('lo encuentra por estado, como siempre', r?.id_evento, 'CASO-1001');

    // Y ACÁ está el arreglo: antes se exigía que el estado dijera "avisado". Un caso suyo abierto
    // en cualquier otro estado también responde "ya sé de qué trabajo habla".
    const r2 = await buscar({
        enMemoria: '',
        enLaBase: [abierto('CASO-1001', 'San patricio 270', 'en_proceso')],
    });
    verificar('un único caso abierto sirve, diga lo que diga el estado', r2?.id_evento, 'CASO-1001');
}

console.log('\n── CON DOS CASOS ABIERTOS SÍ SE PREGUNTA ──');
{
    // Adivinar acá manda al técnico --y la factura-- al consorcio equivocado. Preguntar molesta;
    // elegir mal cuesta plata.
    const r = await buscar({
        enMemoria: '',
        enLaBase: [
            abierto('CASO-1001', 'San patricio 270', 'en_proceso'),
            abierto('CASO-1002', 'Zeballos Cia', 'en_proceso'),
        ],
    });
    verificar('con dos abiertos no se adivina', r, null);

    // Salvo que uno esté esperando confirmación: ese es el que acaba de contestar.
    const r2 = await buscar({
        enMemoria: '',
        enLaBase: [
            abierto('CASO-1001', 'San patricio 270', 'avisado'),
            abierto('CASO-1002', 'Zeballos Cia', 'en_proceso'),
        ],
    });
    verificar('el que espera confirmación gana', r2?.id_evento, 'CASO-1001');
}

console.log('\n── LO QUE NO CAMBIA ──');
{
    // Sin ningún caso suyo abierto, se le pregunta la dirección. Es el caso legítimo: el técnico
    // avisa que va a un edificio del que Marcos todavía no sabe nada.
    verificar('sin nada abierto, se pregunta',
        await buscar({ enMemoria: '', enLaBase: [] }), null);

    verificar('un caso cerrado no cuenta',
        await buscar({ enMemoria: '', enLaBase: [cerrado('CASO-1001', 'San patricio 270')] }), null);

    // Un caso sin edificio no sirve para evitar la pregunta: justamente falta ese dato.
    verificar('un caso sin edificio no evita la pregunta',
        await buscar({ enMemoria: '', enLaBase: [abierto('CASO-1001', '', 'en_proceso')] }), null);

    // Y si no confirmó nada, ni se busca.
    verificar('sin confirmación no se busca nada',
        await buscar({ enMemoria: 'CASO-1001', elCaso: abierto('CASO-1001', 'x', 'avisado'), confirma: false }), null);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);

})();
