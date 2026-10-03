/**
 * A QUÉ TÉCNICO SE LE MANDA EL TRABAJO
 *
 * Elige una fila de `proveedor_asignaciones` para un `edificio + rubro`. Es la decisión que
 * despierta a una persona a las once de la noche, así que equivocarse acá cuesta una visita, una
 * factura en el consorcio que no era, o un reclamo que no atiende nadie.
 *
 * > [!CAUTION]
 * > **Estaba escrita DOS VECES, igual**, en `datos-pg.js` y en `sheets.js` — y `datos.js` lee
 * > PostgreSQL primero, así que arreglar la de Sheets no habría cambiado nada en producción. Es el
 * > mismo caso que `buscarPerfilEdificio`, que ya costó caro por esto exacto.
 *
 * ## Los dos agujeros que tenían las dos copias
 *
 * ### 1. La PRIORIDAD que carga el administrador no se usaba
 *
 * El panel deja elegir, **por rubro**, si un proveedor es *1ra opción*, *2da opción* o *urgencias*,
 * y eso se guarda en la columna `prioridad`. Las dos copias hacían `filas.find(...)`, o sea
 * **la primera fila que devuelve la base** — que en PostgreSQL no tiene ningún orden prometido, y
 * una fila actualizada se mueve al final del heap.
 *
 * O sea: el administrador marcaba quién es su primera opción y Marcos llamaba a cualquiera. Y no
 * había forma de darse cuenta: con un solo proveedor por rubro --el caso de prueba-- siempre acierta.
 * Es el mismo defecto que `caso-reciente.js` ya tuvo que arreglar: **decidir por el orden físico**.
 *
 * ### 2. Un teléfono de relleno mandaba la plantilla a la nada
 *
 * `telefonoUsable()` ya existía y se usaba **solo** para el contacto de ingreso. Acá no se miraba
 * nada, así que una ficha con `11111111111` o con ocho dígitos se elegía igual: la plantilla de
 * Meta salía, rebotaba, y el caso quedaba con un técnico asignado al que nadie puede llamar. El
 * administrador ve el reclamo "en proceso" y no pasa nunca nada.
 *
 * **Se baja al siguiente de la lista**, que es el mismo criterio del contacto de ingreso: rechazar
 * de más hace que se llame al segundo proveedor; aceptar de más deja el reclamo muerto en silencio.
 *
 * ## Lo que NO cambia acá, a propósito
 *
 * - **La comparación de rubros va tal cual estaba.** Vino copiada de las dos versiones sin tocar
 *   una letra. Unificarla con `atiendeRubro` de `rubros.js` es lo correcto y es **su propio
 *   trabajo**: cambiaría a quién se le deriva cada caso, y eso no se mezcla con un arreglo de
 *   orden y de teléfonos.
 * - **Una asignación con el edificio VACÍO sigue valiendo para todos los edificios.** Es la misma
 *   forma que en `porteria.js` resultó ser un agujero --que falte un dato no es una autorización--
 *   pero cambiarlo acá, a ciegas, puede dejar sin técnico a un edificio que hoy lo encuentra por
 *   esa vía. Queda **dicho en el log** cada vez que pasa, para poder verlo antes de tocarlo.
 *
 * Prueba: `node pruebas-elegir-asignacion.js`.
 */

'use strict';

const { telefonoUsable } = require('./contacto-ingreso');

/**
 * Qué tan arriba va cada prioridad. Número más bajo = se lo llama antes.
 *
 * El texto lo escribe el panel y no está normalizado, así que se compara por lo que contiene:
 * "1ra opción", "primera", "1ra Opción + Urgencias" tienen que caer todas en el mismo lugar.
 */
function ordenDePrioridad(texto, esUrgente) {
    const p = String(texto || '').toLowerCase();
    const esDeUrgencias = /urgenc/.test(p);
    const esPrimera = /primera|1ra|1°|1º|\b1\b/.test(p);
    const esSegunda = /segunda|2da|2°|2º|\b2\b/.test(p);

    // En una urgencia manda quien está marcado para urgencias, aunque sea la segunda opción para
    // un trabajo normal. Para eso existe esa marca.
    if (esUrgente && esDeUrgencias) return 0;

    if (esPrimera) return 1;
    if (esSegunda) return 2;
    if (esDeUrgencias) return 3;   // de urgencias, pero esto no es una urgencia
    return 4;                       // sin prioridad cargada: el último
}

