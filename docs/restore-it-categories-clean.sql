-- Clean restore: IT Department FY 2026
-- Run entire script in Supabase SQL Editor (select all → Run)

BEGIN;

WITH target AS (
  SELECT d.id AS department_id, d.fiscal_year
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = 'it department'
    AND d.fiscal_year = 2026
  LIMIT 1
)
DELETE FROM budget_categories bc
USING target t
WHERE bc.department_id = t.department_id
  AND bc.fiscal_year = t.fiscal_year;

WITH target AS (
  SELECT d.id AS department_id, d.fiscal_year
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = 'it department'
    AND d.fiscal_year = 2026
  LIMIT 1
)
INSERT INTO budget_categories (
  department_id,
  fiscal_year,
  category_code,
  category_name,
  budget_amount,
  used_amount,
  committed_amount,
  remaining_amount,
  updated_at
)
SELECT
  t.department_id,
  t.fiscal_year,
  v.category_code,
  v.category_name,
  v.budget_amount,
  0,
  0,
  v.budget_amount,
  NOW()
FROM target t
CROSS JOIN (VALUES
  ('6020', 'Automobile Expense',              1000),
  ('6170', 'Computer and Internet Expenses', 10000),
  ('6430', 'Meals and Entertainment',       100000),
  ('6501', 'Medical Records and Supplies',       0),
  ('6650', 'Postage and Delivery',             0),
  ('6840', 'Travel Expense',                   0),
  ('6870', 'Communication',                    0),
  ('6900', 'Welfare - Employee',               0),
  ('9900', 'Sundry',                           0),
  ('REC1', 'Liquidation',                   1000),
  ('REC2', 'Office Supplies',               1000)
) AS v(category_code, category_name, budget_amount);

UPDATE departments d
SET
  annual_budget = (
    SELECT COALESCE(SUM(bc.budget_amount), 0)
    FROM budget_categories bc
    WHERE bc.department_id = d.id
      AND bc.fiscal_year = d.fiscal_year
  ),
  updated_at = NOW()
WHERE LOWER(TRIM(d.name)) = 'it department'
  AND d.fiscal_year = 2026;

COMMIT;
