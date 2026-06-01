-- Add Missing Budget Categories
-- This script adds the 23 missing cash advance categories to the system

-- First, let's check which departments exist
SELECT id, name FROM departments;

-- Add missing budget categories for all departments in fiscal year 2026
-- This will insert categories for each department with default budget amounts of 0

DO $$
DECLARE
  dept_record RECORD;
  fiscal_year_val INTEGER := 2026;
BEGIN
  -- Loop through all departments
  FOR dept_record IN SELECT id FROM departments LOOP
    
    -- Insert missing categories for this department
    
    -- 6010.2 LinkedIn
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6010.2', 'Advertising and Promotion - LinkedIn', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6010.3 Advertising Other
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6010.3', 'Advertising and Promotion - Other', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6430.1 Birthday Celebrations
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6430.1', 'Meals and Entertainment - Birthday Celebrations', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6430.2 Training Meal
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6430.2', 'Meals and Entertainment - Training Meal', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6430.5 Valentine's Day Celebration
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6430.5', 'Meals and Entertainment - Valentine''s Day Celebration', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6430.7 Representation
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6430.7', 'Meals and Entertainment - Representation', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6430.8 Meals and Entertainment - Other (company events)
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6430.8', 'Meals and Entertainment - Other (company events)', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6490.1 Office Stationery & Supplies
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6490.1', 'Office Supplies - Stationery & Supplies', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6490.2 Consumable & Pantry/cleaning Supplies
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6490.2', 'Office Supplies - Consumable & Pantry/cleaning Supplies', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6490.3 Tools & Equipment
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6490.3', 'Office Supplies - Tools & Equipment', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6490.4 Fire Extinguisher
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6490.4', 'Office Supplies - Fire Extinguisher', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6490.5 Office Supplies Other (Furnitures)
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6490.5', 'Office Supplies - Other (Furnitures)', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6670.11 Filing of Annual GIS
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6670.11', 'Professional Fees - Filing of Annual GIS', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6670.15 Nominee Directors Service
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6670.15', 'Professional Fees - Nominee Directors Service', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6670.17 Posted Transactions
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6670.17', 'Professional Fees - Posted Transactions', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6840.1 Local Travel-Airline Expenses
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6840.1', 'Travel Expense - Local Travel-Airline Expenses', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6840.2 Local Travel-Hotel
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6840.2', 'Travel Expense - Local Travel-Hotel', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6840.3 Foreign Travel-Airline Expenses
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6840.3', 'Travel Expense - Foreign Travel-Airline Expenses', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6840.4 Foreign Travel-Hotel
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6840.4', 'Travel Expense - Foreign Travel-Hotel', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6840.5 Travel Expense - Other
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6840.5', 'Travel Expense - Other', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6840.6 Travel expenses - Indo Representative
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6840.6', 'Travel Expense - Indo Representative', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6870.1 Globe
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6870.1', 'Communication - Globe', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6870.2 Smart Bills
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6870.2', 'Communication - Smart Bills', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6900.1 Seminar
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6900.1', 'Welfare - Employee - Seminar', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6900.3 Uniform
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6900.3', 'Welfare - Employee - Uniform', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
    -- 6900.4 Staff Welfare
    INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, created_at, updated_at)
    VALUES (dept_record.id, fiscal_year_val, '6900.4', 'Welfare - Employee - Staff Welfare', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (department_id, fiscal_year, category_code) DO NOTHING;
    
  END LOOP;
  
  RAISE NOTICE 'Successfully added missing budget categories for all departments';
END $$;

-- Verify the additions
SELECT 
  category_code,
  category_name,
  COUNT(*) as department_count
FROM budget_categories
WHERE category_code IN (
  '6010.2', '6010.3',
  '6430.1', '6430.2', '6430.5', '6430.7', '6430.8',
  '6490.1', '6490.2', '6490.3', '6490.4', '6490.5',
  '6670.11', '6670.15', '6670.17',
  '6840.1', '6840.2', '6840.3', '6840.4', '6840.5', '6840.6',
  '6870.1', '6870.2',
  '6900.1', '6900.3', '6900.4'
)
AND fiscal_year = 2026
GROUP BY category_code, category_name
ORDER BY category_code;
