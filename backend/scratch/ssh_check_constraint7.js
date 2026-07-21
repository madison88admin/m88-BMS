const { Client } = require('ssh2');
const conn = new Client();

// Use curl on the VPS to query the constraint
const cmd = `cd /opt/bms-backend && curl -s -X POST "$(node -e "require('dotenv').config(); process.stdout.write(process.env.SUPABASE_URL)")/pg/query" -H "Content-Type: application/json" -H "apikey: $(node -e "require('dotenv').config(); process.stdout.write(process.env.SUPABASE_SERVICE_ROLE_KEY)")" -H "Authorization: Bearer $(node -e "require('dotenv').config(); process.stdout.write(process.env.SUPABASE_SERVICE_ROLE_KEY)")" -d '{"query": "SELECT con.conname, pg_get_constraintdef(con.oid) as def FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace nsp ON nsp.oid = con.connamespace WHERE nsp.nspname = '"'"'M88_BMS'"'"' AND rel.relname = '"'"'expense_requests'"'"' AND con.contype = '"'"'c'"'"' ORDER BY con.conname;"}'`;

conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', () => conn.end());
  });
});

conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
