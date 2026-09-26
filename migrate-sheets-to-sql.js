// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta:
// `node /ruta/larga/script.js` desde otra carpeta no encontraba ninguna variable y el script
// reventaba con un error que no decía nada ('path must be a string, received undefined').
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getSheet } = require('./sheets');
const { db } = require('./db');

async function migrarDatos() {
    console.log('🚀 Iniciando migración de Google Sheets a SQLite Local...');
    if (!db) {
        console.error('❌ Base de datos SQLite no disponible.');
        return;
    }

    try {
        // Obtenemos el objeto doc de google-spreadsheet
        const path = require('path');
        const { GoogleSpreadsheet } = require('google-spreadsheet');
        const { JWT } = require('google-auth-library');

        const SHEET_ID = process.env.GOOGLE_SHEET_ID;
        const CREDENTIALS_FILE = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_FILE || 'gen-lang-client-0735429936-bba6999e5e60.json');

        if (!SHEET_ID) {
            console.error('❌ GOOGLE_SHEET_ID no configurado en .env');
            return;
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

        // 1. Migrar VECINOS
        try {
            const sheetVecinos = doc.sheetsByTitle['vecinos'] || doc.sheetsByIndex[0];
            if (sheetVecinos) {
                const rows = await sheetVecinos.getRows();
                console.log(`➡️ Migrando ${rows.length} vecinos...`);
                const stmt = db.prepare(`
                    INSERT INTO vecinos (telefono, nombre, edificio, departamento, encargado, tel_encargado, horario_encargado, tablero, llaves, seguridad, consejo, notas, autoriza_contacto, contacto_acceso)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                db.transaction(() => {
                    for (const r of rows) {
                        stmt.run(
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
                            String(r.get('autoriza_contacto') || '').toLowerCase().startsWith('s') ? 1 : 0,
                            r.get('contacto_acceso') || ''
                        );
                    }
                })();
                console.log('✅ Vecinos migrados.');
            }
        } catch (e) {
            console.error('Error migrando vecinos:', e.message);
        }

        // 2. Migrar EDIFICIOS
        try {
            const sheetEdificios = doc.sheetsByTitle['edificios'];
            if (sheetEdificios) {
                const rows = await sheetEdificios.getRows();
                console.log(`➡️ Migrando ${rows.length} edificios...`);
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO edificios (edificio, tipo, direccion, zona, aliases, cuit, unidades, plan, horario_sum, cocheras, admin_nombre, admin_telefono, tel_seguridad, notas_especiales, encargado, telefono_encargado, encargado_estado, encargado_horario, encargado_suplente, tel_suplente)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                db.transaction(() => {
                    for (const r of rows) {
                        const edifNom = r.get('edificio') || r.get('nombre') || '';
                        if (!edifNom) continue;
                        stmt.run(
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
                        );
                    }
                })();
                console.log('✅ Edificios migrados.');
            }
        } catch (e) {
            console.error('Error migrando edificios:', e.message);
        }

        // 3. Migrar REPORTES / EVENTOS
        try {
            const sheetReportes = doc.sheetsByTitle['reportes'] || doc.sheetsByTitle['eventos'];
            if (sheetReportes) {
                const rows = await sheetReportes.getRows();
                console.log(`➡️ Migrando ${rows.length} reportes/eventos...`);
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO reportes (codigo_caso, fecha, vecino, telefono, edificio, problema, urgencia, tecnico, acceso, estado, notas_ia)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                db.transaction(() => {
                    for (const r of rows) {
                        const codigo = r.get('codigo_caso') || r.get('caso') || `CASO-${Math.floor(1000 + Math.random() * 9000)}`;
                        stmt.run(
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
                        );
                    }
                })();
                console.log('✅ Reportes migrados.');
            }
        } catch (e) {
            console.error('Error migrando reportes:', e.message);
        }

        // 4. Migrar CLIENTES
        try {
            const sheetClientes = doc.sheetsByTitle['clientes'];
            if (sheetClientes) {
                const rows = await sheetClientes.getRows();
                console.log(`➡️ Migrando ${rows.length} clientes...`);
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO clientes (nombre, usuario, contrasena, email, edificios, plan, activo, ultimo_acceso)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);
                db.transaction(() => {
                    for (const r of rows) {
                        const usr = r.get('usuario');
                        if (!usr) continue;
                        stmt.run(
                            r.get('nombre') || '',
                            usr,
                            r.get('contrasena') || '',
                            r.get('email') || '',
                            r.get('edificios') || '',
                            r.get('plan') || 'Base',
                            String(r.get('activo') || 'true').toLowerCase() === 'true' ? 1 : 0,
                            r.get('ultimo_acceso') || ''
                        );
                    }
                })();
                console.log('✅ Clientes migrados.');
            }
        } catch (e) {
            console.error('Error migrando clientes:', e.message);
        }

        console.log('🎉 Migración completada con éxito!');

    } catch (err) {
        console.error('❌ Error general en migración:', err.message);
    }
}

if (require.main === module) {
    migrarDatos();
}

module.exports = { migrarDatos };
