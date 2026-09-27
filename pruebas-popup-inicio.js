// El pop-up de la pantalla de inicio, y sus DOS salidas.
//
//   node pruebas-popup-inicio.js
//
// Pedido de Daniel: la cruz de cerrar arriba, y en otra parte del mismo pop-up el botón de
// apagarlo. Son dos cosas distintas a propósito:
//
//   - CERRAR: no lo quiero ver AHORA. Vuelve mañana.
//   - NO MOSTRAR MÁS: no lo quiero ver NUNCA. Queda guardado en la ficha de la persona.
//
// Con una sola salida, el vecino tendría que elegir entre aguantárselo todos los días o perderse
// un aviso urgente para siempre.
//
// Y se apaga desde DOS lados que no se pisan: el vecino para sí, y el administrador del consorcio
// para todo su edificio. Si el administrador lo vuelve a prender, el vecino que lo había apagado
// sigue sin verlo — su decisión no se la borra nadie.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { textos } = require('./idiomas');

let fallos = 0;
const afirmar = (titulo, cond) => {
    if (!cond) fallos++;
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
};
const verificar = (titulo, real, esperado) => {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
};

const app = express();
app.use('/vecino', require('./portal-vecino'));
const server = app.listen(0, '127.0.0.1', main);

function pedir(metodo, ruta, { cookie, cuerpo } = {}) {
    return new Promise((resolve, reject) => {
        const cabeceras = {};
        if (cuerpo) {
            cabeceras['Content-Type'] = 'application/x-www-form-urlencoded';
            cabeceras['Content-Length'] = Buffer.byteLength(cuerpo);
        }
        if (cookie) cabeceras['Cookie'] = cookie;
        const req = http.request(
            { host: '127.0.0.1', port: server.address().port, method: metodo, path: ruta,
              headers: cabeceras, agent: false },
            (res) => {
                let txt = '';
                res.on('data', (d) => { txt += d; });
                res.on('end', () => resolve({
                    codigo: res.statusCode, cuerpo: txt,
                    cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '),
                }));
            });
        req.on('error', reject);
        if (cuerpo) req.write(cuerpo);
        req.end();
    });
}

