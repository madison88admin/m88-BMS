const { Client } = require('ssh2');
const conn = new Client();

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "SELECT er.id, er.request_code, er.amount, er.status, er.department_id, er.category_id, er.fiscal_year, d.name as dept_name, d.annual_budget FROM \\"M88_BMS\\".expense_requests er LEFT JOIN \\"M88_BMS\\".departments d ON er.department_id = d.id WHERE er.status = 'pending_accounting' ORDER BY er.submitted_at DESC LIMIT 5;" 2>&1`;

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
