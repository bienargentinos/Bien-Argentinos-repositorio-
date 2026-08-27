const { GoogleSpreadsheet } = require('google-spreadsheet');
const { fechaHoraAR, fechaAR } = require('./fecha');
const { JWT } = require('google-auth-library');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Si falta la variable, `path.join` revienta con "path must be a string, received undefined",
// que no dice qué falta ni dónde buscarlo. Pasó de verdad al correr un script desde otra carpeta:
// el .env no se cargaba, y el error mandaba a leer el código de Node en vez del .env.
if (!process.env.GOOGLE_CREDENTIALS_FILE) {
    throw new Error(
        'Falta GOOGLE_CREDENTIALS_FILE en el entorno. Si estás corriendo un script suelto, ' +
        'revisá que el archivo .env esté en ' + __dirname + ' y que el script lo cargue desde ahí.'
    );
}
const CREDENTIALS_FILE = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_FILE);

let doc = null;
let connectionPromise = null;

async function getSheet() {
    if (doc && doc.title) return doc;
    if (connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        const creds = require(CREDENTIALS_FILE);
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const newDoc = new GoogleSpreadsheet(SHEET_ID, auth);
        await newDoc.loadInfo();
        doc = newDoc;
        console.log(`✅ Conectado a Google Sheets: "${doc.title}"`);
        connectionPromise = null;
        return doc;
    })();

    return connectionPromise;
}

/**
 * Busca una pestaña sin que importen las mayúsculas.
 *
 * `pestaña(doc, 'clientes')` distingue mayúsculas, y en esta planilla los nombres están
 * mezclados: `CLIENTES`, `EDIFICIOS` y `EVENTOS` van en mayúscula, pero `proveedores`,
 * `facturas` y `memoria` en minúscula. Pedir la pestaña con la caja equivocada no da error --
 * devuelve `undefined` y la función se va por el camino de "no hay datos", en silencio. Pasó
 * exactamente eso: la cartera de un proveedor buscaba `clientes` y nunca encontraba la pestaña,
 * así que los edificios del administrador no se sumaban nunca y nadie se enteraba.
 *
 * Se prueba primero el nombre tal cual (que es lo más rápido y lo habitual) y recién después se
 * compara sin distinguir la caja.
 */
function pestaña(doc, nombre) {
    if (!doc || !nombre) return null;
    const directa = doc.sheetsByTitle[nombre];
    if (directa) return directa;
    const buscado = String(nombre).toLowerCase().trim();
    const titulo = Object.keys(doc.sheetsByTitle || {}).find(t => String(t).toLowerCase().trim() === buscado);
    return titulo ? doc.sheetsByTitle[titulo] : null;
}

/**
 * Se asegura de que la pestaña tenga TODAS las columnas que hacen falta, y GRITA si no lo logra.
 *
 * > [!CAUTION]
 * > **Una hoja de Google trae 26 columnas (A..Z) y `EVENTOS` necesita más de treinta.**
 *
 * Cuando se pasa de ese techo, `setHeaderRow` se planta con *"Sheet is not large enough to fit N
 * columns. Resize the sheet first."* — y los doce lugares que la llamaban tenían `.catch(() => {})`,
 * así que nadie se enteraba nunca. A partir de ese momento `addRow` **descarta en silencio toda
 * clave que no sea una columna existente**: el dato se pasa completo desde `index.js`, la función
 * devuelve bien, el log dice que se guardó, y en la planilla la celda está vacía.
 *
 * Así se perdieron `tecnico`, `tel_tecnico` y `rubro_tecnico` en los cuatro primeros casos reales.
 * `tel_tecnico` no puede llegar vacío --es el teléfono de quien escribe-- y en la planilla estaba
 * vacío en los cuatro. Con eso muerto queda muerto todo lo que depende del rubro: la separación de
 * un reclamo nuevo, cuál de los técnicos de una línea compartida escribió, y a qué caso se imputa
 * una factura. El administrador, además, veía casos abiertos sin nadie a quien llamar.
 *
 * Es el mismo error de siempre: **hacer algo y no verificar que haya quedado hecho.**
 *
 * Dos detalles que importan:
 *
 * - **Las columnas que ya están no se tocan ni se reordenan.** Los datos de las filas viven por
 *   POSICIÓN, no por nombre: reescribir el encabezado en otro orden --o colapsar dos columnas sin
 *   título en una, que es lo que hacía el `new Set([...headers, ...])` de antes-- le cambia el
 *   nombre a columnas que tienen adentro otra cosa. Se agrega SOLO al final.
 * - **Un encabezado repetido rompe la pestaña entera.** La librería tira `Duplicate header
 *   detected` y desde ahí no se puede leer ni escribir por nombre. Eso se arregla a mano en la
 *   planilla, así que acá lo único útil es decirlo fuerte en vez de tragarlo.
 *
 * Devuelve los encabezados que quedaron (los viejos, si no se pudo agregar nada).
 */
async function asegurarColumnas(sheet, necesarias, quien = '') {
    if (!sheet || !Array.isArray(necesarias) || !necesarias.length) return sheet?.headerValues || [];
    const donde = quien || sheet.title || 'la pestaña';

    try {
        await sheet.loadHeaderRow();
    } catch (err) {
        // Pestaña vacía todavía: no es un problema, el setHeaderRow de abajo la estrena.
        // Encabezado repetido: sí lo es, y no se arregla desde acá.
        if (/Duplicate header/i.test(err.message || '')) {
            console.error(`🧱 ${donde}: ${err.message} — hasta que no se borre esa columna repetida A MANO en la planilla, no se puede leer ni escribir por nombre en esta pestaña.`);
            return sheet.headerValues || [];
        }
    }

    const headers = sheet.headerValues || [];
    const yaEstan = new Set(headers.map(h => String(h || '').trim()).filter(Boolean));
    const faltan = necesarias.filter(n => !yaEstan.has(String(n).trim()));
    if (!faltan.length) return headers;

    const completos = [...headers, ...faltan];

    if (completos.length > (sheet.columnCount || 0)) {
        try {
            // Con holgura: agrandar cuesta una llamada y quedarse justo garantiza volver a pasar
            // por acá en la próxima columna que se agregue.
            await sheet.resize({ rowCount: sheet.rowCount || 1000, columnCount: completos.length + 10 });
            console.log(`📐 ${donde}: la hoja tenía ${sheet.columnCount || '?'} columnas y hacían falta ${completos.length}. Agrandada.`);
        } catch (err) {
            console.error(`🧱 ${donde}: NO se pudo agrandar la hoja para ${faltan.join(', ')} → ${err.message}. Todo lo que se guarde en esas columnas SE VA A PERDER EN SILENCIO.`);
            return headers;
        }
    }

    try {
        await sheet.setHeaderRow(completos);
        console.log(`🆕 ${donde}: columnas nuevas → ${faltan.join(', ')}`);
        return completos;
    } catch (err) {
        console.error(`🧱 ${donde}: NO se pudieron crear las columnas ${faltan.join(', ')} → ${err.message}. Todo lo que se guarde en ellas SE VA A PERDER EN SILENCIO.`);
        return headers;
    }
}

// ─────────────────────────────────────────────
// VECINOS
// ─────────────────────────────────────────────

/**
 * Devuelve TODOS los registros que coincidan con el teléfono.
 * Un propietario puede tener 2 o 3 filas si figura en múltiples edificios
 * del mismo administrador. El llamador decide qué hacer si hay más de uno.
 *
 * Retorna: array de objetos | [] si no encuentra nada
 */
async function buscarVecinosPorTelefono(telefono) {
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        const telBuscado = String(telefono).replace(/\D/g, '');

        const coincidencias = rows.filter(r => {
            const tel = String(r.get('telefono') || '').replace(/\D/g, '');
            return tel === telBuscado;
        });

        return coincidencias.map(row => ({
            nombre:           row.get('nombre')            || '',
            edificio:         row.get('edificio')          || '',
            departamento:     row.get('departamento')      || '',
            encargado:        row.get('encargado')         || '',
            telEncargado:     row.get('tel_encargado')     || '',
            horarioEncargado: row.get('horario_encargado') || '',
            tablero:          row.get('tablero')           || '',
            llaves:           row.get('llaves')            || '',
            seguridad:        row.get('seguridad')         || '',
            consejo:          row.get('consejo')           || '',
            notas:            row.get('notas')             || '',
            // Autorización persistente para compartir su contacto con el técnico asignado a un
            // caso. Una vez que el vecino la dio, se recuerda para los próximos eventos.
            autorizaContacto:  String(row.get('autoriza_contacto') || '').toLowerCase().startsWith('s'),
            contactoAcceso:    row.get('contacto_acceso')   || '',
        }));
    } catch (err) {
        console.error('Error buscando vecino en Sheets:', err.message);
        return [];
    }
}

// Alias de compatibilidad: devuelve solo el primer resultado (uso simple)
async function buscarVecinoPorTelefono(telefono) {
    const resultados = await buscarVecinosPorTelefono(telefono);
    return resultados[0] || null;
}

async function agregarVecinoNuevo({ telefono, nombre, edificio, departamento }) {
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        const telBuscado = String(telefono || '').replace(/\D/g, '');
        const edifBuscado = String(edificio || '').toLowerCase().trim();

        // Evitar duplicados exactos del mismo teléfono en el mismo edificio
        const existe = rows.some(r => {
            const tel = String(r.get('telefono') || '').replace(/\D/g, '');
            const edif = String(r.get('edificio') || '').toLowerCase().trim();
            return tel === telBuscado && edif === edifBuscado;
        });

        if (!existe) {
            await sheet.addRow({
                telefono,
                nombre:       nombre       || '',
                edificio:     edificio     || '',
                departamento: departamento || '',
                notas:        'Registro automático por bot',
            });
            console.log(`✅ Vecino agregado en pestaña VECINOS: ${nombre} - ${edificio} ${departamento}`);
        } else {
            console.log(`ℹ️ El vecino ya estaba registrado para el edificio ${edificio}`);
        }
    } catch (err) {
        console.error('Error agregando vecino al Sheet:', err.message);
    }
}

// Registra que un vecino autorizó a compartir su contacto (o un contacto alternativo) con el
// técnico asignado. Queda persistido en la pestaña VECINOS, así en el próximo evento Marcos ya
// sabe que puede pasar el dato sin volver a pedir permiso -- la confianza se acumula, no se
// reinicia en cada caso.
async function guardarAutorizacionContacto({ telefono, autoriza = true, contactoAcceso = '' }) {
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByIndex[0];
        await asegurarColumnas(sheet, ['autoriza_contacto', 'contacto_acceso'], 'vecinos');

        const rows = await sheet.getRows();
        const telBuscado = String(telefono || '').replace(/\D/g, '');
        const fila = rows.find(r => String(r.get('telefono') || '').replace(/\D/g, '') === telBuscado);

        // Si el vecino todavía no tiene fila, se crea acá mismo.
        //
        // Antes esto hacía `return false` y el dato se perdía en silencio, y era justo el caso más
        // común: el vecino comparte el contacto de quien va a recibir al técnico en su PRIMER
        // mensaje, y su ficha recién se crea al final del flujo. Como el contacto solo quedaba en
        // la sesión, cualquier reinicio lo borraba y Marcos volvía a preguntar quién iba a abrir
        // -- teniendo el dato desde el principio.
        if (!fila) {
            await sheet.addRow({
                telefono,
                autoriza_contacto: autoriza ? 'si' : '',
                contacto_acceso: contactoAcceso || '',
                notas: 'Registro automático por bot',
            });
            console.log(`🔓 Autorización de contacto guardada para ${telBuscado} (vecino nuevo)${contactoAcceso ? ` — contacto de acceso: ${contactoAcceso}` : ''}`);
            return true;
        }

        if (autoriza) fila.set('autoriza_contacto', 'si');
        if (contactoAcceso) fila.set('contacto_acceso', contactoAcceso);
        await fila.save();
        console.log(`🔓 Autorización de contacto guardada para ${telBuscado}${contactoAcceso ? ` (contacto de acceso: ${contactoAcceso})` : ''}`);
        return true;
    } catch (err) {
        console.error('Error guardando autorización de contacto:', err.message);
        return false;
    }
}

// ─────────────────────────────────────────────
// TÉCNICOS — selección inteligente con fallback
// Columnas: nombre | especialidad | telefono | edificios | acceso |
//           prioridad_admin | puntaje_encuesta | activo | disponible_urgencia
// ─────────────────────────────────────────────

