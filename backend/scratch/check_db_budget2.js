const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL || 'https://zraisfxpsqgdhmzqqlnh.supabase.co/rest/v1', process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
(async () => {
  const { data, error } = await supabase.from('budget_categories').select('category_code,category_name,budget_amount,used_amount,department_id,fiscal_year').limit(15);
  if (error) { console.log('Error:', JSON.stringify(error)); return; }
  console.log('Total categories returned:', data.length);
  data.forEach(c => console.log('  ' + c.category_code + ' | ' + c.category_name + ' | budget=' + c.budget_amount + ' | used=' + c.used_amount + ' | fy=' + c.fiscal_year));
  const withBudget = data.filter(c => Number(c.budget_amount) > 0);
  console.log('Categories with budget > 0:', withBudget.length);
})();
" 2>&1`;

conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let output = '';
    stream.on('data', d => output += d.toString());
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => {
      console.log(output);
      conn.end();
    });
  });
});

conn.on('error', err => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server**', readyTimeout: 15000 });
