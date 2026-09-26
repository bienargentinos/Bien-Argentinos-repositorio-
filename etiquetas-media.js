// ETIQUETAS DE MULTIMEDIA — separar lo que lee una máquina de lo que lee una persona
//
// Cuando llega un audio, una foto o un documento, el texto se guarda con una etiqueta adelante:
//
//     [AUDIO:/archivos/administracion_general/edificio_general/audios/media_4465773590357338.ogg]
//     Hola, ¿qué tal? Buenas noches. Me llamaron de San Patricio 270…
//
// Eso está bien y hace falta: es lo que le permite al panel mostrar el reproductor al lado de la
// transcripción, y lo que deja recuperar la foto de un caso después de que PM2 reinició.
//
// > [!CAUTION]
// > **Pero esa etiqueta es para el panel, no para una persona.**
//
// Visto en producción: al administrador le llegó por WhatsApp, dentro del aviso de un caso nuevo,
// esto tal cual:
//
//     🗣️ Textual: "[AUDIO:/archivos/administracion_general/edificio_general/audios/
//     media_4465773590357338.ogg] Hola, ¿qué tal? Buenas noches. Me llamaron de San Patricio 270…"
//
// Un administrador leyendo una ruta de archivo del servidor adentro de la frase del técnico. No es
// solo feo: es Marcos mostrando la costura, y a un cliente que paga eso le dice que del otro lado
// no hay nadie mirando.
//
// La regla es simple y va en un solo lugar para que no haya dos versiones: **lo que se guarda
// lleva la etiqueta; lo que sale hacia una persona, no.**

// Todas las que escribe el motor, en cualquiera de sus formas. El contenido puede ser una URL,
// una ruta del disco o un id de Meta.
//
// La lista va acá y en ningún otro lado. Cuando este arreglo se hizo, quedó escrito tres veces
// --en este archivo, en `limpiarTextoProblema` de index.js y adentro de `limpiarParaTerceros` de
// marcos-ops.js-- porque dos personas lo arreglaron el mismo día en lugares distintos. Con tres
// copias, agregar una etiqueta nueva significa acordarse de tres lugares, y en este repo ya
// sabemos cómo termina eso: `buscarPerfilEdificio` estaba duplicado y arreglar una copia no
// cambiaba nada en producción.
const ETIQUETA = /\[(AUDIO|AUDIO_URL|IMAGEN|FOTO|VIDEO|DOCUMENTO|DOC|PDF|FACTURA):[^\]]*\]/gi;

/**
 * El texto como lo tiene que leer una persona: sin las etiquetas internas.
 *
 * No toca nada más. Si de la frase no queda nada --el técnico mandó una nota de voz y ninguna
 * palabra-- devuelve '' y el llamador decide qué decir; inventar un texto sería peor.
 */
function soloTexto(texto) {
    return String(texto || '')
        .replace(ETIQUETA, ' ')
        // Quedan restos cuando la etiqueta estaba pegada a un signo: " ." o dos espacios.
        .replace(/\s{2,}/g, ' ')
        .replace(/^\s*[.,;:]+\s*/, '')
        .trim();
}

/** Si el texto trae alguna etiqueta interna. Sirve para no mandar afuera algo sin limpiar. */
function tieneEtiquetas(texto) {
    return new RegExp(ETIQUETA.source, 'i').test(String(texto || ''));
}

module.exports = { soloTexto, tieneEtiquetas };
