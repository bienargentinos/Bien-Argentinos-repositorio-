const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
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
        await sheet.loadHeaderRow().catch(() => {});
        const headers = sheet.headerValues || [];
        const necesarios = ['autoriza_contacto', 'contacto_acceso'];
        const nuevos = Array.from(new Set([...headers, ...necesarios]));
        if (nuevos.length > headers.length) {
            await sheet.setHeaderRow(nuevos).catch(() => {});
        }

        const rows = await sheet.getRows();
        const telBuscado = String(telefono || '').replace(/\D/g, '');
        const fila = rows.find(r => String(r.get('telefono') || '').replace(/\D/g, '') === telBuscado);
        if (!fila) return false;

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
        const sheetAsig = doc.sheetsByTitle['proveedor_asignaciones'];
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
        const sheetProv = doc.sheetsByTitle['proveedores'];
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
        const sheet = doc.sheetsByTitle['tecnicos'];
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
        const sheet = doc.sheetsByTitle['proveedor_asignaciones'];
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
        const sheet = doc.sheetsByTitle['personal'];
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
        const sheet = doc.sheetsByTitle['EDIFICIOS'];
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
        const sheet = doc.sheetsByTitle['CLIENTES'];
        if (!sheet) return null;

        const rows = await sheet.getRows();
        const row = rows.find(r =>
            (r.get('nombre') || '').toLowerCase().includes(nombreAdmin.toLowerCase())
        );

        if (!row) return null;

        return {
            nombre:      row.get('nombre')      || '',
            email:       row.get('email')       || '',
            wsp:         row.get('wsp')         || '',
            notifEmail:  (row.get('notif_email') || '').toLowerCase() === 'si',
        };
    } catch (err) {
        console.error('Error buscando cliente:', err.message);
        return null;
    }
}

