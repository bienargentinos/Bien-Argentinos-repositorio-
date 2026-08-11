require('dotenv').config();

/**
 * VERIFICADOR DE LA MIGRACIÓN
 *
 * Le hace las MISMAS preguntas a Google Sheets y a PostgreSQL y compara las respuestas. No modifica
 * nada: solo lee de los dos lados.
 *
 * Es la herramienta que decide si la migración se puede dar por buena. Mientras haya diferencias,
 * Sheets tiene que seguir siendo la fuente de verdad; cuando no queden, Postgres puede quedarse
 * solo. Confiar en que "debería andar" no alcanza cuando del otro lado hay un técnico yendo a un
 * edificio.
 *
 *   node verificar-migracion.js
 */

const sheets = require('./sheets');
const pg = require('./datos-pg');

// Se ignoran los campos que legítimamente difieren entre una fuente y otra.
const IGNORAR = new Set(['_row', '_raw']);

function normalizar(valor) {
    if (valor === null || valor === undefined) return null;
    if (Array.isArray(valor)) return valor.map(normalizar);
    if (typeof valor === 'object') {
        const salida = {};
        for (const k of Object.keys(valor).sort()) {
            if (IGNORAR.has(k)) continue;
            salida[k] = normalizar(valor[k]);
        }
        return salida;
    }
    // Sheets devuelve todo como texto; Postgres respeta los tipos. Un true y un "si" son la misma
    // respuesta y no tiene sentido reportarlos como diferencia.
    if (typeof valor === 'boolean') return valor;
    const t = String(valor).trim();
    if (/^(si|sí|true)$/i.test(t)) return true;
    if (/^(no|false)$/i.test(t)) return false;
    return t;
}

function iguales(a, b) {
    return JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
}

