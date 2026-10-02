// Pruebas del flujo de recuperación de contraseña por email (sin costo de WhatsApp)
//
//   node pruebas-recuperar-password.js
//

const express = require('express');
const http = require('http');
const {
    guardarTokenRecuperacion,
    validarTokenRecuperacion,
    restablecerPasswordConToken,
    verificarPassword
} = require('./db-pg');

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

function pedir(metodo, ruta, { cabeceras = {}, cuerpo } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { ...cabeceras };
        if (cuerpo && typeof cuerpo === 'object') {
            cuerpo = JSON.stringify(cuerpo);
            headers['Content-Type'] = 'application/json';
        }
        if (cuerpo) {
            headers['Content-Length'] = Buffer.byteLength(cuerpo);
        }
        const req = http.request(
            { host: '127.0.0.1', port: server.address().port, method: metodo, path: ruta,
              headers, agent: false },
            (res) => {
                let txt = '';
                res.on('data', (d) => { txt += d; });
                res.on('end', () => resolve({
                    codigo: res.statusCode, cuerpo: txt,
                    headers: res.headers,
                }));
            });
        req.on('error', reject);
        if (cuerpo) req.write(cuerpo);
        req.end();
    });
}

async function main() {
    console.log('\n── FUNCIONES DEL TOKEN DE RECUPERACIÓN (db-pg) ──');
    {
        const emailTest = 'vecinoprueba@consorcio.ai';
        const tokenTest = 'tok_test_1234567890abcdef';
        
        await guardarTokenRecuperacion(emailTest, tokenTest, 3600000);
        const u = await validarTokenRecuperacion(tokenTest);
        afirmar('encuentra el token recién guardado', !!u);
        verificar('el email coincide', u.email, emailTest);

        const invalido = await validarTokenRecuperacion('token_inventado_xyz');
        afirmar('un token inexistente devuelve null', invalido === null);

        // Restablecer contraseña
        const resCorta = await restablecerPasswordConToken(tokenTest, '123');
        afirmar('rechaza contraseña de menos de 6 caracteres', resCorta.ok === false);

        const resOk = await restablecerPasswordConToken(tokenTest, 'nuevaClaveSegura2026');
        afirmar('restablece la contraseña exitosamente', resOk.ok === true);

        // El token queda consumido y no puede usarse de nuevo
        const reuso = await validarTokenRecuperacion(tokenTest);
        afirmar('el token queda invalidado de un solo uso', reuso === null);
    }

    console.log('\n── ENDPOINT SOLICITAR RECUPERACIÓN (POST /vecino/api/solicitar-recuperacion) ──');
    {
        const rVacio = await pedir('POST', '/vecino/api/solicitar-recuperacion', { cuerpo: {} });
        verificar('rechaza pedido sin email', rVacio.codigo, 400);

        const rInvalido = await pedir('POST', '/vecino/api/solicitar-recuperacion', { cuerpo: { email: 'no-es-un-mail' } });
        verificar('rechaza email sin formato válido', rInvalido.codigo, 400);

        const rOk = await pedir('POST', '/vecino/api/solicitar-recuperacion', { cuerpo: { email: 'daniel@consorcio.ai' } });
        verificar('solicitud válida contesta 200', rOk.codigo, 200);
        const dataOk = JSON.parse(rOk.cuerpo);
        afirmar('informa éxito al usuario', dataOk.ok === true);
    }

    console.log('\n── PANTALLA RESTABLECER CONTRASEÑA (GET /vecino/recuperar-password) ──');
    {
        const rSinToken = await pedir('GET', '/vecino/recuperar-password');
        verificar('sin token responde 200 con aviso de inválido', rSinToken.codigo, 200);
        afirmar('muestra cartel de enlace no válido', rSinToken.cuerpo.includes('Enlace no válido o expirado'));

        const tokenValido = 'tok_http_test_987654321';
        await guardarTokenRecuperacion('usuario@ejemplo.com', tokenValido, 3600000);

        const rConToken = await pedir('GET', '/vecino/recuperar-password?token=' + tokenValido);
        verificar('con token válido responde 200', rConToken.codigo, 200);
        afirmar('ofrece el formulario para crear nueva contraseña', rConToken.cuerpo.includes('Crear Nueva Contraseña'));
        afirmar('tiene el campo de confirmación', rConToken.cuerpo.includes('inp-confirmar-pass'));
    }

    console.log('\n── ENDPOINT RESTABLECER (POST /vecino/api/restablecer-password) ──');
    {
        const tokenValido = 'tok_api_test_555555';
        await guardarTokenRecuperacion('cambio@ejemplo.com', tokenValido, 3600000);

        const rCorto = await pedir('POST', '/vecino/api/restablecer-password', {
            cuerpo: { token: tokenValido, password: '123' }
        });
        verificar('rechaza password corta', rCorto.codigo, 400);

        const rCambio = await pedir('POST', '/vecino/api/restablecer-password', {
            cuerpo: { token: tokenValido, password: 'MiClaveSecreta99' }
        });
        verificar('acepta cambio válido con 200', rCambio.codigo, 200);
        const data = JSON.parse(rCambio.cuerpo);
        afirmar('confirma ok: true', data.ok === true);

        // Reintento con mismo token
        const rReintento = await pedir('POST', '/vecino/api/restablecer-password', {
            cuerpo: { token: tokenValido, password: 'MiClaveSecreta99' }
        });
        verificar('no permite reusar el token ya consumido', rReintento.codigo, 400);
    }

    console.log('\n── ENDPOINT WHATSAPP PIN DESHABILITADO (CERO COSTOS META) ──');
    {
        const rPin = await pedir('POST', '/vecino/api/solicitar-pin', { cuerpo: { telefono: '1150542005' } });
        verificar('solicitar-pin responde 400 deshabilitado', rPin.codigo, 400);
        const dataPin = JSON.parse(rPin.cuerpo);
        afirmar('explica que WhatsApp PIN fue deshabilitado', dataPin.error.includes('deshabilitado'));
    }

    server.close();

    if (fallos > 0) {
        console.log(`\n❌ ${fallos} fallo(s)`);
        process.exit(1);
    } else {
        console.log('\n✅ Todo bien');
        process.exit(0);
    }
}
