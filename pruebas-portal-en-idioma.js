// Las pantallas del portal, pedidas POR HTTP en el idioma del vecino.
//
//   node pruebas-portal-en-idioma.js
//
// POR QUÉ NO ALCANZA CON PROBAR EL DICCIONARIO. Que `idiomas.js` traduzca no sirve de nada si la
// pantalla no lo llama: la clave existe, `t()` devuelve el texto correcto, y el vecino igual ve
// castellano. Ese error no se ve leyendo el código --la pantalla está llena de texto suelto que
// parece normal-- y tampoco lo agarra una prueba del diccionario.
//
// Así que acá se levanta el portal de verdad, se entra como el huésped de demostración --que llega
// de Brasil, así que el portal le sale en portugués-- y se mira el HTML que le llega: tiene que
// traer las frases traducidas y NO las castellanas.
//
// Se agrega una fila por pantalla a medida que se traducen. Una pantalla que no está en esta tabla
// es una pantalla que todavía le sale en castellano a un huésped que no lo lee.

const express = require('express');
const http = require('http');

// Qué tiene que aparecer, y qué no puede quedar, por pantalla.
const PANTALLAS = [
    {
        ruta: '/vecino/pases',
        // El QR para entrar al edificio. Es la pantalla que un huésped extranjero necesita primero:
        // sin esto no entra a la casa donde va a dormir.
        traducido: ['Passes de visitante QR', 'Novo passe QR', 'Motivo da visita',
                    'Gerar o passe', 'Compartilhar no WhatsApp', 'Dias da semana', 'Seg', 'Qua'],
        castellano: ['Pases de Invitación QR', 'Nuevo Pase QR', 'Motivo de la Visita',
                     'Generar Pase', 'Compartir por WhatsApp', 'Días habilitados',
                     'Historial / Vencidos'],
    },
    {
        ruta: '/vecino/amenities',
        // Reservar la parrilla o el SUM. Un huésped lo usa, y acá hay plata de por medio: si no
        // entiende el arancel, reserva creyendo que es gratis.
        traducido: ['Reservar espaço comum', 'Nova reserva por horas', 'Escolha o espaço',
                    'Escolha a data', 'Confirmar a reserva', 'Minhas reservas',
                    'Motivo ou quantidade de pessoas'],
        castellano: ['Reserva de Amenities', 'Nueva Reserva por Horas', 'Elegí el espacio común',
                     'Elegí la fecha', 'Confirmar Reserva', 'Mis Reservas',
                     'Motivo / Cantidad de personas'],
    },
    {
        ruta: '/vecino/reclamos',
        // Avisar de algo roto. Un huésped que no puede explicar que se inundó el baño no avisa.
        traducido: ['Reparos e avarias', 'Avisar de algo quebrado', 'Tipo de problema',
                    'Onde está o problema', 'Enviar o aviso', 'Encanamento', 'Elevador'],
        castellano: ['Reclamos y Averías', 'Reportar Rotura', 'Rubro / Tipo de Problema',
                     'Ubicación del Problema', 'Enviar Reclamo a Marcos IA', 'Área Común'],
    },
    {
        ruta: '/vecino/chat',
        traducido: ['Marcos está online', 'Respondemos a qualquer hora', 'Escreva para o Marcos'],
        castellano: ['Marcos IA en Línea', 'Atención 24/7 activa', 'Escribile a Marcos IA'],
    },
    {
        ruta: '/vecino/novedades',
        // Tenía DOS avisos inventados escritos en el código, fechados "Hoy" y "Ayer". Un vecino
        // podía dejar de tomar agua un jueves por un aviso que nadie escribió.
        traducido: ['Avisos do prédio', 'Não há avisos'],
        castellano: ['Avisos del Edificio', 'Limpieza de tanques de agua',
                     'Ascensor principal en servicio', 'ServiElev'],
    },
    {
        ruta: '/vecino/integrantes',
        // Un huesped NO ve esta pantalla: la ruta lo manda al inicio, y esta bien --quien entra a
        // la unidad lo decide el propietario--. Asi que se prueba como propietario, cambiandole el
        // idioma desde el perfil: la via que Daniel pidio "por si falla la traduccion".
        rol: 'propietario',
        traducido: ['Adicionar alguém à unidade', 'Quem tem acesso', 'Hóspede por alguns dias',
                    'Datas da estadia', 'Chega', 'Sai'],
        castellano: ['Asignar a la Unidad', 'Integrantes Activos', 'Pase Huésped Turista',
                     'Fechas de Estadía del Huésped', 'Check-in', 'Check-out'],
    },
    {
        ruta: '/vecino/expensas',
        // Un huésped no ve esta pantalla (no paga las expensas), así que va como propietario.
        // Acá había un ALIAS DE CBU INVENTADO a partir del nombre del edificio: plata que se iba a
        // otra cuenta, y eso no se deshace.
        rol: 'propietario',
        traducido: ['Meu condomínio', 'Para transferir', 'Informar o pagamento do condomínio',
                    'Enviar o comprovante', 'Os comprovantes que enviei'],
        castellano: ['Mis Expensas', 'Datos para Transferencias', 'Informar Pago de Expensas',
                     'Enviar Comprobante a la Administración', 'Mis Comprobantes Informados',
                     'Banco Oficial del Consorcio', '.expensas'],
    },
];

