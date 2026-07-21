const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:'M88_BMS'}});

// Try to find the constraint via information_schema
const fetch = require('node-fetch');
const url = process.env.SUPABASE_URL + '/pg/query';
const body = JSON.stringify({ query: \\"SELECT con.conname, pg_get_constraintdef(con.oid) as definition FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace nsp ON nsp.oid = con.connamespace WHERE nsp.nspname = 'M88_BMS' AND rel.relname = 'expense_requests' AND con.contype = 'c' ORDER BY con.conname;\\" });

fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY }, body })
  .then(r => r.json())
  .then(d => console.log(JSON.stringify(d, null, 2)))
  .catch(e => console.log('fetch error:', e.message));
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
