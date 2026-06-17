/**
 * dashboard.js
 * -------------------------------------------------------------------
 * Dashboard web del administrador para "Marcos IA".
 *
 * Router de Express que se monta en /admin del servidor principal:
 *
 *     const dashboard = require('./dashboard');
 *     app.use('/admin', dashboard);
 *
 * Caracteristicas:
 *   - Login simple (admin / marcos2024) con express-session.
 *   - Resumen del dia (eventos, urgencias, edificios activos).
 *   - Feed cronologico de eventos (WhatsApp texto / audio / llamadas).
 *   - Filtros por edificio y por urgencia.
 *   - Transcripciones de audio.
 *   - Facturas / fotos enviadas por vecinos o proveedores.
 *   - Feedback por caso (se guarda en Google Sheets para que Marcos aprenda).
 *   - Datos de edificios (ver / editar encargados, propietarios, telefonos).
 *
 * Disenado para no requerir dependencias nuevas mas alla de:
 *   - express
 *   - express-session   (se instala con: npm i express-session)
 *   - googleapis        (ya usado por el proyecto para Google Sheets)
 *
 * Lee los datos directamente de Google Sheets usando las mismas
 * credenciales del .env. Si existe un ./sheets.js con helpers, intenta
 * reutilizarlo; si no, cae a su propio cliente de Sheets.
 * -------------------------------------------------------------------
 */

'use strict';

const express = require('express');
const session = require('express-session');
const path = require('path');
const { google } = require('googleapis');

const router = express.Router();

/* ===================================================================
 * CONFIGURACION
 * =================================================================== */

const ADMIN_USER = process.env.DASHBOARD_USER || 'admin';
const ADMIN_PASS = process.env.DASHBOARD_PASS || 'marcos2024';

// Usuarios de administradores de consorcio (clientes del servicio).
// Formato en .env: CONSORCIO_USERS={"usuario1":"pass1:Edificio A,Edificio B","usuario2":"pass2:Edificio C"}
// El valor es "contraseña:edificio1,edificio2" — los edificios que puede ver ese usuario.
let CONSORCIO_USERS = {};
try {
  if (process.env.CONSORCIO_USERS) {
    const raw = JSON.parse(process.env.CONSORCIO_USERS);
    Object.entries(raw).forEach(([u, v]) => {
      const sepIdx = v.indexOf(':');
      if (sepIdx < 0) return;
      const pass = v.slice(0, sepIdx);
      const edificios = v.slice(sepIdx + 1).split(',').map((s) => s.trim()).filter(Boolean);
      CONSORCIO_USERS[u] = { pass, edificios };
    });
  }
} catch (_) {}
const SESSION_SECRET =
  process.env.DASHBOARD_SECRET || 'marcos-secret-cambiar-en-produccion-2024';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_FILE =
  process.env.GOOGLE_CREDENTIALS_FILE ||
  'gen-lang-client-0735429936-bba6999e5e60.json';

// Nombres de pestanias (tabs) esperados en el Google Sheet.
// Se pueden sobreescribir por .env si los nombres reales difieren.
// Nombres de pestanias (tabs) reales que usa Marcos (sheets.js).
// Se pueden sobreescribir por .env si los nombres difieren.
const TAB_EVENTOS = process.env.SHEET_TAB_EVENTOS || 'reportes';
const TAB_EDIFICIOS = process.env.SHEET_TAB_EDIFICIOS || 'edificios';
const TAB_ARCHIVOS = process.env.SHEET_TAB_ARCHIVOS || 'facturas';
const TAB_FEEDBACK = process.env.SHEET_TAB_FEEDBACK || 'Feedback';
const TAB_SUGERENCIAS = process.env.SHEET_TAB_SUGERENCIAS || 'sugerencias';
const TAB_SOLICITUDES = process.env.SHEET_TAB_SOLICITUDES || 'solicitudes';

/* ===================================================================
 * SESSION
 * =================================================================== */

router.use(
  session({
    name: 'marcos.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12, // 12 horas
      // secure: true, // activar si siempre se accede por HTTPS
    },
  })
);

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

/* ===================================================================
 * CLIENTE GOOGLE SHEETS
 * -------------------------------------------------------------------
 * Intentamos reutilizar ./sheets.js. Si no expone lo que necesitamos,
 * usamos nuestro propio cliente con las credenciales del .env.
 * =================================================================== */

let externalSheets = null;
try {
  // eslint-disable-next-line global-require
  externalSheets = require('./sheets');
} catch (e) {
  externalSheets = null;
}

let _sheetsClient = null;
async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  // Si sheets.js ya expone un cliente autenticado, usarlo.
  if (externalSheets && externalSheets.sheets) {
    _sheetsClient = externalSheets.sheets;
    return _sheetsClient;
  }
  if (externalSheets && typeof externalSheets.getSheetsClient === 'function') {
    _sheetsClient = await externalSheets.getSheetsClient();
    return _sheetsClient;
  }

  const keyFile = path.isAbsolute(CREDENTIALS_FILE)
    ? CREDENTIALS_FILE
    : path.join(__dirname, CREDENTIALS_FILE);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  _sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  return _sheetsClient;
}

/**
 * Lee una pestania completa y la devuelve como array de objetos,
 * usando la primera fila como encabezados (normalizados a minusculas).
 */
