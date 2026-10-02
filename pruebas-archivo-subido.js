/**
 * LA EXTENSIÓN DE UN ARCHIVO SUBIDO NO LA ELIGE QUIEN LO SUBE.
 *
 * Las cinco subidas del proyecto hacían `path.extname(file.originalname)`, y ese nombre lo manda el
 * navegador. **Ninguna tenía `fileFilter`.** Lo que eso permitía, verificado contra las mismas
 * estáticas de producción (`index.js` sirve `almacenamiento/` entero en `/archivos`):
 *
 *     codigo HTTP : 200
 *     Content-Type: text/html; charset=UTF-8
 *     cuerpo      : <script>alert(document.domain)</script>
 *
 * Una página con el script de otro, servida desde **el mismo dominio** del portal y del panel. El
 * script corre con la sesión de quien la abra: puede pedirle al portal un pase QR o tocar el panel
 * como esa persona. No hace falta leer la cookie — alcanza con usarla. Y el guardia de
 * `expensa-privada.js` no lo tapa: solo mira los archivos que se llaman `expensa_*`.
 *
 * La regla queda en `archivo-subido.js`: **la extensión sale de una lista nuestra**, y lo que no
 * está en la lista se rechaza antes de escribir nada en el disco.
 */
const fs = require('fs');
const path = require('path');

let fallos = 0;
const afirmar = (titulo, cond) => {
    console.log(`  ${cond ? '✅' : '❌'} ${titulo}`);
    if (!cond) fallos++;
};

function soloCodigo(archivo) {
    return fs.readFileSync(archivo, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*|>)/.test(l))
        .join('\n');
}

