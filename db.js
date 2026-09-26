let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    console.log('ℹ️ better-sqlite3 no instalado, usando conector PostgreSQL / Sheets fallback');
}

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, 'marcos_database.sqlite');
let db;

if (Database) {
    try {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        console.log(`✅ Base de Datos SQLite conectada correctamente en: ${DB_PATH}`);
    } catch (err) {
        console.error('❌ Error conectando a SQLite:', err.message);
    }
}


// ── Inicialización de Esquema SQL ───────────────────────────────────────────
function initSchema() {
    if (!db) return;
    db.exec(`
        CREATE TABLE IF NOT EXISTS vecinos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telefono TEXT,
            nombre TEXT,
            edificio TEXT,
            departamento TEXT,
            encargado TEXT,
            tel_encargado TEXT,
            horario_encargado TEXT,
            tablero TEXT,
            llaves TEXT,
            seguridad TEXT,
            consejo TEXT,
            notas TEXT,
            autoriza_contacto INTEGER DEFAULT 0,
            contacto_acceso TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS edificios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            edificio TEXT UNIQUE,
            tipo TEXT,
            direccion TEXT,
            zona TEXT,
            aliases TEXT,
            cuit TEXT,
            unidades INTEGER,
            plan TEXT,
            horario_sum TEXT,
            cocheras TEXT,
            admin_nombre TEXT,
            admin_telefono TEXT,
            tel_seguridad TEXT,
            notas_especiales TEXT,
            encargado TEXT,
            telefono_encargado TEXT,
            encargado_estado TEXT,
            encargado_horario TEXT,
            encargado_suplente TEXT,
            tel_suplente TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reportes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo_caso TEXT UNIQUE,
            fecha TEXT,
            vecino TEXT,
            telefono TEXT,
            edificio TEXT,
            problema TEXT,
            urgencia TEXT,
            tecnico TEXT,
            acceso TEXT,
            estado TEXT,
            notas_ia TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS mensajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            evento_id TEXT,
            edificio TEXT,
            telefono TEXT,
            remitente TEXT, -- 'vecino' | 'marcos' | 'admin' | 'tecnico'
            mensaje TEXT,
            tipo_canal TEXT DEFAULT 'whatsapp', -- 'whatsapp' | 'llamada'
            url_media TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT,
            usuario TEXT UNIQUE,
            contrasena TEXT,
            email TEXT,
            edificios TEXT,
            plan TEXT,
            activo INTEGER DEFAULT 1,
            ultimo_acceso TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS proveedores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente TEXT,
            rubro TEXT,
            nombre TEXT,
            telefono TEXT,
            notas TEXT,
            estado TEXT DEFAULT 'activo',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS proveedor_asignaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente TEXT,
            edificio TEXT,
            proveedor TEXT,
            rubro TEXT,
            telefono TEXT,
            prioridad TEXT,
            estado TEXT DEFAULT 'activo',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS llamadas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT,
            duracion TEXT,
            telefono TEXT,
            vecino TEXT,
            edificio TEXT,
            resumen TEXT,
            transcripcion TEXT,
            urgencia TEXT,
            estado TEXT,
            mensaje_enviado TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS memoria (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telefono TEXT UNIQUE,
            nombre TEXT,
            fecha_ultimo_contacto TEXT,
            resumen_historial TEXT,
            notas_trato TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS facturas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT,
            proveedor TEXT,
            monto REAL,
            concepto TEXT,
            edificio TEXT,
            url_archivo TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS expensas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT,
            edificio TEXT,
            periodo TEXT,
            formato TEXT,
            nombre TEXT,
            url TEXT,
            estado TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sugerencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT,
            usuario TEXT,
            edificio TEXT,
            texto TEXT,
            estado TEXT DEFAULT 'pendiente',
            respuesta TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS solicitudes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT,
            usuario TEXT,
            edificio TEXT,
            campo TEXT,
            valor_actual TEXT,
            valor_nuevo TEXT,
            estado TEXT DEFAULT 'pendiente',
            motivo_rechazo TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Índices de alto rendimiento
        CREATE INDEX IF NOT EXISTS idx_vecinos_tel ON vecinos(telefono);
        CREATE INDEX IF NOT EXISTS idx_reportes_codigo ON reportes(codigo_caso);
        CREATE INDEX IF NOT EXISTS idx_reportes_edif ON reportes(edificio);
        CREATE INDEX IF NOT EXISTS idx_mensajes_evento ON mensajes(evento_id);
        CREATE INDEX IF NOT EXISTS idx_mensajes_tel ON mensajes(telefono);
        CREATE INDEX IF NOT EXISTS idx_edificios_edif ON edificios(edificio);
        CREATE INDEX IF NOT EXISTS idx_proveedores_asign ON proveedor_asignaciones(edificio, rubro);
    `);
}

