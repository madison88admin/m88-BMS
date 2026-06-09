-- Fix expense_requests_status_check constraint to include 'approved' status for budget proposals
-- This fixes the error: "new row for relation 'expense_requests' violates check constraint 'expense_requests_status_check'"

-- Drop existing constraint
ALTER TABLE expense_requests
  DROP CONSTRAINT IF EXISTS expense_requests_status_check;

-- Add updated constraint with all required statuses including 'approved' for budget proposals
ALTER TABLE expense_requests
  ADD CONSTRAINT expense_requests_status_check
  CHECK (
    status IN (
      'pending_supervisor', 
      'pending_accounting', 
      'pending_vp', 
      'pending_president',
      'approved', 
      'released', 
      'rejected', 
      'returned_for_revision', 
      'on_hold'
    )
  );
