// archivo-subido.js -- COMO SE LLAMA UN ARCHIVO QUE SUBE UNA PERSONA.
//
// > [!CAUTION]
// > **La extension NO puede salir del nombre que manda el navegador.** Las cinco subidas del
// > proyecto hacian `path.extname(file.originalname)`, y `originalname` lo elige quien sube.
//
// Lo que eso permitia, verificado: subir un archivo llamado `cualquiera.html` a la foto de perfil
// lo guardaba como `avatar_2_1759….html` dentro de `almacenamiento/`, que `index.js` sirve entero
// en `/archivos`. Medido contra las mismas estaticas de produccion:
//
//     codigo HTTP : 200
//     Content-Type: text/html; charset=UTF-8
//     cuerpo      : <script>alert(document.domain)</script>
//
// O sea: una pagina con el script de otro, servida desde marcos.bienargentinos.com -- el MISMO
// dominio del portal y del panel. Desde ahi el script corre con la sesion de quien la abra: puede
// pedirle al portal un pase QR, o tocar cualquier endpoint del panel como si fuera esa persona. No
// hace falta leer la cookie; alcanza con usarla.
//
// El guardia de `expensa-privada.js` no lo tapa (solo mira los archivos que se llaman `expensa_*`)
// y ningun multer del proyecto tenia `fileFilter`.
//
// LA REGLA: la extension sale de una lista NUESTRA, nunca del nombre de quien sube. Lo que no
// esta en la lista se rechaza, no se renombra -- un comprobante que no sabemos que es, es mejor
// rechazarlo fuerte que guardarlo diciendo que es otra cosa.
//
// (Nada de acentos graves aca adentro.)

const path = require('path');

// Tipo que declara el navegador -> extension que le ponemos NOSOTROS.
const IMAGENES = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    // Las fotos de un iPhone llegan asi. Se aceptan porque si no, medio banco de pruebas no puede
    // subir una foto; que un Android no las dibuje es un problema distinto y ya existia.
    'image/heic': '.heic',
    'image/heif': '.heif'
};

const DOCUMENTOS = {
    'application/pdf': '.pdf'
};

const COMPROBANTES = Object.assign({}, IMAGENES, DOCUMENTOS);

// Algunos navegadores y celulares mandan esto cuando no reconocen el archivo, incluso con un JPEG
// comun. Rechazarlo de plano haria fallar subidas legitimas, asi que SOLO en ese caso se mira la
// extension del nombre -- y aun asi tiene que estar en la lista. La extension nunca sale de afuera
// de la lista: eso es lo que cierra el agujero.
const SIN_TIPO = ['application/octet-stream', 'binary/octet-stream', ''];

function extensionSegura(file, permitidos) {
    const tipo = String((file && file.mimetype) || '').toLowerCase().trim();

    if (permitidos[tipo]) return permitidos[tipo];

    if (SIN_TIPO.includes(tipo)) {
        const delNombre = path.extname(String((file && file.originalname) || '')).toLowerCase();
        const valida = Object.values(permitidos).includes(delNombre);
        if (valida) return delNombre;
    }

    return null;
}

// El `fileFilter` de multer. Rechaza antes de escribir nada en el disco.
function filtroDeSubida(permitidos, queEs) {
    return function (req, file, cb) {
        if (extensionSegura(file, permitidos)) return cb(null, true);
        const err = new Error(
            'Tipo de archivo no permitido para ' + queEs + ': "' + String((file && file.mimetype) || 'sin tipo') + '".'
        );
        err.code = 'TIPO_NO_PERMITIDO';
        cb(err);
    };
}

// El nombre con el que se guarda. `prefijo` y `partes` los decide el codigo nuestro; lo unico que
// viene de afuera es el TIPO, y ya paso por la lista.
function nombreDeArchivo(prefijo, file, permitidos, partes = []) {
    const ext = extensionSegura(file, permitidos);
    if (!ext) throw new Error('No se puede nombrar un archivo de tipo no permitido.');
    const limpias = partes
        .map((p) => String(p == null ? '' : p).replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter(Boolean);
    return [prefijo, ...limpias, Date.now()].join('_') + ext;
}

// Una subida rechazada NO puede contestar HTML.
//
// > [!CAUTION]
// > Sin esto, el error del `fileFilter` sube al manejador por defecto de Express, que devuelve su
// > pagina de error en HTML, y el `await r.json()` del navegador informa `JSON.parse: unexpected
// > character` -- el mismo sintoma que ya esta anotado en `CLAUDE.md` por otras dos causas y que
// > costo horas de diagnostico.
//
// Envuelve el middleware de multer de una ruta: `router.post(ruta, conSubida(upload.single('x')), ...)`.
// Devuelve 400 con el motivo, que es lo que la pantalla puede mostrarle a la persona. Vive aca y no
// en cada router para que el panel la LLAME en vez de copiarla.
function conSubida(middleware) {
    return function (req, res, next) {
        middleware(req, res, function (err) {
            if (!err) return next();
            const demasiadoGrande = err.code === 'LIMIT_FILE_SIZE';
            console.warn('📎⛔ Subida rechazada:', err.code || 's/codigo', err.message);
            return res.status(400).json({
                ok: false,
                error: demasiadoGrande ? 'El archivo es demasiado grande.' : (err.message || 'No se pudo subir el archivo.')
            });
        });
    };
}

module.exports = {
    IMAGENES,
    DOCUMENTOS,
    COMPROBANTES,
    SIN_TIPO,
    extensionSegura,
    filtroDeSubida,
    nombreDeArchivo,
    conSubida
};
