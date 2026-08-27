// Equivalencias entre las mil formas de nombrar un oficio.
//
// Vive en su propio archivo porque lo necesitan tres lados: `index.js` (para saber cuál de los
// técnicos que comparten una línea telefónica está escribiendo), `sheets.js` (para saber si un
// reclamo nuevo es la continuación de un caso abierto o es otro caso) y la derivación de casos.
// Tenerlo copiado en cada uno garantizaba que un rubro se leyera distinto según quién preguntara.

/**
 * Si dos formas de nombrar un oficio son el mismo oficio.
 *
 * "electricista", "electricidad" y "luz" son lo mismo. "plomería" y "electricidad" no.
 * Con cualquiera de los dos vacío devuelve false: no se puede afirmar que coincidan.
 */
function coincideRubro(a, b) {
    const x = String(a || '').toLowerCase().trim();
    const y = String(b || '').toLowerCase().trim();
    if (!x || !y) return false;
    if (x.includes(y) || y.includes(x)) return true;

    const familias = [
        ['electr', 'luz', 'tablero', 'iluminacion'],
        ['plom', 'agua', 'cloaca', 'cania', 'caño'],
        ['gas', 'calder', 'termotanque'],
        ['cerraj', 'llav'],
        // Las de corriente débil van SEPARADAS de electricidad y separadas entre sí. Son trabajos
        // distintos aunque los haga el mismo electricista: cambiar un portero no es poner una
        // cámara ni configurar tarjetas de acceso.
        ['porter', 'citofon', 'frente de calle'],
        ['cctv', 'camara', 'cámara', 'videovigilancia', 'dvr', 'nvr'],
        ['control de acceso', 'tarjeta', 'huella', 'molinete', 'cerradura magn', 'pestillo magn'],
        ['alban', 'albañ', 'mamposter', 'pared'],
        ['ascensor', 'montacarga'],
        ['refriger', 'aire', 'split'],
    ];
    return familias.some(f => f.some(t => x.includes(t)) && f.some(t => y.includes(t)));
}

// Un electricista de edificios no hace solo electricidad: hace portería, control de acceso y
// CCTV. Son todos trabajos de corriente débil, y en la práctica los cubre la misma persona.
const CORRIENTE_DEBIL = ['electr', 'luz', 'tablero', 'porter', 'citofon', 'cctv', 'camara', 'cámara', 'videovigilancia', 'control de acceso', 'tarjeta', 'huella', 'molinete', 'cerradura magn'];

/**
 * Si un técnico con ESE oficio atiende ESE tipo de trabajo.
 *
 * Es una pregunta distinta de `coincideRubro`, y por eso es otra función.
 *
 * - `coincideRubro` responde **"¿es el mismo trabajo?"** y se usa para separar un reclamo nuevo
 *   de un caso abierto. Ahí conviene ser estricto: cambiar el portero eléctrico no es lo mismo
 *   que poner una cámara, aunque las dos las haga el mismo electricista. Si se mezclan, dos
 *   trabajos distintos terminan adentro de un solo caso con una sola factura.
 * - `atiendeRubro` responde **"¿este es el que hace esto?"** y se usa para elegir cuál de los
 *   técnicos que comparten una línea telefónica está escribiendo. Ahí hay que ser amplio: la
 *   ficha de Dario dice "Electricista" y el caso es de CCTV, y es él igual.
 *
 * Con una sola función había que elegir cuál de las dos romper. Con el criterio estricto, un caso
 * de portería no encontraba al electricista de la línea compartida; con el amplio, un reclamo de
 * cámaras se metía adentro del caso de la luz que ya estaba abierto.
 *
 * Ojo: esto es un respaldo, no la respuesta buena. Lo correcto es que la ficha del proveedor
 * liste sus rubros de verdad (`electricidad, portería, control de acceso, cctv`), y eso ya
 * funciona porque la comparación mira si un texto contiene al otro.
 */
function atiendeRubro(especialidad, rubroDelTrabajo) {
    const oficio = String(especialidad || '').toLowerCase().trim();
    const trabajo = String(rubroDelTrabajo || '').toLowerCase().trim();
    if (!oficio || !trabajo) return false;
    if (coincideRubro(oficio, trabajo)) return true;
    return CORRIENTE_DEBIL.some(t => oficio.includes(t)) && CORRIENTE_DEBIL.some(t => trabajo.includes(t));
}

/**
 * Qué oficio hace falta, deducido de lo que la persona contó.
 *
 * POR QUÉ HACE FALTA. El rubro del caso es lo que decide si un reclamo nuevo es otro caso o la
 * continuación del abierto, y cuál de los técnicos de una línea compartida está escribiendo. Pero
 * hasta ahora salía solo de la ficha del proveedor o del técnico ya asignado, y en la planilla real
 * eso viene vacío seguido: los cuatro primeros casos quedaron TODOS "sin rubro", así que toda la
 * lógica que depende de él estaba muerta sin que nada avisara.
 *
 * Lo que sí está siempre es lo que la persona dijo: "un problema eléctrico en las luminarias de la
 * cochera" no deja lugar a dudas. Esto NO reemplaza al rubro cargado -- se usa solo cuando no hay
 * ninguno.
 *
 * Devuelve '' cuando el texto no alcanza para decidir. Preferible vacío que inventado: un rubro
 * equivocado separa casos que son el mismo, o manda el aviso al gremio que no es.
 */
