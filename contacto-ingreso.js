// Quién le abre la puerta al técnico, y con cuánta seguridad se lo puede afirmar.
//
// > [!CAUTION]
// > **Que alguien haya abierto una vez no quiere decir que abra siempre.**
//
// EL CASO QUE LO ORIGINÓ. En el CASO-1001 no había nadie para abrir y Natalia se ofreció esa vez.
// Marcos guardó su teléfono y a partir de ahí lo entregó como si fuera el contacto de ingreso del
// edificio: *"para el ingreso por favor comuníquese con Natalia Zeballos"*. Afirmado, sin matices,
// y encima en otro edificio.
//
// Daniel: *"el teléfono de Natalia se dio en el caso 1001 por esa vez nada más, ya que no estaba
// nadie para abrir. No puede tomar como consideración que siempre abrirá Natalia. Debe usar los
// datos que hay en el edificio de accesos, pero si no hay, que hable con el administrador y que
// sugiera quizás a Natalia — pero lo dio por hecho"*.
//
// La diferencia entre "comuniquese con Natalia" y "la última vez abrió Natalia, lo confirmo con la
// Administración" es la diferencia entre un dato y una suposición. Marcos no puede presentar una
// suposición como un dato: el técnico organiza su día con eso, y si nadie le abre perdió el viaje.
//
// EL ORDEN, de más firme a más flojo:
//
//   1. El encargado del edificio, si está activo.       ← es su trabajo, está en la ficha
//   2. El suplente, si el encargado no está.            ← también está en la ficha
//   3. Seguridad de la entrada.                         ← también
//   4. Lo aprendido sobre accesos DE ESE EDIFICIO.      ← quién tiene la llave de qué
//   5. Un contacto puntual de un caso anterior.         ← SUGERENCIA, nunca afirmación
//
// Y si no hay ninguno, no se inventa: se le dice al técnico que se está averiguando y se le
// pregunta a la Administración, que es la que sabe.

const { esHorarioNocturno, horaAR } = require('./fecha');

/**
 * El nombre del encargado, separado de la metadata que viaja en la misma celda.
 *
 * > [!CAUTION]
 * > **La columna `encargado` no guarda solo el nombre.** El panel escribe ahí
 * > `nombre [estado | horario]` y lo vuelve a desarmar para mostrarlo (`dashboard.js:5174`).
 *
 * Visto en producción, tal cual le llegó al técnico a la 1:20 de la madrugada:
 *
 *     te abre pachu [activo | L-V 08:02-12:00 · L-V 01:00-12:00 · Sáb 12:00-08:00] (12345667)
 *
 * Eso no es un mensaje, es una fila de una planilla. El técnico no necesita la semana entera del
 * encargado: necesita a quién llamar. Y de paso queda a la vista lo que Daniel ya había decidido
 * arreglar de raíz -- los bloques L-V + Sábado no pueden representar los horarios reales.
 */
function datosDelEncargado(texto) {
    const t = String(texto || '').trim();
    const abre = t.indexOf('[');
    const cierra = t.indexOf(']', abre);
    if (abre === -1 || cierra < abre) return { nombre: t, estado: '', horario: '' };

    const meta = t.slice(abre + 1, cierra).trim();
    const nombre = (t.slice(0, abre) + ' ' + t.slice(cierra + 1)).replace(/\s{2,}/g, ' ').trim();

    let estado = '', horario = '';
    for (const parte of meta.split('|').map(s => s.trim()).filter(Boolean)) {
        if (/^(activo|licencia|vacaciones|suspendido)$/i.test(parte)) estado = parte.toLowerCase();
        else horario = parte;
    }
    return { nombre, estado, horario };
}

/**
 * Un teléfono que no se puede discar no es un contacto.
 *
 * En la prueba salió `pachu (12345667)` — ocho dígitos, un número de relleno que quedó cargado en
 * la ficha. Marcos se lo entregó al técnico como el contacto de ingreso a las 2 de la mañana.
 *
 * Todo número argentino real tiene área + local = 10 dígitos como piso. Con menos, es mejor decir
 * "estoy averiguando quién te abre" que mandar a alguien a discar un número que no existe: lo
 * primero se arregla con un mensaje, lo segundo lo deja parado en la puerta.
 */
function telefonoUsable(tel) {
    return String(tel || '').replace(/\D/g, '').length >= 10;
}

/**
 * @returns {{texto:string, telefono:string, quien:string, firme:boolean, origen:string,
 *            reserva:string}|null}
 *          `firme: false` significa que hay que decirlo como sugerencia, no como hecho.
 *          `reserva` explica POR QUÉ no es firme, cuando el motivo no es el origen del dato.
 */
