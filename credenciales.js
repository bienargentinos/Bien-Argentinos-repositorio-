/**
 * LAS CONTRASEÑAS NO VIVEN EN EL CÓDIGO
 *
 * > [!CAUTION]
 * > **`marcos2024` estaba escrita en SIETE lugares del repositorio, y protegía DOS cosas
 * > distintas**: la base de datos y el login del panel del dueño.
 *
 *     db-pg.js                        postgresql://marcos:marcos2024@…
 *     crear-backup.js                 la misma
 *     restaurar-backup.js             la misma
 *     setup-nocodb-postgres.sh        CREATE USER marcos WITH PASSWORD '…'
 *     docs/facturas-relevamiento.md   PGPASSWORD=…
 *     dashboard.js                    ADMIN_PASS = process.env.DASHBOARD_PASS || '…'
 *     CLAUDE.md                       "Usuario dueño: admin / …"
 *
 * Y el repositorio **se hace público cada vez que se usa el `curl`** de CLAUDE.md para bajar
 * archivos al VPS. O sea que durante ese rato, cualquiera que lo leyera tenía el panel --donde se
 * ven todos los edificios, clientes, eventos y facturas-- y la base de datos directo.
 *
 * Lo dice el propio CLAUDE.md, en la primera pantalla:
 *
 * > *"Ninguna credencial va en este archivo, ni en un comando, ni en un mensaje… Si alguna
 * > credencial se expone, cambiarla es lo único que la invalida: borrarla del archivo no la borra
 * > del historial de git ni de los logs."*
 *
 * Por eso este archivo **no arregla nada por sí solo**: sacar la contraseña del código es la mitad
 * fácil. La mitad que importa es cambiarla en PostgreSQL y en el panel, y eso lo hace una persona.
 *
 * ## Por qué falla CERRADO
 *
 * Es el mismo criterio de `clave-app.js`, y por la misma razón escrita en CLAUDE.md: de los dos
 * errores se elige el que se puede deshacer.
 *
 * - **Fallar abierto** = un panel de administración con la contraseña por defecto, publicada. No
 *   se deshace: para cuando te enteraste, ya entraron.
 * - **Fallar cerrado** = no podés entrar a tu propio panel hasta poner la variable. Se deshace en
 *   dos minutos con `nano .env`.
 *
 * Prueba: `node pruebas-credenciales.js`.
 */

'use strict';

/** Se avisa una vez por variable y no en cada pedido: si no, el log se vuelve ilegible. */
const yaAvisado = new Set();

function avisarUnaVez(clave, mensaje) {
    if (yaAvisado.has(clave)) return;
    yaAvisado.add(clave);
    console.error(mensaje);
}

/**
 * Una credencial del entorno. **Nunca devuelve un valor por defecto.**
 *
 * @param nombre  la variable de entorno.
 * @param paraQue qué protege, para que el aviso diga algo útil.
 * @returns el valor, o `''` si no está.
 */
function credencial(nombre, paraQue) {
    const v = String(process.env[nombre] || '').trim();
    if (!v) {
        avisarUnaVez(nombre,
            `\n🔑❌ FALTA ${nombre} en el .env — ${paraQue}.\n` +
            `   No hay valor por defecto a propósito: el que había (marcos2024) quedó publicado\n` +
            `   en el repositorio y en el historial de git.\n` +
            `   Arreglo:  nano /root/marcos/Consorcio-AI-Assistant/.env\n` +
            `   y después: pm2 restart marcos-ai\n`);
    }
    return v;
}

/**
 * La URL de PostgreSQL.
 *
 * Sin `DATABASE_URL` devuelve `''`, y el llamador no conecta. **Eso no mata a Marcos**: `datos.js`
 * ya tolera que PostgreSQL no conteste y se cae a Google Sheets, igual que cuando el servicio está
 * apagado. Se pierde el lado de PostgreSQL --portal del vecino, portería-- y se dice fuerte.
 */
