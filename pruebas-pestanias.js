// Verifica que ninguna función busque una pestaña con la caja equivocada.
//
//   node pruebas-pestanias.js
//
// POR QUÉ: `doc.sheetsByTitle['clientes']` distingue mayúsculas y en esta planilla los nombres
// están mezclados (CLIENTES, EDIFICIOS y EVENTOS en mayúscula; proveedores, facturas y memoria
// en minúscula). Pedirla con la caja equivocada NO da error: devuelve undefined y la función se
// va por el camino de "no hay datos", callada. Ya pasó: la cartera de un proveedor buscaba
// `clientes`, nunca encontraba la pestaña, y los edificios del administrador no se sumaban.

const fs = require('fs');
const path = require('path');

// Los nombres REALES, tal como los reporta el importador (`importar-sheets-a-pg.js`) al leer la
// planilla. Si algún día se renombra una pestaña, esta lista es lo que hay que actualizar.
const REALES = [
    'VECINOS', 'EDIFICIOS', 'EVENTOS', 'CLIENTES',
    'proveedores', 'proveedor_asignaciones', 'tecnicos', 'personal',
    'memoria', 'facturas', 'accesos', 'consejo', 'solicitudes',
    'suscripciones_planes', 'llamadas', 'sugerencias', 'expensas',
];

const porMinuscula = new Map(REALES.map(n => [n.toLowerCase(), n]));

let fallos = 0;
// Se revisan también los scripts sueltos: en un RESET, una pestaña que no se encuentra no da
// error -- simplemente no se borra, y el reset parece haber funcionado cuando quedó a medias.
const archivos = ['sheets.js', 'dashboard.js', 'revisar-cartera.js', 'reset-test.js',
    'importar-sheets-a-pg.js', 'limpiar-proveedores.js', 'diagnostico-sheets.js',
    'reset-conversacion.js', 'limpiar-multimedia.js']
    .filter(f => fs.existsSync(path.join(__dirname, f)));

for (const archivo of archivos) {
    const src = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
    const lineas = src.split('\n');

    lineas.forEach((linea, i) => {
        // Los comentarios no ejecutan nada: este mismo chequeo se explica citando el error que
        // busca, y sin esto se marcaría a sí mismo.
        const codigo = linea.replace(/\/\/.*$/, '').trim();
        if (!codigo || codigo.startsWith('*') || codigo.startsWith('/*')) return;

        // Solo el acceso directo por índice. `pestaña(doc, '...')` es tolerante a la caja a
        // propósito y no hace falta revisarlo.
        for (const m of codigo.matchAll(/sheetsByTitle\[\s*['"]([^'"]+)['"]\s*\]/g)) {
            const usado = m[1];
            const real = porMinuscula.get(usado.toLowerCase());
            if (!real) continue;               // pestaña que no está en la lista: no opinamos
            if (real === usado) continue;      // coincide exacto: bien
            fallos++;
            console.log(`  ❌ ${archivo}:${i + 1} busca "${usado}" pero la pestaña se llama "${real}"`);
            console.log(`     No va a dar error: va a devolver undefined y la función se va a ir en silencio.`);
            console.log(`     Usá pestaña(doc, '${real}') o corregí la caja.`);
        }
    });
}

// ── Y EN sheets.js, DIRECTAMENTE NO SE USA EL ACCESO POR ÍNDICE ─────────────────────────────
//
// La revisión de arriba compara contra la lista de nombres REALES, así que solo agarra el error
// cuando la lista está al día. Si alguien renombra una pestaña en la planilla y no toca la lista,
// vuelve a pasar exactamente lo mismo sin que nada avise.
//
// `pestaña(doc, '...')` encuentra la pestaña esté escrita como esté, así que en sheets.js no hay
// ningún motivo para usar el acceso por índice -- salvo adentro de la propia `pestaña()`.
//
// Esto no es teórico: `guardarFactura` buscaba `sheetsByTitle['facturas']` y, si la pestaña estaba
// escrita distinto, no la encontraba y CREABA UNA SEGUNDA. Las facturas se guardaban en la nueva y
// quien miraba la vieja las daba por perdidas.
{
    const src = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');
    const lineas = src.split('\n');
    const dentroDePestania = (i) => {
        // El cuerpo de `pestaña()`: desde su declaración hasta la primera línea que cierra.
        const decl = lineas.findIndex(l => l.startsWith('function pestaña('));
        if (decl === -1) return false;
        const cierre = lineas.findIndex((l, k) => k > decl && l === '}');
        return i > decl && i <= cierre;
    };

    lineas.forEach((linea, i) => {
        const codigo = linea.replace(/\/\/.*$/, '').trim();
        if (!codigo || codigo.startsWith('*') || codigo.startsWith('/*')) return;
        if (!/sheetsByTitle\s*\[/.test(codigo)) return;
        if (dentroDePestania(i)) return;

        fallos++;
        console.log(`  ❌ sheets.js:${i + 1} usa sheetsByTitle[...] en vez de pestaña(doc, '...')`);
        console.log(`     Distingue mayúsculas: si la pestaña está escrita distinto devuelve undefined en silencio.`);
    });
}

if (fallos === 0) {
    console.log(`\n✅ Los ${archivos.length} archivos revisados piden las pestañas con el nombre correcto.\n`);
} else {
    console.log(`\n❌ ${fallos} pestaña(s) pedidas mal.\n`);
}
process.exit(fallos === 0 ? 0 : 1);
