#!/usr/bin/env node
// Sanea y elimina un edificio en TODOS lados: Google Sheets y PostgreSQL.
//
//   node eliminar-edificio.js "san patricio 270"                  ← solo muestra qué limpiaría
//   node eliminar-edificio.js "san patricio 270" --aplicar        ← borra de verdad
//
// Por defecto NO escribe nada: lista lo que cambiaría. Recién con --aplicar toca los datos.
//
// PARA QUÉ SIRVE. No hay un id de edificio: el nombre ES la clave. Si un edificio se da de baja
// o se quita de un cliente, sus asignaciones de proveedor (`proveedor_asignaciones`), el consejo
// (`consejo`) y el permiso en `clientes.edificios` quedan huérfanos apuntando al edificio inexistente.
// Esto confunde a Marcos IA, que al buscar por `edificio + rubro` en `proveedor_asignaciones`
// encuentra filas huérfanas y no sabe a quién llamar o manda al técnico equivocado.
//
// Este script realiza la limpieza en cascada en las DOS bases (Sheets y PostgreSQL)
// sin tocar registros históricos de eventos ni facturas.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const norm = (t) => String(t || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase().trim();

/**
 * Elimina o desvincula un edificio en cascada en Sheets y PostgreSQL.
 *
 * @param {string}  edificio            nombre del edificio a eliminar/desvincular
 * @param {string}  [cliente]           usuario o nombre del cliente (si es solo desvinculación)
 * @param {boolean} [eliminarDeEdificios=true] true = borrado definitivo de EDIFICIOS; false = solo desvincular
 * @param {boolean} [aplicar=false]     false = solo muestra, true = aplica cambios
 * @param {(linea:string)=>void} [log=console.log]
 * @returns {Promise<{cambios:number, fallidos:number}>}
 */