/** La comparación de rubros que ya estaba en las dos copias, sin cambiarle una letra. */
function mismoRubro(espNorm, rub) {
    return rub.includes(espNorm) || espNorm.includes(rub) ||
        ((espNorm.includes('electr') || espNorm.includes('luz')) && (rub.includes('electr') || rub.includes('luz') || rub.includes('electricista'))) ||
        ((espNorm.includes('plom') || espNorm.includes('agua')) && (rub.includes('plom') || rub.includes('agua') || rub.includes('plomero'))) ||
        ((espNorm.includes('cerraj') || espNorm.includes('llav')) && (rub.includes('cerraj') || rub.includes('port')));
}

/**
 * @param {object[]} filas           las filas de `proveedor_asignaciones`.
 * @param {object}   opts
 * @param {string}   opts.edificio
 * @param {string}   opts.especialidad   el rubro del trabajo.
 * @param {boolean}  [opts.esUrgente]
 * @param {function} leer             `(fila, campo) => valor`. Las dos bases guardan las filas
 *                                    distinto; la decisión es una sola.
 *
 * @returns {{fila:object, porQue:string}|null}
 */
function elegirAsignacion(filas, { edificio, especialidad, esUrgente = false } = {}, leer) {
    if (!Array.isArray(filas) || !filas.length) return null;

    const espNorm = String(especialidad || '').toLowerCase().trim();
    const edifNorm = String(edificio || '').toLowerCase().trim();

    const candidatas = [];

    for (const fila of filas) {
        const est = String(leer(fila, 'estado') || '').toLowerCase();
        if (est === 'eliminado' || est === 'inactivo') continue;

        const rub = String(leer(fila, 'rubro') || '').toLowerCase();
        if (!mismoRubro(espNorm, rub)) continue;

        const edif = String(leer(fila, 'edificio') || '').toLowerCase();
        const sinEdificio = edif === '';
        const coincideEdificio = edif.includes(edifNorm) || edifNorm.includes(edif) || sinEdificio || edif === 'todos';
        if (!coincideEdificio) continue;

        if (sinEdificio) {
            console.warn(`🔧⚠️ La asignación de "${leer(fila, 'proveedor')}" (${rub}) no tiene edificio cargado, ` +
                `así que vale para TODOS. Si no era la intención, cargale el edificio en el panel.`);
        }

        candidatas.push({
            fila,
            orden: ordenDePrioridad(leer(fila, 'prioridad'), esUrgente),
            prioridad: String(leer(fila, 'prioridad') || 'sin prioridad'),
        });
    }

    if (!candidatas.length) return null;

    // Orden explícito. Con `.find()` decidía el orden en que la base devolvió las filas, que no
    // promete nada -- y la prioridad que carga el administrador no se miraba nunca.
    candidatas.sort((a, b) => a.orden - b.orden);

    // Se recorre en orden y se saltea a quien no tiene un teléfono al que se pueda llamar. Mandar
    // la plantilla a un número que no existe deja el reclamo "en proceso" y muerto.
    for (const c of candidatas) {
        const tel = leer(c.fila, 'telefono');
        if (!telefonoUsable(tel)) {
            console.warn(`🔧📵 "${leer(c.fila, 'proveedor')}" (${c.prioridad}) tiene un teléfono al que no se puede llamar ` +
                `("${tel || 'vacío'}"): se pasa al siguiente de la lista.`);
            continue;
        }
        return {
            fila: c.fila,
            porQue: `${c.prioridad}${candidatas.length > 1 ? ` — ${candidatas.length} asignados para ese rubro` : ''}`,
        };
    }

    console.warn(`🔧📵 Los ${candidatas.length} proveedores asignados a "${edificio}" para "${especialidad}" ` +
        `tienen teléfonos a los que no se puede llamar. No se asigna ninguno.`);
    return null;
}

module.exports = { elegirAsignacion, ordenDePrioridad, mismoRubro };
