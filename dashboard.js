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
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap');

:root{
  --bg:#EEF1F6; --card:#FFFFFF; --line:#E7ECF3; --line2:#E4E9F1;
  --ink:#16233B; --muted:#64748B; --muted2:#8595AD;
  --brand:#1E5FB4; --brand2:#2E6FC0; --brand-deep:#0F326A; --brand-mid:#17408B;
  --gold:#D99B1F;
  --ok:#16A34A; --ok-deep:#1B7A43; --ok-bg:#E7F4EC;
  --warn:#D99B1F; --warn-deep:#8A6410; --warn-bg:#FBF3DE;
  --bad:#E5484D; --bad-deep:#C0392B; --bad-bg:#FDECEC;
  --radius:14px; --radius-sm:11px; --radius-pill:999px;
  --shadow:0 1px 2px rgba(16,35,59,.04);
  --shadow-pop:0 16px 40px -12px rgba(16,35,59,.28);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--ink);
  font-family:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
a{color:var(--brand2);text-decoration:none}
a:hover{text-decoration:underline}

/* ---------- APP SHELL (sidebar + main) ---------- */
.app-shell{display:flex;min-height:100vh;align-items:stretch}
.sidebar{
  width:232px;flex-shrink:0;background:var(--card);border-right:1px solid var(--line);
  padding:22px 16px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;
}
.side-brand{display:flex;align-items:center;gap:10px;padding:0 6px 20px;margin-bottom:4px}
.side-brand .mark{
  width:34px;height:34px;border-radius:9px;background:linear-gradient(150deg,var(--brand-deep),var(--brand2));
  color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex-shrink:0;
}
.side-brand .name{font-weight:800;font-size:16.5px;letter-spacing:-.01em;line-height:1.15}
.side-menu-label{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--muted2);text-transform:uppercase;padding:0 10px;margin:10px 0 8px}
.side-nav{display:flex;flex-direction:column;gap:2px}
.side-nav a{
  display:flex;align-items:center;gap:11px;padding:10px 11px;border-radius:10px;
  color:var(--muted);font-weight:600;font-size:14.5px;position:relative;
}
.side-nav a .ico{font-size:15px;width:18px;text-align:center;flex-shrink:0}
.side-nav a:hover{background:var(--bg);text-decoration:none;color:var(--ink)}
.side-nav a.active{background:rgba(46,111,192,.10);color:var(--brand);text-decoration:none}
.side-nav a .count{
  margin-left:auto;background:var(--bad);color:#fff;font-size:11px;font-weight:700;
  min-width:19px;height:19px;border-radius:999px;display:flex;align-items:center;justify-content:center;padding:0 5px;
}
.side-spacer{flex:1}
.side-help{
  background:linear-gradient(150deg,var(--brand-deep),var(--brand2));color:#fff;border-radius:var(--radius);
  padding:16px;margin-top:16px;
}
.side-help h4{margin:0 0 4px;font-size:14px;font-weight:700}
.side-help p{margin:0 0 12px;font-size:12.5px;color:rgba(255,255,255,.82);line-height:1.4}
.side-help .btn{width:100%;justify-content:center;background:#fff;color:var(--brand)}
.side-help .btn:hover{background:#f2f6fc}

.app-main{flex:1;min-width:0;display:flex;flex-direction:column}
.app-topbar{
  position:sticky;top:0;z-index:30;background:rgba(238,241,246,.92);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);padding:14px 28px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
}
.topbar-pill{
  display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius-sm);padding:7px 12px;font-size:13.5px;font-weight:600;color:var(--ink);
}
.topbar-pill .sub{color:var(--muted2);font-weight:500;font-size:12px}
.spacer{flex:1}
.bell{position:relative;width:38px;height:38px;border-radius:10px;background:var(--card);border:1px solid var(--line);
  display:flex;align-items:center;justify-content:center;font-size:16px;cursor:default}
.bell .count{position:absolute;top:-5px;right:-5px;background:var(--bad);color:#fff;font-size:10.5px;font-weight:700;
  min-width:17px;height:17px;border-radius:999px;display:flex;align-items:center;justify-content:center;padding:0 4px}
