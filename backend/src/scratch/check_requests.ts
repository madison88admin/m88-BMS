import { supabase } from '../utils/supabase';

async function checkRequests() {
  console.log('Querying recent requests...');
  const { data: requests, error } = await supabase
    .from('expense_requests')
    .select('id, request_code, amount, status, request_type, fiscal_year, department_id, employee_id, submitted_at')
    .order('submitted_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching requests:', error);
    return;
  }

  console.log('--- RECENT REQUESTS ---');
  requests.forEach(r => {
    console.log(`[${r.request_code}] Type: ${r.request_type}, Status: ${r.status}, Amount: ${r.amount}, FY: ${r.fiscal_year}, Dept: ${r.department_id}, Date: ${r.submitted_at}`);
  });
  console.log('------------------------');
}

checkRequests();
