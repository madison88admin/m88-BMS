-- Check Current Budget Categories in System
-- This script checks if the expense categories are already in the database

-- Check all budget categories
SELECT 
  category_code,
  category_name,
  fiscal_year,
  department_id,
  budget_amount,
  used_amount,
  committed_amount,
  remaining_amount
FROM budget_categories
ORDER BY category_code;

-- Check if specific cash advance categories exist
SELECT 
  category_code,
  category_name,
  fiscal_year
FROM budget_categories
WHERE category_code IN (
  '6010.1', '6010.2', '6010.3',
  '6020.1', '6020.2', '6020.3', '6020.4',
  '6170',
  '6430.1', '6430.2', '6430.5', '6430.7', '6430.8',
  '6490.1', '6490.2', '6490.3', '6490.4', '6490.5',
  '6501',
  '6650',
  '6670.11', '6670.15', '6670.17',
  '6720',
  '6840.1', '6840.2', '6840.3', '6840.4', '6840.5', '6840.6',
  '6870.1', '6870.2',
  '6900.1', '6900.2', '6900.3', '6900.4',
  '9900',
  '6351'
)
ORDER BY category_code;

-- Count total budget categories
SELECT 
  COUNT(*) as total_categories,
  COUNT(DISTINCT category_code) as unique_category_codes
FROM budget_categories;
