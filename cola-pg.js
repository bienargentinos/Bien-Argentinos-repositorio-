/**
 * LA COPIA A POSTGRESQL QUE FALLA YA NO SE PIERDE
 *
 * > [!CAUTION]
 * > **`copiarAPg` disparaba y seguía: una escritura que fallaba quedaba en una línea del log y
 * > nadie la reintentaba nunca.** Y como el motor LEE PostgreSQL primero, lo que no llegó es lo
 * > que Marcos ve.
 *
 * Producción: el CASO-1001 se cerró justo mientras PostgreSQL rechazaba la contraseña. En la
 * planilla quedó `resuelto` y en PostgreSQL `nuevo`, y para Marcos el caso seguía abierto: se lo
 * podía elegir como caso activo del técnico o imputarle una factura. `emparejar-casos.js` limpia lo
 * que dejó esa caída. Esto evita la próxima.
 *
 * ## Cómo
 *
 * Cada copia deja de ser una función y pasa a ser un DATO: `{ descripcion, sql, params }` o
 * `{ descripcion, upsert: [tabla, clave, valores] }`. Una función no sobrevive a un `pm2
 * restart` --y PM2 reinicia seguido, más todavía cuando algo anda mal--; un dato se guarda en un
 * archivo y se retoma al arrancar.
 *
 * > [!CAUTION]
 * > **El orden importa más que el reintento.** Si el cierre de un caso falla y el UPDATE siguiente
 * > del mismo caso sí entra, reintentar el cierre DESPUÉS está bien; pero si fallara una escritura
 * > vieja y se reintentara después de una nueva, la vieja pisaría a la nueva: un caso resuelto
 * > volvería a quedar abierto. Por eso es UNA cola y corre de a una: mientras haya algo atrasado,
 * > lo nuevo espera detrás. Durante una caída eso no cuesta nada --igual no entra nada--.
 *
 * ## Qué se reintenta y qué no
 *
 * Solo lo que falló **por la conexión**: la base no contesta, rechaza la contraseña, se reinició,
 * no tiene conexiones libres. Eso se arregla solo, esperando.
 *
 * Lo que falló **por el SQL** --una columna que no existe, una restricción que no se cumple-- va a
 * fallar igual mil veces. Reintentarlo trabaría la cola entera detrás de algo que no se va a
 * arreglar esperando. Eso se descarta como antes, **pero gritado**: `[PG] ❌ … NO se reintenta`.
 *
 * ## Lo que esto NO resuelve
 *
 * - Si el proceso se muere en el instante entre que se pide la copia y se intenta por primera
 *   vez, se pierde, igual que antes. Solo se guarda en disco lo que ya falló una vez: escribir un
 *   archivo por cada copia sería un disco trabajando en cada mensaje para cubrir un caso rarísimo.
 * - Un INSERT que PostgreSQL llegó a escribir pero cuya respuesta se cortó en el camino se
 *   reintenta y queda dos veces. Hoy el único INSERT puro es el de `llamadas`; el resto son
 *   UPDATE o upsert, que repetidos dan lo mismo.
 * - Solo el servidor guarda y retoma el archivo (`iniciar`, desde `index.js`). Las herramientas
 *   sueltas (`revisar-*`, `emparejar-casos.js`) cargan `datos.js` y no deben ponerse a vaciar la
 *   cola del servidor en paralelo.
 */

const fs = require('fs');
const path = require('path');

const ARCHIVO_DEFAULT = path.join(__dirname, 'cola-pg-pendiente.json');
const MAX_PENDIENTES = 5000;
const ESPERAS_MS = [5e3, 15e3, 60e3, 3 * 60e3, 5 * 60e3];

// ¿La falla es de la conexión (se arregla esperando) o del SQL (no se arregla nunca)?
const CODIGOS_RED = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH']);
function esFallaDeConexion(err) {
    const code = String(err?.code || '');
    if (CODIGOS_RED.has(code)) return true;
    // SQLSTATE: 08 conexión, 28 autenticación (la caída del CASO-1001), 53 sin recursos,
    // 57P01-57P03 la base se está apagando o arrancando, 40001/40P01 conflicto entre transacciones.
    if (/^(08|28|53)/.test(code) || /^57P0[1-3]$/.test(code) || code === '40001' || code === '40P01') return true;
    return /timeout|Connection terminated|connect ECONN|Client has encountered a connection error/i.test(String(err?.message || ''));
}

