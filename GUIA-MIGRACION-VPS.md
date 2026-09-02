# Guía de Migración Rápida y Despliegue de Marcos IA en un Nuevo VPS

Esta guía permite levantar **Marcos IA** en cualquier proveedor de VPS (Hetzner, DigitalOcean, Linode, AWS o DonWeb una vez recuperado) en menos de 5 minutos.

---

## 1. Requisitos del Servidor
- **SO:** Ubuntu 22.04 / 24.04 LTS o Debian 12
- **Hardware mínimo:** 1 vCPU, 2 GB RAM (Recomendado: 2 vCPU, 4 GB RAM)
- **Puertos abiertos:** 80 (HTTP), 443 (HTTPS), 22 (SSH)

---

## 2. Instalación de Dependencias (1 solo comando)
Conectate por SSH a tu nuevo servidor y ejecutá:

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git postgresql postgresql-contrib nginx certbot python3-certbot-nginx
npm install -g pm2
```

---

## 3. Configuración de la Base de Datos PostgreSQL

```bash
sudo -u postgres psql -c "CREATE USER marcos WITH PASSWORD 'MarcosConsorcio2026!';"
sudo -u postgres psql -c "CREATE DATABASE consorcio_db OWNER marcos;"
sudo -u postgres psql -d consorcio_db -c "GRANT ALL PRIVILEGES ON DATABASE consorcio_db TO marcos;"
```

Para cargar las tablas y esquema oficial:
```bash
sudo -u postgres psql -d consorcio_db -f /root/marcos/Consorcio-AI-Assistant/01-base-de-datos.sql
```

---

## 4. Clonar el Código desde GitHub

```bash
mkdir -p /root/marcos
cd /root/marcos
git clone -b claude/marcos-ia-whatsapp-template-vpg8gw https://github.com/bienargentinos/Bien-Argentinos-repositorio-.git Consorcio-AI-Assistant
cd Consorcio-AI-Assistant
npm install --production
```

---

## 5. Configurar Variables de Entorno (`.env`)
Crear el archivo `/root/marcos/Consorcio-AI-Assistant/.env` con tus credenciales:

```env
PORT=3000
DATABASE_URL=postgresql://marcos:MarcosConsorcio2026!@localhost:5432/consorcio_db
WHATSAPP_PHONE_NUMBER_ID=tu_phone_id
WHATSAPP_ACCESS_TOKEN=tu_meta_token
GEMINI_API_KEY=tu_api_key
OPENAI_API_KEY=tu_openai_key
SESSION_SECRET=marcos_super_secret_2026
BASE_URL=https://marcos.bienargentinos.com
```

---

## 6. Iniciar la App con PM2 (Autorestart permanente)

```bash
pm2 start index.js --name "marcos-ai"
pm2 save
pm2 startup
```

---

## 7. Configurar Dominio y SSL con Nginx (https://marcos.bienargentinos.com)

Crear `/etc/nginx/sites-available/marcos`:
```nginx
server {
    server_name marcos.bienargentinos.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Habilitar y certificar con SSL Let's Encrypt gratuito:
```bash
ln -s /etc/nginx/sites-available/marcos /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
certbot --nginx -d marcos.bienargentinos.com
```

---

## 8. ¿Cómo restaurar el archivo de Backup ZIP?
Si querés subir el backup generado localmente en tu PC (`backups/marcos-ia-backup-*.zip`):

```bash
scp -P 22 backups/marcos-ia-backup-*.zip root@NUEVA_IP:/root/marcos/
# En el servidor:
cd /root/marcos && unzip marcos-ia-backup-*.zip -d Consorcio-AI-Assistant
cd Consorcio-AI-Assistant && npm install && pm2 restart marcos-ai
```