initSchema();

// ── VECINOS ─────────────────────────────────────────────────────────────────

function buscarVecinosPorTelefono(telefono) {
    if (!db) return [];
    try {
        const telBuscado = String(telefono).replace(/\D/g, '');
        const rows = db.prepare(`SELECT * FROM vecinos WHERE REPLACE(telefono, '-', '') LIKE ? OR telefono LIKE ?`).all(`%${telBuscado}%`, `%${telBuscado}%`);
        return rows.map(r => ({
            nombre: r.nombre || '',
            edificio: r.edificio || '',
            departamento: r.departamento || '',
            encargado: r.encargado || '',
            telEncargado: r.tel_encargado || '',
            horarioEncargado: r.horario_encargado || '',
            tablero: r.tablero || '',
            llaves: r.llaves || '',
            seguridad: r.seguridad || '',
            consejo: r.consejo || '',
            notas: r.notas || '',
            autorizaContacto: Boolean(r.autoriza_contacto),
            contactoAcceso: r.contacto_acceso || ''
        }));
    } catch (err) {
        console.error('Error buscando vecino en SQL:', err.message);
        return [];
    }
}

function buscarVecinoPorTelefono(telefono) {
    const res = buscarVecinosPorTelefono(telefono);
    return res[0] || null;
}

