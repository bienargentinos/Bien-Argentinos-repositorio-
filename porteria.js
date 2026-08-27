/**
 * porteria.js — Portería Virtual & Timbre Inteligente Web (Marcos IA)
 * -------------------------------------------------------------------
 * Permite a visitantes, repartidores de delivery y encomiendas tocar el timbre
 * digital desde la puerta del edificio escaneando un código QR en su celular.
 * Notifica al vecino en tiempo real a su WhatsApp y emite chime sonoro.
 * -------------------------------------------------------------------
 */

'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');

let datosPg = null;
try {
  datosPg = require('./datos-pg');
} catch (_) {}

let marcosOps = null;
try {
  marcosOps = require('./agentes/marcos-ops');
} catch (_) {}

// Helper para escapar HTML de forma segura
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -------------------------------------------------------------------
// 1. SELECTOR GENERAL DE EDIFICIOS
// -------------------------------------------------------------------
router.get('/', async (req, res) => {
  const edificioQuery = req.query.edificio;
  if (edificioQuery) {
    return res.redirect('/porteria/' + encodeURIComponent(edificioQuery));
  }

  let edificios = [];
  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const q = `SELECT DISTINCT edificio AS nombre FROM vecinos WHERE estado != 'eliminado' AND edificio IS NOT NULL AND edificio != ''
                 UNION
                 SELECT DISTINCT nombre FROM edificios
                 ORDER BY nombre ASC`;
      const result = await pool.query(q);
      if (result && result.rows) {
        edificios = result.rows.map(r => r.nombre).filter(Boolean);
      }
    }
  } catch (_) {}

  if (!edificios.length) {
    edificios = ['San Patricio 159', 'San Patricio 270', 'Consorcio Demo'];
  }

  res.send(`<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0F326A">
<title>Marcos IA · Portería Virtual</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0F326A;background:linear-gradient(165deg,#0A1F44 0%,#0F326A 45%,#1B4D9B 100%);color:#fff;font-family:'Hanken Grotesk',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;color:#16233B;border-radius:24px;padding:32px 24px;width:100%;max-width:440px;box-shadow:0 25px 60px rgba(0,0,0,.35)}
.ed-btn{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#F8FAFD;border:1.5px solid #E2E8F0;border-radius:14px;color:#0F172A;font-weight:700;font-size:15px;text-decoration:none;transition:all .15s ease;margin-bottom:10px}
.ed-btn:hover{background:#EBF3FC;border-color:#2E6FC0;color:#1E5FB4;transform:translateY(-1px)}
</style>
</head>
<body>
<div class="card">
  <div style="text-align:center;margin-bottom:24px">
    <div style="width:58px;height:58px;border-radius:18px;background:linear-gradient(135deg,#0F326A,#2E6FC0);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:28px;margin-bottom:12px;box-shadow:0 8px 20px rgba(15,50,106,.25)">
      🔔
    </div>
    <h1 style="font-size:22px;font-weight:800;color:#0F326A;margin-bottom:4px">Portería Virtual</h1>
    <p style="font-size:13.5px;color:#64748B">Seleccioná tu edificio para tocar timbre</p>
  </div>

  <div style="display:flex;flex-direction:column">
    ${edificios.map(e => `
      <a href="/porteria/${encodeURIComponent(e)}" class="ed-btn">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🏢</span>
          <span>${esc(e)}</span>
        </div>
        <i class="ph ph-arrow-right" style="font-size:18px;color:#64748B"></i>
      </a>
    `).join('')}
  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#64748B">
    Desarrollado con <strong>Marcos IA</strong> · Portería Digital 24/7
  </div>
</div>
</body>
</html>`);
});

