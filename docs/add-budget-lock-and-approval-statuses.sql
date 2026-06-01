-- Add budget matrix lock columns and extend approval statuses for add-on workflow
-- Run in Supabase SQL editor if not already applied

ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;

-- Extend expense_requests status values (drop/recreate CHECK if needed)
-- Note: adjust constraint name if your deployment differs
DO $$
BEGIN
  ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_status_check;
  ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_status_check
    CHECK (status IN (
      'pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president',
      'approved', 'released', 'rejected', 'returned_for_revision', 'on_hold'
    ));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Status constraint update skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_request_type_check;
  ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_request_type_check
    CHECK (request_type IN ('reimbursement', 'cash_advance', 'liquidation', 'budget_request'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Request type constraint update skipped: %', SQLERRM;
END $$;
