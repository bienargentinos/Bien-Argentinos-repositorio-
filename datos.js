/**
 * DATOS — capa única de acceso a los datos de Marcos
 *
 * Expone exactamente las mismas funciones que sheets.js, con los mismos nombres, los mismos
 * parámetros y los mismos valores de retorno. El motor cambia una sola línea por archivo
 * (`require('./sheets')` → `require('./datos')`) y no se entera de nada más.
 *
 * ETAPA ACTUAL: ESCRITURA DUPLICADA.
 *   - Google Sheets sigue siendo la fuente de verdad: todas las LECTURAS salen de ahí, y las
 *     escrituras se hacen ahí primero. Lo que devuelve cada función es lo que devolvió Sheets.
 *   - Además, cada escritura manda una copia a PostgreSQL para que la base se mantenga al día.
 *
 * La copia a PostgreSQL es deliberadamente incapaz de romper nada: va sin `await` en el camino
 * de la respuesta y con su propio try/catch. Si Postgres está caído, Marcos atiende igual y
 * Sheets conserva todo; cuando Postgres vuelve, el próximo import lo pone al día.
 *
 * PRÓXIMA ETAPA: pasar las lecturas a PostgreSQL una por una, empezando por las del camino
 * caliente (perfil de edificio, vecino por teléfono, técnico asignado), que hoy son un viaje
 * HTTP a Google de cientos de milisegundos cada una.
 */

const sheets = require('./sheets');

// ── Utilidades ──────────────────────────────────────────────────────────────

const soloDigitos = t => String(t || '').replace(/\D/g, '');

/**
 * Ejecuta una copia a PostgreSQL sin que pueda afectar al flujo de Marcos: no se espera, no
 * propaga excepciones y no interrumpe la respuesta al vecino.
 */
function copiarAPg(descripcion, fn) {
    try {
        Promise.resolve(fn()).catch(err =>
            console.error(`[PG] No se pudo copiar ${descripcion}: ${err.message}`)
        );
    } catch (err) {
        console.error(`[PG] No se pudo copiar ${descripcion}: ${err.message}`);
    }
}

/**
 * Inserta o actualiza una fila por su clave natural. La comparación normaliza mayúsculas y
 * espacios para que "Julio " y "julio" sean la misma fila, igual que hace el import.
 */
async function upsert(tabla, clave, valores) {
    const { pool } = require('./db-pg');
    const columnas = Object.keys(valores);

    const condicion = clave
        .map((c, i) => `lower(trim(coalesce(${c}::text, ''))) = lower(trim(coalesce($${i + 1}::text, '')))`)
        .join(' AND ');
    const existente = await pool.query(
        `SELECT id FROM ${tabla} WHERE ${condicion} LIMIT 1`,
        clave.map(c => valores[c])
    );

    if (existente.rowCount) {
        // Solo se pisan los campos que traen valor: un update parcial no tiene por qué borrar
        // datos que ya estaban cargados (por ejemplo el nombre del vecino cuando solo se está
        // actualizando su autorización de contacto).
        const conValor = columnas.filter(c => {
            const v = valores[c];
            return v !== undefined && v !== null && String(v) !== '';
        });
        if (conValor.length === 0) return;
        const sets = conValor.map((c, i) => `${c} = $${i + 1}`).join(', ');
        await pool.query(
            `UPDATE ${tabla} SET ${sets} WHERE id = $${conValor.length + 1}`,
            [...conValor.map(c => valores[c]), existente.rows[0].id]
        );
    } else {
        const marcadores = columnas.map((_, i) => `$${i + 1}`).join(', ');
        await pool.query(
            `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${marcadores})`,
            columnas.map(c => valores[c])
        );
    }
}

