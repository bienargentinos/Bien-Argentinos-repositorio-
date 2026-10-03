/**
 * LA MEMORIA DE CADA LÍNEA, CON UNA SOLA FORMA DE ESCRIBIR EL NÚMERO
 *
 * > [!CAUTION]
 * > **El mismo teléfono llegaba escrito de dos formas y la memoria lo guardaba como dos líneas.**
 *
 * Prueba de cerrajería, 28/09. Marcos le mandó a lalala la plantilla del CASO-1003 y anotó "esta
 * línea está en el CASO-1003" bajo `541169241157` --el número como está cargado en la planilla--.
 * El técnico contestó "Ok" y WhatsApp lo entregó desde `5491169241157` --con el 9 del celular--.
 * Marcos buscó la línea con esa otra forma, no encontró nada, y cayó en "el caso más reciente":
 *
 *     🔎 Dario tiene 2 caso(s) abierto(s); se toma el más reciente: [CASO-1004] de San Patricio 159.
 *     ♻️ Caso del técnico Dario recuperado tras reinicio: [CASO-1004] (San Patricio 159)
 *
 * No hubo ningún reinicio. Al técnico le llegaron la foto y los datos de OTRO caso, y su "Ok" quedó
 * anotado como confirmación del CASO-1004. **No es un problema de la línea compartida de prueba**:
 * le pasa a cualquier técnico cargado sin el 9, que es como la mayoría de la gente anota un celular.
 *
 * `global.colasProveedores` se usa en treinta lugares, con el número escrito como viniera en cada
 * uno. En vez de corregir treinta llamadas --y olvidarse de la treinta y una--, el mapa normaliza la
 * clave él mismo: **los últimos 10 dígitos**, que es el número nacional argentino (área + abonado)
 * sin el 54, el 9 ni el 0/15. Es el mismo criterio que ya usa `revisar-sobrantes.js` para comparar
 * teléfonos entre las dos bases.
 */

const claveDeLinea = (tel) => {
    const d = String(tel ?? '').replace(/\D/g, '');
    return d.length > 10 ? d.slice(-10) : d;
};

class MapaDeLineas extends Map {
    get(k)          { return super.get(claveDeLinea(k)); }
    set(k, v)       { return super.set(claveDeLinea(k), v); }
    has(k)          { return super.has(claveDeLinea(k)); }
    delete(k)       { return super.delete(claveDeLinea(k)); }
}

/**
 * Devuelve `global.colasProveedores`, creándolo si falta. Si alguien lo había creado como un `Map`
 * común, lo pasa a `MapaDeLineas` conservando lo que tenía (con las claves ya normalizadas).
 */
function mapaDeLineas() {
    const actual = global.colasProveedores;
    if (actual instanceof MapaDeLineas) return actual;
    const nuevo = new MapaDeLineas();
    if (actual instanceof Map) {
        for (const [k, v] of actual) {
            if (!nuevo.has(k)) nuevo.set(k, v);
        }
    }
    global.colasProveedores = nuevo;
    return nuevo;
}

module.exports = { claveDeLinea, MapaDeLineas, mapaDeLineas };
