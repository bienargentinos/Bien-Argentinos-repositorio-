# Bien Argentinos — Facturador ARCA

## Qué hay en este repo

```
backend/
  app.py            → API Flask (endpoints /factura, /pdf, /ping)
  facturacion.py    → Conexión con ARCA via pyafipws
  pdf_generator.py  → PDF con diseño Bien Argentinos (ReportLab)
  sheets_logger.py  → Registro en Google Sheets
  requirements.txt  → Dependencias Python
  .env.example      → Variables de entorno a completar

frontend/
  index.html        → App de facturación (HTML + JS puro)

deploy/
  nginx.conf        → Configuración Nginx para el VPS
  setup_vps.sh      → Script de instalación automática
```

---

## Pasos para poner en marcha

### 1. Certificado ARCA
1. Ingresá a [ARCA](https://www.afip.gob.ar) con tu CUIT
2. Administrador de Relaciones → Agregar relación
3. Servicio: **WSFE – Facturación Electrónica**
4. Generá el par de claves, descargá `cert.crt` y `private.key`
5. Subílos al VPS en `/var/www/bienargentinos/backend/certs/`

### 2. Google Sheets (para el registro)
1. Creá un proyecto en [Google Cloud Console](https://console.cloud.google.com)
2. Habilitá la API de Google Sheets y Drive
3. Creá una cuenta de servicio → descargá el JSON
4. Compartí tu planilla con el email de la cuenta de servicio
5. Copiá el JSON a `/var/www/bienargentinos/backend/certs/google_service.json`

### 3. Instalar en el VPS
```bash
git clone <este-repo> /tmp/ba
cd /tmp/ba
sudo bash deploy/setup_vps.sh
```

### 4. Variables de entorno
Editá `/var/www/bienargentinos/backend/.env`:
```
AFIP_CUIT=20XXXXXXXXX9     ← tu CUIT sin guiones
AFIP_PV=1                  ← punto de venta configurado en ARCA
AFIP_AMBIENTE=homologacion ← cambiar a "produccion" cuando estés listo
```

### 5. Probar en homologación
Abrí `frontend/index.html` en el navegador (o vía Nginx).
Emitir una factura de prueba → verificar en ARCA Consulta de Comprobantes.

### 6. Pasar a producción
En `.env` cambiá `AFIP_AMBIENTE=produccion` y reiniciá el servicio:
```bash
sudo systemctl restart bienargentinos
```

---

## Comandos útiles en el VPS

```bash
sudo systemctl status bienargentinos   # ver estado
sudo journalctl -u bienargentinos -f   # ver logs en tiempo real
sudo systemctl restart bienargentinos  # reiniciar
```
