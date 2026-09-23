// LEER EL TOTAL DE UNA EXPENSA, Y SABER CUÁNDO NO MOSTRARLO
//
// El administrador sube el documento de cada unidad desde el panel; acá se lee la unidad, el
// período, el total y el vencimiento para que el vecino los vea en su portal sin abrir el PDF.
//
// ── POR QUÉ ESTO ESTÁ SEPARADO DEL LECTOR ───────────────────────────────────
//
// > [!CAUTION]
// > **Un número sacado por OCR que el vecino lee como "lo que debo" es plata de una persona
// > real.** No es el mismo riesgo que una factura de un técnico: ahí el error lo mira el
// > administrador antes de pagar. Acá lo lee alguien que va a transferir.
//
// Es el mismo problema que hizo escribir la verificación del CBU: un 8 leído como 6 en una foto
// sacada de costado no lo ve nadie. Y un total mal leído tiene dos formas de doler, las dos
// invisibles: si es de menos, el vecino paga de menos y queda en deuda sin saberlo; si es de más,
// paga de más y el administrador tiene que devolverle.
//
// De los dos errores posibles --mostrar un número equivocado, o no mostrar ninguno-- el que se
// puede deshacer es el segundo. **Sin confianza no se muestra número**: queda el documento, que
// es la verdad, a un toque de distancia.
//
// Por eso la decisión (`montoConfiable`) vive acá, separada de la llamada al modelo, y se prueba
// con casos reales sin necesitar la clave de Gemini ni internet.

'use strict';

const fs = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// EL MONTO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pasa a número lo que el modelo devolvió como texto.
 *
 * > [!CAUTION]
 * > **En Argentina el punto separa los miles y la coma los decimales.** `parseFloat("85.420,50")`
 * > devuelve **85**: corta en el primer carácter que no entiende. Leer un total de $85.420 como
 * > $85 no es un error de redondeo, es otra cifra.
 *
 * Devuelve `null` cuando no hay un número que se pueda afirmar. No devuelve 0: un cero es una
 * expensa paga, y eso es una afirmación distinta de "no pude leerlo".
 */
