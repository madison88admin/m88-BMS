-- Master expense category catalog (sub-categories with submission rules)
-- Separate from budget_categories (department/fiscal-year budget matrix).
-- Run before docs/seed-expense-categories.sql

CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  main_category_code TEXT NOT NULL,
  main_category_name TEXT NOT NULL,
  department TEXT NOT NULL,
  manner_of_submission TEXT NOT NULL DEFAULT 'for_submission'
    CHECK (manner_of_submission IN ('for_submission', 'for_upload')),
  cash_advance_allowed BOOLEAN NOT NULL DEFAULT false,
  reimbursement_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expense_categories_code_unique UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_main_code ON expense_categories(main_category_code);
CREATE INDEX IF NOT EXISTS idx_expense_categories_department ON expense_categories(department);
CREATE INDEX IF NOT EXISTS idx_expense_categories_submission ON expense_categories(manner_of_submission);

COMMENT ON TABLE expense_categories IS 'Official expense sub-category catalog with CA/RE and submission rules';
COMMENT ON COLUMN expense_categories.department IS 'All | HR | Admin | Accounting | IT — All means every department';
COMMENT ON COLUMN expense_categories.manner_of_submission IS 'for_submission = employee/supervisor forms; for_upload = accounting only';
