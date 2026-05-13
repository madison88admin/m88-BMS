const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hjjpqwzmrnjquneuppeb.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqanBxd3ptcm5qcXVuZXVwcGViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg3NjY1NywiZXhwIjoyMDkyNDUyNjU3fQ.FUaOt4VB8fc4rwjVaCO9IO6H5-9BZnSgxsK2IdMhV-U';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

async function main() {
  console.log('Checking budget categories...');
  
  const fiscalYear = new Date().getFullYear();
  const employeeDeptId = '1320d89d-5b10-457e-a335-c4f80bc6e3db';
  
  // Get department info
  const { data: dept } = await supabase
    .from('departments')
    .select('id, name')
    .eq('id', employeeDeptId)
    .single();
  
  console.log(`\nDepartment: ${dept?.name} (ID: ${employeeDeptId})`);
  console.log(`Fiscal Year: ${fiscalYear}`);
  
  // Get budget categories for this department
  const { data: categories, error } = await supabase
    .from('budget_categories')
    .select('*')
    .eq('department_id', employeeDeptId)
    .eq('fiscal_year', fiscalYear);
  
  if (error) {
    console.error('Error fetching categories:', error);
    process.exit(1);
  }
  
  console.log(`\nBudget Categories found: ${categories?.length || 0}`);
  
  if (categories && categories.length > 0) {
    console.table(categories);
  } else {
    console.log('\n⚠️  No budget categories found for this department!');
    console.log('This is why the reimbursement form shows no categories.');
    
    // Get all departments to see which ones have categories
    const { data: allDepts } = await supabase
      .from('departments')
      .select('id, name');
    
    console.log('\nChecking all departments for categories...');
    for (const d of allDepts) {
      const { data: deptCats } = await supabase
        .from('budget_categories')
        .select('category_name')
        .eq('department_id', d.id)
        .eq('fiscal_year', fiscalYear);
      
      console.log(`${d.name}: ${deptCats?.length || 0} categories`);
    }
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
