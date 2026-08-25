// Verifica que lo que Meta rechaza mientras la ventana de 24hs está cerrada se le entregue al
// técnico cuando la ventana se abre.
//
//   node pruebas-ventana-24hs.js
//
// POR QUÉ. La API de WhatsApp de Meta solo deja pasar PLANTILLAS aprobadas mientras la ventana de
// 24hs está cerrada. Todo lo demás --texto libre, foto, video, ficha de contacto-- se rechaza con
// el código 131047. Y la ventana NO la abre la plantilla que mandamos nosotros: la abre el técnico
// cuando responde.
//
// Marcos manda las cuatro cosas seguidas, así que en producción llegaba solo la plantilla:
//
//   📷 Foto/video del vecino reenviado al técnico a dario juju (541169241157).
//   📵 META RECHAZÓ LA ENTREGA a 5491169241157 [código 131047]: Re-engagement message
//   👤 Ficha de contacto reenviada a 541169241157.
//   📵 META RECHAZÓ LA ENTREGA ... [código 131047]
//
// El técnico salía a la calle con la dirección y nada más: sin la foto del problema y sin el
// teléfono de quien le abre la puerta.
//
// La lógica se carga del propio index.js para que la prueba valide el código real y no una copia.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const i = SRC.indexOf('async function entregarPendientesAlTecnico(');
if (i === -1) throw new Error('No encontré entregarPendientesAlTecnico en index.js.');
// El conteo de llaves arranca DESPUÉS de la lista de parámetros: la firma desestructura un objeto
// (`{ telTecnico, ... }`), así que contar desde el principio cerraba en la primera llave y cortaba
// la función por la mitad.
let p = 0, finParams = -1;
for (let k = SRC.indexOf('(', i); k < SRC.length; k++) {
    if (SRC[k] === '(') p++;
    else if (SRC[k] === ')') { p--; if (p === 0) { finParams = k; break; } }
}
let d = 0, fin = -1, empezo = false;
for (let k = SRC.indexOf('{', finParams); k < SRC.length; k++) {
    if (SRC[k] === '{') { d++; empezo = true; }
    else if (SRC[k] === '}') { d--; if (empezo && d === 0) { fin = k + 1; break; } }
}
const cuerpo = SRC.slice(i, fin);

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

/**
 * Arma la función con todas sus dependencias reemplazadas por dobles, y devuelve además el
 * registro de lo que hizo: qué mandó, qué marcó y qué anotó en el historial del caso.
 */
function armar({ yaEnviadoMaterial = false, yaAvisadoContacto = false, hayMaterial = true, contactoAcceso = '11 4444-5555', metaAcepta = true }) {
    const hecho = { envios: [], marcas: [], chat: [] };

    const datosFalsos = {
        fueMaterialEnviadoATecnico: async () => yaEnviadoMaterial,
        marcarMaterialEnviadoATecnico: async () => { hecho.marcas.push('material'); },
        fueContactoAccesoAvisado: async () => yaAvisadoContacto,
        marcarContactoAccesoAvisado: async () => { hecho.marcas.push('contacto'); },
        guardarReporte: async (r) => { hecho.chat.push(JSON.parse(r.historial_chat)[0]); },
    };

    const opsFalsas = {
        enviarImagenWhatsApp: async (to, _id, pie) => { hecho.envios.push({ que: 'imagen', to, pie }); return metaAcepta; },
        enviarVideoWhatsApp:  async (to, _id, pie) => { hecho.envios.push({ que: 'video', to, pie });  return metaAcepta; },
        // Al técnico se le habla con la dirección de la calle, nunca con el nombre interno del
        // edificio. Acá se devuelve algo distinguible para poder verificar cuál de los dos usó.
        direccionParaTecnico: async (nombre) => (nombre ? `Calle Falsa 123 (${nombre})` : 'el edificio'),
    };

    const requireFalso = (m) => {
        if (m === './datos') return datosFalsos;
        if (m === './agentes/marcos-ops') return opsFalsas;
        throw new Error(`require inesperado en la prueba: ${m}`);
    };

    // eslint-disable-next-line no-new-func
    const fn = new Function(
        'require', 'materialDelVecinoEnCaso', 'subirMediaWhatsApp', 'enviarWhatsApp',
        'buscarVecinoPorTelefono', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'path', 'console',
        `${cuerpo}; return entregarPendientesAlTecnico;`
    )(
        requireFalso,
        async () => (hayMaterial ? { filePath: '/tmp/foto.jpg', tipo: 'image', mimeType: 'image/jpeg' } : null),
        async () => 'MEDIA-ID-123',
        async (to, texto) => { hecho.envios.push({ que: 'texto', to, texto }); return metaAcepta; },
        async () => ({ contactoAcceso }),
        'PHONE', 'TOKEN', path,
        { log() {}, warn() {}, error() {} }
    );

    return { fn, hecho };
}

