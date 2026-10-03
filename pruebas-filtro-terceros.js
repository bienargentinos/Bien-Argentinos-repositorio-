// Verifica que un insulto o una queja del vecino NO llegue al técnico, con acentos o sin ellos.
//
//   node pruebas-filtro-terceros.js
//
// POR QUÉ. `resumen_problema` lo redacta una IA a partir de lo que contó el vecino. Cuando el
// vecino contesta de mala manera, esa IA copia sus palabras y terminan impresas en la orden de
// trabajo del técnico. El vecino nunca se entera de lo que le mandamos al proveedor, así que un
// roce social filtrado rompe una relación que él ni sabe que está en juego.
//
// > [!CAUTION]
// > **Esto se escribió y se probó contra texto TIPEADO, que casi nunca lleva acentos.**
// > Con audio la transcripción escribe español correcto, y ahí aparecieron dos agujeros distintos
// > en la misma expresión:
// >
// >   1. `\w` no incluye las vocales acentuadas: `estaf\w*` no llega a la "ó" de "estafó".
// >   2. `\b` al final tampoco: una palabra que TERMINA en vocal acentuada no tiene borde
// >      después. En "estafó", `estaf[…]+` se come la "ó" y detrás hay un espacio -- dos
// >      caracteres no-palabra seguidos, o sea ningún borde -- y la expresión entera falla.
// >
// > El segundo explica por qué "jodió" sí se filtraba y "estafó" no: en "jodió" el `+` puede
// > retroceder a "jodi", y entre la "i" y la "ó" sí hay borde. Un acento de más o de menos
// > decidía si el insulto llegaba al técnico.
//
// Las expresiones se leen del propio marcos-ops.js para que la prueba valide el código real y no
// una copia que se puede quedar vieja. No se hace `require` porque el módulo levanta el cliente de
// Gemini al cargarse.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'agentes', 'marcos-ops.js'), 'utf8');

function bloque(desde, hasta, arrancarEn = 0) {
    const ini = SRC.indexOf(desde, arrancarEn);
    if (ini === -1) throw new Error(`No encontré "${desde}" en agentes/marcos-ops.js.`);
    const fin = SRC.indexOf(hasta, ini);
    if (fin === -1) throw new Error(`No encontré el final del bloque que arranca en "${desde}".`);
    return { texto: SRC.slice(ini, fin + hasta.length), ini, fin: fin + hasta.length };
}

// Las tres expresiones: desde ANTES/DESPUES hasta el cierre de CITA, que es la última.
const iniFiltros = SRC.indexOf('const ANTES = ');
if (iniFiltros === -1) throw new Error('No encontré los bordes de palabra en agentes/marcos-ops.js.');
const filtros = SRC.slice(iniFiltros, bloque('const CITA = ', "'i');").fin);
const funcion = bloque('function limpiarParaTerceros(texto) {', '\n}').texto;

