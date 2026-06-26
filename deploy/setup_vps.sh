#!/bin/bash
# ============================================================
# Bien Argentinos — Script de instalación en VPS DonWeb
# Correr como root o con sudo
# ============================================================
set -e

APP_DIR="/var/www/bienargentinos"
PYTHON="python3.11"

echo "==> Actualizando paquetes..."
apt-get update -q && apt-get install -y python3.11 python3.11-venv python3-pip nginx

echo "==> Creando estructura de directorios..."
mkdir -p "$APP_DIR/backend/certs"
mkdir -p "$APP_DIR/backend/cache"
mkdir -p "$APP_DIR/backend/pdfs"
mkdir -p "$APP_DIR/frontend"

echo "==> Copiando archivos..."
cp -r backend/* "$APP_DIR/backend/"
cp -r frontend/* "$APP_DIR/frontend/"

echo "==> Creando entorno virtual Python..."
$PYTHON -m venv "$APP_DIR/venv"
source "$APP_DIR/venv/bin/activate"
pip install --upgrade pip
pip install -r "$APP_DIR/backend/requirements.txt"

echo ""
echo "==> ⚠️  ANTES DE CONTINUAR:"
echo "     1. Copiá tu cert.crt a  $APP_DIR/backend/certs/cert.crt"
echo "     2. Copiá tu private.key a $APP_DIR/backend/certs/private.key"
echo "     3. Copiá google_service.json a $APP_DIR/backend/certs/"
echo "     4. Editá $APP_DIR/backend/.env con tu CUIT real"
echo "     5. Editá /etc/nginx/sites-available/bienargentinos con tu dominio/IP"
echo ""

echo "==> Configurando Nginx..."
cp deploy/nginx.conf /etc/nginx/sites-available/bienargentinos
ln -sf /etc/nginx/sites-available/bienargentinos /etc/nginx/sites-enabled/bienargentinos
nginx -t && systemctl reload nginx

echo "==> Creando servicio systemd para Flask..."
cat > /etc/systemd/system/bienargentinos.service <<EOF
[Unit]
Description=Bien Argentinos - Facturador ARCA
After=network.target

[Service]
User=www-data
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$APP_DIR/venv/bin/gunicorn -w 2 -b 127.0.0.1:5000 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bienargentinos
systemctl start bienargentinos

echo ""
echo "✅ Instalación completa."
echo "   Servicio: sudo systemctl status bienargentinos"
echo "   Logs:     sudo journalctl -u bienargentinos -f"