function agregarVecinoNuevo({ telefono, nombre, edificio, departamento }) {
    if (!db) return false;
    try {
        const telClean = String(telefono || '').replace(/\D/g, '');
        const edifClean = String(edificio || '').trim();
        const stmt = db.prepare(`
            INSERT INTO vecinos (telefono, nombre, edificio, departamento)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(telClean, nombre || '', edifClean, departamento || '');
        return true;
    } catch (err) {
        console.error('Error agregando vecino en SQL:', err.message);
        return false;
    }
}

// ── EDIFICIOS ───────────────────────────────────────────────────────────────

function buscarPerfilEdificio(nombreBuscado) {
    if (!db) return null;
    try {
        const q = String(nombreBuscado || '').toLowerCase().trim();
        if (!q) return null;

        const edificios = db.prepare(`SELECT * FROM edificios`).all();
        for (const e of edificios) {
            const nom = String(e.edificio || '').toLowerCase().trim();
            const dir = String(e.direccion || '').toLowerCase().trim();
            const ali = String(e.aliases || '').toLowerCase().split(',').map(a => a.trim());

            if (nom === q || dir === q || ali.includes(q)) {
                return {
                    edificio: e.edificio,
                    tipo: e.tipo || '',
                    direccion: e.direccion || '',
                    zona: e.zona || '',
                    aliases: e.aliases || '',
                    cuit: e.cuit || '',
                    unidades: e.unidades || 0,
                    plan: e.plan || 'Base',
                    horario_sum: e.horario_sum || '',
                    cocheras: e.cocheras || '',
                    admin_nombre: e.admin_nombre || '',
                    admin_telefono: e.admin_telefono || '',
                    tel_seguridad: e.tel_seguridad || '',
                    notas_especiales: e.notas_especiales || '',
                    encargado: e.encargado || '',
                    telefono_encargado: e.telefono_encargado || '',
                    encargado_estado: e.encargado_estado || 'activo',
                    encargado_horario: e.encargado_horario || '',
                    encargado_suplente: e.encargado_suplente || '',
                    tel_suplente: e.tel_suplente || ''
                };
            }
        }
        return null;
    } catch (err) {
        console.error('Error buscando perfil edificio en SQL:', err.message);
        return null;
    }
}

function listarEdificiosConocidos() {
    if (!db) return [];
    try {
        return db.prepare(`SELECT * FROM edificios ORDER BY edificio ASC`).all();
    } catch (err) {
        console.error('Error listando edificios en SQL:', err.message);
        return [];
    }
}

// ── MENSAJES (NUEVO: Visor de Chat en Vivo) ───────────────────────────────────

function guardarMensaje({ eventoId, edificio, telefono, remitente, mensaje, tipoCanal, urlMedia }) {
    if (!db) return false;
    try {
        const stmt = db.prepare(`
            INSERT INTO mensajes (evento_id, edificio, telefono, remitente, mensaje, tipo_canal, url_media)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(eventoId || null, edificio || '', telefono || '', remitente || 'vecino', mensaje || '', tipoCanal || 'whatsapp', urlMedia || '');
        return true;
    } catch (err) {
        console.error('Error guardando mensaje en SQL:', err.message);
        return false;
    }
}

function obtenerHistorialMensajes(eventoId) {
    if (!db) return [];
    try {
        return db.prepare(`SELECT * FROM mensajes WHERE evento_id = ? ORDER BY timestamp ASC`).all(eventoId);
    } catch (err) {
        console.error('Error obteniendo mensajes de evento en SQL:', err.message);
        return [];
    }
}

function obtenerHistorialChatTelefono(telefono) {
    if (!db) return [];
    try {
        const telClean = String(telefono).replace(/\D/g, '');
        return db.prepare(`SELECT * FROM mensajes WHERE REPLACE(telefono, '-', '') LIKE ? ORDER BY timestamp ASC`).all(`%${telClean}%`);
    } catch (err) {
        console.error('Error obteniendo mensajes por telefono en SQL:', err.message);
        return [];
    }
}

// ── BÚSQUEDA GLOBAL ─────────────────────────────────────────────────────────

function busquedaGlobal(query) {
    if (!db || !query) return { reportes: [], vecinos: [], edificios: [] };
    try {
        const q = `%${String(query).toLowerCase().trim()}%`;
        const reportes = db.prepare(`SELECT * FROM reportes WHERE LOWER(problema) LIKE ? OR LOWER(vecino) LIKE ? OR LOWER(edificio) LIKE ? OR codigo_caso LIKE ? LIMIT 20`).all(q, q, q, q);
        const vecinos = db.prepare(`SELECT * FROM vecinos WHERE LOWER(nombre) LIKE ? OR LOWER(edificio) LIKE ? OR telefono LIKE ? LIMIT 20`).all(q, q, q);
        const edificios = db.prepare(`SELECT * FROM edificios WHERE LOWER(edificio) LIKE ? OR LOWER(direccion) LIKE ? OR LOWER(aliases) LIKE ? LIMIT 20`).all(q, q, q);

        return { reportes, vecinos, edificios };
    } catch (err) {
        console.error('Error en búsqueda global SQL:', err.message);
        return { reportes: [], vecinos: [], edificios: [] };
    }
}

// ── EXPORTACIÓN DE MÉTODOS ──────────────────────────────────────────────────

module.exports = {
    db,
    buscarVecinosPorTelefono,
    buscarVecinoPorTelefono,
    agregarVecinoNuevo,
    buscarPerfilEdificio,
    listarEdificiosConocidos,
    guardarMensaje,
    obtenerHistorialMensajes,
    obtenerHistorialChatTelefono,
    busquedaGlobal
};
