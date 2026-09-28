/**
 * A QUIÉN SE LE AVISÓ UN CASO — la marca de "técnico avisado" es por técnico, no por caso
 *
 * > [!CAUTION]
 * > **La marca `tecnico_notificado` decía CUÁNDO se avisó, no A QUIÉN.** Y la memoria del proceso
 * > la guardaba por TELÉFONO.
 *
 * Prueba de cerrajería, 28/09. Un reclamo de cerradura se pegó al CASO-1003, que era de Dario y ya
 * tenía la marca puesta. El caso pasó a ser de lalala, pero Marcos leyó "este caso ya avisó a su
 * técnico" y a lalala no le mandó la plantilla nunca:
 *
 *     ℹ️ [Sheets] Técnico ya notificado del [CASO-1003] (detectado tras reinicio), se omite el reenvío duplicado.
 *
 * Un caso cambia de técnico --pasa al suplente en el paso 3 del seguimiento, o el administrador lo
 * reasigna-- y el técnico nuevo necesita su plantilla: es lo único que abre la ventana de 24hs de
 * Meta. Por teléfono tampoco sirve: una línea puede ser de varios técnicos (julio y Dario comparten
 * la de prueba, y lalala también).
 *
 * Ahora la marca guarda `fecha → nombre`, y "ya avisado" quiere decir "ya avisado A ESTE técnico".
 *
 * **Una marca vieja, sin nombre, NO cuenta como avisado a este técnico.** No se sabe a quién se le
 * avisó, y de los dos errores posibles se elige el barato: en el peor caso el técnico recibe la
 * plantilla una vez más (y la marca queda con su nombre, así que no se repite). El otro error es
 * el de la prueba: un técnico que no se entera nunca y un caso que no avanza.
 */

const SEPARADOR = ' → ';

const normalizar = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

/** Lo que se escribe en la celda. La columna de PostgreSQL es VARCHAR(100): el nombre se recorta. */
function marcaDeAviso(fecha, nombreTecnico) {
    const nombre = String(nombreTecnico || '').trim().slice(0, 60);
    return nombre ? `${fecha}${SEPARADOR}${nombre}` : String(fecha);
}

/** A quién dice la marca que se le avisó. `null` si la marca es vieja (sin nombre) o no hay marca. */
function avisadoA(marca) {
    const m = String(marca || '');
    const i = m.indexOf(SEPARADOR);
    return i === -1 ? null : m.slice(i + SEPARADOR.length).trim() || null;
}

/**
 * ¿Esta marca dice que ya se le avisó a ESTE técnico?
 * Sin `nombreTecnico` se contesta como antes (hay marca o no), para quien no sepa a quién pregunta.
 */
function yaAvisado(marca, nombreTecnico) {
    if (!String(marca || '').trim()) return false;
    if (!String(nombreTecnico || '').trim()) return true;
    const quien = avisadoA(marca);
    if (!quien) return false;   // marca vieja: no se sabe a quién, se le avisa a este
    return mismoTecnico(quien, nombreTecnico);
}

/** Mismo técnico por nombre, tolerante con mayúsculas, acentos y espacios. */
const mismoTecnico = (a, b) => normalizar(a) === normalizar(b);

module.exports = { marcaDeAviso, avisadoA, yaAvisado, mismoTecnico };
