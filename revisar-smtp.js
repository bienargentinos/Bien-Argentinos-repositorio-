#!/usr/bin/env node
// ¿Sale el mail? Prueba la conexión con el servidor de mail usando el mismo .env que Marcos.
//
//   node revisar-smtp.js                       # solo lee: muestra la configuración y prueba conectar
//   node revisar-smtp.js --enviar vos@mail.com # además manda UN mail de prueba a esa dirección
//
// PARA QUÉ. El hosting de mail.bienargentinos.com se da de baja, y el día que se cambie SMTP_* en
// el .env hay que poder saber en un minuto si anda, en vez de enterarse cuando una urgencia no le
// llega al administrador. `enviarEmail` falla en silencio: loguea y devuelve false.
//
// > [!CAUTION]
// > **No imprime la contraseña.** Del usuario y el remitente sí, porque hacen falta para ver si
// > están bien escritos, y no son secretos. Se puede pegar la salida en un chat.
//
// Sin --enviar no manda nada: `verify()` solo se conecta y se autentica.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const nodemailer = require('nodemailer');
const { configSmtp } = require('./smtp-config');

(async () => {
    const c = configSmtp();
    const t = c.transporte;

    console.log('\n── CONFIGURACIÓN (sale del .env) ──');
    console.log(`  host:      ${t.host}${c.hostPorDefecto ? '   ← valor por defecto, SMTP_HOST no está en el .env' : ''}`);
    console.log(`  puerto:    ${t.port}  (${t.secure ? 'TLS directo' : 'STARTTLS'})`);
    console.log(`  usuario:   ${t.auth.user || '(vacío)'}`);
    console.log(`  clave:     ${t.auth.pass ? 'está' : '(vacía)'}`);
    console.log(`  remitente: ${c.from || '(vacío)'}`);
    console.log(`  certificado del servidor: ${c.verificarCertificado ? 'se verifica' : 'NO se verifica (host viejo o SMTP_TLS_INSEGURO)'}`);

    if (c.problemas.length) {
        console.log('\n── PROBLEMAS ──');
        for (const p of c.problemas) console.log(`  🚨 ${p}`);
    }

    if (!t.auth.user || !t.auth.pass) {
        console.log('\n❌ Sin usuario o clave no se puede ni probar la conexión.\n');
        process.exit(1);
    }

    const transporter = nodemailer.createTransport(t);
    console.log('\n── CONEXIÓN ──');
    try {
        await transporter.verify();
        console.log(`  ✅ El servidor respondió y aceptó el usuario y la clave.`);
    } catch (e) {
        console.log(`  ❌ No conecta: ${e.message}`);
        if (/certificate|self.signed|CERT/i.test(e.message)) {
            console.log('     El certificado del servidor no verifica. Si es un proveedor serio, revisá el host;');
            console.log('     si es a propósito, SMTP_TLS_INSEGURO=1 lo apaga (y deja la clave expuesta a quien se meta en el medio).');
        }
        if (/wrong version number|ssl3_get_record/i.test(e.message)) {
            console.log('     Suele ser TLS directo contra un puerto STARTTLS (o al revés): revisá SMTP_PORT y SMTP_SECURE.');
        }
        console.log('');
        process.exit(1);
    }

    const i = process.argv.indexOf('--enviar');
    if (i !== -1) {
        const para = process.argv[i + 1];
        if (!para || !para.includes('@')) {
            console.log('\n❌ --enviar necesita una dirección: node revisar-smtp.js --enviar vos@mail.com\n');
            process.exit(1);
        }
        try {
            const info = await transporter.sendMail({
                from: `"Marcos IA" <${c.from}>`,
                to: para,
                subject: 'Prueba de mail de Marcos',
                text: 'Si leés esto, los avisos por mail a la Administración salen bien.',
            });
            console.log(`  ✅ Mail de prueba enviado a ${para} (${info.messageId}). Fijate que haya llegado, también en spam.`);
        } catch (e) {
            console.log(`  ❌ Conecta pero no manda: ${e.message}`);
            process.exit(1);
        }
    }
    console.log('');
})();
