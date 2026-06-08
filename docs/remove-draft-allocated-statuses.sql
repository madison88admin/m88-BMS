-- Phase 2: Remove 'draft' and 'allocated' statuses from expense_requests
-- Status check results: draft_count = 0, allocated_count = 0
-- Safe to remove these statuses since no existing records use them

-- Remove the old CHECK constraint
ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_status_check;

-- Add new CHECK constraint without 'draft' and 'allocated'
ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_status_check 
CHECK (status IN ('pending_supervisor', 'pending_accounting', 'approved', 'rejected', 'returned_for_revision', 'released', 'on_hold'));

-- Update default status from 'draft' to 'pending_supervisor'
ALTER TABLE expense_requests ALTER COLUMN status SET DEFAULT 'pending_supervisor';
