// Un vecino solo ve SUS comprobantes de pago.
//
//   node pruebas-comprobantes-vecino.js
//
// POR QUÉ EXISTE. La consulta que arma la sección Expensas del portal filtraba **solo por
// edificio**, y la variable se llama `misComprobantes`. O sea que cualquier vecino de San Patricio
// 159 veía los últimos diez pagos del edificio entero: el nombre de quien pagó, el monto, el
// departamento —que va escrito adentro de las notas— y el **enlace al comprobante bancario**.
//
// No es un dato feo en una pantalla: es la transferencia de una persona, con su nombre y su
// departamento, descargable por sus vecinos. Y no daba ningún error — se veía como una lista que
// funcionaba bien.
//
// Acá no se prueba contra PostgreSQL (el CI corre sin base): se lee el SQL escrito en el archivo y
// se exige que tenga el filtro. Un candado que mira la consulta real, no una copia.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}
const afirmar = (titulo, cond) => verificar(titulo, !!cond, true);

// La consulta que arma la lista del vecino.
function consultaDeComprobantes() {
    const ini = SRC.indexOf("const qFac = `");
    if (ini === -1) return null;
    const desde = SRC.indexOf('`', ini) + 1;
    return SRC.slice(desde, SRC.indexOf('`', desde));
}

console.log('\n── LA CONSULTA FILTRA POR UNIDAD, NO SOLO POR EDIFICIO ──');
{
    const q = consultaDeComprobantes();
    afirmar('se encontró la consulta', q !== null);
    if (q) {
        const plano = q.replace(/\s+/g, ' ').toLowerCase();
        afirmar('filtra por edificio', plano.includes('lower(edificio) = lower($1)'));
        afirmar('Y TAMBIÉN por departamento', /lower\(trim\(departamento\)\)\s*=\s*lower\(trim\(\$2\)\)/.test(plano));
        // Sin esto, las filas viejas --que no tienen departamento-- se le mostrarían a cualquiera.
        afirmar('descarta las filas sin departamento', plano.includes('departamento is not null'));
    }
}

console.log('\n── Y EL COMPROBANTE SE GUARDA CON SU UNIDAD ──');
{
    // Filtrar no sirve de nada si al guardar no se anota de quién es: la columna quedaría siempre
    // vacía y el vecino no vería ni los suyos.
    const ini = SRC.indexOf('INSERT INTO facturas');
    afirmar('existe el INSERT del comprobante', ini !== -1);
    const bloque = SRC.slice(ini, ini + 900);
    afirmar('guarda el departamento', /INSERT INTO facturas \([^)]*departamento/.test(bloque));
    afirmar('y el usuario', /INSERT INTO facturas \([^)]*usuario_id/.test(bloque));
    afirmar('le pasa v.departamento', bloque.includes('v.departamento || null'));
    afirmar('le pasa v.usuario_id', bloque.includes('v.usuario_id || null'));
}

console.log('\n── LAS COLUMNAS EXISTEN EN EL ESQUEMA ──');
{
    // Una columna que el código escribe y la base no tiene hace fallar el INSERT ENTERO, así que
    // el comprobante no se guardaría en ningún lado. Ya pasó con `reportes.foto_url`.
    const DB = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');
    afirmar('facturas.departamento se crea', /ALTER TABLE facturas ADD COLUMN IF NOT EXISTS departamento/.test(DB));
    afirmar('facturas.usuario_id se crea', /ALTER TABLE facturas ADD COLUMN IF NOT EXISTS usuario_id/.test(DB));
}

console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
