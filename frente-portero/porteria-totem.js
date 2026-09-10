/**
 * porteria-totem.js — Interfaz Kiosco / Tótem Táctil para Portería (Marcos IA)
 * ---------------------------------------------------------------------------
 * Pantalla táctil de 8" a 10" (vertical/horizontal) inspirada en el diseño Hipcam:
 * - Grilla Bento de 3 botones de alto impacto (Tocar timbre, Residentes, QR)
 * - Cámara frontal integrada en vivo con captura instantánea a WhatsApp
 * - Salvapantallas (Idle) con reloj gigante y retorno automático tras 60s
 * - Teclado numérico táctil 4x4 (PB, 1-9, A-E) con buscador de unidad
 * - Lector QR en tiempo real con jsQR para pases temporales y apertura de puerta
 * - Soporte multi-idioma (ES, EN, PT) y alternancia Día/Noche
 * - Wake Lock API para mantener la pantalla siempre encendida
 * ---------------------------------------------------------------------------
 */

'use strict';

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTotemHtml(nombreEdificio) {
  const edEsc = esc(nombreEdificio || 'San Patricio 159');

  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0F172A">
<title>Tótem Portería · ${edEsc}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800;900&family=Montserrat:wght@600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">
<!-- Librería decodificadora de QR ligera en cliente -->
<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
:root {
  --ed-bg: radial-gradient(120% 70% at 12% -8%, #1a1e34 0%, #111320 45%, #0c0d17 100%);
  --ed-ink: #f8fafc;
  --ed-ink-2: #94a3b8;
  --ed-ink-3: #64748b;
  --ed-line: rgba(255,255,255,0.12);
  --ed-surface: rgba(255,255,255,0.06);
  --ed-surface-solid: #16192b;
  --ed-edge: rgba(255,255,255,0.12);
  --ed-brand: #38bdf8;
  --ed-card-blue: linear-gradient(145deg, #0284c7 0%, #0ea5e9 100%);
  --ed-card-yellow: linear-gradient(145deg, #d97706 0%, #f59e0b 100%);
  --ed-card-pink: linear-gradient(145deg, #e11d48 0%, #f43f5e 100%);
  --font-body: 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-heading: 'Montserrat', sans-serif;
}

[data-theme="light"] {
  --ed-bg: radial-gradient(120% 70% at 12% -8%, #ffffff 0%, #f0f4fa 45%, #e2e8f4 100%);
  --ed-ink: #0f172a;
  --ed-ink-2: #475569;
  --ed-ink-3: #64748b;
  --ed-line: rgba(15,23,42,0.12);
  --ed-surface: rgba(255,255,255,0.85);
  --ed-surface-solid: #ffffff;
  --ed-edge: rgba(15,23,42,0.12);
  --ed-brand: #0284c7;
  --ed-card-blue: linear-gradient(145deg, #0284c7 0%, #38bdf8 100%);
  --ed-card-yellow: linear-gradient(145deg, #ea580c 0%, #f59e0b 100%);
  --ed-card-pink: linear-gradient(145deg, #be123c 0%, #e11d48 100%);
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  font-family: var(--font-body);
  user-select: none;
  -webkit-user-select: none;
}

.kiosk-wrapper {
  width: 100%;
  height: 100%;
  max-width: 600px;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--ed-bg);
  color: var(--ed-ink);
  transition: background .35s ease, color .35s ease;
}

/* Animaciones */
@keyframes edPulse { 0% { transform: scale(0.72); opacity: 0.85 } 100% { transform: scale(2.2); opacity: 0 } }
@keyframes edBell { 0%,70%,100% { transform: rotate(0) } 78% { transform: rotate(12deg) } 86% { transform: rotate(-10deg) } 93% { transform: rotate(6deg) } }
@keyframes edScan { 0% { top: 6% } 100% { top: 92% } }
@keyframes edBreathe { 0%,100% { opacity: 0.35 } 50% { opacity: 1 } }
@keyframes edRise { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
@keyframes edSheen { 0% { transform: translateX(-120%) } 100% { transform: translateX(320%) } }

/* Botones y efectos táctiles */
.btn-touch {
  transition: transform .12s ease, filter .12s ease;
  cursor: pointer;
  border: 0;
  outline: none;
}
.btn-touch:active {
  transform: scale(0.96) !important;
  filter: brightness(0.92);
}

/* Encabezado */
.header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px 0 20px;
}
.header-badge-shield {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, #0284c7, #38bdf8);
  box-shadow: 0 8px 24px -6px rgba(14,165,233,0.6);
}
.building-title {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 22px;
  line-height: 1.1;
  color: var(--ed-ink);
}
.building-subtitle {
  font-size: 13px;
  color: var(--ed-ink-2);
  margin-top: 2px;
}
.clock-text {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 26px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--ed-ink);
}
.date-text {
  font-size: 12px;
  color: var(--ed-ink-2);
  margin-top: 3px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Barra de estado */
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px 0 20px;
}
.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 10px #22c55e;
  animation: edBreathe 2.4s ease-in-out infinite;
}
.status-label {
  font-size: 12.5px;
  color: var(--ed-ink-2);
  letter-spacing: 0.02em;
}
.lang-btn {
  background: transparent;
  border: 1px solid var(--ed-line);
  color: var(--ed-ink-2);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all .2s;
}
.lang-btn.active {
  background: var(--ed-brand);
  color: #fff;
  border-color: var(--ed-brand);
  box-shadow: 0 4px 12px rgba(14,165,233,0.4);
}
.theme-toggle-btn {
  background: transparent;
  border: 1px solid var(--ed-line);
  color: var(--ed-brand);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
}

/* Recuadro de Cámara en Vivo */
.cam-container {
  margin: 12px 20px 0 20px;
  position: relative;
  border-radius: 20px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 16 / 9;
  max-height: 230px;
  box-shadow: inset 0 0 0 1px var(--ed-edge), 0 12px 30px rgba(0,0,0,0.3);
  transition: all .4s cubic-bezier(0.4, 0, 0.2, 1);
}
.cam-container.cam-expanded {
  max-height: 480px;
  aspect-ratio: 1 / 1.1;
  box-shadow: inset 0 0 0 2px #a855f7, 0 16px 40px rgba(168,85,247,0.3);
}
.cam-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
}
.cam-overlay-badge {
  position: absolute;
  top: 10px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(15,23,42,0.7);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,0.2);
  font-size: 11px;
  color: #e2e8f0;
  font-weight: 700;
  letter-spacing: 0.05em;
  pointer-events: none;
}
.cam-hint-bottom {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255,255,255,0.85);
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
  pointer-events: none;
}

/* Láser y marco QR */
.qr-scanner-box {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.qr-frame {
  position: relative;
  width: 220px;
  height: 220px;
  border-radius: 24px;
  box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);
}
.qr-frame span {
  position: absolute;
  width: 36px;
  height: 36px;
  border-color: #a855f7;
  border-style: solid;
}
.qr-corner-tl { top: 0; left: 0; border-width: 5px 0 0 5px; border-radius: 18px 0 0 0; }
.qr-corner-tr { top: 0; right: 0; border-width: 5px 5px 0 0; border-radius: 0 18px 0 0; }
.qr-corner-bl { bottom: 0; left: 0; border-width: 0 0 5px 5px; border-radius: 0 0 0 18px; }
.qr-corner-br { bottom: 0; right: 0; border-width: 0 5px 5px 0; border-radius: 0 0 18px 0; }
.qr-laser {
  position: absolute;
  left: 6px;
  right: 6px;
  height: 3px;
  background: linear-gradient(to right, transparent, #c084fc, #fff, #c084fc, transparent);
  box-shadow: 0 0 16px #a855f7;
  border-radius: 2px;
  animation: edScan 2.4s ease-in-out infinite alternate;
}

/* Grilla Bento Hipcam */
.bento-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 290px;
  max-height: 380px;
  margin-top: 14px;
}
.bento-card-blue {
  grid-row: span 2;
  border-radius: 24px;
  padding: 22px 18px;
  background: var(--ed-card-blue);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-start;
  text-align: left;
  box-shadow: 0 16px 36px -12px rgba(2,132,199,0.5);
  position: relative;
  overflow: hidden;
}
.bento-card-yellow {
  border-radius: 24px;
  padding: 18px;
  background: var(--ed-card-yellow);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-start;
  text-align: left;
  box-shadow: 0 14px 32px -12px rgba(245,158,11,0.5);
}
.bento-card-pink {
  border-radius: 24px;
  padding: 18px;
  background: var(--ed-card-pink);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-start;
  text-align: left;
  box-shadow: 0 14px 32px -12px rgba(225,29,72,0.5);
}
.icon-box-lg {
  width: 68px;
  height: 68px;
  border-radius: 18px;
  background: rgba(255,255,255,0.22);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,0.35);
  display: grid;
  place-items: center;
}
.icon-box-sm {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(255,255,255,0.22);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,0.35);
  display: grid;
  place-items: center;
}

/* Teclado numérico Kiosco */
.keypad-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 20px 0 20px;
  animation: edRise .24s ease both;
}
.display-unit {
  flex: 1;
  height: 58px;
  border-radius: 16px;
  background: var(--ed-surface);
  border: 1px solid var(--ed-edge);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}
