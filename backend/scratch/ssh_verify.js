const { Client } = require('ssh2');
const conn = new Client();

const commands = [
  'grep -n "VP_THRESHOLD" /opt/bms-backend/dist/routes/requests.js | head -5',
  'grep -n "pending_vp.*pending_accounting\\|nextStatus.*VP_THRESHOLD" /opt/bms-backend/dist/routes/requests.js | head -5',
  'grep -n "needsCoApproval" /opt/bms-backend/dist/routes/requests.js | head -3',
  'grep -n "30000" /opt/bms-backend/dist/constants/approval.js | head -3',
];

conn.on('ready', () => {
  let i = 0;
  function runNext() {
    if (i >= commands.length) { conn.end(); return; }
    const cmd = commands[i++];
    console.log(`> ${cmd}`);
    conn.exec(cmd, (err, stream) => {
      if (err) { console.error(err); runNext(); return; }
      stream.on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', () => { console.log(''); runNext(); });
    });
  }
  runNext();
});

conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
