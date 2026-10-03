/**
 * EL RESPALDO TIENE QUE TENER LO QUE NO SE PUEDE RECONSTRUIR
 *
 * > [!CAUTION]
 * > **Lo peor de un backup incompleto no es que falte: es que parece que está.** Uno deja de
 * > preocuparse, y se entera el día que lo necesita.
 *
 * Eso es exactamente lo que había hasta el 20/09/2026. `crear-backup.js` guardaba el `.env` y las
 * credenciales de Google --bien-- y dejaba afuera las dos únicas cosas que existen en un solo
 * lugar del mundo:
 *
 * - **PostgreSQL**, que NO es un espejo de Sheets: `usuarios`, `usuario_unidades`,
 *   `reservas_amenities`, `timbres`, `pases_qr`, `eventos_acceso`, `mensajes`, `consejo`… el
 *   portal del vecino entero, la portería entera y todo el historial de chat.
 * - **`almacenamiento/`**, excluido a mano: todas las fotos, audios y facturas recibidas.
 *
 * El razonamiento escrito en el script era *"el código está en GitHub y los datos en Google
 * Sheets"*. La primera mitad es cierta. La segunda costó el sistema entero si el VPS se caía --y
 * el 30/08/2026 se cayó cuatro días--.
 *
 *     node pruebas-backup.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

const crear = fs.readFileSync(path.join(__dirname, 'crear-backup.js'), 'utf8');
const restaurar = fs.readFileSync(path.join(__dirname, 'restaurar-backup.js'), 'utf8');

// Los dos archivos CITAN el problema viejo en sus comentarios, a propósito. El candado mira el
// código, no la documentación — si no, explicar un bug lo haría reaparecer.
const soloCodigo = (txt) => txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const codCrear = soloCodigo(crear);
const codRestaurar = soloCodigo(restaurar);

console.log('\n💾 EL RESPALDO TIENE QUE TENER LO QUE NO SE PUEDE RECONSTRUIR\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) La base de datos entra al respaldo');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('se corre `pg_dump`', /execFileSync\(\s*'pg_dump'/.test(codCrear),
        'Sin esto el respaldo devuelve credenciales y ningún dato.');

    vale('con `--no-owner` y `--no-acl`', /--no-owner/.test(codCrear) && /--no-acl/.test(codCrear),
        'Sin eso, restaurar en un VPS limpio --donde los roles no existen-- falla en la primera línea.');

    vale('con `--clean --if-exists`', /--clean/.test(codCrear) && /--if-exists/.test(codCrear),
        'Para poder restaurar sobre una base que ya tiene el esquema creado.');

    vale('si `pg_dump` falla, el respaldo NO se arma',
        /catch[\s\S]{0,400}?NO SE PUDO VOLCAR POSTGRESQL[\s\S]{0,600}?process\.exit\(1\)/.test(crear),
        'Un respaldo al que le falta la base y parece completo es peor que ninguno.');

    // Antes esta prueba buscaba `process.env.DATABASE_URL` acá mismo. Ahora la credencial sale de
    // `credenciales.js`, que es el único lugar del proyecto que la lee — justamente para que no
    // haya tres archivos armando la conexión cada uno a su manera, como estaba.
    vale('la URL sale de `credenciales.js`, como `db-pg.js`',
        /require\('\.\/credenciales'\)\.urlPostgres\(\)/.test(codCrear),
        'Dos formas de conectarse es una de más.');

    vale('y no tiene ninguna contraseña escrita',
        !/postgresql:\/\/[^\s'"]+:[^\s'"@]+@/.test(codCrear),
        'Este archivo tenía la contraseña de PostgreSQL como valor por defecto.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) La multimedia también');
// ─────────────────────────────────────────────────────────────────────────────
{
    const exclusiones = (codCrear.match(/const excluidos = new Set\(\[([^\]]*)\]/) || [])[1] || '';

    vale('`almacenamiento` ya NO está excluido', !/almacenamiento/.test(exclusiones),
        `La lista de exclusiones dice: [${exclusiones.trim()}]`);

    vale('siguen excluidos `node_modules`, `.git` y `temp`',
        /node_modules/.test(exclusiones) && /\.git/.test(exclusiones) && /temp/.test(exclusiones),
        'Eso sí se puede regenerar y solo hace pesado el archivo.');

    vale('se verifica contando archivos, no buscando la carpeta',
        /startsWith\('almacenamiento\/'\)/.test(codCrear) && /archivosMultimedia/.test(codCrear),
        'Una carpeta vacía adentro del tar no prueba nada.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Se verifica que haya quedado adentro, y el volcado no se queda en disco');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('el volcado está entre los imprescindibles',
        /const imprescindibles = \[[^\]]*relDump/.test(codCrear),
        'Es el mismo control que ya existía para el .env: si no entró, el respaldo se borra.');

    vale('si falta algo, el archivo se borra',
        /EL RESPALDO NO SIRVE[\s\S]{0,400}?unlinkSync\(archivo\)/.test(crear));

    vale('el .sql temporal se borra después de verificar',
        (codCrear.match(/unlinkSync\(absDump\)/g) || []).length >= 2,
        'Es la base entera en texto plano: teléfonos, nombres y conversaciones. No se deja tirada.');

    vale('el .sql temporal vive en `backups/`, que está en .gitignore',
        /path\.join\('backups'/.test(codCrear),
        'Para que no pueda terminar en un commit.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) Restaurar: existe, y no miente sobre un respaldo viejo');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('existe `restaurar-backup.js`', fs.existsSync(path.join(__dirname, 'restaurar-backup.js')),
        'Un respaldo que nadie restauró nunca no es un respaldo: es un archivo.');

    vale('sin `--aplicar` no escribe nada',
        /if \(!APLICAR\)[\s\S]{0,600}?process\.exit\(0\)/.test(restaurar));

    vale('avisa cuando el respaldo no trae la base',
        /ESTE RESPALDO NO TIENE LA BASE DE DATOS/.test(restaurar),
        'Los anteriores al 20/09/2026 son así, y hay que decirlo cuando se los abra.');

    vale('no restaura encima de una base con datos sin confirmación',
        /LA BASE DE DESTINO YA TIENE DATOS/.test(restaurar) && /si-encima/.test(codRestaurar),
        'Restaurar sobre un Marcos vivo convierte un susto en un desastre.');

    vale('usa `ON_ERROR_STOP=1`', /ON_ERROR_STOP=1/.test(codRestaurar),
        'Sin eso psql sigue después de un error y deja la base a medias diciendo que anduvo.');

    vale('si la base falla, avisa que NO se arranque igual',
        /FALLÓ LA RESTAURACIÓN DE LA BASE[\s\S]{0,300}?process\.exit\(1\)/.test(restaurar));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) De verdad: un respaldo sin base se detecta al abrirlo');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Se arma un .tar.gz como los de antes --con .env y sin volcado-- y se comprueba que
    // `restaurar-backup.js` lo diga en vez de dar a entender que sirve.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bkp-'));
    try {
        fs.writeFileSync(path.join(tmp, '.env'), 'TOKEN=x\n');
        fs.writeFileSync(path.join(tmp, 'index.js'), '// x\n');
        const viejo = path.join(tmp, 'viejo.tar.gz');
        execFileSync('tar', ['-czf', viejo, '.env', 'index.js'], { cwd: tmp });

        // Con `spawnSync` y no `execFileSync`: los avisos graves salen por **stderr**, y
        // `execFileSync` devuelve solo stdout. La primera versión de esta prueba fallaba por eso,
        // con el código funcionando perfecto — que es la peor clase de prueba.
        const r = require('child_process').spawnSync('node',
            [path.join(__dirname, 'restaurar-backup.js'), viejo], { encoding: 'utf8' });
        const salida = (r.stdout || '') + (r.stderr || '');

        vale('lo abre y avisa que le falta la base',
            /NO TIENE LA BASE DE DATOS/.test(salida),
            salida.slice(-300));

        vale('y no escribió nada (seguía sin --aplicar)',
            !fs.existsSync(path.join(__dirname, 'index.js.restaurado')));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  De esto depende poder levantar Marcos si el VPS desaparece.\n');
    process.exit(1);
}
console.log('\n   💾 El respaldo lleva la base, la multimedia y las credenciales.\n');
