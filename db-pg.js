const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://marcos:marcos2024@127.0.0.1:5432/marcos_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
});


// Inicialización de Esquema PostgreSQL + pgvector.
//
// Memoizada a propósito: los scripts sueltos llaman a initPgSchema() de forma explícita y el
// módulo ya la dispara al cargarse, con lo cual dos corridas de los mismos CREATE TABLE salían en
// paralelo y chocaban entre sí ("duplicate key value violates unique constraint
// pg_class_relname_nsp_index"). Ese choque era inofensivo, pero caía en el mismo catch que
// reportaría una falla real del esquema y la dejaba indistinguible del ruido.
let promesaEsquema = null;
function initPgSchema() {
    if (!promesaEsquema) promesaEsquema = _initPgSchema();
    return promesaEsquema;
}

async function _initPgSchema() {
    let client;
    try {
        client = await pool.connect();
        await client.query(`
            CREATE EXTENSION IF NOT EXISTS vector;

            CREATE TABLE IF NOT EXISTS vecinos (
                id SERIAL PRIMARY KEY,
                telefono VARCHAR(50),
                nombre VARCHAR(150),
                edificio VARCHAR(150),
                departamento VARCHAR(50),
                encargado VARCHAR(150),
                tel_encargado VARCHAR(50),
                horario_encargado TEXT,
                tablero TEXT,
                llaves TEXT,
                seguridad TEXT,
                consejo TEXT,
                notas TEXT,
                autoriza_contacto BOOLEAN DEFAULT FALSE,
                contacto_acceso TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS edificios (
                id SERIAL PRIMARY KEY,
                edificio VARCHAR(150) UNIQUE,
                tipo VARCHAR(100),
                direccion TEXT,
                zona VARCHAR(100),
                aliases TEXT,
                cuit VARCHAR(50),
                unidades INT DEFAULT 0,
                plan VARCHAR(50) DEFAULT 'Base',
                horario_sum TEXT,
                cocheras TEXT,
                admin_nombre VARCHAR(150),
                admin_telefono VARCHAR(50),
                tel_seguridad VARCHAR(50),
                notas_especiales TEXT,
                encargado VARCHAR(150),
                telefono_encargado VARCHAR(50),
                encargado_estado VARCHAR(50) DEFAULT 'activo',
                encargado_horario TEXT,
                encargado_suplente VARCHAR(150),
                tel_suplente VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS reportes (
                id SERIAL PRIMARY KEY,
                codigo_caso VARCHAR(50) UNIQUE,
                fecha VARCHAR(100),
                vecino VARCHAR(150),
                telefono VARCHAR(50),
                edificio VARCHAR(150),
                problema TEXT,
                urgencia VARCHAR(50),
                tecnico VARCHAR(150),
                acceso TEXT,
                estado VARCHAR(50),
                notas_ia TEXT,
                embedding vector(768),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS mensajes (
                id SERIAL PRIMARY KEY,
                evento_id VARCHAR(50),
                edificio VARCHAR(150),
                telefono VARCHAR(50),
                remitente VARCHAR(50),
                mensaje TEXT,
                tipo_canal VARCHAR(50) DEFAULT 'whatsapp',
                url_media TEXT,
                embedding vector(768),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS clientes (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(150),
                usuario VARCHAR(100) UNIQUE,
                contrasena TEXT,
                email VARCHAR(150),
                edificios TEXT,
                plan VARCHAR(50) DEFAULT 'Base',
                activo BOOLEAN DEFAULT TRUE,
                ultimo_acceso TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS proveedores (
                id SERIAL PRIMARY KEY,
                cliente VARCHAR(100),
                rubro VARCHAR(100),
                nombre VARCHAR(150),
                telefono VARCHAR(50),
                notas TEXT,
                estado VARCHAR(50) DEFAULT 'activo',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS proveedor_asignaciones (
                id SERIAL PRIMARY KEY,
                cliente VARCHAR(100),
                edificio VARCHAR(150),
                proveedor VARCHAR(150),
                rubro VARCHAR(100),
                telefono VARCHAR(50),
                prioridad VARCHAR(50),
                estado VARCHAR(50) DEFAULT 'activo',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS llamadas (
                id SERIAL PRIMARY KEY,
                fecha VARCHAR(100),
                duracion VARCHAR(50),
                telefono VARCHAR(50),
                vecino VARCHAR(150),
                edificio VARCHAR(150),
                resumen TEXT,
                transcripcion TEXT,
                urgencia VARCHAR(50),
                estado VARCHAR(50),
                mensaje_enviado TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS memoria (
                id SERIAL PRIMARY KEY,
                telefono VARCHAR(50) UNIQUE,
                nombre VARCHAR(150),
                fecha_ultimo_contacto TEXT,
                resumen_historial TEXT,
                notas_trato TEXT,
                embedding vector(768),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS facturas (
                id SERIAL PRIMARY KEY,
                fecha VARCHAR(100),
                proveedor VARCHAR(150),
                monto NUMERIC(12,2),
                concepto TEXT,
                edificio VARCHAR(150),
                url_archivo TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS expensas (
                id SERIAL PRIMARY KEY,
                fecha VARCHAR(100),
                edificio VARCHAR(150),
                periodo VARCHAR(100),
                formato VARCHAR(50),
                nombre VARCHAR(150),
                url TEXT,
                estado VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sugerencias (
                id SERIAL PRIMARY KEY,
                fecha VARCHAR(100),
                usuario VARCHAR(100),
                edificio VARCHAR(150),
                texto TEXT,
                estado VARCHAR(50) DEFAULT 'pendiente',
                respuesta TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS solicitudes (
                id SERIAL PRIMARY KEY,
                fecha VARCHAR(100),
                usuario VARCHAR(100),
                edificio VARCHAR(150),
                campo VARCHAR(100),
                valor_actual TEXT,
                valor_nuevo TEXT,
                estado VARCHAR(50) DEFAULT 'pendiente',
                motivo_rechazo TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Donde esta cada instalacion del edificio y quien tiene la llave. Se llena de dos
            -- lados: lo que carga el administrador, y lo que Marcos anota cuando alguien lo
            -- menciona hablando ("yo le abro, tengo llave de la sala de electricidad"). Por eso
            -- cada fila guarda de donde salio el dato.
            CREATE TABLE IF NOT EXISTS accesos (
                id SERIAL PRIMARY KEY,
                edificio VARCHAR(150),
                lugar VARCHAR(150),
                ubicacion TEXT,
                quien_abre VARCHAR(150),
                telefono VARCHAR(50),
                tipo_acceso VARCHAR(100),
                notas TEXT,
                origen VARCHAR(150),
                fecha VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- ── TABLAS QUE EXISTEN EN LA PLANILLA Y FALTABAN ACA ──────────────────
            -- Sin estas cuatro, migrar a PostgreSQL dejaba a Marcos sin datos que usa todos los
            -- dias: buscarTecnicoSuplente() lee "tecnicos" y buscarPersonalDeTurno() lee
            -- "personal". Las columnas son las cabeceras reales de la planilla.

            CREATE TABLE IF NOT EXISTS tecnicos (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(150),
                especialidad VARCHAR(100),
                telefono VARCHAR(50),
                edificios TEXT,
                acceso TEXT,
                prioridad_admin VARCHAR(50),
                puntaje_encuesta VARCHAR(50),
                activo VARCHAR(20),
                disponible_urgencia VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS personal (
                id SERIAL PRIMARY KEY,
                edificio VARCHAR(150),
                estado VARCHAR(50),
                horario_inicio VARCHAR(50),
                horario_fin VARCHAR(50),
                nombre VARCHAR(150),
                rol VARCHAR(100),
                telefono VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS consejo (
                id SERIAL PRIMARY KEY,
                cliente VARCHAR(100),
                edificio VARCHAR(150),
                nombre VARCHAR(150),
                cargo VARCHAR(100),
                unidad VARCHAR(50),
                telefono VARCHAR(50),
                email VARCHAR(150),
                notas TEXT,
                estado VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS suscripciones_planes (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100),
                estado VARCHAR(50),
                precio VARCHAR(50),
                moneda VARCHAR(20),
                edificios VARCHAR(50),
                mensajes VARCHAR(50),
                llamadas VARCHAR(50),
                servicios TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- ── COLUMNAS QUE LA PLANILLA TIENE Y EL ESQUEMA ORIGINAL PERDIA ────────
            -- La pestaña EVENTOS tiene 22 columnas y "reportes" solo cubria 11: migrar sin esto
            -- borraba en silencio la transcripcion, los chats por canal y -- lo mas grave --
            -- "tecnico_notificado", que es la marca que evita mandarle la plantilla al tecnico
            -- cuatro veces cuando PM2 reinicia.
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS depto VARCHAR(50);
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS unidad VARCHAR(50);
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS mensaje TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS tipo VARCHAR(50);
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS notas TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS feedback TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS hora_fin VARCHAR(100);
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS audio_url TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS transcripcion TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS historial_chat TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS audios_json TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS involucrados_json TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS chat_vecino_json TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS chat_proveedor_json TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS tecnico_notificado VARCHAR(100);
            -- Cuando hay que volver a controlar el caso. Vive en la fila y no en un setTimeout
            -- justamente para que un reinicio del proceso no lo borre.
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS proximo_seguimiento TEXT;
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS seguimiento_paso VARCHAR(10);
            ALTER TABLE reportes ADD COLUMN IF NOT EXISTS seguimiento_nota TEXT;

            -- La lista maestra de proveedores de la planilla tiene "edificio".
            ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS edificio VARCHAR(150);

            -- La pestaña "solicitudes" tenia la columna "estado" repetida, lo que impedia leerla
            -- entera. Al desduplicarla, la segunda paso a llamarse "estado_gestion".
            ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS estado_gestion VARCHAR(50);
            ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS motivo TEXT;

            -- La planilla guarda tambien el horario del suplente, y ademas el nombre corto del
            -- edificio aparte del nombre largo que se usa para buscarlo en el sistema.
            ALTER TABLE edificios ADD COLUMN IF NOT EXISTS suplente_horario TEXT;
            ALTER TABLE edificios ADD COLUMN IF NOT EXISTS nombre VARCHAR(150);

            -- Preferencias de notificacion del cliente (a que canal avisarle).
            ALTER TABLE clientes ADD COLUMN IF NOT EXISTS wsp VARCHAR(50);
            ALTER TABLE clientes ADD COLUMN IF NOT EXISTS notif_email VARCHAR(20);
            ALTER TABLE clientes ADD COLUMN IF NOT EXISTS notif_wsp VARCHAR(20);

            -- La planilla de facturas ya trae estado (Pagada/Pendiente) y numero.
            ALTER TABLE facturas ADD COLUMN IF NOT EXISTS estado VARCHAR(50);
            ALTER TABLE facturas ADD COLUMN IF NOT EXISTS numero_factura VARCHAR(100);
            -- "monto" estaba como NUMERIC, pero Marcos guarda literalmente "Según comprobante"
            -- cuando el proveedor manda una foto sin importe legible: con NUMERIC ese INSERT
            -- fallaba y la factura se perdia entera.
            ALTER TABLE facturas ALTER COLUMN monto TYPE TEXT;

            CREATE INDEX IF NOT EXISTS idx_pg_vecinos_tel ON vecinos(telefono);
            CREATE INDEX IF NOT EXISTS idx_pg_reportes_codigo ON reportes(codigo_caso);
            CREATE INDEX IF NOT EXISTS idx_pg_mensajes_evento ON mensajes(evento_id);
            -- El visor de chat busca por teléfono y hace backfill de los mensajes que todavía no
            -- tienen caso asignado: los dos caminos necesitan índice propio.
            CREATE INDEX IF NOT EXISTS idx_pg_mensajes_tel ON mensajes(telefono);
            CREATE INDEX IF NOT EXISTS idx_pg_mensajes_sin_caso ON mensajes(telefono) WHERE evento_id IS NULL;
        `);
        console.log('✅ Esquema PostgreSQL con pgvector inicializado exitosamente.');
    } catch (e) {
        console.error('⚠️ Info conector PostgreSQL:', e.message);
    } finally {
        if (client) client.release();
    }
}

