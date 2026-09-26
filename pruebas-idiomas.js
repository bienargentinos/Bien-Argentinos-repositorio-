// Los textos del portal en los cuatro idiomas.
//
//   node pruebas-idiomas.js
//
// POR QUÉ EXISTE. Una traducción a medias no da error: la clave que falta simplemente no aparece,
// y el hueco lo ve justamente el que no puede leer el resto de la pantalla para deducir qué decía.
// Un huésped que abre el portal para que le abran la puerta y encuentra un botón en blanco no
// tiene a quién preguntarle.
//
// Por eso acá no se prueba "que traduzca bien" --eso lo lee una persona-- sino que **ningún idioma
// tenga menos claves que el castellano**, que los huecos `{nombre}` sobrevivan a la traducción, y
// que lo que venga de afuera (`pt-BR`, `EN_us`, vacío) no rompa nada.

const { IDIOMAS, IDIOMA_POR_DEFECTO, TEXTOS, textos, normalizarIdioma, idiomaDelNavegador } = require('./idiomas');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}
const afirmar = (titulo, cond) => verificar(titulo, !!cond, true);

console.log('\n── NINGÚN IDIOMA PUEDE TENER MENOS CLAVES QUE EL CASTELLANO ──');
{
    const base = Object.keys(TEXTOS[IDIOMA_POR_DEFECTO]).sort();
    for (const { codigo, nombre } of IDIOMAS) {
        const suyas = Object.keys(TEXTOS[codigo]).sort();
        const faltan = base.filter(k => !suyas.includes(k));
        const sobran = suyas.filter(k => !base.includes(k));
        verificar(`${nombre} tiene las ${base.length}`, faltan, []);
        // Una clave que sobra es casi siempre un typo: se tradujo `perfil.titulo` como
        // `perfil.titolo` y la buena quedó sin traducir, en castellano, sin que nada avise.
        verificar(`${nombre} no tiene ninguna de más`, sobran, []);
    }
}

console.log('\n── NINGÚN TEXTO PUEDE QUEDAR VACÍO ──');
{
    const vacios = [];
    for (const { codigo } of IDIOMAS) {
        for (const [clave, valor] of Object.entries(TEXTOS[codigo])) {
            if (!String(valor || '').trim()) vacios.push(`${codigo}:${clave}`);
        }
    }
    verificar('no hay textos en blanco', vacios, []);
}

console.log('\n── LOS HUECOS SOBREVIVEN A LA TRADUCCIÓN ──');
{
    // El orden de las palabras cambia entre idiomas, así que `{nombre}` viaja adentro del texto.
    // Si una traducción se lo come, el vecino ve "Hola, " y nada más.
    const conHueco = Object.entries(TEXTOS[IDIOMA_POR_DEFECTO])
        .filter(([, v]) => /\{\w+\}/.test(v));
    afirmar('hay claves con hueco para probar', conHueco.length > 0);
    const rotas = [];
    for (const [clave, textoEs] of conHueco) {
        const huecos = (textoEs.match(/\{\w+\}/g) || []).sort();
        for (const { codigo } of IDIOMAS) {
            const suyos = (String(TEXTOS[codigo][clave] || '').match(/\{\w+\}/g) || []).sort();
            if (JSON.stringify(huecos) !== JSON.stringify(suyos)) rotas.push(`${codigo}:${clave}`);
        }
    }
    verificar('todas las traducciones conservan sus huecos', rotas, []);

    const t = textos('pt');
    verificar('y se reemplazan de verdad', t('topbar.hola', { nombre: 'Camila' }), 'Olá, Camila');
}

console.log('\n── LO QUE VIENE DE AFUERA NO ROMPE ──');
{
    verificar('pt-BR es portugués', normalizarIdioma('pt-BR'), 'pt');
    verificar('EN_us es inglés', normalizarIdioma('EN_us'), 'en');
    verificar('un idioma que no hablamos cae al castellano', normalizarIdioma('klingon'), 'es');
    verificar('vacío también', normalizarIdioma(''), 'es');
    verificar('null también', normalizarIdioma(null), 'es');

    // El navegador manda la lista ordenada por preferencia: se toma el primero que sepamos.
    verificar('del navegador, el primero que hablamos',
        idiomaDelNavegador('de-DE,de;q=0.9,pt-BR;q=0.8,en;q=0.7'), 'pt');
    verificar('si no hablamos ninguno, castellano',
        idiomaDelNavegador('de-DE,ja;q=0.9'), 'es');
    verificar('sin cabecera, castellano', idiomaDelNavegador(undefined), 'es');
}

console.log('\n── UNA CLAVE QUE FALTA NUNCA RENDERIZA VACÍO ──');
{
    const t = textos('en');
    verificar('una clave inventada devuelve la clave, no el vacío', t('no.existe.esta'), 'no.existe.esta');
    afirmar('y nunca una cadena vacía', t('no.existe.esta') !== '');
}

console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
