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
const SESSION_SECRET =
  process.env.DASHBOARD_SECRET || 'marcos-secret-cambiar-en-produccion-2024';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_FILE =
  process.env.GOOGLE_CREDENTIALS_FILE ||
  'gen-lang-client-0735429936-bba6999e5e60.json';

// Nombres de pestanias (tabs) esperados en el Google Sheet.
// Se pueden sobreescribir por .env si los nombres reales difieren.
const TAB_EVENTOS = process.env.SHEET_TAB_EVENTOS || 'Eventos';
const TAB_EDIFICIOS = process.env.SHEET_TAB_EDIFICIOS || 'Edificios';
const TAB_ARCHIVOS = process.env.SHEET_TAB_ARCHIVOS || 'Archivos';
const TAB_FEEDBACK = process.env.SHEET_TAB_FEEDBACK || 'Feedback';

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
    mensaje: pick(r, ['mensaje', 'texto', 'consulta', 'detalle', 'descripcion', 'contenido']),
    transcripcion: pick(r, ['transcripcion', 'transcripcion_audio', 'transcript', 'audio_texto']),
    urgencia,
    resumen: pick(r, ['resumen', 'sintesis', 'respuesta_marcos', 'respuesta']),
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
    url: pick(r, ['url', 'link', 'enlace', 'drive_url', 'archivo', 'imagen', 'foto', 'factura']),
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
    administrador: pick(r, ['administrador', 'admin']),
    tel_admin: pick(r, ['telefono_admin', 'tel_admin', 'telefono_administrador']),
    propietarios: pick(r, ['propietarios', 'duenos', 'duenios']),
    telefonos: pick(r, ['telefonos', 'contactos', 'telefono', 'numeros']),
    notas: pick(r, ['notas', 'observaciones', 'comentarios']),
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

function page(active, title, bodyHtml) {
  const nav = [
    ['/admin', 'Resumen', 'resumen'],
    ['/admin/eventos', 'Eventos', 'eventos'],
    ['/admin/archivos', 'Facturas/Fotos', 'archivos'],
    ['/admin/edificios', 'Edificios', 'edificios'],
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
        .map(
          ([href, label, id]) =>
            `<a href="${href}" class="${active === id ? 'active' : ''}">${label}</a>`
        )
        .join('')}
    </nav>
    <div class="spacer"></div>
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
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authed = true;
    req.session.user = user;
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
    const eventos = rows.map(mapEvento);

    const hoy = eventos.filter((e) => esHoy(parseFecha(e.fecha)));
    const urgentesHoy = hoy.filter((e) => e.urgencia === 'alta');
    const mediaHoy = hoy.filter((e) => e.urgencia === 'media');
    const edificiosHoy = new Set(hoy.map((e) => e.edificio).filter(Boolean));

    // ultimos 5 eventos
    const ult = [...eventos]
      .sort(
        (a, b) =>
          (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0)
      )
      .slice(0, 6);

    const cards = `
      <div class="cards">
        <div class="card"><div class="k">Eventos hoy</div><div class="v">${hoy.length}</div></div>
        <div class="card alta"><div class="k">Urgencias</div><div class="v">${urgentesHoy.length}</div></div>
        <div class="card media"><div class="k">Prioridad media</div><div class="v">${mediaHoy.length}</div></div>
        <div class="card ok"><div class="k">Edificios activos</div><div class="v">${edificiosHoy.size}</div></div>
        <div class="card"><div class="k">Eventos totales</div><div class="v">${eventos.length}</div></div>
      </div>`;

    const saludo = horaSaludo();

    const ultHtml = ult.length
      ? `<div class="feed">${ult.map(renderEventoMini).join('')}</div>`
      : `<div class="empty">Todavia no hay eventos registrados.</div>`;

    res.send(
      page(
        'resumen',
        'Resumen',
        `<h1>${saludo}, tomate unos mates 🧉</h1>
         <p style="color:var(--muted);margin-top:-8px">Esto es lo que paso mientras dormias.</p>
         ${cards}
         <h2>Ultimos movimientos</h2>
         ${ultHtml}
         <p style="margin-top:18px"><a class="btn ghost sm" href="/admin/eventos">Ver todos los eventos →</a></p>`
      )
    );
  } catch (e) {
    res.status(500).send(page('resumen', 'Resumen', errorBox(e)));
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
    let eventos = rows.map(mapEvento);
    eventos.sort(
      (a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0)
    );

    const edificios = [...new Set(eventos.map((e) => e.edificio).filter(Boolean))].sort();

    const opcionesEdi = edificios
      .map((e) => `<option value="${esc(e)}">${esc(e)}</option>`)
      .join('');

    const feed = eventos.length
      ? `<div class="feed">${eventos.map(renderEventoFull).join('')}</div>
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
         ${feed}`
      )
    );
  } catch (e) {
    res.status(500).send(page('eventos', 'Eventos', errorBox(e)));
  }
});