async function buscarTecnicoAsignado({ edificio, especialidad, esUrgente = false }) {
    try {
        const doc = await getSheet();
        const espNorm = (especialidad || '').toLowerCase().trim();
        const edifNorm = (edificio || '').toLowerCase().trim();

        // 1. Buscar en pestaña 'proveedor_asignaciones' (pestaña del Dashboard web)
        const sheetAsig = pestaña(doc, 'proveedor_asignaciones');
        if (sheetAsig) {
            const rowsAsig = await sheetAsig.getRows();
            const coincide = rowsAsig.find(r => {
                const est = (r.get('estado') || '').toLowerCase();
                if (est === 'eliminado' || est === 'inactivo') return false;

                const rub = (r.get('rubro') || '').toLowerCase();
                const edif = (r.get('edificio') || '').toLowerCase();

                const coincideRubro = rub.includes(espNorm) || espNorm.includes(rub) ||
                    ((espNorm.includes('electr') || espNorm.includes('luz')) && (rub.includes('electr') || rub.includes('luz') || rub.includes('electricista'))) ||
                    ((espNorm.includes('plom') || espNorm.includes('agua')) && (rub.includes('plom') || rub.includes('agua') || rub.includes('plomero'))) ||
                    ((espNorm.includes('cerraj') || espNorm.includes('llav')) && (rub.includes('cerraj') || rub.includes('port')));

                const coincideEdificio = edif.includes(edifNorm) || edifNorm.includes(edif) || edif === '' || edif === 'todos';

                return coincideRubro && coincideEdificio;
            });

            if (coincide) {
                console.log(`🔧 Técnico encontrado en 'proveedor_asignaciones': ${coincide.get('proveedor')} (${coincide.get('telefono')})`);
                // "acceso" viaja tal cual en la plantilla de Meta que recibe el técnico -- nunca
                // debe leerse como que el técnico tiene que gestionarlo por su cuenta. Es Marcos
                // quien coordina el acceso con el vecino, no el técnico. (No puede ser dinámico
                // acá porque todavía no sabemos quién es el vecino en este punto de la búsqueda.)
                return {
                    nombre:    coincide.get('proveedor'),
                    telefono:  coincide.get('telefono'),
                    acceso:    'Coordinado por Marcos con el vecino',
                    puntaje:   '5',
                    urgencia:  true
                };
            }
        }

        // 2. Buscar en pestaña 'proveedores'
        const sheetProv = pestaña(doc, 'proveedores');
        if (sheetProv) {
            const rowsProv = await sheetProv.getRows();
            const coincideProv = rowsProv.find(r => {
                const est = (r.get('estado') || '').toLowerCase();
                if (est === 'eliminado' || est === 'inactivo') return false;

                const rub = (r.get('rubro') || '').toLowerCase();
                return rub.includes(espNorm) || espNorm.includes(rub) ||
                    ((espNorm.includes('electr') || espNorm.includes('luz')) && (rub.includes('electr') || rub.includes('luz') || rub.includes('electricista'))) ||
                    ((espNorm.includes('plom') || espNorm.includes('agua')) && (rub.includes('plom') || rub.includes('agua') || rub.includes('plomero')));
            });

            if (coincideProv) {
                console.log(`🔧 Técnico encontrado en 'proveedores': ${coincideProv.get('nombre')} (${coincideProv.get('telefono')})`);
                return {
                    nombre:    coincideProv.get('nombre'),
                    telefono:  coincideProv.get('telefono'),
                    acceso:    'Coordinado por Marcos con el vecino',
                    puntaje:   '5',
                    urgencia:  true
                };
            }
        }

        // 3. Fallback: Buscar en pestaña 'tecnicos'
        const sheet = pestaña(doc, 'tecnicos');
        if (!sheet) return null;

        const rows = await sheet.getRows();
        const candidatos = rows.filter(r => {
            const esp   = (r.get('especialidad') || '').toLowerCase();
            const edifs = (r.get('edificios')    || '').toLowerCase();
            const activo = (r.get('activo')      || '').toLowerCase();
            if (activo !== 'si' && activo !== 'sí') return false;

            const coincideEdificio = edifs.includes(edifNorm) || edifs.includes('todos') || edifs === '';
            if (!coincideEdificio) return false;

            return esp.includes(espNorm) || espNorm.includes(esp);
        });

        if (candidatos.length === 0) return null;

        candidatos.sort((a, b) => {
            const pA = (a.get('prioridad_admin') || '').toLowerCase() === 'si' ? 1 : 0;
            const pB = (b.get('prioridad_admin') || '').toLowerCase() === 'si' ? 1 : 0;
            if (pB !== pA) return pB - pA;
            return parseFloat(b.get('puntaje_encuesta') || 0) - parseFloat(a.get('puntaje_encuesta') || 0);
        });

        const elegido = candidatos[0];
        return {
            nombre:    elegido.get('nombre'),
            telefono:  elegido.get('telefono'),
            acceso:    elegido.get('acceso'),
            puntaje:   elegido.get('puntaje_encuesta'),
            urgencia:  (elegido.get('disponible_urgencia') || '').toLowerCase() === 'si',
        };
    } catch (err) {
        console.error('Error buscando técnico:', err.message);
        return null;
    }
}