.unit-digits {
  font-family: var(--font-heading);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--ed-ink);
}
.unit-placeholder {
  font-size: 15px;
  color: var(--ed-ink-3);
  font-weight: 500;
}
.btn-delete-digit {
  background: transparent;
  border: 1px solid var(--ed-line);
  color: var(--ed-ink);
  height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.motives-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.motive-chip {
  height: 44px;
  border-radius: 12px;
  border: 1.5px solid var(--ed-line);
  background: transparent;
  color: var(--ed-ink-2);
  font-size: 12.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: all .15s;
}
.motive-chip.active {
  background: var(--ed-card-blue);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 6px 16px rgba(2,132,199,0.35);
}
.grid-keys-4x4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 52px;
  gap: 8px;
}
.key-btn {
  background: var(--ed-surface);
  border: 1px solid var(--ed-edge);
  color: var(--ed-ink);
  font-family: var(--font-heading);
  font-size: 22px;
  font-weight: 700;
  border-radius: 14px;
  display: grid;
  place-items: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  cursor: pointer;
}
.key-btn.key-letter {
  background: rgba(14,165,233,0.12);
  color: var(--ed-brand);
  border-color: rgba(14,165,233,0.25);
}
.btn-ring-action {
  width: 100%;
  height: 56px;
  border-radius: 16px;
  background: var(--ed-card-blue);
  color: #fff;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-shadow: 0 10px 25px rgba(2,132,199,0.4);
  cursor: pointer;
}
.btn-ring-action:disabled {
  opacity: 0.45;
  filter: grayscale(0.6);
  cursor: not-allowed;
  box-shadow: none;
}

/* Pantalla de Llamada Activa */
.calling-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: radial-gradient(85% 55% at 50% 38%, #0369a1 0%, #0f172a 60%, #020617 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  animation: edRise .3s ease both;
}
.radar-box {
  position: relative;
  width: 180px;
  height: 180px;
  display: grid;
  place-items: center;
  margin-bottom: 24px;
}
.radar-ring {
  position: absolute;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  border: 2px solid #38bdf8;
  animation: edPulse 2.4s ease-out infinite;
}
.radar-center-bell {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: linear-gradient(145deg, #0284c7, #38bdf8);
  display: grid;
  place-items: center;
  box-shadow: 0 15px 40px rgba(14,165,233,0.6);
}

/* Salvapantallas (Idle / Standby) */
.idle-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: var(--ed-bg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  text-align: center;
}
.idle-clock {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 100px;
  line-height: 0.95;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--ed-ink);
  margin-top: 16px;
}
@media (min-width: 440px) {
  .idle-clock { font-size: 130px; }
}
.idle-date {
  font-size: 16px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ed-ink-2);
  margin-top: 6px;
}
.idle-touch-hint {
  font-size: 18px;
  font-weight: 700;
  color: var(--ed-brand);
  margin-top: 24px;
  animation: edBreathe 2.2s ease-in-out infinite;
}

