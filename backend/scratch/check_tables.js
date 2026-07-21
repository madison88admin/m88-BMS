const { Client } = require('ssh2');
const conn = new Client();

const cmd = `cd /opt/bms-backend && node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(url, key);
(async () => {
  // Try listing tables via REST API
  const res = await fetch(url + '/rest/v1/?apikey=' + key);
  const text = await res.text();
  console.log('Available tables (from REST root):');
  try {
    const parsed = JSON.parse(text);
    const tables = Object.keys(parsed.definitions || {});
    const budgetTables = tables.filter(t => t.includes('budget') || t.includes('department') || t.includes('expense'));
    console.log('Budget/Dept/Expense tables:', budgetTables.join(', '));
    console.log('All tables:', tables.join(', '));
  } catch(e) {
    console.log('Raw response:', text.substring(0, 1000));
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
