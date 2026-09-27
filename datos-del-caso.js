/**
 * LOS DATOS DEL CASO VIEJO NO SIRVEN PARA EL CASO NUEVO
 *
 * > [!CAUTION]
 * > **`rubroActivo`, `tecnicoDelCaso`, `edificioActivo` y `vecinoActivo` describen UN caso, pero
 * > viven en el estado de la LÍNEA** (`global.colasProveedores`, por teléfono). Todas sus
 * > asignaciones en `index.js` son `if (!…)`, a propósito --para no pisar una conversación viva--,
 * > así que el PRIMER caso de esa línea los fijaba hasta el próximo reinicio de PM2.
 *
 * Producción, 26/09. En esa línea conviven **julio (plomero)** y **dario (electricista)**. Venían
 * los CASO-1003 y CASO-1004, de electricidad, con `tecnicoDelCaso = Dario`. Entró el CASO-1005
 * --agua en el palier de un primer piso, o sea plomería-- y se asignó a julio. En el WhatsApp del
 * técnico quedó así:
 *
 *     23:08  plantilla:  "Hola julio, aguardamos tu confirmación para el [CASO-1005]"
 *     23:56  Marcos:     "Dario, Daniel Valdés en SAN PATRICIO 159 adjuntó esto del inconveniente."
 *
 * Dos nombres para la misma persona en el mismo hilo, con cuarenta y ocho minutos de diferencia.
 * Y no es que una de las dos ramas estuviera rota: **leen fuentes distintas.** La plantilla la
 * manda el barrido y usa el `tecnico` del caso; los mensajes libres usan este estado, que seguía
 * describiendo el caso anterior.
 *
 * ## Dónde nace, exactamente
 *
 * `agentes/marcos-ops.js` pone `eventoActivoId` al mandar la plantilla y **no toca `rubroActivo` ni
 * `tecnicoDelCaso`**. Desde ese instante el estado habla de dos casos a la vez: el id es del nuevo
 * y el resto del viejo. Nada avisa, y desde afuera se ve como que Marcos no sabe con quién habla.
 *
 * ## Qué hace esto, y qué NO
 *
 * - **No suelta los `if (!…)`.** Siguen protegiendo la conversación viva; eso no cambia.
 * - Agrega **de qué caso salieron los datos** (`datosDeCaso`). Si el caso de ahora es otro, los
 *   relee del caso de ahora. Es el mismo criterio que ya rige en `caso-del-tecnico.js`: la memoria
 *   dice de qué se está hablando, **la base dice la verdad**.
 * - **Si el caso no se puede leer no borra nada.** Quedarse con datos viejos es malo; quedarse sin
 *   ninguno deja a Marcos sin saber de qué habla, y ese es el error caro.
 * - **La marca ausente también dispara la relectura**, y hace falta: es justo el estado en que
 *   `marcos-ops.js` deja la línea después de mandar la plantilla. Cuesta una consulta en el primer
 *   mensaje de cada conversación; después la marca queda puesta y no se repite.
 *
 * Prueba: `node pruebas-datos-del-caso.js`.
 */

'use strict';

/**
 * @param {object}   stProv               el estado de esa línea (`global.colasProveedores.get(tel)`).
 * @param {function} buscarCasoPorCodigo  inyectada para poder probar sin PostgreSQL.
 *
 * @returns {Promise<{refrescado:boolean, de:string, a:string, motivo:string}>}
 *          `motivo` va al log: sin él, un nombre que cambia solo es imposible de rastrear.
 */
async function refrescarDatosDelCaso(stProv, buscarCasoPorCodigo) {
    const sinCambio = (motivo) => ({ refrescado: false, de: '', a: '', motivo });

    if (!stProv || !stProv.eventoActivoId) return sinCambio('no hay caso activo');
    if (stProv.datosDeCaso === stProv.eventoActivoId) return sinCambio('los datos ya son de este caso');

    const veniaDe = String(stProv.datosDeCaso || '');
    let caso = null;
    try {
        caso = await buscarCasoPorCodigo(stProv.eventoActivoId);
    } catch (e) {
        return sinCambio(`no se pudo leer el [${stProv.eventoActivoId}]: ${e.message}`);
    }
    if (!caso || !caso.id_evento) return sinCambio(`no se encontró el [${stProv.eventoActivoId}]`);

    const antes = `${stProv.rubroActivo || '—'} / ${stProv.tecnicoDelCaso || '—'}`;

    stProv.rubroActivo    = caso.rubro || '';
    stProv.tecnicoDelCaso = caso.tecnico || '';
    // El edificio no se vacía si el caso no lo trae: sin edificio no se le puede decir al técnico
    // adónde va, y el que había era al menos de un caso suyo.
    stProv.edificioActivo = caso.edificio || stProv.edificioActivo;
    if (caso.telefono) {
        stProv.vecinoActivo = {
            telefono: caso.telefono,
            nombre:   caso.vecino || 'Vecino',
            edificio: caso.edificio || ''
        };
    }
    stProv.datosDeCaso = caso.id_evento;

    return {
        refrescado: true,
        de: veniaDe,
        a: caso.id_evento,
        motivo: veniaDe
            ? `pasó del [${veniaDe}] al [${caso.id_evento}]: eran "${antes}", ahora "${stProv.rubroActivo || '—'} / ${stProv.tecnicoDelCaso || '—'}"`
            : `el [${caso.id_evento}] se activó sin sus datos: se leen del caso ("${stProv.rubroActivo || '—'} / ${stProv.tecnicoDelCaso || '—'}")`
    };
}

module.exports = { refrescarDatosDelCaso };
