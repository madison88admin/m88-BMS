const { Client } = require('ssh2');
const conn = new Client();

const cmd = `curl -s http://localhost:3000/api/health && echo "" && curl -s http://localhost:3000/api/departments -H "Authorization: Bearer test" 2>&1 | head -c 500`;

conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let output = '';
    stream.on('data', d => output += d.toString());
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => {
      console.log(output);
      conn.end();
    });
  });
});

conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
