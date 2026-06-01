-- Fix User Foreign Key Constraint Issue
-- This script helps resolve foreign key constraint violations when deleting/updating users

-- Option 1: Update foreign key to use ON DELETE CASCADE
-- This will automatically delete related records when a user is deleted
DO $$
BEGIN
  -- Drop existing foreign key constraint on expense_requests (try both possible names)
  ALTER TABLE expense_requests 
    DROP CONSTRAINT IF EXISTS expense_requests_employee_id_fkey;
    
  ALTER TABLE expense_requests 
    DROP CONSTRAINT IF EXISTS fk_expense_requests_employee_id;
  
  -- Add new foreign key constraint with ON DELETE CASCADE
  ALTER TABLE expense_requests 
    ADD CONSTRAINT expense_requests_employee_id_fkey 
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE;
  
  -- Drop existing foreign key constraint on approval_logs (try both possible names)
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS approval_logs_actor_id_fkey;
    
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS fk_approval_logs_actor_id;
  
  -- Add new foreign key constraint with ON DELETE CASCADE
  ALTER TABLE approval_logs 
    ADD CONSTRAINT approval_logs_actor_id_fkey 
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE;
  
  -- Drop existing foreign key constraint on request_attachments
  ALTER TABLE request_attachments 
    DROP CONSTRAINT IF EXISTS fk_request_attachments_uploaded_by;
  
  -- Add new foreign key constraint with ON DELETE CASCADE
  ALTER TABLE request_attachments 
    ADD CONSTRAINT fk_request_attachments_uploaded_by 
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE;
END $$;

-- Fix expense_requests foreign key constraint for approval_logs
-- This allows deleting expense_requests without approval_logs blocking it
DO $$
BEGIN
  -- Drop existing foreign key constraint on approval_logs for request_id
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS approval_logs_request_id_fkey;
    
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS fk_approval_logs_request_id;
  
  -- Add new foreign key constraint with ON DELETE CASCADE
  ALTER TABLE approval_logs 
    ADD CONSTRAINT approval_logs_request_id_fkey 
    FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
END $$;

-- Option 2: Update foreign key to use ON DELETE SET NULL
-- This will set employee_id to NULL when a user is deleted
-- Uncomment below if you prefer this option instead
/*
DO $$
BEGIN
  -- Drop existing foreign key constraint
  ALTER TABLE expense_requests 
    DROP CONSTRAINT IF EXISTS expense_requests_employee_id_fkey;
  
  -- Add new foreign key constraint with ON DELETE SET NULL
  ALTER TABLE expense_requests 
    ADD CONSTRAINT expense_requests_employee_id_fkey 
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE SET NULL;
END $$;
*/

-- Option 3: Manually delete related records before deleting user
-- Use this if you want to keep the foreign key constraint as is
-- Uncomment and run the queries below before deleting a user

-- First, find all related records for a specific user
-- Replace 'user-id-here' with the actual user UUID
/*
SELECT 
  'expense_requests' as table_name,
  COUNT(*) as record_count
FROM expense_requests
WHERE employee_id = 'user-id-here'

UNION ALL

SELECT 
  'cash_advances' as table_name,
  COUNT(*) as record_count
FROM cash_advances
WHERE employee_id = 'user-id-here'

UNION ALL

SELECT 
  'approval_logs' as table_name,
  COUNT(*) as record_count
FROM approval_logs
WHERE user_id = 'user-id-here';
*/

-- Then delete the related records (if you choose Option 3)
/*
-- Delete expense requests
DELETE FROM expense_requests WHERE employee_id = 'user-id-here';

-- Delete cash advances
DELETE FROM cash_advances WHERE employee_id = 'user-id-here';

-- Delete approval logs
DELETE FROM approval_logs WHERE user_id = 'user-id-here';

-- Now you can delete the user
DELETE FROM users WHERE id = 'user-id-here';
*/

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
  AND tc.table_name = 'expense_requests';
