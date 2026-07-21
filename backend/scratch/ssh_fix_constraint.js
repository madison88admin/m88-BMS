const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && curl -s -X POST "$(node -e "require('dotenv').config(); process.stdout.write(process.env.SUPABASE_URL)")/pg/query" -H "Content-Type: application/json" -H "apikey: $(node -e "require('dotenv').config(); process.stdout.write(process.env.SUPABASE_SERVICE_ROLE_KEY)")" -H "Authorization: Bearer $(node -e "require('dotenv').config(); process.stdout.write(process.env.SUPABASE_SERVICE_ROLE_KEY)")" -d '{"query": "ALTER TABLE M88_BMS.expense_requests DROP CONSTRAINT IF EXISTS expense_requests_rejection_stage_check; ALTER TABLE M88_BMS.expense_requests ADD CONSTRAINT expense_requests_rejection_stage_check CHECK (rejection_stage = ANY (ARRAY['"'"'supervisor'"'"', '"'"'accounting'"'"', '"'"'vp'"'"', '"'"'president'"'"', '"'"'admin'"'"']));"}'`;

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
