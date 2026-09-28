// autor-del-pase.js -- QUIEN AUTORIZO UN INGRESO.
//
// Pedido de Daniel, 28/09: *"el pase qr creado por un vecino debe tener una firma del vecino que lo
// creo o algo que nos ayude a saber quien dio acceso, asi si hay eventos perjudiciales se sepa
// quien fue y el AC pueda tomar acciones legales"*.
//
// El dato ya se guardaba (pases_qr.creado_por_nombre y creado_por_usuario_id). Lo que faltaba es
// todo lo demas: nadie lo mostraba, la columna legible del registro de accesos nombraba al
// invitado y no a quien lo dejo entrar, y un pase emitido desde la sesion de demostracion quedaba
// firmado con un nombre que parece de una persona real.
//
// Este archivo tiene las tres decisiones en un solo lugar, porque las necesitan dos lados: el
// portal cuando emite el pase, y la porteria cuando lo consume y cuando lo muestra. Dos copias de
// esto es exactamente lo que ya costo caro con buscarPerfilEdificio.
//
// (Nada de acentos graves aca adentro.)

// ── 1. Un pase de prueba no puede parecer una autorizacion real ──────────────────────
//
// La sesion de demostracion del portal existe para mostrar el producto, y arma un vecino inventado
// (hoy "Camila", usuario_id 2). Los pases que emite entran en la MISMA tabla, con el nombre de un
// edificio real. Sin una marca, el dia que haya que responder "quien autorizo este ingreso" la
// respuesta va a ser el nombre de alguien que no existe -- y eso es peor que no tener ninguna,
// porque parece una respuesta.
//
// Se MARCA y no se bloquea, a proposito: el boton de demo es con lo que se prueba el sistema hoy,
// y dejarlo sin poder emitir un pase haria que las pruebas dejen de cubrir esta pantalla.
const MARCA_PRUEBA = '[PRUEBA]';

function nombreCompletoDe(vecino) {
    const v = vecino || {};
    return [v.nombre, v.apellido].filter(Boolean).join(' ').trim();
}

// El nombre con el que se firma un pase. Lo llama el portal al emitirlo.
function nombreDelAutor(vecino) {
    const base = nombreCompletoDe(vecino) || 'Vecino sin nombre cargado';
    return (vecino && vecino.demo) ? `${MARCA_PRUEBA} ${base}` : base;
}

function esAutorDePrueba(nombre) {
    return String(nombre || '').trim().startsWith(MARCA_PRUEBA);
}

// ── 2. Lo que se guarda en el registro de accesos ─────────────────────────────────────
//
// Se COPIA del pase en el momento del ingreso, no se resuelve despues con un join. Un rastro que
// va a sostener una accion legal no puede cambiar mas tarde ni desaparecer si el pase se borra o
// el vecino se renombra.
function datosDeAutoria(pase) {
    const p = pase || {};
    return {
        autorizado_por_nombre: p.creado_por_nombre || null,
        autorizado_por_usuario_id: p.creado_por_usuario_id || null,
        autorizado_por_unidad: p.departamento || null,
        pase_id: p.id || null,
        pase_emitido_en: p.created_at || null
    };
}

// ── 3. Como se le cuenta a una persona ───────────────────────────────────────────────

function fechaCorta(valor) {
    if (!valor) return '';
    const d = new Date(valor);
    if (isNaN(d.getTime())) return '';
    // Huso fijo -3: Argentina no cambia de hora desde 2009, y el ICU reducido del VPS es el
    // motivo por el que en este repo las fechas no se arman con toLocaleString.
    const t = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const dd = String(t.getUTCDate()).padStart(2, '0');
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mi = String(t.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
}

// Una linea para el portero o para el administrador.
//
// **Sin autor no se inventa uno.** Un pase viejo, o emitido por una via que no lo anotaba, no
// tiene a quien senialar, y decirlo es la unica respuesta honesta: el administrador necesita saber
// que de ESE ingreso no hay a quien reclamarle, no leer un nombre por descarte.
function describirAutor(pase) {
    const p = pase || {};
    const nombre = String(p.creado_por_nombre || '').trim();
    if (!nombre) return 'No consta quién lo autorizó.';

    const partes = [];
    if (esAutorDePrueba(nombre)) {
        partes.push(`${nombre} — pase de PRUEBA, no es una autorización real`);
    } else {
        partes.push(nombre);
    }
    if (p.departamento) partes.push(`unidad ${p.departamento}`);

    const cuando = fechaCorta(p.created_at);
    const cola = cuando ? ` el ${cuando}` : '';
    return `Autorizado por ${partes.join(', ')}${cola}.`;
}

module.exports = {
    MARCA_PRUEBA,
    nombreDelAutor,
    esAutorDePrueba,
    datosDeAutoria,
    describirAutor,
    fechaCorta
};
