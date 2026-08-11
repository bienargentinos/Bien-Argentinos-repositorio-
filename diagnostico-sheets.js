require('dotenv').config();
const { getSheet } = require('./sheets');

/**
 * DIAGNÓSTICO DE LA PLANILLA vs POSTGRES
 *
 * No migra nada ni toca un solo dato: solo mira. Imprime, para cada pestaña real de Google
 * Sheets, su nombre exacto, sus cabeceras exactas y cuántas filas con contenido tiene, y al lado
 * cuántas filas hay hoy en la tabla equivalente de PostgreSQL.
 *
 * Existe porque los intentos de migración anteriores adivinaban nombres de pestañas y de columnas
 * ("reportes" vs "EVENTOS", "telefono" vs "tel" vs "celular") y por eso importaron 3 tablas de 9
 * sin que nadie se enterara de cuáles habían quedado vacías. Antes de volver a escribir un import
 * hay que ver la planilla tal como es.
 */

// Qué tabla de PostgreSQL le corresponde a cada pestaña, para poder compararlas de a pares.
const EQUIVALENCIAS = {
    vecinos: 'vecinos',
    edificios: 'edificios',
    eventos: 'reportes',
    reportes: 'reportes',
    clientes: 'clientes',
    proveedores: 'proveedores',
    proveedor_asignaciones: 'proveedor_asignaciones',
    memoria: 'memoria',
    facturas: 'facturas',
    llamadas: 'llamadas',
    expensas: 'expensas',
    sugerencias: 'sugerencias',
    solicitudes: 'solicitudes',
};

async function contarEnPostgres(tabla) {
    try {
        const { pool } = require('./db-pg');
        const res = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tabla}`);
        return res.rows[0].c;
    } catch (err) {
        return `— (${err.message.split('\n')[0].slice(0, 40)})`;
    }
}

async function diagnosticar() {
    console.log('🔎 Leyendo la planilla real (no se modifica nada)...\n');

    const doc = await getSheet();
    console.log(`📊 Planilla: "${doc.title}" — ${doc.sheetCount} pestañas\n`);

    const resumen = [];

    for (const sheet of doc.sheetsByIndex) {
        const titulo = sheet.title;
        let cabeceras = [];
        let filasConDatos = 0;

        try {
            await sheet.loadHeaderRow();
            cabeceras = sheet.headerValues || [];
            const rows = await sheet.getRows();
            // Una fila "con datos" es la que tiene al menos una celda no vacía: las planillas
            // arrastran cientos de filas en blanco al final que inflan el conteo.
            filasConDatos = rows.filter(r => {
                const o = r.toObject ? r.toObject() : {};
                return Object.values(o).some(v => String(v ?? '').trim() !== '');
            }).length;
        } catch (err) {
            console.log(`⚠️  Pestaña "${titulo}": no se pudo leer (${err.message})`);
            continue;
        }

        const tablaPg = EQUIVALENCIAS[titulo.toLowerCase().trim()];
        const enPg = tablaPg ? await contarEnPostgres(tablaPg) : 'sin equivalente';

        resumen.push({
            pestaña: titulo,
            filas_sheets: filasConDatos,
            tabla_postgres: tablaPg || '—',
            filas_postgres: enPg
        });

        console.log(`── "${titulo}" ─────────────────────────────`);
        console.log(`   filas con datos : ${filasConDatos}`);
        console.log(`   cabeceras       : ${cabeceras.length ? cabeceras.join(' | ') : '(sin cabecera)'}`);
        console.log('');
    }

    console.log('\n📋 RESUMEN — Sheets vs PostgreSQL\n');
    console.table(resumen);

    const faltantes = resumen.filter(r =>
        typeof r.filas_postgres === 'number' && r.filas_sheets > 0 && r.filas_postgres === 0
    );
    if (faltantes.length) {
        console.log('\n⚠️  Pestañas con datos en Sheets que están VACÍAS en PostgreSQL:');
        faltantes.forEach(f => console.log(`   - ${f.pestaña} (${f.filas_sheets} filas sin migrar)`));
    }

    const sospechosas = resumen.filter(r =>
        typeof r.filas_postgres === 'number' && r.filas_postgres > r.filas_sheets && r.filas_sheets > 0
    );
    if (sospechosas.length) {
        console.log('\n⚠️  Tablas con MÁS filas en PostgreSQL que en Sheets (posibles duplicados por correr el import dos veces):');
        sospechosas.forEach(f => console.log(`   - ${f.tabla_postgres}: ${f.filas_postgres} en PG vs ${f.filas_sheets} en Sheets`));
    }

    process.exit(0);
}

diagnosticar().catch(err => {
    console.error('❌ Error en el diagnóstico:', err.message);
    process.exit(1);
});
