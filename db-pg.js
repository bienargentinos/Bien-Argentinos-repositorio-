const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/marcos_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
});

// Inicialización de Esquema PostgreSQL + pgvector
async function initPgSchema() {
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

            CREATE INDEX IF NOT EXISTS idx_pg_vecinos_tel ON vecinos(telefono);
            CREATE INDEX IF NOT EXISTS idx_pg_reportes_codigo ON reportes(codigo_caso);
            CREATE INDEX IF NOT EXISTS idx_pg_mensajes_evento ON mensajes(evento_id);
        `);
        console.log('✅ Esquema PostgreSQL con pgvector inicializado exitosamente.');
    } catch (e) {
        console.error('⚠️ Info conector PostgreSQL:', e.message);
    } finally {
        if (client) client.release();
    }
}

// Inicializar en segundo plano si está disponible
initPgSchema().catch(() => {});

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

module.exports = {
    pool,
    initPgSchema,
    buscarSimilitudVectorial
};
