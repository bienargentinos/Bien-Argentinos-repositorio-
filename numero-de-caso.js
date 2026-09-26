/**
 * QUÉ NÚMERO DE CASO DICE UN MENSAJE
 *
 * > [!CAUTION]
 * > **Nadie contesta un número de caso de una sola forma**, y esta lectura estaba escrita DOS veces
 * > en `index.js`: bien en la rama de facturas y mal en el selector de reclamo resuelto.
 *
 * EL CASO REAL (13/09). Marcos le mostró al técnico la lista de casos abiertos para que dijera cuál
 * había resuelto:
 *
 *     📋 MARCOS — SELECCIÓN DE RECLAMO SOLUCIONADO
 *     1️⃣ [CASO-1001]: Puerta de entrada del edificio San Patricio 159…
 *     2️⃣ [CASO-1002]: …
 *     ¿Cuál de estos inconvenientes es el que quedó solucionado? Podés responder con el número (ej: 1 o 2).
 *
 * Él contestó **"1002 caso"** y el selector hacía:
 *
 *     const numSel = parseInt(msgClean.replace(/\D/g, ''), 10);   // -> 1002
 *     if (numSel >= 1 && numSel <= casosP.length) { ... }         // 1002 <= 2 es falso
 *
 * No matcheó, cayó a la rama del proveedor, y ahí se contestó como si estuviera preguntando por el
 * contacto de ingreso. **El caso quedó abierto**, y a las diez horas la cadena de seguimiento le
 * preguntó al técnico, después al vecino, y terminó mandándole un mail al administrador por un
 * trabajo que estaba hecho y facturado.
 *
 * Lo que lo vuelve peor: **la lista imprime `[CASO-1001]` y después pide "1 o 2"**. Invita justo a
 * la respuesta que no sabe leer.
 *
 * Es el mismo defecto que ya está documentado en CLAUDE.md para la imputación de una factura --allá
 * la condición pedía la palabra `CASO` pegada adelante y la lista pedía UN dígito--. Se arregló ahí
 * y quedó sin arreglar acá. Por eso vive en un archivo: la próxima rama que lo necesite llama, no
 * copia. Es exactamente lo que pasó con `buscarPerfilEdificio`, escrito dos veces, donde arreglar
 * una copia no cambió nada en producción.
 */

/**
 * El número de caso que nombra el texto, como string de dígitos sin ceros de adelante.
 * Devuelve `null` cuando el texto no nombra ninguno.
 *
 * Las tres formas que se aceptan, y por qué cada una:
 *
 * 1. **`CASO 1001`, `caso-1001`, `caso: 1001`** — la forma canónica, en cualquier separador.
 * 2. **`1001 es el caso`, `1002 caso`** — el número ADELANTE. Es como contesta la mitad de la gente
 *    y era la que faltaba.
 * 3. **`1001` solo** — el número pelado, de 3 dígitos o más. A esta altura de la conversación
 *    Marcos ya preguntó de qué caso se trata, así que "1002" a secas no puede ser otra cosa.
 *
 * > [!CAUTION]
 * > **Un número de 1 o 2 dígitos solo NO se toma como caso.** "2" contestado a una lista de dos
 * > opciones es la posición 2, no el CASO-2. Los códigos reales arrancan en 1001, así que exigir
 * > tres dígitos separa las dos cosas sin ambigüedad. Y un monto, una cantidad o un número de
 * > factura tampoco entran por acá.
 */
