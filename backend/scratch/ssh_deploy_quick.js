const { Client } = require('ssh2');
const conn = new Client();

const commands = [
  'rm -rf /tmp/bms-update && git clone https://github.com/madison88admin/m88-BMS.git /tmp/bms-update 2>&1 | tail -3',
  'cp -r /tmp/bms-update/backend/src/* /opt/bms-backend/src/',
  'cd /opt/bms-backend && npx tsc 2>&1',
  'systemctl restart bms-backend',
  'sleep 2 && systemctl status bms-backend | head -8',
  'rm -rf /tmp/bms-update',
];

conn.on('ready', () => {
  let i = 0;
  function runNext() {
    if (i >= commands.length) { console.log('\n✅ Backend deployed'); conn.end(); return; }
    const cmd = commands[i++];
    console.log(`\n> ${cmd}`);
    conn.exec(cmd, (err, stream) => {
      if (err) { console.error(err); runNext(); return; }
      stream.on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', () => runNext());
    });
  }
  runNext();
});

conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