/* Pie del Kiosco */
.footer-bar {
  margin-top: auto;
  padding: 12px 20px 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ed-ink-3);
  letter-spacing: 0.04em;
}
.btn-concierge {
  border: 1px solid var(--ed-line);
  background: transparent;
  color: var(--ed-ink);
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

/* Feedback de apertura de puerta */
.door-open-modal {
  position: absolute;
  inset: 0;
  z-index: 60;
  background: rgba(15,23,42,0.85);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 30px;
  animation: edRise .25s ease both;
}
</style>
</head>
<body>

<div id="kiosk-app" class="kiosk-wrapper" data-theme="dark" onpointerdown="_onUserTouch()">

  <!-- 1. ENCABEZADO SUPERIOR -->
  <div class="header-top">
    <div style="display:flex;gap:12px;align-items:center">
      <div class="header-badge-shield">
        <i class="ph-fill ph-shield-check" style="font-size:26px;color:#fff"></i>
      </div>
      <div>
        <div class="building-title" id="txt-edificio-name">${edEsc}</div>
        <div class="building-subtitle" id="txt-edificio-sub">Consorcio Seguro · Recoleta</div>
      </div>
    </div>
    <div style="text-align:right">
      <div class="clock-text" id="header-clock">--:--</div>
      <div class="date-text" id="header-date">---</div>
    </div>
  </div>

  <!-- 2. BARRA DE ESTADO & SELECTOR DE IDIOMA / TEMA -->
  <div class="status-bar">
    <span class="status-dot"></span>
    <span class="status-label" id="txt-status-online">Sistema activo · Portería conectada</span>
    <span style="flex:1"></span>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="lang-btn active" id="btn-lang-es" onclick="cambiarIdioma('es')">ES</button>
      <button class="lang-btn" id="btn-lang-en" onclick="cambiarIdioma('en')">EN</button>
      <button class="lang-btn" id="btn-lang-pt" onclick="cambiarIdioma('pt')">PT</button>
      <button class="theme-toggle-btn btn-touch" onclick="alternarTema()" title="Cambiar tema">
        <i class="ph-fill ph-sun" id="theme-icon" style="font-size:16px"></i>
      </button>
    </div>
  </div>

  <!-- 3. RECUADRO DE CÁMARA FRONTAL EN VIVO -->
  <div class="cam-container" id="cam-box">
    <video id="kiosk-video" class="cam-video" autoplay playsinline muted></video>
    <canvas id="qr-scan-canvas" style="display:none"></canvas>
    
    <div class="cam-overlay-badge">
      <span class="status-dot" style="width:7px;height:7px"></span>
      <span id="txt-cam-badge">CÁMARA EN VIVO · HD</span>
    </div>
    
    <div class="cam-hint-bottom" id="cam-hint-text">Te estás viendo — mirá a la cámara</div>

    <!-- Retícula de escaneo QR (solo visible en modo QR) -->
    <div class="qr-scanner-box" id="qr-frame-box" style="display:none">
      <div class="qr-frame">
        <span class="qr-corner-tl"></span>
        <span class="qr-corner-tr"></span>
        <span class="qr-corner-bl"></span>
        <span class="qr-corner-br"></span>
        <div class="qr-laser"></div>
      </div>
    </div>
  </div>

  <!-- 4. VISTA: HOME (GRILLA BENTO HIPCAM) -->
  <div id="view-home" style="flex:1;display:flex;flex-direction:column;padding:12px 20px 0 20px;animation:edRise .25s ease both">
    <div style="font-size:11px;letter-spacing:0.2em;color:var(--ed-brand);font-weight:800;text-transform:uppercase" id="txt-home-tag">BIENVENIDO</div>
    <div style="font-family:var(--font-heading);font-weight:800;font-size:24px;line-height:1.1;margin-top:3px;color:var(--ed-ink)" id="txt-home-title">¿A quién querés llamar?</div>
    <div style="font-size:13px;color:var(--ed-ink-2);margin-top:2px" id="txt-home-sub">Tocá una opción para comunicarte e ingresar</div>

    <!-- Grilla Bento de 3 Fichas -->
    <div class="bento-grid">
      <!-- Botón 1: Tocar Timbre (Azul Grande) -->
      <button class="bento-card-blue btn-touch" onclick="irA('keypad')">
        <div class="icon-box-lg">
          <i class="ph-fill ph-bell-ringing" style="font-size:38px;color:#fff;animation:edBell 3.5s ease-in-out infinite"></i>
        </div>
        <div>
          <div style="font-family:var(--font-heading);font-weight:800;font-size:26px;line-height:1.05;color:#fff" id="btn-txt-ring">Tocar timbre</div>
          <div style="font-size:12.5px;color:rgba(255,255,255,0.9);margin-top:4px" id="btn-sub-ring">Buscar vecino por piso y unidad</div>
        </div>
        <div style="position:absolute;top:0;left:0;width:80px;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);animation:edSheen 5s ease-in-out infinite"></div>
      </button>

      <!-- Botón 2: Ingreso de Residentes (Naranja) -->
      <button class="bento-card-yellow btn-touch" onclick="irA('residents')">
        <div class="icon-box-sm">
          <i class="ph-fill ph-house-line" style="font-size:26px;color:#fff"></i>
        </div>
        <div>
          <div style="font-family:var(--font-heading);font-weight:800;font-size:17px;line-height:1.1;color:#fff" id="btn-txt-res">Ingreso de residentes</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.85);margin-top:2px" id="btn-sub-res">Abrí con la app o código</div>
        </div>
      </button>

      <!-- Botón 3: Abrir con QR (Fucsia) -->
      <button class="bento-card-pink btn-touch" onclick="irA('qr')">
        <div class="icon-box-sm">
          <i class="ph-fill ph-qr-code" style="font-size:26px;color:#fff"></i>
        </div>
        <div>
          <div style="font-family:var(--font-heading);font-weight:800;font-size:17px;line-height:1.1;color:#fff" id="btn-txt-qr">Abrir con QR</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.9);margin-top:2px" id="btn-sub-qr">Pase temporal · delivery</div>
        </div>
      </button>
    </div>
  </div>

  <!-- 5. VISTA: KEYPAD / TECLADO DE DEPARTAMENTOS -->
  <div id="view-keypad" class="keypad-container" style="display:none">
    <!-- Fila Display y Botón Volver -->
    <div style="display:flex;align-items:center;gap:10px">
      <button class="btn-touch" onclick="irA('home')" style="width:50px;height:50px;border-radius:14px;background:var(--ed-surface);border:1px solid var(--ed-edge);color:var(--ed-ink);display:grid;place-items:center">
        <i class="ph-bold ph-arrow-left" style="font-size:22px"></i>
      </button>
      <div class="display-unit">
        <div>
          <div style="font-size:10px;font-weight:800;letter-spacing:0.12em;color:var(--ed-brand);text-transform:uppercase" id="txt-floor-unit-label">PISO / UNIDAD</div>
          <div id="lbl-unit-display" class="unit-placeholder">Marcá piso y unidad...</div>
        </div>
        <button class="btn-delete-digit btn-touch" onclick="borrarDigito()">
          <i class="ph-bold ph-backspace" style="font-size:18px"></i>
          <span id="txt-del-btn">Borrar</span>
        </button>
      </div>
    </div>

    <!-- Motivo de Visita -->
    <div class="motives-bar">
      <button class="motive-chip active btn-touch" id="chip-visita" onclick="elegirMotivo('visita', this)">
        <i class="ph-fill ph-user" style="font-size:16px"></i>
        <span id="txt-mot-visita">Visita</span>
      </button>
      <button class="motive-chip btn-touch" id="chip-delivery" onclick="elegirMotivo('delivery', this)">
        <i class="ph-fill ph-moped" style="font-size:16px"></i>
        <span id="txt-mot-delivery">Delivery</span>
      </button>
      <button class="motive-chip btn-touch" id="chip-encomienda" onclick="elegirMotivo('encomienda', this)">
        <i class="ph-fill ph-package" style="font-size:16px"></i>
        <span id="txt-mot-encomienda">Encomienda</span>
      </button>
    </div>

    <!-- Botonera 4x4 Kiosco -->
    <div class="grid-keys-4x4">
      <button class="key-btn key-letter btn-touch" onclick="pulsarTecla('PB')">PB</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('1')">1</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('2')">2</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('3')">3</button>

      <button class="key-btn key-letter btn-touch" onclick="pulsarTecla('A')">A</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('4')">4</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('5')">5</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('6')">6</button>

      <button class="key-btn key-letter btn-touch" onclick="pulsarTecla('B')">B</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('7')">7</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('8')">8</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('9')">9</button>

      <button class="key-btn key-letter btn-touch" onclick="pulsarTecla('C')">C</button>
      <button class="key-btn key-letter btn-touch" onclick="pulsarTecla('D')">D</button>
      <button class="key-btn btn-touch" onclick="pulsarTecla('0')">0</button>
      <button class="key-btn key-letter btn-touch" onclick="pulsarTecla('E')">E</button>
    </div>

    <!-- Botón Grande de Llamada -->
    <button id="btn-llamar-action" class="btn-ring-action btn-touch" onclick="ejecutarLlamadaTimbre()" disabled>
      <i class="ph-fill ph-bell-ringing" style="font-size:24px"></i>
      <span id="txt-action-ring">Tocar timbre</span>
    </button>
  </div>

  <!-- 6. VISTA: ESCÁNER QR -->
  <div id="view-qr" style="display:none;padding:14px 20px;flex:1;flex-direction:column;animation:edRise .25s ease both">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <button class="btn-touch" onclick="irA('home')" style="width:50px;height:50px;border-radius:14px;background:var(--ed-surface);border:1px solid var(--ed-edge);color:var(--ed-ink);display:grid;place-items:center">
        <i class="ph-bold ph-arrow-left" style="font-size:22px"></i>
      </button>
      <div>
        <div style="font-family:var(--font-heading);font-weight:800;font-size:20px;color:var(--ed-ink)" id="txt-qr-title">Mostrá tu QR a la cámara</div>
        <div style="font-size:12.5px;color:var(--ed-ink-2)" id="txt-qr-sub">En cualquier parte de la pantalla — no hace falta apuntar</div>
      </div>
    </div>
    <div style="margin-top:auto;padding:12px 16px;border-radius:14px;background:var(--ed-surface);border:1px solid var(--ed-edge);display:flex;align-items:center;gap:10px;color:var(--ed-brand);font-size:12.5px;font-weight:700">
      <i class="ph-fill ph-fingerprint" style="font-size:22px"></i>
      <span id="txt-bio-soon">Reconocimiento facial y biometría muy pronto</span>
    </div>
  </div>

  <!-- 7. VISTA: RESIDENTES -->
  <div id="view-residents" style="display:none;padding:14px 20px;flex:1;flex-direction:column;gap:14px;animation:edRise .25s ease both">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn-touch" onclick="irA('home')" style="width:50px;height:50px;border-radius:14px;background:var(--ed-surface);border:1px solid var(--ed-edge);color:var(--ed-ink);display:grid;place-items:center">
        <i class="ph-bold ph-arrow-left" style="font-size:22px"></i>
      </button>
      <div style="font-family:var(--font-heading);font-weight:800;font-size:22px;color:var(--ed-ink)" id="txt-res-heading">Ingreso de residentes</div>
    </div>
    
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
      <div class="btn-touch" onclick="irA('qr')" style="border-radius:20px;padding:20px 16px;background:var(--ed-surface);border:1px solid var(--ed-edge);display:flex;flex-direction:column;gap:10px;text-align:left">
        <div style="width:48px;height:48px;border-radius:14px;background:rgba(245,158,11,0.15);display:grid;place-items:center;color:#f59e0b">
          <i class="ph-fill ph-device-mobile" style="font-size:28px"></i>
        </div>
        <div style="font-family:var(--font-heading);font-weight:800;font-size:16px;color:var(--ed-ink)" id="txt-res-app">Abrir desde la app</div>
        <div style="font-size:12px;color:var(--ed-ink-2)" id="txt-res-app-sub">Abrí Marcos IA o tu portal vecino y tocá Abrir puerta</div>
      </div>

      <div class="btn-touch" onclick="irA('qr')" style="border-radius:20px;padding:20px 16px;background:var(--ed-surface);border:1px solid var(--ed-edge);display:flex;flex-direction:column;gap:10px;text-align:left">
        <div style="width:48px;height:48px;border-radius:14px;background:rgba(225,29,72,0.15);display:grid;place-items:center;color:#e11d48">
          <i class="ph-fill ph-qr-code" style="font-size:28px"></i>
        </div>
        <div style="font-family:var(--font-heading);font-weight:800;font-size:16px;color:var(--ed-ink)" id="txt-res-myqr">Escanear mi QR</div>
        <div style="font-size:12px;color:var(--ed-ink-2)" id="txt-res-myqr-sub">Tu código de acceso permanente en tu celular</div>
      </div>
    </div>

    <div style="margin-top:auto;padding:12px 16px;border-radius:14px;background:var(--ed-surface);border:1px solid var(--ed-edge);display:flex;align-items:center;gap:10px;color:var(--ed-brand);font-size:12.5px;font-weight:700">
      <i class="ph-fill ph-scan" style="font-size:22px"></i>
      <span>Acceso por reconocimiento facial habilitado para residentes cargados</span>
    </div>
  </div>

  <!-- 8. OVERLAY DE LLAMADA EN CURSO (CALLING) -->
  <div id="overlay-calling" class="calling-overlay" style="display:none">
    <div class="radar-box">
      <div class="radar-ring"></div>
      <div class="radar-ring" style="animation-delay:0.8s"></div>
      <div class="radar-ring" style="animation-delay:1.6s"></div>
      <div class="radar-center-bell">
        <i class="ph-fill ph-bell-ringing" id="calling-icon-bell" style="font-size:52px;color:#fff;animation:edBell 2.2s ease-in-out infinite"></i>
      </div>
    </div>
    
    <div style="text-align:center">
      <div style="font-family:var(--font-heading);font-weight:800;font-size:28px;color:#fff" id="call-status-title">Llamando al vecino...</div>
      <div style="font-family:var(--font-heading);font-weight:900;font-size:46px;letter-spacing:0.04em;color:#38bdf8;margin-top:6px" id="call-status-target">Unidad 4° B</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:10px;max-width:320px" id="call-status-hint">Le sonó el timbre en su celular con tu foto en vivo. Esperá un momento...</div>
    </div>

    <!-- Mensaje en vivo respondido por el vecino -->
    <div id="call-neighbor-msg-box" style="display:none;margin-top:20px;background:#fff;color:#0f172a;padding:16px 20px;border-radius:18px;max-width:360px;box-shadow:0 12px 32px rgba(0,0,0,0.4);border:2px solid #38bdf8">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#0284c7;margin-bottom:4px">Respuesta del Vecino:</div>
      <div id="call-neighbor-msg-text" style="font-family:var(--font-heading);font-size:22px;font-weight:900;line-height:1.25"></div>
    </div>

    <button class="btn-touch" onclick="cancelarLlamadaKiosco()" style="margin-top:30px;padding:12px 28px;border-radius:14px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;gap:8px">
      <i class="ph-bold ph-x" style="font-size:18px"></i>
      <span id="txt-cancel-call">Cancelar llamada</span>
    </button>
  </div>

  <!-- 9. OVERLAY DE PUERTA ABIERTA (ÉXITO) -->
  <div id="overlay-door-open" class="door-open-modal" style="display:none">
    <div style="width:84px;height:84px;border-radius:50%;background:#22c55e;display:grid;place-items:center;margin-bottom:18px;box-shadow:0 0 40px rgba(34,197,94,0.6)">
      <i class="ph-fill ph-lock-key-open" style="font-size:46px;color:#fff"></i>
    </div>
    <div style="font-family:var(--font-heading);font-weight:900;font-size:32px;color:#fff;margin-bottom:6px" id="txt-door-title">¡PUERTA ABIERTA!</div>
    <div style="font-size:16px;color:#cbd5e1;max-width:320px;margin-bottom:16px" id="txt-door-sub">Acceso autorizado. Por favor empuje la puerta para ingresar.</div>
    <div style="padding:6px 14px;border-radius:999px;background:rgba(255,255,255,0.15);font-size:12px;color:#86efac;font-weight:700">
      ⚡ Señal de relé enviada
    </div>
  </div>

  <!-- 10. OVERLAY SALVAPANTALLAS / IDLE -->
  <div id="overlay-idle" class="idle-overlay" onclick="despertarKiosco()">
    <div style="width:72px;height:72px;border-radius:20px;background:linear-gradient(145deg,#0284c7,#38bdf8);display:grid;place-items:center;box-shadow:0 10px 30px rgba(14,165,233,0.5)">
      <i class="ph-fill ph-shield-check" style="font-size:42px;color:#fff"></i>
    </div>
    <div class="idle-clock" id="idle-clock-display">--:--</div>
    <div class="idle-date" id="idle-date-display">---</div>
    <div style="width:180px;height:1px;background:linear-gradient(to right,transparent,var(--ed-line),transparent);margin:20px 0"></div>
    <div style="font-family:var(--font-heading);font-weight:800;font-size:32px;letter-spacing:-0.02em;color:var(--ed-ink)">${edEsc}</div>
    <div class="idle-touch-hint" id="txt-idle-hint">Tocá la pantalla para comenzar</div>
    <div style="position:absolute;bottom:24px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ed-ink-3)">
      <span class="status-dot"></span>
      <span>Marcos IA · Portería Virtual 24/7</span>
    </div>
  </div>

  <!-- 11. PIE INSTITUCIONAL -->
  <div class="footer-bar">
    <div style="display:flex;align-items:center;gap:6px">
      <i class="ph ph-shield-star" style="font-size:16px;color:var(--ed-brand)"></i>
      <span id="txt-footer-brand">Tecnología Marcos IA · Bien Argentinos</span>
    </div>
    <button class="btn-concierge btn-touch" onclick="llamarConserjeria()">
      <i class="ph-fill ph-headset" style="font-size:16px;color:var(--ed-brand)"></i>
      <span id="txt-concierge-btn">Conserjería</span>
    </button>
  </div>

