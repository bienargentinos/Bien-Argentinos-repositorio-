// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta:
// `node /ruta/larga/script.js` desde otra carpeta no encontraba ninguna variable y el script
// reventaba con un error que no decía nada ('path must be a string, received undefined').
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');
const { pool, initPgSchema } = require('./db-pg');

function getSheetByNames(doc, names) {
    for (const name of names) {
        const found = doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === name.toLowerCase().trim());
        if (found) return found;
    }
    return null;
}

function val(r, ...keys) {
    try {
        const obj = r.toObject ? r.toObject() : r;
        for (const k of keys) {
            for (const prop of Object.keys(obj)) {
                if (prop.toLowerCase().trim() === k.toLowerCase().trim()) {
                    if (obj[prop] !== undefined && obj[prop] !== null) {
                        return String(obj[prop]).trim();
                    }
                }
            }
        }
    } catch (_) {}
    return '';
}

async function migrarDatosPostgres() {
    console.log('🚀 Inicializando esquema PostgreSQL e importando datos de Google Sheets...');

    // 1. Inicializar esquema de tablas en PostgreSQL
    await initPgSchema();

    try {
        const SHEET_ID = process.env.GOOGLE_SHEET_ID;
        const CREDENTIALS_FILE = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_FILE || 'gen-lang-client-0735429936-bba6999e5e60.json');

        if (!SHEET_ID) {
            console.error('❌ GOOGLE_SHEET_ID no configurado en .env');
            process.exit(1);
        }

        const creds = require(CREDENTIALS_FILE);
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(SHEET_ID, auth);
        await doc.loadInfo();
        console.log(`📊 Conectado a Sheets: "${doc.title}" (${doc.sheetCount} pestañas)`);
        console.log(`📋 Pestañas detectadas: ${doc.sheetsByIndex.map(s => s.title).join(', ')}`);

        const client = await pool.connect();

        // A. Migrar VECINOS
        try {
            const sheetVecinos = getSheetByNames(doc, ['vecinos', 'VECINOS']);
            if (sheetVecinos) {
                await sheetVecinos.loadHeaderRow();
                const rows = await sheetVecinos.getRows();
                console.log(`➡️ Pestaña "${sheetVecinos.title}": Cabeceras [${sheetVecinos.headerValues ? sheetVecinos.headerValues.join(', ') : 'sin cabecera'}] | ${rows.length} filas.`);
                for (const r of rows) {
                    await client.query(`
                        INSERT INTO vecinos (telefono, nombre, edificio, departamento, encargado, tel_encargado, horario_encargado, tablero, llaves, seguridad, consejo, notas, autoriza_contacto, contacto_acceso)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    `, [
                        val(r, 'telefono', 'tel', 'celular'),
                        val(r, 'nombre', 'vecino'),
                        val(r, 'edificio', 'consorcio'),
                        val(r, 'departamento', 'depto', 'piso'),
                        val(r, 'encargado', 'portero'),
                        val(r, 'tel_encargado', 'telencargado'),
                        val(r, 'horario_encargado', 'horarioencargado'),
                        val(r, 'tablero'),
                        val(r, 'llaves'),
                        val(r, 'seguridad'),
                        val(r, 'consejo'),
                        val(r, 'notas', 'observaciones'),
                        val(r, 'autoriza_contacto', 'autoriza').toLowerCase().startsWith('s'),
                        val(r, 'contacto_acceso')
                    ]);
                }
                console.log('✅ Vecinos migrados.');
            }
        } catch (e) {
            console.error('Error migrando vecinos:', e.message);
        }


        // B. Migrar EDIFICIOS
        try {
            const sheetEdificios = getSheetByNames(doc, ['edificios', 'EDIFICIOS']);
            if (sheetEdificios) {
                const rows = await sheetEdificios.getRows();
                console.log(`➡️ Migrando ${rows.length} edificios de la pestaña "${sheetEdificios.title}" a PostgreSQL...`);
                for (const r of rows) {
                    const edifNom = val(r, 'edificio', 'nombre', 'consorcio');
                    if (!edifNom) continue;
                    await client.query(`
                        INSERT INTO edificios (edificio, tipo, direccion, zona, aliases, cuit, unidades, plan, horario_sum, cocheras, admin_nombre, admin_telefono, tel_seguridad, notas_especiales, encargado, telefono_encargado, encargado_estado, encargado_horario, encargado_suplente, tel_suplente)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                        ON CONFLICT (edificio) DO NOTHING
                    `, [
                        edifNom,
                        val(r, 'tipo'),
                        val(r, 'direccion', 'domicilio'),
                        val(r, 'zona', 'barrio'),
                        val(r, 'aliases', 'alias'),
                        val(r, 'cuit'),
                        parseInt(val(r, 'unidades', 'deptos') || '0', 10),
                        val(r, 'plan') || 'Base',
                        val(r, 'horario_sum', 'sum'),
                        val(r, 'cocheras'),
                        val(r, 'admin_nombre', 'administrador'),
                        val(r, 'admin_telefono', 'telefonos'),
                        val(r, 'tel_seguridad', 'seguridad'),
                        val(r, 'notas_especiales', 'notas'),
                        val(r, 'encargado', 'portero'),
                        val(r, 'telefono_encargado', 'tel_encargado'),
                        val(r, 'encargado_estado') || 'activo',
                        val(r, 'encargado_horario', 'horario_encargado'),
                        val(r, 'encargado_suplente', 'suplente'),
                        val(r, 'tel_suplente', 'telefono_suplente')
                    ]);
                }
                console.log('✅ Edificios migrados.');
            }
        } catch (e) {
            console.error('Error migrando edificios:', e.message);
        }

        // C. Migrar REPORTES / EVENTOS
        try {
            const sheetReportes = getSheetByNames(doc, ['reportes', 'REPORTES', 'eventos', 'EVENTOS']);
            if (sheetReportes) {
                const rows = await sheetReportes.getRows();
                console.log(`➡️ Migrando ${rows.length} reportes/eventos de la pestaña "${sheetReportes.title}" a PostgreSQL...`);
                for (const r of rows) {
                    const codigo = val(r, 'codigo_caso', 'caso') || `CASO-${Math.floor(1000 + Math.random() * 9000)}`;
                    await client.query(`
                        INSERT INTO reportes (codigo_caso, fecha, vecino, telefono, edificio, problema, urgencia, tecnico, acceso, estado, notas_ia)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (codigo_caso) DO NOTHING
                    `, [
                        codigo,
                        val(r, 'fecha'),
                        val(r, 'vecino', 'nombre'),
                        val(r, 'telefono', 'tel'),
                        val(r, 'edificio', 'consorcio'),
                        val(r, 'problema', 'descripcion'),
                        val(r, 'urgencia', 'prioridad'),
                        val(r, 'tecnico', 'proveedor'),
                        val(r, 'acceso'),
                        val(r, 'estado', 'status'),
                        val(r, 'notas_ia', 'resumen')
                    ]);
                }
                console.log('✅ Reportes migrados.');
            }
        } catch (e) {
            console.error('Error migrando reportes:', e.message);
        }

        // D. Migrar CLIENTES
        try {
            const sheetClientes = getSheetByNames(doc, ['clientes', 'CLIENTES']);
            if (sheetClientes) {
                const rows = await sheetClientes.getRows();
                console.log(`➡️ Migrando ${rows.length} clientes de la pestaña "${sheetClientes.title}" a PostgreSQL...`);
                for (const r of rows) {
                    const usr = val(r, 'usuario', 'user');
                    if (!usr) continue;
                    await client.query(`
                        INSERT INTO clientes (nombre, usuario, contrasena, email, edificios, plan, activo, ultimo_acceso)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (usuario) DO NOTHING
                    `, [
                        val(r, 'nombre'),
                        usr,
                        val(r, 'contrasena', 'pass'),
                        val(r, 'email', 'mail'),
                        val(r, 'edificios'),
                        val(r, 'plan') || 'Base',
                        val(r, 'activo').toLowerCase() !== 'false',
                        val(r, 'ultimo_acceso')
                    ]);
                }
                console.log('✅ Clientes migrados.');
            }
        } catch (e) {
            console.error('Error migrando clientes:', e.message);
        }

        // E. Migrar PROVEEDORES
        try {
            const sheetProv = getSheetByNames(doc, ['proveedores', 'PROVEEDORES']);
            if (sheetProv) {
                const rows = await sheetProv.getRows();
                console.log(`➡️ Migrando ${rows.length} proveedores de la pestaña "${sheetProv.title}" a PostgreSQL...`);
                for (const r of rows) {
                    await client.query(`
                        INSERT INTO proveedores (cliente, rubro, nombre, telefono, notas, estado)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `, [
                        val(r, 'cliente', 'usuario'),
                        val(r, 'rubro', 'especialidad'),
                        val(r, 'nombre', 'proveedor'),
                        val(r, 'telefono', 'tel'),
                        val(r, 'notas', 'observaciones'),
                        val(r, 'estado') || 'activo'
                    ]);
                }
                console.log('✅ Proveedores migrados.');
            }
        } catch (e) {
            console.error('Error migrando proveedores:', e.message);
        }

        client.release();
        console.log('🎉 ¡Migración a PostgreSQL completada con éxito!');
        process.exit(0);

    } catch (err) {
        console.error('❌ Error general en migración PostgreSQL:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    migrarDatosPostgres();
}

module.exports = { migrarDatosPostgres };
