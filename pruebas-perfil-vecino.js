// El login de prueba del portal y la pantalla "Mi Perfil".
//
//   node pruebas-perfil-vecino.js
//
// POR QUÉ EXISTE. El botón "Demo Rápido" armaba la sesión a mano con seis campos. Le faltaba
// `unidades`, y `/vecino` arranca con `if (!v.unidades || v.unidades.length === 0)`: el que entraba
// por ahí caía SIEMPRE en "Cuenta Creada — todavía no tenés ningún departamento asignado", con el
// edificio y el departamento escritos dos centímetros más arriba. Nada fallaba, nada se logueaba:
// la sesión era válida, solo estaba incompleta.
//
// Y había un segundo piso al mismo problema: el portal no montaba `express.urlencoded`, así que el
// cuerpo del formulario NO se parseaba. `req.body` daba `{}` y el `rol` del botón de huésped se
// perdía en silencio — el demo del turista entraba como propietario.
//
// Por eso esta prueba levanta el router de verdad y le pega por HTTP: un chequeo sobre el texto del
// archivo habría dicho que el `rol` estaba, porque estaba. Lo que faltaba era quién lo leyera.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

const { sesionDemoVecino } = require('./sesion-demo');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}

function afirmar(titulo, condicion) {
    verificar(titulo, !!condicion, true);
}

// ---------------------------------------------------------------- la sesión de prueba, sola

console.log('\n── LA SESIÓN DEMO DEL PROPIETARIO ──');
{
    const s = sesionDemoVecino('propietario');
    afirmar('tiene unidades (esto es lo que faltaba)', s.unidades && s.unidades.length > 0);
    verificar('entra como propietario', s.rol, 'propietario');
    verificar('ve expensas', s.puede_ver_expensas, true);
    afirmar('trae email, que la pantalla vacía mostraba en blanco', !!s.email);
    verificar('el teléfono del formulario pisa al de fábrica', sesionDemoVecino('propietario', '1150542005').telefono, '1150542005');
}

console.log('\n── LA SESIÓN DEMO DEL HUÉSPED ──');
{
    const hoy = new Date('2026-09-22T12:00:00Z');
    const s = sesionDemoVecino('turista', '', hoy);
    verificar('entra como turista', s.rol, 'turista');
    verificar('NO ve expensas: no es el que las paga', s.puede_ver_expensas, false);
    verificar('una sola unidad', s.unidades.length, 1);
    verificar('la estadía arranca hoy', s.fecha_desde, '2026-09-22');
    afirmar('y termina después', s.fecha_hasta > s.fecha_desde);
    afirmar('tiene pase QR temporal', !!(s.pase_demo && s.pase_demo.codigo));
    verificar('el pase vence con la estadía', s.pase_demo.vence, s.fecha_hasta);
    verificar('la unidad también lleva las fechas', s.unidades[0].fecha_hasta, s.fecha_hasta);
}

console.log('\n── DOS SESIONES NO COMPARTEN LAS UNIDADES ──');
{
    // Las unidades salen de una constante del módulo. Si se devolviera la MISMA lista, el que
    // cambia de departamento en una sesión se lo cambiaría a la siguiente.
    const a = sesionDemoVecino('propietario');
    const b = sesionDemoVecino('propietario');
    a.unidades[0].departamento = 'PISOTEADO';
    verificar('la segunda sesión queda intacta', b.unidades[0].departamento, '1° A');
}

// ---------------------------------------------------------------- el portal, por HTTP

const portal = require('./portal-vecino');
const app = express();
app.use('/vecino', portal);
const server = http.createServer(app);

function pedir(metodo, ruta, { cuerpo, tipo, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const cabeceras = {};
        if (cuerpo) {
            cabeceras['Content-Type'] = tipo || 'application/x-www-form-urlencoded';
            cabeceras['Content-Length'] = Buffer.byteLength(cuerpo);
        }
        if (cookie) cabeceras['Cookie'] = cookie;
        const req = http.request(
            { host: '127.0.0.1', port: server.address().port, method: metodo, path: ruta, headers: cabeceras },
            (res) => {
                let txt = '';
                res.on('data', (d) => { txt += d; });
                res.on('end', () => resolve({
                    codigo: res.statusCode,
                    cuerpo: txt,
                    cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '),
                    destino: res.headers.location || '',
                }));
            }
        );
        req.on('error', reject);
        if (cuerpo) req.write(cuerpo);
        req.end();
    });
}

