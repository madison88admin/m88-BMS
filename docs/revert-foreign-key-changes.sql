-- Revert Foreign Key Changes to Fix Schema Cache Issue
-- This script reverts the foreign key constraints back to their original state

-- Revert expense_requests employee_id constraint to NO ACTION
DO $$
BEGIN
  ALTER TABLE expense_requests 
    DROP CONSTRAINT IF EXISTS expense_requests_employee_id_fkey;
    
  ALTER TABLE expense_requests 
    DROP CONSTRAINT IF EXISTS fk_expense_requests_employee_id;
  
  ALTER TABLE expense_requests 
    ADD CONSTRAINT expense_requests_employee_id_fkey 
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE NO ACTION;
END $$;

-- Revert approval_logs actor_id constraint to NO ACTION
DO $$
BEGIN
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS approval_logs_actor_id_fkey;
    
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS fk_approval_logs_actor_id;
  
  ALTER TABLE approval_logs 
    ADD CONSTRAINT approval_logs_actor_id_fkey 
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE NO ACTION;
END $$;

-- Revert approval_logs request_id constraint to NO ACTION
DO $$
BEGIN
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS approval_logs_request_id_fkey;
    
  ALTER TABLE approval_logs 
    DROP CONSTRAINT IF EXISTS fk_approval_logs_request_id;
  
  ALTER TABLE approval_logs 
    ADD CONSTRAINT approval_logs_request_id_fkey 
    FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE NO ACTION;
END $$;

-- Revert request_attachments uploaded_by constraint to NO ACTION
DO $$
BEGIN
  ALTER TABLE request_attachments 
    DROP CONSTRAINT IF EXISTS fk_request_attachments_uploaded_by;
  
  ALTER TABLE request_attachments 
    ADD CONSTRAINT fk_request_attachments_uploaded_by 
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE NO ACTION;
END $$;

-- Verify the changes
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
  AND tc.table_name IN ('expense_requests', 'approval_logs', 'request_attachments')
  AND ccu.table_name = 'users'
ORDER BY tc.table_name, tc.constraint_name;
