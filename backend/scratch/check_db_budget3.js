const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL || process.env.SUPABASE_DB_URL || '';
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
console.log('URL:', url ? url.substring(0, 40) + '...' : 'MISSING');
console.log('Key:', key ? key.substring(0, 20) + '...' : 'MISSING');
if (!url || !key) { console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('SUPA')).join(', ')); process.exit(0); }
const supabase = createClient(url, key);
(async () => {
  const { data, error } = await supabase.from('budget_categories').select('category_code,category_name,budget_amount,used_amount,fiscal_year').limit(20);
  if (error) { console.log('Error:', JSON.stringify(error)); return; }
  console.log('Total categories:', data.length);
  const withBudget = data.filter(c => Number(c.budget_amount) > 0);
  console.log('With budget > 0:', withBudget.length);
  data.forEach(c => console.log('  ' + c.category_code + ' | ' + c.category_name + ' | budget=' + c.budget_amount + ' | used=' + c.used_amount + ' | fy=' + c.fiscal_year));
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