// -------------------------------------------------------------------
// 2. TIMBRE DIGITAL DEL EDIFICIO (INTERCOMUNICADOR MOBILE)
// -------------------------------------------------------------------
router.get('/:edificio', async (req, res) => {
  const nombreEdificio = req.params.edificio || 'Consorcio';

  let vecinos = [];
  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const q = `SELECT * FROM vecinos WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) AND estado != 'eliminado' ORDER BY departamento ASC, nombre ASC`;
      const result = await pool.query(q, [nombreEdificio, '%' + nombreEdificio + '%']);
      if (result && result.rows && result.rows.length > 0) {
        vecinos = result.rows;
      }
    }
  } catch (_) {}

  // Si no hay vecinos cargados todavía, generar grilla estándar por defecto
  let unidades = [];
  if (vecinos.length > 0) {
    unidades = vecinos.map(v => ({
      depto: v.departamento || v.unidad || 'UF',
      nombre: v.nombre || 'Vecino',
      telefono: v.telefono || '',
      id: v.id || 0
    }));
  } else {
    const pisos = ['PB', '1°', '2°', '3°', '4°', '5°', '6°', '7°', '8°'];
    const letras = ['A', 'B'];
    pisos.forEach(p => {
      letras.forEach(l => {
        unidades.push({ depto: p + ' ' + l, nombre: 'Unidad ' + p + ' ' + l, telefono: '', id: 0 });
      });
    });
  }

  res.send(`<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0F326A">
<title>Timbre Digital · ${esc(nombreEdificio)}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#F0F4F9;color:#16233B;font-family:'Hanken Grotesk',sans-serif;min-height:100vh;padding:16px;display:flex;flex-direction:column;align-items:center}
.container{width:100%;max-width:440px;background:#fff;border-radius:24px;border:1px solid #E2E8F0;box-shadow:0 10px 30px rgba(15,50,106,.08);overflow:hidden;margin-bottom:20px}
.header{background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;padding:24px 20px;text-align:center}
.inp-search{width:100%;height:46px;border:1.5px solid #CBD5E1;border-radius:12px;padding:0 14px 0 40px;font-size:14.5px;color:#0F172A;outline:none;background:#fff}
.inp-search:focus{border-color:#1E5FB4;box-shadow:0 0 0 3px rgba(30,95,180,.12)}
.grid-deptos{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:16px;max-height:480px;overflow-y:auto}
.btn-depto{background:#F8FAFD;border:1.5px solid #E2E8F0;border-radius:14px;padding:14px 12px;text-align:left;cursor:pointer;transition:all .15s ease;display:flex;flex-direction:column;gap:3px}
.btn-depto:active{transform:scale(.97);background:#EBF3FC;border-color:#1E5FB4}
.modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);display:none;align-items:flex-end;justify-content:center;z-index:999;padding:0}
@media(min-width:480px){.modal-overlay{align-items:center;padding:20px}}
.modal-sheet{background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:440px;padding:26px 22px;animation:slideUp .25s ease both}
@media(min-width:480px){.modal-sheet{border-radius:24px}}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.chip-visita{padding:8px 12px;border-radius:10px;border:1.5px solid #CBD5E1;background:#F8FAFD;color:#475569;font-size:13px;font-weight:700;cursor:pointer;flex:1;text-align:center;transition:all .1s}
.chip-visita.active{border-color:#1E5FB4;background:#EBF3FC;color:#1E5FB4}
.btn-ring{width:100%;height:54px;border:none;border-radius:14px;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-size:17px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 4px 14px rgba(22,163,74,.35)}
.btn-ring:active{transform:scale(.98)}
</style>
</head>
<body>

<div class="container">
  <!-- Cabecera -->
  <div class="header">
    <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,.15);display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:8px">
      🔔
    </div>
    <h1 style="font-size:20px;font-weight:800;letter-spacing:-.02em;margin-bottom:2px">${esc(nombreEdificio)}</h1>
    <p style="font-size:12.5px;opacity:.85">Portería Virtual & Intercomunicador</p>
  </div>

  <!-- Buscador de Depto -->
  <div style="padding:14px 16px 4px;position:relative">
    <i class="ph ph-magnifying-glass" style="position:absolute;left:28px;top:28px;font-size:18px;color:#94A3B8"></i>
    <input id="search-inp" class="inp-search" type="text" placeholder="Buscar por depto o nombre..." oninput="filtrarDeptos()">
  </div>

  <!-- Grilla de Deptos -->
  <div id="grid-deptos" class="grid-deptos">
    ${unidades.map(u => `
      <button class="btn-depto item-depto" onclick="abrirTimbre('${esc(u.depto)}', '${esc(u.nombre)}', '${esc(u.telefono)}')">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:15px;font-weight:800;color:#0F326A">${esc(u.depto)}</span>
          <span style="font-size:16px">🔔</span>
        </div>
        <div style="font-size:12px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(u.nombre)}
        </div>
      </button>
    `).join('')}
  </div>
</div>

<!-- Modal Llamada de Timbre -->
<div id="modal-ring" class="modal-overlay">
  <div class="modal-sheet">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:42px;height:42px;border-radius:12px;background:#EBF3FC;color:#1E5FB4;display:flex;align-items:center;justify-content:center;font-size:22px">
          🔔
        </div>
        <div>
          <div style="font-size:17px;font-weight:800;color:#0F326A" id="modal-depto-title">4° B</div>
          <div style="font-size:12px;color:#64748B" id="modal-vecino-subtitle">Juan Pérez</div>
        </div>
      </div>
      <button onclick="cerrarTimbre()" style="width:34px;height:34px;border-radius:50%;border:none;background:#F1F5F9;color:#64748B;cursor:pointer;font-size:16px">✕</button>
    </div>

    <div style="margin-bottom:14px">
      <label style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;display:block;margin-bottom:6px">¿Quién está en la puerta?</label>
      <div style="display:flex;gap:8px">
        <div class="chip-visita active" onclick="seleccionarTipo('🛵 Delivery', this)">🛵 Delivery</div>
        <div class="chip-visita" onclick="seleccionarTipo('👤 Visita', this)">👤 Visita</div>
        <div class="chip-visita" onclick="seleccionarTipo('📦 Encomienda', this)">📦 Encomienda</div>
      </div>
    </div>

    <div style="margin-bottom:18px">
      <label style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;display:block;margin-bottom:6px">Tu Nombre o Empresa (opcional)</label>
      <input id="visita-nombre-inp" type="text" placeholder="Ej: PedidosYa, Correo, Lucas..." style="width:100%;height:44px;border:1.5px solid #CBD5E1;border-radius:12px;padding:0 12px;font-size:14px;outline:none">
    </div>

    <button id="btn-tocar" class="btn-ring" onclick="ejecutarTimbre()">
      <i class="ph ph-bell-ringing-fill" style="font-size:22px"></i>
      <span>TOCAR TIMBRE</span>
    </button>

    <div id="ring-feedback" style="display:none;margin-top:14px;padding:12px;border-radius:12px;background:#DCFCE7;border:1px solid #86EFAC;color:#15803D;text-align:center;font-size:13.5px;font-weight:700">
      🔔 ¡Timbre sonando! Le enviamos el aviso a su celular.
    </div>
  </div>
</div>

<script>
var _deptoActivo = '';
var _nombreActivo = '';
var _telActivo = '';
var _tipoVisita = '🛵 Delivery';
var _edificio = '${esc(nombreEdificio)}';

function filtrarDeptos(){
  var q = document.getElementById('search-inp').value.toLowerCase().trim();
  var items = document.querySelectorAll('.item-depto');
  items.forEach(function(el){
    var txt = el.textContent.toLowerCase();
    el.style.display = txt.indexOf(q) !== -1 ? 'flex' : 'none';
  });
}

function abrirTimbre(depto, nombre, tel){
  _deptoActivo = depto;
  _nombreActivo = nombre;
  _telActivo = tel;
  document.getElementById('modal-depto-title').textContent = 'Departamento ' + depto;
  document.getElementById('modal-vecino-subtitle').textContent = nombre || 'Unidad funcional';
  document.getElementById('ring-feedback').style.display = 'none';
  document.getElementById('btn-tocar').style.display = 'flex';
  document.getElementById('modal-ring').style.display = 'flex';
}

function cerrarTimbre(){
  document.getElementById('modal-ring').style.display = 'none';
}

function seleccionarTipo(tipo, el){
  _tipoVisita = tipo;
  document.querySelectorAll('.chip-visita').forEach(function(c){ c.classList.remove('active'); });
  el.classList.add('active');
}

// Reproducir sonido digital de timbre realista con Web Audio API
function sonarChime(){
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc1 = ctx.createOscillator();
    var gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime + 0.3); // C5

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);

    osc1.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc1.stop(ctx.currentTime + 1.2);
  } catch(_) {}
}

async function ejecutarTimbre(){
  var btn = document.getElementById('btn-tocar');
  var fb = document.getElementById('ring-feedback');
  var nombreVisita = document.getElementById('visita-nombre-inp').value.trim();

  sonarChime();

  btn.disabled = true;
  btn.innerHTML = '<span style="animation:spin 1s infinite">⏳</span><span>Llamando...</span>';

  try {
    var res = await fetch('/porteria/api/tocar-timbre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        edificio: _edificio,
        departamento: _deptoActivo,
        tipoVisita: _tipoVisita,
        nombreVisita: nombreVisita
      })
    });
    var data = await res.json();

    btn.style.display = 'none';
    fb.style.display = 'block';
    fb.innerHTML = '✓ ¡Aviso enviado! Le notificamos a <strong>' + (_nombreActivo || _deptoActivo) + '</strong> al WhatsApp.';
    
    setTimeout(function(){
      sonarChime();
    }, 400);

  } catch(err){
    btn.disabled = false;
    btn.innerHTML = '🔔 TOCAR TIMBRE';
    fb.style.display = 'block';
    fb.style.background = '#FEF3C7';
    fb.style.color = '#92400E';
    fb.style.borderColor = '#FCD34D';
    fb.innerHTML = '🔔 Timbre tocado en la puerta.';
  }
}
</script>

</body>
</html>`);
});