async function readTab(tabName) {
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A:Z`,
    });
  } catch (e) {
    // Pestania inexistente u otro error -> devolvemos vacio para no romper UI.
    return { headers: [], rows: [] };
  }

  const values = (res.data && res.data.values) || [];
  if (values.length === 0) return { headers: [], rows: [] };

  const rawHeaders = values[0].map((h) => String(h || '').trim());
  const headers = rawHeaders.map(normalizeKey);

  const rows = values.slice(1).map((row, idx) => {
    const obj = { _row: idx + 2 }; // numero de fila real en la hoja (1-based + header)
    headers.forEach((h, i) => {
      if (!h) return;
      obj[h] = row[i] !== undefined ? row[i] : '';
    });
    return obj;
  });

  return { headers, rows, rawHeaders };
}

function normalizeKey(k) {
  return String(k || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // sacar tildes (marcas diacriticas)
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Devuelve el primer valor presente entre varias claves candidatas. */
function pick(obj, keys, fallback = '') {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== '') return obj[k];
  }
  return fallback;
}

/** Normaliza una fila de "Eventos" a un shape estable para la UI. */
function mapEvento(r) {
  const tipoRaw = String(
    pick(r, ['tipo', 'canal', 'tipo_mensaje', 'medio'])
  ).toLowerCase();

  let tipo = 'texto';
  if (/audio|voz|nota/.test(tipoRaw)) tipo = 'audio';
  else if (/llamad|call|telefono|voice/.test(tipoRaw)) tipo = 'llamada';
  else if (/imagen|foto|image/.test(tipoRaw)) tipo = 'imagen';

  const urgRaw = String(
    pick(r, ['urgencia', 'prioridad', 'gravedad', 'severidad'])
  ).toLowerCase();

  let urgencia = 'baja';
  if (/alta|urgent|critic|grave|emergen/.test(urgRaw)) urgencia = 'alta';
  else if (/media|medio|moder/.test(urgRaw)) urgencia = 'media';
  else if (/baja|bajo|low|normal/.test(urgRaw)) urgencia = 'baja';
  else if (urgRaw) urgencia = 'media';

  return {
    _row: r._row,
    fecha: pick(r, ['fecha', 'fecha_hora', 'timestamp', 'fecha_y_hora', 'hora']),
    edificio: pick(r, ['edificio', 'consorcio', 'building', 'direccion'], 'Sin edificio'),
    vecino: pick(r, ['vecino', 'nombre', 'remitente', 'contacto', 'usuario'], 'Anonimo'),
    telefono: pick(r, ['telefono', 'numero', 'phone', 'celular', 'whatsapp']),
    tipo,
    tipoRaw,
    mensaje: pick(r, ['problema', 'mensaje', 'texto', 'consulta', 'detalle', 'descripcion', 'contenido']),
    transcripcion: pick(r, ['notas_ia', 'transcripcion', 'transcripcion_audio', 'transcript', 'audio_texto']),
    urgencia,
    resumen: pick(r, ['notas_ia', 'resumen', 'sintesis', 'respuesta_marcos', 'respuesta']),
    estado: pick(r, ['estado', 'status']),
    tecnico: pick(r, ['tecnico', 'proveedor', 'rubro']),
    feedback: pick(r, ['feedback', 'nota_admin', 'aprendizaje', 'comentario_admin']),
  };
}

/** Normaliza una fila de "Archivos". */
function mapArchivo(r) {
  return {
    _row: r._row,
    fecha: pick(r, ['fecha', 'fecha_hora', 'timestamp', 'hora']),
    edificio: pick(r, ['edificio', 'consorcio', 'building'], 'Sin edificio'),
    enviado_por: pick(r, ['vecino', 'enviado_por', 'remitente', 'proveedor', 'nombre'], 'Desconocido'),
    tipo: pick(r, ['tipo', 'categoria', 'clase'], 'archivo'),
    descripcion: pick(r, ['descripcion', 'detalle', 'concepto', 'nota']),
    monto: pick(r, ['monto', 'importe', 'total', 'valor']),
    url: pick(r, ['url_archivo', 'url', 'link', 'enlace', 'drive_url', 'archivo', 'imagen', 'foto', 'factura']),
  };
}

/** Normaliza una fila de "Edificios". */
function mapEdificio(r) {
  return {
    _row: r._row,
    nombre: pick(r, ['edificio', 'nombre', 'consorcio', 'direccion'], 'Sin nombre'),
    direccion: pick(r, ['direccion', 'domicilio', 'address']),
    encargado: pick(r, ['encargado', 'portero', 'sereno']),
    tel_encargado: pick(r, ['telefono_encargado', 'tel_encargado', 'celular_encargado']),
    administrador: pick(r, ['admin_nombre', 'administrador', 'admin']),
    tel_admin: pick(r, ['admin_telefono', 'telefono_admin', 'tel_admin', 'telefono_administrador']),
    propietarios: pick(r, ['propietarios', 'duenos', 'duenios']),
    telefonos: pick(r, ['admin_telefono', 'telefonos', 'contactos', 'telefono', 'numeros']),
    notas: pick(r, ['notas_especiales', 'notas', 'observaciones', 'comentarios']),
    aliases: pick(r, ['aliases', 'alias', 'otros_nombres']),
  };
}

/* ===================================================================
 * UTILIDADES DE FECHA
 * =================================================================== */

function parseFecha(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  // formato dd/mm/yyyy [hh:mm]
  const m = String(str).match(
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ ,T]*(\d{1,2})?:?(\d{1,2})?/
  );
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    const dd = new Date(
      Number(yr),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0)
    );
    if (!isNaN(dd.getTime())) return dd;
  }
  return null;
}

function esHoy(date) {
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function fechaCorta(date) {
  if (!date) return '';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ===================================================================
 * AUTH MIDDLEWARE
 * =================================================================== */

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return res.redirect('/admin/login');
}

// Devuelve true si la sesión es del dueño del sistema (Daniel).
function esDueno(req) {
  return req.session && req.session.role === 'dueno';
}

// Devuelve los edificios que puede ver el usuario actual.
// null = todos (dueño); array = filtrado (admin consorcio).
function edificiosPermitidos(req) {
  if (esDueno(req)) return null;
  return req.session.edificios || [];
}

function filtrarPorEdificio(lista, req, campo = 'edificio') {
  const permitidos = edificiosPermitidos(req);
  if (!permitidos) return lista;
  return lista.filter((item) =>
    permitidos.some((e) => String(item[campo] || '').toLowerCase().includes(e.toLowerCase()))
  );
}

/* ===================================================================
 * HTML HELPERS (escape)
 * =================================================================== */

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ===================================================================
 * CSS (dark theme, responsive) -- inline
 * =================================================================== */

const CSS = `
:root{
  --bg:#0f1115; --bg2:#171a21; --bg3:#1f2430; --line:#2a2f3a;
  --txt:#e8eaed; --muted:#8b93a3; --accent:#4f8cff; --accent2:#6ea8ff;
  --ok:#34d399; --warn:#fbbf24; --bad:#f87171; --chip:#262c38;
  --radius:14px; --shadow:0 6px 24px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--txt);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
a{color:var(--accent2);text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:1100px;margin:0 auto;padding:16px}
.topbar{
  position:sticky;top:0;z-index:30;
  background:rgba(15,17,21,.92);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);
}
.topbar .inner{max-width:1100px;margin:0 auto;padding:12px 16px;
  display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{font-weight:700;font-size:18px;display:flex;align-items:center;gap:8px}
.brand .dot{width:10px;height:10px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 12px var(--accent)}
.nav{display:flex;gap:6px;flex-wrap:wrap}
.nav a{padding:7px 12px;border-radius:10px;color:var(--muted);font-weight:500}
.nav a.active,.nav a:hover{background:var(--bg3);color:var(--txt);text-decoration:none}
.spacer{flex:1}
.btn{
  background:var(--accent);color:#fff;border:none;padding:9px 16px;
  border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;
  transition:.15s;display:inline-flex;align-items:center;gap:6px
}
.btn:hover{background:var(--accent2)}
.btn.ghost{background:var(--bg3);color:var(--txt);border:1px solid var(--line)}
.btn.ghost:hover{background:var(--chip)}
.btn.sm{padding:6px 11px;font-size:13px}

h1{font-size:22px;margin:6px 0 18px}
h2{font-size:17px;margin:24px 0 12px}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:8px}
.card{
  background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);
  padding:18px;box-shadow:var(--shadow)
}
.card .k{color:var(--muted);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
.card .v{font-size:30px;font-weight:800;margin-top:6px}
.card.alta .v{color:var(--bad)} .card.media .v{color:var(--warn)} .card.ok .v{color:var(--ok)}

.filters{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 18px;align-items:center}
select,input,textarea{
  background:var(--bg3);color:var(--txt);border:1px solid var(--line);
  border-radius:10px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none
}
select:focus,input:focus,textarea:focus{border-color:var(--accent)}
textarea{width:100%;resize:vertical;min-height:60px}
label.flt{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}

.feed{display:flex;flex-direction:column;gap:12px}
.event{
  background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);
  padding:16px;box-shadow:var(--shadow);position:relative
}
.event .head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
.event .who{font-weight:700}
.event .meta{color:var(--muted);font-size:13px;margin-top:2px}
.event .body{margin-top:10px;white-space:pre-wrap}
.event .transcript{
  margin-top:10px;background:var(--bg3);border-left:3px solid var(--accent);
  padding:10px 12px;border-radius:8px;font-size:14px;color:var(--txt)
}
.event .transcript .lbl{color:var(--muted);font-size:12px;font-weight:600;display:block;margin-bottom:3px}

.badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.badge{font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px}
.badge.alta{background:rgba(248,113,113,.15);color:var(--bad);border:1px solid rgba(248,113,113,.4)}
.badge.media{background:rgba(251,191,36,.15);color:var(--warn);border:1px solid rgba(251,191,36,.4)}
.badge.baja{background:rgba(52,211,153,.15);color:var(--ok);border:1px solid rgba(52,211,153,.35)}
.badge.tipo{background:var(--chip);color:var(--muted);border:1px solid var(--line)}

.fb{margin-top:12px;border-top:1px dashed var(--line);padding-top:12px}
.fb .row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.fb textarea{flex:1;min-width:200px}
.fb .saved{color:var(--ok);font-size:13px;font-weight:600}
.fb .existing{background:var(--bg3);padding:8px 11px;border-radius:8px;font-size:13px;margin-bottom:8px}
.fb .existing b{color:var(--accent2)}

.grid-files{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.file{background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.file .thumb{height:140px;background:var(--bg3);display:flex;align-items:center;justify-content:center;overflow:hidden}
.file .thumb img{width:100%;height:100%;object-fit:cover}
.file .thumb .ph{font-size:40px;color:var(--muted)}
.file .info{padding:12px}
.file .info .t{font-weight:700;font-size:14px}
.file .info .m{color:var(--muted);font-size:12px;margin-top:3px}

table{width:100%;border-collapse:collapse;font-size:14px}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius)}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--bg3);color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.4px;position:sticky;top:0}
tr:last-child td{border-bottom:none}
td input{width:100%}

.empty{text-align:center;color:var(--muted);padding:50px 20px;
  background:var(--bg2);border:1px dashed var(--line);border-radius:var(--radius)}

.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);
  background:var(--bg3);border:1px solid var(--line);padding:12px 18px;border-radius:12px;
  box-shadow:var(--shadow);opacity:0;transition:.25s;z-index:80;font-weight:600}
.toast.show{opacity:1;bottom:28px}
.toast.ok{border-color:var(--ok);color:var(--ok)}
.toast.err{border-color:var(--bad);color:var(--bad)}

/* FICHA EDIFICIO */
.ficha{background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);margin-bottom:24px}
.ficha .ficha-head{display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap}
.ficha .ficha-icon{width:64px;height:64px;border-radius:14px;background:var(--bg3);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0}
.ficha .ficha-data h2{margin:0 0 4px;font-size:20px}
.ficha .ficha-data .dir{color:var(--muted);font-size:14px;margin-bottom:10px}
.ficha .ficha-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.ficha .chip{background:var(--bg3);border:1px solid var(--line);border-radius:10px;padding:6px 12px;font-size:13px}
.ficha .chip b{color:var(--accent2)}
.ficha-divider{border:none;border-top:1px solid var(--line);margin:18px 0}

/* SUGERENCIAS / SOLICITUDES */
.sug-form{background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:20px}
.sug-form h3{margin:0 0 12px;font-size:16px}
.sug-list{display:flex;flex-direction:column;gap:10px}
.sug-item{background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.sug-item .sug-meta{color:var(--muted);font-size:12px;margin-bottom:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sug-item .sug-texto{white-space:pre-wrap}
.sug-item .sug-resp{margin-top:10px;background:var(--bg3);border-left:3px solid var(--ok);padding:8px 12px;border-radius:6px;font-size:14px}
.badge.pendiente{background:rgba(251,191,36,.15);color:var(--warn);border:1px solid rgba(251,191,36,.4)}
.badge.aprobada{background:rgba(52,211,153,.15);color:var(--ok);border:1px solid rgba(52,211,153,.35)}
.badge.rechazada{background:rgba(248,113,113,.15);color:var(--bad);border:1px solid rgba(248,113,113,.4)}
.badge.aplicada{background:rgba(79,140,255,.15);color:var(--accent2);border:1px solid rgba(79,140,255,.4)}
.sol-campo{font-family:monospace;background:var(--bg3);padding:3px 8px;border-radius:6px;font-size:13px}
.sol-diff{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center}
.sol-diff .old{color:var(--bad);text-decoration:line-through;font-size:13px}
.sol-diff .arr{color:var(--muted)}
.sol-diff .new{color:var(--ok);font-weight:600;font-size:13px}

/* LOGIN */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:var(--bg2);border:1px solid var(--line);border-radius:18px;
  padding:34px;width:100%;max-width:380px;box-shadow:var(--shadow)}
.login-card .logo{font-size:26px;font-weight:800;display:flex;align-items:center;gap:10px;margin-bottom:4px}
.login-card .sub{color:var(--muted);margin-bottom:24px}
.login-card .field{margin-bottom:14px}
.login-card label{display:block;font-size:13px;color:var(--muted);margin-bottom:5px}
.login-card input{width:100%}
.login-card .btn{width:100%;justify-content:center;margin-top:8px;padding:11px}
.login-card .err{background:rgba(248,113,113,.12);color:var(--bad);
  border:1px solid rgba(248,113,113,.4);padding:10px;border-radius:10px;margin-bottom:14px;font-size:14px}

@media(max-width:600px){
  .card .v{font-size:24px}
  h1{font-size:19px}
  .nav a{padding:6px 9px;font-size:14px}
}
`;

/* ===================================================================
 * LAYOUT
 * =================================================================== */

function page(active, title, bodyHtml, req) {
  const isDueno = !req || (req.session && req.session.role === 'dueno');
  const userName = (req && req.session && req.session.user) || '';
  const roleBadge = isDueno
    ? `<span style="font-size:12px;background:#1f2430;color:#8b93a3;padding:3px 9px;border-radius:8px;border:1px solid #2a2f3a">Dueño del sistema</span>`
    : `<span style="font-size:12px;background:#1f2430;color:#6ea8ff;padding:3px 9px;border-radius:8px;border:1px solid #2a2f3a">Admin: ${esc(userName)}</span>`;

  const nav = [
    ['/admin', 'Resumen', 'resumen', true],
    ['/admin/mi-edificio', 'Mi Edificio', 'mi-edificio', !isDueno],
    ['/admin/eventos', 'Eventos', 'eventos', true],
    ['/admin/archivos', 'Facturas/Fotos', 'archivos', true],
    ['/admin/sugerencias', 'Sugerencias', 'sugerencias', !isDueno],
    ['/admin/edificios', 'Edificios', 'edificios', isDueno],
    ['/admin/solicitudes', 'Solicitudes', 'solicitudes', isDueno],
  ];
  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${esc(title)} · Marcos IA</title>
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="inner">
    <div class="brand"><span class="dot"></span> Marcos IA</div>
    <nav class="nav">
      ${nav
        .filter(([, , , visible]) => visible)
        .map(
          ([href, label, id]) =>
            `<a href="${href}" class="${active === id ? 'active' : ''}">${label}</a>`
        )
        .join('')}
    </nav>
    <div class="spacer"></div>
    ${roleBadge}
    <a href="/admin/logout" class="btn ghost sm">Salir</a>
  </div>
</header>
<main class="container">
${bodyHtml}
</main>
<div id="toast" class="toast"></div>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

/* ===================================================================
 * CLIENT-SIDE JS (vanilla)
 * =================================================================== */

const CLIENT_JS = `
function toast(msg, kind){
  var t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;
  t.className='toast show '+(kind||'ok');
  setTimeout(function(){t.className='toast';},2600);
}

// Guardar feedback de un evento
async function guardarFeedback(btn, row){
  var card=btn.closest('.event');
  var ta=card.querySelector('textarea[data-fb]');
  var nota=ta.value.trim();
  btn.disabled=true;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/feedback',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row,nota:nota})
    });
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Feedback guardado. Marcos va a aprender de esto.','ok');
    var ex=card.querySelector('[data-existing]');
    if(ex){ex.innerHTML='<b>Tu nota:</b> '+escapeHtml(nota);ex.style.display=nota?'block':'none';}
  }catch(e){
    toast('No se pudo guardar: '+e.message,'err');
  }finally{
    btn.disabled=false;btn.textContent='Guardar nota';
  }
}