.avatar-wrap{position:relative}
.avatar-btn{display:flex;align-items:center;gap:9px;background:none;border:none;cursor:pointer;padding:4px;border-radius:10px;font-family:inherit}
.avatar-btn:hover{background:var(--card)}
.avatar-circ{width:36px;height:36px;border-radius:10px;color:#fff;font-weight:800;font-size:13.5px;
  display:flex;align-items:center;justify-content:center;flex-shrink:0}
.avatar-circ.owner{background:var(--brand)}
.avatar-circ.client{background:var(--gold)}
.avatar-name{text-align:left;line-height:1.2}
.avatar-name .n{font-weight:700;font-size:13.5px;color:var(--ink)}
.avatar-name .r{font-size:11.5px;color:var(--muted2)}
.avatar-menu{
  display:none;position:absolute;right:0;top:calc(100% + 8px);background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow-pop);min-width:200px;padding:8px;z-index:40;
}
.avatar-menu.open{display:block}
.avatar-menu a{display:block;padding:9px 11px;border-radius:8px;color:var(--ink);font-size:14px;font-weight:600}
.avatar-menu a:hover{background:var(--bg);text-decoration:none}
.avatar-menu a.danger{color:var(--bad-deep)}
.avatar-menu hr{border:none;border-top:1px solid var(--line);margin:6px 2px}

.content{max-width:1100px;width:100%;margin:0 auto;padding:28px}

.btn{
  background:var(--brand2);color:#fff;border:none;padding:10px 16px;
  border-radius:var(--radius-sm);font-weight:700;cursor:pointer;font-size:14px;font-family:inherit;
  transition:.15s;display:inline-flex;align-items:center;gap:6px
}
.btn:hover{background:var(--brand)}
.btn.ghost{background:var(--card);color:var(--ink);border:1px solid var(--line)}
.btn.ghost:hover{background:var(--bg)}
.btn.sm{padding:7px 12px;font-size:13px}

h1{font-size:23px;font-weight:800;letter-spacing:-.01em;margin:6px 0 18px}
h2{font-size:17px;font-weight:700;margin:26px 0 12px}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:8px}
.card{
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:18px;box-shadow:var(--shadow)
}
.card .k{color:var(--muted);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
.card .v{font-size:30px;font-weight:800;margin-top:6px;color:var(--ink)}
.card.alta .v{color:var(--bad)} .card.media .v{color:var(--warn-deep)} .card.ok .v{color:var(--ok-deep)}

.filters{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 18px;align-items:center}
select,input,textarea{
  background:var(--card);color:var(--ink);border:1.5px solid var(--line);
  border-radius:var(--radius-sm);padding:9px 12px;font-size:14px;font-family:inherit;outline:none
}
select:focus,input:focus,textarea:focus{border-color:var(--brand2);box-shadow:0 0 0 4px rgba(46,111,192,.12)}
textarea{width:100%;resize:vertical;min-height:60px}
label.flt{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}

.feed{display:flex;flex-direction:column;gap:12px}
.event{
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:16px;box-shadow:var(--shadow);position:relative
}
.event .head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
.event .who{font-weight:700}
.event .meta{color:var(--muted);font-size:13px;margin-top:2px}
.event .body{margin-top:10px;white-space:pre-wrap}
.event .transcript{
  margin-top:10px;background:var(--bg);border-left:3px solid var(--brand2);
  padding:10px 12px;border-radius:8px;font-size:14px;color:var(--ink)
}
.event .transcript .lbl{color:var(--muted);font-size:12px;font-weight:600;display:block;margin-bottom:3px}

.badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.badge{font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px}
.badge.alta{background:var(--bad-bg);color:var(--bad-deep);border:1px solid rgba(229,72,77,.3)}
.badge.media{background:var(--warn-bg);color:var(--warn-deep);border:1px solid rgba(217,155,31,.35)}
.badge.baja{background:var(--ok-bg);color:var(--ok-deep);border:1px solid rgba(22,163,74,.3)}
.badge.tipo{background:var(--bg);color:var(--muted);border:1px solid var(--line)}

.fb{margin-top:12px;border-top:1px dashed var(--line);padding-top:12px}
.fb .row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.fb textarea{flex:1;min-width:200px}
.fb .saved{color:var(--ok-deep);font-size:13px;font-weight:600}
.fb .existing{background:var(--bg);padding:8px 11px;border-radius:8px;font-size:13px;margin-bottom:8px}
.fb .existing b{color:var(--brand)}

.grid-files{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.file{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.file .thumb{height:140px;background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden}
.file .thumb img{width:100%;height:100%;object-fit:cover}
.file .thumb .ph{font-size:40px;color:var(--muted2)}
.file .info{padding:12px}
.file .info .t{font-weight:700;font-size:14px}
.file .info .m{color:var(--muted);font-size:12px;margin-top:3px}

table{width:100%;border-collapse:collapse;font-size:14px}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--bg);color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.4px;position:sticky;top:0}
tr:last-child td{border-bottom:none}
td input{width:100%}

.empty{text-align:center;color:var(--muted);padding:50px 20px;
  background:var(--card);border:1px dashed var(--line);border-radius:var(--radius)}

.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);
  background:var(--ink);color:#fff;padding:12px 18px;border-radius:12px;
  box-shadow:var(--shadow-pop);opacity:0;transition:.25s;z-index:80;font-weight:600}
