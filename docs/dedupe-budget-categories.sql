-- Remove duplicate budget_categories (same dept + FY + category_code).
-- Keeps the row with the highest budget_amount; merges used/committed from duplicates.
--
-- Preview duplicates first:
-- SELECT bc.category_code, bc.category_name, bc.budget_amount, bc.id
-- FROM budget_categories bc
-- JOIN departments d ON d.id = bc.department_id
-- WHERE LOWER(TRIM(d.name)) = 'it department' AND bc.fiscal_year = 2026
-- ORDER BY bc.category_code, bc.budget_amount DESC;

BEGIN;

WITH target AS (
  SELECT d.id AS department_id, d.fiscal_year
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = 'it department'
    AND d.fiscal_year = 2026
  LIMIT 1
),
ranked AS (
  SELECT
    bc.id,
    bc.department_id,
    bc.fiscal_year,
    bc.category_code,
    bc.category_name,
    bc.budget_amount,
    bc.used_amount,
    bc.committed_amount,
    ROW_NUMBER() OVER (
      PARTITION BY bc.department_id, bc.fiscal_year, bc.category_code
      ORDER BY
        bc.budget_amount DESC NULLS LAST,
        (COALESCE(bc.used_amount, 0) + COALESCE(bc.committed_amount, 0)) DESC,
        bc.updated_at DESC NULLS LAST,
        bc.created_at DESC NULLS LAST,
        bc.id ASC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY bc.department_id, bc.fiscal_year, bc.category_code
    ) AS dup_count
  FROM budget_categories bc
  CROSS JOIN target t
  WHERE bc.department_id = t.department_id
    AND bc.fiscal_year = t.fiscal_year
),
keepers AS (
  SELECT * FROM ranked WHERE rn = 1
),
merged AS (
  SELECT
    k.id AS keeper_id,
    k.category_code,
    GREATEST(
      k.budget_amount,
      COALESCE(SUM(r.budget_amount) FILTER (WHERE r.rn > 1), 0)
    ) AS budget_amount,
    GREATEST(
      COALESCE(k.used_amount, 0),
      COALESCE(MAX(r.used_amount) FILTER (WHERE r.rn > 1), 0)
    ) AS used_amount,
    GREATEST(
      COALESCE(k.committed_amount, 0),
      COALESCE(MAX(r.committed_amount) FILTER (WHERE r.rn > 1), 0)
    ) AS committed_amount,
    MAX(k.category_name) AS category_name
  FROM keepers k
  JOIN ranked r
    ON r.department_id = k.department_id
   AND r.fiscal_year = k.fiscal_year
   AND r.category_code = k.category_code
  GROUP BY k.id, k.category_code, k.budget_amount, k.used_amount, k.committed_amount, k.category_name
)
UPDATE budget_categories bc
SET
  budget_amount = m.budget_amount,
  used_amount = m.used_amount,
  committed_amount = m.committed_amount,
  remaining_amount = GREATEST(0, m.budget_amount - m.used_amount - m.committed_amount),
  category_name = m.category_name,
  updated_at = NOW()
FROM merged m
WHERE bc.id = m.keeper_id;

WITH target AS (
  SELECT d.id AS department_id, d.fiscal_year
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = 'it department'
    AND d.fiscal_year = 2026
  LIMIT 1
),
ranked AS (
  SELECT
    bc.id,
    ROW_NUMBER() OVER (
      PARTITION BY bc.department_id, bc.fiscal_year, bc.category_code
      ORDER BY
        bc.budget_amount DESC NULLS LAST,
        (COALESCE(bc.used_amount, 0) + COALESCE(bc.committed_amount, 0)) DESC,
        bc.updated_at DESC NULLS LAST,
        bc.id ASC
    ) AS rn
  FROM budget_categories bc
  CROSS JOIN target t
  WHERE bc.department_id = t.department_id
    AND bc.fiscal_year = t.fiscal_year
)
DELETE FROM budget_categories bc
USING ranked r
WHERE bc.id = r.id
  AND r.rn > 1;

COMMIT;

-- Verify (should be ~15 rows, one per category_code):
-- SELECT category_code, category_name, budget_amount, used_amount, committed_amount
-- FROM budget_categories bc
-- JOIN departments d ON d.id = bc.department_id
-- WHERE LOWER(TRIM(d.name)) = 'it department' AND bc.fiscal_year = 2026
-- ORDER BY category_code;
