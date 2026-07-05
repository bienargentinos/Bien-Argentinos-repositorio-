/**
 * dashboard.js — Panel de administración "Marcos IA"
 * -------------------------------------------------------------------
 * Router de Express montado en /admin del servidor principal:
 *
 *     const dashboard = require('./dashboard');
 *     app.use('/admin', dashboard);
 *
 * UI porteada 1:1 del prototipo de diseño (design/Panel Consorcio.dc.html)
 * siguiendo design/PORTING.md: markup y estilos inline copiados del
 * prototipo, con los {{ }} reemplazados por datos reales de Google Sheets.
 *
 * Roles: dueño (Daniel, ve todo) y cliente (admin de consorcio, ve lo suyo).
 * El dueño puede impersonar ("Ver como cliente") en modo solo lectura.
 * -------------------------------------------------------------------
 */

'use strict';

const express = require('express');
const session = require('express-session');
const path = require('path');
const { google } = require('googleapis');

const router = express.Router();

// Logo de marca (design/assets/logo.png). Servido cacheable, sin sesion.
router.use('/assets', express.static(path.join(__dirname, 'design', 'assets'), {
  maxAge: '7d',
}));
const LOGO_URL = '/admin/assets/logo.png';

/* ===================================================================
 * CONFIGURACION
 * =================================================================== */

const ADMIN_USER = process.env.DASHBOARD_USER || 'admin';
const ADMIN_PASS = process.env.DASHBOARD_PASS || 'marcos2024';

// Usuarios de administradores de consorcio via .env (fallback historico).
// Formato: CONSORCIO_USERS={"usuario1":"pass1:Edificio A,Edificio B"}
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

// Pestanias reales que usa Marcos (sheets.js), en minuscula.
const TAB_EVENTOS = process.env.SHEET_TAB_EVENTOS || 'reportes';
const TAB_EDIFICIOS = process.env.SHEET_TAB_EDIFICIOS || 'edificios';
const TAB_ARCHIVOS = process.env.SHEET_TAB_ARCHIVOS || 'facturas';
const TAB_SUGERENCIAS = process.env.SHEET_TAB_SUGERENCIAS || 'sugerencias';
const TAB_SOLICITUDES = process.env.SHEET_TAB_SOLICITUDES || 'solicitudes';
const TAB_CLIENTES = process.env.SHEET_TAB_CLIENTES || 'clientes';
const TAB_EXPENSAS = process.env.SHEET_TAB_EXPENSAS || 'expensas';
const TAB_PROVEEDORES = process.env.SHEET_TAB_PROVEEDORES || 'proveedores';
const TAB_ASIGNACIONES = process.env.SHEET_TAB_ASIGNACIONES || 'proveedor_asignaciones';

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
    },
  })
);

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

