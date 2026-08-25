// El .env se busca al lado de este archivo y no en el directorio desde donde se ejecuta:
// `node /ruta/larga/script.js` desde otra carpeta no encontraba ninguna variable y el script
// reventaba con un error que no decía nada ('path must be a string, received undefined').
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getSheet } = require('./sheets');

/**
 * RESET DE CONVERSACIÓN — "que Marcos me conozca de cero"
 *
 * Borra el rastro de una persona (o de todas) en las DOS bases a la vez: Google Sheets y
 * PostgreSQL. Sirve para volver a probar el primer contacto desde cero: el saludo inicial, que
 * pregunte el edificio, que pida el departamento, etc.
 *
 * QUÉ BORRA (datos de conversación):
 *   VECINOS · memoria · EVENTOS/reportes · mensajes (el chat guardado)
 *
 * QUÉ NO TOCA NUNCA (configuración — sin esto Marcos no puede atender):
 *   EDIFICIOS · proveedores · proveedor_asignaciones · CLIENTES · tecnicos · personal ·
 *   consejo · suscripciones_planes · facturas · solicitudes
 *
 * USO
 *   node reset-conversacion.js 5491150542005              → muestra qué borraría (no borra)
 *   node reset-conversacion.js 5491150542005 --confirmar  → borra ese teléfono
 *   node reset-conversacion.js --todo                     → muestra qué borraría de todos
 *   node reset-conversacion.js --todo --confirmar         → borra la conversación de todos
 *
 * Sin --confirmar NO borra nada. Es a propósito: borrar es lo único que no tiene vuelta atrás.
 */

const args = process.argv.slice(2);
const CONFIRMAR = args.includes('--confirmar');
const TODO = args.includes('--todo');
const TELEFONO = args.find(a => !a.startsWith('--'));

const soloDigitos = t => String(t || '').replace(/\D/g, '');
const telObjetivo = soloDigitos(TELEFONO);

// El teléfono puede estar guardado con o sin el 9 de Argentina, con +54 o sin nada. Comparamos
// por los últimos 8 dígitos, que es lo único que no cambia entre formatos.
function coincide(valorCelda) {
    if (TODO) return true;
    const tel = soloDigitos(valorCelda);
    if (!tel || !telObjetivo) return false;
    return tel.endsWith(telObjetivo.slice(-8)) || telObjetivo.endsWith(tel.slice(-8));
}

async function limpiarSheets() {
    console.log('\n── Google Sheets ──');
    const doc = await getSheet();

    const objetivos = [
        { pestaña: 'VECINOS', columna: 'telefono' },
        { pestaña: 'memoria', columna: 'telefono' },
        { pestaña: 'EVENTOS', columna: 'telefono' },
    ];

    for (const { pestaña, columna } of objetivos) {
        const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === pestaña.toLowerCase().trim());
        if (!sheet) { console.log(`   ⏭️  "${pestaña}": no existe`); continue; }

        const rows = await sheet.getRows();
        const aBorrar = rows.filter(r => coincide(r.get(columna)));

        if (aBorrar.length === 0) { console.log(`   ✅ "${pestaña}": nada que borrar`); continue; }

        if (!CONFIRMAR) {
            console.log(`   🔍 "${pestaña}": se borrarían ${aBorrar.length} fila(s)`);
            aBorrar.slice(0, 5).forEach(r =>
                console.log(`        · ${r.get(columna) || '(sin tel)'} — ${r.get('nombre') || r.get('vecino') || ''} ${r.get('id_evento') || ''}`));
            continue;
        }

        // De atrás para adelante: borrar una fila corre todas las de abajo un lugar, y si vamos
        // de arriba hacia abajo terminamos borrando filas equivocadas.
        for (let i = aBorrar.length - 1; i >= 0; i--) {
            await aBorrar[i].delete();
        }
        console.log(`   🗑️  "${pestaña}": ${aBorrar.length} fila(s) borrada(s)`);
    }
}

async function limpiarPostgres() {
    console.log('\n── PostgreSQL ──');
    const { pool } = require('./db-pg');

    // regexp_replace deja solo los dígitos de la columna, para comparar sin importar el formato.
    const cond = TODO
        ? { sql: 'TRUE', params: [] }
        : {
            sql: `right(regexp_replace(coalesce(telefono, ''), '\\D', '', 'g'), 8) = right($1, 8)`,
            params: [telObjetivo],
        };

    const tablas = ['vecinos', 'memoria', 'reportes', 'mensajes'];

    for (const tabla of tablas) {
        try {
            if (!CONFIRMAR) {
                const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tabla} WHERE ${cond.sql}`, cond.params);
                console.log(`   🔍 ${tabla}: se borrarían ${r.rows[0].c} fila(s)`);
            } else {
                const r = await pool.query(`DELETE FROM ${tabla} WHERE ${cond.sql}`, cond.params);
                console.log(`   🗑️  ${tabla}: ${r.rowCount} fila(s) borrada(s)`);
            }
        } catch (err) {
            console.log(`   ❌ ${tabla}: ${err.message.split('\n')[0]}`);
        }
    }
}

async function main() {
    if (!TODO && !telObjetivo) {
        console.log('Falta indicar qué borrar.\n');
        console.log('  node reset-conversacion.js 5491150542005              → ver qué borraría');
        console.log('  node reset-conversacion.js 5491150542005 --confirmar  → borrar ese teléfono');
        console.log('  node reset-conversacion.js --todo --confirmar         → borrar la de todos');
        process.exit(1);
    }

    console.log(TODO
        ? '🧹 Reset de conversación de TODOS los contactos'
        : `🧹 Reset de conversación del teléfono ${telObjetivo}`);
    console.log(CONFIRMAR
        ? '⚠️  MODO REAL — se van a borrar los datos'
        : '🔍 MODO VISTA PREVIA — no se borra nada (agregá --confirmar para borrar)');
    console.log('\nNo se tocan: EDIFICIOS, proveedores, proveedor_asignaciones, CLIENTES, tecnicos,');
    console.log('personal, consejo, suscripciones_planes, facturas ni solicitudes.');

    await limpiarSheets();
    await limpiarPostgres();

    if (CONFIRMAR) {
        console.log('\n✅ Listo. Falta un paso más:');
        console.log('   pm2 restart marcos-ai --update-env');
        console.log('   La conversación en curso vive en memoria RAM y solo se borra reiniciando.');
    } else {
        console.log('\n🔍 Vista previa terminada. Volvé a correrlo con --confirmar para borrar de verdad.');
    }

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error en el reset:', err.message);
    process.exit(1);
});
