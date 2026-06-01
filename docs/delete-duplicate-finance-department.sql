-- Delete duplicate "Finance" department (keep "Finance Department")
-- This script removes the duplicate to prevent budget pool miscalculation

-- Check if "Finance" has any data before deleting
SELECT 'Checking Finance department data...' as info;

SELECT COUNT(*) as budget_categories_count 
FROM public.budget_categories 
WHERE department_id = (SELECT id FROM public.departments WHERE name = 'Finance' AND fiscal_year = 2026 LIMIT 1);

SELECT COUNT(*) as expense_requests_count 
FROM public.expense_requests 
WHERE department_id = (SELECT id FROM public.departments WHERE name = 'Finance' AND fiscal_year = 2026 LIMIT 1);

SELECT COUNT(*) as users_count 
FROM public.users 
WHERE department_id = (SELECT id FROM public.departments WHERE name = 'Finance' AND fiscal_year = 2026 LIMIT 1);

-- If all counts are 0, safe to delete
DELETE FROM public.departments 
WHERE name = 'Finance' AND fiscal_year = 2026;

-- Verify deletion
SELECT 'After deletion - Departments' as info;
SELECT name, annual_budget, fiscal_year 
FROM public.departments 
WHERE fiscal_year = 2026
ORDER BY name;