// Devuelve todos los edificios conocidos con sus aliases
// Retorna: [{ nombre: '...', aliases: ['...', '...'] }]
async function listarEdificiosConocidos() {
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByTitle['EDIFICIOS'];
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
        let sheet = doc.sheetsByTitle['memoria'];
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
        let sheet = doc.sheetsByTitle['memoria'];

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

        const fecha = new Date().toLocaleString('es-AR');

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

async function guardarReporte({ edificio, vecino, depto, problema, urgencia, estado, notas, notas_ia, fechaInicio, tipo = 'whatsapp', telefono = '', audio_url = '', transcripcion = '', historial_chat = '', id_evento = '' }) {
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByTitle['EVENTOS'];
        if (!sheet) return null;

        await sheet.loadHeaderRow().catch(() => {});
        const headers = sheet.headerValues || [];

        // Asegurar que los headers tengan los campos requeridos incluyendo id_evento, audios_json, involucrados_json, chat_vecino_json y chat_proveedor_json
        const headersNecesarios = ['id_evento', 'fecha', 'edificio', 'vecino', 'depto', 'unidad', 'mensaje', 'tipo', 'urgencia', 'estado', 'notas', 'feedback', 'telefono', 'hora_fin', 'audio_url', 'transcripcion', 'historial_chat', 'audios_json', 'involucrados_json', 'chat_vecino_json', 'chat_proveedor_json', 'tecnico_notificado'];
        const nuevosHeaders = Array.from(new Set([...headers, ...headersNecesarios]));
        if (nuevosHeaders.length > headers.length) {
            await sheet.setHeaderRow(nuevosHeaders).catch(() => {});
        }

        const rows = await sheet.getRows();
        const telBuscado = String(telefono || '').replace(/\D/g, '');
        
        let rowExistente = null;

        // 1. Buscar si nos pasaron un id_evento específico (ej: CASO-1042)
        if (id_evento) {
            rowExistente = [...rows].reverse().find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        }

        // 2. Buscar por teléfono y edificio si no se encontró por ID
        if (!rowExistente && telBuscado && telBuscado.length >= 6) {
            rowExistente = [...rows].reverse().find(r => {
                const rTel = String(r.get('telefono') || '').replace(/\D/g, '');
                const rEdif = String(r.get('edificio') || '').toLowerCase();
                const eBuscado = String(edificio || '').toLowerCase();
                const rEst = String(r.get('estado') || '').toLowerCase().trim();
                return (rTel === telBuscado || rTel.includes(telBuscado)) && (rEdif === eBuscado || !eBuscado) && rEst !== 'resuelto' && rEst !== 'cerrado';
            });
        }

        // 3. Buscar evento activo no resuelto del edificio si escribe otro participante o técnico
        if (!rowExistente && edificio && edificio !== 'No especificado') {
            const eBuscado = String(edificio).toLowerCase().trim();
            rowExistente = [...rows].reverse().find(r => {
                const rEdif = String(r.get('edificio') || '').toLowerCase().trim();
                const rEst = String(r.get('estado') || '').toLowerCase().trim();
                return rEdif === eBuscado && rEst !== 'resuelto' && rEst !== 'cerrado';
            });
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
                    fecha: new Date().toLocaleString('es-AR'),
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
        if (telefono && telBuscado.length >= 6) {
            const yaEsta = involucradosLista.some(i => String(i.telefono).replace(/\D/g, '') === telBuscado);
            if (!yaEsta) {
                involucradosLista.push({
                    nombre: vecino || 'Participante',
                    telefono: telefono,
                    depto: depto || '',
                    fecha: new Date().toLocaleString('es-AR')
                });
            }
        }

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

        chatNuevosArr.forEach(m => {
            const strM = String(m || '');
            if (/proveedor|t.cnico|marcos ➔ proveedor|marcos -> proveedor/i.test(strM)) {
                if (!chatProveedorLista.includes(strM)) chatProveedorLista.push(strM);
            } else {
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
            if (estado) rowExistente.set('estado', estado);
            if (notasFinales) rowExistente.set('notas', notasFinales);
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
                fecha:              fechaInicio || new Date().toLocaleString('es-AR'),
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
async function fueTecnicoNotificado(id_evento) {
    if (!id_evento) return false;
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByTitle['EVENTOS'];
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
        const sheet = doc.sheetsByTitle['EVENTOS'];
        if (!sheet) return;
        await sheet.loadHeaderRow().catch(() => {});
        if (!(sheet.headerValues || []).includes('tecnico_notificado')) {
            const nuevosHeaders = Array.from(new Set([...(sheet.headerValues || []), 'tecnico_notificado']));
            await sheet.setHeaderRow(nuevosHeaders).catch(() => {});
        }
        const rows = await sheet.getRows();
        const row = rows.find(r => String(r.get('id_evento') || '').toUpperCase() === String(id_evento).toUpperCase());
        if (row) {
            row.set('tecnico_notificado', new Date().toLocaleString('es-AR'));
            await row.save();
        }
    } catch (err) {
        console.error('Error marcando tecnico_notificado:', err.message);
    }
}

// ─────────────────────────────────────────────
// FACTURAS / CONTABILIDAD
// ─────────────────────────────────────────────

async function guardarFactura({ proveedor, monto, concepto, edificio, url_archivo, numero_factura, estado }) {
    try {
        const doc = await getSheet();
        let sheet = doc.sheetsByTitle['facturas'];

        if (!sheet) {
            sheet = await doc.addSheet({
                title: 'facturas',
                headerValues: ['fecha', 'proveedor', 'monto', 'concepto', 'edificio', 'url_archivo', 'numero_factura', 'estado'],
            });
        }

        await sheet.loadHeaderRow().catch(() => {});
        const headers = sheet.headerValues || [];
        const headersNecesarios = ['fecha', 'proveedor', 'monto', 'concepto', 'edificio', 'url_archivo', 'numero_factura', 'estado'];
        const nuevosHeaders = Array.from(new Set([...headers, ...headersNecesarios]));
        if (nuevosHeaders.length > headers.length) {
            await sheet.setHeaderRow(nuevosHeaders).catch(() => {});
        }

        await sheet.addRow({
            fecha:          new Date().toLocaleString('es-AR'),
            proveedor:      proveedor  || 'Desconocido',
            monto:          monto      || '0',
            concepto:       concepto   || '',
            edificio:       edificio   || 'No especificado',
            url_archivo:    url_archivo|| '',
            numero_factura: numero_factura || '',
            estado:         estado     || 'Pendiente'
        });

        console.log(`💸 Factura de ${proveedor} por ${monto} guardada.`);
    } catch (err) {
        console.error('Error guardando factura:', err.message);
    }
}

// Busca facturas de un proveedor (opcionalmente filtrando por edificio y/o número de
// comprobante) para que Marcos pueda contestar "¿ya me pagaron la factura X?" con el estado
// real cargado en Sheets, en vez de inventar una respuesta.
async function buscarFacturasProveedor({ proveedor, edificio = '', numeroFactura = '' }) {
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByTitle['facturas'];
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
        let sheet = doc.sheetsByTitle['llamadas'];

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
            fecha:           new Date().toLocaleString('es-AR'),
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
        const sheet = doc.sheetsByTitle['EVENTOS'];
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
        const sheet = doc.sheetsByTitle['EVENTOS'];
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
        const sheet = doc.sheetsByTitle['EVENTOS'];
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
            row.set('hora_fin', new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }));
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
        const sheetProv = doc.sheetsByTitle['proveedores'] || doc.sheetsByTitle['tecnicos'];
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

        const sheetAsig = doc.sheetsByTitle['proveedor_asignaciones'];
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
        const sheetEdif = doc.sheetsByTitle['EDIFICIOS'];
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
        const sheetCli = doc.sheetsByTitle['CLIENTES'];
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

module.exports = {
    getSheet,
    buscarVecinoPorTelefono,
    buscarVecinosPorTelefono,
    agregarVecinoNuevo,
    guardarAutorizacionContacto,
    buscarTecnicoAsignado,
    buscarTecnicoSuplente,
    buscarPersonalDeTurno,
    buscarPerfilEdificio,
    buscarCliente,
    listarEdificiosConocidos,
    buscarMemoriaVecino,
    guardarMemoriaVecino,
    guardarReporte,
    fueTecnicoNotificado,
    marcarTecnicoNotificado,
    guardarFactura,
    buscarFacturasProveedor,
    // Estaba definida pero nunca exportada: index.js la importa y la llama al cerrar una llamada
    // de Vapi, así que quedaba en undefined y toda llamada telefónica moría con
    // "guardarLlamada is not a function" sin que se guardara nada.
    guardarLlamada,
    buscarRolPorTelefono,
    obtenerEventosPendientesAdmin,
    obtenerCasosAbiertosEdificio,
    marcarCasoResueltoPorId,
};
