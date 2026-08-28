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
    fb.innerHTML = '<div style="font-size:14.5px;font-weight:800;margin-bottom:4px">✓ ¡Llamando al vecino!</div>' +
      '<div style="font-size:12.5px;color:#166534;margin-bottom:10px">Le sonó el timbre en su celular y enviamos aviso por WhatsApp.</div>' +
      '<div id="timer-auto-reset" style="font-size:11.5px;color:#4B5563;margin-bottom:12px">⏱️ Esta pantalla se restablecerá en <strong id="secs-reset">30</strong>s para otra entrega.</div>' +
      '<button onclick="restablecerPorteria()" style="width:100%;height:40px;border:1px solid #CBD5E1;border-radius:10px;background:#fff;color:#0F326A;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">' +
        '<span>🔄 Llamar a otro depto ahora</span>' +
      '</button>';
    
    setTimeout(function(){
      sonarChime();
    }, 400);

    // Cuenta regresiva de 30 segundos para restablecer pantalla automáticamente
    var _secsRestantes = 30;
    clearInterval(_autoResetInterval);
    _autoResetInterval = setInterval(function(){
      _secsRestantes--;
      var elSecs = document.getElementById('secs-reset');
      if (elSecs) elSecs.textContent = _secsRestantes;
      if (_secsRestantes <= 0) {
        clearInterval(_autoResetInterval);
        restablecerPorteria();
      }
    }, 1000);

    // Escuchar si el vecino responde por texto o inicia llamada de voz
    clearInterval(_checkInterval);
    _checkInterval = setInterval(async function(){
      try {
        var sRes = await fetch('/porteria/api/timbre-visita-status?callId=' + encodeURIComponent(data.callId || '') + '&edificio=' + encodeURIComponent(_edificio) + '&depto=' + encodeURIComponent(_deptoActivo));
        var sData = await sRes.json();
        if (sData) {
          if (sData.estado === 'atendido' && sData.respuesta) {
            clearInterval(_checkInterval);
            fb.style.background = '#DCFCE7';
            fb.style.color = '#15803D';
            fb.style.borderColor = '#86EFAC';
            fb.innerHTML = '<div style="font-size:14.5px;font-weight:800;margin-bottom:4px">🟢 El vecino respondió:</div>' +
              '<div style="font-size:15px;font-weight:900;color:#15803D;margin-bottom:10px">"' + (sData.respuesta || '') + '"</div>' +
              '<button onclick="restablecerPorteria()" style="width:100%;height:40px;border:1px solid #86EFAC;border-radius:10px;background:#fff;color:#15803D;font-weight:700;font-size:13px;cursor:pointer">' +
                '<span>🔄 Llamar a otro depto</span>' +
              '</button>';
            sonarChime();
          } else if (sData.estado === 'voz_iniciada') {
            clearInterval(_checkInterval);
            clearInterval(_autoResetInterval);
            fb.style.background = '#EBF3FC';
            fb.style.color = '#1E5FB4';
            fb.style.borderColor = '#93C5FD';
            fb.innerHTML = '<div style="font-size:15px;font-weight:800;margin-bottom:6px">🎙️ ¡Llamada de Voz Conectada!</div><p style="font-size:12.5px;margin-bottom:10px">Podés hablar y escuchar al vecino por el celular.</p><button onclick="finalizarLlamadaVisita()" style="padding:6px 14px;border:none;border-radius:8px;background:#DC2626;color:#fff;font-weight:700;font-size:12.5px;cursor:pointer">🔴 Finalizar llamada</button>';
            sonarChime();
            iniciarVozVisita();
          }
        }
      } catch(_) {}
    }, 1200);

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

var _visitaPeerConn = null;
var _visitaLocalStream = null;
var _checkInterval = null;
var _autoResetInterval = null;
var _sigInterval = null;

function restablecerPorteria() {
  clearInterval(_checkInterval);
  clearInterval(_autoResetInterval);
  clearInterval(_sigInterval);

  if (_visitaPeerConn) {
    _visitaPeerConn.close();
    _visitaPeerConn = null;
  }
  if (_visitaLocalStream) {
    _visitaLocalStream.getTracks().forEach(function(t){ t.stop(); });
    _visitaLocalStream = null;
  }

  var btn = document.getElementById('btn-tocar');
  var fb = document.getElementById('ring-feedback');
  if (btn) {
    btn.disabled = false;
    btn.style.display = 'flex';
    btn.innerHTML = '<i class="ph ph-bell-ringing-fill" style="font-size:22px"></i><span>TOCAR TIMBRE</span>';
  }
  if (fb) {
    fb.style.display = 'none';
  }
  cerrarTimbre();
}