function numeroDeCasoEnTexto(texto) {
    const t = String(texto || '');
    if (!t.trim()) return null;

    const crudo =
        (t.match(/\bCASO[\s:\-]*0*(\d{2,})\b/i) || [])[1]
        // El número primero: "1002 caso", "1001 es el caso". La ventana de 20 caracteres evita
        // enganchar un número de una frase y la palabra "caso" de la siguiente.
        || (t.match(/\b0*(\d{3,})\b(?=[^]{0,20}\bcaso\b)/i) || [])[1]
        || (t.trim().match(/^#?0*(\d{3,})$/) || [])[1];

    return crudo ? String(parseInt(crudo, 10)) : null;
}

/**
 * De una lista de casos ofrecida a alguien, cuál eligió con su respuesta.
 *
 * Acepta las dos formas que una persona usa de verdad: el **número de caso** ("1002 caso") y la
 * **posición en la lista** ("el 2"). Devuelve `null` si la respuesta no nombra ninguno de los dos,
 * que es cuando corresponde volver a preguntar en vez de adivinar.
 *
 * @param {string} respuesta  Lo que contestó.
 * @param {Array}  casos      Los casos que se le ofrecieron, en el orden en que se listaron.
 * @param {function} codigoDe Cómo leer el código de un caso (`c => c.id_evento`).
 */
function casoElegidoDeLista(respuesta, casos, codigoDe = (c) => c && c.id_evento) {
    if (!Array.isArray(casos) || !casos.length) return null;

    // EL CÓDIGO SE MIRA PRIMERO, y el orden importa: un código es una respuesta inequívoca, una
    // posición depende de cómo se armó la lista. Si alguien dice "1002" sobre una lista de dos, la
    // posición 1002 no existe y el código sí.
    const num = numeroDeCasoEnTexto(respuesta);
    if (num) {
        const porCodigo = casos.find(c => {
            const m = String(codigoDe(c) || '').match(/(\d+)/);
            return m && String(parseInt(m[1], 10)) === num;
        });
        if (porCodigo) return porCodigo;
    }

    // La posición en la lista: "1", "el 2", "la 3". Solo números chicos y dentro del rango.
    const soloDigitos = String(respuesta || '').replace(/\D/g, '');
    const pos = parseInt(soloDigitos, 10);
    if (!isNaN(pos) && pos >= 1 && pos <= casos.length && soloDigitos.length <= 2) {
        return casos[pos - 1];
    }

    return null;
}

/**
 * El número de COMPROBANTE que nombra el texto, cuando además nombra un caso.
 *
 * > [!CAUTION]
 * > **Un número de factura y un número de caso se parecen: los dos son de tres o cuatro dígitos.**
 * > En *"la 639 es del 1002"* hay uno de cada uno, y confundirlos manda el gasto al consorcio
 * > equivocado.
 *
 * Existe porque Daniel manda varias facturas de una sola vez y puede tener que corregir más de una:
 * *"¿cómo corrijo otras si solo colocás la última para corregir?"*. Nombrar el comprobante es la
 * forma de elegir cuál.
 *
 * > [!CAUTION]
 * > **Se exige que el texto DIGA que es una factura**, y no es exceso de cuidado: la primera versión
 * > buscaba "cualquier otro número que no sea el del caso", y en *"no, 1002 es el caso no el 1003"*
 * > leyó **1003 como número de comprobante** cuando es el caso que él está rechazando. Con eso no
 * > habría movido nada, en la frase más natural de todas.
 *
 * Con la palabra exigida, un falso positivo es casi imposible. El precio es que *"la 639 es del caso
 * 1002"* no nombra factura y se mueve la última — y como Marcos contesta **cuál** movió, él puede
 * corregir otra vez diciendo "la factura 639". Ese error se ve y se deshace.
 *
 * Devuelve `null` cuando el texto no nombra un comprobante, que es el caso normal.
 */
function numeroDeFacturaEnTexto(texto) {
    const t = String(texto || '');
    if (!t.trim()) return null;

    // La palabra tiene que estar, y el número cerca: antes o después.
    const PISTA = 'factura|comprobante|recibo|remito|n[°º]|nro|n[uú]mero';
    const crudo =
        (t.match(new RegExp(`\\b(?:${PISTA})\\b[^\\d]{0,12}([\\d.\\-/]{3,})`, 'i')) || [])[1]
        || (t.match(new RegExp(`([\\d.\\-/]{3,})[^\\d]{0,12}\\b(?:${PISTA})\\b`, 'i')) || [])[1];

    const limpio = String(crudo || '').replace(/\D/g, '').replace(/^0+/, '');
    if (limpio.length < 3) return null;

    // Si lo que se leyó es el número del caso, no es un comprobante: pasa en "el caso 1002" cuando
    // la palabra "factura" anda cerca en la misma frase.
    return limpio === numeroDeCasoEnTexto(t) ? null : limpio;
}

module.exports = { numeroDeCasoEnTexto, casoElegidoDeLista, numeroDeFacturaEnTexto };
