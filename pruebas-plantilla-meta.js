// Verifica que los parámetros de una plantilla de Meta salgan en condiciones de ser aceptados.
//
//   node pruebas-plantilla-meta.js
//
// POR QUÉ. Meta RECHAZA LA PLANTILLA ENTERA si un parámetro trae un salto de línea, un tabulador o
// más de cuatro espacios seguidos. No manda una parte: no manda nada.
//
// Y varios de esos parámetros los escribe el modelo a partir de lo que contó el vecino
// (`resumen_problema`), así que un salto de línea ahí adentro es cuestión de tiempo.
//
// Lo peligroso es cómo se ve cuando pasa: la plantilla falla, sale el mensaje libre de respaldo, y
// como en las pruebas la ventana de 24hs está abierta el mensaje libre SÍ llega. Parece que todo
// anduvo. Con la ventana cerrada --un técnico que hace días que no escribe, que es el caso real--
// el mensaje libre también rebota y el técnico no se entera de nada.

const {
    limpiarParametroPlantilla: limpiar,
    enviarPlantillaWhatsApp,
} = require('./agentes/marcos-ops');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

console.log('\n── LO QUE META RECHAZA ──');
{
    verificar('un salto de línea se vuelve un espacio',
        limpiar('Pérdida de agua\nen el pasillo'), 'Pérdida de agua en el pasillo');
    verificar('varios saltos seguidos, uno solo',
        limpiar('Se cortó la luz\n\n\nen el 3ºB'), 'Se cortó la luz en el 3ºB');
    verificar('el retorno de carro de Windows también',
        limpiar('Portero eléctrico\r\nno anda'), 'Portero eléctrico no anda');
    verificar('un tabulador',
        limpiar('Rubro:\telectricidad'), 'Rubro: electricidad');
    verificar('cinco espacios seguidos quedan en tres',
        limpiar('San Patricio     270'), 'San Patricio   270');
    verificar('cuatro espacios ya son demasiados',
        limpiar('a    b'), 'a   b');
}

console.log('\n── LO QUE NO HAY QUE TOCAR ──');
{
    verificar('un texto normal queda igual',
        limpiar('Pérdida de agua en el pasillo del 3º'), 'Pérdida de agua en el pasillo del 3º');
    verificar('los acentos y la ñ se respetan',
        limpiar('Cañería del baño — mañana'), 'Cañería del baño — mañana');
    verificar('el código del caso sobrevive',
        limpiar('[CASO-1001] Requerimiento de electricidad'), '[CASO-1001] Requerimiento de electricidad');
    verificar('dos y tres espacios se dejan',
        limpiar('a  b   c'), 'a  b   c');
}

console.log('\n── UN PARÁMETRO VACÍO TAMBIÉN INVALIDA LA PLANTILLA ──');
{
    // Meta no acepta un parámetro en blanco. Un guion no dice nada, pero deja pasar el mensaje --
    // que es lo único que abre la ventana para mandarle el resto.
    verificar('vacío', limpiar(''), '-');
    verificar('solo espacios', limpiar('    '), '-');
    verificar('null', limpiar(null), '-');
    verificar('undefined', limpiar(undefined), '-');
    verificar('un salto de línea solo', limpiar('\n'), '-');
}

console.log('\n── UN TEXTO INTERMINABLE ──');
{
    // El modelo a veces devuelve un párrafo entero. Meta corta en 1024; se recorta antes para no
    // perder la plantilla completa por un resumen largo.
    const largo = 'x'.repeat(2000);
    verificar('se recorta', limpiar(largo).length, 900);
}

console.log('\n── SE LIMPIA AL MANDAR, NO EN CADA LLAMADOR ──');
{
    // La limpieza vive adentro de `enviarPlantillaWhatsApp`, no en cada llamador: cualquier
    // plantilla que se agregue mañana queda cubierta sin que nadie tenga que acordarse.
    //
    // Para ver qué se manda de verdad se reemplaza axios por un doble ANTES de cargar el módulo.
    const rutaAxios = require.resolve('axios');
    let enviado = null;
    require.cache[rutaAxios] = {
        id: rutaAxios, filename: rutaAxios, loaded: true,
        exports: async (config) => { enviado = config.data; return { data: { messages: [{ id: 'fake' }] } }; },
    };
    delete require.cache[require.resolve('./agentes/marcos-ops')];
    const ops = require('./agentes/marcos-ops');

    const componentesSucios = [{
        type: 'body',
        parameters: [
            { type: 'text', text: 'Julio' },
            { type: 'text', text: 'San Patricio 270' },
            { type: 'text', text: 'Daniel (1A) — [CASO-1001] Pérdida\nde agua' },
            { type: 'text', text: 'ALTA' },
            { type: 'text', text: '' },
        ],
    }];
    const antes = JSON.stringify(componentesSucios);

    (async () => {
        const ok = await ops.enviarPlantillaWhatsApp(
            '541169241157', 'notificacion_servicio_consorcio', 'es_AR',
            componentesSucios, 'PHONE', 'TOKEN'
        );

        const params = enviado.template.parameters || enviado.template.components[0].parameters;
        verificar('se envió', ok, true);
        verificar('el salto de línea no viajó', params[2].text, 'Daniel (1A) — [CASO-1001] Pérdida de agua');
        verificar('el parámetro vacío se rellenó', params[4].text, '-');
        verificar('los que estaban bien no se tocaron', params[0].text, 'Julio');
        // Quien la llamó no tiene por qué enterarse de la limpieza: se le devuelve su objeto intacto.
        verificar('no modifica el arreglo que le pasaron', JSON.stringify(componentesSucios), antes);

        console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
        process.exit(fallos === 0 ? 0 : 1);
    })();
}