async function main() {
    console.log('\n📎 LA EXTENSIÓN NO LA ELIGE QUIEN SUBE\n');

    const { IMAGENES, COMPROBANTES, extensionSegura } = require('./archivo-subido');

    console.log('La lista decide, no el nombre:');
    const caso = (mimetype, originalname, permitidos) => extensionSegura({ mimetype, originalname }, permitidos);

    afirmar('un JPEG pasa', caso('image/jpeg', 'foto.jpg', IMAGENES) === '.jpg');
    afirmar('un PNG pasa', caso('image/png', 'x.png', IMAGENES) === '.png');
    afirmar('una foto de iPhone (HEIC) pasa', caso('image/heic', 'IMG_1.HEIC', IMAGENES) === '.heic');

    // El caso que se verificó en producción.
    afirmar('un HTML se RECHAZA', caso('text/html', 'payload.html', IMAGENES) === null);
    // Un SVG se sirve como image/svg+xml y PUEDE ejecutar script: no entra aunque sea una imagen.
    afirmar('un SVG se RECHAZA (puede ejecutar script)', caso('image/svg+xml', 'x.svg', IMAGENES) === null);
    afirmar('un PDF no entra como foto de perfil', caso('application/pdf', 'c.pdf', IMAGENES) === null);
    afirmar('pero sí como comprobante', caso('application/pdf', 'c.pdf', COMPROBANTES) === '.pdf');

    // Algunos celulares mandan octet-stream con un JPEG legítimo: rechazarlo de plano rompería
    // subidas buenas, así que ahí se mira el nombre -- pero SOLO si está en la lista.
    console.log('\nCuando el navegador no declara el tipo:');
    afirmar('un JPEG sin tipo declarado se rescata',
        caso('application/octet-stream', 'foto.jpg', IMAGENES) === '.jpg');
    afirmar('pero un HTML sin tipo declarado NO',
        caso('application/octet-stream', 'payload.html', IMAGENES) === null);
    afirmar('ni un nombre sin extensión', caso('application/octet-stream', 'archivo', IMAGENES) === null);

    // ── Candado ───────────────────────────────────────────────────────────────────
    console.log('\nEl candado:');
    const portal = soloCodigo('portal-vecino.js');
    // Si alguien vuelve a nombrar un archivo con la extensión del navegador, el agujero vuelve.
    afirmar('portal-vecino.js ya no nombra archivos con path.extname(file.originalname)',
        !/path\.extname\(\s*file\.originalname/.test(portal));
    afirmar('las dos subidas tienen filtro de tipo',
        (portal.match(/fileFilter:\s*filtroDeSubida\(/g) || []).length === 2);
    // Un rechazo que contesta HTML en una ruta /api/ es el defecto que este repo ya pagó tres veces.
    afirmar('una subida rechazada contesta JSON, no HTML',
        /function conSubida\(/.test(portal) && (portal.match(/conSubida\(upload/g) || []).length === 3);
    afirmar('el avatar_url del cuerpo solo acepta una ruta de acá',
        /\/archivos\\\/avatares\\\/\[A-Za-z0-9_\.-\]\+\$/.test(portal) || /archivos\\\/avatares/.test(portal));

    // ── La subida de verdad, contra el servidor ───────────────────────────────────
    //
    // Los candados leen el código. Esto SUBE un archivo y mira qué queda en el disco, que es lo
    // único que puede decir si el agujero está cerrado.
    console.log('\nSubiendo de verdad:');
    const express = require('express');
    const http = require('http');
    const app = express();
    app.use('/vecino', require('./portal-vecino'));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));
    const puerto = srv.address().port;

    const dirAvatares = path.join(__dirname, 'almacenamiento', 'avatares');
    const antes = fs.existsSync(dirAvatares) ? fs.readdirSync(dirAvatares) : [];

    function subir(nombreArchivo, tipo, contenido) {
        return new Promise((res) => {
            const b = '----prueba' + Date.now();
            const cuerpo = Buffer.concat([
                Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="avatar"; filename="${nombreArchivo}"\r\nContent-Type: ${tipo}\r\n\r\n`),
                Buffer.from(contenido),
                Buffer.from(`\r\n--${b}--\r\n`)
            ]);
            const r = http.request({
                host: '127.0.0.1', port: puerto, path: '/vecino/api/perfil/avatar', method: 'POST',
                headers: { 'Content-Type': 'multipart/form-data; boundary=' + b, 'Content-Length': cuerpo.length }
            }, (resp) => {
                const t = [];
                resp.on('data', (d) => t.push(d));
                resp.on('end', () => res({ codigo: resp.statusCode, tipo: resp.headers['content-type'] || '', cuerpo: Buffer.concat(t).toString() }));
            });
            r.on('error', () => res({ codigo: 0, tipo: '', cuerpo: '' }));
            r.write(cuerpo); r.end();
        });
    }

    const malo = await subir('payload.html', 'text/html', '<script>alert(1)</script>');
    afirmar('el HTML se rechaza con 400', malo.codigo === 400);
    afirmar('y contesta JSON, no la página de error de Express', /application\/json/.test(malo.tipo));

    const ahora = fs.existsSync(dirAvatares) ? fs.readdirSync(dirAvatares) : [];
    const nuevos = ahora.filter((f) => !antes.includes(f));
    afirmar('NO quedó ningún archivo nuevo en el disco', nuevos.length === 0);
    afirmar('y ninguno con extensión ejecutable por el navegador',
        !ahora.some((f) => /\.(html?|svg|js|xht|xhtml|php)$/i.test(f)));

    // Un PNG mínimo y real.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
    const bueno = await subir('mi foto.PNG', 'image/png', png);
    afirmar('una imagen de verdad SÍ se acepta', bueno.codigo === 200);
    const trasBueno = fs.readdirSync(dirAvatares).filter((f) => !antes.includes(f));
    afirmar('y queda con la extensión que pusimos nosotros', trasBueno.some((f) => f.endsWith('.png')));

    for (const f of trasBueno) { try { fs.unlinkSync(path.join(dirAvatares, f)); } catch (_) {} }
    srv.close();
}

main()
    .catch((e) => { console.error('\n❌ La prueba se cayó:', e.message); fallos++; })
    .then(() => {
        console.log(fallos === 0
            ? '\n✅ TODO EN ORDEN: lo que se sube no puede elegir su extensión.\n'
            : `\n❌ ${fallos} fallo(s).\n`);
        process.exit(fallos === 0 ? 0 : 1);
    });
