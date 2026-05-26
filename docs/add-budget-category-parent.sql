-- Optional parent category for budget matrix hierarchy (run in Supabase SQL editor)
ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS parent_category_id UUID REFERENCES budget_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_budget_categories_parent
  ON budget_categories(parent_category_id);

COMMENT ON COLUMN budget_categories.parent_category_id IS 'Optional parent category for subcategory grouping';
