const { Client } = require('ssh2');
const conn = new Client();

const cmd = `echo "=== approve-accounting routing ===" && grep -n "nextStatus\\|pending_vp\\|pending_president" /opt/bms-backend/src/routes/requests.ts | grep -A2 "All requests" && echo "" && echo "=== mark-viewed threshold ===" && grep -n "vpFinalApproval\\|VP_THRESHOLD\\|budgetAmount" /opt/bms-backend/src/routes/requests.ts | head -10 && echo "" && echo "=== approve-vp routing ===" && grep -n "isTravelBooking\\|pending_president\\|pending_accounting" /opt/bms-backend/src/routes/requests.ts | sed -n '5,12p' && echo "" && echo "=== release co-approval ===" && grep -n "needsCoApproval\\|co_approved_by" /opt/bms-backend/src/routes/requests.ts | grep -i "release\\|needsCoApproval" | head -5`;

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