/* ===================================================================
 * CLIENTE GOOGLE SHEETS
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

/** Lee una pestania completa como array de objetos (headers en minuscula). */
async function readTab(tabName) {
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A:Z`,
    });
  } catch (e) {
    return { headers: [], rows: [], rawHeaders: [] };
  }
  const values = (res.data && res.data.values) || [];
  if (values.length === 0) return { headers: [], rows: [], rawHeaders: [] };
  const rawHeaders = values[0].map((h) => String(h || '').trim());
  const headers = rawHeaders.map(normalizeKey);
  const rows = values.slice(1).map((row, idx) => {
    const obj = { _row: idx + 2 };
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
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function pick(obj, keys, fallback = '') {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== '') return obj[k];
  }
  return fallback;
}

/* ===================================================================
 * MAPPERS (fila de Sheets -> shape estable)
 * =================================================================== */

function mapEvento(r) {
  const tipoRaw = String(pick(r, ['tipo', 'canal', 'tipo_mensaje', 'medio'])).toLowerCase();
  let tipo = 'texto';
  if (/audio|voz|nota/.test(tipoRaw)) tipo = 'audio';
  else if (/llamad|call|telefono|voice/.test(tipoRaw)) tipo = 'llamada';
  else if (/imagen|foto|image/.test(tipoRaw)) tipo = 'imagen';

  const urgRaw = String(pick(r, ['urgencia', 'prioridad', 'gravedad', 'severidad'])).toLowerCase();
  let urgencia = 'baja';
  if (/alta|urgent|critic|grave|emergen/.test(urgRaw)) urgencia = 'alta';
  else if (/media|medio|moder/.test(urgRaw)) urgencia = 'media';
  else if (/baja|bajo|low|normal/.test(urgRaw)) urgencia = 'baja';
  else if (urgRaw) urgencia = 'media';

  return {
    _row: r._row,
    fecha: pick(r, ['fecha', 'fecha_hora', 'timestamp', 'fecha_y_hora', 'hora']),
    edificio: pick(r, ['edificio', 'consorcio', 'building', 'direccion'], 'Sin edificio'),
    vecino: pick(r, ['vecino', 'nombre', 'remitente', 'contacto', 'usuario'], 'Vecino'),
    telefono: pick(r, ['telefono', 'numero', 'phone', 'celular', 'whatsapp']),
    tipo,
    mensaje: pick(r, ['problema', 'mensaje', 'texto', 'consulta', 'detalle', 'descripcion', 'contenido']),
    notas: pick(r, ['notas_ia', 'transcripcion', 'resumen', 'sintesis', 'respuesta_marcos']),
    urgencia,
    estado: pick(r, ['estado', 'status']),
    tecnico: pick(r, ['tecnico', 'proveedor', 'rubro']),
    feedback: pick(r, ['feedback', 'nota_admin', 'aprendizaje', 'comentario_admin']),
  };
}

function mapEdificio(r) {
  return {
    _row: r._row,
    nombre: pick(r, ['edificio', 'nombre', 'consorcio'], 'Sin nombre'),
    direccion: pick(r, ['direccion', 'domicilio', 'address']),
    zona: pick(r, ['zona', 'barrio']),
    tipo: pick(r, ['tipo'], 'Edificio'),
    encargado: pick(r, ['encargado', 'portero', 'sereno']),
    tel_encargado: pick(r, ['telefono_encargado', 'tel_encargado', 'celular_encargado']),
    encargado_estado: pick(r, ['encargado_estado', 'estado_encargado'], 'activo'),
    encargado_horario: pick(r, ['encargado_horario', 'horario_encargado']),
    encargado_suplente: pick(r, ['encargado_suplente', 'suplente', 'personal_limpieza']),
    tel_suplente: pick(r, ['tel_suplente', 'telefono_suplente']),
    tel_seguridad: pick(r, ['telefono_seguridad', 'tel_seguridad', 'seguridad']),
    administrador: pick(r, ['admin_nombre', 'administrador', 'admin']),
    telefonos: pick(r, ['admin_telefono', 'telefonos', 'contactos', 'telefono', 'numeros']),
    cuit: pick(r, ['cuit']),
    horario_sum: pick(r, ['horario_sum', 'sum']),
    cocheras: pick(r, ['cocheras', 'cochera']),
    notas: pick(r, ['notas_especiales', 'notas', 'observaciones', 'comentarios']),
    aliases: pick(r, ['aliases', 'alias', 'otros_nombres']),
    unidades: pick(r, ['unidades', 'unidad', 'departamentos']),
    plan: pick(r, ['plan'], 'Base'),
  };
}

function mapCliente(r) {
  return {
    _row: r._row,
    nombre: pick(r, ['nombre', 'razon_social'], 'Sin nombre'),
    usuario: pick(r, ['usuario', 'user']),
    pass: pick(r, ['contrasena', 'password', 'pass', 'clave']),
    email: pick(r, ['email', 'correo', 'mail']),
    edificios: pick(r, ['edificios', 'edificio'])
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    activo: String(pick(r, ['activo'], 'si')).toLowerCase() !== 'no',
    ultimo_acceso: pick(r, ['ultimo_acceso']),
  };
}

function mapFactura(r) {
  const url = pick(r, ['url_archivo', 'url', 'link', 'enlace', 'archivo']);
  const concepto = pick(r, ['concepto', 'descripcion', 'detalle'], 'Comprobante');
  const monto = pick(r, ['monto', 'importe', 'total']);
  const esFoto = /foto|imagen/i.test(concepto) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
  let moneda = 'ARS';
  if (/usd|u\$s|dolar/i.test(monto + ' ' + concepto)) moneda = 'USD';
  else if (/eur|€/i.test(monto + ' ' + concepto)) moneda = 'EUR';
  return {
    _row: r._row,
    fecha: pick(r, ['fecha', 'fecha_hora', 'timestamp']),
    proveedor: pick(r, ['proveedor', 'vecino', 'remitente'], 'Sin datos'),
    monto,
    concepto,
    edificio: pick(r, ['edificio', 'consorcio'], 'Sin edificio'),
    url,
    estado: pick(r, ['estado'], 'Pendiente'),
    tipo: esFoto ? 'Foto' : 'Factura',
    moneda,
  };
}

function mapExpensa(r) {
  return {
    _row: r._row,
    fecha: pick(r, ['fecha']),
    edificio: pick(r, ['edificio']),
    periodo: pick(r, ['periodo', 'mes']),
    formato: pick(r, ['formato', 'tipo'], 'pdf'),
    nombre: pick(r, ['nombre', 'archivo']),
    url: pick(r, ['url', 'link']),
    estado: pick(r, ['estado'], 'publicada'),
  };
}

// Proveedor: LISTA MAESTRA por cliente (se carga una vez). El mismo plomero
// no se recarga en cada edificio: se asigna despues (mapAsignacion).
function mapProveedor(r) {
  return {
    _row: r._row,
    cliente: pick(r, ['cliente', 'usuario', 'owner']),
    rubro: pick(r, ['rubro', 'especialidad', 'tipo'], 'Otro'),
    nombre: pick(r, ['nombre', 'proveedor', 'empresa']),
    telefono: pick(r, ['telefono', 'tel', 'celular', 'contacto']),
    notas: pick(r, ['notas', 'observaciones']),
    estado: pick(r, ['estado'], 'activo'),
  };
}

// Asignacion proveedor -> edificio con prioridad. Una fila por (proveedor,
// edificio). Denormaliza nombre/telefono/rubro para que Marcos lea esta tab
// sola (edificio + rubro -> proveedor ordenado por prioridad).
function mapAsignacion(r) {
  return {
    _row: r._row,
    cliente: pick(r, ['cliente', 'usuario', 'owner']),
    edificio: pick(r, ['edificio', 'consorcio']),
    proveedor: pick(r, ['proveedor', 'nombre']),
    rubro: pick(r, ['rubro', 'especialidad'], 'Otro'),
    telefono: pick(r, ['telefono', 'tel']),
    prioridad: pick(r, ['prioridad'], 'primera'),
    estado: pick(r, ['estado'], 'activo'),
  };
}

// Rubros sugeridos (el cliente puede escribir otro).
const RUBROS_PROVEEDOR = ['Plomero', 'Gasista', 'Electricista', 'Ascensores', 'Cerrajero', 'Pintor', 'Limpieza', 'Seguridad', 'Otro'];
const PRIORIDADES = [
  { key: 'primera', label: '1ra opción', bg: '#E7F4EC', fg: '#1B7A43' },
  { key: 'segunda', label: '2da opción', bg: '#EAF1FB', fg: '#2C55A8' },
  { key: 'urgencias', label: 'Solo urgencias', bg: '#FBF3DE', fg: '#8A6410' },
];

// Serializa/parsea el horario del encargado. Guardado como JSON en la celda
// encargado_horario para poder rearmar los selectores; el bot puede leerlo.
function parseHorarioEnc(str) {
  if (!str) return { lv1: ['', ''], lv2: ['', ''], sab: ['', ''] };
  try {
    const o = JSON.parse(str);
    return {
      lv1: Array.isArray(o.lv1) ? o.lv1 : ['', ''],
      lv2: Array.isArray(o.lv2) ? o.lv2 : ['', ''],
      sab: Array.isArray(o.sab) ? o.sab : ['', ''],
    };
  } catch (_) {
    return { lv1: ['', ''], lv2: ['', ''], sab: ['', ''] };
  }
}
function horarioTexto(str) {
  const h = parseHorarioEnc(str);
  const seg = [];
  if (h.lv1[0] && h.lv1[1]) seg.push(`Lun a Vie ${h.lv1[0]}-${h.lv1[1]}`);
  if (h.lv2[0] && h.lv2[1]) seg.push(`Lun a Vie ${h.lv2[0]}-${h.lv2[1]}`);
  if (h.sab[0] && h.sab[1]) seg.push(`Sáb ${h.sab[0]}-${h.sab[1]}`);
  return seg.join(' · ') || 'Sin horario cargado';
}

/* ===================================================================
 * FECHAS
 * =================================================================== */

function parseFecha(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  const m = String(str).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ ,T]*(\d{1,2})?:?(\d{1,2})?/);
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    const dd = new Date(Number(yr), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
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
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* ===================================================================
 * AUTH / ROLES / PREVIEW
 * =================================================================== */

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return res.redirect('/admin/login');
}

// Dueño real de la sesion (independiente del modo preview).
function esDuenoReal(req) {
  return req.session && req.session.role === 'dueno';
}

// Modo "Ver como cliente" activo.
function enPreview(req) {
  return esDuenoReal(req) && !!(req.session && req.session.previewOwner);
}

// Vista efectiva: cliente si es rol consorcio O si el dueño esta en preview.
function vistaCliente(req) {
  return !esDuenoReal(req) || enPreview(req);
}

// Dueño con vista de dueño (sin preview).
function esDueno(req) {
  return esDuenoReal(req) && !enPreview(req);
}

// Edificios visibles para la vista actual. null = todos (dueño).
function edificiosPermitidos(req) {
  if (esDueno(req)) return null;
  if (enPreview(req)) return req.session.previewEdificios || [];
  const propios = req.session.edificios || [];
  const activo = req.session.edificioActivo;
  if (activo && propios.includes(activo)) return [activo];
  return propios;
}

// Todos los edificios de la cuenta (sin estrechar por edificioActivo).
function edificiosDeLaCuenta(req) {
  if (enPreview(req)) return req.session.previewEdificios || [];
  return (req.session && req.session.edificios) || [];
}

function filtrarPorEdificio(lista, req, campo = 'edificio') {
  const permitidos = edificiosPermitidos(req);
  if (!permitidos) {
    const filtro = req && req.session && req.session.filtroEdificioDueno;
    if (!filtro) return lista;
    return lista.filter((item) => String(item[campo] || '').toLowerCase().includes(filtro.toLowerCase()));
  }
  return lista.filter((item) =>
    permitidos.some((e) => String(item[campo] || '').toLowerCase().includes(e.toLowerCase()))
  );
}

// Bloquea escrituras del cliente cuando el dueño esta en modo preview.
function bloquearSiPreview(req, res) {
  if (enPreview(req)) {
    res.status(403).json({ error: 'Vista previa: solo lectura' });
    return true;
  }
  return false;
}

/* ===================================================================
 * CATEGORIAS / CANAL / ESTADO (identicos al prototipo)
 * =================================================================== */

const CATEGORIAS_EVENTO = {
  reclamo: { label: 'Reclamo', icon: '🔧', bg: '#FDECEC' },
  reserva: { label: 'Reserva', icon: '📅', bg: '#EAF3EC' },
  seguridad: { label: 'Seguridad', icon: '📹', bg: '#EDEEFB' },
  mensaje: { label: 'Aviso', icon: '💬', bg: '#EAF1FB' },
  mantenimiento: { label: 'Mantenimiento', icon: '🧰', bg: '#FBF3DE' },
};

function clasificarEvento(e) {
  const txt = `${e.mensaje || ''} ${e.notas || ''}`.toLowerCase();
  if (/reserva|sum\b|quincho|salon|cumplea/.test(txt)) return 'reserva';
  if (/camara|cámara|seguridad|cerradura|robo|alarma|magnetica|magnética/.test(txt)) return 'seguridad';
  if (/service|mantenimiento|bomba de agua|limpieza de tanque|fumigaci/.test(txt)) return 'mantenimiento';
  if (/aviso|informo|informó|corte programado|factura|recepcion|recepción/.test(txt)) return 'mensaje';
  return 'reclamo';
}

function canalDe(e) {
  if (e.tipo === 'llamada') return { icon: '📞', nombre: 'Llamado' };
  return { icon: '🟢', nombre: 'WhatsApp' };
}

const URG_STYLE = {
  alta: { label: 'Urgente', bg: '#FDECEC', fg: '#C0392B' },
  media: { label: 'Media', bg: '#FBF1DD', fg: '#8A6410' },
  baja: { label: 'Baja', bg: '#EAF1FB', fg: '#2C5C9E' },
};
const EST_STYLE = {
  nuevo: { label: 'Nuevo', bg: '#EAF1FB', fg: '#2C5C9E' },
  curso: { label: 'En curso', bg: '#FBF1DD', fg: '#8A6410' },
  resuelto: { label: 'Resuelto', bg: '#E7F4EC', fg: '#1B7A43' },
};

function estadoNormalizado(estado) {
  const s = String(estado || '').toLowerCase();
  if (/resuel|cerrad|finaliz|completad/.test(s)) return 'resuelto';
  if (/proceso|curso|iniciado|coordinando|gestion|gestión|pendiente/.test(s)) return 'curso';
  return 'nuevo';
}

const PLAN_STYLE = (p) => (p === 'Plus'
  ? { bg: '#EDE9FB', fg: '#6D28D9' }
  : { bg: '#EEF2F8', fg: '#5A6B85' });

// Etiquetas de campos de la ficha (para solicitudes de cambio).
const FICHA_LABELS = {
  nombre: 'Consorcio', direccion: 'Dirección', telefonos: 'Tel. administración',
  encargado: 'Encargado', tel_encargado: 'Tel. encargado',
  horario_sum: 'Horario SUM', cocheras: 'Cocheras',
};

/* ===================================================================
 * HTML HELPERS
 * =================================================================== */

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// esc() + neutraliza saltos de linea (para onclick="fn('...')").
function escJs(str) {
  return esc(str).replace(/\r\n|\r|\n/g, ' ');
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ===================================================================
 * CSS BASE
 * -------------------------------------------------------------------
 * El prototipo usa estilos inline en todo; aca solo va lo que inline
 * no puede expresar: reset, tipografia, keyframes y estados :hover
 * (los style-hover del prototipo, con sus valores exactos).
 * =================================================================== */

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;padding:0}
body{background:#EEF1F6;color:#16233B;font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
button{font-family:inherit}
input,textarea,select{font-family:inherit}
a{color:inherit;text-decoration:none}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#CBD5E6;border-radius:20px;border:2px solid transparent;background-clip:content-box}
@keyframes mFade{from{opacity:0}to{opacity:1}}
@keyframes mSlideR{from{transform:translateX(24px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes mPop{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes mUp{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}
/* style-hover del prototipo */
.hv-row:hover{background:#F8FAFD}
.hv-soft:hover{background:#F1F5FB}
.hv-softb:hover{background:#F1F5FB;border-color:#B9CBE6}
.hv-selbtn:hover{border-color:#C9D5E8;background:#F1F5FB}
.hv-card:hover{border-color:#C9D5E8;box-shadow:0 6px 18px -10px rgba(16,35,59,.25)}
.hv-white:hover{background:#fff}
.hv-blue:hover{background:#EAF1FB}
.hv-bluedash:hover{background:#EAF1FB;border-color:#2E6FC0}
.hv-primary:hover{background:linear-gradient(180deg,#3579cd,#2464bd)!important}
.hv-green:hover{background:#128a3f!important}
.hv-red:hover{background:#FDECEC}
.hv-navy:hover{background:#1E5FB4!important}
.hv-op:hover{opacity:.92}
/* toast */
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#16233B;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 16px 40px -12px rgba(16,35,59,.28);opacity:0;transition:.25s;z-index:90;font-weight:600;pointer-events:none}
.toast.show{opacity:1;bottom:28px}
.toast.ok{background:#1B7A43}
.toast.err{background:#C0392B}
/* menus del topbar (server-rendered, toggle por JS) */
.menu-pop{display:none}
.menu-pop.open{display:block}
/* drawer */
.drawer-overlay{display:none;position:fixed;inset:0;background:rgba(16,35,59,.42);z-index:60}
.drawer-overlay.open{display:flex;justify-content:flex-end;animation:mFade .2s ease both}
.drawer-panel{display:none;position:fixed;top:0;right:0;bottom:0;width:440px;max-width:92vw;background:#F6F8FB;overflow-y:auto;z-index:61}
.drawer-panel.open{display:block;animation:mSlideR .28s cubic-bezier(.2,.8,.2,1) both}
/* modales */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(16,35,59,.42);z-index:70;align-items:center;justify-content:center;padding:20px}
.modal-overlay.open{display:flex;animation:mFade .2s ease both}
.modal-box{width:440px;max-width:100%;background:#fff;border-radius:18px;overflow:hidden;animation:mPop .22s ease both;box-shadow:0 30px 70px -20px rgba(16,35,59,.5)}
/* inputs (style-focus del prototipo) */
.inp{width:100%;height:46px;border:1.5px solid #DDE3EE;border-radius:11px;padding:0 14px;font-size:15px;color:#16233B;outline:none;background:#F8FAFD}
.inp:focus{border-color:#2E6FC0;background:#fff;box-shadow:0 0 0 4px rgba(46,111,192,.1)}
textarea.inp{height:auto;min-height:70px;padding:11px 14px;resize:vertical;line-height:1.5}
@media(max-width:980px){.resgrid{grid-template-columns:1fr!important}.fichagrid{grid-template-columns:1fr!important}}
@media(max-width:900px){.sidebar-nav{display:none!important}.username{display:none!important}}
`;

/* ===================================================================
 * CLIENT-SIDE JS
 * =================================================================== */

const CLIENT_JS = `
function toast(msg,kind){
  var t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;
  t.className='toast show '+(kind||'ok');
  setTimeout(function(){t.className='toast';},2600);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
// --- menus del topbar ---
function toggleMenu(id){
  var m=document.getElementById(id);
  if(!m)return;
  document.querySelectorAll('.menu-pop.open').forEach(function(x){if(x!==m)x.classList.remove('open');});
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
// --- modales genericos ---
function abrirModal(id){var m=document.getElementById(id);if(m)m.classList.add('open');}
function cerrarModal(id){var m=document.getElementById(id);if(m)m.classList.remove('open');}
function stopEv(e){e.stopPropagation();}

// --- drawer de evento ---
var _drawerActual=null;
function abrirDrawerEvento(idx){
  var datos=(window.__EVENTOS__||[])[idx];
  if(!datos)return;
  _drawerActual=datos;
  var panel=document.getElementById('drawer-panel');
  var overlay=document.getElementById('drawer-overlay');
  if(!panel||!overlay)return;
  var esDueno=!!window.__ES_DUENO__;
  var titulo=datos.titulo||'Evento';
  var fbHtml='';
  if(esDueno){
    fbHtml='<div style="margin-top:22px"><div style="font-size:13px;font-weight:800;color:#334259;margin-bottom:8px">📝 Tu nota para Marcos</div>'+
      '<div style="display:flex;gap:8px;align-items:flex-end">'+
      '<textarea data-fb-drawer class="inp" style="flex:1;min-height:52px" placeholder="Dejale una nota a Marcos para que aprenda de este caso...">'+escapeHtml(datos.feedback||'')+'</textarea>'+
      '<button onclick="guardarFeedbackDrawer(this,'+datos.row+')" style="height:44px;padding:0 16px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:13.5px;cursor:pointer" class="hv-primary">Guardar</button>'+
      '</div></div>';
  }
  panel.innerHTML=
    '<div style="background:'+escapeHtml(datos.catBg)+';padding:22px 24px 20px;position:relative">'+
      '<button onclick="cerrarDrawerEvento()" style="position:absolute;top:16px;right:16px;width:34px;height:34px;border:none;border-radius:9px;background:rgba(255,255,255,.7);cursor:pointer;font-size:17px" class="hv-white">✕</button>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
        '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:'+escapeHtml(datos.urgBg)+';color:'+escapeHtml(datos.urgFg)+'">'+escapeHtml(datos.urgLabel)+'</span>'+
        '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:'+escapeHtml(datos.estBg)+';color:'+escapeHtml(datos.estFg)+'">'+escapeHtml(datos.estLabel)+'</span>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:13px">'+
        '<span style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.75);display:flex;align-items:center;justify-content:center;font-size:26px">'+escapeHtml(datos.catIcon)+'</span>'+
        '<div><div style="font-size:12px;font-weight:700;color:#5A6B85;text-transform:uppercase;letter-spacing:.04em">'+escapeHtml(datos.catLabel)+'</div>'+
        '<div style="font-size:20px;font-weight:800;letter-spacing:-.02em;color:#16233B;line-height:1.2">'+escapeHtml(titulo)+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div style="padding:22px 24px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'+
        '<div style="background:#fff;border:1px solid #E7ECF3;border-radius:12px;padding:12px 14px"><div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Canal</div><div style="font-size:14.5px;font-weight:700;margin-top:2px">'+escapeHtml(datos.canalIcon)+' '+escapeHtml(datos.canal)+'</div></div>'+
        '<div style="background:#fff;border:1px solid #E7ECF3;border-radius:12px;padding:12px 14px"><div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Vecino</div><div style="font-size:14.5px;font-weight:700;margin-top:2px">'+escapeHtml(datos.vecino||'—')+'</div></div>'+
        '<div style="background:#fff;border:1px solid #E7ECF3;border-radius:12px;padding:12px 14px"><div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Cuándo</div><div style="font-size:14.5px;font-weight:700;margin-top:2px">'+escapeHtml(datos.when||'')+'</div></div>'+
        '<div style="background:#fff;border:1px solid #E7ECF3;border-radius:12px;padding:12px 14px"><div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Edificio</div><div style="font-size:14.5px;font-weight:700;margin-top:2px">'+escapeHtml(datos.edificio||'')+'</div></div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:11px;background:#fff;border:1px solid #E7ECF3;border-radius:12px;padding:11px 14px;margin-bottom:18px">'+
        '<span style="width:36px;height:36px;border-radius:50%;background:linear-gradient(140deg,#17408B,#2E6FC0);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0">M</span>'+
        '<div style="flex:1"><div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.03em">Atendió</div><div style="font-size:14.5px;font-weight:700;color:#16233B">Marcos</div></div>'+
      '</div>'+
      '<div style="font-size:13px;font-weight:800;color:#334259;margin-bottom:8px">El pedido</div>'+
      '<div style="background:#fff;border:1px solid #E7ECF3;border-radius:12px;padding:14px 16px;font-size:14.5px;color:#334259;line-height:1.55;margin-bottom:20px;white-space:pre-wrap">'+escapeHtml(datos.mensaje||'—')+'</div>'+
      '<div style="font-size:13px;font-weight:800;color:#334259;margin-bottom:8px">📝 Qué hizo Marcos</div>'+
      '<div style="background:linear-gradient(120deg,#EAF1FB,#F3F7FD);border:1px solid #D8E5F6;border-radius:12px;padding:14px 16px;font-size:14.5px;color:#1E3A6B;line-height:1.6;white-space:pre-wrap">'+escapeHtml(datos.notas||'—')+'</div>'+
      '<div style="margin-top:24px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
          '<div style="font-size:13px;font-weight:800;color:#334259">📄 Conversación registrada</div>'+
          '<button onclick="descargarResumenEvento()" style="height:31px;padding:0 12px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12px;cursor:pointer" class="hv-soft">⬇ Descargar</button>'+
        '</div>'+
        '<div style="display:flex;align-items:flex-start;gap:9px;background:#F1F5FB;border-radius:11px;padding:11px 14px;font-size:12.5px;color:#5A6B85;line-height:1.5">'+
          '<span style="font-size:15px">🔒</span>'+
          '<span>Registro textual completo de lo conversado. Queda como <strong style="color:#334259">comprobante</strong> ante cualquier reclamo: nadie puede negar lo que pidió o acordó.</span>'+
        '</div>'+
      '</div>'+
      fbHtml+
      '<div style="display:flex;gap:10px;margin-top:22px">'+
        '<button onclick="cerrarDrawerEvento()" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cerrar</button>'+
        (esDueno?'':'<button onclick="location.href=\\'/admin/sugerencias\\'" style="flex:1;height:44px;border:none;border-radius:11px;background:#17408B;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-navy">Comentar a mi admin</button>')+
      '</div>'+
    '</div>';
  overlay.classList.add('open');
  panel.classList.add('open');
}
function cerrarDrawerEvento(){
  var p=document.getElementById('drawer-panel');
  var o=document.getElementById('drawer-overlay');
  if(p)p.classList.remove('open');
  if(o)o.classList.remove('open');
}
function descargarResumenEvento(){
  var d=_drawerActual;
  if(!d)return;
  var lineas=[
    'MARCOS IA -- Registro de evento',
    '========================================',
    'Edificio: '+(d.edificio||''),
    'Vecino: '+(d.vecino||''),
    'Telefono: '+(d.telefono||''),
    'Canal: '+(d.canal||''),
    'Fecha: '+(d.when||''),
    'Urgencia: '+(d.urgLabel||''),
    'Estado: '+(d.estLabel||''),
    '',
    'EL PEDIDO',
    '---------',
    (d.mensaje||'(sin datos)'),
    '',
    'QUE HIZO MARCOS',
    '---------------',
    (d.notas||'(sin datos)'),
    '',
    'Descargado el '+new Date().toLocaleString('es-AR'),
  ].join('\\n');
  var blob=new Blob([lineas],{type:'text/plain;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  a.download='marcos-evento-'+(d.edificio||'').replace(/[^a-z0-9]+/gi,'-')+'.txt';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},2000);
}
async function guardarFeedbackDrawer(btn,row){
  var ta=btn.parentElement.querySelector('textarea[data-fb-drawer]');
  var nota=ta?ta.value.trim():'';
  btn.disabled=true;var old=btn.textContent;btn.textContent='...';
  try{
    var r=await fetch('/admin/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row,nota:nota})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Nota guardada. Marcos va a aprender de esto.','ok');
    if(_drawerActual)_drawerActual.feedback=nota;
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- chips de filtro de eventos (cliente) ---
function filtrarEventos(modo,btn){
  document.querySelectorAll('[data-chip]').forEach(function(c){
    var act=c===btn;
    c.style.background=act?'#17408B':'#fff';
    c.style.color=act?'#fff':'#475569';
    c.style.borderColor=act?'#17408B':'#E1E7F1';
  });
  document.querySelectorAll('[data-evrow]').forEach(function(r){
    var show=true;
    if(modo==='nuevos')show=r.getAttribute('data-nuevo')==='1';
    else if(modo==='urgentes')show=r.getAttribute('data-urg')==='alta';
    else if(modo==='abiertos')show=r.getAttribute('data-est')!=='resuelto';
    r.style.display=show?'':'none';
  });
}

// --- solicitar cambio (cliente) ---
var _reqCampo=null,_reqActual=null,_reqEdificio=null;
function abrirSolicitud(campo,label,actual,edificio){
  _reqCampo=campo;_reqActual=actual;_reqEdificio=edificio;
  var l=document.getElementById('req-label');if(l)l.textContent=label;
  var c=document.getElementById('req-current');if(c)c.textContent=actual||'—';
  var n=document.getElementById('req-nuevo');if(n)n.value='';
  var m=document.getElementById('req-motivo');if(m)m.value='';
  abrirModal('modal-solicitud');
}
async function enviarSolicitud(btn){
  var nuevo=(document.getElementById('req-nuevo')||{}).value||'';
  var motivo=(document.getElementById('req-motivo')||{}).value||'';
  if(!nuevo.trim()){toast('Escribí el valor nuevo','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Enviando...';
  try{
    var r=await fetch('/admin/api/solicitar-cambio',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({campo:_reqCampo,valorActual:_reqActual,valorNuevo:nuevo.trim(),motivo:motivo.trim(),edificio:_reqEdificio})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-solicitud');
    toast('Solicitud enviada. Tu administrador la revisa.','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- mi edificio: datos editables directo ---
function setEncEstado(estado){
  var h=document.getElementById('enc-estado-val');if(h)h.value=estado;
  var colores={activo:['#1B7A43','#E7F4EC'],licencia:['#8A6410','#FBF3DE'],vacaciones:['#2C55A8','#EAF1FB']};
  document.querySelectorAll('[data-enc-estado]').forEach(function(b){
    var k=b.getAttribute('data-enc-estado');
    var act=k===estado;
    var c=colores[k]||['#64748B','#fff'];
    b.style.borderColor=act?c[0]:'#DDE3EE';
    b.style.background=act?c[1]:'#fff';
    b.style.color=act?c[0]:'#64748B';
  });
  var w=document.getElementById('enc-horario-wrap');
  if(w)w.style.display=estado==='activo'?'block':'none';
}
function valEl(id){var e=document.getElementById(id);return e?e.value:'';}
async function guardarMiEdificio(btn){
  var data={};
  document.querySelectorAll('[data-me]').forEach(function(el){
    data[el.getAttribute('data-me')]=el.value;
  });
  // Horario del encargado: armar JSON desde los selectores de hora.
  data.encargado_horario=JSON.stringify({
    lv1:[valEl('enc-lv1a'),valEl('enc-lv1b')],
    lv2:[valEl('enc-lv2a'),valEl('enc-lv2b')],
    sab:[valEl('enc-saba'),valEl('enc-sabb')]
  });
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/mi-edificio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Datos del edificio guardados','ok');
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
// Agregar proveedor a la lista maestra del cliente (una sola vez).
async function agregarProveedor(btn){
  var rubro=(document.getElementById('prov-rubro')||{}).value||'';
  var nombre=(document.getElementById('prov-nombre')||{}).value||'';
  var tel=(document.getElementById('prov-tel')||{}).value||'';
  var notas=(document.getElementById('prov-notas')||{}).value||'';
  if(!nombre.trim()&&!tel.trim()){toast('Cargá al menos nombre o teléfono','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Agregando...';
  try{
    var r=await fetch('/admin/api/proveedor',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rubro:rubro,nombre:nombre.trim(),telefono:tel.trim(),notas:notas.trim()})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Proveedor agregado a tu lista','ok');
    setTimeout(function(){location.reload();},800);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
async function quitarProveedor(btn,row){
  btn.disabled=true;
  try{
    var r=await fetch('/admin/api/proveedor-quitar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Proveedor quitado de tu lista','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;}
}
// Asignar un proveedor de la lista a ESTE edificio con prioridad.
async function asignarProveedor(btn){
  var prov=(document.getElementById('asig-prov')||{}).value||'';
  var prio=(document.getElementById('asig-prio')||{}).value||'primera';
  if(!prov){toast('Elegí un proveedor','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Asignando...';
  try{
    var r=await fetch('/admin/api/proveedor-asignar',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({proveedor:prov,prioridad:prio})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Proveedor asignado a este edificio','ok');
    setTimeout(function(){location.reload();},800);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
async function desasignarProveedor(btn,row){
  btn.disabled=true;
  try{
    var r=await fetch('/admin/api/proveedor-desasignar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Proveedor quitado del edificio','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;}
}

// --- solicitudes (dueño) ---
async function aprobarSolicitud(btn,row){
  btn.disabled=true;var old=btn.textContent;btn.textContent='Aplicando...';
  try{
    var r=await fetch('/admin/api/aprobar-solicitud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Cambio aplicado y registrado.','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;btn.textContent=old;}
}
async function rechazarSolicitud(btn,row){
  btn.disabled=true;var old=btn.textContent;btn.textContent='...';
  try{
    var r=await fetch('/admin/api/rechazar-solicitud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Solicitud rechazada.','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;btn.textContent=old;}
}
async function responderSugerencia(btn,row){
  var inp=btn.parentElement.querySelector('input');
  var resp=inp?inp.value.trim():'';
  if(!resp){toast('Escribí la respuesta','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='...';
  try{
    var r=await fetch('/admin/api/responder-sugerencia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row,respuesta:resp})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Respuesta enviada.','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;btn.textContent=old;}
}

// --- sugerencias (cliente) ---
async function enviarSugerencia(btn){
  var ta=document.getElementById('sug-input');
  var texto=(ta?ta.value:'').trim();
  if(!texto){toast('Escribí tu sugerencia antes de enviar','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Enviando...';
  try{
    var r=await fetch('/admin/api/sugerencia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:texto})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Sugerencia enviada. Te respondemos por acá.','ok');
    ta.value='';
    setTimeout(function(){location.reload();},1000);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- alta cliente / edificio (dueño) ---
async function crearCliente(btn){
  var nombre=(document.getElementById('cli-nombre')||{}).value||'';
  var usuario=(document.getElementById('cli-usuario')||{}).value||'';
  var pass=(document.getElementById('cli-pass')||{}).value||'';
  var email=(document.getElementById('cli-email')||{}).value||'';
  if(!nombre.trim()||!usuario.trim()||!pass.trim()){toast('Completá nombre, usuario y contraseña','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Creando...';
  try{
    var r=await fetch('/admin/api/clientes',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nombre:nombre.trim(),usuario:usuario.trim(),pass:pass.trim(),email:email.trim()})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Cliente creado','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
function elegirPlanNuevo(btn,plan){
  document.querySelectorAll('[data-plan-btn]').forEach(function(b){
    var act=b===btn;
    b.style.borderColor=act?'#2E6FC0':'#DDE3EE';
    b.style.background=act?'#EAF1FB':'#fff';
    b.style.color=act?'#17408B':'#64748B';
  });
  var h=document.getElementById('ed-plan');if(h)h.value=plan;
}
async function crearEdificio(btn,clienteUsuario){
  var nombre=(document.getElementById('ed-nombre')||{}).value||'';
  var direccion=(document.getElementById('ed-direccion')||{}).value||'';
  var unidades=(document.getElementById('ed-unidades')||{}).value||'';
  var zona=(document.getElementById('ed-zona')||{}).value||'';
  var encargado=(document.getElementById('ed-encargado')||{}).value||'';
  var plan=(document.getElementById('ed-plan')||{}).value||'Base';
  if(!nombre.trim()){toast('Falta el nombre del consorcio','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Creando...';
  try{
    var r=await fetch('/admin/api/edificio-nuevo',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nombre:nombre.trim(),direccion:direccion.trim(),unidades:unidades.trim(),zona:zona.trim(),encargado:encargado.trim(),plan:plan,clienteUsuario:clienteUsuario||undefined})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Edificio agregado','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- editar ficha directo (dueño) ---
var _editRow=null;
function abrirEditar(row,nombre,encargado,plan){
  _editRow=row;
  var t=document.getElementById('edit-bname');if(t)t.textContent=nombre;
  var n=document.getElementById('edit-nombre');if(n)n.value=nombre;
  var e=document.getElementById('edit-encargado');if(e)e.value=encargado||'';
  document.querySelectorAll('[data-editplan-btn]').forEach(function(b){
    var act=b.getAttribute('data-editplan-btn')===plan;
    b.style.borderColor=act?'#2E6FC0':'#DDE3EE';
    b.style.background=act?'#EAF1FB':'#fff';
    b.style.color=act?'#17408B':'#64748B';
  });
  var h=document.getElementById('edit-plan');if(h)h.value=plan||'Base';
  abrirModal('modal-editar');
}
function elegirPlanEditar(btn,plan){
  document.querySelectorAll('[data-editplan-btn]').forEach(function(b){
    var act=b===btn;
    b.style.borderColor=act?'#2E6FC0':'#DDE3EE';
    b.style.background=act?'#EAF1FB':'#fff';
    b.style.color=act?'#17408B':'#64748B';
  });
  var h=document.getElementById('edit-plan');if(h)h.value=plan;
}
async function guardarEditar(btn){
  var nombre=(document.getElementById('edit-nombre')||{}).value||'';
  var encargado=(document.getElementById('edit-encargado')||{}).value||'';
  var plan=(document.getElementById('edit-plan')||{}).value||'Base';
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/edificio',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:_editRow,nombre:nombre.trim(),encargado:encargado.trim(),plan:plan})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Ficha actualizada','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- expensas (cliente) ---
var _expFormato='pdf';
function elegirFormatoExp(btn,f){
  _expFormato=f;
  document.querySelectorAll('[data-exp-btn]').forEach(function(b){
    var act=b===btn;
    b.style.borderColor=act?'#17408B':'#DDE3EE';
    b.style.background=act?'#17408B':'#fff';
    b.style.color=act?'#fff':'#64748B';
  });
  var link=document.getElementById('exp-link-wrap');
  var file=document.getElementById('exp-file-wrap');
  if(link)link.style.display=f==='link'?'block':'none';
  if(file)file.style.display=f==='link'?'none':'flex';
}
function pickExpFile(){
  var i=document.getElementById('exp-file-input');
  if(i)i.click();
}
function expFileElegido(inp){
  var n=inp.files&&inp.files[0]?inp.files[0].name:'';
  var t=document.getElementById('exp-file-nombre');
  var s=document.getElementById('exp-file-sub');
  if(t&&n){t.textContent=n;t.style.color='#16233B';}
  if(s&&n){s.textContent='Archivo listo · tocá Publicar';s.style.color='#1B7A43';}
}
async function publicarExpensa(btn){
  var mes=(document.getElementById('exp-mes')||{}).value||'';
  var anio=(document.getElementById('exp-anio')||{}).value||'';
  var url=(document.getElementById('exp-url')||{}).value||'';
  var fileInp=document.getElementById('exp-file-input');
  var nombre=fileInp&&fileInp.files&&fileInp.files[0]?fileInp.files[0].name:'';
  if(!mes.trim()||!anio.trim()){toast('Completá mes y año','err');return;}
  if(_expFormato==='link'&&!url.trim()){toast('Pegá la dirección web','err');return;}
  if(_expFormato!=='link'&&!nombre){toast('Elegí el archivo','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Publicando...';
  try{
    var r=await fetch('/admin/api/expensa',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mes:mes.trim(),anio:anio.trim(),formato:_expFormato,url:url.trim(),nombre:nombre})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Expensa publicada. Marcos ya puede compartirla.','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
function copiarExpensa(texto){
  navigator.clipboard.writeText(texto).then(function(){toast('Enlace copiado','ok');},function(){toast('No se pudo copiar','err');});
}
async function quitarExpensa(btn,row){
  btn.disabled=true;
  try{
    var r=await fetch('/admin/api/expensa-quitar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Expensa quitada','ok');
    setTimeout(function(){location.reload();},800);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;}
}
`;

/* ===================================================================
 * CARGA DE DATOS COMPARTIDA
 * =================================================================== */

async function cargarDatos(req) {
  const [ev, ed, cli, sol, sug] = await Promise.all([
    readTab(TAB_EVENTOS),
    readTab(TAB_EDIFICIOS),
    readTab(TAB_CLIENTES),
    readTab(TAB_SOLICITUDES),
    readTab(TAB_SUGERENCIAS),
  ]);
  const eventos = ev.rows.map(mapEvento);
  const edificios = ed.rows.map(mapEdificio);
  const clientes = cli.rows.map(mapCliente);
  const solicitudes = sol.rows;
  const sugerencias = sug.rows;

  // Edificio "actual" para la vista cliente.
  const permitidos = edificiosPermitidos(req);
  const propios = vistaCliente(req)
    ? edificios.filter((e) => edificiosDeLaCuenta(req).includes(e.nombre))
    : edificios;
  const curBuilding = vistaCliente(req)
    ? (propios.find((e) => permitidos && permitidos.includes(e.nombre)) || propios[0] || null)
    : null;

  // Nombre visible del cliente (para saludo/avatar).
  let clienteActual = null;
  if (vistaCliente(req)) {
    const usuario = enPreview(req) ? req.session.previewOwner : req.session.user;
    clienteActual = clientes.find((c) => c.usuario === usuario) || null;
  }

  return { eventos, edificios, clientes, solicitudes, sugerencias, propios, curBuilding, clienteActual };
}

/* ===================================================================
 * VISTA DE EVENTO (fila del feed + datos del drawer)
 * =================================================================== */

function vistaEvento(e) {
  const cat = clasificarEvento(e);
  const catInfo = CATEGORIAS_EVENTO[cat];
  const canal = canalDe(e);
  const urg = URG_STYLE[e.urgencia] || URG_STYLE.baja;
  const estKey = estadoNormalizado(e.estado);
  const est = EST_STYLE[estKey];
  const nuevo = esHoy(parseFecha(e.fecha));
  return {
    row: e._row,
    titulo: truncate(e.mensaje || e.notas || 'Evento', 80),
    detalle: truncate(e.notas || '', 150),
    catKey: cat, catLabel: catInfo.label, catIcon: catInfo.icon, catBg: catInfo.bg,
    urgKey: e.urgencia, urgLabel: urg.label, urgBg: urg.bg, urgFg: urg.fg,
    estKey, estLabel: est.label, estBg: est.bg, estFg: est.fg,
    canalIcon: canal.icon, canal: canal.nombre,
    vecino: e.vecino, telefono: e.telefono, edificio: e.edificio,
    when: fechaCorta(parseFecha(e.fecha)) || e.fecha,
    mensaje: e.mensaje, notas: e.notas, feedback: e.feedback, nuevo,
  };
}

// Fila del feed de eventos, markup identico al prototipo.
// chipEdificio: true para la vista del dueño (pill 🏢 nombre).
function filaEvento(v, idx, chipEdificio) {
  return `
    <button onclick="abrirDrawerEvento(${idx})" data-evrow data-nuevo="${v.nuevo ? '1' : '0'}" data-urg="${esc(v.urgKey)}" data-est="${esc(v.estKey)}"
      style="width:100%;display:flex;align-items:flex-start;gap:14px;padding:16px 20px;border:none;border-bottom:1px solid #F1F4F9;background:none;cursor:pointer;text-align:left;font-family:inherit;position:relative" class="hv-row">
      ${v.nuevo ? '<span style="position:absolute;left:0;top:0;bottom:0;width:3px;background:#2E6FC0"></span>' : ''}
      <span style="width:44px;height:44px;border-radius:12px;background:${v.catBg};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${v.catIcon}</span>
      <span style="flex:1;min-width:0">
        <span style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
          <span style="font-size:15px;font-weight:700;color:#16233B">${esc(v.titulo)}</span>
          <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:${v.urgBg};color:${v.urgFg}">${v.urgLabel}</span>
          ${chipEdificio ? `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#EEF2F8;color:#5A6B85">🏢 ${esc(v.edificio)}</span>` : ''}
          ${!chipEdificio && v.nuevo ? '<span style="font-size:11px;font-weight:800;color:#2E6FC0">● NUEVO</span>' : ''}
        </span>
        ${v.detalle && v.detalle !== v.titulo ? `<span style="display:block;font-size:13.5px;color:#5A6B85;line-height:1.45;margin-bottom:6px">${esc(v.detalle)}</span>` : ''}
        <span style="display:flex;align-items:center;gap:10px;font-size:12px;color:#9AA7BD;flex-wrap:wrap">
          <span>${v.canalIcon} ${esc(v.canal)}</span><span>·</span><span>${esc(v.vecino)}</span><span>·</span><span>${esc(v.when)}</span>
        </span>
      </span>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:${v.estBg};color:${v.estFg};flex-shrink:0">${v.estLabel}</span>
    </button>`;
}

/* ===================================================================
 * SHELL (topbar + sidebar + main), calcado del prototipo
 * =================================================================== */

function shell(req, d, activeKey, contenido) {
  const dueno = esDueno(req);
  const preview = enPreview(req);
  const permitidos = edificiosPermitidos(req);

  // --- datos del selector de edificio ---
  let selectorHtml = '';
  if (dueno) {
    const filtro = req.session.filtroEdificioDueno || '';
    const label = filtro || 'Todos los edificios';
    const sub = filtro
      ? ((d.clientes.find((c) => c.edificios.includes(filtro)) || {}).nombre || '')
      : `${d.edificios.length} consorcios activos`;
    const filas = [
      { label: 'Todos los edificios', sub: `${d.edificios.length} consorcios`, val: '', activo: !filtro },
      ...d.edificios.map((e) => ({
        label: e.nombre,
        sub: `${(d.clientes.find((c) => c.edificios.includes(e.nombre)) || {}).nombre || 'Sin asignar'}${e.unidades ? ' · ' + e.unidades + ' un.' : ''}`,
        val: e.nombre, activo: filtro === e.nombre,
      })),
    ];
    selectorHtml = selectorEdificioHtml(label, sub, 'Filtrar por edificio', filas, '/admin/set-filtro');
  } else {
    const cur = d.curBuilding;
    const label = cur ? cur.nombre : 'Sin edificio';
    const sub = cur ? (cur.zona || cur.direccion || '') : '';
    const filas = d.propios.map((e) => ({
      label: e.nombre,
      sub: `${e.direccion || e.nombre}${e.unidades ? ' · ' + e.unidades + ' un.' : ''}`,
      val: e.nombre,
      activo: !!(cur && cur.nombre === e.nombre),
    }));
    selectorHtml = d.propios.length > 1
      ? selectorEdificioHtml(label, sub, 'Tus edificios', filas, '/admin/set-filtro')
      : `<div style="display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border:1px solid #E1E7F1;border-radius:11px;background:#F7F9FC">
          <span style="font-size:15px">🏢</span>
          <span style="text-align:left;line-height:1.15">
            <span style="display:block;font-size:14px;font-weight:700;color:#16233B">${esc(label)}</span>
            <span style="display:block;font-size:11px;color:#8595AD">${esc(sub)}</span>
          </span>
        </div>`;
  }

  // --- notificaciones (solo dueño) ---
  let notifHtml = '';
  if (dueno) {
    const notifs = [];
    d.solicitudes.filter((s) => !s.estado || s.estado === 'pendiente').forEach((s) => {
      notifs.push({
        icon: '📥', iconBg: '#FBF3DE', title: 'Pedido de cambio',
        desc: `${s.edificio || ''} · ${FICHA_LABELS[s.campo] || s.campo || ''}`,
        when: s.fecha || '', href: '/admin/solicitudes',
      });
    });
    d.sugerencias.filter((s) => (!s.estado || s.estado === 'pendiente') && !s.respuesta).forEach((s) => {
      notifs.push({ icon: '💡', iconBg: '#EDEEFB', title: 'Sugerencia sin responder', desc: s.usuario || '', when: s.fecha || '', href: '/admin/solicitudes' });
    });
    d.eventos.filter((e) => e.urgencia === 'alta' && estadoNormalizado(e.estado) !== 'resuelto').forEach((e) => {
      notifs.push({ icon: '🚨', iconBg: '#FDECEC', title: 'Urgencia abierta', desc: `${e.edificio} · ${truncate(e.mensaje, 40)}`, when: fechaCorta(parseFecha(e.fecha)) || e.fecha, href: '/admin/eventos' });
    });
    const nCount = notifs.length;
    notifHtml = `
      <div style="position:relative">
        <button onclick="toggleMenu('menu-notif')" style="position:relative;width:42px;height:42px;border:1px solid #E1E7F1;border-radius:11px;background:#F7F9FC;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center" class="hv-selbtn">🔔
          ${nCount ? `<span style="position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#E5484D;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff">${nCount}</span>` : ''}
        </button>
        <div id="menu-notif" class="menu-pop" style="position:absolute;top:50px;right:0;width:340px;background:#fff;border:1px solid #E4E9F1;border-radius:14px;box-shadow:0 16px 40px -12px rgba(16,35,59,.28);z-index:50;animation:mPop .16s ease both;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid #EEF1F6;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:14.5px;font-weight:800">Notificaciones</span>
            <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#FDECEC;color:#C0392B">${nCount} nuevas</span>
          </div>
          <div style="max-height:400px;overflow-y:auto">
            ${notifs.length ? notifs.map((n) => `
              <a href="${esc(n.href)}" style="width:100%;display:flex;align-items:flex-start;gap:11px;padding:13px 16px;border-bottom:1px solid #F1F4F9;text-align:left" class="hv-row">
                <span style="width:36px;height:36px;border-radius:10px;background:${n.iconBg};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${n.icon}</span>
                <span style="flex:1;min-width:0">
                  <span style="display:block;font-size:13.5px;font-weight:700;color:#16233B">${esc(n.title)}</span>
                  <span style="display:block;font-size:12.5px;color:#64748B;line-height:1.4">${esc(n.desc)}</span>
                  <span style="display:block;font-size:11px;color:#9AA7BD;margin-top:2px">${esc(n.when)}</span>
                </span>
              </a>`).join('') : '<div style="padding:22px;font-size:13px;color:#8595AD;text-align:center">Sin novedades</div>'}
          </div>
        </div>
      </div>`;
  }

  // --- usuario ---
  const userName = dueno || !d.clienteActual ? (esDuenoReal(req) && !preview ? 'Daniel' : (d.clienteActual ? d.clienteActual.nombre : req.session.user)) : d.clienteActual.nombre;
  const displayName = dueno ? (req.session.user === 'admin' ? 'Daniel' : req.session.user) : (d.clienteActual ? d.clienteActual.nombre : req.session.user);
  const userSub = dueno ? 'Admin de sistema' : (enPreview(req) ? req.session.previewOwner : req.session.user);
  const userInitial = String(displayName || 'M').split(' ').filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  const userGrad = dueno ? 'linear-gradient(140deg,#17408B,#2E6FC0)' : 'linear-gradient(140deg,#B4841C,#D99B1F)';
  const userMeta = dueno ? `Dueño del sistema · ${d.edificios.length} edificios` : `Administrador · ${d.propios.length} edificio${d.propios.length === 1 ? '' : 's'}`;

  // --- nav ---
  const nuevosCliente = filtrarPorEdificio(d.eventos, req).filter((e) => esHoy(parseFecha(e.fecha))).length;
  const solPend = d.solicitudes.filter((s) => !s.estado || s.estado === 'pendiente').length;
  const navCliente = [
    { key: 'resumen', icon: '📊', label: 'Resumen', href: '/admin' },
    { key: 'edificio', icon: '🏢', label: 'Mi Edificio', href: '/admin/mi-edificio' },
    { key: 'eventos', icon: '🔔', label: 'Eventos', href: '/admin/eventos', badge: nuevosCliente },
    { key: 'facturas', icon: '🧾', label: 'Facturas/Fotos', href: '/admin/archivos' },
    { key: 'expensas', icon: '📑', label: 'Expensas', href: '/admin/expensas' },
    { key: 'sugerencias', icon: '💡', label: 'Sugerencias', href: '/admin/sugerencias' },
  ];
  const nuevosDueno = d.eventos.filter((e) => esHoy(parseFecha(e.fecha))).length;
  const navDueno = [
    { key: 'resumen', icon: '📊', label: 'Resumen', href: '/admin' },
    { key: 'eventos', icon: '🔔', label: 'Eventos', href: '/admin/eventos', badge: nuevosDueno },
    { key: 'consumos', icon: '📈', label: 'Consumos', href: '/admin/consumos' },
    { key: 'facturas', icon: '🧾', label: 'Facturas/Fotos', href: '/admin/archivos' },
    { key: 'edificios', icon: '👥', label: 'Clientes', href: '/admin/clientes' },
    { key: 'solicitudes', icon: '📥', label: 'Solicitudes', href: '/admin/solicitudes', badge: solPend },
  ];
  const nav = dueno ? navDueno : navCliente;
  const navHtml = nav.map((n) => {
    const active = n.key === activeKey;
    return `
      <a href="${n.href}" style="display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border-radius:11px;background:${active ? '#EAF1FB' : 'transparent'};color:${active ? '#17408B' : '#475569'};font-weight:${active ? '800' : '600'};font-size:14.5px;text-align:left;position:relative" class="hv-soft">
        <span style="font-size:17px;width:22px;text-align:center">${n.icon}</span>
        <span style="flex:1">${n.label}</span>
        ${n.badge ? `<span style="min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#E5484D;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center">${n.badge}</span>` : ''}
      </a>`;
  }).join('');

  const previewBanner = preview ? `
    <div style="background:linear-gradient(90deg,#8A6410,#B4841C);color:#fff;min-height:42px;display:flex;align-items:center;justify-content:center;gap:14px;padding:6px 16px;font-size:13.5px;font-weight:600;flex-wrap:wrap">
      <span>👁 Vista previa — así ve su panel <strong>${esc(d.clienteActual ? d.clienteActual.nombre : req.session.previewOwner)}</strong></span>
      <a href="/admin/preview-exit" style="height:28px;padding:0 13px;border-radius:7px;background:rgba(255,255,255,.22);color:#fff;font-weight:700;font-size:12.5px;display:inline-flex;align-items:center">← Volver a mi panel de dueño</a>
    </div>` : '';

  const verComoCliente = esDuenoReal(req) && !preview
    ? `<button onclick="abrirModal('modal-clientpicker')" style="width:100%;text-align:left;padding:9px 11px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:14px;color:#334259;font-weight:600" class="hv-soft">👁&nbsp;&nbsp;Ver como cliente</button>`
    : '';

  // client picker modal (dueño)
  const clientPickerHtml = esDuenoReal(req) && !preview ? `
    <div id="modal-clientpicker" class="modal-overlay" onclick="cerrarModal('modal-clientpicker')">
      <div class="modal-box" style="width:460px" onclick="stopEv(event)">
        <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
          <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Ver como cliente</div>
          <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">¿Qué administrador querés revisar?</div>
          <div style="font-size:13px;color:#8595AD;margin-top:4px">Vas a ver su panel exactamente como lo ve él, para entender su reclamo.</div>
        </div>
        <div style="padding:12px;max-height:60vh;overflow-y:auto">
          ${d.clientes.map((c) => `
            <a href="/admin/preview?cliente=${encodeURIComponent(c.usuario)}" style="width:100%;display:flex;align-items:center;gap:13px;padding:13px;border:1px solid #EEF1F6;background:#fff;border-radius:12px;text-align:left;margin-bottom:8px" class="hv-selbtn">
              <span style="width:44px;height:44px;border-radius:11px;background:linear-gradient(140deg,#17408B,#2E6FC0);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;flex-shrink:0">${esc(c.nombre.charAt(0).toUpperCase())}</span>
              <span style="flex:1;min-width:0">
                <span style="display:block;font-size:15px;font-weight:800;color:#16233B">${esc(c.nombre)}</span>
                <span style="display:block;font-size:12.5px;color:#8595AD;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.edificios.join(', ') || 'Sin edificios')}</span>
              </span>
              <span style="font-size:12px;font-weight:700;color:#5A6B85;background:#EEF2F8;padding:4px 10px;border-radius:999px;flex-shrink:0">${c.edificios.length} edif.</span>
              <span style="color:#C9D5E8;font-size:16px">→</span>
            </a>`).join('')}
        </div>
        <div style="padding:4px 24px 20px">
          <button onclick="cerrarModal('modal-clientpicker')" style="width:100%;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
        </div>
      </div>
    </div>` : '';

  const sugerenciaHref = dueno ? '/admin/solicitudes' : '/admin/sugerencias';

  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marcos IA · Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div style="min-height:100vh;display:flex;flex-direction:column">
  ${previewBanner}
  <!-- TOPBAR -->
  <header style="height:64px;background:#fff;border-bottom:1px solid #E4E9F1;display:flex;align-items:center;gap:18px;padding:0 20px;position:sticky;top:0;z-index:40">
    <div style="display:flex;align-items:center;gap:11px">
      <div style="width:36px;height:36px;border-radius:10px;background:#fff;border:1px solid #E4E9F1;display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="${LOGO_URL}" alt="Bien Argentinos" style="width:100%;height:100%;object-fit:contain"></div>
      <div style="font-weight:800;font-size:17px;letter-spacing:-.02em">Marcos IA</div>
    </div>
    ${selectorHtml}
    <div style="flex:1"></div>
    ${notifHtml}
    <div style="position:relative">
      <button onclick="toggleMenu('menu-user')" style="display:flex;align-items:center;gap:10px;height:44px;padding:0 8px 0 6px;border:1px solid transparent;border-radius:12px;background:none;cursor:pointer" class="hv-soft">
        <span style="width:36px;height:36px;border-radius:50%;background:${userGrad};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px">${esc(userInitial)}</span>
        <span style="text-align:left;line-height:1.15" class="username">
          <span style="display:block;font-size:13.5px;font-weight:700;color:#16233B">${esc(displayName)}</span>
          <span style="display:block;font-size:11px;color:#8595AD">${esc(userSub)}</span>
        </span>
        <span style="color:#8595AD;font-size:11px">▾</span>
      </button>
      <div id="menu-user" class="menu-pop" style="position:absolute;top:52px;right:0;width:220px;background:#fff;border:1px solid #E4E9F1;border-radius:14px;box-shadow:0 16px 40px -12px rgba(16,35,59,.28);padding:7px;z-index:50;animation:mPop .16s ease both">
        <div style="padding:10px 11px 12px;border-bottom:1px solid #EEF1F6;margin-bottom:6px">
          <div style="font-size:14px;font-weight:700">${esc(displayName)}</div>
          <div style="font-size:12px;color:#8595AD">${esc(userMeta)}</div>
        </div>
        ${verComoCliente}
        <button style="width:100%;text-align:left;padding:9px 11px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:14px;color:#334259" class="hv-soft">👤&nbsp;&nbsp;Mi cuenta</button>
        <button style="width:100%;text-align:left;padding:9px 11px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:14px;color:#334259" class="hv-soft">⚙️&nbsp;&nbsp;Preferencias</button>
        <button onclick="location.href='/admin/logout'" style="width:100%;text-align:left;padding:9px 11px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:14px;color:#E5484D;font-weight:600" class="hv-red">↩&nbsp;&nbsp;Cerrar sesión</button>
      </div>
    </div>
  </header>

  <div style="flex:1;display:flex;align-items:stretch">
    <!-- SIDEBAR -->
    <nav class="sidebar-nav" style="width:236px;flex-shrink:0;background:#fff;border-right:1px solid #E4E9F1;padding:18px 14px;position:sticky;top:64px;height:calc(100vh - 64px);display:flex;flex-direction:column;gap:4px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#9AA7BD;padding:6px 12px 8px">Menú</div>
      ${navHtml}
      <div style="flex:1"></div>
      <div style="margin:0 6px;padding:14px;background:linear-gradient(155deg,#0F326A,#2E6FC0);border-radius:14px;color:#fff">
        <div style="font-size:13px;font-weight:800;margin-bottom:4px">¿Necesitás algo?</div>
        <div style="font-size:12.5px;color:rgba(255,255,255,.8);line-height:1.45;margin-bottom:10px">Tu consorcio está siendo atendido las 24 horas.</div>
        <a href="${sugerenciaHref}" style="display:flex;align-items:center;justify-content:center;width:100%;height:36px;border-radius:9px;background:rgba(255,255,255,.16);color:#fff;font-weight:700;font-size:13px">Enviar sugerencia</a>
      </div>
    </nav>

    <!-- MAIN -->
    <main style="flex:1;min-width:0;padding:26px 30px 90px;max-width:1180px;margin:0 auto;width:100%">
      ${contenido}
    </main>
  </div>
</div>
<div id="toast" class="toast"></div>
<div class="drawer-overlay" id="drawer-overlay" onclick="cerrarDrawerEvento()"></div>
<div class="drawer-panel" id="drawer-panel"></div>
${clientPickerHtml}
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

function selectorEdificioHtml(label, sub, tituloMenu, filas, hrefBase) {
  return `
    <div style="position:relative;margin-left:2px">
      <button onclick="toggleMenu('menu-edificio')" style="display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border:1px solid #E1E7F1;border-radius:11px;background:#F7F9FC;cursor:pointer" class="hv-selbtn">
        <span style="font-size:15px">🏢</span>
        <span style="text-align:left;line-height:1.15">
          <span style="display:block;font-size:14px;font-weight:700;color:#16233B">${esc(label)}</span>
          <span style="display:block;font-size:11px;color:#8595AD">${esc(sub)}</span>
        </span>
        <span style="color:#8595AD;font-size:11px;margin-left:2px">▾</span>
      </button>
      <div id="menu-edificio" class="menu-pop" style="position:absolute;top:48px;left:0;width:300px;background:#fff;border:1px solid #E4E9F1;border-radius:14px;box-shadow:0 16px 40px -12px rgba(16,35,59,.28);padding:7px;z-index:50;animation:mPop .16s ease both">
        <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8595AD;padding:8px 10px 6px">${esc(tituloMenu)}</div>
        ${filas.map((f) => `
          <a href="${hrefBase}?edificio=${encodeURIComponent(f.val)}" style="width:100%;display:flex;align-items:center;gap:11px;padding:10px;background:${f.activo ? '#F1F5FB' : 'transparent'};border-radius:10px;text-align:left" class="hv-soft">
            <span style="width:38px;height:38px;border-radius:9px;background:${f.activo ? '#DCE9FA' : '#F1F5FB'};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🏢</span>
            <span style="flex:1;min-width:0">
              <span style="display:block;font-size:14px;font-weight:700;color:#16233B">${esc(f.label)}</span>
              <span style="display:block;font-size:12px;color:#8595AD;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.sub)}</span>
            </span>
            <span style="color:#2E6FC0;font-weight:800;font-size:15px">${f.activo ? '✓' : ''}</span>
          </a>`).join('')}
      </div>
    </div>`;
}

/* ===================================================================
 * LOGIN
 * =================================================================== */

router.get('/login', (req, res) => {
  if (req.session && req.session.authed) return res.redirect('/admin');
  const err = req.query.error
    ? `<div style="background:#FDECEC;color:#B4232A;border:1px solid rgba(229,72,77,.35);padding:10px 12px;border-radius:10px;margin-bottom:16px;font-size:14px">Usuario o contraseña incorrectos.</div>`
    : '';
  res.send(`<!DOCTYPE html>
<html lang="es-AR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ingresar · Marcos IA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet">
<style>${CSS}
.login-shell{min-height:100vh;display:grid;grid-template-columns:1.05fr 1fr}
@media(max-width:900px){.login-shell{grid-template-columns:1fr}.login-brand{display:none!important}}
</style></head>
<body>
<div class="login-shell">
  <div class="login-brand" style="position:relative;background:linear-gradient(150deg,#0F326A 0%,#17408B 45%,#2E6FC0 100%);color:#fff;padding:56px 60px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;min-height:100vh">
    <div style="position:absolute;top:-120px;right:-120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(217,155,31,.28),transparent 70%)"></div>
    <div style="position:absolute;bottom:-160px;left:-80px;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.10),transparent 70%)"></div>
    <div style="position:relative;display:flex;align-items:center;gap:16px">
      <div style="width:128px;height:82px;background:#fff;border-radius:14px;padding:8px;box-shadow:0 8px 22px -8px rgba(0,0,0,.35);flex-shrink:0;display:flex;align-items:center;justify-content:center"><img src="${LOGO_URL}" alt="Bien Argentinos" style="max-width:100%;max-height:100%;object-fit:contain"></div>
      <div>
        <div style="font-weight:800;font-size:22px;letter-spacing:-.02em">Marcos IA</div>
        <div style="font-size:12.5px;color:rgba(255,255,255,.72);font-weight:600">por Bien Argentinos</div>
      </div>
    </div>
    <div style="position:relative">
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);padding:7px 14px;border-radius:999px;font-size:13px;font-weight:600;margin-bottom:26px">
        <span style="width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 0 4px rgba(74,222,128,.25)"></span>
        Atención 24/7 activa
      </div>
      <h1 style="font-size:40px;line-height:1.08;font-weight:800;letter-spacing:-.03em;margin:0 0 18px">Todo lo que pasó<br>en tu edificio,<br>mientras no estabas.</h1>
      <p style="font-size:17px;line-height:1.55;color:rgba(255,255,255,.82);max-width:440px;margin:0">Marcos atiende los WhatsApp y llamados de tu consorcio las 24 horas. Este panel es tu ventana: reclamos, reservas, accesos y avisos, ordenados y al día.</p>
    </div>
    <div style="position:relative;display:flex;gap:26px;font-size:13px;color:rgba(255,255,255,.72)">
      <div><span style="display:block;font-size:22px;font-weight:800;color:#fff">24/7</span>sin horarios</div>
      <div><span style="display:block;font-size:22px;font-weight:800;color:#fff">CABA</span>y GBA</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;justify-content:center;padding:40px;min-height:100vh">
    <form method="POST" action="/admin/login" style="width:100%;max-width:380px;animation:mUp .5s ease both">
      <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2E6FC0;margin-bottom:10px">Panel de administración</div>
      <h2 style="font-size:28px;font-weight:800;letter-spacing:-.02em;margin:0 0 6px">Ingresá a tu cuenta</h2>
      <p style="color:#64748B;font-size:15px;margin:0 0 28px">Usá el usuario y la contraseña de tu cuenta de administrador.</p>
      ${err}
      <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:7px">Usuario</label>
      <div style="position:relative;margin-bottom:18px">
        <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px">👤</span>
        <input name="user" autocomplete="username" autofocus required placeholder="tu_usuario" class="inp" style="height:48px;padding-left:42px">
      </div>
      <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:7px">Contraseña</label>
      <div style="position:relative;margin-bottom:16px">
        <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px">🔒</span>
        <input id="login-pass" name="pass" type="password" autocomplete="current-password" required placeholder="••••••••" class="inp" style="height:48px;padding-left:42px;padding-right:70px">
        <button type="button" onclick="var i=document.getElementById('login-pass');var s=i.type==='password';i.type=s?'text':'password';this.textContent=s?'Ocultar':'Ver'" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);border:none;background:none;color:#64748B;font-size:13px;font-weight:600;cursor:pointer;padding:6px 8px">Ver</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;font-size:13.5px">
        <label style="display:flex;align-items:center;gap:7px;color:#16233B;font-weight:600"><input type="checkbox" name="recordar" checked style="width:16px;height:16px;accent-color:#2E6FC0"> Recordar sesión</label>
        <a href="#" onclick="event.preventDefault()" style="color:#2E6FC0;font-weight:600">¿Olvidaste tu contraseña?</a>
      </div>
      <button type="submit" style="width:100%;height:48px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:15px;cursor:pointer" class="hv-primary">Ingresar al panel</button>
      <p style="text-align:center;margin-top:18px;font-size:14px;color:#64748B">¿Primera vez? <a href="#" onclick="event.preventDefault()" style="color:#2E6FC0;font-weight:700">Activá tu cuenta</a></p>
    </form>
  </div>
