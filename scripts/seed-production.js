const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// Production Supabase credentials
const SUPABASE_URL = 'https://hjjpqwzmrnjquneuppeb.supabase.co';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || 'YOUR_SERVICE_ROLE_KEY_HERE'; // Replace with actual key

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
const fiscalYear = new Date().getFullYear();

const users = [
  {
    name: 'John Employee',
    email: 'john.employee@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'employee',
    department_name: 'IT Department',
  },
  {
    name: 'Jane Supervisor',
    email: 'jane.supervisor@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'supervisor',
    department_name: 'IT Department',
  },
  {
    name: 'Bob Accounting',
    email: 'bob.accounting@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'accounting',
    department_name: 'Finance Department',
  },
  {
    name: 'Alice Admin',
    email: 'alice.admin@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'admin',
    department_name: 'Admin Department',
  },
  {
    name: 'Management Executive',
    email: 'management@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'management',
    department_name: null,
  },
  {
    name: 'Sarah Super Admin',
    email: 'sarah.superadmin@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'super_admin',
    department_name: null,
  },
];

async function main() {
  console.log('Seeding production Supabase database...');

  // Get departments
  const { data: departments } = await supabase
    .from('departments')
    .select('id,name,fiscal_year')
    .eq('fiscal_year', fiscalYear);

  const departmentIdByName = Object.fromEntries(
    (departments || []).map((row) => [row.name, row.id])
  );

  // Prepare users
  const usersToInsert = users.map((user) => ({
    name: user.name,
    email: user.email,
    password_hash: user.password_hash,
    role: user.role,
    department_id: user.department_name ? departmentIdByName[user.department_name] : null,
  }));

  // Delete existing users
  await supabase.from('users').delete().in('email', users.map((u) => u.email));
  console.log('Deleted existing users');

  // Insert users
  const { error: insertError } = await supabase.from('users').insert(usersToInsert);
  if (insertError) {
    console.error('Failed to insert users:', insertError);
    process.exit(1);
  }

  console.log('Successfully seeded production database!');
  console.log('Test users:');
  users.forEach((user) => {
    console.log(`- ${user.email} (password: password123)`);
  });
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
