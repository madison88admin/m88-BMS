const { Client } = require('ssh2');
const conn = new Client();

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "SELECT request_code, request_type, amount, status, category, department_id FROM \\"M88_BMS\\".expense_requests WHERE request_type IN ('budget_request','budget_revision') ORDER BY submitted_at DESC LIMIT 15;" 2>&1`;

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
