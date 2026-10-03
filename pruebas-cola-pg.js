// Verifica que una copia a PostgreSQL que falla no se pierda, y que al reintentarla no pise nada.
//
//   node pruebas-cola-pg.js
//
// POR QUÉ. `copiarAPg` disparaba y seguía: el CASO-1001 se cerró mientras PostgreSQL rechazaba la
// contraseña, la copia del cierre se perdió, y para Marcos --que lee PostgreSQL primero-- el caso
// siguió abierto. Ahora las copias que fallan por la conexión quedan en una cola que se reintenta
// sola, en orden, y sobrevive a un reinicio.
//
// Se prueba con una base de mentira y un reloj de mentira: no hace falta PostgreSQL.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearColaPg, esFallaDeConexion } = require('./cola-pg');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const errConexion = () => Object.assign(new Error('password authentication failed for user "marcos"'), { code: '28P01' });
const errSql = () => Object.assign(new Error('column "foto_url" of relation "reportes" does not exist'), { code: '42703' });

// Una base de mentira: `caida` decide si contesta. Guarda lo que se ejecutó, en orden.
function montar({ archivo } = {}) {
    const base = { caida: false, hechas: [], fallaSql: new Set() };
    const logs = [];
    const log = { log: m => logs.push(m), warn: m => logs.push(m), error: m => logs.push(m) };
    const timers = [];
    const programar = (fn) => { timers.push(fn); return { unref() {} }; };
    const cola = crearColaPg({
        archivo: archivo || path.join(os.tmpdir(), `cola-pg-prueba-${process.pid}-${Math.random()}.json`),
        log, programar,
        ejecutar: async (item) => {
            if (base.fallaSql.has(item.descripcion)) throw errSql();
            if (base.caida) throw errConexion();
            base.hechas.push(item.descripcion);
        },
    });
    const correrTimers = async () => { while (timers.length) timers.shift()(); await esperar(); };
    return { base, cola, logs, correrTimers, timers };
}
const copia = (d, extra = {}) => ({ descripcion: d, sql: 'UPDATE x SET y = $1', params: [d], ...extra });

