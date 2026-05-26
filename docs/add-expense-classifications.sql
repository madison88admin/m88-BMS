-- Add BMS Expense Classifications with Parent-Child Structure
-- Based on the expense classification table by department
-- Uses parent_category_id for subcategories (General vs Specific)
-- Run this in Supabase SQL Editor

-- Insert Parent Categories (General - All Department)
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount)
SELECT d.id, fy.fiscal_year, bc.category_code, bc.category_name, bc.budget_amount, 0, 0, bc.budget_amount
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6020', 'Automobile Expense (General)', 0)
) AS bc(category_code, category_name, budget_amount)
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert Subcategories for Automobile Expense (General) - All Department
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, parent_category_id)
SELECT 
  d.id, 
  fy.fiscal_year, 
  bc.category_code, 
  bc.category_name, 
  bc.budget_amount, 
  0, 
  0, 
  bc.budget_amount,
  parent.id
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6020.1', 'Automobile Fuel', 0),
  ('6020.2', 'Parking Fee', 0),
  ('6020.3', 'Toll Expense', 0)
) AS bc(category_code, category_name, budget_amount)
JOIN budget_categories parent ON parent.department_id = d.id 
  AND parent.fiscal_year = fy.fiscal_year 
  AND parent.category_code = '6020'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert Accounting/Finance Department Parent Categories
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount)
SELECT d.id, fy.fiscal_year, bc.category_code, bc.category_name, bc.budget_amount, 0, 0, bc.budget_amount
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6040', 'Bank Service Charges', 0),
  ('6041', 'Realized Forex Gain/Loss', 0),
  ('6670', 'Professional Fees', 0),
  ('6711', 'Office Rent Expense', 0)
) AS bc(category_code, category_name, budget_amount)
WHERE LOWER(TRIM(d.name)) = 'finance department'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert Professional Fees Subcategories for Accounting
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, parent_category_id)
SELECT 
  d.id, 
  fy.fiscal_year, 
  bc.category_code, 
  bc.category_name, 
  bc.budget_amount, 
  0, 
  0, 
  bc.budget_amount,
  parent.id
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6670.01', 'Professional Fees - Accounting', 0),
  ('6670.02', 'Professional Fees - Audit', 0),
  ('6670.03', 'Professional Fees - Tax Services', 0),
  ('6670.04', 'Professional Fees - Legal', 0)
) AS bc(category_code, category_name, budget_amount)
JOIN budget_categories parent ON parent.department_id = d.id 
  AND parent.fiscal_year = fy.fiscal_year 
  AND parent.category_code = '6670'
WHERE LOWER(TRIM(d.name)) = 'finance department'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert Admin Department Parent Categories
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount)
SELECT d.id, fy.fiscal_year, bc.category_code, bc.category_name, bc.budget_amount, 0, 0, bc.budget_amount
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6020', 'Automobile Expense (Specific)', 0),
  ('6711', 'Office Rent Expense', 0)
) AS bc(category_code, category_name, budget_amount)
WHERE LOWER(TRIM(d.name)) = 'admin department'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert Automobile Expense Subcategory for Admin
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, parent_category_id)
SELECT 
  d.id, 
  fy.fiscal_year, 
  bc.category_code, 
  bc.category_name, 
  bc.budget_amount, 
  0, 
  0, 
  bc.budget_amount,
  parent.id
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6020.4', 'Automobile Repairs', 0)
) AS bc(category_code, category_name, budget_amount)
JOIN budget_categories parent ON parent.department_id = d.id 
  AND parent.fiscal_year = fy.fiscal_year 
  AND parent.category_code = '6020'
WHERE LOWER(TRIM(d.name)) = 'admin department'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert HR Department Parent Categories
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount)
SELECT d.id, fy.fiscal_year, bc.category_code, bc.category_name, bc.budget_amount, 0, 0, bc.budget_amount
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6010', 'Advertising and Promotion', 0),
  ('6900', 'Welfare - Employee', 0)
) AS bc(category_code, category_name, budget_amount)
WHERE LOWER(TRIM(d.name)) = 'hr department'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert HR Subcategories
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, parent_category_id)
SELECT 
  d.id, 
  fy.fiscal_year, 
  bc.category_code, 
  bc.category_name, 
  bc.budget_amount, 
  0, 
  0, 
  bc.budget_amount,
  parent.id
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6010.1', 'Advertising and Promotion - Zoom', 0),
  ('6900.2', 'Welfare - Employee - HMO Expenses', 0)
) AS bc(category_code, category_name, budget_amount)
JOIN budget_categories parent ON parent.department_id = d.id 
  AND parent.fiscal_year = fy.fiscal_year 
  AND (parent.category_code = '6010' OR parent.category_code = '6900')
WHERE LOWER(TRIM(d.name)) = 'hr department'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Insert IT Department Categories
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount)
SELECT d.id, fy.fiscal_year, bc.category_code, bc.category_name, bc.budget_amount, 0, 0, bc.budget_amount
FROM departments d
CROSS JOIN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year) fy
CROSS JOIN (VALUES
  ('6170', 'Computer and Internet Expenses', 0)
) AS bc(category_code, category_name, budget_amount)
WHERE LOWER(TRIM(d.name)) = 'it department'
ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;

-- Verification query - shows parent-child relationships
SELECT 
  d.name as department,
  bc.fiscal_year,
  bc.category_code,
  bc.category_name,
  bc.budget_amount,
  bc.used_amount,
  bc.committed_amount,
  bc.remaining_amount,
  parent.category_name as parent_category,
  parent.category_code as parent_code
FROM budget_categories bc
JOIN departments d ON d.id = bc.department_id
LEFT JOIN budget_categories parent ON parent.id = bc.parent_category_id
WHERE bc.fiscal_year = (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT)
ORDER BY d.name, bc.category_code;
