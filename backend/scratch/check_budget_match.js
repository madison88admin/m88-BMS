const { Client } = require('ssh2');
const conn = new Client();

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "SELECT count(*) as total, count(*) FILTER (WHERE budget_amount > 0) as with_budget, count(*) FILTER (WHERE is_locked = true) as locked FROM \\"M88_BMS\\".budget_categories;" 2>&1 && echo "---" && docker exec supabase-db psql -U postgres -d postgres -c "SELECT bc.category_code, bc.category_name, bc.budget_amount, bc.is_locked, er.request_code, er.amount, er.status FROM \\"M88_BMS\\".budget_categories bc LEFT JOIN \\"M88_BMS\\".expense_requests er ON er.category_id = bc.id WHERE er.request_type IN ('budget_request','budget_revision') AND er.status = 'approved' ORDER BY bc.category_code LIMIT 10;" 2>&1`;

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