function contactoParaElIngreso({ perfil = null, accesos = [], contactoDeCasoAnterior = '', casoAnterior = '', edificioDelContacto = '', edificio = '', momentoVisita = null } = {}) {
    const limpio = (s) => String(s || '').trim();
    const conTel = (nombre, tel) => {
        const n = limpio(nombre), t = limpio(tel);
        if (!t) return '';
        return n ? `${n} (${t})` : t;
    };

    // ── DE MADRUGADA NO SE AFIRMA QUE EL ENCARGADO ABRE ─────────────────────
    //
    // El encargado y su suplente trabajan por horario. A las 2 de la mañana no están, y decirle al
    // técnico "te abre pachu, si no te abren avisame" es un mensaje que se contradice solo: el
    // propio horario que Marcos acababa de mandar ya decía que a esa hora no había nadie.
    //
    // No se mira el horario cargado a propósito. Con la estructura de bloques actual, la ficha de
    // este edificio dice literalmente `L-V 01:00-12:00`, así que cualquier chequeo contra ella
    // concluiría que el encargado SÍ está a la 1 de la mañana. Daniel ya decidió que esos bloques
    // se reemplazan por calendario o texto libre; hasta entonces el reloj es más confiable que el
    // dato. Seguridad queda afuera de esta regla: es, por definición, la opción de la noche.
    const deNoche = momentoVisita ? esHorarioNocturno(momentoVisita) : false;
    const reservaNocturna = deNoche
        ? `va a llegar cerca de las ${horaAR(momentoVisita)} y a esa hora el personal del edificio no está`
        : '';

    // 1 y 2. El encargado, o su suplente si el encargado no está.
    const delCampo = limpio(perfil?.encargadoEstado).toLowerCase();
    const enc = datosDelEncargado(perfil?.encargado);
    const estado = delCampo || enc.estado || 'activo';
    const encargadoActivo = estado === 'activo';

    if (encargadoActivo && telefonoUsable(perfil?.telEncargado)) {
        return {
            texto: conTel(enc.nombre, perfil.telEncargado),
            telefono: limpio(perfil.telEncargado),
            quien: enc.nombre || 'el encargado',
            firme: !deNoche,
            reserva: reservaNocturna,
            origen: 'encargado del edificio',
        };
    }

    const sup = datosDelEncargado(perfil?.encargadoSuplente);
    if (telefonoUsable(perfil?.telSuplente)) {
        return {
            texto: conTel(sup.nombre, perfil.telSuplente),
            telefono: limpio(perfil.telSuplente),
            quien: sup.nombre || 'el suplente',
            firme: !deNoche,
            reserva: reservaNocturna,
            origen: encargadoActivo ? 'suplente del encargado' : `suplente (el encargado está de ${estado})`,
        };
    }

    // 3. Seguridad de la entrada. Sí se afirma de noche: para eso está.
    if (telefonoUsable(perfil?.telSeguridad)) {
        return {
            texto: conTel('Seguridad', perfil.telSeguridad),
            telefono: limpio(perfil.telSeguridad),
            quien: 'seguridad',
            firme: true,
            reserva: '',
            origen: 'seguridad de la entrada',
        };
    }

    // 4. Lo que Marcos aprendió sobre los accesos DE ESTE EDIFICIO. Es del edificio, no de un caso.
    const delEdificio = (accesos || []).find(a => telefonoUsable(a?.telefono) && limpio(a?.quien_tiene || a?.quienTiene));
    if (delEdificio) {
        const quien = limpio(delEdificio.quien_tiene || delEdificio.quienTiene);
        return {
            texto: conTel(quien, delEdificio.telefono),
            telefono: limpio(delEdificio.telefono),
            quien,
            firme: true,
            reserva: '',
            origen: `registrado en los accesos del edificio${limpio(delEdificio.instalacion) ? ` (${limpio(delEdificio.instalacion)})` : ''}`,
        };
    }

    // 5. El contacto puntual de un caso anterior. NO es firme, y solo vale para el MISMO edificio:
    // que alguien haya abierto una vez en San Patricio 159 no dice nada sobre el 270.
    const mismoEdificio = !edificioDelContacto || !edificio
        || String(edificioDelContacto).toLowerCase().trim() === String(edificio).toLowerCase().trim();

    if (limpio(contactoDeCasoAnterior) && mismoEdificio) {
        return {
            texto: limpio(contactoDeCasoAnterior),
            telefono: limpio(contactoDeCasoAnterior),
            quien: limpio(contactoDeCasoAnterior),
            firme: false,
            reserva: '',
            origen: casoAnterior ? `abrió en el ${casoAnterior}, esa vez` : 'abrió en una visita anterior',
        };
    }

    return null;
}

/**
 * El mensaje para el técnico. Cambia entero según haya un dato o una suposición.
 *
 * Sin nada, tampoco se calla: decirle al técnico "estoy averiguando quién te abre" lo deja
 * organizar su día. No decirle nada lo deja tocando un timbre que no atiende nadie.
 */
