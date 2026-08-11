const { pool } = require('./db-pg');

/**
 * LECTURAS DESDE POSTGRESQL
 *
 * Cada función de acá replica exactamente el resultado de su equivalente en sheets.js. La única
 * diferencia es de dónde salen las filas: en vez de un viaje HTTP a Google de varios cientos de
 * milisegundos, una consulta local de menos de uno. En una sola conversación Marcos hace seis u
 * ocho de estas búsquedas, así que es la mayor parte del tiempo que hoy tarda en responder.
 *
 * DECISIÓN DELIBERADA: la lógica de comparación NO se reescribió en SQL.
 *
 * Toda la lógica original de sheets.js trae las filas y las filtra en JavaScript, y ahí adentro
 * vive lo más delicado del sistema: la regla que decide a qué edificio pertenece un mensaje. San
 * Patricio 159 y San Patricio 270 son consorcios distintos y sin relación, y confundirlos es
 * mandarle un técnico al edificio equivocado. Reescribir ese matching como `WHERE ... LIKE ...`
 * habría sido más "prolijo" y habría introducido diferencias sutiles imposibles de auditar.
 *
 * Así que las filas de Postgres se envuelven en un adaptador con el mismo método `.get(columna)`
 * que usan las de Google Sheets, y el filtrado es el MISMO código. Cambia la fuente, no la
 * semántica.
 */

// Algunas columnas se llaman distinto en la planilla y en la base. El adaptador traduce, para que
// el código de filtrado pueda seguir pidiendo los nombres de la planilla sin enterarse.
const ALIAS_COLUMNAS = {
    edificios: {
        administrador: 'admin_nombre',
        tel_encargado: 'telefono_encargado',
        consorcio: 'edificio',
    },
};

/** Envuelve una fila de Postgres para que se comporte como una de Google Sheets. */
function filaCompat(obj, tabla) {
    const alias = ALIAS_COLUMNAS[tabla] || {};
    return {
        get(columna) {
            const c = String(columna || '').toLowerCase().trim();
            if (obj[c] !== undefined && obj[c] !== null) return obj[c];
            const real = alias[c];
            if (real && obj[real] !== undefined && obj[real] !== null) return obj[real];
            return '';
        },
        _raw: obj,
    };
}

async function filas(tabla) {
    const res = await pool.query(`SELECT * FROM ${tabla}`);
    return res.rows.map(r => filaCompat(r, tabla));
}

// ── VECINOS ─────────────────────────────────────────────────────────────────

async function buscarVecinosPorTelefono(telefono) {
    const rows = await filas('vecinos');
    const telBuscado = String(telefono).replace(/\D/g, '');

    return rows
        .filter(r => String(r.get('telefono') || '').replace(/\D/g, '') === telBuscado)
        .map(row => ({
            nombre:           row.get('nombre')            || '',
            edificio:         row.get('edificio')          || '',
            departamento:     row.get('departamento')      || '',
            encargado:        row.get('encargado')         || '',
            telEncargado:     row.get('tel_encargado')     || '',
            horarioEncargado: row.get('horario_encargado') || '',
            tablero:          row.get('tablero')           || '',
            llaves:           row.get('llaves')            || '',
            seguridad:        row.get('seguridad')         || '',
            consejo:          row.get('consejo')           || '',
            notas:            row.get('notas')             || '',
            autorizaContacto: row.get('autoriza_contacto') === true ||
                              String(row.get('autoriza_contacto') || '').toLowerCase().startsWith('s'),
            contactoAcceso:   row.get('contacto_acceso')   || '',
        }));
}

async function buscarVecinoPorTelefono(telefono) {
    const r = await buscarVecinosPorTelefono(telefono);
    return r[0] || null;
}

// ── EDIFICIOS ───────────────────────────────────────────────────────────────

