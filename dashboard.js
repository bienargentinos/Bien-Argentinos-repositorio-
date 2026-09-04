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
const fs = require('fs');
const multer = require('multer');
const { google } = require('googleapis');

const router = express.Router();

const storageFacturas = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'almacenamiento', 'facturas');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = 'media_' + Date.now() + ext;
    cb(null, name);
  }
});
const uploadMulter = multer({
  storage: storageFacturas,
  limits: { fileSize: 20 * 1024 * 1024 }
});

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
const TAB_EVENTOS = process.env.SHEET_TAB_EVENTOS || 'EVENTOS';
const TAB_EDIFICIOS = process.env.SHEET_TAB_EDIFICIOS || 'EDIFICIOS';
const TAB_ARCHIVOS = process.env.SHEET_TAB_ARCHIVOS || 'facturas';
const TAB_SUGERENCIAS = process.env.SHEET_TAB_SUGERENCIAS || 'sugerencias';
const TAB_SOLICITUDES = process.env.SHEET_TAB_SOLICITUDES || 'solicitudes';
const TAB_CLIENTES = process.env.SHEET_TAB_CLIENTES || 'CLIENTES';
const TAB_EXPENSAS = process.env.SHEET_TAB_EXPENSAS || 'expensas';
const TAB_PROVEEDORES = process.env.SHEET_TAB_PROVEEDORES || 'proveedores';
const TAB_ASIGNACIONES = process.env.SHEET_TAB_ASIGNACIONES || 'proveedor_asignaciones';
const TAB_COLABORADORES = process.env.SHEET_TAB_COLABORADORES || 'colaboradores';
const TAB_CONFIG_PLANES = process.env.SHEET_TAB_CONFIG_PLANES || 'configuracion_planes';
const TAB_CONSEJO = process.env.SHEET_TAB_CONSEJO || 'consejo';
const TAB_VECINOS = process.env.SHEET_TAB_VECINOS || 'vecinos';
const TAB_SUSCRIPCIONES_PLANES = process.env.SHEET_TAB_SUSCRIPCIONES_PLANES || 'suscripciones_planes';
const TAB_SUSCRIPCIONES_BANCO = process.env.SHEET_TAB_SUSCRIPCIONES_BANCO || 'suscripciones_banco';

function mapVecino(r) {
  return {
    _row: r._row,
    nombre: r.nombre || '',
    edificio: r.edificio || '',
    unidad: r.unidad || r.departamento || r.depto || '',
    departamento: r.departamento || r.unidad || r.depto || '',
    telefono: r.telefono || r.tel || '',
    email: r.email || r.mail || '',
    notas: r.notas || r.observaciones || '',
    estado: r.estado || 'activo',
  };
}

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
  if (/trabajo_externo|externo/i.test(tipoRaw)) tipo = 'trabajo_externo';
  else if (/audio|voz|nota/.test(tipoRaw)) tipo = 'audio';
  else if (/llamad|call|telefono|voice/.test(tipoRaw)) tipo = 'llamada';
  else if (/imagen|foto|image/.test(tipoRaw)) tipo = 'imagen';

  const urgRaw = String(pick(r, ['urgencia', 'prioridad', 'gravedad', 'severidad'])).toLowerCase();
  let urgencia = 'baja';
  if (/alta|urgent|critic|grave|emergen/.test(urgRaw)) urgencia = 'alta';
  else if (/media|medio|moder/.test(urgRaw)) urgencia = 'media';
  else if (/baja|bajo|low|normal/.test(urgRaw)) urgencia = 'baja';
  else if (urgRaw) urgencia = 'media';

  const rawId = pick(r, ['id_evento', 'id', 'caso', 'codigo_caso', 'id_caso', 'num_caso', 'ticket']);
  let id_evento = '';
  if (rawId) {
    const sId = String(rawId).trim();
    id_evento = /^caso-/i.test(sId) ? sId.toUpperCase() : 'CASO-' + sId;
  } else if (r._row) {
    id_evento = 'CASO-' + String(r._row).padStart(4, '0');
  }

  return {
    _row: r._row,
    id_evento,
    audios_json: pick(r, ['audios_json', 'audios', 'lista_audios', 'audios_lista']),
    involucrados_json: pick(r, ['involucrados_json', 'involucrados', 'contactos_involucrados', 'involucrados_lista']),
    fecha: pick(r, ['fecha', 'fecha_hora', 'timestamp', 'fecha_y_hora', 'hora']),
    hora_fin: pick(r, ['hora_fin', 'hora_finalizacion', 'fin', 'fecha_fin', 'hora_cierre']),
    edificio: pick(r, ['edificio', 'consorcio', 'building'], 'Sin edificio'),
    direccion: pick(r, ['direccion', 'domicilio', 'address', 'direccion_edificio', 'ubicacion']),
    vecino: pick(r, ['vecino', 'nombre', 'remitente', 'contacto', 'usuario'], 'Vecino'),
    telefono: pick(r, ['telefono', 'numero', 'phone', 'celular', 'whatsapp']),
    depto: pick(r, ['depto', 'departamento']),
    unidad: pick(r, ['unidad', 'unidad_funcional']),
    tipo,
    mensaje: pick(r, ['problema', 'mensaje', 'texto', 'consulta', 'detalle', 'descripcion', 'contenido']),
    notas: pick(r, ['notas', 'notas_ia', 'transcripcion', 'resumen', 'sintesis', 'respuesta_marcos']),
    transcripcion: pick(r, ['transcripcion', 'transcripcion_vecino', 'texto_audio']),
    audio_url: pick(r, ['audio_url', 'url_audio', 'nota_voz', 'audio']),
    urgencia,
    estado: pick(r, ['estado', 'status']),
    tecnico: pick(r, ['tecnico', 'proveedor', 'tecnico_nombre', 'nombre_tecnico', 'proveedor_nombre', 'nombre_proveedor']),
    tel_tecnico: pick(r, ['tel_tecnico', 'telefono_tecnico', 'celular_tecnico', 'tecnico_telefono', 'proveedor_telefono', 'tel_proveedor', 'telefono_proveedor']),
    rubro_tecnico: pick(r, ['rubro_tecnico', 'rubro_proveedor', 'especialidad_tecnico', 'especialidad_proveedor', 'rubro', 'especialidad']),
    historial_chat_vecino: pick(r, ['historial_chat_vecino', 'chat_vecino', 'conversacion_vecino', 'historial_vecino']),
    historial_chat_proveedor: pick(r, ['historial_chat_proveedor', 'historial_proveedor', 'chat_proveedor', 'conversacion_proveedor', 'historial_tecnico', 'chat_tecnico']),
    feedback: pick(r, ['feedback', 'nota_admin', 'aprendizaje', 'comentario_admin']),
    historial_chat: pick(r, ['historial_chat', 'historial', 'chat_log', 'conversacion']),
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
    suplente_horario: pick(r, ['suplente_horario', 'horario_suplente', 'horario_limpieza']),
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
    wsp: pick(r, ['whatsapp', 'wsp', 'telefono_wsp', 'telefono']),
    notif_email: String(pick(r, ['notif_email'], 'si')).toLowerCase() !== 'no',
    notif_wsp: String(pick(r, ['notif_wsp'], 'no')).toLowerCase() === 'si',
    edificios: pick(r, ['edificios', 'edificio'])
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    activo: String(pick(r, ['activo'], 'si')).toLowerCase() !== 'no',
    ultimo_acceso: pick(r, ['ultimo_acceso']),
  };
}

/**
 * De qué cliente es un edificio, según la lista `edificios` de la tab CLIENTES.
 *
 * POR QUÉ NO ALCANZA CON `.includes(nombre)`. La lista del cliente y el nombre del edificio son
 * dos textos escritos a mano en pestañas distintas, y `Array.includes` exige que sean idénticos
 * carácter por carácter. Una mayúscula, un espacio de más o un acento distinto y el panel muestra
 * "Sin asignar" un edificio que en la planilla figura clarísimo al lado del administrador.
 *
 * Pasó con "san patricio 270": Alejandra lo tenía asignado en CLIENTES y el panel lo mostraba
 * suelto, sin forma de arreglarlo desde la pantalla.
 *
 * La comparación es EXACTA después de normalizar (mayúsculas, acentos, espacios). No se usa
 * `compararEdificios`, que acepta coincidencias parciales: con eso "san patricio 159" quedaría
 * asignado al cliente que tiene el 270, y eso es mostrarle a un administrador los reclamos de
 * un consorcio ajeno.
 */
/**
 * Misma normalización que la función `marcos_norm` de PostgreSQL, para poder decidir del lado de
 * Node exactamente igual que decide la base.
 */
function normEdificio(txt) {
  return String(txt || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase()
    .trim();
}

function clienteDelEdificio(clientes, nombreEdificio) {
  const n = normEdificio(nombreEdificio);
  if (!n) return null;
  return (clientes || []).find((c) =>
    (c.edificios || []).some((e) => normEdificio(e) === n)
  ) || null;
}

// Los edificios de un cliente, con la misma comparación normalizada de `clienteDelEdificio`.
// Sin esto, la ficha del administrador le mostraba 2 edificios cuando tenía 3: el que estaba
// escrito con una mayúscula distinta simplemente no aparecía.
function edificiosDeCliente(edificios, cliente) {
  const suyos = new Set((cliente?.edificios || []).map(normEdificio).filter(Boolean));
  return (edificios || []).filter((e) => suyos.has(normEdificio(e.nombre)));
}

function mapColaborador(r) {
  return {
    _row: r._row,
    nombre: pick(r, ['nombre', 'name'], 'Sin nombre'),
    usuario: pick(r, ['usuario', 'user']),
    pass: pick(r, ['contrasena', 'password', 'pass', 'clave']),
    email: pick(r, ['email', 'mail']),
    rol: pick(r, ['rol', 'role'], 'colaborador'),
    activo: String(pick(r, ['activo'], 'si')).toLowerCase() !== 'no',
    fecha_alta: pick(r, ['fecha_alta', 'timestamp'], new Date().toLocaleDateString('es-AR'))
  };
}

async function obtenerConfiguracionPlanes() {
  try {
    const { rows } = await readTab(TAB_CONFIG_PLANES);
    if (rows && rows.length > 0) {
      const r = rows[0];
      return {
        base_msgs: Number(pick(r, ['base_msgs', 'mensajes_base'], 300)) || 300,
        plus_msgs: Number(pick(r, ['plus_msgs', 'mensajes_plus'], 1000)) || 1000,
        base_calls: Number(pick(r, ['base_calls', 'llamadas_base'], 200)) || 200,
        plus_calls: Number(pick(r, ['plus_calls', 'llamadas_plus'], 500)) || 500,
        base_edificios: Number(pick(r, ['base_edificios', 'edificios_base'], 5)) || 5,
        plus_edificios: Number(pick(r, ['plus_edificios', 'edificios_plus'], 20)) || 20,
        ia_admin_activa: String(pick(r, ['ia_admin_activa', 'ia_activa'], 'si')).toLowerCase() !== 'no'
      };
    }
  } catch (e) {}
  return {
    base_msgs: 300,
    plus_msgs: 1000,
    base_calls: 200,
    plus_calls: 500,
    base_edificios: 5,
    plus_edificios: 20,
    ia_admin_activa: true
  };
}

async function obtenerPlanesSuscripcion() {
  const defaultPlanes = [
    { _row: null, nombre: 'Free / Prueba 30 Días', precio: '0', moneda: 'ARS', edificios: '1', mensajes: '100', llamadas: '50', servicios: 'Atención 24/7 IA, Gestión de Reclamos, 1 Edificio activo', estado: 'activo' },
    { _row: null, nombre: 'Plan Base', precio: '15000', moneda: 'ARS', edificios: '1', mensajes: '300', llamadas: '200', servicios: 'Atención 24/7 IA, Panel Completo AC, Múltiples proveedores', estado: 'activo' },
    { _row: null, nombre: 'Plan Plus (Corporativo 5)', precio: '35000', moneda: 'ARS', edificios: '5', mensajes: '1000', llamadas: '500', servicios: 'Atención 24/7 IA, Urgencias prioritarias, Facturas y Fotos, Bolsón de 5 Edificios', estado: 'activo' },
    { _row: null, nombre: 'Plan Premium (Corporativo 20)', precio: '60000', moneda: 'ARS', edificios: '20', mensajes: '3000', llamadas: '1500', servicios: 'Atención 24/7 IA ilimitada, Soporte dedicado, Auditoría de expensas, Bolsón de 20 Edificios', estado: 'activo' }
  ];

  try {
    const { rows } = await readTab(TAB_SUSCRIPCIONES_PLANES);
    const sheetRows = (rows || []).map((r) => ({
      _row: r._row,
      nombre: pick(r, ['nombre', 'plan'], 'Plan sin nombre'),
      precio: pick(r, ['precio', 'monto', 'importe'], '0'),
      moneda: pick(r, ['moneda'], 'ARS'),
      edificios: pick(r, ['edificios', 'edificios_incluidos'], '1'),
      mensajes: pick(r, ['mensajes', 'mensajes_incluidos'], '300'),
      llamadas: pick(r, ['llamadas', 'llamadas_incluidas'], '200'),
      servicios: pick(r, ['servicios', 'caracteristicas', 'servicios_incluidos'], ''),
      estado: pick(r, ['estado'], 'activo')
    }));

    if (sheetRows.length === 0) {
      return defaultPlanes;
    }

    const activeSheetPlanes = sheetRows.filter((r) => r.estado !== 'eliminado');
    const sheetPlanNames = new Set(sheetRows.map(r => String(r.nombre || '').toLowerCase().trim()));
    const missingDefaults = defaultPlanes.filter(p => !sheetPlanNames.has(String(p.nombre || '').toLowerCase().trim()));

    const resultado = [...activeSheetPlanes, ...missingDefaults];
    return resultado.length > 0 ? resultado : defaultPlanes;
  } catch (e) {
    return defaultPlanes;
  }
}

async function obtenerDatosBancarios() {
  try {
    const { rows } = await readTab(TAB_SUSCRIPCIONES_BANCO);
    if (rows && rows.length > 0) {
      const r = rows[0];
      return {
        _row: r._row,
        titular: pick(r, ['titular', 'razon_social', 'nombre'], 'Bien Argentinos S.A.'),
        cuit: pick(r, ['cuit', 'cuil'], '30-71654321-9'),
        banco: pick(r, ['banco', 'entidad'], 'Banco Galicia'),
        cbu: pick(r, ['cbu', 'cvu'], '0070123420000012345678'),
        alias: pick(r, ['alias'], 'MARCOS.AI.PAGOS'),
        tipo: pick(r, ['tipo', 'tipo_cuenta'], 'Cuenta Corriente en Pesos'),
        notas: pick(r, ['notas', 'instrucciones'], 'Enviar el comprobante de transferencia al WhatsApp de atención con el nombre de tu administración.')
      };
    }
  } catch (e) {}

  return {
    _row: null,
    titular: 'Bien Argentinos S.A.',
    cuit: '30-71654321-9',
    banco: 'Banco Galicia',
    cbu: '0070123420000012345678',
    alias: 'MARCOS.AI.PAGOS',
    tipo: 'Cuenta Corriente en Pesos',
    notas: 'Enviar el comprobante de transferencia al WhatsApp de atención con el nombre de tu administración.'
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
  const estRaw = String(pick(r, ['estado'], '')).toLowerCase().trim();
  const estado = estRaw === 'eliminado' ? 'eliminado' : (estRaw || 'activo');
  return {
    _row: r._row,
    cliente: pick(r, ['cliente', 'usuario', 'owner']),
    edificio: pick(r, ['edificio', 'consorcio']),
    proveedor: pick(r, ['proveedor', 'nombre']),
    rubro: pick(r, ['rubro', 'especialidad'], 'Otro'),
    telefono: pick(r, ['telefono', 'tel']),
    prioridad: pick(r, ['prioridad'], 'primera'),
    estado: estado,
  };
}

function mapConsejo(r) {
  const estRaw = String(pick(r, ['estado'], '')).toLowerCase().trim();
  const estado = estRaw === 'eliminado' ? 'eliminado' : (estRaw || 'activo');
  return {
    _row: r._row,
    cliente: pick(r, ['cliente', 'usuario', 'owner']),
    edificio: pick(r, ['edificio', 'consorcio']),
    nombre: pick(r, ['nombre', 'miembro', 'integrante']),
    cargo: pick(r, ['cargo', 'rol', 'puesto'], 'Integrante'),
    unidad: pick(r, ['unidad', 'depto', 'piso']),
    telefono: pick(r, ['telefono', 'tel', 'celular']),
    email: pick(r, ['email', 'mail']),
    notas: pick(r, ['notas', 'observaciones']),
    estado: estado,
  };
}

// Rubros sugeridos (el cliente puede escribir otro).
const RUBROS_PROVEEDOR = ['Plomero', 'Gasista', 'Electricista', 'Ascensores', 'Cerrajero', 'Pintor', 'Limpieza', 'Seguridad', 'Otro'];
const PRIORIDADES = [
  { key: 'primera', label: '1ra opción', bg: '#E7F4EC', fg: '#1B7A43' },
  { key: 'segunda', label: '2da opción', bg: '#EAF1FB', fg: '#2C55A8' },
  { key: 'urgencia', label: 'Solo Urgencias', bg: '#FEF2F2', fg: '#991B1B' },
  { key: 'primera_urgencia', label: '1ra Opción + Urgencias', bg: '#DCFCE7', fg: '#166534' },
  { key: 'segunda_urgencia', label: '2da Opción + Urgencias', bg: '#FEF3C7', fg: '#92400E' },
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
  const s = String(str).trim();

  // Formato Marcos: "26/4/2026, 2:54:45" o "26/4/2026, 2:54:45\u00a0a.\u00a0m."
  // Tambien soporta: "5/7/2026" sin hora
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?)?/);
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    const dd = new Date(
      Number(yr), Number(m[2]) - 1, Number(m[1]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
    );
    if (!isNaN(dd.getTime())) return dd;
  }

  // Fallback ISO u otros formatos que JS entiende nativamente
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;

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

function esDe24Horas(date) {
  if (!date) return false;
  const hace24hs = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return date >= hace24hs;
}

// Considera "nuevo" a cualquier evento de los ultimos 7 dias.
// Esto evita que los contadores/badges den 0 cuando no hay eventos HOY.
function esReciente(date) {
  if (!date) return false;
  const hace7dias = new Date();
  hace7dias.setDate(hace7dias.getDate() - 7);
  hace7dias.setHours(0, 0, 0, 0);
  return date >= hace7dias;
}

function fechaCorta(date) {
  if (!date) return '';
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeEdificio(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['"’`]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compararEdificios(a, b) {
  const na = normalizeEdificio(a);
  const nb = normalizeEdificio(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function dibujarConsumoHtml(nombre, plan, eventos, opts = {}) {
  const planSt = PLAN_STYLE(plan);
  const isPlus = String(plan || '').toLowerCase().includes('plus');
  const isPremium = String(plan || '').toLowerCase().includes('premium');
  const limitMsgs = isPremium ? 3000 : (isPlus ? 1000 : 300);
  const limitCalls = isPremium ? 1500 : (isPlus ? 500 : 200);

  // Conteo real por tipo de canal
  const arr = Array.isArray(eventos) ? eventos : [];
  const msgsUsed = Math.min(limitMsgs, arr.filter((e) => e.tipo !== 'llamada').length);
  const callsUsed = Math.min(limitCalls, arr.filter((e) => e.tipo === 'llamada').length);

  const pctMsgs = Math.min(100, Math.round((msgsUsed / limitMsgs) * 100));
  const pctCalls = Math.min(100, Math.round((callsUsed / limitCalls) * 100));

  const planNombreVisible = plan || 'Base';

  return `
    <div style="display:flex;flex-direction:column;gap:13px" class="box-consumo-plan">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px;flex-wrap:wrap">
        <span class="plan-badge ${getPlanClass(planNombreVisible)}">Plan: ${esc(planNombreVisible)}</span>
        ${opts.esAc ? `
        <button onclick="abrirModalPlanesAc('${escJs(nombre)}')" style="font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:8px;border:1px solid #DCE4F0;background:#fff;color:#2E6FC0;cursor:pointer" class="hv-soft">💳 Cambiar plan</button>
        ` : ''}
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;font-weight:700;color:#475569;margin-bottom:6px" class="txt-consumo-label">
          <span>💬 Mensajes de WhatsApp</span>
          <span style="color:#1E293B" class="txt-consumo-num">${msgsUsed} <span style="color:#94A3B8;font-weight:500">/ ${limitMsgs}</span></span>
        </div>
        <div style="width:100%;height:8px;background:#EEF2F6;border-radius:999px;overflow:hidden" class="bar-consumo-track">
          <div style="width:${pctMsgs}%;height:100%;background:#2E6FC0;border-radius:999px"></div>
        </div>
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;font-weight:700;color:#475569;margin-bottom:6px" class="txt-consumo-label">
          <span>📞 Llamadas telefónicas</span>
          <span style="color:#1E293B" class="txt-consumo-num">${callsUsed} <span style="color:#94A3B8;font-weight:500">/ ${limitCalls}</span></span>
        </div>
        <div style="width:100%;height:8px;background:#EEF2F6;border-radius:999px;overflow:hidden" class="bar-consumo-track">
          <div style="width:${pctCalls}%;height:100%;background:#B45309;border-radius:999px"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:13.5px;color:#1E293B;padding-top:10px;border-top:1px solid #F1F5F9;margin-top:2px" class="div-consumo-border">
        <span style="font-weight:700;color:#475569" class="txt-consumo-label">🧾 Eventos gestionados</span>
        <span style="font-weight:800;color:#0F172A" class="txt-consumo-num">${arr.length}</span>
      </div>
    </div>`;
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
  if (activo && propios.some(p => normEdificio(p) === normEdificio(activo))) return [activo];
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
  if (enPreview(req) && !esDuenoReal(req)) {
    res.status(403).json({ error: 'Vista previa: solo lectura' });
    return true;
  }
  return false;
}

router.use(require('./rutas-accesos')({ esDueno, edificiosPermitidos, bloquearSiPreview }));

/* ===================================================================
 * CATEGORIAS / CANAL / ESTADO (identicos al prototipo)
 * =================================================================== */

const CATEGORIAS_EVENTO = {
  reclamo: { label: 'Reclamo', icon: '🔧', bg: '#FDECEC' },
  reserva: { label: 'Reserva', icon: '📅', bg: '#EAF3EC' },
  seguridad: { label: 'Seguridad', icon: '📹', bg: '#EDEEFB' },
  mensaje: { label: 'Aviso', icon: '💬', bg: '#EAF1FB' },
  mantenimiento: { label: 'Mantenimiento', icon: '🧰', bg: '#FBF3DE' },
  trabajo_externo: { label: 'Trabajo externo', icon: '🧾', bg: '#FEF3C7' },
};

function clasificarEvento(e) {
  if (e.tipo === 'trabajo_externo' || /trabajo_externo|externo/i.test(e.tipo || '')) return 'trabajo_externo';
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

const PLAN_STYLE = (p) => {
  const norm = String(p || '').toLowerCase();
  if (norm.includes('plus')) return { bg: '#EDE9FB', fg: '#6D28D9' };
  if (norm.includes('premium')) return { bg: '#FEF3C7', fg: '#B45309' };
  if (norm.includes('free') || norm.includes('prueba')) return { bg: '#F3F4F6', fg: '#4B5563' };
  return { bg: '#EAF1FB', fg: '#17408B' };
};

function getPlanClass(planName) {
  const norm = String(planName || '').toLowerCase();
  if (norm.includes('plus')) return 'plan-plus';
  if (norm.includes('premium')) return 'plan-premium';
  if (norm.includes('free') || norm.includes('prueba')) return 'plan-free';
  return 'plan-base';
}

function getRubroClass(r) {
  const norm = String(r || '').toLowerCase().trim();
  if (['plomero', 'gasista', 'electricista', 'ascensores', 'cerrajero', 'pintor', 'limpieza', 'seguridad', 'otro'].includes(norm)) {
    return 'rubro-' + norm;
  }
  return 'rubro-otro';
}


// Etiquetas de campos de la ficha (para solicitudes de cambio).
const FICHA_LABELS = {
  nombre: 'Consorcio', direccion: 'Dirección', telefonos: 'Tel. administración',
  administrador: 'Administrador', cuit: 'CUIT del edificio',
  encargado: 'Encargado', tel_encargado: 'Tel. encargado',
  horario_sum: 'Horario SUM', cocheras: 'Cocheras',
  suplente_horario: 'Horario suplente/limpieza', plan: 'Plan Contratado',
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

// esc() + neutraliza saltos de linea y escapa comillas simples de forma segura (para onclick="fn('...')").
function escJs(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/\r\n|\r|\n/g, ' ');
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Modal de alta de edificio, compartido entre "Clientes y edificios" (dueño)
// y "Mi Edificio" (cliente) — completo, para que el edificio quede armado
// desde el alta y no como una ficha vacía para llenar después.
function modalAltaEdificioHtml(eyebrow, clienteUsuario, planesList) {
  const list = (planesList && planesList.length) ? planesList : [
    { nombre: 'Plan Base', precio: '15000' },
    { nombre: 'Plan Plus', precio: '35000' },
    { nombre: 'Plan Plus (Corporativo 5)', precio: '35000', edificios: '5' },
    { nombre: 'Plan Premium (Corporativo 20)', precio: '60000', edificios: '20' }
  ];
  const optionsHtml = list.map((p) => {
    const isCorp = Number(p.edificios) > 1 || String(p.nombre).toLowerCase().includes('corporativo');
    const labelExtra = isCorp ? ` · Paquete (${p.edificios || 5} edificios)` : (Number(p.precio) > 0 ? ' ($' + Number(p.precio).toLocaleString('es-AR') + '/mes)' : '');
    return `<option value="${esc(p.nombre)}">${esc(p.nombre)}${labelExtra}</option>`;
  }).join('');

  const campo = (id, labelTxt, placeholder, extra) => `
    <div${extra || ''}>
      <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">${labelTxt}</div>
      <input id="${id}" placeholder="${esc(placeholder || '')}" class="inp">
    </div>`;
  return `
      <div id="modal-edificio" class="modal-overlay" onclick="cerrarModal('modal-edificio')">
        <div class="modal-box" style="width:560px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">${esc(eyebrow)}</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Alta de consorcio</div>
          </div>
          <div style="padding:20px 24px;max-height:60vh;overflow-y:auto">
            ${campo('ed-nombre', 'Nombre del consorcio', 'Ej: Av. Corrientes 3000', ' style="margin-bottom:14px"')}
            <div style="display:flex;gap:12px;margin-bottom:14px">
              ${campo('ed-direccion', 'Dirección', 'Calle y número (legal)', ' style="flex:1.5"')}
              ${campo('ed-unidades', 'Unidades', '0', ' style="width:100px"')}
            </div>
            <div style="display:flex;gap:12px;margin-bottom:14px">
              ${campo('ed-zona', 'Zona / barrio', 'Barrio, ciudad', ' style="flex:1"')}
              ${campo('ed-cuit', 'CUIT del edificio', '30-XXXXXXXX-X', ' style="flex:1"')}
            </div>
            ${campo('ed-aliases', 'Alias / doble dirección', 'Ej: Ortiz 1486 (como lo conocen los vecinos)', ' style="margin-bottom:14px"')}
            <div style="display:flex;gap:12px;margin-bottom:14px">
              ${campo('ed-horario-sum', 'Horario del SUM', 'Ej: 10 a 24hs · seña $15.000', ' style="flex:1"')}
              ${campo('ed-cocheras', 'Cocheras', 'Ej: 22 fijas + 4 de cortesía', ' style="flex:1"')}
            </div>
            ${campo('ed-tel-seguridad', 'Tel. seguridad de la entrada', 'Si el edificio tiene', ' style="margin-bottom:14px"')}
            <div style="font-size:13px;font-weight:800;color:#334259;margin-bottom:8px">Encargado</div>
            <div style="display:flex;gap:12px;margin-bottom:14px">
              ${campo('ed-encargado', 'Nombre', 'Nombre y apellido', ' style="flex:1"')}
              ${campo('ed-tel-encargado', 'Teléfono', 'Teléfono', ' style="flex:1"')}
            </div>
            <div style="display:flex;gap:12px;margin-bottom:16px">
              ${campo('ed-suplente', 'Suplente / limpieza', 'Quién lo cubre', ' style="flex:1"')}
              ${campo('ed-tel-suplente', 'Tel. suplente', 'Teléfono', ' style="flex:1"')}
            </div>
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Plan contratado</div>
            <select id="ed-plan" class="inp">
              ${optionsHtml}
            </select>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-edificio')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="crearEdificio(this${clienteUsuario ? `,'${escJs(clienteUsuario)}'` : ''})" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Agregar edificio</button>
          </div>
        </div>
      </div>`;
}

function modalPlanesAcHtml(planesList, propiosEdificios) {
  const planes = (planesList && planesList.length) ? planesList : [
    { nombre: 'Free / Prueba 30 Días', precio: '0', moneda: 'ARS', edificios: '1', mensajes: '100', llamadas: '50', servicios: 'Atención 24/7 IA, Gestión de Reclamos, 1 Edificio activo' },
    { nombre: 'Plan Base', precio: '15000', moneda: 'ARS', edificios: '1', mensajes: '300', llamadas: '200', servicios: 'Atención 24/7 IA, Panel Completo AC, Múltiples proveedores' },
    { nombre: 'Plan Plus (Corporativo 5)', precio: '35000', moneda: 'ARS', edificios: '5', mensajes: '1000', llamadas: '500', servicios: 'Atención 24/7 IA, Urgencias prioritarias, Facturas y Fotos, Bolsón de 5 Edificios' },
    { nombre: 'Plan Premium (Corporativo 20)', precio: '60000', moneda: 'ARS', edificios: '20', mensajes: '3000', llamadas: '1500', servicios: 'Atención 24/7 IA ilimitada, Soporte dedicado, Auditoría de expensas, Bolsón de 20 Edificios' }
  ];

  const edificiosJsonStr = escJs(JSON.stringify((propiosEdificios || []).map(x => ({ nombre: x.nombre, direccion: x.direccion, plan: x.plan }))));

  const cardsHtml = planes.map((p) => {
    const pStyle = PLAN_STYLE(p.nombre);
    const precioFmt = Number(p.precio) > 0 ? (p.moneda === 'USD' ? 'USD $' + p.precio : '$' + Number(p.precio).toLocaleString('es-AR')) : 'GRATIS / PRUEBA 30 DÍAS';
    const esCorporativo = Number(p.edificios) > 1;
    const cantEdificios = esCorporativo ? `Paquete Corporativo (${p.edificios} Edificios)` : 'Por Edificio Individual';
    const servList = (p.servicios || '').split(/,|\n/).map((s) => s.trim()).filter(Boolean);
    const servHtml = servList.map((s) => `<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:#334259;margin-bottom:5px"><span style="color:#22C55E">✓</span> ${esc(s)}</div>`).join('');

    const pNorm = normEdificio(p.nombre);
    const yaTienePlan = (propiosEdificios || []).some((x) => {
      const xNorm = normEdificio(x.plan);
      if (!xNorm) return false;
      return xNorm.includes(pNorm);
    });

    let btnTextCorp = `🏢 Solicitar Paquete Corporativo (${p.edificios} Edificios)`;
    if (esCorporativo && yaTienePlan) {
      btnTextCorp = `⚙️ Gestionar / Adherir Edificios (${p.edificios} Cupos)`;
    }

    const botonSolicitudHtml = esCorporativo
      ? `<button onclick="abrirSolicitudCorporativa('${escJs(p.nombre)}', ${Number(p.edificios) || 5}, '${edificiosJsonStr}')" style="width:100%;height:40px;border:none;border-radius:10px;background:${yaTienePlan ? 'linear-gradient(180deg,#1E5FB4,#17408B)' : 'linear-gradient(180deg,#2E6FC0,#1E5FB4)'};color:#fff;font-weight:700;font-size:13.5px;cursor:pointer" class="hv-primary">${esc(btnTextCorp)}</button>`
      : `<button onclick="solicitarPlanCat('${escJs(p.nombre)}', 'este')" style="width:100%;height:40px;border:none;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:13.5px;cursor:pointer" class="hv-primary">Solicitar para este edificio</button>`;

    return `
      <div style="background:#fff;border:1.5px solid #E7ECF3;border-radius:16px;padding:20px;display:flex;flex-direction:column;box-shadow:0 4px 12px rgba(16,35,59,.04)" class="hv-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span class="plan-badge ${getPlanClass(p.nombre)}">${esc(p.nombre)}</span>
          <span style="font-size:11.5px;font-weight:700;color:#2E6FC0;background:#EAF1FB;padding:3px 9px;border-radius:999px">${esc(cantEdificios)}</span>
        </div>
        <div style="font-size:24px;font-weight:800;letter-spacing:-.02em;color:#16233B;margin-bottom:4px">${precioFmt}</div>
        <div style="font-size:12px;color:#8595AD;margin-bottom:14px">Hasta ${esc(p.mensajes)} msgs 24/7 · ${esc(p.llamadas)} llamadas/mes</div>
        
        <div style="font-size:12.5px;font-weight:700;color:#16233B;margin-bottom:6px">Servicios del plan:</div>
        <div style="flex:1;margin-bottom:16px">${servHtml}</div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:auto;padding-top:12px;border-top:1px solid #EEF2F8">
          ${botonSolicitudHtml}
        </div>
      </div>`;
  }).join('');

  return `
    <div id="modal-planes-ac" class="modal-overlay" onclick="cerrarModal('modal-planes-ac')">
      <div class="modal-box" style="width:720px;max-width:94vw;max-height:88vh;overflow-y:auto" onclick="stopEv(event)">
        <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Catálogo de Planes y Suscripciones</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">💳 Solicitar Cambio de Plan</div>
          </div>
          <button onclick="cerrarModal('modal-planes-ac')" style="border:none;background:none;font-size:22px;cursor:pointer;color:#8595AD">✕</button>
        </div>
        <div style="padding:22px">
          <p style="font-size:13.5px;color:#64748B;margin:0 0 18px">Elegí el plan que mejor se adapte a tus edificios. Podés solicitar un plan para un edificio en particular o un paquete corporativo para administrar todos tus consorcios juntos.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">${cardsHtml}</div>
        </div>
      </div>
    </div>

    <!-- MODAL DE ASIGNACION DE EDIFICIOS POR CHECKBOXES PARA PAQUETES CORPORATIVOS -->
    <div id="modal-solicitud-corporativa" class="modal-overlay" onclick="cerrarModal('modal-solicitud-corporativa')">
      <div class="modal-box" style="width:580px;max-width:94vw;max-height:88vh;overflow-y:auto" onclick="stopEv(event)">
        <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Paquete Corporativo</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em" id="corp-modal-titulo">🏛️ Seleccioná los Edificios del Paquete</div>
          </div>
          <button onclick="cerrarModal('modal-solicitud-corporativa')" style="border:none;background:none;font-size:22px;cursor:pointer;color:#8595AD">✕</button>
        </div>
        <div style="padding:22px">
          <div style="background:#EAF1FB;border:1px solid #C9D5E8;border-radius:14px;padding:14px 16px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-size:12px;font-weight:800;color:#17408B;text-transform:uppercase;letter-spacing:.04em">Cupos del Plan</div>
              <div style="font-size:16px;font-weight:800;color:#0F326A" id="corp-plan-nombre">Plan Plus (5 Edificios)</div>
            </div>
            <div style="text-align:right">
              <span style="font-size:12px;font-weight:700;color:#5A6B85">Asignados:</span>
              <span style="font-size:18px;font-weight:800;color:#2E6FC0;margin-left:4px" id="corp-counter">0 / 5</span>
            </div>
          </div>

          <p style="font-size:13.5px;color:#64748B;margin:0 0 14px">Tildá los edificios que estarán cubiertos por este paquete corporativo. Los edificios que queden sin tildar permanecerán en su Plan Individual por separado.</p>

          <div id="corp-edificios-checklist" style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;max-height:300px;overflow-y:auto;padding-right:4px">
            <!-- Lista de edificios del cliente con checkboxes -->
          </div>

          <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Observaciones / Nota al administrador (opcional)</div>
          <textarea id="corp-motivo" class="inp" style="height:70px;margin-bottom:18px" placeholder="Ej: Solicitamos pasar nuestros consorcios principales al paquete corporativo..."></textarea>

          <div style="display:flex;gap:12px">
            <button onclick="cerrarModal('modal-solicitud-corporativa')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="enviarSolicitudCorporativa(this)" style="flex:1.4;height:44px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">🚀 Enviar Solicitud de Paquete</button>
          </div>
        </div>
      </div>
    </div>`;
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
.ev-urgente { background: #FEF2F2 !important; border-left: 4px solid #EF4444 !important; }
.ev-urgente:hover { background: #FDE8E8 !important; }
.ev-resuelto { background: #F0FDF4 !important; border-left: 4px solid #16A34A !important; }
.ev-resuelto:hover { background: #DCFCE7 !important; }
.ev-nuevo { border-left: 4px solid #2E6FC0 !important; }
.ev-normal { border-left: 4px solid transparent !important; }
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
/* Responsive Mobile Adjustments & Mobile Navigation Bar */
.mobile-bottom-nav {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 62px;
  background: #ffffff;
  border-top: 1px solid #E4E9F1;
  z-index: 55;
  box-shadow: 0 -4px 20px rgba(16, 35, 59, 0.12);
  justify-content: space-around;
  align-items: center;
  padding: 0 4px;
}
.mobile-bottom-nav a {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: 100%;
  color: #64748B;
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
  gap: 3px;
  transition: color 0.15s ease;
}
.mobile-bottom-nav a .nav-icon {
  font-size: 19px;
  line-height: 1;
}
.mobile-bottom-nav a.active {
  color: #2E6FC0;
}
.dark-theme .mobile-bottom-nav {
  background: #151F38 !important;
  border-top-color: #2A3A5E !important;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4) !important;
}
.dark-theme .mobile-bottom-nav a {
  color: #94A3B8 !important;
}
.dark-theme .mobile-bottom-nav a.active {
  color: #38BDF8 !important;
}

@media (max-width: 980px) {
  .resgrid, .fichagrid { grid-template-columns: 1fr !important; }
}

@media (max-width: 900px) {
  .sidebar-nav { display: none !important; }
  .username { display: none !important; }
  .mobile-bottom-nav { display: flex !important; }
  main { padding: 18px 14px 90px !important; }
  header { padding: 0 12px !important; gap: 8px !important; }
  header button.hv-selbtn { max-width: 170px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
  div[style*="grid-template-columns:1.55fr 1fr"],
  div[style*="grid-template-columns:1fr 1fr"],
  div[style*="grid-template-columns: 1.55fr 1fr"],
  div[style*="grid-template-columns: 1fr 1fr"] {
    grid-template-columns: 1fr !important;
  }
  .modal-overlay { padding: 12px !important; }
  .modal-box { width: 100% !important; max-width: 96vw !important; margin: 0 auto !important; border-radius: 16px !important; }
}

@media (max-width: 600px) {
  h1 { font-size: 22px !important; }
  h2 { font-size: 20px !important; }
  header { height: 58px !important; }
  .login-shell { padding: 20px 12px !important; display: flex !important; align-items: center !important; justify-content: center !important; }
  form[action="/admin/login"] { width: 100% !important; max-width: 100% !important; padding: 20px 16px !important; }
  .drawer-panel { width: 100% !important; max-width: 100vw !important; border-radius: 0 !important; }
  .drawer-overlay.open { padding: 0 !important; }
  button, .inp, select, a.hv-selbtn { min-height: 40px; }
}

/* Modo Oscuro / Dark Theme (High-Contrast & Ultra-Legible) */
/* Archivo de Comprobantes / Facturas y Fotos - Dark Theme High Contrast */
.dark-theme .factura-card-metric {
  background: #151F38 !important;
  border-color: #2A3A5E !important;
  box-shadow: none !important;
}
.dark-theme .factura-card-metric .metric-title {
  color: #94A3B8 !important;
}
.dark-theme .factura-card-metric .metric-value {
  color: #F8FAFC !important;
}
.dark-theme #tot-pendiente {
  color: #F59E0B !important;
}
.dark-theme #facturas-titulo-edificio,
.dark-theme .factura-grupo-titulo {
  color: #F8FAFC !important;
}
.dark-theme .row-item-hover {
  background: #151F38 !important;
  border-color: #2A3A5E !important;
  box-shadow: none !important;
}
.dark-theme .row-item-hover:hover {
  background: #1E2C4F !important;
  border-color: #2E6FC0 !important;
}
.dark-theme .factura-concepto-title,
.dark-theme .factura-proveedor-title,
.dark-theme .factura-monto-title {
  color: #F8FAFC !important;
}
.dark-theme .factura-meta-text,
.dark-theme .factura-meta-text span:not(.factura-badge-edificio):not(.factura-badge-tipo) {
  color: #94A3B8 !important;
}
.dark-theme .factura-badge-edificio {
  background: #1E293B !important;
  color: #60A5FA !important;
  border-color: #3B82F6 !important;
}
.dark-theme .factura-badge-tipo,
.dark-theme .factura-badge-count {
  background: #1E293B !important;
  color: #94A3B8 !important;
  border-color: #334155 !important;
}
.dark-theme .factura-badge-caso {
  background: #062C19 !important;
  color: #4ADE80 !important;
  border-color: #14532D !important;
}
.dark-theme .factura-badge-nocaso {
  background: #1E293B !important;
  color: #94A3B8 !important;
  border-color: #334155 !important;
}
.dark-theme .factura-badge-dir {
  background: #0C4A6E !important;
  color: #38BDF8 !important;
  border-color: #0369A1 !important;
}
.dark-theme .factura-badge-dir-warn {
  background: #451A03 !important;
  color: #FDBA74 !important;
  border-color: #9A3412 !important;
}
.dark-theme .btn-factura-sec {
  background: #1E293B !important;
  color: #CBD5E1 !important;
  border-color: #334155 !important;
}
.dark-theme .btn-factura-sec:hover {
  background: #2563EB !important;
  color: #FFFFFF !important;
  border-color: #3B82F6 !important;
}
.dark-theme .btn-factura-sec i {
  color: #CBD5E1 !important;
}
.dark-theme .btn-factura-sec:hover i {
  color: #FFFFFF !important;
}
.dark-theme .input-factura-search {
  background: #151F38 !important;
  color: #F8FAFC !important;
  border-color: #2A3A5E !important;
}
.dark-theme .input-factura-search::placeholder {
  color: #64748B !important;
}
.dark-theme .popover-facturas-menu {
  background: #1E293B !important;
  border-color: #334155 !important;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
}
.dark-theme .popover-item-btn {
  color: #CBD5E1 !important;
}
.dark-theme .popover-item-btn:hover {
  background: #334155 !important;
  color: #FFFFFF !important;
}

/* OVERLAYS / BACKDROPS: Proteger overlay contra :hover azul sólido en Modo Oscuro */
.drawer-overlay,
.modal-overlay,
#drawer-overlay,
.dark-theme .drawer-overlay,
.dark-theme .modal-overlay,
.dark-theme #drawer-overlay,
.dark-theme .drawer-overlay:hover,
.dark-theme .modal-overlay:hover,
.dark-theme #drawer-overlay:hover,
.dark-theme div[onclick].drawer-overlay:hover,
.dark-theme div[onclick].modal-overlay:hover,
.dark-theme div[style*="cursor"].drawer-overlay:hover,
.dark-theme div[style*="cursor"].modal-overlay:hover {
  background: rgba(11, 19, 43, 0.70) !important;
  backdrop-filter: blur(3px) !important;
  -webkit-backdrop-filter: blur(3px) !important;
  border: none !important;
  box-shadow: none !important;
}

/* Event Cards y Feeds */
.dark-theme .hv-row { background:#151F38 !important; border-bottom-color:#2A3A5E !important; color:#F1F5F9 !important; }
.dark-theme .hv-row span:not([style*="background"]) { color:#F1F5F9 !important; }
.dark-theme .hv-row span[style*="color:#16233B"] { color:#FFFFFF !important; }
.dark-theme .hv-row span[style*="color:#5A6B85"], .dark-theme .hv-row span[style*="color:#64748B"] { color:#CBD5E1 !important; }
.dark-theme .hv-row span[style*="color:#9AA7BD"] { color:#94A3B8 !important; }

/* Drawer Panel lateral de eventos */
.drawer-grid-card { background:#fff; border:1px solid #E7ECF3; border-radius:12px; padding:11px 13px; }
.drawer-notes-box { background:linear-gradient(120deg,#EAF1FB,#F3F7FD); border:1px solid #D8E5F6; border-radius:12px; padding:14px 16px; font-size:14.5px; color:#1E3A6B; line-height:1.6; white-space:pre-wrap; }
.drawer-audio-box { background:#F1F5FB; border:1px solid #D8E5F6; border-radius:12px; padding:13px 16px; margin-bottom:16px; }
.drawer-atendio-box { display:flex; align-items:center; gap:11px; background:#fff; border:1px solid #E7ECF3; border-radius:12px; padding:11px 14px; margin-bottom:18px; }

.dark-theme .drawer-panel { background:#0B132B !important; color:#F1F5F9 !important; border-left:1px solid #2A3A5E !important; }
.dark-theme .drawer-panel div, .dark-theme .drawer-panel p, .dark-theme .drawer-panel h1, .dark-theme .drawer-panel h2 { color:#F1F5F9 !important; }
.dark-theme .drawer-panel span:not([style*="background"]) { color:#F1F5F9 !important; }
.dark-theme .drawer-header-box { background:#151F38 !important; border-bottom:1px solid #2A3A5E !important; }
.dark-theme .drawer-header-box div[style*="color:#5A6B85"] { color:#94A3B8 !important; }
.dark-theme .drawer-header-box div[style*="color:#16233B"] { color:#FFFFFF !important; }
.dark-theme .drawer-close-btn { background:#1C2B4E !important; color:#FFFFFF !important; border:1px solid #2A3A5E !important; }
.dark-theme .drawer-icon-box { background:#1C2B4E !important; border:1px solid #2A3A5E !important; color:#FFFFFF !important; }
.dark-theme .drawer-grid-card { background:#1C2B4E !important; border-color:#2A3A5E !important; }
.dark-theme .drawer-grid-card div { color:#F1F5F9 !important; }
.dark-theme .drawer-grid-card div:first-child { color:#94A3B8 !important; }
.dark-theme .drawer-notes-box { background:#162447 !important; border-color:#2A3A5E !important; }
.dark-theme [style*="background:#EAF1FB"],
.dark-theme [style*="background: #EAF1FB"],
.dark-theme [style*="background: rgb(247, 249, 252)"],
.dark-theme [style*="background: rgb(248, 250, 253)"],
.dark-theme [style*="background: rgb(241, 245, 251)"],
.dark-theme [style*="background: rgb(238, 242, 248)"],
.dark-theme [style*="background: rgb(234, 241, 251)"] {
  background: #1E2C4F !important;
  border-color: #2A3A5E !important;
}

/* Universal: Textos oscuros en Modo Oscuro -> Texto Blanco / Gris Claro */
.dark-theme [style*="color:#16233B"],
.dark-theme [style*="color: #16233B"],
.dark-theme [style*="color:#334259"],
.dark-theme [style*="color: #334259"],
.dark-theme [style*="color:#475569"],
.dark-theme [style*="color: #475569"],
.dark-theme [style*="color:#64748B"],
.dark-theme [style*="color: #64748B"],
.dark-theme [style*="color:#5A6B85"],
.dark-theme [style*="color: #5A6B85"],
.dark-theme [style*="color:#8595AD"],
.dark-theme [style*="color: #8595AD"] {
  color: #CBD5E1 !important;
}

/* Universal: Hover para Botones, Enlaces, Filas y Tarjetas en Modo Oscuro (Previene que se pasen a blanco o modo claro) */
.dark-theme button:hover,
.dark-theme a:hover,
.dark-theme div[onclick]:hover,
.dark-theme div[style*="cursor:pointer"]:hover,
.dark-theme div[style*="cursor: pointer"]:hover,
.dark-theme a[style*="cursor:pointer"]:hover,
.dark-theme a[style*="cursor: pointer"]:hover,
.dark-theme .hv-card:hover,
.dark-theme div.hv-card:hover,
.dark-theme a.hv-card:hover,
.dark-theme .hv-white:hover,
.dark-theme .hv-soft:hover,
.dark-theme button.hv-soft:hover,
.dark-theme a.hv-soft:hover,
.dark-theme .hv-softb:hover,
.dark-theme .hv-selbtn:hover,
.dark-theme .hv-blue:hover,
.dark-theme a.hv-blue:hover,
.dark-theme .hv-bluedash:hover,
.dark-theme .hv-row:hover {
  background: #1C2B4E !important;
  border-color: #2E6FC0 !important;
  color: #FFFFFF !important;
}

/* Preservar legibilidad de Badges, Chips y Pills al hacer Hover en Tarjetas/Botones en Modo Oscuro */
.dark-theme *:hover span[style*="background:#E7F4EC"],
.dark-theme *:hover span[style*="background: #E7F4EC"],
.dark-theme *:hover .status-active,
.dark-theme *:hover .prio-primera,
.dark-theme *:hover .ev-resuelto {
  background: #062C19 !important;
  color: #4ADE80 !important;
  border-color: #14532D !important;
}

.dark-theme *:hover span[style*="background:#FBF3DE"],
.dark-theme *:hover span[style*="background: #FBF3DE"],
.dark-theme *:hover span[style*="background:#FEF3C7"],
.dark-theme *:hover span[style*="background: #FEF3C7"],
.dark-theme *:hover .rubro-gasista,
.dark-theme *:hover .rubro-electricista {
  background: #2A2415 !important;
  color: #FDE047 !important;
  border-color: #594D1A !important;
}

.dark-theme *:hover span[style*="background:#FDECEC"],
.dark-theme *:hover span[style*="background: #FDECEC"],
.dark-theme *:hover span[style*="background:#FEF2F2"],
.dark-theme *:hover span[style*="background: #FEF2F2"],
.dark-theme *:hover .status-inactive,
.dark-theme *:hover .prio-urgencia,
.dark-theme *:hover .ev-urgente {
  background: #3B1219 !important;
  color: #FCA5A5 !important;
  border-color: #7F1D1D !important;
}

.dark-theme *:hover span[style*="background:#EEF2F8"],
.dark-theme *:hover span[style*="background: #EEF2F8"],
.dark-theme *:hover span[style*="background:#EAF1FB"],
.dark-theme *:hover span[style*="background: #EAF1FB"],
.dark-theme *:hover .plan-base,
.dark-theme *:hover .rubro-plomero {
  background: #1C2B4E !important;
  color: #38BDF8 !important;
  border-color: #2E6FC0 !important;
}

.dark-theme .hv-red:hover {
  background: #7F1D1D !important;
  color: #FCA5A5 !important;
}

/* Recuadro Dorado para tarjeta de Plan Contratado en Ficha e Identidad */
.box-gold-border {
  border: 2px solid #F59E0B !important;
  box-shadow: 0 0 12px rgba(245,158,11,.25) !important;
}
.dark-theme .box-gold-border {
  background: #151F38 !important;
  border: 2px solid #F59E0B !important;
  box-shadow: 0 0 14px rgba(245,158,11,.3) !important;
}

/* Legibilidad de Métricas de Consumo del Plan en Modo Oscuro */
.dark-theme .txt-consumo-label,
.dark-theme .txt-consumo-label span {
  color: #CBD5E1 !important;
}
.dark-theme .txt-consumo-num,
.dark-theme .txt-consumo-num span:first-child {
  color: #FFFFFF !important;
}
.dark-theme .txt-consumo-num span {
  color: #94A3B8 !important;
}
.dark-theme .bar-consumo-track {
  background: rgba(255, 255, 255, 0.15) !important;
}
.dark-theme .div-consumo-border {
  border-top-color: rgba(255, 255, 255, 0.12) !important;
  color: #FFFFFF !important;
}

/* Cajas de Divisas (USD / EUR) en Modo Oscuro */
.dark-theme .box-usd,
.dark-theme div[class*="box-usd"] {
  background: #092B19 !important;
  border: 1px solid #14532D !important;
}
.dark-theme .box-usd *,
.dark-theme div[class*="box-usd"] * {
  color: #4ADE80 !important;
}

.dark-theme .box-eur,
.dark-theme div[class*="box-eur"] {
  background: #0F2942 !important;
  border: 1px solid #1E40AF !important;
}
.dark-theme .box-eur *,
.dark-theme div[class*="box-eur"] * {
  color: #60A5FA !important;
}

.dark-theme div[style*="background:#FBF3DE"],
.dark-theme div[style*="background: #FBF3DE"] {
  background: #2A2415 !important;
  border-color: #594D1A !important;
  color: #FDE047 !important;
}
.dark-theme div[style*="background:#FBF3DE"] *,
.dark-theme div[style*="background: #FBF3DE"] * {
  color: #FDE047 !important;
}

/* OVERLAYS / BACKDROPS: Proteger overlay contra :hover azul sólido en Modo Oscuro */
.drawer-overlay,
.modal-overlay,
#drawer-overlay,
.dark-theme .drawer-overlay,
.dark-theme .modal-overlay,
.dark-theme #drawer-overlay,
.dark-theme .drawer-overlay:hover,
.dark-theme .modal-overlay:hover,
.dark-theme #drawer-overlay:hover,
.dark-theme div[onclick].drawer-overlay:hover,
.dark-theme div[onclick].modal-overlay:hover,
.dark-theme div[style*="cursor"].drawer-overlay:hover,
.dark-theme div[style*="cursor"].modal-overlay:hover {
  background: rgba(11, 19, 43, 0.70) !important;
  backdrop-filter: blur(3px) !important;
  -webkit-backdrop-filter: blur(3px) !important;
  border: none !important;
  box-shadow: none !important;
}

/* Event Cards y Feeds */
.dark-theme .hv-row { background:#151F38 !important; border-bottom-color:#2A3A5E !important; color:#F1F5F9 !important; }
.dark-theme .hv-row span:not([style*="background"]) { color:#F1F5F9 !important; }
.dark-theme .hv-row span[style*="color:#16233B"] { color:#FFFFFF !important; }
.dark-theme .hv-row span[style*="color:#5A6B85"], .dark-theme .hv-row span[style*="color:#64748B"] { color:#CBD5E1 !important; }
.dark-theme .hv-row span[style*="color:#9AA7BD"] { color:#94A3B8 !important; }

/* Drawer Panel lateral de eventos */
.drawer-grid-card { background:#fff; border:1px solid #E7ECF3; border-radius:12px; padding:11px 13px; }
.drawer-notes-box { background:linear-gradient(120deg,#EAF1FB,#F3F7FD); border:1px solid #D8E5F6; border-radius:12px; padding:14px 16px; font-size:14.5px; color:#1E3A6B; line-height:1.6; white-space:pre-wrap; }
.drawer-audio-box { background:#F1F5FB; border:1px solid #D8E5F6; border-radius:12px; padding:13px 16px; margin-bottom:16px; }
.drawer-atendio-box { display:flex; align-items:center; gap:11px; background:#fff; border:1px solid #E7ECF3; border-radius:12px; padding:11px 14px; margin-bottom:18px; }

.dark-theme .drawer-panel { background:#0B132B !important; color:#F1F5F9 !important; border-left:1px solid #2A3A5E !important; }
.dark-theme .drawer-panel div, .dark-theme .drawer-panel p, .dark-theme .drawer-panel h1, .dark-theme .drawer-panel h2 { color:#F1F5F9 !important; }
.dark-theme .drawer-panel span:not([style*="background"]) { color:#F1F5F9 !important; }
.dark-theme .drawer-header-box { background:#151F38 !important; border-bottom:1px solid #2A3A5E !important; }
.dark-theme .drawer-header-box div[style*="color:#5A6B85"] { color:#94A3B8 !important; }
.dark-theme .drawer-header-box div[style*="color:#16233B"] { color:#FFFFFF !important; }
.dark-theme .drawer-close-btn { background:#1C2B4E !important; color:#FFFFFF !important; border:1px solid #2A3A5E !important; }
.dark-theme .drawer-icon-box { background:#1C2B4E !important; border:1px solid #2A3A5E !important; color:#FFFFFF !important; }
.dark-theme .drawer-grid-card { background:#1C2B4E !important; border-color:#2A3A5E !important; }
.dark-theme .drawer-grid-card div { color:#F1F5F9 !important; }
.dark-theme .drawer-grid-card div:first-child { color:#94A3B8 !important; }
.dark-theme .drawer-notes-box { background:#162447 !important; border-color:#2A3A5E !important; color:#E2E8F0 !important; }
.dark-theme .drawer-audio-box { background:#13203E !important; border-color:#23355C !important; color:#CBD5E1 !important; }
.dark-theme .drawer-atendio-box { background:#1C2B4E !important; border-color:#2A3A5E !important; }
.dark-theme .drawer-atendio-box div { color:#F1F5F9 !important; }
.dark-theme .drawer-panel div[style*="background:#FBF3DE"] { background:#2E2510 !important; border-color:#523E10 !important; }
.dark-theme .drawer-panel div[style*="background:#FBF3DE"] * { color:#FDE68A !important; }
.dark-theme .drawer-panel div[style*="background:#E7F4EC"] { background:#0B331A !important; border-color:#165B30 !important; }
.dark-theme .drawer-panel div[style*="background:#E7F4EC"] * { color:#A7F3D0 !important; }
.dark-theme .drawer-panel div[style*="background:#F1F5FB"] { background:#13203E !important; border-color:#23355C !important; }
.dark-theme .drawer-panel div[style*="background:#F1F5FB"] * { color:#CBD5E1 !important; }
.dark-theme .drawer-panel button[style*="background:#fff"],
.dark-theme .drawer-panel button[style*="background: #fff"] { background:#1C2B4E !important; border-color:#2A3A5E !important; color:#F1F5F9 !important; }
.dark-theme .drawer-panel .chat-box { background:#0D1929 !important; border-color:#1E2D4A !important; }
.dark-theme .drawer-panel .chat-bubble { border-color:#2A3A5E !important; }
.dark-theme .drawer-panel .chat-bubble[style*="background:#DCF8C6"],
.dark-theme .drawer-panel .chat-bubble[style*="background: #DCF8C6"] { background:#005C4B !important; color:#E9EDEF !important; }
.dark-theme .drawer-panel .chat-bubble[style*="background:#FFFFFF"],
.dark-theme .drawer-panel .chat-bubble[style*="background: #FFFFFF"] { background:#202C33 !important; color:#E9EDEF !important; }
.dark-theme .drawer-panel .chat-bubble[style*="background:#FEF3C7"],
.dark-theme .drawer-panel .chat-bubble[style*="background: #FEF3C7"] { background:#78350F !important; color:#FEF3C7 !important; border-color:#92400E !important; }
.dark-theme .drawer-panel .chat-bubble[style*="background:#EDE9FE"],
.dark-theme .drawer-panel .chat-bubble[style*="background: #EDE9FE"] { background:#4C1D95 !important; color:#EDE9FE !important; border-color:#5B21B6 !important; }

/* Badges / Chips en Modo Oscuro */
.dark-theme .ev-urgente { background:#3B1219 !important; border-left:4px solid #EF4444 !important; }
.dark-theme .ev-urgente:hover { background:#4A1720 !important; }
.dark-theme .ev-resuelto { background:#062C19 !important; border-left:4px solid #22C55E !important; }
.dark-theme .ev-resuelto:hover { background:#0B3D23 !important; }

/* Inputs, Textareas, Selects y Placeholders en Modo Oscuro (High Contrast) */
.dark-theme .inp,
.dark-theme input,
.dark-theme select,
.dark-theme textarea,
.dark-theme input.inp,
.dark-theme select.inp,
.dark-theme textarea.inp {
  background: #1C2B4E !important;
  border-color: #2A3A5E !important;
  color: #FFFFFF !important;
}

.dark-theme .inp:focus,
.dark-theme input:focus,
.dark-theme select:focus,
.dark-theme textarea:focus {
  background: #151F38 !important;
  border-color: #2E6FC0 !important;
  color: #FFFFFF !important;
  box-shadow: 0 0 0 3px rgba(46,111,192,.3) !important;
}

.dark-theme select option {
  background: #151F38 !important;
  color: #FFFFFF !important;
}

.dark-theme input::placeholder,
.dark-theme textarea::placeholder,
.dark-theme .inp::placeholder {
  color: #94A3B8 !important;
  opacity: 1 !important;
}

/* Textos Generales */
.dark-theme h1, .dark-theme h2, .dark-theme h3, .dark-theme h4 { color:#FFFFFF !important; }
.dark-theme p { color:#CBD5E1 !important; }

/* Protected Badges & Buttons for Light & Dark Theme (prevent contrast/visibility issues) */

/* 1. Status Badge */
.status-badge {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
  padding: 4px 12px;
  border-radius: 999px;
  display: inline-block;
}
.status-active { background: #E7F4EC; color: #1B7A43; }
.status-inactive { background: #FDECEC; color: #C0392B; }
.dark-theme .status-active { background: #062C19 !important; color: #4ADE80 !important; }
.dark-theme .status-inactive { background: #450A0A !important; color: #F87171 !important; }

/* 2. Plan Badges */
.plan-badge {
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: .02em;
  padding: 4px 10px;
  border-radius: 999px;
  display: inline-block;
}
.plan-base { background: #EAF1FB; color: #17408B; }
.plan-plus { background: #EDE9FB; color: #6D28D9; }
.plan-premium { background: #FEF3C7; color: #B45309; }
.plan-free { background: #F3F4F6; color: #4B5563; }
.dark-theme .plan-base { background: #1C2B4E !important; color: #38BDF8 !important; }
.dark-theme .plan-plus { background: #2D224D !important; color: #A78BFA !important; }
.dark-theme .plan-premium { background: #451A03 !important; color: #F59E0B !important; }
.dark-theme .plan-free { background: #1E293B !important; color: #94A3B8 !important; }

/* 3. Rubro Badges */
.rubro-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 5px 11px;
  border-radius: 999px;
  min-width: 92px;
  text-align: center;
  display: inline-block;
}
.rubro-plomero { background: #EAF1FB; color: #2E6FC0; }
.rubro-gasista { background: #FBF3DE; color: #8A6410; }
.rubro-electricista { background: #FDF3D6; color: #B25E00; }
.rubro-ascensores { background: #EDEEFB; color: #5B48B9; }
.rubro-cerrajero { background: #EEF2F8; color: #475569; }
.rubro-pintor { background: #E6F6F6; color: #0891B2; }
.rubro-limpieza { background: #FDF2F8; color: #DB2777; }
.rubro-seguridad { background: #ECFDF5; color: #059669; }
.rubro-otro { background: #EEF2F8; color: #475569; }

.dark-theme .rubro-plomero { background: #1C2B4E !important; color: #38BDF8 !important; }
.dark-theme .rubro-gasista { background: #2A2415 !important; color: #FDE047 !important; }
.dark-theme .rubro-electricista { background: #2D2310 !important; color: #F59E0B !important; }
.dark-theme .rubro-ascensores { background: #201D4B !important; color: #A78BFA !important; }
.dark-theme .rubro-cerrajero { background: #1E293B !important; color: #94A3B8 !important; }
.dark-theme .rubro-pintor { background: #152E35 !important; color: #22D3EE !important; }
.dark-theme .rubro-limpieza { background: #35152A !important; color: #F472B6 !important; }
.dark-theme .rubro-seguridad { background: #062F1E !important; color: #34D399 !important; }
.dark-theme .rubro-otro { background: #1E293B !important; color: #94A3B8 !important; }

/* 4. Priority Badges */
.prio-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  display: inline-block;
}
.prio-primera { background: #E7F4EC; color: #1B7A43; }
.prio-segunda { background: #EAF1FB; color: #2C55A8; }
.prio-urgencia { background: #FEF2F2; color: #991B1B; }
.prio-primera_urgencia { background: #DCFCE7; color: #166534; }
.prio-segunda_urgencia { background: #FEF3C7; color: #92400E; }

.dark-theme .prio-primera { background: #062C19 !important; color: #4ADE80 !important; }
.dark-theme .prio-segunda { background: #1C2B4E !important; color: #38BDF8 !important; }
.dark-theme .prio-urgencia { background: #450A0A !important; color: #F87171 !important; }
.dark-theme .prio-primera_urgencia { background: #062F1E !important; color: #34D399 !important; }
.dark-theme .prio-segunda_urgencia { background: #451A03 !important; color: #F59E0B !important; }

/* 5. Cargo Badges */
.cargo-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  display: inline-block;
}
.cargo-presidente { background: #EAF1FB; color: #2E6FC0; }
.cargo-vicepresidente { background: #EAF1FB; color: #2E6FC0; }
.cargo-vocal { background: #EEF2F8; color: #475569; }
.cargo-suplente { background: #EEF2F8; color: #475569; }
.cargo-propietariointeresado { background: #FDF3D6; color: #B25E00; }

.dark-theme .cargo-presidente { background: #1C2B4E !important; color: #38BDF8 !important; }
.dark-theme .cargo-vicepresidente { background: #1C2B4E !important; color: #38BDF8 !important; }
.dark-theme .cargo-vocal { background: #1E293B !important; color: #94A3B8 !important; }
.dark-theme .cargo-suplente { background: #1E293B !important; color: #94A3B8 !important; }
.dark-theme .cargo-propietariointeresado { background: #2D2310 !important; color: #F59E0B !important; }

/* 6. Standardized Buttons */
.btn-edit {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #DCE4F0;
  border-radius: 9px;
  background: #ffffff;
  color: #2E6FC0;
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-edit-sm {
  height: 32px;
  padding: 0 11px;
  border: 1px solid #DCE4F0;
  border-radius: 8px;
  background: #ffffff;
  color: #2E6FC0;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-remove {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #EEDCDC;
  border-radius: 9px;
  background: #ffffff;
  color: #C0392B;
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-remove-sm {
  height: 32px;
  padding: 0 11px;
  border: 1px solid #EEDCDC;
  border-radius: 8px;
  background: #ffffff;
  color: #C0392B;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-edit-plan {
  flex: 1;
  height: 38px;
  border: 1px solid #DCE4F0;
  border-radius: 10px;
  background: #ffffff;
  color: #2E6FC0;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-remove-plan {
  height: 38px;
  padding: 0 14px;
  border: 1px solid #FDECEC;
  border-radius: 10px;
  background: #FDECEC;
  color: #C0392B;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dark-theme .btn-edit,
.dark-theme .btn-edit-sm,
.dark-theme .btn-edit-plan {
  background: #1C2B4E !important;
  border-color: #2A3A5E !important;
  color: #38BDF8 !important;
}
.dark-theme .btn-edit:hover,
.dark-theme .btn-edit-sm:hover,
.dark-theme .btn-edit-plan:hover {
  background: #2E6FC0 !important;
  color: #FFFFFF !important;
}
.dark-theme .btn-remove,
.dark-theme .btn-remove-sm,
.dark-theme .btn-remove-plan {
  background: #2D1A1E !important;
  border-color: #4C1D24 !important;
  color: #F87171 !important;
}
.dark-theme .btn-remove:hover,
.dark-theme .btn-remove-sm:hover,
.dark-theme .btn-remove-plan:hover {
  background: #EF4444 !important;
  color: #FFFFFF !important;
}

/* 7. ARS Box in dark theme */
.dark-theme .box-ars,
.dark-theme div[class*="box-ars"] {
  background: #0F2942 !important;
  border: 1px solid #1E40AF !important;
}
.dark-theme .box-ars *,
.dark-theme div[class*="box-ars"] * {
  color: #60A5FA !important;
}

/* 8. Bloque de Servicios, Personal y Limpieza en Edificios (Modo Oscuro) */
.dark-theme .box-staff-section {
  background: #0F1A30 !important;
  border-color: #1E2D4A !important;
}
.dark-theme .box-staff-section h2,
.dark-theme .box-staff-section div[style*="color:#16233B"],
.dark-theme .box-staff-section div[style*="color: #16233B"] {
  color: #FBBF24 !important; /* Amarillo oro para títulos de staff/servicios */
}
.dark-theme .box-staff-section .hv-card {
  background: #15223D !important;
  border-color: #24355A !important;
}
.dark-theme .box-staff-section .hv-card div[style*="color:#16233B"],
.dark-theme .box-staff-section .hv-card div[style*="color: #16233B"] {
  color: #FFFFFF !important; /* Blanco puro para nombres */
}
.dark-theme .box-staff-section div[style*="background:#F8FAFD"],
.dark-theme .box-staff-section div[style*="background: #F8FAFD"] {
  background: #0B1426 !important;
  border-color: #1E2D4A !important;
}
.dark-theme .box-staff-section div[style*="color:#475569"],
.dark-theme .box-staff-section div[style*="color: #475569"] {
  color: #FFFFFF !important;
}

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
window.toast = toast;
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
window.escapeHtml = escapeHtml;
function cerrarModal(id){
  var m=document.getElementById(id);
  if(m) m.classList.remove('open');
}
window.cerrarModal = cerrarModal;

// --- INSTALACIONES Y ACCESOS CLIENT JS ---
window.abrirModalAccesoNuevo = function(ed) {
  var fields = ['acc-lugar', 'acc-ubicacion', 'acc-quien-abre', 'acc-tel', 'acc-tipo', 'acc-notas'];
  fields.forEach(function(f) { var el = document.getElementById(f); if (el) el.value = ''; });
  var m = document.getElementById('modal-acceso-nuevo');
  if (m) m.classList.add('open');
};

window.renderTablaAccesosClient = function(lista) {
  if (!lista || !lista.length) {
    return '<div style="text-align:center;padding:24px 16px;color:#8595AD;font-size:13.5px;font-style:italic">No hay instalaciones o accesos cargados para este edificio. Escribí una descripción arriba o usá el botón + Añadir.</div>';
  }
  var filas = lista.map(function(a) {
    var origHtml = a.origen
      ? '<span style="font-size:10px;font-weight:600;color:#64748B;background:#F1F5FB;border:1px solid #E2E8F0;padding:2px 7px;border-radius:6px;margin-left:6px" title="Origen del dato">' + escapeHtml(a.origen) + '</span>'
      : '';
    var lugarEsc = escapeHtml(a.lugar || '—');
    var ubEsc = escapeHtml(a.ubicacion || '—');
    var qaEsc = escapeHtml(a.quienAbre || a.quien_abre || '—');
    var telEsc = escapeHtml(a.telefono || '—');
    var tipoEsc = escapeHtml(a.tipoAcceso || a.tipo_acceso || '—');
    var lugarAttr = escapeHtml(a.lugar || '');

    return '<tr style="border-bottom:1px solid #EEF1F6">' +
      '<td style="padding:12px 14px;vertical-align:top">' +
        '<div style="font-size:13.5px;font-weight:800;color:#16233B;display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
          '<span>' + lugarEsc + '</span>' + origHtml +
        '</div>' +
      '</td>' +
      '<td style="padding:12px 14px;vertical-align:top;color:#334259;font-weight:600">' + ubEsc + '</td>' +
      '<td style="padding:12px 14px;vertical-align:top;color:#334259">' + qaEsc + '</td>' +
      '<td style="padding:12px 14px;vertical-align:top;color:#2E6FC0;font-weight:700">' + telEsc + '</td>' +
      '<td style="padding:12px 14px;vertical-align:top;color:#334259">' + tipoEsc + '</td>' +
      '<td style="padding:12px 14px;vertical-align:top;color:#64748B;font-size:12.5px">' + notasEsc + '</td>' +
      '<td style="padding:12px 14px;vertical-align:top;text-align:right">' +
        '<button data-lugar="' + lugarAttr + '" onclick="quitarAcceso(this.dataset.lugar)" style="font-size:12.5px;font-weight:700;color:#EF4444;background:none;border:none;cursor:pointer;padding:4px 8px" class="hv-red">Quitar</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  return '<div style="overflow-x:auto;border:1px solid #E7ECF3;border-radius:12px;background:#fff">' +
    '<table style="width:100%;border-collapse:collapse;text-align:left;font-size:13px">' +
      '<thead>' +
        '<tr style="background:#F8FAFD;border-bottom:1px solid #E7ECF3;color:#8595AD;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em">' +
          '<th style="padding:12px 14px">Lugar / Instalación</th>' +
          '<th style="padding:12px 14px">Dónde está</th>' +
          '<th style="padding:12px 14px">Quién abre</th>' +
          '<th style="padding:12px 14px">Teléfono</th>' +
          '<th style="padding:12px 14px">Tipo de acceso</th>' +
          '<th style="padding:12px 14px">Notas</th>' +
          '<th style="padding:12px 14px;text-align:right">Acción</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + filas + '</tbody>' +
    '</table>' +
  '</div>';
};

window.actualizarTablaAccesosUI = function(lista) {
  var container = document.getElementById('tabla-accesos-container');
  if (container) {
    container.innerHTML = window.renderTablaAccesosClient(lista);
  }
};

window.guardarRelatoAccesos = function(btn) {
  var txtEl = document.getElementById('accesos-relato-texto');
  var msgEl = document.getElementById('accesos-relato-msg');
  var texto = txtEl ? txtEl.value.trim() : '';
  if (!texto) {
    toast('Escribí una descripción del edificio', 'err');
    return;
  }
  var txtOrig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Analizando relato...';
  if (msgEl) msgEl.style.display = 'none';

  fetch('/admin/api/accesos-relato', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: texto })
  })
  .then(function(res){ return res.json(); })
  .then(function(data){
    btn.disabled = false;
    btn.textContent = txtOrig;
    if (data.error) {
      toast(data.error, 'err');
      return;
    }
    var cant = data.detectados || 0;
    toast('Se detectaron ' + cant + ' instalaciones', 'ok');
    if (msgEl) {
      msgEl.textContent = '✨ Se detectaron ' + cant + ' instalaciones en la descripción';
      msgEl.style.display = 'block';
    }
    if (data.accesos) window.actualizarTablaAccesosUI(data.accesos);
  })
  .catch(function(err){
    btn.disabled = false;
    btn.textContent = txtOrig;
    toast('Error de conexión', 'err');
  });
};

window.guardarAccesoNuevo = function(btn) {
  var lugar = (document.getElementById('acc-lugar') || {}).value || '';
  var ubicacion = (document.getElementById('acc-ubicacion') || {}).value || '';
  var quien_abre = (document.getElementById('acc-quien-abre') || {}).value || '';
  var telefono = (document.getElementById('acc-tel') || {}).value || '';
  var tipo_acceso = (document.getElementById('acc-tipo') || {}).value || '';
  var notas = (document.getElementById('acc-notas') || {}).value || '';

  if (!lugar.trim()) {
    toast('Ingresá el lugar de la instalación', 'err');
    return;
  }

  var txtOrig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  fetch('/admin/api/acceso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lugar: lugar.trim(),
      ubicacion: ubicacion.trim(),
      quien_abre: quien_abre.trim(),
      telefono: telefono.trim(),
      tipo_acceso: tipo_acceso.trim(),
      notas: notas.trim()
    })
  })
  .then(function(res){ return res.json(); })
  .then(function(data){
    btn.disabled = false;
    btn.textContent = txtOrig;
    if (data.error) {
      toast(data.error, 'err');
      return;
    }
    cerrarModal('modal-acceso-nuevo');
    toast('Instalación guardada', 'ok');
    if (data.accesos) window.actualizarTablaAccesosUI(data.accesos);
  })
  .catch(function(err){
    btn.disabled = false;
    btn.textContent = txtOrig;
    toast('Error al guardar instalación', 'err');
  });
};

window.quitarAcceso = function(lugar) {
  if (!lugar) return;
  if (!confirm('¿Quitar ' + lugar + ' de la lista?')) return;

  fetch('/admin/api/acceso-quitar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lugar: lugar })
  })
  .then(function(res){ return res.json(); })
  .then(function(data){
    if (data.error) {
      toast(data.error, 'err');
      return;
    }
    toast('Instalación eliminada', 'ok');
    if (data.accesos) window.actualizarTablaAccesosUI(data.accesos);
  })
  .catch(function(err){
    toast('Error al quitar instalación', 'err');
  });
};

// --- Asistente Virtual AC Widget ---
window.__aiWidgetJustDragged = false;

function posicionarChatAsistente(box, btn){
  var margen = 12;
  var boxW = box.offsetWidth || 340;
  var boxH = box.offsetHeight || 460;
  var r = btn.getBoundingClientRect();
  var espacioAbajo = window.innerHeight - r.bottom;
  var espacioArriba = r.top;
  var top = (espacioAbajo >= boxH + margen || espacioAbajo >= espacioArriba)
    ? r.bottom + margen
    : r.top - margen - boxH;
  var left = r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - boxW - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - boxH - 8));
  box.style.position = 'fixed';
  box.style.margin = '0';
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

window.toggleAsistenteWidget = function toggleAsistenteWidget(){
  if (window.__aiWidgetJustDragged) { window.__aiWidgetJustDragged = false; return; }
  var box = document.getElementById('ac-ai-chat-box');
  var btn = document.querySelector('#ac-ai-widget-container button.hv-navy');
  if(!box) return;
  var isHidden = (box.style.display === 'none' || !box.style.display);
  if (isHidden && btn) posicionarChatAsistente(box, btn);
  box.style.display = isHidden ? 'flex' : 'none';
};
var toggleAsistenteWidget = window.toggleAsistenteWidget;

// --- Arrastrar el globo flotante del Asistente ---
// --- Arrastrar el globo flotante del Asistente ---
window.initDragAsistenteWidget = function initDragAsistenteWidget(){
  var widget = document.getElementById('ac-ai-widget-container');
  if (!widget) return;
  var handle = widget.querySelector('button.hv-navy') || widget.querySelector('#ac-ai-trigger-btn') || widget.querySelector('button');
  if (!handle) return;
  if (handle.__dragInitialized) return;
  handle.__dragInitialized = true;

  var dragging = false;
  var moved = false;
  var startX = 0, startY = 0, startLeft = 0, startTop = 0;

  function clamp(val, min, max){
    return Math.max(min, Math.min(max, val));
  }

  function applyPosition(left, top){
    var w = widget.offsetWidth || 140;
    var h = widget.offsetHeight || 48;
    left = clamp(left, 8, window.innerWidth - w - 8);
    top = clamp(top, 8, window.innerHeight - h - 8);
    widget.style.left = left + 'px';
    widget.style.top = top + 'px';
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }

  function guardarPosicion(){
    try {
      var rect = widget.getBoundingClientRect();
      localStorage.setItem('marcos_ai_widget_pos', JSON.stringify({ left: rect.left, top: rect.top }));
    } catch(e){}
  }

  function onPointerMove(e){
    if (!dragging) return;
    var p = e.touches ? e.touches[0] : e;
    var dx = p.clientX - startX;
    var dy = p.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (moved && e.cancelable) e.preventDefault();
    applyPosition(startLeft + dx, startTop + dy);
  }

  function onPointerUp(){
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);
    if (moved) {
      guardarPosicion();
      window.__aiWidgetJustDragged = true;
      setTimeout(function(){ window.__aiWidgetJustDragged = false; }, 300);
    }
  }

  function onPointerDown(e){
    var p = e.touches ? e.touches[0] : e;
    dragging = true;
    moved = false;
    handle.style.cursor = 'grabbing';
    var rect = widget.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    startX = p.clientX;
    startY = p.clientY;
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  }

  handle.style.cursor = 'grab';
  handle.addEventListener('mousedown', onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: true });

  window.addEventListener('resize', function(){
    if (widget.style.left && widget.style.left !== 'auto') {
      applyPosition(parseFloat(widget.style.left), parseFloat(widget.style.top));
    }
  });

  function posicionPorDefecto(){
    var edBtn = document.querySelector('button[onclick*="menu-edificio"]') || document.querySelector('#menu-edificio-btn');
    var header = document.querySelector('header');
    
    if (edBtn) {
      var r = edBtn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        var targetLeft = r.right + 12;
        var targetTop = r.top + Math.max(0, (r.height - 38) / 2);
        if (targetLeft + 150 < window.innerWidth) {
          applyPosition(targetLeft, targetTop);
          return;
        }
      }
    }
    
    if (header) {
      var rH = header.getBoundingClientRect();
      var targetLeft = Math.min(260, window.innerWidth - 180);
      var targetTop = rH.top + Math.max(0, (rH.height - 38) / 2);
      applyPosition(targetLeft, targetTop);
      return;
    }
    
    applyPosition(240, 12);
  }

  try {
    var saved = JSON.parse(localStorage.getItem('marcos_ai_widget_pos') || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      applyPosition(saved.left, saved.top);
    } else {
      setTimeout(posicionPorDefecto, 50);
    }
  } catch(e){
    setTimeout(posicionPorDefecto, 50);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ window.initDragAsistenteWidget(); });
} else {
  setTimeout(function(){ window.initDragAsistenteWidget(); }, 50);
}
window.addEventListener('load', function(){ window.initDragAsistenteWidget(); });

window.checkAndRunFirstTimeTour = function checkAndRunFirstTimeTour(force){
  var TOUR_STEPS = [
    { sel: '[data-tour="nav-resumen"]', title: 'Resumen', desc: 'Acá tenés el pantallazo general: reclamos activos, urgencias y lo último que pasó en tus edificios.' },
    { sel: '[data-tour="nav-eventos"]', title: 'Eventos', desc: 'Todos los reclamos e incidentes reportados por los vecinos, con su estado y el detalle completo de cada caso.' },
    { sel: '[data-tour="nav-edificio"]', title: 'Mi Edificio', desc: 'Los datos de tu edificio: personal de guardia, proveedores asignados y toda la información de contacto.' },
    { sel: '[data-tour="nav-proveedores"]', title: 'Proveedores', desc: 'Tu lista de técnicos y proveedores de servicio, con sus datos de contacto y especialidad.' },
    { sel: '[data-tour="nav-facturas"]', title: 'Facturas/Fotos', desc: 'Facturas y fotos que se van adjuntando a los casos, todo organizado en un solo lugar.' },
    { sel: '[data-tour="nav-expensas"]', title: 'Expensas', desc: 'Consultá el estado de las expensas de tu edificio.' },
    { sel: '[data-tour="nav-sugerencias"]', title: 'Sugerencias', desc: 'Ideas y pedidos que dejás para mejorar el servicio.' },
    { sel: '[data-tour="nav-consumos"]', title: 'Consumos', desc: 'El consumo y la actividad de cada uno de tus edificios.' },
    { sel: '[data-tour="nav-edificios"]', title: 'Clientes', desc: 'Todos los clientes y edificios que administrás, organizados para encontrar cualquiera rápido.' },
    { sel: '[data-tour="nav-solicitudes"]', title: 'Solicitudes', desc: 'Pedidos de tus clientes pendientes de aprobación.' },
    { sel: '[data-tour="nav-suscripciones"]', title: 'Planes y Pagos', desc: 'El estado de los planes y pagos de cada cliente.' },
    { sel: '[data-tour="metrics"]', title: 'Métricas rápidas', desc: 'Un pantallazo rápido: reclamos abiertos, urgencias y edificios activos.' },
    { sel: '[data-tour="event-table"]', title: 'Últimos eventos', desc: 'Acá aparecen los eventos más recientes, a medida que Marcos los va reportando en tiempo real.' },
    { sel: '[data-tour="ai-widget"]', title: 'Asistente Virtual', desc: 'Volvé acá cuando quieras: preguntame lo que necesites sobre cómo usar el panel.' }
  ];

  var pasos = TOUR_STEPS.filter(function (p) {
    var el = document.querySelector(p.sel);
    return el && el.offsetParent !== null;
  });

  if (pasos.length === 0) {
    if (typeof toast === 'function') toast('No hay nada para recorrer en esta pantalla todavía.', 'err');
    return;
  }

  iniciarRecorridoTour(pasos);
};
var checkAndRunFirstTimeTour = window.checkAndRunFirstTimeTour;

function iniciarRecorridoTour(pasos) {
  var idx = 0;
  var overlay = document.createElement('div');
  overlay.id = 'tour-overlay-bg';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:transparent;';

  var spot = document.createElement('div');
  spot.id = 'tour-spotlight';
  spot.style.cssText = 'position:fixed;z-index:100001;border-radius:12px;box-shadow:0 0 0 9999px rgba(10,18,35,.6);transition:all .35s ease;pointer-events:none;';

  var card = document.createElement('div');
  card.id = 'tour-card';
  card.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:100002;width:320px;max-width:92vw;background:#fff;border-radius:16px;box-shadow:0 20px 50px -12px rgba(16,35,59,.45);padding:18px 20px;font-family:"Hanken Grotesk",sans-serif;';

  var stepLabel = document.createElement('div');
  stepLabel.style.cssText = 'font-size:11px;font-weight:800;color:#2E6FC0;letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;';

  var titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:15.5px;font-weight:800;color:#16233B;margin-bottom:6px;';

  var descEl = document.createElement('div');
  descEl.style.cssText = 'font-size:13.5px;color:#475569;line-height:1.5;margin-bottom:16px;';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

  var btnSaltar = document.createElement('button');
  btnSaltar.textContent = 'Saltar';
  btnSaltar.style.cssText = 'background:none;border:none;color:#94A3B8;font-weight:700;font-size:13px;cursor:pointer;padding:8px 4px;';

  var spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';

  var btnAnterior = document.createElement('button');
  btnAnterior.textContent = '← Atrás';
  btnAnterior.style.cssText = 'background:#F1F5FB;border:none;color:#17408B;font-weight:700;font-size:13px;cursor:pointer;padding:9px 14px;border-radius:9px;';

  var btnSiguiente = document.createElement('button');
  btnSiguiente.style.cssText = 'background:linear-gradient(180deg,#2E6FC0,#1E5FB4);border:none;color:#fff;font-weight:700;font-size:13px;cursor:pointer;padding:9px 16px;border-radius:9px;';

  btnRow.appendChild(btnSaltar);
  btnRow.appendChild(spacer);
  btnRow.appendChild(btnAnterior);
  btnRow.appendChild(btnSiguiente);

  card.appendChild(stepLabel);
  card.appendChild(titleEl);
  card.appendChild(descEl);
  card.appendChild(btnRow);

  document.body.appendChild(overlay);
  document.body.appendChild(spot);
  document.body.appendChild(card);

  function posicionarEnElemento(el) {
    var r = el.getBoundingClientRect();
    var pad = 8;
    spot.style.top = (r.top - pad) + 'px';
    spot.style.left = (r.left - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
  }

  function render() {
    if (idx >= pasos.length) { cerrar(); return; }
    var p = pasos[idx];
    var el = document.querySelector(p.sel);
    if (!el) { idx++; render(); return; }

    stepLabel.textContent = 'Paso ' + (idx + 1) + ' de ' + pasos.length;
    titleEl.textContent = p.title;
    descEl.textContent = p.desc;
    btnAnterior.style.visibility = idx === 0 ? 'hidden' : 'visible';
    btnSiguiente.textContent = idx === pasos.length - 1 ? 'Listo ✓' : 'Siguiente →';

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { posicionarEnElemento(el); }, 280);
  }

  function reposicionarActual() {
    var p = pasos[idx];
    if (!p) return;
    var el = document.querySelector(p.sel);
    if (el) posicionarEnElemento(el);
  }

  function cerrar() {
    window.removeEventListener('resize', reposicionarActual);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (spot.parentNode) spot.parentNode.removeChild(spot);
    if (card.parentNode) card.parentNode.removeChild(card);
  }

  btnSiguiente.onclick = function () {
    if (idx === pasos.length - 1) { cerrar(); return; }
    idx++;
    render();
  };
  btnAnterior.onclick = function () {
    if (idx === 0) return;
    idx--;
    render();
  };
  btnSaltar.onclick = cerrar;
  overlay.onclick = cerrar;

  window.addEventListener('resize', reposicionarActual);
  render();
}

window.enviarPreguntaAsistente = async function enviarPreguntaAsistente(){
  var input = document.getElementById('ac-ai-input');
  var msgs = document.getElementById('ac-ai-messages');
  if(!input || !msgs) return;
  var txt = input.value.trim();
  if(!txt) return;

  var userDiv = document.createElement('div');
  userDiv.className = 'ac-ai-msg user';
  userDiv.textContent = txt;
  msgs.appendChild(userDiv);
  input.value = '';
  msgs.scrollTop = msgs.scrollHeight;

  var loadingDiv = document.createElement('div');
  loadingDiv.className = 'ac-ai-msg loading';
  loadingDiv.textContent = 'Pensando...';
  msgs.appendChild(loadingDiv);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    var res = await fetch('/api/asistente-consultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta: txt, seccion: window.location.pathname })
    });
    var data = await res.json();
    if(loadingDiv.parentNode) loadingDiv.parentNode.removeChild(loadingDiv);
    var botDiv = document.createElement('div');
    botDiv.className = 'ac-ai-msg bot';
    botDiv.textContent = data.respuesta || data.error || 'No se pudo obtener respuesta.';
    msgs.appendChild(botDiv);
    msgs.scrollTop = msgs.scrollHeight;
  } catch(err) {
    if(loadingDiv.parentNode) loadingDiv.parentNode.removeChild(loadingDiv);
    var botDiv = document.createElement('div');
    botDiv.className = 'ac-ai-msg bot';
    botDiv.textContent = 'Error al procesar la consulta. Intentalo de nuevo.';
    msgs.appendChild(botDiv);
    msgs.scrollTop = msgs.scrollHeight;
  }
};
var enviarPreguntaAsistente = window.enviarPreguntaAsistente;

function valEl(id){
  var el=document.getElementById(id);
  return el ? el.value : '';
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
function abrirModal(id){
  document.querySelectorAll('.menu-pop.open').forEach(function(x){x.classList.remove('open');});
  var m=document.getElementById(id);
  if(m){
    m.classList.add('open');
    if(id==='modal-preferencias'){
      var t=localStorage.getItem('marcos_theme')||'light';
      setTema(t);
    }
  }
}
function cerrarModal(id){
  var m=document.getElementById(id);
  if(m) m.classList.remove('open');
}
function normalizarUrlAudio(pathOrUrl, explicitType) {
  if (!pathOrUrl) return '';
  var u = String(pathOrUrl).trim();
  if (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) {
    return u;
  }

  var isImg = explicitType === 'image' || /jpeg|jpg|png|webp|gif|bmp|svg|imagenes|fotos/i.test(u);
  var isVid = explicitType === 'video' || /mp4|mov|webm|mkv|avi|videos/i.test(u);
  var defaultExt = isImg ? '.jpeg' : (isVid ? '.mp4' : '.ogg');
  var targetFolder = isImg ? 'archivos' : (isVid ? 'archivos' : 'audios');

  if (/^media[:_]/i.test(u)) {
    var mediaId = u.replace(/^media[:_]/i, '').trim();
    var hasExt = /\.(jpeg|jpg|png|webp|gif|bmp|svg|mp4|mov|webm|mkv|avi|ogg|mp3|m4a|wav)$/i.test(mediaId);
    u = '/' + targetFolder + '/media_' + mediaId + (hasExt ? '' : defaultExt);
  } else if (/^\d{10,20}$/.test(u)) {
    u = '/' + targetFolder + '/media_' + u + defaultExt;
  }

  // Quitar prefijos del sistema de archivos local o del servidor VPS
  if (u.indexOf('/root/marcos/Consorcio-AI-Assistant/') !== -1) {
    u = u.replace('/root/marcos/Consorcio-AI-Assistant/', '');
  }
  if (u.indexOf('/root/marcos/') !== -1) {
    u = u.replace('/root/marcos/', '');
  }

  if (u.indexOf('/almacenamiento/') !== -1) {
    u = '/archivos/' + u.substring(u.indexOf('/almacenamiento/') + 16);
  } else if (u.indexOf('/temp/') !== -1) {
    u = '/' + targetFolder + '/' + u.substring(u.indexOf('/temp/') + 6);
  } else if (u.indexOf('/audios/') !== -1) {
    u = '/' + (isImg ? 'archivos' : 'audios') + '/' + u.substring(u.indexOf('/audios/') + 8);
  } else if (u.indexOf('/archivos/') !== -1) {
    u = '/archivos/' + u.substring(u.indexOf('/archivos/') + 10);
  } else {
    var filename = u.replace(new RegExp('^/+', 'g'), '').replace(new RegExp('^\\\\+', 'g'), '');
    if (filename.startsWith('temp/')) {
      u = '/' + targetFolder + '/' + filename.substring(5);
    } else if (filename.startsWith('almacenamiento/')) {
      u = '/archivos/' + filename.substring(15);
    } else if (!filename.startsWith('audios/') && !filename.startsWith('/audios/') && !filename.startsWith('archivos/') && !filename.startsWith('/archivos/')) {
      u = '/' + targetFolder + '/' + filename;
    }
  }

  if (u.charAt(0) !== '/') u = '/' + u;
  return (window.location ? window.location.origin : '') + u;
}
window.normalizarUrlAudio = normalizarUrlAudio;
function stopEv(e){e.stopPropagation();}
window.stopEv = stopEv;

// --- drawer de evento ---
var _drawerActual=null;

function parseAudiosDetallados(datos) {
  if (!datos) return [];
  var result = [];
  var seenUrls = new Set();

  function addAudioItem(url, emisor, hora, transcripcion) {
    if (!url) return;
    var normUrl = normalizarUrlAudio(url);
    if (!normUrl || seenUrls.has(normUrl)) return;
    seenUrls.add(normUrl);

    result.push({
      url: normUrl,
      emisor: emisor || datos.vecino || 'Vecino',
      hora: hora || datos.when || '—',
      transcripcion: transcripcion || ''
    });
  }

  // 1. Parse audios_json field
  var rawJson = datos.audios_json;
  if (rawJson) {
    var listJson = [];
    if (typeof rawJson === 'string' && rawJson.trim()) {
      try {
        var parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) listJson = parsed;
        else if (typeof parsed === 'object') listJson = [parsed];
      } catch(e) {
        listJson = String(rawJson).split(new RegExp('[\\\\,\\\\n;|]')).map(function(u){ return { url: u.trim() }; });
      }
    } else if (Array.isArray(rawJson)) {
      listJson = rawJson;
    }

    listJson.forEach(function(item) {
      if (!item) return;
      if (typeof item === 'string') {
        addAudioItem(item, datos.vecino, datos.when, datos.transcripcion);
      } else if (typeof item === 'object') {
        var u = item.url || item.audio_url || item.src || item.path || item.link || '';
        var em = item.emisor || item.nombre || item.remitente || item.vecino;
        var hr = item.hora || item.timestamp || item.fecha || item.hora_envio;
        var tr = item.transcripcion || item.texto || item.transcripcion_texto;
        addAudioItem(u, em, hr, tr);
      }
    });
  }

  // 2. Parse audio_url field (can contain multiple URLs delimited by comma, newline, pipe, semicolon, space)
  if (datos.audio_url) {
    var parts = String(datos.audio_url).split(new RegExp('[\\\\,\\\\n;|\\\\s]+')).filter(Boolean);
    parts.forEach(function(p) {
      addAudioItem(p, datos.vecino, datos.when, datos.transcripcion);
    });
  }

  // 3. Extract audios from historial_chat
  var rawChat = datos.historial_chat;
  var chatItems = [];
  if (rawChat) {
    if (typeof rawChat === 'string' && rawChat.trim()) {
      if (rawChat.trim().startsWith('[')) {
        try { chatItems = JSON.parse(rawChat); } catch(e) { chatItems = String(rawChat).split('\\n'); }
      } else {
        chatItems = String(rawChat).split('\\n');
      }
    } else if (Array.isArray(rawChat)) {
      chatItems = rawChat;
    }
  }

  var audioUrlRegex = new RegExp('(?:/root/marcos|/archivos|/almacenamiento|https?://)[\\\\w\\\\.\\\\-\\\\_/]+\\\\.(?:ogg|mp3|wav|m4a|aac|opus|webm)', 'gi');

  chatItems.forEach(function(line) {
    if (!line) return;
    var strText = '';
    var lineEmisor = '';
    var lineHora = '';
    var lineAudioUrl = '';
    var lineTrans = '';

    if (typeof line === 'object') {
      lineAudioUrl = line.audio_url || line.url || line.audio || '';
      lineEmisor = line.emisor || line.nombre || line.remitente || line.sender || '';
      lineHora = line.hora || line.timestamp || line.fecha || '';
      lineTrans = line.transcripcion || line.texto || line.mensaje || '';
      strText = (lineEmisor ? lineEmisor + ': ' : '') + (line.texto || line.mensaje || '');
    } else {
      strText = String(line);
      var matchSender = strText.match(/^([^:\(\)]+)(\s*\([^\)]+\))?:\s*/);
      if (matchSender) {
        lineEmisor = matchSender[1].trim();
        if (matchSender[2]) lineHora = matchSender[2].replace(/[\(\)]/g, '').trim();
      }
    }

    if (lineAudioUrl) {
      addAudioItem(lineAudioUrl, lineEmisor, lineHora, lineTrans);
    }

    var textMatches = strText.match(audioUrlRegex);
    if (textMatches) {
      textMatches.forEach(function(mUrl) {
        var cleanTrans = strText.replace(new RegExp('^[^:]+:\\s*', ''), '').replace(mUrl, '').replace(new RegExp('\\[audio\\]', 'gi'), '').trim();
        addAudioItem(mUrl, lineEmisor, lineHora, cleanTrans || lineTrans);
      });
    }
  });

  // 4. Scan general fields (mensaje, notas, transcripcion) for any remaining audio URLs
  var generalRaw = (datos.mensaje || '') + ' ' + (datos.notas || '') + ' ' + (datos.transcripcion || '');
  var genMatches = String(generalRaw).match(audioUrlRegex);
  if (genMatches) {
    genMatches.forEach(function(mUrl) {
      addAudioItem(mUrl, datos.vecino, datos.when, datos.transcripcion);
    });
  }

  return result;
}
window.parseAudiosDetallados = parseAudiosDetallados;

function obtenerAudiosEvento(datos) {
  if (!datos) return [];
  var detailed = parseAudiosDetallados(datos);
  return detailed.map(function(item) { return item.url; });
}
window.obtenerAudiosEvento = obtenerAudiosEvento;

function parseInvolucrados(datos) {
  if (!datos) return [];
  var raw = datos.involucrados_json;
  var list = [];
  if (raw) {
    if (typeof raw === 'string' && raw.trim()) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
        else if (typeof parsed === 'object') list = [parsed];
      } catch(e) {
        list = String(raw).split(new RegExp('[,\\n;]')).map(function(s){ return { nombre: s.trim() }; }).filter(function(x){ return Boolean(x.nombre); });
      }
    } else if (Array.isArray(raw)) {
      list = raw;
    }
  }

  var result = [];
  var seenKeys = new Set();

  list.forEach(function(item) {
    var nom = typeof item === 'string' ? item : (item.nombre || item.vecino || item.contacto || '');
    if (!nom) return;
    var key = nom.trim().toLowerCase();
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    result.push({
      nombre: nom.trim(),
      rol: typeof item === 'object' && (item.rol || item.tipo || item.relacion) ? (item.rol || item.tipo || item.relacion) : 'Involucrado',
      telefono: typeof item === 'object' && (item.telefono || item.tel || item.wsp) ? (item.telefono || item.tel || item.wsp) : '',
      depto: typeof item === 'object' && (item.depto || item.unidad) ? (item.depto || item.unidad) : ''
    });
  });

  if (!result.length && datos.vecino && datos.vecino !== 'Vecino') {
    result.push({
      nombre: datos.vecino,
      rol: 'Titular',
      telefono: datos.telefono || '',
      depto: (datos.depto || datos.unidad) ? ((datos.depto || '') + (datos.depto && datos.unidad ? ' · ' : '') + (datos.unidad || '')) : ''
    });
  }

  return result;
}
window.parseInvolucrados = parseInvolucrados;

function obtenerDireccionEdificio(datos) {
  if (!datos) return '—';
  if (datos.direccion && String(datos.direccion).trim()) return String(datos.direccion).trim();

  var edName = (datos.edificio || '').trim();
  if (!edName) return '—';

  var listaEd = window.__EDIFICIOS__ || [];
  for (var i = 0; i < listaEd.length; i++) {
    var ed = listaEd[i];
    if (!ed) continue;
    var n = (ed.nombre || ed.edificio || '').trim().toLowerCase();
    var d = (ed.direccion || ed.domicilio || ed.address || '').trim();
    if (d && n && (n === edName.toLowerCase() || edName.toLowerCase().indexOf(n) !== -1 || n.indexOf(edName.toLowerCase()) !== -1)) {
      return d;
    }
  }

  return edName;
}

function abrirVisorMultimediaElem(elem) {
  var url = elem.getAttribute('data-url') || '';
  var filename = elem.getAttribute('data-filename') || '';
  var mediaType = elem.getAttribute('data-type') || 'image';
  abrirVisorMultimedia(url, mediaType, filename);
}

function abrirVisorMultimedia(url, mediaType, filename) {
  var modal = document.getElementById('modal-visor-multimedia');
  var contenido = document.getElementById('visor-contenido');
  var titulo = document.getElementById('visor-titulo');
  var btnDescargar = document.getElementById('visor-btn-descargar');

  if (!modal || !contenido) return;

  btnDescargar.href = url;
  btnDescargar.download = filename || 'archivo_multimedia';

  var nameTag = filename ? escapeHtml(filename) : 'Archivo Multimedia';

  if (mediaType === 'image') {
    titulo.innerHTML = '🖼️ ' + nameTag;
    contenido.innerHTML = '<img src="' + escapeHtml(url) + '" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:mScale .2s cubic-bezier(0.16, 1, 0.3, 1) both" alt="Imagen">';
  } else if (mediaType === 'video') {
    titulo.innerHTML = '🎥 ' + nameTag;
    contenido.innerHTML = '<video src="' + escapeHtml(url) + '" controls autoplay style="max-width:90vw;max-height:80vh;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:mScale .2s cubic-bezier(0.16, 1, 0.3, 1) both"></video>';
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function cerrarVisorMultimedia() {
  var modal = document.getElementById('modal-visor-multimedia');
  var contenido = document.getElementById('visor-contenido');
  if (!modal) return;
  modal.style.display = 'none';
  if (contenido) contenido.innerHTML = '';
  document.body.style.overflow = '';
}

function cerrarVisorMultimediaSiBackdrop(e) {
  if (e.target.id === 'modal-visor-multimedia' || e.target.id === 'visor-contenido') {
    cerrarVisorMultimedia();
  }
}

if (typeof window !== 'undefined' && !window.__VISOR_ESC_REGISTERED__) {
  window.__VISOR_ESC_REGISTERED__ = true;
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      cerrarVisorMultimedia();
    }
  });
}

function procesarLineaMultimediaChat(strText) {
  var cleanText = String(strText || '');
  var visualUrl = '', visualType = '', visualFilename = '';
  var audioUrl = '', audioFilename = '';

  var escOB = String.fromCharCode(92) + String.fromCharCode(91);
  var escCB = String.fromCharCode(92) + String.fromCharCode(93);
  var tagRegexGlobal = new RegExp(escOB + '(AUDIO|AUDIO_URL|IMAGEN|FOTO|VIDEO|DOCUMENTO|DOC|PDF|FACTURA):\\s*([^' + escCB + ']+)' + escCB, 'gi');
  var tagRegexSingle = new RegExp(escOB + '(AUDIO|AUDIO_URL|IMAGEN|FOTO|VIDEO|DOCUMENTO|DOC|PDF|FACTURA):\\s*([^' + escCB + ']+)' + escCB, 'i');
  var allTags = cleanText.match(tagRegexGlobal) || [];
  allTags.forEach(function(tagStr) {
    var m = tagStr.match(tagRegexSingle);
    if (m) {
      var tagType = m[1].toUpperCase();
      var rawUrl = m[2].trim();
      var lastSlash = rawUrl.lastIndexOf('/');
      var fn = lastSlash !== -1 ? rawUrl.substring(lastSlash + 1) : rawUrl;

      if (tagType === 'IMAGEN' || tagType === 'FOTO') {
        visualUrl = normalizarUrlAudio(rawUrl, 'image');
        visualType = 'image';
        visualFilename = fn;
      } else if (tagType === 'VIDEO') {
        visualUrl = normalizarUrlAudio(rawUrl, 'video');
        visualType = 'video';
        visualFilename = fn;
      } else if (tagType === 'DOCUMENTO' || tagType === 'DOC' || tagType === 'PDF' || tagType === 'FACTURA') {
        visualUrl = normalizarUrlAudio(rawUrl, 'pdf');
        visualType = 'pdf';
        visualFilename = fn;
      } else {
        audioUrl = normalizarUrlAudio(rawUrl, 'audio');
        audioFilename = fn;
      }
      cleanText = cleanText.replace(tagStr, '').trim();
    }
  });

  if (!visualUrl && !audioUrl) {
    var prefixes = ['/root/marcos/', '/archivos/', '/audios/', '/almacenamiento/', 'http://', 'https://'];
    var foundIdx = -1;

    for (var i = 0; i < prefixes.length; i++) {
      var pos = cleanText.indexOf(prefixes[i]);
      if (pos !== -1 && (foundIdx === -1 || pos < foundIdx)) {
        foundIdx = pos;
      }
    }

    if (foundIdx !== -1) {
      var rest = cleanText.substring(foundIdx);
      var endPos = rest.length;
      for (var j = 0; j < rest.length; j++) {
        var ch = rest.charAt(j);
        if (ch <= ' ' || ch === ']' || ch === ')') {
          endPos = j;
          break;
        }
      }

      var rawPath = rest.substring(0, endPos).trim();
      if (rawPath.length > 3) {
        var lastSlash2 = rawPath.lastIndexOf('/');
        var fn2 = lastSlash2 !== -1 ? rawPath.substring(lastSlash2 + 1) : rawPath;
        var ext2 = fn2.split('.').pop().toLowerCase();

        var isImgPath = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].indexOf(ext2) !== -1 || rawPath.indexOf('/imagenes/') !== -1 || rawPath.indexOf('/fotos/') !== -1 || /imagen|foto/i.test(cleanText);
        var isVidPath = ['mp4', 'mov', 'webm', 'mkv', 'avi'].indexOf(ext2) !== -1 || rawPath.indexOf('/videos/') !== -1;
        var isPdfPath = ['pdf', 'doc', 'docx', 'xls', 'xlsx'].indexOf(ext2) !== -1 || rawPath.indexOf('/facturas/') !== -1 || rawPath.indexOf('/documentos/') !== -1 || /documento|factura|pdf/i.test(cleanText);

        if (isImgPath) {
          visualUrl = normalizarUrlAudio(rawPath, 'image');
          visualType = 'image';
          visualFilename = fn2;
        } else if (isVidPath) {
          visualUrl = normalizarUrlAudio(rawPath, 'video');
          visualType = 'video';
          visualFilename = fn2;
        } else if (isPdfPath) {
          visualUrl = normalizarUrlAudio(rawPath, 'pdf');
          visualType = 'pdf';
          visualFilename = fn2;
        } else {
          audioUrl = normalizarUrlAudio(rawPath, 'audio');
          audioFilename = fn2;
        }

        var startCut = foundIdx;
        if (startCut > 0 && cleanText.charAt(startCut - 1) === '[') startCut--;

        var endCut = foundIdx + rawPath.length;
        if (endCut < cleanText.length && cleanText.charAt(endCut) === ']') endCut++;

        var before = cleanText.substring(0, startCut).trim();
        var after = cleanText.substring(endCut).trim();

        var tagRegexes = [
          new RegExp('imagen:\\s*$', 'i'),
          new RegExp('foto:\\s*$', 'i'),
          new RegExp('video:\\s*$', 'i'),
          new RegExp('audio:\\s*$', 'i'),
          new RegExp('\\(imagen adjunta\\)\\s*$', 'i'),
          new RegExp('\\(video adjunto\\)\\s*$', 'i'),
          new RegExp('\\(nota de voz\\)\\s*$', 'i')
        ];
        for (var t = 0; t < tagRegexes.length; t++) {
          if (tagRegexes[t].test(before)) {
            before = before.replace(tagRegexes[t], '').trim();
          }
        }
        if (before.endsWith('[')) {
          before = before.substring(0, before.length - 1).trim();
        }

        cleanText = (before ? before + ' ' : '') + (after ? after : '');
      }
    }
  }

  ['/archivos/', '/audios/', '/almacenamiento/', '/root/marcos/'].forEach(function(pref) {
    var p = cleanText.indexOf(pref);
    if (p !== -1) {
      var endP = cleanText.indexOf(' ', p);
      if (endP === -1) endP = cleanText.length;
      cleanText = (cleanText.substring(0, p) + ' ' + cleanText.substring(endP)).trim();
    }
  });
  cleanText = cleanText.split(']').join('').split(')').join('').split('  ').join(' ').trim();

  if ((visualUrl || audioUrl) && !cleanText) {
    var label = visualType === 'image' ? '(imagen adjunta)' : (visualType === 'video' ? '(video adjunto)' : '(nota de voz)');
    cleanText = label;
  }

  return {
    cleanText: cleanText,
    visualUrl: visualUrl,
    visualType: visualType,
    visualFilename: visualFilename,
    audioUrl: audioUrl,
    audioFilename: audioFilename,
    webUrl: visualUrl || audioUrl,
    filename: visualFilename || audioFilename,
    mediaType: visualType || (audioUrl ? 'audio' : '')
  };
}

function cambiarTabChatEvento(tab) {
  var btnA = document.getElementById('tab-btn-ambos');
  var btnV = document.getElementById('tab-btn-vecino');
  var btnP = document.getElementById('tab-btn-proveedor');
  var panelV = document.getElementById('panel-chat-vecino');
  var panelP = document.getElementById('panel-chat-proveedor');

  [btnA, btnV, btnP].forEach(function(b) {
    if (b) {
      b.style.background = '#F1F5FB';
      b.style.color = '#5A6B85';
      b.style.border = '1px solid #DCE4F0';
    }
  });

  if (tab === 'vecino') {
    if (btnV) {
      btnV.style.background = 'linear-gradient(180deg,#2E6FC0,#1E5FB4)';
      btnV.style.color = '#FFFFFF';
      btnV.style.border = '1px solid #1E5FB4';
    }
    if (panelV) panelV.style.display = 'block';
    if (panelP) panelP.style.display = 'none';
  } else if (tab === 'proveedor') {
    if (btnP) {
      btnP.style.background = 'linear-gradient(180deg,#2E6FC0,#1E5FB4)';
      btnP.style.color = '#FFFFFF';
      btnP.style.border = '1px solid #1E5FB4';
    }
    if (panelV) panelV.style.display = 'none';
    if (panelP) panelP.style.display = 'block';
  } else {
    if (btnA) {
      btnA.style.background = 'linear-gradient(180deg,#2E6FC0,#1E5FB4)';
      btnA.style.color = '#FFFFFF';
      btnA.style.border = '1px solid #1E5FB4';
    }
    if (panelV) panelV.style.display = 'block';
    if (panelP) panelP.style.display = 'block';
  }
}
window.cambiarTabChatEvento = cambiarTabChatEvento;

function separarConversacionesEvento(datos) {
  if (!datos) return { chatVecino: [], chatProveedor: [] };

  function parseList(src) {
    if (!src) return [];
    if (typeof src === 'string' && src.trim()) {
      if (src.trim().startsWith('[')) {
        try { return JSON.parse(src); } catch(e) { return [src]; }
      }
      return String(src).split('\\n').filter(Boolean);
    }
    if (Array.isArray(src)) return src;
    return [];
  }

  var techPhones = new Set();
  if (datos.tel_tecnico) {
    var pClean = String(datos.tel_tecnico).replace(/[^0-9]/g, '');
    if (pClean.length >= 7) techPhones.add(pClean.slice(-10));
  }
  if (datos.involucrados_json) {
    var invs = parseList(datos.involucrados_json);
    invs.forEach(function(inv){
      if (typeof inv === 'object' && inv.telefono) {
        var rLow = String(inv.rol || '').toLowerCase();
        if (rLow.indexOf('técnico') !== -1 || rLow.indexOf('tecnico') !== -1 || rLow.indexOf('proveedor') !== -1) {
          var ic = String(inv.telefono).replace(/[^0-9]/g, '');
          if (ic.length >= 7) techPhones.add(ic.slice(-10));
        }
      }
    });
  }

  function esMensajeDeVecino(item) {
    if (!item) return false;
    var rem = typeof item === 'object' ? String(item.remitente || item.emisor || item.destinatario || item.canal_orig || '').toLowerCase() : '';
    var str = typeof item === 'object' ? ((item.emisor ? item.emisor + ': ' : '') + (item.texto || item.mensaje || '')) : String(item);
    var strLower = str.toLowerCase();

    if (rem === 'vecino' || rem === 'usuario' || rem === 'cliente' || rem === 'titular' || rem === 'familiar') return true;
    if (/^(Vecino|Usuario|Cliente|Titular|Familiar|Pariente)/i.test(str)) return true;

    if (
      strLower.indexOf('formalizar su reclamo') !== -1 ||
      strLower.indexOf('su nombre y apellido') !== -1 ||
      strLower.indexOf('número de su departamento') !== -1 ||
      strLower.indexOf('numero de su departamento') !== -1 ||
      strLower.indexOf('¿podría indicarme') !== -1 ||
      strLower.indexOf('podria indicarme') !== -1 ||
      strLower.indexOf('me indicás su') !== -1 ||
      strLower.indexOf('me indicas su') !== -1 ||
      strLower.indexOf('servicio técnico de guardia') !== -1
    ) {
      return true;
    }
    return false;
  }

  function esMensajeDeProveedor(item) {
    if (!item) return false;

    // EL TELÉFONO MANDA. Si el mensaje viene del número del técnico del caso, es del técnico y
    // no hay nada que interpretar. Va ANTES que todo lo demás porque es el único dato duro acá:
    // el resto son heurísticas sobre el texto, y una de ellas --"pidiéndole datos al vecino"--
    // engancha frases que el técnico también escribe.
    var itemPhone = typeof item === 'object' ? String(item.telefono || '').replace(/[^0-9]/g, '') : '';
    if (itemPhone.length >= 7 && techPhones.has(itemPhone.slice(-10))) return true;

    // Si es explícitamente un mensaje dirigido al vecino o pidiéndole datos, NUNCA es de proveedor
    if (esMensajeDeVecino(item)) return false;

    var rem = typeof item === 'object' ? String(item.remitente || item.emisor || item.destinatario || item.canal_orig || '').toLowerCase() : '';
    var str = typeof item === 'object' ? ((item.emisor ? item.emisor + ': ' : '') + (item.texto || item.mensaje || '')) : String(item);
    var strLower = str.toLowerCase();

    if (rem === 'tecnico' || rem === 'proveedor' || rem === 'instalador' || rem === 'plomero' || rem === 'electricista' || rem === 'gasista') {
      return true;
    }
    if (/^(Proveedor|Técnico|Plomero|Electricista|Gasista|Instalador)/i.test(str)) {
      return true;
    }
    // Una factura o un comprobante son del proveedor. El guard de más arriba ya descartó los
    // mensajes dirigidos al vecino, así que acá no hace falta volver a preguntarlo.
    if (strLower.indexOf('factura') !== -1 || strLower.indexOf('comprobante') !== -1 || strLower.indexOf('documento') !== -1 || strLower.indexOf('[factura:') !== -1) {
      return true;
    }
    if (strLower.indexOf('plantilla whatsapp') !== -1 || strLower.indexOf('plantilla meta') !== -1) {
      return true;
    }
    if (strLower.indexOf('marcos — contacto para el ingreso') !== -1 || strLower.indexOf('marcos - contacto para el ingreso') !== -1) {
      return true;
    }
    if (strLower.indexOf('marcos (a proveedor):') !== -1 || strLower.indexOf('marcos (al técnico):') !== -1 || strLower.indexOf('marcos (al proveedor):') !== -1) {
      return true;
    }
    if (
      (strLower.indexOf('tenés una nueva solicitud de servicio') !== -1 || strLower.indexOf('tenes una nueva solicitud de servicio') !== -1 || strLower.indexOf('nueva solicitud de servicio') !== -1) &&
      (strLower.indexOf('para la visita') !== -1 || strLower.indexOf('urgencia:') !== -1 || strLower.indexOf('acceso:') !== -1)
    ) {
      return true;
    }
    // Las preguntas de seguimiento son al TÉCNICO: "¿pudiste ir?", "¿resolviste el reclamo?".
    // Sin esto quedaban en la columna del vecino y el visor mostraba las dos conversaciones
    // mezcladas.
    if (
      strLower.indexOf('comunicate directamente con esa persona y avisame') !== -1 ||
      strLower.indexOf('si al llegar no te abren') !== -1 ||
      strLower.indexOf('pudiste ir') !== -1 ||
      strLower.indexOf('pudiste realizar') !== -1 ||
      strLower.indexOf('pudiste asistir') !== -1 ||
      strLower.indexOf('pudiste pasar') !== -1 ||
      strLower.indexOf('resolviste el reclamo') !== -1 ||
      strLower.indexOf('solucionaste el reclamo') !== -1 ||
      strLower.indexOf('confirmar la visita') !== -1 ||
      strLower.indexOf('reclamo solucionado') !== -1
    ) {
      return true;
    }
    return false;
  }

  // 1. Obtener lista específica de Vecino
  var rawVecino = parseList(datos.chat_vecino_json);
  if (!rawVecino.length) rawVecino = parseList(datos.historial_chat_vecino);

  // 2. Obtener lista específica de Proveedor
  var rawProveedor = parseList(datos.chat_proveedor_json);
  if (!rawProveedor.length) rawProveedor = parseList(datos.historial_chat_proveedor);

  var chatVecino = [];
  var chatProveedor = [];
  var seenV = new Set();
  var seenP = new Set();

  if (rawVecino.length > 0) {
    rawVecino.forEach(function(item) {
      var k = typeof item === 'object' ? JSON.stringify(item) : String(item).trim();
      if (!k) return;

      if (esMensajeDeProveedor(item)) {
        if (!seenP.has(k)) {
          seenP.add(k);
          chatProveedor.push(item);
        }
      } else {
        if (!seenV.has(k)) {
          seenV.add(k);
          chatVecino.push(item);
        }
      }
    });
  }

  if (rawProveedor.length > 0) {
    rawProveedor.forEach(function(item) {
      var k = typeof item === 'object' ? JSON.stringify(item) : String(item).trim();
      if (!k) return;

      if (esMensajeDeVecino(item) && !esMensajeDeProveedor(item)) {
        if (!seenV.has(k)) {
          seenV.add(k);
          chatVecino.push(item);
        }
      } else {
        if (!seenP.has(k)) {
          seenP.add(k);
          chatProveedor.push(item);
        }
      }
    });
  }

  // 3. Fallback solo si alguna lista está vacía o incompleta
  var fallbackList = [].concat(parseList(datos.chat_pg), parseList(datos.historial_chat));
  if (fallbackList.length > 0) {
    var lastWasProvMsg = false;

    fallbackList.forEach(function(item) {
      var k = typeof item === 'object' ? JSON.stringify(item) : String(item).trim();
      if (!k) return;

      var str = typeof item === 'object' ? ((item.emisor ? item.emisor + ': ' : '') + (item.texto || item.mensaje || '')) : String(item);
      var strLower = str.toLowerCase();

      var isProv = esMensajeDeProveedor(item);
      var isVec = esMensajeDeVecino(item);

      if (isProv) {
        lastWasProvMsg = true;
        if (!seenP.has(k)) {
          seenP.add(k);
          chatProveedor.push(item);
        }
      } else if (isVec) {
        lastWasProvMsg = false;
        if (!seenV.has(k)) {
          seenV.add(k);
          chatVecino.push(item);
        }
      } else {
        var isContactoCompartidoProv = strLower.indexOf('(contacto compartido') !== -1 && lastWasProvMsg;
        var isMarcosToTech = isContactoCompartidoProv || /al proveedor|al técnico|estimado técnico|hola técnico|notificación al técnico|notificación al proveedor|para que le abran|comunicate directamente con esa persona|pudiste ir|pudiste realizar|pudiste asistir|pudiste pasar|reclamo solucionado/i.test(strLower);

        if (isMarcosToTech) {
          lastWasProvMsg = true;
          if (!seenP.has(k)) {
            seenP.add(k);
            chatProveedor.push(item);
          }
        } else {
          lastWasProvMsg = false;
          if (!seenV.has(k)) {
            seenV.add(k);
            chatVecino.push(item);
          }
        }
      }
    });
  }

  // Limpieza final de seguridad: asegurar que NINGÚN mensaje de proveedor quede en chatVecino
  chatVecino = chatVecino.filter(function(item) {
    var isProv = esMensajeDeProveedor(item);
    if (isProv) {
      var k = typeof item === 'object' ? JSON.stringify(item) : String(item).trim();
      if (k && !seenP.has(k)) {
        seenP.add(k);
        chatProveedor.push(item);
      }
      return false;
    }
    return true;
  });

  return {
    chatVecino: chatVecino,
    chatProveedor: chatProveedor
  };
}
window.separarConversacionesEvento = separarConversacionesEvento;

function renderizarBloqueChat(rawChat, tipoBloque, datos) {
  var chatLines = [];
  var audioFallbackUsado = false;
  if (typeof rawChat === 'string' && rawChat.trim()) {
    if (rawChat.trim().startsWith('[')) {
      try { chatLines = JSON.parse(rawChat); } catch(e) { chatLines = [rawChat]; }
    } else {
      chatLines = String(rawChat).split('\\n').filter(Boolean);
    }
  } else if (Array.isArray(rawChat)) {
    chatLines = rawChat;
  }

  if (!chatLines.length && datos) {
    var sep = separarConversacionesEvento(datos);
    chatLines = tipoBloque === 'proveedor' ? sep.chatProveedor : sep.chatVecino;
  }

  // El nombre real que viene entre paréntesis: "Proveedor (dario juju): ...".
  // Antes se sacaba con una expresión regular que vive adentro de una plantilla de texto, donde
  // las barras invertidas se procesan ANTES de servirse: el patrón que llegaba al navegador no
  // era el que estaba escrito acá, y no enganchaba nunca. Buscar los paréntesis a mano no tiene
  // ese problema.
  function extraerNombreEntreParentesis(s) {
    if (!s) return '';
    var p1 = s.indexOf('(');
    var p2 = s.indexOf(')', p1);
    if (p1 !== -1 && p2 > p1) return s.substring(p1 + 1, p2).trim();
    return '';
  }

  if (chatLines.length > 0) {
    var bubbles = chatLines.map(function(line) {
      var rem = typeof line === 'object' ? String(line.remitente || line.emisor || '').toLowerCase() : '';
      var str = typeof line === 'object' ? ((line.emisor ? line.emisor + ': ' : (rem ? rem + ': ' : '')) + (line.texto || line.mensaje || '')) : String(line);
      var horaTag = (typeof line === 'object' && line.hora) ? line.hora : '';

      var isFamiliar = rem === 'familiar' || /^(Familiar|Pariente)/i.test(str);
      var isVecino = rem === 'vecino' || rem === 'usuario' || rem === 'cliente' || /^(Vecino|Usuario|Cliente|Titular)/i.test(str);
      var isProveedor = rem === 'tecnico' || rem === 'proveedor' || rem === 'instalador' || /^(Proveedor|Técnico|Plomero|Electricista|Gasista|Instalador)/i.test(str);
      var isEncargado = rem === 'encargado' || rem === 'portero' || rem === 'seguridad' || /^(Encargado|Seguridad|Portero|Portería)/i.test(str);
      var isAdmin = rem === 'admin' || rem === 'administracion' || /^(Admin|Administración)/i.test(str);

      // Se le saca el prefijo de quién habla ("Vecino: ", "Marcos (a Proveedor): ") sin usar una
      // expresión regular con barras invertidas, por el mismo motivo que arriba.
      var cleanText = str;
      var colonIdx = str.indexOf(':');
      if (colonIdx !== -1 && colonIdx < 40) {
        var prefix = str.substring(0, colonIdx).trim();
        if (/^(Vecino|Usuario|Cliente|Titular|Familiar|Pariente|Marcos IA|Marcos|Susana|IA|Bot|Asistente|Sistema|Proveedor|Técnico|Plomero|Electricista|Gasista|Instalador|Encargado|Seguridad|Portero|Portería|Admin|Administración)/i.test(prefix)) {
          cleanText = str.substring(colonIdx + 1).trim();
        }
      }
      
      var senderLabel = 'Marcos IA';
      var align = 'margin-right:auto;background:#FFFFFF;color:#16233B;border:1px solid #E1E7F0;border-bottom-left-radius:2px;';
      var icon = '🤖';
      var tagBg = '#EAF1FB', tagFg = '#2E6FC0';

      if (isFamiliar) {
        senderLabel = extraerNombreEntreParentesis(str) || 'Familiar';
        align = 'margin-left:auto;background:#EFF6FF;color:#1E3A8A;border:1px solid #BFDBFE;border-bottom-right-radius:2px;';
        icon = '🔵';
        tagBg = '#DBEAFE'; tagFg = '#1E40AF';
      } else if (isVecino) {
        senderLabel = extraerNombreEntreParentesis(str) || (datos.vecino || 'Vecino (Titular)');
        align = 'margin-left:auto;background:#DCF8C6;color:#0F2310;border-bottom-right-radius:2px;';
        icon = '🟢';
        tagBg = '#D1FAE5'; tagFg = '#065F46';
      } else if (isProveedor) {
        var nomProvInStr = extraerNombreEntreParentesis(str);
        var nomTechClean = (nomProvInStr || datos.tecnico || 'Técnico / Proveedor').replace(/[()]/g, '').trim();
        senderLabel = nomTechClean || 'Técnico / Proveedor';
        align = 'margin-left:auto;background:#FEF3C7;color:#78350F;border:1px solid #FDE68A;border-bottom-right-radius:2px;';
        icon = '🔧';
        tagBg = '#FDE68A'; tagFg = '#92400E';
      } else if (isEncargado) {
        // Mismo motivo que en las otras etiquetas: la expresión regular vive adentro de una
        // plantilla de texto, donde las barras invertidas se procesan antes de servirse, y el
        // patrón que llega al navegador no es el que está escrito acá.
        senderLabel = extraerNombreEntreParentesis(str) || 'Personal del Edificio';
        align = 'margin-left:auto;background:#EDE9FE;color:#4C1D95;border:1px solid #DDD6FE;border-bottom-right-radius:2px;';
        icon = '👷';
        tagBg = '#DDD6FE'; tagFg = '#5B21B6';
      } else if (isAdmin) {
        senderLabel = 'Administración';
        align = 'margin-left:auto;background:#F3E8FF;color:#581C87;border:1px solid #E9D5FF;border-bottom-right-radius:2px;';
        icon = '👔';
        tagBg = '#E9D5FF'; tagFg = '#6B21A8';
      }

      var mediaRes = procesarLineaMultimediaChat(cleanText);
      cleanText = mediaRes.cleanText;

      var visualUrl = mediaRes.visualUrl || '';
      var visualType = mediaRes.visualType || '';
      var visualFilename = mediaRes.visualFilename || '';
      var audioUrl = mediaRes.audioUrl || '';
      var audioFilename = mediaRes.audioFilename || '';

      var rawObjMedia = typeof line === 'object' ? (line.url_media || line.audio_url || line.url || line.audio || '') : '';
      if (rawObjMedia && !audioUrl && !visualUrl) {
        var lastSlashObj = rawObjMedia.lastIndexOf('/');
        var fnObj = lastSlashObj !== -1 ? rawObjMedia.substring(lastSlashObj + 1) : rawObjMedia;
        var extObj = fnObj.split('.').pop().toLowerCase();

        var _LBR_IMG = String.fromCharCode(92) + String.fromCharCode(91);
        var isLineExplicitImage = /imagen|foto/i.test(cleanText) || (new RegExp(_LBR_IMG + '(IMAGEN|FOTO):', 'i')).test(String(line.mensaje || line.texto || ''));
        var isLineExplicitVideo = /video/i.test(cleanText) || (new RegExp(_LBR_IMG + 'VIDEO:', 'i')).test(String(line.mensaje || line.texto || ''));

        if (isLineExplicitImage || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].indexOf(extObj) !== -1 || rawObjMedia.indexOf('/imagenes/') !== -1) {
          visualUrl = normalizarUrlAudio(rawObjMedia, 'image');
          visualType = 'image';
          visualFilename = fnObj;
        } else if (isLineExplicitVideo || ['mp4', 'mov', 'webm', 'mkv', 'avi'].indexOf(extObj) !== -1 || rawObjMedia.indexOf('/videos/') !== -1) {
          visualUrl = normalizarUrlAudio(rawObjMedia, 'video');
          visualType = 'video';
          visualFilename = fnObj;
        } else {
          audioUrl = normalizarUrlAudio(rawObjMedia, 'audio');
          audioFilename = fnObj;
        }
      }

      if (!audioUrl && !visualUrl && datos.audio_url && !audioFallbackUsado && (isVecino || isFamiliar || isProveedor)) {
        var isAudioMentioned = /audio|voz|nota de voz|escuchar|grabación/i.test(str) && !/imagen|foto|video/i.test(str);
        if (isAudioMentioned) {
          var rawAudioUrl = String(datos.audio_url).trim();
          if (rawAudioUrl.length > 3) {
            var ext = rawAudioUrl.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].indexOf(ext) !== -1 || rawAudioUrl.indexOf('/imagenes/') !== -1) {
              visualUrl = normalizarUrlAudio(rawAudioUrl, 'image');
              visualType = 'image';
              var lastSlash = rawAudioUrl.lastIndexOf('/');
              visualFilename = lastSlash !== -1 ? rawAudioUrl.substring(lastSlash + 1) : rawAudioUrl;
            } else if (['mp4', 'mov', 'webm', 'mkv', 'avi'].indexOf(ext) !== -1 || rawAudioUrl.indexOf('/videos/') !== -1) {
              visualUrl = normalizarUrlAudio(rawAudioUrl, 'video');
              visualType = 'video';
              var lastSlash = rawAudioUrl.lastIndexOf('/');
              visualFilename = lastSlash !== -1 ? rawAudioUrl.substring(lastSlash + 1) : rawAudioUrl;
            } else {
              audioUrl = normalizarUrlAudio(rawAudioUrl, 'audio');
              var lastSlash = rawAudioUrl.lastIndexOf('/');
              audioFilename = lastSlash !== -1 ? rawAudioUrl.substring(lastSlash + 1) : rawAudioUrl;
              audioFallbackUsado = true;
            }
          }
        }
      }

      var visualMediaHtml = '';
      if (visualUrl) {
        var urlEsc = escapeHtml(visualUrl);
        var fnEsc = escapeHtml(visualFilename);
        if (visualType === 'pdf') {
          visualMediaHtml = '<div style="margin-top:8px;padding:10px 12px;background:#FFF9F2;border-radius:10px;border:1px solid #FDE68A">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
              '<span style="font-size:26px">📄</span>' +
              '<div>' +
                '<div style="font-size:13px;font-weight:800;color:#16233B">' + fnEsc + '</div>' +
                '<div style="font-size:11px;color:#78350F;font-weight:700">Documento / Factura Adjunta (PDF)</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<a href="' + urlEsc + '" download target="_blank" style="font-size:11.5px;font-weight:800;color:#92400E;background:#FDE68A;border:1px solid #F7D070;padding:5px 12px;border-radius:6px;text-decoration:none" class="hv-soft">⬇️ Descargar PDF / Comprobante</a>' +
              '<a href="' + urlEsc + '" target="_blank" style="font-size:11.5px;font-weight:700;color:#2E6FC0;background:#fff;border:1px solid #DCE4F0;padding:5px 10px;border-radius:6px;text-decoration:none" class="hv-soft">👁️ Ver Documento</a>' +
            '</div>' +
          '</div>';
        } else if (visualType === 'image') {
          visualMediaHtml = '<div style="margin-top:8px;padding:8px;background:rgba(46,111,192,.06);border-radius:10px;border:1px solid rgba(46,111,192,.18)">' +
            '<div style="position:relative;max-width:280px;max-height:200px;border-radius:8px;overflow:hidden;margin-bottom:6px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.12);background:#000" data-url="' + urlEsc + '" data-filename="' + fnEsc + '" data-type="image" onclick="abrirVisorMultimediaElem(this)">' +
              '<img src="' + urlEsc + '" style="width:100%;height:100%;object-fit:cover;display:block" alt="Imagen adjunta">' +
              '<div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.65);color:#fff;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;backdrop-filter:blur(4px)">🔍 Ver HD</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
              '<button data-url="' + urlEsc + '" data-filename="' + fnEsc + '" data-type="image" onclick="abrirVisorMultimediaElem(this)" style="font-size:11px;font-weight:800;color:#2E6FC0;background:#fff;border:1px solid #DCE4F0;padding:3px 9px;border-radius:6px;cursor:pointer" class="hv-soft">🖼️ Ampliar foto</button>' +
              '<a href="' + urlEsc + '" download target="_blank" style="font-size:11px;font-weight:700;color:#2E6FC0;background:#fff;border:1px solid #DCE4F0;padding:3px 9px;border-radius:6px;text-decoration:none" class="hv-soft">⬇️ Descargar</a>' +
            '</div>' +
          '</div>';
        } else if (visualType === 'video') {
          visualMediaHtml = '<div style="margin-top:8px;padding:8px;background:rgba(46,111,192,.06);border-radius:10px;border:1px solid rgba(46,111,192,.18)">' +
            '<video src="' + urlEsc + '" controls style="width:100%;max-height:220px;border-radius:8px;margin-bottom:6px"></video>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
              '<button data-url="' + urlEsc + '" data-filename="' + fnEsc + '" data-type="video" onclick="abrirVisorMultimediaElem(this)" style="font-size:11px;font-weight:800;color:#2E6FC0;background:#fff;border:1px solid #DCE4F0;padding:3px 9px;border-radius:6px;cursor:pointer" class="hv-soft">🎥 Ampliar video</button>' +
              '<a href="' + urlEsc + '" download target="_blank" style="font-size:11px;font-weight:700;color:#2E6FC0;background:#fff;border:1px solid #DCE4F0;padding:3px 9px;border-radius:6px;text-decoration:none" class="hv-soft">⬇️ Descargar</a>' +
            '</div>' +
          '</div>';
        }
      }

      var audioMediaHtml = '';
      if (audioUrl) {
        var urlEscAud = escapeHtml(audioUrl);
        var fnEscAud = escapeHtml(audioFilename || 'nota_de_voz.ogg');
        var dias = datos.audioDiasRestantes;
        if (dias === null || dias === undefined) dias = 30;
        var diasBadgeHtml = (dias <= 0)
          ? '<span style="font-size:10px;font-weight:800;background:#FBF3DE;color:#8A6410;padding:2px 7px;border-radius:999px;border:1px solid #E8D9A0;margin-left:4px">⏳ Expirado</span>'
          : (dias <= 7
            ? '<span style="font-size:10px;font-weight:800;background:#FDECEC;color:#C0392B;padding:2px 7px;border-radius:999px;border:1px solid #F8B4B4;margin-left:4px">' + dias + 'd restantes</span>'
            : '<span style="font-size:10px;font-weight:800;background:#E7F4EC;color:#1B7A43;padding:2px 7px;border-radius:999px;border:1px solid #C3E6D0;margin-left:4px">' + dias + 'd restantes</span>');

        audioMediaHtml = '<div style="margin-top:6px;padding:8px 12px;background:rgba(46,111,192,.08);border-radius:10px;border:1px solid rgba(46,111,192,.2)">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
            '<div style="display:flex;align-items:center;gap:4px">' +
              '<span style="font-size:11.5px;font-weight:800;color:#2E6FC0">🎙️ (nota de voz) ' + fnEscAud + '</span>' +
              diasBadgeHtml +
            '</div>' +
            '<a href="' + urlEscAud + '" download target="_blank" style="font-size:11px;font-weight:700;color:#2E6FC0;background:#fff;border:1px solid #DCE4F0;padding:3px 9px;border-radius:6px;text-decoration:none" class="hv-soft">⬇️ Descargar audio</a>' +
          '</div>' +
          '<audio controls preload="metadata" style="width:100%;height:36px;border-radius:6px;outline:none"><source src="' + urlEscAud + '" type="audio/ogg"><source src="' + urlEscAud + '" type="audio/mpeg"><source src="' + urlEscAud + '"></audio>' +
        '</div>';
      }

      var mediaLinkHtml = visualMediaHtml + audioMediaHtml;

      return '<div style="max-width:88%;padding:9px 13px;border-radius:12px;font-size:13px;line-height:1.45;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,.06);' + align + '" class="chat-bubble">' +
        '<div style="font-size:10.5px;font-weight:800;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<span style="display:flex;align-items:center;gap:4px"><span>' + icon + '</span><span style="padding:1px 6px;border-radius:999px;background:' + tagBg + ';color:' + tagFg + '">' + escapeHtml(senderLabel) + '</span></span>' +
          (horaTag ? '<span style="font-size:10px;opacity:.65;font-weight:600">🕒 ' + escapeHtml(horaTag) + '</span>' : '') +
        '</div>' +
        '<div style="white-space:pre-wrap;word-break:break-word">' + escapeHtml(cleanText) + '</div>' +
        mediaLinkHtml +
      '</div>';
    }).join('');

    return '<div style="margin-top:10px;margin-bottom:14px;max-height:340px;overflow-y:auto;background:#E5DDD5;border-radius:14px;padding:14px;border:1px solid #D1C7BD" class="chat-box">' +
      bubbles +
    '</div>';
  } else {
    if (tipoBloque === 'proveedor') {
      var tecNombre = (datos.tecnico || datos.rubro_tecnico) ? escapeHtml(datos.tecnico || datos.rubro_tecnico) : '';
      return '<div style="display:flex;align-items:flex-start;gap:11px;background:#FFFDF5;border-radius:12px;padding:14px;font-size:13px;color:#78350F;line-height:1.5;margin-top:10px;border:1px solid #FDE68A">' +
        '<span style="font-size:22px">🛠️</span>' +
        '<div><strong style="color:#92400E;display:block;font-size:14px;margin-bottom:3px">' + (tecNombre ? 'Técnico Asignado: ' + tecNombre : 'Sin técnico asignado aún') + '</strong>' +
        '<span>' + (tecNombre ? 'Marcos IA gestionará los detalles por WhatsApp cuando el técnico confirme o consulte el reclamo.' : 'Marcos IA coordinará automáticamente con el proveedor cuando la Administración le asigne un especialista al caso.') + '</span></div>' +
      '</div>';
    } else {
      return '<div style="display:flex;align-items:flex-start;gap:9px;background:#F1F5FB;border-radius:11px;padding:11px 14px;font-size:12.5px;color:#5A6B85;line-height:1.5;margin-top:10px">' +
        '<span style="font-size:15px">🔒</span>' +
        '<span>Registro textual completo de lo conversado con el vecino. Queda como <strong style="color:#334259">comprobante</strong> ante cualquier reclamo.</span>' +
      '</div>';
    }
  }
}
window.renderizarBloqueChat = renderizarBloqueChat;

function abrirDrawerEvento(idx){
  var datos=(window.__EVENTOS__||[])[idx];
  if(!datos)return;
  _drawerActual=datos;
  var panel=document.getElementById('drawer-panel');
  var overlay=document.getElementById('drawer-overlay');
  if(!panel||!overlay)return;
  var esDueno=!!window.__ES_DUENO__;
  var resolverBtn = datos.estKey !== 'resuelto' ? '<button onclick="marcarEventoResuelto(this, '+datos.row+')" style="flex:1.2;height:44px;border:none;border-radius:11px;background:#16A34A;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-green">Confirmar Resuelto</button>' : '';
  var titulo=datos.titulo||'Evento';
  var casoCode = datos.id_evento || ('CASO-' + String(datos.row).padStart(4, '0'));

  var fbHtml='';
  if(esDueno){
    fbHtml='<div style="margin-top:22px"><div style="font-size:13px;font-weight:800;color:#334259;margin-bottom:8px">📝 Tu nota para Marcos</div>'+
      '<div style="display:flex;gap:8px;align-items:flex-end">'+
      '<textarea data-fb-drawer class="inp" style="flex:1;min-height:52px" placeholder="Dejale una nota a Marcos para que aprenda de este caso...">'+escapeHtml(datos.feedback||'')+'</textarea>'+
      '<button onclick="guardarFeedbackDrawer(this,'+datos.row+')" style="height:44px;padding:0 16px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:13.5px;cursor:pointer" class="hv-primary">Guardar</button>'+
      '</div></div>';
  }
  
  var esTrabajoExterno = datos.catKey === 'trabajo_externo' || datos.tipo === 'trabajo_externo' || /trabajo_externo|externo/i.test(datos.tipo || '');
  var badgeExterno = esTrabajoExterno ? '<span style="font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;background:#FEF3C7;color:#92400E;border:1px solid #F59E0B">🧾 Trabajo externo</span>' : '';
  var bannerExterno = esTrabajoExterno ? '<div style="background:#FFFDF5;border:1px solid #FDE68A;border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:#78350F;display:flex;align-items:center;gap:10px"><span style="font-size:22px">🧾</span><div><strong style="display:block;margin-bottom:2px">Trabajo coordinado fuera del sistema</strong>Este caso fue coordinado por el encargado/administración directamente con el proveedor y no ingresó previamente por Marcos IA.</div></div>' : '';

  panel.innerHTML=
    '<div style="background:'+escapeHtml(datos.catBg)+';padding:22px 24px 20px;position:relative" class="drawer-header-box">'+
      '<button onclick="cerrarDrawerEvento()" style="position:absolute;top:16px;right:16px;width:34px;height:34px;border:none;border-radius:999px;background:rgba(255,255,255,.7);cursor:pointer;font-size:17px" class="drawer-close-btn">✕</button>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
        '<span style="font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;background:#EAF1FB;color:#1E5FB4;border:1px solid #C9D5E8">📋 ' + escapeHtml(casoCode) + '</span>'+
        badgeExterno+
        '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:'+escapeHtml(datos.urgBg)+';color:'+escapeHtml(datos.urgFg)+'">'+escapeHtml(datos.urgLabel)+'</span>'+
        '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:'+escapeHtml(datos.estBg)+';color:'+escapeHtml(datos.estFg)+'">'+escapeHtml(datos.estLabel)+'</span>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:13px">'+
        '<span style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.75);display:flex;align-items:center;justify-content:center;font-size:26px" class="drawer-icon-box">'+escapeHtml(datos.catIcon)+'</span>'+
        '<div><div style="font-size:12px;font-weight:700;color:#5A6B85;text-transform:uppercase;letter-spacing:.04em">'+escapeHtml(datos.catLabel)+'</div>'+
        '<div style="font-size:20px;font-weight:800;letter-spacing:-.02em;color:#16233B;line-height:1.2">'+escapeHtml(titulo)+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div style="padding:22px 24px">'+
      bannerExterno+
      // ── Bloques de Comunicación (Vecino vs Proveedor) ──
      (function(){
        var convSep = separarConversacionesEvento(datos);
        var chatVecinoHtml = renderizarBloqueChat(convSep.chatVecino, 'vecino', datos);
        var chatProveedorHtml = renderizarBloqueChat(convSep.chatProveedor, 'proveedor', datos);
        var allAudios = parseAudiosDetallados(datos);
        var bulkBtn = allAudios.length > 1 ? '<button onclick="descargarTodosLosAudiosEvento()" style="height:31px;padding:0 12px;border:1px solid #DCE4F0;border-radius:999px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12px;cursor:pointer;margin-right:6px" class="hv-soft">🎙️ Descargar todos los audios (' + allAudios.length + ')</button>' : '';
        var telVecinoClean = datos.telefono ? String(datos.telefono).replace(/[^0-9]/g, '') : '';
        var telVecinoLink = telVecinoClean ? '<a href="https://wa.me/' + escapeHtml(telVecinoClean) + '" target="_blank" style="color:#2E6FC0;font-weight:700;text-decoration:none">💬 ' + escapeHtml(datos.telefono) + '</a>' : (datos.telefono ? escapeHtml(datos.telefono) : '—');
        
        var rawTechName = (datos.tecnico || '').replace(/[()]/g, '').trim();
        if (!rawTechName) {
          var mProvChat = String(datos.historial_chat || '').match(/Proveedor\s*\(([^)]+)\)/i);
          if (mProvChat && mProvChat[1]) rawTechName = mProvChat[1].trim().replace(/[()]/g, '');
        }

        var tecEncontrado = null;
        var provList = window.__PROVEEDORES__ || [];
        if (rawTechName && Array.isArray(provList)) {
          tecEncontrado = provList.find(function(p) {
            var pNom = String(p.nombre || p.proveedor || '').toLowerCase().trim();
            var tNom = rawTechName.toLowerCase().trim();
            return pNom && (pNom === tNom || pNom.includes(tNom) || tNom.includes(pNom));
          });
        }

        var telTecnicoFinal = datos.tel_tecnico || (tecEncontrado ? (tecEncontrado.telefono || tecEncontrado.celular || '') : '');
        var rubroTecnicoFinal = datos.rubro_tecnico || (tecEncontrado ? (tecEncontrado.rubro || tecEncontrado.especialidad || '') : (rawTechName ? 'Especialista Asignado' : '—'));
        var tecNombreFinal = rawTechName || (tecEncontrado ? tecEncontrado.nombre : 'Sin asignación aún');

        var telTecnicoClean = telTecnicoFinal ? String(telTecnicoFinal).replace(/[^0-9]/g, '') : '';
        var telTecnicoLink = telTecnicoClean ? '<a href="https://wa.me/' + escapeHtml(telTecnicoClean) + '" target="_blank" style="color:#2E6FC0;font-weight:700;text-decoration:none">💬 ' + escapeHtml(telTecnicoFinal) + '</a>' : (telTecnicoFinal ? escapeHtml(telTecnicoFinal) : '—');

        return '<div style="display:flex;gap:8px;margin-bottom:18px;background:#F1F5FB;padding:5px;border-radius:14px;border:1px solid #E2E8F0">'+
          '<button id="tab-btn-ambos" onclick="cambiarTabChatEvento(&quot;ambos&quot;)" style="flex:1;padding:9px 12px;border:1px solid #1E5FB4;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#FFFFFF;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:all .15s ease" class="hv-primary">'+
            '👁️ Ver Ambos Bloques'+
          '</button>'+
          '<button id="tab-btn-vecino" onclick="cambiarTabChatEvento(&quot;vecino&quot;)" style="flex:1;padding:9px 12px;border:1px solid #DCE4F0;border-radius:10px;background:#F1F5FB;color:#5A6B85;font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:all .15s ease" class="hv-soft">'+
            '💬 Solo Vecino'+
          '</button>'+
          '<button id="tab-btn-proveedor" onclick="cambiarTabChatEvento(&quot;proveedor&quot;)" style="flex:1;padding:9px 12px;border:1px solid #DCE4F0;border-radius:10px;background:#F1F5FB;color:#5A6B85;font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:all .15s ease" class="hv-soft">'+
            '🛠️ Solo Proveedor'+
          '</button>'+
        '</div>'+
        '<div id="panel-chat-vecino" style="display:block">'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Vecino principal</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:#16233B">'+escapeHtml(datos.vecino||'—')+'</div></div>'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Teléfono</div><div style="font-size:14px;font-weight:700;margin-top:2px">'+telVecinoLink+'</div></div>'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Depto / Unidad</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:#16233B">'+((datos.depto||datos.unidad)?(escapeHtml(datos.depto||'')+( datos.depto&&datos.unidad?' · ':'')+escapeHtml(datos.unidad||'')):'—')+'</div></div>'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Edificio</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:#16233B">'+escapeHtml(obtenerDireccionEdificio(datos))+'</div></div>'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Canal</div><div style="font-size:14px;font-weight:700;margin-top:2px">'+escapeHtml(datos.canalIcon)+' '+escapeHtml(datos.canal)+'</div></div>'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Hora inicio</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:#16233B">'+escapeHtml(datos.when||'—')+'</div></div>'+
            (datos.estKey === 'resuelto' && datos.hora_fin ? '<div style="background:#E7F4EC;border:1px solid #C3E6D0;border-radius:12px;padding:11px 13px;grid-column:span 2"><div style="font-size:10px;font-weight:700;color:#1B7A43;text-transform:uppercase;letter-spacing:.04em">✅ Hora finalización</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:#14532D">'+escapeHtml(datos.hora_fin)+'</div></div>' : '<div style="background:#FBF3DE;border:1px solid #E8D9A0;border-radius:12px;padding:11px 13px;grid-column:span 2"><div style="font-size:10px;font-weight:700;color:#8A6410;text-transform:uppercase;letter-spacing:.04em">⏳ Hora finalización</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:#8A6410">Sin registrar (Evento en curso)</div></div>')+
          '</div>'+
          (function(){
            var invList = parseInvolucrados(datos);
            if (!invList.length) return '';
            return '<div style="margin-bottom:18px;background:#F8FAFD;border:1px solid #E2E8F0;border-radius:14px;padding:14px 16px">'+
              '<div style="font-size:12.5px;font-weight:800;color:#16233B;margin-bottom:10px;display:flex;align-items:center;gap:6px">👥 Contactos Involucrados (' + invList.length + ')</div>'+
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">'+
                invList.map(function(c) {
                  var rolBadgeBg = '#EAF1FB', rolBadgeFg = '#1E5FB4';
                  if (/titular|propietario/i.test(c.rol)) { rolBadgeBg = '#E7F4EC'; rolBadgeFg = '#1B7A43'; }
                  else if (/familiar/i.test(c.rol)) { rolBadgeBg = '#FBF3DE'; rolBadgeFg = '#8A6410'; }
                  var telHtml = c.telefono ? '<a href="https://wa.me/' + escapeHtml(c.telefono.replace(/[^0-9]/g, '')) + '" target="_blank" style="font-size:12px;color:#2E6FC0;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:3px" class="hv-soft">💬 ' + escapeHtml(c.telefono) + '</a>' : '<span style="font-size:12px;color:#8595AD">Sin teléfono</span>';
                  return '<div style="background:#fff;border:1px solid #E7ECF3;border-radius:11px;padding:9px 12px;display:flex;align-items:center;gap:10px">'+
                    '<span style="width:34px;height:34px;border-radius:50%;background:#EEF2F8;color:#2E6FC0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13.5px;flex-shrink:0">' + escapeHtml((c.nombre || 'V').charAt(0).toUpperCase()) + '</span>'+
                    '<div style="flex:1;min-width:0">'+
                      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
                        '<span style="font-size:13px;font-weight:800;color:#16233B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(c.nombre) + '</span>'+
                        '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:' + rolBadgeBg + ';color:' + rolBadgeFg + '">' + escapeHtml(c.rol) + '</span>'+
                      '</div>'+
                      '<div style="margin-top:2px">' + telHtml + (c.depto ? ' · <span style="font-size:11.5px;color:#64748B;font-weight:600">🏠 ' + escapeHtml(c.depto) + '</span>' : '') + '</div>'+
                    '</div>'+
                  '</div>';
                }).join('')+
              '</div>'+
            '</div>';
          })()+
          '<div style="margin-top:16px">'+
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px">'+
              '<div style="font-size:13px;font-weight:800;color:#334259">💬 Conversación Vecino y Marcos IA</div>'+
              '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
                bulkBtn+
                '<button onclick="descargarResumenEvento(&quot;vecino&quot;)" style="height:31px;padding:0 12px;border:1px solid #DCE4F0;border-radius:999px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12px;cursor:pointer" class="hv-soft">⬇ Descargar TXT Vecino</button>'+
              '</div>'+
            '</div>'+
            chatVecinoHtml+
          '</div>'+
        '</div>'+
        '<div id="panel-chat-proveedor" style="display:block;margin-top:20px">'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'+
            '<div class="drawer-grid-card" style="grid-column:span 2;background:#FFFDF5;border:1px solid #FDE68A">'+
              '<div style="font-size:10px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:.04em">🔧 Técnico / Proveedor Asignado</div>'+
              '<div style="font-size:15px;font-weight:800;margin-top:3px;color:#78350F">'+escapeHtml(tecNombreFinal)+'</div>'+
            '</div>'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Teléfono Técnico</div><div style="font-size:14px;font-weight:700;margin-top:2px">'+telTecnicoLink+'</div></div>'+
            '<div class="drawer-grid-card"><div style="font-size:10px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.04em">Rubro / Especialidad</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:#16233B">'+escapeHtml(rubroTecnicoFinal)+'</div></div>'+
          '</div>'+
          '<div style="margin-top:16px">'+
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px">'+
              '<div style="font-size:13px;font-weight:800;color:#334259">🛠️ Conversación Técnico y Marcos IA</div>'+
              '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
                '<button onclick="descargarResumenEvento(&quot;proveedor&quot;)" style="height:31px;padding:0 12px;border:1px solid #DCE4F0;border-radius:999px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12px;cursor:pointer" class="hv-soft">⬇ Descargar TXT Proveedor</button>'+
              '</div>'+
            '</div>'+
            chatProveedorHtml+
          '</div>'+
        '</div>';
      })()+

      fbHtml+
      '<div style="display:flex;gap:10px;margin-top:22px">'+
        '<button onclick="cerrarDrawerEvento()" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cerrar</button>'+
        resolverBtn+
        (esDueno?'':'<button onclick="location.href=\\\'/admin/sugerencias\\\';" style="flex:1;height:44px;border:none;border-radius:11px;background:#17408B;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-navy">Comentar a mi admin</button>')+
      '</div>'+
    '</div>';
  overlay.classList.add('open');
  panel.classList.add('open');

  if (casoCode && typeof fetch === 'function') {
    fetch('/admin/api/mensajes?eventoId=' + encodeURIComponent(casoCode))
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (j && j.ok && Array.isArray(j.mensajes) && j.mensajes.length > 0) {
          datos.chat_pg = j.mensajes;
          var convSep2 = separarConversacionesEvento(datos);

          var panelV = document.getElementById('panel-chat-vecino');
          if (panelV && convSep2.chatVecino.length > 0) {
            var chatVBox = panelV.querySelector('.chat-box');
            if (chatVBox) chatVBox.outerHTML = renderizarBloqueChat(convSep2.chatVecino, 'vecino', datos);
          }
          var panelP = document.getElementById('panel-chat-proveedor');
          if (panelP && convSep2.chatProveedor.length > 0) {
            var chatPBox = panelP.querySelector('.chat-box');
            if (chatPBox) chatPBox.outerHTML = renderizarBloqueChat(convSep2.chatProveedor, 'proveedor', datos);
          }
        }
      })
      .catch(function(e) { console.warn('Error cargando mensajes de PostgreSQL:', e); });
  }
}
window.abrirDrawerEvento = abrirDrawerEvento;
window._abrirDrawerEventoImpl = abrirDrawerEvento;

function cerrarDrawerEvento(){
  var p=document.getElementById('drawer-panel');
  var o=document.getElementById('drawer-overlay');
  if(p)p.classList.remove('open');
  if(o)o.classList.remove('open');
}
window.cerrarDrawerEvento = cerrarDrawerEvento;
window._cerrarDrawerEventoImpl = cerrarDrawerEvento;

function descargarResumenEvento(){
  var d=_drawerActual;
  if(!d)return;
  var chatTexto = '';
  if (d.historial_chat) {
    try {
      var parsed = typeof d.historial_chat === 'string' && d.historial_chat.startsWith('[') ? JSON.parse(d.historial_chat) : d.historial_chat;
      chatTexto = Array.isArray(parsed) ? parsed.join('\\n') : String(d.historial_chat);
    } catch(e) { chatTexto = String(d.historial_chat); }
  }

  // Convertir rutas locales en URLs web absolutas totalmente funcionales
  chatTexto = chatTexto.replace(new RegExp('\\/root\\/marcos\\/[^\\s"\\)]+\\/almacenamiento\\/[^\\s"\\)]+', 'gi'), function(match) {
    return normalizarUrlAudio(match);
  });

  var audios = obtenerAudiosEvento(d);
  var audiosSection = audios.length ? [
    '',
    'NOTAS DE VOZ DEL EVENTO (' + audios.length + ')',
    '----------------------------------',
    audios.map(function(u, i){ return 'Audio #' + (i + 1) + ': ' + u; }).join('\\n')
  ].join('\\n') : '';

  var lineas=[
    'MARCOS IA -- Registro de evento',
    '========================================',
    'Edificio: '+(d.edificio||''),
    'Vecino: '+(d.vecino||''),
    'Depto / Unidad: '+((d.depto||d.unidad)?(d.depto||'')+(d.depto&&d.unidad?' · ':'')+(d.unidad||''):''),
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
    audiosSection,
    '',
    'HISTORIAL COMPLETO DE CONVERSACION',
    '----------------------------------',
    (chatTexto || '(sin conversacion registrada)'),
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
window.descargarResumenEvento = descargarResumenEvento;

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
window.guardarFeedbackDrawer = guardarFeedbackDrawer;

async function marcarEventoResuelto(btn,row){
  if(!confirm('¿Estás seguro de marcar este caso como Resuelto?')) return;
  btn.disabled=true;var old=btn.textContent;btn.textContent='...';
  try{
    var r=await fetch('/admin/api/evento-resolver',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Caso marcado como Resuelto con éxito.','ok');
    if(_drawerActual) {
      _drawerActual.estKey='resuelto';
      _drawerActual.estLabel='Resuelto';
      _drawerActual.estBg='#E7F4EC';
      _drawerActual.estFg='#1B7A43';
    }
    setTimeout(function(){ location.reload(); }, 1200);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
window.marcarEventoResuelto = marcarEventoResuelto;

async function toggleFacturaEstado(btn, row, nuevoEstado){
  if(btn.disabled)return;
  var esPagada = nuevoEstado === 'pagada';
  btn.disabled = true;
  var oldHtml = btn.innerHTML;
  btn.textContent = '...';
  try{
    var r = await fetch('/admin/api/factura-estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: row, estado: nuevoEstado })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error');
    toast(esPagada ? 'Factura marcada como Pagada' : 'Factura marcada como Pendiente', 'ok');
    btn.setAttribute('onclick', "event.stopPropagation(); toggleFacturaEstado(this, " + row + ", '" + (esPagada ? 'pendiente' : 'pagada') + "')");
    btn.style.background = esPagada ? '#E7F4EC' : '#FBF3DE';
    btn.style.color = esPagada ? '#1B7A43' : '#8A6410';
    btn.style.borderColor = esPagada ? '#A3D9B1' : '#F7D070';
    btn.innerHTML = esPagada ? '✓ Pagada' : '⏳ Pendiente';
  }catch(e){
    toast('Error: ' + e.message, 'err');
    btn.innerHTML = oldHtml;
  }finally{
    btn.disabled = false;
  }
}

// ── FACTURAS Y FOTOS: SCRIPT CLIENTE ──
var __facturasState = { clase: '', origen: '', q: '', page: 1 };
var __facturasDebounceTimer = null;
var __facturasDataCache = null;

function onBuscadorInput(val) {
  clearTimeout(__facturasDebounceTimer);
  __facturasDebounceTimer = setTimeout(function() {
    __facturasState.q = val;
    __facturasState.page = 1;
    cargarFacturasDesdeApi();
  }, 300);
}

function cambiarTabClase(clase) {
  __facturasState.clase = clase;
  __facturasState.page = 1;
  cargarFacturasDesdeApi();
}

function cambiarChipOrigen(origen) {
  __facturasState.origen = origen;
  __facturasState.page = 1;
  cargarFacturasDesdeApi();
}

async function cargarFacturasDesdeApi() {
  var container = document.getElementById('facturas-grupos-container');
  if (!container) return; // No estamos en la página de archivos

  var isDark = document.documentElement.classList.contains('dark-theme') || (document.body && document.body.classList.contains('dark-theme'));

  // Actualizar UI de Tabs
  ['', 'Proveedor', 'Gasto fijo'].forEach(function(c) {
    var tabId = c === '' ? 'tab-clase-todos' : (c === 'Proveedor' ? 'tab-clase-proveedor' : 'tab-clase-fijo');
    var el = document.getElementById(tabId);
    if (el) {
      var act = __facturasState.clase === c;
      if (act) {
        el.style.background = '#2E6FC0';
        el.style.color = '#FFFFFF';
        el.style.borderColor = '#2E6FC0';
      } else {
        el.style.background = isDark ? '#151F38' : '#FFFFFF';
        el.style.color = isDark ? '#CBD5E1' : '#475569';
        el.style.borderColor = isDark ? '#2A3A5E' : '#E2E8F0';
      }
    }
  });

  // Actualizar UI de Chips Origen
  ['', 'Marcos IA', 'Encargado', 'Consejo', 'Administrador'].forEach(function(o) {
    var chipId = o === '' ? 'chip-origen-todos' : (o === 'Marcos IA' ? 'chip-origen-marcos' : (o === 'Encargado' ? 'chip-origen-encargado' : (o === 'Consejo' ? 'chip-origen-consejo' : 'chip-origen-admin')));
    var el = document.getElementById(chipId);
    if (el) {
      var act = __facturasState.origen === o;
      if (act) {
        el.style.background = '#1E408B';
        el.style.color = '#FFFFFF';
        el.style.borderColor = '#1E408B';
      } else {
        el.style.background = isDark ? '#151F38' : '#FFFFFF';
        el.style.color = isDark ? '#CBD5E1' : '#475569';
        el.style.borderColor = isDark ? '#2A3A5E' : '#E2E8F0';
      }
    }
  });

  var urlParams = new URLSearchParams(window.location.search);
  var edParam = urlParams.get('edificio') || 'todos';

  var apiParams = new URLSearchParams();
  if (edParam && edParam !== 'todos') apiParams.set('edificio', edParam);
  if (__facturasState.clase) apiParams.set('clase', __facturasState.clase);
  if (__facturasState.origen) apiParams.set('origen', __facturasState.origen);
  if (__facturasState.q) apiParams.set('q', __facturasState.q);
  if (__facturasState.page > 1) apiParams.set('page', __facturasState.page);

  container.innerHTML = '<div style="text-align:center;padding:48px 20px;color:#64748B;font-size:14px;"><i class="ph ph-spinner spin" style="font-size:24px;display:block;margin:0 auto 8px;color:#2E6FC0;"></i>Cargando comprobantes...</div>';

  try {
    var resp = await fetch('/admin/api/facturas?' + apiParams.toString());
    if (!resp.ok) throw new Error('Error al obtener facturas');
    var data = await resp.json();
    __facturasDataCache = data;
    renderizarSeccionFacturas(data);
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:36px;color:#DC2626;border:1px dashed #FCA5A5;background:#FEF2F2;border-radius:14px;">Error al cargar comprobantes: ' + err.message + '</div>';
  }
}

function renderizarSeccionFacturas(data) {
  var container = document.getElementById('facturas-grupos-container');
  if (!container) return;

  var tot = data.totales || {};
  document.getElementById('tot-archivados').textContent = tot.total_facturas || 0;
  document.getElementById('tot-proveedores').textContent = tot.total_proveedor || 0;
  document.getElementById('tot-fijos').textContent = tot.total_gasto_fijo || 0;
  document.getElementById('tot-pendiente').textContent = tot.monto_pendiente_total_texto || '$0,00';

  var edTitulo = document.getElementById('facturas-titulo-edificio');
  if (edTitulo) {
    var urlParams = new URLSearchParams(window.location.search);
    var edName = urlParams.get('edificio');
    edTitulo.textContent = 'Facturas y Fotos' + (edName && edName !== 'todos' ? ' · ' + edName : '');
  }

  var grupos = data.grupos || [];
  if (grupos.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:48px 20px;background:#FFFFFF;border:1px dashed #CBD5E1;border-radius:16px;color:#64748B;font-size:14px;"><i class="ph ph-folder-open" style="font-size:36px;display:block;margin:0 auto 10px;color:#94A3B8;"></i>No se encontraron comprobantes para los filtros seleccionados.</div>';
    return;
  }

  var html = '';

  grupos.forEach(function(g) {
    var esFijo = g.clase === 'Gasto fijo';
    var iconHead = esFijo ? 'ph-lightning' : 'ph-wrench';

    html += '<div style="margin-bottom: 32px;">';
    // Group Header
    html += '  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">';
    html += '    <i class="ph ' + iconHead + '" style="font-size: 20px; color: #2E6FC0;"></i>';
    html += '    <h3 class="factura-grupo-titulo" style="font-size: 17.5px; font-weight: 700; color: #0F172A; margin: 0;">' + g.titulo + '</h3>';
    html += '    <span class="factura-badge-count" style="font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: #F1F5F9; border: 1px solid #E2E8F0; color: #475569;">' + g.conteo + '</span>';
    html += '    <div style="flex: 1; height: 1px; background: linear-gradient(90deg, #CBD5E1 0%, transparent 100%); margin: 0 8px;"></div>';
    html += '    <div style="font-size: 13px; color: #64748B; display: flex; align-items: center; gap: 6px;">';
    html += '      <span>' + g.pendientes + ' pendientes</span>';
    html += '      <span>·</span>';
    html += '      <span style="color: #D97706; font-weight: 700;">' + g.monto_pendiente_texto + '</span>';
    html += '    </div>';
    html += '  </div>';

    // Items List
    html += '  <div style="display: flex; flex-direction: column; gap: 8px;">';
    g.items.forEach(function(item) {
      var isPdf = item.tipo === 'Factura PDF' || (item.url_archivo && item.url_archivo.toLowerCase().endsWith('.pdf'));
      var isPagada = item.estado === 'Pagada';
      var iconType = isPdf ? 'ph-file-pdf' : 'ph-image';
      var iconBg = isPdf ? '#FEF3C7' : '#D1FAE5';
      var iconColor = isPdf ? '#D97706' : '#059669';

      var isMarcos = item.origen === 'Marcos IA' || item.origen === 'Susana IA' || item.origen_nombre === 'Marcos IA' || item.origen_nombre === 'Susana IA';
      var origIcon = isMarcos ? 'ph-robot' : (item.origen === 'Encargado' ? 'ph-user-gear' : (item.origen === 'Consejo' ? 'ph-users-three' : 'ph-briefcase'));
      var origNombre = isMarcos ? (item.origen_nombre || 'Marcos IA') : (item.origen_nombre || item.origen);

      var dirEdificionHtml = item.edificio_direccion ? ' <span style="font-weight:600;opacity:0.88;" title="Dirección física del consorcio">(📍 ' + escapeHtml(item.edificio_direccion) + ')</span>' : '';

      var casoHtml = item.codigo_caso
        ? ' <span class="factura-badge-caso" style="color: #059669; font-weight: 700; background: #D1FAE5; padding: 1px 7px; border-radius: 4px; border: 1px solid #6EE7B7;" title="Código de reparación asignado">📌 Caso ' + escapeHtml(item.codigo_caso) + '</span>'
        : ' <span class="factura-badge-nocaso" style="color: #64748B; font-weight: 600; background: #F1F5F9; padding: 1px 7px; border-radius: 4px; border: 1px solid #E2E8F0;" title="Sin caso de reparación asignado">Sin caso asignado</span>';

      var dirFacturaHtml = '';
      if (item.direccion_factura) {
        var isDiff = item.edificio_direccion && item.direccion_factura.toLowerCase().indexOf(item.edificio_direccion.toLowerCase()) === -1 && item.edificio_direccion.toLowerCase().indexOf(item.direccion_factura.toLowerCase()) === -1;
        if (isDiff) {
          dirFacturaHtml = ' <span class="factura-badge-dir-warn" style="color: #B45309; font-weight: 700; background: #FEF3C7; padding: 1px 7px; border-radius: 4px; border: 1px solid #FDE68A;" title="¡Atención! La dirección impresa en la factura difiere del edificio asignado">⚠️ Dir. en factura: ' + escapeHtml(item.direccion_factura) + '</span>';
        } else {
          dirFacturaHtml = ' <span class="factura-badge-dir" style="color: #0284C7; font-weight: 600; background: #E0F2FE; padding: 1px 7px; border-radius: 4px; border: 1px solid #BAE6FD;" title="Dirección impresa en el comprobante">📍 Dir. en factura: ' + escapeHtml(item.direccion_factura) + '</span>';
        }
      }

      html += '    <div class="row-item-hover" style="display: grid; grid-template-columns: 40px minmax(0, 1fr) 170px 150px 140px; gap: 14px; align-items: center; padding: 11px 16px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); transition: all .15s ease; position: relative;">';

      // 1. Icon Box
      html += '      <div style="width: 40px; height: 40px; border-radius: 999px; background: ' + iconBg + '; display: flex; align-items: center; justify-content: center;">';
      html += '        <i class="ph ' + iconType + '" style="font-size: 22px; color: ' + iconColor + ';"></i>';
      html += '      </div>';

      // 2. Concept & Meta
      html += '      <div style="min-width: 0;">';
      html += '        <div class="factura-concepto-title" style="font-size: 14.5px; font-weight: 700; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (item.concepto || 'Sin concepto') + '</div>';
      html += '        <div class="factura-meta-text" style="font-size: 12px; color: #64748B; margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">';
      html += '          <span class="factura-badge-edificio" style="color: #1E5FB4; font-weight: 700; background: #EFF6FF; padding: 1px 7px; border-radius: 4px; border: 1px solid #BFDBFE;">🏢 ' + item.edificio + dirEdificionHtml + '</span>';
      html += '          <span>·</span>';
      html += '          ' + casoHtml;
      html += '          <span>·</span>';
      html += '          ' + (dirFacturaHtml ? dirFacturaHtml + ' <span>·</span> ' : '');
      html += '          <span>N° ' + item.numero_factura + '</span>';
      html += '          <span>·</span>';
      html += '          <span>' + item.fecha_texto + '</span>';
      html += '          <span class="factura-badge-tipo" style="font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: #F1F5F9; border: 1px solid #E2E8F0; color: #475569;">' + item.tipo + '</span>';
      html += '        </div>';
      html += '      </div>';

      // 3. Responsable Column
      html += '      <div style="min-width: 0;">';
      html += '        <div class="factura-proveedor-title" style="font-size: 13.5px; font-weight: 700; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (item.proveedor || item.categoria || '—') + '</div>';
      html += '        <div class="factura-meta-text" style="font-size: 11.5px; color: #64748B; margin-top: 3px; display: flex; align-items: center; gap: 4px;">';
      html += '          <i class="ph ' + origIcon + '" style="font-size: 14px; color: #2E6FC0;"></i>';
      html += '          <span>' + origNombre + '</span>';
      html += '        </div>';
      html += '      </div>';

      // 4. Amount & Status
      html += '      <div style="text-align: right;">';
      html += '        <div class="factura-monto-title" style="font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; color: #0F172A;">' + item.monto + '</div>';
      html += '        <div style="margin-top: 3px;">';
      if (isPagada) {
        html += '          <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #DCFCE7; border: 1px solid #86EFAC; color: #15803D;"><i class="ph ph-check-circle"></i>Pagada</span>';
      } else {
        html += '          <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #FEF3C7; border: 1px solid #FDE68A; color: #B45309;"><i class="ph ph-clock"></i>Pendiente</span>';
      }
      html += '        </div>';
      html += '      </div>';

      // 5. Actions Column
      html += '      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px; position: relative;">';
      if (item.url_archivo) {
        html += '        <a href="' + item.url_archivo + '" target="_blank" class="btn-factura-sec" style="padding: 6px 10px; font-size: 12.5px;" title="Ver comprobante"><i class="ph ph-eye"></i>Ver</a>';
        html += '        <a href="/admin/api/facturas/' + encodeURIComponent(item.factura_key) + '/archivo?descargar=1" class="btn-factura-sec" style="padding: 6px 9px; font-size: 13.5px;" title="Descargar archivo"><i class="ph ph-download-simple"></i></a>';
      }
      html += '        <button type="button" class="btn-factura-sec" onclick="togglePopoverMenu(this, &quot;' + encodeURIComponent(item.factura_key) + '&quot;)" style="padding: 6px 9px; font-size: 15px;" title="Opciones"><i class="ph ph-dots-three"></i></button>';
      html += '      </div>';

      html += '    </div>';
    });
    html += '  </div>';
    html += '</div>';
  });

  container.innerHTML = html;
}

function togglePopoverMenu(btn, encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var item = null;
  if (__facturasDataCache && __facturasDataCache.grupos) {
    for (var i = 0; i < __facturasDataCache.grupos.length; i++) {
      var found = __facturasDataCache.grupos[i].items.find(function(x) { return x.factura_key === key; });
      if (found) { item = found; break; }
    }
  }
  if (!item) return;

  // Cerrar popovers abiertos y resetear z-index de filas
  document.querySelectorAll('.row-item-hover').forEach(function(r) { r.style.zIndex = '1'; });
  document.querySelectorAll('.popover-facturas-menu').forEach(function(p) { p.remove(); });

  var row = btn.closest('.row-item-hover');
  if (row) row.style.zIndex = '1000';

  var parent = btn.parentElement;
  var pop = document.createElement('div');
  pop.className = 'popover-facturas-menu';

  var isPagada = item.estado === 'Pagada';
  var esFijo = item.clase === 'Gasto fijo';

  var h = '';
  if (item.url_archivo) {
    h += '<a href="' + item.url_archivo + '" target="_blank" class="popover-item-btn"><i class="ph ph-eye" style="font-size:16px;color:#2E6FC0;"></i><span>Ver comprobante</span></a>';
    h += '<a href="/admin/api/facturas/' + encodeURIComponent(item.factura_key) + '/archivo?descargar=1" class="popover-item-btn"><i class="ph ph-download-simple" style="font-size:16px;color:#2E6FC0;"></i><span>Descargar archivo</span></a>';
    h += '<div style="height:1px;background:#E2E8F0;margin:4px 0;"></div>';
  }

  h += '<button type="button" class="popover-item-btn" onclick="abrirModalEditarDocumento(&quot;' + encodeURIComponent(key) + '&quot;)"><i class="ph ph-pencil-simple" style="font-size:16px;color:#475569;"></i><span>Editar monto y fecha</span></button>';
  h += '<button type="button" class="popover-item-btn" onclick="abrirModalCambiarOrigen(&quot;' + encodeURIComponent(key) + '&quot;)"><i class="ph ph-user-switch" style="font-size:16px;color:#475569;"></i><span>Cambiar quién lo cargó</span></button>';
  h += '<button type="button" class="popover-item-btn" onclick="moverClaseFacturaKey(&quot;' + encodeURIComponent(key) + '&quot;, &quot;' + (esFijo ? 'Proveedor' : 'Gasto fijo') + '&quot;)"><i class="ph ph-arrows-down-up" style="font-size:16px;color:#475569;"></i><span>' + (esFijo ? 'Mover a Proveedores' : 'Mover a Gastos fijos') + '</span></button>';

  h += '<div style="height:1px;background:#E2E8F0;margin:4px 0;"></div>';

  if (isPagada) {
    h += '<button type="button" class="popover-item-btn" onclick="cambiarEstadoFacturaKey(&quot;' + encodeURIComponent(key) + '&quot;, &quot;Pendiente&quot;)"><i class="ph ph-clock" style="font-size:16px;color:#D97706;"></i><span>Marcar como Pendiente</span></button>';
  } else {
    h += '<button type="button" class="popover-item-btn" onclick="cambiarEstadoFacturaKey(&quot;' + encodeURIComponent(key) + '&quot;, &quot;Pagada&quot;)"><i class="ph ph-check-circle" style="font-size:16px;color:#16A34A;"></i><span>Marcar como Pagada</span></button>';
  }

  h += '<button type="button" class="popover-item-btn" onclick="enviarConsejoFacturaKey(&quot;' + encodeURIComponent(key) + '&quot;)"><i class="ph ph-paper-plane-tilt" style="font-size:16px;color:#2E6FC0;"></i><span>Enviar al consejo por mail/WSP</span></button>';

  h += '<div style="height:1px;background:#E2E8F0;margin:4px 0;"></div>';

  h += '<button type="button" class="popover-item-btn" style="color:#DC2626;" onclick="eliminarFacturaKey(&quot;' + encodeURIComponent(key) + '&quot;)"><i class="ph ph-trash" style="font-size:16px;color:#DC2626;"></i><span>Eliminar del archivo</span></button>';

  pop.innerHTML = h;
  parent.appendChild(pop);

  // Auto-cerrar al hacer clic fuera
  setTimeout(function() {
    function cerrarPop(e) {
      if (!pop.contains(e.target) && e.target !== btn) {
        pop.remove();
        if (row) row.style.zIndex = '1';
        document.removeEventListener('click', cerrarPop);
      }
    }
    document.addEventListener('click', cerrarPop);
  }, 10);
}

async function cambiarEstadoFacturaKey(encodedKey, nuevoEstado) {
  var key = decodeURIComponent(encodedKey);
  try {
    var resp = await fetch('/admin/api/facturas/' + encodeURIComponent(key), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    if (!resp.ok) throw new Error('Error al actualizar estado');
    toast('Comprobante marcado como ' + nuevoEstado, 'ok');
    cargarFacturasDesdeApi();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function moverClaseFacturaKey(encodedKey, nuevaClase) {
  var key = decodeURIComponent(encodedKey);
  try {
    var resp = await fetch('/admin/api/facturas/' + encodeURIComponent(key), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clase: nuevaClase })
    });
    if (!resp.ok) throw new Error('Error al mover clase');
    toast('Movido a ' + nuevaClase, 'ok');
    cargarFacturasDesdeApi();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function eliminarFacturaKey(encodedKey) {
  if (!confirm('¿Seguro que deseas eliminar este comprobante del archivo?')) return;
  var key = decodeURIComponent(encodedKey);
  try {
    var resp = await fetch('/admin/api/facturas/' + encodeURIComponent(key), {
      method: 'DELETE'
    });
    if (!resp.ok) throw new Error('Error al eliminar');
    toast('Comprobante eliminado del archivo', 'ok');
    cargarFacturasDesdeApi();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function enviarConsejoFacturaKey(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  try {
    var resp = await fetch('/admin/api/facturas/' + encodeURIComponent(key) + '/enviar-consejo', {
      method: 'POST'
    });
    if (!resp.ok) throw new Error('Error al enviar');
    toast('Comprobante enviado al consejo por mail y WhatsApp', 'ok');
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function abrirModalSubirDocumento() {
  toast('Modal de subida listo. Podés arrastrar o seleccionar archivos.', 'info');
}

function abrirModalEditarDocumento(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var nuevoMonto = prompt('Ingresá el nuevo monto (o dejá "Según comprobante"):');
  if (nuevoMonto === null) return;
  fetch('/admin/api/facturas/' + encodeURIComponent(key), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto: nuevoMonto.trim() || 'Según comprobante' })
  }).then(function(r) { return r.json(); }).then(function() {
    toast('Monto actualizado', 'ok');
    cargarFacturasDesdeApi();
  }).catch(function(e) { toast('Error: ' + e.message, 'err'); });
}

function abrirModalCambiarOrigen(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var nuevoOrigen = prompt('Ingresá el origen (Encargado, Consejo, Administrador):');
  if (!nuevoOrigen) return;
  fetch('/admin/api/facturas/' + encodeURIComponent(key), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origen: nuevoOrigen.trim() })
  }).then(function(r) { return r.json(); }).then(function() {
    toast('Origen actualizado', 'ok');
    cargarFacturasDesdeApi();
  }).catch(function(e) { toast('Error: ' + e.message, 'err'); });
}

function abrirModalFiltrosAvanzados() {
  toast('Filtros avanzados listos.', 'info');
}

document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('facturas-grupos-container')) {
    cargarFacturasDesdeApi();
  }
});

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
    else if(modo==='urgentes')show=r.getAttribute('data-urg')==='alta' && r.getAttribute('data-est')!=='resuelto';
    else if(modo==='abiertos')show=r.getAttribute('data-est')!=='resuelto';
    else if(modo==='resueltos')show=r.getAttribute('data-est')==='resuelto';
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
  var inWrap=document.getElementById('req-nuevo-input-wrap');
  var selWrap=document.getElementById('req-nuevo-select-wrap');
  if(campo==='plan'){
    if(inWrap)inWrap.style.display='none';
    if(selWrap)selWrap.style.display='block';
  }else{
    if(inWrap)inWrap.style.display='block';
    if(selWrap)selWrap.style.display='none';
  }
  abrirModal('modal-solicitud');
}
async function enviarSolicitud(btn){
  var nuevo = _reqCampo === 'plan'
    ? ((document.getElementById('req-nuevo-plan')||{}).value||'')
    : ((document.getElementById('req-nuevo')||{}).value||'');
  var motivo=(document.getElementById('req-motivo')||{}).value||'';
  if(!nuevo.trim()){toast('Seleccioná o escribí el valor nuevo','err');return;}
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

var _planAcEdificioTarget = '';
function abrirModalPlanesAc(edificioNombre) {
  _planAcEdificioTarget = edificioNombre || '';
  abrirModal('modal-planes-ac');
}

async function solicitarPlanCat(planNombre, modoLote) {
  var edificio = modoLote === 'todos' ? 'Todos los edificios del cliente' : (_planAcEdificioTarget || '');
  var valorNuevo = planNombre + (modoLote === 'todos' ? ' (Paquete Corporativo)' : '');
  try {
    var r = await fetch('/admin/api/solicitar-cambio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campo: 'plan', valorNuevo: valorNuevo, edificio: edificio, motivo: 'Solicitud desde el catálogo de planes (' + (modoLote === 'todos' ? 'Paquete Corporativo' : 'Individual') + ')' })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al enviar solicitud');
    cerrarModal('modal-planes-ac');
    toast('Solicitud de cambio a "' + planNombre + '" enviada con éxito.', 'ok');
    setTimeout(function() { location.reload(); }, 1000);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function escStr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

var _corpPlanNombre = '';
var _corpLimiteCupos = 5;
var _corpEdificiosLista = [];

function abrirSolicitudCorporativa(planNombre, limiteCupos, edificiosJsonStr) {
  _corpPlanNombre = planNombre;
  _corpLimiteCupos = Number(limiteCupos) || 5;
  try {
    _corpEdificiosLista = JSON.parse(edificiosJsonStr || '[]');
  } catch (e) {
    _corpEdificiosLista = [];
  }

  var lblPlan = document.getElementById('corp-plan-nombre');
  if (lblPlan) lblPlan.textContent = planNombre + ' (' + _corpLimiteCupos + ' Edificios)';

  var yaEnPaquete = _corpEdificiosLista.filter(function(e) {
    var pName = String(e.plan || '').toLowerCase();
    return pName.includes('corporativo') || pName.includes(planNombre.toLowerCase());
  });

  var container = document.getElementById('corp-edificios-checklist');
  if (container) {
    if (_corpEdificiosLista.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;color:#8595AD">No tenés edificios registrados aún.</div>';
    } else {
      container.innerHTML = _corpEdificiosLista.map(function(e, idx) {
        var pName = String(e.plan || '').toLowerCase();
        var perteneceYa = pName.includes('corporativo') || (planNombre && pName.includes(planNombre.toLowerCase()));
        var autoChecked = yaEnPaquete.length > 0 ? perteneceYa : idx < _corpLimiteCupos;

        var statusBadge = autoChecked
          ? '<span class="corp-status-tag" style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#E7F4EC;color:#1B7A43">✓ En el Paquete</span>'
          : '<span class="corp-status-tag" style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#F1F5FB;color:#64748B">Plan Individual</span>';
        var safeNombre = escStr(e.nombre);
        var safeDir = escStr(e.direccion || e.nombre);
        var safePlan = escStr(e.plan || 'Base');
        return '<label style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#fff;border:1.5px solid #E4E9F1;border-radius:12px;cursor:pointer;gap:12px" class="hv-card">' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<input type="checkbox" class="chk-corp-item" value="' + safeNombre + '" ' + (autoChecked ? 'checked' : '') + ' data-pertenece="' + (perteneceYa ? '1' : '0') + '" onchange="recalcularCuposCorp()" style="width:18px;height:18px;accent-color:#2E6FC0">' +
            '<div>' +
              '<div style="font-size:14.5px;font-weight:700;color:#16233B">' + safeNombre + '</div>' +
              '<div style="font-size:12px;color:#8595AD">' + safeDir + ' · Plan actual: ' + safePlan + '</div>' +
            '</div>' +
          '</div>' +
          statusBadge +
        '</label>';
      }).join('');
    }
  }

  recalcularCuposCorp();
  cerrarModal('modal-planes-ac');
  abrirModal('modal-solicitud-corporativa');
}

function recalcularCuposCorp() {
  var chks = document.querySelectorAll('.chk-corp-item');
  var count = 0;
  chks.forEach(function(chk) {
    var label = chk.closest('label');
    var tag = label ? label.querySelector('.corp-status-tag') : null;
    var perteneceYa = chk.getAttribute('data-pertenece') === '1';

    if (chk.checked) {
      count++;
      if (tag) {
        if (perteneceYa) {
          tag.textContent = '✓ Mantiene en Paquete';
          tag.style.background = '#E7F4EC';
          tag.style.color = '#1B7A43';
        } else {
          tag.textContent = '➕ Adherir al Paquete';
          tag.style.background = '#EAF1FB';
          tag.style.color = '#2E6FC0';
        }
      }
    } else {
      if (tag) {
        if (perteneceYa) {
          tag.textContent = '❌ Quitar del Paquete';
          tag.style.background = '#FDF2F2';
          tag.style.color = '#C0392B';
        } else {
          tag.textContent = 'Plan Individual';
          tag.style.background = '#F1F5FB';
          tag.style.color = '#64748B';
        }
      }
    }
  });

  var counterEl = document.getElementById('corp-counter');
  if (counterEl) {
    counterEl.textContent = count + ' / ' + _corpLimiteCupos;
    if (count > _corpLimiteCupos) {
      counterEl.style.color = '#C0392B';
    } else {
      counterEl.style.color = '#2E6FC0';
    }
  }
}

async function enviarSolicitudCorporativa(btn) {
  var chks = document.querySelectorAll('.chk-corp-item');
  var seleccionados = [];
  var excluidos = [];
  chks.forEach(function(chk) {
    if (chk.checked) seleccionados.push(chk.value);
    else excluidos.push(chk.value);
  });

  if (seleccionados.length === 0) {
    toast('Seleccioná al menos 1 edificio para el paquete corporativo', 'err');
    return;
  }
  if (seleccionados.length > _corpLimiteCupos) {
    toast('Seleccionaste ' + seleccionados.length + ' edificios. El cupo máximo del plan es ' + _corpLimiteCupos, 'err');
    return;
  }

  var motivoObs = (document.getElementById('corp-motivo') || {}).value || '';
  var detalleMotivo = 'Paquete Corporativo (' + _corpPlanNombre + '). Edificios asignados (' + seleccionados.length + '): [' + seleccionados.join(', ') + ']';
  if (excluidos.length > 0) {
    detalleMotivo += ' · Fuera de paquete (Plan Individual): [' + excluidos.join(', ') + ']';
  }
  if (motivoObs.trim()) {
    detalleMotivo += ' · Nota cliente: ' + motivoObs.trim();
  }

  btn.disabled = true; var old = btn.textContent; btn.textContent = 'Guardando cambios...';
  try {
    var r = await fetch('/admin/api/adherir-plan-corporativo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: _corpPlanNombre,
        cupos: _corpLimiteCupos,
        seleccionados: seleccionados,
        excluidos: excluidos,
        motivo: detalleMotivo
      })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al procesar');
    cerrarModal('modal-solicitud-corporativa');
    toast(j.mensaje || '¡Paquete Corporativo actualizado con éxito!', 'ok');
    setTimeout(function() { location.reload(); }, 900);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
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
  var sw=document.getElementById('suplente-horario-wrap');
  if(sw)sw.style.display=estado!=='activo'?'block':'none';
}
function valEl(id){var e=document.getElementById(id);return e?e.value:'';}
async function guardarEncargadoHorario(btn){
  var data={
    encargado_estado: valEl('enc-estado-val'),
    encargado_horario: JSON.stringify({
      lv1:[valEl('enc-lv1a'),valEl('enc-lv1b')],
      lv2:[valEl('enc-lv2a'),valEl('enc-lv2b')],
      sab:[valEl('enc-saba'),valEl('enc-sabb')]
    }),
    suplente_horario: JSON.stringify({
      lv1:[valEl('sup-lv1a'),valEl('sup-lv1b')],
      lv2:[valEl('sup-lv2a'),valEl('sup-lv2b')],
      sab:[valEl('sup-saba'),valEl('sup-sabb')]
    })
  };
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/mi-edificio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-encargado-horario');
    toast('Estado y horario guardados','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
// Editar un campo directo (sin aprobación) de "Mi Edificio" vía modal chico.
var _ecCampo=null;
function abrirEditarCampo(campo,label,actual,placeholder,ayuda){
  _ecCampo=campo;
  var l=document.getElementById('ec-label');if(l)l.textContent=label;
  var v=document.getElementById('ec-valor');if(v){v.value=actual||'';v.placeholder=placeholder||'';}
  var a=document.getElementById('ec-ayuda');
  if(a){ if(ayuda){a.textContent=ayuda;a.style.display='block';} else {a.style.display='none';} }
  var p=document.getElementById('ec-pdf-wrap');
  if(p){ p.style.display=(campo==='horario_sum')?'block':'none'; }
  abrirModal('modal-editar-campo');
}
async function guardarCampoEditado(btn){
  var valor=(document.getElementById('ec-valor')||{}).value||'';
  var data={};data[_ecCampo]=valor;
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    if(_ecCampo==='horario_sum'){
      var pdfInp=document.getElementById('ec-pdf-file');
      var pdfFile=pdfInp&&pdfInp.files?pdfInp.files[0]:null;
      if(pdfFile){
        btn.textContent='Subiendo PDF...';
        var base64=await new Promise(function(resolve,reject){
          var reader=new FileReader();
          reader.onload=function(e){resolve(e.target.result);};
          reader.onerror=reject;
          reader.readAsDataURL(pdfFile);
        });
        var curEd=(window.__CUR_BUILDING__||{}).nombre||'';
        var pr=await fetch('/admin/api/subir-pdf-reglamento',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({edificio:curEd,pdfBase64:base64,filename:pdfFile.name})
        });
        var pj=await pr.json();
        if(!pr.ok||pj.error)throw new Error(pj.error||'Error al subir PDF');
      }
    }
    var r=await fetch('/admin/api/mi-edificio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-editar-campo');
    toast('Dato guardado','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
// Agregar proveedor a la lista maestra del cliente (una sola vez).
async function agregarProveedor(btn){
  var rubro=(document.getElementById('prov-rubro')||{}).value||'';
  var nombre=(document.getElementById('prov-nombre')||{}).value||'';
  var tel=(document.getElementById('prov-tel')||{}).value||'';
  var notas=(document.getElementById('prov-notas')||{}).value||'';
  // Datos de cobro, opcionales. Van en el alta para no tener que volver a entrar si ya se
  // tienen a mano. El servidor verifica el CBU y rechaza el alta si está mal escrito.
  var cbu=((document.getElementById('prov-cbu')||{}).value||'').replace(/\\D/g,'');
  var alias=((document.getElementById('prov-alias')||{}).value||'').trim();
  var titular=((document.getElementById('prov-titular')||{}).value||'').trim();
  var cuit=((document.getElementById('prov-cuit')||{}).value||'').replace(/\\D/g,'');
  if(!nombre.trim()&&!tel.trim()){toast('Cargá al menos nombre o teléfono','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Agregando...';
  try{
    var r=await fetch('/admin/api/proveedor',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rubro:rubro,nombre:nombre.trim(),telefono:tel.trim(),notas:notas.trim(),
        cbu:cbu,alias:alias,titular:titular,cuit:cuit})});
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
function abrirEditarProveedor(row, rubro, nombre, tel, notas){
  var r=document.getElementById('edit-prov-row');if(r)r.value=row;
  var rb=document.getElementById('edit-prov-rubro');if(rb)rb.value=rubro||'Otro';
  var n=document.getElementById('edit-prov-nombre');if(n)n.value=nombre||'';
  var t=document.getElementById('edit-prov-tel');if(t)t.value=tel||'';
  var nt=document.getElementById('edit-prov-notas');if(nt)nt.value=notas||'';
  abrirModal('modal-editar-proveedor');
}
async function guardarEditarProveedor(btn){
  var row=valEl('edit-prov-row');
  var rubro=valEl('edit-prov-rubro');
  var nombre=valEl('edit-prov-nombre');
  var tel=valEl('edit-prov-tel');
  var notas=valEl('edit-prov-notas');
  if(!nombre.trim()&&!tel.trim()){toast('Cargá al menos nombre o teléfono','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/proveedor-editar',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row,rubro:rubro,nombre:nombre.trim(),telefono:tel.trim(),notas:notas.trim()})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-editar-proveedor');
    toast('Proveedor actualizado','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
window.guardarEditarProveedor = guardarEditarProveedor;

// ── GESTIÓN DE AMENITIES Y ESPACIOS COMUNES (CLIENTE) ──
function abrirModalAmenityNuevo(edificio) {
  var e = document.getElementById('amenity-nuevo-edificio');
  if (e) e.value = edificio || '';
  abrirModal('modal-amenity-nuevo');
}
window.abrirModalAmenityNuevo = abrirModalAmenityNuevo;

async function guardarAmenityNuevo(btn) {
  var edificio = valEl('amenity-nuevo-edificio');
  var nombre = valEl('amenity-nuevo-nombre');
  var icono = valEl('amenity-nuevo-icono') || '🎉';
  var apertura = valEl('amenity-nuevo-apertura') || '08:00';
  var cierre = valEl('amenity-nuevo-cierre') || '23:00';
  var capacidad = valEl('amenity-nuevo-capacidad') || '20';
  var descripcion = valEl('amenity-nuevo-desc') || '';
  var reglamento = valEl('amenity-nuevo-reglamento') || '';
  var chkArancel = document.getElementById('amenity-nuevo-arancelado');
  var arancelado = chkArancel ? chkArancel.checked : false;
  var precio = valEl('amenity-nuevo-precio') || '0';

  if (!nombre.trim()) {
    toast('Ingresá el nombre del espacio común (ej: SUM, Piscina, Gimnasio)', 'err');
    return;
  }

  btn.disabled = true;
  var old = btn.textContent;
  btn.textContent = 'Guardando...';

  try {
    var r = await fetch('/admin/api/edificio-amenity-guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        edificio: edificio,
        nombre: nombre.trim(),
        icono: icono.trim(),
        hora_apertura: apertura,
        hora_cierre: cierre,
        capacidad: parseInt(capacidad, 10) || 20,
        descripcion: descripcion.trim(),
        reglamento: reglamento.trim(),
        arancelado: Boolean(arancelado),
        precio: parseFloat(precio) || 0
      })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al guardar amenity');
    cerrarModal('modal-amenity-nuevo');
    toast('¡Espacio común configurado con éxito!', 'ok');
    setTimeout(function() { location.reload(); }, 700);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}
window.guardarAmenityNuevo = guardarAmenityNuevo;

function abrirModalAmenityEditar(id, nombre, icono, apertura, cierre, capacidad, desc, reglamento, arancelado, precio) {
  var idEl = document.getElementById('amenity-edit-id');
  if (idEl) idEl.value = id || '';
  var nEl = document.getElementById('amenity-edit-nombre');
  if (nEl) nEl.value = nombre || '';
  var iEl = document.getElementById('amenity-edit-icono');
  if (iEl) iEl.value = icono || '🎉';
  var aEl = document.getElementById('amenity-edit-apertura');
  if (aEl) aEl.value = apertura || '08:00';
  var cEl = document.getElementById('amenity-edit-cierre');
  if (cEl) cEl.value = cierre || '23:00';
  var capEl = document.getElementById('amenity-edit-capacidad');
  if (capEl) capEl.value = capacidad || 20;
  var dEl = document.getElementById('amenity-edit-desc');
  if (dEl) dEl.value = desc || '';
  var regEl = document.getElementById('amenity-edit-reglamento');
  if (regEl) regEl.value = reglamento || '';

  var chkEl = document.getElementById('amenity-edit-arancelado');
  if (chkEl) chkEl.checked = Boolean(arancelado);
  var boxP = document.getElementById('box-precio-edit');
  if (boxP) boxP.style.display = arancelado ? 'block' : 'none';
  var pEl = document.getElementById('amenity-edit-precio');
  if (pEl) pEl.value = precio || 0;

  abrirModal('modal-amenity-editar');
}
window.abrirModalAmenityEditar = abrirModalAmenityEditar;

async function guardarAmenityEditado(btn) {
  var id = valEl('amenity-edit-id');
  var edificio = valEl('amenity-edit-edificio');
  var nombre = valEl('amenity-edit-nombre');
  var icono = valEl('amenity-edit-icono') || '🎉';
  var apertura = valEl('amenity-edit-apertura') || '08:00';
  var cierre = valEl('amenity-edit-cierre') || '23:00';
  var capacidad = valEl('amenity-edit-capacidad') || '20';
  var descripcion = valEl('amenity-edit-desc') || '';
  var reglamento = valEl('amenity-edit-reglamento') || '';
  var chkArancel = document.getElementById('amenity-edit-arancelado');
  var arancelado = chkArancel ? chkArancel.checked : false;
  var precio = valEl('amenity-edit-precio') || '0';

  if (!id || !nombre.trim()) {
    toast('Ingresá el nombre del espacio común', 'err');
    return;
  }

  btn.disabled = true;
  var old = btn.textContent;
  btn.textContent = 'Guardando...';

  try {
    var r = await fetch('/admin/api/edificio-amenity-editar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id,
        edificio: edificio,
        nombre: nombre.trim(),
        icono: icono.trim(),
        hora_apertura: apertura,
        hora_cierre: cierre,
        capacidad: parseInt(capacidad, 10) || 20,
        descripcion: descripcion.trim(),
        reglamento: reglamento.trim(),
        arancelado: Boolean(arancelado),
        precio: parseFloat(precio) || 0
      })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al actualizar');
    cerrarModal('modal-amenity-editar');
    toast('¡Amenity y reglamento actualizados!', 'ok');
    setTimeout(function() { location.reload(); }, 700);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}
window.guardarAmenityEditado = guardarAmenityEditado;

async function cambiarEstadoPagoReserva(id, estado_pago) {
  try {
    var r = await fetch('/admin/api/reserva-amenity-pago', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, estado_pago: estado_pago })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al actualizar estado de pago');
    toast('¡Estado de pago actualizado!', 'ok');
    setTimeout(function() { location.reload(); }, 600);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}
window.cambiarEstadoPagoReserva = cambiarEstadoPagoReserva;

async function eliminarAmenity(id, nombre) {
  if (!confirm('¿Estás seguro de eliminar el amenity "' + nombre + '" de este edificio?')) return;
  try {
    var r = await fetch('/admin/api/edificio-amenity-eliminar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al eliminar');
    toast('Amenity eliminado', 'ok');
    setTimeout(function() { location.reload(); }, 700);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}
window.eliminarAmenity = eliminarAmenity;

// ── DATOS DE COBRO DEL PROVEEDOR ──────────────────────────────────────────────────────
function abrirDatosCobro(row, nombre, cbu, alias, titular, cuit){
  var r=document.getElementById('cobro-row');if(r)r.value=row;
  var n=document.getElementById('cobro-nombre');if(n)n.textContent=nombre||'Proveedor';
  var c=document.getElementById('cobro-cbu');if(c)c.value=cbu||'';
  var a=document.getElementById('cobro-alias');if(a)a.value=alias||'';
  var t=document.getElementById('cobro-titular');if(t)t.value=titular||'';
  var q=document.getElementById('cobro-cuit');if(q)q.value=cuit||'';
  abrirModal('modal-datos-cobro');
}
window.abrirDatosCobro = abrirDatosCobro;

async function guardarDatosCobro(btn){
  var row=valEl('cobro-row');
  var cbu=valEl('cobro-cbu').replace(/\\D/g,'');
  var alias=valEl('cobro-alias').trim();
  var titular=valEl('cobro-titular').trim();
  var cuit=valEl('cobro-cuit').replace(/\\D/g,'');
  if(!cbu&&!alias){toast('Cargá el CBU o el alias','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/proveedor-datos-cobro',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row,cbu:cbu,alias:alias,titular:titular,cuit:cuit})});
    var j=await r.json();
    // El servidor verifica los dígitos del CBU: si no cierra, el mensaje dice qué pasó.
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-datos-cobro');
    toast('Datos de cobro guardados','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
window.guardarDatosCobro = guardarDatosCobro;

// Aprobar o rechazar el cambio de cuenta que pidió un proveedor por WhatsApp. Se confirma
// aparte porque aprobarlo por error manda el pago del mes a otra cuenta.
async function resolverCambioCobro(btn,row,aprobar){
  var pregunta = aprobar
    ? '¿Confirmás el cambio de cuenta?\\n\\nAntes de aceptar, verificá con el proveedor llamándolo al número de siempre — no respondiendo al mensaje que te mandó.'
    : '¿Rechazás el cambio? Se va a seguir usando la cuenta anterior.';
  if(!confirm(pregunta))return;
  btn.disabled=true;var old=btn.textContent;btn.textContent='...';
  try{
    var r=await fetch('/admin/api/proveedor-cambio-cobro',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row,aprobar:!!aprobar})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast(aprobar?'Cambio aprobado: ahora cobra en la cuenta nueva':'Cambio rechazado: sigue la cuenta anterior','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;btn.textContent=old;}
}
window.resolverCambioCobro = resolverCambioCobro;

// --- consejo de administracion ---
function abrirModalConsejoNuevo(edificios){
  var el=document.getElementById('cons-edificio');if(el)el.value=edificios||'';
  abrirModal('modal-consejo-nuevo');
}
async function guardarConsejoNuevo(btn){
  var nombre=valEl('cons-nombre');
  var cargo=valEl('cons-cargo');
  var unidad=valEl('cons-unidad');
  var tel=valEl('cons-tel');
  var email=valEl('cons-email');
  var notas=valEl('cons-notas');
  var edificio=valEl('cons-edificio');
  if(!nombre.trim()){toast('Cargá el nombre del integrante','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/consejo',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nombre:nombre.trim(),cargo:cargo,unidad:unidad.trim(),telefono:tel.trim(),email:email.trim(),notas:notas.trim(),edificio:edificio})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-consejo-nuevo');
    toast('Integrante del consejo agregado','ok');
    setTimeout(function(){location.reload();},800);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
function abrirEditarConsejo(row, nombre, cargo, unidad, tel, email, notas){
  var r=document.getElementById('edit-cons-row');if(r)r.value=row;
  var n=document.getElementById('edit-cons-nombre');if(n)n.value=nombre||'';
  var c=document.getElementById('edit-cons-cargo');if(c)c.value=cargo||'Presidente';
  var u=document.getElementById('edit-cons-unidad');if(u)u.value=unidad||'';
  var t=document.getElementById('edit-cons-tel');if(t)t.value=tel||'';
  var em=document.getElementById('edit-cons-email');if(em)em.value=email||'';
  var nt=document.getElementById('edit-cons-notas');if(nt)nt.value=notas||'';
  abrirModal('modal-consejo-editar');
}
async function guardarEditarConsejo(btn){
  var row=valEl('edit-cons-row');
  var nombre=valEl('edit-cons-nombre');
  var cargo=valEl('edit-cons-cargo');
  var unidad=valEl('edit-cons-unidad');
  var tel=valEl('edit-cons-tel');
  var email=valEl('edit-cons-email');
  var notas=valEl('edit-cons-notas');
  if(!nombre.trim()){toast('Cargá el nombre del integrante','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/consejo-editar',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row,nombre:nombre.trim(),cargo:cargo,unidad:unidad.trim(),telefono:tel.trim(),email:email.trim(),notas:notas.trim()})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-consejo-editar');
    toast('Integrante del consejo actualizado','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
async function eliminarConsejo(btn,row){
  if(!confirm('¿Eliminar este integrante del consejo?')) return;
  btn.disabled=true;
  try{
    var r=await fetch('/admin/api/consejo-quitar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:row})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Integrante eliminado','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;}
}
async function toggleServicioGastos(btn,edificio,nuevoEstado){
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/servicio-gastos-toggle',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({edificio:edificio,activo:nuevoEstado})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast(nuevoEstado?'Servicio de Gestión Administrativa IA activado':'Servicio de Gestión desactivado','ok');
    setTimeout(function(){location.reload();},700);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}
// Asignar un proveedor de la lista a ESTE edificio con prioridad.
async function asignarProveedor(btn,edificio){
  var prov=(document.getElementById('asig-prov')||{}).value||'';
  var prio=(document.getElementById('asig-prio')||{}).value||'primera';
  if(!prov){toast('Elegí un proveedor','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Asignando...';
  try{
    var r=await fetch('/admin/api/proveedor-asignar',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({proveedor:prov,prioridad:prio,edificio:edificio})});
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
  var nombre=valEl('cli-nombre');
  var usuario=valEl('cli-usuario');
  var pass=valEl('cli-pass');
  var email=valEl('cli-email');
  var wsp=valEl('cli-wsp');
  var notifEmail=(document.getElementById('cli-notif-email')||{}).checked;
  var notifWsp=(document.getElementById('cli-notif-wsp')||{}).checked;
  if(!nombre||!usuario||!pass){toast('Completá nombre, usuario y contraseña','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Creando...';
  try{
    var r=await fetch('/admin/api/clientes',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nombre:nombre.trim(),usuario:usuario.trim(),pass:pass.trim(),email:email.trim(),wsp:wsp.trim(),notif_email:notifEmail,notif_wsp:notifWsp})});
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
  var cuit=(document.getElementById('ed-cuit')||{}).value||'';
  var aliases=(document.getElementById('ed-aliases')||{}).value||'';
  var horarioSum=(document.getElementById('ed-horario-sum')||{}).value||'';
  var cocheras=(document.getElementById('ed-cocheras')||{}).value||'';
  var telSeguridad=(document.getElementById('ed-tel-seguridad')||{}).value||'';
  var encargado=(document.getElementById('ed-encargado')||{}).value||'';
  var telEncargado=(document.getElementById('ed-tel-encargado')||{}).value||'';
  var suplente=(document.getElementById('ed-suplente')||{}).value||'';
  var telSuplente=(document.getElementById('ed-tel-suplente')||{}).value||'';
  var plan=(document.getElementById('ed-plan')||{}).value||'Base';
  if(!nombre.trim()){toast('Falta el nombre del consorcio','err');return;}
  btn.disabled=true;var old=btn.textContent;btn.textContent='Creando...';
  try{
    var r=await fetch('/admin/api/edificio-nuevo',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nombre:nombre.trim(),direccion:direccion.trim(),unidades:unidades.trim(),zona:zona.trim(),
        cuit:cuit.trim(),aliases:aliases.trim(),horario_sum:horarioSum.trim(),cocheras:cocheras.trim(),tel_seguridad:telSeguridad.trim(),
        encargado:encargado.trim(),tel_encargado:telEncargado.trim(),encargado_suplente:suplente.trim(),tel_suplente:telSuplente.trim(),
        plan:plan,clienteUsuario:clienteUsuario||undefined})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    // Cuando el edificio ya estaba cargado y suelto, el backend lo asigna en vez de crearlo:
    // hay que decirlo, porque "Edificio agregado" a secas haria pensar que se duplico.
    toast(j.asignado?(j.mensaje||'Edificio asignado'):'Edificio agregado','ok');
    setTimeout(function(){location.reload();},j.asignado?1800:900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- editar ficha directo (dueño) ---
var _editRow=null;
function abrirEditar(row,nombre,encargado,plan,direccion,cuit,unidades,zona,aliases){
  _editRow=row;
  var t=document.getElementById('edit-bname');if(t)t.textContent=nombre;
  var n=document.getElementById('edit-nombre');if(n)n.value=nombre||'';
  var e=document.getElementById('edit-encargado');if(e)e.value=encargado||'';
  var d=document.getElementById('edit-direccion');if(d)d.value=direccion||'';
  var c=document.getElementById('edit-cuit');if(c)c.value=cuit||'';
  var u=document.getElementById('edit-unidades');if(u)u.value=unidades||'';
  var z=document.getElementById('edit-zona');if(z)z.value=zona||'';
  var a=document.getElementById('edit-aliases');if(a)a.value=aliases||'';
  var h=document.getElementById('edit-plan');if(h)h.value=plan||'Base';
  abrirModal('modal-editar');
}
async function guardarEditar(btn){
  var nombre=valEl('edit-nombre');
  var encargado=valEl('edit-encargado');
  var plan=valEl('edit-plan');
  var direccion=valEl('edit-direccion');
  var cuit=valEl('edit-cuit');
  var unidades=valEl('edit-unidades');
    var zona=valEl('edit-zona');
  var aliases=valEl('edit-aliases');
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/edificio',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:_editRow,nombre:nombre.trim(),encargado:encargado.trim(),plan:plan,direccion:direccion.trim(),cuit:cuit.trim(),unidades:unidades.trim(),zona:zona.trim(),aliases:aliases.trim()})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    toast('Ficha actualizada','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- asignar edificio a administrador (dueño / colaboradores de sistema) ---
var _asigEdificio = null;
function abrirModalAsignarAdmin(edificio, adminActual, usuarioActual) {
  _asigEdificio = edificio;
  var tit = document.getElementById('asig-edificio-nombre');
  if (tit) tit.textContent = edificio;
  var act = document.getElementById('asig-admin-actual');
  if (act) act.textContent = adminActual || 'Sin asignar';
  var sel = document.getElementById('asig-nuevo-admin');
  if (sel && usuarioActual) sel.value = usuarioActual;
  abrirModal('modal-asignar-admin');
}

async function guardarAsignacionAdmin(btn) {
  if (!_asigEdificio) return;
  var sel = document.getElementById('asig-nuevo-admin');
  var nuevoUsuario = sel ? sel.value : '';
  if (!nuevoUsuario) {
    toast('Por favor seleccioná un administrador.', 'err');
    return;
  }
  btn.disabled = true;
  var old = btn.textContent;
  btn.textContent = 'Guardando...';
  try {
    var r = await fetch('/admin/api/edificio-asignar-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edificio: _asigEdificio, nuevo_usuario: nuevoUsuario })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error');
    toast('Edificio asignado a ' + (j.nuevo_admin || nuevoUsuario), 'ok');
    cerrarModal('modal-asignar-admin');
    setTimeout(function() { location.reload(); }, 900);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// --- gestión multi-personal (encargados, suplentes, seguridad) ---
function formatHorario3Lineas(lv1a, lv1b, lv2a, lv2b, saba, sabb) {
  var partes = [];
  function padTime(t) {
    if (!t) return '';
    var p = t.trim().split(':');
    if (p.length === 2) {
      var h = p[0].length === 1 ? '0' + p[0] : p[0];
      var m = p[1].length === 1 ? '0' + p[1] : p[1];
      return h + ':' + m;
    }
    return t.trim();
  }
  var l1a = padTime(lv1a), l1b = padTime(lv1b);
  var l2a = padTime(lv2a), l2b = padTime(lv2b);
  var sa = padTime(saba), sb = padTime(sabb);

  if (l1a && l1b) partes.push('L-V ' + l1a + '-' + l1b);
  if (l2a && l2b) partes.push('L-V ' + l2a + '-' + l2b);
  if (sa && sb) partes.push('Sáb ' + sa + '-' + sb);
  return partes.join(' · ') || 'Sin horario';
}

function parseHorario3Lineas(str) {
  var res = { lv1: ['', ''], lv2: ['', ''], sab: ['', ''] };
  if (!str || str === 'Sin horario') return res;

  function padTime(t) {
    if (!t) return '';
    var p = t.trim().split(':');
    if (p.length === 2) {
      var h = p[0].length === 1 ? '0' + p[0] : p[0];
      var m = p[1].length === 1 ? '0' + p[1] : p[1];
      return h + ':' + m;
    }
    return t.trim();
  }

  var partes = String(str).split(new RegExp('[·\\n,]', 'g')).map(function(s){ return s.trim(); }).filter(Boolean);
  partes.forEach(function(p) {
    var matchLv = p.match(/(?:L-V|Lun|Viernes|Lunes)\s*([0-9]{1,2}:[0-9]{2})\s*(?:[-–—]|a|hasta)\s*([0-9]{1,2}:[0-9]{2})/i);
    if (matchLv) {
      var t1 = padTime(matchLv[1]);
      var t2 = padTime(matchLv[2]);
      if (!res.lv1[0]) { res.lv1 = [t1, t2]; }
      else { res.lv2 = [t1, t2]; }
      return;
    }
    var matchSab = p.match(/(?:Sáb|Sabado|Sábado)\s*([0-9]{1,2}:[0-9]{2})\s*(?:[-–—]|a|hasta)\s*([0-9]{1,2}:[0-9]{2})/i);
    if (matchSab) {
      res.sab = [padTime(matchSab[1]), padTime(matchSab[2])];
      return;
    }
    var matchTimes = p.match(/([0-9]{1,2}:[0-9]{2})\s*(?:[-–—]|a|hasta)\s*([0-9]{1,2}:[0-9]{2})/i);
    if (matchTimes) {
      var t1f = padTime(matchTimes[1]);
      var t2f = padTime(matchTimes[2]);
      if (!res.lv1[0]) { res.lv1 = [t1f, t2f]; }
      else if (!res.lv2[0]) { res.lv2 = [t1f, t2f]; }
      else { res.sab = [t1f, t2f]; }
    }
  });
  return res;
}

function parseStaffClient(namesStr, telsStr) {
  if (!namesStr && !telsStr) return [];

  var nlChars = String.fromCharCode(10) + String.fromCharCode(13);
  var staffSplitRegex = new RegExp('[,;' + nlChars + ']+');
  var rawNames = String(namesStr || '').split(staffSplitRegex).map(function(s){ return s.trim(); }).filter(Boolean);
  var rawTels = String(telsStr || '').split(staffSplitRegex).map(function(s){ return s.trim(); }).filter(Boolean);
  var res = [];

  for (var i = 0; i < rawNames.length; i++) {
    var str = rawNames[i];
    var tel = rawTels[i] || (rawTels.length === 1 ? rawTels[0] : '—');
    var estado = 'activo';
    var horario = '';

    // Extract bracket metadata: e.g. "Juan Perez [activo | L-V 8-16]"
    var openB = str.indexOf('[');
    var closeB = str.indexOf(']', openB);
    if (openB !== -1 && closeB > openB) {
      var metaContent = str.substring(openB + 1, closeB).trim();
      str = (str.substring(0, openB) + ' ' + str.substring(closeB + 1)).trim();

      if (metaContent) {
        var parts = metaContent.split('|').map(function(s){ return s.trim(); }).filter(Boolean);
        parts.forEach(function(part) {
          var pLow = part.toLowerCase();
          if (pLow === 'activo' || pLow === 'licencia' || pLow === 'vacaciones') {
            estado = pLow;
          } else {
            horario = part;
          }
        });
      }
    }

    // Extract phone in parentheses: e.g. "Juan Perez (1167350436)"
    var openP = str.indexOf('(');
    var closeP = str.indexOf(')', openP);
    if (openP !== -1 && closeP > openP) {
      var telInParens = str.substring(openP + 1, closeP).trim();
      if (telInParens && (!tel || tel === '—')) {
        tel = telInParens;
      }
      str = (str.substring(0, openP) + ' ' + str.substring(closeP + 1)).trim();
    }

    // If str is a pure phone number e.g. "1167350436" or "+5411...", assign to tel
    if (/^[\-+0-9\s()]+$/.test(str) && str.replace(/[^0-9]/g, '').length >= 7) {
      if (!tel || tel === '—') {
        tel = str;
        str = '';
      }
    }

    // Clean leftover brackets or parentheses if any
    str = str.replace(/[\[\]\(\)]/g, '').trim();

    if (str || tel !== '—') {
      res.push({
        nombre: str || 'Personal',
        tel: tel || '—',
        estado: estado || 'activo',
        horario: horario || 'Sin horario'
      });
    }
  }
  return res;
}

function abrirModalStaffItem(fieldKey, idx, edNombre) {
  var ed = (window.__EDIFICIOS__ || []).find(function(x){
    return String(x.nombre || '').trim().toLowerCase() === String(edNombre || '').trim().toLowerCase();
  });
  if (!ed && window.__CUR_BUILDING__) {
    ed = window.__CUR_BUILDING__;
  }
  if (ed) {
    edNombre = ed.nombre;
  }
  var edRow = ed ? (ed._row || ed.row) : 0;

  var titleEl = document.getElementById('staff-modal-title');
  var inputNombre = document.getElementById('staff-inp-nombre');
  var inputTel = document.getElementById('staff-inp-tel');
  var inputEstado = document.getElementById('staff-inp-estado');
  var inputEd = document.getElementById('staff-inp-ed');
  var inputRow = document.getElementById('staff-inp-row');
  var inputKey = document.getElementById('staff-inp-key');
  var inputIdx = document.getElementById('staff-inp-idx');

  if (!inputNombre || !inputTel || !inputEd || !inputKey || !inputIdx || !inputRow) return;

  inputEd.value = edNombre;
  inputRow.value = edRow || '';
  inputKey.value = fieldKey;
  inputIdx.value = idx;

  var namesStr = '';
  var telsStr = '';
  var labelTipo = '';

  if (fieldKey === 'encargado') {
    namesStr = ed ? (ed.encargado || '') : '';
    telsStr = ed ? (ed.tel_encargado || '') : '';
    labelTipo = 'Encargado Titular';
  } else if (fieldKey === 'suplente') {
    namesStr = ed ? (ed.encargado_suplente || '') : '';
    telsStr = ed ? (ed.tel_suplente || '') : '';
    labelTipo = 'Suplente / Limpieza';
  } else if (fieldKey === 'seguridad') {
    namesStr = ed ? (ed.tel_seguridad || '') : '';
    telsStr = '';
    labelTipo = 'Personal de Seguridad / Portería';
  }

  var items = parseStaffClient(namesStr, telsStr);

  var lv1a = document.getElementById('staff-inp-lv1a');
  var lv1b = document.getElementById('staff-inp-lv1b');
  var lv2a = document.getElementById('staff-inp-lv2a');
  var lv2b = document.getElementById('staff-inp-lv2b');
  var saba = document.getElementById('staff-inp-saba');
  var sabb = document.getElementById('staff-inp-sabb');

  if (idx >= 0 && items[idx]) {
    if (titleEl) titleEl.textContent = '✏️ Editar ' + labelTipo;
    inputNombre.value = items[idx].nombre;
    inputTel.value = items[idx].tel !== '—' ? items[idx].tel : '';
    if (inputEstado) inputEstado.value = items[idx].estado || 'activo';

    var horParsed = parseHorario3Lineas(items[idx].horario);
    if (lv1a) lv1a.value = horParsed.lv1[0] || '';
    if (lv1b) lv1b.value = horParsed.lv1[1] || '';
    if (lv2a) lv2a.value = horParsed.lv2[0] || '';
    if (lv2b) lv2b.value = horParsed.lv2[1] || '';
    if (saba) saba.value = horParsed.sab[0] || '';
    if (sabb) sabb.value = horParsed.sab[1] || '';
  } else {
    if (titleEl) titleEl.textContent = '➕ Añadir ' + labelTipo;
    inputNombre.value = '';
    inputTel.value = '';
    if (inputEstado) inputEstado.value = 'activo';
    if (lv1a) lv1a.value = '';
    if (lv1b) lv1b.value = '';
    if (lv2a) lv2a.value = '';
    if (lv2b) lv2b.value = '';
    if (saba) saba.value = '';
    if (sabb) sabb.value = '';
  }

  abrirModal('modal-staff-edit');
}

async function guardarStaffItem(btn) {
  var edNombre = (document.getElementById('staff-inp-ed') || {}).value || '';
  var fieldKey = (document.getElementById('staff-inp-key') || {}).value || '';
  var idx = parseInt((document.getElementById('staff-inp-idx') || {}).value || '-1', 10);
  var nombre = (document.getElementById('staff-inp-nombre') || {}).value || '';
  var tel = (document.getElementById('staff-inp-tel') || {}).value || '';
  var estado = (document.getElementById('staff-inp-estado') || {}).value || 'activo';

  var lv1a = (document.getElementById('staff-inp-lv1a') || {}).value || '';
  var lv1b = (document.getElementById('staff-inp-lv1b') || {}).value || '';
  var lv2a = (document.getElementById('staff-inp-lv2a') || {}).value || '';
  var lv2b = (document.getElementById('staff-inp-lv2b') || {}).value || '';
  var saba = (document.getElementById('staff-inp-saba') || {}).value || '';
  var sabb = (document.getElementById('staff-inp-sabb') || {}).value || '';

  var horario = formatHorario3Lineas(lv1a, lv1b, lv2a, lv2b, saba, sabb);

  if (!nombre.trim() && !tel.trim()) {
    toast('Ingresá al menos el nombre o teléfono', 'err');
    return;
  }

  var ed = (window.__EDIFICIOS__ || []).find(function(x){
    return String(x.nombre || '').trim().toLowerCase() === String(edNombre || '').trim().toLowerCase();
  });
  if (!ed && window.__CUR_BUILDING__) {
    ed = window.__CUR_BUILDING__;
    if (!edNombre && ed) edNombre = ed.nombre;
  }
  var edRow = ed ? (ed._row || ed.row) : parseInt((document.getElementById('staff-inp-row') || {}).value || '0', 10);

  var namesStr = '';
  var telsStr = '';
  if (fieldKey === 'encargado') {
    namesStr = ed ? (ed.encargado || '') : '';
    telsStr = ed ? (ed.tel_encargado || '') : '';
  } else if (fieldKey === 'suplente') {
    namesStr = ed ? (ed.encargado_suplente || '') : '';
    telsStr = ed ? (ed.tel_suplente || '') : '';
  } else if (fieldKey === 'seguridad') {
    namesStr = ed ? (ed.tel_seguridad || '') : '';
    telsStr = '';
  }

  var items = parseStaffClient(namesStr, telsStr);
  var cleanNombre = nombre.trim().replace(/[\[\]]/g, '');
  var newItem = {
    nombre: cleanNombre || 'Personal',
    tel: tel.trim() || '—',
    estado: estado || 'activo',
    horario: horario
  };

  if (idx >= 0 && items[idx]) {
    items[idx] = newItem;
  } else {
    items.push(newItem);
  }

  var formattedNames = items.map(function(x){
    var cNom = (x.nombre || 'Personal').replace(/[\[\]]/g, '').trim();
    return cNom + ' [' + (x.estado || 'activo') + ' | ' + (x.horario || 'Sin horario') + ']';
  }).join(', ');

  var formattedTels = items.map(function(x){ return x.tel; }).join(', ');

  btn.disabled = true;
  var old = btn.textContent;
  btn.textContent = 'Guardando...';

  try {
    var payload = {};
    if (fieldKey === 'encargado') {
      payload.encargado = formattedNames;
      payload.tel_encargado = formattedTels;
    } else if (fieldKey === 'suplente') {
      payload.encargado_suplente = formattedNames;
      payload.tel_suplente = formattedTels;
    } else if (fieldKey === 'seguridad') {
      payload.tel_seguridad = formattedNames;
    }

    var apiUrl = (edRow && window.__ES_DUENO__) ? '/admin/api/edificio' : '/admin/api/mi-edificio';
    var bodyData = (apiUrl === '/admin/api/edificio') ? Object.assign({ row: edRow }, payload) : Object.assign({ edificio: edNombre }, payload);

    var r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al guardar');

    cerrarModal('modal-staff-edit');
    toast('Personal actualizado correctamente', 'ok');
    setTimeout(function(){ location.reload(); }, 600);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function eliminarStaffItem(fieldKey, idx, edNombre) {
  if (!confirm('¿Eliminar esta persona del registro?')) return;
  var ed = (window.__EDIFICIOS__ || []).find(function(x){ return x.nombre === edNombre; });
  if (!ed && window.__CUR_BUILDING__ && (window.__CUR_BUILDING__.nombre === edNombre || !edNombre)) {
    ed = window.__CUR_BUILDING__;
    if (!edNombre && ed) edNombre = ed.nombre;
  }
  var edRow = ed ? (ed._row || ed.row) : 0;

  var namesStr = '';
  var telsStr = '';
  if (fieldKey === 'encargado') {
    namesStr = ed ? (ed.encargado || '') : '';
    telsStr = ed ? (ed.tel_encargado || '') : '';
  } else if (fieldKey === 'suplente') {
    namesStr = ed ? (ed.encargado_suplente || '') : '';
    telsStr = ed ? (ed.tel_suplente || '') : '';
  } else if (fieldKey === 'seguridad') {
    namesStr = ed ? (ed.tel_seguridad || '') : '';
    telsStr = '';
  }

  var items = parseStaffClient(namesStr, telsStr);
  if (idx >= 0 && idx < items.length) {
    items.splice(idx, 1);
  }

  var formattedNames = items.map(function(x){
    return x.nombre + ' [' + (x.estado || 'activo') + ' | ' + (x.horario || 'Sin horario') + ']';
  }).join(', ');

  var formattedTels = items.map(function(x){ return x.tel; }).join(', ');

  try {
    var payload = {};
    if (fieldKey === 'encargado') {
      payload.encargado = formattedNames;
      payload.tel_encargado = formattedTels;
    } else if (fieldKey === 'suplente') {
      payload.encargado_suplente = formattedNames;
      payload.tel_suplente = formattedTels;
    } else if (fieldKey === 'seguridad') {
      payload.tel_seguridad = formattedNames;
    }

    var apiUrl = (edRow && window.__ES_DUENO__) ? '/admin/api/edificio' : '/admin/api/mi-edificio';
    var bodyData = (apiUrl === '/admin/api/edificio') ? Object.assign({ row: edRow }, payload) : Object.assign({ edificio: edNombre }, payload);

    var r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al eliminar');

    setTimeout(function(){ location.reload(); }, 600);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

// --- editar cliente directo (dueño) ---
var _editCliRow=null;
function abrirEditarCliente(row,nombre,usuario,pass,email,wsp,notifEmail,notifWsp){
  _editCliRow=row;
  var n=document.getElementById('edit-cli-nombre');if(n)n.value=nombre||'';
  var u=document.getElementById('edit-cli-usuario');if(u)u.value=usuario||'';
  var p=document.getElementById('edit-cli-pass');if(p)p.value=pass||'';
  var e=document.getElementById('edit-cli-email');if(e)e.value=email||'';
  var w=document.getElementById('edit-cli-wsp');if(w)w.value=wsp||'';
  var ne=document.getElementById('edit-cli-notif-email');if(ne)ne.checked=notifEmail!==false;
  var nw=document.getElementById('edit-cli-notif-wsp');if(nw)nw.checked=!!notifWsp;
  abrirModal('modal-cliente-editar');
}
async function guardarEditarCliente(btn){
  var nombre=valEl('edit-cli-nombre');
  var usuario=valEl('edit-cli-usuario');
  var pass=valEl('edit-cli-pass');
  var email=valEl('edit-cli-email');
  var wsp=valEl('edit-cli-wsp');
  var notifEmail=(document.getElementById('edit-cli-notif-email')||{}).checked;
  var notifWsp=(document.getElementById('edit-cli-notif-wsp')||{}).checked;
  if(!nombre||!usuario||!pass){
    toast('Nombre, usuario y contraseña son obligatorios','err');
    return;
  }
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/cliente-editar',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:_editCliRow,nombre:nombre.trim(),usuario:usuario.trim(),pass:pass,email:email.trim(),wsp:wsp.trim(),notif_email:notifEmail,notif_wsp:notifWsp})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-cliente-editar');
    toast('Administrador actualizado','ok');
    setTimeout(function(){location.reload();},900);
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

// --- colaboradores y parametros de planes ---
async function abrirModalColaboradores(){
  abrirModal('modal-colaboradores');
  var cont = document.getElementById('colaboradores-lista-body');
  if(!cont) return;
  cont.innerHTML = '<div style="padding:20px;text-align:center;color:#8595AD">Cargando colaboradores...</div>';
  try {
    var r = await fetch('/admin/api/colaboradores');
    var j = await r.json();
    if(!j.colaboradores || !j.colaboradores.length) {
      cont.innerHTML = '<div style="padding:24px;text-align:center;color:#8595AD;font-size:13.5px">No hay colaboradores registrados todavía. Usá el botón superior para dar de alta.</div>';
      return;
    }
    cont.innerHTML = j.colaboradores.map(function(c){
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #EEF2F8" class="hv-row">'+
        '<div>'+
          '<div style="font-weight:700;font-size:14px">'+escapeHtml(c.nombre)+' <span style="font-size:12px;color:#8595AD;font-weight:400">(@'+escapeHtml(c.usuario)+')</span></div>'+
          '<div style="font-size:12px;color:#8595AD">'+escapeHtml(c.email||'Sin email')+' · Alta: '+escapeHtml(c.fecha_alta||'—')+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:8px;align-items:center">'+
          '<button onclick="toggleEstadoColaborador('+c._row+','+(!c.activo)+')" style="height:32px;padding:0 12px;border:1px solid #DCE4F0;border-radius:8px;background:'+(c.activo?'#FDECEC':'#E7F4EC')+';color:'+(c.activo?'#C0392B':'#1B7A43')+';font-weight:700;font-size:12px;cursor:pointer">'+(c.activo?'Bloquear':'Activar')+'</button>'+
          '<button onclick="eliminarColaborador('+c._row+')" style="height:32px;padding:0 10px;border:1px solid #FCA5A5;border-radius:8px;background:#FEF2F2;color:#DC2626;font-weight:700;font-size:12px;cursor:pointer">🗑️</button>'+
        '</div>'+
      '</div>';
    }).join('');
  } catch(e) {
    cont.innerHTML = '<div style="padding:20px;text-align:center;color:#EF4444">Error al cargar colaboradores</div>';
  }
}

function abrirModalColaboradorNuevo(){
  abrirModal('modal-colaborador-nuevo');
}

async function guardarColaborador(btn){
  var nombre = valEl('colab-nombre');
  var usuario = valEl('colab-usuario');
  var pass = valEl('colab-pass');
  var email = valEl('colab-email');
  if(!nombre || !usuario || !pass){
    toast('Nombre, usuario y contraseña son obligatorios','err');
    return;
  }
  btn.disabled=true; var old=btn.textContent; btn.textContent='Guardando...';
  try {
    var r = await fetch('/admin/api/colaborador',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nombre:nombre.trim(),usuario:usuario.trim(),pass:pass.trim(),email:email.trim()})});
    var j = await r.json();
    if(!r.ok || j.error) throw new Error(j.error||'Error');
    cerrarModal('modal-colaborador-nuevo');
    toast('Colaborador agregado exitosamente','ok');
    abrirModalColaboradores();
  } catch(e) { toast('Error: '+e.message,'err'); }
  finally { btn.disabled=false; btn.textContent=old; }
}

async function toggleEstadoColaborador(row, nuevoActivo){
  try {
    var r = await fetch('/admin/api/colaborador-estado',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row, activo:nuevoActivo})});
    var j = await r.json();
    if(!r.ok || j.error) throw new Error(j.error||'Error');
    toast(nuevoActivo ? 'Colaborador activado' : 'Colaborador bloqueado','ok');
    abrirModalColaboradores();
  } catch(e) { toast('Error: '+e.message,'err'); }
}

async function eliminarColaborador(row){
  if(!confirm('¿Eliminar este colaborador definitivamente?')) return;
  try {
    var r = await fetch('/admin/api/colaborador-estado',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({row:row, eliminar:true})});
    var j = await r.json();
    if(!r.ok || j.error) throw new Error(j.error||'Error');
    toast('Colaborador eliminado','ok');
    abrirModalColaboradores();
  } catch(e) { toast('Error: '+e.message,'err'); }
}

async function abrirModalConfigPlanes(){
  abrirModal('modal-config-planes');
  try {
    var r = await fetch('/admin/api/configuracion-planes');
    var j = await r.json();
    if(j.config){
      var c = j.config;
      var bm = document.getElementById('cfg-base-msgs'); if(bm) bm.value = c.base_msgs || 300;
      var pm = document.getElementById('cfg-plus-msgs'); if(pm) pm.value = c.plus_msgs || 1000;
      var bc = document.getElementById('cfg-base-calls'); if(bc) bc.value = c.base_calls || 200;
      var pc = document.getElementById('cfg-plus-calls'); if(pc) pc.value = c.plus_calls || 500;
      var be = document.getElementById('cfg-base-edificios'); if(be) be.value = c.base_edificios || 5;
      var pe = document.getElementById('cfg-plus-edificios'); if(pe) pe.value = c.plus_edificios || 20;
      var ia = document.getElementById('cfg-ia-activa'); if(ia) ia.checked = c.ia_admin_activa !== false;
    }
  } catch(e){}
}

async function guardarConfigPlanes(btn){
  var bm = Number(valEl('cfg-base-msgs')) || 300;
  var pm = Number(valEl('cfg-plus-msgs')) || 1000;
  var bc = Number(valEl('cfg-base-calls')) || 200;
  var pc = Number(valEl('cfg-plus-calls')) || 500;
  var be = Number(valEl('cfg-base-edificios')) || 5;
  var pe = Number(valEl('cfg-plus-edificios')) || 20;
  var ia = (document.getElementById('cfg-ia-activa')||{}).checked !== false;

  btn.disabled=true; var old=btn.textContent; btn.textContent='Guardando...';
  try {
    var r = await fetch('/admin/api/configuracion-planes',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({base_msgs:bm, plus_msgs:pm, base_calls:bc, plus_calls:pc, base_edificios:be, plus_edificios:pe, ia_admin_activa:ia})});
    var j = await r.json();
    if(!r.ok || j.error) throw new Error(j.error||'Error');
    cerrarModal('modal-config-planes');
    toast('Parámetros de planes guardados correctamente','ok');
    setTimeout(function(){location.reload();},800);
  } catch(e) { toast('Error: '+e.message,'err'); }
  finally { btn.disabled=false; btn.textContent=old; }
}

function cambiarTipoPlanModal(tipo) {
  var edEl = document.getElementById('plan-edificios');
  if (!edEl) return;
  if (tipo === 'individual') {
    edEl.value = '1';
  } else if (tipo === 'corporativo' && Number(edEl.value) <= 1) {
    edEl.value = '5';
  }
}

// --- Suscripciones y Datos Bancarios ---
function abrirModalPlanNuevo() {
  var r = document.getElementById('plan-row'); if(r) r.value = '';
  var t = document.getElementById('plan-modal-titulo'); if(t) t.textContent = '✨ Crear Nuevo Plan de Suscripción';
  var tp = document.getElementById('plan-tipo'); if(tp) tp.value = 'individual';
  var n = document.getElementById('plan-nombre'); if(n) n.value = '';
  var p = document.getElementById('plan-precio'); if(p) p.value = '';
  var m = document.getElementById('plan-moneda'); if(m) m.value = 'ARS';
  var e = document.getElementById('plan-edificios'); if(e) e.value = '1';
  var msg = document.getElementById('plan-mensajes'); if(msg) msg.value = '300';
  var call = document.getElementById('plan-llamadas'); if(call) call.value = '200';
  var s = document.getElementById('plan-servicios'); if(s) s.value = 'Atención IA 24/7, Panel Completo AC, Múltiples proveedores';
  var est = document.getElementById('plan-estado'); if(est) est.value = 'activo';
  abrirModal('modal-plan');
}

function abrirEditarPlan(row, nombre, precio, moneda, ed, msgs, calls, servicios, estado) {
  var r = document.getElementById('plan-row'); if(r) r.value = row || '';
  var t = document.getElementById('plan-modal-titulo'); if(t) t.textContent = '✏️ Editar Plan: ' + nombre;
  var tp = document.getElementById('plan-tipo'); if(tp) tp.value = Number(ed) > 1 ? 'corporativo' : 'individual';
  var n = document.getElementById('plan-nombre'); if(n) n.value = nombre || '';
  var p = document.getElementById('plan-precio'); if(p) p.value = precio || '0';
  var m = document.getElementById('plan-moneda'); if(m) m.value = moneda || 'ARS';
  var e = document.getElementById('plan-edificios'); if(e) e.value = ed || '1';
  var msg = document.getElementById('plan-mensajes'); if(msg) msg.value = msgs || '300';
  var call = document.getElementById('plan-llamadas'); if(call) call.value = calls || '200';
  var s = document.getElementById('plan-servicios'); if(s) s.value = servicios || '';
  var est = document.getElementById('plan-estado'); if(est) est.value = estado || 'activo';
  abrirModal('modal-plan');
}

async function guardarPlanSuscripcion(btn) {
  var row = valEl('plan-row');
  var nombre = valEl('plan-nombre').trim();
  var precio = valEl('plan-precio').trim();
  var moneda = valEl('plan-moneda');
  var edificios = valEl('plan-edificios').trim();
  var mensajes = valEl('plan-mensajes').trim();
  var llamadas = valEl('plan-llamadas').trim();
  var servicios = valEl('plan-servicios').trim();
  var estado = valEl('plan-estado');

  if (!nombre) { toast('Ingresá el nombre del plan', 'err'); return; }

  btn.disabled = true; var old = btn.textContent; btn.textContent = 'Guardando...';
  try {
    var r = await fetch('/admin/api/suscripciones-plan-guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row, nombre, precio, moneda, edificios, mensajes, llamadas, servicios, estado })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al guardar');
    cerrarModal('modal-plan');
    toast('Plan guardado correctamente', 'ok');
    setTimeout(function() { location.reload(); }, 600);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function eliminarPlanSuscripcion(row, nombre) {
  if (!confirm('¿Seguro que querés desactivar o eliminar el plan "' + nombre + '"?')) return;
  try {
    var r = await fetch('/admin/api/suscripciones-plan-eliminar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al eliminar');
    toast('Plan eliminado', 'ok');
    setTimeout(function() { location.reload(); }, 600);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function abrirModalEditarBanco() {
  abrirModal('modal-banco');
}

async function guardarDatosBancarios(btn) {
  var titular = valEl('banco-titular').trim();
  var cuit = valEl('banco-cuit').trim();
  var banco = valEl('banco-nombre').trim();
  var cbu = valEl('banco-cbu').trim();
  var alias = valEl('banco-alias').trim();
  var tipo = valEl('banco-tipo').trim();
  var notas = valEl('banco-notas').trim();

  btn.disabled = true; var old = btn.textContent; btn.textContent = 'Guardando...';
  try {
    var r = await fetch('/admin/api/suscripciones-banco-guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titular, cuit, banco, cbu, alias, tipo, notas })
    });
    var j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Error al guardar');
    cerrarModal('modal-banco');
    toast('Datos bancarios actualizados correctamente', 'ok');
    setTimeout(function() { location.reload(); }, 600);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

// --- mi cuenta y preferencias ---
async function guardarMiCuenta(btn){
  var pass=valEl('account-pass');
  var email=valEl('account-email');
  var wsp=valEl('account-wsp');
  var notifEmail=(document.getElementById('account-notif-email')||{}).checked;
  var notifWsp=(document.getElementById('account-notif-wsp')||{}).checked;
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/actualizar-perfil',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pass:pass,email:email.trim(),wsp:wsp.trim(),notif_email:notifEmail,notif_wsp:notifWsp})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-mi-cuenta');
    toast('Perfil actualizado correctamente','ok');
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

async function guardarPreferencias(btn){
  var email=valEl('pref-email');
  var wsp=valEl('pref-wsp');
  var notifEmail=(document.getElementById('pref-notif-email')||{}).checked;
  var notifWsp=(document.getElementById('pref-notif-wsp')||{}).checked;
  btn.disabled=true;var old=btn.textContent;btn.textContent='Guardando...';
  try{
    var r=await fetch('/admin/api/actualizar-perfil',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:email?email.trim():undefined,wsp:wsp?wsp.trim():undefined,notif_email:notifEmail,notif_wsp:notifWsp})});
    var j=await r.json();
    if(!r.ok||j.error)throw new Error(j.error||'Error');
    cerrarModal('modal-preferencias');
    toast('Preferencias guardadas correctamente','ok');
  }catch(e){toast('Error: '+e.message,'err');}
  finally{btn.disabled=false;btn.textContent=old;}
}

function setTema(modo){
  if(modo==='dark'){
    document.documentElement.classList.add('dark-theme');
    if(document.body)document.body.classList.add('dark-theme');
    localStorage.setItem('marcos_theme','dark');
  }else{
    document.documentElement.classList.remove('dark-theme');
    if(document.body)document.body.classList.remove('dark-theme');
    localStorage.setItem('marcos_theme','light');
  }
  var btnD=document.getElementById('btn-theme-dark');
  var btnL=document.getElementById('btn-theme-light');
  if(btnD){
    btnD.style.borderColor=modo==='dark'?'#2E6FC0':'#DDE3EE';
    btnD.style.background=modo==='dark'?'#24305E':'#fff';
  }
  if(btnL){
    btnL.style.borderColor=modo==='light'?'#2E6FC0':'#DDE3EE';
    btnL.style.background=modo==='light'?'#EAF1FB':'#fff';
  }
}
function toggleWspNotif(chk){
  localStorage.setItem('marcos_wsp_notif',chk.checked?'1':'0');
  toast('Preferencia de WhatsApp actualizada','ok');
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
window.addEventListener('DOMContentLoaded', function() {
  var p = new URLSearchParams(window.location.search);
  var t = p.get('tipo');
  if (t) {
    var chips = document.querySelectorAll('[data-chip]');
    var modes = { nuevos: 'nuevos', urgentes: 'urgentes', abiertos: 'abiertos', resueltos: 'resueltos' };
    if (modes[t]) {
      chips.forEach(function(c) {
        var attr = c.getAttribute('onclick') || '';
        if (attr.indexOf(modes[t]) !== -1) {
          c.click();
        }
      });
    }
  }
});

function abrirModalVecinoNuevo(edificio) {
  var elEd = document.getElementById('vec-edificio');
  if (elEd) elEd.value = edificio || '';
  var elNom = document.getElementById('vec-nombre');
  if (elNom) elNom.value = '';
  var elUni = document.getElementById('vec-unidad');
  if (elUni) elUni.value = '';
  var elTel = document.getElementById('vec-tel');
  if (elTel) elTel.value = '';
  var elEmail = document.getElementById('vec-email');
  if (elEmail) elEmail.value = '';
  var elNotas = document.getElementById('vec-notas');
  if (elNotas) elNotas.value = '';
  abrirModal('modal-vecino-nuevo');
}
function abrirEditarVecino(row, nombre, unidad, tel, email, notas) {
  var elRow = document.getElementById('edit-vec-row');
  if (elRow) elRow.value = row;
  var elNom = document.getElementById('edit-vec-nombre');
  if (elNom) elNom.value = nombre || '';
  var elUni = document.getElementById('edit-vec-unidad');
  if (elUni) elUni.value = unidad || '';
  var elTel = document.getElementById('edit-vec-tel');
  if (elTel) elTel.value = tel || '';
  var elEmail = document.getElementById('edit-vec-email');
  if (elEmail) elEmail.value = email || '';
  var elNotas = document.getElementById('edit-vec-notas');
  if (elNotas) elNotas.value = notas || '';
  abrirModal('modal-vecino-editar');
}
function filtrarVecinosList(val) {
  var q = String(val || '').toLowerCase().trim();
  var items = document.querySelectorAll('.vecino-fila-item');
  items.forEach(function(el) {
    var txt = el.getAttribute('data-vecino-search') || '';
    el.style.display = (!q || txt.indexOf(q) !== -1) ? 'flex' : 'none';
  });
}
function invitarVecinoWhatsApp(nombre, tel, edificio) {
  var cleanTel = String(tel || '').replace(/\D/g, '');
  if (!cleanTel) {
    toast('Este vecino no tiene teléfono cargado', 'err');
    return;
  }
  var primerNombre = nombre ? String(nombre).split(' ')[0] : '';
  var msg = '¡Hola ' + primerNombre + '! Te invitamos a acceder al Portal Web de tu edificio (' + (edificio || '') + ') en https://marcos.bienargentinos.com/vecino/login con tu teléfono ' + tel + '.';
  var url = 'https://wa.me/' + cleanTel + '?text=' + encodeURIComponent(msg);
  window.open(url, '_blank');
}
async function guardarVecinoNuevo(btn) {
  var elEd = document.getElementById('vec-edificio');
  var edificio = elEd ? elEd.value : '';
  var elNom = document.getElementById('vec-nombre');
  var nombre = elNom ? elNom.value.trim() : '';
  var elUni = document.getElementById('vec-unidad');
  var unidad = elUni ? elUni.value.trim() : '';
  var elTel = document.getElementById('vec-tel');
  var telefono = elTel ? elTel.value.trim() : '';
  var elEmail = document.getElementById('vec-email');
  var email = elEmail ? elEmail.value.trim() : '';
  var elNotas = document.getElementById('vec-notas');
  var notas = elNotas ? elNotas.value.trim() : '';

  if (!nombre && !unidad) {
    toast('Ingresá al menos el nombre o el depto', 'err');
    return;
  }
  btn.disabled = true;
  var oldTxt = btn.textContent;
  btn.textContent = 'Guardando...';
  try {
    var res = await fetch('/admin/api/vecino-crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edificio: edificio, nombre: nombre, unidad: unidad, telefono: telefono, email: email, notas: notas })
    });
    var data = await res.json();
    if (data.ok) {
      toast('Vecino guardado con éxito', 'ok');
      setTimeout(function() { location.reload(); }, 600);
    } else {
      toast('Error: ' + (data.error || 'No se pudo guardar'), 'err');
      btn.disabled = false;
      btn.textContent = oldTxt;
    }
  } catch (e) {
    toast('Error de conexión', 'err');
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}
async function guardarEditarVecino(btn) {
  var elRow = document.getElementById('edit-vec-row');
  var row = elRow ? elRow.value : '';
  var elNom = document.getElementById('edit-vec-nombre');
  var nombre = elNom ? elNom.value.trim() : '';
  var elUni = document.getElementById('edit-vec-unidad');
  var unidad = elUni ? elUni.value.trim() : '';
  var elTel = document.getElementById('edit-vec-tel');
  var telefono = elTel ? elTel.value.trim() : '';
  var elEmail = document.getElementById('edit-vec-email');
  var email = elEmail ? elEmail.value.trim() : '';
  var elNotas = document.getElementById('edit-vec-notas');
  var notas = elNotas ? elNotas.value.trim() : '';

  btn.disabled = true;
  var oldTxt = btn.textContent;
  btn.textContent = 'Guardando...';
  try {
    var res = await fetch('/admin/api/vecino-editar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: row, nombre: nombre, unidad: unidad, telefono: telefono, email: email, notas: notas })
    });
    var data = await res.json();
    if (data.ok) {
      toast('Vecino actualizado', 'ok');
      setTimeout(function() { location.reload(); }, 600);
    } else {
      toast('Error: ' + (data.error || 'No se pudo actualizar'), 'err');
      btn.disabled = false;
      btn.textContent = oldTxt;
    }
  } catch (e) {
    toast('Error de conexión', 'err');
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}
async function eliminarVecino(btn, row) {
  if (!confirm('¿Seguro que querés quitar a este vecino del padrón?')) return;
  btn.disabled = true;
  try {
    var res = await fetch('/admin/api/vecino-eliminar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: row })
    });
    var data = await res.json();
    if (data.ok) {
      toast('Vecino quitado', 'ok');
      setTimeout(function() { location.reload(); }, 600);
    } else {
      toast('Error: ' + (data.error || 'No se pudo quitar'), 'err');
      btn.disabled = false;
    }
  } catch (e) {
    toast('Error de conexión', 'err');
    btn.disabled = false;
  }
}

var _vecinosParaImportar = [];

function abrirModalImportarVecinos(edificio) {
  var elEd = document.getElementById('imp-vec-edificio');
  if (elEd) elEd.value = edificio || '';
  var elArea = document.getElementById('imp-vec-textarea');
  if (elArea) elArea.value = '';
  var elFile = document.getElementById('imp-vec-file');
  if (elFile) elFile.value = '';
  _vecinosParaImportar = [];
  renderizarPreviewImportacion([]);
  abrirModal('modal-vecinos-importar');
}

function leerArchivoVecinos(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    var elArea = document.getElementById('imp-vec-textarea');
    if (elArea) elArea.value = text;
    procesarTextoVecinosImportar(text);
  };
  reader.readAsText(file);
}

function procesarTextoVecinosImportar(rawText) {
  if (!rawText || !rawText.trim()) {
    _vecinosParaImportar = [];
    renderizarPreviewImportacion([]);
    return;
  }
  var nl = String.fromCharCode(10);
  var cr = String.fromCharCode(13);
  var tab = String.fromCharCode(9);
  var q1 = String.fromCharCode(39);
  var q2 = String.fromCharCode(34);

  var lineas = rawText.split(nl).map(function(l) { return l.replace(cr, '').trim(); }).filter(Boolean);
  if (!lineas.length) {
    _vecinosParaImportar = [];
    renderizarPreviewImportacion([]);
    return;
  }

  var primerLinea = lineas[0];
  var sep = tab;
  if (primerLinea.indexOf(tab) !== -1) {
    sep = tab;
  } else if (primerLinea.indexOf(';') !== -1) {
    sep = ';';
  } else if (primerLinea.indexOf(',') !== -1) {
    sep = ',';
  }

  var resultados = [];
  var inicioIdx = 0;

  var lowerPrimera = primerLinea.toLowerCase();
  if (lowerPrimera.indexOf('nombre') !== -1 || lowerPrimera.indexOf('depto') !== -1 || lowerPrimera.indexOf('unidad') !== -1 || lowerPrimera.indexOf('tel') !== -1 || lowerPrimera.indexOf('mail') !== -1) {
    inicioIdx = 1;
  }

  for (var i = inicioIdx; i < lineas.length; i++) {
    var l = lineas[i];
    if (!l) continue;
    var partes = l.split(sep).map(function(p) {
      var s = p.trim();
      if (s.startsWith(q1) || s.startsWith(q2)) s = s.slice(1);
      if (s.endsWith(q1) || s.endsWith(q2)) s = s.slice(0, -1);
      return s.trim();
    });
    if (!partes.length || (partes.length === 1 && !partes[0])) continue;

    var unidad = '';
    var nombre = '';
    var telefono = '';
    var email = '';
    var notas = '';

    var emailsDetectados = [];
    var telsDetectados = [];
    var deptoDetectado = '';
    var otrosTextos = [];

    partes.forEach(function(p) {
      if (!p) return;
      var cleanDigits = p.replace(/[^0-9]/g, '');
      if (p.indexOf('@') !== -1) {
        emailsDetectados.push(p);
      } else if (cleanDigits.length >= 7 && p.length <= 25) {
        telsDetectados.push(p);
      } else if (!deptoDetectado && p.length <= 8 && (cleanDigits.length > 0 || p.toUpperCase() === 'PB')) {
        deptoDetectado = p;
      } else {
        otrosTextos.push(p);
      }
    });

    if (emailsDetectados.length) email = emailsDetectados[0];
    if (telsDetectados.length) telefono = telsDetectados[0];

    if (deptoDetectado) {
      unidad = deptoDetectado;
      nombre = otrosTextos.length ? otrosTextos.join(' ') : '';
    } else {
      if (partes.length === 1) {
        nombre = partes[0];
      } else if (partes.length === 2) {
        unidad = partes[0];
        nombre = partes[1];
      } else if (partes.length >= 3) {
        if (/^[0-9]|^[A-Z]$|^PB/i.test(partes[0])) {
          unidad = partes[0];
          nombre = partes[1];
          if (!telefono) telefono = partes[2];
          if (partes[3] && !email) email = partes[3];
          if (partes[4]) notas = partes.slice(4).join(' ');
        } else {
          nombre = partes[0];
          unidad = partes[1];
          if (!telefono) telefono = partes[2];
          if (partes[3] && !email) email = partes[3];
          if (partes[4]) notas = partes.slice(4).join(' ');
        }
      }
    }

    if (nombre || unidad || telefono || email) {
      resultados.push({
        unidad: unidad,
        nombre: nombre,
        telefono: telefono,
        email: email,
        notas: notas
      });
    }
  }

  _vecinosParaImportar = resultados;
  renderizarPreviewImportacion(resultados);
}

function renderizarPreviewImportacion(lista) {
  var countEl = document.getElementById('imp-vec-count');
  var tableEl = document.getElementById('imp-vec-preview-body');
  var btnGuardar = document.getElementById('imp-vec-btn-guardar');

  if (countEl) countEl.textContent = lista.length + ' vecinos detectados';
  if (btnGuardar) {
    btnGuardar.disabled = lista.length === 0;
    btnGuardar.textContent = lista.length > 0 ? '✓ Importar ' + lista.length + ' vecinos' : 'Importar vecinos';
  }

  if (!tableEl) return;
  if (!lista.length) {
    tableEl.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#8595AD;font-size:13px">Pegá texto desde Excel o subí un CSV para previsualizar aquí.</td></tr>';
    return;
  }

  var html = lista.slice(0, 30).map(function(v) {
    return '<tr style="border-bottom:1px solid #F1F5FB">' +
      '<td style="padding:8px 10px;font-weight:700;color:#1E5FB4"><span style="background:#EBF3FC;padding:2px 6px;border-radius:6px">' + (v.unidad || '—') + '</span></td>' +
      '<td style="padding:8px 10px;font-weight:600;color:#16233B">' + (v.nombre || '—') + '</td>' +
      '<td style="padding:8px 10px;color:#2E6FC0">' + (v.telefono || '—') + '</td>' +
      '<td style="padding:8px 10px;color:#64748B;font-size:12px">' + (v.email || '—') + '</td>' +
      '</tr>';
  }).join('');

  if (lista.length > 30) {
    html += '<tr><td colspan="4" style="text-align:center;padding:8px;color:#64748B;font-size:12px;background:#F8FAFC">... y ' + (lista.length - 30) + ' departamentos más.</td></tr>';
  }
  tableEl.innerHTML = html;
}

async function ejecutarImportacionVecinos(btn) {
  if (!_vecinosParaImportar || !_vecinosParaImportar.length) {
    toast('No hay datos para importar', 'err');
    return;
  }
  var elEd = document.getElementById('imp-vec-edificio');
  var edificio = elEd ? elEd.value : '';
  if (!edificio) {
    toast('Falta seleccionar edificio', 'err');
    return;
  }

  btn.disabled = true;
  var oldTxt = btn.textContent;
  btn.textContent = 'Importando ' + _vecinosParaImportar.length + ' vecinos...';

  try {
    var res = await fetch('/admin/api/vecinos-importar-masivo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edificio: edificio, vecinos: _vecinosParaImportar })
    });
    var data = await res.json();
    if (data.ok) {
      toast('¡' + (data.importados || _vecinosParaImportar.length) + ' vecinos importados con éxito!', 'ok');
      setTimeout(function() { location.reload(); }, 700);
    } else {
      toast('Error: ' + (data.error || 'No se pudo importar'), 'err');
      btn.disabled = false;
      btn.textContent = oldTxt;
    }
  } catch (e) {
    toast('Error de conexión al importar', 'err');
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}

// Explicit Global Attachments
window.abrirDrawerEvento = abrirDrawerEvento;
window.cerrarDrawerEvento = cerrarDrawerEvento;
window.marcarEventoResuelto = marcarEventoResuelto;
window.guardarFeedbackDrawer = guardarFeedbackDrawer;
window.descargarResumenEvento = descargarResumenEvento;
window.toggleFacturaEstado = toggleFacturaEstado;
window.cambiarTabClase = cambiarTabClase;
window.cambiarChipOrigen = cambiarChipOrigen;
window.onBuscadorInput = onBuscadorInput;
window.togglePopoverMenu = togglePopoverMenu;
window.cambiarEstadoFacturaKey = cambiarEstadoFacturaKey;
window.moverClaseFacturaKey = moverClaseFacturaKey;
window.eliminarFacturaKey = eliminarFacturaKey;
window.enviarConsejoFacturaKey = enviarConsejoFacturaKey;
window.abrirModalSubirDocumento = abrirModalSubirDocumento;
window.abrirModalEditarDocumento = abrirModalEditarDocumento;
window.abrirModalCambiarOrigen = abrirModalCambiarOrigen;
window.abrirModalFiltrosAvanzados = abrirModalFiltrosAvanzados;
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;
window.toast = toast;
window.abrirModalVecinoNuevo = abrirModalVecinoNuevo;
window.abrirEditarVecino = abrirEditarVecino;
window.filtrarVecinosList = filtrarVecinosList;
window.invitarVecinoWhatsApp = invitarVecinoWhatsApp;
window.guardarVecinoNuevo = guardarVecinoNuevo;
window.guardarEditarVecino = guardarEditarVecino;
window.eliminarVecino = eliminarVecino;
window.abrirModalImportarVecinos = abrirModalImportarVecinos;
window.leerArchivoVecinos = leerArchivoVecinos;
window.procesarTextoVecinosImportar = procesarTextoVecinosImportar;
window.ejecutarImportacionVecinos = ejecutarImportacionVecinos;
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
  global.__EDIFICIOS_CACHE__ = edificios;
  const clientes = cli.rows.map(mapCliente);
  const solicitudes = sol.rows;
  const sugerencias = sug.rows;

  // Edificio "actual" para la vista cliente.
  const permitidos = edificiosPermitidos(req);
  const suyosNorm = new Set((edificiosDeLaCuenta(req) || []).map(normEdificio).filter(Boolean));
  const propios = vistaCliente(req)
    ? edificios.filter((e) => suyosNorm.has(normEdificio(e.nombre)))
    : edificios;
  const permitidosNorm = permitidos ? new Set(permitidos.map(normEdificio).filter(Boolean)) : null;
  const curBuilding = vistaCliente(req)
    ? (propios.find((e) => permitidosNorm && permitidosNorm.has(normEdificio(e.nombre))) || propios[0] || {
        nombre: 'Sin edificio asignado',
        direccion: 'Consulte con su administración',
        encargado: '—',
        tel_encargado: '—',
        cuit: '—',
        unidades: '0',
        zona: '—',
        aliases: '—',
        plan: 'Base',
        horario_sum: '—',
        cocheras: '—',
        tel_seguridad: '—',
        encargado_suplente: '—',
        tel_suplente: '—',
        administrador: 'Administración',
        telefonos: '—',
      })
    : null;

  // Nombre visible del cliente (para saludo/avatar).
  let clienteActual = null;
  if (vistaCliente(req)) {
    const usuario = enPreview(req) ? req.session.previewOwner : req.session.user;
    clienteActual = clientes.find((c) => c.usuario === usuario) || {
      nombre: usuario || 'Administrador',
      usuario: usuario || 'admin',
      email: 'Admi@bienargentinos.com',
      wsp: '',
      notif_email: true,
      notif_wsp: false,
      edificios: [],
    };
  }

  return { eventos, edificios, clientes, solicitudes, sugerencias, propios, curBuilding, clienteActual };
}

/* ===================================================================
 * VISTA DE EVENTO (fila del feed + datos del drawer)
 * =================================================================== */

function limpiarTextoMedia(str) {
  if (!str) return '';
  let s = String(str);
  s = s.replace(/\[AUDIO:[^\]]+\]/gi, ' ');
  s = s.replace(/\[(IMAGEN|FOTO|VIDEO|DOC|DOCUMENTO):[^\]]+\]/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

function vistaEvento(e, filterFn, listaEdificios) {
  const cat = clasificarEvento(e);
  const catInfo = CATEGORIAS_EVENTO[cat];
  const canal = canalDe(e);
  const urg = URG_STYLE[e.urgencia] || URG_STYLE.baja;
  const estKey = estadoNormalizado(e.estado);
  const est = EST_STYLE[estKey];
  const fn = filterFn || esDe24Horas;
  const nuevo = fn(parseFecha(e.fecha));

  let dirReal = e.direccion || '';
  if (!dirReal && e.edificio) {
    const edSearch = String(e.edificio).trim().toLowerCase();
    const pool = Array.isArray(listaEdificios) && listaEdificios.length ? listaEdificios : (global.__EDIFICIOS_CACHE__ || []);
    const found = pool.find((b) => {
      if (!b) return false;
      const n = (b.nombre || b.edificio || '').trim().toLowerCase();
      return n && (n === edSearch || edSearch.indexOf(n) !== -1 || n.indexOf(edSearch) !== -1);
    });
    if (found && found.direccion) dirReal = found.direccion;
  }
  const edificioMostrar = dirReal || e.direccion || e.edificio || '—';

  const msgLimpio = limpiarTextoMedia(e.mensaje);
  const notasLimpias = limpiarTextoMedia(e.notas);
  const transLimpia = limpiarTextoMedia(e.transcripcion);
  const esAudio = Boolean(e.audio_url || e.audios_json || /\[AUDIO:/i.test(e.mensaje || '') || /\[AUDIO:/i.test(e.notas || ''));
  const tituloFinal = msgLimpio || transLimpia || notasLimpias || (esAudio ? '🎙️ Nota de voz' : 'Evento');
  const detalleFinal = notasLimpias || transLimpia || '';

  return {
    row: e._row,
    id_evento: e.id_evento || ('CASO-' + String(e._row).padStart(4, '0')),
    audios_json: e.audios_json || '',
    involucrados_json: e.involucrados_json || '',
    titulo: truncate(tituloFinal, 90),
    detalle: truncate(detalleFinal, 160),
    catKey: cat, catLabel: catInfo.label, catIcon: catInfo.icon, catBg: catInfo.bg,
    urgKey: e.urgencia, urgLabel: urg.label, urgBg: urg.bg, urgFg: urg.fg,
    estKey, estLabel: est.label, estBg: est.bg, estFg: est.fg,
    canalIcon: canal.icon, canal: canal.nombre,
    vecino: e.vecino, telefono: e.telefono,
    edificio: edificioMostrar,
    nombre_edificio: e.edificio || '',
    direccion: dirReal || e.direccion || '',
    depto: e.depto, unidad: e.unidad,
    when: fechaCorta(parseFecha(e.fecha)) || e.fecha,
    hora_fin: e.hora_fin || '',
    mensaje: e.mensaje, notas: e.notas,
    transcripcion: e.transcripcion || '',
    audio_url: e.audio_url || '',
    audioDiasRestantes: (() => {
      const f = parseFecha(e.fecha);
      if (!f) return 30;
      const dias = 30 - Math.floor((Date.now() - f.getTime()) / 86400000);
      return dias > 0 ? dias : 0;
    })(),
    feedback: e.feedback, nuevo,
    tecnico: e.tecnico || '',
    tel_tecnico: e.tel_tecnico || '',
    rubro_tecnico: e.rubro_tecnico || '',
    chat_vecino_json: e.chat_vecino_json || '',
    chat_proveedor_json: e.chat_proveedor_json || '',
    historial_chat: e.historial_chat || '',
    tipo: e.tipo || '',
  };
}

function filaEvento(v, idx, chipEdificio) {
  let rowClass = 'ev-normal';
  if (v.estKey === 'resuelto') rowClass = 'ev-resuelto';
  else if (v.urgKey === 'alta') rowClass = 'ev-urgente';
  else if (v.nuevo) rowClass = 'ev-nuevo';

  const esTrabajoExterno = v.catKey === 'trabajo_externo' || v.tipo === 'trabajo_externo' || /trabajo_externo|externo/i.test(v.tipo || '');
  const badgeExternoHtml = esTrabajoExterno ? `<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#FEF3C7;color:#92400E;border:1px solid #F59E0B">🧾 Trabajo externo</span>` : '';

  return `
    <button onclick="abrirDrawerEvento(${idx})" data-evrow data-nuevo="${v.nuevo ? '1' : '0'}" data-urg="${esc(v.urgKey)}" data-est="${esc(v.estKey)}"
      style="width:100%;display:flex;align-items:flex-start;gap:14px;padding:16px 20px 16px 16px;border:none;border-bottom:1px solid #F1F4F9;background:none;cursor:pointer;text-align:left;font-family:inherit;position:relative" class="hv-row ${rowClass}">
      <span style="width:44px;height:44px;border-radius:12px;background:${v.catBg};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${v.catIcon}</span>
      <span style="flex:1;min-width:0">
        <span style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
          <span style="font-size:11.5px;font-weight:800;padding:2px 7px;border-radius:6px;background:#F1F5F9;color:#64748B;font-family:monospace;letter-spacing:-.01em;border:1px solid #E2E8F0">${esc(v.id_evento)}</span>
          <span style="font-size:15px;font-weight:700;color:#16233B">${esc(v.titulo)}</span>
          ${badgeExternoHtml}
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
      ? ((clienteDelEdificio(d.clientes, filtro) || {}).nombre || '')
      : `${d.edificios.length} consorcios activos`;
    const filas = [
      { label: 'Todos los edificios', sub: `${d.edificios.length} consorcios`, val: '', activo: !filtro },
      ...d.edificios.map((e) => ({
        label: e.nombre,
        sub: `${(clienteDelEdificio(d.clientes, e.nombre) || {}).nombre || 'Sin asignar'}${e.unidades ? ' · ' + e.unidades + ' un.' : ''}`,
        val: e.nombre, activo: filtro === e.nombre,
      })),
    ];
    selectorHtml = selectorEdificioHtml(label, sub, 'Filtrar por edificio', filas, '/admin/set-filtro');
  } else {
    const cur = d.curBuilding;
    const todos = !req.session.edificioActivo;
    const label = todos ? 'Todos los edificios' : (cur ? cur.nombre : 'Sin edificio');
    const sub = todos ? `${d.propios.length} edificios` : (cur ? (cur.zona || cur.direccion || '') : '');
    const filas = [
      { label: 'Todos los edificios', sub: `${d.propios.length} edificios`, val: '', activo: todos },
      ...d.propios.map((e) => ({
        label: e.nombre,
        sub: `${e.direccion || e.nombre}${e.unidades ? ' · ' + e.unidades + ' un.' : ''}`,
        val: e.nombre,
        activo: !todos && !!(cur && cur.nombre === e.nombre),
      })),
    ];
    selectorHtml = d.propios.length > 1
      ? selectorEdificioHtml(label, sub, 'Tus edificios', filas, '/admin/set-filtro')
      : `<div style="display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border:1px solid #E1E7F1;border-radius:11px;background:#F7F9FC">
          <span style="font-size:15px">🏢</span>
          <span style="text-align:left;line-height:1.15">
            <span style="display:block;font-size:14px;font-weight:700;color:#16233B">${esc(cur ? cur.nombre : 'Sin edificio')}</span>
            <span style="display:block;font-size:11px;color:#8595AD">${esc(cur ? (cur.zona || cur.direccion || '') : '')}</span>
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
  const nuevosCliente = filtrarPorEdificio(d.eventos, req).filter((e) => estadoNormalizado(e.estado) !== 'resuelto').length;
  const solPend = d.solicitudes.filter((s) => !s.estado || s.estado === 'pendiente').length;
  const navCliente = [
    { key: 'resumen', icon: '📊', label: 'Resumen', href: '/admin' },
    { key: 'eventos', icon: '🔔', label: 'Eventos', href: '/admin/eventos', badge: nuevosCliente },
    { key: 'edificio', icon: '🏢', label: 'Mi Edificio', href: '/admin/mi-edificio' },
    { key: 'proveedores', icon: '🧰', label: 'Proveedores', href: '/admin/proveedores' },
    { key: 'facturas', icon: '🧾', label: 'Facturas/Fotos', href: '/admin/archivos' },
    { key: 'expensas', icon: '📑', label: 'Expensas', href: '/admin/expensas' },
    { key: 'sugerencias', icon: '💡', label: 'Sugerencias', href: '/admin/sugerencias' },
  ];
  const nuevosDueno = d.eventos.filter((e) => estadoNormalizado(e.estado) !== 'resuelto').length;
  const navDueno = [
    { key: 'resumen', icon: '📊', label: 'Resumen', href: '/admin' },
    { key: 'eventos', icon: '🔔', label: 'Eventos', href: '/admin/eventos', badge: nuevosDueno },
    { key: 'consumos', icon: '📈', label: 'Consumos', href: '/admin/consumos' },
    { key: 'facturas', icon: '🧾', label: 'Facturas/Fotos', href: '/admin/archivos' },
    { key: 'edificios', icon: '👥', label: 'Clientes', href: '/admin/clientes' },
    { key: 'solicitudes', icon: '📥', label: 'Solicitudes', href: '/admin/solicitudes', badge: solPend },
    { key: 'suscripciones', icon: '💳', label: 'Planes y Pagos', href: '/admin/suscripciones' },
  ];
  const nav = dueno ? navDueno : navCliente;
  const navHtml = nav.map((n) => {
    const active = n.key === activeKey;
    return `
      <a href="${n.href}" data-tour="nav-${n.key}" style="display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border-radius:11px;background:${active ? '#EAF1FB' : 'transparent'};color:${active ? '#17408B' : '#475569'};font-weight:${active ? '800' : '600'};font-size:14.5px;text-align:left;position:relative" class="hv-soft">
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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0F326A">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Marcos IA">
<link rel="apple-touch-icon" href="/admin/assets/logo.png">
<link rel="icon" type="image/png" href="/admin/assets/logo.png">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>Marcos IA · Panel</title>
<script>
  window.abrirDrawerEvento = window.abrirDrawerEvento || function(idx) {
    if (window._abrirDrawerEventoImpl) return window._abrirDrawerEventoImpl(idx);
    console.warn('abrirDrawerEvento llamado antes de cargar script cliente completado', idx);
  };
  window.cerrarDrawerEvento = window.cerrarDrawerEvento || function() {
    if (window._cerrarDrawerEventoImpl) return window._cerrarDrawerEventoImpl();
  };
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.css"/>
<script src="https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.js.iife.js"></script>
<style>${CSS}</style>
<script>(function(){if(localStorage.getItem('marcos_theme')==='dark'){document.documentElement.classList.add('dark-theme');document.addEventListener('DOMContentLoaded',function(){if(document.body)document.body.classList.add('dark-theme');});}})();</script>
<script>${CLIENT_JS}</script>
</head>
<body class="${''}">
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
        <a href="https://bienargentinos.com" target="_blank" style="width:100%;text-align:left;padding:9px 11px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:14px;color:#2E6FC0;font-weight:700;display:block;text-decoration:none" class="hv-soft">🌐&nbsp;&nbsp;BienArgentinos.com ↗</a>
        <button onclick="abrirModal('modal-mi-cuenta')" style="width:100%;text-align:left;padding:9px 11px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:14px;color:#334259" class="hv-soft">👤&nbsp;&nbsp;Mi cuenta</button>
        <button onclick="abrirModal('modal-preferencias')" style="width:100%;text-align:left;padding:9px 11px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:14px;color:#334259" class="hv-soft">⚙️&nbsp;&nbsp;Preferencias</button>
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
      ${dueno ? '' : `
      <div style="margin:0 6px;padding:14px;background:linear-gradient(155deg,#0F326A,#2E6FC0);border-radius:14px;color:#fff">
        <div style="font-size:13px;font-weight:800;margin-bottom:4px">¿Necesitás algo?</div>
        <div style="font-size:12.5px;color:rgba(255,255,255,.8);line-height:1.45;margin-bottom:10px">Tu consorcio está siendo atendido las 24 horas.</div>
        <a href="${sugerenciaHref}" style="display:flex;align-items:center;justify-content:center;width:100%;height:36px;border-radius:9px;background:rgba(255,255,255,.16);color:#fff;font-weight:700;font-size:13px">Enviar sugerencia</a>
      </div>`}
    </nav>

    <!-- MAIN -->
    <main style="flex:1;min-width:0;padding:26px 30px 90px;max-width:1180px;margin:0 auto;width:100%">
      ${contenido}
    </main>
  <!-- BARRA DE NAVEGACION INFERIOR PARA MOVIL -->
  <div class="mobile-bottom-nav">
    <a href="/admin" data-tour="nav-resumen" class="${activeKey === 'resumen' ? 'active' : ''}">
      <span class="nav-icon">📊</span>
      <span class="nav-label">Resumen</span>
    </a>
    <a href="/admin/mi-edificio" data-tour="nav-edificio" class="${activeKey === 'edificio' ? 'active' : ''}">
      <span class="nav-icon">🏢</span>
      <span class="nav-label">Edificio</span>
    </a>
    <a href="/admin/eventos" data-tour="nav-eventos" class="${activeKey === 'eventos' ? 'active' : ''}">
      <span class="nav-icon">📋</span>
      <span class="nav-label">Eventos</span>
    </a>
    ${dueno ? `
    <a href="/admin/clientes" data-tour="nav-edificios" class="${activeKey === 'clientes' ? 'active' : ''}">
      <span class="nav-icon">👥</span>
      <span class="nav-label">Clientes</span>
    </a>
    <a href="/admin/suscripciones" data-tour="nav-suscripciones" class="${activeKey === 'suscripciones' ? 'active' : ''}">
      <span class="nav-icon">💳</span>
      <span class="nav-label">Planes</span>
    </a>
    ` : `
    <a href="/admin/archivos" data-tour="nav-facturas" class="${activeKey === 'archivos' ? 'active' : ''}">
      <span class="nav-icon">🧾</span>
      <span class="nav-label">Facturas</span>
    </a>
    <a href="/admin/sugerencias" data-tour="nav-sugerencias" class="${activeKey === 'sugerencias' ? 'active' : ''}">
      <span class="nav-icon">💡</span>
      <span class="nav-label">Ideas</span>
    </a>
    `}
  </div>
</div>
<div id="toast" class="toast"></div>
<div class="drawer-overlay" id="drawer-overlay" onclick="cerrarDrawerEvento()"></div>
<div class="drawer-panel" id="drawer-panel"></div>
<div id="modal-visor-multimedia" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(10,15,28,.92);backdrop-filter:blur(10px);z-index:99999;flex-direction:column;align-items:center;justify-content:center;padding:20px;box-sizing:border-box" onclick="cerrarVisorMultimediaSiBackdrop(event)">
  <div style="position:absolute;top:20px;left:24px;right:24px;display:flex;align-items:center;justify-content:space-between;z-index:100000">
    <div style="color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px" id="visor-titulo">🖼️ Visor Multimedia</div>
    <div style="display:flex;align-items:center;gap:12px">
      <a id="visor-btn-descargar" href="#" download target="_blank" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25);padding:8px 16px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:6px;backdrop-filter:blur(4px)" class="hv-soft">⬇️ Descargar</a>
      <button onclick="cerrarVisorMultimedia()" style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;border:none;cursor:pointer;font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)" class="hv-soft" title="Cerrar (Esc)">✕</button>
    </div>
  </div>
  <div style="max-width:90vw;max-height:82vh;display:flex;align-items:center;justify-content:center;position:relative" id="visor-contenido"></div>
  <div style="position:absolute;bottom:16px;color:rgba(255,255,255,.6);font-size:12px;font-weight:600">Presioná <kbd style="background:rgba(255,255,255,.2);padding:2px 6px;border-radius:4px;color:#fff">Esc</kbd> o hacé clic afuera para cerrar</div>
</div>
${clientPickerHtml}

${(() => {
  const currentEmail = esDuenoReal(req) ? 'admin@marcos-ai.com' : ((d.clienteActual || {}).email || '');
  const currentWsp = esDuenoReal(req) ? '111550542005' : ((d.clienteActual || {}).wsp || '');
  const notifEmailChecked = esDuenoReal(req) ? true : ((d.clienteActual || {}).notif_email !== false);
  const notifWspChecked = esDuenoReal(req) ? false : ((d.clienteActual || {}).notif_wsp === true);
  return `
    <div id="modal-mi-cuenta" class="modal-overlay" onclick="cerrarModal('modal-mi-cuenta')">
      <div class="modal-box" style="max-height:85vh;overflow-y:auto" onclick="stopEv(event)">
        <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
          <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Mi Cuenta</div>
          <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">${esc(displayName)}</div>
          <div style="font-size:12.5px;color:#8595AD;margin-top:2px">${esc(userMeta)}</div>
        </div>
        <div style="padding:20px 24px">
          <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email de contacto</div>
          <input id="account-email" value="${esc(currentEmail)}" placeholder="tuemail@ejemplo.com" class="inp" style="margin-bottom:14px">
          
          <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono / WhatsApp de Notificaciones</div>
          <input id="account-wsp" value="${esc(currentWsp)}" placeholder="Ej: 1122334455" class="inp" style="margin-bottom:16px">

          <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:8px">Canales de alerta activas</div>
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#334259;cursor:pointer;background:#F8FAFD;padding:10px 12px;border-radius:10px;border:1px solid #E4E9F1;margin-bottom:8px">
            <input id="account-notif-email" type="checkbox" ${notifEmailChecked ? 'checked' : ''} style="width:17px;height:17px;accent-color:#2E6FC0">
            <span>✉️ Alertas por <strong>Email</strong> <span style="font-size:11px;color:#1B7A43;font-weight:700">(Sin costo)</span></span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#334259;cursor:pointer;background:#F8FAFD;padding:10px 12px;border-radius:10px;border:1px solid #E4E9F1;margin-bottom:16px">
            <input id="account-notif-wsp" type="checkbox" ${notifWspChecked ? 'checked' : ''} style="width:17px;height:17px;accent-color:#2E6FC0">
            <span>💬 Alertas por <strong>WhatsApp</strong> <span style="font-size:11px;color:#8A6410;font-weight:700">(Servicio API)</span></span>
          </label>

          <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Cambiar contraseña</div>
          <input id="account-pass" type="password" placeholder="Nueva contraseña (dejar en blanco para mantener)" class="inp">
        </div>
        <div style="display:flex;gap:11px;padding:0 24px 22px">
          <button onclick="cerrarModal('modal-mi-cuenta')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
          <button onclick="guardarMiCuenta(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Guardar cambios</button>
        </div>
      </div>
    </div>

    <div id="modal-preferencias" class="modal-overlay" onclick="cerrarModal('modal-preferencias')">
      <div class="modal-box" style="max-height:85vh;overflow-y:auto" onclick="stopEv(event)">
        <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
          <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Preferencias del sistema</div>
          <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Personalización y contacto</div>
        </div>
        <div style="padding:20px 24px">
          <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email de contacto</div>
          <input id="pref-email" value="${esc(currentEmail)}" placeholder="tuemail@ejemplo.com" class="inp" style="margin-bottom:14px">
          <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">WhatsApp de notificaciones</div>
          <input id="pref-wsp" value="${esc((d.clienteActual||{}).wsp||'')}" placeholder="Ej: 1122334455" class="inp" style="margin-bottom:20px">
          <div style="font-size:13.5px;font-weight:700;color:#334259;margin-bottom:10px">Tema de la interfaz</div>
          <div style="display:flex;gap:12px;margin-bottom:20px">
            <button id="btn-theme-light" onclick="setTema('light')" style="flex:1;height:48px;border:1.5px solid #2E6FC0;border-radius:12px;background:#EAF1FB;color:#16233B;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px" class="hv-soft">☀️&nbsp;&nbsp;Modo Claro</button>
            <button id="btn-theme-dark" onclick="setTema('dark')" style="flex:1;height:48px;border:1.5px solid #DDE3EE;border-radius:12px;background:#fff;color:#16233B;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px" class="hv-soft">🌙&nbsp;&nbsp;Modo Oscuro</button>
          </div>
          <div style="font-size:13.5px;font-weight:700;color:#334259;margin-bottom:10px">Canales de alerta de urgencias</div>
          <label style="display:flex;align-items:center;gap:10px;font-size:13.5px;color:#334259;cursor:pointer;background:#F8FAFD;padding:12px 14px;border-radius:11px;border:1px solid #E4E9F1;margin-bottom:8px">
            <input id="pref-notif-email" type="checkbox" ${notifEmailChecked ? 'checked' : ''} style="width:18px;height:18px;accent-color:#2E6FC0">
            <span>✉️ Alertas por <strong>Email</strong> <span style="font-size:11px;color:#1B7A43;font-weight:700">(Sin costo)</span></span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;font-size:13.5px;color:#334259;cursor:pointer;background:#F8FAFD;padding:12px 14px;border-radius:11px;border:1px solid #E4E9F1">
            <input id="pref-notif-wsp" type="checkbox" ${notifWspChecked ? 'checked' : ''} style="width:18px;height:18px;accent-color:#2E6FC0">
            <span>💬 Alertas por <strong>WhatsApp</strong> <span style="font-size:11px;color:#8A6410;font-weight:700">(Servicio API)</span></span>
          </label>
        </div>
        <div style="display:flex;gap:11px;padding:0 24px 22px">
          <button onclick="guardarPreferencias(this)" style="flex:1;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Guardar preferencias</button>
        </div>
      </div>
    </div>`;
})()}

<!-- Widget Asistente Virtual AC -->
<div id="ac-ai-widget-container" data-tour="ai-widget" style="position:fixed;top:12px;left:370px;z-index:9999;font-family:'Hanken Grotesk',sans-serif">
  <!-- Ventana Chat Desplegable -->
  <div id="ac-ai-chat-box" style="display:none;flex-direction:column;width:340px;height:460px;background:#ffffff;border:1px solid #DCE4F0;border-radius:18px;box-shadow:0 12px 32px rgba(16,35,59,.22);overflow:hidden;margin-bottom:12px">
    <div style="background:linear-gradient(135deg,#17408B,#2E6FC0);color:#ffffff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">✨</span>
        <div>
          <div style="font-weight:800;font-size:14.5px">Asistente Virtual AC</div>
          <div style="font-size:11px;opacity:0.9">Ayuda interactiva en tiempo real</div>
        </div>
      </div>
      <button onclick="toggleAsistenteWidget()" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
    </div>
    
    <div style="padding:10px 12px;background:#F8FAFD;border-bottom:1px solid #EEF2F8;display:flex;gap:6px">
      <button onclick="checkAndRunFirstTimeTour(true)" style="flex:1;height:32px;border:1px solid #DCE4F0;border-radius:8px;background:#fff;color:#17408B;font-weight:700;font-size:11.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px" class="hv-soft">
        📍 Recorrer este panel (Tour)
      </button>
    </div>

    <div id="ac-ai-messages" style="flex:1;padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;background:#FAFCFF;font-size:13px">
      <div class="ac-ai-msg bot">
        ¡Hola! 👋 Soy tu Asistente Virtual. ¿En qué te puedo ayudar sobre el funcionamiento del panel?
      </div>
    </div>

    <div style="padding:10px 12px;background:#ffffff;border-top:1px solid #EEF2F8;display:flex;gap:8px">
      <input id="ac-ai-input" type="text" placeholder="Escribí tu duda aquí..." onkeypress="if(event.key==='Enter')enviarPreguntaAsistente()" style="flex:1;height:38px;border:1px solid #DCE4F0;border-radius:9px;padding:0 12px;font-size:13px;outline:none" />
      <button onclick="enviarPreguntaAsistente()" style="width:38px;height:38px;border:none;border-radius:9px;background:#17408B;color:#fff;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center">➤</button>
    </div>
  </div>

  <!-- Botón Flotante Principal -->
  <button id="ac-ai-trigger-btn" onclick="toggleAsistenteWidget()" onmouseenter="if(window.initDragAsistenteWidget)window.initDragAsistenteWidget()" onmousedown="if(window.initDragAsistenteWidget)window.initDragAsistenteWidget()" style="height:40px;padding:0 16px;border:none;border-radius:999px;background:linear-gradient(135deg,#17408B,#2E6FC0);color:#ffffff;font-weight:800;font-size:14px;box-shadow:0 4px 12px rgba(23,64,139,.25);cursor:grab;display:flex;align-items:center;gap:7px;user-select:none;touch-action:none" class="hv-navy">
    <span style="font-size:17px">✨</span> Asistente IA
  </button>
</div>

<style>
.ac-ai-msg { padding: 9px 12px; border-radius: 12px; max-width: 85%; line-height: 1.45; word-wrap: break-word; }
.ac-ai-msg.bot { background: #EAF1FB; color: #16233B; border-bottom-left-radius: 4px; align-self: flex-start; }
.ac-ai-msg.user { background: #17408B; color: #ffffff; border-bottom-right-radius: 4px; align-self: flex-end; }
.ac-ai-msg.loading { font-style: italic; color: #64748B; background: #F1F5FB; }
.dark-theme #ac-ai-chat-box { background: #0B132B !important; border-color: #2A3A5E !important; }
.dark-theme #ac-ai-messages { background: #151F38 !important; }
.dark-theme .ac-ai-msg.bot { background: #1C2B4E !important; color: #F1F5F9 !important; }
.dark-theme #ac-ai-input { background: #1C2B4E !important; border-color: #2A3A5E !important; color: #ffffff !important; }
</style>

<script>
  window.onerror = function(msg, url, line, col, err) {
    var d = document.createElement('div');
    d.style = "position:fixed;top:0;left:0;background:red;color:white;z-index:999999;padding:10px;font-size:14px;white-space:pre-wrap;width:100%;text-align:left;";
    d.textContent = "JS ERR: " + msg + "\\nL: " + line + " C: " + col + "\\nStack: " + (err?err.stack:'');
    document.body.appendChild(d);
  };
</script>
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
          <a href="${hrefBase}${hrefBase.includes('?') ? '&' : '?'}edificio=${encodeURIComponent(f.val)}" style="width:100%;display:flex;align-items:center;gap:11px;padding:10px;background:${f.activo ? '#F1F5FB' : 'transparent'};border-radius:10px;text-align:left" class="hv-soft">
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
 * LOGIN — FRASES ROTATIVAS DIARIAS
 * =================================================================== */

function loginFraseDelDia() {
  const ahora = new Date();
  const dia = ahora.getDate();
  const mes = ahora.getMonth() + 1; // 1-12

  // Fechas Patrias y efemérides argentinas
  const fechasEspeciales = [
    { d: 1,  m: 1,  frase: '¡Feliz Año Nuevo!<br>Un edificio mejor<br>empieza hoy.' },
    { d: 24, m: 3,  frase: 'Memoria, Verdad<br>y Justicia.<br>Siempre presentes.' },
    { d: 2,  m: 4,  frase: 'Día del Veterano<br>y de los Caídos<br>en Malvinas. 🇦🇷' },
    { d: 25, m: 5,  frase: '¡Feliz 25 de Mayo!<br>Un paso hacia<br>la libertad.' },
    { d: 20, m: 6,  frase: 'Día de la Bandera.<br>Ondeá con orgullo,<br>Manuel Belgrano. 🇦🇷' },
    { d: 9,  m: 7,  frase: '¡Feliz Día de<br>la Independencia!<br>Argentina libre. 🎉' },
    { d: 17, m: 8,  frase: 'Día del Libertador<br>San Martín.<br>Un héroe eterno. 🇦🇷' },
    { d: 12, m: 10, frase: 'Día del Respeto<br>a la Diversidad<br>Cultural. 🌎' },
    { d: 20, m: 11, frase: 'Día de la Soberanía<br>Nacional.<br>Vuelta de Obligado. 🇦🇷' },
    { d: 8,  m: 12, frase: 'Día de la<br>Inmaculada Concepción.<br>Paz y esperanza. ✨' },
    { d: 25, m: 12, frase: '¡Feliz Navidad!<br>Un edificio lleno<br>de alegría. 🎄' },
    { d: 31, m: 12, frase: 'Último día del año.<br>Gracias por la confianza.<br>¡Hasta el 2026! 🥂' },
  ];

  const especial = fechasEspeciales.find((f) => f.d === dia && f.m === mes);
  if (especial) return especial.frase;

  // Frases rotativas por día del año
  const frases = [
    'Todo lo que pasó<br>en tu edificio,<br>mientras no estabas.',
    'Tu edificio,<br>siempre atendido.<br>Las 24 horas.',
    'Reclamos resueltos,<br>vecinos tranquilos.<br>Eso es Marcos IA.',
    'Menos llamados<br>en el celular.<br>Más tiempo libre para vos.',
    'Un consorcio<br>bien administrado<br>vale oro. 🏆',
    'Cada reclamo,<br>registrado y atendido.<br>En tiempo real.',
    'Tu edificio habla.<br>Marcos escucha.<br>Vos decidís.',
    'Transparencia total<br>en la administración<br>de tu edificio.',
    'Gestión moderna<br>para consorcios<br>que miran al futuro.',
    'Novedades, reclamos,<br>reservas y más.<br>Todo en un panel.',
    'Administrar bien<br>es hacer el trabajo<br>antes de que lo pidan.',
    'Vecinos felices,<br>edificio organizado.<br>Misión cumplida.',
    'La tecnología<br>al servicio de tu<br>consorcio.',
    'Cada edificio<br>tiene su historia.<br>Marcos la registra.',
  ];

  const diaDelAño = Math.floor((ahora - new Date(ahora.getFullYear(), 0, 0)) / 864e5);
  return frases[diaDelAño % frases.length];
}

router.get('/login', (req, res) => {
  if (req.session && req.session.authed) return res.redirect('/admin');
  const err = req.query.error
    ? `<div style="background:#FDECEC;color:#B4232A;border:1px solid rgba(229,72,77,.35);padding:12px 14px;border-radius:11px;margin-bottom:18px;font-size:13.5px;line-height:1.45">
         <strong style="font-size:14px">Usuario o contraseña incorrectos.</strong><br>
         Si necesitás recuperar tu clave o activar tu cuenta, escribinos a <a href="mailto:Admi@bienargentinos.com" style="color:#B4232A;text-decoration:underline;font-weight:700">Admi@bienargentinos.com</a>
       </div>`
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
  <div class="login-brand" style="position:relative;background:linear-gradient(150deg,#0F326A 0%,#17408B 45%,#2E6FC0 100%);color:#fff;padding:44px 48px;display:flex;flex-direction:column;gap:22px;justify-content:center;overflow-y:auto;min-height:100vh;box-sizing:border-box">
    <div style="position:absolute;top:-120px;right:-120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(217,155,31,.28),transparent 70%);pointer-events:none"></div>
    <div style="position:absolute;bottom:-160px;left:-80px;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.10),transparent 70%);pointer-events:none"></div>
    <div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:14px">
        <a href="https://bienargentinos.com" target="_blank" title="Visitar BienArgentinos.com" style="width:110px;height:70px;background:#fff;border-radius:14px;padding:6px;box-shadow:0 8px 22px -8px rgba(0,0,0,.35);flex-shrink:0;display:flex;align-items:center;justify-content:center"><img src="${LOGO_URL}" alt="Bien Argentinos" style="max-width:100%;max-height:100%;object-fit:contain"></a>
        <div>
          <div style="font-weight:800;font-size:22px;letter-spacing:-.02em;color:#FFFFFF">Marcos IA</div>
          <a href="https://bienargentinos.com" target="_blank" style="font-size:12.5px;color:#FFFFFF;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:4px">por BienArgentinos.com <span style="font-size:11px">🌐 ↗</span></a>
        </div>
      </div>
      <div style="display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);padding:6px 13px;border-radius:999px;font-size:12.5px;font-weight:600;flex-shrink:0">
        <span style="width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 0 4px rgba(74,222,128,.25)"></span>
        Atención 24/7 activa
      </div>
    </div>
    <div style="position:relative;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.26);border-radius:14px;padding:16px 20px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#FFFFFF">Ecosistema Bien Argentinos</span>
        <a href="https://bienargentinos.com" target="_blank" style="font-size:12px;font-weight:800;color:#17408B;background:#FFFFFF;padding:5px 14px;border-radius:999px;text-decoration:none;flex-shrink:0">Visitar Web 🌐</a>
      </div>
      <div style="font-size:13.5px;color:#FFFFFF;line-height:1.45;font-weight:600">
        Descubrí todos los servicios integrales de administración, mantenimiento y tecnología en <strong style="color:#ffffff;text-decoration:underline">BienArgentinos.com</strong>
      </div>
    </div>
    <div style="position:relative">
      <h1 style="font-size:36px;line-height:1.1;font-weight:800;letter-spacing:-.03em;margin:0 0 12px;color:#FFFFFF">${loginFraseDelDia()}</h1>
      <p style="font-size:15.5px;line-height:1.5;color:rgba(255,255,255,.9);max-width:440px;margin:0">Marcos atiende los WhatsApp y llamados de tu consorcio las 24 horas. Este panel es tu ventana: reclamos, reservas, accesos y avisos, ordenados y al día.</p>
    </div>
    <div style="position:relative;display:flex;gap:26px;font-size:13px;color:rgba(255,255,255,.85)">
      <div><span style="display:block;font-size:20px;font-weight:800;color:#fff">24/7</span>sin horarios</div>
      <div><span style="display:block;font-size:20px;font-weight:800;color:#fff">CABA</span>y GBA</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;justify-content:center;padding:40px;min-height:100vh">
    <form method="POST" action="/admin/login" style="width:100%;max-width:380px;animation:mUp .5s ease both">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2E6FC0">Panel de administración</div>
        <a href="https://bienargentinos.com" target="_blank" style="font-size:12px;font-weight:700;color:#2E6FC0;background:#EAF1FB;border:1px solid #DCE4F0;padding:4px 10px;border-radius:999px;text-decoration:none" class="hv-soft">BienArgentinos.com 🌐</a>
      </div>
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
        <a href="mailto:Admi@bienargentinos.com?subject=Recuperacion%20de%20clave%20Marcos%20IA" style="color:#2E6FC0;font-weight:600">¿Olvidaste tu contraseña?</a>
      </div>
      <button type="submit" style="width:100%;height:48px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:15px;cursor:pointer" class="hv-primary">Ingresar al panel</button>
      <p style="text-align:center;margin-top:18px;font-size:14px;color:#64748B">¿Primera vez? <a href="mailto:Admi@bienargentinos.com?subject=Activacion%20de%20cuenta%20Marcos%20IA" style="color:#2E6FC0;font-weight:700">Activá tu cuenta por mail</a></p>
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
  try {
    const { rows: colabRows } = await readTab(TAB_COLABORADORES);
    const colabs = colabRows.map(mapColaborador);
    const colabMatch = colabs.find((c) => c.usuario === user && c.activo);
    if (colabMatch && colabMatch.pass === pass) {
      req.session.authed = true;
      req.session.role = 'dueno';
      req.session.user = user;
      req.session.isColaborador = true;
      return req.session.save(() => res.redirect('/admin'));
    }
  } catch (_) {}
  const consorcioCfg = CONSORCIO_USERS[user];
  if (consorcioCfg && consorcioCfg.pass === pass) {
    req.session.authed = true;
    req.session.role = 'consorcio';
    req.session.user = user;
    req.session.edificios = consorcioCfg.edificios;
    req.session.edificioActivo = undefined; // arranca en "Todos los edificios"
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
      req.session.edificioActivo = undefined; // arranca en "Todos los edificios"
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

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
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
      const edVisibles = filtro ? d.edificios.filter((e) => normEdificio(e.nombre) === normEdificio(filtro)) : d.edificios;
      const evVisibles = filtrarPorEdificio(d.eventos, req);
      
      const usarReciente = !!filtro;
      const filterFn = usarReciente ? esReciente : esDe24Horas;
      const labelPeriodo = usarReciente ? 'Últimos 7 días' : 'Últimas 24 hs';

      const nuevosHoy = evVisibles.filter((e) => filterFn(parseFecha(e.fecha)));
      const urgAbiertas = evVisibles.filter((e) => e.urgencia === 'alta' && estadoNormalizado(e.estado) !== 'resuelto');
      const solPend = d.solicitudes.filter((s) => !s.estado || s.estado === 'pendiente').length;

      const kpis = [
        { icon: '🏢', iconBg: '#EAF1FB', value: String(edVisibles.length), label: 'Edificios activos', href: '/admin/clientes' },
        { icon: '🔔', iconBg: '#EDEEFB', value: String(nuevosHoy.length), label: labelPeriodo, href: '/admin/eventos?tipo=nuevos' },
        { icon: '🚨', iconBg: '#FDECEC', value: String(urgAbiertas.length), label: 'Urgencias abiertas', href: '/admin/eventos?tipo=urgentes' },
        { icon: '📥', iconBg: '#FBF3DE', value: String(solPend), label: 'Solicitudes pendientes', href: '/admin/solicitudes' },
        { icon: '🧾', iconBg: '#E7F4EC', value: '$0', label: 'Excedente facturable', href: '/admin/consumos' },
      ];

      const kpiHtml = kpis.map((k) => `
        <a href="${k.href}" style="display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #E7ECF3;border-radius:15px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,35,59,.04);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease" class="hv-card" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
          <span style="width:38px;height:38px;border-radius:11px;background:${k.iconBg};display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:11px">${k.icon}</span>
          <div style="font-size:27px;font-weight:800;letter-spacing:-.03em;line-height:1">${k.value}</div>
          <div style="font-size:13px;color:#64748B;font-weight:600;margin-top:4px">${k.label}</div>
        </a>`).join('');

      const cardsHtml = edVisibles.map((e) => {
        const ev = d.eventos.filter((x) => compararEdificios(x.edificio, e.nombre));
        // En el listado general de todos los edificios, mostramos novedades de 24 hs
        const nuevos = ev.filter((x) => esDe24Horas(parseFecha(x.fecha))).length;
        const urg = ev.filter((x) => x.urgencia === 'alta' && estadoNormalizado(x.estado) !== 'resuelto').length;
        const cliente = (clienteDelEdificio(d.clientes, e.nombre) || {}).nombre || 'Sin asignar';
        return `
          <a href="/admin/set-filtro?edificio=${encodeURIComponent(e.nombre)}&volver=${encodeURIComponent('/admin/eventos')}"
            style="display:block;text-align:left;background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px;cursor:pointer" class="hv-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <span style="width:42px;height:42px;border-radius:11px;background:#EAF1FB;display:flex;align-items:center;justify-content:center;font-size:19px">🏢</span>
              <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:${urg ? '#FDECEC' : '#E7F4EC'};color:${urg ? '#C0392B' : '#1B7A43'}">${urg ? urg + ' urgente' + (urg === 1 ? '' : 's') : 'Sin urgencias'}</span>
            </div>
            <div style="font-size:16px;font-weight:800;letter-spacing:-.01em">${esc(e.nombre)}</div>
            <div style="font-size:12.5px;color:#8595AD;margin-bottom:12px">${esc(cliente)} · ${esc(e.tipo || 'Edificio')}${e.unidades ? ' · ' + esc(e.unidades) + ' un.' : ''}</div>
            <div style="display:flex;gap:16px;margin-bottom:12px">
              <span style="font-size:13px;color:#334259"><strong style="color:#2E6FC0;font-size:15px">${nuevos}</strong> novedades 24h</span>
            </div>
            ${dibujarConsumoHtml(e.nombre, e.plan, ev)}
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

    // ---------- RESUMEN CLIENTE · TODOS LOS EDIFICIOS (panorama general) ----------
    if (!req.session.edificioActivo && d.propios.length > 1) {
      const greetName = (d.clienteActual ? d.clienteActual.nombre : req.session.user).split(' ')[0];
      const lastConn = req.session.lastConn || '—';
      const evPropios = d.eventos
        .filter((e) => d.propios.some((b) => compararEdificios(b.nombre, e.edificio)))
        .slice()
        .sort((a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0));
      
      // En panorama general, mostramos eventos de 24 horas
      const vistasPropios = evPropios.map((x) => vistaEvento(x, esDe24Horas));
      const novedadesPropios = vistasPropios.filter((v) => v.nuevo);
      const nuevosHoy = evPropios.filter((e) => esDe24Horas(parseFecha(e.fecha)));
      const urgAbiertas = evPropios.filter((e) => e.urgencia === 'alta' && estadoNormalizado(e.estado) !== 'resuelto');
      
      const kpis = [
        { icon: '🏢', iconBg: '#EAF1FB', value: String(d.propios.length), label: 'Tus edificios', action: "document.getElementById('seccion-edificios').scrollIntoView({behavior:'smooth'})" },
        { icon: '🌙', iconBg: '#EDEEFB', value: String(nuevosHoy.length), label: 'Últimas 24 hs', action: "location.href='/admin/eventos?tipo=nuevos'" },
        { icon: '🚨', iconBg: '#FDECEC', value: String(urgAbiertas.length), label: 'Urgencias abiertas', action: "location.href='/admin/eventos?tipo=urgentes'" },
      ];
      const kpiHtml = kpis.map((k) => `
        <div onclick="${k.action}" class="hv-card" style="cursor:pointer;background:#fff;border:1px solid #E7ECF3;border-radius:15px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,35,59,.04);transition:transform .15s ease,box-shadow .15s ease" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
          <span style="width:38px;height:38px;border-radius:11px;background:${k.iconBg};display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:11px">${k.icon}</span>
          <div style="font-size:27px;font-weight:800;letter-spacing:-.03em;line-height:1">${k.value}</div>
          <div style="font-size:13px;color:#64748B;font-weight:600;margin-top:4px">${k.label}</div>
        </div>`).join('');

      // Feed de novedades de TODOS los edificios. Si no hay nada de hoy,
      // no alcanza con "los N más recientes en general": si un edificio
      // tuvo más actividad histórica, tapa a los demás en el corte. Por
      // eso se toman los más recientes DE CADA edificio y recién ahí se
      // combina y ordena, para que el panorama muestre a todos.
      const feedVistas = novedadesPropios.length
        ? novedadesPropios.slice(0, 8)
        : d.propios
          .flatMap((e) => evPropios.filter((x) => compararEdificios(x.edificio, e.nombre)).slice(0, 3))
          .sort((a, b) => (parseFecha(b.fecha) || 0) - (parseFecha(a.fecha) || 0))
          .slice(0, 8)
          .map((x) => vistaEvento(x, esDe24Horas));
      const novHtml = feedVistas.map((v, i) => {
        let rowClass = 'ev-normal';
        if (v.estKey === 'resuelto') rowClass = 'ev-resuelto';
        else if (v.urgKey === 'alta') rowClass = 'ev-urgente';
        else if (v.nuevo) rowClass = 'ev-nuevo';
        return `
        <button onclick="abrirDrawerEvento(${i})" style="width:100%;display:flex;align-items:flex-start;gap:13px;padding:15px 20px 15px 16px;border:none;border-bottom:1px solid #F1F4F9;background:none;cursor:pointer;text-align:left" class="hv-row ${rowClass}">
          <span style="width:40px;height:40px;border-radius:11px;background:${v.catBg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${v.catIcon}</span>
          <span style="flex:1;min-width:0">
            <span style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:800;padding:2px 6px;border-radius:6px;background:#F1F5F9;color:#64748B;font-family:monospace;letter-spacing:-.01em;border:1px solid #E2E8F0">${esc(v.id_evento)}</span>
              <span style="font-size:14.5px;font-weight:700;color:#16233B">${esc(v.titulo)}</span>
              <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:${v.urgBg};color:${v.urgFg}">${v.urgLabel}</span>
              <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#EEF2F8;color:#5A6B85">🏢 ${esc(v.edificio)}</span>
            </span>
            <span style="display:block;font-size:13px;color:#64748B;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.detalle || v.titulo)}</span>
            <span style="display:flex;align-items:center;gap:10px;margin-top:5px;font-size:12px;color:#9AA7BD">
              <span>${v.canalIcon} ${esc(v.canal)}</span><span>·</span><span>${esc(v.vecino)}</span><span>·</span><span>${esc(v.when)}</span>
            </span>
          </span>
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:${v.estBg};color:${v.estFg};flex-shrink:0;margin-top:2px">${v.estLabel}</span>
        </button>`;
      }).join('');

      const cardsHtml = d.propios.map((e) => {
        const ev = d.eventos.filter((x) => compararEdificios(x.edificio, e.nombre));
        const nuevos = ev.filter((x) => esDe24Horas(parseFecha(x.fecha))).length;
        const urg = ev.filter((x) => x.urgencia === 'alta' && estadoNormalizado(x.estado) !== 'resuelto').length;
        return `
          <a href="/admin/set-filtro?edificio=${encodeURIComponent(e.nombre)}"
            style="display:block;text-align:left;background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px;cursor:pointer" class="hv-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <span style="width:42px;height:42px;border-radius:11px;background:#EAF1FB;display:flex;align-items:center;justify-content:center;font-size:19px">🏢</span>
              <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:${urg ? '#FDECEC' : '#E7F4EC'};color:${urg ? '#C0392B' : '#1B7A43'}">${urg ? urg + ' urgente' + (urg === 1 ? '' : 's') : 'Sin urgencias'}</span>
            </div>
            <div style="font-size:16px;font-weight:800;letter-spacing:-.01em">${esc(e.nombre)}</div>
            <div style="font-size:12.5px;color:#8595AD;margin-bottom:12px">${esc(e.direccion || e.nombre)}${e.unidades ? ' · ' + esc(e.unidades) + ' un.' : ''}</div>
            <div style="display:flex;gap:16px;margin-bottom:12px">
              <span style="font-size:13px;color:#334259"><strong style="color:#2E6FC0;font-size:15px">${nuevos}</strong> novedades 24h</span>
            </div>
            ${dibujarConsumoHtml(e.nombre, e.plan, ev)}
          </a>`;
      }).join('');
      const contenido = `
        <div style="animation:mFade .3s ease both">
          <div style="margin-bottom:20px">
            <div style="font-size:13px;font-weight:700;color:#2E6FC0;letter-spacing:.02em;margin-bottom:3px">Hola de nuevo, ${esc(greetName)} 👋</div>
            <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0">Panorama general · todos tus edificios</h1>
          </div>
          <div style="display:flex;align-items:center;gap:16px;background:linear-gradient(120deg,#0F326A,#2E6FC0);border-radius:16px;padding:18px 22px;color:#fff;margin-bottom:22px;flex-wrap:wrap">
            <div style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🌙</div>
            <div style="flex:1;min-width:200px">
              <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">${novedadesPropios.length} novedad${novedadesPropios.length === 1 ? ' nueva' : 'es nuevas'}</div>
              <div style="font-size:14px;color:rgba(255,255,255,.82)">Desde tu última conexión · ${esc(lastConn)}</div>
            </div>
            <a href="/admin/eventos" style="display:inline-flex;align-items:center;height:42px;padding:0 20px;border-radius:11px;background:#fff;color:#17408B;font-weight:700;font-size:14px" class="hv-blue">Ver todo →</a>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:22px" data-tour="metrics">${kpiHtml}</div>
          <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;overflow:hidden;margin-bottom:26px" data-tour="event-table">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #EEF1F6">
              <div style="font-size:16px;font-weight:800">Novedades desde tu ausencia</div>
              <div style="font-size:13px;color:#8595AD;font-weight:600">${novedadesPropios.length} nuevas</div>
            </div>
            ${novHtml || '<div style="padding:26px;text-align:center;font-size:13.5px;color:#8595AD">Sin novedades por ahora.</div>'}
          </div>
          <div id="seccion-edificios" style="font-size:16px;font-weight:800;margin-bottom:14px">Estado por edificio</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${cardsHtml}</div>
        </div>
        <script>window.__EVENTOS__=${jsonEventos(feedVistas)};window.__ES_DUENO__=false;</script>`;
      return res.send(shell(req, d, 'resumen', contenido));
    }

    // ---------- RESUMEN CLIENTE · UN EDIFICIO ----------
    const cur = d.curBuilding;
    const evTodos = d.eventos.filter((e) => cur && compararEdificios(e.edificio, cur.nombre));
    
    // Al entrar a un edificio especifico, mostramos ultimos 7 dias
    const vistas = evTodos.map((x) => vistaEvento(x, esReciente));
    const novedades = vistas.filter((v) => v.nuevo);
    const cUrg = vistas.filter((v) => v.urgKey === 'alta' && v.estKey !== 'resuelto').length;
    const cCurso = vistas.filter((v) => v.estKey === 'curso').length;
    const cRes = vistas.filter((v) => v.estKey === 'resuelto').length;
    const cSinResolver = vistas.filter((v) => v.estKey !== 'resuelto').length;
    
    const greetName = (d.clienteActual ? d.clienteActual.nombre : req.session.user).split(' ')[0];
    const lastConn = req.session.lastConn || '—';

    const statCards = [
      { icon: '🌙', iconBg: '#EAF1FB', value: String(cSinResolver), label: 'Sin resolver', delta: 'pendientes', deltaColor: '#2E6FC0', action: "location.href='/admin/eventos?tipo=abiertos'" },
      { icon: '🚨', iconBg: '#FDECEC', value: String(cUrg), label: 'Urgencias abiertas', delta: cUrg ? 'atención' : 'ok', deltaColor: cUrg ? '#C0392B' : '#1B7A43', action: "location.href='/admin/eventos?tipo=urgentes'" },
      { icon: '⏳', iconBg: '#FBF3DE', value: String(cCurso), label: 'En curso', delta: 'en gestión', deltaColor: '#8A6410', action: "location.href='/admin/eventos?tipo=abiertos'" },
      { icon: '✅', iconBg: '#E7F4EC', value: String(cRes), label: 'Resueltos', delta: 'cerrados', deltaColor: '#1B7A43', action: "location.href='/admin/eventos?tipo=resueltos'" },
    ];

    const statHtml = statCards.map((s) => `
      <div onclick="${s.action}" class="hv-card" style="cursor:pointer;background:#fff;border:1px solid #E7ECF3;border-radius:15px;padding:18px 18px 16px;box-shadow:0 1px 2px rgba(16,35,59,.04);transition:transform .15s ease,box-shadow .15s ease" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
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
            <span style="font-size:11px;font-weight:800;padding:2px 6px;border-radius:6px;background:#F1F5F9;color:#64748B;font-family:monospace;letter-spacing:-.01em;border:1px solid #E2E8F0">${esc(v.id_evento)}</span>
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

    // costos en pesos y dólares desde facturas del edificio
    let arsTotal = 0, usdTotal = 0;
    try {
      const { rows: facRows } = await readTab(TAB_ARCHIVOS);
      facRows.map(mapFactura).filter((f) => cur && compararEdificios(f.edificio, cur.nombre)).forEach((f) => {
        const n = parseFloat(String(f.monto).replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        if (f.moneda === 'USD') usdTotal += n;
        else if (f.moneda === 'ARS' || !f.moneda) arsTotal += n;
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
              <div style="font-size:15px;font-weight:800;margin-bottom:14px">Consumo del plan</div>
              ${dibujarConsumoHtml(cur.nombre, cur.plan, evTodos)}
            </div>
            <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px 20px">
              <div style="font-size:15px;font-weight:800;margin-bottom:4px">🧾 Facturas y Fotos del Consorcio</div>
              <div style="font-size:12.5px;color:#8595AD;margin-bottom:12px;line-height:1.4">Comprobantes y archivos recibidos de vecinos y proveedores</div>
              <a href="/admin/archivos" style="display:flex;align-items:center;justify-content:center;width:100%;height:38px;border:1px solid #E1E7F1;border-radius:10px;background:#F7F9FC;color:#2E6FC0;font-weight:700;font-size:13px" class="hv-soft">Ver Facturas y Fotos →</a>
            </div>
            <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px 20px">
              <div style="font-size:15px;font-weight:800;margin-bottom:4px">📊 Gastos del Consorcio</div>
              <div style="font-size:12.5px;color:#8595AD;margin-bottom:12px;line-height:1.4">Total acumulado de servicios y facturas (Pesos y Dólares)</div>
              <div style="display:flex;gap:10px;margin-bottom:10px">
                <div style="flex:1;background:#EAF1FB;border-radius:12px;padding:12px 14px" class="box-ars">
                  <div style="font-size:11px;font-weight:800;color:#2E6FC0;letter-spacing:.04em">PESOS (ARS)</div>
                  <div style="font-size:19px;font-weight:800;color:#17408B;letter-spacing:-.02em">$${Math.round(arsTotal).toLocaleString('es-AR')}</div>
                </div>
                <div style="flex:1;background:#E7F4EC;border-radius:12px;padding:12px 14px" class="box-usd">
                  <div style="font-size:11px;font-weight:800;color:#1B7A43;letter-spacing:.04em">DÓLARES (USD)</div>
                  <div style="font-size:19px;font-weight:800;color:#14532D;letter-spacing:-.02em">USD $${Math.round(usdTotal).toLocaleString('es-AR')}</div>
                </div>
              </div>
              <div style="font-size:11.5px;color:#8595AD;line-height:1.35">💡 Se calcula automáticamente de los comprobantes y facturas que Marcos procesa en la sección <strong>Facturas/Fotos</strong> de este edificio.</div>
            </div>
          </div>
        </div>
      </div>
      <script>window.__EVENTOS__=${jsonEventos(feedVistas)};window.__ES_DUENO__=false;</script>`;

    res.send(shell(req, d, 'resumen', contenido + modalPlanesAcHtml(d.planesList, d.propios)));
  } catch (e) {
    console.error('Error en /:', e);
    res.status(500).send(paginaError(e));
  }
});

function saludoHora() {
  const h = new Date().getHours();
  if (h < 12) return 'Buen día';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function jsonEventos(vistas, d) {
  var edList = (d && (d.edificios || d.propios)) ? (d.edificios || d.propios) : (global.__EDIFICIOS_CACHE__ || []);
  var edJson = JSON.stringify(edList || [])
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  return JSON.stringify(vistas || [])
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029') + ';window.__EDIFICIOS__=' + edJson;
}

function paginaError(e) {
  return `<!DOCTYPE html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marcos IA · Inconveniente de acceso</title><style>${CSS}</style></head>
  <body style="background:#F4F7FB;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px">
    <div style="width:100%;max-width:480px;background:#fff;border:1px solid #E4E9F1;border-radius:20px;padding:36px 30px;text-align:center;box-shadow:0 20px 50px -15px rgba(16,35,59,.15)">
      <div style="width:64px;height:64px;border-radius:16px;background:#FEF2F2;color:#EF4444;display:inline-flex;align-items:center;justify-content:center;font-size:30px;margin-bottom:18px">🏢</div>
      <h2 style="font-size:22px;font-weight:800;color:#16233B;letter-spacing:-.01em;margin-bottom:10px">Inconveniente al verificar la cuenta</h2>
      <p style="font-size:14.5px;color:#5A6B85;line-height:1.5;margin-bottom:20px">No pudimos verificar los datos de acceso o el edificio asignado en este momento. Si intentabas ingresar, por favor comprobá tu usuario y contraseña.</p>
      
      <div style="background:#F8FAFD;border:1px solid #E4E9F1;border-radius:14px;padding:14px 16px;margin-bottom:24px;text-align:left">
        <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">💬 Soporte y ayuda</div>
        <div style="font-size:13.5px;color:#334259;line-height:1.45">¿Necesitás activar tu cuenta o recuperar tus datos de acceso? Contactanos directamente por correo a:<br><a href="mailto:Admi@bienargentinos.com" style="color:#2E6FC0;font-weight:700;text-decoration:underline">Admi@bienargentinos.com</a></div>
      </div>

      <div style="display:flex;gap:12px">
        <a href="/admin/login" style="flex:1;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;display:inline-flex;align-items:center;justify-content:center">🔑 Ir a Ingresar</a>
        <button onclick="location.reload()" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">🔄 Reintentar</button>
      </div>
    </div>
  </body></html>`;
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

    // Si se filtra un edificio, mostramos ultimos 7 dias. De lo contrario, ultimas 24 hs
    const filtroActivo = dueno ? req.session.filtroEdificioDueno : req.session.edificioActivo;
    const filterFn = filtroActivo ? esReciente : esDe24Horas;

    const vistas = evFiltrados.map((x) => vistaEvento(x, filterFn));

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
      const cU = vistas.filter((v) => v.urgKey === 'alta' && v.estKey !== 'resuelto').length;
      const cA = vistas.filter((v) => v.estKey !== 'resuelto').length;
      const cR = vistas.filter((v) => v.estKey === 'resuelto').length;
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
          ${chip('resueltos', 'Resueltos', cR, false)}
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
    const [d, planesList] = await Promise.all([
      cargarDatos(req),
      obtenerPlanesSuscripcion()
    ]);

    // En modo "Todos los edificios" (más de uno, sin elegir ninguno todavía)
    // se muestra un bloque por edificio para elegir cuál ver en detalle.
    if (!req.session.edificioActivo && d.propios.length > 1) {
      const cards = d.propios.map((e) => {
        const ev = d.eventos.filter((x) => compararEdificios(x.edificio, e.nombre)).length;
        return `
          <a href="/admin/set-filtro?edificio=${encodeURIComponent(e.nombre)}&volver=${encodeURIComponent('/admin/mi-edificio')}"
            style="display:block;text-align:left;background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px;cursor:pointer" class="hv-card">
            <span style="width:42px;height:42px;border-radius:11px;background:#EAF1FB;display:flex;align-items:center;justify-content:center;font-size:19px;margin-bottom:10px">🏢</span>
            <div style="font-size:16px;font-weight:800;letter-spacing:-.01em">${esc(e.nombre)}</div>
            <div style="font-size:12.5px;color:#8595AD;margin-bottom:12px">${esc(e.direccion || e.nombre)}${e.unidades ? ' · ' + esc(e.unidades) + ' un.' : ''}</div>
            ${dibujarConsumoHtml(e.nombre, e.plan, ev)}
          </a>`;
      }).join('');
      const modalNuevoEdificio = modalAltaEdificioHtml('Nuevo edificio', null, planesList);
      const contenido = `
        <div style="animation:mFade .3s ease both">
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
            <div>
              <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Mi Edificio</h1>
              <p style="color:#64748B;font-size:15px;margin:0">Elegí qué edificio querés ver en detalle.</p>
            </div>
            <button onclick="abrirModal('modal-edificio')" style="flex-shrink:0;height:40px;padding:0 18px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">+ Agregar edificio</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${cards}</div>
        </div>
        ${modalNuevoEdificio}`;
      return res.send(shell(req, d, 'edificio', contenido));
    }

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
      asignados = rows.map(mapAsignacion).filter((a) => compararEdificios(a.edificio, cur.nombre) && a.estado !== 'eliminado');
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

    // ---- helpers de ficha (misma fila icono+label+valor para todo:
    // "Editar" guarda directo por modal, "Solicitar cambio" pasa por
    // aprobación del administrador) ----
    const label = (t) => `<div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.02em;margin-bottom:6px">${t}</div>`;
    const fichaRow = (icon, labelTxt, valor, pendiente, boton, extraStyle) => `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:14px;padding:15px 17px;display:flex;align-items:center;gap:12px;${extraStyle || ''}" class="hv-card ${extraStyle ? 'box-gold-border' : ''}">
        <span style="width:40px;height:40px;border-radius:11px;background:#F1F5FB;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#8595AD;letter-spacing:.02em;text-transform:uppercase">${labelTxt}</div>
          <div style="font-size:15.5px;font-weight:700;color:#16233B;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(valor || '—')}</div>
        </div>
        ${pendiente ? '<span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:#FBF3DE;color:#8A6410;flex-shrink:0">Pendiente</span>' : ''}
        ${boton}
      </div>`;
    // Campo directo: sin aprobación, guarda al instante vía modal chico.
    const editRow = (icon, campo, valor, labelTxt, placeholder, ayuda) => fichaRow(icon, labelTxt, valor, false, `
        <button onclick="abrirEditarCampo('${escJs(campo)}','${escJs(labelTxt)}','${escJs(valor || '')}','${escJs(placeholder || '')}','${escJs(ayuda || '')}')" style="flex-shrink:0;height:34px;padding:0 13px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-soft">Editar</button>`);

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
    const horSup = parseHorarioEnc(cur.suplente_horario);
    const timeInput = (id, val) => `<input type="time" id="${id}" value="${esc(val)}" class="inp" style="height:42px;width:auto;min-width:120px">`;
    const rangoHorario = (titulo, idA, valA, idB, valB) => `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:13px;font-weight:700;color:#334259;min-width:120px">${titulo}</span>
        ${timeInput(idA, valA)}
        <span style="color:#8595AD">a</span>
        ${timeInput(idB, valB)}
      </div>`;

    // Modal: estado + horario del encargado (compuesto, se edita junto).
    const modalEncargadoHorario = `
      <div id="modal-encargado-horario" class="modal-overlay" onclick="cerrarModal('modal-encargado-horario')">
        <div class="modal-box" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Editar dato</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Estado y horario del encargado</div>
          </div>
          <div style="padding:20px 24px">
            ${label('Estado del encargado')}
            <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:18px">${btnEstado}</div>
            <input type="hidden" id="enc-estado-val" value="${esc(estadoActual)}">
            <div id="enc-horario-wrap" style="${estadoActual === 'activo' ? '' : 'display:none'}">
              ${label('Horario del encargado (cuando está activo)')}
              ${rangoHorario('Lun a Vie', 'enc-lv1a', hor.lv1[0], 'enc-lv1b', hor.lv1[1])}
              ${rangoHorario('Lun a Vie (2° turno)', 'enc-lv2a', hor.lv2[0], 'enc-lv2b', hor.lv2[1])}
              ${rangoHorario('Sábados', 'enc-saba', hor.sab[0], 'enc-sabb', hor.sab[1])}
              <div style="font-size:12px;color:#9AA7BD;margin-top:4px">Marcos se fija en estos horarios para saber si el encargado está disponible al momento del evento. Dejá vacío el 2° turno si no aplica.</div>
            </div>
            <div id="suplente-horario-wrap" style="${estadoActual !== 'activo' ? '' : 'display:none'}">
              ${label('Horario del suplente/personal de limpieza')}
              ${rangoHorario('Lun a Vie', 'sup-lv1a', horSup.lv1[0], 'sup-lv1b', horSup.lv1[1])}
              ${rangoHorario('Lun a Vie (2° turno)', 'sup-lv2a', horSup.lv2[0], 'sup-lv2b', horSup.lv2[1])}
              ${rangoHorario('Sábados', 'sup-saba', horSup.sab[0], 'sup-sabb', horSup.sab[1])}
              <div style="font-size:12px;color:#9AA7BD;margin-top:4px">Marcos se fija en estos horarios para saber si el suplente o limpieza está de turno cuando el encargado principal no está disponible.</div>
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-encargado-horario')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarEncargadoHorario(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Guardar</button>
          </div>
        </div>
      </div>`;

    const estadoInfo = estados.find((e) => e.key === estadoActual) || estados[0];
    const horarioResumen = [
      hor.lv1[0] && hor.lv1[1] ? `L-V ${hor.lv1[0]}–${hor.lv1[1]}` : null,
      hor.lv2[0] && hor.lv2[1] ? `L-V ${hor.lv2[0]}–${hor.lv2[1]}` : null,
      hor.sab[0] && hor.sab[1] ? `Sáb ${hor.sab[0]}–${hor.sab[1]}` : null,
    ].filter(Boolean).join(' · ') || 'Sin horario';
    const horarioSupResumen = [
      horSup.lv1[0] && horSup.lv1[1] ? `L-V ${horSup.lv1[0]}–${horSup.lv1[1]}` : null,
      horSup.lv2[0] && horSup.lv2[1] ? `L-V ${horSup.lv2[0]}–${horSup.lv2[1]}` : null,
      horSup.sab[0] && horSup.sab[1] ? `Sáb ${horSup.sab[0]}–${horSup.sab[1]}` : null,
    ].filter(Boolean).join(' · ') || 'Sin horario';
    const estadoHorarioValor = `${estadoInfo.label} · ${estadoActual === 'activo' ? horarioResumen : '(Suplente: ' + horarioSupResumen + ')'}`;
    const estadoHorarioRow = fichaRow('🕒', 'Estado y horario del encargado', estadoHorarioValor, false, `
        <button onclick="abrirModal('modal-encargado-horario')" style="flex-shrink:0;height:34px;padding:0 13px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-soft">Editar</button>`);

    // Fichas de "Editar" directo (sin aprobación) — se arman abajo y se
    // combinan con las de "Solicitar cambio" en una sola grilla, a modo
    // de ficha de presentación completa del edificio.
    const encargadoRows = [
      editRow('🧑‍🔧', 'encargado', cur.encargado, 'Encargado', 'Nombre y apellido'),
      editRow('📞', 'tel_encargado', cur.tel_encargado, 'Tel. encargado', 'Teléfono'),
    ];
    const datosDirectosRows = [
      editRow('🏠', 'unidades', cur.unidades, 'Unidades', 'Cantidad'),
      editRow('📅', 'horario_sum', cur.horario_sum, 'Horario SUM', 'Ej: 10 a 24hs · seña $15.000'),
      editRow('🚗', 'cocheras', cur.cocheras, 'Cocheras', 'Ej: 22 fijas + 4 de cortesía'),
      editRow('🗺️', 'zona', cur.zona, 'Zona / barrio', 'Barrio, ciudad'),
      editRow('🏷️', 'aliases', cur.aliases, 'Alias / doble dirección', 'Ej: Ortiz 1486 (como lo conocen los vecinos)', 'Si el edificio figura con una altura legal pero los vecinos lo nombran distinto, cargá acá los dos. Marcos reconoce cualquiera de las dos.'),
      editRow('📞', 'tel_seguridad', cur.tel_seguridad, 'Tel. seguridad de la entrada', 'Si el edificio tiene'),
      editRow('🧑‍🔧', 'encargado_suplente', cur.encargado_suplente, 'Encargado suplente / limpieza', 'Quién lo cubre'),
      editRow('📞', 'tel_suplente', cur.tel_suplente, 'Tel. suplente', 'Teléfono'),
      estadoHorarioRow,
    ];

    // ---- PROVEEDORES: asignados a este edificio + asignar desde la lista ----
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
            <span class="rubro-badge ${getRubroClass(a.rubro)}">${esc(a.rubro)}</span>
            <div style="flex:1;min-width:120px">
              <div style="font-size:14.5px;font-weight:700">${esc(a.proveedor || '—')}</div>
              ${m.notas ? `<div style="font-size:12px;color:#8595AD">${esc(m.notas)}</div>` : ''}
            </div>
            <span class="prio-badge prio-${esc(a.prioridad)}">${esc(pr.label)}</span>
            <div style="font-size:14px;font-weight:700;color:#2E6FC0">${esc(tel)}</div>
            <button onclick="desasignarProveedor(this,${a._row})" class="btn-remove hv-red">Quitar</button>
          </div>`;
      }).join('')
      : '<div style="font-size:13.5px;color:#8595AD;padding:6px 2px">Todavía no asignaste proveedores a este edificio. Elegí de tu lista abajo.</div>';

    // Opciones para asignar: los de la maestra que no estan ya asignados.
    const yaAsignados = new Set(asignados.map((a) => String(a.proveedor).trim().toLowerCase()));
    const disponibles = maestros.filter((m) => !yaAsignados.has(String(m.nombre).trim().toLowerCase()));
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
          <button onclick="asignarProveedor(this,'${escJs(cur.nombre)}')" style="height:44px;padding:0 20px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">Asignar</button>
        </div>` : '<div style="font-size:13px;color:#8595AD">Ya asignaste todos tus proveedores a este edificio.</div>'}
      </div>` : `
      <div style="border-top:1px dashed #E4E9F1;padding-top:16px;font-size:13.5px;color:#8595AD">
        Todavía no tenés proveedores en tu lista. Cargalos una vez con el botón de arriba y después asignalos a cada edificio.
      </div>`;

    const proveedoresCard = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px">
          <div style="font-size:16px;font-weight:800">🧰 Proveedores de este edificio</div>
          <a href="/admin/proveedores" style="display:inline-flex;align-items:center;height:36px;padding:0 14px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:13px;cursor:pointer" class="hv-soft">Mi lista de proveedores (${maestros.length})</a>
        </div>
        <p style="font-size:13px;color:#8595AD;margin:0 0 16px">Cuando surge un evento (pérdida de agua, ascensor, etc.), Marcos recurre al proveedor del rubro según la prioridad que le pongas acá. Cargás cada proveedor <strong>una sola vez</strong> en tu lista y lo asignás a los edificios que quieras.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">${asigFilas}</div>
        ${asignarBloque}
      </div>`;

    // ---- FICHA COMPLETA: todo junto, una sola grilla — orientativa para
    // el cliente. Los datos sensibles piden permiso; el resto se edita
    // directo. ----
    const solicitarRow = (icon, campo, labelTxt, valorCrudo, extraStyle) => {
      const value = valorCrudo || '—';
      return fichaRow(icon, labelTxt, value, pendCampos.has(campo), `
        <button onclick="abrirSolicitud('${escJs(campo)}','${escJs(labelTxt)}','${escJs(value === '—' ? '' : value)}','${escJs(cur.nombre)}')" style="flex-shrink:0;height:34px;padding:0 13px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-softb">Solicitar cambio</button>`, extraStyle);
    };

    // Bloques organizados temáticamente
    const bloqueBaseHtml = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <span style="font-size:20px">🏢</span>
          <h2 style="font-size:16px;font-weight:800;letter-spacing:-.01em;margin:0;color:#16233B">Información Base e Identidad</h2>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
          ${solicitarRow('🏢', 'nombre', 'Consorcio', cur.nombre)}
          ${solicitarRow('📍', 'direccion', 'Dirección', cur.direccion)}
          ${editRow('🏷️', 'aliases', cur.aliases, 'Alias / doble dirección', 'Ej: Ortiz 1486 (como lo conocen los vecinos)', 'Si el edificio figura con una altura legal pero los vecinos lo nombran distinto, cargá acá los dos. Marcos reconoce cualquiera de las dos.')}
          ${solicitarRow('🧾', 'cuit', 'CUIT del edificio', cur.cuit)}
          ${editRow('🗺️', 'zona', cur.zona, 'Zona / barrio', 'Barrio, ciudad')}
          ${editRow('🏠', 'unidades', cur.unidades, 'Unidades funcionales', 'Cantidad')}
          ${editRow('🚗', 'cocheras', cur.cocheras, 'Cocheras y Cortesía', 'Ej: 22 fijas + 4 de cortesía', 'Cantidad de cocheras fijas del edificio y cocheras de cortesía para visitas.')}
          ${solicitarRow('👔', 'administrador', 'Administrador', cur.administrador)}
          ${solicitarRow('📞', 'telefonos', 'Tel. administración', cur.telefonos)}
        </div>
      </div>`;

    function parseStaffList(namesStr, telsStr) {
      if (!namesStr && !telsStr) return [];
      const rawNames = String(namesStr || '').split(/,|\n|;/).map(s => s.trim()).filter(Boolean);
      const rawTels = String(telsStr || '').split(/,|\n|;/).map(s => s.trim()).filter(Boolean);
      const res = [];

      for (let i = 0; i < rawNames.length; i++) {
        let str = rawNames[i];
        let tel = rawTels[i] || (rawTels.length === 1 ? rawTels[0] : '—');
        let estado = 'activo';
        let horario = '';

        const isScheduleFragment = /^(L-V|Sáb|Dom|Lun|Mar|Mié|Jue|Vie|\d{1,2}:)/i.test(str.replace(/^[^a-z0-9]+/i, ''));
        if (isScheduleFragment && res.length > 0) {
          const cleanHor = str.replace(/\[[^\]]*\]/g, '').replace(/\]/g, '').replace(/^[^a-z0-9]+/i, '').trim();
          if (cleanHor) {
            res[res.length - 1].horario = (res[res.length - 1].horario === 'Sin horario' || !res[res.length - 1].horario)
              ? cleanHor
              : res[res.length - 1].horario + ' · ' + cleanHor;
          }
          continue;
        }

        const matchMeta = str.match(/\[(activo|licencia|vacaciones)?\s*\|?\s*([^\]]*)\]/i);
        if (matchMeta) {
          if (matchMeta[1]) estado = matchMeta[1].toLowerCase();
          if (matchMeta[2]) horario = matchMeta[2].trim();
          str = str.replace(/\[[^\]]*\]/g, '').trim();
        }

        const matchTel = str.match(/\(([^)]+)\)/);
        if (matchTel && (!tel || tel === '—')) {
          tel = matchTel[1].trim();
          str = str.replace(/\([^)]+\)/g, '').trim();
        }

        str = str.replace(/\[|\]/g, '').trim();

        if (str || tel !== '—') {
          res.push({
            nombre: str || 'Personal',
            tel: tel || '—',
            estado: estado || 'activo',
            horario: horario || 'Sin horario'
          });
        }
      }
      return res;
    }

    function renderStaffCards(namesStr, telsStr, fieldKey, icon, labelTitle, edNombre, edRow) {
      const list = parseStaffList(namesStr, telsStr);
      let html = '';
      if (!list.length) {
        html = `<div style="font-size:12.5px;color:#8595AD;font-style:italic;padding:6px 2px">Sin datos cargados. Usá <strong>+ Añadir</strong> para agregar.</div>`;
      } else {
        html = list.map((item, idx) => {
          let stBadge = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:#E7F4EC;color:#1B7A43">🟢 Activo</span>';
          if (item.estado === 'licencia') stBadge = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:#FBF3DE;color:#8A6410">🟡 Licencia</span>';
          else if (item.estado === 'vacaciones') stBadge = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:#EAF1FB;color:#2C55A8">🔵 Vacaciones</span>';

          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:1px solid #E7ECF3;border-radius:12px;background:#fff;margin-bottom:8px;gap:16px;flex-wrap:wrap" class="hv-card">
              <!-- Izquierda: Nombre y Teléfono -->
              <div style="display:flex;align-items:center;gap:12px;min-width:180px;flex:1">
                <span style="font-size:20px;flex-shrink:0">${icon}</span>
                <div style="min-width:0;flex:1">
                  <div style="font-size:14px;font-weight:800;color:#16233B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.nombre)}</div>
                  <div style="font-size:12.5px;color:#2E6FC0;font-weight:700;margin-top:2px">📞 ${esc(item.tel)}</div>
                </div>
              </div>
              
              <!-- Centro (Recuadro Verde del usuario): Estado y Horarios -->
              <div style="display:flex;align-items:center;gap:12px;min-width:240px;flex:1.5;background:#F8FAFD;padding:8px 14px;border-radius:10px;border:1px solid #E2E8F0">
                ${stBadge}
                <div style="font-size:12.5px;color:#475569;font-weight:600;display:flex;align-items:center;gap:5px">
                  <span>🕒</span> <span>${esc(item.horario)}</span>
                </div>
              </div>

              <!-- Derecha: Acciones -->
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                <button onclick="abrirModalStaffItem('${escJs(fieldKey)}', ${idx}, '${escJs(edNombre)}')" style="font-size:12.5px;font-weight:700;color:#2E6FC0;background:none;border:none;cursor:pointer;padding:4px 8px" class="hv-soft">Editar</button>
                <button onclick="eliminarStaffItem('${escJs(fieldKey)}', ${idx}, '${escJs(edNombre)}')" style="font-size:12.5px;font-weight:700;color:#EF4444;background:none;border:none;cursor:pointer;padding:4px 8px" class="hv-red">Eliminar</button>
              </div>
            </div>`;
        }).join('');
      }

      return `
        <div style="background:#F8FAFD;border:1px solid #E7ECF3;border-radius:14px;padding:16px 18px;margin-bottom:16px" class="box-staff-section">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap">
            <div style="font-size:14px;font-weight:800;color:#16233B;display:flex;align-items:center;gap:7px">
              <span>${icon}</span> ${esc(labelTitle)}
            </div>
            <button onclick="abrirModalStaffItem('${escJs(fieldKey)}', -1, '${escJs(edNombre)}')" style="display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 14px;border:none;border-radius:999px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-primary">+ Añadir</button>
          </div>
          <div>${html}</div>
        </div>`;
    }

    const bloqueServiciosHtml = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <span style="font-size:20px">👥</span>
          <h2 style="font-size:16px;font-weight:800;letter-spacing:-.01em;margin:0;color:#16233B">Personal, Limpieza y Seguridad del Edificio</h2>
        </div>

        ${renderStaffCards(cur.encargado, cur.tel_encargado, 'encargado', '🧑‍🔧', 'Encargados Titulares', cur.nombre, cur._row)}
        ${renderStaffCards(cur.encargado_suplente, cur.tel_suplente, 'suplente', '🧹', 'Encargados Suplentes y Personal de Limpieza', cur.nombre, cur._row)}
        ${renderStaffCards(cur.tel_seguridad, '', 'seguridad', '🛡️', 'Personal de Portería y Seguridad Entrada', cur.nombre, cur._row)}
      </div>`;

    let accesosEdificio = [];
    try {
      const { buscarAccesosEdificio } = require('./datos');
      accesosEdificio = await buscarAccesosEdificio(cur.nombre);
    } catch (_) {}

    const renderFilasAccesosHtml = (lista) => {
      if (!lista || !lista.length) {
        return `<div style="text-align:center;padding:24px 16px;color:#8595AD;font-size:13.5px;font-style:italic">No hay instalaciones o accesos cargados para este edificio. Escribí una descripción arriba o usá el botón + Añadir.</div>`;
      }
      const filas = lista.map((a) => {
        const origHtml = a.origen
          ? `<span style="font-size:10px;font-weight:600;color:#64748B;background:#F1F5FB;border:1px solid #E2E8F0;padding:2px 7px;border-radius:6px;margin-left:6px" title="Origen del dato">${esc(a.origen)}</span>`
          : '';
        return `
          <tr style="border-bottom:1px solid #EEF1F6">
            <td style="padding:12px 14px;vertical-align:top">
              <div style="font-size:13.5px;font-weight:800;color:#16233B;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
                <span>${esc(a.lugar || '—')}</span>
                ${origHtml}
              </div>
            </td>
            <td style="padding:12px 14px;vertical-align:top;color:#334259;font-weight:600">${esc(a.ubicacion || '—')}</td>
            <td style="padding:12px 14px;vertical-align:top;color:#334259">${esc(a.quienAbre || a.quien_abre || '—')}</td>
            <td style="padding:12px 14px;vertical-align:top;color:#2E6FC0;font-weight:700">${esc(a.telefono || '—')}</td>
            <td style="padding:12px 14px;vertical-align:top;color:#334259">${esc(a.tipoAcceso || a.tipo_acceso || '—')}</td>
            <td style="padding:12px 14px;vertical-align:top;color:#64748B;font-size:12.5px">${esc(a.notas || '—')}</td>
            <td style="padding:12px 14px;vertical-align:top;text-align:right">
              <button data-lugar="${esc(a.lugar || '')}" onclick="quitarAcceso(this.dataset.lugar)" style="font-size:12.5px;font-weight:700;color:#EF4444;background:none;border:none;cursor:pointer;padding:4px 8px" class="hv-red">Quitar</button>
            </td>
          </tr>`;
      }).join('');

      return `
        <div style="overflow-x:auto;border:1px solid #E7ECF3;border-radius:12px;background:#fff">
          <table style="width:100%;border-collapse:collapse;text-align:left;font-size:13px">
            <thead>
              <tr style="background:#F8FAFD;border-bottom:1px solid #E7ECF3;color:#8595AD;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em">
                <th style="padding:12px 14px">Lugar / Instalación</th>
                <th style="padding:12px 14px">Dónde está</th>
                <th style="padding:12px 14px">Quién abre</th>
                <th style="padding:12px 14px">Teléfono</th>
                <th style="padding:12px 14px">Tipo de acceso</th>
                <th style="padding:12px 14px">Notas</th>
                <th style="padding:12px 14px;text-align:right">Acción</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
            </tbody>
          </table>
        </div>`;
    };

    const bloqueAccesosHtml = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:20px">🔑</span>
            <div>
              <h2 style="font-size:16px;font-weight:800;letter-spacing:-.01em;margin:0;color:#16233B">Instalaciones y Accesos</h2>
            </div>
          </div>
          <button onclick="abrirModalAccesoNuevo('${escJs(cur.nombre)}')" style="display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 14px;border:none;border-radius:999px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:13px;cursor:pointer" class="hv-primary">+ Añadir</button>
        </div>

        <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:14px;padding:16px 18px;margin-bottom:18px">
          <div style="font-size:13.5px;font-weight:800;color:#16233B;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <span>🗣️</span> <span>Descripción hablada / relato del edificio</span>
          </div>
          <p style="font-size:12.5px;color:#64748B;margin:0 0 10px">Escribí en un párrafo cómo están distribuidas las instalaciones y llaves. Marcos IA extraerá automáticamente cada lugar y completará la tabla abajo.</p>
          <textarea id="accesos-relato-texto" class="inp" style="width:100%;height:80px;resize:vertical;margin-bottom:10px;font-size:13px;background:#fff" placeholder="Contame cómo es el edificio: dónde están la sala de máquinas, los medidores, el tablero, las bombas, la llave de gas, y quién tiene la llave de cada una."></textarea>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div id="accesos-relato-msg" style="font-size:13px;font-weight:700;color:#1B7A43;display:none;background:#E7F4EC;padding:6px 12px;border-radius:8px;border:1px solid #A3D9B1"></div>
            <button onclick="guardarRelatoAccesos(this)" style="height:38px;padding:0 18px;border:none;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:13px;cursor:pointer;margin-left:auto" class="hv-primary">Guardar descripción</button>
          </div>
        </div>

        <div id="tabla-accesos-container">
          ${renderFilasAccesosHtml(accesosEdificio)}
        </div>
      </div>`;

    const modalAccesoNuevoHtml = `
      <div id="modal-acceso-nuevo" class="modal-overlay" onclick="cerrarModal('modal-acceso-nuevo')">
        <div class="modal-box" style="max-width:500px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Instalaciones y Accesos</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">🔑 Añadir Instalación o Acceso</div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Lugar / Instalación <span style="color:#EF4444">*</span></div>
            <input id="acc-lugar" class="inp" placeholder="Ej: Sala de máquinas, Llave de gas, Tablero principal" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Dónde está (Ubicación)</div>
            <input id="acc-ubicacion" class="inp" placeholder="Ej: Subsuelo al fondo, Pasillo de entrada" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Quién abre / Tiene la llave</div>
            <input id="acc-quien-abre" class="inp" placeholder="Ej: Encargado, Portería, Administración" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono de contacto</div>
            <input id="acc-tel" class="inp" placeholder="Ej: 5491155554444" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Tipo de acceso</div>
            <input id="acc-tipo" class="inp" placeholder="Ej: Llave física, Combinación, Candado, Libre" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Notas / Observaciones (opcional)</div>
            <input id="acc-notas" class="inp" placeholder="Ej: Llave duplicada en administración">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-acceso-nuevo')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarAccesoNuevo(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar instalación</button>
          </div>
        </div>
      </div>`;

    const planReqOptions = (planesList || []).map((p) => `<option value="${esc(p.nombre)}">${esc(p.nombre)}${Number(p.precio) > 0 ? ' ($' + Number(p.precio).toLocaleString('es-AR') + '/mes)' : ' (Gratis)'}</option>`).join('');

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
            <div id="req-nuevo-input-wrap">
              <input id="req-nuevo" placeholder="Escribí el valor correcto" class="inp" style="margin-bottom:16px">
            </div>
            <div id="req-nuevo-select-wrap" style="display:none">
              <select id="req-nuevo-plan" class="inp" style="margin-bottom:16px">
                ${planReqOptions}
              </select>
            </div>
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Motivo <span style="font-weight:500;color:#9AA7BD">(opcional)</span></div>
            <textarea id="req-motivo" placeholder="Ej: Cambiamos de plan para acceder a nuevos servicios." class="inp"></textarea>
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

    // Modal genérico para editar un campo directo (sin aprobación).
    const modalEditarCampo = `
      <div id="modal-editar-campo" class="modal-overlay" onclick="cerrarModal('modal-editar-campo')">
        <div class="modal-box" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Editar dato</div>
            <div id="ec-label" style="font-size:19px;font-weight:800;letter-spacing:-.01em"></div>
          </div>
          <div style="padding:20px 24px">
            <input id="ec-valor" placeholder="" class="inp">
            <div id="ec-ayuda" style="font-size:12px;color:#9AA7BD;margin-top:8px;display:none"></div>
            <div id="ec-pdf-wrap" style="display:none;margin-top:16px;padding-top:14px;border-top:1px dashed #E2E8F0">
              <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">📄 Adjuntar / Actualizar Reglamento del SUM (PDF)</label>
              <input type="file" id="ec-pdf-file" accept="application/pdf" class="inp" style="padding:8px">
              <div style="font-size:11.5px;color:#8595AD;margin-top:4px">Marcos compartirá este documento PDF con los vecinos cuando soliciten el reglamento del SUM.</div>
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-editar-campo')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarCampoEditado(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Guardar</button>
          </div>
        </div>
      </div>`;

    let vecinos = [];
    try {
      const { rows: vRows } = await readTab(TAB_VECINOS);
      vecinos = vRows.map(mapVecino).filter((v) => cur && compararEdificios(v.edificio, cur.nombre) && v.estado !== 'eliminado');
    } catch (_) {}

    const vecinosFilas = vecinos.length ? vecinos.map((v, idx) => {
      const waTel = String(v.telefono || '').replace(/\D/g, '');
      const idUsuario = '#VEC-' + String(v._row || idx + 1).padStart(3, '0');
      return `
        <div class="vecino-fila-item" data-vecino-search="${esc((v.nombre + ' ' + (v.unidad || '') + ' ' + (v.telefono || '') + ' ' + (v.email || '')).toLowerCase())}" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #E7ECF3;border-radius:12px;background:#fff;flex-wrap:wrap">
          <span style="font-size:12.5px;font-weight:800;background:#EBF3FC;color:#1E5FB4;padding:4px 10px;border-radius:8px;border:1px solid #BFDBFE;letter-spacing:.02em">
            ${esc(v.unidad || 'S/D')}
          </span>
          <div style="flex:1;min-width:140px">
            <div style="font-size:14.5px;font-weight:700;color:#16233B">${esc(v.nombre || 'Sin nombre')}</div>
            <div style="font-size:12px;color:#8595AD">${esc(v.email ? v.email : 'Sin email')}${v.notas ? ' · ' + esc(v.notas) : ''}</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:#64748B;background:#F1F5F9;padding:4px 8px;border-radius:6px">
            ${esc(idUsuario)}
          </div>
          <div style="font-size:13.5px;font-weight:700;color:#2E6FC0;min-width:110px">
            ${waTel ? `<a href="https://wa.me/${esc(waTel)}" target="_blank" style="color:#2E6FC0;text-decoration:none;display:inline-flex;align-items:center;gap:4px">💬 ${esc(v.telefono)}</a>` : '<span style="color:#94A3B8">Sin teléfono</span>'}
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${waTel ? `<button onclick="invitarVecinoWhatsApp('${escJs(v.nombre)}','${escJs(v.telefono)}','${escJs(cur.nombre)}')" class="btn-edit-sm hv-soft" style="color:#15803D;background:#DCFCE7;border-color:#86EFAC;font-weight:700" title="Enviar enlace de acceso al portal por WhatsApp">📱 Invitar</button>` : ''}
            <button onclick="abrirEditarVecino(${v._row},'${escJs(v.nombre)}','${escJs(v.unidad || '')}','${escJs(v.telefono || '')}','${escJs(v.email || '')}','${escJs(v.notas || '')}')" class="btn-edit-sm hv-soft">Editar</button>
            <button onclick="eliminarVecino(this,${v._row})" class="btn-remove-sm hv-red">Quitar</button>
          </div>
        </div>`;
    }).join('') : '<div style="font-size:13.5px;color:#8595AD;padding:6px 2px">Todavía no hay vecinos registrados para este edificio. Agregá el primer vecino o importá el padrón.</div>';

    const vecinosCard = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
          <div>
            <div style="font-size:16px;font-weight:800;color:#16233B">👥 Padrón de Vecinos y Unidades Funcionales (${vecinos.length})</div>
            <p style="font-size:13px;color:#8595AD;margin:2px 0 0">Listado de propietarios e inquilinos registrados para atención 24/7 y acceso a la Web App del consorcio.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="/porteria/cartel/${encodeURIComponent(cur.nombre)}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border:1px solid #DCE4F0;border-radius:999px;background:#F8FAFD;color:#0F326A;font-weight:700;font-size:13px;text-decoration:none" class="hv-soft">🔔 Cartel Portería QR</a>
            <button onclick="abrirModalImportarVecinos('${escJs(cur.nombre)}')" style="height:36px;padding:0 14px;border:1px solid #DCE4F0;border-radius:999px;background:#fff;color:#2E6FC0;font-weight:700;font-size:13px;cursor:pointer" class="hv-soft">📥 Importar padrón</button>
            <button onclick="abrirModalVecinoNuevo('${escJs(cur.nombre)}')" style="height:36px;padding:0 14px;border:none;border-radius:999px;background:#2E6FC0;color:#fff;font-weight:700;font-size:13px;cursor:pointer">+ Agregar vecino</button>
          </div>
        </div>
        ${vecinos.length > 3 ? `
        <div style="margin:12px 0">
          <input id="busc-vecinos-inp" oninput="filtrarVecinosList(this.value)" class="inp" placeholder="🔍 Buscar por nombre, departamento, teléfono o email..." style="height:38px;font-size:13.5px;margin:0">
        </div>` : '<div style="margin-bottom:12px"></div>'}
        <div id="lista-vecinos-wrap" style="display:flex;flex-direction:column;gap:10px;max-height:480px;overflow-y:auto;padding-right:6px">${vecinosFilas}</div>
      </div>`;

    let amenitiesEdificio = [];
    let reservasEdificio = [];
    try {
      const { pool } = require('./db-pg');
      if (pool && cur) {
        const qAm = `SELECT * FROM edificio_amenities WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) AND activo = TRUE ORDER BY id ASC`;
        const resAm = await pool.query(qAm, [cur.nombre, '%' + cur.nombre + '%']);
        if (resAm && resAm.rows) amenitiesEdificio = resAm.rows;

        const qR = `SELECT * FROM reservas_amenities WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) AND estado != 'cancelada' ORDER BY fecha DESC, hora_desde ASC, id DESC LIMIT 20`;
        const resR = await pool.query(qR, [cur.nombre, '%' + cur.nombre + '%']);
        if (resR && resR.rows) reservasEdificio = resR.rows;
      }
    } catch (_) {}

    const amenitiesCard = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div>
            <div style="font-size:16px;font-weight:800;color:#16233B;display:flex;align-items:center;gap:6px">
              <span>🏊</span> <span>Amenities y Espacios Comunes (${amenitiesEdificio.length || 'Estándar'})</span>
            </div>
            <p style="font-size:13px;color:#8595AD;margin:2px 0 0">Espacios disponibles para reserva por horas desde la Web App del Vecino (SUM, Piscina, Gimnasio, Parrilla, Quincho, etc.).</p>
          </div>
          <button onclick="abrirModalAmenityNuevo('${escJs(cur ? cur.nombre : '')}')" style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border:none;border-radius:999px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:13px;cursor:pointer" class="hv-primary">
            <span>+ Agregar Amenity</span>
          </button>
        </div>

        <!-- Badges de Amenities Configurados -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:18px">
          ${amenitiesEdificio.length ? amenitiesEdificio.map(a => `
            <div style="display:flex;flex-direction:column;justify-content:space-between;padding:12px 14px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFD;gap:10px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span style="font-size:24px">${esc(a.icono || '🎉')}</span>
                  <div>
                    <div style="font-size:14px;font-weight:800;color:#0F172A">${esc(a.nombre)}</div>
                    <div style="font-size:12px;color:#64748B">⏰ ${esc(a.hora_apertura || '08:00')} a ${esc(a.hora_cierre || '23:00')} hs · Cap. ${esc(a.capacidad || 20)} pers.</div>
                    <div style="font-size:11.5px;font-weight:700;margin-top:3px">
                      ${a.arancelado && Number(a.precio) > 0 ? `<span style="color:#D97706;background:#FEF3C7;padding:2px 8px;border-radius:6px">💰 Arancel: $${Number(a.precio).toLocaleString('es-AR')}</span>` : `<span style="color:#15803D;background:#DCFCE7;padding:2px 8px;border-radius:6px">🟢 Sin costo adicional</span>`}
                    </div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:4px">
                  <button onclick="abrirModalAmenityEditar(${a.id}, '${escJs(a.nombre)}', '${escJs(a.icono || '🎉')}', '${escJs(a.hora_apertura || '08:00')}', '${escJs(a.hora_cierre || '23:00')}', ${a.capacidad || 20}, '${escJs(a.descripcion || '')}', '${escJs(a.reglamento || '')}', ${a.arancelado ? 'true' : 'false'}, ${Number(a.precio) || 0})" style="border:1px solid #CBD5E1;background:#fff;color:#2E6FC0;font-size:11.5px;font-weight:700;border-radius:6px;padding:3px 8px;cursor:pointer" class="hv-blue">✏️ Editar</button>
                  <button onclick="eliminarAmenity(${a.id}, '${escJs(a.nombre)}')" style="border:none;background:none;color:#EF4444;font-size:13px;font-weight:700;cursor:pointer;padding:4px" title="Eliminar amenity">✕</button>
                </div>
              </div>
              <div style="background:#fff;border:1px solid #EEF2F6;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#475569;line-height:1.4">
                <div style="font-weight:700;color:#0F326A;margin-bottom:2px">📜 Reglamento / Normas:</div>
                <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.reglamento ? esc(a.reglamento) : '<em style="color:#94A3B8">Sin reglamento específico cargado. Usa normas generales.</em>'}</div>
              </div>
            </div>
          `).join('') : `
            <div style="grid-column:1/-1;padding:12px 14px;background:#F8FAFD;border:1px dashed #CBD5E1;border-radius:10px;font-size:12.5px;color:#64748B">
              💡 <em>Catálogo estándar activo (SUM, Parrilla, Pileta, Gimnasio, Cochera de Cortesía, Laundry). Podés agregar espacios personalizados con horarios y reglamentos propios usando el botón <strong>+ Agregar Amenity</strong>.</em>
            </div>
          `}
        </div>

        <!-- Historial de Reservas Activas -->
        <div style="border-top:1px solid #EEF1F6;padding-top:14px">
          <div style="font-size:14px;font-weight:800;color:#16233B;margin-bottom:8px">📅 Reservas Activas (${reservasEdificio.length})</div>
          ${reservasEdificio.length ? `
          <div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto">
            ${reservasEdificio.map(r => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #E2E8F0;border-radius:10px;background:#fff;gap:10px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:18px">🎉</span>
                  <div>
                    <div style="font-size:13px;font-weight:800;color:#0F172A">${esc(r.amenity)} · <span style="color:#1E5FB4">${esc(r.departamento || 'Depto')} (${esc(r.nombre_vecino || 'Vecino')})</span></div>
                    <div style="font-size:12px;color:#64748B">📆 ${esc(r.fecha)} · ⏰ <strong>${esc(r.hora_desde || '00:00')} a ${esc(r.hora_hasta || '00:00')} hs</strong>${r.notas ? ' · 📝 ' + esc(r.notas) : ''}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  ${r.monto > 0 ? `
                    ${r.estado_pago === 'aprobado' ? `<span style="font-size:11px;font-weight:800;background:#DCFCE7;color:#15803D;padding:3px 8px;border-radius:6px">✅ Pago Aprobado ($${Number(r.monto).toLocaleString('es-AR')})</span>` :
                      r.estado_pago === 'comprobante_subido' ? `
                        <span style="font-size:11px;font-weight:800;background:#E0F2FE;color:#0369A1;padding:3px 8px;border-radius:6px">🧾 Comprobante Recibido</span>
                        ${r.comprobante_url ? `<a href="${r.comprobante_url}" target="_blank" style="font-size:11px;color:#2E6FC0;font-weight:700;text-decoration:underline">Ver</a>` : ''}
                        <button onclick="cambiarEstadoPagoReserva(${r.id}, 'aprobado')" style="border:none;background:#15803D;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;cursor:pointer">✓ Aprobar</button>` :
                        `<span style="font-size:11px;font-weight:800;background:#FEF3C7;color:#92400E;padding:3px 8px;border-radius:6px">⏳ Pendiente ($${Number(r.monto).toLocaleString('es-AR')})</span>`
                    }
                  ` : `<span style="font-size:11px;font-weight:700;color:#15803D;background:#DCFCE7;padding:2px 7px;border-radius:6px">Sin costo</span>`}
                </div>
              </div>
            `).join('')}
          </div>` : '<div style="font-size:12.5px;color:#8595AD;padding:4px 0">No hay reservas registradas para este edificio todavía.</div>'}
        </div>
      </div>`;

    const modalAmenityNuevoHtml = `
      <div id="modal-amenity-nuevo" class="modal-overlay" onclick="cerrarModal('modal-amenity-nuevo')">
        <div class="modal-box" style="max-width:520px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Espacios Comunes</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">🏊 Añadir Amenity al Edificio</div>
          </div>
          <div style="padding:20px 24px;max-height:75vh;overflow-y:auto">
            <input type="hidden" id="amenity-nuevo-edificio" value="${esc(cur ? cur.nombre : '')}">
            <div style="margin-bottom:14px">
              <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Nombre del espacio común</label>
              <input id="amenity-nuevo-nombre" placeholder="Ej: SUM, Piscina, Gimnasio, Coworking, Cancha de Tenis" class="inp" style="background:#fff">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Ícono</label>
                <select id="amenity-nuevo-icono" class="inp" style="background:#fff">
                  <option value="🎉">🎉 Salón / SUM</option>
                  <option value="🥩">🥩 Parrilla / Quincho</option>
                  <option value="🏊">🏊 Piscina / Solarium</option>
                  <option value="🏋️">🏋️ Gimnasio</option>
                  <option value="🧺">🧺 Laundry / Lavadero</option>
                  <option value="💼">💼 Coworking / Sala</option>
                  <option value="🚗">🚗 Cochera de Cortesía / Estacionamiento</option>
                  <option value="🎾">🎾 Cancha de Paddle / Tenis</option>
                  <option value="🌅">🌅 Terraza / Rooftop</option>
                </select>
              </div>
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Capacidad (personas)</label>
                <input type="number" id="amenity-nuevo-capacidad" value="20" min="1" max="500" class="inp" style="background:#fff">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Horario Apertura</label>
                <input type="time" id="amenity-nuevo-apertura" value="08:00" class="inp" style="background:#fff">
              </div>
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Horario Cierre</label>
                <input type="time" id="amenity-nuevo-cierre" value="23:00" class="inp" style="background:#fff">
              </div>
            </div>
            <div style="margin-bottom:14px">
              <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Descripción o Equipamiento</label>
              <textarea id="amenity-nuevo-desc" placeholder="Ej: Aire acondicionado, vajilla para 30 personas, heladera y parrilla." class="inp" style="height:55px;resize:vertical;background:#fff"></textarea>
            </div>
            <div style="background:#F1F5FB;border:1px solid #DCE4F0;border-radius:12px;padding:12px 14px;margin-bottom:14px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;font-weight:800;color:#0F326A">
                <input type="checkbox" id="amenity-nuevo-arancelado" onchange="document.getElementById('box-precio-nuevo').style.display=this.checked?'block':'none'" style="width:18px;height:18px">
                <span>¿Requiere pago / arancel de reserva o seña?</span>
              </label>
              <div id="box-precio-nuevo" style="display:none;margin-top:10px">
                <label style="font-size:12px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Monto / Seña ($ ARS)</label>
                <input type="number" id="amenity-nuevo-precio" value="0" min="0" step="500" placeholder="Ej: 15000" class="inp" style="background:#fff">
              </div>
            </div>
            <div style="margin-bottom:14px">
              <label style="font-size:13px;font-weight:700;color:#0F326A;display:block;margin-bottom:4px">📜 Reglamento y Normas del Sector</label>
              <div style="font-size:11.5px;color:#64748B;margin-bottom:6px">Marcos IA usará estas reglas para responder dudas específicas de vecinos (música, depósitos, limpieza, etc.).</div>
              <textarea id="amenity-nuevo-reglamento" placeholder="Ej: Música hasta 01:00 hs. Seña de $15.000 para limpieza. Dejar vajilla limpia. Prohibido fumar adentro." class="inp" style="height:80px;resize:vertical;background:#fff"></textarea>
            </div>
          </div>
          <div style="display:flex;gap:10px;padding:0 24px 20px">
            <button onclick="cerrarModal('modal-amenity-nuevo')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarAmenityNuevo(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar Amenity</button>
          </div>
        </div>
      </div>`;

    const modalAmenityEditarHtml = `
      <div id="modal-amenity-editar" class="modal-overlay" onclick="cerrarModal('modal-amenity-editar')">
        <div class="modal-box" style="max-width:520px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Espacios Comunes</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">✏️ Editar Amenity & Reglamento</div>
          </div>
          <div style="padding:20px 24px;max-height:75vh;overflow-y:auto">
            <input type="hidden" id="amenity-edit-id">
            <input type="hidden" id="amenity-edit-edificio" value="${esc(cur ? cur.nombre : '')}">
            <div style="margin-bottom:14px">
              <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Nombre del espacio común</label>
              <input id="amenity-edit-nombre" class="inp" style="background:#fff">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Ícono</label>
                <select id="amenity-edit-icono" class="inp" style="background:#fff">
                  <option value="🎉">🎉 Salón / SUM</option>
                  <option value="🥩">🥩 Parrilla / Quincho</option>
                  <option value="🏊">🏊 Piscina / Solarium</option>
                  <option value="🏋️">🏋️ Gimnasio</option>
                  <option value="🧺">🧺 Laundry / Lavadero</option>
                  <option value="💼">💼 Coworking / Sala</option>
                  <option value="🚗">🚗 Cochera de Cortesía / Estacionamiento</option>
                  <option value="🎾">🎾 Cancha de Paddle / Tenis</option>
                  <option value="🌅">🌅 Terraza / Rooftop</option>
                </select>
              </div>
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Capacidad (personas)</label>
                <input type="number" id="amenity-edit-capacidad" class="inp" style="background:#fff">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Horario Apertura</label>
                <input type="time" id="amenity-edit-apertura" class="inp" style="background:#fff">
              </div>
              <div>
                <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Horario Cierre</label>
                <input type="time" id="amenity-edit-cierre" class="inp" style="background:#fff">
              </div>
            </div>
            <div style="margin-bottom:14px">
              <label style="font-size:13px;font-weight:700;color:#334259;display:block;margin-bottom:6px">Descripción o Equipamiento</label>
              <textarea id="amenity-edit-desc" class="inp" style="height:55px;resize:vertical;background:#fff"></textarea>
            </div>
            <div style="background:#F1F5FB;border:1px solid #DCE4F0;border-radius:12px;padding:12px 14px;margin-bottom:14px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;font-weight:800;color:#0F326A">
                <input type="checkbox" id="amenity-edit-arancelado" onchange="document.getElementById('box-precio-edit').style.display=this.checked?'block':'none'" style="width:18px;height:18px">
                <span>¿Requiere pago / arancel de reserva o seña?</span>
              </label>
              <div id="box-precio-edit" style="display:none;margin-top:10px">
                <label style="font-size:12px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Monto / Seña ($ ARS)</label>
                <input type="number" id="amenity-edit-precio" value="0" min="0" step="500" placeholder="Ej: 15000" class="inp" style="background:#fff">
              </div>
            </div>
            <div style="margin-bottom:14px">
              <label style="font-size:13px;font-weight:700;color:#0F326A;display:block;margin-bottom:4px">📜 Reglamento y Normas del Sector</label>
              <div style="font-size:11.5px;color:#64748B;margin-bottom:6px">Marcos IA usará estas reglas para responder dudas específicas de vecinos (música, depósitos, limpieza, gorro de pileta, etc.).</div>
              <textarea id="amenity-edit-reglamento" placeholder="Ej: Música permitida hasta 01:00 hs. Seña de $15.000 para limpieza. Prohibido fumar adentro. Dejar vajilla limpia." class="inp" style="height:80px;resize:vertical;background:#fff"></textarea>
            </div>
          </div>
          <div style="display:flex;gap:10px;padding:0 24px 20px">
            <button onclick="cerrarModal('modal-amenity-editar')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarAmenityEditado(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar Cambios</button>
          </div>
        </div>
      </div>`;

    const modalVecinosImportarHtml = `
      <div id="modal-vecinos-importar" class="modal-overlay" onclick="cerrarModal('modal-vecinos-importar')">
        <div class="modal-box" style="max-width:620px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Padrón de Vecinos</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">📥 Importar Padrón desde Excel / CSV</div>
          </div>
          <div style="padding:20px 24px;max-height:75vh;overflow-y:auto">
            <input type="hidden" id="imp-vec-edificio">
            
            <div style="background:#F1F5FB;border:1px solid #DCE5F2;border-radius:12px;padding:12px 14px;font-size:12.5px;color:#334259;margin-bottom:16px;line-height:1.4">
              💡 <strong>Instrucciones:</strong> Podés subir un archivo <code>.csv</code> exportado de Excel o copiar las celdas directamente en tu planilla y pegarlas abajo.<br>
              <strong>Columnas recomendadas:</strong> Unidad / Depto · Nombre · Teléfono · Email
            </div>

            <div style="margin-bottom:14px">
              <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Opción A: Subir archivo (.csv / .txt)</div>
              <input type="file" id="imp-vec-file" accept=".csv,.txt" onchange="leerArchivoVecinos(this)" class="inp" style="padding:8px">
            </div>

            <div style="margin-bottom:16px">
              <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Opción B: Pegar datos de Excel (Ctrl+V)</div>
              <textarea id="imp-vec-textarea" oninput="procesarTextoVecinosImportar(this.value)" class="inp" placeholder="Ejemplo:&#10;1° A	Juan Pérez	1155551111	juan@gmail.com&#10;1° B	María Gómez	1155552222	maria@gmail.com&#10;2° A	Carlos Sosa	1155553333	carlos@gmail.com" style="height:110px;font-family:monospace;font-size:12px"></textarea>
            </div>

            <div style="margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
              <div style="font-size:13px;font-weight:800;color:#16233B">Previsualización de datos</div>
              <div id="imp-vec-count" style="font-size:12px;font-weight:700;color:#2E6FC0">0 vecinos detectados</div>
            </div>

            <div style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;max-height:190px;overflow-y:auto;background:#fff">
              <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">
                <thead>
                  <tr style="background:#F8FAFC;border-bottom:1px solid #E2E8F0;color:#64748B">
                    <th style="padding:8px 10px">Unidad</th>
                    <th style="padding:8px 10px">Nombre</th>
                    <th style="padding:8px 10px">Teléfono</th>
                    <th style="padding:8px 10px">Email</th>
                  </tr>
                </thead>
                <tbody id="imp-vec-preview-body">
                  <tr><td colspan="4" style="text-align:center;padding:24px;color:#8595AD;font-size:13px">Pegá texto desde Excel o subí un CSV para previsualizar aquí.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:16px 24px 22px;border-top:1px solid #EEF1F6">
            <button onclick="cerrarModal('modal-vecinos-importar')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button id="imp-vec-btn-guardar" onclick="ejecutarImportacionVecinos(this)" disabled style="flex:1.4;height:44px;border:none;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Importar vecinos</button>
          </div>
        </div>
      </div>`;

    const modalVecinoNuevoHtml = `
      <div id="modal-vecino-nuevo" class="modal-overlay" onclick="cerrarModal('modal-vecino-nuevo')">
        <div class="modal-box" style="max-width:480px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Padrón de Vecinos</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">👥 Agregar Vecino</div>
          </div>
          <div style="padding:20px 24px">
            <input type="hidden" id="vec-edificio">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre y apellido</div>
            <input id="vec-nombre" class="inp" placeholder="Ej: Lucía Gómez" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Unidad Funcional / Departamento</div>
            <input id="vec-unidad" class="inp" placeholder="Ej: 4° B" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono WhatsApp</div>
            <input id="vec-tel" class="inp" placeholder="Ej: +54 9 11 5555 4444" style="margin-bottom:4px">
            <div style="font-size:11.5px;color:#64748B;margin-bottom:14px">⚠️ Incluir +54 para WhatsApp y acceso web.</div>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email (opcional)</div>
            <input id="vec-email" class="inp" placeholder="ejemplo@correo.com" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Notas / Observaciones (opcional)</div>
            <input id="vec-notas" class="inp" placeholder="Ej: Inquilino / Propietario">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-vecino-nuevo')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarVecinoNuevo(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar vecino</button>
          </div>
        </div>
      </div>`;

    const modalVecinoEditarHtml = `
      <div id="modal-vecino-editar" class="modal-overlay" onclick="cerrarModal('modal-vecino-editar')">
        <div class="modal-box" style="max-width:480px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Padrón de Vecinos</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">✏️ Editar Vecino</div>
          </div>
          <div style="padding:20px 24px">
            <input type="hidden" id="edit-vec-row">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre y apellido</div>
            <input id="edit-vec-nombre" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Unidad / Departamento</div>
            <input id="edit-vec-unidad" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono WhatsApp</div>
            <input id="edit-vec-tel" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email (opcional)</div>
            <input id="edit-vec-email" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Notas (opcional)</div>
            <input id="edit-vec-notas" class="inp">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-vecino-editar')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarEditarVecino(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:#2E6FC0;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar cambios</button>
          </div>
        </div>
      </div>`;

    let consejo = [];
    try {
      const { rows: cRows } = await readTab(TAB_CONSEJO);
      consejo = cRows.map(mapConsejo).filter((c) => cur && compararEdificios(c.edificio, cur.nombre) && c.estado !== 'eliminado');
    } catch (_) {}

    const consejoFilas = consejo.length ? consejo.map((c) => {
      const cargoClass = 'cargo-' + String(c.cargo || 'otro').toLowerCase().replace(/[^a-z]/g, '');
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #E7ECF3;border-radius:12px;background:#fff;flex-wrap:wrap">
          <span class="cargo-badge ${cargoClass}">${esc(c.cargo)}</span>
          <div style="flex:1;min-width:140px">
            <div style="font-size:14.5px;font-weight:700">${esc(c.nombre)}${c.unidad ? ' (' + esc(c.unidad) + ')' : ''}</div>
            <div style="font-size:12px;color:#8595AD">${esc(c.telefono || 'Sin teléfono')}${c.email ? ' · ' + esc(c.email) : ''}${c.notas ? ' · ' + esc(c.notas) : ''}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="abrirEditarConsejo(${c._row},'${escJs(c.nombre)}','${escJs(c.cargo)}','${escJs(c.unidad || '')}','${escJs(c.telefono || '')}','${escJs(c.email || '')}','${escJs(c.notas || '')}')" class="btn-edit-sm hv-soft">Editar</button>
            <button onclick="eliminarConsejo(this,${c._row})" class="btn-remove-sm hv-red">Quitar</button>
          </div>
        </div>`;
    }).join('') : '<div style="font-size:13.5px;color:#8595AD;padding:6px 2px">Todavía no agregaste integrantes del Consejo de Administración para este edificio.</div>';

    const consejoCard = `
      <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
          <div style="font-size:16px;font-weight:800">🏛️ Consejo de Administración / Integrantes</div>
          <button onclick="abrirModalConsejoNuevo('${escJs(cur.nombre)}')" style="height:36px;padding:0 14px;border:none;border-radius:999px;background:#2E6FC0;color:#fff;font-weight:700;font-size:13px;cursor:pointer">+ Agregar integrante</button>
        </div>
        <p style="font-size:13px;color:#8595AD;margin:0 0 14px">Registrá a las personas del consejo (Presidente, Tesorero, Vocales) para rotaciones y contactos de consulta del edificio.</p>
        <div style="display:flex;flex-direction:column;gap:10px">${consejoFilas}</div>
      </div>`;

    const modalConsejoNuevoHtml = `
      <div id="modal-consejo-nuevo" class="modal-overlay" onclick="cerrarModal('modal-consejo-nuevo')">
        <div class="modal-box" style="max-width:480px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Consejo de Administración</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">🏛️ Agregar Integrante</div>
          </div>
          <div style="padding:20px 24px">
            <input type="hidden" id="cons-edificio">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre y apellido</div>
            <input id="cons-nombre" class="inp" placeholder="Ej: Roberto Gómez" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Cargo / Rol</div>
            <select id="cons-cargo" class="inp" style="margin-bottom:14px">
              <option value="Presidente">Presidente</option>
              <option value="Tesorero">Tesorero</option>
              <option value="Vocal">Vocal / Integrante</option>
              <option value="Suplente">Suplente</option>
            </select>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Unidad / Departamento</div>
            <input id="cons-unidad" class="inp" placeholder="Ej: 4° B" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono</div>
            <input id="cons-tel" class="inp" placeholder="Ej: +54 9 11 2233 4455" style="margin-bottom:4px">
            <div style="font-size:11.5px;color:#64748B;margin-bottom:14px">⚠️ Incluir +54 para Argentina / Neuquén / interior.</div>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email (opcional)</div>
            <input id="cons-email" class="inp" placeholder="ejemplo@email.com" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Notas / Observaciones (opcional)</div>
            <input id="cons-notas" class="inp" placeholder="Ej: tiene firma autorizada">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-consejo-nuevo')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarConsejoNuevo(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:#2E6FC0;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar integrante</button>
          </div>
        </div>
      </div>`;

    const modalConsejoEditarHtml = `
      <div id="modal-consejo-editar" class="modal-overlay" onclick="cerrarModal('modal-consejo-editar')">
        <div class="modal-box" style="max-width:480px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Consejo de Administración</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">✏️ Editar Integrante</div>
          </div>
          <div style="padding:20px 24px">
            <input type="hidden" id="edit-cons-row">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre y apellido</div>
            <input id="edit-cons-nombre" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Cargo / Rol</div>
            <select id="edit-cons-cargo" class="inp" style="margin-bottom:14px">
              <option value="Presidente">Presidente</option>
              <option value="Tesorero">Tesorero</option>
              <option value="Vocal">Vocal / Integrante</option>
              <option value="Suplente">Suplente</option>
            </select>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Unidad / Departamento</div>
            <input id="edit-cons-unidad" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono</div>
            <input id="edit-cons-tel" class="inp" placeholder="Ej: +54 9 11 2233 4455" style="margin-bottom:4px">
            <div style="font-size:11.5px;color:#64748B;margin-bottom:14px">⚠️ Incluir +54 para Argentina / Neuquén / interior.</div>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email (opcional)</div>
            <input id="edit-cons-email" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Notas (opcional)</div>
            <input id="edit-cons-notas" class="inp">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-consejo-editar')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarEditarConsejo(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:#2E6FC0;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar cambios</button>
          </div>
        </div>
      </div>`;

    const modalStaffEditHtml = `
      <div id="modal-staff-edit" class="modal-overlay" onclick="cerrarModal('modal-staff-edit')">
        <div class="modal-box" style="max-width:520px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Personal del Edificio</div>
            <div id="staff-modal-title" style="font-size:19px;font-weight:800;letter-spacing:-.01em">➕ Personal</div>
          </div>
          <div style="padding:20px 24px;max-height:75vh;overflow-y:auto">
            <input type="hidden" id="staff-inp-ed" value="">
            <input type="hidden" id="staff-inp-row" value="">
            <input type="hidden" id="staff-inp-key" value="">
            <input type="hidden" id="staff-inp-idx" value="-1">
            
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre y Apellido / Rol / Puesto</div>
            <input id="staff-inp-nombre" class="inp" placeholder="Ej: Juan Carlos (Turno Mañana)" style="margin-bottom:14px">
            
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono de contacto (WhatsApp)</div>
            <input id="staff-inp-tel" class="inp" placeholder="Ej: 5491155554444" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Estado de disponibilidad</div>
            <select id="staff-inp-estado" class="inp" style="margin-bottom:16px">
              <option value="activo">🟢 Activo (Trabajando normalmente)</option>
              <option value="licencia">🟡 Licencia médica / Ausente</option>
              <option value="vacaciones">🔵 Vacaciones</option>
            </select>

            <div style="font-size:13px;font-weight:700;color:#16233B;margin-bottom:8px">Horarios de Trabajo / Atención (3 Turnos)</div>
            <div style="font-size:12px;color:#64748B;margin-bottom:12px">Especificá los rangos horarios exactos para que Marcos IA sepa cuándo está disponible.</div>

            <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;margin-bottom:12px">
              <div style="font-size:12.5px;font-weight:700;color:#2E6FC0;margin-bottom:6px">🗓️ Lun a Vie (1° Turno)</div>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="time" id="staff-inp-lv1a" class="inp" style="height:40px;width:auto">
                <span style="font-size:13px;color:#64748B;font-weight:700">a</span>
                <input type="time" id="staff-inp-lv1b" class="inp" style="height:40px;width:auto">
              </div>
            </div>

            <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;margin-bottom:12px">
              <div style="font-size:12.5px;font-weight:700;color:#2E6FC0;margin-bottom:6px">🗓️ Lun a Vie (2° Turno / Cortado - Opcional)</div>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="time" id="staff-inp-lv2a" class="inp" style="height:40px;width:auto">
                <span style="font-size:13px;color:#64748B;font-weight:700">a</span>
                <input type="time" id="staff-inp-lv2b" class="inp" style="height:40px;width:auto">
              </div>
            </div>

            <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;margin-bottom:14px">
              <div style="font-size:12.5px;font-weight:700;color:#2E6FC0;margin-bottom:6px">🗓️ Sábados (Opcional)</div>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="time" id="staff-inp-saba" class="inp" style="height:40px;width:auto">
                <span style="font-size:13px;color:#64748B;font-weight:700">a</span>
                <input type="time" id="staff-inp-sabb" class="inp" style="height:40px;width:auto">
              </div>
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:16px 24px 22px;border-top:1px solid #EEF1F6">
            <button onclick="cerrarModal('modal-staff-edit')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarStaffItem(this)" style="flex:1.4;height:44px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-primary">Guardar</button>
          </div>
        </div>
      </div>`;

    const modalNuevoEdificio = modalAltaEdificioHtml('Nuevo edificio', null, planesList);

    const contenido = `
      <div style="animation:mFade .3s ease both">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <h1 style="font-size:26px;font-weight:800;letter-spacing:-.01em;margin:0">${esc(cur ? cur.nombre : 'Mi Edificio')}</h1>
            ${selectorEdificioHtml(cur ? cur.nombre : 'Elegí edificio', 'Cambiar edificio', 'Mis Edificios', d.propios.map((x) => ({ label: x.nombre, sub: x.direccion, val: x.nombre, activo: cur && x.nombre === cur.nombre })), '/admin/set-filtro?volver=' + encodeURIComponent('/admin/mi-edificio'))}
            <button onclick="abrirModalPlanesAc('${escJs(cur ? cur.nombre : '')}')" style="height:34px;padding:0 13px;border:1px solid #C9D5E8;border-radius:999px;background:#EAF1FB;color:#2E6FC0;font-weight:700;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px" class="hv-blue">
              <span>💳 Plan: <strong>${esc(cur ? cur.plan : 'Base')}</strong></span>
              <span style="font-size:11px;opacity:.8">· Cambiar plan ↗</span>
            </button>
          </div>
          <button onclick="abrirModal('modal-edificio')" style="flex-shrink:0;height:40px;padding:0 18px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">+ Agregar edificio</button>
        </div>

        <div style="background:#F1F5FB;border:1px solid #DCE5F2;border-radius:14px;padding:12px 18px;margin-bottom:20px;display:flex;align-items:center;gap:11px;font-size:13.5px;color:#334259" class="info-recuadro">
          <span style="font-size:18px;flex-shrink:0">💡</span>
          <span>Tocá <strong>"Editar"</strong> para actualizar un dato al instante, o <strong>"Solicitar cambio"</strong> en los datos sensibles del consorcio.</span>
        </div>
        ${pendHtml}
        ${bloqueBaseHtml}
        ${bloqueServiciosHtml}
        ${bloqueAccesosHtml}
        ${vecinosCard}
        ${amenitiesCard}
        ${consejoCard}
        ${proveedoresCard}
      </div>
      ${modalSolicitud}
      ${modalEncargadoHorario}
      ${modalEditarCampo}
      ${modalNuevoEdificio}
      ${modalVecinoNuevoHtml}
      ${modalVecinoEditarHtml}
      ${modalVecinosImportarHtml}
      ${modalConsejoNuevoHtml}
      ${modalConsejoEditarHtml}
      ${modalStaffEditHtml}
      ${modalAccesoNuevoHtml}
      ${modalAmenityNuevoHtml}
      ${modalAmenityEditarHtml}
      ${modalPlanesAcHtml(planesList, d.propios)}
      <script>window.__CUR_BUILDING__=${JSON.stringify(cur)};window.__EDIFICIOS__=${JSON.stringify(d.propios)};window.__ES_DUENO__=false;</script>`;

    res.send(shell(req, d, 'edificio', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * PROVEEDORES (cliente) — lista MAESTRA, independiente de cualquier
 * edificio. Se carga una sola vez acá; después se asigna a cada
 * edificio (con prioridad) desde "Mi Edificio".
 * =================================================================== */

router.get('/proveedores', async (req, res) => {
  if (esDueno(req)) return res.redirect('/admin/clientes');
  try {
    const d = await cargarDatos(req);
    const usuarioCliente = enPreview(req) ? req.session.previewOwner : req.session.user;

    let maestros = [];
    try {
      const { rows } = await readTab(TAB_PROVEEDORES);
      maestros = rows.map(mapProveedor).filter((p) => p.cliente === usuarioCliente && p.estado !== 'eliminado');
    } catch (_) {}

    const label = (t) => `<div style="font-size:12px;font-weight:700;color:#8595AD;text-transform:uppercase;letter-spacing:.02em;margin-bottom:6px">${t}</div>`;

    // Los datos de cobro, y sobre todo el aviso de cambio pendiente. Un cambio de CBU que llegó
    // por WhatsApp NO se aplicó: acá se aprueba o se rechaza. Hasta entonces sigue vigente el
    // anterior, que es lo que evita que a alguien le desvíen el pago del mes.
    const bloqueCobro = (m) => {
      const tienePendiente = Boolean(m.cbu_pendiente || m.alias_pendiente);
      const ult4 = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : ''; };

      const vigente = (m.cbu || m.alias_cbu)
        ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:#334259">
             <span style="font-weight:700;color:#8595AD">Cobra en:</span>
             ${m.cbu ? `<span title="${esc(m.cbu)}">CBU ····${esc(ult4(m.cbu))}</span>` : ''}
             ${m.alias_cbu ? `<span style="font-weight:700;color:#2E6FC0">${esc(m.alias_cbu)}</span>` : ''}
             ${m.titular ? `<span style="color:#64748B">a nombre de ${esc(m.titular)}</span>` : ''}
           </div>`
        : `<div style="font-size:12.5px;color:#8595AD">Sin datos de cobro cargados. Marcos los toma solo cuando el proveedor se los manda.</div>`;

      const pendiente = tienePendiente
        ? `<div style="margin-top:10px;background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:11px 13px">
             <div style="font-size:12.5px;font-weight:800;color:#9A3412;margin-bottom:4px">🔐 Pidió cambiar su cuenta — NO se aplicó</div>
             <div style="font-size:12.5px;color:#7C2D12;line-height:1.5">
               Nuevo: ${m.cbu_pendiente ? `CBU ····${esc(ult4(m.cbu_pendiente))}` : ''} ${m.alias_pendiente ? `alias <b>${esc(m.alias_pendiente)}</b>` : ''}<br>
               ${m.cbu_pendiente_desde ? `<span style="color:#9A3412">Desde ${esc(m.cbu_pendiente_desde)}.</span> ` : ''}
               Sigue vigente la cuenta anterior hasta que usted decida.
             </div>
             <div style="font-size:12px;color:#7C2D12;margin-top:8px;background:#FFEDD5;border-radius:8px;padding:8px 10px">
               ⚠️ Antes de aprobar, confirmelo con el proveedor <b>llamándolo al número de siempre</b>, no respondiendo al mensaje. Desviar un pago cambiando el CBU es el fraude más común que hay.
             </div>
             <div style="display:flex;gap:8px;margin-top:10px">
               <button onclick="resolverCambioCobro(this,${m._row},true)" style="height:36px;padding:0 14px;border:none;border-radius:9px;background:#15803D;color:#fff;font-weight:700;font-size:13px;cursor:pointer" class="hv-primary">Aprobar cambio</button>
               <button onclick="resolverCambioCobro(this,${m._row},false)" style="height:36px;padding:0 14px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#334259;font-weight:700;font-size:13px;cursor:pointer" class="hv-soft">Rechazar</button>
             </div>
           </div>`
        : '';

      return `<div style="flex-basis:100%;margin-top:10px;padding-top:10px;border-top:1px dashed #E7ECF3">
                ${vigente}${pendiente}
              </div>`;
    };

    const filas = maestros.length ? maestros.map((m) => `
      <div style="display:flex;align-items:center;gap:13px;padding:14px 16px;border:1px solid ${(m.cbu_pendiente || m.alias_pendiente) ? '#FDBA74' : '#E7ECF3'};border-radius:12px;background:#fff;flex-wrap:wrap">
        <span class="rubro-badge ${getRubroClass(m.rubro)}">${esc(m.rubro)}</span>
        <div style="flex:1;min-width:140px">
          <div style="font-size:14.5px;font-weight:700">${esc(m.nombre || '—')}</div>
          ${m.notas ? `<div style="font-size:12px;color:#8595AD">${esc(m.notas)}</div>` : ''}
        </div>
        <div style="font-size:14px;font-weight:700;color:#2E6FC0">${esc(m.telefono || '—')}</div>
        <div style="display:flex;gap:6px">
          <button onclick="abrirDatosCobro(${m._row},'${escJs(m.nombre)}','${escJs(m.cbu || '')}','${escJs(m.alias_cbu || '')}','${escJs(m.titular || '')}','${escJs(m.cuit || '')}')" class="btn-edit hv-soft">🏦 Cobro</button>
          <button onclick="abrirEditarProveedor(${m._row},'${escJs(m.rubro)}','${escJs(m.nombre)}','${escJs(m.telefono)}','${escJs(m.notas || '')}')" class="btn-edit hv-soft">Editar</button>
          <button onclick="quitarProveedor(this,${m._row})" class="btn-remove hv-red">Quitar</button>
        </div>
        ${bloqueCobro(m)}
      </div>`).join('') : '<div style="text-align:center;padding:36px 20px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px">Tu lista está vacía. Agregá tu primer proveedor abajo.</div>';

    const rubroOptions = RUBROS_PROVEEDOR.map((r) => `<option value="${r}">${r}</option>`).join('');

    const modalEditarProveedorHtml = `
      <div id="modal-editar-proveedor" class="modal-overlay" onclick="cerrarModal('modal-editar-proveedor')">
        <div class="modal-box" style="max-width:480px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Lista Maestra de Proveedores</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">✏️ Editar Proveedor</div>
          </div>
          <div style="padding:20px 24px">
            <input type="hidden" id="edit-prov-row">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Rubro / Especialidad</div>
            <select id="edit-prov-rubro" class="inp" style="margin-bottom:14px">${rubroOptions}</select>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre / Empresa</div>
            <input id="edit-prov-nombre" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Teléfono de contacto</div>
            <input id="edit-prov-tel" class="inp" placeholder="Ej: +54 9 11 2233 4455" style="margin-bottom:4px">
            <div style="font-size:11.5px;color:#64748B;margin-bottom:14px">⚠️ Incluir siempre +54 (o código de país) y característica regional.</div>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Notas (opcional)</div>
            <input id="edit-prov-notas" class="inp" placeholder="Ej: Atiende 24hs">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-editar-proveedor')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarEditarProveedor(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:#2E6FC0;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar cambios</button>
          </div>
        </div>
      </div>`;

    // Carga o corrección a mano de los datos de cobro. El CBU se verifica del lado del servidor
    // con los dígitos verificadores: un número mal tipeado acá termina en un pago rechazado.
    const modalDatosCobroHtml = `
      <div id="modal-datos-cobro" class="modal-overlay" onclick="cerrarModal('modal-datos-cobro')">
        <div class="modal-box" style="max-width:480px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Datos de cobro</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">🏦 <span id="cobro-nombre">Proveedor</span></div>
          </div>
          <div style="padding:20px 24px">
            <input type="hidden" id="cobro-row">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">CBU (22 dígitos)</div>
            <input id="cobro-cbu" class="inp" inputmode="numeric" placeholder="0070059930004567890123" style="margin-bottom:4px">
            <div style="font-size:11.5px;color:#64748B;margin-bottom:14px">Se verifica antes de guardar. Si está mal escrito, no se acepta.</div>

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Alias</div>
            <input id="cobro-alias" class="inp" placeholder="Ej: juan.perez.arg" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Titular de la cuenta</div>
            <input id="cobro-titular" class="inp" placeholder="Puede no ser el mismo que el proveedor" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">CUIT / CUIL (opcional)</div>
            <input id="cobro-cuit" class="inp" inputmode="numeric" placeholder="20304050607">

            <div style="margin-top:14px;background:#F1F5FB;border-radius:10px;padding:11px 13px;font-size:12.5px;color:#5A6B85;line-height:1.5">
              Marcos también toma estos datos cuando el proveedor se los manda por WhatsApp. Si ya
              había otros cargados, ese cambio queda esperando su aprobación en vez de aplicarse solo.
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-datos-cobro')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarDatosCobro(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:#2E6FC0;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar</button>
          </div>
        </div>
      </div>`;

    const contenido = `
      <div style="animation:mFade .3s ease both;max-width:820px">
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px">Proveedores</h1>
        <p style="color:#64748B;font-size:15px;margin:0 0 20px">Tu lista de técnicos de confianza, <strong style="color:#334259">independiente de cada edificio</strong>: cargás a cada uno una sola vez acá y después lo asignás, con prioridad, a los edificios que quieras desde "Mi Edificio".</p>

        <div style="font-size:15px;font-weight:800;margin-bottom:12px">Mi lista (${maestros.length})</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:26px">${filas}</div>

        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:20px 22px">
          <div style="font-size:15px;font-weight:800;margin-bottom:14px">Agregar proveedor a mi lista</div>
          <div style="display:grid;grid-template-columns:150px 1fr;gap:12px;margin-bottom:14px">
            <div>${label('Rubro')}<select id="prov-rubro" class="inp" style="height:44px">${rubroOptions}</select></div>
            <div>${label('Nombre / empresa')}<input id="prov-nombre" class="inp" style="height:44px" placeholder="Ej: Gastón, Plomería del Oeste"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div>
              ${label('Teléfono')}
              <input id="prov-tel" class="inp" style="height:44px" placeholder="Ej: +54 9 11 2233 4455">
              <div style="font-size:11.5px;color:#64748B;margin-top:3px">⚠️ Incluir +54 para Argentina / Neuquén / interior</div>
            </div>
            <div>${label('Notas (opcional)')}<input id="prov-notas" class="inp" style="height:44px" placeholder="Ej: tiene llave del edificio"></div>
          </div>

          <!-- Datos de cobro en el alta: si ya los tenés a mano, se cargan de una. Al ser la
               primera carga no hay cambio que aprobar, se aplican directo. Después Marcos los
               toma solo si el proveedor se los manda, y ahí sí un cambio queda pendiente. -->
          <details style="margin-bottom:16px;border:1px solid #E7ECF3;border-radius:12px;background:#F8FAFD">
            <summary style="padding:12px 14px;cursor:pointer;font-size:13.5px;font-weight:700;color:#334259;list-style:none">
              🏦 Datos de cobro <span style="font-weight:500;color:#8595AD">— opcional, si ya los tenés</span>
            </summary>
            <div style="padding:0 14px 14px">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                <div>
                  ${label('CBU')}
                  <input id="prov-cbu" class="inp" style="height:44px" inputmode="numeric" placeholder="22 dígitos">
                  <div style="font-size:11.5px;color:#64748B;margin-top:3px">Se verifica antes de guardar.</div>
                </div>
                <div>${label('Alias')}<input id="prov-alias" class="inp" style="height:44px" placeholder="Ej: gaston.plomeria"></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div>
                  ${label('Titular de la cuenta')}
                  <input id="prov-titular" class="inp" style="height:44px" placeholder="Puede no ser el proveedor">
                </div>
                <div>${label('CUIT / CUIL')}<input id="prov-cuit" class="inp" style="height:44px" inputmode="numeric" placeholder="20304050607"></div>
              </div>
            </div>
          </details>

          <button onclick="agregarProveedor(this)" style="height:46px;padding:0 24px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-primary">+ Agregar a mi lista</button>
        </div>
      </div>
      ${modalEditarProveedorHtml}
      ${modalDatosCobroHtml}`;

    res.send(shell(req, d, 'proveedores', contenido));
  } catch (e) {
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * FACTURAS / FOTOS
 * =================================================================== */

/* ===================================================================
 * FACTURAS Y FOTOS — CONTRATO DE API REST Y VISTA HI-FI
 * =================================================================== */

const { pool: pgPool } = require('./db-pg');

async function queryPg(sql, params) {
  return await pgPool.query(sql, params);
}

async function obtenerEdificiosPermitidosUsuario(req) {
  if (esDueno(req)) {
    return { es_dueno: true, edificios: null };
  }
  const usuario = (req.session && (req.session.user || req.session.usuario)) || (enPreview(req) ? req.session.previewOwner : null);
  if (!usuario) {
    const sesEdificios = (req.session && req.session.edificios) ? (Array.isArray(req.session.edificios) ? req.session.edificios : String(req.session.edificios).split(',').map(s => s.trim())) : [];
    return { es_dueno: false, edificios: sesEdificios };
  }
  try {
    const clientRes = await queryPg('SELECT edificios FROM clientes WHERE lower(usuario) = lower($1)', [usuario]);
    let edificiosRaw = '';
    if (clientRes && clientRes.rows && clientRes.rows[0]) {
      edificiosRaw = clientRes.rows[0].edificios || '';
    } else if (req.session && req.session.edificios) {
      edificiosRaw = Array.isArray(req.session.edificios) ? req.session.edificios.join(',') : String(req.session.edificios);
    }
    const lista = String(edificiosRaw).split(',').map(s => s.trim()).filter(Boolean);
    return { es_dueno: false, edificios: lista };
  } catch (e) {
    const lista = (req.session && req.session.edificios) ? (Array.isArray(req.session.edificios) ? req.session.edificios : String(req.session.edificios).split(',').map(s => s.trim())) : [];
    return { es_dueno: false, edificios: lista };
  }
}

/**
 * Misma normalización que la función `marcos_norm` de PostgreSQL, para poder decidir del lado de
 * Node exactamente igual que decide la base.
 */
function normEdificio(txt) {
  return String(txt || '')
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => 'AEIOUUNaeiouun'['ÁÉÍÓÚÜÑáéíóúüñ'.indexOf(c)])
    .toLowerCase()
    .trim();
}

/**
 * Expande la lista de edificios de un cliente a TODAS las formas en que ese mismo edificio puede
 * estar escrito: su nombre, su dirección y sus alias, tal como los tiene cargados `edificios`.
 *
 * POR QUÉ EXISTE: el filtro de permisos comparaba el nombre exacto, y fallaba cuando la factura
 * decía "San Patricio 159" y la ficha del cliente decía "SAN PATRICIO". El parche a eso fue pasar
 * a una coincidencia parcial en las dos direcciones (`LIKE '%...%'`), y eso abre un agujero que en
 * este sistema no es aceptable: un cliente con "San Patricio" cargado pasaba a ver también las
 * facturas -- con importes -- de "San Patricio 270", que puede ser de OTRO administrador.
 *
 * La forma correcta de tolerar las variantes no es aflojar la comparación, sino saber de antemano
 * cuáles son las variantes legítimas de CADA edificio. Para eso están los alias. Así el filtro
 * vuelve a ser una igualdad exacta contra un conjunto conocido.
 *
 * Ante la duda se estrecha, nunca se ensancha: si un nombre del cliente podría corresponder a más
 * de un edificio, no se expande -- se deja tal cual y solo va a coincidir consigo mismo.
 */
async function expandirEdificiosPermitidos(lista) {
  const originales = (lista || []).map(s => String(s || '').trim()).filter(Boolean);
  if (originales.length === 0) return [];

  const formas = new Set(originales);

  let filas = [];
  try {
    const r = await queryPg('SELECT edificio, direccion, aliases FROM edificios');
    filas = (r && r.rows) || [];
  } catch (e) {
    // Sin la tabla de edificios no hay cómo expandir. Se devuelven los nombres tal cual: el
    // cliente verá de menos, nunca de más.
    console.error('No se pudieron expandir los edificios permitidos:', e.message);
    return Array.from(formas);
  }

  const formasDe = f => [
    f.edificio,
    f.direccion,
    ...String(f.aliases || '').split(',').map(a => a.trim())
  ].filter(Boolean);

  for (const nombre of originales) {
    const n = normEdificio(nombre);
    if (!n) continue;

    // Primero, coincidencia exacta contra el nombre, la dirección o algún alias.
    let candidatas = filas.filter(f => formasDe(f).some(v => normEdificio(v) === n));

    // Si no hubo exacta, se admite que el nombre del cliente sea una parte del edificio -- pero
    // solo si apunta a UN edificio. Si apunta a varios es ambiguo, y ampliar sería justamente
    // dejarle ver el de otro administrador.
    if (candidatas.length === 0) {
      candidatas = filas.filter(f => formasDe(f).some(v => {
        const vn = normEdificio(v);
        return vn && (vn.includes(n) || n.includes(vn));
      }));
      if (candidatas.length !== 1) {
        if (candidatas.length > 1) {
          console.warn(`[Permisos] "${nombre}" podría ser ${candidatas.length} edificios distintos. No se expande: se usa tal cual.`);
        }
        continue;
      }
    }

    for (const f of candidatas) {
      for (const v of formasDe(f)) formas.add(v);
    }
  }

  return Array.from(formas);
}

async function esEdificioPermitido(edificioFactura, scope) {
  if (!edificioFactura) return false;
  if (scope.es_dueno) return true;
  if (!scope.edificios || scope.edificios.length === 0) return false;
  const permitidos = await expandirEdificiosPermitidos(scope.edificios);
  const normFact = normEdificio(edificioFactura);
  return permitidos.some(p => normEdificio(p) === normFact);
}

async function resolverEdificioCanonico(edificioNombre) {
  if (!edificioNombre || edificioNombre.toLowerCase() === 'todos') return 'todos';
  const norm = edificioNombre.trim().toLowerCase();
  try {
    const res = await queryPg('SELECT edificio, aliases FROM edificios');
    if (res && res.rows) {
      for (const row of res.rows) {
        if (row.edificio && row.edificio.trim().toLowerCase() === norm) {
          return row.edificio;
        }
        if (row.aliases) {
          const aliases = String(row.aliases).split(',').map(a => a.trim().toLowerCase());
          if (aliases.includes(norm)) {
            return row.edificio;
          }
        }
      }
    }
  } catch(e){}
  return edificioNombre;
}

// ── GET /api/facturas ──
router.get('/api/facturas', async (req, res) => {
  try {
    const scope = await obtenerEdificiosPermitidosUsuario(req);
    const qEdificio = req.query.edificio || 'todos';

    let edificiosFiltro = null;
    if (!scope.es_dueno) {
      if (!scope.edificios || scope.edificios.length === 0) {
        return res.json({
          alcance: { edificios: [], es_dueno: false },
          totales: { total_facturas: 0, total_proveedor: 0, total_gasto_fijo: 0, monto_pendiente_total: "0.00", monto_pendiente_total_texto: "$0,00", sin_importe: 0 },
          grupos: []
        });
      }
      if (qEdificio !== 'todos') {
        const canon = await resolverEdificioCanonico(qEdificio);
        const normCanon = canon.toLowerCase();
        const estaPermitido = scope.edificios.some(e => e.toLowerCase() === normCanon);
        if (!estaPermitido) {
          console.warn(`[ACCESO DENEGADO] Usuario ${req.session.usuario} intentó acceder a edificio no permitido: ${qEdificio}`);
          return res.status(403).json({ error: 'acceso_denegado', mensaje: 'Edificio no permitido' });
        }
        edificiosFiltro = [canon];
      } else {
        edificiosFiltro = scope.edificios;
      }
    } else {
      if (qEdificio !== 'todos') {
        const canon = await resolverEdificioCanonico(qEdificio);
        edificiosFiltro = [canon];
      }
    }

    const { clase, origen, estado, categoria, proveedor, tipo, q, desde, hasta, orden = 'fecha_desc', page = 1, page_size = 25 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(10, parseInt(page_size, 10) || 25));

    let whereClauses = ["coalesce(f.eliminada, '') <> 'si'"];
    let params = [];
    let paramIdx = 1;

    if (edificiosFiltro && edificiosFiltro.length > 0) {
      // Igualdad exacta contra TODAS las formas conocidas de los edificios de este cliente (su
      // nombre, su dirección y sus alias). Ver `expandirEdificiosPermitidos`: la tolerancia a las
      // variantes viene de conocer los alias, no de aflojar la comparación -- con una comparación
      // parcial, un cliente podía ver las facturas de un edificio de otro administrador.
      const formasPermitidas = await expandirEdificiosPermitidos(edificiosFiltro);
      whereClauses.push(`marcos_norm(f.edificio) = ANY(SELECT marcos_norm(x) FROM unnest($${paramIdx}::text[]) AS x)`);
      params.push(formasPermitidas);
      paramIdx++;
    }

    if (clase) {
      whereClauses.push(`coalesce(f.clase, 'Proveedor') = $${paramIdx}`);
      params.push(clase);
      paramIdx++;
    }

    if (origen) {
      whereClauses.push(`coalesce(f.origen, 'Administrador') = $${paramIdx}`);
      params.push(origen);
      paramIdx++;
    }

    if (estado) {
      whereClauses.push(`f.estado = $${paramIdx}`);
      params.push(estado);
      paramIdx++;
    }

    if (categoria) {
      whereClauses.push(`f.categoria = $${paramIdx}`);
      params.push(categoria);
      paramIdx++;
    }

    if (proveedor) {
      whereClauses.push(`f.proveedor = $${paramIdx}`);
      params.push(proveedor);
      paramIdx++;
    }

    if (tipo) {
      whereClauses.push(`coalesce(f.tipo, 'Factura PDF') = $${paramIdx}`);
      params.push(tipo);
      paramIdx++;
    }

    if (q && q.trim()) {
      whereClauses.push(`marcos_norm(coalesce(f.concepto,'') || ' ' || coalesce(f.proveedor,'') || ' ' || coalesce(f.numero_factura,'') || ' ' || coalesce(f.edificio,'')) LIKE '%' || marcos_norm($${paramIdx}) || '%'`);
      params.push(q.trim());
      paramIdx++;
    }

    if (desde) {
      whereClauses.push(`f.fecha_iso >= $${paramIdx}::timestamptz`);
      params.push(desde);
      paramIdx++;
    }

    if (hasta) {
      whereClauses.push(`f.fecha_iso <= $${paramIdx}::timestamptz`);
      params.push(hasta);
      paramIdx++;
    }

    const whereSql = whereClauses.join(' AND ');

    let orderSql = 'f.fecha_iso DESC NULLS LAST';
    if (orden === 'fecha_asc') orderSql = 'f.fecha_iso ASC NULLS LAST';
    else if (orden === 'monto_desc') orderSql = 'f.monto_num DESC NULLS LAST';
    else if (orden === 'monto_asc') orderSql = 'f.monto_num ASC NULLS LAST';

    const queryTotales = `
      SELECT
        count(*)::int AS total_facturas,
        count(*) FILTER (WHERE coalesce(f.clase, 'Proveedor') = 'Proveedor')::int AS total_proveedor,
        count(*) FILTER (WHERE coalesce(f.clase, 'Proveedor') = 'Gasto fijo')::int AS total_gasto_fijo,
        count(*) FILTER (WHERE f.monto_num IS NULL)::int AS sin_importe,
        coalesce(sum(f.monto_num) FILTER (WHERE f.estado = 'Pendiente'), 0) AS monto_pendiente_total
      FROM facturas f
      WHERE ${whereSql}
    `;
    const resTotales = await queryPg(queryTotales, params);
    const totRow = (resTotales && resTotales.rows) ? resTotales.rows[0] : {};
    const montoPendTotalNum = parseFloat(totRow.monto_pendiente_total || 0);

    const clasesDef = [];
    if (!clase) {
      clasesDef.push({ clase: 'Proveedor', titulo: 'Proveedores' });
      clasesDef.push({ clase: 'Gasto fijo', titulo: 'Gastos fijos del edificio' });
    } else if (clase === 'Proveedor') {
      clasesDef.push({ clase: 'Proveedor', titulo: 'Proveedores' });
    } else if (clase === 'Gasto fijo') {
      clasesDef.push({ clase: 'Gasto fijo', titulo: 'Gastos fijos del edificio' });
    }

    const gruposRes = [];

    for (const cDef of clasesDef) {
      const groupWhereSql = `${whereSql} AND coalesce(f.clase, 'Proveedor') = '${cDef.clase}'`;
      const groupTotQuery = `
        SELECT
          count(*)::int AS conteo,
          count(*) FILTER (WHERE f.estado = 'Pendiente')::int AS pendientes,
          coalesce(sum(f.monto_num) FILTER (WHERE f.estado = 'Pendiente'), 0) AS monto_pendiente
        FROM facturas f
        WHERE ${groupWhereSql}
      `;
      const gTot = (await queryPg(groupTotQuery, params)).rows[0] || {};
      const conteo = gTot.conteo || 0;

      if (conteo === 0) continue;

      const totalPaginas = Math.ceil(conteo / pageSizeNum);
      const offset = (pageNum - 1) * pageSizeNum;

      const itemsQuery = `
        SELECT f.*,
               cg.icono AS categoria_icono,
               coalesce(ed.direccion, '') AS edificio_direccion,
               coalesce(pa.telefono, prov.telefono, '') AS proveedor_telefono
        FROM facturas f
        LEFT JOIN categorias_gasto cg ON cg.categoria = f.categoria AND cg.clase = f.clase
        LEFT JOIN edificios ed ON marcos_norm(ed.edificio) = marcos_norm(f.edificio)
        LEFT JOIN proveedores prov ON marcos_norm(prov.nombre) = marcos_norm(f.proveedor)
        LEFT JOIN proveedor_asignaciones pa ON marcos_norm(pa.edificio) = marcos_norm(f.edificio)
                                           AND marcos_norm(pa.proveedor) = marcos_norm(f.proveedor)
                                           AND pa.prioridad = 'primera'
        WHERE ${groupWhereSql}
        ORDER BY ${orderSql}
        LIMIT ${pageSizeNum} OFFSET ${offset}
      `;
      const itemsRows = (await queryPg(itemsQuery, params)).rows || [];

      const itemsFormatted = itemsRows.map(f => {
        let fechaTexto = f.fecha;
        if (f.fecha_iso) {
          const d = new Date(f.fecha_iso);
          if (!isNaN(d.getTime())) {
            const dia = d.getDate();
            const mes = d.getMonth() + 1;
            const horaStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true });
            fechaTexto = `${dia}/${mes} · ${horaStr.toLowerCase()}`;
          }
        }
        return {
          factura_key: f.factura_key || `${f.edificio}|${f.numero_factura}|${f.fecha}`,
          clase: f.clase || 'Proveedor',
          tipo: f.tipo || 'Factura PDF',
          categoria: f.categoria,
          categoria_icono: f.categoria_icono || (f.clase === 'Gasto fijo' ? 'ph-lightning' : 'ph-wrench'),
          concepto: f.concepto,
          numero_factura: f.numero_factura || 'Sin comprobante',
          edificio: f.edificio,
          edificio_direccion: f.edificio_direccion || '',
          direccion_factura: f.direccion_factura || '',
          proveedor: f.proveedor || '—',
          proveedor_telefono: f.proveedor_telefono || '',
          fecha: f.fecha,
          fecha_texto: fechaTexto,
          monto: f.monto || 'Según comprobante',
          monto_num: f.monto_num != null ? String(f.monto_num) : null,
          estado: f.estado || 'Pendiente',
          fecha_pago: f.fecha_pago || '',
          origen: f.origen || 'Administrador',
          origen_nombre: f.origen_nombre || '',
          url_archivo: f.url_archivo || '',
          codigo_caso: f.codigo_caso || '',
          requiere_revision: f.requiere_revision || 'no'
        };
      });

      const montoPendGroupNum = parseFloat(gTot.monto_pendiente || 0);

      gruposRes.push({
        clase: cDef.clase,
        titulo: cDef.titulo,
        conteo: conteo,
        pendientes: gTot.pendientes || 0,
        monto_pendiente: montoPendGroupNum.toFixed(2),
        monto_pendiente_texto: '$' + montoPendGroupNum.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        page: pageNum,
        page_size: pageSizeNum,
        total_paginas: totalPaginas,
        items: itemsFormatted
      });
    }

    res.json({
      alcance: { edificios: scope.edificios, es_dueno: scope.es_dueno },
      totales: {
        total_facturas: totRow.total_facturas || 0,
        total_proveedor: totRow.total_proveedor || 0,
        total_gasto_fijo: totRow.total_gasto_fijo || 0,
        monto_pendiente_total: montoPendTotalNum.toFixed(2),
        monto_pendiente_total_texto: '$' + montoPendTotalNum.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        sin_importe: totRow.sin_importe || 0
      },
      grupos: gruposRes
    });
  } catch (err) {
    console.error('Error en GET /api/facturas:', err);
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al consultar facturas' });
  }
});

// ── GET /api/categorias-gasto ──
router.get('/api/categorias-gasto', async (req, res) => {
  try {
    const { clase } = req.query;
    let sql = 'SELECT * FROM categorias_gasto WHERE activo = \'si\'';
    const params = [];
    if (clase) {
      sql += ' AND clase = $1';
      params.push(clase);
    }
    sql += ' ORDER BY orden ASC';
    const r = await queryPg(sql, params);
    res.json(r.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al consultar categorías' });
  }
});

// ── GET /api/proveedores ──
router.get('/api/proveedores', async (req, res) => {
  try {
    const { edificio } = req.query;
    if (edificio && edificio !== 'todos') {
      const sql = `
        SELECT p.nombre, p.rubro, coalesce(pa.telefono, p.telefono, '') as telefono, pa.prioridad
        FROM proveedores p
        LEFT JOIN proveedor_asignaciones pa ON marcos_norm(pa.proveedor) = marcos_norm(p.nombre) AND marcos_norm(pa.edificio) = marcos_norm($1)
        ORDER BY CASE WHEN pa.prioridad = 'primera' THEN 1 WHEN pa.prioridad = 'segunda' THEN 2 WHEN pa.prioridad = 'urgencias' THEN 3 ELSE 4 END, p.nombre ASC
      `;
      const r = await queryPg(sql, [edificio]);
      return res.json(r.rows || []);
    }
    const r = await queryPg('SELECT nombre, rubro, telefono FROM proveedores ORDER BY nombre ASC');
    res.json(r.rows || []);
  } catch (err) {
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al consultar proveedores' });
  }
});

// ── PATCH /api/facturas/:factura_key ──
router.patch('/api/facturas/:factura_key', async (req, res) => {
  try {
    const { factura_key } = req.params;
    const body = req.body || {};

    const camposPermitidos = ['clase', 'categoria', 'proveedor', 'origen', 'origen_nombre', 'estado', 'monto', 'concepto', 'numero_factura', 'fecha', 'codigo_caso'];
    for (const key of Object.keys(body)) {
      if (!camposPermitidos.includes(key)) {
        return res.status(400).json({ error: 'campo_no_editable', campo: key, mensaje: `El campo ${key} no es editable` });
      }
    }

    const sel = await queryPg('SELECT * FROM facturas WHERE factura_key = $1 AND coalesce(eliminada, \'\') <> \'si\'', [factura_key]);
    if (!sel.rows || sel.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', mensaje: 'Factura no encontrada' });
    }
    const existente = sel.rows[0];

    const scope = await obtenerEdificiosPermitidosUsuario(req);
    const okPermiso = await esEdificioPermitido(existente.edificio, scope);
    if (!okPermiso) {
      return res.status(403).json({ error: 'acceso_denegado', mensaje: 'Sin permiso para editar esta factura' });
    }

    const updates = [];
    const updateParams = [];
    let pIdx = 1;
    const auditoriaRows = [];
    const usuarioLog = (req.session && (req.session.user || req.session.usuario)) || 'admin';

    for (const field of camposPermitidos) {
      if (body[field] !== undefined && body[field] !== existente[field]) {
        let valNuevo = body[field];
        if (field === 'estado') {
          if (valNuevo !== 'Pendiente' && valNuevo !== 'Pagada') {
            return res.status(400).json({ error: 'estado_invalido', mensaje: 'Estado debe ser Pendiente o Pagada' });
          }
          if (valNuevo === 'Pagada') {
            const hoyStr = new Date().toLocaleDateString('es-AR');
            updates.push(`fecha_pago = $${pIdx}`);
            updateParams.push(hoyStr);
            pIdx++;
          } else {
            updates.push(`fecha_pago = $${pIdx}`);
            updateParams.push('');
            pIdx++;
          }
        }
        updates.push(`${field} = $${pIdx}`);
        updateParams.push(valNuevo);
        pIdx++;

        auditoriaRows.push({
          factura_key,
          usuario: usuarioLog,
          accion: field === 'clase' ? 'reclasificar' : (field === 'estado' ? 'estado' : 'editar'),
          campo: field,
          valor_anterior: String(existente[field] || ''),
          valor_nuevo: String(valNuevo || '')
        });
      }
    }

    if (updates.length === 0) {
      return res.json(existente);
    }

    updates.push(`requiere_revision = 'no'`);

    updateParams.push(factura_key);
    const updateSql = `UPDATE facturas SET ${updates.join(', ')} WHERE factura_key = $${pIdx} RETURNING *`;
    const updatedRes = await queryPg(updateSql, updateParams);
    const facturaActualizada = updatedRes.rows[0];

    for (const aud of auditoriaRows) {
      await queryPg(
        'INSERT INTO facturas_auditoria (factura_key, usuario, accion, campo, valor_anterior, valor_nuevo) VALUES ($1, $2, $3, $4, $5, $6)',
        [aud.factura_key, aud.usuario, aud.accion, aud.campo, aud.valor_anterior, aud.valor_nuevo]
      );
    }

    await queryPg(
      'INSERT INTO sheets_sync_cola (factura_key, operacion) VALUES ($1, \'update\')',
      [facturaActualizada.factura_key]
    );

    res.json(facturaActualizada);
  } catch (err) {
    console.error('Error en PATCH /api/facturas/:factura_key:', err);
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al actualizar factura' });
  }
});

// ── DELETE /api/facturas/:factura_key ──
router.delete('/api/facturas/:factura_key', async (req, res) => {
  try {
    const { factura_key } = req.params;
    const sel = await queryPg('SELECT * FROM facturas WHERE factura_key = $1 AND coalesce(eliminada, \'\') <> \'si\'', [factura_key]);
    if (!sel.rows || sel.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', mensaje: 'Factura no encontrada' });
    }
    const existente = sel.rows[0];

    const scope = await obtenerEdificiosPermitidosUsuario(req);
    const okPermiso = await esEdificioPermitido(existente.edificio, scope);
    if (!okPermiso) {
      return res.status(403).json({ error: 'acceso_denegado', mensaje: 'Sin permiso para eliminar esta factura' });
    }

    await queryPg('UPDATE facturas SET eliminada = \'si\' WHERE factura_key = $1', [factura_key]);

    const usuarioLog = (req.session && (req.session.user || req.session.usuario)) || 'admin';
    await queryPg(
      'INSERT INTO facturas_auditoria (factura_key, usuario, accion, campo, valor_anterior, valor_nuevo) VALUES ($1, $2, \'eliminar\', \'eliminada\', \'\', \'si\')',
      [factura_key, usuarioLog]
    );

    await queryPg('INSERT INTO sheets_sync_cola (factura_key, operacion) VALUES ($1, \'delete\')', [factura_key]);

    res.status(204).send();
  } catch (err) {
    console.error('Error en DELETE /api/facturas/:factura_key:', err);
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al eliminar factura' });
  }
});

// ── GET /api/facturas/:factura_key/archivo ──
router.get('/api/facturas/:factura_key/archivo', async (req, res) => {
  try {
    const { factura_key } = req.params;
    const sel = await queryPg('SELECT * FROM facturas WHERE factura_key = $1 AND coalesce(eliminada, \'\') <> \'si\'', [factura_key]);
    if (!sel.rows || sel.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', mensaje: 'Archivo no encontrado' });
    }
    const f = sel.rows[0];
    if (!f.url_archivo) {
      return res.status(404).json({ error: 'no_encontrado', mensaje: 'Sin URL de archivo' });
    }
    const descargar = req.query.descargar === '1';
    if (descargar) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(f.url_archivo)}"`);
    }
    res.redirect(f.url_archivo);
  } catch (err) {
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al servir archivo' });
  }
});

// ── POST /api/facturas/:factura_key/enviar-consejo ──
router.post('/api/facturas/:factura_key/enviar-consejo', async (req, res) => {
  try {
    const { factura_key } = req.params;
    const sel = await queryPg('SELECT * FROM facturas WHERE factura_key = $1 AND coalesce(eliminada, \'\') <> \'si\'', [factura_key]);
    if (!sel.rows || sel.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', mensaje: 'Factura no encontrada' });
    }
    const usuarioLog = (req.session && (req.session.user || req.session.usuario)) || 'admin';
    await queryPg(
      'INSERT INTO facturas_auditoria (factura_key, usuario, accion, campo, valor_anterior, valor_nuevo) VALUES ($1, $2, \'enviar_consejo\', \'envio\', \'\', \'enviado\')',
      [factura_key, usuarioLog]
    );
    res.status(202).json({ ok: true, mensaje: 'Enviado al consejo' });
  } catch (err) {
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al enviar comprobante' });
  }
});

// ── POST /api/facturas ──
router.post('/api/facturas', uploadMulter.single('archivo'), async (req, res) => {
  try {
    const { edificio, clase, concepto, fecha, origen, proveedor, categoria, numero_factura, monto, origen_nombre, codigo_caso } = req.body || {};

    if (!edificio || !clase || !concepto || !origen || !req.file) {
      return res.status(400).json({ error: 'param_invalido', mensaje: 'Faltan campos requeridos (edificio, clase, concepto, origen, archivo)' });
    }

    const scope = await obtenerEdificiosPermitidosUsuario(req);
    if (!scope.es_dueno && scope.edificios) {
      const normEd = edificio.toLowerCase();
      const permitido = scope.edificios.some(e => e.toLowerCase() === normEd);
      if (!permitido) {
        return res.status(403).json({ error: 'acceso_denegado', mensaje: 'Edificio no permitido' });
      }
    }

    if (clase === 'Gasto fijo' && !categoria && !proveedor) {
      return res.status(422).json({ error: 'validacion', mensaje: 'Indicá el servicio o la categoría' });
    }

    const mime = req.file.mimetype;
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'];
    if (!allowedMimes.includes(mime)) {
      return res.status(415).json({ error: 'formato_invalido', mensaje: 'Formato de archivo no permitido' });
    }

    let tipo = req.body.tipo;
    if (!tipo) {
      if (mime === 'application/pdf') tipo = 'Factura PDF';
      else if (mime.startsWith('image/')) tipo = 'Foto';
      else tipo = 'Otro';
    }

    const webPath = `/archivos/facturas/${req.file.filename}`;
    const fechaUsar = fecha || new Date().toLocaleString('es-AR');
    const montoUsar = (monto && monto.trim()) ? monto.trim() : 'Según comprobante';

    const insQuery = `
      INSERT INTO facturas (edificio, clase, concepto, fecha, origen, proveedor, categoria, numero_factura, monto, origen_nombre, codigo_caso, tipo, url_archivo, estado, requiere_revision)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Pendiente', 'no')
      RETURNING *
    `;
    const insRes = await queryPg(insQuery, [
      edificio, clase, concepto, fechaUsar, origen, proveedor || '', categoria || '', numero_factura || 'Sin comprobante', montoUsar, origen_nombre || '', codigo_caso || '', tipo, webPath
    ]);
    const nuevaFactura = insRes.rows[0];

    const usuarioLog = (req.session && (req.session.user || req.session.usuario)) || 'admin';
    await queryPg(
      'INSERT INTO facturas_auditoria (factura_key, usuario, accion, campo, valor_anterior, valor_nuevo) VALUES ($1, $2, \'crear\', \'todas\', \'\', \'creado\')',
      [nuevaFactura.factura_key, usuarioLog]
    );

    await queryPg('INSERT INTO sheets_sync_cola (factura_key, operacion) VALUES ($1, \'insert\')', [nuevaFactura.factura_key]);

    res.status(201).json(nuevaFactura);
  } catch (err) {
    console.error('Error en POST /api/facturas:', err);
    res.status(500).json({ error: 'error_interno', mensaje: 'Error al crear factura' });
  }
});


// ── VISTA PRINCIPAL HI-FI: GET /admin/archivos ──
router.get('/archivos', async (req, res) => {
  try {
    const d = await cargarDatos(req);
    const dueno = esDueno(req);
    const scope = await obtenerEdificiosPermitidosUsuario(req);

    const contenido = `
      <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
      <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css">
      <style>
        .facturas-page-container {
          padding: 24px 28px 48px;
          font-family: inherit;
          color: #0F172A;
          font-size: 14.5px;
          animation: mFade .3s ease both;
        }
        .btn-factura-sec {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          padding: 8px 16px; border-radius: 10px; border: 1px solid #CBD5E1;
          background: #FFFFFF; color: #334155; font-weight: 600; font-size: 13px; cursor: pointer;
          transition: all .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .btn-factura-sec:hover { background: #F8FAFC; border-color: #94A3B8; color: #0F172A; }
        .btn-factura-pri {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          padding: 8px 16px; border-radius: 10px; border: none;
          background: linear-gradient(180deg, #2E6FC0, #1E5FB4); color: #FFFFFF; font-weight: 700; font-size: 13px; cursor: pointer;
          transition: all .15s ease; box-shadow: 0 2px 4px rgba(30,95,180,0.25);
        }
        .btn-factura-pri:hover { background: linear-gradient(180deg, #1E5FB4, #17408B); }
        .input-factura-search {
          width: 100%; box-sizing: border-box; background: #FFFFFF;
          border: 1px solid #CBD5E1; border-radius: 10px;
          color: #0F172A; font-size: 13.5px; padding: 9px 12px 9px 34px; outline: none; transition: border-color .15s ease;
        }
        .input-factura-search:focus-visible { border-color: #2E6FC0; box-shadow: 0 0 0 3px rgba(46,111,192,0.15); }
        .row-item-hover { background: #FFFFFF; border: 1px solid #E2E8F0; transition: all .15s ease; }
        .row-item-hover:hover { background: #F8FAFC !important; border-color: #CBD5E1 !important; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
        .popover-facturas-menu {
          position: absolute; right: 0; top: calc(100% + 6px); z-index: 9999; width: 232px;
          padding: 6px; background: #FFFFFF; border: 1px solid #E2E8F0;
          border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 1px; text-align: left;
        }
        .popover-item-btn {
          appearance: none; background: transparent; border: 0; cursor: pointer; display: flex;
          align-items: center; gap: 9px; padding: 8px 10px; border-radius: 6px;
          font-size: 13px; color: #334155; font-family: inherit; font-weight: 500; text-align: left; width: 100%; box-sizing: border-box; transition: background .12s ease;
        }
        .popover-item-btn:hover { background: #F1F5F9; color: #0F172A; }
        .popover-item-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      </style>

      <div class="facturas-page-container">
        <!-- Header -->
        <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 20px;">
          <div>
            <div style="font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 800; color: #2E6FC0; margin-bottom: 6px;">Archivo de comprobantes</div>
            <h2 id="facturas-titulo-edificio" style="font-size: 26px; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; margin: 0 0 6px;">Facturas y Fotos · Cargando...</h2>
            <div style="font-size: 14px; color: #64748B; max-width: 640px;">
              Comprobantes de proveedores y de gastos fijos de todos los consorcios. Separá por tipo de gasto y por quién lo cargó para encontrarlos más rápido.
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn-factura-sec" onclick="abrirModalFiltrosAvanzados()"><i class="ph ph-funnel" style="font-size: 16px; color: #475569;"></i>Filtros avanzados</button>
            <button type="button" class="btn-factura-pri" onclick="abrirModalSubirDocumento()"><i class="ph ph-upload-simple" style="font-size: 16px;"></i>Subir documento</button>
          </div>
        </div>

        <!-- Totales Bar -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 24px;">
          <div class="factura-card-metric" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div class="metric-title" style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: #64748B;">Comprobantes archivados</div>
            <div id="tot-archivados" class="metric-value" style="font-size: 24px; font-weight: 800; color: #0F172A; margin-top: 4px;">—</div>
          </div>
          <div class="factura-card-metric" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div class="metric-title" style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: #64748B;">Proveedores</div>
            <div id="tot-proveedores" class="metric-value" style="font-size: 24px; font-weight: 800; color: #0F172A; margin-top: 4px;">—</div>
          </div>
          <div class="factura-card-metric" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div class="metric-title" style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: #64748B;">Gastos fijos</div>
            <div id="tot-fijos" class="metric-value" style="font-size: 24px; font-weight: 800; color: #0F172A; margin-top: 4px;">—</div>
          </div>
          <div class="factura-card-metric" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div class="metric-title" style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: #64748B;">Pendiente de pago</div>
            <div id="tot-pendiente" class="metric-value" style="font-size: 24px; font-weight: 800; color: #D97706; margin-top: 4px;">—</div>
          </div>
        </div>

        <!-- Filter Controls -->
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
          <div style="display: inline-flex; border: 1px solid #E2E8F0; border-radius: 10px; background: #FFFFFF; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
            <button id="tab-clase-todos" type="button" onclick="cambiarTabClase('')" style="appearance: none; background: #2E6FC0; border: 0; cursor: pointer; padding: 9px 16px; font-weight: 700; font-size: 13px; color: #FFFFFF; display: inline-flex; align-items: center; gap: 7px; transition: all .15s ease;">
              <i class="ph ph-squares-four" style="font-size: 15px;"></i><span>Todos</span>
            </button>
            <button id="tab-clase-proveedor" type="button" onclick="cambiarTabClase('Proveedor')" style="appearance: none; background: #FFFFFF; border: 0; border-left: 1px solid #E2E8F0; cursor: pointer; padding: 9px 16px; font-weight: 600; font-size: 13px; color: #475569; display: inline-flex; align-items: center; gap: 7px; transition: all .15s ease;">
              <i class="ph ph-wrench" style="font-size: 15px;"></i><span>Proveedores</span>
            </button>
            <button id="tab-clase-fijo" type="button" onclick="cambiarTabClase('Gasto fijo')" style="appearance: none; background: #FFFFFF; border: 0; border-left: 1px solid #E2E8F0; cursor: pointer; padding: 9px 16px; font-weight: 600; font-size: 13px; color: #475569; display: inline-flex; align-items: center; gap: 7px; transition: all .15s ease;">
              <i class="ph ph-lightning" style="font-size: 15px;"></i><span>Gastos fijos</span>
            </button>
          </div>

          <div style="position: relative; flex: 1 1 240px; max-width: 360px;">
            <i class="ph ph-magnifying-glass" style="position: absolute; left: 11px; top: 50%; transform: translateY(-50%); font-size: 16px; color: #94A3B8;"></i>
            <input id="input-busqueda-q" class="input-factura-search" type="text" placeholder="Buscar por concepto, proveedor o N° de factura" oninput="onBuscadorInput(this.value)">
          </div>
        </div>

        <!-- Chips "Cargado por" -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 20px;">
          <span style="font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: #64748B; margin-right: 2px;">Cargado por</span>
          <button id="chip-origen-todos" type="button" onclick="cambiarChipOrigen('')" style="appearance: none; cursor: pointer; background: #1E408B; border: 1px solid #1E408B; border-radius: 999px; padding: 5px 14px; font-size: 12.5px; font-weight: 700; color: #FFFFFF; display: inline-flex; align-items: center; gap: 6px; transition: all .15s ease;">
            <span>Todos</span>
          </button>
          <button id="chip-origen-encargado" type="button" onclick="cambiarChipOrigen('Encargado')" style="appearance: none; cursor: pointer; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 999px; padding: 5px 14px; font-size: 12.5px; font-weight: 600; color: #475569; display: inline-flex; align-items: center; gap: 6px; transition: all .15s ease;">
            <i class="ph ph-user-gear" style="font-size: 14px;"></i><span>Encargado</span>
          </button>
          <button id="chip-origen-consejo" type="button" onclick="cambiarChipOrigen('Consejo')" style="appearance: none; cursor: pointer; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 999px; padding: 5px 14px; font-size: 12.5px; font-weight: 600; color: #475569; display: inline-flex; align-items: center; gap: 6px; transition: all .15s ease;">
            <i class="ph ph-users-three" style="font-size: 14px;"></i><span>Consejo de consorcio</span>
          </button>
          <button id="chip-origen-admin" type="button" onclick="cambiarChipOrigen('Administrador')" style="appearance: none; cursor: pointer; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 999px; padding: 5px 14px; font-size: 12.5px; font-weight: 600; color: #475569; display: inline-flex; align-items: center; gap: 6px; transition: all .15s ease;">
            <i class="ph ph-briefcase" style="font-size: 14px;"></i><span>Administrador</span>
          </button>
        </div>

        <!-- Content Container -->
        <div id="facturas-grupos-container">
          <!-- Renderizado dinámico desde API -->
        </div>
      </div>
    `;

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
      .filter((x) => cur && compararEdificios(x.edificio, cur.nombre) && x.estado !== 'eliminada')
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
      const ev = d.eventos.filter((x) => compararEdificios(x.edificio, e.nombre)).length;
      const cliente = (clienteDelEdificio(d.clientes, e.nombre) || {}).nombre || 'Sin asignar';
      const plan = PLAN_STYLE(e.plan);
      return `
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:16px;padding:18px 20px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            <div>
              <div style="font-size:16px;font-weight:800;letter-spacing:-.01em">${esc(e.nombre)}</div>
              <div style="font-size:12.5px;color:#8595AD">${esc(cliente)} · ${esc(e.tipo || 'Edificio')}${e.unidades ? ' · ' + esc(e.unidades) + ' un.' : ''} · Plan ${esc(e.plan)}</div>
            </div>
            <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:#E7F4EC;color:#1B7A43">Dentro del plan</span>
          </div>
          ${dibujarConsumoHtml(e.nombre, e.plan, ev)}
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
    const [d, planesList] = await Promise.all([
      cargarDatos(req),
      obtenerPlanesSuscripcion()
    ]);
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
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <a href="/admin/clientes" style="display:inline-flex;align-items:center;height:38px;padding:0 15px;${tabBtn(vista === 'cliente')};border-radius:10px;font-weight:700;font-size:13.5px">Por cliente</a>
          <a href="/admin/clientes?vista=todos" style="display:inline-flex;align-items:center;height:38px;padding:0 15px;${tabBtn(vista === 'todos')};border-radius:10px;font-weight:700;font-size:13.5px">Todos los edificios</a>
          ${esDueno(req) ? `
          <button onclick="abrirModalColaboradores()" style="display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#17408B;font-weight:700;font-size:13.5px;cursor:pointer" class="hv-soft">👥 Colaboradores</button>
          ` : ''}
        </div>
      </div>`;

    const filaEdificioHtml = (e, mostrarCliente) => {
      const plan = PLAN_STYLE(e.plan);
      const cliente = (clienteDelEdificio(d.clientes, e.nombre) || {}).nombre || 'Sin asignar';
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
          <button onclick="abrirEditar(${e._row},'${escJs(e.nombre)}','${escJs(e.encargado)}','${escJs(e.plan)}','${escJs(e.direccion || '')}','${escJs(e.cuit || '')}','${escJs(e.unidades || '')}','${escJs(e.zona || '')}','${escJs(e.aliases || '')}')" style="height:38px;padding:0 16px;border:1px solid #DCE4F0;border-radius:9px;background:#fff;color:#2E6FC0;font-weight:700;font-size:13px;cursor:pointer" class="hv-soft">Editar</button>
          <button onclick="abrirModalAsignarAdmin('${escJs(e.nombre)}','${escJs(cliente)}','${escJs((clienteDelEdificio(d.clientes, e.nombre) || {}).usuario || '')}')" style="height:38px;padding:0 14px;border:1px solid #DCE4F0;border-radius:9px;background:#F8FAFD;color:#17408B;font-weight:700;font-size:13px;cursor:pointer" class="hv-soft">👤 Asignar</button>
        </div>`;
    };

    let cuerpo = '';
    if (vista === 'todos') {
      cuerpo = `<div style="display:flex;flex-direction:column;gap:12px">${d.edificios.map((e) => filaEdificioHtml(e, true)).join('')}</div>`;
    } else if (clienteSel) {
      const mis = edificiosDeCliente(d.edificios, clienteSel);
      const unidades = mis.reduce((a, e) => a + (Number(e.unidades) || 0), 0);
      cuerpo = `
        <a href="/admin/clientes" style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid #E1E7F1;border-radius:9px;background:#fff;color:#5A6B85;font-weight:700;font-size:13px;margin-bottom:16px" class="hv-soft">← Clientes</a>
        <div style="display:flex;align-items:center;gap:14px;background:linear-gradient(120deg,#0F326A,#2E6FC0);border-radius:16px;padding:18px 22px;color:#fff;margin-bottom:18px;flex-wrap:wrap">
          <span style="width:52px;height:52px;border-radius:13px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;flex-shrink:0">${esc(clienteSel.nombre.charAt(0).toUpperCase())}</span>
          <div style="flex:1;min-width:180px">
            <div style="font-size:20px;font-weight:800;letter-spacing:-.01em">${esc(clienteSel.nombre)}</div>
            <div style="font-size:13.5px;color:rgba(255,255,255,.82)">${mis.length} edificio${mis.length === 1 ? '' : 's'}${unidades ? ' · ' + unidades + ' unidades' : ''}</div>
          </div>
          <div style="display:flex;gap:9px">
            <button onclick="abrirEditarCliente(${clienteSel._row}, '${escJs(clienteSel.nombre)}', '${escJs(clienteSel.usuario)}', '${escJs(clienteSel.pass)}', '${escJs(clienteSel.email || '')}', '${escJs(clienteSel.wsp || '')}', ${clienteSel.notif_email !== false}, ${clienteSel.notif_wsp === true})" style="height:40px;padding:0 18px;border:1px solid rgba(255,255,255,.32);border-radius:11px;background:rgba(255,255,255,.12);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-trans">✏️ Editar administrador</button>
            <button onclick="abrirModal('modal-edificio')" style="height:40px;padding:0 18px;border:none;border-radius:11px;background:#fff;color:#17408B;font-weight:700;font-size:14px;cursor:pointer">+ Agregar edificio</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${mis.length ? mis.map((e) => filaEdificioHtml(e, false)).join('') : '<div style="text-align:center;padding:30px;background:#fff;border:1px dashed #DDE3EE;border-radius:14px;color:#8595AD;font-size:14px">Este cliente todavía no tiene edificios asignados.</div>'}
        </div>`;
    } else {
      const cards = d.clientes.map((c) => {
        const mis = edificiosDeCliente(d.edificios, c);
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
        <div class="modal-box" style="max-height:85vh;overflow-y:auto" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Nuevo cliente</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Alta de administrador</div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre del administrador</div>
            <input id="cli-nombre" placeholder="Ej: González Administraciones" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Usuario de acceso</div>
            <input id="cli-usuario" placeholder="gonzalez_admin" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Contraseña temporal</div>
            <input id="cli-pass" placeholder="clave temporal" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email</div>
            <input id="cli-email" placeholder="contacto@administrador.com" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">WhatsApp de Notificación</div>
            <input id="cli-wsp" placeholder="Ej: 1122334455" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:8px">Alertas activas</div>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#334259;cursor:pointer;background:#F8FAFD;padding:10px 12px;border-radius:10px;border:1px solid #E4E9F1;margin-bottom:8px">
              <input id="cli-notif-email" type="checkbox" checked style="width:17px;height:17px;accent-color:#2E6FC0">
              <span>✉️ Notificar urgencias por <strong>Email</strong> <span style="font-size:11px;color:#1B7A43;font-weight:700">(Gratis)</span></span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#334259;cursor:pointer;background:#F8FAFD;padding:10px 12px;border-radius:10px;border:1px solid #E4E9F1">
              <input id="cli-notif-wsp" type="checkbox" style="width:17px;height:17px;accent-color:#2E6FC0">
              <span>💬 Notificar urgencias por <strong>WhatsApp</strong> <span style="font-size:11px;color:#8A6410;font-weight:700">(API Mensajería)</span></span>
            </label>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-cliente')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="crearCliente(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Crear cliente</button>
          </div>
        </div>
      </div>`;

    const modalClienteEditar = `
      <div id="modal-cliente-editar" class="modal-overlay" onclick="cerrarModal('modal-cliente-editar')">
        <div class="modal-box" style="max-height:85vh;overflow-y:auto" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Editar Administrador</div>
            <div id="edit-cli-title" style="font-size:19px;font-weight:800;letter-spacing:-.01em"></div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre del administrador</div>
            <input id="edit-cli-nombre" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Usuario de acceso</div>
            <input id="edit-cli-usuario" class="inp" readonly style="margin-bottom:14px;background:#F1F4F9;cursor:not-allowed">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email</div>
            <input id="edit-cli-email" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">WhatsApp de Notificación</div>
            <input id="edit-cli-wsp" class="inp" style="margin-bottom:14px">

            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:8px">Alertas activas</div>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#334259;cursor:pointer;background:#F8FAFD;padding:10px 12px;border-radius:10px;border:1px solid #E4E9F1;margin-bottom:8px">
              <input id="edit-cli-notif-email" type="checkbox" style="width:17px;height:17px;accent-color:#2E6FC0">
              <span>✉️ Notificar urgencias por <strong>Email</strong> <span style="font-size:11px;color:#1B7A43;font-weight:700">(Gratis)</span></span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#334259;cursor:pointer;background:#F8FAFD;padding:10px 12px;border-radius:10px;border:1px solid #E4E9F1">
              <input id="edit-cli-notif-wsp" type="checkbox" style="width:17px;height:17px;accent-color:#2E6FC0">
              <span>💬 Notificar urgencias por <strong>WhatsApp</strong> <span style="font-size:11px;color:#8A6410;font-weight:700">(API Mensajería)</span></span>
            </label>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-cliente-editar')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarEditarCliente(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Guardar cambios</button>
          </div>
        </div>
      </div>`;

    const modalEdificio = clienteSel ? modalAltaEdificioHtml(`Nuevo edificio · ${clienteSel.nombre}`, clienteSel.usuario, planesList) : '';

    const editPlanOptions = planesList.map((p) => `<option value="${esc(p.nombre)}">${esc(p.nombre)}${Number(p.precio) > 0 ? ' ($' + Number(p.precio).toLocaleString('es-AR') + '/mes)' : ' (Gratis)'}</option>`).join('');

    const modalEditar = `
      <div id="modal-editar" class="modal-overlay" onclick="cerrarModal('modal-editar')">
        <div class="modal-box" style="max-height:85vh;overflow-y:auto" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Editar ficha</div>
            <div id="edit-bname" style="font-size:19px;font-weight:800;letter-spacing:-.01em"></div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre del consorcio</div>
            <input id="edit-nombre" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Dirección</div>
            <input id="edit-direccion" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Encargado principal</div>
            <input id="edit-encargado" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">CUIT del edificio</div>
            <input id="edit-cuit" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Cantidad de unidades</div>
            <input id="edit-unidades" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Zona / Barrio</div>
            <input id="edit-zona" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Alias / doble dirección</div>
            <input id="edit-aliases" class="inp" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Plan contratado</div>
            <select id="edit-plan" class="inp" style="margin-bottom:14px">
              ${editPlanOptions}
            </select>
            <div style="display:flex;align-items:flex-start;gap:9px;background:#EAF1FB;border-radius:10px;padding:10px 13px;margin-top:16px;font-size:12.5px;color:#2C55A8;line-height:1.4">
              <span style="font-size:15px">⚡</span>
              <span>Como dueño, estos cambios se escriben <strong>directo</strong> en la planilla, sin pasar por aprobación.</span>
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-editar')" style="flex:1;height:46px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarEditar(this)" style="flex:1.4;height:46px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer" class="hv-op">Guardar cambios</button>
          </div>
        </div>
      </div>`;

    const modalColaboradoresHtml = `
      <div id="modal-colaboradores" class="modal-overlay" onclick="cerrarModal('modal-colaboradores')">
        <div class="modal-box" style="max-width:540px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Equipo de Trabajo</div>
              <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">👥 Colaboradores del Sistema</div>
            </div>
            <button onclick="abrirModalColaboradorNuevo()" style="height:36px;padding:0 14px;border:none;border-radius:999px;background:#2E6FC0;color:#fff;font-weight:700;font-size:13px;cursor:pointer">+ Alta colaborador</button>
          </div>
          <div id="colaboradores-lista-body" style="padding:10px 0;max-height:360px;overflow-y:auto">
            <div style="padding:20px;text-align:center;color:#8595AD">Cargando...</div>
          </div>
          <div style="padding:14px 24px;border-top:1px solid #EEF1F6;text-align:right">
            <button onclick="cerrarModal('modal-colaboradores')" style="height:40px;padding:0 20px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cerrar</button>
          </div>
        </div>
      </div>`;

    const modalColaboradorNuevoHtml = `
      <div id="modal-colaborador-nuevo" class="modal-overlay" onclick="cerrarModal('modal-colaborador-nuevo')">
        <div class="modal-box" style="max-width:440px" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Nuevo usuario ayudante</div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.01em">Alta de Colaborador</div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre y apellido</div>
            <input id="colab-nombre" class="inp" placeholder="Ej: Juan Pérez" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Usuario de acceso</div>
            <input id="colab-usuario" class="inp" placeholder="Ej: juan_colab" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Contraseña de acceso</div>
            <input id="colab-pass" class="inp" type="password" style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Email (opcional)</div>
            <input id="colab-email" class="inp" placeholder="juan@ejemplo.com">
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-colaborador-nuevo')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:10px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button onclick="guardarColaborador(this)" style="flex:1.4;height:44px;border:none;border-radius:10px;background:#2E6FC0;color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-op">Guardar colaborador</button>
          </div>
        </div>
      </div>`;


    const modalAsignarAdminHtml = `
      <div id="modal-asignar-admin" class="modal-overlay" onclick="cerrarModal('modal-asignar-admin')">
        <div class="modal-box" style="max-width:440px;max-height:85vh;overflow-y:auto" onclick="stopEv(event)">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #EEF1F6">
            <div style="font-size:12px;font-weight:700;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Asignación de Edificio</div>
            <div id="asig-edificio-nombre" style="font-size:19px;font-weight:800;letter-spacing:-.01em"></div>
          </div>
          <div style="padding:20px 24px">
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Administrador asignado actualmente</div>
            <div id="asig-admin-actual" style="font-size:14px;font-weight:600;color:#64748B;background:#F1F4F9;padding:10px 12px;border-radius:10px;margin-bottom:16px"></div>
            <div style="font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nuevo administrador / cliente</div>
            <select id="asig-nuevo-admin" class="inp" style="margin-bottom:18px;height:44px">
              ${d.clientes.map((c) => `<option value="${esc(c.usuario)}">${esc(c.nombre)} (@${esc(c.usuario)})</option>`).join('')}
            </select>
            <div style="font-size:12.5px;color:#64748B;line-height:1.4">
              ℹ️ Al transferir el edificio, se actualizará la planilla y la base de datos automáticamente. El administrador seleccionado podrá gestionarlo de inmediato desde su panel.
            </div>
          </div>
          <div style="display:flex;gap:11px;padding:0 24px 22px">
            <button onclick="cerrarModal('modal-asignar-admin')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
            <button id="btn-confirmar-asig" onclick="guardarAsignacionAdmin(this)" style="flex:1.4;height:44px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">Guardar asignación</button>
          </div>
        </div>
      </div>`;

    const contenido = `
      <div style="animation:mFade .3s ease both">${encabezado}${cuerpo}</div>
      ${modalCliente}${modalClienteEditar}${modalEdificio}${modalEditar}${modalAsignarAdminHtml}${modalColaboradoresHtml}${modalColaboradorNuevoHtml}`;

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

// --- SECCIÓN PLANES Y SUSCRIPCIONES ---
router.get('/suscripciones', async (req, res) => {
  if (!esDueno(req)) return res.redirect('/admin');
  try {
    const d = await cargarDatos(req);
    const planes = await obtenerPlanesSuscripcion();
    const banco = await obtenerDatosBancarios();

    const planesCardsHtml = planes.map((p) => {
      const servList = (p.servicios || '').split(/,|\n/).map((s) => s.trim()).filter(Boolean);
      const servHtml = servList.length
        ? servList.map((s) => `<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#334259;margin-bottom:6px"><span style="color:#22C55E">✓</span> ${esc(s)}</div>`).join('')
        : '<div style="font-size:12.5px;color:#8595AD">Sin servicios especificados.</div>';

      const precioFmt = Number(p.precio) > 0 ? (p.moneda === 'USD' ? 'USD $' + p.precio : '$' + Number(p.precio).toLocaleString('es-AR')) : 'GRATIS';

      return `
        <div style="background:#fff;border:1px solid #E7ECF3;border-radius:18px;padding:22px;display:flex;flex-direction:column;box-shadow:0 2px 6px rgba(16,35,59,.03)" class="hv-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <span class="status-badge status-${p.estado === 'activo' ? 'active' : 'inactive'}">${esc(p.estado || 'activo')}</span>
            <span style="font-size:12.5px;font-weight:700;color:#2E6FC0">🏢 ${esc(p.edificios)} Edificio${Number(p.edificios) === 1 ? '' : 's'}</span>
          </div>
          <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;color:#16233B;margin-bottom:4px">${esc(p.nombre)}</div>
          <div style="font-size:26px;font-weight:800;letter-spacing:-.02em;color:#2E6FC0;margin-bottom:16px">${precioFmt}<span style="font-size:13px;font-weight:600;color:#8595AD"> / mes</span></div>
          
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#F8FAFD;border-radius:12px;padding:12px;margin-bottom:18px">
            <div>
              <div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Mensajes</div>
              <div style="font-size:15px;font-weight:800;color:#334259">${esc(p.mensajes)} 💬</div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Llamadas</div>
              <div style="font-size:15px;font-weight:800;color:#334259">${esc(p.llamadas)} 📞</div>
            </div>
          </div>

          <div style="font-size:13px;font-weight:700;color:#16233B;margin-bottom:8px">Servicios incluidos:</div>
          <div style="flex:1;margin-bottom:20px">${servHtml}</div>

          <div style="display:flex;gap:10px;margin-top:auto;padding-top:14px;border-top:1px solid #EEF2F8">
            <button onclick="abrirEditarPlan('${p._row || ''}','${escJs(p.nombre)}','${escJs(p.precio)}','${escJs(p.moneda)}','${escJs(p.edificios)}','${escJs(p.mensajes)}','${escJs(p.llamadas)}','${escJs(p.servicios)}','${escJs(p.estado)}')" class="btn-edit-plan hv-soft">✏️ Editar</button>
            ${p._row ? `<button onclick="eliminarPlanSuscripcion(${p._row},'${escJs(p.nombre)}')" class="btn-remove-plan hv-red">🗑️</button>` : ''}
          </div>
        </div>`;
    }).join('');

    const contenido = `
      <div style="animation:mFade .3s ease both">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:14px">
          <div>
            <div style="font-size:13px;font-weight:700;color:#2E6FC0;letter-spacing:.02em;margin-bottom:3px">Configuración Comercial</div>
            <h1 style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0">Planes, Suscripciones y Pagos</h1>
          </div>
          <button onclick="abrirModalPlanNuevo()" style="height:44px;padding:0 22px;border:none;border-radius:12px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 12px rgba(46,111,192,.25)" class="hv-primary">✨ + Crear Nuevo Plan</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 340px;gap:24px" class="resgrid">
          <!-- Columna Izquierda: Planes de Suscripción -->
          <div>
            <div style="font-size:16px;font-weight:800;margin-bottom:14px;display:flex;align-items:center;gap:8px">💳 Planes disponibles para tus Clientes</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px">${planesCardsHtml}</div>
          </div>

          <!-- Columna Derecha: Datos Bancarios de Cobro -->
          <div style="display:flex;flex-direction:column;gap:18px">
            <div style="background:#fff;border:1px solid #E7ECF3;border-radius:18px;padding:22px;box-shadow:0 2px 6px rgba(16,35,59,.03)" class="hv-card">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
                <div style="font-size:16px;font-weight:800">🏦 Datos Bancarios de Cobro</div>
                <button onclick="abrirModalEditarBanco()" style="padding:6px 12px;border:1px solid #DCE4F0;border-radius:99px;background:#F8FAFD;color:#2E6FC0;font-weight:700;font-size:12.5px;cursor:pointer" class="hv-soft">✏️ Editar</button>
              </div>
              <div style="font-size:12.5px;color:#8595AD;margin-bottom:16px;line-height:1.4">Datos para que las administraciones transfieran el pago de su suscripción:</div>

              <div style="display:flex;flex-direction:column;gap:12px">
                <div style="background:#F8FAFD;border-radius:12px;padding:12px">
                  <div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Titular / Razón Social</div>
                  <div style="font-size:14.5px;font-weight:800;color:#16233B;margin-top:2px" id="lbl-banco-titular">${esc(banco.titular)}</div>
                </div>
                <div style="background:#F8FAFD;border-radius:12px;padding:12px">
                  <div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">CUIT / CUIL</div>
                  <div style="font-size:14px;font-weight:800;color:#334259;margin-top:2px" id="lbl-banco-cuit">${esc(banco.cuit)}</div>
                </div>
                <div style="background:#F8FAFD;border-radius:12px;padding:12px">
                  <div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">Banco / Cuenta</div>
                  <div style="font-size:14px;font-weight:800;color:#334259;margin-top:2px">${esc(banco.banco)} · ${esc(banco.tipo)}</div>
                </div>
                <div style="background:#F8FAFD;border-radius:12px;padding:12px">
                  <div style="font-size:11px;font-weight:700;color:#8595AD;text-transform:uppercase">CBU / CVU</div>
                  <div style="font-size:14px;font-weight:800;color:#2E6FC0;font-family:monospace;margin-top:2px">${esc(banco.cbu)}</div>
                </div>
                <div style="background:#EAF1FB;border-radius:12px;padding:12px">
                  <div style="font-size:11px;font-weight:800;color:#2E6FC0;text-transform:uppercase">Alias CBU</div>
                  <div style="font-size:16px;font-weight:800;color:#17408B;margin-top:2px">${esc(banco.alias)}</div>
                </div>
              </div>

              ${banco.notas ? `
              <div style="margin-top:16px;padding-top:14px;border-top:1px solid #EEF2F8;font-size:12.5px;color:#64748B;line-height:1.45">
                💡 <strong>Instrucciones:</strong> ${esc(banco.notas)}
              </div>` : ''}
            </div>
          </div>
        </div>
      </div>`;

    const modalPlanHtml = `
      <div id="modal-plan" class="modal-overlay" onclick="cerrarModal('modal-plan')">
        <div class="modal-box" style="width:520px" onclick="event.stopPropagation()">
          <div style="padding:22px 24px;border-bottom:1px solid #F1F4F9;display:flex;align-items:center;justify-content:space-between">
            <h2 style="font-size:18px;font-weight:800;margin:0" id="plan-modal-titulo">✨ Crear Nuevo Plan</h2>
            <button onclick="cerrarModal('modal-plan')" style="border:none;background:none;font-size:20px;cursor:pointer;color:#8595AD">✕</button>
          </div>
          <div style="padding:24px">
            <input type="hidden" id="plan-row" value="" />
            <div style="margin-bottom:16px">
              <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Modalidad / Tipo de Plan</label>
              <select id="plan-tipo" class="inp" onchange="cambiarTipoPlanModal(this.value)">
                <option value="individual">🏢 Plan Individual (Por 1 Edificio)</option>
                <option value="corporativo">🏛️ Paquete Corporativo (Múltiples Edificios)</option>
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Nombre del Plan</label>
              <input type="text" id="plan-nombre" class="inp" placeholder="ej: Plan Base, Plus, Premium" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
              <div>
                <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Precio Mensual</label>
                <input type="number" id="plan-precio" class="inp" placeholder="ej: 15000" />
              </div>
              <div>
                <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Moneda</label>
                <select id="plan-moneda" class="inp">
                  <option value="ARS">ARS ($ Pesos)</option>
                  <option value="USD">USD ($ Dólares)</option>
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
              <div>
                <label style="display:block;font-size:12.5px;font-weight:700;color:#334259;margin-bottom:6px">Edificios incl.</label>
                <input type="number" id="plan-edificios" class="inp" placeholder="5" />
              </div>
              <div>
                <label style="display:block;font-size:12.5px;font-weight:700;color:#334259;margin-bottom:6px">Mensajes 24/7</label>
                <input type="number" id="plan-mensajes" class="inp" placeholder="1000" />
              </div>
              <div>
                <label style="display:block;font-size:12.5px;font-weight:700;color:#334259;margin-bottom:6px">Llamadas incl.</label>
                <input type="number" id="plan-llamadas" class="inp" placeholder="500" />
              </div>
            </div>
            <div style="margin-bottom:16px">
              <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Servicios incluidos (separados por coma)</label>
              <textarea id="plan-servicios" class="inp" style="height:80px" placeholder="ej: Atención IA 24/7, Reclamos en tiempo real, Facturas y Fotos, Servicio de Gastos IA"></textarea>
            </div>
            <div style="margin-bottom:20px">
              <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Estado del Plan</label>
              <select id="plan-estado" class="inp">
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
            <div style="display:flex;gap:12px">
              <button onclick="cerrarModal('modal-plan')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
              <button onclick="guardarPlanSuscripcion(this)" style="flex:1.4;height:44px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">Guardar Plan</button>
            </div>
          </div>
        </div>
      </div>`;

    const modalBancoHtml = `
      <div id="modal-banco" class="modal-overlay" onclick="cerrarModal('modal-banco')">
        <div class="modal-box" style="width:500px" onclick="event.stopPropagation()">
          <div style="padding:22px 24px;border-bottom:1px solid #F1F4F9;display:flex;align-items:center;justify-content:space-between">
            <h2 style="font-size:18px;font-weight:800;margin:0">🏦 Editar Datos Bancarios de Cobro</h2>
            <button onclick="cerrarModal('modal-banco')" style="border:none;background:none;font-size:20px;cursor:pointer;color:#8595AD">✕</button>
          </div>
          <div style="padding:24px">
            <div style="margin-bottom:14px">
              <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Titular / Razón Social</label>
              <input type="text" id="banco-titular" class="inp" value="${esc(banco.titular)}" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div>
                <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">CUIT / CUIL</label>
                <input type="text" id="banco-cuit" class="inp" value="${esc(banco.cuit)}" />
              </div>
              <div>
                <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Banco / Entidad</label>
                <input type="text" id="banco-nombre" class="inp" value="${esc(banco.banco)}" />
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div>
                <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">CBU / CVU</label>
                <input type="text" id="banco-cbu" class="inp" value="${esc(banco.cbu)}" />
              </div>
              <div>
                <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Alias CBU</label>
                <input type="text" id="banco-alias" class="inp" value="${esc(banco.alias)}" />
              </div>
            </div>
            <div style="margin-bottom:14px">
              <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Tipo de Cuenta</label>
              <input type="text" id="banco-tipo" class="inp" value="${esc(banco.tipo)}" placeholder="ej: Cuenta Corriente en Pesos" />
            </div>
            <div style="margin-bottom:20px">
              <label style="display:block;font-size:13px;font-weight:700;color:#334259;margin-bottom:6px">Notas / Instrucciones de pago</label>
              <textarea id="banco-notas" class="inp" style="height:70px">${esc(banco.notas)}</textarea>
            </div>
            <div style="display:flex;gap:12px">
              <button onclick="cerrarModal('modal-banco')" style="flex:1;height:44px;border:1px solid #DCE4F0;border-radius:11px;background:#fff;color:#334259;font-weight:700;font-size:14px;cursor:pointer" class="hv-soft">Cancelar</button>
              <button onclick="guardarDatosBancarios(this)" style="flex:1.4;height:44px;border:none;border-radius:11px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:14px;cursor:pointer" class="hv-primary">Guardar Datos</button>
            </div>
          </div>
        </div>
      </div>`;

    res.send(shell(req, d, 'suscripciones', contenido + modalPlanHtml + modalBancoHtml));
  } catch (e) {
    console.error('Error en /admin/suscripciones:', e);
    res.status(500).send(paginaError(e));
  }
});

/* ===================================================================
 * ESCRITURA EN SHEETS (helpers)
 * =================================================================== */

async function findOrPlanColumn(tabName, candidateKeys) {
  await ensureSheetExists(tabName).catch(() => {});
  const { rawHeaders, headers } = await readTab(tabName).catch(() => ({ rawHeaders: [], headers: [] }));
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

function letterToColumnNumber(letter) {
  let col = 0;
  const str = String(letter || '').toUpperCase().replace(/[^A-Z]/g, '');
  for (let i = 0; i < str.length; i++) {
    col = col * 26 + (str.charCodeAt(i) - 64);
  }
  return col || 1;
}

async function ensureGridDimensions(tabName, colIndex, rowIndex) {
  try {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const normTab = String(tabName || '').toLowerCase().trim();
    const sheetObj = (meta.data.sheets || []).find((s) => s.properties && String(s.properties.title || '').toLowerCase().trim() === normTab);
    if (!sheetObj) return;

    const props = sheetObj.properties.gridProperties || {};
    const currentCols = props.columnCount || 26;
    const currentRows = props.rowCount || 1000;
    const sheetId = sheetObj.properties.sheetId;

    const reqs = [];
    if (colIndex > currentCols) {
      reqs.push({
        updateSheetProperties: {
          properties: {
            sheetId: sheetId,
            gridProperties: {
              columnCount: Math.max(colIndex + 5, currentCols + 5)
            }
          },
          fields: 'gridProperties.columnCount'
        }
      });
    }

    if (rowIndex > currentRows) {
      reqs.push({
        updateSheetProperties: {
          properties: {
            sheetId: sheetId,
            gridProperties: {
              rowCount: Math.max(rowIndex + 100, currentRows + 500)
            }
          },
          fields: 'gridProperties.rowCount'
        }
      });
    }

    if (reqs.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: reqs }
      });
    }
  } catch (err) {
    console.warn(`[ensureGridDimensions] Aviso al expandir rejilla para ${tabName}:`, err.message);
  }
}

async function writeCell(tabName, col, row, value) {
  await ensureSheetExists(tabName).catch(() => {});
  const colNum = typeof col === 'number' ? col : letterToColumnNumber(col);
  const colStr = typeof col === 'number' ? columnLetter(col) : col;
  const rowNum = Number(row) || 1;
  await ensureGridDimensions(tabName, colNum, rowNum).catch(() => {});
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!${colStr}${rowNum}`,
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
  await ensureSheetExists(tabName).catch(() => {});
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!1:1`,
    });
  } catch (_) {
    res = null;
  }
  let existingHeaders = (res && res.data && res.data.values && res.data.values[0]) || [];
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
  // Si `rowData` trae una clave sin columna existente que la matchee, se
  // crea la columna en vez de perder el dato en silencio (bug real: un
  // proveedor se guardaba sin "cliente" si esa columna no existía todavía).
  const sinMatch = Object.keys(rowData).filter((k) =>
    !existingHeaders.some((h) => normalizeKey(h) === normalizeKey(k) || k === h));
  for (const k of sinMatch) {
    const col = columnLetter(existingHeaders.length + 1);
    await ensureHeader(tabName, col, k, false);
    existingHeaders = existingHeaders.concat([k]);
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

async function appendRows(tabName, rowsArray) {
  if (!rowsArray || !rowsArray.length) return;
  await ensureSheetExists(tabName).catch(() => {});
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!1:1`,
    });
  } catch (_) {
    res = null;
  }
  let existingHeaders = (res && res.data && res.data.values && res.data.values[0]) || [];
  if (existingHeaders.length === 0) {
    const headers = Object.keys(rowsArray[0]);
    const valuesMatrix = [headers].concat(rowsArray.map((r) => headers.map((k) => (r[k] !== undefined ? String(r[k]) : ''))));
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valuesMatrix },
    });
    return;
  }

  const allKeys = new Set();
  rowsArray.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const sinMatch = Array.from(allKeys).filter((k) =>
    !existingHeaders.some((h) => normalizeKey(h) === normalizeKey(k) || k === h));
  for (const k of sinMatch) {
    const col = columnLetter(existingHeaders.length + 1);
    await ensureHeader(tabName, col, k, false);
    existingHeaders = existingHeaders.concat([k]);
  }

  const valuesMatrix = rowsArray.map((r) => {
    return existingHeaders.map((h) => {
      const key = normalizeKey(h);
      const match = Object.keys(r).find((k) => normalizeKey(k) === key || k === h);
      return match !== undefined ? String(r[match]) : '';
    });
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: valuesMatrix },
  });
}

/* ===================================================================
 * APIs (POST & GET)
 * =================================================================== */

// --- ENDPOINTS PLANES Y DATOS BANCARIOS DE SUSCRIPCIÓN ---
router.get('/api/suscripciones-planes', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'No autorizado' });
  const planes = await obtenerPlanesSuscripcion();
  res.json({ planes });
});

router.post('/api/suscripciones-plan-guardar', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'No autorizado' });
  try {
    const { row, nombre, precio, moneda, edificios, mensajes, llamadas, servicios, estado } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'El nombre del plan es obligatorio' });

    const cNom = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['nombre', 'plan']);
    const cPre = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['precio', 'monto']);
    const cMon = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['moneda']);
    const cEd = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['edificios', 'edificios_incluidos']);
    const cMsg = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['mensajes', 'mensajes_incluidos']);
    const cCall = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['llamadas', 'llamadas_incluidas']);
    const cSrv = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['servicios', 'caracteristicas']);
    const cEst = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['estado']);

    if (cNom.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cNom.col, 'nombre', false);
    if (cPre.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cPre.col, 'precio', false);
    if (cMon.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cMon.col, 'moneda', false);
    if (cEd.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cEd.col, 'edificios', false);
    if (cMsg.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cMsg.col, 'mensajes', false);
    if (cCall.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cCall.col, 'llamadas', false);
    if (cSrv.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cSrv.col, 'servicios', false);
    if (cEst.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cEst.col, 'estado', false);

    if (row) {
      const rowNum = Number(row);
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cNom.col, rowNum, nombre);
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cPre.col, rowNum, precio || '0');
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cMon.col, rowNum, moneda || 'ARS');
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cEd.col, rowNum, edificios || '1');
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cMsg.col, rowNum, mensajes || '300');
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cCall.col, rowNum, llamadas || '200');
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cSrv.col, rowNum, servicios || '');
      await writeCell(TAB_SUSCRIPCIONES_PLANES, cEst.col, rowNum, estado || 'activo');
    } else {
      await appendRow(TAB_SUSCRIPCIONES_PLANES, {
        nombre,
        precio: precio || '0',
        moneda: moneda || 'ARS',
        edificios: edificios || '1',
        mensajes: mensajes || '300',
        llamadas: llamadas || '200',
        servicios: servicios || '',
        estado: estado || 'activo'
      });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error al guardar plan:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/suscripciones-plan-eliminar', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'No autorizado' });
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila no especificada' });
    const cEst = await findOrPlanColumn(TAB_SUSCRIPCIONES_PLANES, ['estado']);
    if (cEst.create) await ensureHeader(TAB_SUSCRIPCIONES_PLANES, cEst.col, 'estado', false);
    await writeCell(TAB_SUSCRIPCIONES_PLANES, cEst.col, Number(row), 'eliminado');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.get('/api/suscripciones-banco', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'No autorizado' });
  const banco = await obtenerDatosBancarios();
  res.json({ banco });
});

router.post('/api/suscripciones-banco-guardar', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'No autorizado' });
  try {
    const { titular, cuit, banco, cbu, alias, tipo, notas } = req.body || {};

    const cTit = await findOrPlanColumn(TAB_SUSCRIPCIONES_BANCO, ['titular', 'razon_social']);
    const cCuit = await findOrPlanColumn(TAB_SUSCRIPCIONES_BANCO, ['cuit', 'cuil']);
    const cBnc = await findOrPlanColumn(TAB_SUSCRIPCIONES_BANCO, ['banco', 'entidad']);
    const cCbu = await findOrPlanColumn(TAB_SUSCRIPCIONES_BANCO, ['cbu', 'cvu']);
    const cAli = await findOrPlanColumn(TAB_SUSCRIPCIONES_BANCO, ['alias']);
    const cTip = await findOrPlanColumn(TAB_SUSCRIPCIONES_BANCO, ['tipo', 'tipo_cuenta']);
    const cNot = await findOrPlanColumn(TAB_SUSCRIPCIONES_BANCO, ['notas', 'instrucciones']);

    if (cTit.create) await ensureHeader(TAB_SUSCRIPCIONES_BANCO, cTit.col, 'titular', false);
    if (cCuit.create) await ensureHeader(TAB_SUSCRIPCIONES_BANCO, cCuit.col, 'cuit', false);
    if (cBnc.create) await ensureHeader(TAB_SUSCRIPCIONES_BANCO, cBnc.col, 'banco', false);
    if (cCbu.create) await ensureHeader(TAB_SUSCRIPCIONES_BANCO, cCbu.col, 'cbu', false);
    if (cAli.create) await ensureHeader(TAB_SUSCRIPCIONES_BANCO, cAli.col, 'alias', false);
    if (cTip.create) await ensureHeader(TAB_SUSCRIPCIONES_BANCO, cTip.col, 'tipo', false);
    if (cNot.create) await ensureHeader(TAB_SUSCRIPCIONES_BANCO, cNot.col, 'notas', false);

    const { rows } = await readTab(TAB_SUSCRIPCIONES_BANCO).catch(() => ({ rows: [] }));
    if (rows && rows.length > 0) {
      const rowNum = rows[0]._row;
      await writeCell(TAB_SUSCRIPCIONES_BANCO, cTit.col, rowNum, titular || '');
      await writeCell(TAB_SUSCRIPCIONES_BANCO, cCuit.col, rowNum, cuit || '');
      await writeCell(TAB_SUSCRIPCIONES_BANCO, cBnc.col, rowNum, banco || '');
      await writeCell(TAB_SUSCRIPCIONES_BANCO, cCbu.col, rowNum, cbu || '');
      await writeCell(TAB_SUSCRIPCIONES_BANCO, cAli.col, rowNum, alias || '');
      await writeCell(TAB_SUSCRIPCIONES_BANCO, cTip.col, rowNum, tipo || '');
      await writeCell(TAB_SUSCRIPCIONES_BANCO, cNot.col, rowNum, notas || '');
    } else {
      await appendRow(TAB_SUSCRIPCIONES_BANCO, { titular, cuit, banco, cbu, alias, tipo, notas });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error al guardar datos bancarios:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

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

// Marcar evento como resuelto (dueño o cliente del consorcio).
router.post('/api/evento-resolver', async (req, res) => {
  try {
    const { row } = req.body || {};
    if (!row || isNaN(Number(row))) return res.status(400).json({ error: 'Fila invalida' });
    
    const d = await cargarDatos(req);
    const rowNum = Number(row);
    const ev = d.eventos.find((e) => e._row === rowNum);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });
    
    // Verificar permisos
    if (!esDueno(req)) {
      const permitidos = edificiosPermitidos(req);
      if (!permitidos || !permitidos.includes(ev.edificio)) {
        return res.status(403).json({ error: 'Sin permiso para este edificio' });
      }
    }
    
    const plan = await findOrPlanColumn(TAB_EVENTOS, ['estado', 'status']);
    if (plan.create) await ensureHeader(TAB_EVENTOS, plan.col, 'estado', false);
    
    await writeCell(TAB_EVENTOS, plan.col, rowNum, 'resuelto');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Marcar estado de factura (Pagada / Pendiente).
router.post('/api/factura-estado', async (req, res) => {
  try {
    const { row, estado } = req.body || {};
    if (!row || isNaN(Number(row))) return res.status(400).json({ error: 'Fila inválida' });

    const rowNum = Number(row);
    const { rows } = await readTab(TAB_ARCHIVOS);
    const facturas = rows.map(mapFactura);
    const f = facturas.find((x) => x._row === rowNum);
    if (!f) return res.status(404).json({ error: 'Comprobante no encontrado' });

    // Verificar permisos por edificio
    if (!esDueno(req)) {
      const permitidos = edificiosPermitidos(req);
      if (!permitidos || !permitidos.includes(f.edificio)) {
        return res.status(403).json({ error: 'Sin permiso para este edificio' });
      }
    }

    const nuevoEstado = String(estado).toLowerCase() === 'pagada' ? 'Pagada' : 'Pendiente';
    const plan = await findOrPlanColumn(TAB_ARCHIVOS, ['estado', 'status', 'pago']);
    if (plan.create) await ensureHeader(TAB_ARCHIVOS, plan.col, 'estado', false);

    await writeCell(TAB_ARCHIVOS, plan.col, rowNum, nuevoEstado);
    res.json({ ok: true, estado: nuevoEstado });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Edicion directa de la ficha de un edificio (dueño, modal).
/**
 * TODAS las columnas de la planilla que son ese mismo campo, no solo la primera.
 *
 * POR QUÉ. La tab `EDIFICIOS` tiene el nombre del consorcio escrito en dos columnas, `edificio` y
 * `nombre`, que son alias del mismo dato. Pero el panel las lee en un orden (`edificio` primero) y
 * el motor de Marcos en el otro (`nombre` primero, ver `listarEdificiosConocidos` en sheets.js).
 *
 * Mientras se escribía solo en la primera que apareciera, cada corrección dejaba la otra columna
 * con el valor viejo, y el valor que se veía dependía de quién estaba mirando. Así fue como el
 * apóstrofe de "san patricio 27'0 casa" se corrigió desde el panel y volvió a aparecer solo: nunca
 * se había ido, estaba en la otra columna.
 *
 * Si no existe ninguna, se planifica crearla con el nombre canónico.
 */
function columnasDelCampo(headers, candidates) {
  const columnas = headers
    .map((h, i) => (candidates.includes(h) ? columnLetter(i + 1) : null))
    .filter(Boolean);
  return { columnas, crear: columnas.length === 0 };
}

const EDIFICIO_FIELDS = {
  nombre: ['edificio', 'nombre', 'consorcio'],
  direccion: ['direccion', 'domicilio'],
  zona: ['zona', 'barrio'],
  encargado: ['encargado', 'portero', 'sereno'],
  tel_encargado: ['telefono_encargado', 'tel_encargado', 'celular_encargado'],
  encargado_estado: ['encargado_estado', 'estado_encargado'],
  encargado_suplente: ['encargado_suplente', 'suplente', 'personal_limpieza'],
  tel_suplente: ['tel_suplente', 'telefono_suplente'],
  encargado_horario: ['encargado_horario', 'horario_encargado'],
  suplente_horario: ['suplente_horario', 'horario_suplente', 'horario_limpieza'],
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
  reglamento_sum_pdf: ['reglamento_sum_pdf', 'reglamento_pdf', 'pdf_sum']
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
      // Se escribe en TODAS las columnas que son este campo, no en la primera que aparezca:
      // ver la nota de `columnasDelCampo`.
      let { columnas, crear } = columnasDelCampo(workingHeaders, candidates);
      if (crear) {
        const col = columnLetter(workingHeaders.length + 1);
        await ensureHeader(TAB_EDIFICIOS, col, candidates[0], false);
        workingHeaders.push(candidates[0]);
        columnas = [col];
      }
      for (const col of columnas) await writeCell(TAB_EDIFICIOS, col, row, body[field]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/subir-pdf-reglamento', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { edificio, pdfBase64, filename } = req.body || {};
    if (!edificio || !pdfBase64) return res.status(400).json({ error: 'Faltan datos (edificio o pdfBase64)' });
    
    const buffer = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
    const safeName = (filename || 'reglamento_sum.pdf').replace(/[^a-zA-Z0-9_\.-]/g, '_');
    
    const adminFolder = 'administracion_general';
    const edificioFolder = typeof normalizarCarpeta === 'function' ? normalizarCarpeta(edificio) : edificio.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const targetDir = path.join(__dirname, 'almacenamiento', adminFolder, edificioFolder, 'documentos');
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    const targetPath = path.join(targetDir, safeName);
    fs.writeFileSync(targetPath, buffer);
    
    const relativeUrl = `/archivos/${adminFolder}/${edificioFolder}/documentos/${safeName}`;
    
    const { rows, headers } = await readTab(TAB_EDIFICIOS);
    const edRow = rows.findIndex((r) => compararEdificios(r.nombre, edificio));
    if (edRow >= 0) {
      let colIdx = headers.findIndex((h) => ['reglamento_sum_pdf', 'reglamento_pdf', 'pdf_sum'].includes(h.toLowerCase()));
      let colLetter;
      if (colIdx >= 0) colLetter = columnLetter(colIdx + 1);
      else {
        colLetter = columnLetter(headers.length + 1);
        await ensureHeader(TAB_EDIFICIOS, colLetter, 'reglamento_sum_pdf', false);
      }
      await writeCell(TAB_EDIFICIOS, colLetter, edRow + 2, relativeUrl);
    }
    
    res.json({ ok: true, url: relativeUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// --- Endpoints Colaboradores del Sistema ---
router.get('/api/colaboradores', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { rows } = await readTab(TAB_COLABORADORES);
    const list = rows.map(mapColaborador);
    res.json({ ok: true, colaboradores: list });
  } catch (e) {
    res.json({ ok: true, colaboradores: [] });
  }
});

router.post('/api/colaborador', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { nombre, usuario, pass, email } = req.body || {};
    if (!nombre || !usuario || !pass) return res.status(400).json({ error: 'Nombre, usuario y contraseña son obligatorios' });
    
    let { rows } = await readTab(TAB_COLABORADORES).catch(() => ({ rows: [] }));
    if (rows && rows.map(mapColaborador).some((x) => x.usuario === usuario)) {
      return res.status(400).json({ error: 'Ese usuario ya existe como colaborador' });
    }

    await ensureHeader(TAB_COLABORADORES, 'A', 'nombre', false);
    await ensureHeader(TAB_COLABORADORES, 'B', 'usuario', false);
    await ensureHeader(TAB_COLABORADORES, 'C', 'contrasena', false);
    await ensureHeader(TAB_COLABORADORES, 'D', 'email', false);
    await ensureHeader(TAB_COLABORADORES, 'E', 'rol', false);
    await ensureHeader(TAB_COLABORADORES, 'F', 'activo', false);
    await ensureHeader(TAB_COLABORADORES, 'G', 'fecha_alta', false);

    await appendRow(TAB_COLABORADORES, [
      nombre.trim(),
      usuario.trim(),
      pass.trim(),
      (email || '').trim(),
      'colaborador',
      'si',
      new Date().toLocaleDateString('es-AR')
    ]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/colaborador-estado', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row, activo, eliminar } = req.body || {};
    const rowNum = Number(row);
    if (!rowNum || isNaN(rowNum)) return res.status(400).json({ error: 'Fila inválida' });

    if (eliminar) {
      for (let c = 1; c <= 7; c++) {
        await writeCell(TAB_COLABORADORES, columnLetter(c), rowNum, '');
      }
    } else {
      await writeCell(TAB_COLABORADORES, 'F', rowNum, activo ? 'si' : 'no');
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// --- Endpoints Configuración de Planes & IA ---
router.get('/api/configuracion-planes', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  const cfg = await obtenerConfiguracionPlanes();
  res.json({ ok: true, config: cfg });
});

router.post('/api/configuracion-planes', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { base_msgs, plus_msgs, base_calls, plus_calls, base_edificios, plus_edificios, ia_admin_activa } = req.body || {};
    
    await ensureHeader(TAB_CONFIG_PLANES, 'A', 'base_msgs', false);
    await ensureHeader(TAB_CONFIG_PLANES, 'B', 'plus_msgs', false);
    await ensureHeader(TAB_CONFIG_PLANES, 'C', 'base_calls', false);
    await ensureHeader(TAB_CONFIG_PLANES, 'D', 'plus_calls', false);
    await ensureHeader(TAB_CONFIG_PLANES, 'E', 'base_edificios', false);
    await ensureHeader(TAB_CONFIG_PLANES, 'F', 'plus_edificios', false);
    await ensureHeader(TAB_CONFIG_PLANES, 'G', 'ia_admin_activa', false);

    const rowData = [
      String(Number(base_msgs) || 300),
      String(Number(plus_msgs) || 1000),
      String(Number(base_calls) || 200),
      String(Number(plus_calls) || 500),
      String(Number(base_edificios) || 5),
      String(Number(plus_edificios) || 20),
      ia_admin_activa ? 'si' : 'no'
    ];

    const { rows } = await readTab(TAB_CONFIG_PLANES).catch(() => ({ rows: [] }));
    if (rows && rows.length > 0) {
      for (let i = 0; i < rowData.length; i++) {
        await writeCell(TAB_CONFIG_PLANES, columnLetter(i + 1), 2, rowData[i]);
      }
    } else {
      await appendRow(TAB_CONFIG_PLANES, rowData);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/clientes', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { nombre, usuario, pass, email, wsp, notif_email, notif_wsp } = req.body || {};
    if (!nombre || !usuario || !pass) return res.status(400).json({ error: 'Nombre, usuario y contraseña son obligatorios' });
    const { rows } = await readTab(TAB_CLIENTES);
    if (rows.map(mapCliente).some((c) => c.usuario === usuario)) return res.status(400).json({ error: 'Ese usuario ya existe' });
    await appendRow(TAB_CLIENTES, {
      nombre, usuario, contrasena: pass, email: email || '',
      whatsapp: wsp || '', wsp: wsp || '', telefono: wsp || '',
      notif_email: notif_email !== false ? 'si' : 'no',
      notif_wsp: notif_wsp ? 'si' : 'no',
      edificios: '', activo: 'si',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Edición de cliente / administrador (dueño)
router.post('/api/cliente-editar', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row, nombre, usuario, pass, email, wsp, notif_email, notif_wsp } = req.body || {};
    const rowNum = Number(row);
    if (!rowNum || isNaN(rowNum)) return res.status(400).json({ error: 'Fila inválida' });
    if (!nombre || !usuario || !pass) return res.status(400).json({ error: 'Nombre, usuario y contraseña son obligatorios' });

    const { rows: cliRows, headers: cliHeaders } = await readTab(TAB_CLIENTES);
    const c = cliRows.map(mapCliente).find((x) => x._row === rowNum);
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });

    if (usuario !== c.usuario && cliRows.map(mapCliente).some((x) => x.usuario === usuario)) {
      return res.status(400).json({ error: 'Ese usuario ya existe en otro cliente' });
    }

    const fieldMap = {
      nombre: ['nombre'],
      usuario: ['usuario'],
      contrasena: ['contrasena', 'clave', 'password'],
      email: ['email'],
      whatsapp: ['whatsapp', 'wsp', 'telefono_wsp', 'telefono'],
      notif_email: ['notif_email'],
      notif_wsp: ['notif_wsp']
    };

    let workingHeaders = cliHeaders.slice();
    const updates = { 
      nombre, 
      usuario, 
      contrasena: pass, 
      email: email || '',
      whatsapp: wsp || '',
      notif_email: notif_email ? 'si' : 'no',
      notif_wsp: notif_wsp ? 'si' : 'no'
    };
    for (const field of Object.keys(fieldMap)) {
      const candidates = fieldMap[field];
      let idx = workingHeaders.findIndex((h) => candidates.includes(h));
      let col;
      if (idx >= 0) col = columnLetter(idx + 1);
      else {
        col = columnLetter(workingHeaders.length + 1);
        await ensureHeader(TAB_CLIENTES, col, candidates[0], false);
        workingHeaders.push(candidates[0]);
      }
      await writeCell(TAB_CLIENTES, col, rowNum, updates[field]);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Actualizar perfil de mi cuenta (dueño o cliente)
router.post('/api/actualizar-perfil', async (req, res) => {
  try {
    const { pass, email, wsp, notif_email, notif_wsp } = req.body || {};
    const currentUser = req.session.user;
    if (!currentUser) return res.status(401).json({ error: 'No autenticado' });

    if (esDuenoReal(req)) {
      if (pass) process.env.ADMIN_PASS = pass;
      res.json({ ok: true });
    } else {
      const { rows: cliRows, headers: cliHeaders } = await readTab(TAB_CLIENTES);
      const c = cliRows.map(mapCliente).find((x) => x.usuario === currentUser);
      if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });

      let workingHeaders = cliHeaders.slice();

      const saveField = async (candidates, value, defaultName) => {
        if (value === undefined) return;
        let idx = workingHeaders.findIndex((h) => candidates.includes(h));
        let col = idx >= 0 ? columnLetter(idx + 1) : columnLetter(workingHeaders.length + 1);
        if (idx < 0) { await ensureHeader(TAB_CLIENTES, col, defaultName, false); workingHeaders.push(defaultName); }
        await writeCell(TAB_CLIENTES, col, c._row, value);
      };

      await saveField(['contrasena', 'clave', 'password'], pass || undefined, 'contrasena');
      await saveField(['email', 'correo', 'mail'], email, 'email');
      await saveField(['whatsapp', 'wsp', 'telefono_wsp', 'telefono'], wsp, 'wsp');
      await saveField(['notif_email'], notif_email !== undefined ? (notif_email ? 'si' : 'no') : undefined, 'notif_email');
      await saveField(['notif_wsp'], notif_wsp !== undefined ? (notif_wsp ? 'si' : 'no') : undefined, 'notif_wsp');

      res.json({ ok: true });
    }
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
    const body = req.body || {};
    const { nombre, direccion, zona, unidades, encargado, plan } = body;
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del consorcio' });
    const clienteUsuario = dueno ? req.body.clienteUsuario : req.session.user;

    // Obtener el nombre del cliente para setearlo como administrador
    let nombreAdmin = '';
    let clienteObj = null;
    if (clienteUsuario) {
      const { rows: cliRows } = await readTab(TAB_CLIENTES);
      clienteObj = cliRows.map(mapCliente).find((c) => c.usuario === clienteUsuario);
      if (clienteObj) {
        nombreAdmin = clienteObj.nombre || '';
      }
    }

    const { rows: edRows, headers: edHeaders } = await readTab(TAB_EDIFICIOS);
    const yaExiste = edRows.map(mapEdificio).find((e) => normEdificio(e.nombre) === normEdificio(nombre));

    // ── UN EDIFICIO QUE YA EXISTE PERO NO ES DE NADIE ────────────────────────────────────────
    //
    // Antes acá se cortaba con "Ya existe un edificio con ese nombre" y no había otra pantalla
    // para asignarlo: el edificio quedaba suelto, visible para el dueño, sin forma de ponerlo
    // bajo su administrador. Pasa siempre que un edificio se carga antes que su cliente, o
    // después de un renombre.
    //
    // Si no lo tiene nadie, se asigna. Si ya lo tiene otro, se dice quién -- moverlo de
    // administrador es una decisión, no un efecto secundario de tocar "Agregar".
    if (yaExiste) {
      const { rows: cliRowsChk } = await readTab(TAB_CLIENTES);
      const clientes = cliRowsChk.map(mapCliente);
      const dueñoActual = clienteDelEdificio(clientes, yaExiste.nombre);

      if (dueñoActual && dueñoActual.usuario !== clienteUsuario) {
        return res.status(409).json({
          error: `"${yaExiste.nombre}" ya está asignado a ${dueñoActual.nombre}. ` +
                 `Si hay que pasarlo a otro administrador, primero sacáselo a ${dueñoActual.nombre}.`,
        });
      }
      if (dueñoActual) {
        return res.status(409).json({ error: `"${yaExiste.nombre}" ya está en la lista de ${dueñoActual.nombre}.` });
      }
      if (!clienteObj) {
        return res.status(409).json({ error: `"${yaExiste.nombre}" ya existe. Elegí a qué administrador asignarlo.` });
      }

      const nuevaLista = [...clienteObj.edificios, yaExiste.nombre].join(', ');
      const colAsig = await findOrPlanColumn(TAB_CLIENTES, ['edificios', 'edificio']);
      if (colAsig.create) await ensureHeader(TAB_CLIENTES, colAsig.col, 'edificios', false);
      await writeCell(TAB_CLIENTES, colAsig.col, clienteObj._row, nuevaLista);

      if (!dueno && req.session) {
        if (!req.session.edificios) req.session.edificios = [];
        if (!req.session.edificios.some((e) => normEdificio(e) === normEdificio(yaExiste.nombre))) {
          req.session.edificios.push(yaExiste.nombre);
        }
        await new Promise((resolve) => req.session.save(resolve));
      }

      console.log(`🏢 "${yaExiste.nombre}" ya existía sin asignar: se asignó a ${clienteObj.nombre} (${clienteObj.usuario}).`);
      return res.json({
        ok: true, asignado: true,
        mensaje: `"${yaExiste.nombre}" ya estaba cargado, así que lo asigné a ${clienteObj.nombre} en vez de crearlo de nuevo.`,
      });
    }

    const adminHeader = edHeaders.find((h) => ['admin_nombre', 'administrador', 'admin'].includes(h)) || 'administrador';

    let planAsignar = plan;
    if (!planAsignar || planAsignar === 'Base' || planAsignar === 'Plan Base') {
      const edExistentes = edRows.map(mapEdificio).filter((e) => (clienteObj?.edificios || []).some((p) => normEdificio(p) === normEdificio(e.nombre)));
      const corpExistente = edExistentes.find((e) => String(e.plan || '').toLowerCase().includes('corporativo'));
      if (corpExistente && corpExistente.plan) {
        planAsignar = corpExistente.plan;
      } else {
        planAsignar = plan || 'Base';
      }
    }

    await appendRow(TAB_EDIFICIOS, {
      nombre: nombre, edificio: nombre, direccion: direccion || '', zona: zona || '',
      unidades: unidades || '', encargado: encargado || '', plan: planAsignar,
      [adminHeader]: nombreAdmin
    });

    // Resto de la ficha (cuit, alias, horario SUM, cocheras, seguridad,
    // suplente...) — mismo camino que "Mi Edificio", crea columnas si faltan.
    const { rows: edRows2, headers: edHeaders2 } = await readTab(TAB_EDIFICIOS);
    const nuevaFila = edRows2.map(mapEdificio).find((e) => e.nombre === nombre);
    if (nuevaFila) await guardarCamposEdificio(nuevaFila, edHeaders2, body, EDIFICIO_CAMPOS_ALTA);

    if (clienteUsuario && clienteObj) {
      const nuevaLista = [...clienteObj.edificios, nombre].join(', ');
      const col = await findOrPlanColumn(TAB_CLIENTES, ['edificios', 'edificio']);
      if (col.create) await ensureHeader(TAB_CLIENTES, col.col, 'edificios', false);
      await writeCell(TAB_CLIENTES, col.col, clienteObj._row, nuevaLista);

      // Actualizar sesión del cliente en tiempo real si es el cliente directo el que lo agrega.
      if (!dueno && req.session) {
        if (!req.session.edificios) req.session.edificios = [];
        if (!req.session.edificios.includes(nombre)) {
          req.session.edificios.push(nombre);
        }
        await new Promise((resolve) => req.session.save(resolve));
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Asignación / traspaso de edificio a un administrador (dueño o colaboradores del sistema).
router.post('/api/edificio-asignar-admin', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Solo administradores del sistema' });
  try {
    const { edificio, nuevo_usuario } = req.body || {};
    if (!edificio) return res.status(400).json({ error: 'Falta el nombre del edificio' });
    if (!nuevo_usuario) return res.status(400).json({ error: 'Falta el administrador de destino' });

    const { rows: edRows } = await readTab(TAB_EDIFICIOS);
    const edObj = edRows.map(mapEdificio).find((e) => normEdificio(e.nombre) === normEdificio(edificio));
    if (!edObj) return res.status(404).json({ error: 'No se encontró el edificio en el sistema' });

    const { rows: cliRows } = await readTab(TAB_CLIENTES);
    const clientes = cliRows.map(mapCliente);
    const targetCli = clientes.find((c) => c.usuario === nuevo_usuario);
    if (!targetCli) return res.status(404).json({ error: 'No se encontró el administrador de destino' });

    const edNombreReal = edObj.nombre;
    const colEdificiosCli = await findOrPlanColumn(TAB_CLIENTES, ['edificios', 'edificio']);

    // 1. Quitar el edificio de cualquier otro cliente que lo tuviera asignado
    for (const c of clientes) {
      if (c.usuario !== nuevo_usuario) {
        const tiene = (c.edificios || []).some((e) => normEdificio(e) === normEdificio(edNombreReal));
        if (tiene) {
          const filtrados = (c.edificios || []).filter((e) => normEdificio(e) !== normEdificio(edNombreReal));
          if (colEdificiosCli && !colEdificiosCli.create) {
            await writeCell(TAB_CLIENTES, colEdificiosCli.col, c._row, filtrados.join(', '));
          }
          try {
            await queryPg('UPDATE clientes SET edificios = $1 WHERE lower(usuario) = lower($2)', [filtrados.join(', '), c.usuario]);
          } catch (_) {}
        }
      }
    }

    // 2. Agregar el edificio al nuevo administrador
    const yaLoTiene = (targetCli.edificios || []).some((e) => normEdificio(e) === normEdificio(edNombreReal));
    let nuevaLista = targetCli.edificios || [];
    if (!yaLoTiene) {
      nuevaLista = [...nuevaLista, edNombreReal];
      if (colEdificiosCli) {
        if (colEdificiosCli.create) await ensureHeader(TAB_CLIENTES, colEdificiosCli.col, 'edificios', false);
        await writeCell(TAB_CLIENTES, colEdificiosCli.col, targetCli._row, nuevaLista.join(', '));
      }
      try {
        await queryPg('UPDATE clientes SET edificios = $1 WHERE lower(usuario) = lower($2)', [nuevaLista.join(', '), targetCli.usuario]);
      } catch (_) {}
    }

    // 3. Actualizar la columna administrador en EDIFICIOS
    const colAdminEd = await findOrPlanColumn(TAB_EDIFICIOS, ['admin_nombre', 'administrador', 'admin']);
    if (colAdminEd) {
      if (colAdminEd.create) await ensureHeader(TAB_EDIFICIOS, colAdminEd.col, 'administrador', false);
      await writeCell(TAB_EDIFICIOS, colAdminEd.col, edObj._row, targetCli.nombre);
    }
    try {
      await queryPg('UPDATE edificios SET admin_nombre = $1 WHERE marcos_norm(edificio) = marcos_norm($2)', [targetCli.nombre, edNombreReal]);
    } catch (_) {}

    res.json({ ok: true, edificio: edNombreReal, nuevo_admin: targetCli.nombre, nuevo_usuario: targetCli.usuario });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Adherir / gestionar edificios en el paquete corporativo contratado (cliente o dueño).
router.post('/api/adherir-plan-corporativo', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { plan, cupos, seleccionados, excluidos, motivo } = req.body || {};
    if (!plan) return res.status(400).json({ error: 'Falta el nombre del plan' });
    if (!Array.isArray(seleccionados) || seleccionados.length === 0) {
      return res.status(400).json({ error: 'Seleccioná al menos un edificio' });
    }

    const permitidos = edificiosPermitidos(req);
    const dueno = esDueno(req);
    const limiteCupos = Number(cupos) || 5;

    if (seleccionados.length > limiteCupos) {
      return res.status(400).json({ error: `El cupo máximo del plan es ${limiteCupos} edificios` });
    }

    const { rows: edRows } = await readTab(TAB_EDIFICIOS);
    const planFormatted = plan.includes('Paquete Corporativo') ? plan : `${plan} (Paquete Corporativo)`;

    // Verificar si el cliente ya tiene contratado este plan corporativo en sus edificios
    const edificiosDelCliente = dueno ? edRows.map(mapEdificio) : edRows.map(mapEdificio).filter((e) => permitidos && permitidos.some((p) => normEdificio(p) === normEdificio(e.nombre)));
    const yaTienePlanContratado = edificiosDelCliente.some((e) => String(e.plan || '').toLowerCase().includes(normEdificio(plan)) || String(e.plan || '').toLowerCase().includes('corporativo'));

    // Si ya lo tiene contratado o es el dueño, se aplica DIRECTAMENTE sin esperar aprobación
    if (yaTienePlanContratado || dueno) {
      const colPlan = await findOrPlanColumn(TAB_EDIFICIOS, ['plan']);

      for (const nombreEd of seleccionados) {
        const edRow = edRows.map(mapEdificio).find((e) => normEdificio(e.nombre) === normEdificio(nombreEd));
        if (edRow && colPlan) {
          if (colPlan.create) await ensureHeader(TAB_EDIFICIOS, colPlan.col, 'plan', false);
          await writeCell(TAB_EDIFICIOS, colPlan.col, edRow._row, planFormatted);
          try {
            await queryPg('UPDATE edificios SET plan = $1 WHERE marcos_norm(edificio) = marcos_norm($2)', [planFormatted, edRow.nombre]);
          } catch (_) {}
        }
      }

      if (Array.isArray(excluidos)) {
        for (const nombreEd of excluidos) {
          const edRow = edRows.map(mapEdificio).find((e) => normEdificio(e.nombre) === normEdificio(nombreEd));
          if (edRow && colPlan && String(edRow.plan || '').toLowerCase().includes('corporativo')) {
            await writeCell(TAB_EDIFICIOS, colPlan.col, edRow._row, 'Plan Base');
            try {
              await queryPg("UPDATE edificios SET plan = 'Plan Base' WHERE marcos_norm(edificio) = marcos_norm($1)", [edRow.nombre]);
            } catch (_) {}
          }
        }
      }

      return res.json({
        ok: true,
        directo: true,
        mensaje: `¡Se asignaron los ${seleccionados.length} edificios a tu ${plan} exitosamente!`
      });
    }

    // Si no tiene el plan contratado todavía, se genera la solicitud para el administrador del sistema
    const usuario = req.session.user;
    const edDesc = `Paquete Corporativo (${seleccionados.length} edificios)`;
    await appendRow(TAB_SOLICITUDES, {
      fecha: new Date().toLocaleString('es-AR'),
      usuario,
      edificio: edDesc,
      campo: 'plan',
      valor_actual: '',
      valor_nuevo: planFormatted,
      motivo: motivo || `Solicitud de adhesión a ${planFormatted}`,
      estado: 'pendiente',
      motivo_rechazo: ''
    });

    res.json({
      ok: true,
      directo: false,
      mensaje: '¡Solicitud de Paquete Corporativo enviada con éxito! Será activada a la brevedad.'
    });
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
    // Si viene un paquete corporativo, conservamos el texto descriptivo tal cual
    // para que el motivo (que sí trae la lista real de edificios) sea procesable al aprobar.
    const esCorp = edificio && String(edificio).toLowerCase().includes('paquete corporativo');
    const ed = esCorp ? String(edificio) : (edificio && permitidos.includes(edificio) ? edificio : (permitidos[0] || ''));
    // Si quien edita es el dueño real del sistema, guardamos el cambio DIRECTAMENTE en el edificio.
    if (esDuenoReal(req)) {
      const { rows: edRows, headers: edHeaders } = await readTab(TAB_EDIFICIOS);
      const edRow = edRows.map(mapEdificio).find((e) => compararEdificios(e.nombre, ed));
      if (edRow) {
        const map = {
          nombre: ['edificio', 'nombre', 'consorcio'],
          direccion: ['direccion', 'domicilio'],
          administrador: ['admin_nombre', 'administrador', 'admin'],
          telefonos: ['admin_telefono', 'telefonos', 'contactos', 'numeros'],
          cuit: ['cuit']
        };
        if (map[campo]) {
          await guardarCamposEdificio(edRow, edHeaders, { [campo]: valorNuevo }, map);
          return res.json({ ok: true });
        }
      }
    }
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

// Aprobar solicitud (dueño): aplica el cambio en la tab edificios a TODOS los edificios seleccionados si es corporativo.
router.post('/api/aprobar-solicitud', async (req, res) => {
  if (!esDueno(req)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    const { rows } = await readTab(TAB_SOLICITUDES);
    const solicitud = rows.find((r) => r._row === Number(row));
    if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const { edificio, campo, valor_nuevo, motivo, cliente, usuario } = solicitud;
    const { rows: edRows, headers: edHeaders } = await readTab(TAB_EDIFICIOS);

    // Extraer todos los edificios asignados al paquete corporativo
    // Usamos [^\]] para matchear todo hasta el cierre del corchete (más robusto que .*?)
    let targetEdificios = [];
    const motivoTxt = String(motivo || '');
    const matchAsignados = motivoTxt.match(/Edificios asignados \(\d+\):\s*\[([^\]]+)\]/i);
    if (matchAsignados && matchAsignados[1]) {
      targetEdificios = matchAsignados[1].split(',').map((s) => s.trim()).filter(Boolean);
    }

    // Fallback 1: si no viene el formato de asignados, ver si edificio trae lista separada por coma
    if (!targetEdificios.length) {
      if (edificio && !String(edificio).toLowerCase().includes('paquete corporativo')) {
        targetEdificios = String(edificio).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    // Fallback 2: si es paquete corporativo sin lista explícita en motivo, tomar todos los edificios del usuario solicitante
    if (!targetEdificios.length && ((valor_nuevo || '').toLowerCase().includes('corporativo') || (edificio || '').toLowerCase().includes('paquete corporativo'))) {
      const cliUsuario = usuario || cliente || '';
      if (cliUsuario) {
        // Buscar en TAB_EDIFICIOS todos los edificios que pertenezcan a ese usuario/cliente
        targetEdificios = edRows
          .filter((r) => {
            const u = String(r.usuario || r.cliente || r.admin_usuario || '').toLowerCase();
            return u && u === cliUsuario.toLowerCase();
          })
          .map((r) => r.edificio || r.nombre)
          .filter(Boolean);
      }
      // Último recurso: tomar todos los edificios de la hoja
      if (!targetEdificios.length) {
        targetEdificios = edRows.map((r) => r.edificio || r.nombre).filter(Boolean);
      }
    }

    // Fallback 3: si aun así no hay lista, usar exactamente el edificio de la solicitud
    if (!targetEdificios.length && edificio) {
      targetEdificios = [edificio];
    }

    let celdasEscritas = 0;

    if (campo) {
      const candidates = EDIFICIO_FIELDS[campo] || [campo];

      // Se escribe en TODAS las columnas equivalentes que existan, no en la primera.
      //
      // Bug real: la planilla tiene `nombre` y `edificio`, que son el mismo dato. Al aprobar un
      // cambio de nombre se escribía en `nombre` -- la primera de la lista -- pero el resto del
      // sistema lee `edificio`. El valor quedaba guardado, la solicitud figuraba "aplicada", y en
      // pantalla no cambiaba nada. Escribir en las dos las mantiene sincronizadas, que es lo que
      // se esperaba desde el principio: son alias de un mismo campo, no campos distintos.
      const { columnas, crear } = columnasDelCampo(edHeaders, candidates);
      if (crear) {
        const col = columnLetter(edHeaders.length + 1);
        await ensureHeader(TAB_EDIFICIOS, col, candidates[0], false);
        columnas.push(col);
      }

      for (const edNom of targetEdificios) {
        const matchingEdRows = edRows.filter((r) =>
          compararEdificios(r.edificio || r.nombre || '', edNom)
        );
        for (const edRow of matchingEdRows) {
          if (!edRow) continue;
          for (const col of columnas) {
            await writeCell(TAB_EDIFICIOS, col, edRow._row, valor_nuevo);
            celdasEscritas++;
          }
        }
      }
    }

    // ── RENOMBRAR UN EDIFICIO ES RENOMBRARLO EN TODOS LADOS ─────────────────────────────────
    //
    // El nombre del consorcio no vive solo en `EDIFICIOS`: está copiado como texto en cada
    // vecino, cada evento, cada factura, cada asignación de proveedor y en la lista de edificios
    // del cliente. Ese texto es la única forma que tiene el sistema de relacionar las filas: no
    // hay un id.
    //
    // Cambiarlo en `EDIFICIOS` y en ningún otro lado parte el edificio en dos. Las filas viejas
    // siguen diciendo "san patricio 27'0 casa", el panel las muestra tal cual, y el apóstrofe
    // "vuelve solo" -- nunca se había ido, estaba en las otras pestañas.
    let filasRenombradas = 0;
    if (campo === 'nombre' && valor_nuevo) {
      // Dónde figura el nombre de un edificio en cada pestaña. `edificios` (en plural, en
      // CLIENTES) es una lista separada por comas y se trata aparte.
      const DONDE_FIGURA = [
        [TAB_EVENTOS,      ['edificio', 'consorcio']],
        [TAB_ARCHIVOS,     ['edificio']],
        [TAB_SUGERENCIAS,  ['edificio']],
        [TAB_SOLICITUDES,  ['edificio']],
        [TAB_EXPENSAS,     ['edificio']],
        [TAB_ASIGNACIONES, ['edificio']],
        ['vecinos',        ['edificio']],
      ];

      for (const viejo of targetEdificios) {
        // Comparación exacta, no `compararEdificios`: ese acepta coincidencias parciales, así que
        // un cambio de "san patricio 270" a "san patricio 270 casa" se leería como "ya se llamaba
        // así" y no se renombraría nada.
        if (normEdificio(viejo) === normEdificio(valor_nuevo)) continue;

        for (const [tab, columnas] of DONDE_FIGURA) {
          let datos;
          try { datos = await readTab(tab); } catch { continue; }
          if (!datos.headers.length) continue;

          for (const nombreCol of columnas) {
            const i = datos.headers.indexOf(nombreCol);
            if (i < 0) continue;
            const letra = columnLetter(i + 1);
            for (const fila of datos.rows) {
              // Comparación exacta y normalizada: `compararEdificios` acepta coincidencias
              // parciales, y con eso un "san patricio 159" se llevaría por delante al 270.
              if (normEdificio(fila[nombreCol]) !== normEdificio(viejo)) continue;
              await writeCell(tab, letra, fila._row, valor_nuevo);
              filasRenombradas++;
            }
          }
        }

        // La lista de edificios del cliente es una sola celda con comas: se reemplaza el ítem
        // que corresponde y se deja el resto intacto.
        try {
          const { rows: cliRows, headers: cliHeaders } = await readTab(TAB_CLIENTES);
          const iCol = cliHeaders.findIndex(h => h === 'edificios' || h === 'edificio');
          if (iCol >= 0) {
            const letra = columnLetter(iCol + 1);
            const nombreCol = cliHeaders[iCol];
            for (const fila of cliRows) {
              const partes = String(fila[nombreCol] || '').split(',').map(s => s.trim()).filter(Boolean);
              if (!partes.some(p => normEdificio(p) === normEdificio(viejo))) continue;
              const nuevas = partes.map(p => (normEdificio(p) === normEdificio(viejo) ? valor_nuevo : p));
              await writeCell(TAB_CLIENTES, letra, fila._row, nuevas.join(', '));
              filasRenombradas++;
            }
          }
        } catch (e) {
          console.error(`[Solicitud ${row}] No se pudo actualizar la lista de edificios del cliente: ${e.message}`);
        }
      }

      // ── Y EN POSTGRESQL, QUE ES DE DONDE LEE MARCOS ──────────────────────────────────────
      //
      // Son dos bases: este panel lee Sheets, pero el motor de Marcos y los permisos del cliente
      // (`obtenerEdificiosPermitidosUsuario`, `expandirEdificiosPermitidos`) leen PostgreSQL.
      // Renombrar solo en Sheets deja a Marcos llamando al edificio por el nombre viejo y al
      // cliente con el permiso apuntando a un edificio que ya no se llama así.
      //
      // Y no alcanza con reimportar después: `importar-sheets-a-pg.js` usa la columna `edificio`
      // como clave, así que con el nombre ya cambiado en Sheets no actualiza la fila -- crea una
      // segunda. Hay que renombrar la que existe.
      for (const viejo of targetEdificios) {
        if (normEdificio(viejo) === normEdificio(valor_nuevo)) continue;
        try {
          const cols = await queryPg(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type IN ('text','character varying','character')
              AND (column_name IN ('edificio', 'consorcio', 'edificios')
                   OR (table_name = 'edificios' AND column_name = 'nombre'))
          `);

          // FILA POR FILA, con `ctid`, y cada una en su propio try.
          //
          // Un UPDATE masivo aborta la sentencia entera ante una restricción única, y de paso se
          // lleva puestas las tablas que faltaban: PostgreSQL queda a medias y la aprobación
          // igual dice que salió bien. Ya pasó con uq_proveedor_asignaciones al renombrar un
          // proveedor. Acá lo que falla es una fila, no el renombrado.
          for (const { table_name: tabla, column_name: col } of (cols.rows || [])) {
            let filas;
            try {
              filas = await queryPg(`SELECT ctid, "${col}" AS v FROM "${tabla}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`);
            } catch (e) {
              console.error(`[Solicitud ${row}] No se pudo leer ${tabla}.${col}: ${e.message}`);
              continue;
            }

            for (const f of (filas.rows || [])) {
              let destino = null;
              if (col === 'edificios') {
                // Lista separada por comas: se cambia el ítem y se deja el resto.
                const partes = String(f.v || '').split(',').map(s => s.trim()).filter(Boolean);
                if (!partes.some(p => normEdificio(p) === normEdificio(viejo))) continue;
                destino = partes.map(p => (normEdificio(p) === normEdificio(viejo) ? valor_nuevo : p)).join(', ');
              } else if (normEdificio(f.v) === normEdificio(viejo)) {
                destino = valor_nuevo;
              }
              if (destino === null) continue;

              try {
                await queryPg(`UPDATE "${tabla}" SET "${col}" = $2 WHERE ctid = $1`, [f.ctid, destino]);
                filasRenombradas++;
              } catch (e) {
                console.error(
                  `[Solicitud ${row}] ⚠️ No se pudo renombrar ${tabla}.${col} ("${f.v}"): ${e.message}. ` +
                  `El resto sí se renombró. Revisalo con: node buscar-texto.js "${viejo}"`
                );
              }
            }
          }
        } catch (e) {
          // Que falle PostgreSQL no puede tirar abajo la aprobación: Sheets ya quedó bien. Pero
          // tiene que verse, porque mientras no se corrija, Marcos y el panel ven cosas distintas.
          console.error(`[Solicitud ${row}] ⚠️ Sheets quedó renombrado pero PostgreSQL NO: ${e.message}. ` +
                        `Corregilo con: node renombrar-edificio.js "${viejo}" "${valor_nuevo}" --aplicar`);
        }
      }

      if (filasRenombradas) {
        console.log(`[Solicitud ${row}] "${targetEdificios.join(', ')}" → "${valor_nuevo}": ${filasRenombradas} referencia(s) actualizadas fuera de EDIFICIOS.`);
      }
    }

    // Si no se escribió nada, la solicitud NO se marca como aplicada.
    //
    // Pasó de verdad con un "Paquete Corporativo (3 edificios)": ese texto no es el nombre de
    // ningún edificio, así que no coincidió con ninguna fila, no se escribió una sola celda, y
    // la solicitud igual quedó "aplicada". El dueño la vio resuelta y nunca se enteró de que el
    // cambio no existía. Un fracaso silencioso es peor que un error.
    if (campo && celdasEscritas === 0) {
      console.warn(`[Solicitud ${row}] No se aplicó nada: "${edificio}" no coincide con ningún edificio cargado.`);
      return res.status(409).json({
        error: `No encontré ningún edificio que coincida con "${edificio}", así que no cambié nada. ` +
               `Revisá que el nombre del edificio en la solicitud sea el mismo que figura en la planilla.`,
      });
    }

    const planEstado = await findOrPlanColumn(TAB_SOLICITUDES, ['estado']);
    if (planEstado.create) await ensureHeader(TAB_SOLICITUDES, planEstado.col, 'estado', false);
    await writeCell(TAB_SOLICITUDES, planEstado.col, Number(row), 'aplicada');
    res.json({ ok: true, edificiosActualizados: targetEdificios, celdasEscritas });
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

// Campos que el CLIENTE edita directo en Mi Edificio (sin aprobacion), UNA
// VEZ que el edificio ya existe. direccion/cuit/nombre/administrador/
// telefonos NO estan aca: esos van por solicitud de cambio (son "datos
// sensibles" de identidad del consorcio).
const MI_EDIFICIO_FIELDS = {
  zona: ['zona', 'barrio'],
  aliases: ['aliases', 'alias', 'otros_nombres'],
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
  suplente_horario: ['suplente_horario', 'horario_suplente', 'horario_limpieza'],
};

// En el ALTA del edificio no hay nada que "aprobar" todavía (el cliente
// recien lo esta cargando), asi que ahi si se cargan directo.
const EDIFICIO_CAMPOS_ALTA = {
  ...MI_EDIFICIO_FIELDS,
  direccion: ['direccion', 'domicilio'],
  cuit: ['cuit'],
};

// Escribe en TAB_EDIFICIOS los campos de `fieldsMap` presentes en `body`
// para la fila `edRow`, creando la columna si todavía no existe.
async function guardarCamposEdificio(edRow, headers, body, fieldsMap) {
  fieldsMap = fieldsMap || MI_EDIFICIO_FIELDS;
  let workingHeaders = headers.slice();
  for (const field of Object.keys(fieldsMap)) {
    if (body[field] === undefined) continue;
    const candidates = fieldsMap[field];
    // Igual que en /api/edificio: todas las columnas que son este campo, no solo la primera.
    let { columnas, crear } = columnasDelCampo(workingHeaders, candidates);
    if (crear) {
      const col = columnLetter(workingHeaders.length + 1);
      await ensureHeader(TAB_EDIFICIOS, col, candidates[0], false);
      workingHeaders.push(candidates[0]);
      columnas = [col];
    }
    for (const col of columnas) await writeCell(TAB_EDIFICIOS, col, edRow._row, body[field]);
  }
}

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

    await guardarCamposEdificio(edRow, headers, body);
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
    const { rubro, nombre, telefono, notas, cbu, alias, titular, cuit } = req.body || {};
    let cliente = clienteDeSesion(req);
    if (!cliente && esDueno(req)) cliente = req.session.user;
    if (!cliente) return res.status(400).json({ error: 'Solo clientes cargan su lista' });
    if (!nombre && !telefono) return res.status(400).json({ error: 'Cargá nombre o teléfono' });

    // Los datos de cobro son opcionales en el alta, pero si vienen se verifican igual que
    // cuando los manda el proveedor por WhatsApp: un CBU mal tipeado acá termina en un pago
    // rechazado, y es más barato frenarlo ahora que descubrirlo el día que hay que pagar.
    const cbuLimpio = String(cbu || '').replace(/\D/g, '');
    if (cbuLimpio) {
      const { validarCBU } = require('./cbu');
      const chequeo = validarCBU(cbuLimpio);
      if (!chequeo.valido) return res.status(400).json({ error: `Ese CBU no es válido: ${chequeo.motivo}` });
    }
    const aliasLimpio = String(alias || '').trim();
    if (aliasLimpio) {
      const { validarAlias } = require('./cbu');
      const chequeo = validarAlias(aliasLimpio);
      if (!chequeo.valido) return res.status(400).json({ error: `Ese alias no es válido: ${chequeo.motivo}` });
    }

    await appendRow(TAB_PROVEEDORES, {
      cliente,
      rubro: rubro || 'Otro',
      nombre: nombre || '',
      telefono: telefono || '',
      notas: notas || '',
      estado: 'activo',
      cbu: cbuLimpio,
      alias_cbu: aliasLimpio.toLowerCase(),
      titular: String(titular || '').trim(),
      cuit: String(cuit || '').replace(/\D/g, ''),
      cbu_actualizado: (cbuLimpio || aliasLimpio) ? new Date().toLocaleString('es-AR') : '',
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
    const { rows } = await readTab(TAB_PROVEEDORES);
    const prov = rows.map(mapProveedor).find((p) => p._row === Number(row));
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const plan = await findOrPlanColumn(TAB_PROVEEDORES, ['estado']);
    if (plan.create) await ensureHeader(TAB_PROVEEDORES, plan.col, 'estado', false);
    await writeCell(TAB_PROVEEDORES, plan.col, Number(row), 'eliminado');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/proveedor-editar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row, rubro, nombre, telefono, notas } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    const { rows } = await readTab(TAB_PROVEEDORES);
    const prov = rows.map(mapProveedor).find((p) => p._row === Number(row));
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });

    const cRubro = await findOrPlanColumn(TAB_PROVEEDORES, ['rubro', 'especialidad']);
    const cNombre = await findOrPlanColumn(TAB_PROVEEDORES, ['nombre', 'proveedor']);
    const cTel = await findOrPlanColumn(TAB_PROVEEDORES, ['telefono', 'tel']);
    const cNotas = await findOrPlanColumn(TAB_PROVEEDORES, ['notas', 'observaciones']);

    if (cRubro.create) await ensureHeader(TAB_PROVEEDORES, cRubro.col, 'rubro', false);
    if (cNombre.create) await ensureHeader(TAB_PROVEEDORES, cNombre.col, 'nombre', false);
    if (cTel.create) await ensureHeader(TAB_PROVEEDORES, cTel.col, 'telefono', false);
    if (cNotas.create) await ensureHeader(TAB_PROVEEDORES, cNotas.col, 'notas', false);

    if (rubro !== undefined) await writeCell(TAB_PROVEEDORES, cRubro.col, Number(row), rubro);
    if (nombre !== undefined) await writeCell(TAB_PROVEEDORES, cNombre.col, Number(row), nombre);
    if (telefono !== undefined) await writeCell(TAB_PROVEEDORES, cTel.col, Number(row), telefono);
    if (notas !== undefined) await writeCell(TAB_PROVEEDORES, cNotas.col, Number(row), notas);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ── DATOS DE COBRO DEL PROVEEDOR ────────────────────────────────────────────────────────────
//
// El navegador ya tenía la pantalla y llamaba a estas dos rutas, pero del lado del servidor no
// existían: guardar los datos de cobro daba 404 y el mensaje de error no decía por qué. Lo
// encontró `verificar-antes-de-subir.js`, que compara lo que el front pide contra lo que el back
// ofrece.
router.post('/api/proveedor-datos-cobro', async (req, res) => {
  if (!esDueno(req) && !vistaCliente(req)) return res.status(403).json({ error: 'Sin permiso' });
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row, cbu, alias, titular, cuit } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    if (!cbu && !alias) return res.status(400).json({ error: 'Hace falta el CBU o el alias' });

    const { rows } = await readTab(TAB_PROVEEDORES);
    const prov = rows.map(mapProveedor).find((p) => p._row === Number(row));
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });

    // El CBU trae dos dígitos verificadores. Si no cierran, NO se guarda: son 22 números y un
    // dígito cambiado manda el pago a otra cuenta sin que nadie lo note.
    const { validarCBU, validarAlias } = require('./cbu');
    let cbuOk = '';
    if (cbu) {
      const v = validarCBU(cbu);
      if (!v.valido) return res.status(400).json({ error: `Ese CBU no verifica (${v.motivo || 'los dígitos no cierran'}). Revisalo o cargá el alias, que es más corto y se lee mejor.` });
      cbuOk = v.cbu;
    }
    let aliasOk = '';
    if (alias) {
      const v = validarAlias(alias);
      if (!v.valido) return res.status(400).json({ error: `Ese alias no tiene el formato de un alias bancario (${v.motivo || 'formato inválido'}).` });
      aliasOk = v.alias;
    }

    const columnas = {
      cbu: ['cbu'], alias_cbu: ['alias_cbu', 'alias'], titular: ['titular'],
      cuit: ['cuit'], cbu_actualizado: ['cbu_actualizado'],
    };
    const valores = {
      cbu: cbuOk, alias_cbu: aliasOk, titular: titular || '', cuit: cuit || '',
      cbu_actualizado: new Date().toLocaleString('es-AR'),
    };

    for (const campo of Object.keys(columnas)) {
      if (valores[campo] === '' && campo !== 'cbu_actualizado') continue;
      const c = await findOrPlanColumn(TAB_PROVEEDORES, columnas[campo]);
      if (c.create) await ensureHeader(TAB_PROVEEDORES, c.col, columnas[campo][0], false);
      await writeCell(TAB_PROVEEDORES, c.col, Number(row), valores[campo]);
    }

    console.log(`🏦 Datos de cobro cargados desde el panel para "${prov.nombre || 'proveedor'}".`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Aprobar o rechazar el cambio de cuenta que un proveedor pidió por WhatsApp.
//
// Cambiar el CBU de un proveedor es el fraude más común que existe: alguien se mete en la
// conversación, dice "cambié de banco, anotá este otro", y el pago del mes se va a otra cuenta.
// Por eso el cambio NO se aplica solo: queda pendiente y lo decide una persona acá.
router.post('/api/proveedor-cambio-cobro', async (req, res) => {
  if (!esDueno(req) && !vistaCliente(req)) return res.status(403).json({ error: 'Sin permiso' });
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row, aprobar } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });

    const { rows } = await readTab(TAB_PROVEEDORES);
    const prov = rows.map(mapProveedor).find((p) => p._row === Number(row));
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });

    // La lógica vive en sheets.js, que es la misma que usa Marcos: acá no se duplica el criterio
    // de qué pisa a qué.
    const { resolverCambioBancario } = require('./datos');
    const r = await resolverCambioBancario({
      nombre: prov.nombre || '',
      telefono: prov.telefono || '',
      aprobar: Boolean(aprobar),
    });
    // `resolverCambioBancario` devuelve el porqué en `motivo`, no en `error`.
    if (!r?.ok) return res.status(400).json({ error: r?.motivo ? `No se pudo: ${r.motivo}.` : 'No había ningún cambio pendiente para resolver.' });

    console.log(`🏦 Cambio de cuenta de "${prov.nombre}" ${aprobar ? 'APROBADO' : 'rechazado'} desde el panel.`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/proveedor-asignar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { proveedor, prioridad, edificio: reqEdificio } = req.body || {};
    let cliente = clienteDeSesion(req);
    if (!cliente && esDueno(req)) {
      cliente = req.session.user;
    }
    if (!cliente) return res.status(400).json({ error: 'Solo clientes asignan proveedores' });

    const permitidos = edificiosPermitidos(req) || [];
    const edificio = reqEdificio || (permitidos.length ? permitidos[0] : (req.session.edificioActivo || ''));
    if (!edificio) return res.status(400).json({ error: 'Sin edificio activo' });
    if (!proveedor) return res.status(400).json({ error: 'Falta el proveedor' });

    const { rows } = await readTab(TAB_PROVEEDORES);
    const m = rows.map(mapProveedor).find((p) =>
      String(p.nombre).trim().toLowerCase() === String(proveedor).trim().toLowerCase()
    );

    if (!m) return res.status(404).json({ error: 'Ese proveedor no está en tu lista' });

    const { rows: aRows } = await readTab(TAB_ASIGNACIONES);
    const existente = aRows.map(mapAsignacion).find((a) =>
      compararEdificios(a.edificio, edificio) &&
      String(a.proveedor).trim().toLowerCase() === String(proveedor).trim().toLowerCase()
    );

    if (existente) {
      const cPrio = await findOrPlanColumn(TAB_ASIGNACIONES, ['prioridad']);
      const cEst = await findOrPlanColumn(TAB_ASIGNACIONES, ['estado']);
      const cTel = await findOrPlanColumn(TAB_ASIGNACIONES, ['telefono', 'tel']);
      const cRub = await findOrPlanColumn(TAB_ASIGNACIONES, ['rubro', 'especialidad']);

      if (cPrio.create) await ensureHeader(TAB_ASIGNACIONES, cPrio.col, 'prioridad', false);
      if (cEst.create) await ensureHeader(TAB_ASIGNACIONES, cEst.col, 'estado', false);
      if (cTel.create) await ensureHeader(TAB_ASIGNACIONES, cTel.col, 'telefono', false);
      if (cRub.create) await ensureHeader(TAB_ASIGNACIONES, cRub.col, 'rubro', false);

      await writeCell(TAB_ASIGNACIONES, cPrio.col, existente._row, prioridad || 'primera');
      await writeCell(TAB_ASIGNACIONES, cEst.col, existente._row, 'activo');
      await writeCell(TAB_ASIGNACIONES, cTel.col, existente._row, m.telefono || '');
      await writeCell(TAB_ASIGNACIONES, cRub.col, existente._row, m.rubro || 'Otro');
      return res.json({ ok: true });
    }

    await appendRow(TAB_ASIGNACIONES, {
      cliente: cliente || '',
      edificio,
      proveedor: m.nombre,
      rubro: m.rubro || 'Otro',
      telefono: m.telefono || '',
      prioridad: prioridad || 'primera',
      estado: 'activo',
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
    const { rows } = await readTab(TAB_ASIGNACIONES);
    const a = rows.map(mapAsignacion).find((x) => x._row === Number(row));
    if (!a) return res.status(404).json({ error: 'Asignación no encontrada' });
    const plan = await findOrPlanColumn(TAB_ASIGNACIONES, ['estado']);
    if (plan.create) await ensureHeader(TAB_ASIGNACIONES, plan.col, 'estado', false);
    await writeCell(TAB_ASIGNACIONES, plan.col, Number(row), 'eliminado');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// --- CONSEJO DE ADMINISTRACIÓN ---
router.post('/api/consejo', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { nombre, cargo, unidad, telefono, email, notas, edificio: reqEdificio } = req.body || {};
    let cliente = clienteDeSesion(req);
    if (!cliente && esDueno(req)) cliente = req.session.user;

    const permitidos = edificiosPermitidos(req) || [];
    const edificio = reqEdificio || (permitidos.length ? permitidos[0] : (req.session.edificioActivo || ''));
    if (!edificio) return res.status(400).json({ error: 'Sin edificio activo' });
    if (!nombre) return res.status(400).json({ error: 'Cargá el nombre del integrante' });

    await appendRow(TAB_CONSEJO, {
      cliente: cliente || '',
      edificio,
      nombre: nombre || '',
      cargo: cargo || 'Integrante',
      unidad: unidad || '',
      telefono: telefono || '',
      email: email || '',
      notas: notas || '',
      estado: 'activo',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/consejo-editar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row, nombre, cargo, unidad, telefono, email, notas } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });

    const cNombre = await findOrPlanColumn(TAB_CONSEJO, ['nombre', 'miembro']);
    const cCargo = await findOrPlanColumn(TAB_CONSEJO, ['cargo', 'rol']);
    const cUnidad = await findOrPlanColumn(TAB_CONSEJO, ['unidad', 'depto']);
    const cTel = await findOrPlanColumn(TAB_CONSEJO, ['telefono', 'tel']);
    const cEmail = await findOrPlanColumn(TAB_CONSEJO, ['email', 'mail']);
    const cNotas = await findOrPlanColumn(TAB_CONSEJO, ['notas']);

    if (cNombre.create) await ensureHeader(TAB_CONSEJO, cNombre.col, 'nombre', false);
    if (cCargo.create) await ensureHeader(TAB_CONSEJO, cCargo.col, 'cargo', false);
    if (cUnidad.create) await ensureHeader(TAB_CONSEJO, cUnidad.col, 'unidad', false);
    if (cTel.create) await ensureHeader(TAB_CONSEJO, cTel.col, 'telefono', false);
    if (cEmail.create) await ensureHeader(TAB_CONSEJO, cEmail.col, 'email', false);
    if (cNotas.create) await ensureHeader(TAB_CONSEJO, cNotas.col, 'notas', false);

    if (nombre !== undefined) await writeCell(TAB_CONSEJO, cNombre.col, Number(row), nombre);
    if (cargo !== undefined) await writeCell(TAB_CONSEJO, cCargo.col, Number(row), cargo);
    if (unidad !== undefined) await writeCell(TAB_CONSEJO, cUnidad.col, Number(row), unidad);
    if (telefono !== undefined) await writeCell(TAB_CONSEJO, cTel.col, Number(row), telefono);
    if (email !== undefined) await writeCell(TAB_CONSEJO, cEmail.col, Number(row), email);
    if (notas !== undefined) await writeCell(TAB_CONSEJO, cNotas.col, Number(row), notas);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/consejo-quitar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Fila inválida' });
    const plan = await findOrPlanColumn(TAB_CONSEJO, ['estado']);
    if (plan.create) await ensureHeader(TAB_CONSEJO, plan.col, 'estado', false);
    await writeCell(TAB_CONSEJO, plan.col, Number(row), 'eliminado');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/vecino-crear', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { edificio, nombre, unidad, telefono, email, notas } = req.body || {};
    if (!edificio) return res.status(400).json({ error: 'Falta edificio' });
    await appendRow(TAB_VECINOS, {
      edificio: edificio || '',
      nombre: nombre || '',
      departamento: unidad || '',
      unidad: unidad || '',
      telefono: telefono || '',
      email: email || '',
      notas: notas || '',
      estado: 'activo',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/vecino-editar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row, nombre, unidad, telefono, email, notas } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Falta fila' });
    const cNombre = await findOrPlanColumn(TAB_VECINOS, ['nombre', 'vecino']);
    const cUnidad = await findOrPlanColumn(TAB_VECINOS, ['departamento', 'unidad', 'depto']);
    const cTel = await findOrPlanColumn(TAB_VECINOS, ['telefono', 'tel']);
    const cEmail = await findOrPlanColumn(TAB_VECINOS, ['email', 'mail']);
    const cNotas = await findOrPlanColumn(TAB_VECINOS, ['notas', 'observaciones']);

    if (cNombre.create) await ensureHeader(TAB_VECINOS, cNombre.col, 'nombre', false);
    if (cUnidad.create) await ensureHeader(TAB_VECINOS, cUnidad.col, 'departamento', false);
    if (cTel.create) await ensureHeader(TAB_VECINOS, cTel.col, 'telefono', false);
    if (cEmail.create) await ensureHeader(TAB_VECINOS, cEmail.col, 'email', false);
    if (cNotas.create) await ensureHeader(TAB_VECINOS, cNotas.col, 'notas', false);

    if (nombre !== undefined) await writeCell(TAB_VECINOS, cNombre.col, Number(row), nombre);
    if (unidad !== undefined) await writeCell(TAB_VECINOS, cUnidad.col, Number(row), unidad);
    if (telefono !== undefined) await writeCell(TAB_VECINOS, cTel.col, Number(row), telefono);
    if (email !== undefined) await writeCell(TAB_VECINOS, cEmail.col, Number(row), email);
    if (notas !== undefined) await writeCell(TAB_VECINOS, cNotas.col, Number(row), notas);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/vecino-eliminar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ error: 'Falta fila' });
    const plan = await findOrPlanColumn(TAB_VECINOS, ['estado']);
    if (plan.create) await ensureHeader(TAB_VECINOS, plan.col, 'estado', false);
    await writeCell(TAB_VECINOS, plan.col, Number(row), 'eliminado');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/vecinos-importar-masivo', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { edificio, vecinos } = req.body || {};
    if (!edificio) return res.status(400).json({ error: 'Falta edificio' });
    if (!Array.isArray(vecinos) || vecinos.length === 0) {
      return res.status(400).json({ error: 'No se recibieron vecinos para importar' });
    }

    const rows = vecinos.map((v) => ({
      edificio: edificio || '',
      nombre: v.nombre || '',
      departamento: v.unidad || v.departamento || '',
      unidad: v.unidad || v.departamento || '',
      telefono: v.telefono || '',
      email: v.email || '',
      notas: v.notas || '',
      estado: 'activo',
    }));

    await appendRows(TAB_VECINOS, rows);
    res.json({ ok: true, importados: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/servicio-gastos-toggle', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { edificio, activo } = req.body || {};
    const nombreEd = edificio || (edificiosPermitidos(req) || [])[0];
    if (!nombreEd) return res.status(400).json({ error: 'Sin edificio activo' });

    const { rows } = await readTab(TAB_EDIFICIOS);
    const edRow = rows.map(mapEdificio).find((e) => compararEdificios(e.nombre, nombreEd));
    if (!edRow) return res.status(404).json({ error: 'Edificio no encontrado' });

    const plan = await findOrPlanColumn(TAB_EDIFICIOS, ['servicio_gastos_ia', 'servicio_ia_gastos']);
    if (plan.create) await ensureHeader(TAB_EDIFICIOS, plan.col, 'servicio_gastos_ia', false);
    await writeCell(TAB_EDIFICIOS, plan.col, edRow._row, activo ? 'SI' : 'NO');

    res.json({ ok: true, activo: !!activo });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// --- NUEVOS ENDPOINTS DE BASE DE DATOS Y VISOR DE CHATS ---
router.get('/api/mensajes', async (req, res) => {
  try {
    const { eventoId, telefono } = req.query || {};
    // PostgreSQL es la base oficial del sistema: el motor escribe el chat ahí (db-pg), no en el
    // SQLite de db.js. Apuntar a db.js dejaba este visor vacío para siempre.
    const { obtenerHistorialMensajes, obtenerHistorialChatTelefono } = require('./db-pg');
    if (eventoId) {
      const msgs = await obtenerHistorialMensajes(eventoId);
      return res.json({ ok: true, mensajes: msgs });
    }
    if (telefono) {
      const msgs = await obtenerHistorialChatTelefono(telefono);
      return res.json({ ok: true, mensajes: msgs });
    }
    res.json({ ok: true, mensajes: [] });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.get('/api/busqueda-global', async (req, res) => {
  try {
    const { q } = req.query || {};
    const { busquedaGlobal } = require('./db-pg');
    const resBusqueda = await busquedaGlobal(q);
    res.json({ ok: true, resultados: resBusqueda });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ── ENDPOINTS GESTIÓN DE AMENITIES POR EDIFICIO (CLIENTE / ADMIN) ──
router.post('/api/edificio-amenity-guardar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { edificio, nombre, icono, hora_apertura, hora_cierre, capacidad, descripcion, reglamento, arancelado, precio } = req.body || {};
    if (!edificio || !nombre) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (edificio, nombre)' });
    }

    const { pool } = require('./db-pg');
    if (pool) {
      const q = `INSERT INTO edificio_amenities (edificio, nombre, icono, hora_apertura, hora_cierre, capacidad, descripcion, reglamento, arancelado, precio, activo, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, NOW()) RETURNING id`;
      const result = await pool.query(q, [
        edificio,
        nombre,
        icono || '🎉',
        hora_apertura || '08:00',
        hora_cierre || '23:00',
        Number(capacidad) || 20,
        descripcion || '',
        reglamento || '',
        Boolean(arancelado),
        Number(precio) || 0
      ]);
      return res.json({ ok: true, mensaje: 'Amenity configurado con éxito', id: result.rows[0].id });
    }
    res.json({ ok: true, mensaje: 'Amenity registrado' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/edificio-amenity-editar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { id, nombre, icono, hora_apertura, hora_cierre, capacidad, descripcion, reglamento, arancelado, precio } = req.body || {};
    if (!id || !nombre) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (id, nombre)' });
    }

    const { pool } = require('./db-pg');
    if (pool) {
      const q = `UPDATE edificio_amenities 
                 SET nombre = $1, icono = $2, hora_apertura = $3, hora_cierre = $4, capacidad = $5, descripcion = $6, reglamento = $7, arancelado = $8, precio = $9
                 WHERE id = $10`;
      await pool.query(q, [
        nombre,
        icono || '🎉',
        hora_apertura || '08:00',
        hora_cierre || '23:00',
        Number(capacidad) || 20,
        descripcion || '',
        reglamento || '',
        Boolean(arancelado),
        Number(precio) || 0,
        id
      ]);
      return res.json({ ok: true, mensaje: 'Amenity y reglamento actualizados con éxito' });
    }
    res.json({ ok: true, mensaje: 'Amenity actualizado' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/edificio-amenity-eliminar', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID de amenity requerido' });

    const { pool } = require('./db-pg');
    if (pool) {
      await pool.query('UPDATE edificio_amenities SET activo = FALSE WHERE id = $1', [id]);
    }
    res.json({ ok: true, mensaje: 'Amenity eliminado' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.post('/api/reserva-amenity-pago', async (req, res) => {
  if (bloquearSiPreview(req, res)) return;
  try {
    const { id, estado_pago } = req.body || {};
    if (!id || !estado_pago) return res.status(400).json({ error: 'ID y estado_pago requeridos' });

    const { pool } = require('./db-pg');
    if (pool) {
      const resReserva = await pool.query('UPDATE reservas_amenities SET estado_pago = $1 WHERE id = $2 RETURNING comprobante_url', [estado_pago, id]);
      if (resReserva && resReserva.rows && resReserva.rows[0] && resReserva.rows[0].comprobante_url) {
        const compUrl = resReserva.rows[0].comprobante_url;
        await pool.query('UPDATE facturas SET estado = $1 WHERE url = $2', [estado_pago, compUrl]).catch(() => {});
      }
    }
    res.json({ ok: true, mensaje: 'Estado de pago actualizado con éxito' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ===================================================================
 * EXPORT
 * =================================================================== */

module.exports = router;

