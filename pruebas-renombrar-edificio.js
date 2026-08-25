// Verifica que renombrar un edificio lo renombre en TODAS las pestañas donde figura.
//
//   node pruebas-renombrar-edificio.js
//
// POR QUÉ. El nombre del consorcio no vive solo en `EDIFICIOS`: está copiado como texto en cada
// vecino, cada evento, cada factura, cada asignación de proveedor y en la lista de edificios del
// cliente. Ese texto es la única forma que tiene el sistema de relacionar las filas -- no hay un id.
//
// Cambiarlo en `EDIFICIOS` y en ningún otro lado parte el edificio en dos: las filas viejas siguen
// diciendo "san patricio 27'0 casa" y el panel las muestra tal cual. Así fue como el apóstrofe
// "volvió solo" después de haberse corregido: nunca se había ido.
//
// La lógica se carga del propio dashboard.js para que la prueba valide el código real.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');

const ini = SRC.indexOf('let filasRenombradas = 0;');
if (ini === -1) throw new Error('No encontré el bloque de renombrado en dashboard.js.');
const fin = SRC.indexOf('// Si no se escribió nada, la solicitud NO se marca como aplicada.', ini);
if (fin === -1) throw new Error('No encontré el final del bloque de renombrado en dashboard.js.');
const cuerpo = SRC.slice(ini, fin);

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// Las mismas funciones que usa dashboard.js, copiadas acá para poder inyectarlas.
function columnLetter(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
}
function normEdificio(txt) {
    return String(txt || '')
        .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
        .toLowerCase().trim();
}
function normalizeEdificio(t) { return normEdificio(t).replace(/\s+/g, ' '); }
function compararEdificios(a, b) {
    const na = normalizeEdificio(a), nb = normalizeEdificio(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
    return false;
}

/**
 * Monta una planilla falsa y corre el bloque de renombrado contra ella. Devuelve la planilla
 * después del cambio, más la lista de escrituras.
 */
async function renombrar({ planilla, campo, valor_nuevo, targetEdificios, pg }) {
    const escrituras = [];
    const sqlEjecutado = [];

    // PostgreSQL de mentira. `pg` es {tabla: {columna: [valores]}}; los UPDATE se aplican encima
    // para poder mirar cómo quedó.
    const base = pg || {};
    const queryPg = async (sql, params) => {
        sqlEjecutado.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });

        if (/information_schema/.test(sql)) {
            const rows = [];
            for (const tabla of Object.keys(base)) {
                for (const col of Object.keys(base[tabla])) {
                    if (['edificio', 'consorcio', 'edificios'].includes(col) || (tabla === 'edificios' && col === 'nombre')) {
                        rows.push({ table_name: tabla, column_name: col });
                    }
                }
            }
            return { rows };
        }

        const sel = sql.match(/SELECT DISTINCT "(\w+)" AS v FROM "(\w+)"/);
        if (sel) {
            const [, col, tabla] = sel;
            const vals = Array.from(new Set((base[tabla]?.[col] || []).filter(Boolean)));
            return { rows: vals.map(v => ({ v })) };
        }

        const upd = sql.match(/UPDATE "(\w+)" SET "(\w+)" = \$2 WHERE/);
        if (upd) {
            const [, tabla, col] = upd;
            const [buscado, destino] = params;
            const exacto = /lower\(btrim/.test(sql);
            const lista = base[tabla]?.[col] || [];
            let rowCount = 0;
            for (let i = 0; i < lista.length; i++) {
                const coincide = exacto
                    ? String(lista[i] || '').trim().toLowerCase() === String(buscado || '').trim().toLowerCase()
                    : lista[i] === buscado;
                if (coincide) { lista[i] = destino; rowCount++; }
            }
            return { rowCount };
        }

        throw new Error(`consulta no prevista en la prueba: ${sql}`);
    };

    const readTab = async (tab) => {
        const t = planilla[tab];
        if (!t) throw new Error(`no existe la pestaña ${tab}`);
        const headers = t.headers;
        const rows = t.filas.map((f, i) => {
            const o = { _row: i + 2 };
            headers.forEach((h, k) => { o[h] = f[k] ?? ''; });
            return o;
        });
        return { headers, rows };
    };

    const writeCell = async (tab, letra, fila, valor) => {
        escrituras.push({ tab, letra, fila, valor });
        const t = planilla[tab];
        let n = 0;
        for (const ch of letra) n = n * 26 + (ch.charCodeAt(0) - 64);
        t.filas[fila - 2][n - 1] = valor;
    };

    const fn = new Function(
        'campo', 'valor_nuevo', 'targetEdificios', 'row',
        'readTab', 'writeCell', 'columnLetter', 'normEdificio', 'compararEdificios', 'queryPg',
        'TAB_EVENTOS', 'TAB_ARCHIVOS', 'TAB_SUGERENCIAS', 'TAB_SOLICITUDES', 'TAB_EXPENSAS',
        'TAB_ASIGNACIONES', 'TAB_CLIENTES', 'console',
        `return (async () => { ${cuerpo} return filasRenombradas; })();`
    );

    const filasRenombradas = await fn(
        campo, valor_nuevo, targetEdificios, 7,
        readTab, writeCell, columnLetter, normEdificio, compararEdificios, queryPg,
        'EVENTOS', 'facturas', 'sugerencias', 'solicitudes', 'expensas',
        'proveedor_asignaciones', 'CLIENTES',
        { log() {}, warn() {}, error() {} }
    );

    return { filasRenombradas, escrituras, planilla, sqlEjecutado, pg: base };
}

