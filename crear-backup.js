/**
 * crear-backup.js — Script de Backup Integral para Marcos IA
 * -------------------------------------------------------------
 * Genera un archivo ZIP con todo el código, esquemas de base de datos,
 * scripts de configuración y documentación de Marcos IA, excluyendo node_modules.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const fecha = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const rootDir = __dirname;
const backupDir = path.join(rootDir, 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const zipPath = path.join(backupDir, `marcos-ia-backup-${fecha}.zip`);

console.log(`📦 Creando backup de Marcos IA en: ${zipPath}...`);

try {
  // Usar tar nativo de Windows (bsdtar) que genera .zip de forma instantánea sin bloqueos
  const tarCmd = `tar -a -c -f "${zipPath}" --exclude="node_modules" --exclude=".git" --exclude="backups" *`;

  execSync(tarCmd, { cwd: rootDir, stdio: 'inherit' });

  const stats = fs.statSync(zipPath);
  const mb = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`✅ ¡Backup generado con éxito! Tamaño: ${mb} MB`);
  console.log(`📁 Archivo ZIP: ${zipPath}`);
} catch (err) {
  console.error('❌ Error creando backup:', err.message);
  process.exit(1);
}