async function buscarPerfilEdificio(nombreEdificio) {
    if (!nombreEdificio) return null;
    const rows = await filas('edificios');
    const buscado = String(nombreEdificio).toLowerCase().trim();
    const numBuscado = buscado.match(/\d+/g) || [];

    // 1. Coincidencia por número exacto de calle (ej: 159 vs 270)
    let row = null;
    if (numBuscado.length > 0) {
        row = rows.find(r => {
            const nombre = (r.get('nombre') || r.get('edificio') || r.get('consorcio') || '').toLowerCase().trim();
            const direccion = (r.get('direccion') || '').toLowerCase().trim();
            const aliases = (r.get('aliases') || '').toLowerCase().trim();
            const numsR = (nombre + ' ' + direccion + ' ' + aliases).match(/\d+/g) || [];
            return numBuscado.some(n => numsR.includes(n));
        });
    }

    // 2. Coincidencia exacta o por inclusión si no hubo coincidencia por número
    if (!row) {
        row = rows.find(r => {
            const nombre = (r.get('nombre') || r.get('edificio') || r.get('consorcio') || '').toLowerCase().trim();
            const direccion = (r.get('direccion') || '').toLowerCase().trim();
            const aliases = (r.get('aliases') || '').toLowerCase().trim();
            return (nombre && (buscado === nombre || buscado.includes(nombre) || nombre.includes(buscado))) ||
                   (direccion && (buscado === direccion || buscado.includes(direccion) || direccion.includes(buscado))) ||
                   (aliases && aliases.split(',').some(a => a.trim().length > 3 && buscado.includes(a.trim().toLowerCase())));
        });
    }

    if (!row) return null;

    return {
        nombre:            row.get('nombre')          || row.get('direccion') || '',
        direccion:         row.get('direccion')       || '',
        zona:              row.get('zona')            || '',
        encargado:         row.get('encargado')       || '',
        telEncargado:      row.get('tel_encargado')   || '',
        encargadoEstado:   row.get('encargado_estado')|| 'activo',
        encargadoSuplente: row.get('encargado_suplente') || '',
        telSuplente:       row.get('tel_suplente')    || '',
        telSeguridad:      row.get('tel_seguridad')   || '',
        adminNombre:       row.get('administrador')   || '',
        plan:              row.get('plan')            || '',
    };
}

async function listarEdificiosConocidos() {
    const rows = await filas('edificios');
    const edificios = rows
        .map(r => {
            const nombre = String(r.get('nombre') || r.get('edificio') || r.get('consorcio') || '').trim();
            const direccion = String(r.get('direccion') || '').trim();
            const rawAliases = String(r.get('aliases') || '').split(',').map(a => a.trim()).filter(Boolean);

            if (!nombre && !direccion) return null;

            const aliasesSet = new Set(rawAliases);
            if (direccion) aliasesSet.add(direccion);
            if (nombre) aliasesSet.add(nombre);

            return { nombre: nombre || direccion, direccion, aliases: Array.from(aliasesSet) };
        })
        .filter(Boolean);

    console.log(`📊 Total edificios cargados de PostgreSQL: ${edificios.length}`);
    return edificios;
}

// ── PERSONAL DE TURNO ───────────────────────────────────────────────────────

async function buscarPersonalDeTurno({ edificio }) {
    if (!edificio) return null;
    const rows = await filas('personal');
    const ahora = new Date();
    const horaActual = `${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')}`;

    const personalDeTurno = rows.find(f => {
        const edificioFila = String(f.get('edificio') || '').toLowerCase();
        const estado = String(f.get('estado') || '').toUpperCase();
        const inicio = f.get('horario_inicio');
        const fin = f.get('horario_fin');

        if (edificioFila !== String(edificio).toLowerCase() || estado !== 'ACTIVO') return false;

        // Turno que cruza la medianoche: el fin es "menor" que el inicio como texto.
        if (inicio <= fin) return horaActual >= inicio && horaActual <= fin;
        return horaActual >= inicio || horaActual <= fin;
    });

    if (!personalDeTurno) return null;

    return {
        nombre:   personalDeTurno.get('nombre'),
        rol:      personalDeTurno.get('rol'),
        telefono: personalDeTurno.get('telefono'),
        horario:  `${personalDeTurno.get('horario_inicio')} a ${personalDeTurno.get('horario_fin')}`,
    };
}

// ── MEMORIA ─────────────────────────────────────────────────────────────────

