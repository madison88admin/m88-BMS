-- Check for duplicate M88 Manila cost centers
SELECT 
  LOWER(TRIM(name)) AS normalized_name,
  fiscal_year,
  COUNT(*) AS count,
  STRING_AGG(id::text, ', ') AS ids
FROM cost_centers
WHERE LOWER(TRIM(name)) = 'm88 manila'
GROUP BY LOWER(TRIM(name)), fiscal_year
HAVING COUNT(*) > 1;

-- List all M88 Manila cost centers
SELECT 
  id,
  name,
  fiscal_year,
  is_active,
  total_budget,
  used_amount,
  pending_amount,
  remaining_amount,
  created_at,
  updated_at
FROM cost_centers
WHERE LOWER(TRIM(name)) = 'm88 manila'
ORDER BY fiscal_year, created_at;
