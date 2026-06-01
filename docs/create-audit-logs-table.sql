-- Dedicated immutable audit trail (read-only for application users)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  department_name TEXT,
  action_type TEXT NOT NULL,
  record_type TEXT,
  record_id UUID,
  record_label TEXT,
  old_value JSONB,
  new_value JSONB,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON audit_logs(record_id);

-- Budget revision history (retain previous amounts after mid-period increases)
CREATE TABLE IF NOT EXISTS budget_revision_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES budget_categories(id),
  department_id UUID REFERENCES departments(id),
  request_id UUID REFERENCES expense_requests(id),
  previous_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  proposed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  approved_amount NUMERIC(15,2),
  fiscal_year INTEGER,
  revision_type TEXT DEFAULT 'budget_revision',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_budget_revision_history_category ON budget_revision_history(category_id);

-- Extend request_type for budget revisions
DO $$
BEGIN
  ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_request_type_check;
  ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_request_type_check
    CHECK (request_type IN ('reimbursement', 'cash_advance', 'liquidation', 'budget_request', 'budget_revision'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'request_type constraint update skipped: %', SQLERRM;
END $$;

-- RLS: append-only for authenticated service; no UPDATE/DELETE policies
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select_finance ON audit_logs;
CREATE POLICY audit_logs_select_finance ON audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('accounting', 'vp', 'president', 'admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS audit_logs_insert_service ON audit_logs;
CREATE POLICY audit_logs_insert_service ON audit_logs
  FOR INSERT
  WITH CHECK (true);