function urlPostgres() {
    return credencial('DATABASE_URL', 'sin ella no se puede hablar con PostgreSQL');
}

/**
 * Usuario y contraseña del panel del dueño.
 *
 * > [!CAUTION]
 * > **Sin `DASHBOARD_PASS` no entra nadie, ni siquiera vos.** Es deliberado: un panel donde se ven
 * > todos los edificios, clientes, eventos y facturas de once administradores no puede quedar con
 * > una contraseña conocida porque alguien se olvidó de configurarla.
 */
function credencialesPanel() {
    return {
        usuario: String(process.env.DASHBOARD_USER || 'admin').trim(),
        contrasena: credencial('DASHBOARD_PASS', 'sin ella no se puede entrar al panel del dueño'),
    };
}

/**
 * ¿Coincide la contraseña del panel?
 *
 * Devuelve `false` cuando no hay contraseña configurada, **incluso si quien intenta entra con el
 * campo vacío**. Sin este cuidado, "no hay contraseña" y "acertó la contraseña" serían lo mismo.
 */
function entraAlPanel(usuario, contrasena) {
    const esperado = credencialesPanel();
    if (!esperado.contrasena) return false;
    return String(usuario || '') === esperado.usuario
        && String(contrasena || '') === esperado.contrasena;
}

/**
 * El secreto que firma las cookies de sesión.
 *
 * > [!CAUTION]
 * > **Esto es más grave que la contraseña.** El secreto firma la cookie; quien lo conoce se
 * > fabrica una que diga `{authed:true, role:'dueno'}` y **entra al panel sin contraseña ninguna**.
 * > Rotar la contraseña no lo detiene.
 *
 * Lo que había, los dos escritos en el código de un repositorio que se hace público:
 *
 *     dashboard.js        'marcos-secret-cambiar-en-produccion-2024'
 *     portal-vecino.js    'secret'
 *
 * El del portal del vecino es el que más duele: con una sesión de vecino falsificada se abre la
 * puerta de calle, que es justo lo que `apertura-remota.js` autoriza.
 *
 * ## Por qué acá NO se falla cerrado
 *
 * En `entraAlPanel` fallar cerrado cuesta dos minutos de `nano .env`. Acá cortar el arranque
 * mataría a Marcos entero --el panel corre adentro del mismo proceso--, y eso es peor que el
 * problema. Pero seguir con un secreto conocido es inaceptable.
 *
 * La salida es la tercera: **sin `DASHBOARD_SECRET` se genera uno al azar en el arranque.** Nadie
 * puede falsificar una cookie, y el único costo es que las sesiones no sobreviven a un reinicio de
 * PM2 --hay que volver a entrar--. Molesto y visible, que es exactamente lo que se quiere: molesta
 * hasta que alguien pone la variable.
 */
let secretoAlAzar = null;

function secretoDeSesion() {
    const v = String(process.env.DASHBOARD_SECRET || '').trim();
    if (v) return v;

    if (!secretoAlAzar) {
        secretoAlAzar = require('crypto').randomBytes(32).toString('base64url');
        avisarUnaVez('DASHBOARD_SECRET',
            `\n🔑⚠️  FALTA DASHBOARD_SECRET en el .env.\n` +
            `   Se generó uno al azar para esta corrida: nadie puede falsificar una sesión, pero\n` +
            `   TODOS tienen que volver a entrar en cada reinicio de PM2.\n` +
            `   El que había estaba escrito en el código, y con él se fabrica una cookie de dueño\n` +
            `   sin saber ninguna contraseña.\n` +
            `   Arreglo:  nano /root/marcos/Consorcio-AI-Assistant/.env\n` +
            `   Generarlo:  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"\n`);
    }
    return secretoAlAzar;
}

module.exports = { credencial, urlPostgres, credencialesPanel, entraAlPanel, secretoDeSesion };