let fallos = 0;
const afirmar = (titulo, cond) => {
    if (!cond) fallos++;
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
};

const app = express();
app.use('/vecino', require('./portal-vecino'));
const server = app.listen(0, '127.0.0.1', main);

function pedir(metodo, ruta, { cookie, cuerpo, json } = {}) {
    return new Promise((resolve, reject) => {
        const cabeceras = {};
        if (cuerpo) {
            cabeceras['Content-Type'] = json ? 'application/json' : 'application/x-www-form-urlencoded';
            cabeceras['Content-Length'] = Buffer.byteLength(cuerpo);
        }
        if (cookie) cabeceras['Cookie'] = cookie;
        // `agent: false`: sin esto el pedido siguiente reusa un socket que el servidor ya cerró y
        // llega un `read ECONNRESET`. Ya nos costó seis intentos de CI en otra prueba.
        const req = http.request(
            { host: '127.0.0.1', port: server.address().port, method: metodo, path: ruta,
              headers: cabeceras, agent: false },
            (res) => {
                let txt = '';
                res.on('data', (d) => { txt += d; });
                res.on('end', () => resolve({
                    codigo: res.statusCode,
                    cuerpo: txt,
                    cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '),
                }));
            });
        req.on('error', reject);
        if (cuerpo) req.write(cuerpo);
        req.end();
    });
}

