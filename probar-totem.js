// probar-totem.js — Servidor local rápido para probar el Tótem de Portería
const express = require('express');
const app = express();
const porteria = require('./porteria');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Montar rutas de portería
app.use('/porteria', porteria);

// Redirigir la raíz al tótem directamente
app.get('/', (req, res) => {
  res.redirect('/porteria/San%20Patricio%20159/totem');
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('  🔔 TÓTEM MARCOS IA (ESTILO HIPCAM) INICIADO');
  console.log('====================================================');
  console.log(`\n👉 Abrí en tu navegador: http://localhost:${PORT}`);
  console.log(`👉 Acceso directo al tótem: http://localhost:${PORT}/porteria/San%20Patricio%20159/totem\n`);
  console.log('💡 TIP PARA PROBARLO COMO TABLET DE 8" O 10":');
  console.log('   1. Abrí la URL en Google Chrome o Edge.');
  console.log('   2. Presioná F12 (Herramientas de Desarrollador).');
  console.log('   3. Apretá Ctrl + Shift + M para activar la vista de Dispositivo.');
  console.log('   4. Elegí resolución 800 x 1280 (vertical) o "iPad" / "Surface".');
  console.log('   5. Probá tocar la pantalla, tocar timbres y escanear un QR con tu webcam!\n');
});