async function buscarTecnicoSuplente({ edificio, especialidad, telefonoTitular }) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'proveedor_asignaciones');
        if (!sheet) return null;

        const filas = await sheet.getRows();
        const edifNorm = (edificio || '').toLowerCase();
        const espNorm = (especialidad || '').toLowerCase();
        const telTitularNorm = String(telefonoTitular || '').replace(/\D/g, '');

        const candidatos = filas.filter(r => {
            const esp   = (r.get('especialidad') || '').toLowerCase();
            const edifs = (r.get('edificios')    || '').toLowerCase();
            const activo = (r.get('activo')      || '').toLowerCase();
            const tel   = String(r.get('telefono') || '').replace(/\D/g, '');
            
            if (activo !== 'si' && activo !== 'sí') return false;
            if (tel === telTitularNorm) return false;

            const coincideEdificio = edifs.includes(edifNorm) || edifs.includes('todos') || edifs === '';
            if (!coincideEdificio) return false;

            return esp.includes(espNorm) || espNorm.includes(esp);
        });

        if (candidatos.length === 0) return null;

        candidatos.sort((a, b) => {
            const pA = (a.get('prioridad_admin') || '').toLowerCase() === 'si' ? 1 : 0;
            const pB = (b.get('prioridad_admin') || '').toLowerCase() === 'si' ? 1 : 0;
            if (pB !== pA) return pB - pA;
            return parseFloat(b.get('puntaje_encuesta') || 0) - parseFloat(a.get('puntaje_encuesta') || 0);
        });

        const elegido = candidatos[0];
        return {
            nombre:    elegido.get('nombre'),
            telefono:  elegido.get('telefono'),
            acceso:    elegido.get('acceso'),
            puntaje:   elegido.get('puntaje_encuesta'),
            urgencia:  (elegido.get('disponible_urgencia') || '').toLowerCase() === 'si',
        };
    } catch (err) {
        console.error('Error buscando técnico suplente:', err.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// PERSONAL DE TURNO
// ─────────────────────────────────────────────

async function buscarPersonalDeTurno({ edificio }) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'personal');
        if (!sheet) return null;

        const filas = await sheet.getRows();
        const ahora = new Date();
        const horaActual = `${ahora.getHours().toString().padStart(2,'0')}:${ahora.getMinutes().toString().padStart(2,'0')}`;

        const personalDeTurno = filas.find(f => {
            const edificioFila = (f.get('edificio') || '').toLowerCase();
            const estado = (f.get('estado')         || '').toUpperCase();
            const inicio = f.get('horario_inicio');
            const fin    = f.get('horario_fin');

            if (edificioFila !== edificio.toLowerCase() || estado !== 'ACTIVO') return false;

            if (inicio <= fin) {
                return horaActual >= inicio && horaActual <= fin;
            } else {
                return horaActual >= inicio || horaActual <= fin;
            }
        });

        if (!personalDeTurno) return null;

        return {
            nombre:   personalDeTurno.get('nombre'),
            rol:      personalDeTurno.get('rol'),
            telefono: personalDeTurno.get('telefono'),
            horario:  `${personalDeTurno.get('horario_inicio')} a ${personalDeTurno.get('horario_fin')}`,
        };
    } catch (err) {
        console.error('Error buscando personal de turno:', err.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// PERFIL DE EDIFICIO
// Pestaña: edificios
// Columnas: edificio | tipo | notas_especiales | admin_nombre | admin_telefono
// ─────────────────────────────────────────────

async function buscarPerfilEdificio(nombreEdificio) {
    try {
        if (!nombreEdificio) return null;
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EDIFICIOS');
        if (!sheet) return null;

        const rows = await sheet.getRows();
        const buscado = String(nombreEdificio).toLowerCase().trim();
        const numBuscado = buscado.match(/\d+/g) || [];

        // 1. Coincidencia por número exacto de calle (ej: 159 vs 270)
        let row = null;
        if (numBuscado.length > 0) {
            row = rows.find(r => {
                const nombre = (r.get('nombre') || r.get('edificio') || r.get('consorcio') || '').toLowerCase().trim();
                const direccion = (r.get('direccion') || '').toLowerCase().trim();
                const aliases = (r.get('aliases') || '').toLowerCase().trim();
                const numsR = (nombre + ' ' + direccion + ' ' + aliases).match(/\d+/g) || [];
                return numBuscado.some(n => numsR.includes(n));
            });
        }

        // 2. Coincidencia exacta o por inclusión si no hubo coincidencia por número
        if (!row) {
            row = rows.find(r => {
                const nombre = (r.get('nombre') || r.get('edificio') || r.get('consorcio') || '').toLowerCase().trim();
                const direccion = (r.get('direccion') || '').toLowerCase().trim();
                const aliases = (r.get('aliases') || '').toLowerCase().trim();
                return (nombre && (buscado === nombre || buscado.includes(nombre) || nombre.includes(buscado))) ||
                       (direccion && (buscado === direccion || buscado.includes(direccion) || direccion.includes(buscado))) ||
                       (aliases && aliases.split(',').some(a => a.trim().length > 3 && buscado.includes(a.trim().toLowerCase())));
            });
        }

        if (!row) return null;

        return {
            nombre:            row.get('nombre')          || row.get('direccion') || '',
            direccion:         row.get('direccion')       || '',
            zona:              row.get('zona')            || '',
            encargado:         row.get('encargado')       || '',
            telEncargado:      row.get('tel_encargado')   || '',
            encargadoEstado:   row.get('encargado_estado')|| 'activo',
            encargadoSuplente: row.get('encargado_suplente') || '',
            telSuplente:       row.get('tel_suplente')    || '',
            telSeguridad:      row.get('tel_seguridad')   || '',
            adminNombre:       row.get('administrador')   || '',
            plan:              row.get('plan')            || '',
            // Casa/PH vs. edificio. Hace falta para no pedirle el número de departamento a alguien
            // que vive en una casa: no lo tiene, así que la pregunta no se puede contestar y Marcos
            // la repetía en cada vuelta.
            tipo:              row.get('tipo')            || '',
            unidades:          row.get('unidades')        || '',
        };
    } catch (err) {
        console.error('Error buscando perfil de edificio:', err.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// CLIENTES (ADMINISTRADORES)
// Pestaña: CLIENTES
// ─────────────────────────────────────────────
async function buscarCliente(nombreAdmin) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'CLIENTES');
        if (!sheet) return null;

        const rows = await sheet.getRows();
        const row = rows.find(r =>
            (r.get('nombre') || '').toLowerCase().includes(nombreAdmin.toLowerCase())
        );

        if (!row) return null;

        // Mismos valores por defecto que el panel: el mail va salvo que lo apaguen, el WhatsApp
        // solo si lo piden.
        return {
            nombre:      row.get('nombre')      || '',
            email:       row.get('email')       || '',
            wsp:         row.get('wsp')         || '',
            notifEmail:  (row.get('notif_email') || '').toLowerCase() !== 'no',
            notifWsp:    (row.get('notif_wsp')  || '').toLowerCase() === 'si',
        };
    } catch (err) {
        console.error('Error buscando cliente:', err.message);
        return null;
    }
}

/**
 * La cartera del proveedor: qué edificios atiende y de qué administrador es cada uno.
 * Respaldo de la versión de PostgreSQL -- ver el comentario largo en datos-pg.js.
 *
 * Devuelve `[{ edificio, cliente }]`. Junta TODOS los clientes en los que figura el técnico, no
 * el primero: el mismo electricista atiende varios administradores desde un solo número.
 */
async function edificiosDelProveedor({ nombre = '', telefono = '' } = {}) {
    const nombreBuscado = String(nombre || '').toLowerCase().trim();
    const telBuscado = String(telefono || '').replace(/\D/g, '');
    if (!nombreBuscado && !telBuscado) return [];

    const mismoTelefono = (a, b) => {
        const x = String(a || '').replace(/\D/g, '');
        const y = String(b || '').replace(/\D/g, '');
        if (!x || !y) return false;
        return x === y || x.endsWith(y.slice(-8)) || y.endsWith(x.slice(-8));
    };
    const activo = r => {
        const est = String(r.get('estado') || '').toLowerCase().trim();
        return est !== 'eliminado' && est !== 'inactivo';
    };
    const esEsteProveedor = r => {
        if (telBuscado && mismoTelefono(r.get('telefono') || r.get('proveedor_telefono'), telBuscado)) return true;
        if (!nombreBuscado) return false;
        const n = String(r.get('proveedor') || r.get('proveedor_nombre') || r.get('nombre') || '').toLowerCase().trim();
        return Boolean(n) && (n === nombreBuscado || n.includes(nombreBuscado) || nombreBuscado.includes(n));
    };

    try {
        const doc = await getSheet();
        const cartera = new Map();
        const sumar = (edificio, cliente) => {
            const ed = String(edificio || '').trim();
            if (!ed) return;
            const clave = ed.toLowerCase();
            const yaEsta = cartera.get(clave);
            if (!yaEsta || (!yaEsta.cliente && cliente)) {
                cartera.set(clave, { edificio: ed, cliente: String(cliente || '').trim() });
            }
        };

        const sheetAsig = pestaña(doc, 'proveedor_asignaciones');
        if (sheetAsig) {
            for (const a of await sheetAsig.getRows()) {
                if (!activo(a) || !esEsteProveedor(a)) continue;
                sumar(a.get('edificio'), a.get('cliente'));
            }
        }

        const sheetProv = pestaña(doc, 'proveedores');
        const susClientes = new Set();
        if (sheetProv) {
            for (const r of await sheetProv.getRows()) {
                if (!activo(r) || !esEsteProveedor(r)) continue;
                const c = String(r.get('cliente') || '').toLowerCase().trim();
                if (c) susClientes.add(c);
            }
        }

        if (susClientes.size) {
            const sheetEdif = pestaña(doc, 'EDIFICIOS');
            if (sheetEdif) {
                for (const e of await sheetEdif.getRows()) {
                    const suCliente = String(e.get('cliente') || '').toLowerCase().trim();
                    if (!suCliente || !susClientes.has(suCliente)) continue;
                    sumar(e.get('nombre') || e.get('edificio') || e.get('direccion'), suCliente);
                }
            }
            const sheetCli = pestaña(doc, 'CLIENTES');
            if (sheetCli) {
                for (const c of await sheetCli.getRows()) {
                    const usuario = String(c.get('usuario') || '').toLowerCase().trim();
                    const nombreCli = String(c.get('nombre') || '').toLowerCase().trim();
                    if (!susClientes.has(usuario) && !susClientes.has(nombreCli)) continue;
                    for (const ed of String(c.get('edificios') || '').split(',').map(s => s.trim()).filter(Boolean)) {
                        sumar(ed, usuario || nombreCli);
                    }
                }
            }
        }

        return Array.from(cartera.values());
    } catch (err) {
        console.error('Error listando los edificios del proveedor:', err.message);
        return [];
    }
}

// Las columnas donde viven los datos de cobro del proveedor. Se crean solas al guardar.
const COLUMNAS_BANCARIAS = [
    'cbu', 'alias_cbu', 'titular', 'cuit',
    'cbu_actualizado', 'cbu_pendiente', 'alias_pendiente', 'cbu_pendiente_desde',
];

/** Ubica la fila de un proveedor. Devuelve también si el teléfono es ambiguo. */
async function filaDelProveedor({ nombre = '', telefono = '' }) {
    const doc = await getSheet();
    const hoja = pestaña(doc, 'proveedores');
    if (!hoja) return { hoja: null, fila: null, ambiguo: false, candidatos: [] };

    const tel = String(telefono || '').replace(/\D/g, '');
    const nom = String(nombre || '').toLowerCase().trim();
    const activo = r => {
        const est = String(r.get('estado') || '').toLowerCase().trim();
        return est !== 'eliminado' && est !== 'inactivo';
    };
    const mismoTelefono = (a, b) => {
        const x = String(a || '').replace(/\D/g, '');
        if (!x || !b) return false;
        return x === b || x.endsWith(b.slice(-8)) || b.endsWith(x.slice(-8));
    };

    const filas = (await hoja.getRows()).filter(activo);

    // El nombre manda cuando lo tenemos: en una línea compartida es lo único que distingue a
    // Julio de Dario, y los datos de cobro de uno no son los del otro.
    if (nom) {
        const porNombre = filas.filter(r => String(r.get('nombre') || '').toLowerCase().trim() === nom);
        if (porNombre.length === 1) return { hoja, fila: porNombre[0], ambiguo: false, candidatos: porNombre };
    }

    const porTelefono = tel ? filas.filter(r => mismoTelefono(r.get('telefono') || r.get('wsp'), tel)) : [];
    if (porTelefono.length === 1) return { hoja, fila: porTelefono[0], ambiguo: false, candidatos: porTelefono };

    // Varios técnicos en la misma línea y sin nombre que los separe: no se elige uno al azar,
    // porque escribirle el CBU al proveedor equivocado manda el pago a otra persona.
    return {
        hoja,
        fila: null,
        ambiguo: porTelefono.length > 1,
        candidatos: porTelefono.map(r => ({ nombre: r.get('nombre') || '', rubro: r.get('rubro') || '' })),
    };
}

/** Los datos de cobro que ya tiene cargados un proveedor. */
async function buscarDatosBancariosProveedor({ nombre = '', telefono = '' }) {
    try {
        const { fila, ambiguo, candidatos } = await filaDelProveedor({ nombre, telefono });
        if (!fila) return { encontrado: false, ambiguo, candidatos };
        return {
            encontrado: true,
            ambiguo: false,
            nombre:   fila.get('nombre') || '',
            cbu:      fila.get('cbu') || '',
            alias:    fila.get('alias_cbu') || '',
            titular:  fila.get('titular') || '',
            cuit:     fila.get('cuit') || '',
            actualizado:      fila.get('cbu_actualizado') || '',
            cbuPendiente:     fila.get('cbu_pendiente') || '',
            aliasPendiente:   fila.get('alias_pendiente') || '',
            pendienteDesde:   fila.get('cbu_pendiente_desde') || '',
        };
    } catch (err) {
        console.error('Error buscando los datos bancarios del proveedor:', err.message);
        return { encontrado: false, ambiguo: false, candidatos: [] };
    }
}

/**
 * Guarda los datos de cobro de un proveedor.
 *
 * LA PRIMERA CARGA SE APLICA; UN CAMBIO NO.
 *
 * Cambiar el CBU de un proveedor es el fraude más común que hay: alguien se mete en la
 * conversación, dice "cambié de banco, anotá este otro", y el pago del mes siguiente se va a otra
 * cuenta. Acá la identidad es el número de teléfono, que no prueba gran cosa.
 *
 * Por eso un cambio NO pisa el dato que ya estaba: queda guardado aparte como pendiente, el
 * anterior sigue siendo el vigente, y se le avisa a la Administración para que lo apruebe. Si el
 * cambio es legítimo, el proveedor cobra unos días más tarde; si no lo es, no se pierde la plata.
 * De los dos errores posibles, ese es el que se puede deshacer.
 *
 * @returns {{ok, pendiente, ambiguo, candidatos, anterior}}
 */
async function guardarDatosBancariosProveedor({ nombre = '', telefono = '', cbu = '', alias = '', titular = '', cuit = '' }) {
    try {
        const { hoja, fila, ambiguo, candidatos } = await filaDelProveedor({ nombre, telefono });
        if (!hoja) return { ok: false, motivo: 'no existe la pestaña proveedores' };
        if (ambiguo) return { ok: false, ambiguo: true, candidatos };
        if (!fila) return { ok: false, motivo: 'no se encontró ese proveedor' };

        await asegurarColumnas(hoja, COLUMNAS_BANCARIAS, 'proveedores');

        const cbuActual   = String(fila.get('cbu') || '').replace(/\D/g, '');
        const aliasActual = String(fila.get('alias_cbu') || '').toLowerCase().trim();
        const cbuNuevo    = String(cbu || '').replace(/\D/g, '');
        const aliasNuevo  = String(alias || '').toLowerCase().trim();

        const yaTeniaAlgo = Boolean(cbuActual || aliasActual);
        const cambiaCBU   = Boolean(cbuNuevo)   && cbuNuevo   !== cbuActual;
        const cambiaAlias = Boolean(aliasNuevo) && aliasNuevo !== aliasActual;

        // Los datos que no son de cobro (titular, CUIT) se completan siempre: no redirigen plata.
        if (titular) fila.set('titular', titular);
        if (cuit)    fila.set('cuit', String(cuit).replace(/\D/g, ''));

        if (yaTeniaAlgo && (cambiaCBU || cambiaAlias)) {
            if (cbuNuevo)   fila.set('cbu_pendiente', cbuNuevo);
            if (aliasNuevo) fila.set('alias_pendiente', aliasNuevo);
            fila.set('cbu_pendiente_desde', fechaHoraAR());
            await fila.save();

            console.log(`🔐 ${fila.get('nombre')} pidió cambiar sus datos de cobro. Queda PENDIENTE: el anterior sigue vigente hasta que la Administración lo apruebe.`);
            return {
                ok: true,
                pendiente: true,
                nombre: fila.get('nombre') || '',
                anterior: { cbu: cbuActual, alias: aliasActual },
                nuevo: { cbu: cbuNuevo, alias: aliasNuevo },
            };
        }

        if (cbuNuevo)   fila.set('cbu', cbuNuevo);
        if (aliasNuevo) fila.set('alias_cbu', aliasNuevo);
        if (cbuNuevo || aliasNuevo) fila.set('cbu_actualizado', fechaHoraAR());
        await fila.save();

        console.log(`🏦 Datos de cobro guardados para ${fila.get('nombre')}${cbuNuevo ? ` (CBU ...${cbuNuevo.slice(-4)})` : ''}.`);
        return { ok: true, pendiente: false, nombre: fila.get('nombre') || '' };
    } catch (err) {
        console.error('Error guardando los datos bancarios del proveedor:', err.message);
        return { ok: false, motivo: err.message };
    }
}

/**
 * Da de alta a un técnico que NO estaba en la lista, con sus datos de cobro SIN ACTIVAR.
 *
 * Pasa seguido: el encargado llama a un plomero por su cuenta, el trabajo se hace, y el plomero
 * le escribe a Marcos para pasar la factura. Ese número no está cargado en ningún lado.
 *
 * El trabajo y la factura se registran -- son un antecedente y no mueven plata. Los datos de
 * cobro NO: entran como `cbu_pendiente`, con el proveedor en estado `sin_verificar`, y no se
 * pueden usar hasta que la Administración los apruebe.
 *
 * El motivo es directo: acá la identidad es un número de teléfono desconocido. Aceptar un CBU
 * así es exactamente cómo funciona el fraude -- alguien escribe "soy el plomero que arregló lo
 * del 3°B, pagame acá" y cobra un trabajo que no hizo. Registrar el pedido y hacer que alguien
 * lo confirme cuesta unos días; pagarle a un desconocido no se deshace.
 *
 * @returns {{ok, creado, nombre, yaExistia}}
 */
async function registrarProveedorNoVerificado({ nombre = '', telefono = '', rubro = '', cliente = '', cbu = '', alias = '', titular = '', cuit = '' }) {
    try {
        const doc = await getSheet();
        const hoja = pestaña(doc, 'proveedores');
        if (!hoja) return { ok: false, motivo: 'no existe la pestaña proveedores' };

        const tel = String(telefono || '').replace(/\D/g, '');
        if (!tel) return { ok: false, motivo: 'sin teléfono no se puede registrar' };

        await asegurarColumnas(hoja, ['cliente', 'rubro', 'nombre', 'telefono', 'notas', 'estado', ...COLUMNAS_BANCARIAS], 'proveedores');

        const mismoTelefono = (a) => {
            const x = String(a || '').replace(/\D/g, '');
            if (!x) return false;
            return x === tel || x.endsWith(tel.slice(-8)) || tel.endsWith(x.slice(-8));
        };

        // Si ya existe una fila con ese teléfono no se duplica: se le anota lo pendiente.
        const filas = await hoja.getRows();
        const existente = filas.find(r => mismoTelefono(r.get('telefono') || r.get('wsp')));
        if (existente) {
            if (cbu) existente.set('cbu_pendiente', String(cbu).replace(/\D/g, ''));
            if (alias) existente.set('alias_pendiente', String(alias).toLowerCase().trim());
            if (titular && !existente.get('titular')) existente.set('titular', titular);
            if (cuit && !existente.get('cuit')) existente.set('cuit', String(cuit).replace(/\D/g, ''));
            existente.set('cbu_pendiente_desde', fechaHoraAR());
            await existente.save();
            return { ok: true, creado: false, yaExistia: true, nombre: existente.get('nombre') || nombre };
        }

        await hoja.addRow({
            cliente,
            rubro: rubro || 'Otro',
            nombre: nombre || 'Técnico sin identificar',
            telefono,
            notas: 'Se presentó por WhatsApp con un trabajo ya hecho. Sin verificar por la Administración.',
            // El estado lo deja fuera de las búsquedas normales de Marcos, que solo toman
            // "activo": no se le va a derivar un caso a alguien que nadie confirmó.
            estado: 'sin_verificar',
            cbu: '',
            alias_cbu: '',
            cbu_pendiente: String(cbu || '').replace(/\D/g, ''),
            alias_pendiente: String(alias || '').toLowerCase().trim(),
            titular: titular || '',
            cuit: String(cuit || '').replace(/\D/g, ''),
            cbu_pendiente_desde: fechaHoraAR(),
        });

        console.log(`🆕 Técnico desconocido registrado SIN VERIFICAR: "${nombre || 'sin nombre'}" (${telefono}). Sus datos de cobro quedan pendientes de aprobación.`);
        return { ok: true, creado: true, yaExistia: false, nombre: nombre || 'Técnico sin identificar' };
    } catch (err) {
        console.error('Error registrando al técnico no verificado:', err.message);
        return { ok: false, motivo: err.message };
    }
}

/** Aplica o descarta un cambio de datos de cobro que había quedado pendiente. */
async function resolverCambioBancario({ nombre = '', telefono = '', aprobar = false }) {
    try {
        const { fila } = await filaDelProveedor({ nombre, telefono });
        if (!fila) return { ok: false, motivo: 'no se encontró ese proveedor' };

        const cbuPend   = String(fila.get('cbu_pendiente') || '').replace(/\D/g, '');
        const aliasPend = String(fila.get('alias_pendiente') || '').trim();
        if (!cbuPend && !aliasPend) return { ok: false, motivo: 'no hay ningún cambio pendiente' };

        if (aprobar) {
            if (cbuPend)   fila.set('cbu', cbuPend);
            if (aliasPend) fila.set('alias_cbu', aliasPend);
            fila.set('cbu_actualizado', fechaHoraAR());
        }
        fila.set('cbu_pendiente', '');
        fila.set('alias_pendiente', '');
        fila.set('cbu_pendiente_desde', '');
        await fila.save();

        console.log(`🔐 Cambio de datos de cobro de ${fila.get('nombre')} ${aprobar ? 'APROBADO' : 'RECHAZADO'}.`);
        return { ok: true, aprobado: aprobar, nombre: fila.get('nombre') || '' };
    } catch (err) {
        console.error('Error resolviendo el cambio de datos bancarios:', err.message);
        return { ok: false, motivo: err.message };
    }
}

/**
 * Todos los proveedores que comparten un mismo teléfono, con su rubro.
 * Respaldo de la versión de PostgreSQL -- ver el comentario largo en datos-pg.js.
 *
 * Un número no identifica a una persona: puede ser la línea de una empresa con varios oficios
 * detrás. En esta planilla, el mismo teléfono figura como JULIO (plomero) y como DARIO
 * (electricista), y por eso Marcos saludaba al plomero en un caso de electricidad.
 */
async function proveedoresPorTelefono(telefono) {
    const tel = String(telefono || '').replace(/\D/g, '');
    if (!tel) return [];

    const mismoTelefono = (a, b) => {
        const x = String(a || '').replace(/\D/g, '');
        const y = String(b || '').replace(/\D/g, '');
        if (!x || !y) return false;
        return x === y || x.endsWith(y.slice(-8)) || y.endsWith(x.slice(-8));
    };
    const activo = r => {
        const est = String(r.get('estado') || '').toLowerCase().trim();
        return est !== 'eliminado' && est !== 'inactivo';
    };

    try {
        const doc = await getSheet();
        const encontrados = [];
        const vistos = new Set();
        const sumar = (nombre, rubro, origen) => {
            const n = String(nombre || '').trim();
            if (!n) return;
            const clave = n.toLowerCase();
            if (vistos.has(clave)) return;
            vistos.add(clave);
            encontrados.push({ nombre: n, rubro: String(rubro || '').trim(), origen });
        };

        const sheetProv = pestaña(doc, 'proveedores');
        if (sheetProv) {
            for (const r of await sheetProv.getRows()) {
                if (!activo(r) || !mismoTelefono(r.get('telefono') || r.get('wsp'), tel)) continue;
                sumar(r.get('nombre'), r.get('rubro') || r.get('especialidad'), 'lista maestra');
            }
        }
        const sheetAsig = pestaña(doc, 'proveedor_asignaciones');
        if (sheetAsig) {
            for (const a of await sheetAsig.getRows()) {
                if (!activo(a) || !mismoTelefono(a.get('telefono') || a.get('proveedor_telefono'), tel)) continue;
                sumar(a.get('proveedor') || a.get('proveedor_nombre'), a.get('rubro'), 'asignación');
            }
        }

        return encontrados;
    } catch (err) {
        console.error('Error listando los proveedores de ese teléfono:', err.message);
        return [];
    }
}

/**
 * Los casos de un técnico, ABIERTOS O YA CERRADOS, dentro de una ventana de días.
 * Respaldo de la versión de PostgreSQL.
 *
 * Devuelve una LISTA porque un técnico que atiende varios administradores tiene varios casos
 * recientes a la vez: quedarse con "el último" le imputaría la factura al edificio equivocado.
 */
async function buscarCasosRecientesPorTecnico(nombreTecnico, telefonoTecnico = '', dias = 30) {
    const techBuscado = String(nombreTecnico || '').toLowerCase().trim();
    const telTecnico = String(telefonoTecnico || '').replace(/\D/g, '');
    if (!techBuscado && !telTecnico) return [];

    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return [];

        const desde = Date.now() - dias * 24 * 60 * 60 * 1000;
        const mismoTelefono = (a, b) => {
            const x = String(a || '').replace(/\D/g, '');
            const y = String(b || '').replace(/\D/g, '');
            if (!x || !y) return false;
            return x === y || x.endsWith(y.slice(-8)) || y.endsWith(x.slice(-8));
        };

        const rows = (await sheet.getRows())
            .filter(r => {
                const f = r.get('fecha');
                if (!f) return true;
                const t = new Date(f).getTime();
                return Number.isNaN(t) ? true : t >= desde;
            })
            .filter(r => {
                if (telTecnico && mismoTelefono(r.get('tel_tecnico'), telTecnico)) return true;
                if (!techBuscado) return false;
                const rTech = String(r.get('tecnico') || '').toLowerCase().trim();
                return Boolean(rTech) && (rTech.includes(techBuscado) || techBuscado.includes(rTech));
            });

        return rows.reverse().map(row => {
            const estado = String(row.get('estado') || '').toLowerCase().trim();
            return {
                id_evento: row.get('id_evento') || '',
                edificio:  row.get('edificio') || '',
                telefono:  row.get('telefono') || '',
                vecino:    row.get('vecino') || '',
                problema:  row.get('mensaje') || row.get('notas') || '',
                estado:    row.get('estado') || '',
                cerrado:   estado === 'resuelto' || estado === 'cerrado',
                fecha:     row.get('fecha') || '',
            };
        });
    } catch (err) {
        console.error('Error buscando los casos recientes del técnico:', err.message);
        return [];
    }
}

// Devuelve todos los edificios conocidos con sus aliases
// Retorna: [{ nombre: '...', aliases: ['...', '...'] }]
async function listarEdificiosConocidos() {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EDIFICIOS');
        if (!sheet) return [];
        const rows = await sheet.getRows();
        const edificios = rows
            .map(r => {
                const nombre = (r.get('nombre') || r.get('edificio') || r.get('consorcio') || '').trim();
                const direccion = (r.get('direccion') || '').trim();
                const rawAliases = (r.get('aliases') || '').split(',').map(a => a.trim()).filter(Boolean);
                
                if (!nombre && !direccion) return null;

                const aliasesSet = new Set(rawAliases);
                if (direccion) aliasesSet.add(direccion);
                if (nombre) aliasesSet.add(nombre);

                return {
                    nombre: nombre || direccion,
                    direccion: direccion,
                    aliases: Array.from(aliasesSet),
                };
            })
            .filter(Boolean);
        console.log(`📊 Total edificios cargados del Sheet: ${edificios.length}`);
        edificios.forEach(e => console.log(`   - [${e.nombre}] Dir: ${e.direccion} Aliases: ${e.aliases.join(', ')}`));
        return edificios;
    } catch (err) {
        console.error('Error listando edificios:', err.message);
        return [];
    }
}

