require('dotenv').config();
const { getSheet } = require('./sheets');
const { pool, initPgSchema } = require('./db-pg');

/**
 * IMPORTACIÓN DE GOOGLE SHEETS A POSTGRESQL
 *
 * Reemplaza a migrate-sheets-to-sql-pg.js, que adivinaba nombres de pestañas y de columnas y por
 * eso importó 3 tablas de 9 sin que quedara registro de cuáles habían fallado. Acá los nombres no
 * se adivinan: son los que devolvió el diagnóstico sobre la planilla real.
 *
 * Es IDEMPOTENTE: cada fila se busca por su clave natural antes de escribir. Si ya está, se
 * actualiza; si no, se inserta. Se puede correr las veces que haga falta sin duplicar nada, que es
 * justamente lo que le faltaba al script anterior.
 *
 *   node importar-sheets-a-pg.js            → importa todo
 *   node importar-sheets-a-pg.js --simular  → informa qué haría, sin escribir
 *   node importar-sheets-a-pg.js VECINOS    → importa solo esa pestaña
 */

const SIMULAR = process.argv.includes('--simular');
const SOLO = process.argv.slice(2).filter(a => !a.startsWith('--'));

/**
 * Un mapa por pestaña. `columnas` va de columna-de-Postgres → columna-de-la-planilla (o una
 * función que la calcula). `clave` son las columnas de Postgres que identifican a la fila.
 */
