// Prueba edificiosDelProveedor y buscarCasosRecientesPorTecnico contra datos inventados que
// reproducen el caso real de Daniel: UN electricista, VARIOS administradores.
const path = require('path');
const RAIZ = '/home/user/Bien-Argentinos-repositorio-';

// Sustituimos la base por tablas en memoria antes de que datos-pg la pida.
const TABLAS = {
    proveedor_asignaciones: [
        // Mismo técnico (mismo teléfono), tres administradores distintos.
        { estado: 'activo', proveedor: 'Daniel Valdez', telefono: '541150542005', edificio: 'SAN PATRICIO 159', cliente: 'amato_admin', rubro: 'electricidad' },
        { estado: 'activo', proveedor: 'Daniel Valdez', telefono: '541150542005', edificio: 'Av. Rivadavia 2200', cliente: 'gonzalez_admin', rubro: 'electricidad' },
        { estado: 'activo', proveedor: 'Daniel Valdez', telefono: '541150542005', edificio: 'Torre Belgrano', cliente: 'lopez_admin', rubro: 'electricidad' },
        // De otro técnico: no debe aparecer.
        { estado: 'activo', proveedor: 'Julio Plomero', telefono: '541169241157', edificio: 'Otro Consorcio', cliente: 'amato_admin', rubro: 'plomeria' },
        // Dado de baja: no debe aparecer.
        { estado: 'eliminado', proveedor: 'Daniel Valdez', telefono: '541150542005', edificio: 'Edificio Viejo', cliente: 'amato_admin', rubro: 'electricidad' },
    ],
    proveedores: [
        // Figura en la lista maestra de DOS administradores. Antes solo se tomaba el primero.
        { estado: 'activo', nombre: 'Daniel Valdez', telefono: '541150542005', cliente: 'amato_admin', rubro: 'electricidad' },
        { estado: 'activo', nombre: 'Daniel Valdez', telefono: '541150542005', cliente: 'perez_admin', rubro: 'electricidad' },
    ],
    edificios: [
        { nombre: 'SAN PATRICIO 159', cliente: 'amato_admin', direccion: 'San Patricio 159' },
        { nombre: 'Los Robles 450', cliente: 'perez_admin', direccion: 'Los Robles 450' },
        { nombre: 'Nada Que Ver 100', cliente: 'otro_admin', direccion: 'Nada Que Ver 100' },
    ],
    clientes: [
        { usuario: 'perez_admin', nombre: 'Perez Administraciones', edificios: 'Los Robles 450, Mitre 3300' },
    ],
    reportes: [
        { codigo_caso: 'CASO-1001', edificio: 'SAN PATRICIO 159', tecnico: 'Daniel Valdez', tel_tecnico: '541150542005', estado: 'resuelto', fecha: hace(6), problema: 'Falla electrica en hall' },
        { codigo_caso: 'CASO-1007', edificio: 'Av. Rivadavia 2200', tecnico: 'Daniel Valdez', tel_tecnico: '541150542005', estado: 'resuelto', fecha: hace(3), problema: 'Tablero de pasillo' },
        { codigo_caso: 'CASO-1012', edificio: 'Torre Belgrano', tecnico: 'Daniel Valdez', tel_tecnico: '541150542005', estado: 'en_proceso', fecha: hace(1), problema: 'Luces de emergencia' },
        { codigo_caso: 'CASO-0500', edificio: 'SAN PATRICIO 159', tecnico: 'Daniel Valdez', tel_tecnico: '541150542005', estado: 'resuelto', fecha: hace(200), problema: 'Viejisimo, fuera de ventana' },
        { codigo_caso: 'CASO-1013', edificio: 'Otro Consorcio', tecnico: 'Julio Plomero', tel_tecnico: '541169241157', estado: 'resuelto', fecha: hace(2), problema: 'Perdida de agua' },
    ],
};