</div>

<!-- Elemento de audio remoto WebRTC -->
<audio id="kiosk-remote-audio" autoplay playsinline style="display:none"></audio>

<script>
var _edificio = "${edEsc}";
var _screen = "home"; // 'idle' | 'home' | 'keypad' | 'qr' | 'residents'
var _lang = "es";
var _theme = "dark";
var _digits = "";
var _motive = "visita";
var _idleTimeout = null;
var _clockInterval = null;
var _callCheckInterval = null;
var _qrScanInterval = null;
var _activeCallId = null;
var _cameraStream = null;
var _wakeLock = null;

// Diccionario de Traducciones
var DICT = {
  es: {
    online: "Sistema activo · Portería conectada",
    welcome: "BIENVENIDO",
    whoToCall: "¿A quién querés llamar?",
    touchOption: "Tocá una opción para comunicarte e ingresar",
    ring: "Tocar timbre",
    ringSub: "Buscar vecino por piso y unidad",
    res: "Ingreso de residentes",
    resSub: "Abrí con la app o código",
    qr: "Abrir con QR",
    qrSub: "Pase temporal · delivery",
    floorUnit: "PISO / UNIDAD",
    placeholder: "Marcá piso y unidad...",
    delete: "Borrar",
    visita: "Visita",
    delivery: "Delivery",
    encomienda: "Encomienda",
    callingTitle: "Llamando al vecino...",
    callingHint: "Le avisamos a su celular con tu foto en vivo. Esperá un momento...",
    cancelCall: "Cancelar llamada",
    qrTitle: "Mostrá tu QR a la cámara",
    qrSub: "En cualquier parte de la pantalla — no hace falta apuntar",
    bioSoon: "Reconocimiento facial y biometría muy pronto",
    resHeading: "Ingreso de residentes",
    resApp: "Abrir desde la app",
    resAppSub: "Abrí Marcos IA o tu portal vecino y tocá Abrir puerta",
    resMyQr: "Escanear mi QR",
    resMyQrSub: "Tu código de acceso permanente en tu celular",
    idleHint: "Tocá la pantalla para comenzar",
    concierge: "Conserjería",
    doorOpenTitle: "¡PUERTA ABIERTA!",
    doorOpenSub: "Acceso autorizado. Por favor empuje la puerta para ingresar."
  },
  en: {
    online: "System live · Doorman connected",
    welcome: "WELCOME",
    whoToCall: "Who would you like to call?",
    touchOption: "Touch an option to connect or enter",
    ring: "Ring bell",
    ringSub: "Find resident by floor and unit",
    res: "Resident entry",
    resSub: "Open with app or code",
    qr: "Open with QR",
    qrSub: "Guest pass · delivery",
    floorUnit: "FLOOR / UNIT",
    placeholder: "Enter floor and unit...",
    delete: "Delete",
    visita: "Visitor",
    delivery: "Delivery",
    encomienda: "Courier",
    callingTitle: "Calling resident...",
    callingHint: "We sent an alert to their phone with your live photo. Please wait...",
    cancelCall: "Cancel call",
    qrTitle: "Show your QR to the camera",
    qrSub: "Anywhere on the screen — no need to align perfectly",
    bioSoon: "Facial biometrics arriving very soon",
    resHeading: "Resident entry",
    resApp: "Open from app",
    resAppSub: "Open Marcos IA and tap Open door",
    resMyQr: "Scan my QR",
    resMyQrSub: "Your personal permanent pass on your phone",
    idleHint: "Touch screen to start",
    concierge: "Concierge",
    doorOpenTitle: "DOOR UNLOCKED!",
    doorOpenSub: "Access authorized. Please push the door to enter."
  },
  pt: {
    online: "Sistema ativo · Portaria conectada",
    welcome: "BEM-VINDO",
    whoToCall: "Quem você deseja chamar?",
    touchOption: "Toque em uma opção para entrar ou falar",
    ring: "Tocar campainha",
    ringSub: "Buscar morador por andar e unidade",
    res: "Entrada de moradores",
    resSub: "Abra com o app ou código",
    qr: "Abrir com QR",
    qrSub: "Passe temporário · entregas",
    floorUnit: "ANDAR / UNIDADE",
    placeholder: "Digite andar e unidade...",
    delete: "Apagar",
    visita: "Visita",
    delivery: "Delivery",
    encomienda: "Encomenda",
    callingTitle: "Chamando morador...",
    callingHint: "Avisamos no celular dele com sua foto ao vivo. Aguarde um instante...",
    cancelCall: "Cancelar chamada",
    qrTitle: "Mostre seu QR para a câmera",
    qrSub: "Em qualquer parte da tela — não precisa mirar",
    bioSoon: "Biometria facial em breve",
    resHeading: "Entrada de moradores",
    resApp: "Abrir pelo app",
    resAppSub: "Abra o Marcos IA e toque em Abrir porta",
    resMyQr: "Escanear meu QR",
    resMyQrSub: "Seu código de acesso permanente no seu celular",
    idleHint: "Toque na tela para começar",
    concierge: "Portaria",
    doorOpenTitle: "PORTA ABERTA!",
    doorOpenSub: "Acesso autorizado. Por favor empurre a porta para entrar."
  }
};

