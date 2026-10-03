#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SSH_KEY = path.join(os.homedir(), '.ssh', 'marcos_vps');
const VPS_HOST = '200.58.102.182';
const VPS_PORT = '5436';
const VPS_DIR = '/root/marcos/Consorcio-AI-Assistant';
const DEST_DIR = path.join(__dirname, 'backups');

fs.mkdirSync(DEST_DIR, { recursive: true });

console.log('====================================================');
console.log('📦 RESPALDO MARCOS IA — DESCARGA DESDE EL SERVIDOR');
console.log('====================================================\n');

if (!fs.existsSync(SSH_KEY)) {
  console.error(`❌ No se encontró la llave SSH: ${SSH_KEY}`);
  process.exit(1);
}

try {
  console.log('1️⃣ Conectando al VPS y generando respaldo fresco...');
  const salidaCrear = execSync(
    `ssh -i "${SSH_KEY}" -p ${VPS_PORT} -o StrictHostKeyChecking=no -o ConnectTimeout=15 root@${VPS_HOST} "cd ${VPS_DIR} && node crear-backup.js"`,
    { encoding: 'utf8', stdio: 'pipe' }
  );
  console.log(salidaCrear.trim());

  console.log('\n2️⃣ Identificando archivo más reciente en el VPS...');
  const archivoRemoto = execSync(
    `ssh -i "${SSH_KEY}" -p ${VPS_PORT} -o StrictHostKeyChecking=no root@${VPS_HOST} "ls -1t ${VPS_DIR}/backups/marcos-backup-*.tar.gz | head -n 1"`,
    { encoding: 'utf8' }
  ).trim();

  if (!archivoRemoto) {
    throw new Error('No se encontró ningún archivo de backup en el VPS.');
  }

  const nombreArchivo = path.basename(archivoRemoto);
  console.log(`   -> Archivo a descargar: ${nombreArchivo}`);

  console.log('\n3️⃣ Descargando a tu PC vía SCP...');
  execSync(
    `scp -i "${SSH_KEY}" -P ${VPS_PORT} -o StrictHostKeyChecking=no root@${VPS_HOST}:${archivoRemoto} "${DEST_DIR}/"`,
    { stdio: 'inherit' }
  );

  const rutaLocal = path.join(DEST_DIR, nombreArchivo);
  if (fs.existsSync(rutaLocal)) {
    const mb = (fs.statSync(rutaLocal).size / (1024 * 1024)).toFixed(2);
    console.log(`\n====================================================`);
    console.log(`✅ ¡DESCARGA COMPLETADA CON ÉXITO! (${mb} MB)`);
    console.log(`📁 Guardado en: ${rutaLocal}`);
    console.log(`====================================================\n`);

    const locales = fs.readdirSync(DEST_DIR)
      .filter(f => f.startsWith('marcos-backup-') && f.endsWith('.tar.gz'))
      .sort();
    if (locales.length > 5) {
      for (const viejo of locales.slice(0, locales.length - 5)) {
        try {
          fs.unlinkSync(path.join(DEST_DIR, viejo));
          console.log(`🧹 Eliminado respaldo local antiguo: ${viejo}`);
        } catch (_) {}
      }
    }
  } else {
    throw new Error('El archivo no se encontró en la carpeta de destino local.');
  }
} catch (err) {
  console.error(`\n❌ Error durante el respaldo: ${err.message}`);
  process.exit(1);
}
