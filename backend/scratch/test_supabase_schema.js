const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'M88_BMS' } });
(async () => {
  // Test departments
  const { data: depts, error: deptErr } = await supabase.from('departments').select('id, name, annual_budget, fiscal_year').limit(5);
  if (deptErr) console.log('Dept error:', JSON.stringify(deptErr));
  else console.log('Departments:', depts.length, depts.slice(0,3).map(d => d.name + ': ' + d.annual_budget + ' (FY' + d.fiscal_year + ')').join(', '));

  // Test budget_categories
  const { data: cats, error: catErr } = await supabase.from('budget_categories').select('category_code, category_name, budget_amount, fiscal_year').limit(5);
  if (catErr) console.log('Cat error:', JSON.stringify(catErr));
  else console.log('Categories:', cats.length, cats.slice(0,3).map(c => c.category_code + ': ' + c.budget_amount).join(', '));

  // Test expense_requests
  const { data: reqs, error: reqErr } = await supabase.from('expense_requests').select('id, request_code, amount, status, department_id').eq('status', 'pending_accounting').limit(3);
  if (reqErr) console.log('Req error:', JSON.stringify(reqErr));
  else console.log('Pending accounting:', reqs.length, reqs.map(r => r.request_code + ': ' + r.amount).join(', '));
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
