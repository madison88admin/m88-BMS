-- Add Expense Categories from Provided Data
-- This script adds expense categories to the budget_categories table
-- Budget amounts are set to 0 since we just reset the system

-- Get department IDs for reference
SELECT id, name FROM public.departments;

-- Insert expense categories using INSERT ... SELECT syntax
-- Sales
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT (SELECT id FROM public.departments WHERE name = 'Finance' LIMIT 1), 2026, '4790', 'Sales', 0, 0, 0, 0, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = (SELECT id FROM public.departments WHERE name = 'Finance' LIMIT 1) 
  AND fiscal_year = 2026 
  AND category_code = '4790'
);

-- Cost of Services - Payroll Expenses
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Finance', '66001', 'Payroll Expense Executive'),
  ('Finance', '66002', 'Payroll Expense Accounting'),
  ('HR Department', '66003', 'Payroll Expense H.R.'),
  ('Logistics Department', '66004', 'Payroll Expense Logistics'),
  ('Planning Department', '66005', 'Payroll Expense Planning'),
  ('Purchasing Department', '66006', 'Payroll Expense Purchasing'),
  ('Costing Department', '66007', 'Payroll Expense Costing'),
  ('IT Department', '66008', 'Payroll Expense I.T.'),
  ('HR Department', '66009', 'Payroll Expense OJT'),
  ('Supply Chain Department', '660010', 'Payroll Expense Supply Chain'),
  ('Finance', '66012', 'Phil. Health Insurance'),
  ('Finance', '66017', 'Home Development Company'),
  ('Finance', '6606', 'Social Security Company')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- HR - Advertising and Promotion
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('HR Department', '6010.1', 'Zoom'),
  ('HR Department', '6010.2', 'LinkedIn'),
  ('HR Department', '6010.3', 'Advertising Other')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Automobile Expense (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6020.1', 'Automobile Fuel'),
  ('6020.2', 'Parking Fee'),
  ('6020.3', 'Toll Expense')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Admin-specific Automobile Expense
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Admin Department', '6020.4', 'Autombile Repairs'),
  ('Admin Department', '6020.5', 'Car Insurance'),
  ('Admin Department', '6020.6', 'Automobile Expenses-Registration')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Accounting - Bank Service Charges
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Finance', '6040', 'Bank Service Charges'),
  ('Finance', '6041', 'Realized Forex Gain/Loss')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- IT - Computer and Internet Expenses
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('IT Department', '6170', 'Computer and Internet Expenses')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Accounting - Depreciation/Insurance/Interest
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Finance', '6240', 'Depreciation Expense'),
  ('Finance', '6330', 'Insurance Expense'),
  ('Finance', '6340', 'Interest Expense')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Meals and Entertainment (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6430.1', 'Birthday Celebrations'),
  ('6430.2', 'Training Meal'),
  ('6430.7', 'Representation'),
  ('6430.8', 'Meals and Entertainment - Other (company events)')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- HR-specific Meals and Entertainment
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('HR Department', '6430.5', 'Meals and Entertainment - Valentine''s Day Celebration')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Office Supplies (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6490.1', 'Office Stationery & Supplies'),
  ('6490.2', 'Consumable & Pantry/cleaning Supplies')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- HR-specific Office Supplies
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('HR Department', '6490.3', 'Tools & Equipment'),
  ('HR Department', '6490.4', 'Fire Extinguisher'),
  ('HR Department', '6490.5', 'Office Supplies Other (Furnitures)')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Medical Expenses (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6501', 'Medical Expenses')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Postage and Delivery (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6650', 'Postage and Delivery')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Professional Fees
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Finance', '6670.01', 'Professional Fees - Accounting'),
  ('Finance', '6670.08', 'BIR Compliance Service'),
  ('Finance', '6670.1', 'DOLE Establishment Report & 13th'),
  ('Finance', '6670.11', 'Filing of Annual GIS'),
  ('Finance', '6670.12', 'Fire Safety Inspection Certificate'),
  ('Finance', '6670.15', 'Nominee Directors Service'),
  ('Finance', '6670.17', 'Posted Transactions'),
  ('Finance', '6670.18', 'Posted Transactions Adjustment'),
  ('Finance', '6670.24', 'Notarization fee')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Rent and Repairs
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Admin Department', '6711', 'Office Rent Expense'),
  ('Admin Department', '6720', 'Repairs and Maintenance')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Travel Expense (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6840.1', 'Local Travel-Airline Expenses'),
  ('6840.2', 'Local Travel-Hotel'),
  ('6840.3', 'Foreign Travel-Airline Expenses'),
  ('6840.4', 'Foreign Travel-Hotel'),
  ('6840.5', 'Travel Expense - Other')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Finance-specific Travel Expense
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Finance', '6840.6', 'Travel expenses - Indo Representative')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Utilities
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Admin Department', '6860.1', 'Electricity'),
  ('Admin Department', '6860.2', 'Water'),
  ('Admin Department', '6860.3', 'Utilities Others (Aircon etc)')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Communication (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6870.1', 'Globe'),
  ('6870.2', 'Smart Bills')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Admin-specific Communication
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Admin Department', '6870.3', 'PLDT Telephone'),
  ('Admin Department', '6870.5', 'Internet Subscription')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Welfare - Employee (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('6900.1', 'Seminar')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- HR-specific Welfare - Employee
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('HR Department', '6900.2', 'HMO Expenses'),
  ('HR Department', '6900.3', 'Uniform'),
  ('HR Department', '6900.4', 'Staff Welfare')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Sundry (All Department - create for all departments)
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('9900', 'Sundry & Misc')
) AS v(code, name)
CROSS JOIN (SELECT id FROM public.departments) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Taxes & Licenses
INSERT INTO public.budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
SELECT dept_id, 2026, code, name, 0, 0, 0, 0, NOW(), NOW()
FROM (VALUES
  ('Finance', '6351', 'Business tax/Licenses'),
  ('Finance', '6352', 'Income Tax')
) AS v(dept_name, code, name)
CROSS JOIN LATERAL (SELECT id FROM public.departments WHERE name = v.dept_name LIMIT 1) AS dept(dept_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.budget_categories 
  WHERE department_id = dept_id 
  AND fiscal_year = 2026 
  AND category_code = v.code
);

-- Verification query
SELECT COUNT(*) as total_categories_added FROM public.budget_categories WHERE fiscal_year = 2026;
