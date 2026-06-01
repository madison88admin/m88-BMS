-- Madison88 Budget Management System
-- SQL Script to fix the Budget Category Parent-Child Hierarchy
-- Run this in your Supabase SQL Editor to resolve the "Select main category" issue.

-- 1. Ensure the parent_category_id column exists
ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS parent_category_id UUID REFERENCES budget_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_budget_categories_parent
  ON budget_categories(parent_category_id);

-- 2. Insert Parent Categories (Main Categories) for all departments and active fiscal years
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, remaining_amount, used_amount, committed_amount)
SELECT DISTINCT department_id, fiscal_year, p.code, p.name, 0, 0, 0, 0
FROM budget_categories bc
CROSS JOIN (VALUES
  ('6010', 'Advertising and Promotion'),
  ('6020', 'Automobile Expense'),
  ('6040', 'Bank Service Charges'),
  ('6041', 'Realized Forex Gain/Loss'),
  ('6170', 'Computer and Internet Expenses'),
  ('6240', 'Depreciation Expense'),
  ('6330', 'Insurance Expense'),
  ('6340', 'Interest Expense'),
  ('6350', 'Taxes & Licenses'),
  ('6430', 'Meals and Entertainment'),
  ('6490', 'Office Supplies'),
  ('6500', 'Medical Records and Supplies'),
  ('6650', 'Postage and Delivery'),
  ('6670', 'Professional Fees'),
  ('6710', 'Rent Expense'),
  ('6720', 'Repairs and Maintenance'),
  ('6840', 'Travel Expense'),
  ('6860', 'Utilities'),
  ('6870', 'Communication'),
  ('6900', 'Welfare - Employee'),
  ('9900', 'Sundry')
) AS p(code, name)
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- 3. Link all Child categories (Subcategories) to their respective Parent Category
-- in the same department and fiscal year
UPDATE budget_categories child
SET parent_category_id = parent.id
FROM budget_categories parent
WHERE parent.department_id = child.department_id
  AND parent.fiscal_year = child.fiscal_year
  AND (
    -- Dotted matches, e.g. '6020.1' matches '6020'
    child.category_code LIKE parent.category_code || '.%'
    OR 
    -- Explicit matches for no-dot subcategories:
    (parent.category_code = '6350' AND child.category_code IN ('6351', '6352'))
    OR
    (parent.category_code = '6500' AND child.category_code = '6501')
    OR
    (parent.category_code = '6710' AND child.category_code = '6711')
  );

-- 4. Verification query to confirm the hierarchy is correct
SELECT 
  d.name as department,
  bc.fiscal_year,
  bc.category_code,
  bc.category_name,
  parent.category_name as parent_category
FROM budget_categories bc
JOIN departments d ON d.id = bc.department_id
JOIN budget_categories parent ON parent.id = bc.parent_category_id
WHERE bc.fiscal_year = 2026
ORDER BY d.name, bc.category_code;
