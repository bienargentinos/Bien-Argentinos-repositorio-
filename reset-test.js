require('dotenv').config();
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_FILE = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_FILE);

async function main() {
    const creds = require(CREDENTIALS_FILE);
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();
    console.log(`Conectado a: "${doc.title}"`);

    // Solo el rastro que deja una conversación de prueba: quién habló, qué pasó y qué recordó
    // Marcos. Nada más entra acá.
    //
    // NUNCA agregar CLIENTES, EDIFICIOS, proveedores ni proveedor_asignaciones: eso es
    // configuración, no dato de prueba. `clientes` guarda usuario/contraseña/email de cada
    // administrador y es de donde sale el mail al que Marcos avisa una urgencia; vaciarla rompe
    // el login del dashboard y deja la notificación sin destinatario.
    //
    // Las pestañas van por nombre y no por posición: con `sheetsByIndex[0]` alcanzaba con que
    // alguien reordenara la planilla para vaciar la hoja equivocada.
    const tabs = [
        doc.sheetsByTitle['VECINOS'],
        doc.sheetsByTitle['EVENTOS'],
        doc.sheetsByTitle['memoria'],
    ];

    for (const sheet of tabs) {
        if (!sheet) { console.log('⚠️ Pestaña no encontrada, se salta.'); continue; }
        const rows = await sheet.getRows();
        console.log(`"${sheet.title}": ${rows.length} filas encontradas. Vaciando...`);
        await sheet.clearRows();
        console.log(`✅ "${sheet.title}" vaciada (headers intactos).`);
    }

    await limpiarPostgres();
    console.log('🎉 Listo.');
}

/**
 * El otro lado del reset.
 *
 * Vaciar solo Sheets deja el test sucio de una forma difícil de ver: el caso desaparece de la
 * planilla pero las burbujas siguen en `mensajes` y el panel las muestra mezcladas con la prueba
 * nueva. Peor todavía, si la fila del evento sobrevive con sus marcas puestas
 * (`tecnico_notificado`, `contacto_acceso_avisado`), Marcos arranca creyendo que ya le avisó al
 * técnico y no manda ni la plantilla ni el contacto -- y parece que se rompió algo cuando en
 * realidad está haciendo lo correcto sobre datos viejos.
 *
 * Va acá adentro y no como comandos sueltos justamente para que no pueda quedar a medias.
 */
async function limpiarPostgres() {
    // Solo rastro de conversación. NUNCA clientes, edificios, proveedores ni asignaciones: eso es
    // configuración, y borrarla rompe el login del dashboard y deja los casos sin técnico.
    const TABLAS = ['mensajes', 'mensajes_wa', 'reportes', 'vecinos', 'memoria', 'accesos', 'audios_tts'];

    let pool;
    try {
        ({ pool } = require('./db-pg'));
    } catch (e) {
        console.log(`⚠️ No se pudo abrir PostgreSQL (${e.message}). Se limpió solo Sheets.`);
        return;
    }

    for (const tabla of TABLAS) {
        try {
            const res = await pool.query(`DELETE FROM ${tabla}`);
            console.log(`✅ PostgreSQL "${tabla}": ${res.rowCount} fila(s) borradas.`);
        } catch (e) {
            // Una tabla que todavía no existe no es un error: el esquema se crea al arrancar.
            const noExiste = /does not exist/i.test(e.message);
            console.log(`${noExiste ? 'ℹ️' : '⚠️'} PostgreSQL "${tabla}": ${noExiste ? 'no existe todavía, se salta.' : e.message}`);
        }
    }
    await pool.end().catch(() => {});
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