// Guardar fila de edificio
async function guardarEdificio(btn, row){
  var tr=btn.closest('tr');
  var data={row:row};
  tr.querySelectorAll('input[data-field]').forEach(function(inp){
    data[inp.getAttribute('data-field')]=inp.value;
  });
  btn.disabled=true;var old=btn.textContent;btn.textContent='...';
  try{
    var r=await fetch('/admin/api/edificio',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Edificio actualizado','ok');
  }catch(e){ toast('Error: '+e.message,'err'); }
  finally{ btn.disabled=false;btn.textContent=old; }
}

// Filtros del feed de eventos (client-side)
function aplicarFiltros(){
  var fe=document.getElementById('f-edificio');
  var fu=document.getElementById('f-urgencia');
  var ft=document.getElementById('f-texto');
  var edi=fe?fe.value:'';
  var urg=fu?fu.value:'';
  var txt=ft?ft.value.toLowerCase():'';
  var vis=0;
  document.querySelectorAll('.event[data-edificio]').forEach(function(ev){
    var okE=!edi||ev.getAttribute('data-edificio')===edi;
    var okU=!urg||ev.getAttribute('data-urgencia')===urg;
    var okT=!txt||ev.textContent.toLowerCase().indexOf(txt)>=0;
    var show=okE&&okU&&okT;
    ev.style.display=show?'':'none';
    if(show)vis++;
  });
  var none=document.getElementById('no-results');
  if(none)none.style.display=vis===0?'block':'none';
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// Enviar sugerencia
async function enviarSugerencia(btn){
  var ta=document.getElementById('sug-input');
  var texto=(ta?ta.value:'').trim();
  if(!texto){toast('Escribi tu sugerencia antes de enviar','err');return;}
  btn.disabled=true;btn.textContent='Enviando...';
  try{
    var r=await fetch('/admin/api/sugerencia',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({texto:texto})
    });
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Sugerencia enviada. La revisaremos pronto.','ok');
    ta.value='';
    setTimeout(function(){location.reload();},1200);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent='Enviar sugerencia';}
}

// Solicitar cambio de dato del edificio
async function solicitarCambio(btn, campo, valorActual){
  var nuevoVal=prompt('Valor actual: "'+valorActual+'"\n\nNuevo valor para '+campo+':');
  if(nuevoVal===null||nuevoVal.trim()===''||nuevoVal===valorActual)return;
  btn.disabled=true;var old=btn.textContent;btn.textContent='Enviando...';
  try{
    var r=await fetch('/admin/api/solicitar-cambio',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({campo:campo,valorActual:valorActual,valorNuevo:nuevoVal.trim()})
    });
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Solicitud enviada. El administrador la revisará.','ok');
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// Aprobar solicitud (dueño)
async function aprobarSolicitud(btn, row){
  if(!confirm('Aprobar y aplicar este cambio en la planilla?'))return;
  btn.disabled=true;btn.textContent='Aplicando...';
  try{
    var r=await fetch('/admin/api/aprobar-solicitud',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row})
    });
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Cambio aplicado y registrado.','ok');
    btn.closest('.sug-item').style.opacity='0.5';
    setTimeout(function(){location.reload();},1200);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;}
}

// Rechazar solicitud (dueño)
async function rechazarSolicitud(btn, row){
  var motivo=prompt('Motivo del rechazo (opcional):');
  if(motivo===null)return;
  btn.disabled=true;btn.textContent='Rechazando...';
  try{
    var r=await fetch('/admin/api/rechazar-solicitud',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row,motivo:motivo.trim()})
    });
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Solicitud rechazada.','ok');
    setTimeout(function(){location.reload();},1200);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;}
}

// Responder sugerencia (dueño)
async function responderSugerencia(btn, row){
  var resp=prompt('Tu respuesta para el administrador del consorcio:');
  if(resp===null||resp.trim()==='')return;
  btn.disabled=true;btn.textContent='Enviando...';
  try{
    var r=await fetch('/admin/api/responder-sugerencia',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row,respuesta:resp.trim()})
    });
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Respuesta enviada.','ok');
    setTimeout(function(){location.reload();},1200);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;}
}
`;

/* ===================================================================
 * RUTAS: LOGIN / LOGOUT
 * =================================================================== */

router.get('/login', (req, res) => {
  if (req.session && req.session.authed) return res.redirect('/admin');
  const err = req.query.error
    ? `<div class="err">Usuario o contrasena incorrectos.</div>`
    : '';
  res.send(`<!DOCTYPE html>
<html lang="es-AR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ingresar · Marcos IA</title><style>${CSS}</style></head>
<body>
<div class="login-wrap">
  <form class="login-card" method="POST" action="/admin/login">
    <div class="logo"><span class="dot"></span> Marcos IA</div>
    <div class="sub">Panel del administrador</div>
    ${err}
    <div class="field">
      <label>Usuario</label>
      <input name="user" autocomplete="username" autofocus required>
    </div>
    <div class="field">
      <label>Contrasena</label>
      <input name="pass" type="password" autocomplete="current-password" required>
    </div>
    <button class="btn" type="submit">Ingresar</button>
  </form>
