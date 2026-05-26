-- Recover budget_categories after accidental CASCADE delete.
-- Safe to re-run: skips existing names/codes; uses ON CONFLICT for updates.
--
-- Before running, check existing rows:
-- SELECT category_code, category_name, budget_amount
-- FROM budget_categories bc
-- JOIN departments d ON d.id = bc.department_id
-- WHERE LOWER(TRIM(d.name)) = 'it department' AND bc.fiscal_year = 2026
-- ORDER BY category_code;

BEGIN;

WITH target AS (
  SELECT d.id AS department_id, d.fiscal_year
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = 'it department'
    AND d.fiscal_year = (SELECT MAX(fiscal_year) FROM departments)
  LIMIT 1
),
history AS (
  SELECT
    TRIM(r.category) AS category_name,
    SUM(r.amount) AS observed_total,
    SUM(CASE WHEN r.status = 'released' THEN r.amount ELSE 0 END) AS used_total,
    SUM(CASE WHEN r.status IN ('pending_supervisor', 'pending_accounting', 'on_hold') THEN r.amount ELSE 0 END) AS committed_total
  FROM expense_requests r
  CROSS JOIN target t
  WHERE r.fiscal_year = t.fiscal_year
    AND r.department_id = t.department_id
    AND r.category IS NOT NULL
    AND TRIM(r.category) <> ''
  GROUP BY TRIM(r.category)
),
numbered AS (
  SELECT
    h.*,
    ROW_NUMBER() OVER (ORDER BY h.category_name) AS seq,
    SUBSTRING(h.category_name FROM '^(\d{4,5})') AS lead_code,
    COUNT(*) OVER (
      PARTITION BY SUBSTRING(h.category_name FROM '^(\d{4,5})')
    ) AS lead_code_dupes
  FROM history h
),
prepared AS (
  SELECT
    n.*,
    CASE
      WHEN n.lead_code IS NOT NULL
        AND n.lead_code_dupes = 1
        AND NOT EXISTS (
          SELECT 1
          FROM budget_categories b
          CROSS JOIN target t
          WHERE b.department_id = t.department_id
            AND b.fiscal_year = t.fiscal_year
            AND b.category_code = n.lead_code
        )
      THEN n.lead_code
      ELSE 'REC' || LPAD(n.seq::text, 3, '0')
    END AS category_code
  FROM numbered n
),
to_insert AS (
  SELECT
    p.*,
    GREATEST(
      CEIL(p.observed_total * 1.15),
      CEIL((p.used_total + p.committed_total) * 1.1),
      1000
    ) AS budget_amount
  FROM prepared p
  WHERE NOT EXISTS (
    SELECT 1
    FROM budget_categories b
    CROSS JOIN target t
    WHERE b.department_id = t.department_id
      AND b.fiscal_year = t.fiscal_year
      AND LOWER(TRIM(b.category_name)) = LOWER(TRIM(p.category_name))
  )
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
  i.category_code,
  i.category_name,
  i.budget_amount,
  i.used_total,
  i.committed_total,
  GREATEST(0, i.budget_amount - i.used_total - i.committed_total),
  NOW()
FROM to_insert i
CROSS JOIN target t
ON CONFLICT (department_id, fiscal_year, category_code)
DO UPDATE SET
  category_name = EXCLUDED.category_name,
  budget_amount = GREATEST(budget_categories.budget_amount, EXCLUDED.budget_amount),
  used_amount = EXCLUDED.used_amount,
  committed_amount = EXCLUDED.committed_amount,
  remaining_amount = GREATEST(
    0,
    GREATEST(budget_categories.budget_amount, EXCLUDED.budget_amount)
      - EXCLUDED.used_amount
      - EXCLUDED.committed_amount
  ),
  updated_at = NOW();

COMMIT;

-- Verify:
-- SELECT category_code, category_name, budget_amount, used_amount, committed_amount
-- FROM budget_categories bc
-- JOIN departments d ON d.id = bc.department_id
-- WHERE LOWER(TRIM(d.name)) = 'it department' AND bc.fiscal_year = 2026
-- ORDER BY category_code;