// ─────────────────────────────────────────────
// MEMORIA DE 60 DÍAS
// Pestaña: memoria
// Columnas: telefono | nombre | fecha_ultimo_contacto | resumen_historial | notas_trato
// ─────────────────────────────────────────────

async function buscarMemoriaVecino(telefono) {
    try {
        const doc = await getSheet();
        let sheet = pestaña(doc, 'memoria');
        if (!sheet) return null;

        const rows = await sheet.getRows();
        const telBuscado = String(telefono).replace(/\D/g, '');

        const row = rows.find(r =>
            String(r.get('telefono') || '').replace(/\D/g, '') === telBuscado
        );

        if (!row) return null;

        // Verificar que el último contacto esté dentro de los 60 días
        const fechaUltimo = new Date(row.get('fecha_ultimo_contacto') || 0);
        const diasDesde = (Date.now() - fechaUltimo) / (1000 * 60 * 60 * 24);

        if (diasDesde > 60) {
            console.log(`ℹ️ Memoria de ${telefono} expiró (${Math.round(diasDesde)} días).`);
            return null;
        }

        return {
            resumenHistorial: row.get('resumen_historial') || '',
            notasTrato:       row.get('notas_trato')       || '',
            fechaUltimo:      row.get('fecha_ultimo_contacto') || '',
            _row:             row, // referencia para actualizar
        };
    } catch (err) {
        console.error('Error buscando memoria de vecino:', err.message);
        return null;
    }
}

async function guardarMemoriaVecino({ telefono, nombre, resumenHistorial, notasTrato }) {
    try {
        const doc = await getSheet();
        let sheet = pestaña(doc, 'memoria');

        if (!sheet) {
            sheet = await doc.addSheet({
                title: 'memoria',
                headerValues: ['telefono', 'nombre', 'fecha_ultimo_contacto', 'resumen_historial', 'notas_trato'],
            });
            console.log('🧠 Pestaña memoria creada.');
        }

        const rows = await sheet.getRows();
        const telBuscado = String(telefono).replace(/\D/g, '');
        const existing = rows.find(r =>
            String(r.get('telefono') || '').replace(/\D/g, '') === telBuscado
        );

        const fecha = fechaHoraAR();

        if (existing) {
            existing.set('fecha_ultimo_contacto', fecha);
            existing.set('resumen_historial', resumenHistorial || existing.get('resumen_historial'));
            existing.set('notas_trato', notasTrato || existing.get('notas_trato'));
            await existing.save();
            console.log(`🧠 Memoria actualizada para ${nombre}`);
        } else {
            await sheet.addRow({
                telefono,
                nombre:                 nombre || '',
                fecha_ultimo_contacto:  fecha,
                resumen_historial:      resumenHistorial || '',
                notas_trato:            notasTrato || '',
            });
            console.log(`🧠 Nueva memoria creada para ${nombre}`);
        }
    } catch (err) {
        console.error('Error guardando memoria de vecino:', err.message);
    }
}

// ─────────────────────────────────────────────
// REPORTES DE CASOS
// ─────────────────────────────────────────────

