-- Reset All Department Budgets to 0, Remove All Expense Requests, and Delete All Budget Categories
-- WARNING: This will DELETE ALL expense requests, budget categories, and reset ALL department budgets to 0
-- This is a DESTRUCTIVE operation - backup your data before running

-- View current data before deletion
SELECT 'Current Departments' as info;
SELECT id, name, annual_budget, fiscal_year, used_budget, petty_cash_balance 
FROM public.departments 
ORDER BY fiscal_year, name;

SELECT 'Current Budget Categories Count' as info;
SELECT COUNT(*) as total_categories FROM public.budget_categories;

SELECT 'Current Expense Requests Count' as info;
SELECT COUNT(*) as total_requests FROM public.expense_requests;

-- Delete all expense requests and related data (in order of dependency)
-- Delete approval logs
DELETE FROM public.approval_logs;

-- Delete request attachments
DELETE FROM public.request_attachments;

-- Delete request liquidations
DELETE FROM public.request_liquidations;

-- Delete cash advances
DELETE FROM public.cash_advances;

-- Delete liquidation items
DELETE FROM public.liquidation_items;

-- Delete request allocations
DELETE FROM public.request_allocations;

-- Delete allocation logs
DELETE FROM public.allocation_logs;

-- Delete expense requests
DELETE FROM public.expense_requests;

-- Delete direct expenses (this affects budget totals)
DELETE FROM public.direct_expenses;

-- Delete all budget categories
DELETE FROM public.budget_categories;

-- Reset all department budgets to 0
UPDATE public.departments 
SET 
  annual_budget = 0,
  used_budget = 0,
  petty_cash_balance = 0,
  updated_at = NOW()
WHERE fiscal_year = 2026;

-- Verify the reset
SELECT 'After Reset - Departments' as info;
SELECT id, name, annual_budget, fiscal_year, used_budget, petty_cash_balance 
FROM public.departments 
ORDER BY fiscal_year, name;

SELECT 'After Reset - Budget Categories Count' as info;
SELECT COUNT(*) as total_categories FROM public.budget_categories;

SELECT 'After Reset - Expense Requests Count' as info;
SELECT COUNT(*) as total_requests FROM public.expense_requests;