async function buscarMemoriaVecino(telefono) {
    const rows = await filas('memoria');
    const telBuscado = String(telefono || '').replace(/\D/g, '');
    const row = rows.find(r => String(r.get('telefono') || '').replace(/\D/g, '') === telBuscado);
    if (!row) return null;

    return {
        resumenHistorial: row.get('resumen_historial') || '',
        notasTrato:       row.get('notas_trato')       || '',
        fechaUltimo:      row.get('fecha_ultimo_contacto') || '',
        // Sin `_row`: la actualización de la memoria sigue yendo por Sheets, que es quien manda
        // en la escritura. Devolverlo daría la falsa impresión de que se puede guardar por acá.
    };
}

// ── ROL POR TELÉFONO ────────────────────────────────────────────────────────

// Se compara por los últimos 8 dígitos porque el mismo número puede estar guardado con o sin el 9
// de Argentina, con +54 o sin nada.
const mismoTel = (a, b) => {
    const x = String(a || '').replace(/\D/g, '');
    const y = String(b || '').replace(/\D/g, '');
    if (!x || !y) return false;
    return x === y || x.endsWith(y.slice(-8)) || y.endsWith(x.slice(-8));
};

async function buscarRolPorTelefono(telefono) {
    if (!telefono) return { rol: 'vecino' };
    const numLimpio = String(telefono).replace(/\D/g, '');
    if (!numLimpio || numLimpio.length < 6) return { rol: 'vecino' };

    // 1. Proveedores y asignaciones
    const provs = await filas('proveedores');
    const provRow = provs.find(r => mismoTel(r.get('telefono') || r.get('wsp'), numLimpio));
    if (provRow) {
        return {
            rol: 'proveedor',
            nombre: provRow.get('nombre') || 'Proveedor',
            especialidad: provRow.get('especialidad') || provRow.get('rubro') || 'técnico',
            empresa: provRow.get('empresa') || '',
            telefono: provRow.get('telefono') || telefono,
        };
    }

    const asigs = await filas('proveedor_asignaciones');
    const asigRow = asigs.find(r => mismoTel(r.get('telefono') || r.get('proveedor_telefono'), numLimpio));
    if (asigRow) {
        return {
            rol: 'proveedor',
            nombre: asigRow.get('proveedor') || asigRow.get('proveedor_nombre') || asigRow.get('nombre') || 'Proveedor',
            especialidad: asigRow.get('rubro') || asigRow.get('especialidad') || 'técnico',
            edificio: asigRow.get('edificio') || '',
            telefono: asigRow.get('telefono') || telefono,
        };
    }

    // 2. Encargados, suplentes y seguridad (viven en el edificio)
    const edifs = await filas('edificios');
    for (const r of edifs) {
        if (mismoTel(r.get('tel_encargado'), numLimpio)) {
            return { rol: 'encargado', nombre: r.get('encargado') || 'Encargado', edificio: r.get('nombre') || r.get('direccion') || '', subRol: 'titular' };
        }
        if (mismoTel(r.get('tel_suplente'), numLimpio)) {
            return { rol: 'encargado', nombre: r.get('encargado_suplente') || 'Personal Limpieza', edificio: r.get('nombre') || '', subRol: 'suplente' };
        }
        if (mismoTel(r.get('tel_seguridad'), numLimpio)) {
            return { rol: 'seguridad', nombre: 'Guardia de Seguridad', edificio: r.get('nombre') || '', subRol: 'seguridad' };
        }
    }

    // 3. Administradores
    const clis = await filas('clientes');
    const cliRow = clis.find(r => mismoTel(r.get('wsp') || r.get('telefono'), numLimpio));
    if (cliRow) {
        return { rol: 'admin', nombre: cliRow.get('nombre') || 'Administración', telefono: cliRow.get('wsp') || telefono };
    }

    return { rol: 'vecino' };
}

// ── TÉCNICOS ────────────────────────────────────────────────────────────────

