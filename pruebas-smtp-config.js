// Verifica cómo se arma la conexión con el servidor de mail.
//
//   node pruebas-smtp-config.js
//
// POR QUÉ. El hosting de mail.bienargentinos.com se da de baja. El código tenía tres cosas que
// hacían fallar la mudanza en silencio: el host viejo como valor por defecto, `secure: true` fijo
// (rompe cualquier proveedor en el 587) y la verificación del certificado apagada para todos.
// Se prueba con datos: `configSmtp` es pura y no abre ninguna conexión.

const fs = require('fs');
const path = require('path');
const { configSmtp } = require('./smtp-config');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}
const hay = (c, texto) => c.problemas.some(p => p.includes(texto));
const CRED = { SMTP_USER: 'avisos@bienargentinos.com.ar', SMTP_PASS: 'x' };

console.log('\n── LO QUE ANDA HOY NO SE ROMPE ──');
{
    // El .env del VPS puede no tener SMTP_HOST. Sacar el valor por defecto cortaría el mail hoy.
    const c = configSmtp({ ...CRED });
    verificar('sin SMTP_HOST sigue yendo al host viejo', c.transporte.host, 'mail.bienargentinos.com');
    verificar('en el 465 con TLS directo, como antes', [c.transporte.port, c.transporte.secure], [465, true]);
    verificar('sin verificar el certificado de Ferozo, como antes', c.verificarCertificado, false);
    verificar('pero lo dice', hay(c, 'se da de baja'), true);
    verificar('y marca que es el valor por defecto', c.hostPorDefecto, true);
    const escrito = configSmtp({ ...CRED, SMTP_HOST: 'mail.bienargentinos.com' });
    verificar('escrito a mano, también avisa', hay(escrito, 'se da de baja'), true);
    verificar('un servidor de Ferozo cuenta como el viejo', configSmtp({ ...CRED, SMTP_HOST: 'c1234.ferozo.com' }).verificarCertificado, false);
}

console.log('\n── UN PROVEEDOR NUEVO EN EL 587 ──');
{
    const c = configSmtp({ ...CRED, SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587' });
    verificar('587 va con STARTTLS, no TLS directo', c.transporte.secure, false);
    verificar('el certificado se verifica', c.transporte.tls.rejectUnauthorized, true);
    verificar('no hay problemas que avisar', c.problemas, []);
    verificar('SMTP_SECURE=true con el 587 se avisa',
        hay(configSmtp({ ...CRED, SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_SECURE: 'true' }), 'STARTTLS'), true);
    verificar('SMTP_SECURE puede forzar TLS directo en otro puerto',
        configSmtp({ ...CRED, SMTP_HOST: 'x.com', SMTP_PORT: '2465', SMTP_SECURE: '1' }).transporte.secure, true);
    verificar('un proveedor nuevo en el 465 sigue con TLS directo',
        configSmtp({ ...CRED, SMTP_HOST: 'smtp.x.com', SMTP_PORT: '465' }).transporte.secure, true);
    verificar('SMTP_TLS_INSEGURO=1 apaga la verificación a pedido',
        configSmtp({ ...CRED, SMTP_HOST: 'smtp.x.com', SMTP_TLS_INSEGURO: '1' }).verificarCertificado, false);
    verificar('un dominio que solo CONTIENE bienargentinos no es el viejo',
        configSmtp({ ...CRED, SMTP_HOST: 'smtp.bienargentinos.com.evil.net' }).verificarCertificado, true);
}

console.log('\n── EL REMITENTE ──');
{
    verificar('sin SMTP_FROM es SMTP_USER', configSmtp({ ...CRED, SMTP_HOST: 'a.com' }).from, CRED.SMTP_USER);
    const brevo = configSmtp({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_USER: '7a1b2c001', SMTP_PASS: 'x' });
    verificar('un usuario que no es un mail se avisa', hay(brevo, 'SMTP_FROM'), true);
    const conFrom = configSmtp({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_USER: '7a1b2c001', SMTP_PASS: 'x', SMTP_FROM: 'avisos@bienargentinos.com.ar' });
    verificar('con SMTP_FROM sale de ahí', conFrom.from, 'avisos@bienargentinos.com.ar');
    verificar('y ya no avisa', conFrom.problemas, []);
}

console.log('\n── SIN CREDENCIALES ──');
verificar('se avisa', hay(configSmtp({ SMTP_HOST: 'a.com' }), 'SMTP_USER o SMTP_PASS'), true);

console.log('\n── CANDADO: NADIE VUELVE A ARMAR EL TRANSPORTE A MANO ──');
{
    const codigo = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
        .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    const admin = codigo('agentes/marcos-admin.js');
    verificar('marcos-admin.js no escribe el host viejo', /mail\.bienargentinos\.com/.test(admin), false);
    verificar('ni apaga el certificado por su cuenta', /rejectUnauthorized\s*:\s*false/.test(admin), false);
    verificar('ni fija secure: true', /secure\s*:\s*true/.test(admin), false);
    verificar('usa configSmtp', /configSmtp\(/.test(admin), true);
    verificar('index.js verifica el mail al arrancar', /verificarSmtp\(\)/.test(codigo('index.js')), true);
}

console.log(fallos ? `\n❌ ${fallos} fallo(s).` : '\n✅ Todo en orden.');
process.exit(fallos ? 1 : 0);
