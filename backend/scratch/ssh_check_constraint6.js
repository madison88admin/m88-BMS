const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const https = require('https');
const url = new URL(process.env.SUPABASE_URL + '/pg/query');
const body = JSON.stringify({ query: \\"SELECT con.conname, pg_get_constraintdef(con.oid) as def FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace nsp ON nsp.oid = con.connamespace WHERE nsp.nspname = 'M88_BMS' AND rel.relname = 'expense_requests' AND con.contype = 'c' ORDER BY con.conname;\\" });
const options = { hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Length': Buffer.byteLength(body) } };
const req = https.request(options, (res) => { let data = ''; res.on('data', c => data += c); res.on('end', () => { try { const j = JSON.parse(data); console.log(JSON.stringify(j, null, 2)); } catch(e) { console.log('Raw:', data); } }); });
req.on('error', e => console.log('Error:', e.message));
req.write(body);
req.end();
"`;

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