async function main() {
    const PORTAL = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');
    const t = textos('es');

    console.log('\n── APARECE EN EL INICIO, CON LAS DOS SALIDAS ──');
    const login = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
    const inicio = await pedir('GET', '/vecino/', { cookie: login.cookie });
    verificar('el inicio responde', inicio.codigo, 200);
    afirmar('el pop-up está en la pantalla', inicio.cuerpo.includes('id="popup-inicio"'));
    afirmar('tiene la cruz de cerrar', inicio.cuerpo.includes('cerrarPopup()'));
    afirmar('y APARTE el botón de apagarlo', inicio.cuerpo.includes('apagarPopup()'));
    afirmar('dice dónde se vuelve a prender', inicio.cuerpo.includes(t('pop.noMostrarMasAyuda')));
    // Sin un aviso urgente muestra un consejo, no una pantalla vacía ni un anuncio inventado.
    afirmar('sin aviso urgente muestra un consejo', inicio.cuerpo.includes(t('pop.tipTitulo')));

    console.log('\n── CERRAR NO ES APAGAR ──');
    {
        const r = await pedir('POST', '/vecino/api/popup-cerrar', { cookie: login.cookie });
        verificar('cerrar contesta bien', r.codigo, 200);
        const otra = await pedir('GET', '/vecino/', { cookie: login.cookie });
        afirmar('ya no aparece en esta sesión', !otra.cuerpo.includes('id="popup-inicio"'));

        // Y en una sesión nueva vuelve: cerrar era "no ahora", no "nunca".
        const login2 = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
        const inicio2 = await pedir('GET', '/vecino/', { cookie: login2.cookie });
        afirmar('en una sesión nueva vuelve', inicio2.cuerpo.includes('id="popup-inicio"'));
    }

    console.log('\n── EL BOTÓN DE APAGAR CONTESTA Y EXPLICA ──');
    {
        const login3 = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
        const r = await pedir('POST', '/vecino/api/popup-apagar', { cookie: login3.cookie });
        verificar('contesta 200', r.codigo, 200);
        const d = JSON.parse(r.cuerpo);
        afirmar('dice que quedó apagado', !!d.ok && String(d.mensaje || '').length > 5);
        // La sesión de demostración no tiene fila en la base: se contesta bien igual, sin escribir
        // en la ficha de nadie. El vecino de la demo aprieta el botón y ve que funciona.
        afirmar('en la demo no escribe en la base', d.demo === true);
    }

    console.log('\n── MI PERFIL LO VUELVE A PRENDER ──');
    {
        const login4 = await pedir('POST', '/vecino/auth', { cuerpo: 'rol=propietario' });
        const perfil = await pedir('GET', '/vecino/perfil', { cookie: login4.cookie });
        verificar('el perfil responde', perfil.codigo, 200);
        afirmar('tiene el interruptor', perfil.cuerpo.includes(t('popup.tituloPerfil')));
        afirmar('con las dos opciones', perfil.cuerpo.includes('elegirPopup(true)')
                                    && perfil.cuerpo.includes('elegirPopup(false)'));
        const r = await pedir('POST', '/vecino/api/popup-prender', { cookie: login4.cookie });
        verificar('prender contesta bien', r.codigo, 200);
    }

    console.log('\n── LO URGENTE VA PRIMERO, Y NO SE INVENTA PUBLICIDAD ──');
    {
        const m = PORTAL.match(/function contenidoDelPopup[\s\S]*?\n}/);
        afirmar('existe contenidoDelPopup', !!m);
        const contenidoDelPopup = new Function(
            'avisos', 't',
            m[0].replace('function contenidoDelPopup(avisos, t, hoy = new Date()) {', '') .replace(/\n}$/, '')
                .replace(/const consejo = consejoDelDia\(hoy\);/, "const consejo = { clave: 'pop.tip.pase', icono: 'x', ruta: '/y' };")
        );

        const conUrgente = contenidoDelPopup([
            { clase: 'aviso', urgente: false, titulo: 'Fumigación', texto: 'el martes' },
            { clase: 'aviso', urgente: true, titulo: 'Ascensor suspendido', texto: 'hasta el jueves' },
        ], t);
        verificar('con un aviso urgente, gana el urgente', conUrgente.tipo, 'urgente');
        verificar('y es el urgente, no el primero de la lista', conUrgente.encabezado, 'Ascensor suspendido');

        const sinUrgente = contenidoDelPopup([{ clase: 'aviso', urgente: false, titulo: 'Fumigación' }], t);
        verificar('sin urgente, un consejo', sinUrgente.tipo, 'consejo');

        const sinNada = contenidoDelPopup([], t);
        verificar('sin nada, también un consejo', sinNada.tipo, 'consejo');

        // CANDADO. El lugar de la publicidad está preparado y VACÍO. Llenarlo con un anuncio de
        // mentira sería el mismo error que la tarjeta del $120.000, los dos avisos falsos de
        // Novedades y el alias de CBU fabricado: un dato que el vecino lee como cierto.
        const codigo = PORTAL.replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
        const iniConsejos = codigo.indexOf('const CONSEJOS_PORTAL');
        const finConsejos = codigo.indexOf('];', iniConsejos);
        const consejos = codigo.slice(iniConsejos, finConsejos);
        afirmar('los consejos apuntan a claves de idiomas, no a texto suelto',
            !/:\s*'[A-ZÁÉÍÓÚ]/.test(consejos));
        for (const clave of (consejos.match(/clave: '([^']+)'/g) || []).map(x => x.slice(8, -1))) {
            for (const idioma of ['es', 'en', 'pt', 'fr']) {
                const txt = textos(idioma)(clave);
                afirmar(`${idioma}: ${clave} tiene texto`, txt.length > 20 && txt !== clave);
            }
        }
    }

    console.log('\n── EL CONSEJO ROTA POR DÍA, NO AL AZAR ──');
    {
        const m = PORTAL.match(/function consejoDelDia[\s\S]*?\n}/);
        afirmar('existe consejoDelDia', !!m);
        // Con `Math.random()` el mismo vecino puede ver el mismo consejo tres veces seguidas y otro
        // nunca. Y además la pantalla cambiaría sola al recargar.
        afirmar('NO usa Math.random', !/Math\.random/.test(m[0]));

        const CONSEJOS = (PORTAL.match(/clave: '(pop\.tip\.[^']+)'/g) || []).length;
        afirmar('hay más de un consejo', CONSEJOS > 1);

        const consejoDelDia = new Function('hoy', 'CONSEJOS_PORTAL',
            m[0].replace('function consejoDelDia(hoy = new Date()) {', '').replace(/\n}$/, ''));
        const falsos = Array.from({ length: CONSEJOS }, (_, i) => ({ n: i }));
        const unDia = consejoDelDia(new Date(2026, 8, 27), falsos);
        const elMismoDia = consejoDelDia(new Date(2026, 8, 27), falsos);
        verificar('el mismo día da el mismo consejo', unDia, elMismoDia);
        const otroDia = consejoDelDia(new Date(2026, 8, 28), falsos);
        afirmar('otro día da otro', JSON.stringify(otroDia) !== JSON.stringify(unDia));
    }

    console.log('\n── LAS DOS DECISIONES NO SE PISAN ──');
    {
        // CANDADO. El vecino y el administrador apagan por lados distintos, y por eso son dos
        // columnas. Con una sola, el administrador prendiéndolo para el edificio le borraría al
        // vecino su decisión de no verlo.
        const DB = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');
        afirmar('el vecino tiene su columna', /usuarios ADD COLUMN IF NOT EXISTS popup_activo/.test(DB));
        afirmar('el edificio tiene la suya', /CREATE TABLE IF NOT EXISTS portal_config/.test(DB));
        const m = DB.match(/async function puedeVerPopup[\s\S]*?\n}/);
        afirmar('existe puedeVerPopup', !!m);
        afirmar('mira las dos', /FROM usuarios/.test(m[0]) && /FROM portal_config/.test(m[0]));
        afirmar('alcanza con que una diga que no', (m[0].match(/return false/g) || []).length >= 2);
        // Sin poder saberlo NO se muestra: un pop-up que vuelve después de que alguien lo apagó le
        // enseña al vecino que el botón no sirve.
        afirmar('si la base falla, no se muestra', /catch[\s\S]*?return false/.test(m[0]));
        // El edificio se compara con la regla de siempre: el 270 no es el 159.
        afirmar('compara el edificio con mismoEdificio', /mismoEdificio/.test(m[0]));
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