async function guardarReporte({ edificio, vecino, depto, problema, urgencia, estado, notas, notas_ia, fechaInicio, tipo = 'whatsapp', telefono = '', audio_url = '', transcripcion = '', historial_chat = '', id_evento = '', tecnico = '', tel_tecnico = '', rubro_tecnico = '' }) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return null;

        // Todas las columnas que esta función escribe. Si alguna no existe, `addRow` la descarta
        // sin decir nada: por eso se crean acá y por eso `asegurarColumnas` avisa si no puede.
        const headersNecesarios = ['id_evento', 'fecha', 'edificio', 'vecino', 'depto', 'unidad', 'mensaje', 'tipo', 'urgencia', 'estado', 'notas', 'feedback', 'telefono', 'tecnico', 'tel_tecnico', 'rubro_tecnico', 'hora_fin', 'audio_url', 'transcripcion', 'historial_chat', 'audios_json', 'involucrados_json', 'chat_vecino_json', 'chat_proveedor_json', 'tecnico_notificado'];
        await asegurarColumnas(sheet, headersNecesarios, 'EVENTOS');

        const rows = await sheet.getRows();
        const telBuscado = String(telefono || '').replace(/\D/g, '');
        
        let rowExistente = null;

        // 1. Buscar si nos pasaron un id_evento específico (ej: CASO-1042)
        if (id_evento) {
            rowExistente = [...rows].reverse().find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        }

        // ── ¿ES EL MISMO CASO O ES OTRO? ────────────────────────────────────────────────────
        //
        // Los pasos 2 y 3 enganchan un mensaje al caso abierto del mismo vecino o del mismo
        // edificio. Eso es lo correcto mientras la conversación siga siendo SOBRE LO MISMO: el
        // vecino manda una foto, pregunta si viene el técnico, agradece.
        //
        // Pero un reclamo NUEVO no es la continuación de nada. Con la regla vieja, mientras
        // CASO-1001 siguiera abierto, todo lo que dijera ese vecino caía adentro: una lámpara
        // quemada terminaba pegada a la pérdida de agua de la semana pasada, con un solo técnico
        // asignado y una sola plantilla mandada. En el log se veía "Técnico ya notificado del
        // [CASO-1001], se omite el reenvío duplicado" -- que parece una decisión correcta y era
        // el bug: el técnico del caso nuevo nunca se enteraba.
        //
        // Lo que distingue un reclamo nuevo es el RUBRO: una lámpara no es una canilla. Si el
        // mensaje trae un problema propio y su rubro no es el del caso abierto, es otro caso.
        // Si el rubro coincide, o si el mensaje no trae problema (es la cola de algo ya contado),
        // se sigue enganchando como antes.
        const { coincideRubro } = require('./rubros');
        const rubroEntrante = String(rubro_tecnico || '').trim();
        const traeProblemaPropio = Boolean(String(problema || '').trim());

        const esOtroCaso = (r) => {
            if (!traeProblemaPropio || !rubroEntrante) return false;  // sin con qué comparar, no se separa
            const rubroDelCaso = String(r.get('rubro_tecnico') || '').trim();
            if (!rubroDelCaso) return false;                          // el caso viejo no tiene rubro: no se puede afirmar
            return !coincideRubro(rubroDelCaso, rubroEntrante);
        };

        // 2. Buscar por teléfono y edificio si no se encontró por ID
        if (!rowExistente && telBuscado && telBuscado.length >= 6) {
            rowExistente = [...rows].reverse().find(r => {
                const rTel = String(r.get('telefono') || '').replace(/\D/g, '');
                const rEdif = String(r.get('edificio') || '').toLowerCase();
                const eBuscado = String(edificio || '').toLowerCase();
                const rEst = String(r.get('estado') || '').toLowerCase().trim();
                if (!((rTel === telBuscado || rTel.includes(telBuscado)) && (rEdif === eBuscado || !eBuscado) && rEst !== 'resuelto' && rEst !== 'cerrado')) return false;
                if (esOtroCaso(r)) {
                    console.log(`🆕 ${vecino || telBuscado} tiene abierto el [${r.get('id_evento')}] de "${r.get('rubro_tecnico')}", pero esto es de "${rubroEntrante}": se abre un caso nuevo.`);
                    return false;
                }
                return true;
            });
        }

        // 3. Buscar evento activo no resuelto del edificio si escribe otro participante o técnico
        if (!rowExistente && edificio && edificio !== 'No especificado') {
            const eBuscado = String(edificio).toLowerCase().trim();
            rowExistente = [...rows].reverse().find(r => {
                const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
                const rEst = String(r.get('estado') || '').toLowerCase().trim();
                if (!(rEdif === eBuscado && rEst !== 'resuelto' && rEst !== 'cerrado')) return false;
                if (esOtroCaso(r)) {
                    console.log(`🆕 En ${edificio} está abierto el [${r.get('id_evento')}] de "${r.get('rubro_tecnico')}", pero esto es de "${rubroEntrante}": se abre un caso nuevo.`);
                    return false;
                }
                return true;
            });
        }

        // 4. La cola del caso que ACABA de cerrarse.
        //
        // Los tres pasos de arriba exigen un caso abierto, y una conversación no termina cuando el
        // caso se cierra: el vecino agradece, el técnico manda la factura del trabajo que hizo. Esos
        // mensajes ya no encontraban dónde meterse y abrían un caso nuevo cada uno. Visto en
        // producción: un solo desperfecto quedó partido en CASO-1001, CASO-1002 y CASO-1003, y el
        // motivo de cierre del 1002 decía "el vecino confirma la resolución del caso 1001".
        //
        // Lo que los delata es que NO traen un problema propio: son la cola de algo ya contado. Un
        // reclamo nuevo de verdad siempre viene con su descripción, así que sigue abriendo su caso.
        const esSeguimientoSinProblemaNuevo = !String(problema || '').trim();
        let unificadoEnCerrado = false;
        if (!rowExistente && esSeguimientoSinProblemaNuevo) {
            const eBuscado = String(edificio || '').toLowerCase().trim();
            rowExistente = [...rows].reverse().find(r => {
                const rTel = String(r.get('telefono') || '').replace(/\D/g, '');
                const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
                const coincideTel = telBuscado && telBuscado.length >= 6 && rTel && (rTel === telBuscado || rTel.includes(telBuscado));
                const coincideEdif = eBuscado && rEdif === eBuscado;
                return coincideTel || coincideEdif;
            });
            if (rowExistente) {
                const estCerrado = String(rowExistente.get('estado') || '').toLowerCase().trim();
                unificadoEnCerrado = estCerrado === 'resuelto' || estCerrado === 'cerrado';
                if (unificadoEnCerrado) {
                    console.log(`🔗 Mensaje sin problema nuevo asociado al [${rowExistente.get('id_evento')}], que ya estaba cerrado, en vez de abrir un caso nuevo.`);
                }
            }
        }

        const notasFinales = notas || notas_ia || (rowExistente ? rowExistente.get('notas') : '');

        // Manejar lista acumulativa de audios (audios_json)
        let audiosLista = [];
        if (rowExistente) {
            try {
                const rawAudios = rowExistente.get('audios_json');
                if (rawAudios) audiosLista = JSON.parse(rawAudios);
            } catch(e) {}
        }
        if (audio_url) {
            const yaExiste = audiosLista.some(a => a.url === audio_url);
            if (!yaExiste) {
                audiosLista.push({
                    url: audio_url,
                    transcripcion: transcripcion || '',
                    fecha: fechaHoraAR(),
                    vecino: vecino || 'Vecino',
                    telefono: telefono || ''
                });
            }
        }

        // Manejar lista acumulativa de participantes involucrados (involucrados_json)
        let involucradosLista = [];
        if (rowExistente) {
            try {
                const rawInv = rowExistente.get('involucrados_json');
                if (rawInv) involucradosLista = JSON.parse(rawInv);
            } catch(e) {}
        }
        // REGLA: todo número que participa de un caso queda registrado en el caso.
        //
        // Sea por WhatsApp o por llamada, el administrador tiene que poder ver a quién hablarle
        // sin salir a buscar el número por otro lado. Antes solo se anotaba el teléfono del
        // vecino: el del técnico viajaba en `tel_tecnico` y no entraba a esta lista, así que en
        // un caso donde intervinieron tres personas figuraba una sola.
        const sumarInvolucrado = (tel, nombre, rol, deptoDe = '') => {
            const limpio = String(tel || '').replace(/\D/g, '');
            if (!limpio || limpio.length < 6) return;
            const yaEsta = involucradosLista.some(i => String(i.telefono).replace(/\D/g, '') === limpio);
            if (yaEsta) return;
            involucradosLista.push({
                nombre: nombre || 'Participante',
                telefono: tel,
                rol,
                depto: deptoDe || '',
                fecha: fechaHoraAR(),
            });
        };

        sumarInvolucrado(telefono, vecino, 'vecino', depto);
        sumarInvolucrado(tel_tecnico, tecnico, rubro_tecnico ? `técnico (${rubro_tecnico})` : 'técnico');

        // Manejar chats independientes: chat_vecino_json y chat_proveedor_json
        let chatVecinoLista = [];
        let chatProveedorLista = [];
        if (rowExistente) {
            try {
                const rawCV = rowExistente.get('chat_vecino_json');
                if (rawCV) chatVecinoLista = JSON.parse(rawCV);
            } catch(e) {}
            try {
                const rawCP = rowExistente.get('chat_proveedor_json');
                if (rawCP) chatProveedorLista = JSON.parse(rawCP);
            } catch(e) {}
        }

        let chatNuevosArr = [];
        try {
            if (typeof historial_chat === 'string' && historial_chat.startsWith('[')) chatNuevosArr = JSON.parse(historial_chat);
            else if (Array.isArray(historial_chat)) chatNuevosArr = historial_chat;
            else if (historial_chat) chatNuevosArr = String(historial_chat).split('\n').filter(Boolean);
        } catch(e) {}

        let esContextoProveedor = false;
        chatNuevosArr.forEach(m => {
            const strM = typeof m === 'object' ? (m.emisor ? m.emisor + ': ' + (m.texto || m.mensaje || '') : JSON.stringify(m)) : String(m || '');
            // Las preguntas de seguimiento ("¿pudiste ir?", "¿resolviste el reclamo?") y todo lo
            // que habla de una factura van al chat del PROVEEDOR: son de él, no del vecino. Sin
            // esto caían en la columna del vecino y el visor las mostraba mezcladas.
            const isProv = /proveedor|t.cnico|instalador|plomero|electricista|gasista|marcos ➔ proveedor|marcos -> proveedor|marcos \(a proveedor\)|pudiste ir|pudiste realizar|pudiste asistir|pudiste pasar|resolviste el reclamo|solucionaste el reclamo|factura|comprobante|\[factura:/i.test(strM);

            if (isProv) {
                esContextoProveedor = true;
                if (!chatProveedorLista.includes(strM)) chatProveedorLista.push(strM);
            } else if (esContextoProveedor && /^marcos/i.test(strM.trim())) {
                const strFormatted = strM.replace(/^marcos:/i, 'Marcos (a Proveedor):');
                if (!chatProveedorLista.includes(strFormatted) && !chatProveedorLista.includes(strM)) {
                    chatProveedorLista.push(strFormatted);
                }
            } else {
                esContextoProveedor = false;
                if (!chatVecinoLista.includes(strM)) chatVecinoLista.push(strM);
            }
        });

        if (rowExistente) {
            const codigoCasoExistente = rowExistente.get('id_evento') || `CASO-${1000 + rowExistente._row}`;
            if (!rowExistente.get('id_evento')) rowExistente.set('id_evento', codigoCasoExistente);
            if (edificio && edificio !== 'No especificado' && (!rowExistente.get('edificio') || rowExistente.get('edificio') === 'No especificado')) rowExistente.set('edificio', edificio);
            if (vecino && vecino !== 'Desconocido' && (!rowExistente.get('vecino') || rowExistente.get('vecino') === 'Desconocido')) rowExistente.set('vecino', vecino);
            if (depto && !rowExistente.get('depto')) rowExistente.set('depto', depto);
            if (problema && !rowExistente.get('mensaje')) rowExistente.set('mensaje', problema);
            if (urgencia) rowExistente.set('urgencia', urgencia);
            // Un caso cerrado no se reabre por su propia cola: la factura del trabajo terminado
            // llega con estado "en_proceso" por defecto, y sin este reparo devolvía a la vida un
            // caso que el vecino y el técnico ya habían dado por resuelto.
            const estadoNuevoEsCierre = ['resuelto', 'cerrado'].includes(String(estado || '').toLowerCase().trim());
            if (estado && !(unificadoEnCerrado && !estadoNuevoEsCierre)) rowExistente.set('estado', estado);

            // Al cerrar un caso hay que levantar la cita que quedó agendada. El seguimiento se
            // programa cuando el técnico confirma ("controlar dentro de 3 horas") y vive en la fila;
            // cerrar el caso no lo tocaba, así que el control vencía igual y arrancaba a preguntar
            // por un trabajo ya terminado: al técnico si pudo pasar -- cuando ya había pasado y
            // facturado --, al vecino si vino el técnico, y al final un mail a la Administración
            // avisando que nadie confirmó la visita.
            if (estadoNuevoEsCierre) {
                rowExistente.set('proximo_seguimiento', '');
                rowExistente.set('seguimiento_paso', '');
                rowExistente.set('seguimiento_nota', '');
            }
            if (notasFinales) rowExistente.set('notas', notasFinales);
            if (tecnico) rowExistente.set('tecnico', tecnico);
            if (tel_tecnico) rowExistente.set('tel_tecnico', tel_tecnico);

            // EL RUBRO DE UN CASO NO SE REESCRIBE: se completa si está vacío y nada más.
            //
            // La mayoría de los `guardarReporte` de un proveedor son para dejar la conversación
            // registrada -- no traen problema propio, solo el chat. Pero igual mandaban su
            // `rubro_tecnico`, que sale del oficio de la ficha del técnico, y le pisaban la
            // clasificación al caso. Un caso de plomería quedaba marcado "Electricista" porque el
            // electricista mandó un mensaje adentro.
            //
            // Con el rubro pisado se cae todo lo que depende de él, y de la peor forma: parece
            // bien puesto. Deja de poder distinguirse un reclamo nuevo del abierto, cuál de los
            // técnicos de una línea compartida escribió, y a qué caso va una factura.
            //
            // Corregir un rubro mal puesto es una decisión, no un efecto secundario de que
            // alguien haya escrito algo.
            if (rubro_tecnico && !String(rowExistente.get('rubro_tecnico') || '').trim()) {
                rowExistente.set('rubro_tecnico', rubro_tecnico);
            }
            if (audio_url) rowExistente.set('audio_url', audio_url);
            if (transcripcion) rowExistente.set('transcripcion', transcripcion);
            if (audiosLista.length > 0) rowExistente.set('audios_json', JSON.stringify(audiosLista));
            if (involucradosLista.length > 0) rowExistente.set('involucrados_json', JSON.stringify(involucradosLista));
            if (chatVecinoLista.length > 0) rowExistente.set('chat_vecino_json', JSON.stringify(chatVecinoLista));
            if (chatProveedorLista.length > 0) rowExistente.set('chat_proveedor_json', JSON.stringify(chatProveedorLista));

            const chatCombinado = Array.from(new Set([...chatVecinoLista, ...chatProveedorLista]));
            if (chatCombinado.length > 0) {
                rowExistente.set('historial_chat', JSON.stringify(chatCombinado));
            }

            await rowExistente.save();
            console.log(`📊 Evento [${codigoCasoExistente}] unificado/actualizado en Sheets con chats independientes para ${edificio || vecino}`);
            return { id_evento: codigoCasoExistente, unificado: true };
        } else {
            // ── CANDADO CONTRA EVENTOS FANTASMA ──────────────────────────────────────────────
            //
            // Llegar acá significa "no encontré a qué caso pertenece esto, abro uno nuevo". Está
            // bien para un reclamo, y muy mal para un mensaje que solo viene a PEGAR CONVERSACIÓN
            // en un caso: esas llamadas traen historial_chat y nada más -- ni problema, ni vecino,
            // ni teléfono, ni urgencia --, así que la fila que se creaba salía vacía. En el panel
            // se veía como un evento titulado "Evento", vecino "Desconocido", urgencia "Baja".
            //
            // Pasó de verdad: el técnico mandó la factura de un trabajo en "SAN PATRICIO 159", el
            // motor dedujo el edificio de la dirección impresa en el PDF ("san patricio 270"), no
            // encontró ninguna fila con ese nombre y abrió un evento fantasma.
            //
            // Un mensaje sin nada que contar no puede fundar un caso. Si no encontramos dónde
            // pegarlo, se pierde el pegado -- no se inventa un caso para alojarlo.
            const soloEsPegarChat = !String(problema || '').trim()
                && !String(telefono || '').trim()
                && !String(vecino || '').trim()
                && !String(id_evento || '').trim()
                && chatNuevosArr.length > 0;

            if (soloEsPegarChat) {
                console.log(`🚫 Mensaje de seguimiento sin caso al que pertenecer (edificio: "${edificio || '—'}", técnico: "${tecnico || '—'}"). No se abre un evento nuevo para alojarlo.`);
                return null;
            }

            // Generar nuevo código correlativo CASO-XXXX
            let maxNum = 1000;
            rows.forEach(r => {
                const rawId = String(r.get('id_evento') || '');
                const m = rawId.match(/CASO-(\d+)/i);
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (n > maxNum) maxNum = n;
                }
            });
            const nuevoCodigoCaso = id_evento || `CASO-${maxNum + 1}`;

            const chatCombinado = Array.from(new Set([...chatVecinoLista, ...chatProveedorLista]));

            await sheet.addRow({
                id_evento:          nuevoCodigoCaso,
                fecha:              fechaInicio || fechaHoraAR(),
                hora_fin:           new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
                telefono:           telefono || '',
                edificio:           edificio|| 'No especificado',
                vecino:             vecino  || 'Desconocido',
                depto:              depto   || '',
                mensaje:            problema|| '',
                tipo:               tipo    || 'whatsapp',
                urgencia:           urgencia|| '',
                estado:             estado  || 'nuevo',
                notas:              notasFinales,
                tecnico:            tecnico || '',
                tel_tecnico:        tel_tecnico || '',
                rubro_tecnico:      rubro_tecnico || '',
                audio_url:          audio_url || '',
                transcripcion:      transcripcion || '',
                historial_chat:     chatCombinado.length > 0 ? JSON.stringify(chatCombinado) : '',
                audios_json:        audiosLista.length > 0 ? JSON.stringify(audiosLista) : '',
                involucrados_json:  involucradosLista.length > 0 ? JSON.stringify(involucradosLista) : '',
                chat_vecino_json:   chatVecinoLista.length > 0 ? JSON.stringify(chatVecinoLista) : '',
                chat_proveedor_json: chatProveedorLista.length > 0 ? JSON.stringify(chatProveedorLista) : ''
            });
            console.log(`📊 Nuevo reporte guardado con código [${nuevoCodigoCaso}] y chats independientes para: ${edificio || vecino}`);
            return { id_evento: nuevoCodigoCaso, unificado: false };
        }
    } catch (err) {
        console.error('Error guardando reporte:', err.message);
        return null;
    }
}