// Inicializar en segundo plano si está disponible.
// Guardamos la promesa: las escrituras que lleguen en los primeros milisegundos de vida del
// proceso (un mensaje de WhatsApp entrando justo cuando PM2 reinició) tienen que esperar a que
// las tablas existan en vez de fallar contra un esquema a medio crear.
const esquemaListo = initPgSchema().catch(() => {});

// Si Postgres se cae, no queremos inundar los logs de PM2 con el mismo error por cada mensaje:
// avisamos una vez y volvemos a avisar recién cuando se recupera.
let pgDegradado = false;
function avisarFalloPg(operacion, err) {
    if (!pgDegradado) {
        pgDegradado = true;
        console.error(`⚠️ PostgreSQL no disponible (${operacion}): ${err.message}. Marcos sigue funcionando; se deja de registrar el chat hasta que vuelva.`);
    }
}
function avisarRecuperacionPg() {
    if (pgDegradado) {
        pgDegradado = false;
        console.log('✅ PostgreSQL respondió de nuevo: se retoma el registro del chat.');
    }
}

// ── MÉTODOS DE BÚSQUEDA VECTORIAL PARA MARCOS IA ────────────────────────────

async function buscarSimilitudVectorial(embeddingVector, limite = 5) {
    try {
        const query = `
            SELECT codigo_caso, edificio, problema, notas_ia, (embedding <=> $1) AS distancia
            FROM reportes
            WHERE embedding IS NOT NULL
            ORDER BY distancia ASC
            LIMIT $2;
        `;
        const res = await pool.query(query, [JSON.stringify(embeddingVector), limite]);
        return res.rows;
    } catch (err) {
        console.error('Error en búsqueda por vectores pgvector:', err.message);
        return [];
    }
}

