const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:'M88_BMS'}});

// Try to insert a test row with rejection_stage to see what values are allowed
// First, let's try to update a non-existent row to see the constraint error
sb.from('expense_requests').update({ rejection_stage: 'test' }).eq('id', '00000000-0000-0000-0000-000000000000').then(({data,error}) => {
  if(error) console.log('Error with test:', JSON.stringify(error));
  else console.log('No error with test value');
});

// Try with 'accounting'
sb.from('expense_requests').update({ rejection_stage: 'accounting' }).eq('id', '00000000-0000-0000-0000-000000000000').then(({data,error}) => {
  if(error) console.log('Error with accounting:', JSON.stringify(error));
  else console.log('No error with accounting');
});

// Try with 'supervisor'
sb.from('expense_requests').update({ rejection_stage: 'supervisor' }).eq('id', '00000000-0000-0000-0000-000000000000').then(({data,error}) => {
  if(error) console.log('Error with supervisor:', JSON.stringify(error));
  else console.log('No error with supervisor');
});

// Try with 'vp'
sb.from('expense_requests').update({ rejection_stage: 'vp' }).eq('id', '00000000-0000-0000-0000-000000000000').then(({data,error}) => {
  if(error) console.log('Error with vp:', JSON.stringify(error));
  else console.log('No error with vp');
});

// Try with 'president'
sb.from('expense_requests').update({ rejection_stage: 'president' }).eq('id', '00000000-0000-0000-0000-000000000000').then(({data,error}) => {
  if(error) console.log('Error with president:', JSON.stringify(error));
  else console.log('No error with president');
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