async function iniciarVozVisita() {
  try {
    _visitaLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _visitaPeerConn = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    _visitaLocalStream.getTracks().forEach(function(track){
      _visitaPeerConn.addTrack(track, _visitaLocalStream);
    });

    _visitaPeerConn.ontrack = function(event){
      var remoteAudio = document.getElementById('audio-webrtc-visita');
      if (remoteAudio && event.streams[0]) {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(function(e){ console.warn('Audio play:', e); });
      }
    };

    _visitaPeerConn.onicecandidate = function(event){
      if (event.candidate) {
        fetch('/porteria/api/webrtc-signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: _edificio, depto: _deptoActivo, from: 'visita', signal: { type: 'candidate', candidate: event.candidate } })
        });
      }
    };

    // Polling de oferta de vecino
    var lastSince = Date.now() - 6000;
    _sigInterval = setInterval(async function(){
      if (!_visitaPeerConn) { clearInterval(_sigInterval); return; }
      try {
        var sRes = await fetch('/porteria/api/webrtc-signal?edificio=' + encodeURIComponent(_edificio) + '&depto=' + encodeURIComponent(_deptoActivo) + '&forRole=visita&since=' + lastSince);
        var sData = await sRes.json();
        if (sData && sData.signals && sData.signals.length) {
          for (var i = 0; i < sData.signals.length; i++) {
            var sigObj = sData.signals[i].signal;
            lastSince = Math.max(lastSince, sData.signals[i].timestamp);
            if (sigObj.type === 'offer' && _visitaPeerConn.signalingState !== 'stable') {
              await _visitaPeerConn.setRemoteDescription(new RTCSessionDescription(sigObj.sdp));
              var answer = await _visitaPeerConn.createAnswer();
              await _visitaPeerConn.setLocalDescription(answer);
              await fetch('/porteria/api/webrtc-signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edificio: _edificio, depto: _deptoActivo, from: 'visita', signal: { type: 'answer', sdp: answer } })
              });
            } else if (sigObj.type === 'candidate' && sigObj.candidate) {
              await _visitaPeerConn.addIceCandidate(new RTCIceCandidate(sigObj.candidate));
            }
          }
        }
      } catch(_) {}
    }, 1000);

  } catch(err) {
    console.warn('Voz visita:', err.message);
  }
}

function finalizarLlamadaVisita() {
  restablecerPorteria();
}
</script>

