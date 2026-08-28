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
const path = require('path');
const fs = require('fs');
const multer = require('multer');

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
const CSS_VECINO = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;padding:0;width:100%;min-height:100vh;background:#F8FAFD}
body{color:#16233B;font-family:'Hanken Grotesk',system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button,input,textarea{font-family:inherit}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:10px}

/* Animaciones */
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes typingDot{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}

.anim-fade{animation:fadeIn .25s ease both}
.card{background:#fff;border:1px solid #E4E9F1;border-radius:16px;box-shadow:0 1px 3px rgba(16,35,59,.04)}
.card-touch:active{transform:scale(.985);transition:transform .1s ease}

/* Shell Contenedor de la App */
.app-shell{min-height:100vh;display:flex;flex-direction:column;width:100%;max-width:540px;margin:0 auto;background:#F8FAFD}

/* Barra de Navegacion Inferior para Celulares */
.v-bottom-nav{
  position:fixed;bottom:0;left:0;right:0;height:64px;background:#ffffff;
  border-top:1px solid #E2E8F0;display:flex;justify-content:space-around;align-items:center;
  z-index:50;box-shadow:0 -4px 20px rgba(16,35,59,.08);padding:0 6px;
}
.v-bottom-nav a{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  flex:1;height:100%;color:#64748B;font-size:11px;font-weight:700;gap:3px;
}
.v-bottom-nav a.active{color:#1E5FB4}
.v-bottom-nav a .nav-icon{font-size:20px;line-height:1}

@media (min-width: 601px){
  body{background:#EEF1F6}
  .app-shell{box-shadow:0 0 40px rgba(0,0,0,.08)}
  .v-bottom-nav{left:50%;transform:translateX(-50%);max-width:540px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0}
}
@media (max-width: 600px){
  .app-shell{max-width:100%!important;width:100%!important}
  main{padding:14px 14px 85px!important}
}

/* Burbujas de Chat con Marcos IA */
.chat-bubble-marcos{
  background:#ffffff;border:1px solid #E2E8F0;border-radius:16px 16px 16px 4px;
  padding:12px 15px;max-width:86%;box-shadow:0 1px 2px rgba(16,35,59,.05);color:#16233B;font-size:14.5px;line-height:1.45;
}
.chat-bubble-user{
  background:linear-gradient(135deg,#17408B,#2E6FC0);color:#ffffff;
  border-radius:16px 16px 4px 16px;padding:12px 15px;max-width:86%;
  margin-left:auto;font-size:14.5px;line-height:1.45;box-shadow:0 2px 8px rgba(23,64,139,.25);
}

.typing-indicator{
  display:inline-flex;gap:4px;padding:8px 12px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;
}
.typing-dot{
  width:6px;height:6px;background:#1E5FB4;border-radius:50%;animation:typingDot 1.4s infinite ease-in-out both;
}
.typing-dot:nth-child(1){animation-delay:-0.32s}
.typing-dot:nth-child(2){animation-delay:-0.16s}

/* Modo Oscuro */
.dark-theme{background:#0B132B!important;color:#F1F5F9!important}
.dark-theme .app-shell{background:#0B132B!important}
.dark-theme .card{background:#151F38!important;border-color:#2A3A5E!important}
.dark-theme .v-bottom-nav{background:#151F38!important;border-top-color:#2A3A5E!important}
.dark-theme .v-bottom-nav a{color:#94A3B8!important}
.dark-theme .v-bottom-nav a.active{color:#38BDF8!important}
.dark-theme .chat-bubble-marcos{background:#1E2B4B!important;border-color:#2A3A5E!important;color:#F1F5F9!important}
`;

function getVecinoSession(req) {
  if (req.session && req.session.vecino) {
    return req.session.vecino;
  }
  // Default de prueba
  return {
    nombre: 'Daniel Morales',
    telefono: '+54 9 11 5555-4321',
    edificio: 'San Patricio 159',
    departamento: '1° A',
    saldoExpensa: '$120.000,00',
    estadoExpensa: 'Al día',
  };
}

function shellVecino(title, activeTab, content, vecinoData) {
  const v = vecinoData || {
    nombre: 'Daniel Morales',
    edificio: 'San Patricio 159',
    departamento: '1° A',
  };

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
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/fill/style.css"/>
<style>${CSS_VECINO}</style>
<script>
  (function(){
    if(localStorage.getItem('marcos_theme')==='dark'){
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
    var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone && !localStorage.getItem('pwa_banner_closed')) {
      var b = document.getElementById('pwa-install-banner');
      if (b) b.style.display = 'flex';
    }
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function(e){ console.warn('SW:', e); });
    });
  }
</script>
</head>
<body>
<div class="app-shell">
  
  <!-- TOPBAR VECINO -->
  <header style="height:60px;background:#ffffff;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;padding:0 16px;position:sticky;top:0;z-index:40">
    <div style="display:flex;align-items:center;gap:10px">
      <img src="/admin/assets/logo.png" alt="Marcos IA" style="width:32px;height:32px;border-radius:8px;object-fit:cover" onerror="this.style.display='none'">
      <div>
        <div style="font-size:15px;font-weight:800;color:#0F326A;line-height:1.1">Marcos IA</div>
        <div style="font-size:11px;font-weight:700;color:#64748B">${v.edificio} · ${v.departamento}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <button onclick="toggleTheme()" style="width:36px;height:36px;border-radius:10px;border:1px solid #E2E8F0;background:#F8FAFD;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#64748B">
        <i class="ph ph-moon" style="font-size:18px"></i>
      </button>
      <a href="/vecino/login" title="Cerrar sesión" style="width:36px;height:36px;border-radius:10px;border:1px solid #E2E8F0;background:#F1F5FB;display:flex;align-items:center;justify-content:center;color:#1E5FB4;font-weight:800;font-size:13px">
        ${v.nombre.split(' ').map(n=>n[0]).slice(0,2).join('')}
      </a>
    </div>
  </header>

  <!-- CONTENIDO PRINCIPAL -->
  <main style="flex:1;padding:16px 16px 85px" class="anim-fade">
    <!-- PWA INSTALL BANNER DISCRETO -->
    <div id="pwa-install-banner" style="display:none;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;border-radius:14px;padding:12px 14px;margin-bottom:14px;box-shadow:0 4px 14px rgba(15,50,106,.22);align-items:center;justify-content:space-between;gap:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
          📲
        </div>
        <div>
          <div style="font-size:13px;font-weight:800;line-height:1.2">Instalar App del Edificio</div>
          <div style="font-size:11px;color:rgba(255,255,255,.8)">Acceso directo y llamadas de timbre</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="instalarPwa()" style="padding:6px 12px;border:none;border-radius:8px;background:#fff;color:#0F326A;font-weight:800;font-size:12px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.1)">Instalar</button>
        <button onclick="cerrarBannerPwa()" style="background:none;border:none;color:rgba(255,255,255,.7);font-size:16px;cursor:pointer;padding:4px">✕</button>
      </div>
    </div>

    ${content}
  </main>

  <!-- BARRA DE NAVEGACION INFERIOR -->
  <nav class="v-bottom-nav">
    <a href="/vecino" class="${activeTab === 'inicio' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-house${activeTab === 'inicio' ? '-fill' : ''}"></i></span>
      <span>Inicio</span>
    </a>
    <a href="/vecino/chat" class="${activeTab === 'chat' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-chat-circle-dots${activeTab === 'chat' ? '-fill' : ''}"></i></span>
      <span>Marcos IA</span>
    </a>
    <a href="/vecino/amenities" class="${activeTab === 'amenities' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-calendar-check${activeTab === 'amenities' ? '-fill' : ''}"></i></span>
      <span>Amenities</span>
    </a>
    <a href="/vecino/expensas" class="${activeTab === 'expensas' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-receipt${activeTab === 'expensas' ? '-fill' : ''}"></i></span>
      <span>Expensas</span>
    </a>
    <a href="/vecino/novedades" class="${activeTab === 'novedades' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-bell${activeTab === 'novedades' ? '-fill' : ''}"></i></span>
      <span>Avisos</span>
    </a>
  </nav>

  <!-- MODAL LLAMADA ENTRANTE DE PORTERÍA (TIMBRE VIRTUAL & VOZ WEBRTC) -->
  <audio id="audio-webrtc-vecino" autoplay playsinline style="display:none"></audio>
  <div id="modal-llamada-timbre" style="position:fixed;inset:0;background:rgba(10,31,68,.96);backdrop-filter:blur(12px);z-index:9999;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:#fff;text-align:center">
    
    <!-- 1. Estado: Sonando Timbre -->
    <div id="box-timbre-sonando" style="display:flex;flex-direction:column;align-items:center;width:100%;max-width:340px">
      <div style="width:90px;height:90px;border-radius:50%;background:linear-gradient(135deg,#1E5FB4,#38BDF8);display:flex;align-items:center;justify-content:center;font-size:44px;margin-bottom:18px;box-shadow:0 0 40px rgba(56,189,248,.6);animation:pulseRing 1.2s infinite">
        🔔
      </div>
      <div style="font-size:12.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#38BDF8;margin-bottom:4px">Llamada de Portería</div>
      <h2 style="font-size:22px;font-weight:900;margin-bottom:4px" id="llamada-timbre-visita">🛵 Delivery en Puerta</h2>
      <p style="font-size:13.5px;color:#CBD5E1;margin-bottom:20px">Tocando timbre para tu unidad (${v.departamento})</p>

      <!-- Botón Hablar en Vivo -->
      <button onclick="iniciarLlamadaVozVecino()" style="width:100%;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 4px 18px rgba(22,163,74,.45);margin-bottom:14px">
        <i class="ph ph-phone-call-fill" style="font-size:22px"></i>
        <span>HABLAR EN VIVO (Llamada)</span>
      </button>

      <div style="font-size:12px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">O responder con 1 toque:</div>

      <!-- Respuestas Rápidas de Texto -->
      <div style="display:flex;flex-direction:column;gap:8px;width:100%;margin-bottom:16px">
        <button onclick="responderTimbreVecino('¡Ya bajo!')" style="width:100%;height:44px;border:1.5px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font-size:14.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🏃 ¡Ya bajo!</span>
        </button>
        <button onclick="responderTimbreVecino('Dejalo en el hall / puerta')" style="width:100%;height:44px;border:1.5px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font-size:14.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🚪 Dejalo en el hall</span>
        </button>
        <button onclick="responderTimbreVecino('Dejar con el encargado')" style="width:100%;height:44px;border:1.5px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font-size:14.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>📬 Dejar con el encargado</span>
        </button>
      </div>

      <button onclick="silenciarTimbreVecino()" style="background:transparent;border:none;color:#94A3B8;font-size:13px;font-weight:700;cursor:pointer;padding:6px 12px">
        ✕ Silenciar timbre
      </button>
    </div>

    <!-- 2. Estado: En Llamada de Voz Activa -->
    <div id="box-llamada-voz-activa" style="display:none;flex-direction:column;align-items:center;width:100%;max-width:340px">
      <div style="width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,#15803D,#16A34A);display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:16px;box-shadow:0 0 35px rgba(22,163,74,.5)">
        🎙️
      </div>
      <div style="font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#86EFAC;margin-bottom:2px">Llamada de Voz Conectada</div>
      <h2 style="font-size:20px;font-weight:900;margin-bottom:4px">Puerta de Calle</h2>
      <div id="voz-timer" style="font-size:18px;font-family:monospace;font-weight:700;color:#38BDF8;margin-bottom:20px">00:00</div>

      <div style="display:flex;gap:12px;margin-bottom:20px;width:100%">
        <button id="btn-mute-voz" onclick="toggleMuteVoz()" style="flex:1;height:48px;border-radius:12px;border:1.5px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🎙️ Silenciar Mic</span>
        </button>
        <button onclick="responderTimbreVecino('¡Ya bajo!')" style="flex:1;height:48px;border-radius:12px;border:none;background:#2563EB;color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🏃 ¡Ya bajo!</span>
        </button>
      </div>

      <button onclick="cortarLlamadaVoz()" style="width:100%;height:50px;border:none;border-radius:14px;background:#DC2626;color:#fff;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 15px rgba(220,38,38,.4)">
        <i class="ph ph-phone-disconnect-fill" style="font-size:20px"></i>
        <span>FINALIZAR LLAMADA</span>
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
    var _isMuted = false;

    function sonarRingtone() {
      try {
        if (!_audioCtx) {
          _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') {
          _audioCtx.resume();
        }
        var osc = _audioCtx.createOscillator();
        var gain = _audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, _audioCtx.currentTime);
        osc.frequency.setValueAtTime(659.25, _audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, _audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(_audioCtx.destination);
        osc.start();
        osc.stop(_audioCtx.currentTime + 0.6);

        if (navigator.vibrate) {
          navigator.vibrate([300, 150, 300, 150, 500]);
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
      cortarLlamadaVoz();
      document.getElementById('modal-llamada-timbre').style.display = 'none';
      try {
        await fetch('/porteria/api/timbre-responder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: _edificioVecino, depto: _deptoVecino, respuesta: resp })
        });
      } catch(_) {}
    };

    window.silenciarTimbreVecino = function() {
      detenerRingtoneLoop();
      cortarLlamadaVoz();
      document.getElementById('modal-llamada-timbre').style.display = 'none';
    };

    window.iniciarLlamadaVozVecino = async function() {
      detenerRingtoneLoop();
      document.getElementById('box-timbre-sonando').style.display = 'none';
      document.getElementById('box-llamada-voz-activa').style.display = 'flex';

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
        await fetch('/porteria/api/timbre-responder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: _edificioVecino, depto: _deptoVecino, modoVoz: true })
        });

        _localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _peerConn = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        _localStream.getTracks().forEach(function(track){
          _peerConn.addTrack(track, _localStream);
        });

        _peerConn.ontrack = function(event){
          var remoteAudio = document.getElementById('audio-webrtc-vecino');
          if (remoteAudio && event.streams[0]) {
            remoteAudio.srcObject = event.streams[0];
          }
        };

        _peerConn.onicecandidate = function(event){
          if (event.candidate) {
            fetch('/porteria/api/webrtc-signal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ edificio: _edificioVecino, depto: _deptoVecino, from: 'vecino', signal: { type: 'candidate', candidate: event.candidate } })
            });
          }
        };

        var offer = await _peerConn.createOffer();
        await _peerConn.setLocalDescription(offer);

        await fetch('/porteria/api/webrtc-signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: _edificioVecino, depto: _deptoVecino, from: 'vecino', signal: { type: 'offer', sdp: offer } })
        });

        // Polling de señales de respuesta desde la visita
        var lastSince = Date.now() - 5000;
        var sigInterval = setInterval(async function(){
          if (!_peerConn) { clearInterval(sigInterval); return; }
          try {
            var sRes = await fetch('/porteria/api/webrtc-signal?edificio=' + encodeURIComponent(_edificioVecino) + '&depto=' + encodeURIComponent(_deptoVecino) + '&forRole=vecino&since=' + lastSince);
            var sData = await sRes.json();
            if (sData && sData.signals && sData.signals.length) {
              for (var i = 0; i < sData.signals.length; i++) {
                var sigObj = sData.signals[i].signal;
                lastSince = Math.max(lastSince, sData.signals[i].timestamp);
                if (sigObj.type === 'answer' && _peerConn.signalingState !== 'stable') {
                  await _peerConn.setRemoteDescription(new RTCSessionDescription(sigObj.sdp));
                } else if (sigObj.type === 'candidate' && sigObj.candidate) {
                  await _peerConn.addIceCandidate(new RTCIceCandidate(sigObj.candidate));
                }
              }
            }
          } catch(_) {}
        }, 1000);

      } catch(err) {
        console.warn('Voz WebRTC:', err.message);
      }
    };

    window.toggleMuteVoz = function() {
      if (_localStream) {
        _isMuted = !_isMuted;
        _localStream.getAudioTracks().forEach(function(t){ t.enabled = !_isMuted; });
        var btn = document.getElementById('btn-mute-voz');
        if (btn) btn.innerHTML = _isMuted ? '<span>🔇 Mic Silenciado</span>' : '<span>🎙️ Silenciar Mic</span>';
      }
    };

    window.cortarLlamadaVoz = function() {
      clearInterval(_timerInterval);
      if (_peerConn) {
        _peerConn.close();
        _peerConn = null;
      }
      if (_localStream) {
        _localStream.getTracks().forEach(function(t){ t.stop(); });
        _localStream = null;
      }
      document.getElementById('box-timbre-sonando').style.display = 'flex';
      document.getElementById('box-llamada-voz-activa').style.display = 'none';
      document.getElementById('modal-llamada-timbre').style.display = 'none';
    };

    // Polling de timbres entrantes cada 2.5 seg
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
    }, 2500);
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
    <div style="background:#fff;border-radius:22px 22px 18px 18px;width:100%;max-width:480px;padding:24px 20px;text-align:center;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:fadeIn .25s ease both;color:#16233B">
      <div style="width:52px;height:52px;border-radius:14px;background:#EBF3FC;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px">
        📲
      </div>
      <h3 style="font-size:18px;font-weight:800;color:#0F326A;margin-bottom:6px">Instalar en iPhone (iOS)</h3>
      <p style="font-size:13px;color:#64748B;margin-bottom:16px;line-height:1.4">Tené la app en tu pantalla de inicio en 3 simples pasos desde Safari:</p>
      
      <div style="display:flex;flex-direction:column;gap:10px;text-align:left;background:#F8FAFD;border:1px solid #E2E8F0;border-radius:14px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:#334259">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">1</span>
          <span>Tocá el botón <strong>Compartir <i class="ph ph-share-network" style="font-size:16px;vertical-align:middle;color:#1E5FB4"></i></strong> en la barra inferior de Safari.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">2</span>
          <span>Deslizá hacia abajo y elegí <strong>"Agregar a inicio" <i class="ph ph-plus-square" style="font-size:16px;vertical-align:middle;color:#1E5FB4"></i></strong>.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">3</span>
          <span>Tocá <strong>"Agregar"</strong> arriba a la derecha. ¡Listo!</span>
        </div>
      </div>

      <button onclick="document.getElementById('modal-pwa-ios').style.display='none'" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer">¡Entendido!</button>
    </div>
  </div>

  <!-- MODAL GUÍA DE INSTALACIÓN ANDROID / CHROME -->
  <div id="modal-pwa-android" style="position:fixed;inset:0;background:rgba(10,31,68,.85);backdrop-filter:blur(8px);z-index:99999;display:none;align-items:flex-end;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:22px 22px 18px 18px;width:100%;max-width:480px;padding:24px 20px;text-align:center;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:fadeIn .25s ease both;color:#16233B">
      <div style="width:52px;height:52px;border-radius:14px;background:#EBF3FC;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px">
        📲
      </div>
      <h3 style="font-size:18px;font-weight:800;color:#0F326A;margin-bottom:6px">Instalar en Android (Chrome / Edge)</h3>
      <p style="font-size:13px;color:#64748B;margin-bottom:16px;line-height:1.4">Seguí estos 2 simples pasos en tu navegador:</p>
      
      <div style="display:flex;flex-direction:column;gap:10px;text-align:left;background:#F8FAFD;border:1px solid #E2E8F0;border-radius:14px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:#334259">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">1</span>
          <span>Tocá el menú de <strong>3 puntos (⋮)</strong> arriba a la derecha en Chrome.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">2</span>
          <span>Seleccioná <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.</span>
        </div>
      </div>

      <button onclick="document.getElementById('modal-pwa-android').style.display='none'" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer">¡Entendido!</button>
    </div>
  </div>

</div>
</body>
</html>`;
}

// -------------------------------------------------------------------
// 1. LOGIN CON CREDENCIALES
// -------------------------------------------------------------------
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
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0F326A;background:linear-gradient(165deg,#0A1F44 0%,#0F326A 45%,#1B4D9B 100%);color:#fff;font-family:'Hanken Grotesk',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:#ffffff;color:#16233B;border-radius:24px;padding:32px 26px;width:100%;max-width:400px;box-shadow:0 25px 60px rgba(0,0,0,.35)}
.inp{width:100%;height:48px;border:1.5px solid #DDE3EE;border-radius:12px;padding:0 14px;font-size:15px;color:#16233B;background:#F8FAFD;outline:none;margin-bottom:14px}
.inp:focus{border-color:#2E6FC0;background:#fff;box-shadow:0 0 0 4px rgba(46,111,192,.12)}
.btn-login{width:100%;height:48px;border:none;border-radius:12px;background:linear-gradient(135deg,#17408B,#2E6FC0);color:#fff;font-size:15.5px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 14px rgba(23,64,139,.35)}
.btn-pwa{width:100%;height:44px;border:1.5px solid #BFDBFE;border-radius:12px;background:#EFF6FF;color:#1E5FB4;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;box-shadow:0 2px 8px rgba(30,95,180,.1)}
</style>
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function(e){ console.warn('SW:', e); });
    });
  }
</script>
</head>
<body>
<div class="login-card">
  <div style="text-align:center;margin-bottom:20px">
    <div style="width:58px;height:58px;border-radius:16px;background:linear-gradient(135deg,#0F326A,#2E6FC0);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:28px;margin-bottom:12px;box-shadow:0 8px 20px rgba(15,50,106,.25)">
      🏢
    </div>
    <h1 style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px;color:#0F326A">Portal del Vecino</h1>
    <p style="font-size:13.5px;color:#64748B">Ingresá a tu edificio o instalá la app</p>
  </div>

  <!-- Botón Instalar PWA directo en Login -->
  <button type="button" class="btn-pwa" onclick="instalarPwaLogin()">
    <span>📲 Instalar App en mi Celular</span>
  </button>

  <form action="/vecino/auth" method="POST">
    <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:6px">Email o Teléfono WhatsApp</div>
    <input name="identificador" class="inp" type="text" placeholder="ejemplo@correo.com o +54 9 11..." value="demo@edificio.com" required>

    <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:6px">Contraseña o Código de Unidad</div>
    <input name="password" class="inp" type="password" placeholder="Tu contraseña" value="123456" required>

    <button type="submit" class="btn-login">
      <span>Ingresar a mi Edificio</span>
      <i class="ph ph-arrow-right" style="font-size:18px"></i>
    </button>
  </form>

  <div style="margin-top:20px;text-align:center;font-size:12.5px;color:#64748B">
    ¿Primer ingreso? Podés tocar <strong>Ingresar a mi Edificio</strong> para acceder en modo demo.
  </div>
</div>

<!-- MODAL GUÍA DE INSTALACIÓN IOS / SAFARI -->
<div id="modal-pwa-ios" style="position:fixed;inset:0;background:rgba(10,31,68,.85);backdrop-filter:blur(8px);z-index:99999;display:none;align-items:flex-end;justify-content:center;padding:16px">
  <div style="background:#fff;border-radius:22px 22px 18px 18px;width:100%;max-width:480px;padding:24px 20px;text-align:center;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:fadeIn .25s ease both;color:#16233B">
    <div style="width:52px;height:52px;border-radius:14px;background:#EBF3FC;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px">
      📲
    </div>
    <h3 style="font-size:18px;font-weight:800;color:#0F326A;margin-bottom:6px">Instalar en iPhone (iOS)</h3>
    <p style="font-size:13px;color:#64748B;margin-bottom:16px;line-height:1.4">Tené la app en tu pantalla de inicio en 3 simples pasos desde Safari:</p>
    
    <div style="display:flex;flex-direction:column;gap:10px;text-align:left;background:#F8FAFD;border:1px solid #E2E8F0;border-radius:14px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:#334259">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">1</span>
        <span>Tocá el botón <strong>Compartir <i class="ph ph-share-network" style="font-size:16px;vertical-align:middle;color:#1E5FB4"></i></strong> en la barra inferior de Safari.</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">2</span>
        <span>Deslizá hacia abajo y elegí <strong>"Agregar a inicio" <i class="ph ph-plus-square" style="font-size:16px;vertical-align:middle;color:#1E5FB4"></i></strong>.</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">3</span>
        <span>Tocá <strong>"Agregar"</strong> arriba a la derecha. ¡Listo!</span>
      </div>
    </div>

    <button onclick="document.getElementById('modal-pwa-ios').style.display='none'" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer">¡Entendido!</button>
  </div>
</div>

<script>
  var _deferredPromptLogin = null;
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    _deferredPromptLogin = e;
  });

  function instalarPwaLogin() {
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

    if (window._deferredPromptLogin) {
      window._deferredPromptLogin.prompt();
      window._deferredPromptLogin = null;
    } else {
      var mAnd = document.getElementById('modal-pwa-android-login');
      if (mAnd) mAnd.style.display = 'flex';
    }
  }
</script>

<!-- MODAL GUÍA DE INSTALACIÓN ANDROID / CHROME -->
<div id="modal-pwa-android-login" style="position:fixed;inset:0;background:rgba(10,31,68,.85);backdrop-filter:blur(8px);z-index:99999;display:none;align-items:flex-end;justify-content:center;padding:16px">
  <div style="background:#fff;border-radius:22px 22px 18px 18px;width:100%;max-width:480px;padding:24px 20px;text-align:center;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:fadeIn .25s ease both;color:#16233B">
    <div style="width:52px;height:52px;border-radius:14px;background:#EBF3FC;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px">
      📲
    </div>
    <h3 style="font-size:18px;font-weight:800;color:#0F326A;margin-bottom:6px">Instalar en Android (Chrome / Edge)</h3>
    <p style="font-size:13px;color:#64748B;margin-bottom:16px;line-height:1.4">Seguí estos 2 simples pasos en tu navegador:</p>
    
    <div style="display:flex;flex-direction:column;gap:10px;text-align:left;background:#F8FAFD;border:1px solid #E2E8F0;border-radius:14px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:#334259">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">1</span>
        <span>Tocá el menú de <strong>3 puntos (⋮)</strong> arriba a la derecha en Chrome.</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:24px;height:24px;border-radius:50%;background:#1E5FB4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">2</span>
        <span>Seleccioná <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.</span>
      </div>
    </div>

    <button onclick="document.getElementById('modal-pwa-android-login').style.display='none'" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer">¡Entendido!</button>
  </div>
</div>
</body>
</html>`);
});

router.post('/auth', async (req, res) => {
  const { identificador } = req.body || {};
  const limpio = String(identificador || '').trim();
  const telLimpio = limpio.replace(/\D/g, '');

  let vecinoEncontrado = null;

  // 1. Buscar por teléfono en datos-pg
  if (telLimpio.length >= 6 && datosPg && typeof datosPg.buscarVecinosPorTelefono === 'function') {
    try {
      const vecList = await datosPg.buscarVecinosPorTelefono(telLimpio);
      if (vecList && vecList.length > 0) {
        vecinoEncontrado = vecList[0];
      }
    } catch (_) {}
  }

  // 2. Si no encontró por teléfono, buscar en la base de datos PostgreSQL
  if (!vecinoEncontrado && limpio) {
    try {
      const { pool } = require('./db-pg');
      const q = `SELECT * FROM vecinos WHERE LOWER(telefono) LIKE LOWER($1) OR LOWER(nombre) LIKE LOWER($1) LIMIT 1`;
      const result = await pool.query(q, ['%' + limpio + '%']);
      if (result.rows && result.rows.length > 0) {
        const r = result.rows[0];
        vecinoEncontrado = {
          nombre: r.nombre || 'Vecino',
          telefono: r.telefono || limpio,
          edificio: r.edificio || 'Consorcio',
          departamento: r.departamento || 'Unidad',
        };
      }
    } catch (_) {}
  }

  // 3. Guardar en la sesión
  if (req.session) {
    if (vecinoEncontrado) {
      req.session.vecino = {
        nombre: vecinoEncontrado.nombre,
        telefono: vecinoEncontrado.telefono,
        edificio: vecinoEncontrado.edificio,
        departamento: vecinoEncontrado.departamento,
        saldoExpensa: '$120.000,00',
        estadoExpensa: 'Al día',
      };
    } else {
      req.session.vecino = {
        nombre: limpio.includes('@') ? limpio.split('@')[0] : (limpio || 'Daniel Morales'),
        telefono: telLimpio || '+54 9 11 5555-4321',
        edificio: 'San Patricio 159',
        departamento: '1° A',
        saldoExpensa: '$120.000,00',
        estadoExpensa: 'Al día',
      };
    }
  }
  res.redirect('/vecino');
});

// -------------------------------------------------------------------
// 2. INICIO / DASHBOARD DEL VECINO
// -------------------------------------------------------------------
router.get('/', (req, res) => {
  const v = getVecinoSession(req);

  const content = `
    <!-- Tarjeta de Bienvenida -->
    <div class="card" style="padding:18px 20px;margin-bottom:16px;background:linear-gradient(145deg,#0F326A,#1E5FB4);color:#fff;border:none">
      <div>
        <span style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.7)">CONSORCIO DIGITAL</span>
        <h2 style="font-size:20px;font-weight:800;margin:2px 0 4px">Hola, ${v.nombre.split(' ')[0]} 👋</h2>
        <p style="font-size:13px;color:rgba(255,255,255,.85)">${v.edificio} · Depto ${v.departamento}</p>
      </div>
    </div>

    <!-- Estado de Expensas Destacado -->
    <div class="card" style="padding:18px 20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:12px;font-weight:800;color:#64748B;text-transform:uppercase">Expensa del Mes (Agosto)</span>
        <span style="font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:999px;background:#DCFCE7;color:#15803D;border:1px solid #86EFAC">
          ✓ ${v.estadoExpensa}
        </span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
        <div>
          <div style="font-size:26px;font-weight:800;color:#0F172A;letter-spacing:-.02em">${v.saldoExpensa}</div>
          <div style="font-size:12px;color:#64748B">Vencimiento: 10 de Agosto · Acreditado</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <a href="/vecino/expensas" style="flex:1;height:40px;border-radius:10px;background:#F1F5FB;color:#1E5FB4;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">
          <i class="ph ph-receipt" style="font-size:16px"></i>
          <span>Ver Recibo</span>
        </a>
      </div>
    </div>

    <!-- Acceso Rápido al Asistente Marcos IA -->
    <div class="card card-touch" style="padding:16px 18px;margin-bottom:16px;background:#ffffff;border-left:4px solid #2E6FC0;cursor:pointer" onclick="location.href='/vecino/chat'">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:#EBF3FC;display:flex;align-items:center;justify-content:center;font-size:22px;color:#1E5FB4;flex-shrink:0">
          🤖
        </div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:800;color:#0F326A">Asistente Marcos IA (24/7)</div>
          <div style="font-size:12.5px;color:#64748B">Reportá reclamos, pedí plomero o consultá reglamentos.</div>
        </div>
        <i class="ph ph-caret-right" style="font-size:18px;color:#94A3B8"></i>
      </div>
    </div>

    <!-- Acceso Directo Instalar App en Celular -->
    <div class="card card-touch" style="padding:14px 16px;margin-bottom:16px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 14px rgba(15,50,106,.2)" onclick="instalarPwa()">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          📲
        </div>
        <div>
          <div style="font-size:14px;font-weight:800;line-height:1.2">Instalar App en el Celular</div>
          <div style="font-size:11.5px;color:rgba(255,255,255,.85)">Acceso rápido sin abrir el navegador</div>
        </div>
      </div>
      <button style="padding:6px 14px;border:none;border-radius:8px;background:#fff;color:#0F326A;font-weight:800;font-size:12.5px;cursor:pointer;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.15)">Instalar</button>
    </div>

    <!-- Últimas Novedades del Edificio -->
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13.5px;font-weight:800;color:#0F172A">Novedades del Consorcio</span>
      <a href="/vecino/novedades" style="font-size:12.5px;font-weight:700;color:#1E5FB4">Ver todas</a>
    </div>

    <div class="card" style="padding:15px 18px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#FEF3C7;color:#92400E">Mantenimiento</span>
        <span style="font-size:11.5px;color:#94A3B8">Hoy · 09:30 hs</span>
      </div>
      <div style="font-size:14.5px;font-weight:700;color:#0F172A;margin-bottom:4px">Limpieza de tanques de agua</div>
      <div style="font-size:13px;color:#64748B;line-height:1.4">Se realizará el jueves de 08:00 a 14:00 hs. Habrá baja presión de agua.</div>
    </div>
  `;

  res.send(shellVecino('Inicio', 'inicio', content, v));
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
    orientation: 'portrait-primary',
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
    const CACHE_NAME = 'marcos-pwa-v1';
    const ASSETS = [
      '/vecino',
      '/admin/assets/logo.png',
      'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap',
      'https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css',
      'https://unpkg.com/@phosphor-icons/web@2.0.3/src/fill/style.css'
    ];

    self.addEventListener('install', (e) => {
      e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
          return cache.addAll(ASSETS).catch(() => {});
        })
      );
      self.skipWaiting();
    });

    self.addEventListener('activate', (e) => {
      e.waitUntil(
        caches.keys().then((keys) => {
          return Promise.all(
            keys.map((k) => {
              if (k !== CACHE_NAME) return caches.delete(k);
            })
          );
        })
      );
      self.clients.claim();
    });

    self.addEventListener('fetch', (e) => {
      if (e.request.method !== 'GET') return;
      e.respondWith(
        fetch(e.request).catch(() => {
          return caches.match(e.request);
        })
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
          <div style="width:40px;height:40px;border-radius:12px;background:#EBF3FC;display:flex;align-items:center;justify-content:center;font-size:20px">🤖</div>
          <div style="position:absolute;bottom:-2px;right:-2px;width:11px;height:11px;border-radius:50%;background:#16A34A;border:2px solid #fff"></div>
        </div>
        <div>
          <div style="font-size:14.5px;font-weight:800;color:#0F326A">Marcos IA en Línea</div>
          <div style="font-size:11.5px;color:#16A34A;font-weight:700">Atención 24/7 activa</div>
        </div>
      </div>
      <a href="https://wa.me/5491100000000" target="_blank" style="padding:6px 12px;border-radius:8px;background:#DCFCE7;color:#15803D;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px">
        <i class="ph ph-whatsapp-logo" style="font-size:15px"></i>
        <span>WhatsApp</span>
      </a>
    </div>

    <!-- Muro de Mensajes -->
    <div id="chat-stream" style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;min-height:320px">
      <div class="chat-bubble-marcos">
        ¡Hola ${v.nombre.split(' ')[0]}! Soy <strong>Marcos IA</strong>, el asistente de <strong>${v.edificio}</strong>. ¿En qué te puedo ayudar hoy? Podés consultarme sobre expensas, reportar una rotura o pedir datos del edificio.
      </div>
    </div>

    <!-- Sugerencias Rápidas -->
    <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;margin-bottom:10px">
      <button onclick="enviarSugerencia('¿Cuándo vencen las expensas?')" style="white-space:nowrap;padding:7px 12px;border-radius:999px;border:1px solid #CBD5E1;background:#fff;font-size:12px;font-weight:700;color:#475569;cursor:pointer">
        💳 ¿Cuándo vencen expensas?
      </button>
      <button onclick="enviarSugerencia('Reportar fuga de agua en el baño')" style="white-space:nowrap;padding:7px 12px;border-radius:999px;border:1px solid #CBD5E1;background:#fff;font-size:12px;font-weight:700;color:#475569;cursor:pointer">
        🔧 Reportar fuga de agua
      </button>
      <button onclick="enviarSugerencia('Horario y reglamento del SUM')" style="white-space:nowrap;padding:7px 12px;border-radius:999px;border:1px solid #CBD5E1;background:#fff;font-size:12px;font-weight:700;color:#475569;cursor:pointer">
        🎉 Horario del SUM
      </button>
    </div>

    <!-- Input Bar Fijo -->
    <div class="card" style="padding:8px 10px;display:flex;align-items:center;gap:8px">
      <button onclick="alert('Podés adjuntar fotos de desperfectos o comprobantes')" style="width:38px;height:38px;border-radius:10px;border:none;background:#F1F5F9;color:#64748B;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <i class="ph ph-camera" style="font-size:20px"></i>
      </button>
      <input id="chat-input" type="text" placeholder="Escribile a Marcos IA..." style="flex:1;height:40px;border:none;outline:none;font-size:14.5px;color:#0F172A" onkeypress="if(event.key==='Enter')enviarMensaje()">
      <button onclick="enviarMensaje()" style="width:40px;height:40px;border-radius:10px;border:none;background:#1E5FB4;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center">
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

    let respuestaTexto = `Entendido ${v.nombre.split(' ')[0]}. Estoy procesando tu consulta para ${v.edificio} (${v.departamento}).`;

    // Si el módulo de Marcos IA está disponible, responder contextualmente
    if (marcosCara && typeof marcosCara.responderVecino === 'function') {
      try {
        const resp = await marcosCara.responderVecino({
          historial: [{ rol: 'vecino', texto: mensaje }],
          vecino: { nombre: v.nombre, telefono: v.telefono, edificio: v.edificio, departamento: v.departamento },
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
router.get('/expensas', async (req, res) => {
  const v = getVecinoSession(req);

  let expensas = [];
  let datosBanco = null;

  // 1. Obtener expensas reales de la base de datos
  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const qExp = `SELECT * FROM expensas WHERE LOWER(edificio) = LOWER($1) AND estado != 'eliminada' ORDER BY id DESC`;
      const resExp = await pool.query(qExp, [v.edificio]);
      if (resExp && resExp.rows && resExp.rows.length > 0) {
        expensas = resExp.rows;
      }
    }
  } catch (_) {}

  // 2. Obtener datos bancarios del consorcio
  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const qEd = `SELECT cbu, alias, titular, banco, cuit FROM edificios WHERE LOWER(nombre) = LOWER($1) OR LOWER(consorcio) = LOWER($1) LIMIT 1`;
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
      <h2 style="font-size:20px;font-weight:800;color:#0F326A;margin-bottom:2px">Mis Expensas</h2>
      <p style="font-size:13px;color:#64748B">${v.edificio} · Unidad ${v.departamento}</p>
    </div>

    <!-- 1. Tarjeta Última Liquidación -->
    <div class="card" style="padding:20px;margin-bottom:16px;border-left:5px solid #2E6FC0;background:#fff">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <span style="font-size:11.5px;font-weight:800;color:#2E6FC0;text-transform:uppercase;letter-spacing:.05em">Liquidación del Mes</span>
        <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#EBF3FC;color:#1E5FB4">Digital</span>
      </div>
      <div style="font-size:22px;font-weight:800;color:#0F172A;margin-bottom:4px">
        ${ultimaExpensa ? (ultimaExpensa.periodo || 'Período Vigente') : 'Período en Proceso'}
      </div>
      <p style="font-size:13px;color:#64748B;line-height:1.45;margin-bottom:14px">
        ${ultimaExpensa ? 'La administración publicó el resumen de expensas correspondiente a este período.' : 'La administración publicará la liquidación digital de este mes a la brevedad.'}
      </p>
      ${ultimaExpensa && (ultimaExpensa.url || ultimaExpensa.nombre) ? `
      <a href="${ultimaExpensa.url || ('/archivos/facturas/' + ultimaExpensa.nombre)}" target="_blank" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:linear-gradient(180deg,#2E6FC0,#1E5FB4);color:#fff;font-weight:700;font-size:13.5px;box-shadow:0 3px 10px rgba(46,111,192,.3)">
        <i class="ph ph-file-pdf" style="font-size:18px"></i>
        <span>Ver / Descargar Liquidación</span>
      </a>` : `
      <div style="font-size:12.5px;color:#8595AD;background:#F8FAFD;padding:8px 12px;border-radius:8px;border:1px dashed #DCE4F0">
        📄 Podés solicitar la copia por chat a Marcos IA en cualquier momento.
      </div>`}
    </div>

    <!-- 2. Datos Bancarios del Consorcio -->
    <div class="card" style="padding:18px 20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:20px">🏦</span>
        <div>
          <div style="font-size:15px;font-weight:800;color:#0F172A">Datos para Transferencias</div>
          <div style="font-size:11.5px;color:#64748B">Cuenta oficial del consorcio</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${datosBanco.titular ? `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #F1F5F9;padding-bottom:6px">
          <span style="color:#64748B">Titular:</span>
          <strong style="color:#0F172A">${datosBanco.titular}</strong>
        </div>` : ''}
        ${datosBanco.banco ? `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #F1F5F9;padding-bottom:6px">
          <span style="color:#64748B">Banco:</span>
          <strong style="color:#0F172A">${datosBanco.banco}</strong>
        </div>` : ''}
        ${datosBanco.cuit ? `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #F1F5F9;padding-bottom:6px">
          <span style="color:#64748B">CUIT:</span>
          <strong style="color:#0F172A">${datosBanco.cuit}</strong>
        </div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #F1F5F9;padding-bottom:6px">
          <div>
            <span style="color:#64748B;display:block;font-size:11.5px">Alias:</span>
            <strong style="color:#1E5FB4;font-size:14px">${datosBanco.alias || '—'}</strong>
          </div>
          ${datosBanco.alias ? `<button onclick="copiarTexto('${datosBanco.alias}', this)" style="padding:4px 10px;border-radius:6px;border:1px solid #CBD5E1;background:#F8FAFD;color:#1E5FB4;font-size:11.5px;font-weight:700;cursor:pointer">📋 Copiar</button>` : ''}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:2px">
          <div>
            <span style="color:#64748B;display:block;font-size:11.5px">CBU:</span>
            <strong style="color:#0F172A;font-size:13px;font-family:monospace">${datosBanco.cbu || '—'}</strong>
          </div>
          ${datosBanco.cbu ? `<button onclick="copiarTexto('${datosBanco.cbu}', this)" style="padding:4px 10px;border-radius:6px;border:1px solid #CBD5E1;background:#F8FAFD;color:#1E5FB4;font-size:11.5px;font-weight:700;cursor:pointer">📋 Copiar</button>` : ''}
        </div>
      </div>
    </div>

    <!-- 3. Formulario Subir Comprobante de Pago -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;background:#FAFCFF;border:1.5px dashed #B8D5F8">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:20px">📤</span>
        <div>
          <div style="font-size:15px;font-weight:800;color:#0F172A">Informar Pago / Subir Comprobante</div>
          <div style="font-size:11.5px;color:#64748B">Adjuntá tu transferencia bancaria</div>
        </div>
      </div>

      <form id="form-comprobante" onsubmit="enviarComprobante(event)">
        <div style="margin-bottom:10px">
          <label style="font-size:12px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Captura o PDF de la Transferencia <span style="color:#EF4444">*</span></label>
          <input type="file" id="inp-comprobante-file" accept="image/*,.pdf" class="inp" style="padding:8px;background:#fff;margin-bottom:8px" required>
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Importe o Detalle (opcional)</label>
          <input type="text" id="inp-comprobante-monto" placeholder="Ej: $120.000 (Expensa Agosto)" class="inp" style="background:#fff;margin-bottom:0">
        </div>
        <button id="btn-comprobante" type="submit" style="width:100%;height:44px;border:none;border-radius:10px;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 3px 10px rgba(22,163,74,.25)">
          <i class="ph ph-check-circle" style="font-size:18px"></i>
          <span>Enviar Comprobante a la Administración</span>
        </button>
        <div id="comprobante-msg" style="display:none;margin-top:10px;padding:10px;border-radius:8px;font-size:12.5px;text-align:center"></div>
      </form>
    </div>

    <!-- 4. Historial Completo de Liquidaciones Anteriores -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">📚</span>
          <div>
            <div style="font-size:15px;font-weight:800;color:#0F172A">Historial de Liquidaciones (${expensas.length} períodos)</div>
            <div style="font-size:11.5px;color:#64748B">Descargá cualquier liquidación oficial de tu consorcio</div>
          </div>
        </div>
      </div>

      ${expensas.length > 0 ? `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${expensas.map((x, idx) => {
          const downloadUrl = x.url || ('/archivos/facturas/' + x.nombre);
          const isUltima = idx === 0;
          return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFD;gap:10px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:38px;height:38px;border-radius:10px;background:#FDECEC;color:#C0392B;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
                <i class="ph ph-file-pdf"></i>
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:14px;font-weight:800;color:#0F172A">${x.periodo || 'Período'}</span>
                  ${isUltima ? '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:#DCFCE7;color:#15803D">ÚLTIMO</span>' : ''}
                </div>
                <div style="font-size:11.5px;color:#64748B">${x.nombre || 'Liquidación de Expensas'}</div>
              </div>
            </div>
            ${downloadUrl ? `
            <a href="${downloadUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:8px;background:#fff;border:1px solid #CBD5E1;color:#1E5FB4;font-size:12.5px;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.04)">
              <i class="ph ph-download-simple" style="font-size:15px"></i>
              <span>Descargar PDF</span>
            </a>` : ''}
          </div>`;
        }).join('')}
      </div>` : `
      <div style="text-align:center;padding:24px 16px;color:#8595AD;font-size:13px;background:#F8FAFD;border-radius:12px;border:1px dashed #DCE4F0">
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
        btn.textContent = 'Enviando comprobante...';

        var formData = new FormData();
        formData.append('comprobante', fileInp.files[0]);
        formData.append('monto', montoInp.value.trim());

        try {
          var res = await fetch('/vecino/api/comprobante-pago', {
            method: 'POST',
            body: formData
          });
          var data = await res.json();
          if (data.ok) {
            msg.style.display = 'block';
            msg.style.background = '#DCFCE7';
            msg.style.color = '#15803D';
            msg.style.border = '1px solid #86EFAC';
            msg.textContent = data.mensaje || '¡Comprobante enviado con éxito!';
            fileInp.value = '';
            montoInp.value = '';
            btn.textContent = '✓ Enviado';
          } else {
            msg.style.display = 'block';
            msg.style.background = '#FEE2E2';
            msg.style.color = '#991B1B';
            msg.style.border = '1px solid #FCA5A5';
            msg.textContent = 'Error: ' + (data.error || 'No se pudo enviar el comprobante');
            btn.disabled = false;
            btn.textContent = 'Reintentar envío';
          }
        } catch (err) {
          msg.style.display = 'block';
          msg.style.background = '#FEE2E2';
          msg.style.color = '#991B1B';
          msg.style.border = '1px solid #FCA5A5';
          msg.textContent = 'Error de conexión al enviar el comprobante.';
          btn.disabled = false;
          btn.textContent = 'Reintentar envío';
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

    // Guardar en la base de datos PostgreSQL si está disponible
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        const q = `INSERT INTO facturas (edificio, tipo, proveedor, monto, fecha, url, estado, notas, created_at)
                   VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, NOW())`;
        await pool.query(q, [
          v.edificio,
          'comprobante_pago',
          v.nombre + ' (' + v.departamento + ')',
          monto || '0',
          archivoUrl,
          'pendiente_aprobacion',
          'Comprobante de transferencia subido por vecino ' + v.nombre + ' (' + v.departamento + ')'
        ]);
      }
    } catch (errDb) {
      console.warn('Registro comprobante:', errDb.message);
    }

    res.json({
      ok: true,
      mensaje: '¡Comprobante enviado con éxito! Tu administración lo revisará a la brevedad.',
      archivoUrl
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

  const content = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:800;color:#0F326A;margin-bottom:2px">Avisos del Edificio</h2>
      <p style="font-size:13px;color:#64748B">Comunicaciones oficiales en ${v.edificio}</p>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="card" style="padding:16px 18px;border-left:4px solid #F59E0B">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#FEF3C7;color:#92400E">Mantenimiento</span>
          <span style="font-size:11.5px;color:#94A3B8">Hoy · 09:30 hs</span>
        </div>
        <div style="font-size:15px;font-weight:800;color:#0F172A;margin-bottom:4px">Limpieza de tanques de agua</div>
        <p style="font-size:13.5px;color:#475569;line-height:1.45">
          Se realizará la limpieza semestral reglamentaria el jueves de 08:00 a 14:00 hs. Se sugiere almacenar agua para el consumo durante esa franja horaria.
        </p>
      </div>

      <div class="card" style="padding:16px 18px;border-left:4px solid #16A34A">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#DCFCE7;color:#15803D">Resuelto</span>
          <span style="font-size:11.5px;color:#94A3B8">Ayer</span>
        </div>
        <div style="font-size:15px;font-weight:800;color:#0F172A;margin-bottom:4px">Ascensor principal en servicio</div>
        <p style="font-size:13.5px;color:#475569;line-height:1.45">
          El técnico de guardia de ServiElev reemplazó el sensor de seguridad. Ambos ascensores se encuentran funcionando con normalidad.
        </p>
      </div>
    </div>
  `;

  res.send(shellVecino('Avisos', 'novedades', content, v));
});

// -------------------------------------------------------------------
// 6. RESERVA DE AMENITIES Y SUM
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// 6. RESERVA DE AMENITIES Y SUM (SELECTOR POR HORAS ESTILO CINE)
// -------------------------------------------------------------------
router.get('/amenities', async (req, res) => {
  const v = getVecinoSession(req);
  let misReservas = [];
  let todasReservasEdificio = [];
  let amenitiesList = [];

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
          hora_cierre: a.hora_cierre || '23:00'
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
          (r.nombre_vecino && r.nombre_vecino.toLowerCase() === v.nombre.toLowerCase())
        );
      }
    }
  } catch (errDb) {
    console.warn('Carga reservas amenities:', errDb.message);
  }

  // Si aún no se configuraron amenities en este edificio, usar catálogo estándar
  if (!amenitiesList.length) {
    amenitiesList = [
      { id: 'sum', nombre: 'SUM (Salón de Eventos)', icon: '🎉', desc: 'Capacidad 35 personas · Parrilla, vajilla, TV y aire frío/calor', reglamento: 'Música permitida hasta 01:00 hs. Seña de $15.000 para limpieza. Dejar vajilla limpia. Prohibido fumar adentro.', hora_apertura: '09:00', hora_cierre: '23:00' },
      { id: 'parrilla', nombre: 'Parrilla / Quincho', icon: '🥩', desc: 'Capacidad 15 personas · Parrilla a leña, mesa exterior y bacha', reglamento: 'Uso de carbón o leña propios. Apagar brasas y limpiar la parrilla al finalizar.', hora_apertura: '10:00', hora_cierre: '23:00' },
      { id: 'pileta', nombre: 'Pileta & Solarium', icon: '🏊', desc: 'Solarium con reposeras · Temporada habilitada', reglamento: 'Uso obligatorio de gorro. Revisación médica previa. Menores de 12 años acompañados por un adulto.', hora_apertura: '09:00', hora_cierre: '20:00' },
      { id: 'gimnasio', nombre: 'Gimnasio', icon: '🏋️', desc: 'Cinta para correr, mancuernas, polea y bicicleta estática', reglamento: 'Uso de toalla obligatorio para las máquinas. Limpiar y desinfectar el equipamiento tras su uso.', hora_apertura: '07:00', hora_cierre: '22:00' },
      { id: 'cochera', nombre: 'Cochera de Cortesía', icon: '🚗', desc: 'Espacio de estacionamiento para visitas', reglamento: 'Máximo 48 hs continuas por visitante. Identificar vehículo con patente en portería.', hora_apertura: '08:00', hora_cierre: '23:00' },
      { id: 'laundry', nombre: 'Laundry / Lavadero', icon: '🧺', desc: 'Lavarropas y secarropas automáticos', reglamento: 'Utilizar jabón para lavarropas automáticos. Retirar prendas al terminar el ciclo.', hora_apertura: '08:00', hora_cierre: '21:00' }
    ];
  }

  const hoyStr = new Date().toISOString().split('T')[0];

  const content = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:800;color:#0F326A;margin-bottom:2px">Reserva de Amenities</h2>
      <p style="font-size:13px;color:#64748B">Espacios comunes y turnos por hora en ${esc(v.edificio)}</p>
    </div>

    <!-- MIS RESERVAS PRÓXIMAS -->
    ${misReservas.length ? `
    <div class="card" style="margin-bottom:16px;padding:16px 18px">
      <div style="font-size:14px;font-weight:800;color:#0F172A;margin-bottom:10px;display:flex;align-items:center;gap:6px">
        <span>🎟️</span> Mis Reservas Confirmadas (${misReservas.length})
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${misReservas.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #E2E8F0;border-radius:10px;background:#F8FAFD;gap:10px;flex-wrap:wrap">
            <div>
              <div style="font-size:13.5px;font-weight:800;color:#0F172A">${esc(r.amenity)}</div>
              <div style="font-size:12px;color:#64748B">📆 ${esc(r.fecha)} · ⏰ <strong>${esc(r.hora_desde || '00:00')} a ${esc(r.hora_hasta || '00:00')} hs</strong>${r.notas ? ' · ' + esc(r.notas) : ''}</div>
            </div>
            <button onclick="cancelarReserva(${r.id})" style="border:1px solid #FCA5A5;background:#FEF2F2;color:#DC2626;font-size:11.5px;font-weight:700;padding:4px 8px;border-radius:6px;cursor:pointer">Cancelar</button>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- FORMULARIO DE RESERVA POR HORAS (ESTILO BUTACAS / BLOQUES) -->
    <div class="card" style="margin-bottom:16px;padding:18px 20px">
      <div style="font-size:15px;font-weight:800;color:#0F172A;margin-bottom:14px;display:flex;align-items:center;gap:6px">
        <span>📅</span> Nueva Reserva por Horas
      </div>

      <form id="form-reserva-amenity" onsubmit="enviarReserva(event)">
        <!-- 1. Selección del Amenity -->
        <div style="margin-bottom:16px">
          <label style="font-size:12.5px;font-weight:700;color:#475569;display:block;margin-bottom:8px">1. Elegí el espacio común</label>
          <div id="grid-amenities" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
            ${amenitiesList.map((a, idx) => `
              <div onclick="seleccionarAmenity('${escJs(a.nombre)}', this)" style="border:2px solid ${idx === 0 ? '#1E5FB4' : '#E2E8F0'};border-radius:10px;padding:10px;cursor:pointer;background:${idx === 0 ? '#EBF3FC' : '#fff'};text-align:center;transition:all .2s" class="amenity-card-item">
                <div style="font-size:24px;margin-bottom:2px">${esc(a.icon)}</div>
                <div style="font-size:13px;font-weight:800;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.nombre)}</div>
                <div style="font-size:11px;color:#64748B">${esc(a.hora_apertura)} a ${esc(a.hora_cierre)} hs</div>
              </div>
            `).join('')}
          </div>
          <input type="hidden" id="inp-amenity-sel" value="${esc(amenitiesList[0].nombre)}">
        </div>

        <!-- 2. Fecha -->
        <div style="margin-bottom:16px">
          <label style="font-size:12.5px;font-weight:700;color:#475569;display:block;margin-bottom:6px">2. Elegí la fecha</label>
          <input type="date" id="inp-reserva-fecha" value="${hoyStr}" min="${hoyStr}" class="inp" style="background:#fff;margin-bottom:0" onchange="renderGrillaHoras()">
        </div>

        <!-- 3. Grilla de Horas Estilo Asientos de Cine -->
        <div style="margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label style="font-size:12.5px;font-weight:700;color:#475569">3. Tocá las horas que vas a utilizar (bloques de 1h)</label>
            <span style="font-size:11px;color:#64748B">🟩 Libre · 🟥 Ocupado</span>
          </div>
          <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:12px;padding:12px;margin-bottom:8px">
            <div id="grid-horas-container" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:8px">
              <!-- Renderizado dinámico vía JS -->
            </div>
          </div>
          <div id="resumen-seleccion-horas" style="display:none;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 14px;font-size:13px;color:#1E40AF">
            🕒 Horario seleccionado: <strong id="txt-rango-seleccion"></strong> (<span id="txt-duracion-horas"></span>)
          </div>
        </div>

        <!-- 4. Notas / Motivo -->
        <div style="margin-bottom:16px">
          <label style="font-size:12.5px;font-weight:700;color:#475569;display:block;margin-bottom:6px">Motivo / Cantidad de personas (opcional)</label>
          <input type="text" id="inp-reserva-notas" placeholder="Ej: Reunión de consejo (4 personas) o Asado familiar" class="inp" style="background:#fff;margin-bottom:0">
        </div>

        <input type="hidden" id="inp-hora-desde" value="">
        <input type="hidden" id="inp-hora-hasta" value="">

        <button id="btn-submit-reserva" type="submit" disabled style="width:100%;height:48px;border:none;border-radius:12px;background:linear-gradient(135deg,#1E5FB4,#2E6FC0);color:#fff;font-size:15px;font-weight:800;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:8px;opacity:0.5;box-shadow:0 3px 12px rgba(30,95,180,.3)">
          <i class="ph ph-check-circle" style="font-size:18px"></i>
          <span>Confirmar Reserva</span>
        </button>
      </form>
    </div>

    <!-- REGLAMENTO DINÁMICO DEL AMENITY SELECCIONADO -->
    <div id="box-reglamento-amenity" class="card" style="padding:16px 18px;background:#F8FAFD">
      <div style="font-size:13.5px;font-weight:800;color:#0F172A;margin-bottom:6px;display:flex;align-items:center;gap:6px">
        <span>📜</span> <span id="titulo-reglamento-amenity">Reglamento: ${esc(amenitiesList[0].nombre)}</span>
      </div>
      <div id="contenido-reglamento-amenity" style="font-size:12.5px;color:#475569;line-height:1.6;background:#fff;padding:10px 14px;border:1px solid #E2E8F0;border-radius:10px">
        ${amenitiesList[0].reglamento ? esc(amenitiesList[0].reglamento) : 'Podés reservar desde 1 sola hora hasta varias continuas. El espacio debe entregarse limpio y en orden. Horario límite de música/ruidos: 01:00 hs.'}
      </div>
    </div>

    <script>
      var _todasReservas = ${JSON.stringify(todasReservasEdificio)};
      var _amenitiesList = ${JSON.stringify(amenitiesList)};
      var _horasSeleccionadas = [];

      function seleccionarAmenity(nombre, el) {
        document.getElementById('inp-amenity-sel').value = nombre;
        var cards = document.querySelectorAll('.amenity-card-item');
        cards.forEach(function(c) {
          c.style.borderColor = '#E2E8F0';
          c.style.background = '#fff';
        });
        el.style.borderColor = '#1E5FB4';
        el.style.background = '#EBF3FC';
        _horasSeleccionadas = [];
        
        // Actualizar caja de reglamento específico
        var amObj = _amenitiesList.find(function(a){ return a.nombre === nombre; });
        var tReg = document.getElementById('titulo-reglamento-amenity');
        var cReg = document.getElementById('contenido-reglamento-amenity');
        if (tReg && amObj) tReg.textContent = 'Reglamento: ' + amObj.nombre;
        if (cReg && amObj) {
          cReg.textContent = amObj.reglamento ? amObj.reglamento : 'Podés reservar desde 1 sola hora hasta varias continuas. El espacio debe entregarse limpio y en orden. Horario límite de música/ruidos: 01:00 hs.';
        }

        renderGrillaHoras();
      }

      function parseHoraToNum(hStr) {
        if (!hStr) return 0;
        var parts = hStr.split(':');
        return parseInt(parts[0], 10) + (parseInt(parts[1] || 0, 10) / 60);
      }

      function renderGrillaHoras() {
        var amenityNombre = document.getElementById('inp-amenity-sel').value;
        var fecha = document.getElementById('inp-reserva-fecha').value;
        var grid = document.getElementById('grid-horas-container');
        grid.innerHTML = '';

        if (!fecha) return;

        var amenityObj = _amenitiesList.find(function(a){ return a.nombre === amenityNombre; }) || _amenitiesList[0];
        var horaInicio = parseInt((amenityObj.hora_apertura || '08:00').split(':')[0], 10);
        var horaFin = parseInt((amenityObj.hora_cierre || '23:00').split(':')[0], 10);

        // Buscar reservas existentes para esta fecha y amenity
        var reservasFecha = _todasReservas.filter(function(r) {
          return r.amenity.toLowerCase() === amenityNombre.toLowerCase() && 
                 r.fecha === fecha && 
                 r.estado !== 'cancelada';
        });

        for (var h = horaInicio; h < horaFin; h++) {
          var hStartStr = String(h).padStart(2, '0') + ':00';
          var hEndStr = String(h + 1).padStart(2, '0') + ':00';
          var slotLabel = hStartStr + ' - ' + hEndStr;

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
            btnSlot.style.cssText = 'padding:10px 6px;border-radius:10px;background:#FEE2E2;border:1.5px solid #FCA5A5;color:#991B1B;font-size:12px;font-weight:700;text-align:center;cursor:not-allowed;opacity:0.9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px';
            btnSlot.innerHTML = '<span>🔒 ' + hStartStr + '</span><span style="font-size:9.5px;opacity:.8">' + ocupadoPor + '</span>';
          } else {
            var isSel = _horasSeleccionadas.indexOf(h) !== -1;
            btnSlot.style.cssText = 'padding:10px 6px;border-radius:10px;font-size:12.5px;font-weight:800;text-align:center;cursor:pointer;transition:all .12s ease;' + 
              (isSel ? 'background:#1E5FB4;border:1.5px solid #1E5FB4;color:#fff;box-shadow:0 3px 8px rgba(30,95,180,.35)' : 'background:#fff;border:1.5px solid #CBD5E1;color:#16233B');
            btnSlot.innerHTML = '<span>' + hStartStr + '</span><span style="font-size:10px;font-weight:600;opacity:' + (isSel ? '1' : '.6') + '">' + (isSel ? '✓ Elegido' : 'Libre') + '</span>';
            
            btnSlot.onclick = (function(horaNum){
              return function() { toggleHora(horaNum); };
            })(h);
          }

          grid.appendChild(btnSlot);
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

        box.style.display = 'block';
        document.getElementById('txt-rango-seleccion').textContent = strDesde + ' a ' + strHasta + ' hs';
        document.getElementById('txt-duracion-horas').textContent = duracion + (duracion === 1 ? ' hora' : ' horas');

        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.innerHTML = '<i class="ph ph-check-circle" style="font-size:18px"></i><span>Confirmar Reserva (' + strDesde + ' a ' + strHasta + ' hs)</span>';
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
            alert('✓ ¡Reserva confirmada de ' + horaDesde + ' a ' + horaHasta + ' hs con éxito!');
            location.reload();
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

      document.addEventListener('DOMContentLoaded', function() {
        renderGrillaHoras();
      });
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
    if (pool) {
      // Validar si existe solapamiento con alguna reserva activa en la misma fecha y amenity
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
            
            // Solapamiento: no termina antes de que empiece la otra ni empieza después de que termine
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
      const qIns = `INSERT INTO reservas_amenities (edificio, amenity, fecha, hora_desde, hora_hasta, turno, departamento, nombre_vecino, telefono, estado, notas, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING id`;
      const insRes = await pool.query(qIns, [
        v.edificio,
        amenity,
        fecha,
        hora_desde,
        hora_hasta,
        turnoLabel,
        v.departamento,
        v.nombre,
        v.telefono || '',
        'confirmada',
        notas || ''
      ]);

      return res.json({ ok: true, mensaje: 'Reserva confirmada con éxito', id: insRes.rows[0].id });
    }

    res.json({ ok: true, mensaje: 'Reserva registrada' });
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

module.exports = router;
