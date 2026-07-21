const { Client } = require('ssh2');
const conn = new Client();

const cmd = `grep -n "vpFinalApproval\\|needsCoApproval\\|All requests\\|All non-budget" /opt/bms-backend/src/routes/requests.ts`;

conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let output = '';
    stream.on('data', d => output += d);
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', () => {
      console.log(output);
      conn.end();
    });
  });
});

conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
