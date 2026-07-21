const { Client } = require('ssh2');
const conn = new Client();

const cmd = [
  'cd /opt/bms-backend && node -e "',
  'require(\'dotenv\').config();',
  'const{createClient}=require(\'@supabase/supabase-js\');',
  'const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:\'M88_BMS\'}});',
  'sb.from(\'expense_requests\').select(\'id,request_code,status,amount,currency,request_type,category,category_id,co_approved_by,submitted_at\').eq(\'status\',\'pending_accounting\').order(\'submitted_at\',{ascending:true}).then(({data,error})=>{',
  '  if(error) console.log(\'Error:\',error.message);',
  '  else console.log(JSON.stringify(data,null,2));',
  '});',
  '"',
].join('');

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
