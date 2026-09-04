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
html,body{margin:0;padding:0;width:100%;min-height:100vh;background:#F1F5F9;color:#0F172A;font-family:'Hanken Grotesk',system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;overscroll-behavior-y:contain;-webkit-tap-highlight-color:transparent}
a{color:inherit;text-decoration:none}
button,input,textarea{font-family:inherit}

/* Animaciones */
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes typingDot{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}
@keyframes pulseRing{0%{transform:scale(0.95);box-shadow:0 0 0 0 rgba(56,189,248,0.7)}70%{transform:scale(1.05);box-shadow:0 0 0 25px rgba(56,189,248,0)}100%{transform:scale(0.95);box-shadow:0 0 0 0 rgba(56,189,248,0)}}

.anim-fade{animation:fadeIn .2s ease both}
.card{background:#ffffff;border:1px solid #E2E8F0;border-radius:18px;box-shadow:0 2px 8px rgba(15,23,42,.04)}
.card-touch:active{transform:scale(.98);transition:transform .08s ease}

/* Shell Contenedor de la App */
.app-shell{min-height:100vh;display:flex;flex-direction:column;width:100%;margin:0 auto;background:#F1F5F9}
main{width:100%;padding:14px 14px 80px;display:flex;flex-direction:column;gap:12px}

/* Barra de Navegacion Inferior para Celulares (Estilo App Nativa) */
.v-bottom-nav{
  position:fixed;bottom:0;left:0;right:0;width:100%;height:62px;background:#ffffff;
  border-top:1px solid #E2E8F0;display:flex;justify-content:space-around;align-items:center;
  z-index:50;box-shadow:0 -4px 16px rgba(15,23,42,.06);padding:0 2px;
  padding-bottom:env(safe-area-inset-bottom, 0px);
}
.v-bottom-nav a{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  flex:1;height:100%;color:#64748B;font-size:11.5px;font-weight:700;gap:3px;
  transition:all .12s ease;user-select:none;
}
.v-bottom-nav a.active{color:#0F326A;font-weight:900}
.v-bottom-nav a.active .nav-icon{transform:scale(1.1);color:#1E5FB4}
.v-bottom-nav a .nav-icon{font-size:24px;line-height:1;transition:transform .12s ease}

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

/* Soporte Horizontal (Landscape) */
@media (orientation: landscape) {
  .app-shell { width: 100% !important; max-width: 1000px !important; margin: 0 auto !important; }
  main { padding: 12px 20px 65px !important; }
  .v-bottom-nav { height: 50px !important; padding: 0 16px !important; }
  .v-bottom-nav a { font-size: 10px !important; gap: 2px !important; }
  .v-bottom-nav a .nav-icon { font-size: 18px !important; }
  #box-timbre-sonando, #box-llamada-voz-activa { max-width: 600px !important; }
}

/* Modo Instalado (PWA Standalone) */
@media (display-mode: standalone) {
  #card-instalar-pwa { display: none !important; }
}

/* Modo Oscuro - Corrección integral de alto contraste (Cero grises, letras blancas y amarillas) */
.dark-theme,
.dark-theme body {
  background: #070D1E !important;
  color: #FFFFFF !important;
}
.dark-theme .app-shell { background: #070D1E !important; }
.dark-theme .card {
  background: #0F1A30 !important;
  border-color: #1E2D4A !important;
  color: #FFFFFF !important;
  box-shadow: 0 4px 18px rgba(0,0,0,.4) !important;
}

/* Todos los elementos dentro de las tarjetas heredan blanco por defecto si no tienen estilo explícito */
.dark-theme .card span,
.dark-theme .card p,
.dark-theme .card strong,
.dark-theme .card div {
  color: #FFFFFF;
}

/* Títulos y textos oscuros inline se adaptan a blanco brillante */
.dark-theme [style*="color:#0F172A"],
.dark-theme [style*="color:#1E293B"],
.dark-theme [style*="color:#0F326A"],
.dark-theme [style*="color:#16233B"],
.dark-theme [style*="color:#000"],
.dark-theme [style*="color: #0F172A"],
.dark-theme [style*="color: #1E293B"],
.dark-theme [style*="color: #0F326A"],
.dark-theme [style*="color: #16233B"],
.dark-theme [style*="color:#000000"] {
  color: #FFFFFF !important;
}

/* Textos secundarios o descriptivos: BLANCO NÍTIDO en lugar de gris */
.dark-theme [style*="color:#64748B"],
.dark-theme [style*="color:#475569"],
.dark-theme [style*="color:#334155"],
.dark-theme [style*="color:#334259"],
.dark-theme [style*="color:#8595AD"],
.dark-theme [style*="color:#94A3B8"],
.dark-theme [style*="color: #64748B"],
.dark-theme [style*="color: #475569"],
.dark-theme [style*="color: #8595AD"],
.dark-theme [style*="color: #94A3B8"] {
  color: #FFFFFF !important; /* Blanco puro, nada de gris */
}

/* Subtítulos de sección, etiquetas uppercase y destacados: AMARILLO ORO BRILLANTE */
.dark-theme [style*="text-transform:uppercase"],
.dark-theme [style*="text-transform: uppercase"],
.dark-theme .sec-tag,
.dark-theme .servicios-titulo,
.dark-theme .tag-amarillo {
  color: #FBBF24 !important; /* Amarillo oro bien visible */
  font-weight: 800 !important;
}

/* Estados verdes normales adaptados a Verde Lima luminoso */
.dark-theme [style*="color:#15803D"],
.dark-theme [style*="color:#16A34A"],
.dark-theme [style*="color:#1B7A43"],
.dark-theme [style*="color: #15803D"],
.dark-theme [style*="color: #16A34A"],
.dark-theme [style*="color: #1B7A43"] {
  color: #4ADE80 !important; /* Verde lima brillante */
  font-weight: 700 !important;
}
.dark-theme [style*="background:#DCFCE7"],
.dark-theme [style*="background: #DCFCE7"],
.dark-theme [style*="background:#E7F4EC"],
.dark-theme [style*="background: #E7F4EC"] {
  background: rgba(34, 197, 94, 0.2) !important;
  color: #4ADE80 !important;
  border: 1px solid rgba(74, 222, 128, 0.4) !important;
}

/* Fondos blancos/claros inline dentro de tarjetas se adaptan a oscuro */
.dark-theme [style*="background:#fff"],
.dark-theme [style*="background:#ffffff"],
.dark-theme [style*="background: #fff"],
.dark-theme [style*="background: #ffffff"],
.dark-theme [style*="background:#F8FAFD"],
.dark-theme [style*="background:#FAFCFF"],
.dark-theme [style*="background:#F1F5F9"],
.dark-theme [style*="background:#F8FAFC"],
.dark-theme [style*="background: #F8FAFC"],
.dark-theme [style*="background:#FFFBEB"],
.dark-theme [style*="background: #FFFBEB"],
.dark-theme [style*="background:#FEF3C7"],
.dark-theme [style*="background: #FEF3C7"],
.dark-theme [style*="background:#EEF2FF"],
.dark-theme [style*="background: #EEF2FF"],
.dark-theme [style*="background:#EFF6FF"],
.dark-theme [style*="background: #EFF6FF"] {
  background: #15223D !important;
  border-color: #24355A !important;
}

/* Separadores de lista o tablas */
.dark-theme [style*="border-bottom:1px solid #F1F5F9"],
.dark-theme [style*="border-bottom: 1px solid #F1F5F9"],
.dark-theme [style*="border-bottom:1px solid #EEF1F6"],
.dark-theme [style*="border-bottom:1px solid #E2E8F0"] {
  border-bottom-color: #1E2D4A !important;
}

/* Bloque específico del Estado de Servicios del Edificio */
.dark-theme .card-servicios {
  background: #0F1A30 !important;
  border: 1px solid #1E2D4A !important;
}
.dark-theme .card-servicios .servicios-titulo {
  color: #FBBF24 !important; /* Amarillo oro */
}
.dark-theme .card-servicios .servicio-nombre {
  color: #FFFFFF !important; /* Blanco puro */
  font-weight: 800 !important;
}
.dark-theme .card-servicios .servicio-estado {
  color: #4ADE80 !important; /* Verde lima brillante */
  font-weight: 700 !important;
}
.dark-theme .card-servicios .servicio-item {
  border-bottom-color: #1E2D4A !important;
}

/* --- AMENITIES Y SELECTOR DE HORAS --- */
.amenity-card-item {
  border: 2px solid #E2E8F0;
  border-radius: 14px;
  padding: 12px 8px;
  cursor: pointer;
  background: #ffffff;
  text-align: center;
  transition: all .2s ease;
  user-select: none;
  box-shadow: 0 1px 3px rgba(15,23,42,.04);
}
.amenity-card-item:hover {
  transform: translateY(-2px);
  border-color: #CBD5E1;
}
.amenity-card-item .amenity-title {
  font-size: 13px;
  font-weight: 800;
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.amenity-card-item .amenity-time {
  font-size: 11px;
  color: #64748B;
  margin-top: 2px;
}
.amenity-card-item.selected {
  border: 2px solid #D97706 !important;
  background: linear-gradient(135deg, #FEF3C7, #FFFBEB) !important;
  box-shadow: 0 4px 14px rgba(217, 119, 6, 0.25) !important;
  transform: translateY(-2px);
}
.amenity-card-item.selected .amenity-title {
  color: #92400E !important;
}

/* Modo oscuro para tarjetas de Amenities */
.dark-theme .amenity-card-item {
  background: #15223D !important;
  border: 2px solid #24355A !important;
  box-shadow: 0 4px 12px rgba(0,0,0,.3);
}
.dark-theme .amenity-card-item .amenity-title {
  color: #FFFFFF !important;
}
.dark-theme .amenity-card-item .amenity-time {
  color: #FBBF24 !important; /* Horario en amarillo */
}
/* Al seleccionar o tocar en modo oscuro: Degrade con resplandor dorado / amarillo y borde resaltado */
.dark-theme .amenity-card-item.selected {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.25), rgba(217, 119, 6, 0.12)) !important;
  border: 2px solid #FBBF24 !important;
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.45), inset 0 0 10px rgba(251, 191, 36, 0.18) !important;
  transform: translateY(-2px);
}
.dark-theme .amenity-card-item.selected .amenity-title {
  color: #FFFFFF !important;
  font-weight: 900 !important;
}
.dark-theme .amenity-card-item.selected .amenity-time {
  color: #FDE047 !important;
  font-weight: 700 !important;
}

/* Botones de selección de horas (estilo butacas) */
.hora-slot-btn {
  padding: 10px 6px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 800;
  text-align: center;
  cursor: pointer;
  transition: all .15s ease;
  background: #ffffff;
  border: 1.5px solid #CBD5E1;
  color: #0F172A;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-family: inherit;
  user-select: none;
}
.hora-slot-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}
.hora-slot-btn.selected {
  background: linear-gradient(135deg, #1E5FB4, #2E6FC0) !important;
  border: 1.5px solid #1E5FB4 !important;
  color: #ffffff !important;
  box-shadow: 0 3px 10px rgba(30,95,180,.35) !important;
}
.hora-slot-btn.ocupado {
  background: #FEE2E2 !important;
  border: 1.5px solid #FCA5A5 !important;
  color: #991B1B !important;
  cursor: not-allowed !important;
  opacity: 0.85 !important;
}

/* Modo oscuro para botones de horas */
.dark-theme .hora-slot-btn {
  background: #15223D !important;
  border: 1.5px solid #24355A !important;
  color: #FFFFFF !important;
}
.dark-theme .hora-slot-btn.selected {
  background: linear-gradient(135deg, #F59E0B, #D97706) !important;
  border: 1.5px solid #FDE047 !important;
  color: #070D1E !important;
  box-shadow: 0 0 16px rgba(251, 191, 36, 0.45) !important;
}
.dark-theme .hora-slot-btn.selected span {
  color: #070D1E !important;
  font-weight: 900 !important;
}
.dark-theme .hora-slot-btn.ocupado {
  background: rgba(239, 68, 68, 0.15) !important;
  border: 1.5px solid rgba(239, 68, 68, 0.35) !important;
  color: #F87171 !important;
  opacity: 0.75 !important;
}
.dark-theme .hora-slot-btn.ocupado span {
  color: #F87171 !important;
}

.dark-theme #resumen-seleccion-horas {
  background: rgba(251, 191, 36, 0.15) !important;
  border: 1px solid rgba(251, 191, 36, 0.4) !important;
  color: #FDE047 !important;
}
.dark-theme #resumen-seleccion-horas strong,
.dark-theme #resumen-seleccion-horas span {
  color: #FFFFFF !important;
}

.dark-theme #contenido-reglamento-amenity {
  background: #0B1426 !important;
  border-color: #24355A !important;
  color: #FFFFFF !important;
}
.dark-theme #titulo-reglamento-amenity {
  color: #FBBF24 !important;
}

/* Inputs, textareas y selects en modo oscuro */
.dark-theme input.inp,
.dark-theme input[type="text"],
.dark-theme input[type="password"],
.dark-theme textarea {
  background: #0B1426 !important;
  color: #FFFFFF !important;
  border-color: #24355A !important;
}
.dark-theme input::placeholder,
.dark-theme textarea::placeholder {
  color: #94A3B8 !important;
}

.dark-theme .v-bottom-nav { background: #0F1A30 !important; border-top-color: #1E2D4A !important; }
.dark-theme .v-bottom-nav a { color: #FFFFFF !important; }
.dark-theme .chat-bubble-marcos { background: #15223D !important; border-color: #24355A !important; color: #FFFFFF !important; }

/* Switch deslizante para timbre digital */
.slider-timbre:before {
  position: absolute;
  content: "";
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: .3s;
}
input:checked + .slider-timbre:before {
  transform: translateX(22px);
}

/* --- ESTILOS TIMBRE Y GESTIÓN DE OCUPANTES --- */
.timbre-horario-row {
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 14px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.timbre-horario-label {
  color: #1E293B;
  font-size: 12px;
  font-weight: 800;
}
.timbre-de-label, .timbre-a-label {
  color: #64748B;
  font-size: 11px;
  font-weight: 700;
}
.inp-time-timbre {
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 700;
  color: #0F172A;
  background: #ffffff;
}

.ocupante-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 6px;
}
.ocupante-nombre {
  font-size: 13px;
  font-weight: 800;
  color: #0F172A;
}
.ocupante-contacto {
  font-size: 11px;
  color: #64748B;
  margin-top: 2px;
  font-weight: 600;
}
.ocupante-timbre-status.timbre-on {
  font-size: 11px;
  font-weight: 800;
  color: #15803D;
}
.ocupante-timbre-status.timbre-off {
  font-size: 11px;
  font-weight: 800;
  color: #94A3B8;
}
.badge-ocupante {
  font-size: 10.5px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
}
.badge-ocupante-propietario { background: #DCFCE7; color: #15803D; border: 1px solid #86EFAC; }
.badge-ocupante-inquilino { background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; }
.badge-ocupante-asistente { background: #E0E7FF; color: #3730A3; border: 1px solid #C7D2FE; }
.badge-ocupante-turista { background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; }

.btn-ocupante-action {
  padding: 11px 10px;
  border-radius: 12px;
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all .15s ease;
  user-select: none;
}
.btn-ocupante-familiar {
  border: 1.5px solid #CBD5E1;
  background: #F8FAFC;
  color: #0F172A;
}
.btn-ocupante-familiar i { font-size: 17px; color: #2563EB; }
.btn-ocupante-huesped {
  border: 1.5px solid #FCD34D;
  background: #FFFBEB;
  color: #92400E;
}
.btn-ocupante-huesped i { font-size: 17px; color: #D97706; }
.btn-ocupante-reubicar {
  width: 100%;
  margin-top: 8px;
  padding: 11px;
  border: 1.5px dashed #6366F1;
  background: #EEF2FF;
  color: #4F46E5;
  font-size: 12.5px;
}
.btn-ocupante-reubicar i { font-size: 17px; color: #4F46E5; }

/* MODO OSCURO PARA TIMBRE Y OCUPANTES */
.dark-theme .timbre-horario-row {
  background: #15223D !important;
  border: 1px solid #24355A !important;
}
.dark-theme .timbre-horario-label {
  color: #FBBF24 !important; /* Amarillo oro brillante */
  font-weight: 800 !important;
}
.dark-theme .timbre-de-label,
.dark-theme .timbre-a-label {
  color: #FFFFFF !important; /* Blanco puro */
  font-weight: 700 !important;
}
.dark-theme .inp-time-timbre {
  background: #0B1426 !important;
  border: 1.5px solid #3B82F6 !important;
  color: #FFFFFF !important;
  color-scheme: dark !important;
}

.dark-theme .ocupante-item-row {
  background: #15223D !important;
  border: 1px solid #24355A !important;
}
.dark-theme .ocupante-nombre {
  color: #FFFFFF !important;
  font-weight: 900 !important;
}
.dark-theme .ocupante-contacto {
  color: #FBBF24 !important; /* Amarillo en vez de gris */
  font-weight: 700 !important;
}
.dark-theme .ocupante-timbre-status.timbre-on {
  color: #4ADE80 !important;
  font-weight: 800 !important;
}
.dark-theme .ocupante-timbre-status.timbre-off {
  color: #F87171 !important;
  font-weight: 800 !important;
}

.dark-theme .badge-ocupante-propietario {
  background: rgba(34, 197, 94, 0.2) !important;
  color: #4ADE80 !important;
  border: 1px solid rgba(74, 222, 128, 0.5) !important;
}
.dark-theme .badge-ocupante-inquilino {
  background: rgba(59, 130, 246, 0.2) !important;
  color: #60A5FA !important;
  border: 1px solid rgba(96, 165, 250, 0.5) !important;
}
.dark-theme .badge-ocupante-asistente {
  background: rgba(129, 140, 248, 0.2) !important;
  color: #A5B4FC !important;
  border: 1px solid rgba(165, 180, 252, 0.5) !important;
}
.dark-theme .badge-ocupante-turista {
  background: rgba(245, 158, 11, 0.25) !important;
  color: #FDE047 !important;
  border: 1px solid #F59E0B !important;
}

/* Botones en modo oscuro: fondo oscuro profundo con bordes y tipografía resaltada */
.dark-theme .btn-ocupante-familiar {
  background: #172554 !important;
  border: 1.5px solid #3B82F6 !important;
  color: #FFFFFF !important;
}
.dark-theme .btn-ocupante-familiar span {
  color: #FFFFFF !important;
  font-weight: 800 !important;
}
.dark-theme .btn-ocupante-familiar i {
  color: #60A5FA !important;
}

.dark-theme .btn-ocupante-huesped {
  background: #2E1B05 !important;
  border: 1.5px solid #F59E0B !important;
  color: #FBBF24 !important;
}
.dark-theme .btn-ocupante-huesped span {
  color: #FBBF24 !important;
  font-weight: 900 !important;
}
.dark-theme .btn-ocupante-huesped i {
  color: #FBBF24 !important;
}

.dark-theme .btn-ocupante-reubicar {
  background: #1E1B4B !important;
  border: 1.5px dashed #818CF8 !important;
  color: #FFFFFF !important;
}
.dark-theme .btn-ocupante-reubicar span {
  color: #FFFFFF !important;
  font-weight: 800 !important;
}
.dark-theme .btn-ocupante-reubicar i {
  color: #A5B4FC !important;
}
`;

function getVecinoSession(req) {
  if (req.session && req.session.vecino) {
    return req.session.vecino;
  }
  // Default de prueba con soporte multi-unidad
  return {
    usuario_id: 1,
    nombre: 'Daniel Morales',
    email: 'daniel@consorcio.ai',
    telefono: '+5491150542005',
    edificio: 'San Patricio 159',
    departamento: '1° A',
    rol: 'propietario',
    puede_ver_expensas: true,
    timbre_activo: true,
    timbre_silencio_desde: '23:00',
    timbre_silencio_hasta: '07:30',
    saldoExpensa: '$120.000,00',
    estadoExpensa: 'Al día',
    unidades: [
      { edificio: 'San Patricio 159', departamento: '1° A', rol: 'propietario', puede_ver_expensas: true },
      { edificio: 'San Patricio 159', departamento: '4° C', rol: 'propietario', puede_ver_expensas: true }
    ]
  };
}

function shellVecino(title, activeTab, content, vecinoData) {
  const v = vecinoData || getVecinoSession({});

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
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900&display=swap" rel="stylesheet">
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
  });
  window.addEventListener('appinstalled', function() {
    localStorage.setItem('pwa_installed', 'true');
    var b = document.getElementById('card-instalar-pwa');
    if (b) b.style.display = 'none';
    window._deferredPrompt = null;
  });
  document.addEventListener('DOMContentLoaded', function() {
    var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches || localStorage.getItem('pwa_installed') === 'true';
    if (isStandalone) {
      var b = document.getElementById('card-instalar-pwa');
      if (b) b.style.display = 'none';
    }
  });
  window.instalarPwa = function() {
    if (window._deferredPrompt) {
      window._deferredPrompt.prompt();
      window._deferredPrompt.userChoice.then(function(choiceResult) {
        if (choiceResult.outcome === 'accepted') {
          localStorage.setItem('pwa_installed', 'true');
          var b = document.getElementById('card-instalar-pwa');
          if (b) b.style.display = 'none';
        }
        window._deferredPrompt = null;
      });
    } else {
      var ua = navigator.userAgent.toLowerCase();
      if (ua.includes('firefox')) {
        alert('🦊 Para instalar en Firefox:\\n\\n1. Tocá el menú de 3 puntos (⋮) arriba a la derecha en Firefox.\\n2. Seleccioná "Instalar" (o el icono de casa con + en la barra).');
      } else if (/iphone|ipad|ipod/.test(ua)) {
        alert('🍏 Para instalar en iPhone / Safari:\\n\\n1. Tocá el botón Compartir (el cuadrado con la flecha hacia arriba).\\n2. Elegí "Agregar a la pantalla de inicio".');
      } else {
        alert('📲 Para instalar la app:\\n\\n1. Tocá el menú de 3 puntos (⋮) de tu navegador.\\n2. Seleccioná "Instalar aplicación" o "Agregar a pantalla principal".');
      }
    }
  };
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function(e){ console.warn('SW:', e); });
    });
  }
</script>
</head>
<body>
<div class="app-shell">
  
  <!-- TOPBAR VECINO (Estilo Mercado Pago con Cabecera Azul Consorcio) -->
  <header style="background:linear-gradient(180deg,#0F326A 0%,#1A4A8F 100%);color:#ffffff;padding:16px 16px 20px;position:sticky;top:0;z-index:40;box-shadow:0 4px 15px rgba(15,50,106,.2)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:#fff">
          ${v.nombre.split(' ').map(n=>n[0]).slice(0,2).join('')}
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:16px;font-weight:900;line-height:1.2;letter-spacing:-.01em">Hola, ${v.nombre.split(' ')[0]} 👋</span>
            ${v.rol === 'turista' ? '<span style="font-size:10px;font-weight:800;background:#38BDF8;color:#0F172A;padding:1px 6px;border-radius:6px">🧳 Huésped</span>' :
              v.rol === 'asistente' ? '<span style="font-size:10px;font-weight:800;background:#FBBF24;color:#0F172A;padding:1px 6px;border-radius:6px">🏢 Gestor</span>' :
              v.rol === 'inquilino' ? '<span style="font-size:10px;font-weight:800;background:#4ADE80;color:#0F172A;padding:1px 6px;border-radius:6px">🔑 Inquilino</span>' :
              '<span style="font-size:10px;font-weight:800;background:rgba(255,255,255,.25);color:#fff;padding:1px 6px;border-radius:6px">👑 Propietario</span>'}
          </div>
          ${v.unidades && v.unidades.length > 1 ? `
          <button type="button" onclick="abrirModalCambiarUnidad()" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#FBBF24;margin-top:3px;background:rgba(0,0,0,.3);border:1px solid rgba(251,191,36,0.5);border-radius:6px;padding:2px 8px;cursor:pointer">
            <span>🏢 ${esc(v.edificio)} · Depto ${esc(v.departamento)}</span>
            <span style="font-size:9px">▼</span>
          </button>
          ` : `
          <div style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:rgba(255,255,255,.85);margin-top:2px">
            <span>${esc(v.edificio)}</span> · <span style="background:rgba(255,255,255,.2);padding:1px 6px;border-radius:6px">Depto ${esc(v.departamento)}</span>
          </div>
          `}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button onclick="toggleTheme()" style="width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.15);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff">
          <i class="ph ph-moon" style="font-size:18px"></i>
        </button>
        <a href="/vecino/logout" title="Cerrar sesión" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;color:#fff;text-decoration:none">
          <i class="ph ph-sign-out" style="font-size:18px"></i>
        </a>
      </div>
    </div>
  </header>

  <!-- CONTENIDO PRINCIPAL -->
  <main style="flex:1" class="anim-fade">
    ${content}
  </main>

  <!-- BARRA DE NAVEGACION INFERIOR (Estilo Mercado Pago con Botón QR Central) -->
  <nav class="v-bottom-nav">
    <a href="/vecino" class="${activeTab === 'inicio' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-house${activeTab === 'inicio' ? '-fill' : ''}"></i></span>
      <span>Inicio</span>
    </a>
    <a href="/vecino/chat" class="${activeTab === 'chat' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-chat-circle-dots${activeTab === 'chat' ? '-fill' : ''}"></i></span>
      <span>Marcos IA</span>
    </a>
    
    <!-- Botón Central QR Portería -->
    <a href="/porteria/${encodeURIComponent(v.edificio || 'San Patricio 159')}" style="position:relative;top:-10px;text-decoration:none">
      <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(15,50,106,.35);border:3px solid #fff">
        <i class="ph ph-qr-code" style="font-size:26px"></i>
      </div>
      <span style="font-size:10.5px;font-weight:800;color:#0F326A;margin-top:2px">Portería</span>
    </a>

    <a href="/vecino/amenities" class="${activeTab === 'amenities' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-calendar-check${activeTab === 'amenities' ? '-fill' : ''}"></i></span>
      <span>Amenities</span>
    </a>
    ${v.puede_ver_expensas !== false ? `
    <a href="/vecino/expensas" class="${activeTab === 'expensas' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-receipt${activeTab === 'expensas' ? '-fill' : ''}"></i></span>
      <span>Expensas</span>
    </a>` : `
    <a href="/vecino/novedades" class="${activeTab === 'novedades' ? 'active' : ''}">
      <span class="nav-icon"><i class="ph ph-bell-simple${activeTab === 'novedades' ? '-fill' : ''}"></i></span>
      <span>Avisos</span>
    </a>`}
  </nav>

  <!-- MODAL CAMBIAR UNIDAD (MULTI-PROPIEDAD) -->
  ${v.unidades && v.unidades.length > 1 ? `
  <div id="modal-cambiar-unidad" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;align-items:center;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:20px;max-width:380px;width:100%;padding:22px 20px;box-shadow:0 12px 35px rgba(0,0,0,0.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-size:16px;font-weight:900;color:#0F172A">Seleccionar Propiedad</div>
          <div style="font-size:12px;color:#64748B">Cambiá de departamento en 1 toque</div>
        </div>
        <button type="button" onclick="cerrarModalCambiarUnidad()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748B">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${v.unidades.map(u => {
          const isActiva = u.edificio.toLowerCase() === v.edificio.toLowerCase() && u.departamento.toLowerCase() === v.departamento.toLowerCase();
          return `
          <div onclick="seleccionarUnidadActiva('${escJs(u.edificio)}', '${escJs(u.departamento)}')" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:12px;border:2px solid ${isActiva ? '#2E6FC0' : '#E2E8F0'};background:${isActiva ? '#EFF6FF' : '#F8FAFD'};cursor:pointer">
            <div>
              <div style="font-size:14px;font-weight:800;color:${isActiva ? '#1E40AF' : '#0F172A'}">${esc(u.edificio)}</div>
              <div style="font-size:12px;color:#64748B">Depto <strong>${esc(u.departamento)}</strong> · Rol: <strong>${esc(u.rol || 'propietario')}</strong></div>
            </div>
            ${isActiva ? '<span style="font-size:12px;color:#2E6FC0;font-weight:900">✓ Activo</span>' : ''}
          </div>
          `;
        }).join('')}
      </div>
    </div>
  </div>
  <script>
    function abrirModalCambiarUnidad() {
      var m = document.getElementById('modal-cambiar-unidad');
      if (m) m.style.display = 'flex';
    }
    function cerrarModalCambiarUnidad() {
      var m = document.getElementById('modal-cambiar-unidad');
      if (m) m.style.display = 'none';
    }
    async function seleccionarUnidadActiva(edificio, depto) {
      try {
        var res = await fetch('/vecino/api/cambiar-unidad', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: edificio, departamento: depto })
        });
        var data = await res.json();
        if (data && data.ok) location.reload();
      } catch(_) { location.reload(); }
    }
  </script>
  ` : ''}

  <!-- MODAL LLAMADA ENTRANTE DE PORTERÍA (TIMBRE VIRTUAL & VOZ WEBRTC FULLSCREEN) -->
  <audio id="audio-webrtc-vecino" autoplay playsinline style="display:none"></audio>
  <div id="modal-llamada-timbre" style="position:fixed;inset:0;width:100vw;height:100vh;background:linear-gradient(165deg,#0A1F44 0%,#0F326A 50%,#1E5FB4 100%);z-index:99999;display:none;flex-direction:column;align-items:center;justify-content:space-between;padding:36px 20px 24px;color:#fff;text-align:center;box-sizing:border-box;overflow-y:auto">
    
    <!-- 1. Estado: Sonando Timbre -->
    <div id="box-timbre-sonando" style="display:flex;flex-direction:column;align-items:center;width:100%;max-width:440px;margin:auto 0">
      
      <!-- Captura Facial Anti-Broma de Quién Toca -->
      <div id="box-foto-visita-preview" style="text-align:center;margin-bottom:14px;display:none">
        <img id="img-foto-visita" src="" style="width:125px;height:125px;border-radius:20px;object-fit:cover;border:3px solid #38BDF8;box-shadow:0 8px 24px rgba(0,0,0,.4);margin:0 auto 6px;display:block">
        <span style="font-size:11px;font-weight:800;background:rgba(255,255,255,.2);color:#fff;padding:2px 10px;border-radius:999px">📸 Captura en la Puerta</span>
      </div>

      <div id="avatar-timbre-default" style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,#2563EB,#38BDF8);display:flex;align-items:center;justify-content:center;font-size:48px;margin-bottom:16px;box-shadow:0 0 50px rgba(56,189,248,.6);animation:pulseRing 1.2s infinite">
        🔔
      </div>
      <div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#38BDF8;margin-bottom:6px">TIMBRE ENTRANTE EN PORTERÍA</div>
      <h2 style="font-size:24px;font-weight:900;margin-bottom:4px" id="llamada-timbre-visita">🛵 Delivery en Puerta</h2>
      <p style="font-size:15px;color:#E2E8F0;margin-bottom:20px">${v.edificio} · Depto ${v.departamento}</p>

      <!-- Botón Hablar en Vivo -->
      <button onclick="iniciarLlamadaVozVecino()" style="width:100%;height:56px;border:none;border-radius:16px;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-size:17px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 6px 22px rgba(22,163,74,.5);margin-bottom:18px">
        <i class="ph ph-phone-call-fill" style="font-size:24px"></i>
        <span>HABLAR EN VIVO (Llamada)</span>
      </button>

      <div style="font-size:12px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">O responder con texto rápido:</div>

      <!-- Respuestas Rápidas de Texto -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;margin-bottom:12px">
        <button onclick="responderTimbreVecino('¡Ya bajo!')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🏃 ¡Ya bajo!</span>
        </button>
        <button onclick="responderTimbreVecino('Dejalo en el hall / puerta')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🚪 En el hall</span>
        </button>
        <button onclick="responderTimbreVecino('Dejar con el encargado')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>📬 Encargado</span>
        </button>
        <button onclick="responderTimbreVecino('No estoy en el departamento')" style="height:44px;border:1.5px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🚫 No estoy</span>
        </button>
      </div>

      <!-- Campo de Respuesta Personalizada Libre -->
      <div style="display:flex;gap:8px;width:100%;margin-bottom:18px">
        <input id="input-resp-personalizada" type="text" placeholder="Escribir mensaje personalizado..." style="flex:1;height:46px;background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);border-radius:12px;padding:0 14px;color:#fff;font-size:14px;outline:none" onkeydown="if(event.key==='Enter')enviarTextoLibreVecino()">
        <button onclick="enviarTextoLibreVecino()" style="padding:0 16px;height:46px;background:#2563EB;border:none;border-radius:12px;color:#fff;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px">
          <span>Enviar</span>
          <i class="ph ph-paper-plane-right-fill" style="font-size:16px"></i>
        </button>
      </div>

      <button onclick="silenciarTimbreVecino()" style="background:transparent;border:none;color:#94A3B8;font-size:13px;font-weight:700;cursor:pointer;padding:8px 16px">
        ✕ Silenciar / Rechazar
      </button>
    </div>

    <!-- 2. Estado: En Llamada de Voz y Video Activa -->
    <div id="box-llamada-voz-activa" style="display:none;flex-direction:column;align-items:center;width:100%;max-width:440px;margin:auto 0">
      
      <!-- Videoportero: Transmisión en Vivo desde la Puerta -->
      <div id="box-video-webrtc" style="width:100%;max-width:320px;margin-bottom:14px;position:relative;border-radius:18px;overflow:hidden;background:#000;aspect-ratio:4/3;box-shadow:0 8px 24px rgba(0,0,0,.4);display:none">
        <video id="video-webrtc-vecino" autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;top:8px;left:8px;display:flex;align-items:center;gap:5px;background:rgba(0,0,0,.6);color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800">
          <span style="width:7px;height:7px;border-radius:50%;background:#EF4444;animation:pulseRing 1.2s infinite"></span>
          <span>CÁMARA DE PUERTA</span>
        </div>
      </div>

      <div id="avatar-voz-container" style="width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,#15803D,#16A34A);display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:12px;box-shadow:0 0 40px rgba(22,163,74,.5)">
        🎙️
      </div>
      <div style="font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#86EFAC;margin-bottom:2px">LLAMADA ENTRANTE EN VIVO</div>
      <h2 style="font-size:20px;font-weight:900;margin-bottom:2px">Frente de Calle</h2>
      <div id="voz-timer" style="font-size:18px;font-family:monospace;font-weight:800;color:#38BDF8;margin-bottom:18px">00:00</div>

      <div style="display:flex;gap:10px;margin-bottom:16px;width:100%">
        <button id="btn-mute-voz" onclick="toggleMuteVoz()" style="flex:1;height:48px;border-radius:12px;border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🎙️ Silenciar Mic</span>
        </button>
        <button onclick="responderTimbreVecino('¡Ya bajo!')" style="flex:1;height:48px;border-radius:12px;border:none;background:#2563EB;color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span>🏃 ¡Ya bajo!</span>
        </button>
      </div>

      <button onclick="cortarLlamadaVoz()" style="width:100%;height:52px;border:none;border-radius:14px;background:#DC2626;color:#fff;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 20px rgba(220,38,38,.5)">
        <i class="ph ph-phone-disconnect-fill" style="font-size:22px"></i>
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

    function unlockAudio() {
      try {
        if (!_audioCtx) {
          _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') {
          _audioCtx.resume();
        }
      } catch(_) {}
    }
    document.addEventListener('click', unlockAudio, { passive: true });
    document.addEventListener('touchstart', unlockAudio, { passive: true });

    function sonarRingtone() {
      try {
        unlockAudio();
        if (_audioCtx) {
          var osc = _audioCtx.createOscillator();
          var gain = _audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, _audioCtx.currentTime);
          osc.frequency.setValueAtTime(659.25, _audioCtx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.5, _audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.6);
          osc.connect(gain);
          gain.connect(_audioCtx.destination);
          osc.start();
          osc.stop(_audioCtx.currentTime + 0.6);
        }

        if (navigator.vibrate) {
          navigator.vibrate([400, 200, 400, 200, 800]);
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

    window.enviarTextoLibreVecino = function() {
      var inp = document.getElementById('input-resp-personalizada');
      var txt = inp ? inp.value.trim() : '';
      if (!txt) txt = '¡Ya bajo!';
      responderTimbreVecino(txt);
      if (inp) inp.value = '';
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
          if (event.track.kind === 'video') {
            var remoteVideo = document.getElementById('video-webrtc-vecino');
            var boxVideo = document.getElementById('box-video-webrtc');
            var avatarVoz = document.getElementById('avatar-voz-container');
            if (remoteVideo && event.streams[0]) {
              remoteVideo.srcObject = event.streams[0];
              if (boxVideo) boxVideo.style.display = 'block';
              if (avatarVoz) avatarVoz.style.display = 'none';
            }
          } else if (event.track.kind === 'audio') {
            var remoteAudio = document.getElementById('audio-webrtc-vecino');
            if (remoteAudio && event.streams[0]) {
              remoteAudio.srcObject = event.streams[0];
              remoteAudio.play().catch(function(e){ console.warn('Audio play:', e); });
            }
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
        var _pendingAnsCandidates = [];
        var sigInterval = setInterval(async function(){
          if (!_peerConn) { clearInterval(sigInterval); return; }
          try {
            var sRes = await fetch('/porteria/api/webrtc-signal?edificio=' + encodeURIComponent(_edificioVecino) + '&depto=' + encodeURIComponent(_deptoVecino) + '&forRole=vecino&since=' + lastSince);
            var sData = await sRes.json();
            if (sData && sData.signals && sData.signals.length) {
              for (var i = 0; i < sData.signals.length; i++) {
                var sigObj = sData.signals[i].signal;
                lastSince = Math.max(lastSince, sData.signals[i].timestamp);
                if (sigObj.type === 'hangup' || sigObj.type === 'corte') {
                  clearInterval(sigInterval);
                  detenerRingtoneLoop();
                  clearInterval(_timerInterval);
                  if (_peerConn) { _peerConn.close(); _peerConn = null; }
                  if (_localStream) { _localStream.getTracks().forEach(function(t){ t.stop(); }); _localStream = null; }
                  var remoteVideo = document.getElementById('video-webrtc-vecino');
                  if (remoteVideo) remoteVideo.srcObject = null;
                  var boxVideo = document.getElementById('box-video-webrtc');
                  if (boxVideo) boxVideo.style.display = 'none';

                  var boxVoz = document.getElementById('box-llamada-voz-activa');
                  if (boxVoz) {
                    boxVoz.innerHTML = '<div style="padding:24px 16px;text-align:center">' +
                      '<div style="font-size:42px;margin-bottom:10px">📴</div>' +
                      '<h2 style="font-size:22px;font-weight:900;margin-bottom:6px">La visita finalizó la llamada</h2>' +
                      '<p style="font-size:14px;color:#CBD5E1;margin-bottom:20px">El micrófono se apagó correctamente.</p>' +
                      '<button onclick="cortarLlamadaVoz()" style="padding:12px 28px;border:none;border-radius:14px;background:#2563EB;color:#fff;font-weight:800;font-size:15px;cursor:pointer">Aceptar / Cerrar</button>' +
                    '</div>';
                  }
                  setTimeout(function(){
                    cortarLlamadaVoz();
                  }, 4500);
                  return;
                } else if (sigObj.type === 'answer' && _peerConn.signalingState === 'have-local-offer') {
                  await _peerConn.setRemoteDescription(new RTCSessionDescription(sigObj.sdp));
                  while (_pendingAnsCandidates.length > 0) {
                    var c = _pendingAnsCandidates.shift();
                    await _peerConn.addIceCandidate(new RTCIceCandidate(c)).catch(function(){});
                  }
                } else if (sigObj.type === 'candidate' && sigObj.candidate) {
                  if (_peerConn.remoteDescription && _peerConn.remoteDescription.type) {
                    await _peerConn.addIceCandidate(new RTCIceCandidate(sigObj.candidate)).catch(function(){});
                  } else {
                    _pendingAnsCandidates.push(sigObj.candidate);
                  }
                }
              }
            }
          } catch(_) {}
        }, 800);

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
      detenerRingtoneLoop();
      clearInterval(_timerInterval);

      try {
        fetch('/porteria/api/timbre-cortar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edificio: _edificioVecino, depto: _deptoVecino, from: 'vecino' })
        }).catch(function(){});
      } catch(_) {}

      if (_peerConn) {
        _peerConn.close();
        _peerConn = null;
      }
      if (_localStream) {
        _localStream.getTracks().forEach(function(t){ t.stop(); });
        _localStream = null;
      }
      var remoteVideo = document.getElementById('video-webrtc-vecino');
      if (remoteVideo) remoteVideo.srcObject = null;
      var boxVideo = document.getElementById('box-video-webrtc');
      if (boxVideo) boxVideo.style.display = 'none';

      document.getElementById('box-timbre-sonando').style.display = 'flex';
      document.getElementById('box-llamada-voz-activa').style.display = 'none';
      document.getElementById('modal-llamada-timbre').style.display = 'none';
      _llamadaMostradaId = '';
    };

    // Polling de timbres entrantes cada 2 seg
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

            // Mostrar captura facial en puerta si está disponible
            var imgFoto = document.getElementById('img-foto-visita');
            var boxFoto = document.getElementById('box-foto-visita-preview');
            var avDef = document.getElementById('avatar-timbre-default');
            if (data.llamada.fotoVisitante && imgFoto && boxFoto) {
              imgFoto.src = data.llamada.fotoVisitante;
              boxFoto.style.display = 'block';
              if (avDef) avDef.style.display = 'none';
            } else {
              if (boxFoto) boxFoto.style.display = 'none';
              if (avDef) avDef.style.display = 'flex';
            }

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
    }, 2000);
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

  <audio id="audio-webrtc-vecino" autoplay playsinline style="display:none"></audio>
</div>
</body>
</html>`;
}

// -------------------------------------------------------------------
// 1. LOGIN CON CREDENCIALES
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// 1. LOGIN CON WHATSAPP Y CÓDIGO PIN (OTP)
// -------------------------------------------------------------------
const _pinesLogin = new Map(); // tel -> { pin, vecino, expira }

function normalizarTelArg(t) {
  let num = String(t || '').replace(/\D/g, '');
  if (num.startsWith('0')) num = num.slice(1);
  if (num.startsWith('15')) num = '11' + num.slice(2);
  if (!num.startsWith('549') && num.startsWith('54')) num = '549' + num.slice(2);
  if (!num.startsWith('549')) num = '549' + num;
  return num;
}

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
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0F326A;background:linear-gradient(165deg,#070D1E 0%,#0F326A 45%,#1B4D9B 100%);color:#fff;font-family:'Hanken Grotesk',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:#ffffff;color:#16233B;border-radius:24px;padding:30px 22px;width:100%;max-width:420px;box-shadow:0 25px 60px rgba(0,0,0,.45)}
.inp{width:100%;height:46px;border:1.5px solid #DDE3EE;border-radius:12px;padding:0 14px;font-size:14.5px;color:#16233B;background:#F8FAFD;outline:none;margin-bottom:12px;font-family:inherit}
.inp:focus{border-color:#2E6FC0;background:#fff;box-shadow:0 0 0 4px rgba(46,111,192,.12)}
.btn-primary{width:100%;height:48px;border:none;border-radius:12px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;font-size:15px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 14px rgba(15,50,106,.3);font-family:inherit}
.btn-secondary{width:100%;height:44px;border:1.5px solid #E2E8F0;border-radius:12px;background:#F8FAFD;color:#475569;font-size:13.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit}
.btn-pwa{width:100%;height:40px;border:1.5px solid #BFDBFE;border-radius:12px;background:#EFF6FF;color:#1E5FB4;font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:14px}
.pin-box{width:100%;height:54px;border:2px solid #2E6FC0;border-radius:14px;font-size:26px;font-weight:900;text-align:center;letter-spacing:14px;color:#0F326A;background:#F8FAFD;outline:none;margin-bottom:16px}
</style>
</head>
<body>
<div class="login-card">
  <div style="text-align:center;margin-bottom:18px">
    <div style="width:54px;height:54px;border-radius:18px;background:linear-gradient(135deg,#0F326A,#2E6FC0);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:26px;margin-bottom:10px;box-shadow:0 8px 20px rgba(15,50,106,.25)">
      🏢
    </div>
    <h1 style="font-size:21px;font-weight:900;letter-spacing:-.02em;margin-bottom:2px;color:#0F326A">Mi Consorcio</h1>
    <p style="font-size:12.5px;color:#64748B">Acceso para Propietarios, Inquilinos y Gestores</p>
  </div>

  <button type="button" class="btn-pwa" onclick="instalarPwaLogin()">
    <span>📲 Instalar App en mi Celular</span>
  </button>

  <!-- PESTAÑAS: EMAIL vs WHATSAPP -->
  <div style="display:flex;background:#F1F5F9;border-radius:12px;padding:4px;margin-bottom:16px;gap:4px">
    <button type="button" id="tab-btn-email" onclick="cambiarTabLogin('email')" style="flex:1;padding:8px 6px;border:none;border-radius:10px;font-weight:800;font-size:12.5px;cursor:pointer;background:#fff;color:#0F326A;box-shadow:0 1px 3px rgba(0,0,0,.08)">
      ✉️ Con Email
    </button>
    <button type="button" id="tab-btn-wa" onclick="cambiarTabLogin('wa')" style="flex:1;padding:8px 6px;border:none;border-radius:10px;font-weight:800;font-size:12.5px;cursor:pointer;background:transparent;color:#64748B">
      💬 WhatsApp PIN
    </button>
  </div>

  <!-- SECCIÓN 1: LOGIN Y REGISTRO CON EMAIL -->
  <div id="seccion-email">
    <!-- Formulario Iniciar Sesión -->
    <div id="box-login-email">
      <form onsubmit="loginConEmail(event)">
        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Correo Electrónico</label>
        <input id="inp-login-email" type="email" class="inp" placeholder="ejemplo@correo.com" required value="daniel@consorcio.ai">

        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Contraseña</label>
        <input id="inp-login-pass" type="password" class="inp" placeholder="••••••••" required value="admin123">

        <button id="btn-submit-login-email" type="submit" class="btn-primary" style="margin-bottom:12px">
          <i class="ph ph-sign-in" style="font-size:20px"></i>
          <span>Ingresar con Email</span>
        </button>
      </form>

      <div style="text-align:center;margin-top:10px">
        <button type="button" onclick="mostrarRegistroEmail(true)" style="background:none;border:none;color:#1E5FB4;font-size:12.5px;font-weight:700;cursor:pointer">
          ¿No tenés cuenta? Registrate acá
        </button>
      </div>
    </div>

    <!-- Formulario Registro Nuevo Usuario -->
    <div id="box-registro-email" style="display:none">
      <form onsubmit="registrarConEmail(event)">
        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Nombre Completo</label>
        <input id="inp-reg-nombre" type="text" class="inp" placeholder="Ej: Juan Pérez" required>

        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Correo Electrónico</label>
        <input id="inp-reg-email" type="email" class="inp" placeholder="juan@correo.com" required>

        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Celular / WhatsApp (para avisos y timbres)</label>
        <input id="inp-reg-tel" type="tel" class="inp" placeholder="Ej: 11 5054-2005" required>

        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Contraseña</label>
        <input id="inp-reg-pass" type="password" class="inp" placeholder="Mínimo 6 caracteres" required>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Depto</label>
            <input id="inp-reg-depto" type="text" class="inp" placeholder="Ej: 1° A" required value="1° A">
          </div>
          <div>
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Rol</label>
            <select id="inp-reg-rol" class="inp" style="padding:0 8px">
              <option value="propietario">Propietario</option>
              <option value="inquilino">Inquilino</option>
              <option value="asistente">Gestor / Asistente</option>
            </select>
          </div>
        </div>

        <button id="btn-submit-reg" type="submit" class="btn-primary" style="margin-bottom:10px">
          <span>Crear Cuenta e Ingresar</span>
        </button>
      </form>

      <div style="text-align:center;margin-top:6px">
        <button type="button" onclick="mostrarRegistroEmail(false)" style="background:none;border:none;color:#64748B;font-size:12.5px;font-weight:700;cursor:pointer">
          ← Ya tengo cuenta, volver
        </button>
      </div>
    </div>
  </div>

  <!-- SECCIÓN 2: LOGIN CON WHATSAPP Y PIN -->
  <div id="seccion-wa" style="display:none">
    <!-- PASO 1: INGRESAR TELÉFONO -->
    <div id="paso-1-telefono">
      <form onsubmit="solicitarPinWhatsApp(event)">
        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Número de Celular</label>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <div style="height:46px;padding:0 10px;background:#F1F5F9;border:1.5px solid #DDE3EE;border-radius:12px;display:flex;align-items:center;gap:4px;font-weight:800;font-size:13.5px;color:#334155">
            <span>🇦🇷</span> +54
          </div>
          <input id="inp-login-tel" type="tel" class="inp" style="margin-bottom:0" placeholder="Ej: 11 5054-2005">
        </div>

        <button id="btn-pedir-pin" type="submit" class="btn-primary" style="margin-bottom:12px">
          <i class="ph ph-whatsapp-logo" style="font-size:20px"></i>
          <span>Recibir Código por WhatsApp</span>
        </button>
      </form>
    </div>

    <!-- PASO 2: INGRESAR CÓDIGO DE 4 DÍGITOS -->
    <div id="paso-2-pin" style="display:none">
      <div style="background:#DCFCE7;border:1px solid #86EFAC;border-radius:14px;padding:12px;margin-bottom:14px;text-align:center">
        <div style="font-size:12px;color:#15803D;font-weight:800;margin-bottom:2px">Te enviamos el código a tu WhatsApp:</div>
        <div id="txt-tel-destino" style="font-size:13.5px;font-weight:900;color:#166534"></div>
        <div id="txt-pin-hint" style="font-size:11px;color:#15803D;margin-top:4px;font-weight:700;display:none"></div>
      </div>

      <form onsubmit="verificarPinWhatsApp(event)">
        <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:8px;text-align:center">Código de 4 Dígitos</label>
        <input id="inp-login-pin" type="text" maxlength="4" class="pin-box" placeholder="••••" autofocus>

        <button id="btn-verificar-pin" type="submit" class="btn-primary" style="margin-bottom:12px">
          <i class="ph ph-lock-key-open" style="font-size:20px"></i>
          <span>Ingresar con PIN</span>
        </button>
      </form>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <button type="button" onclick="volverPaso1()" style="background:none;border:none;color:#64748B;font-size:12px;font-weight:700;cursor:pointer">
          ← Cambiar número
        </button>
        <button type="button" onclick="reenviarPinWhatsApp()" style="background:none;border:none;color:#1E5FB4;font-size:12px;font-weight:700;cursor:pointer">
          🔄 Reenviar código
        </button>
      </div>
    </div>
  </div>

  <div id="login-error-msg" style="display:none;margin-top:14px;padding:10px;border-radius:10px;background:#FEE2E2;border:1px solid #FCA5A5;color:#991B1B;font-size:12.5px;text-align:center"></div>

  <!-- Acceso Directo de Prueba / Demo -->
  <div style="margin-top:16px;border-top:1px solid #F1F5F9;padding-top:12px">
    <form action="/vecino/auth" method="POST">
      <button type="submit" class="btn-secondary" style="font-size:12.5px">
        <span>🚀 Entrar como Daniel Morales (Demo Rápido)</span>
      </button>
    </form>
  </div>
</div>

<script>
  var _telActual = '';

  function cambiarTabLogin(tab) {
    var btnEmail = document.getElementById('tab-btn-email');
    var btnWa = document.getElementById('tab-btn-wa');
    var secEmail = document.getElementById('seccion-email');
    var secWa = document.getElementById('seccion-wa');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    if (tab === 'email') {
      btnEmail.style.background = '#fff';
      btnEmail.style.color = '#0F326A';
      btnEmail.style.boxShadow = '0 1px 3px rgba(0,0,0,.08)';
      btnWa.style.background = 'transparent';
      btnWa.style.color = '#64748B';
      btnWa.style.boxShadow = 'none';
      secEmail.style.display = 'block';
      secWa.style.display = 'none';
    } else {
      btnWa.style.background = '#fff';
      btnWa.style.color = '#0F326A';
      btnWa.style.boxShadow = '0 1px 3px rgba(0,0,0,.08)';
      btnEmail.style.background = 'transparent';
      btnEmail.style.color = '#64748B';
      btnEmail.style.boxShadow = 'none';
      secWa.style.display = 'block';
      secEmail.style.display = 'none';
    }
  }

  function mostrarRegistroEmail(mostrar) {
    document.getElementById('box-login-email').style.display = mostrar ? 'none' : 'block';
    document.getElementById('box-registro-email').style.display = mostrar ? 'block' : 'none';
    document.getElementById('login-error-msg').style.display = 'none';
  }

  async function loginConEmail(e) {
    e.preventDefault();
    var email = document.getElementById('inp-login-email').value.trim();
    var pass = document.getElementById('inp-login-pass').value;
    var btn = document.getElementById('btn-submit-login-email');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Verificando...</span>';

    try {
      var res = await fetch('/vecino/api/login-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pass })
      });
      var data = await res.json();
      if (data && data.ok) {
        window.location.href = data.redirect || '/vecino';
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-sign-in" style="font-size:20px"></i><span>Ingresar con Email</span>';
        err.style.display = 'block';
        err.textContent = data.error || 'Email o contraseña incorrectos';
      }
    } catch (ex) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-sign-in" style="font-size:20px"></i><span>Ingresar con Email</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  async function registrarConEmail(e) {
    e.preventDefault();
    var nombre = document.getElementById('inp-reg-nombre').value.trim();
    var email = document.getElementById('inp-reg-email').value.trim();
    var pass = document.getElementById('inp-reg-pass').value;
    var tel = document.getElementById('inp-reg-tel').value.trim();
    var depto = document.getElementById('inp-reg-depto').value.trim();
    var rol = document.getElementById('inp-reg-rol').value;
    var btn = document.getElementById('btn-submit-reg');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Creando cuenta...</span>';

    try {
      var res = await fetch('/vecino/api/registro-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          email: email,
          password: pass,
          telefono: tel,
          edificio: 'San Patricio 159',
          departamento: depto,
          rol: rol
        })
      });
      var data = await res.json();
      if (data && data.ok) {
        window.location.href = data.redirect || '/vecino';
      } else {
        btn.disabled = false;
        btn.innerHTML = '<span>Crear Cuenta e Ingresar</span>';
        err.style.display = 'block';
        err.textContent = data.error || 'Error al registrar la cuenta';
      }
    } catch (ex) {
      btn.disabled = false;
      btn.innerHTML = '<span>Crear Cuenta e Ingresar</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  async function solicitarPinWhatsApp(e) {
    if (e) e.preventDefault();
    var inp = document.getElementById('inp-login-tel');
    var btn = document.getElementById('btn-pedir-pin');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    var rawTel = inp.value.trim();
    if (!rawTel) {
      alert('Ingresá tu número de teléfono');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Enviando código...</span>';

    try {
      var res = await fetch('/vecino/api/solicitar-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: rawTel })
      });
      var data = await res.json();
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-whatsapp-logo" style="font-size:20px"></i><span>Recibir Código por WhatsApp</span>';

      if (data && data.ok) {
        _telActual = data.telefono;
        document.getElementById('txt-tel-destino').textContent = '+' + data.telefono;
        if (data.pinDemo) {
          var hint = document.getElementById('txt-pin-hint');
          hint.textContent = '💡 Código de prueba: ' + data.pinDemo;
          hint.style.display = 'block';
        }
        document.getElementById('paso-1-telefono').style.display = 'none';
        document.getElementById('paso-2-pin').style.display = 'block';
        document.getElementById('inp-login-pin').focus();
      } else {
        err.style.display = 'block';
        err.textContent = data.error || 'No se pudo enviar el código. Verificá tu número.';
      }
    } catch(ex) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-whatsapp-logo" style="font-size:20px"></i><span>Recibir Código por WhatsApp</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  async function verificarPinWhatsApp(e) {
    if (e) e.preventDefault();
    var inp = document.getElementById('inp-login-pin');
    var btn = document.getElementById('btn-verificar-pin');
    var err = document.getElementById('login-error-msg');
    err.style.display = 'none';

    var pin = inp.value.trim();
    if (pin.length !== 4) {
      alert('El código debe tener 4 dígitos.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Verificando...</span>';

    try {
      var res = await fetch('/vecino/api/verificar-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: _telActual, pin: pin })
      });
      var data = await res.json();
      if (data && data.ok) {
        window.location.href = data.redirect || '/vecino';
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-lock-key-open" style="font-size:20px"></i><span>Ingresar con PIN</span>';
        err.style.display = 'block';
        err.textContent = data.error || 'Código incorrecto o expirado.';
      }
    } catch(ex) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-lock-key-open" style="font-size:20px"></i><span>Ingresar con PIN</span>';
      err.style.display = 'block';
      err.textContent = 'Error de conexión: ' + ex.message;
    }
  }

  function volverPaso1() {
    document.getElementById('paso-2-pin').style.display = 'none';
    document.getElementById('paso-1-telefono').style.display = 'block';
    document.getElementById('login-error-msg').style.display = 'none';
  }

  function reenviarPinWhatsApp() {
    solicitarPinWhatsApp(null);
  }

  function instalarPwaLogin() {
    alert('Para instalar la app, tocá el menú de tu navegador y seleccioná "Agregar a la pantalla principal" o "Instalar".');
  }
</script>
</body>
</html>`);
});

// API LOGIN CON EMAIL Y CONTRASEÑA
router.post('/api/login-email', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y contraseña son requeridos' });
    }

    const { obtenerUsuarioPorEmail, verificarPassword, obtenerUnidadesDeUsuario } = require('./db-pg');
    const u = await obtenerUsuarioPorEmail(email);
    if (!u) {
      return res.status(400).json({ ok: false, error: 'No existe ninguna cuenta registrada con este email' });
    }

    if (!u.password_hash || !verificarPassword(password, u.password_hash)) {
      return res.status(400).json({ ok: false, error: 'Contraseña incorrecta' });
    }

    const unidades = await obtenerUnidadesDeUsuario(u.id);
    const uActiva = unidades.length > 0 ? unidades[0] : {
      edificio: 'San Patricio 159',
      departamento: '1° A',
      rol: 'propietario',
      puede_ver_expensas: true,
      timbre_activo: true
    };

    if (req.session) {
      req.session.vecino = {
        usuario_id: u.id,
        nombre: u.nombre || 'Vecino',
        apellido: u.apellido || '',
        email: u.email,
        telefono: u.telefono || '',
        edificio: uActiva.edificio,
        departamento: uActiva.departamento,
        rol: uActiva.rol || 'propietario',
        puede_ver_expensas: uActiva.puede_ver_expensas !== false,
        timbre_activo: uActiva.timbre_activo !== false,
        timbre_silencio_desde: uActiva.timbre_silencio_desde || '23:00',
        timbre_silencio_hasta: uActiva.timbre_silencio_hasta || '07:30',
        saldoExpensa: '$120.000,00',
        estadoExpensa: 'Al día',
        unidades: unidades.length > 0 ? unidades : [uActiva]
      };
    }

    res.json({ ok: true, redirect: '/vecino' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API REGISTRO NUEVO USUARIO CON EMAIL
router.post('/api/registro-email', async (req, res) => {
  try {
    const { email, password, nombre, apellido, telefono, edificio, departamento, rol } = req.body || {};
    if (!email || !password || !nombre) {
      return res.status(400).json({ ok: false, error: 'Email, contraseña y nombre son requeridos' });
    }

    const { registrarOUsuario, asignarUsuarioAUnidad, obtenerUnidadesDeUsuario } = require('./db-pg');
    const u = await registrarOUsuario(email, password, nombre, apellido || '', telefono || '');

    const edif = edificio || 'San Patricio 159';
    const depto = departamento || '1° A';
    const rolAsignado = rol || 'propietario';

    await asignarUsuarioAUnidad(u.id, edif, depto, rolAsignado);
    const unidades = await obtenerUnidadesDeUsuario(u.id);

    if (req.session) {
      req.session.vecino = {
        usuario_id: u.id,
        nombre: u.nombre,
        apellido: u.apellido,
        email: u.email,
        telefono: u.telefono,
        edificio: edif,
        departamento: depto,
        rol: rolAsignado,
        puede_ver_expensas: rolAsignado !== 'turista',
        timbre_activo: true,
        timbre_silencio_desde: '23:00',
        timbre_silencio_hasta: '07:30',
        saldoExpensa: '$0,00',
        estadoExpensa: 'Al día',
        unidades: unidades
      };
    }

    res.json({ ok: true, redirect: '/vecino' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API CAMBIAR UNIDAD ACTIVA (SELECTOR MULTI-PROPIEDAD)
router.post('/api/cambiar-unidad', async (req, res) => {
  try {
    const { edificio, departamento } = req.body || {};
    if (!edificio || !departamento) return res.status(400).json({ ok: false, error: 'Faltan datos de la unidad' });

    if (req.session && req.session.vecino) {
      const v = req.session.vecino;
      const uEncontrada = (v.unidades || []).find(u => 
        u.edificio.toLowerCase() === edificio.toLowerCase() &&
        u.departamento.toLowerCase() === departamento.toLowerCase()
      );

      v.edificio = edificio;
      v.departamento = departamento;
      if (uEncontrada) {
        v.rol = uEncontrada.rol || 'propietario';
        v.puede_ver_expensas = uEncontrada.puede_ver_expensas !== false;
        v.timbre_activo = uEncontrada.timbre_activo !== false;
        v.timbre_silencio_desde = uEncontrada.timbre_silencio_desde || '23:00';
        v.timbre_silencio_hasta = uEncontrada.timbre_silencio_hasta || '07:30';
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API SOLICITAR PIN DE ACCESO (WHATSAPP)
router.post('/api/solicitar-pin', async (req, res) => {
  const { telefono } = req.body || {};
  if (!telefono || !String(telefono).trim()) {
    return res.status(400).json({ ok: false, error: 'El número de teléfono es requerido.' });
  }

  const telNorm = normalizarTelArg(telefono);
  let vecinoEncontrado = null;

  // 1. Buscar en PostgreSQL o datos locales
  if (datosPg && typeof datosPg.buscarVecinosPorTelefono === 'function') {
    try {
      const lista = await datosPg.buscarVecinosPorTelefono(telNorm);
      if (lista && lista.length > 0) {
        vecinoEncontrado = lista[0];
      }
    } catch (_) {}
  }

  // 2. Fallback de búsqueda en tabla 'vecinos'
  if (!vecinoEncontrado) {
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        const q = `SELECT * FROM vecinos WHERE REPLACE(REPLACE(REPLACE(telefono, ' ', ''), '-', ''), '+', '') LIKE $1 LIMIT 1`;
        const r = await pool.query(q, ['%' + telNorm.slice(-8) + '%']);
        if (r && r.rows && r.rows.length > 0) {
          const row = r.rows[0];
          vecinoEncontrado = {
            nombre: row.nombre || 'Vecino',
            telefono: row.telefono || telNorm,
            edificio: row.edificio || 'San Patricio 159',
            departamento: row.departamento || '1° A'
          };
        }
      }
    } catch (_) {}
  }

  // 3. Si es el teléfono de Daniel o modo desarrollo
  if (!vecinoEncontrado && (telNorm.includes('50542005') || telNorm.includes('1150542005') || telNorm.includes('5491150542005'))) {
    vecinoEncontrado = {
      nombre: 'Daniel Morales',
      telefono: '+5491150542005',
      edificio: 'San Patricio 159',
      departamento: '1° A'
    };
  }

  if (!vecinoEncontrado) {
    vecinoEncontrado = {
      nombre: 'Vecino',
      telefono: '+' + telNorm,
      edificio: 'San Patricio 159',
      departamento: '1° A'
    };
  }

  // Generar PIN de 4 dígitos
  const pin = Math.floor(1000 + Math.random() * 9000).toString();
  _pinesLogin.set(telNorm, {
    pin,
    vecino: vecinoEncontrado,
    expira: Date.now() + 10 * 60 * 1000
  });

  console.log(`🔑 [LOGIN OTP] PIN para ${vecinoEncontrado.nombre} (${telNorm}): ${pin}`);

  // Enviar mensaje por WhatsApp vía Meta API si está disponible
  try {
    const marcosOps = require('./agentes/marcos-ops');
    if (marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
      const phoneId = process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
      const token = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
      const textoMsg = `🏢 *Portal del Vecino — Código de Acceso*\n\nHola *${vecinoEncontrado.nombre}*, tu código para ingresar es:\n\n🔑 *${pin}*\n\n(Válido por 10 minutos. No lo compartas).`;
      await marcosOps.enviarWhatsApp('+' + telNorm, textoMsg, phoneId, token).catch(() => {});
    }
  } catch (_) {}

  res.json({
    ok: true,
    mensaje: 'Código enviado por WhatsApp',
    telefono: telNorm,
    pinDemo: pin
  });
});

// API VERIFICAR PIN DE ACCESO
router.post('/api/verificar-pin', async (req, res) => {
  const { telefono, pin } = req.body || {};
  if (!telefono || !pin) {
    return res.status(400).json({ ok: false, error: 'Teléfono y PIN son requeridos.' });
  }

  const telNorm = normalizarTelArg(telefono);
  const dataPin = _pinesLogin.get(telNorm);

  if (!dataPin) {
    return res.status(400).json({ ok: false, error: 'No hay ningún código pendiente para este número. Solicitá uno nuevo.' });
  }

  if (Date.now() > dataPin.expira) {
    _pinesLogin.delete(telNorm);
    return res.status(400).json({ ok: false, error: 'El código expiró. Solicitá uno nuevo.' });
  }

  if (dataPin.pin !== String(pin).trim()) {
    return res.status(400).json({ ok: false, error: 'Código incorrecto. Revisá el mensaje en WhatsApp.' });
  }

  // Cargar unidades del usuario desde DB si existen
  let unidades = [];
  try {
    const { pool, obtenerUnidadesDeUsuario } = require('./db-pg');
    if (pool) {
      const resU = await pool.query('SELECT id, email, nombre FROM usuarios WHERE REPLACE(REPLACE(REPLACE(telefono, " ", ""), "-", ""), "+", "") LIKE $1 LIMIT 1', ['%' + telNorm.slice(-8) + '%']);
      if (resU && resU.rows && resU.rows[0]) {
        unidades = await obtenerUnidadesDeUsuario(resU.rows[0].id);
      }
    }
  } catch (_) {}

  if (!unidades.length) {
    unidades = [
      { edificio: dataPin.vecino.edificio || 'San Patricio 159', departamento: dataPin.vecino.departamento || '1° A', rol: 'propietario', puede_ver_expensas: true }
    ];
  }

  // Autenticación Exitosa: Guardar en sesión
  if (req.session) {
    req.session.vecino = {
      nombre: dataPin.vecino.nombre,
      telefono: dataPin.vecino.telefono,
      email: dataPin.vecino.email || (telNorm + '@vecino.consorcio.ai'),
      edificio: unidades[0].edificio,
      departamento: unidades[0].departamento,
      rol: unidades[0].rol || 'propietario',
      puede_ver_expensas: unidades[0].puede_ver_expensas !== false,
      timbre_activo: true,
      timbre_silencio_desde: '23:00',
      timbre_silencio_hasta: '07:30',
      saldoExpensa: '$120.000,00',
      estadoExpensa: 'Al día',
      unidades: unidades
    };
  }

  _pinesLogin.delete(telNorm);
  res.json({ ok: true, redirect: '/vecino' });
});

// LOGOUT
router.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.redirect('/vecino/login');
    });
  } else {
    res.redirect('/vecino/login');
  }
});

router.post('/auth', async (req, res) => {
  const { identificador } = req.body || {};
  const limpio = String(identificador || '').trim();
  const telLimpio = limpio.replace(/\D/g, '');

  if (req.session) {
    req.session.vecino = {
      nombre: 'Daniel Morales',
      telefono: telLimpio || '+5491150542005',
      edificio: 'San Patricio 159',
      departamento: '1° A',
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

  // 1. Tarjeta superior de Expensas (Solo fijos/titulares) o Bienvenida (Turistas)
  const tarjetaSuperior = (v.puede_ver_expensas !== false) ? `
    <!-- Tarjeta Principal de Expensas (Estilo Mercado Pago) -->
    <div class="card" style="padding:18px;background:#ffffff;margin-bottom:14px;box-shadow:0 4px 18px rgba(15,23,42,.06);border-radius:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid #F1F5F9;padding-bottom:10px">
        <div style="display:flex;gap:16px;font-size:13px;font-weight:800">
          <span style="color:#0F326A;border-bottom:2px solid #0F326A;padding-bottom:8px">Expensas (Ord. y Extraord.)</span>
          <span style="color:#94A3B8;cursor:pointer" onclick="location.href='/vecino/amenities'">Reservas</span>
          <span style="color:#94A3B8;cursor:pointer" onclick="location.href='/vecino/reclamos'">Reclamos</span>
        </div>
        <span style="font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;background:#DCFCE7;color:#15803D;border:1px solid #86EFAC">
          ✓ ${esc(v.estadoExpensa || 'Al día')}
        </span>
      </div>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Total a Pagar (Mes Vigente)</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px">
          <div style="font-size:32px;font-weight:900;color:#0F172A;letter-spacing:-.03em">${esc(v.saldoExpensa || '$0')}</div>
        </div>
        <div style="font-size:12px;color:#64748B;margin-top:2px">Vencimiento: 10 del mes · Ordinarias y Extraordinarias</div>
      </div>

      <!-- Acciones de la Expensa -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <a href="/vecino/expensas" style="height:44px;border-radius:12px;background:#0F326A;color:#fff;font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 3px 10px rgba(15,50,106,.25);text-decoration:none">
          <i class="ph ph-credit-card" style="font-size:18px"></i>
          <span>Pagar Expensa</span>
        </a>
        <a href="/vecino/expensas" style="height:44px;border-radius:12px;background:#F1F5F9;color:#0F326A;font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #E2E8F0;text-decoration:none">
          <i class="ph ph-receipt" style="font-size:18px"></i>
          <span>Ver Recibo PDF</span>
        </a>
      </div>
    </div>
  ` : `
    <!-- Tarjeta Huésped Temporal (Turista) - Expensas Ocultas -->
    <div class="card" style="padding:20px;background:linear-gradient(135deg,#0F2B5C,#1E3A8A);color:#fff;margin-bottom:14px;box-shadow:0 4px 18px rgba(15,43,92,.2);border-radius:20px;border:1px solid rgba(251,191,36,0.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:11.5px;font-weight:900;padding:3px 10px;border-radius:999px;background:rgba(251,191,36,0.2);color:#FBBF24;border:1px solid rgba(251,191,36,0.4)">
          🧳 Estadía Temporal
        </span>
        <span style="font-size:12px;color:#94A3B8">Pase Huésped Activo</span>
      </div>
      <div style="font-size:22px;font-weight:900;margin-bottom:4px;letter-spacing:-.02em">¡Bienvenido a ${esc(v.edificio)}!</div>
      <div style="font-size:13px;color:#CBD5E1;line-height:1.4;margin-bottom:16px">
        Alojado en depto <strong style="color:#FBBF24">${esc(v.departamento)}</strong>. Tenés acceso habilitado a reservas de amenities, timbre personal y Marcos IA 24/7.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <a href="/vecino/amenities" style="height:44px;border-radius:12px;background:#FBBF24;color:#0F172A;font-size:13.5px;font-weight:900;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">
          <i class="ph ph-swimming-pool" style="font-size:18px"></i>
          <span>Amenities</span>
        </a>
        <a href="/vecino/chat" style="height:44px;border-radius:12px;background:rgba(255,255,255,0.15);color:#fff;font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,0.25);text-decoration:none">
          <i class="ph ph-chat-circle-dots" style="font-size:18px"></i>
          <span>Asistente 24/7</span>
        </a>
      </div>
    </div>
  `;

  // 2. Tarjeta Mi Timbre Digital & Modo No Molestar
  const tarjetaTimbre = `
    <div class="card" style="padding:16px 18px;background:#ffffff;margin-bottom:14px;border-radius:20px;border:1px solid #E2E8F0;box-shadow:0 4px 14px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <div id="timbre-icono-box" style="width:42px;height:42px;border-radius:14px;background:${v.timbre_activo !== false ? '#DCFCE7' : '#FEE2E2'};color:${v.timbre_activo !== false ? '#15803D' : '#DC2626'};display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ${v.timbre_activo !== false ? 'ph-bell-ringing' : 'ph-bell-slash'}"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:900;color:#0F172A">Mi Timbre Digital</div>
            <div id="timbre-estado-lbl" style="font-size:12px;color:${v.timbre_activo !== false ? '#15803D' : '#DC2626'};font-weight:700">
              ${v.timbre_activo !== false ? '● Activo · Suena en tu celu' : '○ Silenciado'}
            </div>
          </div>
        </div>
        <!-- Switch ON/OFF -->
        <label style="position:relative;display:inline-block;width:50px;height:28px;cursor:pointer;margin:0">
          <input type="checkbox" id="chk-timbre-activo" ${v.timbre_activo !== false ? 'checked' : ''} onchange="guardarConfigTimbre()" style="opacity:0;width:0;height:0">
          <span class="slider-timbre" id="slider-timbre-bg" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${v.timbre_activo !== false ? '#10B981' : '#CBD5E1'};border-radius:28px;transition:.3s"></span>
        </label>
      </div>

      <!-- Configuración No Molestar / Silencio Nocturno -->
      <div class="timbre-horario-row">
        <div style="display:flex;align-items:center;gap:6px">
          <span class="timbre-horario-label">🌙 Modo "No Molestar":</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="timbre-de-label">De</span>
          <input type="time" id="timbre-silencio-desde" class="inp-time-timbre" value="${esc(v.timbre_silencio_desde || '23:00')}" onchange="guardarConfigTimbre()">
          <span class="timbre-a-label">a</span>
          <input type="time" id="timbre-silencio-hasta" class="inp-time-timbre" value="${esc(v.timbre_silencio_hasta || '07:30')}" onchange="guardarConfigTimbre()">
        </div>
      </div>
      <div id="timbre-guardado-msg" style="display:none;font-size:11.5px;color:#16A34A;font-weight:800;margin-top:8px;text-align:right">
        ✓ Preferencia de timbre guardada
      </div>
    </div>
  `;

  // 3. Tarjeta Gestión de Ocupantes y Huéspedes (Propietarios y Gestores)
  const puedeGestionarOcupantes = (v.rol === 'propietario' || v.rol === 'asistente');
  const tarjetaOcupantes = puedeGestionarOcupantes ? `
    <div class="card" style="padding:18px 20px;background:#ffffff;margin-bottom:14px;border-radius:20px;border:1px solid #E2E8F0;box-shadow:0 4px 14px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid #F1F5F9;padding-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:12px;background:#EFF6FF;color:#2563EB;display:flex;align-items:center;justify-content:center;font-size:20px">
            <i class="ph ph-users-three"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:900;color:#0F172A">Ocupantes del Depto ${esc(v.departamento)}</div>
            <div style="font-size:11.5px;color:#64748B">Convivientes, Inquilinos y Huéspedes</div>
          </div>
        </div>
        <button onclick="cargarOcupantes()" style="border:none;background:#F1F5F9;color:#475569;width:30px;height:30px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i class="ph ph-arrows-clockwise" style="font-size:16px"></i>
        </button>
      </div>

      <!-- Lista de Integrantes -->
      <div id="lista-ocupantes-box" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        <div style="font-size:12px;color:#94A3B8;text-align:center;padding:10px">Cargando integrantes...</div>
      </div>

      <!-- Botones de Acción -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button type="button" class="btn-ocupante-action btn-ocupante-familiar" onclick="abrirModalAgregarOcupante('conviviente')">
          <i class="ph ph-user-plus"></i>
          <span>+ Familiar / Inquilino</span>
        </button>
        <button type="button" class="btn-ocupante-action btn-ocupante-huesped" onclick="abrirModalAgregarHuesped()">
          <i class="ph ph-suitcase"></i>
          <span>+ Pase Huésped Turista</span>
        </button>
      </div>

      <button type="button" class="btn-ocupante-action btn-ocupante-reubicar" onclick="abrirModalReubicarHuesped()">
        <i class="ph ph-arrows-left-right"></i>
        <span>🔄 Reubicar Huésped a Otra Unidad</span>
      </button>
    </div>
  ` : '';

  const content = `
    ${tarjetaSuperior}
    ${tarjetaTimbre}
    ${tarjetaOcupantes}

    <!-- Servicios Rápidos en Fila (Estilo Mercado Pago Icons) -->
    <div style="margin-bottom:14px">
      <div style="font-size:13.5px;font-weight:800;color:#0F172A;margin-bottom:10px">Accesos Directos</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        
        <a href="/porteria/${encodeURIComponent(v.edificio)}" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:44px;height:44px;border-radius:14px;background:#FEF3C7;color:#D97706;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-qr-code"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:#1E293B">Portería QR</span>
        </a>

        <a href="/vecino/amenities" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:44px;height:44px;border-radius:14px;background:#DCFCE7;color:#15803D;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-swimming-pool"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:#1E293B">Amenities</span>
        </a>

        <a href="/vecino/reclamos" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:44px;height:44px;border-radius:14px;background:#EBF3FC;color:#1E5FB4;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-wrench"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:#1E293B">Reclamos</span>
        </a>

        <a href="/vecino/novedades" class="card card-touch" style="padding:12px 6px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;background:#fff;border-radius:16px">
          <div style="width:44px;height:44px;border-radius:14px;background:#F3E8FF;color:#7E22CE;display:flex;align-items:center;justify-content:center;font-size:22px">
            <i class="ph ph-bell-ringing"></i>
          </div>
          <span style="font-size:11.5px;font-weight:800;color:#1E293B">Avisos</span>
        </a>

      </div>
    </div>

    <!-- Tarjeta Instalar App en el Celular -->
    <div id="card-instalar-pwa" class="card card-touch" style="padding:14px 16px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;box-shadow:0 4px 14px rgba(15,50,106,.2);border-radius:18px" onclick="instalarPwa()">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
          📲
        </div>
        <div>
          <div style="font-size:13.5px;font-weight:900;line-height:1.2">Instalar App en tu Celular</div>
          <div style="font-size:11px;color:rgba(255,255,255,.85)">Acceso rápido directo en tu pantalla</div>
        </div>
      </div>
      <button style="padding:6px 14px;border:none;border-radius:8px;background:#ffffff;color:#0F326A;font-weight:900;font-size:12px;cursor:pointer;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.15)">Instalar</button>
    </div>

    <!-- Banner Inteligente Marcos IA (Estilo Créditos Mercado Pago) -->
    <div class="card card-touch" style="padding:16px;background:#ffffff;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;border-left:4px solid #1E5FB4" onclick="location.href='/vecino/chat'">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:42px;height:42px;border-radius:12px;background:#0F326A;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          🤖
        </div>
        <div>
          <div style="font-size:14.5px;font-weight:900;color:#0F172A">Asistente Consorcio 24/7</div>
          <div style="font-size:12px;color:#64748B;line-height:1.3">Reportá urgencias, pedí cerrajero o consultá reglamentos.</div>
        </div>
      </div>
      <button style="padding:7px 14px;border:none;border-radius:10px;background:#0F326A;color:#fff;font-size:12.5px;font-weight:800;cursor:pointer;flex-shrink:0">Chatear</button>
    </div>

    <!-- Estado de Servicios del Edificio -->
    <div class="card card-servicios" style="padding:16px;background:#fff;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="servicios-titulo" style="font-size:13px;font-weight:800;color:#D97706;text-transform:uppercase;letter-spacing:.04em">Servicios · ${esc(v.edificio)}</span>
        <span class="servicio-badge-operativo" style="font-size:11px;font-weight:800;color:#15803D;background:#DCFCE7;padding:3px 9px;border-radius:999px">Operativo</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="servicio-item" style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;padding-bottom:8px;border-bottom:1px solid #F1F5F9">
          <span class="servicio-nombre" style="display:flex;align-items:center;gap:8px;font-weight:800;color:#0F172A">🛗 Ascensor Principal</span>
          <span class="servicio-estado" style="font-size:12px;font-weight:700;color:#15803D">En servicio normal</span>
        </div>
        <div class="servicio-item" style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;padding-bottom:8px;border-bottom:1px solid #F1F5F9">
          <span class="servicio-nombre" style="display:flex;align-items:center;gap:8px;font-weight:800;color:#0F172A">💧 Bombas de Agua</span>
          <span class="servicio-estado" style="font-size:12px;font-weight:700;color:#15803D">Presión estándar</span>
        </div>
        <div class="servicio-item" style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px">
          <span class="servicio-nombre" style="display:flex;align-items:center;gap:8px;font-weight:800;color:#0F172A">🚗 Portón Cochera</span>
          <span class="servicio-estado" style="font-size:12px;font-weight:700;color:#15803D">Apertura automática</span>
        </div>
      </div>
    </div>

    <!-- Novedades del Consorcio -->
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13.5px;font-weight:900;color:#0F172A">Novedades del Consorcio</span>
      <a href="/vecino/novedades" style="font-size:12.5px;font-weight:800;color:#38BDF8">Ver todas</a>
    </div>

    <div class="card" style="padding:15px;background:#fff;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:#FEF3C7;color:#92400E">Mantenimiento</span>
        <span style="font-size:11.5px;color:#FBBF24;font-weight:700">Hoy · 09:30 hs</span>
      </div>
      <div style="font-size:14px;font-weight:800;color:#0F172A;margin-bottom:4px">Limpieza programada de tanques</div>
      <div style="font-size:12.5px;color:#64748B;line-height:1.4">Se realizará el jueves de 08:00 a 14:00 hs. Habrá baja presión momentánea.</div>
    </div>

    <!-- MODAL 1: Sumar Familiar / Conviviente -->
    <div id="modal-agregar-familiar" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:20px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 40px rgba(0,0,0,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:16px;font-weight:900;color:#0F172A">Sumar Ocupante a la Unidad</div>
          <button onclick="cerrarModal('modal-agregar-familiar')" style="border:none;background:#F1F5F9;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer;color:#64748B">✕</button>
        </div>
        <form onsubmit="guardarNuevoOcupante(event)">
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Rol en el Depto</label>
            <select id="inp-fam-rol" class="inp" style="background:#fff">
              <option value="conviviente">Familiar / Conviviente</option>
              <option value="inquilino">Inquilino (Alquiler Fijo)</option>
            </select>
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Nombre y Apellido</label>
            <input type="text" id="inp-fam-nombre" placeholder="Ej: Lucas Morales" class="inp" style="background:#fff" required>
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Email (para iniciar sesión)</label>
            <input type="email" id="inp-fam-email" placeholder="lucas@gmail.com" class="inp" style="background:#fff" required>
          </div>
          <div style="margin-bottom:14px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Teléfono WhatsApp</label>
            <input type="tel" id="inp-fam-tel" placeholder="11 2345-6789" class="inp" style="background:#fff">
          </div>
          <div style="font-size:11.5px;color:#64748B;line-height:1.4;margin-bottom:14px;background:#F8FAFC;padding:8px 12px;border-radius:8px">
            ℹ️ Tendrá timbre digital personal independiente, acceso a amenities y expensas (ordinarias y extraordinarias).
          </div>
          <button type="submit" id="btn-fam-guardar" style="width:100%;height:44px;border:none;border-radius:12px;background:#0F326A;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer">Guardar Ocupante</button>
        </form>
      </div>
    </div>

    <!-- MODAL 2: Registrar Huésped / Turista (Airbnb) -->
    <div id="modal-agregar-huesped" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:20px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 40px rgba(0,0,0,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:16px;font-weight:900;color:#0F172A">🧳 Registrar Huésped Temporal (Airbnb)</div>
          <button onclick="cerrarModal('modal-agregar-huesped')" style="border:none;background:#F1F5F9;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer;color:#64748B">✕</button>
        </div>
        <form onsubmit="guardarNuevoHuesped(event)">
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Nombre Completo del Huésped</label>
            <input type="text" id="inp-hue-nombre" placeholder="Ej: John Doe" class="inp" style="background:#fff" required>
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Email (para acceso a la app)</label>
            <input type="email" id="inp-hue-email" placeholder="john@airbnb.com" class="inp" style="background:#fff" required>
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Teléfono WhatsApp</label>
            <input type="tel" id="inp-hue-tel" placeholder="+1 555-1234" class="inp" style="background:#fff">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div>
              <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Check-in</label>
              <input type="date" id="inp-hue-desde" class="inp" style="background:#fff" required>
            </div>
            <div>
              <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Check-out</label>
              <input type="date" id="inp-hue-hasta" class="inp" style="background:#fff" required>
            </div>
          </div>
          <div style="font-size:11.5px;color:#92400E;line-height:1.4;margin-bottom:14px;background:#FEF3C7;padding:8px 12px;border-radius:8px;border:1px solid #FCD34D">
            🔒 <strong>Expensas 100% Ocultas:</strong> El huésped solo tendrá acceso al timbre personal, reservas de amenities y Marcos IA.
          </div>
          <button type="submit" id="btn-hue-guardar" style="width:100%;height:44px;border:none;border-radius:12px;background:#D97706;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer">Generar Pase Huésped</button>
        </form>
      </div>
    </div>

    <!-- MODAL 3: Reubicar Huésped a Otra Unidad -->
    <div id="modal-reubicar-huesped" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:20px;max-width:460px;width:100%;padding:22px;box-shadow:0 20px 40px rgba(0,0,0,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:16px;font-weight:900;color:#0F172A">🔄 Reubicar Huésped a Otra Unidad</div>
          <button onclick="cerrarModal('modal-reubicar-huesped')" style="border:none;background:#F1F5F9;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer;color:#64748B">✕</button>
        </div>
        <form onsubmit="ejecutarReubicacion(event)">
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Huésped a Trasladar</label>
            <select id="sel-reub-huesped" class="inp" style="background:#fff" required>
              <option value="">Cargando huéspedes...</option>
            </select>
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Unidad de Destino (Portafolio Disponible)</label>
            <select id="sel-reub-destino" class="inp" style="background:#fff" required>
              <option value="">Cargando unidades disponibles...</option>
            </select>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:11.5px;font-weight:800;color:#475569;text-transform:uppercase;display:block;margin-bottom:4px">Motivo del Traslado</label>
            <input type="text" id="inp-reub-motivo" placeholder="Ej: Fuga de agua en el baño / Reparación urgente" class="inp" style="background:#fff" required>
          </div>
          <div style="font-size:11.5px;color:#4338CA;line-height:1.4;margin-bottom:14px;background:#EEF2FF;padding:10px 12px;border-radius:10px;border:1px solid #C7D2FE">
            ✨ <strong>Efectos Inmediatos:</strong><br>
            • El timbre digital del huésped se redirige al nuevo departamento.<br>
            • Las reservas activas de amenities se trasladan automáticamente.<br>
            • El incidente y la reubicación quedan documentados para administración y propietarios.
          </div>
          <button type="submit" id="btn-reub-ejecutar" style="width:100%;height:44px;border:none;border-radius:12px;background:#4F46E5;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer">Confirmar Reubicación Inmediata</button>
        </form>
      </div>
    </div>

    <!-- Scripts de Interacción -->
    <script>
      let _ocupantesActuales = [];

      async function guardarConfigTimbre() {
        const chk = document.getElementById('chk-timbre-activo');
        const desde = document.getElementById('timbre-silencio-desde').value;
        const hasta = document.getElementById('timbre-silencio-hasta').value;
        const activo = chk.checked;

        const icoBox = document.getElementById('timbre-icono-box');
        const lbl = document.getElementById('timbre-estado-lbl');
        const sBg = document.getElementById('slider-timbre-bg');
        if (activo) {
          icoBox.style.background = '#DCFCE7';
          icoBox.style.color = '#15803D';
          icoBox.innerHTML = '<i class="ph ph-bell-ringing"></i>';
          lbl.style.color = '#15803D';
          lbl.innerText = '● Activo · Suena en tu celu';
          sBg.style.backgroundColor = '#10B981';
        } else {
          icoBox.style.background = '#FEE2E2';
          icoBox.style.color = '#DC2626';
          icoBox.innerHTML = '<i class="ph ph-bell-slash"></i>';
          lbl.style.color = '#DC2626';
          lbl.innerText = '○ Silenciado';
          sBg.style.backgroundColor = '#CBD5E1';
        }

        try {
          const res = await fetch('/vecino/api/timbre-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              timbre_activo: activo,
              timbre_silencio_desde: desde,
              timbre_silencio_hasta: hasta
            })
          });
          const data = await res.json();
          if (data.ok) {
            const msg = document.getElementById('timbre-guardado-msg');
            if (msg) {
              msg.style.display = 'block';
              setTimeout(() => { msg.style.display = 'none'; }, 3000);
            }
          }
        } catch (_) {}
      }

      async function cargarOcupantes() {
        const box = document.getElementById('lista-ocupantes-box');
        if (!box) return;
        box.innerHTML = '<div style="font-size:12px;color:#94A3B8;text-align:center;padding:10px">Cargando integrantes...</div>';
        try {
          const res = await fetch('/vecino/api/ocupantes-unidad');
          const data = await res.json();
          if (data.ok && data.ocupantes) {
            _ocupantesActuales = data.ocupantes;
            renderizarOcupantes(data.ocupantes);
          } else {
            box.innerHTML = '<div style="font-size:12px;color:#EF4444;text-align:center;padding:10px">No se pudieron cargar los ocupantes.</div>';
          }
        } catch (_) {
          box.innerHTML = '<div style="font-size:12px;color:#94A3B8;text-align:center;padding:10px">Sin datos de ocupantes.</div>';
        }
      }

      function renderizarOcupantes(lista) {
        const box = document.getElementById('lista-ocupantes-box');
        if (!box) return;
        if (!lista || lista.length === 0) {
          box.innerHTML = '<div style="font-size:12px;color:#FBBF24;text-align:center;padding:8px">No hay otros integrantes registrados en esta unidad.</div>';
          return;
        }
        let html = '';
        for (let i = 0; i < lista.length; i++) {
          const o = lista[i];
          const esTur = (o.rol === 'turista');
          const badgeClass = esTur ? 'badge-ocupante-turista' : (o.rol === 'propietario' ? 'badge-ocupante-propietario' : (o.rol === 'asistente' ? 'badge-ocupante-asistente' : 'badge-ocupante-inquilino'));
          const badgeTxt = esTur ? '🧳 Turista' : (o.rol === 'propietario' ? '👑 Propietario' : (o.rol === 'asistente' ? '🏢 Gestor' : (o.rol === 'inquilino' ? '🔑 Inquilino' : '👥 Familiar')));
          const timbreTxt = o.timbre_activo !== false ? '🔔 Timbre ON' : '🔕 Timbre OFF';
          const timbreClass = o.timbre_activo !== false ? 'timbre-on' : 'timbre-off';
          let fechasTxt = '';
          if (o.fecha_desde && o.fecha_hasta) {
            fechasTxt = ' · ' + String(o.fecha_desde).slice(0, 10) + ' al ' + String(o.fecha_hasta).slice(0, 10);
          }
          const nom = (o.nombre || '') + ' ' + (o.apellido || '');
          const contacto = o.email || o.telefono || 'Sin contacto';

          html += '<div class="ocupante-item-row">' +
                    '<div>' +
                      '<div style="display:flex;align-items:center;gap:6px">' +
                        '<strong class="ocupante-nombre">' + nom + '</strong>' +
                        '<span class="badge-ocupante ' + badgeClass + '">' + badgeTxt + '</span>' +
                      '</div>' +
                      '<div class="ocupante-contacto">' + contacto + fechasTxt + '</div>' +
                    '</div>' +
                    '<div class="ocupante-timbre-status ' + timbreClass + '">' + timbreTxt + '</div>' +
                  '</div>';
        }
        box.innerHTML = html;
      }

      function abrirModalAgregarOcupante(rol) {
        const m = document.getElementById('modal-agregar-familiar');
        if (m) {
          if (rol) document.getElementById('inp-fam-rol').value = rol;
          m.style.display = 'flex';
        }
      }

      async function guardarNuevoOcupante(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-fam-guardar');
        btn.disabled = true;
        btn.innerText = 'Guardando...';

        const payload = {
          rol: document.getElementById('inp-fam-rol').value,
          nombre: document.getElementById('inp-fam-nombre').value,
          email: document.getElementById('inp-fam-email').value,
          telefono: document.getElementById('inp-fam-tel').value
        };

        try {
          const res = await fetch('/vecino/api/agregar-ocupante', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.ok) {
            cerrarModal('modal-agregar-familiar');
            cargarOcupantes();
          } else {
            alert(data.error || 'Error al guardar ocupante');
          }
        } catch (err) {
          alert('Error de conexión');
        } finally {
          btn.disabled = false;
          btn.innerText = 'Guardar Ocupante';
        }
      }

      function abrirModalAgregarHuesped() {
        const m = document.getElementById('modal-agregar-huesped');
        if (m) {
          const hoy = new Date().toISOString().split('T')[0];
          document.getElementById('inp-hue-desde').value = hoy;
          m.style.display = 'flex';
        }
      }

      async function guardarNuevoHuesped(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-hue-guardar');
        btn.disabled = true;
        btn.innerText = 'Generando pase...';

        const payload = {
          rol: 'turista',
          nombre: document.getElementById('inp-hue-nombre').value,
          email: document.getElementById('inp-hue-email').value,
          telefono: document.getElementById('inp-hue-tel').value,
          fecha_desde: document.getElementById('inp-hue-desde').value,
          fecha_hasta: document.getElementById('inp-hue-hasta').value
        };

        try {
          const res = await fetch('/vecino/api/agregar-ocupante', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.ok) {
            cerrarModal('modal-agregar-huesped');
            cargarOcupantes();
          } else {
            alert(data.error || 'Error al registrar huésped');
          }
        } catch (err) {
          alert('Error de conexión');
        } finally {
          btn.disabled = false;
          btn.innerText = 'Generar Pase Huésped';
        }
      }

      async function abrirModalReubicarHuesped() {
        const m = document.getElementById('modal-reubicar-huesped');
        if (!m) return;
        m.style.display = 'flex';

        const selH = document.getElementById('sel-reub-huesped');
        selH.innerHTML = '<option value="">Seleccionar huésped...</option>';
        const turistas = _ocupantesActuales.filter(function(o) { return o.rol === 'turista'; });
        if (turistas.length === 0) {
          selH.innerHTML = '<option value="">No hay huéspedes turistas activos en este depto</option>';
        } else {
          for (let i = 0; i < turistas.length; i++) {
            const t = turistas[i];
            const opt = document.createElement('option');
            opt.value = t.usuario_id;
            opt.innerText = (t.nombre || 'Huésped') + ' (' + (t.email || t.telefono || ('ID: ' + t.usuario_id)) + ')';
            selH.appendChild(opt);
          }
        }

        const selD = document.getElementById('sel-reub-destino');
        selD.innerHTML = '<option value="">Cargando unidades disponibles...</option>';
        try {
          const res = await fetch('/vecino/api/portafolio-asistente');
          const data = await res.json();
          selD.innerHTML = '<option value="">Seleccionar depto de destino...</option>';
          if (data.ok && data.unidades && data.unidades.length > 0) {
            for (let j = 0; j < data.unidades.length; j++) {
              const u = data.unidades[j];
              const opt = document.createElement('option');
              opt.value = JSON.stringify({ edificio: u.edificio, depto: u.departamento });
              const propInfo = u.propietario_nombre ? (' [Dueño: ' + u.propietario_nombre + ']') : '';
              opt.innerText = u.edificio + ' - Depto ' + u.departamento + propInfo;
              selD.appendChild(opt);
            }
          } else {
            selD.innerHTML = '<option value="">No hay otras unidades asignadas en el portafolio</option>';
          }
        } catch (_) {
          selD.innerHTML = '<option value="">Error al consultar portafolio</option>';
        }
      }

      async function ejecutarReubicacion(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-reub-ejecutar');
        const uId = document.getElementById('sel-reub-huesped').value;
        const destJson = document.getElementById('sel-reub-destino').value;
        const motivo = document.getElementById('inp-reub-motivo').value;

        if (!uId || !destJson) {
          alert('Por favor seleccioná el huésped y el departamento de destino.');
          return;
        }

        btn.disabled = true;
        btn.innerText = 'Reubicando...';

        try {
          const dest = JSON.parse(destJson);
          const res = await fetch('/vecino/api/reubicar-turista', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              usuario_id: uId,
              nuevo_edificio: dest.edificio,
              nuevo_departamento: dest.depto,
              motivo: motivo
            })
          });
          const data = await res.json();
          if (data.ok) {
            alert(data.mensaje || 'Huésped reubicado con éxito.');
            cerrarModal('modal-reubicar-huesped');
            cargarOcupantes();
          } else {
            alert(data.error || 'No se pudo reubicar al huésped.');
          }
        } catch (err) {
          alert('Error de conexión');
        } finally {
          btn.disabled = false;
          btn.innerText = 'Confirmar Reubicación Inmediata';
        }
      }

      function cerrarModal(id) {
        const m = document.getElementById(id);
        if (m) m.style.display = 'none';
      }

      document.addEventListener('DOMContentLoaded', () => {
        cargarOcupantes();
      });
    </script>
  `;

  res.send(shellVecino('Inicio', 'inicio', content, v));
});

// -------------------------------------------------------------------
// ENDPOINTS API DE TIMBRE DIGITAL Y GESTIÓN MULTI-OCUPANTE
// -------------------------------------------------------------------

// 1. Configurar Timbre Personal (Switch ON/OFF & Horario No Molestar)
router.post('/api/timbre-config', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { timbre_activo, timbre_silencio_desde, timbre_silencio_hasta } = req.body || {};

    // Actualizar en sesión activa
    if (req.session && req.session.vecino) {
      if (typeof timbre_activo !== 'undefined') req.session.vecino.timbre_activo = Boolean(timbre_activo);
      if (timbre_silencio_desde) req.session.vecino.timbre_silencio_desde = timbre_silencio_desde;
      if (timbre_silencio_hasta) req.session.vecino.timbre_silencio_hasta = timbre_silencio_hasta;
    }

    // Persistir en PostgreSQL si el usuario tiene ID
    if (v.usuario_id) {
      const { actualizarConfigTimbre } = require('./db-pg');
      await actualizarConfigTimbre(v.usuario_id, v.edificio, v.departamento, {
        timbre_activo: Boolean(timbre_activo),
        timbre_silencio_desde,
        timbre_silencio_hasta
      });
    }

    res.json({ ok: true, mensaje: 'Preferencia de timbre guardada.' });
  } catch (err) {
    console.error('Error en /vecino/api/timbre-config:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Obtener ocupantes de la unidad activa
router.get('/api/ocupantes-unidad', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { obtenerIntegrantesUnidad } = require('./db-pg');
    let integrantes = [];
    try {
      integrantes = await obtenerIntegrantesUnidad(v.edificio, v.departamento);
    } catch (_) {}

    // Si no hay registrados en base, generar lista inicial basada en el usuario actual
    if (!integrantes.length) {
      integrantes = [
        {
          usuario_id: v.usuario_id || 1,
          nombre: v.nombre,
          apellido: '',
          email: v.email,
          telefono: v.telefono,
          rol: v.rol || 'propietario',
          timbre_activo: v.timbre_activo !== false,
          puede_ver_expensas: v.puede_ver_expensas !== false
        }
      ];
    }

    res.json({ ok: true, ocupantes: integrantes });
  } catch (err) {
    console.error('Error en /vecino/api/ocupantes-unidad:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Agregar familiar / inquilino o registrar pase huésped
router.post('/api/agregar-ocupante', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    if (v.rol !== 'propietario' && v.rol !== 'asistente') {
      return res.status(403).json({ ok: false, error: 'Solo propietarios o administradores pueden agregar ocupantes.' });
    }

    const { email, nombre, apellido, telefono, password, rol, fecha_desde, fecha_hasta } = req.body || {};
    if (!email || !nombre) {
      return res.status(400).json({ ok: false, error: 'Email y nombre son obligatorios.' });
    }

    const { registrarOUsuario, asignarUsuarioAUnidad } = require('./db-pg');

    // Registrar o recuperar usuario
    const user = await registrarOUsuario({
      email,
      password: password || 'consorcio123',
      nombre,
      apellido: apellido || '',
      telefono: telefono || ''
    });

    const esTurista = (rol === 'turista');
    const puedeVerExpensas = !esTurista;

    await asignarUsuarioAUnidad({
      usuario_id: user.id,
      edificio: v.edificio,
      departamento: v.departamento,
      rol: rol || (esTurista ? 'turista' : 'conviviente'),
      fecha_desde: fecha_desde || null,
      fecha_hasta: fecha_hasta || null,
      timbre_activo: true,
      puede_ver_expensas: puedeVerExpensas,
      asignado_por_usuario_id: v.usuario_id || null,
      notas: esTurista ? 'Pase de huésped temporal' : 'Ocupante asignado por titular'
    });

    res.json({ ok: true, mensaje: esTurista ? 'Pase huésped emitido.' : 'Ocupante guardado con éxito.' });
  } catch (err) {
    console.error('Error en /vecino/api/agregar-ocupante:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Portafolio de unidades del asistente (o del propietario) para reubicación
router.get('/api/portafolio-asistente', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { obtenerPortafolioAsistente, obtenerUnidadesDeUsuario } = require('./db-pg');

    let unidades = [];
    if (v.rol === 'asistente' && v.usuario_id) {
      unidades = await obtenerPortafolioAsistente(v.usuario_id);
    } else if (v.usuario_id) {
      unidades = await obtenerUnidadesDeUsuario(v.usuario_id);
    }

    // Si aún no hay en BD, proveer unidades de la sesión
    if (!unidades.length && v.unidades && v.unidades.length > 0) {
      unidades = v.unidades.filter(u => !(u.edificio === v.edificio && u.departamento === v.departamento));
    }

    res.json({ ok: true, unidades });
  } catch (err) {
    console.error('Error en /vecino/api/portafolio-asistente:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Reubicar huésped turista a otra unidad disponible del portafolio
router.post('/api/reubicar-turista', async (req, res) => {
  try {
    const v = getVecinoSession(req);
    if (v.rol !== 'asistente' && v.rol !== 'propietario') {
      return res.status(403).json({ ok: false, error: 'No tenés permisos para reubicar huéspedes.' });
    }

    const { usuario_id, nuevo_edificio, nuevo_departamento, motivo } = req.body || {};
    if (!usuario_id || !nuevo_departamento) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos (huésped o departamento de destino).' });
    }

    const { reubicarHuesped } = require('./db-pg');
    const resultado = await reubicarHuesped({
      usuario_id: Number(usuario_id),
      origen_edificio: v.edificio,
      origen_departamento: v.departamento,
      nuevo_edificio: nuevo_edificio || v.edificio,
      nuevo_departamento,
      motivo: motivo || 'Reubicación por gestión',
      operador_usuario_id: v.usuario_id || null
    });

    if (!resultado) {
      return res.status(400).json({ ok: false, error: 'No se pudo completar la reubicación.' });
    }

    res.json({ ok: true, mensaje: `Huésped reubicado exitosamente al departamento ${nuevo_departamento}.` });
  } catch (err) {
    console.error('Error en /vecino/api/reubicar-turista:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
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
    orientation: 'any',
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
    const CACHE_NAME = 'marcos-pwa-v4';
    self.addEventListener('install', (e) => {
      self.skipWaiting();
    });

    self.addEventListener('activate', (e) => {
      e.waitUntil(
        caches.keys().then((keys) => {
          return Promise.all(
            keys.map((k) => caches.delete(k))
          );
        }).then(() => self.clients.claim())
      );
    });

    self.addEventListener('fetch', (e) => {
      if (e.request.method !== 'GET') return;
      e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
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
const _comprobantesEnMemoria = [
  {
    id: 991,
    edificio: 'San Patricio 159',
    vecino: 'Daniel Morales (1° A)',
    monto: '$120.000',
    fecha: '01/08/2026',
    url: '',
    estado: 'aprobado',
    notas: 'Comprobante de transferencia bancaria'
  }
];

router.get('/expensas', async (req, res) => {
  const v = getVecinoSession(req);
  if (v.puede_ver_expensas === false) {
    return res.redirect('/vecino');
  }

  let expensas = [];
  let datosBanco = null;
  let misComprobantes = [];

  // 1. Obtener expensas reales de la base de datos
  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const qExp = `SELECT * FROM expensas WHERE LOWER(edificio) = LOWER($1) AND estado != 'eliminada' ORDER BY id DESC`;
      const resExp = await pool.query(qExp, [v.edificio]);
      if (resExp && resExp.rows && resExp.rows.length > 0) {
        expensas = resExp.rows;
      }

      // Obtener comprobantes subidos
      const qFac = `SELECT * FROM facturas WHERE tipo = 'comprobante_pago' AND LOWER(edificio) = LOWER($1) ORDER BY id DESC LIMIT 10`;
      const resFac = await pool.query(qFac, [v.edificio]);
      if (resFac && resFac.rows && resFac.rows.length > 0) {
        misComprobantes = resFac.rows.map(r => ({
          id: r.id,
          edificio: r.edificio,
          vecino: r.proveedor,
          monto: r.monto ? ('$' + r.monto) : 'Informado',
          fecha: r.fecha ? new Date(r.fecha).toLocaleDateString('es-AR') : 'Reciente',
          url: r.url || '',
          estado: r.estado || 'pendiente_aprobacion',
          notas: r.notas || ''
        }));
      }
    }
  } catch (_) {}

  // Combinar con comprobantes en memoria sin duplicar
  const idsComprobantes = new Set(misComprobantes.map(c => String(c.id)));
  for (const cMem of _comprobantesEnMemoria) {
    if (!idsComprobantes.has(String(cMem.id))) {
      misComprobantes.push(cMem);
    }
  }

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

    <!-- 3. Formulario Subir Comprobante de Pago Con Previsualización -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;background:#FAFCFF;border:1.5px dashed #B8D5F8;border-radius:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:22px">📤</span>
        <div>
          <div style="font-size:15.5px;font-weight:800;color:#0F172A">Informar Pago de Expensas</div>
          <div style="font-size:12px;color:#64748B">Adjuntá tu transferencia bancaria para validación</div>
        </div>
      </div>

      <form id="form-comprobante" onsubmit="enviarComprobante(event)">
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Comprobante de Transferencia (Foto o PDF) <span style="color:#EF4444">*</span></label>
          <input type="file" id="inp-comprobante-file" accept="image/*,.pdf" style="display:none" onchange="previewComprobante(event)" required>
          
          <div id="box-select-comprobante" onclick="document.getElementById('inp-comprobante-file').click()" style="border:2px dashed #93C5FD;background:#fff;border-radius:12px;padding:16px;text-align:center;cursor:pointer">
            <div style="font-size:26px;margin-bottom:4px">🧾</div>
            <div style="font-size:13px;font-weight:800;color:#1E5FB4">Seleccionar Foto o PDF del Comprobante</div>
            <div style="font-size:11.5px;color:#64748B">Tocá para elegir desde tu celular o galería</div>
          </div>

          <!-- Preview de Comprobante Seleccionado -->
          <div id="preview-comprobante-box" style="display:none;position:relative;margin-top:10px;border-radius:12px;overflow:hidden;border:1px solid #CBD5E1;background:#fff;padding:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <img id="preview-comprobante-img" src="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;display:none;border:1px solid #E2E8F0">
              <div id="preview-comprobante-pdf-icon" style="width:54px;height:54px;border-radius:10px;background:#FEE2E2;color:#DC2626;display:none;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">
                📄
              </div>
              <div style="flex:1;overflow:hidden">
                <div id="preview-comprobante-name" style="font-size:13px;font-weight:800;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
                <div id="preview-comprobante-size" style="font-size:11.5px;color:#64748B"></div>
              </div>
              <button type="button" onclick="quitarComprobante()" style="background:#F1F5F9;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;color:#64748B;font-size:14px;flex-shrink:0">✕</button>
            </div>
          </div>
        </div>

        <div style="margin-bottom:14px">
          <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Importe Transferido</label>
          <input type="text" id="inp-comprobante-monto" placeholder="Ej: $120.000 (Expensa Agosto)" class="inp" style="background:#fff;margin-bottom:0">
        </div>

        <button id="btn-comprobante" type="submit" style="width:100%;height:46px;border:none;border-radius:12px;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 3px 10px rgba(22,163,74,.25)">
          <i class="ph ph-check-circle" style="font-size:20px"></i>
          <span>Enviar Comprobante a la Administración</span>
        </button>
        <div id="comprobante-msg" style="display:none;margin-top:10px;padding:12px;border-radius:10px;font-size:13px;text-align:center"></div>
      </form>
    </div>

    <!-- 4. Mis Comprobantes Informados -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;border-radius:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:20px">📋</span>
        <div>
          <div style="font-size:15px;font-weight:800;color:#0F172A">Mis Comprobantes Informados (${misComprobantes.length})</div>
          <div style="font-size:11.5px;color:#64748B">Seguimiento de transferencias enviadas</div>
        </div>
      </div>

      ${misComprobantes.length > 0 ? `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${misComprobantes.map(c => {
          const isAprobado = c.estado === 'aprobado';
          return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFD;gap:10px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:38px;height:38px;border-radius:10px;background:#EBF3FC;color:#1E5FB4;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
                💵
              </div>
              <div>
                <div style="font-size:14px;font-weight:800;color:#0F172A">${esc(c.monto || 'Comprobante')}</div>
                <div style="font-size:11.5px;color:#64748B">📅 ${esc(c.fecha || 'Reciente')}${c.notas ? ' · ' + esc(c.notas) : ''}</div>
              </div>
            </div>
            <span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:${isAprobado ? '#DCFCE7' : '#FEF3C7'};color:${isAprobado ? '#15803D' : '#92400E'};border:1px solid ${isAprobado ? '#86EFAC' : '#FCD34D'}">
              ${isAprobado ? '✓ Imputado / Al Día' : '⏳ En Revisión'}
            </span>
          </div>`;
        }).join('')}
      </div>` : `
      <div style="text-align:center;padding:20px;color:#8595AD;font-size:12.5px;background:#F8FAFD;border-radius:12px;border:1px dashed #DCE4F0">
        Aún no has informado pagos este período. Al subir tu comprobante quedará registrado acá para tu tranquilidad.
      </div>`}
    </div>

    <!-- 5. Historial Completo de Liquidaciones Anteriores -->
    <div class="card" style="padding:18px 20px;margin-bottom:18px;border-radius:18px">
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

      function previewComprobante(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var pBox = document.getElementById('preview-comprobante-box');
        var sBox = document.getElementById('box-select-comprobante');
        var img = document.getElementById('preview-comprobante-img');
        var pdfIcon = document.getElementById('preview-comprobante-pdf-icon');
        var nameEl = document.getElementById('preview-comprobante-name');
        var sizeEl = document.getElementById('preview-comprobante-size');

        nameEl.textContent = file.name;
        sizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        if (file.type.startsWith('image/')) {
          var reader = new FileReader();
          reader.onload = function(evt) {
            img.src = evt.target.result;
            img.style.display = 'block';
            pdfIcon.style.display = 'none';
          };
          reader.readAsDataURL(file);
        } else {
          img.style.display = 'none';
          pdfIcon.style.display = 'flex';
        }

        sBox.style.display = 'none';
        pBox.style.display = 'block';
      }

      function quitarComprobante() {
        document.getElementById('inp-comprobante-file').value = '';
        document.getElementById('preview-comprobante-box').style.display = 'none';
        document.getElementById('box-select-comprobante').style.display = 'block';
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
        btn.innerHTML = '<span>⏳ Enviando comprobante...</span>';

        var formData = new FormData();
        formData.append('comprobante', fileInp.files[0]);
        formData.append('monto', montoInp.value.trim());

        try {
          var res = await fetch('/vecino/api/comprobante-pago', {
            method: 'POST',
            body: formData
          });
          var data = await res.json();
          if (data && data.ok) {
            msg.style.display = 'block';
            msg.style.background = '#DCFCE7';
            msg.style.color = '#15803D';
            msg.style.border = '1px solid #86EFAC';
            msg.textContent = data.mensaje || '¡Comprobante enviado con éxito! Tu administración lo revisará a la brevedad.';
            fileInp.value = '';
            montoInp.value = '';
            btn.innerHTML = '<span>✓ Comprobante Registrado</span>';
            setTimeout(function(){ location.reload(); }, 1800);
          } else {
            msg.style.display = 'block';
            msg.style.background = '#FEE2E2';
            msg.style.color = '#991B1B';
            msg.style.border = '1px solid #FCA5A5';
            msg.textContent = 'Error: ' + (data.error || 'No se pudo enviar el comprobante');
            btn.disabled = false;
            btn.innerHTML = '<span>Reintentar envío</span>';
          }
        } catch (err) {
          msg.style.display = 'block';
          msg.style.background = '#FEE2E2';
          msg.style.color = '#991B1B';
          msg.style.border = '1px solid #FCA5A5';
          msg.textContent = 'Error de conexión al enviar el comprobante: ' + err.message;
          btn.disabled = false;
          btn.innerHTML = '<span>Reintentar envío</span>';
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
    const nuevoComprobante = {
      id: Date.now(),
      edificio: v.edificio,
      vecino: v.nombre + ' (' + v.departamento + ')',
      monto: monto ? ('$' + monto.replace(/^\$/, '')) : '$120.000',
      fecha: new Date().toLocaleDateString('es-AR'),
      url: archivoUrl,
      estado: 'pendiente_aprobacion',
      notas: 'Comprobante informado desde el Portal del Vecino'
    };

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
      console.warn('Registro comprobante PG:', errDb.message);
    }

    _comprobantesEnMemoria.unshift(nuevoComprobante);

    // Notificar a la administración por WhatsApp si está configurado
    try {
      const marcosOps = require('./agentes/marcos-ops');
      if (marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
        const adminPhone = process.env.ADMIN_PHONE || '+5491150542005';
        const phoneId = process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
        const token = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
        const msgAlerta = `💳 *NUEVO COMPROBANTE DE EXPENSAS INFORMADO*\n\n` +
          `🏢 *Edificio:* ${v.edificio}\n` +
          `👤 *Vecino:* ${v.nombre} (${v.departamento})\n` +
          `💵 *Monto:* ${nuevoComprobante.monto}\n` +
          `📅 *Fecha:* ${nuevoComprobante.fecha}\n\n` +
          `👉 Ver en Panel: https://marcos.bienargentinos.com/admin/archivos`;
        await marcosOps.enviarWhatsApp(adminPhone, msgAlerta, phoneId, token).catch(() => {});
      }
    } catch (_) {}

    res.json({
      ok: true,
      mensaje: '¡Comprobante enviado con éxito! Tu administración lo revisará a la brevedad.',
      archivoUrl,
      comprobante: nuevoComprobante
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
// 5.5 RECLAMOS & REPORTES DE ROTURAS CON FOTO
// -------------------------------------------------------------------
const _reclamosEnMemoria = [
  {
    id: 101,
    codigo_caso: 'CASO-2104',
    edificio: 'San Patricio 159',
    depto: '1° A',
    vecino: 'Daniel Morales',
    telefono: '+5491150542005',
    rubro: 'Plomería',
    problema: 'Goteo en la llave de paso de la cocina. Requiere cambio de cuerito.',
    urgencia: 'normal',
    foto_url: '',
    estado: 'en_curso',
    created_at: new Date(Date.now() - 36 * 3600000).toISOString()
  },
  {
    id: 102,
    codigo_caso: 'CASO-2089',
    edificio: 'San Patricio 159',
    depto: 'Palier Piso 1',
    vecino: 'Daniel Morales',
    telefono: '+5491150542005',
    rubro: 'Electricidad',
    problema: 'Luz dicroica del palier frente al ascensor quemada.',
    urgencia: 'normal',
    foto_url: '',
    estado: 'resuelto',
    created_at: new Date(Date.now() - 72 * 3600000).toISOString()
  }
];

function renderItemReclamo(r) {
  const estadoColor = r.estado === 'resuelto' ? { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC', label: '✓ Resuelto' }
    : r.estado === 'en_curso' ? { bg: '#EBF3FC', text: '#1E5FB4', border: '#93C5FD', label: '⚙️ En curso' }
    : { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D', label: '⏳ Pendiente' };

  const iconRubro = (r.rubro || '').toLowerCase().includes('plom') ? '💧'
    : (r.rubro || '').toLowerCase().includes('elec') ? '⚡'
    : (r.rubro || '').toLowerCase().includes('ascen') ? '🛗'
    : (r.rubro || '').toLowerCase().includes('cerraj') ? '🔑'
    : (r.rubro || '').toLowerCase().includes('limp') ? '🧹'
    : '🛠️';

  const fechaStr = r.created_at ? new Date(r.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Reciente';

  return `
    <div class="card" style="padding:14px 16px;background:#fff;border-radius:16px;border:1px solid #E2E8F0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:18px">${iconRubro}</span>
          <span style="font-size:13.5px;font-weight:900;color:#0F172A">${esc(r.rubro || 'Avería')}</span>
          <span style="font-size:11px;font-weight:800;color:#64748B;background:#F1F5F9;padding:2px 6px;border-radius:6px">${esc(r.codigo_caso)}</span>
        </div>
        <span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:${estadoColor.bg};color:${estadoColor.text};border:1px solid ${estadoColor.border}">
          ${estadoColor.label}
        </span>
      </div>

      <p style="font-size:13px;color:#334155;line-height:1.4;margin-bottom:8px">
        ${esc(r.problema)}
      </p>

      ${r.foto_url ? `
        <div style="margin-bottom:10px">
          <img src="${r.foto_url}" onclick="verFotoGrande(this.src)" style="width:72px;height:72px;border-radius:10px;object-fit:cover;border:1px solid #CBD5E1;cursor:pointer" title="Click para ampliar">
        </div>
      ` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#94A3B8;border-top:1px solid #F1F5F9;padding-top:8px">
        <span>📍 ${esc(r.depto || 'Edificio')}</span>
        <span>🕒 ${fechaStr} hs</span>
      </div>
    </div>
  `;
}

router.get('/reclamos', async (req, res) => {
  const v = getVecinoSession(req);
  let reclamosLista = [];

  try {
    const { pool } = require('./db-pg');
    if (pool) {
      const q = `SELECT * FROM reportes WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2)) ORDER BY created_at DESC LIMIT 30`;
      const result = await pool.query(q, [v.edificio, '%' + v.edificio + '%']);
      if (result && result.rows && result.rows.length > 0) {
        reclamosLista = result.rows.map(r => ({
          id: r.id,
          codigo_caso: r.codigo_caso || ('CASO-' + r.id),
          edificio: r.edificio,
          depto: r.depto || r.departamento || '1° A',
          vecino: r.vecino || 'Vecino',
          telefono: r.telefono || '',
          rubro: r.rubro || 'General',
          problema: r.problema || r.mensaje || '',
          urgencia: r.urgencia || 'normal',
          foto_url: r.foto_url || '',
          estado: r.estado || 'pendiente',
          created_at: r.created_at || new Date().toISOString()
        }));
      }
    }
  } catch (errDb) {
    console.warn('Carga reportes DB:', errDb.message);
  }

  // Combinar con memoria local sin duplicar
  const idsExistentes = new Set(reclamosLista.map(r => String(r.codigo_caso)));
  for (const rMem of _reclamosEnMemoria) {
    if (!idsExistentes.has(String(rMem.codigo_caso))) {
      reclamosLista.push(rMem);
    }
  }

  // Separar los propios del vecino vs los del edificio
  const misReclamos = reclamosLista.filter(r => 
    (r.depto && r.depto.toLowerCase().includes(v.departamento.toLowerCase())) ||
    (r.vecino && r.vecino.toLowerCase() === v.nombre.toLowerCase())
  );
  const otrosReclamos = reclamosLista.filter(r => !misReclamos.includes(r));

  const totalActivos = reclamosLista.filter(r => r.estado !== 'resuelto').length;

  const content = `
    <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div>
        <h2 style="font-size:20px;font-weight:900;color:#0F326A;margin-bottom:2px">Reclamos y Averías</h2>
        <p style="font-size:13px;color:#64748B">${esc(v.edificio)} · Depto ${esc(v.departamento)}</p>
      </div>
      <button onclick="abrirModalReclamo()" style="padding:10px 18px;border:none;border-radius:12px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(15,50,106,.25)">
        <i class="ph ph-plus-circle" style="font-size:18px"></i>
        <span>Reportar Rotura</span>
      </button>
    </div>

    <!-- TARJETA RESUMEN -->
    <div class="card" style="padding:16px 18px;background:#fff;margin-bottom:16px;border-radius:18px;display:flex;align-items:center;justify-content:space-around;text-align:center">
      <div>
        <div style="font-size:22px;font-weight:900;color:#D97706">${totalActivos}</div>
        <div style="font-size:11.5px;font-weight:700;color:#64748B;text-transform:uppercase">En Gestión</div>
      </div>
      <div style="width:1px;height:36px;background:#E2E8F0"></div>
      <div>
        <div style="font-size:22px;font-weight:900;color:#15803D">${reclamosLista.filter(r => r.estado === 'resuelto').length}</div>
        <div style="font-size:11.5px;font-weight:700;color:#64748B;text-transform:uppercase">Resueltos</div>
      </div>
      <div style="width:1px;height:36px;background:#E2E8F0"></div>
      <div>
        <div style="font-size:22px;font-weight:900;color:#0F326A">${misReclamos.length}</div>
        <div style="font-size:11.5px;font-weight:700;color:#64748B;text-transform:uppercase">Mis Casos</div>
      </div>
    </div>

    <!-- LISTADO DE RECLAMOS DEL VECINO -->
    <div style="margin-bottom:20px">
      <div style="font-size:14px;font-weight:800;color:#0F172A;margin-bottom:10px;display:flex;align-items:center;gap:6px">
        <span>👤</span> Mis Reclamos Reportados (${misReclamos.length})
      </div>
      ${misReclamos.length === 0 ? `
        <div class="card" style="padding:24px 16px;text-align:center;color:#64748B;border-radius:16px">
          <div style="font-size:32px;margin-bottom:8px">🎉</div>
          <div style="font-size:14px;font-weight:700;color:#1E293B;margin-bottom:4px">No tenés reclamos activos</div>
          <p style="font-size:12.5px;color:#64748B">Si notás alguna rotura en tu departamento o en el edificio, podés reportarla aquí.</p>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${misReclamos.map(r => renderItemReclamo(r)).join('')}
        </div>
      `}
    </div>

    <!-- RECLAMOS EN ÁREAS COMUNES DEL EDIFICIO -->
    ${otrosReclamos.length > 0 ? `
      <div style="margin-bottom:20px">
        <div style="font-size:14px;font-weight:800;color:#0F172A;margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <span>🏢</span> Averías en Áreas Comunes (${otrosReclamos.length})
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${otrosReclamos.map(r => renderItemReclamo(r)).join('')}
        </div>
      </div>
    ` : ''}

    <!-- MODAL NUEVO RECLAMO CON FOTO -->
    <div id="modal-nuevo-reclamo" style="position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px;box-sizing:border-box">
      <div style="background:#fff;width:100%;max-width:480px;border-radius:24px;padding:24px 20px;box-shadow:0 25px 50px rgba(0,0,0,.25);max-height:92vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:38px;height:38px;border-radius:10px;background:#EBF3FC;color:#1E5FB4;display:flex;align-items:center;justify-content:center;font-size:20px">
              🛠️
            </div>
            <div>
              <h3 style="font-size:17px;font-weight:900;color:#0F326A">Reportar Reclamo o Rotura</h3>
              <div style="font-size:12px;color:#64748B">${esc(v.edificio)}</div>
            </div>
          </div>
          <button onclick="cerrarModalReclamo()" style="width:32px;height:32px;border-radius:50%;border:none;background:#F1F5F9;color:#64748B;font-size:15px;cursor:pointer">✕</button>
        </div>

        <form id="form-reclamo" onsubmit="enviarReclamo(event)">
          <!-- 1. Rubro con Chips -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Rubro / Tipo de Problema</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px" id="chips-rubros">
              <div class="chip-rubro active" onclick="seleccionarRubro('Plomería / Agua', this)">💧 Plomería</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Electricidad / Luces', this)">⚡ Electricidad</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Ascensores', this)">🛗 Ascensor</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Cerrajería / Portón', this)">🔑 Cerrajería</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Gas / Calefacción', this)">🔥 Gas</div>
              <div class="chip-rubro" onclick="seleccionarRubro('Limpieza / Residuos', this)">🧹 Limpieza</div>
            </div>
          </div>

          <!-- 2. Ubicación -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Ubicación del Problema</label>
            <div style="display:flex;gap:8px">
              <label style="flex:1;display:flex;align-items:center;gap:6px;background:#F8FAFD;border:1.5px solid #CBD5E1;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer">
                <input type="radio" name="ubicacion-tipo" value="depto" checked onchange="actualizarUbicacion(this.value)">
                <span>En mi Depto (${esc(v.departamento)})</span>
              </label>
              <label style="flex:1;display:flex;align-items:center;gap:6px;background:#F8FAFD;border:1.5px solid #CBD5E1;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer">
                <input type="radio" name="ubicacion-tipo" value="comun" onchange="actualizarUbicacion(this.value)">
                <span>Área Común</span>
              </label>
            </div>
          </div>

          <!-- 3. Descripción -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Descripción del problema</label>
            <textarea id="desc-reclamo" placeholder="Explicá en detalle qué ocurre (ej: Hay una fuga de agua debajo del fregadero o la luz del palier no prende)..." required style="width:100%;height:80px;border:1.5px solid #CBD5E1;border-radius:12px;padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none;resize:none;box-sizing:border-box"></textarea>
          </div>

          <!-- 4. Subir Foto / Cámara -->
          <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Foto de la rotura (Muy Recomendado)</label>
            <input type="file" id="foto-input" accept="image/*" capture="environment" style="display:none" onchange="procesarFotoReclamo(event)">
            
            <div id="btn-foto-box" onclick="document.getElementById('foto-input').click()" style="border:2px dashed #93C5FD;background:#F8FAFD;border-radius:14px;padding:16px;text-align:center;cursor:pointer">
              <div style="font-size:26px;margin-bottom:4px">📸</div>
              <div style="font-size:13px;font-weight:800;color:#1E5FB4">Sacar Foto con la Cámara o Elegir de Galería</div>
              <div style="font-size:11.5px;color:#64748B">Ayuda al técnico a traer el repuesto exacto</div>
            </div>

            <!-- Preview de Foto Cargada -->
            <div id="foto-preview-container" style="display:none;position:relative;margin-top:8px;border-radius:12px;overflow:hidden;border:1px solid #CBD5E1">
              <img id="foto-preview-img" src="" style="width:100%;height:180px;object-fit:cover;display:block">
              <button type="button" onclick="quitarFotoReclamo()" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
            </div>
          </div>

          <!-- 5. Urgencia -->
          <div style="margin-bottom:20px">
            <label style="display:flex;align-items:center;gap:8px;background:#FEF2F2;border:1.5px solid #FCA5A5;border-radius:12px;padding:10px 14px;cursor:pointer">
              <input type="checkbox" id="check-urgente" style="width:18px;height:18px">
              <div>
                <div style="font-size:13px;font-weight:900;color:#991B1B">🚨 Marcar como Urgencia Grave</div>
                <div style="font-size:11px;color:#7F1D1D">Inundación, corte de luz general, fuga de gas o riesgo físico</div>
              </div>
            </label>
          </div>

          <button id="btn-enviar-reclamo" type="submit" style="width:100%;height:48px;border:none;border-radius:14px;background:linear-gradient(135deg,#0F326A,#1E5FB4);color:#fff;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 4px 14px rgba(15,50,106,.3);display:flex;align-items:center;justify-content:center;gap:8px">
            <span>Enviar Reclamo a Marcos IA</span>
          </button>
        </form>
      </div>
    </div>

    <!-- MODAL LIGHTBOX PARA VER FOTO EN GRANDE -->
    <div id="modal-lightbox" onclick="this.style.display='none'" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:none;align-items:center;justify-content:center;padding:16px">
      <img id="lightbox-img" src="" style="max-width:92%;max-height:85vh;border-radius:14px;object-fit:contain;box-shadow:0 20px 40px rgba(0,0,0,.5)">
    </div>

    <style>
      .chip-rubro {
        padding: 9px 12px;
        border-radius: 10px;
        border: 1.5px solid #E2E8F0;
        background: #F8FAFD;
        font-size: 12.5px;
        font-weight: 700;
        color: #334155;
        cursor: pointer;
        transition: all .15s;
        text-align: center;
      }
      .chip-rubro.active {
        border-color: #0F326A;
        background: #EBF3FC;
        color: #0F326A;
        font-weight: 800;
      }
    </style>

    <script>
      var _rubroSeleccionado = 'Plomería / Agua';
      var _fotoReclamoBase64 = '';
      var _ubicacionTipo = 'depto';

      function seleccionarRubro(nombre, el) {
        _rubroSeleccionado = nombre;
        document.querySelectorAll('.chip-rubro').forEach(function(c){ c.classList.remove('active'); });
        el.classList.add('active');
      }

      function actualizarUbicacion(val) {
        _ubicacionTipo = val;
      }

      function abrirModalReclamo() {
        document.getElementById('modal-nuevo-reclamo').style.display = 'flex';
      }

      function cerrarModalReclamo() {
        document.getElementById('modal-nuevo-reclamo').style.display = 'none';
      }

      function verFotoGrande(src) {
        document.getElementById('lightbox-img').src = src;
        document.getElementById('modal-lightbox').style.display = 'flex';
      }

      function procesarFotoReclamo(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(evt) {
          _fotoReclamoBase64 = evt.target.result;
          document.getElementById('foto-preview-img').src = _fotoReclamoBase64;
          document.getElementById('foto-preview-container').style.display = 'block';
          document.getElementById('btn-foto-box').style.display = 'none';
        };
        reader.readAsDataURL(file);
      }

      function quitarFotoReclamo() {
        _fotoReclamoBase64 = '';
        document.getElementById('foto-input').value = '';
        document.getElementById('foto-preview-container').style.display = 'none';
        document.getElementById('btn-foto-box').style.display = 'block';
      }

      async function enviarReclamo(e) {
        e.preventDefault();
        var btn = document.getElementById('btn-enviar-reclamo');
        var desc = document.getElementById('desc-reclamo').value.trim();
        var esUrgente = document.getElementById('check-urgente').checked;

        if (!desc) {
          alert('Por favor describí el problema.');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Registrando reclamo...</span>';

        try {
          var res = await fetch('/vecino/api/reclamos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rubro: _rubroSeleccionado,
              ubicacion: _ubicacionTipo,
              descripcion: desc,
              urgencia: esUrgente ? 'urgente' : 'normal',
              fotoBase64: _fotoReclamoBase64
            })
          });
          var data = await res.json();
          if (data && data.ok) {
            alert('✅ ¡Reclamo registrado con éxito! Código: ' + (data.codigoCaso || '') + '\\n\\nMarcos IA ya lo asignó y notificó a la Administración.');
            location.reload();
          } else {
            alert('Error al registrar reclamo: ' + (data.error || 'Intente nuevamente'));
            btn.disabled = false;
            btn.innerHTML = '<span>Enviar Reclamo a Marcos IA</span>';
          }
        } catch(err) {
          alert('Error de conexión: ' + err.message);
          btn.disabled = false;
          btn.innerHTML = '<span>Enviar Reclamo a Marcos IA</span>';
        }
      }
    </script>
  `;

  res.send(shellVecino('Reclamos', 'reclamos', content, v));
});

router.post('/api/reclamos', async (req, res) => {
  const v = getVecinoSession(req);
  const { rubro, ubicacion, descripcion, urgencia, fotoBase64 } = req.body || {};

  if (!descripcion || !descripcion.trim()) {
    return res.status(400).json({ ok: false, error: 'La descripción del problema es requerida.' });
  }

  const codigoCaso = 'CASO-' + Math.floor(1000 + Math.random() * 9000);
  const nuevoReclamo = {
    id: Date.now(),
    codigo_caso: codigoCaso,
    edificio: v.edificio,
    depto: ubicacion === 'comun' ? 'Área Común' : (v.departamento || '1° A'),
    vecino: v.nombre,
    telefono: v.telefono || '+5491150542005',
    rubro: rubro || 'Mantenimiento General',
    problema: descripcion.trim(),
    urgencia: urgencia || 'normal',
    foto_url: fotoBase64 || '',
    estado: 'pendiente',
    created_at: new Date().toISOString()
  };

  try {
    const { pool } = require('./db-pg');
    if (pool) {
      await pool.query(
        `INSERT INTO reportes (codigo_caso, edificio, depto, vecino, telefono, problema, urgencia, estado, foto_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          codigoCaso,
          v.edificio,
          nuevoReclamo.depto,
          v.nombre,
          nuevoReclamo.telefono,
          `[${nuevoReclamo.rubro}] ${nuevoReclamo.problema}`,
          nuevoReclamo.urgencia,
          'pendiente',
          nuevoReclamo.foto_url
        ]
      ).catch(e => console.warn('Error insertando en reportes PG:', e.message));
    }
  } catch (errDb) {
    console.warn('DB reportes error:', errDb.message);
  }

  _reclamosEnMemoria.unshift(nuevoReclamo);

  res.json({
    ok: true,
    mensaje: 'Reclamo registrado con éxito',
    codigoCaso: codigoCaso,
    reclamo: nuevoReclamo
  });
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
  let datosBanco = null;

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
          hora_cierre: a.hora_cierre || '23:00',
          arancelado: Boolean(a.arancelado),
          precio: Number(a.precio || 0),
          moneda: a.moneda || 'ARS'
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

      // 3. Cargar datos bancarios del edificio para transferencias de seña/arancel
      const qEd = `SELECT cbu, alias, titular, banco, cuit FROM edificios WHERE LOWER(nombre) = LOWER($1) OR LOWER(consorcio) = LOWER($1) LIMIT 1`;
      const resEd = await pool.query(qEd, [v.edificio]);
      if (resEd && resEd.rows && resEd.rows.length > 0) {
        const r = resEd.rows[0];
        if (r.cbu || r.alias) {
          datosBanco = r;
        }
      }
    }
  } catch (errDb) {
    console.warn('Carga reservas amenities:', errDb.message);
  }

  // Fallback de datos bancarios si no fueron configurados específicamente
  if (!datosBanco) {
    datosBanco = {
      banco: 'Banco Oficial del Consorcio',
      titular: 'Consorcio ' + (v.edificio || 'Edificio'),
      cbu: 'Consultar con Administración',
      alias: (v.edificio || 'consorcio').toLowerCase().replace(/[^a-z0-9]/g, '') + '.expensas',
    };
  }

  // Si aún no se configuraron amenities en este edificio, usar catálogo estándar con aranceles sugeridos
  if (!amenitiesList.length) {
    amenitiesList = [
      { id: 'sum', nombre: 'SUM (Salón de Eventos)', icon: '🎉', desc: 'Capacidad 35 personas · Parrilla, vajilla, TV y aire frío/calor', reglamento: 'Música permitida hasta 01:00 hs. Seña de $15.000 para limpieza. Dejar vajilla limpia. Prohibido fumar adentro.', hora_apertura: '09:00', hora_cierre: '23:00', arancelado: true, precio: 15000, moneda: 'ARS' },
      { id: 'parrilla', nombre: 'Parrilla / Quincho', icon: '🥩', desc: 'Capacidad 15 personas · Parrilla a leña, mesa exterior y bacha', reglamento: 'Uso de carbón o leña propios. Apagar brasas y limpiar la parrilla al finalizar.', hora_apertura: '10:00', hora_cierre: '23:00', arancelado: false, precio: 0, moneda: 'ARS' },
      { id: 'pileta', nombre: 'Pileta & Solarium', icon: '🏊', desc: 'Solarium con reposeras · Temporada habilitada', reglamento: 'Uso obligatorio de gorro. Revisación médica previa. Menores de 12 años acompañados por un adulto.', hora_apertura: '09:00', hora_cierre: '20:00', arancelado: false, precio: 0, moneda: 'ARS' },
      { id: 'gimnasio', nombre: 'Gimnasio', icon: '🏋️', desc: 'Cinta para correr, mancuernas, polea y bicicleta estática', reglamento: 'Uso de toalla obligatorio para las máquinas. Limpiar y desinfectar el equipamiento tras su uso.', hora_apertura: '07:00', hora_cierre: '22:00', arancelado: false, precio: 0, moneda: 'ARS' },
      { id: 'cochera', nombre: 'Cochera de Cortesía', icon: '🚗', desc: 'Espacio de estacionamiento para visitas', reglamento: 'Máximo 48 hs continuas por visitante. Identificar vehículo con patente en portería.', hora_apertura: '08:00', hora_cierre: '23:00', arancelado: true, precio: 5000, moneda: 'ARS' },
      { id: 'laundry', nombre: 'Laundry / Lavadero', icon: '🧺', desc: 'Lavarropas y secarropas automáticos', reglamento: 'Utilizar jabón para lavarropas automáticos. Retirar prendas al terminar el ciclo.', hora_apertura: '08:00', hora_cierre: '21:00', arancelado: false, precio: 0, moneda: 'ARS' }
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
        <span>🎟️</span> Mis Reservas (${misReservas.length})
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${misReservas.map(r => {
          const montoNum = Number(r.monto || 0);
          const estadoPago = r.estado_pago || (montoNum > 0 ? 'pendiente' : 'no_requiere');
          let badgePago = '';
          if (montoNum > 0) {
            if (estadoPago === 'aprobado') {
              badgePago = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:#DCFCE7;color:#15803D;border:1px solid #86EFAC">✅ Pago Aprobado ($' + montoNum.toLocaleString('es-AR') + ')</span>';
            } else if (estadoPago === 'comprobante_subido') {
              badgePago = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:#FEF3C7;color:#92400E;border:1px solid #FCD34D">⏳ Pago en Revisión ($' + montoNum.toLocaleString('es-AR') + ')</span>' +
                (r.comprobante_url ? ' <a href="' + r.comprobante_url + '" target="_blank" style="font-size:11px;font-weight:700;color:#1E5FB4;text-decoration:underline;margin-left:4px">👁️ Ver Comprobante</a>' : '');
            } else {
              badgePago = '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:#FEE2E2;color:#DC2626;border:1px solid #FCA5A5">⚠️ Pago Pendiente ($' + montoNum.toLocaleString('es-AR') + ')</span>' +
                ' <button onclick="abrirModalPagarReserva(' + r.id + ', \'' + escJs(r.amenity) + '\', ' + montoNum + ')" style="border:none;background:linear-gradient(135deg,#1E5FB4,#2E6FC0);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;margin-left:6px;box-shadow:0 2px 6px rgba(30,95,180,0.25)">💳 Subir Comprobante</button>';
            }
          } else {
            badgePago = '<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#F1F5F9;color:#64748B">🟢 Sin costo</span>';
          }

          return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFD;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:220px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:14px;font-weight:800;color:#0F172A">${esc(r.amenity)}</span>
                ${badgePago}
              </div>
              <div style="font-size:12px;color:#64748B">📆 ${esc(r.fecha)} · ⏰ <strong>${esc(r.hora_desde || '00:00')} a ${esc(r.hora_hasta || '00:00')} hs</strong>${r.notas ? ' · ' + esc(r.notas) : ''}</div>
            </div>
            <button onclick="cancelarReserva(${r.id})" style="border:1px solid #FCA5A5;background:#FEF2F2;color:#DC2626;font-size:11.5px;font-weight:700;padding:5px 10px;border-radius:6px;cursor:pointer">Cancelar</button>
          </div>`;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <!-- FORMULARIO DE RESERVA POR HORAS (ESTILO BUTACAS / BLOQUES) -->
    <div class="card" style="margin-bottom:16px;padding:18px 20px">
      <div style="font-size:15px;font-weight:800;color:#0F172A;margin-bottom:14px;display:flex;align-items:center;gap:6px">
        <span>📅</span> Nueva Reserva por Horas
      </div>

      <form id="form-reserva-amenity" onsubmit="guardarReserva(event)">
        <!-- 1. Selección del Amenity -->
        <div style="margin-bottom:16px">
          <label style="font-size:12.5px;font-weight:700;color:#475569;display:block;margin-bottom:8px">1. Elegí el espacio común</label>
          <div id="grid-amenities" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
            ${amenitiesList.map((a, idx) => `
              <div onclick="seleccionarAmenity('${escJs(a.nombre)}', this)" class="amenity-card-item ${idx === 0 ? 'selected' : ''}">
                <div style="font-size:26px;margin-bottom:4px">${esc(a.icon)}</div>
                <div class="amenity-title">${esc(a.nombre)}</div>
                <div class="amenity-time">${esc(a.hora_apertura)} a ${esc(a.hora_cierre)} hs</div>
                ${a.arancelado && a.precio > 0 
                  ? `<div style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(251,191,36,0.15);color:#FBBF24;border:1px solid rgba(251,191,36,0.35);margin-top:4px;display:inline-block">💰 $${Number(a.precio).toLocaleString('es-AR')}</div>`
                  : `<div style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(74,222,128,0.12);color:#4ADE80;border:1px solid rgba(74,222,128,0.3);margin-top:4px;display:inline-block">🟢 Sin costo</div>`
                }
              </div>
            `).join('')}
          </div>
          <input type="hidden" id="inp-amenity-sel" value="${esc(amenitiesList[0].nombre)}">
        </div>

        <!-- Caja Informativa de Arancel y CBU / Gratuito -->
        <div id="box-info-arancel" style="margin-bottom:16px;padding:12px 14px;border-radius:12px;background:#EFF6FF;border:1px solid #BFDBFE;font-size:12.5px;color:#1E40AF;line-height:1.5">
          <!-- Completado dinámicamente por JS -->
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
          <input type="text" id="inp-reserva-notas" placeholder="Ej: Cumpleaños familiar o Reunión de trabajo" class="inp" style="background:#fff;margin-bottom:0">
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

    <!-- MODAL DE PAGO / SUBIDA DE COMPROBANTE DE RESERVA -->
    <div id="modal-pagar-reserva" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.3);overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;background:#F8FAFD">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:20px">💳</span>
            <span style="font-weight:800;font-size:15px;color:#0F172A">Informar Pago de Reserva</span>
          </div>
          <button type="button" onclick="cerrarModalPagarReserva()" style="background:none;border:none;font-size:20px;color:#64748B;cursor:pointer">✕</button>
        </div>
        
        <form id="form-pago-reserva-modal" onsubmit="enviarComprobanteReserva(event)" style="padding:20px">
          <input type="hidden" id="inp-modal-reserva-id" value="">
          
          <div style="margin-bottom:12px">
            <div style="font-size:12.5px;color:#64748B">Espacio a abonar:</div>
            <div id="txt-modal-amenity-nombre" style="font-size:15px;font-weight:800;color:#0F172A"></div>
            <div id="txt-modal-arancel-info" style="font-size:13px;font-weight:700;color:#1E5FB4;margin-top:2px"></div>
          </div>

          <!-- Datos de transferencia bancaria -->
          <div style="background:#F8FAFD;border:1px solid #E2E8F0;border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:#334155">
            <div style="font-weight:800;color:#0F172A;margin-bottom:4px">🏦 Datos Bancarios Oficiales:</div>
            <div>Titular: <strong>${esc(datosBanco.titular || 'Consorcio')}</strong></div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:3px">
              <span>Alias: <strong style="color:#1E5FB4">${esc(datosBanco.alias || '—')}</strong></span>
              ${datosBanco.alias ? `<button type="button" onclick="copiarTexto('${escJs(datosBanco.alias)}', this)" style="padding:2px 8px;border-radius:4px;border:1px solid #CBD5E1;background:#fff;color:#1E5FB4;font-size:11px;font-weight:700;cursor:pointer">Copiar</button>` : ''}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:3px">
              <span>CBU: <strong style="font-family:monospace">${esc(datosBanco.cbu || '—')}</strong></span>
              ${datosBanco.cbu ? `<button type="button" onclick="copiarTexto('${escJs(datosBanco.cbu)}', this)" style="padding:2px 8px;border-radius:4px;border:1px solid #CBD5E1;background:#fff;color:#1E5FB4;font-size:11px;font-weight:700;cursor:pointer">Copiar</button>` : ''}
            </div>
          </div>

          <!-- Selector de Archivo con Preview -->
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:800;color:#475569;display:block;margin-bottom:6px">Adjuntar Comprobante (Foto o PDF) <span style="color:#EF4444">*</span></label>
            <input type="file" id="inp-comprobante-reserva-file" accept="image/*,.pdf" style="display:none" onchange="previewComprobanteReserva(event)" required>
            
            <div id="box-select-comprobante-reserva" onclick="document.getElementById('inp-comprobante-reserva-file').click()" style="border:2px dashed #93C5FD;background:#FAFCFF;border-radius:12px;padding:16px;text-align:center;cursor:pointer">
              <div style="font-size:24px;margin-bottom:4px">🧾</div>
              <div style="font-size:13px;font-weight:800;color:#1E5FB4">Seleccionar Foto o PDF del Comprobante</div>
              <div style="font-size:11px;color:#64748B">Tocá para elegir desde tu dispositivo o galería</div>
            </div>

            <div id="preview-comprobante-reserva-box" style="display:none;position:relative;margin-top:8px;border-radius:10px;overflow:hidden;border:1px solid #CBD5E1;background:#fff;padding:8px">
              <div style="display:flex;align-items:center;gap:10px">
                <img id="preview-comprobante-reserva-img" src="" style="width:54px;height:54px;object-fit:cover;border-radius:6px;display:none;border:1px solid #E2E8F0">
                <div id="preview-comprobante-reserva-pdf" style="width:46px;height:46px;border-radius:8px;background:#FEE2E2;color:#DC2626;display:none;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
                  📄
                </div>
                <div style="flex:1;overflow:hidden">
                  <div id="preview-comprobante-reserva-name" style="font-size:12px;font-weight:800;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
                  <div id="preview-comprobante-reserva-size" style="font-size:11px;color:#64748B"></div>
                </div>
                <button type="button" onclick="quitarComprobanteReserva()" style="background:#F1F5F9;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;color:#64748B;font-size:12px;flex-shrink:0">✕</button>
              </div>
            </div>
          </div>

          <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:800;color:#475569;display:block;margin-bottom:6px">Monto Abonado ($)</label>
            <input type="text" id="inp-comprobante-reserva-monto" class="inp" style="background:#fff;margin-bottom:0" placeholder="Ej: 15000">
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button type="button" onclick="cerrarModalPagarReserva()" style="padding:10px 16px;border-radius:10px;border:1px solid #CBD5E1;background:#fff;color:#64748B;font-size:13px;font-weight:700;cursor:pointer">Cancelar</button>
            <button id="btn-enviar-comprobante-reserva" type="submit" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;font-size:13.5px;font-weight:800;cursor:pointer;box-shadow:0 2px 8px rgba(22,163,74,.3)">Enviar Comprobante</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      var _todasReservas = ${JSON.stringify(todasReservasEdificio)};
      var _amenitiesList = ${JSON.stringify(amenitiesList)};
      var _horasSeleccionadas = [];

      function copiarTexto(texto, btn) {
        navigator.clipboard.writeText(texto).then(function() {
          var old = btn.textContent;
          btn.textContent = '✓ Copiado';
          setTimeout(function() { btn.textContent = old; }, 1500);
        });
      }

      function seleccionarAmenity(nombre, el) {
        document.getElementById('inp-amenity-sel').value = nombre;
        var cards = document.querySelectorAll('.amenity-card-item');
        cards.forEach(function(c) {
          c.classList.remove('selected');
        });
        el.classList.add('selected');
        _horasSeleccionadas = [];
        
        // Actualizar caja de reglamento específico
        var amObj = _amenitiesList.find(function(a){ return a.nombre === nombre; });
        var tReg = document.getElementById('titulo-reglamento-amenity');
        var cReg = document.getElementById('contenido-reglamento-amenity');
        if (tReg && amObj) tReg.textContent = 'Reglamento: ' + amObj.nombre;
        if (cReg && amObj) {
          cReg.textContent = amObj.reglamento ? amObj.reglamento : 'Podés reservar desde 1 sola hora hasta varias continuas. El espacio debe entregarse limpio y en orden. Horario límite de música/ruidos: 01:00 hs.';
        }

        // Actualizar caja informativa de arancel
        actualizarCajaArancel(amObj);

        renderGrillaHoras();
      }

      function actualizarCajaArancel(amObj) {
        var box = document.getElementById('box-info-arancel');
        if (!box) return;
        if (amObj && amObj.arancelado && amObj.precio > 0) {
          box.style.display = 'block';
          box.style.background = '#FEF3C7';
          box.style.border = '1px solid #FCD34D';
          box.style.color = '#92400E';
          box.innerHTML = '💰 <strong>Arancel de Reserva requerido: $' + Number(amObj.precio).toLocaleString('es-AR') + '</strong><br>' +
            '<span style="font-size:11.5px;display:block;margin-top:3px">Una vez confirmada la reserva, podrás transferir a la cuenta del consorcio (Alias: <strong>${escJs(datosBanco.alias || '')}</strong>) y adjuntar el comprobante desde "Mis Reservas" o la sección Expensas para su validación oficial.</span>';
        } else {
          box.style.display = 'block';
          box.style.background = '#EFF6FF';
          box.style.border = '1px solid #BFDBFE';
          box.style.color = '#1E40AF';
          box.innerHTML = '🟢 <strong>Espacio sin costo adicional:</strong> El uso de este amenity está incluido en el mantenimiento ordinario de las expensas.';
        }
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
            btnSlot.className = 'hora-slot-btn ocupado';
            btnSlot.innerHTML = '<span>🔒 ' + hStartStr + '</span><span style="font-size:9.5px;opacity:.8">' + ocupadoPor + '</span>';
          } else {
            var isSel = _horasSeleccionadas.indexOf(h) !== -1;
            btnSlot.className = 'hora-slot-btn' + (isSel ? ' selected' : '');
            btnSlot.innerHTML = '<span>' + hStartStr + '</span><span style="font-size:10px;font-weight:700;opacity:' + (isSel ? '1' : '.7') + '">' + (isSel ? '✓ Elegido' : 'Libre') + '</span>';
            
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
            if (data.monto && Number(data.monto) > 0) {
              alert('✓ ¡Reserva registrada de ' + horaDesde + ' a ' + horaHasta + ' hs!\n\nEste espacio requiere un arancel de $' + Number(data.monto).toLocaleString('es-AR') + '.\nPodés transferir y adjuntar el comprobante ahora mismo o más tarde desde "Mis Reservas".');
              abrirModalPagarReserva(data.id, amenity, data.monto);
            } else {
              alert('✓ ¡Reserva confirmada de ' + horaDesde + ' a ' + horaHasta + ' hs con éxito!');
              location.reload();
            }
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

      function abrirModalPagarReserva(reservaId, amenityNombre, monto) {
        document.getElementById('inp-modal-reserva-id').value = reservaId;
        document.getElementById('txt-modal-amenity-nombre').textContent = amenityNombre;
        document.getElementById('txt-modal-arancel-info').textContent = 'Arancel / Seña: $' + Number(monto || 0).toLocaleString('es-AR');
        document.getElementById('inp-comprobante-reserva-monto').value = monto || '';
        quitarComprobanteReserva();
        var modal = document.getElementById('modal-pagar-reserva');
        modal.style.display = 'flex';
      }

      function cerrarModalPagarReserva() {
        var modal = document.getElementById('modal-pagar-reserva');
        modal.style.display = 'none';
        location.reload();
      }

      function previewComprobanteReserva(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var pBox = document.getElementById('preview-comprobante-reserva-box');
        var sBox = document.getElementById('box-select-comprobante-reserva');
        var img = document.getElementById('preview-comprobante-reserva-img');
        var pdfIcon = document.getElementById('preview-comprobante-reserva-pdf');
        var nameEl = document.getElementById('preview-comprobante-reserva-name');
        var sizeEl = document.getElementById('preview-comprobante-reserva-size');

        nameEl.textContent = file.name;
        sizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        if (file.type.startsWith('image/')) {
          var reader = new FileReader();
          reader.onload = function(evt) {
            img.src = evt.target.result;
            img.style.display = 'block';
            pdfIcon.style.display = 'none';
          };
          reader.readAsDataURL(file);
        } else {
          img.style.display = 'none';
          pdfIcon.style.display = 'flex';
        }

        sBox.style.display = 'none';
        pBox.style.display = 'block';
      }

      function quitarComprobanteReserva() {
        var fileInp = document.getElementById('inp-comprobante-reserva-file');
        if (fileInp) fileInp.value = '';
        var pBox = document.getElementById('preview-comprobante-reserva-box');
        var sBox = document.getElementById('box-select-comprobante-reserva');
        if (pBox) pBox.style.display = 'none';
        if (sBox) sBox.style.display = 'block';
      }

      async function enviarComprobanteReserva(e) {
        e.preventDefault();
        var fileInp = document.getElementById('inp-comprobante-reserva-file');
        var montoInp = document.getElementById('inp-comprobante-reserva-monto');
        var reservaIdInp = document.getElementById('inp-modal-reserva-id');
        var btn = document.getElementById('btn-enviar-comprobante-reserva');

        if (!fileInp.files || !fileInp.files[0]) {
          alert('Por favor adjuntá el comprobante de transferencia.');
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Enviando comprobante...';

        var formData = new FormData();
        formData.append('comprobante', fileInp.files[0]);
        formData.append('reserva_id', reservaIdInp.value);
        formData.append('monto', montoInp.value.trim());

        try {
          var res = await fetch('/vecino/api/comprobante-reserva', {
            method: 'POST',
            body: formData
          });
          var data = await res.json();
          if (data && data.ok) {
            alert(data.mensaje || '¡Comprobante enviado con éxito! La administración lo revisará a la brevedad.');
            cerrarModalPagarReserva();
          } else {
            alert('Error: ' + (data.error || 'No se pudo enviar el comprobante'));
            btn.disabled = false;
            btn.textContent = 'Enviar Comprobante';
          }
        } catch(err) {
          alert('Error de conexión al enviar el comprobante: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Enviar Comprobante';
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
        actualizarCajaArancel(_amenitiesList[0]);
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
    let monto = 0;
    let estado_pago = 'no_requiere';

    if (pool) {
      // 1. Averiguar si el amenity es arancelado y su precio
      try {
        const qAm = `SELECT arancelado, precio FROM edificio_amenities 
                     WHERE (LOWER(edificio) = LOWER($1) OR LOWER(edificio) LIKE LOWER($2))
                     AND LOWER(nombre) = LOWER($3) AND activo = TRUE LIMIT 1`;
        const amRes = await pool.query(qAm, [v.edificio, '%' + v.edificio + '%', amenity]);
        if (amRes && amRes.rows && amRes.rows.length > 0) {
          const amRow = amRes.rows[0];
          if (amRow.arancelado && Number(amRow.precio) > 0) {
            monto = Number(amRow.precio);
            estado_pago = 'pendiente';
          }
        } else {
          // Fallback para SUM ($15000) y Cochera ($5000) si no estaban en DB
          if (/sum|salón|salon/i.test(amenity)) {
            monto = 15000;
            estado_pago = 'pendiente';
          } else if (/cochera|estacionamiento/i.test(amenity)) {
            monto = 5000;
            estado_pago = 'pendiente';
          }
        }
      } catch (errAm) {
        console.warn('Verificación arancel amenity:', errAm.message);
      }

      // 2. Validar solapamiento con alguna reserva activa
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
      const qIns = `INSERT INTO reservas_amenities (edificio, amenity, fecha, hora_desde, hora_hasta, turno, departamento, nombre_vecino, telefono, estado, notas, monto, estado_pago, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()) RETURNING id`;
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
        notas || '',
        monto,
        estado_pago
      ]);

      return res.json({ 
        ok: true, 
        mensaje: 'Reserva confirmada con éxito', 
        id: insRes.rows[0].id,
        monto,
        estado_pago
      });
    }

    res.json({ ok: true, mensaje: 'Reserva registrada', id: Date.now(), monto, estado_pago });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Endpoint receptor de Comprobantes de Pago de Reservas de Amenities
router.post('/api/comprobante-reserva', uploadComprobante.single('comprobante'), async (req, res) => {
  try {
    const v = getVecinoSession(req);
    const { reserva_id, monto } = req.body || {};
    const file = req.file;

    if (!file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo de comprobante' });
    }

    const archivoUrl = '/archivos/facturas/' + file.filename;
    const montoFormateado = monto ? ('$' + String(monto).replace(/^\$/, '')) : '$0';
    
    let amenityNombre = 'Amenity';

    // 1. Actualizar reserva en PostgreSQL
    try {
      const { pool } = require('./db-pg');
      if (pool) {
        if (reserva_id) {
          const resReserva = await pool.query('SELECT amenity FROM reservas_amenities WHERE id = $1', [reserva_id]);
          if (resReserva && resReserva.rows && resReserva.rows.length > 0) {
            amenityNombre = resReserva.rows[0].amenity || 'Amenity';
          }
          await pool.query(
            `UPDATE reservas_amenities 
             SET estado_pago = 'comprobante_subido', comprobante_url = $1 
             WHERE id = $2`, 
            [archivoUrl, reserva_id]
          );
        }

        // 2. Insertar en tabla facturas (comprobante de pago unificado visible en expensas y panel admin)
        const qFact = `INSERT INTO facturas (edificio, tipo, proveedor, monto, fecha, url, estado, notas, created_at)
                       VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, NOW())`;
        await pool.query(qFact, [
          v.edificio,
          'comprobante_pago',
          v.nombre + ' (' + v.departamento + ')',
          monto || '0',
          archivoUrl,
          'pendiente_aprobacion',
          'Comprobante de pago de reserva ' + amenityNombre + (reserva_id ? (' #' + reserva_id) : '') + ' - ' + v.nombre + ' (' + v.departamento + ')'
        ]);
      }
    } catch (errDb) {
      console.warn('Registro comprobante reserva PG:', errDb.message);
    }

    // 3. Registrar en memoria para que aparezca de inmediato en /vecino/expensas
    const nuevoComprobante = {
      id: Date.now(),
      edificio: v.edificio,
      vecino: v.nombre + ' (' + v.departamento + ')',
      monto: montoFormateado,
      fecha: new Date().toLocaleDateString('es-AR'),
      url: archivoUrl,
      estado: 'pendiente_aprobacion',
      notas: '🎟️ Reserva: ' + amenityNombre + (reserva_id ? (' #' + reserva_id) : '')
    };
    _comprobantesEnMemoria.unshift(nuevoComprobante);

    // 4. Notificar a la administración por WhatsApp
    try {
      const marcosOps = require('./agentes/marcos-ops');
      if (marcosOps && typeof marcosOps.enviarWhatsApp === 'function') {
        const adminPhone = process.env.ADMIN_PHONE || '+5491150542005';
        const phoneId = process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
        const token = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
        const msgAlerta = `🎟️ *NUEVO COMPROBANTE DE RESERVA DE AMENITY*\n\n` +
          `🏢 *Edificio:* ${v.edificio}\n` +
          `👤 *Vecino:* ${v.nombre} (${v.departamento})\n` +
          `🎉 *Espacio:* ${amenityNombre}\n` +
          `💵 *Monto informado:* ${montoFormateado}\n` +
          `📅 *Fecha:* ${nuevoComprobante.fecha}\n\n` +
          `👉 Ver en Panel: https://marcos.bienargentinos.com/admin/amenities`;
        await marcosOps.enviarWhatsApp(adminPhone, msgAlerta, phoneId, token).catch(() => {});
      }
    } catch (_) {}

    res.json({
      ok: true,
      mensaje: '¡Comprobante de reserva recibido con éxito! La administración lo revisará a la brevedad.',
      archivoUrl
    });
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