// ── LECTURAS (PostgreSQL primero, Sheets de respaldo) ───────────────────────
//
// Cada lectura sale de PostgreSQL, que está en el mismo servidor: menos de 1ms contra los varios
// cientos de milisegundos que tarda un viaje HTTP a Google. En una conversación Marcos hace seis u
// ocho de estas búsquedas, así que es la mayor parte de lo que hoy tarda en contestar.
//
// Si PostgreSQL no encuentra nada, se le pregunta a Sheets igual. Eso hace el cambio reversible en
// los hechos: mientras Sheets siga siendo la fuente de verdad, un dato que todavía no llegó a
// PostgreSQL no rompe nada -- se responde más lento y se avisa en el log, pero se responde. El día
// que los avisos dejen de aparecer, sabemos que la copia está completa.
//
// Con LECTURA_PG=off en el .env todo vuelve a salir de Sheets, sin tocar código.

const LECTURA_PG = String(process.env.LECTURA_PG || 'on').toLowerCase() !== 'off';

const vacio = v => v === null || v === undefined ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Intenta leer de PostgreSQL y cae a Sheets si no hay dato o si algo falla.
 * @param {string} nombre  Para poder identificar en el log qué lectura cayó al respaldo.
 */
async function leer(nombre, args, fnPg, fnSheets) {
    if (LECTURA_PG) {
        try {
            const pg = require('./datos-pg');
            const res = await pg[fnPg](...args);
            if (!vacio(res)) return res;
            console.log(`↩️ ${nombre}: sin dato en PostgreSQL, se consulta Sheets.`);
        } catch (err) {
            console.error(`↩️ ${nombre}: error leyendo de PostgreSQL (${err.message}). Se consulta Sheets.`);
        }
    }
    return sheets[fnSheets](...args);
}

async function buscarVecinosPorTelefono(telefono) {
    return leer('buscarVecinosPorTelefono', [telefono], 'buscarVecinosPorTelefono', 'buscarVecinosPorTelefono');
}
async function buscarVecinoPorTelefono(telefono) {
    return leer('buscarVecinoPorTelefono', [telefono], 'buscarVecinoPorTelefono', 'buscarVecinoPorTelefono');
}
async function buscarPerfilEdificio(nombreEdificio) {
    return leer('buscarPerfilEdificio', [nombreEdificio], 'buscarPerfilEdificio', 'buscarPerfilEdificio');
}
async function listarEdificiosConocidos() {
    return leer('listarEdificiosConocidos', [], 'listarEdificiosConocidos', 'listarEdificiosConocidos');
}
async function buscarPersonalDeTurno(args) {
    return leer('buscarPersonalDeTurno', [args], 'buscarPersonalDeTurno', 'buscarPersonalDeTurno');
}
async function buscarMemoriaVecino(telefono) {
    return leer('buscarMemoriaVecino', [telefono], 'buscarMemoriaVecino', 'buscarMemoriaVecino');
}
async function buscarAccesosEdificio(edificio) {
    return leer('buscarAccesosEdificio', [edificio], 'buscarAccesosEdificio', 'buscarAccesosEdificio');
}

// El rol nunca "no está": alguien desconocido es un vecino. Por eso su respaldo no se activa por
// respuesta vacía sino solo ante un error: si Postgres dice "vecino", esa es la respuesta buena y
// preguntarle a Sheets sería puro gasto.
async function buscarRolPorTelefono(telefono) {
    if (LECTURA_PG) {
        try {
            return await require('./datos-pg').buscarRolPorTelefono(telefono);
        } catch (err) {
            console.error(`↩️ buscarRolPorTelefono: error leyendo de PostgreSQL (${err.message}). Se consulta Sheets.`);
        }
    }
    return sheets.buscarRolPorTelefono(telefono);
}

// ── ESCRITURAS (Sheets manda, PostgreSQL recibe copia) ──────────────────────