</div>
</body></html>`);
});

router.post('/login', (req, res) => {
  const { user, pass } = req.body || {};
  // Dueño del sistema
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authed = true;
    req.session.role = 'dueno';
    req.session.user = user;
    return req.session.save(() => res.redirect('/admin'));
  }
  // Administrador de consorcio (cliente del servicio)
  const consorcioCfg = CONSORCIO_USERS[user];
  if (consorcioCfg && consorcioCfg.pass === pass) {
    req.session.authed = true;
    req.session.role = 'consorcio';
    req.session.user = user;
    req.session.edificios = consorcioCfg.edificios;
    return req.session.save(() => res.redirect('/admin'));
  }
  return res.redirect('/admin/login?error=1');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

/* ===================================================================
 * A partir de aca todo requiere autenticacion.
 * =================================================================== */

router.use(requireAuth);

/* ----------------- RESUMEN DEL DIA ----------------- */

router.get('/', async (req, res) => {
  try {
    const { rows } = await readTab(TAB_EVENTOS);
    const todos = rows.map(mapEvento);
    const eventos = filtrarPorEdificio(todos, req);

    const hoy = eventos.filter((e) => esHoy(parseFecha(e.fecha)));
    const urgentesHoy = hoy.filter((e) => e.urgencia === 'alta');
    const mediaHoy = hoy.filter((e) => e.urgencia === 'media');
    const edificiosHoy = new Set(hoy.map((e) => e.edificio).filter(Boolean));

    const ult = [...eventos]
      .sort((a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0))
      .slice(0, 6);

    const saludo = esDueno(req)
      ? `${horaSaludo()}, tomate unos mates 🧉`
      : `${horaSaludo()}, ${esc(req.session.user)}`;

    const subtitulo = esDueno(req)
      ? 'Esto es lo que paso mientras dormias.'
      : `Panel de ${esc((edificiosPermitidos(req) || []).join(', '))}`;

    const cards = `
      <div class="cards">
        <div class="card"><div class="k">Eventos hoy</div><div class="v">${hoy.length}</div></div>
        <div class="card alta"><div class="k">Urgencias</div><div class="v">${urgentesHoy.length}</div></div>
        <div class="card media"><div class="k">Prioridad media</div><div class="v">${mediaHoy.length}</div></div>
        <div class="card ok"><div class="k">Edificios activos</div><div class="v">${edificiosHoy.size}</div></div>
        <div class="card"><div class="k">Eventos totales</div><div class="v">${eventos.length}</div></div>
      </div>`;

    const ultHtml = ult.length
      ? `<div class="feed">${ult.map(renderEventoMini).join('')}</div>`
      : `<div class="empty">Todavia no hay eventos registrados.</div>`;

    res.send(
      page(
        'resumen',
        'Resumen',
        `<h1>${saludo}</h1>
         <p style="color:var(--muted);margin-top:-8px">${subtitulo}</p>
         ${cards}
         <h2>Ultimos movimientos</h2>
         ${ultHtml}
         <p style="margin-top:18px"><a class="btn ghost sm" href="/admin/eventos">Ver todos los eventos →</a></p>`,
        req
      )
    );
  } catch (e) {
    res.status(500).send(page('resumen', 'Resumen', errorBox(e), req));
  }
});

function horaSaludo() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos dias';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function renderEventoMini(e) {
  return `<div class="event">
    <div class="head">
      <div>
        <div class="who">${esc(e.edificio)} · ${esc(e.vecino)}</div>
        <div class="meta">${esc(fechaCorta(parseFecha(e.fecha)) || e.fecha)}</div>
      </div>
      <div class="badges">
        <span class="badge tipo">${tipoLabel(e.tipo)}</span>
        <span class="badge ${e.urgencia}">${e.urgencia}</span>
      </div>
    </div>
    <div class="body">${esc(truncate(e.mensaje || e.transcripcion || e.resumen, 180))}</div>
  </div>`;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function tipoLabel(t) {
  return {
    texto: '💬 WhatsApp',
    audio: '🎙️ Audio',
    llamada: '📞 Llamada',
    imagen: '🖼️ Imagen',
  }[t] || '💬 Mensaje';
}

/* ----------------- FEED DE EVENTOS ----------------- */

router.get('/eventos', async (req, res) => {
  try {
    const { rows } = await readTab(TAB_EVENTOS);
    let eventos = filtrarPorEdificio(rows.map(mapEvento), req);
    eventos.sort((a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0));

    const edificios = [...new Set(eventos.map((e) => e.edificio).filter(Boolean))].sort();
    const opcionesEdi = edificios.map((e) => `<option value="${esc(e)}">${esc(e)}</option>`).join('');

    // Admins de consorcio no pueden dejar feedback (eso es para Daniel)
    const feed = eventos.length
      ? `<div class="feed">${eventos.map((e) => renderEventoFull(e, req)).join('')}</div>
         <div id="no-results" class="empty" style="display:none">No hay eventos que coincidan con el filtro.</div>`
      : `<div class="empty">Todavia no hay eventos registrados.</div>`;

    res.send(
      page(
        'eventos',
        'Eventos',
        `<h1>Feed de eventos</h1>
         <div class="filters">
           <label class="flt">Edificio
             <select id="f-edificio" onchange="aplicarFiltros()">
               <option value="">Todos</option>${opcionesEdi}
             </select>
           </label>
           <label class="flt">Urgencia
             <select id="f-urgencia" onchange="aplicarFiltros()">
               <option value="">Todas</option>
               <option value="alta">Alta</option>
               <option value="media">Media</option>
               <option value="baja">Baja</option>
             </select>
           </label>
           <label class="flt">Buscar
             <input id="f-texto" placeholder="vecino, texto..." oninput="aplicarFiltros()">
           </label>
         </div>
         ${feed}`,
        req
      )
    );
  } catch (e) {
    res.status(500).send(page('eventos', 'Eventos', errorBox(e), req));
  }
});

function renderEventoFull(e, req) {
  const transcript = e.transcripcion
    ? `<div class="transcript"><span class="lbl">Notas de Marcos</span>${esc(e.transcripcion)}</div>`
    : '';

  const resumen = (e.resumen && e.resumen !== e.transcripcion)
    ? `<div class="meta" style="margin-top:8px"><b>Marcos:</b> ${esc(e.resumen)}</div>`
    : '';

  const feedbackHtml = esDueno({ session: req && req.session })
    ? `<div class="fb">
        <div class="existing" data-existing style="${e.feedback ? '' : 'display:none'}"><b>Tu nota:</b> ${esc(e.feedback)}</div>
        <div class="row">
          <textarea data-fb placeholder="Dejale una nota a Marcos para que aprenda de este caso...">${esc(e.feedback || '')}</textarea>
          <button class="btn sm" onclick="guardarFeedback(this, ${e._row})">Guardar nota</button>
        </div>
      </div>`
    : (e.feedback ? `<div class="fb"><div class="existing"><b>Nota:</b> ${esc(e.feedback)}</div></div>` : '');

  return `<div class="event" data-edificio="${esc(e.edificio)}" data-urgencia="${esc(e.urgencia)}">
    <div class="head">
      <div>
        <div class="who">${esc(e.edificio)} · ${esc(e.vecino)}</div>
        <div class="meta">${esc(fechaCorta(parseFecha(e.fecha)) || e.fecha)}${
          e.telefono ? ' · ' + esc(e.telefono) : ''
        }</div>
      </div>
      <div class="badges">
        <span class="badge tipo">${tipoLabel(e.tipo)}</span>
        <span class="badge ${e.urgencia}">${e.urgencia}</span>
        ${e.estado ? `<span class="badge tipo">${esc(e.estado)}</span>` : ''}
      </div>
    </div>
    ${e.mensaje ? `<div class="body">${esc(e.mensaje)}</div>` : ''}
    ${e.tecnico ? `<div class="meta" style="margin-top:6px">🔧 ${esc(e.tecnico)}</div>` : ''}
    ${transcript}
    ${resumen}
    ${feedbackHtml}
  </div>`;
}

/* ----------------- FACTURAS / FOTOS ----------------- */

router.get('/archivos', async (req, res) => {
  try {
    const { rows } = await readTab(TAB_ARCHIVOS);
    let archivos = filtrarPorEdificio(rows.map(mapArchivo), req);
    archivos = archivos.filter((a) => a.url || a.descripcion || a.monto);
    archivos.sort((a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0));

    const body = archivos.length
      ? `<div class="grid-files">${archivos.map(renderArchivo).join('')}</div>`
      : `<div class="empty">No hay facturas ni fotos cargadas todavia.</div>`;

    res.send(
      page(
        'archivos',
        'Facturas/Fotos',
        `<h1>Facturas y fotos</h1>
         <p style="color:var(--muted);margin-top:-8px">Archivos que enviaron vecinos o proveedores.</p>
         ${body}`,
        req
      )
    );
  } catch (e) {
    res.status(500).send(page('archivos', 'Facturas/Fotos', errorBox(e), req));
  }
});

function esImagen(url) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url || '');
}

function renderArchivo(a) {
  const thumb = a.url && esImagen(a.url)
    ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="" loading="lazy"></a>`
    : `<div class="ph">${a.url ? '📄' : '🗂️'}</div>`;

  return `<div class="file">
    <div class="thumb">${thumb}</div>
    <div class="info">
      <div class="t">${esc(a.descripcion || a.tipo || 'Archivo')}</div>
      <div class="m">${esc(a.edificio)} · ${esc(a.enviado_por)}</div>
      <div class="m">${esc(fechaCorta(parseFecha(a.fecha)) || a.fecha)}</div>
      ${a.monto ? `<div class="m" style="color:var(--warn);font-weight:700">${esc(a.monto)}</div>` : ''}
      ${a.url ? `<div style="margin-top:8px"><a class="btn ghost sm" href="${esc(a.url)}" target="_blank" rel="noopener">Abrir →</a></div>` : ''}
    </div>
  </div>`;
}