function renderEventoFull(e) {
  const transcript = e.transcripcion
    ? `<div class="transcript"><span class="lbl">Transcripcion del audio</span>${esc(e.transcripcion)}</div>`
    : '';

  const resumen = e.resumen
    ? `<div class="meta" style="margin-top:8px"><b>Marcos:</b> ${esc(e.resumen)}</div>`
    : '';

  const existing = `<div class="existing" data-existing style="${e.feedback ? '' : 'display:none'}"><b>Tu nota:</b> ${esc(e.feedback)}</div>`;

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
      </div>
    </div>
    ${e.mensaje ? `<div class="body">${esc(e.mensaje)}</div>` : ''}
    ${transcript}
    ${resumen}
    <div class="fb">
      ${existing}
      <div class="row">
        <textarea data-fb placeholder="Dejale una nota a Marcos para que aprenda de este caso...">${esc(e.feedback || '')}</textarea>
        <button class="btn sm" onclick="guardarFeedback(this, ${e._row})">Guardar nota</button>
      </div>
    </div>
  </div>`;
}

/* ----------------- FACTURAS / FOTOS ----------------- */

router.get('/archivos', async (req, res) => {
  try {
    const { rows } = await readTab(TAB_ARCHIVOS);
    let archivos = rows.map(mapArchivo).filter((a) => a.url || a.descripcion);
    archivos.sort(
      (a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0)
    );

    const body = archivos.length
      ? `<div class="grid-files">${archivos.map(renderArchivo).join('')}</div>`
      : `<div class="empty">No hay facturas ni fotos cargadas todavia.</div>`;

    res.send(
      page(
        'archivos',
        'Facturas/Fotos',
        `<h1>Facturas y fotos</h1>
         <p style="color:var(--muted);margin-top:-8px">Archivos que enviaron vecinos o proveedores.</p>
         ${body}`
      )
    );
  } catch (e) {
    res.status(500).send(page('archivos', 'Facturas/Fotos', errorBox(e)));
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
      ${a.url ? `<div style="margin-top:8px"><a class="btn ghost sm" href="${esc(a.url)}" target="_blank" rel="noopener">Abrir →</a></div>` : ''}
    </div>
  </div>`;
}

/* ----------------- EDIFICIOS (ver/editar) ----------------- */

router.get('/edificios', async (req, res) => {
  try {
    const { rows } = await readTab(TAB_EDIFICIOS);
    const edificios = rows.map(mapEdificio);

    const filas = edificios
      .map(
        (e) => `<tr>
          <td><b>${esc(e.nombre)}</b></td>
          <td><input data-field="encargado" value="${esc(e.encargado)}" placeholder="Encargado"></td>
          <td><input data-field="tel_encargado" value="${esc(e.tel_encargado)}" placeholder="Tel."></td>
          <td><input data-field="administrador" value="${esc(e.administrador)}" placeholder="Administrador"></td>
          <td><input data-field="propietarios" value="${esc(e.propietarios)}" placeholder="Propietarios"></td>
          <td><input data-field="telefonos" value="${esc(e.telefonos)}" placeholder="Telefonos"></td>
          <td><button class="btn sm" onclick="guardarEdificio(this, ${e._row})">Guardar</button></td>
        </tr>`
      )
      .join('');

    const body = edificios.length
      ? `<div class="tablewrap"><table>
          <thead><tr>
            <th>Edificio</th><th>Encargado</th><th>Tel. enc.</th>
            <th>Administrador</th><th>Propietarios</th><th>Telefonos</th><th></th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table></div>`
      : `<div class="empty">No hay edificios cargados.</div>`;

    res.send(
      page(
        'edificios',
        'Edificios',
        `<h1>Datos de edificios</h1>
         <p style="color:var(--muted);margin-top:-8px">Edita encargados, propietarios y telefonos. Los cambios se guardan en Google Sheets.</p>
         ${body}`
      )
    );
  } catch (e) {
    res.status(500).send(page('edificios', 'Edificios', errorBox(e)));
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
  encargado: ['encargado', 'portero', 'sereno'],
  tel_encargado: ['telefono_encargado', 'tel_encargado', 'celular_encargado'],
  administrador: ['administrador', 'admin'],
  propietarios: ['propietarios', 'duenos', 'duenios'],
  telefonos: ['telefonos', 'contactos', 'numeros'],
  notas: ['notas', 'observaciones', 'comentarios'],
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
 * EXPORT
 * =================================================================== */

module.exports = router;
