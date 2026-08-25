/**
 * CBU y alias: reconocerlos en un mensaje y verificar que estén bien escritos.
 *
 * POR QUÉ IMPORTA VERIFICAR: el técnico dicta el CBU por audio o lo copia a mano, y un dígito
 * cambiado no se nota mirando — son 22 números seguidos. Si ese número queda guardado mal, el
 * pago se rechaza (con suerte) o se va a otra cuenta (sin suerte). El CBU trae dos dígitos
 * verificadores justamente para poder detectar eso antes de usarlo.
 *
 * El cálculo es el del BCRA: el CBU son 22 dígitos en dos bloques.
 *   Bloque 1 (8 dígitos):  3 de banco + 4 de sucursal + 1 verificador
 *   Bloque 2 (14 dígitos): 13 de cuenta + 1 verificador
 * Cada verificador se calcula pesando los dígitos anteriores y tomando el complemento a 10.
 */

const PESOS_BLOQUE_1 = [7, 1, 3, 9, 7, 1, 3];
const PESOS_BLOQUE_2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];

function digitoVerificador(digitos, pesos) {
    const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
    return (10 - (suma % 10)) % 10;
}

/** Deja solo los dígitos. Sirve para "0070 0599 3000 4567 8901 23" y similares. */
function soloDigitos(texto) {
    return String(texto || '').replace(/\D/g, '');
}

/**
 * Verifica un CBU.
 * @returns {{valido: boolean, motivo: string, cbu: string, banco: string}}
 */
function validarCBU(entrada) {
    const cbu = soloDigitos(entrada);

    if (!cbu) return { valido: false, motivo: 'no hay ningún número', cbu: '', banco: '' };
    if (cbu.length !== 22) {
        return {
            valido: false,
            motivo: `tiene ${cbu.length} dígitos y un CBU tiene 22`,
            cbu,
            banco: '',
        };
    }

    const bloque1 = cbu.slice(0, 8);
    const bloque2 = cbu.slice(8);

    if (digitoVerificador(bloque1, PESOS_BLOQUE_1) !== Number(bloque1[7])) {
        return { valido: false, motivo: 'el primer bloque no verifica (banco/sucursal)', cbu, banco: '' };
    }
    if (digitoVerificador(bloque2, PESOS_BLOQUE_2) !== Number(bloque2[13])) {
        return { valido: false, motivo: 'el segundo bloque no verifica (número de cuenta)', cbu, banco: '' };
    }

    return { valido: true, motivo: '', cbu, banco: cbu.slice(0, 3) };
}

/**
 * Verifica un alias (el nombre corto que reemplaza al CBU).
 *
 * Reglas del BCRA: de 6 a 20 caracteres, letras, números, puntos y guiones. No lleva espacios ni
 * acentos, así que un "alias" con espacios casi seguro es una frase y no un alias.
 */
function validarAlias(entrada) {
    const alias = String(entrada || '').trim();
    if (!alias) return { valido: false, motivo: 'está vacío', alias: '' };
    if (alias.length < 6 || alias.length > 20) {
        return { valido: false, motivo: `tiene ${alias.length} caracteres y un alias va de 6 a 20`, alias };
    }
    if (!/^[A-Za-z0-9.\-]+$/.test(alias)) {
        return { valido: false, motivo: 'solo puede llevar letras, números, puntos y guiones', alias };
    }
    return { valido: true, motivo: '', alias: alias.toLowerCase() };
}

/**
 * Busca un CBU en un texto libre.
 *
 * Tiene que aguantar cómo se manda de verdad: "CBU 0070059930004567890123", con espacios cada
 * cuatro dígitos, o dictado. Se buscan tiradas de 22 dígitos permitiendo espacios, puntos y
 * guiones en el medio, y se valida cada candidato: así un número de 22 dígitos que no sea un CBU
 * no se confunde con uno.
 */
function buscarCBUEnTexto(texto) {
    const t = String(texto || '');
    const candidatos = t.match(/(?:\d[\s.\-]?){21}\d/g) || [];
    for (const c of candidatos) {
        const r = validarCBU(c);
        if (r.valido) return r;
    }
    // Si ninguno validó, se devuelve el primero para poder explicar POR QUÉ no sirve, en vez de
    // decir "no encontré nada" cuando la persona claramente mandó un número.
    return candidatos.length ? validarCBU(candidatos[0]) : null;
}

/**
 * Busca un alias en un texto, pero solo cuando la persona lo nombra.
 *
 * Sin la palabra "alias" no se busca nada: cualquier palabra suelta de 6 a 20 letras cumpliría el
 * formato, y "necesito" o "gracias" pasarían por alias. La palabra es lo que da la intención.
 */
function buscarAliasEnTexto(texto) {
    const t = String(texto || '');
    const m = t.match(/\balias\b[\s:=]*([A-Za-z0-9.\-]{6,20})/i);
    if (!m) return null;
    return validarAlias(m[1]);
}

/** Los últimos 4 dígitos, para confirmar sin repetir los 22 en pantalla. */
function ultimos4(cbu) {
    const d = soloDigitos(cbu);
    return d.length >= 4 ? d.slice(-4) : d;
}

module.exports = {
    validarCBU,
    validarAlias,
    buscarCBUEnTexto,
    buscarAliasEnTexto,
    soloDigitos,
    ultimos4,
};
