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
        ['cerraj', 'llav', 'port', 'puerta'],
        ['alban', 'albañ', 'mamposter', 'pared'],
        ['ascensor', 'montacarga'],
        ['refriger', 'aire', 'split'],
    ];
    return familias.some(f => f.some(t => x.includes(t)) && f.some(t => y.includes(t)));
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
        ['electricidad',  /electric|el[eé]ctric|luminaria|l[aá]mpara|lampara|tablero|disyuntor|t[eé]rmica|cortocircuito|\bluz\b|\bluces\b|iluminaci[oó]n|enchufe|instalaci[oó]n el[eé]ctrica/],
        ['plomería',      /plomer|ca[nñ]o|cañer|canier|p[eé]rdida de agua|perdida de agua|filtraci[oó]n|filtracion|cloaca|desag[uü]e|inodoro|canilla|bomba de agua|tanque de agua|destap/],
        ['cerrajería',    /cerrajer|cerradura|\bllave\b|\bllaves\b|portero el[eé]ctrico|porter[oó]n|no cierra la puerta|no abre la puerta|traba/],
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

module.exports = { coincideRubro, rubroDelTexto };
