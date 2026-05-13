const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hjjpqwzmrnjquneuppeb.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqanBxd3ptcm5qcXVuZXVwcGViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg3NjY1NywiZXhwIjoyMDkyNDUyNjU3fQ.FUaOt4VB8fc4rwjVaCO9IO6H5-9BZnSgxsK2IdMhV-U';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

async function main() {
  console.log('Checking user department assignments...');
  
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, email, role, department_id')
    .in('email', [
      'john.employee@madison88.com',
      'jane.supervisor@madison88.com',
      'bob.accounting@madison88.com'
    ]);
  
  if (error) {
    console.error('Error fetching users:', error);
    process.exit(1);
  }
  
  console.log('Users and their departments:');
  console.table(users);
  
  // Check if john.employee has a department_id
  const johnEmployee = users.find(u => u.email === 'john.employee@madison88.com');
  if (!johnEmployee.department_id) {
    console.log('\n⚠️  john.employee has no department_id!');
    
    // Get IT Department ID
    const { data: dept } = await supabase
      .from('departments')
      .select('id, name')
      .eq('name', 'IT Department')
      .single();
    
    if (dept) {
      console.log(`\nAssigning john.employee to ${dept.name} (ID: ${dept.id})`);
      const { error: updateError } = await supabase
        .from('users')
        .update({ department_id: dept.id })
        .eq('email', 'john.employee@madison88.com');
      
      if (updateError) {
        console.error('Error updating department:', updateError);
      } else {
        console.log('✅ Department assigned successfully!');
      }
    }
  } else {
    console.log('\n✅ john.employee has department_id:', johnEmployee.department_id);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