const PANTALLA_VACIA = 'Todavía no tenés ningún departamento asignado';

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));

    console.log('\n── ENTRAR POR EL BOTÓN DE DEMO (PROPIETARIO) ──');
    {
        const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
        verificar('redirige al portal', login.destino, '/vecino');
        const inicio = await pedir('GET', '/vecino/', { cookie: login.cookie });
        verificar('la pantalla de inicio responde', inicio.codigo, 200);
        afirmar('NO cae en "Cuenta Creada" (este era el bug)', !inicio.cuerpo.includes(PANTALLA_VACIA));
        afirmar('muestra el departamento', inicio.cuerpo.includes('1° A'));
        afirmar('lo trata de propietario', inicio.cuerpo.includes('Propietario'));
    }

    console.log('\n── ENTRAR POR EL BOTÓN DE HUÉSPED ──');
    {
        const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=turista' });
        const inicio = await pedir('GET', '/vecino/', { cookie: login.cookie });
        afirmar('tampoco cae en la pantalla vacía', !inicio.cuerpo.includes(PANTALLA_VACIA));
        afirmar('lo trata de huésped, no de propietario', inicio.cuerpo.includes('Huésped'));
        // Si el `rol` del formulario no se leyera, acá entraría como propietario y esto lo delata.
        afirmar('no le ofrece la solapa de Expensas', !inicio.cuerpo.includes('/vecino/expensas'));
    }

    console.log('\n── MI PERFIL ──');
    {
        const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
        const perfil = await pedir('GET', '/vecino/perfil', { cookie: login.cookie });
        verificar('la pantalla responde', perfil.codigo, 200);
        afirmar('muestra el nombre completo', perfil.cuerpo.includes('Daniel Morales'));
        afirmar('muestra el email', perfil.cuerpo.includes('daniel@consorcio.ai'));
        afirmar('muestra el teléfono', perfil.cuerpo.includes('+5491150542005'));
        afirmar('muestra el rol', perfil.cuerpo.includes('Propietario'));
        afirmar('lista las dos unidades', perfil.cuerpo.includes('1° A') && perfil.cuerpo.includes('4° C'));
        afirmar('deja cambiar de unidad activa', perfil.cuerpo.includes('usarUnidad('));
        afirmar('tiene el cambio de contraseña', perfil.cuerpo.includes('/vecino/api/cambiar-password'));
        afirmar('el email NO se edita desde acá', perfil.cuerpo.includes('type="email"') && perfil.cuerpo.includes('disabled'));
    }

    console.log('\n── MI PERFIL DEL HUÉSPED ──');
    {
        const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=turista' });
        const perfil = await pedir('GET', '/vecino/perfil', { cookie: login.cookie });
        afirmar('le muestra las fechas de la estadía', perfil.cuerpo.includes('Tu estadía'));
        afirmar('y el pase QR temporal', perfil.cuerpo.includes('DEMO-HUESPED-4C'));
    }

    console.log('\n── GUARDAR LOS DATOS ──');
    {
        const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
        // La sesión de demo no tiene fila en la base: se guarda solo en pantalla y lo dice.
        const guardar = await pedir('POST', '/vecino/api/perfil', {
            cuerpo: JSON.stringify({ nombre: 'Daniela', apellido: 'Morales', telefono: '1160001111' }),
            tipo: 'application/json', cookie: login.cookie,
        });
        verificar('contesta 200', guardar.codigo, 200);
        afirmar('dice que salió bien', JSON.parse(guardar.cuerpo).ok === true);
        // Sin esto, el botón de demo le reescribiría el nombre al usuario de la fila 1.
        afirmar('y avisa que no tocó la base', JSON.parse(guardar.cuerpo).demo === true);

        const vacio = await pedir('POST', '/vecino/api/perfil', {
            cuerpo: JSON.stringify({ nombre: '   ' }),
            tipo: 'application/json', cookie: login.cookie,
        });
        verificar('un nombre vacío se rechaza', vacio.codigo, 400);
    }

    console.log('\n── LA CONTRASEÑA NO SE CAMBIA SIN CUENTA ──');
    {
        // La sesión de demo no es una cuenta de verdad: dejarla cambiar contraseñas sería dejar
        // que cualquiera que abra /vecino/login toque la de otro.
        const sinSesion = await pedir('POST', '/vecino/api/cambiar-password', {
            cuerpo: JSON.stringify({ actual: '', nueva: 'loquesea123' }),
            tipo: 'application/json',
        });
        verificar('sin sesión no se puede', sinSesion.codigo, 403);

        const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
        const demo = await pedir('POST', '/vecino/api/cambiar-password', {
            cuerpo: JSON.stringify({ actual: '', nueva: 'loquesea123' }),
            tipo: 'application/json', cookie: login.cookie,
        });
        verificar('y con la sesión de demo tampoco', demo.codigo, 403);
    }

    console.log('\n── LAS FECHAS DE LA ESTADÍA SALEN DE LA UNIDAD ──');
    {
        // `obtenerUnidadesDeUsuario` devuelve `fecha_desde` / `fecha_hasta` por fila de
        // `usuario_unidades`, y `/api/login-email` arma la sesión SIN copiarlas al nivel de arriba.
        // Leerlas solo de la sesión le mostraba "—" a todo huésped que entró con su cuenta: andaba
        // nada más con la de demo, que sí las lleva sueltas. Por eso se prueba con las dos formas.
        const SRC = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');
        const ini = SRC.indexOf('  const unidadActiva = unidades.find(u =>');
        const marcaFin = "const estadiaHasta = unidadActiva.fecha_hasta || v.fecha_hasta || '';";
        const fin = SRC.indexOf(marcaFin, ini);
        afirmar('está el bloque que resuelve las fechas', ini !== -1 && fin !== -1);
        const cuerpoFechas = SRC.slice(ini, fin + marcaFin.length);
        // eslint-disable-next-line no-new-func
        const resolver = new Function('v', 'unidades',
            `${cuerpoFechas}; return { estadiaDesde, estadiaHasta };`);

        const comoLoArmaLoginEmail = {
            edificio: 'San Patricio 159', departamento: '4° C', rol: 'turista',
            unidades: [{ edificio: 'San Patricio 159', departamento: '4° C', fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07' }],
        };
        verificar('un huésped de verdad ve el inicio de su estadía',
            resolver(comoLoArmaLoginEmail, comoLoArmaLoginEmail.unidades).estadiaDesde, '2026-10-01');
        verificar('y el final', resolver(comoLoArmaLoginEmail, comoLoArmaLoginEmail.unidades).estadiaHasta, '2026-10-07');

        const demo = sesionDemoVecino('turista', '', new Date('2026-09-22T12:00:00Z'));
        verificar('la sesión de demo sigue andando', resolver(demo, demo.unidades).estadiaDesde, '2026-09-22');

        // Con dos unidades tiene que ganar la que está mirando, no la primera de la lista.
        const dos = {
            edificio: 'San Patricio 159', departamento: '2° B', rol: 'turista',
            unidades: [
                { edificio: 'San Patricio 159', departamento: '4° C', fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07' },
                { edificio: 'San Patricio 159', departamento: '2° B', fecha_desde: '2026-11-15', fecha_hasta: '2026-11-20' },
            ],
        };
        verificar('toma las de la unidad activa', resolver(dos, dos.unidades).estadiaHasta, '2026-11-20');
    }

    console.log('\n── EL APELLIDO NO SE PIERDE AL GUARDAR ──');
    {
        // Los logins reales guardan `nombre` y `apellido` por separado, y el portal escribía
        // `v.nombre` solo. En `reportes`, en el reclamo y en el aviso por WhatsApp al
        // administrador figuraba "Daniel" — con dos Danieles en el edificio, no se sabe cuál.
        const SRC = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');

        // Lo que se guarda o se manda ya no puede ser el nombre pelado. Las excepciones son
        // el campo editable de "Mi Perfil" y la fila de integrante, que lleva su apellido al lado.
        const lineas = SRC.split('\n');
        const sueltos = [];
        for (let i = 0; i < lineas.length; i++) {
            const l = lineas[i];
            if (!/\bv\.nombre\b/.test(l)) continue;
            if (/^\s*\/\//.test(l)) continue;                      // un comentario
            if (/v && v\.nombre/.test(l)) continue;                 // el propio nombreCompleto
            if (/String\(v\.nombre \|\| ''\)/.test(l)) continue;    // el propio esElMismoVecino
            if (/perfil-nombre/.test(l)) continue;                  // el campo editable de Mi Perfil
            // `nombre:` con su `apellido:` al lado NO pierde nada: son dos columnas.
            if (/nombre: v\.nombre,/.test(l) && /apellido:/.test(lineas[i + 1] || '')) continue;
            sueltos.push(i + 1);
        }
        verificar('no queda ningún v.nombre suelto', sueltos, []);

        afirmar('el saludo usa el primer nombre', SRC.includes('¡Hola ${primerNombre(v)}!'));
        afirmar('el reclamo guarda el nombre completo', SRC.includes('vecino: nombreCompleto(v),'));
        afirmar('el pase QR también', SRC.includes('creado_por_nombre: nombreCompleto(v),'));
        afirmar('y el aviso al administrador', SRC.includes('*Vecino:* ${nombreCompleto(v)}'));
    }

    console.log('\n── Y LAS FILAS VIEJAS NO DESAPARECEN ──');
    {
        // Lo que ya está guardado dice "Daniel" a secas. Si la comparación solo aceptara la forma
        // nueva, el vecino entraría y no vería ninguno de sus reclamos anteriores al cambio, sin
        // ningún error y sin forma de saber por qué.
        const SRC = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');
        const ini = SRC.indexOf('function esElMismoVecino(');
        afirmar('existe esElMismoVecino', ini !== -1);
        const cuerpo = SRC.slice(ini, SRC.indexOf('\n}', ini) + 2);
        // eslint-disable-next-line no-new-func
        const esElMismo = new Function('nombreCompleto',
            `${cuerpo}; return esElMismoVecino;`)(v => [v.nombre, v.apellido].filter(Boolean).join(' ').trim() || 'Vecino');

        const v = { nombre: 'Daniel', apellido: 'Morales' };
        afirmar('una fila nueva ("Daniel Morales") es suya', esElMismo('Daniel Morales', v));
        afirmar('una fila vieja ("Daniel") también', esElMismo('Daniel', v));
        afirmar('no le importan las mayúsculas', esElMismo('  DANIEL MORALES ', v));
        afirmar('otro vecino NO es suyo', !esElMismo('Daniel Gómez', v));
        afirmar('una fila vacía no es de nadie', !esElMismo('', v));
        // Sin este caso, un vecino sin apellido cargado se llevaría puesta cualquier fila vacía.
        afirmar('y con el vecino sin apellido tampoco', !esElMismo('', { nombre: 'Daniel' }));
    }

    console.log('\n── LO QUE ESCRIBE EN LA BASE ──');
    {
        // Sin credenciales no se puede ejecutar, pero sí revisar que el código diga lo que tiene
        // que decir. Las dos cosas que no pueden perderse en un refactor.
        const SRC = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');
        const ini = SRC.indexOf('async function cambiarPasswordUsuario(');
        afirmar('existe cambiarPasswordUsuario', ini !== -1);
        const cuerpoFn = SRC.slice(ini, SRC.indexOf('async function ', ini + 10));
        afirmar('verifica la contraseña actual antes de escribir',
            cuerpoFn.indexOf('verificarPassword(') < cuerpoFn.indexOf('UPDATE usuarios SET password_hash'));
        afirmar('guarda un hash, nunca el texto', cuerpoFn.includes('hashPassword(nueva)'));

        const iniPerfil = SRC.indexOf('async function actualizarPerfilUsuario(');
        afirmar('existe actualizarPerfilUsuario', iniPerfil !== -1);
        const cuerpoPerfil = SRC.slice(iniPerfil, SRC.indexOf('async function ', iniPerfil + 10));
        afirmar('no deja tocar el email, que es con lo que lo vinculan a la unidad',
            !/SET[\s\S]*\bemail\s*=/.test(cuerpoPerfil));
    }

    server.close();
    console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
    process.exit(fallos === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
