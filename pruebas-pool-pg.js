// Una conexión ociosa que se cae NO puede matar a Marcos.
//
//   node pruebas-pool-pg.js
//
// > [!CAUTION]
// > **`pg` emite `'error'` en el Pool cuando una conexión que estaba quieta se cae sola**, y un
// > evento `'error'` sin oyente en un EventEmitter de Node **se tira como excepción**. No pasa por
// > ningún `try`: no hay ninguna consulta en curso.
//
// De ahí en adelante manda el `uncaughtException` de `index.js`, que loguea y SALE a propósito. Así
// que un PostgreSQL que se reinicia --o un firewall que se olvida de una conexión quieta-- reiniciaba
// a Marcos en mitad de una conversación. Es el episodio que ya está en CLAUDE.md con otro
// disparador.
//
// Cómo apareció: el CI en rojo con `read ECONNRESET` en `pruebas-perfil-vecino.js`, que no necesita
// la base. La prueba imprimía la mitad de sus líneas y desaparecía sin decir por qué. Local pasaba,
// porque ahí el error es `ECONNREFUSED` al conectar y ese sí cae adentro del `try` de la consulta.
//
// Esta prueba no lee el código: emite en el pool de verdad el mismo evento que emite `pg`, y mira
// si el proceso sobrevive. Un candado que busque `pool.on('error')` como texto lo pasaría cualquier
// línea comentada.

const net = require('net');

let fallos = 0;
function afirmar(titulo, cond) {
    const ok = !!cond;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
}

// Un PostgreSQL que acepta la conexión y la corta de una. Es lo que hace un servidor que se
// reinicia, y lo que hacía el runner del CI.
function servidorQueCorta() {
    return new Promise((resolve) => {
        const srv = net.createServer((socket) => socket.destroy());
        srv.listen(0, '127.0.0.1', () => resolve({ srv, puerto: srv.address().port }));
    });
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    const { srv, puerto } = await servidorQueCorta();

    // El pool de `db-pg.js` sale de `credenciales.urlPostgres()`, que lee esta variable. Apuntándolo
    // al servidor falso se prueba EL pool de verdad, no uno de juguete escrito acá.
    // SIN usuario ni contraseña en la URL, aunque sean inventados: `pruebas-credenciales.js`
    // prohíbe que aparezca una URL de PostgreSQL con credencial adentro en CUALQUIER archivo del
    // repo, y tiene razón --así se filtró la contraseña de verdad--. Una de mentira en una prueba
    // le enseña al candado a tolerar la forma, y la próxima pasa igual.
    process.env.DATABASE_URL = `postgresql://127.0.0.1:${puerto}/nada`;

    console.log('\n── EL POOL TIENE QUIÉN LE ESCUCHE LOS ERRORES ──');
    const { pool } = require('./db-pg');
    afirmar('hay un oyente de "error" en el pool', pool.listenerCount('error') > 0);

    console.log('\n── EL EVENTO QUE MATABA EL PROCESO ──');
    // Así se reproduce de verdad. `pg` hace exactamente esto cuando un cliente ocioso se cae:
    // `pool.emit('error', err, client)`. Y un `emit('error')` sin oyente en un EventEmitter de Node
    // TIRA el error de forma sincrónica, así que sin el arreglo este `try` no alcanza para nada --el
    // proceso se muere acá mismo y la prueba no imprime una línea más--.
    //
    // No se simula con un socket cortado: eso falla al CONECTAR, y `pg` manda esa falla a la promesa
    // de la consulta, donde sí hay un `catch`. El caso que importa es el otro, y es el que se veía
    // en el CI: un `read ECONNRESET` volcado como objeto, sin ninguna línea de nadie atrapándolo.
    let sobrevivio = false;
    try {
        const err = new Error('read ECONNRESET');
        err.code = 'ECONNRESET';
        pool.emit('error', err, null);
        sobrevivio = true;
    } catch (e) {
        // Con el oyente puesto no se llega acá nunca.
    }
    afirmar('un error del pool no tira el proceso', sobrevivio);

    // Y el pool sigue usable: descartó ese cliente, no se rompió.
    let contesta = false;
    try {
        await pool.query('SELECT 1');
    } catch (e) {
        contesta = true; // falla de nuevo --no hay base-- pero CONTESTA en vez de matar el proceso
    }
    afirmar('la consulta siguiente contesta', contesta);

    srv.close();
    await pool.end().catch(() => {});

    console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => {
    console.log(`\n❌ La prueba misma se cayó: ${e && e.message}\n`);
    process.exit(1);
});
