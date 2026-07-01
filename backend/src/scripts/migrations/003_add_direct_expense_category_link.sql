-- Add category_id and fiscal_year links to direct_expenses for Budget Expense Adjustment
ALTER TABLE direct_expenses
ADD COLUMN IF NOT EXISTS category_id UUID,
ADD COLUMN IF NOT EXISTS fiscal_year INTEGER;

-- Add foreign key to budget_categories
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_direct_expenses_category_id'
  ) THEN
    ALTER TABLE direct_expenses
      ADD CONSTRAINT fk_direct_expenses_category_id FOREIGN KEY (category_id) REFERENCES budget_categories(id);
  END IF;
END $$;

-- Add index for lookups by category and fiscal year
CREATE INDEX IF NOT EXISTS idx_direct_expenses_category_id ON direct_expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_direct_expenses_fiscal_year ON direct_expenses(fiscal_year);

COMMENT ON COLUMN direct_expenses.category_id IS 'Linked budget category for Budget Expense Adjustment';
COMMENT ON COLUMN direct_expenses.fiscal_year IS 'Fiscal year of the adjustment';