</div>
</body></html>`);
});

router.post('/login', async (req, res) => {
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authed = true;
    req.session.role = 'dueno';
    req.session.user = user;
    return req.session.save(() => res.redirect('/admin'));
  }
  const consorcioCfg = CONSORCIO_USERS[user];
  if (consorcioCfg && consorcioCfg.pass === pass) {
    req.session.authed = true;
    req.session.role = 'consorcio';
    req.session.user = user;
    req.session.edificios = consorcioCfg.edificios;
    return req.session.save(() => res.redirect('/admin'));
  }
  try {
    const { rows } = await readTab(TAB_CLIENTES);
    const clientes = rows.map(mapCliente);
    const match = clientes.find((c) => c.usuario === user && c.activo);
    if (match && match.pass && match.pass === pass) {
      req.session.authed = true;
      req.session.role = 'consorcio';
      req.session.user = user;
      req.session.edificios = match.edificios;
      // Ultima conexion (para el banner de novedades): guarda la anterior
      // en sesion y registra la actual en la planilla.
      req.session.lastConn = match.ultimo_acceso || '';
      try {
        const plan = await findOrPlanColumn(TAB_CLIENTES, ['ultimo_acceso']);
        if (plan.create) await ensureHeader(TAB_CLIENTES, plan.col, 'ultimo_acceso', false);
        await writeCell(TAB_CLIENTES, plan.col, match._row, new Date().toLocaleString('es-AR'));
      } catch (_) {}
      return req.session.save(() => res.redirect('/admin'));
    }
  } catch (e) {}
  return res.redirect('/admin/login?error=1');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

/* ===================================================================
 * A partir de aca todo requiere autenticacion.
 * =================================================================== */

router.use(requireAuth);

// Selector de edificio (ambos roles).
router.get('/set-filtro', (req, res) => {
  const edificio = req.query.edificio || '';
  if (esDueno(req)) {
    req.session.filtroEdificioDueno = edificio;
  } else if (enPreview(req)) {
    // en preview el selector cambia el edificio activo del preview
    const propios = req.session.previewEdificios || [];
    req.session.previewEdificioActivo = propios.includes(edificio) ? edificio : undefined;
  } else {
    const propios = req.session.edificios || [];
    if (!edificio || propios.includes(edificio)) {
      req.session.edificioActivo = edificio || undefined;
    }
  }
  const volver = req.query.volver && String(req.query.volver).startsWith('/admin') ? req.query.volver : '/admin';
  res.redirect(volver);
});

// Ver como cliente (solo dueño real).
router.get('/preview', async (req, res) => {
  if (!esDuenoReal(req)) return res.redirect('/admin');
  const usuario = req.query.cliente || '';
  try {
    const { rows } = await readTab(TAB_CLIENTES);
    const c = rows.map(mapCliente).find((x) => x.usuario === usuario);
    if (c) {
      req.session.previewOwner = c.usuario;
      req.session.previewEdificios = c.edificios;
    }
  } catch (e) {}
  res.redirect('/admin');
});

router.get('/preview-exit', (req, res) => {
  delete req.session.previewOwner;
  delete req.session.previewEdificios;
  delete req.session.previewEdificioActivo;
  res.redirect('/admin');
});

/* ===================================================================
 * RESUMEN
 * =================================================================== */

router.get('/', async (req, res) => {
  try {
    const d = await cargarDatos(req);

    if (esDueno(req)) {
      // ---------- RESUMEN DUEÑO ----------
      const filtro = req.session.filtroEdificioDueno;
      const edVisibles = filtro ? d.edificios.filter((e) => e.nombre === filtro) : d.edificios;
      const evVisibles = filtrarPorEdificio(d.eventos, req);
      const nuevosHoy = evVisibles.filter((e) => esHoy(parseFecha(e.fecha)));
      const urgAbiertas = evVisibles.filter((e) => e.urgencia === 'alta' && estadoNormalizado(e.estado) !== 'resuelto');
      const solPend = d.solicitudes.filter((s) => !s.estado || s.estado === 'pendiente').length;

      const kpis = [
        { icon: '🏢', iconBg: '#EAF1FB', value: String(edVisibles.length), label: 'Edificios activos' },
        { icon: '🔔', iconBg: '#EDEEFB', value: String(nuevosHoy.length), label: 'Novedades hoy' },
        { icon: '🚨', iconBg: '#FDECEC', value: String(urgAbiertas.length), label: 'Urgencias abiertas' },
        { icon: '📥', iconBg: '#FBF3DE', value: String(solPend), label: 'Solicitudes pendientes' },
        { icon: '🧾', iconBg: '#E7F4EC', value: '$0', label: 'Excedente facturable' },
      ];

      const kpiHtml = kpis.map((k) => `
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:15px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,35,59,.04)">
          <span style="width:38px;height:38px;border-radius:11px;background:${k.iconBg};display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:11px">${k.icon}</span>
          <div style="font-size:27px;font-weight:800;letter-spacing:-.03em;line-height:1">${k.value}</div>
          <div style="font-size:13px;color:#64748B;font-weight:600;margin-top:4px">${k.label}</div>
        </div>`).join('');

      const cardsHtml = edVisibles.map((e) => {
        const ev = d.eventos.filter((x) => x.edificio === e.nombre);
        const nuevos = ev.filter((x) => esHoy(parseFecha(x.fecha))).length;
        const urg = ev.filter((x) => x.urgencia === 'alta' && esHoy(parseFecha(x.fecha))).length;
        const cliente = (d.clientes.find((c) => c.edificios.includes(e.nombre)) || {}).nombre || 'Sin asignar';
        return `
          <a href="/admin/set-filtro?edificio=${encodeURIComponent(e.nombre)}&volver=${encodeURIComponent('/admin/eventos')}"
            style="display:block;text-align:left;background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px;cursor:pointer" class="hv-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <span style="width:42px;height:42px;border-radius:11px;background:#EAF1FB;display:flex;align-items:center;justify-content:center;font-size:19px">🏢</span>
              <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:#E7F4EC;color:#1B7A43">Dentro del plan</span>
            </div>
            <div style="font-size:16px;font-weight:800;letter-spacing:-.01em">${esc(e.nombre)}</div>
            <div style="font-size:12.5px;color:#8595AD;margin-bottom:12px">${esc(cliente)} · ${esc(e.tipo || 'Edificio')}${e.unidades ? ' · ' + esc(e.unidades) + ' un.' : ''}</div>
            <div style="display:flex;gap:16px">
              <span style="font-size:13px;color:#334259"><strong style="color:#2E6FC0;font-size:15px">${nuevos}</strong> novedades</span>
              <span style="font-size:13px;color:#334259"><strong style="color:#C0392B;font-size:15px">${urg}</strong> urgencias</span>
            </div>
          </a>`;
      }).join('');

      const contenido = `
        <div style="animation:mFade .3s ease both">
          <div style="margin-bottom:20px">
            <div style="font-size:13px;font-weight:700;color:#2E6FC0;margin-bottom:3px">${saludoHora()}, Daniel 👋</div>
            <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0">Panel general · ${filtro ? esc(filtro) : 'todos los edificios'}</h1>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:22px">${kpiHtml}</div>
          <div style="font-size:16px;font-weight:800;margin-bottom:14px">Estado por edificio</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">${cardsHtml}</div>
        </div>`;

      return res.send(shell(req, d, 'resumen', contenido));
    }

    // ---------- RESUMEN CLIENTE ----------
    const cur = d.curBuilding;
    const evTodos = d.eventos.filter((e) => cur && e.edificio === cur.nombre);
    const vistas = evTodos.map(vistaEvento);
    const novedades = vistas.filter((v) => v.nuevo);
    const cUrg = vistas.filter((v) => v.urgKey === 'alta' && v.estKey !== 'resuelto').length;
    const cCurso = vistas.filter((v) => v.estKey === 'curso').length;
    const cRes = vistas.filter((v) => v.estKey === 'resuelto').length;
    const greetName = (d.clienteActual ? d.clienteActual.nombre : req.session.user).split(' ')[0];
    const lastConn = req.session.lastConn || '—';

    const statCards = [
      { icon: '🌙', iconBg: '#EAF1FB', value: String(novedades.length), label: 'Novedades nuevas', delta: 'nuevas', deltaColor: '#2E6FC0' },
      { icon: '🚨', iconBg: '#FDECEC', value: String(cUrg), label: 'Urgencias abiertas', delta: cUrg ? 'atención' : 'ok', deltaColor: cUrg ? '#C0392B' : '#1B7A43' },
      { icon: '⏳', iconBg: '#FBF3DE', value: String(cCurso), label: 'En curso', delta: 'en gestión', deltaColor: '#8A6410' },
      { icon: '✅', iconBg: '#E7F4EC', value: String(cRes), label: 'Resueltos', delta: 'cerrados', deltaColor: '#1B7A43' },
    ];

    const statHtml = statCards.map((s) => `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:15px;padding:18px 18px 16px;box-shadow:0 1px 2px rgba(16,35,59,.04)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span style="width:40px;height:40px;border-radius:11px;background:${s.iconBg};display:flex;align-items:center;justify-content:center;font-size:19px">${s.icon}</span>
          <span style="font-size:12px;font-weight:700;color:${s.deltaColor}">${s.delta}</span>
        </div>
        <div style="font-size:32px;font-weight:800;letter-spacing:-.03em;line-height:1">${s.value}</div>
        <div style="font-size:13.5px;color:#64748B;font-weight:600;margin-top:4px">${s.label}</div>
      </div>`).join('');

    // feed de novedades (o ultimos eventos si no hay nuevos hoy)
    const feedVistas = (novedades.length ? novedades : vistas).slice(0, 4);
    const idxOffset = 0;
    const novHtml = feedVistas.map((v, i) => `
      <button onclick="abrirDrawerEvento(${i})" style="width:100%;display:flex;align-items:flex-start;gap:13px;padding:15px 20px;border:none;border-bottom:1px solid #F1F4F9;background:none;cursor:pointer;text-align:left" class="hv-row">
        <span style="width:40px;height:40px;border-radius:11px;background:${v.catBg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${v.catIcon}</span>
        <span style="flex:1;min-width:0">
          <span style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
            <span style="font-size:14.5px;font-weight:700;color:#16233B">${esc(v.titulo)}</span>
            <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:${v.urgBg};color:${v.urgFg}">${v.urgLabel}</span>
          </span>
          <span style="display:block;font-size:13px;color:#64748B;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.detalle || v.titulo)}</span>
          <span style="display:flex;align-items:center;gap:10px;margin-top:5px;font-size:12px;color:#9AA7BD">
            <span>${v.canalIcon} ${esc(v.canal)}</span><span>·</span><span>${esc(v.vecino)}</span><span>·</span><span>${esc(v.when)}</span>
          </span>
        </span>
        <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:${v.estBg};color:${v.estFg};flex-shrink:0;margin-top:2px">${v.estLabel}</span>
      </button>`).join('');

    // estado del edificio por tipo
    const tipoBreak = Object.keys(CATEGORIAS_EVENTO).map((k) => ({
      icon: CATEGORIAS_EVENTO[k].icon, label: CATEGORIAS_EVENTO[k].label,
      count: vistas.filter((v) => v.catKey === k).length,
    })).filter((t) => t.count > 0);
    const tipoHtml = tipoBreak.length ? tipoBreak.map((t) => `
      <div style="display:flex;align-items:center;gap:11px;padding:8px 0">
        <span style="font-size:16px;width:24px;text-align:center">${t.icon}</span>
        <span style="flex:1;font-size:14px;color:#334259;font-weight:600">${t.label}</span>
        <span style="font-size:14px;font-weight:800;color:#16233B">${t.count}</span>
      </div>`).join('') : '<div style="font-size:13px;color:#8595AD">Sin eventos registrados aún.</div>';

    // costos en divisa desde facturas del edificio
    let usdTotal = 0, eurTotal = 0;
    try {
      const { rows: facRows } = await readTab(TAB_ARCHIVOS);
      facRows.map(mapFactura).filter((f) => cur && f.edificio === cur.nombre).forEach((f) => {
        const n = parseFloat(String(f.monto).replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        if (f.moneda === 'USD') usdTotal += n;
        if (f.moneda === 'EUR') eurTotal += n;
      });
    } catch (_) {}

    const contenido = `
      <div style="animation:mFade .3s ease both">
        <div style="margin-bottom:20px">
          <div style="font-size:13px;font-weight:700;color:#2E6FC0;letter-spacing:.02em;margin-bottom:3px">Hola de nuevo, ${esc(greetName)} 👋</div>
          <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0">Resumen de ${esc(cur ? cur.nombre : '')}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:16px;background:linear-gradient(120deg,#0F326A,#2E6FC0);border-radius:16px;padding:18px 22px;color:#fff;margin-bottom:22px;flex-wrap:wrap">
          <div style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🌙</div>
          <div style="flex:1;min-width:200px">
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">${novedades.length} novedad${novedades.length === 1 ? ' nueva' : 'es nuevas'}</div>
            <div style="font-size:14px;color:rgba(255,255,255,.82)">Desde tu última conexión · ${esc(lastConn)}</div>
          </div>
          <a href="/admin/eventos" style="display:inline-flex;align-items:center;height:42px;padding:0 20px;border-radius:11px;background:#fff;color:#17408B;font-weight:700;font-size:14px" class="hv-blue">Ver todo →</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:26px">${statHtml}</div>
        <div style="display:grid;grid-template-columns:1.55fr 1fr;gap:20px" class="resgrid">
          <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #EEF1F6">
              <div style="font-size:16px;font-weight:800">Novedades desde tu ausencia</div>
              <div style="font-size:13px;color:#8595AD;font-weight:600">${novedades.length} nuevas</div>
            </div>
            ${novHtml || '<div style="padding:26px;text-align:center;font-size:13.5px;color:#8595AD">Sin novedades por ahora.</div>'}
          </div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px 20px">
              <div style="font-size:15px;font-weight:800;margin-bottom:14px">Estado del edificio</div>
              ${tipoHtml}
            </div>
            <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px 20px">
              <div style="font-size:15px;font-weight:800;margin-bottom:6px">Costos en divisa</div>
              <div style="font-size:12.5px;color:#8595AD;margin-bottom:14px;line-height:1.4">Servicios facturados en moneda extranjera este mes</div>
              <div style="display:flex;gap:10px">
                <div style="flex:1;background:#E7F4EC;border-radius:12px;padding:12px 14px">
                  <div style="font-size:11px;font-weight:800;color:#1B7A43;letter-spacing:.04em">USD</div>
                  <div style="font-size:20px;font-weight:800;color:#14532D;letter-spacing:-.02em">USD ${Math.round(usdTotal)}</div>
                </div>
                <div style="flex:1;background:#E9EEFB;border-radius:12px;padding:12px 14px">
                  <div style="font-size:11px;font-weight:800;color:#2C55A8;letter-spacing:.04em">EUR</div>
                  <div style="font-size:20px;font-weight:800;color:#1E3A6B;letter-spacing:-.02em">EUR ${Math.round(eurTotal)}</div>
                </div>
              </div>
              <a href="/admin/archivos" style="display:flex;align-items:center;justify-content:center;width:100%;margin-top:12px;height:38px;border:1px solid #E1E7F1;border-radius:10px;background:#F7F9FC;color:#334259;font-weight:700;font-size:13px" class="hv-soft">Ver comprobantes</a>
            </div>
          </div>
        </div>
      </div>
      <script>window.__EVENTOS__=${jsonEventos(feedVistas)};window.__ES_DUENO__=false;</script>`;

    res.send(shell(req, d, 'resumen', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

function saludoHora() {
  const h = new Date().getHours();
  if (h < 12) return 'Buen día';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function jsonEventos(vistas) {
  return JSON.stringify(vistas).replace(/</g, '\\u003c');
}

function paginaError(e) {
  return `<!DOCTYPE html><html lang="es-AR"><head><meta charset="utf-8"><style>${CSS}</style></head>
  <body><div style="max-width:520px;margin:80px auto;background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:28px;text-align:center">
  <div style="font-size:17px;font-weight:800;margin-bottom:8px">Ups, no pude leer los datos</div>
  <div style="font-size:13.5px;color:#C0392B;margin-bottom:8px">${esc(e && e.message ? e.message : e)}</div>
  <div style="font-size:13px;color:#64748B">Revisá GOOGLE_SHEET_ID, las credenciales y los nombres de las pestañas.</div>
  </div></body></html>`;
}

/* ===================================================================
 * EVENTOS
 * =================================================================== */

router.get('/eventos', async (req, res) => {
  try {
    const d = await cargarDatos(req);
    const dueno = esDueno(req);
    const evFiltrados = filtrarPorEdificio(d.eventos, req)
      .slice()
      .sort((a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0));
    const vistas = evFiltrados.map(vistaEvento);

    const filas = vistas.length
      ? vistas.map((v, i) => filaEvento(v, i, dueno)).join('')
      : '<div style="padding:30px;text-align:center;font-size:13.5px;color:#8595AD">Todavía no hay eventos registrados.</div>';

    let encabezado, chips = '';
    if (dueno) {
      const filtro = req.session.filtroEdificioDueno;
      encabezado = `
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Eventos · ${filtro ? esc(filtro) : 'Todos los edificios'}</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">Feed de todos los consorcios. Usá el filtro de arriba para acotar por edificio.</p>`;
    } else {
      const cN = vistas.filter((v) => v.nuevo).length;
      const cU = vistas.filter((v) => v.urgKey === 'alta').length;
      const cA = vistas.filter((v) => v.estKey !== 'resuelto').length;
      encabezado = `
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Eventos</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">Todo lo que Marcos gestionó en ${esc(d.curBuilding ? d.curBuilding.nombre : '')}. Tocá un caso para ver el detalle.</p>`;
      const chip = (modo, label, count, activo) => `
        <button data-chip onclick="filtrarEventos('${modo}',this)" style="height:38px;padding:0 16px;border:1px solid ${activo ? '#17408B' : '#E1E7F1'};border-radius:999px;background:${activo ? '#17408B' : '#fff'};color:${activo ? '#fff' : '#475569'};font-weight:700;font-size:13.5px;cursor:pointer;display:flex;align-items:center;gap:7px" class="hv-selbtn">
          ${label}<span style="font-size:12px;opacity:.75">${count}</span>
        </button>`;
      chips = `
        <div style="display:flex;gap:9px;margin-bottom:18px;flex-wrap:wrap">
          ${chip('todos', 'Todos', vistas.length, true)}
          ${chip('nuevos', 'Nuevos', cN, false)}
          ${chip('urgentes', 'Urgentes', cU, false)}
          ${chip('abiertos', 'Sin resolver', cA, false)}
        </div>`;
    }

    const contenido = `
      <div style="animation:mFade .3s ease both">
        ${encabezado}
        ${chips}
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;overflow:hidden">${filas}</div>
      </div>
      <script>window.__EVENTOS__=${jsonEventos(vistas)};window.__ES_DUENO__=${dueno ? 'true' : 'false'};</script>`;

    res.send(shell(req, d, 'eventos', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * MI EDIFICIO (cliente)
 * =================================================================== */

router.get('/mi-edificio', async (req, res) => {
  if (esDueno(req)) return res.redirect('/admin/clientes');
  try {
    const d = await cargarDatos(req);
    const cur = d.curBuilding;
    if (!cur) {
      return res.send(shell(req, d, 'edificio', '<div style="padding:30px;text-align:center;color:#8595AD">No hay edificio asignado a tu cuenta.</div>'));
    }

    const usuarioCliente = enPreview(req) ? req.session.previewOwner : req.session.user;

    // Lista MAESTRA de proveedores del cliente (se carga una vez) y las
    // asignaciones a ESTE edificio.
    let maestros = [];
    let asignados = [];
    try {
      const { rows } = await readTab(TAB_PROVEEDORES);
      maestros = rows.map(mapProveedor).filter((p) => p.cliente === usuarioCliente && p.estado !== 'eliminado');
    } catch (_) {}
    try {
      const { rows } = await readTab(TAB_ASIGNACIONES);
      asignados = rows.map(mapAsignacion).filter((a) => a.edificio === cur.nombre && a.estado !== 'eliminado');
    } catch (_) {}

    // Pedidos de cambio pendientes (para los campos de consulta con aprobacion).
    const pendientes = d.solicitudes.filter((s) =>
      (!s.estado || s.estado === 'pendiente') && String(s.edificio || '').includes(cur.nombre)
    );
    const pendCampos = new Set(pendientes.map((p) => p.campo));
    const pendHtml = pendientes.length ? `
      <div style="background:#FBF3DE;border:1px solid #F0DCA6;border-radius:14px;padding:14px 18px;margin-bottom:20px">
        <div style="font-size:14px;font-weight:800;color:#8A6410;margin-bottom:8px">⏳ Cambios pendientes de aprobación (${pendientes.length})</div>
        ${pendientes.map((p) => `
          <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#7A5A12;padding:3px 0">
            <span style="font-weight:700">${esc(FICHA_LABELS[p.campo] || p.campo)}:</span>
            <span style="text-decoration:line-through;opacity:.65">${esc(p.valor_actual || '—')}</span>
            <span>→</span>
            <span style="font-weight:700">${esc(p.valor_nuevo || '')}</span>
          </div>`).join('')}
      </div>` : '';

    // ---- helpers de campo ----
    const label = (t) => `<div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.02em;margin-bottom:6px">${t}</div>`;
    const inputEditable = (campo, valor, placeholder) =>
      `<input data-me="${campo}" value="${esc(valor)}" placeholder="${esc(placeholder || '')}" class="inp" style="height:44px">`;

    // ---- ENCARGADO (estado + horario) ----
    const estados = [
      { key: 'activo', label: 'Activo', bg: '#E7F4EC', fg: '#1B7A43' },
      { key: 'licencia', label: 'Licencia', bg: '#FBF3DE', fg: '#8A6410' },
      { key: 'vacaciones', label: 'Vacaciones', bg: '#EAF1FB', fg: '#2C55A8' },
    ];
    const estadoActual = (cur.encargado_estado || 'activo').toLowerCase();
    const btnEstado = estados.map((e) => {
      const act = e.key === estadoActual;
      return `<button type="button" data-enc-estado="${e.key}" onclick="setEncEstado('${e.key}')" style="height:38px;padding:0 16px;border:1.5px solid ${act ? e.fg : '#DDE3EE'};border-radius:10px;background:${act ? e.bg : '#fff'};color:${act ? e.fg : '#64748B'};font-weight:700;font-size:13.5px;cursor:pointer">${e.label}</button>`;
    }).join('');

    // Horario con selectores de hora (tipo rueda): 2 rangos Lun-Vie + Sáb.
    const hor = parseHorarioEnc(cur.encargado_horario);
    const timeInput = (id, val) => `<input type="time" id="${id}" value="${esc(val)}" class="inp" style="height:42px;width:auto;min-width:120px">`;
    const rangoHorario = (titulo, idA, valA, idB, valB) => `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:13px;font-weight:700;color:#334259;min-width:120px">${titulo}</span>
        ${timeInput(idA, valA)}
        <span style="color:#8595AD">a</span>
        ${timeInput(idB, valB)}
      </div>`;

    const encargadoCard = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:16px">
        <div style="font-size:16px;font-weight:800;margin-bottom:4px">🧑‍🔧 Encargado</div>
        <p style="font-size:13px;color:#8595AD;margin:0 0 16px">Marcos usa estos datos para saber si puede contar con el encargado cuando surge un evento.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="fichagrid">
          <div>${label('Nombre del encargado')}${inputEditable('encargado', cur.encargado, 'Nombre y apellido')}</div>
          <div>${label('Tel. encargado')}${inputEditable('tel_encargado', cur.tel_encargado, 'Teléfono')}</div>
          <div>${label('Encargado suplente / limpieza')}${inputEditable('encargado_suplente', cur.encargado_suplente, 'Quién lo cubre')}</div>
          <div>${label('Tel. suplente')}${inputEditable('tel_suplente', cur.tel_suplente, 'Teléfono')}</div>
        </div>
        <div style="margin-top:16px">
          ${label('Estado del encargado')}
          <div style="display:flex;gap:9px;flex-wrap:wrap">${btnEstado}</div>
          <input type="hidden" data-me="encargado_estado" id="enc-estado-val" value="${esc(estadoActual)}">
        </div>
        <div id="enc-horario-wrap" style="margin-top:18px;${estadoActual === 'activo' ? '' : 'display:none'}">
          ${label('Horario del encargado (cuando está activo)')}
          ${rangoHorario('Lun a Vie', 'enc-lv1a', hor.lv1[0], 'enc-lv1b', hor.lv1[1])}
          ${rangoHorario('Lun a Vie (2° turno)', 'enc-lv2a', hor.lv2[0], 'enc-lv2b', hor.lv2[1])}
          ${rangoHorario('Sábados', 'enc-saba', hor.sab[0], 'enc-sabb', hor.sab[1])}
          <div style="font-size:12px;color:#9AA7BD;margin-top:4px">Marcos se fija en estos horarios para saber si el encargado está disponible al momento del evento. Dejá vacío el 2° turno si no aplica.</div>
        </div>
      </div>`;

    // ---- DATOS DEL EDIFICIO (editables directo) ----
    const datosCard = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:16px">
        <div style="font-size:16px;font-weight:800;margin-bottom:4px">🏢 Datos del edificio</div>
        <p style="font-size:13px;color:#8595AD;margin:0 0 16px">Estos datos los editás vos y se guardan al instante — no necesitan aprobación.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="fichagrid">
          <div>${label('Dirección')}${inputEditable('direccion', cur.direccion, 'Calle y número (legal)')}</div>
          <div>${label('Zona / barrio')}${inputEditable('zona', cur.zona, 'Barrio, ciudad')}</div>
          <div style="grid-column:1/-1">${label('Alias / doble dirección')}${inputEditable('aliases', cur.aliases, 'Ej: Ortiz 1486 (como lo conocen los vecinos)')}
            <div style="font-size:12px;color:#9AA7BD;margin-top:6px">Si el edificio figura con una altura legal pero los vecinos lo nombran distinto, cargá acá los dos. Marcos reconoce cualquiera de las dos.</div>
          </div>
          <div>${label('CUIT del edificio')}${inputEditable('cuit', cur.cuit, '30-XXXXXXXX-X')}</div>
          <div>${label('Unidades funcionales')}${inputEditable('unidades', cur.unidades, 'Cantidad')}</div>
          <div>${label('Horario del SUM')}${inputEditable('horario_sum', cur.horario_sum, 'Ej: 10 a 24hs · seña $15.000')}</div>
          <div>${label('Cocheras')}${inputEditable('cocheras', cur.cocheras, 'Ej: 22 fijas + 4 de cortesía')}</div>
          <div>${label('Tel. seguridad de la entrada')}${inputEditable('tel_seguridad', cur.tel_seguridad, 'Si el edificio tiene')}</div>
        </div>
      </div>`;

    // ---- PROVEEDORES: asignados a este edificio + asignar desde la lista ----
    const rubroColor = (r) => ({
      Plomero: '#EAF1FB', Gasista: '#FBF3DE', Electricista: '#FDF3D6', Ascensores: '#EDEEFB',
    }[r] || '#EEF2F8');
    const prioStyle = (k) => (PRIORIDADES.find((p) => p.key === k) || PRIORIDADES[0]);

    // Fila de proveedor asignado (resuelve telefono desde la maestra por si cambió).
    const asigFilas = asignados.length ? asignados
      .slice()
      .sort((a, b) => PRIORIDADES.findIndex((p) => p.key === a.prioridad) - PRIORIDADES.findIndex((p) => p.key === b.prioridad))
      .map((a) => {
        const m = maestros.find((x) => x.nombre === a.proveedor) || {};
        const tel = m.telefono || a.telefono || '—';
        const pr = prioStyle(a.prioridad);
        return `
          <div style="display:flex;align-items:center;gap:13px;padding:12px 14px;border:1px solid #E7ECF3;border-radius:12px;background:#fff;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;background:${rubroColor(a.rubro)};color:#334259;min-width:92px;text-align:center">${esc(a.rubro)}</span>
            <div style="flex:1;min-width:120px">
              <div style="font-size:14.5px;font-weight:700">${esc(a.proveedor || '—')}</div>
              ${m.notas ? `<div style="font-size:12px;color:#8595AD">${esc(m.notas)}</div>` : ''}
            </div>
            <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:${pr.bg};color:${pr.fg}">${pr.label}</span>
            <div style="font-size:14px;font-weight:700;color:#2E6FC0">${esc(tel)}</div>
            <button onclick="desasignarProveedor(this,${a._row})" style="height:34px;padding:0 12px;border:1px solid #EEDCDC;border-radius:9px;background:#fff;color:#C0392B;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-red">Quitar</button>
          </div>`;
      }).join('')
      : '<div style="font-size:13.5px;color:#8595AD;padding:6px 2px">Todavía no asignaste proveedores a este edificio. Elegí de tu lista abajo.</div>';

    // Opciones para asignar: los de la maestra que no estan ya asignados.
    const yaAsignados = new Set(asignados.map((a) => a.proveedor));
    const disponibles = maestros.filter((m) => !yaAsignados.has(m.nombre));
    const optMaestros = disponibles.length
      ? disponibles.map((m) => `<option value="${esc(m.nombre)}">${esc(m.rubro)} · ${esc(m.nombre)}${m.telefono ? ' (' + esc(m.telefono) + ')' : ''}</option>`).join('')
      : '';
    const optPrioridad = PRIORIDADES.map((p) => `<option value="${p.key}">${p.label}</option>`).join('');

    const asignarBloque = maestros.length ? `
      <div style="border-top:1px dashed #E4E9F1;padding-top:16px">
        <div style="font-size:13px;font-weight:800;color:#334259;margin-bottom:10px">Asignar un proveedor de tu lista a este edificio</div>
        ${disponibles.length ? `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:200px">${label('Proveedor')}<select id="asig-prov" class="inp" style="height:44px">${optMaestros}</select></div>
          <div style="width:170px">${label('Prioridad')}<select id="asig-prio" class="inp" style="height:44px">${optPrioridad}</select></div>
          <button onclick="asignarProveedor(this)" style="height:44px;padding:0 20px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">Asignar</button>
        </div>` : '<div style="font-size:13px;color:#8595AD">Ya asignaste todos tus proveedores a este edificio.</div>'}
      </div>` : `
      <div style="border-top:1px dashed #E4E9F1;padding-top:16px;font-size:13.5px;color:#8595AD">
        Todavía no tenés proveedores en tu lista. Cargalos una vez con el botón de arriba y después asignalos a cada edificio.
      </div>`;

    const proveedoresCard = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px">
          <div style="font-size:16px;font-weight:800">🧰 Proveedores de este edificio</div>
          <button onclick="abrirModal('modal-proveedores')" style="height:36px;padding:0 14px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:13px;cursor:pointer" class="hv-soft">Mi lista de proveedores (${maestros.length})</button>
        </div>
        <p style="font-size:13px;color:#8595AD;margin:0 0 16px">Cuando surge un evento (pérdida de agua, ascensor, etc.), Marcos recurre al proveedor del rubro según la prioridad que le pongas acá. Cargás cada proveedor <strong>una sola vez</strong> en tu lista y lo asignás a los edificios que quieras.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">${asigFilas}</div>
        ${asignarBloque}
      </div>`;

    // Modal: lista maestra del cliente (cargar/quitar una vez, sirve a todos).
    const rubroOptions = RUBROS_PROVEEDOR.map((r) => `<option value="${r}">${r}</option>`).join('');
    const maestroFilas = maestros.length ? maestros.map((m) => `
      <div style="display:flex;align-items:center;gap:11px;padding:11px 13px;border:1px solid #E7ECF3;border-radius:11px;background:#fff;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:800;padding:4px 10px;border-radius:999px;background:${rubroColor(m.rubro)};color:#334259;min-width:86px;text-align:center">${esc(m.rubro)}</span>
        <div style="flex:1;min-width:110px">
          <div style="font-size:14px;font-weight:700">${esc(m.nombre || '—')}</div>
          ${m.notas ? `<div style="font-size:12px;color:#8595AD">${esc(m.notas)}</div>` : ''}
        </div>
        <div style="font-size:13.5px;font-weight:700;color:#2E6FC0">${esc(m.telefono || '—')}</div>
        <button onclick="quitarProveedor(this,${m._row})" style="height:32px;padding:0 11px;border:1px solid #EEDCDC;border-radius:8px;background:#fff;color:#C0392B;font-weight:700;font-size:12px;cursor:pointer" class="hv-red">Quitar</button>
      </div>`).join('') : '<div style="font-size:13.5px;color:#8595AD;padding:8px 2px">Tu lista está vacía. Agregá tu primer proveedor abajo.</div>';

    const modalProveedores = `
      <div id="modal-proveedores" class="modal-overlay" onclick="cerrarModal('modal-proveedores')">
        <div class="modal-box" style="width:560px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Mi lista de proveedores</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Técnicos de confianza</div>
            <div style="font-size:13px;color:#8595AD;margin-top:4px">Cargalos una sola vez acá. Después los asignás a cada edificio desde su ficha.</div>
          </div>
          <div style="padding:18px 24px;max-height:44vh;overflow-y:auto">
            <div style="display:flex;flex-direction:column;gap:9px">${maestroFilas}</div>
          </div>
          <div style="padding:16px 24px;border-top:1px solid #EEF1F6;background:#F8FAFD">
            <div style="font-size:13px;font-weight:800;color:#334259;margin-bottom:10px">Agregar proveedor a mi lista</div>
            <div style="display:grid;grid-template-columns:130px 1fr;gap:10px;margin-bottom:10px">
              <div>${label('Rubro')}<select id="prov-rubro" class="inp" style="height:42px">${rubroOptions}</select></div>
              <div>${label('Nombre / empresa')}<input id="prov-nombre" class="inp" style="height:42px" placeholder="Ej: Gastón, Plomería del Oeste"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
              <div>${label('Teléfono')}<input id="prov-tel" class="inp" style="height:42px" placeholder="Teléfono"></div>
              <div>${label('Notas (opcional)')}<input id="prov-notas" class="inp" style="height:42px" placeholder="Ej: tiene llave del edificio"></div>
            </div>
            <button onclick="agregarProveedor(this)" style="height:42px;padding:0 20px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">+ Agregar a mi lista</button>
          </div>
          <div style="padding:14px 24px 20px">
            <button onclick="cerrarModal('modal-proveedores')" style="width:100%;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Listo</button>
          </div>
        </div>
      </div>`;

    // ---- DATOS DE CONSULTA (con aprobacion) ----
    const consultaRows = [
      { campo: 'nombre', icon: '🏢', label: 'Consorcio', value: cur.nombre },
      { campo: 'administrador', icon: '👔', label: 'Administrador', value: cur.administrador || '—' },
      { campo: 'telefonos', icon: '📞', label: 'Tel. administración', value: cur.telefonos || '—' },
    ];
    const consultaHtml = consultaRows.map((r) => `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:14px;padding:15px 17px;display:flex;align-items:center;gap:12px">
        <span style="width:40px;height:40px;border-radius:11px;background:#F1F5FB;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${r.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#8595AD;letter-spacing:.02em;text-transform:uppercase">${r.label}</div>
          <div style="font-size:15.5px;font-weight:700;color:#16233B;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.value)}</div>
        </div>
        ${pendCampos.has(r.campo) ? '<span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:#FBF3DE;color:#8A6410;flex-shrink:0">Pendiente</span>' : ''}
        <button onclick="abrirSolicitud('${escJs(r.campo)}','${escJs(r.label)}','${escJs(r.value === '—' ? '' : r.value)}','${escJs(cur.nombre)}')" style="flex-shrink:0;height:34px;padding:0 13px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-softb">Solicitar cambio</button>
      </div>`).join('');

    const modalSolicitud = `
      <div id="modal-solicitud" class="modal-overlay" onclick="cerrarModal('modal-solicitud')">
        <div class="modal-box" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Solicitar cambio</div>
            <div id="req-label" style="font-size:19px;font-weight:800;letter-spacing:-.01em"></div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#8595AD;margin-bottom:6px">Valor actual</div>
            <div id="req-current" style="background:#F1F5FB;border:1px solid #E4EBF5;border-radius:11px;padding:12px 14px;font-size:15px;font-weight:600;color:#5A6B85;margin-bottom:18px"></div>
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nuevo valor</div>
            <input id="req-nuevo" placeholder="Escribí el valor correcto" class="inp" style="margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Motivo <span style="font-weight:500;color:#9AA7BD">(opcional)</span></div>
            <textarea id="req-motivo" placeholder="Ej: Cambiamos de administrador." class="inp"></textarea>
            <div style="display:flex;align-items:center;gap:9px;background:#FBF3DE;border-radius:10px;padding:10px 13px;margin-top:16px;font-size:12.5px;color:#8A6410;line-height:1.4">
              <span style="font-size:15px">🔒</span>
              <span>Tu pedido queda <strong>pendiente</strong>. Tu administrador lo revisa y recién ahí se aplica. Nada se cambia solo.</span>
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-solicitud')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="enviarSolicitud(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Enviar solicitud</button>
          </div>
        </div>
      </div>`;

    // barra de guardar (sticky abajo) para los datos editables directos
    const barraGuardar = `
      <div style="position:sticky;bottom:0;background:linear-gradient(0deg,#EEF1F6 60%,transparent);padding:14px 0 4px;margin-top:4px;z-index:5">
        <button onclick="guardarMiEdificio(this)" style="height:48px;padding:0 26px;border:none;border-radius:12px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 8px 20px -8px rgba(30,95,180,.5)" class="hv-primary">Guardar cambios del edificio</button>
        <span style="margin-left:14px;font-size:12.5px;color:#8595AD">Datos del edificio, encargado y estado. Los proveedores se guardan por separado.</span>
      </div>`;

    const contenido = `
      <div style="animation:mFade .3s ease both">
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Mi Edificio</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">Ficha de ${esc(cur.nombre)}. Estos son los datos que Marcos usa para atender tu consorcio. Casi todo lo editás vos directo; solo el nombre del consorcio y el administrador pasan por tu administrador.</p>
        ${pendHtml}
        ${datosCard}
        ${encargadoCard}
        ${proveedoresCard}
        <div style="font-size:14px;font-weight:800;color:#334259;margin:8px 0 12px">Datos de consulta (los cambia tu administrador)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="fichagrid">${consultaHtml}</div>
        ${barraGuardar}
      </div>
      ${modalSolicitud}
      ${modalProveedores}`;

    res.send(shell(req, d, 'edificio', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * FACTURAS / FOTOS
 * =================================================================== */

router.get('/archivos', async (req, res) => {
  try {
    const d = await cargarDatos(req);
    const dueno = esDueno(req);
    const { rows } = await readTab(TAB_ARCHIVOS);
    const facturas = filtrarPorEdificio(rows.map(mapFactura), req)
      .sort((a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0));

    const monStyle = (m) => (m === 'USD' ? { bg: '#E7F4EC', fg: '#1B7A43' } : m === 'EUR' ? { bg: '#E9EEFB', fg: '#2C55A8' } : { bg: '#EEF2F8', fg: '#5A6B85' });
    const cards = facturas.map((f) => {
      const mon = monStyle(f.moneda);
      const pagada = /pagad/i.test(f.estado);
      const thumbBg = f.tipo === 'Foto' ? 'linear-gradient(135deg,#E7F4EC,#D5EADD)' : 'linear-gradient(135deg,#EAF1FB,#DCE9FA)';
      const abrir = f.url && /^https?:/i.test(f.url) ? `onclick="window.open('${escJs(f.url)}','_blank')" style="cursor:pointer"` : '';
      return `
        <div ${abrir ? abrir.replace('style="cursor:pointer"', '') : ''} style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;overflow:hidden${abrir ? ';cursor:pointer' : ''}">
          <div style="height:120px;background:${thumbBg};display:flex;align-items:center;justify-content:center;position:relative">
            <span style="font-size:40px">${f.tipo === 'Foto' ? '🖼️' : '🧾'}</span>
            <span style="position:absolute;top:10px;left:10px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.9);color:#334259">${f.tipo}</span>
            <span style="position:absolute;top:10px;right:10px;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:${mon.bg};color:${mon.fg}">${f.moneda}</span>
          </div>
          <div style="padding:14px 16px">
            ${dueno ? `<span style="display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:#EEF2F8;color:#5A6B85;margin-bottom:8px">🏢 ${esc(f.edificio)}</span>` : ''}
            <div style="font-size:15px;font-weight:700;margin-bottom:2px">${esc(truncate(f.concepto, 60))}</div>
            <div style="font-size:13px;color:#8595AD;margin-bottom:12px">${esc(f.proveedor)} · ${esc(fechaCorta(parseFecha(f.fecha)) || f.fecha)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:19px;font-weight:800;letter-spacing:-.02em">${esc(f.monto || '—')}</span>
              <span style="font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px;background:${pagada ? '#E7F4EC' : '#FBF3DE'};color:${pagada ? '#1B7A43' : '#8A6410'}">${esc(f.estado || 'Pendiente')}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    const filtroDueno = req.session.filtroEdificioDueno;
    const contenido = `
      <div style="animation:mFade .3s ease both">
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Facturas y Fotos${dueno ? ` · ${filtroDueno ? esc(filtroDueno) : 'Todos los edificios'}` : ''}</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">${dueno ? 'Comprobantes y archivos de todos los consorcios. Usá el filtro de arriba para acotar por edificio.' : 'Comprobantes y archivos que vecinos y proveedores enviaron por WhatsApp, ordenados por Marcos.'}</p>
        ${facturas.length
          ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${cards}</div>`
          : '<div style="text-align:center;padding:36px 20px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px">Este edificio todavía no tiene comprobantes cargados.</div>'}
      </div>`;

    res.send(shell(req, d, 'facturas', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * EXPENSAS (cliente)
 * =================================================================== */

router.get('/expensas', async (req, res) => {
  if (esDueno(req)) return res.redirect('/admin');
  try {
    const d = await cargarDatos(req);
    const cur = d.curBuilding;
    const { rows } = await readTab(TAB_EXPENSAS);
    const expensas = rows.map(mapExpensa)
      .filter((x) => cur && x.edificio === cur.nombre && x.estado !== 'eliminada')
      .sort((a, b) => b._row - a._row);

    const tipoExp = (f) => (f === 'link'
      ? { icon: '🔗', bg: '#E9EEFB', fg: '#2C55A8', label: 'Link web' }
      : f === 'imagen'
        ? { icon: '🖼️', bg: '#E7F4EC', fg: '#1B7A43', label: 'Imagen' }
        : { icon: '📄', bg: '#FDECEC', fg: '#C0392B', label: 'PDF' });

    const listHtml = expensas.length ? `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${expensas.map((x) => {
          const t = tipoExp(x.formato);
          const copiable = x.url || x.nombre;
          return `
          <div style="display:flex;align-items:center;gap:15px;background:#fff;border:1px solid #E7ECF3;border-radius:14px;padding:15px 18px;flex-wrap:wrap">
            <span style="width:46px;height:46px;border-radius:12px;background:${t.bg};display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0">${t.icon}</span>
            <div style="flex:1;min-width:170px">
              <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
                <span style="font-size:15.5px;font-weight:800">${esc(x.periodo)}</span>
                <span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:${t.bg};color:${t.fg}">${t.label}</span>
              </div>
              <div style="font-size:12.5px;color:#8595AD;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px">${esc(x.url || x.nombre || '')}</div>
            </div>
            <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:5px 11px;border-radius:999px;background:#E7F4EC;color:#1B7A43">✓ Marcos puede compartirla</span>
            <div style="display:flex;gap:8px">
              <button onclick="copiarExpensa('${escJs(copiable)}')" style="height:36px;padding:0 13px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-soft">🔗 Copiar</button>
              <button onclick="quitarExpensa(this,${x._row})" style="height:36px;padding:0 13px;border:1px solid #EEDCDC;border-radius:9px;background:#fff;color:#C0392B;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-red">Quitar</button>
            </div>
          </div>`;
        }).join('')}
      </div>`
      : '<div style="text-align:center;padding:36px 20px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px">Todavía no publicaste expensas para este edificio.</div>';

    const contenido = `
      <div style="animation:mFade .3s ease both;max-width:820px">
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Expensas</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">Subí las expensas del mes de ${esc(cur ? cur.nombre : '')}. <strong style="color:#334259">Marcos queda habilitado para compartirlas</strong> con los vecinos que las pidan por WhatsApp, o para enviarlas cuando vos se lo indiques.</p>
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:26px">
          <div style="font-size:15px;font-weight:800;margin-bottom:14px">Publicar nueva expensa</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
            <div style="flex:1;min-width:130px">
              <div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;margin-bottom:6px">Mes</div>
              <input id="exp-mes" class="inp" style="height:44px" value="${esc(new Date().toLocaleString('es-AR', { month: 'long' }))}">
            </div>
            <div style="width:110px">
              <div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;margin-bottom:6px">Año</div>
              <input id="exp-anio" class="inp" style="height:44px" value="${new Date().getFullYear()}">
            </div>
          </div>
          <div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;margin-bottom:6px">Formato</div>
          <div style="display:flex;gap:9px;margin-bottom:16px;flex-wrap:wrap">
            <button data-exp-btn onclick="elegirFormatoExp(this,'pdf')" style="height:40px;padding:0 16px;border:1px solid #17408B;border-radius:10px;background:#17408B;color:#fff;font-weight:700;font-size:13.5px;cursor:pointer">📄 PDF</button>
            <button data-exp-btn onclick="elegirFormatoExp(this,'imagen')" style="height:40px;padding:0 16px;border:1px solid #DDE3EE;border-radius:10px;background:#fff;color:#64748B;font-weight:700;font-size:13.5px;cursor:pointer">🖼️ Imagen</button>
            <button data-exp-btn onclick="elegirFormatoExp(this,'link')" style="height:40px;padding:0 16px;border:1px solid #DDE3EE;border-radius:10px;background:#fff;color:#64748B;font-weight:700;font-size:13.5px;cursor:pointer">🔗 Link web</button>
          </div>
          <div id="exp-link-wrap" style="display:none">
            <div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;margin-bottom:6px">Dirección web</div>
            <input id="exp-url" placeholder="https://..." class="inp" style="margin-bottom:16px">
          </div>
          <div id="exp-file-wrap" onclick="pickExpFile()" style="display:flex;align-items:center;gap:13px;border:1.5px dashed #C9D5E8;border-radius:12px;padding:16px;background:#F7F9FC;cursor:pointer;margin-bottom:16px" class="hv-bluedash">
            <span style="width:44px;height:44px;border-radius:11px;background:#EAF1FB;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📎</span>
            <div style="flex:1">
              <div id="exp-file-nombre" style="font-size:14.5px;font-weight:700;color:#334259">Elegí el archivo</div>
              <div id="exp-file-sub" style="font-size:12.5px;color:#8595AD">Tocá para seleccionar el PDF o la imagen de las expensas</div>
            </div>
            <input id="exp-file-input" type="file" accept=".pdf,image/*" style="display:none" onchange="expFileElegido(this)">
          </div>
          <button onclick="publicarExpensa(this)" style="height:46px;padding:0 24px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-primary">Publicar para Marcos</button>
        </div>
        <div style="font-size:15px;font-weight:800;margin-bottom:12px">Expensas publicadas</div>
        ${listHtml}
      </div>`;

    res.send(shell(req, d, 'expensas', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * SUGERENCIAS (cliente)
 * =================================================================== */

router.get('/sugerencias', async (req, res) => {
  if (esDueno(req)) return res.redirect('/admin/solicitudes');
  try {
    const d = await cargarDatos(req);
    const usuario = enPreview(req) ? req.session.previewOwner : req.session.user;
    const propias = d.sugerencias.filter((s) => String(s.usuario || '').trim() === usuario).reverse();

    const stStyle = (s) => {
      const respondida = !!(s.respuesta || s.respuesta_admin) || s.estado === 'respondida';
      return respondida
        ? { label: 'Respondida', bg: '#E7F4EC', fg: '#1B7A43' }
        : { label: 'En revisión', bg: '#FBF3DE', fg: '#8A6410' };
    };

    const histHtml = propias.length ? propias.map((s) => {
      const st = stStyle(s);
      const respuesta = s.respuesta || s.respuesta_admin || '';
      return `
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:14px;padding:16px 18px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:2px">
            <div style="font-size:14.5px;color:#16233B;line-height:1.5;flex:1">${esc(s.texto || s.sugerencia || '')}</div>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:${st.bg};color:${st.fg};flex-shrink:0">${st.label}</span>
          </div>
          <div style="font-size:12px;color:#9AA7BD;margin-bottom:10px">Enviada el ${esc(s.fecha || '')}</div>
          ${respuesta ? `
            <div style="display:flex;gap:10px;background:#F1F5FB;border-radius:11px;padding:12px 14px">
              <span style="width:28px;height:28px;border-radius:50%;background:linear-gradient(140deg,#17408B,#2E6FC0);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0">D</span>
              <div>
                <div style="font-size:12px;font-weight:700;color:#2E6FC0;margin-bottom:2px">Respuesta del administrador</div>
                <div style="font-size:13.5px;color:#334259;line-height:1.5">${esc(respuesta)}</div>
              </div>
            </div>` : ''}
        </div>`;
    }).join('') : '<div style="text-align:center;padding:30px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px">Todavía no enviaste ninguna sugerencia.</div>';

    const contenido = `
      <div style="animation:mFade .3s ease both;max-width:720px">
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Sugerencias</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">¿Se te ocurre algo para mejorar la atención de tu edificio? Escribile a tu administrador. Te responde por acá.</p>
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px 20px;margin-bottom:22px">
          <textarea id="sug-input" placeholder="Ej: Sería útil recibir un aviso antes de los cortes de agua programados..." class="inp" style="min-height:96px"></textarea>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
            <span style="font-size:13px;color:#9AA7BD">Sobre ${esc(d.curBuilding ? d.curBuilding.nombre : '')}</span>
            <button onclick="enviarSugerencia(this)" style="height:42px;padding:0 22px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">Enviar sugerencia</button>
          </div>
        </div>
        <div style="font-size:14px;font-weight:800;color:#334259;margin-bottom:12px">Historial</div>
        <div style="display:flex;flex-direction:column;gap:12px">${histHtml}</div>
      </div>`;

    res.send(shell(req, d, 'sugerencias', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * CONSUMOS (dueño) — estructura del prototipo con los datos reales que
 * existen hoy (eventos gestionados). Mensajes/minutos llegan cuando el
 * motor de Marcos empiece a loguear consumo.
 * =================================================================== */

router.get('/consumos', async (req, res) => {
  if (!esDueno(req)) return res.redirect('/admin');
  try {
    const d = await cargarDatos(req);
    const cards = d.edificios.map((e) => {
      const ev = d.eventos.filter((x) => x.edificio === e.nombre).length;
      const cliente = (d.clientes.find((c) => c.edificios.includes(e.nombre)) || {}).nombre || 'Sin asignar';
      const plan = PLAN_STYLE(e.plan);
      return `
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px 20px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
            <div>
              <div style="font-size:16px;font-weight:800;letter-spacing:-.01em">${esc(e.nombre)}</div>
              <div style="font-size:12.5px;color:#8595AD">${esc(cliente)} · ${esc(e.tipo || 'Edificio')}${e.unidades ? ' · ' + esc(e.unidades) + ' un.' : ''} · Plan ${esc(e.plan)}</div>
            </div>
            <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:#E7F4EC;color:#1B7A43">Dentro del plan</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:13.5px;color:#334259;padding:8px 0;border-top:1px solid #F1F4F9;margin-top:8px">
            <span>🧾 Eventos gestionados</span>
            <span style="font-weight:800">${ev}</span>
          </div>
        </div>`;
    }).join('');

    const contenido = `
      <div style="animation:mFade .3s ease both">
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Consumos y facturación</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">Uso real de cada edificio contra su plan contratado. Los que exceden el plan base generan un excedente facturable.</p>
        <div style="display:flex;align-items:center;gap:16px;background:#101F32;border-radius:16px;padding:18px 22px;color:#fff;margin-bottom:22px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px">
            <div style="font-size:13px;color:rgba(255,255,255,.7);font-weight:600">Excedente facturable del mes</div>
            <div style="font-size:28px;font-weight:800;letter-spacing:-.02em">$0</div>
          </div>
          <div style="border-left:1px solid rgba(255,255,255,.15);padding-left:20px">
            <div style="font-size:13px;color:rgba(255,255,255,.7);font-weight:600">Edificios que exceden</div>
            <div style="font-size:28px;font-weight:800">0</div>
          </div>
        </div>
        ${cards}
      </div>`;

    res.send(shell(req, d, 'consumos', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * CLIENTES Y EDIFICIOS (dueño)
 * =================================================================== */

router.get('/clientes', async (req, res) => {
  if (!esDueno(req)) return res.redirect('/admin');
  try {
    const d = await cargarDatos(req);
    const vista = req.query.vista === 'todos' ? 'todos' : 'cliente';
    const clienteSel = req.query.cliente ? d.clientes.find((c) => c.usuario === req.query.cliente) : null;

    const tabBtn = (activo) => activo
      ? 'border:1px solid #17408B;background:#17408B;color:#fff'
      : 'border:1px solid #E1E7F1;background:#fff;color:#475569';

    const encabezado = `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px">
        <div>
          <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Clientes y edificios</h1>
          <p style="color:#64748B;font-size:15px;margin:0">Entrá por administrador para ver y editar sus edificios, o mirá todos juntos.</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/admin/clientes" style="display:inline-flex;align-items:center;height:38px;padding:0 15px;${tabBtn(vista === 'cliente')};border-radius:10px;font-weight:700;font-size:13.5px">Por cliente</a>
          <a href="/admin/clientes?vista=todos" style="display:inline-flex;align-items:center;height:38px;padding:0 15px;${tabBtn(vista === 'todos')};border-radius:10px;font-weight:700;font-size:13.5px">Todos los edificios</a>
        </div>
      </div>`;

    const filaEdificioHtml = (e, mostrarCliente) => {
      const plan = PLAN_STYLE(e.plan);
      const cliente = (d.clientes.find((c) => c.edificios.includes(e.nombre)) || {}).nombre || 'Sin asignar';
      return `
        <div style="display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #E7ECF3;border-radius:14px;padding:15px 18px;flex-wrap:wrap">
          <span style="width:44px;height:44px;border-radius:11px;background:#EAF1FB;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🏢</span>
          <div style="min-width:170px;flex:1">
            <div style="font-size:15.5px;font-weight:800">${esc(e.nombre)}</div>
            <div style="font-size:12.5px;color:#8595AD">${esc(e.direccion || e.nombre)}${e.zona ? ' · ' + esc(e.zona) : ''}</div>
          </div>
          ${mostrarCliente ? `
          <div style="min-width:130px">
            <div style="font-size:11px;color:#8595AD;font-weight:700;text-transform:uppercase">Cliente</div>
            <div style="font-size:13.5px;font-weight:700">${esc(cliente)}</div>
          </div>` : ''}
          <div style="min-width:90px">
            <div style="font-size:11px;color:#8595AD;font-weight:700;text-transform:uppercase">Unidades</div>
            <div style="font-size:13.5px;font-weight:700">${esc(e.unidades || '—')}</div>
          </div>
          <div style="min-width:130px">
            <div style="font-size:11px;color:#8595AD;font-weight:700;text-transform:uppercase">Encargado</div>
            <div style="font-size:13.5px;font-weight:700">${esc(e.encargado || '—')}</div>
          </div>
          <span style="font-size:12px;font-weight:800;padding:5px 12px;border-radius:999px;background:${plan.bg};color:${plan.fg}">Plan ${esc(e.plan)}</span>
          <button onclick="abrirEditar(${e._row},'${escJs(e.nombre)}','${escJs(e.encargado)}','${escJs(e.plan)}')" style="height:38px;padding:0 16px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:13px;cursor:pointer" class="hv-soft">Editar</button>
        </div>`;
    };

    let cuerpo = '';
    if (vista === 'todos') {
      cuerpo = `<div style="display:flex;flex-direction:column;gap:12px">${d.edificios.map((e) => filaEdificioHtml(e, true)).join('')}</div>`;
    } else if (clienteSel) {
      const mis = d.edificios.filter((e) => clienteSel.edificios.includes(e.nombre));
      const unidades = mis.reduce((a, e) => a + (Number(e.unidades) || 0), 0);
      cuerpo = `
        <a href="/admin/clientes" style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid #E1E7F1;border-radius:9px;background:#fff;color:#5A6B85;font-weight:700;font-size:13px;margin-bottom:16px" class="hv-soft">← Clientes</a>
        <div style="display:flex;align-items:center;gap:14px;background:linear-gradient(120deg,#0F326A,#2E6FC0);border-radius:16px;padding:18px 22px;color:#fff;margin-bottom:18px;flex-wrap:wrap">
          <span style="width:52px;height:52px;border-radius:13px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;flex-shrink:0">${esc(clienteSel.nombre.charAt(0).toUpperCase())}</span>
          <div style="flex:1;min-width:180px">
            <div style="font-size:20px;font-weight:800;letter-spacing:-.01em">${esc(clienteSel.nombre)}</div>
            <div style="font-size:13.5px;color:rgba(255,255,255,.82)">${mis.length} edificio${mis.length === 1 ? '' : 's'}${unidades ? ' · ' + unidades + ' unidades' : ''}</div>
          </div>
          <button onclick="abrirModal('modal-edificio')" style="height:40px;padding:0 18px;border:none;border-radius:11px;background:#fff;color:#17408B;font-weight:700;font-size:14px;cursor:pointer">+ Agregar edificio</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${mis.length ? mis.map((e) => filaEdificioHtml(e, false)).join('') : '<div style="text-align:center;padding:30px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px">Este cliente todavía no tiene edificios asignados.</div>'}
        </div>`;
    } else {
      const cards = d.clientes.map((c) => {
        const mis = d.edificios.filter((e) => c.edificios.includes(e.nombre));
        const unidades = mis.reduce((a, e) => a + (Number(e.unidades) || 0), 0);
        const plus = mis.filter((e) => e.plan === 'Plus').length;
        const base = mis.length - plus;
        const planMix = ((plus ? plus + ' Plus' : '') + (plus && base ? ' · ' : '') + (base ? base + ' Base' : '')) || 'Sin edificios';
        return `
          <a href="/admin/clientes?cliente=${encodeURIComponent(c.usuario)}" style="display:block;text-align:left;background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px" class="hv-card">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
              <span style="width:46px;height:46px;border-radius:12px;background:linear-gradient(140deg,#17408B,#2E6FC0);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;flex-shrink:0">${esc(c.nombre.charAt(0).toUpperCase())}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:16px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.nombre)}</div>
                <div style="font-size:12.5px;color:#8595AD">${mis.length} edificios · ${unidades} un.</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:12.5px;font-weight:700;color:#5A6B85;background:#EEF2F8;padding:4px 11px;border-radius:999px">${esc(planMix)}</span>
              <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:#E7F4EC;color:#1B7A43">Al día</span>
            </div>
          </a>`;
      }).join('');
      cuerpo = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:16px">${cards}</div>
        <button onclick="abrirModal('modal-cliente')" style="height:44px;padding:0 20px;border:1.5px dashed #C9D5E8;border-radius:12px;background:#F7F9FC;color:#2E6FC0;font-weight:700;font-size:14px;cursor:pointer" class="hv-bluedash">+ Agregar cliente</button>`;
    }

    const modalCliente = `
      <div id="modal-cliente" class="modal-overlay" onclick="cerrarModal('modal-cliente')">
        <div class="modal-box" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Nuevo cliente</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Alta de administrador</div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre del administrador</div>
            <input id="cli-nombre" placeholder="Ej: González Administraciones" class="inp" style="margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Usuario de acceso</div>
            <input id="cli-usuario" placeholder="gonzalez_admin" class="inp" style="margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Contraseña temporal</div>
            <input id="cli-pass" placeholder="clave temporal" class="inp" style="margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email <span style="font-weight:500;color:#9AA7BD">(opcional)</span></div>
            <input id="cli-email" placeholder="contacto@administrador.com" class="inp">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-cliente')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="crearCliente(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Crear cliente</button>
          </div>
        </div>
      </div>`;

    const modalEdificio = clienteSel ? `
      <div id="modal-edificio" class="modal-overlay" onclick="cerrarModal('modal-edificio')">
        <div class="modal-box" style="width:480px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Nuevo edificio · ${esc(clienteSel.nombre)}</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Alta de consorcio</div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre del consorcio</div>
            <input id="ed-nombre" placeholder="Ej: Av. Corrientes 3000" class="inp" style="margin-bottom:14px">
            <div style="display:flex;gap:12px;margin-bottom:14px">
              <div style="flex:1.5">
                <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Dirección</div>
                <input id="ed-direccion" placeholder="Calle y número" class="inp">
              </div>
              <div style="width:100px">
                <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Unidades</div>
                <input id="ed-unidades" placeholder="0" class="inp">
              </div>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:16px">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Zona</div>
                <input id="ed-zona" placeholder="Barrio, ciudad" class="inp">
              </div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Encargado</div>
                <input id="ed-encargado" placeholder="Nombre" class="inp">
              </div>
            </div>
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Plan contratado</div>
            <div style="display:flex;gap:9px">
              <button data-plan-btn onclick="elegirPlanNuevo(this,'Base')" style="flex:1;height:44px;border:1.5px solid #2E6FC0;border-radius:11px;background:#EAF1FB;color:#17408B;font-weight:700;font-size:14px;cursor:pointer">Base</button>
              <button data-plan-btn onclick="elegirPlanNuevo(this,'Plus')" style="flex:1;height:44px;border:1.5px solid #DDE3EE;border-radius:11px;background:#fff;color:#64748B;font-weight:700;font-size:14px;cursor:pointer">Plus</button>
            </div>
            <input type="hidden" id="ed-plan" value="Base">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-edificio')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="crearEdificio(this,'${escJs(clienteSel.usuario)}')" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Agregar edificio</button>
          </div>
        </div>
      </div>` : '';

    const modalEditar = `
      <div id="modal-editar" class="modal-overlay" onclick="cerrarModal('modal-editar')">
        <div class="modal-box" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Editar ficha · directo</div>
            <div id="edit-bname" style="font-size:19px;font-weight:800;letter-spacing:-.01em"></div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre del consorcio</div>
            <input id="edit-nombre" class="inp" style="margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Encargado</div>
            <input id="edit-encargado" class="inp" style="margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Plan contratado</div>
            <div style="display:flex;gap:9px">
              <button data-editplan-btn="Base" onclick="elegirPlanEditar(this,'Base')" style="flex:1;height:44px;border:1.5px solid #DDE3EE;border-radius:11px;background:#fff;color:#64748B;font-weight:700;font-size:14px;cursor:pointer">Base</button>
              <button data-editplan-btn="Plus" onclick="elegirPlanEditar(this,'Plus')" style="flex:1;height:44px;border:1.5px solid #DDE3EE;border-radius:11px;background:#fff;color:#64748B;font-weight:700;font-size:14px;cursor:pointer">Plus</button>
            </div>
            <input type="hidden" id="edit-plan" value="Base">
            <div style="display:flex;align-items:flex-start;gap:9px;background:#EAF1FB;border-radius:10px;padding:10px 13px;margin-top:16px;font-size:12.5px;color:#2C55A8;line-height:1.4">
              <span style="font-size:15px">⚡</span>
              <span>Como dueño, este cambio se escribe <strong>directo</strong> en la planilla, sin pasar por aprobación.</span>
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-editar')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarEditar(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Guardar cambios</button>
          </div>
        </div>
      </div>`;

    const contenido = `
      <div style="animation:mFade .3s ease both">${encabezado}${cuerpo}</div>
      ${modalCliente}${modalEdificio}${modalEditar}`;

    res.send(shell(req, d, 'edificios', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

// Ruta legacy: la edicion es via modal en /admin/clientes.
router.get('/edificios', (req, res) => res.redirect('/admin/clientes?vista=todos'));

/* ===================================================================
 * SOLICITUDES (dueño)
 * =================================================================== */

router.get('/solicitudes', async (req, res) => {
  if (!esDueno(req)) return res.redirect('/admin/sugerencias');
  try {
    const d = await cargarDatos(req);
    const pend = d.solicitudes.filter((s) => !s.estado || s.estado === 'pendiente').reverse();
    const sugPend = d.sugerencias.filter((s) => (!s.estado || s.estado === 'pendiente') && !(s.respuesta || s.respuesta_admin)).reverse();

    const clienteDe = (usuario) => (d.clientes.find((c) => c.usuario === usuario) || {}).nombre || usuario || '';

    const solHtml = pend.length ? pend.map((s) => `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:14px;padding:16px 18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#EEF2F8;color:#5A6B85">🏢 ${esc(s.edificio || '')}</span>
          <span style="font-size:13px;color:#8595AD">${esc(clienteDe(s.usuario))} · ${esc(s.fecha || '')}</span>
        </div>
        <div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;margin-bottom:6px">${esc(FICHA_LABELS[s.campo] || s.campo || '')}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <span style="font-size:14.5px;color:#94A3B8;text-decoration:line-through">${esc(s.valor_actual || '—')}</span>
          <span style="color:#2E6FC0;font-weight:800">→</span>
          <span style="font-size:14.5px;font-weight:800;color:#16233B">${esc(s.valor_nuevo || '')}</span>
        </div>
        ${s.motivo ? `<div style="font-size:13px;color:#5A6B85;background:#F7F9FC;border-radius:9px;padding:9px 12px;margin-bottom:14px">💬 ${esc(s.motivo)}</div>` : ''}
        <div style="display:flex;gap:10px">
          <button onclick="aprobarSolicitud(this,${s._row})" style="height:40px;padding:0 20px;border:none;border-radius:10px;background:#16A34A;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-green">✓ Aprobar y aplicar</button>
          <button onclick="rechazarSolicitud(this,${s._row})" style="height:40px;padding:0 18px;border:1px solid #E3B4B0;border-radius:10px;background:#fff;color:#C0392B;font-weight:700;font-size:14px;cursor:pointer" class="hv-red">Rechazar</button>
        </div>
      </div>`).join('') : '<div style="text-align:center;padding:26px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px;margin-bottom:28px">No hay pedidos de cambio pendientes.</div>';

    const sugHtml = sugPend.length ? sugPend.map((s) => `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:14px;padding:16px 18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#EEF2F8;color:#5A6B85">🏢 ${esc(s.edificio || '')}</span>
          <span style="font-size:13px;color:#8595AD">${esc(clienteDe(s.usuario))} · ${esc(s.fecha || '')}</span>
        </div>
        <div style="font-size:14.5px;color:#16233B;line-height:1.5;margin-bottom:12px">${esc(s.texto || s.sugerencia || '')}</div>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <input placeholder="Escribí tu respuesta al cliente..." class="inp" style="flex:1;height:44px">
          <button onclick="responderSugerencia(this,${s._row})" style="height:44px;padding:0 20px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer;flex-shrink:0" class="hv-primary">Responder</button>
        </div>
      </div>`).join('') : '<div style="text-align:center;padding:26px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px">No hay sugerencias sin responder.</div>';

    const contenido = `
      <div style="animation:mFade .3s ease both;max-width:820px">
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Solicitudes</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 22px">Pedidos de cambio y sugerencias que mandaron tus clientes. Nada se aplica hasta que vos lo aprobás.</p>
        <div style="font-size:15px;font-weight:800;margin-bottom:12px;display:flex;align-items:center;gap:8px">📥 Pedidos de cambio <span style="font-size:12px;font-weight:700;color:#8595AD">(${pend.length})</span></div>
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:28px">${solHtml}</div>
        <div style="font-size:15px;font-weight:800;margin-bottom:12px;display:flex;align-items:center;gap:8px">💡 Sugerencias para responder</div>
        <div style="display:flex;flex-direction:column;gap:12px">${sugHtml}</div>
      </div>`;

    res.send(shell(req, d, 'solicitudes', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * ESCRITURA EN SHEETS (helpers)
 * =================================================================== */

async function findOrPlanColumn(tabName, candidateKeys) {
  const { rawHeaders, headers } = await readTab(tabName);
  for (let i = 0; i < headers.length; i++) {
    if (candidateKeys.includes(headers[i])) {
      return { col: columnLetter(i + 1), index: i, rawHeaders, headers };
    }
  }
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
  await writeCell(tabName, col, 1, name);
}

async function ensureSheetExists(tabName) {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existe = (meta.data.sheets || []).some((s) => s.properties && s.properties.title === tabName);
  if (existe) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
}

async function appendRow(tabName, rowData) {
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!1:1`,
    });
  } catch (_) {
    await ensureSheetExists(tabName);
    res = null;
  }
  const existingHeaders = (res && res.data && res.data.values && res.data.values[0]) || [];
  if (existingHeaders.length === 0) {
    const headers = Object.keys(rowData);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers, headers.map((k) => rowData[k] || '')] },
    });
    return;
  }
  const values = existingHeaders.map((h) => {
    const key = normalizeKey(h);
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
 * APIs (POST)
 * =================================================================== */

// Nota de feedback del dueño sobre un evento (Marcos aprende).
router.post('/api/feedback', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row, nota } = req.body || {};
    if (!row || isNaN(Number(row))) return res.status(400).json({ error: 'Fila invalida' });
    const plan = await findOrPlanColumn(TAB_EVENTOS, ['feedback', 'nota_admin', 'aprendizaje', 'comentario_admin']);
    if (plan.create) await ensureHeader(TAB_EVENTOS, plan.col, 'feedback', false);
    await writeCell(TAB_EVENTOS, plan.col, Number(row), nota || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Edicion directa de la ficha de un edificio (dueño, modal).
const EDIFICIO_FIELDS = {
  nombre: ['edificio', 'nombre', 'consorcio'],
  direccion: ['direccion', 'domicilio'],
  zona: ['zona', 'barrio'],
  encargado: ['encargado', 'portero', 'sereno'],
  tel_encargado: ['telefono_encargado', 'tel_encargado', 'celular_encargado'],
  encargado_estado: ['encargado_estado', 'estado_encargado'],
  encargado_suplente: ['encargado_suplente', 'suplente', 'personal_limpieza'],
  tel_seguridad: ['telefono_seguridad', 'tel_seguridad', 'seguridad'],
  administrador: ['admin_nombre', 'administrador', 'admin'],
  telefonos: ['admin_telefono', 'telefonos', 'contactos', 'numeros'],
  cuit: ['cuit'],
  horario_sum: ['horario_sum', 'sum'],
  cocheras: ['cocheras', 'cochera'],
  notas: ['notas_especiales', 'notas', 'observaciones', 'comentarios'],
  aliases: ['aliases', 'alias', 'otros_nombres'],
  unidades: ['unidades', 'unidad', 'departamentos'],
  plan: ['plan'],
};

router.post('/api/edificio', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const body = req.body || {};
    const row = Number(body.row);
    if (!row || isNaN(row)) return res.status(400).json({ error: 'Fila invalida' });
    const { headers } = await readTab(TAB_EDIFICIOS);
    let workingHeaders = headers.slice();
    for (const field of Object.keys(EDIFICIO_FIELDS)) {
      if (body[field] === undefined) continue;
      const candidates = EDIFICIO_FIELDS[field];
      let idx = workingHeaders.findIndex((h) => candidates.includes(h));
      let col;
      if (idx >= 0) col = columnLetter(idx + 1);
      else {
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

// Alta de cliente (dueño). Los edificios se asignan despues, desde la ficha.
router.post('/api/clientes', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { nombre, usuario, pass, email } = req.body || {};
    if (!nombre || !usuario || !pass) return res.status(400).json({ error: 'Nombre, usuario y contraseña son obligatorios' });
    const { rows } = await readTab(TAB_CLIENTES);
    if (rows.map(mapCliente).some((c) => c.usuario === usuario)) return res.status(400).json({ error: 'Ese usuario ya existe' });
    await appendRow(TAB_CLIENTES, {
      nombre, usuario, contrasena: pass, email: email || '',
      edificios: '', activo: 'si',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Alta de edificio (dueño desde la ficha del cliente, o el propio cliente).
router.post('/api/edificio-nuevo', async (req, res) => {
  const dueno = esDueno(req);
  const esConsorcio = vistaCliente(req);
  if (!dueno && !esConsorcio) return res.status(403).json({ error: 'Sin permiso' });
  if (!dueno && bloquearSiPreview(req, res)) return;
  try {
    const { nombre, direccion, zona, unidades, encargado, plan } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del consorcio' });
    const clienteUsuario = dueno ? req.body.clienteUsuario : req.session.user;
    const { rows: edRows } = await readTab(TAB_EDIFICIOS);
    if (edRows.map(mapEdificio).some((e) => e.nombre.toLowerCase() === String(nombre).toLowerCase())) {
      return res.status(400).json({ error: 'Ya existe un edificio con ese nombre' });
    }
    await appendRow(TAB_EDIFICIOS, {
      edificio: nombre, direccion: direccion || '', zona: zona || '',
      unidades: unidades || '', encargado: encargado || '', plan: plan || 'Base',
    });
    if (clienteUsuario) {
      const { rows: cliRows } = await readTab(TAB_CLIENTES);
      const cliente = cliRows.map(mapCliente).find((c) => c.usuario === clienteUsuario);
      if (cliente) {
        const nuevaLista = [...cliente.edificios, nombre].join(', ');
        const col = await findOrPlanColumn(TAB_CLIENTES, ['edificios', 'edificio']);
        if (col.create) await ensureHeader(TAB_CLIENTES, col.col, 'edificios', false);
        await writeCell(TAB_CLIENTES, col.col, cliente._row, nuevaLista);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Sugerencia del cliente.
router.post('/api/sugerencia', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { texto } = req.body || {};
    if (!texto || !texto.trim()) return res.status(400).json({ error: 'Texto vacío' });
    const usuario = req.session.user;
    const edificios = (edificiosPermitidos(req) || []).join(', ');
    await appendRow(TAB_SUGERENCIAS, {
      fecha: new Date().toLocaleString('es-AR'),
      usuario, edificio: edificios,
      texto: texto.trim(), estado: 'pendiente', respuesta: '',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Pedido de cambio del cliente (queda pendiente).
router.post('/api/solicitar-cambio', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { campo, valorActual, valorNuevo, motivo, edificio } = req.body || {};
    if (!campo || !valorNuevo) return res.status(400).json({ error: 'Datos incompletos' });
    const usuario = req.session.user;
    const permitidos = edificiosPermitidos(req) || [];
    const ed = edificio && permitidos.includes(edificio) ? edificio : (permitidos[0] || '');
    await appendRow(TAB_SOLICITUDES, {
      fecha: new Date().toLocaleString('es-AR'),
      usuario, edificio: ed, campo,
      valor_actual: valorActual || '', valor_nuevo: valorNuevo,
      motivo: motivo || '', estado: 'pendiente', motivo_rechazo: '',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Aprobar solicitud (dueño): aplica el cambio en la tab edificios.
router.post('/api/aprobar-solicitud', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    const { rows } = await readTab(TAB_SOLICITUDES);
    const solicitud = rows.find((r) => r._row === Number(row));
    if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const { edificio, campo, valor_nuevo } = solicitud;
    const { rows: edRows, headers: edHeaders } = await readTab(TAB_EDIFICIOS);
    const edRow = edRows.find((r) =>
      String(r.edificio || r.nombre || '').toLowerCase().includes(String(edificio || '').toLowerCase().split(',')[0].trim().toLowerCase())
    );
    if (edRow && campo) {
      const candidates = EDIFICIO_FIELDS[campo] || [campo];
      let colIdx = edHeaders.findIndex((h) => candidates.includes(h));
      let col;
      if (colIdx >= 0) col = columnLetter(colIdx + 1);
      else {
        col = columnLetter(edHeaders.length + 1);
        await ensureHeader(TAB_EDIFICIOS, col, candidates[0], false);
      }
      await writeCell(TAB_EDIFICIOS, col, edRow._row, valor_nuevo);
    }
    const planEstado = await findOrPlanColumn(TAB_SOLICITUDES, ['estado']);
    if (planEstado.create) await ensureHeader(TAB_SOLICITUDES, planEstado.col, 'estado', false);
    await writeCell(TAB_SOLICITUDES, planEstado.col, Number(row), 'aplicada');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

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

// Publicar expensa (cliente). El archivo en si no se sube todavia: se
// registra nombre/periodo/link para que Marcos sepa que existe y pueda
// compartir el link. El almacenamiento de PDFs es trabajo del motor.
router.post('/api/expensa', async (req, res) => {
  if (esDueno(req)) return res.status(403).json({ error: 'Solo clientes' });
  if (bloquearSiPreview(req, res)) return;
  try {
    const { mes, anio, formato, url, nombre } = req.body || {};
    if (!mes || !anio) return res.status(400).json({ error: 'Falta el período' });
    const permitidos = edificiosPermitidos(req) || [];
    const edificio = permitidos[0] || '';
    await appendRow(TAB_EXPENSAS, {
      fecha: new Date().toLocaleString('es-AR'),
      edificio,
      periodo: `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${anio}`,
      formato: formato || 'pdf',
      nombre: nombre || '',
      url: url || '',
      estado: 'publicada',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/expensa-quitar', async (req, res) => {
  if (esDueno(req)) return res.status(403).json({ error: 'Solo clientes' });
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    const plan = await findOrPlanColumn(TAB_EXPENSAS, ['estado']);
    if (plan.create) await ensureHeader(TAB_EXPENSAS, plan.col, 'estado', false);
    await writeCell(TAB_EXPENSAS, plan.col, Number(row), 'eliminada');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Campos que el CLIENTE edita directo en Mi Edificio (sin aprobacion).
// nombre/administrador NO estan aca: esos van por solicitud de cambio.
const MI_EDIFICIO_FIELDS = {
  direccion: ['direccion', 'domicilio'],
  zona: ['zona', 'barrio'],
  aliases: ['aliases', 'alias', 'otros_nombres'],
  cuit: ['cuit'],
  unidades: ['unidades', 'unidad', 'departamentos'],
  horario_sum: ['horario_sum', 'sum'],
  cocheras: ['cocheras', 'cochera'],
  tel_seguridad: ['telefono_seguridad', 'tel_seguridad', 'seguridad'],
  encargado: ['encargado', 'portero', 'sereno'],
  tel_encargado: ['telefono_encargado', 'tel_encargado', 'celular_encargado'],
  encargado_suplente: ['encargado_suplente', 'suplente', 'personal_limpieza'],
  tel_suplente: ['tel_suplente', 'telefono_suplente'],
  encargado_estado: ['encargado_estado', 'estado_encargado'],
  encargado_horario: ['encargado_horario', 'horario_encargado'],
};

// Guarda los datos editables directo del edificio del cliente.
router.post('/api/mi-edificio', async (req, res) => {
  if (esDueno(req)) return res.status(403).json({ error: 'Solo clientes' });
  if (bloquearSiPreview(req, res)) return;
  try {
    const body = req.body || {};
    // El cliente solo puede tocar SU edificio activo.
    const permitidos = edificiosPermitidos(req) || [];
    const nombreEd = permitidos[0];
    if (!nombreEd) return res.status(400).json({ error: 'Sin edificio asignado' });

    const { rows, headers } = await readTab(TAB_EDIFICIOS);
    const edRow = rows.map(mapEdificio).find((e) => e.nombre === nombreEd);
    if (!edRow) return res.status(404).json({ error: 'Edificio no encontrado' });

    let workingHeaders = headers.slice();
    for (const field of Object.keys(MI_EDIFICIO_FIELDS)) {
      if (body[field] === undefined) continue;
      const candidates = MI_EDIFICIO_FIELDS[field];
      let idx = workingHeaders.findIndex((h) => candidates.includes(h));
      let col;
      if (idx >= 0) col = columnLetter(idx + 1);
      else {
        col = columnLetter(workingHeaders.length + 1);
        await ensureHeader(TAB_EDIFICIOS, col, candidates[0], false);
        workingHeaders.push(candidates[0]);
      }
      await writeCell(TAB_EDIFICIOS, col, edRow._row, body[field]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Agregar un proveedor al edificio del cliente.
// Usuario del cliente cuya lista de proveedores estamos tocando (soporta
// preview del dueño). Devuelve null si es el dueño real sin preview.
function clienteDeSesion(req) {
  if (enPreview(req)) return req.session.previewOwner;
  if (!esDuenoReal(req)) return req.session.user;
  return null;
}

// Agregar proveedor a la LISTA MAESTRA del cliente (se carga una vez).
router.post('/api/proveedor', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { rubro, nombre, telefono, notas } = req.body || {};
    const cliente = clienteDeSesion(req);
    if (!cliente) return res.status(400).json({ error: 'Solo clientes cargan su lista' });
    if (!nombre && !telefono) return res.status(400).json({ error: 'Cargá nombre o teléfono' });
    await appendRow(TAB_PROVEEDORES, {
      cliente,
      rubro: rubro || 'Otro',
      nombre: nombre || '',
      telefono: telefono || '',
      notas: notas || '',
      estado: 'activo',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Quitar un proveedor de la lista maestra (marca eliminado).
router.post('/api/proveedor-quitar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    const cliente = clienteDeSesion(req);
    const { rows } = await readTab(TAB_PROVEEDORES);
    const prov = rows.map(mapProveedor).find((p) => p._row === Number(row));
    if (cliente && (!prov || prov.cliente !== cliente)) {
      return res.status(403).json({ error: 'Sin permiso sobre ese proveedor' });
    }
    const plan = await findOrPlanColumn(TAB_PROVEEDORES, ['estado']);
    if (plan.create) await ensureHeader(TAB_PROVEEDORES, plan.col, 'estado', false);
    await writeCell(TAB_PROVEEDORES, plan.col, Number(row), 'eliminado');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Asignar un proveedor de la lista al edificio activo con prioridad.
router.post('/api/proveedor-asignar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { proveedor, prioridad } = req.body || {};
    const cliente = clienteDeSesion(req);
    if (!cliente) return res.status(400).json({ error: 'Solo clientes asignan proveedores' });
    const edificio = (edificiosPermitidos(req) || [])[0];
    if (!edificio) return res.status(400).json({ error: 'Sin edificio activo' });
    if (!proveedor) return res.status(400).json({ error: 'Falta el proveedor' });

    const { rows } = await readTab(TAB_PROVEEDORES);
    const m = rows.map(mapProveedor).find((p) => p.cliente === cliente && p.nombre === proveedor);
    if (!m) return res.status(404).json({ error: 'Ese proveedor no está en tu lista' });

    // Evitar duplicado del mismo proveedor en el mismo edificio.
    try {
      const { rows: aRows } = await readTab(TAB_ASIGNACIONES);
      const dup = aRows.map(mapAsignacion).some((a) => a.edificio === edificio && a.proveedor === proveedor && a.estado !== 'eliminado');
      if (dup) return res.status(400).json({ error: 'Ese proveedor ya está asignado a este edificio' });
    } catch (_) {}

    await appendRow(TAB_ASIGNACIONES, {
      cliente, edificio, proveedor,
      rubro: m.rubro, telefono: m.telefono,
      prioridad: prioridad || 'primera', estado: 'activo',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/proveedor-desasignar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    const cliente = clienteDeSesion(req);
    const { rows } = await readTab(TAB_ASIGNACIONES);
    const a = rows.map(mapAsignacion).find((x) => x._row === Number(row));
    if (cliente && (!a || a.cliente !== cliente)) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    const plan = await findOrPlanColumn(TAB_ASIGNACIONES, ['estado']);
    if (plan.create) await ensureHeader(TAB_ASIGNACIONES, plan.col, 'estado', false);
    await writeCell(TAB_ASIGNACIONES, plan.col, Number(row), 'eliminado');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * EXPORT
 * =================================================================== */

module.exports = router;