// Los rubros se escriben de mil maneras: "electricista", "electricidad", "luz". La equivalencia es
// la misma que usa la planilla, copiada tal cual para no cambiar a quién se le deriva un caso.
function coincideRubro(espNorm, rub) {
    return rub.includes(espNorm) || espNorm.includes(rub) ||
        ((espNorm.includes('electr') || espNorm.includes('luz')) && (rub.includes('electr') || rub.includes('luz') || rub.includes('electricista'))) ||
        ((espNorm.includes('plom') || espNorm.includes('agua')) && (rub.includes('plom') || rub.includes('agua') || rub.includes('plomero'))) ||
        ((espNorm.includes('cerraj') || espNorm.includes('llav')) && (rub.includes('cerraj') || rub.includes('port')));
}

async function buscarTecnicoAsignado({ edificio, especialidad, esUrgente = false }) {
    const espNorm = String(especialidad || '').toLowerCase().trim();
    const edifNorm = String(edificio || '').toLowerCase().trim();

    // 1. Asignaciones del edificio: es la lista que arma el administrador, y manda sobre el resto.
    const asigs = await filas('proveedor_asignaciones');
    const coincide = asigs.find(r => {
        const est = String(r.get('estado') || '').toLowerCase();
        if (est === 'eliminado' || est === 'inactivo') return false;
        const rub = String(r.get('rubro') || '').toLowerCase();
        const edif = String(r.get('edificio') || '').toLowerCase();
        const coincideEdificio = edif.includes(edifNorm) || edifNorm.includes(edif) || edif === '' || edif === 'todos';
        return coincideRubro(espNorm, rub) && coincideEdificio;
    });

    if (coincide) {
        console.log(`🔧 Técnico encontrado en 'proveedor_asignaciones': ${coincide.get('proveedor')} (${coincide.get('telefono')})`);
        // "acceso" viaja tal cual en la plantilla de Meta que recibe el técnico: nunca debe leerse
        // como que el técnico tiene que gestionarlo por su cuenta. Lo coordina Marcos con el vecino.
        return {
            nombre:   coincide.get('proveedor'),
            telefono: coincide.get('telefono'),
            acceso:   'Coordinado por Marcos con el vecino',
            puntaje:  '5',
            urgencia: true,
        };
    }

    // 2. Lista maestra de proveedores del cliente.
    const provs = await filas('proveedores');
    const coincideProv = provs.find(r => {
        const est = String(r.get('estado') || '').toLowerCase();
        if (est === 'eliminado' || est === 'inactivo') return false;
        return coincideRubro(espNorm, String(r.get('rubro') || '').toLowerCase());
    });

    if (coincideProv) {
        console.log(`🔧 Técnico encontrado en 'proveedores': ${coincideProv.get('nombre')} (${coincideProv.get('telefono')})`);
        return {
            nombre:   coincideProv.get('nombre'),
            telefono: coincideProv.get('telefono'),
            acceso:   'Coordinado por Marcos con el vecino',
            puntaje:  '5',
            urgencia: true,
        };
    }

    // 3. Tabla histórica de técnicos, con orden por prioridad y puntaje.
    const tecs = await filas('tecnicos');
    const candidatos = tecs.filter(r => {
        const esp = String(r.get('especialidad') || '').toLowerCase();
        const edifs = String(r.get('edificios') || '').toLowerCase();
        const activo = String(r.get('activo') || '').toLowerCase();
        if (activo !== 'si' && activo !== 'sí') return false;
        const coincideEdificio = edifs.includes(edifNorm) || edifs.includes('todos') || edifs === '';
        if (!coincideEdificio) return false;
        return esp.includes(espNorm) || espNorm.includes(esp);
    });

    if (candidatos.length === 0) return null;

    candidatos.sort(ordenarPorPrioridad);
    const elegido = candidatos[0];
    return {
        nombre:   elegido.get('nombre'),
        telefono: elegido.get('telefono'),
        acceso:   elegido.get('acceso'),
        puntaje:  elegido.get('puntaje_encuesta'),
        urgencia: String(elegido.get('disponible_urgencia') || '').toLowerCase() === 'si',
    };
}

