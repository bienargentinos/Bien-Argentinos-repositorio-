# Frente de Portero / Tótem Táctil Inteligente (Marcos IA)

Esta subcarpeta contiene **todo el código, interfaz y firmware** correspondiente al **frente de calle / tótem de portería inteligente** (estilo Hipcam / Hikvision) para consorcios, aislado del panel de administración central.

---

## 📁 Estructura de Archivos

```
frente-portero/
├── porteria-totem.js              # Interfaz táctil Kiosco (HTML5/CSS3/JS, Bento Grid Hipcam, QR, WebRTC, TTS)
├── probar-totem.js                # Servidor local Express para pruebas rápidas
├── iniciar-prueba-totem.bat       # Lanzador con doble clic para Windows
├── README.md                      # Esta documentación
└── hardware/
    └── esp32_relay_porteria.ino   # Firmware Arduino/PlatformIO para placa ESP32 con relé de apertura
```

---

## 🚀 Cómo Probarlo en la PC o Celular

1. **Doble clic en `iniciar-prueba-totem.bat`** (o en la terminal: `node frente-portero/probar-totem.js`).
2. Abrir en el navegador: **`http://localhost:3333`**.
3. **Para verlo como tablet de 8" o 10":**
   - Presionar `F12` en Chrome.
   - Presionar `Ctrl + Shift + M` (modo dispositivo).
   - Elegir resolución `800 x 1280` vertical.

---

## ⚡ Conexión con el Sistema Central

El archivo principal de rutas `../porteria.js` importa automáticamente `porteria-totem.js` desde esta subcarpeta:
- Ruta en el servidor central: `/porteria/:edificio/totem`
- Endpoints de control de puerta:
  - `POST /porteria/api/validar-qr`: Validación de pases temporales.
  - `POST /porteria/api/puerta/abrir`: Apertura manual de cerradura.
  - `GET /porteria/api/puerta/status`: Consulta periódica del ESP32.

---

## 🔌 Hardware del ESP32 (Firmware en `hardware/`)

- **Placa**: ESP32 NodeMCU / ESP-WROOM-32.
- **Relé**: Módulo relé 5V conectado al pin `GPIO 23`.
- **LED Estado**: `GPIO 2`.
- **Alimentación**: 12V 2A para cerradura + Step-Down a 5V para el ESP32.
