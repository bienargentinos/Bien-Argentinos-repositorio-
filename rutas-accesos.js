const express = require('express');

/**
 * RUTAS DE "INSTALACIONES Y ACCESOS" DEL EDIFICIO
 *
 * Vive en su propio archivo a propósito. `dashboard.js` lo edita otro agente en paralelo, y cada
 * bloque que se agrega ahí es una oportunidad más de pisarse: montar un router aparte deja la
 * huella en una sola línea en vez de doscientas.
 *
 * Se monta así desde dashboard.js, después de que estén definidos sus helpers de sesión:
 *
 *     router.use(require('./rutas-accesos')({ esDueno, edificiosPermitidos, bloquearSiPreview }));
 *
 * Los helpers se pasan por parámetro porque son internos de dashboard.js: pedirlos por argumento
 * evita tener que exportarlos y tocar más el archivo.
 */
module.exports = function crearRutasAccesos({ esDueno, edificiosPermitidos, bloquearSiPreview }) {
    const router = express.Router();

    /**
     * Qué edificio puede tocar quien está pidiendo.
     * - El dueño trabaja sobre el edificio que venga en el cuerpo o la query.
     * - El cliente, únicamente sobre el suyo: si pide otro, se lo ignora y se usa el propio. Que
     *   un administrador vea o edite las llaves de un edificio ajeno no es un bug menor.
     */
    function edificioObjetivo(req) {
        const pedido = (req.body && req.body.edificio) || (req.query && req.query.edificio) || '';
        if (esDueno(req)) return String(pedido || '').trim();
        const permitidos = edificiosPermitidos(req) || [];
        return permitidos[0] || '';
    }

    // ── Listado ───────────────────────────────────────────────────────────────
    router.get('/api/accesos', async (req, res) => {
        try {
            const edificio = edificioObjetivo(req);
            if (!edificio) return res.status(400).json({ error: 'Sin edificio asignado' });

            const { buscarAccesosEdificio } = require('./datos');
            const accesos = await buscarAccesosEdificio(edificio);
            res.json({ ok: true, edificio, accesos });
        } catch (e) {
            res.status(500).json({ error: e.message || String(e) });
        }
    });

    // ── Alta / edición de una fila ────────────────────────────────────────────
    router.post('/api/acceso', async (req, res) => {
        if (bloquearSiPreview(req, res)) return;
        try {
            const edificio = edificioObjetivo(req);
            if (!edificio) return res.status(400).json({ error: 'Sin edificio asignado' });

            const b = req.body || {};
            const lugar = String(b.lugar || '').trim();
            if (!lugar) return res.status(400).json({ error: 'Falta el lugar' });

            const { guardarAccesoEdificio } = require('./datos');
            await guardarAccesoEdificio({
                edificio,
                lugar:      lugar.toLowerCase(),
                ubicacion:  b.ubicacion || '',
                quienAbre:  b.quien_abre || b.quienAbre || '',
                telefono:   b.telefono || '',
                tipoAcceso: b.tipo_acceso || b.tipoAcceso || '',
                notas:      b.notas || '',
                origen:     b.origen || (esDueno(req) ? 'Cargado por la administración' : 'Cargado por el cliente'),
            });

            const { buscarAccesosEdificio } = require('./datos');
            res.json({ ok: true, accesos: await buscarAccesosEdificio(edificio) });
        } catch (e) {
            res.status(500).json({ error: e.message || String(e) });
        }
    });

    // ── Baja de una fila ──────────────────────────────────────────────────────
    router.post('/api/acceso-quitar', async (req, res) => {
        if (bloquearSiPreview(req, res)) return;
        try {
            const edificio = edificioObjetivo(req);
            const lugar = String((req.body || {}).lugar || '').trim();
            if (!edificio || !lugar) return res.status(400).json({ error: 'Faltan datos' });

            const { getSheet } = require('./datos');
            const doc = await getSheet();
            const sheet = doc.sheetsByTitle['accesos'];
            if (!sheet) return res.json({ ok: true, accesos: [] });

            const rows = await sheet.getRows();
            const fila = rows.find(r =>
                String(r.get('edificio') || '').toLowerCase().trim() === edificio.toLowerCase().trim() &&
                String(r.get('lugar') || '').toLowerCase().trim() === lugar.toLowerCase()
            );
            if (fila) await fila.delete();

            const { buscarAccesosEdificio } = require('./datos');
            res.json({ ok: true, accesos: await buscarAccesosEdificio(edificio) });
        } catch (e) {
            res.status(500).json({ error: e.message || String(e) });
        }
    });

    // ── Carga por relato ──────────────────────────────────────────────────────
    // El administrador escribe cómo es el edificio con sus palabras y se convierte en filas.
    // Nadie con 27 edificios va a cargar ocho filas por edificio a mano, pero sí escribe un
    // párrafo; y de un párrafo Marcos saca lo mismo.
    router.post('/api/accesos-relato', async (req, res) => {
        if (bloquearSiPreview(req, res)) return;
        try {
            const edificio = edificioObjetivo(req);
            if (!edificio) return res.status(400).json({ error: 'Sin edificio asignado' });

            const texto = String((req.body || {}).texto || '').trim();
            if (!texto) return res.status(400).json({ error: 'Falta el texto' });

            const { extraerAccesosDeTexto } = require('./accesos');
            // `forzar`: acá la persona está describiendo el edificio a propósito, así que no se le
            // exige que use palabras clave para tomarla en serio.
            const encontrados = await extraerAccesosDeTexto({
                texto,
                quienLoDijo: esDueno(req) ? 'la administración' : 'el administrador del consorcio',
                forzar: true,
            });

            const { guardarAccesoEdificio, buscarAccesosEdificio } = require('./datos');
            for (const a of encontrados) {
                await guardarAccesoEdificio({
                    edificio,
                    lugar:      a.lugar,
                    ubicacion:  a.ubicacion,
                    quienAbre:  a.quien_abre,
                    telefono:   a.telefono,
                    tipoAcceso: a.tipo_acceso,
                    notas:      a.notas,
                    origen:     'Descripción del administrador',
                });
            }

            res.json({
                ok: true,
                detectados: encontrados.length,
                accesos: await buscarAccesosEdificio(edificio),
            });
        } catch (e) {
            res.status(500).json({ error: e.message || String(e) });
        }
    });

    return router;
};