/* ----------------- EDIFICIOS (ver/editar) — solo dueño ----------------- */

router.get('/edificios', async (req, res) => {
  if (!esDueno(req)) return res.redirect('/admin');

  try {
    const { rows } = await readTab(TAB_EDIFICIOS);
    const edificios = rows.map(mapEdificio);

    const filas = edificios
      .map(
        (e) => `<tr>
          <td><b>${esc(e.nombre)}</b>${e.aliases ? `<br><span style="font-size:12px;color:var(--muted)">${esc(e.aliases)}</span>` : ''}</td>
          <td>${esc(e.tipo || '—')}</td>
          <td><input data-field="administrador" value="${esc(e.administrador)}" placeholder="Nombre admin"></td>
          <td><input data-field="telefonos" value="${esc(e.telefonos)}" placeholder="Telefono admin"></td>
          <td><input data-field="notas" value="${esc(e.notas)}" placeholder="Notas especiales"></td>
          <td><input data-field="aliases" value="${esc(e.aliases)}" placeholder="Aliases separados por coma"></td>
          <td><button class="btn sm" onclick="guardarEdificio(this, ${e._row})">Guardar</button></td>
        </tr>`
      )
      .join('');

    const body = edificios.length
      ? `<div class="tablewrap"><table>
          <thead><tr>
            <th>Edificio</th><th>Tipo</th><th>Administrador</th><th>Tel. admin</th>
            <th>Notas especiales</th><th>Aliases</th><th></th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table></div>`
      : `<div class="empty">No hay edificios cargados.</div>`;

    res.send(
      page(
        'edificios',
        'Edificios',
        `<h1>Datos de edificios</h1>
         <p style="color:var(--muted);margin-top:-8px">Edita datos que usa Marcos para atender cada consorcio. Los cambios se guardan en Google Sheets.</p>
         ${body}`,
        req
      )
    );
  } catch (e) {
    res.status(500).send(page('edificios', 'Edificios', errorBox(e), req));
  }
});

function errorBox(e) {
  return `<div class="empty">
    <p>Ups, no pude leer los datos de Google Sheets.</p>
    <p style="font-size:13px;color:var(--bad)">${esc(e && e.message ? e.message : e)}</p>
    <p style="font-size:13px">Revisa GOOGLE_SHEET_ID, las credenciales y los nombres de las pestanias.</p>
  </div>`;
}

/* ===================================================================
 * API (POST) - feedback y edicion de edificios
 * =================================================================== */

/**
 * Encuentra la columna (letra) de un encabezado dado en una pestania,
 * buscando por cualquiera de las claves candidatas. Si no existe la
 * columna, devuelve null (y se podra crear al final).
 */
async function findOrPlanColumn(tabName, candidateKeys) {
  const { rawHeaders, headers } = await readTab(tabName);
  for (let i = 0; i < headers.length; i++) {
    if (candidateKeys.includes(headers[i])) {
      return { col: columnLetter(i + 1), index: i, rawHeaders, headers };
    }
  }
  // No existe -> proponer crearla al final
  return {
    col: columnLetter((rawHeaders ? rawHeaders.length : 0) + 1),
    index: rawHeaders ? rawHeaders.length : 0,
    create: candidateKeys[0],
    rawHeaders: rawHeaders || [],
    headers: headers || [],
  };
}

function columnLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function writeCell(tabName, col, row, value) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!${col}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

async function ensureHeader(tabName, col, name, headerExists) {
  if (headerExists) return;
  // Escribir el encabezado en la fila 1 si la columna era nueva.
  await writeCell(tabName, col, 1, name);
}

