-- Fix Schema Cache Issue: Relationship between expense_requests and users
-- This script checks and fixes the foreign key relationship

-- Check current foreign key constraints on expense_requests
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'expense_requests'
  AND ccu.table_name = 'users';

-- If the relationship is missing, recreate it
DO $$
BEGIN
  -- Drop any existing constraint with different names
  ALTER TABLE expense_requests 
    DROP CONSTRAINT IF EXISTS expense_requests_employee_id_fkey;
    
  ALTER TABLE expense_requests 
    DROP CONSTRAINT IF EXISTS fk_expense_requests_employee_id;
  
  -- Recreate the foreign key constraint
  ALTER TABLE expense_requests 
    ADD CONSTRAINT expense_requests_employee_id_fkey 
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE;
  
  RAISE NOTICE 'Foreign key constraint recreated successfully';
END $$;

-- Verify the fix
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'expense_requests'
  AND ccu.table_name = 'users';
