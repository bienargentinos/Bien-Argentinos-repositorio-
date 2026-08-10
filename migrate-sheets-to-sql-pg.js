require('dotenv').config();
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');
const { pool, initPgSchema } = require('./db-pg');

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

        const client = await pool.connect();

        // A. Migrar VECINOS
        try {
            const sheetVecinos = doc.sheetsByTitle['vecinos'] || doc.sheetsByIndex[0];
            if (sheetVecinos) {
                const rows = await sheetVecinos.getRows();
                console.log(`➡️ Migrando ${rows.length} vecinos a PostgreSQL...`);
                for (const r of rows) {
                    await client.query(`
                        INSERT INTO vecinos (telefono, nombre, edificio, departamento, encargado, tel_encargado, horario_encargado, tablero, llaves, seguridad, consejo, notas, autoriza_contacto, contacto_acceso)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    `, [
                        r.get('telefono') || '',
                        r.get('nombre') || '',
                        r.get('edificio') || '',
                        r.get('departamento') || '',
                        r.get('encargado') || '',
                        r.get('tel_encargado') || '',
                        r.get('horario_encargado') || '',
                        r.get('tablero') || '',
                        r.get('llaves') || '',
                        r.get('seguridad') || '',
                        r.get('consejo') || '',
                        r.get('notas') || '',
                        String(r.get('autoriza_contacto') || '').toLowerCase().startsWith('s'),
                        r.get('contacto_acceso') || ''
                    ]);
                }
                console.log('✅ Vecinos migrados.');
            }
        } catch (e) {
            console.error('Error migrando vecinos:', e.message);
        }

        // B. Migrar EDIFICIOS
        try {
            const sheetEdificios = doc.sheetsByTitle['edificios'];
            if (sheetEdificios) {
                const rows = await sheetEdificios.getRows();
                console.log(`➡️ Migrando ${rows.length} edificios a PostgreSQL...`);
                for (const r of rows) {
                    const edifNom = r.get('edificio') || r.get('nombre') || '';
                    if (!edifNom) continue;
                    await client.query(`
                        INSERT INTO edificios (edificio, tipo, direccion, zona, aliases, cuit, unidades, plan, horario_sum, cocheras, admin_nombre, admin_telefono, tel_seguridad, notas_especiales, encargado, telefono_encargado, encargado_estado, encargado_horario, encargado_suplente, tel_suplente)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                        ON CONFLICT (edificio) DO NOTHING
                    `, [
                        edifNom,
                        r.get('tipo') || '',
                        r.get('direccion') || '',
                        r.get('zona') || '',
                        r.get('aliases') || '',
                        r.get('cuit') || '',
                        parseInt(r.get('unidades') || '0', 10),
                        r.get('plan') || 'Base',
                        r.get('horario_sum') || '',
                        r.get('cocheras') || '',
                        r.get('admin_nombre') || r.get('administrador') || '',
                        r.get('admin_telefono') || r.get('telefonos') || '',
                        r.get('tel_seguridad') || '',
                        r.get('notas_especiales') || '',
                        r.get('encargado') || '',
                        r.get('telefono_encargado') || '',
                        r.get('encargado_estado') || 'activo',
                        r.get('encargado_horario') || '',
                        r.get('encargado_suplente') || '',
                        r.get('tel_suplente') || ''
                    ]);
                }
                console.log('✅ Edificios migrados.');
            }
        } catch (e) {
            console.error('Error migrando edificios:', e.message);
        }

        // C. Migrar REPORTES / EVENTOS
        try {
            const sheetReportes = doc.sheetsByTitle['reportes'] || doc.sheetsByTitle['eventos'];
            if (sheetReportes) {
                const rows = await sheetReportes.getRows();
                console.log(`➡️ Migrando ${rows.length} reportes a PostgreSQL...`);
                for (const r of rows) {
                    const codigo = r.get('codigo_caso') || r.get('caso') || `CASO-${Math.floor(1000 + Math.random() * 9000)}`;
                    await client.query(`
                        INSERT INTO reportes (codigo_caso, fecha, vecino, telefono, edificio, problema, urgencia, tecnico, acceso, estado, notas_ia)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (codigo_caso) DO NOTHING
                    `, [
                        codigo,
                        r.get('fecha') || '',
                        r.get('vecino') || '',
                        r.get('telefono') || '',
                        r.get('edificio') || '',
                        r.get('problema') || '',
                        r.get('urgencia') || '',
                        r.get('tecnico') || '',
                        r.get('acceso') || '',
                        r.get('estado') || '',
                        r.get('notas_ia') || ''
                    ]);
                }
                console.log('✅ Reportes migrados.');
            }
        } catch (e) {
            console.error('Error migrando reportes:', e.message);
        }

        // D. Migrar CLIENTES
        try {
            const sheetClientes = doc.sheetsByTitle['clientes'];
            if (sheetClientes) {
                const rows = await sheetClientes.getRows();
                console.log(`➡️ Migrando ${rows.length} clientes a PostgreSQL...`);
                for (const r of rows) {
                    const usr = r.get('usuario');
                    if (!usr) continue;
                    await client.query(`
                        INSERT INTO clientes (nombre, usuario, contrasena, email, edificios, plan, activo, ultimo_acceso)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (usuario) DO NOTHING
                    `, [
                        r.get('nombre') || '',
                        usr,
                        r.get('contrasena') || '',
                        r.get('email') || '',
                        r.get('edificios') || '',
                        r.get('plan') || 'Base',
                        String(r.get('activo') || 'true').toLowerCase() === 'true',
                        r.get('ultimo_acceso') || ''
                    ]);
                }
                console.log('✅ Clientes migrados.');
            }
        } catch (e) {
            console.error('Error migrando clientes:', e.message);
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
