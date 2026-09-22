/**
 * UN SEGUIMIENTO QUE NO SE PUEDE AGENDAR TIENE QUE GRITAR
 *
 * > [!CAUTION]
 * > **Cambié una repetición infinita por un estancamiento infinito, y el estancamiento es peor
 * > porque es mudo.**
 *
 * El arreglo anterior --reservar el próximo control ANTES de mandar-- resolvió que al técnico le
 * llegara la misma pregunta una y otra vez. Pero dejó la otra mitad sin mirar: si
 * `programarSeguimiento` devuelve `false`, `revisarSeguimientos` se abstiene de mandar y vuelve a
 * intentar a los cinco minutos. Para siempre.
 *
 * En producción eso fue así durante horas, y lo único escrito en el log era:
 *
 *     ⏱️ 3 caso(s) con seguimiento vencido.
 *     🛠️ [CASO-1004] no se pudo agendar el paso 2, así que NO se le pregunta al técnico
 *
 * Nada sobre POR QUÉ. Cuatro de las siete salidas de `programarSeguimiento` se anunciaban; tres
 * devolvían `false` sin escribir una línea:
 *
 *   1. sin `id_evento` o sin fecha
 *   2. sin la pestaña `EVENTOS`
 *   3. **sin encontrar la fila** — la más probable, y por un motivo estructural: el barrido lee de
 *      PostgreSQL (`reportes.codigo_caso`) y el agendado escribe en Sheets (`EVENTOS.id_evento`).
 *
 * Esta prueba es el candado. No verifica que el seguimiento funcione --eso lo hace
 * `pruebas-seguimiento-una-vez.js`-- sino que **ningún camino que devuelve `false` pueda volver a
 * hacerlo en silencio**. Un diagnóstico imposible cuesta más que el bug.
 *
 *     node pruebas-seguimiento-mudo.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n⏱️ UN SEGUIMIENTO QUE NO SE PUEDE AGENDAR TIENE QUE GRITAR\n');

const fuente = fs.readFileSync(path.join(__dirname, 'sheets.js'), 'utf8');

/** El cuerpo de una función, desde su firma hasta la línea que la cierra en la columna 0. */
function cuerpoDe(codigo, firma) {
    const desde = codigo.indexOf(firma);
    if (desde < 0) return null;
    const resto = codigo.slice(desde);
    const fin = resto.search(/\n\}\n/);
    return fin < 0 ? resto : resto.slice(0, fin);
}

// Los comentarios se sacan ANTES de buscar: este archivo explica el bug citando el código que lo
// causaba, y un candado que se dispara con su propia documentación ya nos hizo perder tres ratos.
function soloCodigo(txt) {
    return txt
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) Ningún `return false` mudo en programarSeguimiento');
// ─────────────────────────────────────────────────────────────────────────────
{
    const cuerpo = cuerpoDe(fuente, 'async function programarSeguimiento(');
    vale('se encontró la función', !!cuerpo,
        'Si le cambiaron el nombre, este candado dejó de cuidar nada.');

    if (cuerpo) {
        const codigo = soloCodigo(cuerpo);
        const lineas = codigo.split('\n');

        // Cada `return false` tiene que tener un console.warn/error/log a la vista: en la misma
        // línea o en las tres anteriores (el patrón es `console.x(...)` y después `return false`).
        const mudos = [];
        lineas.forEach((linea, i) => {
            if (!/return\s+false\s*;?\s*$/.test(linea.trim())) return;
            const ventana = lineas.slice(Math.max(0, i - 4), i + 1).join('\n');
            if (!/console\.(warn|error|log)\s*\(/.test(ventana)) {
                mudos.push(linea.trim());
            }
        });

        vale(`los ${lineas.filter(l => /return\s+false/.test(l)).length} \`return false\` avisan por qué`,
            mudos.length === 0,
            mudos.length
                ? `Mudos: ${mudos.join(' | ')} — un caso trabado acá no deja rastro y se repite para siempre.`
                : '');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Y las tres salidas que fallaron en producción están cubiertas por nombre');
// ─────────────────────────────────────────────────────────────────────────────
{
    const cuerpo = soloCodigo(cuerpoDe(fuente, 'async function programarSeguimiento(') || '');

    vale('la fila que no aparece nombra las dos bases',
        /no est[áa] en la pesta[ñn]a EVENTOS/i.test(cuerpo),
        'Es la causa más probable y la que más cuesta diagnosticar: hay que decirla con todas las letras.');

    vale('…y manda a la herramienta que lo resuelve',
        /revisar-seguimientos\.js/.test(cuerpo),
        'Un error que no dice qué hacer después obliga a rehacer el diagnóstico entero cada vez.');

    vale('la pestaña que falta también avisa',
        /no se encontr[óo] la pesta[ñn]a EVENTOS/i.test(cuerpo));

    vale('y el caso sin id o sin fecha también',
        /programarSeguimiento sin/i.test(cuerpo));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) La herramienta de diagnóstico existe y solo lee');
// ─────────────────────────────────────────────────────────────────────────────
{
    const ruta = path.join(__dirname, 'revisar-seguimientos.js');
    vale('`revisar-seguimientos.js` está', fs.existsSync(ruta));

    if (fs.existsSync(ruta)) {
        const tool = soloCodigo(fs.readFileSync(ruta, 'utf8'));
        // Una herramienta de diagnóstico que modifica lo que diagnostica no sirve para nada.
        vale('no escribe en Sheets', !/\.save\s*\(|\.addRow\s*\(|setHeaderRow/.test(tool),
            'Tiene que poder correrse en producción sin pensarlo dos veces.');
        vale('no escribe en PostgreSQL', !/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(tool),
            'Lo mismo del otro lado.');
        vale('no llama a programarSeguimiento',
            !/programarSeguimiento\s*\(/.test(tool),
            'Llamarla AGENDARÍA: el diagnóstico cambiaría lo que está midiendo.');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) El estado viaja desde las DOS bases, no solo desde Sheets');
// ─────────────────────────────────────────────────────────────────────────────
{
    // El paso 1 pregunta "¿vas a poder pasar?" en vez de "¿pudiste pasar?" cuando el caso está
    // `avisado`. Eso lee `caso.estado`, y la versión de PostgreSQL --que es de donde se lee
    // PRIMERO-- no lo mandaba: la distinción estaba muerta en producción.
    for (const archivo of ['sheets.js', 'datos-pg.js']) {
        const cuerpo = cuerpoDe(fs.readFileSync(path.join(__dirname, archivo), 'utf8'),
            'async function obtenerSeguimientosVencidos(');
        vale(`${archivo} manda el estado`,
            !!cuerpo && /estado:\s*r\.get\(['"]estado['"]\)/.test(soloCodigo(cuerpo)),
            'Sin el estado se le reclama a un técnico por un incumplimiento que nunca prometió.');
    }
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Un caso trabado en silencio se repite cada 5 minutos para siempre.\n');
    process.exit(1);
}
console.log('\n   ⏱️ Si no se puede agendar, se sabe por qué.\n');