const MAPEOS = [
    {
        pestaña: 'VECINOS',
        tabla: 'vecinos',
        clave: ['telefono', 'edificio'],
        columnas: {
            telefono: 'telefono', nombre: 'nombre', edificio: 'edificio',
            departamento: 'departamento', encargado: 'encargado', tel_encargado: 'tel_encargado',
            horario_encargado: 'horario_encargado', tablero: 'tablero', llaves: 'llaves',
            seguridad: 'seguridad', consejo: 'consejo', notas: 'notas',
            autoriza_contacto: r => /^(s|si|sí|true|1|x)$/i.test(String(v(r, 'autoriza_contacto')).trim()),
            contacto_acceso: 'contacto_acceso',
        },
    },
    {
        pestaña: 'EDIFICIOS',
        tabla: 'edificios',
        clave: ['edificio'],
        columnas: {
            // La planilla tiene "edificio" (el nombre largo con el que Marcos lo busca) y
            // "nombre" (el corto). La clave es el largo, pero guardamos los dos.
            edificio: r => v(r, 'edificio') || v(r, 'nombre'),
            nombre: 'nombre',
            direccion: 'direccion', zona: 'zona', aliases: 'aliases', cuit: 'cuit',
            unidades: r => parseInt(String(v(r, 'unidades')).replace(/\D/g, '') || '0', 10),
            plan: r => v(r, 'plan') || 'Base',
            horario_sum: 'horario_sum', cocheras: 'cocheras',
            admin_nombre: 'administrador',
            tel_seguridad: 'tel_seguridad',
            encargado: 'encargado', telefono_encargado: 'tel_encargado',
            encargado_estado: r => v(r, 'encargado_estado') || 'activo',
            encargado_horario: 'encargado_horario',
            encargado_suplente: 'encargado_suplente', tel_suplente: 'tel_suplente',
            suplente_horario: 'suplente_horario',
        },
    },
    {
        // La pestaña real se llama EVENTOS, no "reportes". El script anterior buscaba primero
        // "reportes" y se quedaba con esa, por eso importó 0 casos.
        pestaña: 'EVENTOS',
        tabla: 'reportes',
        clave: ['codigo_caso'],
        columnas: {
            codigo_caso: 'id_evento',
            fecha: 'fecha', edificio: 'edificio', vecino: 'vecino', telefono: 'telefono',
            depto: 'depto', unidad: 'unidad', mensaje: 'mensaje', tipo: 'tipo',
            urgencia: 'urgencia', estado: 'estado', notas: 'notas', feedback: 'feedback',
            hora_fin: 'hora_fin', audio_url: 'audio_url', transcripcion: 'transcripcion',
            historial_chat: 'historial_chat', audios_json: 'audios_json',
            involucrados_json: 'involucrados_json', chat_vecino_json: 'chat_vecino_json',
            chat_proveedor_json: 'chat_proveedor_json', tecnico_notificado: 'tecnico_notificado',
            // `problema` y `notas_ia` no existen como tales en la planilla: son los nombres que
            // usa el motor para el mismo contenido de "mensaje" y "notas".
            problema: 'mensaje',
            notas_ia: 'notas',
        },
    },
    {
        pestaña: 'CLIENTES',
        tabla: 'clientes',
        clave: ['usuario'],
        columnas: {
            nombre: 'nombre', usuario: 'usuario', contrasena: 'contrasena', email: 'email',
            edificios: 'edificios', wsp: 'wsp', notif_email: 'notif_email', notif_wsp: 'notif_wsp',
            ultimo_acceso: 'ultimo_acceso',
            activo: r => !/^(no|false|0|inactivo)$/i.test(String(v(r, 'activo')).trim()),
        },
    },
    {
        pestaña: 'proveedores',
        tabla: 'proveedores',
        clave: ['nombre', 'telefono', 'rubro', 'edificio'],
        columnas: {
            cliente: 'cliente', edificio: 'edificio', rubro: 'rubro', nombre: 'nombre',
            telefono: 'telefono', notas: 'notas',
            estado: r => v(r, 'estado') || 'activo',
        },
    },
    {
        pestaña: 'proveedor_asignaciones',
        tabla: 'proveedor_asignaciones',
        clave: ['cliente', 'edificio', 'proveedor', 'rubro'],
        columnas: {
            cliente: 'cliente', edificio: 'edificio', proveedor: 'proveedor', rubro: 'rubro',
            telefono: 'telefono', prioridad: 'prioridad',
            estado: r => v(r, 'estado') || 'activo',
        },
    },
    {
        pestaña: 'tecnicos',
        tabla: 'tecnicos',
        clave: ['nombre', 'telefono'],
        columnas: {
            nombre: 'nombre', especialidad: 'especialidad', telefono: 'telefono',
            edificios: 'edificios', acceso: 'acceso', prioridad_admin: 'prioridad_admin',
            puntaje_encuesta: 'puntaje_encuesta', activo: 'activo',
            disponible_urgencia: 'disponible_urgencia',
        },
    },
    {
        pestaña: 'personal',
        tabla: 'personal',
        clave: ['edificio', 'nombre', 'rol'],
        columnas: {
            edificio: 'edificio', estado: 'estado', horario_inicio: 'horario_inicio',
            horario_fin: 'horario_fin', nombre: 'nombre', rol: 'rol', telefono: 'telefono',
        },
    },
    {
        pestaña: 'memoria',
        tabla: 'memoria',
        clave: ['telefono'],
        columnas: {
            telefono: 'telefono', nombre: 'nombre',
            fecha_ultimo_contacto: 'fecha_ultimo_contacto',
            resumen_historial: 'resumen_historial', notas_trato: 'notas_trato',
        },
    },
    {
        pestaña: 'facturas',
        tabla: 'facturas',
        clave: ['fecha', 'proveedor', 'monto', 'edificio'],
        columnas: {
            fecha: 'fecha', proveedor: 'proveedor', monto: 'monto', concepto: 'concepto',
            edificio: 'edificio', url_archivo: 'url_archivo', estado: 'estado',
        },
    },
    {
        pestaña: 'consejo',
        tabla: 'consejo',
        clave: ['edificio', 'nombre'],
        columnas: {
            cliente: 'cliente', edificio: 'edificio', nombre: 'nombre', cargo: 'cargo',
            unidad: 'unidad', telefono: 'telefono', email: 'email', notas: 'notas',
            estado: 'estado',
        },
    },
    {
        // Quedó fuera del primer import porque la pestaña tenía la columna "estado" repetida y no
        // se podía leer. Ya desduplicada, la segunda se llama "estado_gestion".
        pestaña: 'solicitudes',
        tabla: 'solicitudes',
        clave: ['fecha', 'usuario', 'edificio', 'campo'],
        columnas: {
            fecha: 'fecha', usuario: 'usuario', edificio: 'edificio', campo: 'campo',
            valor_actual: 'valor_actual', valor_nuevo: 'valor_nuevo',
            estado: 'estado', estado_gestion: 'estado_gestion',
            motivo_rechazo: 'motivo_rechazo',
        },
    },
    {
        pestaña: 'suscripciones_planes',
        tabla: 'suscripciones_planes',
        clave: ['nombre'],
        columnas: {
            nombre: 'nombre', estado: 'estado', precio: 'precio', moneda: 'moneda',
            edificios: 'edificios', mensajes: 'mensajes', llamadas: 'llamadas',
            servicios: 'servicios',
        },
    },
];