// -------------------------------------------------------------------
// 3. ENDPOINT ACCIÓN DE TOCAR TIMBRE
// -------------------------------------------------------------------
router.post('/api/tocar-timbre', async (req, res) => {
  try {
    const { edificio, departamento, tipoVisita, nombreVisita } = req.body || {};
    let vecino = null;

    // Buscar el vecino en PostgreSQL
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        const q = `SELECT * FROM vecinos WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) AND (LOWER(departamento) = LOWER($3) OR LOWER(unidad) = LOWER($3)) AND estado != 'eliminado' LIMIT 1`;
        const result = await pool.query(q, [edificio, '%' + edificio + '%', departamento]);
        if (result && result.rows && result.rows.length > 0) {
          vecino = result.rows[0];
        }
      }
    } catch (_) {}

    const tel = vecino ? vecino.telefono : null;
    const nombre = vecino ? vecino.nombre : ('Vecino del ' + departamento);

    // Si tiene teléfono WhatsApp, enviar mensaje inmediato
    if (tel && marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
      try {
        const textoAviso = `🔔 *¡TIMBRE EN TU EDIFICIO!* 🔔\n\nHola ${nombre}, hay una visita en la puerta de *${edificio}* tocando el timbre para tu departamento (*${departamento}*).\n\n🛵 *Tipo:* ${tipoVisita || 'Visita'}${nombreVisita ? `\n👤 *Identificación:* ${nombreVisita}` : ''}\n⏰ *Hora:* ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs`;
        await marcosOps.enviarWhatsApp(tel, textoAviso);
      } catch (errWa) {
        console.warn('Error enviando WhatsApp de timbre:', errWa.message);
      }
    }

    res.json({
      ok: true,
      mensaje: 'Timbre registrado con éxito',
      vecino: nombre
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------------------------
// 4. GENERADOR DE CARTEL QR IMPRIMIBLE (A4 / PUERTA)
// -------------------------------------------------------------------
router.get('/cartel/:edificio', (req, res) => {
  const nombreEdificio = req.params.edificio || 'Consorcio';
  const qrUrl = 'https://marcos.bienargentinos.com/porteria/' + encodeURIComponent(nombreEdificio);

  res.send(`<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>Cartel Portería QR · ${esc(nombreEdificio)}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#475569;color:#0F172A;font-family:'Hanken Grotesk',sans-serif;padding:30px 15px;display:flex;flex-direction:column;align-items:center}
.poster{width:100%;max-width:560px;background:#fff;border-radius:24px;padding:44px 36px;box-shadow:0 25px 60px rgba(0,0,0,.35);text-align:center;position:relative}
.badge-top{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:999px;background:#EBF3FC;color:#1E5FB4;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px}
.qr-frame{background:#F8FAFD;border:3px solid #0F326A;border-radius:20px;padding:20px;display:inline-block;margin:20px 0;box-shadow:0 8px 24px rgba(15,50,106,.12)}
.btn-print{position:fixed;bottom:24px;right:24px;padding:12px 22px;border-radius:12px;background:#0F326A;color:#fff;font-weight:800;font-size:15px;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 8px 25px rgba(15,50,106,.4);z-index:99}
@media print{
  body{background:#fff;padding:0}
  .poster{box-shadow:none;border:none;max-width:100%;padding:20px}
  .btn-print{display:none}
}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
<body>

<button class="btn-print" onclick="window.print()">
  <i class="ph ph-printer" style="font-size:20px"></i>
  <span>Imprimir Cartel A4</span>
</button>

<div class="poster">
  <div class="badge-top">
    <i class="ph ph-bell-ringing-fill"></i>
    <span>Portería Virtual 24/7</span>
  </div>

  <h1 style="font-size:32px;font-weight:900;color:#0F326A;line-height:1.15;margin-bottom:6px">
    ${esc(nombreEdificio)}
  </h1>
  <p style="font-size:16px;color:#64748B;font-weight:600">
    Timbre inteligente para visitas y repartidores
  </p>

  <div class="qr-frame">
    <div id="qrcode"></div>
  </div>

  <div style="font-size:18px;font-weight:800;color:#0F172A;margin-bottom:16px">
    📱 Escaneá con la cámara de tu celular
  </div>

  <div style="display:flex;justify-content:center;gap:12px;margin-bottom:28px">
    <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;color:#475569">
      🛵 Deliveries
    </div>
    <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;color:#475569">
      👤 Visitas
    </div>
    <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;color:#475569">
      📦 Encomiendas
    </div>
  </div>

  <div style="border-top:1.5px dashed #CBD5E1;padding-top:18px;display:flex;align-items:center;justify-content:center;gap:10px">
    <img src="/admin/assets/logo.png" alt="Marcos IA" style="width:26px;height:26px;border-radius:6px" onerror="this.style.display='none'">
    <div style="font-size:13px;color:#64748B;font-weight:700">
      Tecnología <strong>Marcos IA</strong> para Consorcios
    </div>
  </div>
</div>

<script>
new QRCode(document.getElementById("qrcode"), {
  text: "${qrUrl}",
  width: 220,
  height: 220,
  colorDark : "#0F326A",
  colorLight : "#F8FAFD",
  correctLevel : QRCode.CorrectLevel.H
});
</script>

</body>
</html>`);
});

module.exports = router;
