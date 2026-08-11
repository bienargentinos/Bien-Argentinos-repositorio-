const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) throw err;
        
        const files = [
            { local: 'dashboard.js', remote: '/root/marcos/Consorcio-AI-Assistant/dashboard.js' },
            { local: 'rutas-accesos.js', remote: '/root/marcos/Consorcio-AI-Assistant/rutas-accesos.js' },
            { local: 'accesos.js', remote: '/root/marcos/Consorcio-AI-Assistant/accesos.js' }
        ];
        
        let count = 0;
        files.forEach(f => {
            sftp.fastPut(f.local, f.remote, (err) => {
                if (err) console.error('Error uploading', f.local, err);
                else console.log('Uploaded', f.local);
                count++;
                if (count === files.length) {
                    conn.exec('pm2 restart marcos-ai', (err, stream) => {
                        if (err) throw err;
                        stream.on('close', () => {
                            console.log('Restarted PM2');
                            conn.end();
                        }).on('data', (data) => console.log(data.toString()));
                    });
                }
            });
        });
    });
}).connect({
    host: '200.58.102.182',
    port: 5436,
    username: 'root',
    password: 'Triana--2014'
});
