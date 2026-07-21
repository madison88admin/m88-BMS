const { Client } = require('ssh2');
const conn = new Client();

const cmd = `docker exec supabase-db psql -U postgres -d postgres -c "SELECT bc.category_code, bc.category_name, bc.budget_amount, bc.used_amount, bc.is_locked, bc.fiscal_year FROM \\"M88_BMS\\".budget_categories bc WHERE bc.department_id = '1320d89d-5b10-457e-a335-c4f80bc6e3db' ORDER BY bc.category_code;" 2>&1 && echo "---" && docker exec supabase-db psql -U postgres -d postgres -c "SELECT id, name, annual_budget, used_budget, fiscal_year FROM \\"M88_BMS\\".departments WHERE id = '1320d89d-5b10-457e-a335-c4f80bc6e3db';" 2>&1`;

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
