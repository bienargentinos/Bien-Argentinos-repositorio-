// La sesión de prueba del portal del vecino, en un solo lugar.
//
//   const { sesionDemoVecino } = require('./sesion-demo');
//   req.session.vecino = sesionDemoVecino('turista');
//
// POR QUÉ EXISTE. El botón "Demo Rápido" de `/vecino/login` armaba la sesión a mano con seis
// campos y el default de `getVecinoSession` la armaba aparte con dieciséis. Como al botón le
// faltaba `unidades`, entrar por ahí caía siempre en la pantalla "Cuenta Creada — todavía no
// tenés ningún departamento asignado", aunque arriba dijera "San Patricio 159 · Depto 1° A".
// También le faltaba `rol`, así que el topbar lo mostraba como propietario por descarte.
//
// Son dos copias de la misma cosa: es exactamente el error que la regla 5 de
// `docs/para-cualquier-agente.md` manda no repetir. Ahora hay una sola y las dos la llaman.

const UNIDADES_PROPIETARIO = [
    { edificio: 'San Patricio 159', departamento: '1° A', rol: 'propietario', puede_ver_expensas: true, timbre_activo: true },
    { edificio: 'San Patricio 159', departamento: '4° C', rol: 'propietario', puede_ver_expensas: true, timbre_activo: true },
];

// El huésped ve una sola unidad y por una ventana de fechas: no es dueño de nada, está de paso.
const NOCHES_DE_ESTADIA_DEMO = 5;

function soloFecha(d) {
    return new Date(d).toISOString().slice(0, 10);
}

// `hoy` se puede pasar para que la prueba no dependa del día en que corre.
function sesionDemoVecino(rol = 'propietario', telefono = '', hoy = new Date()) {
    const tel = String(telefono || '').trim();

    if (rol === 'turista') {
        const desde = soloFecha(hoy);
        const hasta = soloFecha(new Date(new Date(hoy).getTime() + NOCHES_DE_ESTADIA_DEMO * 24 * 60 * 60 * 1000));
        return {
            // Marca de agua: esta sesión NO es una cuenta. Sin ella, "Mi Perfil" escribiría en la
            // fila 1 de `usuarios` — que es el usuario semilla de verdad — cada vez que alguien
            // entra por el botón de demo y toca Guardar.
            demo: true,
            usuario_id: 2,
            nombre: 'Camila',
            apellido: 'Ferreyra',
            email: 'turista@consorcio.ai',
            telefono: tel || '+5491155554444',
            edificio: 'San Patricio 159',
            departamento: '4° C',
            rol: 'turista',
            idioma: 'pt',   // el huésped de prueba llega de Brasil: así se ve el portal traducido
            // El huésped NO ve expensas: no es el que las paga.
            puede_ver_expensas: false,
            timbre_activo: true,
            timbre_silencio_desde: '23:00',
            timbre_silencio_hasta: '07:30',
            timbre_no_molestar_activo: false,
            fecha_desde: desde,
            fecha_hasta: hasta,
            // Pase temporal de demostración: vence con la estadía, igual que uno de verdad.
            pase_demo: { codigo: 'DEMO-HUESPED-4C', vence: hasta },
            unidades: [
                {
                    edificio: 'San Patricio 159', departamento: '4° C', rol: 'turista',
                    puede_ver_expensas: false, timbre_activo: true,
                    fecha_desde: desde, fecha_hasta: hasta,
                },
            ],
        };
    }

    return {
        demo: true,
        usuario_id: 1,
        nombre: 'Daniel',
        apellido: 'Morales',
        email: 'daniel@consorcio.ai',
        telefono: tel || '+5491150542005',
        edificio: 'San Patricio 159',
        departamento: '1° A',
        rol: 'propietario',
        idioma: 'es',
        puede_ver_expensas: true,
        timbre_activo: true,
        timbre_silencio_desde: '23:00',
        timbre_silencio_hasta: '07:30',
        timbre_no_molestar_activo: false,
        unidades: UNIDADES_PROPIETARIO.map(u => ({ ...u })),
    };
}

module.exports = { sesionDemoVecino, NOCHES_DE_ESTADIA_DEMO };
