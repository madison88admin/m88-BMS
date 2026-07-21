const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && grep -i "SUPABASE" .env | sed 's/=.*key.*/=***REDACTED***/i' && echo "---" && grep -i "POSTGRES\\|DB_URL\\|DATABASE" .env | sed 's/=.*pass.*/=***REDACTED***/i' && echo "---" && curl -s http://localhost:3000/api/departments 2>&1 | head -c 500`;

conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let output = '';
    stream.on('data', d => output += d.toString());
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => { console.log(output); conn.end(); });
  });
});
conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