// Chequeo de plantilla ya enviada al técnico, persistido en Sheets (no solo en memoria RAM).
// La deduplicación en memoria (global.colasProveedores) se pierde en cada reinicio de PM2 --
// muy frecuente durante desarrollo activo -- y eso hacía que el técnico recibiera la misma
// plantilla de Meta de nuevo apenas se reiniciaba el proceso entre dos mensajes del mismo caso.
// El aviso al administrador es una ESCALACIÓN: se manda cuando el caso necesita que él tome las
// riendas, y una sola vez. Sin esta marca salía un mail por cada mensaje del vecino -- tres correos
// de la misma puerta en una conversación.
async function fueAdminNotificado(id_evento) {
    if (!id_evento) return false;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return false;
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        return !!(row && row.get('admin_notificado'));
    } catch (err) {
        console.error('Error chequeando admin_notificado:', err.message);
        return false;
    }
}

async function marcarAdminNotificado(id_evento, motivo = '') {
    if (!id_evento) return;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return;
        await asegurarColumnas(sheet, ['admin_notificado'], 'EVENTOS');
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        if (row) {
            row.set('admin_notificado', `${fechaHoraAR()}${motivo ? ` — ${motivo}` : ''}`);
            await row.save();
        }
    } catch (err) {
        console.error('Error marcando admin_notificado:', err.message);
    }
}

// Si al técnico ya se le pasó el contacto de quien le abre. La marca vive en el caso porque la de
// la sesión se borraba en cada reinicio de PM2, y el técnico recibía el mismo "CONTACTO PARA EL
// INGRESO" una vez por cada mensaje del vecino.
async function fueContactoAccesoAvisado(id_evento) {
    if (!id_evento) return false;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return false;
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        return !!(row && row.get('contacto_acceso_avisado'));
    } catch (err) {
        console.error('Error chequeando contacto_acceso_avisado:', err.message);
        return false;
    }
}

async function marcarContactoAccesoAvisado(id_evento) {
    if (!id_evento) return;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return;
        await asegurarColumnas(sheet, ['contacto_acceso_avisado'], 'EVENTOS');
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        if (row) {
            row.set('contacto_acceso_avisado', fechaHoraAR());
            await row.save();
        }
    } catch (err) {
        console.error('Error marcando contacto_acceso_avisado:', err.message);
    }
}

// Si la foto o el video que mandó el vecino ya le llegó al técnico. Igual que la marca de
// contacto de acceso, vive en el caso y no en la sesión: el envío puede fallar (Meta rechaza todo
// lo que no sea plantilla mientras la ventana de 24hs está cerrada) y hay que poder reintentarlo
// cuando el técnico escribe, que es el momento en que la ventana se abre. Sin esta marca no hay
// forma de saber si el reintento hace falta o si sería el mismo adjunto por segunda vez.
async function fueMaterialEnviadoATecnico(id_evento) {
    if (!id_evento) return false;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return false;
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        return !!(row && row.get('material_enviado_tecnico'));
    } catch (err) {
        console.error('Error chequeando material_enviado_tecnico:', err.message);
        return false;
    }
}

async function marcarMaterialEnviadoATecnico(id_evento) {
    if (!id_evento) return;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return;
        await asegurarColumnas(sheet, ['material_enviado_tecnico'], 'EVENTOS');
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        if (row) {
            row.set('material_enviado_tecnico', fechaHoraAR());
            await row.save();
        }
    } catch (err) {
        console.error('Error marcando material_enviado_tecnico:', err.message);
    }
}

async function fueTecnicoNotificado(id_evento) {
    if (!id_evento) return false;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return false;
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        return !!(row && row.get('tecnico_notificado'));
    } catch (err) {
        console.error('Error chequeando tecnico_notificado:', err.message);
        return false;
    }
}

async function marcarTecnicoNotificado(id_evento) {
    if (!id_evento) return;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return;
        await asegurarColumnas(sheet, ['tecnico_notificado'], 'EVENTOS');
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        if (row) {
            row.set('tecnico_notificado', fechaHoraAR());
            await row.save();
        }
    } catch (err) {
        console.error('Error marcando tecnico_notificado:', err.message);
    }
}

// ─────────────────────────────────────────────
// FACTURAS / CONTABILIDAD
// ─────────────────────────────────────────────

// `nota_tecnico` guarda TEXTUAL lo que escribió quien mandó el comprobante, y no es un adorno:
// ahí viene la indicación que después hace falta poder probar ("hasta acá llegué, hay que llamar
// al plomero"). Viaja pegada a la factura y no solo al evento, porque cuando todavía no sabemos
// de qué edificio es no hay ningún evento donde ponerla -- y perderla sería justamente perder la
// única constancia de que el aviso existió.
async function guardarFactura({ proveedor, monto, concepto, edificio, url_archivo, numero_factura, estado, nota_tecnico, enviada_por, id_evento = '' }) {
    try {
        const doc = await getSheet();
        let sheet = pestaña(doc, 'facturas');

        // `id_evento` faltaba: el caso al que se imputó la factura se le decía al técnico por
        // WhatsApp ("la dejé asociada al CASO-1001") y no quedaba escrito en ningún lado. Sin eso
        // no hay forma de saber si un caso ya tiene su comprobante, y cada factura nueva se
        // pegaba al mismo caso viejo una y otra vez.
        const headersNecesarios = ['fecha', 'proveedor', 'monto', 'concepto', 'edificio', 'url_archivo', 'numero_factura', 'estado', 'nota_tecnico', 'enviada_por', 'id_evento'];

        if (!sheet) {
            // Antes esto miraba `doc.sheetsByTitle['facturas']`, que distingue mayúsculas: con la
            // pestaña llamada "Facturas" no la encontraba y creaba UNA SEGUNDA. Las facturas se
            // guardaban en la pestaña nueva y el que miraba la vieja las daba por perdidas.
            // `pestaña()` la encuentra escrita como esté; llegar acá ahora sí significa que no
            // existe ninguna.
            console.log('🧾 No existe la pestaña de facturas: se crea.');
            sheet = await doc.addSheet({ title: 'facturas', headerValues: headersNecesarios });
        }

        await asegurarColumnas(sheet, headersNecesarios, 'facturas');

        // ── LA MISMA FACTURA DOS VECES ───────────────────────────────────────────────────
        //
        // El técnico reenvía el mismo PDF -- porque no vio la respuesta, porque lo manda de nuevo
        // junto con otros, porque el celular lo repitió. Sin este control se registra otra vez y
        // el administrador ve el gasto duplicado en el total.
        //
        // El número de comprobante es lo que la identifica. Sin número no se puede afirmar nada,
        // así que se guarda igual: perder una factura es peor que tener dos.
        // Los ceros de adelante no son parte del número: el mismo comprobante llega escrito
        // "0001-00000284" o "00001-00000284" según de dónde salga el dato (lo tipeó el técnico, lo
        // leyó el OCR del PDF). Comparar los dígitos tal cual los daba por facturas distintas y
        // el gasto quedaba duplicado igual.
        const numeroComparable = (n) => String(n || '').replace(/\D/g, '').replace(/^0+/, '');
        const numLimpio = numeroComparable(numero_factura);
        if (numLimpio) {
            const filas = await sheet.getRows();
            const yaEsta = filas.find(r =>
                numeroComparable(r.get('numero_factura')) === numLimpio &&
                String(r.get('proveedor') || '').toLowerCase().trim() === String(proveedor || '').toLowerCase().trim()
            );
            if (yaEsta) {
                console.log(`💸 La factura N° ${numero_factura} de ${proveedor} ya estaba registrada: no se duplica.`);
                return {
                    duplicada: true,
                    edificio: yaEsta.get('edificio') || '',
                    id_evento: yaEsta.get('id_evento') || '',
                    fecha: yaEsta.get('fecha') || '',
                };
            }
        }

        await sheet.addRow({
            fecha:          fechaHoraAR(),
            proveedor:      proveedor  || 'Desconocido',
            monto:          monto      || '0',
            concepto:       concepto   || '',
            edificio:       edificio   || 'No especificado',
            url_archivo:    url_archivo|| '',
            numero_factura: numero_factura || '',
            estado:         estado     || 'Pendiente',
            nota_tecnico:   nota_tecnico || '',
            enviada_por:    enviada_por  || '',
            id_evento:      id_evento    || ''
        });

        console.log(`💸 Factura de ${proveedor} por ${monto} guardada${id_evento ? ` (${id_evento})` : ''}.`);
        return { duplicada: false };
    } catch (err) {
        console.error('Error guardando factura:', err.message);
        return { duplicada: false, error: err.message };
    }
}

/**
 * Si un caso ya tiene una factura imputada.
 *
 * POR QUÉ. Cuando el técnico tiene UN solo caso reciente, Marcos le imputaba ahí todas las
 * facturas que fuera mandando. Con un técnico que trabaja para once administradores eso es
 * garantizado: manda seis comprobantes de trabajos distintos y los seis terminan pegados al mismo
 * caso, con el total sumado en el consorcio equivocado.
 *
 * Que el caso ya tenga su comprobante es la señal de que la siguiente factura es de otra cosa. Ahí
 * no se adivina: se pregunta.
 */
async function casoYaTieneFactura(id_evento) {
    if (!id_evento) return false;
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'facturas');
        if (!sheet) return false;
        await sheet.loadHeaderRow().catch(() => {});
        if (!(sheet.headerValues || []).includes('id_evento')) return false;
        const filas = await sheet.getRows();
        return filas.some(r => String(r.get('id_evento') || '').toUpperCase().trim() === String(id_evento).toUpperCase().trim());
    } catch (err) {
        console.error('Error mirando si el caso ya tiene factura:', err.message);
        return false;   // ante la duda no se bloquea la imputación
    }
}

// Busca facturas de un proveedor (opcionalmente filtrando por edificio y/o número de
// comprobante) para que Marcos pueda contestar "¿ya me pagaron la factura X?" con el estado
// real cargado en Sheets, en vez de inventar una respuesta.
async function buscarFacturasProveedor({ proveedor, edificio = '', numeroFactura = '' }) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'facturas');
        if (!sheet) return [];

        const rows = await sheet.getRows();
        const provBuscado = String(proveedor || '').toLowerCase().trim();
        const edifBuscado = String(edificio || '').toLowerCase().trim();
        const numBuscado = String(numeroFactura || '').replace(/\D/g, '');

        const coincidencias = rows.filter(r => {
            const rProv = String(r.get('proveedor') || '').toLowerCase().trim();
            const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
            const rNum = String(r.get('numero_factura') || '').replace(/\D/g, '');

            const matchProv = provBuscado && (rProv.includes(provBuscado) || provBuscado.includes(rProv));
            if (!matchProv) return false;

            if (numBuscado) return rNum && rNum === numBuscado;
            if (edifBuscado) return rEdif.includes(edifBuscado) || edifBuscado.includes(rEdif);
            return true;
        });

        return coincidencias.map(r => ({
            fecha: r.get('fecha'),
            monto: r.get('monto'),
            concepto: r.get('concepto'),
            edificio: r.get('edificio'),
            numero_factura: r.get('numero_factura'),
            estado: r.get('estado') || 'Pendiente',
        })).reverse(); // más reciente primero
    } catch (err) {
        console.error('Error buscando facturas del proveedor:', err.message);
        return [];
    }
}

/**
 * Las facturas de un proveedor que quedaron SIN IMPUTAR a ningún edificio.
 *
 * Cuando Marcos no puede saber de qué edificio es un comprobante, lo guarda igual pero marcado
 * "Sin imputar" en vez de cargárselo a un consorcio adivinado, y le pregunta al técnico. Esta
 * consulta es la que permite retomar esa pregunta cuando el técnico contesta -- incluso si PM2
 * reinició en el medio, porque el pendiente vive en la planilla y no en memoria.
 */