async function eliminarEdificio({ edificio, cliente = null, eliminarDeEdificios = true, aplicar = false, log = console.log }) {
    const N_EDIFICIO = norm(edificio);
    const N_CLIENTE = cliente ? norm(cliente) : null;

    if (!N_EDIFICIO) throw new Error('El nombre del edificio está vacío.');

    let cambios = 0;
    let fallidos = 0;

    const quitarDeLista = (valor) => {
        const partes = String(valor || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!partes.some(p => norm(p) === N_EDIFICIO)) return null;
        const filtrados = partes.filter(p => norm(p) !== N_EDIFICIO);
        return filtrados.join(', ');
    };

    const anotar = (accion, lugar, detalle) => {
        cambios++;
        log(`   ${aplicar ? '🗑️' : '·'} [${accion}] ${lugar}`);
        if (detalle) log(`      ${detalle}`);
    };

    // ── 1. GOOGLE SHEETS ─────────────────────────────────────────────────────────────────────
    log(`\n📄 Google Sheets\n`);
    try {
        const sheets = require('./sheets');
        const doc = await sheets.getSheet();

        // Helper para obtener hoja por título aproximado
        const obtenerHoja = (nombre) => {
            const buscado = norm(nombre);
            const titulo = Object.keys(doc.sheetsByTitle || {}).find(t => norm(t) === buscado);
            return titulo ? doc.sheetsByTitle[titulo] : null;
        };

        // A. proveedor_asignaciones
        const hojaAsig = obtenerHoja('proveedor_asignaciones');
        if (hojaAsig) {
            try {
                await hojaAsig.loadHeaderRow();
                const filas = await hojaAsig.getRows();
                const aBorrar = filas.filter(f => {
                    const edFila = norm(f.get('edificio'));
                    if (edFila !== N_EDIFICIO) return false;
                    if (N_CLIENTE) {
                        const cliFila = norm(f.get('cliente'));
                        if (cliFila && cliFila !== N_CLIENTE) return false;
                    }
                    return true;
                });

                // Orden descendente por fila para no desfasar índices al borrar
                const ordenadas = [...aBorrar].sort((a, b) => (b._rowNumber ?? b._row ?? 0) - (a._rowNumber ?? a._row ?? 0));
                for (const f of ordenadas) {
                    const prov = f.get('proveedor') || '(sin prov)';
                    const rub = f.get('rubro') || '';
                    anotar('BORRAR_ASIGNACION', 'proveedor_asignaciones', `${prov} (${rub}) → ${f.get('edificio')}`);
                    if (aplicar) {
                        try { await f.delete(); } catch (e) { fallidos++; log(`      ❌ Error al borrar fila: ${e.message}`); }
                    }
                }
            } catch (e) {
                log(`   ⚠️ proveedor_asignaciones: ${e.message}`);
            }
        }

        // B. consejo
        const hojaConsejo = obtenerHoja('consejo');
        if (hojaConsejo) {
            try {
                await hojaConsejo.loadHeaderRow();
                const filas = await hojaConsejo.getRows();
                const aBorrar = filas.filter(f => norm(f.get('edificio')) === N_EDIFICIO);
                const ordenadas = [...aBorrar].sort((a, b) => (b._rowNumber ?? b._row ?? 0) - (a._rowNumber ?? a._row ?? 0));
                for (const f of ordenadas) {
                    const nom = f.get('nombre') || f.get('miembro') || '(sin nombre)';
                    anotar('BORRAR_CONSEJO', 'consejo', `${nom} (${f.get('cargo') || 'miembro'}) → ${f.get('edificio')}`);
                    if (aplicar) {
                        try { await f.delete(); } catch (e) { fallidos++; log(`      ❌ Error al borrar fila: ${e.message}`); }
                    }
                }
            } catch (e) {
                log(`   ⚠️ consejo: ${e.message}`);
            }
        }

        // C. clientes (limpiar lista separada por comas en `edificios`)
        const hojaClientes = obtenerHoja('clientes');
        if (hojaClientes) {
            try {
                await hojaClientes.loadHeaderRow();
                const filas = await hojaClientes.getRows();
                for (const f of filas) {
                    if (N_CLIENTE) {
                        const u = norm(f.get('usuario'));
                        const n = norm(f.get('nombre'));
                        if (u !== N_CLIENTE && n !== N_CLIENTE) continue;
                    }
                    const listaActual = f.get('edificios');
                    const nuevaLista = quitarDeLista(listaActual);
                    if (nuevaLista !== null) {
                        anotar('DESVINCULAR_CLIENTE', `clientes (usuario: ${f.get('usuario') || f.get('nombre')})`, `edificios: "${listaActual}" → "${nuevaLista}"`);
                        if (aplicar) {
                            f.set('edificios', nuevaLista);
                            try { await f.save(); } catch (e) { fallidos++; log(`      ❌ Error al actualizar cliente: ${e.message}`); }
                        }
                    }
                }
            } catch (e) {
                log(`   ⚠️ clientes: ${e.message}`);
            }
        }

        // D. edificios (eliminar de la tabla EDIFICIOS si eliminarDeEdificios = true)
        const hojaEdificios = obtenerHoja('edificios');
        if (hojaEdificios) {
            try {
                await hojaEdificios.loadHeaderRow();
                const filas = await hojaEdificios.getRows();
                const aTratar = filas.filter(f => {
                    const ed1 = norm(f.get('edificio'));
                    const ed2 = norm(f.get('nombre'));
                    return ed1 === N_EDIFICIO || ed2 === N_EDIFICIO;
                });

                for (const f of aTratar) {
                    if (eliminarDeEdificios) {
                        anotar('BORRAR_EDIFICIO', 'edificios', `Fila de ${f.get('edificio') || f.get('nombre')}`);
                        if (aplicar) {
                            try { await f.delete(); } catch (e) { fallidos++; log(`      ❌ Error al borrar edificio: ${e.message}`); }
                        }
                    } else if (N_CLIENTE) {
                        // Solo desvinculamos: limpiar admin_nombre / administrador si coincide
                        const admActual = f.get('admin_nombre') || f.get('administrador') || '';
                        if (norm(admActual) === N_CLIENTE) {
                            anotar('DESVINCULAR_ADMIN', 'edificios', `Quitar administrador "${admActual}" de ${f.get('edificio') || f.get('nombre')}`);
                            if (aplicar) {
                                if (f.get('admin_nombre') !== undefined) f.set('admin_nombre', '');
                                if (f.get('administrador') !== undefined) f.set('administrador', '');
                                try { await f.save(); } catch (e) { fallidos++; log(`      ❌ Error al actualizar admin: ${e.message}`); }
                            }
                        }
                    }
                }
            } catch (e) {
                log(`   ⚠️ edificios: ${e.message}`);
            }
        }

        // E. edificio_amenities (si es eliminación total)
        if (eliminarDeEdificios) {
            const hojaAmenities = obtenerHoja('edificio_amenities');
            if (hojaAmenities) {
                try {
                    await hojaAmenities.loadHeaderRow();
                    const filas = await hojaAmenities.getRows();
                    const aBorrar = filas.filter(f => norm(f.get('edificio')) === N_EDIFICIO);
                    const ordenadas = [...aBorrar].sort((a, b) => (b._rowNumber ?? b._row ?? 0) - (a._rowNumber ?? a._row ?? 0));
                    for (const f of ordenadas) {
                        anotar('BORRAR_AMENITY', 'edificio_amenities', `${f.get('nombre') || 'Amenity'} de ${f.get('edificio')}`);
                        if (aplicar) {
                            try { await f.delete(); } catch (e) { fallidos++; }
                        }
                    }
                } catch (_) {}
            }
        }

    } catch (e) {
        log(`   ❌ No se pudo trabajar sobre Google Sheets: ${e.message}`);
    }

    // ── 2. POSTGRESQL ────────────────────────────────────────────────────────────────────────
    log(`\n🐘 PostgreSQL\n`);
    let pool = null;
    try {
        ({ pool } = require('./db-pg'));

        // A. proveedor_asignaciones
        try {
            const resAsig = await pool.query(
                `SELECT ctid, edificio, cliente, proveedor, rubro FROM proveedor_asignaciones WHERE edificio IS NOT NULL AND edificio <> ''`
            );
            for (const row of resAsig.rows) {
                if (norm(row.edificio) !== N_EDIFICIO) continue;
                if (N_CLIENTE && norm(row.cliente) !== N_CLIENTE) continue;

                anotar('BORRAR_ASIGNACION_PG', 'proveedor_asignaciones', `${row.proveedor || '(sin prov)'} (${row.rubro || ''}) → ${row.edificio}`);
                if (aplicar) {
                    try {
                        await pool.query(`DELETE FROM proveedor_asignaciones WHERE ctid = $1`, [row.ctid]);
                    } catch (e) {
                        fallidos++;
                        log(`      ❌ Error al borrar en PG: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            log(`   ⚠️ PG proveedor_asignaciones: ${e.message}`);
        }

        // B. consejo
        try {
            const resConsejo = await pool.query(
                `SELECT ctid, edificio, nombre, cargo FROM consejo WHERE edificio IS NOT NULL AND edificio <> ''`
            );
            for (const row of resConsejo.rows) {
                if (norm(row.edificio) !== N_EDIFICIO) continue;
                anotar('BORRAR_CONSEJO_PG', 'consejo', `${row.nombre || '(sin nombre)'} (${row.cargo || ''}) → ${row.edificio}`);
                if (aplicar) {
                    try {
                        await pool.query(`DELETE FROM consejo WHERE ctid = $1`, [row.ctid]);
                    } catch (e) {
                        fallidos++;
                        log(`      ❌ Error al borrar en PG: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            log(`   ⚠️ PG consejo: ${e.message}`);
        }

        // C. clientes (quitar de lista)
        try {
            const resCli = await pool.query(
                `SELECT ctid, usuario, nombre, edificios FROM clientes WHERE edificios IS NOT NULL AND edificios <> ''`
            );
            for (const row of resCli.rows) {
                if (N_CLIENTE && norm(row.usuario) !== N_CLIENTE && norm(row.nombre) !== N_CLIENTE) continue;
                const nuevaLista = quitarDeLista(row.edificios);
                if (nuevaLista !== null) {
                    anotar('DESVINCULAR_CLIENTE_PG', `clientes (@${row.usuario})`, `edificios: "${row.edificios}" → "${nuevaLista}"`);
                    if (aplicar) {
                        try {
                            await pool.query(`UPDATE clientes SET edificios = $1 WHERE ctid = $2`, [nuevaLista, row.ctid]);
                        } catch (e) {
                            fallidos++;
                            log(`      ❌ Error al actualizar clientes en PG: ${e.message}`);
                        }
                    }
                }
            }
        } catch (e) {
            log(`   ⚠️ PG clientes: ${e.message}`);
        }

        // D. edificios (borrado o desvinculación)
        try {
            const resEd = await pool.query(
                `SELECT ctid, edificio, admin_nombre FROM edificios WHERE edificio IS NOT NULL AND edificio <> ''`
            );
            for (const row of resEd.rows) {
                if (norm(row.edificio) !== N_EDIFICIO) continue;
                if (eliminarDeEdificios) {
                    anotar('BORRAR_EDIFICIO_PG', 'edificios', `Fila de ${row.edificio}`);
                    if (aplicar) {
                        try {
                            await pool.query(`DELETE FROM edificios WHERE ctid = $1`, [row.ctid]);
                        } catch (e) {
                            fallidos++;
                            log(`      ❌ Error al borrar edificio en PG: ${e.message}`);
                        }
                    }
                } else if (N_CLIENTE && norm(row.admin_nombre) === N_CLIENTE) {
                    anotar('DESVINCULAR_ADMIN_PG', 'edificios', `admin_nombre: "${row.admin_nombre}" → ""`);
                    if (aplicar) {
                        try {
                            await pool.query(`UPDATE edificios SET admin_nombre = '' WHERE ctid = $1`, [row.ctid]);
                        } catch (e) {
                            fallidos++;
                            log(`      ❌ Error al desvincular admin en PG: ${e.message}`);
                        }
                    }
                }
            }
        } catch (e) {
            log(`   ⚠️ PG edificios: ${e.message}`);
        }

        // E. accesos y amenities (si es eliminación total)
        if (eliminarDeEdificios) {
            try {
                const resAcc = await pool.query(`SELECT ctid, edificio FROM accesos WHERE edificio IS NOT NULL AND edificio <> ''`);
                for (const row of resAcc.rows) {
                    if (norm(row.edificio) === N_EDIFICIO) {
                        anotar('BORRAR_ACCESO_PG', 'accesos', `Acceso de ${row.edificio}`);
                        if (aplicar) {
                            try { await pool.query(`DELETE FROM accesos WHERE ctid = $1`, [row.ctid]); } catch (_) {}
                        }
                    }
                }
            } catch (_) {}

            try {
                const resAm = await pool.query(`SELECT ctid, edificio FROM edificio_amenities WHERE edificio IS NOT NULL AND edificio <> ''`);
                for (const row of resAm.rows) {
                    if (norm(row.edificio) === N_EDIFICIO) {
                        anotar('BORRAR_AMENITY_PG', 'edificio_amenities', `Amenity de ${row.edificio}`);
                        if (aplicar) {
                            try { await pool.query(`DELETE FROM edificio_amenities WHERE ctid = $1`, [row.ctid]); } catch (_) {}
                        }
                    }
                }
            } catch (_) {}
        }

    } catch (e) {
        log(`   ❌ No se pudo trabajar sobre PostgreSQL: ${e.message}`);
    }

    return { cambios, fallidos };
}

module.exports = { eliminarEdificio, norm };

// ── COMO PROGRAMA CLI ────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const flags = new Set(args.filter(a => a.startsWith('--')));
    const posArgs = args.filter(a => !a.startsWith('--'));

    const edificio = posArgs[0];
    const aplicar = flags.has('--aplicar');
    const noEdificios = flags.has('--no-edificios'); // si true, solo desvincula, no borra de EDIFICIOS

    let cliente = null;
    const idxCli = args.indexOf('--cliente');
    if (idxCli >= 0 && args[idxCli + 1]) {
        cliente = args[idxCli + 1];
    }

    if (!edificio) {
        console.error('Uso:\n  node eliminar-edificio.js "nombre del edificio" [--cliente "usuario"] [--no-edificios] [--aplicar]');
        process.exit(1);
    }

    (async () => {
        let salida = { cambios: 0, fallidos: 0 };
        try {
            salida = await eliminarEdificio({
                edificio,
                cliente,
                eliminarDeEdificios: !noEdificios,
                aplicar
            });
        } catch (e) {
            console.error(`\n❌ ${e.message}\n`);
            process.exit(1);
        }

        console.log('');
        if (salida.fallidos > 0) {
            console.log(`⚠️ ${salida.fallidos} lugar(es) NO se pudieron limpiar.`);
        }
        if (salida.cambios === 0 && salida.fallidos === 0) {
            console.log(`✅ No se encontraron referencias huérfanas para "${edificio}".\n`);
        } else if (aplicar) {
            console.log(`${salida.fallidos ? '🟠' : '✅'} ${salida.cambios} referencia(s) limpiadas para "${edificio}".`);
            console.log(`   Verificá con:  node revisar-edificios.js\n`);
        } else {
            console.log(`📋 ${salida.cambios} referencia(s) se limpiarían. NO se tocó nada.`);
            console.log(`   Para ejecutar la limpieza de verdad:`);
            console.log(`   node eliminar-edificio.js "${edificio}" ${cliente ? `--cliente "${cliente}" ` : ''}${noEdificios ? '--no-edificios ' : ''}--aplicar\n`);
        }
    })();
}
