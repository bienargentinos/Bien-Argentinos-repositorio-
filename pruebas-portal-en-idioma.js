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

    // Y lo mismo en el idioma del propietario, para que traducir no rompa el castellano.
    console.log('\n── Y EL PROPIETARIO LO SIGUE VIENDO EN CASTELLANO ──');
    const loginEs = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
    const rEs = await pedir('GET', '/vecino/pases', { cookie: loginEs.cookie });
    afirmar('responde', rEs.codigo === 200);
    afirmar('dice "Pases de invitación QR"', rEs.cuerpo.includes('Pases de invitación QR'));
    afirmar('y no quedó en portugués', !rEs.cuerpo.includes('Passes de visitante'));

    server.close();
    console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
    process.exit(fallos === 0 ? 0 : 1);
}

process.on('unhandledRejection', (e) => {
    console.error('\n✖ LA PRUEBA MISMA SE CAYÓ (no es una afirmación que falló):');
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
});