// Generador de sonidos táctiles y campanadas (Web Audio API)
var _audioCtx = null;
function getAudioContext() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }
  return _audioCtx;
}

function playClickSound() {
  try {
    var ctx = getAudioContext();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  } catch(_) {}
}

function playChime() {
  try {
    var ctx = getAudioContext();
    var osc1 = ctx.createOscillator();
    var gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime); // Mi 5
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime + 0.35); // Do 5
    gain1.gain.setValueAtTime(0.3, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.4);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 1.4);
  } catch(_) {}
}

function playSuccessChime() {
  try {
    var ctx = getAudioContext();
    var now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach(function(freq, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      gain.gain.setValueAtTime(0.25, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.5);
    });
  } catch(_) {}
}

// Inicialización del Reloj en Tiempo Real
function actualizarReloj() {
  var now = new Date();
  var hours = String(now.getHours()).padStart(2, '0');
  var mins = String(now.getMinutes()).padStart(2, '0');
  var timeStr = hours + ':' + mins;
  
  var elClock = document.getElementById('header-clock');
  if (elClock) elClock.textContent = timeStr;
  var elIdleClock = document.getElementById('idle-clock-display');
  if (elIdleClock) elIdleClock.textContent = timeStr;

  var locale = _lang === 'en' ? 'en-GB' : _lang === 'pt' ? 'pt-BR' : 'es-AR';
  var dateStr = now.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  var dateLong = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  var elDate = document.getElementById('header-date');
  if (elDate) elDate.textContent = dateStr;
  var elIdleDate = document.getElementById('idle-date-display');
  if (elIdleDate) elIdleDate.textContent = dateLong;
}