async function guardarReporte(datos) {
    const res = await sheets.guardarReporte(datos);

    // El código [CASO-XXXX] lo asigna Sheets, así que la copia se hace recién con el resultado.
    if (res?.id_evento) {
        copiarAPg(`el reporte ${res.id_evento}`, () => upsert('reportes', ['codigo_caso'], {
            codigo_caso:    res.id_evento,
            fecha:          datos.fechaInicio || new Date().toLocaleString('es-AR'),
            edificio:       datos.edificio || '',
            vecino:         datos.vecino || '',
            telefono:       soloDigitos(datos.telefono),
            depto:          datos.depto || '',
            mensaje:        datos.problema || '',
            problema:       datos.problema || '',
            tipo:           datos.tipo || 'whatsapp',
            urgencia:       datos.urgencia || '',
            estado:         datos.estado || 'nuevo',
            notas:          datos.notas_ia || datos.notas || '',
            notas_ia:       datos.notas_ia || '',
            tecnico:        datos.tecnico || '',
            acceso:         datos.acceso || '',
            audio_url:      datos.audio_url || '',
            transcripcion:  datos.transcripcion || '',
            historial_chat: Array.isArray(datos.historial_chat)
                ? JSON.stringify(datos.historial_chat)
                : (datos.historial_chat || ''),
        }));
    }
    return res;
}

async function guardarFactura(datos) {
    const res = await sheets.guardarFactura(datos);
    copiarAPg(`la factura de ${datos?.proveedor || 'proveedor'}`, () => upsert(
        'facturas',
        ['fecha', 'proveedor', 'monto', 'edificio'],
        {
            fecha:          new Date().toLocaleString('es-AR'),
            proveedor:      datos.proveedor || 'Desconocido',
            monto:          datos.monto || '0',
            concepto:       datos.concepto || '',
            edificio:       datos.edificio || 'No especificado',
            url_archivo:    datos.url_archivo || '',
            numero_factura: datos.numero_factura || '',
            estado:         datos.estado || 'Pendiente',
        }
    ));
    return res;
}

async function guardarMemoriaVecino(datos) {
    const res = await sheets.guardarMemoriaVecino(datos);
    copiarAPg(`la memoria de ${datos?.nombre || 'vecino'}`, () => upsert('memoria', ['telefono'], {
        telefono:              soloDigitos(datos.telefono),
        nombre:                datos.nombre || '',
        fecha_ultimo_contacto: new Date().toLocaleString('es-AR'),
        resumen_historial:     datos.resumenHistorial || '',
        notas_trato:           datos.notasTrato || '',
    }));
    return res;
}

async function agregarVecinoNuevo(datos) {
    const res = await sheets.agregarVecinoNuevo(datos);
    copiarAPg(`el vecino ${datos?.nombre || ''}`, () => upsert('vecinos', ['telefono', 'edificio'], {
        telefono:     soloDigitos(datos.telefono),
        nombre:       datos.nombre || '',
        edificio:     datos.edificio || '',
        departamento: datos.departamento || '',
        notas:        'Registro automático por bot',
    }));
    return res;
}

async function guardarAutorizacionContacto(datos) {
    const res = await sheets.guardarAutorizacionContacto(datos);
    const tel = soloDigitos(datos?.telefono);
    if (tel) {
        // Sin `edificio` en la clave: la autorización es de la persona, y el mismo teléfono puede
        // figurar en más de un edificio. Se marca en todas sus filas.
        copiarAPg(`la autorización de contacto de ${tel}`, async () => {
            const { pool } = require('./db-pg');
            await pool.query(
                `UPDATE vecinos
                    SET autoriza_contacto = COALESCE($2, autoriza_contacto),
                        contacto_acceso   = COALESCE(NULLIF($3, ''), contacto_acceso)
                  WHERE regexp_replace(coalesce(telefono, ''), '\\D', '', 'g') = $1`,
                [tel, datos.autoriza !== false, datos.contactoAcceso || '']
            );
        });
    }
    return res;
}

async function marcarTecnicoNotificado(id_evento) {
    const res = await sheets.marcarTecnicoNotificado(id_evento);
    if (id_evento) {
        copiarAPg(`la marca de notificación de ${id_evento}`, async () => {
            const { pool } = require('./db-pg');
            await pool.query(
                `UPDATE reportes SET tecnico_notificado = $2 WHERE codigo_caso = $1`,
                [id_evento, new Date().toLocaleString('es-AR')]
            );
        });
    }
    return res;
}