/** Lee una celda de la fila sin importar mayúsculas ni espacios en la cabecera. */
function v(row, columna) {
    try {
        const obj = row.toObject ? row.toObject() : row;
        const buscada = String(columna).toLowerCase().trim();
        for (const prop of Object.keys(obj)) {
            if (prop.toLowerCase().trim() === buscada) {
                const val = obj[prop];
                return val === undefined || val === null ? '' : String(val).trim();
            }
        }
    } catch (_) { /* fila corrupta: se trata como vacía */ }
    return '';
}

function valorDe(row, def) {
    return typeof def === 'function' ? def(row) : v(row, def);
}

async function importarPestaña(doc, mapeo) {
    const { pestaña, tabla, clave, columnas } = mapeo;

    const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === pestaña.toLowerCase().trim());
    if (!sheet) {
        console.log(`   ⏭️  "${pestaña}": la pestaña no existe en la planilla`);
        return;
    }

    let rows;
    try {
        await sheet.loadHeaderRow();
        rows = await sheet.getRows();
    } catch (err) {
        // El caso real: la pestaña "solicitudes" tiene la columna "estado" repetida y la librería
        // se niega a leerla. Se informa y se sigue con las demás en vez de abortar todo.
        console.log(`   ❌ "${pestaña}": no se pudo leer — ${err.message.split('\n')[0]}`);
        return;
    }

    const nombresPg = Object.keys(columnas);
    let insertadas = 0, actualizadas = 0, salteadas = 0;

    for (const row of rows) {
        const valores = {};
        for (const colPg of nombresPg) valores[colPg] = valorDe(row, columnas[colPg]);

        // Una fila sin ningún valor en su clave es una fila vacía de la planilla: se ignora.
        const claveVacia = clave.every(c => String(valores[c] ?? '').trim() === '');
        if (claveVacia) { salteadas++; continue; }

        const condicion = clave
            .map((c, i) => `lower(trim(coalesce(${c}::text, ''))) = lower(trim(coalesce($${i + 1}::text, '')))`)
            .join(' AND ');
        const paramsClave = clave.map(c => valores[c]);

        if (SIMULAR) {
            const existe = await pool.query(`SELECT 1 FROM ${tabla} WHERE ${condicion} LIMIT 1`, paramsClave);
            existe.rowCount ? actualizadas++ : insertadas++;
            continue;
        }

        const existente = await pool.query(`SELECT id FROM ${tabla} WHERE ${condicion} LIMIT 1`, paramsClave);

        if (existente.rowCount) {
            const sets = nombresPg.map((c, i) => `${c} = $${i + 1}`).join(', ');
            await pool.query(
                `UPDATE ${tabla} SET ${sets} WHERE id = $${nombresPg.length + 1}`,
                [...nombresPg.map(c => valores[c]), existente.rows[0].id]
            );
            actualizadas++;
        } else {
            const marcadores = nombresPg.map((_, i) => `$${i + 1}`).join(', ');
            await pool.query(
                `INSERT INTO ${tabla} (${nombresPg.join(', ')}) VALUES (${marcadores})`,
                nombresPg.map(c => valores[c])
            );
            insertadas++;
        }
    }

    const total = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tabla}`);
    console.log(
        `   ✅ "${pestaña}" → ${tabla}: ${insertadas} nueva(s), ${actualizadas} actualizada(s)` +
        `${salteadas ? `, ${salteadas} vacía(s)` : ''} — total en la tabla: ${total.rows[0].c}`
    );
}

async function importar() {
    console.log(SIMULAR
        ? '🔎 MODO SIMULACIÓN — se informa qué se importaría, sin escribir nada\n'
        : '📥 Importando Google Sheets → PostgreSQL...\n');

    await initPgSchema();

    const doc = await getSheet();
    console.log(`📊 Planilla: "${doc.title}"\n`);

    const aProcesar = SOLO.length
        ? MAPEOS.filter(m => SOLO.some(s => s.toLowerCase() === m.pestaña.toLowerCase()))
        : MAPEOS;

    if (aProcesar.length === 0) {
        console.log(`❌ Ninguna pestaña coincide con: ${SOLO.join(', ')}`);
        process.exit(1);
    }

    for (const mapeo of aProcesar) {
        try {
            await importarPestaña(doc, mapeo);
        } catch (err) {
            console.log(`   ❌ "${mapeo.pestaña}": ${err.message.split('\n')[0]}`);
        }
    }

    console.log(SIMULAR
        ? '\n✅ Simulación terminada. Volvé a correrlo sin --simular para importar de verdad.'
        : '\n✅ Importación terminada. Se puede volver a correr cuando quieras: actualiza en vez de duplicar.');

    process.exit(0);
}

importar().catch(err => {
    console.error('❌ Error en la importación:', err.message);
    process.exit(1);
});
