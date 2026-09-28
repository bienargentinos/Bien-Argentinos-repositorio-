/**
 * NINGÚN PASE QR SIN VENCIMIENTO, Y EL VECINO ELIGE HASTA CUÁNDO.
 *
 * Decisión de Daniel, 27/09: *"que el vecino elija hasta cuándo, con un máximo de 365 días"*.
 *
 * Antes un pase recurrente se creaba con `valido_hasta` en null y 999 usos: valía **para siempre**
 * dentro de su franja horaria. Eso es justo lo que el QR venía a resolver frente a una llave — el
 * código de quien dejó de venir hace ocho meses sigue abriendo hasta que alguien se acuerde de
 * revocarlo, y acordarse es lo que nunca pasa.
 *
 * Corre contra un PostgreSQL de VERDAD y no leyendo el código, porque acá lo que importa es qué
 * fecha termina guardada en la fila. Un candado de texto no puede ver eso: mide la intención.
 * De hecho, al escribir esto la prueba encontró un bug que el código "correcto" tenía adentro
 * (ver el caso "sin elegir fecha").
 *
 * Sin base NO falla --no se puede exigir PostgreSQL antes de cada push-- pero lo dice fuerte:
 *
 *   DATABASE_URL_PRUEBAS=postgres://... node pruebas-vencimiento-pase.js
 */
const url = process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL;
if (!url) {
    console.log('\n⚠️  SALTEADA: necesita un PostgreSQL y no hay ninguno configurado.');
    console.log('   Es la única que comprueba QUÉ FECHA queda guardada en el pase.');
    console.log('   Para correrla:  DATABASE_URL_PRUEBAS=postgres://... node pruebas-vencimiento-pase.js\n');
    process.exit(0);
}
process.env.DATABASE_URL = url;

const express = require('express');
const http = require('http');

let fallos = 0;
const afirmar = (titulo, cond) => {
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
    if (!cond) fallos++;
};

const DIA = 24 * 60 * 60 * 1000;
const app = express();
app.use('/vecino', require('./portal-vecino'));
const srv = app.listen(0, '127.0.0.1', main);

function pedir(metodo, ruta, { cookie, cuerpo, json } = {}) {
    return new Promise((res) => {
        const headers = { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded' };
        if (cookie) headers.Cookie = cookie;
        const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: ruta, method: metodo, headers }, (rs) => {
            let b = '';
            rs.on('data', (d) => { b += d; });
            rs.on('end', () => res({
                codigo: rs.statusCode,
                cuerpo: b,
                cookie: (rs.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ') || cookie,
            }));
        });
        if (cuerpo) req.write(cuerpo);
        req.end();
    });
}

async function main() {
    const { pool, MAX_DIAS_PASE } = require('./db-pg');
    await new Promise((r) => setTimeout(r, 2500));   // el esquema se aplica al cargar db-pg
    await pool.query('CREATE TABLE IF NOT EXISTS edificios (id SERIAL PRIMARY KEY, edificio VARCHAR(150), nombre VARCHAR(150))');
    await pool.query("INSERT INTO edificios (edificio) SELECT 'San Patricio 159' WHERE NOT EXISTS (SELECT 1 FROM edificios WHERE edificio='San Patricio 159')");

    const ses = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
    const fecha = (d) => new Date(Date.now() + d * DIA).toISOString().slice(0, 10);
    const crear = (extra) => pedir('POST', '/vecino/api/pases-qr', {
        cookie: ses.cookie, json: true,
        cuerpo: JSON.stringify(Object.assign(
            { nombre_invitado: 'PruebaVenc', motivo: 'Servicio', es_recurrente: true, dias_semana: ['Lunes'] }, extra)),
    });
    const diasDe = (d) => (d.pase ? Math.round((new Date(d.pase.valido_hasta) - Date.now()) / DIA) : null);

    console.log('\n── EL VECINO ELIGE, Y SE RESPETA ──');
    {
        const r = JSON.parse((await crear({ recurrente_hasta: fecha(90) })).cuerpo);
        const d = diasDe(r);
        afirmar('se guarda la fecha elegida', d !== null && d >= 90 && d <= 91);
    }

    console.log('\n── MÁS DEL TECHO SE RECHAZA, Y SE DICE POR QUÉ ──');
    {
        const res = await crear({ recurrente_hasta: fecha(MAX_DIAS_PASE + 100) });
        const r = JSON.parse(res.cuerpo);
        afirmar('no lo crea', res.codigo === 400 && !r.pase);
        // No alcanza con rechazar: el mensaje tiene que decir el limite, o el vecino prueba a ciegas.
        afirmar('el mensaje nombra el tope', !!r.error && r.error.includes(String(MAX_DIAS_PASE)));
    }

    console.log('\n── SIN ELEGIR FECHA NO QUEDA SIN VENCIMIENTO NI VENCE EN 2 HORAS ──');
    {
        // ESTE es el caso que encontró un bug de verdad. Los presets de validez (2h, 4h, el día)
        // son para una VISITA; un recurrente que heredaba "2h" vencía antes de que la persona
        // llegara el primer día, y el vecino veía un pase que no abre sin entender por que.
        const r = JSON.parse((await crear({ recurrente_hasta: '' })).cuerpo);
        const d = diasDe(r);
        afirmar('tiene vencimiento', !!r.pase && !!r.pase.valido_hasta);
        afirmar('y es el techo, no dos horas', d !== null && d >= MAX_DIAS_PASE - 1 && d <= MAX_DIAS_PASE);
    }

    console.log('\n── Y UNA VISITA NORMAL SIGUE SIENDO CORTA ──');
    {
        const res = await pedir('POST', '/vecino/api/pases-qr', {
            cookie: ses.cookie, json: true,
            cuerpo: JSON.stringify({ nombre_invitado: 'PruebaVenc', motivo: 'Visita', validez: '2h' }),
        });
        const r = JSON.parse(res.cuerpo);
        const horas = r.pase ? Math.round((new Date(r.pase.valido_hasta) - Date.now()) / 3600000) : null;
        afirmar('las 2 horas del preset no se tocaron', horas === 2);
    }

    console.log('\n── EL NÚMERO DEL TECHO ES UNO SOLO ──');
    {
        // La pantalla muestra un tope y el servidor aplica otro: el dia que alguien cambie uno,
        // el vecino elegiria una fecha que el servidor rechaza. Se interpola desde db-pg.js.
        const PV = require('fs').readFileSync(require('path').join(__dirname, 'portal-vecino.js'), 'utf8');
        afirmar('la pantalla lo toma de db-pg.js', /MAX_DIAS_PASE_UI\s*=\s*require\('\.\/db-pg'\)\.MAX_DIAS_PASE/.test(PV));
        afirmar('y no hay un 365 escrito a mano', !/MAX_DIAS_PASE\s*=\s*365/.test(PV));
    }

    await pool.query("DELETE FROM pases_qr WHERE nombre_invitado = 'PruebaVenc'");
    srv.close();
    await pool.end();
    console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
    process.exit(fallos === 0 ? 0 : 1);
}

process.on('unhandledRejection', (e) => {
    console.error('\n✖ LA PRUEBA MISMA SE CAYÓ:', e && e.message);
    process.exit(1);
});