async function marcarCasoResueltoPorId(idEvento) {
    const res = await sheets.marcarCasoResueltoPorId(idEvento);
    if (res?.id_evento) {
        copiarAPg(`el cierre de ${res.id_evento}`, async () => {
            const { pool } = require('./db-pg');
            await pool.query(
                `UPDATE reportes SET estado = 'resuelto' WHERE codigo_caso = $1`,
                [res.id_evento]
            );
        });
    }
    return res;
}

async function guardarLlamada(datos) {
    const res = await sheets.guardarLlamada(datos);
    copiarAPg(`la llamada de ${datos?.telefono || ''}`, async () => {
        const { pool } = require('./db-pg');
        await pool.query(
            `INSERT INTO llamadas (fecha, duracion, telefono, vecino, edificio, resumen,
                                   transcripcion, urgencia, estado, mensaje_enviado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                new Date().toLocaleString('es-AR'),
                datos.duracion || '',
                soloDigitos(datos.telefono),
                datos.vecino || '',
                datos.edificio || '',
                datos.resumen || '',
                datos.transcripcion || '',
                datos.urgencia || '',
                datos.estado || '',
                datos.mensajeEnviado || '',
            ]
        );
    });
    return res;
}

async function guardarAccesoEdificio(datos) {
    const res = await sheets.guardarAccesoEdificio(datos);
    if (datos?.edificio && datos?.lugar) {
        copiarAPg(`el acceso "${datos.lugar}"`, () => upsert('accesos', ['edificio', 'lugar'], {
            edificio:    datos.edificio,
            lugar:       String(datos.lugar).toLowerCase().trim(),
            ubicacion:   datos.ubicacion || '',
            quien_abre:  datos.quienAbre || '',
            telefono:    datos.telefono || '',
            tipo_acceso: datos.tipoAcceso || '',
            notas:       datos.notas || '',
            origen:      datos.origen || '',
            fecha:       new Date().toLocaleString('es-AR'),
        }));
    }
    return res;
}

async function programarSeguimiento(datos) {
    const res = await sheets.programarSeguimiento(datos);
    if (datos?.id_evento) {
        copiarAPg(`el seguimiento de ${datos.id_evento}`, async () => {
            const { pool } = require('./db-pg');
            await pool.query(
                `UPDATE reportes SET proximo_seguimiento = $2, seguimiento_paso = $3 WHERE codigo_caso = $1`,
                [datos.id_evento, new Date(datos.cuando).toISOString(), String(datos.paso ?? 1)]
            );
        });
    }
    return res;
}

async function cancelarSeguimiento(id_evento) {
    const res = await sheets.cancelarSeguimiento(id_evento);
    if (id_evento) {
        copiarAPg(`la baja del seguimiento de ${id_evento}`, async () => {
            const { pool } = require('./db-pg');
            await pool.query(
                `UPDATE reportes SET proximo_seguimiento = NULL, seguimiento_paso = NULL WHERE codigo_caso = $1`,
                [id_evento]
            );
        });
    }
    return res;
}

// ── EXPORTACIÓN ─────────────────────────────────────────────────────────────
// Todo lo que no está envuelto arriba pasa tal cual a sheets.js: las lecturas todavía salen de
// Google Sheets, que sigue siendo la fuente de verdad en esta etapa.

module.exports = {
    ...sheets,
    guardarReporte,
    guardarFactura,
    guardarMemoriaVecino,
    agregarVecinoNuevo,
    guardarAutorizacionContacto,
    marcarTecnicoNotificado,
    marcarCasoResueltoPorId,
    guardarLlamada,
    guardarAccesoEdificio,
    programarSeguimiento,
    cancelarSeguimiento,
    buscarVecinosPorTelefono,
    buscarVecinoPorTelefono,
    buscarPerfilEdificio,
    listarEdificiosConocidos,
    buscarPersonalDeTurno,
    buscarMemoriaVecino,
    buscarRolPorTelefono,
    buscarAccesosEdificio,
};