.toast.show{opacity:1;bottom:28px}
.toast.ok{background:var(--ok-deep)}
.toast.err{background:var(--bad-deep)}

/* FICHA EDIFICIO */
.ficha{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);margin-bottom:24px}
.ficha .ficha-head{display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap}
.ficha .ficha-icon{width:64px;height:64px;border-radius:14px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0}
.ficha .ficha-data h2{margin:0 0 4px;font-size:20px}
.ficha .ficha-data .dir{color:var(--muted);font-size:14px;margin-bottom:10px}
.ficha .ficha-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.ficha .chip{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:6px 12px;font-size:13px}
.ficha .chip b{color:var(--brand)}
.ficha-divider{border:none;border-top:1px solid var(--line);margin:18px 0}

/* SUGERENCIAS / SOLICITUDES */
.sug-form{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:20px}
.sug-form h3{margin:0 0 12px;font-size:16px}
.sug-list{display:flex;flex-direction:column;gap:10px}
.sug-item{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.sug-item .sug-meta{color:var(--muted);font-size:12px;margin-bottom:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sug-item .sug-texto{white-space:pre-wrap}
.sug-item .sug-resp{margin-top:10px;background:var(--bg);border-left:3px solid var(--ok);padding:8px 12px;border-radius:6px;font-size:14px}
.badge.pendiente{background:var(--warn-bg);color:var(--warn-deep);border:1px solid rgba(217,155,31,.35)}
.badge.aprobada{background:var(--ok-bg);color:var(--ok-deep);border:1px solid rgba(22,163,74,.3)}
.badge.rechazada{background:var(--bad-bg);color:var(--bad-deep);border:1px solid rgba(229,72,77,.3)}
.badge.aplicada{background:rgba(46,111,192,.12);color:var(--brand);border:1px solid rgba(46,111,192,.3)}
.sol-campo{font-family:ui-monospace,Menlo,monospace;background:var(--bg);padding:3px 8px;border-radius:6px;font-size:13px}
.sol-diff{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center}
.sol-diff .old{color:var(--bad-deep);text-decoration:line-through;font-size:13px}
.sol-diff .arr{color:var(--muted)}
.sol-diff .new{color:var(--ok-deep);font-weight:600;font-size:13px}

/* LOGIN */
.login-shell{min-height:100vh;display:grid;grid-template-columns:1.05fr 1fr}
.login-brand{
  position:relative;background:linear-gradient(150deg,var(--brand-deep) 0%,var(--brand-mid) 45%,var(--brand2) 100%);
  color:#fff;padding:56px 60px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;
}
.login-brand::before{content:"";position:absolute;top:-120px;right:-120px;width:420px;height:420px;border-radius:50%;
  background:radial-gradient(circle,rgba(217,155,31,.28),transparent 70%)}
.login-brand::after{content:"";position:absolute;bottom:-160px;left:-80px;width:380px;height:380px;border-radius:50%;
  background:radial-gradient(circle,rgba(255,255,255,.10),transparent 70%)}
.login-brand>*{position:relative}
.login-brand .top{display:flex;align-items:center;gap:14px}
.login-brand .mark{width:52px;height:52px;border-radius:12px;background:#fff;color:var(--brand);font-weight:800;
  font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px -8px rgba(0,0,0,.35)}
.login-brand .top .name{font-weight:800;font-size:20px;letter-spacing:-.02em}
.login-brand .top .by{font-size:12px;color:rgba(255,255,255,.72);font-weight:600}
.login-brand .status{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);
  border:1px solid rgba(255,255,255,.18);padding:7px 14px;border-radius:999px;font-size:13px;font-weight:600;margin-bottom:24px}
.login-brand .status .dot{width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 0 4px rgba(74,222,128,.25)}
.login-brand h1{font-size:38px;line-height:1.1;font-weight:800;letter-spacing:-.03em;margin:0 0 16px;text-wrap:balance}
.login-brand p{font-size:16.5px;line-height:1.55;color:rgba(255,255,255,.82);max-width:440px;margin:0}
.login-form-wrap{display:flex;align-items:center;justify-content:center;padding:40px}
.login-form{width:100%;max-width:380px}
.login-eyebrow{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--brand2);margin-bottom:10px}
.login-form h2{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 6px}
.login-form .sub{color:var(--muted);font-size:15px;margin:0 0 26px}
.login-form label{display:block;font-size:13px;font-weight:700;color:var(--ink);margin-bottom:7px}
.login-form .field{margin-bottom:16px}
.login-form input{width:100%;height:46px;padding:0 14px}
.login-form .btn{width:100%;justify-content:center;margin-top:6px;padding:12px;font-size:15px}
.login-form .err{background:var(--bad-bg);color:var(--bad-deep);
  border:1px solid rgba(229,72,77,.35);padding:10px 12px;border-radius:10px;margin-bottom:16px;font-size:14px}