function rubroDelTexto(texto) {
    const t = String(texto || '').toLowerCase();
    if (!t.trim()) return '';

    // El orden importa: lo más específico primero. "luz de la cochera" es electricidad aunque
    // diga cochera, y "pérdida de gas" es gas aunque diga caño.
    const pistas = [
        ['gas',           /\bgas\b|garrafa|calefactor|calefaccion|calefacción|caldera|termotanque|estufa/],
        // ── CORRIENTE DÉBIL: VAN ANTES QUE ELECTRICIDAD ─────────────────────────────────────
        //
        // Un electricista de edificios hace las cuatro cosas --electricidad, portería, control de
        // acceso y CCTV-- pero son trabajos distintos, y el reclamo de la cámara tiene que poder
        // distinguirse del de la luz aunque los atienda la misma persona.
        //
        // El orden acá no es un detalle: "portero ELÉCTRICO" y "cerradura ELECTROmagnética"
        // contienen la palabra que dispara electricidad. Si electricidad va primero se las lleva
        // todas puestas y no queda ninguna diferencia que mirar.
        ['cctv',              /cctv|c[aá]mara|videovigilancia|video vigilancia|\bdvr\b|\bnvr\b|grabador de video/],
        ['control de acceso', /control de acceso|tarjeta magn|tarjeta de acceso|llavero de proximidad|\btag\b|huella|biom[eé]tric|molinete|cerradura magn[eé]tica|cerradura electromagn|pestillo magn[eé]tico|electroim[aá]n/],
        ['portería',          /portero el[eé]ctrico|porter[oó]n el[eé]ctrico|citofon|frente de calle|tel[eé]fono del portero|no anda el portero/],

        ['electricidad',  /electric|el[eé]ctric|luminaria|l[aá]mpara|lampara|tablero|disyuntor|t[eé]rmica|cortocircuito|\bluz\b|\bluces\b|iluminaci[oó]n|enchufe|instalaci[oó]n el[eé]ctrica/],
        ['plomería',      /plomer|ca[nñ]o|cañer|canier|p[eé]rdida de agua|perdida de agua|filtraci[oó]n|filtracion|cloaca|desag[uü]e|inodoro|canilla|bomba de agua|tanque de agua|destap/],
        ['cerrajería',    /cerrajer|cerradura|\bllave\b|\bllaves\b|porter[oó]n|no cierra la puerta|no abre la puerta|traba/],
        ['ascensores',    /ascensor|montacarga|elevador/],
        ['refrigeración', /aire acondicionado|\bsplit\b|refrigeraci[oó]n|climatizaci[oó]n/],
        ['jardinería',    /jardin|jard[ií]n|c[eé]sped|cesped|poda|podar|planta|parque|riego/],
        ['albañilería',   /alba[nñ]il|mamposter|revoque|pared|humedad|grieta|rajadura|techo|membrana|filtraci[oó]n de techo/],
        ['pintura',       /pintur|pintar|pintor/],
        ['herrería',      /herrer|reja|port[oó]n de hierro|soldar|soldadura/],
        ['vidriería',     /vidrier|vidrio|ventanal|cristal/],
        ['limpieza',      /limpieza|basura|residuos|contenedor|desinfecci[oó]n|fumigaci[oó]n/],
    ];

    for (const [rubro, patron] of pistas) {
        if (patron.test(t)) return rubro;
    }
    return '';
}

/**
 * El rubro de UN CASO, que no es lo mismo que el oficio de quien escribe.
 *
 * > **`especialidad` es el oficio de la PERSONA. El rubro es de qué se trata ESTE trabajo.**
 *
 * Se mezclaban, y eso rompía justo lo que el rubro existe para resolver. Caso real: Dario está
 * cargado como "Electricista", avisa que lo llamaron por una PÉRDIDA DE AGUA, y el caso quedaba
 * marcado "Electricista" -- el mismo rubro que el caso eléctrico que tenía abierto en ese
 * edificio. Como los rubros coincidían, el aviso de plomería se pegó adentro del caso de la luz.
 *
 * Y pasa siempre: a un electricista lo llaman para un portero eléctrico, para un tablero o para
 * una bomba, y el encargado le reporta cosas que no tienen nada que ver con lo que dice su ficha.
 * Un mismo técnico hace trabajos de rubros distintos; su oficio no dice cuál es el de hoy.
 *
 * Por eso manda lo que la persona contó. La ficha queda de respaldo, para cuando el texto no
 * alcanza para decidir.
 *
 * Y "Proveedor" NO es un rubro: es un rol. Se escribía como rubro cuando la ficha venía vacía, y
 * con eso `coincideRubro` comparaba contra una palabra que no es ningún oficio.
 */
function rubroDelCaso(texto, especialidad = '') {
    const delTexto = rubroDelTexto(texto);
    if (delTexto) return delTexto;

    const ficha = String(especialidad || '').trim();
    if (!ficha) return '';
    // Roles y comodines: no dicen qué oficio hace falta.
    if (/^(proveedor|proveedora|t[eé]cnico|t[eé]cnica|general|generales|otro|otros|varios|sin rubro)$/i.test(ficha)) return '';
    return ficha;
}

module.exports = { coincideRubro, atiendeRubro, rubroDelTexto, rubroDelCaso };
