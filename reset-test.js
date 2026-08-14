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
    console.log('🎉 Listo.');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
