// Quién puede avisarle algo al edificio, y qué dice la pantalla cuando no hay nada.
//
//   node pruebas-avisos.js
//
// POR QUÉ. Hay DOS caminos para publicar un aviso --el panel y un WhatsApp a Marcos-- y mañana va
// a haber más. Un control escrito en cada camino se olvida en el tercero, así que la regla de quién
// puede publicar vive en la BASE (un CHECK) y en `publicarAviso`, no en la pantalla.
//
// Decisión de Daniel, 23/09: un aviso del edificio lo publica quien está detrás de escena --el
// administrador, el encargado, el consejo, un proveedor, seguridad--. NO un propietario, un
// inquilino ni un huésped. Un vecino anunciándole al edificio que el ascensor está suspendido es
// exactamente lo que esto impide.

const fs = require('fs');
const path = require('path');

let fallos = 0;
function verificar(titulo, real, esperado) {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    if (!ok) fallos++;
    console.log(`  ${ok ? '✅' : '❌'} ${titulo}`);
    if (!ok) console.log(`     esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`);
}
const afirmar = (titulo, cond) => verificar(titulo, !!cond, true);

const DB = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');
const PORTAL = fs.readFileSync(path.join(__dirname, 'portal-vecino.js'), 'utf8');

console.log('\n── UN VECINO NO PUEDE AVISARLE AL EDIFICIO ──');
{
    const { publicarAviso, ROLES_QUE_AVISAN } = require('./db-pg');

    // Los rechazos ni tocan la base: salen antes de la consulta, así que esto corre sin PostgreSQL.
    const rechaza = async (rol) => {
        try { await publicarAviso({ edificio: 'San Patricio 159', texto: 'x', rol }); return null; }
        catch (e) { return e.message; }
    };
    (async () => {
        for (const rol of ['propietario', 'inquilino', 'turista', 'asistente', 'vecino', '']) {
            const msg = await rechaza(rol);
            afirmar(`un "${rol || '(vacío)'}" no puede publicar`, msg && msg.includes('no puede publicar'));
        }

        console.log('\n── Y LOS QUE SÍ PUEDEN SON LOS DE ATRÁS DE ESCENA ──');
        verificar('la lista es la acordada', [...ROLES_QUE_AVISAN].sort(),
            ['administrador', 'consejo', 'encargado', 'proveedor', 'seguridad']);

        console.log('\n── LA REGLA ESTÁ EN LA BASE, NO SOLO EN JAVASCRIPT ──');
        {
            // Un `if` se esquiva escribiendo un INSERT a mano desde otro archivo. El CHECK no.
            const m = DB.match(/avisos_rol_chk CHECK \(\s*publicado_rol IN \(([^)]+)\)/);
            afirmar('existe el CHECK de rol en la tabla', !!m);
            if (m) {
                const enLaBase = m[1].split(',').map(x => x.trim().replace(/'/g, '')).sort();
                // Si el CHECK y la constante se separan, un rol pasaría el control de JavaScript y
                // lo rechazaría la base --o al revés-- y nadie entendería por qué.
                verificar('el CHECK dice lo mismo que ROLES_QUE_AVISAN', enLaBase, [...ROLES_QUE_AVISAN].sort());
            }
        }

        console.log('\n── SIN NOVEDADES, LA PANTALLA NO AFIRMA NADA ──');
        {
            // Antes decía "En servicio normal" siempre, para los tres servicios, en todos los
            // edificios. Que no haya un reclamo abierto no prueba que el ascensor ande, y el que
            // sube y lo encuentra parado no vuelve a mirar esta sección nunca más.
            afirmar('ya no existe el badge "Operativo" fijo', !PORTAL.includes('servicio-badge-operativo'));
            // Se miran los comentarios aparte: el que explica POR QUÉ se sacó la sección
            // nombra la frase vieja, y eso no es la frase saliendo a la pantalla.
            const sinComentarios = PORTAL
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            afirmar('ni el estado "En servicio normal" escrito a mano',
                !/En servicio normal|Presión estándar|Apertura automática/.test(sinComentarios));
            afirmar('el bloque solo se arma si hay algo', PORTAL.includes("avisos.length === 0 ? '' : bloqueAvisosHtml"));
        }

        console.log('\n── UN RECLAMO NO ES "FUERA DE SERVICIO" ──');
        {
            // Alguien reportando un ruido raro no es el ascensor parado. La pantalla dice lo que
            // sabe --que hay algo reportado y abierto-- y no el diagnóstico, que lo tiene el técnico.
            afirmar('el reclamo se muestra como "abierto", no como roto',
                PORTAL.includes("t('avisos.reclamoAbierto')"));
            const { textos } = require('./idiomas');
            for (const i of ['es', 'en', 'pt', 'fr']) {
                const txt = textos(i)('avisos.reclamoAbierto').toLowerCase();
                afirmar(`en ${i} no afirma que no funciona`,
                    !/fuera de servicio|out of service|no funciona|not working|hors service/.test(txt));
            }
        }

        console.log('\n── UN AVISO VENCIDO NO SE MUESTRA ──');
        {
            // El que avisa "el agua se corta hasta las 14" no vuelve a las 14 a apagarlo. Un corte
            // de ayer en la pantalla de hoy es tan falso como inventarlo.
            const m = DB.match(/async function avisosVigentesDeEdificio[\s\S]*?\n}/);
            afirmar('existe avisosVigentesDeEdificio', !!m);
            if (m) {
                afirmar('filtra por estado vigente', m[0].includes("estado = 'vigente'"));
                afirmar('y descarta los que ya vencieron', /hasta IS NULL OR hasta >= NOW\(\)/.test(m[0]));
            }
        }

        console.log(`\n${fallos === 0 ? '✅ Todo bien' : `❌ ${fallos} fallo(s)`}\n`);
        process.exit(fallos === 0 ? 0 : 1);
    })();
}
