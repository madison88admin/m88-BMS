-- Seed official expense sub-categories (upsert by code)
-- Prerequisite: docs/create-expense-categories-table.sql
-- department: All | HR | Admin | Accounting | IT
-- Updated with complete category set including all submission rules

INSERT INTO expense_categories (
  code, description, main_category_code, main_category_name, department,
  manner_of_submission, cash_advance_allowed, reimbursement_allowed, updated_at
) VALUES
  -- 6010 Advertising and Promotion (HR)
  ('6010.1', 'Zoom', '6010', 'Advertising and Promotion', 'HR', 'for_submission', true, true, NOW()),
  ('6010.2', 'LinkedIn', '6010', 'Advertising and Promotion', 'HR', 'for_submission', true, true, NOW()),
  ('6010.3', 'Advertising Other', '6010', 'Advertising and Promotion', 'HR', 'for_submission', true, true, NOW()),

  -- 6020 Automobile Expense
  ('6020.1', 'Automobile Fuel', '6020', 'Automobile Expense', 'All', 'for_upload', true, true, NOW()),
  ('6020.2', 'Parking Fee', '6020', 'Automobile Expense', 'All', 'for_upload', true, true, NOW()),
  ('6020.3', 'Toll Expense', '6020', 'Automobile Expense', 'All', 'for_upload', true, true, NOW()),
  ('6020.4', 'Automobile Repairs', '6020', 'Automobile Expense', 'Admin', 'for_submission', true, true, NOW()),
  ('6020.5', 'Car Insurance', '6020', 'Automobile Expense', 'Admin', 'for_upload', false, false, NOW()),
  ('6020.6', 'Automobile Expenses-Registration', '6020', 'Automobile Expense', 'Admin', 'for_upload', false, false, NOW()),

  -- 6040 Bank Service Charges (Accounting)
  ('6040', 'Bank Service Charges', '6040', 'Bank Service Charges', 'Accounting', 'for_upload', false, false, NOW()),

  -- 6041 Realized Forex Gain/Loss (Accounting)
  ('6041', 'Realized Forex Gain/Loss', '6041', 'Realized Forex Gain/Loss', 'Accounting', 'for_upload', false, false, NOW()),

  -- 6170 Computer and Internet Expenses (IT)
  ('6170', 'Computer and Internet Expenses', '6170', 'Computer and Internet Expenses', 'IT', 'for_submission', true, true, NOW()),

  -- 6240 Depreciation Expense (Accounting)
  ('6240', 'Depreciation Expense', '6240', 'Depreciation Expense', 'Accounting', 'for_upload', false, false, NOW()),

  -- 6330 Insurance Expense (Admin)
  ('6330', 'Insurance Expense', '6330', 'Insurance Expense', 'Admin', 'for_upload', false, false, NOW()),

  -- 6340 Interest Expense (Accounting)
  ('6340', 'Interest Expense', '6340', 'Interest Expense', 'Accounting', 'for_upload', false, false, NOW()),

  -- 6350 Taxes & Licenses (Accounting)
  ('6351', 'Business Tax/Licenses', '6350', 'Taxes & Licenses', 'Accounting', 'for_upload', true, true, NOW()),
  ('6352', 'Income Tax', '6350', 'Taxes & Licenses', 'Accounting', 'for_upload', false, false, NOW()),

  -- 6430 Meals and Entertainment
  ('6430.1', 'Birthday Celebrations', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),
  ('6430.2', 'Training Meal', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),
  ('6430.5', 'Valentine''s Day Celebration', '6430', 'Meals and Entertainment', 'HR', 'for_submission', true, true, NOW()),
  ('6430.7', 'Representation', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),
  ('6430.8', 'Meals and Entertainment - Other (company events)', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),

  -- 6490 Office Supplies
  ('6490.1', 'Office Stationery & Supplies', '6490', 'Office Supplies', 'All', 'for_submission', true, true, NOW()),
  ('6490.2', 'Consumable & Pantry/Cleaning Supplies', '6490', 'Office Supplies', 'All', 'for_submission', true, true, NOW()),
  ('6490.3', 'Tools & Equipment', '6490', 'Office Supplies', 'HR', 'for_submission', true, true, NOW()),
  ('6490.4', 'Fire Extinguisher', '6490', 'Office Supplies', 'HR', 'for_submission', true, true, NOW()),
  ('6490.5', 'Office Supplies Other (Furnitures)', '6490', 'Office Supplies', 'HR', 'for_submission', true, true, NOW()),

  -- 6500 Medical Records and Supplies
  ('6501', 'Medical Expenses', '6500', 'Medical Records and Supplies', 'All', 'for_submission', true, true, NOW()),

  -- 6650 Postage and Delivery
  ('6650', 'Postage and Delivery', '6650', 'Postage and Delivery', 'All', 'for_submission', true, true, NOW()),

  -- 6670 Professional Fees (Accounting)
  ('6670.01', 'Professional Fees - Accounting', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.08', 'BIR Compliance Service', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.1', 'DOLE Establishment Report & 13th', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.11', 'Filing of Annual GIS', '6670', 'Professional Fees', 'Accounting', 'for_submission', true, true, NOW()),
  ('6670.12', 'Fire Safety Inspection Certificate', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.15', 'Nominee Directors Service', '6670', 'Professional Fees', 'Accounting', 'for_submission', true, true, NOW()),
  ('6670.17', 'Posted Transactions', '6670', 'Professional Fees', 'Accounting', 'for_submission', true, true, NOW()),
  ('6670.18', 'Posted Transactions Adjustment', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.24', 'Notarization Fee', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),

  -- 6710 Rent Expense (Admin)
  ('6711', 'Office Rent Expense', '6710', 'Rent Expense', 'Admin', 'for_upload', false, false, NOW()),

  -- 6720 Repairs and Maintenance (Admin)
  ('6720', 'Repairs and Maintenance', '6720', 'Repairs and Maintenance', 'Admin', 'for_submission', true, true, NOW()),

  -- 6840 Travel Expense
  ('6840.1', 'Local Travel - Airline Expenses', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.2', 'Local Travel - Hotel', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.3', 'Foreign Travel - Airline Expenses', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.4', 'Foreign Travel - Hotel', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.5', 'Travel Expense - Other', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.6', 'Travel Expenses - Indo Representative', '6840', 'Travel Expense', 'Accounting', 'for_submission', true, true, NOW()),

  -- 6860 Utilities (Admin)
  ('6860.1', 'Electricity', '6860', 'Utilities', 'Admin', 'for_upload', false, false, NOW()),
  ('6860.2', 'Water', '6860', 'Utilities', 'Admin', 'for_upload', false, false, NOW()),
  ('6860.3', 'Utilities Others (Aircon etc)', '6860', 'Utilities', 'Admin', 'for_upload', false, false, NOW()),

  -- 6870 Communication
  ('6870.1', 'Globe', '6870', 'Communication', 'All', 'for_upload', true, true, NOW()),
  ('6870.2', 'Smart Bills', '6870', 'Communication', 'All', 'for_upload', true, true, NOW()),
  ('6870.3', 'PLDT Telephone', '6870', 'Communication', 'Admin', 'for_upload', false, false, NOW()),
  ('6870.5', 'Internet Subscription', '6870', 'Communication', 'Admin', 'for_upload', false, false, NOW()),

  -- 6900 Welfare - Employee
  ('6900.1', 'Seminar', '6900', 'Welfare - Employee', 'All', 'for_submission', true, true, NOW()),
  ('6900.2', 'HMO Expenses', '6900', 'Welfare - Employee', 'HR', 'for_submission', true, true, NOW()),
  ('6900.3', 'Uniform', '6900', 'Welfare - Employee', 'HR', 'for_submission', true, true, NOW()),
  ('6900.4', 'Staff Welfare', '6900', 'Welfare - Employee', 'HR', 'for_submission', true, true, NOW()),

  -- 9900 Sundry
  ('9900', 'Sundry & Misc', '9900', 'Sundry', 'All', 'for_submission', true, true, NOW())
ON CONFLICT (code) DO UPDATE SET
  description = EXCLUDED.description,
  main_category_code = EXCLUDED.main_category_code,
  main_category_name = EXCLUDED.main_category_name,
  department = EXCLUDED.department,
  manner_of_submission = EXCLUDED.manner_of_submission,
  cash_advance_allowed = EXCLUDED.cash_advance_allowed,
  reimbursement_allowed = EXCLUDED.reimbursement_allowed,
  updated_at = NOW();

-- Verification
SELECT code, description, main_category_name, department, manner_of_submission,
       cash_advance_allowed, reimbursement_allowed
FROM expense_categories
ORDER BY main_category_code, code;
