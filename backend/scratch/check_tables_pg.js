const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  try {
    const res = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \\'public\\' AND table_name LIKE \\'%budget%\\' ORDER BY table_name');
    console.log('Budget tables:', res.rows.map(r => r.table_name).join(', '));
    
    const res2 = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \\'public\\' AND table_name LIKE \\'%department%\\' ORDER BY table_name');
    console.log('Department tables:', res2.rows.map(r => r.table_name).join(', '));
    
    const res3 = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \\'public\\' AND table_name LIKE \\'%expense%\\' ORDER BY table_name');
    console.log('Expense tables:', res3.rows.map(r => r.table_name).join(', '));
  } catch(e) {
    console.log('Error:', e.message);
  }
  pool.end();
})();
" 2>&1`;

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
