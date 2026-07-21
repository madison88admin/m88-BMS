const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:'M88_BMS'}});
// Check the constraint definition
sb.rpc('pg_query', { query: \\"
  SELECT con.conname, pg_get_constraintdef(con.oid) as definition
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = connamespace
  WHERE nsp.nspname = 'M88_BMS'
  AND con.conname LIKE '%rejection_stage%'
  OR con.conname LIKE '%expense_requests%'
  ORDER BY con.conname;
\\"
}).then(({data,error}) => {
  if(error) console.log('Error:', JSON.stringify(error));
  else console.log(JSON.stringify(data, null, 2));
});
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