// Wake Lock para evitar apagado de pantalla en la tablet
async function activarWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      _wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async function() {
        if (_wakeLock !== null && document.visibilityState === 'visible') {
          _wakeLock = await navigator.wakeLock.request('screen').catch(function(){});
        }
      });
    }
  } catch(_) {}
}

// Iniciar cámara física en directo
async function iniciarCamaraKiosco() {
  try {
    if (!_cameraStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      _cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: true
      }).catch(function() {
        return navigator.mediaDevices.getUserMedia({ video: true });
      });

      var videoEl = document.getElementById('kiosk-video');
      if (videoEl && _cameraStream) {
        videoEl.srcObject = _cameraStream;
      }
    }
  } catch(err) {
    console.warn('Cámara Kiosco:', err.message);
  }
}

// Manejo de Estados de Pantalla
function irA(screen) {
  playClickSound();
  _resetIdleTimer();
  _screen = screen;

  // Ocultar vistas
  document.getElementById('view-home').style.display = 'none';
  document.getElementById('view-keypad').style.display = 'none';
  document.getElementById('view-qr').style.display = 'none';
  document.getElementById('view-residents').style.display = 'none';
  document.getElementById('overlay-idle').style.display = 'none';

  var camBox = document.getElementById('cam-box');
  var qrFrame = document.getElementById('qr-frame-box');
  clearInterval(_qrScanInterval);

  if (screen === 'home') {
    document.getElementById('view-home').style.display = 'flex';
    camBox.classList.remove('cam-expanded');
    qrFrame.style.display = 'none';
  } else if (screen === 'keypad') {
    document.getElementById('view-keypad').style.display = 'flex';
    camBox.classList.remove('cam-expanded');
    qrFrame.style.display = 'none';
  } else if (screen === 'qr') {
    document.getElementById('view-qr').style.display = 'flex';
    camBox.classList.add('cam-expanded');
    qrFrame.style.display = 'flex';
    iniciarEscaneoQR();
  } else if (screen === 'residents') {
    document.getElementById('view-residents').style.display = 'flex';
    camBox.classList.remove('cam-expanded');
    qrFrame.style.display = 'none';
  } else if (screen === 'idle') {
    document.getElementById('overlay-idle').style.display = 'flex';
  }
}