function mensajeDeIngreso({ contacto, idEvento, direccion, nombreTecnico = '' }) {
    const hola = nombreTecnico ? `${nombreTecnico}, ` : '';
    const cabecera = `📞 *MARCOS — INGRESO [${idEvento}]*\n\n`;

    if (!contacto) {
        return cabecera +
            `${hola}para la visita en ${direccion} todavía no tengo confirmado quién te abre. ` +
            `Se lo estoy preguntando a la Administración y te aviso apenas me contesten.\n` +
            `Si vas a ir igual, decime cuándo y me ocupo de que haya alguien.`;
    }

    if (contacto.firme) {
        return cabecera +
            `${hola}para la visita en ${direccion} te abre *${contacto.texto}* — ${contacto.origen}.\n` +
            (/\s\/\s/.test(contacto.texto) ? `Tiene más de un número, probá con cualquiera.\n` : '') +
            `Si al llegar no te abren, avisame y lo resuelvo.`;
    }

    // ── LLEGA DE NOCHE ──────────────────────────────────────────────────────
    //
    // Hay un contacto cargado, pero es alguien que trabaja por horario y a esa hora no está.
    // Lo que NO se puede hacer es lo que hacía antes: darlo por bueno y cerrar con "si no te
    // abren, avisame". Eso es prometerle una puerta abierta y dejarle a él el costo de descubrir
    // que no lo estaba, a las 2 de la mañana y con el viaje hecho.
    if (contacto.reserva) {
        return cabecera +
            `${hola}para la visita en ${direccion} el contacto del edificio es *${contacto.texto}* ` +
            `(${contacto.origen}), pero ${contacto.reserva}.\n` +
            `Antes de que salgas lo confirmo: ya le pregunté a la Administración quién te abre a esa hora. ` +
            `Si preferís ir igual, decime y te aviso apenas tenga respuesta.`;
    }

    // La forma en que se dice importa tanto como el dato: acá se está sugiriendo, no afirmando.
    return cabecera +
        `${hola}para la visita en ${direccion} no tengo un contacto fijo de ingreso cargado.\n` +
        `Lo que sí tengo es que *${contacto.texto}* ${contacto.origen} — pero fue por esa vez, no es algo fijo, ` +
        `así que no cuentes con eso todavía.\n` +
        `Ya le pregunté a la Administración quién te abre y te confirmo antes de que vayas.`;
}

/**
 * Si el técnico ya dijo que entra solo.
 *
 * > **Preguntar y después no escuchar la respuesta es peor que no preguntar.**
 *
 * Marcos le preguntó "¿necesitás que gestione algo para entrar?", Daniel contestó *"no, tengo
 * llave y acceso al sistema"* -- y Marcos le mandó igual el contacto del encargado. Un humano no
 * hace eso: si le dicen que tiene llave, no le explica quién le abre.
 *
 * Y no es solo cortesía: cada mensaje de más le enseña al técnico que a Marcos se le puede
 * contestar cualquier cosa porque no lo escucha, y a partir de ahí deja de contestarle.
 */
function tieneAccesoPropio(texto) {
    const t = String(texto || '').toLowerCase();
    if (!t.trim()) return false;

    // PRIMERO LA NEGACIÓN, porque "NO tengo llave" contiene "tengo llave".
    //
    // Equivocarse para este lado es el error caro: marcar que entra solo a alguien que acaba de
    // decir que no tiene llave lo deja parado en la puerta sin que nadie le abra. Al revés, lo
    // peor que pasa es un mensaje de más. Por eso ante cualquier negación de tener algo, se sale.
    if (/\bno\s+(tengo|cuento con|dispongo|tenemos)\b/.test(t)) return false;

    // Tiene con qué entrar por su cuenta.
    if (/\btengo\b[^.]{0,25}\b(llave|llaves|acceso|c[oó]digo|tarjeta|control|mando|permiso)/.test(t)) return true;
    if (/\b(tengo|manejo|conozco)\b[^.]{0,25}\b(el sistema|la clave|la contrase[nñ]a)/.test(t)) return true;
    if (/\b(entro|ingreso|paso)\b[^.]{0,15}\b(solo|sola|por mi cuenta|sin problema|directo)/.test(t)) return true;

    // O directamente dijo que no necesita nada. Ojo con el "no necesito" a secas: tiene que estar
    // hablando de entrar, no de otra cosa.
    if (/\bno\s+(necesito|hace falta|preciso|requiero)\b/.test(t)
        && /\b(nada|entrar|ingres|acceso|llave|abr|gestion)/.test(t)) return true;

    return false;
}

module.exports = {
    contactoParaElIngreso, mensajeDeIngreso, tieneAccesoPropio,
    datosDelEncargado, telefonoUsable,
};
