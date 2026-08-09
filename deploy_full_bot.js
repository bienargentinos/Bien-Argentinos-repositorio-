const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const config = {
  host: '200.58.102.182',
  port: 5436,
  username: 'root',
  password: 'Triana-20142014'
};

const localDir = __dirname;
const remoteDir = '/root/marcos/Consorcio-AI-Assistant';

function runCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(`\n💻 VPS Command: ${command}`);
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', (code, signal) => {
        resolve({ code, stdout, stderr });
      }).on('data', (data) => {
        stdout += data;
        process.stdout.write(data);
      }).stderr.on('data', (data) => {
        stderr += data;
        process.stderr.write(data);
      });
    });
  });
}

function uploadFolderRecursive(sftp, localPath, remotePath) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!fs.existsSync(localPath)) return resolve();
      
      const stats = fs.statSync(localPath);
      if (stats.isDirectory()) {
        sftp.mkdir(remotePath, async (err) => {
          // ignorar si la carpeta ya existe
          const files = fs.readdirSync(localPath);
          for (const f of files) {
            if (f === 'node_modules' || f === '.git' || f === 'temp') continue;
            await uploadFolderRecursive(sftp, path.join(localPath, f), `${remotePath}/${f}`);
          }
          resolve();
        });
      } else {
        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) console.error(`⚠️ Error subiendo ${localPath}:`, err.message);
          else console.log(`✅ Subido: ${path.basename(localPath)} -> ${remotePath}`);
          resolve();
        });
      }
    } catch (e) {
      console.error('Error en uploadFolderRecursive:', e.message);
      resolve();
    }
  });
}

conn.on('ready', async () => {
  console.log('✅ Conexión SSH establecida con VPS Marcos IA (200.58.102.182)');
  try {
    console.log('\n--- 1. Actualizando repositorio Git en VPS ---');
    await runCommand(`cd ${remoteDir} && git fetch origin && git reset --hard origin/main`);

    console.log('\n--- 2. Subiendo archivos actualizados por SFTP ---');
    await new Promise((resolve, reject) => {
      conn.sftp(async (err, sftp) => {
        if (err) return reject(err);
        const archivos = ['index.js', 'dashboard.js', 'sheets.js', 'media.js', 'stt.js', 'tts.js', 'package.json'];
        for (const a of archivos) {
          const lp = path.join(localDir, a);
          if (fs.existsSync(lp)) {
            await new Promise(r => sftp.fastPut(lp, `${remoteDir}/${a}`, r));
            console.log(`✅ ${a} sincronizado en VPS`);
          }
        }
        await uploadFolderRecursive(sftp, path.join(localDir, 'agentes'), `${remoteDir}/agentes`);
        resolve();
      });
    });

    console.log('\n--- 3. Verificando sintaxis Node en VPS ---');
    await runCommand(`node --check ${remoteDir}/index.js`);

    console.log('\n--- 4. Instalando dependencias en VPS si hiciera falta ---');
    await runCommand(`cd ${remoteDir} && npm install --production`);

    console.log('\n--- 5. Reiniciando servicio PM2 (marcos-ai) ---');
    await runCommand('pm2 restart marcos-ai || pm2 start index.js --name "marcos-ai"');

    console.log('\n--- 6. Verificando logs del proceso Marcos IA ---');
    await runCommand('pm2 logs marcos-ai --lines 15 --raw');

    console.log('\n=============================================');
    console.log('🚀 MARCOS IA DESPLEGADO Y OPERATIVO EN VPS');
    console.log('=============================================');
  } catch (e) {
    console.error('❌ Error durante el despliegue:', e.message);
  } finally {
    conn.end();
  }
}).on('error', (err) => {
  console.error('❌ Error de conexión SSH:', err.message);
}).connect(config);
