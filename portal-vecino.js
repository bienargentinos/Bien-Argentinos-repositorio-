/**
 * portal-vecino.js — Portal Web del Vecino (Marcos IA)
 * -------------------------------------------------------------------
 * Web App responsiva y PWA para que los vecinos accedan desde el celular
 * (Instagram bio, enlace web o QR) con la identidad visual oficial de Marcos IA.
 * -------------------------------------------------------------------
 */

'use strict';

const express = require('express');
const router = express.Router();
const session = require('express-session');
// El secreto era, literalmente, la palabra 'secret'. Con eso se falsifica una sesión de vecino
// — y una sesión de vecino es lo que `apertura-remota.js` autoriza para abrir la puerta de calle.
//
// LA SESIÓN VIVÍA EN LA RAM DEL PROCESO, así que cada `pm2 restart` deslogueaba a todos los
// vecinos. `session()` sin `store` usa el `MemoryStore` de express-session, y el síntoma no se
// parece a la causa: el navegador sigue mandando una cookie que cree válida, la página se ve
// normal, y el error aparece recién al apretar un botón. En el panel salió como
// `JSON.parse: unexpected character at line 1 column 1` y mandó a buscar el problema al código
// recién escrito — media hora de diagnóstico.
//
// El store va en PostgreSQL, igual que el del panel, pero en su propia tabla: el portal y el panel
// son dos públicos distintos y un pruneo no tiene por qué tocar al otro. `createTableIfMissing` la
// crea con el rol que conecta (`marcos`), que es lo que hace falta: una tabla creada desde `psql`
// como `postgres` no la puede escribir Marcos, y desde el código parece un bug
// (`node revisar-permisos-pg.js` lo dice).
//
// Si PostgreSQL no está, se sigue con el MemoryStore a propósito: un portal que no arranca es peor
// que uno que desloguea en cada despliegue. Pero queda dicho en el log, porque si no nadie se
// entera de que volvió el problema.
let storePortal = null;
try {
    const { pool } = require('./db-pg');
    if (pool) {
        const PgSession = require('connect-pg-simple')(session);
        storePortal = new PgSession({
            pool,
            tableName: 'sesiones_portal',
            createTableIfMissing: true,
            pruneSessionInterval: 60 * 15,
        });
    }
} catch (errStore) {
    console.warn('⚠️ No se pudo inicializar store de sesiones del PORTAL en PostgreSQL, usando MemoryStore: las sesiones de los vecinos se pierden en cada reinicio:', errStore.message);
}

router.use(session({
    store: storePortal || undefined,
    name: 'portal.sid',
    secret: require('./credenciales').secretoDeSesion(),
    resave: false,
    // Estaba en `true`, o sea que creaba una sesión por cada visita anónima --incluida la de
    // cualquier robot-- y el MemoryStore iba creciendo con gente que nunca se logueó. Con un store
    // de verdad eso serían filas en la base.
    saveUninitialized: false,
    cookie: {
        // Una sesión de vecino abre la puerta de calle: que el JavaScript de la página no pueda
        // leer la cookie es lo mínimo.
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30,
    },
}));
// Los formularios del login (`/vecino/auth`) mandan `application/x-www-form-urlencoded`, y de eso
// no se encargaba NADIE: `index.js` monta `bodyParser.json()` solamente. Así que `req.body` llegaba
// vacío y el `identificador` del formulario nunca se leía — sin un solo error en el log, porque
// `const { identificador } = req.body || {}` sobre un cuerpo vacío simplemente da `undefined`.
// Con el botón de huésped eso era peor: el `rol` se perdía y el demo del turista entraba como
// propietario.
router.use(express.urlencoded({ extended: true }));
// Y el JSON lo parsea hoy `index.js` para toda la app. Se monta igual acá para que el portal no
// dependa de quién lo monte: body-parser marca el pedido como ya parseado, así que el segundo no
// vuelve a leerlo ni pisa nada.
router.use(express.json());

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { sesionDemoVecino } = require('./sesion-demo');
const { IDIOMAS, textos, normalizarIdioma, idiomaDelNavegador } = require('./idiomas');

// Almacenamiento seguro de comprobantes de pago subidos por vecinos
const storageComprobantes = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'almacenamiento', 'facturas');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = 'comprobante_' + Date.now() + ext;
    cb(null, name);
  }
});
const uploadComprobante = multer({
  storage: storageComprobantes,
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Intentar cargar adaptadores de datos
let datosPg = null;
try {
  datosPg = require('./datos-pg');
} catch (_) {}

let datosModule = null;
try {
  datosModule = require('./datos');
} catch (_) {}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escJs(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// Estilos visuales oficiales de Marcos IA (Tokens exactos)
// LOS COLORES DEL PORTAL, EN UN SOLO LUGAR
//
// Antes había **109 colores distintos** escritos a mano en 825 atributos `style=`. Ninguno estaba
// mal elegido; eran demasiados, y por eso la pantalla se veía gritona sin que se pudiera señalar
// qué corregir.
//
// Y el modo oscuro funcionaba buscando el texto del color adentro del atributo:
//
//     .dark-theme [style*="color:#64748B"],
//     .dark-theme [style*="color: #64748B"],   <- el mismo, repetido por un espacio
//
// Eran 137 reglas así. Un color nuevo, o un espacio de más, y el elemento quedaba ilegible en
// oscuro sin que nada avisara.
//
// Ahora el estilo dice `color:var(--texto-suave)` y el navegador resuelve el valor según el tema.
// El modo oscuro no necesita ni una de esas reglas, y cambiar el acento de toda la app es tocar
// una línea de acá abajo.
const CSS_TOKENS = `
:root{
  /* Marca */
  --marca:#0F326A;
  --acento:#1E5FB4;
  --acento-tenue:#EFF6FF;
  --acento-borde:#BFDBFE;
  --dorado:#D99B1F;

  /* Superficies */
  --fondo:#F1F5F9;
  --superficie:#FFFFFF;
  --superficie-2:#F8FAFD;
  --superficie-3:#F1F5F9;
  --borde:#E2E8F0;
  --borde-fuerte:#CBD5E1;

  /* Texto: cuatro pesos, no catorce grises */
  --texto:#0F172A;
  --texto-medio:#475569;
  --texto-suave:#64748B;
  --texto-tenue:#94A3B8;
  --sobre-acento:#FFFFFF;

  /* Estados. Son los unicos colores que ademas del azul tienen permiso de aparecer,
     y solo cuando significan algo: esto salio bien, mira esto, esto fallo. */
  --ok:#15803D;      --ok-fondo:#DCFCE7;     --ok-borde:#86EFAC;
  --aviso:#92400E;   --aviso-fondo:#FEF3C7;  --aviso-borde:#FDE68A;
  --error:#DC2626;   --error-fondo:#FEE2E2;  --error-borde:#FCA5A5;
  --info:#3730A3;    --info-fondo:#E0E7FF;   --info-borde:#C7D2FE;

  /* La luz de fondo. En claro NO existe: sobre papel blanco un resplandor ensucia.
     La jerarquia en claro se hace con espacio y peso tipografico, no con luz. */
  --luz:transparent;
  --sombra:0 2px 8px rgba(15,23,42,.04);
  --sombra-alta:0 4px 18px rgba(15,23,42,.06);
}

.dark-theme{
  --marca:#0F326A;
  --acento:#3B82F6;
  --acento-tenue:#132444;
  --acento-borde:#24467F;
  --dorado:#E8B33E;

  --fondo:#070D1E;
  --superficie:#111C33;
  --superficie-2:#0D1628;
  --superficie-3:#182647;
  --borde:#23355C;
  --borde-fuerte:#2A3E6D;

  --texto:#F8FAFC;
  --texto-medio:#CBD5E1;
  --texto-suave:#94A3B8;
  --texto-tenue:#6E7C96;
  --sobre-acento:#FFFFFF;

  --ok:#4ADE80;      --ok-fondo:#0F2A1B;     --ok-borde:#1E5235;
  --aviso:#FBBF24;   --aviso-fondo:#2B2110;  --aviso-borde:#54401A;
  --error:#F87171;   --error-fondo:#2B1417;  --error-borde:#5C2528;
  --info:#A5B4FC;    --info-fondo:#1A1F3D;   --info-borde:#2E3563;

  /* Aca si: sobre fondo oscuro un resplandor tenue da profundidad sin ensuciar. */
  --luz:radial-gradient(120% 70% at 50% -10%, rgba(59,130,246,.18) 0%, transparent 70%);
  --sombra:0 2px 10px rgba(0,0,0,.35);
  --sombra-alta:0 8px 28px rgba(0,0,0,.45);
}
`;

// Los campos y botones de formulario. Vivían SOLO adentro del `<style>` de la pantalla de login,
// que es HTML suelto y no pasa por `shellVecino`: cualquier página del portal que usara `class="inp"`
// o `class="btn-primary"` salía sin estilo y nadie se enteraba, porque una clase que no existe no
// da error — simplemente no hace nada.
const CSS_FORMULARIOS = `
.inp{width:100%;height:46px;border:1.5px solid var(--borde);border-radius:12px;padding:0 14px;font-size:14.5px;color:var(--texto);background:var(--superficie-2);outline:none;margin-bottom:12px;font-family:inherit}
.inp:focus{border-color:var(--acento);background:#fff;box-shadow:0 0 0 4px rgba(46,111,192,.12)}
.inp:disabled{background:var(--superficie-3);color:var(--texto-suave);cursor:not-allowed}
.btn-primary{width:100%;height:48px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;font-size:15px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 14px rgba(15,50,106,.3);font-family:inherit}
.btn-primary:disabled{opacity:.6;cursor:progress}
.btn-secondary{width:100%;height:44px;border:1.5px solid var(--borde);border-radius:12px;background:var(--superficie-2);color:var(--texto-medio);font-size:13.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit}
.btn-secondary:disabled{opacity:.6;cursor:progress}
`;

const CSS_VECINO = `
${CSS_TOKENS}
${CSS_FORMULARIOS}
.dark-theme .inp{background:#111C33;border-color:#23355C;color:#F8FAFC}
.dark-theme .inp:disabled{background:#0B1426;color:#94A3B8}
.dark-theme .btn-secondary{background:#111C33;border-color:#23355C;color:#CBD5E1}
*{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;padding:0;width:100%;min-height:100vh;background:var(--superficie-3);color:var(--texto);font-family:'Hanken Grotesk',system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;overscroll-behavior-y:contain;-webkit-tap-highlight-color:transparent}
a{color:inherit;text-decoration:none}
button,input,textarea{font-family:inherit}

/* Animaciones */
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes typingDot{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}
@keyframes pulseRing{0%{transform:scale(0.95);box-shadow:0 0 0 0 rgba(56,189,248,0.7)}70%{transform:scale(1.05);box-shadow:0 0 0 25px rgba(56,189,248,0)}100%{transform:scale(0.95);box-shadow:0 0 0 0 rgba(56,189,248,0)}}

.anim-fade{animation:fadeIn .2s ease both}
.card{background:#ffffff;border:1px solid var(--borde);border-radius:18px;box-shadow:0 2px 8px rgba(15,23,42,.04)}
.card-touch:active{transform:scale(.98);transition:transform .08s ease}

/* Shell Contenedor de la App */
.app-shell{min-height:100vh;display:flex;flex-direction:column;width:100%;margin:0 auto;background:var(--superficie-3)}
main{width:100%;padding:14px 14px 80px;display:flex;flex-direction:column;gap:12px}

/* Barra de Navegacion Inferior para Celulares (Estilo App Nativa) */
.v-bottom-nav{
  position:fixed;bottom:0;left:0;right:0;width:100%;height:62px;background:#ffffff;
  border-top:1px solid var(--borde);display:flex;justify-content:space-around;align-items:center;
  z-index:50;box-shadow:0 -4px 16px rgba(15,23,42,.06);padding:0 2px;
  padding-bottom:env(safe-area-inset-bottom, 0px);
}
.v-bottom-nav a{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  flex:1;height:100%;color:var(--texto-suave);font-size:11.5px;font-weight:700;gap:3px;
  transition:all .12s ease;user-select:none;
}
.v-bottom-nav a.active{color:var(--marca);font-weight:900}
.v-bottom-nav a.active .nav-icon{transform:scale(1.1);color:var(--acento)}
.v-bottom-nav a .nav-icon{font-size:24px;line-height:1;transition:transform .12s ease}

/* Burbujas de Chat con Marcos IA */
.chat-bubble-marcos{
  background:#ffffff;border:1px solid var(--borde);border-radius:16px 16px 16px 4px;
  padding:12px 15px;max-width:86%;box-shadow:0 1px 2px rgba(16,35,59,.05);color:var(--texto);font-size:14.5px;line-height:1.45;
}
.chat-bubble-user{
  background:linear-gradient(135deg,#17408B,var(--acento));color:#ffffff;
  border-radius:16px 16px 4px 16px;padding:12px 15px;max-width:86%;
  margin-left:auto;font-size:14.5px;line-height:1.45;box-shadow:0 2px 8px rgba(23,64,139,.25);
}

.typing-indicator{
  display:inline-flex;gap:4px;padding:8px 12px;background:#fff;border:1px solid var(--borde);border-radius:12px;
}
.typing-dot{
  width:6px;height:6px;background:var(--acento);border-radius:50%;animation:typingDot 1.4s infinite ease-in-out both;
}
.typing-dot:nth-child(1){animation-delay:-0.32s}
.typing-dot:nth-child(2){animation-delay:-0.16s}

/* Soporte Horizontal (Landscape) */
@media (orientation: landscape) {
  .app-shell { width: 100% !important; max-width: 1000px !important; margin: 0 auto !important; }
  main { padding: 12px 20px 65px !important; }
  .v-bottom-nav { height: 50px !important; padding: 0 16px !important; }
  .v-bottom-nav a { font-size: 10px !important; gap: 2px !important; }
  .v-bottom-nav a .nav-icon { font-size: 18px !important; }
  #box-timbre-sonando, #box-llamada-voz-activa { max-width: 600px !important; }
}

/* Modo Instalado (PWA Standalone) */
@media (display-mode: standalone) {
  #card-instalar-pwa { display: none !important; }
}

/* Modo Oscuro - Corrección integral de alto contraste (Cero grises, letras blancas y amarillas) */
.dark-theme,
.dark-theme body {
  background: #070D1E !important;
  color: #FFFFFF !important;
}
.dark-theme .app-shell { background: #070D1E !important; }
.dark-theme .card {
  background: #0F1A30 !important;
  border-color: #1E2D4A !important;
  color: #FFFFFF !important;
  box-shadow: 0 4px 18px rgba(0,0,0,.4) !important;
}

/* Todos los elementos dentro de las tarjetas heredan blanco por defecto si no tienen estilo explícito */
.dark-theme .card span,
.dark-theme .card p,
.dark-theme .card strong,
.dark-theme .card div {
  color: #FFFFFF;
}

/* Títulos y textos oscuros inline se adaptan a blanco brillante */
.dark-theme [style*="color:var(--texto)"],
.dark-theme [style*="color:var(--texto)"],
.dark-theme [style*="color:var(--marca)"],
.dark-theme [style*="color:var(--texto)"],
.dark-theme [style*="color:#000"],
.dark-theme [style*="color: var(--texto)"],
.dark-theme [style*="color: var(--texto)"],
.dark-theme [style*="color: var(--marca)"],
.dark-theme [style*="color: var(--texto)"],
.dark-theme [style*="color:#000000"] {
  color: #FFFFFF !important;
}

/* Textos secundarios o descriptivos: BLANCO NÍTIDO en lugar de gris */
.dark-theme [style*="color:var(--texto-suave)"],
.dark-theme [style*="color:var(--texto-medio)"],
.dark-theme [style*="color:var(--texto-medio)"],
.dark-theme [style*="color:#334259"],
.dark-theme [style*="color:var(--texto-tenue)"],
.dark-theme [style*="color:var(--texto-tenue)"],
.dark-theme [style*="color: var(--texto-suave)"],
.dark-theme [style*="color: var(--texto-medio)"],
.dark-theme [style*="color: var(--texto-tenue)"],
.dark-theme [style*="color: var(--texto-tenue)"] {
  color: #FFFFFF !important; /* Blanco puro, nada de gris */
}

/* Subtítulos de sección, etiquetas uppercase y destacados: AMARILLO ORO BRILLANTE */
/* Acá vivía una regla que pintaba de dorado CUALQUIER texto en mayúsculas del portal:

       .dark-theme [style*="text-transform:uppercase"] { color: #FBBF24 !important; }

   Los rótulos de los campos (NOMBRE, TELÉFONO, EMAIL) son todos mayúsculas, así que en modo
   oscuro la pantalla entera se llenaba de amarillo. No estaba señalando nada: el dorado no
   significaba "mirá esto", significaba "esto está en mayúsculas".

   El color se reserva para lo que tiene sentido -- salió bien, mirá esto, falló. Un rótulo de
   campo usa var(--texto-medio), que ya se adapta solo a los dos temas.

   (Ojo: nada de acentos graves en este comentario. Todo el CSS viaja adentro de un template
   literal de JavaScript, asi que uno solo cierra la cadena y rompe el archivo entero. Ya paso
   igual en db-pg.js y esta contado en CLAUDE.md.) */
.dark-theme .sec-tag,
.dark-theme .servicios-titulo,
.dark-theme .tag-amarillo {
  color: var(--dorado) !important;
}

/* Estados verdes normales adaptados a Verde Lima luminoso */
.dark-theme [style*="color:var(--ok)"],
.dark-theme [style*="color:var(--ok)"],
.dark-theme [style*="color:#1B7A43"],
.dark-theme [style*="color: var(--ok)"],
.dark-theme [style*="color: var(--ok)"],
.dark-theme [style*="color: #1B7A43"] {
  color: #4ADE80 !important; /* Verde lima brillante */
  font-weight: 700 !important;
}
.dark-theme [style*="background:var(--ok-fondo)"],
.dark-theme [style*="background: var(--ok-fondo)"],
.dark-theme [style*="background:#E7F4EC"],
.dark-theme [style*="background: #E7F4EC"] {
  background: rgba(34, 197, 94, 0.2) !important;
  color: #4ADE80 !important;
  border: 1px solid rgba(74, 222, 128, 0.4) !important;
}

/* Fondos blancos/claros inline dentro de tarjetas se adaptan a oscuro */
.dark-theme [style*="background:#fff"],
.dark-theme [style*="background:#ffffff"],
.dark-theme [style*="background: #fff"],
.dark-theme [style*="background: #ffffff"],
.dark-theme [style*="background:var(--superficie-2)"],
.dark-theme [style*="background:#FAFCFF"],
.dark-theme [style*="background:var(--superficie-3)"],
.dark-theme [style*="background:var(--superficie-2)"],
.dark-theme [style*="background: var(--superficie-2)"],
.dark-theme [style*="background:#FFFBEB"],
.dark-theme [style*="background: #FFFBEB"],
.dark-theme [style*="background:var(--aviso-fondo)"],
.dark-theme [style*="background: var(--aviso-fondo)"],
.dark-theme [style*="background:var(--info-fondo)"],
.dark-theme [style*="background: var(--info-fondo)"],
.dark-theme [style*="background:var(--acento-tenue)"],
.dark-theme [style*="background: var(--acento-tenue)"] {
  background: #15223D !important;
  border-color: #24355A !important;
}

/* Separadores de lista o tablas */
.dark-theme [style*="border-bottom:1px solid var(--superficie-3)"],
.dark-theme [style*="border-bottom: 1px solid var(--superficie-3)"],
.dark-theme [style*="border-bottom:1px solid #EEF1F6"],
.dark-theme [style*="border-bottom:1px solid var(--borde)"] {
  border-bottom-color: #1E2D4A !important;
}

/* Bloque específico del Estado de Servicios del Edificio */
.dark-theme .card-servicios {
  background: #0F1A30 !important;
  border: 1px solid #1E2D4A !important;
}
.dark-theme .card-servicios .servicios-titulo {
  color: #FBBF24 !important; /* Amarillo oro */
}
.dark-theme .card-servicios .servicio-nombre {
  color: #FFFFFF !important; /* Blanco puro */
  font-weight: 800 !important;
}
.dark-theme .card-servicios .servicio-estado {
  color: #4ADE80 !important; /* Verde lima brillante */
  font-weight: 700 !important;
}
.dark-theme .card-servicios .servicio-item {
  border-bottom-color: #1E2D4A !important;
}

/* --- AMENITIES Y SELECTOR DE HORAS --- */
.amenity-card-item {
  border: 2px solid var(--borde);
  border-radius: 14px;
  padding: 12px 8px;
  cursor: pointer;
  background: #ffffff;
  text-align: center;
  transition: all .2s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  outline: none;
  box-shadow: 0 1px 3px rgba(15,23,42,.04);
}
.amenity-card-item:hover {
  transform: translateY(-2px);
  border-color: var(--borde-fuerte);
}
.amenity-card-item .amenity-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--texto);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.amenity-card-item .amenity-time {
  font-size: 11px;
  color: var(--texto-suave);
  margin-top: 2px;
}
.amenity-card-item.selected {
  border: 2px solid #F59E0B !important;
  background: linear-gradient(135deg, #FEF08A, #FDE047) !important;
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.35) !important;
  transform: translateY(-2px);
}
.amenity-card-item.selected .amenity-title {
  color: #78350F !important;
  font-weight: 900 !important;
}
.amenity-card-item.selected .amenity-time {
  color: var(--aviso) !important;
  font-weight: 700 !important;
}

/* Modo oscuro para tarjetas de Amenities */
.dark-theme .amenity-card-item {
  background: #15223D !important;
  border: 2px solid #24355A !important;
  box-shadow: 0 4px 12px rgba(0,0,0,.3);
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
.dark-theme .amenity-card-item .amenity-title {
  color: #FFFFFF !important;
}
.dark-theme .amenity-card-item .amenity-time {
  color: #FBBF24 !important; /* Horario en amarillo */
}
/* Al seleccionar o tocar en modo oscuro: Degrade con resplandor dorado / amarillo y borde resaltado */
.dark-theme .amenity-card-item.selected {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(217, 119, 6, 0.18)) !important;
  border: 2px solid #FBBF24 !important;
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.5), inset 0 0 10px rgba(251, 191, 36, 0.25) !important;
  transform: translateY(-2px);
}
.dark-theme .amenity-card-item.selected .amenity-title {
  color: #FFFFFF !important;
  font-weight: 900 !important;
}
.dark-theme .amenity-card-item.selected .amenity-time {
  color: #FDE047 !important;
  font-weight: 700 !important;
}

.amenity-badge-arancel {
  font-size: 10.5px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--acento-tenue);
  color: var(--acento);
  border: 1px solid var(--acento-borde);
  margin-top: 4px;
  display: inline-block;
}
.amenity-card-item.selected .amenity-badge-arancel {
  background: #78350F;
  color: #FEF08A;
  border: 1px solid #78350F;
}
.dark-theme .amenity-badge-arancel {
  background: rgba(30, 95, 180, 0.25);
  color: #93C5FD;
  border: 1px solid rgba(147, 197, 253, 0.35);
}
.dark-theme .amenity-card-item.selected .amenity-badge-arancel {
  background: rgba(251, 191, 36, 0.25);
  color: #FDE047;
  border: 1px solid #FBBF24;
}

/* Botones de selección de horas (estilo butacas) */
.hora-slot-btn {
  padding: 10px 6px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 800;
  text-align: center;
  cursor: pointer;
  transition: all .15s ease;
  background: #ffffff;
  border: 1.5px solid var(--borde-fuerte);
  color: var(--texto);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-family: inherit;
  user-select: none;
}
.hora-slot-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}
.hora-slot-btn.selected {
  background: linear-gradient(135deg, var(--acento), var(--acento)) !important;
  border: 1.5px solid var(--acento) !important;
  color: #ffffff !important;
  box-shadow: 0 3px 10px rgba(30,95,180,.35) !important;
}
.hora-slot-btn.ocupado {
  background: var(--error-fondo) !important;
  border: 1.5px solid var(--error-borde) !important;
  color: var(--error) !important;
  cursor: not-allowed !important;
  opacity: 0.85 !important;
}

/* Modo oscuro para botones de horas */
.dark-theme .hora-slot-btn {
  background: #15223D !important;
  border: 1.5px solid #24355A !important;
  color: #FFFFFF !important;
}
.dark-theme .hora-slot-btn.selected {
  background: linear-gradient(135deg, #F59E0B, #D97706) !important;
  border: 1.5px solid #FDE047 !important;
  color: #070D1E !important;
  box-shadow: 0 0 16px rgba(251, 191, 36, 0.45) !important;
}
.dark-theme .hora-slot-btn.selected span {
  color: #070D1E !important;
  font-weight: 900 !important;
}
.dark-theme .hora-slot-btn.ocupado {
  background: rgba(239, 68, 68, 0.15) !important;
  border: 1.5px solid rgba(239, 68, 68, 0.35) !important;
  color: #F87171 !important;
  opacity: 0.75 !important;
}
.dark-theme .hora-slot-btn.ocupado span {
  color: #F87171 !important;
}

.dark-theme #resumen-seleccion-horas {
  background: rgba(251, 191, 36, 0.15) !important;
  border: 1px solid rgba(251, 191, 36, 0.4) !important;
  color: #FDE047 !important;
}
.dark-theme #resumen-seleccion-horas strong,
.dark-theme #resumen-seleccion-horas span {
  color: #FFFFFF !important;
}

.dark-theme #contenido-reglamento-amenity {
  background: #0B1426 !important;
  border-color: #24355A !important;
  color: #FFFFFF !important;
}
.dark-theme #titulo-reglamento-amenity {
  color: #FBBF24 !important;
}

/* Caja Informativa de Arancel (Azul con letras blancas de alto contraste) */
.arancel-box.arancel-pago {
  background: linear-gradient(135deg, #1E40AF, var(--acento)) !important;
  border: 1.5px solid #60A5FA !important;
  color: #FFFFFF !important;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.25) !important;
}
.arancel-box.arancel-pago strong,
.arancel-box.arancel-pago span,
.arancel-box.arancel-pago div {
  color: #FFFFFF !important;
}
.arancel-box.arancel-pago .txt-destacado-oro {
  color: #FEF08A !important;
  font-weight: 900 !important;
}

.dark-theme .arancel-box.arancel-pago {
  background: linear-gradient(135deg, #0F2554, #1E3A8A) !important;
  border: 1.5px solid #3B82F6 !important;
  color: #FFFFFF !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
}
.dark-theme .arancel-box.arancel-pago strong,
.dark-theme .arancel-box.arancel-pago span,
.dark-theme .arancel-box.arancel-pago div {
  color: #FFFFFF !important;
}
.dark-theme .arancel-box.arancel-pago .txt-destacado-oro {
  color: #FDE047 !important;
  font-weight: 900 !important;
}

.arancel-box.arancel-gratis {
  background: linear-gradient(135deg, #065F46, #047857) !important;
  border: 1.5px solid #34D399 !important;
  color: #FFFFFF !important;
}
.arancel-box.arancel-gratis strong,
.arancel-box.arancel-gratis span,
.arancel-box.arancel-gratis div {
  color: #FFFFFF !important;
}
.dark-theme .arancel-box.arancel-gratis {
  background: linear-gradient(135deg, #064E3B, #047857) !important;
  border: 1.5px solid #10B981 !important;
  color: #FFFFFF !important;
}
.dark-theme .arancel-box.arancel-gratis strong,
.dark-theme .arancel-box.arancel-gratis span,
.dark-theme .arancel-box.arancel-gratis div {
  color: #FFFFFF !important;
}

/* Inputs, textareas y selects en modo oscuro */
.dark-theme input.inp,
.dark-theme input[type="text"],
.dark-theme input[type="password"],
.dark-theme textarea {
  background: #0B1426 !important;
  color: #FFFFFF !important;
  border-color: #24355A !important;
}
.dark-theme input::placeholder,
.dark-theme textarea::placeholder {
  color: #94A3B8 !important;
}

.dark-theme .v-bottom-nav { background: #0F1A30 !important; border-top-color: #1E2D4A !important; }
.dark-theme .v-bottom-nav a { color: #FFFFFF !important; }
.dark-theme .chat-bubble-marcos { background: #15223D !important; border-color: #24355A !important; color: #FFFFFF !important; }

/* Switch deslizante para timbre digital */
.slider-timbre:before {
  position: absolute;
  content: "";
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: .3s;
}
input:checked + .slider-timbre:before {
  transform: translateX(22px);
}

/* --- ESTILOS TIMBRE Y GESTIÓN DE OCUPANTES --- */
.timbre-horario-row {
  background: var(--superficie-2);
  border: 1px solid var(--borde);
  border-radius: 14px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.timbre-horario-label {
  color: var(--texto);
  font-size: 12px;
  font-weight: 800;
}
.timbre-de-label, .timbre-a-label {
  color: var(--texto-suave);
  font-size: 11px;
  font-weight: 700;
}
.inp-time-timbre {
  border: 1px solid var(--borde-fuerte);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--texto);
  background: #ffffff;
}

.ocupante-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--superficie-2);
  border: 1px solid var(--borde);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 6px;
}
.ocupante-nombre {
  font-size: 13px;
  font-weight: 800;
  color: var(--texto);
}
.ocupante-contacto {
  font-size: 11px;
  color: var(--texto-suave);
  margin-top: 2px;
  font-weight: 600;
}
.ocupante-timbre-status.timbre-on {
  font-size: 11px;
  font-weight: 800;
  color: var(--ok);
}
.ocupante-timbre-status.timbre-off {
  font-size: 11px;
  font-weight: 800;
  color: var(--texto-tenue);
}
.badge-ocupante {
  font-size: 10.5px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
}
.badge-ocupante-propietario { background: var(--ok-fondo); color: var(--ok); border: 1px solid var(--ok-borde); }
.badge-ocupante-inquilino { background: var(--acento-tenue); color: var(--acento); border: 1px solid var(--acento-borde); }
.badge-ocupante-asistente { background: var(--info-fondo); color: var(--info); border: 1px solid var(--info-borde); }
.badge-ocupante-turista { background: var(--aviso-fondo); color: var(--aviso); border: 1px solid var(--aviso-borde); }

.btn-ocupante-action {
  padding: 11px 10px;
  border-radius: 12px;
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all .15s ease;
  user-select: none;
}
.btn-ocupante-familiar {
  border: 1.5px solid var(--borde-fuerte);
  background: var(--superficie-2);
  color: var(--texto);
}
.btn-ocupante-familiar i { font-size: 17px; color: var(--acento); }
.btn-ocupante-huesped {
  border: 1.5px solid var(--aviso-borde);
  background: #FFFBEB;
  color: var(--aviso);
}
.btn-ocupante-huesped i { font-size: 17px; color: #D97706; }
.btn-ocupante-reubicar {
  width: 100%;
  margin-top: 8px;
  padding: 11px;
  border: 1.5px dashed #6366F1;
  background: var(--info-fondo);
  color: #4F46E5;
  font-size: 12.5px;
}
.btn-ocupante-reubicar i { font-size: 17px; color: #4F46E5; }

/* MODO OSCURO PARA TIMBRE Y OCUPANTES */
.dark-theme .timbre-horario-row {
  background: #15223D !important;
  border: 1px solid #24355A !important;
}
.dark-theme .timbre-horario-label {
  color: #FBBF24 !important; /* Amarillo oro brillante */
  font-weight: 800 !important;
}
.dark-theme .timbre-de-label,
.dark-theme .timbre-a-label {
  color: #FFFFFF !important; /* Blanco puro */
  font-weight: 700 !important;
}
.dark-theme .inp-time-timbre {
  background: #0B1426 !important;
  border: 1.5px solid #3B82F6 !important;
  color: #FFFFFF !important;
  color-scheme: dark !important;
}

.dark-theme .ocupante-item-row {
  background: #15223D !important;
  border: 1px solid #24355A !important;
}
.dark-theme .ocupante-nombre {
  color: #FFFFFF !important;
  font-weight: 900 !important;
}
.dark-theme .ocupante-contacto {
  color: var(--texto-suave) !important;   /* era amarillo: un teléfono no es una alerta */
}
.dark-theme .ocupante-timbre-status.timbre-on {
  color: #4ADE80 !important;
  font-weight: 800 !important;
}
.dark-theme .ocupante-timbre-status.timbre-off {
  color: #F87171 !important;
  font-weight: 800 !important;
}

.dark-theme .badge-ocupante-propietario {
  background: rgba(34, 197, 94, 0.2) !important;
  color: #4ADE80 !important;
  border: 1px solid rgba(74, 222, 128, 0.5) !important;
}
.dark-theme .badge-ocupante-inquilino {
  background: rgba(59, 130, 246, 0.2) !important;
  color: #60A5FA !important;
  border: 1px solid rgba(96, 165, 250, 0.5) !important;
}
.dark-theme .badge-ocupante-asistente {
  background: rgba(129, 140, 248, 0.2) !important;
  color: #A5B4FC !important;
  border: 1px solid rgba(165, 180, 252, 0.5) !important;
}
.dark-theme .badge-ocupante-turista {
  background: rgba(245, 158, 11, 0.25) !important;
  color: #FDE047 !important;
  border: 1px solid #F59E0B !important;
}

/* Botones en modo oscuro: fondo oscuro profundo con bordes y tipografía resaltada */
.dark-theme .btn-ocupante-familiar {
  background: #172554 !important;
  border: 1.5px solid #3B82F6 !important;
  color: #FFFFFF !important;
}
.dark-theme .btn-ocupante-familiar span {
  color: #FFFFFF !important;
  font-weight: 800 !important;
}
.dark-theme .btn-ocupante-familiar i {
  color: #60A5FA !important;
}

.dark-theme .btn-ocupante-huesped {
  background: #2E1B05 !important;
  border: 1.5px solid #F59E0B !important;
  color: #FBBF24 !important;
}
.dark-theme .btn-ocupante-huesped span {
  color: #FBBF24 !important;
  font-weight: 900 !important;
}
.dark-theme .btn-ocupante-huesped i {
  color: #FBBF24 !important;
}

.dark-theme .btn-ocupante-reubicar {
  background: #1E1B4B !important;
  border: 1.5px dashed #818CF8 !important;
  color: #FFFFFF !important;
}
.dark-theme .btn-ocupante-reubicar span {
  color: #FFFFFF !important;
  font-weight: 800 !important;
}
.dark-theme .btn-ocupante-reubicar i {
  color: #A5B4FC !important;
}

/* Selector de roles para asignación de integrantes */
.btn-rol-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 8px;
  background: var(--superficie-2);
  border: 1.5px solid var(--borde);
  border-radius: 12px;
  color: var(--texto-medio);
  font-size: 11.5px;
  font-weight: 800;
  cursor: pointer;
  transition: all .15s ease;
  text-align: center;
}
.btn-rol-selector i {
  font-size: 20px;
  color: var(--texto-suave);
}
.btn-rol-selector.active {
  background: var(--acento-tenue);
  border-color: #2563EB;
  color: var(--acento);
}
.btn-rol-selector.active i {
  color: var(--acento);
}

.dark-theme .btn-rol-selector {
  background: #15223D !important;
  border-color: #24355A !important;
  color: #FFFFFF !important;
}
.dark-theme .btn-rol-selector i {
  color: #93C5FD !important;
}
.dark-theme .btn-rol-selector.active {
  background: #1E3A8A !important;
  border-color: #3B82F6 !important;
  color: #FBBF24 !important;
}
.dark-theme .btn-rol-selector.active i {
  color: #FBBF24 !important;
}
`;

function getVecinoSession(req) {
  if (req.session && req.session.vecino) {
    return req.session.vecino;
  }
  // Sin sesión se devuelve la de prueba. La arma `sesion-demo.js`, que es la MISMA que usa el
  // botón "Demo Rápido" del login: cuando eran dos copias, una tenía `unidades` y la otra no.
  return sesionDemoVecino('propietario');
}

// El nombre para mostrar. Los logins reales guardan `nombre` y `apellido` por separado
// (`/api/login-email` los lee así de la tabla `usuarios`), así que las iniciales del avatar salían
// con una sola letra para todo el mundo que entró de verdad.
function nombreCompleto(v) {
  return [v && v.nombre, v && v.apellido].filter(Boolean).join(' ').trim() || 'Vecino';
}

function primerNombre(v) {
  return nombreCompleto(v).split(' ')[0];
}

// ¿Esta fila guardada es de este vecino?
//
// Hasta el 22/09 el portal escribía `v.nombre` en `reportes`, `reclamos` y `reservas_amenities`,
// y los logins reales guardan el nombre de pila y el apellido por separado: lo que quedó en la
// base fue "Daniel", sin apellido. Ahora se escribe el nombre completo, así que las filas viejas
// y las nuevas NO dicen lo mismo.
//
// Por eso se acepta cualquiera de las dos formas. Comparar solo contra la nueva le escondería al
// vecino todos sus reclamos y reservas anteriores al cambio — y él no tendría forma de saber por
// qué desaparecieron.
function esElMismoVecino(guardado, v) {
  const g = String(guardado || '').trim().toLowerCase();
  if (!g) return false;
  return g === nombreCompleto(v).toLowerCase() || g === String(v.nombre || '').trim().toLowerCase();
}

// Cómo se muestra cada rol. Estaba escrito cuatro veces (topbar, integrantes, badges de la lista
// de ocupantes) con emojis distintos en cada una; acá queda uno solo para lo nuevo.
// Los roles, con icono de trazo en vez de emoji.
//
// El emoji lo dibuja el sistema operativo, no nosotros: cada telefono lo pinta distinto y ninguno
// respeta la paleta -- le mete color propio. Cinco emojis de colores ajenos en la misma pantalla
// eran la mitad de lo que se veia griton. Phosphor ya viaja en el <head> del portal y hereda el
// color que se le de, asi que el icono sale del tono del texto que acompania.
//
// Y el rol deja de tener color propio: todos usan la misma superficie neutra. El color se reserva
// para lo que significa algo -- esto salio bien, mira esto, esto fallo. Un rol es una etiqueta,
// no una alarma, y eran cuatro colores mas compitiendo en la misma pantalla.
const ROLES_VECINO = {
  propietario: { icono: 'crown-simple' },
  inquilino:   { icono: 'key' },
  turista:     { icono: 'suitcase-simple' },
  asistente:   { icono: 'buildings' },
  registrado:  { icono: 'user-circle-dashed' },
};

// El badge armado, para no repetir el mismo bloque de estilo en cada pantalla.
// `sobreOscuro` es para la cabecera azul, donde la superficie neutra no se ve.
function etiquetaRolHtml(rol, t, { sobreOscuro = false } = {}) {
  const r = etiquetaRol(rol);
  const nombre = t(`rol.${ROLES_VECINO[rol] ? rol : 'propietario'}`);
  const fondo = sobreOscuro ? 'rgba(255,255,255,.16)' : 'var(--superficie-3)';
  const color = sobreOscuro ? 'var(--sobre-acento)' : 'var(--texto-medio)';
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;`
    + `background:${fondo};color:${color};padding:2px 8px;border-radius:999px;white-space:nowrap">`
    + `<i class="ph ph-${r.icono}" style="font-size:12px"></i>${esc(nombre)}</span>`;
}

function etiquetaRol(rol) {
  return ROLES_VECINO[rol] || ROLES_VECINO.propietario;
}

function iniciales(v) {
  return nombreCompleto(v).split(' ').filter(Boolean).map(n => n[0].toUpperCase()).slice(0, 2).join('');
}

function shellVecino(title, activeTab, content, vecinoData) {
  const v = vecinoData || getVecinoSession({});
  const t = textos(v.idioma);

  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0F326A">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Mi Consorcio">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/admin/assets/logo.png">
<link rel="icon" type="image/png" href="/admin/assets/logo.png">
<title>Marcos IA · ${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/fill/style.css"/>
<style>${CSS_VECINO}</style>
<script>
  (function(){
    var savedTheme = localStorage.getItem('marcos_theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark-theme');
    }
  })();
  function toggleTheme(){
    const isDark = document.documentElement.classList.toggle('dark-theme');
    localStorage.setItem('marcos_theme', isDark ? 'dark' : 'light');
  }
  window._deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    window._deferredPrompt = e;
  });
  window.addEventListener('appinstalled', function() {
    localStorage.setItem('pwa_installed', 'true');
    var b = document.getElementById('card-instalar-pwa');
    if (b) b.style.display = 'none';
    window._deferredPrompt = null;
  });
  document.addEventListener('DOMContentLoaded', function() {
    var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches || localStorage.getItem('pwa_installed') === 'true';
    if (isStandalone) {
      var b = document.getElementById('card-instalar-pwa');
      if (b) b.style.display = 'none';
    }
  });
  window.instalarPwa = function() {
    if (window._deferredPrompt) {
      window._deferredPrompt.prompt();
      window._deferredPrompt.userChoice.then(function(choiceResult) {
        if (choiceResult.outcome === 'accepted') {
          localStorage.setItem('pwa_installed', 'true');
          var b = document.getElementById('card-instalar-pwa');
          if (b) b.style.display = 'none';
        }
        window._deferredPrompt = null;
      });
    } else {
      var ua = navigator.userAgent.toLowerCase();
      if (ua.includes('firefox')) {
        alert('🦊 Para instalar en Firefox:\\n\\n1. Tocá el menú de 3 puntos (⋮) arriba a la derecha en Firefox.\\n2. Seleccioná "Instalar" (o el icono de casa con + en la barra).');
      } else if (/iphone|ipad|ipod/.test(ua)) {
        alert('🍏 Para instalar en iPhone / Safari:\\n\\n1. Tocá el botón Compartir (el cuadrado con la flecha hacia arriba).\\n2. Elegí "Agregar a la pantalla de inicio".');
      } else {
        alert('📲 Para instalar la app:\\n\\n1. Tocá el menú de 3 puntos (⋮) de tu navegador.\\n2. Seleccioná "Instalar aplicación" o "Agregar a pantalla principal".');
      }
    }
  };
  window.abrirIdiomas = function(ev) {
    ev.stopPropagation();
    var m = document.getElementById('menu-idiomas');
    if (m) m.style.display = (m.style.display === 'block') ? 'none' : 'block';
  };
  document.addEventListener('click', function() {
    var m = document.getElementById('menu-idiomas');
    if (m) m.style.display = 'none';
  });
  window.elegirIdioma = async function(codigo) {
    try {
      var res = await fetch('/vecino/api/idioma', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idioma: codigo })
      });
      var data = await res.json();
      if (data.ok) location.reload();
    } catch (e) { console.warn('idioma:', e); }
  };
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function(e){ console.warn('SW:', e); });
    });
  }
</script>
</head>
<body>
<div class="app-shell">
  
  <!-- TOPBAR VECINO (Estilo Mercado Pago con Cabecera Azul Consorcio) -->
  <header style="background:linear-gradient(180deg,var(--marca) 0%,#1A4A8F 100%);color:#ffffff;padding:16px 16px 20px;position:sticky;top:0;z-index:40;box-shadow:0 4px 15px rgba(15,50,106,.2)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:12px">
        <a href="/vecino/perfil" title="Mi Perfil" style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:#fff;text-decoration:none;flex-shrink:0">
          ${iniciales(v)}
        </a>
        <div>
          <div style="display:flex;align-items:center;gap:6px">
            <a href="/vecino/perfil" style="font-size:16px;font-weight:900;line-height:1.2;letter-spacing:-.01em;color:#fff;text-decoration:none">${esc(t('topbar.hola', { nombre: primerNombre(v) }))}</a>
            ${etiquetaRolHtml(v.rol, t, { sobreOscuro: true })}
          </div>
          ${v.unidades && v.unidades.length > 1 ? `
          <button type="button" onclick="abrirModalCambiarUnidad()" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--dorado);margin-top:3px;background:rgba(0,0,0,.3);border:1px solid rgba(251,191,36,0.5);border-radius:6px;padding:2px 8px;cursor:pointer">
            <span><i class="ph ph-buildings" style="font-size:12px;vertical-align:-1px"></i> ${esc(v.edificio)} · Depto ${esc(v.departamento)}</span>
            <span style="font-size:9px">▼</span>
          </button>
          ` : `
          <div style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:rgba(255,255,255,.85);margin-top:2px">
            <span>${esc(v.edificio)}</span> · <span style="background:rgba(255,255,255,.2);padding:1px 6px;border-radius:6px">Depto ${esc(v.departamento)}</span>
          </div>
          `}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="position:relative">
          <button type="button" onclick="abrirIdiomas(event)" title="${esc(t('topbar.idioma'))}" style="width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.15);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff">
            <i class="ph ph-translate" style="font-size:19px"></i>
          </button>
          <div id="menu-idiomas" style="display:none;position:absolute;right:0;top:42px;background:var(--superficie);border:1px solid var(--borde);border-radius:14px;box-shadow:var(--sombra-alta);overflow:hidden;z-index:60;min-width:168px">
            ${IDIOMAS.map(i => `
            <button type="button" onclick="elegirIdioma('${i.codigo}')" style="display:flex;align-items:center;gap:9px;width:100%;padding:11px 14px;border:none;background:${i.codigo === t.idioma ? 'var(--acento-tenue)' : 'transparent'};color:var(--texto);font-size:13.5px;font-weight:${i.codigo === t.idioma ? '800' : '600'};cursor:pointer;text-align:left;font-family:inherit">
              <span style="font-size:15px">${i.bandera}</span><span>${i.nombre}</span>
              ${i.codigo === t.idioma ? '<i class="ph ph-check" style="margin-left:auto;font-size:14px;color:var(--acento)"></i>' : ''}
            </button>`).join('')}
          </div>
        </div>
        <a href="/vecino/perfil" title="${esc(t('topbar.perfil'))}" style="width:36px;height:36px;border-radius:50%;background:${activeTab === 'perfil' ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.15)'};display:flex;align-items:center;justify-content:center;color:#fff;text-decoration:none">
          <i class="ph ph-user-circle" style="font-size:19px"></i>
        </a>
        <button onclick="toggleTheme()" style="width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.15);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff">
          <i class="ph ph-moon" style="font-size:18px"></i>
        </button>
        <a href="/vecino/logout" title="${esc(t('topbar.salir'))}" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;color:#fff;text-decoration:none">
          <i class="ph ph-sign-out" style="font-size:18px"></i>
        </a>
      </div>
    </div>
  </header>

  <!-- CONTENIDO PRINCIPAL -->
  <main style="flex:1" class="anim-fade">
    ${content}
  </main>

  <!-- BARRA DE NAVEGACION INFERIOR (Estilo Mercado Pago con Botón QR Central) -->
  <nav class="v-bottom-nav">
    <a href="/vecino" class="${activeTab === 'inicio' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-house${activeTab === 'inicio' ? '-fill' : ''}"></i></span>
      <span>${esc(t('nav.inicio'))}</span>
    </a>
    <a href="/vecino/chat" class="${activeTab === 'chat' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-chat-circle-dots${activeTab === 'chat' ? '-fill' : ''}"></i></span>
      <span>${esc(t('nav.chat'))}</span>
    </a>
    
    <!-- Botón Central QR Portería -->
    <a href="/porteria/${encodeURIComponent(v.edificio || 'San Patricio 159')}" style="position:relative;top:-10px;text-decoration:none">
      <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(15,50,106,.35);border:3px solid #fff">
        <i class="ph ph-qr-code" style="font-size:26px"></i>
      </div>
      <span style="font-size:10.5px;font-weight:800;color:var(--marca);margin-top:2px">${esc(t('nav.porteria'))}</span>
    </a>

    <a href="/vecino/amenities" class="${activeTab === 'amenities' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-calendar-check${activeTab === 'amenities' ? '-fill' : ''}"></i></span>
      <span>${esc(t('nav.amenities'))}</span>
    </a>
    ${v.puede_ver_expensas !== false ? `
    <a href="/vecino/expensas" class="${activeTab === 'expensas' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-receipt${activeTab === 'expensas' ? '-fill' : ''}"></i></span>
      <span>${esc(t('nav.expensas'))}</span>
    </a>` : `
    <a href="/vecino/novedades" class="${activeTab === 'novedades' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-bell-simple${activeTab === 'novedades' ? '-fill' : ''}"></i></span>
      <span>${esc(t('nav.avisos'))}</span>
    </a>`}
  </nav>

  <!-- MODAL CAMBIAR UNIDAD (MULTI-PROPIEDAD) -->
  ${v.unidades && v.unidades.length > 1 ? `
  <div id="modal-cambiar-unidad" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;align-items:center;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:20px;max-width:380px;width:100%;padding:22px 20px;box-shadow:0 12px 35px rgba(0,0,0,0.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--texto)">Seleccionar Propiedad</div>
          <div style="font-size:12px;color:var(--texto-suave)">Cambiá de departamento en 1 toque</div>
        </div>
        <button type="button" onclick="cerrarModalCambiarUnidad()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--texto-suave)">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${v.unidades.map(u => {
          const isActiva = u.edificio.toLowerCase() === v.edificio.toLowerCase() && u.departamento.toLowerCase() === v.departamento.toLowerCase();
          return `
          <div onclick="seleccionarUnidadActiva('${escJs(u.edificio)}', '${escJs(u.departamento)}')" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:12px;border:2px solid ${isActiva ? '#2E6FC0' : '#E2E8F0'};background:${isActiva ? '#EFF6FF' : '#F8FAFD'};cursor:pointer">
            <div>
              <div style="font-size:14px;font-weight:800;color:${isActiva ? '#1E40AF' : '#0F172A'}">${esc(u.edificio)}</div>
              <div style="font-size:12px;color:var(--texto-suave)">Depto <strong>${esc(u.departamento)}</strong> · Rol: <strong>${esc(u.rol || 'propietario')}</strong></div>
            </div>
            ${isActiva ? '<span style="font-size:12px;color:var(--acento);font-weight:900">✓ Activo</span>' : ''}
          </div>
          `;
        }).join('')}
      </div>
    </div>
  </div>
  <script>
    function abrirModalCambiarUnidad() {
      var m = document.getElementById('modal-cambiar-unidad');
      if (m) m.style.display = 'flex';
    }
    function cerrarModalCambiarUnidad() {
      var m = document.getElementById('modal-cambiar-unidad');
      if (m) m.style.display = 'none';
    }
    async function seleccionarUnidadActiva(edificio, depto) {
      try {
        var res = await fetch('/vecino/api/cambiar-unidad', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: edificio, departamento: depto })
        });
        var data = await res.json();
        if (data && data.ok) location.reload();
      } catch(_) { location.reload(); }
    }
  </script>
  ` : ''}

  <!-- MODAL LLAMADA ENTRANTE DE PORTERÍA (TIMBRE VIRTUAL & VOZ WEBRTC FULLSCREEN) -->
  <audio id="audio-webrtc-vecino" autoplay playsinline style="display:none"></audio>
  <div id="modal-llamada-timbre" style="position:fixed;inset:0;width:100vw;height:100vh;background:linear-gradient(165deg,#0A1F44 0%,var(--marca) 50%,var(--acento) 100%);z-index:99999;display:none;flex-direction:column;align-items:center;justify-content:space-between;padding:36px 20px 24px;color:#fff;text-align:center;box-sizing:border-box;overflow-y:auto">
    
    <!-- 1. Estado: Sonando Timbre -->
    <div id="box-timbre-sonando" style="display:flex;flex-direction:column;align-items:center;width:100%;max-width:440px;margin:auto 0">
      
      <!-- Captura Facial Anti-Broma de Quién Toca -->
      <div id="box-foto-visita-preview" style="text-align:center;margin-bottom:14px;display:none">
        <img id="img-foto-visita" src="" style="width:130px;height:130px;border-radius:20px;object-fit:cover;border:3px solid #38BDF8;box-shadow:0 8px 24px rgba(0,0,0,.4);margin:0 auto 6px;display:block">
        <span style="font-size:11px;font-weight:800;background:rgba(255,255,255,.2);color:#fff;padding:2px 10px;border-radius:999px">📸 Captura en la Puerta</span>
      </div>

      <div id="avatar-timbre-default" style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,var(--acento),#38BDF8);display:flex;align-items:center;justify-content:center;font-size:48px;margin-bottom:16px;box-shadow:0 0 50px rgba(56,189,248,.6);animation:pulseRing 1.2s infinite">
        🔔
      </div>
      <div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#38BDF8;margin-bottom:6px">TIMBRE ENTRANTE EN PORTERÍA</div>
      <h2 style="font-size:24px;font-weight:900;margin-bottom:4px" id="llamada-timbre-visita">🛵 Delivery en Puerta</h2>
      <p style="font-size:15px;color:#E2E8F0;margin-bottom:18px">${v.edificio} · Depto ${v.departamento}</p>

      <!-- Botón Principal: Ver Cámara en Vivo -->
      <button onclick="verCamaraEnVivoVecino()" style="width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#0284C7,#0EA5E9);color:#fff;font-size:16.5px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 6px 22px rgba(14,165,233,.5);margin-bottom:10px">
        <i class="ph ph-video-camera-fill" style="font-size:24px"></i>
        <span>📹 VER CÁMARA EN VIVO (Puerta)</span>
      </button>

      <!-- Botón Secundario: Hablar en Vivo -->
      <button onclick="iniciarLlamadaVozVecino()" style="width:100%;height:48px;border:none;border-radius:16px;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-size:15px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 4px 18px rgba(22,163,74,.4);margin-bottom:12px">
        <i class="ph ph-phone-call-fill" style="font-size:22px"></i>
        <span>📞 HABLAR EN VIVO (Llamada)</span>
      </button>

      <!-- Disclaimer Privacidad Vecino -->
      <div style="font-size:12px;color:#93C5FD;background:rgba(15,23,42,.45);border:1px solid rgba(56,189,248,.25);border-radius:10px;padding:6px 12px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:6px">
        <span>🔒</span>
        <span>Tu cámara está desactivada (solo vos ves la puerta).</span>
      </div>

      <div style="font-size:12px;font-weight:800;color:var(--texto-tenue);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">O responder con texto rápido:</div>

      <!-- Respuestas Rápidas de Texto -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;margin-bottom:12px">
        <button onclick="responderTimbreVecino('¡Ya bajo!')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🏃 ¡Ya bajo!</span>
        </button>
        <button onclick="responderTimbreVecino('Dejalo en el hall / puerta')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🚪 En el hall</span>
        </button>
        <button onclick="responderTimbreVecino('Dejar con el encargado')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>📬 Encargado</span>
        </button>
        <button onclick="responderTimbreVecino('No estoy en el departamento')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🚫 No estoy</span>
        </button>
      </div>

      <!-- Campo de Respuesta Personalizada Libre -->
      <div style="display:flex;gap:8px;width:100%;margin-bottom:18px">
        <input id="input-resp-personalizada" type="text" placeholder="Escribir mensaje personalizado..." style="flex:1;height:46px;background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);border-radius:12px;padding:0 14px;color:#fff;font-size:14px;outline:none" onkeydown="if(event.key==='Enter')enviarTextoLibreVecino()">
        <button onclick="enviarTextoLibreVecino()" style="padding:0 16px;height:46px;background:var(--acento);border:none;border-radius:12px;color:#fff;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px">
          <span>Enviar</span>
          <i class="ph ph-paper-plane-right-fill" style="font-size:16px"></i>
        </button>
      </div>

      <button onclick="silenciarTimbreVecino()" style="background:transparent;border:none;color:var(--texto-tenue);font-size:13px;font-weight:700;cursor:pointer;padding:8px 16px">
        ✕ Silenciar / Rechazar
      </button>
    </div>

    <!-- 2. Estado: En Llamada y Transmisión de Cámara en Vivo Activa -->
    <div id="box-llamada-voz-activa" style="display:none;flex-direction:column;align-items:center;width:100%;max-width:440px;margin:auto 0">
      
      <!-- Videoportero: Transmisión en Vivo desde la Puerta -->
      <div id="box-video-webrtc" style="width:100%;max-width:360px;margin-bottom:14px;position:relative;border-radius:20px;overflow:hidden;background:#0F172A;aspect-ratio:4/3;box-shadow:0 10px 30px rgba(0,0,0,.6);border:2px solid rgba(56,189,248,.3)">
        <video id="video-webrtc-vecino" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;display:block"></video>
        <img id="img-video-snapshot-placeholder" src="" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
        
        <div id="video-connecting-overlay" style="position:absolute;inset:0;background:rgba(15,23,42,.75);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;z-index:2">
          <div style="font-size:28px">📡</div>
          <span style="font-size:13px;font-weight:800;color:#38BDF8">Conectando cámara de la puerta...</span>
        </div>

        <div style="position:absolute;top:10px;left:10px;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);color:#fff;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:900;z-index:3;border:1px solid rgba(255,255,255,.15)">
          <span style="width:8px;height:8px;border-radius:50%;background:#EF4444;box-shadow:0 0 8px #EF4444;animation:pulseRing 1.2s infinite"></span>
          <span>CÁMARA EN VIVO</span>
        </div>

        <div style="position:absolute;top:10px;right:10px;display:flex;align-items:center;gap:5px;background:rgba(15,23,42,.75);backdrop-filter:blur(4px);color:#86EFAC;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:800;z-index:3;border:1px solid rgba(134,239,172,.3)">
          <span>🔒 Vecino privado</span>
        </div>
      </div>

      <div style="font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#86EFAC;margin-bottom:2px">PUERTA DE CALLE CONECTADA</div>
      <h2 style="font-size:20px;font-weight:900;margin-bottom:2px" id="llamada-activa-subtitulo">Transmisión en directo</h2>
      <div id="voz-timer" style="font-size:18px;font-family:monospace;font-weight:800;color:#38BDF8;margin-bottom:14px">00:00</div>

      <div style="display:flex;gap:10px;margin-bottom:14px;width:100%">
        <button id="btn-mute-voz" onclick="toggleMuteVoz()" style="flex:1;height:48px;border-radius:14px;border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:#fff;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .2s">
          <i class="ph ph-microphone-slash-fill" style="font-size:18px"></i>
          <span>Micrófono</span>
        </button>
        <button onclick="responderTimbreVecino('¡Ya bajo!')" style="flex:1;height:48px;border-radius:14px;border:none;background:var(--acento);color:#fff;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🏃 ¡Ya bajo!</span>
        </button>
      </div>

      <button onclick="cortarLlamadaVoz()" style="width:100%;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#DC2626,#B91C1C);color:#fff;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 20px rgba(220,38,38,.5)">
        <i class="ph ph-phone-disconnect-fill" style="font-size:22px"></i>
        <span>FINALIZAR / CERRAR CÁMARA</span>
      </button>
    </div>

  </div>

  <script>
  (function(){
    var _edificioVecino = '${v.edificio}';
    var _deptoVecino = '${v.departamento}';
    var _audioCtx = null;
    var _intervalRingtone = null;
    var _llamadaMostradaId = '';
    var _peerConn = null;
    var _localStream = null;
    var _timerInterval = null;
    var _timerSecs = 0;
    var _isMuted = true;
    var _fotoVisitanteUltima = '';
    var _sigInterval = null;

    function unlockAudio() {
      try {
        if (!_audioCtx) {
          _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') {
          _audioCtx.resume();
        }
      } catch(_) {}
    }
    document.addEventListener('click', unlockAudio, { passive: true });
    document.addEventListener('touchstart', unlockAudio, { passive: true });

    function sonarRingtone() {
      try {
        unlockAudio();
        if (_audioCtx) {
          var osc = _audioCtx.createOscillator();
          var gain = _audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, _audioCtx.currentTime);
          osc.frequency.setValueAtTime(659.25, _audioCtx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.5, _audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.6);
          osc.connect(gain);
          gain.connect(_audioCtx.destination);
          osc.start();
          osc.stop(_audioCtx.currentTime + 0.6);
        }

        if (navigator.vibrate) {
          navigator.vibrate([400, 200, 400, 200, 800]);
        }
      } catch(_) {}
    }

    function iniciarRingtoneLoop() {
      sonarRingtone();
      if (!_intervalRingtone) {
        _intervalRingtone = setInterval(sonarRingtone, 1200);
      }
    }

    function detenerRingtoneLoop() {
      if (_intervalRingtone) {
        clearInterval(_intervalRingtone);
        _intervalRingtone = null;
      }
    }

    window.responderTimbreVecino = async function(resp) {
      detenerRingtoneLoop();
      var cId = _llamadaMostradaId;
      cortarLlamadaVoz();
      document.getElementById('modal-llamada-timbre').style.display = 'none';
      try {
        await fetch('/porteria/api/timbre-responder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: _edificioVecino, depto: _deptoVecino, callId: cId, respuesta: resp })
        });
      } catch(_) {}
    };

    window.enviarTextoLibreVecino = function() {
      var inp = document.getElementById('input-resp-personalizada');
      var txt = inp ? inp.value.trim() : '';
      if (!txt) txt = '¡Ya bajo!';
      responderTimbreVecino(txt);
      if (inp) inp.value = '';
    };

    window.silenciarTimbreVecino = function() {
      detenerRingtoneLoop();
      cortarLlamadaVoz();
      document.getElementById('modal-llamada-timbre').style.display = 'none';
    };

    function actualizarBotonMicUI() {
      var btn = document.getElementById('btn-mute-voz');
      if (!btn) return;
      if (_isMuted) {
        btn.style.background = 'rgba(239,68,68,.2)';
        btn.style.borderColor = 'rgba(239,68,68,.5)';
        btn.innerHTML = '<i class="ph ph-microphone-slash-fill" style="font-size:18px;color:#F87171"></i><span style="color:#FCA5A5">Micrófono Apagado</span>';
      } else {
        btn.style.background = 'rgba(34,197,94,.25)';
        btn.style.borderColor = 'rgba(34,197,94,.6)';
        btn.innerHTML = '<i class="ph ph-microphone-fill" style="font-size:18px;color:#4ADE80"></i><span style="color:#86EFAC">Micrófono Encendido</span>';
      }
    }

    window.toggleMuteVoz = async function() {
      if (!_localStream) {
        try {
          _localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          _isMuted = false;
          if (_peerConn) {
            _localStream.getAudioTracks().forEach(function(t){
              _peerConn.addTrack(t, _localStream);
            });
          }
        } catch(e) {
          console.warn('Error accediendo al microfono:', e);
          alert('No se pudo acceder al micrófono del dispositivo');
          return;
        }
      } else {
        _isMuted = !_isMuted;
        _localStream.getAudioTracks().forEach(function(t){ t.enabled = !_isMuted; });
      }
      actualizarBotonMicUI();
    };

    window.verCamaraEnVivoVecino = function() {
      conectarWebRTCVecino(false);
    };

    window.iniciarLlamadaVozVecino = function() {
      conectarWebRTCVecino(true);
    };

    async function conectarWebRTCVecino(conAudioInicial) {
      detenerRingtoneLoop();
      document.getElementById('box-timbre-sonando').style.display = 'none';
      document.getElementById('box-llamada-voz-activa').style.display = 'flex';

      var overlay = document.getElementById('video-connecting-overlay');
      if (overlay) overlay.style.display = 'flex';

      var snapImg = document.getElementById('img-video-snapshot-placeholder');
      if (snapImg && _fotoVisitanteUltima) {
        snapImg.src = _fotoVisitanteUltima;
        snapImg.style.display = 'block';
      }

      var subTitulo = document.getElementById('llamada-activa-subtitulo');
      if (subTitulo) {
        subTitulo.textContent = conAudioInicial ? 'Llamada de voz y video en curso' : 'Transmisión de cámara en directo';
      }

      _timerSecs = 0;
      clearInterval(_timerInterval);
      _timerInterval = setInterval(function(){
        _timerSecs++;
        var m = String(Math.floor(_timerSecs / 60)).padStart(2, '0');
        var s = String(_timerSecs % 60).padStart(2, '0');
        var el = document.getElementById('voz-timer');
        if (el) el.textContent = m + ':' + s;
      }, 1000);

      try {
        fetch('/porteria/api/timbre-responder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            edificio: _edificioVecino,
            depto: _deptoVecino,
            callId: _llamadaMostradaId,
            modoVoz: true
          })
        }).catch(function(){});

        // NUNCA pedir video local: la privacidad del vecino está 100% protegida
        try {
          _localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          _isMuted = !conAudioInicial;
          _localStream.getAudioTracks().forEach(function(t){ t.enabled = !_isMuted; });
        } catch(e) {
          console.warn('Audio local no disponible o denegado:', e);
          _localStream = null;
          _isMuted = true;
        }
        actualizarBotonMicUI();

        _peerConn = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        if (_localStream) {
          _localStream.getTracks().forEach(function(track){
            _peerConn.addTrack(track, _localStream);
          });
        }

        // Transceiver para recibir la cámara de la puerta (recvonly)
        try {
          _peerConn.addTransceiver('video', { direction: 'recvonly' });
        } catch(e) {
          console.warn('addTransceiver video:', e);
        }

        _peerConn.ontrack = function(event){
          if (event.track.kind === 'video') {
            var remoteVideo = document.getElementById('video-webrtc-vecino');
            var over = document.getElementById('video-connecting-overlay');
            var snap = document.getElementById('img-video-snapshot-placeholder');
            if (remoteVideo && event.streams[0]) {
              remoteVideo.srcObject = event.streams[0];
              remoteVideo.play().catch(function(e){ console.warn('Video play error:', e); });
              if (over) over.style.display = 'none';
              if (snap) snap.style.display = 'none';
            }
          } else if (event.track.kind === 'audio') {
            var remoteAudio = document.getElementById('audio-webrtc-vecino');
            if (remoteAudio && event.streams[0]) {
              remoteAudio.srcObject = event.streams[0];
              remoteAudio.play().catch(function(e){ console.warn('Audio play:', e); });
            }
          }
        };

        _peerConn.onicecandidate = function(event){
          if (event.candidate) {
            fetch('/porteria/api/webrtc-signal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                edificio: _edificioVecino,
                depto: _deptoVecino,
                callId: _llamadaMostradaId,
                from: 'vecino',
                signal: { type: 'candidate', candidate: event.candidate }
              })
            }).catch(function(){});
          }
        };

        var offer = await _peerConn.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await _peerConn.setLocalDescription(offer);

        await fetch('/porteria/api/webrtc-signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            edificio: _edificioVecino,
            depto: _deptoVecino,
            callId: _llamadaMostradaId,
            from: 'vecino',
            signal: { type: 'offer', sdp: offer }
          })
        });

        // Polling de señales de respuesta desde la visita
        var lastSince = Date.now() - 5000;
        var _pendingAnsCandidates = [];
        if (_sigInterval) clearInterval(_sigInterval);
        _sigInterval = setInterval(async function(){
          if (!_peerConn) { clearInterval(_sigInterval); return; }
          try {
            var url = '/porteria/api/webrtc-signal?edificio=' + encodeURIComponent(_edificioVecino) +
              '&depto=' + encodeURIComponent(_deptoVecino) +
              '&forRole=vecino&since=' + lastSince +
              (_llamadaMostradaId ? '&callId=' + encodeURIComponent(_llamadaMostradaId) : '');
            var sRes = await fetch(url);
            var sData = await sRes.json();
            if (sData && sData.signals && sData.signals.length) {
              for (var i = 0; i < sData.signals.length; i++) {
                var sigObj = sData.signals[i].signal;
                lastSince = Math.max(lastSince, sData.signals[i].timestamp);
                if (sigObj.type === 'hangup' || sigObj.type === 'corte') {
                  clearInterval(_sigInterval);
                  detenerRingtoneLoop();
                  clearInterval(_timerInterval);
                  if (_peerConn) { _peerConn.close(); _peerConn = null; }
                  if (_localStream) { _localStream.getTracks().forEach(function(t){ t.stop(); }); _localStream = null; }
                  var remoteVideo = document.getElementById('video-webrtc-vecino');
                  if (remoteVideo) remoteVideo.srcObject = null;

                  var boxVoz = document.getElementById('box-llamada-voz-activa');
                  if (boxVoz) {
                    boxVoz.innerHTML = '<div style="padding:24px 16px;text-align:center">' +
                      '<div style="font-size:42px;margin-bottom:10px">📴</div>' +
                      '<h2 style="font-size:22px;font-weight:900;margin-bottom:6px">La visita finalizó la comunicación</h2>' +
                      '<p style="font-size:14px;color:var(--texto-tenue);margin-bottom:20px">La cámara y los micrófonos se desconectaron.</p>' +
                      '<button onclick="cortarLlamadaVoz()" style="padding:12px 28px;border:none;border-radius:14px;background:var(--acento);color:#fff;font-weight:800;font-size:15px;cursor:pointer">Aceptar / Cerrar</button>' +
                    '</div>';
                  }
                  setTimeout(function(){
                    cortarLlamadaVoz();
                  }, 4500);
                  return;
                } else if (sigObj.type === 'answer' && _peerConn.signalingState === 'have-local-offer') {
                  await _peerConn.setRemoteDescription(new RTCSessionDescription(sigObj.sdp));
                  while (_pendingAnsCandidates.length > 0) {
                    var c = _pendingAnsCandidates.shift();
                    await _peerConn.addIceCandidate(new RTCIceCandidate(c)).catch(function(){});
                  }
                } else if (sigObj.type === 'candidate' && sigObj.candidate) {
                  if (_peerConn.remoteDescription && _peerConn.remoteDescription.type) {
                    await _peerConn.addIceCandidate(new RTCIceCandidate(sigObj.candidate)).catch(function(){});
                  } else {
                    _pendingAnsCandidates.push(sigObj.candidate);
                  }
                }
              }
            }
          } catch(_) {}
        }, 800);

      } catch(err) {
        console.warn('WebRTC error:', err.message);
      }
    }

    window.cortarLlamadaVoz = function() {
      detenerRingtoneLoop();
      clearInterval(_timerInterval);
      if (_sigInterval) {
        clearInterval(_sigInterval);
        _sigInterval = null;
      }

      try {
        fetch('/porteria/api/timbre-cortar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            edificio: _edificioVecino,
            depto: _deptoVecino,
            callId: _llamadaMostradaId,
            from: 'vecino'
          })
        }).catch(function(){});
      } catch(_) {}

      if (_peerConn) {
        _peerConn.close();
        _peerConn = null;
      }
      if (_localStream) {
        _localStream.getTracks().forEach(function(t){ t.stop(); });
        _localStream = null;
      }
      var remoteVideo = document.getElementById('video-webrtc-vecino');
      if (remoteVideo) remoteVideo.srcObject = null;
      var snapImg = document.getElementById('img-video-snapshot-placeholder');
      if (snapImg) snapImg.style.display = 'none';

      document.getElementById('box-timbre-sonando').style.display = 'flex';
      document.getElementById('box-llamada-voz-activa').style.display = 'none';
      document.getElementById('modal-llamada-timbre').style.display = 'none';
      _llamadaMostradaId = '';
    };

    // Polling de timbres entrantes cada 2 seg
    setInterval(async function() {
      try {
        var res = await fetch('/porteria/api/timbre-check?edificio=' + encodeURIComponent(_edificioVecino) + '&depto=' + encodeURIComponent(_deptoVecino));
        var data = await res.json();
        if (data && data.timbreActivo && data.llamada) {
          if (_llamadaMostradaId !== data.llamada.id) {
            _llamadaMostradaId = data.llamada.id;
            var visTitle = data.llamada.tipoVisita || '🛵 Visita en Puerta';
            if (data.llamada.nombreVisita) visTitle += ' (' + data.llamada.nombreVisita + ')';
            document.getElementById('llamada-timbre-visita').textContent = visTitle;

            _fotoVisitanteUltima = data.llamada.fotoVisitante || '';
            var imgFoto = document.getElementById('img-foto-visita');
            var boxFoto = document.getElementById('box-foto-visita-preview');
            var avDef = document.getElementById('avatar-timbre-default');
            if (_fotoVisitanteUltima && imgFoto && boxFoto) {
              imgFoto.src = _fotoVisitanteUltima;
              boxFoto.style.display = 'block';
              if (avDef) avDef.style.display = 'none';
            } else {
              if (boxFoto) boxFoto.style.display = 'none';
              if (avDef) avDef.style.display = 'flex';
            }

            document.getElementById('box-timbre-sonando').style.display = 'flex';
            document.getElementById('box-llamada-voz-activa').style.display = 'none';
            document.getElementById('modal-llamada-timbre').style.display = 'flex';
            iniciarRingtoneLoop();
          }
        } else {
          if (_llamadaMostradaId && !_peerConn) {
            _llamadaMostradaId = '';
            detenerRingtoneLoop();
            document.getElementById('modal-llamada-timbre').style.display = 'none';
          }
        }
      } catch(_) {}
    }, 2000);
    // ── LÓGICA DE INSTALACIÓN PWA (ANDROID & IOS) ──
    var _deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      _deferredPrompt = e;
      var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
      if (!isStandalone && !localStorage.getItem('pwa_banner_closed')) {
        var b = document.getElementById('pwa-install-banner');
        if (b) b.style.display = 'flex';
      }
    });

    window.instalarPwa = function() {
      var isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
      var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
      
      if (isStandalone) {
        alert('¡La aplicación ya está instalada en tu teléfono!');
        return;
      }

      if (isIos) {
        var m = document.getElementById('modal-pwa-ios');
        if (m) m.style.display = 'flex';
        return;
      }

      if (window._deferredPrompt) {
        window._deferredPrompt.prompt();
        window._deferredPrompt.userChoice.then(function(choice) {
          if (choice && choice.outcome === 'accepted') {
            var b = document.getElementById('pwa-install-banner');
            if (b) b.style.display = 'none';
          }
          window._deferredPrompt = null;
        });
      } else {
        var mAnd = document.getElementById('modal-pwa-android');
        if (mAnd) mAnd.style.display = 'flex';
      }
    };

    window.cerrarBannerPwa = function() {
      var b = document.getElementById('pwa-install-banner');
      if (b) b.style.display = 'none';
      localStorage.setItem('pwa_banner_closed', 'true');
    };

    window.addEventListener('appinstalled', function() {
      var b = document.getElementById('pwa-install-banner');
      if (b) b.style.display = 'none';
    });
  })();
  </script>

  <!-- MODAL GUÍA DE INSTALACIÓN IOS / SAFARI -->
  <div id="modal-pwa-ios" style="position:fixed;inset:0;background:rgba(10,31,68,.85);backdrop-filter:blur(8px);z-index:99999;display:none;align-items:flex-end;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:22px 22px 18px 18px;width:100%;max-width:480px;padding:24px 20px;text-align:center;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:fadeIn .25s ease both;color:var(--texto)">
      <div style="width:52px;height:52px;border-radius:14px;background:var(--acento-tenue);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px">
        📲
      </div>
      <h3 style="font-size:18px;font-weight:800;color:var(--marca);margin-bottom:6px">Instalar en iPhone (iOS)</h3>
      <p style="font-size:13px;color:var(--texto-suave);margin-bottom:16px;line-height:1.4">Tené la app en tu pantalla de inicio en 3 simples pasos desde Safari:</p>
      
      <div style="display:flex;flex-direction:column;gap:10px;text-align:left;background:var(--superficie-2);border:1px solid var(--borde);border-radius:14px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:#334259">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:var(--acento);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">1</span>
          <span>Tocá el botón <strong>Compartir <i class="ph ph-share-network" style="font-size:16px;vertical-align:middle;color:var(--acento)"></i></strong> en la barra inferior de Safari.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:var(--acento);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">2</span>
          <span>Deslizá hacia abajo y elegí <strong>"Agregar a inicio" <i class="ph ph-plus-square" style="font-size:16px;vertical-align:middle;color:var(--acento)"></i></strong>.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:var(--acento);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">3</span>
          <span>Tocá <strong>"Agregar"</strong> arriba a la derecha. ¡Listo!</span>
        </div>
      </div>

      <button onclick="document.getElementById('modal-pwa-ios').style.display='none'" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;font-weight:800;font-size:14.5px;cursor:pointer">¡Entendido!</button>
    </div>
  </div>

  <!-- MODAL GUÍA DE INSTALACIÓN ANDROID / CHROME -->
  <div id="modal-pwa-android" style="position:fixed;inset:0;background:rgba(10,31,68,.85);backdrop-filter:blur(8px);z-index:99999;display:none;align-items:flex-end;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:22px 22px 18px 18px;width:100%;max-width:480px;padding:24px 20px;text-align:center;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:fadeIn .25s ease both;color:var(--texto)">
      <div style="width:52px;height:52px;border-radius:14px;background:var(--acento-tenue);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px">
        📲
      </div>
      <h3 style="font-size:18px;font-weight:800;color:var(--marca);margin-bottom:6px">Instalar en Android (Chrome / Edge)</h3>
      <p style="font-size:13px;color:var(--texto-suave);margin-bottom:16px;line-height:1.4">Seguí estos 2 simples pasos en tu navegador:</p>
      
      <div style="display:flex;flex-direction:column;gap:10px;text-align:left;background:var(--superficie-2);border:1px solid var(--borde);border-radius:14px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:#334259">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:var(--acento);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">1</span>
          <span>Tocá el menú de <strong>3 puntos (⋮)</strong> arriba a la derecha en Chrome.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:var(--acento);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">2</span>
          <span>Seleccioná <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.</span>
        </div>
      </div>

      <button onclick="document.getElementById('modal-pwa-android').style.display='none'" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;font-weight:800;font-size:14.5px;cursor:pointer">¡Entendido!</button>
    </div>
  </div>

  <audio id="audio-webrtc-vecino" autoplay playsinline style="display:none"></audio>
</div>
</body>
</html>`;
}

// -------------------------------------------------------------------
// 1. LOGIN CON CREDENCIALES
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// 1. LOGIN CON WHATSAPP Y CÓDIGO PIN (OTP)
// -------------------------------------------------------------------
const _pinesLogin = new Map(); // tel -> { pin, vecino, expira }

function normalizarTelArg(t) {
  let num = String(t || '').replace(/\D/g, '');
  if (num.startsWith('0')) num = num.slice(1);
  if (num.startsWith('15')) num = '11' + num.slice(2);
  if (!num.startsWith('549') && num.startsWith('54')) num = '549' + num.slice(2);
  if (!num.startsWith('549')) num = '549' + num;
  return num;
}

router.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0F326A">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Mi Consorcio">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/admin/assets/logo.png">
<link rel="icon" type="image/png" href="/admin/assets/logo.png">
<title>Marcos IA · Portal de Vecinos</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<style>
${CSS_TOKENS}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--marca);background:linear-gradient(165deg,#070D1E 0%,var(--marca) 45%,#1B4D9B 100%);color:#fff;font-family:'Hanken Grotesk',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:#ffffff;color:var(--texto);border-radius:24px;padding:30px 22px;width:100%;max-width:420px;box-shadow:0 25px 60px rgba(0,0,0,.45)}
${CSS_FORMULARIOS}
.btn-pwa{width:100%;height:40px;border:1.5px solid var(--acento-borde);border-radius:12px;background:var(--acento-tenue);color:var(--acento);font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:14px}
.pin-box{width:100%;height:54px;border:2px solid var(--acento);border-radius:14px;font-size:26px;font-weight:900;text-align:center;letter-spacing:14px;color:var(--marca);background:var(--superficie-2);outline:none;margin-bottom:16px}
</style>
</head>
<body>
<div class="login-card">
  <div style="text-align:center;margin-bottom:18px">
    <div style="width:54px;height:54px;border-radius:18px;background:linear-gradient(135deg,var(--marca),var(--acento));display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:26px;margin-bottom:10px;box-shadow:0 8px 20px rgba(15,50,106,.25)">
      🏢
    </div>
    <h1 style="font-size:21px;font-weight:900;letter-spacing:-.02em;margin-bottom:2px;color:var(--marca)">Mi Consorcio</h1>
    <p style="font-size:12.5px;color:var(--texto-suave)">Acceso para Propietarios, Inquilinos y Gestores</p>
  </div>

  <button type="button" class="btn-pwa" onclick="instalarPwaLogin()">
    <span>📲 Instalar App en mi Celular</span>
  </button>

  <!-- PESTAÑAS: EMAIL vs WHATSAPP -->
  <div style="display:flex;background:var(--superficie-3);border-radius:12px;padding:4px;margin-bottom:16px;gap:4px">
    <button type="button" id="tab-btn-email" onclick="cambiarTabLogin('email')" style="flex:1;padding:8px 6px;border:none;border-radius:10px;font-weight:800;font-size:12.5px;cursor:pointer;background:#fff;color:var(--marca);box-shadow:0 1px 3px rgba(0,0,0,.08)">
      ✉️ Con Email
    </button>
    <button type="button" id="tab-btn-wa" onclick="cambiarTabLogin('wa')" style="flex:1;padding:8px 6px;border:none;border-radius:10px;font-weight:800;font-size:12.5px;cursor:pointer;background:transparent;color:var(--texto-suave)">
      💬 WhatsApp PIN
    </button>
  </div>

  <!-- SECCIÓN 1: LOGIN Y REGISTRO CON EMAIL -->
  <div id="seccion-email">
    <!-- Formulario Iniciar Sesión -->
    <div id="box-login-email">
      <form onsubmit="loginConEmail(event)">
        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Correo Electrónico</label>
        <input id="inp-login-email" type="email" class="inp" placeholder="ejemplo@correo.com" required value="daniel@consorcio.ai">

        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Contraseña</label>
        <input id="inp-login-pass" type="password" class="inp" placeholder="••••••••" required value="admin123">

        <button id="btn-submit-login-email" type="submit" class="btn-primary" style="margin-bottom:12px">
          <i class="ph ph-sign-in" style="font-size:20px"></i>
          <span>Ingresar con Email</span>
        </button>
      </form>

      <div style="text-align:center;margin-top:10px">
        <button type="button" onclick="mostrarRegistroEmail(true)" style="background:none;border:none;color:var(--acento);font-size:12.5px;font-weight:700;cursor:pointer">
          ¿No tenés cuenta? Registrate acá
        </button>
      </div>
    </div>

    <!-- Formulario Registro Nuevo Usuario -->
    <div id="box-registro-email" style="display:none">
      <form onsubmit="registrarConEmail(event)">
        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Nombre Completo</label>
        <input id="inp-reg-nombre" type="text" class="inp" placeholder="Ej: Juan Pérez" required>

        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Correo Electrónico</label>
        <input id="inp-reg-email" type="email" class="inp" placeholder="juan@correo.com" required>

        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Celular / WhatsApp</label>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <select id="sel-reg-prefix" class="inp" onchange="actualizarPlaceholderTel('sel-reg-prefix', 'inp-reg-tel')" style="width:125px;margin-bottom:0;padding:0 4px;font-size:11.5px;font-weight:700">
            <optgroup label="América">
              <option value="+54" selected>🇦🇷 Argentina (+54)</option>
              <option value="+598">🇺🇾 Uruguay (+598)</option>
              <option value="+56">🇨🇱 Chile (+56)</option>
              <option value="+55">🇧🇷 Brasil (+55)</option>
              <option value="+595">🇵🇾 Paraguay (+595)</option>
              <option value="+591">🇧🇴 Bolivia (+591)</option>
              <option value="+51">🇵🇪 Perú (+51)</option>
              <option value="+57">🇨🇴 Colombia (+57)</option>
              <option value="+58">🇻🇪 Venezuela (+58)</option>
              <option value="+593">🇪🇨 Ecuador (+593)</option>
              <option value="+52">🇲🇽 México (+52)</option>
              <option value="+1">🇺🇸 EE.UU. (+1)</option>
              <option value="+1">🇨🇦 Canadá (+1)</option>
            </optgroup>
            <optgroup label="Europa">
              <option value="+34">🇪🇸 España (+34)</option>
              <option value="+39">🇮🇹 Italia (+39)</option>
              <option value="+33">🇫🇷 Francia (+33)</option>
              <option value="+49">🇩🇪 Alemania (+49)</option>
              <option value="+44">🇬🇧 Reino Unido (+44)</option>
              <option value="+351">🇵🇹 Portugal (+351)</option>
              <option value="+41">🇨🇭 Suiza (+41)</option>
              <option value="+31">🇳🇱 Países Bajos (+31)</option>
              <option value="+45">🇩🇰 Dinamarca (+45)</option>
              <option value="+46">🇸🇪 Suecia (+46)</option>
              <option value="+47">🇳🇴 Noruega (+47)</option>
            </optgroup>
            <optgroup label="Asia y Oceanía">
              <option value="+86">🇨🇳 China (+86)</option>
              <option value="+81">🇯🇵 Japón (+81)</option>
              <option value="+82">🇰🇷 Corea del Sur (+82)</option>
              <option value="+61">🇦🇺 Australia (+61)</option>
              <option value="+64">🇳🇿 Nueva Zelanda (+64)</option>
              <option value="+972">🇮🇱 Israel (+972)</option>
            </optgroup>
            <optgroup label="Otros">
              <option value="">🌐 Otro (+ manual)</option>
            </optgroup>
          </select>
          <input id="inp-reg-tel" type="tel" class="inp" style="margin-bottom:0;flex-grow:1" placeholder="Ej: 11 5054 2005" required>
        </div>

        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Contraseña</label>
        <input id="inp-reg-pass" type="password" class="inp" placeholder="Mínimo 6 caracteres" required>

        <!-- Depto y Rol eliminados para registro limpio -->

        <button id="btn-submit-reg" type="submit" class="btn-primary" style="margin-bottom:10px">
          <span>Crear Cuenta e Ingresar</span>
        </button>
      </form>

      <div style="text-align:center;margin-top:6px">
        <button type="button" onclick="mostrarRegistroEmail(false)" style="background:none;border:none;color:var(--texto-suave);font-size:12.5px;font-weight:700;cursor:pointer">
          ← Ya tengo cuenta, volver
        </button>
      </div>
    </div>
  </div>

  <!-- SECCIÓN 2: LOGIN CON WHATSAPP Y PIN -->
  <div id="seccion-wa" style="display:none">
    <!-- PASO 1: INGRESAR TELÉFONO -->
    <div id="paso-1-telefono">
      <form onsubmit="solicitarPinWhatsApp(event)">
        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Número de Celular</label>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <select id="sel-wa-prefix" class="inp" onchange="actualizarPlaceholderTel('sel-wa-prefix', 'inp-login-tel')" style="width:125px;margin-bottom:0;padding:0 4px;font-size:11.5px;font-weight:700">
            <optgroup label="América">
              <option value="+54" selected>🇦🇷 Argentina (+54)</option>
              <option value="+598">🇺🇾 Uruguay (+598)</option>
              <option value="+56">🇨🇱 Chile (+56)</option>
              <option value="+55">🇧🇷 Brasil (+55)</option>
              <option value="+595">🇵🇾 Paraguay (+595)</option>
              <option value="+591">🇧🇴 Bolivia (+591)</option>
              <option value="+51">🇵🇪 Perú (+51)</option>
              <option value="+57">🇨🇴 Colombia (+57)</option>
              <option value="+58">🇻🇪 Venezuela (+58)</option>
              <option value="+593">🇪🇨 Ecuador (+593)</option>
              <option value="+52">🇲🇽 México (+52)</option>
              <option value="+1">🇺🇸 EE.UU. (+1)</option>
              <option value="+1">🇨🇦 Canadá (+1)</option>
            </optgroup>
            <optgroup label="Europa">
              <option value="+34">🇪🇸 España (+34)</option>
              <option value="+39">🇮🇹 Italia (+39)</option>
              <option value="+33">🇫🇷 Francia (+33)</option>
              <option value="+49">🇩🇪 Alemania (+49)</option>
              <option value="+44">🇬🇧 Reino Unido (+44)</option>
              <option value="+351">🇵🇹 Portugal (+351)</option>
              <option value="+41">🇨🇭 Suiza (+41)</option>
              <option value="+31">🇳🇱 Países Bajos (+31)</option>
              <option value="+45">🇩🇰 Dinamarca (+45)</option>
              <option value="+46">🇸🇪 Suecia (+46)</option>
              <option value="+47">🇳🇴 Noruega (+47)</option>
            </optgroup>
            <optgroup label="Asia y Oceanía">
              <option value="+86">🇨🇳 China (+86)</option>
              <option value="+81">🇯🇵 Japón (+81)</option>
              <option value="+82">🇰🇷 Corea del Sur (+82)</option>
              <option value="+61">🇦🇺 Australia (+61)</option>
              <option value="+64">🇳🇿 Nueva Zelanda (+64)</option>
              <option value="+972">🇮🇱 Israel (+972)</option>
            </optgroup>
            <optgroup label="Otros">
              <option value="">🌐 Otro (+ manual)</option>
            </optgroup>
          </select>
          <input id="inp-login-tel" type="tel" class="inp" style="margin-bottom:0;flex-grow:1" placeholder="Ej: 11 5054 2005" required>
        </div>

        <button id="btn-pedir-pin" type="submit" class="btn-primary" style="margin-bottom:12px">
          <i class="ph ph-whatsapp-logo" style="font-size:20px"></i>
          <span>Recibir Código por WhatsApp</span>
        </button>
      </form>
    </div>

    <!-- PASO 2: INGRESAR CÓDIGO DE 4 DÍGITOS -->
    <div id="paso-2-pin" style="display:none">
      <div style="background:var(--ok-fondo);border:1px solid var(--ok-borde);border-radius:14px;padding:12px;margin-bottom:14px;text-align:center">
        <div style="font-size:12px;color:var(--ok);font-weight:800;margin-bottom:2px">Te enviamos el código a tu WhatsApp:</div>
        <div id="txt-tel-destino" style="font-size:13.5px;font-weight:900;color:var(--ok)"></div>
        <div id="txt-pin-hint" style="font-size:11px;color:var(--ok);margin-top:4px;font-weight:700;display:none"></div>
      </div>

      <form onsubmit="verificarPinWhatsApp(event)">
        <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:8px;text-align:center">Código de 4 Dígitos</label>
        <input id="inp-login-pin" type="text" maxlength="4" class="pin-box" placeholder="••••" autofocus>

        <button id="btn-verificar-pin" type="submit" class="btn-primary" style="margin-bottom:12px">
          <i class="ph ph-lock-key-open" style="font-size:20px"></i>
          <span>Ingresar con PIN</span>
        </button>
      </form>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <button type="button" onclick="volverPaso1()" style="background:none;border:none;color:var(--texto-suave);font-size:12px;font-weight:700;cursor:pointer">
          ← Cambiar número
        </button>
        <button type="button" onclick="reenviarPinWhatsApp()" style="background:none;border:none;color:var(--acento);font-size:12px;font-weight:700;cursor:pointer">
          🔄 Reenviar código
        </button>
      </div>
    </div>
  </div>

  <div id="login-error-msg" style="display:none;margin-top:14px;padding:10px;border-radius:10px;background:var(--error-fondo);border:1px solid var(--error-borde);color:var(--error);font-size:12.5px;text-align:center"></div>

  <!-- Acceso Directo de Prueba / Demo -->
  <!-- Dos entradas, porque el portal se ve distinto según el rol: el propietario tiene dos
       unidades y ve expensas; el huésped tiene una sola, con fechas de estadía, y NO las ve. -->
  <div style="margin-top:16px;border-top:1px solid var(--superficie-3);padding-top:12px;display:flex;flex-direction:column;gap:8px">
    <form action="/vecino/auth" method="POST">
      <input type="hidden" name="rol" value="propietario">
      <button type="submit" class="btn-secondary" style="font-size:12.5px">
        <span>🚀 Entrar como Daniel Morales (Demo Propietario)</span>
      </button>
    </form>
    <form action="/vecino/auth" method="POST">
      <input type="hidden" name="rol" value="turista">
      <button type="submit" class="btn-secondary" style="font-size:12.5px">
        <span>🧳 Entrar como Huésped / Turista (Demo)</span>
      </button>
    </form>
  </div>
</div>

<script>
  var _telActual = '';

  
  function actualizarPlaceholderTel(selectId, inputId) {
    var sel = document.getElementById(selectId);
    var inp = document.getElementById(inputId);
    if (!sel || !inp) return;
    if (sel.value === '') {
      inp.placeholder = 'Ej: +45 12345678 (completo con +)';
    } else {
      inp.placeholder = 'Ej: 11 5054 2005 (sin código)';
    }
  }

  function cambiarTabLogin(tab) {
    var btnEmail = document.getElementById('tab-btn-email');
    var btnWa = document.getElementById('tab-btn-wa');
    var secEmail = document.getElementById('seccion-email');
    var secWa = document.getElementById('seccion-wa');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    if (tab === 'email') {
      btnEmail.style.background = '#fff';
      btnEmail.style.color = '#0F326A';
      btnEmail.style.boxShadow = '0 1px 3px rgba(0,0,0,.08)';
      btnWa.style.background = 'transparent';
      btnWa.style.color = '#64748B';
      btnWa.style.boxShadow = 'none';
      secEmail.style.display = 'block';
      secWa.style.display = 'none';
    } else {
      btnWa.style.background = '#fff';
      btnWa.style.color = '#0F326A';
      btnWa.style.boxShadow = '0 1px 3px rgba(0,0,0,.08)';
      btnEmail.style.background = 'transparent';
      btnEmail.style.color = '#64748B';
      btnEmail.style.boxShadow = 'none';
      secWa.style.display = 'block';
      secEmail.style.display = 'none';
    }
  }

  function mostrarRegistroEmail(mostrar) {
    document.getElementById('box-login-email').style.display = mostrar ? 'none' : 'block';
    document.getElementById('box-registro-email').style.display = mostrar ? 'block' : 'none';
    document.getElementById('login-error-msg').style.display = 'none';
  }

  async function loginConEmail(e) {
    e.preventDefault();
    var email = document.getElementById('inp-login-email').value.trim();
    var pass = document.getElementById('inp-login-pass').value;
    var btn = document.getElementById('btn-submit-login-email');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Verificando...</span>';

    try {
      var res = await fetch('/vecino/api/login-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pass })
      });
      var data = await res.json();
      if (data && data.ok) {
        window.location.href = data.redirect || '/vecino';
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-sign-in" style="font-size:20px"></i><span>Ingresar con Email</span>';
        err.style.display = 'block';
        err.textContent = data.error || 'Email o contraseña incorrectos';
      }
    } catch (ex) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-sign-in" style="font-size:20px"></i><span>Ingresar con Email</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  async function registrarConEmail(e) {
    e.preventDefault();
    var nombre = document.getElementById('inp-reg-nombre').value.trim();
    var email = document.getElementById('inp-reg-email').value.trim();
    var pass = document.getElementById('inp-reg-pass').value;
    var tel = document.getElementById('inp-reg-tel').value.trim();
    // depto y rol removidos para registro limpio
    var prefix = document.getElementById('sel-reg-prefix').value;
    if (prefix && !tel.startsWith('+')) {
      tel = prefix + ' ' + tel.replace(/^\+?549?/, '').trim();
    } else if (!prefix && !tel.startsWith('+')) {
      tel = '+' + tel.trim();
    }
    var btn = document.getElementById('btn-submit-reg');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Creando cuenta...</span>';

    try {
      var res = await fetch('/vecino/api/registro-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          email: email,
          password: pass,
          telefono: tel
        })
      });
      var data = await res.json();
      if (data && data.ok) {
        window.location.href = data.redirect || '/vecino';
      } else {
        btn.disabled = false;
        btn.innerHTML = '<span>Crear Cuenta e Ingresar</span>';
        err.style.display = 'block';
        err.textContent = data.error || 'Error al registrar la cuenta';
      }
    } catch (ex) {
      btn.disabled = false;
      btn.innerHTML = '<span>Crear Cuenta e Ingresar</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  async function solicitarPinWhatsApp(e) {
    if (e) e.preventDefault();
    var inp = document.getElementById('inp-login-tel');
    var btn = document.getElementById('btn-pedir-pin');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    var rawTel = inp.value.trim();
    if (!rawTel) {
      alert('Ingresá tu número de teléfono');
      return;
    }
    
    var prefix = document.getElementById('sel-wa-prefix').value;
    if (prefix && !rawTel.startsWith('+')) {
      rawTel = prefix + rawTel.replace(/^\+?549?/, '').trim();
    } else if (!prefix && !rawTel.startsWith('+')) {
      rawTel = '+' + rawTel.trim();
    }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Enviando código...</span>';

    try {
      var res = await fetch('/vecino/api/solicitar-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: rawTel })
      });
      var data = await res.json();
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-whatsapp-logo" style="font-size:20px"></i><span>Recibir Código por WhatsApp</span>';

      if (data && data.ok) {
        _telActual = data.telefono;
        document.getElementById('txt-tel-destino').textContent = '+' + data.telefono;
        if (data.pinDemo) {
          var hint = document.getElementById('txt-pin-hint');
          hint.textContent = '💡 Código de prueba: ' + data.pinDemo;
          hint.style.display = 'block';
        }
        document.getElementById('paso-1-telefono').style.display = 'none';
        document.getElementById('paso-2-pin').style.display = 'block';
        document.getElementById('inp-login-pin').focus();
      } else {
        err.style.display = 'block';
        err.textContent = data.error || 'No se pudo enviar el código. Verificá tu número.';
      }
    } catch(ex) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-whatsapp-logo" style="font-size:20px"></i><span>Recibir Código por WhatsApp</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  async function verificarPinWhatsApp(e) {
    if (e) e.preventDefault();
    var inp = document.getElementById('inp-login-pin');
    var btn = document.getElementById('btn-verificar-pin');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    var pin = inp.value.trim();
    if (pin.length !== 4) {
      alert('El código debe tener 4 dígitos.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Verificando...</span>';

    try {
      var res = await fetch('/vecino/api/verificar-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: _telActual, pin: pin })
      });
      var data = await res.json();
      if (data && data.ok) {
        window.location.href = data.redirect || '/vecino';
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-lock-key-open" style="font-size:20px"></i><span>Ingresar con PIN</span>';
        err.style.display = 'block';
        err.textContent = data.error || 'Código incorrecto o expirado.';
      }
    } catch(ex) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-lock-key-open" style="font-size:20px"></i><span>Ingresar con PIN</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  function volverPaso1() {
    document.getElementById('paso-2-pin').style.display = 'none';
    document.getElementById('paso-1-telefono').style.display = 'block';
    document.getElementById('login-error-msg').style.display = 'none';
  }

  function reenviarPinWhatsApp() {
    solicitarPinWhatsApp(null);
  }

  function instalarPwaLogin() {
    alert('Para instalar la app, tocá el menú de tu navegador y seleccioná "Agregar a la pantalla principal" o "Instalar".');
  }
</script>
</body>
</html>`);
});

// API LOGIN CON EMAIL Y CONTRASEÑA
router.post('/api/login-email', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y contraseña son requeridos' });
    }

    const { obtenerUsuarioPorEmail, verificarPassword, obtenerUnidadesDeUsuario } = require('./db-pg');
    const u = await obtenerUsuarioPorEmail(email);
    if (!u) {
      return res.status(400).json({ ok: false, error: 'No existe ninguna cuenta registrada con este email' });
    }

    if (!u.password_hash || !verificarPassword(password, u.password_hash)) {
      return res.status(400).json({ ok: false, error: 'Contraseña incorrecta' });
    }

    const unidades = await obtenerUnidadesDeUsuario(u.id);
    const uActiva = unidades.length > 0 ? unidades[0] : {
      edificio: 'San Patricio 159',
      departamento: '1° A',
      rol: 'propietario',
      puede_ver_expensas: true,
      timbre_activo: true
    };

    if (req.session) {
      req.session.vecino = {
        usuario_id: u.id,
        nombre: u.nombre || 'Vecino',
        apellido: u.apellido || '',
        email: u.email,
        idioma: normalizarIdioma(u.idioma),
        telefono: u.telefono || '',
        edificio: uActiva.edificio,
        departamento: uActiva.departamento,
        rol: uActiva.rol || 'propietario',
        puede_ver_expensas: uActiva.puede_ver_expensas !== false,
        timbre_activo: uActiva.timbre_activo !== false,
        timbre_silencio_desde: uActiva.timbre_silencio_desde || '23:00',
        timbre_silencio_hasta: uActiva.timbre_silencio_hasta || '07:30',
        unidades: unidades.length > 0 ? unidades : [uActiva]
      };
    }

    res.json({ ok: true, redirect: '/vecino' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API REGISTRO NUEVO USUARIO CON EMAIL
router.post('/api/registro-email', async (req, res) => {
  try {
    const { email, password, nombre, apellido, telefono, edificio, departamento, rol } = req.body || {};
    if (!email || !password || !nombre) {
      return res.status(400).json({ ok: false, error: 'Email, contraseña y nombre son requeridos' });
    }

    const { registrarOUsuario, asignarUsuarioAUnidad, obtenerUnidadesDeUsuario } = require('./db-pg');
    const u = await registrarOUsuario(email, password, nombre, apellido || '', telefono || '');

    // Registro limpio sin asignar unidades (se asignan desde adentro)
    const unidades = [];
    if (req.session) {
      req.session.vecino = {
        usuario_id: u.id,
        nombre: u.nombre,
        apellido: u.apellido,
        email: u.email,
        telefono: u.telefono,
        idioma: idiomaDelNavegador(req.headers['accept-language']),
        edificio: '',
        departamento: '',
        rol: 'registrado',
        puede_ver_expensas: false,
        timbre_activo: true,
        unidades: unidades
      };
    }

    res.json({ ok: true, redirect: '/vecino' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API CAMBIAR UNIDAD ACTIVA (SELECTOR MULTI-PROPIEDAD)
router.post('/api/cambiar-unidad', async (req, res) => {
  try {
    const { edificio, departamento } = req.body || {};
    if (!edificio || !departamento) return res.status(400).json({ ok: false, error: 'Faltan datos de la unidad' });

    if (req.session && req.session.vecino) {
      const v = req.session.vecino;
      const uEncontrada = (v.unidades || []).find(u => 
        u.edificio.toLowerCase() === edificio.toLowerCase() &&
        u.departamento.toLowerCase() === departamento.toLowerCase()
      );

      v.edificio = edificio;
      v.departamento = departamento;
      if (uEncontrada) {
        v.rol = uEncontrada.rol || 'propietario';
        v.puede_ver_expensas = uEncontrada.puede_ver_expensas !== false;
        v.timbre_activo = uEncontrada.timbre_activo !== false;
        v.timbre_silencio_desde = uEncontrada.timbre_silencio_desde || '23:00';
        v.timbre_silencio_hasta = uEncontrada.timbre_silencio_hasta || '07:30';
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------------
// MI PERFIL / USUARIO
// -------------------------------------------------------------------
// Lo que el vecino puede ver y cambiar de sí mismo: nombre, teléfono, sus unidades (con cuál está
// mirando ahora) y la contraseña. El email queda a la vista pero NO se edita: es la llave con la
// que el titular lo da de alta en el departamento, así que cambiarlo acá lo dejaría afuera de su
// propia unidad sin que nadie se entere.
router.get('/perfil', (req, res) => {
  const v = getVecinoSession(req);
  const t = textos(v.idioma);
  const unidades = v.unidades || [];
  const rol = etiquetaRol(v.rol);

  // Las fechas de la estadía viven en la UNIDAD, no en la sesión: `obtenerUnidadesDeUsuario` las
  // devuelve por fila de `usuario_unidades`, y `/api/login-email` arma la sesión sin copiarlas
  // arriba. Leerlas solo de `v` le mostraba "—" a todo huésped que entró con su cuenta de verdad;
  // andaba nada más con la sesión de demo, que sí las lleva sueltas. `/api/cambiar-unidad` tampoco
  // las actualiza al cambiar de departamento, así que la unidad activa es la única fuente sana.
  const unidadActiva = unidades.find(u =>
    String(u.edificio || '').toLowerCase() === String(v.edificio || '').toLowerCase() &&
    String(u.departamento || '').toLowerCase() === String(v.departamento || '').toLowerCase()
  ) || {};
  const estadiaDesde = unidadActiva.fecha_desde || v.fecha_desde || '';
  const estadiaHasta = unidadActiva.fecha_hasta || v.fecha_hasta || '';
  const esDemo = v.demo === true || !req.session || !req.session.vecino;

  const filaUnidad = (u) => {
    const activa = String(u.edificio || '').toLowerCase() === String(v.edificio || '').toLowerCase()
                && String(u.departamento || '').toLowerCase() === String(v.departamento || '').toLowerCase();
    const fechas = (u.fecha_desde && u.fecha_hasta)
      ? `<div style="font-size:11px;color:var(--aviso);margin-top:3px">🗓️ Del ${esc(String(u.fecha_desde).slice(0, 10))} al ${esc(String(u.fecha_hasta).slice(0, 10))}</div>`
      : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:14px;border:2px solid ${activa ? '#2E6FC0' : '#E2E8F0'};background:${activa ? '#EFF6FF' : '#F8FAFD'}">
        <div style="min-width:0">
          <div style="font-size:13.5px;font-weight:900;color:var(--texto)">${esc(u.edificio)} · ${esc(u.departamento)}</div>
          <div style="display:inline-flex;align-items:center;gap:6px;margin-top:4px">
            ${etiquetaRolHtml(u.rol, t)}
            ${u.puede_ver_expensas === false ? `<span style="font-size:10.5px;color:var(--texto-suave)">· ${esc(t('perfil.sinExpensas'))}</span>` : ''}
          </div>
          ${fechas}
        </div>
        ${activa
          ? `<span style="font-size:11px;font-weight:900;color:var(--acento);flex-shrink:0">● ${esc(t('perfil.viendo'))}</span>`
          : `<button type="button" onclick="usarUnidad('${escJs(u.edificio)}', '${escJs(u.departamento)}')" style="flex-shrink:0;border:none;background:var(--marca);color:#fff;font-size:11.5px;font-weight:800;padding:7px 12px;border-radius:10px;cursor:pointer">${esc(t('perfil.usarEsta'))}</button>`}
      </div>`;
  };

  const bloqueUnidades = unidades.length === 0 ? `
    <div style="padding:14px;border-radius:14px;background:var(--aviso-fondo);border:1px solid var(--aviso-borde);font-size:12.5px;color:var(--aviso);line-height:1.5">
      Todavía no tenés ninguna unidad vinculada. Pedile al titular del departamento (o a la
      administración) que te habilite con tu email <strong>${esc(v.email || '')}</strong> desde la
      pestaña Integrantes.
    </div>` : unidades.map(filaUnidad).join('');

  const bloqueEstadia = (v.rol === 'turista' && (v.pase_demo || estadiaHasta)) ? `
    <div class="card" style="padding:16px;background:#fff;border-radius:18px;margin-bottom:14px">
      <div style="font-size:13.5px;font-weight:900;color:var(--texto);margin-bottom:10px"><i class="ph ph-suitcase-simple" style="font-size:15px"></i> ${esc(t('perfil.estadia'))}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:${v.pase_demo ? '12px' : '0'}">
        <div style="flex:1;min-width:120px;background:var(--superficie-2);border:1px solid var(--borde);border-radius:12px;padding:10px 12px">
          <div style="font-size:10.5px;font-weight:800;color:var(--texto-suave);text-transform:uppercase;letter-spacing:.04em">${esc(t('perfil.desde'))}</div>
          <div style="font-size:14px;font-weight:900;color:var(--texto)">${esc(String(estadiaDesde || '—').slice(0, 10))}</div>
        </div>
        <div style="flex:1;min-width:120px;background:var(--superficie-2);border:1px solid var(--borde);border-radius:12px;padding:10px 12px">
          <div style="font-size:10.5px;font-weight:800;color:var(--texto-suave);text-transform:uppercase;letter-spacing:.04em">${esc(t('perfil.hasta'))}</div>
          <div style="font-size:14px;font-weight:900;color:var(--texto)">${esc(String(estadiaHasta || '—').slice(0, 10))}</div>
        </div>
      </div>
      ${v.pase_demo ? `
      <div style="background:var(--aviso-fondo);border:1px solid var(--aviso-borde);border-radius:12px;padding:12px 14px">
        <div style="font-size:11px;font-weight:800;color:var(--aviso);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${esc(t('perfil.pase'))}</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:900;color:var(--texto);letter-spacing:.05em">${esc(v.pase_demo.codigo)}</div>
        <div style="font-size:11.5px;color:var(--aviso);margin-top:4px">Vence el ${esc(String(v.pase_demo.vence || '').slice(0, 10))} · mostralo en el tótem de la entrada</div>
      </div>` : ''}
    </div>` : '';

  const content = `
    <div style="margin-bottom:16px">
      <h1 style="font-size:20px;font-weight:900;color:var(--texto);letter-spacing:-.02em">${esc(t('perfil.titulo'))}</h1>
      <p style="font-size:12.5px;color:var(--texto-suave)">${esc(t('perfil.bajada'))}</p>
    </div>

    <!-- IDENTIDAD -->
    <div class="card" style="padding:18px 16px;background:#fff;border-radius:18px;margin-bottom:14px;display:flex;align-items:center;gap:14px">
      <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;flex-shrink:0">${iniciales(v)}</div>
      <div style="min-width:0">
        <div style="font-size:16.5px;font-weight:900;color:var(--texto);letter-spacing:-.01em">${esc(nombreCompleto(v))}</div>
        <div style="font-size:12px;color:var(--texto-suave);word-break:break-all">${esc(v.email || 'Sin email registrado')}</div>
        <div style="margin-top:5px">${etiquetaRolHtml(v.rol, t)}</div>
      </div>
    </div>

    ${esDemo ? `
    <div style="padding:11px 13px;border-radius:12px;background:var(--aviso-fondo);border:1px solid var(--aviso-borde);font-size:12px;color:var(--aviso);margin-bottom:14px;line-height:1.45">
      ${esc(t('perfil.demo'))}</div>` : ''}

    <!-- MIS DATOS -->
    <div class="card" style="padding:16px;background:#fff;border-radius:18px;margin-bottom:14px">
      <div style="font-size:13.5px;font-weight:900;color:var(--texto);margin-bottom:12px">${esc(t('perfil.datos'))}</div>
      <form onsubmit="guardarPerfil(event)">
        <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">${esc(t('perfil.nombre'))}</label>
        <input type="text" id="perfil-nombre" class="inp" value="${esc(v.nombre || '')}" placeholder="Tu nombre" required>

        <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">${esc(t('perfil.apellido'))}</label>
        <input type="text" id="perfil-apellido" class="inp" value="${esc(v.apellido || '')}" placeholder="Tu apellido">

        <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">${esc(t('perfil.telefono'))}</label>
        <input type="tel" id="perfil-telefono" class="inp" value="${esc(v.telefono || '')}" placeholder="Ej: +54 9 11 5054 2005">

        <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">${esc(t('perfil.email'))}</label>
        <input type="email" class="inp" value="${esc(v.email || '')}" disabled style="background:var(--superficie-3);color:var(--texto-suave);margin-bottom:6px">
        <div style="font-size:11.5px;color:var(--texto-suave);line-height:1.45;margin-bottom:12px">
          El email es con el que el titular te vincula a la unidad. Para cambiarlo, escribinos por
          <a href="/vecino/chat" style="color:var(--acento);font-weight:700;text-decoration:none">Marcos IA</a>.
        </div>

        <div id="perfil-msg" style="display:none;margin-bottom:10px;padding:9px 11px;border-radius:10px;font-size:12.5px"></div>
        <button type="submit" class="btn-primary" style="height:44px;font-size:14px">${esc(t('perfil.guardar'))}</button>
      </form>
    </div>

    <!-- IDIOMA -->
    <!-- Además del globo de la cabecera. Es el mismo endpoint: acá se viene a buscarlo,
         arriba está para el que no entiende nada de lo que dice la pantalla y necesita
         salir de ahí sin leer. -->
    <div class="card" style="padding:16px;background:var(--superficie);border-radius:18px;margin-bottom:14px">
      <div style="font-size:13.5px;font-weight:900;color:var(--texto);margin-bottom:4px">${esc(t('perfil.idioma'))}</div>
      <div style="font-size:11.5px;color:var(--texto-suave);margin-bottom:12px">${esc(t('perfil.idiomaNota'))}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
        ${IDIOMAS.map(i => `
        <button type="button" onclick="elegirIdioma('${i.codigo}')" style="display:flex;align-items:center;gap:8px;padding:11px 12px;border-radius:12px;border:1.5px solid ${i.codigo === t.idioma ? 'var(--acento)' : 'var(--borde)'};background:${i.codigo === t.idioma ? 'var(--acento-tenue)' : 'var(--superficie-2)'};color:var(--texto);font-size:13px;font-weight:${i.codigo === t.idioma ? '800' : '600'};cursor:pointer;font-family:inherit;text-align:left">
          <span style="font-size:16px">${i.bandera}</span>
          <span>${i.nombre}</span>
          ${i.codigo === t.idioma ? '<i class="ph ph-check-circle" style="margin-left:auto;font-size:15px;color:var(--acento)"></i>' : ''}
        </button>`).join('')}
      </div>
    </div>

    ${bloqueEstadia}

    <!-- MIS UNIDADES -->
    <div class="card" style="padding:16px;background:#fff;border-radius:18px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:13.5px;font-weight:900;color:var(--texto)">${esc(t('perfil.unidades'))}</div>
        <span style="font-size:11.5px;color:var(--texto-suave)">${unidades.length}</span>
      </div>
      <div style="font-size:11.5px;color:var(--texto-suave);margin-bottom:12px">${esc(t('perfil.unidadesNota'))}</div>
      <div style="display:flex;flex-direction:column;gap:10px">${bloqueUnidades}</div>
    </div>

    <!-- ACCESO -->
    <div class="card" style="padding:16px;background:#fff;border-radius:18px;margin-bottom:14px">
      <div style="font-size:13.5px;font-weight:900;color:var(--texto);margin-bottom:4px">${esc(t('perfil.acceso'))}</div>
      <div style="font-size:11.5px;color:var(--texto-suave);margin-bottom:12px">${esc(t('perfil.accesoNota'))}</div>
      <form onsubmit="cambiarPassword(event)">
        <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">${esc(t('perfil.passActual'))}</label>
        <input type="password" id="pass-actual" class="inp" placeholder="${esc(t('perfil.passActualPlaceholder'))}" autocomplete="current-password">

        <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">${esc(t('perfil.passNueva'))}</label>
        <input type="password" id="pass-nueva" class="inp" placeholder="${esc(t('perfil.passNuevaPlaceholder'))}" autocomplete="new-password" required>

        <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">${esc(t('perfil.passRepetir'))}</label>
        <input type="password" id="pass-repetir" class="inp" placeholder="${esc(t('perfil.passRepetirPlaceholder'))}" autocomplete="new-password" required>

        <div id="pass-msg" style="display:none;margin-bottom:10px;padding:9px 11px;border-radius:10px;font-size:12.5px"></div>
        <button type="submit" class="btn-secondary" style="height:44px"><i class="ph ph-lock-key" style="font-size:16px"></i> ${esc(t('perfil.cambiarPass'))}</button>
      </form>
    </div>

    <a href="/vecino/logout" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;border-radius:14px;border:1.5px solid var(--error-borde);background:var(--error-fondo);color:var(--error);font-size:13.5px;font-weight:800;text-decoration:none;margin-bottom:10px">
      <i class="ph ph-sign-out" style="font-size:18px"></i> ${esc(t('perfil.salir'))}
    </a>

    <script>
      function mostrarMsg(id, texto, ok) {
        var box = document.getElementById(id);
        if (!box) return;
        box.style.display = 'block';
        box.textContent = texto;
        box.style.background = ok ? '#DCFCE7' : '#FEE2E2';
        box.style.border = '1px solid ' + (ok ? '#86EFAC' : '#FCA5A5');
        box.style.color = ok ? '#166534' : '#991B1B';
      }

      async function guardarPerfil(ev) {
        ev.preventDefault();
        var btn = ev.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          var res = await fetch('/vecino/api/perfil', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre: document.getElementById('perfil-nombre').value,
              apellido: document.getElementById('perfil-apellido').value,
              telefono: document.getElementById('perfil-telefono').value
            })
          });
          var data = await res.json();
          if (data.ok) {
            mostrarMsg('perfil-msg', '✅ Datos guardados.', true);
            setTimeout(function(){ location.reload(); }, 800);
          } else {
            mostrarMsg('perfil-msg', '❌ ' + (data.error || 'No se pudo guardar.'), false);
          }
        } catch (e) {
          mostrarMsg('perfil-msg', '❌ ' + e.message, false);
        }
        btn.disabled = false;
      }

      async function cambiarPassword(ev) {
        ev.preventDefault();
        var nueva = document.getElementById('pass-nueva').value;
        if (nueva !== document.getElementById('pass-repetir').value) {
          mostrarMsg('pass-msg', '❌ Las dos contraseñas nuevas no son iguales.', false);
          return;
        }
        var btn = ev.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          var res = await fetch('/vecino/api/cambiar-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actual: document.getElementById('pass-actual').value,
              nueva: nueva
            })
          });
          var data = await res.json();
          if (data.ok) {
            mostrarMsg('pass-msg', '✅ Contraseña actualizada.', true);
            ev.target.reset();
          } else {
            mostrarMsg('pass-msg', '❌ ' + (data.error || 'No se pudo cambiar.'), false);
          }
        } catch (e) {
          mostrarMsg('pass-msg', '❌ ' + e.message, false);
        }
        btn.disabled = false;
      }

      async function usarUnidad(edificio, departamento) {
        try {
          var res = await fetch('/vecino/api/cambiar-unidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edificio: edificio, departamento: departamento })
          });
          var data = await res.json();
          if (data.ok) location.reload();
          else alert(data.error || 'No se pudo cambiar de unidad.');
        } catch (e) {
          alert(e.message);
        }
      }
    </script>
  `;

  res.send(shellVecino('Mi Perfil', 'perfil', content, v));
});

// Guarda nombre / apellido / teléfono. Escribe en la base cuando la sesión es de un usuario real;
// la sesión de prueba no tiene fila que actualizar y se queda solo con el cambio en pantalla.
router.post('/api/perfil', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { nombre, apellido, telefono } = req.body || {};
    if (!String(nombre || '').trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre no puede quedar vacío' });
    }

    const enSesion = !!(req.session && req.session.vecino);
    if (enSesion && v.usuario_id && !v.demo) {
      const { actualizarPerfilUsuario } = require('./db-pg');
      const u = await actualizarPerfilUsuario(v.usuario_id, { nombre, apellido, telefono });
      // Lo que quedó en la base es lo que tiene que mostrar la pantalla, no lo que se tipeó:
      // si un campo llegó vacío la base conservó el anterior y la sesión tiene que seguirlo.
      req.session.vecino.nombre = u.nombre;
      req.session.vecino.apellido = u.apellido;
      req.session.vecino.telefono = u.telefono;
      return res.json({ ok: true, usuario: u });
    }

    if (enSesion) {
      req.session.vecino.nombre = String(nombre).trim();
      req.session.vecino.apellido = String(apellido || '').trim();
      req.session.vecino.telefono = String(telefono || '').trim();
    }
    res.json({ ok: true, demo: true });
  } catch (err) {
    console.error('Error en /vecino/api/perfil:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// El idioma del portal. Lo cambia el propio vecino y nadie más.
//
// El rol (propietario / inquilino / huésped / gestor) se lo asigna otro, porque es una relación
// con un departamento. El idioma no: es de la persona. Cada uno se registra con su cuenta, elige
// en qué idioma lee, y eso lo acompaña a todas las unidades donde lo asignen.
//
// Se guarda en la sesión siempre, y en la base cuando hay una cuenta detrás. Así el que todavía
// no se registró igual puede leer el portal mientras se registra.
router.post('/api/idioma', async (req, res) => {
  try {
    const { idioma } = req.body || {};
    const codigo = normalizarIdioma(idioma);

    if (req.session && req.session.vecino) {
      req.session.vecino.idioma = codigo;
      const v = req.session.vecino;
      if (v.usuario_id && !v.demo) {
        const { actualizarPerfilUsuario } = require('./db-pg');
        await actualizarPerfilUsuario(v.usuario_id, { idioma: codigo });
      }
    }
    res.json({ ok: true, idioma: codigo });
  } catch (err) {
    console.error('Error en /vecino/api/idioma:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Cambio de contraseña. La verificación de la actual la hace `cambiarPasswordUsuario` contra el
// hash guardado — acá no se compara nada a mano.
router.post('/api/cambiar-password', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { actual, nueva } = req.body || {};

    // La sesión de prueba lleva el `usuario_id` de la fila semilla: si no se la excluyera, el
    // botón de demo dejaría cambiarle la contraseña a un usuario real.
    if (!req.session || !req.session.vecino || !v.usuario_id || v.demo) {
      return res.status(403).json({ ok: false, error: 'Entrá con tu cuenta para cambiar la contraseña' });
    }

    const { cambiarPasswordUsuario } = require('./db-pg');
    const r = await cambiarPasswordUsuario(v.usuario_id, actual, nueva);
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /vecino/api/cambiar-password:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API SOLICITAR PIN DE ACCESO (WHATSAPP)
router.post('/api/solicitar-pin', async (req, res) => {
  const { telefono } = req.body || {};
  if (!telefono || !String(telefono).trim()) {
    return res.status(400).json({ ok: false, error: 'El número de teléfono es requerido.' });
  }

  const telNorm = normalizarTelArg(telefono);
  let vecinoEncontrado = null;

  // 1. Buscar en PostgreSQL o datos locales
  if (datosPg && typeof datosPg.buscarVecinosPorTelefono === 'function') {
    try {
      const lista = await datosPg.buscarVecinosPorTelefono(telNorm);
      if (lista && lista.length > 0) {
        vecinoEncontrado = lista[0];
      }
    } catch (_) {}
  }

  // 2. Fallback de búsqueda en tabla 'vecinos'
  if (!vecinoEncontrado) {
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        const q = `SELECT * FROM vecinos WHERE REPLACE(REPLACE(REPLACE(telefono, ' ', ''), '-', ''), '+', '') LIKE $1 LIMIT 1`;
        const r = await pool.query(q, ['%' + telNorm.slice(-8) + '%']);
        if (r && r.rows && r.rows.length > 0) {
          const row = r.rows[0];
          vecinoEncontrado = {
            nombre: row.nombre || 'Vecino',
            telefono: row.telefono || telNorm,
            edificio: row.edificio || 'San Patricio 159',
            departamento: row.departamento || '1° A'
          };
        }
      }
    } catch (_) {}
  }

  // 3. Si es el teléfono de Daniel o modo desarrollo
  if (!vecinoEncontrado && (telNorm.includes('50542005') || telNorm.includes('1150542005') || telNorm.includes('5491150542005'))) {
    vecinoEncontrado = {
      nombre: 'Daniel Morales',
      telefono: '+5491150542005',
      edificio: 'San Patricio 159',
      departamento: '1° A'
    };
  }

  if (!vecinoEncontrado) {
    vecinoEncontrado = {
      nombre: 'Vecino',
      telefono: '+' + telNorm,
      edificio: 'San Patricio 159',
      departamento: '1° A'
    };
  }

  // Generar PIN de 4 dígitos
  const pin = Math.floor(1000 + Math.random() * 9000).toString();
  _pinesLogin.set(telNorm, {
    pin,
    vecino: vecinoEncontrado,
    expira: Date.now() + 10 * 60 * 1000
  });

  console.log(`🔑 [LOGIN OTP] PIN para ${vecinoEncontrado.nombre} (${telNorm}): ${pin}`);

  // Enviar mensaje por WhatsApp vía Meta API si está disponible
  try {
    const marcosOps = require('./agentes/marcos-ops');
    if (marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
      const phoneId = process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
      const token = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
      const textoMsg = `🏢 *Portal del Vecino — Código de Acceso*\n\nHola *${vecinoEncontrado.nombre}*, tu código para ingresar es:\n\n🔑 *${pin}*\n\n(Válido por 10 minutos. No lo compartas).`;
      await marcosOps.enviarWhatsApp('+' + telNorm, textoMsg, phoneId, token).catch(() => {});
    }
  } catch (_) {}

  res.json({
    ok: true,
    mensaje: 'Código enviado por WhatsApp',
    telefono: telNorm,
    pinDemo: pin
  });
});

// API VERIFICAR PIN DE ACCESO
router.post('/api/verificar-pin', async (req, res) => {
  const { telefono, pin } = req.body || {};
  if (!telefono || !pin) {
    return res.status(400).json({ ok: false, error: 'Teléfono y PIN son requeridos.' });
  }

  const telNorm = normalizarTelArg(telefono);
  const dataPin = _pinesLogin.get(telNorm);

  if (!dataPin) {
    return res.status(400).json({ ok: false, error: 'No hay ningún código pendiente para este número. Solicitá uno nuevo.' });
  }

  if (Date.now() > dataPin.expira) {
    _pinesLogin.delete(telNorm);
    return res.status(400).json({ ok: false, error: 'El código expiró. Solicitá uno nuevo.' });
  }

  if (dataPin.pin !== String(pin).trim()) {
    return res.status(400).json({ ok: false, error: 'Código incorrecto. Revisá el mensaje en WhatsApp.' });
  }

  // Cargar unidades del usuario desde DB si existen
  let unidades = [];
  try {
    const { pool, obtenerUnidadesDeUsuario } = require('./db-pg');
    if (pool) {
      const resU = await pool.query('SELECT id, email, nombre FROM usuarios WHERE REPLACE(REPLACE(REPLACE(telefono, " ", ""), "-", ""), "+", "") LIKE $1 LIMIT 1', ['%' + telNorm.slice(-8) + '%']);
      if (resU && resU.rows && resU.rows[0]) {
        unidades = await obtenerUnidadesDeUsuario(resU.rows[0].id);
      }
    }
  } catch (_) {}

  if (!unidades.length) {
    unidades = [
      { edificio: dataPin.vecino.edificio || 'San Patricio 159', departamento: dataPin.vecino.departamento || '1° A', rol: 'propietario', puede_ver_expensas: true }
    ];
  }

  // Autenticación Exitosa: Guardar en sesión
  if (req.session) {
    req.session.vecino = {
      nombre: dataPin.vecino.nombre,
      telefono: dataPin.vecino.telefono,
      email: dataPin.vecino.email || (telNorm + '@vecino.consorcio.ai'),
      edificio: unidades[0].edificio,
      departamento: unidades[0].departamento,
      rol: unidades[0].rol || 'propietario',
      puede_ver_expensas: unidades[0].puede_ver_expensas !== false,
      timbre_activo: true,
      timbre_silencio_desde: '23:00',
      timbre_silencio_hasta: '07:30',
      unidades: unidades
    };
  }

  _pinesLogin.delete(telNorm);
  res.json({ ok: true, redirect: '/vecino' });
});

// LOGOUT
router.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.redirect('/vecino/login');
    });
  } else {
    res.redirect('/vecino/login');
  }
});

// Entrada de prueba, sin contraseña. `rol` elige a quién se entra: propietario (el default, con
// dos unidades y expensas a la vista) o turista (una unidad, con fechas de estadía y sin expensas).
//
// La sesión la arma `sesion-demo.js` ENTERA. Antes se escribía acá a mano y le faltaba `unidades`:
// `/vecino` chequea `if (!v.unidades || v.unidades.length === 0)` y mandaba a la pantalla de
// "Cuenta Creada — todavía no tenés ningún departamento asignado", con el edificio y el depto
// escritos justo arriba.
router.post('/auth', async (req, res) => {
  const { identificador, rol } = req.body || {};
  const limpio = String(identificador || '').trim();
  const telLimpio = limpio.replace(/\D/g, '');

  if (req.session) {
    req.session.vecino = sesionDemoVecino(rol === 'turista' ? 'turista' : 'propietario', telLimpio);
  }
  res.redirect('/vecino');
});

// Un importe como lo escribe cualquiera en Argentina: $120.000,00
//
// A mano y no con `toLocaleString`, por el mismo ICU reducido del VPS que obligó a escribir
// `fecha.js`: ahí `toLocaleString('es-AR')` devuelve el formato de Estados Unidos y el vecino lee
// "$120,000.00", que en un importe cambia lo que entiende.
function montoEnPesos(n) {
  const num = Number(n);
  if (!isFinite(num)) return '';
  const [entera, dec] = Math.abs(num).toFixed(2).split('.');
  const conPuntos = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${num < 0 ? '-' : ''}$${conPuntos},${dec}`;
}

// LO QUE EL EDIFICIO TIENE PARA DECIR HOY
//
// Junta las dos fuentes y las devuelve ordenadas por autoridad: primero lo que alguien del
// edificio anunció, después lo que está reportado y sin resolver.
//
// Nunca inventa un "todo funciona". Si las dos vienen vacías devuelve una lista vacía y la pantalla
// no muestra la sección — que es lo correcto: no saber no es lo mismo que estar bien.
//
// Un fallo de base NO tira la pantalla abajo: se loguea y se devuelve vacío. El vecino entra al
// portal para abrir la puerta o reservar la parrilla; perder eso por un aviso que no se pudo leer
// sería el peor cambio posible.
async function avisosDelEdificio(edificio) {
  if (!edificio) return [];
  const salida = [];

  try {
    const { avisosVigentesDeEdificio } = require('./db-pg');
    for (const a of await avisosVigentesDeEdificio(edificio)) {
      salida.push({
        clase: 'aviso',
        titulo: a.titulo || a.texto,
        texto: a.titulo ? a.texto : '',
        tipo: a.tipo || 'otro',
        urgente: !!a.urgente,
        hasta: a.hasta,
        porQuien: a.publicado_por,
        rol: a.publicado_rol,
      });
    }
  } catch (err) {
    console.warn('Avisos del edificio:', err.message);
  }

  try {
    const { pool } = require('./db-pg');
    // Un caso abierto es uno que nadie dio por resuelto ni cerrado. Se miran los últimos 30 días:
    // un reclamo de hace tres meses que quedó sin cerrar es basura de datos, no una novedad.
    const q = `SELECT codigo_caso, problema, rubro_tecnico, fecha, estado
                 FROM reportes
                WHERE LOWER(TRIM(edificio)) = LOWER(TRIM($1))
                  AND COALESCE(LOWER(estado), '') NOT IN ('resuelto', 'cerrado')
                  AND COALESCE(LOWER(tipo), '') <> 'reserva'
                  AND created_at > NOW() - INTERVAL '30 days'
                ORDER BY created_at DESC LIMIT 5`;
    const r = await pool.query(q, [edificio]);
    for (const c of (r.rows || [])) {
      salida.push({
        clase: 'reclamo',
        titulo: c.rubro_tecnico || 'Reclamo del edificio',
        texto: c.problema || '',
        caso: c.codigo_caso,
        fecha: c.fecha,
      });
    }
  } catch (err) {
    console.warn('Reclamos abiertos del edificio:', err.message);
  }

  return salida;
}

// El bloque, ya con los datos resueltos.
//
// Un aviso y un reclamo se ven distinto a propósito: el primero es el consorcio hablando, el
// segundo es algo reportado que todavía nadie resolvió. Mezclarlos le daría al reclamo una
// autoridad que no tiene.
function bloqueAvisosHtml(avisos, v, t) {
  const fila = (a) => {
    if (a.clase === 'aviso') {
      const hasta = a.hasta
        ? `<span style="font-size:11.5px;color:var(--aviso);font-weight:700">· ${esc(t('avisos.hasta', { fecha: new Date(a.hasta).toLocaleDateString('es-AR') }))}</span>`
        : `<span style="font-size:11.5px;color:var(--aviso);font-weight:700">· ${esc(t('avisos.sinFecha'))}</span>`;
      return `
      <div style="padding:12px 14px;border-radius:14px;background:var(--aviso-fondo);border:1px solid var(--aviso-borde)">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;flex-wrap:wrap">
          <i class="ph ph-warning-circle" style="font-size:15px;color:var(--aviso)"></i>
          <span style="font-size:13.5px;font-weight:900;color:var(--aviso)">${esc(a.titulo || '')}</span>
          ${hasta}
        </div>
        ${a.texto ? `<div style="font-size:12.5px;color:var(--texto-medio);line-height:1.45">${esc(a.texto)}</div>` : ''}
        ${a.porQuien ? `<div style="font-size:11px;color:var(--texto-tenue);margin-top:5px">${esc(t('avisos.publicadoPor', { quien: a.porQuien, rol: a.rol || '' }))}</div>` : ''}
      </div>`;
    }
    // Un reclamo: se dice que está abierto y desde cuándo. Nada más.
    return `
      <div style="padding:12px 14px;border-radius:14px;background:var(--superficie-2);border:1px solid var(--borde)">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">
          <i class="ph ph-wrench" style="font-size:15px;color:var(--texto-suave)"></i>
          <span style="font-size:13.5px;font-weight:800;color:var(--texto)">${esc(a.titulo)}</span>
        </div>
        <div style="font-size:12px;color:var(--texto-suave)">${esc(t('avisos.reclamoAbierto'))}${a.fecha ? ' · ' + esc(String(a.fecha).slice(0, 10)) : ''}</div>
      </div>`;
  };

  return `
    <div class="card" style="padding:16px;background:var(--superficie);margin-bottom:14px;border-radius:18px">
      <div style="font-size:12.5px;font-weight:800;color:var(--texto-suave);text-transform:uppercase;letter-spacing:.04em;margin-bottom:11px">${esc(t('avisos.titulo', { edificio: v.edificio }))}</div>
      <div style="display:flex;flex-direction:column;gap:9px">${avisos.map(fila).join('')}</div>
    </div>`;
}

// -------------------------------------------------------------------
// 2. INICIO / DASHBOARD DEL VECINO
// -------------------------------------------------------------------
router.get('/', async (req, res) => {
  const v = getVecinoSession(req);
  const t = textos(v.idioma);

  // Lo que el edificio tiene para decirle HOY a este vecino. Dos fuentes, distinta autoridad:
  //
  //   1. Un AVISO publicado por alguien del edificio (administrador, encargado, consejo,
  //      proveedor). Es un hecho del consorcio: "el ascensor está suspendido hasta el jueves".
  //   2. Un RECLAMO abierto de `reportes`. Eso NO es "está fuera de servicio" -- es "alguien
  //      reportó algo y todavía está abierto". Decir más que eso sería un diagnóstico que no
  //      tenemos: el que sabe si el ascensor anda es el técnico, no nosotros.
  //
  // Si no hay ninguna de las dos, no se dice nada. Nunca "todo funciona normal".
  // La expensa de ESTA unidad, del documento que subió el administrador.
  //
  // Antes el número era `v.saldoExpensa`, escrito a mano: `$120.000,00` fijo, igual para todos los
  // vecinos de todos los edificios. Ahora sale de la tabla `expensas` -- del monto que la IA le
  // extrajo al documento, o del que corrigió una persona.
  //
  // Cuando no hay ninguna cargada NO se muestra $0: eso diría "no debés nada", que es una
  // afirmación. Se dice que todavía no está cargada, que es lo que realmente pasa.
  let expensa = null;
  try {
    const { expensaDeUnidad } = require('./db-pg');
    expensa = await expensaDeUnidad(v.edificio, v.departamento);
  } catch (err) {
    console.warn('Expensa de la unidad:', err.message);
  }

  const avisos = await avisosDelEdificio(v.edificio);
  const avisosHtml = avisos.length === 0 ? '' : bloqueAvisosHtml(avisos, v, t);

  // 1. Tarjeta superior de Expensas (Solo fijos/titulares) o Bienvenida (Turistas)
  
  if (!v.unidades || v.unidades.length === 0) {
    return res.send(shellVecino('Bienvenido', 'inicio', `
      <div class="card" style="padding:24px 20px;background:#ffffff;margin-bottom:14px;box-shadow:0 4px 18px rgba(15,23,42,.06);border-radius:20px;text-align:center">
        <div style="width:64px;height:64px;background:var(--superficie-3);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--texto-suave)">
          <i class="ph ph-house-line" style="font-size:32px"></i>
        </div>
        <h2 style="font-size:18px;font-weight:900;color:var(--texto);margin:0 0 8px;letter-spacing:-.02em">${esc(t('inicio.cuentaCreada'))}</h2>
        <p style="font-size:13.5px;color:var(--texto-medio);line-height:1.5;margin:0 0 20px">
          Todavía no tenés ningún departamento asignado.
        </p>
        <div style="background:var(--superficie-2);border:1px solid var(--borde);border-radius:12px;padding:16px;text-align:left;margin-bottom:20px">
          <div style="font-size:12.5px;font-weight:800;color:var(--texto-medio);margin-bottom:6px">${esc(t('inicio.comoSigo'))}</div>
          <div style="font-size:12px;color:var(--texto-suave);line-height:1.5">
            Por favor enviá un mensaje con el email con el que te registraste (<strong>${esc(v.email)}</strong>) a la persona que te invitó (propietario, anfitrión o administración) para que te habilite el acceso a la unidad.
          </div>
        </div>
        <a href="/vecino/chat" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--marca);color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:12px 24px;border-radius:12px;box-shadow:0 3px 10px rgba(15,50,106,.25)">
          <i class="ph ph-chat-circle-dots" style="font-size:20px"></i> Asistencia 24hs
        </a>
      </div>
    `, v));
  }

  const tarjetaSuperior = (v.puede_ver_expensas !== false) ? `
    <!-- Tarjeta Principal de Expensas (Estilo Mercado Pago) -->
    <div class="card" style="padding:18px;background:#ffffff;margin-bottom:14px;box-shadow:0 4px 18px rgba(15,23,42,.06);border-radius:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid var(--superficie-3);padding-bottom:10px">
        <div style="display:flex;gap:16px;font-size:13px;font-weight:800">
          <span style="color:var(--marca);border-bottom:2px solid #0F326A;padding-bottom:8px">${esc(t('inicio.expensasTab'))}</span>
          <span style="color:var(--texto-tenue);cursor:pointer" onclick="location.href='/vecino/amenities'">${esc(t('inicio.reservasTab'))}</span>
          <span style="color:var(--texto-tenue);cursor:pointer" onclick="location.href='/vecino/reclamos'">${esc(t('inicio.reclamosTab'))}</span>
        </div>
        ${expensa && expensa.periodo ? `<span style="font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;background:var(--superficie-3);color:var(--texto-medio);border:1px solid var(--borde)">${esc(expensa.periodo)}</span>` : ''}
      </div>

      <div style="margin-bottom:16px">
        ${expensa && expensa.monto !== null ? `
        <!-- Una expensa general NO es una deuda de esta persona: es el total de gastos del
             consorcio. Con la etiqueta "Total a pagar" el vecino lee que le cobran eso. -->
        <div style="font-size:12px;font-weight:700;color:var(--texto-suave);text-transform:uppercase;letter-spacing:.04em">${esc(expensa.esDelEdificio ? t('expensa.gastosEdificio') : t('inicio.totalAPagar'))}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px">
          <div style="font-size:32px;font-weight:900;color:var(--texto);letter-spacing:-.03em">${esc(montoEnPesos(expensa.monto))}</div>
        </div>
        ${expensa.vencimiento ? `<div style="font-size:12px;color:var(--texto-suave);margin-top:2px">${esc(t('expensa.vence', { fecha: new Date(expensa.vencimiento).toLocaleDateString('es-AR') }))}</div>` : ''}
        ${expensa.esDelEdificio ? `<div style="font-size:11.5px;color:var(--texto-tenue);margin-top:4px">${esc(t('expensa.noEsTuDeuda'))}</div>` : ''}
        ` : `
        <div style="font-size:13.5px;color:var(--texto-medio);line-height:1.45">${esc(t('expensa.sinCargar'))}</div>
        `}
      </div>

      <!-- Acciones de la Expensa -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <a href="/vecino/expensas" style="height:44px;border-radius:12px;background:var(--marca);color:#fff;font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 3px 10px rgba(15,50,106,.25);text-decoration:none">
          <i class="ph ph-credit-card" style="font-size:18px"></i>
          <span>${esc(t('inicio.pagarExpensa'))}</span>
        </a>
        <a href="${expensa && enlaceDeExpensa(expensa) ? enlaceDeExpensa(expensa) : '/vecino/expensas'}"${expensa && enlaceDeExpensa(expensa) ? ' target="_blank" rel="noopener"' : ''} style="height:44px;border-radius:12px;background:var(--superficie-3);color:var(--marca);font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--borde);text-decoration:none">
          <i class="ph ph-${expensa && enlaceDeExpensa(expensa) ? 'download-simple' : 'receipt'}" style="font-size:18px"></i>
          <span>${esc(expensa && enlaceDeExpensa(expensa) ? t('expensa.descargar') : t('inicio.verRecibo'))}</span>
        </a>
      </div>
    </div>
  ` : `
    <!-- Tarjeta Huésped Temporal (Turista) - Expensas Ocultas -->
    <div class="card" style="padding:20px;background:linear-gradient(135deg,#0F2B5C,#1E3A8A);color:#fff;margin-bottom:14px;box-shadow:0 4px 18px rgba(15,43,92,.2);border-radius:20px;border:1px solid rgba(251,191,36,0.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:11.5px;font-weight:900;padding:3px 10px;border-radius:999px;background:rgba(251,191,36,0.2);color:var(--dorado);border:1px solid rgba(251,191,36,0.4)">
          🧳 Estadía Temporal
        </span>
        <span style="font-size:12px;color:var(--texto-tenue)">${esc(t('inicio.paseHuesped'))}</span>
      </div>
      <div style="font-size:22px;font-weight:900;margin-bottom:4px;letter-spacing:-.02em">¡Bienvenido a ${esc(v.edificio)}!</div>
      <div style="font-size:13px;color:var(--texto-tenue);line-height:1.4;margin-bottom:16px">
        Alojado en depto <strong style="color:var(--dorado)">${esc(v.departamento)}</strong>. Tenés acceso habilitado a reservas de amenities, timbre personal y Marcos IA 24/7.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <a href="/vecino/amenities" style="height:44px;border-radius:12px;background:#FBBF24;color:var(--texto);font-size:13.5px;font-weight:900;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">
          <i class="ph ph-swimming-pool" style="font-size:18px"></i>
          <span>${esc(t('inicio.amenities'))}</span>
        </a>
        <a href="/vecino/chat" style="height:44px;border-radius:12px;background:rgba(255,255,255,0.15);color:#fff;font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,0.25);text-decoration:none">
          <i class="ph ph-chat-circle-dots" style="font-size:18px"></i>
          <span>Asistente 24/7</span>
        </a>
      </div>
    </div>
  `;

  // 2. Tarjeta Mi Timbre Digital & Modo No Molestar
  const tarjetaTimbre = `
    <div class="card" style="padding:16px 18px;background:#ffffff;margin-bottom:14px;border-radius:20px;border:1px solid var(--borde);box-shadow:0 4px 14px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <div id="timbre-icono-box" style="width:42px;height:42px;border-radius:14px;background:${v.timbre_activo !== false ? '#DCFCE7' : '#FEE2E2'};color:${v.timbre_activo !== false ? '#15803D' : '#DC2626'};display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ${v.timbre_activo !== false ? 'ph-bell-ringing' : 'ph-bell-slash'}"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:900;color:var(--texto)">${esc(t('inicio.timbre'))}</div>
            <div id="timbre-estado-lbl" style="font-size:12px;color:${v.timbre_activo !== false ? '#15803D' : '#DC2626'};font-weight:700">
              ${v.timbre_activo !== false ? '● Activo · Suena en tu celu' : '○ Silenciado'}
            </div>
          </div>
        </div>
        <!-- Switch ON/OFF -->
        <label style="position:relative;display:inline-block;width:50px;height:28px;cursor:pointer;margin:0">
          <input type="checkbox" id="chk-timbre-activo" ${v.timbre_activo !== false ? 'checked' : ''} onchange="guardarConfigTimbre()" style="opacity:0;width:0;height:0">
          <span class="slider-timbre" id="slider-timbre-bg" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${v.timbre_activo !== false ? '#10B981' : '#CBD5E1'};border-radius:28px;transition:.3s"></span>
        </label>
      </div>

      <!-- Configuración No Molestar / Silencio Nocturno con switch ON/OFF -->
      <div style="border-top:1px solid var(--superficie-3);padding-top:12px;margin-top:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="timbre-horario-label" style="font-size:13px"><i class="ph ph-moon" style="font-size:14px;vertical-align:-2px"></i> ${esc(t('inicio.noMolestar'))}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span id="nm-estado-lbl" style="font-size:11.5px;font-weight:700;color:${v.timbre_no_molestar_activo ? '#D97706' : '#64748B'}">
              ${v.timbre_no_molestar_activo ? 'Activado' : 'Desactivado (24 hs libre)'}
            </span>
            <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;margin:0">
              <input type="checkbox" id="chk-nm-activo" ${v.timbre_no_molestar_activo ? 'checked' : ''} onchange="toggleNoMolestar()" style="opacity:0;width:0;height:0">
              <span class="slider-timbre" id="slider-nm-bg" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${v.timbre_no_molestar_activo ? '#F59E0B' : '#CBD5E1'};border-radius:24px;transition:.3s"></span>
            </label>
          </div>
        </div>

        <div id="box-horario-no-molestar" class="timbre-horario-row" style="display:${v.timbre_no_molestar_activo ? 'flex' : 'none'};margin-top:6px">
          <span class="timbre-horario-label">${esc(t('inicio.horarioSilencio'))}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="timbre-de-label">De</span>
            <input type="time" id="timbre-silencio-desde" class="inp-time-timbre" value="${esc(v.timbre_silencio_desde || '23:00')}" onchange="guardarConfigTimbre()">
            <span class="timbre-a-label">a</span>
            <input type="time" id="timbre-silencio-hasta" class="inp-time-timbre" value="${esc(v.timbre_silencio_hasta || '07:30')}" onchange="guardarConfigTimbre()">
          </div>
        </div>
      </div>

      <div id="timbre-guardado-msg" style="display:none;font-size:11.5px;color:var(--ok);font-weight:800;margin-top:8px;text-align:right">
        ${esc(t('inicio.timbreGuardado'))}
      </div>
    </div>
  `;

  // Integrantes vive UNA sola vez en el inicio: el botón de "Accesos Directos", igual que
  // Amenities, Pases QR y el resto.
  //
  // Antes había además una tarjeta ancha arriba --"Ocupantes del Depto X" con un botón
  // "Gestionar"-- que llevaba exactamente al mismo lugar que ese botón. Dos caminos al mismo
  // lado, uno de ellos ocupando el doble de alto que cualquier otra sección, empujaban todo lo
  // demás abajo del pliegue en un teléfono.
  //
  // El conteo de integrantes que mostraba esa tarjeta se ve al entrar, que es donde se puede
  // hacer algo con él.

  const content = `
    ${tarjetaSuperior}
    ${tarjetaTimbre}

    <!-- Servicios Rápidos en Fila (Estilo Mercado Pago Icons) -->
    <div style="margin-bottom:14px">
      <div style="font-size:13.5px;font-weight:800;color:var(--texto);margin-bottom:10px">${esc(t('inicio.accesosDirectos'))}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(68px,1fr));gap:8px">
        
        <a href="/vecino/pases" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:42px;height:42px;border-radius:14px;background:var(--acento-tenue);color:#0284C7;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-ticket"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:var(--texto)">${esc(t('inicio.pasesQr'))}</span>
        </a>

        <a href="/porteria/${encodeURIComponent(v.edificio)}" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:42px;height:42px;border-radius:14px;background:var(--aviso-fondo);color:#D97706;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-qr-code"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:var(--texto)">${esc(t('inicio.porteriaQr'))}</span>
        </a>

        <a href="/vecino/amenities" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:42px;height:42px;border-radius:14px;background:var(--ok-fondo);color:var(--ok);display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-swimming-pool"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:var(--texto)">${esc(t('inicio.amenities'))}</span>
        </a>

        ${(v.rol === 'propietario' || v.rol === 'asistente') ? `
        <a href="/vecino/integrantes" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:42px;height:42px;border-radius:14px;background:var(--info-fondo);color:#4F46E5;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-users-three"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:var(--texto)">${esc(t('inicio.integrantes'))}</span>
        </a>` : ''}

        <a href="/vecino/reclamos" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:42px;height:42px;border-radius:14px;background:var(--acento-tenue);color:var(--acento);display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-wrench"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:var(--texto)">${esc(t('inicio.reclamosTab'))}</span>
        </a>

        <a href="/vecino/novedades" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:42px;height:42px;border-radius:14px;background:#F3E8FF;color:#7E22CE;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-bell-ringing"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:var(--texto)">Avisos</span>
        </a>

      </div>
    </div>

    <!-- Tarjeta Instalar App en el Celular -->
    <div id="card-instalar-pwa" class="card card-touch" style="padding:14px 16px;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;box-shadow:0 4px 14px rgba(15,50,106,.2);border-radius:18px" onclick="instalarPwa()">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
          📲
        </div>
        <div>
          <div style="font-size:13.5px;font-weight:900;line-height:1.2">${esc(t('inicio.instalarTitulo'))}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.85)">${esc(t('inicio.instalarBajada'))}</div>
        </div>
      </div>
      <button style="padding:6px 14px;border:none;border-radius:8px;background:#ffffff;color:var(--marca);font-weight:900;font-size:12px;cursor:pointer;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.15)">${esc(t('inicio.instalar'))}</button>
    </div>

    <!-- Banner Inteligente Marcos IA (Estilo Créditos Mercado Pago) -->
    <div class="card card-touch" style="padding:16px;background:#ffffff;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;border-left:4px solid var(--acento)" onclick="location.href='/vecino/chat'">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:42px;height:42px;border-radius:12px;background:var(--marca);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          <i class="ph ph-headset"></i>
        </div>
        <div>
          <div style="font-size:14.5px;font-weight:900;color:var(--texto)">${esc(t('inicio.asistenteTitulo'))}</div>
          <div style="font-size:12px;color:var(--texto-suave);line-height:1.3">${esc(t('inicio.asistenteBajada'))}</div>
        </div>
      </div>
      <button style="padding:7px 14px;border:none;border-radius:10px;background:var(--marca);color:#fff;font-size:12.5px;font-weight:800;cursor:pointer;flex-shrink:0">${esc(t('inicio.chatear'))}</button>
    </div>

    <!-- AVISOS DEL EDIFICIO -->
    <!--
      Antes acá había tres filas fijas --Ascensor, Bombas, Portón-- que decían "En servicio normal"
      SIEMPRE, en todos los edificios. Esa es una afirmación que no se puede respaldar nunca: que
      no haya un reclamo abierto no prueba que el ascensor ande.

      El vecino que sube después de leer "en servicio normal" y encuentra el ascensor parado no
      vuelve a mirar esta sección. Y una sección que nadie mira es peor que no tenerla.

      Ahora el bloque SOLO aparece cuando hay algo que decir, y dice únicamente lo que se sabe: un
      aviso publicado por alguien del edificio, o un reclamo abierto. Sin novedades no se renderiza
      nada -- el silencio es honesto, "todo normal" es una promesa.
    -->
    ${avisosHtml}
    <!-- Novedades del Consorcio -->
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13.5px;font-weight:900;color:var(--texto)">${esc(t('inicio.novedades'))}</span>
      <a href="/vecino/novedades" style="font-size:12.5px;font-weight:800;color:#38BDF8">${esc(t('inicio.verTodas'))}</a>
    </div>

    <div class="card" style="padding:15px;background:#fff;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--aviso-fondo);color:var(--aviso)">${esc(t('inicio.mantenimiento'))}</span>
        <span style="font-size:11.5px;color:var(--dorado);font-weight:700">Hoy · 09:30 hs</span>
      </div>
      <div style="font-size:14px;font-weight:800;color:var(--texto);margin-bottom:4px">${esc(t('inicio.avisoTanques'))}</div>
      <div style="font-size:12.5px;color:var(--texto-suave);line-height:1.4">${esc(t('inicio.avisoTanquesTexto'))}</div>
    </div>

    <!-- Scripts de Interacción Home -->
    <script>
      function toggleNoMolestar() {
        const chkNm = document.getElementById('chk-nm-activo');
        const boxNm = document.getElementById('box-horario-no-molestar');
        const lblNm = document.getElementById('nm-estado-lbl');
        const sNmBg = document.getElementById('slider-nm-bg');
        const activo = chkNm ? chkNm.checked : false;
        if (boxNm) boxNm.style.display = activo ? 'flex' : 'none';
        if (lblNm) {
          lblNm.innerText = activo ? 'Activado' : 'Desactivado (24 hs libre)';
          lblNm.style.color = activo ? '#D97706' : '#64748B';
        }
        if (sNmBg) sNmBg.style.backgroundColor = activo ? '#F59E0B' : '#CBD5E1';
        guardarConfigTimbre();
      }

      async function guardarConfigTimbre() {
        const chk = document.getElementById('chk-timbre-activo');
        const chkNm = document.getElementById('chk-nm-activo');
        const desde = document.getElementById('timbre-silencio-desde') ? document.getElementById('timbre-silencio-desde').value : '23:00';
        const hasta = document.getElementById('timbre-silencio-hasta') ? document.getElementById('timbre-silencio-hasta').value : '07:30';
        const activo = chk ? chk.checked : true;
        const nmActivo = chkNm ? chkNm.checked : false;

        const icoBox = document.getElementById('timbre-icono-box');
        const lbl = document.getElementById('timbre-estado-lbl');
        const sBg = document.getElementById('slider-timbre-bg');
        if (icoBox && lbl && sBg) {
          if (activo) {
            icoBox.style.background = '#DCFCE7';
            icoBox.style.color = '#15803D';
            icoBox.innerHTML = '<i class="ph ph-bell-ringing"></i>';
            lbl.style.color = '#15803D';
            lbl.innerText = '● Activo · Suena en tu celu';
            sBg.style.backgroundColor = '#10B981';
          } else {
            icoBox.style.background = '#FEE2E2';
            icoBox.style.color = '#DC2626';
            icoBox.innerHTML = '<i class="ph ph-bell-slash"></i>';
            lbl.style.color = '#DC2626';
            lbl.innerText = '○ Silenciado';
            sBg.style.backgroundColor = '#CBD5E1';
          }
        }

        try {
          const res = await fetch('/vecino/api/timbre-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              timbre_activo: activo,
              timbre_no_molestar_activo: nmActivo,
              timbre_silencio_desde: desde,
              timbre_silencio_hasta: hasta
            })
          });
          const data = await res.json();
          if (data.ok) {
            const msg = document.getElementById('timbre-guardado-msg');
            if (msg) {
              msg.style.display = 'block';
              setTimeout(function() { msg.style.display = 'none'; }, 3000);
            }
          }
        } catch (_) {}
      }

      // cargarResumenOcupantes se fue junto con la tarjeta que alimentaba: era un fetch a
      // /vecino/api/ocupantes-unidad en CADA carga del inicio, para un dato que ahora se ve al
      // entrar a Integrantes. El endpoint sigue vivo, lo usa esa pagina.
      //
      // Sin acentos graves a proposito: este comentario vive DENTRO de un template literal y un
      // acento grave lo cierra, rompiendo el archivo entero. Es el mismo error que ya rompio
      // db-pg.js en produccion.
    </script>
  `;

  res.send(shellVecino('Inicio', 'inicio', content, v));
});

// -------------------------------------------------------------------
// PÁGINA DEDICADA: GESTIÓN DE INTEGRANTES Y ASISTENTES
// -------------------------------------------------------------------
router.get('/integrantes', (req, res) => {
  const v = getVecinoSession(req);
  if (v.rol !== 'propietario' && v.rol !== 'asistente') {
    return res.redirect('/vecino');
  }

  const content = `
    <!-- Barra Superior / Header de la Sección -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <a href="/vecino" style="display:inline-flex;align-items:center;gap:6px;color:var(--marca);font-size:13px;font-weight:800;text-decoration:none;background:var(--superficie-3);padding:7px 12px;border-radius:10px">
        <i class="ph ph-arrow-left" style="font-size:16px"></i>
        <span>Volver al Inicio</span>
      </a>
      <span style="font-size:12px;font-weight:800;color:var(--texto-suave);background:#fff;padding:5px 12px;border-radius:20px;border:1px solid var(--borde)">
        ${esc(v.edificio)} · Depto ${esc(v.departamento)}
      </span>
    </div>

    <!-- TARJETA 1: ASIGNAR A LA UNIDAD / CEDER GESTIÓN -->
    <div class="card" style="padding:18px 20px;background:#ffffff;margin-bottom:16px;border-radius:20px;border:1px solid var(--borde);box-shadow:0 4px 14px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;border-bottom:1px solid var(--superficie-3);padding-bottom:10px">
        <div style="width:38px;height:38px;border-radius:12px;background:var(--acento-tenue);color:var(--acento);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
          <i class="ph ph-user-plus"></i>
        </div>
        <div>
          <div style="font-size:15px;font-weight:900;color:var(--texto)">Asignar a la Unidad</div>
          <div style="font-size:11.5px;color:var(--texto-suave)">Convivientes, inquilinos, turistas o asistentes de propiedad</div>
        </div>
      </div>

      <form onsubmit="guardarAsignacion(event)">
        <!-- 1. Selección de Rol -->
        <div style="margin-bottom:14px">
          <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:8px">1. Seleccioná el Rol en el Departamento</label>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px" id="grid-roles-asignar">
            <button type="button" class="btn-rol-selector active" onclick="seleccionarRol('conviviente', this)">
              <i class="ph ph-user-circle"></i>
              <span>Familiar / Conviviente</span>
            </button>
            <button type="button" class="btn-rol-selector" onclick="seleccionarRol('inquilino', this)">
              <i class="ph ph-key"></i>
              <span>Inquilino (Fijo)</span>
            </button>
            <button type="button" class="btn-rol-selector" onclick="seleccionarRol('turista', this)">
              <i class="ph ph-suitcase"></i>
              <span>Pase Huésped Turista</span>
            </button>
            <button type="button" class="btn-rol-selector" onclick="seleccionarRol('asistente', this)">
              <i class="ph ph-buildings"></i>
              <span>Asistente de Propiedad</span>
            </button>
          </div>
          <input type="hidden" id="asig-rol" value="conviviente">
        </div>

        <!-- 2. Búsqueda por Email de Usuario Registrado -->
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em">2. Email del Usuario Registrado</label>
            <span id="txt-buscando-status" style="font-size:11px;font-weight:700;color:var(--texto-suave);display:none">Verificando...</span>
          </div>
          <div style="position:relative">
            <input type="email" id="asig-email" class="inp" placeholder="ejemplo: usuario@correo.com" required oninput="buscarUsuarioDebounced()" style="padding-right:38px;background:#fff">
            <span id="asig-email-status-icon" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:18px"></span>
          </div>
        </div>

        <!-- Caja de Verificación y Datos de Usuario Autofill -->
        <div id="asig-feedback-box" style="display:none;margin-bottom:14px"></div>

        <!-- Campos adicionales si es Huésped Turista (Fechas) -->
        <div id="box-fechas-turista" style="display:none;margin-bottom:14px;background:var(--aviso-fondo);border:1px solid var(--aviso-borde);border-radius:14px;padding:12px 14px">
          <div style="font-size:11.5px;font-weight:800;color:var(--aviso);text-transform:uppercase;margin-bottom:8px">Fechas de Estadía del Huésped</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--aviso);display:block;margin-bottom:4px">Check-in</label>
              <input type="date" id="asig-fecha-desde" class="inp" style="background:#fff">
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--aviso);display:block;margin-bottom:4px">Check-out</label>
              <input type="date" id="asig-fecha-hasta" class="inp" style="background:#fff">
            </div>
          </div>
          <div style="font-size:11px;color:var(--aviso);margin-top:8px;line-height:1.3">
            🔒 <em>Expensas ocultas: el turista solo tendrá acceso a timbre digital, reservas de amenities y Marcos IA.</em>
          </div>
        </div>

        <!-- Aviso si es Asistente de Propiedad -->
        <div id="box-aviso-asistente" style="display:none;margin-bottom:14px;background:var(--info-fondo);border:1px solid var(--info-borde);border-radius:14px;padding:12px 14px;color:var(--info);font-size:12px;line-height:1.4">
          🏢 <strong>Cesión de Gestión:</strong> Esta unidad se incorporará al portafolio de administración del asistente. Podrá coordinar estadías, registrar huéspedes temporales, solicitar reubicaciones y gestionar tickets en tu nombre.
        </div>

        <!-- Botón de Confirmación -->
        <button type="submit" id="btn-confirmar-asignacion" disabled style="width:100%;height:46px;border:none;border-radius:12px;background:#CBD5E1;color:var(--texto-suave);font-weight:900;font-size:13.5px;cursor:not-allowed;transition:all .15s ease">
          Completar Asignación
        </button>
      </form>
    </div>

    <!-- TARJETA 2: LISTA DE INTEGRANTES ACTUALES -->
    <div class="card" style="padding:18px 20px;background:#ffffff;margin-bottom:16px;border-radius:20px;border:1px solid var(--borde);box-shadow:0 4px 14px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid var(--superficie-3);padding-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:12px;background:var(--acento-tenue);color:var(--acento);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
            <i class="ph ph-users-three"></i>
          </div>
          <div>
            <div style="font-size:15px;font-weight:900;color:var(--texto)">Integrantes Activos</div>
            <div style="font-size:11.5px;color:var(--texto-suave)">Personas con acceso a la unidad</div>
          </div>
        </div>
        <button onclick="cargarIntegrantes()" style="border:none;background:var(--superficie-3);color:var(--texto-medio);width:32px;height:32px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i class="ph ph-arrows-clockwise" style="font-size:16px"></i>
        </button>
      </div>

      <div id="lista-integrantes-box" style="display:flex;flex-direction:column;gap:8px">
        <div style="font-size:12px;color:var(--texto-tenue);text-align:center;padding:12px">Cargando integrantes...</div>
      </div>
    </div>

    <!-- MODAL: Reubicar Huésped a Otra Unidad -->
    <div id="modal-reubicar-huesped" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:20px;max-width:460px;width:100%;padding:22px;box-shadow:0 20px 40px rgba(0,0,0,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:16px;font-weight:900;color:var(--texto)">🔄 Reubicar Huésped a Otra Unidad</div>
          <button onclick="cerrarModal('modal-reubicar-huesped')" style="border:none;background:var(--superficie-3);border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer;color:var(--texto-suave)">✕</button>
        </div>
        <form onsubmit="ejecutarReubicacion(event)">
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;display:block;margin-bottom:4px">Huésped a Trasladar</label>
            <select id="sel-reub-huesped" class="inp" style="background:#fff" required>
              <option value="">Cargando huéspedes...</option>
            </select>
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;display:block;margin-bottom:4px">Unidad de Destino (Portafolio Disponible)</label>
            <select id="sel-reub-destino" class="inp" style="background:#fff" required>
              <option value="">Cargando unidades disponibles...</option>
            </select>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:11.5px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;display:block;margin-bottom:4px">Motivo del Traslado</label>
            <input type="text" id="inp-reub-motivo" placeholder="Ej: Fuga de agua / Reparación urgente" class="inp" style="background:#fff" required>
          </div>
          <div style="font-size:11.5px;color:#4338CA;line-height:1.4;margin-bottom:14px;background:var(--info-fondo);padding:10px 12px;border-radius:10px;border:1px solid var(--info-borde)">
            ✨ <strong>Efectos Inmediatos:</strong><br>
            • El timbre digital del huésped se redirige al nuevo departamento.<br>
            • Las reservas de amenities se transfieren automáticamente.<br>
            • Se registra la trazabilidad para administración y propietario.
          </div>
          <button type="submit" id="btn-reub-ejecutar" style="width:100%;height:44px;border:none;border-radius:12px;background:#4F46E5;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer">Confirmar Reubicación Inmediata</button>
        </form>
      </div>
    </div>

    <!-- SCRIPTS DE CLIENTE -->
    <script>
      let _integrantesActuales = [];
      let _usuarioVerificado = null;
      let _timerBusqueda = null;
      const _miUsuarioId = ${Number(v.usuario_id || 0)};

      function seleccionarRol(rol, btn) {
        document.getElementById('asig-rol').value = rol;
        const btns = document.querySelectorAll('#grid-roles-asignar .btn-rol-selector');
        btns.forEach(function(b) { b.classList.remove('active'); });
        if (btn) btn.classList.add('active');

        const boxTur = document.getElementById('box-fechas-turista');
        const boxAsis = document.getElementById('box-aviso-asistente');
        if (boxTur) boxTur.style.display = (rol === 'turista') ? 'block' : 'none';
        if (boxAsis) boxAsis.style.display = (rol === 'asistente') ? 'block' : 'none';

        validarBotonSubmit();
      }

      function buscarUsuarioDebounced() {
        clearTimeout(_timerBusqueda);
        const email = (document.getElementById('asig-email').value || '').trim();
        const icon = document.getElementById('asig-email-status-icon');
        const statusTxt = document.getElementById('txt-buscando-status');
        const box = document.getElementById('asig-feedback-box');

        if (!email || email.indexOf('@') === -1) {
          _usuarioVerificado = null;
          if (icon) icon.innerText = '';
          if (statusTxt) statusTxt.style.display = 'none';
          if (box) box.style.display = 'none';
          validarBotonSubmit();
          return;
        }

        if (statusTxt) statusTxt.style.display = 'inline';
        if (icon) icon.innerText = '⏳';

        _timerBusqueda = setTimeout(function() {
          ejecutarBusquedaUsuario(email);
        }, 350);
      }

      async function ejecutarBusquedaUsuario(email) {
        const icon = document.getElementById('asig-email-status-icon');
        const statusTxt = document.getElementById('txt-buscando-status');
        const box = document.getElementById('asig-feedback-box');

        try {
          const res = await fetch('/vecino/api/buscar-usuario-email?email=' + encodeURIComponent(email));
          const data = await res.json();
          if (statusTxt) statusTxt.style.display = 'none';

          if (data.ok && data.existe && data.usuario) {
            _usuarioVerificado = data.usuario;
            if (icon) icon.innerText = '✅';
            if (box) {
              const nombreCompleto = (data.usuario.nombre || '') + ' ' + (data.usuario.apellido || '');
              const tel = data.usuario.telefono ? (' · 📞 ' + data.usuario.telefono) : '';
              box.innerHTML = '<div style="background:#F0FDF4;border:1.5px solid var(--ok-borde);border-radius:12px;padding:12px 14px;color:var(--ok)">' +
                                '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--ok);margin-bottom:3px">✓ Usuario Verificado en la App</div>' +
                                '<div style="font-size:14px;font-weight:900;color:var(--texto)">' + nombreCompleto + '</div>' +
                                '<div style="font-size:12px;color:var(--texto-medio)">✉️ ' + data.usuario.email + tel + '</div>' +
                              '</div>';
              box.style.display = 'block';
            }
          } else {
            _usuarioVerificado = null;
            if (icon) icon.innerText = '⚠️';
            if (box) {
              box.innerHTML = '<div style="background:var(--error-fondo);border:1.5px solid var(--error-borde);border-radius:12px;padding:12px 14px;color:var(--error);font-size:12.5px;line-height:1.4">' +
                                '<strong style="display:block;margin-bottom:3px">⚠️ Usuario no registrado</strong>' +
                                'Este email no pertenece a ningún usuario registrado en la app. La persona debe registrarse previamente con su email y número de teléfono para poder asociarla a la unidad.' +
                              '</div>';
              box.style.display = 'block';
            }
          }
        } catch (_) {
          _usuarioVerificado = null;
          if (statusTxt) statusTxt.style.display = 'none';
          if (icon) icon.innerText = '❌';
        }

        validarBotonSubmit();
      }

      function validarBotonSubmit() {
        const btn = document.getElementById('btn-confirmar-asignacion');
        if (!btn) return;
        if (_usuarioVerificado) {
          btn.disabled = false;
          btn.style.background = '#0F326A';
          btn.style.color = '#ffffff';
          btn.style.cursor = 'pointer';
        } else {
          btn.disabled = true;
          btn.style.background = '#CBD5E1';
          btn.style.color = '#64748B';
          btn.style.cursor = 'not-allowed';
        }
      }

      async function guardarAsignacion(e) {
        e.preventDefault();
        if (!_usuarioVerificado) {
          alert('Debés ingresar un usuario registrado previamente en la app.');
          return;
        }
        const btn = document.getElementById('btn-confirmar-asignacion');
        btn.disabled = true;
        btn.innerText = 'Guardando...';

        const rol = document.getElementById('asig-rol').value;
        const payload = {
          email: _usuarioVerificado.email,
          rol: rol,
          fecha_desde: (rol === 'turista') ? document.getElementById('asig-fecha-desde').value : null,
          fecha_hasta: (rol === 'turista') ? document.getElementById('asig-fecha-hasta').value : null
        };

        try {
          const res = await fetch('/vecino/api/asignar-integrante-registrado', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.ok) {
            alert(data.mensaje || 'Asignación realizada con éxito.');
            document.getElementById('asig-email').value = '';
            document.getElementById('asig-feedback-box').style.display = 'none';
            document.getElementById('asig-email-status-icon').innerText = '';
            _usuarioVerificado = null;
            validarBotonSubmit();
            cargarIntegrantes();
          } else {
            alert(data.error || 'Error al realizar la asignación.');
          }
        } catch (_) {
          alert('Error de conexión con el servidor.');
        } finally {
          btn.innerText = 'Completar Asignación';
          validarBotonSubmit();
        }
      }

      async function cargarIntegrantes() {
        const box = document.getElementById('lista-integrantes-box');
        if (!box) return;
        box.innerHTML = '<div style="font-size:12px;color:var(--texto-tenue);text-align:center;padding:12px">Cargando integrantes...</div>';

        try {
          const res = await fetch('/vecino/api/ocupantes-unidad');
          const data = await res.json();
          if (data.ok && data.ocupantes) {
            _integrantesActuales = data.ocupantes;
            renderizarLista(data.ocupantes);
          } else {
            box.innerHTML = '<div style="font-size:12px;color:#EF4444;text-align:center;padding:12px">No se pudieron cargar los datos.</div>';
          }
        } catch (_) {
          box.innerHTML = '<div style="font-size:12px;color:var(--texto-tenue);text-align:center;padding:12px">Sin conexión.</div>';
        }
      }

      function renderizarLista(lista) {
        const box = document.getElementById('lista-integrantes-box');
        if (!box) return;
        if (!lista || !lista.length) {
          box.innerHTML = '<div style="font-size:12px;color:var(--texto-tenue);text-align:center;padding:12px">No hay otros integrantes registrados.</div>';
          return;
        }

        let html = '';
        for (let i = 0; i < lista.length; i++) {
          const o = lista[i];
          const esTur = (o.rol === 'turista');
          const esAsis = (o.rol === 'asistente');
          const badgeClass = esTur ? 'badge-ocupante-turista' : (o.rol === 'propietario' ? 'badge-ocupante-propietario' : (esAsis ? 'badge-ocupante-asistente' : 'badge-ocupante-inquilino'));
          const badgeTxt = esTur ? '🧳 Turista' : (o.rol === 'propietario' ? '👑 Propietario' : (esAsis ? '🏢 Asistente / Gestor' : (o.rol === 'inquilino' ? '🔑 Inquilino' : '👥 Familiar')));
          const timbreTxt = o.timbre_activo !== false ? '🔔 Timbre ON' : '🔕 Timbre OFF';
          const timbreClass = o.timbre_activo !== false ? 'timbre-on' : 'timbre-off';

          let fechasTxt = '';
          if (o.fecha_desde && o.fecha_hasta) {
            fechasTxt = ' · Del ' + String(o.fecha_desde).slice(0, 10) + ' al ' + String(o.fecha_hasta).slice(0, 10);
          }
          const nom = (o.nombre || '') + ' ' + (o.apellido || '');
          const contacto = o.email || o.telefono || 'Sin contacto';

          let btnReubicar = '';
          if (esTur) {
            btnReubicar = '<button type="button" onclick="abrirModalReubicar(' + o.usuario_id + ')" style="padding:4px 10px;border-radius:8px;background:var(--info-fondo);border:1px solid var(--info-borde);color:#4F46E5;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-top:6px">' +
                            '<i class="ph ph-arrows-left-right"></i>' +
                            '<span>Reubicar Depto</span>' +
                          '</button>';
          }

          let btnDesvincular = '';
          if (o.usuario_id && o.usuario_id !== _miUsuarioId && o.rol !== 'propietario') {
            btnDesvincular = '<button type="button" onclick="desvincular(' + o.usuario_id + ')" style="padding:4px 8px;border-radius:8px;background:var(--error-fondo);border:1px solid var(--error-borde);color:var(--error);font-size:11px;font-weight:800;cursor:pointer;margin-top:6px" title="Desvincular">' +
                               '✕ Desvincular' +
                             '</button>';
          }

          html += '<div class="ocupante-item-row" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">' +
                    '<div style="flex:1">' +
                      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                        '<strong class="ocupante-nombre">' + nom + '</strong>' +
                        '<span class="badge-ocupante ' + badgeClass + '">' + badgeTxt + '</span>' +
                      '</div>' +
                      '<div class="ocupante-contacto">' + contacto + fechasTxt + '</div>' +
                      '<div style="display:flex;align-items:center;gap:8px">' + btnReubicar + btnDesvincular + '</div>' +
                    '</div>' +
                    '<div class="ocupante-timbre-status ' + timbreClass + '" style="flex-shrink:0">' + timbreTxt + '</div>' +
                  '</div>';
        }
        box.innerHTML = html;
      }

      async function desvincular(usuarioId) {
        const integrante = _integrantesActuales.find(function(x) { return x.usuario_id === usuarioId; });
        const nombre = integrante ? (integrante.nombre || 'el integrante') : 'el integrante';
        if (!confirm('¿Estás seguro de que querés desvincular a ' + nombre + ' de este departamento?')) return;
        try {
          const res = await fetch('/vecino/api/desvincular-integrante', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario_id: usuarioId })
          });
          const data = await res.json();
          if (data.ok) {
            alert('Integrante desvinculado con éxito.');
            cargarIntegrantes();
          } else {
            alert(data.error || 'No se pudo desvincular.');
          }
        } catch (_) {
          alert('Error de conexión.');
        }
      }

      async function abrirModalReubicar(turistaId) {
        const m = document.getElementById('modal-reubicar-huesped');
        if (!m) return;
        m.style.display = 'flex';

        const selH = document.getElementById('sel-reub-huesped');
        selH.innerHTML = '<option value="">Seleccionar huésped...</option>';
        const turistas = _integrantesActuales.filter(function(o) { return o.rol === 'turista'; });
        for (let i = 0; i < turistas.length; i++) {
          const t = turistas[i];
          const opt = document.createElement('option');
          opt.value = t.usuario_id;
          opt.innerText = (t.nombre || 'Huésped') + ' (' + (t.email || t.telefono || ('ID: ' + t.usuario_id)) + ')';
          if (turistaId && t.usuario_id === turistaId) opt.selected = true;
          selH.appendChild(opt);
        }

        const selD = document.getElementById('sel-reub-destino');
        selD.innerHTML = '<option value="">Cargando unidades disponibles...</option>';
        try {
          const res = await fetch('/vecino/api/portafolio-asistente');
          const data = await res.json();
          selD.innerHTML = '<option value="">Seleccionar depto de destino...</option>';
          if (data.ok && data.unidades && data.unidades.length > 0) {
            for (let j = 0; j < data.unidades.length; j++) {
              const u = data.unidades[j];
              const opt = document.createElement('option');
              opt.value = JSON.stringify({ edificio: u.edificio, depto: u.departamento });
              const propInfo = u.propietario_nombre ? (' [Dueño: ' + u.propietario_nombre + ']') : '';
              opt.innerText = u.edificio + ' - Depto ' + u.departamento + propInfo;
              selD.appendChild(opt);
            }
          } else {
            selD.innerHTML = '<option value="">No hay otras unidades asignadas en el portafolio</option>';
          }
        } catch (_) {
          selD.innerHTML = '<option value="">Error al consultar portafolio</option>';
        }
      }

      async function ejecutarReubicacion(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-reub-ejecutar');
        const uId = document.getElementById('sel-reub-huesped').value;
        const destJson = document.getElementById('sel-reub-destino').value;
        const motivo = document.getElementById('inp-reub-motivo').value;

        if (!uId || !destJson) {
          alert('Por favor seleccioná el huésped y el departamento de destino.');
          return;
        }

        btn.disabled = true;
        btn.innerText = 'Reubicando...';

        try {
          const dest = JSON.parse(destJson);
          const res = await fetch('/vecino/api/reubicar-turista', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              usuario_id: uId,
              nuevo_edificio: dest.edificio,
              nuevo_departamento: dest.depto,
              motivo: motivo
            })
          });
          const data = await res.json();
          if (data.ok) {
            alert(data.mensaje || 'Huésped reubicado con éxito.');
            cerrarModal('modal-reubicar-huesped');
            cargarIntegrantes();
          } else {
            alert(data.error || 'No se pudo reubicar al huésped.');
          }
        } catch (_) {
          alert('Error de conexión.');
        } finally {
          btn.disabled = false;
          btn.innerText = 'Confirmar Reubicación Inmediata';
        }
      }

      function cerrarModal(id) {
        const m = document.getElementById(id);
        if (m) m.style.display = 'none';
      }

      document.addEventListener('DOMContentLoaded', () => {
        const hoy = new Date().toISOString().split('T')[0];
        const fDesde = document.getElementById('asig-fecha-desde');
        if (fDesde) fDesde.value = hoy;
        cargarIntegrantes();
      });
    </script>
  `;

  res.send(shellVecino('Integrantes', 'integrantes', content, v));
});

// -------------------------------------------------------------------
// ENDPOINTS API DE TIMBRE DIGITAL Y GESTIÓN MULTI-OCUPANTE
// -------------------------------------------------------------------


// -------------------------------------------------------------------
// 3.5 GESTIÓN DE PASES DE INVITACIÓN QR (VECINOS & PROVEEDORES)
// -------------------------------------------------------------------
router.get('/pases', (req, res) => {
  const v = getVecinoSession(req);

  const content = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <h1 style="font-size:20px;font-weight:900;color:var(--texto);letter-spacing:-.02em">Pases de Invitación QR</h1>
        <p style="font-size:12.5px;color:var(--texto-suave)">${esc(v.edificio)} · Depto ${esc(v.departamento)}</p>
      </div>
      <button onclick="abrirModalNuevoPase()" style="padding:9px 15px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;box-shadow:0 3px 10px rgba(15,50,106,.25)">
        <i class="ph ph-plus-circle" style="font-size:18px"></i>
        <span>Nuevo Pase QR</span>
      </button>
    </div>

    <!-- TARJETA EXPLICATIVA -->
    <div class="card" style="padding:14px 16px;background:var(--superficie-2);border:1px solid var(--borde);border-radius:18px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:12px;background:var(--acento-tenue);color:#0284C7;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
        <i class="ph ph-shield-check"></i>
      </div>
      <div style="font-size:12px;color:var(--texto-medio);line-height:1.4">
        Generá códigos QR temporales para tus visitas, deliveries o personal de servicio. El invitado lo muestra frente a la cámara del tótem para ingresar.
      </div>
    </div>

    <!-- TABS: ACTIVOS / HISTORIAL -->
    <div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid var(--borde);padding-bottom:8px">
      <button id="tab-btn-activos" onclick="cambiarTabPases('activos')" style="border:none;background:var(--marca);color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;cursor:pointer">
        Pases Activos (<span id="cnt-activos">0</span>)
      </button>
      <button id="tab-btn-historial" onclick="cambiarTabPases('historial')" style="border:none;background:var(--superficie-3);color:var(--texto-suave);padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;cursor:pointer">
        Historial / Vencidos
      </button>
    </div>

    <!-- CONTENEDOR DE PASES ACTIVOS -->
    <div id="box-pases-activos" style="display:flex;flex-direction:column;gap:10px">
      <div style="text-align:center;padding:24px 10px;color:var(--texto-tenue);font-size:13px">
        ⏳ Cargando pases...
      </div>
    </div>

    <!-- CONTENEDOR DE HISTORIAL -->
    <div id="box-pases-historial" style="display:none;flex-direction:column;gap:10px">
      <div style="text-align:center;padding:24px 10px;color:var(--texto-tenue);font-size:13px">
        ⏳ Cargando historial...
      </div>
    </div>

    <!-- MODAL: NUEVO PASE QR -->
    <div id="modal-nuevo-pase" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:24px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 40px rgba(0,0,0,.25);max-height:90vh;overflow-y:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid var(--superficie-3);padding-bottom:10px">
          <div style="font-size:16px;font-weight:900;color:var(--marca)">🎟️ Crear Pase de Invitación QR</div>
          <button onclick="cerrarModal('modal-nuevo-pase')" style="border:none;background:var(--superficie-3);border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer;color:var(--texto-suave)">✕</button>
        </div>

        <form onsubmit="crearPaseInvitacion(event)">
          <!-- Nombre del Invitado -->
          <div style="margin-bottom:12px">
            <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Nombre del Invitado / Proveedor *</label>
            <input type="text" id="pase-nombre" class="inp" placeholder="Ej: Lucas González o Cadete PedidosYa" required style="margin-bottom:0">
          </div>

          <!-- Motivo de Acceso -->
          <div style="margin-bottom:12px">
            <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Motivo de la Visita</label>
            <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:6px">
              <label class="opt-motivo" style="display:flex;align-items:center;gap:6px;background:var(--superficie-2);border:1.5px solid var(--borde);border-radius:10px;padding:8px 10px;font-size:12.5px;font-weight:700;color:var(--texto-medio);cursor:pointer">
                <input type="radio" name="pase_motivo" value="🛵 Delivery" checked onchange="ajustarValidezPorMotivo('delivery')">
                <span>🛵 Delivery</span>
              </label>
              <label class="opt-motivo" style="display:flex;align-items:center;gap:6px;background:var(--superficie-2);border:1.5px solid var(--borde);border-radius:10px;padding:8px 10px;font-size:12.5px;font-weight:700;color:var(--texto-medio);cursor:pointer">
                <input type="radio" name="pase_motivo" value="👋 Visita" onchange="ajustarValidezPorMotivo('visita')">
                <span>👋 Visita</span>
              </label>
              <label class="opt-motivo" style="display:flex;align-items:center;gap:6px;background:var(--superficie-2);border:1.5px solid var(--borde);border-radius:10px;padding:8px 10px;font-size:12.5px;font-weight:700;color:var(--texto-medio);cursor:pointer">
                <input type="radio" name="pase_motivo" value="📦 Encomienda" onchange="ajustarValidezPorMotivo('encomienda')">
                <span>📦 Encomienda</span>
              </label>
              <label class="opt-motivo" style="display:flex;align-items:center;gap:6px;background:var(--superficie-2);border:1.5px solid var(--borde);border-radius:10px;padding:8px 10px;font-size:12.5px;font-weight:700;color:var(--texto-medio);cursor:pointer">
                <input type="radio" name="pase_motivo" value="🧰 Proveedor / Servicio" onchange="ajustarValidezPorMotivo('proveedor')">
                <span>🧰 Proveedor</span>
              </label>
            </div>
          </div>

          <!-- Validez -->
          <div style="margin-bottom:12px">
            <label style="font-size:11px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Validez del Pase</label>
            <select id="pase-validez" class="inp" onchange="toggleValidezPersonalizada()" style="margin-bottom:0">
              <option value="2h">⏱️ 2 Horas (Recomendado Delivery)</option>
              <option value="4h">⏱️ 4 Horas (Recomendado Visitas)</option>
              <option value="dia">📅 Todo el día (hasta las 23:59 hs)</option>
              <option value="custom">⚙️ Fecha y Hora Personalizada</option>
            </select>
          </div>

          <!-- Fechas Personalizadas (Oculto por defecto) -->
          <div id="box-validez-custom" style="display:none;margin-bottom:12px;background:var(--superficie-2);border:1px solid var(--borde);border-radius:12px;padding:10px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>
                <label style="font-size:10px;font-weight:800;color:var(--texto-suave);display:block;margin-bottom:2px">Desde</label>
                <input type="datetime-local" id="pase-custom-desde" class="inp" style="font-size:11px;margin-bottom:0;padding:0 6px">
              </div>
              <div>
                <label style="font-size:10px;font-weight:800;color:var(--texto-suave);display:block;margin-bottom:2px">Hasta</label>
                <input type="datetime-local" id="pase-custom-hasta" class="inp" style="font-size:11px;margin-bottom:0;padding:0 6px">
              </div>
            </div>
          </div>

          <!-- Sección Proveedor Recurrente (Días y Horarios) -->
          <div style="margin-bottom:14px;background:var(--superficie-3);border-radius:14px;padding:12px">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:var(--texto);cursor:pointer">
              <input type="checkbox" id="pase-es-recurrente" onchange="toggleRecurrente()">
              <span>🔁 Habilitar como pase recurrente (servicios/limpieza)</span>
            </label>

            <div id="box-recurrente-detalles" style="display:none;margin-top:10px;border-top:1px solid var(--borde);padding-top:10px">
              <div style="font-size:11px;font-weight:800;color:var(--texto-medio);margin-bottom:6px">Días habilitados de la semana:</div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:10px">
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;color:var(--texto-medio)"><input type="checkbox" name="dias_rec" value="Lunes" checked> Lun</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;color:var(--texto-medio)"><input type="checkbox" name="dias_rec" value="Martes"> Mar</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;color:var(--texto-medio)"><input type="checkbox" name="dias_rec" value="Miércoles" checked> Mié</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;color:var(--texto-medio)"><input type="checkbox" name="dias_rec" value="Jueves"> Jue</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;color:var(--texto-medio)"><input type="checkbox" name="dias_rec" value="Viernes" checked> Vie</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;color:var(--texto-medio)"><input type="checkbox" name="dias_rec" value="Sábado"> Sáb</label>
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;color:var(--texto-medio)"><input type="checkbox" name="dias_rec" value="Domingo"> Dom</label>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <div>
                  <label style="font-size:10.5px;font-weight:800;color:var(--texto-suave);display:block;margin-bottom:2px">Hora Entrada</label>
                  <input type="time" id="pase-rec-desde" class="inp" value="08:00" style="margin-bottom:0">
                </div>
                <div>
                  <label style="font-size:10.5px;font-weight:800;color:var(--texto-suave);display:block;margin-bottom:2px">Hora Salida</label>
                  <input type="time" id="pase-rec-hasta" class="inp" value="14:00" style="margin-bottom:0">
                </div>
              </div>
            </div>
          </div>

          <button type="submit" id="btn-submit-pase" class="btn-primary" style="margin-bottom:0">
            <span>✨ Generar Pase y Ver Código QR</span>
          </button>
        </form>
      </div>
    </div>

    <!-- MODAL: VER PASE QR Y COMPARTIR -->
    <div id="modal-ver-pase" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.75);backdrop-filter:blur(4px);z-index:99999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:24px;max-width:400px;width:100%;padding:24px 20px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:11px;font-weight:900;color:var(--ok);background:var(--ok-fondo);padding:3px 8px;border-radius:999px">✓ Pase Habilitado</span>
          <button onclick="cerrarModal('modal-ver-pase')" style="border:none;background:var(--superficie-3);border-radius:50%;width:28px;height:28px;font-size:15px;cursor:pointer;color:var(--texto-suave)">✕</button>
        </div>

        <h3 id="ver-pase-invitado" style="font-size:18px;font-weight:900;color:var(--marca);margin-bottom:2px">Invitado</h3>
        <p id="ver-pase-motivo" style="font-size:12px;color:var(--texto-suave);margin-bottom:12px">Motivo · Depto ${esc(v.departamento)}</p>

        <!-- Marco QR -->
        <div style="background:var(--superficie-2);border:2px dashed var(--acento);border-radius:18px;padding:14px;display:inline-block;margin-bottom:12px">
          <img id="ver-pase-qr-img" src="" style="width:190px;height:190px;display:block" alt="Código QR">
        </div>

        <div id="ver-pase-token" style="font-family:monospace;font-size:16px;font-weight:900;letter-spacing:2px;color:var(--marca);background:var(--acento-tenue);padding:6px 12px;border-radius:10px;display:inline-block;margin-bottom:12px">
          PASS-XXXXXXXX
        </div>

        <div id="ver-pase-validez" style="font-size:11.5px;color:var(--texto-medio);margin-bottom:16px;line-height:1.4">
          Válido hasta: ...
        </div>

        <!-- Botones de Acción -->
        <div style="display:flex;flex-direction:column;gap:8px">
          <button onclick="compartirPaseWhatsApp()" style="height:44px;border:none;border-radius:12px;background:#25D366;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 3px 10px rgba(37,211,102,.3)">
            <i class="ph ph-whatsapp-logo" style="font-size:20px"></i>
            <span>Compartir por WhatsApp</span>
          </button>
          <button onclick="copiarLinkPase()" class="btn-secondary" style="height:40px;font-size:12.5px">
            <i class="ph ph-copy" style="font-size:16px"></i>
            <span id="btn-copy-txt">Copiar Enlace del Pase</span>
          </button>
        </div>
      </div>
    </div>

    <script>
      var _pasesData = [];
      var _paseSeleccionado = null;

      function cambiarTabPases(tab) {
        var bAct = document.getElementById('tab-btn-activos');
        var bHis = document.getElementById('tab-btn-historial');
        var boxAct = document.getElementById('box-pases-activos');
        var boxHis = document.getElementById('box-pases-historial');

        if (tab === 'activos') {
          bAct.style.background = '#0F326A';
          bAct.style.color = '#fff';
          bHis.style.background = '#F1F5F9';
          bHis.style.color = '#64748B';
          boxAct.style.display = 'flex';
          boxHis.style.display = 'none';
        } else {
          bHis.style.background = '#0F326A';
          bHis.style.color = '#fff';
          bAct.style.background = '#F1F5F9';
          bAct.style.color = '#64748B';
          boxHis.style.display = 'flex';
          boxAct.style.display = 'none';
        }
      }

      function abrirModalNuevoPase() {
        document.getElementById('modal-nuevo-pase').style.display = 'flex';
      }

      function cerrarModal(id) {
        var m = document.getElementById(id);
        if (m) m.style.display = 'none';
      }

      function ajustarValidezPorMotivo(motivo) {
        var sel = document.getElementById('pase-validez');
        var chkRec = document.getElementById('pase-es-recurrente');
        if (motivo === 'delivery') {
          sel.value = '2h';
          chkRec.checked = false;
        } else if (motivo === 'visita') {
          sel.value = '4h';
          chkRec.checked = false;
        } else if (motivo === 'encomienda') {
          sel.value = '2h';
          chkRec.checked = false;
        } else if (motivo === 'proveedor') {
          sel.value = 'dia';
          chkRec.checked = true;
        }
        toggleRecurrente();
        toggleValidezPersonalizada();
      }

      function toggleValidezPersonalizada() {
        var val = document.getElementById('pase-validez').value;
        var box = document.getElementById('box-validez-custom');
        box.style.display = (val === 'custom') ? 'block' : 'none';
      }

      function toggleRecurrente() {
        var chk = document.getElementById('pase-es-recurrente').checked;
        var box = document.getElementById('box-recurrente-detalles');
        box.style.display = chk ? 'block' : 'none';
      }

      async function cargarPases() {
        try {
          var res = await fetch('/vecino/api/pases-qr');
          var data = await res.json();
          if (data && data.ok) {
            _pasesData = data.pases || [];
            renderPases();
          }
        } catch(_) {}
      }

      function renderPases() {
        var boxAct = document.getElementById('box-pases-activos');
        var boxHis = document.getElementById('box-pases-historial');
        var now = new Date();

        var activos = [];
        var historial = [];

        _pasesData.forEach(function(p) {
          var isExpired = p.valido_hasta && new Date(p.valido_hasta) < now;
          if (p.estado === 'activo' && !isExpired) {
            activos.push(p);
          } else {
            historial.push(p);
          }
        });

        document.getElementById('cnt-activos').textContent = activos.length;

        // Render activos
        if (activos.length === 0) {
          boxAct.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--texto-suave);font-size:13px;background:#fff;border-radius:18px"><div style="font-size:32px;margin-bottom:8px">🎟️</div>No tenés ningún pase activo en este momento.</div>';
        } else {
          var htmlActivos = '';
          for (var i = 0; i < activos.length; i++) {
            var p = activos[i];
            var fHasta = p.valido_hasta ? new Date(p.valido_hasta).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' hs' : (p.tipo_pase === 'recurrente' ? 'Recurrente' : 'Sin exp');
            htmlActivos += '<div class="card" style="padding:14px 16px;background:#fff;border-radius:18px;border:1px solid var(--borde);box-shadow:0 3px 10px rgba(15,23,42,.03)">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">' +
                '<div>' +
                  '<span style="font-size:11px;font-weight:800;color:#0284C7;background:var(--acento-tenue);padding:2px 8px;border-radius:8px">' + (p.motivo || 'Visita') + '</span>' +
                  '<h4 style="font-size:15px;font-weight:900;color:var(--texto);margin-top:4px">' + (p.nombre_invitado || '') + '</h4>' +
                '</div>' +
                '<span style="font-size:11px;font-weight:800;color:var(--ok);background:var(--ok-fondo);padding:2px 8px;border-radius:999px">● Activo</span>' +
              '</div>' +
              '<div style="font-size:12px;color:var(--texto-suave);margin-bottom:12px;display:flex;justify-content:space-between">' +
                '<span>Código: <strong style="color:var(--marca);font-family:monospace">' + (p.token || '') + '</strong></span>' +
                '<span>Vence: <strong>' + fHasta + '</strong></span>' +
              '</div>' +
              '<div style="display:flex;gap:8px">' +
                '<button onclick="verPaseModal(\'' + p.token + '\')" style="flex:1;height:38px;border:none;border-radius:10px;background:var(--marca);color:#fff;font-size:12px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">' +
                  '<i class="ph ph-qr-code" style="font-size:16px"></i>' +
                  '<span>Ver QR / Enviar</span>' +
                '</button>' +
                '<button onclick="revocarPase(\'' + p.token + '\')" style="height:38px;padding:0 12px;border:1.5px solid var(--error-borde);border-radius:10px;background:var(--error-fondo);color:var(--error);font-size:12px;font-weight:700;cursor:pointer">' +
                  'Revocar' +
                '</button>' +
              '</div>' +
            '</div>';
          }
          boxAct.innerHTML = htmlActivos;
        }

        // Render historial
        if (historial.length === 0) {
          boxHis.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--texto-suave);font-size:13px;background:#fff;border-radius:18px">Sin historial previo.</div>';
        } else {
          var htmlHis = '';
          for (var j = 0; j < historial.length; j++) {
            var ph = historial[j];
            var stLabel = (ph.estado === 'utilizado') ? 'Utilizado' : ((ph.estado === 'revocado') ? 'Revocado' : 'Vencido');
            var stColor = (ph.estado === 'utilizado') ? '#0284C7' : '#64748B';
            var stBg = (ph.estado === 'utilizado') ? '#E0F2FE' : '#F1F5F9';
            var fCreac = new Date(ph.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

            htmlHis += '<div class="card" style="padding:12px 14px;background:#fff;border-radius:16px;border:1px solid var(--borde);opacity:0.85">' +
              '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<div>' +
                  '<span style="font-size:10.5px;font-weight:700;color:var(--texto-suave)">' + fCreac + ' · ' + (ph.motivo || '') + '</span>' +
                  '<div style="font-size:13.5px;font-weight:800;color:var(--texto-medio)">' + (ph.nombre_invitado || '') + '</div>' +
                '</div>' +
                '<div style="text-align:right">' +
                  '<span style="font-size:11px;font-weight:800;color:' + stColor + ';background:' + stBg + ';padding:2px 8px;border-radius:999px">' + stLabel + '</span>' +
                  '<div style="font-size:11px;font-family:monospace;color:var(--texto-tenue);margin-top:2px">' + (ph.token || '') + '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
          }
          boxHis.innerHTML = htmlHis;
        }
      }

      async function crearPaseInvitacion(e) {
        e.preventDefault();
        var btn = document.getElementById('btn-submit-pase');
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Generando pase...</span>';

        var nombre = document.getElementById('pase-nombre').value.trim();
        var motivo = (document.querySelector('input[name="pase_motivo"]:checked') || {}).value || 'Visita';
        var validez = document.getElementById('pase-validez').value;
        var esRecurrente = document.getElementById('pase-es-recurrente').checked;

        var diasRec = [];
        if (esRecurrente) {
          document.querySelectorAll('input[name="dias_rec"]:checked').forEach(function(c){ diasRec.push(c.value); });
        }

        var customDesde = document.getElementById('pase-custom-desde').value;
        var customHasta = document.getElementById('pase-custom-hasta').value;
        var horaDesde = document.getElementById('pase-rec-desde').value;
        var horaHasta = document.getElementById('pase-rec-hasta').value;

        try {
          var res = await fetch('/vecino/api/pases-qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre_invitado: nombre,
              motivo: motivo,
              validez: validez,
              es_recurrente: esRecurrente,
              dias_semana: diasRec,
              custom_desde: customDesde,
              custom_hasta: customHasta,
              hora_desde: horaDesde,
              hora_hasta: horaHasta
            })
          });
          var data = await res.json();
          if (data && data.ok && data.pase) {
            cerrarModal('modal-nuevo-pase');
            document.getElementById('pase-nombre').value = '';
            cargarPases();
            verPaseModal(data.pase.token, data.pase);
          } else {
            alert(data.error || 'Error al generar el pase.');
          }
        } catch(ex) {
          alert('Error de conexión: ' + ex.message);
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<span>✨ Generar Pase y Ver Código QR</span>';
        }
      }

      function verPaseModal(token, paseObj) {
        var p = paseObj || _pasesData.find(function(x){ return x.token === token; });
        if (!p) return;
        _paseSeleccionado = p;

        document.getElementById('ver-pase-invitado').textContent = p.nombre_invitado;
        document.getElementById('ver-pase-motivo').textContent = p.motivo + ' · Depto ' + (p.departamento || '');
        document.getElementById('ver-pase-token').textContent = p.token;
        document.getElementById('ver-pase-qr-img').src = 'https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=10&data=' + encodeURIComponent(p.token);

        var fHasta = p.valido_hasta ? new Date(p.valido_hasta).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + ' hs' : (p.tipo_pase === 'recurrente' ? 'Días autorizados' : 'Sin límite');
        document.getElementById('ver-pase-validez').innerHTML = 'Válido hasta: <strong>' + fHasta + '</strong>';

        document.getElementById('modal-ver-pase').style.display = 'flex';
      }

      function obtenerTextoPase() {
        if (!_paseSeleccionado) return '';
        var p = _paseSeleccionado;
        var url = 'https://marcos.bienargentinos.com/porteria/pase/' + encodeURIComponent(p.token);
        return '¡Hola ' + p.nombre_invitado + '! Te comparto tu Pase QR de acceso para ' + p.edificio + (p.departamento ? ' Depto ' + p.departamento : '') + '.\n\nMostralo frente a la cámara del tótem de entrada al llegar:\n👉 ' + url + '\n\nCódigo: ' + p.token;
      }

      async function compartirPaseWhatsApp() {
        if (!_paseSeleccionado) return;
        var txt = obtenerTextoPase();
        var url = 'https://marcos.bienargentinos.com/porteria/pase/' + encodeURIComponent(_paseSeleccionado.token);

        if (navigator.share) {
          try {
            await navigator.share({
              title: 'Pase de Acceso · ' + _paseSeleccionado.edificio,
              text: txt,
              url: url
            });
            return;
          } catch(_) {}
        }

        var waUrl = 'https://wa.me/?text=' + encodeURIComponent(txt);
        window.open(waUrl, '_blank');
      }

      function copiarLinkPase() {
        if (!_paseSeleccionado) return;
        var url = 'https://marcos.bienargentinos.com/porteria/pase/' + encodeURIComponent(_paseSeleccionado.token);
        navigator.clipboard.writeText(url).then(function() {
          var btnTxt = document.getElementById('btn-copy-txt');
          btnTxt.textContent = '✓ ¡Enlace Copiado!';
          setTimeout(function(){ btnTxt.textContent = 'Copiar Enlace del Pase'; }, 2000);
        });
      }

      async function revocarPase(token) {
        if (!confirm('¿Estás seguro de que querés revocar este pase? El invitado ya no podrá ingresar.')) return;
        try {
          var res = await fetch('/vecino/api/pases-qr/revocar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
          });
          var data = await res.json();
          if (data && data.ok) {
            cargarPases();
          } else {
            alert(data.error || 'No se pudo revocar el pase.');
          }
        } catch(_) {
          alert('Error de conexión.');
        }
      }

      document.addEventListener('DOMContentLoaded', cargarPases);
    </script>
  `;

  res.send(shellVecino('Pases QR', 'pases', content, v));
});

// -------------------------------------------------------------------
// ENDPOINTS API DE PASES QR (VECINOS & PROVEEDORES)
// -------------------------------------------------------------------

router.get('/api/pases-qr', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { listarPasesEdificio } = require('./db-pg');
    const pases = await listarPasesEdificio(v.edificio, v.departamento);
    res.json({ ok: true, pases });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/pases-qr', async (req, res) => {
  try {
    const v = getVecinoSession(req);

    // Control estricto de seguridad: Solo vecinos confirmados con edificio asignado pueden crear pases
    if (!v || !v.edificio || !v.edificio.trim() || (v.unidades && v.unidades.length === 0)) {
      return res.status(403).json({
        ok: false,
        error: 'Acceso denegado: Necesit??s tener una unidad y edificio asignado y confirmado para emitir pases de ingreso.'
      });
    }
    const {
      nombre_invitado,
      motivo = 'Visita',
      validez = '2h',
      es_recurrente = false,
      dias_semana = [],
      custom_desde = null,
      custom_hasta = null,
      hora_desde = null,
      hora_hasta = null
    } = req.body || {};

    if (!nombre_invitado) {
      return res.status(400).json({ ok: false, error: 'El nombre del invitado es requerido.' });
    }

    // Generar token: PASS- + 8 caracteres alfanuméricos aleatorios
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let randStr = '';
    for (let i = 0; i < 8; i++) {
      randStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const token = 'PASS-' + randStr;

    // Calcular vigencia
    const now = new Date();
    let validoDesde = now;
    let validoHasta = null;
    let tipoPase = es_recurrente ? 'recurrente' : 'temporal';
    let usosPermitidos = es_recurrente ? 999 : 1;

    if (validez === '2h') {
      validoHasta = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    } else if (validez === '4h') {
      validoHasta = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    } else if (validez === 'dia') {
      validoHasta = new Date(now);
      validoHasta.setHours(23, 59, 59, 999);
    } else if (validez === 'custom') {
      if (custom_desde) validoDesde = new Date(custom_desde);
      if (custom_hasta) validoHasta = new Date(custom_hasta);
    }

    const { crearPaseQR } = require('./db-pg');
    const pase = await crearPaseQR({
      token,
      origen: 'edifica',
      edificio: v.edificio,
      departamento: v.departamento,
      creado_por_usuario_id: v.usuario_id || null,
      creado_por_nombre: nombreCompleto(v),
      nombre_invitado,
      motivo,
      tipo_pase: tipoPase,
      valido_desde: validoDesde,
      valido_hasta: validoHasta,
      dias_semana: es_recurrente ? dias_semana : [],
      hora_desde: es_recurrente ? hora_desde : null,
      hora_hasta: es_recurrente ? hora_hasta : null,
      usos_permitidos: usosPermitidos
    });

    res.json({ ok: true, pase });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/pases-qr/revocar', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { token, id } = req.body || {};
    const { revocarPaseQR } = require('./db-pg');
    const rev = await revocarPaseQR(id || token, v.edificio);
    res.json({ ok: true, pase: rev });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1. Configurar Timbre Personal (Switch ON/OFF & Horario No Molestar)
router.post('/api/timbre-config', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { timbre_activo, timbre_silencio_desde, timbre_silencio_hasta, timbre_no_molestar_activo } = req.body || {};

    // Actualizar en sesión activa
    if (req.session && req.session.vecino) {
      if (typeof timbre_activo !== 'undefined') req.session.vecino.timbre_activo = Boolean(timbre_activo);
      if (typeof timbre_no_molestar_activo !== 'undefined') req.session.vecino.timbre_no_molestar_activo = Boolean(timbre_no_molestar_activo);
      if (timbre_silencio_desde) req.session.vecino.timbre_silencio_desde = timbre_silencio_desde;
      if (timbre_silencio_hasta) req.session.vecino.timbre_silencio_hasta = timbre_silencio_hasta;
    }

    // Persistir en PostgreSQL si el usuario tiene ID
    if (v.usuario_id) {
      const { actualizarConfigTimbre } = require('./db-pg');
      await actualizarConfigTimbre(v.usuario_id, v.edificio, v.departamento, {
        timbre_activo: Boolean(timbre_activo),
        timbre_silencio_desde,
        timbre_silencio_hasta,
        timbre_no_molestar_activo: Boolean(timbre_no_molestar_activo)
      });
    }

    res.json({ ok: true, mensaje: 'Preferencia de timbre guardada.' });
  } catch (err) {
    console.error('Error en /vecino/api/timbre-config:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1b. Buscar usuario por email (para asignación previa con autocompletado)
router.get('/api/buscar-usuario-email', async (req, res) => {
  try {
    const { email } = req.query;
    const emailNorm = String(email || '').trim().toLowerCase();
    if (!emailNorm) {
      return res.json({ ok: false, error: 'Email requerido' });
    }
    const { obtenerUsuarioPorEmail } = require('./db-pg');
    const user = await obtenerUsuarioPorEmail(emailNorm);
    if (!user) {
      return res.json({ ok: true, existe: false });
    }
    return res.json({
      ok: true,
      existe: true,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido || '',
        email: user.email,
        telefono: user.telefono || ''
      }
    });
  } catch (err) {
    console.error('Error en /vecino/api/buscar-usuario-email:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1c. Asignar usuario registrado a la unidad (familiar, inquilino, turista o asistente)
router.post('/api/asignar-integrante-registrado', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    if (v.rol !== 'propietario' && v.rol !== 'asistente') {
      return res.status(403).json({ ok: false, error: 'Solo propietarios o administradores pueden asignar integrantes.' });
    }

    const { email, rol, fecha_desde, fecha_hasta } = req.body || {};
    const emailNorm = String(email || '').trim().toLowerCase();
    if (!emailNorm || !rol) {
      return res.status(400).json({ ok: false, error: 'Email y rol son obligatorios.' });
    }

    const { obtenerUsuarioPorEmail, asignarUsuarioAUnidad, asignarAsistenteAPropiedad } = require('./db-pg');
    const user = await obtenerUsuarioPorEmail(emailNorm);
    if (!user) {
      return res.status(400).json({
        ok: false,
        error: 'Usuario no registrado: Debe registrarse previamente en la app para poder asociarlo a la unidad.'
      });
    }

    if (rol === 'asistente') {
      await asignarAsistenteAPropiedad(v.usuario_id || 1, user.id, v.edificio, v.departamento);
      return res.json({
        ok: true,
        mensaje: `Gestión cedida exitosamente al asistente ${user.nombre} ${user.apellido || ''}.`
      });
    }

    const esTurista = (rol === 'turista');
    const puedeVerExpensas = !esTurista;

    await asignarUsuarioAUnidad(user.id, v.edificio, v.departamento, rol, {
      fecha_desde: fecha_desde || null,
      fecha_hasta: fecha_hasta || null,
      timbre_activo: true,
      puede_ver_expensas: puedeVerExpensas,
      asignado_por_usuario_id: v.usuario_id || null,
      notas: esTurista ? 'Pase de huésped turista' : `Asignado como ${rol} por titular`
    });

    return res.json({
      ok: true,
      mensaje: esTurista ? 'Pase huésped emitido con éxito.' : 'Integrante asignado a la unidad con éxito.'
    });
  } catch (err) {
    console.error('Error en /vecino/api/asignar-integrante-registrado:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1d. Desvincular integrante de la unidad
router.post('/api/desvincular-integrante', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    if (v.rol !== 'propietario' && v.rol !== 'asistente') {
      return res.status(403).json({ ok: false, error: 'Sin permisos para desvincular integrantes.' });
    }

    const { usuario_id } = req.body || {};
    if (!usuario_id) {
      return res.status(400).json({ ok: false, error: 'ID de usuario requerido.' });
    }

    if (Number(usuario_id) === Number(v.usuario_id)) {
      return res.status(400).json({ ok: false, error: 'No podés desvincular tu propio usuario titular.' });
    }

    const { desvincularIntegrante } = require('./db-pg');
    await desvincularIntegrante(Number(usuario_id), v.edificio, v.departamento);

    res.json({ ok: true, mensaje: 'Integrante desvinculado con éxito.' });
  } catch (err) {
    console.error('Error en /vecino/api/desvincular-integrante:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Obtener ocupantes de la unidad activa
router.get('/api/ocupantes-unidad', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { obtenerIntegrantesUnidad } = require('./db-pg');
    let integrantes = [];
    try {
      integrantes = await obtenerIntegrantesUnidad(v.edificio, v.departamento);
    } catch (_) {}

    // Si no hay registrados en base, generar lista inicial basada en el usuario actual
    if (!integrantes.length) {
      integrantes = [
        {
          usuario_id: v.usuario_id || 1,
          nombre: v.nombre,
          apellido: v.apellido || '',
          email: v.email,
          telefono: v.telefono,
          rol: v.rol || 'propietario',
          timbre_activo: v.timbre_activo !== false,
          puede_ver_expensas: v.puede_ver_expensas !== false
        }
      ];
    }

    res.json({ ok: true, ocupantes: integrantes });
  } catch (err) {
    console.error('Error en /vecino/api/ocupantes-unidad:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Agregar familiar / inquilino o registrar pase huésped
router.post('/api/agregar-ocupante', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    if (v.rol !== 'propietario' && v.rol !== 'asistente') {
      return res.status(403).json({ ok: false, error: 'Solo propietarios o administradores pueden agregar ocupantes.' });
    }

    const { email, nombre, apellido, telefono, password, rol, fecha_desde, fecha_hasta } = req.body || {};
    if (!email || !nombre) {
      return res.status(400).json({ ok: false, error: 'Email y nombre son obligatorios.' });
    }

    const { registrarOUsuario, asignarUsuarioAUnidad } = require('./db-pg');

    // Registrar o recuperar usuario
    const user = await registrarOUsuario({
      email,
      password: password || 'consorcio123',
      nombre,
      apellido: apellido || '',
      telefono: telefono || ''
    });

    const esTurista = (rol === 'turista');
    const puedeVerExpensas = !esTurista;

    await asignarUsuarioAUnidad({
      usuario_id: user.id,
      edificio: v.edificio,
      departamento: v.departamento,
      rol: rol || (esTurista ? 'turista' : 'conviviente'),
      fecha_desde: fecha_desde || null,
      fecha_hasta: fecha_hasta || null,
      timbre_activo: true,
      puede_ver_expensas: puedeVerExpensas,
      asignado_por_usuario_id: v.usuario_id || null,
      notas: esTurista ? 'Pase de huésped temporal' : 'Ocupante asignado por titular'
    });

    res.json({ ok: true, mensaje: esTurista ? 'Pase huésped emitido.' : 'Ocupante guardado con éxito.' });
  } catch (err) {
    console.error('Error en /vecino/api/agregar-ocupante:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Portafolio de unidades del asistente (o del propietario) para reubicación
router.get('/api/portafolio-asistente', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { obtenerPortafolioAsistente, obtenerUnidadesDeUsuario } = require('./db-pg');

    let unidades = [];
    if (v.rol === 'asistente' && v.usuario_id) {
      unidades = await obtenerPortafolioAsistente(v.usuario_id);
    } else if (v.usuario_id) {
      unidades = await obtenerUnidadesDeUsuario(v.usuario_id);
    }

    // Si aún no hay en BD, proveer unidades de la sesión
    if (!unidades.length && v.unidades && v.unidades.length > 0) {
      unidades = v.unidades.filter(u => !(u.edificio === v.edificio && u.departamento === v.departamento));
    }

    res.json({ ok: true, unidades });
  } catch (err) {
    console.error('Error en /vecino/api/portafolio-asistente:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Reubicar huésped turista a otra unidad disponible del portafolio
router.post('/api/reubicar-turista', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    if (v.rol !== 'asistente' && v.rol !== 'propietario') {
      return res.status(403).json({ ok: false, error: 'No tenés permisos para reubicar huéspedes.' });
    }

    const { usuario_id, nuevo_edificio, nuevo_departamento, motivo } = req.body || {};
    if (!usuario_id || !nuevo_departamento) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos (huésped o departamento de destino).' });
    }

    const { reubicarHuesped } = require('./db-pg');
    const resultado = await reubicarHuesped({
      usuario_id: Number(usuario_id),
      origen_edificio: v.edificio,
      origen_departamento: v.departamento,
      nuevo_edificio: nuevo_edificio || v.edificio,
      nuevo_departamento,
      motivo: motivo || 'Reubicación por gestión',
      operador_usuario_id: v.usuario_id || null
    });

    if (!resultado) {
      return res.status(400).json({ ok: false, error: 'No se pudo completar la reubicación.' });
    }

    res.json({ ok: true, mensaje: `Huésped reubicado exitosamente al departamento ${nuevo_departamento}.` });
  } catch (err) {
    console.error('Error en /vecino/api/reubicar-turista:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rutas PWA dentro del router del vecino
router.get(['/manifest.webmanifest', '/manifest.json'], (req, res) => {
  res.type('application/manifest+json');
  res.send(JSON.stringify({
    name: 'Marcos IA · Portal Vecinos',
    short_name: 'Mi Consorcio',
    description: 'Portal de Vecinos, Portería Virtual, Amenities y Reclamos de tu Consorcio',
    start_url: '/vecino',
    scope: '/',
    display: 'standalone',
    background_color: '#F8FAFD',
    theme_color: '#0F326A',
    orientation: 'any',
    icons: [
      {
        src: '/admin/assets/logo.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: '/admin/assets/logo.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ],
    shortcuts: [
      {
        name: 'Portería & Timbre',
        short_name: 'Portería',
        url: '/vecino',
        icons: [{ src: '/admin/assets/logo.png', sizes: '192x192' }]
      },
      {
        name: 'Reservar Amenities',
        short_name: 'Amenities',
        url: '/vecino/amenities',
        icons: [{ src: '/admin/assets/logo.png', sizes: '192x192' }]
      },
      {
        name: 'Hablar con Marcos IA',
        short_name: 'Marcos IA',
        url: '/vecino/chat',
        icons: [{ src: '/admin/assets/logo.png', sizes: '192x192' }]
      }
    ]
  }));
});

router.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
    const CACHE_NAME = 'marcos-pwa-v4';
    self.addEventListener('install', (e) => {
      self.skipWaiting();
    });

    self.addEventListener('activate', (e) => {
      e.waitUntil(
        caches.keys().then((keys) => {
          return Promise.all(
            keys.map((k) => caches.delete(k))
          );
        }).then(() => self.clients.claim())
      );
    });

    self.addEventListener('fetch', (e) => {
      if (e.request.method !== 'GET') return;
      e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
      );
    });
  `);
});

// -------------------------------------------------------------------
// 3. CHAT DIRECTO CON MARCOS IA (WEB EN TIEMPO REAL)
// -------------------------------------------------------------------
router.get('/chat', (req, res) => {
  const v = getVecinoSession(req);

  const content = `
    <!-- Header Chat -->
    <div class="card" style="padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="position:relative">
          <div style="width:40px;height:40px;border-radius:12px;background:var(--acento-tenue);color:var(--acento);display:flex;align-items:center;justify-content:center;font-size:20px"><i class="ph ph-headset"></i></div>
          <div style="position:absolute;bottom:-2px;right:-2px;width:11px;height:11px;border-radius:50%;background:#16A34A;border:2px solid #fff"></div>
        </div>
        <div>
          <div style="font-size:14.5px;font-weight:800;color:var(--marca)">Marcos IA en Línea</div>
          <div style="font-size:11.5px;color:var(--ok);font-weight:700">Atención 24/7 activa</div>
        </div>
      </div>
      <a href="https://wa.me/5491100000000" target="_blank" style="padding:6px 12px;border-radius:8px;background:var(--ok-fondo);color:var(--ok);font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px">
        <i class="ph ph-whatsapp-logo" style="font-size:15px"></i>
        <span>WhatsApp</span>
      </a>
    </div>

    <!-- Muro de Mensajes -->
    <div id="chat-stream" style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;min-height:320px">
      <div class="chat-bubble-marcos">
        ¡Hola ${primerNombre(v)}! Soy <strong>Marcos IA</strong>, el asistente de <strong>${v.edificio}</strong>. ¿En qué te puedo ayudar hoy? Podés consultarme sobre expensas, reportar una rotura o pedir datos del edificio.
      </div>
    </div>

    <!-- Sugerencias Rápidas -->
    <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;margin-bottom:10px">
      <button onclick="enviarSugerencia('¿Cuándo vencen las expensas?')" style="white-space:nowrap;padding:7px 12px;border-radius:999px;border:1px solid var(--borde-fuerte);background:#fff;font-size:12px;font-weight:700;color:var(--texto-medio);cursor:pointer">
        💳 ¿Cuándo vencen expensas?
      </button>
      <button onclick="enviarSugerencia('Reportar fuga de agua en el baño')" style="white-space:nowrap;padding:7px 12px;border-radius:999px;border:1px solid var(--borde-fuerte);background:#fff;font-size:12px;font-weight:700;color:var(--texto-medio);cursor:pointer">
        🔧 Reportar fuga de agua
      </button>
      <button onclick="enviarSugerencia('Horario y reglamento del SUM')" style="white-space:nowrap;padding:7px 12px;border-radius:999px;border:1px solid var(--borde-fuerte);background:#fff;font-size:12px;font-weight:700;color:var(--texto-medio);cursor:pointer">
        🎉 Horario del SUM
      </button>
    </div>

    <!-- Input Bar Fijo -->
    <div class="card" style="padding:8px 10px;display:flex;align-items:center;gap:8px">
      <button onclick="alert('Podés adjuntar fotos de desperfectos o comprobantes')" style="width:38px;height:38px;border-radius:10px;border:none;background:var(--superficie-3);color:var(--texto-suave);cursor:pointer;display:flex;align-items:center;justify-content:center">
        <i class="ph ph-camera" style="font-size:20px"></i>
      </button>
      <input id="chat-input" type="text" placeholder="Escribile a Marcos IA..." style="flex:1;height:40px;border:none;outline:none;font-size:14.5px;color:var(--texto)" onkeypress="if(event.key==='Enter')enviarMensaje()">
      <button onclick="enviarMensaje()" style="width:40px;height:40px;border-radius:10px;border:none;background:var(--acento);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <i class="ph ph-paper-plane-right-fill" style="font-size:18px"></i>
      </button>
    </div>

    <script>
      function enviarSugerencia(txt){
        document.getElementById('chat-input').value = txt;
        enviarMensaje();
      }

      async function enviarMensaje(){
        const inp = document.getElementById('chat-input');
        const txt = inp.value.trim();
        if(!txt) return;
        
        const stream = document.getElementById('chat-stream');
        
        // Burbuja usuario
        const userB = document.createElement('div');
        userB.className = 'chat-bubble-user';
        userB.textContent = txt;
        stream.appendChild(userB);
        inp.value = '';

        // Indicador de tipeo
        const typingEl = document.createElement('div');
        typingEl.className = 'typing-indicator';
        typingEl.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
        stream.appendChild(typingEl);
        window.scrollTo(0, document.body.scrollHeight);

        try {
          const res = await fetch('/vecino/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mensaje: txt })
          });
          const data = await res.json();
          typingEl.remove();

          const mB = document.createElement('div');
          mB.className = 'chat-bubble-marcos';
          mB.innerHTML = data.respuesta || 'Tomado Daniel. Cualquier novedad te aviso de inmediato.';
          stream.appendChild(mB);
        } catch(err){
          typingEl.remove();
          const mB = document.createElement('div');
          mB.className = 'chat-bubble-marcos';
          mB.innerHTML = 'Tomado. Recibí tu mensaje correctamente.';
          stream.appendChild(mB);
        }
        window.scrollTo(0, document.body.scrollHeight);
      }
    </script>
  `;

  res.send(shellVecino('Chat con Marcos', 'chat', content, v));
});

// Endpoint interactivo del Chat con Marcos IA
router.post('/api/chat', async (req, res) => {
  try {
    const { mensaje } = req.body || {};
    const v = getVecinoSession(req);

    let respuestaTexto = `Entendido ${primerNombre(v)}. Estoy procesando tu consulta para ${v.edificio} (${v.departamento}).`;

    // Si el módulo de Marcos IA está disponible, responder contextualmente
    if (marcosCara && typeof marcosCara.responderVecino === 'function') {
      try {
        // Inyectar documentación si no tiene unidad asignada
        let mensajeContextualizado = mensaje;
        if (!v.unidades || v.unidades.length === 0) {
           mensajeContextualizado = "[CONTEXTO DEL SISTEMA: Atendés a un usuario recién registrado SIN UNIDAD ASIGNADA. NO le tires instrucciones de golpe. Actuá como un asistente de recepción inteligente e investigá.\n\nREGLAS DE INTERACCIÓN:\n1. Indagá primero: preguntale qué relación tiene con el edificio (si es Propietario, Inquilino, Huésped de Airbnb, Gestor o Familiar).\n2. Una vez que te responda y defina su situación, dale la instrucción precisa:\n - Si es Propietario: Debe contactar a la Administración para vincular su email (" + v.email + ").\n - Si es Inquilino/Huésped/Gestor/Familiar: Debe pedirle al dueño/titular del departamento que lo asigne desde la pestaña 'Integrantes' ingresando su email (" + v.email + ").\n3. Si menciona que pertenece a un edificio específico o viene por una reserva, indicále que se comunique con la persona que le envió el enlace original.\n\nIMPORTANTE: Sé conversacional, hacé una sola pregunta a la vez y guialo paso a paso.]\n\nDice el usuario: " + mensaje;
        }

        const resp = await marcosCara.responderVecino({
          historial: [{ rol: 'vecino', texto: mensajeContextualizado }],
          vecino: { nombre: nombreCompleto(v), telefono: v.telefono, edificio: v.edificio, departamento: v.departamento },
          memoriaVecino: null,
          personalDeTurno: null,
          decisionCaso: { esProblema: false, tipoProblema: 'consulta' },
        });
        if (resp && resp.textoParaVecino) {
          respuestaTexto = resp.textoParaVecino;
        }
      } catch (errAi) {
        console.warn('Fallback chat web Marcos:', errAi.message);
      }
    }

    res.json({ ok: true, respuesta: respuestaTexto });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------------------------
// 4. MIS EXPENSAS (HISTORIAL, DATOS BANCARIOS & COMPROBANTES)
// -------------------------------------------------------------------
// Los comprobantes que se subieron mientras PostgreSQL no estaba disponible.
//
// Arrancaba con uno de mentira adentro --"Daniel Morales (1° A), $120.000, aprobado"-- que se le
// mostraba a cualquier vecino de cualquier edificio como si fuera un pago real. Ahora arranca
// vacío: la pantalla ya sabe qué decir cuando no hay ninguno.
const _comprobantesEnMemoria = [];

// El vecino abre SU expensa por acá, y por ningún otro lado.
//
// El PDF de una expensa vivía en `almacenamiento/expensas/`, que `index.js` servía entero con
// `express.static` y sin sesión: alcanzaba con adivinar el nombre del archivo. Desde que el panel
// publica por unidad eso dejó de ser un documento del edificio y pasó a ser el dato privado de una
// persona --cuánto paga, cuánto debe--, así que el motor cerró esas rutas con 403.
//
// Filtrar por unidad en la pantalla NO alcanzaba: eso protege la vista, no el archivo. Y estas URL
// circulan solas: Marcos comparte la expensa por WhatsApp y el vecino la reenvía.
//
// El permiso lo decide `puedeVerExpensa`, que es la MISMA función que llama el panel. No se
// reescribe el criterio acá: el día que cambie una regla tiene que cambiar en un solo lugar. Es
// exactamente lo que pasó con `buscarPerfilEdificio`, que quedó escrita dos veces y arreglar una
// copia no cambió nada en producción.
router.get('/expensa-archivo/:nombre', async (req, res) => {
  const v = getVecinoSession(req);
  const nombre = path.basename(String(req.params.nombre || ''));

  let expensa = null;
  try {
    const { expensasVisiblesDeUnidad } = require('./db-pg');
    const visibles = await expensasVisiblesDeUnidad(v.edificio, v.departamento);
    // Se busca entre las que este vecino puede ver, por el nombre del archivo. Si la fila no está
    // en esa lista, `puedeVerExpensa` va a decir que no --y es lo correcto: que no la encontremos
    // no se responde con el archivo.
    expensa = visibles.find(e => path.basename(String(e.url || '')) === nombre
                              || String(e.nombre || '') === nombre) || null;
  } catch (e) {
    // Si la base no contesta no se sirve el archivo. Fallar abierto acá es publicar cuánto paga
    // cada vecino; fallar cerrado cuesta que no pueda descargar su expensa hasta que vuelva la
    // base. De los dos errores se elige el que se puede deshacer.
    console.warn('No se pudo verificar el permiso de la expensa:', e.message);
    return res.status(503).send('No se pudo verificar el permiso. Probá de nuevo en un rato.');
  }

  const { puedeVerExpensa, rutaDelArchivo } = require('./expensa-privada');
  const { puede, motivo } = puedeVerExpensa({
    expensa,
    quien: {
      rol: 'vecino',
      edificio: v.edificio,
      departamento: v.departamento,
      puede_ver_expensas: v.puede_ver_expensas,
    },
  });
  if (!puede) return res.status(403).send(motivo || 'No tenés permiso para ver este archivo');

  const ruta = rutaDelArchivo(expensa.url || expensa.nombre);
  if (!ruta || !fs.existsSync(ruta)) {
    return res.status(404).send('El archivo no está en el servidor. Avisale a la Administración.');
  }
  return res.sendFile(ruta);
});

// Por dónde se baja una expensa. Nunca la `url` cruda de la fila: esa apunta a
// `/archivos/expensas/...`, que da 403 desde que el archivo dejó de ser público.
function enlaceDeExpensa(exp) {
  const nombre = path.basename(String((exp && (exp.url || exp.nombre)) || ''));
  return nombre ? '/vecino/expensa-archivo/' + encodeURIComponent(nombre) : '';
}

router.get('/expensas', async (req, res) => {
  const v = getVecinoSession(req);
  if (v.puede_ver_expensas === false) {
    return res.redirect('/vecino');
  }

  let expensas = [];
  let datosBanco = null;
  let misComprobantes = [];

  // 1. Obtener expensas reales de la base de datos
  try {
    const { pool } = require('./db-pg');
    if (pool) {
      // SOLO las que este vecino puede ver: la de SU unidad y la liquidación general del
      // edificio. La consulta filtraba nada más que por edificio, y desde que el panel publica
      // por unidad eso le mostraba a cada vecino la liquidación de todos sus vecinos --y el
      // botón de descarga de cada una--.
      //
      // La unidad sale de la sesión, de lo que el vecino tiene asignado. Nunca de algo que venga
      // en el pedido: si saliera de ahí, cualquiera pide la del vecino escribiendo su número de
      // unidad. Es el agujero que tenía `/api/pases-qr`.
      const { expensasVisiblesDeUnidad } = require('./db-pg');
      expensas = await expensasVisiblesDeUnidad(v.edificio, v.departamento);

      // Obtener comprobantes subidos
      // SOLO los comprobantes de ESTA unidad.
      //
      // La consulta filtraba nada mas que por edificio, y la variable se llama `misComprobantes`:
      // cualquier vecino de San Patricio 159 veia los ultimos diez pagos del edificio entero, con
      // el nombre de quien pago, el monto, el departamento --va escrito adentro de las notas-- y
      // el ENLACE al comprobante bancario de cada uno.
      //
      // Una fila sin departamento no se muestra. Son las de antes de que existiera la columna: no
      // se sabe de quien son, y esconder de mas es el error barato. Mostrarle a alguien la
      // transferencia de su vecino no se puede deshacer.
      const qFac = `SELECT * FROM facturas
                     WHERE (tipo = 'comprobante_pago' OR tipo = 'Recibo')
                       AND LOWER(edificio) = LOWER($1)
                       AND departamento IS NOT NULL
                       AND LOWER(TRIM(departamento)) = LOWER(TRIM($2))
                     ORDER BY id DESC LIMIT 10`;
      const resFac = await pool.query(qFac, [v.edificio, v.departamento || '']);
      if (resFac && resFac.rows && resFac.rows.length > 0) {
        misComprobantes = resFac.rows.map(r => ({
          id: r.id,
          edificio: r.edificio,
          vecino: r.proveedor,
          monto: r.monto ? ('$' + r.monto) : 'Informado',
          fecha: r.fecha ? new Date(r.fecha).toLocaleDateString('es-AR') : 'Reciente',
          url: r.url || '',
          estado: r.estado || 'pendiente_aprobacion',
          notas: r.notas || ''
        }));
      }
    }
  } catch (_) {}

  // Combinar con comprobantes en memoria sin duplicar
  const idsComprobantes = new Set(misComprobantes.map(c => String(c.id)));
  for (const cMem of _comprobantesEnMemoria) {
    if (!idsComprobantes.has(String(cMem.id))) {
      misComprobantes.push(cMem);
    }
  }

  // 2. Obtener datos bancarios del consorcio
  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const qEd = `SELECT id, edificio, nombre, cuit FROM edificios WHERE LOWER(edificio) = LOWER($1) OR LOWER(nombre) = LOWER($1) LIMIT 1`;
      const resEd = await pool.query(qEd, [v.edificio]);
      if (resEd && resEd.rows && resEd.rows.length > 0) {
        const r = resEd.rows[0];
        if (r.cbu || r.alias) {
          datosBanco = r;
        }
      }
    }
  } catch (_) {}

  // Fallback si el edificio aún no cargó CBU específico
  if (!datosBanco) {
    datosBanco = {
      banco: 'Banco Oficial del Consorcio',
      titular: 'Consorcio ' + (v.edificio || 'Edificio'),
      cbu: 'Consultar con Administración',
      alias: (v.edificio || 'consorcio').toLowerCase().replace(/[^a-z0-9]/g, '') + '.expensas',
    };
  }

  const ultimaExpensa = expensas.length > 0 ? expensas[0] : null;
  const historialExpensas = expensas.length > 1 ? expensas.slice(1) : [];

  const content = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:800;color:var(--marca);margin-bottom:2px">Mis Expensas</h2>
      <p style="font-size:13px;color:var(--texto-suave)">${v.edificio} · Unidad ${v.departamento}</p>
    </div>

    <!-- 1. Tarjeta Última Liquidación -->
    <div class="card" style="padding:20px;margin-bottom:16px;border-left:5px solid var(--acento);background:#fff">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <span style="font-size:11.5px;font-weight:800;color:var(--acento);text-transform:uppercase;letter-spacing:.05em">Liquidación del Mes</span>
        <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--acento-tenue);color:var(--acento)">Digital</span>
      </div>
      <div style="font-size:22px;font-weight:800;color:var(--texto);margin-bottom:4px">
        ${ultimaExpensa ? (ultimaExpensa.periodo || 'Período Vigente') : 'Período en Proceso'}
      </div>
      ${ultimaExpensa && ultimaExpensa.monto !== null ? `
      <!-- UNA EXPENSA GENERAL NO ES UNA DEUDA DE ESTA PERSONA.
           La liquidación del edificio trae el total de gastos del consorcio --en la carga real
           salió $1.284.650,40--. Mostrado con la misma etiqueta que el cupón de una unidad, el
           vecino lee que le están cobrando eso. Va con otra etiqueta, y no se esconde: en qué se
           fue la plata del consorcio es justo la transparencia que un vecino quiere. -->
      <div style="font-size:11.5px;font-weight:800;color:var(--texto-suave);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">
        ${ultimaExpensa.esDelEdificio ? 'Gastos del edificio' : 'Total a pagar'}
      </div>
      <div style="font-size:26px;font-weight:900;color:var(--texto);letter-spacing:-.02em;margin-bottom:2px">${esc(montoEnPesos(ultimaExpensa.monto))}</div>
      ${ultimaExpensa.esDelEdificio ? `
      <p style="font-size:12.5px;color:var(--texto-suave);line-height:1.45;margin-bottom:14px">Es el total del consorcio, no lo que te toca pagar a vos.</p>
      ` : `
      ${ultimaExpensa.vencimiento ? `<p style="font-size:12.5px;color:var(--texto-suave);margin-bottom:14px">Vence el ${esc(new Date(ultimaExpensa.vencimiento).toLocaleDateString('es-AR'))}</p>` : '<div style="margin-bottom:14px"></div>'}
      `}
      ` : `
      <p style="font-size:13px;color:var(--texto-suave);line-height:1.45;margin-bottom:14px">
        ${ultimaExpensa ? 'La administración publicó el documento de este período. El total todavía no está cargado.' : 'La administración publicará la liquidación digital de este mes a la brevedad.'}
      </p>
      `}
      ${ultimaExpensa && enlaceDeExpensa(ultimaExpensa) ? `
      <a href="${enlaceDeExpensa(ultimaExpensa)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:linear-gradient(180deg,var(--acento),var(--acento));color:#fff;font-weight:700;font-size:13.5px;box-shadow:0 3px 10px rgba(46,111,192,.3)">
        <i class="ph ph-file-pdf" style="font-size:18px"></i>
        <span>Ver / Descargar Liquidación</span>
      </a>` : `
      <div style="font-size:12.5px;color:var(--texto-tenue);background:var(--superficie-2);padding:8px 12px;border-radius:8px;border:1px dashed #DCE4F0">
        📄 Podés solicitar la copia por chat a Marcos IA en cualquier momento.
      </div>`}
    </div>

    <!-- 2. Datos Bancarios del Consorcio -->
    <div class="card" style="padding:18px 20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:20px">🏦</span>
        <div>
          <div style="font-size:15px;font-weight:800;color:var(--texto)">Datos para Transferencias</div>
          <div style="font-size:11.5px;color:var(--texto-suave)">Cuenta oficial del consorcio</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${datosBanco.titular ? `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--superficie-3);padding-bottom:6px">
          <span style="color:var(--texto-suave)">Titular:</span>
          <strong style="color:var(--texto)">${datosBanco.titular}</strong>
        </div>` : ''}
        ${datosBanco.banco ? `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--superficie-3);padding-bottom:6px">
          <span style="color:var(--texto-suave)">Banco:</span>
          <strong style="color:var(--texto)">${datosBanco.banco}</strong>
        </div>` : ''}
        ${datosBanco.cuit ? `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--superficie-3);padding-bottom:6px">
          <span style="color:var(--texto-suave)">CUIT:</span>
          <strong style="color:var(--texto)">${datosBanco.cuit}</strong>
        </div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--superficie-3);padding-bottom:6px">
          <div>
            <span style="color:var(--texto-suave);display:block;font-size:11.5px">Alias:</span>
            <strong style="color:var(--acento);font-size:14px">${datosBanco.alias || '—'}</strong>
          </div>
          ${datosBanco.alias ? `<button onclick="copiarTexto('${datosBanco.alias}', this)" style="padding:4px 10px;border-radius:6px;border:1px solid var(--borde-fuerte);background:var(--superficie-2);color:var(--acento);font-size:11.5px;font-weight:700;cursor:pointer">📋 Copiar</button>` : ''}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:2px">
          <div>
            <span style="color:var(--texto-suave);display:block;font-size:11.5px">CBU:</span>
            <strong style="color:var(--texto);font-size:13px;font-family:monospace">${datosBanco.cbu || '—'}</strong>
          </div>
          ${datosBanco.cbu ? `<button onclick="copiarTexto('${datosBanco.cbu}', this)" style="padding:4px 10px;border-radius:6px;border:1px solid var(--borde-fuerte);background:var(--superficie-2);color:var(--acento);font-size:11.5px;font-weight:700;cursor:pointer">📋 Copiar</button>` : ''}
        </div>
      </div>
    </div>

    <!-- 3. Formulario Subir Comprobante de Pago Con Previsualización -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;background:#FAFCFF;border:1.5px dashed #B8D5F8;border-radius:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:22px">📤</span>
        <div>
          <div style="font-size:15.5px;font-weight:800;color:var(--texto)">Informar Pago de Expensas</div>
          <div style="font-size:12px;color:var(--texto-suave)">Adjuntá tu transferencia bancaria para validación</div>
        </div>
      </div>

      <form id="form-comprobante" onsubmit="enviarComprobante(event)">
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Comprobante de Transferencia (Foto o PDF) <span style="color:#EF4444">*</span></label>
          <input type="file" id="inp-comprobante-file" accept="image/*,.pdf" style="display:none" onchange="previewComprobante(event)" required>
          
          <div id="box-select-comprobante" onclick="document.getElementById('inp-comprobante-file').click()" style="border:2px dashed #93C5FD;background:#fff;border-radius:12px;padding:16px;text-align:center;cursor:pointer">
            <div style="font-size:26px;margin-bottom:4px">🧾</div>
            <div style="font-size:13px;font-weight:800;color:var(--acento)">Seleccionar Foto o PDF del Comprobante</div>
            <div style="font-size:11.5px;color:var(--texto-suave)">Tocá para elegir desde tu celular o galería</div>
          </div>

          <!-- Preview de Comprobante Seleccionado -->
          <div id="preview-comprobante-box" style="display:none;position:relative;margin-top:10px;border-radius:12px;overflow:hidden;border:1px solid var(--borde-fuerte);background:#fff;padding:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <img id="preview-comprobante-img" src="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;display:none;border:1px solid var(--borde)">
              <div id="preview-comprobante-pdf-icon" style="width:54px;height:54px;border-radius:10px;background:var(--error-fondo);color:var(--error);display:none;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">
                📄
              </div>
              <div style="flex:1;overflow:hidden">
                <div id="preview-comprobante-name" style="font-size:13px;font-weight:800;color:var(--texto);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
                <div id="preview-comprobante-size" style="font-size:11.5px;color:var(--texto-suave)"></div>
              </div>
              <button type="button" onclick="quitarComprobante()" style="background:var(--superficie-3);border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;color:var(--texto-suave);font-size:14px;flex-shrink:0">✕</button>
            </div>
          </div>
        </div>

        <div style="margin-bottom:14px">
          <label style="font-size:12px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Importe Transferido</label>
          <input type="text" id="inp-comprobante-monto" placeholder="Ej: 85.400 (expensa de agosto)" class="inp" style="background:#fff;margin-bottom:0">
        </div>

        <button id="btn-comprobante" type="submit" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 3px 10px rgba(22,163,74,.25)">
          <i class="ph ph-check-circle" style="font-size:20px"></i>
          <span>Enviar Comprobante a la Administración</span>
        </button>
        <div id="comprobante-msg" style="display:none;margin-top:10px;padding:12px;border-radius:10px;font-size:13px;text-align:center"></div>
      </form>
    </div>

    <!-- 4. Mis Comprobantes Informados -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;border-radius:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:20px">📋</span>
        <div>
          <div style="font-size:15px;font-weight:800;color:var(--texto)">Mis Comprobantes Informados (${misComprobantes.length})</div>
          <div style="font-size:11.5px;color:var(--texto-suave)">Seguimiento de transferencias enviadas</div>
        </div>
      </div>

      ${misComprobantes.length > 0 ? `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${misComprobantes.map(c => {
          const isAprobado = c.estado === 'aprobado';
          return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--borde);border-radius:12px;background:var(--superficie-2);gap:10px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:38px;height:38px;border-radius:10px;background:var(--acento-tenue);color:var(--acento);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
                💵
              </div>
              <div>
                <div style="font-size:14px;font-weight:800;color:var(--texto)">${esc(c.monto || 'Comprobante')}</div>
                <div style="font-size:11.5px;color:var(--texto-suave)">📅 ${esc(c.fecha || 'Reciente')}${c.notas ? ' · ' + esc(c.notas) : ''}</div>
              </div>
            </div>
            <span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:${isAprobado ? '#DCFCE7' : '#FEF3C7'};color:${isAprobado ? '#15803D' : '#92400E'};border:1px solid ${isAprobado ? '#86EFAC' : '#FCD34D'}">
              ${isAprobado ? '✓ Imputado / Al Día' : '⏳ En Revisión'}
            </span>
          </div>`;
        }).join('')}
      </div>` : `
      <div style="text-align:center;padding:20px;color:var(--texto-tenue);font-size:12.5px;background:var(--superficie-2);border-radius:12px;border:1px dashed #DCE4F0">
        Aún no has informado pagos este período. Al subir tu comprobante quedará registrado acá para tu tranquilidad.
      </div>`}
    </div>

    <!-- 5. Historial Completo de Liquidaciones Anteriores -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;border-radius:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">📚</span>
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--texto)">Historial de Liquidaciones (${expensas.length} períodos)</div>
            <div style="font-size:11.5px;color:var(--texto-suave)">Descargá cualquier liquidación oficial de tu consorcio</div>
          </div>
        </div>
      </div>

      ${expensas.length > 0 ? `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${expensas.map((x, idx) => {
          // Por la ruta del portal, que verifica quién pregunta. La `url` cruda apunta a
          // `/archivos/expensas/...` y da 403: el archivo dejó de ser público el día que pasó a
          // tener el monto de una unidad adentro.
          const downloadUrl = enlaceDeExpensa(x);
          const isUltima = idx === 0;
          return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--borde);border-radius:12px;background:var(--superficie-2);gap:10px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:38px;height:38px;border-radius:10px;background:#FDECEC;color:#C0392B;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
                <i class="ph ph-file-pdf"></i>
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:14px;font-weight:800;color:var(--texto)">${x.periodo || 'Período'}</span>
                  ${isUltima ? '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--ok-fondo);color:var(--ok)">ÚLTIMO</span>' : ''}
                  <!-- Cuál de estas filas es la del edificio entero. Sin esto, dos liquidaciones
                       del mismo período se ven iguales y el vecino no sabe cuál es su cupón. -->
                  ${x.esDelEdificio ? '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--superficie-3);color:var(--texto-medio);border:1px solid var(--borde)">DEL EDIFICIO</span>' : ''}
                </div>
                <div style="font-size:11.5px;color:var(--texto-suave)">${x.nombre || 'Liquidación de Expensas'}</div>
              </div>
            </div>
            ${downloadUrl ? `
            <a href="${downloadUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:8px;background:#fff;border:1px solid var(--borde-fuerte);color:var(--acento);font-size:12.5px;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.04)">
              <i class="ph ph-download-simple" style="font-size:15px"></i>
              <span>Descargar PDF</span>
            </a>` : ''}
          </div>`;
        }).join('')}
      </div>` : `
      <div style="text-align:center;padding:24px 16px;color:var(--texto-tenue);font-size:13px;background:var(--superficie-2);border-radius:12px;border:1px dashed #DCE4F0">
        Las liquidaciones de períodos anteriores se irán archivando automáticamente acá a medida que la administración las publique.
      </div>`}
    </div>

    <script>
      function copiarTexto(texto, btn) {
        navigator.clipboard.writeText(texto).then(function() {
          var old = btn.textContent;
          btn.textContent = '✓ Copiado';
          setTimeout(function() { btn.textContent = old; }, 1500);
        });
      }

      function previewComprobante(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var pBox = document.getElementById('preview-comprobante-box');
        var sBox = document.getElementById('box-select-comprobante');
        var img = document.getElementById('preview-comprobante-img');
        var pdfIcon = document.getElementById('preview-comprobante-pdf-icon');
        var nameEl = document.getElementById('preview-comprobante-name');
        var sizeEl = document.getElementById('preview-comprobante-size');

        nameEl.textContent = file.name;
        sizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        if (file.type.startsWith('image/')) {
          var reader = new FileReader();
          reader.onload = function(evt) {
            img.src = evt.target.result;
            img.style.display = 'block';
            pdfIcon.style.display = 'none';
          };
          reader.readAsDataURL(file);
        } else {
          img.style.display = 'none';
          pdfIcon.style.display = 'flex';
        }

        sBox.style.display = 'none';
        pBox.style.display = 'block';
      }

      function quitarComprobante() {
        document.getElementById('inp-comprobante-file').value = '';
        document.getElementById('preview-comprobante-box').style.display = 'none';
        document.getElementById('box-select-comprobante').style.display = 'block';
      }

      async function enviarComprobante(e) {
        e.preventDefault();
        var fileInp = document.getElementById('inp-comprobante-file');
        var montoInp = document.getElementById('inp-comprobante-monto');
        var btn = document.getElementById('btn-comprobante');
        var msg = document.getElementById('comprobante-msg');

        if (!fileInp.files || !fileInp.files[0]) {
          alert('Por favor adjuntá el comprobante');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Enviando comprobante...</span>';

        var formData = new FormData();
        formData.append('comprobante', fileInp.files[0]);
        formData.append('monto', montoInp.value.trim());

        try {
          var res = await fetch('/vecino/api/comprobante-pago', {
            method: 'POST',
            body: formData
          });
          var data = await res.json();
          if (data && data.ok) {
            msg.style.display = 'block';
            msg.style.background = '#DCFCE7';
            msg.style.color = '#15803D';
            msg.style.border = '1px solid #86EFAC';
            msg.textContent = data.mensaje || '¡Comprobante enviado con éxito! Tu administración lo revisará a la brevedad.';
            fileInp.value = '';
            montoInp.value = '';
            btn.innerHTML = '<span>✓ Comprobante Registrado</span>';
            setTimeout(function(){ location.reload(); }, 1800);
          } else {
            msg.style.display = 'block';
            msg.style.background = '#FEE2E2';
            msg.style.color = '#991B1B';
            msg.style.border = '1px solid #FCA5A5';
            msg.textContent = 'Error: ' + (data.error || 'No se pudo enviar el comprobante');
            btn.disabled = false;
            btn.innerHTML = '<span>Reintentar envío</span>';
          }
        } catch (err) {
          msg.style.display = 'block';
          msg.style.background = '#FEE2E2';
          msg.style.color = '#991B1B';
          msg.style.border = '1px solid #FCA5A5';
          msg.textContent = 'Error de conexión al enviar el comprobante: ' + err.message;
          btn.disabled = false;
          btn.innerHTML = '<span>Reintentar envío</span>';
        }
      }
    </script>
  `;

  res.send(shellVecino('Mis Expensas', 'expensas', content, v));
});

// Endpoint receptor de Comprobantes de Pago
router.post('/api/comprobante-pago', uploadComprobante.single('comprobante'), async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { monto } = req.body || {};
    const file = req.file;

    if (!file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo de comprobante' });
    }

    const archivoUrl = '/archivos/facturas/' + file.filename;
    const nuevoComprobante = {
      id: Date.now(),
      edificio: v.edificio,
      vecino: nombreCompleto(v) + ' (' + v.departamento + ')',
      // Si no lo escribió, NO se inventa: acá había un '$120.000' fijo, así que un comprobante
      // sin monto llegaba al administrador con un importe que nadie dijo nunca.
      monto: monto ? ('$' + monto.replace(/^\$/, '')) : null,
      fecha: new Date().toLocaleDateString('es-AR'),
      url: archivoUrl,
      estado: 'pendiente_aprobacion',
      notas: 'Comprobante informado desde el Portal del Vecino'
    };

    // Guardar en la base de datos PostgreSQL si está disponible
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        // El departamento y el usuario van en columnas propias, no solo adentro del texto de
        // las notas: son con lo que despues se decide a QUIEN se le muestra este comprobante.
        const q = `INSERT INTO facturas (edificio, departamento, usuario_id, tipo, proveedor, monto, fecha, url, estado, notas, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, $8, $9, NOW())`;
        await pool.query(q, [
          v.edificio,
          v.departamento || null,
          v.usuario_id || null,
          'comprobante_pago',
          nombreCompleto(v) + ' (' + v.departamento + ')',
          monto || '0',
          archivoUrl,
          'pendiente_aprobacion',
          'Comprobante de transferencia subido por vecino ' + nombreCompleto(v) + ' (' + v.departamento + ')'
        ]);
      }
    } catch (errDb) {
      console.warn('Registro comprobante PG:', errDb.message);
    }

    _comprobantesEnMemoria.unshift(nuevoComprobante);

    // Notificar a la administración por WhatsApp si está configurado
    try {
      const marcosOps = require('./agentes/marcos-ops');
      if (marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
        const adminPhone = process.env.ADMIN_PHONE || '+5491150542005';
        const phoneId = process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
        const token = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
        const msgAlerta = `💳 *NUEVO COMPROBANTE DE EXPENSAS INFORMADO*\n\n` +
          `🏢 *Edificio:* ${v.edificio}\n` +
          `👤 *Vecino:* ${nombreCompleto(v)} (${v.departamento})\n` +
          `💵 *Monto:* ${nuevoComprobante.monto || 'no lo informó, está en el comprobante'}\n` +
          `📅 *Fecha:* ${nuevoComprobante.fecha}\n\n` +
          `👉 Ver en Panel: https://marcos.bienargentinos.com/admin/archivos`;
        await marcosOps.enviarWhatsApp(adminPhone, msgAlerta, phoneId, token).catch(() => {});
      }
    } catch (_) {}

    res.json({
      ok: true,
      mensaje: '¡Comprobante enviado con éxito! Tu administración lo revisará a la brevedad.',
      archivoUrl,
      comprobante: nuevoComprobante
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------------------------
// 5. AVISOS & NOVEDADES
// -------------------------------------------------------------------
router.get('/novedades', (req, res) => {
  const v = getVecinoSession(req);
  const t = textos(v.idioma);

  const content = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:800;color:var(--marca);margin-bottom:2px">Avisos del Edificio</h2>
      <p style="font-size:13px;color:var(--texto-suave)">Comunicaciones oficiales en ${v.edificio}</p>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="card" style="padding:16px 18px;border-left:4px solid #F59E0B">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--aviso-fondo);color:var(--aviso)">${esc(t('inicio.mantenimiento'))}</span>
          <span style="font-size:11.5px;color:var(--texto-tenue)">Hoy · 09:30 hs</span>
        </div>
        <div style="font-size:15px;font-weight:800;color:var(--texto);margin-bottom:4px">Limpieza de tanques de agua</div>
        <p style="font-size:13.5px;color:var(--texto-medio);line-height:1.45">
          Se realizará la limpieza semestral reglamentaria el jueves de 08:00 a 14:00 hs. Se sugiere almacenar agua para el consumo durante esa franja horaria.
        </p>
      </div>

      <div class="card" style="padding:16px 18px;border-left:4px solid #16A34A">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--ok-fondo);color:var(--ok)">Resuelto</span>
          <span style="font-size:11.5px;color:var(--texto-tenue)">Ayer</span>
        </div>
        <div style="font-size:15px;font-weight:800;color:var(--texto);margin-bottom:4px">Ascensor principal en servicio</div>
        <p style="font-size:13.5px;color:var(--texto-medio);line-height:1.45">
          El técnico de guardia de ServiElev reemplazó el sensor de seguridad. Ambos ascensores se encuentran funcionando con normalidad.
        </p>
      </div>
    </div>
  `;

  res.send(shellVecino('Avisos', 'novedades', content, v));
});

// -------------------------------------------------------------------
// 5.5 RECLAMOS & REPORTES DE ROTURAS CON FOTO
// -------------------------------------------------------------------
const _reclamosEnMemoria = [
  {
    id: 101,
    codigo_caso: 'CASO-2104',
    edificio: 'San Patricio 159',
    depto: '1° A',
    vecino: 'Daniel Morales',
    telefono: '+5491150542005',
    rubro: 'Plomería',
    problema: 'Goteo en la llave de paso de la cocina. Requiere cambio de cuerito.',
    urgencia: 'normal',
    foto_url: '',
    estado: 'en_curso',
    created_at: new Date(Date.now() - 36 * 3600000).toISOString()
  },
  {
    id: 102,
    codigo_caso: 'CASO-2089',
    edificio: 'San Patricio 159',
    depto: 'Palier Piso 1',
    vecino: 'Daniel Morales',
    telefono: '+5491150542005',
    rubro: 'Electricidad',
    problema: 'Luz dicroica del palier frente al ascensor quemada.',
    urgencia: 'normal',
    foto_url: '',
    estado: 'resuelto',
    created_at: new Date(Date.now() - 72 * 3600000).toISOString()
  }
];

function renderItemReclamo(r) {
  const estadoColor = r.estado === 'resuelto' ? { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC', label: '✓ Resuelto' }
    : r.estado === 'en_curso' ? { bg: '#EBF3FC', text: '#1E5FB4', border: '#93C5FD', label: '⚙️ En curso' }
    : { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D', label: '⏳ Pendiente' };

  const iconRubro = (r.rubro || '').toLowerCase().includes('plom') ? '💧'
    : (r.rubro || '').toLowerCase().includes('elec') ? '⚡'
    : (r.rubro || '').toLowerCase().includes('ascen') ? '🛗'
    : (r.rubro || '').toLowerCase().includes('cerraj') ? '🔑'
    : (r.rubro || '').toLowerCase().includes('limp') ? '🧹'
    : '🛠️';

  const fechaStr = r.created_at ? new Date(r.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Reciente';

  return `
    <div class="card" style="padding:14px 16px;background:#fff;border-radius:16px;border:1px solid var(--borde)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:18px">${iconRubro}</span>
          <span style="font-size:13.5px;font-weight:900;color:var(--texto)">${esc(r.rubro || 'Avería')}</span>
          <span style="font-size:11px;font-weight:800;color:var(--texto-suave);background:var(--superficie-3);padding:2px 6px;border-radius:6px">${esc(r.codigo_caso)}</span>
        </div>
        <span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:${estadoColor.bg};color:${estadoColor.text};border:1px solid ${estadoColor.border}">
          ${estadoColor.label}
        </span>
      </div>

      <p style="font-size:13px;color:var(--texto-medio);line-height:1.4;margin-bottom:8px">
        ${esc(r.problema)}
      </p>

      ${r.foto_url ? `
        <div style="margin-bottom:10px">
          <img src="${r.foto_url}" onclick="verFotoGrande(this.src)" style="width:72px;height:72px;border-radius:10px;object-fit:cover;border:1px solid var(--borde-fuerte);cursor:pointer" title="Click para ampliar">
        </div>
      ` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--texto-tenue);border-top:1px solid var(--superficie-3);padding-top:8px">
        <span>📍 ${esc(r.depto || 'Edificio')}</span>
        <span>🕒 ${fechaStr} hs</span>
      </div>
    </div>
  `;
}

router.get('/reclamos', async (req, res) => {
  const v = getVecinoSession(req);
  let reclamosLista = [];

  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const q = `SELECT * FROM reportes WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) ORDER BY created_at DESC LIMIT 30`;
      const result = await pool.query(q, [v.edificio, '%' + v.edificio + '%']);
      if (result && result.rows && result.rows.length > 0) {
        reclamosLista = result.rows.map(r => ({
          id: r.id,
          codigo_caso: r.codigo_caso || ('CASO-' + r.id),
          edificio: r.edificio,
          depto: r.depto || r.departamento || '1° A',
          vecino: r.vecino || 'Vecino',
          telefono: r.telefono || '',
          rubro: r.rubro || 'General',
          problema: r.problema || r.mensaje || '',
          urgencia: r.urgencia || 'normal',
          foto_url: r.foto_url || '',
          estado: r.estado || 'pendiente',
          created_at: r.created_at || new Date().toISOString()
        }));
      }
    }
  } catch (errDb) {
    console.warn('Carga reportes DB:', errDb.message);
  }

  // Combinar con memoria local sin duplicar
  const idsExistentes = new Set(reclamosLista.map(r => String(r.codigo_caso)));
  for (const rMem of _reclamosEnMemoria) {
    if (!idsExistentes.has(String(rMem.codigo_caso))) {
      reclamosLista.push(rMem);
    }
  }

  // Separar los propios del vecino vs los del edificio
  const misReclamos = reclamosLista.filter(r => 
    (r.depto && r.depto.toLowerCase().includes(v.departamento.toLowerCase())) ||
    esElMismoVecino(r.vecino, v)
  );
  const otrosReclamos = reclamosLista.filter(r => !misReclamos.includes(r));

  const totalActivos = reclamosLista.filter(r => r.estado !== 'resuelto').length;

  const content = `
    <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div>
        <h2 style="font-size:20px;font-weight:900;color:var(--marca);margin-bottom:2px">Reclamos y Averías</h2>
        <p style="font-size:13px;color:var(--texto-suave)">${esc(v.edificio)} · Depto ${esc(v.departamento)}</p>
      </div>
      <button onclick="abrirModalReclamo()" style="padding:10px 18px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(15,50,106,.25)">
        <i class="ph ph-plus-circle" style="font-size:18px"></i>
        <span>Reportar Rotura</span>
      </button>
    </div>

    <!-- TARJETA RESUMEN -->
    <div class="card" style="padding:16px 18px;background:#fff;margin-bottom:16px;border-radius:18px;display:flex;align-items:center;justify-content:space-around;text-align:center">
      <div>
        <div style="font-size:22px;font-weight:900;color:#D97706">${totalActivos}</div>
        <div style="font-size:11.5px;font-weight:700;color:var(--texto-suave);text-transform:uppercase">En Gestión</div>
      </div>
      <div style="width:1px;height:36px;background:var(--borde)"></div>
      <div>
        <div style="font-size:22px;font-weight:900;color:var(--ok)">${reclamosLista.filter(r => r.estado === 'resuelto').length}</div>
        <div style="font-size:11.5px;font-weight:700;color:var(--texto-suave);text-transform:uppercase">Resueltos</div>
      </div>
      <div style="width:1px;height:36px;background:var(--borde)"></div>
      <div>
        <div style="font-size:22px;font-weight:900;color:var(--marca)">${misReclamos.length}</div>
        <div style="font-size:11.5px;font-weight:700;color:var(--texto-suave);text-transform:uppercase">Mis Casos</div>
      </div>
    </div>

    <!-- LISTADO DE RECLAMOS DEL VECINO -->
    <div style="margin-bottom:20px">
      <div style="font-size:14px;font-weight:800;color:var(--texto);margin-bottom:10px;display:flex;align-items:center;gap:6px">
        <span>👤</span> Mis Reclamos Reportados (${misReclamos.length})
      </div>
      ${misReclamos.length === 0 ? `
        <div class="card" style="padding:24px 16px;text-align:center;color:var(--texto-suave);border-radius:16px">
          <div style="font-size:32px;margin-bottom:8px">🎉</div>
          <div style="font-size:14px;font-weight:700;color:var(--texto);margin-bottom:4px">No tenés reclamos activos</div>
          <p style="font-size:12.5px;color:var(--texto-suave)">Si notás alguna rotura en tu departamento o en el edificio, podés reportarla aquí.</p>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${misReclamos.map(r => renderItemReclamo(r)).join('')}
        </div>
      `}
    </div>

    <!-- RECLAMOS EN ÁREAS COMUNES DEL EDIFICIO -->
    ${otrosReclamos.length > 0 ? `
      <div style="margin-bottom:20px">
        <div style="font-size:14px;font-weight:800;color:var(--texto);margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <span>🏢</span> Averías en Áreas Comunes (${otrosReclamos.length})
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${otrosReclamos.map(r => renderItemReclamo(r)).join('')}
        </div>
      </div>
    ` : ''}

    <!-- MODAL NUEVO RECLAMO CON FOTO -->
    <div id="modal-nuevo-reclamo" style="position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px;box-sizing:border-box">
      <div style="background:#fff;width:100%;max-width:480px;border-radius:24px;padding:24px 20px;box-shadow:0 25px 50px rgba(0,0,0,.25);max-height:92vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:38px;height:38px;border-radius:10px;background:var(--acento-tenue);color:var(--acento);display:flex;align-items:center;justify-content:center;font-size:20px">
              🛠️
            </div>
            <div>
              <h3 style="font-size:17px;font-weight:900;color:var(--marca)">Reportar Reclamo o Rotura</h3>
              <div style="font-size:12px;color:var(--texto-suave)">${esc(v.edificio)}</div>
            </div>
          </div>
          <button onclick="cerrarModalReclamo()" style="width:32px;height:32px;border-radius:50%;border:none;background:var(--superficie-3);color:var(--texto-suave);font-size:15px;cursor:pointer">✕</button>
        </div>

        <form id="form-reclamo" onsubmit="enviarReclamo(event)">
          <!-- 1. Rubro con Chips -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Rubro / Tipo de Problema</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px" id="chips-rubros">
              <div class="chip-rubro active" onclick="seleccionarRubro('Plomería / Agua', this)">💧 Plomería</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Electricidad / Luces', this)">⚡ Electricidad</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Ascensores', this)">🛗 Ascensor</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Portón / Control de acceso', this)">🚪 Portón / Acceso</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Gas / Calefacción', this)">🔥 Gas</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Limpieza / Residuos', this)">🧹 Limpieza</div>
            </div>
          </div>

          <!-- 2. Ubicación -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Ubicación del Problema</label>
            <div style="display:flex;gap:8px">
              <label style="flex:1;display:flex;align-items:center;gap:6px;background:var(--superficie-2);border:1.5px solid var(--borde-fuerte);border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer">
                <input type="radio" name="ubicacion-tipo" value="depto" checked onchange="actualizarUbicacion(this.value)">
                <span>En mi Depto (${esc(v.departamento)})</span>
              </label>
              <label style="flex:1;display:flex;align-items:center;gap:6px;background:var(--superficie-2);border:1.5px solid var(--borde-fuerte);border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer">
                <input type="radio" name="ubicacion-tipo" value="comun" onchange="actualizarUbicacion(this.value)">
                <span>Área Común</span>
              </label>
            </div>
          </div>

          <!-- 3. Descripción -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Descripción del problema</label>
            <textarea id="desc-reclamo" placeholder="Explicá en detalle qué ocurre (ej: Hay una fuga de agua debajo del fregadero o la luz del palier no prende)..." required style="width:100%;height:80px;border:1.5px solid var(--borde-fuerte);border-radius:12px;padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none;resize:none;box-sizing:border-box"></textarea>
          </div>

          <!-- 4. Subir Foto / Cámara -->
          <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:800;color:var(--texto-medio);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Foto de la rotura (Muy Recomendado)</label>
            <input type="file" id="foto-input" accept="image/*" capture="environment" style="display:none" onchange="procesarFotoReclamo(event)">
            
            <div id="btn-foto-box" onclick="document.getElementById('foto-input').click()" style="border:2px dashed #93C5FD;background:var(--superficie-2);border-radius:14px;padding:16px;text-align:center;cursor:pointer">
              <div style="font-size:26px;margin-bottom:4px">📸</div>
              <div style="font-size:13px;font-weight:800;color:var(--acento)">Sacar Foto con la Cámara o Elegir de Galería</div>
              <div style="font-size:11.5px;color:var(--texto-suave)">Ayuda al técnico a traer el repuesto exacto</div>
            </div>

            <!-- Preview de Foto Cargada -->
            <div id="foto-preview-container" style="display:none;position:relative;margin-top:8px;border-radius:12px;overflow:hidden;border:1px solid var(--borde-fuerte)">
              <img id="foto-preview-img" src="" style="width:100%;height:180px;object-fit:cover;display:block">
              <button type="button" onclick="quitarFotoReclamo()" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
            </div>
          </div>

          <!-- 5. Urgencia -->
          <div style="margin-bottom:20px">
            <label style="display:flex;align-items:center;gap:8px;background:var(--error-fondo);border:1.5px solid var(--error-borde);border-radius:12px;padding:10px 14px;cursor:pointer">
              <input type="checkbox" id="check-urgente" style="width:18px;height:18px">
              <div>
                <div style="font-size:13px;font-weight:900;color:var(--error)">🚨 Marcar como Urgencia Grave</div>
                <div style="font-size:11px;color:#7F1D1D">Inundación, corte de luz general, fuga de gas o riesgo físico</div>
              </div>
            </label>
          </div>

          <button id="btn-enviar-reclamo" type="submit" style="width:100%;height:48px;border:none;border-radius:14px;background:linear-gradient(135deg,var(--marca),var(--acento));color:#fff;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 4px 14px rgba(15,50,106,.3);display:flex;align-items:center;justify-content:center;gap:8px">
            <span>Enviar Reclamo a Marcos IA</span>
          </button>
        </form>
      </div>
    </div>

    <!-- MODAL LIGHTBOX PARA VER FOTO EN GRANDE -->
    <div id="modal-lightbox" onclick="this.style.display='none'" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:none;align-items:center;justify-content:center;padding:16px">
      <img id="lightbox-img" src="" style="max-width:92%;max-height:85vh;border-radius:14px;object-fit:contain;box-shadow:0 20px 40px rgba(0,0,0,.5)">
    </div>

    <style>
      .chip-rubro {
        padding: 9px 12px;
        border-radius: 10px;
        border: 1.5px solid var(--borde);
        background: var(--superficie-2);
        font-size: 12.5px;
        font-weight: 700;
        color: var(--texto-medio);
        cursor: pointer;
        transition: all .15s;
        text-align: center;
      }
      .chip-rubro.active {
        border-color: #0F326A;
        background: var(--acento-tenue);
        color: var(--marca);
        font-weight: 800;
      }
    </style>

    <script>
      var _rubroSeleccionado = 'Plomería / Agua';
      var _fotoReclamoBase64 = '';
      var _ubicacionTipo = 'depto';

      function seleccionarRubro(nombre, el) {
        _rubroSeleccionado = nombre;
        document.querySelectorAll('.chip-rubro').forEach(function(c){ c.classList.remove('active'); });
        el.classList.add('active');
      }

      function actualizarUbicacion(val) {
        _ubicacionTipo = val;
      }

      function abrirModalReclamo() {
        document.getElementById('modal-nuevo-reclamo').style.display = 'flex';
      }

      function cerrarModalReclamo() {
        document.getElementById('modal-nuevo-reclamo').style.display = 'none';
      }

      function verFotoGrande(src) {
        document.getElementById('lightbox-img').src = src;
        document.getElementById('modal-lightbox').style.display = 'flex';
      }

      function procesarFotoReclamo(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(evt) {
          _fotoReclamoBase64 = evt.target.result;
          document.getElementById('foto-preview-img').src = _fotoReclamoBase64;
          document.getElementById('foto-preview-container').style.display = 'block';
          document.getElementById('btn-foto-box').style.display = 'none';
        };
        reader.readAsDataURL(file);
      }

      function quitarFotoReclamo() {
        _fotoReclamoBase64 = '';
        document.getElementById('foto-input').value = '';
        document.getElementById('foto-preview-container').style.display = 'none';
        document.getElementById('btn-foto-box').style.display = 'block';
      }

      async function enviarReclamo(e) {
        e.preventDefault();
        var btn = document.getElementById('btn-enviar-reclamo');
        var desc = document.getElementById('desc-reclamo').value.trim();
        var esUrgente = document.getElementById('check-urgente').checked;

        if (!desc) {
          alert('Por favor describí el problema.');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Registrando reclamo...</span>';

        try {
          var res = await fetch('/vecino/api/reclamos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rubro: _rubroSeleccionado,
              ubicacion: _ubicacionTipo,
              descripcion: desc,
              urgencia: esUrgente ? 'urgente' : 'normal',
              fotoBase64: _fotoReclamoBase64
            })
          });
          var data = await res.json();
          if (data && data.ok) {
            alert('✅ ¡Reclamo registrado con éxito! Código: ' + (data.codigoCaso || '') + '\\n\\nMarcos IA ya lo asignó y notificó a la Administración.');
            location.reload();
          } else {
            alert('Error al registrar reclamo: ' + (data.error || 'Intente nuevamente'));
            btn.disabled = false;
            btn.innerHTML = '<span>Enviar Reclamo a Marcos IA</span>';
          }
        } catch(err) {
          alert('Error de conexión: ' + err.message);
          btn.disabled = false;
          btn.innerHTML = '<span>Enviar Reclamo a Marcos IA</span>';
        }
      }
    </script>
  `;

  res.send(shellVecino('Reclamos', 'reclamos', content, v));
});

router.post('/api/reclamos', async (req, res) => {
  const v = getVecinoSession(req);
  const { rubro, ubicacion, descripcion, urgencia, fotoBase64 } = req.body || {};

  if (!descripcion || !descripcion.trim()) {
    return res.status(400).json({ ok: false, error: 'La descripción del problema es requerida.' });
  }

  const codigoCaso = 'CASO-' + Math.floor(1000 + Math.random() * 9000);
  const nuevoReclamo = {
    id: Date.now(),
    codigo_caso: codigoCaso,
    edificio: v.edificio,
    depto: ubicacion === 'comun' ? 'Área Común' : (v.departamento || '1° A'),
    vecino: nombreCompleto(v),
    telefono: v.telefono || '+5491150542005',
    rubro: rubro || 'Mantenimiento General',
    problema: descripcion.trim(),
    urgencia: urgencia || 'normal',
    foto_url: fotoBase64 || '',
    estado: 'pendiente',
    created_at: new Date().toISOString()
  };

  try {
    const { pool } = require('./db-pg');
    if (pool) {
      await pool.query(
        `INSERT INTO reportes (codigo_caso, edificio, depto, vecino, telefono, problema, urgencia, estado, foto_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          codigoCaso,
          v.edificio,
          nuevoReclamo.depto,
          nombreCompleto(v),
          nuevoReclamo.telefono,
          `[${nuevoReclamo.rubro}] ${nuevoReclamo.problema}`,
          nuevoReclamo.urgencia,
          'pendiente',
          nuevoReclamo.foto_url
        ]
      ).catch(e => console.warn('Error insertando en reportes PG:', e.message));
    }
  } catch (errDb) {
    console.warn('DB reportes error:', errDb.message);
  }

  _reclamosEnMemoria.unshift(nuevoReclamo);

  res.json({
    ok: true,
    mensaje: 'Reclamo registrado con éxito',
    codigoCaso: codigoCaso,
    reclamo: nuevoReclamo
  });
});

// -------------------------------------------------------------------
// 6. RESERVA DE AMENITIES Y SUM
// -------------------------------------------------------------------
router.get('/amenities', async (req, res) => {
  const v = getVecinoSession(req);
  let misReservas = [];
  let todasReservasEdificio = [];
  let amenitiesList = [];
  let datosBanco = null;

  try {
    const { pool } = require('./db-pg');
    if (pool) {
      // 1. Cargar amenities configurados para este edificio
      const qAm = `SELECT * FROM edificio_amenities 
                   WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) 
                   AND activo = TRUE ORDER BY id ASC`;
      const resAm = await pool.query(qAm, [v.edificio, '%' + v.edificio + '%']);
      if (resAm && resAm.rows && resAm.rows.length > 0) {
        amenitiesList = resAm.rows.map(a => ({
          id: String(a.id),
          nombre: a.nombre,
          icon: a.icono || '🎉',
          desc: a.descripcion || ('Capacidad ' + (a.capacidad || 20) + ' personas'),
          reglamento: a.reglamento || '',
          hora_apertura: a.hora_apertura || '08:00',
          hora_cierre: a.hora_cierre || '23:00',
          arancelado: Boolean(a.arancelado),
          tipo_arancel: a.tipo_arancel || 'por_hora',
          precio: Number(a.precio || 0),
          moneda: a.moneda || 'ARS'
        }));
      }

      // 2. Cargar reservas existentes
      const q = `SELECT * FROM reservas_amenities 
                 WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) 
                 AND estado != 'cancelada' 
                 ORDER BY fecha ASC, hora_desde ASC, id ASC`;
      const result = await pool.query(q, [v.edificio, '%' + v.edificio + '%']);
      if (result && result.rows) {
        todasReservasEdificio = result.rows;
        misReservas = result.rows.filter(r => 
          (r.departamento && r.departamento.toLowerCase() === v.departamento.toLowerCase()) ||
          esElMismoVecino(r.nombre_vecino, v)
        );
      }

      // 3. Cargar datos bancarios del edificio para transferencias de seña/arancel
      const qEd = `SELECT id, edificio, nombre, cuit FROM edificios WHERE LOWER(edificio) = LOWER($1) OR LOWER(nombre) = LOWER($1) LIMIT 1`;
      const resEd = await pool.query(qEd, [v.edificio]);
      if (resEd && resEd.rows && resEd.rows.length > 0) {
        const r = resEd.rows[0];
        try {
          const { pool: p } = require('./db-pg');
          const qB = `SELECT * FROM cuentas_bancarias WHERE edificio_id = $1 LIMIT 1`;
          const resB = await p.query(qB, [r.id]);
          if (resB && resB.rows && resB.rows.length > 0) {
            datosBanco = resB.rows[0];
          }
        } catch (errB) {
          console.warn('Carga datos banco:', errB.message);
        }
      }
    }
  } catch (errDb) {
    console.warn('Carga reservas amenities:', errDb.message);
  }

  // Fallback de datos bancarios si no fueron configurados específicamente
  if (!datosBanco) {
    datosBanco = {
      banco: 'Banco Oficial del Consorcio',
      titular: 'Consorcio ' + (v.edificio || 'Edificio'),
      cbu: 'Consultar con Administración',
      alias: (v.edificio || 'consorcio').toLowerCase().replace(/[^a-z0-9]/g, '') + '.expensas',
    };
  }

  // Si aún no se configuraron amenities en este edificio, usar catálogo estándar con aranceles sugeridos
  if (!amenitiesList.length) {
    amenitiesList = [
      { id: 'sum', nombre: 'SUM (Salón de Eventos)', icon: '🎉', desc: 'Capacidad 35 personas · Parrilla, vajilla, TV y aire frío/calor', reglamento: 'Música permitida hasta 01:00 hs. Seña de $15.000 para limpieza. Dejar vajilla limpia. Prohibido fumar adentro.', hora_apertura: '09:00', hora_cierre: '23:00', arancelado: true, tipo_arancel: 'por_hora', precio: 15000, moneda: 'ARS' },
      { id: 'parrilla', nombre: 'Parrilla / Quincho', icon: '🥩', desc: 'Capacidad 15 personas · Parrilla a leña, mesa exterior y bacha', reglamento: 'Uso de carbón o leña propios. Apagar brasas y limpiar la parrilla al finalizar.', hora_apertura: '10:00', hora_cierre: '23:00', arancelado: false, tipo_arancel: 'por_hora', precio: 0, moneda: 'ARS' },
      { id: 'pileta', nombre: 'Pileta & Solarium', icon: '🏊', desc: 'Solarium con reposeras · Temporada habilitada', reglamento: 'Uso obligatorio de gorro. Revisación médica previa. Menores de 12 años acompañados por un adulto.', hora_apertura: '09:00', hora_cierre: '20:00', arancelado: false, tipo_arancel: 'por_hora', precio: 0, moneda: 'ARS' },
      { id: 'gimnasio', nombre: 'Gimnasio', icon: '🏋️', desc: 'Cinta para correr, mancuernas, polea y bicicleta estática', reglamento: 'Uso de toalla obligatorio para las máquinas. Limpiar y desinfectar el equipamiento tras su uso.', hora_apertura: '07:00', hora_cierre: '22:00', arancelado: false, tipo_arancel: 'por_hora', precio: 0, moneda: 'ARS' },
      { id: 'cochera', nombre: 'Cochera de Cortesía', icon: '🚗', desc: 'Espacio de estacionamiento para visitas', reglamento: 'Máximo 48 hs continuas por visitante. Identificar vehículo con patente en portería.', hora_apertura: '08:00', hora_cierre: '23:00', arancelado: true, tipo_arancel: 'por_reserva', precio: 5000, moneda: 'ARS' },
      { id: 'laundry', nombre: 'Laundry / Lavadero', icon: '🧺', desc: 'Lavarropas y secarropas automáticos', reglamento: 'Utilizar jabón para lavarropas automáticos. Retirar prendas al terminar el ciclo.', hora_apertura: '08:00', hora_cierre: '21:00', arancelado: false, tipo_arancel: 'por_hora', precio: 0, moneda: 'ARS' }
    ];
  }

  const hoyStr = new Date().toISOString().split('T')[0];

  const content = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:800;color:var(--marca);margin-bottom:2px">Reserva de Amenities</h2>
      <p style="font-size:13px;color:var(--texto-suave)">Espacios comunes y turnos por hora en ${esc(v.edificio)}</p>
    </div>

    <!-- MIS RESERVAS PRÓXIMAS -->
    ${misReservas.length ? `
    <div class="card" style="margin-bottom:16px;padding:16px 18px">
      <div style="font-size:14px;font-weight:800;color:var(--texto);margin-bottom:10px;display:flex;align-items:center;gap:6px">
        <span>🎟️</span> Mis Reservas (${misReservas.length})
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${misReservas.map(r => {
          const montoNum = Number(r.monto || 0);
          const estadoPago = r.estado_pago || (montoNum > 0 ? 'pendiente' : 'no_requiere');
          let badgePago = '';
          if (montoNum > 0) {
            if (estadoPago === 'aprobado') {
              badgePago = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--ok-fondo);color:var(--ok);border:1px solid var(--ok-borde)">✅ Pago Aprobado ($' + montoNum.toLocaleString('es-AR') + ')</span>';
            } else if (estadoPago === 'comprobante_subido') {
              badgePago = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--aviso-fondo);color:var(--aviso);border:1px solid var(--aviso-borde)">⏳ Pago en Revisión ($' + montoNum.toLocaleString('es-AR') + ')</span>' +
                (r.comprobante_url ? ' <a href="' + r.comprobante_url + '" target="_blank" style="font-size:11px;font-weight:700;color:var(--acento);text-decoration:underline;margin-left:4px">👁️ Ver Comprobante</a>' : '');
            } else if (estadoPago === 'rechazado') {
              badgePago = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--error-fondo);color:var(--error);border:1px solid var(--error-borde)">❌ Comprobante Observado ($' + montoNum.toLocaleString('es-AR') + ')</span>' +
                ' <button onclick="abrirModalPagarReserva(' + r.id + ', \'' + escJs(r.amenity) + '\', ' + montoNum + ')" style="border:none;background:linear-gradient(135deg,#DC2626,#EF4444);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;margin-left:6px;box-shadow:0 2px 6px rgba(220,38,38,0.25)">🔄 Subir Nuevo Comprobante</button>';
            } else {
              badgePago = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--error-fondo);color:var(--error);border:1px solid var(--error-borde)">⚠️ Pago Pendiente ($' + montoNum.toLocaleString('es-AR') + ')</span>' +
                ' <button onclick="abrirModalPagarReserva(' + r.id + ', \'' + escJs(r.amenity) + '\', ' + montoNum + ')" style="border:none;background:linear-gradient(135deg,var(--acento),var(--acento));color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;margin-left:6px;box-shadow:0 2px 6px rgba(30,95,180,0.25)">💳 Subir Comprobante</button>';
            }
          } else {
            badgePago = '<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--superficie-3);color:var(--texto-suave)">🟢 Sin costo</span>';
          }

          return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--borde);border-radius:12px;background:var(--superficie-2);gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:220px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:14px;font-weight:800;color:var(--texto)">${esc(r.amenity)}</span>
                ${badgePago}
              </div>
              <div style="font-size:12px;color:var(--texto-suave)">📆 ${esc(r.fecha)} · ⏰ <strong>${esc(r.hora_desde || '00:00')} a ${esc(r.hora_hasta || '00:00')} hs</strong>${r.notas ? ' · ' + esc(r.notas) : ''}</div>
              ${estadoPago === 'rechazado' ? `
                <div style="background:#FFF1F2;border-left:3px solid #E11D48;border-radius:0 6px 6px 0;padding:6px 10px;margin-top:6px;font-size:11.5px;color:#9F1239">
                  <strong>⚠️ Observación de administración:</strong> ${esc(r.motivo_rechazo || 'El comprobante previo no pudo ser verificado. Por favor adjuntá uno nuevo legible.')}
                </div>
              ` : ''}
            </div>
            <button onclick="cancelarReserva(${r.id})" style="border:1px solid var(--error-borde);background:var(--error-fondo);color:var(--error);font-size:11.5px;font-weight:700;padding:5px 10px;border-radius:6px;cursor:pointer">Cancelar</button>
          </div>`;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <!-- FORMULARIO DE RESERVA POR HORAS (ESTILO BUTACAS / BLOQUES) -->
    <div class="card" style="margin-bottom:16px;padding:18px 20px">
      <div style="font-size:15px;font-weight:800;color:var(--texto);margin-bottom:14px;display:flex;align-items:center;gap:6px">
        <span>📅</span> Nueva Reserva por Horas
      </div>

      <form id="form-reserva-amenity" onsubmit="guardarReserva(event)">
        <!-- 1. Selección del Amenity -->
        <div style="margin-bottom:16px">
          <label style="font-size:12.5px;font-weight:700;color:var(--texto-medio);display:block;margin-bottom:8px">1. Elegí el espacio común</label>
          <div id="grid-amenities" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
            ${amenitiesList.map((a, idx) => `
              <div onclick="seleccionarAmenity('${escJs(a.nombre)}', this)" class="amenity-card-item ${idx === 0 ? 'selected' : ''}">
                <div style="font-size:26px;margin-bottom:4px">${esc(a.icon)}</div>
                <div class="amenity-title">${esc(a.nombre)}</div>
                <div class="amenity-time">${esc(a.hora_apertura)} a ${esc(a.hora_cierre)} hs</div>
                ${a.arancelado && a.precio > 0 
                  ? `<div class="amenity-badge-arancel">💰 $${Number(a.precio).toLocaleString('es-AR')} ${a.tipo_arancel === 'por_reserva' ? 'fijo' : '/ h'}</div>`
                  : `<div style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(74,222,128,0.12);color:var(--ok);border:1px solid rgba(74,222,128,0.3);margin-top:4px;display:inline-block">🟢 Sin costo</div>`
                }
              </div>
            `).join('')}
          </div>
          <input type="hidden" id="inp-amenity-sel" value="${esc(amenitiesList[0].nombre)}">
        </div>

        <!-- Caja Informativa de Arancel y CBU / Gratuito -->
        <div id="box-info-arancel" class="arancel-box" style="margin-bottom:16px;padding:12px 14px;border-radius:12px;display:none;line-height:1.5">
          <!-- Completado dinámicamente por JS -->
        </div>

        <!-- 2. Fecha -->
        <div style="margin-bottom:16px">
          <label style="font-size:12.5px;font-weight:700;color:var(--texto-medio);display:block;margin-bottom:6px">2. Elegí la fecha</label>
          <input type="date" id="inp-reserva-fecha" value="${hoyStr}" min="${hoyStr}" class="inp" style="background:#fff;margin-bottom:0" onchange="renderGrillaHoras()">
        </div>

        <!-- 3. Grilla de Horas Estilo Asientos de Cine -->
        <div style="margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label style="font-size:12.5px;font-weight:700;color:var(--texto-medio)">3. Tocá las horas que vas a utilizar (bloques de 1h)</label>
            <span style="font-size:11px;color:var(--texto-suave)">🟩 Libre · 🟥 Ocupado</span>
          </div>
          <div style="background:var(--superficie-2);border:1px solid var(--borde);border-radius:12px;padding:12px;margin-bottom:8px">
            <div id="grid-horas-container" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:8px">
              <!-- Renderizado dinámico vía JS -->
            </div>
          </div>
          <div id="resumen-seleccion-horas" style="display:none;background:var(--acento-tenue);border:1px solid var(--acento-borde);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--acento)">
            🕒 Horario seleccionado: <strong id="txt-rango-seleccion"></strong> (<span id="txt-duracion-horas"></span>)
            <div id="txt-total-arancel-resumen" style="margin-top:5px;font-weight:800;color:#1E3A8A"></div>
          </div>
        </div>

        <!-- 4. Notas / Motivo -->
        <div style="margin-bottom:16px">
          <label style="font-size:12.5px;font-weight:700;color:var(--texto-medio);display:block;margin-bottom:6px">Motivo / Cantidad de personas (opcional)</label>
          <input type="text" id="inp-reserva-notas" placeholder="Ej: Cumpleaños familiar o Reunión de trabajo" class="inp" style="background:#fff;margin-bottom:0">
        </div>

        <input type="hidden" id="inp-hora-desde" value="">
        <input type="hidden" id="inp-hora-hasta" value="">

        <button id="btn-submit-reserva" type="submit" disabled style="width:100%;height:48px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--acento),var(--acento));color:#fff;font-size:15px;font-weight:800;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:8px;opacity:0.5;box-shadow:0 3px 12px rgba(30,95,180,.3)">
          <i class="ph ph-check-circle" style="font-size:18px"></i>
          <span>Confirmar Reserva</span>
        </button>
      </form>
    </div>

    <!-- REGLAMENTO DINÁMICO DEL AMENITY SELECCIONADO -->
    <div id="box-reglamento-amenity" class="card" style="padding:16px 18px;background:var(--superficie-2)">
      <div style="font-size:13.5px;font-weight:800;color:var(--texto);margin-bottom:6px;display:flex;align-items:center;gap:6px">
        <span>📜</span> <span id="titulo-reglamento-amenity">Reglamento: ${esc(amenitiesList[0].nombre)}</span>
      </div>
      <div id="contenido-reglamento-amenity" style="font-size:12.5px;color:var(--texto-medio);line-height:1.6;background:#fff;padding:10px 14px;border:1px solid var(--borde);border-radius:10px">
        ${amenitiesList[0].reglamento ? esc(amenitiesList[0].reglamento) : 'Podés reservar desde 1 sola hora hasta varias continuas. El espacio debe entregarse limpio y en orden. Horario límite de música/ruidos: 01:00 hs.'}
      </div>
    </div>

    <!-- MODAL DE PAGO / SUBIDA DE COMPROBANTE DE RESERVA -->
    <div id="modal-pagar-reserva" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.3);overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid var(--borde);display:flex;align-items:center;justify-content:space-between;background:var(--superficie-2)">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:20px">💳</span>
            <span style="font-weight:800;font-size:15px;color:var(--texto)">Informar Pago de Reserva</span>
          </div>
          <button type="button" onclick="cerrarModalPagarReserva()" style="background:none;border:none;font-size:20px;color:var(--texto-suave);cursor:pointer">✕</button>
        </div>
        
        <form id="form-pago-reserva-modal" onsubmit="enviarComprobanteReserva(event)" style="padding:20px">
          <input type="hidden" id="inp-modal-reserva-id" value="">
          
          <div style="margin-bottom:12px">
            <div style="font-size:12.5px;color:var(--texto-suave)">Espacio a abonar:</div>
            <div id="txt-modal-amenity-nombre" style="font-size:15px;font-weight:800;color:var(--texto)"></div>
            <div id="txt-modal-arancel-info" style="font-size:13px;font-weight:700;color:var(--acento);margin-top:2px"></div>
          </div>

          <!-- Datos de transferencia bancaria -->
          <div style="background:var(--superficie-2);border:1px solid var(--borde);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--texto-medio)">
            <div style="font-weight:800;color:var(--texto);margin-bottom:4px">🏦 Datos Bancarios Oficiales:</div>
            <div>Titular: <strong>${esc(datosBanco.titular || 'Consorcio')}</strong></div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:3px">
              <span>Alias: <strong style="color:var(--acento)">${esc(datosBanco.alias || '—')}</strong></span>
              ${datosBanco.alias ? `<button type="button" onclick="copiarTexto('${escJs(datosBanco.alias)}', this)" style="padding:2px 8px;border-radius:4px;border:1px solid var(--borde-fuerte);background:#fff;color:var(--acento);font-size:11px;font-weight:700;cursor:pointer">Copiar</button>` : ''}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:3px">
              <span>CBU: <strong style="font-family:monospace">${esc(datosBanco.cbu || '—')}</strong></span>
              ${datosBanco.cbu ? `<button type="button" onclick="copiarTexto('${escJs(datosBanco.cbu)}', this)" style="padding:2px 8px;border-radius:4px;border:1px solid var(--borde-fuerte);background:#fff;color:var(--acento);font-size:11px;font-weight:700;cursor:pointer">Copiar</button>` : ''}
            </div>
          </div>

          <!-- Selector de Archivo con Preview -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:var(--texto-medio);display:block;margin-bottom:6px">Adjuntar Comprobante (Foto o PDF) <span style="color:#EF4444">*</span></label>
            <input type="file" id="inp-comprobante-reserva-file" accept="image/*,.pdf" style="display:none" onchange="previewComprobanteReserva(event)" required>
            
            <div id="box-select-comprobante-reserva" onclick="document.getElementById('inp-comprobante-reserva-file').click()" style="border:2px dashed #93C5FD;background:#FAFCFF;border-radius:12px;padding:16px;text-align:center;cursor:pointer">
              <div style="font-size:24px;margin-bottom:4px">🧾</div>
              <div style="font-size:13px;font-weight:800;color:var(--acento)">Seleccionar Foto o PDF del Comprobante</div>
              <div style="font-size:11px;color:var(--texto-suave)">Tocá para elegir desde tu dispositivo o galería</div>
            </div>

            <div id="preview-comprobante-reserva-box" style="display:none;position:relative;margin-top:8px;border-radius:10px;overflow:hidden;border:1px solid var(--borde-fuerte);background:#fff;padding:8px">
              <div style="display:flex;align-items:center;gap:10px">
                <img id="preview-comprobante-reserva-img" src="" style="width:54px;height:54px;object-fit:cover;border-radius:6px;display:none;border:1px solid var(--borde)">
                <div id="preview-comprobante-reserva-pdf" style="width:46px;height:46px;border-radius:8px;background:var(--error-fondo);color:var(--error);display:none;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
                  📄
                </div>
                <div style="flex:1;overflow:hidden">
                  <div id="preview-comprobante-reserva-name" style="font-size:12px;font-weight:800;color:var(--texto);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
                  <div id="preview-comprobante-reserva-size" style="font-size:11px;color:var(--texto-suave)"></div>
                </div>
                <button type="button" onclick="quitarComprobanteReserva()" style="background:var(--superficie-3);border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;color:var(--texto-suave);font-size:12px;flex-shrink:0">✕</button>
              </div>
            </div>
          </div>

          <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:800;color:var(--texto-medio);display:block;margin-bottom:6px">Monto Abonado ($)</label>
            <input type="text" id="inp-comprobante-reserva-monto" class="inp" style="background:#fff;margin-bottom:0" placeholder="Ej: 15000">
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button type="button" onclick="cerrarModalPagarReserva()" style="padding:10px 16px;border-radius:10px;border:1px solid var(--borde-fuerte);background:#fff;color:var(--texto-suave);font-size:13px;font-weight:700;cursor:pointer">Cancelar</button>
            <button id="btn-enviar-comprobante-reserva" type="submit" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-size:13.5px;font-weight:800;cursor:pointer;box-shadow:0 2px 8px rgba(22,163,74,.3)">Enviar Comprobante</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      var _todasReservas = ${JSON.stringify(todasReservasEdificio)};
      var _amenitiesList = ${JSON.stringify(amenitiesList)};
      var _horasSeleccionadas = [];

      function copiarTexto(texto, btn) {
        navigator.clipboard.writeText(texto).then(function() {
          var old = btn.textContent;
          btn.textContent = '✓ Copiado';
          setTimeout(function() { btn.textContent = old; }, 1500);
        });
      }

      function seleccionarAmenity(nombre, el) {
        document.getElementById('inp-amenity-sel').value = nombre;
        var cards = document.querySelectorAll('.amenity-card-item');
        cards.forEach(function(c) {
          c.classList.remove('selected');
        });
        if (el) el.classList.add('selected');
        _horasSeleccionadas = [];
        
        // Actualizar caja de reglamento específico
        var amObj = _amenitiesList.find(function(a){ 
          return a.nombre && a.nombre.toLowerCase() === nombre.toLowerCase(); 
        });
        var tReg = document.getElementById('titulo-reglamento-amenity');
        var cReg = document.getElementById('contenido-reglamento-amenity');
        if (tReg && amObj) tReg.textContent = 'Reglamento: ' + amObj.nombre;
        if (cReg && amObj) {
          cReg.textContent = amObj.reglamento ? amObj.reglamento : 'Podés reservar desde 1 sola hora hasta varias continuas. El espacio debe entregarse limpio y en orden. Horario límite de música/ruidos: 01:00 hs.';
        }

        // Actualizar caja informativa de arancel
        actualizarCajaArancel(amObj);

        renderGrillaHoras();
      }

      function actualizarCajaArancel(amObj) {
        var box = document.getElementById('box-info-arancel');
        if (!box) return;
        box.style.display = 'block';
        if (amObj && amObj.arancelado && amObj.precio > 0) {
          box.className = 'arancel-box arancel-pago';
          var esFijo = amObj.tipo_arancel === 'por_reserva';
          var modoTexto = esFijo ? 'tarifa fija por reserva' : 'por hora reservada';
          var calculoNota = esFijo 
            ? 'El arancel total es fijo independientemente de la cantidad de horas elegidas.' 
            : 'El costo total se calculará automáticamente multiplicando el arancel por la cantidad de horas que selecciones.';
          box.innerHTML = '<div style="font-size:13.5px;font-weight:800;margin-bottom:4px">💰 Arancel: <span class="txt-destacado-oro">$' + Number(amObj.precio).toLocaleString('es-AR') + '</span> <span style="font-size:12px;font-weight:600;opacity:0.9">(' + modoTexto + ')</span></div>' +
            '<div style="font-size:12px;line-height:1.45;margin-bottom:6px">' + calculoNota + '</div>' +
            '<div style="font-size:11.5px;line-height:1.4;opacity:0.95">Una vez confirmada la reserva, podrás transferir a la cuenta del consorcio (Alias: <strong class="txt-destacado-oro">${escJs(datosBanco.alias || '')}</strong>) y adjuntar el comprobante desde "Mis Reservas" para su validación oficial.</div>';
        } else {
          box.className = 'arancel-box arancel-gratis';
          box.innerHTML = '<div style="font-size:13px;font-weight:800;margin-bottom:2px">🟢 Espacio sin costo adicional</div>' +
            '<div style="font-size:12px;line-height:1.4">El uso de este amenity está incluido en el mantenimiento ordinario de las expensas.</div>';
        }
      }

      function parseHoraToNum(hStr) {
        if (!hStr) return 0;
        var parts = hStr.split(':');
        return parseInt(parts[0], 10) + (parseInt(parts[1] || 0, 10) / 60);
      }

      function renderGrillaHoras() {
        var inpHoraSel = document.getElementById('inp-amenity-sel');
        var amenityNombre = inpHoraSel ? inpHoraSel.value : '';
        var inpFecha = document.getElementById('inp-reserva-fecha');
        var fecha = inpFecha ? inpFecha.value : '';
        var grid = document.getElementById('grid-horas-container');
        if (!grid) return;
        grid.innerHTML = '';

        if (!fecha) {
          grid.innerHTML = '<div style="grid-column:1/-1;padding:12px;color:var(--texto-suave);font-size:12.5px;text-align:center">Elegí una fecha para ver los horarios disponibles.</div>';
          return;
        }

        var amenityObj = _amenitiesList.find(function(a){ 
          return a.nombre && amenityNombre && a.nombre.toLowerCase() === amenityNombre.toLowerCase(); 
        }) || _amenitiesList[0];

        var horaInicio = 8;
        var horaFin = 23;

        if (amenityObj) {
          if (amenityObj.hora_apertura) {
            var pIni = parseInt(String(amenityObj.hora_apertura).split(':')[0], 10);
            if (!isNaN(pIni)) horaInicio = pIni;
          }
          if (amenityObj.hora_cierre) {
            var pFin = parseInt(String(amenityObj.hora_cierre).split(':')[0], 10);
            if (!isNaN(pFin)) horaFin = pFin;
          }
        }

        // Si la hora de cierre es 00:00 (medianoche) o menor/igual que la apertura, normalizar a medianoche (24:00)
        if (horaFin === 0 || horaFin <= horaInicio) {
          horaFin = 24;
        }
        if (horaFin <= horaInicio) {
          horaFin = Math.min(24, horaInicio + 8);
        }

        // Buscar reservas existentes para esta fecha y amenity
        var reservasFecha = _todasReservas.filter(function(r) {
          return r.amenity && amenityNombre && 
                 r.amenity.toLowerCase() === amenityNombre.toLowerCase() && 
                 r.fecha === fecha && 
                 r.estado !== 'cancelada';
        });

        for (var h = horaInicio; h < horaFin; h++) {
          var hStartStr = String(h).padStart(2, '0') + ':00';
          var hEndStr = String(h + 1).padStart(2, '0') + ':00';

          // Verificar si esta hora cae dentro de alguna reserva
          var ocupadoPor = null;
          for (var i = 0; i < reservasFecha.length; i++) {
            var r = reservasFecha[i];
            if (r.hora_desde && r.hora_hasta) {
              var rStart = parseHoraToNum(r.hora_desde);
              var rEnd = parseHoraToNum(r.hora_hasta);
              if (h >= rStart && h < rEnd) {
                ocupadoPor = r.departamento || 'Depto';
                break;
              }
            } else if (r.turno) {
              if (r.turno.indexOf('Almuerzo') !== -1 && h >= 12 && h < 17) ocupadoPor = r.departamento || 'Depto';
              if (r.turno.indexOf('Cena') !== -1 && h >= 19 && h < 24) ocupadoPor = r.departamento || 'Depto';
              if (r.turno.indexOf('Mañana') !== -1 && h >= 8 && h < 13) ocupadoPor = r.departamento || 'Depto';
              if (r.turno.indexOf('Día Completo') !== -1 && h >= 10 && h < 23) ocupadoPor = r.departamento || 'Depto';
            }
          }

          var btnSlot = document.createElement('button');
          btnSlot.type = 'button';
          btnSlot.setAttribute('data-hora', h);

          if (ocupadoPor) {
            btnSlot.disabled = true;
            btnSlot.className = 'hora-slot-btn ocupado';
            btnSlot.innerHTML = '<span>🔒 ' + hStartStr + '</span><span style="font-size:9.5px;opacity:.8">' + ocupadoPor + '</span>';
          } else {
            var isSel = _horasSeleccionadas.indexOf(h) !== -1;
            btnSlot.className = 'hora-slot-btn' + (isSel ? ' selected' : '');
            btnSlot.innerHTML = '<span>' + hStartStr + '</span><span style="font-size:10px;font-weight:700;opacity:' + (isSel ? '1' : '.7') + '">' + (isSel ? '✓ Elegido' : 'Libre') + '</span>';
            
            btnSlot.onclick = (function(horaNum){
              return function() { toggleHora(horaNum); };
            })(h);
          }

          grid.appendChild(btnSlot);
        }

        if (grid.children.length === 0) {
          grid.innerHTML = '<div style="grid-column:1/-1;padding:14px;color:var(--texto-tenue);font-size:12.5px;text-align:center">No hay horarios disponibles configurados para este espacio.</div>';
        }

        actualizarResumenSeleccion();
      }

      function toggleHora(h) {
        var idx = _horasSeleccionadas.indexOf(h);
        if (idx !== -1) {
          _horasSeleccionadas.splice(idx, 1);
        } else {
          _horasSeleccionadas.push(h);
        }
        _horasSeleccionadas.sort(function(a,b){ return a - b; });
        renderGrillaHoras();
      }

      function actualizarResumenSeleccion() {
        var box = document.getElementById('resumen-seleccion-horas');
        var btn = document.getElementById('btn-submit-reserva');
        var inpHoraDesde = document.getElementById('inp-hora-desde');
        var inpHoraHasta = document.getElementById('inp-hora-hasta');
        var inpHoraSel = document.getElementById('inp-amenity-sel');
        var txtTotal = document.getElementById('txt-total-arancel-resumen');

        if (_horasSeleccionadas.length === 0) {
          box.style.display = 'none';
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
          btn.innerHTML = '<i class="ph ph-check-circle" style="font-size:18px"></i><span>Elegí las horas a reservar</span>';
          inpHoraDesde.value = '';
          inpHoraHasta.value = '';
          return;
        }

        var minH = _horasSeleccionadas[0];
        var maxH = _horasSeleccionadas[_horasSeleccionadas.length - 1] + 1;
        var duracion = _horasSeleccionadas.length;

        var strDesde = String(minH).padStart(2, '0') + ':00';
        var strHasta = String(maxH).padStart(2, '0') + ':00';

        inpHoraDesde.value = strDesde;
        inpHoraHasta.value = strHasta;

        var amenityNombre = inpHoraSel ? inpHoraSel.value : '';
        var amObj = _amenitiesList.find(function(a){ 
          return a.nombre && amenityNombre && a.nombre.toLowerCase() === amenityNombre.toLowerCase(); 
        }) || _amenitiesList[0];

        var total = 0;
        var detallePrecio = '';
        if (amObj && amObj.arancelado && amObj.precio > 0) {
          if (amObj.tipo_arancel === 'por_reserva') {
            total = Number(amObj.precio);
            detallePrecio = '💰 Total a abonar: $' + total.toLocaleString('es-AR') + ' (tarifa fija por reserva)';
          } else {
            total = Number(amObj.precio) * duracion;
            detallePrecio = '💰 Total a abonar: $' + total.toLocaleString('es-AR') + ' (' + duracion + (duracion === 1 ? ' hora' : ' horas') + ' × $' + Number(amObj.precio).toLocaleString('es-AR') + ')';
          }
        } else {
          detallePrecio = '🟢 Espacio sin costo adicional';
        }

        box.style.display = 'block';
        document.getElementById('txt-rango-seleccion').textContent = strDesde + ' a ' + strHasta + ' hs';
        document.getElementById('txt-duracion-horas').textContent = duracion + (duracion === 1 ? ' hora' : ' horas');
        if (txtTotal) {
          txtTotal.textContent = detallePrecio;
        }

        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        var btnSubTexto = total > 0 ? (' · $' + total.toLocaleString('es-AR')) : ' · Sin costo';
        btn.innerHTML = '<i class="ph ph-check-circle" style="font-size:18px"></i><span>Confirmar Reserva (' + duracion + (duracion === 1 ? ' hr' : ' hrs') + btnSubTexto + ')</span>';
      }

      async function guardarReserva(e) {
        e.preventDefault();
        var amenity = document.getElementById('inp-amenity-sel').value;
        var fecha = document.getElementById('inp-reserva-fecha').value;
        var horaDesde = document.getElementById('inp-hora-desde').value;
        var horaHasta = document.getElementById('inp-hora-hasta').value;
        var notas = document.getElementById('inp-reserva-notas').value;
        var btn = document.getElementById('btn-submit-reserva');

        if (!horaDesde || !horaHasta) {
          alert('Por favor seleccioná al menos 1 hora en la grilla.');
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Guardando reserva...';

        try {
          var res = await fetch('/vecino/api/reservar-amenity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amenity: amenity, fecha: fecha, hora_desde: horaDesde, hora_hasta: horaHasta, notas: notas })
          });
          var data = await res.json();
          if (data.ok) {
            if (data.monto && Number(data.monto) > 0) {
              alert('✓ ¡Reserva registrada de ' + horaDesde + ' a ' + horaHasta + ' hs!\\n\\nEste espacio requiere un arancel de $' + Number(data.monto).toLocaleString('es-AR') + '.\\nPodés transferir y adjuntar el comprobante ahora mismo o más tarde desde "Mis Reservas".');
              abrirModalPagarReserva(data.id, amenity, data.monto);
            } else {
              alert('✓ ¡Reserva confirmada de ' + horaDesde + ' a ' + horaHasta + ' hs con éxito!');
              location.reload();
            }
          } else {
            alert('Error: ' + (data.error || 'No se pudo completar la reserva'));
            btn.disabled = false;
            btn.textContent = 'Confirmar Reserva';
          }
        } catch(err) {
          alert('Error de conexión al guardar la reserva.');
          btn.disabled = false;
          btn.textContent = 'Confirmar Reserva';
        }
      }

      function abrirModalPagarReserva(reservaId, amenityNombre, monto) {
        document.getElementById('inp-modal-reserva-id').value = reservaId;
        document.getElementById('txt-modal-amenity-nombre').textContent = amenityNombre;
        document.getElementById('txt-modal-arancel-info').textContent = 'Arancel / Seña: $' + Number(monto || 0).toLocaleString('es-AR');
        document.getElementById('inp-comprobante-reserva-monto').value = monto || '';
        quitarComprobanteReserva();
        var modal = document.getElementById('modal-pagar-reserva');
        modal.style.display = 'flex';
      }

      function cerrarModalPagarReserva() {
        var modal = document.getElementById('modal-pagar-reserva');
        modal.style.display = 'none';
        location.reload();
      }

      function previewComprobanteReserva(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var pBox = document.getElementById('preview-comprobante-reserva-box');
        var sBox = document.getElementById('box-select-comprobante-reserva');
        var img = document.getElementById('preview-comprobante-reserva-img');
        var pdfIcon = document.getElementById('preview-comprobante-reserva-pdf');
        var nameEl = document.getElementById('preview-comprobante-reserva-name');
        var sizeEl = document.getElementById('preview-comprobante-reserva-size');

        nameEl.textContent = file.name;
        sizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        if (file.type.startsWith('image/')) {
          var reader = new FileReader();
          reader.onload = function(evt) {
            img.src = evt.target.result;
            img.style.display = 'block';
            pdfIcon.style.display = 'none';
          };
          reader.readAsDataURL(file);
        } else {
          img.style.display = 'none';
          pdfIcon.style.display = 'flex';
        }

        sBox.style.display = 'none';
        pBox.style.display = 'block';
      }

      function quitarComprobanteReserva() {
        var fileInp = document.getElementById('inp-comprobante-reserva-file');
        if (fileInp) fileInp.value = '';
        var pBox = document.getElementById('preview-comprobante-reserva-box');
        var sBox = document.getElementById('box-select-comprobante-reserva');
        if (pBox) pBox.style.display = 'none';
        if (sBox) sBox.style.display = 'block';
      }

      async function enviarComprobanteReserva(e) {
        e.preventDefault();
        var fileInp = document.getElementById('inp-comprobante-reserva-file');
        var montoInp = document.getElementById('inp-comprobante-reserva-monto');
        var reservaIdInp = document.getElementById('inp-modal-reserva-id');
        var btn = document.getElementById('btn-enviar-comprobante-reserva');

        if (!fileInp.files || !fileInp.files[0]) {
          alert('Por favor adjuntá el comprobante de transferencia.');
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Enviando comprobante...';

        var formData = new FormData();
        formData.append('comprobante', fileInp.files[0]);
        formData.append('reserva_id', reservaIdInp.value);
        formData.append('monto', montoInp.value.trim());

        try {
          var res = await fetch('/vecino/api/comprobante-reserva', {
            method: 'POST',
            body: formData
          });
          var data = await res.json();
          if (data && data.ok) {
            alert(data.mensaje || '¡Comprobante enviado con éxito! La administración lo revisará a la brevedad.');
            cerrarModalPagarReserva();
          } else {
            alert('Error: ' + (data.error || 'No se pudo enviar el comprobante'));
            btn.disabled = false;
            btn.textContent = 'Enviar Comprobante';
          }
        } catch(err) {
          alert('Error de conexión al enviar el comprobante: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Enviar Comprobante';
        }
      }

      async function cancelarReserva(id) {
        if (!confirm('¿Estás seguro de cancelar esta reserva?')) return;
        try {
          var res = await fetch('/vecino/api/cancelar-reserva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
          });
          var data = await res.json();
          if (data.ok) {
            alert('✓ Reserva cancelada. El horario quedó disponible para otros vecinos.');
            location.reload();
          } else {
            alert('Error al cancelar');
          }
        } catch(err) {
          alert('Error de conexión');
        }
      }

      function initAmenitiesView() {
        if (_amenitiesList && _amenitiesList.length > 0) {
          actualizarCajaArancel(_amenitiesList[0]);
        }
        renderGrillaHoras();
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAmenitiesView);
      } else {
        initAmenitiesView();
      }
    </script>
  `;

  res.send(shellVecino('Amenities', 'amenities', content, v));
});

// Endpoint Crear Reserva de Amenity por Horas
router.post('/api/reservar-amenity', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { amenity, fecha, hora_desde, hora_hasta, notas } = req.body || {};

    if (!amenity || !fecha || !hora_desde || !hora_hasta) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios para la reserva (amenity, fecha, horario)' });
    }

    const { pool } = require('./db-pg');
    let monto = 0;
    let estado_pago = 'no_requiere';

    if (pool) {
      // 1. Averiguar si el amenity es arancelado, tipo de arancel y su precio
      try {
        const qAm = `SELECT arancelado, precio, tipo_arancel FROM edificio_amenities 
                     WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2))
                     AND LOWER(nombre) = LOWER($3) AND activo = TRUE LIMIT 1`;
        const amRes = await pool.query(qAm, [v.edificio, '%' + v.edificio + '%', amenity]);
        let precioBase = 0;
        let tipoArancel = 'por_hora';
        let esArancelado = false;

        if (amRes && amRes.rows && amRes.rows.length > 0) {
          const amRow = amRes.rows[0];
          esArancelado = Boolean(amRow.arancelado);
          precioBase = Number(amRow.precio || 0);
          tipoArancel = amRow.tipo_arancel || 'por_hora';
        } else {
          // Fallback para SUM ($15000) y Cochera ($5000) si no estaban en DB
          if (/sum|salón|salon/i.test(amenity)) {
            esArancelado = true;
            precioBase = 15000;
            tipoArancel = 'por_hora';
          } else if (/cochera|estacionamiento/i.test(amenity)) {
            esArancelado = true;
            precioBase = 5000;
            tipoArancel = 'por_reserva';
          }
        }

        if (esArancelado && precioBase > 0) {
          const hDesdeNum = parseInt(hora_desde.split(':')[0], 10) + (parseInt(hora_desde.split(':')[1] || 0, 10) / 60);
          const hHastaNum = parseInt(hora_hasta.split(':')[0], 10) + (parseInt(hora_hasta.split(':')[1] || 0, 10) / 60);
          const duracionHoras = Math.max(1, Math.round(hHastaNum - hDesdeNum));

          if (tipoArancel === 'por_reserva') {
            monto = precioBase;
          } else {
            monto = precioBase * duracionHoras;
          }
          estado_pago = 'pendiente';
        }
      } catch (errAm) {
        console.warn('Verificación arancel amenity:', errAm.message);
      }

      // 2. Validar solapamiento con alguna reserva activa
      const qCheck = `SELECT id, departamento, hora_desde, hora_hasta, turno FROM reservas_amenities 
                      WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2))
                      AND LOWER(amenity) = LOWER($3)
                      AND fecha = $4
                      AND estado != 'cancelada'`;
      const checkRes = await pool.query(qCheck, [v.edificio, '%' + v.edificio + '%', amenity, fecha]);
      
      if (checkRes && checkRes.rows && checkRes.rows.length > 0) {
        const nuevaStart = parseInt(hora_desde.split(':')[0], 10) + (parseInt(hora_desde.split(':')[1] || 0, 10) / 60);
        const nuevaEnd = parseInt(hora_hasta.split(':')[0], 10) + (parseInt(hora_hasta.split(':')[1] || 0, 10) / 60);

        for (const r of checkRes.rows) {
          if (r.hora_desde && r.hora_hasta) {
            const exStart = parseInt(r.hora_desde.split(':')[0], 10) + (parseInt(r.hora_desde.split(':')[1] || 0, 10) / 60);
            const exEnd = parseInt(r.hora_hasta.split(':')[0], 10) + (parseInt(r.hora_hasta.split(':')[1] || 0, 10) / 60);
            
            if (!(nuevaEnd <= exStart || nuevaStart >= exEnd)) {
              return res.status(400).json({ 
                ok: false, 
                error: `El horario de ${hora_desde} a ${hora_hasta} se superpone con una reserva del Depto ${r.departamento || 'vecino'} (${r.hora_desde} a ${r.hora_hasta} hs).` 
              });
            }
          }
        }
      }

      const turnoLabel = `${hora_desde} a ${hora_hasta} hs`;
      const qIns = `INSERT INTO reservas_amenities (edificio, amenity, fecha, hora_desde, hora_hasta, turno, departamento, nombre_vecino, telefono, estado, notas, monto, estado_pago, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()) RETURNING id`;
      const insRes = await pool.query(qIns, [
        v.edificio,
        amenity,
        fecha,
        hora_desde,
        hora_hasta,
        turnoLabel,
        v.departamento,
        nombreCompleto(v),
        v.telefono || '',
        'confirmada',
        notas || '',
        monto,
        estado_pago
      ]);

      // La reserva también queda anotada como evento del edificio, para que el administrador la
      // vea en el panel junto con todo lo demás y no tenga que ir a mirar otra tabla.
      //
      // Va DESPUÉS del INSERT y sin `await` que corte: la reserva del vecino ya está guardada y
      // confirmada. Si el panel falla, se pierde una fila del historial -- molesto. Si por eso se
      // le devolviera un error al vecino, se perdería la reserva, que no tiene ninguna
      // justificación. `registrarReservaComoEvento` no lanza: atrapa y deja el error en el log.
      require('./reserva-evento').registrarReservaComoEvento({
        edificio:     v.edificio,
        departamento: v.departamento,
        vecino:       nombreCompleto(v),
        telefono:     v.telefono || '',
        amenity,
        fecha,
        horaDesde:    hora_desde,
        horaHasta:    hora_hasta,
        monto,
        estadoPago:   estado_pago,
        notas:        notas || '',
      });

      return res.json({
        ok: true,
        mensaje: 'Reserva confirmada con éxito',
        id: insRes.rows[0].id,
        monto,
        estado_pago
      });
    }

    res.json({ ok: true, mensaje: 'Reserva registrada', id: Date.now(), monto, estado_pago });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Endpoint receptor de Comprobantes de Pago de Reservas de Amenities
router.post('/api/comprobante-reserva', uploadComprobante.single('comprobante'), async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { reserva_id, monto } = req.body || {};
    const file = req.file;

    if (!file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo de comprobante' });
    }

    const archivoUrl = '/archivos/facturas/' + file.filename;
    const montoFormateado = monto ? ('$' + String(monto).replace(/^\$/, '')) : '$0';
    
    let amenityNombre = 'Amenity';

    // 1. Actualizar reserva en PostgreSQL
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        if (reserva_id) {
          const resReserva = await pool.query('SELECT amenity FROM reservas_amenities WHERE id = $1', [reserva_id]);
          if (resReserva && resReserva.rows && resReserva.rows.length > 0) {
            amenityNombre = resReserva.rows[0].amenity || 'Amenity';
          }
          await pool.query(
            `UPDATE reservas_amenities 
             SET estado_pago = 'comprobante_subido', comprobante_url = $1, motivo_rechazo = NULL 
             WHERE id = $2`, 
            [archivoUrl, reserva_id]
          );
        }

        // 2. Insertar en tabla facturas (comprobante de pago unificado visible en expensas y panel admin)
        const qFact = `INSERT INTO facturas (edificio, tipo, clase, proveedor, concepto, monto, fecha, url, url_archivo, estado, notas, created_at)
                       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, $8, $9, $10, NOW())`;
        await pool.query(qFact, [
          v.edificio,
          'Recibo',
          'Gasto fijo',
          nombreCompleto(v) + ' (' + v.departamento + ')',
          'Comprobante de pago de reserva ' + amenityNombre + (reserva_id ? (' #' + reserva_id) : ''),
          monto || '0',
          archivoUrl,
          archivoUrl,
          'Pendiente',
          'Comprobante de pago de reserva ' + amenityNombre + (reserva_id ? (' #' + reserva_id) : '') + ' - ' + nombreCompleto(v) + ' (' + v.departamento + ')'
        ]);
      }
    } catch (errDb) {
      console.warn('Registro comprobante reserva PG:', errDb.message);
    }

    // 3. Registrar en memoria para que aparezca de inmediato en /vecino/expensas
    const nuevoComprobante = {
      id: Date.now(),
      edificio: v.edificio,
      vecino: nombreCompleto(v) + ' (' + v.departamento + ')',
      monto: montoFormateado,
      fecha: new Date().toLocaleDateString('es-AR'),
      url: archivoUrl,
      estado: 'pendiente_aprobacion',
      notas: '🎟️ Reserva: ' + amenityNombre + (reserva_id ? (' #' + reserva_id) : '')
    };
    _comprobantesEnMemoria.unshift(nuevoComprobante);

    // 4. Notificar a la administración por WhatsApp
    try {
      const marcosOps = require('./agentes/marcos-ops');
      if (marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
        const adminPhone = process.env.ADMIN_PHONE || '+5491150542005';
        const phoneId = process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
        const token = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
        const msgAlerta = `🎟️ *NUEVO COMPROBANTE DE RESERVA DE AMENITY*\n\n` +
          `🏢 *Edificio:* ${v.edificio}\n` +
          `👤 *Vecino:* ${nombreCompleto(v)} (${v.departamento})\n` +
          `🎉 *Espacio:* ${amenityNombre}\n` +
          `💵 *Monto informado:* ${montoFormateado}\n` +
          `📅 *Fecha:* ${nuevoComprobante.fecha}\n\n` +
          `👉 Ver en Panel: https://marcos.bienargentinos.com/admin/amenities`;
        await marcosOps.enviarWhatsApp(adminPhone, msgAlerta, phoneId, token).catch(() => {});
      }
    } catch (_) {}

    res.json({
      ok: true,
      mensaje: '¡Comprobante de reserva recibido con éxito! La administración lo revisará a la brevedad.',
      archivoUrl
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Endpoint Cancelar Reserva
router.post('/api/cancelar-reserva', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { id } = req.body || {};

    if (!id) return res.status(400).json({ ok: false, error: 'ID de reserva requerido' });

    const { pool } = require('./db-pg');
    if (pool) {
      const q = `UPDATE reservas_amenities SET estado = 'cancelada' WHERE id = $1`;
      await pool.query(q, [id]);
    }

    res.json({ ok: true, mensaje: 'Reserva cancelada' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ==========================================
// RUTA TEMPORAL PARA CREAR TURISTA DE PRUEBA
// ==========================================
router.get('/crear-turista-prueba', async (req, res) => {
  try {
    const { pool } = require('./db-pg');
    const email = 'turista@consorcio.ai';
    const pass = 'turista123';
    await pool.query(`
      INSERT INTO usuarios (email, password_hash, nombre, apellido, telefono, activo, created_at, updated_at)
      VALUES ($1, $2, 'Huésped', 'Turista', '1155554444', TRUE, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [email, pass]);
    res.send(`
      <div style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>¡Turista Creado!</h2>
        <p>Ya podés usar el email <b>turista@consorcio.ai</b> en el panel para asignarlo.</p>
        <a href="/vecino/integrantes" style="padding:10px 20px;background:var(--marca);color:white;text-decoration:none;border-radius:10px;">Volver a Integrantes</a>
      </div>
    `);
  } catch(e) {
    res.send('Error: ' + e.message);
  }
});

module.exports = router;
