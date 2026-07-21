const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'M88_BMS' } });

(async () => {
  // Simulate what buildDepartmentBudgetSummaryMap does
  const { data: depts, error } = await supabase.from('departments').select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at');
  if (error) { console.log('Error:', JSON.stringify(error)); return; }
  console.log('Total departments:', depts.length);
  
  // Find IT Department
  const itDept = depts.find(d => d.name === 'IT Department');
  if (itDept) console.log('IT Dept:', JSON.stringify(itDept));
  
  // Check if the pending request dept matches
  const { data: req } = await supabase.from('expense_requests').select('id, request_code, department_id, amount, status').eq('status', 'pending_accounting').limit(1).single();
  if (req) {
    console.log('Pending req:', req.request_code, 'dept_id:', req.department_id);
    const matchingDept = depts.find(d => d.id === req.department_id);
    console.log('Matching dept:', matchingDept ? matchingDept.name + ' budget=' + matchingDept.annual_budget : 'NOT FOUND');
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