const caso = {
    telTecnico: '541169241157',
    nombreTecnico: 'dario juju',
    idEvento: 'CASO-1001',
    edificio: 'san patricio casa',
    telVecino: '5491150542005',
    nombreVecino: 'Daniel Valdez',
};

(async () => {

console.log('\n── LA VENTANA SE ABRIÓ: SALE TODO LO QUE HABÍA REBOTADO ──');
{
    const { fn, hecho } = armar({ metaAcepta: true });
    const quedaPendiente = await fn(caso);

    verificar('salieron los dos: la foto y el contacto de acceso', hecho.envios.length, 2);
    verificar('la foto le llegó al técnico', hecho.envios[0].que, 'imagen');
    verificar('el contacto de acceso también', hecho.envios[1].que, 'texto');
    verificar('quedan las dos marcas en el caso', hecho.marcas, ['material', 'contacto']);
    verificar('los dos envíos quedan en el chat del proveedor', hecho.chat.length, 2);
    verificar('no quedó nada pendiente', quedaPendiente, false);
}

console.log('\n── LO QUE EL TÉCNICO NECESITA LEER EN EL MENSAJE ──');
{
    const { fn, hecho } = armar({});
    await fn(caso);
    const [foto, acceso] = hecho.envios;

    // El número de caso va en los dos. Es lo único con que el técnico puede decir después "esta
    // factura es del CASO-1001": junta los trabajos de varios días y los manda todos juntos, a
    // veces de administradores distintos.
    verificar('la foto lleva el número de caso', foto.pie.includes('[CASO-1001]'), true);
    verificar('el contacto de acceso también', acceso.texto.includes('[CASO-1001]'), true);

    // Y va la DIRECCIÓN, no el nombre interno del edificio. Mandarle los dos, uno atrás del otro,
    // lo deja sin saber si son dos direcciones o una.
    verificar('la foto dice la dirección', foto.pie.includes('Calle Falsa 123'), true);
    verificar('el contacto de acceso también', acceso.texto.includes('Calle Falsa 123'), true);
}

console.log('\n── META VUELVE A RECHAZAR: NO SE MARCA COMO ENTREGADO ──');
{
    // Este es el bug que hacía que el técnico se quedara sin la foto para siempre: si se marca
    // igual, la marca impide el reintento y no hay segunda oportunidad.
    const { fn, hecho } = armar({ metaAcepta: false });
    const quedaPendiente = await fn(caso);

    verificar('se intentó mandar igual', hecho.envios.length, 2);
    verificar('NO se marcó nada como entregado', hecho.marcas, []);
    verificar('tampoco se anotó en el chat un envío que no salió', hecho.chat, []);
    verificar('avisa que quedó pendiente, para reintentar', quedaPendiente, true);
}

console.log('\n── LO QUE YA LE LLEGÓ NO SE MANDA DE NUEVO ──');
{
    const { fn, hecho } = armar({ yaEnviadoMaterial: true, yaAvisadoContacto: true });
    const quedaPendiente = await fn(caso);

    verificar('no se le repite nada', hecho.envios, []);
    verificar('no se vuelve a marcar', hecho.marcas, []);
    verificar('no queda pendiente', quedaPendiente, false);
}

console.log('\n── SOLO FALTABA UNA DE LAS DOS COSAS ──');
{
    const { fn, hecho } = armar({ yaEnviadoMaterial: true, yaAvisadoContacto: false });
    await fn(caso);
    verificar('sale solo el contacto de acceso', hecho.envios.map(e => e.que), ['texto']);
    verificar('y solo se marca ese', hecho.marcas, ['contacto']);
}

console.log('\n── NO HAY NADA QUE ENTREGAR ──');
{
    const { fn, hecho } = armar({ hayMaterial: false, contactoAcceso: '' });
    const quedaPendiente = await fn(caso);

    verificar('no se manda nada', hecho.envios, []);
    verificar('no se inventa una marca', hecho.marcas, []);
    verificar('no queda pendiente', quedaPendiente, false);
}

console.log('\n── SIN CASO NO SE HACE NADA ──');
{
    // Sin id de caso no se sabe de qué trabajo estaríamos hablando: mandarle una foto suelta a un
    // técnico que escribió por otra cosa es peor que no mandarle nada.
    const { fn, hecho } = armar({});
    const quedaPendiente = await fn({ ...caso, idEvento: '' });
    verificar('no se manda nada', hecho.envios, []);
    verificar('devuelve que no hay pendientes', quedaPendiente, false);
}

console.log('\n── UN ERROR NO SE TRAGA EL PENDIENTE ──');
{
    // Si algo revienta en el medio (Sheets caído, disco lleno), el pendiente tiene que seguir
    // marcado como pendiente. Tragarse el error y devolver "listo" es la forma más silenciosa de
    // perder la foto.
    const { fn, hecho } = armar({});
    const quedaPendiente = await fn({ ...caso, telVecino: null });
    verificar('la foto igual salió', hecho.envios.filter(e => e.que === 'imagen').length, 1);
    verificar('devuelve un booleano, no undefined', typeof quedaPendiente, 'boolean');
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);

})();
