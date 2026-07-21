const { Client } = require('ssh2');
const conn = new Client();

const cmd = `PGPASSWORD="" psql -h 127.0.0.1 -U postgres -d postgres -c "SELECT category_code, category_name, budget_amount, used_amount, department_id, fiscal_year FROM \\"M88_BMS\\".budget_categories WHERE budget_amount > 0 LIMIT 10;" 2>&1 || echo "psql not found, trying supabase"`;

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
