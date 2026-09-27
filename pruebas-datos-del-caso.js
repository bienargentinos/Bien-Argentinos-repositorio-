/**
 * LOS DATOS DEL CASO VIEJO NO SIRVEN PARA EL CASO NUEVO
 *
 * Producción, 26/09, del WhatsApp del técnico. En esa línea conviven **julio (plomero)** y
 * **dario (electricista)**:
 *
 *     23:08  plantilla:  "Hola julio, aguardamos tu confirmación para el [CASO-1005]"
 *     23:56  Marcos:     "Dario, Daniel Valdés en SAN PATRICIO 159 adjuntó esto del inconveniente."
 *
 * Dos nombres para la misma persona en el mismo hilo. La plantilla la manda el barrido y usa el
 * `tecnico` DEL CASO; los mensajes libres usan el estado de la línea, que seguía describiendo el
 * CASO-1004 --de electricidad, a nombre de Dario-- porque todas sus asignaciones son `if (!…)`.
 *
 *     node pruebas-datos-del-caso.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { refrescarDatosDelCaso } = require('./datos-del-caso');

let ok = 0, fallos = 0;
function vale(titulo, condicion, detalle) {
    if (condicion) { ok++; console.log(`   ✅ ${titulo}`); }
    else { fallos++; console.log(`   ❌ ${titulo}`); if (detalle) console.log(`      ${detalle}`); }
}

// Los dos casos reales de esa noche.
const CASOS = {
    'CASO-1004': {
        id_evento: 'CASO-1004', edificio: 'San patricio 159', rubro: 'electricidad',
        tecnico: 'Dario', telefono: '5491133334444', vecino: 'Daniel Valdés',
    },
    'CASO-1005': {
        id_evento: 'CASO-1005', edificio: 'San patricio 159', rubro: 'plomería',
        tecnico: 'julio', telefono: '5491155556666', vecino: 'Daniel Valdés',
    },
};
const base = async (cod) => CASOS[cod] || null;

async function correr() {

console.log('\n🔄 LOS DATOS DEL CASO VIEJO NO SIRVEN PARA EL CASO NUEVO\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('1) La noche del 26/09, tal cual pasó');
// ─────────────────────────────────────────────────────────────────────────────
{
    // El estado como lo dejó `marcos-ops.js` al mandar la plantilla del CASO-1005: cambió el id
    // del caso y NO tocó ni el rubro ni el nombre.
    const stProv = {
        eventoActivoId: 'CASO-1005',
        datosDeCaso:    'CASO-1004',
        rubroActivo:    'electricidad',
        tecnicoDelCaso: 'Dario',
        edificioActivo: 'San patricio 159',
        vecinoActivo:   { telefono: '5491133334444', nombre: 'Daniel Valdés', edificio: 'San patricio 159' },
    };

    const r = await refrescarDatosDelCaso(stProv, base);

    vale('se da cuenta de que el caso cambió', r.refrescado === true, r.motivo);
    vale('el nombre pasa a ser el del CASO-1005', stProv.tecnicoDelCaso === 'julio',
        `Quedó: ${stProv.tecnicoDelCaso}. Es el nombre con el que salió la plantilla.`);
    vale('y el rubro también', stProv.rubroActivo === 'plomería',
        `Quedó: ${stProv.rubroActivo}. Con "electricidad" se elegía al técnico equivocado de la línea.`);
    vale('el vecino es el del caso nuevo', stProv.vecinoActivo?.telefono === '5491155556666');
    vale('queda marcado de qué caso salieron', stProv.datosDeCaso === 'CASO-1005');
    vale('el log dice de dónde a dónde, y con qué valores',
        /CASO-1004/.test(r.motivo) && /CASO-1005/.test(r.motivo) && /Dario/.test(r.motivo) && /julio/.test(r.motivo),
        r.motivo);

    // Y no se repite: la segunda vuelta no vuelve a consultar la base.
    let consultas = 0;
    const contando = async (c) => { consultas++; return base(c); };
    const r2 = await refrescarDatosDelCaso(stProv, contando);
    vale('en el mensaje siguiente ya no relee nada', r2.refrescado === false && consultas === 0, r2.motivo);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2) La marca ausente también dispara la relectura');
// ─────────────────────────────────────────────────────────────────────────────
{
    // > [!CAUTION]
    // > **Es justo el estado en que `marcos-ops.js` deja la línea la PRIMERA vez.** Sin esto, la
    // > única línea que nace desfasada no se corrige nunca.
    const stProv = {
        eventoActivoId: 'CASO-1005',
        rubroActivo:    'electricidad',
        tecnicoDelCaso: 'Dario',
    };
    const r = await refrescarDatosDelCaso(stProv, base);
    vale('sin `datosDeCaso` se relee igual', r.refrescado === true && stProv.tecnicoDelCaso === 'julio', r.motivo);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3) Lo que NO tiene que hacer');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Sin caso activo no hay nada que refrescar, y no se inventa uno.
    const vacio = { rubroActivo: 'electricidad', tecnicoDelCaso: 'Dario' };
    const r0 = await refrescarDatosDelCaso(vacio, base);
    vale('sin caso activo no toca nada',
        r0.refrescado === false && vacio.tecnicoDelCaso === 'Dario' && /no hay caso activo/.test(r0.motivo));

    // > [!CAUTION]
    // > **Si el caso no se puede leer NO se borra nada.** Quedarse con datos viejos es malo;
    // > quedarse sin ninguno deja a Marcos sin saber de qué habla, y ese es el error caro.
    const stProv = {
        eventoActivoId: 'CASO-1005', datosDeCaso: 'CASO-1004',
        rubroActivo: 'electricidad', tecnicoDelCaso: 'Dario',
        edificioActivo: 'San patricio 159',
    };
    const rota = async () => { throw new Error('PG caído'); };
    const r1 = await refrescarDatosDelCaso(stProv, rota);
    vale('con la base caída no borra lo que había',
        r1.refrescado === false && stProv.tecnicoDelCaso === 'Dario' && stProv.rubroActivo === 'electricidad',
        r1.motivo);
    vale('y lo dice', /no se pudo leer/.test(r1.motivo), r1.motivo);
    vale('la marca NO se mueve: sigue pendiente de refrescar', stProv.datosDeCaso === 'CASO-1004',
        'Si se moviera, el desfasaje quedaría congelado para siempre.');

    const r2 = await refrescarDatosDelCaso(stProv, async () => null);
    vale('un caso que no existe tampoco borra nada',
        r2.refrescado === false && stProv.tecnicoDelCaso === 'Dario' && /no se encontró/.test(r2.motivo));

    // El edificio es lo único que no se vacía: sin él no se le puede decir al técnico adónde va.
    const stSinEdif = {
        eventoActivoId: 'CASO-9', datosDeCaso: 'CASO-1004',
        edificioActivo: 'San patricio 159', tecnicoDelCaso: 'Dario',
    };
    await refrescarDatosDelCaso(stSinEdif, async () => ({ id_evento: 'CASO-9', tecnico: 'julio' }));
    vale('un caso sin edificio no borra el que había', stSinEdif.edificioActivo === 'San patricio 159');
    vale('pero el nombre y el rubro sí se pisan con lo que diga el caso',
        stSinEdif.tecnicoDelCaso === 'julio' && stSinEdif.rubroActivo === '',
        'Dejar el rubro viejo es lo que elegía al técnico equivocado de la línea compartida.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4) index.js y marcos-ops.js: dónde nace y dónde se corrige');
// ─────────────────────────────────────────────────────────────────────────────
{
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const soloCod = cod.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    vale('index.js llama al módulo y no rehace la regla', /refrescarDatosDelCaso\(stProv/.test(soloCod),
        'Escribirla acá sería la segunda copia, como pasó con `buscarPerfilEdificio`.');

    // El candado central: se mide la PROPIEDAD --que la relectura corra ANTES de que se decida cuál
    // de los técnicos de la línea escribe-- y no la forma. Ese desempate lee `tecnicoDelCaso` y
    // `rubroActivo`: hacerlo con los del caso viejo es exactamente el bug.
    const iRefresco = soloCod.indexOf('refrescarDatosDelCaso(stProv');
    const iDesempate = soloCod.indexOf('const yaAnotado = String(stProv.tecnicoDelCaso');
    vale('y corre ANTES de elegir cuál de los técnicos de la línea escribe',
        iRefresco !== -1 && iDesempate !== -1 && iRefresco < iDesempate,
        `refresco en ${iRefresco}, desempate en ${iDesempate}. Al revés, el desempate usa el caso viejo.`);

    // Donde el técnico avisa él mismo, el nombre es el de quien escribe y eso es deliberado: se
    // marca para que la relectura no lo pise.
    vale('el aviso del propio técnico marca sus datos como de ese caso',
        /colaAviso\.datosDeCaso = idAviso/.test(soloCod),
        'Sin la marca, la relectura del próximo mensaje pisa una elección hecha a propósito.');

    // Y el origen del desfasaje, para que quede dicho: marcos-ops cambia el caso y no el resto.
    const ops = fs.readFileSync(path.join(__dirname, 'agentes', 'marcos-ops.js'), 'utf8');
    vale('marcos-ops sigue cambiando el caso sin tocar rubro ni nombre (por eso hace falta esto)',
        /estadoProv\.eventoActivoId = id_evento/.test(ops) && !/estadoProv\.tecnicoDelCaso/.test(ops),
        'Si algún día lo setea ahí, esta prueba avisa y el módulo se puede simplificar.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5) El número de caso va en TODO mensaje al proveedor');
// ─────────────────────────────────────────────────────────────────────────────
{
    // Producción, 26/09 22:50: el técnico apretó "Solicitar más datos" y le llegó la foto con el
    // encabezado `FOTO DEL RECLAMO` pelado. A las 23:56 la MISMA foto llegó con `[CASO-1005]`, por
    // el otro camino. El número es lo único con que después puede decir de qué obra es una factura.
    //
    // > [!CAUTION]
    // > **Este candado se escribió midiendo la forma y falló contra código correcto.** Pedía el
    // > número dentro del MISMO literal y el encabezado estaba partido en dos pedazos concatenados:
    // > el número estaba, en el de al lado. Es el error que ya frenó un refactor bueno en
    // > `pruebas-caso-del-tecnico.js`. Ahora mira una ventana alrededor del encabezado, que es donde
    // > la etiqueta puede estar escrita de cualquier forma razonable.
    // Lo que se mide es qué hay PEGADO al encabezado, no cómo se llama la variable: hoy son
    // `marcaCasoFoto`, `etiquetaCaso` e `idEvento`, y mañana va a ser otra. Escribir la lista de
    // nombres ya dio dos falsos positivos seguidos contra código correcto.
    const cod = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    const encabezados = [];
    const re = /MARCOS — [^\n]*?DEL RECLAMO/g;
    let m;
    while ((m = re.exec(cod)) !== null) {
        encabezados.push({ texto: m[0], pegado: cod.slice(m.index + m[0].length, m.index + m[0].length + 60) });
    }
    vale('hay encabezados de "DEL RECLAMO" para revisar', encabezados.length >= 2,
        `Encontrados: ${encabezados.length}`);

    const sinCaso = encabezados.filter(e => !/\$\{[^}]*(?:caso|evento)/i.test(e.pegado));
    vale('ninguno sale sin el número de caso pegado al encabezado', sinCaso.length === 0,
        sinCaso.map(e => `${e.texto} →${e.pegado.split('\n')[0]}`).join('\n      '));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`   ${ok} bien, ${fallos} mal`);
if (fallos) {
    console.log('\n   ⚠️  Dos nombres para la misma persona en el mismo hilo es Marcos diciéndole al técnico que no sabe con quién habla.\n');
    process.exit(1);
}
console.log('\n   🔄 El caso cambia y los datos lo siguen.\n');

}

correr().catch(err => { console.error(`\n❌ La prueba se rompió: ${err.stack}\n`); process.exit(1); });
