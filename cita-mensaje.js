// LO QUE ESCRIBIÓ LA PERSONA, SEPARADO DE LO QUE CITÓ
//
// > [!CAUTION]
// > **Cuando alguien responde citando un mensaje, WhatsApp manda las dos cosas y nosotros las
// > pegábamos en un solo texto.** Desde ahí, cada condición por texto leía las palabras de Marcos
// > como si las hubiera escrito el técnico.
//
// EL CASO QUE LO ORIGINÓ. Marcos preguntó de qué obra era una factura. El técnico contestó
// **"1001 es el caso"** citando ese mensaje, y `index.js` armó:
//
//     1001 es el caso [Cita el mensaje: "Perfecto a dario juju, recibida la factura…"]
//
// La condición que decide si un mensaje es un comprobante busca la palabra `factura` en el texto
// (`esFacturaODoc`, index.js). La palabra estaba — pero la había escrito Marcos. Resultado: la
// respuesta se registró como una SEGUNDA factura, con monto "Según comprobante" y sin número,
// al lado de la que de verdad había llegado un minuto antes. El administrador ve dos gastos donde
// hay uno.
//
// Y no es una condición en particular: son las ~69 condiciones de la rama del proveedor. La cita
// puede contener cualquier palabra que Marcos haya escrito antes — "foto", "pago", "cerradura",
// el nombre de otro edificio — así que **cualquiera** de ellas puede dispararse con las palabras
// equivocadas. Es el mismo defecto de fondo que los acentos y que `\b`: decidir por coincidencia
// de texto sobre un texto que no es el que la persona escribió.
//
// LA CITA NO SE TIRA. Es contexto real y bueno: dice a cuál de los mensajes anteriores está
// contestando. Lo que cambia es a dónde va:
//
//   · **Las decisiones** (regex, ruteo, si es factura, qué edificio nombró) leen SOLO lo que él
//     escribió.
//   · **El modelo y el historial del caso** reciben la cita aparte y etiquetada, que es donde
//     sirve: leer y entender es justo lo que sabe hacer.

/** Las dos formas en que `index.js` pega una cita al mensaje entrante. */
const MARCA_CITA = /\[Cita el mensaje:\s*"([\s\S]*?)"\]/g;
const MARCA_SIN_TEXTO = /\[En respuesta al mensaje\/notificaci[oó]n anterior\]/g;

/**
 * Parte un mensaje entrante en lo que la persona escribió y lo que citó.
 *
 * Devuelve `{ texto, cita }`. Si el mensaje es SOLO una cita (contestó sin escribir nada), el
 * texto vuelve tal como vino: quedarse con la cadena vacía sería peor -- aguas abajo un mensaje
 * sin texto se descarta, y ahí se perdería la vuelta entera.
 */
function separarCita(entrada) {
    const original = String(entrada || '');
    const citas = [];

    let propio = original.replace(MARCA_CITA, (_, citado) => {
        const c = String(citado || '').trim();
        if (c) citas.push(c);
        return ' ';
    });
    propio = propio.replace(MARCA_SIN_TEXTO, ' ').replace(/\s+/g, ' ').trim();

    const cita = citas.join(' … ').trim();
    if (!propio) return { texto: original.trim(), cita: '' };
    return { texto: propio, cita };
}

/**
 * Vuelve a juntarlos para lo que SÍ tiene que ver la cita: el modelo y el historial del caso.
 * Se etiqueta con todas las letras de quién es cada parte, para que el modelo no la confunda con
 * lo que dijo la persona -- que es exactamente el error que se está arreglando.
 */
function conCita(texto, cita) {
    const t = String(texto || '').trim();
    const c = String(cita || '').trim();
    if (!c) return t;
    return `${t} [respondiendo a un mensaje anterior que decía: "${c}"]`.trim();
}

module.exports = { separarCita, conCita };