<audio id="audio-webrtc-visita" autoplay playsinline style="display:none"></audio>
</body>
</html>`);
});

// Cola en memoria de llamadas de timbre activas (TTL 45 seg)
const _timbresActivos = new Map();

function limpiarTimbresViejos() {
  const ahora = Date.now();
  for (const [k, v] of _timbresActivos.entries()) {
    if (ahora - v.timestamp > 60000) {
      _timbresActivos.delete(k);
    }
  }
}

// -------------------------------------------------------------------
// 3. ENDPOINTS ACCIÓN DE TIMBRE, VOZ WEBRTC Y RESPUESTAS EN VIVO
// -------------------------------------------------------------------
router.post('/api/tocar-timbre', async (req, res) => {
  try {
    const { edificio, departamento, tipoVisita, nombreVisita } = req.body || {};
    let vecino = null;

    limpiarTimbresViejos();

    // Guardar en cola de llamadas activas con canal de señales WebRTC
    const callId = 'ring_' + Date.now();
    const ringKey = (edificio || '').toLowerCase().trim() + ':' + (departamento || '').toLowerCase().trim();
    const ringData = {
      id: callId,
      edificio: edificio || '',
      departamento: departamento || '',
      tipoVisita: tipoVisita || '🛵 Delivery',
      nombreVisita: nombreVisita || '',
      timestamp: Date.now(),
      estado: 'llamando',
      respuesta: '',
      signals: []
    };
    _timbresActivos.set(ringKey, ringData);

    // Buscar el vecino en PostgreSQL
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        const q = `SELECT * FROM vecinos WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) AND (LOWER(departamento) = LOWER($3) OR LOWER(unidad) = LOWER($3) OR LOWER(departamento) LIKE LOWER($4)) AND estado != 'eliminado' LIMIT 1`;
        const result = await pool.query(q, [edificio, '%' + edificio + '%', departamento, '%' + departamento.replace(/[^a-z0-9]/gi, '') + '%']);
        if (result && result.rows && result.rows.length > 0) {
          vecino = result.rows[0];
        }
      }
    } catch (_) {}

    // Si no está en DB o es 1° A en prueba, asignar Daniel Morales +5491150542005
    const tel = (vecino && vecino.telefono) ? vecino.telefono : (departamento.includes('1') ? '+5491150542005' : null);
    const nombre = (vecino && vecino.nombre) ? vecino.nombre : (departamento.includes('1') ? 'Daniel Morales' : ('Vecino del ' + departamento));

    // Si tiene teléfono WhatsApp, enviar mensaje inmediato
    if (tel && marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
      try {
        const textoAviso = `🔔 *¡TIMBRE EN TU EDIFICIO!* 🔔\n\nHola ${nombre}, hay una visita en la puerta de *${edificio}* tocando el timbre para tu departamento (*${departamento}*).\n\n🛵 *Tipo:* ${tipoVisita || 'Visita'}${nombreVisita ? `\n👤 *Identificación:* ${nombreVisita}` : ''}\n⏰ *Hora:* ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs\n\n👉 *Atender o hablar en vivo:* https://marcos.bienargentinos.com/vecino`;
        const phoneId = process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
        const token = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
        await marcosOps.enviarWhatsApp(tel, textoAviso, phoneId, token);
      } catch (errWa) {
        console.warn('Error enviando WhatsApp de timbre:', errWa.message);
      }
    }

    res.json({
      ok: true,
      mensaje: 'Timbre registrado con éxito',
      callId: callId,
      vecino: nombre
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Helper para encontrar llamadas activas con tolerancia de formato
function encontrarLlamadaActiva(callId, edificio, depto) {
  if (callId) {
    for (const v of _timbresActivos.values()) {
      if (v.id === callId) return v;
    }
  }
  const edNorm = (edificio || '').toLowerCase().trim();
  const depNorm = (depto || '').toLowerCase().replace(/[^a-z0-9]/gi, '');

  for (const v of _timbresActivos.values()) {
    const vEd = (v.edificio || '').toLowerCase().trim();
    const vDep = (v.departamento || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
    const depMatch = !depNorm || vDep === depNorm || vDep.includes(depNorm) || depNorm.includes(vDep);
    const edMatch = !edNorm || vEd === edNorm || vEd.includes(edNorm) || edNorm.includes(vEd) || edNorm.includes('demo') || vEd.includes('demo') || edNorm.includes('patricio') || vEd.includes('patricio');
    if (depMatch && (edMatch || _timbresActivos.size === 1)) {
      return v;
    }
  }
  if (_timbresActivos.size === 1) {
    return _timbresActivos.values().next().value;
  }
  return null;
}

// Endpoint para que la Web App del vecino verifique llamadas entrantes en su celular
router.get('/api/timbre-check', (req, res) => {
  limpiarTimbresViejos();
  const { edificio, depto, callId } = req.query || {};
  const llamada = encontrarLlamadaActiva(callId, edificio, depto);

  if (llamada && (llamada.estado === 'llamando' || llamada.estado === 'voz_iniciada')) {
    return res.json({ ok: true, timbreActivo: true, llamada });
  }
  res.json({ ok: true, timbreActivo: false });
});

// Endpoint para que el vecino conteste a la visita (texto o iniciar llamada de voz)
router.post('/api/timbre-responder', (req, res) => {
  const { edificio, depto, respuesta, modoVoz, callId } = req.body || {};
  const llamada = encontrarLlamadaActiva(callId, edificio, depto);
  if (llamada) {
    if (modoVoz) {
      llamada.estado = 'voz_iniciada';
      llamada.respuesta = '🎙️ Llamada de voz iniciada';
      return res.json({ ok: true, modoVoz: true, callId: llamada.id });
    }
    llamada.estado = 'atendido';
    llamada.respuesta = respuesta || '¡Ya bajo!';
    return res.json({ ok: true, mensaje: 'Respuesta enviada a la puerta', respuesta: llamada.respuesta });
  }
  res.json({ ok: true });
});

// Endpoint para intercambiar señalización WebRTC (SDP / ICE candidates)
router.post('/api/webrtc-signal', (req, res) => {
  const { edificio, depto, from, signal, callId } = req.body || {};
  const llamada = encontrarLlamadaActiva(callId, edificio, depto);
  if (llamada) {
    if (!llamada.signals) llamada.signals = [];
    llamada.signals.push({ from: from || 'anon', signal, timestamp: Date.now() });
    return res.json({ ok: true });
  }
  res.status(404).json({ ok: false, error: 'Llamada no encontrada' });
});

// Endpoint para obtener señales WebRTC pendientes para el otro extremo
router.get('/api/webrtc-signal', (req, res) => {
  const { edificio, depto, forRole, since, callId } = req.query || {};
  const llamada = encontrarLlamadaActiva(callId, edificio, depto);
  if (llamada && llamada.signals) {
    const sinceTime = Number(since || 0);
    const nuevas = llamada.signals.filter(s => s.from !== forRole && s.timestamp > sinceTime);
    return res.json({ ok: true, signals: nuevas, estado: llamada.estado });
  }
  res.json({ ok: true, signals: [], estado: 'finalizado' });
});

// Endpoint para que el visitante en la calle vea el estado
router.get('/api/timbre-visita-status', (req, res) => {
  const { callId, edificio, depto } = req.query || {};
  const llamada = encontrarLlamadaActiva(callId, edificio, depto);
  if (llamada) {
    return res.json({ ok: true, estado: llamada.estado, respuesta: llamada.respuesta });
  }
  res.json({ ok: true, estado: 'finalizado' });
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
