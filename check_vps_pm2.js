const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec('pm2 status && pm2 logs marcos-ai --lines 15 --raw', (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
          .on('data', (d) => process.stdout.write(d))
          .stderr.on('data', (d) => process.stderr.write(d));
  });
}).connect({
  host: '200.58.102.182',
  port: 5436,
  username: 'root',
  password: 'Triana-20142014'
});