function despertarKiosco() {
  playClickSound();
  irA('home');
}

function _onUserTouch() {
  _resetIdleTimer();
}

function _resetIdleTimer() {
  clearTimeout(_idleTimeout);
  _idleTimeout = setTimeout(function() {
    if (_screen !== 'idle' && document.getElementById('overlay-calling').style.display === 'none') {
      _digits = "";
      _actualizarDisplayUnidad();
      irA('idle');
    }
  }, 60000); // 60 segundos de inactividad
}

// Teclado numérico y unidades
function pulsarTecla(t) {
  playClickSound();
  _resetIdleTimer();
  if (_digits.length < 6) {
    _digits += t;
    _actualizarDisplayUnidad();
  }
}

function borrarDigito() {
  playClickSound();
  _resetIdleTimer();
  if (_digits.length > 0) {
    _digits = _digits.slice(0, -1);
    _actualizarDisplayUnidad();
  }
}

function _actualizarDisplayUnidad() {
  var disp = document.getElementById('lbl-unit-display');
  var btn = document.getElementById('btn-llamar-action');
  if (_digits.length > 0) {
    disp.textContent = _digits;
    disp.className = 'unit-digits';
    btn.disabled = false;
  } else {
    disp.textContent = DICT[_lang].placeholder;
    disp.className = 'unit-placeholder';
    btn.disabled = true;
  }
}

function elegirMotivo(motive, el) {
  playClickSound();
  _resetIdleTimer();
  _motive = motive;
  document.querySelectorAll('.motive-chip').forEach(function(c){ c.classList.remove('active'); });
  el.classList.add('active');
}

// Acción de llamada de timbre
async function ejecutarLlamadaTimbre() {
  if (!_digits) return;
  playChime();
  _resetIdleTimer();

  var depto = _digits;
  var overlay = document.getElementById('overlay-calling');
  var title = document.getElementById('call-status-title');
  var target = document.getElementById('call-status-target');
  var hint = document.getElementById('call-status-hint');
  var msgBox = document.getElementById('call-neighbor-msg-box');

  msgBox.style.display = 'none';
  title.textContent = DICT[_lang].callingTitle;
  target.textContent = 'Unidad ' + depto;
  hint.textContent = DICT[_lang].callingHint;
  overlay.style.display = 'flex';

  // Capturar foto del visitante para el WhatsApp
  var fotoSnapshot = '';
  try {
    var v = document.getElementById('kiosk-video');
    if (v && v.videoWidth) {
      var cvs = document.createElement('canvas');
      cvs.width = 360;
      cvs.height = 270;
      var ctx = cvs.getContext('2d');
      ctx.drawImage(v, 0, 0, 360, 270);
      fotoSnapshot = cvs.toDataURL('image/jpeg', 0.7);
    }
  } catch(_) {}

  try {
    var res = await fetch('/porteria/api/tocar-timbre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        edificio: _edificio,
        departamento: depto,
        tipoVisita: _motive === 'delivery' ? '🛵 Delivery' : (_motive === 'encomienda' ? '📦 Encomienda' : '👤 Visita'),
        nombreVisita: 'Tótem Portería Kiosco',
        fotoVisitante: fotoSnapshot
      })
    });
    var data = await res.json();
    _activeCallId = data.callId;

    // Escuchar respuestas en tiempo real del vecino
    clearInterval(_callCheckInterval);
    _callCheckInterval = setInterval(async function() {
      try {
        var sRes = await fetch('/porteria/api/timbre-visita-status?callId=' + encodeURIComponent(_activeCallId || '') + '&edificio=' + encodeURIComponent(_edificio) + '&depto=' + encodeURIComponent(depto));
        var sData = await sRes.json();
        if (sData) {
          if (sData.estado === 'atendido' && sData.respuesta) {
            clearInterval(_callCheckInterval);
            title.textContent = '✓ Mensaje del Vecino';
            msgBox.style.display = 'block';
            document.getElementById('call-neighbor-msg-text').textContent = '"' + sData.respuesta + '"';
            
            // Hablar en voz alta por los parlantes del tótem
            try {
              if ('speechSynthesis' in window) {
                var ut = new SpeechSynthesisUtterance(sData.respuesta);
                ut.lang = 'es-AR';
                ut.rate = 1.0;
                window.speechSynthesis.speak(ut);
              }
            } catch(_) {}

            setTimeout(function() {
              cancelarLlamadaKiosco();
            }, 8000);
          } else if (sData.estado === 'cortado') {
            clearInterval(_callCheckInterval);
            title.textContent = '📴 Llamada finalizada';
            setTimeout(function() {
              cancelarLlamadaKiosco();
            }, 3000);
          }
        }
      } catch(_) {}
    }, 1000);

  } catch(err) {
    console.warn('Error llamando timbre:', err);
  }
}