// ── MENSAJES: VISOR DE CHAT EN VIVO ─────────────────────────────────────────
// La tabla `mensajes` guarda la conversación real mensaje por mensaje (lo que hasta ahora no se
// guardaba en ningún lado: la pestaña `reportes` solo tiene el resumen final que escribe la IA).
// Todas estas funciones son a prueba de fallos a propósito: si Postgres no responde, devuelven
// vacío o false, nunca lanzan. Registrar el chat es importante, pero jamás puede tumbar la
// atención de un vecino.

/**
 * Guarda un mensaje suelto de la conversación.
 * @param {string} [eventoId]  Código [CASO-XXXX]; puede venir vacío y asignarse después.
 * @param {string} remitente   'vecino' | 'marcos' | 'tecnico' | 'encargado' | 'admin'
 */
async function guardarMensaje({ eventoId, edificio, telefono, remitente, mensaje, tipoCanal, urlMedia }) {
    if (!mensaje && !urlMedia) return false;
    try {
        await esquemaListo;
        await pool.query(
            `INSERT INTO mensajes (evento_id, edificio, telefono, remitente, mensaje, tipo_canal, url_media)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                eventoId || null,
                edificio || '',
                String(telefono || '').replace(/\D/g, ''),
                remitente || 'vecino',
                mensaje || '',
                tipoCanal || 'whatsapp',
                urlMedia || ''
            ]
        );
        avisarRecuperacionPg();
        return true;
    } catch (err) {
        avisarFalloPg('guardarMensaje', err);
        return false;
    }
}

/**
 * Cuando Marcos-Admin recién crea el [CASO-XXXX], los mensajes que originaron ese caso ya están
 * guardados sin `evento_id` (el código todavía no existía cuando el vecino escribió). Esto los
 * engancha hacia atrás para que el visor muestre la conversación completa desde el primer
 * mensaje y no desde la mitad.
 */
async function asignarEventoAMensajes({ telefono, eventoId }) {
    if (!telefono || !eventoId) return 0;
    try {
        await esquemaListo;
        // Acotado a las últimas 12 horas: si un vecino dejó mensajes sueltos hace días que nunca
        // derivaron en un caso, no tienen que terminar colgados de un reclamo nuevo que no es el
        // suyo. Es el mismo criterio de "conversación activa" que usa la sesión en RAM.
        const res = await pool.query(
            `UPDATE mensajes SET evento_id = $1
             WHERE telefono = $2 AND evento_id IS NULL
               AND timestamp > NOW() - INTERVAL '12 hours'`,
            [eventoId, String(telefono).replace(/\D/g, '')]
        );
        avisarRecuperacionPg();
        return res.rowCount || 0;
    } catch (err) {
        avisarFalloPg('asignarEventoAMensajes', err);
        return 0;
    }
}

async function obtenerHistorialMensajes(eventoId) {
    if (!eventoId) return [];
    try {
        await esquemaListo;
        const res = await pool.query(
            `SELECT id, evento_id, edificio, telefono, remitente, mensaje, tipo_canal, url_media, timestamp
             FROM mensajes WHERE evento_id = $1 ORDER BY timestamp ASC, id ASC`,
            [eventoId]
        );
        avisarRecuperacionPg();
        return res.rows;
    } catch (err) {
        avisarFalloPg('obtenerHistorialMensajes', err);
        return [];
    }
}

async function obtenerHistorialChatTelefono(telefono) {
    if (!telefono) return [];
    try {
        await esquemaListo;
        const res = await pool.query(
            `SELECT id, evento_id, edificio, telefono, remitente, mensaje, tipo_canal, url_media, timestamp
             FROM mensajes WHERE telefono = $1 ORDER BY timestamp ASC, id ASC`,
            [String(telefono).replace(/\D/g, '')]
        );
        avisarRecuperacionPg();
        return res.rows;
    } catch (err) {
        avisarFalloPg('obtenerHistorialChatTelefono', err);
        return [];
    }
}

// ── BÚSQUEDA GLOBAL ─────────────────────────────────────────────────────────

async function busquedaGlobal(query) {
    const vacio = { reportes: [], vecinos: [], edificios: [], mensajes: [] };
    if (!query || !String(query).trim()) return vacio;
    try {
        await esquemaListo;
        const q = `%${String(query).toLowerCase().trim()}%`;
        const [reportes, vecinos, edificios, mensajes] = await Promise.all([
            pool.query(
                `SELECT * FROM reportes
                 WHERE LOWER(problema) LIKE $1 OR LOWER(vecino) LIKE $1 OR LOWER(edificio) LIKE $1 OR LOWER(codigo_caso) LIKE $1
                 ORDER BY id DESC LIMIT 20`, [q]),
            pool.query(
                `SELECT * FROM vecinos
                 WHERE LOWER(nombre) LIKE $1 OR LOWER(edificio) LIKE $1 OR telefono LIKE $1
                 LIMIT 20`, [q]),
            pool.query(
                `SELECT * FROM edificios
                 WHERE LOWER(edificio) LIKE $1 OR LOWER(direccion) LIKE $1 OR LOWER(aliases) LIKE $1
                 LIMIT 20`, [q]),
            pool.query(
                `SELECT id, evento_id, edificio, telefono, remitente, mensaje, timestamp FROM mensajes
                 WHERE LOWER(mensaje) LIKE $1
                 ORDER BY timestamp DESC LIMIT 20`, [q])
        ]);
        avisarRecuperacionPg();
        return {
            reportes:  reportes.rows,
            vecinos:   vecinos.rows,
            edificios: edificios.rows,
            mensajes:  mensajes.rows
        };
    } catch (err) {
        avisarFalloPg('busquedaGlobal', err);
        return vacio;
    }
}

module.exports = {
    pool,
    initPgSchema,
    buscarSimilitudVectorial,
    guardarMensaje,
    asignarEventoAMensajes,
    obtenerHistorialMensajes,
    obtenerHistorialChatTelefono,
    busquedaGlobal
};