function crearColaPg({ ejecutar, archivo = ARCHIVO_DEFAULT, log = console, esperas = ESPERAS_MS, programar = setTimeout } = {}) {
    let pendientes = [];
    let corriendo = false;
    let reintento = null;
    let fallosSeguidos = 0;
    let persistir = false;
    let atrasados = 0;   // cuántos de los que corrieron salieron de un reintento, para el aviso final
    let enCurso = null;  // la copia que se está ejecutando: fuera de `pendientes`, pero se guarda igual

    function guardar() {
        if (!persistir) return;
        try {
            // Solo hace falta el archivo si quedó algo que ya falló. Vacía, se borra.
            if (fallosSeguidos === 0 && !pendientes.length) {
                if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
            } else if (fallosSeguidos > 0) {
                fs.writeFileSync(archivo, JSON.stringify(enCurso ? [enCurso, ...pendientes] : pendientes));
            }
        } catch (e) {
            log.error(`[PG] ⚠️ No se pudo guardar la cola de copias atrasadas en ${archivo}: ${e.message}`);
        }
    }

    async function vaciar() {
        if (corriendo) return;
        corriendo = true;
        try {
            while (pendientes.length) {
                // Se saca de la lista ANTES de ejecutar: si `iniciar` agrega lo guardado mientras esta
                // corre, identificarla por su posición haría sacar otra y correr esta dos veces.
                const item = pendientes.shift();
                enCurso = item;
                try {
                    await ejecutar(item);
                    enCurso = null;
                    if (fallosSeguidos > 0) {
                        atrasados++;
                        guardar();   // un corte a mitad de la recuperación no repite lo que ya entró
                    }
                } catch (err) {
                    enCurso = null;
                    if (!esFallaDeConexion(err)) {
                        log.error(`[PG] ❌ No se pudo copiar ${item.descripcion}: ${err.message}. ` +
                            `Es un error del SQL, no de la conexión: NO se reintenta. Del lado de PostgreSQL falta este dato.`);
                        continue;
                    }
                    pendientes.unshift(item);   // vuelve adelante: es la más vieja
                    fallosSeguidos++;
                    const espera = esperas[Math.min(fallosSeguidos - 1, esperas.length - 1)];
                    log.warn(`[PG] ⏳ No se pudo copiar ${item.descripcion}: ${err.message}. ` +
                        `Queda en la cola (${pendientes.length} pendiente(s)); se reintenta en ${Math.round(espera / 1000)} s.`);
                    guardar();
                    reintento = programar(() => { reintento = null; vaciar(); }, espera);
                    if (reintento && typeof reintento.unref === 'function') reintento.unref();
                    return;
                }
            }
            if (fallosSeguidos > 0) {
                log.log(`[PG] ✅ PostgreSQL volvió: se pusieron al día ${atrasados} copia(s) atrasada(s).`);
                fallosSeguidos = 0;
                atrasados = 0;
            }
            guardar();
        } finally {
            corriendo = false;
        }
    }

    function encolar(item) {
        if (!item || !item.descripcion || !(item.sql || item.upsert)) {
            log.error(`[PG] ❌ Copia mal armada, no se puede encolar: ${JSON.stringify(item)?.slice(0, 200)}`);
            return;
        }
        pendientes.push(item);
        if (pendientes.length > MAX_PENDIENTES) {
            const tirada = pendientes.shift();
            log.error(`[PG] ❌ La cola de copias atrasadas pasó las ${MAX_PENDIENTES}: se descarta la más vieja (${tirada.descripcion}). ` +
                `Cuando PostgreSQL vuelva, corré node emparejar-casos.js.`);
        }
        // Con un reintento agendado no se corre ahora: lo nuevo espera detrás, en orden.
        if (reintento) { guardar(); return; }
        vaciar();
    }

    /** Solo el servidor: retoma lo que quedó del arranque anterior y empieza a guardar en disco. */
    function iniciar() {
        persistir = true;
        try {
            if (fs.existsSync(archivo)) {
                const guardados = JSON.parse(fs.readFileSync(archivo, 'utf8'));
                if (Array.isArray(guardados) && guardados.length) {
                    // Lo guardado es más viejo que cualquier cosa que haya entrado desde el arranque.
                    pendientes = [...guardados, ...pendientes];
                    fallosSeguidos = Math.max(fallosSeguidos, 1);
                    log.warn(`[PG] ⏳ Quedaron ${guardados.length} copia(s) a PostgreSQL sin hacer del arranque anterior: se retoman ahora.`);
                }
            }
        } catch (e) {
            log.error(`[PG] ⚠️ No se pudo leer la cola guardada (${archivo}): ${e.message}. Se deja el archivo como está para revisarlo a mano.`);
            persistir = false;
            return;
        }
        vaciar();
    }

    return {
        encolar,
        iniciar,
        vaciar,
        pendientes: () => pendientes.slice(),
    };
}

module.exports = { crearColaPg, esFallaDeConexion, ARCHIVO_DEFAULT };