async function buscarFacturasSinImputar({ proveedor }) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'facturas');
        if (!sheet) return [];

        const provBuscado = String(proveedor || '').toLowerCase().trim();
        if (!provBuscado) return [];

        const rows = await sheet.getRows();
        return rows
            .filter(r => {
                const rProv = String(r.get('proveedor') || '').toLowerCase().trim();
                if (!rProv || !(rProv.includes(provBuscado) || provBuscado.includes(rProv))) return false;
                const rEdif = String(r.get('edificio') || '').trim().toLowerCase();
                const rEst = String(r.get('estado') || '').trim().toLowerCase();
                return rEst === 'sin imputar' || !rEdif || rEdif === 'no especificado';
            })
            .map(r => ({
                _row: r._row ?? r.rowNumber,
                fecha: r.get('fecha'),
                monto: r.get('monto'),
                concepto: r.get('concepto'),
                numero_factura: r.get('numero_factura'),
                estado: r.get('estado') || '',
                // La indicación que dejó quien la mandó, para poder armar el evento recién cuando
                // se sepa el edificio.
                nota_tecnico: r.get('nota_tecnico') || '',
                enviada_por: r.get('enviada_por') || '',
            }))
            .reverse();
    } catch (err) {
        console.error('Error buscando facturas sin imputar:', err.message);
        return [];
    }
}

/**
 * Le pone edificio a las facturas que habían quedado sin imputar, cuando el técnico contesta de
 * cuál eran. Devuelve cuántas actualizó.
 *
 * Imputa SIEMPRE de a una (la más reciente sin edificio) salvo que se pida lo contrario: el
 * técnico que manda seis comprobantes de tres administradores distintos contesta una pregunta por
 * vez, y mandarlas todas al mismo edificio sería repetir el error que estamos arreglando.
 */
async function imputarFacturaSinEdificio({ proveedor, edificio, todas = false }) {
    try {
        if (!String(edificio || '').trim()) return 0;
        const doc = await getSheet();
        const sheet = pestaña(doc, 'facturas');
        if (!sheet) return 0;

        const provBuscado = String(proveedor || '').toLowerCase().trim();
        if (!provBuscado) return 0;

        const rows = await sheet.getRows();
        const pendientes = rows.filter(r => {
            const rProv = String(r.get('proveedor') || '').toLowerCase().trim();
            if (!rProv || !(rProv.includes(provBuscado) || provBuscado.includes(rProv))) return false;
            const rEdif = String(r.get('edificio') || '').trim().toLowerCase();
            const rEst = String(r.get('estado') || '').trim().toLowerCase();
            return rEst === 'sin imputar' || !rEdif || rEdif === 'no especificado';
        });

        const aTocar = todas ? pendientes : pendientes.slice(-1);
        for (const r of aTocar) {
            r.set('edificio', edificio);
            r.set('estado', 'Pendiente');
            await r.save();
        }

        if (aTocar.length) {
            console.log(`🧾 ${aTocar.length} factura(s) de ${proveedor} imputada(s) a "${edificio}".`);
        }
        return aTocar.length;
    } catch (err) {
        console.error('Error imputando la factura al edificio:', err.message);
        return 0;
    }
}

// ─────────────────────────────────────────────
// LLAMADAS TELEFÓNICAS
// Pestaña: llamadas
// Columnas: fecha | duracion | telefono | vecino | edificio |
//           resumen | transcripcion | urgencia | estado | mensaje_enviado
// ─────────────────────────────────────────────

async function guardarLlamada({
    telefono, vecino, edificio, duracion,
    resumen, transcripcion, urgencia, estado, mensajeEnviado
}) {
    try {
        const doc = await getSheet();
        let sheet = pestaña(doc, 'llamadas');

        if (!sheet) {
            sheet = await doc.addSheet({
                title: 'llamadas',
                headerValues: [
                    'fecha', 'duracion', 'telefono', 'vecino', 'edificio',
                    'resumen', 'transcripcion', 'urgencia', 'estado', 'mensaje_enviado'
                ],
            });
            console.log('📞 Pestaña llamadas creada.');
        }

        await sheet.addRow({
            fecha:           fechaHoraAR(),
            duracion:        duracion        || '',
            telefono:        telefono        || '',
            vecino:          vecino          || 'Desconocido',
            edificio:        edificio        || 'No especificado',
            resumen:         resumen         || '',
            transcripcion:   transcripcion   || '',
            urgencia:        urgencia        || '',
            estado:          estado          || 'Finalizada',
            mensaje_enviado: mensajeEnviado  || '',
        });

        console.log(`📞 Llamada guardada en Sheets para: ${vecino} (${edificio})`);
    } catch (err) {
        console.error('Error guardando llamada:', err.message);
    }
}

// ─────────────────────────────────────────────
// FUNCIONES EJECUTIVAS MODO ADMINISTRADOR (AC)
// ─────────────────────────────────────────────
async function obtenerEventosPendientesAdmin() {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return [];
        const rows = await sheet.getRows();
        const pendientes = rows.filter(r => (r.get('estado') || '').toLowerCase() !== 'resuelto');
        return pendientes.map(r => ({
            id: r.get('id') || r.get('row_id'),
            edificio: r.get('edificio'),
            vecino: r.get('vecino'),
            depto: r.get('departamento'),
            problema: r.get('problema') || r.get('resumen_problema'),
            urgencia: r.get('urgencia'),
            estado: r.get('estado') || 'nuevo'
        }));
    } catch (err) {
        console.error('Error obteniendo eventos pendientes para Admin:', err.message);
        return [];
    }
}

async function obtenerCasosAbiertosEdificio(nombreEdificio) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return [];
        const rows = await sheet.getRows();
        const edifBuscado = String(nombreEdificio || '').toLowerCase().trim();

        const abiertos = rows.filter(r => {
            const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
            const rEst = String(r.get('estado') || '').toLowerCase().trim();
            const esAbierto = rEst !== 'resuelto' && rEst !== 'cerrado';
            if (!esAbierto) return false;
            return !edifBuscado || rEdif.includes(edifBuscado) || edifBuscado.includes(rEdif);
        });

        return abiertos.map(r => ({
            id_evento: r.get('id_evento') || `CASO-${1000 + r._row}`,
            edificio: r.get('edificio'),
            vecino: r.get('vecino'),
            depto: r.get('depto') || r.get('departamento'),
            problema: r.get('mensaje') || r.get('problema') || r.get('notas'),
            urgencia: r.get('urgencia') || 'media',
            estado: r.get('estado') || 'en_proceso',
            tecnico: r.get('tecnico') || '',
            telefono: r.get('telefono') || '',
            _row: r._row
        }));
    } catch (err) {
        console.error('Error obteniendo casos abiertos del edificio:', err.message);
        return [];
    }
}