.login-form .demo{margin-top:20px;font-size:12.5px;color:var(--muted2);text-align:center}

@media(max-width:900px){
  .login-shell{grid-template-columns:1fr}
  .login-brand{display:none}
  .app-shell{flex-direction:column}
  .sidebar{width:100%;height:auto;position:static;flex-direction:row;flex-wrap:wrap;padding:14px 16px}
  .side-nav{flex-direction:row;flex-wrap:wrap}
  .side-help,.side-spacer{display:none}
}
@media(max-width:600px){
  .card .v{font-size:24px}
  h1{font-size:20px}
  .content{padding:18px}
}
`;

/* ===================================================================
 * LAYOUT
 * =================================================================== */

function page(active, title, bodyHtml, req) {
  const isDueno = !req || (req.session && req.session.role === 'dueno');
  const userName = (req && req.session && req.session.user) || '';
  const edificios = (req && edificiosPermitidos(req)) || [];

  const nav = [
    ['/admin', '📊', 'Resumen', 'resumen', true],
    ['/admin/mi-edificio', '🏢', 'Mi Edificio', 'mi-edificio', !isDueno],
    ['/admin/eventos', '🔔', 'Eventos', 'eventos', true],
    ['/admin/archivos', '📄', 'Facturas/Fotos', 'archivos', true],
    ['/admin/sugerencias', '💡', 'Sugerencias', 'sugerencias', !isDueno],
    ['/admin/edificios', '🏢', 'Edificios', 'edificios', isDueno],
    ['/admin/solicitudes', '📋', 'Solicitudes', 'solicitudes', isDueno],
  ];

  const initials = (userName || 'M').slice(0, 2).toUpperCase();
  const topbarPill = isDueno
    ? `<div class="topbar-pill">🏢 Todos los edificios</div>`
    : `<div class="topbar-pill">🏢 ${esc(edificios.join(', ') || 'Sin edificio asignado')}</div>`;

  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${esc(title)} · Marcos IA</title>
<style>${CSS}</style>
</head>
<body>
<div class="app-shell">
  <aside class="sidebar">
    <div class="side-brand">
      <div class="mark">M</div>
      <div class="name">Marcos IA</div>
    </div>
    <div class="side-menu-label">Menú</div>
    <nav class="side-nav">
      ${nav
        .filter(([, , , , visible]) => visible)
        .map(
          ([href, ico, label, id]) =>
            `<a href="${href}" class="${active === id ? 'active' : ''}"><span class="ico">${ico}</span>${label}</a>`
        )
        .join('')}
    </nav>
    <div class="side-spacer"></div>
    <div class="side-help">
      <h4>¿Necesitás algo?</h4>
      <p>Tu consorcio está siendo atendido las 24 horas.</p>
      <a class="btn sm" href="${isDueno ? '/admin/solicitudes' : '/admin/sugerencias'}">Enviar sugerencia</a>
    </div>
  </aside>

  <div class="app-main">
    <header class="app-topbar">
      ${topbarPill}
      <div class="spacer"></div>
      <div class="avatar-wrap">
        <button class="avatar-btn" onclick="toggleAvatarMenu()">
          <div class="avatar-circ ${isDueno ? 'owner' : 'client'}">${esc(initials)}</div>
          <div class="avatar-name">
            <div class="n">${esc(userName || 'Usuario')}</div>
            <div class="r">${isDueno ? 'Admin de sistema' : 'Administrador'}</div>
          </div>
        </button>
        <div class="avatar-menu" id="avatar-menu">
          <a href="#">👤 Mi cuenta</a>
          <a href="#">⚙️ Preferencias</a>
          <hr>
          <a href="/admin/logout" class="danger">↩ Cerrar sesión</a>
        </div>
      </div>
    </header>
    <main class="content">
${bodyHtml}
    </main>
  </div>
</div>
<div id="toast" class="toast"></div>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

/* ===================================================================
 * CLIENT-SIDE JS (vanilla)
 * =================================================================== */

const CLIENT_JS = `
function toggleAvatarMenu(){
  var m=document.getElementById('avatar-menu');
  if(!m)return;
  var willOpen=!m.classList.contains('open');
  m.classList.toggle('open',willOpen);
  if(willOpen){
    setTimeout(function(){
      document.addEventListener('click',function closeIt(e){
        if(!m.contains(e.target)){m.classList.remove('open');document.removeEventListener('click',closeIt);}
      });
    },0);
  }
}

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
    ? `<div class="err">Usuario o contraseña incorrectos.</div>`
    : '';
  res.send(`<!DOCTYPE html>
<html lang="es-AR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ingresar · Marcos IA</title><style>${CSS}</style></head>
<body>
<div class="login-shell">
  <div class="login-brand">
    <div class="top">
      <div class="mark">M</div>
      <div>
        <div class="name">Marcos IA</div>
        <div class="by">por Bien Argentinos</div>
      </div>
    </div>
    <div>
      <div class="status"><span class="dot"></span> Atención 24/7 activa</div>
      <h1>Todo lo que pasó<br>en tu edificio,<br>mientras no estabas.</h1>
      <p>Marcos atiende los WhatsApp y llamados de tu consorcio las 24 horas. Este panel es tu ventana: reclamos, urgencias, facturas y avisos, ordenados y al día.</p>
    </div>
    <div style="display:flex;gap:26px;font-size:13px;color:rgba(255,255,255,.72)">
      <div><span style="display:block;font-size:22px;font-weight:800;color:#fff">24/7</span>sin horarios</div>
      <div><span style="display:block;font-size:22px;font-weight:800;color:#fff">CABA</span>y GBA</div>
    </div>
  </div>
  <div class="login-form-wrap">
    <form class="login-form" method="POST" action="/admin/login">
      <div class="login-eyebrow">Panel de administración</div>
      <h2>Ingresá a tu cuenta</h2>
      <p class="sub">Usá el usuario y la contraseña de tu cuenta de administrador.</p>
      ${err}
      <div class="field">
        <label>Usuario</label>
        <input name="user" autocomplete="username" autofocus required placeholder="tu_usuario">
      </div>
      <div class="field">
        <label>Contraseña</label>
        <input name="pass" type="password" autocomplete="current-password" required placeholder="••••••••">
      </div>
      <button class="btn" type="submit">Ingresar al panel</button>
    </form>
  </div>
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