// POST /admin/api/feedback  { row, nota }
router.post('/api/feedback', async (req, res) => {
  try {
    const { row, nota } = req.body || {};
    if (!row || isNaN(Number(row))) {
      return res.status(400).json({ error: 'Fila invalida' });
    }
    const plan = await findOrPlanColumn(TAB_EVENTOS, [
      'feedback',
      'nota_admin',
      'aprendizaje',
      'comentario_admin',
    ]);
    if (plan.create) {
      await ensureHeader(TAB_EVENTOS, plan.col, 'feedback', false);
    }
    await writeCell(TAB_EVENTOS, plan.col, Number(row), nota || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// POST /admin/api/edificio  { row, encargado, tel_encargado, ... }
const EDIFICIO_FIELDS = {
  administrador: ['admin_nombre', 'administrador', 'admin'],
  telefonos: ['admin_telefono', 'telefonos', 'contactos', 'numeros'],
  notas: ['notas_especiales', 'notas', 'observaciones', 'comentarios'],
  aliases: ['aliases', 'alias', 'otros_nombres'],
};

router.post('/api/edificio', async (req, res) => {
  try {
    const body = req.body || {};
    const row = Number(body.row);
    if (!row || isNaN(row)) {
      return res.status(400).json({ error: 'Fila invalida' });
    }

    // Releer headers una sola vez.
    const { rawHeaders, headers } = await readTab(TAB_EDIFICIOS);
    let workingHeaders = headers.slice();

    for (const field of Object.keys(EDIFICIO_FIELDS)) {
      if (body[field] === undefined) continue;
      const candidates = EDIFICIO_FIELDS[field];
      let idx = workingHeaders.findIndex((h) => candidates.includes(h));
      let exists = idx >= 0;
      let col;
      if (exists) {
        col = columnLetter(idx + 1);
      } else {
        col = columnLetter(workingHeaders.length + 1);
        await ensureHeader(TAB_EDIFICIOS, col, candidates[0], false);
        workingHeaders.push(candidates[0]);
      }
      await writeCell(TAB_EDIFICIOS, col, row, body[field]);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * HELPER: append row to a sheet tab, creating headers if tab is empty
 * =================================================================== */

async function appendRow(tabName, rowData) {
  const sheets = await getSheetsClient();
  // Read existing headers first
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!1:1`,
    });
  } catch (_) { res = null; }

  const existingHeaders = (res && res.data && res.data.values && res.data.values[0]) || [];

  if (existingHeaders.length === 0) {
    // Create header row first
    const headers = Object.keys(rowData);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers, headers.map((k) => rowData[k] || '')] },
    });
    return;
  }

  // Append values in header order
  const values = existingHeaders.map((h) => {
    const key = normalizeKey(h);
    // try to find matching key in rowData
    const match = Object.keys(rowData).find((k) => normalizeKey(k) === key || k === h);
    return match !== undefined ? rowData[match] : '';
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

/* ===================================================================
 * RUTA: MI EDIFICIO (solo admin de consorcio)
 * =================================================================== */

router.get('/mi-edificio', async (req, res) => {
  if (esDueno(req)) return res.redirect('/admin/edificios');

  const permitidos = edificiosPermitidos(req) || [];

  try {
    const { rows } = await readTab(TAB_EDIFICIOS);
    const todos = rows.map(mapEdificio);

    // Filtramos los edificios de este usuario
    const misEdificios = filtrarPorEdificio(todos, req, 'nombre');

    if (misEdificios.length === 0) {
      return res.send(page('mi-edificio', 'Mi Edificio',
        `<h1>Mi Edificio</h1><div class="empty">No se encontraron datos para: ${esc(permitidos.join(', '))}</div>`, req));
    }

    const fichas = misEdificios.map((e) => {
      const campos = [
        { label: 'Tipo', field: 'tipo', val: e.tipo, editable: false },
        { label: 'Administrador', field: 'administrador', val: e.administrador, editable: true },
        { label: 'Teléfono admin', field: 'telefonos', val: e.telefonos, editable: true },
        { label: 'Notas especiales', field: 'notas', val: e.notas, editable: true },
        { label: 'Aliases', field: 'aliases', val: e.aliases, editable: false },
      ];

      const chipsHtml = campos
        .filter((c) => c.val)
        .map((c) => `<div class="chip"><b>${esc(c.label)}:</b> ${esc(c.val)}</div>`)
        .join('');

      const editablesHtml = campos
        .filter((c) => c.editable)
        .map((c) => `
          <tr>
            <td style="width:160px;color:var(--muted);font-size:13px">${esc(c.label)}</td>
            <td>${esc(c.val || '—')}</td>
            <td style="width:120px">
              <button class="btn ghost sm" onclick="solicitarCambio(this,'${esc(c.field)}','${esc(c.val || '')}')">
                ✏️ Solicitar cambio
              </button>
            </td>
          </tr>`)
        .join('');

      return `
        <div class="ficha">
          <div class="ficha-head">
            <div class="ficha-icon">🏢</div>
            <div class="ficha-data">
              <h2>${esc(e.nombre)}</h2>
              <div class="dir">${esc(e.nombre)}${e.tipo ? ' · ' + esc(e.tipo) : ''}</div>
              <div class="ficha-chips">${chipsHtml || '<span style="color:var(--muted);font-size:13px">Sin datos cargados</span>'}</div>
            </div>
          </div>
          <hr class="ficha-divider">
          <h3 style="font-size:15px;margin:0 0 10px">Solicitar cambio de datos</h3>
          <p style="color:var(--muted);font-size:13px;margin:0 0 12px">
            Los cambios pasan por revisión del administrador del sistema antes de aplicarse.
          </p>
          <div class="tablewrap">
            <table><tbody>${editablesHtml}</tbody></table>
          </div>
        </div>`;
    }).join('');

    res.send(page('mi-edificio', 'Mi Edificio',
      `<h1>Mi Edificio</h1>
       <p style="color:var(--muted);margin-top:-8px">Datos del consorcio que administra Marcos IA.</p>
       ${fichas}`, req));
  } catch (e) {
    res.status(500).send(page('mi-edificio', 'Mi Edificio', errorBox(e), req));
  }
});

/* ===================================================================
 * RUTA: SUGERENCIAS (admin de consorcio envía; dueño ve y responde)
 * =================================================================== */

router.get('/sugerencias', async (req, res) => {
  if (esDueno(req)) return res.redirect('/admin/solicitudes');

  const usuario = req.session.user;
  const permitidos = edificiosPermitidos(req) || [];

  try {
    const { rows } = await readTab(TAB_SUGERENCIAS);
    const misSugs = rows.filter((r) => {
      const u = String(r.usuario || r.user || '').trim();
      return u === usuario;
    });

    const listHtml = misSugs.length
      ? misSugs.slice().reverse().map((r) => {
          const estado = String(r.estado || 'pendiente').toLowerCase();
          const respuesta = r.respuesta || r.respuesta_admin || '';
          return `
            <div class="sug-item">
              <div class="sug-meta">
                <span class="badge ${estado}">${esc(estado)}</span>
                <span>${esc(r.fecha || '')}</span>
              </div>
              <div class="sug-texto">${esc(r.texto || r.sugerencia || r.contenido || '')}</div>
              ${respuesta ? `<div class="sug-resp"><b>Respuesta:</b> ${esc(respuesta)}</div>` : ''}
            </div>`;
        }).join('')
      : `<div class="empty">Todavía no enviaste ninguna sugerencia.</div>`;

    res.send(page('sugerencias', 'Sugerencias',
      `<h1>Sugerencias</h1>
       <p style="color:var(--muted);margin-top:-8px">Mandanos tus ideas para mejorar el servicio o algo que quieras que Marcos aprenda.</p>
       <div class="sug-form">
         <h3>Nueva sugerencia</h3>
         <textarea id="sug-input" rows="4" placeholder="Escribí tu sugerencia, consulta o cosa que quieras que Marcos haga diferente..."></textarea>
         <div style="margin-top:10px">
           <button class="btn" onclick="enviarSugerencia(this)">Enviar sugerencia</button>
         </div>
       </div>
       <h2>Mis sugerencias anteriores</h2>
       <div class="sug-list">${listHtml}</div>`, req));
  } catch (e) {
    res.status(500).send(page('sugerencias', 'Sugerencias', errorBox(e), req));
  }
});

/* ===================================================================
 * RUTA: SOLICITUDES (solo dueño — ve sugerencias + solicitudes de cambio)
 * =================================================================== */

router.get('/solicitudes', async (req, res) => {
  if (!esDueno(req)) return res.redirect('/admin');

  try {
    const [resSugs, resSols] = await Promise.all([
      readTab(TAB_SUGERENCIAS),
      readTab(TAB_SOLICITUDES),
    ]);

    const sugs = [...resSugs.rows].reverse();
    const sols = [...resSols.rows].reverse();

    const pendientesSugs = sugs.filter((r) => !r.estado || r.estado === 'pendiente').length;
    const pendientesSols = sols.filter((r) => !r.estado || r.estado === 'pendiente').length;

    const sugsHtml = sugs.length
      ? sugs.map((r, i) => {
          const row = resSugs.rows.length - i; // aproximado
          const realRow = r._row;
          const estado = String(r.estado || 'pendiente').toLowerCase();
          const respuesta = r.respuesta || r.respuesta_admin || '';
          const isPendiente = estado === 'pendiente';
          return `
            <div class="sug-item">
              <div class="sug-meta">
                <span class="badge ${estado}">${esc(estado)}</span>
                <b>${esc(r.usuario || r.user || '?')}</b>
                <span>${esc(r.edificio || '')}</span>
                <span>${esc(r.fecha || '')}</span>
              </div>
              <div class="sug-texto">${esc(r.texto || r.sugerencia || r.contenido || '')}</div>
              ${respuesta ? `<div class="sug-resp"><b>Tu respuesta:</b> ${esc(respuesta)}</div>` : ''}
              ${isPendiente ? `
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn sm" onclick="responderSugerencia(this,${realRow})">Responder</button>
                </div>` : ''}
            </div>`;
        }).join('')
      : `<div class="empty">No hay sugerencias todavía.</div>`;

    const solsHtml = sols.length
      ? sols.map((r) => {
          const realRow = r._row;
          const estado = String(r.estado || 'pendiente').toLowerCase();
          const isPendiente = estado === 'pendiente';
          return `
            <div class="sug-item">
              <div class="sug-meta">
                <span class="badge ${estado}">${esc(estado)}</span>
                <b>${esc(r.usuario || '?')}</b>
                <span>${esc(r.edificio || '')}</span>
                <span class="sol-campo">${esc(r.campo || '')}</span>
                <span>${esc(r.fecha || '')}</span>
              </div>
              <div class="sol-diff">
                <span class="old">${esc(r.valor_actual || '—')}</span>
                <span class="arr">→</span>
                <span class="new">${esc(r.valor_nuevo || '')}</span>
              </div>
              ${r.motivo_rechazo ? `<div class="sug-resp" style="border-color:var(--bad)"><b>Rechazo:</b> ${esc(r.motivo_rechazo)}</div>` : ''}
              ${isPendiente ? `
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn sm" onclick="aprobarSolicitud(this,${realRow})">✅ Aprobar y aplicar</button>
                  <button class="btn ghost sm" onclick="rechazarSolicitud(this,${realRow})">❌ Rechazar</button>
                </div>` : ''}
            </div>`;
        }).join('')
      : `<div class="empty">No hay solicitudes de cambio todavía.</div>`;

    const badgePend = (n) => n > 0 ? `<span class="badge pendiente" style="margin-left:8px">${n} pendiente${n > 1 ? 's' : ''}</span>` : '';

    res.send(page('solicitudes', 'Solicitudes',
      `<h1>Solicitudes y sugerencias</h1>
       <p style="color:var(--muted);margin-top:-8px">Lo que enviaron los administradores de consorcio para tu revisión.</p>
       <h2>Solicitudes de cambio de datos ${badgePend(pendientesSols)}</h2>
       <p style="color:var(--muted);font-size:13px">Cambios que el admin quiere hacer en la ficha de su edificio. Aprobá para que se apliquen.</p>
       <div class="sug-list" style="margin-bottom:32px">${solsHtml}</div>
       <h2>Sugerencias ${badgePend(pendientesSugs)}</h2>
       <p style="color:var(--muted);font-size:13px">Ideas o pedidos que enviaron los administradores. Podés responderles directamente.</p>
       <div class="sug-list">${sugsHtml}</div>`, req));
  } catch (e) {
    res.status(500).send(page('solicitudes', 'Solicitudes', errorBox(e), req));
  }
});

/* ===================================================================
 * API: SUGERENCIA (POST)
 * =================================================================== */

router.post('/api/sugerencia', async (req, res) => {
  try {
    const { texto } = req.body || {};
    if (!texto || !texto.trim()) return res.status(400).json({ error: 'Texto vacío' });
    const usuario = req.session.user;
    const edificios = (edificiosPermitidos(req) || []).join(', ');
    await appendRow(TAB_SUGERENCIAS, {
      fecha: new Date().toLocaleString('es-AR'),
      usuario,
      edificio: edificios,
      texto: texto.trim(),
      sugerencia: texto.trim(),
      estado: 'pendiente',
      respuesta: '',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * API: SOLICITAR CAMBIO (POST — admin de consorcio)
 * =================================================================== */

router.post('/api/solicitar-cambio', async (req, res) => {
  try {
    const { campo, valorActual, valorNuevo } = req.body || {};
    if (!campo || !valorNuevo) return res.status(400).json({ error: 'Datos incompletos' });
    const usuario = req.session.user;
    const edificios = (edificiosPermitidos(req) || []).join(', ');
    await appendRow(TAB_SOLICITUDES, {
      fecha: new Date().toLocaleString('es-AR'),
      usuario,
      edificio: edificios,
      campo,
      valor_actual: valorActual || '',
      valor_nuevo: valorNuevo,
      estado: 'pendiente',
      motivo_rechazo: '',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * API: APROBAR SOLICITUD (POST — dueño)
 * Aplica el cambio en la tab Edificios y marca la solicitud como 'aplicada'
 * =================================================================== */

router.post('/api/aprobar-solicitud', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });

    // Leer la solicitud
    const { rows, headers } = await readTab(TAB_SOLICITUDES);
    const solicitud = rows.find((r) => r._row === Number(row));
    if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const { edificio, campo, valor_nuevo } = solicitud;

    // Buscar el edificio en la tab Edificios
    const { rows: edRows, headers: edHeaders } = await readTab(TAB_EDIFICIOS);
    const edRow = edRows.find((r) =>
      String(r.edificio || r.nombre || '').toLowerCase().includes(
        String(edificio || '').toLowerCase().split(',')[0].trim().toLowerCase()
      )
    );

    if (edRow && campo) {
      const candidates = EDIFICIO_FIELDS[campo] || [campo];
      let colIdx = edHeaders.findIndex((h) => candidates.includes(h));
      if (colIdx >= 0) {
        await writeCell(TAB_EDIFICIOS, columnLetter(colIdx + 1), edRow._row, valor_nuevo);
      }
    }

    // Marcar solicitud como aplicada
    const planEstado = await findOrPlanColumn(TAB_SOLICITUDES, ['estado']);
    if (planEstado.create) await ensureHeader(TAB_SOLICITUDES, planEstado.col, 'estado', false);
    await writeCell(TAB_SOLICITUDES, planEstado.col, Number(row), 'aplicada');

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * API: RECHAZAR SOLICITUD (POST — dueño)
 * =================================================================== */

router.post('/api/rechazar-solicitud', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row, motivo } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });

    const planEstado = await findOrPlanColumn(TAB_SOLICITUDES, ['estado']);
    if (planEstado.create) await ensureHeader(TAB_SOLICITUDES, planEstado.col, 'estado', false);
    await writeCell(TAB_SOLICITUDES, planEstado.col, Number(row), 'rechazada');

    if (motivo) {
      const planMotivo = await findOrPlanColumn(TAB_SOLICITUDES, ['motivo_rechazo']);
      if (planMotivo.create) await ensureHeader(TAB_SOLICITUDES, planMotivo.col, 'motivo_rechazo', false);
      await writeCell(TAB_SOLICITUDES, planMotivo.col, Number(row), motivo);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * API: RESPONDER SUGERENCIA (POST — dueño)
 * =================================================================== */

router.post('/api/responder-sugerencia', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row, respuesta } = req.body || {};
    if (!row || !respuesta) return res.status(400).json({ error: 'Datos incompletos' });

    const planResp = await findOrPlanColumn(TAB_SUGERENCIAS, ['respuesta', 'respuesta_admin']);
    if (planResp.create) await ensureHeader(TAB_SUGERENCIAS, planResp.col, 'respuesta', false);
    await writeCell(TAB_SUGERENCIAS, planResp.col, Number(row), respuesta);

    const planEstado = await findOrPlanColumn(TAB_SUGERENCIAS, ['estado']);
    if (planEstado.create) await ensureHeader(TAB_SUGERENCIAS, planEstado.col, 'estado', false);
    await writeCell(TAB_SUGERENCIAS, planEstado.col, Number(row), 'respondida');

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * EXPORT
 * =================================================================== */

module.exports = router;