async function main() {
    // El huésped de demostración viene de Brasil (`idioma: 'pt'` en `sesion-demo.js`).
    const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=turista' });

    // Y un propietario al que le cambiamos el idioma a portugués desde el perfil, para las
    // pantallas que un huésped no puede ver.
    const loginProp = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
    await pedir('POST', '/vecino/api/idioma', {
        cookie: loginProp.cookie, cuerpo: JSON.stringify({ idioma: 'pt' }), json: true,
    });

    for (const pantalla of PANTALLAS) {
        console.log(`\n── ${pantalla.ruta} EN PORTUGUÉS ──`);
        const cookie = pantalla.rol === 'propietario' ? loginProp.cookie : login.cookie;
        const r = await pedir('GET', pantalla.ruta, { cookie });
        afirmar(`responde (${r.codigo})`, r.codigo === 200);

        for (const frase of pantalla.traducido) {
            afirmar(`dice "${frase}"`, r.cuerpo.includes(frase));
        }
        for (const frase of pantalla.castellano) {
            afirmar(`ya no dice "${frase}"`, !r.cuerpo.includes(frase));
        }
    }

    // El pop-up también, que aparece encima de la pantalla de inicio.
    console.log('\n── EL POP-UP EN PORTUGUÉS ──');
    {
        const r = await pedir('GET', '/vecino/', { cookie: login.cookie });
        afirmar('el pop-up está', r.cuerpo.includes('id="popup-inicio"'));
        afirmar('en portugués', r.cuerpo.includes('Você sabia?')
                             || r.cuerpo.includes('Atenção'));
        afirmar('el botón de apagarlo también',
            r.cuerpo.includes('Não me mostrar mais isso'));
        afirmar('y no quedó en castellano', !r.cuerpo.includes('No mostrarme más estos avisos'));
    }

    // Y lo mismo en el idioma del propietario, para que traducir no rompa el castellano.
    console.log('\n── Y EL PROPIETARIO LO SIGUE VIENDO EN CASTELLANO ──');
    const loginEs = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
    const rEs = await pedir('GET', '/vecino/pases', { cookie: loginEs.cookie });
    afirmar('responde', rEs.codigo === 200);
    afirmar('dice "Pases de invitación QR"', rEs.cuerpo.includes('Pases de invitación QR'));
    afirmar('y no quedó en portugués', !rEs.cuerpo.includes('Passes de visitante'));

    console.log('\n── LA PANTALLA DE PASES NO PUEDE COLGARSE EN SILENCIO ──');
    {
        // CANDADO. Daniel vio "Cargando pases..." para siempre. El servidor SI mandaba el error
        // --contesta {ok:false, error} con 500-- y el navegador lo tiraba a la basura: el catch
        // estaba vacio y un ok:false no disparaba nada. Tres salidas mudas, una sola pantalla
        // colgada, y ninguna forma de saber por que.
        //
        // Es el mismo defecto anotado tres veces en CLAUDE.md: una falla que miente sobre si misma
        // cuesta mas que la falla.
        const fsP = require('fs');
        const pathP = require('path');
        const PV = fsP.readFileSync(pathP.join(__dirname, 'portal-vecino.js'), 'utf8');

        const m = PV.match(/async function cargarPases\(\)[\s\S]*?\n      }/);
        afirmar('existe cargarPases', !!m);
        const fn = m ? m[0] : '';

        // Lo que importa: que NINGUNA salida quede muda.
        afirmar('el catch ya no esta vacio', !/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(fn));
        afirmar('avisa cuando algo falla', /mostrarErrorPases\(/.test(fn));
        afirmar('un ok:false tambien avisa', /!data\.ok|!data \|\| !data\.ok/.test(fn));
        afirmar('y una respuesta que no es JSON tambien', /errorNoJson/.test(fn));

        const render = PV.match(/function mostrarErrorPases\(detalle\)[\s\S]*?\n      }/);
        afirmar('existe el que lo muestra', !!render);
        // SIN LOS COMENTARIOS. El comentario que explica esto NOMBRA innerHTML y esc, asi que
        // medir el texto crudo mide el comentario en lugar de la funcion -- que es exactamente el
        // error ya anotado en CLAUDE.md sobre pruebas-clave-app.js. Paso aca en la primera version
        // de este candado: dio rojo contra codigo correcto.
        const sinComentarios = (txt) => String(txt).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
        const rf = sinComentarios(render ? render[0] : '');
        afirmar('no pega el detalle del error en innerHTML', !/innerHTML/.test(rf));
        afirmar('lo pone como texto', /textContent = detalle/.test(rf));
        // Y ofrece salir del paso, no solo enterarse.
        afirmar('deja reintentar', /onclick = cargarPases/.test(rf));
        // `esc` en este archivo es interpolacion del SERVIDOR: en el navegador no existe, y usarla
        // haria fallar al propio manejador de errores.
        afirmar('no usa esc(), que en el navegador no existe', !/[^a-zA-Z]esc\(/.test(rf));

        // Los textos salen del diccionario, como todo lo que lee un vecino.
        const { textos, IDIOMAS } = require('./idiomas');
        for (const idioma of IDIOMAS) {
            const t = textos(idioma.codigo);
            for (const clave of ['pases.errorTitulo', 'pases.errorAyuda', 'pases.errorNoJson', 'pases.reintentar']) {
                const v = t(clave);
                afirmar(`${idioma.codigo}: ${clave} tiene texto`, !!v && v !== clave);
            }
        }
    }

    console.log('\n── CAMBIAR EL IDIOMA TIENE QUE QUEDAR ──');
    {
        // CANDADO. Daniel: "el idioma no lo cambia, no funciona". El endpoint guardaba en
        // req.session.vecino --que en la sesion de prueba NO EXISTE, porque getVecinoSession la
        // arma de cero en cada pedido-- y contestaba ok:true igual. La pantalla recargaba y volvia
        // al idioma anterior, sin un solo error en ningun lado.
        //
        // Se mide sobre la pagina SERVIDA despues de recargar, que es lo unico que prueba que el
        // cambio quedo. Un candado que leyera el codigo no habria visto nada: el codigo "guardaba".
        const ses = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });

        const r = await pedir('POST', '/vecino/api/idioma', {
            cookie: ses.cookie, json: true, cuerpo: JSON.stringify({ idioma: 'en' }),
        });
        afirmar('el cambio contesta bien', r.codigo === 200);

        const luego = await pedir('GET', '/vecino/', { cookie: ses.cookie });
        afirmar('y en el pedido SIGUIENTE la pagina viene en el idioma nuevo',
            /<html[^>]*lang="en"/.test(luego.cuerpo));
        // Y no solo el atributo: el texto tambien.
        const t = require('./idiomas').textos('en');
        afirmar('el texto tambien cambio', luego.cuerpo.includes(t('nav.inicio')));

        // Vuelve a castellano y tambien queda: no es que se haya quedado clavado en ingles.
        await pedir('POST', '/vecino/api/idioma', {
            cookie: ses.cookie, json: true, cuerpo: JSON.stringify({ idioma: 'es' }),
        });
        const volvio = await pedir('GET', '/vecino/', { cookie: ses.cookie });
        // El castellano se sirve como es-AR, no como "es": la primera version de este candado
        // exigia "es" exacto y dio rojo contra codigo correcto.
        afirmar('y se puede volver al castellano', /<html[^>]*lang="es-AR"/.test(volvio.cuerpo));

        // Sin sesion no hay donde guardarlo: decir que si seria repetir el mismo bug.
        const PV2 = require('fs').readFileSync(require('path').join(__dirname, 'portal-vecino.js'), 'utf8');
        const ep = PV2.match(/router\.post\('\/api\/idioma'[\s\S]*?\n}\);/);
        afirmar('existe el endpoint', !!ep);
        afirmar('sin sesion no contesta que si', !!ep && /if \(!req\.session\)/.test(ep[0]));
        afirmar('guarda en la sesion, no solo en el vecino', !!ep && /req\.session\.idioma = codigo/.test(ep[0]));
    }

    server.close();
    console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
    process.exit(fallos === 0 ? 0 : 1);
}

process.on('unhandledRejection', (e) => {
    console.error('\n✖ LA PRUEBA MISMA SE CAYÓ (no es una afirmación que falló):');
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
});