function hace(dias) {
    return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

require.cache[require.resolve(path.join(RAIZ, 'db-pg.js'))] = {
    id: require.resolve(path.join(RAIZ, 'db-pg.js')),
    filename: require.resolve(path.join(RAIZ, 'db-pg.js')),
    loaded: true,
    exports: {
        pool: {
            query: async (sql) => {
                const tabla = (sql.match(/FROM\s+(\w+)/i) || [])[1];
                return { rows: TABLAS[tabla] || [], rowCount: (TABLAS[tabla] || []).length };
            },
        },
    },
};

const pg = require(path.join(RAIZ, 'datos-pg.js'));

let fallos = 0;
function verificar(titulo, condicion, detalle) {
    if (condicion) {
        console.log(`  ✅ ${titulo}`);
    } else {
        fallos++;
        console.log(`  ❌ ${titulo}\n     ${detalle}`);
    }
}

(async () => {
    console.log('\n── CARTERA DEL PROVEEDOR (un técnico, varios administradores) ──');
    const cartera = await pg.edificiosDelProveedor({ nombre: 'Daniel Valdez', telefono: '5491150542005' });
    const nombres = cartera.map(c => c.edificio);
    console.log('  cartera:', JSON.stringify(cartera, null, 0));

    verificar('trae los 3 edificios asignados', ['SAN PATRICIO 159', 'Av. Rivadavia 2200', 'Torre Belgrano'].every(e => nombres.includes(e)),
        `faltan: ${['SAN PATRICIO 159','Av. Rivadavia 2200','Torre Belgrano'].filter(e => !nombres.includes(e))}`);
    verificar('suma los edificios del SEGUNDO administrador (perez_admin), no solo del primero', nombres.includes('Los Robles 450'),
        'antes solo se tomaba el primer cliente encontrado');
    verificar('suma los edificios que el cliente lista por coma', nombres.includes('Mitre 3300'), `nombres: ${nombres}`);
    verificar('NO trae edificios de un administrador ajeno', !nombres.includes('Nada Que Ver 100'), 'se coló un edificio de otro_admin');
    verificar('NO trae el edificio de otro técnico', !nombres.includes('Otro Consorcio'), 'se coló el edificio de Julio');
    verificar('NO trae la asignación dada de baja', !nombres.includes('Edificio Viejo'), 'se coló una asignación eliminada');
    verificar('cada edificio sabe de qué administrador es', cartera.find(c => c.edificio === 'SAN PATRICIO 159')?.cliente === 'amato_admin',
        JSON.stringify(cartera.find(c => c.edificio === 'SAN PATRICIO 159')));

    console.log('\n── CASOS RECIENTES (lista, no "el último") ──');
    const casos = await pg.buscarCasosRecientesPorTecnico('Daniel Valdez', '5491150542005', 30);
    console.log('  casos:', casos.map(c => `${c.id_evento}/${c.edificio}`).join(', '));

    verificar('devuelve una lista, no un solo caso', Array.isArray(casos), typeof casos);
    verificar('trae los 3 casos dentro de la ventana', casos.length === 3, `trajo ${casos.length}`);
    verificar('descarta el caso de hace 200 días', !casos.some(c => c.id_evento === 'CASO-0500'), 'se coló un caso fuera de la ventana');
    verificar('no trae casos de otro técnico', !casos.some(c => c.id_evento === 'CASO-1013'), 'se coló el caso de Julio');
    verificar('incluye casos YA CERRADOS (es el caso normal de una factura)', casos.some(c => c.cerrado), 'no vino ninguno cerrado');
    verificar('el más reciente viene primero', casos[0]?.id_evento === 'CASO-1012', `vino ${casos[0]?.id_evento}`);
    verificar('con 3 casos en edificios distintos, el motor NO debe deducir',
        new Set(casos.map(c => c.edificio)).size > 1,
        'los casos son del mismo edificio, el test no prueba la ambigüedad');

    console.log('\n── CASO POR CÓDIGO (el atajo que el técnico puede citar) ──');
    const caso = await pg.buscarCasoPorCodigo('1007');
    verificar('encuentra CASO-1007 y su edificio', caso?.edificio === 'Av. Rivadavia 2200', JSON.stringify(caso));

    console.log(fallos === 0 ? '\n✅ TODO BIEN\n' : `\n❌ ${fallos} verificación(es) fallaron\n`);
    process.exit(fallos === 0 ? 0 : 1);
})();
