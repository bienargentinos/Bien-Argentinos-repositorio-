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

    // Los miembros del consejo de administración figuran como vecinos: lo único que los distingue
    // es la marca en su ficha. Se acarrea para que Marcos pueda contestarles por visitas del
    // edificio que no abrieron ellos, igual que al encargado o a la guardia.
    const fichaVecino = await buscarVecinoPorTelefono(numLimpio);
    const consejo = String(fichaVecino?.consejo || '').trim();
    return consejo ? { rol: 'vecino', consejo } : { rol: 'vecino' };
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

    // Los valores por defecto son los mismos que muestra el panel al editar el cliente: el mail va
    // salvo que lo apaguen, el WhatsApp solo si lo piden. Leerlos distinto haría que el tilde que
    // ve el administrador no coincida con lo que hace Marcos.
    return {
        nombre:     row.get('nombre') || '',
        email:      row.get('email') || '',
        wsp:        row.get('wsp') || '',
        notifEmail: String(row.get('notif_email') || '').toLowerCase() !== 'no',
        notifWsp:   String(row.get('notif_wsp') || '').toLowerCase() === 'si',
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

// ── FACTURAS ────────────────────────────────────────────────────────────────

async function buscarFacturasProveedor({ proveedor, edificio = '', numeroFactura = '' }) {
    const rows = await filas('facturas');
    const provBuscado = String(proveedor || '').toLowerCase().trim();
    const edifBuscado = String(edificio || '').toLowerCase().trim();
    const numBuscado = String(numeroFactura || '').replace(/\D/g, '');

    return rows
        .filter(r => {
            const rProv = String(r.get('proveedor') || '').toLowerCase().trim();
            const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
            const rNum = String(r.get('numero_factura') || '').replace(/\D/g, '');

            const matchProv = provBuscado && (rProv.includes(provBuscado) || provBuscado.includes(rProv));
            if (!matchProv) return false;

            if (numBuscado) return rNum && rNum === numBuscado;
            if (edifBuscado) return rEdif.includes(edifBuscado) || edifBuscado.includes(rEdif);
            return true;
        })
        .map(r => ({
            fecha:          r.get('fecha'),
            monto:          r.get('monto'),
            concepto:       r.get('concepto'),
            edificio:       r.get('edificio'),
            numero_factura: r.get('numero_factura'),
            estado:         r.get('estado') || 'Pendiente',
        }))
        .reverse(); // más reciente primero
}

// ── CASOS ABIERTOS Y SEGUIMIENTOS ───────────────────────────────────────────

const CERRADOS = new Set(['resuelto', 'cerrado']);

async function obtenerCasosAbiertosEdificio(nombreEdificio) {
    const rows = await filas('reportes');
    const edifBuscado = String(nombreEdificio || '').toLowerCase().trim();

    return rows
        .filter(r => {
            const rEst = String(r.get('estado') || '').toLowerCase().trim();
            if (CERRADOS.has(rEst)) return false;
            const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
            return !edifBuscado || rEdif.includes(edifBuscado) || edifBuscado.includes(rEdif);
        })
        .map(r => ({
            id_evento: r.get('codigo_caso') || r.get('id_evento') || '',
            edificio:  r.get('edificio'),
            vecino:    r.get('vecino'),
            depto:     r.get('depto') || r.get('departamento'),
            problema:  r.get('mensaje') || r.get('problema') || r.get('notas'),
            urgencia:  r.get('urgencia') || 'media',
            estado:    r.get('estado') || 'en_proceso',
            tecnico:   r.get('tecnico') || '',
            telefono:  r.get('telefono') || '',
        }));
}

async function obtenerEventosPendientesAdmin() {
    const rows = await filas('reportes');
    return rows
        .filter(r => String(r.get('estado') || '').toLowerCase() !== 'resuelto')
        .map(r => ({
            id:       r.get('codigo_caso') || r.get('id') || '',
            edificio: r.get('edificio'),
            vecino:   r.get('vecino'),
            depto:    r.get('depto') || r.get('departamento'),
            problema: r.get('problema') || r.get('mensaje'),
            urgencia: r.get('urgencia'),
            estado:   r.get('estado') || 'nuevo',
        }));
}

/**
 * Casos abiertos cuyo control ya venció.
 *
 * Esta es la que más importa migrar, y no por velocidad: el barrido la llama CADA 5 MINUTOS, o sea
 * 288 lecturas por día contra la misma cuota de Google que se agota cuando varios vecinos escriben
 * a la vez. Un control interno del sistema no tiene por qué competir por ese cupo con la atención.
 */
async function obtenerSeguimientosVencidos() {
    const ahora = Date.now();
    const rows = await filas('reportes');

    return rows
        .filter(r => {
            const estado = String(r.get('estado') || '').toLowerCase();
            if (CERRADOS.has(estado)) return false;
            const prox = r.get('proximo_seguimiento');
            if (!prox) return false;
            const t = new Date(prox).getTime();
            return Number.isFinite(t) && t <= ahora;
        })
        .map(r => ({
            id_evento: r.get('codigo_caso') || '',
            edificio:  r.get('edificio') || '',
            vecino:    r.get('vecino') || '',
            telefono:  r.get('telefono') || '',
            depto:     r.get('depto') || '',
            problema:  r.get('mensaje') || r.get('problema') || '',
            urgencia:  r.get('urgencia') || '',
            tecnico:   r.get('tecnico') || '',
            paso:      parseInt(r.get('seguimiento_paso') || '1', 10) || 1,
            nota:      r.get('seguimiento_nota') || '',
        }));
}

// ── BÚSQUEDAS QUE ANTES SE HACÍAN A MANO SOBRE LA PLANILLA ──────────────────
//
// index.js tenía tres lugares que abrían la planilla y recorrían las filas por su cuenta, sin
// pasar por ninguna función. Eran los últimos puntos del motor que hablaban con Google directo.

/** El vecino del último caso abierto que coincida con el edificio o con el nombre del técnico. */
async function buscarVecinoDeCasoAbierto({ edificio, nombreTecnico }) {
    const rows = await filas('reportes');
    const edifBuscado = String(edificio || '').toLowerCase().trim();
    const techBuscado = String(nombreTecnico || '').toLowerCase().trim();

    // De atrás hacia adelante: interesa el caso más reciente.
    const row = [...rows].reverse().find(r => {
        const rEst = String(r.get('estado') || '').toLowerCase().trim();
        if (CERRADOS.has(rEst)) return false;

        const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
        const rTech = String(r.get('tecnico') || '').toLowerCase().trim();
        const rTel = String(r.get('telefono') || '').replace(/\D/g, '');

        const matchEdif = edifBuscado && (rEdif.includes(edifBuscado) || edifBuscado.includes(rEdif));
        const matchTech = techBuscado && rTech.includes(techBuscado);

        return rTel.length >= 6 && (matchEdif || matchTech);
    });

    if (!row) return null;

    const nombre = row.get('vecino');
    return {
        nombre: (nombre && nombre !== 'Desconocido' && nombre !== 'Vecino') ? nombre : '',
        telefono: row.get('telefono'),
        departamento: row.get('depto') || '',
        edificio: row.get('edificio') || edificio || '',
    };
}

/** El último vecino registrado en un edificio, cuando no hay nada mejor a mano. */
async function buscarUltimoVecinoDeEdificio(edificio) {
    if (!edificio) return null;
    const rows = await filas('vecinos');
    const edifBuscado = String(edificio).toLowerCase().trim();

    const row = [...rows].reverse().find(r => {
        const edif = String(r.get('edificio') || '').toLowerCase().trim();
        const tel = String(r.get('telefono') || '').replace(/\D/g, '');
        return tel.length >= 6 && (edif.includes(edifBuscado) || edifBuscado.includes(edif));
    });

    if (!row) return null;
    return {
        nombre: row.get('nombre') || '',
        telefono: row.get('telefono'),
        departamento: row.get('departamento') || '',
        edificio: row.get('edificio') || edificio,
    };
}

/** A qué edificio corresponde el último caso abierto de un técnico. */
/**
 * El caso abierto que está atendiendo ese técnico, con todo lo que hace falta para retomar la
 * conversación: el código del caso, el edificio y de qué vecino se trata.
 *
 * Existe porque ese estado vivía únicamente en `global.colasProveedores`, en memoria. Se llena
 * cuando se le manda la plantilla al técnico y se pierde en cada `pm2 restart`. Si el técnico
 * contestaba después de un reinicio -- que con PM2 reiniciando decenas de veces por día es lo
 * habitual -- Marcos ya no sabía a qué caso pertenecía esa respuesta: no podía guardar la
 * confirmación (le faltaba el id del caso) ni avisarle al vecino (le faltaba el teléfono).
 */
/**
 * La CARTERA del proveedor: qué edificios atiende y de qué administrador es cada uno.
 *
 * Devuelve `[{ edificio, cliente }]`, con el cliente incluido a propósito. Un técnico no pertenece
 * a un administrador: el mismo electricista atiende 11 administradores distintos desde un solo
 * número de WhatsApp, y en una misma tanda puede mandar 3 facturas de uno, 2 de otro y 1 de un
 * tercero. Nada acá puede "atarlo" al administrador de la factura anterior -- cada comprobante se
 * resuelve por su cuenta y el cliente sale del edificio, nunca del chat.
 *
 * Es también contra lo que se valida cualquier edificio deducido para una factura, porque el dato
 * menos confiable de todos -- la dirección impresa en el comprobante -- venía ganándole a los
 * demás: el papel lleva la dirección de FACTURACIÓN (el estudio del administrador, o el domicilio
 * fiscal del propio técnico), no la del trabajo. Visto en producción: una factura por un trabajo en
 * "SAN PATRICIO 159" abrió un evento en "san patricio 270", que era lo que decía el encabezado.
 *
 * Se arma de dos fuentes:
 *   1. TODAS las asignaciones del técnico (`proveedor_asignaciones`), que pueden ser de clientes
 *      distintos -- es lo que cada administrador cargó explícitamente.
 *   2. TODOS los clientes en cuya lista maestra figura, con sus edificios. Cubre al técnico que ya
 *      trabaja para ese administrador pero todavía no fue asignado edificio por edificio.
 */
async function edificiosDelProveedor({ nombre = '', telefono = '' } = {}) {
    const nombreBuscado = String(nombre || '').toLowerCase().trim();
    const telBuscado = String(telefono || '').replace(/\D/g, '');
    if (!nombreBuscado && !telBuscado) return [];

    const activo = r => {
        const est = String(r.get('estado') || '').toLowerCase().trim();
        return est !== 'eliminado' && est !== 'inactivo';
    };
    // El teléfono manda sobre el nombre: es el mismo dato de los dos lados de la planilla, mientras
    // que el nombre puede diferir entre la lista maestra y la asignación (dos técnicos de la misma
    // empresa comparten la línea).
    const esEsteProveedor = r => {
        if (telBuscado && mismoTel(r.get('telefono') || r.get('proveedor_telefono'), telBuscado)) return true;
        if (!nombreBuscado) return false;
        const n = String(r.get('proveedor') || r.get('proveedor_nombre') || r.get('nombre') || '').toLowerCase().trim();
        return Boolean(n) && (n === nombreBuscado || n.includes(nombreBuscado) || nombreBuscado.includes(n));
    };

    const cartera = new Map(); // edificio normalizado -> { edificio, cliente }
    const sumar = (edificio, cliente) => {
        const ed = String(edificio || '').trim();
        if (!ed) return;
        const clave = ed.toLowerCase();
        const yaEsta = cartera.get(clave);
        // Si ya estaba sin cliente y ahora sabemos de quién es, se completa.
        if (!yaEsta || (!yaEsta.cliente && cliente)) {
            cartera.set(clave, { edificio: ed, cliente: String(cliente || '').trim() });
        }
    };

    for (const a of await filas('proveedor_asignaciones')) {
        if (!activo(a) || !esEsteProveedor(a)) continue;
        sumar(a.get('edificio'), a.get('cliente'));
    }

    // TODOS los clientes que tienen a este técnico en su lista maestra, no solo el primero.
    const provs = await filas('proveedores');
    const susClientes = new Set(
        provs
            .filter(r => activo(r) && esEsteProveedor(r))
            .map(r => String(r.get('cliente') || '').toLowerCase().trim())
            .filter(Boolean)
    );

    if (susClientes.size) {
        for (const e of await filas('edificios')) {
            const suCliente = String(e.get('cliente') || '').toLowerCase().trim();
            if (suCliente && susClientes.has(suCliente)) {
                sumar(e.get('nombre') || e.get('edificio') || e.get('direccion'), suCliente);
            }
        }
        // La ficha del cliente también puede traer sus edificios en una lista separada por comas.
        for (const c of await filas('clientes')) {
            const usuario = String(c.get('usuario') || '').toLowerCase().trim();
            const nombreCli = String(c.get('nombre') || '').toLowerCase().trim();
            if (!susClientes.has(usuario) && !susClientes.has(nombreCli)) continue;
            for (const ed of String(c.get('edificios') || '').split(',').map(s => s.trim()).filter(Boolean)) {
                sumar(ed, usuario || nombreCli);
            }
        }
    }

    return Array.from(cartera.values());
}

/**
 * Los casos de un técnico, ABIERTOS O YA CERRADOS, dentro de una ventana de días.
 *
 * Devuelve una LISTA, del más reciente al más viejo, y ese plural es el punto: un técnico que
 * atiende varios administradores tiene varios casos recientes a la vez, y quedarse con "el último"
 * le imputaría la factura al edificio equivocado con total seguridad. Con la lista en la mano,
 * quien llama puede usarla solo cuando hay UN candidato, y cuando hay varios preguntarle al técnico
 * de cuál se trata en vez de adivinar.
 *
 * `buscarCasoAbiertoPorTecnico` no sirve para las facturas: el técnico hace el trabajo, el caso se
 * cierra, y la factura llega días después -- cuando ya no queda ningún caso abierto suyo.
 */
async function buscarCasosRecientesPorTecnico(nombreTecnico, telefonoTecnico = '', dias = 30) {
    const techBuscado = String(nombreTecnico || '').toLowerCase().trim();
    const telTecnico = String(telefonoTecnico || '').replace(/\D/g, '');
    if (!techBuscado && !telTecnico) return [];

    const desde = Date.now() - dias * 24 * 60 * 60 * 1000;
    const esReciente = r => {
        const f = r.get('fecha');
        if (!f) return true; // sin fecha no lo descartamos: igual queda ordenado por la tabla
        const t = new Date(f).getTime();
        return Number.isNaN(t) ? true : t >= desde;
    };

    const rows = (await filas('reportes')).filter(esReciente).filter(r => {
        if (telTecnico && mismoTel(r.get('tel_tecnico'), telTecnico)) return true;
        if (!techBuscado) return false;
        const rTech = String(r.get('tecnico') || '').toLowerCase().trim();
        return Boolean(rTech) && (rTech.includes(techBuscado) || techBuscado.includes(rTech));
    });

    return rows.reverse().map(row => {
        const estado = String(row.get('estado') || '').toLowerCase().trim();
        return {
            id_evento: row.get('codigo_caso') || row.get('id_evento') || '',
            edificio:  row.get('edificio') || '',
            telefono:  row.get('telefono') || '',
            vecino:    row.get('vecino') || '',
            problema:  row.get('problema') || row.get('notas_ia') || '',
            estado:    row.get('estado') || '',
            cerrado:   CERRADOS.has(estado),
            fecha:     row.get('fecha') || '',
            rubro:     row.get('rubro_tecnico') || '',
        };
    });
}

async function buscarCasoAbiertoPorTecnico(nombreTecnico, telefonoTecnico = '') {
    const techBuscado = String(nombreTecnico || '').toLowerCase().trim();
    const telTecnico = String(telefonoTecnico || '').replace(/\D/g, '');
    if (!techBuscado && !telTecnico) return null;

    const rows = await filas('reportes');
    const abiertos = rows.filter(r => !CERRADOS.has(String(r.get('estado') || '').toLowerCase().trim()));

    let row = techBuscado ? [...abiertos].reverse().find(r => {
        const rTech = String(r.get('tecnico') || '').toLowerCase().trim();
        return rTech && (rTech.includes(techBuscado) || techBuscado.includes(rTech));
    }) : null;

    // Buscar por nombre no alcanza: el caso guarda el nombre que trae la ASIGNACIÓN y el técnico
    // que escribe se identifica con el de la LISTA MAESTRA, y no tienen por qué coincidir. Visto en
    // producción: el caso quedó con "a dario juju" y quien contestó fue reconocido como "julio" --
    // el mismo teléfono con dos nombres, porque son dos técnicos de la misma empresa. Sin
    // coincidencia no había id de caso, y la confirmación del técnico no se guardaba en ningún lado.
    //
    // El teléfono sí es el mismo dato de los dos lados, así que se usa para llegar al edificio que
    // tiene asignado y desde ahí al caso abierto.
    if (!row && telTecnico) {
        const asigs = await filas('proveedor_asignaciones');
        const edificiosDelTecnico = new Set(
            asigs
                .filter(a => mismoTel(a.get('telefono') || a.get('proveedor_telefono'), telTecnico))
                .map(a => String(a.get('edificio') || '').toLowerCase().trim())
                .filter(Boolean)
        );

        if (edificiosDelTecnico.size) {
            row = [...abiertos].reverse().find(r =>
                edificiosDelTecnico.has(String(r.get('edificio') || '').toLowerCase().trim())
            );
            if (row) console.log(`🔎 Caso del técnico resuelto por teléfono (${telTecnico}), no por nombre: el caso figura a nombre de "${row.get('tecnico') || '—'}".`);
        }
    }

    if (!row) return null;
    return {
        id_evento: row.get('codigo_caso') || row.get('id_evento') || '',
        edificio:  row.get('edificio') || '',
        telefono:  row.get('telefono') || '',
        vecino:    row.get('vecino') || '',
        // El rubro del caso es lo que permite saber CUÁL de los técnicos que comparten una línea
        // está escribiendo. Ver `proveedoresPorTelefono`.
        rubro:     row.get('rubro_tecnico') || '',
    };
}

/**
 * Todos los proveedores que comparten un mismo teléfono, con su rubro.
 *
 * Un número no identifica a una persona: es el conmutador de una empresa con varios oficios
 * detrás. Caso real de esta planilla: el 541169241157 figura como JULIO (plomero) y como DARIO
 * (electricista) -- dos técnicos de la misma empresa compartiendo la línea.
 *
 * `buscarRolPorTelefono` devuelve el primero que encuentra, y por eso Marcos saludaba "Gracias,
 * Julio" cuando el que contestaba un caso de electricidad era Dario. Con esta lista y el rubro
 * del caso se puede elegir bien.
 */
async function proveedoresPorTelefono(telefono) {
    const tel = String(telefono || '').replace(/\D/g, '');
    if (!tel) return [];

    const activo = r => {
        const est = String(r.get('estado') || '').toLowerCase().trim();
        return est !== 'eliminado' && est !== 'inactivo';
    };

    const encontrados = [];
    const vistos = new Set();
    const sumar = (nombre, rubro, origen) => {
        const n = String(nombre || '').trim();
        if (!n) return;
        const clave = n.toLowerCase();
        if (vistos.has(clave)) return;
        vistos.add(clave);
        encontrados.push({ nombre: n, rubro: String(rubro || '').trim(), origen });
    };

    for (const r of await filas('proveedores')) {
        if (!activo(r) || !mismoTel(r.get('telefono') || r.get('wsp'), tel)) continue;
        sumar(r.get('nombre'), r.get('rubro') || r.get('especialidad'), 'lista maestra');
    }
    for (const a of await filas('proveedor_asignaciones')) {
        if (!activo(a) || !mismoTel(a.get('telefono') || a.get('proveedor_telefono'), tel)) continue;
        sumar(a.get('proveedor') || a.get('proveedor_nombre'), a.get('rubro'), 'asignación');
    }

    return encontrados;
}

async function buscarEdificioDeCasoAbiertoPorTecnico(nombreTecnico) {
    const caso = await buscarCasoAbiertoPorTecnico(nombreTecnico);
    return caso ? caso.edificio : '';
}

/**
 * Lo que el técnico ya respondió sobre la visita de este vecino.
 *
 * Se busca en el caso y no en memoria justamente porque la memoria se pierde: es lo que hacía que
 * Marcos, después de un reinicio, le contestara al vecino "estoy consultando con el técnico"
 * teniendo la confirmación desde hacía una hora.
 */
/**
 * Un caso por su código, para poder contestar "¿cómo va el CASO-1001?".
 *
 * Devuelve solo lo que hace falta para informar el estado. Deliberadamente NO trae ningún importe:
 * lo que costó el arreglo es tema del administrador, que lo ve en el panel, y no algo que el
 * encargado o la gente de limpieza tengan que enterarse por WhatsApp.
 */
async function buscarCasoPorCodigo(codigo) {
    const buscado = String(codigo || '').replace(/\D/g, '');
    if (!buscado) return null;

    const rows = await filas('reportes');
    const row = rows.find(r => {
        const rCod = String(r.get('codigo_caso') || r.get('id_evento') || '').replace(/\D/g, '');
        return rCod && rCod === buscado;
    });

    if (!row) return null;
    const estado = String(row.get('estado') || '').toLowerCase().trim();
    return {
        id_evento:   row.get('codigo_caso') || row.get('id_evento') || '',
        edificio:    row.get('edificio') || '',
        telefono:    row.get('telefono') || '',
        vecino:      row.get('vecino') || '',
        problema:    row.get('problema') || row.get('notas_ia') || '',
        estado:      row.get('estado') || 'en_proceso',
        cerrado:     CERRADOS.has(estado),
        tecnico:     row.get('tecnico') || '',
        eta:         row.get('tecnico_eta') || '',
        confirmado:  row.get('tecnico_confirmado') || '',
        fecha:       row.get('fecha') || '',
    };
}

/** Un caso abierto sirve para responder por la visita solo si el técnico ya confirmó. */
function tieneConfirmacionVigente(r) {
    const estado = String(r.get('estado') || '').toLowerCase();
    if (CERRADOS.has(estado)) return false;
    return Boolean(String(r.get('tecnico_confirmado') || '').trim());
}

function confirmacionDeFila(row) {
    if (!row) return null;
    return {
        confirmado: true,
        eta:      row.get('tecnico_eta') || '',
        cuando:   row.get('tecnico_confirmado') || '',
        tecnico:  row.get('tecnico') || '',
        edificio: row.get('edificio') || '',
    };
}

async function buscarConfirmacionTecnicoDeVecino(telefono) {
    const tel = String(telefono || '').replace(/\D/g, '');
    if (!tel) return null;

    const rows = await filas('reportes');
    return confirmacionDeFila([...rows].reverse().find(r => {
        if (!tieneConfirmacionVigente(r)) return false;
        const rTel = String(r.get('telefono') || '').replace(/\D/g, '');
        return rTel && (rTel === tel || rTel.endsWith(tel.slice(-8)));
    }));
}

/**
 * Lo mismo, pero buscando por edificio en lugar de por quién abrió el caso.
 *
 * El encargado, el suplente, la guardia o el administrador preguntan por una visita que no
 * abrieron ellos: buscando solo por teléfono no encontraban nada y Marcos les contestaba que
 * estaba consultando algo que ya tenía respondido.
 *
 * A un vecino cualquiera NO se le responde por esta vía: el caso puede ser dentro de otra unidad,
 * y contarle a un tercero qué pasa en el departamento de al lado no es asunto suyo.
 */
async function buscarConfirmacionTecnicoDeEdificio(edificio) {
    const buscado = String(edificio || '').toLowerCase().trim();
    if (!buscado) return null;

    const rows = await filas('reportes');
    return confirmacionDeFila([...rows].reverse().find(r => {
        if (!tieneConfirmacionVigente(r)) return false;
        const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
        return rEdif && (rEdif === buscado || rEdif.includes(buscado) || buscado.includes(rEdif));
    }));
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
    buscarFacturasProveedor,
    obtenerCasosAbiertosEdificio,
    obtenerEventosPendientesAdmin,
    obtenerSeguimientosVencidos,
    buscarConfirmacionTecnicoDeVecino,
    buscarVecinoDeCasoAbierto,
    buscarUltimoVecinoDeEdificio,
    buscarEdificioDeCasoAbiertoPorTecnico,
    buscarCasoAbiertoPorTecnico,
    buscarCasosRecientesPorTecnico,
    proveedoresPorTelefono,
    edificiosDelProveedor,
    buscarCasoPorCodigo,
    buscarConfirmacionTecnicoDeEdificio,
};
