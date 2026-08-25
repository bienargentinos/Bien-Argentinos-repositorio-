// Verifica la regla que protege los pagos: la PRIMERA carga de datos de cobro se aplica, pero un
// CAMBIO no pisa lo que ya estaba — queda pendiente hasta que la Administración lo apruebe.
//
//   node pruebas-cambio-cbu.js
//
// POR QUÉ IMPORTA: cambiar el CBU de un proveedor es el fraude más común que existe. Alguien se
// mete en la conversación, dice "cambié de banco, anotá este otro", y el pago del mes siguiente
// se va a otra cuenta. Acá la identidad es apenas un número de teléfono.
//
// De los dos errores posibles, el sistema tiene que equivocarse siempre para el mismo lado: un
// pago demorado se arregla, uno mandado a la cuenta equivocada no.

const path = require('path');
const RAIZ = __dirname;

// Una planilla de mentira: filas con la misma interfaz que las de google-spreadsheet.
function filaFalsa(datos) {
    const d = { ...datos };
    return {
        _datos: d,
        get: c => d[c] ?? '',
        set: (c, v) => { d[c] = v; },
        save: async () => {},
    };
}

// La planilla falsa. `FILAS` se reemplaza a lo largo de la prueba para armar cada escenario.
let FILAS = [];
const DOC_FALSO = {
    title: 'Planilla de prueba',
    async loadInfo() {},
    get sheetsByTitle() {
        return {
            proveedores: {
                headerValues: ['cliente', 'rubro', 'nombre', 'telefono', 'estado'],
                loadHeaderRow: async () => {},
                setHeaderRow: async () => {},
                getRows: async () => FILAS,
            },
        };
    },
};

// Se sustituyen las librerías de Google ANTES de cargar sheets.js, para que `getSheet()` --que es
// interna y no se puede reemplazar desde afuera-- devuelva la planilla falsa.
const stub = (nombre, exports) => {
    const ruta = require.resolve(nombre, { paths: [RAIZ] });
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports };
};
stub('google-spreadsheet', { GoogleSpreadsheet: function () { return DOC_FALSO; } });
stub('google-auth-library', { JWT: function () { return {}; } });

process.env.GOOGLE_CREDENTIALS_FILE = 'package.json'; // cualquier JSON que exista: no se usa
process.env.GOOGLE_SHEET_ID = 'planilla-de-mentira';

const sheets = require(path.join(RAIZ, 'sheets.js'));

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

// Un CBU válido armado con el cálculo del BCRA (no es de nadie).
function cbuValido(banco, sucursal, cuenta13) {
    const p1 = [7, 1, 3, 9, 7, 1, 3], p2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
    const dv = (d, p) => (10 - (p.reduce((a, w, i) => a + w * Number(d[i]), 0) % 10)) % 10;
    const b1 = banco + sucursal;
    return b1 + dv(b1, p1) + cuenta13 + dv(cuenta13, p2);
}
const CBU_1 = cbuValido('007', '0059', '9300045678901');
const CBU_2 = cbuValido('011', '0123', '4567890123456');

(async () => {

    console.log('\n── PRIMERA CARGA: se aplica ──');
    FILAS = [filaFalsa({ nombre: 'dario juju', telefono: '541169241157', rubro: 'electricidad', estado: 'activo' })];

    let r = await sheets.guardarDatosBancariosProveedor({
        nombre: 'dario juju', telefono: '541169241157', cbu: CBU_1, titular: 'Dario Juju',
    });
    verificar('guarda sin pedir aprobación', [r.ok, r.pendiente], [true, false]);
    verificar('el CBU queda activo', FILAS[0].get('cbu'), CBU_1);
    verificar('guarda el titular', FILAS[0].get('titular'), 'Dario Juju');
    verificar('no deja nada pendiente', FILAS[0].get('cbu_pendiente'), '');

    console.log('\n── CAMBIO: NO se aplica, queda pendiente ──');
    r = await sheets.guardarDatosBancariosProveedor({
        nombre: 'dario juju', telefono: '541169241157', cbu: CBU_2,
    });
    verificar('avisa que quedó pendiente', [r.ok, r.pendiente], [true, true]);
    verificar('⚠️ EL CBU VIGENTE NO CAMBIÓ', FILAS[0].get('cbu'), CBU_1);
    verificar('el nuevo quedó aparte, sin aplicar', FILAS[0].get('cbu_pendiente'), CBU_2);
    verificar('informa cuál era el anterior', r.anterior.cbu, CBU_1);
    verificar('informa cuál es el nuevo', r.nuevo.cbu, CBU_2);
    verificar('registra desde cuándo espera', FILAS[0].get('cbu_pendiente_desde').length > 0, true);

    console.log('\n── APROBAR el cambio ──');
    r = await sheets.resolverCambioBancario({ nombre: 'dario juju', telefono: '541169241157', aprobar: true });
    verificar('lo aplica', [r.ok, r.aprobado], [true, true]);
    verificar('ahora sí el CBU vigente es el nuevo', FILAS[0].get('cbu'), CBU_2);
    verificar('limpia el pendiente', FILAS[0].get('cbu_pendiente'), '');

    console.log('\n── RECHAZAR un cambio ──');
    await sheets.guardarDatosBancariosProveedor({ nombre: 'dario juju', telefono: '541169241157', cbu: CBU_1 });
    verificar('quedó pendiente otra vez', FILAS[0].get('cbu_pendiente'), CBU_1);
    r = await sheets.resolverCambioBancario({ nombre: 'dario juju', telefono: '541169241157', aprobar: false });
    verificar('lo descarta', [r.ok, r.aprobado], [true, false]);
    verificar('⚠️ EL CBU VIGENTE SIGUE SIENDO EL DE ANTES', FILAS[0].get('cbu'), CBU_2);
    verificar('limpia el pendiente', FILAS[0].get('cbu_pendiente'), '');

    console.log('\n── DOS TÉCNICOS EN LA MISMA LÍNEA ──');
    FILAS = [
        filaFalsa({ nombre: 'julio', telefono: '541169241157', rubro: 'plomeria', estado: 'activo' }),
        filaFalsa({ nombre: 'dario juju', telefono: '541169241157', rubro: 'electricidad', estado: 'activo' }),
    ];

    r = await sheets.guardarDatosBancariosProveedor({ nombre: '', telefono: '541169241157', cbu: CBU_1 });
    verificar('sin nombre NO elige uno al azar', [r.ok, r.ambiguo], [false, true]);
    verificar('devuelve los dos candidatos para poder preguntar', r.candidatos.map(c => c.nombre), ['julio', 'dario juju']);
    verificar('no le escribió el CBU a ninguno (1)', FILAS[0].get('cbu'), '');
    verificar('no le escribió el CBU a ninguno (2)', FILAS[1].get('cbu'), '');

    r = await sheets.guardarDatosBancariosProveedor({ nombre: 'julio', telefono: '541169241157', cbu: CBU_1 });
    verificar('con el nombre sí guarda', r.ok, true);
    verificar('se lo escribe a Julio', FILAS[0].get('cbu'), CBU_1);
    verificar('y NO se lo escribe a Dario', FILAS[1].get('cbu'), '');

    console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
    process.exit(fallos === 0 ? 0 : 1);
})().catch(e => {
    console.error('Error en la prueba:', e);
    process.exit(1);
});