function planillaDePrueba() {
    return {
        EVENTOS:                 { headers: ['fecha', 'vecino', 'edificio'], filas: [['1/8', 'Daniel', "san patricio 27'0 casa"], ['2/8', 'Ana', 'san patricio 159']] },
        facturas:                { headers: ['fecha', 'edificio', 'monto'],  filas: [['1/8', "san patricio 27'0 casa", '5000']] },
        sugerencias:             { headers: ['fecha', 'edificio'],           filas: [] },
        solicitudes:             { headers: ['fecha', 'edificio'],           filas: [['1/8', "san patricio 27'0 casa"]] },
        expensas:                { headers: ['fecha', 'edificio'],           filas: [] },
        proveedor_asignaciones:  { headers: ['cliente', 'edificio'],         filas: [['amato', "san patricio 27'0 casa"]] },
        vecinos:                 { headers: ['telefono', 'nombre', 'edificio'], filas: [['549115', 'Daniel', "san patricio 27'0 casa"]] },
        CLIENTES:                { headers: ['nombre', 'usuario', 'edificios'], filas: [['Amato', 'amato', "san patricio 159, san patricio 27'0 casa, otro"]] },
    };
}

(async () => {

console.log('\n── EL NOMBRE SE CORRIGE EN TODAS LAS PESTAÑAS ──');
{
    const planilla = planillaDePrueba();
    const { filasRenombradas } = await renombrar({
        planilla, campo: 'nombre',
        valor_nuevo: 'san patricio 270 casa',
        targetEdificios: ["san patricio 27'0 casa"],
    });

    verificar('el evento del vecino', planilla.EVENTOS.filas[0][2], 'san patricio 270 casa');
    verificar('la factura', planilla.facturas.filas[0][1], 'san patricio 270 casa');
    verificar('la solicitud', planilla.solicitudes.filas[0][1], 'san patricio 270 casa');
    verificar('la asignación del proveedor', planilla.proveedor_asignaciones.filas[0][1], 'san patricio 270 casa');
    verificar('la ficha del vecino', planilla.vecinos.filas[0][2], 'san patricio 270 casa');
    verificar('se contaron las 5 referencias + la del cliente', filasRenombradas, 6);
}

console.log('\n── LA LISTA DEL CLIENTE CONSERVA LOS OTROS EDIFICIOS ──');
{
    const planilla = planillaDePrueba();
    await renombrar({
        planilla, campo: 'nombre',
        valor_nuevo: 'san patricio 270 casa',
        targetEdificios: ["san patricio 27'0 casa"],
    });
    // Es una sola celda con comas: reemplazar la celda entera borraría los otros edificios del
    // administrador, que es una forma silenciosa de sacarle clientes de encima.
    verificar('cambia solo el ítem que corresponde',
        planilla.CLIENTES.filas[0][2], 'san patricio 159, san patricio 270 casa, otro');
}

console.log('\n── NO SE LLEVA POR DELANTE A OTRO EDIFICIO ──');
{
    // `compararEdificios` acepta coincidencias parciales a propósito (para reconocer al vecino que
    // escribe "san patricio"), pero para RENOMBRAR eso sería un desastre: el 159 y el 270 son dos
    // consorcios distintos. Acá la comparación tiene que ser exacta.
    const planilla = planillaDePrueba();
    await renombrar({
        planilla, campo: 'nombre',
        valor_nuevo: 'san patricio 270 casa',
        targetEdificios: ["san patricio 27'0 casa"],
    });
    verificar('el 159 queda como estaba', planilla.EVENTOS.filas[1][2], 'san patricio 159');
}

console.log('\n── OTROS CAMPOS NO DISPARAN EL RENOMBRADO ──');
{
    const planilla = planillaDePrueba();
    const { filasRenombradas, escrituras } = await renombrar({
        planilla, campo: 'direccion',
        valor_nuevo: 'San Patricio 270',
        targetEdificios: ["san patricio 27'0 casa"],
    });
    verificar('no se toca ninguna otra pestaña', escrituras, []);
    verificar('no se cuenta nada', filasRenombradas, 0);
    verificar('el evento sigue igual', planilla.EVENTOS.filas[0][2], "san patricio 27'0 casa");
}

console.log('\n── RENOMBRAR AL MISMO NOMBRE NO HACE NADA ──');
{
    const planilla = planillaDePrueba();
    const { escrituras } = await renombrar({
        planilla, campo: 'nombre',
        valor_nuevo: "san patricio 27'0 casa",
        targetEdificios: ["san patricio 27'0 casa"],
    });
    verificar('no escribe una sola celda', escrituras, []);
}

console.log('\n── TAMBIÉN SE RENOMBRA EN POSTGRESQL ──');
{
    // Son dos bases: el panel lee Sheets, pero Marcos y los permisos del cliente leen PostgreSQL.
    // Renombrar solo en Sheets deja a Marcos llamando al edificio por el nombre viejo, y al
    // cliente con el permiso apuntando a un edificio que ya no se llama así.
    const pg = {
        edificios: { edificio: ["san patricio 27'0 casa"], nombre: ["san patricio 27'0 casa"] },
        reportes:  { edificio: ["San Patricio 27'0 Casa", 'san patricio 159'] },
        vecinos:   { edificio: ["san patricio 27'0 casa"] },
        clientes:  { edificios: ["san patricio 159, san patricio 27'0 casa"] },
    };
    const planilla = planillaDePrueba();
    await renombrar({
        planilla, campo: 'nombre',
        valor_nuevo: 'san patricio 270 casa',
        targetEdificios: ["san patricio 27'0 casa"],
        pg,
    });

    verificar('la tabla edificios', pg.edificios.edificio[0], 'san patricio 270 casa');
    verificar('su columna nombre también', pg.edificios.nombre[0], 'san patricio 270 casa');
    verificar('los reportes, aunque estén con otras mayúsculas', pg.reportes.edificio[0], 'san patricio 270 casa');
    verificar('el 159 de PG queda intacto', pg.reportes.edificio[1], 'san patricio 159');
    verificar('los vecinos', pg.vecinos.edificio[0], 'san patricio 270 casa');
    verificar('la lista del cliente, sin perder el otro edificio',
        pg.clientes.edificios[0], 'san patricio 159, san patricio 270 casa');
}

console.log('\n── SI POSTGRESQL FALLA, LA APROBACIÓN NO SE CAE ──');
{
    // Sheets ya quedó bien: tirar abajo la aprobación entera dejaría el cambio a medias y sin
    // registro. Se avisa fuerte en el log y se sigue.
    const planilla = planillaDePrueba();
    let error = null;
    try {
        await renombrar({
            planilla, campo: 'nombre',
            valor_nuevo: 'san patricio 270 casa',
            targetEdificios: ["san patricio 27'0 casa"],
            pg: null,   // sin base: la consulta de information_schema revienta
        });
    } catch (e) { error = e.message; }

    verificar('no explota', error, null);
    verificar('Sheets igual quedó renombrado', planilla.EVENTOS.filas[0][2], 'san patricio 270 casa');
}

console.log('\n── UN NOMBRE QUE SE ALARGA TAMBIÉN SE RENOMBRA ──');
{
    // "san patricio 270" → "san patricio 270 casa": uno contiene al otro. Con una comparación
    // laxa esto se leería como "ya se llamaba así" y no se cambiaría nada.
    const planilla = planillaDePrueba();
    planilla.EVENTOS.filas[0][2] = 'san patricio 270';
    const { filasRenombradas } = await renombrar({
        planilla, campo: 'nombre',
        valor_nuevo: 'san patricio 270 casa',
        targetEdificios: ['san patricio 270'],
    });
    verificar('el evento se renombró', planilla.EVENTOS.filas[0][2], 'san patricio 270 casa');
    verificar('se contó', filasRenombradas, 1);
}

console.log('\n── UNA PESTAÑA QUE NO EXISTE NO FRENA AL RESTO ──');
{
    // En una planilla nueva varias de estas pestañas todavía no están creadas. Que falte una no
    // puede dejar el renombrado a medias: eso deja el edificio partido en dos, que es peor que
    // no haberlo renombrado.
    const planilla = planillaDePrueba();
    delete planilla.expensas;
    delete planilla.sugerencias;
    const { filasRenombradas } = await renombrar({
        planilla, campo: 'nombre',
        valor_nuevo: 'san patricio 270 casa',
        targetEdificios: ["san patricio 27'0 casa"],
    });
    verificar('las que sí existen se renombran igual', filasRenombradas, 6);
    verificar('la ficha del vecino cambió', planilla.vecinos.filas[0][2], 'san patricio 270 casa');
}

console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);

})();
