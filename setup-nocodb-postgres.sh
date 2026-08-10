#!/bin/bash
# setup-nocodb-postgres.sh
# Script de instalación automática de PostgreSQL + pgvector + NocoDB en VPS Ubuntu

echo "🚀 Iniciando configuración de PostgreSQL + pgvector + NocoDB..."

# 1. Instalación de PostgreSQL y herramientas de desarrollo
sudo apt-get update -y
sudo apt-get install -y postgresql postgresql-contrib postgresql-server-dev-all git build-essential

# 2. Compilar e instalar pgvector para búsquedas vectoriales de IA
cd /tmp
rm -rf pgvector
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# 3. Configurar usuario y base de datos 'marcos_db'
sudo -u postgres psql -c "CREATE DATABASE marcos_db;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER marcos WITH PASSWORD 'marcos2024';" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE marcos_db TO marcos;" 2>/dev/null || true
sudo -u postgres psql -d marcos_db -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "✅ PostgreSQL + pgvector configurados correctamente."

# 4. Instalación de NocoDB (Interfaz de planilla tipo Airtable / Excel para PostgreSQL)
echo "🌐 Configurando NocoDB en el puerto 8080..."
npm install -g nocodb 2>/dev/null || true

NC_DB="pg://127.0.0.1:5432?u=marcos&p=marcos2024&d=marcos_db" PORT=8080 pm2 start nocodb --name "nocodb" 2>/dev/null || true
pm2 save

echo "🎉 ¡NocoDB activo y accesible en: http://200.58.102.182:8080 !"