async function marcarCasoResueltoPorId(idEvento) {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return null;
        const rows = await sheet.getRows();
        const idBuscado = String(idEvento || '').toUpperCase().trim();

        const row = [...rows].reverse().find(r => {
            const rId = String(r.get('id_evento') || '').toUpperCase().trim();
            const altId = `CASO-${1000 + r._row}`;
            return rId === idBuscado || altId === idBuscado;
        });

        if (row) {
            row.set('estado', 'resuelto');
            row.set('hora_fin', fechaHoraAR());
            // Se levanta la cita de control pendiente: un caso resuelto no tiene nada que seguir.
            row.set('proximo_seguimiento', '');
            row.set('seguimiento_paso', '');
            row.set('seguimiento_nota', '');
            await row.save();
            console.log(`✅ Caso [${idBuscado}] marcado como RESUELTO en Sheets.`);
            return {
                id_evento: row.get('id_evento') || idBuscado,
                edificio: row.get('edificio'),
                vecino: row.get('vecino'),
                depto: row.get('depto'),
                problema: row.get('mensaje') || row.get('problema'),
                tecnico: row.get('tecnico'),
                telefono: row.get('telefono')
            };
        }
        return null;
    } catch (err) {
        console.error('Error marcando caso resuelto por ID:', err.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// DETECCIÓN DE ROL POR TELÉFONO (Proveedor, Encargado, Admin, Vecino)
// ─────────────────────────────────────────────
async function buscarRolPorTelefono(telefono) {
    if (!telefono) return { rol: 'vecino' };
    const numLimpio = String(telefono).replace(/\D/g, '');
    if (!numLimpio || numLimpio.length < 6) return { rol: 'vecino' };

    try {
        const doc = await getSheet();

        // 1. Buscar en PROVEEDORES y ASIGNACIONES
        const sheetProv = pestaña(doc, 'proveedores') || pestaña(doc, 'tecnicos');
        if (sheetProv) {
            const rowsProv = await sheetProv.getRows();
            const provRow = rowsProv.find(r => {
                const rTel = String(r.get('telefono') || r.get('wsp') || '').replace(/\D/g, '');
                return rTel && (rTel === numLimpio || rTel.endsWith(numLimpio.slice(-8)) || numLimpio.endsWith(rTel.slice(-8)));
            });
            if (provRow) {
                return {
                    rol: 'proveedor',
                    nombre: provRow.get('nombre') || 'Proveedor',
                    especialidad: provRow.get('especialidad') || provRow.get('rubro') || 'técnico',
                    empresa: provRow.get('empresa') || '',
                    telefono: provRow.get('telefono') || telefono
                };
            }
        }

        const sheetAsig = pestaña(doc, 'proveedor_asignaciones');
        if (sheetAsig) {
            const rowsAsig = await sheetAsig.getRows();
            const asigRow = rowsAsig.find(r => {
                const rTel = String(r.get('telefono') || r.get('proveedor_telefono') || '').replace(/\D/g, '');
                return rTel && (rTel === numLimpio || rTel.endsWith(numLimpio.slice(-8)) || numLimpio.endsWith(rTel.slice(-8)));
            });
            if (asigRow) {
                return {
                    rol: 'proveedor',
                    nombre: asigRow.get('proveedor_nombre') || asigRow.get('nombre') || 'Proveedor',
                    especialidad: asigRow.get('rubro') || asigRow.get('especialidad') || 'técnico',
                    edificio: asigRow.get('edificio_nombre') || '',
                    telefono: asigRow.get('telefono') || telefono
                };
            }
        }

        // 2. Buscar en EDIFICIOS (Encargados y Seguridad)
        const sheetEdif = pestaña(doc, 'EDIFICIOS');
        if (sheetEdif) {
            const rowsEdif = await sheetEdif.getRows();
            for (const r of rowsEdif) {
                const telEnc = String(r.get('tel_encargado') || '').replace(/\D/g, '');
                const telSup = String(r.get('tel_suplente') || '').replace(/\D/g, '');
                const telSeg = String(r.get('tel_seguridad') || '').replace(/\D/g, '');
                if (telEnc && (telEnc === numLimpio || numLimpio.endsWith(telEnc.slice(-8)))) {
                    return { rol: 'encargado', nombre: r.get('encargado') || 'Encargado', edificio: r.get('nombre') || r.get('direccion') || '', subRol: 'titular' };
                }
                if (telSup && (telSup === numLimpio || numLimpio.endsWith(telSup.slice(-8)))) {
                    return { rol: 'encargado', nombre: r.get('encargado_suplente') || 'Personal Limpieza', edificio: r.get('nombre') || '', subRol: 'suplente' };
                }
                if (telSeg && (telSeg === numLimpio || numLimpio.endsWith(telSeg.slice(-8)))) {
                    return { rol: 'seguridad', nombre: 'Guardia de Seguridad', edificio: r.get('nombre') || '', subRol: 'seguridad' };
                }
            }
        }

        // 3. Buscar en CLIENTES (Administradores AC)
        const sheetCli = pestaña(doc, 'CLIENTES');
        if (sheetCli) {
            const rowsCli = await sheetCli.getRows();
            const cliRow = rowsCli.find(r => {
                const rTel = String(r.get('whatsapp') || r.get('wsp') || r.get('telefono') || '').replace(/\D/g, '');
                return rTel && (rTel === numLimpio || numLimpio.endsWith(rTel.slice(-8)));
            });
            if (cliRow) {
                return { rol: 'admin', nombre: cliRow.get('nombre') || 'Administrador', email: cliRow.get('email') || '' };
            }
        }

    } catch (err) {
        console.error('Error buscando rol por teléfono:', err.message);
    }

    return { rol: 'vecino' };
}

/**
 * Deja registrado que el técnico confirmó la visita, y el plazo que dio.
 *
 * Vivía únicamente en memoria (`global.colasProveedores`), así que cada `pm2 restart` la borraba y
 * Marcos volvía a contestarle al vecino "estoy consultando con el técnico" cuando el técnico había
 * confirmado hacía rato. Para el vecino eso no es un olvido: es que le mienten.
 */
async function guardarConfirmacionTecnico({ id_evento, eta = '', tecnico = '' }) {
    try {
        if (!id_evento) return false;
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return false;

        await asegurarColumnas(sheet, ['tecnico_confirmado', 'tecnico_eta'], 'EVENTOS');

        const rows = await sheet.getRows();
        const buscado = String(id_evento).toUpperCase().trim();
        const fila = rows.find(r => String(r.get('id_evento') || '').toUpperCase().trim() === buscado);
        if (!fila) return false;

        fila.set('tecnico_confirmado', fechaHoraAR());
        if (eta) fila.set('tecnico_eta', eta);
        if (tecnico) fila.set('tecnico', tecnico);
        await fila.save();
        console.log(`📌 Confirmación del técnico registrada en [${id_evento}]${eta ? ` (${eta})` : ''}`);
        return true;
    } catch (err) {
        console.error('Error guardando la confirmación del técnico:', err.message);
        return false;
    }
}

// ─────────────────────────────────────────────
// SEGUIMIENTO DE CASOS (a prueba de reinicios)
//
// Los temporizadores de escalación vivían únicamente en `setTimeout`, es decir en memoria RAM. Cada
// `pm2 restart` los borraba a todos en silencio -- y el proceso lleva más de 150 reinicios. En la
// práctica eso significa que muchas escalaciones simplemente nunca ocurrieron: ni el suplente, ni
// el aviso al administrador, sin que quedara rastro de que se habían perdido.
//
// La fecha del próximo control se guarda en el propio caso, y un barrido periódico levanta los
// vencidos. Sobrevive a los reinicios y, de paso, queda a la vista en la planilla qué caso está
// esperando qué.
// ─────────────────────────────────────────────

async function programarSeguimiento({ id_evento, cuando, paso = 1, nota = '', forzar = false }) {
    try {
        if (!id_evento || !cuando) return false;
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return false;

        await asegurarColumnas(sheet, ['proximo_seguimiento', 'seguimiento_paso', 'seguimiento_nota'], 'EVENTOS');

        const rows = await sheet.getRows();
        const buscado = String(id_evento).toUpperCase().trim();
        const fila = rows.find(r => String(r.get('id_evento') || '').toUpperCase().trim() === buscado);
        if (!fila) return false;

        // Un caso cerrado no se vuelve a controlar. El técnico sigue escribiendo después de
        // resolverlo --manda la factura, saluda-- y cualquiera de esos mensajes que se lea como
        // una confirmación volvía a agendar el control. Después el barrido le preguntaba "¿pudiste
        // pasar?" por un trabajo que ya había facturado.
        const estadoActual = String(fila.get('estado') || '').toLowerCase().trim();
        if (estadoActual === 'resuelto' || estadoActual === 'cerrado') {
            console.log(`⏱️ [${id_evento}] ya está ${estadoActual}: no se le agenda ningún control.`);
            return false;
        }

        // El paso NO retrocede.
        //
        // La cadena avanza 1 → 2 → 3: se le pregunta al técnico, después al edificio, después se
        // escala. Cada confirmación del técnico volvía a agendar el paso 1, así que la cadena
        // arrancaba de cero una y otra vez y el técnico recibía la misma pregunta varias veces sin
        // que el caso avanzara nunca. Un mensaje suyo no puede hacer retroceder el seguimiento.
        const pasoActual = parseInt(fila.get('seguimiento_paso') || '0', 10) || 0;
        if (!forzar && paso < pasoActual) {
            console.log(`⏱️ [${id_evento}] va por el paso ${pasoActual}: no se vuelve al ${paso}.`);
            return false;
        }

        // Y si ya hay un control agendado a futuro para el MISMO paso, se deja el que está: no
        // hace falta correrlo cada vez que el técnico escribe.
        const proxActual = new Date(fila.get('proximo_seguimiento') || 0).getTime();
        if (!forzar && paso === pasoActual && Number.isFinite(proxActual) && proxActual > Date.now()) {
            const faltan = Math.round((proxActual - Date.now()) / 60000);
            console.log(`⏱️ [${id_evento}] ya tiene un control agendado en ${faltan} min (paso ${pasoActual}): se respeta.`);
            return false;
        }

        fila.set('proximo_seguimiento', new Date(cuando).toISOString());
        fila.set('seguimiento_paso', String(paso));
        if (nota) fila.set('seguimiento_nota', nota);
        await fila.save();

        const enMin = Math.round((new Date(cuando).getTime() - Date.now()) / 60000);
        console.log(`⏱️ Seguimiento de [${id_evento}] programado para dentro de ${enMin} min (paso ${paso}).`);
        return true;
    } catch (err) {
        console.error('Error programando seguimiento:', err.message);
        return false;
    }
}

/** Quita el control pendiente: el caso se resolvió o dejó de requerirlo. */
async function cancelarSeguimiento(id_evento) {
    try {
        if (!id_evento) return false;
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return false;
        const rows = await sheet.getRows();
        const buscado = String(id_evento).toUpperCase().trim();
        const fila = rows.find(r => String(r.get('id_evento') || '').toUpperCase().trim() === buscado);
        if (!fila) return false;
        fila.set('proximo_seguimiento', '');
        fila.set('seguimiento_paso', '');
        await fila.save();
        return true;
    } catch (err) {
        console.error('Error cancelando seguimiento:', err.message);
        return false;
    }
}

/** Casos abiertos cuyo control ya venció. */
async function obtenerSeguimientosVencidos() {
    try {
        const doc = await getSheet();
        const sheet = pestaña(doc, 'EVENTOS');
        if (!sheet) return [];
        const rows = await sheet.getRows();
        const ahora = Date.now();

        return rows
            .filter(r => {
                const estado = String(r.get('estado') || '').toLowerCase();
                if (estado === 'resuelto' || estado === 'cerrado') return false;
                const prox = r.get('proximo_seguimiento');
                if (!prox) return false;
                const t = new Date(prox).getTime();
                return Number.isFinite(t) && t <= ahora;
            })
            .map(r => ({
                id_evento:   r.get('id_evento') || '',
                edificio:    r.get('edificio') || '',
                vecino:      r.get('vecino') || '',
                telefono:    r.get('telefono') || '',
                depto:       r.get('depto') || '',
                problema:    r.get('mensaje') || r.get('problema') || '',
                urgencia:    r.get('urgencia') || '',
                tecnico:     r.get('tecnico') || '',
                // El estado viaja porque el paso 1 pregunta cosas distintas según él: a un caso
                // `avisado` (el técnico avisó que lo convocaron pero NO confirmó que iba) hay que
                // preguntarle si va a poder ir, no si ya pudo pasar.
                estado:      r.get('estado') || '',
                paso:        parseInt(r.get('seguimiento_paso') || '1', 10) || 1,
                nota:        r.get('seguimiento_nota') || '',
            }));
    } catch (err) {
        console.error('Error obteniendo seguimientos vencidos:', err.message);
        return [];
    }
}

// ─────────────────────────────────────────────
// ACCESOS E INSTALACIONES DEL EDIFICIO
//
// Dónde está cada cosa y quién tiene la llave: sala de medidores, tablero eléctrico, sala de
// máquinas, bombas, llave de gas, terraza, tanque. Sin esto, cuando el técnico llega y pregunta
// "¿dónde está la sala de medidores?" o se encuentra la puerta con candado, Marcos no tiene nada
// para contestarle y el trabajo se cae aunque el técnico ya esté en la puerta.
//
// La tabla se llena de dos maneras y las dos importan:
//   - El administrador carga lo que sabe desde el panel.
//   - Marcos anota lo que aparece hablando. Un vecino que dice "yo le abro, tengo llave de la sala
//     de electricidad" está aportando un dato que el administrador no tenía. Los edificios sin
//     encargado se sostienen justamente sobre esos vecinos, y esa información no está escrita en
//     ningún lado hasta que alguien la dice.
//
// Por eso cada fila guarda de dónde salió (`origen`): no es lo mismo un dato cargado por la
// administración que uno que mencionó un vecino al pasar.
// ─────────────────────────────────────────────

const HEADERS_ACCESOS = ['edificio', 'lugar', 'ubicacion', 'quien_abre', 'telefono', 'tipo_acceso', 'notas', 'origen', 'fecha'];

async function getSheetAccesos() {
    const doc = await getSheet();
    let sheet = pestaña(doc, 'accesos');
    if (!sheet) {
        sheet = await doc.addSheet({ title: 'accesos', headerValues: HEADERS_ACCESOS });
        console.log('🔑 Pestaña accesos creada.');
        return sheet;
    }
    await asegurarColumnas(sheet, HEADERS_ACCESOS, 'accesos');
    return sheet;
}

/**
 * Todo lo que sabemos sobre accesos e instalaciones de un edificio.
 */
async function buscarAccesosEdificio(nombreEdificio) {
    try {
        if (!nombreEdificio) return [];
        const sheet = await getSheetAccesos();
        const rows = await sheet.getRows();
        const buscado = String(nombreEdificio).toLowerCase().trim();

        return rows
            .filter(r => String(r.get('edificio') || '').toLowerCase().trim() === buscado)
            .filter(r => String(r.get('lugar') || '').trim())
            .map(r => ({
                lugar:       r.get('lugar') || '',
                ubicacion:   r.get('ubicacion') || '',
                quienAbre:   r.get('quien_abre') || '',
                telefono:    r.get('telefono') || '',
                tipoAcceso:  r.get('tipo_acceso') || '',
                notas:       r.get('notas') || '',
                origen:      r.get('origen') || '',
            }));
    } catch (err) {
        console.error('Error buscando accesos del edificio:', err.message);
        return [];
    }
}

/**
 * Guarda o completa un dato de acceso. La clave es edificio + lugar: si el lugar ya estaba
 * cargado, se completan únicamente los campos que vienen con valor, para que un dato suelto
 * mencionado al pasar no borre lo que el administrador ya había cargado con más detalle.
 */
async function guardarAccesoEdificio({ edificio, lugar, ubicacion = '', quienAbre = '', telefono = '', tipoAcceso = '', notas = '', origen = '' }) {
    try {
        if (!edificio || !lugar) return false;
        const sheet = await getSheetAccesos();
        const rows = await sheet.getRows();

        const edifBuscado = String(edificio).toLowerCase().trim();
        const lugarBuscado = String(lugar).toLowerCase().trim();
        const fila = rows.find(r =>
            String(r.get('edificio') || '').toLowerCase().trim() === edifBuscado &&
            String(r.get('lugar') || '').toLowerCase().trim() === lugarBuscado
        );

        const fecha = fechaHoraAR();

        if (fila) {
            if (ubicacion)  fila.set('ubicacion', ubicacion);
            if (quienAbre)  fila.set('quien_abre', quienAbre);
            if (telefono)   fila.set('telefono', telefono);
            if (tipoAcceso) fila.set('tipo_acceso', tipoAcceso);
            if (notas)      fila.set('notas', notas);
            if (origen)     fila.set('origen', origen);
            fila.set('fecha', fecha);
            await fila.save();
            console.log(`🔑 Acceso actualizado en ${edificio}: ${lugar}`);
        } else {
            await sheet.addRow({
                edificio, lugar,
                ubicacion, quien_abre: quienAbre, telefono,
                tipo_acceso: tipoAcceso, notas, origen, fecha
            });
            console.log(`🔑 Nuevo acceso registrado en ${edificio}: ${lugar}${quienAbre ? ` — abre ${quienAbre}` : ''}`);
        }
        return true;
    } catch (err) {
        console.error('Error guardando acceso del edificio:', err.message);
        return false;
    }
}

async function quitarAccesoEdificio({ edificio, lugar }) {
    try {
        if (!edificio || !lugar) return false;
        const sheet = await getSheetAccesos();
        const rows = await sheet.getRows();

        const edifBuscado = String(edificio).toLowerCase().trim();
        const lugarBuscado = String(lugar).toLowerCase().trim();

        const filasABorrar = rows.filter(r => {
            const rEd = String(r.get('edificio') || '').toLowerCase().trim();
            const rLug = String(r.get('lugar') || '').toLowerCase().trim();
            if (rEd !== edifBuscado) return false;
            return rLug === lugarBuscado || rLug.includes(lugarBuscado) || lugarBuscado.includes(rLug);
        });

        for (const f of filasABorrar) {
            await f.delete();
            console.log(`🔑 Acceso eliminado en ${edificio}: ${f.get('lugar')}`);
        }
        return true;
    } catch (err) {
        console.error('Error quitando acceso del edificio:', err.message);
        return false;
    }
}

module.exports = {
    getSheet,
    asegurarColumnas,
    buscarVecinoPorTelefono,
    buscarVecinosPorTelefono,
    agregarVecinoNuevo,
    guardarAutorizacionContacto,
    buscarTecnicoAsignado,
    buscarTecnicoSuplente,
    buscarPersonalDeTurno,
    buscarPerfilEdificio,
    guardarConfirmacionTecnico,
    programarSeguimiento,
    cancelarSeguimiento,
    obtenerSeguimientosVencidos,
    buscarAccesosEdificio,
    guardarAccesoEdificio,
    quitarAccesoEdificio,
    buscarCliente,
    listarEdificiosConocidos,
    edificiosDelProveedor,
    buscarCasosRecientesPorTecnico,
    proveedoresPorTelefono,
    buscarDatosBancariosProveedor,
    guardarDatosBancariosProveedor,
    resolverCambioBancario,
    registrarProveedorNoVerificado,
    buscarFacturasSinImputar,
    imputarFacturaSinEdificio,
    buscarMemoriaVecino,
    guardarMemoriaVecino,
    guardarReporte,
    fueTecnicoNotificado,
    marcarTecnicoNotificado,
    fueAdminNotificado,
    marcarAdminNotificado,
    fueContactoAccesoAvisado,
    marcarContactoAccesoAvisado,
    fueMaterialEnviadoATecnico,
    marcarMaterialEnviadoATecnico,
    guardarFactura,
    casoYaTieneFactura,
    buscarFacturasProveedor,
    guardarLlamada,
    buscarRolPorTelefono,
    obtenerEventosPendientesAdmin,
    obtenerCasosAbiertosEdificio,
    marcarCasoResueltoPorId,
};
