const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:'M88_BMS'}});

// Use supabase to query the constraint
sb.from('expense_requests').select('rejection_stage').limit(1).then(({data,error}) => {
  if(error) console.log('Query error:', JSON.stringify(error));
  else console.log('Sample row:', JSON.stringify(data));
});

// Also try to get columns
sb.from('expense_requests').select('*').limit(1).then(({data,error}) => {
  if(error) console.log('Query2 error:', JSON.stringify(error));
  else if(data && data[0]) console.log('Columns:', Object.keys(data[0]).join(', '));
  else console.log('No rows');
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