function ordenarPorPrioridad(a, b) {
    const pA = String(a.get('prioridad_admin') || '').toLowerCase() === 'si' ? 1 : 0;
    const pB = String(b.get('prioridad_admin') || '').toLowerCase() === 'si' ? 1 : 0;
    if (pB !== pA) return pB - pA;
    return parseFloat(b.get('puntaje_encuesta') || 0) - parseFloat(a.get('puntaje_encuesta') || 0);
}

async function buscarTecnicoSuplente({ edificio, especialidad, telefonoTitular }) {
    const rows = await filas('proveedor_asignaciones');
    const edifNorm = String(edificio || '').toLowerCase();
    const espNorm = String(especialidad || '').toLowerCase();
    const telTitularNorm = String(telefonoTitular || '').replace(/\D/g, '');

    const candidatos = rows.filter(r => {
        const esp = String(r.get('especialidad') || '').toLowerCase();
        const edifs = String(r.get('edificios') || '').toLowerCase();
        const activo = String(r.get('activo') || '').toLowerCase();
        const tel = String(r.get('telefono') || '').replace(/\D/g, '');

        if (activo !== 'si' && activo !== 'sí') return false;
        if (tel === telTitularNorm) return false;

        const coincideEdificio = edifs.includes(edifNorm) || edifs.includes('todos') || edifs === '';
        if (!coincideEdificio) return false;

        return esp.includes(espNorm) || espNorm.includes(esp);
    });

    if (candidatos.length === 0) return null;

    candidatos.sort(ordenarPorPrioridad);
    const elegido = candidatos[0];
    return {
        nombre:   elegido.get('nombre'),
        telefono: elegido.get('telefono'),
        acceso:   elegido.get('acceso'),
        puntaje:  elegido.get('puntaje_encuesta'),
        urgencia: String(elegido.get('disponible_urgencia') || '').toLowerCase() === 'si',
    };
}

// ── CLIENTES ────────────────────────────────────────────────────────────────

async function buscarCliente(nombreAdmin) {
    if (!nombreAdmin) return null;
    const rows = await filas('clientes');
    const row = rows.find(r =>
        String(r.get('nombre') || '').toLowerCase().includes(String(nombreAdmin).toLowerCase())
    );
    if (!row) return null;

    return {
        nombre:     row.get('nombre') || '',
        email:      row.get('email') || '',
        wsp:        row.get('wsp') || '',
        notifEmail: String(row.get('notif_email') || '').toLowerCase() === 'si',
    };
}

// ── CASOS ───────────────────────────────────────────────────────────────────

/** Si al técnico ya se le mandó la plantilla de este caso. Evita el envío duplicado. */
async function fueTecnicoNotificado(id_evento) {
    if (!id_evento) return false;
    const res = await pool.query(
        `SELECT tecnico_notificado FROM reportes WHERE upper(trim(codigo_caso)) = upper(trim($1)) LIMIT 1`,
        [String(id_evento)]
    );
    if (!res.rowCount) return false;
    return !!String(res.rows[0].tecnico_notificado || '').trim();
}

// ── ACCESOS ─────────────────────────────────────────────────────────────────

async function buscarAccesosEdificio(nombreEdificio) {
    if (!nombreEdificio) return [];
    const rows = await filas('accesos');
    const buscado = String(nombreEdificio).toLowerCase().trim();

    return rows
        .filter(r => String(r.get('edificio') || '').toLowerCase().trim() === buscado)
        .filter(r => String(r.get('lugar') || '').trim())
        .map(r => ({
            lugar:      r.get('lugar') || '',
            ubicacion:  r.get('ubicacion') || '',
            quienAbre:  r.get('quien_abre') || '',
            telefono:   r.get('telefono') || '',
            tipoAcceso: r.get('tipo_acceso') || '',
            notas:      r.get('notas') || '',
            origen:     r.get('origen') || '',
        }));
}

module.exports = {
    buscarVecinosPorTelefono,
    buscarVecinoPorTelefono,
    buscarPerfilEdificio,
    listarEdificiosConocidos,
    buscarPersonalDeTurno,
    buscarMemoriaVecino,
    buscarRolPorTelefono,
    buscarAccesosEdificio,
    buscarTecnicoAsignado,
    buscarTecnicoSuplente,
    buscarCliente,
    fueTecnicoNotificado,
};