(async () => {
    console.log('\n── CON LA BASE ANDANDO, COMO SIEMPRE ──');
    {
        const { base, cola, timers } = montar();
        cola.encolar(copia('el reporte CASO-1001'));
        await esperar();
        verificar('se copia enseguida', base.hechas, ['el reporte CASO-1001']);
        verificar('no queda nada pendiente', cola.pendientes().length, 0);
        verificar('no se agenda ningún reintento', timers.length, 0);
    }

    console.log('\n── LA CAÍDA DEL CASO-1001: SE REINTENTA, NO SE PIERDE ──');
    {
        const { base, cola, logs, correrTimers } = montar();
        base.caida = true;
        cola.encolar(copia('el cierre de CASO-1001'));
        await esperar();
        verificar('no entró', base.hechas, []);
        verificar('queda en la cola', cola.pendientes().map(p => p.descripcion), ['el cierre de CASO-1001']);
        verificar('y lo dice en el log', logs.some(l => /⏳.*el cierre de CASO-1001.*se reintenta/.test(l)), true);

        await correrTimers();   // sigue caída: otro intento, sigue en la cola
        verificar('un reintento con la base caída no la pierde', cola.pendientes().length, 1);

        base.caida = false;
        await correrTimers();
        verificar('cuando vuelve, entra', base.hechas, ['el cierre de CASO-1001']);
        verificar('la cola queda vacía', cola.pendientes().length, 0);
        verificar('y avisa que se puso al día', logs.some(l => /✅ PostgreSQL volvió: se pusieron al día 1/.test(l)), true);
    }

    console.log('\n── EL ORDEN: LO VIEJO NO PISA A LO NUEVO ──');
    {
        // Si el estado "en_proceso" falla y "resuelto" entra primero, reintentar "en_proceso" después
        // reabriría el caso. Mientras haya algo atrasado, lo nuevo espera detrás.
        const { base, cola, correrTimers } = montar();
        base.caida = true;
        cola.encolar(copia('estado en_proceso de CASO-1003'));
        await esperar();
        base.caida = false;   // la base vuelve ANTES de que venza el reintento
        cola.encolar(copia('estado resuelto de CASO-1003'));
        await esperar();
        verificar('lo nuevo no se adelanta mientras hay un reintento agendado', base.hechas, []);
        await correrTimers();
        verificar('entran en el orden en que se pidieron', base.hechas, ['estado en_proceso de CASO-1003', 'estado resuelto de CASO-1003']);
    }

    console.log('\n── UN ERROR DEL SQL NO TRABA LA COLA ──');
    {
        const { base, cola, logs, timers } = montar();
        base.fallaSql.add('la foto del reclamo');
        cola.encolar(copia('la foto del reclamo'));
        cola.encolar(copia('el reporte CASO-1004'));
        await esperar();
        verificar('lo que viene detrás entra igual', base.hechas, ['el reporte CASO-1004']);
        verificar('no se agenda reintento de algo que va a fallar siempre', timers.length, 0);
        verificar('pero se grita', logs.some(l => /❌.*la foto del reclamo.*NO se reintenta/.test(l)), true);
    }

    console.log('\n── SOBREVIVE A UN pm2 restart ──');
    {
        const archivo = path.join(os.tmpdir(), `cola-pg-prueba-reinicio-${process.pid}.json`);
        try { fs.unlinkSync(archivo); } catch {}

        const antes = montar({ archivo });
        antes.cola.iniciar();                 // el servidor
        antes.base.caida = true;
        antes.cola.encolar(copia('el cierre de CASO-1001'));
        antes.cola.encolar({ descripcion: 'el vecino Daniel', upsert: ['vecinos', ['telefono', 'edificio'], { telefono: '549111', nombre: 'Daniel', edificio: 'San Patricio 159' }] });
        await esperar();
        verificar('lo pendiente quedó en disco', fs.existsSync(archivo), true);
        verificar('las dos copias', JSON.parse(fs.readFileSync(archivo, 'utf8')).map(p => p.descripcion), ['el cierre de CASO-1001', 'el vecino Daniel']);

        // PM2 lo mata y lo levanta. La base ya volvió. index.js llama a iniciar() antes de todo.
        const despues = montar({ archivo });
        despues.cola.iniciar();
        despues.cola.encolar(copia('un mensaje nuevo después del arranque'));
        await esperar();
        verificar('retoma lo guardado ANTES de lo nuevo', despues.base.hechas,
            ['el cierre de CASO-1001', 'el vecino Daniel', 'un mensaje nuevo después del arranque']);
        verificar('y borra el archivo al terminar', fs.existsSync(archivo), false);
        verificar('lo dice al arrancar', despues.logs.some(l => /Quedaron 2 copia\(s\).*del arranque anterior/.test(l)), true);
    }

    console.log('\n── SI ALGO SE COPIÓ ANTES DE CARGAR LA COLA, NO SE PIERDE NI SE REPITE ──');
    {
        // Lo que ya estaba corriendo va primero (no hay forma de desordenarlo hacia atrás), pero no
        // puede sacar de la lista a otra copia ni ejecutarse dos veces. Pasó en la primera versión.
        const archivo = path.join(os.tmpdir(), `cola-pg-prueba-carrera-${process.pid}.json`);
        fs.writeFileSync(archivo, JSON.stringify([copia('guardada A'), copia('guardada B')]));
        const { base, cola } = montar({ archivo });
        cola.encolar(copia('en vuelo'));
        cola.iniciar();
        await esperar();
        verificar('cada una una sola vez, ninguna perdida', [...base.hechas].sort(), ['en vuelo', 'guardada A', 'guardada B']);
        verificar('lo guardado conserva su orden', base.hechas.filter(h => h.startsWith('guardada')), ['guardada A', 'guardada B']);
        try { fs.unlinkSync(archivo); } catch {}
    }

    console.log('\n── UNA HERRAMIENTA SUELTA NO TOCA EL ARCHIVO DEL SERVIDOR ──');
    {
        const archivo = path.join(os.tmpdir(), `cola-pg-prueba-herramienta-${process.pid}.json`);
        fs.writeFileSync(archivo, JSON.stringify([copia('algo del servidor')]));
        const { base, cola } = montar({ archivo });   // sin iniciar(): es un revisar-*.js
        base.caida = true;
        cola.encolar(copia('algo de la herramienta'));
        await esperar();
        verificar('no se llevó lo del servidor', JSON.parse(fs.readFileSync(archivo, 'utf8')).map(p => p.descripcion), ['algo del servidor']);
        fs.unlinkSync(archivo);
    }

    console.log('\n── QUÉ ES FALLA DE CONEXIÓN ──');
    verificar('contraseña rechazada (la caída del CASO-1001)', esFallaDeConexion(errConexion()), true);
    verificar('la base no contesta', esFallaDeConexion(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), true);
    verificar('la base se está reiniciando', esFallaDeConexion({ code: '57P01', message: 'terminating connection' }), true);
    verificar('el tiempo de conexión de db-pg.js', esFallaDeConexion(new Error('timeout exceeded when trying to connect')), true);
    verificar('una columna que no existe NO', esFallaDeConexion(errSql()), false);
    verificar('una restricción que no se cumple NO', esFallaDeConexion({ code: '23514', message: 'violates check constraint' }), false);
    verificar('un error del código NO', esFallaDeConexion(new TypeError('x is not a function')), false);

    console.log('\n── CANDADOS ──');
    {
        const codigo = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
            .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
        const datos = codigo('datos.js');
        // Una función no se puede guardar en disco: la copia tiene que ser un dato.
        verificar('ninguna copia en datos.js es una función', /copiarAPg\([^\n]*,\s*(async\s*)?\(\)\s*=>/.test(datos), false);
        verificar('index.js retoma la cola al arrancar', /colaPg\.iniciar\(\)/.test(codigo('index.js')), true);
        verificar('el archivo de la cola no va al repo (tiene datos de vecinos)',
            fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8').split('\n').includes('cola-pg-pendiente.json'), true);
        verificar('reset-test.js vacía la cola', /limpiarColaPg\(\)/.test(codigo('reset-test.js')), true);
    }

    console.log(fallos ? `\n❌ ${fallos} fallo(s).` : '\n✅ Todo en orden.');
    process.exit(fallos ? 1 : 0);
})();
