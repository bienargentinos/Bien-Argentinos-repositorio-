/**
 * UN VERIFICADOR NO PUEDE REVISAR SOLO LO QUE ALGUIEN SE ACORDÓ DE ANOTAR
 *
 * > [!CAUTION]
 * > **`revisar-edificios.js` informó "2 filas" donde había 5 lugares.**
 *
 * Buscando el nombre huérfano "Torre Norte Edifica", el informe dijo que estaba en
 * `reservas_amenities.edificio` (2 filas) y nada más. `buscar-texto.js` --que no usa ninguna
 * lista, le pregunta a la base-- encontró cinco:
 *
 *     🐘 eventos_acceso.edificio     · fila 4
 *     🐘 eventos_acceso.edificio     · fila 5
 *     🐘 pases_qr.edificio           · fila 4      ← un PASE DE ACCESO: la puerta de un edificio
 *     🐘 reservas_amenities.edificio · fila 1
 *     🐘 reservas_amenities.edificio · fila 2
 *
 * La causa: la lista de tablas estaba **escrita a mano**, y `pases_qr` y `eventos_acceso` nacieron
 * después. Es el cuarto caso del mismo defecto en este proyecto, después de la sección "¿falta
 * alguna función?" del verificador, la lista de `node --check`, y las columnas de Sheets.
 *
 * Un verificador incompleto es peor que no tenerlo: da por cerrado lo que sigue abierto, y quien
 * lo lee deja de buscar.
 *
 * La regla ahora no se anota: **una columna que se llama `edificio` guarda el nombre de un
 * edificio.** Una tabla nueva queda cubierta el día que se crea.
 *
 *     node pruebas-revisar-edificios.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

console.log('\n🏢 UN VERIFICADOR NO PUEDE REVISAR SOLO LO QUE ALGUIEN ANOTÓ\n');

const ruta = path.join(__dirname, 'revisar-edificios.js');
const crudo = fs.readFileSync(ruta, 'utf8');
// Los comentarios se sacan antes de buscar: este archivo explica el bug citando lo que lo causaba,
// y un candado que se dispara con su propia documentación ya nos hizo perder tres ratos.
const codigo = crudo
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) La decisión es por el NOMBRE de la columna, no por una lista de tablas');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('existe `esColumnaDeEdificio`', /function esColumnaDeEdificio|esColumnaDeEdificio\s*=/.test(codigo));
    vale('existe `esListaDeEdificios`', /function esListaDeEdificios|esListaDeEdificios\s*=/.test(codigo));

    // Lo que no puede volver: un objeto con nombres de tabla escritos a mano.
    vale('no volvió la lista de tablas escrita a mano',
        !/\b(USOS|LISTAS)\s*=/.test(codigo),
        'Si vuelve, la próxima tabla que nazca queda afuera y el informe va a decir que está todo bien.');

    vale('y ninguna tabla aparece escrita a mano como clave de un mapa',
        !/reservas_amenities\s*:/.test(codigo) && !/proveedor_asignaciones\s*:/.test(codigo),
        'Nombrar tablas en el código es exactamente lo que dejó afuera a pases_qr y eventos_acceso.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) Las dos bases se recorren enteras');
// ─────────────────────────────────────────────────────────────────────────────
{
    vale('PostgreSQL se enumera desde information_schema',
        /information_schema\.columns/.test(codigo),
        'Preguntarle a la base es lo único que no envejece.');

    // Del lado de Sheets, la decisión tiene que salir de los encabezados de cada pestaña.
    vale('en Sheets se miran los encabezados de cada pestaña',
        /headerValues/.test(codigo) && /filter\(esColumnaDeEdificio\)/.test(codigo),
        'Si se filtrara por nombre de pestaña, una pestaña nueva quedaría afuera igual que antes.');

    // Y la tabla que manda no puede contarse como un uso de sí misma.
    const excluyeEdificios = (codigo.match(/norm\((?:titulo|tabla)\)\s*===\s*'edificios'/g) || []).length;
    vale('la tabla EDIFICIOS se excluye en los dos lados', excluyeEdificios >= 2,
        `Encontradas ${excluyeEdificios} exclusiones; hacen falta 2 (Sheets y PostgreSQL). ` +
        'Sin esto, cada edificio se reportaría como huérfano de sí mismo.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) La regla, probada como la usa el programa');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Se reconstruye la misma normalización del archivo, para comprobar que la regla decide bien
    // sobre los nombres de columna reales del proyecto.
    const norm = (t) => String(t || '')
        .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
        .toLowerCase().trim().replace(/\s+/g, ' ');
    const esCol = (c) => norm(c) === 'edificio';
    const esLista = (c) => norm(c) === 'edificios';

    // Las tres que el informe se perdía, y las que ya cubría.
    for (const col of ['edificio', 'Edificio', ' EDIFICIO ']) {
        vale(`"${col}" se reconoce como columna de edificio`, esCol(col));
    }
    vale('"edificios" (plural) es la lista del cliente, no una columna suelta',
        esLista('edificios') && !esCol('edificios'));

    // Y lo que NO tiene que arrastrar: columnas que hablan de otra cosa.
    for (const col of ['edificio_id', 'nombre', 'direccion', 'edificio_amenities', 'tel_edificio']) {
        vale(`"${col}" NO se confunde con el nombre del edificio`, !esCol(col) && !esLista(col));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) Sigue siendo una herramienta que SOLO LEE');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Recorre las dos bases enteras: si un día escribiera algo, lo haría en todos lados a la vez.
    vale('no escribe en PostgreSQL',
        !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(codigo));
    // Ojo con el patrón: `\.set\(` a secas atrapa `Map.set`, que es lo que esta herramienta usa
    // para juntar los edificios. Un candado que se dispara sobre código correcto es la forma más
    // rápida de que se lo deje de mirar — el mismo problema que el verificador con la `ñ`.
    // Se buscan las escrituras de verdad de google-spreadsheet, no cualquier `.set`.
    vale('no escribe en Sheets',
        !/\.save\s*\(|addRow\s*\(|addSheet\s*\(|setHeaderRow|spreadsheets\.values\.(append|update)/.test(codigo));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Un informe incompleto da por cerrado lo que sigue abierto.\n');
    process.exit(1);
}
console.log('\n   🏢 Se revisa lo que hay, no lo que alguien anotó.\n');
