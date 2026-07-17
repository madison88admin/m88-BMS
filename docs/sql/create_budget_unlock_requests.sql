-- Budget unlock requests table
-- Allows supervisors/managers to request budget category unlocks, which accounting must approve

CREATE TABLE IF NOT EXISTS budget_unlock_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, denied
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_budget_unlock_requests_category_id ON budget_unlock_requests(category_id);
CREATE INDEX IF NOT EXISTS idx_budget_unlock_requests_status ON budget_unlock_requests(status);
CREATE INDEX IF NOT EXISTS idx_budget_unlock_requests_requested_by ON budget_unlock_requests(requested_by);

-- Add helpful comment
COMMENT ON TABLE budget_unlock_requests IS 'Tracks budget category unlock requests from supervisors/managers pending accounting approval';