// `limpiarParaTerceros` hace `require('../etiquetas-media')` -- la ruta es relativa a `agentes/`,
// y adentro de un `new Function` no existe `require`. Se le pasa uno que resuelve desde acá.
const req = (p) => require(p.replace(/^\.\.\//, './'));

// eslint-disable-next-line no-new-func
const limpiarParaTerceros = new Function('require',
    `${filtros}\n${funcion}\nreturn limpiarParaTerceros;`)(req);
// eslint-disable-next-line no-new-func
const filtra = new Function('o',
    `${filtros}\nreturn INSULTOS.test(o) || QUEJAS.test(o) || CITA.test(o);`);

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

console.log('\n── INSULTOS CON ACENTO (lo que dicta un audio) ──');
{
    // Todos terminan en vocal acentuada: es el caso que el `\b` final dejaba pasar.
    const conAcento = [
        'me estafó el plomero',
        'este tipo nos cagó',
        'el electricista jodió todo',
        'el portero se rompió y el técnico nos cagó la semana',
        'nos jodió la instalación entera',
    ];
    for (const t of conAcento) verificar(`se filtra: "${t}"`, filtra(t), true);
}

console.log('\n── LOS MISMOS SIN ACENTO (lo que se tipea) ──');
{
    // Estos ya funcionaban. Están para que el arreglo del acento no rompa lo que andaba.
    const sinAcento = [
        'me estafo el plomero',
        'este tipo nos cago',
        'es un pelotudo',
        'el trabajo es un desastre',
        'estos chorros no vuelven mas',
        'son unos inutiles',
    ];
    for (const t of sinAcento) verificar(`se filtra: "${t}"`, filtra(t), true);
}

console.log('\n── QUEJAS DEL SERVICIO ──');
{
    const quejas = [
        'ya te avisé dos veces',            // "avisé" termina en acento
        'ya te avise dos veces',
        'ya les reclamé por esto',
        'hace tres días que nunca vienen',
        'estoy cansado de esto',
        'estamos hartos de reclamar',
        'siempre lo mismo con este edificio',
        'nadie responde nunca',
    ];
    for (const t of quejas) verificar(`se filtra: "${t}"`, filtra(t), true);
}

console.log('\n── CITAS DE LO QUE DIJO ALGUIEN ──');
{
    const citas = [
        'el vecino comentó que el tablero saltó anoche',   // "comentó", con acento
        'la vecina dijo que no hay luz en el hall',
        'el encargado manifestó que ya lo habían revisado',
        'el propietario expresó su malestar',
        'textualmente, no piensa pagar',
    ];
    for (const t of citas) verificar(`se filtra: "${t}"`, filtra(t), true);
}

console.log('\n── LO QUE TIENE QUE PASAR (una falla técnica descrita) ──');
{
    // Filtrar de más también rompe: si se descarta la oración que describe el problema, al técnico
    // le llega un genérico y va a ciegas.
    const pasan = [
        'saltó el tablero eléctrico del hall y no hay luz',
        'la cámara del palier no está funcionando desde ayer',
        'pierde agua la canilla del lavadero del 3° B',
        'el portero eléctrico no abre desde el interno',
        'hay que revisar la bomba, hace ruido',
        'se cortó un cable en la caja de la planta baja',
    ];
    for (const t of pasan) verificar(`NO se filtra: "${t}"`, filtra(t), false);
}

console.log('\n── LA PALABRA TIENE QUE ESTAR SUELTA, NO ADENTRO DE OTRA ──');
{
    // El borde de adelante existe para esto: "reputación" no es un insulto, y "cagó" adentro de
    // otra palabra tampoco. Si se filtrara de más, se descartarían oraciones técnicas legítimas.
    verificar('"reputación" no dispara put',
        filtra('la reputación del edificio no está en juego acá'), false);
    verificar('"computadora" no dispara put',
        filtra('la computadora de la portería no enciende'), false);
}

console.log('\n── LA ORACIÓN SE DESCARTA ENTERA, NO SE RECORTA LA PALABRA ──');
{
    // Recortar palabra por palabra dejaba restos como "el plomero es un." -- peor que no filtrar,
    // porque el técnico completa el insulto solo y encima queda escrito por nosotros.
    const salida = limpiarParaTerceros(
        'Saltó el tablero eléctrico del hall y no hay luz. Me estafó el plomero anterior.');
    verificar('sobrevive la falla técnica', /tablero/i.test(salida), true);
    verificar('y no queda nada del insulto', /estaf/i.test(salida), false);

    // Si NO sobrevive nada utilizable devuelve '', y el llamador pone un genérico por rubro.
    verificar('sin nada limpio devuelve vacío',
        limpiarParaTerceros('Me estafó el plomero. Este tipo nos cagó.'), '');
}

console.log('\n── LA LISTA DE ETIQUETAS DE MULTIMEDIA VIVE EN UN SOLO LUGAR ──');
{
    // El mismo día, dos personas arreglaron por separado que la etiqueta `[AUDIO:/archivos/…]` no
    // salga hacia afuera, y quedó escrita TRES veces: en `etiquetas-media.js`, en
    // `limpiarTextoProblema` de index.js y adentro de `limpiarParaTerceros` acá.
    //
    // En este repo ya sabemos cómo termina eso: `buscarPerfilEdificio` estaba duplicado y arreglar
    // una copia no cambiaba nada en producción, porque la que corría era la otra.
    const fs = require('fs');
    const path = require('path');

    // Lo que se busca es la LISTA escrita como alternativa (`AUDIO|AUDIO_URL|…`), que es la forma
    // que toma una copia. Escribir una etiqueta suelta (`[AUDIO:${url}]`) es otra cosa y está
    // bien: alguien tiene que ponerlas.
    const copia = /AUDIO\s*\|/;

    // `dashboard.js` queda afuera a propósito: su copia vive adentro del JavaScript que corre en
    // el NAVEGADOR, donde no existe `require`. Y además no limpia — arma los reproductores a
    // partir de las etiquetas, que es el trabajo opuesto.
    for (const archivo of ['index.js', 'agentes/marcos-ops.js', 'sheets.js', 'datos.js']) {
        const ruta = path.join(__dirname, archivo);
        if (!fs.existsSync(ruta)) continue;
        const sinComentarios = fs.readFileSync(ruta, 'utf8')
            .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join('\n');
        verificar(`${archivo} no tiene su propia lista de etiquetas`, copia.test(sinComentarios), false);
    }

    // Y que la compartida efectivamente las saque, incluidas las que agregó AY.
    const { soloTexto } = require('./etiquetas-media');
    verificar('saca [AUDIO:…]',
        soloTexto('[AUDIO:/archivos/x/media_446.ogg] saltó la térmica'), 'saltó la térmica');
    verificar('saca [FOTO:…] y [PDF:…]',
        soloTexto('[FOTO:/a/b.jpg] mirá [PDF:/c/d.pdf] esto'), 'mirá esto');
    verificar('sin etiquetas no toca nada',
        soloTexto('saltó la térmica del hall'), 'saltó la térmica del hall');
    verificar('si no queda texto, devuelve vacío',
        soloTexto('[AUDIO:/archivos/x.ogg]'), '');
}

console.log('\n── QUE `\\w` Y `\\b` NO VUELVAN A ESTAS EXPRESIONES ──');
{
    // Este es el candado: los dos son invisibles al leer y los dos ya se colaron una vez.
    verificar('los filtros no usan \\w', /\\w/.test(filtros), false);
    verificar('ni \\b como borde de palabra', /\\b/.test(filtros), false);
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