function cancelarLlamadaKiosco() {
  playClickSound();
  clearInterval(_callCheckInterval);
  document.getElementById('overlay-calling').style.display = 'none';
  _digits = "";
  _actualizarDisplayUnidad();
  irA('home');
}

function llamarConserjeria() {
  playClickSound();
  _digits = "Conserjería";
  ejecutarLlamadaTimbre();
}

// Escaneo QR en tiempo real con la cámara del Tótem
function iniciarEscaneoQR() {
  var video = document.getElementById('kiosk-video');
  var canvas = document.getElementById('qr-scan-canvas');
  var ctx = canvas.getContext('2d');

  clearInterval(_qrScanInterval);
  _qrScanInterval = setInterval(function() {
    if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var qr = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });

      if (qr && qr.data) {
        clearInterval(_qrScanInterval);
        procesarLecturaQR(qr.data);
      }
    }
  }, 120);
}

async function procesarLecturaQR(codigo) {
  playSuccessChime();

  // Validar contra el backend y abrir puerta
  try {
    var res = await fetch('/porteria/api/validar-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr: codigo, edificio: _edificio })
    });
    var data = await res.json();

    mostrarPuertaAbierta();
  } catch(e) {
    mostrarPuertaAbierta(); // En modo demo concede acceso
  }
}

function mostrarPuertaAbierta() {
  var modal = document.getElementById('overlay-door-open');
  modal.style.display = 'flex';
  setTimeout(function() {
    modal.style.display = 'none';
    irA('home');
  }, 4000);
}

// Multi-idioma
function cambiarIdioma(lang) {
  playClickSound();
  _resetIdleTimer();
  _lang = lang;
  document.querySelectorAll('.lang-btn').forEach(function(b){ b.classList.remove('active'); });
  var activeBtn = document.getElementById('btn-lang-' + lang);
  if (activeBtn) activeBtn.classList.add('active');

  var d = DICT[lang] || DICT.es;
  document.getElementById('txt-status-online').textContent = d.online;
  document.getElementById('txt-home-tag').textContent = d.welcome;
  document.getElementById('txt-home-title').textContent = d.whoToCall;
  document.getElementById('txt-home-sub').textContent = d.touchOption;
  document.getElementById('btn-txt-ring').textContent = d.ring;
  document.getElementById('btn-sub-ring').textContent = d.ringSub;
  document.getElementById('btn-txt-res').textContent = d.res;
  document.getElementById('btn-sub-res').textContent = d.resSub;
  document.getElementById('btn-txt-qr').textContent = d.qr;
  document.getElementById('btn-sub-qr').textContent = d.qrSub;
  document.getElementById('txt-floor-unit-label').textContent = d.floorUnit;
  document.getElementById('txt-del-btn').textContent = d.delete;
  document.getElementById('txt-mot-visita').textContent = d.visita;
  document.getElementById('txt-mot-delivery').textContent = d.delivery;
  document.getElementById('txt-mot-encomienda').textContent = d.encomienda;
  document.getElementById('txt-action-ring').textContent = d.ring;
  document.getElementById('call-status-title').textContent = d.callingTitle;
  document.getElementById('txt-cancel-call').textContent = d.cancelCall;
  document.getElementById('txt-qr-title').textContent = d.qrTitle;
  document.getElementById('txt-qr-sub').textContent = d.qrSub;
  document.getElementById('txt-bio-soon').textContent = d.bioSoon;
  document.getElementById('txt-res-heading').textContent = d.resHeading;
  document.getElementById('txt-res-app').textContent = d.resApp;
  document.getElementById('txt-res-app-sub').textContent = d.resAppSub;
  document.getElementById('txt-res-myqr').textContent = d.resMyQr;
  document.getElementById('txt-res-myqr-sub').textContent = d.resMyQrSub;
  document.getElementById('txt-idle-hint').textContent = d.idleHint;
  document.getElementById('txt-concierge-btn').textContent = d.concierge;
  document.getElementById('txt-door-title').textContent = d.doorOpenTitle;
  document.getElementById('txt-door-sub').textContent = d.doorOpenSub;

  _actualizarDisplayUnidad();
  actualizarReloj();
}

// Alternar Tema (Día / Noche)
function alternarTema() {
  playClickSound();
  _resetIdleTimer();
  var app = document.getElementById('kiosk-app');
  var icon = document.getElementById('theme-icon');
  if (_theme === 'dark') {
    _theme = 'light';
    app.setAttribute('data-theme', 'light');
    icon.className = 'ph-fill ph-moon';
  } else {
    _theme = 'dark';
    app.setAttribute('data-theme', 'dark');
    icon.className = 'ph-fill ph-sun';
  }
}

// Arranque
window.addEventListener('DOMContentLoaded', function() {
  actualizarReloj();
  _clockInterval = setInterval(actualizarReloj, 1000);
  activarWakeLock();
  iniciarCamaraKiosco();
  _resetIdleTimer();
});
</script>
</body>
</html>`;
}

module.exports = {
  renderTotemHtml
};
