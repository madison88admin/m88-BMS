-- Add cost_centers and request_cost_allocations tables for dual-deduction workflow
-- Section 3.1 & 3.2: Database migrations for cost centers and cost allocations

-- Drop tables if they exist (to handle schema changes)
DROP TABLE IF EXISTS request_cost_allocations CASCADE;
DROP TABLE IF EXISTS cost_centers CASCADE;

-- Create cost_centers table
CREATE TABLE cost_centers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  total_budget NUMERIC NOT NULL DEFAULT 0,
  used_amount NUMERIC NOT NULL DEFAULT 0,
  remaining_amount NUMERIC NOT NULL DEFAULT 0,
  fiscal_year INTEGER NOT NULL DEFAULT 2026,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint for cost centers (name + fiscal_year)
CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_name_fiscal_year_unique_idx 
ON cost_centers (LOWER(TRIM(name)), fiscal_year);

-- Add index for active cost centers
CREATE INDEX IF NOT EXISTS cost_centers_fiscal_year_active_idx 
ON cost_centers (fiscal_year, is_active);

-- Create request_cost_allocations table
CREATE TABLE IF NOT EXISTS request_cost_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
  cost_center_id UUID NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
  budget_category_id UUID NOT NULL REFERENCES budget_categories(id) ON DELETE RESTRICT,
  amount NUMERIC NOT NULL,
  tagged_by UUID NOT NULL REFERENCES users(id),
  tagged_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(id)
);

-- Add index for request_id lookups
CREATE INDEX IF NOT EXISTS request_cost_allocations_request_id_idx 
ON request_cost_allocations (request_id);

-- Add index for cost_center_id lookups
CREATE INDEX IF NOT EXISTS request_cost_allocations_cost_center_id_idx 
ON request_cost_allocations (cost_center_id);

-- Add index for budget_category_id lookups
CREATE INDEX IF NOT EXISTS request_cost_allocations_budget_category_id_idx 
ON request_cost_allocations (budget_category_id);

-- Add unique constraint to prevent duplicate allocations per request
CREATE UNIQUE INDEX IF NOT EXISTS request_cost_allocations_request_unique_idx 
ON request_cost_allocations (request_id);

-- Add comment to document the tables
COMMENT ON TABLE cost_centers IS 'Central fund sources that cover actual payments (e.g., M88 Manila, M88 Jakarta)';
COMMENT ON TABLE request_cost_allocations IS 'Tracks cost center and budget category allocations for each request before dual deduction';

-- Add trigger to update updated_at timestamp for cost_centers
CREATE OR REPLACE FUNCTION update_cost_centers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_centers_updated_at_trigger
BEFORE UPDATE ON cost_centers
FOR EACH ROW
EXECUTE FUNCTION update_cost_centers_updated_at();

-- Seed cost centers for testing
INSERT INTO cost_centers (name, total_budget, remaining_amount, fiscal_year)
VALUES 
  ('M88 Manila', 1000000, 1000000, 2026)
ON CONFLICT DO NOTHING;
