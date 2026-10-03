/**
 * CUÁNDO DOS NOMBRES SON EL MISMO EDIFICIO
 *
 * > [!CAUTION]
 * > **No hay un id de edificio: el nombre ES la clave**, y está escrito a mano en las dos bases y
 * > en una docena de pestañas. Así que todo el sistema depende de comparar dos textos bien.
 *
 * Y "bien" acá quiere decir dos cosas a la vez, que tiran para lados opuestos:
 *
 * - **Tolerante con la forma**: `San Patricio 270`, `san patricio 270` y `San Patrício 270` son el
 *   mismo consorcio escrito por tres personas distintas. Si no se normaliza, el edificio
 *   "desaparece" de su administrador — eso ya pasó y está documentado en CLAUDE.md.
 * - **Intolerante con el contenido**: `San Patricio 270` y `San Patricio 159` son **dos consorcios
 *   distintos**. Con una comparación parcial (`includes`) el 159 queda adentro del 270.
 *
 * > [!CAUTION]
 * > **NO usar `compararEdificios` para esto.** Ese acepta coincidencias parciales, que sirve para
 * > adivinar a qué edificio se refiere un vecino en un mensaje de WhatsApp, y es exactamente lo
 * > que NO se quiere cuando lo que está en juego es un permiso o una puerta.
 *
 * Esta comparación es **normalizada y exacta**, el mismo criterio que `clienteDelEdificio` en
 * `dashboard.js`. Vive acá porque la portería la necesita y copiarla habría sido la tercera copia:
 * `normEdificio` ya está escrita dos veces adentro de `dashboard.js` (líneas 411 y 11424). Es el
 * mismo patrón de `buscarPerfilEdificio`, que quedó duplicada y donde arreglar una copia no cambió
 * nada en producción.
 */

/**
 * El nombre del edificio reducido a su forma comparable: sin acentos, sin mayúsculas, sin signos
 * y con un solo espacio entre palabras. Devuelve `''` cuando no hay nombre.
 */
function claveEdificio(txt) {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * ¿Son el mismo edificio?
 *
 * > [!CAUTION]
 * > **Dos vacíos NO son el mismo edificio.** Es la regla que más importa de todo el archivo: si un
 * > pedido llega sin decir de qué edificio es, la respuesta correcta es "no sé", no "todos". Esa
 * > confusión --tratar la falta de dato como comodín-- es la que hacía que el timbre de un
 * > consorcio sonara en el teléfono de un vecino de otro.
 */
function mismoEdificio(a, b) {
    const ka = claveEdificio(a);
    const kb = claveEdificio(b);
    if (!ka || !kb) return false;
    return ka === kb;
}

/**
 * La unidad (departamento) reducida a su forma comparable: `4°B`, `4 B` y `4b` son la misma.
 *
 * > [!CAUTION]
 * > **La comparación también es exacta.** La versión vieja aceptaba que uno contuviera al otro, y
 * > con eso el departamento `1` matcheaba con `1A`, `1B` y `11`. Dentro de un mismo edificio eso
 * > es el mismo error que el de arriba, en chico.
 */
function claveUnidad(txt) {
    return String(txt || '').normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

module.exports = { claveEdificio, mismoEdificio, claveUnidad };
