-- Adds note support for approval delegations
ALTER TABLE approval_delegations
  ADD COLUMN IF NOT EXISTS note text;
