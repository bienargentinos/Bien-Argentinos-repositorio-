/**
 * ¿ESTE MENSAJE PODRÍA SER UN AVISO DE TRABAJO TERMINADO?
 *
 * Es el filtro **barato y amplio**, no la decisión. Acá entra todo lo que *podría* ser un aviso de
 * trabajo terminado --incluso negado o a futuro--; quién decide de verdad es el modelo
 * (`informa_resuelto`) y, abajo de él, `diceQueSeResolvio` en `index.js`. Si esto se hace estricto
 * vuelve el problema de siempre: una lista de palabras decidiendo.
 *
 * ## Por qué vive en su propio archivo
 *
 * Porque lo preguntan **dos lugares a dos mil líneas de distancia**, y escribir la misma expresión
 * dos veces es exactamente lo que pasó con `buscarPerfilEdificio`:
 *
 *   1. **Antes de entregarle lo pendiente** (`index.js`, ~1700): a alguien que acaba de decir que
 *      terminó no se le manda la foto del problema ni el contacto de quien le abre la puerta.
 *   2. **Antes de llamar al modelo** (`index.js`, ~2160): para no pagar una clasificación en cada
 *      mensaje de un proveedor.
 *
 * ## El uso 1 es una supresión, y por eso conviene que sea amplio
 *
 * > [!CAUTION]
 * > **De los dos errores posibles, el barato es no entregar.** Si se suprime de más, lo pendiente
 * > sigue pendiente y sale en el próximo mensaje del técnico --`pendientesResueltosDe` no se
 * > marca--. Si se entrega de más, al técnico le llega el trabajo de nuevo justo cuando avisó que
 * > lo terminó, y ahí lo repite.
 *
 * Producción, 26/09 23:55, y es el episodio que motivó este archivo:
 *
 *     23:55  Dario:   "Hola ya termine"
 *     23:56  MARCOS:  📷 FOTO DEL RECLAMO [CASO-1005]
 *     23:56  MARCOS:  ¿QUIÉN LE ABRE AL TÉCNICO EN SAN PATRICIO 159?
 *     23:56  MARCOS:  ✅ Listo Dario, marqué el CASO-1005 como RESUELTO
 *     23:58  Dario:   "Ya finalice"
 *
 * Avisó que terminó y Marcos le contestó con la foto del problema y con quién le iba a abrir la
 * puerta. El cierre salió bien --el ✅ está ahí-- pero llegó **después** de tres mensajes que
 * decían lo contrario, así que lo repitió. Y ahí se comió el segundo defecto: con el CASO-1005 ya
 * cerrado, Marcos le preguntó cuál de los otros dos había terminado.
 *
 * Es el defecto de fondo de siempre, con otro disfraz: **la información estaba, el orden no.**
 */

'use strict';

/**
 * Amplio a propósito. Incluye el presente y las formas sin tilde: acá no se decide nada, se decide
 * si vale la pena preguntar.
 */
const SUENA_A_TERMINADO =
    /termin|finaliz|finalic|resolv|resuelt|solucion|arregl|repar|\blist[oa]\b|complet|qued[oó]|ya est[aá]|\bhecho\b|\blisto\b/i;

/** @param {string} texto lo que escribió el técnico, sin la cita del mensaje anterior. */
function pareceAvisoDeTerminado(texto) {
    return SUENA_A_TERMINADO.test(String(texto || ''));
}

/**
 * Lo niega: *"todavía no terminé"*, *"no se resolvió"*, *"aún no lo arreglé"*.
 *
 * Trae **las mismas palabras** que el aviso de terminado, así que sin esto cualquier mensaje que
 * diga que el trabajo NO está hecho parecería decir que sí.
 */
const LO_NIEGA = /\bno\s+(se\s+|me\s+|lo\s+|la\s+)*(qued|resolv|solucion|arregl|funciona|anda|termin|finaliz|vino|pas[oó])/i;

/** @param {string} texto */
function niegaQueTermino(texto) {
    return LO_NIEGA.test(String(texto || ''));
}

/**
 * Para **suprimir** la entrega de lo pendiente: dice que terminó y no lo está negando.
 *
 * > [!CAUTION]
 * > **La negación tiene que descontarse acá, aunque el filtro de arriba sea amplio a propósito.**
 * > *"todavía no terminé"* pasa `pareceAvisoDeTerminado` --trae la palabra-- y es justo el mensaje
 * > de alguien que **sí** necesita la foto y el contacto de ingreso. Suprimirlo ahí no cuesta una
 * > vuelta: si los mensajes siguientes también lo niegan, no se le entrega nunca, que es el
 * > problema que esta entrega vino a resolver.
 *
 * El filtro amplio se queda amplio para lo suyo --decidir si vale la pena preguntarle al modelo--,
 * donde un negado de más no hace daño: el modelo lo lee y dice que no.
 */
function avisaQueTermino(texto) {
    return pareceAvisoDeTerminado(texto) && !niegaQueTermino(texto);
}

module.exports = {
    pareceAvisoDeTerminado, avisaQueTermino, niegaQueTermino,
    SUENA_A_TERMINADO, LO_NIEGA,
};