function montoANumero(texto) {
    if (typeof texto === 'number') return Number.isFinite(texto) && texto >= 0 ? texto : null;

    const t = String(texto || '').trim();
    if (!t) return null;

    // Se saca todo lo que no sea dígito, punto o coma: el signo, la moneda, los espacios.
    const soloNumero = t.replace(/[^\d.,]/g, '');
    if (!soloNumero) return null;

    const tieneComa = soloNumero.includes(',');
    const tienePunto = soloNumero.includes('.');

    let normalizado;
    if (tieneComa && tienePunto) {
        // El último de los dos manda: el que está más a la derecha es el decimal.
        normalizado = soloNumero.lastIndexOf(',') > soloNumero.lastIndexOf('.')
            ? soloNumero.replace(/\./g, '').replace(',', '.')   // 85.420,50 → 85420.50
            : soloNumero.replace(/,/g, '');                     // 85,420.50 → 85420.50
    } else if (tieneComa) {
        // Una coma sola: decimal si deja 1 o 2 dígitos detrás, miles si deja 3.
        const detras = soloNumero.length - soloNumero.lastIndexOf(',') - 1;
        normalizado = detras === 3 ? soloNumero.replace(/,/g, '') : soloNumero.replace(',', '.');
    } else if (tienePunto) {
        // Lo mismo con el punto. `85.420` son ochenta y cinco mil, no ochenta y cinco con cuarenta.
        const detras = soloNumero.length - soloNumero.lastIndexOf('.') - 1;
        normalizado = detras === 3 ? soloNumero.replace(/\./g, '') : soloNumero;
    } else {
        normalizado = soloNumero;
    }

    const n = Number(normalizado);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * ¿Se le puede mostrar este monto a un vecino, afirmado?
 *
 * Devuelve `{ mostrar, monto, motivo }`. Cuando `mostrar` es false, el portal enseña el documento
 * y nada más — nunca un número tentativo, ni un "aproximadamente".
 */
function montoConfiable(lectura, { minimo = 1, maximo = 100000000 } = {}) {
    const no = (motivo) => ({ mostrar: false, monto: null, motivo });

    if (!lectura || typeof lectura !== 'object') return no('no se pudo leer el documento');
    if (lectura.es_expensa === false) return no('el documento no parece una liquidación de expensas');

    const monto = montoANumero(lectura.total);
    if (monto === null) return no('no se leyó ningún total');

    // El propio modelo tiene que poder decir que no está seguro. Sin esto, la única señal sería
    // que el número "parezca raro", y un número equivocado casi siempre parece razonable.
    if (lectura.total_legible === false) return no('el total no se lee con claridad en el documento');

    // Un cero es una afirmación fuerte --"no debés nada"-- y casi siempre es una lectura fallida.
    if (monto < minimo) return no(`el total leído (${monto}) es demasiado bajo para ser una expensa`);

    // Y un número absurdamente grande suele ser dos campos pegados, o un CUIT leído como importe.
    if (monto > maximo) return no(`el total leído (${monto}) es demasiado alto: puede ser otro campo`);

    return { mostrar: true, monto, motivo: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// LA UNIDAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deja la unidad en una forma comparable, sin inventar ninguna.
 *
 * El vecino tiene su unidad en `usuario_unidades` escrita por una persona y el documento la trae
 * escrita por el sistema de expensas del administrador: `1° A`, `1A`, `1 A`, `Dto 1 A`. Si no
 * coinciden, el vecino no ve su expensa y no hay ningún error en ningún log.
 */
function normalizarUnidad(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        // "depto", "dto", "unidad", "uf" son ruido de formulario, no parte de la unidad.
        .replace(/\b(departamento|depto|dpto|dto|unidad|uf|piso)\b/g, ' ')
        .replace(/[°ºª.\-_/]/g, ' ')
        .replace(/\s+/g, '')
        .trim();
}

/** ¿Son la misma unidad, escritas distinto? Exacto sobre la forma normalizada, nunca parcial. */
function mismaUnidad(a, b) {
    const na = normalizarUnidad(a);
    const nb = normalizarUnidad(b);
    // Sin dato no se afirma nada: que falte es la condición normal de un formulario a medias, no
    // una autorización. Es el mismo agujero que tenía el timbre con `!edNorm`.
    if (!na || !nb) return false;
    return na === nb;
}

// ─────────────────────────────────────────────────────────────────────────────
// EL LECTOR
// ─────────────────────────────────────────────────────────────────────────────

const INSTRUCCIONES = `Sos un lector de liquidaciones de expensas de consorcios argentinos.
Analizá el documento adjunto y devolvé SOLO JSON válido, sin markdown ni backticks.

{
  "es_expensa": true si el documento es una liquidación o cupón de expensas, false si no,
  "unidad": "la unidad o departamento al que corresponde (ej: 1° A, 4B, PB 2). Vacío si es la liquidación general del edificio o si no figura.",
  "periodo": "el período liquidado (ej: Agosto 2026). Vacío si no figura.",
  "total": "el importe TOTAL A PAGAR por esa unidad, tal cual figura, con sus puntos y comas",
  "total_legible": true si el total se lee con total claridad, false si alguna cifra es dudosa,
  "vencimiento": "la fecha del primer vencimiento en formato DD/MM/AAAA. Vacío si no figura."
}

REGLAS QUE NO SE NEGOCIAN:

1. El "total" es lo que esa unidad TIENE QUE PAGAR. No es el total del edificio, ni el subtotal
   de un rubro, ni el saldo anterior. Si hay varios importes, es el que está señalado como total
   a pagar, importe a abonar o similar.

2. NO completes, no corrijas ni adivines ninguna cifra que no se lea con claridad. Si alguna
   cifra del total es dudosa, poné "total_legible": false. Un vecino va a transferir ese número:
   un dígito inventado le hace pagar de menos y quedar en deuda, o pagar de más.

3. Si el documento es la liquidación GENERAL del edificio --la que muestra en qué se gastó, sin
   una unidad concreta-- devolvé "unidad": "" y el total del edificio igual. No la descartes: el
   vecino la necesita para entender por qué subió.

4. Si no es una expensa (una factura, una foto, un recibo de pago), devolvé {"es_expensa": false}.`;

/**
 * Lee el documento y devuelve lo que se puede afirmar de él.
 *
 * El resultado ya trae la decisión aplicada: `monto` es un número solo si se lo puede mostrar, y
 * `motivo` dice por qué no cuando viene vacío. Así ningún llamador tiene que acordarse de
 * consultar `montoConfiable` por su cuenta — que es exactamente cómo se saltean las reglas.
 */
async function leerExpensa({ filePath, mimeType, unidadEsperada = '' }) {
    if (!filePath || !fs.existsSync(filePath)) {
        console.warn('📄💸 Expensa: no se encontró el archivo', filePath);
        return { ok: false, motivo: 'archivo no encontrado' };
    }

    let lectura = null;
    try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const base64Data = fs.readFileSync(filePath).toString('base64');

        const respuesta = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [
                { text: 'Leé la liquidación de expensas adjunta.' },
                { inlineData: { data: base64Data, mimeType } },
            ] }],
            config: { systemInstruction: INSTRUCCIONES, temperature: 0.1 },
        });

        lectura = JSON.parse(String(respuesta.text || '').trim().replace(/```json|```/g, '').trim());
    } catch (err) {
        // Que no se pueda leer NO es un fallo del alta: la expensa se sube igual y el vecino la
        // abre. Lo que se pierde es la comodidad del número, no el documento.
        console.error('📄💸 No se pudo leer la expensa:', err.message);
        return { ok: false, motivo: 'no se pudo leer el documento' };
    }

    const veredicto = montoConfiable(lectura);
    const unidadLeida = String(lectura.unidad || '').trim();

    // Si el panel dice de qué unidad es y el documento dice otra, gana la duda: el administrador
    // pudo haber subido el archivo equivocado, y mostrarle a un vecino la expensa de otro es peor
    // que no mostrarle ninguna.
    let chocaLaUnidad = false;
    if (unidadEsperada && unidadLeida && !mismaUnidad(unidadEsperada, unidadLeida)) {
        chocaLaUnidad = true;
        console.warn(`📄💸 La expensa dice unidad "${unidadLeida}" y se está cargando como ` +
                     `"${unidadEsperada}". No se muestra el monto hasta que alguien lo mire.`);
    }

    return {
        ok: true,
        es_expensa: lectura.es_expensa !== false,
        unidad: unidadLeida,
        periodo: String(lectura.periodo || '').trim(),
        vencimiento: String(lectura.vencimiento || '').trim(),
        monto: chocaLaUnidad ? null : veredicto.monto,
        mostrar_monto: chocaLaUnidad ? false : veredicto.mostrar,
        motivo: chocaLaUnidad ? 'la unidad del documento no coincide con la que se está cargando' : veredicto.motivo,
        choca_la_unidad: chocaLaUnidad,
    };
}

module.exports = { leerExpensa, montoConfiable, montoANumero, normalizarUnidad, mismaUnidad };
