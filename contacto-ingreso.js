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

/**
 * @returns {{texto:string, telefono:string, quien:string, firme:boolean, origen:string}|null}
 *          `firme: false` significa que hay que decirlo como sugerencia, no como hecho.
 */
function contactoParaElIngreso({ perfil = null, accesos = [], contactoDeCasoAnterior = '', casoAnterior = '', edificioDelContacto = '', edificio = '' } = {}) {
    const limpio = (s) => String(s || '').trim();
    const conTel = (nombre, tel) => {
        const n = limpio(nombre), t = limpio(tel);
        if (!t) return '';
        return n ? `${n} (${t})` : t;
    };

    // 1 y 2. El encargado, o su suplente si el encargado no está.
    const estado = limpio(perfil?.encargadoEstado || 'activo').toLowerCase();
    const encargadoActivo = !estado || estado === 'activo';

    if (encargadoActivo && limpio(perfil?.telEncargado)) {
        return {
            texto: conTel(perfil.encargado, perfil.telEncargado),
            telefono: limpio(perfil.telEncargado),
            quien: limpio(perfil.encargado) || 'el encargado',
            firme: true,
            origen: 'encargado del edificio',
        };
    }

    if (limpio(perfil?.telSuplente)) {
        return {
            texto: conTel(perfil.encargadoSuplente, perfil.telSuplente),
            telefono: limpio(perfil.telSuplente),
            quien: limpio(perfil.encargadoSuplente) || 'el suplente',
            firme: true,
            origen: encargadoActivo ? 'suplente del encargado' : `suplente (el encargado está de ${estado})`,
        };
    }

    // 3. Seguridad de la entrada.
    if (limpio(perfil?.telSeguridad)) {
        return {
            texto: conTel('Seguridad', perfil.telSeguridad),
            telefono: limpio(perfil.telSeguridad),
            quien: 'seguridad',
            firme: true,
            origen: 'seguridad de la entrada',
        };
    }

    // 4. Lo que Marcos aprendió sobre los accesos DE ESTE EDIFICIO. Es del edificio, no de un caso.
    const delEdificio = (accesos || []).find(a => limpio(a?.telefono) && limpio(a?.quien_tiene || a?.quienTiene));
    if (delEdificio) {
        const quien = limpio(delEdificio.quien_tiene || delEdificio.quienTiene);
        return {
            texto: conTel(quien, delEdificio.telefono),
            telefono: limpio(delEdificio.telefono),
            quien,
            firme: true,
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

module.exports = { contactoParaElIngreso, mensajeDeIngreso, tieneAccesoPropio };
