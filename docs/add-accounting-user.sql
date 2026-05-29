-- Add Accounting User with Limited Access
-- This script creates a senior accounting user with limited access
-- Role: accounting_limited (higher position but limited permissions)
-- Limited Access: No fund disbursement, no budget matrix access

-- Step 1: Delete the accounting user if it exists
DELETE FROM public.users WHERE email = 'accounting@madison88.com';

-- Step 2: Create Finance department if it doesn't exist
INSERT INTO public.departments (id, name, annual_budget, fiscal_year, created_at, updated_at)
SELECT gen_random_uuid(), 'Finance', 0, 2026, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM public.departments WHERE name = 'Finance');

-- Step 3: Insert senior accounting user with limited access
INSERT INTO public.users (id, name, email, password_hash, role, department_id, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  'Senior Accounting',
  'accounting@madison88.com',
  password_hash,
  'accounting_limited',
  (SELECT id FROM public.departments WHERE name = 'Finance' LIMIT 1),
  NOW(),
  NOW()
FROM public.users 
WHERE email = 'bob.accounting@madison88.com'
LIMIT 1;

-- Verification query
SELECT id, name, email, role, department_id, created_at 
FROM public.users 
WHERE email = 'accounting@madison88.com';
