const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'M88_BMS' } });

(async () => {
  // Get a pending_accounting request with its budget_summary
  const { data: reqs, error } = await supabase
    .from('expense_requests')
    .select('id, request_code, amount, status, department_id, category_id')
    .eq('status', 'pending_accounting')
    .order('submitted_at', { ascending: false })
    .limit(3);
  
  if (error) { console.log('Error:', JSON.stringify(error)); return; }
  
  for (const req of reqs) {
    const { data: dept } = await supabase.from('departments').select('name, annual_budget, used_budget, fiscal_year').eq('id', req.department_id).single();
    console.log(req.request_code + ' | amount=' + req.amount + ' | dept=' + (dept?.name || '?') + ' | budget=' + (dept?.annual_budget || 0) + ' | used=' + (dept?.used_budget || 0) + ' | fy=' + (dept?.fiscal_year || '?'));
  }
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
