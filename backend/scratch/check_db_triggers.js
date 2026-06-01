const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

async function run() {
  const sql = `
    SELECT 
      trigger_name, 
      event_manipulation, 
      action_statement, 
      action_timing
    FROM information_schema.triggers
    WHERE event_object_table = 'expense_requests';
  `;
  const { data, error } = await supabase.rpc('execute_sql', { sql });
  if (error) {
    console.error('RPC execute_sql failed (might not exist or have permissions):', error.message);
  } else {
    console.log('Triggers on expense_requests table:', data);
  }
}

run();
