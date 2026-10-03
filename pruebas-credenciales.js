/**
 * NINGUNA CONTRASEÑA VIVE EN EL CÓDIGO
 *
 * > [!CAUTION]
 * > **`marcos2024` estaba escrita en SIETE lugares del repositorio y protegía DOS cosas
 * > distintas**: la base de datos y el login del panel del dueño.
 *
 * Y el repositorio **se hace público cada vez que se usa el `curl`** de CLAUDE.md para bajar
 * archivos al VPS. Durante ese rato, cualquiera que lo leyera tenía el panel --todos los
 * edificios, clientes, eventos y facturas de once administradores-- y la base directo.
 *
 * Lo decía el propio CLAUDE.md, en la primera pantalla, mientras la contraseña del panel estaba
 * escrita treinta líneas más abajo:
 *
 * > *"Ninguna credencial va en este archivo, ni en un comando, ni en un mensaje."*
 *
 * Este candado es para que no vuelva. **No prueba que el sistema sea seguro**: prueba que la
 * contraseña no está en el repo. Lo otro --rotarla-- lo hace una persona, y sin eso esto no sirve
 * de nada: borrarla del archivo no la borra del historial de git.
 *
 *     node pruebas-credenciales.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n🔑 NINGUNA CONTRASEÑA VIVE EN EL CÓDIGO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) CANDADO: ninguna contraseña escrita en ningún archivo del repo');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Se recorre TODO el repositorio, no una lista escrita a mano. Las listas a mano ya fallaron
    // dos veces acá: la del `node --check` del verificador --que no tenía `db-pg.js` y dejó pasar
    // un archivo roto a producción-- y la de "¿falta alguna función?".
    const saltar = new Set(['node_modules', '.git', 'backups', 'temp', 'almacenamiento', 'design']);
    const archivos = [];
    (function recorrer(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (saltar.has(e.name)) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p);
            else if (/\.(js|md|sh|sql|json|bat|yml|yaml)$/.test(e.name)) archivos.push(p);
        }
    })(__dirname);

    // Este archivo y `credenciales.js` la NOMBRAN a propósito, para explicar qué pasó. Explicar un
    // problema no puede ser lo que lo haga reaparecer.
    const explican = new Set(['pruebas-credenciales.js', 'credenciales.js']);

    const conClave = archivos
        .filter(p => !explican.has(path.basename(p)))
        .filter(p => /marcos2024/.test(fs.readFileSync(p, 'utf8')))
        .map(p => path.relative(__dirname, p));

    vale(`ningún archivo tiene la contraseña vieja (${archivos.length} revisados)`,
        conClave.length === 0,
        conClave.length ? `Todavía está en: ${conClave.join(', ')}` : '');

    // Lo general: cualquier credencial con forma de URL de conexión con contraseña adentro.
    const conUrl = archivos
        .filter(p => !explican.has(path.basename(p)))
        .filter(p => /postgresql:\/\/[^\s'"]+:[^\s'"@]+@/.test(fs.readFileSync(p, 'utf8')))
        .map(p => path.relative(__dirname, p));

    vale('ninguna URL de PostgreSQL con contraseña adentro',
        conUrl.length === 0,
        conUrl.length ? `Aparece en: ${conUrl.join(', ')}` : '');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Todo el mundo lee la credencial del mismo lugar');
// ─────────────────────────────────────────────────────────────────────────────
{
    const lee = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

    for (const f of ['db-pg.js', 'crear-backup.js', 'restaurar-backup.js']) {
        vale(`${f} usa \`urlPostgres()\``, /urlPostgres\(\)/.test(lee(f)),
            'Dos formas de armar la conexión es una de más.');
    }

    vale('dashboard.js usa `entraAlPanel`', /entraAlPanel\(/.test(lee('dashboard.js')));

    vale('y ya no existe la constante ADMIN_PASS',
        !/const ADMIN_PASS\s*=/.test(lee('dashboard.js')),
        'Era donde estaba escrita la contraseña por defecto.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Falla CERRADO: sin la variable, no entra nadie');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Se prueba de verdad, manipulando el entorno, y se deja como estaba al terminar.
    const antes = process.env.DASHBOARD_PASS;
    delete require.cache[require.resolve('./credenciales')];

    delete process.env.DASHBOARD_PASS;
    let cred = require('./credenciales');

    vale('sin DASHBOARD_PASS, no entra con la contraseña vieja',
        cred.entraAlPanel('admin', 'marcos2024') === false);

    vale('sin DASHBOARD_PASS, tampoco entra con el campo VACÍO',
        cred.entraAlPanel('admin', '') === false,
        'Sin este cuidado, "no hay contraseña" y "acertó" serían lo mismo. Es el agujero clásico.');

    vale('sin DASHBOARD_PASS, tampoco con undefined',
        cred.entraAlPanel('admin', undefined) === false);

    process.env.DASHBOARD_PASS = 'una-clave-de-prueba';
    delete require.cache[require.resolve('./credenciales')];
    cred = require('./credenciales');

    vale('con la variable puesta, entra la correcta',
        cred.entraAlPanel('admin', 'una-clave-de-prueba') === true);

    vale('y sigue sin entrar una equivocada',
        cred.entraAlPanel('admin', 'otra') === false);

    vale('ni con el usuario equivocado',
        cred.entraAlPanel('otro', 'una-clave-de-prueba') === false);

    if (antes === undefined) delete process.env.DASHBOARD_PASS;
    else process.env.DASHBOARD_PASS = antes;
    delete require.cache[require.resolve('./credenciales')];
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El cambio de contraseña desde el panel decía la verdad a medias');
// ─────────────────────────────────────────────────────────────────────────────
{
    const dash = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');

    vale('ya no escribe en ADMIN_PASS, que nadie leía',
        !/process\.env\.ADMIN_PASS\s*=/.test(dash),
        'Escribía en ADMIN_PASS y el login leía DASHBOARD_PASS: dos nombres para lo mismo.');

    vale('escribe en DASHBOARD_PASS, que es la que se lee',
        /process\.env\.DASHBOARD_PASS\s*=/.test(dash));

    vale('y avisa que no sobrevive al reinicio',
        /temporal: true/.test(dash) && /pr[óo]ximo reinicio/i.test(dash),
        '`process.env` vive en RAM y PM2 reinicia seguido. Devolver {ok:true} a secas era mentir.');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  El repositorio se hace público cada vez que se usa el curl de CLAUDE.md.\n');
    process.exit(1);
}
console.log('\n   🔑 Las contraseñas salen del .env y de ningún otro lado.');
console.log('      (Sacarlas del código es la mitad fácil: la vieja hay que ROTARLA.)\n');
