// PROBAR EL RUTEO — le pasa frases reales al modelo y muestra qué entendió
//
//   node probar-ruteo.js
//
// No manda ningún WhatsApp, no toca la planilla, no escribe en la base. Solo le pregunta al
// modelo de qué se trata cada frase y compara con lo que decía la condición de texto vieja.
//
// PARA QUÉ. El ruteo nuevo no se puede probar desde una máquina sin la clave de Gemini, así que
// no hay forma de afirmar que funciona sin correr esto. Antes de dejar que decida sobre un
// mensaje de verdad, conviene ver con los propios ojos qué contesta.
//
// Las frases son las REALES de los chats de Daniel, con el resultado que debería dar. Las que
// tienen ⚠️ son las que el sistema viejo contestaba mal.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { clasificarMensajeProveedor, ACTIVO } = require('./ruteo-proveedor');

// frase, intención esperada, contexto, y si el sistema viejo se equivocaba con esta
const CASOS = [
    // ── EL BUCLE DE LAS FOTOS ────────────────────────────────────────────────
    ['La foto también es del caso', 'otro',
        { ultimaPreguntaDeMarcos: '¿De qué edificio es esta factura?', mandoAdjunto: true }, true],
    ['No, ya te acabo de mandar una foto, esa foto pertenece al caso 1001, no te estoy pidiendo fotos de nada, te estás confundiendo',
        'corrige_a_marcos', { casoAbierto: 'CASO-1001' }, true],
    ['pedile una foto al vecino asi veo de que marca es', 'pide_datos_al_vecino', {}, false],

    // ── EL NÚMERO DE CASO ────────────────────────────────────────────────────
    ['1001 es el caso', 'responde_de_que_obra',
        { ultimaPreguntaDeMarcos: '¿De qué edificio es esta factura?', facturaEsperandoObra: true }, true],
    ['De San Patricio 270', 'responde_de_que_obra',
        { ultimaPreguntaDeMarcos: '¿De qué edificio es esta factura?', facturaEsperandoObra: true }, false],

    // ── LA CÁMARA APAGADA ────────────────────────────────────────────────────
    ['hay que ver una camara apagada en san patricio 270', 'avisa_que_lo_convocaron', {}, true],
    ['¿ya me pagaron la factura 284?', 'consulta_pago', {}, false],
    ['¿cuándo cobro lo del 270?', 'consulta_pago', {}, false],

    // ── EL AVISO POR AUDIO (con los acentos que pone la transcripción) ───────
    ['Hola, qué tal. Buenas noches. Me llamaron de San Patricio 270 que no hay luz en el hall de entrada y al parecer saltó una térmica del tablero',
        'avisa_que_lo_convocaron', {}, true],
    ['llamó el encargado de san patricio 270 por el tablero', 'avisa_que_lo_convocaron', {}, true],

    // ── LA LLAVE ─────────────────────────────────────────────────────────────
    ['Tengo llave. Y que no necesito nada. Voy en 2hs a revisar y te aviso', 'entra_solo',
        { casoAbierto: 'CASO-1001' }, true],
    ['no tengo llave, avisale al encargado', 'otro', { casoAbierto: 'CASO-1001' }, false],

    // ── AGENDA Y CIERRE ──────────────────────────────────────────────────────
    ['si, mañana a las 10', 'confirma_que_va',
        { ultimaPreguntaDeMarcos: '¿Vas a poder pasar? ¿Cuándo?' }, false],
    ['Ya resolví, era un cable cortado y lo rescate solo', 'informa_resuelto',
        { casoAbierto: 'CASO-1001' }, false],
    ['Llegué y no me abre nadie', 'llego_y_no_le_abren', { casoAbierto: 'CASO-1001' }, false],
    ['gracias por avisar', 'otro', {}, false],
];

(async () => {
    if (!ACTIVO) {
        console.log('\n⚠️  RUTEO_IA está en `off` en el .env. Ponelo en `on` para probar esto.\n');
        process.exit(1);
    }
    if (!process.env.GEMINI_API_KEY) {
        console.log('\n❌ No hay GEMINI_API_KEY en el .env. Sin eso el ruteo no puede correr.\n');
        process.exit(1);
    }

    console.log('\n🧭 Probando el ruteo contra frases reales de los chats. No se manda nada.\n');

    let bien = 0, mal = 0, arreglados = 0, rotos = 0;

    for (const [frase, esperada, contexto, loViejoFallaba] of CASOS) {
        const r = await clasificarMensajeProveedor({ texto: frase, contexto });

        if (!r) {
            console.log(`  ⚠️  SIN RESPUESTA  "${frase.slice(0, 55)}…"`);
            console.log(`      (el modelo falló o tardó; en producción se sigue por texto)\n`);
            mal++;
            continue;
        }

        const ok = r.intencion === esperada;
        ok ? bien++ : mal++;
        if (ok && loViejoFallaba) arreglados++;
        if (!ok && !loViejoFallaba) rotos++;

        const marca = ok ? (loViejoFallaba ? '🎉 ARREGLA' : '✅ bien   ') : '❌ MAL    ';
        console.log(`  ${marca}  "${frase.slice(0, 55)}${frase.length > 55 ? '…' : ''}"`);
        console.log(`      leyó: ${r.intencion} (${r.confianza}) — ${r.motivo}`);
        if (!ok) console.log(`      esperaba: ${esperada}`);
        console.log('');
    }

    console.log('─'.repeat(60));
    console.log(`Bien: ${bien}   Mal: ${mal}   de ${CASOS.length}`);
    console.log(`🎉 Casos que el sistema viejo contestaba mal y ahora salen bien: ${arreglados}`);
    if (rotos) console.log(`⚠️  Casos que ANTES salían bien y ahora no: ${rotos}  ← mirar estos primero`);
    console.log('');
    console.log(rotos > 0
        ? '⚠️  Hay retrocesos. Conviene ver esos casos antes de dejarlo suelto.'
        : (mal === 0
            ? '✅ Todas bien. El ruteo entiende las frases que rompían el sistema viejo.'
            : '🟡 Quedan casos flojos, pero ninguno es un retroceso: son los que el sistema viejo tampoco resolvía.'));
    console.log('');
    process.exit(0);
})();
