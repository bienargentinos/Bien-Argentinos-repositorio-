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

// Intentar cargar adaptadores de datos
let datosPg = null;
try {
  datosPg = require('./datos-pg');
} catch (_) {}

let datosModule = null;
try {
  datosModule = require('./datos');
} catch (_) {}

let marcosCara = null;
try {
  marcosCara = require('./agentes/marcos-cara');
} catch (_) {}

// Estilos visuales oficiales de Marcos IA (Tokens exactos)
const CSS_VECINO = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;padding:0;min-height:100vh}
body{background:#EEF1F6;color:#16233B;font-family:'Hanken Grotesk',system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
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
    edificio: 'Torre Norte Edifica',
    departamento: '4° B',
    saldoExpensa: '$120.000,00',
    estadoExpensa: 'Al día',
  };
}

function shellVecino(title, activeTab, content, vecinoData) {
  const v = vecinoData || {
    nombre: 'Daniel Morales',
    edificio: 'Torre Norte Edifica',
    departamento: '4° B',
  };

  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0F326A">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Marcos Vecinos">
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
</script>
</head>
<body>
<div style="min-height:100vh;display:flex;flex-direction:column;max-width:540px;margin:0 auto;background:#F8FAFD;box-shadow:0 0 40px rgba(0,0,0,.06)">
  
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
    <a href="/vecino/expensas" class="${activeTab === 'expensas' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-receipt${activeTab === 'expensas' ? '-fill' : ''}"></i></span>
      <span>Expensas</span>
    </a>
    <a href="/vecino/novedades" class="${activeTab === 'novedades' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-bell${activeTab === 'novedades' ? '-fill' : ''}"></i></span>
      <span>Avisos</span>
    </a>
  </nav>

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
</style>
</head>
<body>
<div class="login-card">
  <div style="text-align:center;margin-bottom:24px">
    <div style="width:58px;height:58px;border-radius:16px;background:linear-gradient(135deg,#0F326A,#2E6FC0);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:28px;margin-bottom:12px;box-shadow:0 8px 20px rgba(15,50,106,.25)">
      🏢
    </div>
    <h1 style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px;color:#0F326A">Portal del Vecino</h1>
    <p style="font-size:13.5px;color:#64748B">Ingresá con tus credenciales de consorcio</p>
  </div>

  <form action="/vecino/auth" method="POST">
    <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:6px">Email o Teléfono WhatsApp</div>
    <input name="identificador" class="inp" type="text" placeholder="ejemplo@correo.com o +54 9 11..." required>

    <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:6px">Contraseña o Código de Unidad</div>
    <input name="password" class="inp" type="password" placeholder="Tu contraseña" required>

    <button type="submit" class="btn-login">
      <span>Ingresar a mi Edificio</span>
      <i class="ph ph-arrow-right" style="font-size:18px"></i>
    </button>
  </form>

  <div style="margin-top:20px;text-align:center;font-size:12.5px;color:#64748B">
    ¿Primer ingreso? Solicitale tu acceso al administrador.
  </div>
</div>
</body>
</html>`);
});

router.post('/auth', (req, res) => {
  const { identificador } = req.body || {};
  if (req.session) {
    req.session.vecino = {
      nombre: identificador ? identificador.split('@')[0] : 'Daniel Morales',
      telefono: '+54 9 11 5555-4321',
      edificio: 'Torre Norte Edifica',
      departamento: '4° B',
      saldoExpensa: '$120.000,00',
      estadoExpensa: 'Al día',
    };
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
// 4. MIS EXPENSAS (HISTORIAL & DETALLE)
// -------------------------------------------------------------------
router.get('/expensas', (req, res) => {
  const v = getVecinoSession(req);

  const content = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:800;color:#0F326A;margin-bottom:2px">Mis Expensas</h2>
      <p style="font-size:13px;color:#64748B">${v.edificio} · Unidad ${v.departamento}</p>
    </div>

    <!-- Estado Actual -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;border-left:4px solid #16A34A">
      <div style="font-size:12px;font-weight:800;color:#16A34A;text-transform:uppercase;margin-bottom:4px">Estado de Cuenta</div>
      <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:2px">Sin deuda pendiente</div>
      <p style="font-size:13px;color:#64748B">Tu última expensa abonada corresponde al período Agosto 2026.</p>
    </div>

    <!-- Historial de Recibos -->
    <div style="font-size:14px;font-weight:800;color:#0F172A;margin-bottom:10px">Historial de Períodos</div>
    
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:10px;background:#FDECEC;color:#C0392B;display:flex;align-items:center;justify-content:center;font-size:20px">
            <i class="ph ph-file-pdf"></i>
          </div>
          <div>
            <div style="font-size:14.5px;font-weight:800;color:#0F172A">Agosto 2026</div>
            <div style="font-size:12px;color:#64748B">$120.000,00 · Pagado el 05/08</div>
          </div>
        </div>
        <button onclick="alert('Descargando comprobante de Agosto 2026...')" style="padding:6px 12px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;color:#1E5FB4;font-size:12.5px;font-weight:700;cursor:pointer">
          Descargar
        </button>
      </div>

      <div class="card" style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:10px;background:#FDECEC;color:#C0392B;display:flex;align-items:center;justify-content:center;font-size:20px">
            <i class="ph ph-file-pdf"></i>
          </div>
          <div>
            <div style="font-size:14.5px;font-weight:800;color:#0F172A">Julio 2026</div>
            <div style="font-size:12px;color:#64748B">$115.000,00 · Pagado el 08/07</div>
          </div>
        </div>
        <button onclick="alert('Descargando comprobante de Julio 2026...')" style="padding:6px 12px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;color:#1E5FB4;font-size:12.5px;font-weight:700;cursor:pointer">
          Descargar
        </button>
      </div>
    </div>
  `;

  res.send(shellVecino('Mis Expensas', 'expensas', content, v));
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

module.exports = router;