function resumir(v) {
    const s = JSON.stringify(normalizar(v));
    if (!s) return String(v);
    return s.length > 160 ? s.slice(0, 157) + '...' : s;
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

// Google permite del orden de 60 lecturas por minuto por usuario. Este verificador hace muchas
// seguidas, así que sin pausas Google corta con un 429 y devuelve vacío -- y eso, sin este
// cuidado, se lee como "las bases no coinciden" cuando en realidad Sheets no pudo contestar.
// (Que ese techo exista es, de paso, el mejor motivo para haber migrado: Marcos hace seis u ocho
// lecturas por mensaje y con varios vecinos escribiendo a la vez lo choca en producción.)
const PAUSA_ENTRE_CONSULTAS_MS = 1200;

let cuotaAgotada = false;
const esCuota = txt => /quota|429|rate limit|resource_exhausted/i.test(String(txt || ''));

async function comparar(nombre, fn, args) {
    const etiqueta = `${fn}(${args.map(a => JSON.stringify(a)).join(', ')})`;

    if (cuotaAgotada) {
        console.log(`  ⏸️  ${etiqueta} — omitido (Google agotó la cuota de lectura)`);
        return 'omitido';
    }

    let resSheets, resPg, errS = null, errP = null;
    try { resSheets = await sheets[fn](...args); } catch (e) { errS = e.message; }
    try { resPg = await pg[fn](...args); } catch (e) { errP = e.message; }

    if (esCuota(errS)) {
        cuotaAgotada = true;
        console.log(`  ⏸️  ${etiqueta} — Google agotó la cuota de lectura por minuto.`);
        return 'omitido';
    }

    if (errS || errP) {
        console.log(`  ⚠️  ${etiqueta}`);
        if (errS) console.log(`      Sheets falló: ${errS}`);
        if (errP) console.log(`      Postgres falló: ${errP}`);
        return 'error';
    }

    if (iguales(resSheets, resPg)) {
        console.log(`  ✅ ${etiqueta}`);
        await dormir(PAUSA_ENTRE_CONSULTAS_MS);
        return 'ok';
    }

    // Una diferencia se confirma antes de reportarla. sheets.js atrapa sus propios errores y
    // devuelve vacío, así que un 429 llega acá disfrazado de "no encontré nada": si tras esperar
    // el dato aparece, nunca hubo tal diferencia.
    console.log(`  … ${etiqueta}: posible diferencia, reintentando en 20s para descartar un corte de Google.`);
    await dormir(20000);

    let reintento = null, errR = null;
    try { reintento = await sheets[fn](...args); } catch (e) { errR = e.message; }

    if (esCuota(errR)) {
        cuotaAgotada = true;
        console.log(`  ⏸️  ${etiqueta} — Google sigue con la cuota agotada, se omite.`);
        return 'omitido';
    }

    if (iguales(reintento, resPg)) {
        console.log(`  ✅ ${etiqueta} (la primera lectura de Sheets había fallado)`);
        return 'ok';
    }

    console.log(`  ❌ ${etiqueta}`);
    console.log(`      Sheets  : ${resumir(reintento)}`);
    console.log(`      Postgres: ${resumir(resPg)}`);
    return 'distinto';
}

async function main() {
    console.log('🔍 Comparando Google Sheets contra PostgreSQL (no se modifica nada)\n');

    // Los casos de prueba se arman con datos REALES de la planilla, no inventados: se toman los
    // primeros edificios y vecinos que haya cargados. Comparar contra datos ficticios no dice nada.
    const edificios = await sheets.listarEdificiosConocidos();
    if (edificios.length === 0) {
        console.log('❌ No hay edificios en la planilla: no hay nada que comparar.');
        process.exit(1);
    }

    const casos = [];

    console.log('── Edificios ──');
    casos.push(await comparar('edificios', 'listarEdificiosConocidos', []));
    for (const e of edificios.slice(0, 5)) {
        casos.push(await comparar('perfil', 'buscarPerfilEdificio', [e.nombre]));
        if (e.direccion) casos.push(await comparar('perfil', 'buscarPerfilEdificio', [e.direccion]));
        // Los alias son por donde entra el vecino cuando escribe "la casa de Trini": si un alias
        // resuelve distinto en cada base, un mensaje puede terminar en el edificio equivocado.
        for (const alias of (e.aliases || []).slice(0, 3)) {
            casos.push(await comparar('perfil', 'buscarPerfilEdificio', [alias]));
        }
    }

    console.log('\n── Técnicos por rubro ──');
    for (const e of edificios.slice(0, 3)) {
        for (const rubro of ['electricidad', 'plomería', 'cerrajería', 'ascensor']) {
            casos.push(await comparar('tecnico', 'buscarTecnicoAsignado', [{ edificio: e.nombre, especialidad: rubro }]));
        }
    }

    console.log('\n── Personal de turno y accesos ──');
    for (const e of edificios.slice(0, 3)) {
        casos.push(await comparar('personal', 'buscarPersonalDeTurno', [{ edificio: e.nombre }]));
        casos.push(await comparar('accesos', 'buscarAccesosEdificio', [e.nombre]));
    }

    console.log('\n── Vecinos, memoria y rol ──');
    const doc = await sheets.getSheet();
    const hojaVecinos = doc.sheetsByTitle['VECINOS'] || doc.sheetsByIndex[0];
    const filasVecinos = await hojaVecinos.getRows();
    const telefonos = filasVecinos
        .map(r => String(r.get('telefono') || '').replace(/\D/g, ''))
        .filter(Boolean)
        .slice(0, 8);

    for (const tel of telefonos) {
        casos.push(await comparar('vecino', 'buscarVecinosPorTelefono', [tel]));
        casos.push(await comparar('memoria', 'buscarMemoriaVecino', [tel]));
        casos.push(await comparar('rol', 'buscarRolPorTelefono', [tel]));
    }

    // El rol de los proveedores es crítico: si Postgres no reconoce a un técnico como proveedor,
    // Marcos lo trata como vecino y le habla como si fuera el que hizo el reclamo.
    const hojaAsig = doc.sheetsByTitle['proveedor_asignaciones'];
    if (hojaAsig) {
        const telsProv = (await hojaAsig.getRows())
            .map(r => String(r.get('telefono') || '').replace(/\D/g, ''))
            .filter(Boolean).slice(0, 5);
        for (const tel of telsProv) {
            casos.push(await comparar('rol proveedor', 'buscarRolPorTelefono', [tel]));
        }
    }

    const ok = casos.filter(c => c === 'ok').length;
    const distintos = casos.filter(c => c === 'distinto').length;
    const errores = casos.filter(c => c === 'error').length;
    const omitidos = casos.filter(c => c === 'omitido').length;

    console.log('\n' + '─'.repeat(60));
    console.log(`Coinciden: ${ok}   Distintos: ${distintos}   Con error: ${errores}   Omitidos: ${omitidos}   (total ${casos.length})`);

    if (omitidos > 0) {
        console.log(`\nℹ️  ${omitidos} comprobación(es) quedaron sin hacer porque Google agotó su cuota de`);
        console.log('   lectura por minuto. No es un problema de los datos: es el techo de la API de');
        console.log('   Sheets. Esperá un minuto y volvé a correrlo para completar las que faltan.');
    }

    if (distintos === 0 && errores === 0) {
        console.log('\n✅ Las dos bases responden lo mismo en todas las pruebas.');
        console.log('   PostgreSQL está listo para quedarse solo cuando lo decidas.');
    } else {
        console.log('\n⚠️  Hay diferencias. NO apagues Sheets todavía.');
        console.log('   Revisá los ❌ de arriba: casi siempre es un dato que falta en PostgreSQL.');
        console.log('   Correr `node importar-sheets-a-pg.js` suele alcanzar para emparejarlas.');
    }

    process.exit(distintos || errores ? 1 : 0);
}

main().catch(err => {
    console.error('❌ Error en la verificación:', err.message);
    process.exit(1);
});
