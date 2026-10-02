/**
 * LA COLA DEL REGISTRO DE ACCESOS
 *
 * > [!CAUTION]
 * > **Un ingreso que no queda escrito es justo lo que `eventos_acceso` existe para evitar**, y la
 * > base se cae justo cuando se corta la luz o internet --que en Argentina es seguido--.
 *
 * Tiene su propia cola, separada de la de `cola-pg.js` que usa `datos.js`, por dos motivos:
 *
 * 1. **El orden no importa.** Un registro de auditoría es append-only: no hay una escritura vieja
 *    que pueda pisar a una nueva, que es el motivo de que la otra cola sea UNA y corra de a una.
 * 2. **No arrastra a `datos.js`**, que carga Google Sheets y pide credenciales. `db-pg.js` --que es
 *    quien encola-- no tiene por qué depender de eso, y una falla del SQL de acá (que se descarta
 *    gritando) no traba las copias de los casos de Marcos, ni al revés.
 *
 * Solo el servidor guarda en disco y retoma el archivo (`iniciar`, desde `index.js`). El archivo
 * trae IP, user-agent y fotos de seguridad: está en `.gitignore` y `reset-test.js` lo borra.
 */

const path = require('path');
const { crearColaPg } = require('./cola-pg');

const ARCHIVO = path.join(__dirname, 'cola-accesos-pendiente.json');

const cola = crearColaPg({
    archivo: ARCHIVO,
    ejecutar: async (item) => require('./db-pg').pool.query(item.sql, item.params || []),
});

module.exports = { cola, ARCHIVO };
